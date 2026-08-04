// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/VerifierRole.sol";
import "../src/PolicyRegistry.sol";
import "../src/SolvencyRoot.sol";
import "../src/InstructionSender.sol";
import "../src/VaultCore.sol";
import "../src/interfaces/vault/IVerifierRole.sol";

/// @title MockFlareRegistry
/// @notice Minimal mock for FlareContractRegistry to enable local VaultCore testing.
contract MockFlareRegistry {
    mapping(bytes32 => address) private _contracts;

    function setContractAddressByName(string memory name, address addr) external {
        _contracts[keccak256(bytes(name))] = addr;
    }

    function getContractAddressByName(string memory name) external view returns (address) {
        return _contracts[keccak256(bytes(name))];
    }
}

/// @title MockAssetManager
/// @notice Minimal mock for IAssetManager to return fAsset token address.
contract MockAssetManager {
    address private _fAsset;

    constructor(address fAsset_) {
        _fAsset = fAsset_;
    }

    function fAsset() external view returns (address) {
        return _fAsset;
    }
}

/// @title MockFXRP
/// @notice Minimal mock for FXRP token (transfer/transferFrom always succeed).
contract MockFXRP {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @title MockFtsoV2
/// @notice Minimal mock for FtsoV2 that returns a fixed XRP/USD price.
contract MockFtsoV2 {
    uint256 private _price;
    int8 private _decimals;
    uint64 private _timestamp;

    constructor(uint256 price_, int8 decimals_) {
        _price = price_;
        _decimals = decimals_;
        _timestamp = uint64(block.timestamp);
    }

    function getFeedById(bytes21) external view returns (uint256 value, int8 decimals, uint64 timestamp) {
        return (_price, _decimals, _timestamp);
    }
}

/// @title VaultCoreEdgeCases
/// @notice hardening: edge-case and fuzz tests for VaultCore's
/// safe-state, circuit breaker, emergency mode, and access control.
/// Uses mocks for FlareContractRegistry, AssetManager, FXRP, FtsoV2.
contract VaultCoreEdgeCases is Test {
    VerifierRole public verifierRole;
    PolicyRegistry public policyRegistry;
    SolvencyRoot public solvencyRoot;
    InstructionSender public instructionSender;
    VaultCore public vaultCore;

    MockFlareRegistry public mockRegistry;
    MockAssetManager public mockAssetManager;
    MockFXRP public mockFxrp;
    MockFtsoV2 public mockFtso;

    address public admin;
    address public verifier;
    address public verifier2;
    address public operator;
    address public depositor;
    address public nonAdmin;

    uint256 constant MIN_COLLATERAL_RATIO = 15000;
    bytes32 constant TEE_IDENTITY = keccak256("test-tee-identity");
    bytes32 constant TEE_IDENTITY_2 = keccak256("test-tee-identity-2");

    uint256 constant XRP_PRICE = 500000;
    uint256 constant MIN_DEPOSIT = 1_000_000;
    uint256 constant MAX_DEPOSIT = 1_000_000_000;

    function setUp() public {
        admin = address(this);
        verifier = makeAddr("verifier");
        verifier2 = makeAddr("verifier2");
        operator = makeAddr("operator");
        depositor = makeAddr("depositor");
        nonAdmin = makeAddr("nonAdmin");

        // Deploy mocks
        mockFxrp = new MockFXRP();
        mockAssetManager = new MockAssetManager(address(mockFxrp));
        mockFtso = new MockFtsoV2(XRP_PRICE, 5);
        mockRegistry = new MockFlareRegistry();

        mockRegistry.setContractAddressByName("AssetManagerFXRP", address(mockAssetManager));
        mockRegistry.setContractAddressByName("FtsoV2", address(mockFtso));

        // Deploy core contracts
        verifierRole = new VerifierRole();
        policyRegistry = new PolicyRegistry();
        solvencyRoot = new SolvencyRoot(address(verifierRole), MIN_COLLATERAL_RATIO);
        instructionSender = new InstructionSender(address(verifierRole));

        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier);
        verifierRole.registerVerifier(verifier, TEE_IDENTITY);
        verifierRole.grantRole(IVerifierRole.Role.VERIFIER, verifier2);
        verifierRole.registerVerifier(verifier2, TEE_IDENTITY_2);

        vaultCore = new VaultCore(
            address(mockRegistry),
            address(verifierRole),
            address(policyRegistry),
            address(solvencyRoot),
            address(instructionSender),
            MIN_DEPOSIT,
            MAX_DEPOSIT
        );

        mockFxrp.mint(depositor, 10_000_000_000);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SAFE STATE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_SafeState_EnterAndExit() public {
        assertFalse(vaultCore.isSafeState());

        vm.prank(verifier);
        vaultCore.enterSafeState("TEE failure");
        assertTrue(vaultCore.isSafeState());
        assertEq(vaultCore.getSafeStateReason(), "TEE failure");
        assertGt(vaultCore.getSafeStateSince(), 0);

        vm.prank(verifier);
        vaultCore.exitSafeState();
        assertFalse(vaultCore.isSafeState());
        assertEq(vaultCore.getSafeStateReason(), "");
        assertEq(vaultCore.getSafeStateSince(), 0);
    }

    function test_SafeState_EnterIdempotent() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("first reason");
        uint256 sinceBefore = vaultCore.getSafeStateSince();

        vm.prank(verifier);
        vaultCore.enterSafeState("second reason");
        assertTrue(vaultCore.isSafeState());
        assertEq(vaultCore.getSafeStateSince(), sinceBefore);
    }

    function test_SafeState_ExitWhenNotInSafeState_NoOp() public {
        assertFalse(vaultCore.isSafeState());
        vm.prank(verifier);
        vaultCore.exitSafeState();
        assertFalse(vaultCore.isSafeState());
    }

    function test_SafeState_NonVerifierCannotEnter() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.enterSafeState("hack");
    }

    function test_SafeState_NonVerifierCannotExit() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("legit");
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.exitSafeState();
    }

    function test_SafeState_AdminCanEnter() public {
        vaultCore.enterSafeState("admin triggered");
        assertTrue(vaultCore.isSafeState());
    }

    function testFuzz_SafeState_ReasonVariants(string memory reason) public {
        vm.assume(bytes(reason).length > 0);
        vm.assume(bytes(reason).length <= 200);
        vm.prank(verifier);
        vaultCore.enterSafeState(reason);
        assertTrue(vaultCore.isSafeState());
        assertEq(vaultCore.getSafeStateReason(), reason);
    }

    // ═══════════════════════════════════════════════════════════════════
    // CIRCUIT BREAKER EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_CircuitBreaker_DefaultThreshold() public view {
        assertEq(vaultCore.getCircuitBreakerThreshold(), 3);
    }

    function test_CircuitBreaker_RecordFailuresBelowThreshold() public {
        vm.prank(verifier);
        vaultCore.recordFailure("failure 1");
        assertEq(vaultCore.getConsecutiveFails(), 1);
        assertFalse(vaultCore.isSafeState());

        vm.prank(verifier);
        vaultCore.recordFailure("failure 2");
        assertEq(vaultCore.getConsecutiveFails(), 2);
        assertFalse(vaultCore.isSafeState());
    }

    function test_CircuitBreaker_TripsOnThreshold() public {
        vm.prank(verifier);
        vaultCore.recordFailure("failure 1");
        vm.prank(verifier);
        vaultCore.recordFailure("failure 2");
        vm.prank(verifier);
        vaultCore.recordFailure("failure 3");

        assertEq(vaultCore.getConsecutiveFails(), 3);
        assertTrue(vaultCore.isSafeState());
    }

    function test_CircuitBreaker_ResetClearsCounter() public {
        vm.prank(verifier);
        vaultCore.recordFailure("failure 1");
        vm.prank(verifier);
        vaultCore.recordFailure("failure 2");

        vm.prank(verifier);
        vaultCore.resetFailures();
        assertEq(vaultCore.getConsecutiveFails(), 0);
        assertFalse(vaultCore.isSafeState());
    }

    function test_CircuitBreaker_ResetAfterExitSafeState() public {
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(verifier);
            vaultCore.recordFailure("failure");
        }
        assertTrue(vaultCore.isSafeState());

        vm.prank(verifier);
        vaultCore.exitSafeState();
        assertEq(vaultCore.getConsecutiveFails(), 0);
    }

    function test_CircuitBreaker_CustomThreshold(uint8 threshold) public {
        vm.assume(threshold >= 1);
        vm.assume(threshold <= 20);

        vaultCore.setCircuitBreakerThreshold(uint256(threshold));
        assertEq(vaultCore.getCircuitBreakerThreshold(), uint256(threshold));

        for (uint256 i = 0; i < uint256(threshold) - 1; i++) {
            vm.prank(verifier);
            vaultCore.recordFailure("failure");
            assertFalse(vaultCore.isSafeState());
        }

        vm.prank(verifier);
        vaultCore.recordFailure("final failure");
        assertTrue(vaultCore.isSafeState());
    }

    function test_CircuitBreaker_SetThresholdZeroReverts() public {
        vm.expectRevert("VaultCore: threshold must be > 0");
        vaultCore.setCircuitBreakerThreshold(0);
    }

    function test_CircuitBreaker_NonAdminCannotSetThreshold() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not admin");
        vaultCore.setCircuitBreakerThreshold(5);
    }

    function test_CircuitBreaker_NonVerifierCannotRecordFailure() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.recordFailure("hack");
    }

    function test_CircuitBreaker_NonVerifierCannotResetFailures() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.resetFailures();
    }

    function testFuzz_CircuitBreaker_FailureSequence(uint8 numFailures) public {
        vm.assume(numFailures <= 10);

        for (uint256 i = 0; i < numFailures; i++) {
            vm.prank(verifier);
            vaultCore.recordFailure("failure");
        }

        assertEq(vaultCore.getConsecutiveFails(), numFailures);
        if (numFailures >= 3) {
            assertTrue(vaultCore.isSafeState());
        } else {
            assertFalse(vaultCore.isSafeState());
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // EMERGENCY MODE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_EmergencyMode_SetAndClear() public {
        assertFalse(vaultCore.isEmergencyMode());
        vaultCore.setEmergencyMode(true);
        assertTrue(vaultCore.isEmergencyMode());
        assertGt(vaultCore.getEmergencySince(), 0);

        vaultCore.setEmergencyMode(false);
        assertFalse(vaultCore.isEmergencyMode());
        assertEq(vaultCore.getEmergencySince(), 0);
    }

    function test_EmergencyMode_SetIdempotent() public {
        vaultCore.setEmergencyMode(true);
        uint256 sinceBefore = vaultCore.getEmergencySince();
        vaultCore.setEmergencyMode(true);
        assertTrue(vaultCore.isEmergencyMode());
        assertEq(vaultCore.getEmergencySince(), sinceBefore);
    }

    function test_EmergencyMode_ClearWhenNotInEmergency_NoOp() public {
        assertFalse(vaultCore.isEmergencyMode());
        vaultCore.setEmergencyMode(false);
        assertFalse(vaultCore.isEmergencyMode());
    }

    function test_EmergencyMode_NonAdminCannotSet() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not admin");
        vaultCore.setEmergencyMode(true);
    }

    function test_EmergencyMode_TriggerFromSolvencyBreach() public {
        assertFalse(vaultCore.isEmergencyMode());
        vm.prank(verifier);
        vaultCore.triggerEmergencyFromSolvencyBreach("collateral ratio below threshold");
        assertTrue(vaultCore.isEmergencyMode());
    }

    function test_EmergencyMode_TriggerFromSolvencyBreachIdempotent() public {
        vm.prank(verifier);
        vaultCore.triggerEmergencyFromSolvencyBreach("first breach");
        uint256 sinceBefore = vaultCore.getEmergencySince();

        vm.prank(verifier);
        vaultCore.triggerEmergencyFromSolvencyBreach("second breach");
        assertEq(vaultCore.getEmergencySince(), sinceBefore);
    }

    function test_EmergencyMode_NonVerifierCannotTriggerSolvencyBreach() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.triggerEmergencyFromSolvencyBreach("hack");
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_View_BalanceOfZeroForUnknownAddress() public {
        address unknown = makeAddr("unknown");
        assertEq(vaultCore.balanceOf(unknown), 0);
    }

    function test_View_PolicyOfZeroForUnknownAddress() public {
        address unknown = makeAddr("unknown");
        assertEq(vaultCore.policyOf(unknown), 0);
    }

    function test_View_TotalFxrpDepositedZero() public view {
        assertEq(vaultCore.getTotalFxrpDeposited(), 0);
    }

    function test_View_ActivePositionCountZero() public view {
        assertEq(vaultCore.getActivePositionCount(), 0);
    }

    function testFuzz_View_BalanceOfAnyAddress(address who) public view {
        assertEq(vaultCore.balanceOf(who), 0);
    }

    function testFuzz_View_PolicyOfAnyAddress(address who) public view {
        assertEq(vaultCore.policyOf(who), 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ACCESS CONTROL EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_AccessControl_DepositBlockedInSafeState() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("maintenance");
        vm.prank(depositor);
        vm.expectRevert("VaultCore: vault is in safe state");
        vaultCore.depositFXRP(MIN_DEPOSIT, 1);
    }

    function test_AccessControl_DepositBlockedInEmergencyMode() public {
        vaultCore.setEmergencyMode(true);
        vm.prank(depositor);
        vm.expectRevert("VaultCore: vault is in emergency mode");
        vaultCore.depositFXRP(MIN_DEPOSIT, 1);
    }

    function test_AccessControl_RevalueOnlyVerifier() public {
        vm.prank(nonAdmin);
        vm.expectRevert("VaultCore: caller is not verifier");
        vaultCore.revalueAllPositions();
    }

    // ═══════════════════════════════════════════════════════════════════
    // INTERACTION EDGE CASES
    // ═══════════════════════════════════════════════════════════════════

    function test_Interaction_SafeStateAndEmergencyCoexist() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("TEE down");
        vaultCore.setEmergencyMode(true);
        assertTrue(vaultCore.isSafeState());
        assertTrue(vaultCore.isEmergencyMode());
    }

    function test_Interaction_CircuitBreakerDoesNotAffectEmergencyMode() public {
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(verifier);
            vaultCore.recordFailure("failure");
        }
        assertTrue(vaultCore.isSafeState());
        assertFalse(vaultCore.isEmergencyMode());
    }

    function test_Interaction_EmergencyModeDoesNotAffectCircuitBreaker() public {
        vaultCore.setEmergencyMode(true);
        assertTrue(vaultCore.isEmergencyMode());
        vm.prank(verifier);
        vaultCore.recordFailure("failure");
        assertEq(vaultCore.getConsecutiveFails(), 1);
    }

    function test_Interaction_MultipleVerifiersCanEnterSafeState() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("verifier1 reason");
        assertTrue(vaultCore.isSafeState());

        vm.prank(verifier2);
        vaultCore.exitSafeState();
        assertFalse(vaultCore.isSafeState());
    }

    function test_Interaction_MultipleVerifiersRecordFailures() public {
        vm.prank(verifier);
        vaultCore.recordFailure("v1 failure");
        vm.prank(verifier2);
        vaultCore.recordFailure("v2 failure");
        assertEq(vaultCore.getConsecutiveFails(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATE MACHINE INVARIANTS
    // ═══════════════════════════════════════════════════════════════════

    function test_Invariant_SafeStateImpliesDepositBlocked() public {
        vm.prank(verifier);
        vaultCore.enterSafeState("test");
        vm.prank(depositor);
        vm.expectRevert("VaultCore: vault is in safe state");
        vaultCore.depositFXRP(MIN_DEPOSIT, 1);
    }

    function test_Invariant_EmergencyModeImpliesDepositBlocked() public {
        vaultCore.setEmergencyMode(true);
        vm.prank(depositor);
        vm.expectRevert("VaultCore: vault is in emergency mode");
        vaultCore.depositFXRP(MIN_DEPOSIT, 1);
    }

    function testFuzz_Invariant_CircuitBreakerConsistency(uint8 numFailures, bool doReset) public {
        vm.assume(numFailures <= 10);
        for (uint256 i = 0; i < numFailures; i++) {
            vm.prank(verifier);
            vaultCore.recordFailure("failure");
        }
        if (doReset) {
            vm.prank(verifier);
            vaultCore.resetFailures();
            assertEq(vaultCore.getConsecutiveFails(), 0);
        } else {
            assertEq(vaultCore.getConsecutiveFails(), numFailures);
            if (numFailures >= 3) {
                assertTrue(vaultCore.isSafeState());
            }
        }
    }

    function testFuzz_Invariant_ThresholdAlwaysPositive(uint256 threshold) public {
        vm.assume(threshold > 0);
        vm.assume(threshold <= 100);
        vaultCore.setCircuitBreakerThreshold(threshold);
        assertGt(vaultCore.getCircuitBreakerThreshold(), 0);
    }
}
