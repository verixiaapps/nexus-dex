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

function pctFmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
}

function useDebounce(value, delay) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
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

function TokenImage({ token, size }) {
  const [broke, setBroke] = useState(false);
  const letter = String(token.symbol || '?').charAt(0).toUpperCase();
  if ((!token.image && !token.logoURI) || broke) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.4), fontWeight: 800, color: C.accent, flexShrink: 0,
      }}>
        {letter}
      </div>
    );
  }
  return (
    <img
      src={token.image || token.logoURI}
      alt=""
      onError={() => setBroke(true)}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }}
    />
  );
}

function Row({ c, i, isMobile, onClick }) {
  const change = c.price_change_percentage_24h;
  const pos = (Number(change) || 0) >= 0;
  const sym = String(c.symbol || '').toUpperCase();
  const baseStyle = {
    padding: isMobile ? '12px 14px' : '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,.025)',
    cursor: 'pointer', transition: 'background .15s',
  };

  if (isMobile) {
    return (
      <div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
        <TokenImage token={c} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || sym}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sym}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
          <div style={{ fontSize: 11, color: pos ? C.green : C.red, marginTop: 1, fontWeight: 600 }}>{pctFmt(change)}</div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={() => onClick(c)} style={{ ...baseStyle, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px', gap: 8, alignItems: 'center' }}>
      <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <TokenImage token={c} size={32} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || sym}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{sym}</div>
        </div>
      </div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div>
      <div style={{ fontSize: 12, color: pos ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pctFmt(change)}</div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
    </div>
  );
}

function parsePairs(pairs) {
  const seen = {};
  const list = [];
  (pairs || []).forEach((p) => {
    if (p.chainId !== 'solana') return;
    const addr = p.baseToken?.address;
    if (addr && !seen[addr]) {
      seen[addr] = true;
      list.push({
        id: addr,
        chain: 'solana',
        mint: addr,
        symbol: p.baseToken.symbol,
        name: p.baseToken.name || p.baseToken.symbol,
        decimals: p.baseToken.decimals || 6,
        logoURI: p.info?.imageUrl || null,
        image: p.info?.imageUrl || null,
        current_price: Number(p.priceUsd || 0) || 0,
        market_cap: Number(p.marketCap || p.fdv || 0) || 0,
        total_volume: Number(p.volume?.h24 || 0) || 0,
        price_change_percentage_24h: p.priceChange?.h24 != null ? Number(p.priceChange.h24) : null,
      });
    }
  });
  return list;
}

export default function Markets({ onSelectCoin }) {
  const [q, setQ] = useState('');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const debouncedQ = useDebounce(q, 300);

  const TOP_MINTS = [
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6BFrR4Jfrj6z7m9',
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
  ];

  // Fetch tokens
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const url = debouncedQ.trim()
      ? `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(debouncedQ)}`
      : `https://api.dexscreener.com/latest/dex/tokens/${TOP_MINTS.join(',')}`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        let list = parsePairs(data.pairs);

        if (!debouncedQ.trim()) {
          const seenSym = {};
          const deduped = [];
          list.forEach((t) => {
            const sym = t.symbol.toUpperCase();
            if (!seenSym[sym] || t.total_volume > seenSym[sym].total_volume) {
              seenSym[sym] = t;
            }
          });
          list = Object.values(seenSym);
          list.sort((a, b) => b.market_cap - a.market_cap);
        } else {
          list.sort((a, b) => b.total_volume - a.total_volume);
        }

        setTokens(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTokens([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [debouncedQ]);

  const handleClick = useCallback(
    (row) => {
      onSelectCoin?.({
        chain: 'solana',
        mint: row.mint,
        symbol: row.symbol,
        name: row.name || row.symbol,
        decimals: row.decimals || 6,
        logoURI: row.logoURI || row.image || null,
        current_price: row.current_price,
        price_change_percentage_24h: row.price_change_percentage_24h,
      });
    },
    [onSelectCoin]
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Top Solana tokens with live prices</p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tokens..."
            style={{
              background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border),
              borderRadius: 10, padding: '10px 36px 10px 14px',
              color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13,
              outline: 'none', width: '100%', boxSizing: 'border-box',
            }}
          />
          {q && (
            <button onClick={() => setQ('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, padding: 0 }}>
              ×
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading tokens...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>
              <div>#</div>
              <div>NAME</div>
              <div style={{ textAlign: 'right' }}>PRICE</div>
              <div style={{ textAlign: 'right' }}>24H</div>
              <div style={{ textAlign: 'right' }}>MKT CAP</div>
            </div>
          )}
          {tokens.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found</div>
          )}
          {tokens.map((c, i) => (
            <Row key={c.id} c={c} i={i} isMobile={isMobile} onClick={handleClick} />
          ))}
        </div>
      )}
    </div>
  );
}