import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount } from 'wagmi';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TradeDrawer } from './SwapWidget.jsx';
import { useNexusWallet } from '../WalletContext.js'; 

/* ============================================================================
 * Changes vs the previous TokenDetail.js (preserves layout & styling; only
 * the listed fixes applied):
 *
 * - H7 (liquidity coverage): DexScreener was the only pools source. Now
 *   falls back to GeckoTerminal when DexScreener returns 0 pairs (better
 *   coverage on Solana memecoins). For native CG coins (BTC, ETH, SOL,
 *   etc. -- coins with no `platforms` map), the liquidity section shows
 *   "Native asset -- no on-chain DEX liquidity" instead of the same
 *   "No liquidity data found" used for failed lookups.
 *
 * - H8 (parallel loads): Chart fetch and pools fetch are kept in separate
 *   effects so they fire in parallel (this was already the case). The
 *   CG metadata fetch -- previously only triggered inside the pools
 *   fetcher when an address lookup was needed -- is now a third parallel
 *   effect that fires as soon as the page mounts, so we don't wait on
 *   pools to know whether the coin is native. Static stats (price,
 *   market cap, volume) keep rendering immediately from the coin prop.
 *
 * - H9 (drawer normalization): isEvmToken was a fragile heuristic
 *   (`coin.chain === 'evm' || (coin.address && !coin.mint)`). For a CG
 *   coin like "uniswap" or "chainlink", coin.address is undefined -- the
 *   contract lives in coin.platforms (fetched from CG /coins/{id}). The
 *   coin handed to TradeDrawer therefore had no usable address+chainId,
 *   so the drawer fell back to widget defaults instead of buying the
 *   viewed token. Now we build an `enrichedCoin` that, for CG coins,
 *   reads `cgMeta.platforms` and picks the platform matching the user's
 *   headerChain (or the first valid EVM platform / Solana mint as a
 *   fallback). The drawer receives the enriched coin.
 *
 * - L4 (chart x-axis): XAxis was `hide`. Now shows date tick labels
 *   using muted color so they don't overpower the chart.
 *
 * - M15 (live price): Page no longer freezes at the price snapshot from
 *   `selectedToken`. A `liveCoin` memo looks up the coin by id in the
 *   `coins` prop on every refresh tick from App.js (every 30s) and
 *   renders the live price/change.
 *
 * Things intentionally NOT changed:
 * - Visual layout, colors, button style, stat grid, period buttons.
 * - Direct browser calls to coingecko/dexscreener/geckoterminal (H14
 *   deferred to Round 4).
 * - Solana-token detection logic for `coin.mint` and `isSolanaToken`.
 * ========================================================================= */

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
  146: 'Sonic', 80094: 'Berachain', 57073: 'Ink', 143: 'Monad', 480: 'World Chain',
  250: 'Fantom', 25: 'Cronos', 1284: 'Moonbeam', 42220: 'Celo', 1329: 'SEI',
};

const GT_NETWORKS = {
  1: 'eth', 137: 'polygon_pos', 42161: 'arbitrum', 8453: 'base',
  56: 'bsc', 43114: 'avax', 10: 'optimism', 100: 'xdai',
  324: 'zksync', 59144: 'linea', 534352: 'scroll', 5000: 'mantle',
  81457: 'blast', 34443: 'mode', 130: 'unichain', 146: 'sonic',
  80094: 'berachain', 57073: 'ink', 480: 'worldchain',
  250: 'fantom', 25: 'cronos', 1284: 'moonbeam', 42220: 'celo', 1329: 'sei',
};

// CoinGecko platform key -> wagmi chainId. Used by H9 normalization to map
// `cgMeta.platforms[<platform>]` into a chainId the drawer understands.
const CG_PLATFORM_TO_CHAIN = {
  'ethereum':            1,
  'binance-smart-chain': 56,
  'polygon-pos':         137,
  'arbitrum-one':        42161,
  'optimistic-ethereum': 10,
  'base':                8453,
  'avalanche':           43114,
  'fantom':              250,
  'cronos':              25,
  'moonbeam':            1284,
  'celo':                42220,
  'gnosis':              100,
  'sonic':               146,
  'mantle':              5000,
  'blast':               81457,
  'mode':                34443,
  'linea':               59144,
  'scroll':              534352,
  'zksync':              324,
  'metis-andromeda':     1088,
  'aurora':              1313161554,
  'kava':                2222,
  'sei-evm':             1329,
  'unichain':            130,
  'berachain':           80094,
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

export default function TokenDetail({ coin, coins, jupiterTokens, onBack, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const { connected: solConnected } = useWallet();
  const { isConnected: evmConnected } = useAccount();
  const { headerChain } = useNexusWallet();

  var walletConnected = isConnected || solConnected || evmConnected;

  const [chartData, setChartData] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('7');
  const [chartLoading, setChartLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [totalLiquidity, setTotalLiquidity] = useState(0);
  // H7/H9 -- CG metadata for native-asset detection and drawer normalization.
  // `cgMeta` shape: { platforms, asset_platform_id }. `cgMetaFailed` is set
  // when the fetch errors so we don't falsely declare "native asset" for
  // coins whose platforms we just couldn't load.
  const [cgMeta, setCgMeta] = useState(null);
  const [cgMetaLoading, setCgMetaLoading] = useState(false);
  const [cgMetaFailed, setCgMetaFailed] = useState(false);

  const isEvmToken = coin && (coin.chain === 'evm' || (coin.address && !coin.mint));

  // M15 -- re-look up the coin in the live `coins` array on every refresh tick
  // from App.js. Keeps current_price / market_cap / volume fresh while the
  // user lingers on the detail page. Falls back to the original prop if not
  // found (e.g., user navigated directly via URL before markets loaded).
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

  // H9 -- normalize the coin into a shape TradeDrawer can use directly.
  // Solana coins keep their mint. EVM coins keep address+chainId. CG coins
  // get enriched from cgMeta.platforms -- preferring the user's headerChain,
  // then any EVM platform, then Solana. Native CG coins (no platforms) fall
  // through unmodified -- drawer will use its own defaults.
  const enrichedCoin = useMemo(function() {
    if (!coin) return null;

    // Solana token already (Markets-synthesized or Jupiter)
    if (coin.mint || coin.isSolanaToken || coin.chain === 'solana') {
      return Object.assign({}, coin, {
        mint:  coin.mint || coin.id,
        chain: 'solana',
      });
    }

    // EVM contract already passed through
    if (coin.chain === 'evm' && coin.address && coin.chainId) {
      return coin;
    }

    // CG coin -- enrich from platforms map
    if (cgMeta && cgMeta.platforms && Object.keys(cgMeta.platforms).length > 0) {
      var platforms = cgMeta.platforms;

      // 1) headerChain === 'solana' and the coin has a Solana mint -> use it
      if (headerChain === 'solana' && platforms.solana && isOnChainAddress(platforms.solana)) {
        return Object.assign({}, coin, {
          mint:  platforms.solana,
          chain: 'solana',
        });
      }

      // 2) headerChain is an EVM chainId -- find the matching CG platform
      if (typeof headerChain === 'number') {
        var matchedKey = Object.keys(CG_PLATFORM_TO_CHAIN).find(function(p) {
          return CG_PLATFORM_TO_CHAIN[p] === headerChain && platforms[p] && isOnChainAddress(platforms[p]);
        });
        if (matchedKey) {
          return Object.assign({}, coin, {
            chain:   'evm',
            address: platforms[matchedKey],
            chainId: headerChain,
          });
        }
      }

      // 3) Fallback -- first valid EVM platform
      var fallbackKey = Object.keys(platforms).find(function(p) {
        return CG_PLATFORM_TO_CHAIN[p] && platforms[p] && /^0x[0-9a-fA-F]{40}$/.test(platforms[p]);
      });
      if (fallbackKey) {
        return Object.assign({}, coin, {
          chain:   'evm',
          address: platforms[fallbackKey],
          chainId: CG_PLATFORM_TO_CHAIN[fallbackKey],
        });
      }

      // 4) Solana fallback if any
      if (platforms.solana && isOnChainAddress(platforms.solana)) {
        return Object.assign({}, coin, {
          mint:  platforms.solana,
          chain: 'solana',
        });
      }
    }

    // Native asset or unenriched -- drawer handles defaults
    return coin;
  }, [coin, cgMeta, headerChain]);

  // Native asset detection for the H7 liquidity message -- only definitive
  // once cgMeta has actually loaded successfully (otherwise we'd flash
  // "native asset" briefly before platforms arrive, or claim native after
  // a failed fetch).
  var isNativeCgCoin = !!(cgMeta && !cgMetaFailed && cgMeta.platforms && Object.keys(cgMeta.platforms).length === 0);

  const contractAddress = isEvmToken
    ? (coin?.address || coin?.id)
    : (coin?.mint || (isOnChainAddress(coin?.id) ? coin?.id : null));
  const contractLabel = isEvmToken
    ? ((CHAIN_NAMES[coin?.chainId] || 'EVM') + ' CONTRACT').toUpperCase()
    : 'SOLANA CONTRACT';

  // H8/H9 -- fire CG metadata fetch on mount in parallel with chart and pools.
  // Skips Solana tokens (no useful CG metadata) and tokens that already have
  // an on-chain address attached.
  useEffect(function() {
    if (!coin) return undefined;
    if (coin.isSolanaToken || coin.mint || (coin.chain === 'evm' && coin.address)) return undefined;
    if (!coin.id || isOnChainAddress(coin.id)) return undefined;

    var controller = new AbortController();
    setCgMetaLoading(true);
    setCgMeta(null);
    setCgMetaFailed(false);

    fetch(
      'https://api.coingecko.com/api/v3/coins/' + coin.id + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false',
      { signal: controller.signal }
    )
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) {
          // Empty-platforms marker so the pools effect can proceed (it waits
          // on cgMeta != null). cgMetaFailed flag prevents the UI from
          // misreading this as "native asset".
          setCgMeta({ platforms: {}, asset_platform_id: null });
          setCgMetaFailed(true);
          setCgMetaLoading(false);
          return;
        }
        setCgMeta({ platforms: data.platforms || {}, asset_platform_id: data.asset_platform_id || null });
        setCgMetaLoading(false);
      })
      .catch(function(e) {
        if (e.name !== 'AbortError') {
          console.warn('CG meta fetch failed:', e);
          setCgMeta({ platforms: {}, asset_platform_id: null });
          setCgMetaFailed(true);
        }
        setCgMetaLoading(false);
      });

    return function() { controller.abort(); };
  }, [coin]);

  useEffect(function() {
    if (!coin) return undefined;
    var controller = new AbortController();
    var signal = controller.signal;

    var fetchChart = async function() {
      setChartLoading(true);
      try {
        var days = parseInt(chartPeriod) || 7;
        var points = [];
        var isCgCoin = coin.id && !coin.isSolanaToken && !isOnChainAddress(coin.id);

        if (isCgCoin) {
          var cgRes = await fetch(
            'https://api.coingecko.com/api/v3/coins/' + coin.id + '/market_chart?vs_currency=usd&days=' + days,
            { signal }
          );
          var cgData = await cgRes.json();
          var interval = days <= 1 ? 1 : days <= 7 ? 6 : 24;
          points = (cgData.prices || [])
            .filter(function(_, i) { return i % interval === 0; })
            .map(function(item) {
              return {
                t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
                p: parseFloat(item[1].toFixed(6)),
              };
            });
        } else {
          var tokenAddr = isEvmToken ? (coin.address || coin.id) : (coin.mint || coin.id);
          var network = isEvmToken ? (GT_NETWORKS[coin.chainId] || 'eth') : 'solana';
          var timeframe = days <= 1 ? 'minute' : 'day';
          var aggregate = days <= 1 ? 30 : 1;
          var limit = days <= 1 ? 48 : days;
          var gtRes = await fetch(
            'https://api.geckoterminal.com/api/v2/networks/' + network + '/tokens/' + tokenAddr + '/ohlcv/' + timeframe + '?aggregate=' + aggregate + '&limit=' + limit,
            { signal }
          );
          var gtData = await gtRes.json();
          var ohlcv = gtData.data && gtData.data.attributes && gtData.data.attributes.ohlcv_list;
          if (ohlcv && ohlcv.length) {
            points = ohlcv.map(function(item) {
              return {
                t: new Date(item[0] * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
                p: parseFloat(parseFloat(item[4]).toFixed(6)),
              };
            });
          }
        }

        if (points.length) setChartData(points);
        else setChartData([]);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Chart fetch failed:', e);
      }
      setChartLoading(false);
    };

    fetchChart();
    return function() { controller.abort(); };
  }, [coin, chartPeriod, isEvmToken]);

  useEffect(function() {
    if (!coin) return undefined;
    var isMounted = true;
    var controller = new AbortController();
    var signal = controller.signal;

    setPoolsLoading(true);
    setPools([]);
    setTotalLiquidity(0);

    var fetchPools = async function() {
      try {
        var tokenAddr = isEvmToken ? coin.address : coin.mint;

        if (!tokenAddr || !isOnChainAddress(tokenAddr)) {
          if (coin.id && isOnChainAddress(coin.id)) {
            tokenAddr = coin.id;
          } else if (coin.id && !coin.isSolanaToken) {
            // We need platforms from cgMeta. The dedicated cgMeta effect
            // populates it in parallel. If not loaded yet, bail -- this
            // effect re-runs once cgMeta arrives (it's in the dep array).
            if (!cgMeta) {
              return;
            }
            var platforms = cgMeta.platforms || {};
            tokenAddr = platforms['ethereum']
              || platforms['solana']
              || Object.values(platforms).find(function(v) { return v && isOnChainAddress(v); })
              || null;
          }
        }

        if (!tokenAddr || !isOnChainAddress(tokenAddr)) {
          if (isMounted) { setPools([]); setTotalLiquidity(0); setPoolsLoading(false); }
          return;
        }

        // Try DexScreener first.
        var dsData = await fetch(
          'https://api.dexscreener.com/latest/dex/tokens/' + tokenAddr,
          { signal }
        )
          .then(function(r) { return r.ok ? r.json() : { pairs: [] }; })
          .catch(function() { return { pairs: [] }; });

        if (!isMounted) return;

        var pairs = (dsData.pairs || [])
          .sort(function(a, b) { return (b.liquidity && b.liquidity.usd || 0) - (a.liquidity && a.liquidity.usd || 0); })
          .slice(0, 5);

        // H7 -- GeckoTerminal fallback. DexScreener has gaps especially on
        // Solana memecoins; GT fills those in. Only used when DS returned 0.
        if (pairs.length === 0) {
          var network = isEvmToken
            ? (GT_NETWORKS[coin.chainId] || 'eth')
            : 'solana';
          var gtData = await fetch(
            'https://api.geckoterminal.com/api/v2/networks/' + network + '/tokens/' + tokenAddr + '/pools?page=1',
            { signal }
          )
            .then(function(r) { return r.ok ? r.json() : { data: [] }; })
            .catch(function() { return { data: [] }; });

          if (!isMounted) return;

          // Map GT pool shape into the same shape the renderer expects from
          // DexScreener -- that way the JSX below doesn't need to branch.
          pairs = (gtData.data || []).slice(0, 5).map(function(p) {
            var a = p.attributes || {};
            var rels = p.relationships || {};
            var dexId = (rels.dex && rels.dex.data && rels.dex.data.id) || 'geckoterminal';
            var name = a.name || '';
            var pairParts = name.split(' / ');
            return {
              pairAddress: p.id,
              dexId: dexId,
              baseToken: { symbol: pairParts[0] || '?' },
              quoteToken: { symbol: pairParts[1] || '?' },
              liquidity: { usd: parseFloat(a.reserve_in_usd) || 0 },
              volume: { h24: parseFloat(a.volume_usd && a.volume_usd.h24) || 0 },
            };
          });
        }

        if (!isMounted) return;
        var total = pairs.reduce(function(sum, p) { return sum + (p.liquidity && p.liquidity.usd || 0); }, 0);
        setPools(pairs);
        setTotalLiquidity(total);
        setPoolsLoading(false);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Pool fetch failed:', e);
        if (isMounted) { setPools([]); setTotalLiquidity(0); setPoolsLoading(false); }
      }
    };

    fetchPools();
    return function() { isMounted = false; controller.abort(); };
  }, [coin, isEvmToken, cgMeta]);

  if (!coin) return null;

  // Use the live coin data for price/change when available, fall back to prop.
  var displayPrice  = liveCoin.current_price;
  var priceChange   = liveCoin.price_change_percentage_24h || 0;
  var chartColor    = priceChange >= 0 ? C.green : C.red;

 return (
   <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
     <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>Back to Markets</button>

     <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
           {coin.image
             ? <img src={coin.image} alt={coin.symbol} style={{ width: 48, height: 48, borderRadius: '50%' }} />
             : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{coin.symbol && coin.symbol.charAt(0).toUpperCase()}</div>
           }
           <div>
             <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{coin.name}</div>
             <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
               {coin.symbol && coin.symbol.toUpperCase()} {liveCoin.market_cap_rank ? '- Rank #' + liveCoin.market_cap_rank : ''}
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

       <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
         {[['1', '1D'], ['7', '7D'], ['30', '30D']].map(function(item) {
           var val = item[0], label = item[1];
           return (
             <button
               key={val}
               onClick={function() { setChartPeriod(val); }}
               style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600, background: chartPeriod === val ? 'rgba(0,229,255,.12)' : 'transparent', border: '1px solid ' + (chartPeriod === val ? 'rgba(0,229,255,.35)' : C.border), color: chartPeriod === val ? C.accent : C.muted, fontFamily: 'Syne, sans-serif' }}
             >
               {label}
             </button>
           );
         })}
       </div>

       {chartLoading ? (
         <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Loading chart...</div>
       ) : chartData.length === 0 ? (
         <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>No chart data available</div>
       ) : (
         <ResponsiveContainer width="100%" height={220}>
           <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
             <defs>
               <linearGradient id="tdGrad" x1="0" y1="0" x2="0" y2="1">
                 <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                 <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
               </linearGradient>
             </defs>
             {/* L4 -- show date tick labels (was hide). Muted color so the
                 gradient stays the focal point. */}
             <XAxis
               dataKey="t"
               tick={{ fill: C.muted, fontSize: 10 }}
               axisLine={false}
               tickLine={false}
               interval="preserveStartEnd"
               minTickGap={40}
             />
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

     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
       <button
         onClick={function() { setDrawerMode('buy'); setDrawerOpen(true); }}
         style={{ padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}
       >
         Buy {coin.symbol && coin.symbol.toUpperCase()}
       </button>
       <button
         onClick={function() { setDrawerMode('sell'); setDrawerOpen(true); }}
         style={{ padding: '18px 10px', borderRadius: 14, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}
       >
         Sell {coin.symbol && coin.symbol.toUpperCase()}
       </button>
     </div>

     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
       {[
         ['MARKET CAP',         fmt(liveCoin.market_cap)],
         ['24H VOLUME',         fmt(liveCoin.total_volume)],
         ['24H HIGH',           fmt(liveCoin.high_24h)],
         ['24H LOW',            fmt(liveCoin.low_24h)],
         ['ALL TIME HIGH',      fmt(liveCoin.ath)],
         ['ATH CHANGE',         pct(liveCoin.ath_change_percentage)],
         ['CIRCULATING SUPPLY', liveCoin.circulating_supply ? (liveCoin.circulating_supply / 1e6).toFixed(2) + 'M' : '--'],
         ['MARKET CAP RANK',    liveCoin.market_cap_rank ? '#' + liveCoin.market_cap_rank : '--'],
       ].map(function(item) {
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
           ['1 Hour',   liveCoin.price_change_percentage_1h_in_currency],
           ['24 Hours', liveCoin.price_change_percentage_24h],
           ['7 Days',   liveCoin.price_change_percentage_7d_in_currency],
         ].map(function(item) {
           var v = item[1] || 0;
           return (
             <div key={item[0]} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
               <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{item[0]}</div>
               <div style={{ fontSize: 15, fontWeight: 700, color: v >= 0 ? C.green : C.red }}>{pct(v)}</div>
             </div>
           );
         })}
       </div>
     </div>

     <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
         <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>LIQUIDITY</div>
         {totalLiquidity > 0 && <div style={{ fontSize: 15, fontWeight: 700, color: C.accent }}>{fmt(totalLiquidity)} total</div>}
       </div>
       {poolsLoading || cgMetaLoading ? (
         <div style={{ color: C.muted, fontSize: 12, padding: '8px 0' }}>Loading pools...</div>
       ) : pools.length === 0 ? (
         // H7 -- distinguish "native asset, by design no DEX liquidity here"
         // from "we couldn't find any liquidity for this contract".
         <div style={{ color: C.muted, fontSize: 12, padding: '8px 0' }}>
           {isNativeCgCoin
             ? 'Native asset -- no on-chain DEX liquidity at this address.'
             : 'No liquidity data found.'}
         </div>
       ) : (
         pools.map(function(pool, i) {
           var liq       = pool.liquidity && pool.liquidity.usd || 0;
           var vol       = pool.volume && pool.volume.h24 || 0;
           var pairLabel = pool.baseToken && pool.quoteToken ? pool.baseToken.symbol + '/' + pool.quoteToken.symbol : '--';
           var dexName   = pool.dexId ? pool.dexId.charAt(0).toUpperCase() + pool.dexId.slice(1) : '--';
           return (
             <div key={pool.pairAddress || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < pools.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
               <div>
                 <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{dexName}</div>
                 <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{pairLabel} - Vol 24h: {fmt(vol)}</div>
               </div>
               <div style={{ textAlign: 'right' }}>
                 <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmt(liq)}</div>
                 <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Liquidity</div>
               </div>
             </div>
           );
         })
       )}
     </div>

     {contractAddress && isOnChainAddress(contractAddress) && (
       <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
         <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>{contractLabel}</div>
         <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{contractAddress}</div>
       </div>
     )}

     {/* H9 -- pass the enriched coin (with address+chainId for EVM, mint+chain
         for Solana). Drawer can now pick correct from/to defaults. */}
     <TradeDrawer
       open={drawerOpen}
       onClose={function() { setDrawerOpen(false); }}
       mode={drawerMode}
       coin={enrichedCoin}
       jupiterTokens={jupiterTokens}
       coins={coins}
       onConnectWallet={onConnectWallet}
       isConnected={walletConnected}
     />
   </div>
 );
}

