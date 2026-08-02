// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IPayment } from "./IPayment.sol";

/// @title IFdcHub - Interface for the Flare Data Connector Hub contract
/// @notice The FdcHub is the on-chain entry point for submitting attestation requests.
interface IFdcHub {
    /// @notice Submit an attestation request to the FDC protocol.
    /// @param _abiEncodedRequest The ABI-encoded attestation request.
    /// @return _attestationType The attestation type of the request.
    function requestAttestation(bytes calldata _abiEncodedRequest)
        external
        payable
        returns (bytes32 _attestationType);

    /// @notice Get the fee required for an attestation request.
    /// @param _abiEncodedRequest The ABI-encoded attestation request.
    /// @return The fee amount in wei.
    function getRequestFee(bytes calldata _abiEncodedRequest) external view returns (uint256);
}
