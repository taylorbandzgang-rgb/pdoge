// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SBTCRedeem — redeem sBTC on PDOGE for pro-rata PETH on mainnet.
/// @notice User approves then calls redeem(amount): the sBTC is pulled into
///         this contract (out of circulation) and a Redeemed event is emitted.
///         The operator relayer watches Redeemed and calls
///         PETHReserveVault.release(user, pethAmount, sbtcAmount) on mainnet,
///         where pethAmount = sbtcAmount * vaultPETH / sbtcTotalSupply.
///         Demo-grade: not audited. Release is operator-trusted.
contract SBTCRedeem {
    using SafeERC20 for IERC20;

    IERC20 public immutable sbtc;
    address public immutable operator;

    event Redeemed(address indexed user, uint256 sbtcAmount);

    constructor(address _sbtc, address _operator) {
        sbtc = IERC20(_sbtc);
        operator = _operator;
    }

    function redeem(uint256 sbtcAmount) external {
        require(sbtcAmount > 0, "redeem: zero");
        sbtc.safeTransferFrom(msg.sender, address(this), sbtcAmount);
        emit Redeemed(msg.sender, sbtcAmount);
    }

    /// @notice Operator sweep of redeemed sBTC (e.g. back to treasury).
    function sweep(address to, uint256 amount) external {
        require(msg.sender == operator, "not operator");
        sbtc.safeTransfer(to, amount);
    }
}
