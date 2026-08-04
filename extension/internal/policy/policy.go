// Package policy implements the deterministic Policy Engine for the Aegis vault system.
//
// Build ActionExecutor + Policy Engine (deterministic policy enforcement)
// 
//
// Component 2 (Policy Engine): a deterministic rule engine that maps the risk score
// and current positions to specific policy actions (rebalance, hedge, deleverage)
// within the constraints set by the on-chain PolicyRegistry.
//
// 
//
// If the AI agent emits an erroneous instruction, the Policy Engine's deterministic
// constraints prevent the instruction from violating the on-chain policy parameters.
//
// The Policy Engine is the critical safety layer that ensures the agent cannot exceed
// limits. It is deterministic: given the same inputs (risk score, position state, policy
// parameters), it produces the same outputs. This is essential for verifiability.
//
// Key Design Decisions:
// 1. All policy constraints are enforced deterministically — no randomness or external state
// 2. The agent cannot exceed limits: every action is validated against policy before execution
// 3. Policy parameters match the on-chain PolicyRegistry
// 4. The PolicyEngine implements the PolicyProvider interface from the RiskAgent
// 5. Vault fields: maxDrawdownBps, maxSingleExposureBps, hedgeThresholdBps, allowedAssets
// 6. Three default policies (Conservative/Balanced/Aggressive) match the on-chain PolicyRegistry
package policy

import (
        "encoding/json"
        "fmt"
        "math/big"
        "sync"
        "time"
)

// ─── Enums ─────────────────────────────────────────────────────────────────

// RiskLevel represents the risk level of a policy.
type RiskLevel int

const (
        RiskLevelLow      RiskLevel = iota // Conservative
        RiskLevelMedium                    // Balanced
        RiskLevelHigh                      // Aggressive
        RiskLevelCritical                  // Emergency
)

// PolicyAction represents the action to take when a policy condition is triggered.
type PolicyAction int

const (
        PolicyActionAllow            PolicyAction = iota // Action is allowed
        PolicyActionRequireApproval                       // Action requires additional approval
        PolicyActionDelay                                 // Action is delayed by a time lock
        PolicyActionBlock                                 // Action is blocked
)

// ActionType represents the type of action being validated.
// Extended per the vault specification to include all agent action types.
type ActionType int

const (
        ActionTypeDeposit      ActionType = 0
        ActionTypeWithdraw     ActionType = 1
        ActionTypeRebalance    ActionType = 2
        ActionTypeHedge        ActionType = 3
        ActionTypeDeleverage   ActionType = 4
        ActionTypeEmergencyExit ActionType = 5
)

// ActionTypeNames maps ActionType to human-readable names.
var ActionTypeNames = map[ActionType]string{
        ActionTypeDeposit:      "deposit",
        ActionTypeWithdraw:     "withdraw",
        ActionTypeRebalance:    "rebalance",
        ActionTypeHedge:        "hedge",
        ActionTypeDeleverage:   "deleverage",
        ActionTypeEmergencyExit: "emergency_exit",
}

// ─── Policy Definition ─────────────────────────────────────────────────────

// Policy represents a risk policy definition.
// 
//
// struct Policy {
// uint256 maxDrawdownBps; // e.g., 1500 = 15%
// uint256 maxSingleExposureBps; // e.g., 4000 = 40%
// uint256 hedgeThresholdBps; // e.g., 800 = 8%
// address[] allowedAssets; // whitelist
// }
//
// Extended with additional fields for full policy enforcement.
type Policy struct {
        PolicyID                uint64      `json:"policyId"`
        Owner                   string      `json:"owner"`
        Name                    string      `json:"name"`
        Description             string      `json:"description"`
        RiskLevel               RiskLevel   `json:"riskLevel"`
        IsActive                bool        `json:"isActive"`
        CreatedAt               time.Time   `json:"createdAt"`
        UpdatedAt               time.Time   `json:"updatedAt"`

        // Vault fields
        MaxDrawdownBps          uint64      `json:"maxDrawdownBps"`          // Max drawdown in basis points (e.g., 1500 = 15%)
        MaxSingleExposureBps    uint64      `json:"maxSingleExposureBps"`    // Max single-asset exposure in bps (e.g., 4000 = 40%)
        HedgeThresholdBps       uint64      `json:"hedgeThresholdBps"`       // Risk score threshold for hedging in bps (e.g., 800 = 8%)
        AllowedAssets           []string    `json:"allowedAssets"`           // Whitelist of allowed asset addresses

        // Extended policy fields
        MaxDepositPerTx         *big.Int    `json:"maxDepositPerTx"`
        MaxWithdrawalPerTx      *big.Int    `json:"maxWithdrawalPerTx"`
        MaxTotalExposure        *big.Int    `json:"maxTotalExposure"`
        MaxSinglePositionRatio  uint64      `json:"maxSinglePositionRatio"`  // basis points
        MinCollateralRatio      uint64      `json:"minCollateralRatio"`      // basis points
        MaxLeverage             uint64      `json:"maxLeverage"`             // basis points (10000 = 1x)
        WithdrawalDelaySeconds  uint64      `json:"withdrawalDelaySeconds"`
        RebalanceThresholdBps   uint64      `json:"rebalanceThresholdBps"`   // basis points
        MaxSlippageBps          uint64      `json:"maxSlippageBps"`          // basis points
        MaxRebalanceAmountBps   uint64      `json:"maxRebalanceAmountBps"`   // Max rebalance as % of total vault (bps)
        MaxHedgeAmountBps       uint64      `json:"maxHedgeAmountBps"`       // Max hedge as % of total vault (bps)
        MaxDeleverageAmountBps  uint64      `json:"maxDeleverageAmountBps"`  // Max deleverage as % of total vault (bps)
        OnRiskBreach            PolicyAction `json:"onRiskBreach"`
        OnSolvencyWarning       PolicyAction `json:"onSolvencyWarning"`
}

// ─── Validation Results ─────────────────────────────────────────────────────

// ValidationResult contains the result of a policy validation.
type ValidationResult struct {
        IsValid    bool         `json:"isValid"`
        Action     PolicyAction `json:"action"`
        Reason     string       `json:"reason"`
        PolicyID   uint64       `json:"policyId"`
        PolicyName string       `json:"policyName"`
}

// ActionValidationResult contains the result of validating an agent action.
// This is the result type for ValidateAction, which is the core method
// that ensures the agent cannot exceed limits.
type ActionValidationResult struct {
        IsValid          bool         `json:"isValid"`
        Action           PolicyAction `json:"action"`
        Reason           string       `json:"reason"`
        PolicyID         uint64       `json:"policyId"`
        PolicyName       string       `json:"policyName"`
        AdjustedAmount   *big.Int     `json:"adjustedAmount,omitempty"` // Amount after policy cap enforcement
        OriginalAmount   *big.Int     `json:"originalAmount,omitempty"` // Amount before policy cap enforcement
        WasCapped        bool         `json:"wasCapped"`               // Whether the amount was capped by policy
}

// ─── Position Context ──────────────────────────────────────────────────────

// PositionContext holds the current position state for policy validation.
// This is the context against which agent actions are validated.
type PositionContext struct {
        TotalVaultValue      *big.Int   `json:"totalVaultValue"`      // Total FXRP in vault
        TotalExposure        *big.Int   `json:"totalExposure"`        // Total exposure across all positions
        SingleAssetExposure  *big.Int   `json:"singleAssetExposure"`  // Largest single-asset exposure
        CollateralRatioBps   uint64     `json:"collateralRatioBps"`   // Current collateral ratio in bps
        CurrentDrawdownBps   uint64     `json:"currentDrawdownBps"`   // Current drawdown in bps
        CurrentLeverageBps   uint64     `json:"currentLeverageBps"`   // Current leverage in bps
        OpenHedgeCount       int        `json:"openHedgeCount"`       // Number of open hedge positions
        ActivePositions      int        `json:"activePositions"`      // Number of active positions
        RiskScore            float64    `json:"riskScore"`            // Current risk score from XGBoost model
}

// DefaultPositionContext returns a default position context with zero values.
func DefaultPositionContext() *PositionContext {
        return &PositionContext{
                TotalVaultValue:     big.NewInt(0),
                TotalExposure:       big.NewInt(0),
                SingleAssetExposure: big.NewInt(0),
                CollateralRatioBps:  999999, // Fully solvent
                CurrentDrawdownBps:  0,
                CurrentLeverageBps:  10000, // 1x leverage
        }
}

// ─── Policy Engine ─────────────────────────────────────────────────────────

// PolicyEngine enforces deterministic policy constraints.
//
// The Policy Engine is a deterministic rule engine
// that maps the risk score and current positions to specific policy actions (rebalance,
// hedge, deleverage) within the constraints set by the on-chain PolicyRegistry.
//
// The PolicyEngine is the critical safety layer that ensures the agent cannot exceed
// limits. It is deterministic: given the same inputs, it produces the same outputs.
type PolicyEngine struct {
        mu        sync.RWMutex
        policies  map[uint64]*Policy
        assignees map[string]uint64 // depositor address => policy ID

        // Enforcement statistics
        totalValidations   uint64
        blockedActions     uint64
        cappedActions      uint64
        approvedActions    uint64
}

// NewPolicyEngine creates a new PolicyEngine with deterministic enforcement.
func NewPolicyEngine() *PolicyEngine {
        return &PolicyEngine{
                policies:  make(map[uint64]*Policy),
                assignees: make(map[string]uint64),
        }
}

// ─── Policy CRUD ───────────────────────────────────────────────────────────

// AddPolicy adds a policy to the engine.
func (pe *PolicyEngine) AddPolicy(policy *Policy) error {
        if policy == nil {
                return fmt.Errorf("policy cannot be nil")
        }
        if policy.PolicyID == 0 {
                return fmt.Errorf("policy ID must be non-zero")
        }
        pe.mu.Lock()
        defer pe.mu.Unlock()
        pe.policies[policy.PolicyID] = policy
        return nil
}

// AssignPolicy assigns a policy to a depositor.
func (pe *PolicyEngine) AssignPolicy(depositor string, policyID uint64) error {
        pe.mu.Lock()
        defer pe.mu.Unlock()
        if _, ok := pe.policies[policyID]; !ok {
                return fmt.Errorf("policy %d not found", policyID)
        }
        pe.assignees[depositor] = policyID
        return nil
}

// GetPolicy returns a policy by ID.
func (pe *PolicyEngine) GetPolicy(policyID uint64) (*Policy, error) {
        pe.mu.RLock()
        defer pe.mu.RUnlock()
        policy, ok := pe.policies[policyID]
        if !ok {
                return nil, fmt.Errorf("policy %d not found", policyID)
        }
        return policy, nil
}

// GetPolicyForDepositor returns the policy assigned to a depositor.
func (pe *PolicyEngine) GetPolicyForDepositor(depositor string) (*Policy, error) {
        pe.mu.RLock()
        defer pe.mu.RUnlock()
        policyID, ok := pe.assignees[depositor]
        if !ok {
                return nil, fmt.Errorf("no policy assigned to depositor %s", depositor)
        }
        policy, ok := pe.policies[policyID]
        if !ok {
                return nil, fmt.Errorf("policy %d not found", policyID)
        }
        return policy, nil
}

// ListPolicies returns all policies.
func (pe *PolicyEngine) ListPolicies() []*Policy {
        pe.mu.RLock()
        defer pe.mu.RUnlock()
        policies := make([]*Policy, 0, len(pe.policies))
        for _, p := range pe.policies {
                policies = append(policies, p)
        }
        return policies
}

// ─── Deposit/Withdrawal Validation ─────────────────────────────────────────

// ValidateDeposit validates a deposit against the depositor's policy.
func (pe *PolicyEngine) ValidateDeposit(depositor string, depositAmount *big.Int, currentTotalExposure *big.Int) *ValidationResult {
        policy, err := pe.GetPolicyForDepositor(depositor)
        if err != nil {
                return &ValidationResult{
                        IsValid: false,
                        Action:  PolicyActionBlock,
                        Reason:  fmt.Sprintf("no policy assigned: %v", err),
                }
        }

        if !policy.IsActive {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionBlock,
                        Reason:     "policy is not active",
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        // Check max deposit per transaction
        if depositAmount.Cmp(policy.MaxDepositPerTx) > 0 {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionBlock,
                        Reason:     fmt.Sprintf("deposit %s exceeds max per tx %s", depositAmount.String(), policy.MaxDepositPerTx.String()),
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        // Check max total exposure
        newExposure := new(big.Int).Add(currentTotalExposure, depositAmount)
        if newExposure.Cmp(policy.MaxTotalExposure) > 0 {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionBlock,
                        Reason:     fmt.Sprintf("new total exposure %s exceeds max %s", newExposure.String(), policy.MaxTotalExposure.String()),
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        return &ValidationResult{
                IsValid:    true,
                Action:     PolicyActionAllow,
                Reason:     "deposit validated",
                PolicyID:   policy.PolicyID,
                PolicyName: policy.Name,
        }
}

// ValidateWithdrawal validates a withdrawal against the depositor's policy.
func (pe *PolicyEngine) ValidateWithdrawal(depositor string, withdrawalAmount *big.Int, currentPositionValue *big.Int) *ValidationResult {
        policy, err := pe.GetPolicyForDepositor(depositor)
        if err != nil {
                return &ValidationResult{
                        IsValid: false,
                        Action:  PolicyActionBlock,
                        Reason:  fmt.Sprintf("no policy assigned: %v", err),
                }
        }

        if !policy.IsActive {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionBlock,
                        Reason:     "policy is not active",
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        // Check max withdrawal per transaction
        if withdrawalAmount.Cmp(policy.MaxWithdrawalPerTx) > 0 {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionRequireApproval,
                        Reason:     fmt.Sprintf("withdrawal %s exceeds max per tx %s", withdrawalAmount.String(), policy.MaxWithdrawalPerTx.String()),
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        // Check that withdrawal doesn't exceed position value
        if withdrawalAmount.Cmp(currentPositionValue) > 0 {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     PolicyActionBlock,
                        Reason:     "withdrawal exceeds current position value",
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        return &ValidationResult{
                IsValid:    true,
                Action:     PolicyActionAllow,
                Reason:     "withdrawal validated",
                PolicyID:   policy.PolicyID,
                PolicyName: policy.Name,
        }
}

// CheckSolvency checks if the collateral ratio meets the policy minimum.
func (pe *PolicyEngine) CheckSolvency(depositor string, collateralRatio uint64) *ValidationResult {
        policy, err := pe.GetPolicyForDepositor(depositor)
        if err != nil {
                return &ValidationResult{
                        IsValid: false,
                        Action:  PolicyActionBlock,
                        Reason:  fmt.Sprintf("no policy assigned: %v", err),
                }
        }

        if collateralRatio < policy.MinCollateralRatio {
                return &ValidationResult{
                        IsValid:    false,
                        Action:     policy.OnRiskBreach,
                        Reason:     fmt.Sprintf("collateral ratio %d bps below minimum %d bps", collateralRatio, policy.MinCollateralRatio),
                        PolicyID:   policy.PolicyID,
                        PolicyName: policy.Name,
                }
        }

        return &ValidationResult{
                IsValid:    true,
                Action:     PolicyActionAllow,
                Reason:     "solvency check passed",
                PolicyID:   policy.PolicyID,
                PolicyName: policy.Name,
        }
}

// ─── Agent Action Validation (Core of ) ─────────────────────────────

// ValidateAction validates an agent action against the policy constraints.
// This is the core method that ensures the agent cannot exceed limits.
//
// The Policy Engine is a deterministic rule engine
// that maps the risk score and current positions to specific policy actions.
//
// If the AI agent emits an erroneous instruction,
// the Policy Engine's deterministic constraints prevent the instruction from violating
// the on-chain policy parameters.
//
// This method is deterministic: given the same inputs, it produces the same outputs.
// It validates:
// - Policy is active and assigned
// - Action type is allowed by the policy
// - Amount does not exceed the policy's maximum for the action type
// - Action does not violate maxDrawdown, maxSingleExposure, or hedgeThreshold
// - Action does not violate maxLeverage or minCollateralRatio
// - If the amount exceeds the policy cap, it is capped (not blocked) for rebalance/hedge/deleverage
// - Emergency exit is always allowed (safety override)
func (pe *PolicyEngine) ValidateAction(depositor string, actionType ActionType, amount *big.Int, ctx *PositionContext) *ActionValidationResult {
        pe.mu.Lock()
        pe.totalValidations++
        pe.mu.Unlock()

        result := &ActionValidationResult{
                IsValid:        true,
                Action:         PolicyActionAllow,
                OriginalAmount: amount,
                AdjustedAmount: amount,
                WasCapped:      false,
        }

        // Get the policy for the depositor
        policy, err := pe.GetPolicyForDepositor(depositor)
        if err != nil {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("no policy assigned: %v", err)
                return result
        }

        result.PolicyID = policy.PolicyID
        result.PolicyName = policy.Name

        // Check policy is active
        if !policy.IsActive {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = "policy is not active"
                return result
        }

        // Emergency exit is always allowed — it's a safety mechanism
        if actionType == ActionTypeEmergencyExit {
                pe.mu.Lock()
                pe.approvedActions++
                pe.mu.Unlock()
                result.IsValid = true
                result.Action = PolicyActionAllow
                result.Reason = "emergency exit always allowed (safety override)"
                return result
        }

        // Validate based on action type
        switch actionType {
        case ActionTypeRebalance:
                return pe.validateRebalance(policy, amount, ctx, result)
        case ActionTypeHedge:
                return pe.validateHedge(policy, amount, ctx, result)
        case ActionTypeDeleverage:
                return pe.validateDeleverage(policy, amount, ctx, result)
        case ActionTypeDeposit:
                return pe.validateActionDeposit(policy, amount, ctx, result)
        case ActionTypeWithdraw:
                return pe.validateActionWithdraw(policy, amount, ctx, result)
        default:
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("unknown action type: %d", actionType)
                return result
        }
}

// validateRebalance validates a rebalance action against policy constraints.
//
// The Policy Engine maps the risk score and current
// positions to specific policy actions within the constraints set by the on-chain
// PolicyRegistry. For rebalance:
// - Amount must not exceed MaxRebalanceAmountBps of total vault value
// - Current drawdown must not exceed MaxDrawdownBps
// - Current leverage must not exceed MaxLeverage
// - Collateral ratio must remain above MinCollateralRatio after rebalance
// - If amount exceeds policy cap, it is capped (not blocked)
func (pe *PolicyEngine) validateRebalance(policy *Policy, amount *big.Int, ctx *PositionContext, result *ActionValidationResult) *ActionValidationResult {
        // Check drawdown constraint
        if ctx.CurrentDrawdownBps > policy.MaxDrawdownBps {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("current drawdown %d bps exceeds policy max %d bps",
                        ctx.CurrentDrawdownBps, policy.MaxDrawdownBps)
                return result
        }

        // Check leverage constraint
        if ctx.CurrentLeverageBps > policy.MaxLeverage {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("current leverage %d bps exceeds policy max %d bps",
                        ctx.CurrentLeverageBps, policy.MaxLeverage)
                return result
        }

        // Check collateral ratio constraint
        if ctx.CollateralRatioBps < policy.MinCollateralRatio {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("collateral ratio %d bps below minimum %d bps",
                        ctx.CollateralRatioBps, policy.MinCollateralRatio)
                return result
        }

        // Cap the rebalance amount to the policy's maximum
        maxAmount := pe.computeMaxAmount(policy.MaxRebalanceAmountBps, ctx.TotalVaultValue)
        if amount.Cmp(maxAmount) > 0 {
                pe.mu.Lock()
                pe.cappedActions++
                pe.mu.Unlock()
                result.AdjustedAmount = maxAmount
                result.WasCapped = true
                result.Reason = fmt.Sprintf("rebalance amount capped from %s to %s (policy max %d bps of vault)",
                        amount.String(), maxAmount.String(), policy.MaxRebalanceAmountBps)
        }

        pe.mu.Lock()
        pe.approvedActions++
        pe.mu.Unlock()
        if result.Reason == "" {
                result.Reason = "rebalance validated"
        }
        return result
}

// validateHedge validates a hedge action against policy constraints.
//
// hedgeThresholdBps is the risk score threshold
// for hedging. The hedge action is only allowed if the risk score exceeds this threshold.
// - Risk score must exceed HedgeThresholdBps
// - Amount must not exceed MaxHedgeAmountBps of total vault value
// - Collateral ratio must remain above MinCollateralRatio
// - If amount exceeds policy cap, it is capped (not blocked)
func (pe *PolicyEngine) validateHedge(policy *Policy, amount *big.Int, ctx *PositionContext, result *ActionValidationResult) *ActionValidationResult {
        // Check hedge threshold — hedge is only allowed when risk is high enough
        riskScoreBps := uint64(ctx.RiskScore * 100) // Convert 0-100 score to bps
        if riskScoreBps < policy.HedgeThresholdBps {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("risk score %.2f (%d bps) below hedge threshold %d bps",
                        ctx.RiskScore, riskScoreBps, policy.HedgeThresholdBps)
                return result
        }

        // Check collateral ratio constraint
        if ctx.CollateralRatioBps < policy.MinCollateralRatio {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("collateral ratio %d bps below minimum %d bps",
                        ctx.CollateralRatioBps, policy.MinCollateralRatio)
                return result
        }

        // Cap the hedge amount to the policy's maximum
        maxAmount := pe.computeMaxAmount(policy.MaxHedgeAmountBps, ctx.TotalVaultValue)
        if amount.Cmp(maxAmount) > 0 {
                pe.mu.Lock()
                pe.cappedActions++
                pe.mu.Unlock()
                result.AdjustedAmount = maxAmount
                result.WasCapped = true
                result.Reason = fmt.Sprintf("hedge amount capped from %s to %s (policy max %d bps of vault)",
                        amount.String(), maxAmount.String(), policy.MaxHedgeAmountBps)
        }

        pe.mu.Lock()
        pe.approvedActions++
        pe.mu.Unlock()
        if result.Reason == "" {
                result.Reason = "hedge validated"
        }
        return result
}

// validateDeleverage validates a deleverage action against policy constraints.
//
// Deleverage is a risk-reducing action and is generally allowed, but the amount
// is constrained by the policy's MaxDeleverageAmountBps.
// - Amount must not exceed MaxDeleverageAmountBps of total vault value
// - If amount exceeds policy cap, it is capped (not blocked)
func (pe *PolicyEngine) validateDeleverage(policy *Policy, amount *big.Int, ctx *PositionContext, result *ActionValidationResult) *ActionValidationResult {
        // Deleverage is a risk-reducing action, so it's generally allowed
        // But we still cap the amount

        maxAmount := pe.computeMaxAmount(policy.MaxDeleverageAmountBps, ctx.TotalVaultValue)
        if amount.Cmp(maxAmount) > 0 {
                pe.mu.Lock()
                pe.cappedActions++
                pe.mu.Unlock()
                result.AdjustedAmount = maxAmount
                result.WasCapped = true
                result.Reason = fmt.Sprintf("deleverage amount capped from %s to %s (policy max %d bps of vault)",
                        amount.String(), maxAmount.String(), policy.MaxDeleverageAmountBps)
        }

        pe.mu.Lock()
        pe.approvedActions++
        pe.mu.Unlock()
        if result.Reason == "" {
                result.Reason = "deleverage validated"
        }
        return result
}

// validateActionDeposit validates a deposit action for agent context.
func (pe *PolicyEngine) validateActionDeposit(policy *Policy, amount *big.Int, ctx *PositionContext, result *ActionValidationResult) *ActionValidationResult {
        // Check max deposit per transaction
        if amount.Cmp(policy.MaxDepositPerTx) > 0 {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("deposit %s exceeds max per tx %s", amount.String(), policy.MaxDepositPerTx.String())
                return result
        }

        // Check max total exposure
        newExposure := new(big.Int).Add(ctx.TotalExposure, amount)
        if newExposure.Cmp(policy.MaxTotalExposure) > 0 {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = fmt.Sprintf("new total exposure %s exceeds max %s", newExposure.String(), policy.MaxTotalExposure.String())
                return result
        }

        pe.mu.Lock()
        pe.approvedActions++
        pe.mu.Unlock()
        result.Reason = "deposit validated"
        return result
}

// validateActionWithdraw validates a withdrawal action for agent context.
func (pe *PolicyEngine) validateActionWithdraw(policy *Policy, amount *big.Int, ctx *PositionContext, result *ActionValidationResult) *ActionValidationResult {
        // Check max withdrawal per transaction
        if amount.Cmp(policy.MaxWithdrawalPerTx) > 0 {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionRequireApproval
                result.Reason = fmt.Sprintf("withdrawal %s exceeds max per tx %s", amount.String(), policy.MaxWithdrawalPerTx.String())
                return result
        }

        // Check that withdrawal doesn't exceed position value
        if amount.Cmp(ctx.TotalVaultValue) > 0 {
                pe.mu.Lock()
                pe.blockedActions++
                pe.mu.Unlock()
                result.IsValid = false
                result.Action = PolicyActionBlock
                result.Reason = "withdrawal exceeds current vault value"
                return result
        }

        pe.mu.Lock()
        pe.approvedActions++
        pe.mu.Unlock()
        result.Reason = "withdrawal validated"
        return result
}

// ─── Helper Methods ────────────────────────────────────────────────────────

// computeMaxAmount computes the maximum amount allowed as a percentage of total vault value.
// bps is the percentage in basis points (e.g., 1000 = 10%).
func (pe *PolicyEngine) computeMaxAmount(bps uint64, totalVaultValue *big.Int) *big.Int {
        if totalVaultValue.Sign() <= 0 || bps == 0 {
                return big.NewInt(0)
        }
        // amount = totalVaultValue * bps / 10000
        bpsBig := new(big.Int).SetUint64(bps)
        result := new(big.Int).Mul(totalVaultValue, bpsBig)
        result.Div(result, big.NewInt(10000))
        return result
}

// ─── Default Policies ──────────────────────────────────────────────────────

// LoadDefaultPolicies loads the default policies (Conservative/Balanced/Aggressive)
// matching the on-chain PolicyRegistry contracts deployed on Coston2.
//
// 
// - Conservative: maxDrawdown=15%, maxSingleExposure=40%, hedgeThreshold=8%
// - Balanced: maxDrawdown=25%, maxSingleExposure=60%, hedgeThreshold=12%
// - Aggressive: maxDrawdown=40%, maxSingleExposure=80%, hedgeThreshold=20%
func (pe *PolicyEngine) LoadDefaultPolicies() error {
        policies := []*Policy{
                {
                        PolicyID:               1,
                        Name:                   "Conservative",
                        Description:            "Low risk tolerance policy for institutional depositors",
                        RiskLevel:              RiskLevelLow,
                        IsActive:               true,
                        MaxDrawdownBps:         1500,  // 15% max drawdown
                        MaxSingleExposureBps:   4000,  // 40% max single exposure
                        HedgeThresholdBps:      800,   // 8% hedge threshold
                        AllowedAssets:          []string{"FXRP", "FLR", "sFLR"},
                        MaxDepositPerTx:        big.NewInt(100_000_000),    // 100 XRP
                        MaxWithdrawalPerTx:     big.NewInt(50_000_000),     // 50 XRP
                        MaxTotalExposure:       big.NewInt(10_000_000_000), // 10,000 XRP
                        MaxSinglePositionRatio: 5000,                       // 50%
                        MinCollateralRatio:     20000,                      // 200%
                        MaxLeverage:            10000,                      // 1x
                        WithdrawalDelaySeconds: 86400,
                        RebalanceThresholdBps:  500,                        // 5%
                        MaxSlippageBps:         100,                        // 1%
                        MaxRebalanceAmountBps:  1000,                       // 10% of vault
                        MaxHedgeAmountBps:      500,                        // 5% of vault
                        MaxDeleverageAmountBps: 2000,                       // 20% of vault
                        OnRiskBreach:           PolicyActionRequireApproval,
                        OnSolvencyWarning:      PolicyActionDelay,
                },
                {
                        PolicyID:               2,
                        Name:                   "Balanced",
                        Description:            "Medium risk tolerance policy for institutional depositors",
                        RiskLevel:              RiskLevelMedium,
                        IsActive:               true,
                        MaxDrawdownBps:         2500,  // 25% max drawdown
                        MaxSingleExposureBps:   6000,  // 60% max single exposure
                        HedgeThresholdBps:      1200,  // 12% hedge threshold
                        AllowedAssets:          []string{"FXRP", "FLR", "sFLR", "BTC", "ETH"},
                        MaxDepositPerTx:        big.NewInt(500_000_000),    // 500 XRP
                        MaxWithdrawalPerTx:     big.NewInt(250_000_000),    // 250 XRP
                        MaxTotalExposure:       big.NewInt(50_000_000_000), // 50,000 XRP
                        MaxSinglePositionRatio: 5000,                        // 50%
                        MinCollateralRatio:     15000,                       // 150%
                        MaxLeverage:            10000,                        // 1x
                        WithdrawalDelaySeconds: 86400,
                        RebalanceThresholdBps:  500,                         // 5%
                        MaxSlippageBps:         100,                         // 1%
                        MaxRebalanceAmountBps:  1000,                        // 10% of vault
                        MaxHedgeAmountBps:      500,                         // 5% of vault
                        MaxDeleverageAmountBps: 2000,                        // 20% of vault
                        OnRiskBreach:           PolicyActionRequireApproval,
                        OnSolvencyWarning:      PolicyActionDelay,
                },
                {
                        PolicyID:               3,
                        Name:                   "Aggressive",
                        Description:            "High risk tolerance policy for institutional depositors",
                        RiskLevel:              RiskLevelHigh,
                        IsActive:               true,
                        MaxDrawdownBps:         4000,  // 40% max drawdown
                        MaxSingleExposureBps:   8000,  // 80% max single exposure
                        HedgeThresholdBps:      2000,  // 20% hedge threshold
                        AllowedAssets:          []string{"FXRP", "FLR", "sFLR", "BTC", "ETH", "HL-PERP"},
                        MaxDepositPerTx:        big.NewInt(2_000_000_000),    // 2,000 XRP
                        MaxWithdrawalPerTx:     big.NewInt(1_000_000_000),    // 1,000 XRP
                        MaxTotalExposure:       big.NewInt(200_000_000_000),  // 200,000 XRP
                        MaxSinglePositionRatio: 5000,                          // 50%
                        MinCollateralRatio:     12000,                         // 120%
                        MaxLeverage:            10000,                          // 1x
                        WithdrawalDelaySeconds: 43200,
                        RebalanceThresholdBps:  500,                           // 5%
                        MaxSlippageBps:         100,                           // 1%
                        MaxRebalanceAmountBps:  1500,                          // 15% of vault
                        MaxHedgeAmountBps:      800,                           // 8% of vault
                        MaxDeleverageAmountBps: 2500,                          // 25% of vault
                        OnRiskBreach:           PolicyActionRequireApproval,
                        OnSolvencyWarning:      PolicyActionDelay,
                },
        }

        for _, p := range policies {
                if err := pe.AddPolicy(p); err != nil {
                        return fmt.Errorf("failed to add policy %d: %w", p.PolicyID, err)
                }
        }

        return nil
}

// ─── Enforcement Statistics ─────────────────────────────────────────────────

// EnforcementStats returns the current enforcement statistics.
func (pe *PolicyEngine) EnforcementStats() (total, blocked, capped, approved uint64) {
        pe.mu.RLock()
        defer pe.mu.RUnlock()
        return pe.totalValidations, pe.blockedActions, pe.cappedActions, pe.approvedActions
}

// ─── JSON Serialization ─────────────────────────────────────────────────────

// MarshalJSON implements json.Marshaler for Policy.
func (p *Policy) MarshalJSON() ([]byte, error) {
        type Alias Policy
        return json.Marshal(&struct {
                MaxDepositPerTx    string `json:"maxDepositPerTx"`
                MaxWithdrawalPerTx string `json:"maxWithdrawalPerTx"`
                MaxTotalExposure   string `json:"maxTotalExposure"`
                *Alias
        }{
                MaxDepositPerTx:    p.MaxDepositPerTx.String(),
                MaxWithdrawalPerTx: p.MaxWithdrawalPerTx.String(),
                MaxTotalExposure:   p.MaxTotalExposure.String(),
                Alias:              (*Alias)(p),
        })
}
