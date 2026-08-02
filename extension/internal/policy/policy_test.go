package policy

import (
	"math/big"
	"testing"
)

func TestPolicyEngine_AddPolicy(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:        1,
		Name:            "Test Policy",
		RiskLevel:       RiskLevelMedium,
		IsActive:        true,
		MaxDepositPerTx: big.NewInt(100_000_000),
	}

	err := pe.AddPolicy(policy)
	if err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	got, err := pe.GetPolicy(1)
	if err != nil {
		t.Fatalf("failed to get policy: %v", err)
	}

	if got.Name != "Test Policy" {
		t.Errorf("expected name 'Test Policy', got '%s'", got.Name)
	}
}

func TestPolicyEngine_AddPolicy_NilPolicy(t *testing.T) {
	pe := NewPolicyEngine()

	err := pe.AddPolicy(nil)
	if err == nil {
		t.Fatal("expected error for nil policy")
	}
}

func TestPolicyEngine_AddPolicy_ZeroID(t *testing.T) {
	pe := NewPolicyEngine()

	err := pe.AddPolicy(&Policy{PolicyID: 0})
	if err == nil {
		t.Fatal("expected error for zero policy ID")
	}
}

func TestPolicyEngine_AssignPolicy(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:        1,
		Name:            "Test Policy",
		RiskLevel:       RiskLevelMedium,
		IsActive:        true,
		MaxDepositPerTx: big.NewInt(100_000_000),
	}
	pe.AddPolicy(policy)

	err := pe.AssignPolicy("0x1234", 1)
	if err != nil {
		t.Fatalf("failed to assign policy: %v", err)
	}

	got, err := pe.GetPolicyForDepositor("0x1234")
	if err != nil {
		t.Fatalf("failed to get policy for depositor: %v", err)
	}

	if got.PolicyID != 1 {
		t.Errorf("expected policy ID 1, got %d", got.PolicyID)
	}
}

func TestPolicyEngine_AssignPolicy_NotFound(t *testing.T) {
	pe := NewPolicyEngine()

	err := pe.AssignPolicy("0x1234", 99)
	if err == nil {
		t.Fatal("expected error for non-existent policy")
	}
}

func TestPolicyEngine_ValidateDeposit_Valid(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MaxDepositPerTx:   big.NewInt(100_000_000),
		MaxTotalExposure:  big.NewInt(1_000_000_000),
		MinCollateralRatio: 15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateDeposit("0x1234", big.NewInt(50_000_000), big.NewInt(0))
	if !result.IsValid {
		t.Errorf("expected valid deposit, got: %s", result.Reason)
	}
}

func TestPolicyEngine_ValidateDeposit_ExceedsMax(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MaxDepositPerTx:   big.NewInt(100_000_000),
		MaxTotalExposure:  big.NewInt(1_000_000_000),
		MinCollateralRatio: 15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateDeposit("0x1234", big.NewInt(200_000_000), big.NewInt(0))
	if result.IsValid {
		t.Error("expected invalid deposit (exceeds max)")
	}
	if result.Action != PolicyActionBlock {
		t.Errorf("expected Block action, got %d", result.Action)
	}
}

func TestPolicyEngine_ValidateDeposit_ExceedsExposure(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MaxDepositPerTx:   big.NewInt(1_000_000_000),
		MaxTotalExposure:  big.NewInt(100_000_000),
		MinCollateralRatio: 15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateDeposit("0x1234", big.NewInt(50_000_000), big.NewInt(80_000_000))
	if result.IsValid {
		t.Error("expected invalid deposit (exceeds max exposure)")
	}
}

func TestPolicyEngine_ValidateWithdrawal_Valid(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:              1,
		Name:                  "Test",
		RiskLevel:             RiskLevelMedium,
		IsActive:              true,
		MaxDepositPerTx:       big.NewInt(100_000_000),
		MaxWithdrawalPerTx:    big.NewInt(50_000_000),
		MaxTotalExposure:      big.NewInt(1_000_000_000),
		MinCollateralRatio:    15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateWithdrawal("0x1234", big.NewInt(30_000_000), big.NewInt(100_000_000))
	if !result.IsValid {
		t.Errorf("expected valid withdrawal, got: %s", result.Reason)
	}
}

func TestPolicyEngine_ValidateWithdrawal_ExceedsMax(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:              1,
		Name:                  "Test",
		RiskLevel:             RiskLevelMedium,
		IsActive:              true,
		MaxDepositPerTx:       big.NewInt(100_000_000),
		MaxWithdrawalPerTx:    big.NewInt(50_000_000),
		MaxTotalExposure:      big.NewInt(1_000_000_000),
		MinCollateralRatio:    15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateWithdrawal("0x1234", big.NewInt(100_000_000), big.NewInt(100_000_000))
	if result.IsValid {
		t.Error("expected invalid withdrawal (exceeds max)")
	}
	if result.Action != PolicyActionRequireApproval {
		t.Errorf("expected RequireApproval action, got %d", result.Action)
	}
}

func TestPolicyEngine_ValidateWithdrawal_ExceedsPosition(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:              1,
		Name:                  "Test",
		RiskLevel:             RiskLevelMedium,
		IsActive:              true,
		MaxDepositPerTx:       big.NewInt(1_000_000_000),
		MaxWithdrawalPerTx:    big.NewInt(1_000_000_000),
		MaxTotalExposure:      big.NewInt(1_000_000_000),
		MinCollateralRatio:    15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateWithdrawal("0x1234", big.NewInt(200_000_000), big.NewInt(100_000_000))
	if result.IsValid {
		t.Error("expected invalid withdrawal (exceeds position)")
	}
	if result.Action != PolicyActionBlock {
		t.Errorf("expected Block action, got %d", result.Action)
	}
}

func TestPolicyEngine_CheckSolvency_Solvent(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MinCollateralRatio: 15000,
		OnRiskBreach:      PolicyActionRequireApproval,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.CheckSolvency("0x1234", 20000) // 200% > 150%
	if !result.IsValid {
		t.Errorf("expected solvent, got: %s", result.Reason)
	}
}

func TestPolicyEngine_CheckSolvency_Insolvent(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MinCollateralRatio: 15000,
		OnRiskBreach:      PolicyActionRequireApproval,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.CheckSolvency("0x1234", 10000) // 100% < 150%
	if result.IsValid {
		t.Error("expected insolvent")
	}
	if result.Action != PolicyActionRequireApproval {
		t.Errorf("expected RequireApproval action, got %d", result.Action)
	}
}

func TestPolicyEngine_InactivePolicyBlocksDeposit(t *testing.T) {
	pe := NewPolicyEngine()

	policy := &Policy{
		PolicyID:          1,
		Name:              "Inactive",
		RiskLevel:         RiskLevelLow,
		IsActive:          false,
		MaxDepositPerTx:   big.NewInt(100_000_000),
		MaxTotalExposure:  big.NewInt(1_000_000_000),
		MinCollateralRatio: 15000,
	}
	pe.AddPolicy(policy)
	pe.AssignPolicy("0x1234", 1)

	result := pe.ValidateDeposit("0x1234", big.NewInt(50_000_000), big.NewInt(0))
	if result.IsValid {
		t.Error("expected invalid deposit (inactive policy)")
	}
}

func TestPolicyEngine_LoadDefaultPolicies(t *testing.T) {
	pe := NewPolicyEngine()

	err := pe.LoadDefaultPolicies()
	if err != nil {
		t.Fatalf("failed to load default policies: %v", err)
	}

	p1, err := pe.GetPolicy(1)
	if err != nil {
		t.Fatalf("failed to get policy 1: %v", err)
	}
	if p1.Name != "Conservative" {
		t.Errorf("expected 'Conservative', got '%s'", p1.Name)
	}

	p2, err := pe.GetPolicy(2)
	if err != nil {
		t.Fatalf("failed to get policy 2: %v", err)
	}
	if p2.Name != "Balanced" {
		t.Errorf("expected 'Balanced', got '%s'", p2.Name)
	}

	p3, err := pe.GetPolicy(3)
	if err != nil {
		t.Fatalf("failed to get policy 3: %v", err)
	}
	if p3.Name != "Aggressive" {
		t.Errorf("expected 'Aggressive', got '%s'", p3.Name)
	}
}

func TestPolicyEngine_NoPolicyAssigned(t *testing.T) {
	pe := NewPolicyEngine()

	result := pe.ValidateDeposit("0x1234", big.NewInt(50_000_000), big.NewInt(0))
	if result.IsValid {
		t.Error("expected invalid deposit (no policy assigned)")
	}
}

func TestPolicyEngine_MarshalJSON(t *testing.T) {
	pe := NewPolicyEngine()
	policy := &Policy{
		PolicyID:          1,
		Name:              "Test",
		RiskLevel:         RiskLevelMedium,
		IsActive:          true,
		MaxDepositPerTx:   big.NewInt(100_000_000),
		MaxWithdrawalPerTx: big.NewInt(50_000_000),
		MaxTotalExposure:  big.NewInt(1_000_000_000),
		MinCollateralRatio: 15000,
	}
	pe.AddPolicy(policy)

	data, err := policy.MarshalJSON()
	if err != nil {
		t.Fatalf("failed to marshal policy: %v", err)
	}

	if len(data) == 0 {
		t.Error("expected non-empty JSON")
	}
}
