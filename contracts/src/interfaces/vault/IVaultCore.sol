// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../fassets/IFlareContractRegistry.sol";
import "../fassets/IAssetManager.sol";
import "../fassets/IFtsoV2.sol";
import "../fdc/IPayment.sol";
import "../pmw/IWalletProjectManagerFacet.sol";

/// @title IVaultCore
/// @notice Core vault contract for Aegis — manages FXRP deposits, withdrawals,
///         and collateral tracking using Flare FAssets and FTSO price feeds.
/// @dev This is the primary entry point for institutional depositors.
///      All FXRP deposits are tracked as collateral positions with FTSO-denominated
///      valuations. The vault enforces policy constraints from PolicyRegistry
///      and reports solvency through SolvencyRoot.
interface IVaultCore {
    // --- Structs ---

    /// @notice A depositor's position in the vault
    struct Position {
        address depositor;          // The depositor's EVM address
        uint256 fxrpAmount;         // Amount of FXRP deposited (UBA, 6 decimals)
        uint256 depositTimestamp;   // Timestamp of the deposit
        uint256 lastValuation;      // Last USD valuation (5 decimals)
        bool isActive;              // Whether the position is active
    }

    /// @notice Vault configuration parameters
    struct VaultConfig {
        address assetManagerFXRP;   // AssetManagerFXRP contract address
        address fxrpToken;          // FXRP ERC-20 token address
        address ftsoV2;             // FTSO V2 contract address
        address policyRegistry;     // PolicyRegistry contract address
        address solvencyRoot;       // SolvencyRoot contract address
        address instructionSender;  // InstructionSender contract address
        uint256 minDepositAmount;   // Minimum deposit amount in UBA
        uint256 maxDepositAmount;   // Maximum deposit amount in UBA
        uint256 withdrawalWaitPeriod; // Minimum wait period between deposit and withdrawal
    }

    // --- Events ---

    /// @notice Emitted when a deposit is made
    event DepositMade(
        address indexed depositor,
        uint256 fxrpAmount,
        uint256 usdValuation,
        uint256 positionId
    );

    /// @notice Emitted when a withdrawal is initiated
    event WithdrawalInitiated(
        address indexed depositor,
        uint256 fxrpAmount,
        uint256 positionId
    );

    /// @notice Emitted when a withdrawal is completed
    event WithdrawalCompleted(
        address indexed depositor,
        uint256 fxrpAmount,
        uint256 positionId
    );

    /// @notice Emitted when a position is revalued using FTSO
    event PositionRevalued(
        uint256 indexed positionId,
        uint256 newUsdValuation,
        uint256 timestamp
    );

    /// @notice Emitted when an emergency withdrawal is triggered
    event EmergencyWithdrawal(
        address indexed depositor,
        uint256 fxrpAmount,
        string reason
    );

    // --- Functions ---

    /// @notice Deposit FXRP into the vault
    /// @param fxrpAmount Amount of FXRP to deposit (UBA, 6 decimals)
    /// @return positionId The ID of the newly created position
    function deposit(uint256 fxrpAmount) external returns (uint256 positionId);

    /// @notice Initiate a withdrawal from the vault
    /// @param positionId The position to withdraw from
    /// @param fxrpAmount Amount of FXRP to withdraw
    function initiateWithdrawal(uint256 positionId, uint256 fxrpAmount) external;

    /// @notice Complete a withdrawal after the wait period
    /// @param positionId The position to complete withdrawal for
    function completeWithdrawal(uint256 positionId) external;

    /// @notice Get the current USD valuation of the vault
    /// @return totalUsdValuation Total USD valuation of all positions
    function getTotalValuation() external view returns (uint256 totalUsdValuation);

    /// @notice Get the current XRP/USD price from FTSO
    /// @return price The XRP/USD price with 5 decimals
    function getXrpUsdPrice() external view returns (uint256 price);

    /// @notice Get a position by ID
    /// @param positionId The position ID
    /// @return position The position data
    function getPosition(uint256 positionId) external view returns (Position memory position);

    /// @notice Get the total FXRP deposited in the vault
    /// @return totalFxrp Total FXRP amount
    function getTotalFxrpDeposited() external view returns (uint256 totalFxrp);

    /// @notice Get the number of active positions
    /// @return count Number of active positions
    function getActivePositionCount() external view returns (uint256 count);

    /// @notice Revalue all positions using the latest FTSO price
    function revalueAllPositions() external;

    /// @notice Emergency withdrawal for a depositor
    /// @param positionId The position to emergency withdraw
    /// @param reason The reason for the emergency withdrawal
    function emergencyWithdraw(uint256 positionId, string calldata reason) external;

    /// @notice Get the vault configuration
    /// @return config The vault configuration
    function getConfig() external view returns (VaultConfig memory config);
}
