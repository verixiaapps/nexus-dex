Alright, then we work with what's enabled. Let me rewrite Markets to use all-tokens for browsing. One call, no dashboard changes needed.

Here's the whole file — replace yours:

```js
import React, { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * NEXUS DEX -- Markets
 * 
 * Data source: OKX DEX Aggregator all-tokens (multi-chain).
 * Fallback: Helius DAS for Solana pump.fun tokens not in OKX.
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

const OKX_SOLANA_CHAIN = '501';

const OKX_CHAINS = [
  { chainIndex: '501', label: 'SOL', chain: 'solana' },
  { chainIndex: '1', label: 'ETH', chain: 'evm' },
  { chainIndex: '8453', label: 'BASE', chain: 'evm' },
  { chainIndex: '42161', label: 'ARB', chain: 'evm' },
  { chainIndex: '10', label: 'OP', chain: 'evm' },
  { chainIndex: '137', label: 'POL', chain: 'evm' },
  { chainIndex: '56', label: 'BNB', chain: 'evm' },
  { chainIndex: '43114', label: 'AVAX', chain: 'evm' },
  { chainIndex: '59144', label: 'LINEA', chain: 'evm' },
  { chainIndex: '534352', label: 'SCROLL', chain: 'evm' },
  { chainIndex: '5000', label: 'MNT', chain: 'evm' },
  { chainIndex: '81457', label: 'BLAST', chain: 'evm' },
  { chainIndex: '324', label: 'ZKS', chain: 'evm' },
  { chainIndex: '100', label: 'GNO', chain: 'evm' },
  { chainIndex: '250', label: 'FTM', chain: 'evm' },
  { chainIndex: '25', label: 'CRO', chain: 'evm' },
  { chainIndex: '80094', label: 'BERA', chain: 'evm' },
  { chainIndex: '130', label: 'UNI', chain: 'evm' },
];

const BROWSE_KEYWORDS = ['a', 'e', 'i', 'o', 't', 'n', 's'];

const CHAIN_LABEL = OKX_CHAINS.reduce(function(acc, c) {
  acc[String(c.chainIndex)] = c.label;
  return acc;
}, {});

function isValidMint(s) {
  return !!s &&
    typeof s === 'string' &&
    s.length >= 32 &&
    s.length <= 44 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

function isValidEvmAddress(s) {
  return !!s &&
    typeof s === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(s);
}

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

  useEffect(function() {
    const t = setTimeout(function() {
      setDebounced(value);
    }, delay);

    return function() {
      clearTimeout(t);
    };
  }, [value, delay]);

  return debounced;
}

function normalizeOkxToken(t, chainInfo) {
  if (!t || !chainInfo) return null;

  const chainIndex = String(t.chainIndex || chainInfo.chainIndex);

  const tokenContractAddress =
    t.tokenContractAddress ||
    t.contractAddress ||
    t.address ||
    t.tokenAddress ||
    '';

  const symbol = String(t.tokenSymbol || t.symbol || '').trim();
  const name = String(t.tokenName || t.name || symbol || '').trim();

  const decimalsRaw = t.decimals != null ? t.decimals : t.tokenDecimal;
  const decimals = Number.isFinite(Number(decimalsRaw))
    ? Number(decimalsRaw)
    : (chainIndex === OKX_SOLANA_CHAIN ? 9 : 18);

  if (!symbol) return null;

  const logo = t.tokenLogoUrl || t.logoURI || t.logoUrl || null;

  const price =
    Number(t.tokenUnitPrice || t.price || t.priceUsd || t.priceUSD || 0) || 0;

  const marketCap =
    Number(t.marketCap || t.mcap || 0) || 0;

  const volume =
    Number(t.volume24h || t.totalVolume || 0) || 0;

  const change =
    t.priceChange24h != null ? Number(t.priceChange24h) : null;

  const verified =
    !!t.isVerified || !!t.verified || !!t.isWhitelist || !!t.whiteListed;

  const isSolana = chainIndex === OKX_SOLANA_CHAIN;

  if (isSolana) {
    if (!isValidMint(tokenContractAddress)) return null;

    return {
      id: 'okx-sol-' + tokenContractAddress,
      chain: 'solana',
      chainIndex,
      chainId: null,
      mint: tokenContractAddress,
      address: undefined,
      symbol,
      name,
      decimals,
      logoURI: logo,
      image: logo,
      current_price: price,
      market_cap: marketCap,
      total_volume: volume,
      price_change_percentage_24h: Number.isFinite(change) ? change : null,
      verified,
      isSolanaToken: true,
      source: 'okx',
    };
  }

  if (!isValidEvmAddress(tokenContractAddress)) return null;

  return {
    id: 'okx-' + chainIndex + '-' + tokenContractAddress.toLowerCase(),
    chain: 'evm',
    chainIndex,
    chainId: Number(chainIndex),
    address: tokenContractAddress,
    mint: undefined,
    symbol,
    name,
    decimals,
    logoURI: logo,
    image: logo,
    current_price: price,
    market_cap: marketCap,
    total_volume: volume,
    price_change_percentage_24h: Number.isFinite(change) ? change : null,
    verified,
    isSolanaToken: false,
    source: 'okx',
  };
}

function isUsableRow(c) {
  if (!c || !c.symbol || !String(c.symbol).trim()) return false;
  if (c.chain === 'solana') return isValidMint(c.mint);
  if (c.chain === 'evm') return isValidEvmAddress(c.address) && !!c.chainId;
  return false;
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
      source: c.source || 'okx',
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
    source: c.source || 'okx',
  };
}

function matchesQuery(c, query) {
  const q = query.toLowerCase();
  const sym = String(c.symbol || '').toLowerCase();
  const name = String(c.name || '').toLowerCase();
  const addr = String(c.mint || c.address || '').toLowerCase();

  return addr === q ||
    sym === q ||
    sym.startsWith(q) ||
    sym.includes(q) ||
    name.includes(q);
}

function rankResults(results, query) {
  const q = query.toLowerCase();

  function score(c) {
    const sym = String(c.symbol || '').toLowerCase();
    const name = String(c.name || '').toLowerCase();
    const addr = String(c.mint || c.address || '').toLowerCase();

    if (addr === q) return 1000;
    if (sym === q) return 800;
    if (sym.startsWith(q)) return 600;
    if (sym.includes(q)) return 350;
    if (name.includes(q)) return 150;
    return 0;
  }

  return results
    .map(function(c) {
      return { c, s: score(c) };
    })
    .filter(function(x) {
      return x.s > 0;
    })
    .sort(function(a, b) {
      if (a.s !== b.s) return b.s - a.s;

      const av = a.c.verified ? 1 : 0;
      const bv = b.c.verified ? 1 : 0;
      if (av !== bv) return bv - av;

      const ap = a.c.current_price ? 1 : 0;
      const bp = b.c.current_price ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const am = Number(a.c.market_cap || 0);
      const bm = Number(b.c.market_cap || 0);
      return bm - am;
    })
    .map(function(x) {
      return x.c;
    });
}

function unwrapOkxTokenList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.data)) return data.data;
  if (Array.isArray(data && data.tokenList)) return data.tokenList;
  if (Array.isArray(data && data.data && data.data[0] && data.data[0].tokenList)) {
    return data.data[0].tokenList;
  }
  if (Array.isArray(data && data.data && data.data[0] && data.data[0].tokens)) {
    return data.data[0].tokens;
  }
  return [];
}

async function fetchOkxAllTokens(query) {
  const qs = new URLSearchParams({
    keyword: query,
  });

  const res = await fetch('/api/okx/dex/aggregator/all-tokens?' + qs.toString());

  const data = await res.json().catch(function() {
    return null;
  });

  if (!res.ok) return [];

  const out = [];

  unwrapOkxTokenList(data).forEach(function(t) {
    const chainIndex = String(t.chainIndex || '');

    const chainInfo =
      OKX_CHAINS.find(function(c) {
        return c.chainIndex === chainIndex;
      }) ||
      (chainIndex
        ? {
            chainIndex,
            label: CHAIN_LABEL[chainIndex] || chainIndex,
            chain: chainIndex === OKX_SOLANA_CHAIN ? 'solana' : 'evm',
          }
        : null);

    const m = normalizeOkxToken(t, chainInfo);
    if (m) out.push(m);
  });

  return out;
}

async function fetchPumpFallbackToken(mint) {
  if (!isValidMint(mint)) return null;

  const payload = {
    jsonrpc: '2.0',
    id: 'nexus-das-' + Date.now(),
    method: 'getAsset',
    params: {
      id: mint,
      displayOptions: {
        showFungible: true,
      },
    },
  };

  const res = await fetch('/api/helius/das', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(function() {
    return null;
  });

  if (!res.ok || !data || !data.result) return null;

  const asset = data.result;
  const content = asset.content || {};
  const metadata = content.metadata || {};
  const tokenInfo = asset.token_info || {};

  const symbol = String(
    tokenInfo.symbol ||
    metadata.symbol ||
    ''
  ).trim();

  const name = String(
    tokenInfo.name ||
    metadata.name ||
    symbol ||
    'Pump Token'
  ).trim();

  const image =
    (content.links && content.links.image) ||
    content.files && content.files[0] && content.files[0].uri ||
    null;

  if (!symbol && !name) return null;

  return {
    id: 'pump-' + mint,
    chain: 'solana',
    chainIndex: OKX_SOLANA_CHAIN,
    chainId: null,
    mint,
    address: undefined,
    symbol: symbol || shortAddr(mint),
    name: name || symbol || shortAddr(mint),
    decimals: Number.isFinite(Number(tokenInfo.decimals)) ? Number(tokenInfo.decimals) : 6,
    logoURI: image,
    image,
    current_price: Number(tokenInfo.price_info && tokenInfo.price_info.price_per_token) || 0,
    market_cap: 0,
    total_volume: 0,
    price_change_percentage_24h: null,
    verified: false,
    isSolanaToken: true,
    source: 'pump-fallback',
  };
}

function RowImage({ token, size }) {
  const [broken, setBroken] = useState(false);
  const letter = String(token.symbol || '?').charAt(0).toUpperCase();

  if (!token.image || broken) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(0,229,255,.1)',
        border: '1px solid rgba(0,229,255,.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 800,
        color: C.accent,
        flexShrink: 0,
      }}>
        {letter}
      </div>
    );
  }

  return (
    <img
      src={token.image}
      alt={token.symbol}
      onError={function() {
        setBroken(true);
      }}
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
  const label = token.chain === 'solana'
    ? (token.source === 'pump-fallback' ? 'PUMP' : 'SOL')
    : (CHAIN_LABEL[String(token.chainIndex)] || ('CHAIN ' + token.chainId));

  return (
    <span style={{
      display: 'inline-block',
      marginLeft: 6,
      padding: '1px 5px',
      borderRadius: 4,
      background: token.source === 'pump-fallback' ? 'rgba(168,85,247,.08)' : 'rgba(0,229,255,.07)',
      border: token.source === 'pump-fallback' ? '1px solid rgba(168,85,247,.25)' : '1px solid rgba(0,229,255,.18)',
      color: token.source === 'pump-fallback' ? '#a855f7' : C.muted,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.4,
      verticalAlign: 'middle',
    }}>
      {label}
    </span>
  );
}

function VerifiedBadge({ token }) {
  if (!token.verified) return null;

  return (
    <span style={{
      display: 'inline-block',
      marginLeft: 4,
      padding: '1px 4px',
      borderRadius: 4,
      background: 'rgba(0,255,163,.08)',
      border: '1px solid rgba(0,255,163,.25)',
      color: C.green,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.4,
      verticalAlign: 'middle',
    }}>
      ✓
    </span>
  );
}

function renderRow(c, i, isMobile, onRowClick) {
  const change = c.price_change_percentage_24h;
  const positive = (Number(change) || 0) >= 0;
  const displaySymbol = String(c.symbol || '').toUpperCase() || shortAddr(c.mint || c.address);

  function handleClick() {
    onRowClick(c);
  }

  function handleEnter(e) {
    e.currentTarget.style.background = 'rgba(0,229,255,.03)';
  }

  function handleLeave(e) {
    e.currentTarget.style.background = 'transparent';
  }

  if (isMobile) {
    return (
      <div
        key={c.id}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,.025)',
          cursor: 'pointer',
        }}
      >
        <div style={{ color: C.muted, fontSize: 10, width: 18, flexShrink: 0, textAlign: 'center' }}>
          {i + 1}
        </div>

        <RowImage token={c} size={34} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700,
            fontSize: 13,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {c.name || displaySymbol}
          </div>

          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {displaySymbol}
            <ChainBadge token={c} />
            <VerifiedBadge token={c} />
          </div>

          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
            {shortAddr(c.mint || c.address)}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
            {fmt(c.current_price)}
          </div>
          <div style={{
            fontSize: 11,
            color: positive ? C.green : C.red,
            marginTop: 1,
            fontWeight: 600,
          }}>
            {pctFmt(change)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      key={c.id}
      onClick={handleClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px',
        gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,.025)',
        cursor: 'pointer',
        alignItems: 'center',
      }}
    >
      <div style={{ color: C.muted, fontSize: 11 }}>
        {i + 1}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <RowImage token={c} size={32} />

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontWeight: 700,
            fontSize: 13,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {c.name || displaySymbol}
          </div>

          <div style={{ fontSize: 10, color: C.muted }}>
            {displaySymbol}
            <ChainBadge token={c} />
            <VerifiedBadge token={c} />
            <span style={{ marginLeft: 6 }}>
              {shortAddr(c.mint || c.address)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ fontWeight: 600, color: '#fff', fontSize: 12, textAlign: 'right' }}>
        {fmt(c.current_price)}
      </div>

      <div style={{
        fontSize: 12,
        color: positive ? C.green : C.red,
        textAlign: 'right',
        fontWeight: 600,
      }}>
        {pctFmt(change)}
      </div>

      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>
        {fmt(c.market_cap)}
      </div>
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

  useEffect(function() {
    function handler() {
      setIsMobile(window.innerWidth < 768);
    }

    window.addEventListener('resize', handler);

    return function() {
      window.removeEventListener('resize', handler);
    };
  }, []);

  // Browse: fire all-tokens with single-letter keywords, merge, dedupe
  useEffect(function() {
    let cancelled = false;

    setBrowseLoading(true);

    Promise.all(
      BROWSE_KEYWORDS.map(function(kw) {
        return fetchOkxAllTokens(kw);
      })
    )
      .then(function(results) {
        if (cancelled) return;

        const seen = new Set();
        const merged = [];

        results.flat().forEach(function(t) {
          if (!isUsableRow(t)) return;
          const key = t.chain + '-' + (t.mint || t.address || '').toLowerCase() + '-' + (t.chainId || '');
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(t);
        });

        // Sort by market cap desc for default view
        merged.sort(function(a, b) {
          return (Number(b.market_cap) || 0) - (Number(a.market_cap) || 0);
        });

        setBrowseTokens(merged.slice(0, 100));
        setBrowseLoading(false);
      })
      .catch(function() {
        if (cancelled) return;
        setBrowseTokens([]);
        setBrowseLoading(false);
      });

    return function() {
      cancelled = true;
    };
  }, []);

  // Search
  useEffect(function() {
    const trimmed = debouncedQ.trim();

    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;

    setSearchLoading(true);

    fetchOkxAllTokens(trimmed)
      .then(async function(tokens) {
        if (cancelled) return;

        const seen = new Set();
        const filtered = [];

        tokens.forEach(function(t) {
          if (!isUsableRow(t)) return;
          if (!matchesQuery(t, trimmed)) return;

          const key = t.chain + '-' + (t.mint || t.address || '').toLowerCase() + '-' + (t.chainId || '');
          if (seen.has(key)) return;

          seen.add(key);
          filtered.push(t);
        });

        if (filtered.length === 0 && isValidMint(trimmed)) {
          const pumpToken = await fetchPumpFallbackToken(trimmed);
          if (!cancelled && pumpToken && isUsableRow(pumpToken)) {
            filtered.push(pumpToken);
          }
        }

        if (cancelled) return;

        setSearchResults(rankResults(filtered, trimmed));
        setSearchLoading(false);
      })
      .catch(function() {
        if (cancelled) return;
        setSearchResults([]);
        setSearchLoading(false);
      });

    return function() {
      cancelled = true;
    };
  }, [debouncedQ]);

  const handleSort = useCallback(function(key) {
    if (sort === key) {
      setDir(function(d) {
        return -d;
      });
    } else {
      setSort(key);
      setDir(-1);
    }
  }, [sort]);

  const sorted = useMemo(function() {
    const trimmed = debouncedQ.trim();

    if (trimmed) {
      return searchResults;
    }

    return browseTokens
      .slice()
      .sort(function(a, b) {
        const av = Number(a[sort] || 0);
        const bv = Number(b[sort] || 0);
        return dir * (av - bv);
      })
      .slice(0, 50);
  }, [debouncedQ, searchResults, browseTokens, sort, dir]);

  const handleRowClick = useCallback(function(row) {
    const canonical = toCanonicalToken(row);

    if (!canonical) {
      console.warn('[Markets] dropped un-canonicalizable row:', row);
      return;
    }

    if (typeof onSelectCoin === 'function') {
      onSelectCoin(canonical);
    }
  }, [onSelectCoin]);

  const isContractQuery = useMemo(function() {
    const trimmed = debouncedQ.trim();
    return isValidMint(trimmed) || isValidEvmAddress(trimmed);
  }, [debouncedQ]);

  const loading = browseLoading && !q;

  return (
    <div style={{
      maxWidth: 900,
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
      overscrollBehavior: 'none',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 10,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>
            Live Markets
          </h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            Multi-chain OKX coverage. Paste a Solana mint for pump.fun fallback.
          </p>
        </div>

        <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : 320 }}>
          <input
            value={q}
            onChange={function(e) {
              setQ(e.target.value);
            }}
            placeholder="Name, symbol, or contract..."
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
              onClick={function() {
                setQ('');
                setSearchResults([]);
              }}
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
                lineHeight: 1,
                padding: 0,
              }}
            >
              x
            </button>
          )}

          {searchLoading && (
            <div style={{
              position: 'absolute',
              right: q ? 32 : 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: C.accent,
              fontSize: 11,
            }}>
              ...
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
          Loading multi-chain markets...
        </div>
      ) : (
        <div style={{
          background: C.card,
          border: '1px solid ' + C.border,
          borderRadius: 16,
          overflow: 'hidden',
        }}>
          {!isMobile && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '28px minmax(0,1fr) 110px 80px 120px',
              gap: 8,
              padding: '10px 16px',
              borderBottom: '1px solid rgba(0,229,255,.06)',
              fontSize: 10,
              color: C.muted,
              fontWeight: 700,
              letterSpacing: 0.8,
            }}>
              <div>#</div>
              <div>NAME</div>

              <button
                onClick={function() {
                  handleSort('current_price');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: sort === 'current_price' ? C.accent : C.muted,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textAlign: 'right',
                  padding: 0,
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                PRICE {sort === 'current_price' ? (dir === -1 ? 'v' : '^') : ''}
              </button>

              <button
                onClick={function() {
                  handleSort('price_change_percentage_24h');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: sort === 'price_change_percentage_24h' ? C.accent : C.muted,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textAlign: 'right',
                  padding: 0,
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                24H {sort === 'price_change_percentage_24h' ? (dir === -1 ? 'v' : '^') : ''}
              </button>

              <button
                onClick={function() {
                  handleSort('market_cap');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: sort === 'market_cap' ? C.accent : C.muted,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textAlign: 'right',
                  padding: 0,
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                MKT CAP {sort === 'market_cap' ? (dir === -1 ? 'v' : '^') : ''}
              </button>
            </div>
          )}

          {sorted.length === 0 && debouncedQ && !searchLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              {isContractQuery
                ? 'This contract was not found in OKX or Solana metadata fallback.'
                : 'No OKX tokens found for "' + debouncedQ + '"'}
            </div>
          )}

          {sorted.map(function(c, i) {
            return renderRow(c, i, isMobile, handleRowClick);
          })}

          {sorted.length === 0 && !q && !browseLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No market data available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
