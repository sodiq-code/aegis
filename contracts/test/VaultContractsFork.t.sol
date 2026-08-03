// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/interfaces/fassets/IFlareContractRegistry.sol";
import "../src/interfaces/fassets/IAssetManager.sol";
import "../src/interfaces/fassets/IFXRP.sol";
import "../src/VerifierRole.sol";
import "../src/interfaces/vault/IVerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";

/// @title VaultContractsForkTest
/// @notice Fork tests against Coston2 testnet to verify FAssets integration
///         and vault contract deployment.
contract VaultContractsForkTest is Test {
    // Coston2 constants
    address constant FLARE_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    string constant COSTON2_RPC = "https://coston2-api.flare.network/ext/C/rpc";
    uint256 constant COSTON2_CHAIN_ID = 114;

    // Resolved contract addresses
    address assetManagerFXRP;
    address fxrpToken;
    address ftsoV2;
    address assetManagerController;

    // Deployed contracts
    VerifierRole public verifierRole;
    PolicyRegistry public policyRegistry;
    SolvencyRoot public solvencyRoot;
    InstructionSender public instructionSender;

    uint256 forkId;

    function setUp() public {
        // Create a fork of Coston2
        forkId = vm.createFork(COSTON2_RPC);

        // Select the fork
        vm.selectFork(forkId);

        // Verify the chain ID
        assertEq(block.chainid, COSTON2_CHAIN_ID);

        // Resolve FAssets addresses from the registry
        IFlareContractRegistry registry = IFlareContractRegistry(FLARE_REGISTRY);
        assetManagerFXRP = registry.getContractAddressByName("AssetManagerFXRP");
        assetManagerController = registry.getContractAddressByName("AssetManagerController");

        // Get FXRP token address from AssetManager
        IAssetManager am = IAssetManager(assetManagerFXRP);
        fxrpToken = am.fAsset();
        ftsoV2 = registry.getContractAddressByName("FtsoV2");

        // Deploy vault contracts
        verifierRole = new VerifierRole();
        policyRegistry = new PolicyRegistry();
        solvencyRoot = new SolvencyRoot(address(verifierRole), 15000);
        instructionSender = new InstructionSender(address(verifierRole));
    }

    function testFork_FAssetsAddressesResolved() public view {
        assertTrue(assetManagerFXRP != address(0), "AssetManagerFXRP not resolved");
        assertTrue(fxrpToken != address(0), "FXRP token not resolved");
        assertTrue(ftsoV2 != address(0), "FtsoV2 not resolved");
        assertTrue(assetManagerController != address(0), "AssetManagerController not resolved");
    }

    function testFork_VaultContractsDeployed() public view {
        assertTrue(address(verifierRole) != address(0), "VerifierRole not deployed");
        assertTrue(address(policyRegistry) != address(0), "PolicyRegistry not deployed");
        assertTrue(address(solvencyRoot) != address(0), "SolvencyRoot not deployed");
        assertTrue(address(instructionSender) != address(0), "InstructionSender not deployed");
    }

    function testFork_SolvencyRootPublishAndVerify() public {
        // Grant verifier role to this test contract
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, address(this));

        // Publish a solvency proof
        bytes32 testRoot = keccak256("test-merkle-root");
        solvencyRoot.publishSolvencyProof(
            testRoot,
            1000000000, // totalFxrpCollateral
            0,          // totalLiabilities
            999999,     // collateralRatio
            1414258     // votingRound
        );

        // Verify the proof is stored
        (bool isSolvent, uint256 collateralRatio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent, "Vault should be solvent");
        assertEq(collateralRatio, 999999, "Collateral ratio mismatch");
    }

    function testFork_InstructionSenderLifecycle() public {
        // Grant verifier role to this test contract
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, address(this));

        // Create an instruction with proper ABI-encoded payload
        // Payload format: (InstructionType, positionId, amount, destination)
        // InstructionType.REBALANCE = 0
        bytes memory payload = abi.encode(
            uint8(0), // InstructionType.REBALANCE
            uint256(1), // positionId
            uint256(1000000000), // amount
            address(0x1234567890123456789012345678901234567890) // destination
        );
        instructionSender.sendInstruction(payload);

        // Verify the instruction was created
        uint256 count = instructionSender.getInstructionCount();
        assertEq(count, 1, "Instruction count should be 1");
    }

    function testFork_VerifierRoleAccessControl() public view {
        // Deployer should have admin role
        bool hasAdmin = verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, address(this));
        assertTrue(hasAdmin, "Deployer should have admin role");
    }
}
