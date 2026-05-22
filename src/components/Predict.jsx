// ─────────────────────────────────────────────────────────────────────
// Predict.jsx v4 — Single-page Polymarket UI with Privy embedded wallets
//
// ARCHITECTURE
//   • Privy embedded wallets:
//       privyEmbeddedSol — funding source + Solana signer for bridge tx
//       privyEmbeddedEvm — owns the Polymarket Safe + signs CLOB orders
//   • Phantom is still supported as an alt Solana signer when connected.
//   • The old EOA-derived-from-Solana-sig flow is GONE. No sessionStorage
//     private keys, no SHA-256-of-signature wallets.
//   • Trading and funding are DECOUPLED:
//       Funding = explicit action ("Move to trading" or send USDC.e direct)
//       Trading = silent, zero signatures, instant
//   • Bridge: LI.FI (Mayan denylisted) for Solana -> Polygon USDC.e.
//   • Markets filtered: drop >0.97/<0.03 prices, drop resolving, drop
//     low-volume, drop missing token IDs. No more $0.99/$0.01 noise.
//   • Time-horizon tabs: Hourly / Daily / Weekly / Monthly / All.
//
// FEE MODEL (max profit)
//   1. 5% on "Move to trading" (USDC -> Safe)
//   2. 1% builder taker fee on every trade (passive, via builderCode)
//   3. Free withdrawals
//
// USER FLOW
//   First-time user:
//     1. Privy login            -> Solana + Polygon wallets auto-created
//     2. Tap "Fund"             -> sees Privy Solana address + bridge option
//     3. Sends USDC from Phantom-> lands in Privy Solana wallet
//     4. Taps "Move to trading" -> 95% bridges to Safe via LI.FI, 5% fee
//     5. (silent) Safe deploys + approvals run in background
//     6. Taps Buy YES $10       -> silent order, done
//   Returning user:
//     Tap Buy. Zero signatures.
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction, TransactionInstruction, TransactionMessage, PublicKey,
} from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const VIP_WALLETS = new Set(['Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV']);

const SERVICE_FEE_PCT   = 0.05;
const FEE_RECIPIENT_SOL = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

const MOONPAY_API_KEY = process.env.REACT_APP_MOONPAY_API_KEY || '';
function buildMoonpayUrl(evmAddress) {
  const params = new URLSearchParams({
    currencyCode:       'usdc_polygon',
    walletAddress:      evmAddress || '',
    baseCurrencyAmount: '50',
  });
  if (MOONPAY_API_KEY) params.set('apiKey', MOONPAY_API_KEY);
  return 'https://buy.moonpay.com/?' + params.toString();
}

const POLY_PROXY_PATH = '/api/poly';
function polyProxyUrl(suffix = '') {
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  return `${origin}${POLY_PROXY_PATH}${suffix}`;
}
function lifiProxyUrl(suffix = '') {
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  return `${origin}/api/lifi${suffix}`;
}

const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL           = 'https://gamma-api.polymarket.com';
const DATA_API_URL        = 'https://data-api.polymarket.com';
const CRYPTO_TAG_ID       = 21;

const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS    = 6;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SOL_RPC          = '/api/solana-rpc';

const POLYGON_CHAIN_ID           = 137;
const CTF_EXCHANGE               = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_CTF_EXCHANGE      = '0xe2222d279d744050d28e00520010520000310F59';
const NEG_RISK_ADAPTER           = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E_ADDRESS             = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PUSD_ADDRESS               = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const RELAYER_URL                = 'https://relayer-v2.polymarket.com/';

const LIFI_SOLANA_CHAIN  = 'SOL';
const LIFI_POLYGON_CHAIN = 'POL';
const LIFI_BRIDGE_DENY   = ['mayan'];

const MIN_TRADE_USD   = 1;
const MIN_DEPOSIT_USD = 5;

const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const US_BLOCK      = new Set(['US']);

// Time-horizon tabs map to Gamma `tag_slug` queries. Slugs that don't
// resolve fall back to filtering the full crypto tag by duration.
const HORIZONS = [
  { id: 'hourly',  label: 'Hourly',  slug: '15-min-crypto', maxMs: 2  * 60 * 60_000 },
  { id: 'daily',   label: 'Daily',   slug: 'daily-crypto',  maxMs: 36 * 60 * 60_000 },
  { id: 'weekly',  label: 'Weekly',  slug: 'weekly-crypto', maxMs: 8  * 24 * 60 * 60_000 },
  { id: 'monthly', label: 'Monthly', slug: 'monthly-crypto',maxMs: 45 * 24 * 60 * 60_000 },
  { id: 'all',     label: 'All',     slug: null,            maxMs: Infinity },
];

// ═══════════════════════════════════════════════════════════════════
// DEBUG LOG
// ═══════════════════════════════════════════════════════════════════

const DBG_MAX = 200;
const _dbgListeners = new Set();
function _emit(entry) { for (const fn of _dbgListeners) { try { fn(entry); } catch {} } }
function dbg(scope, msg, data) {
  const entry = { ts: Date.now(), scope, msg, data };
  try {
    if (typeof window !== 'undefined') {
      window.__predictDebug = window.__predictDebug || [];
      window.__predictDebug.push(entry);
      if (window.__predictDebug.length > DBG_MAX) window.__predictDebug.shift();
    }
  } catch {}
  try {
    if (data !== undefined) console.log(`[predict:${scope}]`, msg, data);
    else                    console.log(`[predict:${scope}]`, msg);
  } catch {}
  _emit(entry);
}
function dbgErr(scope, msg, err) {
  dbg(scope, 'ERROR: ' + msg, {
    name:    err?.name,
    message: err?.message || String(err),
    code:    err?.code,
    status:  err?.status || err?.response?.status,
    body:    err?.response?.data || err?.data || undefined,
    stack:   err?.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : undefined,
  });
}
function dbgClear() {
  try { if (typeof window !== 'undefined') window.__predictDebug = []; } catch {}
  _emit({ ts: Date.now(), scope: 'debug', msg: '— cleared —' });
}
function useDbgLog() {
  const [, force] = useState(0);
  const ref = useRef([]);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && Array.isArray(window.__predictDebug)) {
        ref.current = [...window.__predictDebug];
      }
    } catch {}
    const fn = (entry) => {
      if (entry.msg === '— cleared —') ref.current = [];
      else {
        ref.current = [...ref.current, entry];
        if (ref.current.length > DBG_MAX) ref.current = ref.current.slice(-DBG_MAX);
      }
      force(x => x + 1);
    };
    _dbgListeners.add(fn);
    return () => { _dbgListeners.delete(fn); };
  }, []);
  return ref.current;
}

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════

const C = {
  bg: '#03060f', card: '#080d1a', cardHi: '#0c1428',
  ink: '#e8ecf5', inkStr: '#f5fafe', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no: '#ff5f7a', noDim: 'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow:   '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// ═══════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)   return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatEndDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const shortMonth = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (ms < 60 * 60_000) {
    const m = Math.floor(ms / 60_000);
    return `Ends in ${m}m`;
  }
  if (ms < 24 * 60 * 60_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `Ends in ${h}h ${m}m`;
  }
  if (ms < 7 * 86_400_000) {
    const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
    let tz = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart) tz = ' ' + tzPart.value;
    } catch {}
    return `Ends ${shortMonth} ${day}, ${time}${tz}`;
  }
  if (d.getFullYear() === new Date().getFullYear()) return `Ends ${shortMonth} ${day}`;
  return `Ends ${shortMonth} ${day}, ${d.getFullYear()}`;
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

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════
// GEO
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// PERSISTENT CACHE KEYS (per-user, keyed by EVM address)
// ═══════════════════════════════════════════════════════════════════

const KEYS = {
  safeAddr:      (evm) => 'nx_poly_safe_'      + evm.toLowerCase(),
  safeDeployed:  (evm) => 'nx_poly_deployed_'  + evm.toLowerCase(),
  approvalsSet:  (evm) => 'nx_poly_approved_'  + evm.toLowerCase(),
  clobCreds:     (evm) => 'nx_poly_creds_'     + evm.toLowerCase(),
};

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function lsGetJson(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
function lsSetJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// CLOB creds stay in sessionStorage (cleared on tab close) — these are
// HMAC keys that should not persist long-term.
function ssGetJson(k) { try { const r = sessionStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
function ssSetJson(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ═══════════════════════════════════════════════════════════════════
// POLYMARKET SDK LOADING (lazy)
// ═══════════════════════════════════════════════════════════════════

let _clobSdk = null, _relayerSdk = null, _viem = null;

async function loadSdks() {
  if (_clobSdk && _relayerSdk && _viem) return { clob: _clobSdk, relayer: _relayerSdk, viem: _viem };
  dbg('sdks', 'loading SDKs...');
  const [clob, relayer, viem, deriveMod, configMod] = await Promise.all([
    import('@polymarket/clob-client-v2'),
    import('@polymarket/builder-relayer-client'),
    import('viem'),
    import('@polymarket/builder-relayer-client/dist/builder/derive').catch(() => null),
    import('@polymarket/builder-relayer-client/dist/config').catch(() => null),
  ]);
  _clobSdk    = clob;
  _relayerSdk = { ...relayer, _derive: deriveMod, _config: configMod };
  _viem       = viem;
  dbg('sdks', 'loaded', {
    hasClobClient:  !!clob?.ClobClient,
    hasRelayClient: !!relayer?.RelayClient,
    hasDeriveSafe:  !!deriveMod?.deriveSafe,
    hasContractCfg: !!configMod?.getContractConfig,
    hasViem:        !!viem?.createWalletClient,
  });
  return { clob, relayer: _relayerSdk, viem };
}

// Build a viem WalletClient backed by Privy's EIP-1193 provider.
// This is the standard adapter pattern from the Polymarket reference
// repos (privy-safe-builder-example).
async function buildPrivyViemClient(getEvmProvider) {
  const { viem } = await loadSdks();
  const { createWalletClient, custom } = viem;
  const provider = await getEvmProvider();
  if (!provider) throw new Error('Privy EVM provider unavailable — is the user logged in?');
  const accounts = await provider.request({ method: 'eth_accounts' });
  const account  = (accounts && accounts[0]) || null;
  if (!account) throw new Error('No EVM account returned from Privy provider');
  const client = createWalletClient({ account, transport: custom(provider) });
  dbg('viem', 'Privy walletClient built', { account });
  return client;
}

// ═══════════════════════════════════════════════════════════════════
// SAFE: DERIVE + DEPLOY (via Privy EVM signer + Polymarket relayer)
// ═══════════════════════════════════════════════════════════════════

async function deriveSafeAddress(evmAddress) {
  const { relayer } = await loadSdks();
  const derive = relayer._derive;
  const cfg    = relayer._config;
  if (!derive?.deriveSafe || !cfg?.getContractConfig) {
    throw new Error('Polymarket relayer SDK derive helpers unavailable — check version');
  }
  const config = cfg.getContractConfig(POLYGON_CHAIN_ID);
  const safe = derive.deriveSafe(evmAddress, config.SafeContracts.SafeFactory);
  dbg('safe', 'deriveSafe ok', { evm: evmAddress, safe });
  return safe;
}

async function buildRelayClient(getEvmProvider) {
  const { relayer } = await loadSdks();
  const { RelayClient } = relayer;
  if (!RelayClient) throw new Error('RelayClient missing from @polymarket/builder-relayer-client');
  const signer = await buildPrivyViemClient(getEvmProvider);
  dbg('relay', 'constructing RelayClient', { relayer: RELAYER_URL, chain: POLYGON_CHAIN_ID });
  return new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, signer);
}

async function ensureSafeDeployed(evmAddress, getEvmProvider, onStatus) {
  let safe = lsGet(KEYS.safeAddr(evmAddress));
  if (!safe) {
    safe = await deriveSafeAddress(evmAddress);
    lsSet(KEYS.safeAddr(evmAddress), safe);
  }
  if (lsGet(KEYS.safeDeployed(evmAddress)) === '1') {
    dbg('safe', 'safe deployed flag cached — skipping deploy');
    return safe;
  }
  const relayClient = await buildRelayClient(getEvmProvider);
  try {
    if (typeof relayClient.getDeployed === 'function') {
      const deployed = await relayClient.getDeployed(safe);
      if (deployed) { lsSet(KEYS.safeDeployed(evmAddress), '1'); return safe; }
    }
  } catch (e) { dbgErr('safe', 'getDeployed threw (will attempt deploy)', e); }

  onStatus?.('Setting up your trading account…');
  dbg('safe', 'deploying Safe via RelayClient.deploy()');
  const response = await relayClient.deploy();
  const result   = await response.wait();
  const proxyAddr = result?.proxyAddress || safe;
  lsSet(KEYS.safeAddr(evmAddress),     proxyAddr);
  lsSet(KEYS.safeDeployed(evmAddress), '1');
  return proxyAddr;
}

// ═══════════════════════════════════════════════════════════════════
// CLOB API CREDS (L1 — derived via Privy EVM signer)
// ═══════════════════════════════════════════════════════════════════

async function getOrDeriveClobCreds(evmAddress, getEvmProvider) {
  const cached = ssGetJson(KEYS.clobCreds(evmAddress));
  if (cached?.key && cached?.secret && cached?.passphrase) {
    dbg('creds', 'using cached CLOB creds');
    return cached;
  }
  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildPrivyViemClient(getEvmProvider);

  dbg('creds', 'constructing temp ClobClient for L1 derivation');
  const tempClient = new ClobClient({
    host:  POLYMARKET_CLOB_URL,
    chain: POLYGON_CHAIN_ID,
    signer,
  });

  let creds;
  try { creds = await tempClient.createOrDeriveApiKey(); }
  catch (e1) {
    dbgErr('creds', 'createOrDeriveApiKey failed, trying deriveApiKey', e1);
    try { creds = await tempClient.deriveApiKey(); }
    catch (e2) {
      dbgErr('creds', 'deriveApiKey failed, trying createApiKey', e2);
      creds = await tempClient.createApiKey();
    }
  }
  const normalized = {
    key:        creds.key || creds.apiKey,
    secret:     creds.secret,
    passphrase: creds.passphrase,
  };
  ssSetJson(KEYS.clobCreds(evmAddress), normalized);
  return normalized;
}

// ═══════════════════════════════════════════════════════════════════
// TOKEN APPROVALS (gasless batched via RelayClient)
// ═══════════════════════════════════════════════════════════════════

const MAX_UINT256 = (1n << 256n) - 1n;

function encodeErc20Approve(spender, amount) {
  const sel = '095ea7b3';
  const sp  = spender.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const am  = BigInt(amount).toString(16).padStart(64, '0');
  return '0x' + sel + sp + am;
}
function encodeErc1155SetApprovalForAll(operator, approved) {
  const sel = 'a22cb465';
  const op  = operator.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const ap  = (approved ? '1' : '0').padStart(64, '0');
  return '0x' + sel + op + ap;
}

function buildApprovalTxs() {
  return [
    { to: USDC_E_ADDRESS,             value: '0', data: encodeErc20Approve(CONDITIONAL_TOKENS_ADDRESS, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS,             value: '0', data: encodeErc20Approve(CTF_EXCHANGE,               MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS,             value: '0', data: encodeErc20Approve(NEG_RISK_CTF_EXCHANGE,      MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS,             value: '0', data: encodeErc20Approve(NEG_RISK_ADAPTER,           MAX_UINT256.toString()) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(CTF_EXCHANGE,          true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(NEG_RISK_CTF_EXCHANGE, true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encodeErc1155SetApprovalForAll(NEG_RISK_ADAPTER,      true) },
  ];
}

async function ensureApprovals(evmAddress, getEvmProvider, onStatus) {
  if (lsGet(KEYS.approvalsSet(evmAddress)) === '1') return;
  onStatus?.('Approving Polymarket contracts…');
  dbg('approvals', 'submitting batched approvals');
  const relayClient = await buildRelayClient(getEvmProvider);
  const response = await relayClient.execute(buildApprovalTxs(), 'Set Polymarket trading approvals');
  await response.wait();
  lsSet(KEYS.approvalsSet(evmAddress), '1');
  dbg('approvals', 'approvals confirmed onchain');
}

// One-shot first-time setup: Safe deploy + CLOB creds + approvals, in
// parallel where possible. Idempotent — safe to call before every trade.
async function ensurePolymarketSetup(evmAddress, getEvmProvider, onStatus) {
  dbg('setup', 'ensurePolymarketSetup start', { evmAddress });
  const safeAddress = await ensureSafeDeployed(evmAddress, getEvmProvider, onStatus);
  // Approvals and creds can run in parallel — both only need the EVM signer.
  const [creds] = await Promise.all([
    getOrDeriveClobCreds(evmAddress, getEvmProvider),
    ensureApprovals(evmAddress, getEvmProvider, onStatus),
  ]);
  dbg('setup', 'ensurePolymarketSetup complete', { safeAddress });
  return { safeAddress, creds };
}

// ═══════════════════════════════════════════════════════════════════
// SOLANA BALANCE + TX ASSEMBLY (funding source = Privy Solana or Phantom)
// ═══════════════════════════════════════════════════════════════════

function deriveUsdcAta(ownerB58) {
  const owner = new PublicKey(ownerB58);
  const mint  = new PublicKey(USDC_SOLANA_MINT);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata.toBase58();
}

async function fetchSolanaUsdcBalance(ownerB58) {
  try {
    const ata = deriveUsdcAta(ownerB58);
    const res = await fetchWithTimeout(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance',
        params: [ata, { commitment: 'confirmed' }],
      }),
    }, 6_000);
    const json = await res.json();
    const amount = json?.result?.value?.amount;
    if (!amount) return 0n;
    return BigInt(amount);
  } catch { return 0n; }
}

async function ataExists(ataAddress) {
  try {
    const res = await fetchWithTimeout(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [ataAddress, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    }, 6_000);
    const json = await res.json();
    return !!json?.result?.value;
  } catch { return false; }
}

async function getRecentBlockhash() {
  const res = await fetchWithTimeout(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 6_000);
  const json = await res.json();
  const bh = json?.result?.value?.blockhash;
  if (!bh) throw new Error('Could not fetch recent blockhash');
  return bh;
}

function createSplTransferInstruction(source, destination, owner, amountAtomic) {
  const data = new Uint8Array(9);
  data[0] = 3;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(source),      isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner),       isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

function createAtaIfNeededInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true,  isWritable: true  },
      { pubkey: new PublicKey(ata),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint),  isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    data: new Uint8Array([1]),
  });
}

// ═══════════════════════════════════════════════════════════════════
// LI.FI BRIDGE (Solana USDC -> Polygon USDC.e, Mayan denied)
//
// Flow:
//   1. Take 5% fee off the top via a bundled SPL transfer on Solana
//   2. Request LI.FI quote for the remaining 95% from user's Solana
//      address to the Polymarket Safe on Polygon
//   3. Sign the LI.FI tx + the fee tx (Privy or Phantom signs)
//   4. Submit, poll status until COMPLETED
// ═══════════════════════════════════════════════════════════════════

async function lifiQuote({ fromAddress, toAddress, fromAmountAtomic }) {
  const params = new URLSearchParams({
    fromChain:    LIFI_SOLANA_CHAIN,
    toChain:      LIFI_POLYGON_CHAIN,
    fromToken:    USDC_SOLANA_MINT,
    toToken:      USDC_E_ADDRESS,
    fromAddress,
    toAddress,
    fromAmount:   String(fromAmountAtomic),
    integrator:   'nexus-dex',
    denyBridges:  LIFI_BRIDGE_DENY.join(','),
    // 3% slippage cap — high enough that LI.FI won't reject routes for
    // volatility, low enough that users can't get rugged on a bad fill.
    // LI.FI's router picks the actual best execution within this cap.
    slippage:     '0.03',
    // CHEAPEST optimizes for max receive after fees + slippage. Provider
    // chooses the best route automatically.
    order:        'CHEAPEST',
  });
  const url = lifiProxyUrl('/quote?' + params.toString());
  dbg('lifi', 'quote request', { fromAmountAtomic: String(fromAmountAtomic), toAddress });
  const r = await fetchWithTimeout(url, {}, 15_000);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    dbgErr('lifi', `quote ${r.status}`, new Error(t.slice(0, 200)));
    throw new Error(`Bridge quote failed: ${r.status}`);
  }
  const quote = await r.json();
  if (!quote?.transactionRequest && !quote?.tx) {
    dbgErr('lifi', 'no tx in quote response', new Error(JSON.stringify(quote).slice(0, 200)));
    throw new Error('Bridge returned no transaction');
  }
  dbg('lifi', 'quote OK', {
    bridge: quote?.tool || quote?.bridge,
    estDuration: quote?.estimate?.executionDuration,
    receiveAmount: quote?.estimate?.toAmount,
  });
  return quote;
}

async function lifiStatus({ txHash, fromChain, toChain, bridge }) {
  const params = new URLSearchParams({ txHash });
  if (fromChain) params.set('fromChain', String(fromChain));
  if (toChain)   params.set('toChain',   String(toChain));
  if (bridge)    params.set('bridge',    bridge);
  const url = lifiProxyUrl('/status?' + params.toString());
  const r = await fetchWithTimeout(url, {}, 10_000);
  if (!r.ok) return null;
  return await r.json();
}

// LI.FI returns the bridge tx as a base64-encoded VersionedTransaction
// for Solana. We deserialize, add a SECOND instruction for the 5% fee
// transfer to FEE_RECIPIENT_SOL, then re-sign.
//
// SECURITY NOTE: LI.FI's tx already moves the user's USDC from their
// wallet to its router contract. We CANNOT directly modify those
// instructions safely (would break the bridge signature/route). Instead
// we send a SEPARATE bundled tx for the fee. Two signatures total on
// Solana side, but both happen in the same flow.
async function buildBridgeTransactions({
  fundingSourcePubkey, evmDestination, totalUsdAtomic,
}) {
  const feeAtomic    = (totalUsdAtomic * BigInt(Math.round(SERVICE_FEE_PCT * 10000))) / 10000n;
  const bridgeAtomic = totalUsdAtomic - feeAtomic;
  if (bridgeAtomic <= 0n || feeAtomic <= 0n) throw new Error('Amount too small after fee');

  // 1) Build the fee-only tx (separate from LI.FI's bridge tx)
  const userAta    = deriveUsdcAta(fundingSourcePubkey);
  const feeOwnerAta = deriveUsdcAta(FEE_RECIPIENT_SOL);
  const feeIxs = [];
  if (!(await ataExists(feeOwnerAta))) {
    feeIxs.push(createAtaIfNeededInstruction(fundingSourcePubkey, feeOwnerAta, FEE_RECIPIENT_SOL, USDC_SOLANA_MINT));
  }
  feeIxs.push(createSplTransferInstruction(userAta, feeOwnerAta, fundingSourcePubkey, feeAtomic));
  const blockhash = await getRecentBlockhash();
  const feeMsg = new TransactionMessage({
    payerKey:        new PublicKey(fundingSourcePubkey),
    recentBlockhash: blockhash,
    instructions:    feeIxs,
  }).compileToV0Message();
  const feeTx = new VersionedTransaction(feeMsg);

  // 2) Get LI.FI bridge tx for the remaining 95%
  const quote = await lifiQuote({
    fromAddress:      fundingSourcePubkey,
    toAddress:        evmDestination,
    fromAmountAtomic: bridgeAtomic,
  });

  // LI.FI's Solana transactions come back as base64-encoded VersionedTransaction.
  const txData = quote?.transactionRequest?.data || quote?.tx?.data || quote?.transactionRequest;
  if (!txData) throw new Error('LI.FI quote missing tx data');
  let bridgeTx;
  try {
    const raw = typeof txData === 'string'
      ? Uint8Array.from(atob(txData), c => c.charCodeAt(0))
      : new Uint8Array(txData);
    bridgeTx = VersionedTransaction.deserialize(raw);
  } catch (e) {
    dbgErr('lifi', 'failed to deserialize bridge tx', e);
    throw new Error('Bridge tx deserialization failed');
  }

  dbg('bridge', 'tx pair built', {
    feeAtomic:    feeAtomic.toString(),
    bridgeAtomic: bridgeAtomic.toString(),
    tool:         quote?.tool || quote?.bridge,
  });

  return { feeTx, bridgeTx, quote, feeAtomic, bridgeAtomic };
}

// Pre-flight tx simulation. Catches obvious failures (insufficient funds,
// missing ATA, bad signer, stale blockhash) BEFORE asking the user to
// sign anything. Returns the simulation result with logs + units consumed.
//
// Throws if the simulation reports an error so callers can abort cleanly.
async function simulateSolanaTx(unsignedOrSignedTx, label = 'tx') {
  const txBytes = unsignedOrSignedTx.serialize
    ? unsignedOrSignedTx.serialize()
    : unsignedOrSignedTx;
  const base64  = btoa(String.fromCharCode(...new Uint8Array(txBytes)));
  const res = await fetchWithTimeout(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
      params: [base64, {
        encoding: 'base64',
        commitment: 'confirmed',
        // sigVerify=false so we can simulate unsigned txs and still get
        // meaningful results. We're not protecting against forged sigs
        // here, just sanity-checking the instructions.
        sigVerify: false,
        replaceRecentBlockhash: true,
      }],
    }),
  }, 12_000);
  const json = await res.json();
  if (json.error) {
    dbgErr('sim', `${label}: RPC error`, new Error(JSON.stringify(json.error)));
    throw new Error('Simulation RPC error: ' + (json.error.message || 'unknown'));
  }
  const value = json?.result?.value;
  if (!value) {
    dbgErr('sim', `${label}: no result.value`, new Error(JSON.stringify(json).slice(0, 200)));
    throw new Error('Simulation returned no result');
  }
  if (value.err) {
    const errStr = typeof value.err === 'string' ? value.err : JSON.stringify(value.err);
    dbg('sim', `${label}: FAILED`, { err: errStr, logs: (value.logs || []).slice(-5) });
    // Try to surface a friendly message from the program logs.
    const lastLog = (value.logs || []).filter(l => /error|fail|insufficient|0x/i.test(l)).slice(-1)[0];
    throw new Error(`Tx would fail: ${lastLog || errStr}`);
  }
  dbg('sim', `${label}: OK`, {
    unitsConsumed: value.unitsConsumed,
    logsLen: (value.logs || []).length,
  });
  return value;
}

async function submitSolanaTx(signedTx) {
  const res = await fetchWithTimeout(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendTransaction',
      params: [btoa(String.fromCharCode(...signedTx.serialize())), {
        encoding: 'base64', skipPreflight: false,
        preflightCommitment: 'confirmed', maxRetries: 5,
      }],
    }),
  }, 20_000);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Solana submit failed');
  return json.result;
}

async function pollLifiUntilDone({ txHash, fromChain, toChain, bridge }, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await lifiStatus({ txHash, fromChain, toChain, bridge });
    if (status) {
      const s = (status.status || '').toUpperCase();
      const sub = (status.substatus || '').toUpperCase();
      dbg('lifi', 'status', { s, sub });
      if (s === 'DONE' || sub === 'COMPLETED')      return { ok: true, status };
      if (s === 'FAILED' || sub === 'REFUNDED')     return { ok: false, status };
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  return { ok: false, reason: 'Bridge timeout' };
}

// ═══════════════════════════════════════════════════════════════════
// POLYMARKET BALANCE / POSITIONS / BIDS
// ═══════════════════════════════════════════════════════════════════

async function fetchPolymarketBalance(safeAddress) {
  try {
    const safe = safeAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0x70a08231' + safe;
    const r = await fetchWithTimeout('https://polygon-rpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: PUSD_ADDRESS, data }, 'latest'],
      }),
    }, 6_000);
    if (!r.ok) return 0n;
    const j = await r.json();
    const hex = j?.result;
    if (!hex || typeof hex !== 'string' || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);
  } catch { return 0n; }
}

async function fetchUsdceBalance(evmAddress) {
  try {
    const addr = evmAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0x70a08231' + addr;
    const r = await fetchWithTimeout('https://polygon-rpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: USDC_E_ADDRESS, data }, 'latest'],
      }),
    }, 6_000);
    if (!r.ok) return 0n;
    const j = await r.json();
    const hex = j?.result;
    if (!hex || typeof hex !== 'string' || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);
  } catch { return 0n; }
}

async function fetchPolymarketPositions(safeAddress, conditionId, clobTokenIds) {
  try {
    const url = `${DATA_API_URL}/positions?user=${safeAddress.toLowerCase()}&market=${conditionId}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 6_000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const yesTokenId = clobTokenIds?.[0];
    const noTokenId  = clobTokenIds?.[1];
    let yesPos = null, noPos = null;
    for (const p of data) {
      const tid = String(p.asset || p.tokenId || p.token_id || '');
      if (yesTokenId && tid === String(yesTokenId)) yesPos = p;
      if (noTokenId  && tid === String(noTokenId))  noPos  = p;
    }
    const parseSize = (p) => p ? Number(p.size || p.shares || p.balance || 0) : 0;
    const parseAvg  = (p) => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;
    return {
      sharesYes:   parseSize(yesPos),
      sharesNo:    parseSize(noPos),
      avgPriceYes: parseAvg(yesPos),
      avgPriceNo:  parseAvg(noPos),
    };
  } catch { return null; }
}

async function fetchClobBestBid(tokenId) {
  try {
    const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/book?token_id=${tokenId}`, {}, 6_000);
    if (!res.ok) return 0;
    const data = await res.json();
    const bids = data?.bids || [];
    if (!bids.length) return 0;
    let best = 0;
    for (const b of bids) {
      const px = Number(b.price || b.p || 0);
      if (px > best) best = px;
    }
    return best;
  } catch { return 0; }
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATED CLOB CLIENT (Privy EVM signer, Safe sig type 2)
// ═══════════════════════════════════════════════════════════════════

async function buildAuthenticatedClobClient(evmAddress, getEvmProvider, safeAddress, creds) {
  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildPrivyViemClient(getEvmProvider);

  // V2 builder code is attached per-order via marketOrder.builderCode,
  // not via a BuilderConfig object. The old signing-SDK BuilderConfig
  // flow is the V1 path and is no longer needed.
  dbg('clob', 'constructing authenticated ClobClient', {
    funder: safeAddress, sigType: 2,
  });
  return new ClobClient({
    host:          POLYMARKET_CLOB_URL,
    chain:         POLYGON_CHAIN_ID,
    signer,
    creds,
    signatureType: 2,
    funderAddress: safeAddress,
  });
}

async function updateClobBalance(evmAddress, getEvmProvider, safeAddress, creds) {
  try {
    const client = await buildAuthenticatedClobClient(evmAddress, getEvmProvider, safeAddress, creds);
    if (typeof client.updateBalanceAllowance === 'function') {
      await client.updateBalanceAllowance({ asset_type: 'COLLATERAL', signature_type: 2 });
      dbg('clob', 'updateBalanceAllowance OK');
    }
  } catch (e) { dbgErr('clob', 'updateBalanceAllowance failed (continuing)', e); }
}

// ═══════════════════════════════════════════════════════════════════
// ORDER PLACEMENT
// ═══════════════════════════════════════════════════════════════════

async function getBuilderCode() {
  try {
    const r = await fetchWithTimeout(polyProxyUrl('/builder-code'), {}, 4_000);
    if (!r.ok) return null;
    const { builderCode } = await r.json();
    return builderCode || null;
  } catch (e) { dbgErr('builder-code', 'fetch failed', e); return null; }
}

async function postMarketOrder({
  evmAddress, getEvmProvider, safeAddress, creds, market, side, amount, isBuy,
}) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');
  const { clob } = await loadSdks();
  const Side      = clob.Side      || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FAK: 'FAK', FOK: 'FOK', GTC: 'GTC' };
  const builderCode = await getBuilderCode();
  const client = await buildAuthenticatedClobClient(evmAddress, getEvmProvider, safeAddress, creds);

  const marketOrder = {
    tokenID: String(tokenId),
    amount:  Number(amount),
    side:    isBuy ? Side.BUY : Side.SELL,
    ...(builderCode ? { builderCode } : {}),
  };
  const opts = {
    tickSize: market.tickSize || '0.01',
    negRisk:  !!market.negRisk,
  };

  if (typeof client.createAndPostMarketOrder !== 'function') {
    throw new Error('clob-client-v2 missing createAndPostMarketOrder — upgrade SDK');
  }
  dbg('order', 'posting market order', { side, amount, isBuy, builderCode: !!builderCode });
  const resp = await client.createAndPostMarketOrder(marketOrder, opts, OrderType.FAK);
  dbg('order', 'response', resp);
  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false)        throw new Error(resp?.errorMsg || 'Order rejected');
  return resp;
}

// ═══════════════════════════════════════════════════════════════════
// MARKETS — Gamma feeds with hard filters
// ═══════════════════════════════════════════════════════════════════

async function fetchMarketsByTagSlug(slug) {
  const url = `${GAMMA_URL}/events?tag_slug=${encodeURIComponent(slug)}&closed=false&order=volume24hr&ascending=false&limit=60`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  return await res.json();
}

async function fetchMarketsByTagId(tagId) {
  const url = `${GAMMA_URL}/events?tag_id=${tagId}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=80`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  return await res.json();
}

function normalizeEvent(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (markets.length === 0) return null;
  const market = markets[0];
  let outcomePrices = [];
  try {
    outcomePrices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : (market.outcomePrices || []);
  } catch {}
  let clobTokenIds = [];
  try {
    clobTokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
  } catch {}
  const yesPrice = Number(outcomePrices[0] || market.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  const parentTitle   = ev.title || market.question || 'Untitled';
  const childQuestion = markets.length > 1 ? (market.question || market.groupItemTitle || null) : null;
  return {
    id: ev.id, slug: ev.slug, title: parentTitle, childQuestion,
    image:        ev.image || ev.icon || market.image || null,
    volume24h:    Number(ev.volume24hr || market.volume24hr || 0),
    volumeTotal:  Number(ev.volume      || market.volume     || 0),
    liquidity:    Number(ev.liquidity   || market.liquidity  || 0),
    endDate:      ev.endDate || market.endDate || null,
    yesPrice, noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct:  Math.round(noPrice  * 100),
    marketCount: markets.length,
    conditionId: market.conditionId,
    clobTokenIds,
    negRisk:  !!(market.negRisk || ev.negRisk),
    tickSize: String(market.orderPriceMinTickSize || market.minimum_tick_size || market.tickSize || '0.01'),
  };
}

// Hard filters: drop garbage markets BEFORE they hit the user's eyes.
function isTradableMarket(m, horizon) {
  if (!m) return false;
  if (!m.clobTokenIds || m.clobTokenIds.length < 2) return false;
  if (!m.conditionId) return false;

  // Prices: drop if effectively resolved (>97% one way) or zero.
  const y = Number(m.yesPrice) || 0;
  if (y <= 0.02 || y >= 0.98) return false;

  // End date: must exist and be in the future.
  if (!m.endDate) return false;
  const msLeft = new Date(m.endDate).getTime() - Date.now();
  if (!Number.isFinite(msLeft) || msLeft <= 0) return false;

  // Horizon: cap by max duration (if this tab has a cap)
  if (horizon && Number.isFinite(horizon.maxMs) && msLeft > horizon.maxMs) return false;

  // Volume: require minimum to ensure liquidity exists.
  const vol = Number(m.volume24h) || 0;
  if (vol < 500) return false;

  // Liquidity floor: at least some bid/ask presence on either side.
  const liq = Number(m.liquidity) || 0;
  if (liq < 100) return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// END-TO-END FLOWS
// ═══════════════════════════════════════════════════════════════════

// Trading flow — assumes Safe is funded. ZERO signatures expected.
async function executeBuy({
  evmAddress, getEvmProvider, safeAddress, creds, market, side, usdcSpend, onStatus,
}) {
  dbg('trade', 'executeBuy start', { side, usdcSpend, marketId: market?.id });
  if (usdcSpend < MIN_TRADE_USD) throw new Error(`Minimum trade is $${MIN_TRADE_USD}`);
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');
  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  if (!(price > 0 && price < 1)) throw new Error('Invalid price');
  onStatus?.('Placing order…');
  const result = await postMarketOrder({
    evmAddress, getEvmProvider, safeAddress, creds,
    market, side, amount: Number(usdcSpend), isBuy: true,
  });
  return { ok: true, result };
}

async function executeSell({
  evmAddress, getEvmProvider, safeAddress, creds, market, side, shares, onStatus,
}) {
  if (!(shares > 0)) throw new Error('No shares to sell');
  onStatus?.('Placing sell…');
  const result = await postMarketOrder({
    evmAddress, getEvmProvider, safeAddress, creds,
    market, side, amount: Number(shares), isBuy: false,
  });
  return { ok: true, result };
}

// Funding flow — explicit user action. Bridges from Solana to Polymarket
// Safe via LI.FI, taking 5% on the way.
//
// signFn: async (VersionedTransaction) => VersionedTransaction
//   pass Phantom's signTransaction OR Privy embedded Sol wallet's signer.
async function executeFunding({
  fundingSourcePubkey, evmAddress, safeAddress, totalUsdAtomic, signFn, onStatus,
}) {
  dbg('fund', 'executeFunding start', {
    fundingSourcePubkey, evmAddress, safeAddress,
    totalUsdAtomic: totalUsdAtomic.toString(),
  });

  onStatus?.('Getting bridge route…');
  const { feeTx, bridgeTx, quote, feeAtomic, bridgeAtomic } = await buildBridgeTransactions({
    fundingSourcePubkey,
    evmDestination: safeAddress,
    totalUsdAtomic,
  });

  // PRE-FLIGHT SIM — validate BOTH txs before asking the user to sign.
  // Catches insufficient funds, missing ATAs, stale routes, etc. without
  // wasting a wallet popup on a tx that would fail.
  onStatus?.('Validating transactions…');
  try {
    dbg('fund', 'simulating bridge tx');
    await simulateSolanaTx(bridgeTx, 'bridge');
    dbg('fund', 'simulating fee tx');
    await simulateSolanaTx(feeTx, 'fee');
  } catch (e) {
    dbgErr('fund', 'pre-flight sim failed — aborting before signature', e);
    throw new Error('Pre-flight check failed: ' + (e?.message || 'unknown'));
  }

  // Sign both txs. Some signers can batch, some can't — sign sequentially.
  onStatus?.('Confirm in your wallet…');
  dbg('fund', 'requesting signature on bridge tx (1/2)');
  const signedBridge = await signFn(bridgeTx);
  dbg('fund', 'requesting signature on fee tx (2/2)');
  const signedFee    = await signFn(feeTx);

  onStatus?.('Submitting on Solana…');
  const bridgeSig = await submitSolanaTx(signedBridge);
  dbg('fund', 'bridge submitted', { sig: bridgeSig });
  // Fee tx can fail without blocking the bridge — we still want funds to land.
  try {
    const feeSig = await submitSolanaTx(signedFee);
    dbg('fund', 'fee submitted', { sig: feeSig });
  } catch (e) {
    dbgErr('fund', 'fee tx submit failed (continuing — bridge already submitted)', e);
  }

  onStatus?.('Bridging to Polymarket (~30s)…');
  const landed = await pollLifiUntilDone({
    txHash:    bridgeSig,
    fromChain: LIFI_SOLANA_CHAIN,
    toChain:   LIFI_POLYGON_CHAIN,
    bridge:    quote?.tool || quote?.bridge,
  });

  if (!landed.ok) {
    dbg('fund', 'bridge poll did not confirm', { reason: landed.reason });
    return { bridging: true, bridgeSig };
  }
  dbg('fund', 'bridge confirmed');
  return { ok: true, bridgeSig, feeAtomic, bridgeAtomic };
}

// Withdrawal — bridges pUSD on Polygon back to Solana USDC at the user's
// Privy Solana address.
async function executeWithdraw({
  evmAddress, getEvmProvider, safeAddress, recipientSol, onStatus,
}) {
  onStatus?.('Preparing withdrawal…');
  // First ensure setup is good (creds, approvals) for the CLOB to be reachable.
  await ensurePolymarketSetup(evmAddress, getEvmProvider, onStatus);

  onStatus?.('Requesting withdrawal…');
  const url = polyProxyUrl('/withdraw');
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:        safeAddress.toLowerCase(),
      toChainId:      '1151111081099710',
      toTokenAddress: USDC_SOLANA_MINT,
      recipientAddr:  recipientSol,
    }),
  }, 15_000);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    dbgErr('withdraw', `withdraw ${r.status}`, new Error(t.slice(0, 200)));
    throw new Error(`Withdraw ${r.status}: ${t.slice(0, 160)}`);
  }
  const data = await r.json();
  dbg('withdraw', 'OK', data);
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// UI — Reusable presentational components
// ═══════════════════════════════════════════════════════════════════

function RegionBlock() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '36px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict isn't available here</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Prediction markets are restricted in your region.
        </div>
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Coming soon. Trade crypto prediction markets from your Solana wallet.
        </div>
      </div>
    </div>
  );
}

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
  const { title, childQuestion, image, yesPct, volume24h, endDate, marketCount } = market;
  const yesPrice = Number(market.yesPrice) || 0;
  const noPrice  = Number(market.noPrice)  || 0;
  const upsideFor = (px) => (px < 0.02 || px > 0.98) ? 0 : Math.min(9999, Math.round((1 / px - 1) * 100));
  const yesUpside = upsideFor(yesPrice);
  const noUpside  = upsideFor(noPrice);

  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        {image && (
          <img src={image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: childQuestion ? 4 : 6, ...T.body }}>{title}</div>
          {childQuestion && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.hl, lineHeight: 1.35, marginBottom: 6, ...T.body }}>
              {childQuestion}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && (<><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>)}
            {marketCount > 1 && (<><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '10px', borderRadius: 11, background: C.yesDim, border: `1px solid rgba(0,212,163,.30)`, color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Yes · ${yesPrice.toFixed(2)}</span>
          {yesUpside > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{yesUpside}% upside</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '10px', borderRadius: 11, background: C.noDim, border: `1px solid rgba(255,95,122,.30)`, color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>No · ${noPrice.toFixed(2)}</span>
          {noUpside > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{noUpside}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function DebugPanel({ open, onToggle }) {
  const log = useDbgLog();
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [log.length, open]);

  const copyAll = () => {
    try {
      const text = log.map(e => {
        const t = new Date(e.ts).toISOString().slice(11, 23);
        const d = e.data ? ' ' + JSON.stringify(e.data) : '';
        return `${t} [${e.scope}] ${e.msg}${d}`;
      }).join('\n');
      navigator.clipboard?.writeText(text);
    } catch {}
  };

  return (
    <div style={{ marginBottom: 12, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 800, letterSpacing: 1.2, ...T.mono }}>
          DEBUG · {log.length} {open ? '▾' : '▸'}
        </span>
        {open && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); copyAll(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, cursor: 'pointer', fontWeight: 700, ...T.mono }}>COPY</button>
            <button onClick={(e) => { e.stopPropagation(); dbgClear(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, cursor: 'pointer', fontWeight: 700, ...T.mono }}>CLEAR</button>
          </div>
        )}
      </div>
      {open && (
        <div ref={scrollRef} style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 12px', background: 'rgba(0,0,0,.25)', borderTop: `1px solid ${C.border}`, ...T.mono, fontSize: 10, lineHeight: 1.5 }}>
          {log.length === 0 ? (
            <div style={{ color: C.muted2, fontStyle: 'italic' }}>No log entries yet.</div>
          ) : log.map((e, i) => {
            const time = new Date(e.ts).toISOString().slice(11, 23);
            const isErr = String(e.msg).startsWith('ERROR');
            return (
              <div key={i} style={{ color: isErr ? C.no : C.ink, opacity: isErr ? 1 : .88, marginBottom: 2, wordBreak: 'break-word' }}>
                <span style={{ color: C.muted2 }}>{time}</span>{' '}
                <span style={{ color: C.hl, fontWeight: 700 }}>[{e.scope}]</span>{' '}
                {e.msg}
                {e.data !== undefined && (
                  <span style={{ color: C.muted, fontSize: 9 }}> {JSON.stringify(e.data).slice(0, 200)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FUNDING SHEET — bridge from Solana, send USDC.e direct, MoonPay, withdraw
// ═══════════════════════════════════════════════════════════════════

function FundingSheet({
  open, onClose,
  evmAddress, safeAddress, polyBalance,
  fundingPubkey, solUsdcBalance, fundingSourceLabel,
  signSolanaTx,
  onFunded, onWithdrawn,
  refreshAll,
  onLoginPrivy,
}) {
  const [amount, setAmount]       = useState('25');
  const [status, setStatus]       = useState('idle');     // idle | bridging | done | error
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');
  const [copied, setCopied]       = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const [wdBusy, setWdBusy]       = useState(false);
  const [wdMsg, setWdMsg]         = useState('');
  const [wdError, setWdError]     = useState('');
  const [wdDone, setWdDone]       = useState(false);

  // SIM state — live LI.FI quote so the user sees real route + receive
  // amount before signing. Re-runs (debounced) whenever `amount` changes.
  const [sim, setSim] = useState({
    state: 'idle',                  // idle | loading | ok | error
    receiveUsd: null,                // estimated USDC.e arriving on Polygon
    bridgeName: null,                // e.g. "Allbridge"
    durationSec: null,               // estimated execution time
    error: null,
    forAmount: null,                 // sanity check vs current amount
    forAddresses: null,              // sanity check vs current addrs
  });

  useBodyLock(open);
  useEffect(() => { if (!open) { setStatus('idle'); setStatusMsg(''); setError(''); setWdBusy(false); setWdMsg(''); setWdError(''); setWdDone(false); setSim({ state: 'idle', receiveUsd: null, bridgeName: null, durationSec: null, error: null, forAmount: null, forAddresses: null }); } }, [open]);

  if (!open) return null;

  const solUsd       = Number(solUsdcBalance) / 1e6;
  const polyUsd      = Number(polyBalance) / 1e6;
  const usd          = Number(amount) || 0;
  const feeUsd       = usd * SERVICE_FEE_PCT;
  const netUsd       = usd - feeUsd;

  // Quote SIM — debounced LI.FI quote whenever amount/addresses change. We
  // only quote the post-fee amount because that's what actually crosses the
  // bridge. Sim result feeds the button label + gates `canBridge`.
  /* eslint-disable react-hooks/rules-of-hooks */
  useEffect(() => {
    if (!open) return;
    if (!fundingPubkey || !safeAddress) return;
    if (usd < MIN_DEPOSIT_USD || usd > solUsd) {
      setSim(s => ({ ...s, state: 'idle', error: null }));
      return;
    }
    let alive = true;
    setSim(s => ({ ...s, state: 'loading', error: null }));
    const handle = setTimeout(async () => {
      try {
        const feeAtomic    = BigInt(Math.floor(usd * 1e6 * SERVICE_FEE_PCT));
        const bridgeAtomic = BigInt(Math.floor(usd * 1e6)) - feeAtomic;
        const quote = await lifiQuote({
          fromAddress:      fundingPubkey,
          toAddress:        safeAddress,
          fromAmountAtomic: bridgeAtomic,
        });
        if (!alive) return;
        const receiveAtomic = Number(quote?.estimate?.toAmount || 0);
        const receiveUsd    = receiveAtomic > 0 ? receiveAtomic / 1e6 : null;
        setSim({
          state:        'ok',
          receiveUsd,
          bridgeName:   quote?.tool || quote?.bridge || 'bridge',
          durationSec:  Number(quote?.estimate?.executionDuration) || null,
          error:        null,
          forAmount:    usd,
          forAddresses: fundingPubkey + ':' + safeAddress,
        });
      } catch (e) {
        if (!alive) return;
        setSim({
          state:        'error',
          receiveUsd:   null,
          bridgeName:   null,
          durationSec:  null,
          error:        e?.message || 'No bridge route available',
          forAmount:    usd,
          forAddresses: fundingPubkey + ':' + safeAddress,
        });
      }
    }, 400);
    return () => { alive = false; clearTimeout(handle); };
  }, [open, usd, solUsd, fundingPubkey, safeAddress]);
  /* eslint-enable react-hooks/rules-of-hooks */

  const simReady    = sim.state === 'ok' && sim.forAmount === usd;
  const canBridge   = !!fundingPubkey && !!evmAddress && usd >= MIN_DEPOSIT_USD && usd <= solUsd && status !== 'bridging' && simReady;
  const canWithdraw  = polyUsd >= 1 && !!fundingPubkey && !wdBusy;

  const handleBridge = async () => {
    if (!canBridge) { setError(`Minimum $${MIN_DEPOSIT_USD} · Max ${fmtUsd(solUsd, 2)}`); return; }
    setStatus('bridging'); setError(''); setStatusMsg('');
    try {
      const totalAtomic = BigInt(Math.floor(usd * 1e6));
      const res = await executeFunding({
        fundingSourcePubkey: fundingPubkey,
        evmAddress,
        safeAddress,
        totalUsdAtomic: totalAtomic,
        signFn: signSolanaTx,
        onStatus: setStatusMsg,
      });
      if (res?.bridging) {
        setStatusMsg('Bridge still pending — funds will land shortly.');
      }
      setStatus('done');
      onFunded?.();
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 5000);
    } catch (e) {
      console.error('[fund]', e);
      const msg = e?.message || 'Funding failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStatusMsg('');
      setDebugOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleWithdraw = async () => {
    if (!canWithdraw) return;
    setWdBusy(true); setWdError(''); setWdMsg('Requesting withdrawal…');
    try {
      // Always send back to the Privy Solana wallet (per design decision).
      await executeWithdraw({
        evmAddress,
        getEvmProvider: undefined, // not needed for withdraw endpoint; ensurePolymarketSetup uses cached
        safeAddress,
        recipientSol: fundingPubkey,
        onStatus: setWdMsg,
      });
      setWdMsg(''); setWdDone(true);
      onWithdrawn?.();
      setTimeout(() => { setWdDone(false); refreshAll?.(); }, 8000);
    } catch (e) {
      console.error('[withdraw]', e);
      setWdError(e?.message || 'Withdraw failed');
    } finally { setWdBusy(false); }
  };

  const handleCopyEvm = async () => {
    if (!evmAddress) return;
    const ok = await copyToClipboard(evmAddress);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  const moonpayUrl = buildMoonpayUrl(evmAddress);

  return (
    <div onClick={status === 'bridging' || wdBusy ? undefined : onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)',
      backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center', cursor: (status === 'bridging' || wdBusy) ? 'wait' : 'pointer',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`,
        borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)',
        boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />

        <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 4, ...T.display }}>Fund your account</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, ...T.body }}>
          Polymarket balance: <span style={{ color: C.hl, fontWeight: 700 }}>{fmtUsd(polyUsd, 2)}</span>
        </div>

        <DebugPanel open={debugOpen} onToggle={() => setDebugOpen(o => !o)} />

        {/* Not-ready states — surface the actual reason so the user isn't staring at a broken UI */}
        {!evmAddress && (
          <div style={{ padding: 16, borderRadius: 14, background: 'linear-gradient(135deg, rgba(168,127,255,.10), rgba(151,252,228,.06))', border: `1px solid ${C.borderHi}`, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.violet, marginBottom: 4, ...T.display }}>Sign in to fund</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5, ...T.body }}>
              We'll create a Solana + Polygon wallet for you automatically. No seed phrase, no extension.
            </div>
            <button onClick={onLoginPrivy} style={{
              width: '100%', padding: '11px', borderRadius: 10,
              background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`,
              color: C.bg, fontWeight: 800, fontSize: 13, border: 'none',
              cursor: 'pointer', ...T.body,
            }}>Sign in with email / Google</button>
          </div>
        )}
        {evmAddress && !safeAddress && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245,181,61,.06)', border: `1px solid ${C.amber}44`, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.amber}33`, borderTopColor: C.amber, animation: 'nexus-spin .8s linear infinite' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, ...T.body }}>Preparing your trading account…</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Deriving Polymarket Safe — a few seconds</div>
            </div>
          </div>
        )}

        {/* Bridge from Solana */}
        <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: .8, ...T.display }}>BRIDGE FROM SOLANA</div>
            <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>
              {fundingSourceLabel} · {fmtUsd(solUsd, 2)} available
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
            <span style={{ fontSize: 18, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={status === 'bridging'} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {['10', '25', '100', '250'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={status === 'bridging'} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
            <button onClick={() => setAmount(String(Math.floor(solUsd * 100) / 100))} disabled={status === 'bridging' || solUsd <= 0} style={{ flex: 1, padding: '7px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
          </div>

          <div style={{ ...T.mono, fontSize: 11, color: C.muted, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Service fee (5%)</span><span style={{ color: C.ink }}>-{fmtUsd(feeUsd, 2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Into Polymarket</span>
              <span style={{ color: C.hl, fontWeight: 700 }}>
                {simReady && sim.receiveUsd != null ? `≈ ${fmtUsd(sim.receiveUsd, 2)}` : fmtUsd(netUsd, 2)}
              </span>
            </div>
            {simReady && (sim.bridgeName || sim.durationSec) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>Route</span>
                <span style={{ color: C.muted2 }}>
                  {sim.bridgeName || 'bridge'}
                  {sim.durationSec ? ` · ~${Math.max(15, Math.round(sim.durationSec))}s` : ''}
                </span>
              </div>
            )}
          </div>

          {/* SIM status indicator — between fee math and submit button */}
          {usd >= MIN_DEPOSIT_USD && usd <= solUsd && sim.state === 'loading' && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>Checking route…</span>
            </div>
          )}
          {usd >= MIN_DEPOSIT_USD && usd <= solUsd && sim.state === 'error' && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(245,181,61,.06)', border: `1px solid ${C.amber}44`, borderRadius: 10, fontSize: 11, color: C.amber, ...T.body }}>
              {sim.error || 'No bridge route for this amount'}
              <div style={{ marginTop: 3, fontSize: 9, color: C.muted, ...T.mono }}>Try a larger amount.</div>
            </div>
          )}

          {statusMsg && status === 'bridging' && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
              <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{statusMsg}</span>
            </div>
          )}
          {status === 'done' && !error && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>
              ✓ Funds bridging — balance updates in ~30s
            </div>
          )}
          {error && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>
              {error}
            </div>
          )}

          <button onClick={canBridge ? handleBridge : undefined} disabled={!canBridge} style={{
            width: '100%', padding: '12px', borderRadius: 11,
            background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`,
            color: C.bg, fontWeight: 800, fontSize: 14, border: 'none',
            cursor: canBridge ? 'pointer' : 'not-allowed', opacity: canBridge ? 1 : .55, ...T.body,
          }}>
            {status === 'bridging' ? 'Bridging…' : `Move ${fmtUsd(usd, 2)} to trading`}
          </button>
        </div>

        {/* Send USDC.e direct */}
        {evmAddress && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(168,127,255,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.violet, fontWeight: 800, letterSpacing: .8, marginBottom: 6, ...T.display }}>SEND USDC.e DIRECTLY</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, ...T.body }}>
              From an exchange or another wallet — Polygon network.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
              <div style={{ flex: 1, minWidth: 0, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', lineHeight: 1.3 }}>
                {evmAddress}
              </div>
              <button onClick={handleCopyEvm} style={{ padding: '6px 10px', borderRadius: 8, background: copied ? C.yesDim : 'rgba(255,255,255,.04)', border: `1px solid ${copied ? C.yes + '55' : C.border}`, color: copied ? C.yes : C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono, whiteSpace: 'nowrap' }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, marginTop: 8, ...T.mono }}>
              ⚠ Polygon (POS) · USDC.e only · no fee
            </div>
          </div>
        )}

        {/* MoonPay link */}
        <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, ...T.body }}>Need to buy crypto?</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.body }}>Buy USDC with card via MoonPay</div>
            </div>
            <a href={moonpayUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 12px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', ...T.mono }}>
              Open →
            </a>
          </div>
        </div>

        {/* Withdraw */}
        <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, ...T.body }}>Withdraw to Solana</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.body }}>
                {fmtUsd(polyUsd, 2)} available · Free · ~30s
              </div>
            </div>
          </div>
          {wdMsg && wdBusy && (
            <div style={{ marginBottom: 8, padding: 6, fontSize: 10, color: C.muted, background: 'rgba(151,252,228,.05)', borderRadius: 8 }}>{wdMsg}</div>
          )}
          {wdError && (
            <div style={{ marginBottom: 8, padding: 6, fontSize: 10, color: C.no, background: 'rgba(255,95,122,.06)', borderRadius: 8 }}>{wdError}</div>
          )}
          {wdDone && (
            <div style={{ marginBottom: 8, padding: 6, fontSize: 10, color: C.yes, background: 'rgba(0,212,163,.08)', borderRadius: 8, fontWeight: 700 }}>
              ✓ Withdrawal initiated — USDC lands in your Solana wallet
            </div>
          )}
          <button onClick={canWithdraw ? handleWithdraw : undefined} disabled={!canWithdraw} style={{
            width: '100%', padding: '10px', borderRadius: 10,
            background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
            color: canWithdraw ? C.ink : C.muted2, fontWeight: 700, fontSize: 12,
            cursor: canWithdraw ? 'pointer' : 'not-allowed', opacity: canWithdraw ? 1 : .55, ...T.body,
          }}>
            {wdBusy ? 'Processing…' : polyUsd < 1 ? 'No balance to withdraw' : `Withdraw ${fmtUsd(polyUsd, 2)} → Solana`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDER DRAWER — single market trade UI (silent via Privy EVM)
// ═══════════════════════════════════════════════════════════════════

function OrderDrawer({
  market, side, onClose,
  evmAddress, getEvmProvider, safeAddress,
  polyBalance, onNeedFunds, refreshAll,
}) {
  const [amount, setAmount]         = useState('10');
  const [status, setStatus]         = useState('idle');
  const [statusMsg, setStatusMsg]   = useState('');
  const [error, setError]           = useState('');
  const [position, setPosition]     = useState(null);
  const [currentBids, setCurrentBids] = useState({ yes: 0, no: 0 });
  const [sellStatus, setSellStatus] = useState('idle');
  const [debugOpen, setDebugOpen]   = useState(false);

  useBodyLock(!!market);

  useEffect(() => {
    if (!market || !safeAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const [pos, yesBid, noBid] = await Promise.all([
          fetchPolymarketPositions(safeAddress, market.conditionId, market.clobTokenIds),
          fetchClobBestBid(market.clobTokenIds[0]),
          fetchClobBestBid(market.clobTokenIds[1]),
        ]);
        if (!alive) return;
        if (pos) setPosition(pos);
        setCurrentBids({ yes: yesBid, no: noBid });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, [market, safeAddress]);

  if (!market) return null;

  const price       = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd         = Number(amount) || 0;
  const shares      = price > 0 ? usd / price : 0;
  const upside      = usd > 0 ? ((shares - usd) / usd) * 100 : 0;
  const sideColor   = side === 'yes' ? C.yes : C.no;
  const sideDim     = side === 'yes' ? C.yesDim : C.noDim;
  const isBusy      = status === 'working' || sellStatus === 'selling';
  const polyUsd     = Number(polyBalance) / 1e6;
  const needsFunds  = usd > polyUsd;
  const canBuy      = !isBusy && usd >= MIN_TRADE_USD && evmAddress && safeAddress && market.clobTokenIds?.length >= 2 && !needsFunds;

  const heldShares    = side === 'yes' ? Number(position?.sharesYes || 0) : Number(position?.sharesNo || 0);
  const avgBought     = side === 'yes' ? Number(position?.avgPriceYes || 0) : Number(position?.avgPriceNo || 0);
  const currentBid    = side === 'yes' ? currentBids.yes : currentBids.no;
  const positionValue = heldShares * currentBid;
  const positionCost  = heldShares * avgBought;
  const positionPnl   = positionValue - positionCost;
  const positionPnlPct= positionCost > 0 ? (positionPnl / positionCost) * 100 : 0;
  const hasPosition   = heldShares > 0.01;

  const handleBuy = async () => {
    if (needsFunds) { onNeedFunds?.(); return; }
    if (usd < MIN_TRADE_USD) { setError(`Minimum trade is $${MIN_TRADE_USD}`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      // Ensure setup first (idempotent, fast if cached).
      const setup = await ensurePolymarketSetup(evmAddress, getEvmProvider, setStatusMsg);
      await executeBuy({
        evmAddress, getEvmProvider,
        safeAddress: setup.safeAddress,
        creds: setup.creds,
        market, side, usdcSpend: usd,
        onStatus: setStatusMsg,
      });
      setStatus('success'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      console.error('[buy]', e);
      const msg = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStatusMsg('');
      setDebugOpen(true);
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  const handleSell = async () => {
    if (!hasPosition) return;
    setSellStatus('selling'); setError(''); setStatusMsg('');
    try {
      const setup = await ensurePolymarketSetup(evmAddress, getEvmProvider, setStatusMsg);
      await executeSell({
        evmAddress, getEvmProvider,
        safeAddress: setup.safeAddress,
        creds: setup.creds,
        market, side, shares: heldShares,
        onStatus: setStatusMsg,
      });
      setSellStatus('sold'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      console.error('[sell]', e);
      const msg = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setSellStatus('error'); setStatusMsg('');
      setDebugOpen(true);
      setTimeout(() => setSellStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: isBusy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>
            Bal {fmtUsd(polyUsd, 2)}
          </div>
        </div>

        <DebugPanel open={debugOpen} onToggle={() => setDebugOpen(o => !o)} />

        {hasPosition && sellStatus !== 'sold' && (
          <div style={{ marginBottom: 14, padding: '14px', borderRadius: 12, background: positionPnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${positionPnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
            <div style={{ fontSize: 10, color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800, letterSpacing: .8, marginBottom: 10, ...T.mono }}>
              YOUR POSITION · {side.toUpperCase()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Shares</span>
              <span style={{ color: C.ink, fontWeight: 700 }}>{heldShares.toFixed(2)} @ ${avgBought.toFixed(3)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Value · P&amp;L</span>
              <span style={{ color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>
                {fmtUsd(positionValue, 2)} · {positionPnl >= 0 ? '+' : ''}{positionPnl.toFixed(2)} ({positionPnl >= 0 ? '+' : ''}{positionPnlPct.toFixed(1)}%)
              </span>
            </div>
            <button onClick={sellStatus === 'selling' ? undefined : handleSell} disabled={sellStatus === 'selling' || currentBid <= 0}
              style={{
                width: '100%', padding: '11px', borderRadius: 10,
                background: positionPnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`,
                border: `1px solid ${positionPnl >= 0 ? C.yes : C.no}66`,
                color: positionPnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 13,
                cursor: (sellStatus === 'selling' || currentBid <= 0) ? 'not-allowed' : 'pointer',
                opacity: (sellStatus === 'selling' || currentBid <= 0) ? .55 : 1, ...T.body,
              }}>
              {sellStatus === 'selling' ? 'Selling…' : currentBid <= 0 ? 'No bids' : `Sell all · ${fmtUsd(positionValue, 2)}`}
            </button>
          </div>
        )}

        {sellStatus === 'sold' && (
          <div style={{ marginBottom: 14, padding: '14px', borderRadius: 12, background: 'rgba(0,212,163,.18)', border: `1px solid ${C.yes}` }}>
            <div style={{ fontSize: 12, color: C.ink, ...T.body }}>✓ Sold. Proceeds in your Polymarket account.</div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={isBusy} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['5', '10', '25', '100'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={isBusy} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
            <button onClick={() => setAmount(String(Math.floor(polyUsd * 100) / 100))} disabled={isBusy || polyUsd <= 0} style={{ flex: 1, padding: '7px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
          </div>
        </div>

        <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Shares</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>{fmtUsd(shares, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Upside</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span>
          </div>
        </div>

        {statusMsg && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
            <span style={{ fontSize: 12, color: C.ink, fontWeight: 600 }}>{statusMsg}</span>
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no }}>
            {error}
            <div style={{ marginTop: 6, fontSize: 10, color: C.muted, ...T.mono }}>See Debug panel above for details.</div>
          </div>
        )}

        <button onClick={canBuy ? handleBuy : needsFunds ? onNeedFunds : undefined} disabled={isBusy || (!canBuy && !needsFunds)} style={{
          width: '100%', padding: '14px', borderRadius: 13,
          background: status === 'success' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` :
                       needsFunds          ? `linear-gradient(135deg, ${C.amber}33, ${C.amber}22)` :
                                             `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`,
          border: `1px solid ${needsFunds ? C.amber : sideColor}66`,
          color: needsFunds ? C.amber : sideColor,
          fontWeight: 800, fontSize: 14,
          cursor: (canBuy || needsFunds) ? 'pointer' : 'not-allowed',
          opacity: (canBuy || needsFunds) ? 1 : .55, ...T.body, letterSpacing: .5,
        }}>
          {isBusy ? 'Placing order…' :
           status === 'success' ? '✓ Order placed' :
           needsFunds ? `Fund account · need ${fmtUsd(usd - polyUsd, 2)} more` :
           `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
        </button>
        <div style={{ fontSize: 10, color: C.muted2, marginTop: 10, textAlign: 'center', ...T.mono }}>
          One tap · Silent signing · Non-custodial
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HEADER — title + balance + fund button
// ═══════════════════════════════════════════════════════════════════

function Header({ polyBalance, onOpenFund, canFund }) {
  const usd = Number(polyBalance) / 1e6;
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Crypto prediction markets · Silent trades</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 14, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>{fmtUsd(usd, 2)}</div>
          </div>
          <button onClick={canFund ? onOpenFund : undefined} disabled={!canFund} style={{
            padding: '10px 18px', borderRadius: 11,
            background: canFund ? `linear-gradient(135deg, ${C.hl}, ${C.hl2})` : 'rgba(255,255,255,.04)',
            color: canFund ? C.bg : C.muted2,
            fontWeight: 800, fontSize: 13, border: 'none',
            cursor: canFund ? 'pointer' : 'not-allowed', opacity: canFund ? 1 : .55,
            ...T.body, whiteSpace: 'nowrap',
          }}>
            {usd > 0 ? 'Fund / Withdraw' : 'Fund'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN — PredictInner (the single page)
// ═══════════════════════════════════════════════════════════════════

function PredictInner({ bypassGeo = false }) {
  const [country, setCountry]     = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);
  const [markets, setMarkets]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const [search, setSearch]       = useState('');
  const [horizonId, setHorizonId] = useState('daily');
  const [sortBy, setSortBy]       = useState('volume');

  const [orderMarket, setOrderMarket] = useState(null);
  const [orderSide, setOrderSide]     = useState('yes');

  const [fundOpen, setFundOpen]   = useState(false);

  const [safeAddress, setSafeAddress] = useState(null);
  const [polyBalance, setPolyBalance] = useState(0n);
  const [solUsdcBalance, setSolUsdcBalance] = useState(0n);

  // External Solana wallet (Phantom etc.) — preferred signer if connected.
  const { publicKey: extSolPk, signTransaction: extSolSignTx } = useWallet();

  // Privy state
  const {
    privyAuthenticated, privyEmbeddedSol, privyEmbeddedEvm,
    getEvmAddress, getEvmProvider,
    loginPrivy, privyReady,
  } = useNexusWallet();

  // The EVM address Polymarket cares about — comes from Privy embedded wallet.
  const evmAddress = useMemo(() => {
    if (!privyAuthenticated) return null;
    return getEvmAddress?.() || privyEmbeddedEvm?.address || null;
  }, [privyAuthenticated, getEvmAddress, privyEmbeddedEvm]);

  // Solana funding source: Phantom if connected, else Privy embedded Solana.
  const fundingPubkey = useMemo(() => {
    if (extSolPk) return extSolPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [extSolPk, privyEmbeddedSol]);

  const fundingSourceLabel = useMemo(() => {
    if (extSolPk) return 'Phantom';
    if (privyEmbeddedSol) return 'Privy Solana';
    return 'No wallet';
  }, [extSolPk, privyEmbeddedSol]);

  // Solana signer — wraps Phantom's signTransaction OR Privy embedded Solana.
  const signSolanaTx = useCallback(async (tx) => {
    if (extSolPk && extSolSignTx) {
      dbg('sign', 'using Phantom signer');
      return await extSolSignTx(tx);
    }
    if (privyEmbeddedSol?.signTransaction) {
      dbg('sign', 'using Privy embedded Sol signer');
      return await privyEmbeddedSol.signTransaction(tx);
    }
    throw new Error('No Solana signer available');
  }, [extSolPk, extSolSignTx, privyEmbeddedSol]);

  // Derive safe address once we know the EVM
  useEffect(() => {
    if (!evmAddress) { setSafeAddress(null); return; }
    let alive = true;
    const cached = lsGet(KEYS.safeAddr(evmAddress));
    if (cached) { setSafeAddress(cached); return; }
    deriveSafeAddress(evmAddress).then(addr => {
      if (!alive) return;
      setSafeAddress(addr);
      lsSet(KEYS.safeAddr(evmAddress), addr);
    }).catch(e => dbgErr('safe', 'pre-derive failed (will retry on trade)', e));
    return () => { alive = false; };
  }, [evmAddress]);

  // Poll Polymarket balance
  useEffect(() => {
    if (!safeAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const bal = await fetchPolymarketBalance(safeAddress);
        if (alive) setPolyBalance(bal);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [safeAddress]);

  // Poll Solana USDC balance (funding source)
  useEffect(() => {
    if (!fundingPubkey) return;
    let alive = true;
    const tick = async () => {
      try {
        const bal = await fetchSolanaUsdcBalance(fundingPubkey);
        if (alive) setSolUsdcBalance(bal);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [fundingPubkey]);

  const refreshAll = useCallback(async () => {
    if (safeAddress) { try { setPolyBalance(await fetchPolymarketBalance(safeAddress)); } catch {} }
    if (fundingPubkey) { try { setSolUsdcBalance(await fetchSolanaUsdcBalance(fundingPubkey)); } catch {} }
  }, [safeAddress, fundingPubkey]);

  // Geo
  useEffect(() => {
    let alive = true;
    detectCountry().then(c => { if (alive) { setCountry(c); setGeoChecked(true); } });
    return () => { alive = false; };
  }, []);

  // Markets — fetch on horizon change + interval
  useEffect(() => {
    if (!geoChecked) return;
    if (!bypassGeo && country && US_BLOCK.has(country)) return;
    let alive = true;
    const horizon = HORIZONS.find(h => h.id === horizonId) || HORIZONS[1];
    const load = async () => {
      try {
        let raw = [];
        if (horizon.slug) {
          raw = await fetchMarketsByTagSlug(horizon.slug);
          // Fallback to crypto tag if slug returns nothing.
          if (!Array.isArray(raw) || raw.length === 0) {
            raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
          }
        } else {
          raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        }
        if (!alive) return;
        const normalized = (Array.isArray(raw) ? raw : []).map(normalizeEvent).filter(Boolean);
        const filtered   = normalized.filter(m => isTradableMarket(m, horizon));
        setMarkets(filtered);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [geoChecked, country, bypassGeo, horizonId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = q
      ? markets.filter(m => (m.title || '').toLowerCase().includes(q) || (m.childQuestion || '').toLowerCase().includes(q))
      : [...markets];
    if (sortBy === 'upside') {
      const bestUpside = (m) => {
        const yp = Number(m.yesPrice) || 0, np = Number(m.noPrice) || 0;
        const yU = (yp >= 0.02 && yp < 0.98) ? (1 / yp - 1) * 100 : 0;
        const nU = (np >= 0.02 && np < 0.98) ? (1 / np - 1) * 100 : 0;
        return Math.max(yU, nU);
      };
      result.sort((a, b) => bestUpside(b) - bestUpside(a));
    } else if (sortBy === 'ending') {
      const timeLeft = (m) => {
        if (!m.endDate) return Infinity;
        const ms = new Date(m.endDate).getTime() - Date.now();
        return ms > 0 ? ms : Infinity;
      };
      result.sort((a, b) => timeLeft(a) - timeLeft(b));
    } else {
      result.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    return result;
  }, [markets, search, sortBy]);

  const openTrade = useCallback((market, side) => {
    setOrderMarket(market); setOrderSide(side);
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  if (!bypassGeo && geoChecked && country && US_BLOCK.has(country)) return <RegionBlock />;

  if (!geoChecked || loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
        <Header polyBalance={0n} onOpenFund={() => {}} canFund={false} />
        {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        <Header
          polyBalance={polyBalance}
          onOpenFund={() => setFundOpen(true)}
          canFund={true}
        />

        {!privyAuthenticated && (
          <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(168,127,255,.10), rgba(151,252,228,.06))', border: `1px solid ${C.borderHi}` }}>
            <div style={{ fontSize: 11, color: C.violet, fontWeight: 800, letterSpacing: .8, marginBottom: 4, ...T.display }}>SIGN IN TO TRADE</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, ...T.body }}>
              Use email or Google — we'll create your trading wallet automatically.
            </div>
            <button onClick={privyReady ? loginPrivy : undefined} disabled={!privyReady} style={{
              width: '100%', padding: '11px', borderRadius: 10,
              background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`,
              color: C.bg, fontWeight: 800, fontSize: 13, border: 'none',
              cursor: privyReady ? 'pointer' : 'wait', opacity: privyReady ? 1 : .55, ...T.body,
            }}>{privyReady ? 'Sign in' : 'Loading…'}</button>
          </div>
        )}

        {/* Horizon tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }} className="hide-scrollbar">
          {HORIZONS.map(h => {
            const active = horizonId === h.id;
            return (
              <button key={h.id} onClick={() => setHorizonId(h.id)} style={{
                padding: '8px 14px', borderRadius: 99, whiteSpace: 'nowrap',
                background: active ? C.hlDim : 'rgba(255,255,255,.03)',
                border: `1px solid ${active ? C.borderHi : C.border}`,
                color: active ? C.hl : C.muted, fontSize: 11, fontWeight: 800, cursor: 'pointer', ...T.mono,
              }}>{h.label}</button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            inputMode="search" enterKeyHint="search"
            style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 11, color: C.ink, fontSize: 13, outline: 'none', ...T.body }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }} className="hide-scrollbar">
          {[
            { id: 'volume', label: '📊 Volume' },
            { id: 'upside', label: '🔥 Upside' },
            { id: 'ending', label: '⏱ Ending' },
          ].map(opt => {
            const active = sortBy === opt.id;
            return (
              <button key={opt.id} onClick={() => setSortBy(opt.id)} style={{
                padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap',
                background: active ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${active ? C.border : 'transparent'}`,
                color: active ? C.ink : C.muted2, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono,
              }}>{opt.label}</button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}
        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active markets in this horizon.'}
          </div>
        )}
        {filtered.map(m => <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />)}

        <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Polymarket · Fund once, trade silently · Non-custodial
        </div>
      </div>

      {/* Order drawer */}
      {orderMarket && (
        <OrderDrawer
          market={orderMarket} side={orderSide}
          onClose={() => { setOrderMarket(null); refreshAll(); }}
          evmAddress={evmAddress}
          getEvmProvider={getEvmProvider}
          safeAddress={safeAddress}
          polyBalance={polyBalance}
          onNeedFunds={() => { setOrderMarket(null); setFundOpen(true); }}
          refreshAll={refreshAll}
        />
      )}

      {/* Funding sheet */}
      <FundingSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        evmAddress={evmAddress}
        safeAddress={safeAddress}
        polyBalance={polyBalance}
        fundingPubkey={fundingPubkey}
        solUsdcBalance={solUsdcBalance}
        fundingSourceLabel={fundingSourceLabel}
        signSolanaTx={signSolanaTx}
        onFunded={refreshAll}
        onWithdrawn={refreshAll}
        refreshAll={refreshAll}
        onLoginPrivy={loginPrivy}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// VIP GATE WRAPPER
// ═══════════════════════════════════════════════════════════════════

export default function Predict(props) {
  const solWallet = useWallet();
  const nexus     = useNexusWallet();
  const address =
    (solWallet?.publicKey?.toBase58 && solWallet.publicKey.toBase58()) ||
    nexus?.walletAddress ||
    nexus?.privyEmbeddedSol?.address ||
    null;
  const isVip = !!address && VIP_WALLETS.has(address);
  return isVip ? <PredictInner {...props} bypassGeo /> : <ComingSoon />;
}
