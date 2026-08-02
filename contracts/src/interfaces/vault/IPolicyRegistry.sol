// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IPolicyRegistry
/// @notice Registry for risk policies that govern Aegis vault operations.
///         Each policy defines constraints on deposits, withdrawals, rebalancing,
///         and risk thresholds. Policies are enforced by the VaultCore and
///         ActionExecutor modules.
/// @dev Policies are created by vault operators and can be assigned to specific
///      depositors or applied globally. The PolicyEngine in the FCC extension
///      reads these policies and enforces them deterministically within TEE.
interface IPolicyRegistry {
    // --- Enums ---

    /// @notice Risk level of a policy
    enum RiskLevel {
        LOW,        // Conservative: low risk tolerance
        MEDIUM,     // Balanced: moderate risk tolerance
        HIGH,       // Aggressive: high risk tolerance
        CRITICAL    // Emergency: maximum restrictions
    }

    /// @notice Type of policy action
    enum PolicyAction {
        ALLOW,      // Action is allowed
        REQUIRE_APPROVAL,  // Action requires additional approval
        DELAY,      // Action is delayed by a time lock
        BLOCK       // Action is blocked
    }

    // --- Structs ---

    /// @notice A risk policy definition
    struct Policy {
        uint256 policyId;               // Unique policy identifier
        address owner;                  // Policy owner (vault operator)
        string name;                    // Human-readable policy name
        string description;             // Policy description
        RiskLevel riskLevel;            // Risk level classification
        bool isActive;                  // Whether the policy is active
        uint256 createdAt;              // Creation timestamp
        uint256 updatedAt;              // Last update timestamp
        uint256 maxDepositPerTx;        // Maximum deposit per transaction (UBA)
        uint256 maxWithdrawalPerTx;     // Maximum withdrawal per transaction (UBA)
        uint256 maxTotalExposure;       // Maximum total vault exposure (USD, 5 decimals)
        uint256 maxSinglePositionRatio; // Maximum ratio of single position to total (basis points)
        uint256 minCollateralRatio;     // Minimum collateral ratio (basis points, e.g., 15000 = 150%)
        uint256 maxLeverage;            // Maximum leverage ratio (basis points)
        uint256 withdrawalDelaySeconds; // Delay before withdrawal can be completed
        uint256 rebalanceThresholdBps;  // Rebalance trigger threshold (basis points)
        uint256 maxSlippageBps;         // Maximum allowed slippage (basis points)
        PolicyAction onRiskBreach;      // Action when risk threshold is breached
        PolicyAction onSolvencyWarning; // Action when solvency warning is triggered
    }

    // --- Events ---

    /// @notice Emitted when a new policy is created
    event PolicyCreated(
        uint256 indexed policyId,
        address indexed owner,
        RiskLevel riskLevel,
        string name
    );

    /// @notice Emitted when a policy is updated
    event PolicyUpdated(
        uint256 indexed policyId,
        address indexed owner,
        string fieldChanged
    );

    /// @notice Emitted when a policy is activated or deactivated
    event PolicyStatusChanged(
        uint256 indexed policyId,
        bool isActive
    );

    /// @notice Emitted when a policy is assigned to a depositor
    event PolicyAssigned(
        uint256 indexed policyId,
        address indexed depositor
    );

    // --- Functions ---

    /// @notice Create a new policy
    /// @param name Policy name
    /// @param description Policy description
    /// @param riskLevel Risk level classification
    /// @param maxDepositPerTx Maximum deposit per transaction
    /// @param maxWithdrawalPerTx Maximum withdrawal per transaction
    /// @param maxTotalExposure Maximum total vault exposure
    /// @param minCollateralRatio Minimum collateral ratio (basis points)
    /// @return policyId The ID of the newly created policy
    function createPolicy(
        string calldata name,
        string calldata description,
        RiskLevel riskLevel,
        uint256 maxDepositPerTx,
        uint256 maxWithdrawalPerTx,
        uint256 maxTotalExposure,
        uint256 minCollateralRatio
    ) external returns (uint256 policyId);

    /// @notice Update a policy's parameters
    /// @param policyId The policy to update
    /// @param fieldChanged Description of the field changed
    function updatePolicy(
        uint256 policyId,
        string calldata fieldChanged
    ) external;

    /// @notice Activate or deactivate a policy
    /// @param policyId The policy to toggle
    /// @param isActive Whether the policy should be active
    function setPolicyStatus(uint256 policyId, bool isActive) external;

    /// @notice Assign a policy to a depositor
    /// @param policyId The policy to assign
    /// @param depositor The depositor to assign the policy to
    function assignPolicy(uint256 policyId, address depositor) external;

    /// @notice Get a policy by ID
    /// @param policyId The policy ID
    /// @return policy The policy data
    function getPolicy(uint256 policyId) external view returns (Policy memory policy);

    /// @notice Get the policy assigned to a depositor
    /// @param depositor The depositor's address
    /// @return policy The assigned policy
    function getPolicyForDepositor(address depositor) external view returns (Policy memory policy);

    /// @notice Check if an action is allowed under a policy
    /// @param policyId The policy to check
    /// @param actionType The type of action (0=deposit, 1=withdraw, 2=rebalance)
    /// @param amount The amount of the action
    /// @return allowed Whether the action is allowed
    /// @return action The policy action to take
    function checkAction(
        uint256 policyId,
        uint8 actionType,
        uint256 amount
    ) external view returns (bool allowed, PolicyAction action);

    /// @notice Get the total number of policies
    /// @return count Number of policies
    function getPolicyCount() external view returns (uint256 count);

    /// @notice Validate that a deposit complies with the policy
    /// @param policyId The policy to validate against
    /// @param depositAmount The proposed deposit amount
    /// @param currentTotalExposure Current total vault exposure
    /// @return isValid Whether the deposit is valid under the policy
    function validateDeposit(
        uint256 policyId,
        uint256 depositAmount,
        uint256 currentTotalExposure
    ) external view returns (bool isValid);

    /// @notice Validate that a withdrawal complies with the policy
    /// @param policyId The policy to validate against
    /// @param withdrawalAmount The proposed withdrawal amount
    /// @param currentPositionValue The current position's USD value
    /// @return isValid Whether the withdrawal is valid under the policy
    function validateWithdrawal(
        uint256 policyId,
        uint256 withdrawalAmount,
        uint256 currentPositionValue
    ) external view returns (bool isValid);
}
