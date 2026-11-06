// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WrappedMeme — a mainnet memecoin bridged 1:1 onto the PDOGE chain.
/// @notice Minted by the operator when the real token is locked in the
///         mainnet MemeVault. Burned when bridging back. One deployment
///         per memecoin (wPEPE, wGTA, wSFK, wPEP).
///         Demo-grade: fully trusts the operator. Not audited.
contract WrappedMeme is ERC20, Ownable {
    constructor(string memory _name, string memory _symbol, address _owner)
        ERC20(_name, _symbol)
        Ownable(_owner)
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
