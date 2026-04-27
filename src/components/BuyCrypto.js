import React from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

export default function BuyCrypto({ coins, walletAddress }) {
  var apiKey = process.env.REACT_APP_ONRAMPER_API_KEY || 'pk_prod_01HZGKV5W3VBCRWKG4KXHXB7GE';
  var url = 'https://widget.onramper.com?apiKey=' + apiKey + '&defaultCrypto=SOL&primaryColor=00e5ff&containerColor=080d1a&cardColor=0c1220&primaryTextColor=cdd6f4';
  if (walletAddress) url += '&walletAddress=' + walletAddress;

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Buy Crypto with USD</h1>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 22, overflow: 'hidden', height: 600 }}>
          <iframe src={url} title="Buy Crypto" height="600" width="100%" style={{ border: 'none', display: 'block' }} allow="accelerometer; autoplay; camera; gyroscope; payment" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, fontWeight: 700, letterSpacing: 1 }}>PAYMENT METHODS</div>
            {[['Credit and Debit Card', 'Instant'], ['Bank Transfer ACH', '1-3 days'], ['Apple Pay', 'Instant'], ['Google Pay', 'Instant']].map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item[0]}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{item[1]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', borderRadius: 12, padding: 14 }}>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              Non-custodial - crypto goes directly to your wallet. KYC handled by Onramper.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
