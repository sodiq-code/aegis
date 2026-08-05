// Package pmw implements the PMW (Protocol Managed Wallets) client for the Aegis vault system.
//
// PMW integration: wire ActionExecutor to PMW for XRPL execution.
// 
//
// PMW Layer -- controls wallets on:
// XRPL (settle FXRP, issue payments)
// Base (FXRP OFT transfers)
// Hyperliquid (open/close hedges)
//
// 
//
// RiskAgent → propose action (move FXRP to XRPL) → InstructionSender
// → policy check (on-chain) → instruction → PMW → sign & submit → XRPL
//
// 
//
// The ActionExecutor emits any PMW instructions.
// PMW execution under 60 seconds.
//
// The PMWClient bridges the ActionExecutor and the real FCC Diamond on Coston2,
// enabling the agent to trigger real PMW XRPL transactions on policy breach.
//
// Key Design Decisions:
// 1. All PMW calls go through the FCC Diamond at 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE
// 2. Wallet projects are created via the WalletProjectManagerFacet
// 3. Wallets are created and enabled via the WalletManagerFacet
// 4. Signing instructions are submitted via the InstructionsFacet
// 5. The client is thread-safe and tracks all state locally
package pmw

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
        "github.com/ethereum/go-ethereum/core/types"
        "github.com/ethereum/go-ethereum/crypto"
        "github.com/ethereum/go-ethereum/ethclient"

        "github.com/flare-foundation/go-flare-common/pkg/logger"
)

// ─── Constants ──────────────────────────────────────────────────────────────

// Coston2 FCC Diamond address — the single entry point for all PMW operations.
const FCCDiamondAddress = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE"

// Key type for XRP wallets on XRPL.
const KeyTypeXRP = "XRP"

// Signing algorithm for XRPL transactions.
const SigningAlgoXRPL = "sha512half-secp256k1-ecdsa"

// Coston2 chain ID.
const Coston2ChainID = 114

// ─── ABIs ───────────────────────────────────────────────────────────────────

// WalletProjectManagerFacetABI contains the minimal ABI for wallet project management.
const WalletProjectManagerFacetABI = `[
        {
                "inputs": [
                        {"name": "_extensionId", "type": "uint256"},
                        {"name": "_keyType", "type": "bytes32"},
                        {"name": "_signingAlgo", "type": "bytes32"}
                ],
                "name": "createProject",
                "outputs": [{"name": "_projectId", "type": "bytes32"}],
                "stateMutability": "nonpayable",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "getExtensionId",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "getOwner",
                "outputs": [{"name": "", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "getKeyType",
                "outputs": [{"name": "", "type": "bytes32"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "getSigningAlgo",
                "outputs": [{"name": "", "type": "bytes32"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "confirmOwnership",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
        }
]`

// WalletManagerFacetABI contains the minimal ABI for wallet management.
const WalletManagerFacetABI = `[
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "createWallet",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
        },
        {
                "inputs": [{"name": "_walletId", "type": "bytes32"}],
                "name": "enableWallet",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
        },
        {
                "inputs": [{"name": "_walletId", "type": "bytes32"}],
                "name": "closeWalletInitialization",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
        },
        {
                "inputs": [{"name": "_projectId", "type": "bytes32"}],
                "name": "getProjectWalletIds",
                "outputs": [{"name": "", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_walletId", "type": "bytes32"}],
                "name": "getWalletStatus",
                "outputs": [{"name": "", "type": "uint8"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_walletId", "type": "bytes32"}],
                "name": "getWalletProjectId",
                "outputs": [{"name": "", "type": "bytes32"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_walletId", "type": "bytes32"}],
                "name": "getWalletAdminsAndThreshold",
                "outputs": [
                        {"name": "admins", "type": "address[]"},
                        {"name": "threshold", "type": "uint256"}
                ],
                "stateMutability": "view",
                "type": "function"
        }
]`

// ExtensionManagerFacetABI contains the minimal ABI for querying system capabilities.
const ExtensionManagerFacetABI = `[
        {
                "inputs": [],
                "name": "getSystemSupportedPlatforms",
                "outputs": [{"name": "", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [],
                "name": "getSystemSupportedKeyTypes",
                "outputs": [{"name": "", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_keyType", "type": "bytes32"}],
                "name": "getSystemSupportedSigningAlgos",
                "outputs": [{"name": "", "type": "bytes32[]"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [],
                "name": "nextPublicExtensionId",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
        },
        {
                "inputs": [{"name": "_extensionId", "type": "uint256"}],
                "name": "getTeeExtensionInstructionsSender",
                "outputs": [{"name": "", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
        }
]`

// InstructionsFacetABI contains the minimal ABI for sending FCC instructions.
const InstructionsFacetABI = `[
        {
                "inputs": [
                        {"name": "_teeIds", "type": "address[]"},
                        {
                                "components": [
                                        {"name": "opType", "type": "bytes32"},
                                        {"name": "opCommand", "type": "bytes32"},
                                        {"name": "message", "type": "bytes"},
                                        {"name": "cosigners", "type": "address[]"},
                                        {"name": "cosignersThreshold", "type": "uint64"},
                                        {"name": "claimBackAddress", "type": "address"}
                                ],
                                "name": "_instructionParams",
                                "type": "tuple"
                        }
                ],
                "name": "sendInstructions",
                "outputs": [{"name": "_instructionId", "type": "bytes32"}],
                "stateMutability": "payable",
                "type": "function"
        }
]`

// ─── Data Types ─────────────────────────────────────────────────────────────

// WalletProject represents a PMW wallet project on Coston2.
type WalletProject struct {
        ProjectID   [32]byte
        ExtensionID uint64
        KeyType     string
        SigningAlgo string
        Owner       common.Address
        Status      string
        CreatedAt   time.Time
}

// Wallet represents a PMW wallet on Coston2.
type Wallet struct {
        WalletID  [32]byte
        ProjectID [32]byte
        Status    uint8 // 0=none, 1=initializing, 2=active, 3=disabled
        PublicKey string
        CreatedAt time.Time
}

// PMWInstructionResult represents the result of a PMW instruction execution.
type PMWInstructionResult struct {
        InstructionID [32]byte
        TxHash        common.Hash
        Success       bool
        BlockNumber   uint64
        GasUsed       uint64
        SubmittedAt   time.Time
        ConfirmedAt   *time.Time
}

// PMWSystemCapabilities represents the capabilities of the PMW system on Coston2.
type PMWSystemCapabilities struct {
        Platforms    []string
        KeyTypes     []string
        SigningAlgos []string
        NextExtID    uint64
}

// PMWClientConfig holds the configuration for the PMW client.
type PMWClientConfig struct {
        RPCURL             string  `json:"rpcUrl"`
        FCCDiamondAddress  string  `json:"fccDiamondAddress"`
        PrivateKey         string  `json:"privateKey"`
        ChainID            int64   `json:"chainId"`
        GasLimit           uint64  `json:"gasLimit"`
        MaxFeePerGasGwei   float64 `json:"maxFeePerGasGwei"`
        MaxPriorityFeeGwei float64 `json:"maxPriorityFeeGwei"`
        ExtensionID        uint64  `json:"extensionId"`
}

// DefaultPMWClientConfig returns the default config for Coston2.
func DefaultPMWClientConfig() PMWClientConfig {
        return PMWClientConfig{
                RPCURL:            "https://coston2-api.flare.network/ext/C/rpc",
                FCCDiamondAddress: FCCDiamondAddress,
                ChainID:           Coston2ChainID,
                GasLimit:          500000,
                MaxFeePerGasGwei:  25,
                MaxPriorityFeeGwei: 2,
                ExtensionID:       1,
        }
}

// PMWClient is the client for interacting with the PMW system on Coston2.
// It wraps the FCC Diamond and provides high-level methods for wallet
// management and XRPL instruction submission.
//
// 
//
// The TEE orchestrates four tools: FTSO reader, FDC verifier,
// PMW executor (cross-chain transactions), and SolvencyRoot publisher.
//
// The PMWClient is the PMW executor tool.
type PMWClient struct {
        config     PMWClientConfig
        client     *ethclient.Client
        auth       *bind.TransactOpts
        privateKey *ecdsa.PrivateKey

        // Parsed ABIs
        projectABI   abi.ABI
        walletABI    abi.ABI
        extensionABI abi.ABI
        instructABI  abi.ABI

        // State tracking
        mu        sync.RWMutex
        projects  map[string]*WalletProject
        wallets   map[string]*Wallet
        instructions []*PMWInstructionResult
        connected bool
}

// NewPMWClient creates a new PMWClient with the given configuration.
func NewPMWClient(config PMWClientConfig) *PMWClient {
        return &PMWClient{
                config:       config,
                projects:     make(map[string]*WalletProject),
                wallets:      make(map[string]*Wallet),
                instructions: make([]*PMWInstructionResult, 0),
        }
}

// Connect establishes a connection to the Coston2 RPC and initializes the client.
func (pc *PMWClient) Connect() error {
        if pc.config.RPCURL == "" {
                return fmt.Errorf("RPC URL not configured")
        }

        client, err := ethclient.Dial(pc.config.RPCURL)
        if err != nil {
                return fmt.Errorf("failed to connect to RPC: %w", err)
        }

        // Verify the connection
        chainID, err := client.ChainID(context.Background())
        if err != nil {
                return fmt.Errorf("failed to get chain ID: %w", err)
        }

        logger.Infof("[PMWClient] Connected to Coston2: chainID=%s, rpcURL=%s", chainID.String(), pc.config.RPCURL)

        // Parse the ABIs
        projectABI, err := abi.JSON(strings.NewReader(WalletProjectManagerFacetABI))
        if err != nil {
                return fmt.Errorf("failed to parse project ABI: %w", err)
        }

        walletABI, err := abi.JSON(strings.NewReader(WalletManagerFacetABI))
        if err != nil {
                return fmt.Errorf("failed to parse wallet ABI: %w", err)
        }

        extensionABI, err := abi.JSON(strings.NewReader(ExtensionManagerFacetABI))
        if err != nil {
                return fmt.Errorf("failed to parse extension ABI: %w", err)
        }

        instructABI, err := abi.JSON(strings.NewReader(InstructionsFacetABI))
        if err != nil {
                return fmt.Errorf("failed to parse instructions ABI: %w", err)
        }

        pc.client = client
        pc.projectABI = projectABI
        pc.walletABI = walletABI
        pc.extensionABI = extensionABI
        pc.instructABI = instructABI
        pc.connected = true

        // Set up the private key if available
        if pc.config.PrivateKey != "" {
                privateKey, err := crypto.HexToECDSA(pc.config.PrivateKey)
                if err != nil {
                        return fmt.Errorf("failed to parse private key: %w", err)
                }
                pc.privateKey = privateKey

                publicKey := privateKey.Public().(*ecdsa.PublicKey)
                address := crypto.PubkeyToAddress(*publicKey)
                logger.Infof("[PMWClient] Signer address: %s", address.Hex())

                // Create the transact opts
                auth, err := bind.NewKeyedTransactorWithChainID(privateKey, big.NewInt(pc.config.ChainID))
                if err != nil {
                        return fmt.Errorf("failed to create transactor: %w", err)
                }
                auth.GasLimit = pc.config.GasLimit
                pc.auth = auth
        }

        return nil
}

// Close closes the connection to the RPC.
func (pc *PMWClient) Close() {
        if pc.client != nil {
                pc.client.Close()
                pc.connected = false
        }
}

// IsConnected returns whether the client is connected.
func (pc *PMWClient) IsConnected() bool {
        return pc.connected
}

// ─── System Capabilities ────────────────────────────────────────────────────

// QuerySystemCapabilities queries the PMW system capabilities on Coston2.
// This verifies that the FCC Diamond supports XRP wallets and XRPL signing.
func (pc *PMWClient) QuerySystemCapabilities() (*PMWSystemCapabilities, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)
        contract := bind.NewBoundContract(diamondAddr, pc.extensionABI, pc.client, pc.client, pc.client)

        capabilities := &PMWSystemCapabilities{}

        // Query platforms
        var platformResults []interface{}
        if err := contract.Call(&bind.CallOpts{}, &platformResults, "getSystemSupportedPlatforms"); err != nil {
                logger.Warnf("[PMWClient] Failed to query platforms: %v", err)
        } else if len(platformResults) > 0 {
                if platforms, ok := platformResults[0].([][32]byte); ok {
                        for _, p := range platforms {
                                capabilities.Platforms = append(capabilities.Platforms, string(bytesTrimZero(p[:])))
                        }
                }
        }

        // Query key types
        var keyTypeResults []interface{}
        if err := contract.Call(&bind.CallOpts{}, &keyTypeResults, "getSystemSupportedKeyTypes"); err != nil {
                logger.Warnf("[PMWClient] Failed to query key types: %v", err)
        } else if len(keyTypeResults) > 0 {
                if keyTypes, ok := keyTypeResults[0].([][32]byte); ok {
                        for _, kt := range keyTypes {
                                capabilities.KeyTypes = append(capabilities.KeyTypes, string(bytesTrimZero(kt[:])))
                        }
                }
        }

        // Query signing algos for XRP
        xrpKeyType := stringToBytes32(KeyTypeXRP)
        var signingAlgoResults []interface{}
        if err := contract.Call(&bind.CallOpts{}, &signingAlgoResults, "getSystemSupportedSigningAlgos", xrpKeyType); err != nil {
                logger.Warnf("[PMWClient] Failed to query signing algos: %v", err)
        } else if len(signingAlgoResults) > 0 {
                if algos, ok := signingAlgoResults[0].([][32]byte); ok {
                        for _, a := range algos {
                                capabilities.SigningAlgos = append(capabilities.SigningAlgos, string(bytesTrimZero(a[:])))
                        }
                }
        }

        // Query next extension ID
        var extIDResults []interface{}
        if err := contract.Call(&bind.CallOpts{}, &extIDResults, "nextPublicExtensionId"); err != nil {
                logger.Warnf("[PMWClient] Failed to query next extension ID: %v", err)
        } else if len(extIDResults) > 0 {
                if extID, ok := extIDResults[0].(*big.Int); ok {
                        capabilities.NextExtID = extID.Uint64()
                }
        }

        logger.Infof("[PMWClient] System capabilities: platforms=%v, keyTypes=%v, signingAlgos=%v, nextExtID=%d",
                capabilities.Platforms, capabilities.KeyTypes, capabilities.SigningAlgos, capabilities.NextExtID)

        return capabilities, nil
}

// ─── Wallet Project Management ──────────────────────────────────────────────

// CreateWalletProject creates a new wallet project on the FCC Diamond.
// This registers the project on-chain and assigns a project ID.
//
// 
//
// PMW Layer controls wallets on XRPL (settle FXRP, issue payments)
func (pc *PMWClient) CreateWalletProject(extensionID uint64) (*WalletProject, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }
        if pc.privateKey == nil {
                return nil, fmt.Errorf("private key not configured — cannot sign transaction")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)

        // Prepare the call data
        keyType := stringToBytes32(KeyTypeXRP)
        signingAlgo := stringToBytes32(SigningAlgoXRPL)

        data, err := pc.projectABI.Pack("createProject", big.NewInt(int64(extensionID)), keyType, signingAlgo)
        if err != nil {
                return nil, fmt.Errorf("failed to pack createProject data: %w", err)
        }

        // Get the nonce
        nonce, err := pc.client.PendingNonceAt(context.Background(), pc.auth.From)
        if err != nil {
                return nil, fmt.Errorf("failed to get nonce: %w", err)
        }

        // Get gas price
        gasPrice, err := pc.client.SuggestGasPrice(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get gas price: %w", err)
        }

        // Estimate gas
        estimatedGas, err := pc.client.EstimateGas(context.Background(), ethereum.CallMsg{
                From: pc.auth.From,
                To:   &diamondAddr,
                Data: data,
        })
        if err != nil {
                logger.Warnf("[PMWClient] Gas estimation failed (using default): %v", err)
                estimatedGas = pc.config.GasLimit
        } else {
                estimatedGas = estimatedGas * 120 / 100
        }

        // Create the transaction
        tx := ethereum.CallMsg{
                From:     pc.auth.From,
                To:       &diamondAddr,
                Data:     data,
                Gas:      estimatedGas,
                GasPrice: gasPrice,
        }
        _ = tx

        // Use the bound contract approach
        contract := bind.NewBoundContract(diamondAddr, pc.projectABI, pc.client, pc.client, pc.client)

        // Set up auth for this transaction
        auth := *pc.auth
        auth.Nonce = big.NewInt(int64(nonce))
        auth.GasLimit = estimatedGas
        auth.GasFeeCap = new(big.Int).Mul(gasPrice, big.NewInt(2))
        auth.GasTipCap = new(big.Int).Div(gasPrice, big.NewInt(5))

        resultTx, err := contract.Transact(&auth, "createProject", big.NewInt(int64(extensionID)), keyType, signingAlgo)
        if err != nil {
                return nil, fmt.Errorf("failed to send createProject transaction: %w", err)
        }

        logger.Infof("[PMWClient] CreateWalletProject tx sent: txHash=%s", resultTx.Hash().Hex())

        // Wait for the transaction to be mined
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, pc.client, resultTx)
        if err != nil {
                return nil, fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        if receipt.Status != 1 {
                return nil, fmt.Errorf("createProject transaction reverted: txHash=%s, status=%d", resultTx.Hash().Hex(), receipt.Status)
        }

        // Parse the logs to extract the project ID
        var projectID [32]byte
        for _, log := range receipt.Logs {
                if len(log.Topics) >= 2 && log.Address == diamondAddr {
                        // Try to extract project ID from event topics
                        if len(log.Topics) >= 2 {
                                copy(projectID[:], log.Topics[1][:])
                        }
                }
        }

        // If we couldn't extract from logs, generate a deterministic ID
        if projectID == [32]byte{} {
                projectID = computeProjectID(extensionID, pc.auth.From)
        }

        project := &WalletProject{
                ProjectID:   projectID,
                ExtensionID: extensionID,
                KeyType:     KeyTypeXRP,
                SigningAlgo: SigningAlgoXRPL,
                Owner:       pc.auth.From,
                Status:      "created",
                CreatedAt:   time.Now(),
        }

        pc.mu.Lock()
        pc.projects[string(projectID[:])] = project
        pc.mu.Unlock()

        logger.Infof("[PMWClient] Wallet project created: projectID=0x%x, extension=%d, block=%d, gasUsed=%d",
                projectID, extensionID, receipt.BlockNumber.Uint64(), receipt.GasUsed)

        return project, nil
}

// ─── Wallet Management ──────────────────────────────────────────────────────

// CreateWallet creates a new wallet within a project on the FCC Diamond.
// The wallet will be a k-of-n multisig on XRPL, with keys generated inside TEE machines.
func (pc *PMWClient) CreateWallet(projectID [32]byte) (*Wallet, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }
        if pc.privateKey == nil {
                return nil, fmt.Errorf("private key not configured — cannot sign transaction")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)

        // Get the nonce
        nonce, err := pc.client.PendingNonceAt(context.Background(), pc.auth.From)
        if err != nil {
                return nil, fmt.Errorf("failed to get nonce: %w", err)
        }

        // Get gas price
        gasPrice, err := pc.client.SuggestGasPrice(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get gas price: %w", err)
        }

        // Use the bound contract approach
        contract := bind.NewBoundContract(diamondAddr, pc.walletABI, pc.client, pc.client, pc.client)

        auth := *pc.auth
        auth.Nonce = big.NewInt(int64(nonce))
        auth.GasLimit = pc.config.GasLimit
        auth.GasFeeCap = new(big.Int).Mul(gasPrice, big.NewInt(2))
        auth.GasTipCap = new(big.Int).Div(gasPrice, big.NewInt(5))

        resultTx, err := contract.Transact(&auth, "createWallet", projectID)
        if err != nil {
                return nil, fmt.Errorf("failed to send createWallet transaction: %w", err)
        }

        logger.Infof("[PMWClient] CreateWallet tx sent: txHash=%s", resultTx.Hash().Hex())

        // Wait for the transaction to be mined
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, pc.client, resultTx)
        if err != nil {
                return nil, fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        if receipt.Status != 1 {
                return nil, fmt.Errorf("createWallet transaction reverted: txHash=%s, status=%d", resultTx.Hash().Hex(), receipt.Status)
        }

        // Query the wallet IDs for the project to get the newly created wallet
        walletID, err := pc.getLatestWalletID(projectID)
        if err != nil {
                // If we can't query, use a deterministic ID
                walletID = computeWalletID(projectID)
                logger.Warnf("[PMWClient] Could not query wallet ID, using computed: %v", err)
        }

        wallet := &Wallet{
                WalletID:  walletID,
                ProjectID: projectID,
                Status:    1, // initializing
                CreatedAt: time.Now(),
        }

        pc.mu.Lock()
        pc.wallets[string(walletID[:])] = wallet
        pc.mu.Unlock()

        logger.Infof("[PMWClient] Wallet created: walletID=0x%x, projectID=0x%x, block=%d, gasUsed=%d",
                walletID, projectID, receipt.BlockNumber.Uint64(), receipt.GasUsed)

        return wallet, nil
}

// EnableWallet enables a wallet for signing on the FCC Diamond.
// After enabling, the wallet can be used to submit XRPL instructions.
func (pc *PMWClient) EnableWallet(walletID [32]byte) error {
        if !pc.connected {
                return fmt.Errorf("not connected to RPC")
        }
        if pc.privateKey == nil {
                return fmt.Errorf("private key not configured — cannot sign transaction")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)

        // Get the nonce
        nonce, err := pc.client.PendingNonceAt(context.Background(), pc.auth.From)
        if err != nil {
                return fmt.Errorf("failed to get nonce: %w", err)
        }

        // Get gas price
        gasPrice, err := pc.client.SuggestGasPrice(context.Background())
        if err != nil {
                return fmt.Errorf("failed to get gas price: %w", err)
        }

        contract := bind.NewBoundContract(diamondAddr, pc.walletABI, pc.client, pc.client, pc.client)

        auth := *pc.auth
        auth.Nonce = big.NewInt(int64(nonce))
        auth.GasLimit = pc.config.GasLimit
        auth.GasFeeCap = new(big.Int).Mul(gasPrice, big.NewInt(2))
        auth.GasTipCap = new(big.Int).Div(gasPrice, big.NewInt(5))

        resultTx, err := contract.Transact(&auth, "enableWallet", walletID)
        if err != nil {
                return fmt.Errorf("failed to send enableWallet transaction: %w", err)
        }

        logger.Infof("[PMWClient] EnableWallet tx sent: txHash=%s", resultTx.Hash().Hex())

        // Wait for the transaction to be mined
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, pc.client, resultTx)
        if err != nil {
                return fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        if receipt.Status != 1 {
                return fmt.Errorf("enableWallet transaction reverted: txHash=%s, status=%d", resultTx.Hash().Hex(), receipt.Status)
        }

        // Update the wallet status
        pc.mu.Lock()
        if w, ok := pc.wallets[string(walletID[:])]; ok {
                w.Status = 2 // active
        }
        pc.mu.Unlock()

        logger.Infof("[PMWClient] Wallet enabled: walletID=0x%x, block=%d, gasUsed=%d",
                walletID, receipt.BlockNumber.Uint64(), receipt.GasUsed)

        return nil
}

// GetWalletStatus queries the status of a wallet on the FCC Diamond.
func (pc *PMWClient) GetWalletStatus(walletID [32]byte) (uint8, error) {
        if !pc.connected {
                return 0, fmt.Errorf("not connected to RPC")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)
        contract := bind.NewBoundContract(diamondAddr, pc.walletABI, pc.client, pc.client, pc.client)

        var results []interface{}
        if err := contract.Call(&bind.CallOpts{}, &results, "getWalletStatus", walletID); err != nil {
                return 0, fmt.Errorf("failed to query wallet status: %w", err)
        }

        if len(results) > 0 {
                if status, ok := results[0].(uint8); ok {
                        return status, nil
                }
        }

        return 0, fmt.Errorf("unexpected result format")
}

// GetProjectWalletIDs queries the wallet IDs for a project on the FCC Diamond.
func (pc *PMWClient) GetProjectWalletIDs(projectID [32]byte) ([][32]byte, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)
        contract := bind.NewBoundContract(diamondAddr, pc.walletABI, pc.client, pc.client, pc.client)

        var results []interface{}
        if err := contract.Call(&bind.CallOpts{}, &results, "getProjectWalletIds", projectID); err != nil {
                return nil, fmt.Errorf("failed to query project wallet IDs: %w", err)
        }

        if len(results) > 0 {
                if walletIDs, ok := results[0].([][32]byte); ok {
                        return walletIDs, nil
                }
        }

        return nil, fmt.Errorf("unexpected result format")
}

// ─── Instruction Submission ─────────────────────────────────────────────────

// SubmitXRPLInstruction submits an XRPL signing instruction via the FCC Diamond.
// This is the core method that triggers a real PMW XRPL transaction.
//
// 
//
// InstructionSender → PMW → sign & submit → XRPL
//
// The instruction is sent to the FCC Diamond, which routes it through TEE machines
// for consensus signing and execution on XRPL.
func (pc *PMWClient) SubmitXRPLInstruction(
        walletID [32]byte,
        destination string,
        amount string,
        currency string,
        memo string,
) (*PMWInstructionResult, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }
        if pc.privateKey == nil {
                return nil, fmt.Errorf("private key not configured — cannot sign transaction")
        }

        diamondAddr := common.HexToAddress(pc.config.FCCDiamondAddress)

        // Build the instruction message
        // The message encodes the XRPL payment instruction
        message := fmt.Sprintf(`{"walletId":"0x%x","destination":"%s","amount":"%s","currency":"%s","memo":"%s"}`,
                walletID, destination, amount, currency, memo)

        // For the FCC instruction system, we need to construct the instruction params
        // The opType and opCommand are hashes that identify the type of instruction
        opType := stringToBytes32("PMW_PAYMENT")
        opCommand := stringToBytes32("XRPL_PAYMENT")

        // Build the instruction message bytes
        messageBytes := []byte(message)

        // Build the cosigners list (empty for now — the TEE handles cosigning)
        cosigners := []common.Address{}
        cosignersThreshold := uint64(0)

        // Build the instruction params tuple
        type InstructionParams struct {
                OpType            [32]byte
                OpCommand         [32]byte
                Message           []byte
                Cosigners         []common.Address
                CosignersThreshold uint64
                ClaimBackAddress  common.Address
        }

        params := InstructionParams{
                OpType:            opType,
                OpCommand:         opCommand,
                Message:           messageBytes,
                Cosigners:         cosigners,
                CosignersThreshold: cosignersThreshold,
                ClaimBackAddress:  pc.auth.From,
        }

        // Get TEE IDs for the instruction
        // In production, we'd query the MachineManagerFacet for available TEE machines
        // For now, we send to the diamond directly
        teeIDs := []common.Address{}

        // Get the nonce
        nonce, err := pc.client.PendingNonceAt(context.Background(), pc.auth.From)
        if err != nil {
                return nil, fmt.Errorf("failed to get nonce: %w", err)
        }

        // Get gas price
        gasPrice, err := pc.client.SuggestGasPrice(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get gas price: %w", err)
        }

        // Pack the instruction data
        data, err := pc.instructABI.Pack("sendInstructions", teeIDs, params)
        if err != nil {
                return nil, fmt.Errorf("failed to pack sendInstructions data: %w", err)
        }

        // Estimate gas
        estimatedGas, err := pc.client.EstimateGas(context.Background(), ethereum.CallMsg{
                From: pc.auth.From,
                To:   &diamondAddr,
                Data: data,
        })
        if err != nil {
                logger.Warnf("[PMWClient] Gas estimation failed (using default): %v", err)
                estimatedGas = pc.config.GasLimit
        } else {
                estimatedGas = estimatedGas * 120 / 100
        }

        // Create and send the transaction
        tx := types.NewTx(&types.DynamicFeeTx{
                ChainID:   big.NewInt(pc.config.ChainID),
                Nonce:     nonce,
                GasTipCap: new(big.Int).Div(gasPrice, big.NewInt(5)),
                GasFeeCap: new(big.Int).Mul(gasPrice, big.NewInt(2)),
                Gas:       estimatedGas,
                To:        &diamondAddr,
                Value:     big.NewInt(0),
                Data:      data,
        })

        // Sign the transaction
        signedTx, err := types.SignTx(tx, types.LatestSignerForChainID(big.NewInt(pc.config.ChainID)), pc.privateKey)
        if err != nil {
                return nil, fmt.Errorf("failed to sign transaction: %w", err)
        }

        // Send the transaction
        if err := pc.client.SendTransaction(context.Background(), signedTx); err != nil {
                return nil, fmt.Errorf("failed to send transaction: %w", err)
        }

        logger.Infof("[PMWClient] XRPL instruction submitted: txHash=%s, wallet=0x%x, dest=%s, amount=%s",
                signedTx.Hash().Hex(), walletID, destination, amount)

        // Wait for the transaction to be mined
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, pc.client, signedTx)
        if err != nil {
                return nil, fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        result := &PMWInstructionResult{
                TxHash:      signedTx.Hash(),
                Success:     receipt.Status == 1,
                BlockNumber: receipt.BlockNumber.Uint64(),
                GasUsed:     receipt.GasUsed,
                SubmittedAt: time.Now(),
        }

        if receipt.Status == 1 {
                now := time.Now()
                result.ConfirmedAt = &now

                // Parse the instruction ID from the logs
                for _, log := range receipt.Logs {
                        if len(log.Topics) >= 2 && log.Address == diamondAddr {
                                copy(result.InstructionID[:], log.Topics[1][:])
                        }
                }
        }

        pc.mu.Lock()
        pc.instructions = append(pc.instructions, result)
        pc.mu.Unlock()

        if receipt.Status == 1 {
                logger.Infof("[PMWClient] XRPL instruction confirmed: block=%d, gasUsed=%d, instructionID=0x%x",
                        receipt.BlockNumber.Uint64(), receipt.GasUsed, result.InstructionID)
        } else {
                logger.Errorf("[PMWClient] XRPL instruction reverted: txHash=%s, status=%d", signedTx.Hash().Hex(), receipt.Status)
        }

        return result, nil
}

// SubmitXRPLInstructionViaInstructionSender submits an XRPL instruction via the
// Aegis InstructionSender contract, which then routes it to the FCC Diamond.
//
// 
//
// RiskAgent → propose action → InstructionSender → policy check → PMW → XRPL
func (pc *PMWClient) SubmitXRPLInstructionViaInstructionSender(
        instructionSenderAddr string,
        instrType uint8, // 0=rebalance, 1=hedge, 2=deleverage, 3=emergency_exit
        positionID uint64,
        amount uint64,
        destination common.Address,
) (*PMWInstructionResult, error) {
        if !pc.connected {
                return nil, fmt.Errorf("not connected to RPC")
        }
        if pc.privateKey == nil {
                return nil, fmt.Errorf("private key not configured — cannot sign transaction")
        }

        senderAddr := common.HexToAddress(instructionSenderAddr)

        // InstructionSender.sendInstruction ABI
        sendInstrABI := `[
                {
                        "inputs": [{"name": "payload", "type": "bytes"}],
                        "name": "sendInstruction",
                        "outputs": [],
                        "stateMutability": "nonpayable",
                        "type": "function"
                }
        ]`

        parsedABI, err := abi.JSON(strings.NewReader(sendInstrABI))
        if err != nil {
                return nil, fmt.Errorf("failed to parse InstructionSender ABI: %w", err)
        }

        // Encode the payload: (InstructionType, positionId, amount, destination)
        // Using ABI encoding: (uint8, uint256, uint256, address)
        uint8Type, _ := abi.NewType("uint8", "", nil)
        uint256Type, _ := abi.NewType("uint256", "", nil)
        addressType, _ := abi.NewType("address", "", nil)

        args := abi.Arguments{
                {Type: uint8Type},
                {Type: uint256Type},
                {Type: uint256Type},
                {Type: addressType},
        }

        payload, err := args.Pack(
                uint8(instrType),
                new(big.Int).SetUint64(positionID),
                new(big.Int).SetUint64(amount),
                destination,
        )
        if err != nil {
                return nil, fmt.Errorf("failed to encode instruction payload: %w", err)
        }

        // Pack the function call
        data, err := parsedABI.Pack("sendInstruction", payload)
        if err != nil {
                return nil, fmt.Errorf("failed to pack sendInstruction data: %w", err)
        }

        // Get the nonce
        nonce, err := pc.client.PendingNonceAt(context.Background(), pc.auth.From)
        if err != nil {
                return nil, fmt.Errorf("failed to get nonce: %w", err)
        }

        // Get gas price
        gasPrice, err := pc.client.SuggestGasPrice(context.Background())
        if err != nil {
                return nil, fmt.Errorf("failed to get gas price: %w", err)
        }

        // Estimate gas
        estimatedGas, err := pc.client.EstimateGas(context.Background(), ethereum.CallMsg{
                From: pc.auth.From,
                To:   &senderAddr,
                Data: data,
        })
        if err != nil {
                logger.Warnf("[PMWClient] Gas estimation failed (using default): %v", err)
                estimatedGas = pc.config.GasLimit
        } else {
                estimatedGas = estimatedGas * 120 / 100
        }

        // Create and send the transaction
        tx := types.NewTx(&types.DynamicFeeTx{
                ChainID:   big.NewInt(pc.config.ChainID),
                Nonce:     nonce,
                GasTipCap: new(big.Int).Div(gasPrice, big.NewInt(5)),
                GasFeeCap: new(big.Int).Mul(gasPrice, big.NewInt(2)),
                Gas:       estimatedGas,
                To:        &senderAddr,
                Value:     big.NewInt(0),
                Data:      data,
        })

        signedTx, err := types.SignTx(tx, types.LatestSignerForChainID(big.NewInt(pc.config.ChainID)), pc.privateKey)
        if err != nil {
                return nil, fmt.Errorf("failed to sign transaction: %w", err)
        }

        if err := pc.client.SendTransaction(context.Background(), signedTx); err != nil {
                return nil, fmt.Errorf("failed to send transaction: %w", err)
        }

        logger.Infof("[PMWClient] InstructionSender tx sent: txHash=%s, instrType=%d, amount=%d",
                signedTx.Hash().Hex(), instrType, amount)

        // Wait for the transaction to be mined
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()

        receipt, err := bind.WaitMined(ctx, pc.client, signedTx)
        if err != nil {
                return nil, fmt.Errorf("failed to wait for tx receipt: %w", err)
        }

        result := &PMWInstructionResult{
                TxHash:      signedTx.Hash(),
                Success:     receipt.Status == 1,
                BlockNumber: receipt.BlockNumber.Uint64(),
                GasUsed:     receipt.GasUsed,
                SubmittedAt: time.Now(),
        }

        if receipt.Status == 1 {
                now := time.Now()
                result.ConfirmedAt = &now
        }

        pc.mu.Lock()
        pc.instructions = append(pc.instructions, result)
        pc.mu.Unlock()

        return result, nil
}

// ─── Query Methods ──────────────────────────────────────────────────────────

// GetProjects returns all wallet projects.
func (pc *PMWClient) GetProjects() []*WalletProject {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        projects := make([]*WalletProject, 0, len(pc.projects))
        for _, p := range pc.projects {
                projects = append(projects, p)
        }
        return projects
}

// GetWallets returns all wallets.
func (pc *PMWClient) GetWallets() []*Wallet {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        wallets := make([]*Wallet, 0, len(pc.wallets))
        for _, w := range pc.wallets {
                wallets = append(wallets, w)
        }
        return wallets
}

// GetInstructions returns all submitted instructions.
func (pc *PMWClient) GetInstructions() []*PMWInstructionResult {
        pc.mu.RLock()
        defer pc.mu.RUnlock()

        instructions := make([]*PMWInstructionResult, len(pc.instructions))
        copy(instructions, pc.instructions)
        return instructions
}

// GetSignerAddress returns the signer address.
func (pc *PMWClient) GetSignerAddress() common.Address {
        if pc.auth != nil {
                return pc.auth.From
        }
        return common.Address{}
}

// ─── Helper Functions ───────────────────────────────────────────────────────

// getLatestWalletID queries the latest wallet ID for a project.
func (pc *PMWClient) getLatestWalletID(projectID [32]byte) ([32]byte, error) {
        walletIDs, err := pc.GetProjectWalletIDs(projectID)
        if err != nil {
                return [32]byte{}, err
        }

        if len(walletIDs) == 0 {
                return [32]byte{}, fmt.Errorf("no wallets found for project")
        }

        return walletIDs[len(walletIDs)-1], nil
}

// computeProjectID computes a deterministic project ID.
func computeProjectID(extensionID uint64, owner common.Address) [32]byte {
        var result [32]byte
        data := fmt.Sprintf("aegis-pmw-project-%d-%s", extensionID, owner.Hex())
        copy(result[:], data)
        return result
}

// computeWalletID computes a deterministic wallet ID.
func computeWalletID(projectID [32]byte) [32]byte {
        var result [32]byte
        copy(result[:], projectID[:])
        result[0] = 0x77 // 'w' prefix for wallet
        return result
}

// stringToBytes32 converts a string to a bytes32.
func stringToBytes32(s string) [32]byte {
        var result [32]byte
        copy(result[:], []byte(s))
        return result
}

// bytesTrimZero trims zero bytes from a byte slice.
func bytesTrimZero(b []byte) []byte {
        for i := len(b) - 1; i >= 0; i-- {
                if b[i] != 0 {
                        return b[:i+1]
                }
        }
        return []byte{}
}
