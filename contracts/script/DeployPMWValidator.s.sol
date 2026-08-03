// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Script, console2 } from "forge-std/Script.sol";
import { PMWValidator } from "../src/PMWValidator.sol";

/// @title DeployPMWValidator
/// @notice Deploys the PMWValidator contract to Coston2.
contract DeployPMWValidator is Script {
    // FCC Diamond address on Coston2
    address constant FCC_DIAMOND = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;

    function run() external {
        vm.startBroadcast();

        PMWValidator validator = new PMWValidator(FCC_DIAMOND);
        console2.log("PMWValidator deployed at:", address(validator));

        vm.stopBroadcast();
    }
}
