import React, { useState, useEffect } from 'react';
import PerpsTrade from './PerpsTrade.js';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const RESTRICTED = [
  'United States',
  'Canada',
  'United Kingdom',
  'OFAC/Sanctioned Jurisdictions (Iran, North Korea, Syria, Cuba, Venezuela, Russia, Crimea, Sudan, Myanmar)',
  'Any country restricted by Hyperliquid or OKX',
];

const LS_KEY = 'nexus_perps_accepted';

export default function PerpsLanding({ onConnectWallet }) {
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY) === '1') setAccepted(true);
    } catch {}
  }, []);

  const handleAccept = () => {
    try { localStorage.setItem(LS_KEY, '1'); } catch {}
    setAccepted(true);
  };

  const handleDecline = () => {
    window.history.back();
  };

  if (!accepted) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', width: '100%', fontFamily: 'Syne, sans-serif', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
        <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,149,0,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚠️</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#fff' }}>Restricted Access</div>
          </div>

          <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
            Perpetuals trading on Nexus DEX is <strong style={{ color: C.red }}>not available</strong> to residents, citizens, or persons located in:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {RESTRICTED.map(c => (
              <div key={c} style={{ fontSize: 13, color: C.text, padding: '10px 14px', background: C.bg, borderRadius: 10, border: '1px solid ' + C.border }}>
                {c}
              </div>
            ))}
          </div>

          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, marginBottom: 20 }}>
            By clicking <strong>"I Confirm &amp; Continue"</strong> you represent that you are <strong style={{ color: C.green }}>not</strong> located in, a citizen of, or a resident of any restricted jurisdiction listed above.
          </div>

          <button onClick={handleAccept} style={{
            width: '100%', padding: 16, borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg,
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: 'pointer',
            marginBottom: 10,
          }}>I Confirm &amp; Continue</button>

          <button onClick={handleDecline} style={{
            width: '100%', padding: 14, borderRadius: 14,
            background: 'transparent', border: '1px solid ' + C.border,
            color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600,
            fontSize: 14, cursor: 'pointer',
          }}>I Don't Qualify — Go Back</button>
        </div>
      </div>
    );
  }

  return <PerpsTrade onConnectWallet={onConnectWallet} />;
}