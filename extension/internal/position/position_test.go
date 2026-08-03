package position

import (
        "encoding/json"
        "testing"
        "time"
)

// helper to create a test event
func newTestEvent(eventType string, positionID uint64, depositor string, amount uint64, usdValue uint64) *OnChainEvent {
        return &OnChainEvent{
                EventType:  eventType,
                PositionID: positionID,
                Depositor:  depositor,
                Amount:     amount,
                USDValue:   usdValue,
                Timestamp:  time.Now(),
                BlockNum:   1000,
                TxHash:     "0xtest",
        }
}

// ==========================================
// CONSTRUCTOR TESTS
// ==========================================

func TestNewPositionComputer(t *testing.T) {
        config := DefaultPositionComputerConfig()
        pc := NewPositionComputer(config)

        if pc == nil {
                t.Fatal("PositionComputer should not be nil")
        }
        if len(pc.positions) != 0 {
                t.Fatalf("Expected 0 positions, got %d", len(pc.positions))
        }
        if pc.vault == nil {
                t.Fatal("Vault state should not be nil")
        }
        if pc.xrpUsdPrice != 0 {
                t.Fatalf("Expected XRP/USD price 0, got %d", pc.xrpUsdPrice)
        }
}

func TestDefaultPositionComputerConfig(t *testing.T) {
        config := DefaultPositionComputerConfig()

        if config.RPCURL != "https://coston2-api.flare.network/ext/C/rpc" {
                t.Fatalf("Expected Coston2 RPC URL, got %s", config.RPCURL)
        }
        if config.MinCollateralRatioBps != 15000 {
                t.Fatalf("Expected 15000 min collateral ratio, got %d", config.MinCollateralRatioBps)
        }
        if config.MaxPositionCount != 1000 {
                t.Fatalf("Expected 1000 max position count, got %d", config.MaxPositionCount)
        }
        if config.RevaluationIntervalSec != 300 {
                t.Fatalf("Expected 300 revaluation interval, got %d", config.RevaluationIntervalSec)
        }
}

// ==========================================
// DEPOSIT EVENT TESTS
// ==========================================

func TestProcessEvent_DepositMade(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        event := newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000)
        err := pc.ProcessEvent(event)
        if err != nil {
                t.Fatalf("Failed to process DepositMade: %v", err)
        }

        // Verify position was created
        position, err := pc.GetPosition(1)
        if err != nil {
                t.Fatalf("Position not found: %v", err)
        }
        if position.Depositor != "0xDepositor1" {
                t.Fatalf("Expected depositor 0xDepositor1, got %s", position.Depositor)
        }
        if position.FxrpAmount != 100_000_000 {
                t.Fatalf("Expected FXRP amount 100000000, got %d", position.FxrpAmount)
        }
        if position.USDValuation != 50000 {
                t.Fatalf("Expected USD valuation 50000, got %d", position.USDValuation)
        }
        if position.Status != PositionStatusActive {
                t.Fatalf("Expected ACTIVE status, got %s", position.Status)
        }
        if !position.IsSolvent {
                t.Fatal("Expected position to be solvent")
        }

        // Verify vault state
        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 100_000_000 {
                t.Fatalf("Expected total FXRP deposited 100000000, got %d", state.TotalFxrpDeposited)
        }
        if state.TotalUSDValuation != 50000 {
                t.Fatalf("Expected total USD valuation 50000, got %d", state.TotalUSDValuation)
        }
        if state.ActivePositionCount != 1 {
                t.Fatalf("Expected 1 active position, got %d", state.ActivePositionCount)
        }
}

func TestProcessEvent_MultipleDeposits(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Deposit 1
        event1 := newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000)
        pc.ProcessEvent(event1)

        // Deposit 2
        event2 := newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000)
        pc.ProcessEvent(event2)

        // Deposit 3 from same depositor
        event3 := newTestEvent("DepositMade", 3, "0xDepositor1", 50_000_000, 25000)
        pc.ProcessEvent(event3)

        // Verify total state
        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 350_000_000 {
                t.Fatalf("Expected total FXRP 350000000, got %d", state.TotalFxrpDeposited)
        }
        if state.ActivePositionCount != 3 {
                t.Fatalf("Expected 3 active positions, got %d", state.ActivePositionCount)
        }

        // Verify depositor has 2 positions
        positions := pc.GetDepositorPositions("0xDepositor1")
        if len(positions) != 2 {
                t.Fatalf("Expected 2 positions for depositor1, got %d", len(positions))
        }
}

// ==========================================
// WITHDRAWAL EVENT TESTS
// ==========================================

func TestProcessEvent_WithdrawalInitiated(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Create a deposit first
        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        // Initiate withdrawal
        err := pc.ProcessEvent(newTestEvent("WithdrawalInitiated", 1, "0xDepositor1", 100_000_000, 0))
        if err != nil {
                t.Fatalf("Failed to process WithdrawalInitiated: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.Status != PositionStatusWithdrawal {
                t.Fatalf("Expected WITHDRAWAL_INITIATED status, got %s", position.Status)
        }
}

func TestProcessEvent_WithdrawalCompleted(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Create a deposit first
        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        // Complete withdrawal
        err := pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 1, "0xDepositor1", 100_000_000, 0))
        if err != nil {
                t.Fatalf("Failed to process WithdrawalCompleted: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.Status != PositionStatusClosed {
                t.Fatalf("Expected CLOSED status, got %s", position.Status)
        }
        if position.FxrpAmount != 0 {
                t.Fatalf("Expected FXRP amount 0 after withdrawal, got %d", position.FxrpAmount)
        }

        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 0 {
                t.Fatalf("Expected total FXRP 0 after withdrawal, got %d", state.TotalFxrpDeposited)
        }
        if state.ActivePositionCount != 0 {
                t.Fatalf("Expected 0 active positions, got %d", state.ActivePositionCount)
        }
        if state.TotalFxrpLiabilities != 100_000_000 {
                t.Fatalf("Expected liabilities 100000000, got %d", state.TotalFxrpLiabilities)
        }
}

func TestProcessEvent_EmergencyWithdrawal(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        err := pc.ProcessEvent(newTestEvent("EmergencyWithdrawal", 1, "0xDepositor1", 100_000_000, 0))
        if err != nil {
                t.Fatalf("Failed to process EmergencyWithdrawal: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.Status != PositionStatusEmergency {
                t.Fatalf("Expected EMERGENCY_WITHDRAWAL status, got %s", position.Status)
        }

        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 0 {
                t.Fatalf("Expected total FXRP 0 after emergency withdrawal, got %d", state.TotalFxrpDeposited)
        }
}

// ==========================================
// POSITION REVALUATION TESTS
// ==========================================

func TestProcessEvent_PositionRevalued(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        // Revalue position — value dropped
        err := pc.ProcessEvent(newTestEvent("PositionRevalued", 1, "0xDepositor1", 0, 40000))
        if err != nil {
                t.Fatalf("Failed to process PositionRevalued: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.USDValuation != 40000 {
                t.Fatalf("Expected USD valuation 40000, got %d", position.USDValuation)
        }
        // Drawdown should be detected
        if position.DrawdownBps == 0 {
                t.Fatal("Expected non-zero drawdown after revaluation drop")
        }
}

func TestUpdatePrice_RevalueAllPositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Create two deposits
        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        // Update price
        err := pc.UpdatePrice(55000) // 0.55 USD in 5-decimal format
        if err != nil {
                t.Fatalf("Failed to update price: %v", err)
        }

        // Position 1: 100_000_000 * 55000 / 1e6 = 5,500,000
        // Position 2: 200_000_000 * 55000 / 1e6 = 11,000,000
        pos1, _ := pc.GetPosition(1)
        pos2, _ := pc.GetPosition(2)

        if pos1.USDValuation != 5500000 {
                t.Fatalf("Expected position 1 USD valuation 5500000, got %d", pos1.USDValuation)
        }
        if pos2.USDValuation != 11000000 {
                t.Fatalf("Expected position 2 USD valuation 11000000, got %d", pos2.USDValuation)
        }

        state := pc.GetVaultState()
        if state.XRPUSDPrice != 55000 {
                t.Fatalf("Expected XRP/USD price 55000, got %d", state.XRPUSDPrice)
        }
}

// ==========================================
// MERKLE ROOT TESTS
// ==========================================

func TestComputeMerkleRoot_EmptyVault(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }
        if root == "" {
                t.Fatal("Merkle root should not be empty")
        }
}

func TestComputeMerkleRoot_SinglePosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }
        if root == "" {
                t.Fatal("Merkle root should not be empty")
        }

        // Verify the root is deterministic
        root2, _ := pc.ComputeMerkleRoot()
        if root != root2 {
                t.Fatalf("Merkle root should be deterministic: %s != %s", root, root2)
        }
}

func TestComputeMerkleRoot_MultiplePositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))
        pc.ProcessEvent(newTestEvent("DepositMade", 3, "0xDepositor3", 300_000_000, 150000))

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }
        if root == "" {
                t.Fatal("Merkle root should not be empty")
        }

        // Verify the root changes when a position is added
        pc.ProcessEvent(newTestEvent("DepositMade", 4, "0xDepositor4", 400_000_000, 200000))
        root2, _ := pc.ComputeMerkleRoot()

        if root == root2 {
                t.Fatal("Merkle root should change when a new position is added")
        }
}

func TestComputeMerkleRoot_Deterministic(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        root1, _ := pc.ComputeMerkleRoot()

        // Create a new PositionComputer and replay the same events
        pc2 := NewPositionComputer(DefaultPositionComputerConfig())
        pc2.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc2.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        root2, _ := pc2.ComputeMerkleRoot()

        if root1 != root2 {
                t.Fatalf("Merkle root should be deterministic: %s != %s", root1, root2)
        }
}

// ==========================================
// MERKLE PROOF TESTS
// ==========================================

func TestGenerateMerkleProof_SinglePosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        proof, err := pc.GenerateMerkleProof(1)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof: %v", err)
        }
        // Single position — proof should be empty
        if len(proof) != 0 {
                t.Fatalf("Expected empty proof for single position, got %d elements", len(proof))
        }
}

func TestGenerateMerkleProof_MultiplePositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        proof, err := pc.GenerateMerkleProof(1)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof: %v", err)
        }
        // Two positions — proof should have 1 element (the sibling)
        if len(proof) != 1 {
                t.Fatalf("Expected 1 proof element, got %d", len(proof))
        }
}

func TestVerifyMerkleProof(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        root, _ := pc.ComputeMerkleRoot()
        proof, _ := pc.GenerateMerkleProof(1)

        // Get the leaf hash
        position, _ := pc.GetPosition(1)
        leaf := pc.computeLeafHash(position)

        // Verify the proof
        isValid := pc.VerifyMerkleProof(leaf, proof, root)
        if !isValid {
                t.Fatal("Merkle proof should be valid")
        }
}

func TestVerifyMerkleProof_Invalid(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        root, _ := pc.ComputeMerkleRoot()

        // Try with wrong leaf
        isValid := pc.VerifyMerkleProof("wrong_leaf_hash", []string{}, root)
        if isValid {
                t.Fatal("Merkle proof should be invalid for wrong leaf")
        }
}

// ==========================================
// EXTERNAL STATE TESTS
// ==========================================

func TestUpdateExternalState(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        state := &ExternalState{
                Chain:        ExternalChainXRPL,
                Address:      "rAegisXRPLWallet",
                Balance:      500_000_000,
                AttestedAt:   time.Now(),
                VotingRound:  1414258,
                IsVerified:   true,
        }

        err := pc.UpdateExternalState(state)
        if err != nil {
                t.Fatalf("Failed to update external state: %v", err)
        }

        // Verify the state was stored
        extState, err := pc.GetExternalState(ExternalChainXRPL)
        if err != nil {
                t.Fatalf("Failed to get external state: %v", err)
        }
        if extState.Balance != 500_000_000 {
                t.Fatalf("Expected balance 500000000, got %d", extState.Balance)
        }
        if extState.Chain != ExternalChainXRPL {
                t.Fatalf("Expected chain XRPL, got %s", extState.Chain)
        }
}

func TestUpdateExternalState_Unverified(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        state := &ExternalState{
                Chain:      ExternalChainXRPL,
                Address:    "rAegisXRPLWallet",
                Balance:    500_000_000,
                IsVerified: false, // Not verified!
        }

        err := pc.UpdateExternalState(state)
        if err == nil {
                t.Fatal("Expected error for unverified external state")
        }
}

func TestUpdateExternalState_MultipleChains(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Add XRPL state
        pc.UpdateExternalState(&ExternalState{
                Chain: ExternalChainXRPL, Address: "rWallet1", Balance: 500_000_000,
                AttestedAt: time.Now(), VotingRound: 1414258, IsVerified: true,
        })

        // Add Base state
        pc.UpdateExternalState(&ExternalState{
                Chain: ExternalChainBase, Address: "0xBaseWallet", Balance: 200_000_000,
                AttestedAt: time.Now(), VotingRound: 1414259, IsVerified: true,
        })

        // Add Hyperliquid state
        pc.UpdateExternalState(&ExternalState{
                Chain: ExternalChainHyperliquid, Address: "0xHypWallet", Balance: 100_000_000,
                AttestedAt: time.Now(), VotingRound: 1414260, IsVerified: true,
        })

        vaultState := pc.GetVaultState()
        if len(vaultState.ExternalState) != 3 {
                t.Fatalf("Expected 3 external states, got %d", len(vaultState.ExternalState))
        }
}

// ==========================================
// FDC ATTESTATION TESTS
// ==========================================

func TestProcessFDCAttestation_Payment(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        paymentData := struct {
                ReceivedAmount uint64 `json:"receivedAmount"`
                Destination    string `json:"destination"`
        }{
                ReceivedAmount: 100_000_000,
                Destination:    "rAegisXRPLWallet",
        }

        data, _ := json.Marshal(paymentData)

        attestation := &FDCAttestationData{
                AttestationType: "Payment",
                SourceID:        "testXRP",
                VotingRound:     1414258,
                Data:            data,
                IsVerified:      true,
                VerifiedAt:      time.Now(),
        }

        err := pc.ProcessFDCAttestation(attestation)
        if err != nil {
                t.Fatalf("Failed to process FDC attestation: %v", err)
        }

        // Verify the external state was updated
        extState, err := pc.GetExternalState(ExternalChainXRPL)
        if err != nil {
                t.Fatalf("Failed to get XRPL external state: %v", err)
        }
        if extState.Balance != 100_000_000 {
                t.Fatalf("Expected balance 100000000, got %d", extState.Balance)
        }
}

func TestProcessFDCAttestation_Unverified(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        attestation := &FDCAttestationData{
                AttestationType: "Payment",
                SourceID:        "testXRP",
                VotingRound:     1414258,
                Data:            []byte("{}"),
                IsVerified:      false, // Not verified!
        }

        err := pc.ProcessFDCAttestation(attestation)
        if err == nil {
                t.Fatal("Expected error for unverified attestation")
        }
}

// ==========================================
// PRICE UPDATE TESTS
// ==========================================

func TestUpdatePrice_ZeroPrice(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.UpdatePrice(0)
        if err == nil {
                t.Fatal("Expected error for zero price")
        }
}

func TestUpdatePrice_Revaluation(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 0))

        // Update price — should revalue all positions
        err := pc.UpdatePrice(50000) // 0.50 USD in 5-decimal format
        if err != nil {
                t.Fatalf("Failed to update price: %v", err)
        }

        // Position 1: 100_000_000 * 50000 / 1e6 = 5,000,000
        position, _ := pc.GetPosition(1)
        if position.USDValuation != 5000000 {
                t.Fatalf("Expected USD valuation 5000000, got %d", position.USDValuation)
        }

        // Update price again — price drops
        pc.UpdatePrice(40000) // 0.40 USD

        position, _ = pc.GetPosition(1)
        if position.USDValuation != 4000000 {
                t.Fatalf("Expected USD valuation 4000000, got %d", position.USDValuation)
        }

        // Drawdown should be detected
        if position.DrawdownBps == 0 {
                t.Fatal("Expected non-zero drawdown after price drop")
        }
}

// ==========================================
// COLLATERAL RATIO TESTS
// ==========================================

func TestCollateralRatio_NoLiabilities(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))

        state := pc.GetVaultState()
        // No liabilities — should be solvent
        if !state.IsSolvent {
                t.Fatal("Expected vault to be solvent with no liabilities")
        }
}

func TestCollateralRatio_WithLiabilities(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 1, "0xDepositor1", 100_000_000, 0))

        state := pc.GetVaultState()
        // Total deposited = 0, liabilities = 100_000_000
        // Collateral ratio = 0 * 10000 / 100_000_000 = 0
        // 0 < 15000 (min) — should NOT be solvent
        if state.IsSolvent {
                t.Fatal("Expected vault to be insolvent with high liabilities")
        }
}

// ==========================================
// ERROR HANDLING TESTS
// ==========================================

func TestProcessEvent_NilEvent(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ProcessEvent(nil)
        if err == nil {
                t.Fatal("Expected error for nil event")
        }
}

func TestProcessEvent_UnknownEventType(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ProcessEvent(newTestEvent("UnknownEvent", 1, "0xDepositor1", 100, 0))
        if err == nil {
                t.Fatal("Expected error for unknown event type")
        }
}

func TestProcessEvent_WithdrawalNonexistentPosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 999, "0xDepositor1", 100, 0))
        if err == nil {
                t.Fatal("Expected error for withdrawal of nonexistent position")
        }
}

func TestGetPosition_NotFound(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        _, err := pc.GetPosition(999)
        if err == nil {
                t.Fatal("Expected error for nonexistent position")
        }
}

func TestGetExternalState_NotFound(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        _, err := pc.GetExternalState("UnknownChain")
        if err == nil {
                t.Fatal("Expected error for unknown chain")
        }
}

func TestGenerateMerkleProof_NonexistentPosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        _, err := pc.GenerateMerkleProof(999)
        if err == nil {
                t.Fatal("Expected error for nonexistent position")
        }
}

func TestGenerateMerkleProof_ClosedPosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 1, "0xDepositor1", 100_000_000, 0))

        _, err := pc.GenerateMerkleProof(1)
        if err == nil {
                t.Fatal("Expected error for proof of closed position")
        }
}

// ==========================================
// QUERY TESTS
// ==========================================

func TestGetActivePositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))
        pc.ProcessEvent(newTestEvent("DepositMade", 3, "0xDepositor3", 300_000_000, 150000))
        pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 2, "0xDepositor2", 200_000_000, 0))

        positions := pc.GetActivePositions()
        if len(positions) != 2 {
                t.Fatalf("Expected 2 active positions, got %d", len(positions))
        }
}

func TestGetDepositorPositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))
        pc.ProcessEvent(newTestEvent("DepositMade", 3, "0xDepositor1", 50_000_000, 25000))

        positions := pc.GetDepositorPositions("0xDepositor1")
        if len(positions) != 2 {
                t.Fatalf("Expected 2 positions for depositor1, got %d", len(positions))
        }
}

func TestGetDepositorPositions_NoPositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        positions := pc.GetDepositorPositions("0xUnknown")
        if len(positions) != 0 {
                t.Fatalf("Expected 0 positions for unknown depositor, got %d", len(positions))
        }
}

func TestGetProcessedEvents(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        events := pc.GetProcessedEvents()
        if len(events) != 2 {
                t.Fatalf("Expected 2 processed events, got %d", len(events))
        }
}

func TestGetPositionCount(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        if pc.GetPositionCount() != 2 {
                t.Fatalf("Expected 2 positions, got %d", pc.GetPositionCount())
        }
}

func TestGetActivePositionCount(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))
        pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 1, "0xDepositor1", 100_000_000, 0))

        if pc.GetActivePositionCount() != 1 {
                t.Fatalf("Expected 1 active position, got %d", pc.GetActivePositionCount())
        }
}

// ==========================================
// VALIDATION TESTS
// ==========================================

func TestValidatePositionComputer(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ValidatePositionComputer()
        if err != nil {
                t.Fatalf("PositionComputer validation failed: %v", err)
        }
}

func TestValidatePositionComputer_MissingRPCURL(t *testing.T) {
        config := DefaultPositionComputerConfig()
        config.RPCURL = ""
        pc := NewPositionComputer(config)

        err := pc.ValidatePositionComputer()
        if err == nil {
                t.Fatal("Expected error for missing RPC URL")
        }
}

// ==========================================
// RESET TESTS
// ==========================================

func TestReset(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.UpdatePrice(50000)

        pc.Reset()

        if pc.GetPositionCount() != 0 {
                t.Fatalf("Expected 0 positions after reset, got %d", pc.GetPositionCount())
        }
        if pc.xrpUsdPrice != 0 {
                t.Fatalf("Expected 0 price after reset, got %d", pc.xrpUsdPrice)
        }
}

// ==========================================
// SOLVENCY DATA TESTS
// ==========================================

func TestComputeSolvencyData(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        merkleRoot, totalCollateral, totalLiabilities, collateralRatioBps, err := pc.ComputeSolvencyData()
        if err != nil {
                t.Fatalf("Failed to compute solvency data: %v", err)
        }
        if merkleRoot == "" {
                t.Fatal("Merkle root should not be empty")
        }
        if totalCollateral != 300_000_000 {
                t.Fatalf("Expected total collateral 300000000, got %d", totalCollateral)
        }
        if totalLiabilities != 0 {
                t.Fatalf("Expected total liabilities 0, got %d", totalLiabilities)
        }
        if collateralRatioBps != 0 {
                t.Fatalf("Expected collateral ratio 0 (no liabilities), got %d", collateralRatioBps)
        }
}

// ==========================================
// FULL LIFECYCLE TEST
// ==========================================

func TestFullLifecycle(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // 1. Deposit
        pc.ProcessEvent(newTestEvent("DepositMade", 1, "0xDepositor1", 100_000_000, 50000))
        pc.ProcessEvent(newTestEvent("DepositMade", 2, "0xDepositor2", 200_000_000, 100000))

        // 2. Update price
        pc.UpdatePrice(55000)

        // 3. Add external state
        pc.UpdateExternalState(&ExternalState{
                Chain: ExternalChainXRPL, Address: "rWallet", Balance: 150_000_000,
                AttestedAt: time.Now(), VotingRound: 1414258, IsVerified: true,
        })

        // 4. Compute Merkle root
        root1, _ := pc.ComputeMerkleRoot()

        // 5. Revalue position — price drops significantly
        pc.ProcessEvent(newTestEvent("PositionRevalued", 1, "0xDepositor1", 0, 4500000))

        // 6. Compute Merkle root again — should be different (different valuation)
        root2, _ := pc.ComputeMerkleRoot()
        if root1 == root2 {
                t.Fatal("Merkle root should change after revaluation with different value")
        }

        // 7. Initiate withdrawal
        pc.ProcessEvent(newTestEvent("WithdrawalInitiated", 1, "0xDepositor1", 100_000_000, 0))

        // 8. Complete withdrawal
        pc.ProcessEvent(newTestEvent("WithdrawalCompleted", 1, "0xDepositor1", 100_000_000, 0))

        // 9. Verify final state
        state := pc.GetVaultState()
        if state.ActivePositionCount != 1 {
                t.Fatalf("Expected 1 active position, got %d", state.ActivePositionCount)
        }
        if state.TotalFxrpDeposited != 200_000_000 {
                t.Fatalf("Expected total FXRP 200000000, got %d", state.TotalFxrpDeposited)
        }
        if state.TotalFxrpLiabilities != 100_000_000 {
                t.Fatalf("Expected total liabilities 100000000, got %d", state.TotalFxrpLiabilities)
        }

        // 10. Compute solvency data
        merkleRoot, totalCollateral, totalLiabilities, _, _ := pc.ComputeSolvencyData()
        if merkleRoot == "" {
                t.Fatal("Merkle root should not be empty")
        }
        if totalCollateral != 200_000_000 {
                t.Fatalf("Expected total collateral 200000000, got %d", totalCollateral)
        }
        if totalLiabilities != 100_000_000 {
                t.Fatalf("Expected total liabilities 100000000, got %d", totalLiabilities)
        }

        // 11. Generate Merkle proof for position 2
        // Note: After position 1 is withdrawn, only position 2 is active.
        // With a single position, the Merkle proof is empty (no siblings).
        proof, err := pc.GenerateMerkleProof(2)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof: %v", err)
        }

        // 12. Verify the proof
        position, _ := pc.GetPosition(2)
        leaf := pc.computeLeafHash(position)
        isValid := pc.VerifyMerkleProof(leaf, proof, merkleRoot)
        if !isValid {
                t.Fatal("Merkle proof should be valid")
        }
}

// ==========================================
// CONCURRENT ACCESS TESTS
// ==========================================

func TestConcurrentAccess(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        done := make(chan bool)

        // Concurrent deposits
        go func() {
                for i := uint64(1); i <= 50; i++ {
                        pc.ProcessEvent(newTestEvent("DepositMade", i, "0xDepositor1", 100_000_000, 50000))
                }
                done <- true
        }()

        // Concurrent price updates
        go func() {
                for i := 0; i < 50; i++ {
                        pc.UpdatePrice(uint64(50000 + i*100))
                }
                done <- true
        }()

        // Wait for both goroutines
        <-done
        <-done

        // Verify the state is consistent
        if pc.GetPositionCount() != 50 {
                t.Fatalf("Expected 50 positions, got %d", pc.GetPositionCount())
        }
}
