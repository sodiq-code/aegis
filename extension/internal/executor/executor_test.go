package executor

import (
	"math/big"
	"testing"

	"extension-scaffold/internal/policy"
)

// ─── Policy Checker Adapter ─────────────────────────────────────────────────

// testPolicyChecker wraps the real PolicyEngine for testing.
type testPolicyChecker struct {
	engine *policy.PolicyEngine
}

func newTestPolicyChecker() *testPolicyChecker {
	engine := policy.NewPolicyEngine()
	engine.LoadDefaultPolicies()
	engine.AssignPolicy("aegis-vault", 2) // Balanced policy
	return &testPolicyChecker{engine: engine}
}

func (tpc *testPolicyChecker) ValidateAction(depositor string, actionType policy.ActionType, amount *big.Int, ctx *policy.PositionContext) *policy.ActionValidationResult {
	return tpc.engine.ValidateAction(depositor, actionType, amount, ctx)
}

// ─── Helper Functions ───────────────────────────────────────────────────────

func newTestActionExecutor() *ActionExecutor {
	ae := NewActionExecutor(DefaultPMWConfig())
	ae.SetDefaultDepositor("aegis-vault")
	ae.SetPolicyChecker(newTestPolicyChecker())
	return ae
}

// ─── Existing Tests (Preserved) ─────────────────────────────────────────────

func TestActionExecutor_CreateWalletProject(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	project, err := ae.CreateWalletProject(1)
	if err != nil {
		t.Fatalf("failed to create wallet project: %v", err)
	}

	if project.ProjectID != "aegis-xrpl-project-1" {
		t.Errorf("expected project ID 'aegis-xrpl-project-1', got '%s'", project.ProjectID)
	}

	if project.KeyType != "XRP" {
		t.Errorf("expected key type 'XRP', got '%s'", project.KeyType)
	}
}

func TestActionExecutor_CreateWallet(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())
	ae.CreateWalletProject(1)

	wallet, err := ae.CreateWallet("aegis-xrpl-project-1")
	if err != nil {
		t.Fatalf("failed to create wallet: %v", err)
	}

	if wallet.Status != "initializing" {
		t.Errorf("expected status 'initializing', got '%s'", wallet.Status)
	}
}

func TestActionExecutor_EnableWallet(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())
	ae.CreateWalletProject(1)
	wallet, _ := ae.CreateWallet("aegis-xrpl-project-1")

	err := ae.EnableWallet(wallet.WalletID)
	if err != nil {
		t.Fatalf("failed to enable wallet: %v", err)
	}

	enabled, _ := ae.GetWallet(wallet.WalletID)
	if enabled.Status != "enabled" {
		t.Errorf("expected status 'enabled', got '%s'", enabled.Status)
	}
}

func TestActionExecutor_ValidatePMW(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	err := ae.ValidatePMW()
	if err != nil {
		t.Fatalf("PMW validation failed: %v", err)
	}
}

func TestActionExecutor_GetWalletProject_NotFound(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	_, err := ae.GetWalletProject("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent project")
	}
}

func TestActionExecutor_GetWallet_NotFound(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	_, err := ae.GetWallet("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent wallet")
	}
}

func TestActionExecutor_CreateWallet_ProjectNotFound(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	_, err := ae.CreateWallet("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent project")
	}
}

func TestActionExecutor_EnableWallet_NotFound(t *testing.T) {
	ae := NewActionExecutor(DefaultPMWConfig())

	err := ae.EnableWallet("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent wallet")
	}
}

// ─── PMWExecutor Interface Tests ────────────────────────────────────

func TestActionExecutor_ExecuteRebalance_Valid(t *testing.T) {
	ae := newTestActionExecutor()

	result, err := ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination")
	if err != nil {
		t.Fatalf("expected successful rebalance, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
	if result.Amount != "50000000" {
		t.Errorf("expected amount 50000000, got %s", result.Amount)
	}
}

func TestActionExecutor_ExecuteRebalance_CappedByPolicy(t *testing.T) {
	ae := newTestActionExecutor()

	// Try to rebalance 200M (20% of vault) — Balanced policy caps at 10% (100M)
	result, err := ae.ExecuteRebalance(big.NewInt(200_000_000), "rDestination")
	if err != nil {
		t.Fatalf("expected successful (capped) rebalance, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
	// The amount should be capped to 100M
	if result.Amount != "100000000" {
		t.Errorf("expected capped amount 100000000, got %s", result.Amount)
	}
}

func TestActionExecutor_ExecuteRebalance_BlockedByPolicy(t *testing.T) {
	// Create a policy engine with a vault that has exceeded drawdown
	pe := policy.NewPolicyEngine()
	pe.LoadDefaultPolicies()
	pe.AssignPolicy("test-vault", 2) // Balanced policy

	// Override the position context to have high drawdown
	// We need a custom policy checker that returns a high drawdown context
	checker := &customContextPolicyChecker{
		engine: pe,
		ctx: &policy.PositionContext{
			TotalVaultValue:     big.NewInt(1_000_000_000),
			TotalExposure:       big.NewInt(700_000_000),
			SingleAssetExposure: big.NewInt(400_000_000),
			CollateralRatioBps:  18000,
			CurrentDrawdownBps:  3000, // 30% — exceeds Balanced max of 25%
			CurrentLeverageBps:  10000,
			RiskScore:           55.0,
		},
	}

	ae := NewActionExecutor(DefaultPMWConfig())
	ae.SetDefaultDepositor("test-vault")
	ae.SetPolicyChecker(checker)

	_, err := ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination")
	if err == nil {
		t.Error("expected rebalance to be blocked by policy")
	}
}

func TestActionExecutor_ExecuteHedge_Valid(t *testing.T) {
	ae := newTestActionExecutor()

	result, err := ae.ExecuteHedge(big.NewInt(30_000_000))
	if err != nil {
		t.Fatalf("expected successful hedge, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
}

func TestActionExecutor_ExecuteHedge_BelowThreshold(t *testing.T) {
	// Create a policy engine with low risk score
	pe := policy.NewPolicyEngine()
	pe.LoadDefaultPolicies()
	pe.AssignPolicy("test-vault", 2) // Balanced policy

	checker := &customContextPolicyChecker{
		engine: pe,
		ctx: &policy.PositionContext{
			TotalVaultValue:     big.NewInt(1_000_000_000),
			TotalExposure:       big.NewInt(700_000_000),
			SingleAssetExposure: big.NewInt(400_000_000),
			CollateralRatioBps:  18000,
			CurrentDrawdownBps:  500,
			CurrentLeverageBps:  10000,
			RiskScore:           5.0, // Low risk — below hedge threshold
		},
	}

	ae := NewActionExecutor(DefaultPMWConfig())
	ae.SetDefaultDepositor("test-vault")
	ae.SetPolicyChecker(checker)

	_, err := ae.ExecuteHedge(big.NewInt(30_000_000))
	if err == nil {
		t.Error("expected hedge to be blocked by policy (below threshold)")
	}
}

func TestActionExecutor_ExecuteDeleverage_Valid(t *testing.T) {
	ae := newTestActionExecutor()

	result, err := ae.ExecuteDeleverage(big.NewInt(100_000_000))
	if err != nil {
		t.Fatalf("expected successful deleverage, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
}

func TestActionExecutor_ExecuteDeleverage_CappedByPolicy(t *testing.T) {
	ae := newTestActionExecutor()

	// Try to deleverage 500M (50% of vault) — Balanced policy caps at 20% (200M)
	result, err := ae.ExecuteDeleverage(big.NewInt(500_000_000))
	if err != nil {
		t.Fatalf("expected successful (capped) deleverage, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
}

func TestActionExecutor_ExecuteEmergencyExit_AlwaysAllowed(t *testing.T) {
	ae := newTestActionExecutor()

	result, err := ae.ExecuteEmergencyExit()
	if err != nil {
		t.Fatalf("expected successful emergency exit, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
}

// ─── Policy Enforcement Integration Tests ───────────────────────────────────

func TestActionExecutor_AgentCannotExceedRebalanceLimit(t *testing.T) {
	ae := newTestActionExecutor()

	// Try to rebalance with a huge amount — should be capped
	result, err := ae.ExecuteRebalance(big.NewInt(500_000_000), "rDestination")
	if err != nil {
		t.Fatalf("expected successful (capped) rebalance, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
	// The amount should be capped
	if result.Amount == "500000000" {
		t.Error("expected amount to be capped, but it was not")
	}
}

func TestActionExecutor_AgentCannotExceedHedgeLimit(t *testing.T) {
	ae := newTestActionExecutor()

	// Try to hedge with a huge amount — should be capped
	result, err := ae.ExecuteHedge(big.NewInt(500_000_000))
	if err != nil {
		t.Fatalf("expected successful (capped) hedge, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
	if result.Amount == "500000000" {
		t.Error("expected amount to be capped, but it was not")
	}
}

func TestActionExecutor_NoPolicyChecker_AllowsAll(t *testing.T) {
	// Without a policy checker, the ActionExecutor should allow all actions
	ae := NewActionExecutor(DefaultPMWConfig())
	ae.SetDefaultDepositor("aegis-vault")

	result, err := ae.ExecuteRebalance(big.NewInt(500_000_000), "rDestination")
	if err != nil {
		t.Fatalf("expected successful rebalance without policy, got error: %v", err)
	}
	if !result.Success {
		t.Error("expected successful result")
	}
}

// ─── Execution Statistics Tests ─────────────────────────────────────────────

func TestActionExecutor_ExecutionStats(t *testing.T) {
	ae := newTestActionExecutor()

	// Successful execution
	ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination")

	// Capped execution
	ae.ExecuteRebalance(big.NewInt(200_000_000), "rDestination")

	// Emergency exit
	ae.ExecuteEmergencyExit()

	total, blocked, capped, success, failed := ae.GetExecutionStats()
	if total != 3 {
		t.Errorf("expected 3 total executions, got %d", total)
	}
	if blocked != 0 {
		t.Errorf("expected 0 blocked executions, got %d", blocked)
	}
	if capped != 1 {
		t.Errorf("expected 1 capped execution, got %d", capped)
	}
	if success != 3 {
		t.Errorf("expected 3 successful executions, got %d", success)
	}
	if failed != 0 {
		t.Errorf("expected 0 failed executions, got %d", failed)
	}
}

// ─── Instruction Tracking Tests ─────────────────────────────────────────────

func TestActionExecutor_InstructionTracking(t *testing.T) {
	ae := newTestActionExecutor()

	ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination1")
	ae.ExecuteHedge(big.NewInt(30_000_000))

	instructions := ae.GetInstructions(0)
	if len(instructions) != 2 {
		t.Errorf("expected 2 instructions, got %d", len(instructions))
	}

	// Check the first instruction
	if instructions[0].Type != InstructionRebalance {
		t.Errorf("expected rebalance type, got %d", instructions[0].Type)
	}
	if instructions[0].Status != StatusConfirmed {
		t.Errorf("expected confirmed status, got %s", instructions[0].Status)
	}

	// Check the second instruction
	if instructions[1].Type != InstructionHedge {
		t.Errorf("expected hedge type, got %d", instructions[1].Type)
	}
}

func TestActionExecutor_InstructionLimit(t *testing.T) {
	ae := newTestActionExecutor()

	ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination1")
	ae.ExecuteHedge(big.NewInt(30_000_000))
	ae.ExecuteDeleverage(big.NewInt(100_000_000))

	// Request only the last 2 instructions
	instructions := ae.GetInstructions(2)
	if len(instructions) != 2 {
		t.Errorf("expected 2 instructions, got %d", len(instructions))
	}
}

// ─── Determinism Tests ──────────────────────────────────────────────────────

func TestActionExecutor_Deterministic(t *testing.T) {
	ae := newTestActionExecutor()

	// Execute the same rebalance twice with the same inputs
	// The amounts should be identical (policy enforcement is deterministic)
	result1, err1 := ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination")
	result2, err2 := ae.ExecuteRebalance(big.NewInt(50_000_000), "rDestination")

	if err1 != nil || err2 != nil {
		t.Fatalf("unexpected errors: %v, %v", err1, err2)
	}

	if result1.Amount != result2.Amount {
		t.Errorf("determinism violation: amounts differ: %s vs %s", result1.Amount, result2.Amount)
	}
}

// ─── Custom Context Policy Checker ──────────────────────────────────────────

// customContextPolicyChecker wraps the PolicyEngine with a custom position context.
type customContextPolicyChecker struct {
	engine *policy.PolicyEngine
	ctx    *policy.PositionContext
}

func (c *customContextPolicyChecker) ValidateAction(depositor string, actionType policy.ActionType, amount *big.Int, ctx *policy.PositionContext) *policy.ActionValidationResult {
	// Use the custom context instead of the one passed in
	return c.engine.ValidateAction(depositor, actionType, amount, c.ctx)
}
