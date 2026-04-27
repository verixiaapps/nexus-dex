import React, { useState, useEffect } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

function fmt(n) {
  if (!n) return '--';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '--';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

const SUPPORTED = ['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'LINK', 'DOT', 'NEAR', 'ATOM'];

export default function BuyCrypto({ coins, walletAddress, selectedCoinSymbol }) {
  const [selectedCoin, setSelectedCoin] = useState(selectedCoinSymbol || 'SOL');

  useEffect(function() {
    if (selectedCoinSymbol) setSelectedCoin(selectedCoinSymbol.toUpperCase());
  }, [selectedCoinSymbol]);

  var moonpayUrl = 'https://buy.moonpay.com?defaultCurrencyCode=' + selectedCoin.toLowerCase() + '&colorCode=%2300e5ff&theme=dark';
  if (walletAddress) moonpayUrl += '&walletAddress=' + walletAddress;

  var displayCoins = coins.filter(function(c) {
    return SUPPORTED.includes(c.symbol && c.symbol.toUpperCase());
  }).slice(0, 12);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>Buy Crypto with USD</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
        {walletAddress && (
          <p style={{ color: C.accent, fontSize: 11, marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
            Connected - crypto sent directly to your wallet
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {SUPPORTED.map(function(sym) {
          return (
            <button key={sym} onClick={function() { setSelectedCoin(sym); }} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              fontFamily: 'Syne, sans-serif', cursor: 'pointer',
              background: selectedCoin === sym ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(0,229,255,.05)',
              border: '1px solid ' + (selectedCoin === sym ? 'transparent' : C.border),
              color: selectedCoin === sym ? '#03060f' : C.muted,
              transition: 'all .15s',
            }}>{sym}</button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, alignItems: 'start' }}>

        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, overflow: 'hidden', minHeight: 560 }}>
          <iframe
            key={moonpayUrl}
            src={moonpayUrl}
            title="Buy Crypto with MoonPay"
            height="560"
            width="100%"
            style={{ border: 'none', display: 'block' }}
            allow="accelerometer; autoplay; camera; gyroscope; payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 12, fontWeight: 700, letterSpacing: 1 }}>PAYMENT METHODS</div>
            {[
              ['Credit/Debit Card', 'Instant'],
              ['Apple Pay', 'Instant'],
              ['Google Pay', 'Instant'],
              ['Bank Transfer', '1-3 days'],
              ['PayPal', 'Instant'],
              ['SEPA', '1-2 days'],
            ].map(function(item) {
              return (
                <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{item[0]}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{item[1]}</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 12, fontWeight: 700, letterSpacing: 1 }}>LIVE PRICES</div>
            {displayCoins.map(function(c) {
              return (
                <div key={c.id}
                  onClick={function() { setSelectedCoin(c.symbol && c.symbol.toUpperCase()); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.04)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  {c.image ? (
                    <img src={c.image} alt={c.symbol} style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                      {c.symbol && c.symbol.charAt(0)}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>{c.symbol && c.symbol.toUpperCase()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: C.text }}>{fmt(c.current_price)}</div>
                    <div style={{ fontSize: 10, color: (c.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
                      {pct(c.price_change_percentage_24h)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.1)', borderRadius: 10, padding: 12 }}>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
              Powered by MoonPay. Non-custodial. KYC required by MoonPay per compliance rules.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
