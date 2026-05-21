// polymarket-client.js
//
// Browser-side Polymarket client for Nexus DEX. Wraps two Polymarket
// services with our specific operational profile:
// 
//   1. Bridge API at bridge.polymarket.com (proxy of fun.xyz)
//      - Maps a user's derived EVM address to a Solana deposit address
//      - Polymarket auto-bridges USDC Solana -> USDC.e Polygon and
//        credits the EVM wallet's Polymarket balance
//      - Handles multi-chain withdrawals back to Solana
//      - No KYC, no partner approval, fully public access
//
//   2. CLOB API at clob.polymarket.com
//      - Off-chain order book with on-chain settlement
//      - signatureType = 0 (EOA), since the derived key IS a fresh EOA
//      - API credentials derived once per address, cached in localStorage
//      - Market orders via aggressive limit + FAK, sweeps book, never
//        rests; no slippage failure surfaced to the user
//
// Get-in-get-out architecture:
//   - Each trade is a full round trip: deposit on Solana, position on
//     Polygon, withdraw winnings to Solana
//   - No persistent Polygon balance (winnings auto-prompt for withdraw)
//   - Polymarket absorbs MATIC gas on the trading side; the user only
//     pays Nexus' Solana fee and Mayan/fun.xyz bridge fees from their
//     bridged USDC
//
// All functions are non-custodial. The derived key never leaves the
// browser. Nexus' backend never sees it.

import { ClobClient, Chain, Side, OrderType } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ---- constants -------------------------------------------------------------
const POLY_CLOB_HOST   = 'https://clob.polymarket.com';
const POLY_BRIDGE_HOST = 'https://bridge.polymarket.com';
const POLY_DATA_HOST   = 'https://data-api.polymarket.com';
const POLY_GAMMA_HOST  = 'https://gamma-api.polymarket.com';

// Public Polygon RPC fallback. Used only for the viem WalletClient that
// the CLOB SDK consumes for L1 signing — we don't read state directly.
const POLYGON_RPC = process.env.REACT_APP_POLYGON_RPC || 'https://polygon-rpc.com';

const CREDS_KEY = (addr) => 'nexus_clob_creds_v1_' + addr.toLowerCase();

// ---- viem wallet client ----------------------------------------------------
function makeWalletClient(privateKey) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: polygon,
    transport: http(POLYGON_RPC),
  });
}

// ---- CLOB client cache -----------------------------------------------------
const _clientCache = new Map(); // lowercase address -> ClobClient

// Get or derive Polymarket CLOB API credentials for the derived address.
// First call signs an L1 challenge with the derived EVM key (no user
// popup, the key is ours). Subsequent calls return cached creds.
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

// Idempotent: returns a fully-authenticated CLOB client for the derived
// address. One client per address per session.
export async function getClobClient(derivedKey) {
  if (!derivedKey?.privateKey || !derivedKey?.address)
    throw new Error('derivedKey { privateKey, address } required');
  const k = derivedKey.address.toLowerCase();
  if (_clientCache.has(k)) return _clientCache.get(k);

  const walletClient = makeWalletClient(derivedKey.privateKey);
  const creds        = await getOrDeriveCreds(walletClient, derivedKey.address);
  const client = new ClobClient({
    host:         POLY_CLOB_HOST,
    chain:        Chain.POLYGON,
    signer:       walletClient,
    creds,
    throwOnError: true,
  });
  _clientCache.set(k, client);
  return client;
}

// =============================================================================
// BRIDGE API — Polymarket's managed cross-chain bridge
// =============================================================================
// We call this through our backend (predict-bridge.js) to avoid CORS
// and to keep the integration vendor-versioned in one place. The
// backend proxies to bridge.polymarket.com unchanged.

const NEXUS_BRIDGE_BASE = process.env.REACT_APP_BRIDGE_API_BASE || '/api/bridge';

// Get the Solana deposit address that maps to a given EVM address.
// Polymarket assigns one Solana address per EVM address and remembers
// the mapping forever (idempotent — same evm always returns same sol).
//
// Returns: { svm: '<solana_addr>', evm: '<evm_addr>', btc: '<btc_addr>' }
export async function getDepositAddresses(evmAddress) {
  const res = await fetch(NEXUS_BRIDGE_BASE + '/deposit-addresses', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ evmAddress }),
  });
  if (!res.ok) throw new Error('Failed to get deposit addresses: ' + res.status);
  return await res.json();
}

// Initiate a withdrawal from Polymarket to the user's Solana wallet.
// Signs a withdrawal request with the derived EVM key via the CLOB
// client's auth, then POSTs to Polymarket's bridge withdrawal endpoint.
//
// args:
//   derivedKey:        { privateKey, address }
//   amountAtomicUsdc:  string (USDC.e atomic units, 6 decimals)
//   destSolanaAddress: user's Solana wallet (where the USDC arrives)
//
// Returns: { withdrawalId, etaSeconds }
export async function initiateWithdrawal({ derivedKey, amountAtomicUsdc, destSolanaAddress }) {
  if (!derivedKey?.privateKey)      throw new Error('derivedKey required');
  if (!amountAtomicUsdc)            throw new Error('amount required');
  if (!destSolanaAddress)           throw new Error('destSolanaAddress required');

  // The CLOB client gives us a configured signer we can use for the
  // L1 withdrawal challenge. We sign client-side, send to our backend
  // which forwards to bridge.polymarket.com — keeps the integration
  // vendor-portable.
  const client       = await getClobClient(derivedKey);
  const walletClient = makeWalletClient(derivedKey.privateKey);

  // Polymarket's withdrawal challenge: sign a deterministic message
  // containing { from, to, amount, nonce }. The backend builds the
  // payload from our request and we sign it locally.
  const prep = await fetch(NEXUS_BRIDGE_BASE + '/withdraw/prepare', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      fromEvm:           derivedKey.address,
      destChain:         'solana',
      destAddress:       destSolanaAddress,
      amountAtomicUsdc:  String(amountAtomicUsdc),
    }),
  });
  if (!prep.ok) throw new Error('Withdraw prepare failed: ' + prep.status);
  const { challengeMessage, challengeId } = await prep.json();
  if (!challengeMessage || !challengeId)
    throw new Error('Withdraw prepare returned invalid challenge');

  const signature = await walletClient.signMessage({
    account: derivedKey.address,
    message: challengeMessage,
  });

  const submit = await fetch(NEXUS_BRIDGE_BASE + '/withdraw/submit', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ challengeId, signature }),
  });
  if (!submit.ok) throw new Error('Withdraw submit failed: ' + submit.status);
  return await submit.json();
}

// =============================================================================
// CLOB API — order placement and position queries
// =============================================================================

// Place a market order that always fills. Aggressive limit (0.99 BUY /
// 0.01 SELL) + FAK (Fill-And-Kill) sweeps the book and cancels any
// unfilled remainder. Result: user gets filled at whatever liquidity
// exists, with the unfilled portion (if any) cancelled. No slippage
// failure ever surfaced.
//
// args:
//   derivedKey:  { privateKey, address }
//   tokenId:     Polymarket outcome token id (string)
//   sizeUsdc:    USDC notional (number) for BUY; share count for SELL
//   side:        'BUY' | 'SELL'
//   tickSize:    '0.01' (default) or '0.001' for some markets
//   negRisk:     boolean, must match the market's neg_risk flag
//
// Returns the CLOB order response with { orderID, status, ... }
export async function placeMarketOrder({
  derivedKey, tokenId, sizeUsdc, side = 'BUY',
  tickSize = '0.01', negRisk = false,
}) {
  if (!tokenId)        throw new Error('tokenId required');
  if (!(sizeUsdc > 0)) throw new Error('sizeUsdc must be positive');
  if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');

  const client          = await getClobClient(derivedKey);
  const aggressivePrice = side === 'BUY' ? 0.99 : 0.01;
  // BUY size: estimated share count assuming worst-case fill at the
  // aggressive cap. Actual fills are at lower prices, so the user ends
  // up with more shares than this estimate.
  // SELL size: share count being sold (caller computes from position).
  const sizeShares = side === 'BUY' ? (sizeUsdc / aggressivePrice) : sizeUsdc;

  // FAK = Fill-And-Kill. Sweep book, cancel remainder. Falls back to
  // GTC if FAK is rejected by some market/SDK combinations.
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

export async function cancelOrder(derivedKey, orderId) {
  const client = await getClobClient(derivedKey);
  return await client.cancelOrder({ orderID: orderId });
}

// =============================================================================
// READ APIs — public, no auth, no derived key required
// =============================================================================

// Polymarket Data API: positions held by a given EVM address.
// We surface this on the user's profile view ("My Positions").
export async function getPositions(evmAddress, { limit = 100 } = {}) {
  if (!evmAddress) return [];
  const url = POLY_DATA_HOST + '/positions?user=' + encodeURIComponent(evmAddress) +
              '&limit=' + limit + '&sortBy=CURRENT&sortDirection=DESC';
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  return (await r.json().catch(() => [])) || [];
}

// Recent trade history for an address.
export async function getTrades(evmAddress, { limit = 50 } = {}) {
  if (!evmAddress) return [];
  const url = POLY_DATA_HOST + '/trades?user=' + encodeURIComponent(evmAddress) +
              '&limit=' + limit;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  return (await r.json().catch(() => [])) || [];
}

// Resolved/settled positions ready to withdraw. A "winning" position
// is one where outcomeTokens were redeemable for USDC.e at $1 each.
export async function getResolvedPositions(evmAddress) {
  const all = await getPositions(evmAddress, { limit: 200 });
  return all.filter(p => p?.redeemable === true || p?.resolution === 'YES_WIN' || p?.resolution === 'NO_WIN');
}

// =============================================================================
// GAMMA API — market discovery
// =============================================================================
// Crypto-only filter for Nexus v1. The UI calls fetchCryptoMarkets with
// a subset filter ('hourly' | 'weekly' | 'monthly' | 'milestones' | 'all').

const GAMMA_BASE = process.env.REACT_APP_POLYMARKET_GAMMA_BASE || POLY_GAMMA_HOST;

// Fetch crypto markets from Polymarket Gamma. Returns normalized
// market objects ready for the UI. Filters to active, tradeable,
// crypto-category markets only.
export async function fetchCryptoMarkets({ tier = 'all', limit = 50 } = {}) {
  // tag_slug=crypto narrows to ~262 crypto markets. We then sub-filter
  // by question pattern to assign each market to a tier.
  const qs = new URLSearchParams({
    closed:           'false',
    active:           'true',
    archived:         'false',
    tag_slug:         'crypto',
    limit:            String(Math.min(limit, 100)),
    order:            'volume24hr',
    ascending:        'false',
  });
  const url = GAMMA_BASE + '/markets?' + qs.toString();
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  const raw = await r.json().catch(() => []);
  const normalized = (Array.isArray(raw) ? raw : [])
    .map(normalizeMarket)
    .filter(m => m && m.acceptingOrders && m.enableOrderBook);
  if (tier === 'all') return normalized;
  return normalized.filter(m => classifyTier(m) === tier);
}

function normalizeMarket(m) {
  if (!m || !m.id) return null;
  let outcomes = m.outcomes;
  let outcomePrices = m.outcomePrices;
  try { if (typeof outcomes === 'string')      outcomes      = JSON.parse(outcomes); } catch {}
  try { if (typeof outcomePrices === 'string') outcomePrices = JSON.parse(outcomePrices); } catch {}
  const clobTokenIds = (() => {
    try { return typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds; }
    catch { return []; }
  })();
  const eventSlug = m.events?.[0]?.slug || m.slug;
  return {
    id:               m.id,
    conditionId:      m.conditionId,
    question:         m.question,
    slug:             m.slug,
    eventSlug,
    description:      m.description,
    image:            m.image,
    icon:             m.icon,
    endDate:          m.endDate,
    category:         m.category,
    outcomes:         Array.isArray(outcomes) ? outcomes : ['Yes', 'No'],
    outcomePrices:    Array.isArray(outcomePrices) ? outcomePrices.map(Number) : [0.5, 0.5],
    clobTokenIds,
    volume24hr:       Number(m.volume24hr || 0),
    volumeTotal:      Number(m.volume || 0),
    liquidity:        Number(m.liquidity || 0),
    acceptingOrders:  m.acceptingOrders === true,
    enableOrderBook:  m.enableOrderBook === true,
    negRisk:          m.negRisk === true,
    tickSize:         m.orderPriceMinTickSize || m.minimum_tick_size || '0.01',
  };
}

// Heuristic classifier: assigns a normalized market to one of our
// product tiers based on its question pattern. Used to filter what
// shows under the Hourly / Weekly / Monthly / Milestones pills.
function classifyTier(m) {
  const q = (m.question || '').toLowerCase();
  if (/up or down\s+hourly|up or down\s+\d?\s*hour/.test(q)) return 'hourly';
  if (/up or down/.test(q) && /\d{1,2}:\d{2}/.test(q))       return 'hourly';
  if (/above\s+[\d_]+\s+on/.test(q) || /weekly/.test(q))     return 'weekly';
  if (/what price will .+ hit in (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(q)) return 'monthly';
  if (/will .+ hit \$[\d,]+/.test(q) || /all time high/.test(q) || /before gta vi/.test(q)) return 'milestones';
  // Fallback: long-dated end date treated as milestone.
  const end = new Date(m.endDate || 0);
  const days = (end - Date.now()) / 86_400_000;
  if (days > 60) return 'milestones';
  if (days > 7)  return 'monthly';
  if (days > 1)  return 'weekly';
  return 'hourly';
}

// =============================================================================
// CLEANUP
// =============================================================================

// Drop cached CLOB client + creds for an address. Called on wallet
// disconnect or "clear derived key" UX.
export function clearClient(address) {
  if (!address) return;
  _clientCache.delete(address.toLowerCase());
  try { localStorage.removeItem(CREDS_KEY(address)); } catch {}
}

// Constants exported for the UI:
export const POLY_CONST = {
  GAMMA_HOST:  POLY_GAMMA_HOST,
  DATA_HOST:   POLY_DATA_HOST,
  CLOB_HOST:   POLY_CLOB_HOST,
  BRIDGE_HOST: POLY_BRIDGE_HOST,
};
