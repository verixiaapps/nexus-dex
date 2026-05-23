// Predict.jsx - External wallets only. No Privy. No embedded wallet SDK.
//
// User connects two wallets:
//   - Solana: Phantom/Solflare/Backpack via @solana/wallet-adapter-react
//   - EVM:    MetaMask/Rabby/Phantom-EVM via EIP-6963 (window.ethereum fallback)
//
// Locked rules:
//   1. Every signed Solana action: build tx -> WE simulate -> user signs
//      THAT SAME tx -> we submit THAT SAME signed tx. Same object end-to-end.
//   2. SOL stays in user's Solana wallet until they click Buy.
//   3. Buy = ONE Solana tx with TWO transfers: 95% -> Polymarket bridge,
//      5% -> our fee wallet. Then CLOB order signed by EVM wallet.
//   4. Sell = CLOB order signed by EVM wallet. USDC.e stays in Safe.
//   5. Collect Winnings = explicit withdraw, USDC.e -> user's Solana addr as SOL.
//   6. Safe deployed + approved on EVM wallet connect. Verified on-chain.

import React, {
  useEffect, useState, useCallback, useMemo, useRef,
} from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey, SystemProgram, Transaction, ComputeBudgetProgram,
} from '@solana/web3.js';

/* ============================================================ Constants */

const CLOB_URL = 'https://clob.polymarket.com';
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const DATA_API_URL = 'https://data-api.polymarket.com';

const POLYGON_RPCS = [
  'https://polygon.llamarpc.com',
  'https://polygon-bor-rpc.publicnode.com',
  'https://rpc.ankr.com/polygon',
  'https://polygon-rpc.com',
];
const POLYGON_CHAIN_ID = 137;
const POLYGON_CHAIN_HEX = '0x89';

const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const BUILDER_CODE = '0x6e656750ed8970d584732af619cb7a4d493e18bc9cbf4fd866eb9594f92569fa';

const SOL_RPC = '/api/solana-rpc';
const BRIDGE_DEPOSIT = '/api/poly/deposit';
const BRIDGE_STATUS = '/api/poly/status';
const BRIDGE_WITHDRAW = '/api/poly/withdraw';

const FEE_WALLET_SOL = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const FEE_PCT = 5;
const FEE_BPS = BigInt(FEE_PCT * 100);

const CRYPTO_TAG_ID = 21;
const MIN_SOL_LAMPORTS_PER_TRADE = 50_000_000;
const SOL_NETWORK_RESERVE_LAMPORTS = 5_000_000;

const HORIZONS = [
  { id: 'hourly', label: 'Hourly', slug: '15-min-crypto', maxMs: 2 * 60 * 60_000 },
  { id: 'daily', label: 'Daily', slug: 'daily-crypto', maxMs: 36 * 60 * 60_000 },
  { id: 'weekly', label: 'Weekly', slug: 'weekly-crypto', maxMs: 8 * 24 * 60 * 60_000 },
  { id: 'monthly', label: 'Monthly', slug: 'monthly-crypto', maxMs: 45 * 24 * 60 * 60_000 },
  { id: 'all', label: 'All', slug: null, maxMs: Infinity },
];

/* ============================================================ Debug log */

const DBG_MAX = 400;
const _dbgListeners = new Set();
function _emit(e) { for (const fn of _dbgListeners) { try { fn(e); } catch {} } }
function _redact(v) {
  if (typeof v !== 'object' || v == null) return v;
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) {
    if (/secret|passphrase|private|seed|mnemonic|api[_-]?key/i.test(k)) out[k] = '***';
    else out[k] = v[k];
  }
  return out;
}
function dbg(scope, msg, data) {
  const entry = { ts: Date.now(), scope, msg, data: data === undefined ? undefined : _redact(data) };
  try {
    if (typeof window !== 'undefined') {
      window.__predictDebug = window.__predictDebug || [];
      window.__predictDebug.push(entry);
      if (window.__predictDebug.length > DBG_MAX) window.__predictDebug.shift();
    }
  } catch {}
  try { console.log(`[predict:${scope}]`, msg, entry.data !== undefined ? entry.data : ''); } catch {}
  _emit(entry);
}
function dbgErr(scope, msg, err) {
  dbg(scope, 'ERROR: ' + msg, {
    name: err?.name, message: err?.message || String(err),
    code: err?.code, status: err?.status || err?.response?.status,
    body: err?.body || err?.response?.data || err?.data,
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
      force((x) => x + 1);
    };
    _dbgListeners.add(fn);
    return () => { _dbgListeners.delete(fn); };
  }, []);
  return ref.current;
}

/* ============================================================ Theme */

const C = {
  bg: '#03060f', card: '#080d1a', cardHi: '#0c1428',
  ink: '#e8ecf5', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no: '#ff5f7a', noDim: 'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow: '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body: { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono: { fontFamily: 'IBM Plex Mono, monospace' },
};

/* ============================================================ HTTP */

async function jfetch(url, opts = {}, ms = 12000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    const dur = Date.now() - t0;
    if (!r.ok) {
      let body = '';
      try { body = await r.text(); } catch {}
      dbg('http', `${opts.method || 'GET'} ${url} → ${r.status}`, { dur, body: body.slice(0, 500) });
      const err = new Error(`HTTP ${r.status}: ${body.slice(0, 300) || r.statusText}`);
      err.status = r.status; err.body = body;
      throw err;
    }
    dbg('http', `${opts.method || 'GET'} ${url} → ${r.status}`, { dur });
    return r;
  } finally { clearTimeout(id); }
}

/* ============================================================ Format */

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
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
function shortAddr(a) {
  if (!a) return '';
  return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
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

/* ============================================================ Storage */

const SCHEMA_VERSION = 5;
const SCHEMA_KEY = 'pm_schema_v';
(function migrateSchema() {
  try {
    const current = parseInt(localStorage.getItem(SCHEMA_KEY) || '0', 10);
    if (current === SCHEMA_VERSION) return;
    const toDel = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pm_') && k !== SCHEMA_KEY) toDel.push(k);
    }
    toDel.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
    dbg('migrate', `cache schema ${current} → ${SCHEMA_VERSION}, purged ${toDel.length} keys`);
  } catch (e) { dbgErr('migrate', 'failed', e); }
})();

const LS = {
  safe: (evm) => 'pm_safe_' + evm.toLowerCase(),
  bridgeAddr: (evm) => 'pm_br_addrs_' + evm.toLowerCase(),
  evmRdns: 'pm_evm_rdns',
};
const SS = { creds: (evm) => 'pm_creds_' + evm.toLowerCase() };
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }
function lsGetJson(k) {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; }
}
function lsSetJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function ssGetJson(k) {
  try { const r = sessionStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; }
}
function ssSetJson(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch {} }
function wipeUserCache(evm) {
  if (!evm) return;
  lsDel(LS.safe(evm));
  lsDel(LS.bridgeAddr(evm));
  ssDel(SS.creds(evm));
  dbg('cache', 'wiped for ' + evm);
}

/* ============================================================ EIP-6963 discovery */

function useDiscoveredEvmWallets() {
  const [wallets, setWallets] = useState([]);
  const seenRef = useRef(new Set());
  useEffect(() => {
    const onAnnounce = (event) => {
      const detail = event.detail;
      if (!detail || !detail.info || !detail.provider) return;
      const rdns = detail.info.rdns || detail.info.name;
      if (!rdns || seenRef.current.has(rdns)) return;
      seenRef.current.add(rdns);
      setWallets((prev) => [...prev, detail]);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const fallbackTimer = setTimeout(() => {
      if (seenRef.current.size === 0 && window.ethereum) {
        const legacy = {
          info: { uuid: 'legacy', name: 'Browser Wallet', rdns: 'legacy.ethereum', icon: '' },
          provider: window.ethereum,
        };
        seenRef.current.add('legacy.ethereum');
        setWallets([legacy]);
      }
    }, 400);
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(fallbackTimer);
    };
  }, []);
  return wallets;
}

/* ============================================================ EVM wallet state */

function useEvmWallet() {
  const wallets = useDiscoveredEvmWallets();
  const [provider, setProvider] = useState(null);
  const [address, setAddress] = useState(null);
  const [rdns, setRdns] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Auto-reconnect previously-used wallet
  useEffect(() => {
    if (provider || wallets.length === 0) return;
    const lastRdns = lsGet(LS.evmRdns);
    if (!lastRdns) return;
    const match = wallets.find((w) => w.info.rdns === lastRdns);
    if (!match) return;
    (async () => {
      try {
        const accounts = await match.provider.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          setProvider(match.provider);
          setAddress(accounts[0]);
          setRdns(match.info.rdns);
          dbg('evm', 'auto-reconnected', { rdns: match.info.rdns, address: accounts[0] });
        }
      } catch (e) { dbgErr('evm', 'auto-reconnect failed', e); }
    })();
  }, [wallets, provider]);

  // Listen for account/chain changes
  useEffect(() => {
    if (!provider) return;
    const onAccounts = (accs) => {
      if (!accs || accs.length === 0) {
        setAddress(null); setProvider(null); setRdns(null);
        lsDel(LS.evmRdns);
        dbg('evm', 'disconnected via event');
      } else {
        setAddress(accs[0]);
        dbg('evm', 'account changed', { address: accs[0] });
      }
    };
    const onChain = (chainId) => dbg('evm', 'chain changed', { chainId });
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [provider]);

  const connect = useCallback(async (walletDetail) => {
    setConnecting(true);
    try {
      const p = walletDetail.provider;
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No account returned');
      // Switch to Polygon
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: POLYGON_CHAIN_HEX }],
        });
      } catch (switchErr) {
        if (switchErr?.code === 4902) {
          await p.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: POLYGON_CHAIN_HEX,
              chainName: 'Polygon',
              nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
              rpcUrls: ['https://polygon-rpc.com'],
              blockExplorerUrls: ['https://polygonscan.com'],
            }],
          });
        } else {
          dbgErr('evm', 'chain switch failed (non-fatal)', switchErr);
        }
      }
      setProvider(p);
      setAddress(accounts[0]);
      setRdns(walletDetail.info.rdns);
      lsSet(LS.evmRdns, walletDetail.info.rdns);
      dbg('evm', 'connected', { rdns: walletDetail.info.rdns, address: accounts[0] });
      setPickerOpen(false);
    } catch (e) {
      dbgErr('evm', 'connect failed', e);
      throw e;
    } finally { setConnecting(false); }
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null); setAddress(null); setRdns(null);
    lsDel(LS.evmRdns);
    dbg('evm', 'disconnected manually');
  }, []);

  return { wallets, provider, address, rdns, pickerOpen, setPickerOpen, connect, disconnect, connecting };
}

/* ============================================================ SDK loaders */

let _sdks = null;
async function loadSdks() {
  if (_sdks) return _sdks;
  dbg('sdk', 'loading');
  const [clob, relayer, derive, config, viem, viemChains] = await Promise.all([
    import('@polymarket/clob-client'),
    import('@polymarket/builder-relayer-client'),
    import('@polymarket/builder-relayer-client/dist/builder/derive'),
    import('@polymarket/builder-relayer-client/dist/config'),
    import('viem'),
    import('viem/chains'),
  ]);
  _sdks = { clob, relayer, derive, config, viem, viemChains };
  dbg('sdk', 'loaded');
  return _sdks;
}

async function buildSigner(evmProvider, evmAddress) {
  const { viem, viemChains } = await loadSdks();
  if (!evmProvider) throw new Error('EVM provider not connected');
  if (!evmAddress) throw new Error('No EVM address');
  return viem.createWalletClient({
    account: evmAddress,
    chain: viemChains.polygon,
    transport: viem.custom(evmProvider),
  });
}

async function buildRelayClient(evmProvider, evmAddress) {
  const { relayer } = await loadSdks();
  if (!relayer?.RelayClient) throw new Error('RelayClient missing');
  const signer = await buildSigner(evmProvider, evmAddress);
  // NO builderConfig - basic Safe deploy and approvals sign locally via the
  // wallet's EIP-712. The remote builder URL was failing because /api/poly/sign
  // isn't a Polymarket builder endpoint, it was breaking everything.
  return new relayer.RelayClient(RELAYER_URL + '/', POLYGON_CHAIN_ID, signer);
}

/* ============================================================ Polygon RPC */

async function rpc(method, params, ms = 8000) {
  let lastErr;
  for (const url of POLYGON_RPCS) {
    try {
      const r = await jfetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      }, ms);
      const j = await r.json();
      if (j.error) { lastErr = new Error(`RPC ${method}: ${j.error.message}`); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All Polygon RPCs failed');
}

async function ethGetCode(address) {
  try {
    const hex = await rpc('eth_getCode', [address, 'latest']);
    return hex && hex !== '0x' ? hex : null;
  } catch (e) { dbgErr('rpc', 'eth_getCode failed', e); return null; }
}
async function ethCallBalance(token, holder) {
  try {
    const addr = holder.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0x70a08231' + addr;
    const hex = await rpc('eth_call', [{ to: token, data }, 'latest']);
    if (!hex || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);
  } catch { return 0n; }
}
async function ethCallAllowance(token, owner, spender) {
  try {
    const o = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0xdd62ed3e' + o + s;
    const hex = await rpc('eth_call', [{ to: token, data }, 'latest']);
    if (!hex || !hex.startsWith('0x')) return 0n;
    return BigInt(hex);
  } catch { return 0n; }
}
async function ethCallIsApprovedForAll(token, owner, operator) {
  try {
    const o = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const op = operator.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const data = '0xe985e9c5' + o + op;
    const hex = await rpc('eth_call', [{ to: token, data }, 'latest']);
    if (!hex || !hex.startsWith('0x')) return false;
    return BigInt(hex) === 1n;
  } catch { return false; }
}
async function fetchSafeBalance(safe) {
  if (!safe) return 0n;
  return await ethCallBalance(USDC_E_ADDRESS, safe);
}

/* ============================================================ Safe setup */

async function deriveSafeAddress(eoa) {
  const { derive, config } = await loadSdks();
  if (!derive?.deriveSafe) throw new Error('deriveSafe missing');
  const cfg = config.getContractConfig(POLYGON_CHAIN_ID);
  const factory = cfg?.SafeContracts?.SafeFactory || cfg?.SafeFactory;
  if (!factory) throw new Error('Safe factory missing');
  const safe = derive.deriveSafe(eoa, factory);
  dbg('safe', 'derived', { eoa, safe });
  return safe;
}

async function verifySafeDeployed(safeAddress) {
  const code = await ethGetCode(safeAddress);
  const isDeployed = !!code;
  dbg('verify', 'safe deployed', { safeAddress, isDeployed });
  return isDeployed;
}

async function verifyApprovals(safeAddress) {
  const MIN_OK = 1n << 200n;
  const [a1, a2, a3, a4, ia1, ia2, ia3] = await Promise.all([
    ethCallAllowance(USDC_E_ADDRESS, safeAddress, CTF_EXCHANGE),
    ethCallAllowance(USDC_E_ADDRESS, safeAddress, NEG_RISK_CTF_EXCHANGE),
    ethCallAllowance(USDC_E_ADDRESS, safeAddress, NEG_RISK_ADAPTER),
    ethCallAllowance(USDC_E_ADDRESS, safeAddress, CONDITIONAL_TOKENS),
    ethCallIsApprovedForAll(CONDITIONAL_TOKENS, safeAddress, CTF_EXCHANGE),
    ethCallIsApprovedForAll(CONDITIONAL_TOKENS, safeAddress, NEG_RISK_CTF_EXCHANGE),
    ethCallIsApprovedForAll(CONDITIONAL_TOKENS, safeAddress, NEG_RISK_ADAPTER),
  ]);
  const checks = {
    usdc_ctf: a1 >= MIN_OK, usdc_neg: a2 >= MIN_OK,
    usdc_adp: a3 >= MIN_OK, usdc_con: a4 >= MIN_OK,
    ctf_ctf: ia1, ctf_neg: ia2, ctf_adp: ia3,
  };
  const ok = Object.values(checks).every(Boolean);
  dbg('verify', 'approvals', { safeAddress, ok, checks });
  return ok;
}

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
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(CTF_EXCHANGE, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(NEG_RISK_CTF_EXCHANGE, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(NEG_RISK_ADAPTER, MAX_UINT256.toString()) },
    { to: USDC_E_ADDRESS, value: '0', data: encErc20Approve(CONDITIONAL_TOKENS, MAX_UINT256.toString()) },
    { to: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(CTF_EXCHANGE, true) },
    { to: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_CTF_EXCHANGE, true) },
    { to: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_ADAPTER, true) },
  ];
}

async function ensureSafeDeployed(evm, evmProvider, onStatus) {
  let safe = lsGet(LS.safe(evm));
  if (!safe) { safe = await deriveSafeAddress(evm); lsSet(LS.safe(evm), safe); }
  const alreadyDeployed = await verifySafeDeployed(safe);
  if (alreadyDeployed) return safe;
  onStatus?.('Deploying Safe (sign in your wallet)…');
  const relay = await buildRelayClient(evmProvider, evm);
  const resp = await relay.deploy();
  const res = await resp.wait();
  const final = res?.proxyAddress || safe;
  lsSet(LS.safe(evm), final);
  const verified = await verifySafeDeployed(final);
  if (!verified) throw new Error('Safe deploy tx ran but eth_getCode shows no contract');
  dbg('safe', 'deployed + verified', { safe: final });
  return final;
}

async function ensureApprovals(evm, evmProvider, safeAddress, onStatus) {
  const alreadyOk = await verifyApprovals(safeAddress);
  if (alreadyOk) return;
  onStatus?.('Approving contracts (sign in your wallet)…');
  const relay = await buildRelayClient(evmProvider, evm);
  if (typeof relay.execute !== 'function') throw new Error('relay.execute missing');
  const txs = buildApprovalTxs();
  const resp = await relay.execute(txs, 'Polymarket trading approvals');
  await resp.wait();
  const verified = await verifyApprovals(safeAddress);
  if (!verified) throw new Error('Approval txs ran but verification failed');
  dbg('approvals', 'done + verified');
}

async function getOrDeriveCreds(evm, evmProvider) {
  const cached = ssGetJson(SS.creds(evm));
  if (cached?.key && cached?.secret && cached?.passphrase) return cached;
  const { clob } = await loadSdks();
  const signer = await buildSigner(evmProvider, evm);
  const temp = new clob.ClobClient(CLOB_URL, POLYGON_CHAIN_ID, signer);
  let creds;
  try { creds = await temp.createOrDeriveApiKey(); }
  catch (e) {
    dbgErr('creds', 'createOrDeriveApiKey failed, trying deriveApiKey', e);
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
  if (!norm.key || !norm.secret || !norm.passphrase) throw new Error('Incomplete creds');
  ssSetJson(SS.creds(evm), norm);
  dbg('creds', 'stored');
  return norm;
}

async function buildClobClient(evmProvider, evmAddress, safeAddress, creds) {
  const { clob } = await loadSdks();
  const signer = await buildSigner(evmProvider, evmAddress);
  // signatureType 2 = GNOSIS_SAFE (funder is the Safe, signer is the EOA owner)
  return new clob.ClobClient(
    CLOB_URL, POLYGON_CHAIN_ID, signer, creds, 2, safeAddress
  );
}

async function ensureSetup(evm, evmProvider, onStatus) {
  dbg('setup', 'start', { evm });
  const safe = await ensureSafeDeployed(evm, evmProvider, onStatus);
  const creds = await getOrDeriveCreds(evm, evmProvider);
  await ensureApprovals(evm, evmProvider, safe, onStatus);
  dbg('setup', 'done', { safe });
  return { safeAddress: safe, creds };
}

/* ============================================================ Bridge */

async function fetchBridgeAddresses(safe) {
  const r = await jfetch(BRIDGE_DEPOSIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: safe }),
  }, 15000);
  const j = await r.json();
  dbg('bridge', 'addresses', j);
  const a = j.address && typeof j.address === 'object' ? j.address : j;
  return {
    evm: a.evm || a.evmAddress || a.evm_address || null,
    svm: a.svm || a.svmAddress || a.svm_address || null,
  };
}
async function getBridgeAddressesCached(evm, safe) {
  const cached = lsGetJson(LS.bridgeAddr(evm));
  const valid = cached && typeof cached.svm === 'string' && cached.svm.length >= 32 &&
    typeof cached.evm === 'string' && cached.evm.startsWith('0x');
  if (valid) return cached;
  if (cached) { dbg('bridge', 'purging bad cache', cached); lsDel(LS.bridgeAddr(evm)); }
  const addrs = await fetchBridgeAddresses(safe);
  if (addrs.svm && addrs.evm) lsSetJson(LS.bridgeAddr(evm), addrs);
  return addrs;
}
async function fetchBridgeStatus(statusAddress) {
  try {
    const r = await jfetch(`${BRIDGE_STATUS}/${encodeURIComponent(statusAddress)}`, {}, 8000);
    return await r.json();
  } catch { return null; }
}
async function waitForBridge(statusAddress, sourceSig, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const s = await fetchBridgeStatus(statusAddress);
      const arr = Array.isArray(s?.transactions) ? s.transactions
        : Array.isArray(s?.deposits) ? s.deposits
          : Array.isArray(s) ? s : [];
      const hit = arr.find((d) => {
        const status = String(d.status || d.state || d.bridgeStatus || '').toUpperCase();
        return d.txHash === sourceSig || d.sourceTxHash === sourceSig || d.sigSrc === sourceSig ||
          status === 'COMPLETED' || status === 'CONFIRMED' || status === 'SUCCESS';
      });
      if (hit) { dbg('bridge', 'completed', hit); return true; }
    } catch {}
    await new Promise((r) => setTimeout(r, 2500));
  }
  dbg('bridge', 'wait timed out');
  return false;
}

/* ============================================================ Solana balances */

async function fetchSolanaSolBalance(ownerB58) {
  try {
    const r = await jfetch(SOL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getBalance',
        params: [ownerB58, { commitment: 'confirmed' }],
      }),
    }, 6000);
    const j = await r.json();
    return j?.result?.value ? BigInt(j.result.value) : 0n;
  } catch { return 0n; }
}

/* ============================================================ SOL deposit tx */

async function buildSolDepositTx({ ownerB58, bridgeSvm, totalLamports, connection }) {
  const owner = new PublicKey(ownerB58);
  const bridge = new PublicKey(bridgeSvm);
  const fee = new PublicKey(FEE_WALLET_SOL);
  const total = BigInt(totalLamports);
  const feeAmt = (total * FEE_BPS) / 10000n;
  const sendAmt = total - feeAmt;
  if (sendAmt <= 0n) throw new Error('Deposit amount too small after fee');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: owner });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: bridge, lamports: Number(sendAmt) }));
  tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: fee, lamports: Number(feeAmt) }));
  dbg('deposit-sol', 'tx built', {
    total: total.toString(), sendAmt: sendAmt.toString(), feeAmt: feeAmt.toString(),
    bridgeSvm, blockhash, lastValidBlockHeight,
  });
  return { tx, sendAmt, feeAmt, lastValidBlockHeight };
}

/* ============================================================ Sim → sign → submit */

async function simulateSignSubmit({ tx, signTransaction, connection, onStatus, label = 'transaction' }) {
  onStatus?.(`Simulating ${label}…`);
  let simResult;
  try {
    simResult = await connection.simulateTransaction(tx, undefined, false);
  } catch (e) {
    dbgErr('sim', `${label} simulate threw`, e);
    throw new Error(`Could not simulate ${label}: ${e?.message || 'unknown'}`);
  }
  dbg('sim', `${label} result`, {
    err: simResult?.value?.err,
    logs: simResult?.value?.logs?.slice(0, 12),
    unitsConsumed: simResult?.value?.unitsConsumed,
  });
  if (simResult?.value?.err) {
    const errStr = JSON.stringify(simResult.value.err);
    const logs = (simResult.value.logs || []).slice(-3).join(' | ');
    throw new Error(`Simulation failed: ${errStr}${logs ? ' — ' + logs : ''}`);
  }
  onStatus?.(`Confirm ${label} in your wallet…`);
  const signed = await signTransaction(tx);
  onStatus?.(`Submitting ${label}…`);
  const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw, {
    skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3,
  });
  dbg('submit', `${label} sent`, { sig });
  return { sig, signed };
}

/* ============================================================ Markets */

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
  try { outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices || []; } catch {}
  let clobTokenIds = [];
  try { clobTokenIds = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds || []; } catch {}
  const yesPrice = Number(outcomePrices[0] || m.lastTradePrice || 0);
  const noPrice = Number(outcomePrices[1] || 1 - yesPrice);
  return {
    id: ev.id, slug: ev.slug,
    title: ev.title || m.question || 'Untitled',
    childQuestion: ms.length > 1 ? m.question || m.groupItemTitle || null : null,
    image: ev.image || ev.icon || m.image || null,
    volume24h: Number(ev.volume24hr || m.volume24hr || 0),
    liquidity: Number(ev.liquidity || m.liquidity || 0),
    endDate: ev.endDate || m.endDate || null,
    yesPrice, noPrice,
    yesPct: Math.round(yesPrice * 100), noPct: Math.round(noPrice * 100),
    marketCount: ms.length,
    conditionId: m.conditionId, clobTokenIds,
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

/* ============================================================ CLOB orders */

async function placeMarketOrder({ evmProvider, evmAddress, safeAddress, creds, market, side, amountUsd, isBuy }) {
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error('Token ID missing');
  const { clob } = await loadSdks();
  const Side = clob.Side || { BUY: 'BUY', SELL: 'SELL' };
  const OrderType = clob.OrderType || { FOK: 'FOK', FAK: 'FAK', GTC: 'GTC' };
  const client = await buildClobClient(evmProvider, evmAddress, safeAddress, creds);
  const price = side === 'yes' ? Number(market.yesPrice) : Number(market.noPrice);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) throw new Error('Invalid market price');
  const orderArgs = {
    tokenID: String(tokenId), price,
    size: isBuy ? amountUsd / price : amountUsd,
    side: isBuy ? Side.BUY : Side.SELL,
    feeRateBps: 0, expiration: 0,
    taker: '0x0000000000000000000000000000000000000000',
  };
  const opts = { tickSize: market.tickSize || '0.01', negRisk: !!market.negRisk };
  dbg('order', 'submitting', { side, isBuy, amount: amountUsd, price, safeAddress });
  const type = OrderType.FAK || OrderType.FOK || OrderType.GTC;
  const resp = await client.createAndPostOrder(orderArgs, opts, type);
  if (resp?.error || resp?.errorMsg) throw new Error(resp.error || resp.errorMsg);
  if (resp?.success === false) throw new Error(resp?.errorMsg || 'Order rejected');
  dbg('order', 'placed', resp);
  return resp;
}

async function fetchPositions(safe, conditionId, clobTokenIds) {
  try {
    const r = await fetch(`${DATA_API_URL}/positions?user=${safe.toLowerCase()}&market=${conditionId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)) return null;
    const [yesTid, noTid] = clobTokenIds || [];
    let yPos = null, nPos = null;
    for (const p of data) {
      const tid = String(p.asset || p.tokenId || p.token_id || '');
      if (yesTid && tid === String(yesTid)) yPos = p;
      if (noTid && tid === String(noTid)) nPos = p;
    }
    const sz = (p) => p ? Number(p.size || p.shares || p.balance || 0) : 0;
    const av = (p) => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;
    return {
      sharesYes: sz(yPos), sharesNo: sz(nPos),
      avgPriceYes: av(yPos), avgPriceNo: av(nPos),
    };
  } catch { return null; }
}

async function fetchBestBid(tokenId) {
  try {
    const r = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
    if (!r.ok) return 0;
    const d = await r.json();
    const bids = d?.bids || [];
    let best = 0;
    for (const b of bids) { const p = Number(b.price || b.p || 0); if (p > best) best = p; }
    return best;
  } catch { return 0; }
}

/* ============================================================ Withdraw */

async function requestWithdrawToSolana({ safe, solanaAddress, amountAtomic, onStatus }) {
  onStatus?.('Initiating withdrawal…');
  const body = {
    from: safe, to: solanaAddress, chain: 'solana',
    asset: 'USDC', amount: amountAtomic.toString(),
  };
  const r = await jfetch(BRIDGE_WITHDRAW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 20000);
  const j = await r.json();
  if (j?.error) throw new Error(j.error);
  dbg('withdraw', 'submitted', j);
  return j;
}

/* ============================================================ UI bits */

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
  const np = Number(market.noPrice) || 0;
  const upside = (p) => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' };
  return (
    <div style={{ padding: 10, borderRadius: 13, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 7, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {image && <img src={image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.25, marginBottom: childQuestion ? 2 : 3, ...T.body, ...clamp2 }}>{title}</div>
          {childQuestion && <div style={{ fontSize: 10, fontWeight: 600, color: C.hl, marginBottom: 3, ...T.body, ...clamp2 }}>{childQuestion}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 9, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && <><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>}
            {marketCount > 1 && <><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 38 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 8, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '7px 8px', borderRadius: 9, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>Yes · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 9, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}%</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '7px 8px', borderRadius: 9, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>No · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 9, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}%</span>}
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
      const t = log.map((e) => `${new Date(e.ts).toISOString().slice(11, 23)} [${e.scope}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n');
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
          {log.length === 0 ? <div style={{ color: C.muted2, fontStyle: 'italic' }}>No entries yet.</div> : log.map((e, i) => {
            const isErr = String(e.msg).startsWith('ERROR');
            return (
              <div key={i} style={{ color: isErr ? C.no : C.ink, marginBottom: 2, wordBreak: 'break-word' }}>
                <span style={{ color: C.muted2 }}>{new Date(e.ts).toISOString().slice(11, 23)}</span>{' '}
                <span style={{ color: C.hl, fontWeight: 700 }}>[{e.scope}]</span> {e.msg}
                {e.data !== undefined && <span style={{ color: C.muted, fontSize: 9 }}> {JSON.stringify(e.data).slice(0, 220)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusLine({ msg }) {
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
      <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{msg}</span>
    </div>
  );
}

function ErrorLine({ msg }) {
  return <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>{msg}</div>;
}

function PrimaryButton({ onClick, disabled, label }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ width: '100%', padding: 12, borderRadius: 11, background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`, color: C.bg, fontWeight: 800, fontSize: 14, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...T.body }}>
      {label}
    </button>
  );
}

/* ============================================================ EVM wallet picker modal */

function EvmWalletPicker({ open, wallets, onPick, onClose, connecting }) {
  if (!open) return null;
  const sorted = [...wallets].sort((a, b) => {
    const order = { 'io.metamask': 0, 'app.phantom': 1, 'io.rabby': 2, 'com.coinbase.wallet': 3 };
    return (order[a.info.rdns] ?? 99) - (order[b.info.rdns] ?? 99);
  });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(3,6,15,.78)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '94vw', maxWidth: 380, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, border: `1px solid ${C.borderHi}`, borderRadius: 18, padding: 18, boxShadow: C.shadowLg, ...T.body }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, marginBottom: 4, ...T.display }}>Connect EVM wallet</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Polymarket trades on Polygon. Choose your wallet to sign orders.</div>
        {sorted.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12 }}>
            No EVM wallets detected. Install MetaMask, Rabby, or Phantom (with EVM mode) and reload.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map((w) => (
              <button key={w.info.rdns || w.info.uuid} onClick={() => !connecting && onPick(w)} disabled={connecting}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 11, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, color: C.ink, cursor: connecting ? 'wait' : 'pointer', textAlign: 'left' }}>
                {w.info.icon
                  ? <img src={w.info.icon} alt="" style={{ width: 28, height: 28, borderRadius: 6 }} />
                  : <div style={{ width: 28, height: 28, borderRadius: 6, background: C.hlDim }} />}
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{w.info.name}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} style={{ marginTop: 14, width: '100%', padding: 10, borderRadius: 10, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', ...T.mono }}>Cancel</button>
      </div>
    </div>
  );
}

/* ============================================================ Funding sheet */

function FundingSheet({
  open, onClose,
  evmAddress, safeAddress, tradingBalance,
  solanaAddress, solBalance,
  onCollectWinnings, collectStatus, collectStatusMsg, collectError,
  setupStatus, setupError, onRetrySetup, onReset,
  onDisconnectEvm, onDisconnectSol,
}) {
  const [tab, setTab] = useState('receive');
  const [withdrawSolAddr, setWithdrawSolAddr] = useState('');
  const [withdrawUsd, setWithdrawUsd] = useState('');
  const [copied, setCopied] = useState('');
  const [dbgOpen, setDbgOpen] = useState(false);
  useBodyLock(open);
  useEffect(() => {
    if (open && solanaAddress && !withdrawSolAddr) setWithdrawSolAddr(solanaAddress);
  }, [open, solanaAddress, withdrawSolAddr]);
  if (!open) return null;
  const tradeUsd = Number(tradingBalance) / 1e6;
  const solUi = Number(solBalance) / 1e9;
  const usd = Number(withdrawUsd) || 0;
  const handleCopy = async (text, kind) => {
    const ok = await copyToClipboard(text);
    if (ok) { setCopied(kind); setTimeout(() => setCopied(''), 1500); }
  };
  const busy = collectStatus === 'working' || setupStatus === 'working';
  const handleWithdraw = () => {
    if (!safeAddress || !withdrawSolAddr || withdrawSolAddr.length < 32) return;
    if (usd < 1 || usd > tradeUsd) return;
    const amountAtomic = BigInt(Math.floor(usd * 1e6));
    onCollectWinnings?.({ solanaAddress: withdrawSolAddr, amountAtomic });
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 4, ...T.display }}>Account</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 4, ...T.body }}>SOL wallet: <span style={{ color: C.hl, fontWeight: 700 }}>{solUi.toFixed(4)} SOL</span></div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, ...T.body }}>In Polymarket: <span style={{ color: C.hl, fontWeight: 700 }}>{fmtUsd(tradeUsd, 2)} USDC</span></div>
        <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen((o) => !o)} />
        {setupStatus === 'error' && setupError && (
          <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: 'rgba(255,95,122,.07)', border: `1px solid ${C.no}33` }}>
            <div style={{ fontSize: 11, color: C.no, fontWeight: 700, marginBottom: 4 }}>Polymarket Safe setup failed</div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, ...T.mono, wordBreak: 'break-word' }}>{setupError}</div>
            <button onClick={onRetrySetup} style={{ padding: '6px 12px', borderRadius: 8, background: C.no + '22', border: `1px solid ${C.no}55`, color: C.no, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>↻ Retry setup</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, padding: 3, background: 'rgba(255,255,255,.03)', borderRadius: 10 }}>
          {[
            { id: 'receive', label: 'Wallets' },
            { id: 'collect', label: 'Collect' },
            { id: 'addr', label: 'Safe' },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, background: tab === t.id ? C.hlDim : 'transparent', border: `1px solid ${tab === t.id ? C.borderHi : 'transparent'}`, color: tab === t.id ? C.hl : C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>{t.label}</button>
          ))}
        </div>

        {tab === 'receive' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, marginBottom: 8, ...T.display }}>SOLANA WALLET</div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', marginBottom: 8 }}>{solanaAddress || 'Not connected'}</div>
            {solanaAddress && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                <button onClick={() => handleCopy(solanaAddress, 'sol')} style={{ flex: 1, padding: 8, borderRadius: 8, background: copied === 'sol' ? C.yesDim : C.hlDim, border: `1px solid ${copied === 'sol' ? C.yes + '55' : C.borderHi}`, color: copied === 'sol' ? C.yes : C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>{copied === 'sol' ? '✓ Copied' : 'Copy'}</button>
                <button onClick={onDisconnectSol} style={{ flex: 1, padding: 8, borderRadius: 8, background: 'transparent', border: `1px solid ${C.no}33`, color: C.no, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>Disconnect</button>
              </div>
            )}
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, marginBottom: 8, ...T.display }}>EVM WALLET (POLYGON)</div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', marginBottom: 8 }}>{evmAddress || 'Not connected'}</div>
            {evmAddress && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleCopy(evmAddress, 'evm')} style={{ flex: 1, padding: 8, borderRadius: 8, background: copied === 'evm' ? C.yesDim : C.hlDim, border: `1px solid ${copied === 'evm' ? C.yes + '55' : C.borderHi}`, color: copied === 'evm' ? C.yes : C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>{copied === 'evm' ? '✓ Copied' : 'Copy'}</button>
                <button onClick={onDisconnectEvm} style={{ flex: 1, padding: 8, borderRadius: 8, background: 'transparent', border: `1px solid ${C.no}33`, color: C.no, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>Disconnect</button>
              </div>
            )}
            <div style={{ fontSize: 10, color: C.muted2, marginTop: 10, ...T.mono }}>Send SOL to your Solana wallet. On Buy, 5% fee is taken and 95% goes to Polymarket.</div>
          </div>
        )}

        {tab === 'collect' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, ...T.display }}>COLLECT WINNINGS</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(tradeUsd, 2)} available</div>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.muted2, marginBottom: 2, ...T.mono }}>SOLANA ADDRESS</div>
              <input value={withdrawSolAddr} onChange={(e) => setWithdrawSolAddr(e.target.value.trim())} disabled={busy} placeholder="Solana address…" style={{ width: '100%', background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 11, ...T.mono }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
              <span style={{ fontSize: 18, color: C.muted, ...T.display }}>$</span>
              <input value={withdrawUsd} onChange={(e) => setWithdrawUsd(cleanAmount(e.target.value))} disabled={busy} inputMode="decimal" placeholder="0.00" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 20, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
            </div>
            <button onClick={() => setWithdrawUsd(String(Math.floor(tradeUsd * 100) / 100))} disabled={busy || tradeUsd <= 0} style={{ width: '100%', padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginBottom: 10, ...T.mono }}>Max</button>
            {collectStatusMsg && <StatusLine msg={collectStatusMsg} />}
            {collectError && <ErrorLine msg={collectError} />}
            {collectStatus === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>✓ Withdrawal submitted — funds arrive in 2-5 min</div>}
            <PrimaryButton onClick={handleWithdraw} disabled={busy || usd < 1 || usd > tradeUsd || !withdrawSolAddr} label={busy ? 'Working…' : `Withdraw ${fmtUsd(usd, 2)}`} />
          </div>
        )}

        {tab === 'addr' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, marginBottom: 8, ...T.display }}>POLYMARKET SAFE (POLYGON)</div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', marginBottom: 10 }}>{safeAddress || 'Connect EVM wallet first'}</div>
            {safeAddress && (
              <button onClick={() => handleCopy(safeAddress, 'safe')} style={{ width: '100%', padding: 10, borderRadius: 10, background: copied === 'safe' ? C.yesDim : C.hlDim, border: `1px solid ${copied === 'safe' ? C.yes + '55' : C.borderHi}`, color: copied === 'safe' ? C.yes : C.hl, fontSize: 12, fontWeight: 700, cursor: 'pointer', ...T.mono }}>{copied === 'safe' ? '✓ Copied' : 'Copy Safe address'}</button>
            )}
          </div>
        )}

        <button onClick={onReset} style={{ width: '100%', padding: 10, borderRadius: 10, background: 'rgba(255,95,122,.05)', border: `1px solid ${C.no}33`, color: C.no, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 6, ...T.mono }}>↻ Reset Polymarket account (if stuck)</button>
      </div>
    </div>
  );
}

/* ============================================================ Order drawer */

function OrderDrawer({
  market, side, onClose,
  evmAddress, evmProvider, safeAddress, creds,
  solBalance, solanaAddress,
  signSolanaTx, solConnection,
  refreshAll,
}) {
  const [amountSol, setAmountSol] = useState('0.05');
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
          fetchPositions(safeAddress, market.conditionId, market.clobTokenIds),
          fetchBestBid(market.clobTokenIds[0]),
          fetchBestBid(market.clobTokenIds[1]),
        ]);
        if (!alive) return;
        if (p) setPos(p);
        setBids({ yes: yb, no: nb });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [market, safeAddress]);
  if (!market) return null;
  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  const sol = Number(amountSol) || 0;
  const solLamports = BigInt(Math.floor(sol * 1e9));
  const sideColor = side === 'yes' ? C.yes : C.no;
  const sideDim = side === 'yes' ? C.yesDim : C.noDim;
  const solUi = Number(solBalance) / 1e9;
  const solAvailableLamports = Math.max(0, Number(solBalance) - SOL_NETWORK_RESERVE_LAMPORTS);
  const solAvailableUi = solAvailableLamports / 1e9;
  const held = side === 'yes' ? Number(pos?.sharesYes || 0) : Number(pos?.sharesNo || 0);
  const avgPx = side === 'yes' ? Number(pos?.avgPriceYes || 0) : Number(pos?.avgPriceNo || 0);
  const bid = side === 'yes' ? bids.yes : bids.no;
  const value = held * bid;
  const cost = held * avgPx;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const hasPos = held > 0.01;
  const busy = status === 'working' || sellStatus === 'selling';

  const handleBuy = async () => {
    if (busy) return;
    if (!solanaAddress || !safeAddress || !creds) { setError('Wallets not ready'); return; }
    if (sol <= 0) { setError('Enter a SOL amount'); return; }
    if (Number(solLamports) > solAvailableLamports) { setError(`Not enough SOL. Available: ${solAvailableUi.toFixed(4)}`); return; }
    if (Number(solLamports) < MIN_SOL_LAMPORTS_PER_TRADE) { setError(`Min ${(MIN_SOL_LAMPORTS_PER_TRADE / 1e9).toFixed(3)} SOL`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      setStatusMsg('Getting bridge address…');
      const addrs = await getBridgeAddressesCached(evmAddress, safeAddress);
      if (!addrs.svm) throw new Error('No SVM bridge address');
      const balanceBefore = await fetchSafeBalance(safeAddress);
      dbg('buy', 'starting', { solLamports: solLamports.toString(), safeBalanceBefore: balanceBefore.toString(), side });
      const { tx } = await buildSolDepositTx({
        ownerB58: solanaAddress, bridgeSvm: addrs.svm,
        totalLamports: solLamports, connection: solConnection,
      });
      const { sig } = await simulateSignSubmit({
        tx, signTransaction: signSolanaTx, connection: solConnection,
        onStatus: setStatusMsg, label: 'SOL deposit',
      });
      setStatusMsg('Bridging SOL → USDC.e (~30-60s)…');
      const bridged = await waitForBridge(addrs.svm, sig, 120_000);
      if (!bridged) dbg('buy', 'bridge timeout, will poll balance', { sig });
      setStatusMsg('Confirming USDC.e in Safe…');
      let balanceAfter = balanceBefore;
      const pollDeadline = Date.now() + 90_000;
      while (Date.now() < pollDeadline) {
        balanceAfter = await fetchSafeBalance(safeAddress);
        if (balanceAfter > balanceBefore) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      const usdcArrived = balanceAfter - balanceBefore;
      if (usdcArrived <= 0n) throw new Error('USDC.e did not arrive in Safe in time. Tx hash: ' + sig);
      const orderUsd = Number(usdcArrived) / 1e6;
      dbg('buy', 'usdc arrived, placing order', { usdcArrived: usdcArrived.toString(), orderUsd });
      setStatusMsg(`Placing trade for ${fmtUsd(orderUsd, 2)}…`);
      await placeMarketOrder({
        evmProvider, evmAddress, safeAddress, creds,
        market, side, amountUsd: orderUsd, isBuy: true,
      });
      setStatus('success'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2500);
    } catch (e) {
      const m = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 6000);
    }
  };

  const handleSell = async () => {
    if (!hasPos || busy) return;
    setSellStatus('selling'); setError(''); setStatusMsg('');
    try {
      setStatusMsg('Placing sell order…');
      await placeMarketOrder({
        evmProvider, evmAddress, safeAddress, creds,
        market, side, amountUsd: held, isBuy: false,
      });
      setSellStatus('sold'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setSellStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setSellStatus('idle'), 5000);
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, boxShadow: C.shadowLg, maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>{solUi.toFixed(4)} SOL</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px' }}>
          <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen((o) => !o)} />
          {hasPos && sellStatus !== 'sold' && (
            <div style={{ marginBottom: 14, padding: 14, borderRadius: 12, background: pnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${pnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
              <div style={{ fontSize: 10, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, marginBottom: 10, ...T.mono }}>YOUR POSITION · {side.toUpperCase()}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, ...T.mono }}><span style={{ color: C.muted }}>Shares</span><span style={{ color: C.ink, fontWeight: 700 }}>{held.toFixed(2)} @ ${avgPx.toFixed(3)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, ...T.mono }}><span style={{ color: C.muted }}>Value · P&amp;L</span><span style={{ color: pnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>{fmtUsd(value, 2)} · {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span></div>
              <button onClick={sellStatus === 'selling' ? undefined : handleSell} disabled={sellStatus === 'selling' || bid <= 0} style={{ width: '100%', padding: 11, borderRadius: 10, background: pnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`, border: `1px solid ${pnl >= 0 ? C.yes : C.no}66`, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 13, cursor: (sellStatus === 'selling' || bid <= 0) ? 'not-allowed' : 'pointer', opacity: (sellStatus === 'selling' || bid <= 0) ? .55 : 1, ...T.body }}>
                {sellStatus === 'selling' ? 'Selling…' : bid <= 0 ? 'No bids' : `Sell all · ${fmtUsd(value, 2)}`}
              </button>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>SOL to spend</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
              <input value={amountSol} onChange={(e) => { setAmountSol(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" placeholder="0.05" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>SOL</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {['0.05', '0.1', '0.5', '1'].map((v) => (
                <button key={v} onClick={() => setAmountSol(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>{v}</button>
              ))}
              <button onClick={() => setAmountSol(solAvailableUi > 0 ? solAvailableUi.toFixed(4) : '0')} disabled={busy || solAvailableLamports <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: C.muted }}>SOL available</span><span style={{ color: C.ink, fontWeight: 600 }}>{solAvailableUi.toFixed(4)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: C.muted }}>Service fee</span><span style={{ color: C.ink, fontWeight: 600 }}>{FEE_PCT}% ({(sol * FEE_PCT / 100).toFixed(4)} SOL)</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: C.muted }}>To Polymarket</span><span style={{ color: C.ink, fontWeight: 600 }}>{(sol * (100 - FEE_PCT) / 100).toFixed(4)} SOL</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.muted }}>Will trigger</span><span style={{ color: sideColor, fontWeight: 700 }}>Buy {side.toUpperCase()} at ${price.toFixed(3)}</span></div>
          </div>
          {statusMsg && <StatusLine msg={statusMsg} />}
          {error && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no }}>
              {error}
              <div style={{ marginTop: 6, fontSize: 10, color: C.muted, ...T.mono }}>See Debug panel above.</div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px calc(env(safe-area-inset-bottom) + 14px)', borderTop: `1px solid ${C.border}`, background: C.card, flexShrink: 0 }}>
          <button onClick={busy ? undefined : handleBuy} disabled={busy || sol <= 0 || Number(solLamports) > solAvailableLamports || Number(solLamports) < MIN_SOL_LAMPORTS_PER_TRADE || !creds}
            style={{ width: '100%', padding: 14, borderRadius: 13, background: status === 'success' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`, border: `1px solid ${sideColor}66`, color: sideColor, fontWeight: 800, fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer', opacity: (busy || sol <= 0 || Number(solLamports) > solAvailableLamports || Number(solLamports) < MIN_SOL_LAMPORTS_PER_TRADE || !creds) ? .55 : 1, ...T.body }}>
            {busy ? statusMsg || 'Working…' : status === 'success' ? '✓ Trade placed' : !creds ? 'Setting up account…' : `Buy ${side.toUpperCase()} · ${sol.toFixed(4)} SOL`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ Header */

function Header({
  tradingBalance, solBalance,
  solanaAddress, evmAddress,
  onOpenFund, onConnectSol, onConnectEvm,
  setupStatus,
}) {
  const usd = Number(tradingBalance) / 1e6;
  const solUi = Number(solBalance) / 1e9;
  const bothConnected = !!solanaAddress && !!evmAddress;
  return (
    <div style={{ marginTop: 4, marginBottom: 10, padding: '14px 16px 14px', borderRadius: 18, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadow, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bothConnected ? 10 : 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: -.5, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 10, color: C.muted, ...T.mono, marginTop: 2 }}>Polymarket · SOL · 5% fee</div>
          </div>
          <div style={{ fontSize: 9, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>

        {!solanaAddress && (
          <button onClick={onConnectSol} style={{ width: '100%', padding: '10px', borderRadius: 11, background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`, color: C.bg, fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer', ...T.body }}>
            Connect Solana wallet
          </button>
        )}
        {solanaAddress && !evmAddress && (
          <button onClick={onConnectEvm} style={{ width: '100%', padding: '10px', borderRadius: 11, background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`, color: C.bg, fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer', ...T.body }}>
            Connect EVM wallet (Polygon)
          </button>
        )}

        {bothConnected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>SOL · POLYMARKET</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1.2 }}>{solUi.toFixed(4)} · {fmtUsd(usd, 2)}</div>
              {setupStatus === 'working' && <div style={{ fontSize: 9, color: C.amber, marginTop: 2, ...T.mono }}>Setting up Safe…</div>}
              {setupStatus === 'ready' && <div style={{ fontSize: 9, color: C.yes, marginTop: 2, ...T.mono }}>✓ Ready</div>}
              {setupStatus === 'error' && <div style={{ fontSize: 9, color: C.no, marginTop: 2, ...T.mono }}>Setup failed</div>}
            </div>
            <button onClick={onOpenFund} style={{ padding: '8px 14px', borderRadius: 10, background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`, color: C.bg, fontWeight: 800, fontSize: 12, border: 'none', cursor: 'pointer', ...T.body, whiteSpace: 'nowrap' }}>Account</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ Main */

export default function Predict() {
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
  const [creds, setCreds] = useState(null);
  const [setupStatus, setSetupStatus] = useState('idle');
  const [setupError, setSetupError] = useState(null);
  const [tradingBalance, setTradingBalance] = useState(0n);
  const [solBalance, setSolBalance] = useState(0n);
  const [collectStatus, setCollectStatus] = useState('idle');
  const [collectStatusMsg, setCollectStatusMsg] = useState('');
  const [collectError, setCollectError] = useState('');

  const solWallet = useWallet();
  const { connection } = useConnection();
  const solanaAddress = solWallet.publicKey?.toString() || null;

  const evm = useEvmWallet();
  const evmAddress = evm.address;
  const evmProvider = evm.provider;

  const signSolanaTx = useCallback(async (tx) => {
    if (!solWallet.signTransaction) throw new Error('Solana wallet cannot sign');
    return await solWallet.signTransaction(tx);
  }, [solWallet]);

  const onConnectSol = useCallback(() => {
    if (solWallet.wallet) {
      solWallet.connect().catch((e) => dbgErr('sol', 'connect failed', e));
    } else {
      const trigger = document.querySelector('.wallet-adapter-button-trigger') ||
                      document.querySelector('.wallet-adapter-modal-list-more');
      trigger?.click?.();
    }
  }, [solWallet]);

  const runSetup = useCallback(async () => {
    if (!evmAddress || !evmProvider) return;
    setSetupStatus('working');
    setSetupError(null);
    try {
      const result = await ensureSetup(evmAddress, evmProvider, (msg) => dbg('setup', 'status', { msg }));
      setSafeAddress(result.safeAddress);
      setCreds(result.creds);
      setSetupStatus('ready');
      dbg('setup', 'complete + verified');
    } catch (e) {
      dbgErr('setup', 'failed', e);
      const msg = e?.message || e?.error?.message || e?.reason ||
        (typeof e === 'string' ? e : '') ||
        (e?.code ? `code ${e.code}` : '') ||
        JSON.stringify(e).slice(0, 200) || 'Unknown setup error';
      setSetupError(msg);
      setSetupStatus('error');
    }
  }, [evmAddress, evmProvider]);

  useEffect(() => {
    if (!evmAddress || !evmProvider) {
      setSafeAddress(null);
      setCreds(null);
      setSetupStatus('idle');
      setSetupError(null);
      return;
    }
    runSetup();
  }, [evmAddress, evmProvider, runSetup]);

  useEffect(() => {
    if (!safeAddress) return;
    let alive = true;
    const tick = async () => {
      try { const b = await fetchSafeBalance(safeAddress); if (alive) setTradingBalance(b); } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [safeAddress]);

  useEffect(() => {
    if (!solanaAddress) return;
    let alive = true;
    const tick = async () => {
      try { const s = await fetchSolanaSolBalance(solanaAddress); if (alive) setSolBalance(s); } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [solanaAddress]);

  const refreshAll = useCallback(async () => {
    if (safeAddress) { try { setTradingBalance(await fetchSafeBalance(safeAddress)); } catch {} }
    if (solanaAddress) { try { setSolBalance(await fetchSolanaSolBalance(solanaAddress)); } catch {} }
  }, [safeAddress, solanaAddress]);

  const handleReset = useCallback(() => {
    if (!evmAddress) return;
    wipeUserCache(evmAddress);
    setSafeAddress(null); setCreds(null);
    setSetupStatus('idle'); setSetupError(null);
    setFundOpen(false);
    setTimeout(() => runSetup(), 300);
  }, [evmAddress, runSetup]);

  const handleCollectWinnings = useCallback(async ({ solanaAddress: addr, amountAtomic }) => {
    if (!safeAddress) return;
    setCollectStatus('working'); setCollectError(''); setCollectStatusMsg('');
    try {
      await requestWithdrawToSolana({
        safe: safeAddress, solanaAddress: addr, amountAtomic, onStatus: setCollectStatusMsg,
      });
      setCollectStatus('done');
      setCollectStatusMsg('Withdrawal submitted — funds arrive in 2-5 min');
      setTimeout(() => { refreshAll(); setCollectStatus('idle'); setCollectStatusMsg(''); }, 6000);
    } catch (e) {
      const m = e?.message || 'Withdraw failed';
      setCollectError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setCollectStatus('error'); setCollectStatusMsg('');
      setTimeout(() => setCollectStatus('idle'), 5000);
    }
  }, [safeAddress, refreshAll]);

  useEffect(() => {
    let alive = true;
    const h = HORIZONS.find((x) => x.id === horizonId) || HORIZONS[1];
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
        setMarkets(norm.filter((m) => isTradableMarket(m, h)));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true); load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [horizonId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = q
      ? markets.filter((m) =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.childQuestion || '').toLowerCase().includes(q))
      : [...markets];
    if (sortBy === 'upside') {
      const u = (m) => {
        const y = Number(m.yesPrice) || 0;
        const n = Number(m.noPrice) || 0;
        const yU = y >= 0.02 && y < 0.98 ? (1 / y - 1) * 100 : 0;
        const nU = n >= 0.02 && n < 0.98 ? (1 / n - 1) * 100 : 0;
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
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)' }}>
          <Header
            tradingBalance={tradingBalance} solBalance={solBalance}
            solanaAddress={solanaAddress} evmAddress={evmAddress}
            onOpenFund={() => setFundOpen(true)}
            onConnectSol={onConnectSol}
            onConnectEvm={() => evm.setPickerOpen(true)}
            setupStatus={setupStatus}
          />
          {[1, 2, 3, 4, 5].map((i) => <MarketSkeleton key={i} />)}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header
          tradingBalance={tradingBalance} solBalance={solBalance}
          solanaAddress={solanaAddress} evmAddress={evmAddress}
          onOpenFund={() => setFundOpen(true)}
          onConnectSol={onConnectSol}
          onConnectEvm={() => evm.setPickerOpen(true)}
          setupStatus={setupStatus}
        />

        {setupStatus === 'error' && setupError && (
          <div style={{ marginBottom: 10, padding: 12, borderRadius: 12, background: 'rgba(255,95,122,.10)', border: `1px solid ${C.no}55` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.no, fontWeight: 800, letterSpacing: 1, ...T.mono }}>POLYMARKET SAFE SETUP FAILED</span>
              <button onClick={() => copyToClipboard(setupError)} style={{ padding: '3px 8px', borderRadius: 6, background: C.no + '22', border: `1px solid ${C.no}55`, color: C.no, fontSize: 9, fontWeight: 700, cursor: 'pointer', ...T.mono }}>COPY</button>
            </div>
            <div style={{ fontSize: 11, color: C.ink, marginBottom: 8, ...T.mono, wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto', padding: 8, background: 'rgba(0,0,0,.3)', borderRadius: 6, border: `1px solid ${C.no}22` }}>{setupError}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={runSetup} style={{ flex: 1, padding: '8px', borderRadius: 8, background: C.no + '22', border: `1px solid ${C.no}55`, color: C.no, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>↻ Retry setup</button>
              <button onClick={() => setFundOpen(true)} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Open debug</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto' }}>
          {HORIZONS.map((h) => {
            const active = horizonId === h.id;
            return (
              <button key={h.id} onClick={() => setHorizonId(h.id)} style={{ padding: '6px 12px', borderRadius: 99, whiteSpace: 'nowrap', background: active ? C.hlDim : 'rgba(255,255,255,.03)', border: `1px solid ${active ? C.borderHi : C.border}`, color: active ? C.hl : C.muted, fontSize: 10, fontWeight: 800, cursor: 'pointer', ...T.mono }}>{h.label}</button>
            );
          })}
        </div>

        <div style={{ marginBottom: 8, position: 'relative' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" inputMode="search" style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontSize: 12, outline: 'none', ...T.body }} />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 5, marginBottom: 10, overflowX: 'auto' }}>
          {[
            { id: 'volume', label: '📊 Volume' },
            { id: 'upside', label: '🔥 Upside' },
            { id: 'ending', label: '⏱ Ending' },
          ].map((o) => {
            const a = sortBy === o.id;
            return (
              <button key={o.id} onClick={() => setSortBy(o.id)} style={{ padding: '5px 10px', borderRadius: 99, whiteSpace: 'nowrap', background: a ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)', border: `1px solid ${a ? C.border : 'transparent'}`, color: a ? C.ink : C.muted2, fontSize: 9.5, fontWeight: 700, cursor: 'pointer', ...T.mono }}>{o.label}</button>
            );
          })}
        </div>

        {error && <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {filtered.length === 0 && !error && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>{search ? `No markets match "${search}"` : 'No active markets.'}</div>}
        {filtered.map((m) => <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />)}
        <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: 'center', ...T.mono }}>Powered by Polymarket · External wallets · No embedded SDK</div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket} side={orderSide}
          onClose={() => { setOrderMarket(null); refreshAll(); }}
          evmAddress={evmAddress} evmProvider={evmProvider}
          safeAddress={safeAddress} creds={creds}
          solBalance={solBalance} solanaAddress={solanaAddress}
          signSolanaTx={signSolanaTx} solConnection={connection}
          refreshAll={refreshAll}
        />
      )}

      <FundingSheet
        open={fundOpen} onClose={() => setFundOpen(false)}
        evmAddress={evmAddress} safeAddress={safeAddress} tradingBalance={tradingBalance}
        solanaAddress={solanaAddress} solBalance={solBalance}
        onCollectWinnings={handleCollectWinnings}
        collectStatus={collectStatus} collectStatusMsg={collectStatusMsg} collectError={collectError}
        setupStatus={setupStatus} setupError={setupError} onRetrySetup={runSetup}
        onReset={handleReset}
        onDisconnectEvm={evm.disconnect}
        onDisconnectSol={() => solWallet.disconnect?.()}
      />

      <EvmWalletPicker
        open={evm.pickerOpen} wallets={evm.wallets}
        onPick={evm.connect} onClose={() => evm.setPickerOpen(false)}
        connecting={evm.connecting}
      />
    </>
  );
}
 