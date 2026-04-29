import React, { useState, useEffect } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d = 2) {
  if (n == null || n === 0) return '–';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '–';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function SparkLine({ data, positive }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return x + ',' + y;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={positive ? '#00ffa3' : '#ff3b6b'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function isValidMint(str) {
  return str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
}

export default function Markets({ coins, loading, onSelectCoin, jupiterTokens }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const [isMobile] = useState(window.innerWidth < 768);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchToken, setSearchToken] = useState(null);

  const isContract = isValidMint(q.trim());

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setSearchResults([]); setSearchToken(null); return; }

    if (isValidMint(trimmed)) {
      setSearchLoading(true);
      Promise.all([
        fetch('https://lite-api.jup.ag/tokens/v1/token/' + trimmed).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + trimmed).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([jupMeta, gtRes]) => {
        const gtData = gtRes?.data?.attributes;
        const price = gtData ? parseFloat(gtData.price_usd || 0) : 0;
        const pChange = gtData?.price_change_percentage || {};
        if (jupMeta || gtData) {
          setSearchToken({
            id: trimmed, mint: trimmed,
            symbol: jupMeta?.symbol || gtData?.symbol || trimmed.slice(0, 6) + '...',
            name: jupMeta?.name || gtData?.name || 'Unknown Token',
            image: jupMeta?.logoURI || gtData?.image_url || null,
            current_price: price,
            market_cap: gtData ? parseFloat(gtData.fdv_usd || gtData.market_cap_usd || 0) : 0,
            total_volume: gtData ? parseFloat(gtData.volume_usd?.h24 || 0) : 0,
            price_change_percentage_24h: pChange.h24 ? parseFloat(pChange.h24) : null,
            price_change_percentage_1h_in_currency: pChange.h1 ? parseFloat(pChange.h1) : null,
            sparkline_in_7d: null,
            isSolanaToken: true,
          });
        }
        setSearchLoading(false);
      });
      return;
    }

    setSearchToken(null);
    const ql = trimmed.toLowerCase();

    const cgMatches = coins.filter(c =>
      (c.name && c.name.toLowerCase().includes(ql)) ||
      (c.symbol && c.symbol.toLowerCase().includes(ql))
    );

    let jupMatches = [];
    if (jupiterTokens && jupiterTokens.length) {
      const cgIds = new Set(cgMatches.map(c => (c.symbol || '').toLowerCase()));
      jupMatches = jupiterTokens.filter(t => {
        if (cgIds.has((t.symbol || '').toLowerCase())) return false;
        return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
               (t.name && t.name.toLowerCase().includes(ql));
      }).slice(0, 40).map(t => ({
        id: t.mint, mint: t.mint, symbol: t.symbol, name: t.name,
        image: t.logoURI || null,
        current_price: 0, market_cap: 0, total_volume: 0,
        price_change_percentage_24h: null, sparkline_in_7d: null,
        isSolanaToken: true,
      }));
    }

    setSearchResults([...cgMatches, ...jupMatches]);
  }, [q, coins, jupiterTokens]);

  useEffect(() => {
    if (!searchResults.length) return;
    const mints = searchResults
      .filter(c => c.isSolanaToken && c.current_price === 0)
      .map(c => c.id)
      .slice(0, 30);
    if (!mints.length) return;
    fetch('https://api.jup.ag/price/v2?ids=' + mints.join(','))
      .then(r => r.json())
      .then(data => {
        if (!data.data) return;
        setSearchResults(prev => prev.map(c => {
          const p = data.data[c.id];
          if (!p || !p.price) return c;
          return { ...c, current_price: parseFloat(p.price) };
        }));
      })
      .catch(() => {});
  }, [searchResults.length]);

  const handleSort = key => {
    if (sort === key) setDir(d => -d);
    else { setSort(key); setDir(-1); }
  };

  const displayCoins = q.trim() ? (searchToken ? [searchToken] : searchResults) : coins;
  const sorted = [...displayCoins].sort((a, b) => dir * ((a[sort] || 0) - (b[sort] || 0)));

  const SortBtn = ({ sortKey, label }) => (
    <button
      onClick={() => handleSort(sortKey)}
      style={{ background: 'none', border: 'none', color: sort === sortKey ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}
    >{label} {sort === sortKey ? (dir === -1 ? 'v' : '^') : ''}</button>
  );

  const renderRow = (c, i) => {
    const positive = (c.price_change_percentage_24h || 0) >= 0;
    const sparkData = c.sparkline_in_7d
      ? c.sparkline_in_7d.price.filter((_, i) => i % 8 === 0)
      : [];

    if (isMobile) {
      return (
        <div
          key={c.id}
          onClick={() => onSelectCoin && onSelectCoin(c)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ color: C.muted, fontSize: 11, width: 20, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
          {c.image
            ? <img src={c.image} alt={c.symbol} style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
            : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{c.symbol?.charAt(0).toUpperCase()}</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.symbol?.toUpperCase()}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
            <div style={{ fontSize: 12, color: positive ? C.green : C.red, marginTop: 2, fontWeight: 600 }}>{pct(c.price_change_percentage_24h)}</div>
          </div>
          <SparkLine data={sparkData} positive={positive} />
        </div>
      );
    }

    return (
      <div
        key={c.id}
        onClick={() => onSelectCoin && onSelectCoin(c)}
        style={{ display: 'grid', gridTemplateColumns: '32px 1fr 110px 80px 110px 90px', gap: 8, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {c.image
            ? <img src={c.image} alt={c.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
            : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{c.symbol?.charAt(0).toUpperCase()}</div>
          }
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{c.symbol?.toUpperCase()}</div>
          </div>
        </div>
        <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, textAlign: 'right' }}>{fmt(c.current_price)}</div>
        <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pct(c.price_change_percentage_24h)}</div>
        <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><SparkLine data={sparkData} positive={positive} /></div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Search any token or paste a contract address</p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: 280 }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, symbol or paste address…"
            style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '9px 36px 9px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%' }}
          />
          {q && (
            <button
              onClick={() => { setQ(''); setSearchResults([]); setSearchToken(null); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
            >x</button>
          )}
          {searchLoading && (
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.accent, fontSize: 11 }}>…</div>
          )}
        </div>
      </div>

      {isContract && !searchToken && !searchLoading && q.trim() && (
        <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.12)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: C.muted }}>
          Looking up contract address...
        </div>
      )}

      {loading && !q ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 110px 80px 110px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>#</div>
              <div>NAME</div>
              <SortBtn sortKey="current_price" label="PRICE" />
              <SortBtn sortKey="price_change_percentage_24h" label="24H" />
              <SortBtn sortKey="market_cap" label="MKT CAP" />
              <div style={{ textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>7D</div>
            </div>
          )}

          {sorted.length === 0 && q && !searchLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found for "{q}"
              {isContract && <div style={{ marginTop: 8, fontSize: 12 }}>Token may be too new or not indexed yet</div>}
            </div>
          )}

          {sorted.map((c, i) => renderRow(c, i))}

          {sorted.length === 0 && !q && !loading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No market data available</div>
          )}
        </div>
      )}
    </div>
  );
}
