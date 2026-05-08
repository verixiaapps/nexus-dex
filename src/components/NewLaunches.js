Here's the rewritten NewLaunches.js with live trade tracking, percent changes, and sorted New/Trending tabs:

```js
/**
 * NEXUS DEX -- NewLaunches
 *
 * Live feed of newly-launched Solana pump.fun tokens with one-tap buy/sell.
 *
 * Data sources:
 *   - PumpPortal WS: subscribeNewToken + subscribeTokenTrade
 *   - Live percent changes computed from trade history in memory
 *   - Trade execution: pumpTrade.js -> /api/pumpportal/trade-local
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey } from '@solana/web3.js';
import { quickBuyPump, quickSellPump, PLATFORM_FEE_RATE } from '../pumpTrade.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const PRESET_KEY = 'nexus_launch_presets';
const LAST_AMT_KEY = 'nexus_launch_last_amt';
const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const TRADE_HISTORY_WINDOW = 24 * 60 * 60 * 1000; // 24h
const BATCH_UPDATE_MS = 200;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  down: '#3b9eff', orange: '#ff9500', purple: '#9945ff',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

/* ============================================================================
 * Storage helpers
 * ========================================================================= */
function loadCachedTokens() {
  try {
    const v = localStorage.getItem('nexus_launch_cache_v2');
    if (!v) return [];
    const p = JSON.parse(v);
    if (Date.now() - (p.ts || 0) > 300000) return [];
    return Array.isArray(p.tokens) ? p.tokens : [];
  } catch (e) { return []; }
}

function saveCachedTokens(t) {
  try {
    localStorage.setItem('nexus_launch_cache_v2', JSON.stringify({
      ts: Date.now(),
      tokens: (t || []).slice(0, 30),
    }));
  } catch (e) {}
}

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || [5, 10, 25, 50, 100]; }
  catch (e) { return [5, 10, 25, 50, 100]; }
}

function savePresets(arr) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) {}
}

function loadLastAmt() {
  try { return parseFloat(localStorage.getItem(LAST_AMT_KEY) || '25') || 25; }
  catch (e) { return 25; }
}

function saveLastAmt(v) {
  try { localStorage.setItem(LAST_AMT_KEY, String(v)); } catch (e) {}
}

/* ============================================================================
 * Format / validate
 * ========================================================================= */
function isValidMint(s) {
  if (!s || typeof s !== 'string') return false;
  s = s.trim();
  if (s.length < 32 || s.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}

function fmtMc(n) {
  if (!n) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPrice(n) {
  if (!n || n === 0) return '-';
  if (n < 0.000001) return '$' + n.toExponential(2);
  if (n < 0.001) return '$' + n.toFixed(7);
  if (n < 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return null;
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function pctColor(n) {
  if (n == null) return C.muted2;
  return n >= 0 ? C.green : C.down;
}

/* ============================================================================
 * Trade data tracking (in-memory, per-mint)
 * ========================================================================= */
function createTradeData() {
  return {
    trades: [],         // [{ solAmount, tokenAmount, isBuy, timestamp }]
    volume24h: 0,
    buys24h: 0,
    sells24h: 0,
    currentPrice: 0,
    price5m: null,      // price 5 min ago
    price1h: null,      // price 1 hour ago
    price24h: null,     // price 24 hours ago
    lastUpdate: 0,
  };
}

function pruneTrades(data, now) {
  const cutoff = now - TRADE_HISTORY_WINDOW;
  data.trades = data.trades.filter(t => t.timestamp > cutoff);
}

function recomputeStats(data, now) {
  pruneTrades(data, now);

  data.volume24h = 0;
  data.buys24h = 0;
  data.sells24h = 0;

  for (const t of data.trades) {
    data.volume24h += t.solAmount;
    if (t.isBuy) data.buys24h++;
    else data.sells24h++;
  }

  if (data.trades.length > 0) {
    data.currentPrice = data.trades[data.trades.length - 1].tokenAmount > 0
      ? data.trades[data.trades.length - 1].solAmount / data.trades[data.trades.length - 1].tokenAmount
      : 0;
  }

  // Find approximate prices at 5min, 1h, 24h ago
  const targets = [
    { key: 'price5m', cutoff: now - 5 * 60 * 1000 },
    { key: 'price1h', cutoff: now - 60 * 60 * 1000 },
    { key: 'price24h', cutoff: now - 24 * 60 * 60 * 1000 },
  ];

  for (const tgt of targets) {
    const found = data.trades.filter(tr => tr.timestamp <= tgt.cutoff).pop()
      || data.trades[0];
    data[tgt.key] = found && found.tokenAmount > 0
      ? found.solAmount / found.tokenAmount
      : null;
  }

  data.lastUpdate = now;
}

function computePct(data, key) {
  const prev = data[key];
  if (prev == null || prev === 0 || data.currentPrice === 0) return null;
  return ((data.currentPrice - prev) / prev) * 100;
}

/* ============================================================================
 * TokenCard (simplified -- no per-card balance fetch)
 * ========================================================================= */
function TokenCard({ token, onCardClick, onBuyClick, onSellClick, isNew }) {
  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;
  const pct = token.pct1h != null ? token.pct1h : token.pct5m;
  const pctLabel = token.pct1h != null ? '1h' : token.pct5m != null ? '5m' : null;

  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (isNew) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 5000);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  return (
    <div
      onClick={() => { if (isValidMint(token.mint)) onCardClick(token); }}
      style={{
        background: flash ? 'rgba(0,255,163,0.04)' : C.card,
        border: '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border),
        borderRadius: 14, padding: '12px 14px', marginBottom: 10,
        transition: 'background 0.8s, border 0.8s',
        width: '100%', boxSizing: 'border-box', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {token.image
            ? <img src={token.image} alt={token.symbol} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
            : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
          {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
            {isGrad
              ? <span style={{ background: 'rgba(0,255,163,.1)', color: C.green, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>GRAD</span>
              : <span style={{ background: 'rgba(153,69,255,.1)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>PUMP</span>}
            {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
            {token.marketCap > 0 && <span style={{ fontSize: 11, color: C.muted }}>{fmtMc(token.marketCap)}</span>}
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
            {(token.buys24h > 0 || token.sells24h > 0) && (
              <span style={{ fontSize: 10, color: C.orange }}>
                {token.buys24h + token.sells24h} trades
              </span>
            )}
          </div>

          {!isGrad && progress > 0 && (
            <div style={{ marginTop: 5, height: 3, background: C.card3, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          {pct != null ? (
            <div style={{ background: pct >= 0 ? 'rgba(0,255,163,.12)' : 'rgba(59,158,255,.12)', border: '1px solid ' + (pct >= 0 ? 'rgba(0,255,163,.25)' : 'rgba(59,158,255,.25)'), borderRadius: 8, padding: '5px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: pctColor(pct) }}>{fmtPct(pct)}</div>
              {pctLabel && <div style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>{pctLabel}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.muted2 }}>-</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={e => { e.stopPropagation(); onBuyClick(token, 25); }}
          style={{ flex: 1, padding: '10px 4px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}
        >
          $25
        </button>
        <button
          onClick={e => { e.stopPropagation(); onBuyClick(token, 100); }}
          style={{ flex: 1, padding: '10px 4px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}
        >
          $100
        </button>
        <button
          onClick={e => { e.stopPropagation(); onBuyClick(token, 500); }}
          style={{ flex: 1, padding: '10px 4px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}
        >
          $500
        </button>
        <button
          onClick={e => { e.stopPropagation(); onSellClick(token); }}
          style={{ flex: 1, padding: '10px 4px', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.35)', color: C.red, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}
        >
          Sell
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * PumpDrawer (trade drawer -- fetches balance on open only)
 * ========================================================================= */
function PumpDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, presets, onPresetsChange, presetUsd }) {
  const { publicKey: extPublicKey, signTransaction: extSignTransaction, sendTransaction: extSendTransaction, connected: solConnected } = useWallet();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();
  const { connection } = useConnection();

  const publicKey = useMemo(() => {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; }
    }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const walletConnected = solConnected || (activeWalletKind === 'privy' && !!privyEmbeddedSol);
  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;

  const [activePreset, setActivePreset] = useState(null);
  const [customAmt, setCustomAmt] = useState('');
  const [sellPct, setSellPct] = useState(50);
  const [customSellAmt, setCustomSellAmt] = useState('');
  const [solBalance, setSolBalance] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [antiMev, setAntiMev] = useState(true);
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  // Fetch balances only when drawer opens
  useEffect(() => {
    if (!open || !publicKey || !connection) { setSolBalance(null); setTokenBalance(null); return; }
    let cancelled = false;

    connection.getBalance(publicKey).then(lam => { if (!cancelled) setSolBalance(lam / 1e9); }).catch(() => {});
    if (token && isValidMint(token.mint)) {
      try {
        const mintPk = new PublicKey(token.mint);
        connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk }).then(accts => {
          if (cancelled) return;
          let total = 0;
          if (accts && accts.value) {
            accts.value.forEach(acc => {
              try { const amt = acc.account.data.parsed.info.tokenAmount; total += parseFloat(amt.uiAmountString || amt.uiAmount || 0); } catch {}
            });
          }
          setTokenBalance(total);
        }).catch(() => { if (!cancelled) setTokenBalance(0); });
      } catch {}
    }
    return () => { cancelled = true; };
  }, [open, publicKey, connection, token]);

  // Reset state on open
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const last = (presetUsd != null && Number.isFinite(presetUsd) && presetUsd > 0) ? presetUsd : loadLastAmt();
      const match = presets.find(p => p === last);
      if (match) { setActivePreset(last); setCustomAmt(''); }
      else { setActivePreset(null); setCustomAmt(String(last)); }
      setStatus('idle'); setTxSig(null); setError(''); setCustomSellAmt('');
    }
    prevOpenRef.current = open;
  }, [open, presets, presetUsd]);

  // Lock body scroll
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const po = document.body.style.overflow;
    const pt = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => { document.body.style.overflow = po; document.body.style.touchAction = pt; };
  }, [open]);

  const activeDollar = parseFloat(customAmt) || activePreset || loadLastAmt();
  const isBuy = mode === 'buy';

  const executeTrade = async () => {
    if (!walletConnected) { loginPrivy ? loginPrivy() : onConnectWallet && onConnectWallet(); return; }
    if (!publicKey || !token || !isValidMint(token.mint) || !solPrice || solPrice <= 0) {
      setError('Invalid token or price'); setStatus('error');
      setTimeout(() => { setStatus('idle'); setError(''); }, 4000);
      return;
    }
    setStatus('loading'); setError('');
    try {
      const w = isPrivy ? { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true }
        : { kind: 'external', signTransaction: extSignTransaction, sendTransaction: extSendTransaction };
      let result;
      if (mode === 'buy') {
        if (!activeDollar || activeDollar <= 0) throw new Error('Amount too small');
        result = await quickBuyPump({ mint: token.mint, usdAmount: activeDollar, solPriceUsd: solPrice, publicKey, connection, wallet: w, antiMev, onStatus: () => {} });
        saveLastAmt(activeDollar);
      } else {
        const amt = customSellAmt ? parseFloat(customSellAmt) : (sellPct / 100 * (tokenBalance || 0));
        if (!amt || amt <= 0) throw new Error('Amount too small');
        result = await quickSellPump({ mint: token.mint, tokenBalance: amt, pct: 100, tokenPriceUsd: token.price || 0, solPriceUsd: solPrice, publicKey, connection, wallet: w, antiMev, onStatus: () => {} });
      }
      setTxSig(result.signature); setStatus('success');
      setTimeout(() => { setStatus('idle'); setTxSig(null); onClose(); }, 3000);
    } catch (e) {
      const msg = /reject|cancel|denied|user/i.test(e.message || '') ? 'Cancelled' : (e.message || 'Trade failed');
      setError(msg); setStatus('error');
      setTimeout(() => { setStatus('idle'); setError(''); }, 4000);
    }
  };

  if (!open || !token) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 560, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)', maxHeight: 'min(90vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px 14px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple, fontSize: 16 }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
              <div>
                <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Pump.fun -- {(PLATFORM_FEE_RATE * 100).toFixed(0)}% platform fee</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>x</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {!walletConnected && (
            <div style={{ marginBottom: 14, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
              <button onClick={() => { loginPrivy ? loginPrivy() : onConnectWallet && onConnectWallet(); }} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
            </div>
          )}

          {isBuy ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>QUICK BUY</span>
                <button onClick={() => setPresetEditorOpen(true)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>Edit</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {presets.map(amt => (
                  <button key={amt} onClick={() => { setActivePreset(amt); setCustomAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (activePreset === amt && !customAmt ? C.accent : C.border), background: activePreset === amt && !customAmt ? 'rgba(0,229,255,.15)' : C.card2, color: activePreset === amt && !customAmt ? C.accent : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>${amt}</button>
                ))}
              </div>
              <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: C.muted, fontSize: 20 }}>$</span>
                <input value={customAmt} onChange={e => { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }} placeholder="Custom" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>SELL AMOUNT</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, marginBottom: 10 }}>
                {[25, 50, 75, 100].map(p => (
                  <button key={p} onClick={() => { setSellPct(p); setCustomSellAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (sellPct === p && !customSellAmt ? C.red : C.border), background: sellPct === p && !customSellAmt ? 'rgba(255,59,107,.15)' : C.card2, color: sellPct === p && !customSellAmt ? C.red : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>{p === 100 ? 'MAX' : p + '%'}</button>
                ))}
              </div>
              <div style={{ background: C.card2, border: '1px solid ' + (customSellAmt ? C.red : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={customSellAmt} onChange={e => { setCustomSellAmt(e.target.value.replace(/[^0-9.]/g, '')); setSellPct(null); }} placeholder="Custom" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
                <span style={{ color: C.muted, fontSize: 13 }}>{token.symbol}</span>
              </div>
            </div>
          )}

          <div style={{ background: '#050912', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SNIPER PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>{antiMev ? 'ON' : 'OFF'}</div>
            </div>
            <button onClick={() => setAntiMev(!antiMev)} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative' }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
            </button>
          </div>

          {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}

          <button onClick={executeTrade} disabled={status === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : !walletConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)' : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#ff3b6b,#cc1144)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54 }}>
            {!walletConnected ? 'Connect Wallet' : status === 'loading' ? 'Confirming...' : status === 'success' ? 'Done!' : isBuy ? 'Buy $' + activeDollar.toFixed(2) + ' ' + token.symbol : 'Sell ' + token.symbol}
          </button>
          {txSig && <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * Token detail page
 * ========================================================================= */
function TokenPage({ token, onBack, onConnectWallet, solPrice, presets, onPresetsChange }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  if (!token) return null;

  const price = token.price || 0;
  const marketCap = token.marketCap || 0;
  const pct5m = token.pct5m;
  const pct1h = token.pct1h;
  const pct24h = token.pct24h;
  const volume = token.volume24h || 0;
  const buys = token.buys24h || 0;
  const sells = token.sells24h || 0;
  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>&larr; Back to Launches</button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{token.symbol}</span>
                {isGrad ? <span style={{ background: 'rgba(0,255,163,.12)', color: C.green, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>GRADUATED</span> : <span style={{ background: 'rgba(153,69,255,.12)', color: C.purple, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>PUMP.FUN</span>}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>{token.name}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{fmtPrice(price)}</div>
            {pct1h != null && <div style={{ fontSize: 13, fontWeight: 700, color: pctColor(pct1h), marginTop: 3 }}>{fmtPct(pct1h)} 1h</div>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          {[['5m', pct5m], ['1h', pct1h], ['24h', pct24h]].map(([label, val]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: pctColor(val) }}>{val == null ? '--' : fmtPct(val)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          {[['Market Cap', fmtMc(marketCap)], ['Volume 24h', fmtMc(volume)], ['Buys 24h', String(buys)], ['Sells 24h', String(sells)], ['Age', timeAgo(token.createdAt)]].map(([label, val]) => (
            <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>

        {!isGrad && progress > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>BONDING CURVE</span>
              <span style={{ fontSize: 11, color: C.orange, fontWeight: 700 }}>{progress.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: C.card3, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
          </div>
        )}

        <div style={{ background: C.card3, borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{token.mint}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button onClick={() => { setDrawerMode('buy'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Buy {token.symbol}</button>
        <button onClick={() => { setDrawerMode('sell'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.4)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Sell {token.symbol}</button>
      </div>

      <PumpDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} mode={drawerMode} token={token} solPrice={solPrice} onConnectWallet={onConnectWallet} presets={presets} onPresetsChange={onPresetsChange} />
    </div>
  );
}

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================= */
export default function NewLaunches({ coins, onConnectWallet, resetKey }) {
  const [tokens, setTokens] = useState([]);
  const [tab, setTab] = useState('new');
  const [selectedToken, setSelectedToken] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [drawerToken, setDrawerToken] = useState(null);
  const [drawerPresetUsd, setDrawerPresetUsd] = useState(null);
  const [newMints, setNewMints] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const [presets, setPresets] = useState(loadPresets());

  const tokensRef = useRef([]);
  const tradeDataRef = useRef(new Map()); // mint -> createTradeData()
  const batchTimerRef = useRef(null);
  const wsRef = useRef(null);

  const solCoin = coins && coins.find(c => c.id === 'solana' || c.symbol === 'SOL');
  const solPrice = solCoin && Number(solCoin.current_price) > 0 ? Number(solCoin.current_price) : 0;

  useEffect(() => { setSelectedToken(null); }, [resetKey]);

  const handlePresetsChange = p => { setPresets(p); savePresets(p); };

  // Flush batched trade data to state
  const flushBatch = useCallback(() => {
    setTokens([].concat(tokensRef.current));
    batchTimerRef.current = null;
  }, []);

  // Process a trade event
  const processTrade = useCallback((msg) => {
    if (!msg || !isValidMint(msg.mint)) return;
    const now = Date.now();
    let td = tradeDataRef.current.get(msg.mint);
    if (!td) {
      td = createTradeData();
      tradeDataRef.current.set(msg.mint, td);
    }

    const solAmt = parseFloat(msg.solAmount || 0);
    const tokenAmt = parseFloat(msg.tokenAmount || 0);
    const isBuy = msg.isBuy !== false;

    if (solAmt > 0 && tokenAmt > 0) {
      td.trades.push({ solAmount: solAmt, tokenAmount: tokenAmt, isBuy, timestamp: now });
    }

    recomputeStats(td, now);

    // Update the token object in the main list
    const idx = tokensRef.current.findIndex(t => t.mint === msg.mint);
    if (idx >= 0) {
      const token = { ...tokensRef.current[idx] };
      token.price = td.currentPrice || token.price;
      token.volume24h = td.volume24h;
      token.buys24h = td.buys24h;
      token.sells24h = td.sells24h;
      token.pct5m = computePct(td, 'price5m');
      token.pct1h = computePct(td, 'price1h');
      token.pct24h = computePct(td, 'price24h');
      tokensRef.current[idx] = token;
    }

    // Batch UI updates
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(flushBatch, BATCH_UPDATE_MS);
    }
  }, [flushBatch]);

  // WebSocket connection
  useEffect(() => {
    let alive = true;
    let ws = null;
    let reconnectTimer = null;

    const cached = loadCachedTokens();
    if (cached.length > 0) {
      tokensRef.current = cached;
      setTokens([].concat(cached));
    }

    function connectWS() {
      if (!alive) return;
      try {
        ws = new WebSocket(PUMPPORTAL_WS);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsStatus('live');
          try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); } catch {}
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (!msg) return;

            if (msg.txType === 'create' && isValidMint(msg.mint)) {
              // New token launch
              if (tokensRef.current.find(t => t.mint === msg.mint)) return;

              const sol = solPrice || 0;
              const mcUsd = sol > 0 ? (Number(msg.marketCapSol) || 0) * sol : 0;
              const priceUsd = (sol > 0 && Number(msg.vTokensInBondingCurve) > 0 && Number(msg.vSolInBondingCurve) > 0)
                ? (Number(msg.vSolInBondingCurve) / Number(msg.vTokensInBondingCurve)) * sol : 0;

              const token = {
                mint: msg.mint,
                symbol: msg.symbol || msg.mint.slice(0, 4).toUpperCase(),
                name: msg.name || 'Unknown Token',
                image: null,
                decimals: 6,
                price: priceUsd,
                marketCap: mcUsd,
                pct5m: null, pct1h: null, pct24h: null,
                volume24h: 0, buys24h: 0, sells24h: 0,
                bondingProgress: 0, graduated: false,
                createdAt: Date.now(),
                uri: msg.uri || null, signature: msg.signature || null,
              };

              tokensRef.current = [token].concat(tokensRef.current.filter(t => t.mint !== msg.mint)).slice(0, 150);
              setTokens([].concat(tokensRef.current));
              saveCachedTokens(tokensRef.current);

              // Flash as new
              setNewMints(prev => { const n = new Set(prev); n.add(msg.mint); return n; });
              setTimeout(() => {
                if (!alive) return;
                setNewMints(prev => { const n = new Set(prev); n.delete(msg.mint); return n; });
              }, 6000);

              // Subscribe to trades for this token
              try { ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [msg.mint] })); } catch {}
            }

            if (msg.txType === 'buy' || msg.txType === 'sell') {
              processTrade(msg);
            }
          } catch {}
        };

        ws.onerror = () => { setWsStatus('error'); };
        ws.onclose = () => {
          setWsStatus('reconnecting');
          if (!alive) return;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(); }, 3000);
        };
      } catch {
        setWsStatus('error');
        if (alive) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(); }, 5000);
        }
      }
    }

    connectWS();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (ws) {
        try { ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-subscribe to trades for existing tokens on WS reconnect
  useEffect(() => {
    if (wsStatus === 'live' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const mints = tokensRef.current.map(t => t.mint).filter(isValidMint);
      if (mints.length > 0) {
        try { wsRef.current.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: mints })); } catch {}
      }
    }
  }, [wsStatus]);

  const displayTokens = useMemo(() => {
    const list = tokens.slice();
    if (tab === 'new') {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      list.sort((a, b) => ((b.volume24h || 0) + (b.buys24h || 0) * 5) - ((a.volume24h || 0) + (a.buys24h || 0) * 5));
    }
    return list;
  }, [tokens, tab]);

  const openBuyDrawer = (token, presetUsd) => {
    if (!isValidMint(token && token.mint)) return;
    setDrawerToken(token); setDrawerMode('buy');
    setDrawerPresetUsd(Number.isFinite(presetUsd) && presetUsd > 0 ? presetUsd : null);
    setDrawerOpen(true);
  };

  const openSellDrawer = (token) => {
    if (!isValidMint(token && token.mint)) return;
    setDrawerToken(token); setDrawerMode('sell'); setDrawerPresetUsd(null);
    setDrawerOpen(true);
  };

  if (selectedToken) {
    return (
      <TokenPage token={selectedToken} onBack={() => setSelectedToken(null)} onConnectWallet={onConnectWallet} solPrice={solPrice} presets={presets} onPresetsChange={handlePresetsChange} />
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'), borderRadius: 20, padding: '3px 10px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>{wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : wsStatus === 'error' ? 'ERROR' : 'CONNECTING'}</span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked - live trades</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <button onClick={() => setTab('new')} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'new' ? 'rgba(0,229,255,.1)' : C.card2, border: '1px solid ' + (tab === 'new' ? 'rgba(0,229,255,.3)' : C.border), color: tab === 'new' ? C.accent : C.muted }}>New</button>
        <button onClick={() => setTab('trending')} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'trending' ? 'rgba(255,149,0,.1)' : C.card2, border: '1px solid ' + (tab === 'trending' ? 'rgba(255,149,0,.3)' : C.border), color: tab === 'trending' ? C.orange : C.muted }}>Trending</button>
        <PresetsEditButton size={42} label="Customize instant buy amounts" />
      </div>

      {displayTokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, border: '1px solid ' + C.border, borderRadius: 16 }}>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>{wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}</div>
          <div style={{ color: C.muted2, fontSize: 11 }}>Tokens appear here as they launch on Solana</div>
        </div>
      ) : (
        displayTokens.map(token => (
          <TokenCard
            key={token.mint}
            token={token}
            onCardClick={setSelectedToken}
            onBuyClick={openBuyDrawer}
            onSellClick={openSellDrawer}
            isNew={newMints.has(token.mint)}
          />
        ))
      )}

      <PumpDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        token={drawerToken}
        solPrice={solPrice}
        onConnectWallet={onConnectWallet}
        presets={presets}
        onPresetsChange={handlePresetsChange}
        presetUsd={drawerPresetUsd}
      />
    </div>
  );
}
