import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal, ConnectButton } from '@rainbow-me/rainbowkit';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const JUPITER_REFERRAL_KEY = 'E2yVdtMKBX8c7nNwks2mJ8gXpVrEMf2gkrXLz5oaDzQX';
const JUPITER_FEE_BPS = 30;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const SOLANA_TOKENS = {
  'SOL': { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  'USDC': { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  'USDT': { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  'ETH': { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8 },
  'BONK': { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  'JUP': { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  'RAY': { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6 },
  'ORCA': { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6 },
  'PYTH': { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6 },
};

const SOL_TOKEN = { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 };
const USDC_TOKEN = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 };

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

function TradeDrawer({ open, onClose, mode, coin, solanaToken }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapStatus, setSwapStatus] = useState('idle');

  var fromToken = mode === 'sell'
    ? { mint: solanaToken.mint, symbol: coin.symbol.toUpperCase(), name: coin.name, decimals: solanaToken.decimals }
    : SOL_TOKEN;

  var toToken = mode === 'sell' ? USDC_TOKEN
    : { mint: solanaToken.mint, symbol: coin.symbol.toUpperCase(), name: coin.name, decimals: solanaToken.decimals };

  useEffect(function() {
    setFromAmt('');
    setQuote(null);
    setSwapStatus('idle');
  }, [open, mode]);

  useEffect(function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0) { setQuote(null); return; }
    var t = setTimeout(async function() {
      setQuoteLoading(true);
      try {
        var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
        var params = new URLSearchParams({
          inputMint: fromToken.mint,
          outputMint: toToken.mint,
          amount: amount.toString(),
          slippageBps: '50',
          platformFeeBps: JUPITER_FEE_BPS.toString(),
        });
        var res = await fetch('https://quote-api.jup.ag/v6/quote?' + params);
        var data = await res.json();
        if (data && data.outAmount) {
          setQuote({
            outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
            priceImpactPct: data.priceImpactPct,
            quoteResponse: data,
          });
        } else {
          setQuote(null);
        }
      } catch (e) { setQuote(null); }
      setQuoteLoading(false);
    }, 600);
    return function() { clearTimeout(t); };
  }, [fromAmt, mode]);

  var executeSwap = async function() {
    if (!isConnected) { if (openConnectModal) openConnectModal(); return; }
    if (!quote) return;
    setSwapStatus('loading');
    try {
      var swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: address,
          wrapAndUnwrapSol: true,
          feeAccount: JUPITER_REFERRAL_KEY,
        }),
      });
      var swapData = await swapRes.json();
      if (swapData.swapTransaction) {
        setSwapStatus('success');
        setFromAmt('');
        setQuote(null);
        setTimeout(function() { setSwapStatus('idle'); }, 4000);
      }
    } catch (e) {
      setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); }, 3000);
    }
  };

  var modeLabel = mode === 'buy' ? 'Buy' : mode === 'sell' ? 'Sell' : 'Swap';
  var modeColor = mode === 'buy' ? C.accent : mode === 'sell' ? C.red : C.green;
  var modeGradient = mode === 'sell'
    ? 'linear-gradient(135deg,#ff3b6b,#cc1144)'
    : mode === 'buy'
    ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
    : 'linear-gradient(135deg,#00ffa3,#00b36b)';

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.75)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0',
        padding: '20px 20px 40px',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: '85vh', overflowY: 'auto',
        animation: 'slideUp .25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {coin.image && (
              <img src={coin.image} alt={coin.symbol} style={{ width: 36, height: 36, borderRadius: '50%' }} />
            )}
            <div>
              <div style={{ color: modeColor, fontWeight: 800, fontSize: 20 }}>
                {modeLabel} {coin.symbol && coin.symbol.toUpperCase()}
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {fmt(coin.current_price)} per {coin.symbol && coin.symbol.toUpperCase()}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>×</button>
        </div>

        {!isConnected && (
          <div style={{
            marginBottom: 16, padding: 14,
            background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
          }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <ConnectButton showBalance={false} chainStatus="none" accountStatus="avatar" />
          </div>
        )}

        <div style={{ background: C.card2, borderRadius: 12, padding: 16, border: '1px solid ' + C.border, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
            {mode === 'sell' ? 'YOU SELL' : 'YOU PAY'} ({fromToken.symbol})
          </div>
          <input
            value={fromAmt}
            onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
            placeholder="0.00"
            style={{
              width: '100%', background: 'transparent', border: 'none',
              fontSize: 30, fontWeight: 600, color: '#fff', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: C.card3, border: '1px solid ' + C.border,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.accent, fontSize: 14,
          }}>↓</div>
        </div>

        <div style={{ background: C.card2, borderRadius: 12, padding: 16, border: '1px solid ' + C.border, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
            YOU RECEIVE ({toToken.symbol})
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
            {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
          </div>
        </div>

        {quote && (
          <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16 }}>
            {[
              ['Fee (0.3% paid by user)', '$' + (parseFloat(fromAmt) * (coin.current_price || 0) * 0.003).toFixed(2)],
              ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'],
              ['Min Received', (parseFloat(quote.outAmountDisplay) * 0.995).toFixed(6) + ' ' + toToken.symbol],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                  <span style={{ color: C.muted }}>{item[0]}</span>
                  <span style={{ color: C.text }}>{item[1]}</span>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={isConnected ? executeSwap : openConnectModal}
          disabled={isConnected && (!fromAmt || !quote || swapStatus === 'loading')}
          style={{
            width: '100%', padding: 18, borderRadius: 14, border: 'none',
            background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
              : !isConnected ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
              : !fromAmt || !quote ? C.card3
              : modeGradient,
            color: !fromAmt || !quote && isConnected ? C.muted2 : swapStatus === 'error' ? C.red : C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: isConnected && (!fromAmt || !quote) ? 'not-allowed' : 'pointer',
            transition: 'all .3s',
          }}>
          {!isConnected ? 'Connect Wallet to Trade'
            : swapStatus === 'loading' ? 'Confirming...'
            : swapStatus === 'success' ? modeLabel + ' Confirmed!'
            : swapStatus === 'error' ? 'Failed - Try Again'
            : !fromAmt ? 'Enter Amount'
            : !quote ? 'Getting Quote...'
            : modeLabel + ' ' + (coin.symbol && coin.symbol.toUpperCase())}
        </button>

        {swapStatus === 'success' && (
          <div style={{ textAlign: 'center', marginTop: 12, color: C.green, fontSize: 13, fontWeight: 600 }}>
            Transaction submitted successfully!
          </div>
        )}
      </div>
    </>
  );
}

export default function TokenDetail({ coin, coins, onBack, onBuy }) {
  const [chartData, setChartData] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('7');
  const [chartLoading, setChartLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  var solanaToken = coin && coin.symbol ? SOLANA_TOKENS[coin.symbol.toUpperCase()] : null;

  useEffect(function() {
    if (!coin) return;
    var fetchChart = async function() {
      setChartLoading(true);
      try {
        var res = await fetch('https://api.coingecko.com/api/v3/coins/' + coin.id + '/market_chart?vs_currency=usd&days=' + chartPeriod);
        var data = await res.json();
        var interval = chartPeriod === '1' ? 1 : chartPeriod === '7' ? 6 : 24;
        var pts = (data.prices || []).filter(function(_, i) { return i % interval === 0; }).map(function(item) {
          return {
            t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
            p: +item[1].toFixed(6),
          };
        });
        setChartData(pts);
      } catch (e) {}
      setChartLoading(false);
    };
    fetchChart();
  }, [coin, chartPeriod]);

  if (!coin) return null;

  var priceChange = coin.price_change_percentage_24h || 0;
  var chartColor = priceChange >= 0 ? C.green : C.red;

  var openDrawer = function(mode) {
    if (!solanaToken) {
      if (onBuy) onBuy(coin);
      return;
    }
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>

      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
        background: 'transparent', border: 'none', color: C.muted,
        cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600,
      }}>← Back to Markets</button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {coin.image ? (
              <img src={coin.image} alt={coin.symbol} style={{ width: 48, height: 48, borderRadius: '50%' }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>
                {coin.symbol && coin.symbol.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{coin.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {coin.symbol && coin.symbol.toUpperCase()} · Rank #{coin.market_cap_rank}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(coin.current_price)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: priceChange >= 0 ? C.green : C.red, marginTop: 2 }}>
              {pct(priceChange)} (24H)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['1', '1D'], ['7', '7D'], ['30', '30D']].map(function(item) {
            return (
              <button key={item[0]} onClick={function() { setChartPeriod(item[0]); }} style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                background: chartPeriod === item[0] ? 'rgba(0,229,255,.12)' : 'transparent',
                border: '1px solid ' + (chartPeriod === item[0] ? 'rgba(0,229,255,.35)' : C.border),
                color: chartPeriod === item[0] ? C.accent : C.muted,
                fontFamily: 'Syne, sans-serif',
              }}>{item[1]}</button>
            );
          })}
        </div>

        {chartLoading ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            Loading chart...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={.25} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11 }}
                formatter={function(v) { return [fmt(v), 'Price']; }}
              />
              <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#tdGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        <button onClick={function() { openDrawer('buy'); }} style={{
          padding: '16px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
          color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
          boxShadow: '0 0 20px rgba(0,229,255,.2)',
        }}>Buy</button>
        <button onClick={function() { openDrawer('swap'); }} style={{
          padding: '16px 10px', borderRadius: 14, cursor: 'pointer',
          background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.3)',
          color: C.green, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
        }}>Swap</button>
        <button onClick={function() { openDrawer('sell'); }} style={{
          padding: '16px 10px', borderRadius: 14, cursor: 'pointer',
          background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)',
          color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
        }}>Sell</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          ['Market Cap', fmt(coin.market_cap)],
          ['24H Volume', fmt(coin.total_volume)],
          ['24H High', fmt(coin.high_24h)],
          ['24H Low', fmt(coin.low_24h)],
          ['All Time High', fmt(coin.ath)],
          ['ATH Change', pct(coin.ath_change_percentage)],
          ['Circulating Supply', coin.circulating_supply ? (coin.circulating_supply / 1e6).toFixed(2) + 'M' : '--'],
          ['Market Cap Rank', '#' + (coin.market_cap_rank || '--')],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: .8 }}>{item[0]}</div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PRICE CHANGES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            ['1 Hour', coin.price_change_percentage_1h_in_currency],
            ['24 Hours', coin.price_change_percentage_24h],
            ['7 Days', coin.price_change_percentage_7d_in_currency],
          ].map(function(item) {
            var val = item[1] || 0;
            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: val >= 0 ? C.green : C.red }}>{pct(val)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {solanaToken && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SOLANA CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>
            {solanaToken.mint}
          </div>
        </div>
      )}

      {drawerOpen && solanaToken && (
        <TradeDrawer
          open={drawerOpen}
          onClose={function() { setDrawerOpen(false); }}
          mode={drawerMode}
          coin={coin}
          solanaToken={solanaToken}
        />
      )}
    </div>
  );
}
