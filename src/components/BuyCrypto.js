import React, { useState } from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3',
  text: '#cdd6f4', muted: '#586994',
};

export default function BuyCrypto({ coins, walletAddress, selectedCoinSymbol }) {
  const [provider, setProvider] = useState('transak');
  const [amount, setAmount] = useState('100');
  const [currency, setCurrency] = useState('USD');

  var symbol = selectedCoinSymbol || 'ETH';
  var addr = walletAddress || '';

  var transakUrl = 'https://global.transak.com/?apiKey=c6d83987-c3b0-4ba9-a43f-c7e8b3f6b7b4' +
    '&defaultCryptoCurrency=' + symbol +
    '&walletAddress=' + addr +
    '&fiatCurrency=' + currency +
    '&defaultFiatAmount=' + amount +
    '&network=solana' +
    '&disableWalletAddressForm=false';

  var moonpayUrl = 'https://buy.moonpay.com?' +
    'apiKey=pk_live_YOUR_MOONPAY_KEY' +
    '&currencyCode=' + symbol.toLowerCase() +
    '&walletAddress=' + addr +
    '&baseCurrencyAmount=' + amount +
    '&baseCurrencyCode=' + currency.toLowerCase();

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Buy crypto with a card or bank transfer</p>
      </div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[['transak', 'Transak'], ['moonpay', 'MoonPay']].map(function(item) {
            return (
              <button key={item[0]} onClick={function() { setProvider(item[0]); }} style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif', background: provider === item[0] ? 'rgba(0,229,255,.1)' : 'transparent', border: '1px solid ' + (provider === item[0] ? 'rgba(0,229,255,.3)' : C.border), color: provider === item[0] ? C.accent : C.muted }}>
                {item[1]}
              </button>
            );
          })}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>AMOUNT</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={amount} onChange={function(e) { setAmount(e.target.value.replace(/[^0-9]/g, '')); }} placeholder="100" style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 16px', color: '#fff', fontSize: 18, fontWeight: 600, outline: 'none' }} />
            <select value={currency} onChange={function(e) { setCurrency(e.target.value); }} style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 10, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none', cursor: 'pointer' }}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[50, 100, 250, 500].map(function(v) {
              return <button key={v} onClick={function() { setAmount(String(v)); }} style={{ flex: 1, padding: '6px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: amount === String(v) ? 'rgba(0,229,255,.1)' : 'transparent', border: '1px solid ' + (amount === String(v) ? 'rgba(0,229,255,.3)' : C.border), color: amount === String(v) ? C.accent : C.muted, fontFamily: 'Syne, sans-serif' }}>${v}</button>;
            })}
          </div>
        </div>
        <div style={{ background: C.card2, border: '1px solid rgba(0,255,163,.1)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700 }}>RECEIVING WALLET</div>
          <div style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
            {addr || 'Connect wallet to auto-fill'}
          </div>
        </div>
        <a href={provider === 'transak' ? transakUrl : moonpayUrl} target="_blank" rel="noreferrer" style={{ display: 'block', width: '100%', padding: 18, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#03060f', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}>
          Buy with {provider === 'transak' ? 'Transak' : 'MoonPay'}
        </a>
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 14, lineHeight: 1.6 }}>
          Powered by {provider === 'transak' ? 'Transak' : 'MoonPay'} - KYC may be required - Rates vary
        </p>
      </div>
    </div>
  );
}
