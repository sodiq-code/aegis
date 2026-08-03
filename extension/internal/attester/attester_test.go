package attester

import (
        "testing"
)

func TestDefaultFDCConfig(t *testing.T) {
        config := DefaultFDCConfig()

        if config.FdcHubAddress == "" {
                t.Error("FdcHubAddress should not be empty")
        }
        if config.FdcVerificationAddress == "" {
                t.Error("FdcVerificationAddress should not be empty")
        }
        if config.FlareSystemsManagerAddress == "" {
                t.Error("FlareSystemsManagerAddress should not be empty")
        }
        if config.RPCURL == "" {
                t.Error("RPCURL should not be empty")
        }
        if config.VerifierURL == "" {
                t.Error("VerifierURL should not be empty")
        }
}

func TestNewFDCAttestor(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        if attestor == nil {
                t.Fatal("FDCAttestor should not be nil")
        }
        if attestor.config.FdcHubAddress != config.FdcHubAddress {
                t.Errorf("FdcHubAddress mismatch: got %s, want %s", attestor.config.FdcHubAddress, config.FdcHubAddress)
        }
}

func TestValidateFDC(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        if err := attestor.ValidateFDC(); err != nil {
                t.Errorf("ValidateFDC should pass with default config: %v", err)
        }

        // Test with missing config
        emptyConfig := FDCConfig{}
        emptyAttestor := NewFDCAttestor(emptyConfig)

        if err := emptyAttestor.ValidateFDC(); err == nil {
                t.Error("ValidateFDC should fail with empty config")
        }
}

func TestToHexPadded(t *testing.T) {
        tests := []struct {
                input    string
                expected string
        }{
                {"Payment", "0x5061796d656e7400000000000000000000000000000000000000000000000000"},
                {"testXRP", "0x7465737458525000000000000000000000000000000000000000000000000000"},
                {"testETH", "0x7465737445544800000000000000000000000000000000000000000000000000"},
                {"XRP", "0x5852500000000000000000000000000000000000000000000000000000000000"},
        }

        for _, tt := range tests {
                result := toHexPadded(tt.input)
                if result != tt.expected {
                        t.Errorf("toHexPadded(%q) = %q, want %q", tt.input, result, tt.expected)
                }
        }
}

func TestPreparePaymentRequest(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        txID := "2A3E7C7F6077B4D12207A9F063515EACE70FBBF3C55514CD8BD659D4AB721447"
        request, err := attestor.PreparePaymentRequest(txID, SourceIDTestXRP)

        if err != nil {
                t.Fatalf("PreparePaymentRequest should not fail: %v", err)
        }

        if request.RequestBody.TransactionID != txID {
                t.Errorf("TransactionID mismatch: got %s, want %s", request.RequestBody.TransactionID, txID)
        }
        if request.RequestBody.InUtxo != "0" {
                t.Errorf("InUtxo should be 0, got %s", request.RequestBody.InUtxo)
        }
        if request.RequestBody.Utxo != "0" {
                t.Errorf("Utxo should be 0, got %s", request.RequestBody.Utxo)
        }

        // Verify attestation type is hex-encoded
        expectedAttType := toHexPadded("Payment")
        if request.AttestationType != expectedAttType {
                t.Errorf("AttestationType mismatch: got %s, want %s", request.AttestationType, expectedAttType)
        }

        // Verify source ID is hex-encoded
        expectedSourceID := toHexPadded("testXRP")
        if request.SourceID != expectedSourceID {
                t.Errorf("SourceID mismatch: got %s, want %s", request.SourceID, expectedSourceID)
        }
}

func TestPreparePaymentRequest_EmptyTransactionID(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        _, err := attestor.PreparePaymentRequest("", SourceIDTestXRP)
        if err == nil {
                t.Error("PreparePaymentRequest should fail with empty transaction ID")
        }
}

func TestGetAttestation_NotFound(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        _, err := attestor.GetAttestation("nonexistent")
        if err == nil {
                t.Error("GetAttestation should fail for non-existent attestation")
        }
}

func TestListAttestations_Empty(t *testing.T) {
        config := DefaultFDCConfig()
        attestor := NewFDCAttestor(config)

        results := attestor.ListAttestations()
        if len(results) != 0 {
                t.Errorf("ListAttestations should return empty list, got %d items", len(results))
        }
}

func TestTruncate(t *testing.T) {
        tests := []struct {
                input    string
                maxLen   int
                expected string
        }{
                {"hello", 10, "hello"},
                {"hello world", 5, "hello..."},
                {"abc", 3, "abc"},
        }

        for _, tt := range tests {
                result := truncate(tt.input, tt.maxLen)
                if result != tt.expected {
                        t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, result, tt.expected)
                }
        }
}
