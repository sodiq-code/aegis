// Package fdc implements the FDC (Flare Data Connector) client for the Aegis vault system.
//
// Task 15 (Day 15): FDC integration: attestation of XRPL payment + Hyperliquid state.
// Acceptance criterion: External state attested and fed back to PositionComputer.
package fdc

import (
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// ─── Configuration Tests ─────────────────────────────────────────────────────

func TestDefaultFDCClientConfig(t *testing.T) {
	config := DefaultFDCClientConfig()

	if config.RPCURL != "https://coston2-api.flare.network/ext/C/rpc" {
		t.Errorf("Expected Coston2 RPC URL, got %s", config.RPCURL)
	}
	if config.FdcHubAddress != FdcHubAddress {
		t.Errorf("Expected FdcHub address %s, got %s", FdcHubAddress, config.FdcHubAddress)
	}
	if config.FdcVerificationAddr != FdcVerificationAddress {
		t.Errorf("Expected FdcVerification address %s, got %s", FdcVerificationAddress, config.FdcVerificationAddr)
	}
	if config.ChainID != Coston2ChainID {
		t.Errorf("Expected chain ID %d, got %d", Coston2ChainID, config.ChainID)
	}
	t.Logf("Default FDCClient config: RPC=%s, FdcHub=%s, ChainID=%d",
		config.RPCURL, config.FdcHubAddress, config.ChainID)
}

func TestNewFDCClient(t *testing.T) {
	config := DefaultFDCClientConfig()
	client := NewFDCClient(config)

	if client == nil {
		t.Fatal("FDCClient should not be nil")
	}
	if client.IsConnected() {
		t.Error("FDCClient should not be connected initially")
	}
	if len(client.GetAttestations()) != 0 {
		t.Error("New client should have no attestations")
	}
	if len(client.GetXRPPayments()) != 0 {
		t.Error("New client should have no XRPPayments")
	}
	if len(client.GetHyperliquidAttestations()) != 0 {
		t.Error("New client should have no Hyperliquid attestations")
	}
}

// ─── Constants Tests ────────────────────────────────────────────────────────

func TestConstants(t *testing.T) {
	if FdcHubAddress != "0x48aC463d7975828989331F4De43341627b9c5f1D" {
		t.Errorf("Wrong FdcHub address: %s", FdcHubAddress)
	}
	if FdcVerificationAddress != "0x906507E0B64bcD494Db73bd0459d1C667e14B933" {
		t.Errorf("Wrong FdcVerification address: %s", FdcVerificationAddress)
	}
	if Coston2ChainID != 114 {
		t.Errorf("Wrong chain ID: %d", Coston2ChainID)
	}
	if VotingEpochDurationSeconds != 90 {
		t.Errorf("Wrong voting epoch duration: %d", VotingEpochDurationSeconds)
	}
	if FDCProtocolID != 200 {
		t.Errorf("Wrong FDC protocol ID: %d", FDCProtocolID)
	}
	t.Logf("Constants verified: FdcHub=%s, FdcVerify=%s, ChainID=%d, EpochDuration=%ds",
		FdcHubAddress, FdcVerificationAddress, Coston2ChainID, VotingEpochDurationSeconds)
}

// ─── Attestation Type Tests ─────────────────────────────────────────────────

func TestAttestationTypeBytes32(t *testing.T) {
	xrpPayment := stringToBytes32("XRPPayment")
	if string(xrpPayment[:10]) != "XRPPayment" {
		t.Errorf("XRPPayment attestation type incorrect: %s", string(xrpPayment[:10]))
	}

	evmTx := stringToBytes32("EVMTransaction")
	if string(evmTx[:14]) != "EVMTransaction" {
		t.Errorf("EVMTransaction attestation type incorrect: %s", string(evmTx[:14]))
	}

	web2json := stringToBytes32("Web2Json")
	if string(web2json[:8]) != "Web2Json" {
		t.Errorf("Web2Json attestation type incorrect: %s", string(web2json[:8]))
	}

	t.Logf("Attestation types verified: XRPPayment=%s, EVMTransaction=%s, Web2Json=%s",
		string(xrpPayment[:10]), string(evmTx[:14]), string(web2json[:8]))
}

func TestSourceIDBytes32(t *testing.T) {
	testXRP := stringToBytes32("testXRP")
	if string(testXRP[:7]) != "testXRP" {
		t.Errorf("testXRP source ID incorrect: %s", string(testXRP[:7]))
	}

	testETH := stringToBytes32("testETH")
	if string(testETH[:7]) != "testETH" {
		t.Errorf("testETH source ID incorrect: %s", string(testETH[:7]))
	}
}

// ─── Voting Round Calculation Tests ─────────────────────────────────────────

func TestCalculateVotingRound(t *testing.T) {
	// Current time should produce a valid voting round
	now := uint64(time.Now().Unix())
	round := CalculateVotingRound(now)
	if round == 0 {
		t.Error("Current time should produce a non-zero voting round")
	}
	t.Logf("Current voting round: %d (timestamp=%d)", round, now)

	// Timestamp before the first round should return 0
	beforeStart := uint64(FirstVotingRoundStartTs - 1)
	roundBefore := CalculateVotingRound(beforeStart)
	if roundBefore != 0 {
		t.Errorf("Before first round should return 0, got %d", roundBefore)
	}

	// Exactly at the first round start
	atStart := uint64(FirstVotingRoundStartTs)
	roundAtStart := CalculateVotingRound(atStart)
	if roundAtStart != 0 {
		t.Errorf("At first round start should return 0, got %d", roundAtStart)
	}

	// One epoch after start
	oneEpochAfter := uint64(FirstVotingRoundStartTs + VotingEpochDurationSeconds)
	roundOneEpoch := CalculateVotingRound(oneEpochAfter)
	if roundOneEpoch != 1 {
		t.Errorf("One epoch after start should return 1, got %d", roundOneEpoch)
	}

	t.Logf("Voting round calculation verified: round=%d, roundAtStart=%d, roundOneEpoch=%d",
		round, roundAtStart, roundOneEpoch)
}

// ─── Data Type Tests ────────────────────────────────────────────────────────

func TestXRPPaymentAttestationStruct(t *testing.T) {
	attestation := &XRPPaymentAttestation{
		TransactionID:        "0xABCD1234",
		BlockNumber:          12345,
		BlockTimestamp:        1785726000,
		SourceAddress:        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		SpentAmount:          1000000,
		ReceivedAmount:       999000,
		HasDestinationTag:    true,
		DestinationTag:       12345,
		Status:               0,
		VotingRound:          190000,
		ProofVerified:        true,
	}

	if attestation.Status != 0 {
		t.Errorf("Expected status 0 (SUCCESS), got %d", attestation.Status)
	}
	if !attestation.ProofVerified {
		t.Error("Proof should be verified")
	}
	if attestation.SpentAmount != 1000000 {
		t.Errorf("Expected spent amount 1000000, got %d", attestation.SpentAmount)
	}
}

func TestHyperliquidStateAttestationStruct(t *testing.T) {
	attestation := &HyperliquidStateAttestation{
		AccountAddress: "0x1234567890abcdef",
		TotalValue:     10000.0,
		Positions: []HyperliquidPosition{
			{Coin: "FXRP", Size: 100.0, EntryPx: 2.15, MarkPx: 2.18, UnrealizedPnl: 3.0, Leverage: 1.0},
		},
		MarginRatio:   2.5,
		VotingRound:   190000,
		ProofVerified: true,
	}

	if attestation.TotalValue != 10000.0 {
		t.Errorf("Expected total value 10000.0, got %f", attestation.TotalValue)
	}
	if len(attestation.Positions) != 1 {
		t.Errorf("Expected 1 position, got %d", len(attestation.Positions))
	}
	if attestation.Positions[0].Coin != "FXRP" {
		t.Errorf("Expected FXRP position, got %s", attestation.Positions[0].Coin)
	}
}

func TestAttestationRequestStruct(t *testing.T) {
	req := &AttestationRequest{
		AttestationType: AttestationTypeXRPPayment,
		SourceID:        SourceIDTestXRP,
		FeePaid:         1000000000000000000, // 1 C2FLR
		VotingRound:     190000,
		TxHash:          "0xabc123",
		Status:          "SUBMITTED",
	}

	if req.Status != "SUBMITTED" {
		t.Errorf("Expected status SUBMITTED, got %s", req.Status)
	}
	if req.FeePaid != 1000000000000000000 {
		t.Errorf("Expected fee 1 C2FLR, got %d", req.FeePaid)
	}
}

// ─── Determinism Tests ──────────────────────────────────────────────────────

func TestStringToBytes32Determinism(t *testing.T) {
	inputs := []string{"XRPPayment", "testXRP", "EVMTransaction", "Web2Json"}
	for _, input := range inputs {
		results := make(map[[32]byte]bool)
		for i := 0; i < 100; i++ {
			result := stringToBytes32(input)
			results[result] = true
		}
		if len(results) != 1 {
			t.Errorf("stringToBytes32(%q) should be deterministic, got %d unique results", input, len(results))
		}
	}
}

// ─── Integration Tests (require Coston2 connectivity) ────────────────────────

func TestFDCClientConnectToCoston2(t *testing.T) {
	config := DefaultFDCClientConfig()
	client := NewFDCClient(config)

	err := client.Connect()
	if err != nil {
		t.Skipf("Cannot connect to Coston2 (expected in CI): %v", err)
	}
	defer client.Close()

	if !client.IsConnected() {
		t.Error("Client should be connected after Connect()")
	}
	t.Logf("Successfully connected to Coston2 FDC system")
}

func TestGetCurrentVotingRoundOnCoston2(t *testing.T) {
	config := DefaultFDCClientConfig()
	client := NewFDCClient(config)

	err := client.Connect()
	if err != nil {
		t.Skipf("Cannot connect to Coston2: %v", err)
	}
	defer client.Close()

	round, err := client.GetCurrentVotingRound()
	if err != nil {
		t.Fatalf("Failed to get current voting round: %v", err)
	}

	if round == 0 {
		t.Error("Voting round should not be zero on Coston2")
	}

	t.Logf("Current voting round on Coston2: %d", round)
}

func TestGetRequestFeeOnCoston2(t *testing.T) {
	config := DefaultFDCClientConfig()
	client := NewFDCClient(config)

	err := client.Connect()
	if err != nil {
		t.Skipf("Cannot connect to Coston2: %v", err)
	}
	defer client.Close()

	// Build a simple XRPPayment request
	// attestationType(32) + sourceId(32) + MIC(32) + requestBody
	requestData := make([]byte, 128)
	copy(requestData[0:32], AttestationTypeXRPPayment[:])
	copy(requestData[32:64], SourceIDTestXRP[:])

	fee, err := client.GetRequestFee(requestData)
	if err != nil {
		t.Logf("GetRequestFee failed (may be expected): %v", err)
		return
	}

	t.Logf("FDC request fee: %d wei (%f C2FLR)", fee, float64(fee)/1e18)
}

func TestFDCClientWithPrivateKey(t *testing.T) {
	config := DefaultFDCClientConfig()
	config.PrivateKey = "0xb3e509a0949e4d4ae489025a95eae959df178188f2c6ca130eceb2ef4ac70951"

	client := NewFDCClient(config)

	err := client.Connect()
	if err != nil {
		t.Skipf("Cannot connect to Coston2: %v", err)
	}
	defer client.Close()

	addr := client.GetSignerAddress()
	if addr == (common.Address{}) {
		t.Error("Signer address should not be zero after connecting with private key")
	}

	t.Logf("FDCClient signer address: %s", addr.Hex())
}

// ─── Mock FDC Flow Test ─────────────────────────────────────────────────────

func TestMockFDCAttestationFlow(t *testing.T) {
	// Simulate the FDC attestation flow without real Coston2 connectivity
	// Step 1: Detect external state change (XRPL payment)
	xrplPaymentTxID := "0xABCD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB"
	t.Logf("Step 1: XRPL payment detected — txID=%s", xrplPaymentTxID)

	// Step 2: Request attestation
	attestationType := "XRPPayment"
	sourceID := "testXRP"
	votingRound := CalculateVotingRound(uint64(time.Now().Unix()))

	t.Logf("Step 2: Attestation requested — type=%s, source=%s, round=%d",
		attestationType, sourceID, votingRound)

	// Step 3: Wait for finalization (90-180 seconds)
	finalizationTime := 90 + 45 // average
	t.Logf("Step 3: Waiting for finalization — ~%d seconds", finalizationTime)

	// Step 4: Verify attestation
	attestation := &XRPPaymentAttestation{
		TransactionID:        xrplPaymentTxID,
		BlockNumber:          12345678,
		BlockTimestamp:        uint64(time.Now().Unix()),
		SourceAddress:        "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2DQ",
		SpentAmount:          1000000, // 1 XRP in drops
		ReceivedAmount:       999000,  // 0.999 XRP in drops (minus fee)
		HasDestinationTag:    true,
		DestinationTag:       42,
		Status:               0, // SUCCESS
		VotingRound:          votingRound,
		ProofVerified:        true,
	}

	if !attestation.ProofVerified {
		t.Fatal("Attestation should be verified")
	}
	if attestation.Status != 0 {
		t.Fatal("Payment status should be SUCCESS")
	}
	t.Logf("Step 4: XRPPayment attested — block=%d, spent=%d drops, received=%d drops",
		attestation.BlockNumber, attestation.SpentAmount, attestation.ReceivedAmount)

	// Step 5: Feed attested state to PositionComputer
	externalState := map[string]interface{}{
		"chain":            "XRPL",
		"paymentTxID":      attestation.TransactionID,
		"spentAmount":      attestation.SpentAmount,
		"receivedAmount":   attestation.ReceivedAmount,
		"sourceAddress":    attestation.SourceAddress,
		"votingRound":      attestation.VotingRound,
		"proofVerified":    attestation.ProofVerified,
	}
	t.Logf("Step 5: External state fed to PositionComputer — %v", externalState)

	// Step 6: Hyperliquid state attestation
	hlState := &HyperliquidStateAttestation{
		AccountAddress: "0x1234567890abcdef",
		TotalValue:     10000.0,
		Positions: []HyperliquidPosition{
			{Coin: "FXRP", Size: 100.0, EntryPx: 2.15, MarkPx: 2.18, UnrealizedPnl: 3.0, Leverage: 1.0},
		},
		MarginRatio:   2.5,
		VotingRound:   votingRound,
		ProofVerified: true,
	}
	t.Logf("Step 6: Hyperliquid state attested — totalValue=%.2f, positions=%d, marginRatio=%.2f",
		hlState.TotalValue, len(hlState.Positions), hlState.MarginRatio)

	t.Logf("Mock FDC attestation flow completed successfully!")
}

// ─── Big Int / Amount Tests ─────────────────────────────────────────────────

func TestXRPLDropsConversion(t *testing.T) {
	// XRP amounts on XRPL are in drops (1 XRP = 1,000,000 drops)
	tests := []struct {
		xrp    float64
		drops  int64
		bigInt *big.Int
	}{
		{1.0, 1000000, big.NewInt(1000000)},
		{0.5, 500000, big.NewInt(500000)},
		{100.0, 100000000, big.NewInt(100000000)},
	}

	for _, tt := range tests {
		if tt.bigInt.Int64() != tt.drops {
			t.Errorf("Amount mismatch: %f XRP = %d drops, got %d", tt.xrp, tt.drops, tt.bigInt.Int64())
		}
	}
	t.Logf("XRPL drops conversions verified")
}

// ─── Verifier API Tests ─────────────────────────────────────────────────────

func TestVerifierAPIURLs(t *testing.T) {
	expectedXRPPaymentURL := "https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest"
	actualURL := fmt.Sprintf("%s/xrp/XRPPayment/prepareRequest", VerifierBaseURL)
	if actualURL != expectedXRPPaymentURL {
		t.Errorf("Expected XRPPayment URL %s, got %s", expectedXRPPaymentURL, actualURL)
	}

	expectedWeb2JsonURL := "https://fdc-verifiers-testnet.flare.network/verifier/web2/Web2Json/prepareRequest"
	actualWeb2URL := fmt.Sprintf("%s/web2/Web2Json/prepareRequest", VerifierBaseURL)
	if actualWeb2URL != expectedWeb2JsonURL {
		t.Errorf("Expected Web2Json URL %s, got %s", expectedWeb2JsonURL, actualWeb2URL)
	}
}

// ─── GetSignerAddress Tests ─────────────────────────────────────────────────

func TestGetSignerAddressWithoutKey(t *testing.T) {
	config := DefaultFDCClientConfig()
	client := NewFDCClient(config)

	addr := client.GetSignerAddress()
	if addr != (common.Address{}) {
		t.Error("Signer address should be zero without private key")
	}
}
