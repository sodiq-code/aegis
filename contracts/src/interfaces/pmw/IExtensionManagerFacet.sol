// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IExtensionManagerFacet
/// @notice Interface for the ExtensionManagerFacet of the FCC diamond.
/// Manages FCC extensions and their registration.
interface IExtensionManagerFacet {
    /// @notice Gets the code hash info for an extension.
    /// @param _extensionId The extension ID.
    /// @param _codeHash The code hash.
    function getCodeHashInfo(uint256 _extensionId, bytes32 _codeHash) external view returns (bool supported, bool disabled);

    /// @notice Gets the extension operator address.
    /// @param _extensionId The extension ID.
    /// @return The operator address.
    function getExtensionOperator(uint256 _extensionId) external view returns (address);

    /// @notice Gets the extension owner address.
    /// @param _extensionId The extension ID.
    /// @return The owner address.
    function getExtensionOwner(uint256 _extensionId) external view returns (address);

    /// @notice Gets the supported code hashes for an extension.
    /// @param _extensionId The extension ID.
    /// @return The supported code hashes.
    function getSupportedCodeHashes(uint256 _extensionId) external view returns (bytes32[] memory);

    /// @notice Gets the supported key types for an extension.
    /// @param _extensionId The extension ID.
    /// @return The supported key types.
    function getSupportedKeyTypes(uint256 _extensionId) external view returns (bytes32[] memory);

    /// @notice Gets the system-supported key types.
    /// @return The supported key types.
    function getSystemSupportedKeyTypes() external view returns (bytes32[] memory);

    /// @notice Gets the system-supported platforms.
    /// @return The supported platforms.
    function getSystemSupportedPlatforms() external view returns (bytes32[] memory);

    /// @notice Gets the system-supported signing algorithms for a key type.
    /// @param _keyType The key type.
    /// @return The supported signing algorithms.
    function getSystemSupportedSigningAlgos(bytes32 _keyType) external view returns (bytes32[] memory);

    /// @notice Gets the TEE extension instructions sender address.
    /// @param _extensionId The extension ID.
    /// @return The instructions sender address.
    function getTeeExtensionInstructionsSender(uint256 _extensionId) external view returns (address);

    /// @notice Gets the TEE extension state verifier address.
    /// @param _extensionId The extension ID.
    /// @return The state verifier address.
    function getTeeExtensionStateVerifier(uint256 _extensionId) external view returns (address);

    /// @notice Checks if a code hash is disabled for a platform.
    function isCodeHashPlatformDisabled(uint256 _extensionId, bytes32 _codeHash, bytes32 _platform) external view returns (bool);

    /// @notice Checks if a code hash is supported for a platform.
    function isCodeHashPlatformSupported(uint256 _extensionId, bytes32 _codeHash, bytes32 _platform) external view returns (bool);

    /// @notice Checks if a key type is supported for an extension.
    function isKeyTypeSupported(uint256 _extensionId, bytes32 _keyType) external view returns (bool);

    /// @notice Checks if a signing algorithm is supported for a key type.
    function isSigningAlgoSupported(bytes32 _keyType, bytes32 _signingAlgo) external view returns (bool);

    /// @notice Gets the next public extension ID.
    /// @return The next public extension ID.
    function nextPublicExtensionId() external view returns (uint256);

    /// @notice Proposes a new owner for an extension.
    function proposeNewOwner(uint256 _extensionId, address _newOwner) external;

    /// @notice Registers a new extension.
    /// @param _instructionsSender The instructions sender address.
    /// @param _stateVerifier The state verifier address.
    function register(address _instructionsSender, address _stateVerifier) external;

    /// @notice Registers a reserved extension.
    function registerReserved(uint256 _extensionId, address _instructionsSender) external;

    /// @notice Sets the extension operator.
    function setExtensionOperator(uint256 _extensionId, address _operator) external;

    /// @notice Confirms ownership of an extension.
    function confirmOwnership(uint256 _extensionId) external;
}
