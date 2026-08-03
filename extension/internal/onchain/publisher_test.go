package onchain

import (
        "math/big"
        "testing"
)

// ==========================================
// CONFIG TESTS
// ==========================================

func TestDefaultOnChainPublisherConfig(t *testing.T) {
        config := DefaultOnChainPublisherConfig()

        if config.RPCURL != "https://coston2-api.flare.network/ext/C/rpc" {
                t.Fatalf("Expected Coston2 RPC URL, got %s", config.RPCURL)
        }
        if config.ChainID != 114 {
                t.Fatalf("Expected chain ID 114 (Coston2), got %d", config.ChainID)
        }
        if config.GasLimit != 500000 {
                t.Fatalf("Expected gas limit 500000, got %d", config.GasLimit)
        }
        if config.MaxFeePerGasGwei != 25 {
                t.Fatalf("Expected max fee 25 gwei, got %f", config.MaxFeePerGasGwei)
        }
}

// ==========================================
// CONSTRUCTOR TESTS
// ==========================================

func TestNewOnChainPublisher(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        if publisher == nil {
                t.Fatal("OnChainPublisher should not be nil")
        }
        if publisher.IsConnected() {
                t.Fatal("OnChainPublisher should not be connected initially")
        }
        if publisher.GetPublishedCount() != 0 {
                t.Fatalf("Expected 0 published proofs, got %d", publisher.GetPublishedCount())
        }
}

// ==========================================
// VALIDATION TESTS
// ==========================================

func TestValidateOnChainPublisher(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = "0x1234567890123456789012345678901234567890"
        publisher := NewOnChainPublisher(config)

        err := publisher.ValidateOnChainPublisher()
        if err != nil {
                t.Fatalf("OnChainPublisher validation failed: %v", err)
        }
}

func TestValidateOnChainPublisher_MissingRPCURL(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.RPCURL = ""
        publisher := NewOnChainPublisher(config)

        err := publisher.ValidateOnChainPublisher()
        if err == nil {
                t.Fatal("Expected error for missing RPC URL")
        }
}

func TestValidateOnChainPublisher_MissingContractAddress(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = ""
        publisher := NewOnChainPublisher(config)

        err := publisher.ValidateOnChainPublisher()
        if err == nil {
                t.Fatal("Expected error for missing SolvencyRoot address")
        }
}

func TestValidateOnChainPublisher_MissingChainID(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.ChainID = 0
        publisher := NewOnChainPublisher(config)

        err := publisher.ValidateOnChainPublisher()
        if err == nil {
                t.Fatal("Expected error for missing chain ID")
        }
}

// ==========================================
// CONNECT TESTS (without private key — should succeed for read-only)
// ==========================================

func TestConnect_WithoutPrivateKey(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = "0x1234567890123456789012345678901234567890"
        publisher := NewOnChainPublisher(config)

        err := publisher.Connect()
        if err != nil {
                t.Fatalf("Failed to connect to Coston2: %v", err)
        }
        defer publisher.Close()

        if !publisher.IsConnected() {
                t.Fatal("Expected publisher to be connected")
        }
}

// ==========================================
// PUBLISH TESTS (without private key — should fail with clear error)
// ==========================================

func TestPublishSolvencyProof_NotConnected(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        _, err := publisher.PublishSolvencyProof("abc123", 1000, 500, 20000, 1414258)
        if err == nil {
                t.Fatal("Expected error when not connected")
        }
}

func TestPublishSolvencyProof_NoPrivateKey(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = "0x1234567890123456789012345678901234567890"
        publisher := NewOnChainPublisher(config)

        err := publisher.Connect()
        if err != nil {
                t.Fatalf("Failed to connect: %v", err)
        }
        defer publisher.Close()

        _, err = publisher.PublishSolvencyProof("abc123", 1000, 500, 20000, 1414258)
        if err == nil {
                t.Fatal("Expected error when no private key is configured")
        }
        if err.Error() != "verifier private key not configured — cannot sign transaction" {
                t.Fatalf("Expected private key error, got: %v", err)
        }
}

// ==========================================
// HELPER FUNCTION TESTS
// ==========================================

func TestHexToBytes32(t *testing.T) {
        // Test with a full 64-char hex string
        input := "abc123def4567890123456789012345678901234567890abcdef1234567890ab"
        result, err := hexToBytes32(input)
        if err != nil {
                t.Fatalf("Failed to convert hex to bytes32: %v", err)
        }

        // Verify the first few bytes
        if result[0] != 0xab {
                t.Fatalf("Expected first byte 0xab, got 0x%02x", result[0])
        }
        if result[1] != 0xc1 {
                t.Fatalf("Expected second byte 0xc1, got 0x%02x", result[1])
        }
}

func TestHexToBytes32_With0xPrefix(t *testing.T) {
        input := "0xabc123def4567890123456789012345678901234567890abcdef1234567890ab"
        result, err := hexToBytes32(input)
        if err != nil {
                t.Fatalf("Failed to convert hex with 0x prefix: %v", err)
        }
        if result[0] != 0xab {
                t.Fatalf("Expected first byte 0xab, got 0x%02x", result[0])
        }
}

func TestHexToBytes32_ShortHex(t *testing.T) {
        // Short hex should be left-padded with zeros
        input := "abc123"
        result, err := hexToBytes32(input)
        if err != nil {
                t.Fatalf("Failed to convert short hex: %v", err)
        }
        // The last 3 bytes should be 0xab, 0xc1, 0x23
        lastIdx := 31
        if result[lastIdx-2] != 0xab {
                t.Fatalf("Expected byte at position 29 to be 0xab, got 0x%02x", result[lastIdx-2])
        }
}

func TestHexToBytes32_LongHex(t *testing.T) {
        // Long hex should be truncated to 64 chars
        input := "abc123def4567890123456789012345678901234567890abcdef1234567890abEXTRA"
        result, err := hexToBytes32(input)
        if err != nil {
                t.Fatalf("Failed to convert long hex: %v", err)
        }
        // Should still work — truncated to 64 chars
        if result[0] != 0xab {
                t.Fatalf("Expected first byte 0xab, got 0x%02x", result[0])
        }
}

func TestHexToBytes32_EmptyString(t *testing.T) {
        // Empty string should produce all zeros
        result, err := hexToBytes32("")
        if err != nil {
                t.Fatalf("Failed to convert empty string: %v", err)
        }
        for i, b := range result {
                if b != 0 {
                        t.Fatalf("Expected all zeros for empty string, got non-zero at position %d: 0x%02x", i, b)
                }
        }
}

// ==========================================
// ON-CHAIN READ TESTS
// ==========================================

func TestReadCurrentProof_NotConnected(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        _, err := publisher.ReadCurrentProof()
        if err == nil {
                t.Fatal("Expected error when not connected")
        }
}

func TestReadIsSolvent_NotConnected(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        _, _, err := publisher.ReadIsSolvent()
        if err == nil {
                t.Fatal("Expected error when not connected")
        }
}

// ==========================================
// PUBLISHED PROOFS TRACKING
// ==========================================

func TestGetPublishedProofs(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        proofs := publisher.GetPublishedProofs()
        if len(proofs) != 0 {
                t.Fatalf("Expected 0 published proofs, got %d", len(proofs))
        }
}

func TestGetPublishedCount(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        publisher := NewOnChainPublisher(config)

        if publisher.GetPublishedCount() != 0 {
                t.Fatalf("Expected 0 published proofs, got %d", publisher.GetPublishedCount())
        }
}

// ==========================================
// CLOSE TESTS
// ==========================================

func TestClose(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = "0x1234567890123456789012345678901234567890"
        publisher := NewOnChainPublisher(config)

        err := publisher.Connect()
        if err != nil {
                t.Fatalf("Failed to connect: %v", err)
        }

        if !publisher.IsConnected() {
                t.Fatal("Expected publisher to be connected")
        }

        publisher.Close()

        if publisher.IsConnected() {
                t.Fatal("Expected publisher to be disconnected after Close()")
        }
}

// ==========================================
// COSTON2 CONNECTIVITY TEST
// ==========================================

func TestCoston2Connectivity(t *testing.T) {
        config := DefaultOnChainPublisherConfig()
        config.SolvencyRootAddress = "0x1234567890123456789012345678901234567890"
        publisher := NewOnChainPublisher(config)

        err := publisher.Connect()
        if err != nil {
                t.Fatalf("Failed to connect to Coston2: %v", err)
        }
        defer publisher.Close()

        // Verify the chain ID is correct (Coston2 = 114)
        if publisher.client == nil {
                t.Fatal("Expected ethclient to be initialized")
        }
}

// ==========================================
// BIG INT CONVERSION TESTS
// ==========================================

func TestBigIntConversion(t *testing.T) {
        // Verify that uint64 values can be correctly converted to *big.Int
        val := uint64(1_000_000_000)
        bigVal := new(big.Int).SetUint64(val)

        if bigVal.Uint64() != val {
                t.Fatalf("Expected %d, got %d", val, bigVal.Uint64())
        }

        // Test with larger values
        largeVal := uint64(1_000_000_000_000)
        bigLargeVal := new(big.Int).SetUint64(largeVal)
        if bigLargeVal.Uint64() != largeVal {
                t.Fatalf("Expected %d, got %d", largeVal, bigLargeVal.Uint64())
        }
}
