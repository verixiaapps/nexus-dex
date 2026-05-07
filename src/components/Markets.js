import React, { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * NEXUS DEX -- Markets
 *
 * Data sources (locked):
 *   Jupiter v2  -> Solana tokens (verified + unverified)
 *   LiFi v1     -> EVM tokens across every chain LiFi indexes
 *   0x          -> swap quotes only, NOT used in this file (browse/search)
 *
 * Hard rules enforced in this file:
 *
 *   1. Every displayed row must have a *real, parseable* address:
 *        - Solana: base58 mint, length 32-44, passes isValidMint
 *        - EVM:    0x-prefixed 40-hex, passes isValidEvmAddress
 *      AND a non-empty symbol. Anything else is dropped, never displayed.
 *
 *   2. Search results must actually match the query. The Jupiter symbol
 *      search returns loosely-related tokens; we filter to symbol/name/
 *      address matches client-side, the same way the EVM branch already
 *      does. Verified Jupiter tokens are boosted above unverified scams.
 *
 *   3. Click handling never hands a raw row to the parent. Every row is
 *      run through `toCanonicalToken` first, which produces the exact
 *      shape SwapWidget's `normalizeToken` accepts. This guarantees the
 *      Buy/Sell drawer opens with the *clicked* token's address as the
 *      default, not a fallback.
 *
 *   4. No synthetic rows. If a contract is not in our aggregator coverage,
 *      the user sees "not found" -- never a fake placeholder.
 */

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const CHAIN_LABEL = {
  1: 'ETH', 10: 'OP', 56: 'BNB', 100: 'GNO', 130: 'UNI', 137: 'POL',
  146: 'SONIC', 250: 'FTM', 288: 'BOBA', 324: 'ZKS', 480: 'WORLD',
  747: 'FLOW', 1116: 'CORE', 1135: 'LISK', 2222: 'KAVA', 2741: 'ABS',
  5000: 'MNT', 8453: 'BASE', 33139: 'APE', 42161: 'ARB', 43111: 'HEMI',
  43114: 'AVAX', 48900: 'ZRC', 57073: 'INK', 59144: 'LINEA', 60808: 'BOB',
  80094: 'BERA', 81457: 'BLAST', 200901: 'BTL', 534352: 'SCROLL',
};

function chainLabelFor(c) {
  if (!c) return null;
  if (c.chain === 'solana' || c.isSolanaToken) return 'SOL';
  if (c.chainId) return CHAIN_LABEL[c.chainId] || ('CHAIN ' + c.chainId);
  return null;
}

/* ============================================================================
 * Validators -- single source of truth for what counts as a real address.
 * ========================================================================= */
function isValidMint(s) {
  return !!s && typeof s === 'string' &&
    s.length >= 32 && s.length <= 44 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function isValidEvmAddress(s) {
  return !!s && typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

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
function shortAddr(a) {
  if (!a || a.length < 10) return a || '';
  return a.slice(0, 4) + '...' + a.slice(-4);
}

/* ============================================================================
 * Sparkline
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
 * Mappers -- now strictly validate. Anything without a parseable address
 * or a non-empty symbol is rejected at the source so it never reaches the
 * UI or the click handler.
 * ========================================================================= */
function mapJupiter(t) {
  if (!t || !t.id) return null;
  if (!isValidMint(t.id)) return null;
  const symbol = (t.symbol || '').trim();
  if (!symbol) return null;

  const stats = t.stats24h || {};
  const buyVol  = Number(stats.buyVolume) || 0;
  const sellVol = Number(stats.sellVolume) || 0;
  const tags = Array.isArray(t.tags) ? t.tags : [];
  const verified = tags.indexOf('verified') !== -1 || tags.indexOf('strict') !== -1 || !!t.verified;

  return {
    id: t.id,
    mint: t.id,
    symbol,
    name: (t.name || symbol).trim(),
    image: t.icon || t.logoURI || null,
    decimals: typeof t.decimals === 'number' ? t.decimals : 6,
    current_price: t.usdPrice != null ? Number(t.usdPrice) : 0,
    market_cap: t.mcap != null ? Number(t.mcap) : (t.fdv != null ? Number(t.fdv) : 0),
    total_volume: buyVol + sellVol,
    price_change_percentage_24h: stats.priceChange != null ? Number(stats.priceChange) : null,
    sparkline_in_7d: null,
    isSolanaToken: true,
    chain: 'solana',
    verified,
  };
}

function mapLifi(t) {
  if (!t || !t.address) return null;
  const isSolana = !t.address.startsWith('0x');
  if (isSolana) {
    if (!isValidMint(t.address)) return null;
  } else {
    if (!isValidEvmAddress(t.address)) return null;
  }
  const symbol = (t.symbol || '').trim();
  if (!symbol) return null;

  return {
    id: t.address + '-' + (t.chainId || 'sol'),
    address: t.address,
    mint: isSolana ? t.address : undefined,
    chainId: t.chainId,
    symbol,
    name: (t.name || symbol).trim(),
    image: t.logoURI || null,
    decimals: typeof t.decimals === 'number' ? t.decimals : 18,
    current_price: t.priceUSD ? parseFloat(t.priceUSD) : 0,
    market_cap: 0,
    total_volume: 0,
    price_change_percentage_24h: null,
    sparkline_in_7d: null,
    isSolanaToken: isSolana,
    chain: isSolana ? 'solana' : 'evm',
    verified: false,
  };
}

/* ============================================================================
 * isUsableRow -- gate for both display and click. A row is usable iff it
 * carries a real address and a real symbol. This protects against badly-
 * mapped entries in the parent's `coins` prop just as much as it protects
 * against bad search results.
 * ========================================================================= */
function isUsableRow(c) {
  if (!c) return false;
  if (!c.symbol || typeof c.symbol !== 'string' || !c.symbol.trim()) return false;
  if (c.chain === 'solana' || c.isSolanaToken) {
    return isValidMint(c.mint || c.id);
  }
  if (c.chain === 'evm' || c.chainId) {
    return isValidEvmAddress(c.address);
  }
  // No chain info at all -- try to infer from what's there.
  if (c.address && isValidEvmAddress(c.address)) return true;
  if ((c.mint || c.id) && isValidMint(c.mint || c.id)) return true;
  return false;
}

/* ============================================================================
 * toCanonicalToken -- the exact shape SwapWidget's normalizeToken accepts.
 * Every onSelectCoin call goes through this. If we can't produce a canonical
 * token, we don't fire the click at all (better than opening the swap with
 * the wrong default).
 * ========================================================================= */
function toCanonicalToken(c) {
  if (!c) return null;
  const symbol = (c.symbol || '').trim();
  const name   = (c.name || symbol).trim();
  const image  = c.image || c.logoURI || null;

  // Solana detection: explicit chain flag, or valid mint, or isSolanaToken.
  const possibleMint = c.mint || (!c.address ? c.id : null);
  const looksSolana =
    c.chain === 'solana' || c.isSolanaToken === true ||
    (possibleMint && isValidMint(possibleMint) && !c.chainId);

  if (looksSolana) {
    if (!isValidMint(possibleMint)) return null;
    if (!symbol) return null;
    return {
      chain: 'solana',
      mint: possibleMint,
      symbol,
      name,
      decimals: typeof c.decimals === 'number' ? c.decimals : 6,
      logoURI: image,
    };
  }

  // EVM detection: explicit chain flag plus chainId, or 0x address present.
  if (c.address && isValidEvmAddress(c.address) && c.chainId) {
    if (!symbol) return null;
    return {
      chain: 'evm',
      address: c.address,
      chainId: c.chainId,
      symbol,
      name,
      decimals: typeof c.decimals === 'number' ? c.decimals : 18,
      logoURI: image,
    };
  }

  return null;
}

/* ============================================================================
 * Lazy LiFi token cache. Fetched once per session. Mappers reject malformed
 * entries so the cache only ever holds valid, tradeable tokens.
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
                if (m) all.push(m);
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
 * Search ranking. Score by relevance, then by verified, then by market cap.
 * Zero-score (irrelevant) rows are filtered out -- they never appear.
 * ========================================================================= */
function rankSearchResults(results, query) {
  const ql = query.toLowerCase();
  function score(c) {
    const sym  = (c.symbol || '').toLowerCase();
    const nm   = (c.name   || '').toLowerCase();
    const addr = ((c.mint || c.address) || '').toLowerCase();
    if (addr === ql)         return 1000;
    if (sym  === ql)         return 800;
    if (sym.startsWith(ql))  return 500;
    if (sym.includes(ql))    return 300;
    if (nm.includes(ql))     return 100;
    return 0;
  }
  return results
    .map(function (c) { return { c, s: score(c) }; })
    .filter(function (x) { return x.s > 0; })
    .sort(function (a, b) {
      if (a.s !== b.s) return b.s - a.s;
      const va = a.c.verified ? 1 : 0;
      const vb = b.c.verified ? 1 : 0;
      if (va !== vb) return vb - va;
      return (b.c.market_cap || 0) - (a.c.market_cap || 0);
    })
    .map(function (x) { return x.c; });
}

/* ============================================================================
 * Row renderer
 * ========================================================================= */
function renderRow(c, i, isMobile, onRowClick) {
  const change = c.price_change_percentage_24h;
  const positive = (change || 0) >= 0;
  const sparkData = c.sparkline_in_7d
    ? c.sparkline_in_7d.price.filter(function (_, idx) { return idx % 8 === 0; })
    : [];
  const chain = chainLabelFor(c);
  const displaySymbol = (c.symbol || '').toUpperCase() || shortAddr(c.mint || c.address);

  function handleClick() { onRowClick(c); }
  function handleEnter(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }
  function handleLeave(e) { e.currentTarget.style.background = 'transparent'; }

  const fallbackLetter = (c.symbol || '?').charAt(0).toUpperCase();

  const ChainBadge = chain ? (
    <span style={{
      display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4,
      background: 'rgba(0,229,255,.07)', border: '1px solid rgba(0,229,255,.18)',
      color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, verticalAlign: 'middle',
    }}>{chain}</span>
  ) : null;

  const VerifiedBadge = c.verified ? (
    <span title="Verified" style={{
      display: 'inline-block', marginLeft: 4, padding: '1px 4px', borderRadius: 4,
      background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.25)',
      color: C.green, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, verticalAlign: 'middle',
    }}>{'\u2713'}</span>
  ) : null;

  if (isMobile) {
    return (
      <div key={c.id} onClick={handleClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
        {c.image
          ? <img src={c.image} alt={displaySymbol} style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} onError={function (e) { e.target.style.display = 'none'; }} />
          : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{fallbackLetter}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {displaySymbol}
            {ChainBadge}
            {VerifiedBadge}
          </div>
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
          ? <img src={c.image} alt={displaySymbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.08)' }} onError={function (e) { e.target.style.display = 'none'; }} />
          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{fallbackLetter}</div>
        }
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
          <div style={{ fontSize: 10, color: C.muted }}>
            {displaySymbol}
            {ChainBadge}
            {VerifiedBadge}
          </div>
        </div>
      </div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>{fmt(c.current_price)}</div>
      <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pctFmt(change)}</div>
      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><SparkLine data={sparkData} positive={positive} /></div>
    </div>
  );
}

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
   * --------------------------------------------------------------------- */
  useEffect(function () {
    const trimmed = debouncedQ.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let aborted = false;

    /* --- EVM contract address paste --- */
    if (isValidEvmAddress(trimmed)) {
      setSearchResults([]);
      setSearchLoading(true);
      getEvmTokenCache().then(function (evmTokens) {
        if (aborted) return;
        const found = evmTokens.filter(function (t) {
          return t.address && t.address.toLowerCase() === trimmed.toLowerCase();
        });
        setSearchResults(found);
        setSearchLoading(false);
      });
      return function () { aborted = true; };
    }

    /* --- Solana mint paste OR free text --- */
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
      const isMintQuery = isValidMint(trimmed);

      // Jupiter: validate via mapJupiter, then filter by relevance.
      jupArr.forEach(function (t) {
        const m = mapJupiter(t);
        if (!m) return;
        const sym  = (m.symbol || '').toLowerCase();
        const nm   = (m.name   || '').toLowerCase();
        const addr = (m.mint   || '').toLowerCase();
        // Mint query: only keep exact-mint matches.
        // Text query: keep if symbol or name contains the query.
        const matches = isMintQuery
          ? addr === ql
          : (sym.includes(ql) || nm.includes(ql) || addr === ql);
        if (!matches) return;
        const key = 'sol-' + m.mint;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(m);
      });

      // LiFi: skip Solana entries (Jupiter is canonical for Solana). Filter
      // by relevance. Mappers already enforced address+symbol validity.
      if (!isMintQuery) {
        evmArr.forEach(function (t) {
          if (!t || t.chain === 'solana') return;
          const sym = (t.symbol || '').toLowerCase();
          const nm  = (t.name   || '').toLowerCase();
          if (!sym.includes(ql) && !nm.includes(ql)) return;
          const key = 'evm-' + t.address + '-' + t.chainId;
          if (seen.has(key)) return;
          seen.add(key);
          out.push(t);
        });
      }

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

  /* Default browse list:
   *   - Drop unusable rows (no address / no symbol). Better to show fewer
   *     rows than to show clickable rows that won't open a swap correctly.
   *   - Sort by user-selected column.
   * Search list:
   *   - Already validated and relevance-filtered upstream.
   *   - Apply rankSearchResults for verified-first ordering. */
  const sorted = useMemo(function () {
    const trimmed = debouncedQ.trim();
    if (trimmed) {
      return rankSearchResults(searchResults, trimmed);
    }
    const base = (coins || []).filter(isUsableRow).slice(0, 20);
    return base.slice().sort(function (a, b) {
      return dir * ((a[sort] || 0) - (b[sort] || 0));
    });
  }, [debouncedQ, searchResults, coins, sort, dir]);

  /* Click pipeline:
   *   1. Canonicalize the row.
   *   2. If it can't be canonicalized, swallow the click. (Should never
   *      happen because isUsableRow gates display, but defensive.)
   *   3. Hand the canonical token to the parent. SwapWidget's normalizeToken
   *      is now guaranteed to return non-null for this input, which means
   *      defaultTokenPair will populate the Buy/Sell defaults with this
   *      token's exact address. */
  const handleRowClick = useCallback(function (row) {
    const canonical = toCanonicalToken(row);
    if (!canonical) {
      console.warn('[Markets] dropped click on un-canonicalizable row:', row);
      return;
    }
    if (typeof onSelectCoin === 'function') onSelectCoin(canonical);
  }, [onSelectCoin]);

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
              {isContractQuery
                ? 'This contract is not in our aggregator coverage (Jupiter / LiFi).'
                : 'No tokens found for "' + debouncedQ + '"'}
            </div>
          )}

          {sorted.map(function (c, i) { return renderRow(c, i, isMobile, handleRowClick); })}

          {sorted.length === 0 && !q && !loading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No market data available</div>
          )}
        </div>
      )}
    </div>
  );
}
