package attestation

import (
        "testing"
)

// ==========================================
// CONSTRUCTOR TESTS
// ==========================================

func TestNewSolvencyAttestor(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()
        sa := NewSolvencyAttestor(config)

        if sa == nil {
                t.Fatal("SolvencyAttestor should not be nil")
        }
        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs, got %d", sa.GetProofCount())
        }
        if sa.IsSolvent() {
                t.Fatal("Expected IsSolvent=false with no proofs")
        }
}

func TestDefaultSolvencyAttestorConfig(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()

        if config.RPCURL != "https://coston2-api.flare.network/ext/C/rpc" {
                t.Fatalf("Expected Coston2 RPC URL, got %s", config.RPCURL)
        }
        if config.MinCollateralRatioBps != 15000 {
                t.Fatalf("Expected 15000 min collateral ratio, got %d", config.MinCollateralRatioBps)
        }
        if config.PublicationIntervalSec != 300 {
                t.Fatalf("Expected 300 publication interval, got %d", config.PublicationIntervalSec)
        }
}

// ==========================================
// COMPUTE AND PUBLISH TESTS
// ==========================================

func TestComputeAndPublishSolvencyProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        proof, err := sa.ComputeAndPublishSolvencyProof(
                "abc123def456",  // merkleRoot
                1_000_000_000,   // totalCollateral
                500_000_000,     // totalLiabilities
                20000,           // collateralRatioBps
                1414258,         // votingRound
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }

        if proof.MerkleRoot != "abc123def456" {
                t.Fatalf("Expected merkle root abc123def456, got %s", proof.MerkleRoot)
        }
        if proof.TotalFxrpCollateral != 1_000_000_000 {
                t.Fatalf("Expected total collateral 1000000000, got %d", proof.TotalFxrpCollateral)
        }
        if proof.TotalFxrpLiabilities != 500_000_000 {
                t.Fatalf("Expected total liabilities 500000000, got %d", proof.TotalFxrpLiabilities)
        }
        if proof.CollateralRatioBps != 20000 {
                t.Fatalf("Expected collateral ratio 20000, got %d", proof.CollateralRatioBps)
        }
        if proof.Status != SolvencyStatusSolvent {
                t.Fatalf("Expected SOLVENT status, got %s", proof.Status)
        }
        if proof.VotingRound != 1414258 {
                t.Fatalf("Expected voting round 1414258, got %d", proof.VotingRound)
        }
}

func TestComputeAndPublishSolvencyProof_EmptyRoot(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        _, err := sa.ComputeAndPublishSolvencyProof("", 1000, 500, 20000, 1)
        if err == nil {
                t.Fatal("Expected error for empty merkle root")
        }
}

func TestComputeAndPublishSolvencyProof_Insolvent(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        proof, err := sa.ComputeAndPublishSolvencyProof(
                "insolvent-root", 500_000_000, 500_000_000, 10000, 1414258,
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }
        if proof.Status != SolvencyStatusInsolvent {
                t.Fatalf("Expected INSOLVENT status, got %s", proof.Status)
        }
}

func TestComputeAndPublishSolvencyProof_Warning(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // 80% of 15000 = 12000 — this should be a WARNING
        proof, err := sa.ComputeAndPublishSolvencyProof(
                "warning-root", 600_000_000, 500_000_000, 12000, 1414258,
        )
        if err != nil {
                t.Fatalf("Failed to compute solvency proof: %v", err)
        }
        if proof.Status != SolvencyStatusWarning {
                t.Fatalf("Expected WARNING status, got %s", proof.Status)
        }
}

// ==========================================
// VERIFY SOLVENCY TESTS
// ==========================================

func TestVerifySolvency(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("solvent-root", 1_000_000_000, 500_000_000, 20000, 1414258)

        isSolvent, proof, err := sa.VerifySolvency()
        if err != nil {
                t.Fatalf("Failed to verify solvency: %v", err)
        }
        if !isSolvent {
                t.Fatal("Expected vault to be solvent")
        }
        if proof == nil {
                t.Fatal("Proof should not be nil")
        }
}

func TestVerifySolvency_NoProofs(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        _, _, err := sa.VerifySolvency()
        if err == nil {
                t.Fatal("Expected error with no proofs")
        }
}

// ==========================================
// POSITION INCLUSION VERIFICATION TESTS
// ==========================================

func TestVerifyPositionInclusion(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // Create a proof with a known Merkle root
        sa.ComputeAndPublishSolvencyProof("test-root-hash", 1_000_000_000, 500_000_000, 20000, 1414258)

        // Verify a position with a simple proof
        verification, err := sa.VerifyPositionInclusion(
                1, "0xDepositor1", 100_000_000, 50000,
                "leaf-hash", []string{"sibling-hash"},
        )
        if err != nil {
                t.Fatalf("Failed to verify position inclusion: %v", err)
        }
        if verification == nil {
                t.Fatal("Verification should not be nil")
        }
        // Note: The proof verification will fail because the hashes don't match,
        // but the function should still work correctly.
}

func TestVerifyPositionInclusion_NoProofs(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        _, err := sa.VerifyPositionInclusion(1, "0xDepositor1", 100, 50, "leaf", []string{})
        if err == nil {
                t.Fatal("Expected error with no proofs")
        }
}

// ==========================================
// PROOF MANAGEMENT TESTS
// ==========================================

func TestGetLatestProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // No proofs initially
        if sa.GetLatestProof() != nil {
                t.Fatal("Expected nil latest proof initially")
        }

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)

        latest := sa.GetLatestProof()
        if latest.MerkleRoot != "root2" {
                t.Fatalf("Expected latest root 'root2', got %s", latest.MerkleRoot)
        }
}

func TestGetProofHistory(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)
        sa.ComputeAndPublishSolvencyProof("root3", 1_500_000_000, 500_000_000, 30000, 1414260)

        history := sa.GetProofHistory(2)
        if len(history) != 2 {
                t.Fatalf("Expected 2 proofs in history, got %d", len(history))
        }
        if history[0].MerkleRoot != "root2" {
                t.Fatalf("Expected first proof root 'root2', got %s", history[0].MerkleRoot)
        }
        if history[1].MerkleRoot != "root3" {
                t.Fatalf("Expected second proof root 'root3', got %s", history[1].MerkleRoot)
        }
}

func TestGetProofHistory_All(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)

        history := sa.GetProofHistory(0) // 0 means all
        if len(history) != 2 {
                t.Fatalf("Expected 2 proofs in history, got %d", len(history))
        }
}

func TestGetPendingProofs(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)

        pending := sa.GetPendingProofs()
        if len(pending) != 2 {
                t.Fatalf("Expected 2 pending proofs, got %d", len(pending))
        }
}

func TestMarkProofPublished(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)

        err := sa.MarkProofPublished("root1")
        if err != nil {
                t.Fatalf("Failed to mark proof as published: %v", err)
        }

        pending := sa.GetPendingProofs()
        if len(pending) != 1 {
                t.Fatalf("Expected 1 pending proof, got %d", len(pending))
        }
        if pending[0].MerkleRoot != "root2" {
                t.Fatalf("Expected pending root 'root2', got %s", pending[0].MerkleRoot)
        }
}

func TestMarkProofPublished_NotFound(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        err := sa.MarkProofPublished("nonexistent")
        if err == nil {
                t.Fatal("Expected error for nonexistent proof")
        }
}

// ==========================================
// IS SOLVENT TESTS
// ==========================================

func TestIsSolvent_Solvent(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)

        if !sa.IsSolvent() {
                t.Fatal("Expected vault to be solvent")
        }
}

func TestIsSolvent_Warning(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // 12000 is between 80% and 100% of 15000 — WARNING
        sa.ComputeAndPublishSolvencyProof("root1", 600_000_000, 500_000_000, 12000, 1414258)

        if !sa.IsSolvent() {
                t.Fatal("Expected vault to be solvent (WARNING status is still solvent)")
        }
}

func TestIsSolvent_Insolvent(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 500_000_000, 500_000_000, 10000, 1414258)

        if sa.IsSolvent() {
                t.Fatal("Expected vault to be insolvent")
        }
}

func TestGetSolvencyStatus(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        if sa.GetSolvencyStatus() != SolvencyStatusInsolvent {
                t.Fatal("Expected INSOLVENT status with no proofs")
        }

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        if sa.GetSolvencyStatus() != SolvencyStatusSolvent {
                t.Fatalf("Expected SOLVENT status, got %s", sa.GetSolvencyStatus())
        }
}

// ==========================================
// VALIDATION TESTS
// ==========================================

func TestValidateAttestor(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        err := sa.ValidateAttestor()
        if err != nil {
                t.Fatalf("SolvencyAttestor validation failed: %v", err)
        }
}

func TestValidateAttestor_MissingRPCURL(t *testing.T) {
        config := DefaultSolvencyAttestorConfig()
        config.RPCURL = ""
        sa := NewSolvencyAttestor(config)

        err := sa.ValidateAttestor()
        if err == nil {
                t.Fatal("Expected error for missing RPC URL")
        }
}

// ==========================================
// RESET TESTS
// ==========================================

func TestReset(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)

        sa.Reset()

        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs after reset, got %d", sa.GetProofCount())
        }
        if sa.GetLatestProof() != nil {
                t.Fatal("Expected nil latest proof after reset")
        }
}

// ==========================================
// HELPER FUNCTION TESTS
// ==========================================

func TestComputeLeafHash(t *testing.T) {
        hash1 := ComputeLeafHash(1, "0xDepositor1", 100_000_000, 50000)
        hash2 := ComputeLeafHash(2, "0xDepositor2", 200_000_000, 100000)

        if hash1 == "" {
                t.Fatal("Leaf hash should not be empty")
        }
        if hash1 == hash2 {
                t.Fatal("Different positions should produce different hashes")
        }

        // Deterministic
        hash1Again := ComputeLeafHash(1, "0xDepositor1", 100_000_000, 50000)
        if hash1 != hash1Again {
                t.Fatal("Leaf hash should be deterministic")
        }
}

func TestVerifyMerkleProof(t *testing.T) {
        // Simple test: empty proof, leaf = root
        isValid := verifyMerkleProof("test-root", []string{}, "test-root")
        if !isValid {
                t.Fatal("Expected valid proof for empty proof with matching root")
        }

        // Invalid proof
        isValid = verifyMerkleProof("wrong-leaf", []string{}, "test-root")
        if isValid {
                t.Fatal("Expected invalid proof for wrong leaf")
        }
}

// ==========================================
// BUILD ACTION TESTS
// ==========================================

func TestBuildSolvencyAction(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        proof, _ := sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)

        action, err := sa.BuildSolvencyAction(proof)
        if err != nil {
                t.Fatalf("Failed to build solvency action: %v", err)
        }
        if action == nil {
                t.Fatal("Action should not be nil")
        }
}

func TestBuildSolvencyAction_NilProof(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        _, err := sa.BuildSolvencyAction(nil)
        if err == nil {
                t.Fatal("Expected error for nil proof")
        }
}

// ==========================================
// COUNT TESTS
// ==========================================

func TestGetProofCount(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs, got %d", sa.GetProofCount())
        }

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        if sa.GetProofCount() != 1 {
                t.Fatalf("Expected 1 proof, got %d", sa.GetProofCount())
        }

        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)
        if sa.GetProofCount() != 2 {
                t.Fatalf("Expected 2 proofs, got %d", sa.GetProofCount())
        }
}

func TestGetPendingCount(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        sa.ComputeAndPublishSolvencyProof("root2", 1_200_000_000, 500_000_000, 24000, 1414259)

        if sa.GetPendingCount() != 2 {
                t.Fatalf("Expected 2 pending proofs, got %d", sa.GetPendingCount())
        }

        sa.MarkProofPublished("root1")
        if sa.GetPendingCount() != 1 {
                t.Fatalf("Expected 1 pending proof, got %d", sa.GetPendingCount())
        }
}

// ==========================================
// FULL LIFECYCLE TEST
// ==========================================

func TestFullSolvencyAttestorLifecycle(t *testing.T) {
        sa := NewSolvencyAttestor(DefaultSolvencyAttestorConfig())

        // 1. Compute and publish a proof
        proof1, err := sa.ComputeAndPublishSolvencyProof("root1", 1_000_000_000, 500_000_000, 20000, 1414258)
        if err != nil {
                t.Fatalf("Failed to compute proof 1: %v", err)
        }
        if proof1.Status != SolvencyStatusSolvent {
                t.Fatalf("Expected SOLVENT, got %s", proof1.Status)
        }

        // 2. Verify solvency
        isSolvent, _, _ := sa.VerifySolvency()
        if !isSolvent {
                t.Fatal("Expected vault to be solvent")
        }

        // 3. Publish a second proof (insolvent)
        proof2, _ := sa.ComputeAndPublishSolvencyProof("root2", 500_000_000, 500_000_000, 10000, 1414259)
        if proof2.Status != SolvencyStatusInsolvent {
                t.Fatalf("Expected INSOLVENT, got %s", proof2.Status)
        }

        // 4. Verify solvency is now false
        isSolvent, _, _ = sa.VerifySolvency()
        if isSolvent {
                t.Fatal("Expected vault to be insolvent")
        }

        // 5. Check proof history
        history := sa.GetProofHistory(0)
        if len(history) != 2 {
                t.Fatalf("Expected 2 proofs in history, got %d", len(history))
        }

        // 6. Mark proof as published
        sa.MarkProofPublished("root1")
        if sa.GetPendingCount() != 1 {
                t.Fatalf("Expected 1 pending proof, got %d", sa.GetPendingCount())
        }

        // 7. Build a solvency action
        action, err := sa.BuildSolvencyAction(proof2)
        if err != nil {
                t.Fatalf("Failed to build solvency action: %v", err)
        }
        if action == nil {
                t.Fatal("Action should not be nil")
        }

        // 8. Reset
        sa.Reset()
        if sa.GetProofCount() != 0 {
                t.Fatalf("Expected 0 proofs after reset, got %d", sa.GetProofCount())
        }
}
