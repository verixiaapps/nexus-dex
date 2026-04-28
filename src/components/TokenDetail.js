import React, { useState, useEffect } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
 
const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.04;
const ANTIMEV_FEE = 0.02;

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const SOL_TOKEN = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL', name: 'Solana', decimals: 9, isNative: true,
};

const USDC_TOKEN = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false,
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

function TradeDrawer({ open, onClose, mode, coin, jupiterToken, coins, onConnectWallet }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const [antiMev, setAntiMev] = useState(true);

  var totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;
  var fromToken = mode === 'sell' ? jupiterToken : SOL_TOKEN;
  var toToken = mode === 'sell' ? USDC_TOKEN : jupiterToken;

  useEffect(function() {
    setFromAmt('');
    setQuote(null);
    setSwapStatus('idle');
    setSwapTx(null);
    setSwapError('');
    setQuoteError('');
  }, [open, mode]);

  useEffect(function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0) { setQuote(null); return; }
    var t = setTimeout(async function() {
      setQuoteLoading(true);
      setQuoteError('');
      try {
        var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
        var url = 'https://api.jup.ag/swap/v1/quote' +
          '?inputMint=' + fromToken.mint +
          '&outputMint=' + toToken.mint +
          '&amount=' + amount +
          '&slippageBps=50';
        var res = await fetch(url);
        var data = await res.json();
        if (data && data.outAmount) {
          setQuote({
            outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
            priceImpactPct: data.priceImpactPct,
            quoteResponse: data,
          });
        } else {
          setQuoteError(data.error || 'No route found');
          setQuote(null);
        }
      } catch (e) {
        setQuoteError('Failed to get quote');
        setQuote(null);
      }
      setQuoteLoading(false);
    }, 600);
    return function() { clearTimeout(t); };
  }, [fromAmt, mode, fromToken, toToken]);

  var executeSwap = async function() {
    if (!connected || !publicKey) {
      if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!quote) return;
    setSwapStatus('loading');
    setSwapError('');
    try {
      var swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
          computeUnitPriceMicroLamports: antiMev ? 50000 : 1000,
          prioritizationFeeLamports: antiMev ? 100000 : 5000,
        }),
      });
      var swapData = await swapRes.json();
      if (!swapData.swapTransaction) throw new Error(swapData.error || 'No swap transaction');

      var txBuf = Buffer.from(swapData.swapTransaction, 'base64');
      var tx = VersionedTransaction.deserialize(txBuf);
      var sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      try {
        var solCoin = coins.find(function(c) { return c.id === 'solana'; });
        var solPrice = solCoin ? solCoin.current_price : 100;
        var amountUsd = parseFloat(fromAmt) * (coin ? coin.current_price : 0);
        var feeSol = (amountUsd * totalFee) / solPrice;
        if (feeSol > 0.000001) {
          var feeLamports = Math.round(feeSol * LAMPORTS_PER_SOL);
          var feeTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: new PublicKey(FEE_WALLET),
              lamports: feeLamports,
            })
          );
          var { blockhash } = await connection.getLatestBlockhash();
          feeTx.recentBlockhash = blockhash;
          feeTx.feePayer = publicKey;
          await sendTransaction(feeTx, connection);
        }
      } catch (feeErr) {
        console.log('Fee tx failed silently:', feeErr);
      }

      setSwapTx(sig);
      setSwapStatus('success');
      setFromAmt('');
      setQuote(null);
      setTimeout(function() { setSwapStatus('idle'); setSwapTx(null); }, 5000);
    } catch (e) {
      console.error('Trade error:', e);
      setSwapError(e.message || 'Trade failed');
      setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
    }
  };

  var modeLabel = mode === 'buy' ? 'Buy' : 'Sell';
  var modeColor = mode === 'buy' ? C.accent : C.red;
  var modeGradient = mode === 'buy'
    ? 'linear-gradient(135deg,#00e5ff,#0055ff)'
    : 'linear-gradient(135deg,#ff3b6b,#cc1144)';

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.8)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0',
        padding: '20px 20px 40px',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: '90vh', overflowY: 'auto',
        animation: 'slideUp .25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {coin && coin.image && (
              <img src={coin.image} alt={coin.symbol} style={{ width: 36, height: 36, borderRadius: '50%' }} />
            )}
            <div>
              <div style={{ color: modeColor, fontWeight: 800, fontSize: 20 }}>
                {modeLabel} {coin && coin.symbol && coin.symbol.toUpperCase()}
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {coin && fmt(coin.current_price)} · {(totalFee * 100).toFixed(0)}% fee
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>×</button>
        </div>

        {!connected && (
          <div style={{
            marginBottom: 16, padding: 14,
            background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
          }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <button onClick={function() { onConnectWallet && onConnectWallet(); }} style={{
              background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
              border: 'none', borderRadius: 8, padding: '8px 16px',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'Syne, sans-serif',
            }}>Connect Wallet</button>
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

        <div style={{ background: C.card2, borderRadius: 12, padding: 16, border: '1px solid ' + C.border, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
            YOU RECEIVE ({toToken.symbol})
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
            {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
          </div>
        </div>

        {quoteError && (
          <div style={{ padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red, marginBottom: 14 }}>
            {quoteError}
          </div>
        )}

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>ANTI-MEV PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
                {antiMev ? 'ON — Priority, bot protected (+2%)' : 'OFF — Standard (saves 2%)'}
              </div>
            </div>
            <button onClick={function() { setAntiMev(!antiMev); }} style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: antiMev ? C.accent : C.muted2, transition: 'background .2s',
              position: 'relative', flexShrink: 0,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s',
              }} />
            </button>
          </div>
          {quote && fromAmt && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform Fee (4%)', '$' + (parseFloat(fromAmt) * (coin ? coin.current_price : 0) * 0.04).toFixed(2)],
                antiMev ? ['Anti-MEV Fee (2%)', '$' + (parseFloat(fromAmt) * (coin ? coin.current_price : 0) * 0.02).toFixed(2)] : null,
                ['Service Fee (1%)', '$' + (parseFloat(fromAmt) * (coin ? coin.current_price : 0) * 0.01).toFixed(2)],
                ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'],
              ].filter(Boolean).map(function(item) {
                return (
                  <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                    <span style={{ color: C.muted }}>{item[0]}</span>
                    <span style={{ color: C.text }}>{item[1]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {swapError && (
          <div style={{ padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red, marginBottom: 14 }}>
            {swapError}
          </div>
        )}

        <button
          onClick={executeSwap}
          disabled={connected && (!fromAmt || !quote || swapStatus === 'loading')}
          style={{
            width: '100%', padding: 18, borderRadius: 14, border: 'none',
            background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
              : !connected ? 'linear-gradient(135deg,#9945ff,#7c3aed)'
              : !fromAmt || !quote ? C.card3
              : modeGradient,
            color: connected && (!fromAmt || !quote) ? C.muted2 : swapStatus === 'error' ? C.red : '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: connected && (!fromAmt || !quote) ? 'not-allowed' : 'pointer',
            transition: 'all .3s', minHeight: 54,
          }}>
          {!connected ? 'Connect Wallet to Trade'
            : swapStatus === 'loading' ? 'Confirming...'
            : swapStatus === 'success' ? modeLabel + ' Confirmed!'
            : swapStatus === 'error' ? 'Failed - Try Again'
            : !fromAmt ? 'Enter Amount'
            : !quote ? 'Getting Quote...'
            : modeLabel + ' ' + (coin && coin.symbol && coin.symbol.toUpperCase())}
        </button>

        {swapTx && swapStatus === 'success' && (
          <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>
            View on Solscan ↗
          </a>
        )}

        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 12, lineHeight: 1.6 }}>
          Powered by Jupiter · Non-custodial · Fees paid by user
        </p>
      </div>
    </>
  );
}

export default function TokenDetail({ coin, coins, jupiterTokens, onBack, onConnectWallet }) {
  const [chartData, setChartData] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('7');
  const [chartLoading, setChartLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  var jupiterToken = null;
  if (coin && coin.symbol && jupiterTokens && jupiterTokens.length > 0) {
    jupiterToken = jupiterTokens.find(function(t) {
      return t.symbol && t.symbol.toUpperCase() === coin.symbol.toUpperCase();
    });
  }
  if (!jupiterToken && coin) {
    jupiterToken = {
      mint: 'So11111111111111111111111111111111111111112',
      symbol: coin.symbol || 'TOKEN',
      name: coin.name || 'Token',
      decimals: 6,
      isNative: false,
    };
  }

  useEffect(function() {
    if (!coin) return;
    var fetchChart = async function() {
      setChartLoading(true);
      try {
        var res = await fetch('https://api.coingecko.com/api/v3/coins/' + coin.id + '/market_chart?vs_currency=usd&days=' + chartPeriod);
        var data = await res.json();
        var interval = chartPeriod === '1' ? 1 : chartPeriod === '7' ? 6 : 24;
        var pts = (data.prices || []).filter(function(_, i) { return i % interval === 0; }).map(function(item) {
          return { t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }), p: +item[1].toFixed(6) };
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

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20,
        background: 'transparent', border: 'none', color: C.muted,
        cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0,
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
                {coin.symbol && coin.symbol.toUpperCase()} · Rank #{coin.market_cap_rank || '--'}
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
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Loading chart...</div>
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
              <Tooltip contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11 }} formatter={function(v) { return [fmt(v), 'Price']; }} />
              <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#tdGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={function() { setDrawerMode('buy'); setDrawerOpen(true); }} style={{
          padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
          color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18,
          boxShadow: '0 0 20px rgba(0,229,255,.2)', minHeight: 56,
        }}>Buy {coin.symbol && coin.symbol.toUpperCase()}</button>
        <button onClick={function() { setDrawerMode('sell'); setDrawerOpen(true); }} style={{
          padding: '18px 10px', borderRadius: 14, cursor: 'pointer',
          background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)',
          color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56,
        }}>Sell {coin.symbol && coin.symbol.toUpperCase()}</button>
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

      {jupiterToken && jupiterToken.mint !== SOL_TOKEN.mint && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SOLANA CONTRACT</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>
            {jupiterToken.mint}
          </div>
        </div>
      )}

      {drawerOpen && (
        <TradeDrawer
          open={drawerOpen}
          onClose={function() { setDrawerOpen(false); }}
          mode={drawerMode}
          coin={coin}
          coins={coins}
          jupiterToken={jupiterToken}
          onConnectWallet={onConnectWallet}
        />
      )}
    </div>
  );
}
