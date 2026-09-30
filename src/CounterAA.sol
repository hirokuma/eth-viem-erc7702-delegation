// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Counter} from "./Counter.sol";

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {SignerEIP7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerEIP7702.sol";

// import {console} from "forge-std/console.sol";

/// @notice CounterAA is ERC-4337 contract with Counter
/// @dev The account is meant to be used as an EIP-7702 delegation target, so signature validation is
///      delegated to {SignerEIP7702} (the signer is the delegated EOA itself).
contract CounterAA is Counter, Account, EIP712, SignerEIP7702, ERC7739, ERC7821 {
    constructor() EIP712("CounterAA", "0.0.1") {}

    /// @dev Resolves the `receive` function defined by more than one base ({Counter} and {Account}).
    receive() external payable virtual override(Counter, Account) {}

    /// @dev Allows only the entry point
    function _erc7821AuthorizedExecutor(address caller, bytes32, bytes calldata)
        internal
        view
        virtual
        override
        returns (bool)
    {
        return caller == address(entryPoint());
    }
}
