// Package onchain implements the on-chain publication of solvency proofs
// from the FCC extension to the SolvencyRoot smart contract on Coston2.
//
// This is the bridge between the TEE's SolvencyAttestor (private state)
// and the SolvencyRoot contract (public Merkle root). It is the core of
// the acceptance criterion for Task 9: "SolvencyRoot published on-chain
// from extension."
//
// Publication Flow:
//   1. SolvencyAttestor computes a proof (Merkle root + collateral data)
//   2. OnChainPublisher constructs the transaction to publishSolvencyProof()
//   3. Transaction is signed by the TEE's registered verifier key
//   4. Transaction is submitted to the SolvencyRoot contract on Coston2
//   5. The proof is stored on-chain and can be verified by auditors
package onchain

import (
        "context"
        "crypto/ecdsa"
        "fmt"
        "math/big"
        "strings"
        "sync"
        "time"

        "github.com/ethereum/go-ethereum"
        "github.com/ethereum/go-ethereum/accounts/abi"
        "github.com/ethereum/go-ethereum/accounts/abi/bind"
        "github.com/ethereum/go-ethereum/common"
        "github.com/ethereum/go-ethereum/crypto"
        "github.com/ethereum/go-ethereum/ethclient"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
)

// SolvencyRootABI is the minimal ABI for the SolvencyRoot contract's publishSolvencyProof function.
const SolvencyRootABI = `[
        {
                "inputs": [
                        {"name": "merkleRoot", "type": "bytes32"},
                        {"name": "totalFxrpCollateral", "type": "uint256"},
                        {"name": "totalLiabilities", "type": "uint256"},
                        {"name": "collateralRatio", "type": "uint256"},
                        {"name": "votingRound", "type": "uint256"}
                ],
                "name": "publishSolvencyProof",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
        },
        {
                "inputs": [],
                "name": "getCurrentSolvencyProof",
                "outputs": [
                        {
                                "components": [
                                        {"name": "merkleRoot", "type": "bytes32"},
                                        {"name": "totalFxrpCollateral", "type": "uint256"},
                                        {"name": "totalLiabilities", "type": "uint256"},
                                        {"name": "collateralRatio", "type": "uint256"},
                                        {"name": "timestamp", "type": "uint256"},
                                        {"name": "votingRound", "type": "uint256"},
                                        {"name": "attestor", "type": "address"},
                                        {"name": "isValid", "type": "bool"}
                                ],
                                "name": "",
                                "type": "tuple"
                        }
                ],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [],
                "name": "isSolvent",
                "outputs": [
                        {"name": "", "type": "bool"},
                        {"name": "", "type": "uint256"}
                ],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": true, "name": "merkleRoot", "type": "bytes32"},
                        {"indexed": false, "name": "totalFxrpCollateral", "type": "uint256"},
                        {"indexed": false, "name": "collateralRatio", "type": "uint256"},
                        {"indexed": false, "name": "votingRound", "type": "uint256"},
                        {"indexed": true, "name": "attestor", "type": "address"}
                ],
                "name": "SolvencyProofPublished",
                "type": "event"
        },
        {
                "anonymous": false,
                "inputs": [
                        {"indexed": false, "name": "collateralRatio", "type": "uint256"},
                        {"indexed": false, "name": "thresholdRatio", "type": "uint256"},
                        {"indexed": false, "name": "timestamp", "type": "uint256"}
                ],
                "name": "SolvencyWarning",
                "type": "event"
        }
]`

// OnChainProof represents a solvency proof that has been published on-chain.
type OnChainProof struct {
        MerkleRoot          common.Hash
        TotalFxrpCollateral *big.Int
        TotalLiabilities    *big.Int
        CollateralRatio     *big.Int
        VotingRound         *big.Int
        TxHash              common.Hash
        BlockNumber         uint64
        PublishedAt         time.Time
}

// OnChainPublisherConfig holds the configuration for on-chain publication.
type OnChainPublisherConfig struct {
        RPCURL              string `json:"rpcUrl"`
        SolvencyRootAddress string `json:"solvencyRootAddress"`
        VerifierPrivateKey  string `json:"verifierPrivateKey"`
        ChainID             int64  `json:"chainId"`
        GasLimit            uint64 `json:"gasLimit"`
        MaxFeePerGasGwei    float64 `json:"maxFeePerGasGwei"`
        MaxPriorityFeeGwei  float64 `json:"maxPriorityFeeGwei"`
}

// DefaultOnChainPublisherConfig returns the default config for Coston2.
func DefaultOnChainPublisherConfig() OnChainPublisherConfig {
        return OnChainPublisherConfig{
                RPCURL:           "https://coston2-api.flare.network/ext/C/rpc",
                ChainID:          114, // Coston2 chain ID
                GasLimit:         500000,
                MaxFeePerGasGwei: 25,
                MaxPriorityFeeGwei: 2,
        }
}

// OnChainPublisher publishes solvency proofs to the SolvencyRoot contract on-chain.
type OnChainPublisher struct {
        config    OnChainPublisherConfig
        client    *ethclient.Client
        abi       abi.ABI
        auth      *bind.TransactOpts
        privateKey *ecdsa.PrivateKey
        mu        sync.RWMutex
        published []*OnChainProof
        connected bool
}

// NewOnChainPublisher creates a new OnChainPublisher with the given configuration.
func NewOnChainPublisher(config OnChainPublisherConfig) *OnChainPublisher {
        return &OnChainPublisher{
                config:    config,
                published: make([]*OnChainProof, 0),
        }
}

// Connect establishes a connection to the Coston2 RPC and initializes the publisher.
func (ocp *OnChainPublisher) Connect() error {
        if ocp.config.RPCURL == "" {
                return fmt.Errorf("RPC URL not configured")
        }
        if ocp.config.SolvencyRootAddress == "" {
                return fmt.Errorf("SolvencyRoot address not configured")
        }

        client, err := ethclient.Dial(ocp.config.RPCURL)
        if err != nil {
                return fmt.Errorf("failed to connect to RPC: %w", err)
        }

        // Verify the connection
        chainID, err := client.ChainID(context.Background())
        if err != nil {
                return fmt.Errorf("failed to get chain ID: %w", err)
        }

        logger.Infof("Connected to Coston2: chainID=%s, rpcURL=%s", chainID.String(), ocp.config.RPCURL)

        // Parse the ABI
        parsedABI, err := abi.JSON(strings.NewReader(SolvencyRootABI))
        if err != nil {
                return fmt.Errorf("failed to parse ABI: %w", err)
        }

        ocp.client = client
        ocp.abi = parsedABI
        ocp.connected = true

        // Set up the private key if available
        if ocp.config.VerifierPrivateKey != "" {
                privateKey, err := crypto.HexToECDSA(ocp.config.VerifierPrivateKey)
                if err != nil {
                        return fmt.Errorf("failed to parse private key: %w", err)
                }
                ocp.privateKey = privateKey

                publicKey := privateKey.Public().(*ecdsa.PublicKey)
                address := crypto.PubkeyToAddress(*publicKey)
                logger.Infof("Verifier address: %s", address.Hex())

                // Create the transact opts
                auth, err := bind.NewKeyedTransactorWithChainID(privateKey, big.NewInt(ocp.config.ChainID))
                if err != nil {
                        return fmt.Errorf("failed to create transactor: %w", err)
                }
                auth.GasLimit = ocp.config.GasLimit
                auth.GasFeeCap = big.NewInt(int64(ocp.config.MaxFeePerGasGwei * 1e9))
                auth.GasTipCap = big.NewInt(int64(ocp.config.MaxPriorityFeeGwei * 1e9))
                ocp.auth = auth
        }

        return nil
}

// Close closes the connection to the RPC.
func (ocp *OnChainPublisher) Close() {
        if ocp.client != nil {
                ocp.client.Close()
                ocp.connected = false
        }
}

// IsConnected returns whether the publisher is connected.
func (ocp *OnChainPublisher) IsConnected() bool {
        return ocp.connected
}

// PublishSolvencyProof publishes a solvency proof to the SolvencyRoot contract on-chain.
// This is the core method that satisfies the Task 9 acceptance criterion:
// "SolvencyRoot published on-chain from extension."
func (ocp *OnChainPublisher) PublishSolvencyProof(
        merkleRoot string,
        totalFxrpCollateral uint64,
        totalLiabilities uint64,
        collateralRatio uint64,
        votingRound uint64,
) (*OnChainProof, error) {
        if !ocp.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }

        if ocp.privateKey == nil {
                return nil, fmt.Errorf("verifier private key not configured — cannot sign transaction")
        }

        // Convert the hex Merkle root to bytes32
        merkleRootBytes32, err := hexToBytes32(merkleRoot)
        if err != nil {
                return nil, fmt.Errorf("invalid merkle root: %w", err)
        }

        // Pack the function call data
        data, err := ocp.abi.Pack(
                "publishSolvencyProof",
                merkleRootBytes32,
                new(big.Int).SetUint64(totalFxrpCollateral),
                new(big.Int).SetUint64(totalLiabilities),
                new(big.Int).SetUint64(collateralRatio),
                new(big.Int).SetUint64(votingRound),
        )
        if err != nil {
                return nil, fmt.Errorf("failed to pack ABI data: %w", err)
        }

        // Get the nonce
        nonce, err := ocp.client.PendingNonceAt(context.Background(), ocp.auth.From)
        if err != nil {
                return nil, fmt.Errorf("failed to get nonce: %w", err)
        }
        ocp.auth.Nonce = big.NewInt(int64(nonce))

        // Get the current gas price
        gasPrice, err := ocp.client.SuggestGasPrice(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get gas price: %w", err)
        }
        ocp.auth.GasFeeCap = new(big.Int).Mul(gasPrice, big.NewInt(2))

        solvencyRootAddr := common.HexToAddress(ocp.config.SolvencyRootAddress)

        // Estimate gas
        estimatedGas, err := ocp.client.EstimateGas(context.Background(), ethereum.CallMsg{
                From: ocp.auth.From,
                To:   &solvencyRootAddr,
                Data: data,
        })
        if err != nil {
                logger.Warnf("Gas estimation failed (using default): %v", err)
                estimatedGas = ocp.config.GasLimit
        } else {
                // Add 20% buffer
                estimatedGas = estimatedGas * 120 / 100
        }
        ocp.auth.GasLimit = estimatedGas

        // Create the transaction using the bound transactor
        contract := bind.NewBoundContract(solvencyRootAddr, ocp.abi, ocp.client, ocp.client, ocp.client)
        tx, err := contract.Transact(ocp.auth, "publishSolvencyProof",
                merkleRootBytes32,
                new(big.Int).SetUint64(totalFxrpCollateral),
                new(big.Int).SetUint64(totalLiabilities),
                new(big.Int).SetUint64(collateralRatio),
                new(big.Int).SetUint64(votingRound),
        )
        if err != nil {
                return nil, fmt.Errorf("failed to send transaction: %w", err)
        }

        logger.Infof("Published solvency proof on-chain: txHash=%s, root=%s, collateral=%d, ratio=%d, votingRound=%d",
                tx.Hash().Hex(), truncateStr(merkleRoot, 16)+"...", totalFxrpCollateral, collateralRatio, votingRound)

        // Wait for the transaction to be mined (with timeout)
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, ocp.client, tx)
        if err != nil {
                return nil, fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        if receipt.Status != 1 {
                return nil, fmt.Errorf("transaction reverted: txHash=%s, status=%d", tx.Hash().Hex(), receipt.Status)
        }

        // Store the published proof
        proof := &OnChainProof{
                MerkleRoot:          merkleRootBytes32,
                TotalFxrpCollateral: new(big.Int).SetUint64(totalFxrpCollateral),
                TotalLiabilities:    new(big.Int).SetUint64(totalLiabilities),
                CollateralRatio:     new(big.Int).SetUint64(collateralRatio),
                VotingRound:         new(big.Int).SetUint64(votingRound),
                TxHash:              tx.Hash(),
                BlockNumber:         receipt.BlockNumber.Uint64(),
                PublishedAt:         time.Now(),
        }

        ocp.mu.Lock()
        ocp.published = append(ocp.published, proof)
        ocp.mu.Unlock()

        logger.Infof("Solvency proof confirmed on-chain: block=%d, gasUsed=%d, root=%s",
                receipt.BlockNumber.Uint64(), receipt.GasUsed, truncateStr(merkleRoot, 16)+"...")

        return proof, nil
}

// ReadCurrentProof reads the current solvency proof from the SolvencyRoot contract.
func (ocp *OnChainPublisher) ReadCurrentProof() (map[string]interface{}, error) {
        if !ocp.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }

        solvencyRootAddr := common.HexToAddress(ocp.config.SolvencyRootAddress)
        contract := bind.NewBoundContract(solvencyRootAddr, ocp.abi, ocp.client, ocp.client, ocp.client)

        var results []interface{}
        err := contract.Call(&bind.CallOpts{}, &results, "getCurrentSolvencyProof")
        if err != nil {
                return nil, fmt.Errorf("failed to read current proof: %w", err)
        }

        // Parse the result
        proofMap := make(map[string]interface{})
        if len(results) > 0 {
                // The result is a tuple, we need to extract the fields
                // This is a simplified version — in production, we'd use proper struct unpacking
                proofMap["raw"] = results
        }

        return proofMap, nil
}

// ReadIsSolvent reads the isSolvent status from the SolvencyRoot contract.
func (ocp *OnChainPublisher) ReadIsSolvent() (bool, *big.Int, error) {
        if !ocp.connected {
                return false, nil, fmt.Errorf("not connected to RPC")
        }

        solvencyRootAddr := common.HexToAddress(ocp.config.SolvencyRootAddress)
        contract := bind.NewBoundContract(solvencyRootAddr, ocp.abi, ocp.client, ocp.client, ocp.client)

        var results []interface{}
        err := contract.Call(&bind.CallOpts{}, &results, "isSolvent")
        if err != nil {
                return false, nil, fmt.Errorf("failed to read isSolvent: %w", err)
        }

        if len(results) >= 2 {
                isSolvent, _ := results[0].(bool)
                collateralRatio, _ := results[1].(*big.Int)
                return isSolvent, collateralRatio, nil
        }

        return false, nil, fmt.Errorf("unexpected result format")
}

// GetPublishedProofs returns all proofs that have been published on-chain.
func (ocp *OnChainPublisher) GetPublishedProofs() []*OnChainProof {
        ocp.mu.RLock()
        defer ocp.mu.RUnlock()

        proofs := make([]*OnChainProof, len(ocp.published))
        copy(proofs, ocp.published)
        return proofs
}

// GetPublishedCount returns the number of proofs published on-chain.
func (ocp *OnChainPublisher) GetPublishedCount() int {
        ocp.mu.RLock()
        defer ocp.mu.RUnlock()

        return len(ocp.published)
}

// ValidateOnChainPublisher validates that the publisher is configured correctly.
func (ocp *OnChainPublisher) ValidateOnChainPublisher() error {
        if ocp.config.RPCURL == "" {
                return fmt.Errorf("RPC URL not configured")
        }
        if ocp.config.SolvencyRootAddress == "" {
                return fmt.Errorf("SolvencyRoot address not configured")
        }
        if ocp.config.ChainID == 0 {
                return fmt.Errorf("chain ID not configured")
        }

        logger.Infof("OnChainPublisher validation passed: RPC=%s, contract=%s, chainID=%d",
                ocp.config.RPCURL, ocp.config.SolvencyRootAddress, ocp.config.ChainID)

        return nil
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// hexToBytes32 converts a hex string to a [32]byte for bytes32 Solidity type.
func hexToBytes32(hexStr string) ([32]byte, error) {
        var result [32]byte

        // Remove 0x prefix if present
        cleaned := strings.TrimPrefix(hexStr, "0x")

        // If the string is shorter than 64 chars, pad with leading zeros
        for len(cleaned) < 64 {
                cleaned = "0" + cleaned
        }

        if len(cleaned) > 64 {
                // Truncate to 64 chars if longer
                cleaned = cleaned[:64]
        }

        // Parse the hex string
        for i := 0; i < 32; i++ {
                var b byte
                _, err := fmt.Sscanf(cleaned[i*2:i*2+2], "%02x", &b)
                if err != nil {
                        return result, fmt.Errorf("failed to parse hex at position %d: %w", i, err)
                }
                result[i] = b
        }

        return result, nil
}

// truncateStr truncates a string to the given length.
func truncateStr(s string, maxLen int) string {
        if len(s) <= maxLen {
                return s
        }
        return s[:maxLen] + "..."
}
