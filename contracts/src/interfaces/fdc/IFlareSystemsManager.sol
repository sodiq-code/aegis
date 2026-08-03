// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFlareSystemsManager - Interface for the Flare Systems Manager
/// @notice Used to query the current voting round/epoch ID.
interface IFlareSystemsManager {
    /// @notice Get the current voting epoch ID.
    /// @return The current voting epoch ID.
    function getCurrentVotingEpochId() external view returns (uint256);
}
