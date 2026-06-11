import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget       from './components/SwapWidget.jsx';
import Portfolio        from './components/Portfolio.js';
import Stocks           from './components/Stocks.jsx';
import CrossChainSwap   from './components/CrossChainSwap.jsx';
import MemeWonderland   from './components/MemeWonderland.jsx';
import Flipsy           from './components/Flipsy.jsx';
import SolToBtc         from './components/SolToBtc.jsx';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

// ═════════════════════════════════════════════════════════════════════
// ADMIN_WALLETS — these wallets bypass every page-level gate:
//   • SOL→BTC allowlist
//   • Markets US geo block
//   • Any future gates
// Exported so Stocks.jsx and any other page can import.
// ═════════════════════════════════════════════════════════════════════
export const ADMIN_WALLETS = new Set([
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

const GLOBAL_STYLES = `html,body{ margin:0;padding:0;width:100%; min-height:100vh; min-height:100dvh; overflow-x:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; } html{ scroll-behavior:smooth; } body{ -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; } body.nexus-scroll-locked{ overflow:hidden !important; } #root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; } *,*::before,*::after{box-sizing:border-box;} *{ -webkit-tap-highlight-color:transparent; } button,a,[role="button"]{ touch-action:manipulation; } input,button,select,textarea{ font-family:'Syne',sans-serif; font-size:16px; } input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; } ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} .scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}}
@keyframes wc-spin { to { transform: rotate(360deg); } }
@keyframes nxHueShift { to { background-position: 200% 0; } }
@keyframes nxOrbPulse { 0%,100%{ transform:scale(1); opacity:.85; } 50%{ transform:scale(1.08); opacity:1; } }
@keyframes nxOrbSpin { to { transform: rotate(360deg); } }
@keyframes nxSpinSlow { to { transform: rotate(360deg); } }
@keyframes nxSparkle { 0%,100%{opacity:0;transform:scale(.5)} 50%{opacity:.9;transform:scale(1)} }
@keyframes nxMeshShift { 0%,100%{transform:translate(0,0)} 50%{transform:translate(8px,-6px)} }
@keyframes nxShimmer { 0%{left:-50%} 60%,100%{left:120%} }
@keyframes nxPulse { 50%{opacity:.35} }
@keyframes nxPulseScale { 50%{transform:scale(1.18);text-shadow:0 0 16px currentColor} }
@keyframes nxTickerRoll { 0%{transform:translateY(0)} 100%{transform:translateY(-50%)} }
@keyframes nxHopFlow { 0%{left:-4%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:104%;opacity:0} }
@keyframes nxChainGlow { 0%,100%{box-shadow:0 0 0 0 rgba(79,125,255,.5)} 50%{box-shadow:0 0 0 8px rgba(79,125,255,0)} }
.nx-hero-cta:active { transform: scale(.97); }
.nx-eco-btn:hover { border-color: rgba(0,180,210,0.28); transform: translateY(-1px); }
`;

// =====================================================================
// Common ecosystem strip
// =====================================================================
function EcoStrip({ active, onGo, accentColor, accentBg, accentLine }) {
  const items = [
    { ic: '⇅',  lbl: 'Swap',       tab: 'swap' },
    { ic: '🌉', lbl: 'Bridge',     tab: 'bridge' },
    { ic: '₿',  lbl: 'SOL→BTC',    tab: 'soltobtc' },
    { ic: '✨', lbl: 'Wonderland', tab: 'wonderland' },
    { ic: '📈', lbl: 'Markets',    tab: 'markets' },
    { ic: '🎯', lbl: 'Flipsy',     tab: 'flipsy' },
    { ic: '▦',  lbl: 'Wallet',     tab: 'portfolio' },
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
              flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              minWidth: 68, padding: '11px 8px', borderRadius: 14, cursor: 'pointer',
              border: '1px solid ' + (isActive ? accentLine : 'rgba(120,80,220,0.12)'),
              background: isActive ? accentBg : 'rgba(255,255,255,0.02)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              transition: 'border-color .15s, transform .12s', fontFamily: 'Syne, sans-serif',
              boxShadow: isActive ? `0 0 24px ${accentColor}30` : 'none',
            }}
          >
            <span style={{ fontSize: 18 }}>{e.ic}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
              letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: isActive ? accentColor : '#9b8fc0',
            }}>{e.lbl}</span>
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// HOMEPAGE — SwapHero
// Big "NO KYC · NO ACCOUNT · NO LIMITS" banner + full hero
// 5 outcome-focused benefits, animated orbiting tokens, live ticker
// "Start Trading" CTA scrolls to the swap widget below
// =====================================================================
function SwapHero({ onStartTrading, onScrollToWidget }) {
  const P = {
    cyan: '#00e5ff', pink: '#ff4d9d', magenta: '#c4359a', violet: '#7a3dd4',
    green: '#00ffa3',
    text: '#f5fafe', dim: '#9b8fc0', faint: '#564670',
    line: 'rgba(120,80,220,0.12)',
    cyanLine: 'rgba(0,229,255,0.32)', pinkLine: 'rgba(255,77,157,0.32)',
    cyanBg: 'rgba(0,229,255,0.06)', cyanBg2: 'rgba(0,229,255,0.18)',
    pinkBg: 'rgba(255,77,157,0.06)', pinkBg2: 'rgba(255,77,157,0.18)',
  };

  const benefits = [
    'Swap on Solana',
    'Bridge Across 71 Chains',
    'Get Native Bitcoin',
    'Discover Trending Memes',
    'Self-Custody Always',
  ];

  const stats = [
    { v: '$48M',   l: 'Volume' },
    { v: '0.4s',   l: 'Settlement' },
    { v: '12K+',   l: 'Tokens' },
    { v: '71',     l: 'Chains' },
  ];

  // Live ticker rows (mock activity, real-looking)
  const tickerRows = [
    ['SOL → USDC',  '+$1,420', '2s'],
    ['JUP → SOL',   '+$340',   '4s'],
    ['USDC → BONK', '+$80',    '7s'],
    ['WIF → USDC',  '+$2,180', '11s'],
    ['SOL → JUP',   '+$610',   '13s'],
    ['USDC → ETH',  '+$5,400', '19s'],
  ];

  return (
    <div style={{ maxWidth: 480, margin: '0 auto 4px', width: '100%' }}>

      <EcoStrip
        active="swap" onGo={onStartTrading}
        accentColor={P.cyan} accentBg={`linear-gradient(135deg, ${P.cyanBg2}, ${P.pinkBg2})`} accentLine={P.cyanLine}
      />

      {/* HUGE NO-KYC BANNER */}
      <div style={{
        margin: '14px 0', padding: '18px 14px', borderRadius: 18, textAlign: 'center', position: 'relative', overflow: 'hidden',
        background: `linear-gradient(90deg, rgba(0,0,0,0.5), ${P.cyanBg2}, rgba(0,0,0,0.5))`,
        border: `1px solid ${P.cyanLine}`,
        boxShadow: '0 0 30px rgba(0,229,255,0.18)',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at 20% 50%, rgba(0,229,255,0.55), transparent 50%), radial-gradient(circle at 80% 50%, rgba(255,77,157,0.55), transparent 50%)`,
          opacity: 0.5, pointerEvents: 'none',
        }} />
        <div style={{
          position: 'relative', zIndex: 2, fontFamily: "'Syne', sans-serif", fontWeight: 900,
          fontSize: 'clamp(18px,5.5vw,24px)', letterSpacing: '0.04em', lineHeight: 1, color: '#fff',
          textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexWrap: 'wrap', gap: '8px 14px',
        }}>
          <span><span style={{ color: P.cyan, fontSize: '0.85em', marginRight: 6, animation: 'nxPulseScale 1.6s ease-in-out infinite', display: 'inline-block' }}>✗</span>No KYC</span>
          <span><span style={{ color: P.pink, fontSize: '0.85em', marginRight: 6, animation: 'nxPulseScale 1.6s ease-in-out .5s infinite', display: 'inline-block' }}>✗</span>No Account</span>
          <span><span style={{ color: P.green, fontSize: '0.85em', marginRight: 6, animation: 'nxPulseScale 1.6s ease-in-out 1s infinite', display: 'inline-block' }}>✗</span>No Limits</span>
        </div>
      </div>

      {/* MAIN HERO CARD */}
      <div style={{
        position: 'relative', borderRadius: 26, overflow: 'hidden',
        background: `radial-gradient(circle at 20% 0%, ${P.cyanBg2}, transparent 50%), radial-gradient(circle at 100% 100%, ${P.pinkBg2}, transparent 50%), linear-gradient(135deg, rgba(10,4,32,0.96), rgba(28,6,40,0.96))`,
        border: `1px solid ${P.cyanLine}`,
        boxShadow: `0 0 0 1px rgba(0,229,255,0.06), 0 24px 60px -16px rgba(255,77,157,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}>
        {/* spinning border */}
        <div style={{
          position: 'absolute', inset: -1, borderRadius: 26, padding: 1,
          background: `conic-gradient(from 0deg, ${P.cyan}, ${P.pink}, ${P.cyan}, ${P.pink})`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor', maskComposite: 'exclude',
          opacity: 0.35, animation: 'nxSpinSlow 12s linear infinite', pointerEvents: 'none',
        }} />
        {/* mesh */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none',
          background: `radial-gradient(circle at 30% 20%, rgba(0,229,255,0.55), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,77,157,0.55), transparent 40%)`,
          animation: 'nxMeshShift 8s ease-in-out infinite',
        }} />
        {/* sparkles */}
        {[['14%', '18%', 0], ['8%', '62%', 1.3], ['78%', '24%', 2.6], ['55%', '88%', 0.7]].map(([t, l, d], i) => (
          <span key={i} style={{
            position: 'absolute', top: t, left: l, width: 3, height: 3, borderRadius: '50%',
            background: '#fff', boxShadow: '0 0 8px #fff', opacity: 0,
            animation: `nxSparkle 4s ease-in-out infinite`, animationDelay: `${d}s`,
          }} />
        ))}

        <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative', zIndex: 2 }}>
          {/* LEFT */}
          <div style={{ flex: '1 1 auto', padding: '22px 12px 22px 22px', minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.cyan,
              border: `1px solid ${P.cyanLine}`, borderRadius: 100, padding: '5px 11px', marginBottom: 14, background: P.cyanBg,
            }}>⚡ Powered by Jupiter</div>

            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 900,
              fontSize: 'clamp(32px,10vw,42px)', lineHeight: 0.92, letterSpacing: '-0.04em',
              margin: '0 0 12px', color: P.text,
            }}>
              TRADE<br />
              <span style={{
                background: `linear-gradient(120deg, ${P.cyan} 0%, #fff 50%, ${P.pink} 100%)`,
                backgroundSize: '200% 100%',
                WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                animation: 'nxHueShift 5s linear infinite',
              }}>ANYTHING.</span><br />
              <em style={{ fontStyle: 'italic', fontWeight: 500 }}>ANYWHERE.</em>
            </h1>

            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13.5, fontWeight: 600, color: '#cdd6f4', marginBottom: 8, lineHeight: 1.4 }}>
              The front door of Solana DeFi.
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: P.dim, marginBottom: 18,
            }}>Any token · Any wallet · Any time</div>

            <ul style={{ listStyle: 'none', margin: '0 0 22px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {benefits.map((b, i) => {
                const useAlt = i % 2 === 1;
                return (
                  <li key={b} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    fontSize: 13, fontWeight: 600, color: '#cdd6f4', fontFamily: "'Syne', sans-serif",
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 6, display: 'grid', placeItems: 'center',
                      fontSize: 10, fontWeight: 900, flexShrink: 0,
                      background: useAlt ? P.pinkBg : P.cyanBg,
                      color: useAlt ? P.pink : P.cyan,
                      border: `1px solid ${useAlt ? P.pinkLine : P.cyanLine}`,
                    }}>✓</span>
                    {b}
                  </li>
                );
              })}
            </ul>

            <button
              className="nx-hero-cta"
              onClick={onScrollToWidget}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 28px',
                border: 0, borderRadius: 14, color: '#03060f',
                fontFamily: "'Syne', sans-serif", fontWeight: 900, fontSize: 14,
                cursor: 'pointer', letterSpacing: '0.02em',
                background: `linear-gradient(90deg, ${P.cyan}, #fff, ${P.pink})`,
                backgroundSize: '300% 100%', animation: 'nxHueShift 5s linear infinite',
                boxShadow: `0 10px 30px -8px rgba(255,77,157,0.7), 0 4px 14px rgba(0,229,255,0.4), inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.15)`,
                position: 'relative', overflow: 'hidden',
              }}
            >Start Trading →</button>
          </div>

          {/* RIGHT — orbiting tokens */}
          <div style={{ flex: '0 0 130px', width: 130, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: 60, height: 60, borderRadius: '50%',
              background: `radial-gradient(circle at 35% 30%, rgba(0,229,255,0.55), rgba(255,77,157,0.55) 55%, transparent 75%)`,
              filter: 'blur(1px)', animation: 'nxOrbPulse 3.2s ease-in-out infinite',
              boxShadow: '0 0 40px rgba(255,77,157,0.4)',
            }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 108, height: 108, borderRadius: '50%', border: `1px dashed ${P.cyanLine}`, transform: 'translate(-50%,-50%)', animation: 'nxSpinSlow 18s linear infinite' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 80, height: 80, borderRadius: '50%', border: `1px dashed ${P.pinkLine}`, transform: 'translate(-50%,-50%)', animation: 'nxSpinSlow 12s linear infinite reverse' }} />
            {/* outer ring tokens */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 108, height: 108, transform: 'translate(-50%,-50%)', animation: 'nxSpinSlow 14s linear infinite' }}>
              <Tk style={{ top: -12, left: '50%', marginLeft: -12 }} bg="linear-gradient(135deg,#9945ff,#14f195)">S</Tk>
              <Tk style={{ top: '50%', right: -12, marginTop: -12 }} bg="linear-gradient(135deg,#2775ca,#1c4f9c)">U</Tk>
              <Tk style={{ bottom: -12, left: '50%', marginLeft: -12 }} bg="linear-gradient(135deg,#627eea,#3c4f8c)">Ξ</Tk>
              <Tk style={{ top: '50%', left: -12, marginTop: -12 }} bg="linear-gradient(135deg,#fba31f,#c95e00)">J</Tk>
            </div>
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 80, height: 80, transform: 'translate(-50%,-50%)', animation: 'nxSpinSlow 10s linear infinite reverse' }}>
              <Tk style={{ top: -10, left: '50%', marginLeft: -10, width: 20, height: 20, fontSize: 8 }} bg="linear-gradient(135deg,#f7931a,#d97c00)">₿</Tk>
              <Tk style={{ bottom: -10, left: '50%', marginLeft: -10, width: 20, height: 20, fontSize: 8, color: '#03060f' }} bg="linear-gradient(135deg,#ffc933,#ff7700)">B</Tk>
            </div>
          </div>
        </div>
      </div>

      {/* LIVE TICKER */}
      <div style={{
        marginTop: 14, borderRadius: 14, background: 'rgba(0,0,0,0.5)', border: `1px solid ${P.line}`, overflow: 'hidden',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px 7px', borderBottom: `1px solid ${P.line}` }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: P.green,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: P.green, boxShadow: `0 0 8px ${P.green}`, animation: 'nxPulse 1.4s infinite' }} />
            Live · Last Swaps
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, color: P.dim, letterSpacing: '0.06em' }}>24h · $48M</span>
        </div>
        <div style={{
          position: 'relative', height: 74, overflow: 'hidden',
          maskImage: 'linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)',
          WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent)',
        }}>
          <div style={{ position: 'absolute', inset: 0, animation: 'nxTickerRoll 18s linear infinite' }}>
            {[...tickerRows, ...tickerRows].map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 14px', fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5, fontWeight: 700, gap: 8,
              }}>
                <span style={{ color: '#cdd6f4', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r[0]}
                </span>
                <span style={{ color: r[1].startsWith('+$8') ? '#ff3b6b' : P.green, flexShrink: 0 }}>{r[1]}</span>
                <span style={{ color: P.faint, fontSize: 9, flexShrink: 0, minWidth: 50, textAlign: 'right' }}>{r[2]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MINI STATS */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, marginTop: 14,
        background: P.line, border: `1px solid ${P.line}`, borderRadius: 18, overflow: 'hidden',
      }}>
        {stats.map(s => (
          <div key={s.l} style={{ padding: '16px 6px', textAlign: 'center', background: 'rgba(0,0,0,0.5)' }}>
            <div style={{
              fontWeight: 900, fontSize: 18, fontFamily: "'Syne', sans-serif", letterSpacing: '-0.02em',
              background: `linear-gradient(120deg, ${P.cyan}, ${P.pink})`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>{s.v}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: P.faint, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 5, fontWeight: 700 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* WIDGET TITLE */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 4px 10px' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, color: P.text, letterSpacing: '-0.01em' }}>Swap</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 800, color: P.cyan,
          border: `1px solid ${P.cyanLine}`, borderRadius: 100, padding: '5px 11px', background: P.cyanBg,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: P.cyan, boxShadow: `0 0 8px ${P.cyan}`, animation: 'nxPulse 1.6s ease-in-out infinite' }} />LIVE
        </div>
      </div>

    </div>
  );
}

// Small orbiting-token chip helper
function Tk({ style, bg, children }) {
  return (
    <div style={{
      position: 'absolute', width: 24, height: 24, borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 900, color: '#fff',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.15)',
      background: bg, ...style,
    }}>{children}</div>
  );
}

// =====================================================================
// BridgeHero — COMPACT mini-hero + animated chain-flow strip
// =====================================================================
function BridgeHero({ onSwitchTab }) {
  const P = {
    blue: '#4f7dff', violet: '#a87fff', cyan: '#00e5ff',
    text: '#f5fafe', dim: '#9b8fc0', faint: '#564670', green: '#00ffa3',
    line: 'rgba(120,80,220,0.12)',
    blueLine: 'rgba(79,125,255,0.32)', violetLine: 'rgba(168,127,255,0.32)',
    blueBg: 'rgba(79,125,255,0.06)', blueBg2: 'rgba(79,125,255,0.18)',
    violetBg: 'rgba(168,127,255,0.06)', violetBg2: 'rgba(168,127,255,0.18)',
  };

  const chains = [
    { sym: '◎', name: 'Solana',   bg: 'linear-gradient(135deg,#9945ff,#14f195)' },
    { sym: 'Ξ', name: 'Ethereum', bg: 'linear-gradient(135deg,#627eea,#3c4f8c)' },
    { sym: 'B', name: 'Base',     bg: 'linear-gradient(135deg,#0052ff,#003bb3)' },
    { sym: 'A', name: '+68 More', bg: 'linear-gradient(135deg,#28a0f0,#1a6fb3)' },
  ];

  return (
    <div style={{ maxWidth: 480, margin: '0 auto 4px', width: '100%' }}>
      <EcoStrip
        active="bridge" onGo={onSwitchTab}
        accentColor={P.blue} accentBg={`linear-gradient(135deg, ${P.blueBg2}, ${P.violetBg2})`} accentLine={P.blueLine}
      />

      {/* Small KYC pill */}
      <div style={{
        margin: '12px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '9px 14px', borderRadius: 100,
        background: `linear-gradient(90deg, rgba(0,0,0,0.4), ${P.blueBg}, rgba(0,0,0,0.4))`,
        border: `1px solid ${P.blueLine}`,
      }}>
        {[['No KYC', P.blue], ['No Account', P.violet], ['No Limits', P.green]].map(([t, c], i) => (
          <React.Fragment key={t}>
            {i > 0 && <span style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: P.dim, opacity: 0.5 }} />}
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: c, whiteSpace: 'nowrap' }}>{t}</span>
          </React.Fragment>
        ))}
      </div>

      {/* MINI HERO */}
      <div style={{
        marginTop: 14, padding: '18px 18px 16px', borderRadius: 18, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(10,12,28,0.96), rgba(16,8,32,0.96))',
        border: `1px solid ${P.blueLine}`,
      }}>
        <div style={{
          position: 'absolute', inset: -1, borderRadius: 18, padding: 1,
          background: `linear-gradient(135deg, ${P.blue}, transparent 50%, ${P.violet})`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor', maskComposite: 'exclude', opacity: 0.4, pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, position: 'relative', zIndex: 2 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'inline-block', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.blue, marginBottom: 8 }}>🌉 Powered by LI.FI</div>
            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 900,
              fontSize: 'clamp(22px,6.5vw,28px)', lineHeight: 1, letterSpacing: '-0.03em',
              margin: '0 0 6px', color: P.text,
            }}>
              CROSS CHAINS.<br />
              <span style={{
                background: `linear-gradient(120deg, ${P.blue}, ${P.violet})`,
                WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                fontStyle: 'italic', fontWeight: 500,
              }}>Instantly.</span>
            </h1>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, color: P.dim, lineHeight: 1.4, margin: 0 }}>71 chains. ~2 min. Native assets.</p>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 900, fontSize: 18, color: P.blue, letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>71</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: P.faint, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: P.green, boxShadow: `0 0 8px ${P.green}`, animation: 'nxPulse 1.4s infinite', marginRight: 5 }} />Chains Live
            </div>
          </div>
        </div>
      </div>

      {/* ANIMATED CHAIN-FLOW STRIP */}
      <div style={{
        marginTop: 14, padding: '18px 16px', borderRadius: 18, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(8,10,26,0.96), rgba(14,8,34,0.96))',
        border: `1px solid ${P.blueLine}`,
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(circle at 20% 50%, rgba(79,125,255,0.16), transparent 50%), radial-gradient(circle at 80% 50%, rgba(168,127,255,0.16), transparent 50%)`,
        }} />
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          {chains.map((c, i) => (
            <React.Fragment key={c.name}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '0 0 auto', position: 'relative', zIndex: 3 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontFamily: "'Syne', sans-serif", fontWeight: 900, fontSize: 14, color: '#fff',
                  border: '1.5px solid rgba(255,255,255,0.18)', boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                  background: c.bg, animation: 'nxChainGlow 2.4s ease-in-out infinite',
                  animationDelay: `${i * 0.6}s`,
                }}>{c.sym}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: P.dim, whiteSpace: 'nowrap' }}>{c.name}</div>
              </div>
              {i < chains.length - 1 && (
                <div style={{
                  flex: 1, position: 'relative', height: 2,
                  background: 'linear-gradient(90deg, rgba(79,125,255,0.2), rgba(168,127,255,0.3), rgba(79,125,255,0.2))',
                  margin: '0 -2px', alignSelf: 'center', marginTop: -15,
                }}>
                  {[0, 0.6, 1.2].map((d, j) => (
                    <span key={j} style={{
                      position: 'absolute', top: -3, width: 8, height: 8, borderRadius: '50%',
                      background: j % 2 ? P.violet : P.blue,
                      boxShadow: `0 0 12px ${j % 2 ? P.violet : P.blue}, 0 0 24px ${j % 2 ? P.violet : P.blue}`,
                      animation: 'nxHopFlow 1.8s linear infinite', animationDelay: `${d + i * 0.2}s`,
                    }} />
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{
          position: 'relative', zIndex: 2, marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: P.dim, letterSpacing: '0.06em',
        }}>
          <span><span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: P.green, boxShadow: `0 0 8px ${P.green}`, marginRight: 6, animation: 'nxPulse 1.4s infinite', verticalAlign: 'middle' }} />Routes Active</span>
          <span>Avg <b style={{ color: P.blue, fontWeight: 800 }}>~2 min</b> · <b style={{ color: P.blue, fontWeight: 800 }}>71 chains</b></span>
        </div>
      </div>

      {/* WIDGET TITLE */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 4px 10px' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, color: P.text, letterSpacing: '-0.01em' }}>Bridge</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 800, color: P.blue,
          border: `1px solid ${P.blueLine}`, borderRadius: 100, padding: '5px 11px', background: P.blueBg,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: P.blue, boxShadow: `0 0 8px ${P.blue}`, animation: 'nxPulse 1.6s ease-in-out infinite' }} />LIVE
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Inline sanctions screening — UNCHANGED
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

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/bridge': 'bridge',
  '/sol-to-btc': 'soltobtc', '/btc': 'soltobtc',
  '/wonderland': 'wonderland', '/memes': 'wonderland',
  '/markets': 'markets', '/tokenized': 'markets',
  '/portfolio': 'portfolio', '/token': 'portfolio',
  '/flipsy': 'flipsy', '/predict': 'flipsy',
  '/stack': 'swap', '/vip': 'swap', '/perps': 'swap', '/call': 'swap',
};
const TAB_TO_PATH = {
  swap: '/swap', bridge: '/bridge', soltobtc: '/sol-to-btc',
  wonderland: '/wonderland', markets: '/markets', portfolio: '/portfolio', flipsy: '/flipsy',
};
function tabFromPathname(pathname) { return PATH_TO_TAB[pathname] || 'swap'; }
export function useAppWallet() { return useNexusWallet(); }

function WalletIcon({ src, fallbackLetter, color, size }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size / 4),
      background: (color || '#586994') + '33',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 800,
      color: color || '#fff', flexShrink: 0,
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

// TermsGate — UNCHANGED
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(3,6,15,.50)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, maxHeight: '50dvh', zIndex: 1000,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#080d1a', border: '1px solid rgba(0,229,255,.22)',
        borderTop: '1px solid rgba(0,229,255,.30)', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -10px 40px rgba(0,0,0,.8), 0 0 20px rgba(0,229,255,.08)',
        fontFamily: 'Syne, sans-serif',
      }}>
        <div style={{ flexShrink: 0, paddingTop: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.15)' }} />
        </div>
        <div style={{ flexShrink: 0, padding: '8px 18px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.22)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00e5ff' }} />
            <span style={{ color: '#00e5ff', fontSize: 9, fontWeight: 700, letterSpacing: '.10em' }}>TERMS OF USE</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: '#586994' }}>Non-custodial · You assume all risk</div>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="scroll-contain" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '4px 18px 10px' }}>
          <div style={{ fontSize: 11, color: '#cdd6f4', lineHeight: 1.55 }}>
            By clicking <strong style={{ color: '#fff' }}>"Accept &amp; Continue"</strong> you agree that:<br /><br />
            • Nexus DEX is a non-custodial interface by Verixia Apps. We do not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br /><br />
            • <strong style={{ color: '#fff' }}>Compliance &amp; wallet screening.</strong> All wallet addresses are screened against U.S. OFAC, U.N., E.U., and U.K. sanctions lists via Chainalysis. Flagged wallets are denied access.<br /><br />
            • <strong style={{ color: '#fff' }}>Restricted jurisdictions.</strong> You are not located in, a resident of, or citizen of: Iran, North Korea, Cuba, Syria, Crimea, Donetsk, Luhansk, Sevastopol, or any other jurisdiction subject to comprehensive U.S., U.N., E.U., or U.K. sanctions.<br /><br />
            • <strong style={{ color: '#fff' }}>You are 18 or older</strong> and have full legal capacity to enter this agreement.<br /><br />
            • All swaps, routing, liquidity, and blockchain interactions are handled by third-party protocols. All transactions are signed directly by you through your own wallet.<br /><br />
            • DeFi and smart contracts carry substantial risk including total loss of funds. <strong style={{ color: '#fff' }}>You assume all risk.</strong><br /><br />
            • <strong style={{ color: '#fff' }}>No reimbursement.</strong> Verixia Apps will not refund or compensate any loss, regardless of cause.<br /><br />
            • <strong style={{ color: '#fff' }}>AS-IS / AS-AVAILABLE.</strong> No warranties of any kind.<br /><br />
            • <strong style={{ color: '#fff' }}>No liability.</strong> Verixia Apps is not liable for any damages arising from your use of Nexus DEX.<br /><br />
            • <strong style={{ color: '#fff' }}>No class actions.</strong> You waive any right to class action or jury trial against Verixia Apps.<br /><br />
            • <strong style={{ color: '#fff' }}>Binding arbitration.</strong> Disputes resolved through individual arbitration only.<br /><br />
            If you do not agree, discontinue use immediately.
          </div>
        </div>
        <div style={{ flexShrink: 0, padding: '8px 18px 14px', borderTop: '1px solid rgba(255,255,255,.04)', background: '#080d1a' }}>
          {!canAccept && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 10, color: '#586994', marginBottom: 8, fontWeight: 600, letterSpacing: '.04em' }}>
              <span>↓</span> Scroll to continue
            </div>
          )}
          <button onClick={canAccept ? onAccept : undefined} disabled={!canAccept}
            style={{
              width: '100%', padding: 12, borderRadius: 10, border: 'none',
              background: canAccept ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.05)',
              color: canAccept ? '#03060f' : '#586994',
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 14,
              cursor: canAccept ? 'pointer' : 'not-allowed',
              boxShadow: canAccept ? '0 6px 20px rgba(0,229,255,.25)' : 'none', transition: 'all .2s',
            }}>
            Accept &amp; Continue
          </button>
          <div style={{ fontSize: 9, color: '#586994', textAlign: 'center', marginTop: 8, fontWeight: 600, letterSpacing: '.06em' }}>
            NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS
          </div>
        </div>
      </div>
    </>
  );
}

// WalletModal — UNCHANGED
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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 501, background: '#080d1a',
        borderTop: '2px solid rgba(0,229,255,.2)', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)', maxHeight: 'min(85vh, 100dvh)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 24px 16px' }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 20px', cursor: 'pointer', padding: '8px 0', boxSizing: 'content-box' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {isBlocked ? 'Access Restricted' : anyConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </div>
            {displayAddr && !isBlocked && (
              <div style={{ fontSize: 13, color: '#586994' }}>{(connectedWalletName || 'Wallet')}: {displayAddr}</div>
            )}
            {isScreening && (<div style={{ fontSize: 12, color: C.accent, marginTop: 4 }}>Verifying wallet address...</div>)}
            {!anyConnected && !isBlocked && !isScreening && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Pick one. We never see your keys.</div>
            )}
          </div>
        </div>
        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {isBlocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.35)', borderRadius: 16, padding: '16px 18px' }}>
                <div style={{ color: '#ff3b6b', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Wallet not eligible</div>
                <div style={{ color: '#cdd6f4', fontSize: 12, lineHeight: 1.55 }}>
                  {mState.message} This is automated screening against major sanctions lists. If you believe this is an error, please try a different wallet.
                </div>
              </div>
              <button onClick={handleRetry} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.30)', borderRadius: 16, padding: 14, cursor: 'pointer', width: '100%', color: C.accent, fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Try a different wallet</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 12, cursor: 'pointer', color: '#586994', fontSize: 13, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : anyConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
                <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{displayAddr || '(provisioning...)'}</div>
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}>Disconnect</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {(mState.kind === 'error' || isTimedOut) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'rgba(255,149,0,.10)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '10px 14px' }}>
                  <span style={{ color: '#ff9500', fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid #ff9500', color: '#ff9500', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                </div>
              )}
              {availableOpts.length > 0 ? availableOpts.map(opt => {
                const isPending = isConnecting && pendingWallet === opt.pendingMatch;
                const disabled  = isConnecting || isTimedOut;
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: isPending ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.025)',
                    border: '1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)'),
                    borderRadius: 12, padding: '11px 14px',
                    cursor: disabled ? 'wait' : 'pointer', width: '100%',
                    opacity: isTimedOut && !isPending ? 0.55 : 1,
                    transition: 'background .15s, border-color .15s',
                  }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={32} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{opt.name}</div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isPending ? (isScreening ? 'Verifying address...' : 'Check your wallet...') : opt.subtitle}
                      </div>
                    </div>
                    {isPending && <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />}
                  </button>
                );
              }) : (
                <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
                  No wallets detected. Install Phantom or open from your wallet browser.
                </div>
              )}
              <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 6 }}>Non-custodial. We never see or store your keys.</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Nav icons
function IconSwap()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconWallet()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
function IconMarkets()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>; }
function IconBridge()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 Q12 4 20 12"/><path d="M4 12v4"/><path d="M20 12v4"/><path d="M4 16h16"/><path d="M9 12v4"/><path d="M15 12v4"/></svg>; }
function IconWonderland() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 6.4L21 10l-5.4 4 1.8 7L12 17.5 6.6 21l1.8-7L3 10l6.6-1.6L12 2z"/></svg>; }
function IconFlipsy()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 10l4-4 4 4"/><path d="M8 14l4 4 4-4"/></svg>; }
function IconBtc()        { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 7v10"/><path d="M9.5 7h4a2.5 2.5 0 0 1 0 5h-4"/><path d="M9.5 12h4.5a2.5 2.5 0 0 1 0 5h-4.5"/><path d="M11 5v2"/><path d="M11 17v2"/><path d="M14 5v2"/><path d="M14 17v2"/></svg>; }

const NAV_ICONS = { swap: IconSwap, bridge: IconBridge, soltobtc: IconBtc, wonderland: IconWonderland, markets: IconMarkets, portfolio: IconWallet, flipsy: IconFlipsy };
const NAV_TABS = [
  { id: 'swap', label: 'Swap' }, { id: 'bridge', label: 'Bridge' }, { id: 'soltobtc', label: 'SOL→BTC' },
  { id: 'wonderland', label: 'Wonderland' }, { id: 'markets', label: 'Markets' }, { id: 'flipsy', label: 'Flipsy' },
  { id: 'portfolio', label: 'Wallet' },
];

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
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

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

  // Smooth-scroll to the swap widget when the homepage CTA is clicked
  const scrollToSwapWidget = useCallback(() => {
    const el = swapWidgetRef.current;
    if (!el) return;
    const headerH = (document.querySelector('header')?.offsetHeight || 0);
    const y = el.getBoundingClientRect().top + window.scrollY - headerH - 12;
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
    ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4)
    : null;

  // SOL→BTC: admin wallets always allowed
  const canUseSolToBtc = wallet.walletAddress && ADMIN_WALLETS.has(wallet.walletAddress);

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.02) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
      <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(0,229,255,0.08)', background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', height: 56, gap: 12 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00e5ff,#0066ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: C.bg }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{ fontSize: 9, color: C.accent, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>DEX</span>
          </div>
          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {NAV_TABS.map(t => (
              <button key={t.id} onClick={() => switchTab(t.id)} style={{
                background: tab === t.id ? 'rgba(0,229,255,.09)' : 'transparent',
                border: tab === t.id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
                borderRadius: 8, padding: '5px 12px', color: tab === t.id ? C.accent : C.muted,
                fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>{t.label}</button>
            ))}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none',
            borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12,
            color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap',
          }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>
        </div>
      </header>
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap' && (
          <>
            <SwapHero onStartTrading={switchTab} onScrollToWidget={scrollToSwapWidget} />
            <div ref={swapWidgetRef}>
              <SwapWidget {...sharedProps} />
            </div>
          </>
        )}
        {tab === 'bridge' && <><BridgeHero onSwitchTab={switchTab} /><CrossChainSwap onConnectWallet={openWallet} /></>}
        {tab === 'soltobtc' && (
          canUseSolToBtc
            ? <SolToBtc onConnectWallet={openWallet} />
            : (
              <div style={{
                maxWidth: 420, margin: '60px auto', padding: 32,
                background: 'rgba(247,147,26,.06)',
                border: '1px solid rgba(247,147,26,.28)',
                borderRadius: 18, textAlign: 'center',
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
                <div style={{ color: '#f7931a', fontWeight: 800, fontSize: 18, marginBottom: 8 }}>SOL → BTC</div>
                <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>Coming soon.</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Native Bitcoin bridging powered by LI.FI. Currently in testing.</div>
              </div>
            )
        )}
        {tab === 'wonderland' && <MemeWonderland onConnectWallet={openWallet} />}
        {tab === 'markets'    && <Stocks {...sharedProps} />}
        {tab === 'flipsy'     && <Flipsy onConnectWallet={openWallet} />}
        {tab === 'portfolio'  && <Portfolio onConnectWallet={openWallet} />}
      </main>
      <nav className="mobile-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0,229,255,.1)',
        display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {NAV_TABS.map(t => {
          const Icon = NAV_ICONS[t.id];
          return (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t.id ? C.accent : C.muted,
              fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
              padding: '6px 2px', minHeight: 54, position: 'relative',
            }}>
              {tab === t.id && (<div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />)}
              <Icon />
              <span>{t.label}</span>
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
