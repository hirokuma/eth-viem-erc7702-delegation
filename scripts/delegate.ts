// scripts/delegate.ts
// A minimal sample that registers a deployed CounterAA contract as an ERC-7702
// delegation for a fresh EOA, then drives the delegated account through an
// ERC-4337 user operation signed by the EOA itself ({SignerEIP7702}).
// The funder wallet pays for everything: it broadcasts the delegation
// transaction and pre-deposits to the EntryPoint, so the delegated EOA never
// needs to hold ETH of its own.

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  encodeFunctionData,
  http,
  parseAbi,
  recoverAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { mainnet } from "viem/chains";

// ---------------------------------------------------------------------------
// PackedUserOperation
// ---------------------------------------------------------------------------
type PackedUserOperation = {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;   // bytes32
  preVerificationGas: bigint;
  gasFees: Hex;            // bytes32
  paymasterAndData: Hex; // paymaster(20) || verificationGasLimit(16) || postOpGasLimit(16) || paymasterData
  signature: Hex;
};

const PackedUserOperationComponent = [
  { name: 'sender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'initCode', type: 'bytes' },
  { name: 'callData', type: 'bytes' },
  { name: 'accountGasLimits', type: 'bytes32' },
  { name: 'preVerificationGas', type: 'uint256' },
  { name: 'gasFees', type: 'bytes32' },
  { name: 'paymasterAndData', type: 'bytes' },
  { name: 'signature', type: 'bytes' }
];

const entryPointAddress = '0x433709009B8330FDa32311DF1C2AFA402eD8D009';
const myPayMasterAddress = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';

const NONCE_KEY = 0x123400000000000000000000000000000000000000000000n;

// ERC-7821 "default" execution mode: batch of calls, revert on failure, no opData.
const MODE_DEFAULT: Hex =
  '0x0100000000000000000000000000000000000000000000000000000000000000';
const verificationGasLimit = 150_000n;
const callGasLimit = 500_000n;
const postGasLimit = 500_000n;
const maxPriorityFeePerGas = 2_000_000_000n;
const maxFeePerGas = 1_000_000_000n;

async function getNonce(client: PublicClient, account: Address, nonceKey: bigint): Promise<bigint> {
  // https://github.com/eth-infinitism/account-abstraction/blob/v0.9.0/contracts/interfaces/INonceManager.sol#L15-L16
  // nonce = ['uint192': key]['uint64': sequence] になっているので、UserOperationを処理するとnonceからkeyを取ってきて自動でインクリメントされる
  const nonce = await client.readContract({
    address: entryPointAddress,
    abi: parseAbi([
      'function getNonce(address sender, uint192 key) external view returns (uint256 nonce)',
    ]),
    functionName: 'getNonce',
    args: [account, nonceKey]
  }) as bigint;
  return nonce;
}


function createPackedUserOperation(
  sender: Address,
  nonce: bigint,
  callData: Hex,
): PackedUserOperation {
  const accountGasLimits = encodePacked(
    ['uint128', 'uint128'],
    [verificationGasLimit, callGasLimit]
  );
  const gasFees = encodePacked(
    ['uint128', 'uint128'],
    [maxPriorityFeePerGas, maxFeePerGas]
  );
  const payMaster = encodePacked(
    ['address', 'uint128', 'uint128'],
    [myPayMasterAddress, verificationGasLimit, postGasLimit]
  );
  // const payMaster = '0x';
  return {
    sender,
    nonce,
    initCode: '0x',
    callData,
    accountGasLimits,
    preVerificationGas: 21_000n,
    gasFees,
    paymasterAndData: payMaster,
    signature: '0x'
  };
}

async function getUserOpHash(client: PublicClient, op: PackedUserOperation): Promise<Hex> {
  const hash = await client.readContract({
    address: entryPointAddress,
    abi: [
      {
        type: 'function',
        name: 'getUserOpHash',
        stateMutability: 'view',
        inputs: [
          {
            name: 'userOp',
            type: 'tuple',
            components: PackedUserOperationComponent
          }
        ],
        outputs: [{ type: 'bytes32' }]
      }
    ] as const,
    functionName: 'getUserOpHash',
    args: [op]
  });
  return hash;
}

/**
 * Signs a PackedUserOperation so that {CounterAA} accepts it.
 *
 * CounterAA inherits {SignerEIP7702}, whose `_rawSignatureValidation` recovers an
 * address from the *raw* hash and requires it to equal `address(this)` — the EOA
 * the code is delegated to. The signature is therefore a plain 65-byte
 * `r || s || v` ECDSA signature over the EntryPoint's `userOpHash`:
 *
 *   - no EIP-191 prefix (`eth_sign` style),
 *   - no ERC-7739 nested EIP-712 envelope.
 *
 * {Account-_signableUserOpHash} is not overridden by CounterAA, so the value
 * returned by `EntryPoint.getUserOpHash` is signed as-is.
 */
async function signPackedUserOperation(
  client: PublicClient,
  po: PackedUserOperation,
  signer: Address,
  privateKey: Hex
): Promise<Hex> {
  // Always read the hash back from the EntryPoint: it is the EIP-712 hash over
  // the (EIP-7702 aware) repacking of the op, so recomputing it locally in JS is
  // easy to get out of sync.
  const hash = await getUserOpHash(client, po);

  const account = privateKeyToAccount(privateKey);

  // SignerEIP7702 recovers directly from `hash`, so sign the hash itself.
  const signature = await account.sign({ hash });

  // CounterAA compares the recovered signer with `address(this)`, i.e. the EOA
  // that the code is delegated to. A mismatch shows up as "AA24 signature error".
  const recovered = await recoverAddress({ hash, signature });
  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(
      `signPackedUserOperation: recovered ${recovered} but expected ${signer}`
    );
  }

  return signature;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const RPC_URL = "http://localhost:8545";

// Anvil default funded account (index 0). Used to pay gas for the EOA.
const FUNDER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// The deployed Counter contract address. Set via env or update after running
// `pnpm deploy:anvil`.
const COUNTER_ADDRESS: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";

// Generate a brand new EOA for the delegation demo, or import from env.
const EOA_PRIVATE_KEY = generatePrivateKey();

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
  // const fundHash = await funderWallet.sendTransaction({
  //   to: eoaAccount.address,
  //   value: parseEther("10"),
  // });
  // await publicClient.waitForTransactionReceipt({ hash: fundHash });
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
  // console.log("Authorization signed:", authorization);

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

  balance = await publicClient.getBalance({ address: eoaAccount.address });
  console.log("EOA Balance1:", balance.toString(), "wei");

  // 5. Call increment() on the EOA address. No authorization needed anymore
  //    because the EOA code is already delegated.

  // // funder から: EntryPoint.depositTo(eoaAccount.address)
  // await funderWallet.writeContract({
  //   address: entryPointAddress,
  //   abi: parseAbi(["function depositTo(address account) payable"]),
  //   functionName: "depositTo",
  //   args: [eoaAccount.address],
  //   value: parseEther("0.1"),
  // });

  const nonce = await getNonce(publicClient, eoaAccount.address, NONCE_KEY);
  const incCallData = encodeFunctionData({
    abi: parseAbi([
      'function increment() public',
    ]),
    functionName: 'increment',
    args: []
  });
  const unsignedOp = createPackedUserOperation(eoaAccount.address, nonce, incCallData);
  const signature = await signPackedUserOperation(publicClient, unsignedOp, eoaAccount.address, EOA_PRIVATE_KEY);
  const signedOp: PackedUserOperation = { ...unsignedOp, signature: signature };

  balance = await publicClient.getBalance({ address: eoaAccount.address });
  console.log("EOA Balance2:", balance.toString(), "wei");

  // EntryPoint v0.9 handleOps
  const incHash = await funderWallet.writeContract({
    address: entryPointAddress,
    abi: [
      {
        type: 'function',
        name: 'handleOps',
        stateMutability: 'payable',
        inputs: [
          {
            name: 'ops',
            type: 'tuple[]',
            components: PackedUserOperationComponent
          },
          {
            name: 'beneficiary',
            type: 'address'
          }
        ],
        outputs: []
      }
    ] as const,
    functionName: 'handleOps',
    args: [[signedOp], funderAccount.address],
    value: 0n
  });

  balance = await publicClient.getBalance({ address: eoaAccount.address });
  console.log("EOA Balance3:", balance.toString(), "wei");

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
