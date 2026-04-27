import React, { useState } from 'react';
 
const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

export default function BuyCrypto({ coins, walletAddress }) {
  const [provider, setProvider] = useState('moonpay');

  var moonpayUrl = 'https://buy.moonpay.com?apiKey=pk_live_your_key&colorCode=%2300e5ff&defaultCurrencyCode=SOL';
  if (walletAddress) moonpayUrl += '&walletAddress=' + walletAddress;

  var onramperUrl = 'https://widget.onramper.com?apiKey=' + (process.env.REACT_APP_ONRAMPER_API_KEY || 'pk_prod_01HZGKV5W3VBCRWKG4KXHXB7GE') + '&defaultCrypto=SOL&primaryColor=00e5ff&containerColor=080d1a&cardColor=0c1220&primaryTextColor=cdd6f4';
  if (walletAddress) onramperUrl += '&walletAddress=' + walletAddress;

  var widgetUrl = provider === 'moonpay' ? moonpayUrl : onramperUrl;

  function fmtPrice(n) {
    if (!n) return '--';
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(6);
  }

  function fmtPct(n) {
    if (!n && n !== 0) return '--';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Buy Crypto with USD</h1>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
        {walletAddress && (
          <p style={{ color: C.accent, fontSize: 12, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>
            Wallet connected - crypto sent directly to your wallet
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
        {[['moonpay', 'MoonPay'], ['onramper', 'Onramper']].map(function(item) {
          return (
            <button key={item[0]} onClick={function() { setProvider(item[0]); }} style={{
              padding: '10px 28px', borderRadius: 10, fontSize: 14, fontWeight: 700,
              fontFamily: 'Syne, sans-serif', cursor: 'pointer',
              background: provider === item[0] ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'transparent',
              border: '1px solid ' + (provider === item[0] ? 'transparent' : C.border),
              color: provider === item[0] ? '#03060f' : C.muted,
              transition: 'all .15s',
            }}>{item[1]}</button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>

        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 22, overflow: 'hidden', height: 600 }}>
          <iframe
            src={widgetUrl}
            title="Buy Crypto"
            height="600"
            width="100%"
            style={{ border: 'none', display: 'block' }}
            allow="accelerometer; autoplay; camera; gyroscope; payment"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, fontWeight: 700, letterSpacing: 1 }}>PAYMENT METHODS</div>
            {[
              ['Credit and Debit Card', 'Instant'],
              ['Bank Transfer ACH', '1-3 days'],
              ['Apple Pay', 'Instant'],
              ['Google Pay', 'Instant'],
              ['PayPal', 'Instant'],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item[0]}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{item[1]}</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, fontWeight: 700, letterSpacing: 1 }}>POPULAR TO BUY</div>
            {coins.slice(0, 6).map(function(c) {
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: C.accent,
                  }}>{c.symbol && c.symbol.charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>{c.symbol && c.symbol.toUpperCase()}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{c.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: C.text }}>{fmtPrice(c.current_price)}</div>
                    <div style={{ fontSize: 10, color: (c.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                      {fmtPct(c.price_change_percentage_24h)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', borderRadius: 12, padding: 14 }}>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              Non-custodial - crypto goes directly to your wallet. KYC handled by provider per their compliance requirements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
