// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SyntheticBTC — sBTC, a synthetic Bitcoin-pegged token on PDOGE chain.
/// @notice UNBACKED SYNTHETIC. Minted by the operator, pegged by convention only —
///         it tracks no oracle and is redeemable for nothing. It exists to give
///         the PDOGE ecosystem a BTC-flavored asset for pools and routing.
///         (Real BTC backing would need the custodial bridge Domenic declined
///         for now.) Demo-grade: not audited.
contract SyntheticBTC is ERC20, Ownable {
    constructor() ERC20("Synthetic BTC", "sBTC") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
