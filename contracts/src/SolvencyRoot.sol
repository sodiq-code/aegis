// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/ISolvencyRoot.sol";
import "./interfaces/vault/IVerifierRole.sol";

/// @title SolvencyRoot
/// @notice Merkle root computation and on-chain publication for Aegis vault solvency proofs.
contract SolvencyRoot is ISolvencyRoot {
    // --- State Variables ---

    /// @notice Current solvency proof
    SolvencyProof private _currentProof;

    /// @notice Mapping from Merkle root => SolvencyProof
    mapping(bytes32 => SolvencyProof) private _proofs;

    /// @notice History of solvency proof Merkle roots
    bytes32[] private _proofHistory;

    /// @notice Minimum collateral ratio threshold (basis points)
    uint256 private _minCollateralRatio;

    /// @notice VerifierRole contract for access control
    IVerifierRole public verifierRole;

    // --- Modifiers ---

    modifier onlyVerifier() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.VERIFIER, msg.sender) ||
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "SolvencyRoot: caller is not verifier"
        );
        _;
    }

    modifier onlyAdmin() {
        require(
            verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, msg.sender),
            "SolvencyRoot: caller is not admin"
        );
        _;
    }

    // --- Constructor ---

    constructor(address _verifierRole, uint256 initialMinCollateralRatio) {
        require(_verifierRole != address(0), "SolvencyRoot: zero address");
        verifierRole = IVerifierRole(_verifierRole);
        _minCollateralRatio = initialMinCollateralRatio;
    }

    // --- View Functions ---

    /// @inheritdoc ISolvencyRoot
    function getCurrentSolvencyProof() external view override returns (SolvencyProof memory) {
        return _currentProof;
    }

    /// @inheritdoc ISolvencyRoot
    function getSolvencyProof(bytes32 merkleRoot) external view override returns (SolvencyProof memory) {
        return _proofs[merkleRoot];
    }

    /// @inheritdoc ISolvencyRoot
    function isSolvent() external view override returns (bool, uint256) {
        if (_currentProof.merkleRoot == bytes32(0)) {
            return (false, 0);
        }
        bool solvent = _currentProof.collateralRatio >= _minCollateralRatio && _currentProof.isValid;
        return (solvent, _currentProof.collateralRatio);
    }

    /// @inheritdoc ISolvencyRoot
    function getSolvencyHistory(uint256 count) external view override returns (SolvencyProof[] memory) {
        uint256 historyLen = _proofHistory.length;
        uint256 returnCount = count > historyLen ? historyLen : count;

        SolvencyProof[] memory proofs = new SolvencyProof[](returnCount);
        for (uint256 i = 0; i < returnCount; i++) {
            proofs[i] = _proofs[_proofHistory[historyLen - returnCount + i]];
        }
        return proofs;
    }

    /// @inheritdoc ISolvencyRoot
    function getMinCollateralRatio() external view override returns (uint256) {
        return _minCollateralRatio;
    }

    /// @inheritdoc ISolvencyRoot
    function verifyPosition(
        uint256 positionId,
        address depositor,
        uint256 fxrpAmount,
        uint256 usdValuation,
        bytes32[] calldata merkleProof
    ) external view override returns (bool) {
        if (_currentProof.merkleRoot == bytes32(0) || !_currentProof.isValid) {
            return false;
        }

        // Compute the leaf hash for the position
        bytes32 leaf = keccak256(abi.encodePacked(
            positionId,
            depositor,
            fxrpAmount,
            usdValuation
        ));

        // Verify the Merkle proof
        return _verifyMerkleProof(leaf, merkleProof, _currentProof.merkleRoot);
    }

    // --- State-Changing Functions ---

    /// @inheritdoc ISolvencyRoot
    function publishSolvencyProof(
        bytes32 merkleRoot,
        uint256 totalFxrpCollateral,
        uint256 totalLiabilities,
        uint256 collateralRatio,
        uint256 votingRound
    ) external override onlyVerifier {
        require(merkleRoot != bytes32(0), "SolvencyRoot: zero merkle root");

        SolvencyProof storage proof = _proofs[merkleRoot];
        require(proof.merkleRoot == bytes32(0), "SolvencyRoot: proof already exists");

        proof.merkleRoot = merkleRoot;
        proof.totalFxrpCollateral = totalFxrpCollateral;
        proof.totalLiabilities = totalLiabilities;
        proof.collateralRatio = collateralRatio;
        proof.timestamp = block.timestamp;
        proof.votingRound = votingRound;
        proof.attestor = msg.sender;
        proof.isValid = true;

        // Invalidate previous proof
        if (_currentProof.merkleRoot != bytes32(0)) {
            _currentProof.isValid = false;
        }

        _currentProof = proof;
        _proofHistory.push(merkleRoot);

        // Check solvency warning
        if (collateralRatio < _minCollateralRatio) {
            emit SolvencyWarning(collateralRatio, _minCollateralRatio, block.timestamp);
        }

        emit SolvencyProofPublished(
            merkleRoot,
            totalFxrpCollateral,
            collateralRatio,
            votingRound,
            msg.sender
        );
    }

    /// @inheritdoc ISolvencyRoot
    function invalidateSolvencyProof(bytes32 merkleRoot, string calldata reason)
        external
        override
        onlyAdmin
    {
        require(_proofs[merkleRoot].merkleRoot != bytes32(0), "SolvencyRoot: proof does not exist");

        _proofs[merkleRoot].isValid = false;

        if (_currentProof.merkleRoot == merkleRoot) {
            _currentProof.isValid = false;
        }

        emit SolvencyProofInvalidated(merkleRoot, reason);
    }

    /// @inheritdoc ISolvencyRoot
    function setMinCollateralRatio(uint256 threshold) external override onlyAdmin {
        require(threshold > 0, "SolvencyRoot: zero threshold");
        _minCollateralRatio = threshold;
    }

    // --- Internal Functions ---

    function _verifyMerkleProof(
        bytes32 leaf,
        bytes32[] calldata proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }
}
