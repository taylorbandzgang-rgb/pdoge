// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MemeVaultPDOGE — holds the wrapped memecoins on the PDOGE chain.
/// @notice The trading portfolio's wrapped 1:1 representations (wPEPE, wGTA,
///         wSFK, wPEP) live here. The operator mints directly to this
///         vault when the real tokens are locked on mainnet. Withdrawals
///         are operator-only (for burn-back and release on mainnet).
///         Demo-grade: fully trusts the operator. Not audited.
contract MemeVaultPDOGE is Ownable {
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    constructor(address _owner) Ownable(_owner) {}

    /// @notice Deposit wrapped tokens into the vault (e.g. after minting
    ///         to the operator and moving them here).
    function deposit(address token, uint256 amount) external {
        require(token != address(0) && amount > 0, "bad args");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice Operator withdraws wrapped tokens (for burn-back).
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0) && to != address(0) && amount > 0, "bad args");
        IERC20(token).transfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
