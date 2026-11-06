// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PETHReserveVault — mainnet PETH backing sBTC on the PDOGE chain.
/// @notice Anyone can deposit PETH as backing. Only the operator can release,
///         and only after sBTC is redeemed (taken out of circulation) on PDOGE.
///         Backing model: pro-rata redemption floor —
///             PETH per sBTC = vault PETH balance / sBTC total supply.
///         What this proves: the PETH reserve is on-chain and verifiable by
///         anyone (Etherscan). What it does NOT prove: sBTC issuance on PDOGE,
///         which remains operator-attested (same trust model as the PETH bridge).
///         Demo-grade: not audited.
contract PETHReserveVault is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable peth;

    event ReserveLocked(address indexed account, uint256 pethAmount);
    event ReserveReleased(address indexed to, uint256 pethAmount, uint256 sbtcRedeemed);

    constructor(address _peth) Ownable(msg.sender) {
        peth = IERC20(_peth);
    }

    /// @notice Lock PETH as sBTC backing. Caller must approve the vault first.
    /// @dev Raw transfers also count toward getReserveBalance, but only
    ///      depositReserve emits the event and is the supported path.
    function depositReserve(uint256 amount) external {
        require(amount > 0, "deposit: zero");
        peth.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveLocked(msg.sender, amount);
    }

    /// @notice Release PETH to `to` after `sbtcRedeemed` sBTC was redeemed on PDOGE.
    /// @dev Operator-only. The PETH amount is computed off-chain pro-rata
    ///      (vault balance / sBTC supply) at redemption time.
    function release(address to, uint256 pethAmount, uint256 sbtcRedeemed) external onlyOwner {
        require(to != address(0), "release: zero to");
        require(pethAmount > 0, "release: zero amount");
        require(pethAmount <= peth.balanceOf(address(this)), "release: insufficient reserve");
        peth.safeTransfer(to, pethAmount);
        emit ReserveReleased(to, pethAmount, sbtcRedeemed);
    }

    function getReserveBalance() external view returns (uint256) {
        return peth.balanceOf(address(this));
    }
}
