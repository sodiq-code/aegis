// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { FDCAttestor } from "../src/FDCAttestor.sol";

/// @title DeployFDCAttestor - Deploy the FDCAttestor contract to Coston2
/// @notice Usage: forge script script/DeployFDCAttestor.s.sol --rpc-url $COSTON2_RPC_URL --broadcast
contract DeployFDCAttestor is Script {
    // Coston2 addresses
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

        vm.stopBroadcast();
    }
}
