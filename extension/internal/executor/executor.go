// Package executor implements the ActionExecutor for the Aegis vault system.
//
// Task 12 (Day 12): Build ActionExecutor + Policy Engine (deterministic policy enforcement)
// Per the report's Section 9.3.3:
//
//   Component 3 (Action Executor): the module that translates policy actions
//   into PMW instructions and submits them via the InstructionSender.
//
// Per the report's Section 9.4.1:
//
//   ActionExecutor (issues PMW instructions)
//
// Per the report's Section 9.4.2 (Sequence diagram — risk rebalance flow):
//
//   RiskAgent → propose action (move FXRP to XRPL) → InstructionSender
//   → policy check (on-chain) → instruction → PMW → sign & submit → XRPL
//
// The ActionExecutor is the execution layer that translates validated policy
// actions into PMW instructions. It enforces policy constraints BEFORE executing
// any action, ensuring the agent cannot exceed limits.
//
// Key Design Decisions:
//  1. All actions are validated against the PolicyEngine before execution
//  2. The ActionExecutor implements the PMWExecutor interface from the RiskAgent
//  3. Amounts are capped to policy limits (not blocked) for rebalance/hedge/deleverage
//  4. Emergency exit is always allowed (safety override)
//  5. All actions are tracked in a history for auditability
//  6. The ActionExecutor is deterministic given the same inputs
package executor

import (
        "encoding/json"
        "fmt"
        "math/big"
        "sync"
        "time"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
        teetypes "github.com/flare-foundation/tee-node/pkg/types"

        "extension-scaffold/internal/policy"
)

// ─── Configuration ──────────────────────────────────────────────────────────

// PMWConfig holds the configuration for the PMW system.
type PMWConfig struct {
        FCCDiamondAddress string `json:"fccDiamondAddress"`
        PlatformID        string `json:"platformId"`
        KeyTypeXRP        string `json:"keyTypeXrp"`
        SigningAlgoXRPL   string `json:"signingAlgoXrpl"`
}

// DefaultPMWConfig returns the default PMW configuration for Coston2.
func DefaultPMWConfig() PMWConfig {
        return PMWConfig{
                FCCDiamondAddress: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
                PlatformID:        "TEST_PLATFORM",
                KeyTypeXRP:        "XRP",
                SigningAlgoXRPL:   "sha512half-secp256k1-ecdsa",
        }
}

// ─── Data Types ─────────────────────────────────────────────────────────────

// PMWResult is the result of a PMW execution.
type PMWResult struct {
        Success     bool   `json:"success"`
        TxHash      string `json:"txHash,omitempty"`
        Amount      string `json:"amount,omitempty"`
        Destination string `json:"destination,omitempty"`
        Error       string `json:"error,omitempty"`
}

// WalletProject represents a PMW wallet project.
type WalletProject struct {
        ProjectID   string `json:"projectId"`
        ExtensionID uint64 `json:"extensionId"`
        KeyType     string `json:"keyType"`
        SigningAlgo string `json:"signingAlgo"`
        Owner       string `json:"owner"`
        Status      string `json:"status"`
}

// PMWWallet represents a PMW wallet.
type PMWWallet struct {
        WalletID  string `json:"walletId"`
        ProjectID string `json:"projectId"`
        Status    string `json:"walletStatus"`
        PublicKey string `json:"publicKey,omitempty"`
}

// XRPLInstruction represents an instruction to be executed on XRPL.
type XRPLInstruction struct {
        WalletID    string `json:"walletId"`
        Destination string `json:"destination"`
        Amount      string `json:"amount"`
        Currency    string `json:"currency"`
        Memo        string `json:"memo,omitempty"`
}

// InstructionType represents the type of PMW instruction.
type InstructionType int

const (
        InstructionRebalance InstructionType = iota
        InstructionHedge
        InstructionDeleverage
        InstructionEmergencyExit
)

// InstructionStatus represents the status of an instruction.
type InstructionStatus string

const (
        StatusPending   InstructionStatus = "PENDING"
        StatusSubmitted InstructionStatus = "SUBMITTED"
        StatusConfirmed InstructionStatus = "CONFIRMED"
        StatusFailed    InstructionStatus = "FAILED"
        StatusCancelled InstructionStatus = "CANCELLED"
)

// ExecutedInstruction represents a tracked instruction with full lifecycle.
type ExecutedInstruction struct {
        InstructionID   string            `json:"instructionId"`
        Type            InstructionType   `json:"type"`
        OriginalAmount  *big.Int          `json:"originalAmount"`
        ExecutedAmount  *big.Int          `json:"executedAmount"`
        WasCapped       bool              `json:"wasCapped"`
        PolicyID        uint64            `json:"policyId"`
        PolicyName      string            `json:"policyName"`
        Status          InstructionStatus `json:"status"`
        TxHash          string            `json:"txHash,omitempty"`
        Destination     string            `json:"destination,omitempty"`
        CreatedAt       time.Time         `json:"createdAt"`
        ConfirmedAt     *time.Time        `json:"confirmedAt,omitempty"`
        Reason          string            `json:"reason,omitempty"`
}

// ─── Policy Checker Interface ───────────────────────────────────────────────

// PolicyChecker validates actions against policy constraints.
// The ActionExecutor uses this interface to enforce policy before execution.
type PolicyChecker interface {
        ValidateAction(depositor string, actionType policy.ActionType, amount *big.Int, ctx *policy.PositionContext) *policy.ActionValidationResult
}

// ─── ActionExecutor ─────────────────────────────────────────────────────────

// ActionExecutor handles PMW-mediated cross-chain execution with deterministic
// policy enforcement.
//
// Per the report's Section 9.3.3: "The Action Executor translates policy actions
// into PMW instructions and submits them via the InstructionSender."
//
// The ActionExecutor enforces policy constraints BEFORE executing any action.
// This ensures the agent cannot exceed limits — even if the agent's risk model
// produces an erroneous instruction, the ActionExecutor will cap or block it.
type ActionExecutor struct {
        mu       sync.RWMutex
        config   PMWConfig
        policy   PolicyChecker
        projects map[string]*WalletProject
        wallets  map[string]*PMWWallet

        // Instruction tracking
        instructions   []*ExecutedInstruction
        instructionSeq uint64

        // Execution statistics
        totalExecutions   uint64
        blockedExecutions uint64
        cappedExecutions  uint64
        successExecutions uint64
        failedExecutions  uint64

        // Default depositor for the Aegis vault
        defaultDepositor string
}

// NewActionExecutor creates a new ActionExecutor with the given configuration.
func NewActionExecutor(config PMWConfig) *ActionExecutor {
        return &ActionExecutor{
                config:       config,
                projects:     make(map[string]*WalletProject),
                wallets:      make(map[string]*PMWWallet),
                instructions: make([]*ExecutedInstruction, 0),
        }
}

// SetPolicyChecker sets the policy checker for deterministic enforcement.
// This is the critical wiring that ensures the agent cannot exceed limits.
func (ae *ActionExecutor) SetPolicyChecker(checker PolicyChecker) {
        ae.mu.Lock()
        defer ae.mu.Unlock()
        ae.policy = checker
}

// SetDefaultDepositor sets the default depositor address for policy validation.
func (ae *ActionExecutor) SetDefaultDepositor(depositor string) {
        ae.mu.Lock()
        defer ae.mu.Unlock()
        ae.defaultDepositor = depositor
}

// ─── PMWExecutor Interface Implementation ───────────────────────────────────

// ExecuteRebalance executes a rebalance action with policy enforcement.
// Per the report's Section 9.3.3: "The Action Executor translates policy actions
// into PMW instructions and submits them via the InstructionSender."
//
// The rebalance amount is validated against the policy before execution.
// If the amount exceeds the policy cap, it is capped (not blocked).
func (ae *ActionExecutor) ExecuteRebalance(amount *big.Int, destination string) (*PMWResult, error) {
        return ae.executeWithPolicy(policy.ActionTypeRebalance, amount, destination, "rebalance")
}

// ExecuteHedge executes a hedge action with policy enforcement.
// The hedge amount is validated against the policy before execution.
// If the risk score is below the hedge threshold, the action is blocked.
func (ae *ActionExecutor) ExecuteHedge(amount *big.Int) (*PMWResult, error) {
        return ae.executeWithPolicy(policy.ActionTypeHedge, amount, "", "hedge")
}

// ExecuteDeleverage executes a deleverage action with policy enforcement.
// The deleverage amount is validated against the policy before execution.
// If the amount exceeds the policy cap, it is capped (not blocked).
func (ae *ActionExecutor) ExecuteDeleverage(amount *big.Int) (*PMWResult, error) {
        return ae.executeWithPolicy(policy.ActionTypeDeleverage, amount, "", "deleverage")
}

// ExecuteEmergencyExit executes an emergency exit — always allowed.
// Per the report's Section 9.3.12: "If the TEE fails or becomes unavailable,
// the vault enters a safe state... the user can withdraw their deposited assets
// via an emergency exit path that does not depend on the TEE."
func (ae *ActionExecutor) ExecuteEmergencyExit() (*PMWResult, error) {
        ae.mu.Lock()
        ae.totalExecutions++
        ae.mu.Unlock()

        // Emergency exit is always allowed — no policy check needed
        result := &PMWResult{
                Success:     true,
                TxHash:      fmt.Sprintf("0xemergency_%d", time.Now().UnixNano()),
                Destination: "emergency_exit",
        }

        ae.mu.Lock()
        ae.successExecutions++
        ae.mu.Unlock()

        logger.Infof("[ActionExecutor] Emergency exit executed: txHash=%s", result.TxHash)
        return result, nil
}

// IsAvailable returns whether the ActionExecutor is available for execution.
func (ae *ActionExecutor) IsAvailable() bool {
        return true
}

// ─── Core Execution with Policy Enforcement ─────────────────────────────────

// executeWithPolicy is the core method that validates an action against policy
// before executing it. This is the critical safety layer.
//
// Per the report's Section 9.3.12: "If the AI agent emits an erroneous
// instruction, the Policy Engine's deterministic constraints prevent the
// instruction from violating the on-chain policy parameters."
func (ae *ActionExecutor) executeWithPolicy(actionType policy.ActionType, amount *big.Int, destination string, actionName string) (*PMWResult, error) {
        ae.mu.Lock()
        ae.totalExecutions++
        ae.mu.Unlock()

        // Validate against policy if a policy checker is configured
        if ae.policy != nil {
                depositor := ae.defaultDepositor
                if depositor == "" {
                        depositor = "aegis-vault"
                }

                // Build position context for policy validation
                // In production, this would be read from the PositionComputer
                ctx := ae.buildPositionContext()

                validation := ae.policy.ValidateAction(depositor, actionType, amount, ctx)
                if !validation.IsValid {
                        ae.mu.Lock()
                        ae.blockedExecutions++
                        ae.mu.Unlock()
                        logger.Warnf("[ActionExecutor] %s blocked by policy: %s", actionName, validation.Reason)
                        return nil, fmt.Errorf("policy blocked %s: %s", actionName, validation.Reason)
                }

                // Use the policy-adjusted amount (may be capped)
                if validation.WasCapped {
                        ae.mu.Lock()
                        ae.cappedExecutions++
                        ae.mu.Unlock()
                        logger.Infof("[ActionExecutor] %s amount capped: %s -> %s (policy: %s)",
                                actionName, amount.String(), validation.AdjustedAmount.String(), validation.Reason)
                        amount = validation.AdjustedAmount
                }
        }

        // Execute the instruction
        instruction := ae.createInstruction(policyActionToInstruction(actionType), amount, destination)

        // In production, this would submit to PMW via the InstructionSender contract
        // For now, we track the instruction and return a mock result
        result := &PMWResult{
                Success:     true,
                TxHash:      fmt.Sprintf("0x%s_%d", actionName, time.Now().UnixNano()),
                Amount:      amount.String(),
                Destination: destination,
        }

        instruction.Status = StatusConfirmed
        instruction.TxHash = result.TxHash
        now := time.Now()
        instruction.ConfirmedAt = &now

        ae.mu.Lock()
        ae.instructions = append(ae.instructions, instruction)
        ae.successExecutions++
        ae.mu.Unlock()

        logger.Infof("[ActionExecutor] %s executed: amount=%s, txHash=%s, destination=%s",
                actionName, amount.String(), result.TxHash, destination)

        return result, nil
}

// ─── Wallet Management ──────────────────────────────────────────────────────

// CreateWalletProject creates a new wallet project for XRPL wallets.
func (ae *ActionExecutor) CreateWalletProject(extensionID uint64) (*WalletProject, error) {
        projectID := fmt.Sprintf("aegis-xrpl-project-%d", extensionID)

        project := &WalletProject{
                ProjectID:   projectID,
                ExtensionID: extensionID,
                KeyType:     ae.config.KeyTypeXRP,
                SigningAlgo: ae.config.SigningAlgoXRPL,
                Status:      "created",
        }

        ae.mu.Lock()
        ae.projects[projectID] = project
        ae.mu.Unlock()

        logger.Infof("Created wallet project: %s (extension: %d, keyType: %s)", projectID, extensionID, ae.config.KeyTypeXRP)

        return project, nil
}

// CreateWallet creates a new wallet within a project.
func (ae *ActionExecutor) CreateWallet(projectID string) (*PMWWallet, error) {
        ae.mu.RLock()
        project, exists := ae.projects[projectID]
        ae.mu.RUnlock()

        if !exists {
                return nil, fmt.Errorf("project not found: %s", projectID)
        }

        ae.mu.Lock()
        walletID := fmt.Sprintf("wallet-%s-%d", projectID, len(ae.wallets))
        wallet := &PMWWallet{
                WalletID:  walletID,
                ProjectID: project.ProjectID,
                Status:    "initializing",
        }
        ae.wallets[walletID] = wallet
        ae.mu.Unlock()

        logger.Infof("Created wallet: %s (project: %s)", walletID, projectID)

        return wallet, nil
}

// EnableWallet enables a wallet for signing.
func (ae *ActionExecutor) EnableWallet(walletID string) error {
        ae.mu.Lock()
        defer ae.mu.Unlock()

        wallet, exists := ae.wallets[walletID]
        if !exists {
                return fmt.Errorf("wallet not found: %s", walletID)
        }

        wallet.Status = "enabled"
        logger.Infof("Enabled wallet: %s", walletID)

        return nil
}

// ExecuteXRPLInstruction sends an instruction to be executed on XRPL via PMW.
func (ae *ActionExecutor) ExecuteXRPLInstruction(instruction XRPLInstruction) (*teetypes.ActionResult, error) {
        ae.mu.RLock()
        wallet, exists := ae.wallets[instruction.WalletID]
        ae.mu.RUnlock()

        if !exists {
                return nil, fmt.Errorf("wallet not found: %s", instruction.WalletID)
        }

        if wallet.Status != "enabled" {
                return nil, fmt.Errorf("wallet not enabled: %s (status: %s)", instruction.WalletID, wallet.Status)
        }

        logger.Infof("Executing XRPL instruction: wallet=%s, dest=%s, amount=%s, currency=%s",
                instruction.WalletID, instruction.Destination, instruction.Amount, instruction.Currency)

        result := &teetypes.ActionResult{
                Log: fmt.Sprintf("XRPL instruction executed: %s -> %s (%s %s)",
                        instruction.WalletID, instruction.Destination, instruction.Amount, instruction.Currency),
        }

        return result, nil
}

// ─── Helper Methods ─────────────────────────────────────────────────────────

// policyActionToInstruction converts a policy.ActionType to an InstructionType.
func policyActionToInstruction(actionType policy.ActionType) InstructionType {
        switch actionType {
        case policy.ActionTypeRebalance:
                return InstructionRebalance
        case policy.ActionTypeHedge:
                return InstructionHedge
        case policy.ActionTypeDeleverage:
                return InstructionDeleverage
        case policy.ActionTypeEmergencyExit:
                return InstructionEmergencyExit
        default:
                return InstructionRebalance
        }
}

// createInstruction creates a tracked instruction for the given action.
func (ae *ActionExecutor) createInstruction(instrType InstructionType, amount *big.Int, destination string) *ExecutedInstruction {
        ae.mu.Lock()
        ae.instructionSeq++
        seq := ae.instructionSeq
        ae.mu.Unlock()

        typeName := "unknown"
        switch instrType {
        case InstructionRebalance:
                typeName = "rebalance"
        case InstructionHedge:
                typeName = "hedge"
        case InstructionDeleverage:
                typeName = "deleverage"
        case InstructionEmergencyExit:
                typeName = "emergency_exit"
        }

        return &ExecutedInstruction{
                InstructionID:  fmt.Sprintf("instr-%s-%d", typeName, seq),
                Type:           instrType,
                OriginalAmount: amount,
                ExecutedAmount: amount,
                Status:         StatusPending,
                Destination:    destination,
                CreatedAt:      time.Now(),
        }
}

// buildPositionContext builds a PositionContext for policy validation.
// In production, this would read from the PositionComputer module.
func (ae *ActionExecutor) buildPositionContext() *policy.PositionContext {
        // Default context — in production, this would be read from the PositionComputer
        return &policy.PositionContext{
                TotalVaultValue:     big.NewInt(1_000_000_000), // 1,000 XRP
                TotalExposure:       big.NewInt(700_000_000),   // 700 XRP
                SingleAssetExposure: big.NewInt(400_000_000),   // 400 XRP
                CollateralRatioBps:  18000,                      // 180%
                CurrentDrawdownBps:  500,                        // 5%
                CurrentLeverageBps:  10000,                      // 1x
                OpenHedgeCount:      0,
                ActivePositions:     3,
                RiskScore:           55.0,                       // Medium risk
        }
}

// ─── Query Methods ──────────────────────────────────────────────────────────

// GetWalletProject returns a wallet project by ID.
func (ae *ActionExecutor) GetWalletProject(projectID string) (*WalletProject, error) {
        ae.mu.RLock()
        defer ae.mu.RUnlock()
        project, exists := ae.projects[projectID]
        if !exists {
                return nil, fmt.Errorf("project not found: %s", projectID)
        }
        return project, nil
}

// GetWallet returns a wallet by ID.
func (ae *ActionExecutor) GetWallet(walletID string) (*PMWWallet, error) {
        ae.mu.RLock()
        defer ae.mu.RUnlock()
        wallet, exists := ae.wallets[walletID]
        if !exists {
                return nil, fmt.Errorf("wallet not found: %s", walletID)
        }
        return wallet, nil
}

// ListProjects returns all wallet projects.
func (ae *ActionExecutor) ListProjects() []*WalletProject {
        ae.mu.RLock()
        defer ae.mu.RUnlock()
        projects := make([]*WalletProject, 0, len(ae.projects))
        for _, p := range ae.projects {
                projects = append(projects, p)
        }
        return projects
}

// ListWallets returns all wallets.
func (ae *ActionExecutor) ListWallets() []*PMWWallet {
        ae.mu.RLock()
        defer ae.mu.RUnlock()
        wallets := make([]*PMWWallet, 0, len(ae.wallets))
        for _, w := range ae.wallets {
                wallets = append(wallets, w)
        }
        return wallets
}

// GetInstructions returns all executed instructions.
func (ae *ActionExecutor) GetInstructions(limit int) []*ExecutedInstruction {
        ae.mu.RLock()
        defer ae.mu.RUnlock()

        if limit <= 0 || limit > len(ae.instructions) {
                limit = len(ae.instructions)
        }

        result := make([]*ExecutedInstruction, limit)
        copy(result, ae.instructions[len(ae.instructions)-limit:])

        return result
}

// GetExecutionStats returns execution statistics.
func (ae *ActionExecutor) GetExecutionStats() (total, blocked, capped, success, failed uint64) {
        ae.mu.RLock()
        defer ae.mu.RUnlock()
        return ae.totalExecutions, ae.blockedExecutions, ae.cappedExecutions, ae.successExecutions, ae.failedExecutions
}

// ValidatePMW validates that PMW is available and configured correctly.
func (ae *ActionExecutor) ValidatePMW() error {
        if ae.config.FCCDiamondAddress == "" {
                return fmt.Errorf("FCC diamond address not configured")
        }
        if ae.config.KeyTypeXRP == "" {
                return fmt.Errorf("XRP key type not configured")
        }
        if ae.config.SigningAlgoXRPL == "" {
                return fmt.Errorf("XRPL signing algorithm not configured")
        }

        logger.Infof("PMW validation passed: FCC diamond=%s, keyType=%s, signingAlgo=%s",
                ae.config.FCCDiamondAddress, ae.config.KeyTypeXRP, ae.config.SigningAlgoXRPL)

        return nil
}

// ─── JSON Serialization ─────────────────────────────────────────────────────

// MarshalJSON implements custom JSON marshaling for ActionExecutor.
func (ae *ActionExecutor) MarshalJSON() ([]byte, error) {
        ae.mu.RLock()
        defer ae.mu.RUnlock()

        return json.Marshal(map[string]interface{}{
                "config":           ae.config,
                "projects":         ae.projects,
                "wallets":          ae.wallets,
                "totalExecutions":  ae.totalExecutions,
                "blockedExecutions": ae.blockedExecutions,
                "cappedExecutions": ae.cappedExecutions,
                "successExecutions": ae.successExecutions,
                "failedExecutions":  ae.failedExecutions,
        })
}
