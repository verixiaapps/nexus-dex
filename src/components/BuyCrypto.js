import React, { useState } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

export default function BuyCrypto({ coins, walletAddress }) {
  const [selectedCoin, setSelectedCoin] = useState('SOL');

  var moonpayUrl = 'https://buy.moonpay.com?defaultCurrencyCode=' + selectedCoin + '&colorCode=%2300e5ff';
  if (walletAddress) moonpayUrl += '&walletAddress=' + walletAddress;

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

  const popularCoins = ['SOL', 'BTC', 'ETH', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE'];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>Buy Crypto with USD</h1>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
        {walletAddress && (
          <p style={{ color: C.accent, fontSize: 12, marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
            Wallet connected - crypto sent directly to your wallet
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {popularCoins.map(function(coin) {
          return (
            <button key={coin} onClick={function() { setSelectedCoin(coin); }} style={{
              padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              fontFamily: 'Syne, sans-serif', cursor: 'pointer',
              background: selectedCoin === coin ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(0,229,255,.05)',
              border: '1px solid ' + (selectedCoin === coin ? 'transparent' : C.border),
              color: selectedCoin === coin ? '#03060f' : C.muted,
              transition: 'all .15s',
            }}>{coin}</button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>

        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden', minHeight: 580 }}>
          <iframe
            src={moonpayUrl}
            title="Buy Crypto with MoonPay"
            height="580"
            width="100%"
            style={{ border: 'none', display: 'block' }}
            allow="accelerometer; autoplay; camera; gyroscope; payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, fontWeight: 700, letterSpacing: 1 }}>PAYMENT METHODS</div>
            {[
              ['Credit and Debit Card', 'Instant'],
              ['Bank Transfer ACH', '1-3 days'],
              ['Apple Pay', 'Instant'],
              ['Google Pay', 'Instant'],
              ['PayPal', 'Instant'],
              ['SEPA Transfer', '1-2 days'],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item[0]}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{item[1]}</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, fontWeight: 700, letterSpacing: 1 }}>LIVE PRICES</div>
            {coins.slice(0, 6).map(function(c) {
              return (
                <div key={c.id}
                  onClick={function() { setSelectedCoin(c.symbol && c.symbol.toUpperCase()); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: selectedCoin === (c.symbol && c.symbol.toUpperCase()) ? 'rgba(0,229,255,.2)' : 'rgba(0,229,255,.1)',
                    border: '1px solid ' + (selectedCoin === (c.symbol && c.symbol.toUpperCase()) ? 'rgba(0,229,255,.5)' : 'rgba(0,229,255,.2)'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: C.accent,
                  }}>{c.symbol && c.symbol.charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>{c.symbol && c.symbol.toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{c.name}</div>
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

          <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', borderRadius: 12, padding: 12 }}>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
              Powered by MoonPay. Non-custodial - crypto goes directly to your wallet. KYC required by MoonPay per compliance requirements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
 