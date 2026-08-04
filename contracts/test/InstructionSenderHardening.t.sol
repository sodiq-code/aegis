// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/InstructionSender.sol";
import "../src/interfaces/vault/IInstructionSender.sol";
import "../src/interfaces/vault/IVerifierRole.sol";

/// @title InstructionSenderHardening
/// @notice hardening: edge-case and fuzz tests for InstructionSender.
/// Covers instruction lifecycle edge cases, status transition invariants,
/// cancellation/failure constraints, and access control.
contract InstructionSenderHardening is Test {
    VerifierRole public verifierRole;
    InstructionSender public instructionSender;

    address public admin;
    address public verifier;
    address public verifier2;
    address public nonVerifier;
    address public depositor;

    bytes32 constant TEE_IDENTITY = keccak256("test-tee");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        verifier2 = makeAddr("verifier2");
        nonVerifier = makeAddr("nonVerifier");
        depositor = makeAddr("depositor");

        verifierRole = new VerifierRole();
        instructionSender = new InstructionSender(address(verifierRole));

        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier2);
        verifierRole.registerVerifier(verifier2, keccak256("tee2"));
    }

    // ═══════════════════════════════════════════════════════════════════
    // CREATE INSTRUCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Create_ZeroAmountReverts() public {
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: zero amount");
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 0, makeAddr("dest")
        );
    }

    function test_Create_ZeroDestinationReverts() public {
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: zero destination");
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100, address(0)
        );
    }

    function test_Create_NonVerifierReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100, makeAddr("dest")
        );
    }

    function test_Create_AllInstructionTypes() public {
        IInstructionSender.InstructionType[4] memory types = [
            IInstructionSender.InstructionType.PAYMENT,
            IInstructionSender.InstructionType.REBALANCE,
            IInstructionSender.InstructionType.REDEEM,
            IInstructionSender.InstructionType.EMERGENCY_TRANSFER
        ];

        for (uint256 i = 0; i < types.length; i++) {
            vm.prank(verifier);
            uint256 id = instructionSender.createInstruction(
                types[i], i + 1, (i + 1) * 100_000_000, makeAddr("dest")
            );
            assertEq(id, i + 1);
        }

        assertEq(instructionSender.getInstructionCount(), 4);
    }

    function testFuzz_Create_VariousAmounts(uint128 amount) public {
        vm.assume(amount > 0);

        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, uint256(amount), makeAddr("dest")
        );

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(instr.amount, uint256(amount));
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.PENDING));
    }

    function testFuzz_Create_VariousPositions(uint128 positionId) public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, uint256(positionId), 100_000_000, makeAddr("dest")
        );

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(instr.positionId, uint256(positionId));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUBMIT INSTRUCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Submit_NonPendingReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        // Submit once
        vm.prank(verifier);
        instructionSender.submitInstruction(id);

        // Submit again should revert
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: not pending");
        instructionSender.submitInstruction(id);
    }

    function test_Submit_NonExistentReverts() public {
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: not found");
        instructionSender.submitInstruction(99);
    }

    function test_Submit_NonVerifierReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.submitInstruction(id);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONFIRM INSTRUCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Confirm_NotSubmittedReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        // Pending instruction cannot be confirmed
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: not submitted");
        instructionSender.confirmInstruction(id, keccak256("tx"));
    }

    function test_Confirm_ZeroTxHashReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        vm.prank(verifier);
        instructionSender.submitInstruction(id);

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: zero tx hash");
        instructionSender.confirmInstruction(id, bytes32(0));
    }

    function test_Confirm_NonExistentReverts() public {
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: not found");
        instructionSender.confirmInstruction(99, keccak256("tx"));
    }

    function test_Confirm_NonVerifierReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        vm.prank(verifier);
        instructionSender.submitInstruction(id);

        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.confirmInstruction(id, keccak256("tx"));
    }

    function test_Confirm_AlreadyConfirmedReverts() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        instructionSender.confirmInstruction(id, keccak256("tx1"));

        vm.expectRevert("InstructionSender: not submitted");
        instructionSender.confirmInstruction(id, keccak256("tx2"));
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════
    // CANCEL INSTRUCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Cancel_PendingInstruction() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        vm.prank(verifier);
        instructionSender.cancelInstruction(id, "no longer needed");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CANCELLED));
    }

    function test_Cancel_SubmittedInstruction() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        vm.stopPrank();

        vm.prank(verifier);
        instructionSender.cancelInstruction(id, "PMW timeout");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CANCELLED));
    }

    function test_Cancel_ConfirmedInstructionReverts() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        instructionSender.confirmInstruction(id, keccak256("tx"));
        vm.stopPrank();

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: cannot cancel");
        instructionSender.cancelInstruction(id, "too late");
    }

    function test_Cancel_AlreadyCancelledReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        vm.prank(verifier);
        instructionSender.cancelInstruction(id, "first cancel");

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: cannot cancel");
        instructionSender.cancelInstruction(id, "double cancel");
    }

    function test_Cancel_NonExistentReverts() public {
        vm.prank(verifier);
        vm.expectRevert("InstructionSender: not found");
        instructionSender.cancelInstruction(99, "hack");
    }

    // ═══════════════════════════════════════════════════════════════════
    // FAIL INSTRUCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Fail_PendingInstruction() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        vm.prank(verifier);
        instructionSender.failInstruction(id, "TEE crashed");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.FAILED));
    }

    function test_Fail_SubmittedInstruction() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        vm.stopPrank();

        vm.prank(verifier);
        instructionSender.failInstruction(id, "XRPL rejection");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.FAILED));
    }

    function test_Fail_ConfirmedInstructionReverts() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );
        instructionSender.submitInstruction(id);
        instructionSender.confirmInstruction(id, keccak256("tx"));
        vm.stopPrank();

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: cannot fail");
        instructionSender.failInstruction(id, "too late");
    }

    function test_Fail_AlreadyFailedReverts() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        vm.prank(verifier);
        instructionSender.failInstruction(id, "first fail");

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: cannot fail");
        instructionSender.failInstruction(id, "double fail");
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATUS TRANSITION INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_CreatedStatusIsPending() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.PENDING));
    }

    function test_Invariant_FullLifecycleStatusTransitions() public {
        vm.startPrank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE, 1, 100_000_000, makeAddr("dest")
        );

        // PENDING → SUBMITTED
        instructionSender.submitInstruction(id);
        assertEq(uint(instructionSender.getInstruction(id).status), uint(IInstructionSender.InstructionStatus.SUBMITTED));

        // SUBMITTED → CONFIRMED
        instructionSender.confirmInstruction(id, keccak256("xrpl-tx"));
        assertEq(uint(instructionSender.getInstruction(id).status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        vm.stopPrank();
    }

    function test_Invariant_CancelAndFailAreTerminal() public {
        // Cancelled instruction cannot transition further
        vm.prank(verifier);
        uint256 id1 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest1")
        );
        vm.prank(verifier);
        instructionSender.cancelInstruction(id1, "cancel");
        assertEq(uint(instructionSender.getInstruction(id1).status), uint(IInstructionSender.InstructionStatus.CANCELLED));

        // Failed instruction cannot transition further
        vm.prank(verifier);
        uint256 id2 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 2, 200_000_000, makeAddr("dest2")
        );
        vm.prank(verifier);
        instructionSender.failInstruction(id2, "fail");
        assertEq(uint(instructionSender.getInstruction(id2).status), uint(IInstructionSender.InstructionStatus.FAILED));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SEND INSTRUCTION (ABI-ENCODED) EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_SendInstruction_ZeroAmountReverts() public {
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType.PAYMENT,
            uint256(1),
            uint256(0),
            makeAddr("dest")
        );

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: zero amount");
        instructionSender.sendInstruction(payload);
    }

    function test_SendInstruction_ZeroDestinationReverts() public {
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType.PAYMENT,
            uint256(1),
            uint256(100_000_000),
            address(0)
        );

        vm.prank(verifier);
        vm.expectRevert("InstructionSender: zero destination");
        instructionSender.sendInstruction(payload);
    }

    function test_SendInstruction_NonVerifierReverts() public {
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType.PAYMENT,
            uint256(1),
            uint256(100_000_000),
            makeAddr("dest")
        );

        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.sendInstruction(payload);
    }

    function test_SendInstruction_StatusIsSubmitted() public {
        bytes memory payload = abi.encode(
            IInstructionSender.InstructionType.REBALANCE,
            uint256(1),
            uint256(100_000_000),
            makeAddr("dest")
        );

        vm.prank(verifier);
        instructionSender.sendInstruction(payload);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(1);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.SUBMITTED));
    }

    // ═══════════════════════════════════════════════════════════════════
    // PMW PROJECT ID EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_SetPMWProjectId_NonAdminReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not admin");
        instructionSender.setPMWProjectId(42);
    }

    function testFuzz_SetPMWProjectId(uint256 projectId) public {
        instructionSender.setPMWProjectId(projectId);
        assertEq(instructionSender.getPMWProjectId(), projectId);
    }

    // ═══════════════════════════════════════════════════════════════════
    // RESPONSE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_GetResponse_NoResponseSet() public view {
        bytes memory response = instructionSender.getResponse(keccak256("no-such-instruction"));
        assertEq(response.length, 0);
    }

    function test_SetResponse_NonVerifierReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.setResponse(keccak256("id"), "response");
    }

    // ═══════════════════════════════════════════════════════════════════
    // GET INSTRUCTIONS BY STATUS EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_GetInstructionsByStatus_EmptyStatus() public view {
        IInstructionSender.Instruction[] memory confirmed =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.CONFIRMED);
        assertEq(confirmed.length, 0);
    }

    function test_GetInstructionsByStatus_AfterCascadingOperations() public {
        // Create 3 instructions: one will be cancelled, one confirmed, one stays pending
        vm.startPrank(verifier);
        uint256 id1 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest1")
        );
        uint256 id2 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REBALANCE, 2, 200_000_000, makeAddr("dest2")
        );
        uint256 id3 = instructionSender.createInstruction(
            IInstructionSender.InstructionType.REDEEM, 3, 300_000_000, makeAddr("dest3")
        );
        vm.stopPrank();

        // Cancel id1
        vm.prank(verifier);
        instructionSender.cancelInstruction(id1, "cancel");

        // Confirm id2
        vm.prank(verifier);
        instructionSender.submitInstruction(id2);
        vm.prank(verifier);
        instructionSender.confirmInstruction(id2, keccak256("tx"));

        // id3 stays pending

        IInstructionSender.Instruction[] memory pending =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.PENDING);
        assertEq(pending.length, 1);
        assertEq(pending[0].instructionId, id3);

        IInstructionSender.Instruction[] memory confirmed =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.CONFIRMED);
        assertEq(confirmed.length, 1);
        assertEq(confirmed[0].instructionId, id2);

        IInstructionSender.Instruction[] memory cancelled =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.CANCELLED);
        assertEq(cancelled.length, 1);
        assertEq(cancelled[0].instructionId, id1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MULTI-VERIFIER INTERACTION
    // ═══════════════════════════════════════════════════════════════════

    function test_MultiVerifier_DifferentVerifiersCreateAndConfirm() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        // Different verifier can submit
        vm.prank(verifier2);
        instructionSender.submitInstruction(id);

        // And confirm
        vm.prank(verifier);
        instructionSender.confirmInstruction(id, keccak256("tx"));

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
    }

    function test_MultiVerifier_CrossVerifierCancel() public {
        vm.prank(verifier);
        uint256 id = instructionSender.createInstruction(
            IInstructionSender.InstructionType.PAYMENT, 1, 100_000_000, makeAddr("dest")
        );

        // Different verifier can cancel
        vm.prank(verifier2);
        instructionSender.cancelInstruction(id, "cross-verifier cancel");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(id);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CANCELLED));
    }
}
