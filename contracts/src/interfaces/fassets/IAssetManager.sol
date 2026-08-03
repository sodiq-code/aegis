// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IAssetManager
/// @notice Interface for the Flare FAssets AssetManager (FXRP) contract
/// @dev On Coston2: AssetManagerFXRP = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA
///      FXRP token = 0x0b6A3645c240605887a5532109323A3E12273dc7
interface IAssetManager {
    // --- Structs ---

    /// @notice AssetManager settings struct
    struct AssetManagerSettings {
        address assetManagerController;
        address fAsset;
        address collateralPool;
        address agentOwnerRegistry;
        address mintingFeeVault;
        uint256 mintingFeeUBA;
        uint256 redemptionFeeUBA;
        uint256 collateralReservationFeeUBA;
        uint256 redemptionDefaultFactor;
        uint256 redemptionViolationFactor;
        uint256 agentVaultMinimumCollateralFraction;
        uint256 agentMinCollateralRatio;
        uint256 agentMaxCollateralRatio;
        uint256 agentExitCollateralRatio;
        uint256 directMintingFeeUBA;
        uint256 directMintingLargeMintingThresholdUBA;
        uint256 directMintingLargeMintingDelaySeconds;
        uint256 directMintingHourlyLimitUBA;
        uint256 directMintingDailyLimitUBA;
        uint256 underlyingBlocksForPayment;
        uint256 underlyingSecondsForPayment;
        uint256 firstUnderlyingBlockForPayment;
        uint256 attestationWindow;
        uint256 redemptionPaymentExtension;
        uint256 withdrawalWaitMinTime;
        uint256 withdrawalWaitMaxTime;
        uint256 withdrawalWaitTimeFactor;
    }

    /// @notice Minting rate limiter state
    struct MintingRateLimiterState {
        uint256 windowStartTimestamp;
        uint256 mintedInCurrentWindowUBA;
    }

    // --- Read Functions ---

    /// @notice Get the FXRP ERC-20 token address
    function fAsset() external view returns (address);

    /// @notice Get the complete asset manager settings
    function getSettings() external view returns (AssetManagerSettings memory);

    /// @notice Get the lot size in UBA (units of the underlying asset)
    /// @dev On Coston2: 10_000_000 (10 XRP with 6 decimals)
    function lotSize() external view returns (uint256);

    /// @notice Get the asset minting granularity in UBA
    /// @dev Smallest unit that can be minted
    function assetMintingGranularityUBA() external view returns (uint256);

    /// @notice Get the current price of the underlying asset from FTSO
    /// @return Price in USD with 5 decimals
    function getAssetPrice() external view returns (uint256);

    // --- Direct Minting ---

    /// @notice Execute direct minting after an XRPL payment is verified
    /// @param proof FDC attestation proof of the XRPL payment
    function executeDirectMinting(bytes calldata proof) external;

    // --- Redemption ---

    /// @notice Redeem FXRP by amount
    /// @param amountUBA Amount of FXRP to redeem in UBA
    function redeemAmount(uint256 amountUBA) external;

    // --- Agent Queries ---

    /// @notice Get the list of all available agents
    function getAvailableAgentsList() external view returns (address[] memory);

    /// @notice Get the list of all agents
    function getAllAgents() external view returns (address[] memory);

    // --- Events ---

    /// @notice Emitted when a direct minting is executed
    event DirectMintingExecuted(
        address indexed agentVault,
        address indexed targetAddress,
        uint256 mintedAmountUBA,
        uint256 mintingFeeUBA,
        uint256 executorFeeUBA
    );

    /// @notice Emitted when a direct minting is delayed due to rate limits
    event DirectMintingDelayed(
        address indexed agentVault,
        address indexed targetAddress,
        uint256 valueUBA,
        uint256 executionAllowedAt
    );
}
