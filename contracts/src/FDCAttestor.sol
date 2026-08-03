// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IFdcHub } from "./interfaces/fdc/IFdcHub.sol";
import { IFdcVerification } from "./interfaces/fdc/IFdcVerification.sol";
import { IFlareSystemsManager } from "./interfaces/fdc/IFlareSystemsManager.sol";
import { IFdcRequestFeeConfigurations } from "./interfaces/fdc/IFdcRequestFeeConfigurations.sol";
import { IPayment } from "./interfaces/fdc/IPayment.sol";

/// @title FDCAttestor
/// @notice Requests and verifies FDC XRPPayment attestations on Coston2.
/// Task 3 acceptance criterion: FDC attestation retrieved and verified from the extension.
contract FDCAttestor {
    /// @notice FDC Hub contract address.
    IFdcHub public immutable FDC_HUB;
    /// @notice FDC Verification contract address.
    IFdcVerification public immutable FDC_VERIFICATION;
    /// @notice Flare Systems Manager contract address.
    IFlareSystemsManager public immutable FLARE_SYSTEMS_MANAGER;
    /// @notice FDC Request Fee Configurations contract address.
    IFdcRequestFeeConfigurations public immutable FDC_REQUEST_FEE_CONFIGS;

    /// @notice Attestation type name for Payment.
    bytes32 public constant ATTESTATION_TYPE_PAYMENT = bytes32("Payment");
    /// @notice Source ID for XRPL testnet on Coston2.
    bytes32 public constant SOURCE_ID_TEST_XRP = bytes32("testXRP");
    /// @notice Source ID for EVM (Coston2 itself).
    bytes32 public constant SOURCE_ID_TEST_ETH = bytes32("testETH");

    // --- Events ---

    event AttestationRequested(bytes32 attestationType, bytes32 sourceId, bytes32 transactionId, uint256 votingRoundId, uint256 feePaid);
    event PaymentVerified(bytes32 transactionId, uint256 spentAmount, uint256 receivedAmount, bytes32 sourceAddressHash, bytes32 receivingAddressHash);
    event PaymentAttestationFailed(bytes32 transactionId, string reason);

    // --- Storage ---

    /// @notice Track verified payments by transaction ID.
    mapping(bytes32 => IPayment.ResponseBody) public verifiedPayments;
    /// @notice Track which transaction IDs have been verified.
    mapping(bytes32 => bool) public isVerified;

    /// @notice Initialize the FDCAttestor with Coston2 contract addresses.
    /// @param _fdcHub Address of the FdcHub contract.
    /// @param _fdcVerification Address of the FdcVerification contract.
    /// @param _flareSystemsManager Address of the FlareSystemsManager contract.
    /// @param _fdcRequestFeeConfigs Address of the FdcRequestFeeConfigurations contract.
    constructor(
        address _fdcHub,
        address _fdcVerification,
        address _flareSystemsManager,
        address _fdcRequestFeeConfigs
    ) {
        require(_fdcHub != address(0), "FdcHub cannot be zero");
        require(_fdcVerification != address(0), "FdcVerification cannot be zero");
        require(_flareSystemsManager != address(0), "FlareSystemsManager cannot be zero");
        require(_fdcRequestFeeConfigs != address(0), "FdcRequestFeeConfigs cannot be zero");

        FDC_HUB = IFdcHub(_fdcHub);
        FDC_VERIFICATION = IFdcVerification(_fdcVerification);
        FLARE_SYSTEMS_MANAGER = IFlareSystemsManager(_flareSystemsManager);
        FDC_REQUEST_FEE_CONFIGS = IFdcRequestFeeConfigurations(_fdcRequestFeeConfigs);
    }

    // --- Read-only queries ---

    /// @notice Get the current voting round ID.
    /// @return The current voting epoch ID.
    function getCurrentVotingRound() external view returns (uint256) {
        return FLARE_SYSTEMS_MANAGER.getCurrentVotingEpochId();
    }

    /// @notice Get the Merkle root for a given voting round.
    /// @param _votingRoundId The voting round ID.
    /// @return The Merkle root.
    function getMerkleRoot(uint256 _votingRoundId) external view returns (bytes32) {
        return FDC_VERIFICATION.merkleRoot(_votingRoundId);
    }

    /// @notice Get the attestation request fee for a given request.
    /// @param _abiEncodedRequest The ABI-encoded request.
    /// @return The fee in wei.
    function getRequestFee(bytes calldata _abiEncodedRequest) external view returns (uint256) {
        return FDC_REQUEST_FEE_CONFIGS.getRequestFee(_abiEncodedRequest);
    }

    // --- Write operations ---

    /// @notice Request an XRPPayment attestation from the FDC.
    /// @param _abiEncodedRequest The ABI-encoded attestation request.
    /// @return _attestationType The attestation type returned by the FDC hub.
    /// @return _votingRoundId The voting round in which the request will be processed.
    function requestAttestation(bytes calldata _abiEncodedRequest)
        external
        payable
        returns (bytes32 _attestationType, uint256 _votingRoundId)
    {
        // Get the required fee
        uint256 fee = FDC_REQUEST_FEE_CONFIGS.getRequestFee(_abiEncodedRequest);
        require(msg.value >= fee, "Insufficient fee");

        // Submit the attestation request
        _attestationType = FDC_HUB.requestAttestation{value: msg.value}(_abiEncodedRequest);

        // Get the current voting round
        _votingRoundId = FLARE_SYSTEMS_MANAGER.getCurrentVotingEpochId();

        // Decode the transaction ID from the request for the event
        // The request is: attestationType(32) + sourceId(32) + MIC(32) + requestBody
        bytes32 transactionId;
        if (_abiEncodedRequest.length >= 128) {
            transactionId = bytes32(_abiEncodedRequest[96:128]);
        }

        emit AttestationRequested(_attestationType, bytes32(0), transactionId, _votingRoundId, msg.value);
    }

    /// @notice Verify a Payment attestation proof and store the result.
    /// @param _proof The Payment proof containing Merkle proof and attestation data.
    /// @return True if the proof is valid and the payment was stored.
    function verifyAndStorePayment(IPayment.Proof calldata _proof) external returns (bool) {
        // Verify the proof on-chain
        bool isValid = FDC_VERIFICATION.verifyPayment(_proof);

        if (!isValid) {
            emit PaymentAttestationFailed(_proof.data.requestBody.transactionId, "Proof verification failed");
            return false;
        }

        bytes32 txId = _proof.data.requestBody.transactionId;

        // Store the verified payment
        verifiedPayments[txId] = _proof.data.responseBody;
        isVerified[txId] = true;

        emit PaymentVerified(
            txId,
            _proof.data.responseBody.spentAmount,
            _proof.data.responseBody.receivedAmount,
            _proof.data.responseBody.sourceAddressHash,
            _proof.data.responseBody.receivingAddressHash
        );

        return true;
    }

    /// @notice Check if a payment has been verified.
    /// @param _transactionId The transaction ID.
    /// @return True if the payment has been verified.
    function isPaymentVerified(bytes32 _transactionId) external view returns (bool) {
        return isVerified[_transactionId];
    }

    /// @notice Get a verified payment's details.
    /// @param _transactionId The transaction ID.
    /// @return The payment response body.
    function getVerifiedPayment(bytes32 _transactionId) external view returns (IPayment.ResponseBody memory) {
        require(isVerified[_transactionId], "Payment not verified");
        return verifiedPayments[_transactionId];
    }
}
