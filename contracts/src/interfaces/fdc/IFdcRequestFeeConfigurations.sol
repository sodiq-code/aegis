// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFdcRequestFeeConfigurations - Interface for FDC request fee configuration
/// @notice Used to query the fee required for attestation requests.
interface IFdcRequestFeeConfigurations {
    /// @notice Get the fee for an attestation request.
    /// @param _abiEncodedRequest The ABI-encoded attestation request.
    /// @return The fee amount in wei.
    function getRequestFee(bytes calldata _abiEncodedRequest) external view returns (uint256);
}
