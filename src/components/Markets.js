import React, { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * NEXUS DEX -- Markets
 * 
 * Data source: DexScreener (multi-chain, no API key)
 * Browse: /token-boosts/latest/v1
 * Search: /latest/dex/search?q=
 */

const C = {
  card: '#080d1a',
  card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff',
  green: '#00ffa3',
  red: '#ff3b6b',
  text: '#cdd6f4',
  muted: '#586994',
};

const DEXSCREENER_BOOSTS = '/api/dexscreener/token-boosts/latest/v1';
const DEXSCREENER_SEARCH = '/api/dexscreener/latest/dex/search';

const CHAIN_NAMES = {
  solana: 'SOL',
  ethereum: 'ETH',
  bsc: 'BSC',
  polygon: 'POL',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'BASE',
  avalanche: 'AVAX',
  fantom: 'FTM',
  cronos: 'CRO',
  linea: 'LINEA',
  scroll: 'SCROLL',
  mantle: 'MNT',
  blast: 'BLAST',
  zksync: 'ZKS',
  gnosis: 'GNO',
  celo: 'CELO',
  moonbeam: 'GLMR',
  aurora: 'AURORA',
  metis: 'METIS',
};

function fmt(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '-';
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
  if (x >= 1000) return '$' + x.toLocaleString('en-US', { maximumFractionDigits: d });
  if (x >= 1) return '$' + x.toFixed(d);
  return '$' + x.toFixed(6);
}

function pctFmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || '';
  return a.slice(0, 4) + '...' + a.slice(-4);
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function mapDexScreenerBoost(b) {
  if (!b || !b.tokenAddress || !b.chainId) return null;

  const price = Number(b.price || b.priceUsd || 0) || 0;
  const change = b.priceChange ? b.priceChange : (b.priceChange24h != null ? Number(b.priceChange24h) : null);
  const volume = Number(b.volume || b.totalVolume || 0) || 0;
  const mcap = Number(b.marketCap || b.fdv || 0) || 0;

  return {
    id: b.chainId + '-' + b.tokenAddress,
    chain: b.chainId,
    chainId: b.chainId,
    mint: b.chainId === 'solana' ? b.tokenAddress : undefined,
    address: b.chainId !== 'solana' ? b.tokenAddress : undefined,
    symbol: b.symbol || b.baseToken?.symbol || '???',
    name: b.name || b.baseToken?.name || 'Unknown',
    logoURI: b.imgUrl || b.imageUrl || b.baseToken?.imgUrl || null,
    image: b.imgUrl || b.imageUrl || b.baseToken?.imgUrl || null,
    current_price: price,
    market_cap: mcap,
    total_volume: volume,
    price_change_percentage_24h: Number.isFinite(change) ? change : null,
    verified: !!b.isVerified,
    isSolanaToken: b.chainId === 'solana',
    source: 'dexscreener',
    decimals: b.baseToken?.decimals || (b.chainId === 'solana' ? 9 : 18),
  };
}

function mapDexScreenerSearch(p) {
  if (!p || !p.chainId || !p.pairAddress) return null;

  const bt = p.baseToken || {};
  const qt = p.quoteToken || {};
  const price = Number(p.priceUsd || 0) || 0;
  const change = p.priceChange ? p.priceChange : (p.priceChange24h != null ? Number(p.priceChange24h) : null);
  const volume = Number(p.volume ? p.volume.h24 || p.volume : 0) || 0;
  const mcap = Number(p.marketCap || p.fdv || 0) || 0;

  return {
    id: p.chainId + '-' + bt.address,
    chain: p.chainId,
    chainId: p.chainId,
    mint: p.chainId === 'solana' ? bt.address : undefined,
    address: p.chainId !== 'solana' ? bt.address : undefined,
    symbol: bt.symbol || '???',
    name: bt.name || 'Unknown',
    logoURI: bt.imgUrl || p.info?.imageUrl || null,
    image: bt.imgUrl || p.info?.imageUrl || null,
    current_price: price,
    market_cap: mcap,
    total_volume: volume,
    price_change_percentage_24h: Number.isFinite(change) ? change : null,
    verified: false,
    isSolanaToken: p.chainId === 'solana',
    source: 'dexscreener',
    decimals: bt.decimals || (p.chainId === 'solana' ? 9 : 18),
  };
}

function isUsableRow(c) {
  if (!c || !c.symbol || !String(c.symbol).trim()) return false;
  if (c.chain === 'solana') return !!(c.mint && c.mint.length >= 32);
  return !!(c.address && c.address.startsWith('0x'));
}

function toCanonicalToken(c) {
  if (!isUsableRow(c)) return null;
  if (c.chain === 'solana') {
    return {
      chain: 'solana',
      mint: c.mint,
      symbol: c.symbol,
      name: c.name || c.symbol,
      decimals: typeof c.decimals === 'number' ? c.decimals : 9,
      logoURI: c.logoURI || c.image || null,
      source: c.source || 'dexscreener',
    };
  }
  return {
    chain: 'evm',
    address: c.address,
    chainId: c.chainId,
    symbol: c.symbol,
    name: c.name || c.symbol,
    decimals: typeof c.decimals === 'number' ? c.decimals : 18,
    logoURI: c.logoURI || c.image || null,
    source: c.source || 'dexscreener',
  };
}

function RowImage({ token, size }) {
  const [broken, setBroken] = useState(false);
  const letter = String(token.symbol || '?').charAt(0).toUpperCase();

  if (!token.image || broken) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800, color: C.accent, flexShrink: 0,
      }}>{letter}</div>
    );
  }

  return (
    <img src={token.image} alt={token.symbol} onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} />
  );
}

function ChainBadge({ token }) {
  const label = CHAIN_NAMES[token.chain] || token.chain?.toUpperCase() || '?';
  return (
    <span style={{
      display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4,
      background: 'rgba(0,229,255,.07)', border: '1px solid rgba(0,229,255,.18)',
      color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, verticalAlign: 'middle',
    }}>{label}</span>
  );
}

function renderRow(c, i, isMobile, onRowClick) {
  const change = c.price_change_percentage_24h;
  const positive = (Number(change) || 0) >= 0;
  const displaySymbol = String(c.symbol || '').toUpperCase();

  const style = isMobile ? {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer',
  } : {
    display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px',
    gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)',
    cursor: 'pointer', alignItems: 'center',
  };

  return (
    <div key={c.id} onClick={() => onRowClick(c)} style={style}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.03)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div style={{ color: C.muted, fontSize: isMobile ? 10 : 11, width: isMobile ? 18 : undefined, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>

      {isMobile ? (
        <>
          <RowImage token={c} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || displaySymbol}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{displaySymbol}<ChainBadge token={c} /></div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{shortAddr(c.mint || c.address)}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
            <div style={{ fontSize: 11, color: positive ? C.green : C.red, marginTop: 1, fontWeight: 600 }}>{pctFmt(change)}</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <RowImage token={c} size={32} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || displaySymbol}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{displaySymbol}<ChainBadge token={c} /><span style={{ marginLeft: 6 }}>{shortAddr(c.mint || c.address)}</span></div>
            </div>
          </div>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div>
          <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pctFmt(change)}</div>
          <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
        </>
      )}
    </div>
  );
}

export default function Markets({ onSelectCoin }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [browseTokens, setBrowseTokens] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const debouncedQ = useDebounce(q, 350);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Browse: DexScreener trending boosts
  useEffect(() => {
    let cancelled = false;
    setBrowseLoading(true);

    fetch(DEXSCREENER_BOOSTS)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (cancelled) return;
        const tokens = (Array.isArray(data) ? data : [])
          .map(mapDexScreenerBoost)
          .filter(isUsableRow);
        setBrowseTokens(tokens);
        setBrowseLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setBrowseTokens([]); setBrowseLoading(false); }
      });

    return () => { cancelled = true; };
  }, []);

  // Search: DexScreener search
  useEffect(() => {
    const trimmed = debouncedQ.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    fetch(DEXSCREENER_SEARCH + '?q=' + encodeURIComponent(trimmed))
      .then(r => r.ok ? r.json() : { pairs: [] })
      .then(data => {
        if (cancelled) return;
        const pairs = Array.isArray(data.pairs) ? data.pairs : [];
        const tokens = pairs.map(mapDexScreenerSearch).filter(isUsableRow);
        setSearchResults(tokens);
        setSearchLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setSearchResults([]); setSearchLoading(false); }
      });

    return () => { cancelled = true; };
  }, [debouncedQ]);

  const handleSort = useCallback(key => {
    if (sort === key) setDir(d => -d);
    else { setSort(key); setDir(-1); }
  }, [sort]);

  const sorted = useMemo(() => {
    const trimmed = debouncedQ.trim();
    if (trimmed) return searchResults;
    return browseTokens.slice().sort((a, b) => {
      const av = Number(a[sort] || 0);
      const bv = Number(b[sort] || 0);
      return dir * (av - bv);
    }).slice(0, 50);
  }, [debouncedQ, searchResults, browseTokens, sort, dir]);

  const handleRowClick = useCallback(row => {
    const canonical = toCanonicalToken(row);
    if (!canonical) return;
    if (typeof onSelectCoin === 'function') onSelectCoin(canonical);
  }, [onSelectCoin]);

  const loading = browseLoading && !q;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>DexScreener trending — multi-chain. Search any token.</p>
        </div>

        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Name, symbol, or contract..."
            style={{
              background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border),
              borderRadius: 10, padding: '10px 36px 10px 14px', color: '#fff',
              fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none',
              width: '100%', boxSizing: 'border-box',
            }}
          />
          {q && (
            <button onClick={() => { setQ(''); setSearchResults([]); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, padding: 0 }}>x</button>
          )}
          {searchLoading && (
            <div style={{ position: 'absolute', right: q ? 32 : 10, top: '50%', transform: 'translateY(-50%)', color: C.accent, fontSize: 11 }}>...</div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading trending tokens...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>
              <div>#</div><div>NAME</div>
              <button onClick={() => handleSort('current_price')} style={{ background: 'none', border: 'none', color: sort === 'current_price' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>PRICE</button>
              <button onClick={() => handleSort('price_change_percentage_24h')} style={{ background: 'none', border: 'none', color: sort === 'price_change_percentage_24h' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>24H</button>
              <button onClick={() => handleSort('market_cap')} style={{ background: 'none', border: 'none', color: sort === 'market_cap' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>MKT CAP</button>
            </div>
          )}

          {sorted.length === 0 && debouncedQ && !searchLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found for "{debouncedQ}"</div>
          )}

          {sorted.map((c, i) => renderRow(c, i, isMobile, handleRowClick))}

          {sorted.length === 0 && !q && !browseLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No trending data available</div>
          )}
        </div>
      )}
    </div>
  );
}