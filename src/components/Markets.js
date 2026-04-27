import React, { useState } from ‘react’;
import { LineChart, Line, ResponsiveContainer } from ‘recharts’;

const C = {
card: ‘#080d1a’, card2: ‘#0c1220’,
border: ‘rgba(0,229,255,0.10)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’,
};

const fmt = (n, d = 2) => {
if (n == null) return ‘—’;
if (n >= 1e9) return ‘$’ + (n / 1e9).toFixed(2) + ‘B’;
if (n >= 1e6) return ‘$’ + (n / 1e6).toFixed(2) + ‘M’;
if (n >= 1000) return ‘$’ + n.toLocaleString(‘en-US’, { maximumFractionDigits: d });
if (n >= 1) return ‘$’ + n.toFixed(d);
return ‘$’ + n.toFixed(6);
};

const pct = n => !n && n !== 0 ? ‘—’ : (n > 0 ? ‘+’ : ‘’) + n.toFixed(2) + ‘%’;

function Spinner() {
return <div style={{ width: 36, height: 36, borderRadius: ‘50%’, border: ‘2px solid rgba(0,229,255,.15)’, borderTop: ‘2px solid #00e5ff’, animation: ‘spin .8s linear infinite’, margin: ‘0 auto’ }} />;
}

export default function Markets({ coins, loading, onSelectCoin }) {
const [sort, setSort] = useState(‘market_cap’);
const [dir, setDir] = useState(-1);

const sorted = […coins].sort((a, b) => dir * ((a[sort] || 0) - (b[sort] || 0)));

const handleSort = (key) => {
if (sort === key) setDir(d => -d);
else { setSort(key); setDir(-1); }
};

return (
<div style={{ animation: ‘fadeUp .35s ease’ }}>
<div style={{ display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘flex-end’, marginBottom: 24 }}>
<div>
<h1 style={{ fontSize: 26, fontWeight: 800, color: ‘#fff’, letterSpacing: .5 }}>Live Markets</h1>
<p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Real-time data · Auto-refreshes every 30s</p>
</div>
<div style={{ display: ‘flex’, gap: 8 }}>
{[‘SOLANA’, ‘ETHEREUM’, ‘MULTI-CHAIN’].map(l => (
<span key={l} style={{
fontSize: 10, color: C.accent, background: ‘rgba(0,229,255,.07)’,
border: ‘1px solid rgba(0,229,255,.2)’, borderRadius: 4,
padding: ‘2px 7px’, letterSpacing: .8, fontWeight: 600
}}>{l}</span>
))}
</div>
</div>

```
  {loading ? (
    <div style={{ textAlign: 'center', padding: 80 }}>
      <Spinner />
      <p style={{ color: C.muted, marginTop: 16, fontSize: 13 }}>Fetching live prices…</p>
    </div>
  ) : (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr .9fr 1.3fr 1.4fr 110px',
        gap: 12, padding: '13px 24px',
        borderBottom: '1px solid rgba(0,229,255,.06)',
        fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1,
      }}>
        {[['#', null], ['NAME', null], ['PRICE', 'current_price'], ['1H %', 'price_change_percentage_1h_in_currency'], ['24H %', 'price_change_percentage_24h'], ['7D %', 'price_change_percentage_7d_in_currency'], ['VOLUME', 'total_volume'], ['MKT CAP', 'market_cap'], ['7D CHART', null]].map(([label, key]) => (
          <div
            key={label}
            onClick={() => key && handleSort(key)}
            style={{ cursor: key ? 'pointer' : 'default', userSelect: 'none' }}
          >
            {label} {key && sort === key ? (dir === -1 ? '↓' : '↑') : ''}
          </div>
        ))}
      </div>

      {/* Rows */}
      {sorted.map((c, i) => {
        const sp = c.sparkline_in_7d?.price || [];
        const pos = sp.length > 1 && sp[sp.length - 1] > sp[0];
        const spPts = sp.filter((_, j) => j % 24 === 0).map((p, j) => ({ p, j }));

        return (
          <div
            key={c.id}
            onClick={() => onSelectCoin && onSelectCoin(c.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr .9fr 1.3fr 1.4fr 110px',
              gap: 12, padding: '15px 24px',
              borderBottom: '1px solid rgba(255,255,255,.025)',
              cursor: 'pointer', alignItems: 'center', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.03)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ color: C.muted, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: C.accent,
              }}>{c.symbol?.charAt(0)?.toUpperCase()}</div>
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: '#fff' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>{c.symbol?.toUpperCase()}</div>
              </div>
            </div>

            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: '#fff', fontSize: 14 }}>
              {fmt(c.current_price)}
            </div>

            {[c.price_change_percentage_1h_in_currency, c.price_change_percentage_24h, c.price_change_percentage_7d_in_currency].map((v, idx) => (
              <div key={idx} style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                color: (v || 0) >= 0 ? C.green : C.red
              }}>{pct(v)}</div>
            ))}

            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.muted }}>{fmt(c.total_volume)}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.muted }}>{fmt(c.market_cap)}</div>

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
```

);
}