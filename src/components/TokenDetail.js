import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TradeDrawer } from './SwapWidget.jsx';
import InstantTrade from './InstantTrade.jsx';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};
 
const CHAIN_NAMES = {
  1:'Ethereum',137:'Polygon',42161:'Arbitrum',8453:'Base',56:'BNB Chain',
  43114:'Avalanche',10:'Optimism',100:'Gnosis',324:'zkSync Era',59144:'Linea',
  534352:'Scroll',5000:'Mantle',81457:'Blast',34443:'Mode',130:'Unichain',
  146:'Sonic',80094:'Berachain',57073:'Ink',480:'World Chain',
};

function fmt(n, d) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  const v = Number(n);
  d = d != null ? d : (v >= 1000 ? 2 : v >= 1 ? 4 : 8);
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(d);
  if (v > 0) return '$' + v.toFixed(8);
  return '$0.00';
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || '';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

async function fetchTokenData(address, chainId) {
  try {
    const res = await fetch('/api/dexscreener/latest/dex/tokens/' + encodeURIComponent(address));
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.pairs)) return null;

    let best = null;
    for (const p of data.pairs) {
      const liq = Number(p.liquidity?.usd || 0);
      if (!best || liq > (best._liq || 0)) best = p;
    }
    if (!best) return null;

    const bt = best.baseToken || {};
    const isSol = best.chainId === 'solana';
    const addr = bt.address || '';

    return {
      mint: isSol ? addr : undefined,
      address: isSol ? undefined : addr,
      chain: isSol ? 'solana' : 'evm',
      chainId: chainId || best.chainId,
      symbol: bt.symbol || '???',
      name: bt.name || bt.symbol || 'Unknown',
      image: bt.imgUrl || best.info?.imageUrl || null,
      logoURI: bt.imgUrl || best.info?.imageUrl || null,
      decimals: bt.decimals || (isSol ? 6 : 18),
      current_price: Number(best.priceUsd || 0) || 0,
      market_cap: Number(best.marketCap || best.fdv || 0) || 0,
      total_volume: Number(best.volume?.h24 || 0) || 0,
      price_change_percentage_24h: best.priceChange?.h24 != null ? Number(best.priceChange.h24) : null,
      liquidity: Number(best.liquidity?.usd || 0) || 0,
      quoteSymbol: (best.quoteToken || {}).symbol || '',
      pairAddress: best.pairAddress || '',
    };
  } catch {
    return null;
  }
}

export default function TokenDetail({ coin, onBack, onConnectWallet }) {
  const { headerChain, setHeaderChain, presets, setPresets } = useNexusWallet();
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();

  const [tokenData, setTokenData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userTokenBalance, setUserTokenBalance] = useState(0);
  const [userTokenDecimals, setUserTokenDecimals] = useState(null);
  const [tradeRefreshTick, setTradeRefreshTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('buy');

  const contractAddress = useMemo(() => {
    if (!coin) return null;
    if (coin.mint) return coin.mint;
    if (coin.address && coin.chain === 'evm') return coin.address;
    if (coin.address) return coin.address;
    return null;
  }, [coin]);

  const chainId = useMemo(() => {
    if (!coin) return null;
    if (coin.chain === 'solana') return null;
    return coin.chainId || null;
  }, [coin]);

  // SOL price for Quick Buy — use coin's SOL price if provided, or fallback
  const solPriceUsd = useMemo(() => {
    if (coin?.solPriceUsd && coin.solPriceUsd > 0) return coin.solPriceUsd;
    if (coin?.current_price && coin?.symbol === 'SOL') return coin.current_price;
    return 0;
  }, [coin]);

  useEffect(() => {
    if (!contractAddress) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchTokenData(contractAddress, chainId).then(data => {
      if (!cancelled && data) setTokenData(data);
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contractAddress, chainId]);

  useEffect(() => {
    if (!tokenData || !tokenData.mint || !solConnected || !publicKey || !connection) {
      setUserTokenBalance(0);
      setUserTokenDecimals(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mintPk = new PublicKey(tokenData.mint);
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk });
        if (cancelled) return;
        let total = 0, dec = null;
        if (resp?.value) {
          resp.value.forEach(acc => {
            try {
              const info = acc.account.data.parsed.info;
              const ta = info?.tokenAmount;
              if (ta) {
                if (dec == null) dec = Number(ta.decimals);
                total += parseFloat(ta.uiAmountString || ta.uiAmount || 0);
              }
            } catch {}
          });
        }
        setUserTokenBalance(total);
        if (dec != null) setUserTokenDecimals(dec);
      } catch { if (!cancelled) { setUserTokenBalance(0); setUserTokenDecimals(null); } }
    })();
    return () => { cancelled = true; };
  }, [tokenData, solConnected, publicKey, connection, tradeRefreshTick]);

  const openDrawer = useCallback((mode) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  if (loading && !tokenData) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button>
        <div style={{ fontSize: 16 }}>Loading token data...</div>
      </div>
    );
  }

  if (!tokenData) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 40, textAlign: 'center', color: C.muted, fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 30, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back to Markets</button>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Token not found</div>
        <div style={{ fontSize: 12, color: C.muted2 }}>DexScreener returned no data for this contract.</div>
      </div>
    );
  }

  const td = tokenData;
  const isSol = td.chain === 'solana';
  const isEvm = td.chain === 'evm';
  const sym = (td.symbol || '???').toUpperCase();
  const price = td.current_price;
  const change = td.price_change_percentage_24h;

  const statsItems = [
    ['MARKET CAP', fmt(td.market_cap)],
    ['24H VOLUME', fmt(td.total_volume)],
    ['LIQUIDITY', fmt(td.liquidity)],
    ['CHAIN', isSol ? 'Solana' : (CHAIN_NAMES[td.chainId] || 'EVM')],
    ['PAIR', shortAddr(td.pairAddress)],
    ['QUOTE', td.quoteSymbol || '-'],
  ];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: 'Syne, sans-serif' }}>← Back to Markets</button>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {td.image
              ? <img src={td.image} alt={sym} style={{ width: 48, height: 48, borderRadius: '50%' }} />
              : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: C.accent }}>{sym.charAt(0)}</div>
            }
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, color: '#fff' }}>{td.name || sym}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sym}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{fmt(price)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: (change || 0) >= 0 ? C.green : C.red, marginTop: 2 }}>{pct(change)} (24H)</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <InstantTrade
          token={td}
          solPrice={solPriceUsd}
          tokenBalance={userTokenBalance}
          tokenDecimals={userTokenDecimals}
          onConnectWallet={onConnectWallet}
          onOpenDrawer={(mode, opts) => { setDrawerMode(mode); setDrawerOpen(true); }}
          onTradeComplete={() => setTradeRefreshTick(t => t + 1)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <button onClick={() => openDrawer('buy')}
          style={{ padding: 18, borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>
          Buy {sym}
        </button>
        <button onClick={() => openDrawer('sell')}
          style={{ padding: 18, borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.3)', color: C.red,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, minHeight: 56 }}>
          Sell {sym}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {statsItems.map(item => (
          <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>{item[0]}</div>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{item[1]}</div>
          </div>
        ))}
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
          {isSol ? 'SOLANA CONTRACT' : 'EVM CONTRACT'}
        </div>
        <div style={{ fontSize: 11, color: C.accent, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>
          {contractAddress}
        </div>
      </div>

      <TradeDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        mode={drawerMode}
        coin={td}
        onConnectWallet={onConnectWallet}
        headerChain={headerChain}
        onHeaderChainChange={setHeaderChain}
        presets={presets}
        onPresetsChange={setPresets}
      />
    </div>
  );
}