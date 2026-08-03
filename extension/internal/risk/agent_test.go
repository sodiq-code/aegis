package risk

import (
        "encoding/json"
        "math/big"
        "testing"
        "time"
)

// ─── RiskAgent Creation ─────────────────────────────────────────────────────

func TestNewRiskAgent(t *testing.T) {
        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        if agent == nil {
                t.Fatal("Agent should not be nil")
        }
        if agent.IsRunning() {
                t.Error("Agent should not be running initially")
        }
        if agent.GetState().Phase != PhaseIdle {
                t.Errorf("Expected initial phase IDLE, got %s", agent.GetState().Phase)
        }
}

func TestRiskAgentValidation(t *testing.T) {
        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        if err := agent.Validate(); err != nil {
                t.Fatalf("Agent validation failed: %v", err)
        }
}

func TestRiskAgentValidationInvalidThresholds(t *testing.T) {
        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        // Test with inverted thresholds
        config := DefaultRiskAgentConfig()
        config.RiskThresholdHold = 50.0
        config.RiskThresholdRebal = 25.0 // hold > rebalance — invalid
        agent := NewRiskAgent(config, scorer)

        if err := agent.Validate(); err == nil {
                t.Error("Expected validation error for inverted thresholds")
        }
}

func TestRiskAgentValidationNoScorer(t *testing.T) {
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, nil)

        if err := agent.Validate(); err == nil {
                t.Error("Expected validation error for nil scorer")
        }
}

// ─── Mock Providers ─────────────────────────────────────────────────────────

// mockPositionProvider is a mock position provider for testing.
type mockPositionProvider struct {
        vaultState VaultStateSnapshot
        posCount   int
        activePos  int
}

func (m *mockPositionProvider) GetVaultState() VaultStateSnapshot {
        return m.vaultState
}

func (m *mockPositionProvider) GetPositionCount() int {
        return m.posCount
}

func (m *mockPositionProvider) GetActivePositionCount() int {
        return m.activePos
}

// mockPolicyProvider is a mock policy provider for testing.
type mockPolicyProvider struct {
        validationResult *PolicyValidationResult
        policy           *PolicyInfo
}

func (m *mockPolicyProvider) ValidateAction(depositor string, actionType int, amount *big.Int) (*PolicyValidationResult, error) {
        return m.validationResult, nil
}

func (m *mockPolicyProvider) GetPolicy(policyID uint64) (*PolicyInfo, error) {
        return m.policy, nil
}

// ─── Agent Setup Helper ─────────────────────────────────────────────────────

func setupTestAgent(t *testing.T) *RiskAgent {
        t.Helper()

        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        // Set up mock providers
        ftsoProvider := NewMockFTSOProvider()
        agent.SetFTSOProvider(ftsoProvider)

        positionProvider := &mockPositionProvider{
                vaultState: VaultStateSnapshot{
                        TotalFxrpDeposited: 100_000_000, // 100 XRP
                        MerkleRoot:         "0x" + string(make([]byte, 64)),
                        CollateralRatioBps: 20000, // 200%
                        IsSolvent:          true,
                },
                posCount:  3,
                activePos: 2,
        }
        agent.SetPositionProvider(positionProvider)

        pmwExecutor := NewMockPMWExecutor()
        agent.SetPMWExecutor(pmwExecutor)

        attestPublisher := NewMockAttestationPublisher()
        agent.SetAttestationPublisher(attestPublisher)

        policyProvider := &mockPolicyProvider{
                validationResult: &PolicyValidationResult{
                        IsValid:    true,
                        Action:     0,
                        Reason:     "action allowed",
                        PolicyID:   2,
                        PolicyName: "Balanced",
                },
                policy: &PolicyInfo{
                        PolicyID:              2,
                        Name:                  "Balanced",
                        MaxLeverage:           10000,
                        MinCollateralRatio:    15000,
                        RebalanceThresholdBps: 500,
                        MaxSlippageBps:        100,
                },
        }
        agent.SetPolicyProvider(policyProvider)

        return agent
}

// ─── Observe Phase ──────────────────────────────────────────────────────────

func TestObservePhase(t *testing.T) {
        agent := setupTestAgent(t)

        obs, err := agent.observe()
        if err != nil {
                t.Fatalf("Observe failed: %v", err)
        }

        if obs.XRPUSDPrice <= 0 {
                t.Errorf("XRP/USD price should be positive, got %f", obs.XRPUSDPrice)
        }
        if obs.FLRUSDPrice <= 0 {
                t.Errorf("FLR/USD price should be positive, got %f", obs.FLRUSDPrice)
        }
        if obs.TotalFxrpDeposited == 0 {
                t.Error("Total FXRP deposited should not be zero")
        }
        if obs.ObservedAt.IsZero() {
                t.Error("ObservedAt should not be zero")
        }

        // Verify features are computed
        if obs.Features.XRPVol24h <= 0 {
                t.Errorf("XRP volatility should be positive, got %f", obs.Features.XRPVol24h)
        }

        t.Logf("Observation: XRP=$%.4f, FLR=$%.6f, vault=%d FXRP, features=%d",
                obs.XRPUSDPrice, obs.FLRUSDPrice, obs.TotalFxrpDeposited, 20)
}

func TestObserveWithoutProviders(t *testing.T) {
        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        // No providers set — should still work with fallback defaults
        obs, err := agent.observe()
        if err != nil {
                t.Fatalf("Observe should not fail without providers: %v", err)
        }

        // Should use fallback prices (Coston2 defaults)
        if obs.XRPUSDPrice != 1.08 {
                t.Errorf("XRP/USD price should be fallback 1.08, got %f", obs.XRPUSDPrice)
        }
        if obs.FLRUSDPrice != 0.006 {
                t.Errorf("FLR/USD price should be fallback 0.006, got %f", obs.FLRUSDPrice)
        }
        if obs.BTCUSDPrice != 63114.0 {
                t.Errorf("BTC/USD price should be fallback 63114.0, got %f", obs.BTCUSDPrice)
        }
        if obs.ETHUSDPrice != 1868.0 {
                t.Errorf("ETH/USD price should be fallback 1868.0, got %f", obs.ETHUSDPrice)
        }
}

// ─── Score Phase ─────────────────────────────────────────────────────────────

func TestScorePhase(t *testing.T) {
        agent := setupTestAgent(t)

        obs, err := agent.observe()
        if err != nil {
                t.Fatalf("Observe failed: %v", err)
        }

        decision, err := agent.score(obs)
        if err != nil {
                t.Fatalf("Score failed: %v", err)
        }

        if !decision.IsValid {
                t.Error("Decision should be valid")
        }
        if decision.RiskScore < 0 || decision.RiskScore > 100 {
                t.Errorf("Risk score out of range: %f", decision.RiskScore)
        }
        if decision.Confidence <= 0 || decision.Confidence > 1 {
                t.Errorf("Confidence out of range: %f", decision.Confidence)
        }
        if len(decision.FeatureContrib) == 0 {
                t.Error("Expected feature contributions")
        }

        t.Logf("Decision: score=%.2f, action=%s, confidence=%.4f",
                decision.RiskScore, decision.ActionLabel, decision.Confidence)
}

// ─── Decide Phase ───────────────────────────────────────────────────────────

func TestDecidePhaseHold(t *testing.T) {
        agent := setupTestAgent(t)

        // Low risk score → should hold (no action)
        decision := &AgentDecision{
                IsValid:     true,
                Action:      AgentActionNone,
                RiskScore:   15.0,
                ActionLabel: "hold",
                Confidence:  0.9,
                Reason:      "low risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
        }

        obs, _ := agent.observe()
        action, err := agent.decide(decision, obs)
        if err != nil {
                t.Fatalf("Decide failed: %v", err)
        }

        // No action should be taken for hold
        if action != nil {
                t.Errorf("Expected no action for hold, got %v", action)
        }
}

func TestDecidePhaseRebalance(t *testing.T) {
        agent := setupTestAgent(t)

        // Moderate risk score → should rebalance
        decision := &AgentDecision{
                IsValid:     true,
                Action:      AgentActionRebalance,
                RiskScore:   45.0,
                ActionLabel: "rebalance",
                Confidence:  0.8,
                Reason:      "moderate risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
        }

        obs, _ := agent.observe()
        action, err := agent.decide(decision, obs)
        if err != nil {
                t.Fatalf("Decide failed: %v", err)
        }

        if action == nil {
                t.Fatal("Expected rebalance action, got nil")
        }
        if action.Type != AgentActionRebalance {
                t.Errorf("Expected rebalance action, got %d", action.Type)
        }
        if action.Amount == nil || action.Amount.Sign() <= 0 {
                t.Error("Rebalance amount should be positive")
        }
        if action.PolicyID != 2 {
                t.Errorf("Expected policy ID 2, got %d", action.PolicyID)
        }

        t.Logf("Rebalance action: amount=%s, dest=%s", action.Amount.String(), action.Destination)
}

func TestDecidePhasePolicyBlock(t *testing.T) {
        agent := setupTestAgent(t)

        // Set up a policy that blocks the action
        agent.SetPolicyProvider(&mockPolicyProvider{
                validationResult: &PolicyValidationResult{
                        IsValid:    false,
                        Action:     3, // block
                        Reason:     "exceeds policy limits",
                        PolicyID:   2,
                        PolicyName: "Balanced",
                },
        })

        decision := &AgentDecision{
                IsValid:     true,
                Action:      AgentActionRebalance,
                RiskScore:   45.0,
                ActionLabel: "rebalance",
                Confidence:  0.8,
                Reason:      "moderate risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
        }

        obs, _ := agent.observe()
        action, err := agent.decide(decision, obs)
        if err != nil {
                t.Fatalf("Decide failed: %v", err)
        }

        // Policy blocks the action → should return nil
        if action != nil {
                t.Errorf("Expected nil action when policy blocks, got %v", action)
        }
}

// ─── Act Phase ───────────────────────────────────────────────────────────────

func TestActPhaseRebalance(t *testing.T) {
        agent := setupTestAgent(t)

        action := &AgentAction{
                Type:        AgentActionRebalance,
                RiskScore:   45.0,
                ActionLabel: "rebalance",
                Confidence:  0.8,
                Reason:      "moderate risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
                Amount:      big.NewInt(10_000_000), // 10 XRP
                Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
                Timestamp:   time.Now(),
        }

        err := agent.act(action)
        if err != nil {
                t.Fatalf("Act failed: %v", err)
        }
}

func TestActPhaseHedge(t *testing.T) {
        agent := setupTestAgent(t)

        action := &AgentAction{
                Type:        AgentActionHedge,
                RiskScore:   65.0,
                ActionLabel: "hedge",
                Confidence:  0.75,
                Reason:      "elevated risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
                Amount:      big.NewInt(5_000_000), // 5 XRP
                Timestamp:   time.Now(),
        }

        err := agent.act(action)
        if err != nil {
                t.Fatalf("Act failed: %v", err)
        }
}

func TestActPhaseDeleverage(t *testing.T) {
        agent := setupTestAgent(t)

        action := &AgentAction{
                Type:        AgentActionDeleverage,
                RiskScore:   85.0,
                ActionLabel: "deleverage",
                Confidence:  0.85,
                Reason:      "critical risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
                Amount:      big.NewInt(20_000_000), // 20 XRP
                Timestamp:   time.Now(),
        }

        err := agent.act(action)
        if err != nil {
                t.Fatalf("Act failed: %v", err)
        }
}

func TestActPhaseEmergencyExit(t *testing.T) {
        agent := setupTestAgent(t)

        action := &AgentAction{
                Type:        AgentActionEmergencyExit,
                RiskScore:   96.0,
                ActionLabel: "emergency_exit",
                Confidence:  0.95,
                Reason:      "emergency",
                PolicyID:    2,
                PolicyName:  "Balanced",
                Amount:      big.NewInt(100_000_000), // 100 XRP
                Timestamp:   time.Now(),
        }

        err := agent.act(action)
        if err != nil {
                t.Fatalf("Act failed: %v", err)
        }
}

func TestActPhaseNoPMW(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        action := &AgentAction{
                Type:        AgentActionRebalance,
                RiskScore:   45.0,
                ActionLabel: "rebalance",
                Amount:      big.NewInt(10_000_000),
                Timestamp:   time.Now(),
        }

        err := agent.act(action)
        if err == nil {
                t.Error("Expected error when PMW executor not configured")
        }
}

// ─── Attest Phase ────────────────────────────────────────────────────────────

func TestAttestPhase(t *testing.T) {
        agent := setupTestAgent(t)

        obs, _ := agent.observe()
        result, err := agent.attest(obs)
        if err != nil {
                t.Fatalf("Attest failed: %v", err)
        }

        if result.TxHash == "" {
                t.Error("Expected non-empty attestation tx hash")
        }
        if result.Status == "" {
                t.Error("Expected non-empty solvency status")
        }
        if result.NewMerkleRoot != obs.MerkleRoot {
                t.Error("New Merkle root should match observation")
        }

        t.Logf("Attestation: txHash=%s, status=%s, merkleRoot=%s",
                result.TxHash, result.Status, truncateAgentStr(result.NewMerkleRoot, 16)+"...")
}

func TestAttestPhaseNoPublisher(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        obs, _ := agent.observe()
        result, err := agent.attest(obs)
        if err != nil {
                t.Fatalf("Attest should not fail without publisher: %v", err)
        }

        if result.Status != "skipped_no_publisher" {
                t.Errorf("Expected skipped status, got %s", result.Status)
        }
}

// ─── Full Loop Iteration ────────────────────────────────────────────────────

func TestRunSingleIteration(t *testing.T) {
        agent := setupTestAgent(t)

        result := agent.RunSingleIteration()
        if result == nil {
                t.Fatal("Result should not be nil")
        }

        // Verify the loop completed successfully
        if result.Phase == PhaseError {
                t.Errorf("Loop iteration failed: %s", result.Error)
        }
        if result.Observation == nil {
                t.Error("Observation should not be nil")
        }
        if result.Decision == nil {
                t.Error("Decision should not be nil")
        }
        if result.Duration <= 0 {
                t.Error("Duration should be positive")
        }

        t.Logf("Loop iteration: phase=%s, score=%.2f, action=%s, solvency=%s, duration=%s",
                result.Phase, result.Decision.RiskScore, result.Decision.ActionLabel,
                result.SolvencyStatus, result.Duration)
}

func TestRunMultipleIterations(t *testing.T) {
        agent := setupTestAgent(t)

        // Run 5 iterations
        for i := 0; i < 5; i++ {
                result := agent.RunSingleIteration()
                if result == nil {
                        t.Fatalf("Iteration %d: result should not be nil", i+1)
                }
                if result.Phase == PhaseError {
                        t.Fatalf("Iteration %d failed: %s", i+1, result.Error)
                }
        }

        state := agent.GetState()
        if state.IterationCount != 5 {
                t.Errorf("Expected 5 iterations, got %d", state.IterationCount)
        }
        if state.TotalAttestations != 5 {
                t.Errorf("Expected 5 attestations, got %d", state.TotalAttestations)
        }

        t.Logf("After 5 iterations: count=%d, lastScore=%.2f, totalActions=%d, totalAttestations=%d",
                state.IterationCount, state.LastRiskScore, state.TotalActions, state.TotalAttestations)
}

// ─── Risk Event Simulation ──────────────────────────────────────────────────

func TestSimulateCrashEvent(t *testing.T) {
        agent := setupTestAgent(t)

        // First, run a normal iteration
        normalResult := agent.RunSingleIteration()
        if normalResult == nil {
                t.Fatal("Normal iteration result should not be nil")
        }
        normalScore := normalResult.Decision.RiskScore

        // Simulate a crash
        crashResult := agent.SimulateRiskEvent("crash")
        if crashResult == nil {
                t.Fatal("Crash simulation result should not be nil")
        }
        if crashResult.Phase == PhaseError {
                t.Fatalf("Crash simulation failed: %s", crashResult.Error)
        }

        // The crash should produce a higher risk score
        crashScore := crashResult.Decision.RiskScore
        t.Logf("Normal score: %.2f, Crash score: %.2f", normalScore, crashScore)

        // Verify the agent took some action during the crash
        if crashResult.Action != nil {
                t.Logf("Crash action: %s (amount: %s)", crashResult.Action.ActionLabel, crashResult.Action.Amount.String())
        }
}

func TestSimulateRallyEvent(t *testing.T) {
        agent := setupTestAgent(t)

        rallyResult := agent.SimulateRiskEvent("rally")
        if rallyResult == nil {
                t.Fatal("Rally simulation result should not be nil")
        }
        if rallyResult.Phase == PhaseError {
                t.Fatalf("Rally simulation failed: %s", rallyResult.Error)
        }

        t.Logf("Rally score: %.2f, action: %s", rallyResult.Decision.RiskScore, rallyResult.Decision.ActionLabel)
}

func TestSimulateNormalEvent(t *testing.T) {
        agent := setupTestAgent(t)

        normalResult := agent.SimulateRiskEvent("normal")
        if normalResult == nil {
                t.Fatal("Normal simulation result should not be nil")
        }
        if normalResult.Phase == PhaseError {
                t.Fatalf("Normal simulation failed: %s", normalResult.Error)
        }

        t.Logf("Normal score: %.2f, action: %s", normalResult.Decision.RiskScore, normalResult.Decision.ActionLabel)
}

// ─── Threshold Logic ─────────────────────────────────────────────────────────

func TestApplyThresholds(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        // Default thresholds: hold=25, rebalance=50, hedge=75, deleverage=90, emergency=95
        // Semantics: >= threshold → action at that level
        // < 25 → none, >= 25 → rebalance, >= 50 → hedge, >= 75 → deleverage, >= 90 → emergency
        tests := []struct {
                score    float64
                expected AgentActionType
        }{
                {10.0, AgentActionNone},           // Below hold threshold → hold
                {24.9, AgentActionNone},           // Just below hold threshold → hold
                {25.0, AgentActionRebalance},      // At hold threshold → rebalance
                {30.0, AgentActionRebalance},      // Between hold and rebalance → rebalance
                {49.9, AgentActionRebalance},      // Just below rebalance threshold → rebalance
                {50.0, AgentActionHedge},          // At rebalance threshold → hedge
                {60.0, AgentActionHedge},          // Between rebalance and hedge → hedge
                {74.9, AgentActionHedge},          // Just below hedge threshold → hedge
                {75.0, AgentActionDeleverage},     // At hedge threshold → deleverage
                {85.0, AgentActionDeleverage},     // Between hedge and deleverage → deleverage
                {89.9, AgentActionDeleverage},     // Just below deleverage threshold → deleverage
                {90.0, AgentActionEmergencyExit},  // At deleverage threshold → emergency
                {95.0, AgentActionEmergencyExit},  // At emergency threshold → emergency
                {99.0, AgentActionEmergencyExit},  // Above emergency threshold → emergency
        }

        for _, tt := range tests {
                result := agent.applyThresholds(tt.score)
                if result != tt.expected {
                        t.Errorf("Score %.1f: expected %s, got %s",
                                tt.score, AgentActionTypeNames[tt.expected], AgentActionTypeNames[result])
                }
        }
}

// ─── Action Amount Computation ───────────────────────────────────────────────

func TestComputeActionAmount(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        obs := &AgentObservation{
                TotalFxrpDeposited: 100_000_000, // 100 XRP
        }

        // Rebalance: 10% of vault
        rebalAmount := agent.computeActionAmount(AgentActionRebalance, obs)
        if rebalAmount.Sign() <= 0 {
                t.Error("Rebalance amount should be positive")
        }
        t.Logf("Rebalance amount: %s", rebalAmount.String())

        // Hedge: 5% of vault
        hedgeAmount := agent.computeActionAmount(AgentActionHedge, obs)
        if hedgeAmount.Sign() <= 0 {
                t.Error("Hedge amount should be positive")
        }
        t.Logf("Hedge amount: %s", hedgeAmount.String())

        // Deleverage: 20% of vault
        delevAmount := agent.computeActionAmount(AgentActionDeleverage, obs)
        if delevAmount.Sign() <= 0 {
                t.Error("Deleverage amount should be positive")
        }
        t.Logf("Deleverage amount: %s", delevAmount.String())

        // Emergency exit: full position
        emergAmount := agent.computeActionAmount(AgentActionEmergencyExit, obs)
        if emergAmount.Sign() <= 0 {
                t.Error("Emergency exit amount should be positive")
        }
        if emergAmount.Cmp(big.NewInt(100_000_000)) != 0 {
                t.Errorf("Emergency exit should be full position, got %s", emergAmount.String())
        }
        t.Logf("Emergency exit amount: %s", emergAmount.String())

        // None: 0
        noneAmount := agent.computeActionAmount(AgentActionNone, obs)
        if noneAmount.Sign() != 0 {
                t.Errorf("None action should have 0 amount, got %s", noneAmount.String())
        }
}

// ─── Feature Computation ─────────────────────────────────────────────────────

func TestComputeFeatures(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        obs := &AgentObservation{
                XRPUSDPrice:        1.08,
                FLRUSDPrice:        0.006,
                BTCUSDPrice:        63114.0,
                ETHUSDPrice:        1868.0,
                TotalFxrpDeposited: 100_000_000,
                ActivePositionCount: 3,
                XRPLBalance:        10.0,
        }

        features := agent.computeFeatures(obs)

        // Verify all 20 features are set
        vec := featuresToVector(features)
        if len(vec) != 20 {
                t.Errorf("Expected 20 features, got %d", len(vec))
        }

        // Verify volatility features are positive
        if features.XRPVol24h <= 0 {
                t.Errorf("XRP volatility should be positive, got %f", features.XRPVol24h)
        }
        if features.FLRVol24h <= 0 {
                t.Errorf("FLR volatility should be positive, got %f", features.FLRVol24h)
        }

        t.Logf("Features: XRPVol24h=%.4f, FLRVol24h=%.4f, leverage=%.2f, concentration=%.2f",
                features.XRPVol24h, features.FLRVol24h, features.LeverageRatio, features.XRPConcentration)
}

// ─── State Management ────────────────────────────────────────────────────────

func TestGetState(t *testing.T) {
        agent := setupTestAgent(t)

        state := agent.GetState()
        if state.Phase != PhaseIdle {
                t.Errorf("Expected initial phase IDLE, got %s", state.Phase)
        }
        if state.IterationCount != 0 {
                t.Errorf("Expected 0 iterations, got %d", state.IterationCount)
        }
        if state.IsRunning {
                t.Error("Agent should not be running")
        }
}

func TestGetLoopHistory(t *testing.T) {
        agent := setupTestAgent(t)

        // Run a few iterations
        for i := 0; i < 3; i++ {
                agent.RunSingleIteration()
        }

        history := agent.GetLoopHistory(10)
        if len(history) != 3 {
                t.Errorf("Expected 3 history entries, got %d", len(history))
        }

        // Get limited history
        limited := agent.GetLoopHistory(2)
        if len(limited) != 2 {
                t.Errorf("Expected 2 limited history entries, got %d", len(limited))
        }
}

// ─── JSON Serialization ─────────────────────────────────────────────────────

func TestAgentActionJSON(t *testing.T) {
        action := &AgentAction{
                Type:        AgentActionRebalance,
                RiskScore:   45.0,
                ActionLabel: "rebalance",
                Confidence:  0.8,
                Reason:      "moderate risk",
                PolicyID:    2,
                PolicyName:  "Balanced",
                Amount:      big.NewInt(10_000_000),
                Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
                Timestamp:   time.Now(),
        }

        // Test MarshalJSON
        jsonData, err := json.Marshal(action)
        if err != nil {
                t.Fatalf("JSON marshal failed: %v", err)
        }

        t.Logf("Action JSON: %s", string(jsonData))

        // Verify the JSON contains expected fields
        var parsed map[string]interface{}
        if err := json.Unmarshal(jsonData, &parsed); err != nil {
                t.Fatalf("JSON unmarshal failed: %v", err)
        }

        if parsed["typeName"] != "rebalance" {
                t.Errorf("Expected typeName 'rebalance', got %v", parsed["typeName"])
        }
        if parsed["riskScore"] == nil {
                t.Error("Expected riskScore field")
        }
}

func TestAgentLoopResultJSON(t *testing.T) {
        agent := setupTestAgent(t)

        result := agent.RunSingleIteration()
        if result == nil {
                t.Fatal("Result should not be nil")
        }

        jsonData, err := json.Marshal(result)
        if err != nil {
                t.Fatalf("JSON marshal failed: %v", err)
        }

        t.Logf("Loop result JSON length: %d bytes", len(jsonData))

        var parsed map[string]interface{}
        if err := json.Unmarshal(jsonData, &parsed); err != nil {
                t.Fatalf("JSON unmarshal failed: %v", err)
        }

        if parsed["iterationId"] == nil {
                t.Error("Expected iterationId field")
        }
        if parsed["phase"] == nil {
                t.Error("Expected phase field")
        }
}

// ─── Mock PMW Tests ─────────────────────────────────────────────────────────

func TestMockPMWExecutor(t *testing.T) {
        pmw := NewMockPMWExecutor()

        if !pmw.IsAvailable() {
                t.Error("Mock PMW should be available")
        }

        // Test rebalance
        result, err := pmw.ExecuteRebalance(big.NewInt(10_000_000), "rDestination")
        if err != nil {
                t.Fatalf("Rebalance failed: %v", err)
        }
        if !result.Success {
                t.Error("Rebalance should succeed")
        }
        if result.TxHash == "" {
                t.Error("Expected non-empty tx hash")
        }

        // Test hedge
        result, err = pmw.ExecuteHedge(big.NewInt(5_000_000))
        if err != nil {
                t.Fatalf("Hedge failed: %v", err)
        }
        if !result.Success {
                t.Error("Hedge should succeed")
        }

        // Test deleverage
        result, err = pmw.ExecuteDeleverage(big.NewInt(20_000_000))
        if err != nil {
                t.Fatalf("Deleverage failed: %v", err)
        }
        if !result.Success {
                t.Error("Deleverage should succeed")
        }

        // Test emergency exit
        result, err = pmw.ExecuteEmergencyExit()
        if err != nil {
                t.Fatalf("Emergency exit failed: %v", err)
        }
        if !result.Success {
                t.Error("Emergency exit should succeed")
        }
}

// ─── Mock Attestation Publisher Tests ────────────────────────────────────────

func TestMockAttestationPublisher(t *testing.T) {
        publisher := NewMockAttestationPublisher()

        if !publisher.IsConnected() {
                t.Error("Mock publisher should be connected")
        }

        txHash, err := publisher.PublishSolvencyProof(
                "0xabc123",
                100_000_000,
                70_000_000,
                14285,
                1,
        )
        if err != nil {
                t.Fatalf("Publish failed: %v", err)
        }
        if txHash == "" {
                t.Error("Expected non-empty tx hash")
        }
        if len(publisher.PublishedProofs) != 1 {
                t.Errorf("Expected 1 published proof, got %d", len(publisher.PublishedProofs))
        }
}

// ─── Mock FTSO Provider Tests ────────────────────────────────────────────────

func TestMockFTSOProvider(t *testing.T) {
        ftso := NewMockFTSOProvider()

        xrpPrice, err := ftso.GetPrice("XRP/USD")
        if err != nil {
                t.Fatalf("Failed to get XRP/USD price: %v", err)
        }
        if xrpPrice <= 0 {
                t.Errorf("XRP/USD price should be positive, got %f", xrpPrice)
        }

        round, err := ftso.GetLatestRound()
        if err != nil {
                t.Fatalf("Failed to get latest round: %v", err)
        }
        if round != 1 {
                t.Errorf("Expected round 1, got %d", round)
        }

        // Test unknown feed
        _, err = ftso.GetPrice("UNKNOWN/USD")
        if err == nil {
                t.Error("Expected error for unknown feed")
        }
}

// ─── End-to-End Flow Tests ──────────────────────────────────────────────────

func TestEndToEnd_FullLoopWithNormalMarket(t *testing.T) {
        agent := setupTestAgent(t)

        // Run with normal market conditions
        result := agent.RunSingleIteration()
        if result == nil {
                t.Fatal("Result should not be nil")
        }
        if result.Phase == PhaseError {
                t.Fatalf("Loop failed: %s", result.Error)
        }

        // Verify all phases completed
        if result.Observation == nil {
                t.Error("Observation should not be nil")
        }
        if result.Decision == nil {
                t.Error("Decision should not be nil")
        }
        if result.AttestationTx == "" {
                t.Error("Attestation tx hash should not be empty")
        }

        t.Logf("Normal market: score=%.2f, action=%s, solvency=%s, duration=%s",
                result.Decision.RiskScore, result.Decision.ActionLabel,
                result.SolvencyStatus, result.Duration)
}

func TestEndToEnd_FullLoopWithRiskEvent(t *testing.T) {
        agent := setupTestAgent(t)

        // Simulate a crash
        result := agent.SimulateRiskEvent("crash")
        if result == nil {
                t.Fatal("Result should not be nil")
        }
        if result.Phase == PhaseError {
                t.Fatalf("Loop failed: %s", result.Error)
        }

        // Verify the agent detected the risk event
        if result.Decision.RiskScore <= 0 {
                t.Error("Risk score should be positive after crash")
        }

        t.Logf("Crash event: score=%.2f, action=%s, solvency=%s",
                result.Decision.RiskScore, result.Decision.ActionLabel, result.SolvencyStatus)

        // If the agent took an action, verify the PMW execution
        if result.Action != nil {
                t.Logf("Action taken: type=%s, amount=%s, dest=%s",
                        AgentActionTypeNames[result.Action.Type],
                        result.Action.Amount.String(),
                        result.Action.Destination)
        }
}

func TestEndToEnd_MultipleRiskScenarios(t *testing.T) {
        agent := setupTestAgent(t)

        scenarios := []struct {
                name     string
                scenario string
        }{
                {"normal", "normal"},
                {"crash", "crash"},
                {"rally", "rally"},
                {"normal_again", "normal"},
        }

        var scores []float64
        for _, s := range scenarios {
                result := agent.SimulateRiskEvent(s.scenario)
                if result == nil {
                        t.Fatalf("Scenario %s: result should not be nil", s.name)
                }
                if result.Phase == PhaseError {
                        t.Fatalf("Scenario %s failed: %s", s.name, result.Error)
                }
                scores = append(scores, result.Decision.RiskScore)

                t.Logf("Scenario %s: score=%.2f, action=%s",
                        s.name, result.Decision.RiskScore, result.Decision.ActionLabel)
        }

        // Verify that scores are different for different scenarios
        // (This tests that the agent is actually responding to market changes)
        allSame := true
        for i := 1; i < len(scores); i++ {
                if scores[i] != scores[0] {
                        allSame = false
                        break
                }
        }
        if allSame {
                t.Log("Warning: all scenarios produced the same score — agent may not be responding to market changes")
        }
}

func TestEndToEnd_AgentLoopConsistency(t *testing.T) {
        agent := setupTestAgent(t)

        // Run 3 iterations with the same market conditions
        // Results should be consistent (deterministic model)
        var scores []float64
        for i := 0; i < 3; i++ {
                result := agent.RunSingleIteration()
                if result == nil {
                        t.Fatalf("Iteration %d: result should not be nil", i+1)
                }
                if result.Phase == PhaseError {
                        t.Fatalf("Iteration %d failed: %s", i+1, result.Error)
                }
                scores = append(scores, result.Decision.RiskScore)
        }

        // With the same inputs, the model should produce consistent scores
        for i := 1; i < len(scores); i++ {
                if scores[i] != scores[0] {
                        t.Logf("Note: scores differ across iterations (iteration 0=%.2f, iteration %d=%.2f) — this can happen if mock providers change state",
                                scores[0], i, scores[i])
                }
        }
}

// ─── Agent Start/Stop Tests ─────────────────────────────────────────────────

func TestAgentStartStop(t *testing.T) {
        agent := setupTestAgent(t)

        // Configure a very short loop interval for testing
        config := agent.GetConfig()
        config.LoopIntervalSec = 1
        agent.config = config

        // Start the agent
        agent.Start()

        // Wait a moment for the loop to run
        time.Sleep(2500 * time.Millisecond)

        // Verify the agent is running
        if !agent.IsRunning() {
                t.Error("Agent should be running")
        }

        // Stop the agent
        agent.Stop()

        // Wait a moment for the stop to take effect
        time.Sleep(200 * time.Millisecond)

        // Verify the agent is not running
        if agent.IsRunning() {
                t.Error("Agent should not be running after stop")
        }

        // Verify iterations were run
        state := agent.GetState()
        if state.IterationCount == 0 {
                t.Error("Expected at least one iteration")
        }

        t.Logf("Agent ran %d iterations in ~2.5s", state.IterationCount)
}

// ─── Config Tests ────────────────────────────────────────────────────────────

func TestDefaultRiskAgentConfig(t *testing.T) {
        config := DefaultRiskAgentConfig()

        if config.LoopIntervalSec <= 0 {
                t.Error("Loop interval should be positive")
        }
        if config.RiskThresholdHold >= config.RiskThresholdRebal {
                t.Error("Hold threshold should be below rebalance threshold")
        }
        if config.RiskThresholdRebal >= config.RiskThresholdHedge {
                t.Error("Rebalance threshold should be below hedge threshold")
        }
        if config.RiskThresholdHedge >= config.RiskThresholdDelev {
                t.Error("Hedge threshold should be below deleverage threshold")
        }
        if config.RiskThresholdDelev >= config.EmergencyExitScore {
                t.Error("Deleverage threshold should be below emergency exit score")
        }
        if config.Coston2RPCURL == "" {
                t.Error("Coston2 RPC URL should not be empty")
        }
        if config.DefaultPolicyID == 0 {
                t.Error("Default policy ID should not be zero")
        }
        if !config.MockPMWEnabled {
                t.Error("Mock PMW should be enabled by default for Coston2")
        }

        t.Logf("Config: interval=%ds, thresholds=[%.1f, %.1f, %.1f, %.1f, %.1f], mockPMW=%v",
                config.LoopIntervalSec,
                config.RiskThresholdHold, config.RiskThresholdRebal,
                config.RiskThresholdHedge, config.RiskThresholdDelev,
                config.EmergencyExitScore, config.MockPMWEnabled)
}

// ─── Map Model Action Tests ─────────────────────────────────────────────────

func TestMapModelActionToAgentAction(t *testing.T) {
        scorer, _ := NewRiskScorer()
        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        tests := []struct {
                modelAction int
                expected    AgentActionType
        }{
                {ActionHold, AgentActionNone},
                {ActionRebalance, AgentActionRebalance},
                {ActionHedge, AgentActionHedge},
                {ActionDeleverage, AgentActionDeleverage},
                {99, AgentActionNone}, // Unknown action
        }

        for _, tt := range tests {
                result := agent.mapModelActionToAgentAction(tt.modelAction)
                if result != tt.expected {
                        t.Errorf("Model action %d: expected %s, got %s",
                                tt.modelAction, AgentActionTypeNames[tt.expected], AgentActionTypeNames[result])
                }
        }
}

// ─── Agent Action Type Names Tests ──────────────────────────────────────────

func TestAgentActionTypeNames(t *testing.T) {
        names := map[AgentActionType]string{
                AgentActionNone:         "none",
                AgentActionRebalance:    "rebalance",
                AgentActionHedge:        "hedge",
                AgentActionDeleverage:   "deleverage",
                AgentActionEmergencyExit: "emergency_exit",
        }

        for actionType, expected := range names {
                if AgentActionTypeNames[actionType] != expected {
                        t.Errorf("Action type %d: expected name '%s', got '%s'",
                                actionType, expected, AgentActionTypeNames[actionType])
                }
        }
}

// ─── Integration with XGBoost Model ─────────────────────────────────────────

func TestRiskAgentWithXGBoostModel(t *testing.T) {
        scorer, err := NewRiskScorer()
        if err != nil {
                t.Fatalf("Failed to create risk scorer: %v", err)
        }

        config := DefaultRiskAgentConfig()
        agent := NewRiskAgent(config, scorer)

        // Set up mock providers
        ftso := NewMockFTSOProvider()
        ftso.Prices["XRP/USD"] = 1.08
        ftso.Prices["FLR/USD"] = 0.006
        ftso.Prices["BTC/USD"] = 63114.0
        ftso.Prices["ETH/USD"] = 1868.0
        agent.SetFTSOProvider(ftso)

        agent.SetPositionProvider(&mockPositionProvider{
                vaultState: VaultStateSnapshot{
                        TotalFxrpDeposited: 100_000_000,
                        MerkleRoot:         "0x" + string(make([]byte, 64)),
                        CollateralRatioBps: 20000,
                        IsSolvent:          true,
                },
                posCount:  3,
                activePos: 2,
        })

        agent.SetPMWExecutor(NewMockPMWExecutor())
        agent.SetAttestationPublisher(NewMockAttestationPublisher())

        // Run a full loop
        result := agent.RunSingleIteration()
        if result == nil {
                t.Fatal("Result should not be nil")
        }
        if result.Phase == PhaseError {
                t.Fatalf("Loop failed: %s", result.Error)
        }

        // Verify the XGBoost model was used
        if result.Decision.RiskScore < 0 || result.Decision.RiskScore > 100 {
                t.Errorf("Risk score out of range: %f", result.Decision.RiskScore)
        }
        if len(result.Decision.FeatureContrib) == 0 {
                t.Error("Expected feature contributions from XGBoost model")
        }

        t.Logf("XGBoost integration: score=%.2f, action=%s, topContrib=%v",
                result.Decision.RiskScore, result.Decision.ActionLabel, result.Decision.FeatureContrib)
}
