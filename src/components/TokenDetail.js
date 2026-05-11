import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TradeDrawer } from './SwapWidget.jsx';
import InstantTrade from './InstantTrade.jsx';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

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
  if (n == null || !Number.isFinite(Number(n))) return '-';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// Fetch token info + price from OKX market endpoints
async function fetchTokenData(mint) {
  if (!mint) return null;

  try {
    // 1. Price info (POST)
    const priceRes = await fetch('/api/okx/dex/market/price-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainIndex: '501', tokenContractAddressList: [mint] }),
    });
    const priceJson = await priceRes.json();
    console.log('price-info single response:', JSON.stringify(priceJson));
    let currentPrice = 0;
    let high24h = 0, low24h = 0, marketCap = 0, volume24h = 0;
    if (priceJson.code === '0' && priceJson.data) {
      const d = Array.isArray(priceJson.data) ? priceJson.data[0] : priceJson.data;
      currentPrice = Number(d.price || d.last || d.usdPrice || 0);
      high24h = Number(d.high24h || d.high || 0);
      low24h = Number(d.low24h || d.low || 0);
      marketCap = Number(d.marketCap || d.mcap || 0);
      volume24h = Number(d.volume24h || d.volume || 0);
    }

    // 2. 7-day candles for chart (GET)
    let chartData = [];
    let change7d = 0;
    try {
      const candleRes = await fetch(`/api/okx/dex/market/candles?chainIndex=501&tokenContractAddress=${mint}&bar=1d&limit=7`);
      const candleJson = await candleRes.json();
      console.log('candles response:', JSON.stringify(candleJson));
      if (candleJson.code === '0' && Array.isArray(candleJson.data) && candleJson.data.length > 0) {
        const candles = candleJson.data.sort((a, b) => (a.ts || a.t || 0) - (b.ts || b.t || 0));
        chartData = candles.map(c => ({
          time: new Date((c.ts || c.t || 0)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: parseFloat(c.c || c.close || 0),
        }));
        const firstPrice = parseFloat(candles[0].o || candles[0].open || 0);
        const lastPrice = parseFloat(candles[candles.length - 1].c || candles[candles.length - 1].close || 0);
        if (firstPrice > 0) change7d = ((lastPrice - firstPrice) / firstPrice) * 100;
      }
    } catch(e) {
      console.log('candles error:', e.message);
    }

    return { currentPrice, high24h, low24h, marketCap, volume24h, chartData, change7d };
  } catch(e) {
    console.log('fetchTokenData error:', e.message);
    return null;
  }
}

export default function TokenDetail({ coin, onBack, onConnectWallet }) {
  const { presets, setPresets } = useNexusWallet();
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();

  const [tokenInfo, setTokenInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [tradeRefreshTick, setTradeRefreshTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

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
      current_price: tokenInfo?.currentPrice || coin?.current_price || 0,
    };
  }, [coin, tokenInfo]);

  const sym = (td?.symbol || '???').toUpperCase();
  const price = td?.current_price || 0;
  const change7d = tokenInfo?.change7d || 0;
  const isUp = change7d >= 0;
  const chartColor = isUp ? C.green : C.red;

  const solPriceUsd = useMemo(() => {
    if (coin?.solPriceUsd && coin.solPriceUsd > 0) return coin.solPriceUsd;
    if (coin?.current_price && coin?.symbol === 'SOL') return coin.current_price;
    return 0;
  }, [coin]);

  // Fetch all token data
  useEffect(() => {
    if (!td?.mint) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchTokenData(td.mint).then(data => {
      if (!cancelled && data) setTokenInfo(data);
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
            try { const info = acc.account.data.parsed.info; const ta = info?.tokenAmount; if (ta) { if (dec == null) dec = Number(ta.decimals); total += parseFloat(ta.uiAmountString || ta.uiAmount || 0); } } catch {}
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
    return (<div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}><button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button><div style={{ fontSize: 16 }}>Loading...</div></div>);
  }

  if (!td) {
    return (<div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}><button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button><div style={{ fontSize: 16, marginBottom: 8 }}>Token not found</div></div>);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: 'Syne, sans-serif' }}>← Back to Markets</button>

      {/* Header Card */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {td.image ? <img src={td.image} alt={sym} style={{ width: 48, height: 48, borderRadius: '50%' }} onError={e => e.currentTarget.style.display = 'none'} /> : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{sym.charAt(0)}</div>}
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{td.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sym}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(price)}</div>
            {change7d !== 0 && <div style={{ fontSize: 13, fontWeight: 600, color: isUp ? C.green : C.red, marginTop: 2 }}>{pct(change7d)} (7D)</div>}
          </div>
        </div>
      </div>

      {/* 7-Day Chart */}
      {tokenInfo?.chartData && tokenInfo.chartData.length > 0 && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: '16px 8px 8px 4px', marginBottom: 14 }}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={tokenInfo.chartData}>
              <YAxis domain={['auto', 'auto']} hide />
              <Line
                type="monotone"
                dataKey="price"
                stroke={chartColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: chartColor }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stats Grid */}
      {tokenInfo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 14 }}>
          {[
            ['24H High', fmt(tokenInfo.high24h)],
            ['24H Low', fmt(tokenInfo.low24h)],
            ['Market Cap', fmt(tokenInfo.marketCap)],
            ['24H Volume', fmt(tokenInfo.volume24h)],
          ].map(([label, value]) => (
            <div key={label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Instant Trade */}
      <div style={{ marginBottom: 12 }}>
        <InstantTrade
          token={td}
          solPrice={solPriceUsd}
          tokenBalance={userTokenBalance}
          tokenDecimals={userTokenDecimals}
          onConnectWallet={onConnectWallet}
          onOpenDrawer={(mode) => { setDrawerMode(mode); setDrawerOpen(true); }}
          onTradeComplete={() => setTradeRefreshTick(t => t + 1)}
        />
      </div>

      {/* Buy / Sell Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={() => openDrawer('buy')} style={{ padding: 18, borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Buy {sym}</button>
        <button onClick={() => openDrawer('sell')} style={{ padding: 18, borderRadius: 14, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>Sell {sym}</button>
      </div>

      {/* Contract Address */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SOLANA CONTRACT</div>
        <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{td.mint}</div>
      </div>

      <TradeDrawer open={drawerOpen} onClose={closeDrawer} mode={drawerMode} coin={td} onConnectWallet={onConnectWallet} presets={presets} onPresetsChange={setPresets} />
    </div>
  );
}