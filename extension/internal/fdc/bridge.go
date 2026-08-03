// Package fdc implements the FDC (Flare Data Connector) client for the Aegis vault system.
//
// Task 15 (Day 15): FDC integration: attestation of XRPL payment + Hyperliquid state.
// Acceptance criterion: External state attested and fed back to PositionComputer.
//
// The FDCPositionBridge is the critical integration component that:
//   1. Takes attested XRPL payment data from the FDCClient
//   2. Converts it to PositionComputer's ExternalState format
//   3. Feeds it into the PositionComputer's UpdateExternalState method
//   4. Takes attested Hyperliquid state from the FDCClient
//   5. Converts it to PositionComputer's ExternalState format
//   6. Feeds it into the PositionComputer's UpdateExternalState method
//
// This is the "FDC attestation responses → PositionComputer (TEE)" data flow
// described in the report's Section 9.4.3.
package fdc

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"

	position "extension-scaffold/internal/position"
)

// FDCPositionBridgeConfig holds the configuration for the bridge.
type FDCPositionBridgeConfig struct {
	FDCClientConfig          FDCClientConfig
	PositionComputerConfig   position.PositionComputerConfig
	AutoAttestIntervalSec    int  `json:"autoAttestIntervalSec"`  // How often to auto-attest (0 = disabled)
	AttestXRPLPayments       bool `json:"attestXRPLPayments"`     // Whether to attest XRPL payments
	AttestHyperliquidState   bool `json:"attestHyperliquidState"` // Whether to attest Hyperliquid state
	HyperliquidAccount       string `json:"hyperliquidAccount"`     // Hyperliquid account to attest
}

// DefaultFDCPositionBridgeConfig returns the default configuration for Coston2.
func DefaultFDCPositionBridgeConfig() FDCPositionBridgeConfig {
	return FDCPositionBridgeConfig{
		FDCClientConfig:          DefaultFDCClientConfig(),
		PositionComputerConfig:   position.DefaultPositionComputerConfig(),
		AutoAttestIntervalSec:    0, // Disabled by default
		AttestXRPLPayments:       true,
		AttestHyperliquidState:   true,
		HyperliquidAccount:       "",
	}
}

// FDCPositionBridge wires FDC-attested external state to the PositionComputer.
//
// Per the report's Section 9.4.3 (Data flow diagram):
//
//	Inbound data flows: (2) FDC attestation responses → PositionComputer (TEE)
//
// This is the integration point that makes the FDC attestation data flow
// into the PositionComputer's state model. Without this bridge, the FDC
// attestation data would be verified but not used in the vault state.
//
// The bridge converts:
//   - XRPPaymentAttestation → position.ExternalState (chain=XRPL)
//   - HyperliquidStateAttestation → position.ExternalState (chain=HYPERLIQUID)
type FDCPositionBridge struct {
	config     FDCPositionBridgeConfig
	fdcClient  *FDCClient
	position   *position.PositionComputer
	mu         chan struct{} // Used as a semaphore for concurrent access
	connected  bool
}

// NewFDCPositionBridge creates a new FDCPositionBridge.
func NewFDCPositionBridge(config FDCPositionBridgeConfig, fdcClient *FDCClient, posComputer *position.PositionComputer) *FDCPositionBridge {
	return &FDCPositionBridge{
		config:    config,
		fdcClient: fdcClient,
		position:  posComputer,
		mu:        make(chan struct{}, 1),
	}
}

// Connect establishes the connection to Coston2 and initializes the bridge.
func (b *FDCPositionBridge) Connect() error {
	if b.fdcClient == nil {
		return fmt.Errorf("FDC client is nil")
	}
	if b.position == nil {
		return fmt.Errorf("PositionComputer is nil")
	}
	if !b.fdcClient.IsConnected() {
		if err := b.fdcClient.Connect(); err != nil {
			return fmt.Errorf("failed to connect FDC client: %w", err)
		}
	}
	b.connected = true
	logger.Infof("[FDCPositionBridge] Connected: FDCClient=%v, PositionComputer=%v",
		b.fdcClient.IsConnected(), b.position != nil)
	return nil
}

// IsConnected returns whether the bridge is connected.
func (b *FDCPositionBridge) IsConnected() bool {
	return b.connected
}

// ─── XRPL Payment → PositionComputer ────────────────────────────────────────

// AttestAndFeedXRPLPayment performs the full XRPL payment attestation flow
// and feeds the result into the PositionComputer.
//
// This is the primary integration method for Task 15:
//   1. Request XRPPayment attestation via FDC
//   2. Convert attested data to PositionComputer's ExternalState
//   3. Feed ExternalState into PositionComputer
//
// Per the report's Section 9.4.1:
//
//	FDC Attestations: XRPPayment (XRPL transfers settled)
func (b *FDCPositionBridge) AttestAndFeedXRPLPayment(ctx context.Context, transactionID string) (*position.ExternalState, error) {
	if !b.connected {
		return nil, fmt.Errorf("bridge not connected")
	}

	// Step 1: Request attestation
	attestation, err := b.fdcClient.RequestXRPPaymentAttestation(transactionID)
	if err != nil {
		return nil, fmt.Errorf("XRPPayment attestation failed: %w", err)
	}

	// Step 2: Convert to PositionComputer's ExternalState
	externalState := b.convertXRPPaymentToExternalState(attestation)

	// Step 3: Feed into PositionComputer
	if err := b.position.UpdateExternalState(externalState); err != nil {
		return nil, fmt.Errorf("failed to feed XRPL state to PositionComputer: %w", err)
	}

	logger.Infof("[FDCPositionBridge] XRPL payment attested and fed to PositionComputer: txID=%s, round=%d, verified=%v",
		transactionID, attestation.VotingRound, externalState.IsVerified)

	return externalState, nil
}

// AttestAndFeedXRPLPaymentFull performs the full attestation flow with proof waiting
// and feeds the result into the PositionComputer.
func (b *FDCPositionBridge) AttestAndFeedXRPLPaymentFull(ctx context.Context, transactionID string) (*position.ExternalState, error) {
	if !b.connected {
		return nil, fmt.Errorf("bridge not connected")
	}

	// Full flow with proof verification
	attestation, err := b.fdcClient.FullXRPPaymentAttestationFlow(ctx, transactionID)
	if err != nil {
		// Even if the full flow fails, we may have partial data
		logger.Warnf("[FDCPositionBridge] Full XRPPayment flow had issues: %v", err)
		if attestation == nil {
			return nil, fmt.Errorf("XRPPayment attestation failed: %w", err)
		}
	}

	// Convert and feed
	externalState := b.convertXRPPaymentToExternalStateFull(attestation)
	if err := b.position.UpdateExternalState(externalState); err != nil {
		return nil, fmt.Errorf("failed to feed XRPL state to PositionComputer: %w", err)
	}

	logger.Infof("[FDCPositionBridge] Full XRPL payment attested and fed: txID=%s, verified=%v, round=%d",
		transactionID, externalState.IsVerified, externalState.VotingRound)

	return externalState, nil
}

// ─── Hyperliquid State → PositionComputer ────────────────────────────────────

// AttestAndFeedHyperliquidState performs the Hyperliquid state attestation flow
// and feeds the result into the PositionComputer.
//
// Per the report's Section 9.4.1:
//
//	PMW Layer controls wallets on Hyperliquid (open/close hedges)
func (b *FDCPositionBridge) AttestAndFeedHyperliquidState(ctx context.Context, accountAddress string) (*position.ExternalState, error) {
	if !b.connected {
		return nil, fmt.Errorf("bridge not connected")
	}

	// Step 1: Request attestation
	hlState, err := b.fdcClient.RequestHyperliquidStateAttestation(accountAddress)
	if err != nil {
		return nil, fmt.Errorf("Hyperliquid state attestation failed: %w", err)
	}

	// Step 2: Convert to PositionComputer's ExternalState
	externalState := b.convertHyperliquidToExternalState(hlState)

	// Step 3: Feed into PositionComputer
	if err := b.position.UpdateExternalState(externalState); err != nil {
		return nil, fmt.Errorf("failed to feed Hyperliquid state to PositionComputer: %w", err)
	}

	logger.Infof("[FDCPositionBridge] Hyperliquid state attested and fed to PositionComputer: account=%s, totalValue=%.2f, verified=%v",
		accountAddress, hlState.TotalValue, externalState.IsVerified)

	return externalState, nil
}

// AttestAndFeedHyperliquidStateFull performs the full Hyperliquid state attestation flow
// with proof waiting and feeds the result into the PositionComputer.
func (b *FDCPositionBridge) AttestAndFeedHyperliquidStateFull(ctx context.Context, accountAddress string) (*position.ExternalState, error) {
	if !b.connected {
		return nil, fmt.Errorf("bridge not connected")
	}

	// Full flow with proof verification
	hlState, err := b.fdcClient.FullHyperliquidStateAttestationFlow(ctx, accountAddress)
	if err != nil {
		logger.Warnf("[FDCPositionBridge] Full Hyperliquid flow had issues: %v", err)
		if hlState == nil {
			return nil, fmt.Errorf("Hyperliquid state attestation failed: %w", err)
		}
	}

	// Convert and feed
	externalState := b.convertHyperliquidToExternalState(hlState)
	if err := b.position.UpdateExternalState(externalState); err != nil {
		return nil, fmt.Errorf("failed to feed Hyperliquid state to PositionComputer: %w", err)
	}

	logger.Infof("[FDCPositionBridge] Full Hyperliquid state attested and fed: account=%s, totalValue=%.2f, verified=%v",
		accountAddress, hlState.TotalValue, externalState.IsVerified)

	return externalState, nil
}

// ─── Combined Attestation ────────────────────────────────────────────────────

// AttestAllExternalState attests all external state sources and feeds them to the PositionComputer.
// This is useful for periodic state updates.
func (b *FDCPositionBridge) AttestAllExternalState(ctx context.Context, xrplTransactionID string, hyperliquidAccount string) (map[position.ExternalChain]*position.ExternalState, error) {
	results := make(map[position.ExternalChain]*position.ExternalState)

	// Attest XRPL payment if configured
	if b.config.AttestXRPLPayments && xrplTransactionID != "" {
		xrplState, err := b.AttestAndFeedXRPLPayment(ctx, xrplTransactionID)
		if err != nil {
			logger.Warnf("[FDCPositionBridge] XRPL attestation failed: %v", err)
		} else {
			results[position.ExternalChainXRPL] = xrplState
		}
	}

	// Attest Hyperliquid state if configured
	if b.config.AttestHyperliquidState && hyperliquidAccount != "" {
		hlState, err := b.AttestAndFeedHyperliquidState(ctx, hyperliquidAccount)
		if err != nil {
			logger.Warnf("[FDCPositionBridge] Hyperliquid attestation failed: %v", err)
		} else {
			results[position.ExternalChainHyperliquid] = hlState
		}
	}

	return results, nil
}

// ─── Conversion Methods ─────────────────────────────────────────────────────

// convertXRPPaymentToExternalState converts an XRPPayment attestation request to PositionComputer's ExternalState.
func (b *FDCPositionBridge) convertXRPPaymentToExternalState(attestation *AttestationRequest) *position.ExternalState {
	return &position.ExternalState{
		Chain:        position.ExternalChainXRPL,
		Address:      "", // Not available from the request alone
		Balance:      attestation.FeePaid, // Placeholder — actual balance from proof
		AttestedAt:   time.Now(),
		VotingRound:  attestation.VotingRound,
		AttestationID: attestation.TxHash,
		IsVerified:   attestation.Status == "SUBMITTED",
	}
}

// convertXRPPaymentToExternalStateFull converts a full XRPPayment attestation to ExternalState.
func (b *FDCPositionBridge) convertXRPPaymentToExternalStateFull(attestation *XRPPaymentAttestation) *position.ExternalState {
	// Convert XRPL drops to UBA (6 decimals, matching FXRP)
	// XRPL drops: 1 XRP = 1,000,000 drops
	// FXRP UBA: 1 FXRP = 1,000,000 (6 decimals)
	// So 1 drop = 1 UBA (they're the same scale)
	balance := uint64(0)
	if attestation.ReceivedAmount > 0 {
		balance = uint64(attestation.ReceivedAmount)
	} else if attestation.SpentAmount > 0 {
		balance = uint64(attestation.SpentAmount)
	}

	return &position.ExternalState{
		Chain:         position.ExternalChainXRPL,
		Address:       attestation.SourceAddress,
		Balance:       balance,
		AttestedAt:    time.Now(),
		VotingRound:   attestation.VotingRound,
		AttestationID: attestation.TransactionID,
		IsVerified:    attestation.ProofVerified,
	}
}

// convertHyperliquidToExternalState converts a Hyperliquid state attestation to ExternalState.
func (b *FDCPositionBridge) convertHyperliquidToExternalState(hlState *HyperliquidStateAttestation) *position.ExternalState {
	// Convert Hyperliquid USD value to UBA (6 decimals)
	// Hyperliquid reports values in USD, so we convert to cents then to UBA
	// TotalValue is in USD, we need to convert to the 6-decimal UBA format
	// For FXRP: 1 FXRP ≈ $2.18, so 10000 USD ≈ 4587 FXRP ≈ 4,587,000,000 UBA
	// We store the total value in cents (2 decimals) * 10000 to get UBA-like precision
	balance := uint64(0)
	if hlState.TotalValue > 0 {
		// Convert USD to cents, then scale to UBA (6 decimals)
		// TotalValue in USD → cents * 10000 = UBA
		balance = uint64(hlState.TotalValue * 100 * 10000) // USD → cents → UBA-like
		if balance > math.MaxUint64/2 {
			balance = math.MaxUint64 / 2 // Safety cap
		}
	}

	return &position.ExternalState{
		Chain:         position.ExternalChainHyperliquid,
		Address:       hlState.AccountAddress,
		Balance:       balance,
		AttestedAt:    time.Now(),
		VotingRound:   hlState.VotingRound,
		AttestationID: fmt.Sprintf("hl_%s_%d", hlState.AccountAddress, hlState.VotingRound),
		IsVerified:    hlState.ProofVerified,
	}
}

// ─── Query Methods ──────────────────────────────────────────────────────────

// GetPositionComputer returns the PositionComputer instance.
func (b *FDCPositionBridge) GetPositionComputer() *position.PositionComputer {
	return b.position
}

// GetFDCClient returns the FDCClient instance.
func (b *FDCPositionBridge) GetFDCClient() *FDCClient {
	return b.fdcClient
}

// GetVaultState returns the current vault state from the PositionComputer.
func (b *FDCPositionBridge) GetVaultState() *position.VaultState {
	return b.position.GetVaultState()
}

// GetExternalState returns the external state for a given chain.
func (b *FDCPositionBridge) GetExternalState(chain position.ExternalChain) (*position.ExternalState, error) {
	return b.position.GetExternalState(chain)
}
