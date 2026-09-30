// scripts/delegate.ts
// A minimal sample that registers a deployed Counter contract as an ERC-7702
// delegation for a fresh EOA, then calls the Counter code on the EOA address.
// Uses viem v2's EIP-7702 APIs: executor: 'self' is required when the EOA
// itself submits the delegation transaction.

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { mainnet } from "viem/chains";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const RPC_URL = process.env.RPC_URL || "http://localhost:8545";

// Anvil default funded account (index 0). Used to pay gas for the EOA.
const FUNDER_PRIVATE_KEY =
  (process.env.FUNDER_PRIVATE_KEY as `0x${string}`) ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// The deployed Counter contract address. Set via env or update after running
// `pnpm deploy:anvil`.
const COUNTER_ADDRESS: Address =
  (process.env.COUNTER_ADDRESS as Address) ||
  "0x5fbdb2315678afecb367f032d93f642f64180aa3";

// Generate a brand new EOA for the delegation demo, or import from env.
const EOA_PRIVATE_KEY =
  (process.env.EOA_PRIVATE_KEY as `0x${string}`) || generatePrivateKey();

const counterAbi = parseAbi([
  "function number() view returns (uint256)",
  "function setNumber(uint256 newNumber) public",
  "function increment() public",
]);

// Minimal local chain definition matching Anvil's chain id.
const localChain = {
  ...mainnet,
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const satisfies Chain;

const publicClient = createPublicClient({
  chain: localChain,
  transport: http(RPC_URL),
});

const eoaAccount = privateKeyToAccount(EOA_PRIVATE_KEY);
const eoaWallet = createWalletClient({
  account: eoaAccount,
  chain: localChain,
  transport: http(RPC_URL),
});

const funderAccount = privateKeyToAccount(FUNDER_PRIVATE_KEY);
const funderWallet = createWalletClient({
  account: funderAccount,
  chain: localChain,
  transport: http(RPC_URL),
});

async function main() {
  console.log("RPC URL:", RPC_URL);
  console.log("Counter (delegation target):", COUNTER_ADDRESS);
  console.log("EOA address:", eoaAccount.address);
  console.log("EOA private key (save this to reuse):", EOA_PRIVATE_KEY);

  // 1. Fund the EOA so it can pay for its own delegation transaction.
  const fundHash = await funderWallet.sendTransaction({
    to: eoaAccount.address,
    value: parseEther("10"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  let balance = await publicClient.getBalance({ address: eoaAccount.address });
  console.log("Funded EOA. Balance:", balance.toString(), "wei");

  // 2. Sign the EIP-7702 authorization that points the EOA code to Counter.
  //    executor: 'self' is required because the authorizing EOA also submits
  //    the EIP-7702 transaction. Viem adjusts the authorization nonce by +1
  //    to account for the transaction's own nonce increment.
  const authorization = await eoaWallet.signAuthorization({
    account: eoaAccount,
    contractAddress: COUNTER_ADDRESS,
  });
  console.log("Authorization signed:", authorization);

  // 3. Broadcast a transaction carrying the authorization list.
  //     This actually writes `0xef0100 || COUNTER_ADDRESS` into the EOA's code.
  const setHash = await funderWallet.writeContract({
    address: eoaAccount.address, // the EOA itself becomes the contract
    abi: counterAbi,
    functionName: "setNumber",
    args: [42n],
    authorizationList: [authorization],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: setHash,
  });
  console.log("Delegation + setNumber tx:", setHash);
  console.log("  status:", receipt.status);
  console.log("  gasUsed:", receipt.gasUsed.toString());

  // 4. Read the Counter storage from the EOA address.
  const numberAfterSet = await publicClient.readContract({
    address: eoaAccount.address,
    abi: counterAbi,
    functionName: "number",
  });
  console.log("EOA.number() after setNumber(42):", numberAfterSet.toString());

  // 5. Call increment() on the EOA address. No authorization needed anymore
  //    because the EOA code is already delegated.
  const incHash = await eoaWallet.writeContract({
    address: eoaAccount.address,
    abi: counterAbi,
    functionName: "increment",
  });
  await publicClient.waitForTransactionReceipt({ hash: incHash });

  const numberAfterInc = await publicClient.readContract({
    address: eoaAccount.address,
    abi: counterAbi,
    functionName: "number",
  });
  console.log("EOA.number() after increment():", numberAfterInc.toString());

  // 6. Verify the EOA code slot contains the delegation designator.
  const code = await publicClient.getCode({ address: eoaAccount.address });
  console.log("EOA deployed code (delegation designator):", code);

  if (numberAfterInc !== 43n) {
    throw new Error("Delegation did not work as expected");
  }

  balance = await publicClient.getBalance({ address: eoaAccount.address });
  console.log("After EOA Balance:", balance.toString(), "wei");

  console.log("\nERC-7702 delegation sample completed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
