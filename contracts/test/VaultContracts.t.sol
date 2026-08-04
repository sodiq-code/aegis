// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";

/// @title VaultContractsTest
/// @notice Comprehensive tests for all 5 vault contracts (VerifierRole, PolicyRegistry,
/// SolvencyRoot, InstructionSender, VaultCore) on local anvil.
/// Tests cover the vault API and extended functionality.
contract VaultContractsTest is Test {
    // --- Contracts ---
    VerifierRole public verifierRole;
    PolicyRegistry public policyRegistry;
    SolvencyRoot public solvencyRoot;
    InstructionSender public instructionSender;

    // --- Test Accounts ---
    address public admin;
    address public verifier;
    address public operator;
    address public depositor1;
    address public depositor2;

    // --- Constants ---
    uint256 constant MIN_COLLATERAL_RATIO = 15000; // 150%
    bytes32 constant TEE_IDENTITY = keccak256("test-tee-identity");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        operator = makeAddr("operator");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");

        // Deploy VerifierRole
        verifierRole = new VerifierRole();

        // Deploy PolicyRegistry
        policyRegistry = new PolicyRegistry();

        // Deploy SolvencyRoot
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);

        // Deploy InstructionSender
        instructionSender = new InstructionSender(address(verifierRole));

        // Grant roles
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, operator);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor1);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor2);
    }

    // ==========================================
    // VERIFIER ROLE TESTS
    // ==========================================

    function test_VerifierRole_AdminHasAdminRole() public view {
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, admin));
    }

    function test_VerifierRole_GrantRole() public {
        address newUser = makeAddr("newUser");
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, newUser);
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, newUser));
    }

    function test_VerifierRole_RevertGrantRoleNotAdmin() public {
        address newUser = makeAddr("newUser");
        vm.prank(depositor1);
        vm.expectRevert("VerifierRole: caller is not admin");
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, newUser);
    }

    function test_VerifierRole_RevokeRole() public {
        verifierRole.revokeRole(IVerifierRole.Role.DEPOSITOR, depositor1);
        assertFalse(verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, depositor1));
    }

    function test_VerifierRole_RegisterVerifier() public {
        address newVerifier = makeAddr("newVerifier");
        bytes32 newTeeIdentity = keccak256("new-tee");
        verifierRole.registerVerifier(newVerifier, newTeeIdentity);

        assertTrue(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, newVerifier));
        assertEq(verifierRole.getVerifierTeeIdentity(newVerifier), newTeeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(newVerifier));
    }

    function test_VerifierRole_GetRoleMembers() public view {
        address[] memory admins = verifierRole.getRoleMembers(IVerifierRole.Role.DEFAULT_ADMIN);
        assertEq(admins.length, 1);
        assertEq(admins[0], admin);
    }

    function test_VerifierRole_GetRoleMemberCount() public view {
        assertEq(verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR), 2);
    }

    function test_VerifierRole_IsVerifiedTEE() public view {
        assertTrue(verifierRole.isVerifiedTEE(verifier));
        assertFalse(verifierRole.isVerifiedTEE(depositor1));
    }

    function test_VerifierRole_VerifierTeeIdentity() public view {
        assertEq(verifierRole.getVerifierTeeIdentity(verifier), TEE_IDENTITY);
    }

    function test_VerifierRole_CannotRevokeOwnAdmin() public {
        vm.expectRevert("VerifierRole: cannot revoke own admin role");
        verifierRole.revokeRole(IVerifierRole.Role.DEFAULT_ADMIN, admin);
    }

    function test_VerifierRole_VerifySignature() public view {
        bytes32 messageHash = keccak256("test message");
        bytes memory signature = new bytes(65);
        bool result = verifierRole.verifySignature(verifier, messageHash, signature);
        assertFalse(result);
    }

    // ==========================================
    // POLICY REGISTRY TESTS
    // ==========================================

    function test_PolicyRegistry_DefaultPolicies() public view {
        assertEq(policyRegistry.getPolicyCount(), 3);
    }

    function test_PolicyRegistry_CreatePolicy() public {
        address[] memory assets = new address[](1);
        assets[0] = makeAddr("fxrp");
        uint256 policyId = policyRegistry.createPolicy(
            "Test Policy",
            "A test policy",
            IPolicyRegistry.RiskLevel.MEDIUM,
            2500,       // 25% max drawdown
            6000,       // 60% max single exposure
            1200,       // 12% hedge threshold
            assets,
            100_000_000,
            50_000_000,
            10_000_000_000,
            15000
        );
        assertEq(policyId, 4);
        assertEq(policyRegistry.getPolicyCount(), 4);
    }

    function test_PolicyRegistry_GetPolicy() public view {
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(1);
        assertEq(policy.policyId, 1);
        assertTrue(policy.isActive);
        assertEq(uint(policy.riskLevel), uint(IPolicyRegistry.RiskLevel.LOW));
        // Vault fields
        assertEq(policy.maxDrawdownBps, 1500);  // 15% max drawdown
        assertEq(policy.maxSingleExposureBps, 4000); // 40% max single exposure
        assertEq(policy.hedgeThresholdBps, 800); // 8% hedge threshold
    }

    function test_PolicyRegistry_ReportSpecifiedFields() public view {
        // Verify the default Conservative policy has vault fields
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(1);
        assertEq(policy.maxDrawdownBps, 1500);
        assertEq(policy.maxSingleExposureBps, 4000);
        assertEq(policy.hedgeThresholdBps, 800);
        assertEq(policy.allowedAssets.length, 1);
    }

    function test_PolicyRegistry_BalancedPolicy() public view {
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(2);
        assertEq(uint(policy.riskLevel), uint(IPolicyRegistry.RiskLevel.MEDIUM));
        assertEq(policy.maxDrawdownBps, 2500);  // 25%
        assertEq(policy.maxSingleExposureBps, 6000); // 60%
        assertEq(policy.hedgeThresholdBps, 1200); // 12%
    }

    function test_PolicyRegistry_AggressivePolicy() public view {
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(3);
        assertEq(uint(policy.riskLevel), uint(IPolicyRegistry.RiskLevel.HIGH));
        assertEq(policy.maxDrawdownBps, 4000);  // 40%
        assertEq(policy.maxSingleExposureBps, 8000); // 80%
        assertEq(policy.hedgeThresholdBps, 2000); // 20%
    }

    function test_PolicyRegistry_SetPolicy() public {
        // Test the vault setPolicy function
        address[] memory assets = new address[](1);
        assets[0] = makeAddr("new-asset");

        IPolicyRegistry.Policy memory newPolicy = IPolicyRegistry.Policy({
            policyId: 1,
            owner: admin,
            name: "Updated Conservative",
            description: "Updated policy",
            riskLevel: IPolicyRegistry.RiskLevel.LOW,
            isActive: true,
            createdAt: 0,
            updatedAt: 0,
            maxDrawdownBps: 2000,
            maxSingleExposureBps: 5000,
            hedgeThresholdBps: 1000,
            allowedAssets: assets,
            maxDepositPerTx: 200_000_000,
            maxWithdrawalPerTx: 100_000_000,
            maxTotalExposure: 20_000_000_000,
            minCollateralRatio: 18000,
            maxLeverage: 10000,
            withdrawalDelaySeconds: 86400,
            rebalanceThresholdBps: 500,
            maxSlippageBps: 100,
            onRiskBreach: IPolicyRegistry.PolicyAction.BLOCK,
            onSolvencyWarning: IPolicyRegistry.PolicyAction.DELAY
        });

        policyRegistry.setPolicy(1, newPolicy);

        IPolicyRegistry.Policy memory updated = policyRegistry.getPolicy(1);
        assertEq(updated.maxDrawdownBps, 2000);
        assertEq(updated.maxSingleExposureBps, 5000);
        assertEq(updated.hedgeThresholdBps, 1000);
    }

    function test_PolicyRegistry_SetPolicyStatus() public {
        policyRegistry.setPolicyStatus(1, false);
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(1);
        assertFalse(policy.isActive);
    }

    function test_PolicyRegistry_AssignPolicy() public {
        policyRegistry.assignPolicy(1, depositor1);
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicyForDepositor(depositor1);
        assertEq(policy.policyId, 1);
    }

    function test_PolicyRegistry_CheckActionDeposit() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 0, 50_000_000);
        assertTrue(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.ALLOW));
    }

    function test_PolicyRegistry_CheckActionDepositExceedsMax() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 0, 200_000_000);
        assertFalse(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.BLOCK));
    }

    function test_PolicyRegistry_ValidateDeposit() public view {
        bool isValid = policyRegistry.validateDeposit(1, 50_000_000, 0);
        assertTrue(isValid);
    }

    function test_PolicyRegistry_ValidateDepositExceedsMax() public view {
        bool isValid = policyRegistry.validateDeposit(1, 200_000_000, 0);
        assertFalse(isValid);
    }

    function test_PolicyRegistry_ValidateWithdrawal() public view {
        bool isValid = policyRegistry.validateWithdrawal(1, 10_000_000, 100_000_000);
        assertTrue(isValid);
    }

    function test_PolicyRegistry_ValidateWithdrawalExceedsMax() public view {
        bool isValid = policyRegistry.validateWithdrawal(1, 100_000_000, 100_000_000);
        assertFalse(isValid);
    }

    function test_PolicyRegistry_InactivePolicyBlocksAction() public {
        policyRegistry.setPolicyStatus(1, false);
        (bool allowed,) = policyRegistry.checkAction(1, 0, 50_000_000);
        assertFalse(allowed);
    }

    // ==========================================
    // SOLVENCY ROOT TESTS
    // ==========================================

    function test_SolvencyRoot_Deploy() public view {
        assertEq(solvencyRoot.getMinCollateralRatio(), MIN_COLLATERAL_RATIO);
    }

    function test_SolvencyRoot_PublishRoot() public {
        // Test the vault publishRoot function
        bytes32 merkleRoot = keccak256("test-merkle-root");
        vm.prank(verifier);
        solvencyRoot.publishRoot(merkleRoot, 5000); // 50% surplus

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertEq(proof.surplusBps, 5000);
        assertTrue(proof.isValid);
    }

    function test_SolvencyRoot_VerifySolvency() public {
        // Test the vault verifySolvency function
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        // Verify the leaf
        bool isValid = solvencyRoot.verifySolvency(proof, leaf);
        assertTrue(isValid);
    }

    function test_SolvencyRoot_VerifySolvencyWithTwoLeaves() public {
        bytes32 leaf1 = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 leaf2 = keccak256(abi.encodePacked(uint256(2), depositor2, uint256(200_000_000), uint256(100000)));

        bytes32 root;
        if (leaf1 <= leaf2) {
            root = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            root = keccak256(abi.encodePacked(leaf2, leaf1));
        }

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf2;
        assertTrue(solvencyRoot.verifySolvency(proof1, leaf1));

        bytes32[] memory proof2 = new bytes32[](1);
        proof2[0] = leaf1;
        assertTrue(solvencyRoot.verifySolvency(proof2, leaf2));
    }

    function test_SolvencyRoot_PublishProof() public {
        bytes32 merkleRoot = keccak256("test-merkle-root");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            1_000_000_000,
            500_000_000,
            20000,
            1414258
        );

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertEq(proof.totalFxrpCollateral, 1_000_000_000);
        assertEq(proof.collateralRatio, 20000);
        assertTrue(proof.isValid);
    }

    function test_SolvencyRoot_IsSolvent() public {
        bytes32 merkleRoot = keccak256("test-merkle-root-solvent");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 1_000_000_000, 500_000_000, 20000, 1414258);

        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);
        assertEq(ratio, 20000);
    }

    function test_SolvencyRoot_NotSolvent() public {
        bytes32 merkleRoot = keccak256("test-merkle-root-insolvent");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 500_000_000, 500_000_000, 10000, 1414258);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent);
    }

    function test_SolvencyRoot_InvalidateProof() public {
        bytes32 merkleRoot = keccak256("test-merkle-root-invalidate");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 1_000_000_000, 500_000_000, 20000, 1414258);

        solvencyRoot.invalidateSolvencyProof(merkleRoot, "test invalidation");

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(merkleRoot);
        assertFalse(proof.isValid);
    }

    function test_SolvencyRoot_VerifyPosition() public {
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1414258);

        bool isValid = solvencyRoot.verifyPosition(1, depositor1, 100_000_000, 50000, proof);
        assertTrue(isValid);
    }

    function test_SolvencyRoot_GetSolvencyHistory() public {
        bytes32 root1 = keccak256("history-root-1");
        bytes32 root2 = keccak256("history-root-2");

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root1, 1_000_000_000, 500_000_000, 20000, 1414258);
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root2, 1_200_000_000, 500_000_000, 24000, 1414259);

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(2);
        assertEq(history.length, 2);
    }

    function test_SolvencyRoot_SetMinCollateralRatio() public {
        solvencyRoot.setMinCollateralRatio(20000);
        assertEq(solvencyRoot.getMinCollateralRatio(), 20000);
    }

    function test_SolvencyRoot_RevertPublishNotVerifier() public {
        vm.prank(depositor1);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishSolvencyProof(keccak256("test"), 1000, 500, 20000, 1);
    }

    function test_SolvencyRoot_RevertPublishRootNotVerifier() public {
        vm.prank(depositor1);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishRoot(keccak256("test"), 5000);
    }

    function test_SolvencyRoot_SolvencyWarning() public {
        bytes32 merkleRoot = keccak256("warning-root");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 500_000_000, 500_000_000, 10000, 1414258);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
    }

    // ==========================================
    // INSTRUCTION SENDER TESTS
    // ==========================================

    function test_InstructionSender_CreateInstruction() public {
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT,
            1,
            100_000_000,
            makeAddr("destination")
        );
        assertEq(instrId, 1);
        assertEq(instructionSender.getInstructionCount(), 1);
    }

    function test_InstructionSender_SubmitInstruction() public {
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT,
            1,
            100_000_000,
            makeAddr("destination")
        );

        vm.prank(verifier);
        instructionSender.submitInstruction(instrId);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.SUBMITTED));
    }

    function test_InstructionSender_ConfirmInstruction() public {
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE,
            1,
            100_000_000,
            makeAddr("destination")
        );

        vm.prank(verifier);
        instructionSender.submitInstruction(instrId);

        bytes32 xrplTxHash = keccak256("xrpl-tx-hash");
        vm.prank(verifier);
        instructionSender.confirmInstruction(instrId, xrplTxHash);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertEq(instr.xrplTxHash, xrplTxHash);
    }

    function test_InstructionSender_CancelInstruction() public {
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT,
            1,
            100_000_000,
            makeAddr("destination")
        );

        vm.prank(verifier);
        instructionSender.cancelInstruction(instrId, "test cancellation");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CANCELLED));
    }

    function test_InstructionSender_FailInstruction() public {
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REDEEM,
            1,
            100_000_000,
            makeAddr("destination")
        );

        vm.prank(verifier);
        instructionSender.failInstruction(instrId, "PMW execution failed");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.FAILED));
    }

    function test_InstructionSender_SendInstruction() public {
        // Test the vault sendInstruction function
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType.PAYMENT,
            uint256(1),
            uint256(100_000_000),
            makeAddr("destination")
        );

        vm.prank(verifier);
        instructionSender.sendInstruction(payload);

        assertEq(instructionSender.getInstructionCount(), 1);
    }

    function test_InstructionSender_GetResponse() public {
        // Test the vault getResponse function
        bytes32 instrId = keccak256("test-instruction");
        bytes memory response = abi.encode(uint256(1), "success");
        vm.prank(verifier);
        instructionSender.setResponse(instrId, response);

        bytes memory stored = instructionSender.getResponse(instrId);
        assertEq(stored.length, response.length);
    }

    function test_InstructionSender_SetPMWProjectId() public {
        instructionSender.setPMWProjectId(42);
        assertEq(instructionSender.getPMWProjectId(), 42);
    }

    function test_InstructionSender_GetInstructionsByStatus() public {
        vm.startPrank(verifier);
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest1")
        );
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE, 2, 200_000_000, makeAddr("dest2")
        );
        vm.stopPrank();

        IInstructionSender.Instruction[] memory pending = instructionSender.getInstructionsByStatus(
            IInstructionSender.InstructionStatus.PENDING
        );
        assertEq(pending.length, 2);
    }

    function test_InstructionSender_RevertCreateNotVerifier() public {
        vm.prank(depositor1);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
    }

    function test_InstructionSender_FullLifecycle() public {
        vm.startPrank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.EMERGENCY_TRANSFER,
            1,
            500_000_000,
            makeAddr("emergency-dest")
        );

        instructionSender.submitInstruction(instrId);

        bytes32 txHash = keccak256("emergency-xrpl-tx");
        instructionSender.confirmInstruction(instrId, txHash);
        vm.stopPrank();

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertEq(instr.amount, 500_000_000);
    }
}
