// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IVerifierRole.sol";

/// @title VerifierRole
/// @notice Role-based access control for Aegis vault operations.
///         Implements the IVerifierRole interface with hierarchical roles:
///         DEFAULT_ADMIN > VERIFIER > OPERATOR > DEPOSITOR.
contract VerifierRole is IVerifierRole {
    // --- State Variables ---

    /// @notice Mapping from role => account => hasRole
    mapping(Role => mapping(address => bool)) private _roles;

    /// @notice Mapping from role => list of accounts
    mapping(Role => address[]) private _roleMembers;

    /// @notice Mapping from verifier address => TEE identity hash
    mapping(address => bytes32) private _verifierTeeIdentities;

    /// @notice Mapping from verifier address => is registered
    mapping(address => bool) private _registeredVerifiers;

    // --- Modifiers ---

    modifier onlyAdmin() {
        require(_roles[Role.DEFAULT_ADMIN][msg.sender], "VerifierRole: caller is not admin");
        _;
    }

    modifier onlyRoleOrAdmin(Role role) {
        require(
            _roles[role][msg.sender] || _roles[Role.DEFAULT_ADMIN][msg.sender],
            "VerifierRole: caller lacks required role"
        );
        _;
    }

    // --- Constructor ---

    constructor() {
        // Grant DEFAULT_ADMIN to the deployer
        _roles[Role.DEFAULT_ADMIN][msg.sender] = true;
        _roleMembers[Role.DEFAULT_ADMIN].push(msg.sender);
        emit RoleGranted(Role.DEFAULT_ADMIN, msg.sender, msg.sender);
    }

    // --- View Functions ---

    /// @inheritdoc IVerifierRole
    function hasRole(Role role, address account) external view override returns (bool) {
        return _roles[role][account];
    }

    /// @inheritdoc IVerifierRole
    function getRoleMembers(Role role) external view override returns (address[] memory) {
        return _roleMembers[role];
    }

    /// @inheritdoc IVerifierRole
    function getRoleMemberCount(Role role) external view override returns (uint256) {
        return _roleMembers[role].length;
    }

    /// @inheritdoc IVerifierRole
    function getVerifierTeeIdentity(address verifier) external view override returns (bytes32) {
        return _verifierTeeIdentities[verifier];
    }

    /// @inheritdoc IVerifierRole
    function isVerifiedTEE(address account) external view override returns (bool) {
        return _registeredVerifiers[account] && _roles[Role.VERIFIER][account];
    }

    /// @inheritdoc IVerifierRole
    function verifySignature(
        address verifier,
        bytes32 messageHash,
        bytes calldata signature
    ) external view override returns (bool) {
        if (!_roles[Role.VERIFIER][verifier] || !_registeredVerifiers[verifier]) {
            return false;
        }

        // Recover the signer from the signature
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        // Extract r, s, v from signature
        require(signature.length == 65, "VerifierRole: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        address recovered = ecrecover(ethSignedHash, v, r, s);
        return recovered == verifier;
    }

    // --- State-Changing Functions ---

    /// @inheritdoc IVerifierRole
    function grantRole(Role role, address account) external override onlyAdmin {
        require(account != address(0), "VerifierRole: zero address");
        require(!_roles[role][account], "VerifierRole: role already granted");

        _roles[role][account] = true;
        _roleMembers[role].push(account);

        emit RoleGranted(role, account, msg.sender);
    }

    /// @inheritdoc IVerifierRole
    function revokeRole(Role role, address account) external override onlyAdmin {
        require(_roles[role][account], "VerifierRole: role not granted");
        require(account != msg.sender, "VerifierRole: cannot revoke own admin role");

        _roles[role][account] = false;

        // Remove from members list (swap and pop)
        address[] storage members = _roleMembers[role];
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == account) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }

        // If revoking verifier role, also unregister
        if (role == Role.VERIFIER) {
            _registeredVerifiers[account] = false;
        }

        emit RoleRevoked(role, account, msg.sender);
    }

    /// @inheritdoc IVerifierRole
    function registerVerifier(address verifier, bytes32 teeIdentity) external override onlyAdmin {
        require(verifier != address(0), "VerifierRole: zero address verifier");
        require(teeIdentity != bytes32(0), "VerifierRole: zero TEE identity");

        bytes32 oldIdentity = _verifierTeeIdentities[verifier];
        _verifierTeeIdentities[verifier] = teeIdentity;
        _registeredVerifiers[verifier] = true;

        // Also grant VERIFIER role if not already granted
        if (!_roles[Role.VERIFIER][verifier]) {
            _roles[Role.VERIFIER][verifier] = true;
            _roleMembers[Role.VERIFIER].push(verifier);
            emit RoleGranted(Role.VERIFIER, verifier, msg.sender);
        }

        if (oldIdentity == bytes32(0)) {
            emit VerifierRegistered(verifier, teeIdentity, block.timestamp);
        } else {
            emit VerifierIdentityUpdated(verifier, oldIdentity, teeIdentity);
        }
    }
}
