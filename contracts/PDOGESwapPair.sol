// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PDOGESwapPair — constant-product AMM for any ERC20 x native PDOGE.
/// @notice Uniswap V2 math: x*y=k invariant, 0.3% swap fee, MINIMUM_LIQUIDITY
///         permanently locked (at address(1) — OZ v5 forbids mint to address(0)).
///         V2-style flow: transfer the input token(s) in first, then call
///         mint / burn / swap.
///         - mint(address to) payable: send ERC20 to the pair, attach PDOGE.
///         - burn(address to): send LP tokens to the pair, get both assets back.
///         - swap(tOut, pOut, to) payable: send input in first, fee via k-check.
///         Demo-grade: not audited. Private chain.
contract PDOGESwapPair is ERC20, ReentrancyGuard {
    IERC20 public immutable token;

    uint256 public reserveToken;
    uint256 public reservePDOGE;
    uint32 public blockTimestampLast;

    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    event Mint(address indexed sender, uint256 tokenIn, uint256 pdogeIn, address indexed to);
    event Burn(address indexed sender, uint256 tokenOut, uint256 pdogeOut, address indexed to);
    event Swap(
        address indexed sender,
        uint256 tokenIn,
        uint256 pdogeIn,
        uint256 tokenOut,
        uint256 pdogeOut,
        address indexed to
    );
    event Sync(uint256 reserveToken, uint256 reservePDOGE);

    constructor(address _token) ERC20("PDOGE Swap LP", "PSWAP-LP") {
        token = IERC20(_token);
    }

    function getReserves() public view returns (uint256, uint256, uint32) {
        return (reserveToken, reservePDOGE, blockTimestampLast);
    }

    function _update(uint256 balT, uint256 balP) private {
        reserveToken = balT;
        reservePDOGE = balP;
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
        emit Sync(balT, balP);
    }

    /// @notice Add liquidity. Transfer ERC20 to the pair first, attach PDOGE
    ///         as msg.value. LP tokens are minted to `to`.
    function mint(address to) external payable nonReentrant returns (uint256 liquidity) {
        uint256 rT = reserveToken;
        uint256 rP = reservePDOGE;
        uint256 balT = token.balanceOf(address(this));
        uint256 balP = address(this).balance;
        uint256 amountT = balT - rT;
        uint256 amountP = balP - rP;
        require(amountT > 0 && amountP > 0, "mint: zero input");

        uint256 total = totalSupply();
        if (total == 0) {
            liquidity = _sqrt(amountT * amountP) - MINIMUM_LIQUIDITY;
            // V2 burns this to address(0); OZ v5 forbids zero-address mint,
            // so lock it at address(1) instead — equally unspendable.
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((amountT * total) / rT, (amountP * total) / rP);
        }
        require(liquidity > 0, "mint: zero liquidity");
        _mint(to, liquidity);
        _update(balT, balP);
        emit Mint(msg.sender, amountT, amountP, to);
    }

    /// @notice Remove liquidity. Transfer LP tokens to the pair first.
    function burn(address to)
        external
        nonReentrant
        returns (uint256 amountT, uint256 amountP)
    {
        uint256 liquidity = balanceOf(address(this));
        require(liquidity > 0, "burn: no LP supplied");
        uint256 total = totalSupply();
        uint256 balT = token.balanceOf(address(this));
        uint256 balP = address(this).balance;
        amountT = (liquidity * balT) / total;
        amountP = (liquidity * balP) / total;
        require(amountT > 0 && amountP > 0, "burn: zero out");
        _burn(address(this), liquidity);
        require(token.transfer(to, amountT), "token out failed");
        (bool ok, ) = to.call{value: amountP}("");
        require(ok, "PDOGE out failed");
        _update(token.balanceOf(address(this)), address(this).balance);
        emit Burn(msg.sender, amountT, amountP, to);
    }

    /// @notice Swap. Transfer the input (ERC20 and/or PDOGE via msg.value)
    ///         to the pair first, then call with the desired outputs.
    function swap(uint256 amountTOut, uint256 amountPOut, address to) external payable nonReentrant {
        require(amountTOut > 0 || amountPOut > 0, "swap: zero out");
        uint256 rT = reserveToken;
        uint256 rP = reservePDOGE;
        require(amountTOut < rT && amountPOut < rP, "swap: insufficient liquidity");

        if (amountTOut > 0) require(token.transfer(to, amountTOut), "token out failed");
        if (amountPOut > 0) {
            (bool ok, ) = to.call{value: amountPOut}("");
            require(ok, "PDOGE out failed");
        }

        uint256 balT = token.balanceOf(address(this));
        uint256 balP = address(this).balance;
        uint256 amountTIn = balT > rT - amountTOut ? balT - (rT - amountTOut) : 0;
        uint256 amountPIn = balP > rP - amountPOut ? balP - (rP - amountPOut) : 0;
        require(amountTIn > 0 || amountPIn > 0, "swap: zero in");

        // 0.3% fee: (balT*1000 - inT*3) * (balP*1000 - inP*3) >= rT*rP*1e6
        uint256 balTAdj = balT * 1000 - amountTIn * 3;
        uint256 balPAdj = balP * 1000 - amountPIn * 3;
        require(balTAdj * balPAdj >= rT * rP * 1000 ** 2, "swap: k violated");

        _update(balT, balP);
        emit Swap(msg.sender, amountTIn, amountPIn, amountTOut, amountPOut, to);
    }

    /// @notice Recover tokens sent directly without minting.
    function skim(address to) external nonReentrant {
        uint256 balT = token.balanceOf(address(this));
        uint256 balP = address(this).balance;
        if (balT > reserveToken) require(token.transfer(to, balT - reserveToken), "skim t failed");
        if (balP > reservePDOGE) {
            (bool ok, ) = to.call{value: balP - reservePDOGE}("");
            require(ok, "skim p failed");
        }
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
