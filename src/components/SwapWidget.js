import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const JUPITER_REFERRAL_KEY = 'E2yVdtMKBX8c7nNwks2mJ8gXpVrEMf2gkrXLz5oaDzQX';
const JUPITER_FEE_BPS = 30;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', decimals: 8 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
];

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '--';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function TokenSelect({ selected, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: C.card3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 10 }}>v</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 200,
          background: C.card, border: '1px solid ' + C.borderHi,
          borderRadius: 14, width: 200, boxShadow: '0 20px 60px rgba(0,0,0,.6)'
        }}>
          {TOKENS.map(t => (
            <div key={t.mint} onClick={() => { onSelect(t); setOpen(false); }}
              style={{ padding: '12px 16px', cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 600 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{t.symbol}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SwapWidget({ coins }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slip, setSlip] = useState(0.5);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [selectedChart, setSelectedChart] = useState('bitcoin');

  const fetchQuote = useCallback(async () => {
    if (!fromAmt || parseFloat(fromAmt) <= 0) return;
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
      const res = await fetch('https://quote-api.jup.ag/v6/quote?' + params);
      const data = await res.json();
      if (data.outAmount) {
        setQuote({
          outAmount: data.outAmount,
          outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: data.priceImpactPct,
          quoteResponse: data,
        });
      }
    } catch (e) {
      console.error('Quote error:', e);
    }
    setQuoteLoading(false);
  }, [fromAmt, fromToken, toToken, slip]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, 600);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  useEffect(() => {
    const fetchChart = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/coins/' + selectedChart + '/market_chart?vs_currency=usd&days=7');
        const data = await res.json();
        const pts = (data.prices || []).filter(function(_, i) { return i % 6 === 0; }).map(function(item) {
          return { t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }), p: +item[1].toFixed(4) };
        });
        setChartData(pts);
      } catch (e) {}
    };
    fetchChart();
  }, [selectedChart]);

  const executeSwap = async () => {
    if (!connected || !publicKey || !quote) return;
    setSwapStatus('loading');
    try {
      const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
          feeAccount: JUPITER_REFERRAL_KEY,
        }),
      });
      const { swapTransaction } = await swapRes.json();
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
  };

  const flipTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt(quote ? quote.outAmountDisplay : '');
    setQuote(null);
  };

  const fromPrice = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  const fromPriceVal = fromPrice ? fromPrice.current_price : 0;
  const toPriceVal = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  const feeUsd = fromAmt && fromPriceVal ? (parseFloat(fromAmt) * fromPriceVal * 0.003).toFixed(2) : '0.00';
  const chartCoin = coins.find(function(c) { return c.id === selectedChart; });
  const chartColor = chartCoin && (chartCoin.price_change_percentage_7d_in_currency || 0) >= 0 ? C.green : C.red;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '460px 1fr', gap: 28, alignItems: 'start' }}>
      <div>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: .5, color: '#fff' }}>Swap Tokens</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Jupiter routing - 0.3% fee paid by user</p>
        </div>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 22, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Slippage</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.1, 0.5, 1.0].map(function(v) {
                return (
                  <button key={v} onClick={() => setSlip(v)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent',
                    border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border),
                    color: slip === v ? C.accent : C.muted,
                  }}>{v}%</button>
                );
              })}
            </div>
          </div>
          <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.muted }}>You Pay</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenSelect selected={fromToken} onSelect={setFromToken} />
              <input value={fromAmt} onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
                placeholder="0.00"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 26, fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none' }}
              />
            </div>
            {fromAmt && fromPriceVal > 0 && (
              <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
                {fmt(parseFloat(fromAmt) * fromPriceVal)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
            <button onClick={flipTokens} style={{
              width: 38, height: 38, borderRadius: 11, background: C.card3,
              border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 17,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>swap</button>
          </div>
          <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.muted }}>You Receive</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenSelect selected={toToken} onSelect={setToToken} />
              <div style={{ flex: 1, textAlign: 'right', fontSize: 26, fontWeight: 500, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
                {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
              </div>
            </div>
          </div>
          {quote && fromAmt && (
            <div style={{ marginTop: 14, background: '#050912', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: C.muted }}>Platform Fee (0.3% paid by you)</span>
                <span style={{ color: C.text }}>${feeUsd}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: C.muted }}>Price Impact</span>
                <span style={{ color: C.text }}>~{parseFloat(quote.priceImpactPct || 0).toFixed(3)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: C.muted }}>Route</span>
                <span style={{ color: C.text }}>{fromToken.symbol} via Jupiter to {toToken.symbol}</span>
              </div>
            </div>
          )}
          {connected ? (
            <button onClick={executeSwap}
              disabled={!fromAmt || parseFloat(fromAmt) <= 0 || !quote || swapStatus === 'loading'}
              style={{
                width: '100%', marginTop: 16, padding: 18, borderRadius: 14, border: 'none',
                background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                  : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
                  : !fromAmt || !quote ? C.card2
                  : 'linear-gradient(135deg,#00e5ff,#0055ff)',
                color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg,
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
                cursor: !fromAmt || !quote ? 'not-allowed' : 'pointer', transition: 'all .3s',
              }}>
              {swapStatus === 'loading' ? 'Confirming...' : swapStatus === 'success' ? 'Swap Confirmed!' : swapStatus === 'error' ? 'Failed - Try Again' : !fromAmt ? 'Enter Amount' : !quote ? 'Getting Route...' : 'Swap ' + fromToken.symbol + ' to ' + toToken.symbol}
            </button>
          ) : (
            <div style={{ width: '100%', marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(0,229,255,.05)', border: '1px solid ' + C.border, textAlign: 'center', color: C.muted, fontSize: 14 }}>
              Connect wallet to swap
            </div>
          )}
          {swapTx && swapStatus === 'success' && (
            <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 11, color: C.accent }}>
              View on Solscan
            </a>
          )}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {coins.slice(0, 8).map(function(c) {
            return (
              <button key={c.id} onClick={() => setSelectedChart(c.id)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 500,
                background: selectedChart === c.id ? 'rgba(0,229,255,.12)' : 'transparent',
                border: '1px solid ' + (selectedChart === c.id ? 'rgba(0,229,255,.35)' : C.border),
                color: selectedChart === c.id ? C.accent : C.muted,
              }}>{c.symbol && c.symbol.toUpperCase()}</button>
            );
          })}
        </div>
        {chartCoin && (
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 22, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{chartCoin.name}</div>
                <div style={{ fontSize: 30, fontWeight: 500, color: '#fff', marginTop: 6 }}>{fmt(chartCoin.current_price)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>24H</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: (chartCoin.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                  {pct(chartCoin.price_change_percentage_24h)}
                </div>
              </div>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={.25} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 12 }} formatter={function(v) { return [fmt(v), 'Price']; }} />
                  <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#cg)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Loading chart...</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
