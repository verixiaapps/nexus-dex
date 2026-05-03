import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TradeDrawer } from './SwapWidget';
 
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

// Fix 1: Full chainId -> GeckoTerminal network slug map.
const GT_NETWORKS = {
  1: 'eth', 137: 'polygon_pos', 42161: 'arbitrum', 8453: 'base',
  56: 'bsc', 43114: 'avax', 10: 'optimism', 100: 'xdai',
  324: 'zksync', 59144: 'linea', 534352: 'scroll', 5000: 'mantle',
  81457: 'blast', 34443: 'mode', 130: 'unichain', 146: 'sonic',
  80094: 'berachain', 57073: 'ink', 480: 'worldchain',
  250: 'fantom', 25: 'cronos', 1284: 'moonbeam', 42220: 'celo', 1329: 'sei',
};

// Fix 6: Default parameter instead of d = d || 2 (d||2 breaks when d=0)
function fmt(n, d = 2) {
  if (n == null) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

// Fix 7: n == null is explicit and idiomatic
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
  const [chartData, setChartData] = useState([]);
  const [chartPeriod, setChartPeriod] = useState('7');
  const [chartLoading, setChartLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [totalLiquidity, setTotalLiquidity] = useState(0);

  // Fix 5 + 8: const/let throughout; isEvmToken as const (not var)
  const isEvmToken = coin && (coin.chain === 'evm' || (coin.address && !coin.mint));

  // Fix 10: Build contractLabel uppercase once here, not via .toUpperCase() in JSX every render
  const contractAddress = isEvmToken
    ? (coin?.address || coin?.id)
    : (coin?.mint || (isOnChainAddress(coin?.id) ? coin?.id : null));
  const contractLabel = isEvmToken
    ? ((CHAIN_NAMES[coin?.chainId] || 'EVM') + ' CONTRACT').toUpperCase()
    : 'SOLANA CONTRACT';

  useEffect(() => {
    if (!coin) return;

    // Fix 2: AbortController so in-flight chart requests are cancelled if
    // the user changes period or navigates away before the fetch completes.
    const controller = new AbortController();
    const { signal } = controller;

    const fetchChart = async () => {
      setChartLoading(true);
      try {
        const days = parseInt(chartPeriod) || 7;
        let points = [];
        const isCgCoin = coin.id && !coin.isSolanaToken && !isOnChainAddress(coin.id);

        if (isCgCoin) {
          const cgRes = await fetch(
            `https://api.coingecko.com/api/v3/coins/${coin.id}/market_chart?vs_currency=usd&days=${days}`,
            { signal }
          );
          const cgData = await cgRes.json();
          const interval = days <= 1 ? 1 : days <= 7 ? 6 : 24;
          points = (cgData.prices || [])
            .filter((_, i) => i % interval === 0)
            .map(item => ({
              t: new Date(item[0]).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
              p: +item[1].toFixed(6),
            }));
        } else {
          const tokenAddr = isEvmToken ? (coin.address || coin.id) : (coin.mint || coin.id);
          // Fix 1: Use the chainId->slug map instead of hardcoding 'ethereum'
          const network = isEvmToken ? (GT_NETWORKS[coin.chainId] || 'eth') : 'solana';
          const timeframe = days <= 1 ? 'minute' : 'day';
          const aggregate = days <= 1 ? 30 : 1;
          const limit = days <= 1 ? 48 : days;
          const gtRes = await fetch(
            `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddr}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
            { signal }
          );
          const gtData = await gtRes.json();
          const ohlcv = gtData.data?.attributes?.ohlcv_list;
          if (ohlcv?.length) {
            points = ohlcv.map(item => ({
              t: new Date(item[0] * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
              p: +parseFloat(item[4]).toFixed(6),
            }));
          }
        }

        if (points.length) setChartData(points);
      } catch (e) {
        // Fix 3: Log chart fetch failures instead of silently swallowing them
        if (e.name !== 'AbortError') console.warn('Chart fetch failed:', e);
      }
      setChartLoading(false);
    };

    fetchChart();
    return () => controller.abort();
  }, [coin, chartPeriod, isEvmToken]);

  useEffect(() => {
    if (!coin) return;
    let isMounted = true;

    // Fix 2: AbortController for pool fetches too
    const controller = new AbortController();
    const { signal } = controller;

    setPoolsLoading(true);
    setPools([]);
    setTotalLiquidity(0);

    const fetchPools = async () => {
      try {
        let tokenAddr = isEvmToken ? coin.address : coin.mint;

        if (!tokenAddr || !isOnChainAddress(tokenAddr)) {
          if (coin.id && isOnChainAddress(coin.id)) {
            tokenAddr = coin.id;
          } else if (coin.id && !coin.isSolanaToken) {
            const cgRes = await fetch(
              `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
              { signal }
            );
            if (cgRes.ok) {
              const cgData = await cgRes.json();
              const platforms = cgData.platforms || {};
              tokenAddr = platforms['ethereum']
                || platforms['solana']
                || Object.values(platforms).find(v => v && isOnChainAddress(v))
                || null;
            }
          }
        }

        if (!tokenAddr || !isOnChainAddress(tokenAddr)) {
          if (isMounted) { setPools([]); setTotalLiquidity(0); setPoolsLoading(false); }
          return;
        }

        const data = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`,
          { signal }
        )
          .then(r => r.ok ? r.json() : { pairs: [] })
          .catch(() => ({ pairs: [] }));

        if (!isMounted) return;

        const pairs = (data.pairs || [])
          .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
          .slice(0, 5);
        const total = pairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);
        setPools(pairs);
        setTotalLiquidity(total);
        setPoolsLoading(false);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Pool fetch failed:', e);
        if (isMounted) { setPools([]); setTotalLiquidity(0); setPoolsLoading(false); }
      }
    };

    fetchPools();
    return () => { isMounted = false; controller.abort(); };
  }, [coin, isEvmToken]);

  if (!coin) return null;

  const priceChange = coin.price_change_percentage_24h || 0;
  const chartColor  = priceChange >= 0 ? C.green : C.red;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>Back to Markets</button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {coin.image
              ? <img src={coin.image} alt={coin.symbol} style={{ width: 48, height: 48, borderRadius: '50%' }} />
              : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{coin.symbol?.charAt(0).toUpperCase()}</div>
            }
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{coin.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {coin.symbol?.toUpperCase()} {coin.market_cap_rank ? '- Rank #' + coin.market_cap_rank : ''}
                {isEvmToken && (
                  <span style={{ fontSize: 9, color: '#627eea', background: 'rgba(98,126,234,.15)', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }}>
                    {CHAIN_NAMES[coin.chainId] || 'EVM'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(coin.current_price)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: priceChange >= 0 ? C.green : C.red, marginTop: 2 }}>{pct(priceChange)} (24H)</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['1', '1D'], ['7', '7D'], ['30', '30D']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setChartPeriod(val)}
              style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600, background: chartPeriod === val ? 'rgba(0,229,255,.12)' : 'transparent', border: '1px solid ' + (chartPeriod === val ? 'rgba(0,229,255,.35)' : C.border), color: chartPeriod === val ? C.accent : C.muted, fontFamily: 'Syne, sans-serif' }}
            >
              {label}
            </button>
          ))}
        </div>

        {chartLoading ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Loading chart...</div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>No chart data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11 }}
                formatter={v => [fmt(v), 'Price']}
              />
              <Area type="monotone" dataKey="p" stroke={chartColor} strokeWidth={2} fill="url(#tdGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Buy / Sell */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button
          onClick={() => { setDrawerMode('buy'); setDrawerOpen(true); }}
          style={{ padding: '18px 10px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}
        >
          Buy {coin.symbol?.toUpperCase()}
        </button>
        <button
          onClick={() => { setDrawerMode('sell'); setDrawerOpen(true); }}
          style={{ padding: '18px 10px', borderRadius: 14, cursor: 'pointer', background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}
        >
          Sell {coin.symbol?.toUpperCase()}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {[
          ['MARKET CAP',         fmt(coin.market_cap)],
          ['24H VOLUME',         fmt(coin.total_volume)],
          ['24H HIGH',           fmt(coin.high_24h)],
          ['24H LOW',            fmt(coin.low_24h)],
          ['ALL TIME HIGH',      fmt(coin.ath)],
          ['ATH CHANGE',         pct(coin.ath_change_percentage)],
          ['CIRCULATING SUPPLY', coin.circulating_supply ? (coin.circulating_supply / 1e6).toFixed(2) + 'M' : '--'],
          ['MARKET CAP RANK',    coin.market_cap_rank ? '#' + coin.market_cap_rank : '--'],
        ].map(([label, value]) => (
          <div key={label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PRICE CHANGES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            ['1 Hour',   coin.price_change_percentage_1h_in_currency],
            ['24 Hours', coin.price_change_percentage_24h],
            ['7 Days',   coin.price_change_percentage_7d_in_currency],
          ].map(([label, val]) => {
            const v = val || 0;
            return (
              <div key={label} style={{ background: C.card2, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{label}</div>
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
        {poolsLoading ? (
          <div style={{ color: C.muted, fontSize: 12, padding: '8px 0' }}>Loading pools...</div>
        ) : pools.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12, padding: '8px 0' }}>No liquidity data found</div>
        ) : (
          pools.map((pool, i) => {
            const liq       = pool.liquidity?.usd || 0;
            const vol       = pool.volume?.h24 || 0;
            const pairLabel = pool.baseToken && pool.quoteToken ? `${pool.baseToken.symbol}/${pool.quoteToken.symbol}` : '--';
            const dexName   = pool.dexId ? pool.dexId.charAt(0).toUpperCase() + pool.dexId.slice(1) : '--';
            return (
              // Fix 9: key on pairAddress (unique per pool) instead of array index
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

      {/* Fix 10: contractLabel already uppercase — no .toUpperCase() in render */}
      {contractAddress && isOnChainAddress(contractAddress) && (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>{contractLabel}</div>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>{contractAddress}</div>
        </div>
      )}

      {/* Fix 4: TradeDrawer owns its open state via the prop */}
      <TradeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        coin={coin}
        jupiterTokens={jupiterTokens}
        coins={coins}
        onConnectWallet={onConnectWallet}
        isConnected={isConnected}
      />
    </div>
  );
}
