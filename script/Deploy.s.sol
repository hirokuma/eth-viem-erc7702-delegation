// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/ERC4337Utils.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/IERC4337.sol";

import {Script} from "forge-std/Script.sol";
import {CounterAA} from "../src/CounterAA.sol";
import {MyPaymaster} from "../src/MyPaymaster.sol";

contract DeployScript is Script {
    CounterAA public counter;
    MyPaymaster public paymaster;

    function run() public {
        vm.startBroadcast();

        counter = new CounterAA();
        paymaster = new MyPaymaster();

        vm.stopBroadcast();
    }
}
