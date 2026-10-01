# ERC-7702 Delegation Sample (Foundry + viem)

A minimal sample that deploys a simple `Counter` contract with Foundry, then registers it as an [ERC-7702](https://eips.ethereum.org/EIPS/eip-7702) delegation for a fresh EOA using [viem](https://viem.sh/docs/eip7702/contract-writes).

After delegation, the EOA address behaves like the `Counter` contract, using the EOA's own storage.

This project uses **viem v2** (stable release). The important detail is to pass `executor: 'self'` when signing the EIP-7702 authorization, because the authorizing EOA also submits the transaction.

## What this demonstrates

1. Deploy a `Counter` contract with Foundry `forge script`.
2. Create and sign an EIP-7702 authorization (EOA code → `Counter`).
3. Broadcast the authorization in a transaction.
4. Call `Counter` functions on the EOA address.
5. Verify storage is held in the EOA account.
6. Verify the EOA code slot contains the delegation designator (`0xef0100 || counterAddress`).

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

### Terminal 2 — deploy the Counter contract and EntryPoint v0.9

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
- sign the EIP-7702 authorization,
- send `setNumber(42)` with the authorization,
- call `increment()` on the ERC-4337 handleOps,
- print the resulting storage values.

## Project layout

```
.
├── foundry.toml          # Foundry config (solc 0.8.28, evm_version = prague)
├── src/
│   └── Counter.sol       # Simple delegation target
├── script/
│   └── Counter.s.sol     # Deployment script
├── scripts/
│   └── delegate.ts       # viem ERC-7702 sample
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

