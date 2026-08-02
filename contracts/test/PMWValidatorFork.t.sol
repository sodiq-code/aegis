// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test, console2 } from "forge-std/Test.sol";
import { PMWValidator } from "../src/PMWValidator.sol";

/// @title PMWValidatorForkTest
/// @notice Fork tests that run against Coston2 to validate PMW capabilities.
/// Run with: forge test --match-contract PMWValidatorForkTest --fork-url https://coston2-api.flare.network/ext/C/rpc
contract PMWValidatorForkTest is Test {
    // FCC Diamond address on Coston2
    address constant FCC_DIAMOND = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;

    PMWValidator public validator;

    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 constant KEY_TYPE_XRP = bytes32("XRP");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 constant SIGNING_ALGO_XRPL = bytes32("sha512half-secp256k1-ecdsa");

    function setUp() public {
        // Create validator pointing to the real FCC diamond
        validator = new PMWValidator(FCC_DIAMOND);
    }

    /// @notice Test querying PMW capabilities on Coston2.
    function testFork_QueryPMWCapabilities() public {
        (bytes32[] memory platforms, bytes32[] memory keyTypes, bytes32[] memory signingAlgos) =
            validator.queryPMWCapabilities();

        // Verify platforms exist
        assertGt(platforms.length, 0, "No platforms found");

        // Verify key types exist
        assertGt(keyTypes.length, 0, "No key types found");

        // Verify signing algorithms exist for XRP
        assertGt(signingAlgos.length, 0, "No signing algorithms found for XRP");

        // Log the results
        console2.log("=== PMW Capabilities on Coston2 ===");
        console2.log("Platforms:", platforms.length);
        console2.log("Key types:", keyTypes.length);
        console2.log("Signing algos for XRP:", signingAlgos.length);
    }
}
