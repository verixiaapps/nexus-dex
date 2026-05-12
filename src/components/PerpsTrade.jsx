import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';

/* ============================================================================
 * NEXUS DEX -- Hyperliquid Perps Trading Interface
 * Non-custodial UI shell.
 *
 * UI direction:
 * - Phantom-style dark glass, rounded panels, purple/cyan glow.
 * - PancakeSwap-style colorful market cards and quick trade drawer.
 *
 * IMPORTANT:
 * - Hyperliquid asset index must come from meta.universe.
 * - Order size must be coin size, not USD amount.
 * - Builder fee requires approved builder address, not bytes32 builder code.
 * - Live signed order submission should be handled by your backend or official SDK.
 * ========================================================================= */

const ENABLE_TRADING =
  process.env.REACT_APP_HYPERLIQUID_LIVE_TRADING === '1';

const BUILDER_ADDRESS = '';
const BUILDER_FEE_TENTHS_BP = 5;

const C = {
  bg: '#03050d',
  bg2: '#070a16',
  card: '#0b1020',
  card2: '#10172a',
  card3: '#151f36',
  glass: 'rgba(13,18,36,.72)',
  border: 'rgba(255,255,255,.08)',
  borderHi: 'rgba(153,69,255,.38)',
  accent: '#00e5ff',
  accent2: '#7c5cff',
  purple: '#9945ff',
  pink: '#ff4fd8',
  green: '#00ffa3',
  red: '#ff3b6b',
  yellow: '#ffd166',
  text: '#e8ecff',
  muted: '#8a94b8',
  muted2: '#4d577a',
  buyGrad: 'linear-gradient(135deg,#00ffa3 0%,#00d5ff 55%,#625bff 100%)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b 0%,#ff4fd8 55%,#9945ff 100%)',
  purpleGrad: 'linear-gradient(135deg,#9945ff 0%,#6d5dfc 55%,#00e5ff 100%)',
  pancakeGrad: 'linear-gradient(135deg,rgba(122,92,255,.22),rgba(0,229,255,.12),rgba(0,255,163,.08))',
  cardGlow: '0 18px 60px rgba(0,0,0,.38), 0 0 30px rgba(153,69,255,.08)',
};

const PERPS_PAIRS = [
  { id: 'BTC', base: 'BTC', leverage: 50, hot: true },
  { id: 'ETH', base: 'ETH', leverage: 50, hot: true },
  { id: 'SOL', base: 'SOL', leverage: 20, hot: true },
  { id: 'HYPE', base: 'HYPE', leverage: 10, hot: true },
  { id: 'BNB', base: 'BNB', leverage: 20 },
  { id: 'XRP', base: 'XRP', leverage: 20 },
  { id: 'DOGE', base: 'DOGE', leverage: 20 },
  { id: 'AVAX', base: 'AVAX', leverage: 15 },
  { id: 'LINK', base: 'LINK', leverage: 20 },
  { id: 'SUI', base: 'SUI', leverage: 20 },
  { id: 'ADA', base: 'ADA', leverage: 20 },
  { id: 'TRX', base: 'TRX', leverage: 10 },
  { id: 'TON', base: 'TON', leverage: 10 },
  { id: 'APT', base: 'APT', leverage: 10 },
  { id: 'NEAR', base: 'NEAR', leverage: 10 },
  { id: 'ARB', base: 'ARB', leverage: 20 },
  { id: 'OP', base: 'OP', leverage: 15 },
  { id: 'POL', base: 'POL', leverage: 20 },
  { id: 'TIA', base: 'TIA', leverage: 10 },
  { id: 'SEI', base: 'SEI', leverage: 10 },
  { id: 'INJ', base: 'INJ', leverage: 10 },
  { id: 'WIF', base: 'WIF', leverage: 10 },
  { id: 'PEPE', base: 'PEPE', leverage: 10 },
  { id: 'FET', base: 'FET', leverage: 10 },
  { id: 'RUNE', base: 'RUNE', leverage: 10 },
  { id: 'MKR', base: 'MKR', leverage: 10 },
  { id: 'AAVE', base: 'AAVE', leverage: 10 },
  { id: 'UNI', base: 'UNI', leverage: 10 },
  { id: 'LTC', base: 'LTC', leverage: 10 },
  { id: 'BCH', base: 'BCH', leverage: 10 },
  { id: 'ATOM', base: 'ATOM', leverage: 10 },
  { id: 'DOT', base: 'DOT', leverage: 10 },
  { id: 'FIL', base: 'FIL', leverage: 10 },
  { id: 'JUP', base: 'JUP', leverage: 10 },
  { id: 'PYTH', base: 'PYTH', leverage: 10 },
  { id: 'ENA', base: 'ENA', leverage: 10 },
  { id: 'ONDO', base: 'ONDO', leverage: 10 },
  { id: 'TAO', base: 'TAO', leverage: 10 },
  { id: 'WLD', base: 'WLD', leverage: 10 },
  { id: 'ORDI', base: 'ORDI', leverage: 10 },
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
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  return '$' + x.toFixed(0);
}

function pct(n) {
  if (n == null || isNaN(n)) return '-';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

function isValidEthAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ''));
}

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
    BTC: ['#f7931a', '#ffcf62'],
    ETH: ['#627eea', '#9aaeff'],
    SOL: ['#14f195', '#9945ff'],
    HYPE: ['#00e5ff', '#7c5cff'],
    DOGE: ['#c2a633', '#fff0a3'],
    PEPE: ['#00ffa3', '#61d66f'],
    XRP: ['#8a94b8', '#ffffff'],
    BNB: ['#f3ba2f', '#fff1a8'],
    SUI: ['#4da2ff', '#9fd0ff'],
    LINK: ['#2a5ada', '#7aa1ff'],
    AVAX: ['#e84142', '#ff9090'],
  };
  return map[symbol] || ['#9945ff', '#00e5ff'];
}

let _ethersModule = null;

async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}

function generateHlWallet() {
  const mod = _ethersModule;
  const ethers = mod?.ethers;
  if (!ethers) return null;
  const wallet = ethers.Wallet.createRandom();
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

function getStorageKey(walletPubkey) {
  return 'nexus_hl_wallet_' + (walletPubkey || 'anon');
}

function getStoredHlWallet(walletPubkey) {
  try {
    const raw = localStorage.getItem(getStorageKey(walletPubkey));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.address || !data?.encrypted) return null;
    const pk = xorDecrypt(data.encrypted, data.address + 'nexus');
    return pk ? { address: data.address, privateKey: pk } : null;
  } catch {
    return null;
  }
}

function storeHlWallet(walletPubkey, address, privateKey) {
  try {
    const encrypted = xorEncrypt(privateKey, address + 'nexus');
    localStorage.setItem(
      getStorageKey(walletPubkey),
      JSON.stringify({ address, encrypted, ts: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

async function hlRequest(body, isExchange = false) {
  const path = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.detail || 'Hyperliquid request failed');
  }

  return data;
}

async function fetchOneHourChange(coin) {
  try {
    const now = Date.now();
    const startTime = now - 2 * 60 * 60 * 1000;

    const candles = await hlRequest({
      type: 'candleSnapshot',
      req: {
        coin,
        interval: '1h',
        startTime,
        endTime: now,
      },
    });

    if (!Array.isArray(candles) || candles.length === 0) return 0;

    const latest = candles[candles.length - 1];
    const open = Number(latest.o || 0);
    const close = Number(latest.c || 0);

    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return 0;
    return ((close - open) / open) * 100;
  } catch {
    return 0;
  }
}

async function fetchMarketData(existingOneHourMap = {}) {
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

    return PERPS_PAIRS
      .map(p => {
        const info = universe.find(u => u.name === p.id);
        if (!info) return null;

        const ctx = info.ctx || {};
        const midPrice = priceMap[p.id] || parseFloat(ctx.midPx || ctx.markPx || 0) || 0;
        const prevDayPx = parseFloat(ctx.prevDayPx || 0);
        const dayNtlVlm = parseFloat(ctx.dayNtlVlm || 0);
        const openInterest = parseFloat(ctx.openInterest || 0);
        const funding = parseFloat(ctx.funding || 0);

        const change =
          midPrice > 0 && prevDayPx > 0
            ? ((midPrice - prevDayPx) / prevDayPx) * 100
            : 0;

        return {
          ...p,
          assetIndex: info.index,
          price: midPrice,
          change,
          change1h: Number.isFinite(existingOneHourMap[p.id]) ? existingOneHourMap[p.id] : 0,
          volume24h: dayNtlVlm,
          openInterest,
          funding,
          leverage: Math.min(info.maxLeverage, p.leverage),
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error('Market data fetch failed:', e);
    return PERPS_PAIRS.map(p => ({
      ...p,
      price: 0,
      change: 0,
      change1h: Number.isFinite(existingOneHourMap[p.id]) ? existingOneHourMap[p.id] : 0,
      volume24h: 0,
      openInterest: 0,
      funding: 0,
      assetIndex: null,
    }));
  }
}

async function fetchOneHourChangeMap(markets) {
  const limited = markets.slice(0, 28);
  const changes = await Promise.all(limited.map(p => fetchOneHourChange(p.id)));

  const map = {};
  limited.forEach((p, i) => {
    map[p.id] = Number.isFinite(changes[i]) ? changes[i] : 0;
  });

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
    orders: [{
      a: assetIndex,
      b: Boolean(isLong),
      p: limitPx,
      s: coinSize,
      r: Boolean(reduceOnly),
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
  };

  if (isValidEthAddress(BUILDER_ADDRESS)) {
    action.builder = {
      b: BUILDER_ADDRESS,
      f: BUILDER_FEE_TENTHS_BP,
    };
  }

  return {
    action,
    leverage: Number(leverage || 1),
    coinSize,
    notional,
    limitPx,
  };
}

async function placeOrder({ pair, isLong, usdAmount, leverage, reduceOnly = false }) {
  const built = buildOrderAction({ pair, isLong, usdAmount, leverage, reduceOnly });

  return hlRequest({
    type: 'placeOrder',
    source: 'nexus-perps-ui',
    ...built,
  }, true);
}

function StatPill({ label, value, tone }) {
  const color = tone === 'up' ? C.green : tone === 'down' ? C.red : C.accent;

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 999,
      background: 'rgba(255,255,255,.045)',
      border: '1px solid rgba(255,255,255,.075)',
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: C.muted, fontSize: 10, fontWeight: 800 }}>{label}</span>
      <span style={{ color, fontSize: 11, fontWeight: 900 }}>{value}</span>
    </div>
  );
}

function PairLogo({ symbol, size = 42 }) {
  const [a, b] = coinAccent(symbol);

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: size * 0.34,
      background: `linear-gradient(135deg,${a},${b})`,
      boxShadow: `0 0 22px ${a}44`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#070a16',
      fontWeight: 1000,
      fontSize: size < 34 ? 11 : 14,
      letterSpacing: '-.04em',
      flexShrink: 0,
    }}>
      {symbol.slice(0, 3)}
    </div>
  );
}

function PairCard({ pair, active, onClick }) {
  const up = pair.change >= 0;

  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid ' + (active ? 'rgba(153,69,255,.55)' : C.border),
        background: active ? C.pancakeGrad : 'rgba(255,255,255,.045)',
        borderRadius: 18,
        padding: 12,
        cursor: 'pointer',
        transition: 'all .15s',
        flex: '0 0 auto',
        minWidth: 126,
        textAlign: 'left',
        boxShadow: active ? '0 0 26px rgba(153,69,255,.18)' : 'none',
        fontFamily: 'Syne, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <PairLogo symbol={pair.base} size={30} />
        <div>
          <div style={{ fontWeight: 950, fontSize: 13, color: '#fff' }}>{pair.base}</div>
          <div style={{ fontSize: 9, color: C.muted, fontWeight: 800 }}>PERP</div>
        </div>
      </div>

      <div style={{ fontSize: 14, color: C.text, fontWeight: 950, marginBottom: 7 }}>
        {fmt(pair.price, 2)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{
          color: up ? C.green : C.red,
          fontSize: 10,
          fontWeight: 950,
          background: up ? 'rgba(0,255,163,.09)' : 'rgba(255,59,107,.09)',
          border: '1px solid ' + (up ? 'rgba(0,255,163,.18)' : 'rgba(255,59,107,.18)'),
          borderRadius: 999,
          padding: '3px 7px',
        }}>
          24H {pct(pair.change)}
        </span>
        <span style={{ color: C.muted, fontSize: 10, fontWeight: 800 }}>
          {pair.leverage}x
        </span>
      </div>
    </button>
  );
}

function PositionCard({ position, pair, onClick }) {
  const entry = Number(position.entryPrice || 0);
  const current = Number(pair?.price || 0);
  const isLong = position.side === 'long';
  const leverage = Number(position.leverage || 1);
  const size = Number(position.size || 0);

  let pnl = 0;
  let pnlPct = 0;

  if (entry > 0 && current > 0 && size > 0) {
    pnl = isLong ? ((current - entry) / entry) * size : ((entry - current) / entry) * size;
    pnlPct = size > 0 && leverage > 0 ? (pnl / (size / leverage)) * 100 : 0;
  }

  const inProfit = pnl >= 0;

  return (
    <div
      onClick={onClick}
      style={{
        background: 'linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.035))',
        border: '1px solid ' + (inProfit ? 'rgba(0,255,163,.28)' : 'rgba(255,59,107,.28)'),
        borderRadius: 22,
        padding: 16,
        cursor: 'pointer',
        boxShadow: inProfit ? '0 0 30px rgba(0,255,163,.08)' : '0 0 30px rgba(255,59,107,.08)',
        transition: 'all .2s',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PairLogo symbol={pair?.base || '?'} size={42} />
          <div>
            <div style={{ fontWeight: 950, fontSize: 15, color: '#fff' }}>{pair?.base}-PERP</div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 750 }}>
              {isLong ? 'Long' : 'Short'} · {leverage}x
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 950, color: inProfit ? C.green : C.red }}>
            {inProfit ? '+' : ''}{fmt(pnl)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 850, color: inProfit ? C.green : C.red }}>
            {pct(pnlPct)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransferModal({ open, onClose, mode, hlAddress }) {
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const isDeposit = mode === 'deposit';

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setAmount('');
      setStatus('idle');
      setError('');
    }
  }, [open]);

  const handle = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;

    setStatus('error');
    setError('Bridge execution is not wired yet. Connect this button to your OKX / Hyperliquid bridge backend before enabling live transfers.');
    setTimeout(() => setStatus('idle'), 3500);
  };

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(10px)' }} />
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 500,
        zIndex: 451,
        background: 'linear-gradient(180deg,#11172c,#070a16)',
        borderTop: '1px solid ' + C.borderHi,
        borderRadius: '28px 28px 0 0',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -30px 80px rgba(0,0,0,.55)',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 44, height: 5, background: 'rgba(255,255,255,.18)', borderRadius: 99, margin: '0 auto 18px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 950, fontSize: 20 }}>
                {isDeposit ? 'Deposit' : 'Withdraw'}
              </div>
              <div style={{ color: C.muted, fontWeight: 700, fontSize: 12, marginTop: 3 }}>
                {isDeposit ? 'Move funds into Hyperliquid' : 'Move funds out of Hyperliquid'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: C.text, width: 34, height: 34, borderRadius: 12, fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 82px)' }}>
          <div style={{ marginBottom: 14, padding: 14, background: 'rgba(255,255,255,.045)', borderRadius: 16, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 900, marginBottom: 6 }}>
              {isDeposit ? 'DESTINATION' : 'SOURCE'}
            </div>
            <div style={{ fontSize: 11, color: C.text, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {hlAddress || 'No Hyperliquid wallet yet'}
            </div>
          </div>

          <div style={{
            marginBottom: 14,
            padding: 14,
            borderRadius: 18,
            background: isDeposit ? 'rgba(0,229,255,.07)' : 'rgba(153,69,255,.08)',
            border: '1px solid ' + (isDeposit ? 'rgba(0,229,255,.18)' : 'rgba(153,69,255,.22)'),
          }}>
            <div style={{ fontSize: 12, color: isDeposit ? C.accent : C.purple, fontWeight: 950 }}>
              {isDeposit ? 'SOL → USDC → Hyperliquid' : 'Hyperliquid → USDC → SOL'}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: C.muted, fontWeight: 750 }}>Powered by OKX routing</div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 850, marginBottom: 7 }}>AMOUNT</div>
            <div style={{
              background: 'rgba(255,255,255,.05)',
              border: '1px solid ' + C.border,
              borderRadius: 18,
              padding: '16px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ color: C.muted, fontSize: 18 }}>$</span>
              <input
                value={amount}
                onChange={e => setAmount(cleanAmount(e.target.value))}
                placeholder="0.00"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 900, color: '#fff', outline: 'none', fontFamily: 'Syne, sans-serif' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {[25, 50, 100, 250].map(v => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: 12,
                    border: '1px solid ' + (parseFloat(amount) === v ? C.accent : C.border),
                    background: parseFloat(amount) === v ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.045)',
                    color: parseFloat(amount) === v ? C.accent : C.muted,
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 14, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          <button
            onClick={handle}
            disabled={!amount || status === 'loading'}
            style={{
              width: '100%',
              padding: 18,
              borderRadius: 18,
              border: 'none',
              background: isDeposit ? C.buyGrad : C.purpleGrad,
              color: '#fff',
              fontWeight: 950,
              fontSize: 16,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              minHeight: 58,
              fontFamily: 'Syne, sans-serif',
              boxShadow: isDeposit ? '0 12px 34px rgba(0,229,255,.22)' : '0 12px 34px rgba(153,69,255,.22)',
            }}
          >
            {isDeposit ? 'Start Deposit' : 'Start Withdraw'}
          </button>
        </div>
      </div>
    </>
  );
}

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
      setAmount('');
      setTakeProfit('');
      setStopLoss('');
      setSizePct(null);
      setStatus('idle');
      setError('');
      const stored = getStoredHlWallet(walletPubkey);
      setHlWallet(stored ? { address: stored.address } : null);
    }
  }, [open, walletPubkey]);

  useEffect(() => {
    if (pair?.leverage && leverage > pair.leverage) {
      setLeverage(pair.leverage);
    }
  }, [pair?.leverage, leverage]);

  const isLong = side === 'long';
  const entryPrice = Number(pair?.price || 0);
  const liqPrice = entryPrice > 0
    ? isLong
      ? entryPrice * (1 - 0.9 / leverage)
      : entryPrice * (1 + 0.9 / leverage)
    : 0;

  const createWallet = async () => {
    setCreatingWallet(true);
    setError('');

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

  const quickSize = (p) => {
    setSizePct(p);
    setAmount('');
  };

  const execute = async () => {
    if (!wcon) {
      onConnectWallet?.();
      return;
    }

    if (!hlWallet) {
      await createWallet();
      return;
    }

    const usdAmount = parseFloat(amount);
    if (!usdAmount || usdAmount < 10) {
      setError('Minimum order value is $10.');
      return;
    }

    if (!pair?.assetIndex && pair?.assetIndex !== 0) {
      setError('Market is still loading. Try again in a moment.');
      return;
    }

    if (!pair?.price) {
      setError('Price unavailable. Try again in a moment.');
      return;
    }

    setStatus('loading');
    setError('');

    try {
      await placeOrder({
        pair,
        isLong,
        usdAmount,
        leverage,
      });

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1800);
    } catch (e) {
      console.error('Trade failed:', e);
      setError(e.message || 'Trade failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const closePosition = async () => {
    if (!hlWallet || !position) return;

    setStatus('loading');
    setError('');

    try {
      await placeOrder({
        pair,
        isLong: position.side !== 'long',
        usdAmount: position.size || 0,
        leverage: position.leverage || 1,
        reduceOnly: true,
      });

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1800);
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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(10px)' }} />
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 540,
        zIndex: 401,
        background: 'linear-gradient(180deg,#11172c,#070a16 72%)',
        borderTop: '1px solid ' + C.borderHi,
        borderRadius: '30px 30px 0 0',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -34px 90px rgba(0,0,0,.6)',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 20px 12px' }}>
          <div style={{ width: 46, height: 5, background: 'rgba(255,255,255,.18)', borderRadius: 999, margin: '0 auto 18px' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PairLogo symbol={pair.base} size={48} />
              <div>
                <div style={{ color: '#fff', fontWeight: 1000, fontSize: 21, letterSpacing: '-.04em' }}>{pair.base}-PERP</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                  <span style={{ color: C.text, fontSize: 16, fontWeight: 950 }}>{fmt(pair.price, 2)}</span>
                  <span style={{ color: dayUp ? C.green : C.red, fontSize: 12, fontWeight: 950 }}>24H {pct(pair.change)}</span>
                </div>
              </div>
            </div>

            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.08)',
              color: C.text,
              width: 36,
              height: 36,
              borderRadius: 13,
              fontSize: 24,
              cursor: 'pointer',
            }}>
              ×
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto', paddingBottom: 2 }}>
            <StatPill label="1H" value={pct(pair.change1h)} tone={oneHourUp ? 'up' : 'down'} />
            <StatPill label="24H" value={pct(pair.change)} tone={dayUp ? 'up' : 'down'} />
            <StatPill label="VOL" value={shortNum(pair.volume24h)} />
            <StatPill label="MAX" value={`${pair.leverage}x`} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 86px)' }}>
          {position && (
            <div style={{ marginBottom: 16 }}>
              <PositionCard position={position} pair={pair} onClick={() => {}} />
            </div>
          )}

          {!hlWallet && wcon && (
            <div style={{
              marginBottom: 16,
              padding: 15,
              background: 'linear-gradient(135deg,rgba(153,69,255,.14),rgba(0,229,255,.08))',
              border: '1px solid rgba(153,69,255,.28)',
              borderRadius: 18,
              textAlign: 'center',
            }}>
              <div style={{ color: C.text, fontWeight: 950, fontSize: 14, marginBottom: 4 }}>Create your Hyperliquid wallet</div>
              <div style={{ color: C.muted, fontWeight: 700, fontSize: 11, marginBottom: 10 }}>Required before live perps trading</div>
              <button
                onClick={createWallet}
                disabled={creatingWallet}
                style={{
                  padding: '11px 22px',
                  borderRadius: 14,
                  border: 'none',
                  background: C.purpleGrad,
                  color: '#fff',
                  fontWeight: 950,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                {creatingWallet ? 'Creating...' : 'Create Wallet'}
              </button>
            </div>
          )}

          {hlWallet && (
            <div style={{
              marginBottom: 16,
              padding: 14,
              background: 'rgba(0,255,163,.06)',
              border: '1px solid rgba(0,255,163,.16)',
              borderRadius: 18,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 950 }}>HYPERLIQUID WALLET</div>
                  <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', marginTop: 3 }}>
                    {hlWallet.address.slice(0, 6)}...{hlWallet.address.slice(-4)}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: C.green, fontWeight: 900 }}>Connected</div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setTransferMode('deposit');
                    setTransferOpen(true);
                  }}
                  style={{
                    flex: 1,
                    padding: '11px',
                    borderRadius: 13,
                    border: '1px solid rgba(0,229,255,.24)',
                    background: 'rgba(0,229,255,.08)',
                    color: C.accent,
                    fontWeight: 950,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >
                  Deposit
                </button>
                <button
                  onClick={() => {
                    setTransferMode('withdraw');
                    setTransferOpen(true);
                  }}
                  style={{
                    flex: 1,
                    padding: '11px',
                    borderRadius: 13,
                    border: '1px solid rgba(153,69,255,.28)',
                    background: 'rgba(153,69,255,.08)',
                    color: '#b99cff',
                    fontWeight: 950,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >
                  Withdraw
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <button
              onClick={() => setSide('long')}
              style={{
                padding: 15,
                borderRadius: 18,
                border: '1px solid ' + (isLong ? 'rgba(0,255,163,.55)' : C.border),
                background: isLong ? 'rgba(0,255,163,.10)' : 'rgba(255,255,255,.045)',
                color: isLong ? C.green : C.muted,
                fontWeight: 1000,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'Syne, sans-serif',
                boxShadow: isLong ? '0 0 26px rgba(0,255,163,.12)' : 'none',
              }}
            >
              Long
            </button>

            <button
              onClick={() => setSide('short')}
              style={{
                padding: 15,
                borderRadius: 18,
                border: '1px solid ' + (!isLong ? 'rgba(255,59,107,.55)' : C.border),
                background: !isLong ? 'rgba(255,59,107,.10)' : 'rgba(255,255,255,.045)',
                color: !isLong ? C.red : C.muted,
                fontWeight: 1000,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'Syne, sans-serif',
                boxShadow: !isLong ? '0 0 26px rgba(255,59,107,.12)' : 'none',
              }}
            >
              Short
            </button>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 900 }}>AMOUNT</span>
              <span style={{ fontSize: 10, color: C.accent, fontWeight: 950, background: 'rgba(0,229,255,.09)', padding: '4px 9px', borderRadius: 999 }}>Market IOC</span>
            </div>

            <div style={{
              background: 'rgba(255,255,255,.05)',
              border: '1px solid ' + C.border,
              borderRadius: 18,
              padding: '15px 16px',
              marginBottom: 9,
            }}>
              <input
                value={amount}
                onChange={e => {
                  setAmount(cleanAmount(e.target.value));
                  setSizePct(null);
                  setError('');
                }}
                placeholder="$0.00"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  fontSize: 25,
                  fontWeight: 1000,
                  color: '#fff',
                  outline: 'none',
                  fontFamily: 'Syne, sans-serif',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 7 }}>
              {[25, 50, 75, 100].map(p => (
                <button
                  key={p}
                  onClick={() => quickSize(p)}
                  style={{
                    flex: 1,
                    padding: '9px',
                    borderRadius: 12,
                    border: '1px solid ' + (sizePct === p ? C.accent : C.border),
                    background: sizePct === p ? 'rgba(0,229,255,.11)' : 'rgba(255,255,255,.045)',
                    color: sizePct === p ? C.accent : C.muted,
                    fontWeight: 950,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >
                  {p === 100 ? 'Max' : p + '%'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 900 }}>LEVERAGE</span>
              <span style={{ fontSize: 14, color: C.accent, fontWeight: 1000 }}>{leverage}x</span>
            </div>

            <input
              type="range"
              min="1"
              max={pair.leverage}
              value={leverage}
              onChange={e => setLeverage(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent, height: 6, borderRadius: 3 }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10, color: C.muted2, fontWeight: 800 }}>
              <span>1x</span>
              <span>{pair.leverage}x</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 900, marginBottom: 7 }}>TAKE PROFIT</div>
              <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid ' + C.border, borderRadius: 14, padding: '11px 12px' }}>
                <input
                  value={takeProfit}
                  onChange={e => setTakeProfit(cleanAmount(e.target.value))}
                  placeholder="Price"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 850, color: C.green, outline: 'none', fontFamily: 'Syne, sans-serif' }}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 900, marginBottom: 7 }}>STOP LOSS</div>
              <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid ' + C.border, borderRadius: 14, padding: '11px 12px' }}>
                <input
                  value={stopLoss}
                  onChange={e => setStopLoss(cleanAmount(e.target.value))}
                  placeholder="Price"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 850, color: C.red, outline: 'none', fontFamily: 'Syne, sans-serif' }}
                />
              </div>
            </div>
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div style={{
              background: 'rgba(255,255,255,.045)',
              border: '1px solid rgba(255,255,255,.07)',
              borderRadius: 18,
              padding: 14,
              marginBottom: 14,
            }}>
              {[
                ['Entry Price', fmt(entryPrice, 2)],
                ['Est. Coin Size', entryPrice > 0 ? roundSize(parseFloat(amount) / entryPrice) + ' ' + pair.base : '-'],
                ['Limit Px', entryPrice > 0 ? fmt(getAggressiveLimitPx(entryPrice, isLong), 4) : '-'],
                ['Liquidation', fmt(liqPrice, 4)],
                ['1H Change', pct(pair.change1h)],
                ['24H Change', pct(pair.change)],
                ['Nexus Builder Fee', isValidEthAddress(BUILDER_ADDRESS) ? '0.05%' : 'Not set'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                  <span style={{ color: C.muted, fontWeight: 800 }}>{l}</span>
                  <span style={{ color: C.text, fontWeight: 900 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 14, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          {!wcon ? (
            <button
              onClick={() => onConnectWallet?.()}
              style={{
                width: '100%',
                padding: 18,
                borderRadius: 19,
                border: 'none',
                background: C.purpleGrad,
                color: '#fff',
                fontWeight: 1000,
                fontSize: 17,
                cursor: 'pointer',
                minHeight: 58,
                fontFamily: 'Syne, sans-serif',
                boxShadow: '0 16px 40px rgba(153,69,255,.28)',
              }}
            >
              Connect Wallet
            </button>
          ) : (
            <button
              onClick={execute}
              disabled={!amount || status === 'loading'}
              style={{
                width: '100%',
                padding: 18,
                borderRadius: 19,
                border: 'none',
                background: status === 'success'
                  ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                  : status === 'error'
                    ? C.sellGrad
                    : isLong
                      ? C.buyGrad
                      : C.sellGrad,
                color: '#fff',
                fontWeight: 1000,
                fontSize: 17,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                minHeight: 58,
                fontFamily: 'Syne, sans-serif',
                boxShadow: isLong ? '0 16px 40px rgba(0,229,255,.24)' : '0 16px 40px rgba(255,59,107,.24)',
              }}
            >
              {status === 'loading'
                ? 'Confirming...'
                : status === 'success'
                  ? 'Trade Sent'
                  : status === 'error'
                    ? 'Failed — Retry'
                    : isLong
                      ? 'Long ' + pair.base
                      : 'Short ' + pair.base}
            </button>
          )}

          {position && (
            <button
              onClick={closePosition}
              style={{
                width: '100%',
                marginTop: 10,
                padding: 15,
                borderRadius: 16,
                border: '1px solid rgba(255,59,107,.3)',
                background: 'rgba(255,59,107,.07)',
                color: C.red,
                fontWeight: 950,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              Close Position
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, paddingBottom: 10, fontWeight: 800 }}>
            Powered by Hyperliquid · Nexus routing
          </div>
        </div>
      </div>

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        mode={transferMode}
        hlAddress={hlWallet?.address || ''}
      />
    </>
  );
}

export default function PerpsTrade({ onConnectWallet }) {
  const [oneHourMap, setOneHourMap] = useState(() => {
    try {
      const cached = localStorage.getItem('nexus_perps_1h_cache');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  const [marketData, setMarketData] = useState(() => {
    try {
      const cached = localStorage.getItem('nexus_perps_cache');
      return cached ? JSON.parse(cached) : PERPS_PAIRS.map(p => ({
        ...p,
        price: 0,
        change: 0,
        change1h: 0,
        volume24h: 0,
        openInterest: 0,
        funding: 0,
        assetIndex: null,
      }));
    } catch {
      return PERPS_PAIRS.map(p => ({
        ...p,
        price: 0,
        change: 0,
        change1h: 0,
        volume24h: 0,
        openInterest: 0,
        funding: 0,
        assetIndex: null,
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

  useEffect(() => {
    getEthers().catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      const data = await fetchMarketData(oneHourMap);
      if (alive) {
        setMarketData(data);
        try {
          localStorage.setItem('nexus_perps_cache', JSON.stringify(data));
        } catch {}
      }
    };

    poll();
    const interval = setInterval(poll, 8000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [oneHourMap]);

  useEffect(() => {
    let alive = true;

    const pollOneHour = async () => {
      try {
        const currentMarkets = await fetchMarketData(oneHourMap);
        const nextMap = await fetchOneHourChangeMap(currentMarkets);

        if (!alive) return;

        setOneHourMap(nextMap);
        setMarketData(prev => prev.map(p => ({
          ...p,
          change1h: Number.isFinite(nextMap[p.id]) ? nextMap[p.id] : p.change1h || 0,
        })));

        try {
          localStorage.setItem('nexus_perps_1h_cache', JSON.stringify(nextMap));
        } catch {}
      } catch (e) {
        console.error('1H change fetch failed:', e);
      }
    };

    pollOneHour();
    const interval = setInterval(pollOneHour, 90000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
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

  const openTrade = (pair) => {
    setActivePair(pair);
    setDrawerOpen(true);
  };

  const openFromPosition = () => {
    if (mockPosition) {
      const p = marketData.find(m => m.id === mockPosition.pairId) || activePair;
      setActivePair(p);
      setDrawerOpen(true);
    }
  };

  const totalVol = marketData.reduce((sum, p) => sum + Number(p.volume24h || 0), 0);
  const gainers = marketData.filter(p => p.change > 0).length;
  const listed = marketData.length;

  return (
    <div style={{
      maxWidth: 680,
      margin: '0 auto',
      width: '100%',
      padding: '2px 0 calc(env(safe-area-inset-bottom) + 86px)',
      color: C.text,
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        inset: '-80px -20px auto -20px',
        height: 260,
        background: 'radial-gradient(circle at 20% 15%,rgba(153,69,255,.22),transparent 36%), radial-gradient(circle at 80% 0%,rgba(0,229,255,.16),transparent 34%)',
        pointerEvents: 'none',
        zIndex: -1,
      }} />

      <div style={{
        marginBottom: 18,
        padding: 18,
        borderRadius: 28,
        background: 'linear-gradient(135deg,rgba(153,69,255,.18),rgba(0,229,255,.10),rgba(255,255,255,.045))',
        border: '1px solid rgba(255,255,255,.09)',
        boxShadow: C.cardGlow,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          right: -46,
          top: -54,
          width: 145,
          height: 145,
          borderRadius: '50%',
          background: 'rgba(255,79,216,.12)',
          filter: 'blur(2px)',
        }} />

        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'rgba(255,255,255,.07)',
            border: '1px solid rgba(255,255,255,.08)',
            color: C.accent,
            fontSize: 10,
            fontWeight: 1000,
            marginBottom: 12,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.green, boxShadow: '0 0 14px rgba(0,255,163,.9)' }} />
            Hyperliquid Perps
          </div>

          <h1 style={{ fontSize: 32, lineHeight: 1.02, fontWeight: 1000, color: '#fff', margin: 0, letterSpacing: '-.07em' }}>
            Trade perps with Nexus
          </h1>

          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, margin: '9px 0 0', fontWeight: 750 }}>
            Phantom-style wallet flow, Pancake-style market cards, Hyperliquid-powered perpetuals.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginTop: 16 }}>
            {[
              { label: 'Markets', value: listed || '-' },
              { label: '24H Vol', value: shortNum(totalVol) },
              { label: 'Green', value: `${gainers}/${listed || 0}` },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(5,8,18,.45)',
                border: '1px solid rgba(255,255,255,.075)',
                borderRadius: 17,
                padding: 12,
              }}>
                <div style={{ fontSize: 17, fontWeight: 1000, color: '#fff' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2, fontWeight: 900, textTransform: 'uppercase' }}>{s.label}</div>
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

      <div style={{ display: 'flex', gap: 9, marginBottom: 18, overflowX: 'auto', paddingBottom: 4 }}>
        {marketData.slice(0, 14).map(p => (
          <PairCard
            key={p.id}
            pair={p}
            active={activePair?.id === p.id}
            onClick={() => setActivePair(p)}
          />
        ))}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 1000, color: '#fff', letterSpacing: '-.04em' }}>Markets</div>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 750 }}>1H and 24H movement included</div>
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {['All', 'Hot', 'Gainers', 'Losers'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 10px',
                borderRadius: 999,
                border: '1px solid ' + (filter === f ? 'rgba(0,229,255,.35)' : C.border),
                background: filter === f ? 'rgba(0,229,255,.10)' : 'rgba(255,255,255,.045)',
                color: filter === f ? C.accent : C.muted,
                fontSize: 11,
                fontWeight: 950,
                cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(154px, 1fr))', gap: 11, marginBottom: 20 }}>
        {filteredMarketData.map(p => {
          const dayUp = p.change >= 0;
          const hourUp = p.change1h >= 0;
          const [a, b] = coinAccent(p.base);

          return (
            <button
              key={p.id}
              onClick={() => openTrade(p)}
              style={{
                padding: 15,
                borderRadius: 22,
                background: `linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,.028)), radial-gradient(circle at 20% 0%,${a}22,transparent 42%), radial-gradient(circle at 95% 20%,${b}18,transparent 42%)`,
                border: '1px solid rgba(255,255,255,.08)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all .15s',
                boxShadow: '0 12px 40px rgba(0,0,0,.23)',
                fontFamily: 'Syne, sans-serif',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 13 }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                  <PairLogo symbol={p.base} size={38} />
                  <div>
                    <div style={{ fontWeight: 1000, color: '#fff', fontSize: 15, letterSpacing: '-.04em' }}>{p.base}</div>
                    <div style={{ color: C.muted, fontSize: 9, fontWeight: 900 }}>PERP</div>
                  </div>
                </div>

                {p.hot && (
                  <span style={{
                    color: C.yellow,
                    background: 'rgba(255,209,102,.10)',
                    border: '1px solid rgba(255,209,102,.20)',
                    borderRadius: 999,
                    padding: '3px 6px',
                    fontSize: 9,
                    fontWeight: 1000,
                  }}>
                    HOT
                  </span>
                )}
              </div>

              <div style={{ color: C.text, fontWeight: 1000, fontSize: 17, marginBottom: 10 }}>{fmt(p.price, 2)}</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{
                  borderRadius: 12,
                  padding: '7px 8px',
                  background: hourUp ? 'rgba(0,255,163,.075)' : 'rgba(255,59,107,.075)',
                  border: '1px solid ' + (hourUp ? 'rgba(0,255,163,.15)' : 'rgba(255,59,107,.15)'),
                }}>
                  <div style={{ color: C.muted, fontSize: 8, fontWeight: 950 }}>1H</div>
                  <div style={{ color: hourUp ? C.green : C.red, fontSize: 11, fontWeight: 1000 }}>{pct(p.change1h)}</div>
                </div>

                <div style={{
                  borderRadius: 12,
                  padding: '7px 8px',
                  background: dayUp ? 'rgba(0,255,163,.075)' : 'rgba(255,59,107,.075)',
                  border: '1px solid ' + (dayUp ? 'rgba(0,255,163,.15)' : 'rgba(255,59,107,.15)'),
                }}>
                  <div style={{ color: C.muted, fontSize: 8, fontWeight: 950 }}>24H</div>
                  <div style={{ color: dayUp ? C.green : C.red, fontSize: 11, fontWeight: 1000 }}>{pct(p.change)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: C.muted, fontSize: 10, fontWeight: 850 }}>
                <span>{p.leverage}x max</span>
                <span>{Number.isInteger(p.assetIndex) ? 'Ready' : 'Loading'}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Order Type', value: 'IOC' },
          { label: '1H Data', value: 'Live' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'rgba(255,255,255,.045)',
            border: '1px solid rgba(255,255,255,.075)',
            borderRadius: 18,
            padding: 14,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 1000, color: '#fff' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2, fontWeight: 850 }}>{s.label}</div>
          </div>
        ))}
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
  );
}