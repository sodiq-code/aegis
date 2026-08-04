// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/PolicyRegistry.sol";
import "../src/interfaces/vault/IPolicyRegistry.sol";

/// @title PolicyRegistryHardening
/// @notice hardening: edge-case and fuzz tests for PolicyRegistry.
/// Covers policy CRUD edge cases, risk level transitions, validation
/// boundary conditions, and access control.
contract PolicyRegistryHardening is Test {
    PolicyRegistry public policyRegistry;

    address public admin;
    address public user1;
    address public user2;
    address public nonOwner;

    function setUp() public {
        admin = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        nonOwner = makeAddr("nonOwner");

        policyRegistry = new PolicyRegistry();
    }

    // ═══════════════════════════════════════════════════════════════════
    // DEFAULT POLICY EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_DefaultPolicies_Count() public view {
        assertEq(policyRegistry.getPolicyCount(), 3);
    }

    function test_DefaultPolicies_AllActive() public view {
        for (uint256 i = 1; i <= 3; i++) {
            IPolicyRegistry.Policy memory p = policyRegistry.getPolicy(i);
            assertTrue(p.isActive, "default policy should be active");
        }
    }

    function test_DefaultPolicies_RiskLevels() public view {
        assertEq(uint(policyRegistry.getPolicy(1).riskLevel), uint(IPolicyRegistry.RiskLevel.LOW));
        assertEq(uint(policyRegistry.getPolicy(2).riskLevel), uint(IPolicyRegistry.RiskLevel.MEDIUM));
        assertEq(uint(policyRegistry.getPolicy(3).riskLevel), uint(IPolicyRegistry.RiskLevel.HIGH));
    }

    function test_DefaultPolicies_DrawdownStrictness() public view {
        // Conservative should have lowest drawdown, Aggressive highest
        IPolicyRegistry.Policy memory conservative = policyRegistry.getPolicy(1);
        IPolicyRegistry.Policy memory balanced = policyRegistry.getPolicy(2);
        IPolicyRegistry.Policy memory aggressive = policyRegistry.getPolicy(3);

        assertLt(conservative.maxDrawdownBps, balanced.maxDrawdownBps);
        assertLt(balanced.maxDrawdownBps, aggressive.maxDrawdownBps);
    }

    function test_DefaultPolicies_SingleExposureStrictness() public view {
        IPolicyRegistry.Policy memory conservative = policyRegistry.getPolicy(1);
        IPolicyRegistry.Policy memory balanced = policyRegistry.getPolicy(2);
        IPolicyRegistry.Policy memory aggressive = policyRegistry.getPolicy(3);

        assertLt(conservative.maxSingleExposureBps, balanced.maxSingleExposureBps);
        assertLt(balanced.maxSingleExposureBps, aggressive.maxSingleExposureBps);
    }

    function test_DefaultPolicies_CollateralRatioStrictness() public view {
        IPolicyRegistry.Policy memory conservative = policyRegistry.getPolicy(1);
        IPolicyRegistry.Policy memory balanced = policyRegistry.getPolicy(2);
        IPolicyRegistry.Policy memory aggressive = policyRegistry.getPolicy(3);

        // Conservative has highest collateral ratio (safest)
        assertGt(conservative.minCollateralRatio, balanced.minCollateralRatio);
        assertGt(balanced.minCollateralRatio, aggressive.minCollateralRatio);
    }

    // ═══════════════════════════════════════════════════════════════════
    // POLICY CRUD EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_CreatePolicy_IncrementingIds() public {
        address[] memory assets = new address[](1);
        assets[0] = makeAddr("asset");

        uint256 id1 = policyRegistry.createPolicy(
            "P1", "desc", IPolicyRegistry.RiskLevel.LOW,
            1500, 4000, 800, assets, 100_000_000, 50_000_000, 10_000_000_000, 20000
        );
        uint256 id2 = policyRegistry.createPolicy(
            "P2", "desc", IPolicyRegistry.RiskLevel.MEDIUM,
            2500, 6000, 1200, assets, 500_000_000, 250_000_000, 50_000_000_000, 15000
        );

        assertEq(id1, 4);
        assertEq(id2, 5);
        assertEq(policyRegistry.getPolicyCount(), 5);
    }

    function test_CreatePolicy_OwnerIsCreator() public {
        address[] memory assets = new address[](1);
        assets[0] = makeAddr("asset");

        vm.prank(user1);
        uint256 id = policyRegistry.createPolicy(
            "UserPolicy", "desc", IPolicyRegistry.RiskLevel.LOW,
            1500, 4000, 800, assets, 100_000_000, 50_000_000, 10_000_000_000, 20000
        );

        IPolicyRegistry.Policy memory p = policyRegistry.getPolicy(id);
        assertEq(p.owner, user1);
    }

    function test_SetPolicy_NonOwnerReverts() public {
        address[] memory assets = new address[](1);
        assets[0] = makeAddr("asset");

        vm.prank(user1);
        uint256 id = policyRegistry.createPolicy(
            "UserPolicy", "desc", IPolicyRegistry.RiskLevel.LOW,
            1500, 4000, 800, assets, 100_000_000, 50_000_000, 10_000_000_000, 20000
        );

        IPolicyRegistry.Policy memory newPolicy = IPolicyRegistry.Policy({
            policyId: id,
            owner: user1,
            name: "Hacked",
            description: "desc",
            riskLevel: IPolicyRegistry.RiskLevel.HIGH,
            isActive: true,
            createdAt: 0,
            updatedAt: 0,
            maxDrawdownBps: 5000,
            maxSingleExposureBps: 9000,
            hedgeThresholdBps: 3000,
            allowedAssets: assets,
            maxDepositPerTx: 1_000_000_000,
            maxWithdrawalPerTx: 500_000_000,
            maxTotalExposure: 100_000_000_000,
            minCollateralRatio: 10000,
            maxLeverage: 20000,
            withdrawalDelaySeconds: 43200,
            rebalanceThresholdBps: 1000,
            maxSlippageBps: 200,
            onRiskBreach: IPolicyRegistry.PolicyAction.BLOCK,
            onSolvencyWarning: IPolicyRegistry.PolicyAction.BLOCK
        });

        vm.prank(nonOwner);
        vm.expectRevert("PolicyRegistry: caller is not policy owner");
        policyRegistry.setPolicy(id, newPolicy);
    }

    function test_SetPolicyStatus_NonOwnerReverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("PolicyRegistry: caller is not policy owner");
        policyRegistry.setPolicyStatus(1, false);
    }

    function test_UpdatePolicy_NonOwnerReverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("PolicyRegistry: caller is not policy owner");
        policyRegistry.updatePolicy(1, "field");
    }

    function test_GetPolicy_NonexistentReverts() public {
        vm.expectRevert("PolicyRegistry: policy does not exist");
        policyRegistry.getPolicy(99);
    }

    function test_AssignPolicy_NonexistentReverts() public {
        vm.expectRevert("PolicyRegistry: policy does not exist");
        policyRegistry.assignPolicy(99, user1);
    }

    function test_AssignPolicy_ZeroAddressReverts() public {
        vm.expectRevert("PolicyRegistry: zero address depositor");
        policyRegistry.assignPolicy(1, address(0));
    }

    function test_GetPolicyForDepositor_UnassignedReverts() public {
        vm.expectRevert("PolicyRegistry: no policy assigned");
        policyRegistry.getPolicyForDepositor(user1);
    }

    // ═══════════════════════════════════════════════════════════════════
    // POLICY VALIDATION BOUNDARY CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_ValidateDeposit_ExactMaxDeposit() public view {
        // Conservative: maxDepositPerTx = 100_000_000
        bool valid = policyRegistry.validateDeposit(1, 100_000_000, 0);
        assertTrue(valid);
    }

    function test_ValidateDeposit_OneOverMaxDeposit() public view {
        bool valid = policyRegistry.validateDeposit(1, 100_000_001, 0);
        assertFalse(valid);
    }

    function test_ValidateDeposit_ZeroAmount() public view {
        // Zero amount is technically valid per the policy (amount <= maxDepositPerTx)
        // but VaultCore should prevent it
        bool valid = policyRegistry.validateDeposit(1, 0, 0);
        assertTrue(valid);
    }

    function test_ValidateDeposit_ExceedsTotalExposure() public view {
        // Conservative: maxTotalExposure = 10_000_000_000
        bool valid = policyRegistry.validateDeposit(1, 5_000_000_000, 6_000_000_000);
        assertFalse(valid); // 5B + 6B > 10B
    }

    function test_ValidateDeposit_ExactlyAtTotalExposure() public view {
        // Conservative: maxDepositPerTx = 100_000_000, maxTotalExposure = 10_000_000_000
        // Use deposit within maxDepositPerTx, exposure at maxTotalExposure - deposit
        bool valid = policyRegistry.validateDeposit(1, 100_000_000, 9_900_000_000);
        assertTrue(valid); // 100M + 9_900M = 10_000M = maxTotalExposure
    }

    function test_ValidateWithdrawal_ExactMaxWithdrawal() public view {
        // Conservative: maxWithdrawalPerTx = 50_000_000
        bool valid = policyRegistry.validateWithdrawal(1, 50_000_000, 100_000_000);
        assertTrue(valid);
    }

    function test_ValidateWithdrawal_OneOverMaxWithdrawal() public view {
        bool valid = policyRegistry.validateWithdrawal(1, 50_000_001, 100_000_000);
        assertFalse(valid);
    }

    function test_ValidateWithdrawal_ExceedsPositionValue() public view {
        bool valid = policyRegistry.validateWithdrawal(1, 10_000_000, 5_000_000);
        assertFalse(valid);
    }

    function test_ValidateWithdrawal_ExactPositionValue() public view {
        bool valid = policyRegistry.validateWithdrawal(1, 10_000_000, 10_000_000);
        assertTrue(valid);
    }

    function test_ValidateWithdrawal_InactivePolicy() public {
        policyRegistry.setPolicyStatus(1, false);
        bool valid = policyRegistry.validateWithdrawal(1, 10_000_000, 100_000_000);
        assertFalse(valid);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHECK ACTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_CheckAction_DepositExactMax() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 0, 100_000_000);
        assertTrue(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.ALLOW));
    }

    function test_CheckAction_DepositOverMax() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 0, 100_000_001);
        assertFalse(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.BLOCK));
    }

    function test_CheckAction_WithdrawExactMax() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 1, 50_000_000);
        assertTrue(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.ALLOW));
    }

    function test_CheckAction_WithdrawOverMax() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 1, 50_000_001);
        assertFalse(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.REQUIRE_APPROVAL));
    }

    function test_CheckAction_RebalanceAlwaysAllowed() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 2, 999_999_999);
        assertTrue(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.ALLOW));
    }

    function test_CheckAction_UnknownActionBlocked() public view {
        (bool allowed, IPolicyRegistry.PolicyAction action) = policyRegistry.checkAction(1, 3, 100);
        assertFalse(allowed);
        assertEq(uint(action), uint(IPolicyRegistry.PolicyAction.BLOCK));
    }

    function test_CheckAction_InactivePolicyBlocksDeposit() public {
        policyRegistry.setPolicyStatus(1, false);
        (bool allowed,) = policyRegistry.checkAction(1, 0, 1);
        assertFalse(allowed);
    }

    // ═══════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_ValidateDeposit_AmountVsMax(uint256 amount) public view {
        // Conservative: maxDepositPerTx = 100_000_000
        bool valid = policyRegistry.validateDeposit(1, amount, 0);
        if (amount <= 100_000_000) {
            assertTrue(valid);
        }
        // Note: amount > maxDepositPerTx may still be valid if total exposure check passes
        // but for currentExposure=0, it should fail
        if (amount > 100_000_000) {
            assertFalse(valid);
        }
    }

    function testFuzz_ValidateWithdrawal_AmountVsMax(uint256 amount, uint256 positionValue) public view {
        vm.assume(positionValue >= amount);
        // Conservative: maxWithdrawalPerTx = 50_000_000
        bool valid = policyRegistry.validateWithdrawal(1, amount, positionValue);
        if (amount <= 50_000_000 && amount <= positionValue) {
            assertTrue(valid);
        }
    }

    function testFuzz_ValidateDeposit_TotalExposureBoundary(
        uint256 depositAmount,
        uint256 currentExposure
    ) public view {
        vm.assume(depositAmount <= 100_000_000);
        vm.assume(currentExposure <= 10_000_000_000);
        vm.assume(depositAmount + currentExposure <= type(uint256).max); // overflow guard
        // Conservative: maxTotalExposure = 10_000_000_000
        bool valid = policyRegistry.validateDeposit(1, depositAmount, currentExposure);
        if (depositAmount + currentExposure <= 10_000_000_000) {
            assertTrue(valid);
        }
    }

    function testFuzz_CreatePolicy_RiskLevels(uint8 riskLevel) public {
        vm.assume(riskLevel <= 2); // LOW=0, MEDIUM=1, HIGH=2

        address[] memory assets = new address[](1);
        assets[0] = makeAddr("asset");

        uint256 id = policyRegistry.createPolicy(
            "FuzzPolicy",
            "fuzz test",
            IPolicyRegistry.RiskLevel(riskLevel),
            1500, 4000, 800, assets,
            100_000_000, 50_000_000, 10_000_000_000, 20000
        );

        IPolicyRegistry.Policy memory p = policyRegistry.getPolicy(id);
        assertEq(uint(p.riskLevel), riskLevel);
        assertTrue(p.isActive);
    }

    function testFuzz_CheckAction_AllActionTypes(uint8 actionType, uint256 amount) public view {
        vm.assume(actionType <= 3);

        (bool allowed,) = policyRegistry.checkAction(1, actionType, amount);

        // Rebalance (type 2) always allowed for active policy
        if (actionType == 2) {
            assertTrue(allowed);
        }
    }

    function testFuzz_PolicyStatusToggle(bool status1, bool status2) public {
        policyRegistry.setPolicyStatus(1, status1);
        IPolicyRegistry.Policy memory p1 = policyRegistry.getPolicy(1);
        assertEq(p1.isActive, status1);

        policyRegistry.setPolicyStatus(1, status2);
        IPolicyRegistry.Policy memory p2 = policyRegistry.getPolicy(1);
        assertEq(p2.isActive, status2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ASSIGNMENT EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_AssignPolicy_OverwritePreviousAssignment() public {
        policyRegistry.assignPolicy(1, user1);
        IPolicyRegistry.Policy memory p1 = policyRegistry.getPolicyForDepositor(user1);
        assertEq(p1.policyId, 1);

        // Reassign to different policy
        policyRegistry.assignPolicy(2, user1);
        IPolicyRegistry.Policy memory p2 = policyRegistry.getPolicyForDepositor(user1);
        assertEq(p2.policyId, 2);
    }

    function test_AssignPolicy_MultipleDepositors() public {
        policyRegistry.assignPolicy(1, user1);
        policyRegistry.assignPolicy(2, user2);

        assertEq(policyRegistry.getPolicyForDepositor(user1).policyId, 1);
        assertEq(policyRegistry.getPolicyForDepositor(user2).policyId, 2);
    }

    function testFuzz_AssignPolicy_VariousPolicies(uint8 policyId) public {
        vm.assume(policyId >= 1 && policyId <= 3);

        policyRegistry.assignPolicy(uint256(policyId), user1);
        IPolicyRegistry.Policy memory p = policyRegistry.getPolicyForDepositor(user1);
        assertEq(p.policyId, uint256(policyId));
    }

    // ═══════════════════════════════════════════════════════════════════
    // SET POLICY EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_SetPolicy_UpdatesAllFields() public {
        address[] memory newAssets = new address[](2);
        newAssets[0] = makeAddr("asset1");
        newAssets[1] = makeAddr("asset2");

        IPolicyRegistry.Policy memory newPolicy = IPolicyRegistry.Policy({
            policyId: 1,
            owner: admin,
            name: "Updated",
            description: "updated desc",
            riskLevel: IPolicyRegistry.RiskLevel.HIGH,
            isActive: true,
            createdAt: 0,
            updatedAt: 0,
            maxDrawdownBps: 5000,
            maxSingleExposureBps: 9000,
            hedgeThresholdBps: 3000,
            allowedAssets: newAssets,
            maxDepositPerTx: 999_000_000,
            maxWithdrawalPerTx: 888_000_000,
            maxTotalExposure: 99_000_000_000,
            minCollateralRatio: 11000,
            maxLeverage: 15000,
            withdrawalDelaySeconds: 43200,
            rebalanceThresholdBps: 800,
            maxSlippageBps: 150,
            onRiskBreach: IPolicyRegistry.PolicyAction.BLOCK,
            onSolvencyWarning: IPolicyRegistry.PolicyAction.BLOCK
        });

        policyRegistry.setPolicy(1, newPolicy);

        IPolicyRegistry.Policy memory updated = policyRegistry.getPolicy(1);
        assertEq(updated.maxDrawdownBps, 5000);
        assertEq(updated.maxSingleExposureBps, 9000);
        assertEq(updated.hedgeThresholdBps, 3000);
        assertEq(updated.allowedAssets.length, 2);
        assertEq(updated.maxDepositPerTx, 999_000_000);
        assertEq(updated.minCollateralRatio, 11000);
    }
}
