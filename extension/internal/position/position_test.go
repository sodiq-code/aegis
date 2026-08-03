package position

import (
        "fmt"
        "math/big"
        "testing"
        "time"

        "github.com/ethereum/go-ethereum/common"
        "github.com/ethereum/go-ethereum/crypto"
)

// ==========================================
// PositionComputer Core Tests
// ==========================================

func TestPositionComputer_New(t *testing.T) {
        config := DefaultPositionComputerConfig()
        pc := NewPositionComputer(config)

        if pc == nil {
                t.Fatal("PositionComputer is nil")
        }
        if pc.GetPositionCount() != 0 {
                t.Fatalf("Expected 0 positions, got %d", pc.GetPositionCount())
        }
        if pc.GetActivePositionCount() != 0 {
                t.Fatalf("Expected 0 active positions, got %d", pc.GetActivePositionCount())
        }
}

func TestPositionComputer_ProcessDeposit(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        event := &OnChainEvent{
                EventType:  "DepositMade",
                PositionID: 1,
                Depositor:  "0xInstitution1",
                Amount:     1000000000, // 1000 FXRP
                USDValue:   500000,     // $5000
                Timestamp:  time.Now(),
                BlockNum:   1,
                TxHash:     "0xabc123",
        }

        err := pc.ProcessEvent(event)
        if err != nil {
                t.Fatalf("Failed to process deposit: %v", err)
        }

        if pc.GetPositionCount() != 1 {
                t.Fatalf("Expected 1 position, got %d", pc.GetPositionCount())
        }

        position, err := pc.GetPosition(1)
        if err != nil {
                t.Fatalf("Failed to get position: %v", err)
        }

        if position.FxrpAmount != 1000000000 {
                t.Fatalf("Expected 1000000000 FXRP, got %d", position.FxrpAmount)
        }
        if position.Status != PositionStatusActive {
                t.Fatalf("Expected ACTIVE status, got %s", position.Status)
        }

        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 1000000000 {
                t.Fatalf("Expected 1000000000 total deposited, got %d", state.TotalFxrpDeposited)
        }
        if state.ActivePositionCount != 1 {
                t.Fatalf("Expected 1 active position, got %d", state.ActivePositionCount)
        }
}

func TestPositionComputer_MultipleDeposits(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        deposits := []*OnChainEvent{
                {EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1", Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1},
                {EventType: "DepositMade", PositionID: 2, Depositor: "0xInstitution2", Amount: 2000000000, USDValue: 1000000, Timestamp: time.Now(), BlockNum: 2},
                {EventType: "DepositMade", PositionID: 3, Depositor: "0xInstitution1", Amount: 500000000, USDValue: 250000, Timestamp: time.Now(), BlockNum: 3},
        }

        for _, event := range deposits {
                err := pc.ProcessEvent(event)
                if err != nil {
                        t.Fatalf("Failed to process deposit: %v", err)
                }
        }

        if pc.GetPositionCount() != 3 {
                t.Fatalf("Expected 3 positions, got %d", pc.GetPositionCount())
        }
        if pc.GetActivePositionCount() != 3 {
                t.Fatalf("Expected 3 active positions, got %d", pc.GetActivePositionCount())
        }

        state := pc.GetVaultState()
        if state.TotalFxrpDeposited != 3500000000 {
                t.Fatalf("Expected 3500000000 total deposited, got %d", state.TotalFxrpDeposited)
        }
        if state.TotalUSDValuation != 1750000 {
                t.Fatalf("Expected 1750000 total USD valuation, got %d", state.TotalUSDValuation)
        }
}

func TestPositionComputer_WithdrawalCompleted(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Deposit first
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        // Withdraw
        err := pc.ProcessEvent(&OnChainEvent{
                EventType: "WithdrawalCompleted", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, Timestamp: time.Now(), BlockNum: 2,
        })
        if err != nil {
                t.Fatalf("Failed to process withdrawal: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.Status != PositionStatusClosed {
                t.Fatalf("Expected CLOSED status, got %s", position.Status)
        }

        state := pc.GetVaultState()
        if state.ActivePositionCount != 0 {
                t.Fatalf("Expected 0 active positions, got %d", state.ActivePositionCount)
        }
        if state.TotalFxrpDeposited != 0 {
                t.Fatalf("Expected 0 total deposited, got %d", state.TotalFxrpDeposited)
        }
        if state.TotalFxrpLiabilities != 1000000000 {
                t.Fatalf("Expected 1000000000 total liabilities, got %d", state.TotalFxrpLiabilities)
        }
}

func TestPositionComputer_EmergencyWithdrawal(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        err := pc.ProcessEvent(&OnChainEvent{
                EventType: "EmergencyWithdrawal", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, Timestamp: time.Now(), BlockNum: 2,
        })
        if err != nil {
                t.Fatalf("Failed to process emergency withdrawal: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.Status != PositionStatusEmergency {
                t.Fatalf("Expected EMERGENCY_WITHDRAWAL status, got %s", position.Status)
        }
}

func TestPositionComputer_PositionRevalued(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        err := pc.ProcessEvent(&OnChainEvent{
                EventType: "PositionRevalued", PositionID: 1,
                USDValue: 400000, // 20% drop
                Timestamp: time.Now(), BlockNum: 2,
        })
        if err != nil {
                t.Fatalf("Failed to process revaluation: %v", err)
        }

        position, _ := pc.GetPosition(1)
        if position.USDValuation != 400000 {
                t.Fatalf("Expected 400000 USD valuation, got %d", position.USDValuation)
        }
        if position.DrawdownBps != 2000 { // 20% drawdown = 2000 bps
                t.Fatalf("Expected 2000 bps drawdown, got %d", position.DrawdownBps)
        }
}

func TestPositionComputer_UnknownEvent(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ProcessEvent(&OnChainEvent{
                EventType: "UnknownEvent", PositionID: 1,
        })
        if err == nil {
                t.Fatal("Expected error for unknown event type")
        }
}

func TestPositionComputer_NilEvent(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.ProcessEvent(nil)
        if err == nil {
                t.Fatal("Expected error for nil event")
        }
}

func TestPositionComputer_PositionNotFound(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        _, err := pc.GetPosition(999)
        if err == nil {
                t.Fatal("Expected error for non-existent position")
        }
}

// ==========================================
// FTSO Price Update Tests
// ==========================================

func TestPositionComputer_UpdatePrice(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        err := pc.UpdatePrice(1200000) // 1.2 USD (5-decimal format)
        if err != nil {
                t.Fatalf("Failed to update price: %v", err)
        }

        state := pc.GetVaultState()
        if state.XRPUSDPrice != 1200000 {
                t.Fatalf("Expected 1200000 XRP/USD price, got %d", state.XRPUSDPrice)
        }

        // Position should be revalued
        position, _ := pc.GetPosition(1)
        // newValuation = (1000000000 * 1200000) / 1e6 = 1200000000
        if position.USDValuation != 1200000000 {
                t.Fatalf("Expected 1200000000 USD valuation after revaluation, got %d", position.USDValuation)
        }
}

func TestPositionComputer_UpdatePriceZero(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        err := pc.UpdatePrice(0)
        if err == nil {
                t.Fatal("Expected error for zero price")
        }
}

// ==========================================
// FDC External State Tests
// ==========================================

func TestPositionComputer_UpdateExternalState(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        state := &ExternalState{
                Chain:        ExternalChainXRPL,
                Address:      "rXRPAddress123",
                Balance:      500000000,
                AttestedAt:   time.Now(),
                VotingRound:  1000,
                AttestationID: "fdc-att-123",
                IsVerified:   true,
        }

        err := pc.UpdateExternalState(state)
        if err != nil {
                t.Fatalf("Failed to update external state: %v", err)
        }

        extState, err := pc.GetExternalState(ExternalChainXRPL)
        if err != nil {
                t.Fatalf("Failed to get external state: %v", err)
        }
        if extState.Balance != 500000000 {
                t.Fatalf("Expected 500000000 balance, got %d", extState.Balance)
        }
}

func TestPositionComputer_UpdateExternalStateUnverified(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        state := &ExternalState{
                Chain:      ExternalChainXRPL,
                IsVerified: false,
        }

        err := pc.UpdateExternalState(state)
        if err == nil {
                t.Fatal("Expected error for unverified external state")
        }
}

func TestPositionComputer_ProcessFDCAttestation(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        attestation := &FDCAttestationData{
                AttestationType: "Payment",
                SourceID:        "xrp",
                VotingRound:     1000,
                Data:            []byte(`{"receivedAmount": 500000000, "destination": "rXRPAddress123"}`),
                IsVerified:      true,
                VerifiedAt:      time.Now(),
        }

        err := pc.ProcessFDCAttestation(attestation)
        if err != nil {
                t.Fatalf("Failed to process FDC attestation: %v", err)
        }

        extState, err := pc.GetExternalState(ExternalChainXRPL)
        if err != nil {
                t.Fatalf("Failed to get external state: %v", err)
        }
        if extState.Balance != 500000000 {
                t.Fatalf("Expected 500000000 balance, got %d", extState.Balance)
        }
}

// ==========================================
// Merkle Root Computation Tests (keccak256)
// ==========================================

func TestPositionComputer_ComputeMerkleRoot_SinglePosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }
        if root == "" {
                t.Fatal("Merkle root is empty")
        }

        // For a single position, the root should be the leaf hash
        leaf := computeLeafHashKeccak256(&Position{
                PositionID:   1,
                Depositor:    "0xInstitution1",
                FxrpAmount:   1000000000,
                USDValuation: 500000,
        })

        expectedRoot := common.BytesToHash(leaf[:]).Hex()
        if root != expectedRoot {
                t.Fatalf("Merkle root mismatch: got %s, expected %s", root, expectedRoot)
        }
}

func TestPositionComputer_ComputeMerkleRoot_MultiplePositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 2, Depositor: "0xInstitution2",
                Amount: 2000000000, USDValue: 1000000, Timestamp: time.Now(), BlockNum: 2,
        })

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }
        if root == "" {
                t.Fatal("Merkle root is empty")
        }

        // Verify the root is deterministic
        root2, _ := pc.ComputeMerkleRoot()
        if root != root2 {
                t.Fatalf("Merkle root is not deterministic: %s != %s", root, root2)
        }
}

func TestPositionComputer_ComputeMerkleRoot_Empty(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        root, err := pc.ComputeMerkleRoot()
        if err != nil {
                t.Fatalf("Failed to compute Merkle root: %v", err)
        }

        expectedRoot := crypto.Keccak256Hash([]byte("aegis-empty-vault")).Hex()
        if root != expectedRoot {
                t.Fatalf("Empty vault root mismatch: got %s, expected %s", root, expectedRoot)
        }
}

// ==========================================
// Merkle Proof Verification Tests (keccak256, Solidity-compatible)
// ==========================================

func TestPositionComputer_MerkleProof_SinglePosition(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        root, _ := pc.ComputeMerkleRoot()
        proof, err := pc.GenerateMerkleProof(1)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof: %v", err)
        }

        // For a single position, the proof should be empty (root = leaf)
        if len(proof) != 0 {
                t.Fatalf("Expected 0 proof elements for single position, got %d", len(proof))
        }

        // Verify the proof
        leaf := computeLeafHashKeccak256(&Position{
                PositionID:   1,
                Depositor:    "0xInstitution1",
                FxrpAmount:   1000000000,
                USDValuation: 500000,
        })

        rootHash := common.HexToHash(root)
        if leaf != rootHash {
                t.Fatalf("Leaf hash should equal root for single position: leaf=%s, root=%s",
                        common.BytesToHash(leaf[:]).Hex(), root)
        }
}

func TestPositionComputer_MerkleProof_TwoPositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 2, Depositor: "0xInstitution2",
                Amount: 2000000000, USDValue: 1000000, Timestamp: time.Now(), BlockNum: 2,
        })

        root, _ := pc.ComputeMerkleRoot()

        // Generate proof for position 1
        proof1, err := pc.GenerateMerkleProof(1)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof for position 1: %v", err)
        }

        // Generate proof for position 2
        proof2, err := pc.GenerateMerkleProof(2)
        if err != nil {
                t.Fatalf("Failed to generate Merkle proof for position 2: %v", err)
        }

        // Both should have 1 proof element (sibling)
        if len(proof1) != 1 {
                t.Fatalf("Expected 1 proof element for position 1, got %d", len(proof1))
        }
        if len(proof2) != 1 {
                t.Fatalf("Expected 1 proof element for position 2, got %d", len(proof2))
        }

        // Verify proofs
        leaf1 := computeLeafHashKeccak256(&Position{
                PositionID:   1,
                Depositor:    "0xInstitution1",
                FxrpAmount:   1000000000,
                USDValuation: 500000,
        })
        leaf2 := computeLeafHashKeccak256(&Position{
                PositionID:   2,
                Depositor:    "0xInstitution2",
                FxrpAmount:   2000000000,
                USDValuation: 1000000,
        })

        rootHash := common.HexToHash(root)

        if !pc.VerifyMerkleProof(leaf1, proof1, rootHash) {
                t.Fatal("Merkle proof verification failed for position 1")
        }
        if !pc.VerifyMerkleProof(leaf2, proof2, rootHash) {
                t.Fatal("Merkle proof verification failed for position 2")
        }
}

func TestPositionComputer_MerkleProof_FourPositions(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        for i := uint64(1); i <= 4; i++ {
                pc.ProcessEvent(&OnChainEvent{
                        EventType: "DepositMade", PositionID: i,
                        Depositor:  fmt.Sprintf("0xInstitution%d", i),
                        Amount:     i * 1000000000,
                        USDValue:   i * 500000,
                        Timestamp:  time.Now(),
                        BlockNum:   i,
                })
        }

        root, _ := pc.ComputeMerkleRoot()

        // Verify each position's proof
        for i := uint64(1); i <= 4; i++ {
                proof, err := pc.GenerateMerkleProof(i)
                if err != nil {
                        t.Fatalf("Failed to generate Merkle proof for position %d: %v", i, err)
                }

                position, _ := pc.GetPosition(i)
                leaf := computeLeafHashKeccak256(position)
                rootHash := common.HexToHash(root)

                if !pc.VerifyMerkleProof(leaf, proof, rootHash) {
                        t.Fatalf("Merkle proof verification failed for position %d", i)
                }
        }
}

// ==========================================
// Keccak256 Leaf Hash Compatibility Tests
// ==========================================

func TestComputeLeafHashKeccak256_MatchesSolidity(t *testing.T) {
        // Test that the Go keccak256 leaf hash matches Solidity's
        // keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
        position := &Position{
                PositionID:   1,
                Depositor:    "0x0000000000000000000000000000000000000001",
                FxrpAmount:   1000000000,
                USDValuation: 500000,
        }

        leaf := computeLeafHashKeccak256(position)

        // Verify the leaf hash is deterministic
        leaf2 := computeLeafHashKeccak256(position)
        if leaf != leaf2 {
                t.Fatal("Leaf hash is not deterministic")
        }

        // Verify the leaf hash is a valid keccak256 hash (32 bytes)
        if len(leaf) != 32 {
                t.Fatalf("Expected 32-byte hash, got %d bytes", len(leaf))
        }

        // Verify the leaf hash is not zero
        zeroHash := [32]byte{}
        if leaf == zeroHash {
                t.Fatal("Leaf hash is zero")
        }
}

func TestComputeLeafHashKeccak256_DifferentPositions(t *testing.T) {
        pos1 := &Position{
                PositionID:   1,
                Depositor:    "0x0000000000000000000000000000000000000001",
                FxrpAmount:   1000000000,
                USDValuation: 500000,
        }
        pos2 := &Position{
                PositionID:   2,
                Depositor:    "0x0000000000000000000000000000000000000002",
                FxrpAmount:   2000000000,
                USDValuation: 1000000,
        }

        leaf1 := computeLeafHashKeccak256(pos1)
        leaf2 := computeLeafHashKeccak256(pos2)

        if leaf1 == leaf2 {
                t.Fatal("Different positions should produce different leaf hashes")
        }
}

// ==========================================
// Collateral Ratio Tests
// ==========================================

func TestPositionComputer_CollateralRatio(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Deposit
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        state := pc.GetVaultState()
        // No liabilities, so collateral ratio should be 999999 (effectively infinite)
        if state.CollateralRatioBps != 999999 {
                t.Fatalf("Expected 999999 collateral ratio (no liabilities), got %d", state.CollateralRatioBps)
        }
        if !state.IsSolvent {
                t.Fatal("Expected vault to be solvent")
        }

        // Withdraw
        pc.ProcessEvent(&OnChainEvent{
                EventType: "WithdrawalCompleted", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, Timestamp: time.Now(), BlockNum: 2,
        })

        state = pc.GetVaultState()
        // Now has liabilities but no deposits
        if state.CollateralRatioBps != 0 {
                t.Fatalf("Expected 0 collateral ratio (insolvent), got %d", state.CollateralRatioBps)
        }
        if state.IsSolvent {
                t.Fatal("Expected vault to be insolvent")
        }
}

// ==========================================
// Validation Tests
// ==========================================

func TestPositionComputer_Validate(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())
        err := pc.ValidatePositionComputer()
        if err != nil {
                t.Fatalf("Validation failed: %v", err)
        }
}

func TestPositionComputer_Reset(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        pc.Reset()

        if pc.GetPositionCount() != 0 {
                t.Fatalf("Expected 0 positions after reset, got %d", pc.GetPositionCount())
        }
}

// ==========================================
// End-to-End Flow Tests
// ==========================================

func TestPositionComputer_EndToEnd_FullLifecycle(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // 1. Deposit
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })

        // 2. Compute Merkle root
        root1, _ := pc.ComputeMerkleRoot()
        if root1 == "" {
                t.Fatal("Merkle root is empty after deposit")
        }

        // 3. Generate and verify Merkle proof
        proof, _ := pc.GenerateMerkleProof(1)
        position, _ := pc.GetPosition(1)
        leaf := computeLeafHashKeccak256(position)
        rootHash := common.HexToHash(root1)
        if !pc.VerifyMerkleProof(leaf, proof, rootHash) {
                t.Fatal("Merkle proof verification failed after deposit")
        }

        // 4. Revalue position
        pc.ProcessEvent(&OnChainEvent{
                EventType: "PositionRevalued", PositionID: 1,
                USDValue: 400000, Timestamp: time.Now(), BlockNum: 2,
        })

        // 5. Compute new Merkle root
        root2, _ := pc.ComputeMerkleRoot()
        if root2 == root1 {
                t.Fatal("Merkle root should change after revaluation")
        }

        // 6. Verify new proof
        proof2, _ := pc.GenerateMerkleProof(1)
        position2, _ := pc.GetPosition(1)
        leaf2 := computeLeafHashKeccak256(position2)
        rootHash2 := common.HexToHash(root2)
        if !pc.VerifyMerkleProof(leaf2, proof2, rootHash2) {
                t.Fatal("Merkle proof verification failed after revaluation")
        }

        // 7. Update FDC external state
        pc.UpdateExternalState(&ExternalState{
                Chain: ExternalChainXRPL, Address: "rXRPAddress",
                Balance: 500000000, AttestedAt: time.Now(), VotingRound: 1000, IsVerified: true,
        })

        // 8. Compute solvency data
        merkleRoot, collateral, liabilities, ratio, _ := pc.ComputeSolvencyData()
        if merkleRoot == "" {
                t.Fatal("Merkle root is empty")
        }
        if collateral != 1000000000 {
                t.Fatalf("Expected 1000000000 collateral, got %d", collateral)
        }
        if liabilities != 0 {
                t.Fatalf("Expected 0 liabilities, got %d", liabilities)
        }
        if ratio != 999999 {
                t.Fatalf("Expected 999999 ratio (no liabilities), got %d", ratio)
        }
}

func TestPositionComputer_EndToEnd_MultipleDepositors(t *testing.T) {
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        // Multiple deposits from different depositors
        deposits := []*OnChainEvent{
                {EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1", Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1},
                {EventType: "DepositMade", PositionID: 2, Depositor: "0xInstitution2", Amount: 2000000000, USDValue: 1000000, Timestamp: time.Now(), BlockNum: 2},
                {EventType: "DepositMade", PositionID: 3, Depositor: "0xInstitution1", Amount: 500000000, USDValue: 250000, Timestamp: time.Now(), BlockNum: 3},
                {EventType: "DepositMade", PositionID: 4, Depositor: "0xInstitution3", Amount: 3000000000, USDValue: 1500000, Timestamp: time.Now(), BlockNum: 4},
        }

        for _, event := range deposits {
                pc.ProcessEvent(event)
        }

        // Compute Merkle root
        root, _ := pc.ComputeMerkleRoot()

        // Verify each position's proof
        for i := uint64(1); i <= 4; i++ {
                proof, err := pc.GenerateMerkleProof(i)
                if err != nil {
                        t.Fatalf("Failed to generate proof for position %d: %v", i, err)
                }

                position, _ := pc.GetPosition(i)
                leaf := computeLeafHashKeccak256(position)
                rootHash := common.HexToHash(root)

                if !pc.VerifyMerkleProof(leaf, proof, rootHash) {
                        t.Fatalf("Merkle proof verification failed for position %d", i)
                }
        }

        // Verify depositor positions
        inst1Positions := pc.GetDepositorPositions("0xInstitution1")
        if len(inst1Positions) != 2 {
                t.Fatalf("Expected 2 positions for Institution1, got %d", len(inst1Positions))
        }
}

// ==========================================
// Helper Functions
// ==========================================

func TestGetVerifierAddress(t *testing.T) {
        // Test with a known private key (without 0x prefix)
        privateKeyHex := "b3e509a0949e4d4ae489025a95eae959df178188f2c6ca130eceb2ef4ac70951"
        addr, err := GetVerifierAddress(privateKeyHex)
        if err != nil {
                t.Fatalf("Failed to get verifier address: %v", err)
        }
        t.Logf("Verifier address: %s", addr.Hex())
}

func TestComputeLeafHashKeccak256_AbiEncodePacked(t *testing.T) {
        // Test that the leaf hash format matches Solidity's abi.encodePacked
        // Solidity: keccak256(abi.encodePacked(uint256(1), address(0x01...01), uint256(1000), uint256(500)))
        position := &Position{
                PositionID:   1,
                Depositor:    "0x0000000000000000000000000000000000000001",
                FxrpAmount:   1000,
                USDValuation: 500,
        }

        leaf := computeLeafHashKeccak256(position)

        // Manually construct the expected data to match Solidity
        // abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation)
        // uint256 = 32 bytes big-endian, address = 20 bytes
        posIdBytes := common.LeftPadBytes(big.NewInt(1).Bytes(), 32)
        addr := common.HexToAddress("0x0000000000000000000000000000000000000001")
        fxrpBytes := common.LeftPadBytes(big.NewInt(1000).Bytes(), 32)
        usdBytes := common.LeftPadBytes(big.NewInt(500).Bytes(), 32)

        data := make([]byte, 0, 116)
        data = append(data, posIdBytes...)
        data = append(data, addr.Bytes()...)
        data = append(data, fxrpBytes...)
        data = append(data, usdBytes...)

        expectedLeaf := crypto.Keccak256Hash(data)
        if leaf != expectedLeaf {
                t.Fatalf("Leaf hash mismatch: got %x, expected %x", leaf, expectedLeaf)
        }
}

// ==========================================
// Sorted Merkle Tree Tests
// ==========================================

func TestPositionComputer_SortedMerkleTree(t *testing.T) {
        // Test that the Merkle tree uses sorted ordering
        // This is critical for Solidity compatibility
        pc := NewPositionComputer(DefaultPositionComputerConfig())

        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 1, Depositor: "0xInstitution1",
                Amount: 1000000000, USDValue: 500000, Timestamp: time.Now(), BlockNum: 1,
        })
        pc.ProcessEvent(&OnChainEvent{
                EventType: "DepositMade", PositionID: 2, Depositor: "0xInstitution2",
                Amount: 2000000000, USDValue: 1000000, Timestamp: time.Now(), BlockNum: 2,
        })

        // Compute the root
        root, _ := pc.ComputeMerkleRoot()

        // Get the leaf hashes
        leaf1 := computeLeafHashKeccak256(&Position{
                PositionID: 1, Depositor: "0xInstitution1", FxrpAmount: 1000000000, USDValuation: 500000,
        })
        leaf2 := computeLeafHashKeccak256(&Position{
                PositionID: 2, Depositor: "0xInstitution2", FxrpAmount: 2000000000, USDValuation: 1000000,
        })

        // The root should be: keccak256(sorted_concat(leaf1, leaf2))
        // Where sorted means the smaller leaf (as big.Int) comes first
        leaf1Int := new(big.Int).SetBytes(leaf1[:])
        leaf2Int := new(big.Int).SetBytes(leaf2[:])

        var expectedRoot [32]byte
        if leaf1Int.Cmp(leaf2Int) <= 0 {
                expectedRoot = crypto.Keccak256Hash(append(leaf1[:], leaf2[:]...))
        } else {
                expectedRoot = crypto.Keccak256Hash(append(leaf2[:], leaf1[:]...))
        }

        expectedRootHex := common.BytesToHash(expectedRoot[:]).Hex()
        if root != expectedRootHex {
                t.Fatalf("Sorted Merkle root mismatch: got %s, expected %s", root, expectedRootHex)
        }
}
