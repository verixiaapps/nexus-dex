import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget          from './components/SwapWidget.jsx';
import Stocks              from './components/Stocks.jsx';
import CrossChainSwap      from './components/CrossChainSwap.jsx';
import SolToBtcChainflip   from './components/SolToBtcChainflip.jsx';
import MemeWonderland      from './components/MemeWonderland.jsx';
import LaunchRadar         from './components/LaunchRadar.jsx';
import Ape                 from './components/Ape.jsx';
import Flipsy              from './components/Flipsy.jsx';
import GetStarted          from './components/GetStarted.jsx';
import Holdings            from './components/Holdings.jsx';
import ReferralsPage       from './components/ReferralsPage.jsx';
import WhyNexus            from './components/WhyNexus.jsx';
import AdminPage           from './components/AdminPage.jsx';

// =====================================================================
// Wonderland-light design tokens
// =====================================================================
const C = {
  ink:    '#1A1B4E',
  ink2:   'rgba(26,27,78,0.7)',
  ink3:   'rgba(26,27,78,0.45)',
  cyan:   '#3DD4F5',
  sky:    '#A0E7FF',
  pink:   '#FF8FBE',
  lav:    '#B794F6',
  mint:   '#7FFFD4',
  peach:  '#FFB088',
  gold:   '#FFD46B',
  green:  '#0a7a4c',
  red:    '#D14B6A',
  glass:        'rgba(255,255,255,0.6)',
  glassStrong:  'rgba(255,255,255,0.80)',
  border:       'rgba(61,212,245,0.20)',
  borderHi:     'rgba(61,212,245,0.32)',
  hairline:     'rgba(26,27,78,0.08)',
};

// ═════════════════════════════════════════════════════════════════════
// ADMIN_WALLETS — bypass every page-level gate.
// ═════════════════════════════════════════════════════════════════════
export const ADMIN_WALLETS = new Set([
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

// Private pages — only this wallet can open them.
const APE_ACCESS_WALLET    = 'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA';
const FLIPSY_ACCESS_WALLET = 'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA';

const GLOBAL_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

html, body{
  margin:0; padding:0; width:100%;
  min-height:100vh; min-height:100dvh;
  overflow-x:hidden; overscroll-behavior:none;
  -webkit-text-size-adjust:100%; text-size-adjust:100%;
}
html{ scroll-behavior:smooth; }
body{
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  font-family:'Space Grotesk', -apple-system, system-ui, sans-serif;
  color:${C.ink};
  background:
    radial-gradient(ellipse at 80% 0%, #D9ECFF 0%, transparent 50%),
    radial-gradient(ellipse at 15% 10%, #FFE8F4 0%, transparent 45%),
    radial-gradient(ellipse at 50% 60%, #F0E7FF 0%, transparent 55%),
    radial-gradient(ellipse at 10% 90%, #FFF3D9 0%, transparent 45%),
    linear-gradient(180deg, #FBF5FF 0%, #EEF3FF 100%);
  background-attachment:fixed;
}
body.nexus-scroll-locked{ overflow:hidden !important; }
#root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; }
*,*::before,*::after{ box-sizing:border-box; }
*{ -webkit-tap-highlight-color:transparent; }
button,a,[role="button"]{ touch-action:manipulation; }
input,button,select,textarea{ font-family:'Space Grotesk',sans-serif; font-size:16px; }
input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; }
::-webkit-scrollbar{ width:3px; height:3px; }
::-webkit-scrollbar-track{ background:transparent; }
::-webkit-scrollbar-thumb{ background:rgba(26,27,78,0.18); border-radius:2px; }
.hide-scrollbar{ scrollbar-width:none; }
.hide-scrollbar::-webkit-scrollbar{ display:none; }
.scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
@media(max-width:768px){ .desktop-nav{ display:none !important; } }
@media(min-width:769px){ .mobile-nav{ display:none !important; } }

.nx-fixed-blob{
  position:fixed; border-radius:50%; filter:blur(70px); opacity:0.42;
  animation:nx-drift 14s ease-in-out infinite; pointer-events:none; z-index:0;
}

@keyframes nx-drift{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(20px,-30px) scale(1.05); } }
@keyframes nx-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:0.4; } }
@keyframes nx-spin{ to{ transform:rotate(360deg); } }
@keyframes nx-shimmer{ 0%{ background-position:0% 50%; } 100%{ background-position:200% 50%; } }
@keyframes nx-rise{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:translateY(0); } }
@keyframes nx-ticker{ 0%{ transform:translateY(0); } 100%{ transform:translateY(-50%); } }
@keyframes nx-cta-shine{
  0%,100%{ box-shadow:0 12px 30px rgba(255,143,190,.35), 0 0 0 1px rgba(255,143,190,.30); }
  50%{ box-shadow:0 12px 32px rgba(160,231,255,.45), 0 0 0 1px rgba(160,231,255,.40); }
}
@keyframes nx-modal-up{
  from{ transform:translateX(-50%) translateY(100%); opacity:0; }
  to{ transform:translateX(-50%) translateY(0); opacity:1; }
}
@keyframes nx-chain-glow{
  0%,100%{ box-shadow:0 0 0 0 rgba(61,212,245,.45); }
  50%{ box-shadow:0 0 0 8px rgba(61,212,245,0); }
}
@keyframes nx-hop-flow{
  0%{ left:-4%; opacity:0; }
  10%{ opacity:1; }
  90%{ opacity:1; }
  100%{ left:104%; opacity:0; }
}

.nx-cta-press:active{ transform:translateY(1px); }
.nx-eco-btn{ transition:all .15s; }
.nx-eco-btn:hover{ border-color:${C.borderHi}; transform:translateY(-1px); }
`;

// =====================================================================
// Common ecosystem strip — used at top of Swap + Bridge pages
// (matches the 5 primary nav tabs)
// =====================================================================
function EcoStrip({ active, onGo }) {
  const items = [
    { ic: '⇅',  lbl: 'Swap',    tab: 'swap' },
    { ic: '⚡', lbl: 'Ape',     tab: 'ape' },
    { ic: '✨', lbl: 'Wonder',  tab: 'wonderland' },
    { ic: '📈', lbl: 'Markets', tab: 'markets' },
    { ic: '👜', lbl: 'Bags',    tab: 'holdings' },
  ];
  return (
    <div className="hide-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 0 4px' }}>
      {items.map(e => {
        const isActive = e.tab === active;
        return (
          <button
            key={e.lbl}
            className="nx-eco-btn"
            onClick={() => onGo(e.tab)}
            style={{
              flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              minWidth: 64, padding: '10px 8px', borderRadius: 14, cursor: 'pointer',
              border: '1px solid ' + (isActive ? C.borderHi : C.hairline),
              background: isActive
                ? 'linear-gradient(135deg, rgba(160,231,255,.22), rgba(255,143,190,.22))'
                : C.glassStrong,
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
              fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: isActive ? '0 4px 14px rgba(160,231,255,.25)' : 'none',
            }}
          >
            <span style={{ fontSize: 18 }}>{e.ic}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: isActive ? C.ink : C.ink3,
            }}>{e.lbl}</span>
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// HOMEPAGE — SwapHero (compact, widget-first; widget renders below)
// =====================================================================
function SwapHero({ onStartTrading }) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
      <EcoStrip active="swap" onGo={onStartTrading} />

      <div style={{ padding: '18px 4px 12px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
          color: C.cyan, letterSpacing: '0.16em', marginBottom: 10,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 8px ${C.cyan}`, animation: 'nx-pulse 1.6s infinite' }} />
          POWERED BY JUPITER
        </div>

        <h1 style={{
          fontFamily: "'Instrument Serif', serif", fontWeight: 400,
          fontSize: 'clamp(34px, 9vw, 42px)', lineHeight: 0.95, letterSpacing: '-0.025em',
          margin: '0 0 8px', color: C.ink,
        }}>
          The Solana <em style={{
            fontStyle: 'italic',
            background: 'linear-gradient(120deg, #A0E7FF 0%, #B794F6 50%, #FF8FBE 100%)',
            backgroundSize: '200% 100%',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            animation: 'nx-shimmer 7s linear infinite',
          }}>super-app.</em>
        </h1>

        <p style={{
          color: C.ink2, fontSize: 13, fontWeight: 500, lineHeight: 1.45,
          maxWidth: 340, margin: '0 auto 12px',
        }}>
          Swap, bridge, predict, trade stocks.<br />
          Non-custodial. Your keys.
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '7px 14px', borderRadius: 999,
          background: C.glass, backdropFilter: 'blur(10px)',
          border: `1px solid ${C.border}`,
        }}>
          {['No KYC', 'No Account', 'No Limits'].map((label, i) => (
            <React.Fragment key={label}>
              {i > 0 && <span style={{ color: C.ink3, opacity: 0.5 }}>·</span>}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                color: C.ink, letterSpacing: '0.12em',
              }}>
                <span style={{ color: C.cyan, fontWeight: 800, marginRight: 3 }}>✕</span>
                {label}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px 6px' }}>
        <div style={{
          fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 22, color: C.ink, letterSpacing: '-0.015em', lineHeight: 1,
        }}>Swap</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, color: C.cyan,
          letterSpacing: '0.12em',
          background: 'rgba(61,212,245,.10)', border: `1px solid ${C.border}`,
          padding: '4px 10px', borderRadius: 999,
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 6px ${C.cyan}`, animation: 'nx-pulse 1.6s infinite' }} />LIVE QUOTE
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// HomeBelow — below-the-fold homepage sections.
// EXPANDED card grid: now includes Bridge, Sol→BTC, Radar, Referrals,
// Why Nexus, and (gated to Flipsy access wallet only) Flipsy.
// =====================================================================
function HomeBelow({ onSwitchTab, walletAddress }) {
  const trades = [
    ['SOL → USDC',   '+$1,420', '2s'],
    ['JUP → SOL',    '+$340',   '4s'],
    ['USDC → BONK',  '-$80',    '7s'],
    ['WIF → USDC',   '+$2,180', '11s'],
    ['SOL → JUP',    '+$610',   '13s'],
    ['USDC → ETH',   '+$5,400', '19s'],
    ['TSLAx → USDC', '+$420',   '24s'],
    ['SOL → USDC',   '+$2,950', '31s'],
  ];

  const canSeeFlipsy = walletAddress === FLIPSY_ACCESS_WALLET;

  // Build the card list. Order: primary products first, then utility, then meta.
  const products = [
    { tab: 'wonderland',  icon: '✨', name: 'Wonderland',     desc: 'Meme signal scanner. Catch runners before the herd.',           live: 'TRENDING',  grad: 'linear-gradient(135deg,#B794F6,#FFD46B)' },
    { tab: 'markets',     icon: '📈', name: 'Markets',         desc: 'Tokenized Tesla, Apple, NVIDIA — trade 24/7 in USDC.',          live: '18 STOCKS', grad: 'linear-gradient(135deg,#FF8FBE,#B794F6)' },
    { tab: 'ape',         icon: '⚡', name: 'Ape',             desc: 'Fresh pump.fun launches with burner-wallet one-tap trades.',    live: 'EARLY',     grad: 'linear-gradient(135deg,#FF8FBE,#FFB088)' },
    { tab: 'holdings',    icon: '👜', name: 'Bags',            desc: 'Every token you own. Live prices. Buy SOL with USD.',           live: 'PORTFOLIO', grad: 'linear-gradient(135deg,#A0E7FF,#7FFFD4)' },
    { tab: 'bridge',      icon: '🌉', name: 'Cross-Chain',     desc: 'Move any token across 71 chains. Native, ~2 min.',              live: '71 CHAINS', grad: 'linear-gradient(135deg,#A0E7FF,#B794F6)' },
    { tab: 'solbtc',      icon: '₿',  name: 'SOL → BTC',       desc: 'Swap Solana straight to real Bitcoin on the BTC network.',      live: 'NATIVE',    grad: 'linear-gradient(135deg,#FFD46B,#FFB088)' },
    { tab: 'launchradar', icon: '🚀', name: 'Radar',           desc: 'Every new token, the moment it lands on Solana.',               live: 'FRESH',     grad: 'linear-gradient(135deg,#FFD46B,#FFB088)' },
    { tab: 'referrals',   icon: '§',  name: 'Referrals',       desc: '50% of every fee, on-chain, same block. Forever.',              live: '50% RATE',  grad: 'linear-gradient(135deg,#FF8FBE,#A0E7FF)' },
    { tab: 'why',         icon: '◌',  name: 'Why Nexus',       desc: 'No email, no KYC, no limits. The three things we never do.',   live: 'READ',      grad: 'linear-gradient(135deg,#B794F6,#A0E7FF)' },
  ];

  if (canSeeFlipsy) {
    products.splice(4, 0, {
      tab: 'flipsy', icon: '🎯', name: 'Flipsy',
      desc: 'Predictions market. Currently in development.',
      live: 'BETA · YOU', grad: 'linear-gradient(135deg,#7FFFD4,#A0E7FF)',
    });
  }

  const sectionHead = (title, italic, meta, liveDot = false) => (
    <div style={{ padding: '24px 4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <h2 style={{
        fontFamily: "'Instrument Serif', serif", fontSize: 22, lineHeight: 1, color: C.ink,
        letterSpacing: '-0.015em', fontWeight: 400, margin: 0,
      }}>
        {title} <em style={{
          fontStyle: 'italic',
          background: 'linear-gradient(120deg,#A0E7FF,#FF8FBE)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        }}>{italic}</em>
      </h2>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, color: C.ink3,
        letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        {liveDot && (<span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, marginRight: 5, animation: 'nx-pulse 1.4s infinite', verticalAlign: 'middle' }} />)}
        {meta}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>

      {/* TRUST STRIP */}
      <div style={{
        marginTop: 16, padding: '12px 14px', borderRadius: 14,
        background: C.glass, backdropFilter: 'blur(10px)',
        border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: C.ink2,
        letterSpacing: '0.1em',
      }}>
        <span>Powered by</span>
        <span style={{ color: C.ink, fontWeight: 800 }}>JUPITER</span>
        <span style={{ color: C.ink3, opacity: 0.5 }}>·</span>
        <span style={{ color: C.ink, fontWeight: 800 }}>CHAINALYSIS</span>
      </div>

      {/* LIVE TICKER */}
      {sectionHead('Live', 'swaps', 'UPDATED NOW', true)}
      <div style={{
        padding: 0, borderRadius: 18, overflow: 'hidden',
        background: C.glassStrong, backdropFilter: 'blur(10px)',
        border: `1px solid ${C.border}`,
      }}>
        <div style={{
          height: 140, overflow: 'hidden', position: 'relative',
          maskImage: 'linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)',
          WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)',
        }}>
          <div style={{ animation: 'nx-ticker 24s linear infinite' }}>
            {[...trades, ...trades].map((r, i) => {
              const isIn = r[1].startsWith('+');
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px',
                  borderBottom: `1px solid ${C.hairline}`,
                }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, color: C.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[0]}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, color: isIn ? C.green : '#8c1494', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r[1]}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: C.ink3, fontWeight: 600, flexShrink: 0, minWidth: 36, textAlign: 'right', letterSpacing: '0.4px' }}>{r[2]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* EXPANDED PRODUCT GRID */}
      {sectionHead('All products.', 'One wallet.', 'SUPER-APP')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {products.map((p, i) => (
          <button
            key={p.tab}
            onClick={() => onSwitchTab(p.tab)}
            style={{
              background: C.glassStrong, backdropFilter: 'blur(10px)',
              border: `1px solid rgba(255,255,255,0.85)`, borderRadius: 20,
              padding: 14, textAlign: 'left', cursor: 'pointer',
              fontFamily: 'inherit', color: 'inherit',
              transition: 'transform .15s, box-shadow .15s',
              display: 'flex', flexDirection: 'column', gap: 6,
              animation: `nx-rise .45s cubic-bezier(.2,1,.4,1) ${i * 0.04}s backwards`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(160,231,255,.18)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 11,
              display: 'grid', placeItems: 'center', fontSize: 18,
              marginBottom: 4, background: p.grad,
            }}>{p.icon}</div>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 18, lineHeight: 1,
              color: C.ink, letterSpacing: '-0.01em',
            }}>{p.name}</div>
            <div style={{ fontSize: 11, color: C.ink2, fontWeight: 500, lineHeight: 1.4 }}>{p.desc}</div>
            <span style={{
              marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, color: C.cyan,
              letterSpacing: '0.08em', background: 'rgba(61,212,245,.10)',
              border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 999,
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 5px ${C.cyan}` }} />
              {p.live}
            </span>
          </button>
        ))}
      </div>

      {/* FOOTER TRUST */}
      <div style={{
        marginTop: 18, padding: '14px 16px', borderRadius: 16,
        background: C.glass, border: `1px solid ${C.border}`, backdropFilter: 'blur(10px)',
        textAlign: 'center',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: C.ink2,
        letterSpacing: '0.08em', lineHeight: 1.6,
      }}>
        <b style={{ color: C.ink, fontWeight: 800 }}>Non-custodial.</b> Your keys, your coins.{' '}
        <em style={{
          fontStyle: 'italic',
          background: 'linear-gradient(120deg,#A0E7FF,#FF8FBE)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        }}>Always.</em>
      </div>
    </div>
  );
}

// =====================================================================
// BridgeHero — compact intro for the Bridge page
// =====================================================================
function BridgeHero({ onSwitchTab }) {
  const chains = [
    { sym: '◎', name: 'Solana',    bg: 'linear-gradient(135deg,#9945ff,#14f195)' },
    { sym: 'Ξ', name: 'Ethereum',  bg: 'linear-gradient(135deg,#627eea,#3c4f8c)' },
    { sym: 'B', name: 'Base',      bg: 'linear-gradient(135deg,#0052ff,#3aa0ff)' },
    { sym: '+', name: '+68 More',  bg: 'linear-gradient(135deg,#A0E7FF,#B794F6)' },
  ];

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
      <EcoStrip active="" onGo={onSwitchTab} />

      <div style={{
        marginTop: 14, padding: '18px 16px', borderRadius: 22, position: 'relative', overflow: 'hidden',
        background: C.glassStrong, backdropFilter: 'blur(12px)',
        border: `1px solid ${C.border}`,
        boxShadow: '0 12px 32px rgba(61,212,245,.10)',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(circle at 20% 50%, rgba(160,231,255,.18), transparent 50%), radial-gradient(circle at 80% 50%, rgba(183,148,246,.18), transparent 50%)`,
        }} />
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          {chains.map((c, i) => (
            <React.Fragment key={c.name}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '0 0 auto', position: 'relative', zIndex: 3 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, fontSize: 16, color: '#fff',
                  border: '1.5px solid rgba(255,255,255,0.85)', boxShadow: '0 4px 14px rgba(26,27,78,0.10)',
                  background: c.bg, animation: 'nx-chain-glow 2.4s ease-in-out infinite',
                  animationDelay: `${i * 0.6}s`,
                }}>{c.sym}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: C.ink2, whiteSpace: 'nowrap' }}>{c.name}</div>
              </div>
              {i < chains.length - 1 && (
                <div style={{
                  flex: 1, position: 'relative', height: 2,
                  background: `linear-gradient(90deg, ${C.hairline}, rgba(61,212,245,.4), ${C.hairline})`,
                  margin: '0 -2px', alignSelf: 'center', marginTop: -15,
                }}>
                  {[0, 0.6, 1.2].map((d, j) => (
                    <span key={j} style={{
                      position: 'absolute', top: -3, width: 8, height: 8, borderRadius: '50%',
                      background: j % 2 ? C.lav : C.cyan,
                      boxShadow: `0 0 12px ${j % 2 ? C.lav : C.cyan}`,
                      animation: 'nx-hop-flow 1.8s linear infinite', animationDelay: `${d + i * 0.2}s`,
                    }} />
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{
          position: 'relative', zIndex: 2, marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: C.ink3, letterSpacing: '0.06em',
        }}>
          <span>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, marginRight: 6, animation: 'nx-pulse 1.4s infinite', verticalAlign: 'middle' }} />
            Routes Active
          </span>
          <span>Avg <b style={{ color: C.ink, fontWeight: 800 }}>~2 min</b> · <b style={{ color: C.ink, fontWeight: 800 }}>71 chains</b></span>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Inline sanctions screening
// =====================================================================
const SANCTIONS_URL          = 'https://public.chainalysis.com/api/v1/address/';
const SANCTIONS_CACHE_PREFIX = 'nx_sanctions_';
const SANCTIONS_CACHE_TTL    = 24 * 60 * 60 * 1000;
const SANCTIONS_TIMEOUT      = 5000;

async function screenAddress(address) {
  if (!address || typeof address !== 'string') return { clean: true };
  if (ADMIN_WALLETS.has(address)) return { clean: true };
  try {
    const raw = localStorage.getItem(SANCTIONS_CACHE_PREFIX + address);
    if (raw) {
      const { result, ts } = JSON.parse(raw);
      if (Date.now() - ts < SANCTIONS_CACHE_TTL) return result;
    }
  } catch {}
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), SANCTIONS_TIMEOUT);
    const res = await fetch(SANCTIONS_URL + encodeURIComponent(address), {
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { clean: true };
    const data = await res.json();
    const ids = Array.isArray(data?.identifications) ? data.identifications : [];
    const result = ids.length > 0
      ? { clean: false, reason: ids[0]?.name || ids[0]?.category || 'Sanctioned' }
      : { clean: true };
    try { localStorage.setItem(SANCTIONS_CACHE_PREFIX + address, JSON.stringify({ result, ts: Date.now() })); } catch {}
    return result;
  } catch (e) {
    console.warn('[sanctions screen]', e?.message || e);
    return { clean: true };
  }
}

// =====================================================================
// ROUTING TABLES
// =====================================================================
const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/bridge': 'bridge',
  '/sol-btc': 'solbtc', '/btc': 'solbtc', '/bitcoin': 'solbtc',
  '/wonderland': 'wonderland', '/memes': 'wonderland',
  '/ape': 'ape', '/radar': 'launchradar', '/launch-radar': 'launchradar', '/launches': 'launchradar',
  '/markets': 'markets', '/tokenized': 'markets',
  '/flipsy': 'flipsy', '/predict': 'flipsy',
  '/get-started': 'getstarted', '/wallet': 'getstarted',
  '/holdings': 'holdings', '/portfolio': 'holdings', '/bags': 'holdings',
  '/referrals': 'referrals', '/refer': 'referrals',
  '/why': 'why', '/why-nexus': 'why', '/about': 'why',
  '/admin': 'admin', '/dashboard': 'admin',
  '/stack': 'swap', '/vip': 'swap', '/perps': 'swap', '/call': 'swap',
};
const TAB_TO_PATH = {
  swap: '/swap', bridge: '/bridge', solbtc: '/sol-btc',
  wonderland: '/wonderland', launchradar: '/radar', ape: '/ape', markets: '/markets', flipsy: '/flipsy',
  getstarted: '/get-started', holdings: '/holdings',
  referrals: '/referrals', why: '/why', admin: '/admin',
};
function tabFromPathname(pathname) { return PATH_TO_TAB[pathname] || 'swap'; }
export function useAppWallet() { return useNexusWallet(); }

function WalletIcon({ src, fallbackLetter, color, size }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size / 4),
      background: (color || C.lav) + '33',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 800,
      color: color || C.ink, flexShrink: 0,
    }}>{(fallbackLetter || '?').charAt(0).toUpperCase()}</div>
  );
  return (
    <img src={src} alt={fallbackLetter || ''}
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), flexShrink: 0, background: '#fff' }}
      onError={() => setErrored(true)}
    />
  );
}

const WALLETCONNECT_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3b99fc"/><path d="M13 16a14 14 0 0 1 14 0l.5.4a.4.4 0 0 1 0 .6l-1.6 1.5a.24.24 0 0 1-.3 0 10 10 0 0 0-11.2 0 .24.24 0 0 1-.3 0l-1.6-1.5a.4.4 0 0 1 0-.6l.5-.4zm17.3 3.3l1.4 1.3a.4.4 0 0 1 0 .6l-6.2 5.8a.5.5 0 0 1-.7 0L21 23.2a.12.12 0 0 0-.2 0l-3.8 3.6a.5.5 0 0 1-.7 0l-6.2-5.8a.4.4 0 0 1 0-.6l1.4-1.3a.5.5 0 0 1 .7 0l6.2 5.8a.12.12 0 0 0 .2 0l3.8-3.6a.5.5 0 0 1 .7 0l3.8 3.6a.12.12 0 0 0 .2 0l6.2-5.8a.5.5 0 0 1 .7 0z" fill="#fff"/></svg>');

const CONNECTION_TIMEOUT_MS = 15000;
const WM_INITIAL = { kind: 'idle', message: '', wallet: '' };

function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':     return { kind: 'connecting', message: '', wallet: action.wallet };
    case 'SCREENING': return { kind: 'screening',  message: '', wallet: state.wallet };
    case 'TIMEOUT':   return { kind: 'timeout',    message: 'Taking too long? Check your wallet and try again.', wallet: state.wallet };
    case 'SUCCESS':   return WM_INITIAL;
    case 'ERROR':     return { kind: 'error',      message: action.message || 'Connection failed', wallet: state.wallet };
    case 'BLOCKED':   return { kind: 'blocked',    message: action.message || 'Access restricted from this wallet.', wallet: state.wallet };
    case 'RESET':     return WM_INITIAL;
    default:          return state;
  }
}

// =====================================================================
// TermsGate
// =====================================================================
function TermsGate({ onAccept }) {
  const scrollRef = useRef(null);
  const [canAccept, setCanAccept] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 8) setCanAccept(true);
  }, []);

  const handleScroll = () => {
    if (canAccept) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setCanAccept(true);
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(26,27,78,.40)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, maxHeight: '52dvh', zIndex: 1000,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: `radial-gradient(ellipse at 20% 0%, #FFE8F4 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, #D9ECFF 0%, transparent 50%), linear-gradient(180deg, #FBF5FF 0%, #EEF3FF 100%)`,
        border: `1px solid rgba(255,255,255,0.85)`,
        borderRadius: '24px 24px 0 0',
        boxShadow: '0 -20px 60px rgba(26,27,78,.18)',
        fontFamily: "'Space Grotesk', sans-serif",
        animation: 'nx-modal-up .3s cubic-bezier(.16,1,.3,1)',
      }}>
        <div style={{ flexShrink: 0, paddingTop: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: 'rgba(26,27,78,.18)' }} />
        </div>
        <div style={{ flexShrink: 0, padding: '10px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999,
            background: 'rgba(61,212,245,.10)', border: `1px solid ${C.border}`,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 6px ${C.cyan}` }} />
            <span style={{ color: C.cyan, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.14em' }}>TERMS OF USE</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: C.ink3, fontWeight: 500 }}>Non-custodial · You assume all risk</div>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="scroll-contain" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 20px 12px' }}>
          <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.6 }}>
            By clicking <strong style={{ color: C.ink }}>"Accept &amp; Continue"</strong> you agree that:<br /><br />
            • Nexus DEX is a non-custodial interface by Verixia Apps. We do not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br /><br />
            • <strong style={{ color: C.ink }}>Compliance &amp; wallet screening.</strong> All wallet addresses are screened against U.S. OFAC, U.N., E.U., and U.K. sanctions lists via Chainalysis. Flagged wallets are denied access.<br /><br />
            • <strong style={{ color: C.ink }}>Restricted jurisdictions.</strong> You are not located in, a resident of, or citizen of: Iran, North Korea, Cuba, Syria, Crimea, Donetsk, Luhansk, Sevastopol, or any other jurisdiction subject to comprehensive U.S., U.N., E.U., or U.K. sanctions.<br /><br />
            • <strong style={{ color: C.ink }}>You are 18 or older</strong> and have full legal capacity to enter this agreement.<br /><br />
            • All swaps, routing, liquidity, and blockchain interactions are handled by third-party protocols. All transactions are signed directly by you through your own wallet.<br /><br />
            • DeFi and smart contracts carry substantial risk including total loss of funds. <strong style={{ color: C.ink }}>You assume all risk.</strong><br /><br />
            • <strong style={{ color: C.ink }}>No reimbursement.</strong> Verixia Apps will not refund or compensate any loss, regardless of cause.<br /><br />
            • <strong style={{ color: C.ink }}>AS-IS / AS-AVAILABLE.</strong> No warranties of any kind.<br /><br />
            • <strong style={{ color: C.ink }}>No liability.</strong> Verixia Apps is not liable for any damages arising from your use of Nexus DEX.<br /><br />
            • <strong style={{ color: C.ink }}>No class actions.</strong> You waive any right to class action or jury trial against Verixia Apps.<br /><br />
            • <strong style={{ color: C.ink }}>Binding arbitration.</strong> Disputes resolved through individual arbitration only.<br /><br />
            If you do not agree, discontinue use immediately.
          </div>
        </div>
        <div style={{ flexShrink: 0, padding: '10px 20px 16px', borderTop: `1px solid ${C.hairline}`, background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(10px)' }}>
          {!canAccept && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 10, color: C.ink3, marginBottom: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace" }}>
              <span>↓</span> SCROLL TO CONTINUE
            </div>
          )}
          <button onClick={canAccept ? onAccept : undefined} disabled={!canAccept}
            style={{
              width: '100%', padding: 14, borderRadius: 14, border: 'none',
              background: canAccept ? 'linear-gradient(135deg, #A0E7FF, #FF8FBE)' : 'rgba(26,27,78,.06)',
              color: canAccept ? C.ink : C.ink3,
              fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 18, letterSpacing: '-0.01em',
              cursor: canAccept ? 'pointer' : 'not-allowed',
              boxShadow: canAccept ? '0 8px 24px rgba(160,231,255,.30)' : 'none',
              transition: 'all .2s',
            }}>
            Accept &amp; Continue
          </button>
          <div style={{ fontSize: 9, color: C.ink3, textAlign: 'center', marginTop: 8, fontWeight: 700, letterSpacing: '0.10em', fontFamily: "'JetBrains Mono', monospace" }}>
            NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// WalletModal
// =====================================================================
function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);
  const nexus = useNexusWallet();
  const { disconnectAll, isConnected: nexusConnected, extSolConnected, walletAddress, connectedWalletName } = nexus;
  const { wallet: selectedWallet, select, wallets, connect: solConnect } = useWallet();
  const connectionTimerRef = useRef(null);

  const phantomWallet       = wallets.find(w => w.adapter.name === 'Phantom');
  const walletConnectWallet = wallets.find(w => w.adapter.name === 'WalletConnect');

  useEffect(() => {
    if (!open) {
      dispatch({ type: 'RESET' });
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('nexus-scroll-locked');
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('nexus-scroll-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => () => {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
  }, []);

  useEffect(() => {
    if (mState.kind !== 'connecting') return;
    const matched = extSolConnected && selectedWallet && selectedWallet.adapter && selectedWallet.adapter.name === mState.wallet;
    if (matched) {
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
      dispatch({ type: 'SCREENING' });
    }
  }, [extSolConnected, selectedWallet, mState.kind, mState.wallet]);

  useEffect(() => {
    if (mState.kind !== 'screening') return;
    if (!walletAddress) return;
    let cancelled = false;
    screenAddress(walletAddress).then(({ clean }) => {
      if (cancelled) return;
      if (clean) { dispatch({ type: 'SUCCESS' }); onClose(); }
      else {
        disconnectAll().catch(() => {});
        dispatch({ type: 'BLOCKED', message: 'This wallet is on a sanctioned addresses list. Access is denied.' });
      }
    }).catch(() => {
      if (cancelled) return;
      dispatch({ type: 'SUCCESS' });
      onClose();
    });
    return () => { cancelled = true; };
  }, [mState.kind, walletAddress, disconnectAll, onClose]);

  const targetWalletRef = useRef(null);
  useEffect(() => {
    const target = targetWalletRef.current;
    if (!target || !selectedWallet || selectedWallet.adapter.name !== target || mState.kind !== 'connecting' || mState.wallet !== target) return;
    let cancelled = false;
    targetWalletRef.current = null;
    solConnect().catch(e => {
      if (cancelled) return;
      const raw = e?.message || 'Failed';
      dispatch({ type: 'ERROR', message: /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw });
    });
    return () => { cancelled = true; };
  }, [selectedWallet, solConnect, mState.kind, mState.wallet]);

  const startTimer = () => {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = setTimeout(() => dispatch({ type: 'TIMEOUT' }), CONNECTION_TIMEOUT_MS);
  };

  const handleSolanaConnect = useCallback(wallet => {
    if (!wallet?.adapter) { dispatch({ type: 'ERROR', message: 'Wallet not detected. Install the extension.' }); return; }
    dispatch({ type: 'START', wallet: wallet.adapter.name });
    startTimer();
    targetWalletRef.current = wallet.adapter.name;
    try { select(wallet.adapter.name); }
    catch (e) { dispatch({ type: 'ERROR', message: 'Failed to open wallet.' }); targetWalletRef.current = null; }
  }, [select]);

  const handleDisconnect = useCallback(async () => {
    try { await disconnectAll(); } catch {}
    dispatch({ type: 'RESET' });
    onClose();
  }, [disconnectAll, onClose]);

  const handleRetry = () => dispatch({ type: 'RESET' });

  const allOptions = [
    { key: 'phantom', name: 'Phantom', subtitle: 'Solana wallet', color: '#ab9ff2', icon: phantomWallet?.adapter?.icon, ready: !!phantomWallet, pendingMatch: 'Phantom', onClick: () => handleSolanaConnect(phantomWallet) },
    { key: 'walletconnect', name: 'WalletConnect', subtitle: 'Scan QR or link any wallet', color: '#3b99fc', icon: WALLETCONNECT_LOGO, ready: !!walletConnectWallet, pendingMatch: 'WalletConnect', onClick: () => handleSolanaConnect(walletConnectWallet) },
  ];

  const availableOpts = allOptions.filter(o => o.ready);
  const isConnecting  = mState.kind === 'connecting' || mState.kind === 'screening';
  const isTimedOut    = mState.kind === 'timeout';
  const isBlocked     = mState.kind === 'blocked';
  const isScreening   = mState.kind === 'screening';
  const pendingWallet = (isConnecting || isTimedOut) ? mState.wallet : null;
  const anyConnected  = nexusConnected;
  const displayAddr   = walletAddress ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4) : null;

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(26,27,78,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 501,
        background: `radial-gradient(ellipse at 20% 0%, #FFE8F4 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, #D9ECFF 0%, transparent 50%), linear-gradient(180deg, #FBF5FF 0%, #EEF3FF 100%)`,
        border: `1px solid rgba(255,255,255,0.85)`, borderRadius: '24px 24px 0 0',
        boxShadow: '0 -20px 60px rgba(26,27,78,.18)',
        maxHeight: 'min(85vh, 100dvh)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'nx-modal-up .3s cubic-bezier(.16,1,.3,1)',
      }}>
        <div style={{ flexShrink: 0, padding: '14px 24px 12px' }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: 'rgba(26,27,78,.18)', borderRadius: 99, margin: '0 auto 16px', cursor: 'pointer' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontSize: 24, color: C.ink, marginBottom: 6, letterSpacing: '-0.015em',
            }}>
              {isBlocked
                ? <>Access <em style={{ fontStyle: 'italic', background: 'linear-gradient(120deg,#FF8FBE,#B794F6)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>restricted</em></>
                : anyConnected
                  ? <>Wallet <em style={{ fontStyle: 'italic', background: 'linear-gradient(120deg,#A0E7FF,#FF8FBE)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>connected</em></>
                  : <>Connect <em style={{ fontStyle: 'italic', background: 'linear-gradient(120deg,#A0E7FF,#FF8FBE)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>wallet</em></>}
            </div>
            {displayAddr && !isBlocked && (
              <div style={{ fontSize: 12, color: C.ink2, fontWeight: 500 }}>{(connectedWalletName || 'Wallet')}: {displayAddr}</div>
            )}
            {isScreening && (<div style={{ fontSize: 11, color: C.cyan, marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '0.08em' }}>VERIFYING WALLET ADDRESS…</div>)}
            {!anyConnected && !isBlocked && !isScreening && (
              <div style={{ fontSize: 12, color: C.ink3, marginTop: 4, fontWeight: 500 }}>Pick one. We never see your keys.</div>
            )}
          </div>
        </div>
        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)' }}>
          {isBlocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(209,75,106,.10)', border: '1px solid rgba(209,75,106,.35)', borderRadius: 16, padding: '14px 16px' }}>
                <div style={{ color: C.red, fontWeight: 800, fontSize: 14, marginBottom: 6, fontFamily: "'Space Grotesk', sans-serif" }}>Wallet not eligible</div>
                <div style={{ color: C.ink2, fontSize: 12, lineHeight: 1.55 }}>
                  {mState.message} This is automated screening against major sanctions lists. If you believe this is an error, please try a different wallet.
                </div>
              </div>
              <button onClick={handleRetry} style={{ background: 'rgba(61,212,245,.08)', border: `1px solid ${C.borderHi}`, borderRadius: 14, padding: 13, cursor: 'pointer', width: '100%', color: C.cyan, fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif" }}>Try a different wallet</button>
              <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 12, cursor: 'pointer', color: C.ink3, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>Close</button>
            </div>
          ) : anyConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18))', border: '1px solid rgba(127,255,212,.45)', borderRadius: 16, padding: '14px 18px' }}>
                <div style={{ color: C.green, fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Connected</div>
                <div style={{ color: C.ink2, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, wordBreak: 'break-all' }}>{displayAddr || '(provisioning...)'}</div>
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(209,75,106,.10)', border: '1px solid rgba(209,75,106,.35)', borderRadius: 14, padding: 14, cursor: 'pointer', width: '100%', color: C.red, fontWeight: 700, fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}>Disconnect</button>
              <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 13, cursor: 'pointer', color: C.ink3, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>Close</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {(mState.kind === 'error' || isTimedOut) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'rgba(255,176,136,.14)', border: '1px solid rgba(255,176,136,.45)', borderRadius: 12, padding: '10px 14px', alignItems: 'center' }}>
                  <span style={{ color: '#8a4a1d', fontSize: 12, fontWeight: 700 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid #8a4a1d', color: '#8a4a1d', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, cursor: 'pointer' }}>Retry</button>
                </div>
              )}
              {availableOpts.length > 0 ? availableOpts.map(opt => {
                const isPending = isConnecting && pendingWallet === opt.pendingMatch;
                const disabled  = isConnecting || isTimedOut;
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: isPending ? 'rgba(61,212,245,.10)' : C.glassStrong,
                    border: '1px solid ' + (isPending ? C.borderHi : C.hairline),
                    borderRadius: 14, padding: '12px 14px',
                    cursor: disabled ? 'wait' : 'pointer', width: '100%',
                    opacity: isTimedOut && !isPending ? 0.55 : 1,
                    transition: 'all .15s', fontFamily: "'Space Grotesk', sans-serif",
                  }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={32} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.ink, fontWeight: 700, fontSize: 14 }}>{opt.name}</div>
                      <div style={{ color: C.ink2, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {isPending ? (isScreening ? 'Verifying address…' : 'Check your wallet…') : opt.subtitle}
                      </div>
                    </div>
                    {isPending && <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${C.cyan}`, borderTopColor: 'transparent', animation: 'nx-spin 0.8s linear infinite', flexShrink: 0 }} />}
                  </button>
                );
              }) : (
                <div style={{ background: 'rgba(209,75,106,.10)', border: '1px solid rgba(209,75,106,.30)', borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5, textAlign: 'center', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
                  No wallets detected. Install Phantom or open from your wallet browser.
                </div>
              )}
              <div style={{ fontSize: 10, color: C.ink3, textAlign: 'center', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '0.10em' }}>NON-CUSTODIAL · WE NEVER SEE YOUR KEYS</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Nav icons — only the 5 primary tabs are exposed in the nav
// =====================================================================
function IconSwap()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconApe()        { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>; }
function IconWonderland() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 6.4L21 10l-5.4 4 1.8 7L12 17.5 6.6 21l1.8-7L3 10l6.6-1.6L12 2z"/></svg>; }
function IconMarkets()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>; }
function IconHoldings()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18l-2 13H5L3 7z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/></svg>; }

const NAV_ICONS = { swap: IconSwap, ape: IconApe, wonderland: IconWonderland, markets: IconMarkets, holdings: IconHoldings };

// Primary nav: five tabs by default, plus Admin which is only visible
// to wallets in ADMIN_WALLETS. The filter in AppInner handles the gating.
const PRIMARY_NAV_TABS = [
  { id: 'swap',       label: 'Swap' },
  { id: 'ape',        label: 'Ape' },
  { id: 'wonderland', label: 'Wonder' },
  { id: 'markets',    label: 'Markets' },
  { id: 'holdings',   label: 'Bags' },
  { id: 'admin',      label: 'Admin' },
];

// =====================================================================
// ApeLocked / FlipsyLocked — shown to non-authorized wallets
// =====================================================================
function ApeLocked({ connected, onConnectWallet }) {
  return <PageLocked title="Private beta" body="This page is locked to one wallet for now. Connect the authorized wallet to open it." connected={connected} onConnectWallet={onConnectWallet} />;
}
function FlipsyLocked({ connected, onConnectWallet }) {
  return <PageLocked title="In development" body="Flipsy (predictions) is still being built. Connect the dev wallet to preview, or check back soon." connected={connected} onConnectWallet={onConnectWallet} />;
}
function PageLocked({ title, body, connected, onConnectWallet }) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', padding: '64px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 46, marginBottom: 14 }}>🔒</div>
      <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 28, color: C.ink, margin: '0 0 8px', letterSpacing: '-0.015em' }}>{title}</h2>
      <p style={{ color: C.ink2, fontSize: 14, fontWeight: 500, lineHeight: 1.5, maxWidth: 340, margin: '0 auto 18px' }}>{body}</p>
      <button onClick={onConnectWallet} style={{
        padding: '13px 22px', borderRadius: 14, border: 'none', cursor: 'pointer',
        background: 'linear-gradient(135deg,#A0E7FF,#FF8FBE)', color: C.ink,
        fontFamily: "'Instrument Serif', serif", fontSize: 18, boxShadow: '0 8px 24px rgba(160,231,255,.30)',
      }}>{connected ? 'Switch wallet' : 'Connect wallet'}</button>
    </div>
  );
}

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet   = useAppWallet();
  const [tab, setTab] = useState(() => tabFromPathname(location.pathname));
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const swapWidgetRef = useRef(null);

  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem('nexus_terms_accepted_v3') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'nexus-global-styles';
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);

  // Visit tracking — fires once per page navigation. Anonymous per-browser
  // visitor_id stored in localStorage. No IP, no cookies, no PII.
  useEffect(() => {
    try {
      let vid;
      try { vid = localStorage.getItem('nx_vid'); } catch { vid = null; }
      if (!vid) {
        vid = Math.random().toString(36).slice(2) + Date.now().toString(36);
        try { localStorage.setItem('nx_vid', vid); } catch {}
      }
      const ref = new URLSearchParams(window.location.search).get('ref') || null;
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: vid, path: location.pathname, ref }),
      }).catch(() => {});
    } catch (e) {}
  }, [location.pathname]);

  useEffect(() => {
    const newTab = tabFromPathname(location.pathname);
    if (newTab !== tab) setTab(newTab);
  }, [location.pathname, tab]);

  const switchTab = useCallback(newTab => {
    if (newTab === tab) return;
    navigate(TAB_TO_PATH[newTab] || '/swap');
    setTab(newTab);
    window.scrollTo(0, 0);
  }, [tab, navigate]);
  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  const scrollToSwapWidget = useCallback(() => {
    const el = swapWidgetRef.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }, []);

  const sharedProps = {
    isConnected:      wallet.isConnected,
    solConnected:     wallet.solConnected,
    walletAddress:    wallet.walletAddress,
    publicKey:        wallet.publicKey,
    activeWalletKind: wallet.activeWalletKind,
    onConnectWallet:  openWallet,
  };
  const displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '…' + wallet.walletAddress.slice(-4)
    : null;

  // Gates
  const canApe    = wallet.walletAddress === APE_ACCESS_WALLET;
  const canFlipsy = wallet.walletAddress === FLIPSY_ACCESS_WALLET;
  // Primary nav: filter Ape out if non-authorized.
  const navTabs = PRIMARY_NAV_TABS.filter(t => t.id !== 'ape' || canApe);

  // Full-bleed pages — Ape is full-bleed by design.
  const isFullBleed = tab === 'ape';

  return (
    <div style={{ minHeight: '100dvh', color: C.ink, fontFamily: "'Space Grotesk', sans-serif", overscrollBehavior: 'none', overflowX: 'hidden', width: '100%', position: 'relative' }}>
      <div className="nx-fixed-blob" style={{ width: 380, height: 380, background: C.sky, top: -100, right: -120 }} />
      <div className="nx-fixed-blob" style={{ width: 420, height: 420, background: C.pink, top: '35%', left: -160, animationDelay: '3s' }} />
      <div className="nx-fixed-blob" style={{ width: 300, height: 300, background: C.gold, bottom: '15%', right: -80, animationDelay: '6s' }} />

      {/* HEADER */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(251,245,255,0.72)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.85)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'linear-gradient(135deg, #A0E7FF 0%, #B794F6 50%, #FF8FBE 100%)',
              boxShadow: '0 0 14px rgba(160,231,255,0.45)',
              display: 'grid', placeItems: 'center',
              fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 16, color: '#fff',
              textShadow: '0 1px 2px rgba(26,27,78,0.20)',
            }}>N</div>
            <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: 22, lineHeight: 1, color: C.ink }}>
              nexus
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontStyle: 'normal', fontSize: 9, fontWeight: 700,
                color: C.cyan, background: 'rgba(61,212,245,0.10)',
                border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 6px', marginLeft: 6,
                letterSpacing: '0.08em', verticalAlign: 'middle',
              }}>DEX</span>
            </span>
          </div>
          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {navTabs.map(t => {
              const isActive = tab === t.id;
              return (
                <button key={t.id} onClick={() => switchTab(t.id)} style={{
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(160,231,255,.22), rgba(255,143,190,.22))'
                    : 'transparent',
                  border: isActive ? `1px solid ${C.border}` : '1px solid transparent',
                  borderRadius: 999, padding: '6px 14px',
                  color: isActive ? C.ink : C.ink2,
                  fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  letterSpacing: '0.04em',
                }}>{t.label}</button>
              );
            })}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: wallet.isConnected
              ? C.glassStrong
              : 'linear-gradient(135deg, #A0E7FF, #FF8FBE)',
            border: wallet.isConnected ? `1px solid ${C.border}` : 'none',
            borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 12,
            color: C.ink, whiteSpace: 'nowrap',
            boxShadow: wallet.isConnected ? 'none' : '0 4px 14px rgba(160,231,255,.40)',
            letterSpacing: '0.04em',
          }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} /><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{displayAddress}</span></>) : 'Connect'}
          </button>
        </div>
      </header>

      <main style={{
        position: 'relative', zIndex: 1,
        maxWidth: isFullBleed ? 'none' : 1100,
        margin: '0 auto', width: '100%',
        padding: isFullBleed ? '0 0 100px' : '0 16px 100px',
      }}>
        {tab === 'swap' && (
          <>
            <SwapHero onStartTrading={switchTab} onScrollToWidget={scrollToSwapWidget} />
            <div ref={swapWidgetRef}>
              <SwapWidget {...sharedProps} />
            </div>
            <HomeBelow onSwitchTab={switchTab} walletAddress={wallet.walletAddress} />
          </>
        )}
        {tab === 'launchradar' && <LaunchRadar onConnectWallet={openWallet} />}
        {tab === 'ape' && (canApe
          ? <Ape onConnectWallet={openWallet} mainWalletPubkey={wallet.walletAddress} onSwitchTab={switchTab} />
          : <ApeLocked connected={wallet.isConnected} onConnectWallet={openWallet} />
        )}
        {tab === 'bridge'      && <><BridgeHero onSwitchTab={switchTab} /><CrossChainSwap onConnectWallet={openWallet} /></>}
        {tab === 'solbtc'      && <SolToBtcChainflip onConnectWallet={openWallet} />}
        {tab === 'wonderland'  && <MemeWonderland onConnectWallet={openWallet} />}
        {tab === 'markets'     && <Stocks {...sharedProps} />}
        {tab === 'flipsy'      && (canFlipsy
          ? <Flipsy onConnectWallet={openWallet} />
          : <FlipsyLocked connected={wallet.isConnected} onConnectWallet={openWallet} />
        )}
        {tab === 'holdings'    && <Holdings {...sharedProps} />}
        {tab === 'getstarted'  && <GetStarted onConnectWallet={openWallet} onSwitchTab={switchTab} />}
        {tab === 'referrals'   && <ReferralsPage onConnectWallet={openWallet} />}
        {tab === 'why'         && <WhyNexus onSwitchTab={switchTab} />}
        {tab === 'admin'       && <AdminPage onConnectWallet={openWallet} walletAddress={wallet.walletAddress} isConnected={wallet.isConnected} onSwitchTab={switchTab} />}
      </main>

      {/* MOBILE BOTTOM NAV — exactly 5 tabs */}
      <nav className="mobile-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(251,245,255,0.85)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.85)',
        display: 'flex', alignItems: 'stretch',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {navTabs.map(t => {
          const Icon = NAV_ICONS[t.id];
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: isActive ? C.ink : C.ink3,
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 9, fontWeight: 700,
              padding: '8px 2px', minHeight: 54, position: 'relative',
              transition: 'color .15s',
              letterSpacing: '0.2px',
            }}>
              {isActive && (<div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: 'linear-gradient(90deg, #A0E7FF, #FF8FBE)' }} />)}
              <Icon />
              <span style={{ whiteSpace: 'pre-line', lineHeight: 1.1, textAlign: 'center' }}>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {!termsAccepted && (
        <TermsGate onAccept={() => {
          try { localStorage.setItem('nexus_terms_accepted_v3', '1'); } catch {}
          setTermsAccepted(true);
        }} />
      )}

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }
