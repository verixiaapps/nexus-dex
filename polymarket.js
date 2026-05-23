/**
 * Polymarket integration — deposit wallet flow.
 *
 * Mirrors the official guide at:
 *   https://docs.polymarket.com/trading/deposit-wallets
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
 *   CHAIN_ID                 137
 *   RPC_URL                  Polygon RPC
 *   PRIVATE_KEY              0x-prefixed owner/session signer key
 *   BUILDER_API_KEY
 *   BUILDER_SECRET
 *   BUILDER_PASS_PHRASE
 *   CLOB_API_KEY
 *   CLOB_SECRET
 *   CLOB_PASS_PHRASE
 *   PUSD_ADDRESS             pUSD ERC-20 on Polygon
 *   CTF_ADDRESS              CTF exchange / spender to approve
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

// Positional constructor — this is the 0.0.8 signature documented in the
// Polymarket deposit-wallet guide. Do NOT pass an options object.
const relayer = new RelayClient(
  RELAYER_URL,
  CHAIN_ID,
  walletClient,
  builderConfig
);

// ---------- deposit wallet: address + deploy ----------

/**
 * Returns the deterministic deposit wallet address for the configured signer.
 * Does NOT submit any transaction.
 */
async function getDepositWalletAddress() {
  return relayer.deriveDepositWalletAddress();
}

/**
 * Deploys the deposit wallet via a WALLET-CREATE relayer tx.
 * Idempotent on the chain side — if already deployed, the relayer no-ops.
 * Returns the deposit wallet address.
 */
async function ensureDepositWalletDeployed() {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();
  const response = await relayer.deployDepositWallet();
  await response.wait();
  return depositWalletAddress;
}

// ---------- deposit wallet: approvals ----------

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

/**
 * Builds an ERC-20 approve() DepositWalletCall (max allowance by default).
 */
function buildApproveCall(tokenAddress, spenderAddress, amount = maxUint256) {
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

/**
 * Approves the CTF exchange to spend pUSD from the deposit wallet.
 * Pulls PUSD_ADDRESS + CTF_ADDRESS from env. Approvals must come FROM the
 * deposit wallet, not the owner EOA — that's exactly what this batch does.
 */
async function approvePUSDForCTF({ deadlineSeconds = 600 } = {}) {
  const depositWalletAddress = await relayer.deriveDepositWalletAddress();

  const approveCall = buildApproveCall(
    requireEnv('PUSD_ADDRESS'),
    requireEnv('CTF_ADDRESS')
  );

  const deadline = Math.floor(Date.now() / 1000 + deadlineSeconds).toString();

  const response = await relayer.executeDepositWalletBatch(
    [approveCall],
    depositWalletAddress,
    deadline
  );
  return response.wait();
}

/**
 * Generic batch executor — useful for redeem, transfer, multi-approve, etc.
 * `calls` must be DepositWalletCall[].
 */
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
 * Build a CLOB v2 client configured for deposit-wallet POLY_1271 orders.
 * The funder is the deposit wallet address — both order.maker and order.signer
 * are set to it by the SDK, which is required for ERC-1271 validation.
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

/**
 * Sync CLOB balance/allowance cache for the deposit wallet's pUSD.
 * Must be called after funding or after running approvePUSDForCTF.
 */
async function syncCollateralBalance(clob) {
  return clob.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
}

/**
 * Place a single GTC limit order from the deposit wallet.
 *   tokenId   — outcome token id (string)
 *   price     — 0..1
 *   size      — base units (whole tokens, not wei)
 *   side      — 'BUY' or 'SELL'
 *   tickSize  — '0.01' | '0.001' | etc.
 *   negRisk   — true for neg-risk markets
 */
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
 * One-shot setup for a new user: derive wallet -> deploy -> approve pUSD ->
 * build CLOB client -> sync balance. Returns { depositWalletAddress, clob }.
 * Safe to call repeatedly; relayer/CLOB calls are idempotent in practice.
 */
async function bootstrapDepositWalletUser() {
  const depositWalletAddress = await ensureDepositWalletDeployed();
  await approvePUSDForCTF();
  const clob = await createClobClient();
  await syncCollateralBalance(clob);
  return { depositWalletAddress, clob };
}

module.exports = {
  // low-level
  relayer,
  walletClient,
  builderConfig,
  // address + deploy
  getDepositWalletAddress,
  ensureDepositWalletDeployed,
  // batches
  buildApproveCall,
  approvePUSDForCTF,
  executeBatch,
  // clob
  createClobClient,
  syncCollateralBalance,
  placeLimitOrder,
  // bootstrap
  bootstrapDepositWalletUser,
};

// ---------- CLI smoke test ----------
// node polymarket.js               -> prints derived deposit wallet
// node polymarket.js deploy        -> derive + deploy if needed
// node polymarket.js approve       -> approve pUSD for CTF
// node polymarket.js bootstrap     -> full setup
if (require.main === module) {
  (async () => {
    const cmd = process.argv[2] || 'address';
    try {
      if (cmd === 'address') {
        const addr = await getDepositWalletAddress();
        console.log('Deposit wallet:', addr);
      } else if (cmd === 'deploy') {
        const addr = await ensureDepositWalletDeployed();
        console.log('Deployed/confirmed deposit wallet:', addr);
      } else if (cmd === 'approve') {
        const res = await approvePUSDForCTF();
        console.log('Approve batch confirmed:', res);
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
