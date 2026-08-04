// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/vault/IPolicyRegistry.sol";

/// @title PolicyRegistry
/// @notice Registry for risk policies that govern Aegis vault operations.
/// Implements the vault API:
/// maxDrawdownBps, maxSingleExposureBps, hedgeThresholdBps, allowedAssets.
/// Three default policies (Conservative/Balanced/Aggressive) are created at deploy.
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
        // Conservative (LOW): max 15% drawdown, 40% single exposure, 8% hedge threshold
        address[] memory conservativeAssets = new address[](1);
        conservativeAssets[0] = address(0); // FXRP placeholder — will be set by vault
        _createDefaultPolicy("Conservative", "Low risk tolerance policy", RiskLevel.LOW,
            1500,  // 15% max drawdown
            4000,  // 40% max single exposure
            800,   // 8% hedge threshold
            conservativeAssets,
            100_000_000,     // 100 XRP max deposit per tx
            50_000_000,      // 50 XRP max withdrawal per tx
            10_000_000_000,  // 10,000 XRP max total exposure
            20000            // 200% min collateral ratio
        );

        // Balanced (MEDIUM): max 25% drawdown, 60% single exposure, 12% hedge threshold
        address[] memory balancedAssets = new address[](2);
        balancedAssets[0] = address(0); // FXRP
        balancedAssets[1] = address(0); // sFLR placeholder
        _createDefaultPolicy("Balanced", "Medium risk tolerance policy", RiskLevel.MEDIUM,
            2500,  // 25% max drawdown
            6000,  // 60% max single exposure
            1200,  // 12% hedge threshold
            balancedAssets,
            500_000_000,     // 500 XRP max deposit per tx
            250_000_000,     // 250 XRP max withdrawal per tx
            50_000_000_000,  // 50,000 XRP max total exposure
            15000            // 150% min collateral ratio
        );

        // Aggressive (HIGH): max 40% drawdown, 80% single exposure, 20% hedge threshold
        address[] memory aggressiveAssets = new address[](3);
        aggressiveAssets[0] = address(0); // FXRP
        aggressiveAssets[1] = address(0); // sFLR
        aggressiveAssets[2] = address(0); // Other
        _createDefaultPolicy("Aggressive", "High risk tolerance policy", RiskLevel.HIGH,
            4000,  // 40% max drawdown
            8000,  // 80% max single exposure
            2000,  // 20% hedge threshold
            aggressiveAssets,
            2_000_000_000,     // 2,000 XRP max deposit per tx
            1_000_000_000,     // 1,000 XRP max withdrawal per tx
            200_000_000_000,   // 200,000 XRP max total exposure
            12000              // 120% min collateral ratio
        );
    }

    // --- Vault API ---

    /// @inheritdoc IPolicyRegistry
    function setPolicy(uint256 policyId, Policy calldata p) external override onlyPolicyOwner(policyId) {
        Policy storage policy = _policies[policyId];

        // Update all fields from the provided policy
        policy.maxDrawdownBps = p.maxDrawdownBps;
        policy.maxSingleExposureBps = p.maxSingleExposureBps;
        policy.hedgeThresholdBps = p.hedgeThresholdBps;
        policy.allowedAssets = p.allowedAssets;
        policy.maxDepositPerTx = p.maxDepositPerTx;
        policy.maxWithdrawalPerTx = p.maxWithdrawalPerTx;
        policy.maxTotalExposure = p.maxTotalExposure;
        policy.minCollateralRatio = p.minCollateralRatio;
        policy.maxLeverage = p.maxLeverage;
        policy.withdrawalDelaySeconds = p.withdrawalDelaySeconds;
        policy.rebalanceThresholdBps = p.rebalanceThresholdBps;
        policy.maxSlippageBps = p.maxSlippageBps;
        policy.onRiskBreach = p.onRiskBreach;
        policy.onSolvencyWarning = p.onSolvencyWarning;
        policy.updatedAt = block.timestamp;

        emit PolicyUpdated(policyId, msg.sender, "bulk update");
    }

    /// @inheritdoc IPolicyRegistry
    function getPolicy(uint256 policyId) external view override policyExists(policyId) returns (Policy memory) {
        return _policies[policyId];
    }

    // --- Extended API ---

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

    /// @inheritdoc IPolicyRegistry
    function createPolicy(
        string calldata name,
        string calldata description,
        RiskLevel riskLevel,
        uint256 maxDrawdownBps,
        uint256 maxSingleExposureBps,
        uint256 hedgeThresholdBps,
        address[] calldata allowedAssets,
        uint256 maxDepositPerTx,
        uint256 maxWithdrawalPerTx,
        uint256 maxTotalExposure,
        uint256 minCollateralRatio
    ) external override returns (uint256) {
        return _createDefaultPolicy(name, description, riskLevel,
            maxDrawdownBps, maxSingleExposureBps, hedgeThresholdBps, allowedAssets,
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
        uint256 maxDrawdownBps,
        uint256 maxSingleExposureBps,
        uint256 hedgeThresholdBps,
        address[] memory allowedAssets,
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
        // Vault fields
        policy.maxDrawdownBps = maxDrawdownBps;
        policy.maxSingleExposureBps = maxSingleExposureBps;
        policy.hedgeThresholdBps = hedgeThresholdBps;
        policy.allowedAssets = allowedAssets;
        // Extended fields
        policy.maxDepositPerTx = maxDepositPerTx;
        policy.maxWithdrawalPerTx = maxWithdrawalPerTx;
        policy.maxTotalExposure = maxTotalExposure;
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
