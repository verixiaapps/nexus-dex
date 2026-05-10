import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TradeDrawer } from './SwapWidget.jsx';
import InstantTrade from './InstantTrade.jsx';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  const v = Number(n);
  d = d != null ? d : (v >= 1000 ? 2 : v >= 1 ? 4 : 8);
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(d);
  if (v > 0) return '$' + v.toFixed(6);
  return '$0.00';
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

// OKX price cache
const _priceCache = {};
async function fetchOkxPrice(mint) {
  if (!mint) return 0;
  const key = mint.toLowerCase();
  if (_priceCache[key] && Date.now() - _priceCache[key].ts < 60000) return _priceCache[key].price;
  const knownStable = { 'epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v': 1, 'es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb': 1 };
  if (knownStable[key]) { _priceCache[key] = { price: 1, ts: Date.now() }; return 1; }
  if (mint === 'So11111111111111111111111111111111111111112') {
    try {
      const r = await fetch('/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=So11111111111111111111111111111111111111112&toTokenAddress=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000');
      const j = await r.json();
      if (j.code === '0' && j.data) { const d = Array.isArray(j.data) ? j.data[0] : j.data; const price = Number(d.toTokenAmount) / 1e9; if (price > 0) { _priceCache[key] = { price, ts: Date.now() }; return price; } }
    } catch {}
    return 0;
  }
  try {
    const r = await fetch(`/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${mint}&toTokenAddress=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000`);
    const j = await r.json();
    if (j.code === '0' && j.data) { const d = Array.isArray(j.data) ? j.data[0] : j.data; const price = Number(d.toTokenAmount) / 1e6; if (price > 0) { _priceCache[key] = { price, ts: Date.now() }; return price; } }
  } catch {}
  return 0;
}

export default function TokenDetail({ coin, onBack, onConnectWallet }) {
  const { presets, setPresets } = useNexusWallet();
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();

  const [loading, setLoading] = useState(true);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [tradeRefreshTick, setTradeRefreshTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  // Build token data from coin prop + OKX price
  const td = useMemo(() => {
    if (!coin) return null;
    return {
      chain: 'solana',
      mint: coin.mint,
      symbol: coin.symbol || '???',
      name: coin.name || coin.symbol || 'Unknown',
      decimals: coin.decimals || 6,
      logoURI: coin.logoURI || coin.image || null,
      image: coin.logoURI || coin.image || null,
      current_price: coin.current_price || 0,
      price_change_percentage_24h: coin.price_change_percentage_24h || null,
      market_cap: coin.market_cap || 0,
      total_volume: coin.total_volume || 0,
      liquidity: coin.liquidity || 0,
    };
  }, [coin]);

  const sym = (td?.symbol || '???').toUpperCase();
  const price = td?.current_price || 0;
  const change = td?.price_change_percentage_24h;

  // SOL price
  const solPriceUsd = useMemo(() => {
    if (coin?.solPriceUsd && coin.solPriceUsd > 0) return coin.solPriceUsd;
    if (coin?.current_price && coin?.symbol === 'SOL') return coin.current_price;
    return 0;
  }, [coin]);

  // Fetch live price from OKX on mount
  useEffect(() => {
    if (!td?.mint) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchOkxPrice(td.mint).then(p => {
      if (!cancelled && p > 0) {
        // Update the price in the token data
        td.current_price = p;
      }
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [td?.mint]);

  // Fetch user balance
  useEffect(() => {
    if (!td?.mint || !solConnected || !publicKey || !connection) {
      setUserTokenBalance(0); setUserTokenDecimals(null); return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mintPk = new PublicKey(td.mint);
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk });
        if (cancelled) return;
        let total = 0, dec = null;
        if (resp?.value) {
          resp.value.forEach(acc => {
            try {
              const info = acc.account.data.parsed.info;
              const ta = info?.tokenAmount;
              if (ta) { if (dec == null) dec = Number(ta.decimals); total += parseFloat(ta.uiAmountString || ta.uiAmount || 0); }
            } catch {}
          });
        }
        setUserTokenBalance(total);
        if (dec != null) setUserTokenDecimals(dec);
      } catch { if (!cancelled) { setUserTokenBalance(0); setUserTokenDecimals(null); } }
    })();
    return () => { cancelled = true; };
  }, [td?.mint, solConnected, publicKey, connection, tradeRefreshTick]);

  const openDrawer = useCallback((mode) => { setDrawerMode(mode); setDrawerOpen(true); }, []);
  const closeDrawer = useCallback(() => { setDrawerOpen(false); }, []);

  if (loading && !td) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button>
        <div style={{ fontSize: 16 }}>Loading token data...</div>
      </div>
    );
  }

  if (!td) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Token not found</div>
        <div style={{ fontSize: 12, color: C.muted2 }}>No data for this token.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: 'Syne, sans-serif' }}>← Back to Markets</button>

      {/* Header Card */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {td.image
              ? <img src={td.image} alt={sym} style={{ width: 48, height: 48, borderRadius: '50%' }} />
              : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{sym.charAt(0)}</div>}
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{td.name || sym}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sym}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(price)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: (change || 0) >= 0 ? C.green : C.red, marginTop: 2 }}>{pct(change)} (24H)</div>
          </div>
        </div>
      </div>

      {/* Instant Trade */}
      <div style={{ marginBottom: 12 }}>
        <InstantTrade
          token={td}
          solPrice={solPriceUsd}
          tokenBalance={userTokenBalance}
          tokenDecimals={userTokenDecimals}
          onConnectWallet={onConnectWallet}
          onOpenDrawer={(mode, opts) => { setDrawerMode(mode); setDrawerOpen(true); }}
          onTradeComplete={() => setTradeRefreshTick(t => t + 1)}
        />
      </div>

      {/* Buy / Sell Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={() => openDrawer('buy')}
          style={{ padding: 18, borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>
          Buy {sym}
        </button>
        <button onClick={() => openDrawer('sell')}
          style={{ padding: 18, borderRadius: 14, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>
          Sell {sym}
        </button>
      </div>

      {/* Contract */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SOLANA CONTRACT</div>
        <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{td.mint}</div>
      </div>

      <TradeDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        mode={drawerMode}
        coin={td}
        onConnectWallet={onConnectWallet}
        presets={presets}
        onPresetsChange={setPresets}
      />
    </div>
  );
}