// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MemeVault — mainnet side of the trading-portfolio vault.
/// @notice Locks any ERC20 (the trading pot's memecoins: PEPE, GTA, SFK,
///         PEP) so the wrapped 1:1 representation can be held in a vault
///         on the PDOGE chain. Releases are operator-only, after a
///         wrapped-token burn on PDOGE.
///         Demo-grade: fully trusts the operator. Not audited — do not use
///         with meaningful value.
contract MemeVault is Ownable {
    mapping(address => mapping(address => uint256)) public locked;

    event Locked(address indexed token, address indexed user, uint256 amount);
    event Released(address indexed token, address indexed user, uint256 amount);

    constructor(address _owner) Ownable(_owner) {}

    /// @notice Lock `amount` of `token` in the vault. The operator observes
    ///         this event and mints the wrapped 1:1 token to the PDOGE vault.
    function lock(address token, uint256 amount) external {
        require(token != address(0) && amount > 0, "bad args");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        locked[token][msg.sender] += amount;
        emit Locked(token, msg.sender, amount);
    }

    /// @notice Operator releases tokens after verifying a wrapped-token
    ///         burn on the PDOGE chain.
    function release(address token, address user, uint256 amount) external onlyOwner {
        require(token != address(0) && user != address(0) && amount > 0, "bad args");
        require(locked[token][user] >= amount, "insufficient locked");
        locked[token][user] -= amount;
        IERC20(token).transfer(user, amount);
        emit Released(token, user, amount);
    }
}
