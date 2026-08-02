// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IVerifierRole
/// @notice Access control for Aegis vault operations using a verifier role system.
///         The VerifierRole module implements a role-based access control (RBAC) system
///         that restricts sensitive operations to verified addresses. This is critical
///         because the FCC extension's TEE-signed operations must be validated against
///         a known set of authorized verifiers.
/// @dev Roles are hierarchical: DEFAULT_ADMIN > VERIFIER > OPERATOR > DEPOSITOR.
///      The verifier role is specifically designed for the FCC extension's TEE-signed
///      attestations, ensuring that only the registered extension can publish solvency
///      proofs, send instructions, and modify vault state.
interface IVerifierRole {
    // --- Enums ---

    /// @notice Role types in the Aegis system
    enum Role {
        DEFAULT_ADMIN,  // Can manage all roles and vault configuration
        VERIFIER,       // FCC extension TEE — can publish solvency proofs, send instructions
        OPERATOR,       // Vault operator — can manage policies, trigger rebalances
        DEPOSITOR       // Can deposit and withdraw from the vault
    }

    // --- Structs ---

    /// @notice Role assignment data
    struct RoleAssignment {
        address account;        // The account with the role
        Role role;              // The assigned role
        address assignedBy;     // Who assigned the role
        uint256 assignedAt;     // Timestamp of assignment
        bool isActive;          // Whether the role is active
    }

    // --- Events ---

    /// @notice Emitted when a role is granted
    event RoleGranted(
        Role indexed role,
        address indexed account,
        address indexed sender
    );

    /// @notice Emitted when a role is revoked
    event RoleRevoked(
        Role indexed role,
        address indexed account,
        address indexed sender
    );

    /// @notice Emitted when a verifier is registered with its TEE identity
    event VerifierRegistered(
        address indexed verifier,
        bytes32 teeIdentity,
        uint256 timestamp
    );

    /// @notice Emitted when a verifier's TEE identity is updated
    event VerifierIdentityUpdated(
        address indexed verifier,
        bytes32 oldTeeIdentity,
        bytes32 newTeeIdentity
    );

    // --- Functions ---

    /// @notice Check if an account has a specific role
    /// @param role The role to check
    /// @param account The account to check
    /// @return hasRole Whether the account has the role
    function hasRole(Role role, address account) external view returns (bool hasRole);

    /// @notice Grant a role to an account
    /// @param role The role to grant
    /// @param account The account to receive the role
    function grantRole(Role role, address account) external;

    /// @notice Revoke a role from an account
    /// @param role The role to revoke
    /// @param account The account to lose the role
    function revokeRole(Role role, address account) external;

    /// @notice Register a verifier with its TEE identity
    /// @param verifier The verifier's address
    /// @param teeIdentity The TEE identity hash
    function registerVerifier(address verifier, bytes32 teeIdentity) external;

    /// @notice Verify that a message was signed by an authorized verifier
    /// @param verifier The verifier's address
    /// @param messageHash The hash of the message
    /// @param signature The signature
    /// @return isValid Whether the signature is valid from an authorized verifier
    function verifySignature(
        address verifier,
        bytes32 messageHash,
        bytes calldata signature
    ) external view returns (bool isValid);

    /// @notice Get the TEE identity for a verifier
    /// @param verifier The verifier's address
    /// @return teeIdentity The TEE identity hash
    function getVerifierTeeIdentity(address verifier) external view returns (bytes32 teeIdentity);

    /// @notice Get all accounts with a specific role
    /// @param role The role to query
    /// @return accounts Array of accounts with the role
    function getRoleMembers(Role role) external view returns (address[] memory accounts);

    /// @notice Get the number of accounts with a specific role
    /// @param role The role to query
    /// @return count Number of accounts with the role
    function getRoleMemberCount(Role role) external view returns (uint256 count);

    /// @notice Check if the caller is a verified TEE extension
    /// @param account The account to check
    /// @return isVerified Whether the account is a verified TEE extension
    function isVerifiedTEE(address account) external view returns (bool isVerified);
}
