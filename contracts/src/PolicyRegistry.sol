// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IPolicyRegistry.sol";

/// @title PolicyRegistry
/// @notice Registry for risk policies that govern Aegis vault operations.
///         Implements the IPolicyRegistry interface with full policy CRUD,
///         assignment, and validation logic.
contract PolicyRegistry is IPolicyRegistry {
    // --- State Variables ---

    uint256 private _nextPolicyId;

    /// @notice Mapping from policy ID => Policy
    mapping(uint256 => Policy) private _policies;

    /// @notice Mapping from depositor => policy ID
    mapping(address => uint256) private _depositorPolicies;

    // --- Modifiers ---

    modifier onlyPolicyOwner(uint256 policyId) {
        require(
            _policies[policyId].owner == msg.sender,
            "PolicyRegistry: caller is not policy owner"
        );
        _;
    }

    modifier policyExists(uint256 policyId) {
        require(
            _policies[policyId].owner != address(0),
            "PolicyRegistry: policy does not exist"
        );
        _;
    }

    // --- Constructor ---

    constructor() {
        _nextPolicyId = 1;

        // Create default policies for each risk level
        _createDefaultPolicy("Conservative", "Low risk tolerance policy", RiskLevel.LOW,
            100_000_000,   // 100 XRP max deposit per tx
            50_000_000,    // 50 XRP max withdrawal per tx
            10_000_000_000, // 10,000 XRP max total exposure
            20000           // 200% min collateral ratio
        );

        _createDefaultPolicy("Balanced", "Medium risk tolerance policy", RiskLevel.MEDIUM,
            500_000_000,   // 500 XRP max deposit per tx
            250_000_000,   // 250 XRP max withdrawal per tx
            50_000_000_000, // 50,000 XRP max total exposure
            15000           // 150% min collateral ratio
        );

        _createDefaultPolicy("Aggressive", "High risk tolerance policy", RiskLevel.HIGH,
            2_000_000_000, // 2,000 XRP max deposit per tx
            1_000_000_000, // 1,000 XRP max withdrawal per tx
            200_000_000_000, // 200,000 XRP max total exposure
            12000           // 120% min collateral ratio
        );
    }

    // --- View Functions ---

    /// @inheritdoc IPolicyRegistry
    function getPolicy(uint256 policyId) external view override policyExists(policyId) returns (Policy memory) {
        return _policies[policyId];
    }

    /// @inheritdoc IPolicyRegistry
    function getPolicyForDepositor(address depositor) external view override returns (Policy memory) {
        uint256 policyId = _depositorPolicies[depositor];
        require(policyId > 0, "PolicyRegistry: no policy assigned");
        return _policies[policyId];
    }

    /// @inheritdoc IPolicyRegistry
    function getPolicyCount() external view override returns (uint256) {
        return _nextPolicyId - 1;
    }

    /// @inheritdoc IPolicyRegistry
    function checkAction(
        uint256 policyId,
        uint8 actionType,
        uint256 amount
    ) external view override policyExists(policyId) returns (bool, PolicyAction) {
        Policy storage policy = _policies[policyId];

        if (!policy.isActive) {
            return (false, PolicyAction.BLOCK);
        }

        // actionType: 0=deposit, 1=withdraw, 2=rebalance
        if (actionType == 0) {
            // Deposit
            if (amount > policy.maxDepositPerTx) {
                return (false, PolicyAction.BLOCK);
            }
            return (true, PolicyAction.ALLOW);
        } else if (actionType == 1) {
            // Withdrawal
            if (amount > policy.maxWithdrawalPerTx) {
                return (false, PolicyAction.REQUIRE_APPROVAL);
            }
            return (true, PolicyAction.ALLOW);
        } else if (actionType == 2) {
            // Rebalance
            return (true, PolicyAction.ALLOW);
        }

        return (false, PolicyAction.BLOCK);
    }

    /// @inheritdoc IPolicyRegistry
    function validateDeposit(
        uint256 policyId,
        uint256 depositAmount,
        uint256 currentTotalExposure
    ) external view override policyExists(policyId) returns (bool) {
        Policy storage policy = _policies[policyId];

        if (!policy.isActive) return false;
        if (depositAmount > policy.maxDepositPerTx) return false;
        if (currentTotalExposure + depositAmount > policy.maxTotalExposure) return false;

        return true;
    }

    /// @inheritdoc IPolicyRegistry
    function validateWithdrawal(
        uint256 policyId,
        uint256 withdrawalAmount,
        uint256 currentPositionValue
    ) external view override policyExists(policyId) returns (bool) {
        Policy storage policy = _policies[policyId];

        if (!policy.isActive) return false;
        if (withdrawalAmount > policy.maxWithdrawalPerTx) return false;
        if (withdrawalAmount > currentPositionValue) return false;

        return true;
    }

    // --- State-Changing Functions ---

    /// @inheritdoc IPolicyRegistry
    function createPolicy(
        string calldata name,
        string calldata description,
        RiskLevel riskLevel,
        uint256 maxDepositPerTx,
        uint256 maxWithdrawalPerTx,
        uint256 maxTotalExposure,
        uint256 minCollateralRatio
    ) external override returns (uint256) {
        return _createDefaultPolicy(name, description, riskLevel,
            maxDepositPerTx, maxWithdrawalPerTx, maxTotalExposure, minCollateralRatio);
    }

    /// @inheritdoc IPolicyRegistry
    function updatePolicy(
        uint256 policyId,
        string calldata fieldChanged
    ) external override onlyPolicyOwner(policyId) {
        _policies[policyId].updatedAt = block.timestamp;
        emit PolicyUpdated(policyId, msg.sender, fieldChanged);
    }

    /// @inheritdoc IPolicyRegistry
    function setPolicyStatus(uint256 policyId, bool isActive)
        external
        override
        onlyPolicyOwner(policyId)
    {
        _policies[policyId].isActive = isActive;
        _policies[policyId].updatedAt = block.timestamp;
        emit PolicyStatusChanged(policyId, isActive);
    }

    /// @inheritdoc IPolicyRegistry
    function assignPolicy(uint256 policyId, address depositor)
        external
        override
        policyExists(policyId)
    {
        require(depositor != address(0), "PolicyRegistry: zero address depositor");
        _depositorPolicies[depositor] = policyId;
        emit PolicyAssigned(policyId, depositor);
    }

    // --- Internal Functions ---

    function _createDefaultPolicy(
        string memory name,
        string memory description,
        RiskLevel riskLevel,
        uint256 maxDepositPerTx,
        uint256 maxWithdrawalPerTx,
        uint256 maxTotalExposure,
        uint256 minCollateralRatio
    ) internal returns (uint256) {
        uint256 policyId = _nextPolicyId++;

        Policy storage policy = _policies[policyId];
        policy.policyId = policyId;
        policy.owner = msg.sender;
        policy.name = name;
        policy.description = description;
        policy.riskLevel = riskLevel;
        policy.isActive = true;
        policy.createdAt = block.timestamp;
        policy.updatedAt = block.timestamp;
        policy.maxDepositPerTx = maxDepositPerTx;
        policy.maxWithdrawalPerTx = maxWithdrawalPerTx;
        policy.maxTotalExposure = maxTotalExposure;
        policy.maxSinglePositionRatio = 5000; // 50% default
        policy.minCollateralRatio = minCollateralRatio;
        policy.maxLeverage = 10000; // 100% = 1x leverage
        policy.withdrawalDelaySeconds = 86400; // 1 day
        policy.rebalanceThresholdBps = 500; // 5% threshold
        policy.maxSlippageBps = 100; // 1% max slippage
        policy.onRiskBreach = PolicyAction.REQUIRE_APPROVAL;
        policy.onSolvencyWarning = PolicyAction.DELAY;

        emit PolicyCreated(policyId, msg.sender, riskLevel, name);

        return policyId;
    }
}
