import React from ‘react’;
import { useWallet } from ‘@solana/wallet-adapter-react’;
import { WalletMultiButton } from ‘@solana/wallet-adapter-react-ui’;

const C = {
card: ‘#080d1a’, card2: ‘#0c1220’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
};

export default function Portfolio({ coins }) {
const { publicKey, connected } = useWallet();

return (
<div style={{ animation: ‘fadeUp .35s ease’ }}>
<div style={{ marginBottom: 24 }}>
<h1 style={{ fontSize: 26, fontWeight: 800, color: ‘#fff’, letterSpacing: .5 }}>Portfolio</h1>
<p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Track your holdings, P&L, and swap history</p>
</div>

```
  {!connected ? (
    <div style={{
      textAlign: 'center', padding: '80px 40px',
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 22
    }}>
      <div style={{ fontSize: 54, marginBottom: 20 }}>🔐</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
      <p style={{ color: C.muted, fontSize: 14, maxWidth: 360, margin: '0 auto 28px', lineHeight: 1.6 }}>
        Link Phantom, Backpack, Solflare, or any Solana wallet to view your real-time portfolio and swap history.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
        {[['🟣', 'Phantom'], ['🎒', 'Backpack'], ['🔥', 'Solflare'], ['💙', 'Coinbase']].map(([ic, n]) => (
          <div key={n} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: C.card2, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 16px',
          }}>
            <span style={{ fontSize: 18 }}>{ic}</span>
            <span style={{ fontSize: 13, color: C.text, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>{n}</span>
          </div>
        ))}
      </div>
      <WalletMultiButton style={{
        background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
        border: 'none', borderRadius: 12, padding: '14px 40px',
        color: '#03060f', fontFamily: "'Syne', sans-serif",
        fontWeight: 800, fontSize: 15, cursor: 'pointer',
        boxShadow: '0 0 32px rgba(0,229,255,.3)', letterSpacing: .5, height: 'auto',
      }} />
    </div>
  ) : (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[
          ['Total Value', '$0.00', C.accent],
          ['24H P&L', '+$0.00', C.green],
          ['All-Time P&L', '$0.00', C.muted],
          ['Assets', '0', C.text],
        ].map(([k, v, color]) => (
          <div key={k} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: .8 }}>{k}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color, fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Connected wallet */}
      <div style={{
        background: C.card, border: '1px solid rgba(0,255,163,.15)',
        borderRadius: 14, padding: 18, marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 14
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(0,255,163,.08)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 22
        }}>👛</div>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>Connected Wallet</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: C.green, fontWeight: 500 }}>
            {publicKey?.toString().slice(0, 20)}...{publicKey?.toString().slice(-8)}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span style={{
            fontSize: 10, color: '#9945ff', background: 'rgba(153,69,255,.1)',
            border: '1px solid rgba(153,69,255,.3)', borderRadius: 4,
            padding: '2px 7px', letterSpacing: .8, fontWeight: 600
          }}>SOLANA MAINNET</span>
        </div>
      </div>

      {/* Empty state */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 18, padding: '56px 40px', textAlign: 'center'
      }}>
        <div style={{ fontSize: 42, marginBottom: 14 }}>📊</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 8 }}>No Holdings Detected</h3>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          Your wallet appears to have no tracked assets.<br />Start by buying or swapping crypto.
        </p>
        <p style={{ fontSize: 12, color: C.muted2 }}>
          Full on-chain portfolio tracking coming soon — will auto-detect all SPL tokens in your wallet.
        </p>
      </div>
    </div>
  )}
</div>
```

);
}