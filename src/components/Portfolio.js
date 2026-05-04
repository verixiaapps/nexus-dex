import React, { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAccount } from 'wagmi';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

// EVM chains we query via Moralis. Moralis uses chain identifier strings
// ("eth", "polygon", etc.) but we send the numeric chainId -- the server
// proxy maps numeric -> Moralis chain string before calling the API.
var EVM_CHAINS = [
  { id: 1,     name: 'Ethereum',  moralis: 'eth' },
  { id: 137,   name: 'Polygon',   moralis: 'polygon' },
  { id: 42161, name: 'Arbitrum',  moralis: 'arbitrum' },
  { id: 8453,  name: 'Base',      moralis: 'base' },
  { id: 56,    name: 'BNB Chain', moralis: 'bsc' },
  { id: 43114, name: 'Avalanche', moralis: 'avalanche' },
  { id: 10,    name: 'Optimism',  moralis: 'optimism' },
  { id: 100,   name: 'Gnosis',    moralis: 'gnosis' },
  { id: 59144, name: 'Linea',     moralis: 'linea' },
  { id: 250,   name: 'Fantom',    moralis: 'fantom' },
  { id: 25,    name: 'Cronos',    moralis: 'cronos' },
  { id: 1284,  name: 'Moonbeam',  moralis: 'moonbeam' },
];
var EVM_CHAIN_NAMES = EVM_CHAINS.reduce(function(acc, c) { acc[c.id] = c.name; return acc; }, {});

function fmt(n, d) {
  if (d === undefined) d = 2;
  if (n == null) return '$0.00';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}

// Fetch EVM balances across all configured chains via the server-side
// Moralis proxy. Server route: GET /api/moralis/wallet-tokens?address=&chains=
//
// Expected server response shape:
//   { tokens: [{ chainId, contractAddress, symbol, name, logo, balance,
//                balanceFormatted, decimals, usdPrice, usdValue, pct24h }] }
//
// On failure: returns []. The user sees an empty EVM list (not an error
// page) which matches old behavior under Ankr rate-limit.
async function fetchEvmBalances(address) {
  if (!address) return [];
  try {
    var chainsParam = EVM_CHAINS.map(function(c) { return c.moralis; }).join(',');
    var res = await fetch('/api/moralis/wallet-tokens?address=' + encodeURIComponent(address) + '&chains=' + chainsParam);
    if (!res.ok) {
      console.warn('Moralis proxy returned', res.status);
      return [];
    }
    var data = await res.json();
    var raw = data && data.tokens ? data.tokens : [];

    return raw
      .filter(function(t) { return parseFloat(t.balanceFormatted || 0) > 0; })
      .map(function(t) {
        var chainName = EVM_CHAIN_NAMES[t.chainId] || ('Chain ' + t.chainId);
        return {
          blockchain: chainName,
          chainId: t.chainId,
          contractAddress: t.contractAddress || '',
          tokenSymbol: t.symbol || '???',
          tokenName: t.name || t.symbol || 'Unknown Token',
          thumbnail: t.logo || null,
          balance: parseFloat(t.balanceFormatted || 0),
          balanceUsd: parseFloat(t.usdValue || 0),
          tokenPrice: parseFloat(t.usdPrice || 0),
          decimals: parseInt(t.decimals || 18),
          pct24h: parseFloat(t.pct24h || 0),
          tokenType: 'ERC20',
        };
      });
  } catch (e) {
    console.error('Moralis balance fetch failed:', e);
    return [];
  }
}

export default function Portfolio({ coins, jupiterTokens, onSend, onConnectWallet, isConnected, isSolanaConnected, walletAddress, refreshKey, onSelectToken }) {
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();

  var walletConnected = isConnected || solConnected || evmConnected;

  const [solBalances, setSolBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState('');
  const [evmTokens, setEvmTokens] = useState([]);
  const [evmLoading, setEvmLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('holdings');
  const [manualAddress, setManualAddress] = useState('');
  const [lookupAddress, setLookupAddress] = useState('');

  var getPrice = useCallback(function(symbol) {
    if (!symbol || !coins || !coins.length) return 0;
    var coin = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === symbol.toLowerCase(); });
    return coin ? coin.current_price : 0;
  }, [coins]);

  var getTokenInfo = useCallback(function(mint) {
    if (!jupiterTokens || !jupiterTokens.length) return null;
    return jupiterTokens.find(function(t) { return t.mint === mint; });
  }, [jupiterTokens]);

  var fetchSolBalances = useCallback(async function() {
    var addrToUse = publicKey ? publicKey.toString() : lookupAddress;
    if (!addrToUse || !connection) return;
    setSolLoading(true); setSolError('');
    try {
      var lookupPubkey = new PublicKey(addrToUse);
      var lamports = await connection.getBalance(lookupPubkey);
      setSolBalance(lamports / 1e9);

      var tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        lookupPubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      var holdings = [];
      tokenAccounts.value.forEach(function(account) {
        try {
          var info = account.account.data.parsed.info;
          var uiAmount = info.tokenAmount.uiAmount;
          if (uiAmount && uiAmount > 0.000001) {
            var tokenInfo = getTokenInfo(info.mint);
            holdings.push({
              mint: info.mint,
              symbol: tokenInfo ? tokenInfo.symbol : info.mint.slice(0, 4) + '...' + info.mint.slice(-4),
              name: tokenInfo ? tokenInfo.name : 'Unknown Token',
              logoURI: tokenInfo ? tokenInfo.logoURI : null,
              decimals: info.tokenAmount.decimals,
              uiAmount: uiAmount,
              jupPrice: 0,
            });
          }
        } catch (e) {}
      });

      var missingMints = holdings.filter(function(h) { return getPrice(h.symbol) === 0; }).map(function(h) { return h.mint; });
      if (missingMints.length > 0) {
        try {
          var chunks = [];
          for (var i = 0; i < missingMints.length; i += 100) chunks.push(missingMints.slice(i, i + 100));
          var priceResults = await Promise.all(chunks.map(function(chunk) {
            return fetch('https://api.jup.ag/price/v2?ids=' + chunk.join(','))
              .then(function(r) { return r.ok ? r.json() : {}; })
              .catch(function() { return {}; });
          }));
          var jupPrices = {};
          priceResults.forEach(function(r) { if (r.data) Object.assign(jupPrices, r.data); });
          holdings = holdings.map(function(h) {
            var p = jupPrices[h.mint];
            return Object.assign({}, h, { jupPrice: p && p.price ? parseFloat(p.price) : 0 });
          });
        } catch (e) {}
      }

      holdings.sort(function(a, b) {
        var priceA = getPrice(a.symbol) || a.jupPrice;
        var priceB = getPrice(b.symbol) || b.jupPrice;
        return (b.uiAmount * priceB) - (a.uiAmount * priceA);
      });

      setSolBalances(holdings);
    } catch (e) {
      console.error('Solana balance error:', e);
      setSolError('Failed to load Solana balances: ' + (e.message || ''));
    }
    setSolLoading(false);
  }, [publicKey, connection, lookupAddress, getPrice, getTokenInfo]);

  var fetchEvmBalancesData = useCallback(async function() {
    if (!evmAddress) { setEvmTokens([]); return; }
    setEvmLoading(true);
    var tokens = await fetchEvmBalances(evmAddress);
    tokens.sort(function(a, b) { return b.balanceUsd - a.balanceUsd; });
    setEvmTokens(tokens);
    setEvmLoading(false);
  }, [evmAddress]);

  var effectiveAddress = publicKey ? publicKey.toString() : lookupAddress;

  useEffect(function() {
    if (effectiveAddress) {
      fetchSolBalances();
      var interval = setInterval(fetchSolBalances, 30000);
      return function() { clearInterval(interval); };
    }
  }, [effectiveAddress, fetchSolBalances]);

  useEffect(function() { fetchEvmBalancesData(); }, [fetchEvmBalancesData]);

  // PORT-3 fix: include the actual fetch fns in deps. Both are useCallback
  // and stable wrt their own deps, so this won't cause loops.
  useEffect(function() {
    if (refreshKey > 0) {
      if (publicKey || lookupAddress) fetchSolBalances();
      if (evmAddress) fetchEvmBalancesData();
    }
  }, [refreshKey, publicKey, lookupAddress, evmAddress, fetchSolBalances, fetchEvmBalancesData]);

  // Re-price Solana holdings when CoinGecko data lands. Don't re-fetch
  // balances; just re-sort with new prices via setState identity bump.
  useEffect(function() {
    if (effectiveAddress && coins.length > 0 && solBalances.length > 0) {
      setSolBalances(function(prev) {
        return prev.slice().sort(function(a, b) {
          var priceA = getPrice(a.symbol) || a.jupPrice;
          var priceB = getPrice(b.symbol) || b.jupPrice;
          return (b.uiAmount * priceB) - (a.uiAmount * priceA);
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  var solPrice = getPrice('SOL');
  var solValue = solBalance * solPrice;
  var solTokensTotal = solBalances.reduce(function(sum, h) {
    return sum + (h.uiAmount * (getPrice(h.symbol) || h.jupPrice));
  }, 0);
  var evmTotal = evmTokens.reduce(function(sum, t) { return sum + t.balanceUsd; }, 0);
  var totalValue = solValue + solTokensTotal + evmTotal;

  var rootStyle = { width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' };

  if (!walletConnected) {
    return (
      <div style={Object.assign({ maxWidth: 520, margin: '0 auto' }, rootStyle)}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>All tokens across Solana and major EVM chains</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, maxWidth: 300, margin: '0 auto 24px', lineHeight: 1.6 }}>Connect to view real-time balances across all chains.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div style={Object.assign({ maxWidth: 600, margin: '0 auto' }, rootStyle)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>All tokens - Solana + {EVM_CHAINS.length} EVM chains - Auto-refreshes every 30s</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={function() { fetchSolBalances(); fetchEvmBalancesData(); }} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '7px 14px', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>Refresh</button>
          {onSend && <button onClick={onSend} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '7px 14px', color: '#03060f', fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Send</button>}
        </div>
      </div>

      {!solConnected && !publicKey && (
        <div style={{ background: C.card, border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>LOOK UP SOLANA ADDRESS (OPTIONAL)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={manualAddress} onChange={function(e) { setManualAddress(e.target.value); }} placeholder="Paste Solana address..." style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: 'monospace', fontSize: 12, outline: 'none' }} />
            <button onClick={function() { setLookupAddress(manualAddress.trim()); }} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#03060f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0 }}>Load</button>
          </div>
          {lookupAddress && <div style={{ fontSize: 11, color: C.green, marginTop: 6 }}>Showing: {lookupAddress.slice(0, 8)}...{lookupAddress.slice(-8)}</div>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['Total Portfolio', fmt(totalValue), C.accent],
          ['SOL Balance', solBalance.toFixed(4) + ' SOL', C.green],
          ['Solana Value', fmt(solValue + solTokensTotal), C.text],
          ['EVM Value', fmt(evmTotal), evmTotal > 0 ? C.green : C.muted],
        ].map(function(item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, fontWeight: 700, letterSpacing: .8 }}>{item[0]}</div>
              <div style={{ fontSize: 16, color: item[2], fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.15)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700 }}>CONNECTED WALLET</div>
        <div style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{walletAddress || evmAddress || ''}</div>
      </div>

      {solError && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{solError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[['holdings', 'Holdings'], ['activity', 'Activity']].map(function(item) {
          return <button key={item[0]} onClick={function() { setActiveTab(item[0]); }} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: 'Syne, sans-serif', cursor: 'pointer', background: activeTab === item[0] ? 'rgba(0,229,255,.09)' : 'transparent', border: '1px solid ' + (activeTab === item[0] ? 'rgba(0,229,255,.25)' : C.border), color: activeTab === item[0] ? C.accent : C.muted }}>{item[1]}</button>;
        })}
      </div>
Part 2 of 2:

      {activeTab === 'holdings' && (
        <>
          {(solConnected || publicKey || lookupAddress) && (
            <>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>SOLANA TOKENS</div>
              <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
                  <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
                </div>
                <div
                  onClick={function() { onSelectToken && onSelectToken({ id: 'solana', symbol: 'SOL', name: 'Solana', current_price: solPrice, image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png', mint: 'So11111111111111111111111111111111111111112', isSolanaToken: true }); }}
                  style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
                    <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div><div style={{ color: C.muted, fontSize: 10 }}>Solana</div></div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(solPrice)}</div>
                  <div style={{ textAlign: 'right', color: C.green, fontSize: 13, fontWeight: 600 }}>{fmt(solValue)}</div>
                </div>
                {solLoading && solBalances.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading Solana tokens...</div>
                ) : solBalances.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 12 }}>No other SPL tokens found</div>
                ) : (
                  solBalances.map(function(token) {
                    var price = getPrice(token.symbol) || token.jupPrice || 0;
                    var value = token.uiAmount * price;
                    return (
                      <div
                        key={token.mint}
                        onClick={function() { onSelectToken && onSelectToken({ id: token.mint, symbol: token.symbol, name: token.name, image: token.logoURI, current_price: price, isSolanaToken: true, mint: token.mint }); }}
                        style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                        onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                        onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {token.logoURI
                            ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
                            : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{token.symbol && token.symbol.charAt(0)}</div>
                          }
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.symbol}</div>
                            <div style={{ color: C.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.uiAmount >= 1000 ? token.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : token.uiAmount.toFixed(4)}</div>
                        <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(price)}</div>
                        <div style={{ textAlign: 'right', color: value > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{fmt(value)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {evmConnected || evmAddress ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>EVM TOKENS -- {EVM_CHAINS.length} CHAINS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {evmLoading && <span style={{ fontSize: 11, color: C.accent }}>Loading...</span>}
                  {!evmLoading && evmTokens.length > 0 && <span style={{ fontSize: 11, color: C.muted }}>Total: <span style={{ color: C.green, fontWeight: 700 }}>{fmt(evmTotal)}</span></span>}
                </div>
              </div>
              <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
                  <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
                </div>
                {evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading EVM balances across all chains...</div>}
                {!evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>No EVM token balances found</div>}
                {evmTokens.map(function(token, i) {
                  return (
                    <div
                      key={token.blockchain + '-' + (token.contractAddress || token.tokenSymbol) + '-' + i}
                      onClick={function() {
                        onSelectToken && onSelectToken({
                          id: token.contractAddress || token.tokenSymbol,
                          symbol: token.tokenSymbol, name: token.tokenName,
                          image: token.thumbnail || null, current_price: token.tokenPrice,
                          address: token.contractAddress, chainId: token.chainId, chain: 'evm',
                        });
                      }}
                      style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', alignItems: 'center', cursor: 'pointer' }}
                      onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                      onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {token.thumbnail
                          ? <img src={token.thumbnail} alt={token.tokenSymbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
                          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(98,126,234,.15)', border: '1px solid rgba(98,126,234,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#627eea', flexShrink: 0 }}>{token.tokenSymbol.charAt(0)}</div>
                        }
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.tokenSymbol}</div>
                          <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.tokenName} - {token.blockchain}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.balance >= 1000 ? token.balance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : token.balance.toFixed(4)}</div>
                      <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(token.tokenPrice)}</div>
                      <div style={{ textAlign: 'right', color: token.balanceUsd > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{fmt(token.balanceUsd)}</div>
                    </div>
                  );
                })}
                {evmAddress && (
                  <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.03)' }}>
                    <a href={'https://etherscan.io/address/' + evmAddress} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>View on Etherscan</a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ background: C.card, border: '1px solid rgba(98,126,234,.2)', borderRadius: 14, padding: 20, textAlign: 'center' }}>
              <div style={{ color: '#627eea', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Connect EVM Wallet</div>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>See balances across {EVM_CHAINS.length} EVM chains</p>
              <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#627eea,#4a5fcc)', border: 'none', borderRadius: 8, padding: '10px 22px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
            </div>
          )}
        </>
      )}

      {activeTab === 'activity' && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>&#8599;</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Transaction History</div>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 20px' }}>View your full transaction history on Solscan or Etherscan.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {(walletAddress || publicKey) && <a href={'https://solscan.io/account/' + (walletAddress || publicKey.toString())} target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 10, background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', color: C.accent, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Solscan</a>}
            {evmAddress && <a href={'https://etherscan.io/address/' + evmAddress} target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 10, background: 'rgba(98,126,234,.08)', border: '1px solid rgba(98,126,234,.25)', color: '#627eea', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Etherscan</a>}
            {evmAddress && <a href={'https://debank.com/profile/' + evmAddress} target="_blank" rel="noreferrer" style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 10, background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.15)', color: C.green, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>DeBank</a>}
          </div>
        </div>
      )}
    </div>
  );
}
