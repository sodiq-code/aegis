package policy

import (
        "fmt"
        "math/big"
        "testing"
)

// ─── Helper Functions ───────────────────────────────────────────────────────

func newTestPolicyEngine() *PolicyEngine {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()
        pe.AssignPolicy("aegis-vault", 2) // Balanced policy
        return pe
}

func newTestPositionContext() *PositionContext {
        return &PositionContext{
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

// ─── Existing Tests (Preserved) ─────────────────────────────────────────────

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
        if p1.MaxDrawdownBps != 1500 {
                t.Errorf("expected Conservative maxDrawdownBps=1500, got %d", p1.MaxDrawdownBps)
        }
        if p1.MaxSingleExposureBps != 4000 {
                t.Errorf("expected Conservative maxSingleExposureBps=4000, got %d", p1.MaxSingleExposureBps)
        }
        if p1.HedgeThresholdBps != 800 {
                t.Errorf("expected Conservative hedgeThresholdBps=800, got %d", p1.HedgeThresholdBps)
        }

        p2, err := pe.GetPolicy(2)
        if err != nil {
                t.Fatalf("failed to get policy 2: %v", err)
        }
        if p2.Name != "Balanced" {
                t.Errorf("expected 'Balanced', got '%s'", p2.Name)
        }
        if p2.MaxDrawdownBps != 2500 {
                t.Errorf("expected Balanced maxDrawdownBps=2500, got %d", p2.MaxDrawdownBps)
        }

        p3, err := pe.GetPolicy(3)
        if err != nil {
                t.Fatalf("failed to get policy 3: %v", err)
        }
        if p3.Name != "Aggressive" {
                t.Errorf("expected 'Aggressive', got '%s'", p3.Name)
        }
        if p3.MaxDrawdownBps != 4000 {
                t.Errorf("expected Aggressive maxDrawdownBps=4000, got %d", p3.MaxDrawdownBps)
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

// ─── Task 12: ValidateAction Tests ──────────────────────────────────────────

func TestPolicyEngine_ValidateAction_Rebalance_Valid(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid rebalance, got: %s", result.Reason)
        }
        if result.WasCapped {
                t.Errorf("expected no capping, but amount was capped: %s -> %s",
                        result.OriginalAmount.String(), result.AdjustedAmount.String())
        }
}

func TestPolicyEngine_ValidateAction_Rebalance_ExceedsMaxAmount(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Try to rebalance 200M (20% of vault) — Balanced policy caps at 10% (100M)
        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(200_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid (capped) rebalance, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        // 10% of 1,000,000,000 = 100,000,000
        expectedCap := big.NewInt(100_000_000)
        if result.AdjustedAmount.Cmp(expectedCap) != 0 {
                t.Errorf("expected capped amount %s, got %s", expectedCap.String(), result.AdjustedAmount.String())
        }
}

func TestPolicyEngine_ValidateAction_Rebalance_DrawdownExceeded(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.CurrentDrawdownBps = 3000 // 30% drawdown — exceeds Balanced policy max of 25%

        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected rebalance to be blocked (drawdown exceeded)")
        }
        if result.Action != PolicyActionBlock {
                t.Errorf("expected Block action, got %d", result.Action)
        }
}

func TestPolicyEngine_ValidateAction_Rebalance_LeverageExceeded(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.CurrentLeverageBps = 15000 // 1.5x leverage — exceeds policy max of 1x

        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected rebalance to be blocked (leverage exceeded)")
        }
}

func TestPolicyEngine_ValidateAction_Rebalance_InsufficientCollateral(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.CollateralRatioBps = 12000 // 120% — below Balanced policy min of 150%

        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected rebalance to be blocked (insufficient collateral)")
        }
}

func TestPolicyEngine_ValidateAction_Hedge_Valid(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.RiskScore = 55.0 // 5500 bps — above Balanced hedge threshold of 1200 bps

        result := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid hedge, got: %s", result.Reason)
        }
}

func TestPolicyEngine_ValidateAction_Hedge_BelowThreshold(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.RiskScore = 5.0 // 500 bps — below Balanced hedge threshold of 1200 bps

        result := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx)
        if result.IsValid {
                t.Error("expected hedge to be blocked (below threshold)")
        }
        if result.Action != PolicyActionBlock {
                t.Errorf("expected Block action, got %d", result.Action)
        }
}

func TestPolicyEngine_ValidateAction_Hedge_ExceedsMaxAmount(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.RiskScore = 55.0 // Above threshold

        // Try to hedge 100M (10% of vault) — Balanced policy caps at 5% (50M)
        result := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(100_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid (capped) hedge, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        // 5% of 1,000,000,000 = 50,000,000
        expectedCap := big.NewInt(50_000_000)
        if result.AdjustedAmount.Cmp(expectedCap) != 0 {
                t.Errorf("expected capped amount %s, got %s", expectedCap.String(), result.AdjustedAmount.String())
        }
}

func TestPolicyEngine_ValidateAction_Hedge_InsufficientCollateral(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.RiskScore = 55.0
        ctx.CollateralRatioBps = 12000 // 120% — below Balanced policy min of 150%

        result := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx)
        if result.IsValid {
                t.Error("expected hedge to be blocked (insufficient collateral)")
        }
}

func TestPolicyEngine_ValidateAction_Deleverage_Valid(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        result := pe.ValidateAction("aegis-vault", ActionTypeDeleverage, big.NewInt(100_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid deleverage, got: %s", result.Reason)
        }
}

func TestPolicyEngine_ValidateAction_Deleverage_ExceedsMaxAmount(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Try to deleverage 300M (30% of vault) — Balanced policy caps at 20% (200M)
        result := pe.ValidateAction("aegis-vault", ActionTypeDeleverage, big.NewInt(300_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected valid (capped) deleverage, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        // 20% of 1,000,000,000 = 200,000,000
        expectedCap := big.NewInt(200_000_000)
        if result.AdjustedAmount.Cmp(expectedCap) != 0 {
                t.Errorf("expected capped amount %s, got %s", expectedCap.String(), result.AdjustedAmount.String())
        }
}

func TestPolicyEngine_ValidateAction_EmergencyExit_AlwaysAllowed(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.CollateralRatioBps = 5000 // 50% — well below minimum
        ctx.CurrentDrawdownBps = 5000 // 50% — well above maximum
        ctx.CurrentLeverageBps = 30000 // 3x — well above maximum

        // Emergency exit should always be allowed regardless of policy constraints
        result := pe.ValidateAction("aegis-vault", ActionTypeEmergencyExit, big.NewInt(1_000_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected emergency exit to be allowed, got: %s", result.Reason)
        }
}

func TestPolicyEngine_ValidateAction_NoPolicyAssigned(t *testing.T) {
        pe := NewPolicyEngine()
        ctx := newTestPositionContext()

        result := pe.ValidateAction("unknown-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected action to be blocked (no policy assigned)")
        }
}

func TestPolicyEngine_ValidateAction_InactivePolicy(t *testing.T) {
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
        pe.AssignPolicy("test-vault", 1)
        ctx := newTestPositionContext()

        result := pe.ValidateAction("test-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected action to be blocked (inactive policy)")
        }
}

func TestPolicyEngine_ValidateAction_UnknownActionType(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        result := pe.ValidateAction("aegis-vault", ActionType(99), big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected action to be blocked (unknown action type)")
        }
}

// ─── Policy-Specific Validation Tests ───────────────────────────────────────

func TestPolicyEngine_ValidateAction_Conservative_RebalanceBlocked(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()
        pe.AssignPolicy("conservative-vault", 1) // Conservative policy
        ctx := newTestPositionContext()
        ctx.CurrentDrawdownBps = 2000 // 20% — exceeds Conservative max of 15%

        result := pe.ValidateAction("conservative-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if result.IsValid {
                t.Error("expected rebalance to be blocked under Conservative policy (drawdown exceeded)")
        }
}

func TestPolicyEngine_ValidateAction_Aggressive_RebalanceAllowed(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()
        pe.AssignPolicy("aggressive-vault", 3) // Aggressive policy
        ctx := newTestPositionContext()
        ctx.CurrentDrawdownBps = 3500 // 35% — under Aggressive max of 40%

        result := pe.ValidateAction("aggressive-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected rebalance to be allowed under Aggressive policy, got: %s", result.Reason)
        }
}

func TestPolicyEngine_ValidateAction_Conservative_HedgeThreshold(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()
        pe.AssignPolicy("conservative-vault", 1) // Conservative policy: hedgeThreshold=800 bps
        ctx := newTestPositionContext()
        ctx.CollateralRatioBps = 25000 // 250% — above Conservative min of 200%
        ctx.RiskScore = 5.0 // 500 bps — below threshold

        result := pe.ValidateAction("conservative-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx)
        if result.IsValid {
                t.Error("expected hedge to be blocked under Conservative policy (below threshold)")
        }

        // Now with risk score above threshold
        ctx.RiskScore = 10.0 // 1000 bps — above threshold
        result = pe.ValidateAction("conservative-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx)
        if !result.IsValid {
                t.Errorf("expected hedge to be allowed, got: %s", result.Reason)
        }
}

// ─── Determinism Tests ──────────────────────────────────────────────────────

func TestPolicyEngine_ValidateAction_Deterministic(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Run the same validation 10 times and verify identical results
        var results []*ActionValidationResult
        for i := 0; i < 10; i++ {
                result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)
                results = append(results, result)
        }

        for i := 1; i < len(results); i++ {
                if results[i].IsValid != results[0].IsValid {
                        t.Errorf("determinism violation: iteration %d IsValid differs", i)
                }
                if results[i].Reason != results[0].Reason {
                        t.Errorf("determinism violation: iteration %d Reason differs", i)
                }
                if results[i].AdjustedAmount.Cmp(results[0].AdjustedAmount) != 0 {
                        t.Errorf("determinism violation: iteration %d AdjustedAmount differs", i)
                }
                if results[i].WasCapped != results[0].WasCapped {
                        t.Errorf("determinism violation: iteration %d WasCapped differs", i)
                }
        }
}

func TestPolicyEngine_ValidateAction_DifferentInputs_DifferentOutputs(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx1 := newTestPositionContext()
        ctx1.RiskScore = 5.0 // Below hedge threshold

        ctx2 := newTestPositionContext()
        ctx2.RiskScore = 55.0 // Above hedge threshold

        result1 := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx1)
        result2 := pe.ValidateAction("aegis-vault", ActionTypeHedge, big.NewInt(30_000_000), ctx2)

        if result1.IsValid == result2.IsValid {
                t.Error("expected different results for different inputs")
        }
        if result1.IsValid {
                t.Error("expected hedge to be blocked for low risk score")
        }
        if !result2.IsValid {
                t.Errorf("expected hedge to be allowed for high risk score, got: %s", result2.Reason)
        }
}

// ─── Enforcement Statistics Tests ───────────────────────────────────────────

func TestPolicyEngine_EnforcementStats(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Valid action (approved)
        pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx)

        // Blocked action (drawdown exceeded)
        ctx2 := newTestPositionContext()
        ctx2.CurrentDrawdownBps = 3000
        pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(50_000_000), ctx2)

        // Capped action (amount exceeds policy cap)
        pe.ValidateAction("aegis-vault", ActionTypeRebalance, big.NewInt(200_000_000), newTestPositionContext())

        total, blocked, capped, approved := pe.EnforcementStats()
        if total != 3 {
                t.Errorf("expected 3 total validations, got %d", total)
        }
        if blocked != 1 {
                t.Errorf("expected 1 blocked action, got %d", blocked)
        }
        if capped != 1 {
                t.Errorf("expected 1 capped action, got %d", capped)
        }
        // Both the first valid action and the capped action are approved (capped actions are still approved, just with reduced amount)
        if approved != 2 {
                t.Errorf("expected 2 approved actions, got %d", approved)
        }
}

// ─── ComputeMaxAmount Tests ─────────────────────────────────────────────────

func TestPolicyEngine_ComputeMaxAmount(t *testing.T) {
        pe := NewPolicyEngine()

        // 10% of 1,000,000,000 = 100,000,000
        result := pe.computeMaxAmount(1000, big.NewInt(1_000_000_000))
        expected := big.NewInt(100_000_000)
        if result.Cmp(expected) != 0 {
                t.Errorf("expected %s, got %s", expected.String(), result.String())
        }

        // 5% of 1,000,000,000 = 50,000,000
        result = pe.computeMaxAmount(500, big.NewInt(1_000_000_000))
        expected = big.NewInt(50_000_000)
        if result.Cmp(expected) != 0 {
                t.Errorf("expected %s, got %s", expected.String(), result.String())
        }

        // Zero vault value
        result = pe.computeMaxAmount(1000, big.NewInt(0))
        expected = big.NewInt(0)
        if result.Cmp(expected) != 0 {
                t.Errorf("expected %s, got %s", expected.String(), result.String())
        }

        // Zero bps
        result = pe.computeMaxAmount(0, big.NewInt(1_000_000_000))
        expected = big.NewInt(0)
        if result.Cmp(expected) != 0 {
                t.Errorf("expected %s, got %s", expected.String(), result.String())
        }
}

// ─── Agent Cannot Exceed Limits Tests ───────────────────────────────────────

func TestPolicyEngine_AgentCannotExceedRebalanceLimit(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Try to rebalance with a huge amount — should be capped
        largeAmount := big.NewInt(1_000_000_000) // 100% of vault
        result := pe.ValidateAction("aegis-vault", ActionTypeRebalance, largeAmount, ctx)

        if !result.IsValid {
                t.Errorf("expected valid (capped) rebalance, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        // The adjusted amount should be less than the original
        if result.AdjustedAmount.Cmp(result.OriginalAmount) >= 0 {
                t.Error("expected adjusted amount to be less than original")
        }
}

func TestPolicyEngine_AgentCannotExceedHedgeLimit(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()
        ctx.RiskScore = 55.0 // Above threshold

        // Try to hedge with a huge amount — should be capped
        largeAmount := big.NewInt(500_000_000) // 50% of vault
        result := pe.ValidateAction("aegis-vault", ActionTypeHedge, largeAmount, ctx)

        if !result.IsValid {
                t.Errorf("expected valid (capped) hedge, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        if result.AdjustedAmount.Cmp(result.OriginalAmount) >= 0 {
                t.Error("expected adjusted amount to be less than original")
        }
}

func TestPolicyEngine_AgentCannotExceedDeleverageLimit(t *testing.T) {
        pe := newTestPolicyEngine()
        ctx := newTestPositionContext()

        // Try to deleverage with a huge amount — should be capped
        largeAmount := big.NewInt(500_000_000) // 50% of vault
        result := pe.ValidateAction("aegis-vault", ActionTypeDeleverage, largeAmount, ctx)

        if !result.IsValid {
                t.Errorf("expected valid (capped) deleverage, got: %s", result.Reason)
        }
        if !result.WasCapped {
                t.Error("expected amount to be capped")
        }
        if result.AdjustedAmount.Cmp(result.OriginalAmount) >= 0 {
                t.Error("expected adjusted amount to be less than original")
        }
}

func TestPolicyEngine_AgentCannotExceedDrawdownLimit(t *testing.T) {
        // Test with different policies
        for _, policyID := range []uint64{1, 2, 3} {
                pe2 := NewPolicyEngine()
                pe2.LoadDefaultPolicies()
                vaultName := fmt.Sprintf("vault-%d", policyID)
                pe2.AssignPolicy(vaultName, policyID)

                policy, _ := pe2.GetPolicy(policyID)
                ctx := newTestPositionContext()
                ctx.CurrentDrawdownBps = policy.MaxDrawdownBps + 100 // Just over the limit

                result := pe2.ValidateAction(vaultName, ActionTypeRebalance, big.NewInt(50_000_000), ctx)
                if result.IsValid {
                        t.Errorf("expected rebalance to be blocked for policy %d (drawdown exceeded)", policyID)
                }
        }
}

func TestPolicyEngine_AgentCannotRebalanceWhenInsolvent(t *testing.T) {
        ctx := newTestPositionContext()
        ctx.CollateralRatioBps = 10000 // 100% — below all policy minimums

        // Test with all policies
        for _, policyID := range []uint64{1, 2, 3} {
                pe2 := NewPolicyEngine()
                pe2.LoadDefaultPolicies()
                vaultName := fmt.Sprintf("vault-%d", policyID)
                pe2.AssignPolicy(vaultName, policyID)

                result := pe2.ValidateAction(vaultName, ActionTypeRebalance, big.NewInt(50_000_000), ctx)
                if result.IsValid {
                        t.Errorf("expected rebalance to be blocked for policy %d (insufficient collateral)", policyID)
                }
        }
}

// ─── Default Policy Verification Tests ──────────────────────────────────────

func TestPolicyEngine_DefaultPolicies_ReportSpecFields(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()

        // Verify report-specified fields (Section 9.4.5)
        conservative, _ := pe.GetPolicy(1)
        if conservative.MaxDrawdownBps != 1500 {
                t.Errorf("Conservative maxDrawdownBps: expected 1500, got %d", conservative.MaxDrawdownBps)
        }
        if conservative.MaxSingleExposureBps != 4000 {
                t.Errorf("Conservative maxSingleExposureBps: expected 4000, got %d", conservative.MaxSingleExposureBps)
        }
        if conservative.HedgeThresholdBps != 800 {
                t.Errorf("Conservative hedgeThresholdBps: expected 800, got %d", conservative.HedgeThresholdBps)
        }
        if len(conservative.AllowedAssets) == 0 {
                t.Error("Conservative allowedAssets should not be empty")
        }

        balanced, _ := pe.GetPolicy(2)
        if balanced.MaxDrawdownBps != 2500 {
                t.Errorf("Balanced maxDrawdownBps: expected 2500, got %d", balanced.MaxDrawdownBps)
        }
        if balanced.MaxSingleExposureBps != 6000 {
                t.Errorf("Balanced maxSingleExposureBps: expected 6000, got %d", balanced.MaxSingleExposureBps)
        }
        if balanced.HedgeThresholdBps != 1200 {
                t.Errorf("Balanced hedgeThresholdBps: expected 1200, got %d", balanced.HedgeThresholdBps)
        }

        aggressive, _ := pe.GetPolicy(3)
        if aggressive.MaxDrawdownBps != 4000 {
                t.Errorf("Aggressive maxDrawdownBps: expected 4000, got %d", aggressive.MaxDrawdownBps)
        }
        if aggressive.MaxSingleExposureBps != 8000 {
                t.Errorf("Aggressive maxSingleExposureBps: expected 8000, got %d", aggressive.MaxSingleExposureBps)
        }
        if aggressive.HedgeThresholdBps != 2000 {
                t.Errorf("Aggressive hedgeThresholdBps: expected 2000, got %d", aggressive.HedgeThresholdBps)
        }
}

func TestPolicyEngine_DefaultPolicies_RebalanceAmountCaps(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()

        // Verify rebalance amount caps are set
        conservative, _ := pe.GetPolicy(1)
        if conservative.MaxRebalanceAmountBps == 0 {
                t.Error("Conservative MaxRebalanceAmountBps should not be zero")
        }

        balanced, _ := pe.GetPolicy(2)
        if balanced.MaxRebalanceAmountBps == 0 {
                t.Error("Balanced MaxRebalanceAmountBps should not be zero")
        }

        aggressive, _ := pe.GetPolicy(3)
        if aggressive.MaxRebalanceAmountBps == 0 {
                t.Error("Aggressive MaxRebalanceAmountBps should not be zero")
        }
        // Aggressive should allow more rebalance than Conservative
        if aggressive.MaxRebalanceAmountBps <= conservative.MaxRebalanceAmountBps {
                t.Error("Aggressive should allow more rebalance than Conservative")
        }
}

// ─── PositionContext Tests ──────────────────────────────────────────────────

func TestDefaultPositionContext(t *testing.T) {
        ctx := DefaultPositionContext()
        if ctx.TotalVaultValue.Sign() != 0 {
                t.Error("expected zero total vault value")
        }
        if ctx.CollateralRatioBps != 999999 {
                t.Error("expected fully solvent default")
        }
        if ctx.CurrentLeverageBps != 10000 {
                t.Error("expected 1x default leverage")
        }
}

// ─── ListPolicies Tests ─────────────────────────────────────────────────────

func TestPolicyEngine_ListPolicies(t *testing.T) {
        pe := NewPolicyEngine()
        pe.LoadDefaultPolicies()

        policies := pe.ListPolicies()
        if len(policies) != 3 {
                t.Errorf("expected 3 policies, got %d", len(policies))
        }
}


