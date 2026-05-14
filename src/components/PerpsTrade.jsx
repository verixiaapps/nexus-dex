import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { signL1Action } from '@nktkas/hyperliquid/signing';
import {
  createConfig as lifiCreateConfig,
  config as lifiConfig,
  Solana as LifiSolana,
  getRoutes as lifiGetRoutes,
  executeRoute as lifiExecuteRoute,
  getChains as lifiGetChains,
  getTokens as lifiGetTokens,
} from '@lifi/sdk';

/* -- NEXUS DEX -----------------------------------------------------
   Connect Solana wallet -> pick market -> Long / Short -> done.
   Bridge: Li.Fi (Solana -> HyperCore, one signature in user's Solana wallet).
   Non-custodial: HL EVM wallet derived from Solana signMessage (session only).
------------------------------------------------------------------- */

const ENABLE_TRADING        = process.env.REACT_APP_HYPERLIQUID_LIVE_TRADING === '1';
const BUILDER_ADDRESS       = '';   // <- set your EVM address to earn builder fees
const BUILDER_FEE_TENTHS_BP = 5;
const LIFI_INTEGRATOR       = 'NexusDEX';
const LIFI_FEE_RECIPIENT    = '';   // <- optional Li.Fi integrator fee recipient (EVM addr)
const LIFI_FEE              = 0;    // <- optional, e.g. 0.0025 = 25 bps

// Native SOL on Solana = System Program address. Li.Fi treats this as native.
// (We previously used the wSOL mint - some Li.Fi route validators interpret
// that as the SPL token, fail to find a wSOL token account, and report a
// misleading 'balance is too low' error.)
const SOL_MINT              = '11111111111111111111111111111111';
const SOL_WRAPPED_MINT      = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL      = 1_000_000_000;

// Solana in Li.Fi
const LIFI_SOLANA_CHAIN_ID  = 1151111081099710;

// HyperCore chain id + USDC token address are discovered at runtime from Li.Fi
// so we don't have to hardcode anything. Fallbacks below are last-resort.
const HYPERCORE_FALLBACK_CHAIN_ID = 1337;
const HYPERCORE_FALLBACK_USDC     = '0x0000000000000000000000000000000000000000';

const DERIVATION_MSG        = (pub) =>
  `Nexus DEX: Authorize HyperCore Account\n\nWallet: ${pub}\n\nThis creates your non-custodial trading account. No SOL is spent.`;

/* -- Li.Fi one-time SDK config ------------------------------------ */
let _lifiConfigured = false;
function ensureLifiConfig() {
  if (_lifiConfigured) return;
  lifiCreateConfig({
    integrator: LIFI_INTEGRATOR,
    ...(LIFI_FEE_RECIPIENT && LIFI_FEE > 0
      ? { integratorFee: LIFI_FEE, integratorFeeRecipient: LIFI_FEE_RECIPIENT }
      : {}),
  });
  _lifiConfigured = true;
}

/* -- Design tokens ------------------------------------------------ */
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

/* -- Scroll lock -------------------------------------------------- */
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

/* -- Formatters --------------------------------------------------- */
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

/* HL precision: size to szDecimals; price to 5 sig figs AND max (6 - szDecimals)
   decimal places for perps. */
function roundSize(value, szDecimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const d = Math.max(0, Math.min(szDecimals, 8));
  // Truncate (don't round up) so we never exceed available margin
  const factor = Math.pow(10, d);
  const truncated = Math.floor(n * factor) / factor;
  return truncated.toFixed(d);
}
function roundHlPx(value, szDecimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  // Max 5 sig figs
  const sigFigs = 5;
  let s = n.toPrecision(sigFigs);
  // Convert away from scientific notation
  s = Number(s).toString();
  // Cap decimals at (6 - szDecimals) for perps
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const num = Number(s);
  const factor = Math.pow(10, maxDecimals);
  return (Math.round(num * factor) / factor).toString();
}
function aggressivePx(mid, isLong, szDecimals = 4) {
  const px = Number(mid);
  if (!Number.isFinite(px) || px <= 0) return '0';
  return roundHlPx(isLong ? px * 1.10 : px * 0.90, szDecimals);
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

/* -- Ethers lazy-load (only for HL withdrawal EIP-712 signing) ---- */
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

/* -- Session wallet (derived from Solana key, never persisted) ---- */
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

/* -- Cached HL address (public info; survives browser restart) ---- */
function getKnownHlAddress(solPubkey) {
  try { return localStorage.getItem('nexus_hl_addr_' + solPubkey) || null; }
  catch { return null; }
}
function setKnownHlAddress(solPubkey, address) {
  try { localStorage.setItem('nexus_hl_addr_' + solPubkey, address); } catch {}
}
// Returns HL address from session (with private key) or localStorage (address only)
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

/* -- Cached account snapshot (instant first paint) ---------------- */
function loadCachedAccount(walletPubkey) {
  if (!walletPubkey) return null;
  try {
    const raw = localStorage.getItem('nexus_acct_' + walletPubkey);
    if (!raw) return null;
    const d = JSON.parse(raw);
    // Cache TTL: 24h. Stale data is fine for first paint; fresh data overwrites in seconds.
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

/* -- Solana balance ----------------------------------------------- */
async function fetchSolBalance(connection, publicKey) {
  try { return await connection.getBalance(publicKey); }
  catch { return 0; }
}
async function fetchSolPrice() {
  const r = await fetch('/api/sol-price');
  if (!r.ok) throw new Error('SOL price unavailable');
  const d = await r.json();
  if (!d.price || d.price <= 0) throw new Error('SOL price unavailable');
  return Number(d.price);
}

/* -- Hyperliquid API ---------------------------------------------- */
async function hlRequest(body, isExchange = false) {
  const path = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res  = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  const balance = parseFloat(state?.marginSummary?.accountValue || 0);
  const positions = !state ? [] : (state.assetPositions || [])
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
  return { balance, positions };
}

/* -- Poll until funded -------------------------------------------- */
async function pollUntilFunded(hlAddress, targetUsd, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { balance } = await fetchHlBalanceAndPositions(hlAddress);
    if (balance >= targetUsd * 0.97) return balance;
    await new Promise(r => setTimeout(r, 4_000));
  }
  throw new Error('Bridge is taking longer than expected. Your SOL is safe - refresh to check.');
}

/* -- Discover HyperCore chain + USDC address from Li.Fi at runtime  */
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

/* -- Li.Fi deposit: SOL -> HyperCore (one wallet popup) ----------- */
/* -- Resolve native SOL address from Li.Fi at runtime ------------- */
let _solAddrCache = null;
async function resolveSolNativeAddress() {
  if (_solAddrCache) return _solAddrCache;
  try {
    const { tokens } = await lifiGetTokens({ chains: [LIFI_SOLANA_CHAIN_ID] });
    const list = tokens?.[LIFI_SOLANA_CHAIN_ID] || [];
    // Prefer the entry Li.Fi marks as native (priceUSD set, symbol SOL).
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

  onStatus?.('Finding route...');
  const hyperCore = await resolveHyperCoreChain();
  const solAddr   = await resolveSolNativeAddress();
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
  const route = result.routes[0];

  onStatus?.('Sign in wallet...');
  const executed = await lifiExecuteRoute(route, {
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

  onStatus?.('Bridging...');
  return { txHash };
}

/* -- Withdraw: sign withdraw3 with derived EVM key ---------------- */
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
  // EIP-712 message is exactly these 4 fields. The action object from the
  // backend may also carry `type` and `signatureChainId` - those go in the
  // outer request body but are NOT part of the typed-data hash. Pass only the
  // signed fields so strict signers don't choke on extras.
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

/* -- Bridge tracking ---------------------------------------------- */
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

/* -- Order building (notional = margin * leverage for opens) ------ */
function buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly = false }) {
  if (!ENABLE_TRADING) throw new Error('Trading is disabled - set REACT_APP_HYPERLIQUID_LIVE_TRADING=1');
  const assetIndex = pair?.assetIndex;
  const price      = Number(pair?.price || 0);
  const margin     = Number(usdAmount || 0);
  // Clamp leverage to pair's max - HL silently caps and would otherwise reject
  // the order for insufficient margin against the EFFECTIVE leverage.
  const maxLev     = Math.max(1, Math.floor(Number(pair?.leverage || 1)));
  const lev        = Math.min(Math.max(1, Number(leverage || 1)), maxLev);
  const szDecimals = Number.isInteger(pair?.szDecimals) ? pair.szDecimals : 4;

  if (!Number.isInteger(assetIndex) || assetIndex < 0) throw new Error('Market loading, try again');
  if (!Number.isFinite(price) || price <= 0)           throw new Error('Price unavailable, try again');
  if (!Number.isFinite(margin) || margin < 10)         throw new Error('Minimum order is $10');

  // For new orders: notional = margin * leverage. For close: pass the position value directly.
  // 3% safety buffer on opens so HL's margin engine doesn't reject for fee/rounding slop.
  const notional = reduceOnly ? margin : margin * lev * 0.97;
  // Size against LIMIT price (worst-case fill), not mid. HL evaluates margin
  // requirement at the limit price, so sizing from mid blows past available
  // margin when the slippage buffer pushes max notional above margin*leverage.
  const limitPx = aggressivePx(price, isLong, szDecimals);
  const sizingPx = isLong ? Math.max(price, parseFloat(limitPx)) : Math.min(price, parseFloat(limitPx));
  const coinSize = roundSize(notional / sizingPx, szDecimals);

  if (parseFloat(coinSize) <= 0) throw new Error('Order size too small for this market');

  const action  = {
    type: 'order',
    orders: [{
      a: assetIndex, b: Boolean(isLong),
      p: limitPx, s: coinSize,
      r: Boolean(reduceOnly),
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
  };
  if (isValidEthAddress(BUILDER_ADDRESS)) {
    action.builder = { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP };
  }
  return { action, coinSize, notional, limitPx, margin };
}

/* -- Set leverage on HL account ----------------------------------- */
async function setLeverageOnHL({ assetIndex, leverage, isCross = false, hlWalletData }) {
  const action = { type:'updateLeverage', asset:assetIndex, isCross, leverage };
  const nonce  = Date.now();
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action, nonce });
  return hlRequest({ action, nonce, signature }, true);
}

// Cache per-asset leverage so we only call updateLeverage on change
const _leverageCache = new Map();
async function placeOrder({ pair, isLong, usdAmount, leverage, reduceOnly = false, hlWalletData }) {
  if (!hlWalletData?.privateKey) throw new Error('Trading account not ready');
  const cacheKey = `${hlWalletData.address}:${pair.assetIndex}`;
  if (_leverageCache.get(cacheKey) !== leverage) {
    try {
      await setLeverageOnHL({ assetIndex:pair.assetIndex, leverage, hlWalletData });
      _leverageCache.set(cacheKey, leverage);
    } catch (e) { console.warn('[leverage]', e.message); }
  }
  const built  = buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly });
  const nonce  = Date.now();
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action: built.action, nonce });
  const result = await hlRequest({ action: built.action, nonce, signature }, true);
  if (result?.status === 'err') {
    const reason = typeof result?.response === 'string'
      ? result.response
      : JSON.stringify(result);
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
// One API hit -> both views. Returns { curated, all }.
// Curated = the 18 in PERPS_PAIRS for the All/Hot/Gainers/Losers tabs.
// All     = the full HL universe for the New tab.
// THROWS on failure so the caller can keep prior good data (no zero-flicker).
async function fetchMarketSnapshot({ spotSymbols = new Set(), oneHourMap = {}, sparkMap = {} } = {}) {
  const [metaAndCtxs, mids] = await Promise.all([
    hlRequest({ type: 'metaAndAssetCtxs' }),
    hlRequest({ type: 'allMids' }),
  ]);
  const meta      = Array.isArray(metaAndCtxs) ? metaAndCtxs[0] : {};
  const assetCtxs = Array.isArray(metaAndCtxs) ? metaAndCtxs[1] || [] : [];
  const universe  = (meta.universe || []).map((u, i) => ({
    name: u.name, index: i,
    maxLeverage: u.maxLeverage || 10,
    szDecimals:  Number.isInteger(u.szDecimals) ? u.szDecimals : 4,
    ctx: assetCtxs[i] || {},
  }));
  const firstSeen = updateFirstSeenRegistry(universe.map(u => u.name));
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
      firstSeenAt: firstSeen[u.name] || null,
      hot:         false,
    };
  });
  const allById = new Map(all.map(p => [p.id, p]));
  const curated = PERPS_PAIRS.map(p => {
    const found = allById.get(p.id);
    if (!found) return null;
    return {
      ...found,
      hot: !!p.hot,
      // honor the curated leverage cap
      leverage: Math.min(found.leverage, p.leverage),
    };
  }).filter(Boolean);
  return { curated, all };
}

/* -- Spot universe + first-seen registry for "New" tab ------------ */
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

function getFirstSeenRegistry() {
  try { return JSON.parse(localStorage.getItem('nexus_first_seen') || '{}'); }
  catch { return {}; }
}
function getInstallTs() {
  try {
    const v = localStorage.getItem('nexus_install_ts');
    return v ? parseInt(v, 10) : null;
  } catch { return null; }
}
function updateFirstSeenRegistry(coinNames) {
  try {
    const raw = localStorage.getItem('nexus_first_seen');
    const isFirstRun = !raw;
    const reg = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    if (isFirstRun) {
      localStorage.setItem('nexus_install_ts', String(now));
    }
    let changed = false;
    coinNames.forEach(name => {
      if (!reg[name]) { reg[name] = now; changed = true; }
    });
    if (changed) localStorage.setItem('nexus_first_seen', JSON.stringify(reg));
    return reg;
  } catch { return {}; }
}

// HL uses "k" prefix for 1000x memecoin perps (kPEPE, kBONK, kSHIB) while spot
// lists the base name. Match both ways.
function hasSpotMatch(perpName, spotSymbols) {
  if (!perpName) return false;
  if (spotSymbols.has(perpName)) return true;
  if (perpName.startsWith('k') && spotSymbols.has(perpName.slice(1))) return true;
  return false;
}

// "New" tab: sort by HL asset index descending (newer = higher index), apply
// quality filters, take top 6. Cap is intentionally tight so only genuinely
// new HL listings show - older popular perps don't bubble up to fill slots.
// Ranks are assigned by FILTERED position so badges match display order.
function filterNewListings(allPerps) {
  return allPerps
    .filter(p => p.hasSpot)
    .filter(p => p.volume24h >= 500_000)
    .filter(p => p.price > 0)
    .sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0))
    .slice(0, 6)
    .map((p, idx) => ({ ...p, newnessRank: idx }));
}

// Freshness badge by asset-index rank: highest index = newest listing on HL.
// Top 3 = JUST LISTED, next 4 = NEW, next 5 = FRESH. Anything below rank 12
// gets no badge. The pair's `newnessRank` is set in fetchMarketSnapshot.
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
  const limited = markets.slice(0, 40);
  const vals    = await Promise.all(limited.map(p => fetchOneHourChange(p.id)));
  const map     = {};
  limited.forEach((p, i) => { map[p.id] = Number.isFinite(vals[i]) ? vals[i] : 0; });
  return map;
}
async function fetchSparkMap(markets) {
  const limited = markets.slice(0, 40);
  const vals    = await Promise.all(limited.map(p => fetchSparkline(p.id)));
  const map     = {};
  limited.forEach((p, i) => { map[p.id] = Array.isArray(vals[i]) ? vals[i] : []; });
  return map;
}

/* -- Visual components -------------------------------------------- */
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

/* -- Positions panel ---------------------------------------------- */
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

/* -- Wallet panel ------------------------------------------------- */
function WalletPanel({ solLamports, solPrice, hlBalanceUsd, hlAddress, onWithdraw, onDeposit, onSync, syncing }) {
  const solUsd     = (solLamports / LAMPORTS_PER_SOL) * solPrice;
  const totalUsd   = solUsd + hlBalanceUsd;
  const hlSolEquiv = solPrice > 0 ? hlBalanceUsd / solPrice : 0;
  const canWithdraw = hlBalanceUsd > 0;
  const needsSync   = !hlAddress;
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
          <div style={{ fontSize: 15, fontWeight: 800, color: hlBalanceUsd > 0 ? C.hl : C.muted, ...T.mono }}>
            {needsSync ? '--' : (hlSolEquiv > 0 ? hlSolEquiv.toFixed(3) + ' SOL' : '--')}
          </div>
          <div style={{ fontSize: 11, color: needsSync ? C.amber : C.muted, marginTop: 2, ...T.mono }}>
            {needsSync ? 'Not synced' : (hlBalanceUsd > 0 ? fmt(hlBalanceUsd, 2) : 'Empty')}
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {hlAddress
            ? <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>{hlAddress.slice(0, 6)}...{hlAddress.slice(-4)}</span>
            : <span style={{ fontSize: 10, color: C.amber, ...T.mono }}>Sign to view positions</span>}
          {onSync && (
            <button onClick={syncing ? undefined : onSync} disabled={syncing} style={{
              padding: '4px 9px', borderRadius: 7,
              border: `1px solid ${needsSync ? 'rgba(245,181,61,.40)' : C.border}`,
              background: needsSync ? 'rgba(245,181,61,.10)' : 'transparent',
              color: needsSync ? C.amber : C.muted,
              fontSize: 10, fontWeight: 700, cursor: syncing ? 'wait' : 'pointer',
              opacity: syncing ? 0.5 : 1, ...T.mono,
            }}>{syncing ? '...' : (needsSync ? 'Sync' : 'R')}</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onDeposit} style={{
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid rgba(151,252,228,.30)',
            background: 'rgba(151,252,228,.10)',
            color: C.hl, fontWeight: 700, fontSize: 11, cursor: 'pointer', ...T.mono,
          }}>+ Deposit</button>
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
    </div>
  );
}

/* -- Withdraw modal ----------------------------------------------- */
function WithdrawModal({ open, onClose, hlAddress, hlPrivateKey, hlBalance, walletPubkey }) {
  const [amount, setAmount]         = useState('');
  const [status, setStatus]         = useState('idle');
  const [statusMsg, setStatusMsg]   = useState('');
  const [error, setError]           = useState('');
  const pollRef                     = useRef(null);
  const failedRef                   = useRef(false);

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setAmount(''); setStatus('idle'); setError(''); setStatusMsg('');
      failedRef.current = false;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  const isBusy = status === 'loading' || status === 'polling';
  const isDone = status === 'complete';

  const handleWithdraw = async () => {
    const usd = parseFloat(amount);
    if (!usd || usd < 2)        { setError('Minimum withdrawal is $2'); return; }
    if (usd > hlBalance * 0.99) { setError('Amount exceeds available balance'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana destination'); return; }

    setStatus('loading'); setError(''); setStatusMsg('Initiating withdrawal...');
    failedRef.current = false;
    try {
      const init = await fetch('/api/bridge/withdraw/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hl_wallet_address: hlAddress, usd_amount: usd, user_sol_addr: walletPubkey }),
      });
      const initData = await init.json();
      if (!init.ok) throw new Error(initData.error || 'Init failed');

      setStatusMsg('Signing withdrawal...');
      const signature = await signHlWithdraw(hlPrivateKey, initData.action);

      setStatusMsg('Submitting to Hyperliquid...');
      const submit = await fetch('/api/bridge/withdraw/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_id: initData.tracking_id, signature }),
      });
      const submitData = await submit.json();
      if (!submit.ok) throw new Error(submitData.error || 'Submit failed');

      setStatus('polling');
      setStatusMsg('Processing (~4 min)...');
      const tid = initData.tracking_id;
      pollRef.current = setInterval(async () => {
        if (failedRef.current) return;
        try {
          const r    = await fetch('/api/bridge/withdraw/status?id=' + encodeURIComponent(tid));
          if (!r.ok) return; // ignore transient network errors
          const data = await r.json();
          if (data.status === 'bridging')   setStatusMsg('Bridging USDC -> SOL...');
          if (data.status === 'finalizing') setStatusMsg('Finalizing...');
          if (data.status === 'complete') {
            clearInterval(pollRef.current);
            setStatus('complete');
            setStatusMsg('');
          } else if (data.status === 'failed') {
            failedRef.current = true;
            clearInterval(pollRef.current);
            setError(data.error || 'Withdrawal failed');
            setStatus('error');
          }
        } catch {
          // transient fetch/parse error: keep polling
        }
      }, 8_000);

    } catch (e) {
      console.error('[withdraw]', e);
      setError(e.message || 'Withdrawal failed');
      setStatus('error');
    }
  };

  if (!open) return null;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 451,
        maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        padding: '20px 22px calc(env(safe-area-inset-bottom) + 22px)',
        boxShadow: '0 -24px 70px rgba(0,0,0,.6)',
      }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 18, letterSpacing: '-.02em', ...T.display }}>Withdraw</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 3, ...T.body }}>HyperCore -> SOL in your Solana wallet (~4 min)</div>
          </div>
          <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer', opacity: isBusy ? 0.4 : 1 }}>X</button>
        </div>

        <div style={{ padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', marginBottom: 4, ...T.mono }}>AVAILABLE</div>
          <div style={{ fontSize: 15, color: C.hl, fontWeight: 800, ...T.mono }}>{fmt(hlBalance, 2)}</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, opacity: isBusy ? 0.6 : 1 }}>
          <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
          <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
            style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 23, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
          />
          <button onClick={() => setAmount(Math.floor(hlBalance * 0.99).toString())} disabled={isBusy} style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>MAX</button>
        </div>

        <div style={{ padding: '10px 12px', background: 'rgba(245,181,61,.06)', border: '1px solid rgba(245,181,61,.20)', borderRadius: 10, marginBottom: 14, fontSize: 10, color: C.amber, fontWeight: 600, ...T.body }}>
          HL charges a $1 flat withdrawal fee. Bridge ~0.1% fee. ~4 min total.
        </div>

        {(isBusy || isDone) && statusMsg && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isDone && <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>}
            {isDone  && <span style={{ fontSize: 14 }}>OK</span>}
            <span style={{ fontSize: 12, color: isDone ? C.up : C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {isDone && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(61,213,152,.08)', border: '1px solid rgba(61,213,152,.24)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: C.up, fontWeight: 800, ...T.display }}>SOL on its way</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, ...T.body }}>Check your Solana wallet in a moment</div>
          </div>
        )}
        {error && <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

        <div style={{
          position: 'sticky', bottom: 0, paddingTop: 4, marginTop: 4,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 30%)`,
        }}>
        {isDone ? (
          <button onClick={onClose} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display }}>Done</button>
        ) : (
          <button onClick={handleWithdraw} disabled={isBusy || !amount} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none',
            background: `linear-gradient(135deg,${C.violet} 0%,${C.sol} 100%)`,
            color: '#fff', fontWeight: 800, fontSize: 15,
            cursor: isBusy || !amount ? 'not-allowed' : 'pointer',
            minHeight: 52, opacity: !amount || isBusy ? 0.55 : 1, ...T.display,
          }}>
            {isBusy ? 'Processing...' : 'Withdraw to Solana'}
          </button>
        )}
        </div>
      </div>
    </>
  );
}

/* -- Deposit modal ------------------------------------------------ */
function DepositModal({
  open, onClose, walletPubkey,
  hlWallet, setHlWallet,
  solLamports, solPrice,
  signMessage,
  refreshAccount,
}) {
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(open);

  useEffect(() => {
    if (!open) { setAmount(''); setStatus('idle'); setError(''); setStatusMsg(''); }
  }, [open]);

  const solVal       = parseFloat(amount) || 0;
  const usdValue     = solVal * solPrice;
  const solBalance   = solLamports / LAMPORTS_PER_SOL;
  const notEnoughSol = solVal > 0 && solVal > solBalance * 0.98;
  const isBusy       = status === 'loading';
  const isDone       = status === 'complete';

  const quickPct = (p) => {
    const avail = solBalance * 0.95;
    if (avail <= 0) return;
    setAmount((avail * p / 100).toFixed(4));
  };

  const handleDeposit = async () => {
    if (!signMessage)             { setError('Wallet does not support message signing'); return; }
    if (!solVal || solVal < 0.01) { setError('Enter an amount'); return; }
    if (notEnoughSol)             { setError('Not enough SOL in your wallet'); return; }
    if (usdValue < 10)            { setError('Minimum deposit is $10'); return; }

    setStatus('loading'); setError(''); setStatusMsg('Setting up account...');
    try {
      const walletData = await deriveHLWallet(signMessage, walletPubkey);
      if (!hlWallet) setHlWallet({ address: walletData.address });

      const lamports = Math.floor(solVal * LAMPORTS_PER_SOL);
      setStatusMsg('Bridging SOL...');
      const { txHash } = await depositSolToHyperCore({
        solLamports: lamports,
        hlAddress:   walletData.address,
        solPubkey:   walletPubkey,
        onStatus:    setStatusMsg,
      });
      saveBridge('deposit', { txHash, usd: usdValue });
      setStatusMsg('Waiting for funds...');
      await pollUntilFunded(walletData.address, usdValue);
      clearBridge('deposit');
      refreshAccount?.();
      setStatus('complete'); setStatusMsg('');
    } catch (e) {
      console.error('[deposit]', e);
      setError(e.message || 'Deposit failed');
      setStatus('error');
      setStatusMsg('');
      clearBridge('deposit');
    }
  };

  if (!open) return null;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 451,
        maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        padding: '20px 22px calc(env(safe-area-inset-bottom) + 22px)',
        boxShadow: '0 -24px 70px rgba(0,0,0,.6)',
      }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 18, letterSpacing: '-.02em', ...T.display }}>Deposit</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 3, ...T.body }}>SOL -> HyperCore trading account</div>
          </div>
          <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer', opacity: isBusy ? 0.4 : 1 }}>X</button>
        </div>

        <div style={{ padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', marginBottom: 4, ...T.mono }}>AVAILABLE IN WALLET</div>
          <div style={{ fontSize: 15, color: C.inkStr, fontWeight: 800, ...T.mono }}>{solBalance.toFixed(4)} SOL</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, ...T.mono }}>{fmt(solBalance * solPrice, 2)}</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${notEnoughSol ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
          <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
            style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 23, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#14f195,#9945ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#000' }}>O</div>
            <span style={{ fontSize: 12, color: C.ink, fontWeight: 700, ...T.mono }}>SOL</span>
          </div>
        </div>

        {solVal > 0 && solPrice > 0 && (
          <div style={{ marginBottom: 10, fontSize: 11, color: C.muted, textAlign: 'right', ...T.mono }}>~ {fmt(usdValue, 2)}</div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[25, 50, 75, 100].map(p => (
            <button key={p} onClick={() => quickPct(p)} disabled={isBusy} style={{
              flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${C.border}`,
              background: 'rgba(255,255,255,.03)', color: C.muted,
              fontWeight: 700, fontSize: 11, cursor: 'pointer',
              opacity: isBusy ? 0.4 : 1, ...T.mono,
            }}>{p === 100 ? 'Max' : p + '%'}</button>
          ))}
        </div>

        <div style={{ padding: '10px 12px', background: 'rgba(245,181,61,.06)', border: '1px solid rgba(245,181,61,.20)', borderRadius: 10, marginBottom: 14, fontSize: 10, color: C.amber, fontWeight: 600, ...T.body }}>
          One Solana wallet popup. Funds land on HyperCore in ~15-30s.
        </div>

        {notEnoughSol && (
          <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>
            Not enough SOL. You have {solBalance.toFixed(4)} SOL.
          </div>
        )}

        {(isBusy || isDone) && statusMsg && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isDone && <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>}
            {isDone  && <span style={{ fontSize: 14 }}>OK</span>}
            <span style={{ fontSize: 12, color: isDone ? C.up : C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {isDone && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(61,213,152,.08)', border: '1px solid rgba(61,213,152,.24)', borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: C.up, fontWeight: 800, ...T.display }}>Funded</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, ...T.body }}>Ready to trade</div>
          </div>
        )}
        {error && <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

        <div style={{
          position: 'sticky', bottom: 0, paddingTop: 4, marginTop: 4,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 30%)`,
        }}>
        {isDone ? (
          <button onClick={onClose} style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display }}>Done</button>
        ) : (
          <button onClick={handleDeposit} disabled={isBusy || !amount || notEnoughSol} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none',
            background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
            color: '#04070f', fontWeight: 800, fontSize: 15,
            cursor: isBusy || !amount || notEnoughSol ? 'not-allowed' : 'pointer',
            minHeight: 52, opacity: !amount || isBusy || notEnoughSol ? 0.55 : 1, ...T.display,
          }}>
            {isBusy ? 'Processing...' : 'Deposit to Trading Account'}
          </button>
        )}
        </div>
      </div>
    </>
  );
}

/* -- Trade Drawer ------------------------------------------------- */
function TradeDrawer({
  open, onClose, pair, onConnectWallet, walletPubkey, marketData,
  hlWallet, setHlWallet,
  hlBalance, setHlBalance,
  positions, setPositions,
  solLamports, setSolLamports,
  solPrice,
  refreshAccount,
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
  const [depositOpen,  setDepositOpen]  = useState(false);
  const [syncing,      setSyncing]      = useState(false);

  useBodyLock(open && !withdrawOpen && !depositOpen);

  // Auto-clamp leverage to the asset's max when switching markets. Prevents the
  // BTC-at-10x-leverage state from carrying into STABLE-max-3x and failing margin
  // check. Reset triggers on pair.id change (each market) and on pair.leverage
  // change (in case the cap updates from HL's meta).
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
  const liqPrice     = entryPrice > 0
    ? isLong ? entryPrice * (1 - 0.9 / leverage) : entryPrice * (1 + 0.9 / leverage)
    : 0;
  const solBalance   = solLamports / LAMPORTS_PER_SOL;
  const notEnoughSol = solVal > 0 && solVal > solBalance * 0.98;
  const fundingRate  = pair?.funding || 0;

  const quickPct = (p) => {
    const avail = (solLamports / LAMPORTS_PER_SOL) * 0.95;
    if (avail <= 0) return;
    setSolAmount((avail * p / 100).toFixed(4));
  };

  const execute = async () => {
    if (!wcon)            { onConnectWallet?.(); return; }
    if (!signMessage)     { setError('Wallet does not support message signing'); return; }
    if (!solVal || solVal < 0.01) { setError('Enter an amount'); return; }
    if (notEnoughSol)     { setError('Not enough SOL in your wallet'); return; }
    if (!pair?.price)     { setError('Price unavailable, try again'); return; }
    const usd = solVal * solPrice;
    if (usd < 10) { setError('Minimum trade is $10'); return; }

    setStatus('loading'); setError(''); setStatusMsg('');
    try {
      setStatusMsg('Setting up account...');
      const walletData = await deriveHLWallet(signMessage, walletPubkey);
      if (!hlWallet) setHlWallet({ address: walletData.address });

      let { balance: currentHlBal } = await fetchHlBalanceAndPositions(walletData.address);
      setHlBalance(currentHlBal);

      // Deposit margin if needed. Over-fund 5% to absorb Li.Fi fees + slippage so
      // the landed balance reliably covers the requested margin in one shot.
      if (currentHlBal < usd * 0.99) {
        const needed   = usd - currentHlBal;
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
        currentHlBal = await pollUntilFunded(walletData.address, usd);
        // Refetch once more in case the poll returned at the threshold
        const fresh = await fetchHlBalanceAndPositions(walletData.address);
        currentHlBal = fresh.balance;
        setHlBalance(currentHlBal);
        clearBridge('deposit');
      }

      setStatusMsg(`Opening ${isLong ? 'long' : 'short'}...`);
      // Cap margin at 98% of actual landed balance so HL always has a fee reserve.
      // Without this, the first trade after a bridge can fail with "insufficient margin"
      // because fees nibble a few cents off the deposit -- forcing the user to click twice.
      const safeMargin = Math.min(usd, currentHlBal * 0.98);
      if (safeMargin < 10) {
        throw new Error('Balance settled below minimum after fees. Wait a moment and try again.');
      }
      await placeOrder({ pair, isLong, usdAmount: safeMargin, leverage, hlWalletData: walletData });

      setStatus('success');
      setStatusMsg('');
      refreshAccount?.();
      setTimeout(() => { setStatus('idle'); onClose(); }, 2000);
    } catch (e) {
      console.error('[execute]', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setStatusMsg('');
      clearBridge('deposit');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const closePosition = async (pos, posPair) => {
    const walletData = getSessionWallet(walletPubkey);
    if (!walletData?.privateKey) { setError('Session expired - refresh page'); return; }
    const targetPair = posPair || marketData.find(p => p.id === pos.coin);
    if (!targetPair) { setError('Market data unavailable'); return; }

    setStatus('loading'); setError(''); setStatusMsg(`Closing ${pos.coin} position...`);
    try {
      await placeOrder({
        pair:       targetPair,
        isLong:     !pos.isLong,       // opposite side closes
        usdAmount:  pos.posValue,      // full position value
        leverage:   pos.leverage,
        reduceOnly: true,
        hlWalletData: walletData,
      });
      setStatus('success');
      setStatusMsg('');
      refreshAccount?.();
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      console.error('[close]', e);
      setError(e.message || 'Close failed');
      setStatus('error');
      setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  if (!open || !pair) return null;
  const dayUp     = pair.change >= 0;
  const isBusy    = status === 'loading';
  const isSuccess = status === 'success';
  const isError   = status === 'error';
  const sessionWallet = getSessionWallet(walletPubkey);

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        {/* Header */}
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

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 14px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>

          {wcon && (
            <WalletPanel
              solLamports={solLamports} solPrice={solPrice}
              hlBalanceUsd={hlBalance} hlAddress={hlWallet?.address}
              onWithdraw={() => setWithdrawOpen(true)}
              onDeposit={() => setDepositOpen(true)}
              onSync={handleSync}
              syncing={syncing}
            />
          )}

          <PositionsPanel
            positions={positions}
            marketData={marketData}
            onClose={closePosition}
          />

          {/* Long / Short */}
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

          {/* Amount */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>MARGIN (SOL)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>INSTANT FILL</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${notEnoughSol ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <input value={solAmount} onChange={e => { setSolAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
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

          {/* Leverage */}
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

          {/* Order summary */}
          {solVal > 0 && solPrice > 0 && entryPrice > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              {[
                ['Margin',        fmt(usdAmount, 2)],
                ['Position size', roundSize(notionalUsd / entryPrice, pair.szDecimals) + ' ' + pair.base],
                ['Limit price',   fmt(Number(aggressivePx(entryPrice, isLong, pair.szDecimals)))],
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

        {/* Fixed footer: status, error, CTA always visible regardless of scroll position */}
        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 14px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {/* Status */}
          {(isBusy || isSuccess) && statusMsg && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {/* CTA */}
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
        hlPrivateKey={sessionWallet?.privateKey || ''}
        hlBalance={hlBalance}
        walletPubkey={walletPubkey}
      />

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        walletPubkey={walletPubkey}
        hlWallet={hlWallet} setHlWallet={setHlWallet}
        solLamports={solLamports} solPrice={solPrice}
        signMessage={signMessage}
        refreshAccount={refreshAccount}
      />
    </>
  );
}

/* -- Main page ---------------------------------------------------- */
export default function PerpsTrade({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState({});
  const [sparkMap,   setSparkMap]   = useState({});
  const [marketData, setMarketData] = useState(() =>
    PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, change1h: 0, spark: [], volume24h: 0, openInterest: 0, funding: 0, assetIndex: null, szDecimals: 4 }))
  );
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter]         = useState('All');
  const [allPerps, setAllPerps]     = useState([]);
  const [spotSymbols, setSpotSymbols] = useState(() => new Set());

  // Ref to current allPerps so the spark polling closure always reads fresh data
  // without re-creating the 5-min interval on every market refresh.
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

  /* -- Trading account state (lifted up so it loads before drawer opens) -- */
  const [hlWallet, setHlWallet]       = useState(null);
  const [hlBalance, setHlBalance]     = useState(0);
  const [positions, setPositions]     = useState([]);
  const [solLamports, setSolLamports] = useState(0);
  const [solPrice, setSolPrice]       = useState(0);

  // INSTANT first paint: hydrate from localStorage cache before any network call.
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    if (addr) setHlWallet({ address: addr });
    const cached = loadCachedAccount(walletPubkey);
    if (cached) {
      if (typeof cached.balance === 'number')         setHlBalance(cached.balance);
      if (Array.isArray(cached.positions))            setPositions(cached.positions);
      if (typeof cached.solLamports === 'number')     setSolLamports(cached.solLamports);
      if (typeof cached.solPrice === 'number' && cached.solPrice > 0) setSolPrice(cached.solPrice);
    }
  }, [walletPubkey]);

  // Background fetch + 10s poll. Kicks off the moment the wallet is connected --
  // does NOT wait for the trade drawer to open.
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
    if (bp) { setHlBalance(bp.balance); setPositions(bp.positions); }
    saveCachedAccount(walletPubkey, {
      balance:     bp?.balance ?? 0,
      positions:   bp?.positions ?? [],
      solLamports: lam,
      solPrice:    price > 0 ? price : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletPubkey, solPk, connection]);

  useEffect(() => {
    if (!walletPubkey) return;
    let alive = true;
    const tick = () => { if (alive) refreshAccount(); };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [walletPubkey, refreshAccount]);

  // Resume in-flight deposit (page refresh mid-bridge)
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedHlAddress(walletPubkey);
    const inFlight = loadBridge('deposit');
    if (!addr || !inFlight) return;
    let alive = true;
    pollUntilFunded(addr, inFlight.usd)
      .then(bal => { if (alive) { setHlBalance(bal); clearBridge('deposit'); } })
      .catch(() => { if (alive) clearBridge('deposit'); });
    return () => { alive = false; };
  }, [walletPubkey]);

  // Ethers preload (still used for HL withdrawal signing)
  useEffect(() => { getEthers().catch(() => {}); }, []);

  // Configure Li.Fi SDK once + (re)register Solana provider when the wallet adapter changes.
  // executeRoute() will then trigger one popup on the user's Solana wallet for the bridge.
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

  // Single consolidated market poll: one API hit -> both marketData (curated)
  // and allPerps (full universe). Falls back to keeping prior good data on
  // transient errors (no zero-flicker).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { curated, all } = await fetchMarketSnapshot({ spotSymbols, oneHourMap, sparkMap });
        if (alive) { setMarketData(curated); setAllPerps(all); }
      } catch (e) {
        console.warn('[market poll]', e?.message || e);
        // keep prior state - don't wipe to zeros
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotSymbols, oneHourMap, sparkMap]);

  // 1-hour change map (slow). Only fetches change data for curated pairs.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!marketData.length) return;
      try {
        const map = await fetchOneHourMap(marketData);
        if (!alive) return;
        setOneHourMap(map);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 120_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sparkline map (slowest). Fetched once on mount, then every 5 min.
  // Covers curated markets AND top-by-asset-index so the New tab gets charts.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const allNow = allPerpsRef.current || [];
      if (!marketData.length && !allNow.length) return;
      try {
        // Top 8 by asset index desc -> covers everything visible in the New tab
        const newest = [...allNow]
          .filter(p => p.hasSpot && p.volume24h >= 500_000 && p.price > 0)
          .sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0))
          .slice(0, 8);
        const seen = new Set();
        const combined = [];
        [...marketData, ...newest].forEach(p => {
          if (!seen.has(p.id)) { seen.add(p.id); combined.push(p); }
        });
        const map = await fetchSparkMap(combined);
        if (!alive) return;
        setSparkMap(map);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch sparks the first time allPerps populates (otherwise New-tab charts
  // stay empty for up to 5 min until the next interval tick).
  const sparkSeededRef = useRef(false);
  useEffect(() => {
    if (sparkSeededRef.current) return;
    if (allPerps.length === 0) return;
    sparkSeededRef.current = true;
    (async () => {
      try {
        const newest = [...allPerps]
          .filter(p => p.hasSpot && p.volume24h >= 500_000 && p.price > 0)
          .sort((a, b) => (b.assetIndex || 0) - (a.assetIndex || 0))
          .slice(0, 8);
        const seen = new Set();
        const combined = [];
        [...marketData, ...newest].forEach(p => {
          if (!seen.has(p.id)) { seen.add(p.id); combined.push(p); }
        });
        const map = await fetchSparkMap(combined);
        setSparkMap(prev => ({ ...prev, ...map }));
      } catch {}
    })();
  }, [allPerps, marketData]);

  useEffect(() => {
    if (!activePair?.id) return;
    const fresh = marketData.find(p => p.id === activePair.id);
    if (fresh) setActivePair(fresh);
  }, [marketData, activePair?.id]);

  // Spot universe (very slow-changing, used to flag perps with a spot pair)
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

  const filtered = useMemo(() => {
    if (filter === 'New')     return filterNewListings(allPerps);
    if (filter === 'Hot')     return marketData.filter(p => p.hot);
    if (filter === 'Gainers') return [...marketData].filter(p => p.change > 0).sort((a, b) => b.change - a.change);
    if (filter === 'Losers')  return [...marketData].filter(p => p.change < 0).sort((a, b) => a.change - b.change);
    return marketData;
  }, [marketData, allPerps, filter]);

  const totalVol = marketData.reduce((s, p) => s + Number(p.volume24h || 0), 0);
  const gainers  = marketData.filter(p => p.change > 0).length;
  const openTrade = (pair) => { setActivePair(pair); setDrawerOpen(true); };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin  { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; } input[type="range"]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.07);border-radius:99px;outline:none;} input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:rgba(255,255,255,.07);} input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;box-shadow:0 0 0 4px rgba(151,252,228,.10),0 0 16px rgba(151,252,228,.55),0 2px 6px rgba(0,0,0,.35);margin-top:-8px;transition:transform .12s;} input[type="range"]::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.08);} input[type="range"]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;}`}</style>

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
            {['All', 'New', 'Hot', 'Gainers', 'Losers'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 11px', borderRadius: 999, border: `1px solid ${filter === f ? C.borderHi : C.border}`, background: filter === f ? C.hlDim : 'rgba(255,255,255,.03)', color: filter === f ? C.hl : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.body }}>{f}</button>
            ))}
          </div>
        </div>

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
          hlWallet={hlWallet} setHlWallet={setHlWallet}
          hlBalance={hlBalance} setHlBalance={setHlBalance}
          positions={positions} setPositions={setPositions}
          solLamports={solLamports} setSolLamports={setSolLamports}
          solPrice={solPrice}
          refreshAccount={refreshAccount}
        />
      </div>
    </>
  );
}
