package attestation

import (
        "fmt"
        "math/big"
        "testing"

        "github.com/ethereum/go-ethereum/common"
        "github.com/ethereum/go-ethereum/crypto"
)

// ==========================================
// SolvencyAttestor Core Tests
// ==========================================

func TestSolvencyAttestor_New(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()
        sa := NewSolvencyAttestor(config)

        if sa == nil {
                t.Fatal("SolvencyAttestor is nil")
        }
        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs, got %d", sa.GetProofCount())
        }
}

func TestSolvencyAttestor_ComputeAndPublishSolvencyProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // Compute a Merkle root from a simple test
        merkleRoot := crypto.Keccak256Hash([]byte("test-merkle-root")).Hex()

        proof, err := sa.ComputeAndPublishSolvencyProof(
                merkleRoot,
                1000000000, // 1000 FXRP collateral
                0,          // No liabilities
                999999,     // Effectively infinite collateral ratio
                1000,       // Voting round
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }

        if proof.MerkleRoot != merkleRoot {
                t.Fatalf("Merkle root mismatch: got %s, expected %s", proof.MerkleRoot, merkleRoot)
        }
        if proof.Status != SolvencyStatusSolvent {
                t.Fatalf("Expected SOLVENT status, got %s", proof.Status)
        }
        if proof.TotalFxrpCollateral != 1000000000 {
                t.Fatalf("Expected 1000000000 collateral, got %d", proof.TotalFxrpCollateral)
        }
        if proof.TotalFxrpLiabilities != 0 {
                t.Fatalf("Expected 0 liabilities, got %d", proof.TotalFxrpLiabilities)
        }
}

func TestSolvencyAttestor_WarningStatus(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()
        sa := NewSolvencyAttestor(config)

        // Collateral ratio between 80% and 100% of minimum (15000)
        // 80% of 15000 = 12000
        merkleRoot := crypto.Keccak256Hash([]byte("test-warning")).Hex()

        proof, err := sa.ComputeAndPublishSolvencyProof(
                merkleRoot,
                1000000000,
                800000000,
                12500, // 125% collateral ratio — between 80% and 100% of min (15000)
                1000,
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }

        if proof.Status != SolvencyStatusWarning {
                t.Fatalf("Expected WARNING status, got %s", proof.Status)
        }
}

func TestSolvencyAttestor_InsolventStatus(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()
        sa := NewSolvencyAttestor(config)

        // Collateral ratio below 80% of minimum
        merkleRoot := crypto.Keccak256Hash([]byte("test-insolvent")).Hex()

        proof, err := sa.ComputeAndPublishSolvencyProof(
                merkleRoot,
                1000000000,
                900000000,
                10000, // 100% collateral ratio — below 80% of min (15000)
                1000,
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }

        if proof.Status != SolvencyStatusInsolvent {
                t.Fatalf("Expected INSOLVENT status, got %s", proof.Status)
        }
}

func TestSolvencyAttestor_VerifySolvency(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        merkleRoot := crypto.Keccak256Hash([]byte("test-solvent")).Hex()

        sa.ComputeAndPublishSolvencyProof(
                merkleRoot,
                1000000000,
                0,
                999999,
                1000,
        )

        isSolvent, proof, err := sa.VerifySolvency()
        if err != nil {
                t.Fatalf("Failed to verify solvency: %v", err)
        }
        if !isSolvent {
                t.Fatal("Expected vault to be solvent")
        }
        if proof == nil {
                t.Fatal("Proof is nil")
        }
}

func TestSolvencyAttestor_VerifySolvencyNoProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        _, _, err := sa.VerifySolvency()
        if err == nil {
                t.Fatal("Expected error when no proof available")
        }
}

func TestSolvencyAttestor_IsSolvent(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // No proof yet — should be insolvent
        if sa.IsSolvent() {
                t.Fatal("Expected insolvent when no proof")
        }

        // Publish solvent proof
        merkleRoot := crypto.Keccak256Hash([]byte("test-solvent")).Hex()
        sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, 1000)

        if !sa.IsSolvent() {
                t.Fatal("Expected solvent after publishing proof")
        }
}

func TestSolvencyAttestor_GetLatestProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        if sa.GetLatestProof() != nil {
                t.Fatal("Expected nil proof initially")
        }

        merkleRoot := crypto.Keccak256Hash([]byte("test-proof")).Hex()
        sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, 1000)

        proof := sa.GetLatestProof()
        if proof == nil {
                t.Fatal("Expected non-nil proof")
        }
        if proof.MerkleRoot != merkleRoot {
                t.Fatalf("Merkle root mismatch: got %s, expected %s", proof.MerkleRoot, merkleRoot)
        }
}

func TestSolvencyAttestor_GetProofHistory(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        for i := 0; i < 5; i++ {
                merkleRoot := crypto.Keccak256Hash([]byte(fmt.Sprintf("test-proof-%d", i))).Hex()
                sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, uint64(1000+i))
        }

        history := sa.GetProofHistory(3)
        if len(history) != 3 {
                t.Fatalf("Expected 3 proofs in history, got %d", len(history))
        }

        allHistory := sa.GetProofHistory(0)
        if len(allHistory) != 5 {
                t.Fatalf("Expected 5 proofs in full history, got %d", len(allHistory))
        }
}

func TestSolvencyAttestor_MarkProofPublished(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        merkleRoot := crypto.Keccak256Hash([]byte("test-published")).Hex()
        sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, 1000)

        if sa.GetPendingCount() != 1 {
                t.Fatalf("Expected 1 pending proof, got %d", sa.GetPendingCount())
        }

        err := sa.MarkProofPublished(merkleRoot)
        if err != nil {
                t.Fatalf("Failed to mark proof as published: %v", err)
        }

        if sa.GetPendingCount() != 0 {
                t.Fatalf("Expected 0 pending proofs after publishing, got %d", sa.GetPendingCount())
        }
}

func TestSolvencyAttestor_MarkProofPublishedNotFound(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        err := sa.MarkProofPublished("0xnonexistent")
        if err == nil {
                t.Fatal("Expected error for non-existent proof")
        }
}

func TestSolvencyAttestor_Validate(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())
        err := sa.ValidateAttestor()
        if err != nil {
                t.Fatalf("Validation failed: %v", err)
        }
}

func TestSolvencyAttestor_Reset(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        merkleRoot := crypto.Keccak256Hash([]byte("test-reset")).Hex()
        sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, 1000)

        sa.Reset()

        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs after reset, got %d", sa.GetProofCount())
        }
        if sa.GetPendingCount() != 0 {
                t.Fatalf("Expected 0 pending proofs after reset, got %d", sa.GetPendingCount())
        }
}

// ==========================================
// keccak256 Merkle Proof Verification Tests
// ==========================================

func TestVerifyMerkleProof_Keccak256(t *testing.T) {
        // Test that the keccak256-based Merkle proof verification works
        // This matches the Solidity SolvencyRoot._verifyMerkleProof function

        // Create two leaf hashes
        leaf1 := crypto.Keccak256Hash([]byte("leaf1"))
        leaf2 := crypto.Keccak256Hash([]byte("leaf2"))

        // Compute the root using sorted ordering
        // In Solidity: if computedHash <= proofElement, hash(computedHash, proofElement)
        // else hash(proofElement, computedHash)
        leaf1Int := new(big.Int).SetBytes(leaf1[:])
        leaf2Int := new(big.Int).SetBytes(leaf2[:])

        var root [32]byte
        if leaf1Int.Cmp(leaf2Int) <= 0 {
                root = crypto.Keccak256Hash(append(leaf1[:], leaf2[:]...))
        } else {
                root = crypto.Keccak256Hash(append(leaf2[:], leaf1[:]...))
        }

        // Verify leaf1 against root
        proof := []string{common.Bytes2Hex(leaf2[:])}
        rootHex := common.BytesToHash(root[:]).Hex()
        leaf1Hex := common.Bytes2Hex(leaf1[:])

        if !verifyMerkleProof(leaf1Hex, proof, rootHex) {
                t.Fatal("Merkle proof verification failed for leaf1")
        }

        // Verify leaf2 against root
        proof2 := []string{common.Bytes2Hex(leaf1[:])}
        leaf2Hex := common.Bytes2Hex(leaf2[:])

        if !verifyMerkleProof(leaf2Hex, proof2, rootHex) {
                t.Fatal("Merkle proof verification failed for leaf2")
        }
}

func TestComputeLeafHash_Keccak256(t *testing.T) {
        // Test that the leaf hash computation matches Solidity's
        // keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
        leaf := ComputeLeafHash(
                1,                                  // positionId
                "0x0000000000000000000000000000000000000001", // depositor
                1000000000,                         // fxrpAmount
                500000,                             // usdValuation
        )

        if leaf == "" {
                t.Fatal("Leaf hash is empty")
        }

        // Verify it's a valid hex hash
        parsed := common.HexToHash(leaf)
        if parsed == (common.Hash{}) {
                t.Fatal("Leaf hash is zero")
        }

        // Verify deterministic
        leaf2 := ComputeLeafHash(1, "0x0000000000000000000000000000000000000001", 1000000000, 500000)
        if leaf != leaf2 {
                t.Fatal("Leaf hash is not deterministic")
        }

        // Different positions should produce different hashes
        leaf3 := ComputeLeafHash(2, "0x0000000000000000000000000000000000000002", 2000000000, 1000000)
        if leaf == leaf3 {
                t.Fatal("Different positions should produce different leaf hashes")
        }
}

// ==========================================
// Position Inclusion Verification Tests
// ==========================================

func TestSolvencyAttestor_VerifyPositionInclusion(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // Compute a Merkle root from test positions
        merkleRoot := crypto.Keccak256Hash([]byte("test-inclusion")).Hex()

        sa.ComputeAndPublishSolvencyProof(merkleRoot, 1000000000, 0, 999999, 1000)

        // Test position inclusion verification
        leafHash := ComputeLeafHash(1, "0xInstitution1", 1000000000, 500000)
        verification, err := sa.VerifyPositionInclusion(
                1, "0xInstitution1", 1000000000, 500000,
                leafHash, []string{},
        )
        if err != nil {
                t.Fatalf("Failed to verify position inclusion: %v", err)
        }
        if verification == nil {
                t.Fatal("Verification is nil")
        }
}

// ==========================================
// End-to-End Tests
// ==========================================

func TestSolvencyAttestor_EndToEnd_FullFlow(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // 1. Compute solvency proof
        merkleRoot := crypto.Keccak256Hash([]byte("e2e-test")).Hex()
        proof, err := sa.ComputeAndPublishSolvencyProof(
                merkleRoot, 1000000000, 0, 999999, 1000,
        )
        if err != nil {
                t.Fatalf("Failed to compute proof: %v", err)
        }

        // 2. Verify solvency
        isSolvent, _, err := sa.VerifySolvency()
        if err != nil {
                t.Fatalf("Failed to verify solvency: %v", err)
        }
        if !isSolvent {
                t.Fatal("Expected vault to be solvent")
        }

        // 3. Mark as published
        err = sa.MarkProofPublished(proof.MerkleRoot)
        if err != nil {
                t.Fatalf("Failed to mark proof as published: %v", err)
        }

        // 4. Get proof history
        history := sa.GetProofHistory(10)
        if len(history) != 1 {
                t.Fatalf("Expected 1 proof in history, got %d", len(history))
        }

        // 5. Compute another proof
        merkleRoot2 := crypto.Keccak256Hash([]byte("e2e-test-2")).Hex()
        proof2, _ := sa.ComputeAndPublishSolvencyProof(
                merkleRoot2, 1000000000, 500000000, 20000, 1001,
        )

        // 6. Verify the new proof is the latest
        latest := sa.GetLatestProof()
        if latest.MerkleRoot != proof2.MerkleRoot {
                t.Fatal("Latest proof should be the most recent one")
        }

        // 7. History should have 2 proofs
        history = sa.GetProofHistory(10)
        if len(history) != 2 {
                t.Fatalf("Expected 2 proofs in history, got %d", len(history))
        }
}
