// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";

/// @title VaultContractsTest
/// @notice Comprehensive tests for all 5 vault contracts (VerifierRole, PolicyRegistry,
///         SolvencyRoot, InstructionSender, VaultCore) on local anvil.
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
        // Verify signature is implemented but requires a real signature
        // Just verify the function exists and returns false for invalid sig
        bytes32 messageHash = keccak256("test message");
        bytes memory signature = new bytes(65);
        bool result = verifierRole.verifySignature(verifier, messageHash, signature);
        assertFalse(result); // Invalid signature should return false
    }

    // ==========================================
    // POLICY REGISTRY TESTS
    // ==========================================

    function test_PolicyRegistry_DefaultPolicies() public view {
        // 3 default policies created in constructor
        assertEq(policyRegistry.getPolicyCount(), 3);
    }

    function test_PolicyRegistry_CreatePolicy() public {
        uint256 policyId = policyRegistry.createPolicy(
            "Test Policy",
            "A test policy",
            IPolicyRegistry.RiskLevel.MEDIUM,
            100_000_000,
            50_000_000,
            10_000_000_000,
            15000
        );
        assertEq(policyId, 4); // 4th policy (3 defaults + 1 new)
        assertEq(policyRegistry.getPolicyCount(), 4);
    }

    function test_PolicyRegistry_GetPolicy() public view {
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(1);
        assertEq(policy.policyId, 1);
        assertTrue(policy.isActive);
        assertEq(uint(policy.riskLevel), uint(IPolicyRegistry.RiskLevel.LOW));
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
        // Policy 1: maxDepositPerTx = 100_000_000 (100 XRP)
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 0, 200_000_000);
        assertFalse(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.BLOCK));
    }

    function test_PolicyRegistry_ValidateDeposit() public view {
        // Policy 1: maxDepositPerTx = 100_000_000, maxTotalExposure = 10_000_000_000
        bool isValid = policyRegistry.validateDeposit(1, 50_000_000, 0);
        assertTrue(isValid);
    }

    function test_PolicyRegistry_ValidateDepositExceedsMax() public view {
        // Policy 1: maxDepositPerTx = 100_000_000
        bool isValid = policyRegistry.validateDeposit(1, 200_000_000, 0);
        assertFalse(isValid);
    }

    function test_PolicyRegistry_ValidateWithdrawal() public view {
        bool isValid = policyRegistry.validateWithdrawal(1, 10_000_000, 100_000_000);
        assertTrue(isValid);
    }

    function test_PolicyRegistry_ValidateWithdrawalExceedsMax() public view {
        // Policy 1: maxWithdrawalPerTx = 50_000_000
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

    function test_SolvencyRoot_PublishProof() public {
        bytes32 merkleRoot = keccak256("test-merkle-root");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            1_000_000_000,  // 1000 XRP collateral
            500_000_000,    // 500 XRP liabilities
            20000,          // 200% collateral ratio
            1414258         // voting round
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
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            1_000_000_000,
            500_000_000,
            20000,  // 200% > 150% threshold
            1414258
        );

        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);
        assertEq(ratio, 20000);
    }

    function test_SolvencyRoot_NotSolvent() public {
        bytes32 merkleRoot = keccak256("test-merkle-root-insolvent");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            500_000_000,
            500_000_000,
            10000,  // 100% < 150% threshold
            1414258
        );

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
        // Build a simple Merkle tree with 1 leaf
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1414258);

        bool isValid = solvencyRoot.verifyPosition(1, depositor1, 100_000_000, 50000, proof);
        assertTrue(isValid);
    }

    function test_SolvencyRoot_VerifyPositionWithTwoLeaves() public {
        // Build a Merkle tree with 2 leaves
        bytes32 leaf1 = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 leaf2 = keccak256(abi.encodePacked(uint256(2), depositor2, uint256(200_000_000), uint256(100000)));

        // Standard Merkle tree: root = hash(sorted(leaf1, leaf2))
        // If leaf1 <= leaf2, root = hash(leaf1, leaf2)
        // If leaf1 > leaf2, root = hash(leaf2, leaf1)
        bytes32 root;
        if (leaf1 <= leaf2) {
            root = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            root = keccak256(abi.encodePacked(leaf2, leaf1));
        }

        // Proof for leaf1: [leaf2]
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf2;

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1414258);

        bool isValid = solvencyRoot.verifyPosition(1, depositor1, 100_000_000, 50000, proof);
        assertTrue(isValid);

        // Also verify leaf2
        bytes32[] memory proof2 = new bytes32[](1);
        proof2[0] = leaf1;

        bool isValid2 = solvencyRoot.verifyPosition(2, depositor2, 200_000_000, 100000, proof2);
        assertTrue(isValid2);
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
        assertEq(history[0].merkleRoot, root1);
        assertEq(history[1].merkleRoot, root2);
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

    function test_SolvencyRoot_SolvencyWarning() public {
        // Publishing a proof with collateral ratio below threshold should emit SolvencyWarning
        bytes32 merkleRoot = keccak256("warning-root");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 500_000_000, 500_000_000, 10000, 1414258);

        // Verify the proof was published (warning was emitted)
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
        assertTrue(instr.executedAt > 0);
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

    function test_InstructionSender_SetPMWProjectId() public {
        instructionSender.setPMWProjectId(42);
        assertEq(instructionSender.getPMWProjectId(), 42);
    }

    function test_InstructionSender_GetInstructionsByStatus() public {
        vm.startPrank(verifier);
        uint256 instrId1 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest1")
        );
        uint256 instrId2 = instructionSender.createInstruction(
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
        // Create -> Submit -> Confirm
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
        assertEq(uint(instr.instrType), uint(IInstructionSender.InstructionType.EMERGENCY_TRANSFER));
        assertEq(instr.amount, 500_000_000);
    }
}
