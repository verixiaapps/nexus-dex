// polymarket-client.js
//
// Browser-side Polymarket CLOB client driven by a derived EVM private
// key (see derived-key.js). Wraps @polymarket/clob-client-v2 with our
// specific operational profile:
//
//   - signatureType = 0 (EOA). The derived key IS a fresh EOA; no
//     proxy wallet, no Magic Link, no Gnosis Safe.
//   - API credentials are derived once per address and cached in
//     localStorage (no need to re-sign for every order).
//   - One-time USDC.e allowance to the CTF Exchange, paid from the
//     user's own MATIC reserve (siphoned $0.50 on first deposit).
//   - Market orders that always fill: aggressive limit + FAK
//     (Fill-And-Kill) sweeps the book and cancels any unfilled
//     remainder. No slippage failure surfaced to the user.
//   - Position queries via Polymarket's public Data API (no auth).
//   - Withdrawals via Mayan from Polygon -> Solana, signed with the
//     same derived key.
//
// ALL FUNCTIONS ARE NON-CUSTODIAL. The derived key never leaves the
// browser. Nexus' backend never sees the user's EVM private key.
//
// USAGE
// -----
//   import { getClobClient, placeMarketBuy, getPositions, ensureUsdcAllowance }
//     from './polymarket-client';
//
//   const derivedKey = await getOrDeriveEvmKey({...});  // see derived-key.js
//
//   // First-trade flow:
//   await ensureUsdcAllowance(derivedKey);  // one-time, requires MATIC at address
//   const order = await placeMarketBuy({
//     derivedKey,
//     tokenId: '<yes-token-id>',
//     sizeUsdc: 50,
//     side: 'BUY',
//   });
//
//   // Subsequent reads:
//   const positions = await getPositions(derivedKey.address);

import { ClobClient, Chain, Side, OrderType } from '@polymarket/clob-client-v2';
import { createWalletClient, createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ---- constants -------------------------------------------------------------
const POLY_CLOB_HOST = 'https://clob.polymarket.com';
const POLY_DATA_API  = 'https://data-api.polymarket.com';

// Public Polygon RPC. Multiple endpoints for fallback. The user can
// override via REACT_APP_POLYGON_RPC.
const POLYGON_RPCS = [
  process.env.REACT_APP_POLYGON_RPC,
  'https://polygon-rpc.com',
  'https://polygon.llamarpc.com',
  'https://rpc.ankr.com/polygon',
].filter(Boolean);

// USDC.e (PoS bridged USDC) on Polygon — what Polymarket trades in.
export const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// Polymarket CTF Exchange contract — the spender for USDC.e allowance.
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

// neg-risk markets route through a different exchange.
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

const USDC_DECIMALS = 6;
const MAX_UINT256   = 2n ** 256n - 1n;

const CREDS_KEY = (addr) => 'nexus_clob_creds_v1_' + addr.toLowerCase();

// Minimal ERC-20 ABI (allowance, balanceOf, approve).
const ERC20_ABI = [
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs:  [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
];

// ---- client cache ----------------------------------------------------------
// One CLOB client per derived address — created on first use, cached
// in memory for the session. Module-local so multiple components can
// share without re-deriving creds.
const _clientCache = new Map(); // address (lowercase) -> ClobClient

function makePublicClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(POLYGON_RPCS[0]),
  });
}
function makeWalletClient(privateKey) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: polygon,
    transport: http(POLYGON_RPCS[0]),
  });
}

// Get or derive Polymarket API credentials for the derived address.
// First call signs a server-issued L1 challenge with the derived key
// (no user popup — we hold the key). Subsequent calls return cached
// creds. The creds are HMAC tokens used to authenticate order POSTs.
async function getOrDeriveCreds(walletClient, address) {
  const cacheK = CREDS_KEY(address);
  try {
    const raw = localStorage.getItem(cacheK);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.key && obj?.secret && obj?.passphrase) return obj;
    }
  } catch {}

  const tempClient = new ClobClient({
    host:   POLY_CLOB_HOST,
    chain:  Chain.POLYGON,
    signer: walletClient,
  });
  const creds = await tempClient.createOrDeriveApiKey();
  if (!creds?.key || !creds?.secret || !creds?.passphrase)
    throw new Error('Polymarket API key derivation failed');

  try { localStorage.setItem(cacheK, JSON.stringify(creds)); } catch {}
  return creds;
}

// Build a fully-authenticated CLOB client for a derived address. Idempotent.
export async function getClobClient(derivedKey) {
  if (!derivedKey?.privateKey || !derivedKey?.address)
    throw new Error('derivedKey { privateKey, address } required');
  const k = derivedKey.address.toLowerCase();
  if (_clientCache.has(k)) return _clientCache.get(k);

  const walletClient = makeWalletClient(derivedKey.privateKey);
  const creds        = await getOrDeriveCreds(walletClient, derivedKey.address);
  const client       = new ClobClient({
    host:         POLY_CLOB_HOST,
    chain:        Chain.POLYGON,
    signer:       walletClient,
    creds,
    throwOnError: true,
  });
  _clientCache.set(k, client);
  return client;
}

// ---- allowance + approval --------------------------------------------------

// Check USDC.e allowance from the derived address to the CTF Exchange.
// Returns a BigInt.
export async function getUsdcAllowance(derivedAddress, negRisk = false) {
  const pub = makePublicClient();
  return await pub.readContract({
    address:      USDC_E,
    abi:          ERC20_ABI,
    functionName: 'allowance',
    args: [derivedAddress, negRisk ? NEG_RISK_EXCHANGE : CTF_EXCHANGE],
  });
}

// Approve USDC.e max to the CTF Exchange. ONE-TIME per (address,
// exchange) pair. Requires MATIC at the derived address for gas
// (~$0.005 worth).
export async function approveUsdcMax(derivedKey, negRisk = false) {
  const walletClient = makeWalletClient(derivedKey.privateKey);
  const spender      = negRisk ? NEG_RISK_EXCHANGE : CTF_EXCHANGE;
  const hash = await walletClient.writeContract({
    address:      USDC_E,
    abi:          ERC20_ABI,
    functionName: 'approve',
    args:         [spender, MAX_UINT256],
  });
  const pub = makePublicClient();
  await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return hash;
}

// Convenience: check + approve if needed. Returns { approved, txHash? }.
export async function ensureUsdcAllowance(derivedKey, { sizeAtomic, negRisk = false } = {}) {
  const current = await getUsdcAllowance(derivedKey.address, negRisk);
  if (sizeAtomic != null && current >= BigInt(sizeAtomic))
    return { approved: true };
  if (sizeAtomic == null && current > 0n)
    return { approved: true };
  const txHash = await approveUsdcMax(derivedKey, negRisk);
  return { approved: true, txHash };
}

// ---- balances --------------------------------------------------------------

export async function getUsdcBalance(derivedAddress) {
  const pub = makePublicClient();
  const raw = await pub.readContract({
    address:      USDC_E,
    abi:          ERC20_ABI,
    functionName: 'balanceOf',
    args:         [derivedAddress],
  });
  return Number(raw) / 10 ** USDC_DECIMALS;
}

export async function getMaticBalance(derivedAddress) {
  const pub = makePublicClient();
  const raw = await pub.getBalance({ address: derivedAddress });
  return Number(raw) / 1e18;
}

// ---- order placement -------------------------------------------------------

// Place a market BUY that always fills. We use an aggressive limit
// (0.99 for YES tokens — the max valid price below $1) and FAK
// (Fill-And-Kill) order type, which sweeps the book and cancels any
// remainder. Result: user gets filled at whatever liquidity exists at
// any price up to 0.99, with the unfilled portion cancelled.
//
// args:
//   derivedKey: { privateKey, address }
//   tokenId:    Polymarket outcome token ID (string, get from Gamma)
//   sizeUsdc:   Number — USDC notional (e.g. 50 for $50)
//   side:       'BUY' or 'SELL'
//   tickSize:   '0.01' (default) or '0.001' for some markets
//   negRisk:    boolean, must match the market's neg_risk flag
//
// returns the CLOB order response with { orderID, status, ... }
export async function placeMarketBuy({
  derivedKey, tokenId, sizeUsdc, side = 'BUY',
  tickSize = '0.01', negRisk = false,
}) {
  if (!tokenId)            throw new Error('tokenId required');
  if (!(sizeUsdc > 0))     throw new Error('sizeUsdc must be positive');
  if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');

  const client = await getClobClient(derivedKey);

  // BUY: walk up the asks at any price <= 0.99
  // SELL: walk down the bids at any price >= 0.01
  // (Both bound by the valid tick range for binary prediction tokens.)
  const aggressivePrice = side === 'BUY' ? 0.99 : 0.01;
  // For BUY: size = shares we WANT at the aggressive price ceiling.
  //   sizeUsdc / aggressivePrice yields the max share count if filled
  //   at the cap; CLOB walks the book and we end up paying less per
  //   share in practice, getting MORE shares than this estimate.
  // For SELL: size = shares we're selling (caller computes from position).
  const sizeShares = side === 'BUY' ? (sizeUsdc / aggressivePrice) : sizeUsdc;

  // FAK = Fill-And-Kill. Sweeps available liquidity immediately and
  // cancels any unfilled remainder. Exactly what we want for "always
  // execute, never rest" semantics. Falls back to GTC if FAK is
  // rejected (some markets / SDK versions don't support FAK on POST).
  let resp;
  try {
    resp = await client.createAndPostOrder(
      {
        tokenID: tokenId,
        price:   aggressivePrice,
        side:    side === 'BUY' ? Side.BUY : Side.SELL,
        size:    sizeShares,
      },
      { tickSize, negRisk },
      OrderType.FAK,
    );
  } catch (e) {
    // Fallback for SDK / market combos where FAK isn't accepted.
    if (/order ?type|fak|fok/i.test(e?.message || '')) {
      resp = await client.createAndPostOrder(
        {
          tokenID: tokenId,
          price:   aggressivePrice,
          side:    side === 'BUY' ? Side.BUY : Side.SELL,
          size:    sizeShares,
        },
        { tickSize, negRisk },
        OrderType.GTC,
      );
    } else throw e;
  }
  return resp;
}

// Place a market SELL of an existing position (full or partial).
// Wraps placeMarketBuy with side=SELL. The "size" semantics are
// different: for SELL, size = shares to sell, not USDC notional.
export async function placeMarketSell({ derivedKey, tokenId, sizeShares, tickSize = '0.01', negRisk = false }) {
  return placeMarketBuy({
    derivedKey, tokenId,
    sizeUsdc: sizeShares,           // re-used as share count internally for SELL
    side:     'SELL',
    tickSize, negRisk,
  });
}

// ---- positions / history (read-only, no auth) -----------------------------

// Polymarket's Data API exposes positions and trades publicly by EOA.
// No auth required for reads — useful since we want to surface
// position state without round-tripping through the CLOB session.
export async function getPositions(derivedAddress, { limit = 100 } = {}) {
  const url = POLY_DATA_API + '/positions?user=' + encodeURIComponent(derivedAddress) +
              '&limit=' + limit + '&sortBy=CURRENT&sortDirection=DESC';
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  return (await r.json().catch(() => [])) || [];
}

export async function getTrades(derivedAddress, { limit = 50 } = {}) {
  const url = POLY_DATA_API + '/trades?user=' + encodeURIComponent(derivedAddress) +
              '&limit=' + limit;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  return (await r.json().catch(() => [])) || [];
}

// ---- helpers ---------------------------------------------------------------

// Cancel a resting order by ID. Used if the user changes their mind
// during the 1-3 min bridge window (rare; the UX flow normally just
// submits and walks away).
export async function cancelOrder(derivedKey, orderId) {
  const client = await getClobClient(derivedKey);
  return await client.cancelOrder({ orderID: orderId });
}

// Drop the cached CLOB client for an address — useful on wallet
// disconnect or when the user clears their derived key.
export function clearClient(address) {
  if (!address) return;
  _clientCache.delete(address.toLowerCase());
  try { localStorage.removeItem(CREDS_KEY(address)); } catch {}
}
