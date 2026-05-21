import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';

const C = {
  ink: '#e6efff', inkStr: '#f5fafe',
  hl: '#97fce4', hlDim: 'rgba(151,252,228,.14)', borderHi: 'rgba(151,252,228,.24)',
  muted: '#7a92b3', violet: '#a87fff',
};

// =====================================================================
// GEO BLOCK + VIP — US users get region screen, non-VIPs get coming-soon.
// Same Cloudflare detection + cache as Predict / PerpsTrade / Stocks.
// =====================================================================
const GEO_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const GEO_BLOCKED = new Set(['US']);

const VIP_WALLETS = new Set([
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

const FONT_IMPORTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@500;600;700&display=swap');@import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');`;

function ComingSoon() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(168,127,255,.08),transparent 50%)',
      fontFamily: "'Clash Display','Syne',system-ui,sans-serif",
    }}>
      <style>{FONT_IMPORTS}</style>
      <div style={{
        width: '100%', maxWidth: 480,
        padding: '54px 28px 50px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(151,252,228,.18)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(151,252,228,.08)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <h1 style={{
            fontSize: 38, lineHeight: 1.0, fontWeight: 600,
            margin: 0, letterSpacing: '-.045em',
            background: 'linear-gradient(135deg,' + C.inkStr + ' 0%,' + C.hl + ' 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Coming soon
          </h1>
        </div>
      </div>
    </div>
  );
}

function RegionBlock() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(168,127,255,.14),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(151,252,228,.08),transparent 50%)',
      fontFamily: "'DM Sans',system-ui,sans-serif",
    }}>
      <style>{FONT_IMPORTS}</style>
      <div style={{
        width: '100%', maxWidth: 480,
        padding: '44px 28px 40px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(168,127,255,.22)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(168,127,255,.10)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 14, background: C.hlDim, border: '1px solid ' + C.borderHi, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: 28, lineHeight: 1.05, fontWeight: 600,
            margin: '0 0 12px', letterSpacing: '-.045em',
            fontFamily: "'Clash Display','Syne',system-ui,sans-serif",
            background: 'linear-gradient(135deg,' + C.inkStr + ' 0%,' + C.violet + ' 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Earn isn't available here
          </h1>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            Yield products are restricted in your region. Swap, VIP, Predict, and Wallet remain fully available.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// VIP placeholder — shown only to the VIP wallet. Replace with the real
// earn UI when ready.
// =====================================================================
function EarnInner() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(168,127,255,.08),transparent 50%)',
      fontFamily: "'Clash Display','Syne',system-ui,sans-serif",
    }}>
      <style>{FONT_IMPORTS}</style>
      <div style={{
        width: '100%', maxWidth: 480,
        padding: '54px 28px 50px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(151,252,228,.18)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(151,252,228,.08)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <h1 style={{
            fontSize: 38, lineHeight: 1.0, fontWeight: 600,
            margin: 0, letterSpacing: '-.045em',
            background: 'linear-gradient(135deg,' + C.inkStr + ' 0%,' + C.hl + ' 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            Earn — VIP
          </h1>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginTop: 16, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
            Yield product wiring in progress.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Gate order:
//   1. Geo block — US blocked unless VIP wallet
//   2. VIP gate — non-VIPs see "Coming Soon"
//   3. VIPs get the earn UI
// =====================================================================
export default function Earn() {
  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  const isVip = !!walletPubkey && VIP_WALLETS.has(walletPubkey);

  const [country, setCountry] = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    if (isVip) { setGeoChecked(true); return; }
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, [isVip]);

  if (!geoChecked) {
    return <ComingSoon/>;
  }

  if (!isVip && country && GEO_BLOCKED.has(country)) {
    return <RegionBlock/>;
  }

  if (!isVip) {
    return <ComingSoon/>;
  }

  return <EarnInner/>;
}
