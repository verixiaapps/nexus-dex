The file is full of curly smart quotes (' ') throughout — every string. Here it is with all quotes replaced with straight ASCII quotes:

import React from 'react';

const C = {
  card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', muted: '#586994', text: '#cdd6f4',
};

export default function BuyCrypto({ walletAddress, selectedCoinSymbol }) {
  const coin = selectedCoinSymbol ? selectedCoinSymbol.toUpperCase() : 'SOL';
  let url = 'https://global.transak.com?defaultCryptoCurrency=' + coin;
  if (walletAddress) url += '&walletAddress=' + encodeURIComponent(walletAddress);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Visa, Mastercard, Apple Pay, Google Pay, Bank Transfer</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {walletAddress && (
          <div style={{ background: 'rgba(0,255,163,.05)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, fontWeight: 700 }}>YOUR WALLET -- AUTO FILLED</div>
            <div style={{ fontSize: 11, color: '#00ffa3', fontFamily: 'monospace', wordBreak: 'break-all' }}>{walletAddress}</div>
          </div>
        )}

        {/* Transak */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Transak</div>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Buy SOL, BTC, ETH and 100+ crypto with card or bank transfer. Trusted by 5M+ users.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              {['Visa', 'Mastercard', 'Apple Pay', 'Google Pay', 'Bank Transfer'].map(method => (
                <div key={method} style={{ background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: C.accent, fontWeight: 600 }}>{method}</div>
              ))}
            </div>
            <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', width: '100%', padding: 15, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', borderRadius: 12, color: '#03060f', fontWeight: 800, fontSize: 15, textAlign: 'center', textDecoration: 'none', fontFamily: 'Syne, sans-serif' }}>
              Buy with Transak
            </a>
            <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 10 }}>KYC handled by Transak</p>
          </div>
        </div>

        {/* MoonPay */}
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6 }}>MoonPay</div>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Buy crypto instantly with card, Apple Pay or bank transfer. Available in 160+ countries.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              {['Visa', 'Mastercard', 'Apple Pay', 'Google Pay', 'Bank Transfer'].map(method => (
                <div key={method} style={{ background: 'rgba(100,60,255,.08)', border: '1px solid rgba(100,60,255,.2)', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>{method}</div>
              ))}
            </div>
            <a
              href={'https://buy.moonpay.com?currencyCode=' + coin + (walletAddress ? '&walletAddress=' + encodeURIComponent(walletAddress) : '')}
              target="_blank" rel="noreferrer"
              style={{ display: 'block', width: '100%', padding: 15, background: 'linear-gradient(135deg,#6b3fff,#a855f7)', borderRadius: 12, color: '#fff', fontWeight: 800, fontSize: 15, textAlign: 'center', textDecoration: 'none', fontFamily: 'Syne, sans-serif' }}
            >Buy with MoonPay</a>
            <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 10 }}>KYC handled by MoonPay</p>
          </div>
        </div>
      </div>
    </div>
  );
}
