import React, { useState } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '--';
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
  var w = 80;
  var h = 32;
  var pts = data.map(function(v, i) {
    var x = (i / (data.length - 1)) * w;
    var y = h - ((v - min) / range) * h;
    return x + ',' + y;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? '#00ffa3' : '#ff3b6b'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Markets({ coins, loading, onSelectCoin }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const [isMobile] = useState(window.innerWidth < 768);

  var filtered = coins.filter(function(c) {
    if (!q) return true;
    return (c.name && c.name.toLowerCase().includes(q.toLowerCase())) ||
      (c.symbol && c.symbol.toLowerCase().includes(q.toLowerCase()));
  });

  var sorted = filtered.slice().sort(function(a, b) {
    return dir * ((a[sort] || 0) - (b[sort] || 0));
  });

  function handleSort(key) {
    if (sort === key) setDir(function(d) { return -d; });
    else { setSort(key); setDir(-1); }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Tap any coin to buy, sell or view details</p>
        </div>
        <input
          value={q}
          onChange={function(e) { setQ(e.target.value); }}
          placeholder="Search coins..."
          style={{
            background: C.card, border: '1px solid ' + C.border,
            borderRadius: 10, padding: '9px 14px', color: '#fff',
            fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none',
            width: '100%', maxWidth: 220,
          }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>Loading markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>

          {!isMobile && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr 110px 80px 110px 90px',
              gap: 8, padding: '10px 16px',
              borderBottom: '1px solid rgba(0,229,255,.06)',
              fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8,
            }}>
              <div>#</div>
              <div>NAME</div>
              <button onClick={function() { handleSort('current_price'); }} style={{ background: 'none', border: 'none', color: sort === 'current_price' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                PRICE {sort === 'current_price' ? (dir === -1 ? '↓' : '↑') : ''}
              </button>
              <button onClick={function() { handleSort('price_change_percentage_24h'); }} style={{ background: 'none', border: 'none', color: sort === 'price_change_percentage_24h' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                24H {sort === 'price_change_percentage_24h' ? (dir === -1 ? '↓' : '↑') : ''}
              </button>
              <button onClick={function() { handleSort('market_cap'); }} style={{ background: 'none', border: 'none', color: sort === 'market_cap' ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: .8, textAlign: 'right', padding: 0, fontFamily: 'Syne, sans-serif' }}>
                MKT CAP {sort === 'market_cap' ? (dir === -1 ? '↓' : '↑') : ''}
              </button>
              <div style={{ textAlign: 'right', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>7D</div>
            </div>
          )}

          {sorted.map(function(c, i) {
            var positive = (c.price_change_percentage_24h || 0) >= 0;
            var sparkData = c.sparkline_in_7d ? c.sparkline_in_7d.price : [];

            if (isMobile) {
              return (
                <div key={c.id}
                  onClick={function() { onSelectCoin && onSelectCoin(c); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px',
                    borderBottom: '1px solid rgba(255,255,255,.025)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ color: C.muted, fontSize: 11, width: 20, flexShrink: 0, textAlign: 'center' }}>{i + 1}</div>
                  {c.image ? (
                    <img src={c.image} alt={c.symbol} style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                      {c.symbol && c.symbol.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.symbol && c.symbol.toUpperCase()}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{fmt(c.current_price)}</div>
                    <div style={{ fontSize: 12, color: positive ? C.green : C.red, marginTop: 2, fontWeight: 600 }}>
                      {pct(c.price_change_percentage_24h)}
                    </div>
                  </div>
                  <SparkLine data={sparkData.filter(function(_, i) { return i % 8 === 0; })} positive={positive} />
                </div>
              );
            }

            return (
              <div key={c.id}
                onClick={function() { onSelectCoin && onSelectCoin(c); }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr 110px 80px 110px 90px',
                  gap: 8, padding: '13px 16px',
                  borderBottom: '1px solid rgba(255,255,255,.025)',
                  cursor: 'pointer', alignItems: 'center',
                }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ color: C.muted, fontSize: 11 }}>{i + 1}</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {c.image ? (
                    <img src={c.image} alt={c.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                      {c.symbol && c.symbol.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{c.symbol && c.symbol.toUpperCase()}</div>
                  </div>
                </div>

                <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, textAlign: 'right' }}>
                  {fmt(c.current_price)}
                </div>

                <div style={{ fontSize: 12, color: positive ? C.green : C.red, textAlign: 'right', fontWeight: 600 }}>
                  {pct(c.price_change_percentage_24h)}
                </div>

                <div style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>
                  {fmt(c.market_cap)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <SparkLine data={sparkData.filter(function(_, i) { return i % 8 === 0; })} positive={positive} />
                </div>
              </div>
            );
          })}

          {sorted.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No coins found matching your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
