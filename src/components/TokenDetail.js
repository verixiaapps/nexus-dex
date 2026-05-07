import React, { useState, useEffect, useMemo } from 'react';
import { TradeDrawer } from './SwapWidget.jsx';
import InstantTrade from './InstantTrade.jsx';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

/**
 * NEXUS DEX -- TokenDetail
 *
 * Data sources (locked: Jupiter Solana, 0x EVM, LiFi cross-chain):
 *   - Coin info:     `coin` prop, refreshed via `coins` array (App.js
 *                    maps Jupiter v2 search response to CG-shaped output)
 *   - SOL price:     /api/jupiter/price/v3 proxy
 *   - SPL balance:   Solana RPC via /api/solana-rpc proxy
 *
 * Removed (banned data sources):
 *   - CoinGecko enrichment (platforms map + chart + metadata)
 *   - GeckoTerminal (OHLCV + pools)
 *   - DexScreener (pools)
 *   - Jupiter price v2 (deprecated -> v3)
 *
 * Note: historical chart + pools sections removed -- none of Jupiter / 0x
 * / LiFi provide OHLCV history or pool listings. Everything else (stats,
 * 24h changes, contract, instant trade, drawer) preserved.
 */

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

const CHAIN_NAMES = {
  1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB Chain',
  43114: 'Avalanche', 10: 'Optimism', 100: 'Gnosis', 324: 'zkSync Era', 59144: 'Linea',
  534352: 'Scroll', 5000: 'Mantle', 81457: 'Blast', 34443: 'Mode', 130: 'Unichain',
  146: 'Sonic', 80094: 'Berachain', 57073: 'Ink', 480: 'World Chain',
  250: 'Fantom', 25: 'Cronos', 1284: 'Moonbeam', 42220: 'Celo', 1329: 'SEI', 8217: 'Kaia',
};

function fmt(n, d) {
  if (d === undefined) d = 2;
  if (n == null) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}
function pct(n) {
  if (n == null) return '-';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function isOnChainAddress(str) {
  if (!str) return false;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str)) return true;
  if (/^0x[0-9a-fA-F]{40}$/.test(str)) return true;
  return false;
}

export default function TokenDetail({ coin, coins, jupiterTokens, onBack, onConnectWallet }) {
  const { headerChain, setHeaderChain, presets, setPresets } = useNexusWallet();
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();

  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [tradeRefreshTick, setTradeRefreshTick] = useState(0);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  /* SOL/USD via Jupiter v3 proxy. v3 response: { "<mint>": { "usdPrice": ... } } */
  useEffect(function () {
    var cancelled = false;
    var SOL_MINT = 'So11111111111111111111111111111111111111112';
    var fetchPrice = function () {
      fetch('/api/jupiter/price/v3?ids=' + SOL_MINT)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (cancelled || !d) return;
          var p = d[SOL_MINT] && parseFloat(d[SOL_MINT].usdPrice);
          if (Number.isFinite(p) && p > 0) setSolPriceUsd(p);
        })
        .catch(function () {});
    };
    fetchPrice();
    var poll = setInterval(fetchPrice, 60000);
    return function () { cancelled = true; clearInterval(poll); };
  }, []);

  /* User's SPL balance for SELL presets. Solana-only, requires connected wallet. */
  useEffect(function () {
    if (!coin || !coin.mint) { setUserTokenBalance(0); setUserTokenDecimals(null); return undefined; }
    if (!solConnected || !publicKey || !connection) { setUserTokenBalance(0); return undefined; }
    var cancelled = false;
    (async function () {
      try {
        var mintPk = new PublicKey(coin.mint);
        var resp = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk });
        if (cancelled) return;
        var total = 0;
        var dec = null;
        if (resp && resp.value) {
          resp.value.forEach(function (acc) {
            try {
              var info = acc.account.data.parsed.info;
              var ta = info && info.tokenAmount;
              if (ta) {
                if (dec == null && Number.isFinite(ta.decimals)) dec = ta.decimals;
                var ui = parseFloat(ta.uiAmountString || ta.uiAmount || 0);
                if (Number.isFinite(ui)) total += ui;
              }
            } catch (e) {}
          });
        }
        setUserTokenBalance(total);
        if (dec != null) setUserTokenDecimals(dec);
      } catch (e) {
        if (!cancelled) setUserTokenBalance(0);
      }
    })();
    return function () { cancelled = true; };
  }, [coin, solConnected, publicKey, connection, tradeRefreshTick]);

  const isEvmToken = coin && (coin.chain === 'evm' || (coin.address && !coin.mint));

  /* Live coin lookup -- re-reads from coins array on every refresh tick
   * from App.js so price/mc/volume stay fresh while user lingers here. */
  const liveCoin = useMemo(function() {
    if (!coin) return null;
    if (!Array.isArray(coins) || !coins.length) return coin;
    var match = coins.find(function(c) {
      if (!c) return false;
      if (coin.id && c.id === coin.id) return true;
      if (coin.mint && c.id === coin.mint) return true;
      if (coin.mint && c.mint === coin.mint) return true;
      return false;
    });
    return match || coin;
  }, [coin, coins]);

  /* Simplified normalization. No CG platforms map -- coins from App.js
   * (Jupiter v2) already arrive as Solana, and EVM tokens always have
   * address+chainId attached upstream. */
  const enrichedCoin = useMemo(function() {
    if (!coin) return null;
    if (coin.mint || coin.isSolanaToken || coin.chain === 'solana') {
      return Object.assign({}, coin, { mint: coin.mint || coin.id, chain: 'solana' });
    }
    if (coin.chain === 'evm' && coin.address && coin.chainId) return coin;
    return coin;
  }, [coin]);

  const contractAddress = isEvmToken
    ? (coin && (coin.address || coin.id))
    : (coin && (coin.mint || (isOnChainAddress(coin.id) ? coin.id : null)));
  const contractLabel = isEvmToken
    ? ((CHAIN_NAMES[coin && coin.chainId] || 'EVM') + ' CONTRACT').toUpperCase()
    : 'SOLANA CONTRACT';

  if (!coin) return null;

  var displayPrice = liveCoin.current_price;
  var priceChange  = liveCoin.price_change_percentage_24h || 0;
  var symbolUp     = coin.symbol ? coin.symbol.toUpperCase() : '';

  /* Stats grid -- show whatever is available from the upstream coin
   * mapping. Anything missing renders as '-' via fmt(). Jupiter v2
   * provides current_price, market_cap, total_volume, 24h change at
   * minimum; CG-derived fields (ATH, supply, rank) may be absent. */
  var statsItems = [
    ['MARKET CAP',         fmt(liveCoin.market_cap)],
    ['24H VOLUME',         fmt(liveCoin.total_volume)],
    ['24H HIGH',           fmt(liveCoin.high_24h)],
    ['24H LOW',            fmt(liveCoin.low_24h)],
    ['ALL TIME HIGH',      fmt(liveCoin.ath)],
    ['ATH CHANGE',         pct(liveCoin.ath_change_percentage)],
    ['CIRCULATING SUPPLY', liveCoin.circulating_supply ? (liveCoin.circulating_supply / 1e6).toFixed(2) + 'M' : '-'],
    ['MARKET CAP RANK',    liveCoin.market_cap_rank ? '#' + liveCoin.market_cap_rank : '-'],
  ];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>Back to Markets</button>

      {/* Header card -- name, symbol, current price, 24h change */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {coin.image
              ? <img src={coin.image} alt={coin.symbol} style={{ width: 48, height: 48, borderRadius: '50%' }} />
              : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{coin.symbol && coin.symbol.charAt(0).toUpperCase()}</div>
            }
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{coin.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {symbolUp} {liveCoin.market_cap_rank ? '- Rank #' + liveCoin.market_cap_rank : ''}
                {isEvmToken && (
                  <span style={{ fontSize: 9, color: '#627eea', background: 'rgba(98,126,234,.15)', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }}>
                    {CHAIN_NAMES[coin.chainId] || 'EVM'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(displayPrice)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: priceChange >= 0 ? C.green : C.red, marginTop: 2 }}>{pct(priceChange)} (24H)</div>
          </div>
        </div>
      </div>

      {/* Instant Trade -- GMGN-style preset bar. One-click for Privy
          embedded wallets (no popup); external wallets open the drawer. */}
      <div style={{ marginBottom: 12 }}>
        <InstantTrade
          token={enrichedCoin}
          solPrice={solPriceUsd}
          tokenBalance={userTokenBalance}
          tokenDecimals={userTokenDecimals}
          onConnectWallet={onConnectWallet}
          onOpenDrawer={function (mode, opts) {
            setDrawerMode(mode);
            setDrawerOpen(true);
          }}
          onTradeComplete={function () {
            setTradeRefreshTick(function (t) { return t + 1; });
          }}
        />
      </div>

      {/* Buy / Sell -- always enabled (no CG metadata gating since coin
          is already resolved upstream by App.js / Markets / Portfolio). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button
          onClick={function() { setDrawerMode('buy'); setDrawerOpen(true); }}
          style={{
            padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56,
          }}
        >
          Buy {symbolUp}
        </button>
        <button
          onClick={function() { setDrawerMode('sell'); setDrawerOpen(true); }}
          style={{
            padding: '18px 10px', borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56,
          }}
        >
          Sell {symbolUp}
        </button>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {statsItems.map(function(item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>{item[0]}</div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      {/* Price changes */}
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PRICE CHANGES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            ['1 Hour',   liveCoin.price_change_percentage_1h_in_currency],
            ['24 Hours', liveCoin.price_change_percentage_24h],
            ['7 Days',   liveCoin.price_change_percentage_7d_in_currency],
          ].map(function(item) {
            var v = item[1];
            var hasVal = Number.isFinite(v);
            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: !hasVal ? C.muted : v >= 0 ? C.green : C.red }}>{hasVal ? pct(v) : '-'}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contract address */}
      {contractAddress && isOnChainAddress(contractAddress) && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>{contractLabel}</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{contractAddress}</div>
        </div>
      )}

      {/* Trade drawer */}
      <TradeDrawer
        open={drawerOpen}
        onClose={function() { setDrawerOpen(false); }}
        mode={drawerMode}
        coin={enrichedCoin}
        jupiterTokens={jupiterTokens}
        onConnectWallet={onConnectWallet}
        headerChain={headerChain}
        onHeaderChainChange={setHeaderChain}
        presets={presets}
        onPresetsChange={setPresets}
      />
    </div>
  );
}
