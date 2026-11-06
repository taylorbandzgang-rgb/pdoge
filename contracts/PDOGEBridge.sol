// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./WrappedPETH.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PDOGEBridge — PseudoDogecoin side of the PETH bridge (bridge controller).
/// @notice Flow: user locks PETH in PETHVault on L1 -> relayer observes the
///         Locked event -> operator calls mintWrapped -> user gets wPETH here.
///         To go back: user calls burnForRelease -> relayer observes the
///         BurnedForRelease event -> operator calls release() on the L1 vault.
///         Demo-grade: fully trusts the operator/relayer. No validator set,
///         no state proofs, no fraud windows, no audit.
contract PDOGEBridge is Ownable {
    WrappedPETH public immutable wPETH;

    event WrappedMinted(address indexed user, uint256 amount);
    event BurnedForRelease(address indexed user, uint256 amount);

    constructor(address _wPETH) Ownable(msg.sender) {
        wPETH = WrappedPETH(_wPETH);
    }

    /// @notice Operator mints wPETH after verifying a mainnet PETH lock.
    function mintWrapped(address user, uint256 amount) external onlyOwner {
        require(user != address(0) && amount > 0, "bad args");
        wPETH.mint(user, amount);
        emit WrappedMinted(user, amount);
    }

    /// @notice User burns wPETH to start a withdrawal; operator releases L1 PETH.
    function burnForRelease(uint256 amount) external {
        require(amount > 0, "amount=0");
        wPETH.burnFrom(msg.sender, amount);
        emit BurnedForRelease(msg.sender, amount);
    }
}
