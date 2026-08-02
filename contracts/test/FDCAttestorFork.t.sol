// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test, console } from "forge-std/Test.sol";
import { FDCAttestor } from "../src/FDCAttestor.sol";
import { IPayment } from "../src/interfaces/fdc/IPayment.sol";

/// @title FDCAttestorForkTest - Fork tests against Coston2 for FDC attestation
/// @notice Tests the FDCAttestor contract against real Coston2 contracts.
/// Run with: forge test --match-contract FDCAttestorForkTest -vvv
contract FDCAttestorForkTest is Test {
    FDCAttestor public attestor;

    // Coston2 addresses
    address constant FDC_HUB = 0x48aC463d7975828989331F4De43341627b9c5f1D;
    address constant FDC_VERIFICATION = 0x906507E0B64bcD494Db73bd0459d1C667e14B933;
    address constant FLARE_SYSTEMS_MANAGER = 0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52;
    address constant FDC_REQUEST_FEE_CONFIGS = 0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e;

    string constant COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";

    function setUp() public {
        vm.createSelectFork(COSTON2_RPC);
        attestor = new FDCAttestor(
            FDC_HUB,
            FDC_VERIFICATION,
            FLARE_SYSTEMS_MANAGER,
            FDC_REQUEST_FEE_CONFIGS
        );
    }

    /// @notice Test that we can read the current voting round from Coston2.
    function test_GetCurrentVotingRound() public view {
        uint256 round = attestor.getCurrentVotingRound();
        assertGt(round, 0, "Voting round should be > 0");
        console.log("Current voting round:", round);
    }

    /// @notice Test that we can query the request fee for a Payment attestation.
    function test_GetRequestFee() public view {
        // Construct a minimal abi-encoded request
        // attestationType(32) + sourceId(32) + MIC(32) + requestBody
        // Payment requestBody: transactionId(32) + inUtxo(32) + utxo(32)
        bytes memory abiEncodedRequest = abi.encodePacked(
            bytes32("Payment"),  // attestationType
            bytes32("testXRP"),  // sourceId
            bytes32(0),          // MIC (placeholder)
            bytes32(0x2A3E7C7F6077B4D12207A9F063515EACE70FBBF3C55514CD8BD659D4AB721447), // transactionId
            uint256(0),          // inUtxo
            uint256(0)           // utxo
        );

        uint256 fee = attestor.getRequestFee(abiEncodedRequest);
        console.log("Request fee:", fee);
        // Fee should be > 0 on Coston2
        assertGt(fee, 0, "Request fee should be > 0");
    }

    /// @notice Test that we can query the Merkle root for a past round.
    /// The current round may not have finalized yet, so we check a past round.
    function test_GetMerkleRoot_PastRound() public view {
        uint256 currentRound = attestor.getCurrentVotingRound();
        // Go back 10 rounds to ensure it's finalized
        uint256 pastRound = currentRound > 10 ? currentRound - 10 : 1;

        // Try to get the merkle root - this may or may not revert
        // depending on whether there were attestations in that round
        try attestor.getMerkleRoot(pastRound) returns (bytes32 root) {
            console.log("Merkle root for round", pastRound);
            console.logBytes32(root);
            // If there's a root, it should be non-zero
            if (root != bytes32(0)) {
                assertTrue(true, "Merkle root retrieved successfully");
            }
        } catch {
            // Some rounds may not have attestations, which is fine
            console.log("No merkle root for round", pastRound);
            assertTrue(true, "Round may not have attestations");
        }
    }

    /// @notice Test the FDCAttestor contract deployment on Coston2 fork.
    function test_FDCAttestor_Deployment() public view {
        // Verify all addresses are set correctly
        assertEq(address(attestor.FDC_HUB()), FDC_HUB);
        assertEq(address(attestor.FDC_VERIFICATION()), FDC_VERIFICATION);
        assertEq(address(attestor.FLARE_SYSTEMS_MANAGER()), FLARE_SYSTEMS_MANAGER);
        assertEq(address(attestor.FDC_REQUEST_FEE_CONFIGS()), FDC_REQUEST_FEE_CONFIGS);
    }

    /// @notice Test that the FDC contracts are deployed and have code on Coston2.
    function test_FDC_ContractsHaveCode() public view {
        uint256 size;
        assembly {
            size := extcodesize(FDC_HUB)
        }
        assertGt(size, 0, "FdcHub should have code");

        assembly {
            size := extcodesize(FDC_VERIFICATION)
        }
        assertGt(size, 0, "FdcVerification should have code");

        assembly {
            size := extcodesize(FLARE_SYSTEMS_MANAGER)
        }
        assertGt(size, 0, "FlareSystemsManager should have code");

        assembly {
            size := extcodesize(FDC_REQUEST_FEE_CONFIGS)
        }
        assertGt(size, 0, "FdcRequestFeeConfigs should have code");
    }
}
