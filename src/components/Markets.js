import React, { useState, useEffect, useMemo, useCallback } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

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

function useDebounce(value, delay) {
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return m;
}

function TokenImage({ token, size }) {
  const [broke, setBroke] = useState(false);
  const letter = String(token.symbol || '?').charAt(0).toUpperCase();
  if ((!token.logoURI && !token.image) || broke) {
    return (<div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 800, color: C.accent, flexShrink: 0 }}>{letter}</div>);
  }
  return (<img src={token.logoURI || token.image} alt="" onError={() => setBroke(true)} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} />);
}

function Row({ c, i, isMobile, onClick }) {
  const sym = String(c.symbol || '').toUpperCase();
  const name = String(c.name || sym);
  const displayName = name.length > 22 ? name.slice(0, 21) + '\u2026' : name;
  const baseStyle = { padding: isMobile ? '12px 14px' : '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', transition: 'background .15s' };
  if (isMobile) {
    return (<div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div><TokenImage token={c} size={34} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div><div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sym}</div></div><div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div></div></div>);
  }
  return (<div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 120px', gap: 8, alignItems: 'center' }}><div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><TokenImage token={c} size={32} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div><div style={{ fontSize: 10, color: C.muted }}>{sym}</div></div></div><div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div></div>);
}

// Batch fetch all prices via OKX price-info (POST)
async function fetchBatchPrices(mints) {
  if (!mints || mints.length === 0) return {};
  try {
    const r = await fetch('/api/okx/dex/market/price-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chainIndex: '501', 
        tokenContractAddressList: mints 
      }),
    });
    const j = await r.json();
    console.log('price-info response:', JSON.stringify(j));
    if (j.code === '0' && j.data) {
      const priceMap = {};
      const data = Array.isArray(j.data) ? j.data : [j.data];
      data.forEach(d => {
        const addr = (d.tokenAddress || d.tokenContractAddress || d.instId || '').toLowerCase();
        const price = Number(d.price || d.last || d.usdPrice || 0);
        if (addr && price > 0) priceMap[addr] = price;
      });
      return priceMap;
    } else {
      console.log('price-info failed:', j.msg || j.error_message || 'unknown error');
    }
  } catch(e) {
    console.log('price-info error:', e.message);
  }
  return {};
}

export default function Markets({ onSelectCoin, coins }) {
  const [q, setQ] = useState('');
  const [allTokens, setAllTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pricesLoading, setPricesLoading] = useState(false);
  const isMobile = useIsMobile();
  const debouncedQ = useDebounce(q, 300);

  const solPriceUsd = useMemo(() => {
    if (!coins || !Array.isArray(coins)) return 0;
    const sol = coins.find(c => c && (c.id === 'solana' || c.symbol === 'SOL'));
    return sol && Number(sol.current_price) > 0 ? Number(sol.current_price) : 0;
  }, [coins]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // 1. Get token list
        const r = await fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501');
        const j = await r.json();
        if (cancelled) return;
        const raw = (j.data || []).slice(0, 20).map(t => ({
          id: t.tokenContractAddress, chain: 'solana', mint: t.tokenContractAddress,
          symbol: t.tokenSymbol || '?', name: t.tokenName || t.tokenSymbol || 'Unknown',
          decimals: parseInt(t.decimals) || 6, logoURI: t.tokenLogoUrl || null, image: t.tokenLogoUrl || null,
          current_price: 0,
        }));
        raw.sort((a, b) => { if (a.symbol === 'SOL') return -1; if (b.symbol === 'SOL') return 1; if (a.symbol === 'USDC') return -1; if (b.symbol === 'USDC') return 1; if (a.symbol === 'USDT') return -1; if (b.symbol === 'USDT') return 1; return 0; });
        if (!cancelled) { setAllTokens(raw); setLoading(false); }

        // 2. Batch fetch all prices at once (POST)
        setPricesLoading(true);
        const mints = raw.map(t => t.mint);
        const priceMap = await fetchBatchPrices(mints);
        if (!cancelled) {
          setAllTokens(prev => prev.map(t => ({
            ...t,
            current_price: priceMap[t.mint.toLowerCase()] || t.current_price,
          })));
          setPricesLoading(false);
        }
      } catch { if (!cancelled) { setAllTokens([]); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, []);

  const tokens = useMemo(() => {
    if (!q.trim()) return allTokens;
    const lower = q.toLowerCase();
    return allTokens.filter(t => t.symbol.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower) || t.mint.toLowerCase().includes(lower)).slice(0, 30);
  }, [allTokens, q]);

  const handleClick = useCallback((row) => {
    onSelectCoin?.({ chain: 'solana', mint: row.mint, symbol: row.symbol, name: row.name || row.symbol, decimals: row.decimals || 6, logoURI: row.logoURI || row.image || null, current_price: row.current_price, solPriceUsd: row.symbol === 'SOL' ? row.current_price : solPriceUsd });
  }, [onSelectCoin, solPriceUsd]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div><h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Live Markets</h1><p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Solana tokens via OKX{pricesLoading ? ' · loading prices...' : ''}</p></div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tokens..." style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '10px 36px 10px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          {q && <button onClick={() => setQ('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>}
        </div>
      </div>
      {loading ? (<div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading tokens...</div>) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (<div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 120px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}><div>#</div><div>NAME</div><div style={{ textAlign: 'right' }}>PRICE</div></div>)}
          {tokens.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found</div>}
          {tokens.map((c, i) => (<Row key={c.id} c={c} i={i} isMobile={isMobile} onClick={handleClick} />))}
        </div>
      )}
    </div>
  );
}