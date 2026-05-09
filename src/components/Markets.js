import React, { useState, useEffect, useMemo, useCallback } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const CHAIN_LABELS = {
  solana: 'SOL', ethereum: 'ETH', bsc: 'BSC', polygon: 'POL',
  arbitrum: 'ARB', optimism: 'OP', base: 'BASE', avalanche: 'AVAX',
  fantom: 'FTM', cronos: 'CRO', linea: 'LINEA', scroll: 'SCROLL',
  mantle: 'MNT', blast: 'BLAST', zksync: 'ZKS', gnosis: 'GNO',
  celo: 'CELO', moonbeam: 'GLMR', aurora: 'AURORA', metis: 'METIS',
  sei: 'SEI', ronin: 'RON', zora: 'ZORA', unichain: 'UNI', sonic: 'SONIC',
  berachain: 'BERA', ink: 'INK', worldchain: 'WORLD',
};

// Boring tokens we don't want to show as the main token
const BORING_SYMBOLS = new Set(['SOL', 'USDC', 'USDT', 'ETH', 'BTC', 'BNB', 'POL', 'AVAX', 'DAI', 'USDe', 'FRAX', 'TUSD', 'USDP', 'GUSD']);

function fmt(n, d) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '-';
  d = d != null ? d : (x >= 1000 ? 2 : x >= 1 ? 4 : 8);
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
  if (x >= 1000) return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (x >= 1) return '$' + x.toFixed(d);
  return '$' + x.toFixed(d);
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
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

function mapDexSearchPair(p) {
  if (!p || !p.chainId || !p.pairAddress) return null;

  const bt = p.baseToken || {};
  const qt = p.quoteToken || {};
  const isSol = p.chainId === 'solana';
  const baseAddr = bt.address || '';
  const baseSymbol = bt.symbol || '';
  const baseName = bt.name || baseSymbol;
  const quoteAddr = qt.address || '';
  const quoteSymbol = qt.symbol || '';
  const quoteName = qt.name || quoteSymbol;
  
  if (!baseAddr || !baseSymbol) return null;

  // Determine which token to show
  let addr, symbol, name, decimals, logoURI, imageURI;
  let price, volume, mcap, change;
  
  const priceUsd = Number(p.priceUsd || 0) || 0;
  const priceNative = Number(p.priceNative || 0) || 0;
  const vol24h = Number(p.volume?.h24 || p.volume || 0) || 0;
  const mcapBase = Number(p.marketCap || p.fdv || 0) || 0;
  const change24h = p.priceChange?.h24 != null ? Number(p.priceChange.h24) : null;

  // If base is boring and quote exists and is not boring, flip the pair
  if (BORING_SYMBOLS.has(baseSymbol) && quoteSymbol && !BORING_SYMBOLS.has(quoteSymbol)) {
    // Show quote token as the main token
    addr = quoteAddr;
    symbol = quoteSymbol;
    name = quoteName;
    decimals = qt.decimals || (isSol ? 6 : 18);
    logoURI = qt.imgUrl || p.info?.imageUrl || null;
    imageURI = qt.imgUrl || p.info?.imageUrl || null;
    
    // Calculate quote token's USD price: priceUsd / priceNative (if priceNative > 0)
    // priceNative is how many quote tokens per one base token
    if (priceNative > 0 && priceUsd > 0) {
      price = priceUsd / priceNative;
    } else {
      price = 0;
    }
    // Volume and market cap are for the base token; not directly translatable to quote token.
    // We can set them to 0 or use the pair's volume/mcap as is (which is for the pair, not token-specific).
    volume = vol24h; // This is pair volume, not perfect but okay for display
    mcap = mcapBase; // Similarly, pair-based market cap
    change = change24h; // Price change for the base token, not accurate for quote token, but okay for now
  } else {
    // Show base token as-is
    addr = baseAddr;
    symbol = baseSymbol;
    name = baseName;
    decimals = bt.decimals || (isSol ? 6 : 18);
    logoURI = bt.imgUrl || p.info?.imageUrl || null;
    imageURI = bt.imgUrl || p.info?.imageUrl || null;
    price = priceUsd;
    volume = vol24h;
    mcap = mcapBase;
    change = change24h;
  }

  if (!addr || !symbol) return null;

  return {
    id: p.chainId + '-' + addr,
    chain: isSol ? 'solana' : 'evm',
    mint: isSol ? addr : undefined,
    address: isSol ? undefined : addr,
    symbol,
    name,
    logoURI,
    image: imageURI,
    current_price: price,
    market_cap: mcap,
    total_volume: volume,
    price_change_percentage_24h: Number.isFinite(change) ? change : null,
    isSolanaToken: isSol,
    source: 'dexscreener',
    decimals,
  };
}

function isUsable(c) {
  if (!c || !c.symbol) return false;
  if (c.chain === 'solana') return !!(c.mint && c.mint.length >= 32);
  return !!(c.address && c.address.startsWith('0x'));
}

function toCanonical(c) {
  if (!isUsable(c)) return null;
  if (c.chain === 'solana') return { chain: 'solana', mint: c.mint, symbol: c.symbol, name: c.name || c.symbol, decimals: c.decimals || 6, logoURI: c.logoURI || c.image || null, current_price: c.current_price, price_change_percentage_24h: c.price_change_percentage_24h, source: 'dexscreener' };
  return { chain: 'evm', address: c.address, chainId: c.chainId, symbol: c.symbol, name: c.name || c.symbol, decimals: c.decimals || 18, logoURI: c.logoURI || c.image || null, current_price: c.current_price, price_change_percentage_24h: c.price_change_percentage_24h, source: 'dexscreener' };
}

function TokenImage({ token, size }) {
  const [broke, setBroke] = useState(false);
  const letter = String(token.symbol || '?').charAt(0).toUpperCase();
  if ((!token.image && !token.logoURI) || broke) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 800, color: C.accent, flexShrink: 0 }}>{letter}</div>;
  return <img src={token.image || token.logoURI} alt="" onError={() => setBroke(true)} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} />;
}

function ChainBadge({ token }) {
  const label = token.chain === 'solana' ? 'SOL' : (CHAIN_LABELS[token.chain] || token.chain?.toUpperCase() || 'EVM');
  return <span style={{ display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,229,255,.07)', border: '1px solid rgba(0,229,255,.18)', color: C.muted, fontSize: 9, fontWeight: 700, verticalAlign: 'middle' }}>{label}</span>;
}

function Row({ c, i, isMobile, onClick }) {
  const change = c.price_change_percentage_24h;
  const pos = (Number(change) || 0) >= 0;
  const sym = String(c.symbol || '').toUpperCase();
  const baseStyle = { padding: isMobile ? '12px 14px' : '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', transition: 'background .15s' };
  const onEnter = e => e.currentTarget.style.background = 'rgba(0,229,255,.03)';
  const onLeave = e => e.currentTarget.style.background = 'transparent';

  if (isMobile) {
    return (
      <div key={c.id} onClick={() => onClick(c)} style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 10 }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
        <TokenImage token={c} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || sym}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sym}<ChainBadge token={c} /></div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{shortAddr(c.mint || c.address)}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
          <div style={{ fontSize: 11, color: pos ? C.green : C.red, marginTop: 1, fontWeight: 600 }}>{pctFmt(change)}</div>
        </div>
      </div>
    );
  }

  return (
    <div key={c.id} onClick={() => onClick(c)} style={{ ...baseStyle, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px', gap: 8, alignItems: 'center' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <TokenImage token={c} size={32} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || sym}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{sym}<ChainBadge token={c} /><span style={{ marginLeft: 6 }}>{shortAddr(c.mint || c.address)}</span></div>
        </div>
      </div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div>
      <div style={{ fontSize: 12, color: pos ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pctFmt(change)}</div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
    </div>
  );
}

async function searchDexScreener(query) {
  try {
    const res = await fetch('/api/dexscreener/latest/dex/search?q=' + encodeURIComponent(query));
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.pairs)) return [];
    const seen = new Set();
    const tokens = [];
    for (const p of data.pairs) {
      const t = mapDexSearchPair(p);
      if (!t || !isUsable(t)) continue;
      const key = (t.mint || t.address || '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(t);
    }
    return tokens;
  } catch { return []; }
}

export default function Markets({ onSelectCoin }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const isMobile = useIsMobile();
  const [browse, setBrowse] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedQ = useDebounce(q, 350);

  // Default view: search "SOL" but show the other token in the pair
  useEffect(() => {
    let c = false;
    setBrowseLoading(true);
    searchDexScreener('SOL').then(tokens => {
      if (c) return;
      // Only keep Solana tokens for the default view
      const solTokens = tokens.filter(t => t.chain === 'solana');
      solTokens.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
      setBrowse(solTokens.slice(0, 50));
      setBrowseLoading(false);
    }).catch(() => { if (!c) { setBrowse([]); setBrowseLoading(false); } });
    return () => { c = true; };
  }, []);

  // Search
  useEffect(() => {
    const t = debouncedQ.trim();
    if (!t || t.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    let c = false;
    setSearchLoading(true);
    searchDexScreener(t).then(tokens => {
      if (c) return;
      setSearchResults(tokens);
      setSearchLoading(false);
    }).catch(() => { if (!c) { setSearchResults([]); setSearchLoading(false); } });
    return () => { c = true; };
  }, [debouncedQ]);

  const sorted = useMemo(() => {
    const list = debouncedQ.trim() ? searchResults : browse;
    return list.slice().sort((a, b) => dir * ((Number(a[sort] || 0)) - (Number(b[sort] || 0)))).slice(0, 50);
  }, [debouncedQ, searchResults, browse, sort, dir]);

  const handleSort = useCallback(k => { if (sort === k) setDir(d => -d); else { setSort(k); setDir(-1); } }, [sort]);
  const onRowClick = useCallback(row => { const c = toCanonical(row); if (c) onSelectCoin?.(c); }, [onSelectCoin]);
  const loading = browseLoading && !q;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Live Markets</h1><p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Solana trending — search any token across all chains</p></div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, symbol, or contract..." style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '10px 36px 10px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          {q && <button onClick={() => { setQ(''); setSearchResults([]); }} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, padding: 0 }}>x</button>}
          {searchLoading && <div style={{ position: 'absolute', right: q ? 32 : 10, top: '50%', transform: 'translateY(-50%)', color: C.accent, fontSize: 11 }}>...</div>}
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading Solana markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>
              <div>#</div><div>NAME</div>
              <button onClick={() => handleSort('current_price')} style={{ background: 'none', border: 'none', color: sort === 'current_price' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>PRICE</button>
              <button onClick={() => handleSort('price_change_percentage_24h')} style={{ background: 'none', border: 'none', color: sort === 'price_change_percentage_24h' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>24H</button>
              <button onClick={() => handleSort('market_cap')} style={{ background: 'none', border: 'none', color: sort === 'market_cap' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>MKT CAP</button>
            </div>
          )}
          {sorted.length === 0 && debouncedQ && !searchLoading && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No results for "{debouncedQ}"</div>}
          {sorted.map((c, i) => <Row key={c.id} c={c} i={i} isMobile={isMobile} onClick={onRowClick} />)}
          {sorted.length === 0 && !q && !browseLoading && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No Solana market data available</div>}
        </div>
      )}
    </div>
  );
}