// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IWalletKeyManagerFacet
/// @notice Interface for the WalletKeyManagerFacet of the FCC diamond.
/// Manages wallet keys for PMW wallets.
interface IWalletKeyManagerFacet {
    /// @notice Adds a key to a wallet.
    /// @param _walletId The wallet ID.
    /// @param _keyType The key type.
    /// @param _publicKey The public key address.
    function addKey(bytes32 _walletId, bytes32 _keyType, address _publicKey) external;

    /// @notice Deletes a key from a wallet.
    /// @param _walletId The wallet ID.
    /// @param _keyType The key type.
    /// @param _keyIndex The key index.
    /// @param _publicKey The public key address.
    function deleteKey(bytes32 _walletId, bytes32 _keyType, uint64 _keyIndex, address _publicKey) external;

    /// @notice Gets the nonce for a wallet key.
    /// @param _walletId The wallet ID.
    /// @param _keyType The key type.
    /// @param _keyIndex The key index.
    /// @return The nonce.
    function getKeyNonce(bytes32 _walletId, bytes32 _keyType, uint64 _keyIndex) external view returns (uint64);

    /// @notice Gets the receiving TEE IDs for a wallet.
    /// @param _walletId The wallet ID.
    /// @return The TEE IDs.
    function getReceivingTeeIds(bytes32 _walletId) external view returns (address[] memory);

    /// @notice Gets the public key for a wallet key.
    /// @param _walletId The wallet ID.
    /// @param _keyIndex The key index.
    /// @return The public key.
    function getWalletKeyPublicKey(bytes32 _walletId, uint64 _keyIndex) external view returns (bytes memory);

    /// @notice Gets the TEE IDs for a wallet key.
    /// @param _walletId The wallet ID.
    /// @param _keyIndex The key index.
    /// @return The TEE IDs.
    function getWalletKeyTeeIds(bytes32 _walletId, uint64 _keyIndex) external view returns (address[] memory);

    /// @notice Gets the wallet keys info.
    /// @param _walletId The wallet ID.
    /// @return keyTypes The key types.
    /// @return publicKeys The public keys.
    /// @return keyCount The key count.
    function getWalletKeysInfo(bytes32 _walletId) external view returns (bytes32[] memory keyTypes, bytes[] memory publicKeys, uint64 keyCount);

    /// @notice Gets the wallet public keys.
    /// @param _walletId The wallet ID.
    /// @return The public keys.
    function getWalletPublicKeys(bytes32 _walletId) external view returns (bytes[] memory);

    /// @notice Gets the receiving TEEs and their keys.
    /// @param _walletId The wallet ID.
    function receivingTeesAndKeys(bytes32 _walletId) external view returns (address[] memory tees, bytes[] memory publicKeys);

    /// @notice Sets the multisig threshold for a wallet.
    /// @param _walletId The wallet ID.
    /// @param _threshold The new threshold.
    function setMultisigThreshold(bytes32 _walletId, uint64 _threshold) external;

    /// @notice Cleans up TEE IDs for a wallet key.
    /// @param _walletId The wallet ID.
    /// @param _keyIndex The key index.
    function cleanUpTeeIds(bytes32 _walletId, uint64 _keyIndex) external;
}
