/**
 * NEXUS DEX -- NewLaunches
 * 
 * Live feed of newly-launched Solana pump.fun tokens via PumpPortal WebSocket.
 * Instant display with bonding curve price. No polling.
 * Trades: pumpTrade.js -> /api/pumpportal/trade-local
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey } from '@solana/web3.js';
import { quickBuyPump, quickSellPump, PLATFORM_FEE_RATE } from '../pumpTrade.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const MAX_TOKENS = 100;

const C = {
  card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  down: '#3b9eff', orange: '#ff9500', purple: '#9945ff',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function isValidMint(s) {
  return !!(s && typeof s === 'string' && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s));
}
function timeAgo(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  return Math.floor(d / 3600) + 'h';
}
function fmtMc(n) {
  if (!n) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function fmtPrice(n) {
  if (!n) return '-';
  if (n < 0.000001) return '$' + n.toExponential(2);
  if (n < 0.001) return '$' + n.toFixed(7);
  if (n < 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

/* ============================================================================
 * TokenCard — instant buy/sell, clean display
 * ========================================================================= */
function TokenCard({ token, onCardClick, onBuyClick, onSellClick, isNew }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (isNew) { setFlash(true); const t = setTimeout(() => setFlash(false), 5000); return () => clearTimeout(t); }
  }, [isNew]);

  return (
    <div onClick={() => onCardClick(token)} style={{
      background: flash ? 'rgba(0,255,163,0.04)' : C.card,
      border: '1px solid ' + (flash ? 'rgba(0,255,163,.2)' : C.border),
      borderRadius: 14, padding: 12, marginBottom: 10, cursor: 'pointer',
      width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(153,69,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.purple }}>{token.symbol?.charAt(0) || '?'}</div>
          {flash && <div style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: C.green, boxShadow: '0 0 8px ' + C.green }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{token.symbol}</span>
            {flash && <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>NEW</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
            {token.price > 0 && <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{fmtPrice(token.price)}</span>}
            {token.marketCap > 0 && <span style={{ fontSize: 11, color: C.muted }}>{fmtMc(token.marketCap)}</span>}
            <span style={{ fontSize: 10, color: C.muted2 }}>{timeAgo(token.createdAt)}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={e => { e.stopPropagation(); onBuyClick(token, 25); }} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.card, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}>$25</button>
        <button onClick={e => { e.stopPropagation(); onBuyClick(token, 100); }} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.card, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}>$100</button>
        <button onClick={e => { e.stopPropagation(); onBuyClick(token, 500); }} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.card, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}>$500</button>
        <button onClick={e => { e.stopPropagation(); onSellClick(token); }} style={{ flex: 1, padding: 10, borderRadius: 10, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1.5px solid rgba(255,59,107,.3)', color: C.red, fontWeight: 800, fontSize: 13, fontFamily: 'Syne, sans-serif' }}>Sell</button>
      </div>
    </div>
  );
}

/* ============================================================================
 * PumpDrawer — buy/sell drawer with fee, anti-MEV, presets
 * ========================================================================= */
function PumpDrawer({ open, onClose, mode, token, solPrice, onConnectWallet, presets, presetUsd }) {
  const { publicKey: extPk, signTransaction, sendTransaction, connected: solCon } = useWallet();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();
  const { connection } = useConnection();

  const pubkey = useMemo(() => {
    if (extPk) return extPk;
    if (privyEmbeddedSol?.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } }
    return null;
  }, [extPk, privyEmbeddedSol]);

  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;
  const wcon = solCon || isPrivy;

  const [activePreset, setActivePreset] = useState(null);
  const [customAmt, setCustomAmt] = useState('');
  const [sellPct, setSellPct] = useState(50);
  const [customSellAmt, setCustomSellAmt] = useState('');
  const [solBal, setSolBal] = useState(null);
  const [tokBal, setTokBal] = useState(null);
  const [antiMev, setAntiMev] = useState(true);
  const [status, setStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !pubkey || !connection) { setSolBal(null); setTokBal(null); return; }
    let c = false;
    connection.getBalance(pubkey).then(l => { if (!c) setSolBal(l / 1e9); }).catch(() => {});
    if (token && isValidMint(token.mint)) {
      try {
        const mpk = new PublicKey(token.mint);
        connection.getParsedTokenAccountsByOwner(pubkey, { mint: mpk }).then(a => {
          if (c) return;
          let t = 0;
          a?.value?.forEach(x => { try { t += parseFloat(x.account.data.parsed.info.tokenAmount.uiAmountString || 0); } catch {} });
          setTokBal(t);
        }).catch(() => { if (!c) setTokBal(0); });
      } catch {}
    }
    return () => { c = true; };
  }, [open, pubkey, connection, token]);

  const prev = useRef(false);
  useEffect(() => {
    if (open && !prev.current) {
      const last = presetUsd && presetUsd > 0 ? presetUsd : 25;
      const m = presets.find(p => p === last);
      if (m) { setActivePreset(last); setCustomAmt(''); }
      else { setActivePreset(null); setCustomAmt(String(last)); }
      setStatus('idle'); setTxSig(null); setError(''); setCustomSellAmt('');
    }
    prev.current = open;
  }, [open, presets, presetUsd]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const po = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = po; };
  }, [open]);

  const activeDollar = parseFloat(customAmt) || activePreset || 25;
  const isBuy = mode === 'buy';

  const exec = async () => {
    if (!wcon) { loginPrivy ? loginPrivy() : onConnectWallet?.(); return; }
    if (!pubkey || !token?.mint || !solPrice) { setError('Connect wallet and try again'); return; }
    setStatus('loading'); setError('');
    try {
      const w = isPrivy ? { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true } : { kind: 'external', signTransaction, sendTransaction };
      let r;
      if (isBuy) {
        if (!activeDollar) throw new Error('Enter amount');
        r = await quickBuyPump({ mint: token.mint, usdAmount: activeDollar, solPriceUsd: solPrice, publicKey: pubkey, connection, wallet: w, antiMev, onStatus: () => {} });
      } else {
        const amt = customSellAmt ? parseFloat(customSellAmt) : (sellPct / 100 * (tokBal || 0));
        if (!amt || amt <= 0) throw new Error('No balance');
        r = await quickSellPump({ mint: token.mint, tokenBalance: amt, pct: 100, tokenPriceUsd: token.price || 0, solPriceUsd: solPrice, publicKey: pubkey, connection, wallet: w, antiMev, onStatus: () => {} });
      }
      setTxSig(r.signature); setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 3000);
    } catch (e) {
      setError(/reject|cancel|denied/i.test(e.message || '') ? 'Cancelled' : (e.message || 'Failed'));
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  if (!open || !token) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 560, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: 'min(90vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><div style={{ color: isBuy ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>{isBuy ? 'Buy' : 'Sell'} {token.symbol}</div><div style={{ color: C.muted, fontSize: 11 }}>{(PLATFORM_FEE_RATE * 100).toFixed(0)}% fee included</div></div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer' }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 24px)' }}>
          {!wcon && <div style={{ marginBottom: 14, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: C.muted, fontSize: 13 }}>Connect to trade</span><button onClick={() => loginPrivy ? loginPrivy() : onConnectWallet?.()} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Connect</button></div>}
          {isBuy ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>AMOUNT (USD)</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>{presets.map(a => <button key={a} onClick={() => { setActivePreset(a); setCustomAmt(''); }} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid ' + (activePreset === a && !customAmt ? C.accent : C.border), background: activePreset === a && !customAmt ? 'rgba(0,229,255,.15)' : C.card2, color: activePreset === a && !customAmt ? C.accent : C.muted, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>${a}</button>)}</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: C.muted, fontSize: 22 }}>$</span><input value={customAmt} onChange={e => { setCustomAmt(e.target.value.replace(/[^0-9.]/g, '')); setActivePreset(null); }} placeholder="Custom" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none' }} />{solPrice > 0 && activeDollar > 0 && <span style={{ color: C.muted, fontSize: 12 }}>~{(activeDollar / solPrice).toFixed(4)} SOL</span>}</div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>SELL AMOUNT</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>{[25, 50, 75, 100].map(p => <button key={p} onClick={() => { setSellPct(p); setCustomSellAmt(''); }} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid ' + (sellPct === p && !customSellAmt ? C.red : C.border), background: sellPct === p && !customSellAmt ? 'rgba(255,59,107,.15)' : C.card2, color: sellPct === p && !customSellAmt ? C.red : C.muted, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>{p === 100 ? 'MAX' : p + '%'}</button>)}</div>
              <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}><input value={customSellAmt} onChange={e => { setCustomSellAmt(e.target.value.replace(/[^0-9.]/g, '')); setSellPct(null); }} placeholder="Custom" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none' }} /><span style={{ color: C.muted, fontSize: 13 }}>{token.symbol}</span></div>
            </div>
          )}
          <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Anti-MEV</div><div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted }}>{antiMev ? 'ON' : 'OFF'}</div></div><button onClick={() => setAntiMev(!antiMev)} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, position: 'relative' }}><div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3 }} /></button></div>
          {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: C.red }}>{error}</div>}
          <button onClick={exec} disabled={status === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : !wcon ? 'linear-gradient(135deg,#9945ff,#7c3aed)' : isBuy ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#ff3b6b,#cc1144)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17, cursor: status === 'loading' ? 'not-allowed' : 'pointer' }}>{!wcon ? 'Connect Wallet' : status === 'loading' ? 'Confirming...' : status === 'success' ? 'Done!' : isBuy ? 'Buy ' + token.symbol : 'Sell ' + token.symbol}</button>
          {txSig && <a href={'https://solscan.io/tx/' + txSig} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View on Solscan</a>}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * MAIN
 * ========================================================================= */
export default function NewLaunches({ coins, onConnectWallet, resetKey }) {
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [drawerToken, setDrawerToken] = useState(null);
  const [drawerPresetUsd, setDrawerPresetUsd] = useState(null);
  const [newMints, setNewMints] = useState(new Set());
  const [wsStatus, setWsStatus] = useState('connecting');
  const [presets, setPresets] = useState(() => { try { return JSON.parse(localStorage.getItem('nexus_launch_presets') || '[5,10,25,50,100]'); } catch { return [5,10,25,50,100]; } });

  const tokensRef = useRef([]);
  const solPrice = useMemo(() => { const c = coins?.find(x => x?.id === 'solana' || x?.symbol === 'SOL'); return c && Number(c.current_price) > 0 ? Number(c.current_price) : 0; }, [coins]);

  useEffect(() => { setSelectedToken(null); }, [resetKey]);

  const handlePresetsChange = p => { setPresets(p); try { localStorage.setItem('nexus_launch_presets', JSON.stringify(p)); } catch {} };

  useEffect(() => {
    let alive = true, ws = null, reconnectTimer = null;
    const timers = new Set();

    function connect() {
      if (!alive) return;
      try {
        ws = new WebSocket(PUMPPORTAL_WS);
        ws.onopen = () => { setWsStatus('live'); ws.send(JSON.stringify({ method: 'subscribeNewToken' })); };
        ws.onmessage = e => {
          try {
            const msg = JSON.parse(e.data);
            if (!msg || msg.txType !== 'create' || !isValidMint(msg.mint)) return;
            if (tokensRef.current.find(t => t.mint === msg.mint)) return;

            const sol = solPrice || 0;
            const mcUsd = sol > 0 ? (Number(msg.marketCapSol) || 0) * sol : 0;
            const vTok = Number(msg.vTokensInBondingCurve) || 0;
            const vSol = Number(msg.vSolInBondingCurve) || 0;
            const priceUsd = (sol > 0 && vTok > 0) ? (vSol / vTok) * sol : 0;

            const token = {
              mint: msg.mint,
              symbol: msg.symbol || msg.mint.slice(0, 4).toUpperCase(),
              name: msg.name || 'Unknown',
              image: null,
              decimals: 6,
              price: priceUsd,
              marketCap: mcUsd,
              volume24h: 0, buys24h: 0, sells24h: 0,
              bondingProgress: 0, graduated: false,
              createdAt: Date.now(),
            };

            tokensRef.current = [token].concat(tokensRef.current.filter(t => t.mint !== msg.mint)).slice(0, MAX_TOKENS);
            setTokens([].concat(tokensRef.current));

            setNewMints(p => { const n = new Set(p); n.add(msg.mint); return n; });
            const t = setTimeout(() => { timers.delete(t); if (alive) setNewMints(p => { const n = new Set(p); n.delete(msg.mint); return n; }); }, 6000);
            timers.add(t);
          } catch {}
        };
        ws.onerror = () => setWsStatus('error');
        ws.onclose = () => { setWsStatus('reconnecting'); if (!alive) return; if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000); };
      } catch { setWsStatus('error'); if (alive) { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5000); } }
    }

    connect();
    return () => { alive = false; if (reconnectTimer) clearTimeout(reconnectTimer); timers.forEach(t => clearTimeout(t)); if (ws) { try { ws.close(); } catch {} } };
  }, [solPrice]);

  const openBuyDrawer = (token, usd) => { if (!isValidMint(token?.mint)) return; setDrawerToken(token); setDrawerMode('buy'); setDrawerPresetUsd(usd && usd > 0 ? usd : null); setDrawerOpen(true); };
  const openSellDrawer = token => { if (!isValidMint(token?.mint)) return; setDrawerToken(token); setDrawerMode('sell'); setDrawerPresetUsd(null); setDrawerOpen(true); };

  if (selectedToken) return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={() => setSelectedToken(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 20, padding: 0, fontFamily: 'Syne, sans-serif' }}>&larr; Back</button>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(153,69,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: C.purple }}>{selectedToken.symbol?.charAt(0) || '?'}</div>
            <div><div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>{selectedToken.symbol}</div><div style={{ color: C.muted, fontSize: 12 }}>{selectedToken.name}</div></div>
          </div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{fmtPrice(selectedToken.price)}</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[['Mkt Cap', fmtMc(selectedToken.marketCap)], ['Age', timeAgo(selectedToken.createdAt)]].map(([l, v]) => <div key={l} style={{ background: C.card2, borderRadius: 10, padding: 12 }}><div style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{v}</div></div>)}
        </div>
        <div style={{ background: C.card3, borderRadius: 10, padding: '8px 12px' }}><div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>CONTRACT</div><div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all' }}>{selectedToken.mint}</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button onClick={() => { setDrawerMode('buy'); setDrawerOpen(true); }} style={{ padding: 18, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.card, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18 }}>Buy</button>
        <button onClick={() => { setDrawerMode('sell'); setDrawerOpen(true); }} style={{ padding: 18, borderRadius: 16, cursor: 'pointer', background: 'rgba(255,59,107,.1)', border: '1.5px solid rgba(255,59,107,.4)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18 }}>Sell</button>
      </div>
      <PumpDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} mode={drawerMode} token={selectedToken} solPrice={solPrice} onConnectWallet={onConnectWallet} presets={presets} presetUsd={drawerPresetUsd} />
    </div>
  );

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>New Launches</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: wsStatus === 'live' ? 'rgba(0,255,163,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (wsStatus === 'live' ? 'rgba(0,255,163,.2)' : 'rgba(255,149,0,.2)'), borderRadius: 20, padding: '3px 10px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: wsStatus === 'live' ? C.green : C.orange, animation: wsStatus === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontSize: 10, color: wsStatus === 'live' ? C.green : C.orange, fontWeight: 600 }}>{wsStatus === 'live' ? 'LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}</span>
          </div>
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>{tokens.length} tokens tracked</p>
      </div>
      {tokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: C.card, border: '1px solid ' + C.border, borderRadius: 16, color: C.muted, fontSize: 14 }}>{wsStatus === 'live' ? 'Waiting for new launches...' : 'Connecting...'}</div>
      ) : (
        tokens.map(t => <TokenCard key={t.mint} token={t} onCardClick={setSelectedToken} onBuyClick={openBuyDrawer} onSellClick={openSellDrawer} isNew={newMints.has(t.mint)} />)
      )}
      <PumpDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} mode={drawerMode} token={drawerToken} solPrice={solPrice} onConnectWallet={onConnectWallet} presets={presets} presetUsd={drawerPresetUsd} />
    </div>
  );
}
