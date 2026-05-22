// ─────────────────────────────────────────────────────────────────────
// Predict.jsx — Polymarket trader
//
// IDENTITY: Privy embedded EVM wallet (auto sign-in prompt on first visit)
// FUNDING:  Solana USDC → LI.FI bridge → Polygon Safe (no fee for now)
// TRADING:  Silent, gasless via Polymarket relayer + CLOB
// SELF-HEAL: "Reset trading account" wipes localStorage + re-derives
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL           = 'https://gamma-api.polymarket.com';
const DATA_API_URL        = 'https://data-api.polymarket.com';
const POLYGON_RPC         = 'https://polygon-rpc.com';
const CRYPTO_TAG_ID       = 21;

const POLYGON_CHAIN_ID           = 137;
const CTF_EXCHANGE               = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_CTF_EXCHANGE      = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const NEG_RISK_ADAPTER           = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E_ADDRESS             = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PUSD_ADDRESS               = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const RELAYER_URL                = 'https://relayer-v2.polymarket.com/';

const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RPC          = '/api/solana-rpc';
const LIFI_SOLANA_CHAIN  = 'SOL';
const LIFI_POLYGON_CHAIN = 'POL';
const LIFI_BRIDGE_DENY   = ['mayan'];

const MIN_TRADE_USD   = 1;
const MIN_DEPOSIT_USD = 5;

const MOONPAY_API_KEY = process.env.REACT_APP_MOONPAY_API_KEY || '';
function buildMoonpayUrl(evm) {
  const p = new URLSearchParams({
    currencyCode: 'usdc_polygon',
    walletAddress: evm || '',
    baseCurrencyAmount: '50',
  });
  if (MOONPAY_API_KEY) p.set('apiKey', MOONPAY_API_KEY);
  return 'https://buy.moonpay.com/?' + p.toString();
}

function polyProxyUrl(s = '') {
  const o = (typeof window !== 'undefined' && window.location?.origin) || '';
  return `${o}/api/poly${s}`;
}
function lifiProxyUrl(s = '') {
  const o = (typeof window !== 'undefined' && window.location?.origin) || '';
  return `${o}/api/lifi${s}`;
}

const HORIZONS = [
  { id: 'hourly',  label: 'Hourly',  slug: '15-min-crypto', maxMs: 2  * 60 * 60_000 },
  { id: 'daily',   label: 'Daily',   slug: 'daily-crypto',  maxMs: 36 * 60 * 60_000 },
  { id: 'weekly',  label: 'Weekly',  slug: 'weekly-crypto', maxMs: 8  * 24 * 60 * 60_000 },
  { id: 'monthly', label: 'Monthly', slug: 'monthly-crypto',maxMs: 45 * 24 * 60 * 60_000 },
  { id: 'all',     label: 'All',     slug: null,            maxMs: Infinity },
];

// ═══════════════════════════════════════════════════════════════════
// DEBUG
// ═══════════════════════════════════════════════════════════════════

const DBG_MAX = 200;
const _dbgListeners = new Set();
function _emit(e) { for (const fn of _dbgListeners) { try { fn(e); } catch {} } }
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
    name: err?.name, message: err?.message || String(err),
    code: err?.code, status: err?.status || err?.response?.status,
    body: err?.response?.data || err?.data || undefined,
    stack: err?.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : undefined,
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
  ink: '#e8ecf5', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no:  '#ff5f7a', noDim:  'rgba(255,95,122,.12)',
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

async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
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
  const mo = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (ms < 60 * 60_000) return `Ends in ${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) {
    const h = Math.floor(ms / 3_600_000);
    const mm = Math.floor((ms % 3_600_000) / 60_000);
    return `Ends in ${h}h ${mm}m`;
  }
  return `Ends ${mo} ${day}`;
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
    if (_bodyLockCount === 0) document.body.style.overflow = 'hidden';
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.style.overflow = '';
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
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

const KEYS = {
  safe:        (evm) => 'pm_safe_'     + evm.toLowerCase(),
  deployed:    (evm) => 'pm_deployed_' + evm.toLowerCase(),
  approvals:   (evm) => 'pm_approved_' + evm.toLowerCase(),
  creds:       (evm) => 'pm_creds_'    + evm.toLowerCase(),
};
function lsGet(k)    { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function lsDel(k)    { try { localStorage.removeItem(k); } catch {} }
function lsGetJson(k){ try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
function lsSetJson(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function wipeUserCache(evm) {
  if (!evm) return;
  lsDel(KEYS.safe(evm));
  lsDel(KEYS.deployed(evm));
  lsDel(KEYS.approvals(evm));
  lsDel(KEYS.creds(evm));
  dbg('cache', 'wiped for ' + evm);
}

// ═══════════════════════════════════════════════════════════════════
// SDK LOADING (lazy)
// ═══════════════════════════════════════════════════════════════════

let _clobSdk = null, _relayerSdk = null, _viem = null;

async function loadSdks() {
  if (_clobSdk && _relayerSdk && _viem) return { clob: _clobSdk, relayer: _relayerSdk, viem: _viem };
  dbg('sdks', 'loading');
  const [clob, relayer, viem] = await Promise.all([
    import('@polymarket/clob-client-v2'),
    import('@polymarket/builder-relayer-client'),
    import('viem'),
  ]);
  _clobSdk    = clob;
  _relayerSdk = relayer;
  _viem       = viem;
  dbg('sdks', 'loaded', {
    clob: !!clob?.ClobClient,
    relay: !!relayer?.RelayClient,
    viem: !!viem?.createWalletClient,
  });
  return { clob, relayer, viem };
}

async function buildPrivyViemClient(getEvmProvider) {
  const { viem } = await loadSdks();
  const { createWalletClient, custom } = viem;
  const provider = await getEvmProvider();
  if (!provider) throw new Error('Privy EVM provider unavailable — sign in first');
  const accounts = await provider.request({ method: 'eth_accounts' });
  const account = accounts && accounts[0];
  if (!account) throw new Error('No EVM account from Privy');
  return createWalletClient({ account, transport: custom(provider) });
}

// ═══════════════════════════════════════════════════════════════════
// SAFE DERIVATION + DEPLOY
//
// Try the relayer SDK first; if its internals aren't where we expect
// (versions vary), fall back to RelayClient.getSafeAddress(). If that
// also fails, we let the caller surface the error and user can hit
// "Reset trading account" to retry.
// ═══════════════════════════════════════════════════════════════════

async function deriveSafeAddress(evm, getEvmProvider) {
  const { relayer } = await loadSdks();

  // Attempt 1: RelayClient method (most common in v0.6+)
  try {
    const { RelayClient } = relayer;
    if (RelayClient) {
      const signer = await buildPrivyViemClient(getEvmProvider);
      const client = new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, signer);
      if (typeof client.getSafeAddress === 'function') {
        const safe = await client.getSafeAddress();
        if (safe) { dbg('safe', 'derived via getSafeAddress', { safe }); return safe; }
      }
      if (typeof client.deriveSafe === 'function') {
        const safe = await client.deriveSafe();
        if (safe) { dbg('safe', 'derived via client.deriveSafe', { safe }); return safe; }
      }
    }
  } catch (e) { dbgErr('safe', 'RelayClient derive path failed', e); }

  // Attempt 2: Polymarket's REST endpoint that returns Safe for an EOA
  try {
    const r = await fetchWithTimeout(
      `${RELAYER_URL}safe/${evm}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (r.ok) {
      const j = await r.json();
      const safe = j?.safe || j?.proxyAddress || j?.address;
      if (safe) { dbg('safe', 'derived via REST', { safe }); return safe; }
    }
  } catch (e) { dbgErr('safe', 'REST derive path failed', e); }

  throw new Error('Unable to derive Safe address — try Reset trading account');
}

async function buildRelayClient(getEvmProvider) {
  const { relayer } = await loadSdks();
  const { RelayClient } = relayer;
  if (!RelayClient) throw new Error('RelayClient missing — upgrade @polymarket/builder-relayer-client');
  const signer = await buildPrivyViemClient(getEvmProvider);
  return new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, signer);
}

async function ensureSafeDeployed(evm, getEvmProvider, onStatus) {
  let safe = lsGet(KEYS.safe(evm));
  if (!safe) {
    safe = await deriveSafeAddress(evm, getEvmProvider);
    lsSet(KEYS.safe(evm), safe);
  }
  if (lsGet(KEYS.deployed(evm)) === '1') return safe;

  const relay = await buildRelayClient(getEvmProvider);
  try {
    if (typeof relay.getDeployed === 'function') {
      const deployed = await relay.getDeployed(safe);
      if (deployed) { lsSet(KEYS.deployed(evm), '1'); return safe; }
    }
  } catch (e) { dbgErr('safe', 'getDeployed threw (will deploy)', e); }

  onStatus?.('Setting up trading account…');
  const resp = await relay.deploy();
  const res = await resp.wait();
  const proxy = res?.proxyAddress || safe;
  lsSet(KEYS.safe(evm), proxy);
  lsSet(KEYS.deployed(evm), '1');
  return proxy;
}

// ═══════════════════════════════════════════════════════════════════
// CLOB CREDS
// ═══════════════════════════════════════════════════════════════════

async function getOrDeriveClobCreds(evm, getEvmProvider) {
  const cached = lsGetJson(KEYS.creds(evm));
  if (cached?.key && cached?.secret && cached?.passphrase) return cached;

  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildPrivyViemClient(getEvmProvider);
  const temp = new ClobClient({ host: POLYMARKET_CLOB_URL, chain: POLYGON_CHAIN_ID, signer });

  let creds;
  try { creds = await temp.createOrDeriveApiKey(); }
  catch (e1) {
    dbgErr('creds', 'createOrDeriveApiKey failed, trying deriveApiKey', e1);
    try { creds = await temp.deriveApiKey(); }
    catch (e2) {
      dbgErr('creds', 'deriveApiKey failed, trying createApiKey', e2);
      creds = await temp.createApiKey();
    }
  }
  const norm = {
    key: creds.key || creds.apiKey,
    secret: creds.secret,
    passphrase: creds.passphrase,
  };
  lsSetJson(KEYS.creds(evm), norm);
  return norm;
}

// ═══════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════

const MAX_UINT256 = (1n << 256n) - 1n;
function encErc20Approve(spender, amount) {
  return '0x095ea7b3' +
    spender.replace(/^0x/, '').toLowerCase().padStart(64, '0') +
    BigInt(amount).toString(16).padStart(64, '0');
}
function encErc1155SetApprovalForAll(operator, approved) {
  return '0xa22cb465' +
    operator.replace(/^0x/, '').toLowerCase().padStart(64, '0') +
    (approved ? '1' : '0').padStart(64, '0');
}
function buildApprovalTxs() {
  return [
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(CONDITIONAL_TOKENS_ADDRESS, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(CTF_EXCHANGE,               MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(NEG_RISK_CTF_EXCHANGE,      MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(NEG_RISK_ADAPTER,           MAX_UINT256.toString()) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encErc1155SetApprovalForAll(CTF_EXCHANGE,          true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_CTF_EXCHANGE, true) },
    { to: CONDITIONAL_TOKENS_ADDRESS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_ADAPTER,      true) },
  ];
}
async function ensureApprovals(evm, getEvmProvider, onStatus) {
  if (lsGet(KEYS.approvals(evm)) === '1') return;
  onStatus?.('Approving Polymarket contracts…');
  const relay = await buildRelayClient(getEvmProvider);
  const resp = await relay.execute(buildApprovalTxs(), 'Polymarket trading approvals');
  await resp.wait();
  lsSet(KEYS.approvals(evm), '1');
}

async function ensurePolymarketSetup(evm, getEvmProvider, onStatus) {
  dbg('setup', 'start', { evm });
  const safe = await ensureSafeDeployed(evm, getEvmProvider, onStatus);
  const [creds] = await Promise.all([
    getOrDeriveClobCreds(evm, getEvmProvider),
    ensureApprovals(evm, getEvmProvider, onStatus),
  ]);
  dbg('setup', 'done', { safe });
  return { safeAddress: safe, creds };
}

// ═══════════════════════════════════════════════════════════════════
// BALANCES
// ═══════════════════════════════════════════════════════════════════

async function ethCallBalance(token, holder) {
  try {
    const addr = holder.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0x70a08231' + addr;
    const r = await fetchWithTimeout(POLYGON_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data }, 'latest'] }),
    }, 6_000);
    if (!r.ok) return 0n;
    const j = await r.json();
    const hex = j?.result;
    if (!hex || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);
  } catch { return 0n; }
}
const fetchPolymarketBalance = (safe) => ethCallBalance(PUSD_ADDRESS, safe);
const fetchUsdceBalance      = (addr) => ethCallBalance(USDC_E_ADDRESS, addr);

// Solana USDC balance (for users who want to bridge from Phantom)
function deriveSolanaAta(ownerB58) {
  const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const ATA   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const owner = new PublicKey(ownerB58);
  const mint  = new PublicKey(USDC_SOLANA_MINT);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA,
  );
  return ata.toBase58();
}
async function fetchSolanaUsdcBalance(ownerB58) {
  try {
    const ata = deriveSolanaAta(ownerB58);
    const r = await fetchWithTimeout(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance',
        params: [ata, { commitment: 'confirmed' }],
      }),
    }, 6_000);
    const j = await r.json();
    const a = j?.result?.value?.amount;
    return a ? BigInt(a) : 0n;
  } catch { return 0n; }
}

// ═══════════════════════════════════════════════════════════════════
// LI.FI BRIDGE (Solana → Polygon)
// ═══════════════════════════════════════════════════════════════════

async function lifiQuote({ fromAddress, toAddress, fromAmountAtomic }) {
  const params = new URLSearchParams({
    fromChain: LIFI_SOLANA_CHAIN, toChain: LIFI_POLYGON_CHAIN,
    fromToken: USDC_SOLANA_MINT,  toToken:  USDC_E_ADDRESS,
    fromAddress, toAddress,
    fromAmount: String(fromAmountAtomic),
    integrator: 'nexus-dex',
    denyBridges: LIFI_BRIDGE_DENY.join(','),
    slippage: '0.03',
    order: 'CHEAPEST',
  });
  const r = await fetchWithTimeout(lifiProxyUrl('/quote?' + params.toString()), {}, 15_000);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Bridge quote failed (${r.status}): ${t.slice(0, 120)}`);
  }
  const q = await r.json();
  if (!q?.transactionRequest && !q?.tx) throw new Error('Bridge returned no tx');
  return q;
}
async function lifiStatus({ txHash, fromChain, toChain, bridge }) {
  const p = new URLSearchParams({ txHash });
  if (fromChain) p.set('fromChain', String(fromChain));
  if (toChain)   p.set('toChain',   String(toChain));
  if (bridge)    p.set('bridge',    bridge);
  const r = await fetchWithTimeout(lifiProxyUrl('/status?' + p.toString()), {}, 10_000);
  if (!r.ok) return null;
  return await r.json();
}
async function submitSolanaTx(signedTx) {
  const r = await fetchWithTimeout(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendTransaction',
      params: [btoa(String.fromCharCode(...signedTx.serialize())), {
        encoding: 'base64', skipPreflight: false,
        preflightCommitment: 'confirmed', maxRetries: 5,
      }],
    }),
  }, 20_000);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'Solana submit failed');
  return j.result;
}
async function pollLifiUntilDone(p, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await lifiStatus(p);
    if (s) {
      const st = (s.status || '').toUpperCase();
      const sub = (s.substatus || '').toUpperCase();
      if (st === 'DONE' || sub === 'COMPLETED') return { ok: true, status: s };
      if (st === 'FAILED' || sub === 'REFUNDED') return { ok: false, status: s };
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  return { ok: false, reason: 'timeout' };
}

async function bridgeSolToPolygon({ fundingPubkey, safeAddress, usdAtomic, signFn, onStatus }) {
  onStatus?.('Getting bridge route…');
  const quote = await lifiQuote({
    fromAddress: fundingPubkey, toAddress: safeAddress,
    fromAmountAtomic: usdAtomic,
  });
  const txData = quote?.transactionRequest?.data || quote?.tx?.data;
  if (!txData) throw new Error('LI.FI quote missing tx data');
  const raw = typeof txData === 'string'
    ? Uint8Array.from(atob(txData), c => c.charCodeAt(0))
    : new Uint8Array(txData);
  const bridgeTx = VersionedTransaction.deserialize(raw);

  onStatus?.('Confirm in your wallet…');
  const signed = await signFn(bridgeTx);

  onStatus?.('Submitting…');
  const sig = await submitSolanaTx(signed);
  dbg('bridge', 'submitted', { sig });

  onStatus?.('Bridging to Polymarket (~30s)…');
  const landed = await pollLifiUntilDone({
    txHash: sig,
    fromChain: LIFI_SOLANA_CHAIN, toChain: LIFI_POLYGON_CHAIN,
    bridge: quote?.tool || quote?.bridge,
  });
  return { ok: landed.ok, sig };
}

// ═══════════════════════════════════════════════════════════════════
// MARKETS
// ═══════════════════════════════════════════════════════════════════

async function fetchMarketsByTagSlug(slug) {
  const url = `${GAMMA_URL}/events?tag_slug=${encodeURIComponent(slug)}&closed=false&order=volume24hr&ascending=false&limit=60`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  return await r.json();
}
async function fetchMarketsByTagId(tagId) {
  const url = `${GAMMA_URL}/events?tag_id=${tagId}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=80`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Gamma ${r.status}`);
  return await r.json();
}
function normalizeEvent(ev) {
  const ms = Array.isArray(ev.markets) ? ev.markets : [];
  if (ms.length === 0) return null;
  const m = ms[0];
  let outcomePrices = [];
  try { outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []); } catch {}
  let clobTokenIds = [];
  try { clobTokenIds = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []); } catch {}
  const yesPrice = Number(outcomePrices[0] || m.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  return {
    id: ev.id, slug: ev.slug,
    title: ev.title || m.question || 'Untitled',
    childQuestion: ms.length > 1 ? (m.question || m.groupItemTitle || null) : null,
    image: ev.image || ev.icon || m.image || null,
    volume24h: Number(ev.volume24hr || m.volume24hr || 0),
    liquidity: Number(ev.liquidity  || m.liquidity  || 0),
    endDate: ev.endDate || m.endDate || null,
    yesPrice, noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct: Math.round(noPrice * 100),
    marketCount: ms.length,
    conditionId: m.conditionId,
    clobTokenIds,
    negRisk: !!(m.negRisk || ev.negRisk),
    tickSize: String(m.orderPriceMinTickSize || m.minimum_tick_size || m.tickSize || '0.01'),
  };
}
function isTradableMarket(m, h) {
  if (!m || !m.clobTokenIds || m.clobTokenIds.length < 2 || !m.conditionId) return false;
  const y = Number(m.yesPrice) || 0;
  if (y <= 0.02 || y >= 0.98) return false;
  if (!m.endDate) return false;
  const ms = new Date(m.endDate).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (h && Number.isFinite(h.maxMs) && ms > h.maxMs) return false;
  if ((Number(m.volume24h) || 0) < 500) return false;
  if ((Number(m.liquidity) || 0) < 100) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════

async function buildAuthClobClient(getEvmProvider, safeAddress, creds) {
  const { clob } = await loadSdks();
  const { ClobClient } = clob;
  const signer = await buildPrivyViemClient(getEvmProvider);
  return new ClobClient({
    host: POLYMARKET_CLOB_URL, chain: POLYGON_CHAIN_ID,
    signer, creds, signatureType: 2, funderAddress: safeAddress,
  });
}
async function getBuilderCode() {
  try {
    const r = await fetchWithTimeout(polyProxyUrl('/builder-code'), {}, 4_000);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.builderCode || null;
  } catch { return null; }
}
async function postMarketOrder({ getEvmProvider, safeAddress, creds, market, side, amount, isBuy }) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');
  const { clob } = await loadSdks();
  const Side = clob.Side || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FAK: 'FAK', FOK: 'FOK', GTC: 'GTC' };
  const builderCode = await getBuilderCode();
  const client = await buildAuthClobClient(getEvmProvider, safeAddress, creds);
  const marketOrder = {
    tokenID: String(tokenId),
    amount: Number(amount),
    side: isBuy ? Side.BUY : Side.SELL,
    ...(builderCode ? { builderCode } : {}),
  };
  const opts = { tickSize: market.tickSize || '0.01', negRisk: !!market.negRisk };
  if (typeof client.createAndPostMarketOrder !== 'function') {
    throw new Error('clob-client-v2 missing createAndPostMarketOrder — upgrade SDK');
  }
  const resp = await client.createAndPostMarketOrder(marketOrder, opts, OrderType.FAK);
  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false)       throw new Error(resp?.errorMsg || 'Order rejected');
  return resp;
}
async function fetchPolymarketPositions(safe, conditionId, clobTokenIds) {
  try {
    const r = await fetchWithTimeout(`${DATA_API_URL}/positions?user=${safe.toLowerCase()}&market=${conditionId}`, { headers: { Accept: 'application/json' } }, 6_000);
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)) return null;
    const [yesTid, noTid] = clobTokenIds || [];
    let yPos = null, nPos = null;
    for (const p of data) {
      const tid = String(p.asset || p.tokenId || p.token_id || '');
      if (yesTid && tid === String(yesTid)) yPos = p;
      if (noTid  && tid === String(noTid))  nPos = p;
    }
    const sz = (p) => p ? Number(p.size || p.shares || p.balance || 0) : 0;
    const av = (p) => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;
    return { sharesYes: sz(yPos), sharesNo: sz(nPos), avgPriceYes: av(yPos), avgPriceNo: av(nPos) };
  } catch { return null; }
}
async function fetchClobBestBid(tokenId) {
  try {
    const r = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/book?token_id=${tokenId}`, {}, 6_000);
    if (!r.ok) return 0;
    const d = await r.json();
    const bids = d?.bids || [];
    let best = 0;
    for (const b of bids) { const p = Number(b.price || b.p || 0); if (p > best) best = p; }
    return best;
  } catch { return 0; }
}

// ═══════════════════════════════════════════════════════════════════
// UI — Shared components
// ═══════════════════════════════════════════════════════════════════

function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>Coming soon.</div>
      </div>
    </div>
  );
}

function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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
  const yp = Number(market.yesPrice) || 0;
  const np = Number(market.noPrice)  || 0;
  const upside = (p) => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {image && <img src={image} alt="" onError={(e) => e.currentTarget.style.display = 'none'} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: childQuestion ? 4 : 6, ...T.body }}>{title}</div>
          {childQuestion && <div style={{ fontSize: 11, fontWeight: 600, color: C.hl, marginBottom: 6, ...T.body }}>{childQuestion}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && <><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>}
            {marketCount > 1 && <><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: 10, borderRadius: 11, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Yes · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}% upside</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: 10, borderRadius: 11, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>No · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function DebugPanel({ open, onToggle }) {
  const log = useDbgLog();
  const ref = useRef(null);
  useEffect(() => { if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log.length, open]);
  const copy = () => {
    try {
      const t = log.map(e => `${new Date(e.ts).toISOString().slice(11, 23)} [${e.scope}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n');
      navigator.clipboard?.writeText(t);
    } catch {}
  };
  return (
    <div style={{ marginBottom: 12, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 800, letterSpacing: 1.2, ...T.mono }}>DEBUG · {log.length} {open ? '▾' : '▸'}</span>
        {open && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); copy(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>COPY</button>
            <button onClick={(e) => { e.stopPropagation(); dbgClear(); }} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>CLEAR</button>
          </div>
        )}
      </div>
      {open && (
        <div ref={ref} style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 12px', background: 'rgba(0,0,0,.25)', borderTop: `1px solid ${C.border}`, ...T.mono, fontSize: 10, lineHeight: 1.5 }}>
          {log.length === 0 ? (
            <div style={{ color: C.muted2, fontStyle: 'italic' }}>No entries yet.</div>
          ) : log.map((e, i) => {
            const isErr = String(e.msg).startsWith('ERROR');
            return (
              <div key={i} style={{ color: isErr ? C.no : C.ink, marginBottom: 2, wordBreak: 'break-word' }}>
                <span style={{ color: C.muted2 }}>{new Date(e.ts).toISOString().slice(11, 23)}</span>{' '}
                <span style={{ color: C.hl, fontWeight: 700 }}>[{e.scope}]</span> {e.msg}
                {e.data !== undefined && <span style={{ color: C.muted, fontSize: 9 }}> {JSON.stringify(e.data).slice(0, 200)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FUNDING SHEET
// ═══════════════════════════════════════════════════════════════════

function FundingSheet({
  open, onClose, evmAddress, safeAddress, polyBalance,
  fundingPubkey, solUsdcBalance, signSolanaTx,
  onReset, refreshAll,
}) {
  const [amount, setAmount] = useState('25');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [dbgOpen, setDbgOpen] = useState(false);
  const [tab, setTab] = useState('address'); // address | bridge

  useBodyLock(open);
  useEffect(() => { if (!open) { setStatus('idle'); setStatusMsg(''); setError(''); } }, [open]);
  if (!open) return null;

  const solUsd = Number(solUsdcBalance) / 1e6;
  const polyUsd = Number(polyBalance) / 1e6;
  const usd = Number(amount) || 0;
  const canBridge = !!fundingPubkey && !!safeAddress && usd >= MIN_DEPOSIT_USD && usd <= solUsd && status !== 'bridging';

  const handleBridge = async () => {
    if (!canBridge) { setError(`Min $${MIN_DEPOSIT_USD} · Max ${fmtUsd(solUsd, 2)}`); return; }
    setStatus('bridging'); setError(''); setStatusMsg('');
    try {
      const totalAtomic = BigInt(Math.floor(usd * 1e6));
      await bridgeSolToPolygon({
        fundingPubkey, safeAddress, usdAtomic: totalAtomic,
        signFn: signSolanaTx, onStatus: setStatusMsg,
      });
      setStatus('done');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 5000);
    } catch (e) {
      const m = e?.message || 'Bridge failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleCopy = async () => {
    if (!safeAddress) return;
    const ok = await copyToClipboard(safeAddress);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  return (
    <div onClick={status === 'bridging' ? undefined : onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)',
      backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      cursor: status === 'bridging' ? 'wait' : 'pointer',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 520,
        background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`,
        borderTop: `1px solid ${C.borderHi}`,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)',
        boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 4, ...T.display }}>Fund trading account</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, ...T.body }}>
          Balance: <span style={{ color: C.hl, fontWeight: 700 }}>{fmtUsd(polyUsd, 2)}</span>
        </div>

        <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, padding: 3, background: 'rgba(255,255,255,.03)', borderRadius: 10 }}>
          <button onClick={() => setTab('address')} style={{ flex: 1, padding: '8px', borderRadius: 8, background: tab === 'address' ? C.hlDim : 'transparent', border: `1px solid ${tab === 'address' ? C.borderHi : 'transparent'}`, color: tab === 'address' ? C.hl : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>SEND USDC</button>
          <button onClick={() => setTab('bridge')} disabled={!fundingPubkey} style={{ flex: 1, padding: '8px', borderRadius: 8, background: tab === 'bridge' ? C.hlDim : 'transparent', border: `1px solid ${tab === 'bridge' ? C.borderHi : 'transparent'}`, color: tab === 'bridge' ? C.hl : C.muted, fontSize: 11, fontWeight: 700, cursor: fundingPubkey ? 'pointer' : 'not-allowed', opacity: fundingPubkey ? 1 : .5, ...T.mono }}>BRIDGE FROM SOL</button>
        </div>

        {tab === 'address' && (
          <>
            <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: .8, marginBottom: 8, ...T.display }}>YOUR DEPOSIT ADDRESS (POLYGON)</div>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', lineHeight: 1.4, marginBottom: 10 }}>
                {safeAddress || 'Setting up…'}
              </div>
              <button onClick={handleCopy} disabled={!safeAddress} style={{ width: '100%', padding: 10, borderRadius: 10, background: copied ? C.yesDim : C.hlDim, border: `1px solid ${copied ? C.yes + '55' : C.borderHi}`, color: copied ? C.yes : C.hl, fontSize: 12, fontWeight: 700, cursor: safeAddress ? 'pointer' : 'not-allowed', opacity: safeAddress ? 1 : .5, ...T.mono }}>
                {copied ? '✓ Copied' : 'Copy address'}
              </button>
              <div style={{ fontSize: 10, color: C.muted2, marginTop: 8, lineHeight: 1.5, ...T.mono }}>
                ⚠ Send USDC.e on Polygon ONLY. Sending other tokens or wrong network = lost funds.
              </div>
            </div>
            <a href={buildMoonpayUrl(safeAddress)} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: 12, borderRadius: 12, background: 'rgba(168,127,255,.08)', border: `1px solid ${C.violet}44`, color: C.violet, fontSize: 12, fontWeight: 700, textDecoration: 'none', marginBottom: 12, ...T.body }}>
              Buy USDC with card via MoonPay →
            </a>
          </>
        )}

        {tab === 'bridge' && fundingPubkey && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: .8, ...T.display }}>BRIDGE FROM SOLANA</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(solUsd, 2)} available</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <span style={{ fontSize: 18, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={status === 'bridging'} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['10', '25', '100', '250'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={status === 'bridging'} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.floor(solUsd * 100) / 100))} disabled={status === 'bridging' || solUsd <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
            {statusMsg && status === 'bridging' && (
              <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
                <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{statusMsg}</span>
              </div>
            )}
            {status === 'done' && !error && (
              <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>
                ✓ Bridge submitted — balance updates in ~30s
              </div>
            )}
            {error && (
              <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>{error}</div>
            )}
            <button onClick={canBridge ? handleBridge : undefined} disabled={!canBridge} style={{
              width: '100%', padding: 12, borderRadius: 11,
              background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`,
              color: C.bg, fontWeight: 800, fontSize: 14, border: 'none',
              cursor: canBridge ? 'pointer' : 'not-allowed', opacity: canBridge ? 1 : .55, ...T.body,
            }}>
              {status === 'bridging' ? 'Bridging…' : `Bridge ${fmtUsd(usd, 2)} to trading`}
            </button>
          </div>
        )}

        {/* Reset */}
        {evmAddress && (
          <button onClick={onReset} style={{
            width: '100%', padding: 10, borderRadius: 10,
            background: 'rgba(255,95,122,.05)', border: `1px solid ${C.no}33`,
            color: C.no, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            marginTop: 6, ...T.mono,
          }}>
            ↻ Reset trading account (if stuck)
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDER DRAWER
// ═══════════════════════════════════════════════════════════════════

function OrderDrawer({
  market, side, onClose, evmAddress, getEvmProvider, safeAddress,
  polyBalance, onNeedFunds, refreshAll,
}) {
  const [amount, setAmount] = useState('10');
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [pos, setPos] = useState(null);
  const [bids, setBids] = useState({ yes: 0, no: 0 });
  const [sellStatus, setSellStatus] = useState('idle');
  const [dbgOpen, setDbgOpen] = useState(false);

  useBodyLock(!!market);

  useEffect(() => {
    if (!market || !safeAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const [p, yb, nb] = await Promise.all([
          fetchPolymarketPositions(safeAddress, market.conditionId, market.clobTokenIds),
          fetchClobBestBid(market.clobTokenIds[0]),
          fetchClobBestBid(market.clobTokenIds[1]),
        ]);
        if (!alive) return;
        if (p) setPos(p);
        setBids({ yes: yb, no: nb });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, [market, safeAddress]);

  if (!market) return null;

  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd = Number(amount) || 0;
  const shares = price > 0 ? usd / price : 0;
  const upside = usd > 0 ? ((shares - usd) / usd) * 100 : 0;
  const sideColor = side === 'yes' ? C.yes : C.no;
  const sideDim   = side === 'yes' ? C.yesDim : C.noDim;
  const polyUsd = Number(polyBalance) / 1e6;
  const needsFunds = usd > polyUsd;
  const busy = status === 'working' || sellStatus === 'selling';
  const canBuy = !busy && usd >= MIN_TRADE_USD && evmAddress && safeAddress && !needsFunds && market.clobTokenIds?.length >= 2;

  const held = side === 'yes' ? Number(pos?.sharesYes || 0) : Number(pos?.sharesNo || 0);
  const avgPx = side === 'yes' ? Number(pos?.avgPriceYes || 0) : Number(pos?.avgPriceNo || 0);
  const bid = side === 'yes' ? bids.yes : bids.no;
  const value = held * bid;
  const cost = held * avgPx;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const hasPos = held > 0.01;

  const handleBuy = async () => {
    if (needsFunds) { onNeedFunds?.(); return; }
    if (usd < MIN_TRADE_USD) { setError(`Min $${MIN_TRADE_USD}`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      const setup = await ensurePolymarketSetup(evmAddress, getEvmProvider, setStatusMsg);
      setStatusMsg('Placing order…');
      await postMarketOrder({
        getEvmProvider, safeAddress: setup.safeAddress, creds: setup.creds,
        market, side, amount: usd, isBuy: true,
      });
      setStatus('success'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 4500);
    }
  };
  const handleSell = async () => {
    if (!hasPos) return;
    setSellStatus('selling'); setError(''); setStatusMsg('');
    try {
      const setup = await ensurePolymarketSetup(evmAddress, getEvmProvider, setStatusMsg);
      setStatusMsg('Selling…');
      await postMarketOrder({
        getEvmProvider, safeAddress: setup.safeAddress, creds: setup.creds,
        market, side, amount: held, isBuy: false,
      });
      setSellStatus('sold'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setSellStatus('error'); setStatusMsg('');
      setDbgOpen(true);
      setTimeout(() => setSellStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>Bal {fmtUsd(polyUsd, 2)}</div>
        </div>

        <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

        {hasPos && sellStatus !== 'sold' && (
          <div style={{ marginBottom: 14, padding: 14, borderRadius: 12, background: pnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${pnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
            <div style={{ fontSize: 10, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, letterSpacing: .8, marginBottom: 10, ...T.mono }}>YOUR POSITION · {side.toUpperCase()}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Shares</span>
              <span style={{ color: C.ink, fontWeight: 700 }}>{held.toFixed(2)} @ ${avgPx.toFixed(3)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, ...T.mono }}>
              <span style={{ color: C.muted }}>Value · P&amp;L</span>
              <span style={{ color: pnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>{fmtUsd(value, 2)} · {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
            </div>
            <button onClick={sellStatus === 'selling' ? undefined : handleSell} disabled={sellStatus === 'selling' || bid <= 0} style={{
              width: '100%', padding: 11, borderRadius: 10,
              background: pnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`,
              border: `1px solid ${pnl >= 0 ? C.yes : C.no}66`,
              color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 13,
              cursor: (sellStatus === 'selling' || bid <= 0) ? 'not-allowed' : 'pointer',
              opacity: (sellStatus === 'selling' || bid <= 0) ? .55 : 1, ...T.body,
            }}>
              {sellStatus === 'selling' ? 'Selling…' : bid <= 0 ? 'No bids' : `Sell all · ${fmtUsd(value, 2)}`}
            </button>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['5', '10', '25', '100'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
            <button onClick={() => setAmount(String(Math.floor(polyUsd * 100) / 100))} disabled={busy || polyUsd <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
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
            <div style={{ marginTop: 6, fontSize: 10, color: C.muted, ...T.mono }}>See Debug panel for details.</div>
          </div>
        )}

        <button onClick={canBuy ? handleBuy : needsFunds ? onNeedFunds : undefined} disabled={busy || (!canBuy && !needsFunds)} style={{
          width: '100%', padding: 14, borderRadius: 13,
          background: status === 'success' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)`
                    : needsFunds          ? `linear-gradient(135deg, ${C.amber}33, ${C.amber}22)`
                    : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`,
          border: `1px solid ${needsFunds ? C.amber : sideColor}66`,
          color: needsFunds ? C.amber : sideColor,
          fontWeight: 800, fontSize: 14,
          cursor: (canBuy || needsFunds) ? 'pointer' : 'not-allowed',
          opacity: (canBuy || needsFunds) ? 1 : .55, ...T.body,
        }}>
          {busy ? 'Placing order…' :
           status === 'success' ? '✓ Order placed' :
           needsFunds ? `Fund account · need ${fmtUsd(usd - polyUsd, 2)} more` :
           `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════

function Header({ polyBalance, onOpenFund, canFund, signedIn, onSignIn, signingIn }) {
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

        {signedIn ? (
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
              {usd > 0 ? 'Fund' : 'Fund'}
            </button>
          </div>
        ) : (
          <button onClick={onSignIn} disabled={signingIn} style={{
            width: '100%', padding: '14px', borderRadius: 12,
            background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`,
            color: C.bg, fontWeight: 800, fontSize: 14, border: 'none',
            cursor: signingIn ? 'wait' : 'pointer', opacity: signingIn ? .7 : 1, ...T.body,
          }}>
            {signingIn ? 'Signing in…' : 'Sign in to trade'}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

function PredictInner() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [horizonId, setHorizonId] = useState('daily');
  const [sortBy, setSortBy] = useState('volume');

  const [orderMarket, setOrderMarket] = useState(null);
  const [orderSide, setOrderSide] = useState('yes');
  const [fundOpen, setFundOpen] = useState(false);

  const [safeAddress, setSafeAddress] = useState(null);
  const [safeDeriving, setSafeDeriving] = useState(false);
  const [safeError, setSafeError] = useState(null);
  const [polyBalance, setPolyBalance] = useState(0n);
  const [solUsdcBalance, setSolUsdcBalance] = useState(0n);
  const [autoPromptedSignIn, setAutoPromptedSignIn] = useState(false);

  const { publicKey: extSolPk, signTransaction: extSolSignTx } = useWallet();
  const {
    privyAuthenticated, privyEmbeddedSol, privyEmbeddedEvm,
    getEvmAddress, getEvmProvider,
    loginPrivy, privyReady,
  } = useNexusWallet();

  const evmAddress = useMemo(() => {
    if (!privyAuthenticated) return null;
    return getEvmAddress?.() || privyEmbeddedEvm?.address || null;
  }, [privyAuthenticated, getEvmAddress, privyEmbeddedEvm]);

  // Auto-prompt Privy sign-in once on first render if not signed in.
  useEffect(() => {
    if (!privyReady) return;
    if (privyAuthenticated) return;
    if (autoPromptedSignIn) return;
    setAutoPromptedSignIn(true);
    try { loginPrivy?.(); } catch (e) { dbgErr('auth', 'auto loginPrivy failed', e); }
  }, [privyReady, privyAuthenticated, autoPromptedSignIn, loginPrivy]);

  // Funding source: Phantom > Privy embedded Solana
  const fundingPubkey = useMemo(() => {
    if (extSolPk) return extSolPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [extSolPk, privyEmbeddedSol]);

  const signSolanaTx = useCallback(async (tx) => {
    if (extSolPk && extSolSignTx) return await extSolSignTx(tx);
    if (privyEmbeddedSol?.signTransaction) return await privyEmbeddedSol.signTransaction(tx);
    throw new Error('No Solana signer available');
  }, [extSolPk, extSolSignTx, privyEmbeddedSol]);

  // Derive Safe address — runs once per EVM, with retry button via Reset
  useEffect(() => {
    if (!evmAddress) { setSafeAddress(null); setSafeError(null); return; }
    let alive = true;
    const cached = lsGet(KEYS.safe(evmAddress));
    if (cached) { setSafeAddress(cached); setSafeError(null); return; }
    setSafeDeriving(true);
    deriveSafeAddress(evmAddress, getEvmProvider).then(addr => {
      if (!alive) return;
      setSafeAddress(addr);
      lsSet(KEYS.safe(evmAddress), addr);
      setSafeError(null);
    }).catch(e => {
      if (!alive) return;
      dbgErr('safe', 'derive failed', e);
      setSafeError(e?.message || 'Failed to set up trading account');
    }).finally(() => {
      if (alive) setSafeDeriving(false);
    });
    return () => { alive = false; };
  }, [evmAddress, getEvmProvider]);

  // Balance polling
  useEffect(() => {
    if (!safeAddress) return;
    let alive = true;
    const tick = async () => {
      try { const b = await fetchPolymarketBalance(safeAddress); if (alive) setPolyBalance(b); } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [safeAddress]);

  useEffect(() => {
    if (!fundingPubkey) return;
    let alive = true;
    const tick = async () => {
      try { const b = await fetchSolanaUsdcBalance(fundingPubkey); if (alive) setSolUsdcBalance(b); } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [fundingPubkey]);

  const refreshAll = useCallback(async () => {
    if (safeAddress) { try { setPolyBalance(await fetchPolymarketBalance(safeAddress)); } catch {} }
    if (fundingPubkey) { try { setSolUsdcBalance(await fetchSolanaUsdcBalance(fundingPubkey)); } catch {} }
  }, [safeAddress, fundingPubkey]);

  const handleReset = useCallback(() => {
    if (!evmAddress) return;
    wipeUserCache(evmAddress);
    setSafeAddress(null);
    setSafeError(null);
    setFundOpen(false);
    setTimeout(() => {
      setSafeDeriving(true);
      deriveSafeAddress(evmAddress, getEvmProvider).then(addr => {
        setSafeAddress(addr);
        lsSet(KEYS.safe(evmAddress), addr);
      }).catch(e => setSafeError(e?.message || 'Reset failed'))
        .finally(() => setSafeDeriving(false));
    }, 200);
  }, [evmAddress, getEvmProvider]);

  // Markets
  useEffect(() => {
    let alive = true;
    const h = HORIZONS.find(x => x.id === horizonId) || HORIZONS[1];
    const load = async () => {
      try {
        let raw = [];
        if (h.slug) {
          raw = await fetchMarketsByTagSlug(h.slug);
          if (!Array.isArray(raw) || raw.length === 0) raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        } else {
          raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        }
        if (!alive) return;
        const norm = (Array.isArray(raw) ? raw : []).map(normalizeEvent).filter(Boolean);
        setMarkets(norm.filter(m => isTradableMarket(m, h)));
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
  }, [horizonId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = q ? markets.filter(m => (m.title || '').toLowerCase().includes(q) || (m.childQuestion || '').toLowerCase().includes(q)) : [...markets];
    if (sortBy === 'upside') {
      const u = (m) => {
        const y = Number(m.yesPrice) || 0, n = Number(m.noPrice) || 0;
        const yU = (y >= 0.02 && y < 0.98) ? (1 / y - 1) * 100 : 0;
        const nU = (n >= 0.02 && n < 0.98) ? (1 / n - 1) * 100 : 0;
        return Math.max(yU, nU);
      };
      r.sort((a, b) => u(b) - u(a));
    } else if (sortBy === 'ending') {
      const t = (m) => {
        if (!m.endDate) return Infinity;
        const ms = new Date(m.endDate).getTime() - Date.now();
        return ms > 0 ? ms : Infinity;
      };
      r.sort((a, b) => t(a) - t(b));
    } else {
      r.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    return r;
  }, [markets, search, sortBy]);

  const openTrade = useCallback((m, s) => { setOrderMarket(m); setOrderSide(s); }, []);

  if (loading) {
    return (
      <>
        <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
          <Header polyBalance={polyBalance} onOpenFund={() => setFundOpen(true)} canFund={!!safeAddress} signedIn={!!privyAuthenticated} onSignIn={loginPrivy} signingIn={!privyReady} />
          {[1, 2, 3, 4, 5].map(i => <MarketSkeleton key={i} />)}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header
          polyBalance={polyBalance}
          onOpenFund={() => setFundOpen(true)}
          canFund={!!safeAddress && !safeDeriving}
          signedIn={!!privyAuthenticated}
          onSignIn={loginPrivy}
          signingIn={!privyReady}
        />

        {safeError && privyAuthenticated && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: 'rgba(255,95,122,.07)', border: `1px solid ${C.no}33` }}>
            <div style={{ fontSize: 12, color: C.no, fontWeight: 700, marginBottom: 6, ...T.body }}>Couldn't set up trading account</div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, ...T.mono }}>{safeError}</div>
            <button onClick={handleReset} style={{ padding: '6px 12px', borderRadius: 8, background: C.no + '22', border: `1px solid ${C.no}55`, color: C.no, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
              ↻ Retry
            </button>
          </div>
        )}
        {safeDeriving && privyAuthenticated && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: 'rgba(245,181,61,.06)', border: `1px solid ${C.amber}44`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.amber}33`, borderTopColor: C.amber, animation: 'nexus-spin .8s linear infinite' }} />
            <div style={{ fontSize: 12, color: C.amber, fontWeight: 700, ...T.body }}>Setting up your trading account…</div>
          </div>
        )}

        {/* Horizon tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
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

        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" inputMode="search"
            style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 11, color: C.ink, fontSize: 13, outline: 'none', ...T.body }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
          {[{ id: 'volume', label: '📊 Volume' }, { id: 'upside', label: '🔥 Upside' }, { id: 'ending', label: '⏱ Ending' }].map(o => {
            const a = sortBy === o.id;
            return (
              <button key={o.id} onClick={() => setSortBy(o.id)} style={{
                padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap',
                background: a ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${a ? C.border : 'transparent'}`,
                color: a ? C.ink : C.muted2, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono,
              }}>{o.label}</button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}
        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active markets.'}
          </div>
        )}
        {filtered.map(m => <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />)}

        <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Polymarket · Silent trades · Non-custodial
        </div>
      </div>

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

      <FundingSheet
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        evmAddress={evmAddress}
        safeAddress={safeAddress}
        polyBalance={polyBalance}
        fundingPubkey={fundingPubkey}
        solUsdcBalance={solUsdcBalance}
        signSolanaTx={signSolanaTx}
        onReset={handleReset}
        refreshAll={refreshAll}
      />
    </>
  );
}

export default function Predict() {
  return <PredictInner />;
}
