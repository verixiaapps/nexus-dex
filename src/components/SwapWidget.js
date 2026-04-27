import React, { useState, useEffect, useCallback } from ‘react’;
import { useWallet, useConnection } from ‘@solana/wallet-adapter-react’;
import { VersionedTransaction } from ‘@solana/web3.js’;
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from ‘recharts’;
import {
JUPITER_REFERRAL_KEY,
JUPITER_FEE_BPS,
RANGO_API_KEY,
RANGO_AFFILIATE_REF,
RANGO_FEE_WALLET,
RANGO_FEE_PERCENT,
PLATFORM_FEE_DISPLAY,
} from ‘../config’;

const C = {
bg: ‘#03060f’, card: ‘#080d1a’, card2: ‘#0c1220’, card3: ‘#111d30’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, accentBg: ‘rgba(0,229,255,0.08)’,
green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
};

// Common Solana tokens for Jupiter
const SOLANA_TOKENS = [
{ mint: ‘So11111111111111111111111111111111111111112’, symbol: ‘SOL’, name: ‘Solana’, decimals: 9 },
{ mint: ‘EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v’, symbol: ‘USDC’, name: ‘USD Coin’, decimals: 6 },
{ mint: ‘Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB’, symbol: ‘USDT’, name: ‘Tether’, decimals: 6 },
{ mint: ‘JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN’, symbol: ‘JUP’, name: ‘Jupiter’, decimals: 6 },
{ mint: ‘7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs’, symbol: ‘ETH’, name: ‘Ethereum (Wormhole)’, decimals: 8 },
{ mint: ‘DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263’, symbol: ‘BONK’, name: ‘Bonk’, decimals: 5 },
{ mint: ‘mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So’, symbol: ‘mSOL’, name: ‘Marinade SOL’, decimals: 9 },
{ mint: ‘bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1’, symbol: ‘bSOL’, name: ‘BlazeStake SOL’, decimals: 9 },
];

// EVM chains for Rango
const EVM_CHAINS = [‘ETH’, ‘BSC’, ‘POLYGON’, ‘AVAX_CCHAIN’, ‘ARBITRUM’, ‘OPTIMISM’, ‘BASE’];

const fmt = (n, d = 2) => {
if (n == null) return ‘—’;
if (n >= 1e9) return ‘$’ + (n / 1e9).toFixed(2) + ‘B’;
if (n >= 1e6) return ‘$’ + (n / 1e6).toFixed(2) + ‘M’;
if (n >= 1000) return ‘$’ + n.toLocaleString(‘en-US’, { maximumFractionDigits: d });
if (n >= 1) return ‘$’ + n.toFixed(d);
return ‘$’ + n.toFixed(6);
};

const pct = n => !n && n !== 0 ? ‘—’ : (n > 0 ? ‘+’ : ‘’) + n.toFixed(2) + ‘%’;

function Spinner() {
return <div style={{ width: 32, height: 32, borderRadius: ‘50%’, border: ‘2px solid rgba(0,229,255,.15)’, borderTop: ‘2px solid #00e5ff’, animation: ‘spin .8s linear infinite’, margin: ‘0 auto’ }} />;
}

function TokenSelect({ tokens, selected, onSelect, label }) {
const [open, setOpen] = useState(false);
const [q, setQ] = useState(’’);
const filtered = tokens.filter(t =>
t.symbol?.toLowerCase().includes(q.toLowerCase()) ||
t.name?.toLowerCase().includes(q.toLowerCase())
);

return (
<div style={{ position: ‘relative’ }}>
<button onClick={() => setOpen(!open)} style={{
display: ‘flex’, alignItems: ‘center’, gap: 8,
background: C.card3, border: `1px solid ${C.border}`,
borderRadius: 10, padding: ‘8px 12px’, cursor: ‘pointer’,
}}>
<span style={{ color: ‘#fff’, fontWeight: 700, fontSize: 14 }}>{selected?.symbol || ‘Select’}</span>
<span style={{ color: C.muted, fontSize: 10 }}>▾</span>
</button>
{open && (
<div style={{
position: ‘absolute’, top: ‘110%’, left: 0, zIndex: 200,
background: C.card, border: `1px solid ${C.borderHi}`,
borderRadius: 14, width: 280, maxHeight: 320, overflow: ‘hidden’,
display: ‘flex’, flexDirection: ‘column’, boxShadow: ‘0 20px 60px rgba(0,0,0,.6)’
}}>
<div style={{ padding: ‘12px 12px 8px’ }}>
<input
autoFocus value={q} onChange={e => setQ(e.target.value)}
placeholder=“Search token…”
style={{
width: ‘100%’, background: C.card2, border: `1px solid ${C.border}`,
borderRadius: 8, padding: ‘8px 12px’, color: C.text,
fontFamily: “‘Syne’, sans-serif”, fontSize: 13, outline: ‘none’
}}
/>
</div>
<div style={{ overflowY: ‘auto’, padding: ‘0 8px 8px’ }}>
{filtered.map(t => (
<div key={t.mint || t.symbol} onClick={() => { onSelect(t); setOpen(false); setQ(’’); }}
style={{
display: ‘flex’, alignItems: ‘center’, gap: 10,
padding: ‘10px 8px’, borderRadius: 8, cursor: ‘pointer’,
transition: ‘background .15s’,
}}
onMouseEnter={e => e.currentTarget.style.background = ‘rgba(0,229,255,.05)’}
onMouseLeave={e => e.currentTarget.style.background = ‘transparent’}
>
<div style={{
width: 32, height: 32, borderRadius: ‘50%’,
background: ‘rgba(0,229,255,.1)’, border: ‘1px solid rgba(0,229,255,.2)’,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0
}}>{t.symbol?.charAt(0)}</div>
<div>
<div style={{ color: ‘#fff’, fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
<div style={{ color: C.muted, fontSize: 11 }}>{t.name}</div>
</div>
</div>
))}
</div>
</div>
)}
</div>
);
}

export default function SwapWidget({ coins, loading }) {
const { publicKey, connected, sendTransaction } = useWallet();
const { connection } = useConnection();

const [swapMode, setSwapMode] = useState(‘solana’); // ‘solana’ | ‘cross-chain’
const [fromToken, setFromToken] = useState(SOLANA_TOKENS[0]);
const [toToken, setToToken] = useState(SOLANA_TOKENS[1]);
const [fromAmt, setFromAmt] = useState(’’);
const [quote, setQuote] = useState(null);
const [quoteLoading, setQuoteLoading] = useState(false);
const [slip, setSlip] = useState(0.5);
const [swapStatus, setSwapStatus] = useState(‘idle’); // idle | loading | success | error
const [swapTx, setSwapTx] = useState(null);
const [chartData, setChartData] = useState([]);
const [selectedChart, setSelectedChart] = useState(‘bitcoin’);

// Fetch Jupiter quote
const fetchJupiterQuote = useCallback(async () => {
if (!fromAmt || parseFloat(fromAmt) <= 0 || swapMode !== ‘solana’) return;
setQuoteLoading(true);
try {
const amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
const params = new URLSearchParams({
inputMint: fromToken.mint,
outputMint: toToken.mint,
amount: amount.toString(),
slippageBps: Math.round(slip * 100).toString(),
platformFeeBps: JUPITER_FEE_BPS.toString(),
});
const res = await fetch(`https://quote-api.jup.ag/v6/quote?${params}`);
const data = await res.json();
if (data.outAmount) {
setQuote({
outAmount: data.outAmount,
outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
priceImpactPct: data.priceImpactPct,
routePlan: data.routePlan,
quoteResponse: data,
});
}
} catch (e) {
console.error(‘Jupiter quote error:’, e);
}
setQuoteLoading(false);
}, [fromAmt, fromToken, toToken, slip, swapMode]);

useEffect(() => {
const timer = setTimeout(fetchJupiterQuote, 600);
return () => clearTimeout(timer);
}, [fetchJupiterQuote]);

// Fetch chart data
useEffect(() => {
const fetchChart = async () => {
try {
const res = await fetch(`https://api.coingecko.com/api/v3/coins/${selectedChart}/market_chart?vs_currency=usd&days=7`);
const data = await res.json();
const pts = (data.prices || []).filter((_, i) => i % 6 === 0).map(([ts, p]) => ({
t: new Date(ts).toLocaleDateString(‘en’, { month: ‘short’, day: ‘numeric’ }),
p: +p.toFixed(4),
}));
setChartData(pts);
} catch (e) {}
};
fetchChart();
}, [selectedChart]);

// Execute Jupiter swap
const executeJupiterSwap = async () => {
if (!connected || !publicKey || !quote) return;
setSwapStatus(‘loading’);
try {
// Get swap transaction from Jupiter
const swapRes = await fetch(‘https://quote-api.jup.ag/v6/swap’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({
quoteResponse: quote.quoteResponse,
userPublicKey: publicKey.toString(),
wrapAndUnwrapSol: true,
// Fee account for your referral key — collects 0.3% from user
feeAccount: JUPITER_REFERRAL_KEY,
}),
});
const { swapTransaction } = await swapRes.json();

```
  // Deserialize and send transaction
  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  const sig = await sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, 'confirmed');

  setSwapTx(sig);
  setSwapStatus('success');
  setFromAmt('');
  setQuote(null);
  setTimeout(() => setSwapStatus('idle'), 4000);
} catch (e) {
  console.error('Swap error:', e);
  setSwapStatus('error');
  setTimeout(() => setSwapStatus('idle'), 3000);
}
```

};

const flipTokens = () => {
setFromToken(toToken);
setToToken(fromToken);
setFromAmt(quote?.outAmountDisplay || ‘’);
setQuote(null);
};

const fromPrice = coins.find(c => c.symbol?.toLowerCase() === fromToken.symbol?.toLowerCase())?.current_price || 0;
const toPrice = coins.find(c => c.symbol?.toLowerCase() === toToken.symbol?.toLowerCase())?.current_price || 0;
const feeUsd = fromAmt && fromPrice ? (parseFloat(fromAmt) * fromPrice * 0.003).toFixed(2) : ‘0.00’;
const chartCoin = coins.find(c => c.id === selectedChart);
const chartColor = (chartCoin?.price_change_percentage_7d_in_currency || 0) >= 0 ? C.green : C.red;

return (
<div style={{ display: ‘grid’, gridTemplateColumns: ‘460px 1fr’, gap: 28, alignItems: ‘start’ }}>

```
  {/* ── Swap Card ── */}
  <div>
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: .5, color: '#fff' }}>Swap Tokens</h1>
      <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
        Best-price routing · <span style={{ color: C.accent }}>{PLATFORM_FEE_DISPLAY} platform fee paid by user</span>
      </p>
    </div>

    {/* Mode toggle */}
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {[['solana', '⚡ Solana (Jupiter)'], ['cross-chain', '🌉 Cross-Chain (Rango)']].map(([id, label]) => (
        <button key={id} onClick={() => setSwapMode(id)} style={{
          flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12,
          fontFamily: "'Syne', sans-serif", fontWeight: 700, cursor: 'pointer',
          background: swapMode === id ? 'rgba(0,229,255,.12)' : 'transparent',
          border: `1px solid ${swapMode === id ? 'rgba(0,229,255,.35)' : C.border}`,
          color: swapMode === id ? C.accent : C.muted,
          transition: 'all .15s',
        }}>{label}</button>
      ))}
    </div>

    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 22, padding: 24, boxShadow: '0 0 60px rgba(0,229,255,.04)' }}>

      {/* Slippage */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 12, color: C.muted }}>Slippage Tolerance</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[0.1, 0.5, 1.0].map(v => (
            <button key={v} onClick={() => setSlip(v)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
              background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent',
              border: `1px solid ${slip === v ? 'rgba(0,229,255,.4)' : C.border}`,
              color: slip === v ? C.accent : C.muted,
            }}>{v}%</button>
          ))}
        </div>
      </div>

      {/* FROM */}
      <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.muted }}>You Pay</span>
          {connected && <span style={{ fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            Bal: 0.000 {fromToken.symbol}
          </span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TokenSelect tokens={SOLANA_TOKENS} selected={fromToken} onSelect={setFromToken} label="from" />
          <input
            value={fromAmt}
            onChange={e => setFromAmt(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              fontSize: 26, fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none',
            }}
          />
        </div>
        {fromAmt && fromPrice > 0 && (
          <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            ≈ {fmt(parseFloat(fromAmt) * fromPrice)}
          </div>
        )}
      </div>

      {/* Flip */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
        <button onClick={flipTokens} style={{
          width: 38, height: 38, borderRadius: 11, background: C.card3,
          border: `1px solid ${C.border}`, cursor: 'pointer',
          color: C.accent, fontSize: 17, display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'all .2s',
        }}>⇅</button>
      </div>

      {/* TO */}
      <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.muted }}>You Receive</span>
          {connected && <span style={{ fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            Bal: 0.000 {toToken.symbol}
          </span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TokenSelect tokens={SOLANA_TOKENS} selected={toToken} onSelect={setToToken} label="to" />
          <div style={{
            flex: 1, textAlign: 'right',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 500,
            color: quoteLoading ? C.muted : quote ? C.green : C.muted2,
          }}>
            {quoteLoading ? '...' : quote?.outAmountDisplay || '0.00'}
          </div>
        </div>
        {quote && toPrice > 0 && (
          <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            ≈ {fmt(parseFloat(quote.outAmountDisplay) * toPrice)}
          </div>
        )}
      </div>

      {/* Route info */}
      {quote && fromAmt && (
        <div style={{ marginTop: 14, background: '#050912', borderRadius: 12, padding: 14, border: '1px solid rgba(0,229,255,.05)' }}>
          {[
            ['Platform Fee (0.3% — paid by you)', `$${feeUsd}`],
            ['Price Impact', `~${parseFloat(quote.priceImpactPct || 0).toFixed(3)}%`],
            ['Min. Received', `${(parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6)} ${toToken.symbol}`],
            ['Route', `${fromToken.symbol} → Jupiter → ${toToken.symbol}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: C.muted }}>{k}</span>
              <span style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      {connected ? (
        <button
          onClick={executeJupiterSwap}
          disabled={!fromAmt || parseFloat(fromAmt) <= 0 || !quote || swapStatus === 'loading'}
          style={{
            width: '100%', marginTop: 16, padding: 18, borderRadius: 14, border: 'none',
            background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
                : !fromAmt || !quote ? C.card2
                  : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg,
            fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16,
            letterSpacing: .5, cursor: !fromAmt || !quote ? 'not-allowed' : 'pointer',
            boxShadow: fromAmt && quote && swapStatus === 'idle' ? '0 0 32px rgba(0,229,255,.3)' : 'none',
            transition: 'all .3s',
          }}
        >
          {swapStatus === 'loading' ? 'Confirming in Wallet...'
            : swapStatus === 'success' ? '✓ Swap Confirmed!'
              : swapStatus === 'error' ? '✗ Swap Failed — Try Again'
                : !fromAmt ? 'Enter an Amount'
                  : !quote ? 'Getting Best Route...'
                    : `Swap ${fromToken.symbol} → ${toToken.symbol}`}
        </button>
      ) : (
        <div style={{
          width: '100%', marginTop: 16, padding: 18, borderRadius: 14,
          background: 'rgba(0,229,255,.05)', border: `1px solid ${C.border}`,
          textAlign: 'center', color: C.muted, fontSize: 14,
        }}>
          Connect your wallet to swap
        </div>
      )}

      {swapTx && swapStatus === 'success' && (
        <a
          href={`https://solscan.io/tx/${swapTx}`}
          target="_blank" rel="noreferrer"
          style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 11, color: C.accent }}
        >
          View transaction on Solscan ↗
        </a>
      )}

      <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 12 }}>
        Non-custodial · Wallet-to-wallet · No KYC · Fees paid by user
      </p>
    </div>

    {/* Cross-chain info */}
    {swapMode === 'cross-chain' && (
      <div style={{ marginTop: 16, background: C.card, border: `1px solid rgba(0,229,255,.15)`, borderRadius: 16, padding: 20 }}>
        <div style={{ fontWeight: 700, color: '#fff', marginBottom: 8, fontSize: 14 }}>🌉 Cross-Chain via Rango</div>
        <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          Swap tokens across 70+ blockchains including ETH, BSC, Polygon, Avalanche, Solana and more. 0.3% fee paid by user.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EVM_CHAINS.map(chain => (
            <span key={chain} style={{
              fontSize: 10, color: C.accent, background: 'rgba(0,229,255,.07)',
              border: '1px solid rgba(0,229,255,.15)', borderRadius: 4,
              padding: '2px 7px', fontWeight: 600, letterSpacing: .5,
            }}>{chain}</span>
          ))}
        </div>
        <p style={{ color: C.muted2, fontSize: 11, marginTop: 12 }}>
          Full Rango cross-chain UI coming soon. Visit rango.exchange with ref code <strong style={{ color: C.accent }}>{RANGO_AFFILIATE_REF}</strong> to swap cross-chain now.
        </p>
      </div>
    )}
  </div>

  {/* ── Chart Panel ── */}
  <div>
    {/* Coin selector tabs */}
    <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
      {coins.slice(0, 8).map(c => (
        <button key={c.id} onClick={() => setSelectedChart(c.id)} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 500,
          background: selectedChart === c.id ? 'rgba(0,229,255,.12)' : 'transparent',
          border: `1px solid ${selectedChart === c.id ? 'rgba(0,229,255,.35)' : C.border}`,
          color: selectedChart === c.id ? C.accent : C.muted,
        }}>{c.symbol?.toUpperCase()}</button>
      ))}
    </div>

    {chartCoin && (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 22, padding: 28 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: '#fff' }}>{chartCoin.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{chartCoin.symbol?.toUpperCase()} · 7-Day</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 500, color: '#fff', marginTop: 6 }}>
              {fmt(chartCoin.current_price)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, letterSpacing: .5 }}>24H CHANGE</div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700,
              color: (chartCoin.price_change_percentage_24h || 0) >= 0 ? C.green : C.red
            }}>{pct(chartCoin.price_change_percentage_24h)}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Vol: {fmt(chartCoin.total_volume)}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Cap: {fmt(chartCoin.market_cap)}</div>
          </div>
        </div>

        {/* Chart */}
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={.25} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.text }}
                formatter={v => [fmt(v), 'Price']}
                labelStyle={{ color: C.muted }}
              />
              <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#chartGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 20 }}>
          {[
            ['24H High', fmt(chartCoin.high_24h)],
            ['24H Low', fmt(chartCoin.low_24h)],
            ['ATH', fmt(chartCoin.ath)],
            ['Rank', '#' + (chartCoin.market_cap_rank || '—')],
          ].map(([k, v]) => (
            <div key={k} style={{ background: '#050912', borderRadius: 10, padding: 12, border: '1px solid rgba(0,229,255,.05)' }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, letterSpacing: .5 }}>{k}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: C.text, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
</div>
```

);
}