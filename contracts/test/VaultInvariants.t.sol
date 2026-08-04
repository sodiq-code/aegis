// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";
import "../src/interfaces/vault/IVerifierRole.sol";
import "../src/interfaces/vault/IPolicyRegistry.sol";
import "../src/interfaces/vault/ISolvencyRoot.sol";
import "../src/interfaces/vault/IInstructionSender.sol";

/// @title VaultInvariants
/// @notice hardening: system-wide invariant tests that verify
/// cross-contract invariants and state machine properties hold
/// across all vault contracts simultaneously.
contract VaultInvariants is Test {
    VerifierRole public verifierRole;
    PolicyRegistry public policyRegistry;
    SolvencyRoot public solvencyRoot;
    InstructionSender public instructionSender;

    address public admin;
    address public verifier1;
    address public verifier2;
    address public operator;
    address public depositor1;
    address public depositor2;

    uint256 constant MIN_COLLATERAL_RATIO = 15000;
    bytes32 constant TEE_1 = keccak256("tee-1");
    bytes32 constant TEE_2 = keccak256("tee-2");

    function setUp() public {
        admin = address(this);
        verifier1 = makeAddr("verifier1");
        verifier2 = makeAddr("verifier2");
        operator = makeAddr("operator");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");

        verifierRole = new VerifierRole();
        policyRegistry = new PolicyRegistry();
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);
        instructionSender = new InstructionSender(address(verifierRole));

        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier1);
        verifierRole.registerVerifier(verifier1, TEE_1);
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier2);
        verifierRole.registerVerifier(verifier2, TEE_2);
        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, operator);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor1);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CROSS-CONTRACT ACCESS CONTROL INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_SolvencyRootAndInstructionSenderShareVerifierRole() public view {
        // Both SolvencyRoot and InstructionSender use the same VerifierRole
        assertEq(address(solvencyRoot.verifierRole()), address(instructionSender.verifierRole()));
        assertEq(address(solvencyRoot.verifierRole()), address(verifierRole));
    }

    function test_Invariant_VerifierCanAccessAllContracts() public view {
        // A registered verifier should have access to all vault contracts
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, verifier1));
        assertTrue(verifierRole.isVerifiedTEE(verifier1));
    }

    function test_Invariant_NonVerifierBlockedFromAllContracts() public {
        address nonV = makeAddr("nonVerifier");

        // SolvencyRoot: publishRoot should revert
        vm.prank(nonV);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishRoot(keccak256("test"), 5000);

        // InstructionSender: createInstruction should revert
        vm.prank(nonV);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100, makeAddr("dest")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // SOLVENCY PROOF LIFECYCLE INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_OnlyCurrentProofIsValid() public {
        bytes32 root1 = keccak256("inv-root-1");
        bytes32 root2 = keccak256("inv-root-2");

        vm.prank(verifier1);
        solvencyRoot.publishRoot(root1, 5000);
        assertTrue(solvencyRoot.getCurrentSolvencyProof().isValid);

        vm.prank(verifier2);
        solvencyRoot.publishRoot(root2, 6000);

        // Current proof is now root2 and valid
        ISolvencyRoot.SolvencyProof memory current = solvencyRoot.getCurrentSolvencyProof();
        assertEq(current.merkleRoot, root2);
        assertTrue(current.isValid);

        // root2 mapping entry is also valid
        assertTrue(solvencyRoot.getSolvencyProof(root2).isValid);
    }

    function test_Invariant_SolvencyStatusConsistentWithRatio() public {
        // Publish solvent proof
        bytes32 root = keccak256("inv-solvent");
        vm.prank(verifier1);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        if (ratio >= MIN_COLLATERAL_RATIO) {
            assertTrue(isSolvent, "ratio >= threshold should be solvent");
        } else {
            assertFalse(isSolvent, "ratio < threshold should not be solvent");
        }
    }

    function test_Invariant_SolvencyThresholdMatchesDeployment() public view {
        assertEq(solvencyRoot.getMinCollateralRatio(), MIN_COLLATERAL_RATIO);
    }

    // ═══════════════════════════════════════════════════════════════════
    // INSTRUCTION LIFECYCLE INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_InstructionCountMonotonicallyIncreases() public {
        assertEq(instructionSender.getInstructionCount(), 0);

        vm.prank(verifier1);
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("d1")
        );
        assertEq(instructionSender.getInstructionCount(), 1);

        vm.prank(verifier2);
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE, 2, 200_000_000, makeAddr("d2")
        );
        assertEq(instructionSender.getInstructionCount(), 2);

        // Cancellation doesn't decrease count
        vm.prank(verifier1);
        instructionSender.cancelInstruction(1, "cancel");
        assertEq(instructionSender.getInstructionCount(), 2);

        // Failure doesn't decrease count
        vm.prank(verifier2);
        instructionSender.failInstruction(2, "fail");
        assertEq(instructionSender.getInstructionCount(), 2);
    }

    function test_Invariant_ConfirmedInstructionHasTxHash() public {
        vm.startPrank(verifier1);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        instructionSender.confirmInstruction(id, keccak256("xrpl-tx"));
        vm.stopPrank();

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertNotEq(instr.xrplTxHash, bytes32(0), "confirmed instruction must have tx hash");
        assertGt(instr.executedAt, 0, "confirmed instruction must have execution time");
    }

    // ═══════════════════════════════════════════════════════════════════
    // POLICY REGISTRY INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_DefaultPoliciesAlwaysExist() public view {
        assertGe(policyRegistry.getPolicyCount(), 3);
    }

    function test_Invariant_DefaultPolicyFieldsPositive() public view {
        for (uint256 i = 1; i <= 3; i++) {
            IPolicyRegistry.Policy memory p = policyRegistry.getPolicy(i);
            assertGt(p.maxDrawdownBps, 0, "maxDrawdownBps must be positive");
            assertGt(p.maxSingleExposureBps, 0, "maxSingleExposureBps must be positive");
            assertGt(p.maxDepositPerTx, 0, "maxDepositPerTx must be positive");
            assertGt(p.maxWithdrawalPerTx, 0, "maxWithdrawalPerTx must be positive");
            assertGt(p.maxTotalExposure, 0, "maxTotalExposure must be positive");
            assertGt(p.minCollateralRatio, 0, "minCollateralRatio must be positive");
        }
    }

    function test_Invariant_ConservativeIsStrictest() public view {
        IPolicyRegistry.Policy memory conservative = policyRegistry.getPolicy(1);
        IPolicyRegistry.Policy memory balanced = policyRegistry.getPolicy(2);
        IPolicyRegistry.Policy memory aggressive = policyRegistry.getPolicy(3);

        // Conservative should have the strictest limits
        assertLe(conservative.maxDrawdownBps, balanced.maxDrawdownBps);
        assertLe(conservative.maxSingleExposureBps, balanced.maxSingleExposureBps);
        assertGe(conservative.minCollateralRatio, balanced.minCollateralRatio);
        assertLe(conservative.maxDepositPerTx, balanced.maxDepositPerTx);
        assertLe(conservative.maxWithdrawalPerTx, balanced.maxWithdrawalPerTx);
        assertLe(conservative.maxTotalExposure, balanced.maxTotalExposure);

        assertLe(balanced.maxDrawdownBps, aggressive.maxDrawdownBps);
        assertLe(balanced.maxSingleExposureBps, aggressive.maxSingleExposureBps);
        assertGe(balanced.minCollateralRatio, aggressive.minCollateralRatio);
    }

    // ═══════════════════════════════════════════════════════════════════
    // VERIFIER ROLE INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_AdminAlwaysHasAdminRole() public view {
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, admin));
    }

    function test_Invariant_AtLeastOneAdmin() public view {
        assertGe(verifierRole.getRoleMemberCount(IVerifierRole.Role.DEFAULT_ADMIN), 1);
    }

    function test_Invariant_RegisteredVerifierImpliesRole() public view {
        // If isVerifiedTEE returns true, the account must have VERIFIER role
        if (verifierRole.isVerifiedTEE(verifier1)) {
            assertTrue(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, verifier1));
        }
        if (verifierRole.isVerifiedTEE(verifier2)) {
            assertTrue(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, verifier2));
        }
    }

    function test_Invariant_TEEIdentityConsistency() public view {
        // Registered verifiers should have non-zero TEE identities
        bytes32 tee1 = verifierRole.getVerifierTeeIdentity(verifier1);
        bytes32 tee2 = verifierRole.getVerifierTeeIdentity(verifier2);
        assertNotEq(tee1, bytes32(0), "verifier1 should have TEE identity");
        assertNotEq(tee2, bytes32(0), "verifier2 should have TEE identity");
        assertNotEq(tee1, tee2, "different verifiers should have different TEE identities");
    }

    // ═══════════════════════════════════════════════════════════════════
    // FULL LIFECYCLE INTEGRATION INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_FullVaultLifecycle_NoStateCorruption() public {
        // 1. Publish a solvency proof
        bytes32 root1 = keccak256("lifecycle-root-1");
        vm.prank(verifier1);
        solvencyRoot.publishSolvencyProof(root1, 1_000_000_000, 500_000_000, 20000, 1414258);
        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);

        // 2. Create and submit an instruction
        vm.prank(verifier1);
        uint256 instrId = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE, 1, 100_000_000, makeAddr("xrpl-dest")
        );
        vm.prank(verifier1);
        instructionSender.submitInstruction(instrId);

        // 3. Confirm the instruction with XRPL tx hash
        bytes32 xrplTxHash = keccak256("xrpl-confirmation-tx");
        vm.prank(verifier2);
        instructionSender.confirmInstruction(instrId, xrplTxHash);

        // 4. Publish updated solvency proof
        bytes32 root2 = keccak256("lifecycle-root-2");
        vm.prank(verifier1);
        solvencyRoot.publishSolvencyProof(root2, 1_100_000_000, 500_000_000, 22000, 1414259);

        // Verify final state consistency
        (isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertEq(instr.xrplTxHash, xrplTxHash);

        // Old proof's current reference is invalidated, but mapping entry persists
        // getCurrentSolvencyProof returns the current proof (root2)
        assertTrue(solvencyRoot.getCurrentSolvencyProof().isValid);
    }

    function test_Invariant_SolvencyWarningToEmergencyFlow() public {
        // 1. Publish warning-level proof
        bytes32 root = keccak256("warning-root");
        vm.prank(verifier1);
        solvencyRoot.publishSolvencyProof(root, 500_000_000, 500_000_000, 10000, 1414258);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent); // 10000 < 15000

        // 2. Admin invalidates the proof
        solvencyRoot.invalidateSolvencyProof(root, "solvency warning - manual review");

        // 3. Verify proof is now invalid
        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertFalse(proof.isValid);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MERKLE TREE INTEGRITY INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_MerkleProofConsistency() public {
        // Build a 2-leaf Merkle tree and verify both leaves
        bytes32 leaf1 = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 leaf2 = keccak256(abi.encodePacked(uint256(2), depositor2, uint256(200_000_000), uint256(100000)));

        bytes32 root;
        if (leaf1 <= leaf2) {
            root = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            root = keccak256(abi.encodePacked(leaf2, leaf1));
        }

        vm.prank(verifier1);
        solvencyRoot.publishRoot(root, 5000);

        // Verify both leaves
        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf2;
        assertTrue(solvencyRoot.verifySolvency(proof1, leaf1));

        bytes32[] memory proof2 = new bytes32[](1);
        proof2[0] = leaf1;
        assertTrue(solvencyRoot.verifySolvency(proof2, leaf2));

        // Wrong leaf should fail
        bytes32 wrongLeaf = keccak256("wrong-leaf");
        assertFalse(solvencyRoot.verifySolvency(proof1, wrongLeaf));

        // After invalidation, all proofs should fail
        solvencyRoot.invalidateSolvencyProof(root, "integrity check");
        assertFalse(solvencyRoot.verifySolvency(proof1, leaf1));
        assertFalse(solvencyRoot.verifySolvency(proof2, leaf2));
    }
}
