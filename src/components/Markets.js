import React, { useState } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

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

export default function Markets({ coins, loading, onSelectCoin }) {
  const [sort, setSort] = useState('market_cap');
  const [dir, setDir] = useState(-1);
  const [q, setQ] = useState('');

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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Live Markets</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Real-time data - updates every 30s</p>
        </div>
        <input
          value={q}
          onChange={function(e) { setQ(e.target.value); }}
          placeholder="Search coins..."
          style={{
            background: C.card, border: '1px solid ' + C.border,
            borderRadius: 10, padding: '10px 16px', color: C.text,
            fontFamily: 'Syne, sans-serif', fontSize: 13, outline: 'none', width: 220,
          }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: C.muted }}>Loading markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr .9fr 1.3fr 1.4fr 110px',
            gap: 12, padding: '13px 24px',
            borderBottom: '1px solid rgba(0,229,255,.06)',
            fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1
          }}>
            {[
              ['#', null],
              ['NAME', null],
              ['PRICE', 'current_price'],
              ['1H %', 'price_change_percentage_1h_in_currency'],
              ['24H %', 'price_change_percentage_24h'],
              ['7D %', 'price_change_percentage_7d_in_currency'],
              ['VOLUME', 'total_volume'],
              ['MKT CAP', 'market_cap'],
              ['7D CHART', null],
            ].map(function(item) {
              return (
                <div key={item[0]}
                  onClick={function() { if (item[1]) handleSort(item[1]); }}
                  style={{ cursor: item[1] ? 'pointer' : 'default', userSelect: 'none' }}
                >
                  {item[0]}{item[1] && sort === item[1] ? (dir === -1 ? ' ↓' : ' ↑') : ''}
                </div>
              );
            })}
          </div>

          {sorted.map(function(c, i) {
            var sp = c.sparkline_in_7d ? c.sparkline_in_7d.price : [];
            var pos = sp.length > 1 && sp[sp.length - 1] > sp[0];
            var spPts = sp.filter(function(_, j) { return j % 24 === 0; }).map(function(p, j) { return { p: p, j: j }; });

            return (
              <div key={c.id}
                onClick={function() { if (onSelectCoin) onSelectCoin(c.id); }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr .9fr 1.3fr 1.4fr 110px',
                  gap: 12, padding: '15px 24px',
                  borderBottom: '1px solid rgba(255,255,255,.025)',
                  cursor: 'pointer', alignItems: 'center', transition: 'background .15s',
                }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ color: C.muted, fontSize: 12 }}>{i + 1}</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: C.accent,
                  }}>{c.symbol && c.symbol.charAt(0).toUpperCase()}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{c.symbol && c.symbol.toUpperCase()}</div>
                  </div>
                </div>

                <div style={{ fontWeight: 500, color: '#fff', fontSize: 14 }}>{fmt(c.current_price)}</div>

                {[
                  c.price_change_percentage_1h_in_currency,
                  c.price_change_percentage_24h,
                  c.price_change_percentage_7d_in_currency
                ].map(function(v, idx) {
                  return (
                    <div key={idx} style={{ fontSize: 12, color: (v || 0) >= 0 ? C.green : C.red }}>
                      {pct(v)}
                    </div>
                  );
                })}

                <div style={{ fontSize: 12, color: C.muted }}>{fmt(c.total_volume)}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{fmt(c.market_cap)}</div>

                <div style={{ height: 44 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spPts}>
                      <Line type="monotone" dataKey="p" stroke={pos ? C.green : C.red} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
