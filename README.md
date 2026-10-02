# ERC-7702 Delegation Sample (Foundry + viem)

Sample code for Gassless with ERC-7702 + ERC-4337 + [Simple7702Account](https://github.com/eth-infinitism/account-abstraction/blob/v0.9.0/contracts/accounts/Simple7702Account.sol).

This project uses **viem v2** (stable release). The important detail is to pass `executor: 'self'` when signing the EIP-7702 authorization, because the authorizing EOA also submits the transaction.

## Prerequisites

- [Foundry](https://www.getfoundry.sh/)
- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/)

## Install

```bash
git submodule update --init
pnpm install
```

## Run

Open three terminals.

### Terminal 1 — start Anvil in Prague mode

```bash
anvil --hardfork prague
```

### Terminal 2 — deploy the contracts and EntryPoint v0.9

```bash
pnpm deploy
```

The default deployed address on a fresh Anvil instance is:

```
EntryPoint: 0x433709009B8330FDa32311DF1C2AFA402eD8D009
CounterAA: 0x5FbDB2315678afecb367f032d93F642f64180aa3
MyPaymaster: 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
```

Deposit 0.1 ETH to EntryPoint for MyPaymaster.

```bash
pnpm deposit
```

To get current deposit amount, call `pnpm getdeposit`.


### Terminal 3 — delegate and call through the EOA

```bash
pnpm delegate
```

The script will:

- create a fresh EOA,
- fund the EOA with MyERC20,
- sign the EIP-7702 authorization,
- send `sendTransaction()` for the authorization,
- send `transfer()` on the ERC-4337 handleOps,
- print the resulting storage values.

## Project layout

```
.
├── foundry.toml          # Foundry config (solc 0.8.28, evm_version = prague)
├── src/
│   ├── MyErc20.sol      # Sample ERC-20
│   └── MyPaymaster.sol  # Paymaster sample
├── script/
│   └── Deploy.s.sol     # Deployment script
├── scripts/
│   └── delegate.ts      # viem ERC-7702 sample
├── package.json
├── tsconfig.json
└── .env.example
```

## Foundry basics

- **Build**: `forge build`
- **Test**: `forge test`
- **Format**: `forge fmt`
- **Local node**: `anvil --hardfork prague`

## License

MIT
