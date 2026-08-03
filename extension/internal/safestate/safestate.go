// Package safestate implements the safe-state logic and error handling for the Aegis vault system.
//
// Task 17 (Day 17): Error handling, safe-state logic, emergency exit.
// Acceptance criterion: Failure-mode tests pass (TEE down, PMW failure, FDC delay).
//
// Per the report's Section 9.3.12 (Disaster recovery and business continuity):
//
//   "If the TEE fails or becomes unavailable, the vault enters a safe state:
//    no new positions are taken, no rebalances occur, and the user can withdraw
//    their deposited assets via an emergency exit path that does not depend on the TEE.
//    If the AI agent emits an erroneous instruction, the Policy Engine's deterministic
//    constraints prevent the instruction from violating the on-chain policy parameters.
//    If PMW is unavailable, cross-chain execution pauses but on-chain Flare operations
//    continue. The system is designed to fail safe rather than fail fast."
//
// Per the report's Section 9.5.5 (Testing strategy):
//
//   "Failure-mode tests: TEE unavailable, PMW consensus failure, FDC attestation delay
//    — verify the vault enters safe state."
//
// Per the report's Section 9.5.7 (Reliability, fault tolerance, performance):
//
//   "Fault tolerance: the vault fails safe (no new positions) if the TEE is unavailable;
//    users can always exit via emergencyExit."
//
// The SafeStateManager tracks the health of each subsystem and transitions the vault
// into a safe state when any critical subsystem fails. The safe state is defined as:
//   1. No new deposits accepted
//   2. No new positions taken
//   3. No rebalances executed
//   4. Withdrawals still allowed (including emergency exit)
//   5. Solvency attestation continues if possible (read-only)
//
// Key Design Decisions:
//   1. The safe state is entered automatically when any critical subsystem fails
//   2. The safe state is exited only when ALL critical subsystems are healthy
//   3. Emergency exit is always available regardless of safe state
//   4. Circuit breaker pattern: consecutive failures trigger safe state
//   5. Retry with exponential backoff for transient failures
//   6. Error classification: transient vs. permanent vs. critical
package safestate

import (
	"fmt"
	"sync"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

// ─── System Health ──────────────────────────────────────────────────────────

// SystemID identifies a subsystem that can fail.
type SystemID string

const (
	SystemTEE       SystemID = "TEE"        // TEE (FCC extension) availability
	SystemPMW       SystemID = "PMW"        // Protocol Managed Wallet availability
	SystemFDC       SystemID = "FDC"        // Flare Data Connector availability
	SystemFTSO      SystemID = "FTSO"       // FTSO V2 price feed availability
	SystemOnChain   SystemID = "ONCHAIN"    // Flare C-Chain RPC availability
	SystemRiskAgent SystemID = "RISK_AGENT" // RiskAgent (AI model) availability
	SystemPolicy    SystemID = "POLICY"     // Policy Engine availability
	SystemPosition  SystemID = "POSITION"   // PositionComputer availability
)

// HealthStatus represents the health status of a subsystem.
type HealthStatus string

const (
	HealthHealthy   HealthStatus = "HEALTHY"   // Subsystem is fully operational
	HealthDegraded  HealthStatus = "DEGRADED"  // Subsystem is partially operational
	HealthUnhealthy HealthStatus = "UNHEALTHY" // Subsystem is not operational
	HealthUnknown   HealthStatus = "UNKNOWN"   // Subsystem health is unknown
)

// VaultMode represents the operational mode of the vault.
type VaultMode string

const (
	ModeNormal    VaultMode = "NORMAL"      // All systems operational; normal operations
	ModeSafeState VaultMode = "SAFE_STATE"  // One or more critical systems failed; vault in safe state
	ModeEmergency VaultMode = "EMERGENCY"   // Emergency mode; only emergency exits allowed
)

// ErrorClass represents the classification of an error.
type ErrorClass string

const (
	ErrorClassTransient ErrorClass = "TRANSIENT" // Temporary error; retry with backoff
	ErrorClassPermanent ErrorClass = "PERMANENT" // Permanent error; do not retry
	ErrorClassCritical  ErrorClass = "CRITICAL"  // Critical error; enter safe state immediately
)

// SystemHealth represents the health of a single subsystem.
type SystemHealth struct {
	SystemID         SystemID     `json:"systemId"`
	Status           HealthStatus `json:"status"`
	LastError        string       `json:"lastError,omitempty"`
	LastErrorTime    time.Time    `json:"lastErrorTime,omitempty"`
	ConsecutiveFails int          `json:"consecutiveFails"`
	LastCheckTime    time.Time    `json:"lastCheckTime"`
	IsCritical       bool         `json:"isCritical"`
	IsRecoverable    bool         `json:"isRecoverable"`
}

// SafeStateConfig holds the configuration for the SafeStateManager.
type SafeStateConfig struct {
	// Circuit breaker thresholds
	MaxConsecutiveFails  int           `json:"maxConsecutiveFails"`
	HealthCheckInterval  time.Duration `json:"healthCheckInterval"`

	// Retry configuration
	MaxRetries    int           `json:"maxRetries"`
	RetryBaseDelay time.Duration `json:"retryBaseDelay"`
	RetryMaxDelay  time.Duration `json:"retryMaxDelay"`

	// Recovery configuration
	RecoveryCheckInterval time.Duration `json:"recoveryCheckInterval"`
	MinRecoveryDuration   time.Duration `json:"minRecoveryDuration"`

	// Coston2 configuration
	Coston2RPCURL      string `json:"coston2RpcUrl"`
	VaultCoreAddress   string `json:"vaultCoreAddress"`
	VerifierPrivateKey string `json:"verifierPrivateKey"`

	// Emergency configuration
	AutoEmergencyOnInsolvency bool `json:"autoEmergencyOnInsolvency"`
}

// DefaultSafeStateConfig returns the default configuration for Coston2.
func DefaultSafeStateConfig() SafeStateConfig {
	return SafeStateConfig{
		MaxConsecutiveFails:       3,
		HealthCheckInterval:       30 * time.Second,
		MaxRetries:                3,
		RetryBaseDelay:            2 * time.Second,
		RetryMaxDelay:             30 * time.Second,
		RecoveryCheckInterval:     60 * time.Second,
		MinRecoveryDuration:       5 * time.Minute,
		Coston2RPCURL:             "https://coston2-api.flare.network/ext/C/rpc",
		AutoEmergencyOnInsolvency: true,
	}
}

// SafeStateTransition represents a vault mode transition event.
type SafeStateTransition struct {
	FromMode    VaultMode `json:"fromMode"`
	ToMode      VaultMode `json:"toMode"`
	Reason      string    `json:"reason"`
	TriggeredBy SystemID  `json:"triggeredBy"`
	Timestamp   time.Time `json:"timestamp"`
}

// ClassifiedError represents an error with its classification.
type ClassifiedError struct {
	Error      error     `json:"-"`
	Class      ErrorClass `json:"class"`
	SystemID   SystemID  `json:"systemId"`
	Timestamp  time.Time `json:"timestamp"`
	RetryCount int       `json:"retryCount"`
}

// SafeStateSummary is a summary of the safe state.
type SafeStateSummary struct {
	CurrentMode       VaultMode                 `json:"currentMode"`
	IsRecovering      bool                      `json:"isRecovering"`
	RecoveryStartTime time.Time                 `json:"recoveryStartTime,omitempty"`
	SystemHealth      map[SystemID]HealthStatus `json:"systemHealth"`
	UnhealthySystems  []SystemID                `json:"unhealthySystems"`
	CriticalFailures  []SystemID                `json:"criticalFailures"`
	TransitionCount   int                       `json:"transitionCount"`
	LastTransition    *SafeStateTransition       `json:"lastTransition,omitempty"`
}

// SafeStateManager manages the safe-state logic for the Aegis vault.
type SafeStateManager struct {
	config  SafeStateConfig
	mu      sync.RWMutex

	// Current vault mode
	currentMode VaultMode

	// System health tracking
	systemHealth map[SystemID]*SystemHealth

	// Transition history
	transitions []SafeStateTransition

	// Recovery tracking
	recoveryStartTime time.Time
	isRecovering      bool

	// Callbacks for mode transitions
	onEnterSafeState func(reason string)
	onExitSafeState  func()
	onEnterEmergency func(reason string)
	onExitEmergency  func()

	// Error tracking
	errorHistory map[SystemID][]ClassifiedError
}

// NewSafeStateManager creates a new SafeStateManager with the given configuration.
func NewSafeStateManager(config SafeStateConfig) *SafeStateManager {
	sm := &SafeStateManager{
		config:       config,
		currentMode:  ModeNormal,
		systemHealth: make(map[SystemID]*SystemHealth),
		transitions:  make([]SafeStateTransition, 0),
		errorHistory: make(map[SystemID][]ClassifiedError),
	}

	// Initialize all subsystem health to unknown
	criticalSystems := []struct {
		id          SystemID
		isCritical  bool
		recoverable bool
	}{
		{SystemTEE, true, true},
		{SystemPMW, true, true},
		{SystemFDC, true, true},
		{SystemFTSO, true, true},
		{SystemOnChain, true, true},
		{SystemRiskAgent, true, true},
		{SystemPolicy, true, true},
		{SystemPosition, true, true},
	}

	for _, sys := range criticalSystems {
		sm.systemHealth[sys.id] = &SystemHealth{
			SystemID:      sys.id,
			Status:        HealthUnknown,
			IsCritical:    sys.isCritical,
			IsRecoverable: sys.recoverable,
		}
	}

	return sm
}

// ─── Core Methods ───────────────────────────────────────────────────────────

// GetMode returns the current vault mode.
func (sm *SafeStateManager) GetMode() VaultMode {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode
}

// IsInSafeState returns whether the vault is in safe state.
func (sm *SafeStateManager) IsInSafeState() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode == ModeSafeState
}

// IsInEmergency returns whether the vault is in emergency mode.
func (sm *SafeStateManager) IsInEmergency() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode == ModeEmergency
}

// IsOperational returns whether the vault can perform normal operations.
func (sm *SafeStateManager) IsOperational() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode == ModeNormal
}

// CanAcceptDeposits returns whether the vault can accept new deposits.
func (sm *SafeStateManager) CanAcceptDeposits() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode == ModeNormal
}

// CanRebalance returns whether the vault can execute rebalances.
func (sm *SafeStateManager) CanRebalance() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentMode == ModeNormal
}

// CanWithdraw returns whether withdrawals are allowed.
// Per the report: "users can always exit via emergencyExit"
func (sm *SafeStateManager) CanWithdraw() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	// Withdrawals are always allowed — even in safe state and emergency mode
	return true
}

// CanEmergencyExit returns whether emergency exits are allowed.
// Per the report: "emergency exit path that does not depend on the TEE"
func (sm *SafeStateManager) CanEmergencyExit() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	// Emergency exits are always available
	return true
}

// CanAttestSolvency returns whether the vault can publish solvency attestations.
// In safe state, read-only attestation is still possible.
func (sm *SafeStateManager) CanAttestSolvency() bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	// Attestation is possible in normal and safe state (read-only in safe state)
	return sm.currentMode == ModeNormal || sm.currentMode == ModeSafeState
}

// ─── Health Check Methods ───────────────────────────────────────────────────

// ReportHealth reports the health status of a subsystem.
func (sm *SafeStateManager) ReportHealth(systemID SystemID, status HealthStatus) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[systemID]
	if !exists {
		health = &SystemHealth{
			SystemID:      systemID,
			IsCritical:    true,
			IsRecoverable: true,
		}
		sm.systemHealth[systemID] = health
	}

	previousStatus := health.Status
	health.Status = status
	health.LastCheckTime = time.Now()

	// Reset consecutive fails on healthy status
	if status == HealthHealthy {
		health.ConsecutiveFails = 0
		health.LastError = ""
		health.LastErrorTime = time.Time{}
	}

	// Check if we need to transition vault mode
	if previousStatus != status {
		logger.Infof("System %s health changed: %s -> %s", systemID, previousStatus, status)
		sm.evaluateModeTransition()
	}
}

// ReportError reports an error from a subsystem and classifies it.
func (sm *SafeStateManager) ReportError(systemID SystemID, err error, class ErrorClass) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[systemID]
	if !exists {
		health = &SystemHealth{
			SystemID:      systemID,
			IsCritical:    true,
			IsRecoverable: true,
		}
		sm.systemHealth[systemID] = health
	}

	// Record the error
	classifiedErr := ClassifiedError{
		Error:     err,
		Class:     class,
		SystemID:  systemID,
		Timestamp: time.Now(),
	}
	sm.errorHistory[systemID] = append(sm.errorHistory[systemID], classifiedErr)

	// Update health status
	health.LastError = err.Error()
	health.LastErrorTime = time.Now()
	health.ConsecutiveFails++

	switch class {
	case ErrorClassTransient:
		if health.ConsecutiveFails >= sm.config.MaxConsecutiveFails {
			health.Status = HealthDegraded
			logger.Warnf("System %s degraded after %d consecutive transient failures: %s",
				systemID, health.ConsecutiveFails, err.Error())
		}
	case ErrorClassPermanent:
		health.Status = HealthUnhealthy
		logger.Warnf("System %s unhealthy due to permanent error: %s", systemID, err.Error())
	case ErrorClassCritical:
		health.Status = HealthUnhealthy
		logger.Errorf("System %s critical failure: %s", systemID, err.Error())
	}

	// Evaluate mode transition
	sm.evaluateModeTransition()
}

// ReportSuccess reports a successful operation from a subsystem.
func (sm *SafeStateManager) ReportSuccess(systemID SystemID) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[systemID]
	if !exists {
		return
	}

	health.ConsecutiveFails = 0
	health.LastError = ""
	health.LastErrorTime = time.Time{}

	if health.Status != HealthHealthy {
		health.Status = HealthHealthy
		health.LastCheckTime = time.Now()
		logger.Infof("System %s recovered to healthy", systemID)
		sm.evaluateModeTransition()
	}
}

// ─── Mode Transition ────────────────────────────────────────────────────────

// evaluateModeTransition evaluates whether the vault mode should change.
// Must be called with the lock held.
func (sm *SafeStateManager) evaluateModeTransition() {
	switch sm.currentMode {
	case ModeNormal:
		// Check if any critical system is unhealthy
		for id, health := range sm.systemHealth {
			if health.IsCritical && health.Status == HealthUnhealthy {
				sm.transitionTo(ModeSafeState, fmt.Sprintf("Critical system %s is unhealthy: %s", id, health.LastError), id)
				return
			}
			if health.IsCritical && health.Status == HealthDegraded && health.ConsecutiveFails >= sm.config.MaxConsecutiveFails {
				sm.transitionTo(ModeSafeState, fmt.Sprintf("Critical system %s degraded after %d failures: %s", id, health.ConsecutiveFails, health.LastError), id)
				return
			}
		}

	case ModeSafeState:
		// Check if all critical systems are healthy
		allHealthy := true
		for id, health := range sm.systemHealth {
			if health.IsCritical && health.Status != HealthHealthy {
				allHealthy = false
				logger.Debugf("System %s not yet healthy (status=%s), cannot exit safe state", id, health.Status)
				break
			}
		}

		if allHealthy {
			if !sm.isRecovering {
				sm.isRecovering = true
				sm.recoveryStartTime = time.Now()
				logger.Infof("All systems healthy, starting recovery window (min duration: %s)", sm.config.MinRecoveryDuration)
			}

			if time.Since(sm.recoveryStartTime) >= sm.config.MinRecoveryDuration {
				sm.transitionTo(ModeNormal, "All critical systems healthy for recovery window", "")
				sm.isRecovering = false
			}
		} else {
			sm.isRecovering = false
		}

	case ModeEmergency:
		// Emergency mode can only be exited by explicit admin action
	}
}

// transitionTo transitions the vault to a new mode.
// Must be called with the lock held.
func (sm *SafeStateManager) transitionTo(newMode VaultMode, reason string, triggeredBy SystemID) {
	oldMode := sm.currentMode
	if oldMode == newMode {
		return
	}

	transition := SafeStateTransition{
		FromMode:    oldMode,
		ToMode:      newMode,
		Reason:      reason,
		TriggeredBy: triggeredBy,
		Timestamp:   time.Now(),
	}

	sm.transitions = append(sm.transitions, transition)
	sm.currentMode = newMode

	logger.Infof("Vault mode transition: %s -> %s (reason: %s, triggered by: %s)",
		oldMode, newMode, reason, triggeredBy)

	// Fire callbacks
	switch newMode {
	case ModeSafeState:
		if sm.onEnterSafeState != nil {
			sm.onEnterSafeState(reason)
		}
	case ModeNormal:
		if oldMode == ModeSafeState && sm.onExitSafeState != nil {
			sm.onExitSafeState()
		}
		if oldMode == ModeEmergency && sm.onExitEmergency != nil {
			sm.onExitEmergency()
		}
	case ModeEmergency:
		if sm.onEnterEmergency != nil {
			sm.onEnterEmergency(reason)
		}
	}
}

// ─── Manual Mode Control ────────────────────────────────────────────────────

// EnterSafeState manually enters safe state.
func (sm *SafeStateManager) EnterSafeState(reason string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.currentMode == ModeSafeState {
		return
	}

	sm.transitionTo(ModeSafeState, reason, "")
}

// ExitSafeState manually exits safe state.
func (sm *SafeStateManager) ExitSafeState() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.currentMode != ModeSafeState {
		return fmt.Errorf("not in safe state (current mode: %s)", sm.currentMode)
	}

	for id, health := range sm.systemHealth {
		if health.IsCritical && health.Status != HealthHealthy {
			return fmt.Errorf("cannot exit safe state: system %s is still %s", id, health.Status)
		}
	}

	sm.transitionTo(ModeNormal, "Manual exit from safe state — all systems healthy", "")
	sm.isRecovering = false
	return nil
}

// EnterEmergency manually enters emergency mode.
func (sm *SafeStateManager) EnterEmergency(reason string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.currentMode == ModeEmergency {
		return
	}

	sm.transitionTo(ModeEmergency, reason, "")
}

// ExitEmergency manually exits emergency mode.
func (sm *SafeStateManager) ExitEmergency() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.currentMode != ModeEmergency {
		return fmt.Errorf("not in emergency mode (current mode: %s)", sm.currentMode)
	}

	for id, health := range sm.systemHealth {
		if health.IsCritical && health.Status != HealthHealthy {
			sm.transitionTo(ModeSafeState, "Exiting emergency mode but systems not yet healthy", id)
			return nil
		}
	}

	sm.transitionTo(ModeNormal, "Manual exit from emergency mode — all systems healthy", "")
	return nil
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

// OnEnterSafeState registers a callback for entering safe state.
func (sm *SafeStateManager) OnEnterSafeState(callback func(reason string)) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.onEnterSafeState = callback
}

// OnExitSafeState registers a callback for exiting safe state.
func (sm *SafeStateManager) OnExitSafeState(callback func()) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.onExitSafeState = callback
}

// OnEnterEmergency registers a callback for entering emergency mode.
func (sm *SafeStateManager) OnEnterEmergency(callback func(reason string)) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.onEnterEmergency = callback
}

// OnExitEmergency registers a callback for exiting emergency mode.
func (sm *SafeStateManager) OnExitEmergency(callback func()) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.onExitEmergency = callback
}

// ─── Query Methods ──────────────────────────────────────────────────────────

// GetSystemHealth returns the health of a specific subsystem.
func (sm *SafeStateManager) GetSystemHealth(systemID SystemID) *SystemHealth {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	health, exists := sm.systemHealth[systemID]
	if !exists {
		return nil
	}
	cp := *health
	return &cp
}

// GetAllSystemHealth returns the health of all subsystems.
func (sm *SafeStateManager) GetAllSystemHealth() map[SystemID]SystemHealth {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make(map[SystemID]SystemHealth)
	for id, health := range sm.systemHealth {
		result[id] = *health
	}
	return result
}

// GetTransitionHistory returns the history of mode transitions.
func (sm *SafeStateManager) GetTransitionHistory(limit int) []SafeStateTransition {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if limit <= 0 || limit > len(sm.transitions) {
		limit = len(sm.transitions)
	}

	result := make([]SafeStateTransition, limit)
	copy(result, sm.transitions[len(sm.transitions)-limit:])
	return result
}

// GetErrorHistory returns the error history for a subsystem.
func (sm *SafeStateManager) GetErrorHistory(systemID SystemID, limit int) []ClassifiedError {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	errs := sm.errorHistory[systemID]
	if limit <= 0 || limit > len(errs) {
		limit = len(errs)
	}

	result := make([]ClassifiedError, limit)
	copy(result, errs[len(errs)-limit:])
	return result
}

// GetUnhealthySystems returns the list of unhealthy subsystems.
func (sm *SafeStateManager) GetUnhealthySystems() []SystemID {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	var unhealthy []SystemID
	for id, health := range sm.systemHealth {
		if health.Status == HealthUnhealthy || health.Status == HealthDegraded {
			unhealthy = append(unhealthy, id)
		}
	}
	return unhealthy
}

// GetCriticalFailures returns the list of critical subsystem failures.
func (sm *SafeStateManager) GetCriticalFailures() []SystemID {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	var failures []SystemID
	for id, health := range sm.systemHealth {
		if health.IsCritical && health.Status == HealthUnhealthy {
			failures = append(failures, id)
		}
	}
	return failures
}

// GetSafeStateSummary returns a summary of the safe state.
func (sm *SafeStateManager) GetSafeStateSummary() SafeStateSummary {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	summary := SafeStateSummary{
		CurrentMode:       sm.currentMode,
		IsRecovering:      sm.isRecovering,
		RecoveryStartTime: sm.recoveryStartTime,
		SystemHealth:      make(map[SystemID]HealthStatus),
		UnhealthySystems:  []SystemID{},
		CriticalFailures:  []SystemID{},
		TransitionCount:   len(sm.transitions),
	}

	for id, health := range sm.systemHealth {
		summary.SystemHealth[id] = health.Status
		if health.Status == HealthUnhealthy || health.Status == HealthDegraded {
			summary.UnhealthySystems = append(summary.UnhealthySystems, id)
		}
		if health.IsCritical && health.Status == HealthUnhealthy {
			summary.CriticalFailures = append(summary.CriticalFailures, id)
		}
	}

	if len(sm.transitions) > 0 {
		lastTransition := sm.transitions[len(sm.transitions)-1]
		summary.LastTransition = &lastTransition
	}

	return summary
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

// RetryConfig holds the retry configuration for an operation.
type RetryConfig struct {
	MaxRetries    int
	BaseDelay     time.Duration
	MaxDelay      time.Duration
	RetryableFunc func(error) bool
}

// DefaultRetryConfig returns the default retry configuration.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:    3,
		BaseDelay:     2 * time.Second,
		MaxDelay:      30 * time.Second,
		RetryableFunc: func(err error) bool { return true },
	}
}

// RetryWithBackoff executes a function with exponential backoff retry.
func RetryWithBackoff(config RetryConfig, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		err := fn()
		if err == nil {
			return nil
		}

		lastErr = err

		if !config.RetryableFunc(err) {
			return fmt.Errorf("non-retryable error: %w", err)
		}

		if attempt < config.MaxRetries {
			delay := config.BaseDelay * time.Duration(1<<uint(attempt))
			if delay > config.MaxDelay {
				delay = config.MaxDelay
			}
			logger.Infof("Retry attempt %d/%d after %s (error: %s)", attempt+1, config.MaxRetries, delay, err.Error())
			time.Sleep(delay)
		}
	}

	return fmt.Errorf("max retries (%d) exceeded: %w", config.MaxRetries, lastErr)
}

// ─── Error Classification ───────────────────────────────────────────────────

// ClassifyError classifies an error based on its type and context.
func ClassifyError(err error, systemID SystemID) ErrorClass {
	if err == nil {
		return ErrorClassTransient
	}

	errMsg := err.Error()

	// Critical errors — immediately enter safe state
	criticalPatterns := []string{
		"insolvent",
		"insolvency",
		"collateral ratio below minimum",
		"vault is insolvent",
		"emergency",
		"critical failure",
		"TEE attestation failed",
		"private key compromised",
	}

	for _, pattern := range criticalPatterns {
		if containsIgnoreCase(errMsg, pattern) {
			return ErrorClassCritical
		}
	}

	// Permanent errors — don't retry
	permanentPatterns := []string{
		"not authorized",
		"not admin",
		"not verifier",
		"contract not found",
		"invalid address",
		"zero address",
		"contract does not exist",
		"execution reverted",
		"insufficient funds",
		"nonce too low",
		"replacement fee too low",
	}

	for _, pattern := range permanentPatterns {
		if containsIgnoreCase(errMsg, pattern) {
			return ErrorClassPermanent
		}
	}

	// System-specific permanent errors
	switch systemID {
	case SystemFDC:
		permanentFDCPatterns := []string{
			"attestation type not supported",
			"invalid attestation request",
		}
		for _, pattern := range permanentFDCPatterns {
			if containsIgnoreCase(errMsg, pattern) {
				return ErrorClassPermanent
			}
		}
	case SystemPMW:
		permanentPMWPatterns := []string{
			"wallet not found",
			"project not found",
			"invalid signature",
		}
		for _, pattern := range permanentPMWPatterns {
			if containsIgnoreCase(errMsg, pattern) {
				return ErrorClassPermanent
			}
		}
	}

	return ErrorClassTransient
}

// ─── Health Check Functions ──────────────────────────────────────────────────

// HealthCheckResult represents the result of a health check.
type HealthCheckResult struct {
	SystemID  SystemID      `json:"systemId"`
	Status    HealthStatus  `json:"status"`
	Message   string        `json:"message,omitempty"`
	Latency   time.Duration `json:"latency,omitempty"`
	CheckedAt time.Time     `json:"checkedAt"`
}

// CheckTEEHealth checks the health of the TEE subsystem.
func (sm *SafeStateManager) CheckTEEHealth() HealthCheckResult {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[SystemTEE]
	if !exists {
		return HealthCheckResult{
			SystemID:  SystemTEE,
			Status:    HealthUnknown,
			Message:   "TEE subsystem not registered",
			CheckedAt: time.Now(),
		}
	}

	return HealthCheckResult{
		SystemID:  SystemTEE,
		Status:    health.Status,
		Message:   fmt.Sprintf("TEE health: %s, consecutive fails: %d", health.Status, health.ConsecutiveFails),
		CheckedAt: time.Now(),
	}
}

// CheckPMWHealth checks the health of the PMW subsystem.
func (sm *SafeStateManager) CheckPMWHealth() HealthCheckResult {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[SystemPMW]
	if !exists {
		return HealthCheckResult{
			SystemID:  SystemPMW,
			Status:    HealthUnknown,
			Message:   "PMW subsystem not registered",
			CheckedAt: time.Now(),
		}
	}

	return HealthCheckResult{
		SystemID:  SystemPMW,
		Status:    health.Status,
		Message:   fmt.Sprintf("PMW health: %s, consecutive fails: %d", health.Status, health.ConsecutiveFails),
		CheckedAt: time.Now(),
	}
}

// CheckFDCCHealth checks the health of the FDC subsystem.
func (sm *SafeStateManager) CheckFDCCHealth() HealthCheckResult {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	health, exists := sm.systemHealth[SystemFDC]
	if !exists {
		return HealthCheckResult{
			SystemID:  SystemFDC,
			Status:    HealthUnknown,
			Message:   "FDC subsystem not registered",
			CheckedAt: time.Now(),
		}
	}

	return HealthCheckResult{
		SystemID:  SystemFDC,
		Status:    health.Status,
		Message:   fmt.Sprintf("FDC health: %s, consecutive fails: %d", health.Status, health.ConsecutiveFails),
		CheckedAt: time.Now(),
	}
}

// ─── Reset ──────────────────────────────────────────────────────────────────

// Reset resets the SafeStateManager state (for testing only).
func (sm *SafeStateManager) Reset() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.currentMode = ModeNormal
	sm.isRecovering = false
	sm.recoveryStartTime = time.Time{}
	sm.transitions = make([]SafeStateTransition, 0)
	sm.errorHistory = make(map[SystemID][]ClassifiedError)

	for _, health := range sm.systemHealth {
		health.Status = HealthUnknown
		health.ConsecutiveFails = 0
		health.LastError = ""
		health.LastErrorTime = time.Time{}
		health.LastCheckTime = time.Time{}
	}
}

// ─── Helper Functions ───────────────────────────────────────────────────────

func containsIgnoreCase(s, substr string) bool {
	sLower := toLower(s)
	substrLower := toLower(substr)
	return contains(sLower, substrLower)
}

func toLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

func contains(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(substr) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
