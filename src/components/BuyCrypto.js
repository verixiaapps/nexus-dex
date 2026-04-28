import React from 'react';

const C = {
  card: '#080d1a',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff',
  muted: '#586994',
  text: '#cdd6f4',
};

export default function BuyCrypto({ walletAddress, selectedCoinSymbol }) {
  var coin = selectedCoinSymbol ? selectedCoinSymbol.toUpperCase() : 'SOL';
  var url = 'https://global.transak.com?defaultCryptoCurrency=' + coin;
  if (walletAddress) url += '&walletAddress=' + encodeURIComponent(walletAddress);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
      </div>

      <div style={{
        background: C.card, border: '1px solid ' + C.border,
        borderRadius: 20, overflow: 'hidden',
      }}>
        <img
          src="https://uploads-ssl.webflow.com/62cd339fcae4d80a6fc1e3f5/63e2c23a44ef520d7c0e1ffd_Transak_preview.png"
          alt="Transak"
          style={{ width: '100%', display: 'block' }}
          onError={function(e) {
            e.target.style.display = 'none';
          }}
        />

        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
            Buy crypto with Transak
          </div>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            Purchase SOL, BTC, ETH and 100+ cryptocurrencies with your card or bank transfer. Powered by Transak — trusted by 5M+ users worldwide.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            {['Visa', 'Mastercard', 'Apple Pay', 'Google Pay', 'Bank Transfer'].map(function(method) {
              return (
                <div key={method} style={{
                  background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, color: C.accent, fontWeight: 600,
                }}>{method}</div>
              );
            })}
          </div>

          {walletAddress && (
            <div style={{
              background: 'rgba(0,255,163,.05)', border: '1px solid rgba(0,255,163,.15)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700 }}>YOUR WALLET — AUTO FILLED</div>
              <div style={{ fontSize: 11, color: '#00ffa3', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                {walletAddress}
              </div>
            </div>
          )}

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block', width: '100%', padding: 16,
              background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
              borderRadius: 12, border: 'none', cursor: 'pointer',
              color: '#03060f', fontWeight: 800, fontSize: 16,
              textAlign: 'center', textDecoration: 'none',
              fontFamily: 'Syne, sans-serif',
            }}>
            Buy Crypto with Transak ↗
          </a>

          <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 12 }}>
            Opens in new tab · Powered by Transak · KYC handled by Transak
          </p>
        </div>
      </div>
    </div>
  );
}
