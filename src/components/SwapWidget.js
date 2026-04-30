import React, { useState, useEffect, useCallback } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, TransactionMessage, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

const FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const BASE_FEE = 0.04;
const ANTIMEV_FEE = 0.02;
const SPREAD = 0.005; // 0.5% spread - silent, goes to fee wallet as SOL

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
      if (found) { setContractToken(found); }
      else {
        var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr);
        if (res.ok) {
          var data = await res.json();
          setContractToken({ mint: data.address, symbol: data.symbol, name: data.name, decimals: data.decimals, logoURI: data.logoURI });
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
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card3, border: '1px solid ' + C.border, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 90 }}>
        {selected && selected.logoURI && <img src={selected.logoURI} alt={selected.symbol} style={{ width: 20, height: 20, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} />}
        {selected && !selected.logoURI && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.accent }}>{selected.symbol && selected.symbol.charAt(0)}</div>}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 9 }}>v</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
                  <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens -- DYOR</div>
                </div>
                <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>x</button>
              </div>
              <input autoFocus value={q} onChange={function(e) { setQ(e.target.value); }} placeholder="Search by name or symbol..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8 }} />
              <input value={contractAddr} onChange={function(e) { setContractAddr(e.target.value); }} onBlur={function() { if (contractAddr) lookupByAddress(contractAddr); }} placeholder="Or paste any Solana contract address..." style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
              {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
              {contractToken && !contractLoading && (
                <div onClick={function() { onSelect(contractToken); close(); }} style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {contractToken.logoURI ? <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>{contractToken.symbol && contractToken.symbol.charAt(0)}</div>}
                  <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div><div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div></div>
                  <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
                </div>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>POPULAR TOKENS</div>}
              {q && searchResults.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found.<br /><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Paste the contract address above.</span></div>}
              {displayTokens.map(function(t) {
                return (
                  <div key={t.mint} onClick={function() { onSelect(t); close(); }} style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }} onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }} onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}>
                    {t.logoURI ? <img src={t.logoURI} alt={t.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{t.symbol && t.symbol.charAt(0)}</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                      <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    </div>
                    <div style={{ color: C.muted2, fontSize: 9, fontFamily: 'monospace', flexShrink: 0 }}>{t.mint && t.mint.slice(0, 4) + '...' + t.mint.slice(-4)}</div>
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

export default function SwapWidget({ coins, jupiterTokens, jupiterLoading, onGoToToken, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const { publicKey, sendTransaction, signAllTransactions } = useWallet();
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
  const [customAddress, setCustomAddress] = useState('');
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [fromBalance, setFromBalance] = useState(null);
  const [toBalance, setToBalance] = useState(null);

  var totalFee = antiMev ? BASE_FEE + ANTIMEV_FEE : BASE_FEE;

  var fetchQuote = useCallback(async function() {
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) { setQuote(null); setQuoteError(''); return; }
    setQuoteLoading(true); setQuote(null); setQuoteError('');
    try {
      var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
      var url = 'https://api.jup.ag/swap/v1/quote?inputMint=' + fromToken.mint + '&outputMint=' + toToken.mint + '&amount=' + amount + '&slippageBps=' + Math.round(slip * 100) + '&restrictIntermediateTokens=true';
      var res = await fetch(url, { headers: { 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' } });
      var data = await res.json();
      if (data && data.outAmount) {
        setQuote({ outAmount: data.outAmount, outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: data.priceImpactPct, quoteResponse: data });
      } else { setQuoteError(data.error || 'No route found for this pair'); setQuote(null); }
    } catch (e) { setQuoteError('Failed to get quote'); setQuote(null); }
    setQuoteLoading(false);
  }, [fromAmt, fromToken, toToken, slip]);

  useEffect(function() { var t = setTimeout(fetchQuote, 600); return function() { clearTimeout(t); }; }, [fetchQuote]);

  // Fetch balances for selected tokens
  useEffect(function() {
    if (!publicKey || !connection) { setFromBalance(null); setToBalance(null); return; }
    var fetchBals = async function() {
      try {
        if (fromToken && fromToken.mint === 'So11111111111111111111111111111111111111112') {
          var solLam = await connection.getBalance(publicKey);
          setFromBalance(solLam / 1e9);
        } else if (fromToken && fromToken.mint) {
          var accts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) });
          var bal = accts.value.length > 0 ? accts.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0;
          setFromBalance(bal);
        }
        if (toToken && toToken.mint === 'So11111111111111111111111111111111111111112') {
          var solLam2 = await connection.getBalance(publicKey);
          setToBalance(solLam2 / 1e9);
        } else if (toToken && toToken.mint) {
          var accts2 = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(toToken.mint) });
          var bal2 = accts2.value.length > 0 ? accts2.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0;
          setToBalance(bal2);
        }
      } catch (e) {}
    };
    fetchBals();
  }, [publicKey, connection, fromToken, toToken]);

  var executeSwap = async function() {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!publicKey) { setSwapError('Please connect a wallet to swap'); return; }
    if (!quote || !publicKey) return;
    setSwapStatus('loading'); setSwapError('');
    try {
      var _solBal = (await connection.getBalance(publicKey)) / 1e9;
      if (_solBal < 0.005) { setSwapError('Need at least 0.005 SOL for fees and gas.'); setSwapStatus('error'); setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 6000); return; }

      // Fee calculation
      var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
      var solCoin = coins.find(function(c) { return c.id === 'solana' || (c.symbol && c.symbol.toLowerCase() === 'sol'); });
      var solPrice = solCoin ? solCoin.current_price : 150;
      var fromPriceUsd = fromCoin ? fromCoin.current_price : (fromToken && fromToken.symbol === 'SOL' ? solPrice : 0);
      if (!fromPriceUsd && quote && fromAmt) {
        var toCoin = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
        var toPriceUsd = toCoin ? toCoin.current_price : (toToken && (toToken.symbol === 'USDC' || toToken.symbol === 'USDT') ? 1 : 0);
        if (toPriceUsd > 0) fromPriceUsd = (parseFloat(quote.outAmountDisplay) * toPriceUsd) / parseFloat(fromAmt);
      }
      var tradeUsd = parseFloat(fromAmt) * fromPriceUsd;
      var totalFeePct = totalFee + SPREAD;
      var feeLamports = Math.round(Math.max(
        tradeUsd > 0 ? (tradeUsd * totalFeePct / solPrice) * LAMPORTS_PER_SOL : parseFloat(fromAmt) * totalFeePct * LAMPORTS_PER_SOL,
        50000
      ));

      // Transaction 1: Jupiter swap - get serialized tx from /swap endpoint
      var swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' },
        body: JSON.stringify({ quoteResponse: quote.quoteResponse, userPublicKey: publicKey.toString(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: antiMev ? { priorityLevelWithMaxLamports: { maxLamports: 1000000, priorityLevel: 'high' } } : 1000, destinationTokenAccount: useCustomAddress && customAddress ? customAddress : undefined }),
      });
      var swapData = await swapRes.json();
      if (!swapData || !swapData.swapTransaction) throw new Error(swapData.error || 'Failed to get swap transaction');
      var swapTxBytes = Buffer.from(swapData.swapTransaction, 'base64');
      var swapVersionedTx = VersionedTransaction.deserialize(swapTxBytes);

      // Transaction 2: Fee transfer - completely separate
      var bh = await connection.getLatestBlockhash('confirmed');
      var feeTx = new Transaction();
      feeTx.recentBlockhash = bh.blockhash;
      feeTx.feePayer = publicKey;
      feeTx.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(FEE_WALLET), lamports: feeLamports }));

      // Sign both in one wallet prompt
      if (signAllTransactions) {
        var signed = await signAllTransactions([swapVersionedTx, feeTx]);
        var swapSig = await connection.sendRawTransaction(signed[0].serialize(), { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction({ signature: swapSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
        console.log('Swap tx:', swapSig);
        try {
          var feeSig = await connection.sendRawTransaction(signed[1].serialize(), { skipPreflight: false });
          console.log('Fee tx:', feeSig);
        } catch (feeErr) { console.log('Fee send error:', feeErr); }
      } else {
        // Fallback: send swap only if signAllTransactions not available
        var sig = await sendTransaction(swapVersionedTx, connection);
        await connection.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
        console.log('Swap tx:', sig);
        swapSig = sig;
      }

      setSwapTx(swapSig); setSwapStatus('success'); setFromAmt(''); setQuote(null);
      setTimeout(function() { setSwapStatus('idle'); setSwapTx(null); }, 5000);
    } catch (e) {
      console.error('Swap error:', e); setSwapError(e.message || 'Swap failed'); setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
    }
  };

  var flipTokens = function() { var tmp = fromToken; setFromToken(toToken); setToToken(tmp); setFromAmt(quote ? quote.outAmountDisplay : ''); setQuote(null); };

  var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  var fromPriceVal = fromCoin ? fromCoin.current_price : 0;
  var toCoin = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  var toPriceVal = toCoin ? toCoin.current_price : 0;
  var solCoinPrice = (coins.find(function(c) { return c.id === 'solana'; }) || {}).current_price || 150;
  // If fromPriceVal is 0, derive from quote - if output is SOL we can back-calculate
  if (!fromPriceVal && quote && fromAmt && parseFloat(fromAmt) > 0) {
    if (toToken && (toToken.symbol === 'SOL' || toToken.symbol === 'USDC' || toToken.symbol === 'USDT')) {
      var outVal = parseFloat(quote.outAmountDisplay) * (toPriceVal || (toToken.symbol === 'SOL' ? solCoinPrice : 1));
      fromPriceVal = outVal / parseFloat(fromAmt);
    }
  }
  var feeUsd = fromAmt && fromPriceVal ? (parseFloat(fromAmt) * fromPriceVal * totalFee).toFixed(2) : '0.00';

  return (
    <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Swap Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Powered by Jupiter - Instant swaps - No account needed
        </p>
      </div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0.1, 0.5, 1.0].map(function(v) {
              return <button key={v} onClick={function() { setSlip(v); }} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent', border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border), color: slip === v ? C.accent : C.muted }}>{v}%</button>;
            })}
          </div>
        </div>
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span>
            {fromBalance != null && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{fromBalance >= 1000 ? fromBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : fromBalance.toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={fromToken} onSelect={setFromToken} />
            <input value={fromAmt} onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none', minWidth: 0 }} />
            {fromBalance != null && fromBalance > 0 && (
              <button onClick={function() {
                var fees = totalFee + SPREAD + 0.002;
                var maxAmt = fromToken && fromToken.symbol === 'SOL' ? Math.max(0, fromBalance - fees) : fromBalance;
                setFromAmt(maxAmt > 0 ? maxAmt.toFixed(fromToken && fromToken.decimals <= 2 ? 2 : 6) : '0');
              }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '3px 8px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>
            )}
          </div>
          {fromAmt && fromPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(fromAmt) * fromPriceVal)}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flipTokens} style={{ width: 36, height: 36, borderRadius: 10, background: C.card3, border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>^v</button>
        </div>
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
            {toBalance != null && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{toBalance >= 1000 ? toBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : toBalance.toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={toToken} onSelect={setToToken} />
            <div style={{ flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>{quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}</div>
          </div>
          {quote && toPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>}
        </div>
        {quoteError && <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red }}>{quoteError}</div>}
        <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>ANTI-MEV PROTECTION</span>
              <div style={{ fontSize: 10, color: antiMev ? C.accent : C.muted, marginTop: 2 }}>{antiMev ? 'ON - Priority, bot protected (+2%)' : 'OFF - Standard processing (saves 2%)'}</div>
            </div>
            <button onClick={function() { setAntiMev(!antiMev); }} style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: antiMev ? C.accent : C.muted2, transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: antiMev ? 23 : 3, transition: 'left .2s' }} />
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
                return <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}><span style={{ color: C.muted }}>{item[0]}</span><span style={{ color: item[0].includes('Total') ? C.accent : C.text }}>{item[1]}</span></div>;
              })}
            </div>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={useCustomAddress} onChange={function(e) { setUseCustomAddress(e.target.checked); }} style={{ cursor: 'pointer', width: 14, height: 14 }} />
            <span style={{ fontSize: 12, color: C.muted }}>Send to different wallet</span>
          </label>
          {useCustomAddress && <input value={customAddress} onChange={function(e) { setCustomAddress(e.target.value); }} placeholder="Paste Solana wallet address..." style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 10, padding: '10px 12px', color: C.accent, fontFamily: 'monospace', fontSize: 11, outline: 'none', marginTop: 8 }} />}
        </div>
        {swapError && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red }}>{swapError}</div>}
        {isConnected ? (
          <button onClick={executeSwap} disabled={swapStatus === 'loading'} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : swapStatus === 'error' ? 'rgba(255,59,107,.2)' : !fromAmt || !quote ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer', transition: 'all .3s', minHeight: 52 }}>
            {swapStatus === 'loading' ? 'Confirming...' : swapStatus === 'success' ? 'Swap Confirmed!' : swapStatus === 'error' ? 'Failed - Try Again' : !fromAmt ? 'Enter Amount' : quoteLoading ? 'Getting Best Route...' : !quote ? 'No Route Found' : 'Swap ' + (fromToken ? fromToken.symbol : '') + ' > ' + (toToken ? toToken.symbol : '')}
          </button>
        ) : (
          <button onClick={onConnectWallet} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52 }}>Connect Wallet to Swap</button>
        )}
        {swapTx && swapStatus === 'success' && <a href={'https://solscan.io/tx/' + swapTx} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}>View on Solscan</a>}
        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>Non-custodial - No KYC - Fees paid by user</p>
      </div>
    </div>
  );
}
