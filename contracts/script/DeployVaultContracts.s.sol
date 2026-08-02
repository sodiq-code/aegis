// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";

/// @title DeployVaultContracts
/// @notice Deployment script for all 5 Aegis vault contracts on Coston2
contract DeployVaultContracts is Script {
    // Coston2 FlareContractRegistry
    address constant FLARE_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    // Minimum collateral ratio (150%)
    uint256 constant MIN_COLLATERAL_RATIO = 15000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy VerifierRole
        VerifierRole verifierRole = new VerifierRole();
        console.log("VerifierRole deployed at:", address(verifierRole));

        // 2. Deploy PolicyRegistry
        PolicyRegistry policyRegistry = new PolicyRegistry();
        console.log("PolicyRegistry deployed at:", address(policyRegistry));

        // 3. Deploy SolvencyRoot
        SolvencyRoot solvencyRoot = new SolvencyRoot(
            address(verifierRole),
            MIN_COLLATERAL_RATIO
        );
        console.log("SolvencyRoot deployed at:", address(solvencyRoot));

        // 4. Deploy InstructionSender
        InstructionSender instructionSender = new InstructionSender(
            address(verifierRole)
        );
        console.log("InstructionSender deployed at:", address(instructionSender));

        // 5. Deploy VaultCore (requires FXRP token approval setup)
        // VaultCore needs the FlareContractRegistry, VerifierRole, PolicyRegistry,
        // SolvencyRoot, and InstructionSender addresses
        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("VerifierRole:", address(verifierRole));
        console.log("PolicyRegistry:", address(policyRegistry));
        console.log("SolvencyRoot:", address(solvencyRoot));
        console.log("InstructionSender:", address(instructionSender));
        console.log("");
        console.log("VaultCore deployment requires:");
        console.log("  - FlareContractRegistry:", FLARE_REGISTRY);
        console.log("  - VerifierRole:", address(verifierRole));
        console.log("  - PolicyRegistry:", address(policyRegistry));
        console.log("  - SolvencyRoot:", address(solvencyRoot));
        console.log("  - InstructionSender:", address(instructionSender));

        vm.stopBroadcast();
    }
}
