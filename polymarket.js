/**
 * Polymarket integration — deposit wallet flow.
 *
 * Mirrors the official guide at:
 *   https://docs.polymarket.com/trading/deposit-wallets
 *
 * Contract addresses verified against:
 *   https://docs.polymarket.com/resources/contracts
 *
 * Requires (versions aligned in package.json):
 *   @polymarket/builder-relayer-client ^0.0.8
 *   @polymarket/builder-signing-sdk    ^0.0.8
 *   @polymarket/clob-client-v2         ^1.0.6
 *   viem                               ^2.39.2
 *
 * Required env vars (server-side only — never expose builder creds to the browser):
 *   RELAYER_URL              e.g. https://relayer-v2.polymarket.com/
 *   CLOB_API_URL             e.g. https://clob.polymarket.com
 *   CHAIN_ID                 137 (Polygon mainnet)
 *   RPC_URL                  Polygon RPC endpoint
 *   PRIVATE_KEY              0x-prefixed owner/session signer key
 *   BUILDER_API_KEY          From polymarket.com/settings?tab=builder
 *   BUILDER_SECRET
 *   BUILDER_PASS_PHRASE
 *   CLOB_API_KEY             From CLOB API key creation
 *   CLOB_SECRET
 *   CLOB_PASS_PHRASE
 *
 * Optional env vars (verified defaults provided):
 *   PUSD_ADDRESS              default 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB
 *   CTF_EXCHANGE_ADDRESS      default 0xE111180000d2663C0091e4f400237545B87B996B
 *   NEG_RISK_EXCHANGE_ADDRESS default 0xe2222d279d744050d28e00520010520000310F59
 *   CTF_ADDRESS               default 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 (ERC-1155)
 */

const {
  BuilderApiKeyCreds,
  BuilderConfig,
} = require('@polymarket/builder-signing-sdk');
const { RelayClient } = require('@polymarket/builder-relayer-client');
const {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
} = require('@polymarket/clob-client-v2');
const {
  createWalletClient,
  http,
  encodeFunctionData,
  maxUint256,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { polygon } = require('viem/chains');

// ---------- verified Polymarket contracts on Polygon mainnet (chain 137) ----------
// Source: https://docs.polymarket.com/resources/contracts

const CONTRACTS = {
  PUSD: '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB',
  CTF_EXCHANGE: '0xE111180000d2663C0091e4f400237545B87B996B',
  NEG_RISK_EXCHANGE: '0xe2222d279d744050d28e00520010520000310F59',
  CTF_ERC1155: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  DEPOSIT_WALLET_FACTORY: '0x00000000000Fb5C9ADea0298D729A0CB3823Cc07',
};

// ---------- env ----------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const RELAYER_URL = requireEnv('RELAYER_URL');
const CLOB_API_URL = requireEnv('CLOB_API_URL');
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 137);
const RPC_URL = requireEnv('RPC_URL');
const PRIVATE_KEY = requireEnv('PRIVATE_KEY');

const PUSD_ADDRESS = process.env.PUSD_ADDRESS ?? CONTRACTS.PUSD;
const CTF_EXCHANGE_ADDRESS =
  process.env.CTF_EXCHANGE_ADDRESS ?? CONTRACTS.CTF_EXCHANGE;
const NEG_RISK_EXCHANGE_ADDRESS =
  process.env.NEG_RISK_EXCHANGE_ADDRESS ?? CONTRACTS.NEG_RISK_EXCHANGE;
const CTF_ERC1155_ADDRESS = process.env.CTF_ADDRESS ?? CONTRACTS.CTF_ERC1155;

// ---------- clients ----------

const account = privateKeyToAccount(PRIVATE_KEY);

const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(RPC_URL),
});

const builderCreds = {
  key: requireEnv('BUILDER_API_KEY'),
  secret: requireEnv('BUILDER_SECRET'),
  passphrase: requireEnv('BUILDER_PASS_PHRASE'),
};

const builderConfig = new BuilderConfig({
  localBuilderCreds: builderCreds,
});

// Positional constructor — the 0.0.8 signature documented in the
// Polymarket deposit-wallet guide. Do NOT pass an options object here.
const relayer = new RelayClient(
  RELAYER_URL,
  CHAIN_ID,
  walletClient,
  builderConfig
);

// ---------- deposit wallet: address + deploy ----------

/** Deterministic deposit wallet address for the configured signer. No tx submitted. */
async function getDepositWalletAddress() {
  return relayer.deriveDepositWalletAddress();
}

/**
 * Deploys the deposit wallet via a WALLET-CREATE relayer tx if needed.
 * Returns the deposit wallet address.
 */
async function ensureDepositWalletDeployed() {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();
  const response = await relayer.deployDepositWallet();
  await response.wait();
  return depositWalletAddress;
}

// ---------- ABI fragments ----------

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

const ERC1155_SET_APPROVAL_FOR_ALL_ABI = [
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
];

// ---------- call builders ----------

/** ERC-20 approve() DepositWalletCall (max allowance by default). */
function buildErc20ApproveCall(tokenAddress, spenderAddress, amount = maxUint256) {
  return {
    target: tokenAddress,
    value: '0',
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [spenderAddress, amount],
    }),
  };
}

/** ERC-1155 setApprovalForAll() DepositWalletCall — used for CTF outcome tokens. */
function buildErc1155SetApprovalForAllCall(
  tokenAddress,
  operatorAddress,
  approved = true
) {
  return {
    target: tokenAddress,
    value: '0',
    data: encodeFunctionData({
      abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
      functionName: 'setApprovalForAll',
      args: [operatorAddress, approved],
    }),
  };
}

// ---------- approval batches ----------

/**
 * Approves both CTF exchanges to spend pUSD AND sets ERC-1155 operator
 * approval on the CTF for outcome-token transfers. Approvals come FROM the
 * deposit wallet (correct), not from the EOA.
 *
 * Pass { includeNegRisk: false } to skip the neg-risk exchange.
 */
async function approveTradingContracts({
  includeNegRisk = true,
  deadlineSeconds = 600,
} = {}) {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();

  const calls = [
    // pUSD spending approval for the standard CTF Exchange
    buildErc20ApproveCall(PUSD_ADDRESS, CTF_EXCHANGE_ADDRESS),
    // CTF ERC-1155 operator approval for the standard CTF Exchange
    buildErc1155SetApprovalForAllCall(CTF_ERC1155_ADDRESS, CTF_EXCHANGE_ADDRESS),
  ];

  if (includeNegRisk) {
    calls.push(
      buildErc20ApproveCall(PUSD_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS),
      buildErc1155SetApprovalForAllCall(
        CTF_ERC1155_ADDRESS,
        NEG_RISK_EXCHANGE_ADDRESS
      )
    );
  }

  const deadline = Math.floor(Date.now() / 1000 + deadlineSeconds).toString();
  const response = await relayer.executeDepositWalletBatch(
    calls,
    depositWalletAddress,
    deadline
  );
  return response.wait();
}

/** Generic batch executor for redeem / transfer / custom calls. */
async function executeBatch(calls, { deadlineSeconds = 600 } = {}) {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();
  const deadline = Math.floor(Date.now() / 1000 + deadlineSeconds).toString();
  const response = await relayer.executeDepositWalletBatch(
    calls,
    depositWalletAddress,
    deadline
  );
  return response.wait();
}

// ---------- CLOB client (POLY_1271) ----------

/**
 * CLOB v2 client configured for deposit-wallet POLY_1271 orders.
 * Funder = deposit wallet address; SDK sets order.maker and order.signer
 * to the funder, as required for ERC-1271 validation.
 */
async function createClobClient() {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();

  const creds = {
    key: requireEnv('CLOB_API_KEY'),
    secret: requireEnv('CLOB_SECRET'),
    passphrase: requireEnv('CLOB_PASS_PHRASE'),
  };

  return new ClobClient({
    host: CLOB_API_URL,
    chain: CHAIN_ID,
    signer: walletClient,
    creds,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: depositWalletAddress,
  });
}

/** Sync CLOB collateral balance/allowance cache for the deposit wallet. */
async function syncCollateralBalance(clob) {
  return clob.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
}

/** Sync CLOB conditional-token balance/allowance for a specific outcome token. */
async function syncConditionalBalance(clob, tokenId) {
  return clob.updateBalanceAllowance({
    asset_type: AssetType.CONDITIONAL,
    token_id: tokenId,
  });
}

/** Place a single GTC limit order from the deposit wallet. */
async function placeLimitOrder(clob, {
  tokenId,
  price,
  size,
  side,
  tickSize = '0.01',
  negRisk = false,
}) {
  const sideEnum = side === 'SELL' ? Side.SELL : Side.BUY;
  return clob.createAndPostOrder(
    { tokenID: tokenId, price, size, side: sideEnum },
    { tickSize, negRisk },
    OrderType.GTC
  );
}

// ---------- bootstrap helper ----------

/**
 * One-shot setup for a new user:
 *   derive wallet -> deploy -> approve exchanges -> build CLOB -> sync balance
 * Safe to call repeatedly.
 */
async function bootstrapDepositWalletUser({ includeNegRisk = true } = {}) {
  const depositWalletAddress = await ensureDepositWalletDeployed();
  await approveTradingContracts({ includeNegRisk });
  const clob = await createClobClient();
  await syncCollateralBalance(clob);
  return { depositWalletAddress, clob };
}

module.exports = {
  CONTRACTS,
  // low-level
  relayer,
  walletClient,
  builderConfig,
  // address + deploy
  getDepositWalletAddress,
  ensureDepositWalletDeployed,
  // call builders
  buildErc20ApproveCall,
  buildErc1155SetApprovalForAllCall,
  // batches
  approveTradingContracts,
  executeBatch,
  // clob
  createClobClient,
  syncCollateralBalance,
  syncConditionalBalance,
  placeLimitOrder,
  // bootstrap
  bootstrapDepositWalletUser,
};

// ---------- CLI smoke test ----------
// node polymarket.js                -> derived deposit wallet
// node polymarket.js deploy         -> derive + deploy
// node polymarket.js approve        -> approve both exchanges
// node polymarket.js bootstrap      -> full setup
if (require.main === module) {
  (async () => {
    const cmd = process.argv[2] || 'address';
    try {
      if (cmd === 'address') {
        console.log('Deposit wallet:', await getDepositWalletAddress());
      } else if (cmd === 'deploy') {
        console.log('Deployed:', await ensureDepositWalletDeployed());
      } else if (cmd === 'approve') {
        console.log('Approve batch:', await approveTradingContracts());
      } else if (cmd === 'bootstrap') {
        const { depositWalletAddress } = await bootstrapDepositWalletUser();
        console.log('Bootstrap complete. Deposit wallet:', depositWalletAddress);
      } else {
        console.log('Usage: node polymarket.js [address|deploy|approve|bootstrap]');
        process.exit(1);
      }
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  })();
}
