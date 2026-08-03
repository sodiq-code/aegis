// Package position implements the PositionComputer module for Aegis.
//
// The PositionComputer is the core of Layer 3 (Confidential Compute) in the Aegis architecture.
// It runs inside a Trusted Execution Environment (TEE) and rebuilds the complete vault state from:
//   - On-chain events (DepositMade, WithdrawalInitiated, WithdrawalCompleted, etc.)
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
//   2. The Merkle root is computed from the full position set
//   3. No individual position is ever written to on-chain storage
//   4. The PositionComputer can be rebuilt from on-chain events + FDC attestations at any time
//   5. The state is deterministic: given the same events and attestations, the same state is produced
//
// Data Flow:
//   DepositMade event → PositionComputer.createPosition() → Update in-memory state
//   FDC attestation → PositionComputer.updateExternalState() → Update in-memory state
//   FTSO price update → PositionComputer.revaluePositions() → Update valuations
//   PositionComputer.computeMerkleRoot() → SolvencyRoot.publishSolvencyProof()
package position

import (
        "crypto/sha256"
        "encoding/hex"
        "encoding/json"
        "fmt"
        "sort"
        "sync"
        "time"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
)

// PositionStatus represents the current status of a position.
type PositionStatus string

const (
        PositionStatusActive      PositionStatus = "ACTIVE"
        PositionStatusWithdrawal  PositionStatus = "WITHDRAWAL_INITIATED"
        PositionStatusClosed      PositionStatus = "CLOSED"
        PositionStatusEmergency   PositionStatus = "EMERGENCY_WITHDRAWAL"
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
        RiskScore     float64 `json:"riskScore"`     // 0.0 to 1.0
        DrawdownBps   uint64  `json:"drawdownBps"`   // drawdown in basis points
        IsSolvent     bool    `json:"isSolvent"`
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
        TotalFxrpDeposited    uint64             `json:"totalFxrpDeposited"`
        TotalUSDValuation     uint64             `json:"totalUsdValuation"`
        ActivePositionCount   uint64             `json:"activePositionCount"`
        TotalFxrpLiabilities  uint64             `json:"totalFxrpLiabilities"`
        CollateralRatioBps    uint64             `json:"collateralRatioBps"`
        XRPUSDPrice           uint64             `json:"xrpUsdPrice"`       // Price in 5-decimal format
        LastUpdateTime        time.Time          `json:"lastUpdateTime"`
        MerkleRoot            string             `json:"merkleRoot"`
        ExternalState         map[ExternalChain]*ExternalState `json:"externalState"`
        IsSolvent             bool               `json:"isSolvent"`
}

// OnChainEvent represents an event from the vault contracts.
type OnChainEvent struct {
        EventType string    `json:"eventType"` // "DepositMade", "WithdrawalInitiated", etc.
        PositionID uint64   `json:"positionId"`
        Depositor  string   `json:"depositor"`
        Amount     uint64   `json:"amount"`
        USDValue   uint64   `json:"usdValue"`
        Timestamp  time.Time `json:"timestamp"`
        BlockNum   uint64   `json:"blockNum"`
        TxHash     string   `json:"txHash"`
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
        PositionID  uint64 `json:"positionId"`
        Depositor   string `json:"depositor"`
        FxrpAmount  uint64 `json:"fxrpAmount"`
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
        config    PositionComputerConfig
        mu        sync.RWMutex
        positions map[uint64]*Position              // positionId => Position
        depositor map[string][]uint64               // depositor => []positionId
        external  map[ExternalChain]*ExternalState  // chain => ExternalState
        vault     *VaultState                       // current vault state
        events    []*OnChainEvent                   // processed events
        xrpUsdPrice uint64                          // current XRP/USD price from FTSO
}

// NewPositionComputer creates a new PositionComputer with the given configuration.
func NewPositionComputer(config PositionComputerConfig) *PositionComputer {
        return &PositionComputer{
                config:    config,
                positions: make(map[uint64]*Position),
                depositor: make(map[string][]uint64),
                external:  make(map[ExternalChain]*ExternalState),
                vault: &VaultState{
                        ExternalState: make(map[ExternalChain]*ExternalState),
                        LastUpdateTime: time.Now(),
                },
                events:    make([]*OnChainEvent, 0),
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
                if err := json.Unmarshal(attestation.Data, &paymentData); err == nil {
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
// MERKLE ROOT COMPUTATION
// ==========================================

// ComputeMerkleRoot computes the Merkle root of the current vault state.
// This is the core of the confidentiality-to-verifiability transformation:
//   - The full position data is private (inside the TEE)
//   - The Merkle root is published on-chain (public)
//   - Anyone can verify that a specific position is included in the root
//   - No one can see the full position data from the root alone
//
// The Merkle tree is built from the leaves of active positions.
// Each leaf is: hash(positionId || depositor || fxrpAmount || usdValuation)
func (pc *PositionComputer) ComputeMerkleRoot() (string, error) {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        // Collect all active positions as leaves
        leaves := make([]string, 0)
        for _, position := range pc.positions {
                if position.Status == PositionStatusActive {
                        leaf := pc.computeLeafHash(position)
                        leaves = append(leaves, leaf)
                }
        }

        if len(leaves) == 0 {
                // Empty tree — return hash of empty string
                emptyHash := sha256.Sum256([]byte("aegis-empty-vault"))
                return hex.EncodeToString(emptyHash[:]), nil
        }

        // Sort leaves for deterministic ordering
        sort.Strings(leaves)

        // Build the Merkle tree
        root := pc.buildMerkleTree(leaves)

        pc.vault.MerkleRoot = root
        pc.vault.LastUpdateTime = time.Now()

        logger.Infof("Computed Merkle root: %s (from %d leaves)", root[:16]+"...", len(leaves))

        return root, nil
}

// computeLeafHash computes the hash of a position leaf.
func (pc *PositionComputer) computeLeafHash(position *Position) string {
        data := fmt.Sprintf("%d|%s|%d|%d", position.PositionID, position.Depositor,
                position.FxrpAmount, position.USDValuation)
        hash := sha256.Sum256([]byte(data))
        return hex.EncodeToString(hash[:])
}

// buildMerkleTree builds a Merkle tree from the given leaves and returns the root.
func (pc *PositionComputer) buildMerkleTree(leaves []string) string {
        if len(leaves) == 1 {
                return leaves[0]
        }

        // Build the next level
        nextLevel := make([]string, 0)
        for i := 0; i < len(leaves); i += 2 {
                if i+1 < len(leaves) {
                        // Hash the pair
                        combined := leaves[i] + leaves[i+1]
                        hash := sha256.Sum256([]byte(combined))
                        nextLevel = append(nextLevel, hex.EncodeToString(hash[:]))
                } else {
                        // Odd leaf — promote to next level
                        nextLevel = append(nextLevel, leaves[i])
                }
        }

        return pc.buildMerkleTree(nextLevel)
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
// MERKLE PROOF VERIFICATION
// ==========================================

// GenerateMerkleProof generates a Merkle proof for a given position.
// The proof allows an auditor to verify that a specific position is included
// in the Merkle root without revealing any other positions.
func (pc *PositionComputer) GenerateMerkleProof(positionID uint64) ([]string, error) {
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
        leaves := make([]string, 0)
        targetLeaf := pc.computeLeafHash(position)
        targetIndex := -1

        for _, p := range pc.positions {
                if p.Status == PositionStatusActive {
                        leaf := pc.computeLeafHash(p)
                        leaves = append(leaves, leaf)
                        if leaf == targetLeaf {
                                targetIndex = len(leaves) - 1
                        }
                }
        }

        if targetIndex == -1 {
                return nil, fmt.Errorf("target leaf not found in tree")
        }

        // Sort leaves for deterministic ordering (same as ComputeMerkleRoot)
        sort.Strings(leaves)

        // Find the target in the sorted list
        sortedIndex := -1
        for i, leaf := range leaves {
                if leaf == targetLeaf {
                        sortedIndex = i
                        break
                }
        }

        if sortedIndex == -1 {
                return nil, fmt.Errorf("target leaf not found in sorted tree")
        }

        // Generate the proof
        proof := pc.generateProof(leaves, sortedIndex)
        return proof, nil
}

// generateProof generates a Merkle proof for the leaf at the given index.
func (pc *PositionComputer) generateProof(leaves []string, index int) []string {
        if len(leaves) == 1 {
                return []string{}
        }

        proof := make([]string, 0)

        // Get the sibling
        var sibling string
        if index%2 == 0 {
                // Left child — sibling is right
                if index+1 < len(leaves) {
                        sibling = leaves[index+1]
                }
        } else {
                // Right child — sibling is left
                sibling = leaves[index-1]
        }

        if sibling != "" {
                proof = append(proof, sibling)
        }

        // Build the next level
        nextLevel := make([]string, 0)
        nextIndex := index / 2
        for i := 0; i < len(leaves); i += 2 {
                if i+1 < len(leaves) {
                        combined := leaves[i] + leaves[i+1]
                        hash := sha256.Sum256([]byte(combined))
                        nextLevel = append(nextLevel, hex.EncodeToString(hash[:]))
                } else {
                        nextLevel = append(nextLevel, leaves[i])
                }
        }

        // Recurse
        subProof := pc.generateProof(nextLevel, nextIndex)
        proof = append(proof, subProof...)

        return proof
}

// VerifyMerkleProof verifies that a given position is included in the Merkle root.
// This is the auditor-side verification function.
func (pc *PositionComputer) VerifyMerkleProof(leaf string, proof []string, root string) bool {
        current := leaf
        for _, sibling := range proof {
                combined := current + sibling
                hash := sha256.Sum256([]byte(combined))
                current = hex.EncodeToString(hash[:])
        }
        return current == root
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
