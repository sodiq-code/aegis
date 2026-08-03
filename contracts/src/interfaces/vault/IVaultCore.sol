// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IVaultCore
/// @notice Core vault contract for Aegis — manages FXRP deposits, withdrawals,
///         and collateral tracking using Flare FAssets and FTSO price feeds.
/// @dev This is the primary entry point for institutional depositors.
///      API matches the Aegis blueprint (Section 9.4.5) exactly:
///      depositFXRP, withdraw, emergencyExit, balanceOf, policyOf.
interface IVaultCore {
    // --- Structs ---

    /// @notice A depositor's position in the vault
    struct Position {
        address depositor;          // The depositor's EVM address (via Flare Smart Accounts)
        uint256 fxrpAmount;         // Amount of FXRP deposited (UBA, 6 decimals)
        uint256 depositTimestamp;   // Timestamp of the deposit
        uint256 lastValuation;      // Last USD valuation (5 decimals from FTSO)
        uint256 policyId;           // Assigned risk policy ID
        bool isActive;              // Whether the position is active
    }

    /// @notice Vault configuration parameters
    struct VaultConfig {
        address assetManagerFXRP;   // AssetManagerFXRP contract address (from FlareContractRegistry)
        address fxrpToken;          // FXRP ERC-20 token address
        address ftsoV2;             // FTSO V2 contract address (from FlareContractRegistry)
        address policyRegistry;     // PolicyRegistry contract address
        address solvencyRoot;       // SolvencyRoot contract address
        address instructionSender;  // InstructionSender contract address
        address verifierRole;       // VerifierRole contract address
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

    /// @notice Emitted when a withdrawal is completed
    event WithdrawalCompleted(
        address indexed depositor,
        uint256 fxrpAmount,
        uint256 positionId
    );

    /// @notice Emitted when an emergency exit is triggered
    event EmergencyExit(
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

    // --- Report-Specified API (Section 9.4.5) ---

    /// @notice Deposit FXRP into the vault with a specified policy
    /// @param amount Amount of FXRP to deposit (UBA, 6 decimals)
    /// @param policyId Risk policy to assign to this deposit
    function depositFXRP(uint256 amount, uint256 policyId) external returns (uint256 positionId);

    /// @notice Withdraw FXRP from the vault
    /// @param amount Amount of FXRP to withdraw
    function withdraw(uint256 amount) external;

    /// @notice Emergency exit — withdraw all funds immediately
    /// @dev Only available when the vault is in emergency mode
    function emergencyExit() external;

    /// @notice Get the FXRP balance of a depositor
    /// @param user The depositor's address
    /// @return balance The total FXRP balance across all positions
    function balanceOf(address user) external view returns (uint256 balance);

    /// @notice Get the policy assigned to a depositor
    /// @param user The depositor's address
    /// @return policyId The assigned policy ID
    function policyOf(address user) external view returns (uint256 policyId);

    // --- Extended API ---

    /// @notice Get the current XRP/USD price from FTSO V2
    /// @return price The XRP/USD price with 5 decimals
    function getXrpUsdPrice() external returns (uint256 price);

    /// @notice Get the total USD valuation of the vault
    /// @return totalUsdValuation Total USD valuation of all positions
    function getTotalValuation() external returns (uint256 totalUsdValuation);

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
    /// @dev Only callable by the FCC extension (verifier role)
    function revalueAllPositions() external;

    /// @notice Get the vault configuration
    /// @return config The vault configuration
    function getConfig() external view returns (VaultConfig memory config);
}
