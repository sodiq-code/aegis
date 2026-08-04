// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ISolvencyRoot
/// @notice Merkle root computation and on-chain publication for Aegis vault solvency proofs.
/// API matches the Aegis blueprint exactly:
/// publishRoot(root, surplusBps), verifySolvency(proof, leaf).
/// @dev The solvency root is computed by the FCC extension's SolvencyAttestor module
/// inside the TEE and published on-chain. Auditors can verify individual positions
/// against the published root without needing to trust the vault operator.
interface ISolvencyRoot {
    // --- Structs ---

    /// @notice A solvency proof published on-chain
    struct SolvencyProof {
        bytes32 merkleRoot;          // Merkle root of all position data
        uint256 surplusBps;          // Surplus in basis points (collateral - liabilities)
        uint256 totalFxrpCollateral; // Total FXRP collateral in the vault (UBA)
        uint256 totalLiabilities;    // Total liabilities (withdrawal requests, etc.)
        uint256 collateralRatio;     // Collateral ratio in basis points
        uint256 timestamp;           // Timestamp of the proof
        uint256 votingRound;         // Flare voting round when the proof was computed
        address attestor;            // Address of the FCC extension that published the proof
        bool isValid;                // Whether the proof is currently valid
    }

    // --- Events ---

    /// @notice Emitted when a new solvency proof is published
    event SolvencyProofPublished(
        bytes32 indexed merkleRoot,
        uint256 surplusBps,
        uint256 totalFxrpCollateral,
        uint256 collateralRatio,
        uint256 votingRound,
        address indexed attestor
    );

    /// @notice Emitted when a solvency proof is invalidated
    event SolvencyProofInvalidated(
        bytes32 indexed merkleRoot,
        string reason
    );

    /// @notice Emitted when a solvency warning is triggered
    event SolvencyWarning(
        uint256 collateralRatio,
        uint256 thresholdRatio,
        uint256 timestamp
    );

    // --- Vault API ---

    /// @notice Publish a new solvency root on-chain (only TEE)
    /// @param root Merkle root of all position data
    /// @param surplusBps Surplus in basis points (assets - liabilities)
    function publishRoot(bytes32 root, uint256 surplusBps) external;

    /// @notice Verify solvency of a position against the current root
    /// @param proof Merkle proof nodes
    /// @param leaf The leaf hash to verify
    /// @return isValid Whether the position is valid against the current root
    function verifySolvency(bytes32[] calldata proof, bytes32 leaf) external view returns (bool isValid);

    // --- Extended API ---

    /// @notice Publish a full solvency proof with all metadata
    function publishSolvencyProof(
        bytes32 merkleRoot,
        uint256 totalFxrpCollateral,
        uint256 totalLiabilities,
        uint256 collateralRatio,
        uint256 votingRound
    ) external;

    /// @notice Verify a position against the current solvency proof
    function verifyPosition(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation,
        bytes32[] calldata merkleProof
    ) external view returns (bool isValid);

    /// @notice Get the current solvency proof
    function getCurrentSolvencyProof() external view returns (SolvencyProof memory proof);

    /// @notice Get a solvency proof by Merkle root
    function getSolvencyProof(bytes32 merkleRoot) external view returns (SolvencyProof memory proof);

    /// @notice Check if the vault is currently solvent
    function isSolvent() external view returns (bool isSolvent, uint256 collateralRatio);

    /// @notice Get the solvency history
    function getSolvencyHistory(uint256 count) external view returns (SolvencyProof[] memory proofs);

    /// @notice Invalidate a solvency proof
    function invalidateSolvencyProof(bytes32 merkleRoot, string calldata reason) external;

    /// @notice Get the minimum collateral ratio threshold
    function getMinCollateralRatio() external view returns (uint256 threshold);

    /// @notice Set the minimum collateral ratio threshold
    function setMinCollateralRatio(uint256 threshold) external;
}
