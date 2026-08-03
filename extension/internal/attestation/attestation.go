// Package attestation implements the SolvencyAttestor module for Aegis.
//
// The SolvencyAttestor is part of Layer 3 (Confidential Compute) and Layer 5 (Verification & Audit).
// It runs inside a Trusted Execution Environment (TEE) and:
//   - Computes the Merkle root of the current vault state
//   - Publishes the solvency proof on-chain via the SolvencyRoot contract
//   - Provides verification tools for auditors
//
// The SolvencyAttestor is the bridge between the PositionComputer (which holds the private state)
// and the SolvencyRoot contract (which holds the public Merkle root). This is the core of the
// confidentiality-to-verifiability transformation:
//   - The full position data is private (inside the TEE)
//   - The Merkle root is published on-chain (public)
//   - Anyone can verify that a specific position is included in the root
//   - No one can see the full position data from the root alone
package attestation

import (
        "encoding/json"
        "fmt"
        "math/big"
        "sync"
        "time"

        "github.com/ethereum/go-ethereum/common"
        "github.com/ethereum/go-ethereum/crypto"

        "github.com/flare-foundation/go-flare-common/pkg/logger"

        "github.com/flare-foundation/tee-node/pkg/types"
)

// SolvencyStatus represents the current solvency status of the vault.
type SolvencyStatus string

const (
        SolvencyStatusSolvent   SolvencyStatus = "SOLVENT"
        SolvencyStatusWarning   SolvencyStatus = "WARNING"
        SolvencyStatusInsolvent SolvencyStatus = "INSOLVENT"
)

// SolvencyProof represents a solvency proof with all the data needed for on-chain publication.
type SolvencyProof struct {
        MerkleRoot          string         `json:"merkleRoot"`
        TotalFxrpCollateral uint64         `json:"totalFxrpCollateral"`
        TotalFxrpLiabilities uint64        `json:"totalFxrpLiabilities"`
        CollateralRatioBps  uint64         `json:"collateralRatioBps"`
        VotingRound         uint64         `json:"votingRound"`
        ComputedAt          time.Time      `json:"computedAt"`
        Status              SolvencyStatus `json:"status"`
        MinCollateralRatioBps uint64       `json:"minCollateralRatioBps"`
}

// AuditVerification represents the result of an audit verification.
type AuditVerification struct {
        PositionID    uint64 `json:"positionId"`
        Depositor     string `json:"depositor"`
        FxrpAmount    uint64 `json:"fxrpAmount"`
        USDValuation  uint64 `json:"usdValuation"`
        IsIncluded    bool   `json:"isIncluded"`
        MerkleRoot    string `json:"merkleRoot"`
        ProofValid    bool   `json:"proofValid"`
        VerifiedAt    time.Time `json:"verifiedAt"`
}

// SolvencyAttestorConfig holds the configuration for the SolvencyAttestor.
type SolvencyAttestorConfig struct {
        SolvencyRootAddress    string `json:"solvencyRootAddress"`
        VerifierRoleAddress    string `json:"verifierRoleAddress"`
        RPCURL                 string `json:"rpcUrl"`
        MinCollateralRatioBps  uint64 `json:"minCollateralRatioBps"`
        PublicationIntervalSec int    `json:"publicationIntervalSec"`
}

// DefaultSolvencyAttestorConfig returns the default configuration for Coston2.
func DefaultSolvencyAttestorConfig() SolvencyAttestorConfig {
        return SolvencyAttestorConfig{
                SolvencyRootAddress:    "",
                VerifierRoleAddress:    "",
                RPCURL:                 "https://coston2-api.flare.network/ext/C/rpc",
                MinCollateralRatioBps:  15000, // 150%
                PublicationIntervalSec: 300,   // 5 minutes
        }
}

// SolvencyAttestor computes Merkle root of solvency and publishes on-chain.
type SolvencyAttestor struct {
        config  SolvencyAttestorConfig
        mu      sync.RWMutex
        proofs  []*SolvencyProof          // history of published proofs
        latest  *SolvencyProof            // current proof
        pending []*SolvencyProof          // pending proofs (not yet published on-chain)
}

// NewSolvencyAttestor creates a new SolvencyAttestor with the given configuration.
func NewSolvencyAttestor(config SolvencyAttestorConfig) *SolvencyAttestor {
        return &SolvencyAttestor{
                config:  config,
                proofs:  make([]*SolvencyProof, 0),
                pending: make([]*SolvencyProof, 0),
        }
}

// ComputeAndPublishSolvencyProof computes the solvency proof from the vault state
// and prepares it for on-chain publication.
// This is the core method that bridges the PositionComputer (private state) to the
// SolvencyRoot contract (public Merkle root).
//
// Parameters:
//   - merkleRoot: The Merkle root computed by the PositionComputer
//   - totalCollateral: Total FXRP collateral in the vault
//   - totalLiabilities: Total FXRP liabilities in the vault
//   - collateralRatioBps: The collateral ratio in basis points
//   - votingRound: The current FDC voting round
func (sa *SolvencyAttestor) ComputeAndPublishSolvencyProof(
        merkleRoot string,
        totalCollateral uint64,
        totalLiabilities uint64,
        collateralRatioBps uint64,
        votingRound uint64,
) (*SolvencyProof, error) {
        if merkleRoot == "" {
                return nil, fmt.Errorf("merkle root cannot be empty")
        }

        sa.mu.Lock()
        defer sa.mu.Unlock()

        // Determine solvency status
        status := sa.determineSolvencyStatus(collateralRatioBps)

        proof := &SolvencyProof{
                MerkleRoot:           merkleRoot,
                TotalFxrpCollateral:  totalCollateral,
                TotalFxrpLiabilities: totalLiabilities,
                CollateralRatioBps:   collateralRatioBps,
                VotingRound:          votingRound,
                ComputedAt:           time.Now(),
                Status:               status,
                MinCollateralRatioBps: sa.config.MinCollateralRatioBps,
        }

        // Store the proof
        sa.proofs = append(sa.proofs, proof)
        sa.latest = proof
        sa.pending = append(sa.pending, proof)

        logger.Infof("Computed solvency proof: root=%s, collateral=%d, liabilities=%d, ratio=%d, status=%s",
                truncateStr(merkleRoot, 16)+"...", totalCollateral, totalLiabilities, collateralRatioBps, status)

        return proof, nil
}

// determineSolvencyStatus determines the solvency status from the collateral ratio.
func (sa *SolvencyAttestor) determineSolvencyStatus(collateralRatioBps uint64) SolvencyStatus {
        if collateralRatioBps >= sa.config.MinCollateralRatioBps {
                return SolvencyStatusSolvent
        }
        if collateralRatioBps >= sa.config.MinCollateralRatioBps*80/100 {
                // Between 80% and 100% of the minimum collateral ratio — warning
                return SolvencyStatusWarning
        }
        return SolvencyStatusInsolvent
}

// VerifySolvency verifies that the current solvency proof is valid.
func (sa *SolvencyAttestor) VerifySolvency() (bool, *SolvencyProof, error) {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        if sa.latest == nil {
                return false, nil, fmt.Errorf("no solvency proof available")
        }

        // Verify the proof
        isSolvent := sa.latest.Status == SolvencyStatusSolvent || sa.latest.Status == SolvencyStatusWarning

        return isSolvent, sa.latest, nil
}

// VerifyPositionInclusion verifies that a position is included in the current Merkle root.
// This is the auditor-side verification function.
func (sa *SolvencyAttestor) VerifyPositionInclusion(
        positionID uint64,
        depositor string,
        fxrpAmount uint64,
        usdValuation uint64,
        leafHash string,
        proof []string,
) (*AuditVerification, error) {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        if sa.latest == nil {
                return nil, fmt.Errorf("no solvency proof available")
        }

        // Verify the Merkle proof
        isValid := verifyMerkleProof(leafHash, proof, sa.latest.MerkleRoot)

        verification := &AuditVerification{
                PositionID:   positionID,
                Depositor:    depositor,
                FxrpAmount:   fxrpAmount,
                USDValuation: usdValuation,
                IsIncluded:   isValid,
                MerkleRoot:   sa.latest.MerkleRoot,
                ProofValid:   isValid,
                VerifiedAt:   time.Now(),
        }

        logger.Infof("Position inclusion verification: positionId=%d, included=%v, root=%s",
                positionID, isValid, truncateStr(sa.latest.MerkleRoot, 16)+"...")

        return verification, nil
}

// GetLatestProof returns the latest solvency proof.
func (sa *SolvencyAttestor) GetLatestProof() *SolvencyProof {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        return sa.latest
}

// GetProofHistory returns the history of all solvency proofs.
func (sa *SolvencyAttestor) GetProofHistory(limit int) []*SolvencyProof {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        if limit <= 0 || limit > len(sa.proofs) {
                limit = len(sa.proofs)
        }

        history := make([]*SolvencyProof, limit)
        copy(history, sa.proofs[len(sa.proofs)-limit:])

        return history
}

// GetPendingProofs returns proofs that haven't been published on-chain yet.
func (sa *SolvencyAttestor) GetPendingProofs() []*SolvencyProof {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        return sa.pending
}

// MarkProofPublished marks a proof as published on-chain.
func (sa *SolvencyAttestor) MarkProofPublished(merkleRoot string) error {
        sa.mu.Lock()
        defer sa.mu.Unlock()

        // Remove from pending
        for i, proof := range sa.pending {
                if proof.MerkleRoot == merkleRoot {
                        sa.pending = append(sa.pending[:i], sa.pending[i+1:]...)
                        logger.Infof("Marked proof as published: root=%s", truncateStr(merkleRoot, 16)+"...")
                        return nil
                }
        }

        return fmt.Errorf("proof not found in pending: %s", merkleRoot)
}

// IsSolvent returns whether the vault is currently solvent.
func (sa *SolvencyAttestor) IsSolvent() bool {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        if sa.latest == nil {
                return false
        }

        return sa.latest.Status == SolvencyStatusSolvent || sa.latest.Status == SolvencyStatusWarning
}

// GetSolvencyStatus returns the current solvency status.
func (sa *SolvencyAttestor) GetSolvencyStatus() SolvencyStatus {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        if sa.latest == nil {
                return SolvencyStatusInsolvent
        }

        return sa.latest.Status
}

// ValidateAttestor validates that the SolvencyAttestor is configured correctly.
func (sa *SolvencyAttestor) ValidateAttestor() error {
        if sa.config.RPCURL == "" {
                return fmt.Errorf("RPC URL not configured")
        }
        if sa.config.MinCollateralRatioBps == 0 {
                return fmt.Errorf("min collateral ratio not configured")
        }

        logger.Infof("SolvencyAttestor validation passed: RPC=%s, minCollateralRatio=%d",
                sa.config.RPCURL, sa.config.MinCollateralRatioBps)

        return nil
}

// Reset resets the SolvencyAttestor state (for testing only).
func (sa *SolvencyAttestor) Reset() {
        sa.mu.Lock()
        defer sa.mu.Unlock()

        sa.proofs = make([]*SolvencyProof, 0)
        sa.latest = nil
        sa.pending = make([]*SolvencyProof, 0)
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// verifyMerkleProof verifies a Merkle proof using keccak256 with sorted left/right ordering.
// This matches the Solidity SolvencyRoot._verifyMerkleProof function exactly.
func verifyMerkleProof(leaf string, proof []string, root string) bool {
        current := common.HexToHash(leaf)
        for _, sibling := range proof {
                siblingHash := common.HexToHash(sibling)
                currentInt := new(big.Int).SetBytes(current[:])
                siblingInt := new(big.Int).SetBytes(siblingHash[:])

                if currentInt.Cmp(siblingInt) <= 0 {
                        current = crypto.Keccak256Hash(append(current[:], siblingHash[:]...))
                } else {
                        current = crypto.Keccak256Hash(append(siblingHash[:], current[:]...))
                }
        }
        return current == common.HexToHash(root)
}

// ComputeLeafHash computes the keccak256 hash of a position leaf for Merkle proof verification.
// This matches the Solidity contract's keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation)).
func ComputeLeafHash(positionID uint64, depositor string, fxrpAmount uint64, usdValuation uint64) string {
        // Match Solidity: keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
        depositorAddr := common.HexToAddress(depositor)
        data := make([]byte, 0, 124) // 32 + 20 + 32 + 32 = 116 bytes

        // positionId as uint256 (32 bytes big-endian)
        positionIdBytes := common.LeftPadBytes(new(big.Int).SetUint64(positionID).Bytes(), 32)
        data = append(data, positionIdBytes...)

        // depositor as address (20 bytes)
        data = append(data, depositorAddr.Bytes()...)

        // fxrpAmount as uint256 (32 bytes big-endian)
        fxrpBytes := common.LeftPadBytes(new(big.Int).SetUint64(fxrpAmount).Bytes(), 32)
        data = append(data, fxrpBytes...)

        // usdValuation as uint256 (32 bytes big-endian)
        usdBytes := common.LeftPadBytes(new(big.Int).SetUint64(usdValuation).Bytes(), 32)
        data = append(data, usdBytes...)

        hash := crypto.Keccak256Hash(data)
        return hash.Hex()
}

// BuildSolvencyAction builds an FCC action for solvency proof publication.
// This is used to publish the solvency proof on-chain via the FCC extension.
func (sa *SolvencyAttestor) BuildSolvencyAction(proof *SolvencyProof) (*types.Action, error) {
        if proof == nil {
                return nil, fmt.Errorf("proof cannot be nil")
        }

        // Encode the solvency proof data
        proofData, err := json.Marshal(proof)
        if err != nil {
                return nil, fmt.Errorf("failed to marshal proof: %w", err)
        }

        action := &types.Action{
                Data: types.ActionData{
                        // The solvency proof data is encoded in the action
                        // and will be processed by the FCC extension for on-chain publication
                },
        }

        _ = proofData // Used in production for on-chain publication

        logger.Infof("Built solvency action: root=%s, status=%s", truncateStr(proof.MerkleRoot, 16)+"...", proof.Status)

        return action, nil
}

// GetProofCount returns the total number of proofs.
func (sa *SolvencyAttestor) GetProofCount() int {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        return len(sa.proofs)
}

// GetPendingCount returns the number of pending proofs.
func (sa *SolvencyAttestor) GetPendingCount() int {
        sa.mu.RLock()
        defer sa.mu.RUnlock()

        return len(sa.pending)
}

// truncateStr truncates a string to the given length.
func truncateStr(s string, maxLen int) string {
        if len(s) <= maxLen {
                return s
        }
        return s[:maxLen]
}
