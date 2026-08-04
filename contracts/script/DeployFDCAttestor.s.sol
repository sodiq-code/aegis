// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/FDCAttestor.sol";

/// @title DeployFDCAttestor
/// @notice Deploys the FDCAttestor contract to Coston2.
/// FDC integration: attestation of XRPL payment + Hyperliquid state.
contract DeployFDCAttestor is Script {
    // Coston2 FDC contract addresses
    address constant FDC_HUB = 0x48aC463d7975828989331F4De43341627b9c5f1D;
    address constant FDC_VERIFICATION = 0x906507E0B64bcD494Db73bd0459d1C667e14B933;
    address constant FLARE_SYSTEMS_MANAGER = 0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52;
    address constant FDC_REQUEST_FEE_CONFIGS = 0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        FDCAttestor attestor = new FDCAttestor(
            FDC_HUB,
            FDC_VERIFICATION,
            FLARE_SYSTEMS_MANAGER,
            FDC_REQUEST_FEE_CONFIGS
        );

        console.log("FDCAttestor deployed at:", address(attestor));
        console.log("FDC Hub:", FDC_HUB);
        console.log("FDC Verification:", FDC_VERIFICATION);
        console.log("Flare Systems Manager:", FLARE_SYSTEMS_MANAGER);
        console.log("FDC Request Fee Configs:", FDC_REQUEST_FEE_CONFIGS);

        vm.stopBroadcast();
    }
}
