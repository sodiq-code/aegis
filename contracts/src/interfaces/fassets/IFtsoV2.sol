// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFtsoV2
/// @notice Interface for the Flare Time Series Oracle V2
/// @dev On Coston2: 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d
///      Feed ID for XRP/USD: 0x015852502f55534400000000000000000000000000
interface IFtsoV2 {
    /// @notice Feed data structure returned by the FTSO
    struct FeedData {
        int256 value;          // Price value with 5 decimals
        int256 decimals;       // Number of decimals
        uint256 timestamp;     // Timestamp of the feed update
    }

    /// @notice Get the latest price for a feed
    /// @param feedId The feed ID (bytes21 encoded)
    /// @return value The price value
    /// @return decimals The number of decimals
    /// @return timestamp The timestamp of the update
    function getLatestFeedData(bytes21 feedId)
        external
        view
        returns (int256 value, int256 decimals, uint256 timestamp);

    /// @notice Get the latest prices for multiple feeds
    /// @param feedIds Array of feed IDs
    /// @return values Array of price values
    /// @return decimals Array of decimals
    /// @return timestamps Array of timestamps
    function getLatestFeedsData(bytes21[] calldata feedIds)
        external
        view
        returns (int256[] memory values, int256[] memory decimals, uint256[] memory timestamps);

    /// @notice Get the current price for a feed category and index
    /// @param feedCategory The feed category (0 = crypto)
    /// @param feedIndex The feed index within the category
    /// @return value The price value
    /// @return timestamp The timestamp of the update
    function getCurrentPrice(uint256 feedCategory, uint256 feedIndex)
        external
        view
        returns (int256 value, uint256 timestamp);
}
