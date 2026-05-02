import React from 'react';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3',
  text: '#cdd6f4', muted: '#586994',
};

var PROVIDERS = [
  {
    id: 'transak',
    name: 'Transak',
    description: 'Buy crypto with card, bank transfer or Apple Pay. 170+ countries supported.',
    logo: 'https://assets.transak.com/images/website/transak_logo.png',
    fallbackColor: '#007bff',
    fallbackLetter: 'T',
    url: 'https://global.transak.com/?apiKey=c6d83987-c3b0-4ba9-a43f-c7e8b3f6b7b4',
    badge: '170+ countries',
  },
  {
    id: 'moonpay',
    name: 'MoonPay',
    description: 'Buy and sell crypto instantly with card or bank transfer.',
    logo: 'https://www.moonpay.com/assets/logo/moonpay-logo.svg',
    fallbackColor: '#7b2cf7',
    fallbackLetter: 'M',
    url: 'https://www.moonpay.com/buy',
    badge: '150+ assets',
  },
];

export default function BuyCrypto({ walletAddress }) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Buy Crypto</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Purchase crypto with a card or bank transfer</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PROVIDERS.map(function(provider) {
          return (
            <div key={provider.id} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Logo + badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: provider.fallbackColor + '22', border: '1px solid ' + provider.fallbackColor + '44', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                    <img
                      src={provider.logo}
                      alt={provider.name}
                      style={{ width: 32, height: 32, objectFit: 'contain' }}
                      onError={function(e) {
                        e.target.style.display = 'none';
                        e.target.parentNode.innerHTML = '<span style="font-weight:800;font-size:20px;color:' + provider.fallbackColor + '">' + provider.fallbackLetter + '</span>';
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{provider.name}</div>
                    <div style={{ fontSize: 11, color: C.accent, marginTop: 2 }}>{provider.badge}</div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: 0 }}>{provider.description}</p>

              {/* Wallet address if connected */}
              {walletAddress && (
                <div style={{ background: C.card2, border: '1px solid rgba(0,255,163,.1)', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 4 }}>YOUR WALLET</div>
                  <div style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', wordBreak: 'break-all' }}>{walletAddress}</div>
                </div>
              )}

              {/* CTA */}
              <a
                href={provider.url}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block', width: '100%', padding: '16px', borderRadius: 14, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#03060f', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
              >
                Buy with {provider.name} →
              </a>
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 20, lineHeight: 1.6 }}>
        KYC may be required · Rates set by provider · Nexus DEX is not affiliated
      </p>
    </div>
  );
}
