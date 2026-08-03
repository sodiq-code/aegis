// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFtsoV2
/// @notice Interface for the Flare Time Series Oracle V2
///         Matches the official Flare periphery FtsoV2Interface.
/// @dev On Coston2: 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d
///      Feed ID for XRP/USD: 0x015852502f55534400000000000000000000000000
interface IFtsoV2 {
    /// @notice Get the latest price for a single feed
    /// @param _feedId The feed ID (bytes21 encoded)
    /// @return _value The price value (with feed decimals)
    /// @return _decimals The number of decimals
    /// @return _timestamp The timestamp of the last update
    function getFeedById(bytes21 _feedId)
        external
        payable
        returns (uint256 _value, int8 _decimals, uint64 _timestamp);

    /// @notice Get the latest prices for multiple feeds
    /// @param _feedIds Array of feed IDs
    /// @return _values Array of price values
    /// @return _decimals Array of decimals
    /// @return _timestamp The timestamp of the last update
    function getFeedsById(bytes21[] calldata _feedIds)
        external
        payable
        returns (uint256[] memory _values, int8[] memory _decimals, uint64 _timestamp);

    /// @notice Get the latest price for a feed in wei (18 decimals)
    /// @param _feedId The feed ID
    /// @return _value The price value in wei (18 decimals)
    /// @return _timestamp The timestamp of the last update
    function getFeedByIdInWei(bytes21 _feedId)
        external
        payable
        returns (uint256 _value, uint64 _timestamp);
}
