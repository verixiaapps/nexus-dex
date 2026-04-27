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
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Live Markets</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Real-time data - updates every 30s</p>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: C.muted }}>Loading markets...</div>
      ) : (
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr 1.3fr 1.4fr 110px', gap: 12, padding: '13px 24px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>
            {['#', 'NAME', 'PRICE', '24H %', '7D %', 'VOLUME', 'MKT CAP', '7D'].map(function(h) { return <div key={h}>{h}</div>; })}
          </div>
          {coins.map(function(c, i) {
            var sp = c.sparkline_in_7d ? c.sparkline_in_7d.price : [];
            var pos = sp.length > 1 && sp[sp.length - 1] > sp[0];
            var spPts = sp.filter(function(_, j) { return j % 24 === 0; }).map(function(p, j) { return { p: p, j: j }; });
            return (
              <div key={c.id} onClick={function() { onSelectCoin && onSelectCoin(c.id); }}
                style={{ display: 'grid', gridTemplateColumns: '44px 2fr 1.4fr .9fr .9fr 1.3fr 1.4fr 110px', gap: 12, padding: '15px 24px', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ color: C.muted, fontSize: 12 }}>{i + 1}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: C.accent }}>
                    {c.symbol && c.symbol.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{c.symbol && c.symbol.toUpperCase()}</div>
                  </div>
                </div>
                <div style={{ fontWeight: 500, color: '#fff', fontSize: 14 }}>{fmt(c.current_price)}</div>
                <div style={{ fontSize: 12, color: (c.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>{pct(c.price_change_percentage_24h)}</div>
                <div style={{ fontSize: 12, color: (c.price_change_percentage_7d_in_currency || 0) >= 0 ? C.green : C.red }}>{pct(c.price_change_percentage_7d_in_currency)}</div>
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
