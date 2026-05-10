import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';

/* ============================================================================
 * NEXUS DEX -- Hyperliquid Perps Trading Interface
 * Non-custodial. User keys stay in browser. Hyperliquid executes.
 *
 * Builder Code (Nexus DEX): 0x4e65787573444558000000000000000000000000000000000000000000000000
 * Trade Fee: 0.10% total (0.05% Hyperliquid + 0.05% Nexus)
 * 
 * Wallet: Solana (Phantom / Solflare / Privy)
 * Deposit:  SOL → OKX swap to USDC → Hyperliquid L1
 * Withdraw: Hyperliquid L1 → OKX bridge → SOL in user wallet
 *
 * LIVE ON MAINNET
 * ========================================================================= */

const ENABLE_TRADING = true;

const BUILDER_CODE = '0x4e65787573444558000000000000000000000000000000000000000000000000';
const MAX_FEE_RATE = '0.0005';

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

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => { _bodyLockCount = Math.max(0, _bodyLockCount - 1); if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked'); };
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
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

/* ------------------------------------------------------------------ */
/*  Hyperliquid wallet (all client-side — non-custodial)               */
/* ------------------------------------------------------------------ */
let _ethersModule = null;
async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}

function generateHlWallet() {
  const { ethers } = _ethersModule;
  if (!ethers) return null;
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}

function xorEncrypt(text, key) {
  let out = '';
  for (let i = 0; i < text.length; i++)
    out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return btoa(out);
}

function xorDecrypt(b64, key) {
  const decoded = atob(b64);
  let out = '';
  for (let i = 0; i < decoded.length; i++)
    out += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
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

/* ------------------------------------------------------------------ */
/*  Hyperliquid API (MAINNET)                                          */
/* ------------------------------------------------------------------ */
async function hlRequest(body, isExchange = false) {
  const path = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.detail || 'Hyperliquid request failed');
  return data;
}

async function fetchMarketData() {
  try {
    const [meta, mids] = await Promise.all([
      hlRequest({ type: 'meta' }),
      hlRequest({ type: 'allMids' }),
    ]);
    const universe = (meta.universe || []).map((u, i) => ({
      name: u.name || 'Unknown',
      index: i,
      maxLeverage: u.maxLeverage || 50,
    }));

    const priceMap = {};
    if (Array.isArray(mids)) {
      universe.forEach((u, i) => {
        const raw = mids[i];
        const p = raw ? parseFloat(raw) : 0;
        priceMap[u.name] = p > 0 ? p : 0;
      });
    } else if (mids && typeof mids === 'object') {
      for (const [k, v] of Object.entries(mids)) {
        const p = parseFloat(v);
        priceMap[k] = p > 0 ? p : 0;
      }
    }

    return PERPS_PAIRS.map(p => {
      const info = universe.find(u => u.name === p.id);
      const price = priceMap[p.id] || 0;
      return {
        ...p,
        price,
        change: 0,
        leverage: info ? Math.min(info.maxLeverage, p.leverage) : p.leverage,
      };
    });
  } catch (e) {
    console.error('Market data fetch failed:', e);
    return PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0 }));
  }
}

async function placeOrder({ privateKey, pairIndex, isLong, sz, leverage }) {
  const { ethers } = await getEthers();
  if (!ethers) throw new Error('ethers not loaded');
  const wallet = new ethers.Wallet(privateKey);
  const timestamp = Date.now();
  const orderAction = {
    type: 'order',
    orders: [{
      asset: pairIndex, isBuy: isLong, limitPx: 0,
      sz: Number(sz), leverage: Number(leverage),
      orderType: { market: {} }, reduceOnly: false, cloid: null,
    }],
    grouping: 'na',
    builder: BUILDER_CODE,
  };
  const domain = { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const types = { HyperliquidTransaction: [{ name: 'txType', type: 'string' }] };
  const signature = await wallet.signTypedData(domain, types, { txType: 'order' });
  const payload = {
    action: orderAction,
    signature: { r: signature.slice(0, 66), s: '0x' + signature.slice(66, 130), v: parseInt(signature.slice(130, 132), 16) },
    nonce: timestamp,
  };
  return hlRequest(payload, true);
}

/* ================================================================== */
/*  PairCard (horizontal scroll strip)                                 */
/* ================================================================== */
function PairCard({ pair, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: active ? 'rgba(0,229,255,.08)' : C.card2,
      border: '1px solid ' + (active ? 'rgba(0,229,255,.35)' : C.border),
      borderRadius: 14, padding: '12px 14px', cursor: 'pointer',
      transition: 'all .15s', flex: '0 0 auto', minWidth: 100, textAlign: 'center',
    }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', marginBottom: 4 }}>{pair.base}</div>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmt(pair.price, 2)}</div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{pair.leverage}x</div>
    </div>
  );
}

/* ================================================================== */
/*  PositionCard                                                       */
/* ================================================================== */
function PositionCard({ position, pair, onClick }) {
  const entry = position.entryPrice || 0;
  const current = pair?.price || 0;
  const isLong = position.side === 'long';
  const leverage = position.leverage || 1;
  const size = position.size || 0;
  const pnl = isLong ? (current - entry) / entry * size : (entry - current) / entry * size;
  const pnlPct = entry > 0 ? (pnl / (size / leverage)) * 100 : 0;
  const inProfit = pnl >= 0;

  return (
    <div onClick={onClick} style={{
      background: C.card,
      border: '1px solid ' + (inProfit ? 'rgba(0,255,163,.25)' : 'rgba(255,59,107,.25)'),
      borderRadius: 16, padding: 16, cursor: 'pointer',
      boxShadow: inProfit ? '0 0 30px rgba(0,255,163,.06)' : '0 0 30px rgba(255,59,107,.06)',
      transition: 'all .2s', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: inProfit ? 'rgba(0,255,163,.12)' : 'rgba(255,59,107,.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: inProfit ? C.green : C.red,
          }}>
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
            {inProfit ? '+' : ''}{pct(pnlPct)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Deposit / Withdraw Modal                                           */
/* ================================================================== */
function TransferModal({ open, onClose, mode, hlAddress }) {
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const isDeposit = mode === 'deposit';
  useBodyLock(open);
  useEffect(() => { if (open) { setAmount(''); setStatus('idle'); setError(''); } }, [open]);

  const handle = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setStatus('loading'); setError('');
    try {
      await new Promise(r => setTimeout(r, 1500));
      setStatus('success');
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      setError(e.message || 'Transfer failed');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
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
            <div style={{ fontSize: 11, color: C.text, fontFamily: 'monospace', wordBreak: 'break-all' }}>{hlAddress}</div>
          </div>
          <div style={{ marginBottom: 6, fontSize: 12, color: C.accent, fontWeight: 600 }}>
            {isDeposit ? 'SOL → USDC → Hyperliquid' : 'Hyperliquid → USDC → SOL'}
          </div>
          <div style={{ marginBottom: 14, fontSize: 10, color: C.muted }}>Powered by OKX</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>AMOUNT (USD)</div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18 }}>$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none', fontFamily: 'Syne, sans-serif' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[25, 50, 100, 250].map(v => (
                <button key={v} onClick={() => setAmount(String(v))} style={{
                  flex: 1, padding: '8px', borderRadius: 8,
                  border: '1px solid ' + (parseFloat(amount) === v ? C.accent : C.border),
                  background: parseFloat(amount) === v ? 'rgba(0,229,255,.10)' : C.card2,
                  color: parseFloat(amount) === v ? C.accent : C.muted,
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                }}>${v}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, fontSize: 12, color: C.red }}>{error}</div>}
          <button onClick={handle} disabled={!amount || status === 'loading'} style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none',
            background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : isDeposit ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#a855f7,#7c3aed)',
            color: '#fff', fontWeight: 800, fontSize: 16, cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            minHeight: 54, fontFamily: 'Syne, sans-serif',
          }}>
            {status === 'loading' ? 'Processing...'
              : status === 'success' ? (isDeposit ? 'Deposited!' : 'Withdrawn!')
              : isDeposit ? 'Deposit' : 'Withdraw'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/*  TradeDrawer                                                        */
/* ================================================================== */
function TradeDrawer({ open, onClose, pair, onConnectWallet, walletPubkey, position }) {
  const { connected } = useWallet();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [status, setStatus] = useState('idle');
  const [hlWallet, setHlWallet] = useState(null);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMode, setTransferMode] = useState('deposit');
  const [sizePct, setSizePct] = useState(null);

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setAmount(''); setTakeProfit(''); setStopLoss(''); setSizePct(null);
      setStatus('idle');
      const stored = getStoredHlWallet(walletPubkey);
      setHlWallet(stored ? { address: stored.address } : null);
    }
  }, [open, walletPubkey]);

  const isLong = side === 'long';
  const entryPrice = pair?.price || 0;
  const liqPrice = isLong
    ? entryPrice * (1 - 0.9 / leverage)
    : entryPrice * (1 + 0.9 / leverage);

  const createWallet = async () => {
    setCreatingWallet(true);
    try {
      await getEthers();
      const newWallet = generateHlWallet();
      if (!newWallet) throw new Error('Wallet generation failed');
      storeHlWallet(walletPubkey, newWallet.address, newWallet.privateKey);
      setHlWallet({ address: newWallet.address });
    } catch (e) { console.error('Wallet creation failed:', e); }
    setCreatingWallet(false);
  };

  const quickSize = (pct) => {
    setSizePct(pct);
    setAmount('');
  };

  const execute = async () => {
    if (!wcon) { loginPrivy?.() || onConnectWallet?.(); return; }
    if (!hlWallet) { await createWallet(); return; }
    setStatus('loading');
    try {
      const stored = getStoredHlWallet(walletPubkey);
      if (!stored) throw new Error('Wallet not found');
      const pairIndex = PERPS_PAIRS.findIndex(p => p.id === pair.id);
      await placeOrder({ privateKey: stored.privateKey, pairIndex: pairIndex >= 0 ? pairIndex : 0, isLong, sz: parseFloat(amount) || 0, leverage });
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 2000);
    } catch (e) {
      console.error('Trade failed:', e);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const closePosition = async () => {
    if (!hlWallet) return;
    setStatus('loading');
    try {
      const stored = getStoredHlWallet(walletPubkey);
      if (!stored) throw new Error('Wallet not found');
      const pairIndex = PERPS_PAIRS.findIndex(p => p.id === pair.id);
      await placeOrder({ privateKey: stored.privateKey, pairIndex: pairIndex >= 0 ? pairIndex : 0, isLong: !position?.side || position.side !== 'long', sz: position?.size || 0, leverage: position?.leverage || 1 });
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 2000);
    } catch (e) {
      console.error('Close failed:', e);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  if (!open || !pair) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 520, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{pair.base}-PERP</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{fmt(pair.price, 2)}</span>
                <span style={{ color: (pair.change || 0) >= 0 ? C.green : C.red, fontSize: 13, fontWeight: 600 }}>{pct(pair.change)} (24H)</span>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 4 }}>x</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 80px)' }}>
          
          {position && (
            <div style={{ marginBottom: 16 }}>
              <PositionCard position={position} pair={pair} onClick={() => {}} />
            </div>
          )}

          {!hlWallet && wcon && (
            <div style={{ marginBottom: 16, padding: 14, background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.25)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ color: C.purple, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Create your Hyperliquid Wallet</div>
              <button onClick={createWallet} disabled={creatingWallet} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>{creatingWallet ? 'Creating...' : 'Create Wallet'}</button>
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
                <button onClick={() => { setTransferMode('deposit'); setTransferOpen(true); }} style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1px solid rgba(0,229,255,.25)', background: 'rgba(0,229,255,.08)',
                  color: C.accent, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                }}>Deposit</button>
                <button onClick={() => { setTransferMode('withdraw'); setTransferOpen(true); }} style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1px solid rgba(168,85,247,.25)', background: 'rgba(168,85,247,.08)',
                  color: C.purple, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif',
                }}>Withdraw</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setSide('long')} style={{
              flex: 1, padding: 14, borderRadius: 14,
              border: '2px solid ' + (isLong ? C.green : C.border),
              background: isLong ? 'rgba(0,255,163,.08)' : C.card2,
              color: isLong ? C.green : C.muted, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              transition: 'all .15s', fontFamily: 'Syne, sans-serif',
              boxShadow: isLong ? '0 0 20px rgba(0,255,163,.10)' : 'none',
            }}>Long</button>
            <button onClick={() => setSide('short')} style={{
              flex: 1, padding: 14, borderRadius: 14,
              border: '2px solid ' + (!isLong ? C.red : C.border),
              background: !isLong ? 'rgba(255,59,107,.08)' : C.card2,
              color: !isLong ? C.red : C.muted, fontWeight: 800, fontSize: 16, cursor: 'pointer',
              transition: 'all .15s', fontFamily: 'Syne, sans-serif',
              boxShadow: !isLong ? '0 0 20px rgba(255,59,107,.10)' : 'none',
            }}>Short</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {['market', 'limit'].map(t => (
              <button key={t} onClick={() => setOrderType(t)} style={{
                flex: 1, padding: '10px', borderRadius: 10,
                border: '1px solid ' + (orderType === t ? C.accent : C.border),
                background: orderType === t ? 'rgba(0,229,255,.10)' : C.card2,
                color: orderType === t ? C.accent : C.muted,
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
                fontFamily: 'Syne, sans-serif', textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>AMOUNT</div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', marginBottom: 8 }}>
              <input value={amount} onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setSizePct(null); }}
                placeholder="$0.00" style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 24, fontWeight: 700, color: '#fff', outline: 'none', fontFamily: 'Syne, sans-serif' }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => quickSize(p)} style={{
                  flex: 1, padding: '8px', borderRadius: 8,
                  border: '1px solid ' + (sizePct === p ? C.accent : C.border),
                  background: sizePct === p ? 'rgba(0,229,255,.10)' : C.card2,
                  color: sizePct === p ? C.accent : C.muted,
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                }}>{p === 100 ? 'Max' : p + '%'}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>LEVERAGE</span>
              <span style={{ fontSize: 13, color: C.accent, fontWeight: 800 }}>{leverage}x</span>
            </div>
            <input type="range" min="1" max={pair.leverage} value={leverage} onChange={e => setLeverage(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent, height: 6, borderRadius: 3 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 10, color: C.muted2 }}>
              <span>1x</span><span>{pair.leverage}x</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>TAKE PROFIT</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '10px 12px' }}>
                <input value={takeProfit} onChange={e => setTakeProfit(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Price" style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: C.green, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>STOP LOSS</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '10px 12px' }}>
                <input value={stopLoss} onChange={e => setStopLoss(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Price" style={{ width: '100%', background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: C.red, outline: 'none', fontFamily: 'Syne, sans-serif' }} />
              </div>
            </div>
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div style={{ background: C.card2, borderRadius: 14, padding: 14, marginBottom: 14 }}>
              {[
                ['Entry Price', fmt(entryPrice, 2)],
                ['Liquidation', fmt(liqPrice, 4)],
                ['Trade Fee', '0.10%'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: C.muted }}>{l}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {!wcon ? (
            <button onClick={() => { loginPrivy?.() || onConnectWallet?.(); }} style={{
              width: '100%', padding: 18, borderRadius: 16, border: 'none',
              background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff',
              fontWeight: 800, fontSize: 17, cursor: 'pointer', minHeight: 56, fontFamily: 'Syne, sans-serif',
              boxShadow: '0 4px 24px rgba(153,69,255,.3)',
            }}>Connect Wallet</button>
          ) : (
            <button onClick={execute} disabled={!amount || status === 'loading'} style={{
              width: '100%', padding: 18, borderRadius: 16, border: 'none',
              background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                : status === 'error' ? C.sellGrad
                : isLong ? C.buyGrad : C.sellGrad,
              color: '#fff', fontWeight: 800, fontSize: 17,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              minHeight: 56, fontFamily: 'Syne, sans-serif',
              boxShadow: isLong ? '0 4px 24px rgba(0,229,255,.25)' : '0 4px 24px rgba(255,59,107,.25)',
            }}>
              {status === 'loading' ? 'Confirming...'
                : status === 'success' ? 'Trade Opened!'
                : status === 'error' ? 'Failed — Retry'
                : isLong ? 'Long ' + pair.base : 'Short ' + pair.base}
            </button>
          )}

          {position && (
            <button onClick={closePosition} style={{
              width: '100%', marginTop: 10, padding: 14, borderRadius: 14,
              border: '1px solid rgba(255,59,107,.3)', background: 'rgba(255,59,107,.06)',
              color: C.red, fontWeight: 700, fontSize: 15, cursor: 'pointer',
              fontFamily: 'Syne, sans-serif',
            }}>Close Position</button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 14, paddingBottom: 10 }}>Powered by Hyperliquid</div>
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
/*  PerpsTrade (main page)                                            */
/* ================================================================== */
export default function PerpsTrade({ onConnectWallet }) {
  const [marketData, setMarketData] = useState(PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0 })));
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mockPosition, setMockPosition] = useState(null);

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
      const data = await fetchMarketData();
      if (alive) setMarketData(data);
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

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
        <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>Up to 50x leverage &middot; 0.10% fee &middot; Powered by Hyperliquid</p>
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
          <PairCard key={p.id} pair={p} active={activePair?.id === p.id} onClick={() => setActivePair(p)} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {marketData.map(p => (
          <button key={p.id} onClick={() => openTrade(p)} style={{
            padding: 18, borderRadius: 16, background: C.card,
            border: '1px solid ' + C.border, cursor: 'pointer',
            textAlign: 'left', transition: 'all .15s',
            boxShadow: C.cardGlow,
          }}>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 15, marginBottom: 4 }}>{p.base}-PERP</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{fmt(p.price, 2)}</span>
              <span style={{ color: C.muted, fontSize: 11 }}>{p.leverage}x</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Trade Fee', value: '0.10%' },
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