// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IPayment - FDC Payment attestation type interface
/// @notice Defines the structs for requesting and verifying XRPL/EVM payment attestations
/// via the Flare Data Connector (FDC).
library IPayment {
    /// @notice Request body for a Payment attestation.
    /// @param transactionId The transaction ID (hex string) to attest.
    /// @param inUtxo Index of the source address (0 for non-UTXO chains like XRPL).
    /// @param utxo Index of the receiving address (0 for non-UTXO chains like XRPL).
    struct RequestBody {
        bytes32 transactionId;
        uint256 inUtxo;
        uint256 utxo;
    }

    /// @notice Response body for a Payment attestation.
    /// @param blockNumber The block number of the transaction.
    /// @param blockTimestamp The block timestamp of the transaction.
    /// @param sourceAddressHash Hash of the source address.
    /// @param sourceAddressesRoot Merkle root of all source addresses.
    /// @param receivingAddressHash Hash of the receiving address.
    /// @param intendedReceivingAddressHash Hash of the intended receiving address.
    /// @param spentAmount Amount spent in the transaction.
    /// @param intendedSpentAmount Intended amount to spend.
    /// @param receivedAmount Amount received in the transaction.
    /// @param intendedReceivedAmount Intended amount to receive.
    /// @param standardPaymentReference Standard payment reference.
    /// @param oneToOne Whether the payment is one-to-one.
    struct ResponseBody {
        uint256 blockNumber;
        uint256 blockTimestamp;
        bytes32 sourceAddressHash;
        bytes32 sourceAddressesRoot;
        bytes32 receivingAddressHash;
        bytes32 intendedReceivingAddressHash;
        uint256 spentAmount;
        uint256 intendedSpentAmount;
        uint256 receivedAmount;
        uint256 intendedReceivedAmount;
        bytes32 standardPaymentReference;
        bool oneToOne;
    }

    /// @notice Full attestation request structure.
    /// @param attestationType The attestation type (e.g., "Payment" as bytes32).
    /// @param sourceId The data source identifier (e.g., "testXRP" as bytes32).
    /// @param messageIntegrityCode MIC for verifying the request integrity.
    /// @param requestBody The payment-specific request body.
    struct Request {
        bytes32 attestationType;
        bytes32 sourceId;
        bytes32 messageIntegrityCode;
        RequestBody requestBody;
    }

    /// @notice Full attestation response structure.
    /// @param attestationType The attestation type.
    /// @param sourceId The data source identifier.
    /// @param votingRound The voting round in which the attestation was processed.
    /// @param lowestUsedTimestamp Lowest used timestamp.
    /// @param requestBody The original request body.
    /// @param responseBody The attestation response body.
    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint256 votingRound;
        uint256 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }

    /// @notice Proof structure for verifying a Payment attestation on-chain.
    /// @param merkleProof The Merkle proof bytes.
    /// @param data The attestation response data.
    struct Proof {
        bytes32[] merkleProof;
        Response data;
    }
}
