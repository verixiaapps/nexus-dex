/**
 * NEXUS DEX -- NewLaunches
 *
 * Live feed of newly-launched Solana tokens with one-tap buy/sell on each
 * card and a full pump.fun trading drawer on detail pages.
 *
 * Data sources (locked: Jupiter / 0x / LiFi only, plus PumpPortal for
 * pump.fun trading per user-approved exception):
 *
 *   - Real-time new launches:  PumpPortal WS (wss://pumpportal.fun/api/data)
 *                              method: subscribeNewToken
 *                              No API key. Already in CSP.
 *
 *   - Initial token list:      Jupiter v2 /tokens/v2/recent
 *                              via /api/jupiter proxy
 *
 *   - Periodic price refresh:  Jupiter v2 /tokens/v2/search?query=<mint>
 *                              batched 30 mints in parallel every 15s
 *
 *   - Trade execution:         PumpPortal /api/trade-local (build tx),
 *                              user signs, we inject 5% fee transfer in
 *                              the same tx, broadcast via Solana RPC
 *                              (which is the server proxy /api/solana-rpc).
 *
 *   - Solana RPC:              useConnection() from wallet-adapter, which
 *                              is wired to /api/solana-rpc by index.js.
 *                              No Helius key in the browser bundle.
 *
 * Removed (banned by user rules):
 *   - GeckoTerminal entirely
 *   - REACT_APP_HELIUS_API_KEY / REACT_APP_SOLANA_RPC env reads (key leak)
 *   - Helius WS logsSubscribe + extractMintFromTx (replaced by PumpPortal WS)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import {
  VersionedTransaction, TransactionMessage, SystemProgram,
  PublicKey, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TradeDrawer } from './SwapWidget.jsx';
import { quickBuyPump, quickSellPump } from '../pumpTrade.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const PRESET_KEY = 'nexus_launch_presets';
const LAST_AMT_KEY = 'nexus_launch_last_amt';

/* ============================================================================
 * LOCKED -- DO NOT MODIFY.
 * Same-chain trades take 5% total platform fee. The full spread is
 * transferred to SOL_FEE_WALLET inside the SAME versioned transaction
 * as the PumpPortal trade (one signature, one tx). The Sniper
 * Protection toggle is a network priority fee only -- it does NOT
 * reduce or split the platform fee.
 * ========================================================================= */
const PLATFORM_FEE_RATE = 0.05;
const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const SOL_FEE_WALLET_PK = new PublicKey(SOL_FEE_WALLET);

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

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
    const v = localStorage.getItem('nexus_launch_cache');
    if (!v) return [];
    const p = JSON.parse(v);
    if (Date.now() - (p.ts || 0) > 300000) return [];
    return p.tokens || [];
  } catch (e) { return []; }
}
function saveCachedTokens(t) {
  try { localStorage.setItem('nexus_launch_cache', JSON.stringify({ ts: Date.now(), tokens: t.slice(0, 30) })); } catch (e) {}
}
function loadPresets() {
  try { const v = localStorage.getItem(PRESET_KEY); return v ? JSON.parse(v) : [5, 10, 25, 50, 100]; } catch (e) { return [5, 10, 25, 50, 100]; }
}
function savePresets(arr) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) {}
}
function loadLastAmt() {
  try { return parseFloat(localStorage.getItem(LAST_AMT_KEY) || '25') || 25; } catch (e) { return 25; }
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
function fmtPct(n) { if (n == null || isNaN(n)) return null; return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
function pctColor(n) { if (n == null) return C.muted2; return n >= 0 ? C.green : C.down; }

/* ============================================================================
 * Map a Jupiter v2 token entry to our internal `token` shape.
 *
 * Jupiter v2 fields used:
 *   id              mint address
 *   name, symbol, decimals
 *   icon            logo URL
 *   usdPrice        current USD price
 *   mcap, fdv       market cap
 *   firstPool       { createdAt }   when pool was created (epoch ms)
 *   stats24h        { priceChange, buyVolume, sellVolume }
 *   stats5m         { priceChange }
 *   stats1h         { priceChange }
 *   audit           { isSus, ... }
 *   bondingCurve    pump.fun bonding curve completion (0-100)  if applicable
 *   graduatedPool   set if token has graduated to a regular AMM pool
 * ========================================================================= */
function mapJupiterToken(t, prevHistory) {
  if (!t || !t.id) return null;
  const stats24 = t.stats24h || {};
  const stats5m = t.stats5m  || {};
  const stats1h = t.stats1h  || {};
  const buyVol  = Number(stats24.buyVolume)  || 0;
  const sellVol = Number(stats24.sellVolume) || 0;
  const price   = t.usdPrice != null ? Number(t.usdPrice) : 0;
  const created = t.firstPool && t.firstPool.createdAt
    ? Date.parse(t.firstPool.createdAt) || Date.now()
    : Date.now();
  const history = (prevHistory && prevHistory.length)
    ? (price > 0 ? prevHistory.concat([price]).slice(-30) : prevHistory)
    : (price > 0 ? [price] : []);
  return {
    mint: t.id,
    symbol: t.symbol || (t.id.slice(0, 4).toUpperCase()),
    name: t.name || t.symbol || 'Unknown',
    image: t.icon || t.logoURI || null,
    decimals: t.decimals != null ? t.decimals : 6,
    price,
    marketCap: t.mcap != null ? Number(t.mcap) : (t.fdv != null ? Number(t.fdv) : 0),
    pct5m:  stats5m.priceChange != null ? Number(stats5m.priceChange) : null,
    pct1h:  stats1h.priceChange != null ? Number(stats1h.priceChange) : null,
    pct24h: stats24.priceChange != null ? Number(stats24.priceChange) : null,
    volume24h: buyVol + sellVol,
    buys24h: 0, // not in v2 schema directly; left for compatibility
    priceHistory: history,
    bondingProgress: typeof t.bondingCurve === 'number' ? t.bondingCurve : 0,
    graduated: !!t.graduatedPool || (typeof t.bondingCurve === 'number' && t.bondingCurve >= 100),
    createdAt: created,
  };
}

/* ============================================================================
 * Batch token data refresh via Jupiter v2 search.
 * One request per mint (Jupiter v2 search doesn't take comma-separated ids
 * for the search endpoint), parallelized; soft-cap at 30 per cycle.
 *
 * Returns map: { [mint]: tokenShape }   for found tokens only.
 * ========================================================================= */
async function fetchJupiterBatch(mints, prevByMint) {
  if (!mints || !mints.length) return {};
  const slice = mints.slice(0, 30).filter(isValidMint);
  const results = await Promise.all(slice.map(function (m) {
    return fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(m))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }));
  const out = {};
  results.forEach(function (arr, i) {
    if (!Array.isArray(arr) || !arr.length) return;
    const mint = slice[i];
    const match = arr.find(function (t) { return t && t.id === mint; }) || arr[0];
    const prev = prevByMint && prevByMint[mint];
    const shape = mapJupiterToken(match, prev ? prev.priceHistory : []);
    if (shape) out[mint] = shape;
  });
  return out;
}

/* ============================================================================
 * Fetch the list of recently-launched Solana tokens via Jupiter v2.
 * ========================================================================= */
async function fetchRecentLaunches() {
  try {
    const r = await fetch('/api/jupiter/tokens/v2/recent');
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map(function (t) { return mapJupiterToken(t, []); }).filter(Boolean);
  } catch (e) { return []; }
}

/* ============================================================================
 * FEE COLLECTION (locked rule #2: ONE tx, ONE signature).
 * ========================================================================= */
async function injectPlatformFee(connection, tx, fromPubkey, feeLamports) {
  if (!feeLamports || feeLamports <= 0) return tx;

  let lookupTableAccounts = [];
  const lookups = (tx.message && tx.message.addressTableLookups) || [];
  if (lookups.length > 0) {
    const resolved = await Promise.all(lookups.map(function (lt) {
      return connection.getAddressLookupTable(lt.accountKey)
        .then(function (r) { return r && r.value ? r.value : null; })
        .catch(function () { return null; });
    }));
    lookupTableAccounts = resolved.filter(Boolean);
  }

  const decompiled = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: lookupTableAccounts,
  });
  decompiled.instructions.push(SystemProgram.transfer({
    fromPubkey,
    toPubkey: SOL_FEE_WALLET_PK,
    lamports: feeLamports,
  }));
  const newMsg = decompiled.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMsg);
}

/* ============================================================================
 * Sparkline
 * ========================================================================= */
function Sparkline({ history, up }) {
  if (!history || history.length < 2) return <div style={{ width: 64, height: 28 }} />;
  const min = Math.min.apply(null, history), max = Math.max.apply(null, history);
  const range = max - min || min * 0.01 || 1;
  const w = 64, h = 28;
  const pts = history.map(function (v, i) {
    return ((i / (history.length - 1)) * w).toFixed(1) + ',' + (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
  }).join(' ');
  const color = up == null ? C.muted2 : up ? C.green : C.down;
  return <svg width={w} height={h} style={{ overflow: 'hidden', flexShrink: 0 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/* ============================================================================
 * Preset editor (drawer-internal only; cards use instantPresets.jsx)
 * ========================================================================= */
function PresetEditor({ open, onClose, presets, onSave }) {
  const [vals, setVals] = useState(presets.map(String));
  useEffect(function () { if (open) setVals(presets.map(String)); }, [open, presets]);

  useEffect(function () {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 27) onClose(); }
    window.addEventListener('keydown', onKey);
    return function () {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.touchAction = prevTouch || '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, padding: 24, width: '90vw', maxWidth: 360, boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Edit Quick Buy Presets</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24, padding: 0, lineHeight: 1 }}>x</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {vals.map(function (v, i) {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.muted, fontSize: 12, width: 56, flexShrink: 0 }}>Slot {i + 1}</span>
                <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: C.muted }}>$</span>
                  <input value={v} onChange={function (e) { const nv = e.target.value.replace(/[^0-9.]/g, ''); setVals(function (p) { const n = p.slice(); n[i] = nv; return n; }); }} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none', width: '100%' }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={function () { let parsed = vals.map(function (v) { return parseFloat(v) || 0; }).filter(function (v) { return v > 0; }); while (parsed.length < 5) parsed.push(25); onSave(parsed.slice(0, 5)); onClose(); }} style={{ flex: 2, padding: 12, borderRadius: 10, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>Save Presets</button>
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * Build a SwapWidget-compatible coin from a NewLaunches token.
 * Used for graduated tokens to route through the Jupiter swap widget.
 * ========================================================================= */
function buildSolanaCoin(token) {
  if (!token || !isValidMint(token.mint)) return null;
  const mint = String(token.mint).trim();
  return {
    id: mint, mint, address: mint,
    symbol: token.symbol || mint.slice(0, 4).toUpperCase(),
    name: token.name || 'Unknown Token',
    image: token.image || null,
    decimals: typeof token.decimals === 'number' ? token.decimals : 6,
    chain: 'solana', isSolanaToken: true,
    current_price: token.price || 0,
  };
}

/* ============================================================================
 * Drawer router: graduated tokens go through the Jupiter swap widget,
 * pre-graduation tokens go through PumpPortal in PumpDrawer.
 * ========================================================================= */
function LaunchTradeDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, coins, jupiterTokens, presets, onPresetsChange, presetUsd }) {
  if (open && (!token || !isValidMint(token.mint))) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[NewLaunches] drawer suppressed -- invalid mint on token:', token);
    }
    return null;
  }

  const isGrad = token && token.graduated;

  if (isGrad) {
    const coin = buildSolanaCoin(token);
    if (!coin) return null;
    return (
      <TradeDrawer
        open={open} onClose={onClose} mode={mode} coin={coin}
        jupiterTokens={jupiterTokens} coins={coins}
        onConnectWallet={onConnectWallet} isConnected={isConnected}
      />
    );
  }

  return (
    <PumpDrawer
      open={open} onClose={onClose} mode={mode} token={token}
      solPrice={solPrice} onConnectWallet={onConnectWallet} isConnected={isConnected}
      presets={presets} onPresetsChange={onPresetsChange}
      presetUsd={presetUsd}
    />
  );
}

/* ============================================================================
 * PumpDrawer -- full pre-graduation pump.fun trading UI
 * Calls PumpPortal /api/trade-local directly (CSP allows it), then
 * injects the 5% fee transfer in the same versioned tx.
 * ========================================================================= */
function PumpDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, isConnected, presets, onPresetsChange, presetUsd }) {
  const { publicKey: extPublicKey, sendTransaction: extSolSendTx, connected: solConnected } = useWallet();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();

  const publicKey = useMemo(function () {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; }
    }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const sendTransaction = useCallback(async function (tx, conn, opts) {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') {
        return privyEmbeddedSol.sendTransaction(tx, conn, opts);
      }
      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const signed = await privyEmbeddedSol.signTransaction(tx);
        return conn.sendRawTransaction(signed.serialize(), opts || { skipPreflight: false, maxRetries: 3 });
      }
      throw new Error('Privy wallet has no sign method');
    }
    return extSolSendTx(tx, conn, opts);
  }, [activeWalletKind, privyEmbeddedSol, extSolSendTx]);

  const { connection } = useConnection();
  const walletConnected = solConnected || (activeWalletKind === 'privy' && !!privyEmbeddedSol);

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

  useEffect(function () {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    function onKey(e) { if ((e.key === 'Escape' || e.keyCode === 27) && status !== 'loading') onClose(); }
    window.addEventListener('keydown', onKey);
    return function () {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.touchAction = prevTouch || '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, status, onClose]);

  useEffect(function () {
    if (!publicKey || !connection || !open) { setSolBalance(null); setTokenBalance(null); return; }
    connection.getBalance(publicKey).then(function (lam) { setSolBalance(lam / 1e9); }).catch(function () {});
    if (token && isValidMint(token.mint)) {
      try {
        const mintPk = new PublicKey(token.mint);
        connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk })
          .then(function (accts) { setTokenBalance(accts.value.length > 0 ? accts.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); })
          .catch(function () {});
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.warn('[PumpDrawer] bad mint, skipping balance:', token.mint);
      }
    }
  }, [publicKey, connection, token, open]);

  const prevOpenRef = useRef(false);
  useEffect(function () {
    if (open && !prevOpenRef.current) {
      const last = (presetUsd != null && Number.isFinite(presetUsd) && presetUsd > 0)
        ? presetUsd
        : loadLastAmt();
      const match = presets.find(function (p) { return p === last; });
      if (match) { setActivePreset(last); setCustomAmt(''); }
      else { setActivePreset(null); setCustomAmt(String(last)); }
      setStatus('idle'); setTxSig(null); setError(''); setCustomSellAmt('');
    }
    prevOpenRef.current = open;
  }, [open, presets, presetUsd]);

  const activeDollar = parseFloat(customAmt) || activePreset || loadLastAmt();
  const solAmt = solPrice > 0 ? activeDollar / solPrice : 0;

  const totalLamports = Math.floor(solAmt * LAMPORTS_PER_SOL);
  const buyFeeLamports = Math.floor(totalLamports * PLATFORM_FEE_RATE);
  const buyTradeLamports = totalLamports - buyFeeLamports;
  const buyTradeSolAmount = buyTradeLamports / LAMPORTS_PER_SOL;

  const executeTrade = async function () {
    if (!walletConnected) {
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!publicKey || !token || !isValidMint(token.mint)) {
      setError('Invalid token address'); setStatus('error');
      setTimeout(function () { setStatus('idle'); setError(''); }, 4000);
      return;
    }
    setStatus('loading'); setError('');
    try {
      const sellAmount = customSellAmt
        ? parseFloat(customSellAmt)
        : (sellPct / 100 * (tokenBalance || 0));

      let feeLamports;
      let pumpAmount;

      if (mode === 'buy') {
        if (totalLamports <= 0) throw new Error('Amount too small');
        feeLamports = buyFeeLamports;
        pumpAmount = buyTradeSolAmount;
      } else {
        if (!sellAmount || sellAmount <= 0) throw new Error('Amount too small');
        const estSolOut = (token.price || 0) * sellAmount / (solPrice || 1);
        feeLamports = Math.max(0, Math.floor(estSolOut * PLATFORM_FEE_RATE * 0.85 * LAMPORTS_PER_SOL));
        pumpAmount = sellAmount;
      }

      const res = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: publicKey.toString(),
          action: mode,
          mint: token.mint,
          denominatedInSol: mode === 'buy' ? 'true' : 'false',
          amount: mode === 'buy' ? parseFloat(pumpAmount.toFixed(6)) : pumpAmount,
          slippage: 15,
          priorityFee: antiMev ? 0.001 : 0.0001,
          pool: 'auto',
        }),
      });
      if (!res.ok) throw new Error('PumpPortal error ' + res.status);
      const txBytes = await res.arrayBuffer();
      let tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));

      tx = await injectPlatformFee(connection, tx, publicKey, feeLamports);

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setTxSig(sig);
      saveLastAmt(activeDollar);
      setStatus('success');
      setTimeout(function () { setStatus('idle'); setTxSig(null); onClose(); }, 3000);
    } catch (e) {
      console.error('Trade error:', e); setError(e.message || 'Trade failed'); setStatus('error');
      setTimeout(function () { setStatus('idle'); setError(''); }, 4000);
    }
  };

  if (!open || !token) return null;
  const isBuy = mode === 'buy';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 560, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: 'min(90vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 20px 14px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {token.image
                ? <img src={token.image} alt={token.symbol} style={{ width: 38, height: 38, borderRadius: 10 }} onError={function (e) { e.target.style.display = 'none'; }} />
                : <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: C.purple, fontSize: 16 }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>
              }
              <div>
                <div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Pump.fun -- {(PLATFORM_FEE_RATE * 100).toFixed(0)}% platform fee</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>

          <div style={{ background: C.card2, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Current price</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{token.price > 0 ? fmtPrice(token.price) : 'Loading...'}</span>
                {token.pct1h != null && <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(token.pct1h), background: token.pct1h >= 0 ? 'rgba(0,255,163,.1)' : 'rgba(59,158,255,.1)', padding: '2px 7px', borderRadius: 6 }}>{fmtPct(token.pct1h)} 1h</span>}
              </div>
            </div>
            {isBuy && token.price > 0 && activeDollar > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, marginTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
                <span style={{ color: C.muted, fontSize: 12 }}>You receive approx</span>
                <span style={{ color: C.green, fontWeight: 800, fontSize: 14 }}>{((activeDollar * (1 - PLATFORM_FEE_RATE)) / token.price).toLocaleString('en-US', { maximumFractionDigits: 0 })} {token.symbol}</span>
              </div>
            )}
          </div>

          {!walletConnected && (
            <div style={{ marginBottom: 14, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
              <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
            </div>
          )}

          {isBuy ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>QUICK BUY</span>
                  {solBalance != null && <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>SOL: <span style={{ color: C.text }}>{solBalance.toFixed(4)}</span></span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {solBalance != null && solBalance > 0.01 && <button onClick={function () { setCustomAmt((Math.max(0, solBalance - 0.01) * solPrice).toFixed(2)); setActivePreset(null); }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '2px 8px', color: C.accent, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>MAX</button>}
                  <button onClick={function () { setPresetEditorOpen(true); }} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, padding: 0 }}>Edit presets</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {presets.map(function (amt) {
                  const active = activePreset === amt && !customAmt;
                  return <button key={amt} onClick={function () { setActivePreset(amt); setCustomAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (active ? C.accent : C.border), background: active ? 'rgba(0,229,255,.15)' : C.card2, color: active ? C.accent : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>${amt}</button>;
                })}
              </div>
              <div style={{ background: C.card2, border: '1px solid ' + (customAmt ? C.accent : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: C.muted, fontSize: 20 }}>$</span>
                <input value={customAmt} onChange={function (e) { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }} placeholder="Custom Amount" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
                {solPrice > 0 && activeDollar > 0 && <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{(activeDollar / solPrice).toFixed(3)} SOL</span>}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>SELL AMOUNT</span>
                {tokenBalance != null && <span style={{ fontSize: 10, color: C.muted }}>{token.symbol}: <span style={{ color: C.text }}>{tokenBalance >= 1000 ? tokenBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : tokenBalance.toFixed(4)}</span></span>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {[25, 50, 75, 100].map(function (p) {
                  return <button key={p} onClick={function () { setSellPct(p); setCustomSellAmt(''); }} style={{ flex: 1, padding: '11px 2px', borderRadius: 10, border: '1px solid ' + (sellPct === p && !customSellAmt ? C.red : C.border), background: sellPct === p && !customSellAmt ? 'rgba(255,59,107,.15)' : C.card2, color: sellPct === p && !customSellAmt ? C.red : C.muted, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>{p === 100 ? 'MAX' : p + '%'}</button>;
                })}
              </div>
              <div style={{ background: C.card2, border: '1px solid ' + (customSellAmt ? C.red : C.border), borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={customSellAmt} onChange={function (e) { setCustomSellAmt(e.target.value.replace(/[^0-9.]/g, '')); setSellPct(null); }} placeholder="Custom Amount" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 20, fontWeight: 700, color: '#fff', outline: 'none' }} />
                <span style={{ color: C.muted, fontSize: 13, flexShrink: 0 }}>{token.symbol}</span>
                {tokenBalance != null && tokenBalance > 0 && <button onClick={function () { setCustomSellAmt(tokenBalance.toFixed(6)); setSellPct(null); }} style={{ background: 'rgba(255,59,107,.12)', border: '1px solid rgba(255,59,107,.25)', borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>}
              </div>
              {token.price > 0 && customSellAmt && parseFloat(customSellAmt) > 0 && (
                <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
                  &asymp; ${(parseFloat(customSellAmt) * token.price * (1 - PLATFORM_FEE_RATE)).toFixed(4)} <span style={{ color: C.muted2 }}>after 5% fee</span>
                </div>
              )}
            </div>
          )}

          <div style={{ background: '#050912', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SNIPER PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>{antiMev ? 'ON - higher network priority' : 'OFF - standard priority'}</div>
            </div>
            <button onClick={function () { setAntiMev(!antiMev); }} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
            </button>
          </div>

          {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}

          <button onClick={executeTrade} disabled={status === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : status === 'error' ? 'rgba(255,59,107,.2)' : !walletConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)' : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#ff3b6b,#cc1144)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54 }}>
            {!walletConnected ? 'Connect Wallet' : status === 'loading' ? 'Confirming...' : status === 'success' ? (isBuy ? 'Bought!' : 'Sold!') : status === 'error' ? 'Failed - Try Again' : isBuy ? 'Buy $' + activeDollar.toFixed(2) + ' of ' + token.symbol : 'Sell ' + (customSellAmt || sellPct + '%') + ' ' + token.symbol}
          </button>

          {txSig && status === 'success' && <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>}
          <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 10, lineHeight: 1.6 }}>Non-custodial &mdash; 5% fee bundled in the same transaction</p>
        </div>
        <PresetEditor open={presetEditorOpen} onClose={function () { setPresetEditorOpen(false); }} presets={presets} onSave={onPresetsChange} />
      </div>
    </>
  );
}

/* ============================================================================
 * Token detail page
 * ========================================================================= */
function TokenPage({ token, onBack, onConnectWallet, isConnected, solPrice, coins, jupiterTokens, presets, onPresetsChange }) {
  const [liveData, setLiveData] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [loading, setLoading] = useState(true);

  useEffect(function () {
    if (!token || !isValidMint(token.mint)) return;
    setLoading(true);
    fetchJupiterBatch([token.mint]).then(function (d) {
      if (d[token.mint]) setLiveData(d[token.mint]);
      setLoading(false);
    });
    const interval = setInterval(function () {
      fetchJupiterBatch([token.mint]).then(function (d) {
        if (d[token.mint]) setLiveData(d[token.mint]);
      });
    }, 10000);
    return function () { clearInterval(interval); };
  }, [token]);

  if (!token) return null;
  const price = (liveData && liveData.price) || token.price || 0;
  const marketCap = (liveData && liveData.marketCap) || token.marketCap || 0;
  const pct5m = liveData ? liveData.pct5m : token.pct5m;
  const pct1h = liveData ? liveData.pct1h : token.pct1h;
  const pct24h = liveData ? liveData.pct24h : token.pct24h;
  const volume = (liveData && liveData.volume24h) || token.volume24h || 0;
  const buys = (liveData && liveData.buys24h) || 0;
  const isGrad = (liveData && liveData.graduated) || token.graduated || (token.bondingProgress || 0) >= 100;
  const progress = token.bondingProgress || 0;
  const history = token.priceHistory || [];
  const sparkUp = pct1h != null ? pct1h >= 0 : null;

  const fullToken = Object.assign(
    {},
    token,
    liveData || {},
    { graduated: isGrad, price, mint: token.mint, decimals: token.decimals || 6 }
  );

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>
        &larr; Back to Launches
      </button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {token.image ? <img src={token.image} alt={token.symbol} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover' }} onError={function (e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{token.symbol}</span>
                {isGrad ? <span style={{ background: 'rgba(0,255,163,.12)', color: C.green, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>GRADUATED</span> : <span style={{ background: 'rgba(153,69,255,.12)', color: C.purple, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5 }}>PUMP.FUN</span>}
              </div>
              <div style={{ color: C.muted, fontSize: 12 }}>{token.name}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{loading && !price ? '...' : fmtPrice(price)}</div>
            {pct1h != null && <div style={{ fontSize: 13, fontWeight: 700, color: pctColor(pct1h), marginTop: 3 }}>{fmtPct(pct1h)} 1h</div>}
          </div>
        </div>

        {history.length >= 2 && (
          <div style={{ marginBottom: 14, background: C.card2, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>PRICE CHART (live)</div>
            <svg width="100%" height="56" viewBox="0 0 400 56" preserveAspectRatio="none" style={{ display: 'block' }}>
              {(function () {
                const min = Math.min.apply(null, history), max = Math.max.apply(null, history);
                const range = max - min || min * 0.01 || 1;
                const pts = history.map(function (v, i) { const x = (i / (history.length - 1)) * 400; const y = 52 - ((v - min) / range) * 46; return x.toFixed(1) + ',' + y.toFixed(1); }).join(' ');
                const col = sparkUp == null ? C.accent : sparkUp ? C.green : C.down;
                return <g><polyline points={pts + ' 400,56 0,56'} fill={col + '22'} stroke="none" /><polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>;
              })()}
            </svg>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          {[['5m', pct5m], ['1h', pct1h], ['24h', pct24h]].map(function (item) {
            const val = item[1];
            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: pctColor(val) }}>{val == null ? (loading ? '...' : '--') : fmtPct(val)}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          {[['Market Cap', fmtMc(marketCap)], ['Volume 24h', fmtMc(volume)], ['Buys 24h', buys > 0 ? buys.toLocaleString() : '--'], ['Age', timeAgo(token.createdAt) + ' ago']].map(function (item) {
            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>{item[0]}</div>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item[1]}</div>
              </div>
            );
          })}
        </div>

        {!isGrad && progress > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>BONDING CURVE</span>
              <span style={{ fontSize: 11, color: progress > 75 ? C.orange : C.muted, fontWeight: 700 }}>{progress.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: C.card3, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
            {progress >= 80 && <div style={{ marginTop: 5, fontSize: 10, color: C.orange }}>Almost to Raydium &mdash; {(100 - progress).toFixed(1)}% left</div>}
          </div>
        )}

        <div style={{ background: C.card3, borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{token.mint}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button onClick={function () { setDrawerMode('buy'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Buy {token.symbol}</button>
        <button onClick={function () { setDrawerMode('sell'); setDrawerOpen(true); }} style={{ padding: '18px 10px', borderRadius: 16, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.4)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Sell {token.symbol}</button>
      </div>

      <LaunchTradeDrawer
        open={drawerOpen} onClose={function () { setDrawerOpen(false); }}
        mode={drawerMode} token={fullToken} solPrice={solPrice}
        onConnectWallet={onConnectWallet} isConnected={isConnected}
        coins={coins} jupiterTokens={jupiterTokens}
        presets={presets} onPresetsChange={onPresetsChange}
      />
    </div>
  );
}

/* ============================================================================
 * Token card with one-tap buy/sell
 * ========================================================================= */
function TokenCard({ token, onCardClick, onBuyClick, onSellClick, onQuickBuy, isNew, solPrice }) {
  const { publicKey: extPublicKey, sendTransaction: extSolSendTx, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { activeWalletKind, privyEmbeddedSol, isConnected: nexusConnected, loginPrivy } = useNexusWallet();

  const { buyPresets } = useInstantPresets();
  const cardBuyPresets = (buyPresets || []).slice(0, 3);

  const [flash, setFlash] = useState(false);
  const [cardStatus, setCardStatus] = useState('idle');
  const [cardStatusMsg, setCardStatusMsg] = useState('');
  const [pendingPreset, setPendingPreset] = useState(null);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pendingIntent, setPendingIntent] = useState(null);

  useEffect(function () {
    if (isNew) { setFlash(true); const t = setTimeout(function () { setFlash(false); }, 5000); return function () { clearTimeout(t); }; }
  }, [isNew]);

  useEffect(function () {
    const unifiedPk = extPublicKey
      || (privyEmbeddedSol && privyEmbeddedSol.address ? (function () { try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; } })() : null);
    if (!unifiedPk || !connection || !token || !token.mint || !isValidMint(token.mint)) {
      setUserTokenBalance(0); setUserTokenDecimals(null); return undefined;
    }
    let cancelled = false;
    (async function () {
      try {
        const mintPk = new PublicKey(token.mint);
        const resp = await connection.getParsedTokenAccountsByOwner(unifiedPk, { mint: mintPk });
        if (cancelled) return;
        let total = 0; let dec = null;
        if (resp && resp.value) {
          resp.value.forEach(function (acc) {
            try {
              const info = acc.account.data.parsed.info;
              const ta = info && info.tokenAmount;
              if (ta) {
                if (dec == null && Number.isFinite(ta.decimals)) dec = ta.decimals;
                const ui = parseFloat(ta.uiAmountString || ta.uiAmount || 0);
                if (Number.isFinite(ui)) total += ui;
              }
            } catch (e) {}
          });
        }
        setUserTokenBalance(total);
        if (dec != null) setUserTokenDecimals(dec);
      } catch (e) {
        if (!cancelled) setUserTokenBalance(0);
      }
    })();
    return function () { cancelled = true; };
  }, [token, extPublicKey, privyEmbeddedSol, connection, refreshTick]);

  useEffect(function () {
    if (!nexusConnected || !pendingIntent) return undefined;
    const intent = pendingIntent;
    const t = setTimeout(function () {
      setPendingIntent(null);
      if (intent.kind === 'buy') handleQuickBuy({ stopPropagation: function () {} }, intent.usd);
      else if (intent.kind === 'sell') handleQuickSell({ stopPropagation: function () {} }, intent.pct);
    }, 200);
    return function () { clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nexusConnected, pendingIntent]);

  const progress = token.bondingProgress || 0;
  const isGrad = token.graduated || progress >= 100;
  const pct = token.pct1h != null ? token.pct1h : token.pct5m != null ? token.pct5m : null;
  const pctLabel = token.pct1h != null ? '1h' : '5m';

  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;
  const anyConnected = nexusConnected || solConnected;

  const unifiedPublicKey = extPublicKey
    || (privyEmbeddedSol && privyEmbeddedSol.address
      ? (function () { try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; } })()
      : null);

  function safeBuy(e) { e.stopPropagation(); if (!isValidMint(token.mint)) return; onBuyClick(token); }
  function safeSell(e) { e.stopPropagation(); if (!isValidMint(token.mint)) return; onSellClick(token); }
  function safeCardClick() { if (!isValidMint(token.mint)) return; onCardClick(token); }

  async function handleQuickBuy(e, usd) {
    e.stopPropagation();
    if (!isValidMint(token.mint)) return;
    if (!anyConnected) {
      setPendingIntent({ kind: 'buy', usd });
      if (loginPrivy) loginPrivy();
      else (onQuickBuy || onBuyClick)(token, usd);
      return;
    }
    const canTradeSol = isPrivy || solConnected;
    if (!canTradeSol) {
      setPendingIntent({ kind: 'buy', usd });
      if (loginPrivy) loginPrivy();
      else (onQuickBuy || onBuyClick)(token, usd);
      return;
    }
    if (!solPrice || solPrice <= 0) {
      setCardStatus('error'); setCardStatusMsg('No SOL price');
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); }, 2500);
      return;
    }
    if (!unifiedPublicKey) { (onQuickBuy || onBuyClick)(token, usd); return; }

    setPendingPreset('buy:' + usd);
    setCardStatus('loading');
    setCardStatusMsg(isPrivy ? 'Signing...' : 'Confirm in wallet...');
    try {
      const walletDescriptor = isPrivy
        ? { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true }
        : { kind: 'external', sendTransaction: extSolSendTx };
      const result = await quickBuyPump({
        mint: token.mint,
        usdAmount: usd,
        solPriceUsd: solPrice,
        publicKey: unifiedPublicKey,
        connection,
        wallet: walletDescriptor,
        onStatus: function (s) { setCardStatusMsg(s); },
      });
      setCardStatus('success'); setCardStatusMsg('Bought! ' + result.signature.slice(0, 8) + '...');
      setRefreshTick(function (t) { return t + 1; });
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); setPendingPreset(null); }, 4000);
    } catch (err) {
      const raw = (err && err.message) || 'Trade failed';
      const friendly = /reject|cancel|denied|user/i.test(raw)
        ? 'Cancelled'
        : (raw.length > 50 ? raw.slice(0, 50) + '...' : raw);
      setCardStatus('error'); setCardStatusMsg(friendly);
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); setPendingPreset(null); }, 4000);
    }
  }

  async function handleQuickSell(e, pctVal) {
    e.stopPropagation();
    if (!isValidMint(token.mint)) return;
    if (!anyConnected) {
      setPendingIntent({ kind: 'sell', pct: pctVal });
      if (loginPrivy) loginPrivy();
      else onSellClick(token);
      return;
    }
    const canTradeSol = isPrivy || solConnected;
    if (!canTradeSol) {
      setPendingIntent({ kind: 'sell', pct: pctVal });
      if (loginPrivy) loginPrivy();
      else onSellClick(token);
      return;
    }
    if (!userTokenBalance || userTokenBalance <= 0) {
      setCardStatus('error'); setCardStatusMsg('No balance');
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); }, 2500);
      return;
    }
    if (!unifiedPublicKey) { onSellClick(token); return; }

    setPendingPreset('sell:' + pctVal);
    setCardStatus('loading');
    setCardStatusMsg(isPrivy ? 'Signing...' : 'Confirm in wallet...');
    try {
      const walletDescriptor = isPrivy
        ? { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true }
        : { kind: 'external', sendTransaction: extSolSendTx };
      const result = await quickSellPump({
        mint: token.mint,
        tokenBalance: userTokenBalance,
        pct: pctVal,
        tokenPriceUsd: token.price || 0,
        solPriceUsd: solPrice,
        publicKey: unifiedPublicKey,
        connection,
        wallet: walletDescriptor,
        onStatus: function (s) { setCardStatusMsg(s); },
      });
      setCardStatus('success'); setCardStatusMsg('Sold! ' + result.signature.slice(0, 8) + '...');
      setRefreshTick(function (t) { return t + 1; });
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); setPendingPreset(null); }, 4000);
    } catch (err) {
      const raw = (err && err.message) || 'Trade failed';
      const friendly = /reject|cancel|denied|user/i.test(raw)
        ? 'Cancelled'
        : (raw.length > 50 ? raw.slice(0, 50) + '...' : raw);
      setCardStatus('error'); setCardStatusMsg(friendly);
      setTimeout(function () { setCardStatus('idle'); setCardStatusMsg(''); setPendingPreset(null); }, 4000);
    }
  }

  return (
    <div style={{ background: flash ? 'rgba(0,255,163,0.04)' : C.card, border: '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border), borderRadius: 14, padding: '12px 14px', marginBottom: 10, transition: 'background 0.8s, border 0.8s', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }} onClick={safeCardClick}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {token.image ? <img src={token.image} alt={token.symbol} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} onError={function (e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>{token.symbol ? token.symbol.charAt(0) : '?'}</div>}
          {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol || '???'}</span>
            {isGrad ? <span style={{ background: 'rgba(0,255,163,.1)', color: C.green, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>GRAD</span> : <span style={{ background: 'rgba(153,69,255,.1)', color: C.purple, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>PUMP</span>}
            {flash && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
            {token.marketCap > 0 && <span style={{ fontSize: 11, color: C.muted }}>{fmtMc(token.marketCap)}</span>}
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
            {token.buys24h > 0 && <span style={{ fontSize: 10, color: C.orange }}>{token.buys24h} buys</span>}
          </div>
          {!isGrad && progress > 0 && (
            <div style={{ marginTop: 5, height: 3, background: C.card3, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, width: Math.min(progress, 100) + '%', background: progress > 80 ? 'linear-gradient(90deg,#ff9500,#ff3b6b)' : 'linear-gradient(90deg,#00e5ff,#9945ff)' }} />
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {pct != null ? (
            <div style={{ background: pct >= 0 ? 'rgba(0,255,163,.12)' : 'rgba(59,158,255,.12)', border: '1px solid ' + (pct >= 0 ? 'rgba(0,255,163,.25)' : 'rgba(59,158,255,.25)'), borderRadius: 8, padding: '5px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: pctColor(pct) }}>{fmtPct(pct)}</div>
              <div style={{ fontSize: 9, color: C.muted2, marginTop: 1 }}>{pctLabel}</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.muted2 }}>-</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {cardBuyPresets.map(function (usd) {
          const isPending = pendingPreset === 'buy:' + usd;
          const disabled = cardStatus === 'loading' && !isPending;
          return (
            <button
              key={'b-' + usd}
              onClick={function (e) { handleQuickBuy(e, usd); }}
              disabled={disabled}
              style={{
                flex: 1, padding: '10px 4px', borderRadius: 10, border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
                color: C.bg, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif',
                opacity: disabled ? 0.4 : 1,
                touchAction: 'manipulation',
              }}
            >
              {isPending ? '...' : '$' + usd}
            </button>
          );
        })}
        {(function () {
          const isPending = pendingPreset && pendingPreset.indexOf('sell:') === 0;
          const disabled = cardStatus === 'loading' && !isPending;
          const sellHandler = function (e) {
            if ((isPrivy || solConnected) && userTokenBalance > 0) {
              handleQuickSell(e, 100);
            } else {
              safeSell(e);
            }
          };
          return (
            <button
              onClick={sellHandler}
              disabled={disabled}
              style={{
                flex: 1, padding: '10px 4px', borderRadius: 10,
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: isPending ? 'linear-gradient(135deg,#ff3b6b,#cc1144)' : 'rgba(255,59,107,.1)',
                border: '1.5px solid rgba(255,59,107,.35)',
                color: isPending ? '#fff' : C.red,
                fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif',
                opacity: disabled ? 0.4 : 1,
                touchAction: 'manipulation',
              }}
            >
              {isPending ? '...' : ((isPrivy || solConnected) && userTokenBalance > 0 ? 'Sell MAX' : 'Sell')}
            </button>
          );
        })()}
      </div>
      {cardStatus !== 'idle' && cardStatusMsg && (
        <div style={{
          marginTop: 6, fontSize: 10, fontWeight: 700, textAlign: 'center',
          color: cardStatus === 'error' ? C.red : cardStatus === 'success' ? C.green : C.muted,
        }}>
          {cardStatusMsg}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * MAIN COMPONENT -- live feed of new launches
 *
 * Live: PumpPortal WS (subscribeNewToken)
 * Initial: Jupiter v2 /tokens/v2/recent
 * Refresh: Jupiter v2 search per mint, batched, every 15s
 * ========================================================================= */
export default function NewLaunches({ coins, jupiterTokens, onConnectWallet, isConnected, isSolanaConnected, walletAddress, resetKey }) {
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
  const refreshTimerRef = useRef(null);

  const solCoin = coins && coins.find(function (c) { return c.id === 'solana' || c.symbol === 'SOL'; });
  const solPrice = solCoin ? solCoin.current_price : 150;

  useEffect(function () { setSelectedToken(null); }, [resetKey]);

  const handlePresetsChange = function (p) { setPresets(p); savePresets(p); };

  const updateTokenData = useCallback(function (dataMap) {
    let updated = false;
    tokensRef.current = tokensRef.current.map(function (t) {
      const d = dataMap[t.mint];
      if (!d) return t;
      updated = true;
      return Object.assign({}, t, d, { mint: t.mint });
    });
    if (updated) setTokens([].concat(tokensRef.current));
  }, []);

  const addToken = useCallback(function (token) {
    if (!isValidMint(token && token.mint)) return;
    tokensRef.current = [token].concat(tokensRef.current.filter(function (t) { return t.mint !== token.mint; })).slice(0, 150);
    setTokens([].concat(tokensRef.current));
  }, []);

  /* -------------------------------------------------------------------- */
  /* Initial load + WebSocket + periodic refresh                          */
  /* -------------------------------------------------------------------- */
  useEffect(function () {
    let alive = true;
    let ws = null;
    let reconnectTimer = null;
    const pendingTimers = new Set();

    function track(t) { pendingTimers.add(t); return t; }

    /* --- Cached tokens (instant paint) --- */
    const cached = loadCachedTokens().filter(function (t) { return isValidMint(t && t.mint); });
    if (cached.length > 0) {
      tokensRef.current = cached;
      setTokens([].concat(cached));
    }

    /* --- Initial fresh fetch from Jupiter v2 recent --- */
    fetchRecentLaunches().then(function (recent) {
      if (!alive) return;
      if (recent && recent.length) {
        // Merge: prefer Jupiter data, keep cached entries that aren't replaced.
        const byMint = {};
        tokensRef.current.forEach(function (t) { byMint[t.mint] = t; });
        recent.forEach(function (t) { byMint[t.mint] = t; });
        tokensRef.current = Object.values(byMint).slice(0, 150);
        setTokens([].concat(tokensRef.current));
        saveCachedTokens(tokensRef.current);
      }
    });

    /* --- PumpPortal WebSocket: live new-token feed --- */
    function connectWS() {
      if (!alive) return;
      try {
        ws = new WebSocket(PUMPPORTAL_WS);
        ws.onopen = function () {
          setWsStatus('live');
          // Subscribe to new pump.fun token creations
          try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); } catch (e) {}
        };
        ws.onmessage = function (event) {
          try {
            const msg = JSON.parse(event.data);
            // PumpPortal new-token event shape:
            //   { txType: 'create', mint, symbol, name, uri, marketCapSol,
            //     vSolInBondingCurve, vTokensInBondingCurve, signature, ... }
            if (!msg || msg.txType !== 'create' || !isValidMint(msg.mint)) return;
            if (tokensRef.current.find(function (t) { return t.mint === msg.mint; })) return;

            const sol = solPrice || 150;
            const mcUsd = (msg.marketCapSol || 0) * sol;
            const priceUsd = (msg.vTokensInBondingCurve && msg.vSolInBondingCurve)
              ? (msg.vSolInBondingCurve / msg.vTokensInBondingCurve) * sol
              : 0;

            const token = {
              mint: msg.mint,
              symbol: msg.symbol || msg.mint.slice(0, 4).toUpperCase(),
              name: msg.name || 'Unknown Token',
              image: null, // resolved later via Jupiter v2 search
              decimals: 6,
              price: priceUsd,
              marketCap: mcUsd,
              pct5m: null, pct1h: null, pct24h: null,
              volume24h: 0, buys24h: 0,
              priceHistory: priceUsd > 0 ? [priceUsd] : [],
              bondingProgress: 0, graduated: false,
              createdAt: Date.now(),
            };

            setNewMints(function (prev) {
              const next = new Set(prev);
              next.add(msg.mint);
              const t2 = setTimeout(function () {
                pendingTimers.delete(t2);
                if (!alive) return;
                setNewMints(function (p) { const n = new Set(p); n.delete(msg.mint); return n; });
              }, 6000);
              track(t2);
              return next;
            });
            addToken(token);

            /* Backfill richer metadata (image, audit) via Jupiter v2 search */
            const t1 = setTimeout(function () {
              pendingTimers.delete(t1);
              if (!alive) return;
              fetchJupiterBatch([msg.mint]).then(function (m) {
                if (!alive) return;
                if (m && m[msg.mint]) updateTokenData(m);
              });
            }, 1500);
            track(t1);
          } catch (e) {}
        };
        ws.onerror = function () { setWsStatus('error'); };
        ws.onclose = function () {
          setWsStatus('reconnecting');
          if (!alive) return;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(function () { reconnectTimer = null; connectWS(); }, 3000);
        };
      } catch (e) {
        setWsStatus('error');
        if (alive) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(function () { reconnectTimer = null; connectWS(); }, 5000);
        }
      }
    }
    connectWS();

    /* --- Periodic Jupiter refresh of top tracked tokens --- */
    refreshTimerRef.current = setInterval(async function () {
      if (!alive) return;
      const mints = tokensRef.current.slice(0, 30).map(function (t) { return t.mint; }).filter(isValidMint);
      if (!mints.length) return;
      const prevByMint = {};
      tokensRef.current.forEach(function (t) { prevByMint[t.mint] = t; });
      const data = await fetchJupiterBatch(mints, prevByMint);
      if (!alive) return;
      updateTokenData(data);
      saveCachedTokens(tokensRef.current);
    }, 15000);

    return function () {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      pendingTimers.forEach(function (t) { try { clearTimeout(t); } catch (e) {} });
      pendingTimers.clear();
      if (ws) {
        try { ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch (e) {}
      }
    };
    // solPrice intentionally excluded; we don't want to reconnect WS when price ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToken, updateTokenData]);

  const displayTokens = tokens.slice().sort(function (a, b) {
    if (tab === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
    const scoreA = (a.volume24h || 0) + (a.buys24h || 0) * 10 + Math.abs(a.pct1h || a.pct5m || 0) * 100;
    const scoreB = (b.volume24h || 0) + (b.buys24h || 0) * 10 + Math.abs(b.pct1h || b.pct5m || 0) * 100;
    return scoreB - scoreA;
  });

  const openBuyDrawer = function (token, presetUsd) {
    if (!isValidMint(token && token.mint)) return;
    setDrawerToken(token); setDrawerMode('buy');
    setDrawerPresetUsd(Number.isFinite(presetUsd) && presetUsd > 0 ? presetUsd : null);
    setDrawerOpen(true);
  };
  const openSellDrawer = function (token) {
    if (!isValidMint(token && token.mint)) return;
    setDrawerToken(token); setDrawerMode('sell');
    setDrawerPresetUsd(null);
    setDrawerOpen(true);
  };

  if (selectedToken) {
    return <TokenPage token={selectedToken} onBack={function () { setSelectedToken(null); }} onConnectWallet={onConnectWallet} isConnected={isConnected} solPrice={solPrice} coins={coins} jupiterTokens={jupiterTokens} presets={presets} onPresetsChange={handlePresetsChange} />;
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'), borderRadius: 20, padding: '3px 10px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>{wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}</span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked - tap any to trade</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <button onClick={function () { setTab('new'); }} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'new' ? 'rgba(0,229,255,.1)' : C.card2, border: '1px solid ' + (tab === 'new' ? 'rgba(0,229,255,.3)' : C.border), color: tab === 'new' ? C.accent : C.muted }}>New</button>
        <button onClick={function () { setTab('trending'); }} style={{ flex: 1, padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: tab === 'trending' ? 'rgba(255,149,0,.1)' : C.card2, border: '1px solid ' + (tab === 'trending' ? 'rgba(255,149,0,.3)' : C.border), color: tab === 'trending' ? C.orange : C.muted }}>Trending</button>
        <PresetsEditButton size={42} label="Customize instant buy amounts" />
      </div>

      {tokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, border: '1px solid ' + C.border, borderRadius: 16 }}>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>{wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting to live feed...'}</div>
          <div style={{ color: C.muted2, fontSize: 11 }}>Tokens appear here as they launch on Solana</div>
        </div>
      ) : (
        displayTokens.map(function (token) {
          return <TokenCard key={token.mint} token={token} onCardClick={setSelectedToken} onBuyClick={openBuyDrawer} onSellClick={openSellDrawer} onQuickBuy={openBuyDrawer} isNew={newMints.has(token.mint)} solPrice={solPrice} />;
        })
      )}

      <LaunchTradeDrawer
        open={drawerOpen} onClose={function () { setDrawerOpen(false); }}
        mode={drawerMode} token={drawerToken} solPrice={solPrice}
        onConnectWallet={onConnectWallet} isConnected={isConnected}
        coins={coins} jupiterTokens={jupiterTokens}
        presets={presets} onPresetsChange={handlePresetsChange}
        presetUsd={drawerPresetUsd}
      />
    </div>
  );
}
