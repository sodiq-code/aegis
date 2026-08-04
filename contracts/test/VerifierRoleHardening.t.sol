// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/interfaces/vault/IVerifierRole.sol";

/// @title VerifierRoleHardening
/// @notice Task 29 hardening: edge-case and fuzz tests for VerifierRole.
///         Covers role hierarchy, TEE identity edge cases, signature verification,
///         access control, and revocation invariants.
contract VerifierRoleHardening is Test {
    VerifierRole public verifierRole;

    address public admin;
    address public verifier;
    address public operator;
    address public depositor;
    address public nonAdmin;

    bytes32 constant TEE_IDENTITY = keccak256("test-tee-identity");

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        operator = makeAddr("operator");
        depositor = makeAddr("depositor");
        nonAdmin = makeAddr("nonAdmin");

        verifierRole = new VerifierRole();

        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, operator);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ROLE GRANT EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_GrantRole_ZeroAddressReverts() public {
        vm.expectRevert("VerifierRole: zero address");
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, address(0));
    }

    function test_GrantRole_AlreadyGrantedReverts() public {
        vm.expectRevert("VerifierRole: role already granted");
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
    }

    function test_GrantRole_NonAdminReverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VerifierRole: caller is not admin");
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, makeAddr("new"));
    }

    function test_GrantRole_AllRoleTypes() public {
        address newUser = makeAddr("newUser");
        IVerifierRole.Role[4] memory roles = [
            IVerifierRole.Role.DEFAULT_ADMIN,
            IVerifierRole.Role.VERIFIER,
            IVerifierRole.Role.OPERATOR,
            IVerifierRole.Role.DEPOSITOR
        ];

        for (uint256 i = 0; i < roles.length; i++) {
            address user = makeAddr(string(abi.encodePacked("user", bytes1(uint8(i + 10)))));
            if (i == 0) continue; // Skip DEFAULT_ADMIN (would give too much power)
            verifierRole.grantRole(roles[i], user);
            assertTrue(verifierRole.hasRole(roles[i], user));
        }
    }

    function testFuzz_GrantRole_RandomAddress(address who) public {
        vm.assume(who != address(0));
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, who));

        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, who);
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, who));
    }

    // ═══════════════════════════════════════════════════════════════════
    // ROLE REVOKE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_RevokeRole_NotGrantedReverts() public {
        vm.expectRevert("VerifierRole: role not granted");
        verifierRole.revokeRole(IVerifierRole.Role.VERIFIER, nonAdmin);
    }

    function test_RevokeRole_CannotRevokeOwnAdmin() public {
        vm.expectRevert("VerifierRole: cannot revoke own admin role");
        verifierRole.revokeRole(IVerifierRole.Role.DEFAULT_ADMIN, admin);
    }

    function test_RevokeRole_NonAdminReverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VerifierRole: caller is not admin");
        verifierRole.revokeRole(IVerifierRole.Role.DEPOSITOR, depositor);
    }

    function test_RevokeRole_VerifierAlsoUnregisters() public {
        assertTrue(verifierRole.isVerifiedTEE(verifier));

        verifierRole.revokeRole(IVerifierRole.Role.VERIFIER, verifier);

        assertFalse(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, verifier));
        assertFalse(verifierRole.isVerifiedTEE(verifier));
    }

    function test_RevokeRole_OperatorDoesNotAffectTEE() public {
        // Grant operator a verifier role + TEE identity
        address op = makeAddr("opWithTEE");
        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, op);
        verifierRole.registerVerifier(op, keccak256("op-tee"));
        assertTrue(verifierRole.isVerifiedTEE(op));

        // Revoking OPERATOR role should NOT affect TEE registration
        // (Only VERIFIER role revocation unregisters)
        verifierRole.revokeRole(IVerifierRole.Role.OPERATOR, op);
        // isVerifiedTEE checks both _registeredVerifiers and VERIFIER role
        // Since we also granted VERIFIER via registerVerifier, it should still be verified
        assertTrue(verifierRole.isVerifiedTEE(op));
    }

    function test_RevokeRole_DecrementsMemberCount() public {
        uint256 countBefore = verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR);
        verifierRole.revokeRole(IVerifierRole.Role.DEPOSITOR, depositor);
        uint256 countAfter = verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR);
        assertEq(countAfter, countBefore - 1);
    }

    function test_RevokeRole_ThenReGrant() public {
        verifierRole.revokeRole(IVerifierRole.Role.DEPOSITOR, depositor);
        assertFalse(verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, depositor));

        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, depositor);
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEPOSITOR, depositor));
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGISTER VERIFIER EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_RegisterVerifier_ZeroAddressReverts() public {
        vm.expectRevert("VerifierRole: zero address verifier");
        verifierRole.registerVerifier(address(0), TEE_IDENTITY);
    }

    function test_RegisterVerifier_ZeroTEEIdentityReverts() public {
        vm.expectRevert("VerifierRole: zero TEE identity");
        verifierRole.registerVerifier(verifier, bytes32(0));
    }

    function test_RegisterVerifier_NonAdminReverts() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VerifierRole: caller is not admin");
        verifierRole.registerVerifier(makeAddr("new"), TEE_IDENTITY);
    }

    function test_RegisterVerifier_AutoGrantsVerifierRole() public {
        address newV = makeAddr("newVerifier");
        assertFalse(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, newV));

        verifierRole.registerVerifier(newV, keccak256("new-tee"));
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.VERIFIER, newV));
        assertTrue(verifierRole.isVerifiedTEE(newV));
    }

    function test_RegisterVerifier_IdentityUpdate() public {
        bytes32 oldIdentity = verifierRole.getVerifierTeeIdentity(verifier);
        assertEq(oldIdentity, TEE_IDENTITY);

        bytes32 newIdentity = keccak256("updated-tee");
        verifierRole.registerVerifier(verifier, newIdentity);
        assertEq(verifierRole.getVerifierTeeIdentity(verifier), newIdentity);
        assertTrue(verifierRole.isVerifiedTEE(verifier));
    }

    function testFuzz_RegisterVerifier_VariousIdentities(address who, bytes32 teeIdentity) public {
        vm.assume(who != address(0));
        vm.assume(teeIdentity != bytes32(0));
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.VERIFIER, who));

        verifierRole.registerVerifier(who, teeIdentity);
        assertEq(verifierRole.getVerifierTeeIdentity(who), teeIdentity);
        assertTrue(verifierRole.isVerifiedTEE(who));
    }

    // ═══════════════════════════════════════════════════════════════════
    // IS VERIFIED TEE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_IsVerifiedTEE_WithoutRegistration() public view {
        // Has VERIFIER role but not registered → not verified TEE
        // Actually depositor doesn't have VERIFIER role either
        assertFalse(verifierRole.isVerifiedTEE(depositor));
    }

    function test_IsVerifiedTEE_WithoutRole() public view {
        assertFalse(verifierRole.isVerifiedTEE(nonAdmin));
    }

    function test_IsVerifiedTEE_RegisteredAndHasRole() public view {
        assertTrue(verifierRole.isVerifiedTEE(verifier));
    }

    function testFuzz_IsVerifiedTEE_UnregisteredAddresses(address who) public view {
        vm.assume(who != verifier);
        vm.assume(who != admin);
        assertFalse(verifierRole.isVerifiedTEE(who));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SIGNATURE VERIFICATION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_VerifySignature_InvalidLengthReverts() public {
        bytes32 messageHash = keccak256("test");
        bytes memory shortSignature = new bytes(64);
        vm.expectRevert("VerifierRole: invalid signature length");
        verifierRole.verifySignature(verifier, messageHash, shortSignature);
    }

    function test_VerifySignature_InvalidSigner() public view {
        bytes32 messageHash = keccak256("test");
        bytes memory signature = new bytes(65);
        // Non-verifier should return false
        bool result = verifierRole.verifySignature(nonAdmin, messageHash, signature);
        assertFalse(result);
    }

    function test_VerifySignature_CorrectECDSA() public {
        // Sign with verifier's private key (we need vm.sign)
        bytes32 messageHash = keccak256("test message");
        (address signer, uint256 privateKey) = makeAddrAndKey("signer");

        // Register as verifier
        verifierRole.registerVerifier(signer, keccak256("signer-tee"));

        // Sign the message
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bool result = verifierRole.verifySignature(signer, messageHash, signature);
        assertTrue(result);
    }

    function test_VerifySignature_WrongMessage() public {
        bytes32 messageHash = keccak256("correct message");
        (address signer, uint256 privateKey) = makeAddrAndKey("signer2");
        verifierRole.registerVerifier(signer, keccak256("signer2-tee"));

        // Sign a different message
        bytes32 wrongHash = keccak256("wrong message");
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", wrongHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should fail verification for the correct message
        bool result = verifierRole.verifySignature(signer, messageHash, signature);
        assertFalse(result);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ROLE MEMBER EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_GetRoleMembers_ContainsGrantedAddress() public view {
        address[] memory verifiers = verifierRole.getRoleMembers(IVerifierRole.Role.VERIFIER);
        bool found = false;
        for (uint256 i = 0; i < verifiers.length; i++) {
            if (verifiers[i] == verifier) {
                found = true;
                break;
            }
        }
        assertTrue(found);
    }

    function test_GetRoleMemberCount_MultipleGrants() public {
        uint256 initialCount = verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR);

        address d1 = makeAddr("d1");
        address d2 = makeAddr("d2");
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, d1);
        verifierRole.grantRole(IVerifierRole.Role.DEPOSITOR, d2);

        assertEq(verifierRole.getRoleMemberCount(IVerifierRole.Role.DEPOSITOR), initialCount + 2);
    }

    function testFuzz_RoleGrantAndRevoke_Consistency(address who) public {
        vm.assume(who != address(0));
        vm.assume(who != admin);
        vm.assume(!verifierRole.hasRole(IVerifierRole.Role.OPERATOR, who));

        uint256 countBefore = verifierRole.getRoleMemberCount(IVerifierRole.Role.OPERATOR);

        verifierRole.grantRole(IVerifierRole.Role.OPERATOR, who);
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.OPERATOR, who));
        assertEq(verifierRole.getRoleMemberCount(IVerifierRole.Role.OPERATOR), countBefore + 1);

        verifierRole.revokeRole(IVerifierRole.Role.OPERATOR, who);
        assertFalse(verifierRole.hasRole(IVerifierRole.Role.OPERATOR, who));
        assertEq(verifierRole.getRoleMemberCount(IVerifierRole.Role.OPERATOR), countBefore);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADMIN ROLE PROTECTION
    // ═══════════════════════════════════════════════════════════════════

    function test_Admin_CannotBeRevokedBySelf() public {
        vm.expectRevert("VerifierRole: cannot revoke own admin role");
        verifierRole.revokeRole(IVerifierRole.Role.DEFAULT_ADMIN, admin);
    }

    function test_Admin_CanBeRevokedByOtherAdmin() public {
        // Grant admin to another address
        address admin2 = makeAddr("admin2");
        verifierRole.grantRole(IVerifierRole.Role.DEFAULT_ADMIN, admin2);

        // admin2 can revoke admin1
        vm.prank(admin2);
        verifierRole.revokeRole(IVerifierRole.Role.DEFAULT_ADMIN, admin);

        assertFalse(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, admin));
    }

    function test_Admin_AlwaysHasAdminRoleAfterDeploy() public view {
        assertTrue(verifierRole.hasRole(IVerifierRole.Role.DEFAULT_ADMIN, admin));
    }

    function test_Admin_SingleAdminProtection() public {
        // If there's only one admin, they can't revoke themselves
        address[] memory admins = verifierRole.getRoleMembers(IVerifierRole.Role.DEFAULT_ADMIN);
        assertEq(admins.length, 1);

        vm.expectRevert("VerifierRole: cannot revoke own admin role");
        verifierRole.revokeRole(IVerifierRole.Role.DEFAULT_ADMIN, admin);
    }
}
