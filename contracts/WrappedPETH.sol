// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WrappedPETH — PETH bridged onto the PseudoDogecoin chain.
/// @notice Minted 1:1 by the DogeBridge operator when PETH is locked on
///         Ethereum mainnet. Burned when bridging back.
///         Demo-grade: fully trusts the operator. Not audited.
contract WrappedPETH is ERC20, Ownable {
    constructor() ERC20("Wrapped PETH", "wPETH") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
