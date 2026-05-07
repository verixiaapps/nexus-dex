import React, { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * NEXUS DEX -- Markets
 *
 * Data source rule (locked):
 *   - Jupiter v2  -> Solana tokens (verified + unverified, includes memecoins)
 *   - LiFi v1     -> EVM tokens across every chain LiFi supports
 *   - 0x          -> swap quotes on EVM (not used here -- this is browse/search)
 *
 * Coverage: every token and every chain that Jupiter, 0x, or LiFi supports.
 *
 * Endpoints (all routed through the server proxy so API keys stay server-side):
 *
 *   Solana browse (parent passes via `coins`):
 *     /api/jupiter/tokens/v2/toporganicscore/24h
 *     /api/jupiter/tokens/v2/tag?query=verified  (parent passes via `jupiterTokens`)
 *
 *   Solana search:
 *     /api/jupiter/tokens/v2/search?query=<text|mint>
 *       returns BOTH verified AND unverified, with full price/mcap data
 *
 *   EVM browse + search:
 *     /api/lifi/v1/tokens
 *       returns tokens across every chain LiFi indexes (EVM, Solana, and
 *       loaded once and cached at module scope
 *
 * No DexScreener. No GeckoTerminal. No CoinGecko. No Moralis.
 *
 * Props from App.js:
 *   coins         pre-fetched Jupiter top-organic-score Solana tokens
 *                 (already mapped to coin shape by App.js)
 *   loading       coins still loading
 *   onSelectCoin  (coin) => navigate to TokenDetail
 *   jupiterTokens optional verified-tag list, used as cheap client-side
 *                 prefilter while server search runs
 */

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

/* ============================================================================
 * Formatters
 * ========================================================================= */
function fmt(n, d = 2) {
  if (n == null || n === 0) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}
function pctFmt(n) {
  if (n == null || isNaN(n)) return '-';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

/* ============================================================================
 * Validators
 * ========================================================================= */
function isValidMint(s) {
  return s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function isValidEvmAddress(s) {
  return s && /^0x[0-9a-fA-F]{40}$/.test(s);
}

/* ============================================================================
 * Sparkline (only used if a token's stats include 7d data)
 * ========================================================================= */
function SparkLine({ data, positive }) {
  if (!data || data.length < 2) return null;
  const min = Math.min.apply(null, data);
  const max = Math.max.apply(null, data);
  const range = max - min || 1;
  const w = 64, h = 28;
  const pts = data.map(function (v, i) {
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

/* ============================================================================
 * Debounce
 * ========================================================================= */
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(function () {
    const t = setTimeout(function () { setDebounced(value); }, delay);
    return function () { clearTimeout(t); };
  }, [value, delay]);
  return debounced;
}

/* ============================================================================
 * Map a Jupiter v2 token to row shape.
 *
 * Jupiter v2 fields used:
 *   id           mint address
 *   name, symbol, decimals
 *   icon         logo URL
 *   usdPrice     current USD price
 *   mcap, fdv    market cap
 *   stats24h     { priceChange, buyVolume, sellVolume, ... }
 * ========================================================================= */
function mapJupiter(t) {
  if (!t || !t.id) return null;
  const stats = t.stats24h || {};
  const buyVol = Number(stats.buyVolume) || 0;
  const sellVol = Number(stats.sellVolume) || 0;
  return {
    id: t.id,
    mint: t.id,
    symbol: t.symbol || '',
    name: t.name || t.symbol || '',
    image: t.icon || t.logoURI || null,
    decimals: t.decimals != null ? t.decimals : 6,
    current_price: t.usdPrice != null ? Number(t.usdPrice) : 0,
    market_cap: t.mcap != null ? Number(t.mcap) : (t.fdv != null ? Number(t.fdv) : 0),
    total_volume: buyVol + sellVol,
    price_change_percentage_24h: stats.priceChange != null ? Number(stats.priceChange) : null,
    sparkline_in_7d: null,
    isSolanaToken: true,
    chain: 'solana',
  };
}

/* ============================================================================
 * Map a LiFi token to row shape.
 *
 * LiFi /v1/tokens returns:
 *   { tokens: { '<chainId>': [ { address, chainId, symbol, name, decimals,
 *                                logoURI, priceUSD } ] } }
 * ========================================================================= */
function mapLifi(t) {
  if (!t || !t.address) return null;
  const isSolana = !t.address.startsWith('0x');
  return {
    id: t.address + '-' + t.chainId,
    address: t.address,
    mint: isSolana ? t.address : undefined,
    chainId: t.chainId,
    symbol: t.symbol || '',
    name: t.name || t.symbol || '',
    image: t.logoURI || null,
    decimals: t.decimals != null ? t.decimals : 18,
    current_price: t.priceUSD ? parseFloat(t.priceUSD) : 0,
    market_cap: 0,
    total_volume: 0,
    price_change_percentage_24h: null,
    sparkline_in_7d: null,
    isSolanaToken: isSolana,
    chain: isSolana ? 'solana' : 'evm',
  };
}

/* ============================================================================
 * Lazy LiFi token cache. Fetched once for the session. Covers every
 * chain LiFi indexes (EVM, Solana, and others).
 * ========================================================================= */
let _evmCache = null;
let _evmLoading = false;
let _evmCallbacks = [];

function getEvmTokenCache() {
  return new Promise(function (resolve) {
    if (_evmCache) { resolve(_evmCache); return; }
    _evmCallbacks.push(resolve);
    if (_evmLoading) return;
    _evmLoading = true;
    fetch('/api/lifi/v1/tokens')
      .then(function (r) { return r.ok ? r.json() : { tokens: {} }; })
      .catch(function () { return { tokens: {} }; })
      .then(function (data) {
        const all = [];
        if (data && data.tokens) {
          Object.values(data.tokens).forEach(function (chainTokens) {
            if (Array.isArray(chainTokens)) {
              chainTokens.forEach(function (t) {
                const m = mapLifi(t);
                if (m && m.symbol) all.push(m);
              });
            }
          });
        }
        _evmCache = all;
        _evmCallbacks.forEach(function (cb) { cb(all); });
        _evmCallbacks = [];
        _evmLoading = false;
      });
  });
}

/* ============================================================================
 * Row renderer (outside component for stable identity across renders)
 * ========================================================================= */
function renderRow(c, i, isMobile, onSelectCoin) {
  const change = c.price_change_percentage_24h;
  const positive = (change || 0) >= 0;
  const sparkData = c.sparkline_in_7d
    ? c.sparkline_in_7d.price.filter(function (_, idx) { return idx % 8 === 0; })
    : [];

  function handleClick() { onSelectCoin && onSelectCoin(c); }
  function handleEnter(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }
  function handleLeave(e) { e.currentTarget.style.background = 'transparent'; }

  const fallbackLetter = (c.symbol || '?').charAt(0).toUpperCase();

  if (isMobile) {
    return (
      <div key={c.id} onClick={handleClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
        {c.image
          ? <img src={c.image} alt={c.symbol} style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} onError={function (e) { e.target.style.display = 'none'; }} />
          : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{fallbackLetter}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{(c.symbol || '').toUpperCase()}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
          <div style={{ fontSize: 11, color: positive ? C.green : C.red, marginTop: 1, fontWeight: 600 }}>{pctFmt(change)}</div>
        </div>
        <SparkLine data={sparkData} positive={positive} />
      </div>
    );
  }

  return (
    <div key={c.id} onClick={handleClick} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 100px 72px 100px 72px', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', alignItems: 'center' }} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {c.image
          ? <img src={c.image} alt={c.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} onError={function (e) { e.target.style.display = 'none'; }} />
          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{fallbackLetter}</div>
        }
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{(c.symbol || '').toUpperCase()}</div>
        </div>
      </div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div>
      <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pctFmt(change)}</div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><SparkLine data={sparkData} positive={positive} /></div>
    </div>
  );
}

Chunk 2 of 2 (lines 231–end):

/* ============================================================================
 * Main component
 * ========================================================================= */
export default function Markets({ coins, loading, onSelectCoin, jupiterTokens }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const debouncedQ = useDebounce(q, 350);

  useEffect(function () {
    function handler() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener('resize', handler);
    return function () { window.removeEventListener('resize', handler); };
  }, []);

  const isContractQuery = useMemo(function () {
    return isValidMint(debouncedQ.trim()) || isValidEvmAddress(debouncedQ.trim());
  }, [debouncedQ]);

  /* ---------------------------------------------------------------------
   * SEARCH EFFECT
   *
   * Branches:
   *   1. EVM contract address  -> LiFi cache, filter by address
   *   2. Solana mint           -> Jupiter /tokens/v2/search?query=<mint>
   *   3. Free text             -> Jupiter v2 search (Solana, includes
   *                              unverified) AND LiFi cache match (EVM
   *                              across every chain)
   * --------------------------------------------------------------------- */
  useEffect(function () {
    const trimmed = debouncedQ.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let aborted = false;

    /* --- EVM contract address --- */
    if (isValidEvmAddress(trimmed)) {
      setSearchResults([]);
      setSearchLoading(true);
      getEvmTokenCache().then(function (evmTokens) {
        if (aborted) return;
        const found = evmTokens.filter(function (t) {
          return t.address && t.address.toLowerCase() === trimmed.toLowerCase();
        });
        setSearchResults(found.length ? found : [{
          id: trimmed + '-evm',
          address: trimmed,
          chainId: 1,
          symbol: trimmed.slice(0, 6) + '...',
          name: 'Unknown EVM Token',
          image: null,
          chain: 'evm',
          decimals: 18,
          current_price: 0,
          market_cap: 0,
          total_volume: 0,
          price_change_percentage_24h: null,
        }]);
        setSearchLoading(false);
      });
      return function () { aborted = true; };
    }

    /* --- Solana mint OR free text -> hit Jupiter v2 search.
     * Returns verified + unverified tokens with full price/mcap data.
     * In parallel, match against LiFi cache (if loaded) for EVM tokens. */
    setSearchLoading(true);
    const url = '/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(trimmed);

    Promise.all([
      fetch(url).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      _evmCache ? Promise.resolve(_evmCache) : getEvmTokenCache(),
    ]).then(function (results) {
      if (aborted) return;
      const jupArr = Array.isArray(results[0]) ? results[0] : [];
      const evmArr = results[1] || [];

      const ql = trimmed.toLowerCase();
      const seen = new Set();
      const out = [];

      jupArr.forEach(function (t) {
        const m = mapJupiter(t);
        if (!m) return;
        const key = 'sol-' + m.mint;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(m);
      });

      evmArr.forEach(function (t) {
        if (!t || !t.symbol) return;
        const sym = t.symbol.toLowerCase();
        const nm = (t.name || '').toLowerCase();
        if (!sym.includes(ql) && !nm.includes(ql)) return;
        const key = 'evm-' + t.address + '-' + t.chainId;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(t);
      });

      setSearchResults(out);
      setSearchLoading(false);
    }).catch(function () {
      if (aborted) return;
      setSearchResults([]);
      setSearchLoading(false);
    });

    return function () { aborted = true; };
  }, [debouncedQ]);

  const handleSort = useCallback(function (key) {
    if (sort === key) setDir(function (d) { return -d; });
    else { setSort(key); setDir(-1); }
  }, [sort]);

  /* Sorted list. For initial view (no query), show top 20 popular tokens
   * passed in via `coins` prop (Jupiter top organic score from App.js). */
  const sorted = useMemo(function () {
    const base = debouncedQ.trim()
      ? searchResults
      : (coins || []).slice(0, 20);
    return base.slice().sort(function (a, b) {
      return dir * ((a[sort] || 0) - (b[sort] || 0));
    });
  }, [debouncedQ, searchResults, coins, sort, dir]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Solana, EVM, or paste a contract address</p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 300 }}>
          <input
            value={q}
            onChange={function (e) { setQ(e.target.value); }}
            placeholder="Name, symbol, or contract..."
            style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '10px 36px 10px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%' }}
          />
          {q && (
            <button
              onClick={function () { setQ(''); setSearchResults([]); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
            >x</button>
          )}
          {searchLoading && (
            <div style={{ position: 'absolute', right: q ? 32 : 10, top: '50%', transform: 'translateY(-50%)', color: C.accent, fontSize: 11 }}>...</div>
          )}
        </div>
      </div>

      {isContractQuery && searchResults.length === 0 && !searchLoading && debouncedQ.trim() && (
        <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.12)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12, color: C.muted }}>
          Looking up contract address...
        </div>
      )}

      {loading && !q ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 100px 72px 100px 72px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>#</div>
              <div>NAME</div>
              <button onClick={function () { handleSort('current_price'); }} style={{ background: 'none', border: 'none', color: sort === 'current_price' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                PRICE {sort === 'current_price' ? (dir === -1 ? 'v' : '^') : ''}
              </button>
              <button onClick={function () { handleSort('price_change_percentage_24h'); }} style={{ background: 'none', border: 'none', color: sort === 'price_change_percentage_24h' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                24H {sort === 'price_change_percentage_24h' ? (dir === -1 ? 'v' : '^') : ''}
              </button>
              <button onClick={function () { handleSort('market_cap'); }} style={{ background: 'none', border: 'none', color: sort === 'market_cap' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                MKT CAP {sort === 'market_cap' ? (dir === -1 ? 'v' : '^') : ''}
              </button>
              <div style={{ textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>7D</div>
            </div>
          )}

          {sorted.length === 0 && debouncedQ && !searchLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found for "{debouncedQ}"
              {isContractQuery && <div style={{ marginTop: 8, fontSize: 12 }}>Token may be too new or not indexed yet</div>}
            </div>
          )}

          {sorted.map(function (c, i) { return renderRow(c, i, isMobile, onSelectCoin); })}

          {sorted.length === 0 && !q && !loading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No market data available</div>
          )}
        </div>
      )}
    </div>
  );
}
