import React, { useState, useEffect, useMemo } from 'react';
import { TradeDrawer } from './SwapWidget.jsx';
import InstantTrade from './InstantTrade.jsx';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
 
/**
 * NEXUS DEX -- TokenDetail
 *
 * Trading:
 *   - OKX for normal swap execution
 *   - PumpPortal for pump.fun / PumpSwap execution
 *
 * Data:
 *   - Coin info: `coin` prop, refreshed via `coins` array from App.js
 *   - SPL balance: Solana RPC via wallet adapter connection
 *
 * Not used here:
 *   - Jupiter
 *   - 0x
 *   - LiFi
 *   - CoinGecko enrichment
 *   - GeckoTerminal
 *   - DexScreener
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

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function toNum(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function fmt(n, d) {
  if (d === undefined) d = 2;
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (v >= 1) return '$' + v.toFixed(d);
  if (v > 0) return '$' + v.toFixed(6);
  return '$0.00';
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function isOnChainAddress(str) {
  if (!str) return false;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str)) return true;
  if (/^0x[0-9a-fA-F]{40}$/.test(str)) return true;
  return false;
}

export default function TokenDetail({ coin, coins, onBack, onConnectWallet }) {
  const { headerChain, setHeaderChain, presets, setPresets } = useNexusWallet();
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();

  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [tradeRefreshTick, setTradeRefreshTick] = useState(0);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [drawerPrefill, setDrawerPrefill] = useState(null);

  const liveCoin = useMemo(function () {
    if (!coin) return null;
    if (!Array.isArray(coins) || !coins.length) return coin;

    const match = coins.find(function (c) {
      if (!c) return false;
      if (coin.id && c.id === coin.id) return true;
      if (coin.mint && c.id === coin.mint) return true;
      if (coin.mint && c.mint === coin.mint) return true;
      if (coin.address && c.address && String(c.address).toLowerCase() === String(coin.address).toLowerCase()) return true;
      return false;
    });

    return match || coin;
  }, [coin, coins]);

  const enrichedCoin = useMemo(function () {
    if (!coin) return null;

    if (coin.mint || coin.isSolanaToken || coin.chain === 'solana') {
      return Object.assign({}, coin, {
        mint: coin.mint || coin.id,
        chain: 'solana',
      });
    }

    if (coin.chain === 'evm' && coin.address && coin.chainId) return coin;

    return coin;
  }, [coin]);

  const isEvmToken = enrichedCoin && (
    enrichedCoin.chain === 'evm' ||
    (enrichedCoin.address && !enrichedCoin.mint)
  );

  const solPriceUsd = useMemo(function () {
    if (!Array.isArray(coins)) return 0;

    const sol = coins.find(function (c) {
      if (!c) return false;
      const id = String(c.id || '').toLowerCase();
      const mint = String(c.mint || '').toLowerCase();
      const symbol = String(c.symbol || '').toLowerCase();

      return (
        id === SOL_MINT.toLowerCase() ||
        mint === SOL_MINT.toLowerCase() ||
        symbol === 'sol'
      );
    });

    const p = sol && Number(sol.current_price);
    return Number.isFinite(p) && p > 0 ? p : 0;
  }, [coins]);

  useEffect(function () {
    if (!enrichedCoin || !enrichedCoin.mint) {
      setUserTokenBalance(0);
      setUserTokenDecimals(null);
      return undefined;
    }

    if (!solConnected || !publicKey || !connection) {
      setUserTokenBalance(0);
      return undefined;
    }

    let cancelled = false;

    (async function () {
      try {
        const mintPk = new PublicKey(enrichedCoin.mint);
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk });

        if (cancelled) return;

        let total = 0;
        let dec = null;

        if (resp && resp.value) {
          resp.value.forEach(function (acc) {
            try {
              const info = acc.account.data.parsed.info;
              const ta = info && info.tokenAmount;

              if (ta) {
                const parsedDecimals = Number(ta.decimals);
                if (dec == null && Number.isFinite(parsedDecimals)) dec = parsedDecimals;

                const ui = parseFloat(ta.uiAmountString || ta.uiAmount || 0);
                if (Number.isFinite(ui)) total += ui;
              }
            } catch (e) {}
          });
        }

        setUserTokenBalance(total);
        if (dec != null) setUserTokenDecimals(dec);
      } catch (e) {
        if (!cancelled) {
          setUserTokenBalance(0);
          setUserTokenDecimals(null);
        }
      }
    })();

    return function () {
      cancelled = true;
    };
  }, [enrichedCoin, solConnected, publicKey, connection, tradeRefreshTick]);

  if (!coin || !liveCoin) return null;

  const contractAddress = isEvmToken
    ? (enrichedCoin && (enrichedCoin.address || enrichedCoin.id))
    : (enrichedCoin && (enrichedCoin.mint || (isOnChainAddress(enrichedCoin.id) ? enrichedCoin.id : null)));

  const contractLabel = isEvmToken
    ? ((CHAIN_NAMES[enrichedCoin && enrichedCoin.chainId] || 'EVM') + ' CONTRACT').toUpperCase()
    : 'SOLANA CONTRACT';

  const displayPrice = toNum(liveCoin.current_price, 0);
  const priceChange = toNum(liveCoin.price_change_percentage_24h, 0);
  const symbolUp = coin.symbol ? coin.symbol.toUpperCase() : '';

  const statsItems = [
    ['MARKET CAP', fmt(liveCoin.market_cap)],
    ['24H VOLUME', fmt(liveCoin.total_volume)],
    ['24H HIGH', fmt(liveCoin.high_24h)],
    ['24H LOW', fmt(liveCoin.low_24h)],
    ['ALL TIME HIGH', fmt(liveCoin.ath)],
    ['ATH CHANGE', pct(liveCoin.ath_change_percentage)],
    ['CIRCULATING SUPPLY', Number(liveCoin.circulating_supply) > 0 ? (Number(liveCoin.circulating_supply) / 1e6).toFixed(2) + 'M' : '-'],
    ['MARKET CAP RANK', liveCoin.market_cap_rank ? '#' + liveCoin.market_cap_rank : '-'],
  ];

  function openDrawerWithPrefill(mode, opts) {
    setDrawerMode(mode);
    setDrawerPrefill(opts || null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerPrefill(null);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>Back to Markets</button>

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
                    {CHAIN_NAMES[enrichedCoin.chainId] || 'EVM'}
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

      <div style={{ marginBottom: 12 }}>
        <InstantTrade
          token={enrichedCoin}
          solPrice={solPriceUsd}
          tokenBalance={userTokenBalance}
          tokenDecimals={userTokenDecimals}
          onConnectWallet={onConnectWallet}
          onOpenDrawer={openDrawerWithPrefill}
          onTradeComplete={function () {
            setTradeRefreshTick(function (t) { return t + 1; });
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button
          onClick={function () { openDrawerWithPrefill('buy', null); }}
          style={{
            padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56,
          }}
        >
          Buy {symbolUp}
        </button>

        <button
          onClick={function () { openDrawerWithPrefill('sell', null); }}
          style={{
            padding: '18px 10px', borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56,
          }}
        >
          Sell {symbolUp}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {statsItems.map(function (item) {
          return (
            <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>{item[0]}</div>
              <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{item[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PRICE CHANGES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            ['1 Hour', liveCoin.price_change_percentage_1h_in_currency],
            ['24 Hours', liveCoin.price_change_percentage_24h],
            ['7 Days', liveCoin.price_change_percentage_7d_in_currency],
          ].map(function (item) {
            const v = Number(item[1]);
            const hasVal = Number.isFinite(v);

            return (
              <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: !hasVal ? C.muted : v >= 0 ? C.green : C.red }}>{hasVal ? pct(v) : '-'}</div>
              </div>
            );
          })}
        </div>
      </div>

      {contractAddress && isOnChainAddress(contractAddress) && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>{contractLabel}</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{contractAddress}</div>
        </div>
      )}

      <TradeDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        mode={drawerMode}
        coin={enrichedCoin}
        onConnectWallet={onConnectWallet}
        headerChain={headerChain}
        onHeaderChainChange={setHeaderChain}
        presets={presets}
        onPresetsChange={setPresets}
        presetUsd={drawerPrefill && drawerPrefill.presetUsd != null ? drawerPrefill.presetUsd : null}
        presetPct={drawerPrefill && drawerPrefill.presetPct != null ? drawerPrefill.presetPct : null}
      />
    </div>
  );
}