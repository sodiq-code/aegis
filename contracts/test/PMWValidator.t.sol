// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test, console2 } from "forge-std/Test.sol";
import { PMWValidator } from "../src/PMWValidator.sol";

/// @title PMWValidatorTest
/// @notice Foundry tests for PMW validation on Coston2.
contract PMWValidatorTest is Test {
    // FCC Diamond address on Coston2
    address constant FCC_DIAMOND = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;

    PMWValidator public validator;

    // Key type and signing algo constants
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 constant KEY_TYPE_XRP = bytes32("XRP");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 constant SIGNING_ALGO_XRPL = bytes32("sha512half-secp256k1-ecdsa");

    function setUp() public {
        validator = new PMWValidator(FCC_DIAMOND);
    }

    /// @notice Test that the PMWValidator is deployed correctly.
    function test_Deployment() public view {
        assertEq(address(validator.FCC_DIAMOND()), FCC_DIAMOND);
        assertEq(validator.KEY_TYPE_XRP(), KEY_TYPE_XRP);
        assertEq(validator.SIGNING_ALGO_XRPL(), SIGNING_ALGO_XRPL);
    }

    /// @notice Test that the constants are correct.
    function test_Constants() public pure {
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(KEY_TYPE_XRP, bytes32("XRP"));
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(SIGNING_ALGO_XRPL, bytes32("sha512half-secp256k1-ecdsa"));
    }

    /// @notice Test FCC diamond address is not zero.
    function test_FccDiamondNotZero() public view {
        assertTrue(address(validator.FCC_DIAMOND()) != address(0));
    }
}
