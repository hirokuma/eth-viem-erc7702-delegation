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
  parseEther,
  recoverAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { anvil } from "viem/chains";
import { defineToken } from 'viem/tokens'

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
const myErc20Address = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

// lib/account-abstraction/deployments/localhost/Simple7702Account.json
const simpleSmartAccount = '0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5';

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

// Anvil default funded account (index 0). Used to pay gas for the EOA.
const FUNDER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Generate a brand new EOA for the delegation demo, or import from env.
const EOA_PRIVATE_KEY = generatePrivateKey();

const accountAbi = parseAbi([
  // Simple7702Account (BaseAccount) のメソッド
  "function entryPoint() view returns (address)",
  "function getNonce() view returns (uint256)",
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  "function isValidSignature(bytes32 hash, bytes sig) view returns (bytes4)",
  "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256)",
  "fallback() external payable",
  "receive() external payable",
]);

// Minimal local chain definition matching Anvil's chain id.
const localChain = anvil;

const myErc20 = defineToken({ 
  addresses: {
    31_337: myErc20Address,
  },
  decimals: 18,
  name: 'MyErc20',
  symbol: 'MET',
  currency: 'JQA',
  popular: false,
});

const publicClient = createPublicClient({
  chain: localChain,
  transport: http(),
  tokens: [myErc20],
});

const eoaAccount = privateKeyToAccount(EOA_PRIVATE_KEY);
const eoaWallet = createWalletClient({
  account: eoaAccount,
  chain: localChain,
  transport: http(),
  tokens: [myErc20],
});

const funderAccount = privateKeyToAccount(FUNDER_PRIVATE_KEY);
const funderWallet = createWalletClient({
  account: funderAccount,
  chain: localChain,
  transport: http(),
  tokens: [myErc20],
});

async function main() {
  console.log("ERC-20 address:", myErc20Address);

  {
    const ercBalance = await publicClient.token.getBalance({
      account: funderAccount,
      token: 'met',
    });
    console.log("Funder ERC20 Balance:", ercBalance.amount, myErc20.symbol);
    console.log();

    console.log("EOA address:", eoaAccount.address);
    console.log("EOA private key (save this to reuse):", EOA_PRIVATE_KEY);
    const balance = await publicClient.getBalance({ address: eoaAccount.address });
    console.log("EOA balance:", balance.toString(), "wei");
  }
  console.log();

  //
  // 1. Fund the EOA with ERC-20
  //

  {
    const _ = await funderWallet.token.transferSync({
      amount: { formatted: '1.23' },
      to: eoaAccount.address,
      token: 'met',
    });
    const ercBalance = await publicClient.token.getBalance({
      account: eoaAccount,
      token: 'met',
    });
    console.log("EOA ERC20 balance:", ercBalance.amount, myErc20.symbol);
  }
  console.log();

  //
  // 2. Link the EOA and Smart Account via ERC-7702 delegation
  //

  {
    // EOA code を Simple7702Account に向ける authorization に署名する。
    //    これを broadcast するのは funder（＝EOA とは別アカウント）なので
    //    executor は 'self' にしてはいけない。未指定なら viem は
    //    「別アカウントが実行」と解釈し、nonce は EOA の現在値のまま（+1 しない）。
    const authorization = await eoaWallet.signAuthorization({
      account: eoaAccount,
      contractAddress: simpleSmartAccount,
      // executor: funderAccount.address, // 明示する場合（省略時と同じ結果）
    });

    // authorizationList を載せた tx を broadcast する。
    //    これで EOA の code が `0xef0100 || simpleSmartAccount` に書き換わる。
    //    Simple7702Account は fallback/receive が payable なので、
    //    本体呼び出し（空 calldata → receive）はそのまま成功する。
    const setHash = await funderWallet.sendTransaction({
      to: eoaAccount.address,
      value: 0n,
      authorizationList: [authorization],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: setHash });
    console.log("Delegation tx:", setHash);
    console.log("  status:", receipt.status);
    console.log("  gasUsed:", receipt.gasUsed.toString());

    // EOA 経由で Simple7702Account が返ることを確認（＝delegate 成功）。
    const ep = await publicClient.readContract({
      address: eoaAccount.address,
      abi: accountAbi,
      functionName: "entryPoint",
    });
    if (ep.toLowerCase() !== entryPointAddress.toLowerCase()) {
      throw new Error(`delegation not applied: entryPoint()=${ep}`);
    }
    console.log("Register delegation for the EOA.");
  }
  console.log();

  //
  // 3. Get ERC-20 balance after delegation
  //

  {
    const balance = await publicClient.getBalance({ address: eoaAccount.address });
    console.log("EOA balance1:", balance.toString(), "wei");
    const ercBalance = await publicClient.token.getBalance({
      account: eoaAccount,
      token: 'met',
    });
    console.log("EOA ERC20 balance1:", ercBalance.amount, myErc20.symbol);
  }
  console.log();

  //
  // 4. Transfer ERC-20 from EOA to Funder
  //

  {
    const nonce = await getNonce(publicClient, eoaAccount.address, NONCE_KEY);

    // 実行したい「中身」の calldata（MyErc20.transfer）。
    const transferCallData = encodeFunctionData({
      abi: parseAbi([
        'function transfer(address _to, uint256 _value) public returns (bool success)',
      ]),
      functionName: 'transfer',
      args: [funderAccount.address, parseEther("0.23")]
    });

    // UserOp.callData は「sender 本体を呼ぶための calldata」であって、
    // 実行したい呼び出しそのものではない。EntryPoint は
    // sender.call(callData) するだけなので、account が実行を解釈できる
    // 形にラップする必要がある。
    //
    // デプロイ済みの Simple7702Account (account-abstraction v0.9.0) は
    // ERC-7821 実装ではなく BaseAccount 実装で、実行用セレクタは
    //   execute(address,uint256,bytes)        -> 0xb61d27f6
    //   executeBatch((address,uint256,bytes)[]) -> 0x34fcd5be
    // のみ。よって execute(...) でラップする。
    //
    // 生の transfer calldata をそのまま渡すと、Simple7702Account には
    // transfer セレクタが無いので fallback()（payable・空実装）に落ち、
    // revert もせず何も起きない（＝無言で no-op）。
    const callData = encodeFunctionData({
      abi: parseAbi([
        'function execute(address target, uint256 value, bytes data)',
      ]),
      functionName: 'execute',
      args: [myErc20Address, 0n, transferCallData],
    });

    const unsignedOp = createPackedUserOperation(eoaAccount.address, nonce, callData);
    const signature = await signPackedUserOperation(publicClient, unsignedOp, eoaAccount.address, EOA_PRIVATE_KEY);
    const signedOp: PackedUserOperation = { ...unsignedOp, signature: signature };

    // EntryPoint v0.9 handleOps
    const sendHash = await funderWallet.writeContract({
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
    console.log("handleOps transaction:", sendHash);
    await publicClient.waitForTransactionReceipt({ hash: sendHash });
  }
  console.log();

  //
  // 5. Get ERC-20 balance after transfer
  //

  {
    const balance = await publicClient.getBalance({ address: eoaAccount.address });
    console.log("EOA balance2:", balance.toString(), "wei");
    const ercBalance = await publicClient.token.getBalance({
      account: eoaAccount,
      token: 'met',
    });
    console.log("EOA ERC20 balance2:", ercBalance.amount, myErc20.symbol);
  }
  console.log();

  // 6. Verify the EOA code slot contains the delegation designator.
  const code = await publicClient.getCode({ address: eoaAccount.address });
  console.log("EOA deployed code (delegation designator):", code);

  console.log("\nERC-7702 delegation sample completed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
