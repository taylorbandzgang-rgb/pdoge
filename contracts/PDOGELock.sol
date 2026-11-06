// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PDOGELock — PseudoDogecoin chain (42069) side of the PDOGE bridge.
/// @notice Users lock native PDOGE here to mint PDOGEToken 1:1 on Ethereum
///         mainnet. Releases are executed by the operator after a PDOGEToken
///         burn on mainnet.
/// @dev Operator-trusted bridge, demo grade. Not audited.
contract PDOGELock is Ownable {
    event Locked(address indexed user, uint256 amount);
    event Released(address indexed user, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Lock native PDOGE; the relayer mints PDOGEToken on mainnet.
    function lock() external payable {
        require(msg.value > 0, "nothing to lock");
        emit Locked(msg.sender, msg.value);
    }

    /// @notice Release native PDOGE after a mainnet PDOGEToken burn.
    function release(address user, uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient locked");
        (bool ok, ) = user.call{value: amount}("");
        require(ok, "release failed");
        emit Released(user, amount);
    }
}
