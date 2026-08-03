// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IFXRP
/// @notice Interface for the FXRP ERC-20 token on Coston2
/// @dev On Coston2: 0x0b6A3645c240605887a5532109323A3E12273dc7
///      Decimals: 6
interface IFXRP {
    /// @notice Get the name of the token
    function name() external view returns (string memory);

    /// @notice Get the symbol of the token
    function symbol() external view returns (string memory);

    /// @notice Get the number of decimals
    function decimals() external view returns (uint8);

    /// @notice Get the total supply
    function totalSupply() external view returns (uint256);

    /// @notice Get the balance of an account
    function balanceOf(address account) external view returns (uint256);

    /// @notice Transfer tokens to another account
    function transfer(address to, uint256 amount) external returns (bool);

    /// @notice Get the allowance of a spender for an owner
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice Approve a spender to transfer tokens
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Transfer tokens from one account to another using allowance
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
