// Package position implements the PositionComputer module for Aegis.
//
// The PositionComputer is the core of Layer 3 (Confidential Compute) in the Aegis architecture.
// It runs inside a Trusted Execution Environment (TEE) and rebuilds the complete vault state from:
//   - On-chain events (DepositMade, WithdrawalCompleted, EmergencyExit, PositionRevalued)
//   - FDC-attested external state (XRPL payments, address validity, etc.)
//   - FTSO price feeds (XRP/USD, FLR/USD, etc.)
//
// The PositionComputer is the ONLY component that has access to the full vault state.
// No individual position data leaves the TEE — only the Merkle root of the state is published
// on-chain via the SolvencyRoot contract. This is the confidentiality-to-verifiability
// transformation that is the core of the Aegis thesis.
//
// Key Design Decisions:
//   1. All position data is stored in-memory inside the TEE
//   2. The Merkle root is computed using keccak256 (matching Solidity's keccak256(abi.encodePacked(...)))
//   3. No individual position is ever written to on-chain storage
//   4. The PositionComputer can be rebuilt from on-chain events + FDC attestations at any time
//   5. The state is deterministic: given the same events and attestations, the same state is produced
//
// Data Flow:
//   DepositMade event → PositionComputer.processDeposit() → Update in-memory state
//   FDC attestation → PositionComputer.updateExternalState() → Update in-memory state
//   FTSO price update → PositionComputer.revaluePositions() → Update valuations
//   PositionComputer.computeMerkleRoot() → SolvencyRoot.publishSolvencyProof()
package position

import (
        "context"
        "crypto/ecdsa"
        "encoding/json"
        "fmt"
        "math/big"
        "sort"
        "strings"
        "sync"
        "time"

        "github.com/ethereum/go-ethereum"
        "github.com/ethereum/go-ethereum/accounts/abi"
        "github.com/ethereum/go-ethereum/common"
        "github.com/ethereum/go-ethereum/core/types"
        "github.com/ethereum/go-ethereum/crypto"
        "github.com/ethereum/go-ethereum/ethclient"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
)

// PositionStatus represents the current status of a position.
type PositionStatus string

const (
        PositionStatusActive     PositionStatus = "ACTIVE"
        PositionStatusWithdrawal PositionStatus = "WITHDRAWAL_INITIATED"
        PositionStatusClosed     PositionStatus = "CLOSED"
        PositionStatusEmergency  PositionStatus = "EMERGENCY_WITHDRAWAL"
)

// ExternalChain represents an external blockchain.
type ExternalChain string

const (
        ExternalChainXRPL        ExternalChain = "XRPL"
        ExternalChainBase        ExternalChain = "BASE"
        ExternalChainHyperliquid ExternalChain = "HYPERLIQUID"
)

// Position represents a single depositor's position in the vault.
// This is the core data structure — it captures all the information about a deposit
// including the FXRP amount, USD valuation, timestamps, and any cross-chain state.
type Position struct {
        PositionID    uint64         `json:"positionId"`
        Depositor     string         `json:"depositor"`
        FxrpAmount    uint64         `json:"fxrpAmount"`    // FXRP amount in UBA (6 decimals)
        USDValuation  uint64         `json:"usdValuation"`  // USD valuation in cents (2 decimals)
        DepositTime   time.Time      `json:"depositTime"`
        LastRevalTime time.Time      `json:"lastRevalTime"`
        Status        PositionStatus `json:"status"`
        PolicyID      uint64         `json:"policyId"`

        // Cross-chain state (FDC-attested)
        ExternalBalances map[ExternalChain]uint64 `json:"externalBalances"` // chain => amount in UBA

        // Risk metrics
        RiskScore   float64 `json:"riskScore"`   // 0.0 to 1.0
        DrawdownBps uint64  `json:"drawdownBps"` // drawdown in basis points
        IsSolvent   bool    `json:"isSolvent"`
}

// ExternalState represents FDC-attested state from an external chain.
type ExternalState struct {
        Chain         ExternalChain `json:"chain"`
        Address       string        `json:"address"`
        Balance       uint64        `json:"balance"`       // In UBA
        AttestedAt    time.Time     `json:"attestedAt"`
        VotingRound   uint64        `json:"votingRound"`
        AttestationID string        `json:"attestationId"` // FDC attestation reference
        IsVerified    bool          `json:"isVerified"`
}

// VaultState represents the complete vault state as computed by the PositionComputer.
type VaultState struct {
        TotalFxrpDeposited   uint64                         `json:"totalFxrpDeposited"`
        TotalUSDValuation    uint64                         `json:"totalUsdValuation"`
        ActivePositionCount  uint64                         `json:"activePositionCount"`
        TotalFxrpLiabilities uint64                         `json:"totalFxrpLiabilities"`
        CollateralRatioBps   uint64                         `json:"collateralRatioBps"`
        XRPUSDPrice          uint64                         `json:"xrpUsdPrice"` // Price in 5-decimal format
        LastUpdateTime       time.Time                      `json:"lastUpdateTime"`
        MerkleRoot           string                         `json:"merkleRoot"`
        ExternalState        map[ExternalChain]*ExternalState `json:"externalState"`
        IsSolvent            bool                           `json:"isSolvent"`
}

// OnChainEvent represents an event from the vault contracts.
type OnChainEvent struct {
        EventType  string    `json:"eventType"` // "DepositMade", "WithdrawalCompleted", etc.
        PositionID uint64    `json:"positionId"`
        Depositor  string    `json:"depositor"`
        Amount     uint64    `json:"amount"`
        USDValue   uint64    `json:"usdValue"`
        Timestamp  time.Time `json:"timestamp"`
        BlockNum   uint64    `json:"blockNum"`
        TxHash     string    `json:"txHash"`
}

// FDCAttestationData represents data from an FDC attestation.
type FDCAttestationData struct {
        AttestationType string    `json:"attestationType"`
        SourceID        string    `json:"sourceId"`
        VotingRound     uint64    `json:"votingRound"`
        Data            []byte    `json:"data"`
        IsVerified      bool      `json:"isVerified"`
        VerifiedAt      time.Time `json:"verifiedAt"`
}

// MerkleLeaf represents a leaf in the Merkle tree.
type MerkleLeaf struct {
        PositionID   uint64 `json:"positionId"`
        Depositor    string `json:"depositor"`
        FxrpAmount   uint64 `json:"fxrpAmount"`
        USDValuation uint64 `json:"usdValuation"`
}

// PositionComputerConfig holds the configuration for the PositionComputer.
type PositionComputerConfig struct {
        VaultCoreAddress       string `json:"vaultCoreAddress"`
        PolicyRegistryAddress  string `json:"policyRegistryAddress"`
        SolvencyRootAddress    string `json:"solvencyRootAddress"`
        RPCURL                 string `json:"rpcUrl"`
        MinCollateralRatioBps  uint64 `json:"minCollateralRatioBps"`
        MaxPositionCount       int    `json:"maxPositionCount"`
        RevaluationIntervalSec int    `json:"revaluationIntervalSec"`
}

// DefaultPositionComputerConfig returns the default configuration for Coston2.
func DefaultPositionComputerConfig() PositionComputerConfig {
        return PositionComputerConfig{
                VaultCoreAddress:       "",
                PolicyRegistryAddress:  "",
                SolvencyRootAddress:    "",
                RPCURL:                 "https://coston2-api.flare.network/ext/C/rpc",
                MinCollateralRatioBps:  15000, // 150%
                MaxPositionCount:       1000,
                RevaluationIntervalSec: 300, // 5 minutes
        }
}

// PositionComputer rebuilds complete vault state from on-chain events + FDC-attested external state.
// This is the core of Layer 3 (Confidential Compute) — all computation runs inside TEEs.
type PositionComputer struct {
        config      PositionComputerConfig
        mu          sync.RWMutex
        positions   map[uint64]*Position              // positionId => Position
        depositor   map[string][]uint64               // depositor => []positionId
        external    map[ExternalChain]*ExternalState  // chain => ExternalState
        vault       *VaultState                       // current vault state
        events      []*OnChainEvent                   // processed events
        xrpUsdPrice uint64                            // current XRP/USD price from FTSO
}

// NewPositionComputer creates a new PositionComputer with the given configuration.
func NewPositionComputer(config PositionComputerConfig) *PositionComputer {
        return &PositionComputer{
                config:    config,
                positions: make(map[uint64]*Position),
                depositor: make(map[string][]uint64),
                external:  make(map[ExternalChain]*ExternalState),
                vault: &VaultState{
                        ExternalState:  make(map[ExternalChain]*ExternalState),
                        LastUpdateTime: time.Now(),
                },
                events:      make([]*OnChainEvent, 0),
                xrpUsdPrice: 0,
        }
}

// ==========================================
// EVENT PROCESSING — Core State Rebuild
// ==========================================

// ProcessEvent processes an on-chain event and updates the vault state.
// This is the core method that rebuilds the vault state from events.
// The PositionComputer is deterministic: given the same sequence of events,
// it always produces the same state.
func (pc *PositionComputer) ProcessEvent(event *OnChainEvent) error {
        if event == nil {
                return fmt.Errorf("event cannot be nil")
        }

        pc.mu.Lock()
        defer pc.mu.Unlock()

        switch event.EventType {
        case "DepositMade":
                return pc.processDeposit(event)
        case "WithdrawalInitiated":
                return pc.processWithdrawalInitiated(event)
        case "WithdrawalCompleted":
                return pc.processWithdrawalCompleted(event)
        case "EmergencyWithdrawal":
                return pc.processEmergencyWithdrawal(event)
        case "PositionRevalued":
                return pc.processPositionRevalued(event)
        default:
                logger.Warnf("Unknown event type: %s", event.EventType)
                return fmt.Errorf("unknown event type: %s", event.EventType)
        }
}

// processDeposit handles a DepositMade event.
func (pc *PositionComputer) processDeposit(event *OnChainEvent) error {
        position := &Position{
                PositionID:    event.PositionID,
                Depositor:     event.Depositor,
                FxrpAmount:    event.Amount,
                USDValuation:  event.USDValue,
                DepositTime:   event.Timestamp,
                LastRevalTime: event.Timestamp,
                Status:        PositionStatusActive,
                ExternalBalances: make(map[ExternalChain]uint64),
                RiskScore:     0.0,
                DrawdownBps:   0,
                IsSolvent:     true,
        }

        pc.positions[event.PositionID] = position
        pc.depositor[event.Depositor] = append(pc.depositor[event.Depositor], event.PositionID)
        pc.events = append(pc.events, event)

        // Update vault state
        pc.vault.TotalFxrpDeposited += event.Amount
        pc.vault.TotalUSDValuation += event.USDValue
        pc.vault.ActivePositionCount++
        pc.vault.LastUpdateTime = event.Timestamp

        // Recompute collateral ratio
        pc.recomputeCollateralRatio()

        logger.Infof("Processed DepositMade: positionId=%d, depositor=%s, amount=%d, usdValue=%d",
                event.PositionID, event.Depositor, event.Amount, event.USDValue)

        return nil
}

// processWithdrawalInitiated handles a WithdrawalInitiated event.
func (pc *PositionComputer) processWithdrawalInitiated(event *OnChainEvent) error {
        position, exists := pc.positions[event.PositionID]
        if !exists {
                return fmt.Errorf("position not found: %d", event.PositionID)
        }

        position.Status = PositionStatusWithdrawal
        pc.events = append(pc.events, event)
        pc.vault.LastUpdateTime = event.Timestamp

        logger.Infof("Processed WithdrawalInitiated: positionId=%d, amount=%d",
                event.PositionID, event.Amount)

        return nil
}

// processWithdrawalCompleted handles a WithdrawalCompleted event.
func (pc *PositionComputer) processWithdrawalCompleted(event *OnChainEvent) error {
        position, exists := pc.positions[event.PositionID]
        if !exists {
                return fmt.Errorf("position not found: %d", event.PositionID)
        }

        // Update vault state
        pc.vault.TotalFxrpDeposited -= position.FxrpAmount
        pc.vault.TotalUSDValuation -= position.USDValuation
        pc.vault.ActivePositionCount--
        pc.vault.TotalFxrpLiabilities += position.FxrpAmount

        position.FxrpAmount = 0
        position.USDValuation = 0
        position.Status = PositionStatusClosed
        pc.events = append(pc.events, event)
        pc.vault.LastUpdateTime = event.Timestamp

        // Recompute collateral ratio
        pc.recomputeCollateralRatio()

        logger.Infof("Processed WithdrawalCompleted: positionId=%d", event.PositionID)

        return nil
}

// processEmergencyWithdrawal handles an EmergencyWithdrawal event.
func (pc *PositionComputer) processEmergencyWithdrawal(event *OnChainEvent) error {
        position, exists := pc.positions[event.PositionID]
        if !exists {
                return fmt.Errorf("position not found: %d", event.PositionID)
        }

        pc.vault.TotalFxrpDeposited -= position.FxrpAmount
        pc.vault.TotalUSDValuation -= position.USDValuation
        pc.vault.ActivePositionCount--

        position.FxrpAmount = 0
        position.USDValuation = 0
        position.Status = PositionStatusEmergency
        pc.events = append(pc.events, event)
        pc.vault.LastUpdateTime = event.Timestamp

        pc.recomputeCollateralRatio()

        logger.Infof("Processed EmergencyWithdrawal: positionId=%d", event.PositionID)

        return nil
}

// processPositionRevalued handles a PositionRevalued event.
func (pc *PositionComputer) processPositionRevalued(event *OnChainEvent) error {
        position, exists := pc.positions[event.PositionID]
        if !exists {
                return fmt.Errorf("position not found: %d", event.PositionID)
        }

        // Update the position valuation
        oldValuation := position.USDValuation
        position.USDValuation = event.USDValue
        position.LastRevalTime = event.Timestamp

        // Update the vault total
        pc.vault.TotalUSDValuation = pc.vault.TotalUSDValuation - oldValuation + event.USDValue

        // Compute drawdown
        if oldValuation > 0 && event.USDValue < oldValuation {
                drawdown := (oldValuation - event.USDValue) * 10000 / oldValuation
                position.DrawdownBps = drawdown
        }

        pc.events = append(pc.events, event)
        pc.vault.LastUpdateTime = event.Timestamp

        pc.recomputeCollateralRatio()

        logger.Infof("Processed PositionRevalued: positionId=%d, oldVal=%d, newVal=%d",
                event.PositionID, oldValuation, event.USDValue)

        return nil
}

// ==========================================
// FDC-ATTESTED EXTERNAL STATE
// ==========================================

// UpdateExternalState updates the vault state with FDC-attested external chain data.
// This is how the PositionComputer incorporates cross-chain state (XRPL payments,
// Base OFT transfers, Hyperliquid positions) into the vault state.
//
// The FDC attestation provides cryptographic proof that the external state is accurate.
// This is critical for the PositionComputer to maintain a correct view of assets
// held across multiple chains.
func (pc *PositionComputer) UpdateExternalState(state *ExternalState) error {
        if state == nil {
                return fmt.Errorf("external state cannot be nil")
        }
        if !state.IsVerified {
                return fmt.Errorf("external state is not verified by FDC")
        }

        pc.mu.Lock()
        defer pc.mu.Unlock()

        pc.external[state.Chain] = state
        pc.vault.ExternalState[state.Chain] = state
        pc.vault.LastUpdateTime = time.Now()

        logger.Infof("Updated external state: chain=%s, address=%s, balance=%d, votingRound=%d",
                state.Chain, state.Address, state.Balance, state.VotingRound)

        return nil
}

// ProcessFDCAttestation processes an FDC attestation and updates the relevant state.
func (pc *PositionComputer) ProcessFDCAttestation(attestation *FDCAttestationData) error {
        if attestation == nil {
                return fmt.Errorf("attestation cannot be nil")
        }
        if !attestation.IsVerified {
                return fmt.Errorf("attestation is not verified")
        }

        pc.mu.Lock()
        defer pc.mu.Unlock()

        // Parse the attestation data based on type
        switch attestation.AttestationType {
        case "Payment":
                // XRPL payment attestation — update external balances
                var paymentData struct {
                        ReceivedAmount uint64 `json:"receivedAmount"`
                        Destination    string `json:"destination"`
                }
                // Try JSON parsing first
                if err := parseAttestationData(attestation.Data, &paymentData); err == nil && paymentData.ReceivedAmount > 0 {
                        // Update XRPL external state
                        if state, exists := pc.external[ExternalChainXRPL]; exists {
                                state.Balance += paymentData.ReceivedAmount
                                state.AttestedAt = attestation.VerifiedAt
                                state.VotingRound = attestation.VotingRound
                                state.IsVerified = true
                        } else {
                                pc.external[ExternalChainXRPL] = &ExternalState{
                                        Chain:        ExternalChainXRPL,
                                        Address:      paymentData.Destination,
                                        Balance:      paymentData.ReceivedAmount,
                                        AttestedAt:   attestation.VerifiedAt,
                                        VotingRound:  attestation.VotingRound,
                                        IsVerified:   true,
                                }
                        }
                        pc.vault.ExternalState[ExternalChainXRPL] = pc.external[ExternalChainXRPL]
                }

        case "AddressValidity":
                // Address validity attestation — mark the address as verified
                logger.Infof("Address validity attestation verified: source=%s, votingRound=%d",
                        attestation.SourceID, attestation.VotingRound)

        case "EVMTransaction":
                // EVM transaction attestation — update Base/Hyperliquid state
                logger.Infof("EVM transaction attestation verified: source=%s, votingRound=%d",
                        attestation.SourceID, attestation.VotingRound)

        default:
                logger.Warnf("Unknown attestation type: %s", attestation.AttestationType)
        }

        pc.vault.LastUpdateTime = time.Now()

        return nil
}

// parseAttestationData parses attestation data bytes into a struct.
func parseAttestationData(data []byte, v interface{}) error {
        return json.Unmarshal(data, v)
}

// ==========================================
// FTSO PRICE FEEDS
// ==========================================

// UpdatePrice updates the XRP/USD price from the FTSO feed.
// This is called periodically by the RiskAgent to keep the valuations current.
func (pc *PositionComputer) UpdatePrice(xrpUsdPrice uint64) error {
        if xrpUsdPrice == 0 {
                return fmt.Errorf("price cannot be zero")
        }

        pc.mu.Lock()
        defer pc.mu.Unlock()

        pc.xrpUsdPrice = xrpUsdPrice
        pc.vault.XRPUSDPrice = xrpUsdPrice

        // Revalue all positions with the new price
        pc.revalueAllPositions()

        logger.Infof("Updated XRP/USD price: %d (5-decimal format)", xrpUsdPrice)

        return nil
}

// revalueAllPositions revalues all active positions with the current XRP/USD price.
func (pc *PositionComputer) revalueAllPositions() {
        if pc.xrpUsdPrice == 0 {
                return
        }

        totalUSDValuation := uint64(0)
        for _, position := range pc.positions {
                if position.Status == PositionStatusActive {
                        // USD valuation = (FXRP amount * price) / 10^6
                        // FXRP is in UBA (6 decimals), price is in 5-decimal format
                        newValuation := (position.FxrpAmount * pc.xrpUsdPrice) / 1e6

                        // Compute drawdown
                        if position.USDValuation > 0 && newValuation < position.USDValuation {
                                drawdown := (position.USDValuation - newValuation) * 10000 / position.USDValuation
                                position.DrawdownBps = drawdown
                        }

                        position.USDValuation = newValuation
                        position.LastRevalTime = time.Now()
                        totalUSDValuation += newValuation
                }
        }

        pc.vault.TotalUSDValuation = totalUSDValuation
        pc.recomputeCollateralRatio()
}

// ==========================================
// MERKLE ROOT COMPUTATION — keccak256 for Solidity compatibility
// ==========================================

// ComputeMerkleRoot computes the Merkle root of the current vault state.
// This is the core of the confidentiality-to-verifiability transformation:
//   - The full position data is private (inside the TEE)
//   - The Merkle root is published on-chain (public)
//   - Anyone can verify that a specific position is included in the root
//   - No one can see the full position data from the root alone
//
// The Merkle tree uses keccak256 (matching Solidity's keccak256(abi.encodePacked(...)))
// so that proofs generated in Go can be verified on-chain in the SolvencyRoot contract.
//
// Leaf hash format: keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
// This matches the Solidity contract's verifyPosition function exactly.
func (pc *PositionComputer) ComputeMerkleRoot() (string, error) {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        // Collect all active positions as leaves
        leaves := make([][32]byte, 0)
        for _, position := range pc.positions {
                if position.Status == PositionStatusActive {
                        leaf := computeLeafHashKeccak256(position)
                        leaves = append(leaves, leaf)
                }
        }

        if len(leaves) == 0 {
                // Empty tree — return hash of empty string
                emptyHash := crypto.Keccak256Hash([]byte("aegis-empty-vault"))
                return emptyHash.Hex(), nil
        }

        // Sort leaves for deterministic ordering (compare as big.Int for sorted Merkle tree)
        sort.Slice(leaves, func(i, j int) bool {
                return new(big.Int).SetBytes(leaves[i][:]).Cmp(new(big.Int).SetBytes(leaves[j][:])) < 0
        })

        // Build the Merkle tree
        root := pc.buildMerkleTreeKeccak256(leaves)

        pc.vault.MerkleRoot = common.BytesToHash(root[:]).Hex()
        pc.vault.LastUpdateTime = time.Now()

        logger.Infof("Computed Merkle root: %s (from %d leaves)", common.BytesToHash(root[:]).Hex()[:16]+"...", len(leaves))

        return common.BytesToHash(root[:]).Hex(), nil
}

// computeLeafHashKeccak256 computes the keccak256 hash of a position leaf.
// This matches the Solidity contract's keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
// exactly, so that the Go and Solidity implementations produce the same leaf hash.
func computeLeafHashKeccak256(position *Position) [32]byte {
        // Solidity: keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
        // In Solidity, abi.encodePacked for uint256 packs as 32 bytes, address as 20 bytes
        return ComputeLeafHashKeccak256(position.PositionID, position.Depositor, position.FxrpAmount, position.USDValuation)
}

// ComputeLeafHashKeccak256 computes the keccak256 hash of a position leaf.
// This is the exported version that can be used by other packages.
// It matches the Solidity contract's keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
// exactly, so that the Go and Solidity implementations produce the same leaf hash.
func ComputeLeafHashKeccak256(positionID uint64, depositor string, fxrpAmount uint64, usdValuation uint64) [32]byte {
        // Solidity: keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation))
        // In Solidity, abi.encodePacked for uint256 packs as 32 bytes, address as 20 bytes
        depositorAddr := common.HexToAddress(depositor)
        data := make([]byte, 0, 124) // 32 + 20 + 32 + 32 = 116 bytes + padding

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

        return crypto.Keccak256Hash(data)
}

// buildMerkleTreeKeccak256 builds a Merkle tree from the given leaves and returns the root.
// Uses keccak256 and sorted left/right ordering to match Solidity's _verifyMerkleProof.
func (pc *PositionComputer) buildMerkleTreeKeccak256(leaves [][32]byte) [32]byte {
        if len(leaves) == 1 {
                return leaves[0]
        }

        // Build the next level
        nextLevel := make([][32]byte, 0)
        for i := 0; i < len(leaves); i += 2 {
                if i+1 < len(leaves) {
                        // Sorted: if left <= right, hash(left, right); else hash(right, left)
                        // This matches Solidity's _verifyMerkleProof which uses computedHash <= proofElement
                        left := leaves[i]
                        right := leaves[i+1]
                        leftInt := new(big.Int).SetBytes(left[:])
                        rightInt := new(big.Int).SetBytes(right[:])

                        var combined [32]byte
                        if leftInt.Cmp(rightInt) <= 0 {
                                combined = crypto.Keccak256Hash(append(left[:], right[:]...))
                        } else {
                                combined = crypto.Keccak256Hash(append(right[:], left[:]...))
                        }
                        nextLevel = append(nextLevel, combined)
                } else {
                        // Odd leaf — promote to next level
                        nextLevel = append(nextLevel, leaves[i])
                }
        }

        return pc.buildMerkleTreeKeccak256(nextLevel)
}

// ==========================================
// STATE QUERIES
// ==========================================

// GetPosition returns a position by ID.
func (pc *PositionComputer) GetPosition(positionID uint64) (*Position, error) {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        position, exists := pc.positions[positionID]
        if !exists {
                return nil, fmt.Errorf("position not found: %d", positionID)
        }
        return position, nil
}

// GetVaultState returns the current vault state.
func (pc *PositionComputer) GetVaultState() *VaultState {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        // Return a copy
        state := *pc.vault
        return &state
}

// GetActivePositions returns all active positions.
func (pc *PositionComputer) GetActivePositions() []*Position {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        positions := make([]*Position, 0)
        for _, p := range pc.positions {
                if p.Status == PositionStatusActive {
                        positions = append(positions, p)
                }
        }
        return positions
}

// GetDepositorPositions returns all positions for a given depositor.
func (pc *PositionComputer) GetDepositorPositions(depositor string) []*Position {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        positionIDs, exists := pc.depositor[depositor]
        if !exists {
                return []*Position{}
        }

        positions := make([]*Position, 0, len(positionIDs))
        for _, id := range positionIDs {
                if p, exists := pc.positions[id]; exists {
                        positions = append(positions, p)
                }
        }
        return positions
}

// GetExternalState returns the external state for a given chain.
func (pc *PositionComputer) GetExternalState(chain ExternalChain) (*ExternalState, error) {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        state, exists := pc.external[chain]
        if !exists {
                return nil, fmt.Errorf("external state not found for chain: %s", chain)
        }
        return state, nil
}

// GetProcessedEvents returns all processed events.
func (pc *PositionComputer) GetProcessedEvents() []*OnChainEvent {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        events := make([]*OnChainEvent, len(pc.events))
        copy(events, pc.events)
        return events
}

// GetPositionCount returns the total number of positions.
func (pc *PositionComputer) GetPositionCount() int {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        return len(pc.positions)
}

// GetActivePositionCount returns the number of active positions.
func (pc *PositionComputer) GetActivePositionCount() int {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        count := 0
        for _, p := range pc.positions {
                if p.Status == PositionStatusActive {
                        count++
                }
        }
        return count
}

// ==========================================
// MERKLE PROOF VERIFICATION — keccak256 for Solidity compatibility
// ==========================================

// GenerateMerkleProof generates a Merkle proof for a given position.
// The proof allows an auditor to verify that a specific position is included
// in the Merkle root without revealing any other positions.
//
// The proof is generated using keccak256 with sorted left/right ordering,
// matching the Solidity _verifyMerkleProof function exactly.
func (pc *PositionComputer) GenerateMerkleProof(positionID uint64) ([][32]byte, error) {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        position, exists := pc.positions[positionID]
        if !exists {
                return nil, fmt.Errorf("position not found: %d", positionID)
        }
        if position.Status != PositionStatusActive {
                return nil, fmt.Errorf("position is not active: %d", positionID)
        }

        // Collect all active leaves
        leaves := make([][32]byte, 0)
        targetLeaf := computeLeafHashKeccak256(position)
        targetIndex := -1

        for _, p := range pc.positions {
                if p.Status == PositionStatusActive {
                        leaf := computeLeafHashKeccak256(p)
                        leaves = append(leaves, leaf)
                }
        }

        // Sort leaves for deterministic ordering (same as ComputeMerkleRoot)
        sort.Slice(leaves, func(i, j int) bool {
                return new(big.Int).SetBytes(leaves[i][:]).Cmp(new(big.Int).SetBytes(leaves[j][:])) < 0
        })

        // Find the target in the sorted list
        for i, leaf := range leaves {
                if leaf == targetLeaf {
                        targetIndex = i
                        break
                }
        }

        if targetIndex == -1 {
                return nil, fmt.Errorf("target leaf not found in sorted tree")
        }

        // Generate the proof
        proof := pc.generateProofKeccak256(leaves, targetIndex)
        return proof, nil
}

// GenerateMerkleProofHex generates a Merkle proof as hex strings for compatibility.
func (pc *PositionComputer) GenerateMerkleProofHex(positionID uint64) ([]string, error) {
        proof, err := pc.GenerateMerkleProof(positionID)
        if err != nil {
                return nil, err
        }

        hexProof := make([]string, len(proof))
        for i, p := range proof {
                hexProof[i] = common.Bytes2Hex(p[:])
        }
        return hexProof, nil
}

// generateProofKeccak256 generates a Merkle proof for the leaf at the given index.
// Uses keccak256 and sorted left/right ordering to match Solidity's _verifyMerkleProof.
func (pc *PositionComputer) generateProofKeccak256(leaves [][32]byte, index int) [][32]byte {
        if len(leaves) == 1 {
                return [][32]byte{}
        }

        proof := make([][32]byte, 0)

        // Get the sibling
        var sibling [32]byte
        if index%2 == 0 {
                // Left child — sibling is right
                if index+1 < len(leaves) {
                        sibling = leaves[index+1]
                }
        } else {
                // Right child — sibling is left
                sibling = leaves[index-1]
        }

        proof = append(proof, sibling)

        // Build the next level
        nextLevel := make([][32]byte, 0)
        nextIndex := index / 2
        for i := 0; i < len(leaves); i += 2 {
                if i+1 < len(leaves) {
                        left := leaves[i]
                        right := leaves[i+1]
                        leftInt := new(big.Int).SetBytes(left[:])
                        rightInt := new(big.Int).SetBytes(right[:])

                        var combined [32]byte
                        if leftInt.Cmp(rightInt) <= 0 {
                                combined = crypto.Keccak256Hash(append(left[:], right[:]...))
                        } else {
                                combined = crypto.Keccak256Hash(append(right[:], left[:]...))
                        }
                        nextLevel = append(nextLevel, combined)
                } else {
                        nextLevel = append(nextLevel, leaves[i])
                }
        }

        // Recurse
        subProof := pc.generateProofKeccak256(nextLevel, nextIndex)
        proof = append(proof, subProof...)

        return proof
}

// VerifyMerkleProof verifies that a given position is included in the Merkle root.
// This is the auditor-side verification function that matches Solidity's _verifyMerkleProof.
// Uses sorted left/right ordering: if computedHash <= proofElement, hash(computedHash, proofElement);
// else hash(proofElement, computedHash).
func (pc *PositionComputer) VerifyMerkleProof(leaf [32]byte, proof [][32]byte, root [32]byte) bool {
        computedHash := leaf
        for _, proofElement := range proof {
                computedInt := new(big.Int).SetBytes(computedHash[:])
                proofInt := new(big.Int).SetBytes(proofElement[:])

                if computedInt.Cmp(proofInt) <= 0 {
                        computedHash = crypto.Keccak256Hash(append(computedHash[:], proofElement[:]...))
                } else {
                        computedHash = crypto.Keccak256Hash(append(proofElement[:], computedHash[:]...))
                }
        }
        return computedHash == root
}

// VerifyMerkleProofHex verifies a Merkle proof using hex strings.
func (pc *PositionComputer) VerifyMerkleProofHex(leafHex string, proofHex []string, rootHex string) bool {
        leaf := common.HexToHash(leafHex)
        root := common.HexToHash(rootHex)

        proof := make([][32]byte, len(proofHex))
        for i, p := range proofHex {
                proof[i] = common.HexToHash(p)
        }

        return pc.VerifyMerkleProof(leaf, proof, root)
}

// ==========================================
// ON-CHAIN EVENT LISTENER
// ==========================================

// VaultCoreABI is the minimal ABI for reading VaultCore events.
const VaultCoreABI = `[
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": true, "name": "depositor", "type": "address"},
                        {"indexed": false, "name": "fxrpAmount", "type": "uint256"},
                        {"indexed": false, "name": "usdValuation", "type": "uint256"},
                        {"indexed": false, "name": "positionId", "type": "uint256"}
                ],
                "name": "DepositMade",
                "type": "event"
        },
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": true, "name": "depositor", "type": "address"},
                        {"indexed": false, "name": "fxrpAmount", "type": "uint256"},
                        {"indexed": false, "name": "positionId", "type": "uint256"}
                ],
                "name": "WithdrawalCompleted",
                "type": "event"
        },
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": true, "name": "depositor", "type": "address"},
                        {"indexed": false, "name": "fxrpAmount", "type": "uint256"},
                        {"indexed": false, "name": "positionId", "type": "uint256"}
                ],
                "name": "EmergencyExit",
                "type": "event"
        },
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": true, "name": "positionId", "type": "uint256"},
                        {"indexed": false, "name": "newUsdValuation", "type": "uint256"},
                        {"indexed": false, "name": "timestamp", "type": "uint256"}
                ],
                "name": "PositionRevalued",
                "type": "event"
        }
]`

// EventListener reads events from the VaultCore contract on Coston2.
type EventListener struct {
        client       *ethclient.Client
        vaultCoreABI abi.ABI
        vaultCoreAddr common.Address
        chainID      *big.Int
}

// NewEventListener creates a new EventListener.
func NewEventListener(rpcURL string, vaultCoreAddr string) (*EventListener, error) {
        client, err := ethclient.Dial(rpcURL)
        if err != nil {
                return nil, fmt.Errorf("failed to connect to RPC: %w", err)
        }

        chainID, err := client.ChainID(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get chain ID: %w", err)
        }

        parsedABI, err := abi.JSON(strings.NewReader(VaultCoreABI))
        if err != nil {
                return nil, fmt.Errorf("failed to parse ABI: %w", err)
        }

        logger.Infof("EventListener connected: chainID=%s, rpcURL=%s, vaultCore=%s", chainID.String(), rpcURL, vaultCoreAddr)

        return &EventListener{
                client:       client,
                vaultCoreABI: parsedABI,
                vaultCoreAddr: common.HexToAddress(vaultCoreAddr),
                chainID:      chainID,
        }, nil
}

// Close closes the RPC connection.
func (el *EventListener) Close() {
        if el.client != nil {
                el.client.Close()
        }
}

// FetchDepositEvents fetches DepositMade events from the VaultCore contract.
func (el *EventListener) FetchDepositEvents(fromBlock uint64, toBlock *uint64) ([]*OnChainEvent, error) {
        return el.fetchEvents("DepositMade", fromBlock, toBlock)
}

// FetchWithdrawalEvents fetches WithdrawalCompleted events from the VaultCore contract.
func (el *EventListener) FetchWithdrawalEvents(fromBlock uint64, toBlock *uint64) ([]*OnChainEvent, error) {
        return el.fetchEvents("WithdrawalCompleted", fromBlock, toBlock)
}

// FetchAllEvents fetches all vault events from the VaultCore contract.
func (el *EventListener) FetchAllEvents(fromBlock uint64, toBlock *uint64) ([]*OnChainEvent, error) {
        var allEvents []*OnChainEvent

        for _, eventName := range []string{"DepositMade", "WithdrawalCompleted", "EmergencyExit", "PositionRevalued"} {
                events, err := el.fetchEvents(eventName, fromBlock, toBlock)
                if err != nil {
                        logger.Warnf("Failed to fetch %s events: %v", eventName, err)
                        continue
                }
                allEvents = append(allEvents, events...)
        }

        // Sort by block number
        sort.Slice(allEvents, func(i, j int) bool {
                return allEvents[i].BlockNum < allEvents[j].BlockNum
        })

        return allEvents, nil
}

// fetchEvents fetches events of a specific type from the VaultCore contract.
func (el *EventListener) fetchEvents(eventName string, fromBlock uint64, toBlock *uint64) ([]*OnChainEvent, error) {
        // Build the event query
        query := ethereum.FilterQuery{
                FromBlock: new(big.Int).SetUint64(fromBlock),
                Addresses: []common.Address{el.vaultCoreAddr},
        }

        if toBlock != nil {
                query.ToBlock = new(big.Int).SetUint64(*toBlock)
        }

        // Get the event ID from the ABI
        event, ok := el.vaultCoreABI.Events[eventName]
        if !ok {
                return nil, fmt.Errorf("event %s not found in ABI", eventName)
        }
        query.Topics = [][]common.Hash{{event.ID}}

        logs, err := el.client.FilterLogs(context.Background(), query)
        if err != nil {
                return nil, fmt.Errorf("failed to filter logs: %w", err)
        }

        events := make([]*OnChainEvent, 0, len(logs))
        for _, vLog := range logs {
                event, err := el.parseLogToEvent(eventName, vLog)
                if err != nil {
                        logger.Warnf("Failed to parse log: %v", err)
                        continue
                }
                events = append(events, event)
        }
        logger.Infof("Fetched %d %s events from blocks %d to %v", len(events), eventName, fromBlock, toBlock)

        return events, nil
}

// parseLogToEvent parses an Ethereum log into an OnChainEvent.
func (el *EventListener) parseLogToEvent(eventName string, vLog types.Log) (*OnChainEvent, error) {
        switch eventName {
        case "DepositMade":
                // DepositMade(address depositor, uint256 fxrpAmount, uint256 usdValuation, uint256 positionId)
                depositor := vLog.Topics[1].Hex()
                // Unpack non-indexed data
                type DepositMadeData struct {
                        FxrpAmount   *big.Int
                        UsdValuation *big.Int
                        PositionId   *big.Int
                }
                var data DepositMadeData
                if err := el.vaultCoreABI.UnpackIntoInterface(&data, "DepositMade", vLog.Data); err != nil {
                        return nil, fmt.Errorf("failed to unpack DepositMade: %w", err)
                }
                return &OnChainEvent{
                        EventType:  "DepositMade",
                        PositionID: data.PositionId.Uint64(),
                        Depositor:  depositor,
                        Amount:     data.FxrpAmount.Uint64(),
                        USDValue:   data.UsdValuation.Uint64(),
                        BlockNum:   vLog.BlockNumber,
                        TxHash:     vLog.TxHash.Hex(),
                }, nil

        case "WithdrawalCompleted":
                // WithdrawalCompleted(address depositor, uint256 fxrpAmount, uint256 positionId)
                depositor := vLog.Topics[1].Hex()
                type WithdrawalData struct {
                        FxrpAmount *big.Int
                        PositionId *big.Int
                }
                var data WithdrawalData
                if err := el.vaultCoreABI.UnpackIntoInterface(&data, "WithdrawalCompleted", vLog.Data); err != nil {
                        return nil, fmt.Errorf("failed to unpack WithdrawalCompleted: %w", err)
                }
                return &OnChainEvent{
                        EventType:  "WithdrawalCompleted",
                        PositionID: data.PositionId.Uint64(),
                        Depositor:  depositor,
                        Amount:     data.FxrpAmount.Uint64(),
                        BlockNum:   vLog.BlockNumber,
                        TxHash:     vLog.TxHash.Hex(),
                }, nil

        case "EmergencyExit":
                // EmergencyExit(address depositor, uint256 fxrpAmount, uint256 positionId)
                depositor := vLog.Topics[1].Hex()
                type EmergencyData struct {
                        FxrpAmount *big.Int
                        PositionId *big.Int
                }
                var data EmergencyData
                if err := el.vaultCoreABI.UnpackIntoInterface(&data, "EmergencyExit", vLog.Data); err != nil {
                        return nil, fmt.Errorf("failed to unpack EmergencyExit: %w", err)
                }
                return &OnChainEvent{
                        EventType:  "EmergencyWithdrawal",
                        PositionID: data.PositionId.Uint64(),
                        Depositor:  depositor,
                        Amount:     data.FxrpAmount.Uint64(),
                        BlockNum:   vLog.BlockNumber,
                        TxHash:     vLog.TxHash.Hex(),
                }, nil

        case "PositionRevalued":
                // PositionRevalued(uint256 positionId, uint256 newUsdValuation, uint256 timestamp)
                positionId := vLog.Topics[1].Big().Uint64()
                type RevaluedData struct {
                        NewUsdValuation *big.Int
                        Timestamp       *big.Int
                }
                var data RevaluedData
                if err := el.vaultCoreABI.UnpackIntoInterface(&data, "PositionRevalued", vLog.Data); err != nil {
                        return nil, fmt.Errorf("failed to unpack PositionRevalued: %w", err)
                }
                return &OnChainEvent{
                        EventType:  "PositionRevalued",
                        PositionID: positionId,
                        USDValue:   data.NewUsdValuation.Uint64(),
                        BlockNum:   vLog.BlockNumber,
                        TxHash:     vLog.TxHash.Hex(),
                }, nil

        default:
                return nil, fmt.Errorf("unknown event name: %s", eventName)
        }
}

// ==========================================
// FTSO V2 ON-CHAIN PRICE READER
// ==========================================

// FTSO V2 ABI for getFeedById
const FtsoV2ABI = `[
        {
                "inputs": [{"name": "feedId", "type": "bytes21"}],
                "name": "getFeedById",
                "outputs": [
                        {"name": "", "type": "uint256"},
                        {"name": "", "type": "uint64"},
                        {"name": "", "type": "uint16"}
                ],
                "stateMutability": "payable",
                "type": "function"
        }
]`

// XRP/USD feed ID for FTSO V2 (from the VaultCore contract)
// bytes21 feedId = 0x015852502f55534400000000000000000000000000 (XRP/USD)
var XRP_USD_FEED_ID = [21]byte{0x01, 0x58, 0x52, 0x50, 0x2f, 0x55, 0x53, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}

// ReadFTSOPrice reads the current XRP/USD price from FTSO V2 on Coston2.
func ReadFTSOPrice(rpcURL string, ftsoV2Addr string) (uint64, error) {
        client, err := ethclient.Dial(rpcURL)
        if err != nil {
                return 0, fmt.Errorf("failed to connect to RPC: %w", err)
        }
        defer client.Close()

        parsedABI, err := abi.JSON(strings.NewReader(FtsoV2ABI))
        if err != nil {
                return 0, fmt.Errorf("failed to parse ABI: %w", err)
        }

        // Pack the function call
        data, err := parsedABI.Pack("getFeedById", XRP_USD_FEED_ID)
        if err != nil {
                return 0, fmt.Errorf("failed to pack getFeedById: %w", err)
        }

        // Call the contract
        addr := common.HexToAddress(ftsoV2Addr)
        result, err := client.CallContract(context.Background(), ethereum.CallMsg{
                To:   &addr,
                Data: data,
        }, nil)
        if err != nil {
                return 0, fmt.Errorf("failed to call getFeedById: %w", err)
        }

        // Unpack the result
        type FeedResult struct {
                Price        *big.Int
                Timestamp    uint64
                Decimals     uint16
        }
        var feedResult FeedResult
        if err := parsedABI.UnpackIntoInterface(&feedResult, "getFeedById", result); err != nil {
                return 0, fmt.Errorf("failed to unpack getFeedById result: %w", err)
        }

        logger.Infof("FTSO V2 XRP/USD price: %s (decimals: %d)", feedResult.Price.String(), feedResult.Decimals)

        return feedResult.Price.Uint64(), nil
}

// ==========================================
// INTERNAL HELPERS
// ==========================================

// recomputeCollateralRatio recomputes the collateral ratio from the current state.
func (pc *PositionComputer) recomputeCollateralRatio() {
        if pc.vault.TotalFxrpLiabilities == 0 {
                // No liabilities means the vault is fully solvent — set a high collateral ratio
                // This ensures the SolvencyAttestor correctly identifies the vault as solvent
                pc.vault.CollateralRatioBps = 999999 // Effectively infinite collateral ratio
                pc.vault.IsSolvent = true
                return
        }

        // Collateral ratio = (total deposited / total liabilities) * 10000
        pc.vault.CollateralRatioBps = (pc.vault.TotalFxrpDeposited * 10000) / pc.vault.TotalFxrpLiabilities
        pc.vault.IsSolvent = pc.vault.CollateralRatioBps >= pc.config.MinCollateralRatioBps
}

// ValidatePositionComputer validates that the PositionComputer is configured correctly.
func (pc *PositionComputer) ValidatePositionComputer() error {
        if pc.config.RPCURL == "" {
                return fmt.Errorf("RPC URL not configured")
        }
        if pc.config.MinCollateralRatioBps == 0 {
                return fmt.Errorf("min collateral ratio not configured")
        }
        if pc.config.MaxPositionCount == 0 {
                return fmt.Errorf("max position count not configured")
        }

        logger.Infof("PositionComputer validation passed: RPC=%s, minCollateralRatio=%d, maxPositions=%d",
                pc.config.RPCURL, pc.config.MinCollateralRatioBps, pc.config.MaxPositionCount)

        return nil
}

// Reset resets the PositionComputer state (for testing only).
func (pc *PositionComputer) Reset() {
        pc.mu.Lock()
        defer pc.mu.Unlock()

        pc.positions = make(map[uint64]*Position)
        pc.depositor = make(map[string][]uint64)
        pc.external = make(map[ExternalChain]*ExternalState)
        pc.vault = &VaultState{
                ExternalState:  make(map[ExternalChain]*ExternalState),
                LastUpdateTime: time.Now(),
        }
        pc.events = make([]*OnChainEvent, 0)
        pc.xrpUsdPrice = 0
}

// ComputeSolvencyData computes the solvency data for the SolvencyRoot contract.
// This is the output that gets published on-chain.
func (pc *PositionComputer) ComputeSolvencyData() (merkleRoot string, totalCollateral uint64, totalLiabilities uint64, collateralRatioBps uint64, err error) {
        merkleRoot, err = pc.ComputeMerkleRoot()
        if err != nil {
                return "", 0, 0, 0, fmt.Errorf("failed to compute Merkle root: %w", err)
        }

        pc.mu.RLock()
        defer pc.mu.RUnlock()

        return merkleRoot, pc.vault.TotalFxrpDeposited, pc.vault.TotalFxrpLiabilities,
                pc.vault.CollateralRatioBps, nil
}

// GetVerifierAddress returns the verifier address from a private key.
func GetVerifierAddress(privateKeyHex string) (common.Address, error) {
        privateKey, err := crypto.HexToECDSA(privateKeyHex)
        if err != nil {
                return common.Address{}, fmt.Errorf("failed to parse private key: %w", err)
        }

        publicKey := privateKey.Public().(*ecdsa.PublicKey)
        address := crypto.PubkeyToAddress(*publicKey)
        return address, nil
}

// GetChainID returns the chain ID from the RPC.
func GetChainID(rpcURL string) (*big.Int, error) {
        client, err := ethclient.Dial(rpcURL)
        if err != nil {
                return nil, fmt.Errorf("failed to connect to RPC: %w", err)
        }
        defer client.Close()

        chainID, err := client.ChainID(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get chain ID: %w", err)
        }

        return chainID, nil
}
