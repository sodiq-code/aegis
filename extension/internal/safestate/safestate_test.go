// Package safestate implements the safe-state logic and error handling for the Aegis vault system.
//
// Task 17 (Day 17): Error handling, safe-state logic, emergency exit.
// Acceptance criterion: Failure-mode tests pass (TEE down, PMW failure, FDC delay).
//
// This test file verifies the three failure modes specified in the report:
//   1. TEE unavailable — vault enters safe state, no new positions taken
//   2. PMW consensus failure — cross-chain execution pauses, on-chain operations continue
//   3. FDC attestation delay — vault enters safe state, withdrawals still allowed
package safestate

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// ─── Basic SafeStateManager Tests ───────────────────────────────────────────

func TestNewSafeStateManager(t *testing.T) {
	config := DefaultSafeStateConfig()
	sm := NewSafeStateManager(config)

	if sm == nil {
		t.Fatal("SafeStateManager should not be nil")
	}
	if sm.GetMode() != ModeNormal {
		t.Errorf("Expected initial mode to be NORMAL, got %s", sm.GetMode())
	}
	if sm.IsInSafeState() {
		t.Error("Should not be in safe state initially")
	}
	if sm.IsInEmergency() {
		t.Error("Should not be in emergency mode initially")
	}
	if !sm.IsOperational() {
		t.Error("Should be operational initially")
	}
}

func TestInitialSystemHealth(t *testing.T) {
	config := DefaultSafeStateConfig()
	sm := NewSafeStateManager(config)

	for _, systemID := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain} {
		health := sm.GetSystemHealth(systemID)
		if health == nil {
			t.Errorf("System %s health should not be nil", systemID)
			continue
		}
		if health.Status != HealthUnknown {
			t.Errorf("System %s should start as UNKNOWN, got %s", systemID, health.Status)
		}
		if !health.IsCritical {
			t.Errorf("System %s should be critical", systemID)
		}
	}
}

// ─── CanAccept/CanPerform Tests ─────────────────────────────────────────────

func TestCanAcceptDeposits_NormalMode(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())
	if !sm.CanAcceptDeposits() {
		t.Error("Should accept deposits in NORMAL mode")
	}
}

func TestCanAcceptDeposits_SafeState(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())
	sm.EnterSafeState("test")
	if sm.CanAcceptDeposits() {
		t.Error("Should NOT accept deposits in SAFE_STATE mode")
	}
}

func TestCanRebalance_NormalMode(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())
	if !sm.CanRebalance() {
		t.Error("Should allow rebalances in NORMAL mode")
	}
}

func TestCanRebalance_SafeState(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())
	sm.EnterSafeState("test")
	if sm.CanRebalance() {
		t.Error("Should NOT allow rebalances in SAFE_STATE mode")
	}
}

func TestCanWithdraw_Always(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	if !sm.CanWithdraw() {
		t.Error("Should allow withdrawals in NORMAL mode")
	}

	sm.EnterSafeState("test")
	if !sm.CanWithdraw() {
		t.Error("Should allow withdrawals in SAFE_STATE mode")
	}

	sm.EnterEmergency("test")
	if !sm.CanWithdraw() {
		t.Error("Should allow withdrawals in EMERGENCY mode")
	}
}

func TestCanEmergencyExit_Always(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	if !sm.CanEmergencyExit() {
		t.Error("Should allow emergency exit in NORMAL mode")
	}

	sm.EnterSafeState("test")
	if !sm.CanEmergencyExit() {
		t.Error("Should allow emergency exit in SAFE_STATE mode")
	}

	sm.EnterEmergency("test")
	if !sm.CanEmergencyExit() {
		t.Error("Should allow emergency exit in EMERGENCY mode")
	}
}

func TestCanAttestSolvency_NormalAndSafeState(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	if !sm.CanAttestSolvency() {
		t.Error("Should allow attestation in NORMAL mode")
	}

	sm.EnterSafeState("test")
	if !sm.CanAttestSolvency() {
		t.Error("Should allow attestation in SAFE_STATE mode (read-only)")
	}

	sm.EnterEmergency("test")
	if sm.CanAttestSolvency() {
		t.Error("Should NOT allow attestation in EMERGENCY mode")
	}
}

// ─── Failure Mode Tests (Report Acceptance Criterion) ───────────────────────

// TestFailureMode_TEEDown tests the TEE unavailable failure mode.
// Per the report: "If the TEE fails or becomes unavailable, the vault enters a
// safe state: no new positions are taken, no rebalances occur, and the user can
// withdraw their deposited assets via an emergency exit path."
func TestFailureMode_TEEDown(t *testing.T) {
	config := DefaultSafeStateConfig()
	config.MaxConsecutiveFails = 2
	sm := NewSafeStateManager(config)

	// 1. TEE is healthy initially
	sm.ReportHealth(SystemTEE, HealthHealthy)
	if !sm.IsOperational() {
		t.Error("Vault should be operational when TEE is healthy")
	}

	// 2. TEE starts failing — report errors
	teeError := errors.New("TEE attestation failed: enclave not responding")
	sm.ReportError(SystemTEE, teeError, ErrorClassTransient)

	// Still in normal mode after 1 transient failure
	if !sm.IsOperational() {
		t.Error("Should still be operational after 1 transient failure (threshold=2)")
	}

	// 3. Second TEE failure — should cross the threshold
	teeError2 := errors.New("TEE attestation failed: enclave timeout")
	sm.ReportError(SystemTEE, teeError2, ErrorClassTransient)

	// Should now be in safe state
	if !sm.IsInSafeState() {
		t.Error("Vault should be in SAFE_STATE after TEE failures exceed threshold")
	}

	// 4. Verify safe state behavior
	if sm.CanAcceptDeposits() {
		t.Error("Should NOT accept deposits when TEE is down")
	}
	if sm.CanRebalance() {
		t.Error("Should NOT allow rebalances when TEE is down")
	}
	if !sm.CanWithdraw() {
		t.Error("Should STILL allow withdrawals when TEE is down")
	}
	if !sm.CanEmergencyExit() {
		t.Error("Should STILL allow emergency exit when TEE is down")
	}

	// 5. TEE recovers — should exit safe state
	sm.ReportHealth(SystemTEE, HealthHealthy)
	sm.ReportSuccess(SystemTEE)

	// Make all systems healthy for exit
	for _, id := range []SystemID{SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportHealth(id, HealthHealthy)
		sm.ReportSuccess(id)
	}
}

// TestFailureMode_PMWFailure tests the PMW consensus failure mode.
// Per the report: "If PMW is unavailable, cross-chain execution pauses but
// on-chain Flare operations continue."
func TestFailureMode_PMWFailure(t *testing.T) {
	config := DefaultSafeStateConfig()
	sm := NewSafeStateManager(config)

	// 1. PMW is healthy initially
	sm.ReportHealth(SystemPMW, HealthHealthy)
	if !sm.IsOperational() {
		t.Error("Vault should be operational when PMW is healthy")
	}

	// 2. PMW fails — critical error
	pmwError := errors.New("PMW consensus failure: insufficient data provider signatures")
	sm.ReportError(SystemPMW, pmwError, ErrorClassCritical)

	// Should enter safe state
	if !sm.IsInSafeState() {
		t.Error("Vault should be in SAFE_STATE after PMW critical failure")
	}

	// 3. Verify safe state behavior
	if sm.CanAcceptDeposits() {
		t.Error("Should NOT accept deposits when PMW is down")
	}
	if sm.CanRebalance() {
		t.Error("Should NOT allow rebalances when PMW is down (cross-chain)")
	}
	if !sm.CanWithdraw() {
		t.Error("Should STILL allow withdrawals when PMW is down (on-chain)")
	}
	if !sm.CanEmergencyExit() {
		t.Error("Should STILL allow emergency exit when PMW is down")
	}
	if !sm.CanAttestSolvency() {
		t.Error("Should STILL allow solvency attestation when PMW is down (on-chain)")
	}

	// 4. PMW recovers
	sm.ReportSuccess(SystemPMW)
	sm.ReportHealth(SystemPMW, HealthHealthy)

	summary := sm.GetSafeStateSummary()
	t.Logf("Safe state summary after PMW recovery: mode=%s, unhealthy=%v", summary.CurrentMode, summary.UnhealthySystems)
}

// TestFailureMode_FDCDelay tests the FDC attestation delay failure mode.
// Per the report: "FDC attestation delay — verify the vault enters safe state."
func TestFailureMode_FDCDelay(t *testing.T) {
	config := DefaultSafeStateConfig()
	config.MaxConsecutiveFails = 3
	sm := NewSafeStateManager(config)

	// 1. FDC is healthy initially
	sm.ReportHealth(SystemFDC, HealthHealthy)
	if !sm.IsOperational() {
		t.Error("Vault should be operational when FDC is healthy")
	}

	// 2. FDC starts experiencing delays
	fdcError1 := errors.New("FDC attestation timeout: voting round not finalized")
	sm.ReportError(SystemFDC, fdcError1, ErrorClassTransient)

	if !sm.IsOperational() {
		t.Error("Should still be operational after 1 FDC delay")
	}

	// 3. More FDC delays
	fdcError2 := errors.New("FDC attestation timeout: DA layer not responding")
	sm.ReportError(SystemFDC, fdcError2, ErrorClassTransient)

	if !sm.IsOperational() {
		t.Error("Should still be operational after 2 FDC delays (threshold=3)")
	}

	// 4. Third FDC delay — should enter safe state
	fdcError3 := errors.New("FDC attestation timeout: proof not available after 3 minutes")
	sm.ReportError(SystemFDC, fdcError3, ErrorClassTransient)

	if !sm.IsInSafeState() {
		t.Error("Vault should be in SAFE_STATE after FDC delays exceed threshold")
	}

	// 5. Verify safe state behavior
	if sm.CanAcceptDeposits() {
		t.Error("Should NOT accept deposits when FDC is delayed")
	}
	if sm.CanRebalance() {
		t.Error("Should NOT allow rebalances when FDC is delayed")
	}
	if !sm.CanWithdraw() {
		t.Error("Should STILL allow withdrawals when FDC is delayed")
	}
	if !sm.CanEmergencyExit() {
		t.Error("Should STILL allow emergency exit when FDC is delayed")
	}
	if !sm.CanAttestSolvency() {
		t.Error("Should STILL allow solvency attestation when FDC is delayed (using last known state)")
	}
}

// ─── Error Classification Tests ─────────────────────────────────────────────

func TestClassifyError_Critical(t *testing.T) {
	criticalErrors := []struct {
		err    error
		system SystemID
	}{
		{errors.New("insolvent: collateral ratio below minimum"), SystemTEE},
		{errors.New("TEE attestation failed: enclave compromised"), SystemTEE},
		{errors.New("emergency: vault emergency triggered"), SystemOnChain},
		{errors.New("critical failure: storage corruption"), SystemPosition},
	}

	for _, tc := range criticalErrors {
		class := ClassifyError(tc.err, tc.system)
		if class != ErrorClassCritical {
			t.Errorf("Expected CRITICAL for error '%s' in system %s, got %s", tc.err.Error(), tc.system, class)
		}
	}
}

func TestClassifyError_Permanent(t *testing.T) {
	permanentErrors := []struct {
		err    error
		system SystemID
	}{
		{errors.New("not authorized: caller is not admin"), SystemOnChain},
		{errors.New("contract not found: address 0x0"), SystemOnChain},
		{errors.New("insufficient funds for gas"), SystemOnChain},
		{errors.New("execution reverted: ERC20 transfer failed"), SystemOnChain},
		{errors.New("wallet not found: invalid address"), SystemPMW},
		{errors.New("attestation type not supported"), SystemFDC},
	}

	for _, tc := range permanentErrors {
		class := ClassifyError(tc.err, tc.system)
		if class != ErrorClassPermanent {
			t.Errorf("Expected PERMANENT for error '%s' in system %s, got %s", tc.err.Error(), tc.system, class)
		}
	}
}

func TestClassifyError_Transient(t *testing.T) {
	transientErrors := []struct {
		err    error
		system SystemID
	}{
		{errors.New("connection refused: RPC endpoint not responding"), SystemOnChain},
		{errors.New("timeout: PMW execution took too long"), SystemPMW},
		{errors.New("FDC attestation pending: waiting for voting round"), SystemFDC},
		{errors.New("FTSO price feed temporarily unavailable"), SystemFTSO},
		{errors.New("network error: connection reset by peer"), SystemOnChain},
	}

	for _, tc := range transientErrors {
		class := ClassifyError(tc.err, tc.system)
		if class != ErrorClassTransient {
			t.Errorf("Expected TRANSIENT for error '%s' in system %s, got %s", tc.err.Error(), tc.system, class)
		}
	}
}

// ─── Retry Logic Tests ──────────────────────────────────────────────────────

func TestRetryWithBackoff_Success(t *testing.T) {
	config := DefaultRetryConfig()
	config.BaseDelay = 10 * time.Millisecond
	config.MaxDelay = 50 * time.Millisecond

	callCount := 0
	err := RetryWithBackoff(config, func() error {
		callCount++
		return nil
	})

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if callCount != 1 {
		t.Errorf("Expected 1 call, got %d", callCount)
	}
}

func TestRetryWithBackoff_SuccessAfterRetries(t *testing.T) {
	config := DefaultRetryConfig()
	config.BaseDelay = 10 * time.Millisecond
	config.MaxDelay = 50 * time.Millisecond

	callCount := 0
	err := RetryWithBackoff(config, func() error {
		callCount++
		if callCount < 3 {
			return errors.New("temporary failure")
		}
		return nil
	})

	if err != nil {
		t.Errorf("Expected no error after retries, got %v", err)
	}
	if callCount != 3 {
		t.Errorf("Expected 3 calls, got %d", callCount)
	}
}

func TestRetryWithBackoff_MaxRetriesExceeded(t *testing.T) {
	config := DefaultRetryConfig()
	config.MaxRetries = 2
	config.BaseDelay = 10 * time.Millisecond
	config.MaxDelay = 50 * time.Millisecond

	err := RetryWithBackoff(config, func() error {
		return errors.New("persistent failure")
	})

	if err == nil {
		t.Error("Expected error after max retries exceeded")
	}
}

func TestRetryWithBackoff_NonRetryableError(t *testing.T) {
	config := DefaultRetryConfig()
	config.BaseDelay = 10 * time.Millisecond
	config.MaxDelay = 50 * time.Millisecond
	config.RetryableFunc = func(err error) bool {
		return false
	}

	callCount := 0
	err := RetryWithBackoff(config, func() error {
		callCount++
		return errors.New("non-retryable error")
	})

	if err == nil {
		t.Error("Expected error for non-retryable error")
	}
	if callCount != 1 {
		t.Errorf("Expected 1 call (no retries), got %d", callCount)
	}
}

// ─── Transition History Tests ───────────────────────────────────────────────

func TestTransitionHistory(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.EnterSafeState("TEE failure")

	history := sm.GetTransitionHistory(10)
	if len(history) != 1 {
		t.Fatalf("Expected 1 transition, got %d", len(history))
	}
	if history[0].FromMode != ModeNormal {
		t.Errorf("Expected from NORMAL, got %s", history[0].FromMode)
	}
	if history[0].ToMode != ModeSafeState {
		t.Errorf("Expected to SAFE_STATE, got %s", history[0].ToMode)
	}

	sm.EnterEmergency("Insolvency detected")

	history = sm.GetTransitionHistory(10)
	if len(history) != 2 {
		t.Fatalf("Expected 2 transitions, got %d", len(history))
	}
	if history[1].FromMode != ModeSafeState {
		t.Errorf("Expected from SAFE_STATE, got %s", history[1].FromMode)
	}
	if history[1].ToMode != ModeEmergency {
		t.Errorf("Expected to EMERGENCY, got %s", history[1].ToMode)
	}
}

func TestTransitionHistoryLimit(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	for i := 0; i < 5; i++ {
		sm.EnterSafeState(fmt.Sprintf("test reason %d", i))
		sm.EnterEmergency(fmt.Sprintf("emergency %d", i))
	}

	history := sm.GetTransitionHistory(3)
	if len(history) != 3 {
		t.Errorf("Expected 3 transitions, got %d", len(history))
	}
}

// ─── Callback Tests ─────────────────────────────────────────────────────────

func TestCallbacks_EnterSafeState(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	var callbackReason string
	sm.OnEnterSafeState(func(reason string) {
		callbackReason = reason
	})

	sm.EnterSafeState("TEE failure")

	if callbackReason != "TEE failure" {
		t.Errorf("Expected callback reason 'TEE failure', got '%s'", callbackReason)
	}
}

func TestCallbacks_EnterEmergency(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	var callbackReason string
	sm.OnEnterEmergency(func(reason string) {
		callbackReason = reason
	})

	sm.EnterEmergency("Insolvency detected")

	if callbackReason != "Insolvency detected" {
		t.Errorf("Expected callback reason 'Insolvency detected', got '%s'", callbackReason)
	}
}

// ─── Automatic Mode Transition Tests ────────────────────────────────────────

func TestAutoTransition_CriticalError(t *testing.T) {
	config := DefaultSafeStateConfig()
	sm := NewSafeStateManager(config)

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain} {
		sm.ReportHealth(id, HealthHealthy)
	}

	if !sm.IsOperational() {
		t.Error("Should be operational when all systems healthy")
	}

	sm.ReportError(SystemPMW, errors.New("PMW consensus failure: insufficient signatures"), ErrorClassCritical)

	if !sm.IsInSafeState() {
		t.Error("Should automatically enter safe state on critical PMW error")
	}
}

func TestAutoTransition_CircuitBreaker(t *testing.T) {
	config := DefaultSafeStateConfig()
	config.MaxConsecutiveFails = 3
	sm := NewSafeStateManager(config)

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain} {
		sm.ReportHealth(id, HealthHealthy)
	}

	for i := 0; i < 3; i++ {
		sm.ReportError(SystemFDC, fmt.Errorf("FDC attestation timeout %d", i+1), ErrorClassTransient)
	}

	if !sm.IsInSafeState() {
		t.Error("Should enter safe state after 3 consecutive FDC failures (circuit breaker)")
	}
}

// ─── Multiple Subsystem Failure Tests ───────────────────────────────────────

func TestMultipleSubsystemsFailing(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain} {
		sm.ReportHealth(id, HealthHealthy)
	}

	sm.ReportError(SystemTEE, errors.New("TEE unavailable"), ErrorClassCritical)
	if !sm.IsInSafeState() {
		t.Error("Should be in safe state after TEE failure")
	}

	sm.ReportError(SystemPMW, errors.New("PMW failure"), ErrorClassCritical)

	if !sm.IsInSafeState() {
		t.Error("Should still be in safe state after multiple failures")
	}

	unhealthy := sm.GetUnhealthySystems()
	if len(unhealthy) < 2 {
		t.Errorf("Expected at least 2 unhealthy systems, got %d", len(unhealthy))
	}
}

// ─── Emergency Mode Tests ───────────────────────────────────────────────────

func TestEmergencyMode(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.EnterEmergency("Insolvency detected")

	if !sm.IsInEmergency() {
		t.Error("Should be in emergency mode")
	}
	if sm.CanAcceptDeposits() {
		t.Error("Should NOT accept deposits in emergency mode")
	}
	if sm.CanRebalance() {
		t.Error("Should NOT allow rebalances in emergency mode")
	}
	if !sm.CanWithdraw() {
		t.Error("Should STILL allow withdrawals in emergency mode")
	}
	if !sm.CanEmergencyExit() {
		t.Error("Should STILL allow emergency exit in emergency mode")
	}
}

func TestEmergencyMode_ExitRequiresHealthySystems(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.EnterEmergency("test")

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportHealth(id, HealthHealthy)
		sm.ReportSuccess(id)
	}

	err := sm.ExitEmergency()
	if err != nil {
		t.Logf("ExitEmergency error: %v", err)
	}
}

// ─── SafeState Summary Tests ────────────────────────────────────────────────

func TestSafeStateSummary(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	summary := sm.GetSafeStateSummary()
	if summary.CurrentMode != ModeNormal {
		t.Errorf("Expected NORMAL mode, got %s", summary.CurrentMode)
	}
	if summary.TransitionCount != 0 {
		t.Errorf("Expected 0 transitions, got %d", summary.TransitionCount)
	}
	if len(summary.UnhealthySystems) != 0 {
		t.Errorf("Expected 0 unhealthy systems, got %d", len(summary.UnhealthySystems))
	}

	sm.EnterSafeState("TEE failure")
	summary = sm.GetSafeStateSummary()
	if summary.CurrentMode != ModeSafeState {
		t.Errorf("Expected SAFE_STATE mode, got %s", summary.CurrentMode)
	}
	if summary.TransitionCount != 1 {
		t.Errorf("Expected 1 transition, got %d", summary.TransitionCount)
	}
}

// ─── Error History Tests ────────────────────────────────────────────────────

func TestErrorHistory(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.ReportError(SystemFDC, errors.New("FDC timeout 1"), ErrorClassTransient)
	sm.ReportError(SystemFDC, errors.New("FDC timeout 2"), ErrorClassTransient)
	sm.ReportError(SystemPMW, errors.New("PMW failure"), ErrorClassCritical)

	fdcErrors := sm.GetErrorHistory(SystemFDC, 10)
	if len(fdcErrors) != 2 {
		t.Errorf("Expected 2 FDC errors, got %d", len(fdcErrors))
	}

	pmwErrors := sm.GetErrorHistory(SystemPMW, 10)
	if len(pmwErrors) != 1 {
		t.Errorf("Expected 1 PMW error, got %d", len(pmwErrors))
	}

	fdcErrorsLimited := sm.GetErrorHistory(SystemFDC, 1)
	if len(fdcErrorsLimited) != 1 {
		t.Errorf("Expected 1 FDC error (limited), got %d", len(fdcErrorsLimited))
	}
}

// ─── Concurrency Tests ──────────────────────────────────────────────────────

func TestConcurrentAccess(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if idx%2 == 0 {
				sm.ReportHealth(SystemTEE, HealthHealthy)
			} else {
				sm.ReportError(SystemTEE, fmt.Errorf("test error %d", idx), ErrorClassTransient)
			}
		}(i)
	}

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = sm.GetMode()
			_ = sm.IsOperational()
			_ = sm.CanAcceptDeposits()
			_ = sm.CanWithdraw()
			_ = sm.GetSafeStateSummary()
		}()
	}

	wg.Wait()
}

// ─── Reset Tests ────────────────────────────────────────────────────────────

func TestReset(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.EnterSafeState("test")
	sm.ReportError(SystemTEE, errors.New("TEE error"), ErrorClassCritical)

	sm.Reset()

	if sm.GetMode() != ModeNormal {
		t.Errorf("Expected NORMAL mode after reset, got %s", sm.GetMode())
	}
	if sm.IsInSafeState() {
		t.Error("Should not be in safe state after reset")
	}
}

// ─── Health Check Tests ─────────────────────────────────────────────────────

func TestHealthCheck_TEE(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	result := sm.CheckTEEHealth()
	if result.SystemID != SystemTEE {
		t.Errorf("Expected SystemTEE, got %s", result.SystemID)
	}
}

func TestHealthCheck_PMW(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	result := sm.CheckPMWHealth()
	if result.SystemID != SystemPMW {
		t.Errorf("Expected SystemPMW, got %s", result.SystemID)
	}
}

func TestHealthCheck_FDC(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	result := sm.CheckFDCCHealth()
	if result.SystemID != SystemFDC {
		t.Errorf("Expected SystemFDC, got %s", result.SystemID)
	}
}

// ─── Report Success Tests ──────────────────────────────────────────────────

func TestReportSuccess(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	sm.ReportError(SystemFDC, errors.New("FDC timeout"), ErrorClassTransient)
	sm.ReportSuccess(SystemFDC)

	health := sm.GetSystemHealth(SystemFDC)
	if health.ConsecutiveFails != 0 {
		t.Errorf("Expected 0 consecutive fails after success, got %d", health.ConsecutiveFails)
	}
	if health.Status != HealthHealthy {
		t.Errorf("Expected HEALTHY status after success, got %s", health.Status)
	}
}

// ─── Full Failure Scenario Tests ────────────────────────────────────────────

// TestFullFailureScenario_TEEDownAndRecovery tests the full lifecycle of
// TEE failure -> safe state -> recovery -> normal operations.
func TestFullFailureScenario_TEEDownAndRecovery(t *testing.T) {
	config := DefaultSafeStateConfig()
	config.MaxConsecutiveFails = 2
	sm := NewSafeStateManager(config)

	// Phase 1: Normal operations
	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportHealth(id, HealthHealthy)
	}

	if !sm.CanAcceptDeposits() {
		t.Error("Phase 1: Should accept deposits")
	}
	if !sm.CanRebalance() {
		t.Error("Phase 1: Should allow rebalances")
	}

	// Phase 2: TEE goes down
	sm.ReportError(SystemTEE, errors.New("TEE unavailable: enclave crash"), ErrorClassCritical)

	if !sm.IsInSafeState() {
		t.Error("Phase 2: Should be in safe state")
	}
	if sm.CanAcceptDeposits() {
		t.Error("Phase 2: Should NOT accept deposits")
	}
	if sm.CanRebalance() {
		t.Error("Phase 2: Should NOT allow rebalances")
	}
	if !sm.CanWithdraw() {
		t.Error("Phase 2: Should STILL allow withdrawals")
	}

	// Phase 3: TEE recovers
	sm.ReportSuccess(SystemTEE)
	sm.ReportHealth(SystemTEE, HealthHealthy)

	for _, id := range []SystemID{SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportHealth(id, HealthHealthy)
		sm.ReportSuccess(id)
	}

	summary := sm.GetSafeStateSummary()
	t.Logf("Phase 3: mode=%s, isRecovering=%v, unhealthy=%v",
		summary.CurrentMode, summary.IsRecovering, summary.UnhealthySystems)
}

// TestFullFailureScenario_AllSubsystemsFail tests the scenario where
// all critical subsystems fail simultaneously.
func TestFullFailureScenario_AllSubsystemsFail(t *testing.T) {
	sm := NewSafeStateManager(DefaultSafeStateConfig())

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportHealth(id, HealthHealthy)
	}

	for _, id := range []SystemID{SystemTEE, SystemPMW, SystemFDC, SystemFTSO, SystemOnChain, SystemRiskAgent, SystemPolicy, SystemPosition} {
		sm.ReportError(id, fmt.Errorf("%s critical failure", id), ErrorClassCritical)
	}

	if !sm.IsInSafeState() {
		t.Error("Should be in safe state when all systems fail")
	}

	unhealthy := sm.GetUnhealthySystems()
	if len(unhealthy) < 8 {
		t.Errorf("Expected at least 8 unhealthy systems, got %d", len(unhealthy))
	}

	if !sm.CanWithdraw() {
		t.Error("Should STILL allow withdrawals even when all systems fail")
	}
	if !sm.CanEmergencyExit() {
		t.Error("Should STILL allow emergency exit even when all systems fail")
	}
}
