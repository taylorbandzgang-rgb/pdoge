// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PDOGE — mainnet (Ethereum L1) representation of PseudoDogecoin.
/// @notice Minted 1:1 by the operator against native PDOGE locked in PDOGELock
///         on the PseudoDogecoin chain (chain ID 42069). Burn on L1 to release
///         native PDOGE back on 42069 via the relayer.
/// @dev Operator-trusted bridge, demo grade. Not audited — do not use with
///      meaningful value beyond the operator's own experiment.
contract PDOGEToken is ERC20, Ownable {
    event Burned(address indexed user, uint256 amount);

    constructor() ERC20("PseudoDogecoin", "PDOGE") Ownable(msg.sender) {}

    /// @notice Mint PDOGE against a PDOGELock.Locked event on chain 42069.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn PDOGE to start a release of native PDOGE on chain 42069.
    /// @dev The relayer watches Burned and calls PDOGELock.release(user, amount).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Burned(msg.sender, amount);
    }
}
