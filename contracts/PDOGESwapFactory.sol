// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PDOGESwapPair.sol";

/// @title PDOGESwapFactory — deploys PDOGESwapPair pools (wPETH x native PDOGE).
/// @notice Minimal registry: one pair per token, address(0) denotes native PDOGE.
///         Demo-grade: not audited. Private chain.
contract PDOGESwapFactory {
    address public immutable wPETH;
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed tokenA, address indexed tokenB, address pair);

    constructor(address _wPETH) {
        wPETH = _wPETH;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Deploy the wPETH/PDOGE pair via CREATE2 (deterministic address).
    /// @dev Legacy helper; prefer createNativePair for new pools.
    function createPair() external returns (address pair) {
        return createNativePair(wPETH);
    }

    /// @notice Deploy an ERC20/PDOGE pair via CREATE2 (deterministic address).
    function createNativePair(address token) public returns (address pair) {
        require(token != address(0), "token is zero");
        require(getPair[token][address(0)] == address(0), "pair exists");
        bytes memory bytecode = abi.encodePacked(
            type(PDOGESwapPair).creationCode,
            abi.encode(token)
        );
        bytes32 salt = keccak256(abi.encodePacked(token, address(0)));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        require(pair != address(0), "create2 failed");
        getPair[token][address(0)] = pair;
        getPair[address(0)][token] = pair;
        allPairs.push(pair);
        emit PairCreated(token, address(0), pair);
    }
}
