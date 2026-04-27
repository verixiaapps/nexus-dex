import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const SOLANA_TOKENS = {
  'SOL': { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  'USDC': { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  'USDT': { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  'BTC': { mint: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', decimals: 6 },
  'ETH': { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8 },
  'BONK': { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  'JUP': { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  'RAY': { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6 },
};

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

export default function TokenDetail({ coin, coins, onBack, onSwap, onBuy }) {
  const [chartData, setChartData] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('7');
  const [chartLoading, setChartLoading] = useState(true);

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
            t: new Date(item[0]).toLocaleDateString('en', {
              month: 'short', day: 'numeric',
              hour: chartPeriod === '1' ? 'numeric' : undefined,
            }),
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
  var solanaToken = SOLANA_TOKENS[coin.symbol && coin.symbol.toUpperCase()];

  var handleQuickBuy = function() {
    onBuy(coin);
  };

  var handleQuickSell = function() {
    if (solanaToken) {
      onSwap(
        { mint: solanaToken.mint, symbol: coin.symbol.toUpperCase(), name: coin.name, decimals: solanaToken.decimals },
        { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 }
      );
    }
  };

  var handleQuickSwap = function() {
    if (solanaToken) {
      onSwap(
        { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
        { mint: solanaToken.mint, symbol: coin.symbol.toUpperCase(), name: coin.name, decimals: solanaToken.decimals }
      );
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>

      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
        background: 'transparent', border: 'none', color: C.muted,
        cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600,
      }}>
        ← Back to Markets
      </button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 24, marginBottom: 16 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {coin.image ? (
              <img src={coin.image} alt={coin.symbol} style={{ width: 52, height: 52, borderRadius: '50%' }} />
            ) : (
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: C.accent }}>
                {coin.symbol && coin.symbol.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 22, color: '#fff' }}>{coin.name}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{coin.symbol && coin.symbol.toUpperCase()} · Rank #{coin.market_cap_rank}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#fff' }}>{fmt(coin.current_price)}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: priceChange >= 0 ? C.green : C.red, marginTop: 4 }}>
              {pct(priceChange)} (24H)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['1', '1D'], ['7', '7D'], ['30', '30D']].map(function(item) {
            return (
              <button key={item[0]} onClick={function() { setChartPeriod(item[0]); }} style={{
                padding: '5px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                background: chartPeriod === item[0] ? 'rgba(0,229,255,.12)' : 'transparent',
                border: '1px solid ' + (chartPeriod === item[0] ? 'rgba(0,229,255,.35)' : C.border),
                color: chartPeriod === item[0] ? C.accent : C.muted,
                fontFamily: 'Syne, sans-serif',
              }}>{item[1]}</button>
            );
          })}
        </div>

        {chartLoading ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            Loading chart...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <button onClick={handleQuickBuy} style={{
          padding: '14px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
          color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
          boxShadow: '0 0 24px rgba(0,229,255,.25)',
        }}>
          Buy {coin.symbol && coin.symbol.toUpperCase()}
        </button>
        <button onClick={handleQuickSwap} style={{
          padding: '14px 10px', borderRadius: 14, border: '1px solid rgba(0,229,255,.3)', cursor: 'pointer',
          background: 'rgba(0,229,255,.08)',
          color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
        }}>
          Swap to {coin.symbol && coin.symbol.toUpperCase()}
        </button>
        <button onClick={handleQuickSell} style={{
          padding: '14px 10px', borderRadius: 14, border: '1px solid rgba(255,59,107,.3)', cursor: 'pointer',
          background: 'rgba(255,59,107,.08)',
          color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
        }}>
          Sell {coin.symbol && coin.symbol.toUpperCase()}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['Market Cap', fmt(coin.market_cap)],
          ['24H Volume', fmt(coin.total_volume)],
          ['24H High', fmt(coin.high_24h)],
          ['24H Low', fmt(coin.low_24h)],
          ['All Time High', fmt(coin.ath)],
          ['ATH Change', pct(coin.ath_change_percentage)],
          ['Circulating Supply', coin.circulating_supply ? (coin.circulating_supply / 1e6).toFixed(2) + 'M' : '--'],
          ['Total Supply', coin.total_supply ? (coin.total_supply / 1e6).toFixed(2) + 'M' : '--'],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: .8 }}>{item[0]}</div>
              <div style={{ fontSize: 15, color: C.text, fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      {solanaToken && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>SOLANA TOKEN INFO</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Contract Address</div>
              <div style={{ fontSize: 11, color: C.accent, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                {solanaToken.mint}
              </div>
            </div>
            <a href={'https://solscan.io/token/' + solanaToken.mint} target="_blank" rel="noreferrer"
              style={{ color: C.accent, fontSize: 12, fontWeight: 600, textDecoration: 'none', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, padding: '6px 12px', whiteSpace: 'nowrap' }}>
              View on Solscan ↗
            </a>
          </div>
        </div>
      )}

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PRICE CHANGES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {[
            ['1 Hour', coin.price_change_percentage_1h_in_currency],
            ['24 Hours', coin.price_change_percentage_24h],
            ['7 Days', coin.price_change_percentage_7d_in_currency],
          ].map(function(item) {
            var val = item[1] || 0;
            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>{item[0]}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: val >= 0 ? C.green : C.red }}>{pct(val)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
