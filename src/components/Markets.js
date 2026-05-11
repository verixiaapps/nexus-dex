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

function fmtMc(n) {
  if (!n) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function pctFmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - Number(ts)) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  return Math.floor(d / 3600) + 'h';
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
  if ((!token.logoURI && !token.logoUrl) || broke) {
    return (<div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 800, color: C.accent, flexShrink: 0 }}>{letter}</div>);
  }
  return (<img src={token.logoURI || token.logoUrl} alt="" onError={() => setBroke(true)} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} />);
}

function Row({ c, i, isMobile, onClick }) {
  const sym = String(c.symbol || '').toUpperCase();
  const name = String(c.name || sym);
  const displayName = name.length > 22 ? name.slice(0, 21) + '\u2026' : name;
  const mc = c.marketCap || 0;
  const volume = c.volume1h || 0;
  const bonding = c.bondingPercent != null ? Number(c.bondingPercent) : null;
  const buys = c.buys1h || 0;
  const sells = c.sells1h || 0;
  const age = timeAgo(c.createdTimestamp);

  const baseStyle = { padding: isMobile ? '12px 14px' : '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', transition: 'background .15s' };

  if (isMobile) {
    return (
      <div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
        <TokenImage token={c} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span>{sym}</span>
            {bonding !== null && <span style={{ color: bonding > 0 ? C.green : C.red }}>{bonding > 0 ? '+' : ''}{bonding.toFixed(1)}%</span>}
            <span>{age}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmtMc(mc)}</div>
          {volume > 0 && <div style={{ fontSize: 10, color: C.muted }}>Vol {fmtMc(volume)}</div>}
        </div>
      </div>
    );
  }

  return (
    <div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 120px 100px 80px', gap: 8, alignItems: 'center' }}>
      <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <TokenImage token={c} size={32} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 10, color: C.muted, display: 'flex', gap: 6 }}>
            <span>{sym}</span>
            {bonding !== null && <span style={{ color: bonding > 0 ? C.green : C.red }}>{bonding > 0 ? '+' : ''}{bonding.toFixed(1)}%</span>}
            <span>{age}</span>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 600, color: '#fff', fontSize: 12 }}>{fmtMc(mc)}</div>
        {volume > 0 && <div style={{ fontSize: 10, color: C.muted }}>{fmtMc(volume)}</div>}
      </div>
      <div style={{ textAlign: 'right', fontSize: 11, color: C.muted }}>
        <div>{buys}B / {sells}S</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {bonding !== null && (
          <div style={{ fontSize: 12, fontWeight: 600, color: bonding > 0 ? C.green : C.red }}>
            {bonding > 0 ? '+' : ''}{bonding.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}

export default function Markets({ onSelectCoin }) {
  const [q, setQ] = useState('');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch('/api/okx/dex/market/memepump/tokenList?chainIndex=501&stage=MIGRATED&limit=50');
        const j = await r.json();
        if (cancelled) return;
        if (j.code === '0' && Array.isArray(j.data)) {
          const mapped = j.data
            .map(t => ({
              id: t.tokenAddress,
              chain: 'solana',
              mint: t.tokenAddress,
              symbol: t.symbol || '???',
              name: t.name || t.symbol || 'Unknown',
              decimals: 6,
              logoUrl: t.logoUrl || null,
              logoURI: t.logoUrl || null,
              image: t.logoUrl || null,
              current_price: 0,
              marketCap: Number(t.market?.marketCapUsd || t.marketCapUsd || 0),
              volume1h: Number(t.market?.volumeUsd1h || t.volumeUsd1h || 0),
              buys1h: Number(t.market?.buyTxCount1h || t.buyTxCount1h || 0),
              sells1h: Number(t.market?.sellTxCount1h || t.sellTxCount1h || 0),
              bondingPercent: Number(t.bondingPercent || 0),
              holders: Number(t.tags?.totalHolders || 0),
              createdTimestamp: Number(t.createdTimestamp || 0),
              social: t.social || {},
            }))
            .filter(t => t.marketCap >= 10000)
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
          setTokens(mapped);
        } else {
          setError(j.msg || 'Failed to load');
        }
        setLoading(false);
      } catch {
        if (!cancelled) { setError('Network error'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return tokens;
    const lower = q.toLowerCase();
    return tokens.filter(t => t.symbol.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower) || t.mint.toLowerCase().includes(lower)).slice(0, 30);
  }, [tokens, q]);

  const handleClick = useCallback((row) => {
    onSelectCoin?.({
      chain: 'solana',
      mint: row.mint,
      symbol: row.symbol,
      name: row.name || row.symbol,
      decimals: row.decimals || 6,
      logoURI: row.logoURI || row.image || null,
      current_price: row.current_price,
      marketCap: row.marketCap,
      volume1h: row.volume1h,
      buys1h: row.buys1h,
      sells1h: row.sells1h,
      bondingPercent: row.bondingPercent,
      holders: row.holders,
      createdTimestamp: row.createdTimestamp,
    });
  }, [onSelectCoin]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Graduated</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Migrated pump tokens ≥ $10K · {tokens.length} tokens</p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tokens..." style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '10px 36px 10px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          {q && <button onClick={() => setQ('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, padding: 0 }}>×</button>}
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading graduated tokens...</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.red, fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 120px 100px 80px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>
              <div>#</div><div>NAME</div><div style={{ textAlign: 'right' }}>MC / VOL</div><div style={{ textAlign: 'right' }}>BUYS/SELLS</div><div style={{ textAlign: 'right' }}>BONDING</div>
            </div>
          )}
          {filtered.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found</div>}
          {filtered.map((c, i) => (<Row key={c.id} c={c} i={i} isMobile={isMobile} onClick={handleClick} />))}
        </div>
      )}
    </div>
  );
}