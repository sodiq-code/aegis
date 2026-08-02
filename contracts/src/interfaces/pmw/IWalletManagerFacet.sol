// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IWalletManagerFacet
/// @notice Interface for the WalletManagerFacet of the FCC diamond.
/// Manages individual PMW wallets within a project.
interface IWalletManagerFacet {
    /// @notice Creates a new wallet within a project.
    /// @param _projectId The project ID to create the wallet under.
    function createWallet(bytes32 _projectId) external;

    /// @notice Enables a wallet for signing.
    /// @param _walletId The wallet ID to enable.
    function enableWallet(bytes32 _walletId) external;

    /// @notice Closes wallet initialization — no more keys can be added.
    /// @param _walletId The wallet ID to close.
    function closeWalletInitialization(bytes32 _walletId) external;

    /// @notice Confirms an admin for a wallet.
    /// @param _walletId The wallet ID.
    function confirmAdmin(bytes32 _walletId) external;

    /// @notice Confirms a cosigner for a wallet.
    /// @param _walletId The wallet ID.
    function confirmCosigner(bytes32 _walletId) external;

    /// @notice Gets the wallet IDs for a project.
    /// @param _projectId The project ID.
    /// @return The wallet IDs.
    function getProjectWalletIds(bytes32 _projectId) external view returns (bytes32[] memory);

    /// @notice Gets the admins and threshold for a wallet.
    /// @param _walletId The wallet ID.
    /// @return admins The admin addresses.
    /// @return threshold The admin threshold.
    function getWalletAdminsAndThreshold(bytes32 _walletId) external view returns (address[] memory admins, uint256 threshold);

    /// @notice Gets the admins' public keys and threshold for a wallet.
    /// @param _walletId The wallet ID.
    function getWalletAdminsPublicKeysAndThreshold(bytes32 _walletId) external view returns (bytes[] memory publicKeys, uint256 threshold);

    /// @notice Gets the cosigners and threshold for a wallet.
    /// @param _walletId The wallet ID.
    function getWalletCosignersAndThreshold(bytes32 _walletId) external view returns (address[] memory cosigners, uint256 threshold);

    /// @notice Gets the project ID for a wallet.
    /// @param _walletId The wallet ID.
    /// @return The project ID.
    function getWalletProjectId(bytes32 _walletId) external view returns (bytes32);

    /// @notice Gets the status of a wallet.
    /// @param _walletId The wallet ID.
    /// @return The wallet status (0=none, 1=initializing, 2=active, 3=disabled).
    function getWalletStatus(bytes32 _walletId) external view returns (uint8);
}
