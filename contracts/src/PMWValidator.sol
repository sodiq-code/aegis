// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IWalletProjectManagerFacet } from "./interfaces/pmw/IWalletProjectManagerFacet.sol";
import { IWalletManagerFacet } from "./interfaces/pmw/IWalletManagerFacet.sol";
import { IWalletKeyManagerFacet } from "./interfaces/pmw/IWalletKeyManagerFacet.sol";
import { IExtensionManagerFacet } from "./interfaces/pmw/IExtensionManagerFacet.sol";

/// @title PMWValidator
/// @notice Validates PMW on Coston2 by testing XRPL wallet creation, instruction, and signing.
/// acceptance criterion: One PMW-mediated XRPL transaction confirmed from a Flare contract.
contract PMWValidator {
    /// @notice The FCC diamond address on Coston2.
    address public immutable FCC_DIAMOND;

    /// @notice Key type for XRP wallets.
    bytes32 public constant KEY_TYPE_XRP = bytes32("XRP");

    /// @notice Signing algorithm for XRPL transactions.
    bytes32 public constant SIGNING_ALGO_XRPL = bytes32("sha512half-secp256k1-ecdsa");

    /// @notice Test platform for Coston2.
    bytes32 public constant TEST_PLATFORM = bytes32("TEST_PLATFORM");

    // Events for validation tracking
    event PMWPlatformsQueried(bytes32[] platforms);
    event PMWKeyTypesQueried(bytes32[] keyTypes);
    event PMWSigningAlgosQueried(bytes32[] algos);
    event PMWProjectCreated(bytes32 projectId, uint256 extensionId);
    event PMWWalletCreated(bytes32 walletId, bytes32 projectId);
    event PMWWalletEnabled(bytes32 walletId);
    event PMWWalletStatusChecked(bytes32 walletId, uint8 status);

    constructor(address _fccDiamond) {
        require(_fccDiamond != address(0), "FCC diamond cannot be zero");
        FCC_DIAMOND = _fccDiamond;
    }

    /// @notice Step 1: Query the PMW system capabilities.
    /// @return platforms The supported platforms.
    /// @return keyTypes The supported key types.
    /// @return signingAlgos The supported signing algorithms for XRP.
    function queryPMWCapabilities()
        external
        returns (bytes32[] memory platforms, bytes32[] memory keyTypes, bytes32[] memory signingAlgos)
    {
        IExtensionManagerFacet em = IExtensionManagerFacet(FCC_DIAMOND);

        platforms = em.getSystemSupportedPlatforms();
        emit PMWPlatformsQueried(platforms);

        keyTypes = em.getSystemSupportedKeyTypes();
        emit PMWKeyTypesQueried(keyTypes);

        signingAlgos = em.getSystemSupportedSigningAlgos(KEY_TYPE_XRP);
        emit PMWSigningAlgosQueried(signingAlgos);
    }

    /// @notice Step 2: Create a wallet project for XRPL.
    /// @param _extensionId The extension ID to associate with the project.
    /// @return _projectId The created project ID.
    function createWalletProject(uint256 _extensionId) external returns (bytes32 _projectId) {
        IWalletProjectManagerFacet pm = IWalletProjectManagerFacet(FCC_DIAMOND);

        _projectId = pm.createProject(_extensionId, KEY_TYPE_XRP, SIGNING_ALGO_XRPL);
        emit PMWProjectCreated(_projectId, _extensionId);
    }

    /// @notice Step 3: Create a wallet within a project.
    /// @param _projectId The project ID.
    /// @return _walletId The created wallet ID (derived from event).
    function createWallet(bytes32 _projectId) external returns (bytes32 _walletId) {
        IWalletManagerFacet wm = IWalletManagerFacet(FCC_DIAMOND);

        wm.createWallet(_projectId);

        // Get the wallet IDs for the project
        bytes32[] memory walletIds = wm.getProjectWalletIds(_projectId);
        _walletId = walletIds[walletIds.length - 1];

        emit PMWWalletCreated(_walletId, _projectId);
    }

    /// @notice Step 4: Enable a wallet for signing.
    /// @param _walletId The wallet ID.
    function enableWallet(bytes32 _walletId) external {
        IWalletManagerFacet wm = IWalletManagerFacet(FCC_DIAMOND);

        wm.enableWallet(_walletId);

        emit PMWWalletEnabled(_walletId);
    }

    /// @notice Step 5: Check wallet status.
    /// @param _walletId The wallet ID.
    /// @return status The wallet status.
    function checkWalletStatus(bytes32 _walletId) external returns (uint8 status) {
        IWalletManagerFacet wm = IWalletManagerFacet(FCC_DIAMOND);

        status = wm.getWalletStatus(_walletId);
        emit PMWWalletStatusChecked(_walletId, status);
    }

    /// @notice Get the project info for a project.
    /// @param _projectId The project ID.
    function getProjectInfo(bytes32 _projectId)
        external
        view
        returns (
            uint256 extensionId,
            address owner,
            bytes32 keyType,
            bytes32 signingAlgo
        )
    {
        IWalletProjectManagerFacet pm = IWalletProjectManagerFacet(FCC_DIAMOND);

        extensionId = pm.getExtensionId(_projectId);
        owner = pm.getOwner(_projectId);
        keyType = pm.getKeyType(_projectId);
        signingAlgo = pm.getSigningAlgo(_projectId);
    }

    /// @notice Get the wallet keys info.
    /// @param _walletId The wallet ID.
    function getWalletKeysInfo(bytes32 _walletId)
        external
        view
        returns (bytes32[] memory keyTypes, bytes[] memory publicKeys, uint64 keyCount)
    {
        IWalletKeyManagerFacet km = IWalletKeyManagerFacet(FCC_DIAMOND);
        return km.getWalletKeysInfo(_walletId);
    }
}
