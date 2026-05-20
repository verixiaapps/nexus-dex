import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';
import { signL1Action } from '@nktkas/hyperliquid/signing';
import {
  createConfig as lifiCreateConfig,
  config as lifiConfig,
  Solana as LifiSolana,
  EVM as LifiEVM,
  getRoutes as lifiGetRoutes,
  executeRoute as lifiExecuteRoute,
  getChains as lifiGetChains,
  getTokens as lifiGetTokens,
} from '@lifi/sdk';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ENABLE_TRADING        = process.env.REACT_APP_HYPERLIQUID_LIVE_TRADING === '1';
const BUILDER_ADDRESS       = '';
const BUILDER_FEE_TENTHS_BP = 100;
const BUILDER_MAX_FEE_RATE  = '0.1%';
const LIFI_INTEGRATOR       = 'NexusDEX';
const LIFI_FEE_RECIPIENT    = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const LIFI_FEE              = 0.01;

const TAKER_FEE_NO_BUILDER = 0.00045;
const TAKER_FEE_W_BUILDER  = 0.000252;

const SLIPPAGE_OPEN  = 0.02;
const SLIPPAGE_CLOSE = 0.05;

const SOL_MINT              = '11111111111111111111111111111111';
const SOL_WRAPPED_MINT      = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL      = 1_000_000_000;

const LIFI_SOLANA_CHAIN_ID  = 1151111081099710;

const HYPERCORE_FALLBACK_CHAIN_ID = 999;
const HYPERCORE_FALLBACK_USDC     = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
const HYPERCORE_RPC               = 'https://rpc.hyperliquid.xyz/evm';
const ARBITRUM_RPC                = 'https://arb1.arbitrum.io/rpc';
const ARBITRUM_USDC               = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const SOL_RPC_PRIMARY = process.env.REACT_APP_SOL_RPC || null;
const ARB_RPC_PRIMARY = process.env.REACT_APP_ARB_RPC || ARBITRUM_RPC;

// Minimum stuck USDC (in 6-decimal units) before "bring home" banner shows
const SWEEP_MIN_USDC_UNITS = 1_000_000n; // $1.00

const DERIVATION_MSG = (pub) =>
  `Nexus DEX: Authorize HyperCore Account\n\nWallet: ${pub}\n\nThis creates your non-custodial trading account. No SOL is spent.`;

let _lastNonce = 0;
function nextNonce() {
  const now = Date.now();
  const n = now > _lastNonce ? now : _lastNonce + 1;
  _lastNonce = n;
  return n;
}

function generateCloid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return '0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
function isDuplicateCloidError(msg) {
  return /cloid|already exists|duplicate.*order/i.test(String(msg || ''));
}
function isExpiredBlockhashError(msg) {
  return /block height|TransactionExpired|blockhash not found|has expired/i.test(String(msg || ''));
}

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
  if (ARB_RPC_PRIMARY && ARB_RPC_PRIMARY !== ARBITRUM_RPC) rpcUrls[42161] = [ARB_RPC_PRIMARY];
  if (Object.keys(rpcUrls).length > 0) cfg.rpcUrls = rpcUrls;
  lifiCreateConfig(cfg);
  _lifiConfigured = true;
}

function makeEvmWalletClient(privateKey, chainId, rpcUrl) {
  const account = privateKeyToAccount(privateKey);
  const chain = {
    id: chainId,
    name: 'chain' + chainId,
    nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

function makeArbPublicClient() {
  const arbChain = {
    id: 42161,
    name: 'Arbitrum',
    nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
    rpcUrls: { default: { http: [ARB_RPC_PRIMARY] } },
  };
  return createPublicClient({ chain: arbChain, transport: http(ARB_RPC_PRIMARY) });
}

const ERC20_BALANCE_OF_ABI = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: '', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}];

async function readArbUsdcBalance(address) {
  if (!isValidEthAddress(address)) return 0n;
  try {
    const arbPublic = makeArbPublicClient();
    return await arbPublic.readContract({
      address: ARBITRUM_USDC, abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf', args: [address],
    });
  } catch { return 0n; }
}

async function readArbEthBalance(address) {
  if (!isValidEthAddress(address)) return 0n;
  try {
    const arbPublic = makeArbPublicClient();
    return await arbPublic.getBalance({ address });
  } catch { return 0n; }
}

const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

const PERPS_PAIRS = [
  { id:'BTC',  base:'BTC',  leverage:50, hot:true },
  { id:'ETH',  base:'ETH',  leverage:50, hot:true },
  { id:'SOL',  base:'SOL',  leverage:20, hot:true },
  { id:'HYPE', base:'HYPE', leverage:10, hot:true },
  { id:'BNB',  base:'BNB',  leverage:20 },
  { id:'XRP',  base:'XRP',  leverage:20 },
  { id:'DOGE', base:'DOGE', leverage:20 },
  { id:'AVAX', base:'AVAX', leverage:15 },
  { id:'LINK', base:'LINK', leverage:20 },
  { id:'SUI',  base:'SUI',  leverage:20 },
  { id:'ADA',  base:'ADA',  leverage:20 },
  { id:'TRX',  base:'TRX',  leverage:10 },
  { id:'ARB',  base:'ARB',  leverage:20 },
  { id:'OP',   base:'OP',   leverage:15 },
  { id:'WIF',  base:'WIF',  leverage:10 },
  { id:'PEPE', base:'PEPE', leverage:10 },
  { id:'JUP',  base:'JUP',  leverage:10 },
  { id:'PYTH', base:'PYTH', leverage:10 },
];

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

function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  n = Number(n);
  d = d != null ? d : (n >= 1000 ? 2 : n >= 1 ? 4 : 8);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}
function shortNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(1) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(0) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
  return '$' + x.toFixed(0);
}
function pct(n) {
  if (n == null || isNaN(n)) return '-';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}
function isValidEthAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '')); }
function isValidSolAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}

function roundSize(value, szDecimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const d = Math.max(0, Math.min(szDecimals, 8));
  const factor = Math.pow(10, d);
  const truncated = Math.floor(n * factor) / factor;
  return truncated.toFixed(d);
}
function roundHlPx(value, szDecimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const sigFigs = 5;
  let s = n.toPrecision(sigFigs);
  s = Number(s).toString();
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const num = Number(s);
  const factor = Math.pow(10, maxDecimals);
  return (Math.round(num * factor) / factor).toString();
}
function aggressivePx(mid, isLong, szDecimals = 4, slippage = SLIPPAGE_OPEN) {
  const px = Number(mid);
  if (!Number.isFinite(px) || px <= 0) return '0';
  return roundHlPx(isLong ? px * (1 + slippage) : px * (1 - slippage), szDecimals);
}
function coinAccent(symbol) {
  const map = {
    BTC:['#f7931a','#ffbf5c'], ETH:['#627eea','#8fa8ff'], SOL:['#14f195','#9945ff'],
    HYPE:['#97fce4','#5ce9c8'], DOGE:['#c2a633','#e8c84a'], PEPE:['#3dd598','#5de882'],
    XRP:['#7989ad','#bcc6e0'], BNB:['#f0b90b','#f5d060'], SUI:['#4da2ff','#80c4ff'],
    LINK:['#2a5ada','#6a95ff'], AVAX:['#e84142','#ff7a7b'], ARB:['#12aaff','#60d0ff'],
  };
  return map[symbol] || ['#a87fff','#97fce4'];
}

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
async function signTypedDataCompat(wallet, domain, types, value) {
  if (typeof wallet.signTypedData === 'function')  return wallet.signTypedData(domain, types, value);
  if (typeof wallet._signTypedData === 'function') return wallet._signTypedData(domain, types, value);
  throw new Error('Wallet does not support typed data signing');
}
function splitSigCompat(ethersNs, sig) {
  if (ethersNs.Signature?.from)       return ethersNs.Signature.from(sig);
  if (ethersNs.utils?.splitSignature) return ethersNs.utils.splitSignature(sig);
  throw new Error('Cannot split signature');
}

function getSessionWallet(solPubkey) {
  try {
    const raw = sessionStorage.getItem('nexus_hl_' + solPubkey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setSessionWallet(solPubkey, address, privateKey) {
  try { sessionStorage.setItem('nexus_hl_' + solPubkey, JSON.stringify({ address, privateKey })); }
  catch {}
}
function getKnownHlAddress(solPubkey) {
  try { return localStorage.getItem('nexus_hl_addr_' + solPubkey) || null; }
  catch { return null; }
}
function setKnownHlAddress(solPubkey, address) {
  try { localStorage.setItem('nexus_hl_addr_' + solPubkey, address); } catch {}
}
function getResolvedHlAddress(solPubkey) {
  return getSessionWallet(solPubkey)?.address || getKnownHlAddress(solPubkey);
}

async function deriveHLWallet(signMessage, solPubkey) {
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
  setKnownHlAddress(solPubkey, wallet.address);
  return result;
}

function loadCachedAccount(walletPubkey) {
  if (!walletPubkey) return null;
  try {
    const raw = localStorage.getItem('nexus_acct_' + walletPubkey);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - (d.ts || 0) > 24 * 3_600_000) return null;
    return d;
  } catch { return null; }
}
function saveCachedAccount(walletPubkey, data) {
  if (!walletPubkey) return;
  try {
    localStorage.setItem('nexus_acct_' + walletPubkey, JSON.stringify({ ...data, ts: Date.now() }));
  } catch {}
}

function loadCachedCharts() {
  try {
    const raw = localStorage.getItem('nexus_charts');
    if (!raw) return { sparks: {}, hours: {} };
    const d = JSON.parse(raw);
    if (Date.now() - (d.ts || 0) > 30 * 60_000) return { sparks: {}, hours: {} };
    return { sparks: d.sparks || {}, hours: d.hours || {} };
  } catch { return { sparks: {}, hours: {} }; }
}
function saveCachedCharts(sparks, hours) {
  try { localStorage.setItem('nexus_charts', JSON.stringify({ ts: Date.now(), sparks, hours })); } catch {}
}

// Cache full market snapshots so first render shows real prices instantly.
// 60-sec TTL — short enough that new HL listings appear quickly on next open.
function loadCachedMarkets(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - (d.ts || 0) > 60_000) return null;
    return Array.isArray(d.data) ? d.data : null;
  } catch { return null; }
}
function saveCachedMarkets(key, data) {
  try {
    if (!Array.isArray(data) || data.length === 0) return;
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function fetchSolBalance(connection, publicKey) {
  try { return await connection.getBalance(publicKey); }
  catch { return 0; }
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
async function fetchSolPrice() {
  const r = await fetchWithTimeout('/api/sol-price', {}, 5_000);
  if (!r.ok) throw new Error('SOL price unavailable');
  const d = await r.json();
  if (!d.price || d.price <= 0) throw new Error('SOL price unavailable');
  return Number(d.price);
}

async function hlRequest(body, isExchange = false) {
  const path = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res  = await fetchWithTimeout(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, isExchange ? 15_000 : 10_000);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || data?.detail || 'Hyperliquid request failed');
  return data;
}

async function fetchHlState(hlAddress) {
  if (!hlAddress) return null;
  try { return await hlRequest({ type: 'clearinghouseState', user: hlAddress }); }
  catch { return null; }
}

async function fetchHlBalanceAndPositions(hlAddress) {
  const state = await fetchHlState(hlAddress);
  if (!state) return null;
  const balance      = parseFloat(state?.marginSummary?.accountValue || 0);
  const withdrawable = parseFloat(state?.withdrawable || 0);
  const marginUsed   = parseFloat(state?.crossMarginSummary?.totalMarginUsed || 0);
  const positions = (state.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi || 0) !== 0)
    .map(p => {
      const pos  = p.position;
      const szi  = parseFloat(pos.szi || 0);
      return {
        coin:       pos.coin,
        szi,
        isLong:     szi > 0,
        size:       Math.abs(szi),
        entryPx:    parseFloat(pos.entryPx   || 0),
        unrealPnl:  parseFloat(pos.unrealizedPnl || 0),
        leverage:   pos.leverage?.value || 1,
        marginUsed: parseFloat(pos.marginUsed    || 0),
        posValue:   parseFloat(pos.positionValue || 0),
        roe:        parseFloat(pos.returnOnEquity || 0),
      };
    });
  return { balance, withdrawable, marginUsed, positions };
}

async function pollUntilFunded(hlAddress, targetUsd, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bp = await fetchHlBalanceAndPositions(hlAddress);
    if (bp && bp.balance >= targetUsd * 0.97) return bp.balance;
    await new Promise(r => setTimeout(r, 4_000));
  }
  throw new Error('Bridge is taking longer than expected. Your SOL is safe - refresh to check.');
}

let _hyperCoreResolved = null;
async function resolveHyperCoreChain() {
  if (_hyperCoreResolved) return _hyperCoreResolved;
  try {
    const chains = await lifiGetChains();
    const match = (chains || []).find(c => {
      const name = String(c.name || '').toLowerCase();
      const key  = String(c.key  || '').toLowerCase();
      return name.includes('hypercore') || name.includes('hyperliquid')
        || ['hyp', 'hco', 'hcore'].includes(key);
    });
    if (!match) throw new Error('HyperCore chain not in Li.Fi registry');

    let usdcAddr = HYPERCORE_FALLBACK_USDC;
    try {
      const t = await lifiGetTokens({ chains: [match.id] });
      const list = t?.tokens?.[match.id] || [];
      const usdc = list.find(x => /^usdc(\.e)?$/i.test(x.symbol)) || list.find(x => x.symbol === 'USDC');
      if (usdc?.address) usdcAddr = usdc.address;
    } catch {}

    _hyperCoreResolved = { chainId: match.id, usdcAddress: usdcAddr };
  } catch (e) {
    console.warn('[hypercore resolve fallback]', e?.message || e);
    _hyperCoreResolved = { chainId: HYPERCORE_FALLBACK_CHAIN_ID, usdcAddress: HYPERCORE_FALLBACK_USDC };
  }
  return _hyperCoreResolved;
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

async function depositSolToHyperCore({
  solLamports, hlAddress, solPubkey, onStatus,
}) {
  ensureLifiConfig();
  const hyperCore = await resolveHyperCoreChain();
  const solAddr   = await resolveSolNativeAddress();

  const runOnce = async (label) => {
    onStatus?.(label);
    const result = await lifiGetRoutes({
      fromChainId:      LIFI_SOLANA_CHAIN_ID,
      toChainId:        hyperCore.chainId,
      fromTokenAddress: solAddr,
      toTokenAddress:   hyperCore.usdcAddress,
      fromAmount:       String(solLamports),
      fromAddress:      solPubkey,
      toAddress:        hlAddress,
      options: {
        slippage: 0.01,
        order: 'CHEAPEST',
        allowSwitchChain: false,
      },
    });
    if (!result?.routes?.length) {
      throw new Error('No bridge route found. Try a larger amount or check Li.Fi status.');
    }
    onStatus?.('Sign in wallet...');
    const executed = await lifiExecuteRoute(result.routes[0], {
      updateRouteHook(updated) {
        const step = updated?.steps?.[updated.steps.length - 1];
        const procs = step?.execution?.process || [];
        const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
        if (active?.message) onStatus?.(active.message);
        else if (procs.some(p => p.status === 'DONE')) onStatus?.('Bridging...');
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
    onStatus?.('Blockhash expired - preparing fresh route...');
    return await runOnce('Sign again to retry...');
  }
}

// Try server-side gas sponsorship. Returns { ok, retryable, reason }.
async function trySponsorArbGas(hlEvmAddress) {
  try {
    const r = await fetch('/api/bridge/sponsor-gas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: hlEvmAddress }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data?.ok) return { ok: true, txHash: data.txHash };
    if (r.status === 429) {
      return { ok: false, retryable: true, reason: 'cooldown' };
    }
    if (r.status === 503) {
      return { ok: false, retryable: false, reason: 'operator-not-configured' };
    }
    return { ok: false, retryable: false, reason: data?.error || `Sponsor returned ${r.status}` };
  } catch (e) {
    return { ok: false, retryable: false, reason: e?.message || 'Sponsor network error' };
  }
}

async function prefundArbGasFromSol(args) {
  const arbPublic = makeArbPublicClient();
  const minEth = 200_000_000_000_000n;

  let ethBalance = 0n;
  try { ethBalance = await arbPublic.getBalance({ address: args.hlEvmAddress }); } catch {}
  if (ethBalance >= minEth) return;

  args.onStatus?.('Funding bridge gas (no signature needed)...');
  const sponsored = await trySponsorArbGas(args.hlEvmAddress);
  if (sponsored.ok) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const bal = await arbPublic.getBalance({ address: args.hlEvmAddress });
        if (bal >= minEth) return;
      } catch {}
      await new Promise(r => setTimeout(r, 2_500));
    }
    return;
  }
  if (sponsored.retryable) {
    throw new Error('Gas sponsorship on cooldown. Please retry in 1 minute.');
  }

  console.warn('[gas sponsorship unavailable, falling back to user-funded]', sponsored.reason);

  const _impl = async () => {
    ensureLifiConfig();
    if (!args.solWalletAdapter) {
      throw new Error('Gas funding unavailable. Reconnect your Solana wallet and try again.');
    }
    args.onStatus?.('Funding bridge gas (sign in wallet)...');
    lifiConfig.setProviders([
      LifiSolana({ async getWalletAdapter() { return args.solWalletAdapter; } }),
    ]);
    const solAddr = await resolveSolNativeAddress();
    const route = await lifiGetRoutes({
      fromChainId:      LIFI_SOLANA_CHAIN_ID,
      toChainId:        42161,
      fromTokenAddress: solAddr,
      toTokenAddress:   '0x0000000000000000000000000000000000000000',
      fromAmount:       '5000000',
      fromAddress:      args.solPubkey,
      toAddress:        args.hlEvmAddress,
      options: { slippage: 0.02, order: 'CHEAPEST', allowSwitchChain: false },
    });
    if (!route?.routes?.length) throw new Error('No gas funding route. Try again.');
    await lifiExecuteRoute(route.routes[0], {
      updateRouteHook(updated) {
        const step = updated?.steps?.[updated.steps.length - 1];
        const procs = step?.execution?.process || [];
        const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
        if (active?.message) args.onStatus?.(active.message);
      },
    });
    args.onStatus?.('Waiting for gas to arrive on Arbitrum...');
    const deadline = Date.now() + 4 * 60_000;
    while (Date.now() < deadline) {
      try {
        const bal = await arbPublic.getBalance({ address: args.hlEvmAddress });
        if (bal >= minEth) return;
      } catch {}
      await new Promise(r => setTimeout(r, 5_000));
    }
    throw new Error('Gas funding did not arrive. Try the withdraw again.');
  };

  try { return await _impl(); }
  catch (e) {
    if (!isExpiredBlockhashError(e?.message)) throw e;
    args.onStatus?.('Blockhash expired - retrying with fresh route...');
    return await _impl();
  }
}

// Bridge full Arb USDC balance from hlWalletData.address -> Solana SOL at solPubkey.
async function bridgeFullArbUsdcToSol({ hlWalletData, solPubkey, solWalletAdapter, onStatus }) {
  ensureLifiConfig();

  await prefundArbGasFromSol({
    hlEvmAddress:    hlWalletData.address,
    solPubkey,
    solWalletAdapter,
    onStatus,
  });

  const arbBalance = await readArbUsdcBalance(hlWalletData.address);
  if (arbBalance < SWEEP_MIN_USDC_UNITS) {
    throw new Error('No USDC to bridge on Arbitrum at ' + hlWalletData.address);
  }

  onStatus?.('Bridging to Solana...');
  const solAddr   = await resolveSolNativeAddress();
  const arbClient = makeEvmWalletClient(hlWalletData.privateKey, 42161, ARB_RPC_PRIMARY);

  const providers = [
    LifiEVM({
      getWalletClient: async () => arbClient,
      switchChain: async () => arbClient,
    }),
  ];
  if (solWalletAdapter) {
    providers.push(LifiSolana({ async getWalletAdapter() { return solWalletAdapter; } }));
  }
  lifiConfig.setProviders(providers);

  async function getBridgeRoute(useAcrossOnly) {
    return await lifiGetRoutes({
      fromChainId:      42161,
      toChainId:        LIFI_SOLANA_CHAIN_ID,
      fromTokenAddress: ARBITRUM_USDC,
      toTokenAddress:   solAddr,
      fromAmount:       arbBalance.toString(),
      fromAddress:      hlWalletData.address,
      toAddress:        solPubkey,
      options: {
        slippage: useAcrossOnly ? 0.01 : 0.03,
        order: 'CHEAPEST',
        allowSwitchChain: false,
        ...(useAcrossOnly ? { bridges: { allow: ['across'] } } : {}),
      },
    });
  }

  let route = await getBridgeRoute(true);
  if (!route?.routes?.length) {
    console.warn('[bridge] No Across route, falling back to any bridge');
    onStatus?.('Finding alternate route...');
    route = await getBridgeRoute(false);
  }
  if (!route?.routes?.length) {
    throw new Error('No bridge route Arbitrum -> Solana. USDC at ' + hlWalletData.address + ' on Arbitrum.');
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
      () => reject(new Error('Bridge timed out after 4 min. Funds safe at ' + hlWalletData.address + ' on Arbitrum -- reopen Withdraw to bring home.')),
      EXEC_TIMEOUT_MS,
    )),
  ]);

  let txHash = null;
  for (const step of (executed?.steps || [])) {
    for (const proc of (step?.execution?.process || [])) {
      if (proc.txHash) txHash = proc.txHash;
    }
  }
  return { txHash, usdcSwept: arbBalance };
}

// "Bring home" — bridges any stuck USDC on Arb back to Solana.
// Used for BOTH freshly-arrived USDC (after step 1) and recovery sweeps.
async function bringHomeStuckArbUsdc({ hlWalletData, solPubkey, solWalletAdapter, onStatus }) {
  onStatus?.('Checking Arbitrum balance...');
  const arbBalance = await readArbUsdcBalance(hlWalletData.address);
  if (arbBalance < SWEEP_MIN_USDC_UNITS) {
    throw new Error('No USDC found at ' + hlWalletData.address);
  }
  onStatus?.(`Bringing $${(Number(arbBalance) / 1e6).toFixed(2)} home...`);
  return bridgeFullArbUsdcToSol({ hlWalletData, solPubkey, solWalletAdapter, onStatus });
}

// STEP 1 of the two-step withdraw: just sign withdraw3 and submit to HL.
// No waiting, no bridging. Returns immediately after HL accepts.
// USDC will land on Arbitrum in ~4 min — user comes back for step 2.
async function initiateHlWithdraw({ usdAmount, hlWalletData, onStatus }) {
  onStatus?.('Signing withdrawal...');
  const time = nextNonce();
  const action = {
    type:             'withdraw3',
    hyperliquidChain: 'Mainnet',
    signatureChainId: '0xa4b1',
    destination:      hlWalletData.address.toLowerCase(),
    amount:           usdAmount.toFixed(2),
    time,
  };
  const signature = await signHlWithdraw(hlWalletData.privateKey, action);

  onStatus?.('Submitting to Hyperliquid...');
  const hlResult = await hlRequest({ action, nonce: time, signature }, true);
  if (hlResult?.status === 'err') {
    const reason = typeof hlResult?.response === 'string' ? hlResult.response : JSON.stringify(hlResult);
    throw new Error('HL withdraw failed: ' + reason);
  }
  return { ok: true, time };
}

async function signHlWithdraw(privateKey, action) {
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(privateKey);
  const domain   = {
    name: 'HyperliquidSignTransaction', version: '1',
    chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    'HyperliquidTransaction:Withdraw': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination',      type: 'string' },
      { name: 'amount',           type: 'string' },
      { name: 'time',             type: 'uint64'  },
    ],
  };
  const message = {
    hyperliquidChain: action.hyperliquidChain,
    destination:      action.destination,
    amount:           action.amount,
    time:             action.time,
  };
  const sig   = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
}

async function signApproveBuilderFee(privateKey, action) {
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(privateKey);
  const domain   = {
    name: 'HyperliquidSignTransaction', version: '1',
    chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    'HyperliquidTransaction:ApproveBuilderFee': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'maxFeeRate',       type: 'string' },
      { name: 'builder',          type: 'string' },
      { name: 'nonce',            type: 'uint64' },
    ],
  };
  const message = {
    hyperliquidChain: action.hyperliquidChain,
    maxFeeRate:       action.maxFeeRate,
    builder:          action.builder,
    nonce:            action.nonce,
  };
  const sig   = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
}

async function ensureBuilderApproval(hlWalletData) {
  if (!isValidEthAddress(BUILDER_ADDRESS)) return;
  const cacheKey = `nexus_builder_approved_${hlWalletData.address.toLowerCase()}_${BUILDER_ADDRESS.toLowerCase()}`;
  try { if (localStorage.getItem(cacheKey) === '1') return; } catch {}
  const nonce = nextNonce();
  const action = {
    type:             'approveBuilderFee',
    hyperliquidChain: 'Mainnet',
    signatureChainId: '0xa4b1',
    maxFeeRate:       BUILDER_MAX_FEE_RATE,
    builder:          BUILDER_ADDRESS.toLowerCase(),
    nonce,
  };
  const signature = await signApproveBuilderFee(hlWalletData.privateKey, action);
  const result = await hlRequest({ action, nonce, signature }, true);
  if (result?.status === 'err') {
    const reason = typeof result?.response === 'string' ? result.response : JSON.stringify(result);
    console.warn('[builder approval]', reason);
    throw new Error(`Builder approval failed: ${reason}`);
  }
  try { localStorage.setItem(cacheKey, '1'); } catch {}
}

function saveBridge(mode, payload) {
  try { localStorage.setItem('nexus_bridge_' + mode, JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
}
function loadBridge(mode) {
  try {
    const raw = localStorage.getItem('nexus_bridge_' + mode);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return Date.now() - d.ts < 30 * 60_000 ? d : null;
  } catch { return null; }
}
function clearBridge(mode) {
  try { localStorage.removeItem('nexus_bridge_' + mode); } catch {}
}

// Tracks pending step-1 withdraws so the UI can show "USDC arriving in ~4 min".
function savePendingWithdraw(hlAddress, usdAmount) {
  try {
    localStorage.setItem('nexus_pending_withdraw_' + hlAddress.toLowerCase(),
      JSON.stringify({ usdAmount, ts: Date.now() }));
  } catch {}
}
function loadPendingWithdraw(hlAddress) {
  try {
    const raw = localStorage.getItem('nexus_pending_withdraw_' + (hlAddress || '').toLowerCase());
    if (!raw) return null;
    const d = JSON.parse(raw);
    // expire after 30 min — by then it should have landed on Arb (or failed)
    if (Date.now() - d.ts > 30 * 60_000) return null;
    return d;
  } catch { return null; }
}
function clearPendingWithdraw(hlAddress) {
  try { localStorage.removeItem('nexus_pending_withdraw_' + (hlAddress || '').toLowerCase()); } catch {}
}

function buildOrderAction({
  pair, isLong, usdAmount, leverage,
  reduceOnly = false, sizeOverride = null,
  withBuilder = true, cloid = null,
  slippage,
}) {
  if (!ENABLE_TRADING) throw new Error('Trading is disabled - set REACT_APP_HYPERLIQUID_LIVE_TRADING=1');
  const assetIndex = pair?.assetIndex;
  const price      = Number(pair?.price || 0);
  const margin     = Number(usdAmount || 0);
  const maxLev     = Math.max(1, Math.floor(Number(pair?.leverage || 1)));
  const lev        = Math.min(Math.max(1, Number(leverage || 1)), maxLev);
  const szDecimals = Number.isInteger(pair?.szDecimals) ? pair.szDecimals : 4;
  const slip       = slippage != null ? slippage : (reduceOnly ? SLIPPAGE_CLOSE : SLIPPAGE_OPEN);

  if (!Number.isInteger(assetIndex) || assetIndex < 0) throw new Error('Market loading, try again');
  if (!Number.isFinite(price) || price <= 0)           throw new Error('Price unavailable, try again');
  if (!reduceOnly && (!Number.isFinite(margin) || margin < 10)) {
    throw new Error('Minimum order is $10');
  }

  const limitPx = aggressivePx(price, isLong, szDecimals, slip);
  let coinSize, notional;
  if (sizeOverride != null && sizeOverride > 0) {
    coinSize = roundSize(sizeOverride, szDecimals);
    notional = parseFloat(coinSize) * parseFloat(limitPx);
  } else {
    const takerFee = (withBuilder && isValidEthAddress(BUILDER_ADDRESS))
      ? TAKER_FEE_W_BUILDER
      : TAKER_FEE_NO_BUILDER;
    const feeBuffer = 1 - (takerFee * lev) - 0.001;
    notional = margin * lev * feeBuffer;
    const sizingPx = isLong ? Math.max(price, parseFloat(limitPx)) : Math.min(price, parseFloat(limitPx));
    coinSize = roundSize(notional / sizingPx, szDecimals);
  }

  if (parseFloat(coinSize) <= 0) throw new Error('Order size too small for this market');

  const order = {
    a: assetIndex, b: Boolean(isLong),
    p: limitPx, s: coinSize,
    r: Boolean(reduceOnly),
    t: { limit: { tif: 'Ioc' } },
  };
  if (cloid) order.c = cloid;

  const action = { type: 'order', orders: [order], grouping: 'na' };
  if (withBuilder && isValidEthAddress(BUILDER_ADDRESS)) {
    action.builder = { b: BUILDER_ADDRESS.toLowerCase(), f: BUILDER_FEE_TENTHS_BP };
  }
  return { action, coinSize, notional, limitPx, margin };
}

async function setLeverageOnHL({ assetIndex, leverage, isCross = false, hlWalletData }) {
  const action = { type:'updateLeverage', asset:assetIndex, isCross, leverage };
  const nonce  = nextNonce();
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action, nonce });
  return hlRequest({ action, nonce, signature }, true);
}

const _leverageCache = new Map();
async function placeOrder({
  pair, isLong, usdAmount, leverage,
  reduceOnly = false, sizeOverride = null,
  hlWalletData, cloid = null, slippage,
}) {
  if (!hlWalletData?.privateKey) throw new Error('Trading account not ready');

  let builderApproved = true;
  if (!reduceOnly && isValidEthAddress(BUILDER_ADDRESS)) {
    try { await ensureBuilderApproval(hlWalletData); }
    catch (e) { console.warn('[builder]', e.message); builderApproved = false; }
  }

  if (!reduceOnly) {
    const cacheKey = `${hlWalletData.address}:${pair.assetIndex}`;
    if (_leverageCache.get(cacheKey) !== leverage) {
      try {
        await setLeverageOnHL({ assetIndex:pair.assetIndex, leverage, hlWalletData });
        _leverageCache.set(cacheKey, leverage);
      } catch (e) { console.warn('[leverage]', e.message); }
    }
  }

  const built = buildOrderAction({
    pair, isLong, usdAmount, leverage,
    reduceOnly, sizeOverride,
    withBuilder: builderApproved, cloid, slippage,
  });
  const nonce  = nextNonce();
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action: built.action, nonce });

  let result;
  try {
    result = await hlRequest({ action: built.action, nonce, signature }, true);
  } catch (e) {
    if (cloid && isDuplicateCloidError(e?.message)) {
      console.warn('[placeOrder] duplicate cloid, treating as idempotent success');
      return { idempotent: true };
    }
    throw e;
  }

  if (result?.status === 'err') {
    const reason = typeof result?.response === 'string'
      ? result.response
      : JSON.stringify(result);
    if (cloid && isDuplicateCloidError(reason)) return { idempotent: true };
    throw new Error(reason);
  }
  const first = result?.response?.data?.statuses?.[0];
  const wasFilled = first?.filled != null;
  if (!wasFilled) {
    const reason = first?.error || first?.cancelled
      || (typeof first === 'string' ? first : null)
      || 'Order not filled - try again';
    throw new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));
  }
  return result;
}

async function fetchMarketSnapshot({ spotSymbols = new Set(), oneHourMap = {}, sparkMap = {} } = {}) {
  const [metaAndCtxs, mids] = await Promise.all([
    hlRequest({ type: 'metaAndAssetCtxs' }),
    hlRequest({ type: 'allMids' }),
  ]);
  const meta      = Array.isArray(metaAndCtxs) ? metaAndCtxs[0] : {};
  const assetCtxs = Array.isArray(metaAndCtxs) ? metaAndCtxs[1] || [] : [];
  const universe  = (meta.universe || []).map((u, i) => ({
    name:         u.name,
    index:        i,
    maxLeverage:  u.maxLeverage || 10,
    szDecimals:   Number.isInteger(u.szDecimals) ? u.szDecimals : 4,
    isDelisted:   u.isDelisted   === true,
    onlyIsolated: u.onlyIsolated === true,
    ctx:          assetCtxs[i] || {},
  }));
  const priceMap  = {};
  if (mids && !Array.isArray(mids)) {
    for (const [k, v] of Object.entries(mids)) { const p = parseFloat(v); priceMap[k] = p > 0 ? p : 0; }
  } else if (Array.isArray(mids)) {
    universe.forEach((u, i) => { const p = parseFloat(mids[i]); priceMap[u.name] = p > 0 ? p : 0; });
  }
  const all = universe.map(u => {
    const ctx = u.ctx;
    const mid = priceMap[u.name] || parseFloat(ctx.midPx || ctx.markPx || 0) || 0;
    const prev = parseFloat(ctx.prevDayPx || 0);
    const change = mid > 0 && prev > 0 ? ((mid - prev) / prev) * 100 : 0;
    return {
      id: u.name, base: u.name,
      assetIndex:  u.index,
      szDecimals:  u.szDecimals,
      leverage:    u.maxLeverage,
      price:       mid,
      change,
      change1h:    Number.isFinite(oneHourMap[u.name]) ? oneHourMap[u.name] : 0,
      spark:       Array.isArray(sparkMap[u.name]) ? sparkMap[u.name] : [],
      volume24h:   parseFloat(ctx.dayNtlVlm    || 0),
      openInterest:parseFloat(ctx.openInterest || 0),
      funding:     parseFloat(ctx.funding      || 0),
      hasSpot:     hasSpotMatch(u.name, spotSymbols),
      hot:         false,
      // Universe flags from meta.universe — used by filterNewListings to
      // drop delisted markets and prioritize isolated-mode newcomers.
      isDelisted:   u.isDelisted,
      onlyIsolated: u.onlyIsolated,
    };
  });
  const allById = new Map(all.map(p => [p.id, p]));
  const curated = PERPS_PAIRS.map(p => {
    const found = allById.get(p.id);
    if (!found) return null;
    return {
      ...found,
      hot: !!p.hot,
      leverage: Math.min(found.leverage, p.leverage),
    };
  }).filter(Boolean);
  return { curated, all };
}

async function fetchSpotSymbols() {
  try {
    const spotMeta = await hlRequest({ type: 'spotMeta' });
    const tokens   = spotMeta?.tokens   || [];
    const universe = spotMeta?.universe || [];
    const out = new Set();
    universe.forEach(u => {
      const baseIdx = Array.isArray(u.tokens) ? u.tokens[0] : null;
      const t = baseIdx != null ? tokens[baseIdx] : null;
      if (t?.name) out.add(t.name);
    });
    return out;
  } catch { return new Set(); }
}

function hasSpotMatch(perpName, spotSymbols) {
  if (!perpName) return false;
  if (spotSymbols.has(perpName)) return true;
  if (perpName.startsWith('k') && spotSymbols.has(perpName.slice(1))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// NEW LISTINGS DETECTION
//
// First attempt sorted by assetIndex desc with no filtering, which
// surfaced stale markets like LIT, DASH, AXS, XMR. The HL universe
// array includes long-delisted markets and the index isn't a clean
// listing-order signal on its own.
//
// This version filters out:
//   - delisted markets (isDelisted flag from meta.universe — kills LIT)
//   - HIP-3 builder-deployed perps (names like "dex:COIN", index >= 100000)
//   - markets with no real trading activity (< $10k 24h volume)
//
// Then sorts isolated-only markets first (HL launches new perps in
// isolated mode), then by assetIndex desc. Surfaces actual recent
// additions instead of zombie listings.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// NEW LISTINGS — 7-day rolling window via first-seen tracking
//
// Hyperliquid does NOT expose listing timestamps on regular perps
// (verified against the live meta endpoint — only `xyz:` HIP-3 perps
// carry timestamps). So we track first-seen times ourselves.
//
// Every market refresh, `updateFirstSeen` records any perp not yet in
// the registry. After 7 days the perp drops off the NEW tab.
//
// Bootstrap problem: on first install, everything is "first seen now",
// which would show 200+ perps as new. Solution: record install time;
// during the first 7 days, ignore first-seen and fall back to
// assetIndex desc among live (non-delisted, non-HIP-3) markets — gives
// a reasonable approximation of recent listings.
//
// localStorage eviction (iOS Safari): if registry vanishes, we just
// re-bootstrap. Tab is never empty.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// NEW LISTINGS — strict 3-day window using real listing dates from
// Hyperliquid's candleSnapshot endpoint.
//
// We fetch the earliest 1d candle for each perp; its timestamp is the
// effective listing date. Cached forever in localStorage per coin.
// Only perps with listing date within NEW_WINDOW_MS show in the tab.
// ─────────────────────────────────────────────────────────────────────
const NEW_WINDOW_MS    = 3 * 24 * 60 * 60_000;  // 3 days, strict
const LISTING_KEY      = 'nexus_perp_listing_dates_v1';
const HL_INFO_URL      = '/api/hyperliquid';

function loadListingDates() {
  try {
    const raw = localStorage.getItem(LISTING_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveListingDates(map) {
  try { localStorage.setItem(LISTING_KEY, JSON.stringify(map)); } catch {}
}

// Fetch listing date for a single coin via candleSnapshot.
// Returns timestamp (ms) of earliest 1d candle, or null on failure.
async function fetchListingDate(coin) {
  try {
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin, interval: '1d', startTime: 0, endTime: Date.now() }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    // Each candle: { t: openTime, T: closeTime, s: coin, ... }
    const first = data[0];
    const ts = first?.t || first?.T;
    return typeof ts === 'number' && ts > 0 ? ts : null;
  } catch { return null; }
}

function passesBaseFilter(p) {
  if (!(p.price > 0) || !Number.isInteger(p.assetIndex)) return false;
  if (p.isDelisted === true) return false;
  // No HIP-3 builder perps.
  if (typeof p.id === 'string' && p.id.includes(':')) return false;
  if (p.assetIndex >= 100000) return false;
  // Drop dead markets.
  if (!(p.volume24h >= 10_000)) return false;
  return true;
}

// Filter to perps listed within NEW_WINDOW_MS. Requires a populated
// listingDateMap — perps without a known listing date are excluded
// (the effect that calls fetchListingDate will fill them in).
function filterNewListings(allPerps, listingDateMap) {
  if (!Array.isArray(allPerps) || allPerps.length === 0) return [];
  const now = Date.now();
  const live = allPerps.filter(passesBaseFilter);

  const candidates = live
    .filter(p => {
      const listedAt = listingDateMap[p.id];
      if (!listedAt) return false;
      return (now - listedAt) < NEW_WINDOW_MS;
    })
    .sort((a, b) => (listingDateMap[b.id] || 0) - (listingDateMap[a.id] || 0));

  return candidates.slice(0, 30).map((p, idx) => ({
    ...p,
    newnessRank: idx,
    listedAt: listingDateMap[p.id],
  }));
}

// Freshness tag — rank-based only, no date math, no localStorage.
// Top of the New tab (highest assetIndex) gets the strongest tag.
function freshnessTag(perp) {
  if (!perp || typeof perp.newnessRank !== 'number') return null;
  const r = perp.newnessRank;
  if (r < 3)  return { label: 'JUST LISTED', color: '#ff8a9e', bg: 'rgba(255,138,158,.12)', bd: 'rgba(255,138,158,.30)' };
  if (r < 7)  return { label: 'NEW',         color: '#f5b53d', bg: 'rgba(245,181,61,.12)',  bd: 'rgba(245,181,61,.30)' };
  if (r < 12) return { label: 'FRESH',       color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' };
  return null;
}

async function fetchOneHourChange(coin) {
  try {
    const now = Date.now();
    const c   = await hlRequest({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: now - 2 * 3_600_000, endTime: now } });
    if (!Array.isArray(c) || !c.length) return 0;
    const last = c[c.length - 1];
    const o = Number(last.o), cl = Number(last.c);
    return o > 0 ? ((cl - o) / o) * 100 : 0;
  } catch { return 0; }
}
async function fetchSparkline(coin) {
  try {
    const now = Date.now();
    const c   = await hlRequest({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: now - 12 * 3_600_000, endTime: now } });
    return Array.isArray(c) ? c.map(x => Number(x.c)).filter(v => v > 0) : [];
  } catch { return []; }
}
async function fetchOneHourMap(markets) {
  const limited = markets.slice(0, 200);
  const map = {};
  const BATCH = 20;
  for (let i = 0; i < limited.length; i += BATCH) {
    const batch = limited.slice(i, i + BATCH);
    const vals  = await Promise.all(batch.map(p => fetchOneHourChange(p.id)));
    batch.forEach((p, j) => { map[p.id] = Number.isFinite(vals[j]) ? vals[j] : 0; });
  }
  return map;
}
async function fetchSparkMap(markets) {
  const limited = markets.slice(0, 200);
  const map = {};
  const BATCH = 20;
  for (let i = 0; i < limited.length; i += BATCH) {
    const batch = limited.slice(i, i + BATCH);
    const vals  = await Promise.all(batch.map(p => fetchSparkline(p.id)));
    batch.forEach((p, j) => { map[p.id] = Array.isArray(vals[j]) ? vals[j] : []; });
  }
  return map;
}

function Ticker({ symbol, size = 36 }) {
  const [a, b] = coinAccent(symbol);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${a},${b})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(0,0,0,.78)', fontWeight: 900,
      fontSize: Math.round(size * 0.30), letterSpacing: '-.03em', flexShrink: 0,
      boxShadow: `0 4px 12px ${a}30`, ...T.display,
    }}>{symbol.slice(0, 3)}</div>
  );
}

function Sparkline({ data, up, width = 60, height = 22 }) {
  const reactId = React.useId ? React.useId() : Math.random().toString(36).slice(2, 8);
  if (!Array.isArray(data) || data.length < 2) return <div style={{ width, height }}/>;
  const min    = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const stepX  = width / (data.length - 1);
  const points = data.map((v, i) =>
    `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`
  ).join(' ');
  const color = up ? C.up : '#b8a4e8';
  const gid   = `g${reactId.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.32"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gid})`}/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function MarketRow({ pair, onClick }) {
  const up = pair.change >= 0;
  const fresh = freshnessTag(pair);
  return (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(151,252,228,.025)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: '100%', padding: '14px 16px', background: 'transparent', border: 'none',
        borderBottom: `1px solid ${C.hairline}`, cursor: 'pointer', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 14, alignItems: 'center',
        transition: 'background .15s',
      }}
    >
      <Ticker symbol={pair.base} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: C.inkStr, fontSize: 15, letterSpacing: '-.02em', ...T.body }}>{pair.base}</span>
          <span style={{ color: C.muted2, fontSize: 10, fontWeight: 600, ...T.mono }}>PERP</span>
          {fresh && <span style={{ color: fresh.color, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: fresh.bg, border: `1px solid ${fresh.bd}`, ...T.mono }}>{fresh.label}</span>}
          {!fresh && pair.hot && <span style={{ color: C.amber, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)', ...T.mono }}>HOT</span>}
        </div>
        <div style={{ marginTop: 3, color: C.muted, fontSize: 10, fontWeight: 500, ...T.mono }}>
          Up to {pair.leverage}x | {shortNum(pair.volume24h)} vol
        </div>
      </div>
      <Sparkline data={pair.spark} up={up}/>
      <div style={{ textAlign: 'right', minWidth: 78 }}>
        <div style={{ fontWeight: 700, color: C.inkStr, fontSize: 14, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {pair.price > 0 ? fmt(pair.price, 2) : '-'}
        </div>
        <div style={{ marginTop: 3, color: up ? C.up : C.down, fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {pct(pair.change)}
        </div>
      </div>
    </button>
  );
}

function PositionsPanel({ positions, marketData, onClose }) {
  if (!positions.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 8, ...T.mono }}>OPEN POSITIONS</div>
      {positions.map(pos => {
        const pair    = marketData.find(p => p.id === pos.coin);
        const markPx  = Number(pair?.price || 0);
        const pnl     = pos.unrealPnl;
        const pnlPct  = pos.marginUsed > 0 ? (pnl / pos.marginUsed) * 100 : 0;
        const inProfit = pnl >= 0;
        return (
          <div key={pos.coin} style={{
            marginBottom: 8, padding: '12px 14px', borderRadius: 14,
            background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
            border: `1px solid ${inProfit ? 'rgba(61,213,152,.24)' : 'rgba(255,138,158,.24)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ticker symbol={pos.coin} size={28}/>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: C.inkStr, ...T.display }}>{pos.coin}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: pos.isLong ? C.up : C.down, padding: '1px 5px', borderRadius: 4, background: pos.isLong ? 'rgba(61,213,152,.12)' : 'rgba(255,138,158,.12)', ...T.mono }}>
                      {pos.isLong ? 'LONG' : 'SHORT'} {pos.leverage}x
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>
                    {pos.size.toFixed(4)} {pos.coin} | Entry {fmt(pos.entryPx, 2)}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: inProfit ? C.up : C.down, ...T.display }}>
                  {inProfit ? '+' : ''}{fmt(pnl, 2)}
                </div>
                <div style={{ fontSize: 10, color: inProfit ? C.up : C.down, marginTop: 2, ...T.mono }}>{pct(pnlPct)}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 10 }}>
              {[
                ['Mark', fmt(markPx, 2)],
                ['Value', fmt(pos.posValue, 2)],
                ['Margin', fmt(pos.marginUsed, 2)],
              ].map(([l, v]) => (
                <div key={l} style={{ padding: '5px 0' }}>
                  <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{l}</div>
                  <div style={{ fontSize: 11, color: C.ink, fontWeight: 700, marginTop: 2, ...T.mono }}>{v}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => onClose(pos, pair)}
              style={{
                width: '100%', padding: '9px', borderRadius: 10,
                border: `1px solid ${inProfit ? 'rgba(61,213,152,.30)' : 'rgba(255,138,158,.30)'}`,
                background: inProfit ? 'rgba(61,213,152,.06)' : 'rgba(255,138,158,.06)',
                color: inProfit ? C.up : C.down,
                fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
              }}
            >
              Close Position
            </button>
          </div>
        );
      })}
    </div>
  );
}

function WalletPanel({
  solLamports, solPrice,
  hlBalanceUsd, hlAvailableUsd, hlMarginUsedUsd,
  hlAddress,
  onWithdraw, onSync, syncing,
}) {
  const solUsd      = (solLamports / LAMPORTS_PER_SOL) * solPrice;
  const totalUsd    = solUsd + hlBalanceUsd;
  const canWithdraw = hlAvailableUsd > 0;
  const needsSync   = !hlAddress;
  const hasPositions = hlMarginUsedUsd > 0;
  return (
    <div style={{ marginBottom: 14, borderRadius: 16, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.hairline}` }}>
        <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 4, ...T.mono }}>TOTAL BALANCE</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>{fmt(totalUsd, 2)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${C.hairline}` }}>
        <div style={{ padding: '12px 16px', borderRight: `1px solid ${C.hairline}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9945ff', boxShadow: '0 0 8px #9945ff' }}/>
            <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.07em', ...T.mono }}>SOLANA WALLET</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.inkStr, ...T.mono }}>{(solLamports / LAMPORTS_PER_SOL).toFixed(3)} SOL</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, ...T.mono }}>{fmt(solUsd, 2)}</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.hl, boxShadow: `0 0 8px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
            <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.07em', ...T.mono }}>TRADING ACCOUNT</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: hlAvailableUsd > 0 ? C.hl : C.muted, ...T.mono }}>
            {needsSync ? '--' : fmt(hlAvailableUsd, 2)}
          </div>
          <div style={{ fontSize: 10, color: needsSync ? C.amber : C.muted, marginTop: 2, ...T.mono }}>
            {needsSync ? 'Not synced' : 'Available'}
          </div>
          {hasPositions && (
            <div style={{ fontSize: 10, color: C.amber, marginTop: 4, fontWeight: 600, ...T.mono }}>
              + {fmt(hlMarginUsedUsd, 2)} in positions
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {hlAddress
            ? <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>{hlAddress.slice(0, 6)}...{hlAddress.slice(-4)}</span>
            : <span style={{ fontSize: 10, color: C.amber, ...T.mono }}>Sign to view positions</span>}
          {onSync && (
            <button onClick={syncing ? undefined : onSync} disabled={syncing} style={{
              padding: '4px 11px', borderRadius: 7,
              border: `1px solid ${needsSync ? 'rgba(245,181,61,.40)' : C.border}`,
              background: needsSync ? 'rgba(245,181,61,.10)' : 'transparent',
              color: needsSync ? C.amber : C.muted,
              fontSize: 10, fontWeight: 700, cursor: syncing ? 'wait' : 'pointer',
              opacity: syncing ? 0.5 : 1, ...T.mono,
            }}>{syncing ? '...' : (needsSync ? 'Sync' : 'Refresh')}</button>
          )}
        </div>
        <button onClick={canWithdraw ? onWithdraw : undefined} disabled={!canWithdraw} style={{
          padding: '6px 14px', borderRadius: 8,
          border: `1px solid ${canWithdraw ? 'rgba(168,127,255,.30)' : C.border}`,
          background: canWithdraw ? 'rgba(168,127,255,.08)' : 'rgba(255,255,255,.02)',
          color: canWithdraw ? C.violet : C.muted2,
          fontWeight: 700, fontSize: 11, cursor: canWithdraw ? 'pointer' : 'not-allowed',
          opacity: canWithdraw ? 1 : 0.55, ...T.mono,
        }}>{'Withdraw ->'}</button>
      </div>
    </div>
  );
}

// =====================================================================
// WithdrawModal — TWO-STEP withdraw flow
//
// Step 1: User taps Withdraw, enters amount, signs HL withdraw3. Done.
//         USDC will land on Arbitrum in ~4 min. They can close the app.
//
// Step 2: When user reopens the modal (or refreshes), we detect USDC on
//         Arb and show "Bring home" — bridges to Solana with 1 more sig.
//
// Each step is fully independent. State persists via on-chain Arb USDC
// balance + a small localStorage pending-marker.
// =====================================================================
function WithdrawModal({ open, onClose, hlAddress, hlBalance, walletPubkey, signMessage, refreshAfterAction, solPrice }) {
  const [amount, setAmount]           = useState('');
  const [step, setStep]               = useState('idle'); // idle | initiating | initiated | bringing | done | error
  const [statusMsg, setStatusMsg]     = useState('');
  const [error, setError]             = useState('');
  const [stuckUsdcUnits, setStuckUsdcUnits] = useState(0n);
  const [pending, setPending]         = useState(null);   // { usdAmount, ts } from pending marker
  const verifyRef                     = useRef(null);
  const verifyDeadlineRef             = useRef(0);
  const preBalanceRef                 = useRef(0);
  const expectedLamportsRef           = useRef(0);

  const { connection } = useConnection();
  const { wallet: solWallet } = useWallet();

  useBodyLock(open);

  // Poll Arbitrum balance and pending marker so the "bring home" banner
  // appears the moment USDC lands.
  useEffect(() => {
    if (!open || !isValidEthAddress(hlAddress)) return;
    let alive = true;
    const tick = async () => {
      try {
        const usdcBal = await readArbUsdcBalance(hlAddress);
        if (!alive) return;
        setStuckUsdcUnits(usdcBal);
        // If USDC arrived, the step-1 pending marker has served its purpose.
        if (usdcBal >= SWEEP_MIN_USDC_UNITS) {
          clearPendingWithdraw(hlAddress);
          setPending(null);
        } else {
          setPending(loadPendingWithdraw(hlAddress));
        }
      } catch {
        if (alive) setStuckUsdcUnits(0n);
      }
    };
    tick();
    const id = setInterval(tick, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, [open, hlAddress, step]);

  useEffect(() => {
    if (!open) {
      setAmount(''); setStep('idle'); setError(''); setStatusMsg('');
    }
    return () => {
      if (verifyRef.current) clearInterval(verifyRef.current);
    };
  }, [open]);

  const isBusy           = step === 'initiating' || step === 'bringing';
  const isStep1Done      = step === 'initiated';
  const isStep2Done      = step === 'done';
  const hasStuckUsdc     = stuckUsdcUnits >= SWEEP_MIN_USDC_UNITS;
  const stuckUsdcAmount  = Number(stuckUsdcUnits) / 1e6;
  const hasPending       = !!pending && !hasStuckUsdc;

  // ─── STEP 1: initiate HL withdraw3 ───
  const usd        = parseFloat(amount) || 0;
  const hlFee      = usd > 0 ? 1.00 : 0;
  const bridgeFee  = Math.max(0, (usd - hlFee) * 0.013);
  const netUsd     = Math.max(0, usd - hlFee - bridgeFee);
  const estSol     = solPrice > 0 ? netUsd / solPrice : 0;
  const tooSmall   = usd > 0 && netUsd < 2;

  const handleInitiate = async () => {
    if (!usd || usd < 5)                         { setError('Minimum withdrawal is $5'); return; }
    if (usd > hlBalance * 0.99)                  { setError('Amount exceeds available balance'); return; }
    if (!isValidSolAddress(walletPubkey))        { setError('Invalid Solana destination'); return; }
    if (tooSmall)                                { setError('After fees, you would receive less than $2. Increase amount.'); return; }

    setStep('initiating'); setError(''); setStatusMsg('Unlocking trading account...');
    try {
      let session = getSessionWallet(walletPubkey);
      if (!session?.privateKey) {
        if (!signMessage) throw new Error('Wallet does not support message signing');
        session = await deriveHLWallet(signMessage, walletPubkey);
      }
      await initiateHlWithdraw({
        usdAmount: usd,
        hlWalletData: session,
        onStatus: setStatusMsg,
      });
      savePendingWithdraw(session.address, usd);
      setPending({ usdAmount: usd, ts: Date.now() });
      setStep('initiated');
      setStatusMsg('');
      refreshAfterAction?.();
    } catch (e) {
      console.error('[withdraw step 1]', e);
      setError(e.message || 'Withdrawal request failed');
      setStep('error');
      refreshAfterAction?.();
    }
  };

  // ─── STEP 2: bring home from Arbitrum ───
  const handleBringHome = async () => {
    if (!hasStuckUsdc) return;
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana destination'); return; }

    setStep('bringing'); setError(''); setStatusMsg('Unlocking trading account...');
    try {
      let session = getSessionWallet(walletPubkey);
      if (!session?.privateKey) {
        if (!signMessage) throw new Error('Wallet does not support message signing');
        session = await deriveHLWallet(signMessage, walletPubkey);
      }

      try {
        preBalanceRef.current = await connection.getBalance(new PublicKey(walletPubkey));
      } catch {
        preBalanceRef.current = 0;
      }
      const expectedNetUsd = stuckUsdcAmount * 0.98;
      expectedLamportsRef.current = solPrice > 0
        ? Math.floor((expectedNetUsd / solPrice) * LAMPORTS_PER_SOL * 0.85)
        : 0;

      await bringHomeStuckArbUsdc({
        hlWalletData:     session,
        solPubkey:        walletPubkey,
        solWalletAdapter: solWallet?.adapter,
        onStatus:         setStatusMsg,
      });
      refreshAfterAction?.();

      setStatusMsg('Confirming arrival in your Solana wallet...');
      verifyDeadlineRef.current = Date.now() + 180_000;
      verifyRef.current = setInterval(async () => {
        if (Date.now() > verifyDeadlineRef.current) {
          clearInterval(verifyRef.current);
          setStep('done');
          setStatusMsg('');
          refreshAfterAction?.();
          return;
        }
        try {
          const current = await connection.getBalance(new PublicKey(walletPubkey));
          const delta = current - (preBalanceRef.current || 0);
          if (delta >= expectedLamportsRef.current) {
            clearInterval(verifyRef.current);
            setStep('done');
            setStatusMsg('');
            try {
              const fresh = await readArbUsdcBalance(hlAddress);
              setStuckUsdcUnits(fresh);
            } catch {}
            refreshAfterAction?.();
          }
        } catch {}
      }, 5_000);
    } catch (e) {
      console.error('[bring home]', e);
      setError(e.message || 'Bring-home failed');
      setStep('error');
      refreshAfterAction?.();
    }
  };

  if (!open) return null;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 451,
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        boxShadow: '0 -24px 70px rgba(0,0,0,.6)',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 22px 0' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 18, letterSpacing: '-.02em', ...T.display }}>Withdraw</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 3, ...T.body }}>HyperCore -> SOL in your Solana wallet</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer', opacity: isBusy ? 0.4 : 1 }}>X</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 8px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>

          {/* === BRING HOME (Step 2) — only shows when USDC has landed on Arb === */}
          {hasStuckUsdc && step !== 'bringing' && !isStep2Done && (
            <div style={{
              marginBottom: 16, padding: 16, borderRadius: 16,
              background: 'linear-gradient(145deg,rgba(61,213,152,.14),rgba(151,252,228,.08))',
              border: '1px solid rgba(61,213,152,.35)',
              boxShadow: '0 0 24px rgba(61,213,152,.10)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.up, boxShadow: `0 0 12px ${C.up}`, animation: 'nexus-pulse 1.5s ease-in-out infinite' }}/>
                <span style={{ fontSize: 12, color: C.up, fontWeight: 800, letterSpacing: '.05em', ...T.display }}>READY TO BRING HOME</span>
              </div>
              <div style={{ fontSize: 13, color: C.inkStr, lineHeight: 1.5, marginBottom: 4, fontWeight: 600, ...T.body }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: C.up, ...T.display }}>{fmt(stuckUsdcAmount, 2)}</span>
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 12, ...T.body }}>
                USDC has arrived on Arbitrum. One signature sends it to your Solana wallet (~30s).
              </div>
              <button onClick={handleBringHome} style={{
                width: '100%', padding: 14, borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`,
                color: '#04070f', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(61,213,152,.32)',
                ...T.display,
              }}>
                Bring {fmt(stuckUsdcAmount, 2)} home
              </button>
            </div>
          )}

          {/* === STEP 1 COMPLETED message === */}
          {isStep1Done && (
            <div style={{
              marginBottom: 16, padding: 16, borderRadius: 16,
              background: 'linear-gradient(145deg,rgba(151,252,228,.10),rgba(168,127,255,.06))',
              border: '1px solid rgba(151,252,228,.30)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>✓</span>
                <span style={{ fontSize: 13, color: C.hl, fontWeight: 800, letterSpacing: '.04em', ...T.display }}>WITHDRAWAL REQUESTED</span>
              </div>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.55, marginBottom: 10, ...T.body }}>
                Hyperliquid is bridging your USDC to Arbitrum. <strong style={{ color: C.inkStr }}>Takes about 4 minutes.</strong>
              </div>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.55, marginBottom: 4, ...T.body }}>
                You can close the app. When you come back, a button will appear here to bring your SOL home with one more signature.
              </div>
            </div>
          )}

          {/* === PENDING marker (after refresh, before USDC lands) === */}
          {hasPending && !isStep1Done && !isBusy && (
            <div style={{
              marginBottom: 14, padding: 14, borderRadius: 14,
              background: 'rgba(245,181,61,.08)',
              border: '1px solid rgba(245,181,61,.28)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.amber}`, borderTopColor: 'transparent', animation: 'nexus-spin 1.2s linear infinite' }}/>
                <span style={{ fontSize: 12, color: C.amber, fontWeight: 800, letterSpacing: '.04em', ...T.display }}>BRIDGING TO ARBITRUM</span>
              </div>
              <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5, ...T.body }}>
                <strong style={{ color: C.inkStr }}>{fmt(pending.usdAmount, 2)}</strong> on the way. Check back in a few minutes — we'll show a button to bring it home.
              </div>
            </div>
          )}

          {/* === AVAILABLE BALANCE === */}
          <div style={{ padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', marginBottom: 4, ...T.mono }}>AVAILABLE ON HYPERCORE</div>
            <div style={{ fontSize: 15, color: C.hl, fontWeight: 800, ...T.mono }}>{fmt(hlBalance, 2)}</div>
          </div>

          {/* === STEP 1 input — hidden after success === */}
          {!isStep1Done && (
            <>
              <div style={{ marginBottom: 8, fontSize: 11, color: C.muted, fontWeight: 600, ...T.body }}>
                How much to withdraw?
              </div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, opacity: isBusy ? 0.6 : 1 }}>
                <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
                <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
                  inputMode="decimal" enterKeyHint="done"
                  style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 23, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
                />
                <button onClick={() => setAmount((Math.max(0, hlBalance * 0.99)).toFixed(2))} disabled={isBusy || hlBalance <= 0} style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>MAX</button>
              </div>

              {usd > 0 && (
                <div style={{ marginBottom: 14, padding: 14, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>BREAKDOWN</div>
                  {[
                    ['Amount',              fmt(usd, 2),        C.ink],
                    ['HL withdrawal fee',  '-' + fmt(hlFee, 2),  C.muted],
                    ['Bridge fee (~1.3%)', '-' + fmt(bridgeFee, 2), C.muted],
                  ].map(([l, v, c]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, ...T.mono }}>
                      <span style={{ color: C.muted }}>{l}</span>
                      <span style={{ color: c, fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: `1px solid ${C.hairline}`, marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.ink, fontWeight: 700, fontSize: 12, ...T.body }}>You receive</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: tooSmall ? C.down : C.up, fontWeight: 800, fontSize: 14, ...T.mono }}>~ {fmt(netUsd, 2)}</div>
                      <div style={{ color: C.muted, fontSize: 10, marginTop: 2, ...T.mono }}>{solPrice > 0 ? estSol.toFixed(4) + ' SOL' : ''}</div>
                    </div>
                  </div>
                  {tooSmall && (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,138,158,.30)' }}>
                      <div style={{ fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>
                        Too small. Try at least $10 to make fees worth it.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* === HOW IT WORKS — friendly explainer === */}
              <div style={{ padding: '12px 14px', background: 'rgba(168,127,255,.06)', border: '1px solid rgba(168,127,255,.20)', borderRadius: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: C.violet, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>HOW IT WORKS</div>
                <div style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.6, ...T.body }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: C.violet, fontWeight: 800, minWidth: 14 }}>1</span>
                    <span>Sign once on Hyperliquid (now). USDC bridges to Arbitrum — takes ~4 min.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: C.violet, fontWeight: 800, minWidth: 14 }}>2</span>
                    <span>Come back, tap "Bring home" (1 more sig). SOL hits your wallet in ~30s.</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontStyle: 'italic' }}>
                    You can close the app between steps. Funds are safe.
                  </div>
                </div>
              </div>
            </>
          )}

          {isBusy && statusMsg && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}

          {isStep2Done && (
            <div style={{ marginBottom: 12, padding: 14, background: 'rgba(61,213,152,.08)', border: '1px solid rgba(61,213,152,.30)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: C.up, fontWeight: 800, ...T.display }}>✓ SOL in your wallet</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4, ...T.body }}>Done</div>
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: C.bg,
        }}>
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {isStep1Done && !hasStuckUsdc ? (
            <button onClick={onClose} style={{
              width: '100%', padding: 16, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display,
            }}>Got it — close</button>
          ) : isStep2Done ? (
            <button onClick={onClose} style={{
              width: '100%', padding: 16, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display,
            }}>Done</button>
          ) : (
            <button onClick={handleInitiate} disabled={isBusy || !amount || tooSmall} style={{
              width: '100%', padding: 16, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.violet} 0%,${C.sol} 100%)`,
              color: '#fff', fontWeight: 800, fontSize: 15,
              cursor: isBusy || !amount || tooSmall ? 'not-allowed' : 'pointer',
              minHeight: 52, opacity: !amount || isBusy || tooSmall ? 0.55 : 1, ...T.display,
            }}>
              {isBusy ? 'Processing...' : 'Request withdrawal'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function TradeDrawer({
  open, onClose, pair, onConnectWallet, walletPubkey,
  marketData, allPerps,
  hlWallet, setHlWallet,
  hlBalance, setHlBalance,
  hlAvailable, setHlAvailable,
  hlMarginUsed, setHlMarginUsed,
  positions, setPositions,
  solLamports, setSolLamports,
  solPrice,
  refreshAccount,
  refreshAfterAction,
}) {
  const { connected, signMessage, publicKey } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]               = useState('long');
  const [solAmount, setSolAmount]     = useState('');
  const [leverage, setLeverage]       = useState(5);
  const [status, setStatus]           = useState('idle');
  const [statusMsg, setStatusMsg]     = useState('');
  const [error, setError]             = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [syncing,      setSyncing]      = useState(false);

  const cloidRef = useRef(null);

  useBodyLock(open && !withdrawOpen);

  useEffect(() => {
    if (!open) cloidRef.current = null;
  }, [open]);

  const allMarkets = useMemo(() => {
    const map = new Map();
    (marketData || []).forEach(p => map.set(p.id, p));
    (allPerps   || []).forEach(p => { if (!map.has(p.id)) map.set(p.id, p); });
    return [...map.values()];
  }, [marketData, allPerps]);

  useEffect(() => {
    if (!pair?.leverage) return;
    setLeverage(prev => {
      const max = Math.max(1, Math.floor(pair.leverage));
      return prev > max ? max : prev;
    });
  }, [pair?.id, pair?.leverage]);

  const handleSync = async () => {
    if (!walletPubkey) return;
    if (!signMessage) { setError('Wallet does not support message signing'); return; }
    setSyncing(true); setError('');
    try {
      const wd = await deriveHLWallet(signMessage, walletPubkey);
      setHlWallet({ address: wd.address });
      await refreshAccount?.();
    } catch (e) {
      console.error('[sync]', e);
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const isLong       = side === 'long';
  const solVal       = parseFloat(solAmount) || 0;
  const usdAmount    = solVal * solPrice;
  const notionalUsd  = usdAmount * leverage;
  const entryPrice   = Number(pair?.price || 0);

  const previewTakerFee = isValidEthAddress(BUILDER_ADDRESS) ? TAKER_FEE_W_BUILDER : TAKER_FEE_NO_BUILDER;
  const previewBuffer   = 1 - (previewTakerFee * leverage) - 0.001;
  const previewLimitPx  = entryPrice > 0 ? parseFloat(aggressivePx(entryPrice, isLong, pair?.szDecimals, SLIPPAGE_OPEN)) : 0;
  const previewSizingPx = isLong ? Math.max(entryPrice, previewLimitPx) : Math.min(entryPrice, previewLimitPx);
  const previewSize     = previewSizingPx > 0 ? (notionalUsd * previewBuffer) / previewSizingPx : 0;

  const liqPrice     = entryPrice > 0
    ? isLong ? entryPrice * (1 - 0.9 / leverage) : entryPrice * (1 + 0.9 / leverage)
    : 0;
  const solBalance   = solLamports / LAMPORTS_PER_SOL;

  const usdNeededFromWallet = Math.max(0, usdAmount - hlAvailable);
  const solNeededFromWallet = solPrice > 0 ? usdNeededFromWallet / solPrice : 0;
  const notEnoughSol = solNeededFromWallet > 0 && solNeededFromWallet > solBalance * 0.98;

  const fundingRate  = pair?.funding || 0;

  const quickPct = (p) => {
    const reserve = 0.005;
    const solBal = solLamports / LAMPORTS_PER_SOL;
    const avail = Math.max(0, solBal - reserve);
    if (avail <= 0) return;
    const amt = (avail * p / 100);
    setSolAmount(amt.toFixed(4));
  };

  const execute = async () => {
    if (!wcon)            { onConnectWallet?.(); return; }
    if (!signMessage)     { setError('Wallet does not support message signing'); return; }
    if (!solVal || solVal < 0.01) { setError('Enter an amount'); return; }
    if (notEnoughSol)     { setError('Not enough SOL in your wallet'); return; }
    if (!pair?.price)     { setError('Price unavailable, try again'); return; }
    const usd = solVal * solPrice;
    if (usd < 10) { setError('Minimum trade is $10'); return; }

    if (!cloidRef.current) cloidRef.current = generateCloid();

    setStatus('loading'); setError(''); setStatusMsg('');
    try {
      setStatusMsg('Setting up account...');
      const walletData = await deriveHLWallet(signMessage, walletPubkey);
      if (!hlWallet) setHlWallet({ address: walletData.address });

      let bp = await fetchHlBalanceAndPositions(walletData.address);
      if (!bp) throw new Error('Could not load balance, try again');
      setHlBalance(bp.balance);
      setHlAvailable(bp.withdrawable);
      setHlMarginUsed(bp.marginUsed);

      if (bp.withdrawable < usd * 0.99) {
        const needed   = usd - bp.withdrawable;
        const lamports = Math.ceil((needed / solPrice) * LAMPORTS_PER_SOL * 1.05);
        setStatusMsg('Bridging SOL...');
        const { txHash } = await depositSolToHyperCore({
          solLamports: lamports,
          hlAddress:   walletData.address,
          solPubkey:   walletPubkey,
          onStatus:    setStatusMsg,
        });
        saveBridge('deposit', { txHash, usd: needed });
        setStatusMsg('Waiting for funds...');
        await pollUntilFunded(walletData.address, bp.balance + needed);
        const refreshed = await fetchHlBalanceAndPositions(walletData.address);
        if (refreshed) {
          bp = refreshed;
          setHlBalance(bp.balance);
          setHlAvailable(bp.withdrawable);
          setHlMarginUsed(bp.marginUsed);
        }
        clearBridge('deposit');
      }

      setStatusMsg(`Opening ${isLong ? 'long' : 'short'}...`);
      const safeMargin = Math.min(usd, bp.withdrawable * 0.99);
      if (safeMargin < 10) {
        throw new Error('Available balance below minimum after fees. Wait a moment and try again.');
      }
      await placeOrder({
        pair, isLong,
        usdAmount: safeMargin,
        leverage,
        hlWalletData: walletData,
        cloid: cloidRef.current,
        slippage: SLIPPAGE_OPEN,
      });

      cloidRef.current = null;

      setStatus('success');
      setStatusMsg('');
      refreshAfterAction?.();
      setTimeout(() => { setStatus('idle'); onClose(); }, 3000);
    } catch (e) {
      console.error('[execute]', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setStatusMsg('');
      clearBridge('deposit');
      refreshAfterAction?.();
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const closePosition = async (pos, posPair) => {
    const targetPair = posPair || allMarkets.find(p => p.id === pos.coin);
    if (!targetPair) { setError('Market data unavailable for ' + pos.coin); return; }

    setStatus('loading'); setError(''); setStatusMsg(`Closing ${pos.coin} position...`);
    try {
      let walletData = getSessionWallet(walletPubkey);
      if (!walletData?.privateKey) {
        if (!signMessage) throw new Error('Wallet does not support message signing');
        setStatusMsg('Unlocking trading account...');
        walletData = await deriveHLWallet(signMessage, walletPubkey);
        setStatusMsg(`Closing ${pos.coin} position...`);
      }

      const fresh = await fetchHlBalanceAndPositions(walletData.address);
      if (!fresh) throw new Error('Could not load position, try again');
      const live  = fresh.positions.find(p => p.coin === pos.coin);
      if (!live) {
        refreshAfterAction?.();
        throw new Error(`${pos.coin} position is already closed`);
      }

      await placeOrder({
        pair:          targetPair,
        isLong:        !live.isLong,
        usdAmount:     live.posValue,
        leverage:      live.leverage,
        reduceOnly:    true,
        sizeOverride:  live.size,
        hlWalletData:  walletData,
        slippage:      SLIPPAGE_CLOSE,
      });
      setStatus('success');
      setStatusMsg('');
      refreshAfterAction?.();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e) {
      console.error('[close]', e);
      setError(e.message || 'Close failed');
      setStatus('error');
      setStatusMsg('');
      refreshAfterAction?.();
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  if (!open || !pair) return null;
  const dayUp     = pair.change >= 0;
  const isBusy    = status === 'loading';
  const isSuccess = status === 'success';
  const isError   = status === 'error';

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Ticker symbol={pair.base} size={44}/>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 20, letterSpacing: '-.03em', ...T.display }}>{pair.base}</span>
                  <span style={{ color: C.hl, fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: C.hlDim, border: `1px solid ${C.borderHi}`, letterSpacing: '.06em', ...T.mono }}>PERP</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, ...T.mono }}>{fmt(pair.price, 2)}</span>
                  <span style={{ color: dayUp ? C.up : C.down, fontSize: 11, fontWeight: 700, ...T.mono }}>{pct(pair.change)}</span>
                  {fundingRate !== 0 && (
                    <span style={{ fontSize: 9, color: fundingRate >= 0 ? C.down : C.up, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: fundingRate >= 0 ? 'rgba(255,138,158,.10)' : 'rgba(61,213,152,.10)', ...T.mono }}>
                      Fr {fundingRate >= 0 ? '+' : ''}{(fundingRate * 100).toFixed(4)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1 }}>X</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', marginTop: 14, padding: '10px 0', borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            {[
              ['1H',      pct(pair.change1h),      pair.change1h >= 0 ? C.up : C.down],
              ['VOLUME',  shortNum(pair.volume24h), C.ink],
              ['MAX LEV', `${pair.leverage}x`,      C.hl],
            ].map(([l, v, c], i) => (
              <div key={l} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{l}</div>
                <div style={{ fontSize: 12, color: c, fontWeight: 700, marginTop: 3, ...T.mono }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 14px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>

          {wcon && (
            <WalletPanel
              solLamports={solLamports} solPrice={solPrice}
              hlBalanceUsd={hlBalance}
              hlAvailableUsd={hlAvailable}
              hlMarginUsedUsd={hlMarginUsed}
              hlAddress={hlWallet?.address}
              onWithdraw={() => setWithdrawOpen(true)}
              onSync={handleSync}
              syncing={syncing}
            />
          )}

          <PositionsPanel
            positions={positions}
            marketData={allMarkets}
            onClose={closePosition}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              ['long',  C.up,   'rgba(61,213,152,.10)',  'rgba(61,213,152,.42)'],
              ['short', C.down, 'rgba(255,138,158,.10)', 'rgba(255,138,158,.42)'],
            ].map(([s, color, bg, bdr]) => {
              const active = side === s;
              return (
                <button key={s} onClick={() => setSide(s)} disabled={isBusy} style={{
                  padding: 14, borderRadius: 14,
                  border: `1px solid ${active ? bdr : C.border}`,
                  background: active ? bg : 'rgba(255,255,255,.03)',
                  color: active ? color : C.muted,
                  fontWeight: 800, fontSize: 15, cursor: isBusy ? 'not-allowed' : 'pointer',
                  textTransform: 'capitalize', transition: 'all .15s',
                  boxShadow: active ? `0 0 20px ${color}1c` : 'none', ...T.display,
                }}>{s}</button>
              );
            })}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>MARGIN (SOL)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>INSTANT FILL</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${notEnoughSol ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <input value={solAmount} onChange={e => { setSolAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
                inputMode="decimal" enterKeyHint="done"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#14f195,#9945ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#000' }}>O</div>
                <span style={{ fontSize: 12, color: C.ink, fontWeight: 700, ...T.mono }}>SOL</span>
              </div>
            </div>

            {solVal > 0 && solPrice > 0 && (
              <div style={{ marginBottom: 9, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, ...T.mono }}>
                <span>Margin ~ {fmt(usdAmount, 2)}</span>
                <span style={{ color: C.ink }}>Position ~ {fmt(notionalUsd, 2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => quickPct(p)} disabled={isBusy || !wcon} style={{
                  flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer',
                  opacity: isBusy || !wcon ? 0.4 : 1, ...T.mono,
                }}>{p === 100 ? 'Max' : p + '%'}</button>
              ))}
            </div>

            {notEnoughSol && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.28)', borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: C.down, fontWeight: 700, ...T.body }}>Not enough SOL</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.body }}>Add more SOL to your wallet. You have {solBalance.toFixed(4)} SOL.</div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>LEVERAGE</span>
              <span style={{ fontSize: 13, color: C.hl, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, ...T.mono }}>{leverage}x</span>
            </div>
            <input type="range" min="1" max={pair.leverage} value={leverage} onChange={e => setLeverage(Number(e.target.value))} disabled={isBusy} style={{ width: '100%', height: 6, padding: '8px 0' }}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, color: C.muted2, ...T.mono }}>
              <span style={{ fontWeight: 700 }}>1x</span>
              <span>Conservative | Balanced | Aggressive</span>
              <span style={{ fontWeight: 700 }}>{pair.leverage}x</span>
            </div>
          </div>

          {solVal > 0 && solPrice > 0 && entryPrice > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              {[
                ['Margin',        fmt(usdAmount, 2)],
                ['Position size', roundSize(previewSize, pair.szDecimals) + ' ' + pair.base],
                ['Limit price',   fmt(Number(aggressivePx(entryPrice, isLong, pair.szDecimals, SLIPPAGE_OPEN)))],
                ['Liquidation',   fmt(liqPrice, 4)],
                ['Funding rate',  (fundingRate >= 0 ? '+' : '') + (fundingRate * 100).toFixed(4) + '% / h'],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: l === 'Funding rate' ? (fundingRate >= 0 ? C.down : C.up) : C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {(isBusy || isSuccess) && statusMsg && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Solana Wallet
            </button>
          ) : (
            <button onClick={execute} disabled={isBusy || notEnoughSol || !solAmount} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)` : isError ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)` : isLong ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)` : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || notEnoughSol || !solAmount ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !solAmount || notEnoughSol ? 0.55 : 1,
              boxShadow: isLong ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' : isSuccess ? `${isLong ? 'Long' : 'Short'} opened` : isError ? 'Retry' : isLong ? `Long ${pair.base} | ${leverage}x` : `Short ${pair.base} | ${leverage}x`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Non-custodial | Powered by Hyperliquid &amp; Li.Fi
          </div>
        </div>
      </div>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        hlAddress={hlWallet?.address || ''}
        hlBalance={hlAvailable}
        walletPubkey={walletPubkey}
        signMessage={signMessage}
        refreshAfterAction={refreshAfterAction}
        solPrice={solPrice}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VIP ALLOWLIST
// Add Solana wallet pubkeys here to grant access to perps trading.
// Anyone else sees the "Coming Soon" screen.
// ─────────────────────────────────────────────────────────────────────
const VIP_WALLETS = new Set([
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

function VipComingSoon({ onConnectWallet, walletPubkey }) {
  const connected = !!walletPubkey;
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(168,127,255,.14),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(151,252,228,.08),transparent 50%)',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');@import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');@keyframes nexus-pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes nexus-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}`}</style>

      <div style={{
        width: '100%', maxWidth: 480,
        padding: '54px 28px 50px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(168,127,255,.22)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(168,127,255,.10)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>

        <div style={{ position: 'relative' }}>
          <h1 style={{
            fontSize: 38, lineHeight: 1.0, fontWeight: 600,
            margin: 0, letterSpacing: '-.045em',
            background: `linear-gradient(135deg,${C.inkStr} 0%,${C.violet} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            ...T.hero,
          }}>
            Coming soon
          </h1>
        </div>
      </div>
    </div>
  );
}

function PerpsTradeInner({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState(() => loadCachedCharts().hours);
  const [sparkMap,   setSparkMap]   = useState(() => loadCachedCharts().sparks);
  const [marketData, setMarketData] = useState(() => {
    const cached = loadCachedMarkets('nexus_marketdata');
    if (cached && cached.length > 0) return cached;
    return PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, change1h: 0, spark: [], volume24h: 0, openInterest: 0, funding: 0, assetIndex: null, szDecimals: 4 }));
  });
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter]                 = useState('All');
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [allPerps, setAllPerps]     = useState(() => loadCachedMarkets('nexus_allperps') || []);
  const [spotSymbols, setSpotSymbols] = useState(() => new Set());
  const [listingDateMap, setListingDateMap] = useState(() => loadListingDates());

  const allPerpsRef = useRef(allPerps);
  useEffect(() => { allPerpsRef.current = allPerps; }, [allPerps]);

  const { publicKey: solPk, wallet: solWallet } = useWallet();
  const { connection } = useConnection();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  const [hlWallet, setHlWallet]         = useState(null);
  const [hlBalance, setHlBalance]       = useState(0);
  const [hlAvailable, setHlAvailable]   = useState(0);
  const [hlMarginUsed, setHlMarginUsed] = useState(0);
  const [positions, setPositions]       = useState([]);
  const [solLamports, setSolLamports]   = useState(0);
  const [solPrice, setSolPrice]         = useState(0);

  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    if (addr) setHlWallet({ address: addr });
    const cached = loadCachedAccount(walletPubkey);
    if (cached) {
      if (typeof cached.balance === 'number')         setHlBalance(cached.balance);
      if (typeof cached.withdrawable === 'number')    setHlAvailable(cached.withdrawable);
      if (typeof cached.marginUsed === 'number')      setHlMarginUsed(cached.marginUsed);
      if (Array.isArray(cached.positions))            setPositions(cached.positions);
      if (typeof cached.solLamports === 'number')     setSolLamports(cached.solLamports);
      if (typeof cached.solPrice === 'number' && cached.solPrice > 0) setSolPrice(cached.solPrice);
    }
  }, [walletPubkey]);

  const refreshAccount = useCallback(async () => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    if (addr && !hlWallet) setHlWallet({ address: addr });
    const [lam, price, bp] = await Promise.all([
      solPk ? fetchSolBalance(connection, solPk) : Promise.resolve(0),
      fetchSolPrice().catch(() => 0),
      addr ? fetchHlBalanceAndPositions(addr) : Promise.resolve(null),
    ]);
    setSolLamports(lam);
    if (price > 0) setSolPrice(price);
    if (bp) {
      setHlBalance(bp.balance);
      setHlAvailable(bp.withdrawable);
      setHlMarginUsed(bp.marginUsed);
      setPositions(bp.positions);
    }
    const existing = loadCachedAccount(walletPubkey) || {};
    saveCachedAccount(walletPubkey, {
      balance:      bp ? bp.balance      : existing.balance      ?? 0,
      withdrawable: bp ? bp.withdrawable : existing.withdrawable ?? 0,
      marginUsed:   bp ? bp.marginUsed   : existing.marginUsed   ?? 0,
      positions:    bp ? bp.positions    : existing.positions    ?? [],
      solLamports:  lam,
      solPrice:     price > 0 ? price : existing.solPrice,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletPubkey, solPk, connection]);

  const refreshAfterAction = useCallback(() => {
    refreshAccount?.();
    setTimeout(() => refreshAccount?.(), 1500);
    setTimeout(() => refreshAccount?.(), 3500);
    setTimeout(() => refreshAccount?.(), 7000);
    setTimeout(() => refreshAccount?.(), 12000);
  }, [refreshAccount]);

  useEffect(() => {
    if (!walletPubkey) return;
    let alive = true;
    const tick = () => { if (alive) refreshAccount(); };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [walletPubkey, refreshAccount]);

  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    const inFlight = loadBridge('deposit');
    if (!addr || !inFlight) return;
    let alive = true;
    pollUntilFunded(addr, inFlight.usd)
      .then(() => { if (alive) { clearBridge('deposit'); refreshAfterAction(); } })
      .catch(() => { if (alive) clearBridge('deposit'); });
    return () => { alive = false; };
  }, [walletPubkey, refreshAfterAction]);

  useEffect(() => { getEthers().catch(() => {}); }, []);

  useEffect(() => {
    ensureLifiConfig();
    if (!solWallet?.adapter) return;
    try {
      lifiConfig.setProviders([
        LifiSolana({
          async getWalletAdapter() {
            return solWallet.adapter;
          },
        }),
      ]);
    } catch (e) {
      console.warn('[lifi setProviders]', e);
    }
  }, [solWallet?.adapter]);

  // Baseline market poll — every 10s, all the time.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { curated, all } = await fetchMarketSnapshot({ spotSymbols, oneHourMap, sparkMap });
        if (!alive) return;
        if (curated && curated.length > 0) {
          setMarketData(curated);
          saveCachedMarkets('nexus_marketdata', curated);
        }
        if (all && all.length > 0) {
          setAllPerps(all);
          saveCachedMarkets('nexus_allperps', all);
        }
      } catch (e) {
        console.warn('[market poll]', e?.message || e);
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotSymbols, oneHourMap, sparkMap]);

  // FAST poll while the "New" tab is active — every 5s, plus an immediate
  // fetch on tab switch. This is what makes brand-new HL listings show up
  // within seconds instead of waiting on browser caches.
  useEffect(() => {
    if (filter !== 'New') return;
    let alive = true;
    const poll = async () => {
      try {
        const { curated, all } = await fetchMarketSnapshot({ spotSymbols, oneHourMap, sparkMap });
        if (!alive) return;
        if (curated?.length) { setMarketData(curated); saveCachedMarkets('nexus_marketdata', curated); }
        if (all?.length)     { setAllPerps(all);       saveCachedMarkets('nexus_allperps', all); }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!marketData.length) return;
      try {
        const map = await fetchOneHourMap(marketData);
        if (!alive) return;
        setOneHourMap(prev => ({ ...prev, ...map }));
      } catch {}
    };
    poll();
    const id = setInterval(poll, 120_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activePair?.id) return;
    if (oneHourMap[activePair.id] != null) return;
    let alive = true;
    fetchOneHourChange(activePair.id).then(v => {
      if (!alive) return;
      setOneHourMap(prev => ({ ...prev, [activePair.id]: v }));
    });
    return () => { alive = false; };
  }, [activePair?.id, oneHourMap]);

  // Sparkline poll for the curated "All" markets. New/Discover tabs fetch
  // their own sparks lazily (see effects below). This keeps initial paint fast.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!marketData.length) return;
      try {
        const map = await fetchSparkMap(marketData);
        if (!alive) return;
        setSparkMap(prev => ({ ...prev, ...map }));
      } catch {}
    };
    poll();
    const id = setInterval(poll, 90_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activePair?.id) return;
    if (Array.isArray(sparkMap[activePair.id]) && sparkMap[activePair.id].length > 0) return;
    let alive = true;
    fetchSparkline(activePair.id).then(v => {
      if (!alive) return;
      setSparkMap(prev => ({ ...prev, [activePair.id]: v }));
    });
    return () => { alive = false; };
  }, [activePair?.id, sparkMap]);

  // When the New tab opens, fetch real listing dates for any perps we
  // don't yet have. Cached forever in localStorage per coin.
  useEffect(() => {
    if (filter !== 'New') return;
    if (!Array.isArray(allPerps) || allPerps.length === 0) return;

    const live = allPerps.filter(passesBaseFilter);
    // Only fetch for perps with high assetIndex (recently added) that we
    // haven't already resolved. HL adds new perps at higher indices, so
    // scanning the top 60 covers the realistic "recent" window cheaply.
    const sorted = live.slice().sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0));
    const unknown = sorted
      .filter(p => listingDateMap[p.id] == null)
      .slice(0, 60);
    if (unknown.length === 0) return;

    let alive = true;
    (async () => {
      // Throttle: 5 at a time
      const chunkSize = 5;
      const updates = {};
      for (let i = 0; i < unknown.length; i += chunkSize) {
        const chunk = unknown.slice(i, i + chunkSize);
        const results = await Promise.all(chunk.map(p => fetchListingDate(p.base || p.id)));
        if (!alive) return;
        chunk.forEach((p, idx) => {
          const ts = results[idx];
          if (typeof ts === 'number' && ts > 0) {
            updates[p.id] = ts;
          } else {
            // Mark as resolved-but-old so we don't refetch.
            updates[p.id] = 1;
          }
        });
      }
      if (!alive || Object.keys(updates).length === 0) return;
      setListingDateMap(prev => {
        const next = { ...prev, ...updates };
        saveListingDates(next);
        return next;
      });
    })();
    return () => { alive = false; };
  }, [filter, allPerps]);

  useEffect(() => {
    if (filter !== 'New') return;
    const newRows = filterNewListings(allPerps, listingDateMap);
    const missingSpark = newRows.filter(p => !Array.isArray(sparkMap[p.id]) || sparkMap[p.id].length === 0);
    const missingHour  = newRows.filter(p => oneHourMap[p.id] == null);
    if (missingSpark.length === 0 && missingHour.length === 0) return;
    let alive = true;
    (async () => {
      if (missingSpark.length > 0) {
        const vals = await Promise.all(missingSpark.map(p => fetchSparkline(p.id)));
        if (!alive) return;
        setSparkMap(prev => {
          const next = { ...prev };
          missingSpark.forEach((p, i) => { next[p.id] = Array.isArray(vals[i]) ? vals[i] : []; });
          return next;
        });
      }
      if (missingHour.length > 0) {
        const vals = await Promise.all(missingHour.map(p => fetchOneHourChange(p.id)));
        if (!alive) return;
        setOneHourMap(prev => {
          const next = { ...prev };
          missingHour.forEach((p, i) => { next[p.id] = Number.isFinite(vals[i]) ? vals[i] : 0; });
          return next;
        });
      }
    })();
    return () => { alive = false; };
  }, [filter, allPerps, sparkMap, oneHourMap, listingDateMap]);

  // Discover tab: lazy-fetch spark + 1h change for the currently filtered rows
  // (top 15 or search results). Limits to 30 max per pass to keep snappy.
  useEffect(() => {
    if (filter !== 'Discover') return;
    if (!allPerps.length) return;
    const curatedIds = new Set(marketData.map(p => p.id));
    const q = discoverSearch.trim().toUpperCase();
    const rows = q
      ? allPerps
          .filter(p => p.price > 0 && (p.base || '').toUpperCase().includes(q))
          .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
          .slice(0, 30)
      : allPerps
          .filter(p => p.price > 0 && !curatedIds.has(p.id))
          .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
          .slice(0, 15);
    const missingSpark = rows.filter(p => !Array.isArray(sparkMap[p.id]) || sparkMap[p.id].length === 0);
    const missingHour  = rows.filter(p => oneHourMap[p.id] == null);
    if (missingSpark.length === 0 && missingHour.length === 0) return;
    let alive = true;
    (async () => {
      if (missingSpark.length > 0) {
        const vals = await Promise.all(missingSpark.map(p => fetchSparkline(p.id)));
        if (!alive) return;
        setSparkMap(prev => {
          const next = { ...prev };
          missingSpark.forEach((p, i) => { next[p.id] = Array.isArray(vals[i]) ? vals[i] : []; });
          return next;
        });
      }
      if (missingHour.length > 0) {
        const vals = await Promise.all(missingHour.map(p => fetchOneHourChange(p.id)));
        if (!alive) return;
        setOneHourMap(prev => {
          const next = { ...prev };
          missingHour.forEach((p, i) => { next[p.id] = Number.isFinite(vals[i]) ? vals[i] : 0; });
          return next;
        });
      }
    })();
    return () => { alive = false; };
  }, [filter, discoverSearch, allPerps, marketData, sparkMap, oneHourMap]);

  useEffect(() => {
    saveCachedCharts(sparkMap, oneHourMap);
  }, [sparkMap, oneHourMap]);

  useEffect(() => {
    if (!activePair?.id) return;
    const fresh = marketData.find(p => p.id === activePair.id)
      || allPerps.find(p => p.id === activePair.id);
    if (fresh) setActivePair(prev => ({ ...prev, ...fresh }));
  }, [marketData, allPerps, activePair?.id]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const s = await fetchSpotSymbols(); if (alive) setSpotSymbols(s); }
      catch {}
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Discover: top 15 by 24h volume from the FULL HL universe (allPerps), excluding
  // anything already in the curated "All" list. If user types a search, filter the
  // full universe by name instead of capping at 15.
  const filtered = useMemo(() => {
    if (filter === 'New') return filterNewListings(allPerps, listingDateMap);
    if (filter === 'Discover') {
      const curatedIds = new Set(marketData.map(p => p.id));
      const q = discoverSearch.trim().toUpperCase();
      if (q.length > 0) {
        // Search any coin — match base name (BTC, FARTCOIN, etc.). Up to 50 results.
        return allPerps
          .filter(p => p.price > 0 && (p.base || '').toUpperCase().includes(q))
          .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
          .slice(0, 50);
      }
      // Default: top 15 by 24h volume, excluding curated
      return allPerps
        .filter(p => p.price > 0 && !curatedIds.has(p.id))
        .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 15);
    }
    return marketData;
  }, [marketData, allPerps, filter, discoverSearch, listingDateMap]);

  const totalVol = marketData.reduce((s, p) => s + Number(p.volume24h || 0), 0);
  const gainers  = marketData.filter(p => p.change > 0).length;
  const openTrade = (pair) => { setActivePair(pair); setDrawerOpen(true); };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin  { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; } input[type="range"]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.07);border-radius:99px;outline:none;} input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:rgba(255,255,255,.07);} input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;box-shadow:0 0 0 4px rgba(151,252,228,.55),0 2px 6px rgba(0,0,0,.35);margin-top:-8px;transition:transform .12s;} input[type="range"]::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.08);} input[type="range"]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;}`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl, boxShadow: `0 0 10px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POWERED BY HYPERLIQUID</span>
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
              Trade{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>perpetuals</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Connect your Solana wallet. Pick a market. Long or short -- that's it.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[{ label: 'MARKETS', value: marketData.length || '-' }, { label: '24H VOL', value: shortNum(totalVol) }, { label: 'GAINERS', value: `${gainers}/${marketData.length}` }].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>Markets</div>
            <div style={{ color: C.muted2, fontSize: 10, fontWeight: 600, marginTop: 2, ...T.mono }}>Tap any market to trade</div>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {['All', 'New', 'Discover'].map(f => (
              <button key={f} onClick={() => { setFilter(f); if (f !== 'Discover') setDiscoverSearch(''); }} style={{ padding: '7px 11px', borderRadius: 999, border: `1px solid ${filter === f ? C.borderHi : C.border}`, background: filter === f ? C.hlDim : 'rgba(255,255,255,.03)', color: filter === f ? C.hl : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.body }}>{f}</button>
            ))}
          </div>
        </div>

        {filter === 'Discover' && (
          <div style={{ marginBottom: 10, position: 'relative' }}>
            <input
              value={discoverSearch}
              onChange={e => setDiscoverSearch(e.target.value)}
              placeholder="Search any coin... (e.g. FARTCOIN, WLD, kBONK)"
              inputMode="search"
              enterKeyHint="search"
              style={{
                width: '100%', padding: '11px 14px 11px 38px',
                background: 'rgba(255,255,255,.04)',
                border: `1px solid ${C.border}`,
                borderRadius: 12, fontSize: 13, fontWeight: 600,
                color: C.inkStr, outline: 'none',
                ...T.body,
              }}
            />
            <div style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: C.muted2, fontSize: 14, fontWeight: 700, ...T.mono }}>{'🔍'}</div>
            {discoverSearch && (
              <button onClick={() => setDiscoverSearch('')} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,.06)', border: 'none',
                color: C.muted, width: 24, height: 24, borderRadius: 6,
                fontSize: 14, cursor: 'pointer',
              }}>×</button>
            )}
            <div style={{ marginTop: 6, fontSize: 10, color: C.muted2, fontWeight: 600, ...T.mono }}>
              {discoverSearch.trim() ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `Top 15 by volume — search to find any of ${allPerps.length} markets`}
            </div>
          </div>
        )}

        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {filtered.map(p => <MarketRow key={p.id} pair={p} onClick={() => openTrade(p)}/>)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>HYPERLIQUID</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>

        <TradeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          pair={activePair}
          onConnectWallet={onConnectWallet}
          walletPubkey={walletPubkey}
          marketData={marketData}
          allPerps={allPerps}
          hlWallet={hlWallet} setHlWallet={setHlWallet}
          hlBalance={hlBalance} setHlBalance={setHlBalance}
          hlAvailable={hlAvailable} setHlAvailable={setHlAvailable}
          hlMarginUsed={hlMarginUsed} setHlMarginUsed={setHlMarginUsed}
          positions={positions} setPositions={setPositions}
          solLamports={solLamports} setSolLamports={setSolLamports}
          solPrice={solPrice}
          refreshAccount={refreshAccount}
          refreshAfterAction={refreshAfterAction}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VIP gate: checks connected wallet against VIP_WALLETS.
// Non-VIPs get "Coming Soon", VIPs get full perps trading.
// ─────────────────────────────────────────────────────────────────────
export default function PerpsTrade({ onConnectWallet }) {
  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  const isVip = walletPubkey && VIP_WALLETS.has(walletPubkey);

  if (!isVip) {
    return <VipComingSoon onConnectWallet={onConnectWallet} walletPubkey={walletPubkey}/>;
  }
  return <PerpsTradeInner onConnectWallet={onConnectWallet}/>;
}
