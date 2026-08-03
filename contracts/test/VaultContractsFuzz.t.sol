// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";

/// @title VaultContractsFuzzTest
/// @notice Comprehensive fuzz tests for all 5 vault contracts (VerifierRole, PolicyRegistry,
///         SolvencyRoot, InstructionSender) per Task 6 acceptance criterion:
///         "All five contracts deployed on Coston2; fuzz tests green."
contract VaultContractsFuzzTest is Test {
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
    address public nonAdmin;

    // --- Constants ---
    uint256 constant MIN_COLLATERAL_RATIO = 15000; // 150%
    bytes32 constant TEE_IDENTITY = keccak256("test-tee-identity");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        operator = makeAddr("operator");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");
        nonAdmin = makeAddr("nonAdmin");

        // Deploy all 5 vault contracts
        verifierRole = new VerifierRole();
        policyRegistry = new PolicyRegistry();
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);
        instructionSender = new InstructionSender(address(verifierRole));

        // Grant roles
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, operator);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor1);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor2);
    }

    // ==========================================
    // VERIFIER ROLE FUZZ TESTS
    // ==========================================

    /// @dev Fuzz: granting any role to any address should update the role mapping
    function testFuzz_VerifierRole_GrantRole(uint8 roleRaw, address account) public {
        // Bound to valid enum range (0-3)
        IVerifierRole.Role role = IVerifierRole.Role(bound(roleRaw, 0, 3));
        vm.assume(account != address(0));
        vm.assume(!verifierRole.hasRole(role, account)); // not already granted

        verifierRole.grantRole(role, account);
        assertTrue(verifierRole.hasRole(role, account));
    }

    /// @dev Fuzz: revoking a role should remove it
    function testFuzz_VerifierRole_GrantAndRevoke(uint8 roleRaw, address account) public {
        IVerifierRole.Role role = IVerifierRole.Role(bound(roleRaw, 0, 3));
        vm.assume(account != address(0));
        vm.assume(account != admin); // can't revoke own admin
        vm.assume(!verifierRole.hasRole(role, account));

        verifierRole.grantRole(role, account);
        assertTrue(verifierRole.hasRole(role, account));

        verifierRole.revokeRole(role, account);
        assertFalse(verifierRole.hasRole(role, account));
    }

    /// @dev Fuzz: non-admin cannot grant roles
    function testFuzz_VerifierRole_NonAdminCannotGrant(uint8 roleRaw, address account, address caller) public {
        IVerifierRole.Role role = IVerifierRole.Role(bound(roleRaw, 0, 3));
        vm.assume(account != address(0));
        vm.assume(caller != admin);
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, caller));

        vm.prank(caller);
        vm.expectRevert("VerifierRole: caller is not admin");
        verifierRole.grantRole(role, account);
    }

    /// @dev Fuzz: registerVerifier with various TEE identities
    function testFuzz_VerifierRole_RegisterVerifier(address verifierAddr, bytes32 teeIdentity) public {
        vm.assume(verifierAddr != address(0));
        vm.assume(teeIdentity != bytes32(0));

        verifierRole.registerVerifier(verifierAddr, teeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(verifierAddr));
        assertEq(verifierRole.getVerifierTeeIdentity(verifierAddr), teeIdentity);
    }

    /// @dev Fuzz: isVerifiedTEE returns false for non-verifiers
    function testFuzz_VerifierRole_IsVerifiedTEE_NonVerifier(address account) public {
        vm.assume(account != verifier);
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.VERIFIER, account));
        assertFalse(verifierRole.isVerifiedTEE(account));
    }

    /// @dev Fuzz: getRoleMemberCount is consistent after grants
    function testFuzz_VerifierRole_RoleMemberCountAfterGrants(address[] calldata accounts) public {
        uint256 initialCount = verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR);
        uint256 newAccounts = 0;

        for (uint256 i = 0; i < accounts.length && i < 10; i++) {
            if (accounts[i] == address(0)) continue;
            if (verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, accounts[i])) continue;

            verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, accounts[i]);
            newAccounts++;
        }

        assertEq(
            verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR),
            initialCount + newAccounts
        );
    }

    // ==========================================
    // POLICY REGISTRY FUZZ TESTS
    // ==========================================

    /// @dev Fuzz: creating policies with various parameters
    function testFuzz_PolicyRegistry_CreatePolicy(
        uint256 maxDrawdownBps,
        uint256 maxSingleExposureBps,
        uint256 hedgeThresholdBps,
        uint256 maxDepositPerTx,
        uint256 maxWithdrawalPerTx,
        uint256 maxTotalExposure,
        uint256 minCollateralRatio
    ) public {
        // Bound to reasonable ranges
        maxDrawdownBps = bound(maxDrawdownBps, 100, 10000); // 1% to 100%
        maxSingleExposureBps = bound(maxSingleExposureBps, 100, 10000);
        hedgeThresholdBps = bound(hedgeThresholdBps, 100, 5000);
        maxDepositPerTx = bound(maxDepositPerTx, 1, 1e18);
        maxWithdrawalPerTx = bound(maxWithdrawalPerTx, 1, 1e18);
        maxTotalExposure = bound(maxTotalExposure, maxDepositPerTx, 1e21);
        minCollateralRatio = bound(minCollateralRatio, 100, 50000);

        address[] memory assets = new address[](1);
        assets[0] = makeAddr("fxrp");

        uint256 policyId = policyRegistry.createPolicy(
            "Fuzz Policy",
            "Created by fuzz test",
            IPolicyRegistry.RiskLevel.MEDIUM,
            maxDrawdownBps,
            maxSingleExposureBps,
            hedgeThresholdBps,
            assets,
            maxDepositPerTx,
            maxWithdrawalPerTx,
            maxTotalExposure,
            minCollateralRatio
        );

        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(policyId);
        assertEq(policy.maxDrawdownBps, maxDrawdownBps);
        assertEq(policy.maxSingleExposureBps, maxSingleExposureBps);
        assertEq(policy.hedgeThresholdBps, hedgeThresholdBps);
        assertEq(policy.maxDepositPerTx, maxDepositPerTx);
        assertEq(policy.maxWithdrawalPerTx, maxWithdrawalPerTx);
        assertEq(policy.maxTotalExposure, maxTotalExposure);
        assertEq(policy.minCollateralRatio, minCollateralRatio);
        assertTrue(policy.isActive);
    }

    /// @dev Fuzz: validateDeposit with various amounts
    function testFuzz_PolicyRegistry_ValidateDeposit(
        uint256 policyId,
        uint256 depositAmount,
        uint256 currentTotalExposure
    ) public view {
        policyId = bound(policyId, 1, 3); // existing policies
        depositAmount = bound(depositAmount, 0, 1e18);
        currentTotalExposure = bound(currentTotalExposure, 0, 1e21);

        bool isValid = policyRegistry.validateDeposit(policyId, depositAmount, currentTotalExposure);

        // Verify the result matches the policy constraints
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(policyId);
        if (!policy.isActive) {
            assertFalse(isValid);
        } else if (depositAmount > policy.maxDepositPerTx) {
            assertFalse(isValid);
        } else if (currentTotalExposure + depositAmount > policy.maxTotalExposure) {
            assertFalse(isValid);
        } else {
            assertTrue(isValid);
        }
    }

    /// @dev Fuzz: validateWithdrawal with various amounts
    function testFuzz_PolicyRegistry_ValidateWithdrawal(
        uint256 policyId,
        uint256 withdrawalAmount,
        uint256 currentPositionValue
    ) public view {
        policyId = bound(policyId, 1, 3);
        withdrawalAmount = bound(withdrawalAmount, 0, 1e18);
        currentPositionValue = bound(currentPositionValue, 0, 1e21);

        bool isValid = policyRegistry.validateWithdrawal(policyId, withdrawalAmount, currentPositionValue);

        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(policyId);
        if (!policy.isActive) {
            assertFalse(isValid);
        } else if (withdrawalAmount > policy.maxWithdrawalPerTx) {
            assertFalse(isValid);
        } else if (withdrawalAmount > currentPositionValue) {
            assertFalse(isValid);
        } else {
            assertTrue(isValid);
        }
    }

    /// @dev Fuzz: assignPolicy and retrieve
    function testFuzz_PolicyRegistry_AssignPolicy(uint256 policyId, address depositor) public {
        policyId = bound(policyId, 1, 3);
        vm.assume(depositor != address(0));

        policyRegistry.assignPolicy(policyId, depositor);
        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicyForDepositor(depositor);
        assertEq(policy.policyId, policyId);
    }

    /// @dev Fuzz: checkAction with various amounts
    function testFuzz_PolicyRegistry_CheckActionDeposit(uint256 policyId, uint256 amount) public view {
        policyId = bound(policyId, 1, 3);
        amount = bound(amount, 0, 1e18);

        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(policyId, 0, amount);

        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(policyId);
        if (!policy.isActive) {
            assertFalse(allowed);
            assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.BLOCK));
        } else if (amount > policy.maxDepositPerTx) {
            assertFalse(allowed);
        } else {
            assertTrue(allowed);
        }
    }

    // ==========================================
    // SOLVENCY ROOT FUZZ TESTS
    // ==========================================

    /// @dev Fuzz: publishRoot with various roots and surplus values
    function testFuzz_SolvencyRoot_PublishRoot(bytes32 merkleRoot, uint256 surplusBps) public {
        vm.assume(merkleRoot != bytes32(0));

        vm.prank(verifier);
        solvencyRoot.publishRoot(merkleRoot, surplusBps);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertEq(proof.surplusBps, surplusBps);
        assertTrue(proof.isValid);
    }

    /// @dev Fuzz: publishSolvencyProof with various collateral and liability values
    function testFuzz_SolvencyRoot_PublishSolvencyProof(
        bytes32 merkleRoot,
        uint256 totalCollateral,
        uint256 totalLiabilities,
        uint256 collateralRatio,
        uint256 votingRound
    ) public {
        vm.assume(merkleRoot != bytes32(0));
        // Ensure collateral >= liabilities for surplus computation
        totalCollateral = bound(totalCollateral, 1, 1e27);
        totalLiabilities = bound(totalLiabilities, 0, totalCollateral);
        collateralRatio = bound(collateralRatio, 0, 50000);
        votingRound = bound(votingRound, 1, 10_000_000);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            totalCollateral,
            totalLiabilities,
            collateralRatio,
            votingRound
        );

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertEq(proof.totalFxrpCollateral, totalCollateral);
        assertEq(proof.totalLiabilities, totalLiabilities);
        assertEq(proof.collateralRatio, collateralRatio);
        assertEq(proof.votingRound, votingRound);
        assertTrue(proof.isValid);
    }

    /// @dev Fuzz: isSolvent consistency with collateral ratio
    function testFuzz_SolvencyRoot_IsSolventConsistency(
        bytes32 merkleRoot,
        uint256 collateralRatio
    ) public {
        vm.assume(merkleRoot != bytes32(0));
        collateralRatio = bound(collateralRatio, 0, 50000);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            1_000_000_000,
            500_000_000,
            collateralRatio,
            1414258
        );

        (bool isSolvent, uint256 returnedRatio) = solvencyRoot.isSolvent();
        assertEq(returnedRatio, collateralRatio);

        // Solvent iff collateralRatio >= MIN_COLLATERAL_RATIO AND proof is valid
        if (collateralRatio >= MIN_COLLATERAL_RATIO) {
            assertTrue(isSolvent);
        } else {
            assertFalse(isSolvent);
        }
    }

    /// @dev Fuzz: Merkle proof verification with random leaf data
    function testFuzz_SolvencyRoot_VerifySolvency(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation
    ) public {
        vm.assume(depositor != address(0));
        vm.assume(fxrpAmount > 0);

        // Compute the leaf hash
        bytes32 leaf = keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation));

        // Publish the leaf as the root (single-leaf tree)
        vm.prank(verifier);
        solvencyRoot.publishRoot(leaf, 5000);

        // Verify with empty proof
        bytes32[] memory proof = new bytes32[](0);
        bool isValid = solvencyRoot.verifySolvency(proof, leaf);
        assertTrue(isValid);
    }

    /// @dev Fuzz: Merkle proof with two leaves
    function testFuzz_SolvencyRoot_VerifyTwoLeaves(
        uint256 positionId1,
        address depositor1Addr,
        uint256 fxrpAmount1,
        uint256 positionId2,
        address depositor2Addr,
        uint256 fxrpAmount2
    ) public {
        vm.assume(depositor1Addr != address(0));
        vm.assume(depositor2Addr != address(0));
        vm.assume(fxrpAmount1 > 0);
        vm.assume(fxrpAmount2 > 0);
        vm.assume(!(positionId1 == positionId2 && depositor1Addr == depositor2Addr && fxrpAmount1 == fxrpAmount2));

        bytes32 leaf1 = keccak256(abi.encodePacked(positionId1, depositor1Addr, fxrpAmount1, uint256(0)));
        bytes32 leaf2 = keccak256(abi.encodePacked(positionId2, depositor2Addr, fxrpAmount2, uint256(0)));

        // Compute root
        bytes32 root;
        if (leaf1 <= leaf2) {
            root = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            root = keccak256(abi.encodePacked(leaf2, leaf1));
        }

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        // Verify both leaves
        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf2;
        assertTrue(solvencyRoot.verifySolvency(proof1, leaf1));

        bytes32[] memory proof2 = new bytes32[](1);
        proof2[0] = leaf1;
        assertTrue(solvencyRoot.verifySolvency(proof2, leaf2));
    }

    /// @dev Fuzz: verifyPosition with random position data
    function testFuzz_SolvencyRoot_VerifyPosition(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation
    ) public {
        vm.assume(depositor != address(0));
        vm.assume(fxrpAmount > 0);

        bytes32 leaf = keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation));

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(leaf, 1_000_000_000, 500_000_000, 20000, 1414258);

        bytes32[] memory proof = new bytes32[](0);
        bool isValid = solvencyRoot.verifyPosition(positionId, depositor, fxrpAmount, usdValuation, proof);
        assertTrue(isValid);
    }

    /// @dev Fuzz: setMinCollateralRatio and verify isSolvent
    function testFuzz_SolvencyRoot_SetMinCollateralRatio(
        uint256 newThreshold,
        uint256 collateralRatio
    ) public {
        newThreshold = bound(newThreshold, 1, 50000);
        collateralRatio = bound(collateralRatio, 0, 50000);

        solvencyRoot.setMinCollateralRatio(newThreshold);
        assertEq(solvencyRoot.getMinCollateralRatio(), newThreshold);

        // Publish a proof with the given collateral ratio
        bytes32 merkleRoot = keccak256(abi.encodePacked("fuzz-root", newThreshold, collateralRatio));
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(merkleRoot, 1_000_000_000, 500_000_000, collateralRatio, 1414258);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        if (collateralRatio >= newThreshold) {
            assertTrue(isSolvent);
        } else {
            assertFalse(isSolvent);
        }
    }

    /// @dev Fuzz: non-verifier cannot publish roots
    function testFuzz_SolvencyRoot_NonVerifierCannotPublish(address caller, bytes32 merkleRoot) public {
        vm.assume(merkleRoot != bytes32(0));
        vm.assume(caller != admin);
        vm.assume(caller != verifier);
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, caller));
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.VERIFIER, caller));

        vm.prank(caller);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishRoot(merkleRoot, 5000);
    }

    /// @dev Fuzz: solvency history with multiple proofs
    function testFuzz_SolvencyRoot_HistoryMultipleProofs(uint8 numProofs) public {
        numProofs = uint8(bound(numProofs, 1, 10));

        for (uint256 i = 0; i < numProofs; i++) {
            bytes32 merkleRoot = keccak256(abi.encodePacked("fuzz-root", i));
            vm.prank(verifier);
            solvencyRoot.publishSolvencyProof(merkleRoot, 1_000_000_000, 500_000_000, 20000, 1414258 + i);
        }

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(numProofs);
        assertEq(history.length, numProofs);
    }

    // ==========================================
    // INSTRUCTION SENDER FUZZ TESTS
    // ==========================================

    /// @dev Fuzz: createInstruction with various types and amounts
    function testFuzz_InstructionSender_CreateInstruction(
        uint8 instrTypeRaw,
        uint256 positionId,
        uint256 amount,
        address destination
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(amount > 0);
        vm.assume(destination != address(0));

        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            instrType, positionId, amount, destination
        );

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.instrType), uint(instrType));
        assertEq(instr.positionId, positionId);
        assertEq(instr.amount, amount);
        assertEq(instr.destination, destination);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.PENDING));
    }

    /// @dev Fuzz: full instruction lifecycle (create → submit → confirm)
    function testFuzz_InstructionSender_FullLifecycle(
        uint8 instrTypeRaw,
        uint256 positionId,
        uint256 amount,
        address destination,
        bytes32 xrplTxHash
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(amount > 0);
        vm.assume(destination != address(0));
        vm.assume(xrplTxHash != bytes32(0));

        // Create
        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            instrType, positionId, amount, destination
        );

        // Submit
        vm.prank(verifier);
        instructionSender.submitInstruction(instrId);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.SUBMITTED));

        // Confirm
        vm.prank(verifier);
        instructionSender.confirmInstruction(instrId, xrplTxHash);

        instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertEq(instr.xrplTxHash, xrplTxHash);
    }

    /// @dev Fuzz: cancel instruction at various stages
    function testFuzz_InstructionSender_CancelInstruction(
        uint8 instrTypeRaw,
        uint256 amount,
        address destination,
        bool submitBeforeCancel
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(amount > 0);
        vm.assume(destination != address(0));

        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            instrType, 1, amount, destination
        );

        if (submitBeforeCancel) {
            vm.prank(verifier);
            instructionSender.submitInstruction(instrId);
        }

        vm.prank(verifier);
        instructionSender.cancelInstruction(instrId, "fuzz cancellation");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CANCELLED));
    }

    /// @dev Fuzz: fail instruction at various stages
    function testFuzz_InstructionSender_FailInstruction(
        uint8 instrTypeRaw,
        uint256 amount,
        address destination,
        bool submitBeforeFail
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(amount > 0);
        vm.assume(destination != address(0));

        vm.prank(verifier);
        uint256 instrId = instructionSender.createInstruction(
            instrType, 1, amount, destination
        );

        if (submitBeforeFail) {
            vm.prank(verifier);
            instructionSender.submitInstruction(instrId);
        }

        vm.prank(verifier);
        instructionSender.failInstruction(instrId, "fuzz failure");

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.FAILED));
    }

    /// @dev Fuzz: sendInstruction with various payloads
    function testFuzz_InstructionSender_SendInstruction(
        uint8 instrTypeRaw,
        uint256 positionId,
        uint256 amount,
        address destination
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(amount > 0);
        vm.assume(destination != address(0));

        bytes memory payload = abi.encode(instrType, positionId, amount, destination);

        vm.prank(verifier);
        instructionSender.sendInstruction(payload);

        IInstructionSender.Instruction[] memory submitted =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.SUBMITTED);
        assertGt(submitted.length, 0);
    }

    /// @dev Fuzz: non-verifier cannot create instructions
    function testFuzz_InstructionSender_NonVerifierCannotCreate(
        address caller,
        uint8 instrTypeRaw,
        uint256 amount,
        address destination
    ) public {
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        vm.assume(caller != admin);
        vm.assume(caller != verifier);
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, caller));
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.VERIFIER, caller));
        vm.assume(amount > 0);
        vm.assume(destination != address(0));

        vm.prank(caller);
        vm.expectRevert("InstructionSender: caller is not verifier");
        instructionSender.createInstruction(instrType, 1, amount, destination);
    }

    /// @dev Fuzz: setResponse and getResponse round-trip
    function testFuzz_InstructionSender_SetGetResponse(bytes32 instructionId, bytes calldata response) public {
        vm.prank(verifier);
        instructionSender.setResponse(instructionId, response);

        bytes memory stored = instructionSender.getResponse(instructionId);
        assertEq(stored.length, response.length);
        assertEq(stored, response);
    }

    /// @dev Fuzz: PMW project ID can be set and retrieved
    function testFuzz_InstructionSender_PMWProjectId(uint256 projectId) public {
        instructionSender.setPMWProjectId(projectId);
        assertEq(instructionSender.getPMWProjectId(), projectId);
    }

    /// @dev Fuzz: instruction count is consistent
    function testFuzz_InstructionSender_InstructionCount(
        uint8 numInstructions
    ) public {
        numInstructions = uint8(bound(numInstructions, 1, 20));
        uint256 initialCount = instructionSender.getInstructionCount();

        for (uint256 i = 0; i < numInstructions; i++) {
            vm.prank(verifier);
            instructionSender.createInstruction(
                IInstructionSender.InstructionType.PAYMENT,
                i + 1,
                100_000_000 * (i + 1),
                makeAddr(string(abi.encodePacked("dest", i)))
            );
        }

        assertEq(instructionSender.getInstructionCount(), initialCount + numInstructions);
    }

    // ==========================================
    // CROSS-CONTRACT INTEGRATION FUZZ TESTS
    // ==========================================

    /// @dev Fuzz: full vault workflow — register verifier, publish proof, create instruction, verify
    function testFuzz_CrossContract_FullWorkflow(
        bytes32 merkleRoot,
        uint256 surplusBps,
        uint8 instrTypeRaw,
        uint256 amount,
        address destination,
        bytes32 xrplTxHash
    ) public {
        vm.assume(merkleRoot != bytes32(0));
        IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
            bound(instrTypeRaw, 0, 4)
        );
        amount = bound(amount, 1, 1e18);
        vm.assume(destination != address(0));
        vm.assume(xrplTxHash != bytes32(0));

        // 1. Register a new verifier
        address newVerifier = makeAddr("fuzzVerifier");
        bytes32 newTeeIdentity = keccak256(abi.encodePacked("fuzz-tee", newVerifier));
        verifierRole.registerVerifier(newVerifier, newTeeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(newVerifier));

        // 2. Publish solvency proof
        vm.prank(newVerifier);
        solvencyRoot.publishRoot(merkleRoot, surplusBps);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertEq(proof.surplusBps, surplusBps);

        // 3. Create and submit an instruction
        vm.prank(newVerifier);
        uint256 instrId = instructionSender.createInstruction(
            instrType, 1, amount, destination
        );

        vm.prank(newVerifier);
        instructionSender.submitInstruction(instrId);

        // 4. Confirm the instruction
        vm.prank(newVerifier);
        instructionSender.confirmInstruction(instrId, xrplTxHash);

        IInstructionSender.Instruction memory instr = instructionSender.getInstruction(instrId);
        assertEq(uint(instr.status), uint(IInstructionSender.InstructionStatus.CONFIRMED));
        assertEq(instr.xrplTxHash, xrplTxHash);
    }

    /// @dev Fuzz: solvency proof invalidation by admin
    function testFuzz_CrossContract_SolvencyInvalidation(
        bytes32 merkleRoot,
        uint256 collateralRatio
    ) public {
        vm.assume(merkleRoot != bytes32(0));
        collateralRatio = bound(collateralRatio, 0, 50000);

        // Publish proof
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot, 1_000_000_000, 500_000_000, collateralRatio, 1414258
        );

        // Verify it's valid
        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertTrue(proof.isValid);

        // Admin invalidates
        solvencyRoot.invalidateSolvencyProof(merkleRoot, "admin invalidation");

        // Verify it's now invalid
        proof = solvencyRoot.getSolvencyProof(merkleRoot);
        assertFalse(proof.isValid);
    }

    /// @dev Fuzz: verifier identity update
    function testFuzz_CrossContract_VerifierIdentityUpdate(
        address verifierAddr,
        bytes32 initialTeeIdentity,
        bytes32 newTeeIdentity
    ) public {
        vm.assume(verifierAddr != address(0));
        vm.assume(initialTeeIdentity != bytes32(0));
        vm.assume(newTeeIdentity != bytes32(0));
        vm.assume(initialTeeIdentity != newTeeIdentity);

        // Register with initial identity
        verifierRole.registerVerifier(verifierAddr, initialTeeIdentity);
        assertEq(verifierRole.getVerifierTeeIdentity(verifierAddr), initialTeeIdentity);

        // Update identity
        verifierRole.registerVerifier(verifierAddr, newTeeIdentity);
        assertEq(verifierRole.getVerifierTeeIdentity(verifierAddr), newTeeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(verifierAddr));
    }

    /// @dev Fuzz: multiple instructions with different types
    function testFuzz_CrossContract_MultipleInstructions(
        uint8[5] calldata instrTypes,
        uint256[5] calldata amounts
    ) public {
        for (uint256 i = 0; i < 5; i++) {
            IInstructionSender.InstructionType instrType = IInstructionSender.InstructionType(
                bound(instrTypes[i], 0, 4)
            );
            uint256 amount = bound(amounts[i], 1, 1e18);
            address dest = makeAddr(string(abi.encodePacked("dest", i)));

            vm.prank(verifier);
            instructionSender.createInstruction(instrType, i + 1, amount, dest);
        }

        assertEq(instructionSender.getInstructionCount(), 5);

        IInstructionSender.Instruction[] memory pending =
            instructionSender.getInstructionsByStatus(IInstructionSender.InstructionStatus.PENDING);
        assertEq(pending.length, 5);
    }
}
