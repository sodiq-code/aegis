// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { FDCAttestor } from "../src/FDCAttestor.sol";
import { IFdcVerification } from "../src/interfaces/fdc/IFdcVerification.sol";
import { IPayment } from "../src/interfaces/fdc/IPayment.sol";

/// @title MockFdcVerification - Mock FDC verification contract for local tests
contract MockFdcVerification is IFdcVerification {
    mapping(bytes32 => bool) public validProofs;

    function setProofValid(bytes32 txId, bool valid) external {
        validProofs[txId] = valid;
    }

    function verifyPayment(IPayment.Proof calldata _proof) external view returns (bool) {
        return validProofs[_proof.data.requestBody.transactionId];
    }

    function merkleRoot(uint256) external pure returns (bytes32) {
        return bytes32(uint256(1)); // Non-zero mock root
    }
}

/// @title FDCAttestorTest - Local unit tests for FDCAttestor contract
contract FDCAttestorTest is Test {
    FDCAttestor public attestor;
    MockFdcVerification public mockFdcVerification;

    // Mock contract addresses (deployed fresh for each test)
    address public fdcHub;
    address public fdcVerification;
    address public flareSystemsManager;
    address public fdcRequestFeeConfigs;

    function setUp() public {
        // Deploy mock contracts
        mockFdcVerification = new MockFdcVerification();
        fdcVerification = address(mockFdcVerification);

        // Use dummy addresses for other contracts (not called in these tests)
        fdcHub = makeAddr("fdcHub");
        fdcRequestFeeConfigs = makeAddr("fdcRequestFeeConfigs");
        flareSystemsManager = makeAddr("flareSystemsManager");

        // Etch some code at the dummy addresses so they pass the zero-code check
        vm.etch(fdcHub, bytes("01"));
        vm.etch(fdcRequestFeeConfigs, bytes("01"));
        vm.etch(flareSystemsManager, bytes("01"));

        attestor = new FDCAttestor(
            fdcHub,
            fdcVerification,
            flareSystemsManager,
            fdcRequestFeeConfigs
        );
    }

    function test_Constructor() public view {
        assertEq(address(attestor.FDC_HUB()), fdcHub);
        assertEq(address(attestor.FDC_VERIFICATION()), fdcVerification);
        assertEq(address(attestor.FLARE_SYSTEMS_MANAGER()), flareSystemsManager);
        assertEq(address(attestor.FDC_REQUEST_FEE_CONFIGS()), fdcRequestFeeConfigs);
    }

    function test_AttestationTypeConstants() public view {
        assertEq(attestor.ATTESTATION_TYPE_PAYMENT(), bytes32("Payment"));
        assertEq(attestor.SOURCE_ID_TEST_XRP(), bytes32("testXRP"));
        assertEq(attestor.SOURCE_ID_TEST_ETH(), bytes32("testETH"));
    }

    function test_RevertZeroAddressFdcHub() public {
        vm.expectRevert("FdcHub cannot be zero");
        new FDCAttestor(address(0), fdcVerification, flareSystemsManager, fdcRequestFeeConfigs);
    }

    function test_RevertZeroAddressFdcVerification() public {
        vm.expectRevert("FdcVerification cannot be zero");
        new FDCAttestor(fdcHub, address(0), flareSystemsManager, fdcRequestFeeConfigs);
    }

    function test_RevertZeroAddressFlareSystemsManager() public {
        vm.expectRevert("FlareSystemsManager cannot be zero");
        new FDCAttestor(fdcHub, fdcVerification, address(0), fdcRequestFeeConfigs);
    }

    function test_RevertZeroAddressFdcRequestFeeConfigs() public {
        vm.expectRevert("FdcRequestFeeConfigs cannot be zero");
        new FDCAttestor(fdcHub, fdcVerification, flareSystemsManager, address(0));
    }

    function test_VerifyAndStorePayment_InvalidProof() public {
        // Create a proof that will fail verification (not mocked as valid)
        IPayment.Proof memory proof = _createMockProof(bytes32(uint256(0x1234)));

        bool result = attestor.verifyAndStorePayment(proof);
        assertFalse(result);
    }

    function test_VerifyAndStorePayment_ValidProof() public {
        bytes32 txId = bytes32(uint256(0xABCD));

        // Mark this proof as valid in the mock
        mockFdcVerification.setProofValid(txId, true);

        IPayment.Proof memory proof = _createMockProof(txId);

        bool result = attestor.verifyAndStorePayment(proof);
        assertTrue(result);

        // Verify the payment was stored
        assertTrue(attestor.isPaymentVerified(txId));
    }

    function test_VerifyAndStorePayment_StoresPaymentDetails() public {
        bytes32 txId = bytes32(uint256(0xBEEF));

        // Mark as valid
        mockFdcVerification.setProofValid(txId, true);

        IPayment.Proof memory proof = _createMockProof(txId);
        proof.data.responseBody.spentAmount = 5000;
        proof.data.responseBody.receivedAmount = 4999;

        attestor.verifyAndStorePayment(proof);

        // Get the stored payment
        IPayment.ResponseBody memory stored = attestor.getVerifiedPayment(txId);
        assertEq(stored.spentAmount, 5000);
        assertEq(stored.receivedAmount, 4999);
    }

    function test_IsPaymentVerified_Default() public view {
        bytes32 txId = bytes32(uint256(0x1234));
        assertFalse(attestor.isPaymentVerified(txId));
    }

    function test_GetVerifiedPayment_RevertsWhenNotVerified() public {
        bytes32 txId = bytes32(uint256(0x1234));
        vm.expectRevert("Payment not verified");
        attestor.getVerifiedPayment(txId);
    }

    // --- Helper Functions ---

    function _createMockProof(bytes32 txId) internal pure returns (IPayment.Proof memory) {
        return IPayment.Proof({
            merkleProof: new bytes32[](0),
            data: IPayment.Response({
                attestationType: bytes32("Payment"),
                sourceId: bytes32("testXRP"),
                votingRound: 1,
                lowestUsedTimestamp: 0,
                requestBody: IPayment.RequestBody({
                    transactionId: txId,
                    inUtxo: 0,
                    utxo: 0
                }),
                responseBody: IPayment.ResponseBody({
                    blockNumber: 100,
                    blockTimestamp: 1700000000,
                    sourceAddressHash: bytes32(0),
                    sourceAddressesRoot: bytes32(0),
                    receivingAddressHash: bytes32(0),
                    intendedReceivingAddressHash: bytes32(0),
                    spentAmount: 1000,
                    intendedSpentAmount: 1000,
                    receivedAmount: 1000,
                    intendedReceivedAmount: 1000,
                    standardPaymentReference: bytes32(0),
                    oneToOne: true
                })
            })
        });
    }
}
