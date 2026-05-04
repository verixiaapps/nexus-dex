import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAccount } from 'wagmi';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

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

var SOL_MINT = 'So11111111111111111111111111111111111111112';

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

function fmtTokenAmt(n) {
  if (n == null) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

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

// PORT-1 fix: fetch BOTH metadata and price for unknown SPL mints in a
// single call. GeckoTerminal's multi endpoint returns name/symbol/image
// AND price_usd, so we resolve "Unknown Token" rows AND populate USD
// values in one round trip. Splitting these into two calls (one for
// metadata, one for price) is what made the values show up wrong before.
async function fetchSolMintData(mints) {
  if (!mints || !mints.length) return {};
  try {
    var chunks = [];
    for (var i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
    var results = await Promise.all(chunks.map(function(chunk) {
      return fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/' + chunk.join(','))
        .then(function(r) { return r.ok ? r.json() : { data: [] }; })
        .catch(function() { return { data: [] }; });
    }));
    var out = {};
    results.forEach(function(res) {
      if (!res.data) return;
      res.data.forEach(function(item) {
        var attrs = item.attributes;
        if (!attrs || !attrs.address) return;
        out[attrs.address] = {
          name: attrs.name || null,
          symbol: attrs.symbol || null,
          image: attrs.image_url || null,
          price: parseFloat(attrs.price_usd || 0),
        };
      });
    });
    return out;
  } catch (e) { return {}; }
}

// PORT-2 fix: Jupiter price API for mints not on GeckoTerminal (covers
// brand-new launches GT hasn't indexed yet).
async function fetchJupiterPrices(mints) {
  if (!mints || !mints.length) return {};
  try {
    var chunks = [];
    for (var i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
    var results = await Promise.all(chunks.map(function(chunk) {
      return fetch('https://api.jup.ag/price/v2?ids=' + chunk.join(','))
        .then(function(r) { return r.ok ? r.json() : {}; })
        .catch(function() { return {}; });
    }));
    var prices = {};
    results.forEach(function(r) {
      if (r.data) {
        Object.keys(r.data).forEach(function(mint) {
          var p = r.data[mint];
          if (p && p.price) prices[mint] = parseFloat(p.price);
        });
      }
    });
    return prices;
  } catch (e) { return {}; }
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
  const [solFallbackPrice, setSolFallbackPrice] = useState(0);
  const [activeTab, setActiveTab] = useState('holdings');
  const [manualAddress, setManualAddress] = useState('');
  const [lookupAddress, setLookupAddress] = useState('');

  const getPriceRef = useRef(null);
  const getTokenInfoRef = useRef(null);
  var getPrice = useCallback(function(symbol) {
    if (!symbol || !coins || !coins.length) return 0;
    var coin = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === symbol.toLowerCase(); });
    return coin ? coin.current_price : 0;
  }, [coins]);
  var getTokenInfo = useCallback(function(mint) {
    if (!jupiterTokens || !jupiterTokens.length) return null;
    return jupiterTokens.find(function(t) { return t.mint === mint; });
  }, [jupiterTokens]);
  useEffect(function() { getPriceRef.current = getPrice; }, [getPrice]);
  useEffect(function() { getTokenInfoRef.current = getTokenInfo; }, [getTokenInfo]);

  // PORT-3 fix: SOL price fallback. If CoinGecko hasn't loaded (or fails),
  // pull SOL from Jupiter so the totals row never shows $0 for held SOL.
  useEffect(function() {
    if (getPrice('SOL') > 0) return;
    fetchJupiterPrices([SOL_MINT]).then(function(prices) {
      if (prices[SOL_MINT]) setSolFallbackPrice(prices[SOL_MINT]);
    });
  }, [getPrice]);

  var fetchSolBalances = useCallback(async function() {
    var addrToUse = publicKey ? publicKey.toString() : lookupAddress;
    if (!addrToUse || !connection) return;
    setSolLoading(true); setSolError('');
    try {
      var lookupPubkey = new PublicKey(addrToUse);
      var lamports = await connection.getBalance(lookupPubkey);
      setSolBalance(lamports / 1e9);

      var SPL_LEGACY    = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      var SPL_TOKEN2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      var accountsResults = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_LEGACY }),
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_TOKEN2022 }),
      ]);
      var allAccounts = [];
      accountsResults.forEach(function(r) {
        if (r.status === 'fulfilled' && r.value && r.value.value) {
          allAccounts = allAccounts.concat(r.value.value);
        }
      });

      var holdings = [];
      var seenMints = new Set();
      allAccounts.forEach(function(account) {
        try {
          var info = account.account.data.parsed.info;
          var uiAmount = info.tokenAmount.uiAmount;
          if (uiAmount && uiAmount > 0.000001 && !seenMints.has(info.mint)) {
            seenMints.add(info.mint);
            var tokenInfo = getTokenInfoRef.current ? getTokenInfoRef.current(info.mint) : null;
            holdings.push({
              mint: info.mint,
              symbol: tokenInfo ? tokenInfo.symbol : info.mint.slice(0, 4) + '...',
              name: tokenInfo ? tokenInfo.name : null,
              logoURI: tokenInfo ? tokenInfo.logoURI : null,
              decimals: info.tokenAmount.decimals,
              uiAmount: uiAmount,
              jupPrice: 0,
            });
          }
        } catch (e) {}
      });

      // PORT-1: resolve metadata + price for ALL holdings via GeckoTerminal
      // multi (not just unpriced ones). This is what fixes the missing
      // names, missing symbols, missing logos, and missing USD values.
      var allMints = holdings.map(function(h) { return h.mint; });
      var gtData = await fetchSolMintData(allMints);

      // Anything GT didn't price -> ask Jupiter (covers fresh launches).
      var stillUnpriced = holdings.filter(function(h) {
        var gt = gtData[h.mint];
        return !gt || !gt.price;
      }).map(function(h) { return h.mint; });
      var jupPrices = stillUnpriced.length
        ? await fetchJupiterPrices(stillUnpriced)
        : {};

      holdings = holdings.map(function(h) {
        var gt = gtData[h.mint] || {};
        var price = gt.price || jupPrices[h.mint] || 0;
        return {
          mint: h.mint,
          symbol: h.symbol || gt.symbol || (h.mint.slice(0, 4) + '...'),
          name: h.name || gt.name || 'Unknown Token',
          logoURI: h.logoURI || gt.image || null,
          decimals: h.decimals,
          uiAmount: h.uiAmount,
          jupPrice: price,
        };
      });

      // PORT-4: sort by mint-keyed price (jupPrice) -- not by CG symbol
      // lookup, which used to misrank tokens whose symbol collides with
      // a different CoinGecko coin.
      holdings.sort(function(a, b) {
        return (b.uiAmount * b.jupPrice) - (a.uiAmount * a.jupPrice);
      });

      setSolBalances(holdings);
    } catch (e) {
      console.error('Solana balance error:', e);
      setSolError('Failed to load Solana balances: ' + (e.message || ''));
    }
    setSolLoading(false);
  }, [publicKey, connection, lookupAddress]);

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

  useEffect(function() {
    if (refreshKey > 0) {
      if (publicKey || lookupAddress) fetchSolBalances();
      if (evmAddress) fetchEvmBalancesData();
    }
  }, [refreshKey, publicKey, lookupAddress, evmAddress, fetchSolBalances, fetchEvmBalancesData]);

  // PORT-5: USD price helper for Solana SPL tokens. Mint-keyed jupPrice
  // is preferred (precise per-mint). The CG symbol lookup is a last
  // resort -- and only kicks in for major tokens whose symbol uniquely
  // identifies them on CoinGecko.
  function priceForSolHolding(h) {
    if (h.jupPrice && h.jupPrice > 0) return h.jupPrice;
    return getPrice(h.symbol) || 0;
  }

  var solPrice = getPrice('SOL') || solFallbackPrice;
  var solValue = solBalance * solPrice;
  var solTokensTotal = solBalances.reduce(function(sum, h) {
    return sum + (h.uiAmount * priceForSolHolding(h));
  }, 0);
  var evmTotal = evmTokens.reduce(function(sum, t) { return sum + t.balanceUsd; }, 0);
  var totalValue = solValue + solTokensTotal + evmTotal;

  var rootStyle = { width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' };

  // Reusable Send button (always visible at top -- routes to Send page).
  function SendButton(props) {
    return (
      <button
        onClick={function() { onSend && onSend(); }}
        disabled={!onSend}
        style={Object.assign({
          background: onSend ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.04)',
          border: 'none', borderRadius: 12,
          padding: '14px 22px', color: onSend ? '#03060f' : C.muted,
          fontSize: 14, fontWeight: 800, cursor: onSend ? 'pointer' : 'not-allowed',
          fontFamily: 'Syne, sans-serif',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          minHeight: 48,
        }, props.style || {})}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        Send
      </button>
    );
  }

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Solana &middot; {EVM_CHAINS.length} EVM chains &middot; auto-refresh 30s</p>
        </div>
        <button onClick={function() { fetchSolBalances(); fetchEvmBalancesData(); }} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '7px 14px', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, alignSelf: 'flex-start' }}>Refresh</button>
      </div>

      {/* PORT-6: Hero card -- Total Value + prominent Send CTA. The Send
          button is always visible at the top, routes to the Send page,
          and is disabled if no onSend prop is wired (rather than hidden,
          so the user can see the affordance even before nav is wired). */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(0,85,255,0.04) 100%)',
        border: '1px solid ' + C.borderHi,
        borderRadius: 18, padding: 20, marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 4 }}>TOTAL PORTFOLIO VALUE</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{fmt(totalValue)}</div>
        </div>
        <SendButton style={{ flexShrink: 0 }} />
      </div>

      {/* PORT-7: Connected wallets -- show ALL connected wallets, not just
          the first one. Solana + EVM display side by side as separate pills
          when both are connected. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(solConnected || publicKey) && (
          <div style={{ background: C.card, border: '1px solid rgba(153,69,255,.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#9945ff', flexShrink: 0 }}>S</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .6 }}>SOLANA WALLET</div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(publicKey ? publicKey.toString() : walletAddress || '')}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{solBalance.toFixed(4)} SOL</div>
              <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{fmt(solValue + solTokensTotal)}</div>
            </div>
          </div>
        )}
        {(evmConnected || evmAddress) && (
          <div style={{ background: C.card, border: '1px solid rgba(98,126,234,.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(98,126,234,.2)', border: '1px solid rgba(98,126,234,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#627eea', flexShrink: 0 }}>E</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .6 }}>EVM WALLET ({EVM_CHAINS.length} CHAINS)</div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(evmAddress || '')}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{evmTokens.length} tokens</div>
              <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{fmt(evmTotal)}</div>
            </div>
          </div>
        )}
      </div>

      {!solConnected && !publicKey && (
        <div style={{ background: C.card, border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>LOOK UP SOLANA ADDRESS (OPTIONAL)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={manualAddress} onChange={function(e) { setManualAddress(e.target.value); }} placeholder="Paste Solana address..." style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: 'monospace', fontSize: 12, outline: 'none' }} />
            <button onClick={function() { setLookupAddress(manualAddress.trim()); }} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#03060f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0 }}>Load</button>
          </div>
          {lookupAddress && <div style={{ fontSize: 11, color: C.green, marginTop: 6 }}>Showing: {shortAddr(lookupAddress)}</div>}
        </div>
      )}

      {solError && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{solError}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[['holdings', 'Holdings'], ['activity', 'Activity']].map(function(item) {
          return <button key={item[0]} onClick={function() { setActiveTab(item[0]); }} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: 'Syne, sans-serif', cursor: 'pointer', background: activeTab === item[0] ? 'rgba(0,229,255,.09)' : 'transparent', border: '1px solid ' + (activeTab === item[0] ? 'rgba(0,229,255,.25)' : C.border), color: activeTab === item[0] ? C.accent : C.muted }}>{item[1]}</button>;
        })}
      </div>

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
                  onClick={function() { onSelectToken && onSelectToken({ id: 'solana', symbol: 'SOL', name: 'Solana', current_price: solPrice, image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png', mint: SOL_MINT, address: SOL_MINT, isSolanaToken: true, chain: 'solana' }); }}
                  style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
                      <div style={{ color: C.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Solana</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(solPrice)}</div>
                  <div style={{ textAlign: 'right', color: solValue > 0 ? C.green : C.muted, fontSize: 13, fontWeight: 600 }}>{fmt(solValue)}</div>
                </div>
                {solLoading && solBalances.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading Solana tokens...</div>
                ) : solBalances.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 12 }}>No other SPL tokens found</div>
                ) : (
                  solBalances.map(function(token) {
                    var price = priceForSolHolding(token);
                    var value = token.uiAmount * price;
                    return (
                      <div
                        key={token.mint}
                        onClick={function() {
                          onSelectToken && onSelectToken({
                            id: token.mint, mint: token.mint, address: token.mint,
                            symbol: token.symbol, name: token.name,
                            image: token.logoURI, current_price: price,
                            isSolanaToken: true, chain: 'solana',
                            decimals: token.decimals,
                          });
                        }}
                        style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                        onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                        onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          {token.logoURI
                            ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
                            : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{token.symbol && token.symbol.charAt(0)}</div>
                          }
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.symbol}</div>
                            <div style={{ color: C.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmtTokenAmt(token.uiAmount)}</div>
                        <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{price > 0 ? fmt(price) : '-'}</div>
                        <div style={{ textAlign: 'right', color: value > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{value > 0 ? fmt(value) : '-'}</div>
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
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>EVM TOKENS &middot; {EVM_CHAINS.length} CHAINS</div>
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
                  // PORT-8: stable, unique ID for EVM token rows. Was
                  // `contractAddress || tokenSymbol` -- the symbol fallback
                  // collided across chains (a USDC on Polygon and a USDC on
                  // Arbitrum got the same id). Now: chainId-address, with a
                  // 'native-{chainId}' form for native coins (no contract).
                  var addrLc = (token.contractAddress || '').toLowerCase();
                  var stableId = addrLc
                    ? token.chainId + '-' + addrLc
                    : 'native-' + token.chainId;
                  return (
                    <div
                      key={stableId + '-' + i}
                      onClick={function() {
                        onSelectToken && onSelectToken({
                          id: stableId,
                          symbol: token.tokenSymbol, name: token.tokenName,
                          image: token.thumbnail || null, current_price: token.tokenPrice,
                          address: token.contractAddress, chainId: token.chainId, chain: 'evm',
                          decimals: token.decimals,
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
                          <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.tokenName} &middot; {token.blockchain}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmtTokenAmt(token.balance)}</div>
                      <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.tokenPrice > 0 ? fmt(token.tokenPrice) : '-'}</div>
                      <div style={{ textAlign: 'right', color: token.balanceUsd > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{token.balanceUsd > 0 ? fmt(token.balanceUsd) : '-'}</div>
                    </div>
                  );
                })}
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
