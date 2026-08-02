// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ISolvencyRoot
/// @notice Merkle root computation and on-chain publication for Aegis vault solvency proofs.
///         The SolvencyRoot enables trustless verification that the vault's total FXRP
///         collateral exceeds its total liabilities, using a Merkle tree of positions.
/// @dev The solvency root is computed by the FCC extension's SolvencyAttestor module
///      inside the TEE and published on-chain. Auditors can verify individual positions
///      against the published root without needing to trust the vault operator.
interface ISolvencyRoot {
    // --- Structs ---

    /// @notice A solvency proof published on-chain
    struct SolvencyProof {
        bytes32 merkleRoot;          // Merkle root of all position data
        uint256 totalFxrpCollateral; // Total FXRP collateral in the vault (UBA)
        uint256 totalLiabilities;    // Total liabilities (withdrawal requests, etc.)
        uint256 collateralRatio;     // Collateral ratio in basis points
        uint256 timestamp;           // Timestamp of the proof
        uint256 votingRound;         // Flare voting round when the proof was computed
        address attestor;            // Address of the FCC extension that published the proof
        bool isValid;                // Whether the proof is currently valid
    }

    /// @notice A Merkle proof for a single position
    struct PositionProof {
        uint256 positionId;          // Position ID
        address depositor;           // Depositor's address
        uint256 fxrpAmount;          // FXRP amount in the position
        uint256 usdValuation;        // USD valuation at proof time
        bytes32[] merkleProof;       // Merkle proof nodes
    }

    // --- Events ---

    /// @notice Emitted when a new solvency proof is published
    event SolvencyProofPublished(
        bytes32 indexed merkleRoot,
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

    /// @notice Emitted when a position is verified against a solvency proof
    event PositionVerified(
        uint256 indexed positionId,
        bytes32 indexed merkleRoot,
        bool isValid
    );

    /// @notice Emitted when a solvency warning is triggered
    event SolvencyWarning(
        uint256 collateralRatio,
        uint256 thresholdRatio,
        uint256 timestamp
    );

    // --- Functions ---

    /// @notice Publish a new solvency proof on-chain
    /// @param merkleRoot Merkle root of all position data
    /// @param totalFxrpCollateral Total FXRP collateral in the vault
    /// @param totalLiabilities Total liabilities
    /// @param collateralRatio Collateral ratio in basis points
    /// @param votingRound Flare voting round when the proof was computed
    function publishSolvencyProof(
        bytes32 merkleRoot,
        uint256 totalFxrpCollateral,
        uint256 totalLiabilities,
        uint256 collateralRatio,
        uint256 votingRound
    ) external;

    /// @notice Verify a position against the current solvency proof
    /// @param positionId The position to verify
    /// @param fxrpAmount The FXRP amount in the position
    /// @param usdValuation The USD valuation at proof time
    /// @param merkleProof The Merkle proof nodes
    /// @return isValid Whether the position is valid against the current root
    function verifyPosition(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation,
        bytes32[] calldata merkleProof
    ) external view returns (bool isValid);

    /// @notice Get the current solvency proof
    /// @return proof The current solvency proof
    function getCurrentSolvencyProof() external view returns (SolvencyProof memory proof);

    /// @notice Get a solvency proof by Merkle root
    /// @param merkleRoot The Merkle root of the proof
    /// @return proof The solvency proof
    function getSolvencyProof(bytes32 merkleRoot) external view returns (SolvencyProof memory proof);

    /// @notice Check if the vault is currently solvent
    /// @return isSolvent Whether the vault is solvent
    /// @return collateralRatio The current collateral ratio
    function isSolvent() external view returns (bool isSolvent, uint256 collateralRatio);

    /// @notice Get the solvency history
    /// @param count Number of recent proofs to return
    /// @return proofs Array of recent solvency proofs
    function getSolvencyHistory(uint256 count) external view returns (SolvencyProof[] memory proofs);

    /// @notice Invalidate a solvency proof
    /// @param merkleRoot The Merkle root of the proof to invalidate
    /// @param reason The reason for invalidation
    function invalidateSolvencyProof(bytes32 merkleRoot, string calldata reason) external;

    /// @notice Get the minimum collateral ratio threshold
    /// @return threshold The minimum collateral ratio in basis points
    function getMinCollateralRatio() external view returns (uint256 threshold);

    /// @notice Set the minimum collateral ratio threshold
    /// @param threshold The new minimum collateral ratio in basis points
    function setMinCollateralRatio(uint256 threshold) external;
}
