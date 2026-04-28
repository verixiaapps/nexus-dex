import React, { useState, useEffect, useCallback } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.04;
const ANTIMEV_FEE = 0.02;

const POPULAR_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth', decimals: 6, logoURI: 'https://pyth.network/token.svg' },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'WETH', name: 'Wrapped Ether', decimals: 8, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
];

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
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

function TokenSelect({ selected, onSelect, jupiterTokens }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  var allTokens = jupiterTokens && jupiterTokens.length > 0 ? jupiterTokens : POPULAR_TOKENS;

  var isValidAddress = function(str) {
    return str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
  };

  var lookupByAddress = async function(addr) {
    if (!isValidAddress(addr)) return;
    setContractLoading(true);
    try {
      var found = allTokens.find(function(t) { return t.mint === addr; });
      if (found) {
        setContractToken(found);
      } else {
        var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr);
        if (res.ok) {
          var data = await res.json();
          setContractToken({
            mint: data.address,
            symbol: data.symbol,
            name: data.name,
            decimals: data.decimals,
            logoURI: data.logoURI,
          });
        } else {
          setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6 });
        }
      }
    } catch (e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6 });
    }
    setContractLoading(false);
  };

  useEffect(function() {
    if (!q) { setSearchResults([]); return; }
    var ql = q.toLowerCase();
    var results = allTokens.filter(function(t) {
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
        (t.name && t.name.toLowerCase().includes(ql)) ||
        (t.mint && t.mint.toLowerCase().includes(ql));
    }).slice(0, 100);
    setSearchResults(results);
  }, [q, allTokens]);

  var displayTokens = q ? searchResults : POPULAR_TOKENS;

  var close = function() {
    setOpen(false);
    setQ('');
    setContractAddr('');
    setContractToken(null);
    setSearchResults([]);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: C.card3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 90,
      }}>
        {selected && selected.logoURI && (
          <img src={selected.logoURI} alt={selected.symbol}
            style={{ width: 20, height: 20, borderRadius: '50%' }}
            onError={function(e) { e.target.style.display = 'none'; }} />
        )}
        {selected && !selected.logoURI && (
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.accent }}>
            {selected.symbol && selected.symbol.charAt(0)}
          </div>
        )}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 9 }}>▾</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            zIndex: 300, background: C.card,
            border: '1px solid ' + C.borderHi,
            borderRadius: 18, width: '94vw', maxWidth: 420,
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,.95)',
          }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
                  <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens — DYOR</div>
                </div>
                <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
              </div>
              <input
                autoFocus value={q}
                onChange={function(e) { setQ(e.target.value); }}
                placeholder="Search by name or symbol..."
                style={{
                  width: '100%', background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 8, padding: '10px 12px', color: C.text,
                  fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8,
                }}
              />
              <input
                value={contractAddr}
                onChange={function(e) { setContractAddr(e.target.value); }}
                onBlur={function() { if (contractAddr) lookupByAddress(contractAddr); }}
                placeholder="Or paste any Solana contract address..."
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
                  {contractToken.logoURI ? (
                    <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }}
                      onError={function(e) { e.target.style.display = 'none'; }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>
                      {contractToken.symbol && contractToken.symbol.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select →</div>
                </div>
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!q && (
                <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
                  POPULAR TOKENS
                </div>
              )}
              {q && searchResults.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  No tokens found.<br />
                  <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Paste the contract address above to find any token.</span>
                </div>
              )}
              {displayTokens.map(function(t) {
                return (
                  <div key={t.mint}
                    onClick={function() { onSelect(t); close(); }}
                    style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt={t.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
                        onError={function(e) { e.target.style.display = 'none'; }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
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

export default function SwapWidget({ coins, jupiterTokens, jupiterLoading, onGoToToken, onConnectWallet }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [fromToken, setFromToken] = useState(POPULAR_TOKENS[0]);
  const [toToken, setToToken] = useState(POPULAR_TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [slip, setSlip] = useState(0.5);
  const [antiMev, setAntiMev] = useState(true);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const [chartData, setChartData] = useState([]);
  const [selectedChart, setSelectedChart] = useState('bitcoin');
  const [customAddress, setCustomAddress] = useState('');
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(function() {
    var handleResize = function() { setIsMobile(window.innerWidth < 768); };
    window.addEventListener('resize', handleResize);
    return function() { window.removeEventListener('resize', handleResize); };
  }, []);

  var totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;

  var fetchQuote = useCallback(async function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    setQuoteLoading(true);
    setQuote(null);
    setQuoteError('');
    try {
      var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
      var url = 'https://api.jup.ag/swap/v1/quote' +
        '?inputMint=' + fromToken.mint +
        '&outputMint=' + toToken.mint +
        '&amount=' + amount +
        '&slippageBps=' + Math.round(slip * 100);
      var res = await fetch(url);
      var data = await res.json();
      if (data && data.outAmount) {
        setQuote({
          outAmount: data.outAmount,
          outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: data.priceImpactPct,
          quoteResponse: data,
        });
      } else if (data.error) {
        setQuoteError(data.error);
        setQuote(null);
      } else {
        setQuote(null);
      }
    } catch (e) {
      console.error('Quote error:', e);
      setQuoteError('Failed to get quote');
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
          destinationTokenAccount: useCustomAddress && customAddress ? customAddress : undefined,
        }),
      });
      var swapData = await swapRes.json();
      if (!swapData.swapTransaction) throw new Error(swapData.error || 'No swap transaction returned');

      var txBuf = Buffer.from(swapData.swapTransaction, 'base64');
      var tx = VersionedTransaction.deserialize(txBuf);
      var sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      // Collect fee in SOL
      try {
        var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
        var solCoin = coins.find(function(c) { return c.id === 'solana'; });
        var solPrice = solCoin ? solCoin.current_price : 100;
        var fromPriceVal = fromCoin ? fromCoin.current_price : 0;
        var amountUsd = parseFloat(fromAmt) * fromPriceVal;
        var feeSol = amountUsd > 0 ? (amountUsd * totalFee) / solPrice : parseFloat(fromAmt) * totalFee;
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
      console.error('Swap error:', e);
      setSwapError(e.message || 'Swap failed');
      setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
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
  var feeUsd = fromAmt && fromPriceVal ? (parseFloat(fromAmt) * fromPriceVal * totalFee).toFixed(2) : '0.00';
  var chartCoin = coins.find(function(c) { return c.id === selectedChart; });
  var chartColor = chartCoin && (chartCoin.price_change_percentage_7d_in_currency || 0) >= 0 ? C.green : C.red;

  var swapPanel = (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Swap Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Jupiter routing · {(totalFee * 100).toFixed(0)}% fee ·
          {jupiterLoading
            ? <span style={{ color: C.accent }}> Loading tokens...</span>
            : <span style={{ color: C.green }}> {jupiterTokens.length > 0 ? jupiterTokens.length.toLocaleString() : POPULAR_TOKENS.length} tokens</span>
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
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={fromToken} onSelect={setFromToken} />
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
            width: 36, height: 36, borderRadius: 10, background: C.card3,
            border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>⇅</button>
        </div>

        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={toToken} onSelect={setToToken} />
            <div style={{ flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
              {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
            </div>
          </div>
          {quote && toPriceVal > 0 && (
            <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>
          )}
        </div>

        {quoteError && (
          <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red }}>
            {quoteError}
          </div>
        )}

        <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>ANTI-MEV PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>
                {antiMev ? 'ON — Priority processing, bot protected (+2%)' : 'OFF — Standard processing (saves 2%)'}
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
                ['Platform Fee (4%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.04).toFixed(2)],
                antiMev ? ['Anti-MEV Fee (2%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.02).toFixed(2)] : null,
                ['Service Fee (1%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.01).toFixed(2)],
                ['Total Fee (' + (totalFee * 100).toFixed(0) + '%)', '$' + feeUsd],
                ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'],
                ['Min Received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken ? toToken.symbol : '')],
              ].filter(Boolean).map(function(item) {
                return (
                  <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                    <span style={{ color: C.muted }}>{item[0]}</span>
                    <span style={{ color: item[0].includes('Total') ? C.accent : C.text }}>{item[1]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
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

        {swapError && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red }}>
            {swapError}
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
              cursor: !fromAmt || !quote ? 'not-allowed' : 'pointer', transition: 'all .3s', minHeight: 52,
            }}>
            {swapStatus === 'loading' ? 'Confirming...'
              : swapStatus === 'success' ? 'Swap Confirmed!'
              : swapStatus === 'error' ? 'Failed - Try Again'
              : !fromAmt ? 'Enter Amount'
              : !quote ? 'Getting Best Route...'
              : 'Swap ' + (fromToken ? fromToken.symbol : '') + ' → ' + (toToken ? toToken.symbol : '')}
          </button>
        ) : (
          <button onClick={onConnectWallet} style={{
            width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
            color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
            cursor: 'pointer', minHeight: 52,
          }}>Connect Wallet to Swap</button>
        )}

        {swapTx && swapStatus === 'success' && (
          <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}>
            View on Solscan ↗
          </a>
        )}

        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>
          Non-custodial · No KYC · Fees paid by user
        </p>
      </div>
    </div>
  );

  var chartPanel = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {coins.slice(0, 10).map(function(c) {
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

      {chartCoin && (
        <div onClick={function() { if (onGoToToken) onGoToToken(chartCoin); }}
          style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 18, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {chartCoin.image && <img src={chartCoin.image} alt={chartCoin.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{chartCoin.name}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>Tap to view token page</div>
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#fff', marginTop: 6 }}>{fmt(chartCoin.current_price)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>24H</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: (chartCoin.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                {pct(chartCoin.price_change_percentage_24h)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Vol: {fmt(chartCoin.total_volume)}</div>
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
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>Loading chart...</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6, marginTop: 12 }}>
            {[
              ['24H High', fmt(chartCoin.high_24h)],
              ['24H Low', fmt(chartCoin.low_24h)],
              ['Market Cap', fmt(chartCoin.market_cap)],
              ['Volume', fmt(chartCoin.total_volume)],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ background: '#050912', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>{item[0]}</div>
                  <div style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>{item[1]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {swapPanel}
          {chartPanel}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 480px) 1fr', gap: 24, alignItems: 'start' }}>
          {swapPanel}
          {chartPanel}
        </div>
      )}
    </div>
  );
}
