import React, { useState, useEffect } from 'react';

const C = {
  card: '#080d1a',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff',
  muted: '#586994',
};

export default function BuyCrypto({ coins, walletAddress, selectedCoinSymbol }) {
  const [selectedCoin, setSelectedCoin] = useState(selectedCoinSymbol || 'SOL');

  useEffect(function() {
    if (selectedCoinSymbol) setSelectedCoin(selectedCoinSymbol.toUpperCase());
  }, [selectedCoinSymbol]);

  var moonpayUrl = 'https://buy.moonpay.com?defaultCurrencyCode=' + selectedCoin.toLowerCase() + '&colorCode=%2300e5ff&theme=dark';
  if (walletAddress) moonpayUrl += '&walletAddress=' + walletAddress;

  const COINS = ['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'LINK'];

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer
        </p>
        {walletAddress && (
          <p style={{ color: C.accent, fontSize: 11, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            Wallet connected — crypto sent directly to your wallet
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {COINS.map(function(sym) {
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

      <div style={{
        background: C.card, border: '1px solid ' + C.border,
        borderRadius: 18, overflow: 'hidden',
        height: 'calc(100vh - 280px)', minHeight: 500,
      }}>
        <iframe
          key={moonpayUrl}
          src={moonpayUrl}
          title="Buy Crypto with MoonPay"
          width="100%"
          height="100%"
          style={{ border: 'none', display: 'block' }}
          allow="accelerometer; autoplay; camera; gyroscope; payment"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
        />
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        Powered by MoonPay · Non-custodial · KYC handled by MoonPay
      </p>
    </div>
  );
}
