import React, { useState } from 'react';
import PerpsTrade from './PerpsTrade.jsx';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const topPairs = ['ETH-PERP', 'BTC-PERP', 'SOL-PERP', 'ARB-PERP', 'OP-PERP'];

export default function PerpsLanding({ onConnectWallet }) {
  const [mode, setMode] = useState('landing');

  if (mode === 'trade') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', fontFamily: 'Syne, sans-serif' }}>
        <button onClick={() => setMode('landing')}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 20, padding: 0, fontFamily: 'Syne, sans-serif' }}>
          ← Back to Perps
        </button>
        <PerpsTrade onConnectWallet={onConnectWallet} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px', fontFamily: 'Syne, sans-serif', color: C.text, background: C.bg, minHeight: '100vh' }}>
      
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 42, fontWeight: 800, color: '#fff', margin: 0 }}>
          Nexus Perps <span style={{ color: C.accent }}>Beta</span>
        </h1>
        <p style={{ fontSize: 18, color: C.muted, marginTop: 8 }}>
          Trade crypto with up to 50x leverage. Deep liquidity. Cute interface.
        </p>
        <button onClick={() => setMode('trade')}
          style={{
            marginTop: 24, padding: '16px 40px', borderRadius: 16, border: 'none',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontSize: 18, fontWeight: 800, cursor: 'pointer', fontFamily: 'Syne, sans-serif'
          }}>
          Start Trading
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 48 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Fee', value: '0.13%' },
          { label: 'Settlement', value: 'USDC' },
        ].map(stat => (
          <div key={stat.label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{stat.value}</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 20, textAlign: 'center' }}>
          How it <span style={{ color: C.accent }}>Works</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[
            { step: '1', title: 'Connect Wallet', desc: 'Link your Solana or EVM wallet in one click.' },
            { step: '2', title: 'Deposit USDC', desc: 'Fund your account with USDC on any supported chain.' },
            { step: '3', title: 'Pick a Pair', desc: 'Choose from top perps pairs like ETH, BTC, SOL.' },
            { step: '4', title: 'Go Long or Short', desc: 'Set your leverage, confirm, and you\'re trading.' },
          ].map(item => (
            <div key={item.step} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,229,255,.15)', color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, margin: '0 auto 12px' }}>{item.step}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trending pairs */}
      <div style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 20, textAlign: 'center' }}>
          Trending <span style={{ color: C.accent }}>Pairs</span>
        </h2>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {topPairs.map(pair => (
            <div key={pair} onClick={() => setMode('trade')} style={{
              background: C.card, border: '1px solid ' + C.border, borderRadius: 12,
              padding: '12px 24px', cursor: 'pointer',
              fontWeight: 700, fontSize: 14, color: C.text
            }}>
              {pair}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(0,85,255,0.04) 100%)',
        border: '1px solid ' + C.borderHi, borderRadius: 24, padding: 40, textAlign: 'center'
      }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Ready to trade?</h2>
        <p style={{ fontSize: 16, color: C.muted, marginBottom: 24 }}>
          No KYC. No gas wars. Just perps.
        </p>
        <button onClick={() => setMode('trade')}
          style={{
            padding: '16px 40px', borderRadius: 16, border: 'none',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontSize: 18, fontWeight: 800, cursor: 'pointer', fontFamily: 'Syne, sans-serif'
          }}>
          Start Trading
        </button>
      </div>
    </div>
  );
}