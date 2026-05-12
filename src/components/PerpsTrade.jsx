Verified against Hyperliquid docs: asset index must come from meta.universe, order uses compact keys, and builder fee needs an approved builder address, not bytes32.  ￼

import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
/* ============================================================================
 * NEXUS DEX -- Hyperliquid Perps Trading Interface
 * Non-custodial UI shell.
 *
 * IMPORTANT:
 * - Hyperliquid asset index must come from meta.universe.
 * - Order size must be coin size, not USD amount.
 * - Builder fee requires approved builder address, not bytes32 builder code.
 * - Live signed order submission should be handled by your backend or official SDK.
 * ========================================================================= */
const ENABLE_TRADING = true;
/*
 * Set this only when you have the actual approved Hyperliquid builder ADDRESS.
 * A bytes32 builder code will break Hyperliquid order payloads.
 */
const BUILDER_ADDRESS = '';
const BUILDER_FEE_TENTHS_BP = 5; // 0.5bp = 0.05%
const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad: 'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
  purple: '#9945ff',
  cardGlow: '0 0 20px rgba(0,229,255,0.05)',
};
const PERPS_PAIRS = [
  { id: 'ETH', base: 'ETH', leverage: 50 },
  { id: 'BTC', base: 'BTC', leverage: 50 },
  { id: 'SOL', base: 'SOL', leverage: 20 },
  { id: 'ARB', base: 'ARB', leverage: 20 },
  { id: 'OP', base: 'OP', leverage: 15 },
  { id: 'LINK', base: 'LINK', leverage: 20 },
  { id: 'POL', base: 'POL', leverage: 20 },
  { id: 'AVAX', base: 'AVAX', leverage: 15 },
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
/* ------------------------------------------------------------------ */
/* Hyperliquid wallet storage                                          */
/* ------------------------------------------------------------------ */
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
/*
 * This is local obfuscation, not real encryption.
 * Do not treat browser localStorage as secure custody.
 */
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
/* ------------------------------------------------------------------ */
/* Hyperliquid API                                                     */
/* ------------------------------------------------------------------ */
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
async function fetchMarketData() {
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
      const ctx = info?.ctx || {};
      const midPrice = priceMap[p.id] || parseFloat(ctx.midPx || ctx.markPx || 0) || 0;
      const prevDayPx = parseFloat(ctx.prevDayPx || 0);
      const change =
        midPrice > 0 && prevDayPx > 0
          ? ((midPrice - prevDayPx) / prevDayPx) * 100
          : 0;
      return {
        ...p,
        assetIndex: info?.index,
        price: midPrice,
        change,
        leverage: info ? Math.min(info.maxLeverage, p.leverage) : p.leverage,
      };
    });
  } catch (e) {
    console.error('Market data fetch failed:', e);
    return PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, assetIndex: null }));
  }
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
  /*
   * Your backend should:
   * 1. Apply/update leverage if needed.
   * 2. Sign using official Hyperliquid signing logic / SDK.
   * 3. Submit { action, nonce, signature } to /exchange.
   *
   * This avoids using the incorrect fake typed-data signature from the old file.
   */
  return hlRequest({
    type: 'placeOrder',
    source: 'nexus-perps-ui',
    ...built,
  }, true);
}
/* ================================================================== */
/* PairCard                                                            */
/* ================================================================== */
function PairCard({ pair, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? 'rgba(0,229,255,.08)' : C.card2,
        border: '1px solid ' + (active ? 'rgba(0,229,255,.35)' : C.border),
        borderRadius: 14,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'all .15s',
        flex: '0 0 auto',
        minWidth: 100,
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', marginBottom: 4 }}>{pair.base}</div>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmt(pair.price, 2)}</div>
    </div>
  );
}
/* ================================================================== */
/* PositionCard                                                        */
/* ================================================================== */
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
        background: C.card,
        border: '1px solid ' + (inProfit ? 'rgba(0,255,163,.25)' : 'rgba(255,59,107,.25)'),
        borderRadius: 16,
        padding: 16,
        cursor: 'pointer',
        boxShadow: inProfit ? '0 0 30px rgba(0,255,163,.06)' : '0 0 30px rgba(255,59,107,.06)',
        transition: 'all .2s',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: inProfit ? 'rgba(0,255,163,.12)' : 'rgba(255,59,107,.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 800,
              color: inProfit ? C.green : C.red,
            }}
          >
            {pair?.base?.charAt(0) || '?'}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>{pair?.base}-PERP</div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {isLong ? 'Long' : 'Short'} · {leverage}x
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: inProfit ? C.green : C.red }}>
            {inProfit ? '+' : ''}{fmt(pnl)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: inProfit ? C.green : C.red }}>
            {pct(pnlPct)}
          </div>
        </div>
      </div>
    </div>
  );
}
/* ================================================================== */
/* Deposit / Withdraw Modal                                            */
/* ================================================================== */
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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,.88)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, zIndex: 451, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>
              {isDeposit ? 'Deposit to Hyperliquid' : 'Withdraw from Hyperliquid'}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer' }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 80px)' }}>
          <div style={{ marginBottom: 14, padding: 12, background: C.card2, borderRadius: 10, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 4 }}>
              {isDeposit ? 'DESTINATION' : 'SOURCE'}
            </div>
            <div style={{ fontSize: 11, color: C.text, fontFamily: 'monospace', wordBreak: 'break-all' }}>{hlAddress || 'No Hyperliquid wallet yet'}</div>
          </div>
          <div style={{ marginBottom: 6, fontSize: 12, color: C.accent, fontWeight: 600 }}>
            {isDeposit ? 'SOL → USDC → Hyperliquid' : 'Hyperliquid → USDC → SOL'}
          </div>
          <div style={{ marginBottom: 14, fontSize: 10, color: C.muted }}>Powered by OKX</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>AMOUNT (USD)</div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18 }}>$</span>
              <input
                value={amount}
                onChange={e => setAmount(cleanAmount(e.target.value))}
                placeholder="0.00"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none', fontFamily: 'Syne, sans-serif' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[25, 50, 100, 250].map(v => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: 8,
                    border: '1px solid ' + (parseFloat(amount) === v ? C.accent : C.border),
                    background: parseFloat(amount) === v ? 'rgba(0,229,255,.10)' : C.card2,
                    color: parseFloat(amount) === v ? C.accent : C.muted,
                    fontWeight: 700,
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
            <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}
          <button
            onClick={handle}
            disabled={!amount || status === 'loading'}
            style={{
              width: '100%',
              padding: 16,
              borderRadius: 14,
              border: 'none',
              background: isDeposit
                ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
                : 'linear-gradient(135deg,#a855f7,#7c3aed)',
              color: '#fff',
              fontWeight: 800,
              fontSize: 16,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              minHeight: 54,
              fontFamily: 'Syne, sans-serif',
            }}
          >
            {isDeposit ? 'Start Deposit' : 'Start Withdraw'}
          </button>
        </div>
      </div>
    </>
  );
}
/* ================================================================== */
/* TradeDrawer                                                         */
/* ================================================================== */
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
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 520, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{pair.base}-PERP</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{fmt(pair.price, 2)}</span>
                <span style={{ color: pair.change >= 0 ? C.green : C.red, fontSize: 12, fontWeight: 700 }}>{pct(pair.change)}</span>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 4 }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 80px)' }}>
          {position && (
            <div style={{ marginBottom: 16 }}>
              <PositionCard position={position} pair={pair} onClick={() => {}} />
            </div>
          )}
          {!hlWallet && wcon && (
            <div style={{ marginBottom: 16, padding: 14, background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.25)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ color: C.purple, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Create your Hyperliquid Wallet</div>
              <button
                onClick={createWallet}
                disabled={creatingWallet}
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
              >
                {creatingWallet ? 'Creating...' : 'Create Wallet'}
              </button>
            </div>
          )}
          {hlWallet && (
            <div style={{ marginBottom: 16, padding: 12, background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>HYPERLIQUID WALLET</div>
                  <div style={{ fontSize: 11, color: C.text, fontFamily: 'monospace' }}>{hlWallet.address.slice(0, 6)}...{hlWallet.address.slice(-4)}</div>
                </div>
                <div style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>Connected</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setTransferMode('deposit');
                    setTransferOpen(true);
                  }}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid rgba(0,229,255,.25)', background: 'rgba(0,229,255,.08)', color: C.accent, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
                >
                  Deposit
                </button>
                <button
                  onClick={() => {
                    setTransferMode('withdraw');
                    setTransferOpen(true);
                  }}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid rgba(168,85,247,.25)', background: 'rgba(168,85,247,.08)', color: C.purple, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
                >
                  Withdraw
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => setSide('long')}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 14,
                border: '2px solid ' + (isLong ? C.green : C.border),
                background: isLong ? 'rgba(0,255,163,.08)' : C.card2,
                color: isLong ? C.green : C.muted,
                fontWeight: 800,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'Syne, sans-serif',
                boxShadow: isLong ? '0 0 20px rgba(0,255,163,.10)' : 'none',
              }}
            >
              Long
            </button>
            <button
              onClick={() => setSide('short')}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 14,
                border: '2px solid ' + (!isLong ? C.red : C.border),
                background: !isLong ? 'rgba(255,59,107,.08)' : C.card2,
                color: !isLong ? C.red : C.muted,
                fontWeight: 800,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'Syne, sans-serif',
                boxShadow: !isLong ? '0 0 20px rgba(255,59,107,.10)' : 'none',
              }}
            >
              Short
            </button>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>AMOUNT</span>
              <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, background: 'rgba(0,229,255,.08)', padding: '2px 8px', borderRadius: 4 }}>Market IOC</span>
            </div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', marginBottom: 8 }}>
              <input
                value={amount}
                onChange={e => {
                  setAmount(cleanAmount(e.target.value));
                  setSizePct(null);
                  setError('');
                }}
                placeholder="$0.00"
                style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 24, fontWeight: 700, color: '#fff', outline: 'none', fontFamily: 'Syne, sans-serif' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[25, 50, 75, 100].map(p => (
                <button
                  key={p}
                  onClick={() => quickSize(p)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: 8,
                    border: '1px solid ' + (sizePct === p ? C.accent : C.border),
                    background: sizePct === p ? 'rgba(0,229,255,.10)' : C.card2,
                    color: sizePct === p ? C.accent : C.muted,
                    fontWeight: 700,
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>LEVERAGE</span>
              <span style={{ fontSize: 13, color: C.accent, fontWeight: 800 }}>{leverage}x</span>
            </div>
            <input
              type="range"
              min="1"
              max={pair.leverage}
              value={leverage}
              onChange={e => setLeverage(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent, height: 6, borderRadius: 3 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 10, color: C.muted2 }}>
              <span>1x</span>
              <span>{pair.leverage}x</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>TAKE PROFIT</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '10px 12px' }}>
                <input
                  value={takeProfit}
                  onChange={e => setTakeProfit(cleanAmount(e.target.value))}
                  placeholder="Price"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: C.green, outline: 'none', fontFamily: 'Syne, sans-serif' }}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>STOP LOSS</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '10px 12px' }}>
                <input
                  value={stopLoss}
                  onChange={e => setStopLoss(cleanAmount(e.target.value))}
                  placeholder="Price"
                  style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: C.red, outline: 'none', fontFamily: 'Syne, sans-serif' }}
                />
              </div>
            </div>
          </div>
          {amount && parseFloat(amount) > 0 && (
            <div style={{ background: C.card2, borderRadius: 14, padding: 14, marginBottom: 14 }}>
              {[
                ['Entry Price', fmt(entryPrice, 2)],
                ['Est. Coin Size', entryPrice > 0 ? roundSize(parseFloat(amount) / entryPrice) + ' ' + pair.base : '-'],
                ['Limit Px', entryPrice > 0 ? fmt(getAggressiveLimitPx(entryPrice, isLong), 4) : '-'],
                ['Liquidation', fmt(liqPrice, 4)],
                ['Nexus Builder Fee', isValidEthAddress(BUILDER_ADDRESS) ? '0.05%' : 'Not set'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: C.muted }}>{l}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}
          {!wcon ? (
            <button
              onClick={() => onConnectWallet?.()}
              style={{
                width: '100%',
                padding: 18,
                borderRadius: 16,
                border: 'none',
                background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
                color: '#fff',
                fontWeight: 800,
                fontSize: 17,
                cursor: 'pointer',
                minHeight: 56,
                fontFamily: 'Syne, sans-serif',
                boxShadow: '0 4px 24px rgba(153,69,255,.3)',
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
                borderRadius: 16,
                border: 'none',
                background: status === 'success'
                  ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                  : status === 'error'
                    ? C.sellGrad
                    : isLong
                      ? C.buyGrad
                      : C.sellGrad,
                color: '#fff',
                fontWeight: 800,
                fontSize: 17,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                minHeight: 56,
                fontFamily: 'Syne, sans-serif',
                boxShadow: isLong ? '0 4px 24px rgba(0,229,255,.25)' : '0 4px 24px rgba(255,59,107,.25)',
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
                padding: 14,
                borderRadius: 14,
                border: '1px solid rgba(255,59,107,.3)',
                background: 'rgba(255,59,107,.06)',
                color: C.red,
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              Close Position
            </button>
          )}
          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, paddingBottom: 10 }}>
            Powered by Hyperliquid
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
/* ================================================================== */
/* PerpsTrade main page                                                */
/* ================================================================== */
export default function PerpsTrade({ onConnectWallet }) {
  const [marketData, setMarketData] = useState(() => {
    try {
      const cached = localStorage.getItem('nexus_perps_cache');
      return cached ? JSON.parse(cached) : PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, assetIndex: null }));
    } catch {
      return PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0, assetIndex: null }));
    }
  });
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mockPosition] = useState(null);
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
      const data = await fetchMarketData();
      if (alive) {
        setMarketData(data);
        try {
          localStorage.setItem('nexus_perps_cache', JSON.stringify(data));
        } catch {}
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
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
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', margin: 0 }}>Perps</h1>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
          Up to 50x leverage &middot; Hyperliquid markets &middot; Nexus routing
        </p>
      </div>
      {mockPosition && (
        <PositionCard
          position={mockPosition}
          pair={marketData.find(p => p.id === mockPosition.pairId) || activePair}
          onClick={openFromPosition}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {marketData.map(p => (
          <PairCard
            key={p.id}
            pair={p}
            active={activePair?.id === p.id}
            onClick={() => setActivePair(p)}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {marketData.map(p => (
          <button
            key={p.id}
            onClick={() => openTrade(p)}
            style={{
              padding: 18,
              borderRadius: 16,
              background: C.card,
              border: '1px solid ' + C.border,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all .15s',
              boxShadow: C.cardGlow,
            }}
          >
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 15, marginBottom: 4 }}>{p.base}-PERP</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{fmt(p.price, 2)}</span>
              <span style={{ color: p.change >= 0 ? C.green : C.red, fontWeight: 700, fontSize: 11 }}>{pct(p.change)}</span>
            </div>
            <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
              {p.leverage}x max · {Number.isInteger(p.assetIndex) ? 'Ready' : 'Loading'}
            </div>
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Order Type', value: 'IOC' },
          { label: 'Powered by', value: 'Hyperliquid' },
        ].map(s => (
          <div key={s.label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.label}</div>
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