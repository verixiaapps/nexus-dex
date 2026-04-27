import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
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

const FALLBACK_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'ETH', name: 'Ethereum', decimals: 8 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9 },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6 },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6 },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth', decimals: 6 },
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
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);

  var isValidAddress = function(str) {
    return str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
  };

  var lookupContract = async function(addr) {
    if (!isValidAddress(addr)) return;
    setContractLoading(true);
    try {
      var found = tokens.find(function(t) { return t.mint === addr; });
      if (found) {
        setContractToken(found);
      } else {
        setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6 });
      }
    } catch (e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6 });
    }
    setContractLoading(false);
  };

  var filtered = tokens.filter(function(t) {
    if (!q) return true;
    var ql = q.toLowerCase();
    return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
      (t.name && t.name.toLowerCase().includes(ql)) ||
      (t.mint && t.mint.toLowerCase().includes(ql));
  }).slice(0, 100);

  var close = function() {
    setOpen(false);
    setQ('');
    setContractAddr('');
    setContractToken(null);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: C.card3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 85,
      }}>
        {selected && selected.logoURI && (
          <img src={selected.logoURI} alt={selected.symbol} style={{ width: 18, height: 18, borderRadius: '50%' }}
            onError={function(e) { e.target.style.display = 'none'; }} />
        )}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 9 }}>▾</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 300, background: C.card,
            border: '1px solid ' + C.borderHi,
            borderRadius: 18, width: '94vw', maxWidth: 420,
            maxHeight: '88vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,.95)',
          }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
                  <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens - DYOR</div>
                </div>
                <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>x</button>
              </div>
              <input
                autoFocus value={q}
                onChange={function(e) { setQ(e.target.value); }}
                placeholder="Search name, symbol or address..."
                style={{
                  width: '100%', background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 8, padding: '10px 12px', color: C.text,
                  fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8,
                }}
              />
              <input
                value={contractAddr}
                onChange={function(e) { setContractAddr(e.target.value); }}
                onBlur={function() { if (contractAddr) lookupContract(contractAddr); }}
                placeholder="Or paste contract address..."
                style={{
                  width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
                  borderRadius: 8, padding: '10px 12px', color: C.accent,
                  fontSize: 12, outline: 'none', fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
              {contractToken && !contractLoading && (
                <div onClick={function() { onSelect(contractToken); close(); }}
                  style={{
                    marginTop: 8, padding: '10px 12px',
                    background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)',
                    borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>
                    {contractToken.symbol.charAt(0)}
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
                </div>
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filtered.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  No tokens found. Try pasting a contract address.
                </div>
              )}
              {filtered.map(function(t) {
                return (
                  <div key={t.mint}
                    onClick={function() { onSelect(t); close(); }}
                    style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt={t.symbol} style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }}
                        onError={function(e) { e.target.style.display = 'none'; }} />
                    ) : (
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                        {t.symbol && t.symbol.charAt(0)}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                      <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    </div>
                    <div style={{ color: C.muted2, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                      {t.mint && t.mint.slice(0, 4) + '...' + t.mint.slice(-4)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function SwapWidget({ coins, initialFromToken, initialToToken, onTokensUsed }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [tokens, setTokens] = useState(FALLBACK_TOKENS);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [fromToken, setFromToken] = useState(initialFromToken || FALLBACK_TOKENS[0]);
  const [toToken, setToToken] = useState(initialToToken || FALLBACK_TOKENS[1]);
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
  const [showChart, setShowChart] = useState(true);

  useEffect(function() {
    if (initialFromToken) { setFromToken(initialFromToken); }
    if (initialToToken) { setToToken(initialToToken); }
    if ((initialFromToken || initialToToken) && onTokensUsed) onTokensUsed();
  }, [initialFromToken, initialToToken]);

  useEffect(function() {
    var fetchTokens = async function() {
      setTokensLoading(true);
      try {
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 10000);
        var res = await fetch('https://token.jup.ag/all', { signal: controller.signal });
        clearTimeout(timeout);
        var data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          var mapped = data.map(function(t) {
            return { mint: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.logoURI };
          });
          setTokens(mapped);
        }
      } catch (e) {
        console.log('Jupiter token fetch failed, using fallback');
      }
      setTokensLoading(false);
    };
    fetchTokens();
  }, []);

  var fetchQuote = useCallback(async function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) return;
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
      } else {
        setQuote(null);
      }
    } catch (e) {
      setQuote(null);
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
      var swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
          feeAccount: JUPITER_REFERRAL_KEY,
          destinationTokenAccount: useCustomAddress && customAddress ? customAddress : undefined,
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
    var tmp = fromToken;
    setFromToken(toToken);
    setToToken(tmp);
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
    <div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 480 }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Swap Tokens</h1>
            <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
              Jupiter routing · 0.3% fee paid by user
              {tokensLoading
                ? <span style={{ color: C.accent, marginLeft: 6 }}>· Loading tokens...</span>
                : <span style={{ color: C.green, marginLeft: 6 }}>· {tokens.length.toLocaleString()} tokens</span>
              }
            </p>
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 18 }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0.1, 0.5, 1.0].map(function(v) {
                  return (
                    <button key={v} onClick={function() { setSlip(v); }} style={{
                      padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent',
                      border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border),
                      color: slip === v ? C.accent : C.muted,
                    }}>{v}%</button>
                  );
                })}
              </div>
            </div>

            <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border, marginBottom: 4 }}>
              <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TokenSelect tokens={tokens} selected={fromToken} onSelect={setFromToken} />
                <input value={fromAmt}
                  onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
                  placeholder="0.00"
                  style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none', minWidth: 0 }}
                />
              </div>
              {fromAmt && fromPriceVal > 0 && (
                <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(fromAmt) * fromPriceVal)}</div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
              <button onClick={flipTokens} style={{
                width: 34, height: 34, borderRadius: 10, background: C.card3,
                border: '1px solid ' + C.border, cursor: 'pointer',
                color: C.accent, fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>⇅</button>
            </div>

            <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
              <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TokenSelect tokens={tokens} selected={toToken} onSelect={setToToken} />
                <div style={{ flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
                  {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
                </div>
              </div>
              {quote && toPriceVal > 0 && (
                <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={useCustomAddress}
                  onChange={function(e) { setUseCustomAddress(e.target.checked); }}
                  style={{ cursor: 'pointer', width: 14, height: 14 }}
                />
                <span style={{ fontSize: 12, color: C.muted }}>Send to different wallet</span>
              </label>
              {useCustomAddress && (
                <input value={customAddress}
                  onChange={function(e) { setCustomAddress(e.target.value); }}
                  placeholder="Paste Solana wallet address..."
                  style={{
                    width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
                    borderRadius: 10, padding: '10px 12px', color: C.accent,
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 11, outline: 'none', marginTop: 8,
                  }}
                />
              )}
            </div>

            {quote && fromAmt && (
              <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
                {[
                  ['Fee (0.3% by user)', '$' + feeUsd],
                  ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'],
                  ['Min Received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken ? toToken.symbol : '')],
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

            {connected ? (
              <button onClick={executeSwap}
                disabled={!fromAmt || parseFloat(fromAmt) <= 0 || !quote || swapStatus === 'loading'}
                style={{
                  width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                  background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                    : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
                    : !fromAmt || !quote ? C.card2
                    : 'linear-gradient(135deg,#00e5ff,#0055ff)',
                  color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg,
                  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                  cursor: !fromAmt || !quote ? 'not-allowed' : 'pointer', transition: 'all .3s',
                }}>
                {swapStatus === 'loading' ? 'Confirming in Wallet...'
                  : swapStatus === 'success' ? 'Swap Confirmed!'
                  : swapStatus === 'error' ? 'Failed - Try Again'
                  : !fromAmt ? 'Enter Amount'
                  : !quote ? 'Getting Best Route...'
                  : 'Swap ' + (fromToken ? fromToken.symbol : '') + ' to ' + (toToken ? toToken.symbol : '')}
              </button>
            ) : (
              <div style={{ marginTop: 14 }}>
                <WalletMultiButton style={{
                  width: '100%', padding: 16, borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
                  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                  justifyContent: 'center', height: 'auto',
                }} />
              </div>
            )}

            {swapTx && swapStatus === 'success' && (
              <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 11, color: C.accent }}>
                View on Solscan ↗
              </a>
            )}

            <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>
              Non-custodial · No KYC · Fee paid by user
            </p>
          </div>
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {coins.slice(0, 8).map(function(c) {
                return (
                  <button key={c.id} onClick={function() { setSelectedChart(c.id); }} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600,
                    background: selectedChart === c.id ? 'rgba(0,229,255,.12)' : 'transparent',
                    border: '1px solid ' + (selectedChart === c.id ? 'rgba(0,229,255,.35)' : C.border),
                    color: selectedChart === c.id ? C.accent : C.muted,
                  }}>{c.symbol && c.symbol.toUpperCase()}</button>
                );
              })}
            </div>
            <button onClick={function() { setShowChart(!showChart); }} style={{
              background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6,
              color: C.muted, fontSize: 10, cursor: 'pointer', padding: '4px 8px',
            }}>{showChart ? 'Hide' : 'Show'} Chart</button>
          </div>

          {showChart && chartCoin && (
            <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{chartCoin.name}</div>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#fff', marginTop: 3 }}>{fmt(chartCoin.current_price)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>24H</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: (chartCoin.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                    {pct(chartCoin.price_change_percentage_24h)}
                  </div>
                </div>
              </div>

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="swapGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColor} stopOpacity={.25} />
                        <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11 }} formatter={function(v) { return [fmt(v), 'Price']; }} />
                    <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#swapGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Loading...</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 14 }}>
                {[
                  ['24H High', fmt(chartCoin.high_24h)],
                  ['24H Low', fmt(chartCoin.low_24h)],
                  ['Market Cap', fmt(chartCoin.market_cap)],
                  ['Volume', fmt(chartCoin.total_volume)],
                ].map(function(item) {
                  return (
                    <div key={item[0]} style={{ background: '#050912', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>{item[0]}</div>
                      <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{item[1]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
