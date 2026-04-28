import React, { useState, useEffect } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.04;
const ANTIMEV_FEE = 0.02;
const JUP_API_KEY = process.env.REACT_APP_JUPITER_API_KEY1 || '';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const SOL_TOKEN = { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' };
const USDC_TOKEN = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' };

const POPULAR_TOKENS = [
  SOL_TOKEN,
  USDC_TOKEN,
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
];

function getDecimals(token) {
  if (!token) return 6;
  var d = parseInt(token.decimals);
  return isNaN(d) ? 6 : d;
}

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

function TokenSelect({ selected, onSelect, jupiterTokens, label }) {
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
        var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr, {
          headers: { 'x-api-key': JUP_API_KEY }
        });
        if (res.ok) {
          var data = await res.json();
          setContractToken({
            mint: data.address,
            symbol: data.symbol,
            name: data.name,
            decimals: parseInt(data.decimals) || 6,
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
    setSearchResults(allTokens.filter(function(t) {
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
        (t.name && t.name.toLowerCase().includes(ql)) ||
        (t.mint && t.mint.toLowerCase().includes(ql));
    }).slice(0, 100));
  }, [q, allTokens]);

  var displayTokens = q ? searchResults : POPULAR_TOKENS;
  var close = function() { setOpen(false); setQ(''); setContractAddr(''); setContractToken(null); setSearchResults([]); };

  return (
    <div>
      {label && <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>{label}</div>}
      <button onClick={() => setOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: C.card2, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '10px 14px', cursor: 'pointer', width: '100%',
      }}>
        {selected && selected.logoURI ? (
          <img src={selected.logoURI} alt={selected.symbol} style={{ width: 24, height: 24, borderRadius: '50%' }}
            onError={function(e) { e.target.style.display = 'none'; }} />
        ) : selected ? (
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>
            {selected.symbol && selected.symbol.charAt(0)}
          </div>
        ) : null}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, flex: 1, textAlign: 'left' }}>
          {selected ? selected.symbol : 'Select Token'}
        </span>
        <span style={{ color: C.muted, fontSize: 11 }}>▾</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.75)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
            borderRadius: 18, width: '94vw', maxWidth: 420,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,.95)',
          }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
                  <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified — DYOR</div>
                </div>
                <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
              </div>
              <input autoFocus value={q} onChange={function(e) { setQ(e.target.value); }}
                placeholder="Search by name or symbol..."
                style={{ width: '100%', background: C.card3, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8 }}
              />
              <input value={contractAddr} onChange={function(e) { setContractAddr(e.target.value); }}
                onBlur={function() { if (contractAddr) lookupByAddress(contractAddr); }}
                placeholder="Or paste any Solana contract address..."
                style={{ width: '100%', background: C.card3, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
              />
              {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
              {contractToken && !contractLoading && (
                <div onClick={function() { onSelect(contractToken); close(); }}
                  style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {contractToken.logoURI ? (
                    <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>
                      {contractToken.symbol && contractToken.symbol.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
                    <div style={{ color: C.muted2, fontSize: 10 }}>Decimals: {getDecimals(contractToken)}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select →</div>
                </div>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>POPULAR TOKENS</div>}
              {q && searchResults.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
                  No tokens found.<br /><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Paste contract address above.</span>
                </div>
              )}
              {displayTokens.map(function(t) {
                return (
                  <div key={t.mint} onClick={function() { onSelect(t); close(); }}
                    style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {t.logoURI ? (
                      <img src={t.logoURI} alt={t.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
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

function TradeDrawer({ open, onClose, mode, coin, jupiterToken, jupiterTokens, coins, onConnectWallet, isConnected, isSolanaConnected }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [fromToken, setFromToken] = useState(SOL_TOKEN);
  const [toToken, setToToken] = useState(jupiterToken || USDC_TOKEN);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const [antiMev, setAntiMev] = useState(true);

  var totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;

  useEffect(function() {
    if (mode === 'buy') {
      setFromToken(SOL_TOKEN);
      setToToken(jupiterToken || USDC_TOKEN);
    } else {
      setFromToken(jupiterToken || USDC_TOKEN);
      setToToken(USDC_TOKEN);
    }
    setFromAmt(''); setQuote(null); setSwapStatus('idle');
    setSwapTx(null); setSwapError(''); setQuoteError('');
  }, [open, mode, jupiterToken]);

  useEffect(function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) { setQuote(null); return; }
    var t = setTimeout(async function() {
      setQuoteLoading(true); setQuoteError('');
      try {
        var fromDecimals = getDecimals(fromToken);
        var toDecimals = getDecimals(toToken);
        var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromDecimals));
        if (!amount || amount <= 0) { setQuoteLoading(false); return; }
        var url = 'https://api.jup.ag/swap/v1/quote' +
          '?inputMint=' + fromToken.mint +
          '&outputMint=' + toToken.mint +
          '&amount=' + amount +
          '&slippageBps=50' +
          '&restrictIntermediateTokens=true';
        var res = await fetch(url, { headers: { 'x-api-key': JUP_API_KEY } });
        var data = await res.json();
        if (data && data.outAmount) {
          var outAmt = parseInt(data.outAmount) / Math.pow(10, toDecimals);
          setQuote({
            outAmountDisplay: outAmt.toFixed(toDecimals > 4 ? 4 : toDecimals),
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
  }, [fromAmt, fromToken, toToken]);

  var executeSwap = async function() {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!isSolanaConnected || !publicKey) { setSwapError('Please connect a Solana wallet to trade'); return; }
    if (!quote) return;
    setSwapStatus('loading'); setSwapError('');
    try {
      var swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': JUP_API_KEY },
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
        var fromCoinData = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
        var fromPrice = fromCoinData ? fromCoinData.current_price : (coin ? coin.current_price : 0);
        var amountUsd = parseFloat(fromAmt) * fromPrice;
        var feeSol = (amountUsd * totalFee) / solPrice;
        if (feeSol > 0.000001) {
          var feeTx = new Transaction().add(SystemProgram.transfer({
            fromPubkey: publicKey, toPubkey: new PublicKey(FEE_WALLET), lamports: Math.round(feeSol * LAMPORTS_PER_SOL),
          }));
          var { blockhash } = await connection.getLatestBlockhash();
          feeTx.recentBlockhash = blockhash; feeTx.feePayer = publicKey;
          await sendTransaction(feeTx, connection);
        }
      } catch (feeErr) { console.log('Fee tx failed silently:', feeErr); }

      setSwapTx(sig); setSwapStatus('success'); setFromAmt(''); setQuote(null);
      setTimeout(function() { setSwapStatus('idle'); setSwapTx(null); }, 5000);
    } catch (e) {
      console.error('Trade error:', e);
      setSwapError(e.message || 'Trade failed');
      setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
    }
  };

  var modeLabel = mode === 'buy' ? 'Buy' : 'Sell';
  var modeGradient = mode === 'buy' ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'linear-gradient(135deg,#ff3b6b,#cc1144)';
  var fromCoinData = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  var fromPriceVal = fromCoinData ? fromCoinData.current_price : 0;
  var toCoinData = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  var toPriceVal = toCoinData ? toCoinData.current_price : 0;

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.8)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0', padding: '20px 20px 40px',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: '92vh', overflowY: 'auto', animation: 'slideUp .25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {coin && coin.image && <img src={coin.image} alt={coin.symbol} style={{ width: 32, height: 32, borderRadius: '50%' }} />}
            <div>
              <div style={{ color: mode === 'buy' ? C.accent : C.red, fontWeight: 800, fontSize: 18 }}>
                {modeLabel} {coin && coin.symbol && coin.symbol.toUpperCase()}
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                {coin && fmt(coin.current_price)} · {(totalFee * 100).toFixed(0)}% fee
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>×</button>
        </div>

        {!isConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Connect wallet to trade</span>
            <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
          </div>
        )}

        {isConnected && !isSolanaConnected && (
          <div style={{ marginBottom: 16, padding: 14, background: 'rgba(255,59,107,.05)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 12 }}>
            <span style={{ color: C.red, fontSize: 13 }}>Solana wallet required. Please connect Phantom.</span>
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <TokenSelect selected={fromToken} onSelect={setFromToken} jupiterTokens={jupiterTokens} label="YOU PAY" />
          <div style={{ marginTop: 8 }}>
            <input value={fromAmt} onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
              placeholder="0.00"
              style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '14px 16px', fontSize: 26, fontWeight: 600, color: '#fff', outline: 'none' }}
            />
            {fromAmt && fromPriceVal > 0 && (
              <div style={{ textAlign: 'right', marginTop: 4, fontSize: 11, color: C.muted }}>{fmt(parseFloat(fromAmt) * fromPriceVal)}</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
          <button onClick={function() {
            var tmp = fromToken; setFromToken(toToken); setToToken(tmp);
            setFromAmt(''); setQuote(null);
          }} style={{
            width: 36, height: 36, borderRadius: 10, background: C.card3,
            border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>⇅</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <TokenSelect selected={toToken} onSelect={setToToken} jupiterTokens={jupiterTokens} label="YOU RECEIVE" />
          <div style={{ marginTop: 8, background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>
              {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
            </div>
            {quote && toPriceVal > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>
            )}
          </div>
        </div>

        {quoteError && (
          <div style={{ padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red, marginBottom: 12 }}>
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
              background: antiMev ? C.accent : C.muted2, transition: 'background .2s', position: 'relative', flexShrink: 0,
            }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
            </button>
          </div>
          {quote && fromAmt && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform Fee (4%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.04).toFixed(2)],
                antiMev ? ['Anti-MEV Fee (2%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.02).toFixed(2)] : null,
                ['Service Fee (1%)', '$' + (parseFloat(fromAmt) * fromPriceVal * 0.01).toFixed(2)],
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

        <button onClick={executeSwap}
          disabled={isConnected && isSolanaConnected && (!fromAmt || !quote || swapStatus === 'loading')}
          style={{
            width: '100%', padding: 18, borderRadius: 14, border: 'none',
            background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
              : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
              : !isConnected ? 'linear-gradient(135deg,#9945ff,#7c3aed)'
              : isConnected && !isSolanaConnected ? 'rgba(255,59,107,.2)'
              : !fromAmt || !quote ? C.card3
              : modeGradient,
            color: isConnected && isSolanaConnected && (!fromAmt || !quote) ? C.muted2 : '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            cursor: isConnected && isSolanaConnected && (!fromAmt || !quote) ? 'not-allowed' : 'pointer',
            transition: 'all .3s', minHeight: 54,
          }}>
          {!isConnected ? 'Connect Wallet to Trade'
            : !isSolanaConnected ? 'Solana Wallet Required'
            : swapStatus === 'loading' ? 'Confirming...'
            : swapStatus === 'success' ? modeLabel + ' Confirmed!'
            : swapStatus === 'error' ? 'Failed - Try Again'
            : !fromAmt ? 'Enter Amount'
            : !quote ? 'Getting Quote...'
            : modeLabel + ' ' + (toToken ? toToken.symbol : '')}
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

export default function TokenDetail({ coin, coins, jupiterTokens, onBack, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
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
      mint: SOL_TOKEN.mint,
      symbol: coin.symbol || 'TOKEN',
      name: coin.name || 'Token',
      decimals: 6,
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
        setChartData((data.prices || []).filter(function(_, i) { return i % interval === 0; }).map(function(item) {
          return { t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }), p: +item[1].toFixed(6) };
        }));
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
                color: chartPeriod === item[0] ? C.accent : C.muted, fontFamily: 'Syne, sans-serif',
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
          ['Market Cap', fmt(coin.market_cap)], ['24H Volume', fmt(coin.total_volume)],
          ['24H High', fmt(coin.high_24h)], ['24H Low', fmt(coin.low_24h)],
          ['All Time High', fmt(coin.ath)], ['ATH Change', pct(coin.ath_change_percentage)],
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
          jupiterTokens={jupiterTokens}
          onConnectWallet={onConnectWallet}
          isConnected={isConnected}
          isSolanaConnected={isSolanaConnected}
        />
      )}
    </div>
  );
}
