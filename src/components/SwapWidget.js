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

const DEFAULT_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', name: 'Ethereum', decimals: 8 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9 },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6 },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6 },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth Network', decimals: 6 },
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

function TokenSelect({ selected, onSelect, tokens }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = tokens.filter(function(t) {
    return t.symbol.toLowerCase().includes(q.toLowerCase()) ||
      t.name.toLowerCase().includes(q.toLowerCase());
  }).slice(0, 50);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: C.card3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '8px 12px', cursor: 'pointer', minWidth: 100,
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 200,
          background: C.card, border: '1px solid ' + C.borderHi,
          borderRadius: 14, width: 260, maxHeight: 360,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,.8)'
        }}>
          <div style={{ padding: '12px 12px 8px' }}>
            <input
              autoFocus value={q}
              onChange={function(e) { setQ(e.target.value); }}
              placeholder="Search token..."
              style={{
                width: '100%', background: C.card2,
                border: '1px solid ' + C.border,
                borderRadius: 8, padding: '8px 12px',
                color: C.text, fontSize: 13, outline: 'none',
                fontFamily: 'Syne, sans-serif'
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(function(t) {
              return (
                <div key={t.mint}
                  onClick={function() { onSelect(t); setOpen(false); setQ(''); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: C.accent, flexShrink: 0
                  }}>{t.symbol.charAt(0)}</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{t.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SwapWidget({ coins }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [fromToken, setFromToken] = useState(DEFAULT_TOKENS[0]);
  const [toToken, setToToken] = useState(DEFAULT_TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slip, setSlip] = useState(0.5);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [selectedChart, setSelectedChart] = useState('bitcoin');
  const [customAddress, setCustomAddress] = useState('');
  const [useCustomAddress, setUseCustomAddress] = useState(false);

  useEffect(function() {
    var fetchTokens = async function() {
      try {
        var res = await fetch('https://token.jup.ag/strict');
        var data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setTokens(data.slice(0, 500));
        }
      } catch (e) {
        console.log('Using default tokens');
      }
    };
    fetchTokens();
  }, []);

  var fetchQuote = useCallback(async function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0) return;
    setQuoteLoading(true);
    try {
      var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
      var params = new URLSearchParams({
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amount: amount.toString(),
        slippageBps: Math.round(slip * 100).toString(),
        platformFeeBps: JUPITER_FEE_BPS.toString(),
      });
      var res = await fetch('https://quote-api.jup.ag/v6/quote?' + params);
      var data = await res.json();
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

  useEffect(function() {
    var t = setTimeout(fetchQuote, 600);
    return function() { clearTimeout(t); };
  }, [fetchQuote]);

  useEffect(function() {
    var fetchChart = async function() {
      try {
        var res = await fetch('https://api.coingecko.com/api/v3/coins/' + selectedChart + '/market_chart?vs_currency=usd&days=7');
        var data = await res.json();
        var pts = (data.prices || []).filter(function(_, i) { return i % 6 === 0; }).map(function(item) {
          return { t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }), p: +item[1].toFixed(4) };
        });
        setChartData(pts);
      } catch (e) {}
    };
    fetchChart();
  }, [selectedChart]);

  var executeSwap = async function() {
    if (!connected || !publicKey || !quote) return;
    setSwapStatus('loading');
    try {
      var recipientAddress = useCustomAddress && customAddress ? customAddress : publicKey.toString();
      var swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: publicKey.toString(),
          destinationTokenAccount: useCustomAddress && customAddress ? customAddress : undefined,
          wrapAndUnwrapSol: true,
          feeAccount: JUPITER_REFERRAL_KEY,
        }),
      });
      var swapData = await swapRes.json();
      var txBuf = Buffer.from(swapData.swapTransaction, 'base64');
      var tx = VersionedTransaction.deserialize(txBuf);
      var sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setSwapTx(sig);
      setSwapStatus('success');
      setFromAmt('');
      setQuote(null);
      setTimeout(function() { setSwapStatus('idle'); }, 4000);
    } catch (e) {
      console.error('Swap error:', e);
      setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); }, 3000);
    }
  };

  var flipTokens = function() {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt(quote ? quote.outAmountDisplay : '');
    setQuote(null);
  };

  var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  var fromPriceVal = fromCoin ? fromCoin.current_price : 0;
  var toCoin = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  var toPriceVal = toCoin ? toCoin.current_price : 0;
  var feeUsd = fromAmt && fromPriceVal ? (parseFloat(fromAmt) * fromPriceVal * 0.003).toFixed(2) : '0.00';
  var chartCoin = coins.find(function(c) { return c.id === selectedChart; });
  var chartColor = chartCoin && (chartCoin.price_change_percentage_7d_in_currency || 0) >= 0 ? C.green : C.red;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '480px 1fr', gap: 28, alignItems: 'start' }}>
      <div>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: .5, color: '#fff' }}>Swap Tokens</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Jupiter routing · 0.3% fee paid by user</p>
        </div>

        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 22, padding: 24 }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Slippage</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.1, 0.5, 1.0].map(function(v) {
                return (
                  <button key={v} onClick={function() { setSlip(v); }} style={{
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
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.muted }}>You Pay</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenSelect tokens={tokens} selected={fromToken} onSelect={setFromToken} />
              <input value={fromAmt}
                onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
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
              border: '1px solid ' + C.border, cursor: 'pointer',
              color: C.accent, fontSize: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⇅</button>
          </div>

          <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.muted }}>You Receive</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenSelect tokens={tokens} selected={toToken} onSelect={setToToken} />
              <div style={{ flex: 1, textAlign: 'right', fontSize: 26, fontWeight: 500, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
                {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
              </div>
            </div>
            {quote && toPriceVal > 0 && (
              <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
                {fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" id="customAddr"
                checked={useCustomAddress}
                onChange={function(e) { setUseCustomAddress(e.target.checked); }}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="customAddr" style={{ fontSize: 12, color: C.muted, cursor: 'pointer' }}>
                Send to different address
              </label>
            </div>
            {useCustomAddress && (
              <input
                value={customAddress}
                onChange={function(e) { setCustomAddress(e.target.value); }}
                placeholder="Enter Solana wallet address..."
                style={{
                  width: '100%', background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 10, padding: '10px 14px', color: C.text,
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 12, outline: 'none'
                }}
              />
            )}
          </div>

          {quote && fromAmt && (
            <div style={{ marginTop: 14, background: '#050912', borderRadius: 12, padding: 14 }}>
              {[
                ['Platform Fee (0.3% paid by user)', '$' + feeUsd],
                ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'],
                ['Min Received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + toToken.symbol],
                ['Route', fromToken.symbol + ' via Jupiter to ' + toToken.symbol],
              ].map(function(item) {
                return (
                  <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{item[0]}</span>
                    <span style={{ color: C.text }}>{item[1]}</span>
                  </div>
                );
              })}
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
              {swapStatus === 'loading' ? 'Confirming in Wallet...'
                : swapStatus === 'success' ? 'Swap Confirmed!'
                : swapStatus === 'error' ? 'Failed - Try Again'
                : !fromAmt ? 'Enter Amount'
                : !quote ? 'Getting Best Route...'
                : 'Swap ' + fromToken.symbol + ' to ' + toToken.symbol}
            </button>
          ) : (
            <div style={{ width: '100%', marginTop: 16, padding: 18, borderRadius: 14, background: 'rgba(0,229,255,.05)', border: '1px solid ' + C.border, textAlign: 'center', color: C.muted, fontSize: 14 }}>
              Connect Phantom or Solflare wallet to swap
            </div>
          )}

          {swapTx && swapStatus === 'success' && (
            <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 11, color: C.accent }}>
              View on Solscan
            </a>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 12 }}>
            Non-custodial · Wallet-to-wallet · No KYC · Fee paid by user
          </p>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {coins.slice(0, 10).map(function(c) {
            return (
              <button key={c.id} onClick={function() { setSelectedChart(c.id); }} style={{
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
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{chartCoin.symbol && chartCoin.symbol.toUpperCase()} · 7-Day</div>
                <div style={{ fontSize: 30, fontWeight: 500, color: '#fff', marginTop: 6 }}>{fmt(chartCoin.current_price)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>24H CHANGE</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: (chartCoin.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                  {pct(chartCoin.price_change_percentage_24h)}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Vol: {fmt(chartCoin.total_volume)}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Cap: {fmt(chartCoin.market_cap)}</div>
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
                  <Tooltip
                    contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 12 }}
                    formatter={function(v) { return [fmt(v), 'Price']; }}
                  />
                  <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#cg)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                Loading chart...
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 20 }}>
              {[
                ['24H High', fmt(chartCoin.high_24h)],
                ['24H Low', fmt(chartCoin.low_24h)],
                ['ATH', fmt(chartCoin.ath)],
                ['Rank', '#' + (chartCoin.market_cap_rank || '--')],
              ].map(function(item) {
                return (
                  <div key={item[0]} style={{ background: '#050912', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{item[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
