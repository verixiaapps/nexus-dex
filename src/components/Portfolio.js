import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

export default function Portfolio({ coins }) {
  const { publicKey, connected } = useWallet();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Track your holdings and swap history</p>
      </div>
      {!connected ? (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: C.card, border: '1px solid ' + C.border, borderRadius: 22 }}>
          <div style={{ fontSize: 54, marginBottom: 20 }}>🔐</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 14, maxWidth: 360, margin: '0 auto 28px', lineHeight: 1.6 }}>
            Link Phantom or Solflare to view your real-time portfolio.
          </p>
          <WalletMultiButton />
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
            {[['Total Value', '$0.00', C.accent], ['24H P&L', '+$0.00', C.green], ['All-Time P&L', '$0.00', C.muted], ['Assets', '0', C.text]].map(function(item) {
              return (
                <div key={item[0]} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 20 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700 }}>{item[0]}</div>
                  <div style={{ fontSize: 20, color: item[2], fontWeight: 500 }}>{item[1]}</div>
                </div>
              );
            })}
          </div>
          <div style={{ background: C.card, border: '1px solid rgba(0,255,163,.15)', borderRadius: 14, padding: 18, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(0,255,163,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👛</div>
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>Connected Wallet</div>
              <div style={{ fontSize: 13, color: C.green, fontWeight: 500 }}>
                {publicKey ? publicKey.toString().slice(0, 20) + '...' + publicKey.toString().slice(-8) : ''}
              </div>
            </div>
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: '56px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: 42, marginBottom: 14 }}>📊</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 8 }}>No Holdings Detected</h3>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>Start by buying or swapping crypto.</p>
          </div>
        </div>
      )}
    </div>
  );
}
