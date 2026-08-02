package executor

import (
	"testing"
)

func TestNewActionExecutor(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	if ae == nil {
		t.Fatal("ActionExecutor is nil")
	}
	if ae.config.FCCDiamondAddress != "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE" {
		t.Errorf("Expected FCC diamond address, got %s", ae.config.FCCDiamondAddress)
	}
	if ae.config.KeyTypeXRP != "XRP" {
		t.Errorf("Expected XRP key type, got %s", ae.config.KeyTypeXRP)
	}
	if ae.config.SigningAlgoXRPL != "sha512half-secp256k1-ecdsa" {
		t.Errorf("Expected XRPL signing algo, got %s", ae.config.SigningAlgoXRPL)
	}
}

func TestValidatePMW(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	// Should pass with default config
	if err := ae.ValidatePMW(); err != nil {
		t.Errorf("ValidatePMW failed: %v", err)
	}

	// Should fail with empty FCC diamond address
	ae.config.FCCDiamondAddress = ""
	if err := ae.ValidatePMW(); err == nil {
		t.Error("Expected ValidatePMW to fail with empty FCC diamond address")
	}
}

func TestCreateWalletProject(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	project, err := ae.CreateWalletProject(65536)
	if err != nil {
		t.Fatalf("CreateWalletProject failed: %v", err)
	}
	if project.ExtensionID != 65536 {
		t.Errorf("Expected extension ID 65536, got %d", project.ExtensionID)
	}
	if project.KeyType != "XRP" {
		t.Errorf("Expected XRP key type, got %s", project.KeyType)
	}
	if project.SigningAlgo != "sha512half-secp256k1-ecdsa" {
		t.Errorf("Expected XRPL signing algo, got %s", project.SigningAlgo)
	}
}

func TestCreateWallet(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	// Create a project first
	project, err := ae.CreateWalletProject(65536)
	if err != nil {
		t.Fatalf("CreateWalletProject failed: %v", err)
	}

	// Create a wallet
	wallet, err := ae.CreateWallet(project.ProjectID)
	if err != nil {
		t.Fatalf("CreateWallet failed: %v", err)
	}
	if wallet.ProjectID != project.ProjectID {
		t.Errorf("Expected project ID %s, got %s", project.ProjectID, wallet.ProjectID)
	}
	if wallet.Status != "initializing" {
		t.Errorf("Expected initializing status, got %s", wallet.Status)
	}

	// Test creating wallet with non-existent project
	_, err = ae.CreateWallet("non-existent-project")
	if err == nil {
		t.Error("Expected error for non-existent project")
	}
}

func TestEnableWallet(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	project, _ := ae.CreateWalletProject(65536)
	wallet, _ := ae.CreateWallet(project.ProjectID)

	// Enable the wallet
	if err := ae.EnableWallet(wallet.WalletID); err != nil {
		t.Fatalf("EnableWallet failed: %v", err)
	}

	// Check the wallet is now enabled
	enabled, _ := ae.GetWallet(wallet.WalletID)
	if enabled.Status != "enabled" {
		t.Errorf("Expected enabled status, got %s", enabled.Status)
	}

	// Test enabling non-existent wallet
	if err := ae.EnableWallet("non-existent-wallet"); err == nil {
		t.Error("Expected error for non-existent wallet")
	}
}

func TestExecuteXRPLInstruction(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	project, _ := ae.CreateWalletProject(65536)
	wallet, _ := ae.CreateWallet(project.ProjectID)
	_ = ae.EnableWallet(wallet.WalletID)

	// Execute an XRPL instruction
	instruction := XRPLInstruction{
		WalletID:    wallet.WalletID,
		Destination: "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9",
		Amount:      "1000000",
		Currency:    "XRP",
		Memo:        "Aegis PMW test",
	}

	result, err := ae.ExecuteXRPLInstruction(instruction)
	if err != nil {
		t.Fatalf("ExecuteXRPLInstruction failed: %v", err)
	}
	if result == nil {
		t.Fatal("Result is nil")
	}

	// Test executing instruction with non-enabled wallet
	project2, _ := ae.CreateWalletProject(65537)
	wallet2, _ := ae.CreateWallet(project2.ProjectID)
	// Don't enable wallet2

	instruction2 := XRPLInstruction{
		WalletID:    wallet2.WalletID,
		Destination: "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9",
		Amount:      "500000",
		Currency:    "XRP",
	}

	_, err = ae.ExecuteXRPLInstruction(instruction2)
	if err == nil {
		t.Error("Expected error for non-enabled wallet")
	}
}

func TestListProjects(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	ae.CreateWalletProject(65536)
	ae.CreateWalletProject(65537)

	projects := ae.ListProjects()
	if len(projects) != 2 {
		t.Errorf("Expected 2 projects, got %d", len(projects))
	}
}

func TestListWallets(t *testing.T) {
	config := DefaultPMWConfig()
	ae := NewActionExecutor(config)

	project, _ := ae.CreateWalletProject(65536)
	ae.CreateWallet(project.ProjectID)
	ae.CreateWallet(project.ProjectID)

	wallets := ae.ListWallets()
	if len(wallets) != 2 {
		t.Errorf("Expected 2 wallets, got %d", len(wallets))
	}
}
