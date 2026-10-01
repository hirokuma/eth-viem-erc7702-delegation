// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/ERC4337Utils.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/IERC4337.sol";

import {Script} from "forge-std/Script.sol";
import {MyErc20} from "../src/MyErc20.sol";
import {MyPaymaster} from "../src/MyPaymaster.sol";

contract DeployScript is Script {
    MyErc20 public erc20;
    MyPaymaster public paymaster;

    function run() public {
        vm.startBroadcast();

        erc20 = new MyErc20("MyErc20", "MET");
        paymaster = new MyPaymaster();

        vm.stopBroadcast();
    }
}
