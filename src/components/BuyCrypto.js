import React from 'react';

const C = {
  card: '#080d1a',
  border: 'rgba(0,229,255,0.10)',
  muted: '#586994',
};

export default function BuyCrypto({ walletAddress, selectedCoinSymbol }) {
  var coin = selectedCoinSymbol ? selectedCoinSymbol.toUpperCase() : 'SOL';
  var url = 'https://global.transak.com' +
    '?defaultCryptoCurrency=' + coin +
    '&themeColor=00e5ff' +
    '&colorMode=DARK';
  if (walletAddress) url += '&walletAddress=' + encodeURIComponent(walletAddress);

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
      </div>
      <div style={{
        borderRadius: 18,
        overflow: 'hidden',
        border: '1px solid ' + C.border,
        height: 'calc(100vh - 200px)',
        minHeight: 600,
        background: C.card,
      }}>
        <iframe
          src={url}
          title="Buy Crypto"
          width="100%"
          height="100%"
          style={{ border: 'none', display: 'block' }}
          allow="accelerometer; autoplay; camera; gyroscope; payment; microphone; clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
