import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';
import { signL1Action } from '@nktkas/hyperliquid/signing';

/* ============================================================================
 * NEXUS DEX - Hyperliquid Perps Trading Interface
 * Non-custodial UI shell. Real Hyperliquid data via fetchMarketData +
 * fetchOneHourChangeMap + fetchSparklineMap.
 * Bridge: SOL <-> HL via deBridge + backend operator wallet.
 * ========================================================================= */

const ENABLE_TRADING = process.env.REACT_APP_HYPERLIQUID_LIVE_TRADING === '1';
const BUILDER_ADDRESS = '';
const BUILDER_FEE_TENTHS_BP = 5;

const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe', inkDim:'#a5b7d2',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e', downSoft:'#b8a4e8', amber:'#f5b53d',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};

const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:{ fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:{ fontFamily:"'IBM Plex Mono', monospace" },
  hero:{ fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

const PERPS_PAIRS = [
  { id:'BTC', base:'BTC', leverage:50, hot:true },
  { id:'ETH', base:'ETH', leverage:50, hot:true },
  { id:'SOL', base:'SOL', leverage:20, hot:true },
  { id:'HYPE', base:'HYPE', leverage:10, hot:true },
  { id:'BNB', base:'BNB', leverage:20 },
  { id:'XRP', base:'XRP', leverage:20 },
  { id:'DOGE', base:'DOGE', leverage:20 },
  { id:'AVAX', base:'AVAX', leverage:15 },
  { id:'LINK', base:'LINK', leverage:20 },
  { id:'SUI', base:'SUI', leverage:20 },
  { id:'ADA', base:'ADA', leverage:20 },
  { id:'TRX', base:'TRX', leverage:10 },
  { id:'TON', base:'TON', leverage:10 },
  { id:'APT', base:'APT', leverage:10 },
  { id:'NEAR', base:'NEAR', leverage:10 },
  { id:'ARB', base:'ARB', leverage:20 },
  { id:'OP', base:'OP', leverage:15 },
  { id:'POL', base:'POL', leverage:20 },
  { id:'TIA', base:'TIA', leverage:10 },
  { id:'SEI', base:'SEI', leverage:10 },
  { id:'INJ', base:'INJ', leverage:10 },
  { id:'WIF', base:'WIF', leverage:10 },
  { id:'PEPE', base:'PEPE', leverage:10 },
  { id:'FET', base:'FET', leverage:10 },
  { id:'RUNE', base:'RUNE', leverage:10 },
  { id:'MKR', base:'MKR', leverage:10 },
  { id:'AAVE', base:'AAVE', leverage:10 },
  { id:'UNI', base:'UNI', leverage:10 },
  { id:'LTC', base:'LTC', leverage:10 },
  { id:'BCH', base:'BCH', leverage:10 },
  { id:'ATOM', base:'ATOM', leverage:10 },
  { id:'DOT', base:'DOT', leverage:10 },
  { id:'FIL', base:'FIL', leverage:10 },
  { id:'JUP', base:'JUP', leverage:10 },
  { id:'PYTH', base:'PYTH', leverage:10 },
  { id:'ENA', base:'ENA', leverage:10 },
  { id:'ONDO', base:'ONDO', leverage:10 },
  { id:'TAO', base:'TAO', leverage:10 },
  { id:'WLD', base:'WLD', leverage:10 },
  { id:'ORDI', base:'ORDI', leverage:10 },
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
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(d);
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
  const parts = s.split('.');
  if (parts.length <= 2) return s;
  return parts[0] + '.' + parts.slice(1).join('');
}
function roundSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function roundPx(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(1);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function getAggressiveLimitPx(midPrice, isLong) {
  const px = Number(midPrice);
  if (!Number.isFinite(px) || px <= 0) return '0';
  return roundPx(isLong ? px * 1.03 : px * 0.97);
}
function coinAccent(symbol) {
  const map = {
    BTC:['#f7931a','#ffbf5c'], ETH:['#627eea','#8fa8ff'], SOL:['#14f195','#9945ff'],
    HYPE:['#97fce4','#5ce9c8'], DOGE:['#c2a633','#e8c84a'], PEPE:['#3dd598','#5de882'],
    XRP:['#7989ad','#bcc6e0'], BNB:['#f0b90b','#f5d060'], SUI:['#4da2ff','#80c4ff'],
    LINK:['#2a5ada','#6a95ff'], AVAX:['#e84142','#ff7a7b'], ARB:['#12aaff','#60d0ff'],
    NEAR:['#00c08b','#00e5b0'],
  };
  return map[symbol] || ['#a87fff','#97fce4'];
}

let _ethersModule = null;
async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}

// ethers v5/v6 compatibility helpers
function getEthersNs(mod) {
  if (!mod) return null;
  if (mod.ethers?.Wallet) return mod.ethers;   // v5: namespace at mod.ethers
  if (mod.Wallet) return mod;                  // v6: namespace IS module
  if (mod.default?.Wallet) return mod.default; // some bundlers
  return null;
}
async function signTypedDataCompat(wallet, domain, types, value) {
  if (typeof wallet.signTypedData === 'function') {
    return await wallet.signTypedData(domain, types, value); // v6
  }
  if (typeof wallet._signTypedData === 'function') {
    return await wallet._signTypedData(domain, types, value); // v5
  }
  throw new Error('Wallet does not support typed data signing');
}
function splitSigCompat(ethersNs, sig) {
  if (ethersNs.Signature?.from) return ethersNs.Signature.from(sig); // v6
  if (ethersNs.utils?.splitSignature) return ethersNs.utils.splitSignature(sig); // v5
  throw new Error('No signature splitting available');
}

function generateHlWallet() {
  const ethersNs = getEthersNs(_ethersModule);
  if (!ethersNs) return null;
  const wallet = ethersNs.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}
function xorEncrypt(text, key) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(out);
}
function xorDecrypt(b64, key) {
  const decoded = atob(b64);
  let out = '';
  for (let i = 0; i < decoded.length; i++) {
    out += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}
function getStorageKey(walletPubkey) { return 'nexus_hl_wallet_' + (walletPubkey || 'anon'); }
function getStoredHlWallet(walletPubkey) {
  try {
    const raw = localStorage.getItem(getStorageKey(walletPubkey));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.address || !data?.encrypted) return null;
    const pk = xorDecrypt(data.encrypted, data.address + 'nexus');
    return pk ? { address: data.address, privateKey: pk } : null;
  } catch { return null; }
}
function storeHlWallet(walletPubkey, address, privateKey) {
  try {
    const encrypted = xorEncrypt(privateKey, address + 'nexus');
    localStorage.setItem(
      getStorageKey(walletPubkey),
      JSON.stringify({ address, encrypted, ts: Date.now() }),
    );
    return true;
  } catch { return false; }
}

async function hlRequest(body, isExchange = false) {
  const path = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || data?.detail || 'Hyperliquid request failed');
  return data;
}

async function fetchOneHourChange(coin) {
  try {
    const now = Date.now();
    const startTime = now - 2 * 60 * 60 * 1000;
    const candles = await hlRequest({
      type: 'candleSnapshot',
      req: { coin, interval: '1h', startTime, endTime: now },
    });
    if (!Array.isArray(candles) || candles.length === 0) return 0;
    const latest = candles[candles.length - 1];
    const open = Number(latest.o || 0);
    const close = Number(latest.c || 0);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return 0;
    return ((close - open) / open) * 100;
  } catch { return 0; }
}

async function fetchSparklineData(coin) {
  try {
    const now = Date.now();
    const startTime = now - 12 * 60 * 60 * 1000;
    const candles = await hlRequest({
      type: 'candleSnapshot',
      req: { coin, interval: '1h', startTime, endTime: now },
    });
    if (!Array.isArray(candles) || candles.length === 0) return [];
    return candles.map(c => Number(c.c || 0)).filter(v => Number.isFinite(v) && v > 0);
  } catch { return []; }
}

async function fetchMarketData(existingOneHourMap = {}, existingSparkMap = {}) {
  try {
    const [metaAndCtxs, mids] = await Promise.all([
      hlRequest({ type: 'metaAndAssetCtxs' }),
      hlRequest({ type: 'allMids' }),
    ]);
    const meta = Array.isArray(metaAndCtxs) ? metaAndCtxs[0] : {};
    const assetCtxs = Array.isArray(metaAndCtxs) ? metaAndCtxs[1] || [] : [];
    const universe = (meta.universe || []).map((u, i) => ({
      name: u.name || 'Unknown',
      index: i,
      maxLeverage: u.maxLeverage || 50,
      ctx: assetCtxs[i] || {},
    }));
    const priceMap = {};
    if (mids && typeof mids === 'object' && !Array.isArray(mids)) {
      for (const [k, v] of Object.entries(mids)) {
        const p = parseFloat(v);
        priceMap[k] = p > 0 ? p : 0;
      }
    } else if (Array.isArray(mids)) {
      universe.forEach((u, i) => {
        const p = parseFloat(mids[i]);
        priceMap[u.name] = p > 0 ? p : 0;
      });
    }
    return PERPS_PAIRS.map(p => {
      const info = universe.find(u => u.name === p.id);
      if (!info) return null;
      const ctx = info.ctx || {};
      const midPrice = priceMap[p.id] || parseFloat(ctx.midPx || ctx.markPx || 0) || 0;
      const prevDayPx = parseFloat(ctx.prevDayPx || 0);
      const dayNtlVlm = parseFloat(ctx.dayNtlVlm || 0);
      const openInterest = parseFloat(ctx.openInterest || 0);
      const funding = parseFloat(ctx.funding || 0);
      const change = midPrice > 0 && prevDayPx > 0 ? ((midPrice - prevDayPx) / prevDayPx) * 100 : 0;
      return {
        ...p,
        assetIndex: info.index,
        price: midPrice,
        change,
        change1h: Number.isFinite(existingOneHourMap[p.id]) ? existingOneHourMap[p.id] : 0,
        spark: Array.isArray(existingSparkMap[p.id]) ? existingSparkMap[p.id] : [],
        volume24h: dayNtlVlm,
        openInterest,
        funding,
        leverage: Math.min(info.maxLeverage, p.leverage),
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('Market data fetch failed:', e);
    return PERPS_PAIRS.map(p => ({
      ...p, price:0, change:0,
      change1h: Number.isFinite(existingOneHourMap[p.id]) ? existingOneHourMap[p.id] : 0,
      spark: Array.isArray(existingSparkMap[p.id]) ? existingSparkMap[p.id] : [],
      volume24h:0, openInterest:0, funding:0, assetIndex:null,
    }));
  }
}

async function fetchOneHourChangeMap(markets) {
  const limited = markets.slice(0, 60);
  const changes = await Promise.all(limited.map(p => fetchOneHourChange(p.id)));
  const map = {};
  limited.forEach((p, i) => { map[p.id] = Number.isFinite(changes[i]) ? changes[i] : 0; });
  return map;
}

async function fetchSparklineMap(markets) {
  const limited = markets.slice(0, 60);
  const sparks = await Promise.all(limited.map(p => fetchSparklineData(p.id)));
  const map = {};
  limited.forEach((p, i) => { map[p.id] = Array.isArray(sparks[i]) ? sparks[i] : []; });
  return map;
}

function buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly = false }) {
  const price = Number(pair?.price || 0);
  const notional = Number(usdAmount || 0);
  const assetIndex = pair?.assetIndex;
  if (!ENABLE_TRADING) throw new Error('Trading is disabled');
  if (!Number.isInteger(assetIndex) || assetIndex < 0) throw new Error('Market asset index unavailable');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Market price unavailable');
  if (!Number.isFinite(notional) || notional < 10) throw new Error('Minimum order value is $10');
  const coinSize = roundSize(notional / price);
  const limitPx = getAggressiveLimitPx(price, isLong);
  const action = {
    type: 'order',
    orders: [{ a: assetIndex, b: Boolean(isLong), p: limitPx, s: coinSize, r: Boolean(reduceOnly), t: { limit: { tif: 'Ioc' } } }],
    grouping: 'na',
  };
  if (isValidEthAddress(BUILDER_ADDRESS)) action.builder = { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP };
  return { action, leverage: Number(leverage || 1), coinSize, notional, limitPx };
}

async function placeOrder({ pair, isLong, usdAmount, leverage, reduceOnly = false, walletPubkey }) {
  let walletData = getStoredHlWallet(walletPubkey) || getStoredHlWallet('anon');
  if (!walletData?.privateKey) {
    const activeStorageKey = Object.keys(localStorage).find(k => k.startsWith('nexus_hl_wallet_'));
    if (activeStorageKey) {
      const suffix = activeStorageKey.replace('nexus_hl_wallet_', '');
      walletData = getStoredHlWallet(suffix);
    }
  }
  if (!walletData?.privateKey) throw new Error('Hyperliquid wallet private key not found. Create wallet first.');
  const built = buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly });
  const nonce = Date.now();
  const mod = await getEthers();
  const ethersNs = getEthersNs(mod);
  if (!ethersNs) throw new Error('Ethers unavailable');
  const wallet = new ethersNs.Wallet(walletData.privateKey);
  const signature = await signL1Action({ wallet, action: built.action, nonce });
  return hlRequest({ action: built.action, nonce, signature }, true);
}

/* --- BRIDGE: SOL <-> HL via deBridge + backend operator ------------------- */

const BRIDGE_TRACK_KEY = mode => 'nexus_bridge_' + mode;

function saveBridgeTracking(mode, trackingId) {
  try {
    localStorage.setItem(BRIDGE_TRACK_KEY(mode), JSON.stringify({ id: trackingId, ts: Date.now() }));
  } catch {}
}
function loadBridgeTracking(mode) {
  try {
    const raw = localStorage.getItem(BRIDGE_TRACK_KEY(mode));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 30 * 60 * 1000) return null; // 30 min expiry
    return data.id;
  } catch { return null; }
}
function clearBridgeTracking(mode) {
  try { localStorage.removeItem(BRIDGE_TRACK_KEY(mode)); } catch {}
}

async function bridgeDepositQuote({ usd_amount, user_sol_addr, user_hyper_wallet }) {
  const res = await fetch('/api/bridge/deposit/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usd_amount, user_sol_addr, user_hyper_wallet }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.details || 'Quote failed');
  return data;
}

async function bridgeDepositSubmit({ tracking_id, sol_tx_hash }) {
  const res = await fetch('/api/bridge/deposit/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking_id, sol_tx_hash }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Submit failed');
  return data;
}

async function bridgeDepositStatus(tracking_id) {
  const res = await fetch('/api/bridge/deposit/status?id=' + encodeURIComponent(tracking_id));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Status failed');
  return data;
}

async function bridgeWithdrawInit({ hl_wallet_address, usd_amount, user_sol_addr }) {
  const res = await fetch('/api/bridge/withdraw/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hl_wallet_address, usd_amount, user_sol_addr }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Init failed');
  return data;
}

async function bridgeWithdrawSubmit({ tracking_id, signature }) {
  const res = await fetch('/api/bridge/withdraw/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking_id, signature }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Submit failed');
  return data;
}

async function bridgeWithdrawStatus(tracking_id) {
  const res = await fetch('/api/bridge/withdraw/status?id=' + encodeURIComponent(tracking_id));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Status failed');
  return data;
}

// Sign HL withdraw3 with the user's localStorage HL key (no popup)
async function signHlWithdraw3(privateKey, action) {
  const mod = await getEthers();
  const ethersNs = getEthersNs(mod);
  if (!ethersNs) throw new Error('Ethers unavailable');
  const wallet = new ethersNs.Wallet(privateKey);

  const domain = {
    name: 'HyperliquidSignTransaction',
    version: '1',
    chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    'HyperliquidTransaction:Withdraw': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  };
  const message = {
    hyperliquidChain: action.hyperliquidChain,
    destination: action.destination,
    amount: action.amount,
    time: action.time,
  };
  const sig = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
}

function b64ToBytes(data) {
  const s = String(data || '').trim();
  // deBridge returns hex (with optional 0x prefix) for Solana source-chain txs.
  // Fall back to base64 for any other source.
  const hex = s.replace(/^0x/, '');
  if (hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex)) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}


const DEPOSIT_STATUS_TEXT = {
  awaiting_signature: 'Waiting for Solana signature...',
  bridging:           'Bridging SOL to Arbitrum... (~60s)',
  approving:          'Approving USDC...',
  depositing:         'Depositing to Hyperliquid...',
  transferring:       'Crediting your account...',
  complete:           'Deposit complete!',
  failed:             'Deposit failed',
};
const WITHDRAW_STATUS_TEXT = {
  awaiting_signature: 'Signing withdrawal...',
  withdrawing:        'Submitting to Hyperliquid...',
  hl_settling:        'Hyperliquid processing... (~5 min)',
  bridging:           'Bridging USDC to Solana... (~60s)',
  finalizing:         'Finalizing...',
  complete:           'Withdrawal complete!',
  failed:             'Withdrawal failed',
};

/* --- VISUAL COMPONENTS ---------------------------------------------------- */

function Ticker({ symbol, size = 36 }) {
  const [a, b] = coinAccent(symbol);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${a},${b})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(0,0,0,.78)', fontWeight: 900,
      fontSize: Math.round(size * 0.30), letterSpacing: '-.03em', flexShrink: 0,
      boxShadow: `0 4px 12px ${a}30`,
      ...T.display,
    }}>
      {symbol.slice(0, 3)}
    </div>
  );
}

function Sparkline({ data, up, width = 60, height = 22 }) {
  if (!Array.isArray(data) || data.length < 2) return <div style={{ width, height }}/>;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  const color = up ? C.up : C.downSoft;
  const gradId = `g-${up ? 'u' : 'd'}-${(data[0] || 0).toString().replace('.', '_').slice(0, 10)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradId})`}/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PositionCard({ position, pair, onClick }) {
  const entry = Number(position.entryPrice || 0);
  const current = Number(pair?.price || 0);
  const isLong = position.side === 'long';
  const leverage = Number(position.leverage || 1);
  const size = Number(position.size || 0);
  let pnl = 0, pnlPct = 0;
  if (entry > 0 && current > 0 && size > 0) {
    pnl = isLong ? ((current - entry) / entry) * size : ((entry - current) / entry) * size;
    pnlPct = size > 0 && leverage > 0 ? (pnl / (size / leverage)) * 100 : 0;
  }
  const inProfit = pnl >= 0;
  return (
    <div onClick={onClick} style={{
      background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
      border: `1px solid ${inProfit ? 'rgba(61,213,152,.30)' : 'rgba(255,138,158,.30)'}`,
      borderRadius: 20, padding: 16, cursor: 'pointer', marginBottom: 14,
      boxShadow: inProfit ? '0 0 24px rgba(61,213,152,.10)' : '0 0 24px rgba(255,138,158,.10)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Ticker symbol={pair?.base || '?'} size={40}/>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: C.inkStr, letterSpacing: '-.02em', ...T.display }}>
                {pair?.base}
              </span>
              <span style={{
                color: C.hl, fontSize: 9, fontWeight: 700,
                padding: '2px 6px', borderRadius: 5,
                background: C.hlDim, border: `1px solid ${C.borderHi}`,
                letterSpacing: '.06em', ...T.mono,
              }}>PERP</span>
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 3, ...T.mono }}>
              {isLong ? 'Long' : 'Short'} &middot; {leverage}x
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: inProfit ? C.up : C.down, ...T.display }}>
            {inProfit ? '+' : ''}{fmt(pnl)}
          </div>
          <div style={{ fontSize: 11, color: inProfit ? C.up : C.down, marginTop: 2, ...T.mono }}>
            {pct(pnlPct)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketRow({ pair, onClick }) {
  const up = pair.change >= 0;
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '14px 16px',
      background: 'transparent', border: 'none',
      borderBottom: `1px solid ${C.hairline}`,
      cursor: 'pointer', textAlign: 'left',
      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 14, alignItems: 'center',
      transition: 'background .15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(151,252,228,.025)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Ticker symbol={pair.base} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontWeight: 700, color: C.inkStr, fontSize: 15, letterSpacing: '-.02em', ...T.body }}>
            {pair.base}
          </span>
          <span style={{ color: C.muted2, fontSize: 10, fontWeight: 600, ...T.mono }}>PERP</span>
          {pair.hot && (
            <span style={{
              color: C.amber, fontSize: 9, fontWeight: 700,
              padding: '1px 5px', borderRadius: 4,
              background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)',
              ...T.mono, letterSpacing: '.04em',
            }}>HOT</span>
          )}
        </div>
        <div style={{ marginTop: 3, color: C.muted, fontSize: 10, fontWeight: 500, ...T.mono }}>
          Up to {pair.leverage}x &middot; {shortNum(pair.volume24h)} vol
        </div>
      </div>
      <Sparkline data={pair.spark} up={up}/>
      <div style={{ textAlign: 'right', minWidth: 78 }}>
        <div style={{
          fontWeight: 700, color: C.inkStr, fontSize: 14,
          fontVariantNumeric: 'tabular-nums', ...T.mono,
        }}>
          {pair.price > 0 ? fmt(pair.price, 2) : '-'}
        </div>
        <div style={{
          marginTop: 3, color: up ? C.up : C.down,
          fontSize: 11, fontWeight: 600,
          fontVariantNumeric: 'tabular-nums', ...T.mono,
        }}>
          {pct(pair.change)}
        </div>
      </div>
    </button>
  );
}

/* --- TRANSFER MODAL (wired to bridge backend) ----------------------------- */

function TransferModal({ open, onClose, mode, hlAddress, walletPubkey }) {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();

  const isDeposit = mode === 'deposit';
  const [amount, setAmount] = useState('');
  const [solDest, setSolDest] = useState('');
  const [status, setStatus] = useState('idle');
  const [pipelineStatus, setPipelineStatus] = useState('');
  const [error, setError] = useState('');
  const [trackingId, setTrackingId] = useState('');
  const [quotePreview, setQuotePreview] = useState(null);

  const pollIntervalRef = useRef(null);
  useBodyLock(open);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id) => {
    stopPolling();
    const fetcher = isDeposit ? bridgeDepositStatus : bridgeWithdrawStatus;
    const tick = async () => {
      try {
        const s = await fetcher(id);
        setPipelineStatus(s.status || '');
        if (s.status === 'complete') {
          setStatus('complete');
          stopPolling();
          clearBridgeTracking(mode);
        } else if (s.status === 'failed') {
          setStatus('failed');
          setError(s.error || 'Bridge failed');
          stopPolling();
          clearBridgeTracking(mode);
        }
      } catch (e) {
        // network blip, keep polling
      }
    };
    tick();
    pollIntervalRef.current = setInterval(tick, isDeposit ? 4_000 : 6_000);
  }, [mode, isDeposit, stopPolling]);

  useEffect(() => {
    if (!open) { stopPolling(); return; }
    setError('');
    setQuotePreview(null);
    setPipelineStatus('');
    setSolDest(walletPubkey || '');
    const existing = loadBridgeTracking(mode);
    if (existing) {
      setTrackingId(existing);
      setStatus('processing');
      setAmount('');
      startPolling(existing);
    } else {
      setAmount('');
      setStatus('idle');
      setTrackingId('');
    }
    return () => stopPolling();
  }, [open, mode, walletPubkey, startPolling, stopPolling]);

  const handleDeposit = async () => {
    setError('');
    const usd = parseFloat(amount);
    if (!usd || usd < 10) { setError('Minimum deposit is $10'); return; }
    if (!publicKey) { setError('Connect a Solana wallet first'); return; }
    if (!hlAddress) { setError('Create your Hyperliquid wallet first'); return; }

    try {
      setStatus('quoting');
      setPipelineStatus('quoting');
      const quote = await bridgeDepositQuote({
        usd_amount: usd,
        user_sol_addr: publicKey.toString(),
        user_hyper_wallet: hlAddress,
      });
      setQuotePreview({
        solToSend: quote.sol_to_send,
        expectedUsdc: quote.expected_usdc,
      });
      setTrackingId(quote.tracking_id);

      setStatus('processing');
      setPipelineStatus('awaiting_signature');
      const txBytes = b64ToBytes(quote.sol_tx_b64);
      const tx = VersionedTransaction.deserialize(txBytes);
      let sig;
      if (sendTransaction) {
        sig = await sendTransaction(tx, connection);
      } else if (signTransaction) {
        const signed = await signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize());
      } else {
        throw new Error('Wallet does not support transaction signing');
      }

      saveBridgeTracking('deposit', quote.tracking_id);
      await bridgeDepositSubmit({ tracking_id: quote.tracking_id, sol_tx_hash: sig });

      startPolling(quote.tracking_id);
    } catch (e) {
      console.error('[bridge deposit]', e);
      setError(e.message || 'Deposit failed');
      setStatus('failed');
      stopPolling();
      clearBridgeTracking('deposit');
    }
  };

  const handleWithdraw = async () => {
    setError('');
    const usd = parseFloat(amount);
    if (!usd || usd < 5) { setError('Minimum withdraw is $5'); return; }
    if (!hlAddress) { setError('No Hyperliquid wallet found'); return; }
    if (!isValidSolAddress(solDest)) { setError('Enter a valid Solana destination address'); return; }

    const stored = getStoredHlWallet(walletPubkey);
    if (!stored?.privateKey) {
      setError('Hyperliquid wallet key not found locally. Create wallet first.');
      return;
    }
    if (stored.address.toLowerCase() !== hlAddress.toLowerCase()) {
      setError('Stored HL key does not match wallet address');
      return;
    }

    try {
      setStatus('quoting');
      setPipelineStatus('quoting');
      const init = await bridgeWithdrawInit({
        hl_wallet_address: hlAddress,
        usd_amount: usd,
        user_sol_addr: solDest,
      });
      setTrackingId(init.tracking_id);

      setStatus('processing');
      setPipelineStatus('awaiting_signature');
      const signature = await signHlWithdraw3(stored.privateKey, init.action);

      saveBridgeTracking('withdraw', init.tracking_id);
      await bridgeWithdrawSubmit({ tracking_id: init.tracking_id, signature });

      startPolling(init.tracking_id);
    } catch (e) {
      console.error('[bridge withdraw]', e);
      setError(e.message || 'Withdraw failed');
      setStatus('failed');
      stopPolling();
      clearBridgeTracking('withdraw');
    }
  };

  const handle = isDeposit ? handleDeposit : handleWithdraw;
  const isBusy = status === 'processing' || status === 'quoting';
  const isDone = status === 'complete';
  const isFailed = status === 'failed';
  const statusText = isDeposit
    ? DEPOSIT_STATUS_TEXT[pipelineStatus] || pipelineStatus
    : WITHDRAW_STATUS_TEXT[pipelineStatus] || pipelineStatus;

  if (!open) return null;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{
        position: 'fixed', inset: 0, zIndex: 450,
        background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(12px)',
        cursor: isBusy ? 'wait' : 'pointer',
      }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 451,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`,
        borderRadius: '26px 26px 0 0',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -24px 70px rgba(0,0,0,.6), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 18, letterSpacing: '-.02em', ...T.display }}>
                {isDeposit ? 'Deposit' : 'Withdraw'}
              </div>
              <div style={{ color: C.muted, fontWeight: 500, fontSize: 11, marginTop: 3, ...T.body }}>
                {isDeposit ? 'Move funds into Hyperliquid' : 'Move funds out of Hyperliquid'}
              </div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{
              background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`,
              color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18,
              cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1,
            }}>&times;</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px calc(env(safe-area-inset-bottom) + 78px)' }}>

          <div style={{
            marginBottom: 14, padding: 13,
            background: 'rgba(255,255,255,.03)', borderRadius: 14, border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, marginBottom: 6, letterSpacing: '.06em', ...T.mono }}>
              {isDeposit ? 'DESTINATION (HL WALLET)' : 'SOURCE (HL WALLET)'}
            </div>
            <div style={{ fontSize: 11, color: C.ink, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {hlAddress || 'No Hyperliquid wallet yet'}
            </div>
          </div>

          <div style={{
            marginBottom: 14, padding: 13, borderRadius: 14,
            background: isDeposit ? C.hlDim : 'rgba(168,127,255,.08)',
            border: `1px solid ${isDeposit ? C.borderHi : 'rgba(168,127,255,.20)'}`,
          }}>
            <div style={{ fontSize: 12, color: isDeposit ? C.hl : C.violet, fontWeight: 700, ...T.mono }}>
              {isDeposit ? 'SOL -> USDC.arb -> Hyperliquid' : 'Hyperliquid -> USDC.arb -> SOL'}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: C.muted, fontWeight: 500, ...T.body }}>
              Powered by deBridge &middot; ~$2 in fees
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 7, letterSpacing: '.06em', textTransform: 'uppercase', ...T.mono }}>
              Amount
            </div>
            <div style={{
              background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '14px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: isBusy ? 0.6 : 1,
            }}>
              <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
              <input
                value={amount}
                onChange={e => setAmount(cleanAmount(e.target.value))}
                placeholder="0.00"
                disabled={isBusy}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  fontSize: 23, fontWeight: 800, color: C.inkStr, outline: 'none',
                  fontVariantNumeric: 'tabular-nums', ...T.display,
                }}
              />
              <span style={{
                fontSize: 11, color: C.muted, fontWeight: 700,
                padding: '4px 9px', borderRadius: 7,
                background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
                letterSpacing: '.04em', ...T.mono,
              }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
              {[25, 50, 100, 250].map(v => (
                <button key={v} onClick={() => setAmount(String(v))} disabled={isBusy} style={{
                  flex: 1, padding: '9px', borderRadius: 10,
                  border: `1px solid ${parseFloat(amount) === v ? C.borderHi : C.border}`,
                  background: parseFloat(amount) === v ? C.hlDim : 'rgba(255,255,255,.03)',
                  color: parseFloat(amount) === v ? C.hl : C.muted,
                  fontWeight: 700, fontSize: 11,
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                  opacity: isBusy ? 0.5 : 1, ...T.mono,
                }}>${v}</button>
              ))}
            </div>
          </div>

          {!isDeposit && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 7, letterSpacing: '.06em', textTransform: 'uppercase', ...T.mono }}>
                Send SOL to
              </div>
              <input
                value={solDest}
                onChange={e => setSolDest(e.target.value.trim())}
                placeholder="Solana wallet address"
                disabled={isBusy}
                style={{
                  width: '100%', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
                  borderRadius: 14, padding: '12px 13px',
                  fontSize: 11, color: C.inkStr, outline: 'none',
                  fontFamily: 'monospace', boxSizing: 'border-box',
                  opacity: isBusy ? 0.6 : 1,
                }}
              />
              {walletPubkey && solDest !== walletPubkey && (
                <button onClick={() => setSolDest(walletPubkey)} disabled={isBusy} style={{
                  marginTop: 6, padding: '4px 10px', borderRadius: 8,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.hl, fontSize: 10, fontWeight: 700,
                  cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono,
                }}>USE CONNECTED WALLET</button>
              )}
            </div>
          )}

          {quotePreview && isDeposit && (
            <div style={{
              marginBottom: 12, padding: '10px 13px',
              background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.16)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, ...T.mono }}>YOU SEND</div>
              <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, ...T.mono }}>
                ~{quotePreview.solToSend} SOL
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6, ...T.mono }}>YOU RECEIVE</div>
              <div style={{ fontSize: 13, color: C.hl, fontWeight: 700, ...T.mono }}>
                ~${parseFloat(quotePreview.expectedUsdc).toFixed(2)} USDC margin (after fees)
              </div>
            </div>
          )}

          {(isBusy || isDone || isFailed) && statusText && (
            <div style={{
              marginBottom: 12, padding: 12,
              background: isFailed ? 'rgba(255,138,158,.08)'
                : isDone ? 'rgba(61,213,152,.08)' : 'rgba(151,252,228,.05)',
              border: `1px solid ${isFailed ? 'rgba(255,138,158,.24)'
                : isDone ? 'rgba(61,213,152,.24)' : 'rgba(151,252,228,.20)'}`,
              borderRadius: 12,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {isBusy && (
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: `2px solid ${C.hlDim}`, borderTopColor: C.hl,
                  animation: 'nexus-spin 0.8s linear infinite',
                }}/>
              )}
              {isDone && <span style={{ fontSize: 14 }}>{'\u2713'}</span>}
              {isFailed && <span style={{ fontSize: 14 }}>{'\u2715'}</span>}
              <span style={{
                fontSize: 12, color: isFailed ? C.down : isDone ? C.up : C.ink,
                fontWeight: 600, ...T.body,
              }}>
                {statusText}
              </span>
            </div>
          )}

          {error && (
            <div style={{
              marginBottom: 12, padding: 11,
              background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)',
              borderRadius: 12, fontSize: 11, color: C.down, ...T.body,
            }}>{error}</div>
          )}

          {isDone ? (
            <button onClick={() => { setStatus('idle'); setAmount(''); setPipelineStatus(''); setError(''); onClose(); }} style={{
              width: '100%', padding: 16, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', minHeight: 56, ...T.display,
            }}>Done</button>
          ) : (
            <button
              onClick={handle}
              disabled={!amount || isBusy || (!isDeposit && !isValidSolAddress(solDest))}
              style={{
                width: '100%', padding: 16, borderRadius: 16, border: 'none',
                background: isFailed
                  ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                  : isDeposit
                    ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                    : `linear-gradient(135deg,${C.violet} 0%,${C.sol} 100%)`,
                color: isDeposit && !isFailed ? '#04070f' : '#fff',
                fontWeight: 800, fontSize: 15,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: (!amount || isBusy) ? 0.65 : 1,
                minHeight: 56,
                boxShadow: isDeposit ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(168,127,255,.22)',
                letterSpacing: '-.01em', ...T.display,
              }}
            >
              {isBusy ? 'Processing...'
                : isFailed ? 'Retry'
                : isDeposit ? 'Start Deposit' : 'Start Withdraw'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* --- TRADE DRAWER --------------------------------------------------------- */

function TradeDrawer({ open, onClose, pair, onConnectWallet, walletPubkey, position }) {
  const { connected } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide] = useState('long');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [hlWallet, setHlWallet] = useState(null);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMode, setTransferMode] = useState('deposit');
  const [sizePct, setSizePct] = useState(null);

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setAmount(''); setTakeProfit(''); setStopLoss(''); setSizePct(null);
      setStatus('idle'); setError('');
      const stored = getStoredHlWallet(walletPubkey);
      setHlWallet(stored ? { address: stored.address } : null);
    }
  }, [open, walletPubkey]);

  useEffect(() => {
    if (pair?.leverage && leverage > pair.leverage) setLeverage(pair.leverage);
  }, [pair?.leverage, leverage]);

  const isLong = side === 'long';
  const entryPrice = Number(pair?.price || 0);
  const liqPrice = entryPrice > 0
    ? isLong ? entryPrice * (1 - 0.9 / leverage) : entryPrice * (1 + 0.9 / leverage)
    : 0;

  const createWallet = async () => {
    setCreatingWallet(true); setError('');
    try {
      await getEthers();
      const newWallet = generateHlWallet();
      if (!newWallet) throw new Error('Wallet generation failed');
      const ok = storeHlWallet(walletPubkey, newWallet.address, newWallet.privateKey);
      if (!ok) throw new Error('Could not save Hyperliquid wallet');
      setHlWallet({ address: newWallet.address });
    } catch (e) {
      console.error('Wallet creation failed:', e);
      setError(e.message || 'Wallet creation failed');
    }
    setCreatingWallet(false);
  };

  const quickSize = (p) => { setSizePct(p); setAmount(''); };

  const execute = async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!hlWallet) { await createWallet(); return; }
    const usdAmount = parseFloat(amount);
    if (!usdAmount || usdAmount < 10) { setError('Minimum order value is $10.'); return; }
    if (!pair?.assetIndex && pair?.assetIndex !== 0) { setError('Market is still loading. Try again in a moment.'); return; }
    if (!pair?.price) { setError('Price unavailable. Try again in a moment.'); return; }
    setStatus('loading'); setError('');
    try {
      await placeOrder({ pair, isLong, usdAmount, leverage, walletPubkey });
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 1800);
    } catch (e) {
      console.error('Trade failed:', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const closePosition = async () => {
    if (!hlWallet || !position) return;
    setStatus('loading'); setError('');
    try {
      await placeOrder({
        pair, isLong: position.side !== 'long',
        usdAmount: position.size || 0,
        leverage: position.leverage || 1,
        reduceOnly: true,
        walletPubkey,
      });
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 1800);
    } catch (e) {
      console.error('Close failed:', e);
      setError(e.message || 'Close failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  if (!open || !pair) return null;

  const oneHourUp = pair.change1h >= 0;
  const dayUp = pair.change >= 0;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)',
      }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`,
        borderRadius: '26px 26px 0 0',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px 14px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Ticker symbol={pair.base} size={44}/>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 20, letterSpacing: '-.03em', ...T.display }}>
                    {pair.base}
                  </span>
                  <span style={{
                    color: C.hl, fontSize: 9, fontWeight: 700,
                    padding: '2px 7px', borderRadius: 6,
                    background: C.hlDim, border: `1px solid ${C.borderHi}`,
                    letterSpacing: '.06em', ...T.mono,
                  }}>PERP</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ color: C.ink, fontSize: 14, fontWeight: 700, ...T.mono }}>{fmt(pair.price, 2)}</span>
                  <span style={{ color: dayUp ? C.up : C.down, fontSize: 11, fontWeight: 700, ...T.mono }}>{pct(pair.change)}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`,
              color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: 'pointer',
            }}>&times;</button>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
            marginTop: 14, padding: '10px 0',
            borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}`,
          }}>
            {[
              ['1H', pct(pair.change1h), oneHourUp ? C.up : C.down],
              ['VOLUME', shortNum(pair.volume24h), C.ink],
              ['MAX', `${pair.leverage}x`, C.hl],
            ].map(([l, v, c], i) => (
              <div key={l} style={{
                textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
                borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none',
              }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', ...T.mono }}>{l}</div>
                <div style={{ fontSize: 12, color: c, fontWeight: 700, marginTop: 3, ...T.mono }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px calc(env(safe-area-inset-bottom) + 86px)' }}>
          {position && (
            <div style={{ marginBottom: 14 }}>
              <PositionCard position={position} pair={pair} onClick={() => {}}/>
            </div>
          )}

          {!hlWallet && wcon && (
            <div style={{
              marginBottom: 14, padding: 14,
              background: 'linear-gradient(135deg,rgba(168,127,255,.12),rgba(151,252,228,.06))',
              border: '1px solid rgba(168,127,255,.22)', borderRadius: 16, textAlign: 'center',
            }}>
              <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 14, marginBottom: 4, ...T.display }}>
                Create your Hyperliquid wallet
              </div>
              <div style={{ color: C.muted, fontWeight: 500, fontSize: 11, marginBottom: 11, ...T.body }}>
                Required before live perps trading
              </div>
              <button onClick={createWallet} disabled={creatingWallet} style={{
                padding: '11px 22px', borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`,
                color: '#04070f', fontWeight: 800, fontSize: 13, cursor: 'pointer', ...T.display,
              }}>
                {creatingWallet ? 'Creating...' : 'Create Wallet'}
              </button>
            </div>
          )}

          {hlWallet && (
            <div style={{
              marginBottom: 14, padding: '12px 14px',
              background: 'rgba(151,252,228,.04)', border: '1px solid rgba(151,252,228,.14)',
              borderRadius: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>
                    HYPERLIQUID WALLET
                  </div>
                  <div style={{ fontSize: 11, color: C.ink, marginTop: 3, ...T.mono }}>
                    {hlWallet.address.slice(0, 6)}...{hlWallet.address.slice(-4)}
                  </div>
                </div>
                <div style={{
                  fontSize: 10, color: C.hl, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 5, ...T.mono,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.hl, boxShadow: `0 0 6px ${C.hl}` }}/>
                  Active
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setTransferMode('deposit'); setTransferOpen(true); }} style={{
                  flex: 1, padding: 10, borderRadius: 11,
                  border: '1px solid rgba(151,252,228,.20)', background: 'rgba(151,252,228,.06)',
                  color: C.hl, fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
                }}>Deposit</button>
                <button onClick={() => { setTransferMode('withdraw'); setTransferOpen(true); }} style={{
                  flex: 1, padding: 10, borderRadius: 11,
                  border: '1px solid rgba(168,127,255,.22)', background: 'rgba(168,127,255,.06)',
                  color: C.violet, fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
                }}>Withdraw</button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              ['long', C.up, 'rgba(61,213,152,.10)', 'rgba(61,213,152,.42)'],
              ['short', C.down, 'rgba(255,138,158,.10)', 'rgba(255,138,158,.42)'],
            ].map(([s, color, bg, bdr]) => {
              const active = side === s;
              return (
                <button key={s} onClick={() => setSide(s)} style={{
                  padding: 14, borderRadius: 14,
                  border: `1px solid ${active ? bdr : C.border}`,
                  background: active ? bg : 'rgba(255,255,255,.03)',
                  color: active ? color : C.muted,
                  fontWeight: 800, fontSize: 15, cursor: 'pointer',
                  textTransform: 'capitalize', transition: 'all .15s',
                  boxShadow: active ? `0 0 20px ${color}1c` : 'none',
                  ...T.display,
                }}>{s}</button>
              );
            })}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', ...T.mono }}>Amount</span>
              <span style={{
                fontSize: 9, color: C.hl, fontWeight: 700,
                background: C.hlDim, border: `1px solid ${C.borderHi}`,
                padding: '3px 8px', borderRadius: 6, ...T.mono,
              }}>INSTANT FILL</span>
            </div>
            <div style={{
              background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '13px 14px', marginBottom: 9,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <input
                value={amount}
                onChange={e => { setAmount(cleanAmount(e.target.value)); setSizePct(null); setError(''); }}
                placeholder="0.00"
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none',
                  fontVariantNumeric: 'tabular-nums', ...T.display,
                }}
              />
              <span style={{
                fontSize: 11, color: C.muted, fontWeight: 700,
                padding: '4px 9px', borderRadius: 7,
                background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
                letterSpacing: '.04em', ...T.mono,
              }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => quickSize(p)} style={{
                  flex: 1, padding: '8px', borderRadius: 10,
                  border: `1px solid ${sizePct === p ? C.borderHi : C.border}`,
                  background: sizePct === p ? C.hlDim : 'rgba(255,255,255,.03)',
                  color: sizePct === p ? C.hl : C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer', ...T.mono,
                }}>{p === 100 ? 'Max' : p + '%'}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', ...T.mono }}>Leverage</span>
              <span style={{
                fontSize: 13, color: C.hl, fontWeight: 800,
                padding: '4px 10px', borderRadius: 8,
                background: C.hlDim, border: `1px solid ${C.borderHi}`,
                ...T.mono,
              }}>{leverage}x</span>
            </div>
            <input type="range" min="1" max={pair.leverage} value={leverage}
              onChange={e => setLeverage(Number(e.target.value))}
              style={{ width: '100%', height: 6, padding: '8px 0' }}/>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 8, fontSize: 9, color: C.muted2, letterSpacing: '.04em', ...T.mono,
            }}>
              <span style={{ fontWeight: 700 }}>1x</span>
              <span style={{ color: C.muted, fontWeight: 600 }}>Conservative &middot; Balanced &middot; Aggressive</span>
              <span style={{ fontWeight: 700 }}>{pair.leverage}x</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase', ...T.mono }}>Take profit</div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 11px' }}>
                <input value={takeProfit} onChange={e => setTakeProfit(cleanAmount(e.target.value))} placeholder="Optional"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: C.up, outline: 'none', ...T.mono }}/>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase', ...T.mono }}>Stop loss</div>
              <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 11px' }}>
                <input value={stopLoss} onChange={e => setStopLoss(cleanAmount(e.target.value))} placeholder="Optional"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: C.down, outline: 'none', ...T.mono }}/>
              </div>
            </div>
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div style={{
              background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '12px 14px', marginBottom: 14,
            }}>
              {[
                ['Entry price', fmt(entryPrice, 2)],
                ['You receive', entryPrice > 0 ? roundSize(parseFloat(amount) / entryPrice) + ' ' + pair.base : '-'],
                ['Limit price', entryPrice > 0 ? fmt(getAggressiveLimitPx(entryPrice, isLong), 4) : '-'],
                ['Liquidation', fmt(liqPrice, 4)],
                ['Builder fee', isValidEthAddress(BUILDER_ADDRESS) ? '0.05%' : 'Not set'],
              ].map(([l, v], i, a) => (
                <div key={l} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none',
                }}>
                  <span style={{ color: C.muted, fontSize: 12, fontWeight: 500, ...T.body }}>{l}</span>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{
              marginBottom: 12, padding: 11,
              background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)',
              borderRadius: 12, fontSize: 12, color: C.down, ...T.body,
            }}>{error}</div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56,
              boxShadow: '0 12px 32px rgba(168,127,255,.24)', letterSpacing: '-.01em', ...T.display,
            }}>Connect Wallet</button>
          ) : (
            <button onClick={execute} disabled={!amount || status === 'loading'} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: status === 'success'
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : status === 'error'
                  ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                  : isLong
                    ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                    : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              minHeight: 56,
              boxShadow: isLong ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {status === 'loading' ? 'Confirming...'
                : status === 'success' ? 'Order sent \u2713'
                : status === 'error' ? 'Failed -- Retry'
                : isLong ? `Open Long \u00B7 ${pair.base}` : `Open Short \u00B7 ${pair.base}`}
            </button>
          )}

          {position && (
            <button onClick={closePosition} style={{
              width: '100%', marginTop: 10, padding: 14, borderRadius: 14,
              border: '1px solid rgba(255,138,158,.24)', background: 'rgba(255,138,158,.05)',
              color: C.down, fontWeight: 700, fontSize: 14, cursor: 'pointer', ...T.display,
            }}>Close Position</button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, fontWeight: 600, ...T.mono }}>
            Non-custodial &middot; Powered by Hyperliquid
          </div>
        </div>
      </div>

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        mode={transferMode}
        hlAddress={hlWallet?.address || ''}
        walletPubkey={walletPubkey}
      />
    </>
  );
}

export default function PerpsTrade({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState(() => {
    try { const c = localStorage.getItem('nexus_perps_1h_cache'); return c ? JSON.parse(c) : {}; }
    catch { return {}; }
  });
  const [sparkMap, setSparkMap] = useState(() => {
    try { const c = localStorage.getItem('nexus_perps_spark_cache'); return c ? JSON.parse(c) : {}; }
    catch { return {}; }
  });
  const [marketData, setMarketData] = useState(() => {
    try {
      const c = localStorage.getItem('nexus_perps_cache');
      return c ? JSON.parse(c) : PERPS_PAIRS.map(p => ({
        ...p, price:0, change:0, change1h:0, spark:[],
        volume24h:0, openInterest:0, funding:0, assetIndex:null,
      }));
    } catch {
      return PERPS_PAIRS.map(p => ({
        ...p, price:0, change:0, change1h:0, spark:[],
        volume24h:0, openInterest:0, funding:0, assetIndex:null,
      }));
    }
  });

  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mockPosition] = useState(null);
  const [filter, setFilter] = useState('All');

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();

  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  useEffect(() => { getEthers().catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const data = await fetchMarketData(oneHourMap, sparkMap);
      if (alive) {
        setMarketData(data);
        try { localStorage.setItem('nexus_perps_cache', JSON.stringify(data)); } catch {}
      }
    };
    poll();
    const interval = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(interval); };
  }, [oneHourMap, sparkMap]);

  useEffect(() => {
    let alive = true;
    const pollOneHour = async () => {
      try {
        const currentMarkets = await fetchMarketData(oneHourMap, sparkMap);
        const nextMap = await fetchOneHourChangeMap(currentMarkets);
        if (!alive) return;
        setOneHourMap(nextMap);
        setMarketData(prev => prev.map(p => ({
          ...p,
          change1h: Number.isFinite(nextMap[p.id]) ? nextMap[p.id] : p.change1h || 0,
        })));
        try { localStorage.setItem('nexus_perps_1h_cache', JSON.stringify(nextMap)); } catch {}
      } catch (e) { console.error('1H change fetch failed:', e); }
    };
    pollOneHour();
    const interval = setInterval(pollOneHour, 90000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    let alive = true;
    const pollSparks = async () => {
      try {
        const currentMarkets = await fetchMarketData(oneHourMap, sparkMap);
        const nextMap = await fetchSparklineMap(currentMarkets);
        if (!alive) return;
        setSparkMap(nextMap);
        setMarketData(prev => prev.map(p => ({
          ...p,
          spark: Array.isArray(nextMap[p.id]) ? nextMap[p.id] : (p.spark || []),
        })));
        try { localStorage.setItem('nexus_perps_spark_cache', JSON.stringify(nextMap)); } catch {}
      } catch (e) { console.error('Sparkline fetch failed:', e); }
    };
    pollSparks();
    const interval = setInterval(pollSparks, 300000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!activePair?.id) return;
    const fresh = marketData.find(p => p.id === activePair.id);
    if (fresh) setActivePair(fresh);
  }, [marketData, activePair?.id]);

  const filteredMarketData = useMemo(() => {
    if (filter === 'Hot') return marketData.filter(p => p.hot);
    if (filter === 'Gainers') return [...marketData].filter(p => p.change > 0).sort((a, b) => b.change - a.change);
    if (filter === 'Losers') return [...marketData].filter(p => p.change < 0).sort((a, b) => a.change - b.change);
    return marketData;
  }, [marketData, filter]);

  const openTrade = (pair) => { setActivePair(pair); setDrawerOpen(true); };
  const openFromPosition = () => {
    if (mockPosition) {
      const p = marketData.find(m => m.id === mockPosition.pairId) || activePair;
      setActivePair(p); setDrawerOpen(true);
    }
  };

  const totalVol = marketData.reduce((sum, p) => sum + Number(p.volume24h || 0), 0);
  const gainers = marketData.filter(p => p.change > 0).length;
  const listed = marketData.length;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } } @keyframes nexus-spin { to { transform: rotate(360deg); } } body.nexus-scroll-locked { overflow:hidden; } input[type="range"] { -webkit-appearance:none; appearance:none; background:rgba(255,255,255,.07); border-radius:99px; outline:none; } input[type="range"]::-webkit-slider-runnable-track { height:6px; border-radius:99px; background:rgba(255,255,255,.07); } input[type="range"]::-moz-range-track { height:6px; border-radius:99px; background:rgba(255,255,255,.07); } input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:22px; height:22px; border-radius:50%; background:#fff; cursor:grab; border:2.5px solid #97fce4; box-shadow:0 0 0 4px rgba(151,252,228,.10), 0 0 16px rgba(151,252,228,.55), 0 2px 6px rgba(0,0,0,.35); margin-top:-8px; transition:transform .12s; } input[type="range"]::-webkit-slider-thumb:active { cursor:grabbing; transform:scale(1.08); box-shadow:0 0 0 6px rgba(151,252,228,.14), 0 0 22px rgba(151,252,228,.75), 0 2px 8px rgba(0,0,0,.45); } input[type="range"]::-moz-range-thumb { width:22px; height:22px; border-radius:50%; background:#fff; cursor:grab; border:2.5px solid #97fce4; box-shadow:0 0 0 4px rgba(151,252,228,.10), 0 0 16px rgba(151,252,228,.55); }`}</style>

      <div style={{
        maxWidth: 680, margin: '0 auto', width: '100%',
        padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
        color: C.ink, position: 'relative',
        backgroundImage: `radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)`,
      }}>

        <div style={{
          marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26,
          background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
          border: '1px solid rgba(255,255,255,.07)',
          boxShadow: C.shadowLg,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none',
          }}/>
          <div style={{
            position: 'absolute', left: -30, bottom: -40, width: 160, height: 160, borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(168,127,255,.10),transparent 65%)', pointerEvents: 'none',
          }}/>
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '5px 11px', borderRadius: 999,
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)',
              marginBottom: 16,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: C.hl,
                boxShadow: `0 0 10px ${C.hl}`,
                animation: 'nexus-pulse 2s ease-in-out infinite',
              }}/>
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>
                POWERED BY HYPERLIQUID
              </span>
            </div>
            <h1 style={{
              fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr,
              margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero,
            }}>
              Trade <span style={{
                fontStyle: 'italic', fontWeight: 500,
                background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>perpetuals</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Long or short over 100 markets. Up to 50x leverage. No sign-up, no KYC.
            </p>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
              padding: '12px 14px', borderRadius: 14,
              background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`,
            }}>
              {[
                { label: 'MARKETS', value: listed || '-' },
                { label: '24H VOL', value: shortNum(totalVol) },
                { label: 'GAINERS', value: `${gainers}/${listed || 0}` },
              ].map((s, i) => (
                <div key={s.label} style={{
                  textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
                  borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {mockPosition && (
          <PositionCard
            position={mockPosition}
            pair={marketData.find(p => p.id === mockPosition.pairId) || activePair}
            onClick={openFromPosition}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>Markets</div>
            <div style={{ color: C.muted2, fontSize: 10, fontWeight: 600, marginTop: 2, ...T.mono }}>
              Tap any market to trade
            </div>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {['All', 'Hot', 'Gainers', 'Losers'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '7px 11px', borderRadius: 999,
                border: `1px solid ${filter === f ? C.borderHi : C.border}`,
                background: filter === f ? C.hlDim : 'rgba(255,255,255,.03)',
                color: filter === f ? C.hl : C.muted,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                transition: 'all .15s',
                boxShadow: filter === f ? C.glow : 'none', ...T.body,
              }}>{f}</button>
            ))}
          </div>
        </div>

        <div style={{
          background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`,
          borderRadius: 18, overflow: 'hidden', marginBottom: 18,
          backdropFilter: 'blur(12px)',
        }}>
          {filteredMarketData.map(p => (
            <MarketRow key={p.id} pair={p} onClick={() => openTrade(p)}/>
          ))}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          padding: '12px 16px', borderRadius: 14,
          background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '.04em', ...T.mono,
            background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>HYPERLIQUID</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>&middot;</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>

        <TradeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          pair={activePair}
          onConnectWallet={onConnectWallet}
          walletPubkey={walletPubkey}
          position={mockPosition}
        />
      </div>
    </>
  );
}
