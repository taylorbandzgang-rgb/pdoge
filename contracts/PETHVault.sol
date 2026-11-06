// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PETHVault — L1 (Ethereum mainnet) side of the PDOGE bridge.
/// @notice Users lock real PETH here to mint wPETH 1:1 on the PseudoDogecoin chain.
///         Withdrawals are released by the operator after a wPETH burn on PDOGE.
///         Demo-grade: fully trusts the operator. Not audited — do not use with
///         meaningful value.
contract PETHVault is Ownable {
    IERC20 public immutable peth;
    mapping(address => uint256) public locked;

    event Locked(address indexed user, uint256 amount);
    event Released(address indexed user, uint256 amount);

    constructor(address _peth) Ownable(msg.sender) {
        require(_peth != address(0), "peth=0");
        peth = IERC20(_peth);
    }

    /// @notice Lock PETH in the vault. The relayer observes this event and
    ///         mints wPETH to `msg.sender` on the PDOGE chain.
    function lock(uint256 amount) external {
        require(amount > 0, "amount=0");
        peth.transferFrom(msg.sender, address(this), amount);
        locked[msg.sender] += amount;
        emit Locked(msg.sender, amount);
    }

    /// @notice Operator releases PETH after verifying a wPETH burn on PDOGE.
    function release(address user, uint256 amount) external onlyOwner {
        require(user != address(0) && amount > 0, "bad args");
        require(locked[user] >= amount, "insufficient locked");
        locked[user] -= amount;
        peth.transfer(user, amount);
        emit Released(user, amount);
    }
}
