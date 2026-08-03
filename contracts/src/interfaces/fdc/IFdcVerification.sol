// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IPayment } from "./IPayment.sol";

/// @title IFdcVerification - Interface for the FDC Verification contract
/// @notice The FdcVerification contract verifies Merkle proofs of FDC attestations on-chain.
interface IFdcVerification {
    /// @notice Verify a Payment attestation proof.
    /// @param _proof The Payment proof containing Merkle proof and attestation data.
    /// @return True if the proof is valid, false otherwise.
    function verifyPayment(IPayment.Proof calldata _proof) external view returns (bool);

    /// @notice Get the Merkle root for a given voting round.
    /// @param _votingRoundId The voting round ID.
    /// @return The Merkle root for the round.
    function merkleRoot(uint256 _votingRoundId) external view returns (bytes32);
}
