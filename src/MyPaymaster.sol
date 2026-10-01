// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/account/paymaster/Paymaster.sol";

/**
 * lib/account-abstraction/contracts/test/TestPaymasterAcceptAll.sol
 * test paymaster, that pays for everything, without any check.
 */
contract MyPaymaster is Paymaster {
    constructor() Paymaster() {}

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        internal
        view
        virtual
        override
        returns (bytes memory context, uint256 validationData)
    {
        (userOp, userOpHash, maxCost);
        return ("", 0);
    }
}
