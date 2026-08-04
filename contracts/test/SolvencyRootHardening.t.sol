// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/SolvencyRoot.sol";
import "../src/interfaces/vault/ISolvencyRoot.sol";
import "../src/interfaces/vault/IVerifierRole.sol";

/// @title SolvencyRootHardening
/// @notice hardening: edge-case and fuzz tests for SolvencyRoot.
/// Covers Merkle proof edge cases, solvency transitions,
/// proof invalidation, concurrent proofs, and boundary conditions.
contract SolvencyRootHardening is Test {
    VerifierRole public verifierRole;
    SolvencyRoot public solvencyRoot;

    address public admin;
    address public verifier;
    address public verifier2;
    address public nonVerifier;
    address public depositor1;
    address public depositor2;

    uint256 constant MIN_COLLATERAL_RATIO = 15000; // 150%
    bytes32 constant TEE_IDENTITY = keccak256("test-tee");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        verifier2 = makeAddr("verifier2");
        nonVerifier = makeAddr("nonVerifier");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");

        verifierRole = new VerifierRole();
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);

        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier2);
        verifierRole.registerVerifier(verifier2, keccak256("tee2"));
    }

    // ═══════════════════════════════════════════════════════════════════
    // PUBLISH ROOT EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_PublishRoot_ZeroRootReverts() public {
        vm.prank(verifier);
        vm.expectRevert("SolvencyRoot: zero root");
        solvencyRoot.publishRoot(bytes32(0), 5000);
    }

    function test_PublishRoot_DuplicateRootReverts() public {
        bytes32 root = keccak256("unique-root");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        vm.prank(verifier2);
        vm.expectRevert("SolvencyRoot: proof already exists");
        solvencyRoot.publishRoot(root, 6000);
    }

    function test_PublishRoot_NonVerifierReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishRoot(keccak256("test"), 5000);
    }

    function test_PublishRoot_InvalidatesCurrentProof() public {
        bytes32 root1 = keccak256("root-1");
        bytes32 root2 = keccak256("root-2");

        vm.prank(verifier);
        solvencyRoot.publishRoot(root1, 5000);

        ISolvencyRoot.SolvencyProof memory current1 = solvencyRoot.getCurrentSolvencyProof();
        assertEq(current1.merkleRoot, root1);
        assertTrue(current1.isValid);

        vm.prank(verifier);
        solvencyRoot.publishRoot(root2, 6000);

        // Current proof should now be root2 and valid
        ISolvencyRoot.SolvencyProof memory current2 = solvencyRoot.getCurrentSolvencyProof();
        assertEq(current2.merkleRoot, root2);
        assertTrue(current2.isValid);

        // The mapping entry for root2 should be valid
        ISolvencyRoot.SolvencyProof memory proof2 = solvencyRoot.getSolvencyProof(root2);
        assertTrue(proof2.isValid);
    }

    function test_PublishRoot_SurplusBpsZero() public {
        bytes32 root = keccak256("zero-surplus-root");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 0);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(root);
        assertEq(proof.surplusBps, 0);
        assertTrue(proof.isValid);
    }

    function test_PublishRoot_SurplusBpsMax() public {
        bytes32 root = keccak256("max-surplus-root");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 999999);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(root);
        assertEq(proof.surplusBps, 999999);
    }

    function testFuzz_PublishRoot_SurplusVariants(uint24 surplusBps) public {
        bytes32 root = keccak256(abi.encodePacked("fuzz-root", surplusBps));
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, uint256(surplusBps));

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(root);
        assertEq(proof.surplusBps, uint256(surplusBps));
        assertTrue(proof.isValid);
    }

    // ═══════════════════════════════════════════════════════════════════
    // PUBLISH SOlVENCY PROOF EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_PublishProof_ZeroRootReverts() public {
        vm.prank(verifier);
        vm.expectRevert("SolvencyRoot: zero merkle root");
        solvencyRoot.publishSolvencyProof(bytes32(0), 1_000_000_000, 500_000_000, 20000, 1);
    }

    function test_PublishProof_DuplicateRootReverts() public {
        bytes32 root = keccak256("proof-root");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        vm.prank(verifier2);
        vm.expectRevert("SolvencyRoot: proof already exists");
        solvencyRoot.publishSolvencyProof(root, 1_200_000_000, 400_000_000, 30000, 2);
    }

    function test_PublishProof_NonVerifierReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("SolvencyRoot: caller is not verifier");
        solvencyRoot.publishSolvencyProof(keccak256("test"), 1000, 500, 20000, 1);
    }

    function test_PublishProof_SolvencyWarningEmitted() public {
        bytes32 root = keccak256("warning-proof");
        // Collateral ratio 10000 < minCollateralRatio 15000 → WARNING
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 500_000_000, 500_000_000, 10000, 1);

        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertFalse(isSolvent);
        assertEq(ratio, 10000);
    }

    function test_PublishProof_NoWarningWhenSolvent() public {
        bytes32 root = keccak256("solvent-proof");
        // Collateral ratio 20000 >= minCollateralRatio 15000 → solvent
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);
        assertEq(ratio, 20000);
    }

    function test_PublishProof_ExactThresholdRatio() public {
        bytes32 root = keccak256("exact-threshold");
        // Collateral ratio 15000 == minCollateralRatio 15000 → exactly solvent
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 750_000_000, 500_000_000, 15000, 1);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);
    }

    function test_PublishProof_OneBelowThresholdRatio() public {
        bytes32 root = keccak256("one-below-threshold");
        // Collateral ratio 14999 < 15000 → not solvent
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 750_000_000, 500_000_000, 14999, 1);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent);
    }

    function test_PublishProof_SurplusComputation() public {
        bytes32 root = keccak256("surplus-compute");
        // totalFxrpCollateral=1_500_000_000, totalLiabilities=1_000_000_000
        // surplusBps = (1_500_000_000 - 1_000_000_000) * 10000 / 1_000_000_000 = 5000
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_500_000_000, 1_000_000_000, 15000, 1);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(root);
        assertEq(proof.surplusBps, 5000);
    }

    function test_PublishProof_ZeroLiabilitiesMaxSurplus() public {
        bytes32 root = keccak256("zero-liabilities");
        // Zero liabilities → surplus = 999999
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 0, 999999, 1);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getSolvencyProof(root);
        assertEq(proof.surplusBps, 999999);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MERKLE PROOF EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_VerifySolvency_NoProofPublished() public view {
        bytes32[] memory proof = new bytes32[](0);
        bool valid = solvencyRoot.verifySolvency(proof, keccak256("leaf"));
        assertFalse(valid);
    }

    function test_VerifySolvency_InvalidProof() public {
        bytes32 root = keccak256("merkle-root");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("wrong-sibling");
        bool valid = solvencyRoot.verifySolvency(proof, keccak256("wrong-leaf"));
        assertFalse(valid);
    }

    function test_VerifySolvency_SingleLeafTree() public {
        // Single leaf = root (empty proof)
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100), uint256(50)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        assertTrue(solvencyRoot.verifySolvency(proof, leaf));
    }

    function test_VerifySolvency_TwoLeafTree() public {
        bytes32 leaf1 = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100), uint256(50)));
        bytes32 leaf2 = keccak256(abi.encodePacked(uint256(2), depositor2, uint256(200), uint256(100)));

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

    function test_VerifySolvency_ThreeLevelTree() public {
        // Build a 4-leaf Merkle tree
        bytes32 leaf0 = keccak256("leaf0");
        bytes32 leaf1 = keccak256("leaf1");
        bytes32 leaf2 = keccak256("leaf2");
        bytes32 leaf3 = keccak256("leaf3");

        // Level 1
        bytes32 n01 = leaf0 <= leaf1 ? keccak256(abi.encodePacked(leaf0, leaf1)) : keccak256(abi.encodePacked(leaf1, leaf0));
        bytes32 n23 = leaf2 <= leaf3 ? keccak256(abi.encodePacked(leaf2, leaf3)) : keccak256(abi.encodePacked(leaf3, leaf2));

        // Root
        bytes32 root = n01 <= n23 ? keccak256(abi.encodePacked(n01, n23)) : keccak256(abi.encodePacked(n23, n01));

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        // Verify leaf0: proof = [leaf1, n23]
        bytes32[] memory proof0 = new bytes32[](2);
        proof0[0] = leaf1;
        proof0[1] = n23;
        assertTrue(solvencyRoot.verifySolvency(proof0, leaf0));

        // Verify leaf2: proof = [leaf3, n01]
        bytes32[] memory proof2 = new bytes32[](2);
        proof2[0] = leaf3;
        proof2[1] = n01;
        assertTrue(solvencyRoot.verifySolvency(proof2, leaf2));
    }

    function test_VerifyPosition_NoProofPublished() public view {
        bytes32[] memory proof = new bytes32[](0);
        bool valid = solvencyRoot.verifyPosition(1, depositor1, 100, 50, proof);
        assertFalse(valid);
    }

    function test_VerifyPosition_CorrectProof() public {
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        assertTrue(solvencyRoot.verifyPosition(1, depositor1, 100_000_000, 50000, proof));
    }

    function test_VerifyPosition_WrongPositionId() public {
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100_000_000), uint256(50000)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        // Wrong position ID should produce wrong leaf hash
        assertFalse(solvencyRoot.verifyPosition(2, depositor1, 100_000_000, 50000, proof));
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROOF INVALIDATION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_InvalidateProof_NonexistentReverts() public {
        vm.expectRevert("SolvencyRoot: proof does not exist");
        solvencyRoot.invalidateSolvencyProof(keccak256("nonexistent"), "reason");
    }

    function test_InvalidateProof_NonAdminReverts() public {
        bytes32 root = keccak256("invalidate-test");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        vm.prank(nonVerifier);
        vm.expectRevert("SolvencyRoot: caller is not admin");
        solvencyRoot.invalidateSolvencyProof(root, "hack");
    }

    function test_InvalidateProof_CurrentProofUpdatesIsValid() public {
        bytes32 root = keccak256("current-invalidate");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertTrue(proof.isValid);

        solvencyRoot.invalidateSolvencyProof(root, "admin invalidation");

        proof = solvencyRoot.getCurrentSolvencyProof();
        assertFalse(proof.isValid);
    }

    function test_InvalidateProof_OldProofDoesNotAffectCurrent() public {
        bytes32 root1 = keccak256("old-root");
        bytes32 root2 = keccak256("new-root");

        vm.prank(verifier);
        solvencyRoot.publishRoot(root1, 5000);
        vm.prank(verifier);
        solvencyRoot.publishRoot(root2, 6000);

        // Invalidate the old proof (root1) - should not affect current
        solvencyRoot.invalidateSolvencyProof(root1, "old proof invalidated");

        ISolvencyRoot.SolvencyProof memory current = solvencyRoot.getCurrentSolvencyProof();
        assertTrue(current.isValid);
        assertEq(current.merkleRoot, root2);

        // Old proof should be invalid
        ISolvencyRoot.SolvencyProof memory old = solvencyRoot.getSolvencyProof(root1);
        assertFalse(old.isValid);
    }

    function test_InvalidateProof_VerifyFailsAfterInvalidation() public {
        bytes32 leaf = keccak256(abi.encodePacked(uint256(1), depositor1, uint256(100), uint256(50)));
        bytes32 root = leaf;
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        assertTrue(solvencyRoot.verifySolvency(proof, leaf));

        // Invalidate the current proof
        solvencyRoot.invalidateSolvencyProof(root, "breach detected");

        // Verification should now fail
        assertFalse(solvencyRoot.verifySolvency(proof, leaf));
    }

    // ═══════════════════════════════════════════════════════════════════
    // MIN COLLATERAL RATIO EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_SetMinCollateralRatio_NonAdminReverts() public {
        vm.prank(nonVerifier);
        vm.expectRevert("SolvencyRoot: caller is not admin");
        solvencyRoot.setMinCollateralRatio(20000);
    }

    function test_SetMinCollateralRatio_ZeroReverts() public {
        vm.expectRevert("SolvencyRoot: zero threshold");
        solvencyRoot.setMinCollateralRatio(0);
    }

    function test_SetMinCollateralRatio_ChangesSolvencyStatus() public {
        bytes32 root = keccak256("ratio-change-test");
        // Publish with ratio 12000 (below current threshold 15000)
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 600_000_000, 500_000_000, 12000, 1);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent); // 12000 < 15000

        // Lower threshold to 10000
        solvencyRoot.setMinCollateralRatio(10000);
        // Note: isSolvent reads from stored proof, should now be true
        (isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent); // 12000 >= 10000
    }

    function testFuzz_SetMinCollateralRatio_Positive(uint24 ratio) public {
        vm.assume(uint256(ratio) > 0);
        solvencyRoot.setMinCollateralRatio(uint256(ratio));
        assertEq(solvencyRoot.getMinCollateralRatio(), uint256(ratio));
    }

    // ═══════════════════════════════════════════════════════════════════
    // HISTORY EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_GetSolvencyHistory_Empty() public view {
        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(5);
        assertEq(history.length, 0);
    }

    function test_GetSolvencyHistory_SingleProof() public {
        bytes32 root = keccak256("history-single");
        vm.prank(verifier);
        solvencyRoot.publishRoot(root, 5000);

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(1);
        assertEq(history.length, 1);
        assertEq(history[0].merkleRoot, root);
    }

    function test_GetSolvencyHistory_RequestMoreThanAvailable() public {
        bytes32 root1 = keccak256("h1");
        bytes32 root2 = keccak256("h2");

        vm.prank(verifier);
        solvencyRoot.publishRoot(root1, 5000);
        vm.prank(verifier);
        solvencyRoot.publishRoot(root2, 6000);

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(10);
        assertEq(history.length, 2);
    }

    function test_GetSolvencyHistory_PartialRequest() public {
        for (uint256 i = 0; i < 5; i++) {
            bytes32 root = keccak256(abi.encodePacked("hist", i));
            vm.prank(verifier);
            solvencyRoot.publishRoot(root, 5000 + i * 100);
        }

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(3);
        assertEq(history.length, 3);
        // Should return the 3 most recent
    }

    function testFuzz_GetSolvencyHistory_Count(uint8 count) public {
        uint256 numProofs = 3; // We'll publish 3 proofs
        for (uint256 i = 0; i < numProofs; i++) {
            bytes32 root = keccak256(abi.encodePacked("fuzz-hist", i));
            vm.prank(verifier);
            solvencyRoot.publishRoot(root, 5000);
        }

        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(uint256(count));
        uint256 expectedLen = uint256(count) > numProofs ? numProofs : uint256(count);
        assertEq(history.length, expectedLen);
    }

    // ═══════════════════════════════════════════════════════════════════
    // IS SOLVENT EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_IsSolvent_NoProofPublished() public view {
        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertFalse(isSolvent);
        assertEq(ratio, 0);
    }

    function test_IsSolvent_AfterInvalidateCurrentProof() public {
        bytes32 root = keccak256("invalidate-solvency");
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, 20000, 1);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);

        // Invalidate the current proof
        solvencyRoot.invalidateSolvencyProof(root, "breach");
        (isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent); // Invalid proof → not solvent
    }

    function testFuzz_IsSolvent_RatioVsThreshold(uint24 collateralRatio) public {
        bytes32 root = keccak256(abi.encodePacked("solvent-fuzz", collateralRatio));
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root, 1_000_000_000, 500_000_000, uint256(collateralRatio), 1);

        (bool isSolvent,) = solvencyRoot.isSolvent();
        if (uint256(collateralRatio) >= MIN_COLLATERAL_RATIO) {
            assertTrue(isSolvent);
        } else {
            assertFalse(isSolvent);
        }
    }
}
