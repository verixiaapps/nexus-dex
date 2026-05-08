import React from 'react';
import PerpsTrade from './PerpsTrade.jsx';

const C = { /* same colors as before */ };

export default function PerpsLanding({ onConnectWallet }) {
  const [mode, setMode] = React.useState('landing');

  if (mode === 'trade') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px' }}>
        <button onClick={() => setMode('landing')}
          style={{ background: 'none', border: 'none', color: '#586994', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 20, fontFamily: 'Syne, sans-serif' }}>
          ← Back to Perps
        </button>
        <PerpsTrade onConnectWallet={onConnectWallet} />
      </div>
    );
  }

  return (
    /* your existing landing page code */
    /* change the "Start Trading" button onClick to: */
    <button onClick={() => setMode('trade')} ...>Start Trading</button>
  );
}