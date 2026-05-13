import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { signL1Action } from '@nktkas/hyperliquid/signing';

const ENABLE_TRADING        = process.env.REACT_APP_HYPERLIQUID_LIVE_TRADING === '1';
const BUILDER_ADDRESS       = '';
const BUILDER_FEE_TENTHS_BP = 5;
const SOL_MINT              = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL      = 1_000_000_000;
const DERIVATION_MSG        = (pub) =>
  `Nexus DEX: Authorize HyperCore Account\n\nWallet: ${pub}\n\nThis creates your non-custodial trading account. No SOL is spent.`;

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
function roundSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100) return n.toFixed(2);
  if (n >= 1)   return n.toFixed(4);
  return n.toFixed(6);
}
function roundPx(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(1);
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}
function aggressivePx(mid, isLong) {
  const px = Number(mid);
  if (!Number.isFinite(px) || px <= 0) return '0';
  return roundPx(isLong ? px * 1.03 : px * 0.97);
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
  return result;
}

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

async function fetchHlBalance(hlAddress) {
  const state = await fetchHlState(hlAddress);
  return parseFloat(state?.marginSummary?.accountValue || 0);
}

async function fetchHlPositions(hlAddress) {
  const state = await fetchHlState(hlAddress);
  if (!state) return [];
  return (state.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi || 0) !== 0)
    .map(p => {
      const pos  = p.position;
      const szi  = parseFloat(pos.szi || 0);
      return {
        coin:       pos.coin,
        szi,
        isLong:     szi > 0,
        size:       Math.abs(szi),
        entryPx:    parseFloat(pos.entryPx        || 0),
        unrealPnl:  parseFloat(pos.unrealizedPnl  || 0),
        leverage:   pos.leverage?.value || 1,
        marginUsed: parseFloat(pos.marginUsed      || 0),
        posValue:   parseFloat(pos.positionValue   || 0),
        roe:        parseFloat(pos.returnOnEquity  || 0),
      };
    });
}

async function pollUntilFunded(hlAddress, targetUsd, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bal = await fetchHlBalance(hlAddress);
    if (bal >= targetUsd * 0.97) return bal;
    await new Promise(r => setTimeout(r, 5_000));
  }
  throw new Error('Bridge is taking longer than expected. Your SOL is safe - refresh to check.');
}

async function depositSolToHyperCore({
  solLamports, hlAddress,
  solPubkey, signSolTx, connection, onStatus,
}) {
  onStatus?.('Getting bridge route...');

  const params = new URLSearchParams({
    fromChain:   'SOL',
    toChain:     '1337',
    fromToken:   SOL_MINT,
    toToken:     'USDC',
    fromAmount:  String(solLamports),
    fromAddress: solPubkey,
    toAddress:   hlAddress,
    slippage:    '0.10',
    integrator:  'nexus-dex',
  });

  const r = await fetch(`/api/lifi/quote?${params}`);
  const quote = await r.json();
  if (!r.ok) throw new Error(quote.message || quote.error || 'LI.FI quote failed');
  if (!quote.transactionRequest?.data) throw new Error('No transaction data from LI.FI');

  onStatus?.('Sign in wallet...');

  const { Transaction, VersionedTransaction } = await import('@solana/web3.js');
  const buf = Buffer.from(quote.transactionRequest.data, 'base64');

  let tx;
  try { tx = VersionedTransaction.deserialize(buf); }
  catch { tx = Transaction.from(buf); }

  const signed = await signSolTx(tx);
  const txHash = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });

  onStatus?.('Bridging...');
  return { txHash };
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
  const sig   = await signTypedDataCompat(wallet, domain, types, action);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
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

function buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly = false }) {
  if (!ENABLE_TRADING) throw new Error('Trading is disabled - set REACT_APP_HYPERLIQUID_LIVE_TRADING=1');
  const assetIndex = pair?.assetIndex;
  const price      = Number(pair?.price || 0);
  const margin     = Number(usdAmount || 0);
  const lev        = Number(leverage || 1);

  if (!Number.isInteger(assetIndex) || assetIndex < 0) throw new Error('Market loading, try again');
  if (!Number.isFinite(price) || price <= 0)           throw new Error('Price unavailable, try again');
  if (!Number.isFinite(margin) || margin < 10)         throw new Error('Minimum order is $10');

  const notional = reduceOnly ? margin : margin * lev;
  const coinSize = roundSize(notional / price);
  if (parseFloat(coinSize) <= 0) throw new Error('Order size too small for this market');

  const limitPx = aggressivePx(price, isLong);
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

async function setLeverageOnHL({ assetIndex, leverage, isCross = false, hlWalletData }) {
  const action   = { type: 'updateLeverage', asset: assetIndex, isCross, leverage };
  const nonce    = Date.now();
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action, nonce });
  return hlRequest({ action, nonce, signature }, true);
}

async function placeOrder({ pair, isLong, usdAmount, leverage, reduceOnly = false, hlWalletData }) {
  if (!hlWalletData?.privateKey) throw new Error('Trading account not ready');

  try {
    await setLeverageOnHL({ assetIndex: pair.assetIndex, leverage, hlWalletData });
  } catch (e) {
    console.warn('[leverage] set failed, proceeding:', e.message);
  }

  const built     = buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly });
  const nonce     = Date.now();
  const mod       = await getEthers();
  const ethersNs  = getEthersNs(mod);
  if (!ethersNs) throw new Error('Ethers unavailable');
  const wallet    = new ethersNs.Wallet(hlWalletData.privateKey);
  const signature = await signL1Action({ wallet, action: built.action, nonce });
  const result    = await hlRequest({ action: built.action, nonce, signature }, true);

  if (result?.status === 'err') {
    const reason = result?.response?.data?.statuses?.[0];
    throw new Error(typeof reason === 'string' ? reason : reason ? JSON.stringify(reason) : 'Order rejected by Hyperliquid');
  }

  const statuses = result?.response?.data?.statuses;
  const first    = statuses?.[0];
  if (first === 'cancelled' || first?.cancelled) {
    throw new Error('Order cancelled - price moved too fast, try again');
  }

  return result;
}

async function fetchMarketData(oneHourMap = {}, sparkMap = {}) {
  try {
    const [metaAndCtxs, mids] = await Promise.all([
      hlRequest({ type: 'metaAndAssetCtxs' }),
      hlRequest({ type: 'allMids' }),
    ]);
    const meta      = Array.isArray(metaAndCtxs) ? metaAndCtxs[0] : {};
    const assetCtxs = Array.isArray(metaAndCtxs) ? metaAndCtxs[1] || [] : [];
    const universe  = (meta.universe || []).map((u, i) => ({
      name: u.name, index: i, maxLeverage: u.maxLeverage || 50, ctx: assetCtxs[i] || {},
    }));
    const priceMap = {};
    if (mids && !Array.isArray(mids)) {
      for (const [k, v] of Object.entries(mids)) { const p = parseFloat(v); priceMap[k] = p > 0 ? p : 0; }
    } else if (Array.isArray(mids)) {
      universe.forEach((u, i) => { const p = parseFloat(mids[i]); priceMap[u.name] = p > 0 ? p : 0; });
    }
    return PERPS_PAIRS.map(p => {
      const info = universe.find(u => u.name === p.id);
      if (!info) return null;
      const ctx    = info.ctx;
      const mid    = priceMap[p.id] || parseFloat(ctx.midPx || ctx.markPx || 0) || 0;
      const prev   = parseFloat(ctx.prevDayPx || 0);
      const change = mid > 0 && prev > 0 ? ((mid - prev) / prev) * 100 : 0;
      return {
        ...p, assetIndex: info.index, price: mid, change,
        change1h:     Number.isFinite(oneHourMap[p.id]) ? oneHourMap[p.id] : 0,
        spark:        Array.isArray(sparkMap[p.id]) ? sparkMap[p.id] : [],
        volume24h:    parseFloat(ctx.dayNtlVlm    || 0),
        openInterest: parseFloat(ctx.openInterest || 0),
        funding:      parseFloat(ctx.funding      || 0),
        leverage:     Math.min(info.maxLeverage, p.leverage),
      };
    }).filter(Boolean);
  } catch {
    return PERPS_PAIRS.map(p => ({
      ...p, price: 0, change: 0,
      change1h: Number.isFinite(oneHourMap[p.id]) ? oneHourMap[p.id] : 0,
      spark: Array.isArray(sparkMap[p.id]) ? sparkMap[p.id] : [],
      volume24h: 0, openInterest: 0, funding: 0, assetIndex: null,
    }));
  }
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
  if (!Array.isArray(data) || data.length < 2) return <div style={{ width, height }}/>;
  const min    = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const stepX  = width / (data.length - 1);
  const points = data.map((v, i) =>
    `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`
  ).join(' ');
  const color = up ? C.up : '#b8a4e8';
  const gid   = `g${up ? 'u' : 'd'}${(data[0] || 0).toString().replace('.', '').slice(0, 8)}`;
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontWeight: 700, color: C.inkStr, fontSize: 15, letterSpacing: '-.02em', ...T.body }}>{pair.base}</span>
          <span style={{ color: C.muted2, fontSize: 10, fontWeight: 600, ...T.mono }}>PERP</span>
          {pair.hot && <span style={{ color: C.amber, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)', ...T.mono }}>HOT</span>}
        </div>
        <div style={{ marginTop: 3, color: C.muted, fontSize: 10, fontWeight: 500, ...T.mono }}>
          Up to {pair.leverage}x &middot; {shortNum(pair.volume24h)} vol
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
        const pair     = marketData.find(p => p.id === pos.coin);
        const markPx   = Number(pair?.price || 0);
        const pnl      = pos.unrealPnl;
        const pnlPct   = pos.marginUsed > 0 ? (pnl / pos.marginUsed) * 100 : 0;
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
                    {pos.size.toFixed(4)} {pos.coin} &middot; Entry {fmt(pos.entryPx, 2)}
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
                ['Mark',   fmt(markPx, 2)],
                ['Value',  fmt(pos.posValue, 2)],
                ['Margin', fmt(pos.marginUsed, 2)],
              ].map(([l, v]) => (
                <div key={l} style={{ padding: '5px 0' }}>
                  <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{l}</div>
                  <div style={{ fontSize: 11, color: C.ink, fontWeight: 700, marginTop: 2, ...T.mono }}>{v}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onClose(pos, pair)} style={{
              width: '100%', padding: '9px', borderRadius: 10,
              border: `1px solid ${inProfit ? 'rgba(61,213,152,.30)' : 'rgba(255,138,158,.30)'}`,
              background: inProfit ? 'rgba(61,213,152,.06)' : 'rgba(255,138,158,.06)',
              color: inProfit ? C.up : C.down,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
            }}>Close Position</button>
          </div>
        );
      })}
    </div>
  );
}

function WalletPanel({ solLamports, solPrice, hlBalanceUsd, hlAddress, onWithdraw }) {
  const solUsd     = (solLamports / LAMPORTS_PER_SOL) * solPrice;
  const totalUsd   = solUsd + hlBalanceUsd;
  const hlSolEquiv = solPrice > 0 ? hlBalanceUsd / solPrice : 0;
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
            {hlSolEquiv > 0 ? hlSolEquiv.toFixed(3) + ' SOL' : '-'}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, ...T.mono }}>{hlBalanceUsd > 0 ? fmt(hlBalanceUsd, 2) : 'Empty'}</div>
        </div>
      </div>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {hlAddress && (
          <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>{hlAddress.slice(0, 6)}...{hlAddress.slice(-4)}</span>
        )}
        {hlBalanceUsd > 0 && (
          <button onClick={onWithdraw} style={{
            padding: '6px 14px', borderRadius: 8,
            border: `1px solid rgba(168,127,255,.30)`,
            background: 'rgba(168,127,255,.08)',
            color: C.violet, fontWeight: 700, fontSize: 11, cursor: 'pointer', ...T.mono,
          }}>Withdraw &rarr;</button>
        )}
      </div>
    </div>
  );
}

function WithdrawModal({ open, onClose, hlAddress, hlPrivateKey, hlBalance, walletPubkey }) {
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');
  const pollRef                   = useRef(null);

  useBodyLock(open);

  useEffect(() => {
    if (!open) { setAmount(''); setStatus('idle'); setError(''); setStatusMsg(''); }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  const isBusy = status === 'loading' || status === 'polling';
  const isDone = status === 'complete';

  const handleWithdraw = async () => {
    const usd = parseFloat(amount);
    if (!usd || usd < 5)                  { setError('Minimum withdrawal is $5'); return; }
    if (usd > hlBalance * 0.99)           { setError('Amount exceeds available balance'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana destination'); return; }

    setStatus('loading'); setError(''); setStatusMsg('Initiating withdrawal...');
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
        try {
          const r    = await fetch('/api/bridge/withdraw/status?id=' + encodeURIComponent(tid));
          const data = await r.json();
          if (data.status === 'bridging')   setStatusMsg('Sending gas to your address...');
          if (data.status === 'finalizing') setStatusMsg('Finalizing...');
          if (data.status === 'complete') {
            clearInterval(pollRef.current);
            setStatus('complete');
            setStatusMsg('');
          } else if (data.status === 'failed') {
            clearInterval(pollRef.current);
            setError(data.error || 'Withdrawal failed');
            setStatus('error');
          }
        } catch {}
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
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid rgba(168,127,255,.30)`, borderRadius: '26px 26px 0 0',
        padding: '20px 22px calc(env(safe-area-inset-bottom) + 22px)',
        boxShadow: `0 -24px 70px rgba(0,0,0,.6)`,
      }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 18, letterSpacing: '-.02em', ...T.display }}>Withdraw</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 3, ...T.body }}>HyperCore to your Arbitrum address (~2 min)</div>
          </div>
          <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer', opacity: isBusy ? 0.4 : 1 }}>x</button>
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
          HL charges a $1 flat withdrawal fee. USDC arrives on Arbitrum ready to bridge.
        </div>

        {(isBusy || isDone) && statusMsg && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: `1px solid rgba(151,252,228,.20)`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isDone && <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>}
            {isDone  && <span style={{ fontSize: 14 }}>&#x2713;</span>}
            <span style={{ fontSize: 12, color: isDone ? C.up : C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {isDone && (
          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(61,213,152,.08)', border: `1px solid rgba(61,213,152,.24)`, borderRadius: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: C.up, fontWeight: 800, ...T.display }}>USDC on its way &#x2713;</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, ...T.body }}>Check your Arbitrum address - gas sponsored for bridge</div>
          </div>
        )}
        {error && <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

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
            {isBusy ? 'Processing...' : 'Withdraw from HyperCore'}
          </button>
        )}
      </div>
    </>
  );
}

function TradeDrawer({ open, onClose, pair, onConnectWallet, walletPubkey, marketData }) {
  const { connected, signMessage, signTransaction, publicKey } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]               = useState('long');
  const [solAmount, setSolAmount]     = useState('');
  const [leverage, setLeverage]       = useState(5);
  const [status, setStatus]           = useState('idle');
  const [statusMsg, setStatusMsg]     = useState('');
  const [error, setError]             = useState('');
  const [solLamports, setSolLamports] = useState(0);
  const [solPrice, setSolPrice]       = useState(0);
  const [hlBalance, setHlBalance]     = useState(0);
  const [hlWallet, setHlWallet]       = useState(null);
  const [positions, setPositions]     = useState([]);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  useBodyLock(open && !withdrawOpen);

  useEffect(() => {
    if (!open || !publicKey || !wcon) return;
    let alive = true;

    const cached = getSessionWallet(walletPubkey);
    if (cached) setHlWallet({ address: cached.address });

    const loadAll = async () => {
      const [lam, price] = await Promise.all([
        fetchSolBalance(connection, publicKey),
        fetchSolPrice().catch(() => 0),
      ]);
      if (!alive) return;
      setSolLamports(lam);
      setSolPrice(price);

      if (cached) {
        const [hlBal, pos] = await Promise.all([
          fetchHlBalance(cached.address),
          fetchHlPositions(cached.address),
        ]);
        if (alive) { setHlBalance(hlBal); setPositions(pos); }
      }

      const inFlight = loadBridge('deposit');
      if (inFlight && cached && alive) {
        setStatus('loading');
        setStatusMsg('Waiting for bridge to complete...');
        pollUntilFunded(cached.address, inFlight.usd)
          .then(bal => {
            if (!alive) return;
            setHlBalance(bal);
            clearBridge('deposit');
            setStatus('idle');
            setStatusMsg('');
          })
          .catch(() => { if (alive) { clearBridge('deposit'); setStatus('idle'); setStatusMsg(''); } });
      }
    };
    loadAll();

    const interval = setInterval(async () => {
      if (!alive) return;
      const addr = getSessionWallet(walletPubkey)?.address;
      const [lam, hlBal, pos] = await Promise.all([
        fetchSolBalance(connection, publicKey),
        addr ? fetchHlBalance(addr) : Promise.resolve(0),
        addr ? fetchHlPositions(addr) : Promise.resolve([]),
      ]);
      if (alive) { setSolLamports(lam); if (addr) { setHlBalance(hlBal); setPositions(pos); } }
    }, 10_000);

    return () => { alive = false; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, walletPubkey, wcon]);

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
    if (!signTransaction) { setError('Wallet cannot sign transactions'); return; }
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

      let currentHlBal = await fetchHlBalance(walletData.address);
      setHlBalance(currentHlBal);

      if (currentHlBal < usd * 0.99) {
        const needed   = usd - currentHlBal;
        const lamports = Math.ceil((needed / solPrice) * LAMPORTS_PER_SOL * 1.03);
        setStatusMsg('Bridging SOL...');
        const { txHash } = await depositSolToHyperCore({
          solLamports:  lamports,
          hlAddress:    walletData.address,
          solPubkey:    walletPubkey,
          signSolTx:    signTransaction,
          connection,
          onStatus:     setStatusMsg,
        });
        saveBridge('deposit', { txHash, usd: needed });
        setStatusMsg('Waiting for funds (~30s)...');
        currentHlBal = await pollUntilFunded(walletData.address, usd);
        setHlBalance(currentHlBal);
        clearBridge('deposit');
      }

      setStatusMsg(`Opening ${isLong ? 'long' : 'short'}...`);
      await placeOrder({ pair, isLong, usdAmount: usd, leverage, hlWalletData: walletData });

      setStatus('success');
      setStatusMsg('');
      const [lam, hlBal, pos] = await Promise.all([
        fetchSolBalance(connection, publicKey),
        fetchHlBalance(walletData.address),
        fetchHlPositions(walletData.address),
      ]);
      setSolLamports(lam);
      setHlBalance(hlBal);
      setPositions(pos);
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
        isLong:     !pos.isLong,
        usdAmount:  pos.posValue,
        leverage:   pos.leverage,
        reduceOnly: true,
        hlWalletData: walletData,
      });
      setStatus('success');
      setStatusMsg('');
      const [hlBal, newPos] = await Promise.all([
        fetchHlBalance(walletData.address),
        fetchHlPositions(walletData.address),
      ]);
      setHlBalance(hlBal);
      setPositions(newPos);
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
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1 }}>x</button>
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px calc(env(safe-area-inset-bottom) + 86px)' }}>

          {wcon && (
            <WalletPanel
              solLamports={solLamports} solPrice={solPrice}
              hlBalanceUsd={hlBalance} hlAddress={hlWallet?.address}
              onWithdraw={() => setWithdrawOpen(true)}
            />
          )}

          <PositionsPanel
            positions={positions}
            marketData={marketData}
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
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#14f195,#9945ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#000' }}>&#9677;</div>
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
              <span>Conservative &middot; Balanced &middot; Aggressive</span>
              <span style={{ fontWeight: 700 }}>{pair.leverage}x</span>
            </div>
          </div>

          {solVal > 0 && solPrice > 0 && entryPrice > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              {[
                ['Margin',        fmt(usdAmount, 2)],
                ['Position size', roundSize(notionalUsd / entryPrice) + ' ' + pair.base],
                ['Limit price',   fmt(aggressivePx(entryPrice, isLong))],
                ['Liquidation',   fmt(liqPrice, 4)],
                ['Funding rate',  (fundingRate >= 0 ? '+' : '') + (fundingRate * 100).toFixed(4) + '% / 8h'],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: l === 'Funding rate' ? (fundingRate >= 0 ? C.down : C.up) : C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {(isBusy || isSuccess) && statusMsg && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(151,252,228,.05)', border: `1px solid rgba(151,252,228,.20)`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 12, padding: 11, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

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
              {isBusy ? 'Processing...' : isSuccess ? `${isLong ? 'Long' : 'Short'} opened` : isError ? 'Retry' : isLong ? `Long ${pair.base} ${leverage}x` : `Short ${pair.base} ${leverage}x`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, fontWeight: 600, ...T.mono }}>
            Non-custodial &middot; Powered by Hyperliquid &amp; LI.FI
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
    </>
  );
}

export default function PerpsTrade({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState({});
  const [sparkMap,   setSparkMap]   = useState({});
  const [marketData, setMarketData] = useState(() =>
    PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, change1h: 0, spark: [], volume24h: 0, openInterest: 0, funding: 0, assetIndex: null }))
  );
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter]         = useState('All');

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
    const poll = async () => { const data = await fetchMarketData(oneHourMap, sparkMap); if (alive) setMarketData(data); };
    poll();
    const id = setInterval(poll, 8_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneHourMap, sparkMap]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const cur = await fetchMarketData();
      const map = await fetchOneHourMap(cur);
      if (!alive) return;
      setOneHourMap(map);
      setMarketData(prev => prev.map(p => ({ ...p, change1h: map[p.id] ?? p.change1h })));
    };
    poll();
    const id = setInterval(poll, 90_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const cur = await fetchMarketData();
      const map = await fetchSparkMap(cur);
      if (!alive) return;
      setSparkMap(map);
      setMarketData(prev => prev.map(p => ({ ...p, spark: map[p.id] ?? p.spark })));
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!activePair?.id) return;
    const fresh = marketData.find(p => p.id === activePair.id);
    if (fresh) setActivePair(fresh);
  }, [marketData, activePair?.id]);

  const filtered = useMemo(() => {
    if (filter === 'Hot')     return marketData.filter(p => p.hot);
    if (filter === 'Gainers') return [...marketData].filter(p => p.change > 0).sort((a, b) => b.change - a.change);
    if (filter === 'Losers')  return [...marketData].filter(p => p.change < 0).sort((a, b) => a.change - b.change);
    return marketData;
  }, [marketData, filter]);

  const totalVol = marketData.reduce((s, p) => s + Number(p.volume24h || 0), 0);
  const gainers  = marketData.filter(p => p.change > 0).length;
  const openTrade = (pair) => { setActivePair(pair); setDrawerOpen(true); };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; } input[type="range"]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.07);border-radius:99px;outline:none;} input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:rgba(255,255,255,.07);} input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;box-shadow:0 0 0 4px rgba(151,252,228,.10),0 0 16px rgba(151,252,228,.55),0 2px 6px rgba(0,0,0,.35);margin-top:-8px;transition:transform .12s;} input[type="range"]::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.08);} input[type="range"]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;cursor:grab;border:2.5px solid #97fce4;}`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: `radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)` }}>

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
              Connect your Solana wallet. Pick a market. Long or short - that's it.
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
            {['All', 'Hot', 'Gainers', 'Losers'].map(f => (
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
          <span style={{ color: C.muted2, fontSize: 9 }}>&middot;</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>

        <TradeDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          pair={activePair}
          onConnectWallet={onConnectWallet}
          walletPubkey={walletPubkey}
          marketData={marketData}
        />
      </div>
    </>
  );
}
