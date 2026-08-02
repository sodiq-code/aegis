package executor

// ActionExecutor routes approved actions to PMW for cross-chain execution.
// This is the scaffold for Task 2 — PMW validation.
//
// The ActionExecutor is part of Layer 4 (Cross-Chain Execution) of the Aegis architecture.
// It mediates between the Policy Engine (which approves actions) and the PMW system
// (which executes them on external chains like XRPL).
//
// Key PMW concepts:
//   - WalletProject: A top-level container for PMW wallets, associated with an FCC extension
//   - Wallet: An address on an external chain (e.g., XRPL) controlled by TEEs
//   - Key: A cryptographic key for signing transactions on the external chain
//   - Signing: TEEs sign transactions only upon receiving valid Flare consensus signatures
//
// PMW XRPL Transaction Flow:
//   1. Wallet Project Created → via WalletProjectManagerFacet.createProject()
//   2. Wallet Created → via WalletManagerFacet.createWallet()
//   3. Keys Added → via WalletKeyManagerFacet.addKey()
//   4. Wallet Enabled → via WalletManagerFacet.enableWallet()
//   5. TEE Signs Transaction → via FCC extension
//   6. Transaction Submitted → to XRPL

import (
	"encoding/json"
	"fmt"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

// PMWConfig holds the configuration for the PMW system.
type PMWConfig struct {
	FCCDiamondAddress string `json:"fccDiamondAddress"`
	PlatformID        string `json:"platformId"`
	KeyTypeXRP        string `json:"keyTypeXrp"`
	SigningAlgoXRPL   string `json:"signingAlgoXrpl"`
}

// DefaultPMWConfig returns the default PMW configuration for Coston2.
func DefaultPMWConfig() PMWConfig {
	return PMWConfig{
		FCCDiamondAddress: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
		PlatformID:        "TEST_PLATFORM",
		KeyTypeXRP:        "XRP",
		SigningAlgoXRPL:   "sha512half-secp256k1-ecdsa",
	}
}

// WalletProject represents a PMW wallet project.
type WalletProject struct {
	ProjectID   string `json:"projectId"`
	ExtensionID uint64 `json:"extensionId"`
	KeyType     string `json:"keyType"`
	SigningAlgo string `json:"signingAlgo"`
	Owner       string `json:"owner"`
	Status      string `json:"status"`
}

// PMWWallet represents a PMW wallet.
type PMWWallet struct {
	WalletID  string `json:"walletId"`
	ProjectID string `json:"projectId"`
	Status    string `json:"walletStatus"`
	PublicKey string `json:"publicKey,omitempty"`
}

// XRPLInstruction represents an instruction to be executed on XRPL.
type XRPLInstruction struct {
	WalletID    string `json:"walletId"`
	Destination string `json:"destination"`
	Amount      string `json:"amount"`
	Currency    string `json:"currency"`
	Memo        string `json:"memo,omitempty"`
}

// ActionExecutor handles PMW-mediated cross-chain execution.
type ActionExecutor struct {
	config   PMWConfig
	projects map[string]*WalletProject
	wallets  map[string]*PMWWallet
}

// NewActionExecutor creates a new ActionExecutor with the given configuration.
func NewActionExecutor(config PMWConfig) *ActionExecutor {
	return &ActionExecutor{
		config:   config,
		projects: make(map[string]*WalletProject),
		wallets:  make(map[string]*PMWWallet),
	}
}

// CreateWalletProject creates a new wallet project for XRPL wallets.
// This is a scaffold — the actual on-chain interaction will be implemented
// when the FCC extension is registered (Task 8).
func (ae *ActionExecutor) CreateWalletProject(extensionID uint64) (*WalletProject, error) {
	projectID := fmt.Sprintf("aegis-xrpl-project-%d", extensionID)

	project := &WalletProject{
		ProjectID:   projectID,
		ExtensionID: extensionID,
		KeyType:     ae.config.KeyTypeXRP,
		SigningAlgo: ae.config.SigningAlgoXRPL,
		Status:      "created",
	}

	ae.projects[projectID] = project
	logger.Infof("Created wallet project: %s (extension: %d, keyType: %s)", projectID, extensionID, ae.config.KeyTypeXRP)

	return project, nil
}

// CreateWallet creates a new wallet within a project.
func (ae *ActionExecutor) CreateWallet(projectID string) (*PMWWallet, error) {
	project, exists := ae.projects[projectID]
	if !exists {
		return nil, fmt.Errorf("project not found: %s", projectID)
	}

	walletID := fmt.Sprintf("wallet-%s-%d", projectID, len(ae.wallets))

	wallet := &PMWWallet{
		WalletID:  walletID,
		ProjectID: project.ProjectID,
		Status:    "initializing",
	}

	ae.wallets[walletID] = wallet
	logger.Infof("Created wallet: %s (project: %s)", walletID, projectID)

	return wallet, nil
}

// EnableWallet enables a wallet for signing.
func (ae *ActionExecutor) EnableWallet(walletID string) error {
	wallet, exists := ae.wallets[walletID]
	if !exists {
		return fmt.Errorf("wallet not found: %s", walletID)
	}

	wallet.Status = "enabled"
	logger.Infof("Enabled wallet: %s", walletID)

	return nil
}

// ExecuteXRPLInstruction sends an instruction to be executed on XRPL via PMW.
// This is the core method that routes approved actions to PMW for cross-chain execution.
func (ae *ActionExecutor) ExecuteXRPLInstruction(instruction XRPLInstruction) (*teetypes.ActionResult, error) {
	wallet, exists := ae.wallets[instruction.WalletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found: %s", instruction.WalletID)
	}

	if wallet.Status != "enabled" {
		return nil, fmt.Errorf("wallet not enabled: %s (status: %s)", instruction.WalletID, wallet.Status)
	}

	logger.Infof("Executing XRPL instruction: wallet=%s, dest=%s, amount=%s, currency=%s",
		instruction.WalletID, instruction.Destination, instruction.Amount, instruction.Currency)

	// In production, this would:
	// 1. Build the XRPL transaction
	// 2. Request TEE signing via the FCC extension
	// 3. Submit the signed transaction to XRPL
	// 4. Return the result

	// For now, return a mock result
	result := &teetypes.ActionResult{
		Log: fmt.Sprintf("XRPL instruction executed: %s -> %s (%s %s)",
			instruction.WalletID, instruction.Destination, instruction.Amount, instruction.Currency),
	}

	return result, nil
}

// GetWalletProject returns a wallet project by ID.
func (ae *ActionExecutor) GetWalletProject(projectID string) (*WalletProject, error) {
	project, exists := ae.projects[projectID]
	if !exists {
		return nil, fmt.Errorf("project not found: %s", projectID)
	}
	return project, nil
}

// GetWallet returns a wallet by ID.
func (ae *ActionExecutor) GetWallet(walletID string) (*PMWWallet, error) {
	wallet, exists := ae.wallets[walletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found: %s", walletID)
	}
	return wallet, nil
}

// ListProjects returns all wallet projects.
func (ae *ActionExecutor) ListProjects() []*WalletProject {
	projects := make([]*WalletProject, 0, len(ae.projects))
	for _, p := range ae.projects {
		projects = append(projects, p)
	}
	return projects
}

// ListWallets returns all wallets.
func (ae *ActionExecutor) ListWallets() []*PMWWallet {
	wallets := make([]*PMWWallet, 0, len(ae.wallets))
	for _, w := range ae.wallets {
		wallets = append(wallets, w)
	}
	return wallets
}

// ValidatePMW validates that PMW is available and configured correctly.
func (ae *ActionExecutor) ValidatePMW() error {
	if ae.config.FCCDiamondAddress == "" {
		return fmt.Errorf("FCC diamond address not configured")
	}
	if ae.config.KeyTypeXRP == "" {
		return fmt.Errorf("XRP key type not configured")
	}
	if ae.config.SigningAlgoXRPL == "" {
		return fmt.Errorf("XRPL signing algorithm not configured")
	}

	logger.Infof("PMW validation passed: FCC diamond=%s, keyType=%s, signingAlgo=%s",
		ae.config.FCCDiamondAddress, ae.config.KeyTypeXRP, ae.config.SigningAlgoXRPL)

	return nil
}

// MarshalJSON implements custom JSON marshaling for ActionExecutor.
func (ae *ActionExecutor) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]interface{}{
		"config":   ae.config,
		"projects": ae.projects,
		"wallets":  ae.wallets,
	})
}
