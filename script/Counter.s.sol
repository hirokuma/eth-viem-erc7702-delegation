// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {CounterAA} from "../src/CounterAA.sol";

contract CounterScript is Script {
    CounterAA public counter;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        counter = new CounterAA();

        vm.stopBroadcast();
    }
}
