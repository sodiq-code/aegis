package policy

import (
	"encoding/json"
	"fmt"
	"math/big"
	"time"
)

// RiskLevel represents the risk level of a policy
type RiskLevel int

const (
	RiskLevelLow      RiskLevel = iota // Conservative
	RiskLevelMedium                    // Balanced
	RiskLevelHigh                      // Aggressive
	RiskLevelCritical                  // Emergency
)

// PolicyAction represents the action to take when a policy condition is triggered
type PolicyAction int

const (
	PolicyActionAllow            PolicyAction = iota // Action is allowed
	PolicyActionRequireApproval                       // Action requires additional approval
	PolicyActionDelay                                 // Action is delayed by a time lock
	PolicyActionBlock                                 // Action is blocked
)

// ActionType represents the type of action being checked
type ActionType int

const (
	ActionTypeDeposit    ActionType = 0
	ActionTypeWithdraw   ActionType = 1
	ActionTypeRebalance  ActionType = 2
)

// Policy represents a risk policy definition
type Policy struct {
	PolicyID                uint64      `json:"policyId"`
	Owner                   string      `json:"owner"`
	Name                    string      `json:"name"`
	Description             string      `json:"description"`
	RiskLevel               RiskLevel   `json:"riskLevel"`
	IsActive                bool        `json:"isActive"`
	CreatedAt               time.Time   `json:"createdAt"`
	UpdatedAt               time.Time   `json:"updatedAt"`
	MaxDepositPerTx         *big.Int    `json:"maxDepositPerTx"`
	MaxWithdrawalPerTx      *big.Int    `json:"maxWithdrawalPerTx"`
	MaxTotalExposure        *big.Int    `json:"maxTotalExposure"`
	MaxSinglePositionRatio  uint64      `json:"maxSinglePositionRatio"` // basis points
	MinCollateralRatio      uint64      `json:"minCollateralRatio"`     // basis points
	MaxLeverage             uint64      `json:"maxLeverage"`            // basis points
	WithdrawalDelaySeconds  uint64      `json:"withdrawalDelaySeconds"`
	RebalanceThresholdBps   uint64      `json:"rebalanceThresholdBps"` // basis points
	MaxSlippageBps          uint64      `json:"maxSlippageBps"`        // basis points
	OnRiskBreach            PolicyAction `json:"onRiskBreach"`
	OnSolvencyWarning       PolicyAction `json:"onSolvencyWarning"`
}

// ValidationResult contains the result of a policy validation
type ValidationResult struct {
	IsValid    bool        `json:"isValid"`
	Action     PolicyAction `json:"action"`
	Reason     string      `json:"reason"`
	PolicyID   uint64      `json:"policyId"`
	PolicyName string      `json:"policyName"`
}

// PolicyEngine enforces deterministic policy constraints
type PolicyEngine struct {
	policies map[uint64]*Policy
	assignees map[string]uint64 // depositor address => policy ID
}

// NewPolicyEngine creates a new PolicyEngine
func NewPolicyEngine() *PolicyEngine {
	return &PolicyEngine{
		policies:  make(map[uint64]*Policy),
		assignees: make(map[string]uint64),
	}
}

// AddPolicy adds a policy to the engine
func (pe *PolicyEngine) AddPolicy(policy *Policy) error {
	if policy == nil {
		return fmt.Errorf("policy cannot be nil")
	}
	if policy.PolicyID == 0 {
		return fmt.Errorf("policy ID must be non-zero")
	}
	pe.policies[policy.PolicyID] = policy
	return nil
}

// AssignPolicy assigns a policy to a depositor
func (pe *PolicyEngine) AssignPolicy(depositor string, policyID uint64) error {
	if _, ok := pe.policies[policyID]; !ok {
		return fmt.Errorf("policy %d not found", policyID)
	}
	pe.assignees[depositor] = policyID
	return nil
}

// GetPolicy returns a policy by ID
func (pe *PolicyEngine) GetPolicy(policyID uint64) (*Policy, error) {
	policy, ok := pe.policies[policyID]
	if !ok {
		return nil, fmt.Errorf("policy %d not found", policyID)
	}
	return policy, nil
}

// GetPolicyForDepositor returns the policy assigned to a depositor
func (pe *PolicyEngine) GetPolicyForDepositor(depositor string) (*Policy, error) {
	policyID, ok := pe.assignees[depositor]
	if !ok {
		return nil, fmt.Errorf("no policy assigned to depositor %s", depositor)
	}
	return pe.GetPolicy(policyID)
}

// ValidateDeposit validates a deposit against the depositor's policy
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

// ValidateWithdrawal validates a withdrawal against the depositor's policy
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

// CheckSolvency checks if the collateral ratio meets the policy minimum
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

// LoadDefaultPolicies loads the default policies (Low/Medium/High risk)
func (pe *PolicyEngine) LoadDefaultPolicies() error {
	policies := []*Policy{
		{
			PolicyID:               1,
			Name:                   "Conservative",
			Description:            "Low risk tolerance policy",
			RiskLevel:              RiskLevelLow,
			IsActive:               true,
			MaxDepositPerTx:        big.NewInt(100_000_000),   // 100 XRP
			MaxWithdrawalPerTx:     big.NewInt(50_000_000),    // 50 XRP
			MaxTotalExposure:       big.NewInt(10_000_000_000), // 10,000 XRP
			MaxSinglePositionRatio: 5000,                       // 50%
			MinCollateralRatio:     20000,                      // 200%
			MaxLeverage:            10000,                       // 1x
			WithdrawalDelaySeconds: 86400,
			RebalanceThresholdBps:  500,                        // 5%
			MaxSlippageBps:         100,                        // 1%
			OnRiskBreach:           PolicyActionRequireApproval,
			OnSolvencyWarning:      PolicyActionDelay,
		},
		{
			PolicyID:               2,
			Name:                   "Balanced",
			Description:            "Medium risk tolerance policy",
			RiskLevel:              RiskLevelMedium,
			IsActive:               true,
			MaxDepositPerTx:        big.NewInt(500_000_000),    // 500 XRP
			MaxWithdrawalPerTx:     big.NewInt(250_000_000),    // 250 XRP
			MaxTotalExposure:       big.NewInt(50_000_000_000), // 50,000 XRP
			MaxSinglePositionRatio: 5000,                        // 50%
			MinCollateralRatio:     15000,                       // 150%
			MaxLeverage:            10000,                        // 1x
			WithdrawalDelaySeconds: 86400,
			RebalanceThresholdBps:  500,                         // 5%
			MaxSlippageBps:         100,                         // 1%
			OnRiskBreach:           PolicyActionRequireApproval,
			OnSolvencyWarning:      PolicyActionDelay,
		},
		{
			PolicyID:               3,
			Name:                   "Aggressive",
			Description:            "High risk tolerance policy",
			RiskLevel:              RiskLevelHigh,
			IsActive:               true,
			MaxDepositPerTx:        big.NewInt(2_000_000_000),    // 2,000 XRP
			MaxWithdrawalPerTx:     big.NewInt(1_000_000_000),    // 1,000 XRP
			MaxTotalExposure:       big.NewInt(200_000_000_000),  // 200,000 XRP
			MaxSinglePositionRatio: 5000,                          // 50%
			MinCollateralRatio:     12000,                         // 120%
			MaxLeverage:            10000,                          // 1x
			WithdrawalDelaySeconds: 43200,
			RebalanceThresholdBps:  500,                           // 5%
			MaxSlippageBps:         100,                           // 1%
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

// MarshalJSON implements json.Marshaler for Policy
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
