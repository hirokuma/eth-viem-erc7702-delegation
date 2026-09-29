// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A simple counter usable as an ERC-7702 delegation target.
///         The EOA's storage will hold `number` after delegating to this code.
contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }

    receive() external payable {}
    fallback() external payable {}
}
