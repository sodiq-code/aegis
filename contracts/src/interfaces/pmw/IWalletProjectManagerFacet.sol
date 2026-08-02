// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IWalletProjectManagerFacet
/// @notice Interface for the WalletProjectManagerFacet of the FCC diamond.
/// Manages wallet projects — the top-level container for PMW wallets.
interface IWalletProjectManagerFacet {
    /// @notice Creates a new wallet project.
    /// @param _extensionId The extension ID that owns this project.
    /// @param _keyType The key type for wallets in this project (e.g., "XRP").
    /// @param _signingAlgo The signing algorithm (e.g., "sha512half-secp256k1-ecdsa").
    /// @return _projectId The ID of the newly created project.
    function createProject(
        uint256 _extensionId,
        bytes32 _keyType,
        bytes32 _signingAlgo
    ) external returns (bytes32 _projectId);

    /// @notice Confirms ownership of a project.
    /// @param _projectId The project ID.
    function confirmOwnership(bytes32 _projectId) external;

    /// @notice Gets the backup manager for a project.
    /// @param _projectId The project ID.
    /// @return The backup manager address.
    function getBackupManager(bytes32 _projectId) external view returns (address);

    /// @notice Gets the extension ID for a project.
    /// @param _projectId The project ID.
    /// @return The extension ID.
    function getExtensionId(bytes32 _projectId) external view returns (uint256);

    /// @notice Gets the key type for a project.
    /// @param _projectId The project ID.
    /// @return The key type.
    function getKeyType(bytes32 _projectId) external view returns (bytes32);

    /// @notice Gets the owner of a project.
    /// @param _projectId The project ID.
    /// @return The owner address.
    function getOwner(bytes32 _projectId) external view returns (address);

    /// @notice Gets the signing algorithm for a project.
    /// @param _projectId The project ID.
    /// @return The signing algorithm.
    function getSigningAlgo(bytes32 _projectId) external view returns (bytes32);

    /// @notice Proposes a new owner for a project.
    /// @param _projectId The project ID.
    /// @param _newOwner The new owner address.
    function proposeNewOwner(bytes32 _projectId, address _newOwner) external;

    /// @notice Sets the backup manager for a project.
    /// @param _projectId The project ID.
    /// @param _backupManager The new backup manager address.
    function setBackupManager(bytes32 _projectId, address _backupManager) external;
}
