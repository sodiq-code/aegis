// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/interfaces/fassets/IFlareContractRegistry.sol";
import "../src/interfaces/fassets/IAssetManager.sol";
import "../src/interfaces/fassets/IFXRP.sol";
import "../src/VerifierRole.sol";
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

    function setUp() public {
        // Resolve FAssets addresses from the registry
        IFlareContractRegistry registry = IFlareContractRegistry(FLARE_REGISTRY);
        assetManagerFXRP = registry.getContractAddressByName("AssetManagerFXRP");
        fxrpToken = registry.getContractAddressByName("FtsoV2"); // temp, will be overridden
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

    // ==========================================
    // FLARE CONTRACT REGISTRY TESTS
    // ==========================================

    function testFork_RegistryResolvesAssetManagerFXRP() public view {
        assertNotEq(assetManagerFXRP, address(0));
        assertEq(assetManagerFXRP, 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA);
    }

    function testFork_RegistryResolvesAssetManagerController() public view {
        assertNotEq(assetManagerController, address(0));
        assertEq(assetManagerController, 0x1C772F700308aF4c13897cc7b9c41EFfB82c50C0);
    }

    function testFork_RegistryResolvesFtsoV2() public view {
        assertNotEq(ftsoV2, address(0));
        assertEq(ftsoV2, 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d);
    }

    // ==========================================
    // ASSET MANAGER TESTS
    // ==========================================

    function testFork_AssetManagerHasCode() public view {
        uint256 codeSize;
        address am = assetManagerFXRP;
        assembly { codeSize := extcodesize(am) }
        assertGt(codeSize, 0);
    }

    function testFork_AssetManagerFAsset() public view {
        assertEq(fxrpToken, 0x0b6A3645c240605887a5532109323A3E12273dc7);
    }

    function testFork_AssetManagerLotSize() public view {
        IAssetManager am = IAssetManager(assetManagerFXRP);
        uint256 lotSize = am.lotSize();
        assertGt(lotSize, 0);
        assertEq(lotSize, 10_000_000); // 10 XRP with 6 decimals
    }

    function testFork_AssetManagerGranularity() public view {
        IAssetManager am = IAssetManager(assetManagerFXRP);
        uint256 granularity = am.assetMintingGranularityUBA();
        assertGt(granularity, 0);
        assertEq(granularity, 1);
    }

    // ==========================================
    // FXRP TOKEN TESTS
    // ==========================================

    function testFork_FXRPHasCode() public view {
        uint256 codeSize;
        address ft = fxrpToken;
        assembly { codeSize := extcodesize(ft) }
        assertGt(codeSize, 0);
    }

    function testFork_FXRPDecimals() public view {
        IFXRP fxrp = IFXRP(fxrpToken);
        uint8 decimals = fxrp.decimals();
        assertEq(decimals, 6);
    }

    function testFork_FXRPTotalSupply() public view {
        IFXRP fxrp = IFXRP(fxrpToken);
        uint256 totalSupply = fxrp.totalSupply();
        assertGt(totalSupply, 0);
    }

    // ==========================================
    // VAULT CONTRACT DEPLOYMENT TESTS
    // ==========================================

    function testFork_VerifierRoleDeployed() public view {
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, address(this)));
    }

    function testFork_PolicyRegistryDeployed() public view {
        assertEq(policyRegistry.getPolicyCount(), 3);
    }

    function testFork_SolvencyRootDeployed() public view {
        assertEq(solvencyRoot.getMinCollateralRatio(), 15000);
    }

    function testFork_InstructionSenderDeployed() public view {
        assertEq(instructionSender.getInstructionCount(), 0);
    }

    // ==========================================
    // END-TO-END VAULT INTEGRATION TEST
    // ==========================================

    function testFork_FullVaultWorkflow() public {
        // 1. Register a verifier
        address testVerifier = makeAddr("testVerifier");
        bytes32 teeIdentity = keccak256("test-tee");
        verifierRole.registerVerifier(testVerifier, teeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(testVerifier));

        // 2. Create a custom policy
        uint256 policyId = policyRegistry.createPolicy(
            "Institutional Vault",
            "Policy for institutional depositors",
            IPolicyRegistry.RiskLevel.MEDIUM,
            1_000_000_000,   // 1000 XRP max deposit
            500_000_000,     // 500 XRP max withdrawal
            100_000_000_000, // 100,000 XRP max total exposure
            15000            // 150% min collateral ratio
        );

        // 3. Assign policy to a depositor
        address testDepositor = makeAddr("testDepositor");
        policyRegistry.assignPolicy(policyId, testDepositor);

        // 4. Publish a solvency proof
        bytes32 merkleRoot = keccak256("test-merkle-root");
        vm.prank(testVerifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            10_000_000_000,  // 1000 XRP collateral
            5_000_000_000,   // 500 XRP liabilities
            20000,           // 200% collateral ratio
            1414258          // voting round
        );

        // 5. Verify solvency
        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);
        assertEq(ratio, 20000);

        // 6. Create and submit an instruction
        vm.prank(testVerifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE,
            1,
            100_000_000,
            makeAddr("xrpl-destination")
        );

        vm.prank(testVerifier);
        instructionSender.submitInstruction(instrId);

        // 7. Confirm the instruction
        bytes32 xrplTxHash = keccak256("xrpl-tx-hash");
        vm.prank(testVerifier);
        instructionSender.confirmInstruction(instrId, xrplTxHash);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
    }
}
