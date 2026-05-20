import React from 'react';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', text: '#cdd6f4', muted: '#586994',
};

// =====================================================================
// Earn — placeholder. Real integration (Sanctum white-label LST) ships
// when REACT_APP_EARN_ENABLED=1 is set in Railway.
// =====================================================================
const EARN_ENABLED = process.env.REACT_APP_EARN_ENABLED === '1';

export default function Earn() {
  if (EARN_ENABLED) {
    // Future: real Earn UI lives here.
    return null;
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'Syne, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(0,229,255,.08)',
          border: '1px solid rgba(0,229,255,.22)', marginBottom: 12,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
          <span style={{ color: C.accent, fontSize: 9, fontWeight: 700, letterSpacing: '.10em' }}>EARN</span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.15 }}>
          Earn yield on SOL
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
          Fully liquid · Withdraw anytime · Non-custodial
        </div>
      </div>

      <div style={{
        background: C.card, border: '1px solid ' + C.border,
        borderRadius: 18, padding: '32px 22px', textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(circle at 50% 0%, rgba(0,229,255,.08), transparent 60%)',
        }} />

        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 999,
            background: 'rgba(0,255,163,.08)',
            border: '1px solid rgba(0,255,163,.25)', marginBottom: 18,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
            <span style={{ color: C.green, fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}>COMING SOON</span>
          </div>

          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', letterSpacing: '-.03em', lineHeight: 1, marginBottom: 8 }}>
            ~7.8% APY
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 22 }}>
            Stake SOL, earn validator rewards + MEV
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            marginBottom: 22, textAlign: 'left',
          }}>
            {[
              ['Non-custodial', 'Your wallet holds your stake'],
              ['Fully liquid',   'Swap or unstake anytime'],
              ['No lockup',      'Yield accrues every epoch'],
              ['No deposit fee', 'You keep the upside'],
            ].map(([title, desc]) => (
              <div key={title} style={{
                background: 'rgba(255,255,255,.02)',
                border: '1px solid rgba(255,255,255,.04)',
                borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>

          <div style={{
            background: 'rgba(0,229,255,.04)',
            border: '1px solid rgba(0,229,255,.15)',
            borderRadius: 10, padding: '10px 14px',
            fontSize: 11, color: C.text, lineHeight: 1.5,
          }}>
            We're building Earn the right way — non-custodial liquid staking,
            powered by Solana's most trusted infrastructure. Launching soon.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 14, letterSpacing: '.04em' }}>
        NON-CUSTODIAL · YOUR KEYS · YOUR YIELD
      </div>
    </div>
  );
}
