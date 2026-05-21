// ─────────────────────────────────────────────────────────────────────
// Predict — Polymarket prediction markets, crypto focus.
//
// FLOW:
//   1. User taps Yes/No → order drawer opens
//   2. Bridge Solana USDC → Polygon USDC.e via LI.FI (2% integrator fee
//      to LIFI_FEE_RECIPIENT). Funds land at user's derived Polygon
//      proxy address.
//   3. Polygon gas sponsorship: server endpoint sends MATIC for gas;
//      fallback to user-funded SOL→MATIC bridge if sponsor down.
//   4. Polymarket CLOB order signed (EIP-712) from derived Polygon
//      private key — silent, no second user prompt.
//   5. Winnings auto-redeem at user's Polygon address. "Bring home"
//      banner detects USDC, bridges back to Solana with another 2% fee.
//
// Same architecture as PerpsTrade.js — Polygon swapped for Arbitrum,
// Polymarket CLOB swapped for Hyperliquid exchange API.
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';
import {
  createConfig as lifiCreateConfig,
  config as lifiConfig,
  Solana as LifiSolana,
  EVM as LifiEVM,
  getRoutes as lifiGetRoutes,
  executeRoute as lifiExecuteRoute,
  getTokens as lifiGetTokens,
} from '@lifi/sdk';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ═════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════

const VIP_WALLETS = new Set(['Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV']);

// LI.FI integrator fee — 2% to your Solana wallet on every bridge.
const LIFI_INTEGRATOR     = 'VerixiaPredict';
const LIFI_FEE_RECIPIENT  = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const LIFI_FEE            = 0.02;  // 2%

// Polymarket referral — leave blank, fill in when account is set up.
const POLYMARKET_REFERRER = ''; // TODO: your Polymarket Polygon address

// Chain IDs / token addresses
const POLYGON_CHAIN_ID    = 137;
const POLYGON_USDC_E      = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e on Polygon (Polymarket settlement token)
const POLYGON_MATIC_NATIVE= '0x0000000000000000000000000000000000000000';
const POLYGON_RPC         = 'https://polygon-rpc.com';

const SOL_MINT             = '11111111111111111111111111111111';
const LIFI_SOLANA_CHAIN_ID = 1151111081099710;
const USDC_SOLANA_MINT     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL     = 1_000_000_000;

const POLY_RPC_PRIMARY = process.env.REACT_APP_POLYGON_RPC || POLYGON_RPC;
const SOL_RPC_PRIMARY  = process.env.REACT_APP_SOL_RPC || null;

// Polymarket CLOB endpoint
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';

// Polymarket Gamma API for market discovery
const GAMMA_URL    = 'https://gamma-api.polymarket.com';
const CRYPTO_TAG_ID = 21;

// Geo block
const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const US_BLOCK      = new Set(['US']);

// Minimum stuck USDC (in 6-decimal units) before "bring home" banner shows
const SWEEP_MIN_USDC_UNITS = 1_000_000n; // $1.00

// Minimum Polygon MATIC balance before we deem gas sufficient (~$0.05 worth).
const MIN_MATIC_FOR_GAS = 50_000_000_000_000_000n; // 0.05 MATIC

const DERIVATION_MSG = (pub) =>
  `Verixia Predict: Authorize Polymarket Account\n\nWallet: ${pub}\n\nThis creates your non-custodial trading account on Polygon. No SOL is spent.`;

// ═════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═════════════════════════════════════════════════════════════════════

const C = {
  bg:        '#03060f',
  card:      '#080d1a',
  cardHi:    '#0c1428',
  ink:       '#e8ecf5',
  muted:     '#8a96b8',
  muted2:    '#475670',
  border:    'rgba(151,252,228,.10)',
  borderHi:  'rgba(151,252,228,.30)',
  hl:        '#97fce4',
  hlDim:     'rgba(151,252,228,.10)',
  violet:    '#a87fff',
  yes:       '#00d4a3',
  yesDim:    'rgba(0,212,163,.12)',
  no:        '#ff5f7a',
  noDim:     'rgba(255,95,122,.12)',
  amber:     '#f5b53d',
  shadow:    '0 8px 28px rgba(0,0,0,.45)',
  shadowLg:  '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// ═════════════════════════════════════════════════════════════════════
// UTILS
// ═════════════════════════════════════════════════════════════════════

function isValidEthAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '')); }
function isValidSolAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Resolving';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d >= 30) return `${Math.floor(d / 30)}mo`;
  if (d >= 1)  return `${d}d ${h}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

function isExpiredBlockhashError(msg) {
  return /block height|TransactionExpired|blockhash not found|has expired/i.test(String(msg || ''));
}

// ═════════════════════════════════════════════════════════════════════
// GEO DETECTION
// ═════════════════════════════════════════════════════════════════════

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

// ═════════════════════════════════════════════════════════════════════
// POLYGON WALLET DERIVATION
// Same pattern as deriveHLWallet — Solana sig → SHA-256 → secp256k1 key.
// One signature, cached in sessionStorage. Re-derivable from same Solana
// wallet at any time.
// ═════════════════════════════════════════════════════════════════════

let _ethersModule = null;
async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}
function getEthersNs(mod) {
  if (!mod) return null;
  if (mod.ethers?.Wallet) return mod.ethers;
  if (mod.Wallet)          return mod;
  if (mod.default?.Wallet) return mod.default;
  return null;
}

function getSessionWallet(solPubkey) {
  try {
    const raw = sessionStorage.getItem('verixia_poly_' + solPubkey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setSessionWallet(solPubkey, address, privateKey) {
  try { sessionStorage.setItem('verixia_poly_' + solPubkey, JSON.stringify({ address, privateKey })); }
  catch {}
}
function getKnownPolyAddress(solPubkey) {
  try { return localStorage.getItem('verixia_poly_addr_' + solPubkey) || null; }
  catch { return null; }
}
function setKnownPolyAddress(solPubkey, address) {
  try { localStorage.setItem('verixia_poly_addr_' + solPubkey, address); } catch {}
}
function getResolvedPolyAddress(solPubkey) {
  return getSessionWallet(solPubkey)?.address || getKnownPolyAddress(solPubkey);
}

async function derivePolygonWallet(signMessage, solPubkey) {
  const cached = getSessionWallet(solPubkey);
  if (cached) return cached;
  const encoded  = new TextEncoder().encode(DERIVATION_MSG(solPubkey));
  const sig      = await signMessage(encoded);
  const hash     = await crypto.subtle.digest('SHA-256', sig);
  const pk       = '0x' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ethersNs = getEthersNs(await getEthers());
  const wallet   = new ethersNs.Wallet(pk);
  const result   = { address: wallet.address, privateKey: pk };
  setSessionWallet(solPubkey, wallet.address, pk);
  setKnownPolyAddress(solPubkey, wallet.address);
  return result;
}

// ═════════════════════════════════════════════════════════════════════
// POLYGON RPC CLIENTS
// ═════════════════════════════════════════════════════════════════════

function makePolygonPublicClient() {
  const polyChain = {
    id: POLYGON_CHAIN_ID,
    name: 'Polygon',
    nativeCurrency: { decimals: 18, name: 'MATIC', symbol: 'MATIC' },
    rpcUrls: { default: { http: [POLY_RPC_PRIMARY] } },
  };
  return createPublicClient({ chain: polyChain, transport: http(POLY_RPC_PRIMARY) });
}
function makePolygonWalletClient(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const polyChain = {
    id: POLYGON_CHAIN_ID,
    name: 'Polygon',
    nativeCurrency: { decimals: 18, name: 'MATIC', symbol: 'MATIC' },
    rpcUrls: { default: { http: [POLY_RPC_PRIMARY] } },
  };
  return createWalletClient({ account, chain: polyChain, transport: http(POLY_RPC_PRIMARY) });
}

const ERC20_BALANCE_OF_ABI = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: '', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}];

async function readPolygonUsdcBalance(address) {
  if (!isValidEthAddress(address)) return 0n;
  try {
    const client = makePolygonPublicClient();
    return await client.readContract({
      address: POLYGON_USDC_E, abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf', args: [address],
    });
  } catch { return 0n; }
}

async function readPolygonMaticBalance(address) {
  if (!isValidEthAddress(address)) return 0n;
  try {
    const client = makePolygonPublicClient();
    return await client.getBalance({ address });
  } catch { return 0n; }
}

// ═════════════════════════════════════════════════════════════════════
// LI.FI CONFIG
// ═════════════════════════════════════════════════════════════════════

let _lifiConfigured = false;
function ensureLifiConfig() {
  if (_lifiConfigured) return;
  const cfg = {
    integrator: LIFI_INTEGRATOR,
    ...(LIFI_FEE_RECIPIENT && LIFI_FEE > 0
      ? { integratorFee: LIFI_FEE, integratorFeeRecipient: LIFI_FEE_RECIPIENT }
      : {}),
  };
  const rpcUrls = {};
  if (SOL_RPC_PRIMARY) rpcUrls[LIFI_SOLANA_CHAIN_ID] = [SOL_RPC_PRIMARY];
  if (POLY_RPC_PRIMARY && POLY_RPC_PRIMARY !== POLYGON_RPC) rpcUrls[POLYGON_CHAIN_ID] = [POLY_RPC_PRIMARY];
  if (Object.keys(rpcUrls).length > 0) cfg.rpcUrls = rpcUrls;
  lifiCreateConfig(cfg);
  _lifiConfigured = true;
}

let _solAddrCache = null;
async function resolveSolNativeAddress() {
  if (_solAddrCache) return _solAddrCache;
  try {
    const { tokens } = await lifiGetTokens({ chains: [LIFI_SOLANA_CHAIN_ID] });
    const list = tokens?.[LIFI_SOLANA_CHAIN_ID] || [];
    const sol = list.find(t => t.symbol === 'SOL' && t.priceUSD) || list.find(t => t.symbol === 'SOL');
    if (sol?.address) { _solAddrCache = sol.address; return sol.address; }
  } catch {}
  _solAddrCache = SOL_MINT;
  return SOL_MINT;
}

// ═════════════════════════════════════════════════════════════════════
// BRIDGE: Solana USDC → Polygon USDC.e (deposit for trade)
// ═════════════════════════════════════════════════════════════════════

async function bridgeSolToPolygonUsdc({
  usdcAmountAtomic,  // Solana USDC atomic units (6 decimals) OR SOL lamports if fromSol
  fromSol,           // boolean — if true, send SOL instead of USDC
  polyAddress,
  solPubkey,
  solWalletAdapter,
  onStatus,
}) {
  ensureLifiConfig();
  if (solWalletAdapter) {
    lifiConfig.setProviders([
      LifiSolana({ async getWalletAdapter() { return solWalletAdapter; } }),
    ]);
  }
  const solAddr = await resolveSolNativeAddress();

  const runOnce = async (label) => {
    onStatus?.(label);
    const result = await lifiGetRoutes({
      fromChainId:      LIFI_SOLANA_CHAIN_ID,
      toChainId:        POLYGON_CHAIN_ID,
      fromTokenAddress: fromSol ? solAddr : USDC_SOLANA_MINT,
      toTokenAddress:   POLYGON_USDC_E,
      fromAmount:       String(usdcAmountAtomic),
      fromAddress:      solPubkey,
      toAddress:        polyAddress,
      options: {
        slippage: 0.01,
        order: 'FASTEST',
        allowSwitchChain: false,
      },
    });
    if (!result?.routes?.length) {
      throw new Error('No bridge route Solana → Polygon. Try a larger amount.');
    }
    onStatus?.('Sign in wallet...');
    const executed = await lifiExecuteRoute(result.routes[0], {
      updateRouteHook(updated) {
        const step = updated?.steps?.[updated.steps.length - 1];
        const procs = step?.execution?.process || [];
        const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
        if (active?.message) onStatus?.(active.message);
        else if (procs.some(p => p.status === 'DONE')) onStatus?.('Bridging to Polygon...');
      },
    });
    let txHash = null;
    for (const step of (executed?.steps || [])) {
      for (const proc of (step?.execution?.process || [])) {
        if (proc.txHash) txHash = proc.txHash;
      }
    }
    if (!txHash) throw new Error('Bridge returned no transaction hash');
    return { txHash };
  };

  try {
    return await runOnce('Finding route...');
  } catch (e) {
    if (!isExpiredBlockhashError(e?.message)) throw e;
    onStatus?.('Blockhash expired — preparing fresh route...');
    return await runOnce('Sign again to retry...');
  }
}

// ═════════════════════════════════════════════════════════════════════
// GAS SPONSORSHIP (Polygon MATIC)
// Tier 1: server endpoint sponsors MATIC from our reserve wallet
// Tier 2: fallback to bridging $0.05 SOL → MATIC via LI.FI
// ═════════════════════════════════════════════════════════════════════

async function trySponsorPolygonGas(polyAddress) {
  try {
    const r = await fetch('/api/bridge/sponsor-polygon-gas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: polyAddress }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data?.ok) return { ok: true, txHash: data.txHash };
    if (r.status === 429) return { ok: false, retryable: true, reason: 'cooldown' };
    if (r.status === 503) return { ok: false, retryable: false, reason: 'sponsor-not-configured' };
    return { ok: false, retryable: false, reason: data?.error || `Sponsor returned ${r.status}` };
  } catch (e) {
    return { ok: false, retryable: false, reason: e?.message || 'Sponsor network error' };
  }
}

async function ensurePolygonGas({ polyAddress, solPubkey, solWalletAdapter, onStatus }) {
  const client = makePolygonPublicClient();
  let matic = 0n;
  try { matic = await client.getBalance({ address: polyAddress }); } catch {}
  if (matic >= MIN_MATIC_FOR_GAS) return;

  // Tier 1: server sponsor
  onStatus?.('Funding gas (no signature)...');
  const sponsored = await trySponsorPolygonGas(polyAddress);
  if (sponsored.ok) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const bal = await client.getBalance({ address: polyAddress });
        if (bal >= MIN_MATIC_FOR_GAS) return;
      } catch {}
      await new Promise(r => setTimeout(r, 2_500));
    }
    return;
  }
  if (sponsored.retryable) {
    throw new Error('Gas sponsorship on cooldown. Retry in 1 minute.');
  }

  console.warn('[gas sponsor unavailable, falling back to user-funded]', sponsored.reason);

  // Tier 2: bridge SOL → MATIC
  if (!solWalletAdapter) {
    throw new Error('Gas funding unavailable. Reconnect Solana wallet.');
  }
  ensureLifiConfig();
  onStatus?.('Funding gas (sign in wallet)...');
  lifiConfig.setProviders([
    LifiSolana({ async getWalletAdapter() { return solWalletAdapter; } }),
  ]);
  const solAddr = await resolveSolNativeAddress();
  const route = await lifiGetRoutes({
    fromChainId:      LIFI_SOLANA_CHAIN_ID,
    toChainId:        POLYGON_CHAIN_ID,
    fromTokenAddress: solAddr,
    toTokenAddress:   POLYGON_MATIC_NATIVE,
    fromAmount:       '3000000', // ~0.003 SOL → ~$0.30 in MATIC
    fromAddress:      solPubkey,
    toAddress:        polyAddress,
    options: { slippage: 0.02, order: 'FASTEST', allowSwitchChain: false },
  });
  if (!route?.routes?.length) throw new Error('No gas funding route available.');
  await lifiExecuteRoute(route.routes[0], {
    updateRouteHook(updated) {
      const step = updated?.steps?.[updated.steps.length - 1];
      const procs = step?.execution?.process || [];
      const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
      if (active?.message) onStatus?.(active.message);
    },
  });
  onStatus?.('Waiting for gas on Polygon...');
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    try {
      const bal = await client.getBalance({ address: polyAddress });
      if (bal >= MIN_MATIC_FOR_GAS) return;
    } catch {}
    await new Promise(r => setTimeout(r, 4_000));
  }
  throw new Error('Gas did not arrive. Try again.');
}

// ═════════════════════════════════════════════════════════════════════
// POLYMARKET CLOB
// Order signing + posting. EIP-712 typed data signed by derived Polygon
// private key (silent — no user prompt since we hold the key in-session).
// ═════════════════════════════════════════════════════════════════════

// CLOB exchange contract on Polygon (Polymarket's CTF Exchange).
const POLYMARKET_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

// Polymarket EIP-712 order struct
const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

const ORDER_DOMAIN = {
  name:              'Polymarket CTF Exchange',
  version:           '1',
  chainId:           POLYGON_CHAIN_ID,
  verifyingContract: POLYMARKET_EXCHANGE,
};

function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')).toString();
}

// Build + sign a Polymarket order from the derived Polygon wallet.
async function signPolymarketOrder({
  polyPrivateKey,
  polyAddress,
  tokenId,        // CLOB token ID (from market.clobTokenIds)
  side,           // 'BUY' (0) or 'SELL' (1)
  usdcAtomic,     // USDC.e amount in atomic units (6 dec)
  sharePrice,     // 0.0 to 1.0 — what the user accepts
}) {
  const ethersNs = getEthersNs(await getEthers());
  const wallet   = new ethersNs.Wallet(polyPrivateKey);
  const isBuy    = String(side).toUpperCase() === 'BUY' || side === 0;

  // makerAmount/takerAmount in 6-dec USDC atomic units.
  // BUY:  maker pays USDC, taker delivers shares (in token units, also 6 dec for Polymarket).
  // SELL: maker delivers shares, taker pays USDC.
  const usdcAmt   = BigInt(usdcAtomic);
  const shareAmt  = BigInt(Math.floor(Number(usdcAtomic) / sharePrice));

  const order = {
    salt:          generateSalt(),
    maker:         polyAddress.toLowerCase(),
    signer:        polyAddress.toLowerCase(),
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       String(tokenId),
    makerAmount:   isBuy ? usdcAmt.toString()  : shareAmt.toString(),
    takerAmount:   isBuy ? shareAmt.toString() : usdcAmt.toString(),
    expiration:    '0',  // 0 = good-till-cancelled
    nonce:         '0',
    feeRateBps:    '0',  // Polymarket sets fees via referrer attribution
    side:          isBuy ? 0 : 1,
    signatureType: 0,    // 0 = EIP-712
  };

  const signature = typeof wallet.signTypedData === 'function'
    ? await wallet.signTypedData(ORDER_DOMAIN, ORDER_TYPES, order)
    : await wallet._signTypedData(ORDER_DOMAIN, ORDER_TYPES, order);

  return { order, signature };
}

async function postPolymarketOrder({ order, signature, polyAddress }) {
  const body = {
    order: { ...order, signature },
    owner: polyAddress.toLowerCase(),
    orderType: 'GTC',
    ...(POLYMARKET_REFERRER ? { referrer: POLYMARKET_REFERRER.toLowerCase() } : {}),
  };
  const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || data?.errorMsg || `CLOB returned ${res.status}`);
  }
  return data;
}

// ═════════════════════════════════════════════════════════════════════
// PRE-FLIGHT SIMULATION
// Polymarket simulates internally via `/order/preflight` — checks the
// order would be accepted (balance, price, signature). If it fails, we
// surface the error without triggering anything on-chain.
// ═════════════════════════════════════════════════════════════════════

async function simulatePolymarketOrder({ order, signature, polyAddress }) {
  try {
    const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/order/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order: { ...order, signature },
        owner: polyAddress.toLowerCase(),
      }),
    }, 10_000);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data?.error || `Simulation returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    // If preflight is unavailable, don't block — actual order post will catch real errors.
    console.warn('[poly preflight]', e?.message || e);
    return { ok: true, warning: 'preflight unavailable' };
  }
}

// ═════════════════════════════════════════════════════════════════════
// BRIDGE BACK (winnings / withdraw)
// Polygon USDC.e → Solana USDC. Same 2% LI.FI integrator fee.
// ═════════════════════════════════════════════════════════════════════

async function bridgePolygonUsdcToSol({ polyWalletData, solPubkey, solWalletAdapter, onStatus }) {
  ensureLifiConfig();

  await ensurePolygonGas({
    polyAddress:    polyWalletData.address,
    solPubkey,
    solWalletAdapter,
    onStatus,
  });

  const usdcBalance = await readPolygonUsdcBalance(polyWalletData.address);
  if (usdcBalance < SWEEP_MIN_USDC_UNITS) {
    throw new Error('No USDC to bridge on Polygon');
  }

  onStatus?.('Bridging to Solana...');
  const solAddr = await resolveSolNativeAddress();
  const polyClient = makePolygonWalletClient(polyWalletData.privateKey);

  const providers = [
    LifiEVM({
      getWalletClient: async () => polyClient,
      switchChain:     async () => polyClient,
    }),
  ];
  if (solWalletAdapter) {
    providers.push(LifiSolana({ async getWalletAdapter() { return solWalletAdapter; } }));
  }
  lifiConfig.setProviders(providers);

  const route = await lifiGetRoutes({
    fromChainId:      POLYGON_CHAIN_ID,
    toChainId:        LIFI_SOLANA_CHAIN_ID,
    fromTokenAddress: POLYGON_USDC_E,
    toTokenAddress:   USDC_SOLANA_MINT,
    fromAmount:       usdcBalance.toString(),
    fromAddress:      polyWalletData.address,
    toAddress:        solPubkey,
    options: { slippage: 0.02, order: 'FASTEST', allowSwitchChain: false },
  });
  if (!route?.routes?.length) {
    throw new Error('No bridge route Polygon → Solana');
  }

  const EXEC_TIMEOUT_MS = 4 * 60_000;
  const executed = await Promise.race([
    lifiExecuteRoute(route.routes[0], {
      updateRouteHook(updated) {
        const step = updated?.steps?.[updated.steps.length - 1];
        const procs = step?.execution?.process || [];
        const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
        if (active?.message) onStatus?.(active.message);
      },
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Bridge timed out. Funds safe on Polygon — reopen to retry.')),
      EXEC_TIMEOUT_MS,
    )),
  ]);

  let txHash = null;
  for (const step of (executed?.steps || [])) {
    for (const proc of (step?.execution?.process || [])) {
      if (proc.txHash) txHash = proc.txHash;
    }
  }
  return { txHash, usdcSwept: usdcBalance };
}

// ═════════════════════════════════════════════════════════════════════
// END-TO-END TRADE: bridge + sign + post
// ═════════════════════════════════════════════════════════════════════

async function executePolymarketTrade({
  market,           // normalized event
  side,             // 'yes' | 'no'
  usdAmount,        // dollars to spend (USDC notional)
  polyWalletData,   // { address, privateKey } from derivePolygonWallet
  solPubkey,
  solWalletAdapter,
  onStatus,
}) {
  // 1. Determine which CLOB token ID + price (yes vs no)
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  const price   = side === 'yes' ? market.yesPrice : market.noPrice;
  if (!tokenId)           throw new Error('Market token ID missing');
  if (!(price > 0 && price < 1)) throw new Error('Invalid market price');

  const usdcAtomic = BigInt(Math.floor(usdAmount * 1_000_000)); // 6 decimals

  // 2. Bridge USDC Solana → Polygon (if user doesn't already have enough USDC.e)
  let polyUsdc = await readPolygonUsdcBalance(polyWalletData.address);
  if (polyUsdc < usdcAtomic) {
    const needed = usdcAtomic - polyUsdc;
    onStatus?.('Bridging USDC to Polygon...');
    await bridgeSolToPolygonUsdc({
      usdcAmountAtomic: needed.toString(),
      fromSol:          false,
      polyAddress:      polyWalletData.address,
      solPubkey,
      solWalletAdapter,
      onStatus,
    });
    onStatus?.('Waiting for funds...');
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      polyUsdc = await readPolygonUsdcBalance(polyWalletData.address);
      if (polyUsdc >= usdcAtomic) break;
      await new Promise(r => setTimeout(r, 4_000));
    }
    if (polyUsdc < usdcAtomic) {
      throw new Error('Bridge timed out. Funds safe on Polygon — refresh to retry.');
    }
  }

  // 3. Ensure gas on Polygon
  await ensurePolygonGas({
    polyAddress: polyWalletData.address,
    solPubkey,
    solWalletAdapter,
    onStatus,
  });

  // 4. Sign Polymarket order (silent, no user prompt)
  onStatus?.('Signing order...');
  const { order, signature } = await signPolymarketOrder({
    polyPrivateKey: polyWalletData.privateKey,
    polyAddress:    polyWalletData.address,
    tokenId,
    side:           'BUY',     // buying YES or NO shares
    usdcAtomic:     usdcAtomic.toString(),
    sharePrice:     price,
  });

  // 5. Preflight simulation
  onStatus?.('Simulating...');
  const sim = await simulatePolymarketOrder({ order, signature, polyAddress: polyWalletData.address });
  if (!sim.ok) throw new Error(sim.message || 'Order simulation failed');

  // 6. Post order
  onStatus?.('Submitting to Polymarket...');
  const result = await postPolymarketOrder({ order, signature, polyAddress: polyWalletData.address });
  return result;
}

// ═════════════════════════════════════════════════════════════════════
// GAMMA MARKETS (discovery)
// ═════════════════════════════════════════════════════════════════════

async function fetchCryptoMarkets() {
  const url = `${GAMMA_URL}/events?tag_id=${CRYPTO_TAG_ID}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function normalizeEvent(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (markets.length === 0) return null;
  const market = markets[0];
  let outcomePrices = [];
  try {
    outcomePrices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : (market.outcomePrices || []);
  } catch {}
  let clobTokenIds = [];
  try {
    clobTokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : (market.clobTokenIds || []);
  } catch {}
  const yesPrice = Number(outcomePrices[0] || market.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  return {
    id:           ev.id,
    slug:         ev.slug,
    title:        ev.title || market.question || 'Untitled',
    image:        ev.image || ev.icon || market.image || null,
    volume24h:    Number(ev.volume24hr || market.volume24hr || 0),
    volumeTotal:  Number(ev.volume || market.volume || 0),
    liquidity:    Number(ev.liquidity || market.liquidity || 0),
    endDate:      ev.endDate || market.endDate || null,
    yesPrice,
    noPrice,
    yesPct:       Math.round(yesPrice * 100),
    noPct:        Math.round(noPrice * 100),
    marketCount:  markets.length,
    conditionId:  market.conditionId,
    clobTokenIds,
  };
}

// ═════════════════════════════════════════════════════════════════════
// UI: Region block / Coming soon
// ═════════════════════════════════════════════════════════════════════

function RegionBlock() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '36px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict isn't available here</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Prediction markets are restricted in your region. Swap, VIP, and Wallet remain fully available.
        </div>
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 14l3-3 4 4 6-7"/>
            <circle cx="20" cy="8" r="1.5" fill={C.hl}/>
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display, letterSpacing: -.5 }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Coming soon. Trade crypto prediction markets directly from your Solana wallet.
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Skeleton + Market card
// ═════════════════════════════════════════════════════════════════════

function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, width: '85%', background: 'rgba(255,255,255,.06)', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '50%', background: 'rgba(255,255,255,.03)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
      </div>
    </div>
  );
}

function MarketCard({ market, onTrade }) {
  const { title, image, yesPct, yesPrice, noPrice, volume24h, endDate, marketCount } = market;
  const resolves = timeUntil(endDate);
  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        {image && (
          <img src={image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: 6, ...T.body }}>{title}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {resolves && (<><span style={{ opacity: .4 }}>·</span><span>{resolves}</span></>)}
            {marketCount > 1 && (<><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: C.yesDim, border: `1px solid rgba(0,212,163,.30)`, color: C.yes, fontWeight: 700, fontSize: 13, cursor: 'pointer', ...T.body }}>
          Yes · ${yesPrice.toFixed(2)}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: C.noDim, border: `1px solid rgba(255,95,122,.30)`, color: C.no, fontWeight: 700, fontSize: 13, cursor: 'pointer', ...T.body }}>
          No · ${noPrice.toFixed(2)}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Order drawer (LIVE execution)
// ═════════════════════════════════════════════════════════════════════

function OrderDrawer({ market, side, onClose, walletPubkey, solWalletAdapter, signMessage, refreshBalances }) {
  const [amount, setAmount]       = useState('10');
  const [status, setStatus]       = useState('idle'); // idle | working | success | error
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(true);

  if (!market) return null;
  const price       = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd         = Number(amount) || 0;
  const shares      = price > 0 ? usd / price : 0;
  const potentialReturn = shares;
  const upside      = usd > 0 ? ((potentialReturn - usd) / usd) * 100 : 0;
  const sideColor   = side === 'yes' ? C.yes : C.no;
  const sideDim     = side === 'yes' ? C.yesDim : C.noDim;
  const isBusy      = status === 'working';
  const isSuccess   = status === 'success';
  const canExecute  = !isBusy && usd >= 1 && walletPubkey && signMessage && market.clobTokenIds?.length >= 2;

  const handleExecute = async () => {
    if (!signMessage) { setError('Wallet does not support signing'); return; }
    if (usd < 1)      { setError('Minimum trade is $1'); return; }

    setStatus('working'); setError(''); setStatusMsg('Setting up Polygon account...');
    try {
      const polyWallet = await derivePolygonWallet(signMessage, walletPubkey);
      await executePolymarketTrade({
        market,
        side,
        usdAmount: usd,
        polyWalletData: polyWallet,
        solPubkey: walletPubkey,
        solWalletAdapter,
        onStatus: setStatusMsg,
      });
      setStatus('success');
      setStatusMsg('');
      refreshBalances?.();
      setTimeout(() => { onClose(); }, 2500);
    } catch (e) {
      console.error('[predict trade]', e);
      const msg = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error');
      setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: isBusy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={isBusy} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['10', '25', '100', '250'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={isBusy} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono }}>${v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 16, ...T.mono, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Shares</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>${potentialReturn.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Upside</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span>
          </div>
        </div>

        {statusMsg && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
            <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no, ...T.body }}>
            {error}
          </div>
        )}

        <button onClick={canExecute ? handleExecute : undefined} disabled={!canExecute} style={{
          width: '100%', padding: '14px', borderRadius: 13,
          background: isSuccess
            ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)`
            : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`,
          border: `1px solid ${sideColor}66`,
          color: sideColor,
          fontWeight: 800, fontSize: 14,
          cursor: canExecute ? 'pointer' : 'not-allowed',
          opacity: canExecute ? 1 : .55,
          ...T.body, letterSpacing: .5,
        }}>
          {isBusy ? 'Processing...' :
           isSuccess ? '✓ Order submitted' :
           `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
        </button>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 10, textAlign: 'center', lineHeight: 1.5, ...T.mono }}>
          Routes via Solana → Polygon bridge · 2% bridge fee · Order signed silently
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Bring-home banner (winnings)
// ═════════════════════════════════════════════════════════════════════

function BringHomeBanner({ usdcBalance, polyAddress, walletPubkey, solWalletAdapter, signMessage, refreshBalances }) {
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');

  const usd = Number(usdcBalance) / 1e6;
  if (usd < 1) return null;

  const handleBringHome = async () => {
    if (!signMessage) { setError('Wallet does not support signing'); return; }
    setBusy(true); setError(''); setMsg('Unlocking Polygon account...');
    try {
      const polyWallet = await derivePolygonWallet(signMessage, walletPubkey);
      await bridgePolygonUsdcToSol({
        polyWalletData: polyWallet,
        solPubkey: walletPubkey,
        solWalletAdapter,
        onStatus: setMsg,
      });
      setMsg('');
      refreshBalances?.();
    } catch (e) {
      console.error('[bring home]', e);
      setError(e?.message || 'Bring home failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(145deg,rgba(0,212,163,.10),rgba(151,252,228,.06))', border: `1px solid ${C.yes}55`, boxShadow: '0 0 20px rgba(0,212,163,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.yes, boxShadow: `0 0 8px ${C.yes}` }} />
        <span style={{ fontSize: 11, color: C.yes, fontWeight: 800, letterSpacing: .5, ...T.mono }}>FUNDS ON POLYGON</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>{fmtUsd(usd)}</div>
      {msg && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', borderRadius: 8, fontSize: 11, color: C.muted, ...T.body }}>{msg}</div>
      )}
      {error && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', borderRadius: 8, fontSize: 11, color: C.no, ...T.body }}>{error}</div>
      )}
      <button onClick={busy ? undefined : handleBringHome} disabled={busy} style={{
        width: '100%', padding: '11px', borderRadius: 10,
        background: `linear-gradient(135deg, ${C.yes}, ${C.hl})`,
        color: C.bg, fontWeight: 800, fontSize: 13, border: 'none',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? .65 : 1, ...T.body,
      }}>
        {busy ? 'Bringing home...' : `Bring ${fmtUsd(usd)} to Solana`}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Header
// ═════════════════════════════════════════════════════════════════════

function Header({ polyAddress }) {
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, ...T.mono, marginTop: 6 }}>Trade real-world outcomes · Polymarket</div>
        {polyAddress && (
          <div style={{ fontSize: 10, color: C.muted2, marginTop: 6, ...T.mono }}>
            Polygon: {polyAddress.slice(0,6)}...{polyAddress.slice(-4)}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// MAIN (gated)
// ═════════════════════════════════════════════════════════════════════

function PredictInner({ bypassGeo = false }) {
  const [country, setCountry]           = useState(null);
  const [geoChecked, setGeoChecked]     = useState(false);
  const [markets, setMarkets]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [search, setSearch]             = useState('');
  const [orderMarket, setOrderMarket]   = useState(null);
  const [orderSide, setOrderSide]       = useState('yes');
  const [polyAddress, setPolyAddress]   = useState(null);
  const [polyUsdcBal, setPolyUsdcBal]   = useState(0n);

  const { publicKey: solPk, wallet: solWallet, signMessage } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Resolve cached Polygon address on mount.
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedPolyAddress(walletPubkey);
    if (addr) setPolyAddress(addr);
  }, [walletPubkey]);

  // Poll Polygon USDC balance every 10s to power the bring-home banner.
  useEffect(() => {
    if (!polyAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const bal = await readPolygonUsdcBalance(polyAddress);
        if (alive) setPolyUsdcBal(bal);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [polyAddress]);

  const refreshBalances = useCallback(async () => {
    if (!polyAddress) return;
    try { setPolyUsdcBal(await readPolygonUsdcBalance(polyAddress)); } catch {}
  }, [polyAddress]);

  // Geo detection.
  useEffect(() => {
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, []);

  // Fetch markets after geo passes. Refresh every 30s.
  useEffect(() => {
    if (!geoChecked) return;
    if (!bypassGeo && country && US_BLOCK.has(country)) return;
    let alive = true;
    const load = async () => {
      try {
        const events = await fetchCryptoMarkets();
        if (!alive) return;
        const normalized = events.map(normalizeEvent).filter(Boolean);
        setMarkets(normalized);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [geoChecked, country, bypassGeo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return markets;
    return markets.filter(m => (m.title || '').toLowerCase().includes(q));
  }, [markets, search]);

  const openTrade = useCallback((market, side) => {
    setOrderMarket(market);
    setOrderSide(side);
  }, []);

  // Geo block (VIP bypasses).
  if (!bypassGeo && geoChecked && country && US_BLOCK.has(country)) {
    return <RegionBlock />;
  }

  if (!geoChecked || loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
        <Header polyAddress={polyAddress} />
        {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header polyAddress={polyAddress} />

        {polyAddress && (
          <BringHomeBanner
            usdcBalance={polyUsdcBal}
            polyAddress={polyAddress}
            walletPubkey={walletPubkey}
            solWalletAdapter={solWallet?.adapter}
            signMessage={signMessage}
            refreshBalances={refreshBalances}
          />
        )}

        <div style={{ marginBottom: 14, position: 'relative' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crypto markets..."
            inputMode="search"
            enterKeyHint="search"
            style={{
              width: '100%', padding: '11px 14px 11px 38px',
              background: 'rgba(255,255,255,.04)',
              border: `1px solid ${C.border}`,
              borderRadius: 12, color: C.ink, fontSize: 13, outline: 'none',
              ...T.body,
            }}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12, ...T.body }}>
            {error}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active crypto markets right now.'}
          </div>
        )}

        {filtered.map(m => (
          <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />
        ))}

        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 11, color: C.muted, lineHeight: 1.55, textAlign: 'center', ...T.mono }}>
          Markets sourced from Polymarket. Settled in USDC on Polygon. Resolution by UMA oracle.
        </div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket}
          side={orderSide}
          onClose={() => { setOrderMarket(null); refreshBalances(); }}
          walletPubkey={walletPubkey}
          solWalletAdapter={solWallet?.adapter}
          signMessage={signMessage}
          refreshBalances={refreshBalances}
        />
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════
// GATED EXPORT
// ═════════════════════════════════════════════════════════════════════

export default function Predict(props) {
  const solWallet = useWallet();
  const nexus     = useNexusWallet();
  const address =
    (solWallet?.publicKey && solWallet.publicKey.toBase58 && solWallet.publicKey.toBase58()) ||
    nexus?.walletAddress ||
    nexus?.privyEmbeddedSol ||
    null;
  const isVip = !!address && VIP_WALLETS.has(address);
  return isVip ? <PredictInner {...props} bypassGeo /> : <ComingSoon />;
}
