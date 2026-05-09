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
};

const DEFAULT_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6BFrR4Jfrj6z7m9', symbol: 'BONK', name: 'Bonk', decimals: 5 },
];

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
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(0,229,255,.1)',
          border: '1px solid rgba(0,229,255,.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.round(size * 0.4),
          fontWeight: 800,
          color: C.accent,
          flexShrink: 0,
        }}
      >
        {letter}
      </div>
    );
  }
  return (
    <img
      src={token.image || token.logoURI}
      alt=""
      onError={() => setBroke(true)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'rgba(0,229,255,.08)',
      }}
    />
  );
}

function ChainBadge({ token }) {
  const label =
    token.chain === 'solana'
      ? 'SOL'
      : CHAIN_LABELS[token.chain] || token.chain?.toUpperCase() || 'EVM';
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 6,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'rgba(0,229,255,.07)',
        border: '1px solid rgba(0,229,255,.18)',
        color: C.muted,
        fontSize: 9,
        fontWeight: 700,
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
}

function Row({ c, i, isMobile, onClick }) {
  const change = c.price_change_percentage_24h;
  const pos = (Number(change) || 0) >= 0;
  const sym = String(c.symbol || '').toUpperCase();
  const baseStyle = {
    padding: isMobile ? '12px 14px' : '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,.025)',
    cursor: 'pointer',
    transition: 'background .15s',
  };
  const onEnter = (e) => (e.currentTarget.style.background = 'rgba(0,229,255,.03)');
  const onLeave = (e) => (e.currentTarget.style.background = 'transparent');

  if (isMobile) {
    return (
      <div
        key={c.id}
        onClick={() => onClick(c)}
        style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 10 }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>
          {i + 1}
        </div>
        <TokenImage token={c} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: '#fff',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.name || sym}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {sym}
            <ChainBadge token={c} />
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
            {fmt(c.current_price)}
          </div>
          <div
            style={{
              fontSize: 11,
              color: pos ? C.green : C.red,
              marginTop: 1,
              fontWeight: 600,
            }}
          >
            {pctFmt(change)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      key={c.id}
      onClick={() => onClick(c)}
      style={{
        ...baseStyle,
        display: 'grid',
        gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px',
        gap: 8,
        alignItems: 'center',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <TokenImage token={c} size={32} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: '#fff',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.name || sym}
          </div>
          <div style={{ fontSize: 10, color: C.muted }}>
            {sym}
            <ChainBadge token={c} />
          </div>
        </div>
      </div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>
        {fmt(c.current_price)}
      </div>
      <div
        style={{
          fontSize: 12,
          color: pos ? C.green : C.red,
          textAlign: 'right',
          fontWeight: 600,
        }}
      >
        {pctFmt(change)}
      </div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>
        {fmt(c.market_cap)}
      </div>
    </div>
  );
}

function toCanonical(c) {
  if (!c) return null;
  return {
    chain: 'solana',
    mint: c.mint,
    symbol: c.symbol,
    name: c.name || c.symbol,
    decimals: c.decimals || 6,
    logoURI: c.logoURI || c.image || null,
    current_price: c.current_price,
    price_change_percentage_24h: c.price_change_percentage_24h,
  };
}

export default function Markets({ onSelectCoin }) {
  const [q, setQ] = useState('');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const mints = DEFAULT_TOKENS.map((t) => t.mint);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const pairs = data.pairs || [];
        const priceMap = {};
        pairs.forEach((p) => {
          if (p.baseToken?.address) {
            priceMap[p.baseToken.address] = {
              price: Number(p.priceUsd || 0) || 0,
              change: p.priceChange?.h24 != null ? Number(p.priceChange.h24) : null,
              volume: Number(p.volume?.h24 || 0) || 0,
              mcap: Number(p.marketCap || p.fdv || 0) || 0,
              logoURI: p.info?.imageUrl || null,
            };
          }
        });

        const enriched = DEFAULT_TOKENS.map((dt) => {
          const p = priceMap[dt.mint] || {};
          return {
            id: 'solana-' + dt.mint,
            chain: 'solana',
            mint: dt.mint,
            symbol: dt.symbol,
            name: dt.name,
            decimals: dt.decimals,
            logoURI: p.logoURI || null,
            image: p.logoURI || null,
            current_price: p.price || 0,
            market_cap: p.mcap || 0,
            total_volume: p.volume || 0,
            price_change_percentage_24h: Number.isFinite(p.change) ? p.change : null,
          };
        });

        setTokens(enriched);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTokens([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return tokens;
    const lower = q.toLowerCase();
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(lower) ||
        t.name.toLowerCase().includes(lower) ||
        t.mint.toLowerCase().includes(lower)
    );
  }, [tokens, q]);

  const handleClick = useCallback(
    (row) => {
      const c = toCanonical(row);
      if (c) onSelectCoin?.(c);
    },
    [onSelectCoin]
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>
            Live Markets
          </h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            Top Solana tokens with live prices
          </p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tokens..."
            style={{
              background: C.card,
              border: '1px solid ' + (q ? C.borderHi : C.border),
              borderRadius: 10,
              padding: '10px 36px 10px 14px',
              color: '#fff',
              fontFamily: 'Syne, sans-serif',
              fontSize: 13,
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: C.muted,
                cursor: 'pointer',
                fontSize: 18,
                padding: 0,
              }}
            >
              x
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
          Loading tokens...
        </div>
      ) : (
        <div
          style={{
            background: C.card,
            border: '1px solid ' + C.border,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {!isMobile && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px',
                gap: 8,
                padding: '10px 16px',
                borderBottom: '1px solid rgba(0,229,255,.06)',
                fontSize: 10,
                color: C.muted,
                fontWeight: 700,
                letterSpacing: 0.8,
              }}
            >
              <div>#</div>
              <div>NAME</div>
              <div style={{ textAlign: 'right' }}>PRICE</div>
              <div style={{ textAlign: 'right' }}>24H</div>
              <div style={{ textAlign: 'right' }}>MKT CAP</div>
            </div>
          )}

          {filtered.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found
            </div>
          )}

          {filtered.map((c, i) => (
            <Row key={c.id} c={c} i={i} isMobile={isMobile} onClick={handleClick} />
          ))}
        </div>
      )}
    </div>
  );
}