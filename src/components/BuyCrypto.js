import React from ‘react’;
import { ONRAMPER_API_KEY } from ‘../config’;

const C = {
card: ‘#080d1a’, card2: ‘#0c1220’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
};

const fmt = (n, d = 2) => {
if (n == null) return ‘—’;
if (n >= 1000) return ‘$’ + n.toLocaleString(‘en-US’, { maximumFractionDigits: d });
if (n >= 1) return ‘$’ + n.toFixed(d);
return ‘$’ + n.toFixed(6);
};

const pct = n => !n && n !== 0 ? ‘—’ : (n > 0 ? ‘+’ : ‘’) + n.toFixed(2) + ‘%’;

export default function BuyCrypto({ coins, walletAddress }) {
const onramperUrl = `https://widget.onramper.com?apiKey=${ONRAMPER_API_KEY || 'pk_prod_01HZGKV5W3VBCRWKG4KXHXB7GE'}&defaultCrypto=SOL&supportSell=false&supportSwap=false${walletAddress ? `&walletAddress=${walletAddress}` : ''}&primaryColor=00e5ff&secondaryColor=080d1a&containerColor=080d1a&cardColor=0c1220&primaryTextColor=cdd6f4&secondaryTextColor=586994&borderRadius=1&wgd=true`;

return (
<div style={{ animation: ‘fadeUp .35s ease’, maxWidth: 780, margin: ‘0 auto’ }}>
<div style={{ textAlign: ‘center’, marginBottom: 32 }}>
<h1 style={{ fontSize: 26, fontWeight: 800, color: ‘#fff’, letterSpacing: .5 }}>Buy Crypto with USD</h1>
<p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>
Powered by Onramper · Visa · Mastercard · Apple Pay · Google Pay · Bank Transfer
</p>
{walletAddress && (
<p style={{ color: C.accent, fontSize: 12, marginTop: 8, fontFamily: “‘JetBrains Mono’, monospace” }}>
✓ Wallet connected — crypto will be sent directly to your wallet
</p>
)}
</div>

```
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

    {/* Onramper widget */}
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 22, overflow: 'hidden', height: 600,
    }}>
      <iframe
        src={onramperUrl}
        title="Buy Crypto"
        height="600"
        width="100%"
        style={{ border: 'none', display: 'block' }}
        allow="accelerometer; autoplay; camera; gyroscope; payment"
      />
    </div>

    {/* Right panel */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Payment methods */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, fontWeight: 700, letterSpacing: 1 }}>PAYMENT METHODS</div>
        {[
          ['💳', 'Credit & Debit Card', 'Instant'],
          ['🏦', 'Bank Transfer (ACH)', '1-3 days'],
          ['📱', 'Apple Pay', 'Instant'],
          ['🔷', 'Google Pay', 'Instant'],
        ].map(([ic, m, time]) => (
          <div key={m} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)',
          }}>
            <span style={{ fontSize: 20 }}>{ic}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{m}</div>
            </div>
            <span style={{ fontSize: 11, color: C.muted }}>{time}</span>
          </div>
        ))}
      </div>

      {/* Popular coins */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, fontWeight: 700, letterSpacing: 1 }}>POPULAR TO BUY</div>
        {coins.slice(0, 5).map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)',
            cursor: 'pointer',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: C.accent,
            }}>{c.symbol?.charAt(0)?.toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>{c.symbol?.toUpperCase()}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{c.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: C.text }}>{fmt(c.current_price)}</div>
              <div style={{
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                color: (c.price_change_percentage_24h || 0) >= 0 ? C.green : C.red
              }}>{pct(c.price_change_percentage_24h)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div style={{
        background: 'rgba(0,229,255,.04)', border: `1px solid rgba(0,229,255,.1)`,
        borderRadius: 12, padding: 14
      }}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          🔒 <strong style={{ color: C.text }}>Non-custodial</strong> — crypto goes directly to your wallet. Nexus DEX never holds your funds. KYC handled by Onramper per their compliance requirements.
        </p>
      </div>
    </div>
  </div>
</div>
```

);
}