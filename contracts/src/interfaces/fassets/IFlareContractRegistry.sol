// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFlareContractRegistry
/// @notice Interface for the Flare Contract Registry on Coston2
/// @dev The registry is deployed at 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
///      on ALL Flare networks (Flare, Coston2, Songbird, Coston).
interface IFlareContractRegistry {
    /// @notice Get a contract address by its name
    /// @param name The name of the contract (e.g., "AssetManagerFXRP", "FtsoV2")
    /// @return The address of the contract
    function getContractAddressByName(string calldata name) external view returns (address);

    /// @notice Get all registered contract names and addresses
    /// @return names Array of contract names
    /// @return addresses Array of contract addresses
    function getAllContracts() external view returns (string[] memory names, address[] memory addresses);
}
