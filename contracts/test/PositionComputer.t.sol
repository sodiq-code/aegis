// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";
import "../src/VaultCore.sol";

/// @title PositionComputerIntegrationTest
/// @notice Tests the PositionComputer + SolvencyRoot integration flow.
///         This simulates what the TEE-based PositionComputer does:
///         1. Read on-chain events (deposits, withdrawals)
///         2. Compute the Merkle root of the current vault state
///         3. Publish the solvency proof on-chain via SolvencyRoot
contract PositionComputerIntegrationTest is Test {
    // --- Contracts ---
    VerifierRole public verifierRole;
    PolicyRegistry public policyRegistry;
    SolvencyRoot public solvencyRoot;
    InstructionSender public instructionSender;

    // --- Test Accounts ---
    address public admin;
    address public verifier;
    address public depositor1;
    address public depositor2;
    address public depositor3;

    // --- Constants ---
    uint256 constant MIN_COLLATERAL_RATIO = 15000; // 150%
    bytes32 constant TEE_IDENTITY = keccak256("aegis-position-computer-tee");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        depositor1 = makeAddr("depositor1");
        depositor2 = makeAddr("depositor2");
        depositor3 = makeAddr("depositor3");

        // Deploy vault contracts
        verifierRole = new VerifierRole();
        policyRegistry = new PolicyRegistry();
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);
        instructionSender = new InstructionSender(address(verifierRole));

        // Grant roles
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
    }

    // ==========================================
    // MERKLE ROOT COMPUTATION (Simulating PositionComputer)
    // ==========================================

    /// @notice Compute a Merkle leaf hash for a position
    function computeLeafHash(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(positionId, depositor, fxrpAmount, usdValuation));
    }

    /// @notice Compute a Merkle root from an array of leaves
    function computeMerkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) {
            return keccak256("aegis-empty-vault");
        }
        if (leaves.length == 1) {
            return leaves[0];
        }

        // Build the next level
        bytes32[] memory nextLevel = new bytes32[]((leaves.length + 1) / 2);
        uint256 nextIdx = 0;

        for (uint256 i = 0; i < leaves.length; i += 2) {
            if (i + 1 < leaves.length) {
                // Sort the pair for deterministic ordering
                if (leaves[i] <= leaves[i + 1]) {
                    nextLevel[nextIdx] = keccak256(abi.encodePacked(leaves[i], leaves[i + 1]));
                } else {
                    nextLevel[nextIdx] = keccak256(abi.encodePacked(leaves[i + 1], leaves[i]));
                }
            } else {
                nextLevel[nextIdx] = leaves[i];
            }
            nextIdx++;
        }

        // Truncate the array
        assembly { mstore(nextLevel, nextIdx) }

        return computeMerkleRoot(nextLevel);
    }

    // ==========================================
    // POSITION COMPUTER INTEGRATION TESTS
    // ==========================================

    function test_PositionComputer_SinglePositionMerkleRoot() public {
        // Simulate PositionComputer computing a Merkle root for a single position
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);

        bytes32 merkleRoot = computeMerkleRoot(leaves);

        // Publish the solvency proof
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            100_000_000,  // total collateral
            0,            // total liabilities
            0,            // collateral ratio (no liabilities)
            1414258       // voting round
        );

        // Verify the proof was published
        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertTrue(proof.isValid);
    }

    function test_PositionComputer_MultiplePositionsMerkleRoot() public {
        // Simulate PositionComputer computing a Merkle root for 3 positions
        bytes32[] memory leaves = new bytes32[](3);
        leaves[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        leaves[2] = computeLeafHash(3, depositor3, 300_000_000, 150000);

        bytes32 merkleRoot = computeMerkleRoot(leaves);

        // Publish the solvency proof
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            600_000_000,  // total collateral
            0,            // total liabilities
            0,            // collateral ratio
            1414258       // voting round
        );

        ISolvencyRoot.SolvencyProof memory proof = solvencyRoot.getCurrentSolvencyProof();
        assertEq(proof.merkleRoot, merkleRoot);
        assertTrue(proof.isValid);
    }

    function test_PositionComputer_MerkleRootDeterministic() public {
        // Same positions should produce the same root
        bytes32[] memory leaves1 = new bytes32[](2);
        leaves1[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves1[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);

        bytes32[] memory leaves2 = new bytes32[](2);
        leaves2[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves2[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);

        bytes32 root1 = computeMerkleRoot(leaves1);
        bytes32 root2 = computeMerkleRoot(leaves2);

        assertEq(root1, root2);
    }

    function test_PositionComputer_MerkleRootChangesAfterRevaluation() public {
        // Initial state
        bytes32[] memory leaves1 = new bytes32[](2);
        leaves1[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves1[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        bytes32 root1 = computeMerkleRoot(leaves1);

        // After revaluation (price drops)
        bytes32[] memory leaves2 = new bytes32[](2);
        leaves2[0] = computeLeafHash(1, depositor1, 100_000_000, 40000); // USD value dropped
        leaves2[1] = computeLeafHash(2, depositor2, 200_000_000, 80000);
        bytes32 root2 = computeMerkleRoot(leaves2);

        assertTrue(root1 != root2);
    }

    function test_PositionComputer_MerkleRootChangesAfterWithdrawal() public {
        // Initial state: 3 positions
        bytes32[] memory leaves1 = new bytes32[](3);
        leaves1[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves1[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        leaves1[2] = computeLeafHash(3, depositor3, 300_000_000, 150000);
        bytes32 root1 = computeMerkleRoot(leaves1);

        // After withdrawal: 2 positions
        bytes32[] memory leaves2 = new bytes32[](2);
        leaves2[0] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        leaves2[1] = computeLeafHash(3, depositor3, 300_000_000, 150000);
        bytes32 root2 = computeMerkleRoot(leaves2);

        assertTrue(root1 != root2);
    }

    function test_PositionComputer_SolvencyProofPublication() public {
        // PositionComputer computes Merkle root
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        bytes32 merkleRoot = computeMerkleRoot(leaves);

        // Publish solvency proof (simulating TEE publishing)
        // Use a high collateral ratio (200%) to pass the solvency check
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            300_000_000,  // total collateral
            150_000_000,  // total liabilities
            20000,        // 200% collateral ratio
            1414258       // voting round
        );

        // Verify the proof is valid
        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertTrue(isSolvent);

        // Verify position inclusion
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaves[1]; // Proof for position 1 includes sibling
        bool isValid = solvencyRoot.verifyPosition(1, depositor1, 100_000_000, 50000, proof);
        assertTrue(isValid);
    }

    function test_PositionComputer_SolvencyWarningOnLowRatio() public {
        bytes32 merkleRoot = keccak256("low-ratio-root");

        // Publish a proof with low collateral ratio (100% < 150%)
        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(
            merkleRoot,
            500_000_000,  // total collateral
            500_000_000,  // total liabilities
            10000,        // 100% collateral ratio
            1414258       // voting round
        );

        (bool isSolvent,) = solvencyRoot.isSolvent();
        assertFalse(isSolvent);
    }

    function test_PositionComputer_MultipleProofsOverTime() public {
        // Simulate the PositionComputer publishing proofs over time
        // as the vault state changes

        // Proof 1: After initial deposits
        bytes32[] memory leaves1 = new bytes32[](1);
        leaves1[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        bytes32 root1 = computeMerkleRoot(leaves1);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root1, 100_000_000, 0, 0, 1414258);

        // Proof 2: After more deposits
        bytes32[] memory leaves2 = new bytes32[](2);
        leaves2[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves2[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        bytes32 root2 = computeMerkleRoot(leaves2);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root2, 300_000_000, 0, 0, 1414259);

        // Proof 3: After withdrawal
        bytes32[] memory leaves3 = new bytes32[](1);
        leaves3[0] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        bytes32 root3 = computeMerkleRoot(leaves3);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root3, 200_000_000, 100_000_000, 20000, 1414260);

        // Verify the history
        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(3);
        assertEq(history.length, 3);
        assertEq(history[0].merkleRoot, root1);
        assertEq(history[1].merkleRoot, root2);
        assertEq(history[2].merkleRoot, root3);

        // Verify the current proof is the latest
        ISolvencyRoot.SolvencyProof memory current = solvencyRoot.getCurrentSolvencyProof();
        assertEq(current.merkleRoot, root3);
    }

    function test_PositionComputer_EmptyVaultMerkleRoot() public {
        // Empty vault should produce a deterministic root
        bytes32[] memory leaves = new bytes32[](0);
        bytes32 merkleRoot = computeMerkleRoot(leaves);

        // Should match the expected empty vault hash
        assertEq(merkleRoot, keccak256("aegis-empty-vault"));
    }

    function test_PositionComputer_FullLifecycleWithSolvency() public {
        // ===== STEP 1: Initial deposits =====
        bytes32[] memory leaves1 = new bytes32[](3);
        leaves1[0] = computeLeafHash(1, depositor1, 100_000_000, 50000);
        leaves1[1] = computeLeafHash(2, depositor2, 200_000_000, 100000);
        leaves1[2] = computeLeafHash(3, depositor3, 300_000_000, 150000);
        bytes32 root1 = computeMerkleRoot(leaves1);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root1, 600_000_000, 0, 0, 1414258);

        // ===== STEP 2: Price update (FTSO) =====
        // After price update, valuations change
        bytes32[] memory leaves2 = new bytes32[](3);
        leaves2[0] = computeLeafHash(1, depositor1, 100_000_000, 55000);
        leaves2[1] = computeLeafHash(2, depositor2, 200_000_000, 110000);
        leaves2[2] = computeLeafHash(3, depositor3, 300_000_000, 165000);
        bytes32 root2 = computeMerkleRoot(leaves2);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root2, 600_000_000, 0, 0, 1414259);

        // ===== STEP 3: Withdrawal =====
        bytes32[] memory leaves3 = new bytes32[](2);
        leaves3[0] = computeLeafHash(2, depositor2, 200_000_000, 110000);
        leaves3[1] = computeLeafHash(3, depositor3, 300_000_000, 165000);
        bytes32 root3 = computeMerkleRoot(leaves3);

        vm.prank(verifier);
        solvencyRoot.publishSolvencyProof(root3, 500_000_000, 100_000_000, 50000, 1414260);

        // ===== STEP 4: Verify final state =====
        (bool isSolvent, uint256 ratio) = solvencyRoot.isSolvent();
        assertTrue(isSolvent); // 50000 bps = 500% > 150%
        assertEq(ratio, 50000);

        // Verify all three proofs are in history
        ISolvencyRoot.SolvencyProof[] memory history = solvencyRoot.getSolvencyHistory(3);
        assertEq(history.length, 3);
        assertTrue(history[0].merkleRoot != history[1].merkleRoot);
        assertTrue(history[1].merkleRoot != history[2].merkleRoot);
    }
}
