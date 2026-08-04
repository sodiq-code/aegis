// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/PMWInstructionRelay.sol";

/// @title DeployPMWInstructionRelay
/// @notice Deploys the PMWInstructionRelay contract to Coston2.
/// PMW integration — wire ActionExecutor to PMW for XRPL execution.
contract DeployPMWInstructionRelay is Script {
    // Coston2 FCC Diamond address
    address constant FCC_DIAMOND = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;

    // Deployed Aegis vault contracts
    address constant INSTRUCTION_SENDER = 0xB175F16E1cEa66360E354DB4b178C04C69363C06;
    address constant VERIFIER_ROLE = 0xB513516d02D88Be754c5204e132DEfbB0F4156e6;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        PMWInstructionRelay relay = new PMWInstructionRelay(
            FCC_DIAMOND,
            INSTRUCTION_SENDER,
            VERIFIER_ROLE
        );

        console.log("PMWInstructionRelay deployed at:", address(relay));
        console.log("FCC Diamond:", FCC_DIAMOND);
        console.log("InstructionSender:", INSTRUCTION_SENDER);
        console.log("VerifierRole:", VERIFIER_ROLE);

        vm.stopBroadcast();
    }
}
