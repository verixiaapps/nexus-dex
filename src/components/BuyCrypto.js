import React, { useState, useEffect, useCallback } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d) {
  d = d || 2;
  if (n == null || n === 0) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '--';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function SparkLine({ data, positive }) {
  if (!data || data.length < 2) return null;
  var min = Math.min.apply(null, data);
  var max = Math.max.apply(null, data);
  var range = max - min || 1;
  var w = 80, h = 32;
  var pts = data.map(function(v, i) {
    var x = (i / (data.length - 1)) * w;
    var y = h - ((v - min) / range) * h;
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

  var isContract = isValidMint(q.trim());

  useEffect(function() {
    var trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setSearchResults([]); setSearchToken(null); return; }

    if (isValidMint(trimmed)) {
      setSearchLoading(true);
      Promise.all([
        fetch('https://lite-api.jup.ag/tokens/v1/token/' + trimmed).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
        fetch('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + trimmed).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
      ]).then(function(results) {
        var jupMeta = results[0];
        var gtData = results[1] && results[1].data && results[1].data.attributes;
        var price = gtData ? parseFloat(gtData.price_usd || 0) : 0;
        var pChange = gtData && gtData.price_change_percentage ? gtData.price_change_percentage : {};
        if (jupMeta || gtData) {
          setSearchToken({
            id: trimmed, mint: trimmed,
            symbol: (jupMeta && jupMeta.symbol) || (gtData && gtData.symbol) || trimmed.slice(0, 6) + '...',
            name: (jupMeta && jupMeta.name) || (gtData && gtData.name) || 'Unknown Token',
            image: (jupMeta && jupMeta.logoURI) || (gtData && gtData.image_url) || null,
            current_price: price,
            market_cap: gtData ? parseFloat(gtData.fdv_usd || gtData.market_cap_usd || 0) : 0,
            total_volume: gtData ? parseFloat((gtData.volume_usd && gtData.volume_usd.h24) || 0) : 0,
            price_change_percentage_24h: pChange.h24 ? parseFloat(pChange.h24) : null,
            price_change_percentage_1h_in_currency: pChange.h1 ? parseFloat(pChange.h1) : null,
            sparkline_in_7d: null, isSolanaToken: true,
          });
        }
        setSearchLoading(false);
      });
      return;
    }

    setSearchToken(null);
    setSearchLoading(true);
    var ql = trimmed.toLowerCase();

    var cgMatches = coins.filter(function(c) {
      return (c.name && c.name.toLowerCase().includes(ql)) || (c.symbol && c.symbol.toLowerCase().includes(ql));
    });

    var localJupMatches = [];
    if (jupiterTokens && jupiterTokens.length) {
      var cgIds = new Set(cgMatches.map(function(c) { return (c.symbol || '').toLowerCase(); }));
      localJupMatches = jupiterTokens.filter(function(t) {
        if (cgIds.has((t.symbol || '').toLowerCase())) return false;
        return (t.symbol && t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql));
      }).slice(0, 40).map(function(t) {
        return { id: t.mint, mint: t.mint, symbol: t.symbol, name: t.name, image: t.logoURI || null, current_price: 0, market_cap: 0, total_volume: 0, price_change_percentage_24h: null, sparkline_in_7d: null, isSolanaToken: true };
      });
    }

    var immediate = cgMatches.concat(localJupMatches);
    if (immediate.length) setSearchResults(immediate);

    var qlLower = trimmed.toLowerCase();

    Promise.all([
      fetch('https://lite-api.jup.ag/tokens/v1/tagged/strict').then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }),
      fetch('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(trimmed)).then(function(r) { return r.ok ? r.json() : { pairs: [] }; }).catch(function() { return { pairs: [] }; }),
    ]).then(function(results) {
      var jupTokens = Array.isArray(results[0]) ? results[0] : [];
      var dexPairs = results[1].pairs || [];
      var existingSymbols = new Set(immediate.map(function(c) { return (c.symbol || '').toLowerCase(); }));

      var jupMatches = jupTokens.filter(function(t) {
        if (existingSymbols.has((t.symbol || '').toLowerCase())) return false;
        return (t.symbol && t.symbol.toLowerCase().includes(qlLower)) || (t.name && t.name.toLowerCase().includes(qlLower));
      }).slice(0, 30).map(function(t) {
        existingSymbols.add((t.symbol || '').toLowerCase());
        return { id: t.address, mint: t.address, symbol: t.symbol, name: t.name, image: t.logoURI || null, current_price: 0, market_cap: 0, total_volume: 0, price_change_percentage_24h: null, sparkline_in_7d: null, isSolanaToken: true };
      });

      var dexSeen = new Set();
      var dexMatches = dexPairs
        .filter(function(p) { return p.chainId === 'solana' && p.baseToken; })
        .filter(function(p) {
          var sym = (p.baseToken.symbol || '').toLowerCase();
          var addr = p.baseToken.address || '';
          if (existingSymbols.has(sym) || dexSeen.has(addr)) return false;
          dexSeen.add(addr);
          return true;
        }).slice(0, 20).map(function(p) {
          return { id: p.baseToken.address, mint: p.baseToken.address, symbol: p.baseToken.symbol, name: p.baseToken.name, image: null, current_price: parseFloat(p.priceUsd || 0), market_cap: p.fdv || 0, total_volume: p.volume ? p.volume.h24 : 0, price_change_percentage_24h: p.priceChange ? p.priceChange.h24 : null, sparkline_in_7d: null, isSolanaToken: true };
        });

      var combined = immediate.concat(jupMatches).concat(dexMatches);
      if (combined.length) setSearchResults(combined);
      setSearchLoading(false);

      var mintsToPrice = combined.filter(function(c) { return c.isSolanaToken && !c.current_price && c.mint; }).map(function(c) { return c.mint; }).slice(0, 30);
      if (mintsToPrice.length) {
        fetch('https://api.jup.ag/price/v2?ids=' + mintsToPrice.join(','))
          .then(function(r) { return r.ok ? r.json() : {}; })
          .then(function(priceData) {
            if (!priceData.data) return;
            setSearchResults(function(prev) {
              return prev.map(function(c) {
                var p = priceData.data[c.mint];
                if (!p || !p.price) return c;
                return Object.assign({}, c, { current_price: parseFloat(p.price) });
              });
            });
          }).catch(function() {});
      }
    }).catch(function() { setSearchLoading(false); });
  }, [q, coins, jupiterTokens]);

  useEffect(function() {
    if (!searchResults.length) return;
    var mints = searchResults.filter(function(c) { return c.isSolanaToken && c.current_price === 0; }).map(function(c) { return c.id; }).slice(0, 30);
    if (!mints.length) return;
    fetch('https://api.jup.ag/price/v2?ids=' + mints.join(',')).then(function(r) { return r.json(); }).then(function(data) {
      if (!data.data) return;
      setSearchResults(function(prev) {
        return prev.map(function(c) {
          var p = data.data[c.id];
          if (!p || !p.price) return c;
          return Object.assign({}, c, { current_price: parseFloat(p.price) });
        });
      });
    }).catch(function() {});
  }, [searchResults.length]);

  function handleSort(key) {
    if (sort === key) setDir(function(d) { return -d; });
    else { setSort(key); setDir(-1); }
  }

  var displayCoins = q.trim() ? (searchToken ? [searchToken] : searchResults) : coins;
  var sorted = displayCoins.slice().sort(function(a, b) { return dir * ((a[sort] || 0) - (b[sort] || 0)); });

  function renderRow(c, i) {
    var positive = (c.price_change_percentage_24h || 0) >= 0;
    var sparkData = c.sparkline_in_7d ? c.sparkline_in_7d.price.filter(function(_, i) { return i % 8 === 0; }) : [];

    if (isMobile) {
      return (
        <div key={c.id} onClick={function() { onSelectCoin && onSelectCoin(c); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }} onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }} onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}>
          <div style={{ color: C.muted, fontSize: 11, width: 20, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
          {c.image ? <img src={c.image} alt={c.symbol} style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{c.symbol && c.symbol.charAt(0).toUpperCase()}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.symbol && c.symbol.toUpperCase()}</div>
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
      <div key={c.id} onClick={function() { onSelectCoin && onSelectCoin(c); }} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 110px 80px 110px 90px', gap: 8, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', alignItems: 'center' }} onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }} onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}>
        <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {c.image ? <img src={c.image} alt={c.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{c.symbol && c.symbol.charAt(0).toUpperCase()}</div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{c.symbol && c.symbol.toUpperCase()}</div>
          </div>
        </div>
        <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, textAlign: 'right' }}>{fmt(c.current_price)}</div>
        <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>{pct(c.price_change_percentage_24h)}</div>
        <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{fmt(c.market_cap)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><SparkLine data={sparkData} positive={positive} /></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Search any token or paste a contract address</p>
        </div>
        <div style={{ position: 'relative', width: '100%', maxWidth: 280 }}>
          <input value={q} onChange={function(e) { setQ(e.target.value); }} placeholder="Search name, symbol or paste address..." style={{ background: C.card, border: '1px solid ' + (q ? C.borderHi : C.border), borderRadius: 10, padding: '9px 36px 9px 14px', color: '#fff', fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: '100%' }} />
          {q && <button onClick={function() { setQ(''); setSearchResults([]); setSearchToken(null); }} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>x</button>}
          {searchLoading && <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.accent, fontSize: 11 }}>...</div>}
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
              <button onClick={function() { handleSort('current_price'); }} style={{ background: 'none', border: 'none', color: sort === 'current_price' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>PRICE {sort === 'current_price' ? (dir === -1 ? 'v' : '^') : ''}</button>
              <button onClick={function() { handleSort('price_change_percentage_24h'); }} style={{ background: 'none', border: 'none', color: sort === 'price_change_percentage_24h' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>24H {sort === 'price_change_percentage_24h' ? (dir === -1 ? 'v' : '^') : ''}</button>
              <button onClick={function() { handleSort('market_cap'); }} style={{ background: 'none', border: 'none', color: sort === 'market_cap' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>MKT CAP {sort === 'market_cap' ? (dir === -1 ? 'v' : '^') : ''}</button>
              <div style={{ textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>7D</div>
            </div>
          )}
          {sorted.length === 0 && q && !searchLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found for "{q}"
              {isContract && <div style={{ marginTop: 8, fontSize: 12 }}>Token may be too new or not indexed yet</div>}
            </div>
          )}
          {sorted.map(function(c, i) { return renderRow(c, i); })}
          {sorted.length === 0 && !q && !loading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No market data available</div>
          )}
        </div>
      )}
    </div>
  );
}

