package attester

// FDCAttestor handles FDC attestation requests and verification for the Aegis extension.
// This is part of Layer 5 (Verification & Audit) of the Aegis architecture.
//
// The FDCAttestor is used by the PositionComputer to:
//   - Verify XRPL payment attestations via FDC
//   - Verify EVM transaction attestations via FDC
//   - Verify address validity attestations via FDC
//   - Feed verified external state back into the position computation
//
// FDC Attestation Flow:
//   1. Prepare attestation request (attestationType, sourceId, requestBody)
//   2. Submit request to FDC verifier (off-chain) to get abiEncodedRequest
//   3. Submit abiEncodedRequest to FdcHub on-chain (with fee)
//   4. Wait for voting round to finalize (~180 seconds)
//   5. Retrieve proof from DA Layer (off-chain)
//   6. Verify proof on-chain via FdcVerification contract
//
// Key FDC concepts:
//   - AttestationType: "Payment", "EVMTransaction", "AddressValidity"
//   - SourceId: "testXRP" (Coston2 XRPL), "testETH" (Coston2 EVM)
//   - VotingRound: The round in which the attestation is processed
//   - MerkleProof: The proof that the attestation is included in the Merkle tree

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

// FDCConfig holds the configuration for the FDC attestation system.
type FDCConfig struct {
	VerifierURL       string `json:"verifierUrl"`       // FDC verifier API URL
	DALayerURL        string `json:"daLayerUrl"`        // DA Layer API URL
	VerifierAPIKey    string `json:"verifierApiKey"`    // API key for the verifier
	FdcHubAddress     string `json:"fdcHubAddress"`     // FdcHub contract address
	FdcVerificationAddress string `json:"fdcVerificationAddress"` // FdcVerification contract address
	FlareSystemsManagerAddress string `json:"flareSystemsManagerAddress"` // FlareSystemsManager contract address
	FdcRequestFeeConfigsAddress string `json:"fdcRequestFeeConfigsAddress"` // FdcRequestFeeConfigs contract address
	RPCURL            string `json:"rpcUrl"`            // Coston2 RPC URL
}

// DefaultFDCConfig returns the default FDC configuration for Coston2.
func DefaultFDCConfig() FDCConfig {
	return FDCConfig{
		VerifierURL:                 "https://fdc-verifiers-testnet.flare.network",
		DALayerURL:                  "https://daq-testnet.flare.network",
		VerifierAPIKey:              "",
		FdcHubAddress:               "0x48aC463d7975828989331F4De43341627b9c5f1D",
		FdcVerificationAddress:      "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
		FlareSystemsManagerAddress:  "0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52",
		FdcRequestFeeConfigsAddress: "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e",
		RPCURL:                      "https://coston2-api.flare.network/ext/C/rpc",
	}
}

// AttestationType represents the type of FDC attestation.
type AttestationType string

const (
	AttestationTypePayment       AttestationType = "Payment"
	AttestationTypeEVMTransaction AttestationType = "EVMTransaction"
	AttestationTypeAddressValidity AttestationType = "AddressValidity"
)

// SourceID represents the data source for an attestation.
type SourceID string

const (
	SourceIDTestXRP SourceID = "testXRP"
	SourceIDTestETH SourceID = "testETH"
)

// PaymentRequest represents a Payment attestation request body.
type PaymentRequest struct {
	TransactionID string `json:"transactionId"`
	InUtxo        string `json:"inUtxo"`
	Utxo          string `json:"utxo"`
}

// PaymentResponse represents a Payment attestation response body.
type PaymentResponse struct {
	BlockNumber              uint64 `json:"blockNumber"`
	BlockTimestamp           uint64 `json:"blockTimestamp"`
	SourceAddressHash        string `json:"sourceAddressHash"`
	ReceivingAddressHash     string `json:"receivingAddressHash"`
	SpentAmount              uint64 `json:"spentAmount"`
	ReceivedAmount           uint64 `json:"receivedAmount"`
	StandardPaymentReference string `json:"standardPaymentReference"`
	OneToOne                 bool   `json:"oneToOne"`
}

// VerifierRequest is the request sent to the FDC verifier.
type VerifierRequest struct {
	AttestationType string          `json:"attestationType"`
	SourceID        string          `json:"sourceId"`
	RequestBody     PaymentRequest  `json:"requestBody"`
}

// VerifierResponse is the response from the FDC verifier.
type VerifierResponse struct {
	Status             string `json:"status"`
	AbiEncodedRequest  string `json:"abiEncodedRequest,omitempty"`
	MessageIntegrityCode string `json:"messageIntegrityCode,omitempty"`
}

// AttestationResult represents a verified attestation result.
type AttestationResult struct {
	AttestationType AttestationType  `json:"attestationType"`
	SourceID        SourceID         `json:"sourceId"`
	VotingRound     uint64           `json:"votingRound"`
	Payment         *PaymentResponse `json:"payment,omitempty"`
	Verified        bool             `json:"verified"`
	VerifiedAt      time.Time        `json:"verifiedAt"`
}

// FDCAttestor handles FDC attestation requests and verification.
type FDCAttestor struct {
	config     FDCConfig
	httpClient *http.Client
	attestations map[string]*AttestationResult // keyed by transaction ID
}

// NewFDCAttestor creates a new FDCAttestor with the given configuration.
func NewFDCAttestor(config FDCConfig) *FDCAttestor {
	return &FDCAttestor{
		config:     config,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		attestations: make(map[string]*AttestationResult),
	}
}

// toHexPadded converts a string to a 32-byte hex string, zero-padded.
func toHexPadded(s string) string {
	hexStr := hex.EncodeToString([]byte(s))
	for len(hexStr) < 64 {
		hexStr += "0"
	}
	return "0x" + hexStr
}

// PreparePaymentRequest prepares a Payment attestation request for an XRPL transaction.
func (fa *FDCAttestor) PreparePaymentRequest(transactionID string, sourceID SourceID) (*VerifierRequest, error) {
	if transactionID == "" {
		return nil, fmt.Errorf("transaction ID is required")
	}

	request := &VerifierRequest{
		AttestationType: toHexPadded(string(AttestationTypePayment)),
		SourceID:        toHexPadded(string(sourceID)),
		RequestBody: PaymentRequest{
			TransactionID: transactionID,
			InUtxo:        "0",
			Utxo:          "0",
		},
	}

	logger.Infof("Prepared Payment attestation request: txID=%s, source=%s", transactionID, sourceID)
	return request, nil
}

// SubmitToVerifier submits the attestation request to the FDC verifier.
func (fa *FDCAttestor) SubmitToVerifier(request *VerifierRequest, attestationType AttestationType, sourceID SourceID) (*VerifierResponse, error) {
	// Build the URL: {verifier_url}/verifier/{sourceId}/{attestationType}/prepareRequest
	sourceIDStr := strings.ToLower(strings.TrimPrefix(string(sourceID), "test"))
	url := fmt.Sprintf("%s/verifier/%s/%s/prepareRequest", fa.config.VerifierURL, sourceIDStr, string(attestationType))

	body, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if fa.config.VerifierAPIKey != "" {
		req.Header.Set("X-API-KEY", fa.config.VerifierAPIKey)
	}

	resp, err := fa.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request to verifier: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read verifier response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		logger.Warnf("FDC verifier requires API key (401 Unauthorized)")
		return &VerifierResponse{Status: "unauthorized"}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("verifier returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Status   string `json:"status"`
		Response struct {
			AbiEncodedRequest  string `json:"abiEncodedRequest"`
			MessageIntegrityCode string `json:"messageIntegrityCode"`
		} `json:"response"`
	}

	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse verifier response: %w", err)
	}

	logger.Infof("Verifier response: status=%s, abiEncodedRequest=%s...", result.Status, truncate(result.Response.AbiEncodedRequest, 20))

	return &VerifierResponse{
		Status:             result.Status,
		AbiEncodedRequest:  result.Response.AbiEncodedRequest,
		MessageIntegrityCode: result.Response.MessageIntegrityCode,
	}, nil
}

// RequestPaymentAttestation performs the full Payment attestation flow:
// prepare request -> submit to verifier -> (on-chain submission deferred to Task 8)
func (fa *FDCAttestor) RequestPaymentAttestation(transactionID string, sourceID SourceID) (*AttestationResult, error) {
	// Step 1: Prepare the request
	request, err := fa.PreparePaymentRequest(transactionID, sourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare request: %w", err)
	}

	// Step 2: Submit to verifier
	verifierResp, err := fa.SubmitToVerifier(request, AttestationTypePayment, sourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to submit to verifier: %w", err)
	}

	// Step 3: Create the attestation result
	// Note: The on-chain submission (FdcHub.requestAttestation) and proof retrieval
	// will be implemented when the FCC extension is registered (Task 8).
	result := &AttestationResult{
		AttestationType: AttestationTypePayment,
		SourceID:        sourceID,
		Verified:        verifierResp.Status == "VALID",
		VerifiedAt:      time.Now(),
	}

	// Store the result
	fa.attestations[transactionID] = result

	logger.Infof("Payment attestation result: txID=%s, verified=%v, status=%s",
		transactionID, result.Verified, verifierResp.Status)

	return result, nil
}

// GetAttestation returns a stored attestation result by transaction ID.
func (fa *FDCAttestor) GetAttestation(transactionID string) (*AttestationResult, error) {
	result, exists := fa.attestations[transactionID]
	if !exists {
		return nil, fmt.Errorf("attestation not found for transaction: %s", transactionID)
	}
	return result, nil
}

// ValidateFDC validates that the FDC system is available and configured correctly.
func (fa *FDCAttestor) ValidateFDC() error {
	if fa.config.FdcHubAddress == "" {
		return fmt.Errorf("FdcHub address not configured")
	}
	if fa.config.FdcVerificationAddress == "" {
		return fmt.Errorf("FdcVerification address not configured")
	}
	if fa.config.FlareSystemsManagerAddress == "" {
		return fmt.Errorf("FlareSystemsManager address not configured")
	}
	if fa.config.RPCURL == "" {
		return fmt.Errorf("RPC URL not configured")
	}

	logger.Infof("FDC validation passed: FdcHub=%s, FdcVerification=%s, Verifier=%s",
		fa.config.FdcHubAddress, fa.config.FdcVerificationAddress, fa.config.VerifierURL)

	return nil
}

// ListAttestations returns all stored attestation results.
func (fa *FDCAttestor) ListAttestations() []*AttestationResult {
	results := make([]*AttestationResult, 0, len(fa.attestations))
	for _, r := range fa.attestations {
		results = append(results, r)
	}
	return results
}

// truncate truncates a string to the given length.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
