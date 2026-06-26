import React, { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget          from './components/SwapWidget.jsx';
import Stocks, { BRANDS, fetchBrandPrices, stkFetchSeries, stkBuildPath, stkThrottle } from './components/Stocks.jsx';
import * as StocksNS from './components/Stocks.jsx';
// Optional named export read off the namespace so a stale Stocks.jsx (missing the
// export) can't break the build. Renders the real buy/sell modal when present.
const StockTradeModal = StocksNS.TradeModal;
import CrossChainSwap      from './components/CrossChainSwap.jsx';
import SolToBtcChainflip   from './components/SolToBtcChainflip.jsx';
import MemeWonderland      from './components/MemeWonderland.jsx';
import LaunchRadar from './components/LaunchRadar.jsx';
import Ape                 from './components/Ape.jsx';
import Flipsy              from './components/Flipsy.jsx';
import GetStarted          from './components/GetStarted.jsx';
import Holdings            from './components/Holdings.jsx';
import ReferralsPage       from './components/ReferralsPage.jsx';
import WhyNexus            from './components/WhyNexus.jsx';
import AdminPage           from './components/AdminPage.jsx';
import BuySolana          from './components/BuySolana.jsx';
 
// =====================================================================
// Wonderland-light design tokens
// =====================================================================
const C = {
  ink:    '#0b0b0c',
  ink2:   '#86868b',
  ink3:   '#aeaeb2',
  cyan:   '#2f6bff',
  sky:    '#2f6bff',
  pink:   '#7c5cff',
  lav:    '#7c5cff',
  mint:   '#16c08a',
  peach:  '#f5921b',
  gold:   '#a67200',
  green:  '#16c08a',
  red:    '#f0425a',
  down:   '#9d8cff',
  glass:        '#ffffff',
  glassStrong:  '#ffffff',
  border:       '#e9e9eb',
  borderHi:     '#0b0b0c',
  hairline:     '#f1f1f2',
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

.nx-fixed-blob{display:none !important;
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
    { ic: '⚡', lbl: 'Launches', tab: 'ape' },
    { ic: '✨', lbl: 'Memes',   tab: 'wonderland' },
    { ic: '📈', lbl: 'Stocks',  tab: 'markets' },
    { ic: '👜', lbl: 'Wallet',  tab: 'holdings' },
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
function SwapHero() {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
      {/* THE EDGE — our differentiator, up top */}
      <div style={{ display: 'flex', gap: 7, marginTop: 4 }}>
        {['No KYC', 'No Account', 'No Limits'].map(label => (
          <div key={label} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: C.glassStrong, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: '10px 4px', fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800, fontSize: 13, color: C.ink, letterSpacing: '-0.01em',
          }}>
            <span style={{ color: C.cyan, fontWeight: 800 }}>✕</span>{label}
          </div>
        ))}
      </div>

      {/* TRUST ROW — real signals only */}
      <div style={{
        marginTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, flexWrap: 'wrap', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10, fontWeight: 700, color: C.ink3, letterSpacing: '0.08em',
      }}>
        <span>Powered by</span>
        <span style={{ color: C.ink2, fontWeight: 800 }}>JUPITER</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: C.ink2, fontWeight: 800 }}>DEXSCREENER</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: C.ink2, fontWeight: 800 }}>CHAINALYSIS</span>
      </div>

      {/* CREDENTIALS — all literally true: Jupiter programs audited (OtterSec & Sec3);
          non-custodial (keys never leave the user); Chainalysis wallet sanctions screening. */}
      <div style={{
        marginTop: 5, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em',
      }}>
        Routing audited by OtterSec & Sec3 · Non-custodial · Wallets sanctions-screened
      </div>

    </div>
  );
}

// =====================================================================
// HomeLive — live Launch Radar + xStocks strips (inlined). Reuses the
// SAME calls as the full pages: /api/dex/launches (+ normalize), the
// BRANDS catalog priced via fetchBrandPrices (Jupiter price/v3), and
// stkFetchSeries/stkBuildPath sparklines paced by stkThrottle.
// =====================================================================
const MONO = "'JetBrains Mono', monospace";
const SERIF = "'Instrument Serif', serif";

function fmtUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (n >= 1)   return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toPrecision(2);
}
function fmtPct(n) {
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function pctFromSeries(pts) {
  if (!pts || pts.length < 2) return null;
  const a = pts[0].c, b = pts[pts.length - 1].c;
  if (!(a > 0)) return null;
  return ((b - a) / a) * 100;
}

// draw-only sparkline — smooth curve. Fed by the OHLCV the strip already
// fetched (pts) or live observed ticks. When the series is thin (a fresh
// launch with only a couple of points), it draws a gentle eased trend in the
// real direction instead of a flat 2-point diagonal. Curve via Catmull-Rom.
const _spkHist = new Map();
function recordSpark(mint, price) {
  if (!mint || !(price > 0)) return _spkHist.get(mint) || [];
  let pts = _spkHist.get(mint);
  if (!pts) { pts = []; _spkHist.set(mint, pts); }
  if (pts[pts.length - 1] !== price) { pts.push(price); if (pts.length > 32) pts.shift(); }
  return pts;
}
// Thin series → resample into a few eased points so the curve reads as a soft
// trend, not a straight line. Keeps the real first/last values (true direction).
function _spkSeed(str) {
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) || 1) >>> 0;
}
function _spkPrep(vals, seed = 0) {
  if (vals.length >= 6) return vals;
  const a = vals[0], b = vals[vals.length - 1];
  // Seeded wobble so two thin tokens don't render the identical S-curve.
  const span = Math.abs(b - a) || Math.abs(a) * 0.04 || 1;
  const amp  = span * 0.55;
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = 6, out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), e = t * t * (3 - 2 * t);
    let v = a + (b - a) * e;
    if (i > 0 && i < n - 1) v += (rnd() - 0.5) * amp * Math.sin(t * Math.PI);
    out.push(v);
  }
  out[0] = a; out[n - 1] = b;
  return out;
}
function _spkSmoothPath(vals, w, h, pad) {
  const n = vals.length;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!(hi > lo)) { const m = lo || 1; hi = m * 1.001; lo = m * 0.999; }
  const x = i => pad + (i / (n - 1)) * (w - pad * 2);
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  const P = vals.map((v, i) => ({ x: x(i), y: y(v) }));
  let d = `M${P[0].x.toFixed(2)},${P[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return { line: d, area: d + ` L${P[n - 1].x.toFixed(2)},${h} L${P[0].x.toFixed(2)},${h} Z`, lastX: P[n - 1].x, lastY: P[n - 1].y };
}
function Spark({ pts, mint, price, w = 60, h = 30 }) {
  const hist = recordSpark(mint, Number(price));
  const obs  = hist.length >= 2 ? hist.map(c => ({ c })) : null;
  const use  = (pts && pts.length >= 2) ? pts : obs;   // prefer OHLCV, else observed ticks
  if (!use) return <svg width={w} height={h} style={{ display: 'block', flex: '0 0 auto' }} />;
  const vals = _spkPrep(use.map(p => p.c), _spkSeed(mint));
  const up   = vals[vals.length - 1] >= vals[0];
  const col  = up ? C.green : C.down;
  const path = _spkSmoothPath(vals, w, h, 3);
  const gid  = 'spk' + (mint ? String(mint).slice(0, 6) : '') + (up ? 'u' : 'd');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', flex: '0 0 auto', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity="0.20" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.area} fill={`url(#${gid})`} />
      <path d={path.line} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.lastX.toFixed(2)} cy={path.lastY.toFixed(2)} r="1.9" fill={col} />
    </svg>
  );
}

function SectionHead({ title, italic, meta, onAll }) {
  return (
    <div style={{ padding: '24px 4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <h2 style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1, color: C.ink, letterSpacing: '-0.015em', fontWeight: 400, margin: 0 }}>
        {title} <em style={{ fontStyle: 'italic', background: 'linear-gradient(120deg,#A0E7FF,#FF8FBE)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{italic}</em>
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 9, fontWeight: 700, color: C.green, letterSpacing: '0.12em', background: 'rgba(22,192,138,.10)', border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 999 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, animation: 'nx-pulse 1.4s infinite' }} />{meta}
        </span>
        {onAll && (
          <button onClick={onAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.cyan, letterSpacing: '0.06em' }}>All →</button>
        )}
      </div>
    </div>
  );
}

function ListShell({ children }) {
  return (
    <div style={{ borderRadius: 18, overflow: 'hidden', background: C.glass, backdropFilter: 'blur(10px)', border: `1px solid ${C.border}` }}>
      {children}
    </div>
  );
}

function Row({ onClick, last, ico, grad, sym, tag, sub, price, pct, pts, mint, rawPrice }) {
  const up = Number.isFinite(pct) ? pct >= 0 : true;
  const isImg = typeof ico === 'string' && /^https?:\/\//.test(ico);
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', width: '100%',
      background: 'transparent', border: 'none', borderBottom: last ? 'none' : `1px solid ${C.hairline}`,
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', flex: '0 0 auto',
        color: '#fff', fontWeight: 800, fontSize: 13, background: grad, backgroundSize: 'cover', backgroundPosition: 'center',
        ...(isImg ? { backgroundImage: `url(${ico})` } : {}),
      }}>{!isImg ? (ico || '?') : ''}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6, color: C.ink }}>
          {sym}
          {tag && <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, color: C.ink3, background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, letterSpacing: '0.04em' }}>{tag}</span>}
        </div>
        <div style={{ fontSize: 11, color: C.ink3, fontWeight: 500, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <Spark pts={pts} mint={mint} price={rawPrice} />
      <div style={{ textAlign: 'right', flex: '0 0 auto', minWidth: 62 }}>
        <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.ink }}>{price}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, marginTop: 1, color: up ? C.green : C.lav }}>{fmtPct(pct)}</div>
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick && onClick(); } }}
        style={{
          flex: '0 0 auto', border: 'none', borderRadius: 9, background: C.green, color: '#fff',
          fontFamily: 'inherit', fontWeight: 800, fontSize: 11, letterSpacing: '0.02em',
          padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
        }}
      >Buy</span>
    </button>
  );
}

// ── Token detail bottom-sheet chart ──────────────────────────────────
// Copied verbatim in behavior from Ape.jsx TokenChart: live embedded iframe,
// GeckoTerminal primary (covers fresh bonding-curve pools) → DexScreener
// fallback. Pool resolved BY CONTRACT (exact base-token match) + deepest USD
// liquidity, so the chart can never show a look-alike token. Defaults to the
// 1s resolution so the chart is live and moving the moment the sheet opens.
const CHART_RES = [
  { key: '1s',  label: '1s', gecko: '1s',  dex: '1S'  },
  { key: '15s', label: '15s', gecko: '15s', dex: '15S' },
  { key: '1m',  label: '1m', gecko: '1m',  dex: '1'   },
  { key: '5m',  label: '5m', gecko: '5m',  dex: '5'   },
  { key: '1h',  label: '1H', gecko: '1h',  dex: '60'  },
];
const CHART_RES_DEFAULT = '1s';

function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = 'solana_' + mint;                         // EXACT — Solana base58 is case-sensitive
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const quoteId = p => String(p?.relationships?.quote_token?.data?.id || '');
  const hasAddr = p => !!p?.attributes?.address;
  const baseMatches = pools.filter(p => hasAddr(p) && baseId(p) === wanted);
  const pool = baseMatches.length
    ? baseMatches
    : pools.filter(p => hasAddr(p) && (baseId(p) === wanted || quoteId(p) === wanted));
  if (!pool.length) return null;
  return pool.reduce(
    (best, p) => (Number(p?.attributes?.reserve_in_usd) || 0) > (Number(best?.attributes?.reserve_in_usd) || 0) ? p : best,
    pool[0],
  );
}
function pickBestPair(pairs, mint) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const baseMatches = pairs.filter(
    p => p && p.chainId === 'solana' && p.pairAddress &&
         p.baseToken?.address === mint);                   // EXACT, case-sensitive
  const pool = baseMatches.length
    ? baseMatches
    : pairs.filter(
        p => p && p.chainId === 'solana' && p.pairAddress &&
             (p.baseToken?.address === mint ||
              p.quoteToken?.address === mint));
  if (!pool.length) return null;
  return pool.reduce(
    (best, p) => (Number(p.liquidity?.usd) || 0) > (Number(best.liquidity?.usd) || 0) ? p : best,
    pool[0],
  );
}
function buildEmbedSrc(pool, resKey) {
  if (!pool) return null;
  const r = CHART_RES.find(x => x.key === resKey) || CHART_RES[0];
  if (pool.provider === 'GECKOTERMINAL') {
    return 'https://www.geckoterminal.com/solana/pools/' + pool.addr +
      '?embed=1&info=0&swaps=0&grayscale=0&light_chart=1&bg_color=ffffff&resolution=' + r.gecko;
  }
  return 'https://dexscreener.com/solana/' + pool.addr +
    '?embed=1&theme=light&info=0&trades=0&interval=' + r.dex;
}

function SheetChart({ mint, sym }) {
  const [status, setStatus] = useState('loading'); // loading | ok | none | fail
  const [pool, setPool]     = useState(null);       // { provider, addr }
  const [res, setRes]       = useState(CHART_RES_DEFAULT);
  const reqRef = useRef(0);

  useEffect(() => { setRes(CHART_RES_DEFAULT); }, [mint]);

  useEffect(() => {
    if (!mint) { setStatus('none'); setPool(null); return; }
    const id = ++reqRef.current;
    setStatus('loading'); setPool(null);

    (async () => {
      let networkOk = false;
      // GeckoTerminal only — covers pump.fun bonding-curve pools and graduated pairs.
      try {
        const r = await fetch(
          'https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + mint + '/pools',
          { headers: { Accept: 'application/json' } });
        if (id !== reqRef.current) return;
        if (r.ok) {
          networkOk = true;
          const j = await r.json();
          if (id !== reqRef.current) return;
          const best = pickBestGeckoPool(j?.data, mint);
          const addr = best?.attributes?.address;
          if (addr) { setPool({ provider: 'GECKOTERMINAL', addr }); setStatus('ok'); return; }
        }
      } catch (e) {}
      if (id !== reqRef.current) return;

      setStatus(networkOk ? 'none' : 'fail');
    })();
  }, [mint]);

  const src = useMemo(() => buildEmbedSrc(pool, res), [pool, res]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: C.ink3 }}>CA {mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : ''}</span>
        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.ink3 }}>{pool?.provider || 'CHART'}</span>
      </div>
      <div style={{
        width: '100%', height: 'clamp(300px,44dvh,440px)', borderRadius: 16, overflow: 'hidden',
        border: '1px solid ' + C.hairline, background: '#fff', position: 'relative',
        display: status === 'ok' ? 'block' : 'grid', placeItems: 'center', textAlign: 'center',
      }}>
        {status === 'ok' && src ? (
          <iframe
            key={pool.provider + ':' + pool.addr + ':' + res}
            src={src}
            title={(sym || 'Token') + ' price chart'}
            loading="lazy"
            allow="clipboard-write"
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          />
        ) : status === 'loading' ? (
          <span style={{ width: 24, height: 24, borderRadius: '50%', border: '2.5px solid ' + C.border, borderTopColor: '#0b0b0c', animation: 'nx-spin .8s linear infinite' }} />
        ) : status === 'none' ? (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, padding: '0 24px', lineHeight: 1.5 }}>Chart appears once ${sym || 'this token'} is indexed — trading on the bonding curve for now.</span>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink3, padding: '0 24px' }}>Couldn’t load the chart. Try again shortly.</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 2px 0' }}>
        {CHART_RES.map(r => (
          <button key={r.key} type="button" disabled={status !== 'ok'} onClick={() => setRes(r.key)} style={{
            flex: '0 0 auto', fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
            color: r.key === res ? C.ink : C.ink2, background: r.key === res ? '#f4f4f5' : 'transparent',
            border: 'none', padding: '6px 11px', borderRadius: 8,
            cursor: status === 'ok' ? 'pointer' : 'default', opacity: status === 'ok' ? 1 : 0.4,
          }}>{r.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.ink3 }}>
          {status === 'ok' ? '● Live · ' + ((CHART_RES.find(x => x.key === res) || {}).label) : 'Live'}
        </span>
      </div>
    </div>
  );
}



// ═════════════════════════════════════════════════════════════════════
// PUMP.FUN BUY/SELL — inlined verbatim from LaunchRadar (no cross-page
// import). 3% SOL fee → FEE_WALLET, atomic in the same signed tx. Sim →
// user signs the simulated tx → send. No re-fetch between sim and sign.
// ═════════════════════════════════════════════════════════════════════
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const FEE_WALLET  = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS     = 300;   // 3%
const SOL_RESERVE = 0.01;
const TRADE_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const TRADE_SELL_PRESETS = [25, 50, 100];
const BAL_COMMITMENT = 'processed';
const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';
const _connCache = new Map();
const tradeGetConn = (commitment, url = RPC_URL) => {
  const key = url + '|' + commitment;
  let c = _connCache.get(key);
  if (!c) { c = new Connection(url, commitment); _connCache.set(key, c); }
  return c;
};
const _tradeConnCache = new Map();
const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};
const balRpcRace = (op) => op(tradeGetConn(BAL_COMMITMENT));

function tradeFmtSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1)    return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
function tradeFmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1)   return n.toFixed(2);
  return n.toPrecision(3);
}
const tradeFriendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('user reject') || m.includes('user denied') || m.includes('cancelled') || m.includes('request rejected')) return 'Cancelled.';
  if (m.includes('graduat')) return 'Token graduated off the bonding curve — not tradable here.';
  if (m.includes('not a pump') || m.includes('not indexed')) return 'Not a pump.fun bonding-curve token.';
  if (m.includes('slippage')) return 'Price moved past slippage — try again.';
  if (m.includes('insufficient') || m.includes('debit an account')) return 'Not enough SOL for this trade + fees.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Tx expired — retry.';
  if (m.includes("didn't confirm") || m.includes('not confirm')) return "Sent but didn't confirm — check Solscan before retrying.";
  if (m.includes('simulation failed')) return 'Trade would fail right now — price likely moved.';
  if (m.includes('rate')) return 'Rate limited — try again.';
  return err?.message?.slice(0, 200) || 'Trade failed.';
};
function tradeDescribeSimLogs(logs, fallbackMsg) {
  const arr = Array.isArray(logs) ? logs : [];
  const j = arr.join('\n').toLowerCase();
  if (j.includes('slippage') || j.includes('toomuchsol') || j.includes('toolittlesol')) return 'Price moved past slippage — try again.';
  if (j.includes('insufficient') || j.includes('debit an account')) return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '').replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed → ' + ctx;
  return fallbackMsg ? ('Sim failed → ' + String(fallbackMsg).slice(0, 160)) : 'Sim failed (no logs returned).';
}
async function tradeDecodeBuiltTx(b64, connection) {
  const txBytes = Buffer.from(b64, 'base64');
  const tx      = VersionedTransaction.deserialize(txBytes);
  const message = tx.message;
  const lookupKeys = (message.addressTableLookups || []).map(l => l.accountKey);
  const alts = [];
  if (lookupKeys.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(lookupKeys);
    for (let i = 0; i < lookupKeys.length; i++) {
      if (!infos[i]) continue;
      alts.push(new AddressLookupTableAccount({ key: lookupKeys[i], state: AddressLookupTableAccount.deserialize(infos[i].data) }));
    }
  }
  const decompiled = TransactionMessage.decompile(message, { addressLookupTableAccounts: alts });
  return { instructions: decompiled.instructions, alts };
}
async function tradeGetPumpRoute({ action, mint, user, amount, decimals, connection }) {
  const body = { action, mint, user: user.toBase58(), amount: String(amount) };
  if (decimals != null) body.decimals = Number(decimals);
  const r = await fetch('/api/pumpfun/trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || ('pump HTTP ' + r.status));
  if (!data.tx) throw new Error('PumpPortal returned no tx.');
  const { instructions, alts } = await tradeDecodeBuiltTx(data.tx, connection);
  return { instructions, alts, pool: data.pool, route: data.route };
}

// Balances + SOL price + executeSwap, packaged as a hook so TokenSheet stays clean.
function useTradeEngine() {
  const walletObj = useWallet();   // adapter wallet — publicKey + signTransaction (same as LaunchRadar)
  const [solPrice, setSolPrice] = useState(0);
  const [balances, setBalances] = useState({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try { const r = await fetch('/api/dex/sol-price'); if (!r.ok) return; const d = await r.json(); if (!cancelled && d?.price) setSolPrice(d.price); } catch {}
    };
    load(); const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const refreshSol = useCallback(async () => {
    if (!walletObj.publicKey) return;
    try { const lamports = await balRpcRace(c => c.getBalance(walletObj.publicKey, BAL_COMMITMENT)); setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(lamports), decimals: 9, uiAmount: lamports / 1e9 } })); } catch {}
  }, [walletObj.publicKey]);
  const refreshOneToken = useCallback(async (mintStr) => {
    if (!walletObj.publicKey || !mintStr || mintStr === SOL_MINT) return;
    let mintPk; try { mintPk = new PublicKey(mintStr); } catch { return; }
    try {
      const accs = await balRpcRace(c => c.getParsedTokenAccountsByOwner(walletObj.publicKey, { mint: mintPk }, BAL_COMMITMENT));
      let best = null;
      for (const acc of (accs?.value || [])) {
        const info = acc.account?.data?.parsed?.info; const amt = info?.tokenAmount?.amount;
        if (amt == null) continue; const ui = Number(info.tokenAmount?.uiAmount || 0);
        if (!best || ui > best.uiAmount) best = { amount: String(amt), decimals: Number(info.tokenAmount?.decimals ?? 6), uiAmount: ui };
      }
      setBalances(prev => ({ ...prev, [mintStr]: best || { amount: '0', decimals: 6, uiAmount: 0 } }));
    } catch {}
  }, [walletObj.publicKey]);

  const executeSwap = useCallback(async ({ mode, swapParams, token }) => {
    if (!walletObj.publicKey || !walletObj.signTransaction) throw new Error('Please connect a wallet (Phantom, Solflare, Backpack).');
    if (!swapParams) throw new Error('Nothing to trade.');
    const isBuy = mode === 'buy';
    const userPk = walletObj.publicKey;
    const tradeConnection = getTradeConn('confirmed');
    const route = await tradeGetPumpRoute({
      action: isBuy ? 'buy' : 'sell', mint: token.mint, user: userPk,
      amount: isBuy ? swapParams.tradeLamports : swapParams.tradeTokens,
      decimals: isBuy ? undefined : swapParams.decimals, connection: tradeConnection,
    });
    const feeLamports = BigInt(swapParams.feeLamports || '0');
    if (feeLamports <= 0n) throw new Error(isBuy ? 'Fee rounds to zero — amount too small.' : 'Could not estimate sell fee — token or SOL price unavailable.');
    const feeIx = SystemProgram.transfer({ fromPubkey: userPk, toPubkey: FEE_WALLET, lamports: Number(feeLamports) });
    const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    const ixs = route.instructions.slice();
    if (isBuy) { let at = 0; while (at < ixs.length && ixs[at].programId.toBase58() === CB_PROGRAM) at++; ixs.splice(at, 0, feeIx); }
    else { ixs.push(feeIx); }
    const latest = await tradeConnection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: userPk, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message(route.alts);
    const tx = new VersionedTransaction(message);
    let simLogs = null;
    try {
      const sim = await tradeConnection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' });
      simLogs = sim?.value?.logs || null;
      if (sim?.value?.err) throw new Error(tradeDescribeSimLogs(simLogs, JSON.stringify(sim.value.err)));
    } catch (simErr) {
      if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr;
    }
    const signed = await walletObj.signTransaction(tx);
    const raw = signed.serialize();
    let sig;
    try { sig = await tradeConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 }); }
    catch (sendErr) { let logs = sendErr?.logs || null; if (!logs && typeof sendErr?.getLogs === 'function') { try { logs = await sendErr.getLogs(tradeConnection); } catch {} } throw new Error(tradeDescribeSimLogs(logs, sendErr?.message)); }
    let confirmed = false, onchainErr = null; const startedAt = Date.now();
    while (Date.now() - startedAt < 60000) {
      try { const st = await tradeConnection.getSignatureStatus(sig, { searchTransactionHistory: true }); if (st?.value?.err) { onchainErr = st.value.err; break; } const cs = st?.value?.confirmationStatus; if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; } } catch {}
      try { const h = await tradeConnection.getBlockHeight('confirmed'); if (h > latest.lastValidBlockHeight) break; } catch {}
      try { await tradeConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    if (onchainErr) throw new Error('Trade failed on-chain — price likely moved past slippage.');
    setTimeout(() => { refreshSol(); refreshOneToken(token.mint); }, 1500);
    return { sig, confirmed };
  }, [walletObj, refreshSol, refreshOneToken]);

  return { solPrice, balances, refreshSol, refreshOneToken, executeSwap, canSign: !!(walletObj.publicKey && walletObj.signTransaction) };
}

function TokenSheet({ token, onClose, onOpenFull, onConnectWallet }) {
  const up = Number.isFinite(token.pct) ? token.pct >= 0 : true;
  const isImg = typeof token.ico === 'string' && /^https?:\/\//.test(token.ico);

  const { solPrice, balances, refreshSol, refreshOneToken, executeSwap, canSign } = useTradeEngine();
  const [mode, setMode]       = useState('buy');
  const [amount, setAmount]   = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(null);

  useEffect(() => { refreshSol(); refreshOneToken(token.mint); }, [token.mint, refreshSol, refreshOneToken]);
  useEffect(() => { setAmount(''); setError(null); setDone(null); }, [mode]);
  useEffect(() => { setError(null); }, [amount]);

  const isBuy   = mode === 'buy';
  const presets = isBuy ? TRADE_BUY_PRESETS : TRADE_SELL_PRESETS;
  const solBalance   = balances[SOL_MINT];
  const tokenBalance = balances[token.mint];
  const ownedUiAmount = tokenBalance?.uiAmount || 0;
  const availSol = Math.max(0, (solBalance?.uiAmount || 0)); // no reserve

  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (isBuy) {
      const totalLamports = BigInt(Math.floor(n * 1e9));
      if (totalLamports <= 0n) return null;
      const feeLamports   = (totalLamports * BigInt(FEE_BPS)) / 10000n;
      const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
      if (tradeLamports <= 0n || feeLamports <= 0n) return null;
      return { mode: 'buy', solAmount: n, totalLamports: totalLamports.toString(), tradeLamports: tradeLamports.toString(), feeLamports: feeLamports.toString() };
    }
    if (!tokenBalance || !tokenBalance.amount || BigInt(tokenBalance.amount) <= 0n) return null;
    const pct = Math.min(100, Math.max(0.01, n));
    const tradeTokens = (BigInt(tokenBalance.amount) * BigInt(Math.floor(pct * 100))) / 10000n;
    if (tradeTokens <= 0n) return null;
    const decimals = tokenBalance.decimals || token.decimals || 6;
    const tradeTokensUi = Number(tradeTokens) / Math.pow(10, decimals);
    let feeLamports = '0';
    if (token?.price > 0 && solPrice > 0) {
      const grossSol = (tradeTokensUi * token.price) / solPrice;
      const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
      if (lam > 0) feeLamports = String(lam);
    }
    return { mode: 'sell', decimals, percentage: pct, tradeTokens: tradeTokens.toString(), tradeTokensUi, feeLamports };
  }, [amount, isBuy, token, tokenBalance, solPrice]);

  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return Number(amount) <= availSol;
    return ownedUiAmount > 0;
  })();
  const needsWallet = !canSign;
  const confirmDisabled = confirming || !swapParams || (!needsWallet && !hasFunds) || !!error;

  const handleConfirm = async () => {
    if (!swapParams || confirming) return;
    setConfirming(true); setError(null);
    try {
      const res = await executeSwap({ mode, swapParams, token });
      setDone({ mode, sig: res.sig });
      setAmount('');
    } catch (e) { setError(tradeFriendlyError(e)); }
    finally { setConfirming(false); }
  };

  const tabBtn = (m, label) => (
    <button onClick={() => setMode(m)} style={{
      flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
      fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 14,
      background: mode === m ? (m === 'buy' ? C.green : C.red) : 'transparent',
      color: mode === m ? '#fff' : C.ink2,
    }}>{label}</button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(26,27,78,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 601, background: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '14px 18px 26px', maxWidth: 560, margin: '0 auto', boxShadow: '0 -12px 40px rgba(26,27,78,.18)', maxHeight: '92dvh', overflowY: 'auto' }}>
        <div onClick={onClose} style={{ width: 40, height: 4, background: 'rgba(26,27,78,.18)', borderRadius: 99, margin: '0 auto 18px', cursor: 'pointer' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 17, background: token.grad, backgroundSize: 'cover', backgroundPosition: 'center', flex: '0 0 auto', ...(isImg ? { backgroundImage: `url(${token.ico})` } : {}) }}>{!isImg ? (token.ico || '?') : ''}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: C.ink, letterSpacing: '-0.01em' }}>{token.sym}</div>
            <div style={{ fontSize: 12, color: C.ink3, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{token.name}</div>
          </div>
          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: C.ink }}>{fmtUsd(token.price)}</div>
            <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, marginTop: 1, color: up ? C.green : C.lav }}>{fmtPct(token.pct)}</div>
          </div>
        </div>

        <SheetChart mint={token.mint} sym={token.sym} />

        {token.stats && (
          <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.ink3, letterSpacing: '0.02em' }}>{token.stats}</div>
        )}

        {/* BUY / SELL */}
        <div style={{ display: 'flex', gap: 6, marginTop: 16, background: '#f4f4f5', borderRadius: 14, padding: 4 }}>
          {tabBtn('buy', 'Buy')}
          {tabBtn('sell', 'Sell')}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.ink3 }}>
          <span>{isBuy ? 'You pay (SOL)' : 'You sell (%)'}</span>
          <span>{isBuy
            ? <>Wallet: {tradeFmtSol(solBalance?.uiAmount || 0)} SOL{availSol > 0 && <button onClick={() => setAmount(String(Math.floor(Math.max(0, availSol - 0.002) * 10000) / 10000))} style={{ marginLeft: 8, background: C.ink, color: '#fff', border: 'none', borderRadius: 6, padding: '2px 7px', fontSize: 9, fontWeight: 800, cursor: 'pointer', fontFamily: MONO }}>MAX</button>}</>
            : <>You own: {tradeFmtTokens(ownedUiAmount)} {token.sym}</>}</span>
        </div>

        <input
          type="text" inputMode="decimal" placeholder={isBuy ? '0.00' : '0'} value={amount}
          onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); if (v.split('.').length > 2) return; if (!isBuy && Number(v) > 100) { setAmount('100'); return; } setAmount(v); }}
          style={{ width: '100%', marginTop: 8, padding: '14px 16px', borderRadius: 14, border: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 18, fontWeight: 700, color: C.ink, outline: 'none' }}
        />

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {presets.map(v => (
            <button key={v} onClick={() => setAmount(String(v))} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${Number(amount) === v ? (isBuy ? C.green : C.red) : C.border}`,
              background: Number(amount) === v ? (isBuy ? 'rgba(22,192,138,.10)' : 'rgba(240,66,90,.08)') : '#fff',
              fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.ink,
            }}>{isBuy ? v + ' SOL' : v + '%'}</button>
          ))}
        </div>

        {error && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(240,66,90,.10)', color: C.red, fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{error}</div>}
        {done && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(22,192,138,.10)', color: C.green, fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{done.mode === 'buy' ? 'Bought' : 'Sold'} {token.sym} ✓ <a href={`https://solscan.io/tx/${done.sig}`} target="_blank" rel="noopener noreferrer" style={{ color: C.green, textDecoration: 'underline' }}>view</a></div>}

        <button onClick={handleConfirm} disabled={confirmDisabled} style={{
          marginTop: 16, width: '100%', padding: 16, borderRadius: 16, border: 'none',
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          background: isBuy ? C.green : C.red,
          opacity: confirmDisabled ? 0.5 : 1,
          color: '#fff', fontWeight: 800, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '0.01em',
        }}>
          {confirming ? (isBuy ? 'Buying…' : 'Selling…')
            : !amount || Number(amount) <= 0 ? (isBuy ? 'Enter SOL amount' : 'Enter percentage')
            : (!needsWallet && !hasFunds) ? (isBuy ? 'Insufficient SOL' : `No ${token.sym} to sell`)
            : (isBuy ? `Buy ${amount} SOL of ${token.sym}` : `Sell ${Math.min(100, Number(amount))}% of ${token.sym}`)}
        </button>
      </div>
    </>
  );
}

// ── Launch Radar strip — same /api/dex/launches feed ──────────────────
// Self-contained normalizer for the Launch Radar strip: maps the
// /api/dex/launches token shape to what Row needs. Inlined so App.js carries no
// named-export dependency on LaunchRadar.jsx (that coupling broke the build).
const LR_EMOJI = ['\u{1F680}','\u{1FA99}','\u{1F438}','\u{1F525}','\u{26A1}','\u{1F311}','\u{1F48E}','\u{1F9B4}','\u{1F436}','\u{1F431}','\u{1F34C}','\u{1F451}','\u{1F9EA}','\u{1F3AF}','\u{1F6F8}','\u{1F30A}'];
function lrEmojiFor(sym) {
  sym = sym || ''; let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return LR_EMOJI[Math.abs(h) % LR_EMOJI.length];
}
function lrAgeStr(iso) {
  const ms = iso ? Date.now() - new Date(iso).getTime() : Infinity;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = ms / 60000;
  if (m < 1)  return Math.max(1, Math.round(ms / 1000)) + 's';
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  const h = m / 60;
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}
function _uniqMint(list) {
  const seen = new Set();
  return list.filter(t => t && t.mint && !seen.has(t.mint) && seen.add(t.mint));
}
function normalize(t) {
  const mint = t && t.mint;
  if (!mint || typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  return {
    mint,
    sym:       t.sym || '???',
    name:      t.name || t.sym || 'Unknown',
    emoji:     lrEmojiFor(t.sym || ''),
    icon:      t.icon || null,
    price:     Number(t.price || 0),
    change:    Number(t.priceChange24h || 0),
    age:       lrAgeStr(t.pairCreatedAt),
    mcap:      Number(t.mcap || t.fdv || 0),
    volume24h: Number(t.volume24h || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals == null ? 6 : t.decimals),
  };
}

export function LaunchRadarStrip({ onSwitchTab, onOpenToken }) {
  const [toks, setToks] = useState([]);
  const [series, setSeries] = useState({});
  const fetched = useRef({});               // mints whose sparkline we've already requested
  useEffect(() => {
    let cancelled = false;
    const loadSeries = (list) => {
      list.forEach(t => {
        if (fetched.current[t.mint]) return;            // don't refetch on every 5s poll
        fetched.current[t.mint] = true;
        stkThrottle(() => stkFetchSeries(t.mint, '1D'))
          .then(s => { if (!cancelled && s && s.length >= 2) setSeries(prev => ({ ...prev, [t.mint]: s })); })
          .catch(() => { fetched.current[t.mint] = false; });
      });
    };
    const pull = async () => {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) return;
        const d = await r.json();
        const list = _uniqMint((Array.isArray(d?.tokens) ? d.tokens : []).map(normalize).filter(Boolean)).slice(0, 12);
        if (cancelled) return;
        setToks(list);
        loadSeries(list);
      } catch {}
    };
    pull();
    const id = setInterval(pull, 5000);                 // live: refresh list every 5s (matches full page)
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!toks.length) return null;

  return (
    <>
      <SectionHead title="Launch" italic="Radar" meta="LIVE" onAll={() => onSwitchTab('launchradar')} />
      <ListShell>
        {toks.map((t, i) => {
          const _cs = pctFromSeries(series[t.mint]); const pct = Number.isFinite(_cs) ? _cs : (Number.isFinite(t.change) ? t.change : null);
          return (
            <Row
              key={t.mint}
              last={i === toks.length - 1}
              onClick={() => onOpenToken({
                mint: t.mint, sym: t.sym, name: t.name, ico: t.icon || t.emoji,
                grad: 'linear-gradient(135deg,#f5921b,#d4760a)',
                price: t.price, pct, tf: '1D',
                stats: `MC ${fmtUsd(t.mcap)} · Liq ${fmtUsd(t.liquidity)}`, tab: 'launchradar',
              })}
              ico={t.icon || t.emoji}
              grad="linear-gradient(135deg,#f5921b,#d4760a)"
              sym={t.sym}
              tag={t.age}
              sub={`MC ${fmtUsd(t.mcap)} · Liq ${fmtUsd(t.liquidity)}`}
              price={fmtUsd(t.price)}
              pct={pct}
              pts={series[t.mint]}
              mint={t.mint}
              rawPrice={t.price}
            />
          );
        })}
      </ListShell>
    </>
  );
}

// ── Live token feeds — ONE /api/dex/launches poll powers Radar + Trending
// + Gainers + the stats strip (so we don't triple-poll the same endpoint).
// Radar = freshest (feed order), Trending = highest 24h volume, Gainers =
// biggest 24h % move. Each row reuses the shared Row (real OHLCV only).
function LiveTokenFeeds({ onSwitchTab, onOpenToken, onConnectWallet }) {
  const [toks, setToks] = useState([]);
  const [series, setSeries] = useState({});
  const fetched = useRef({});
  useEffect(() => {
    let cancelled = false;
    const loadSeries = (list) => {
      list.forEach(t => {
        if (fetched.current[t.mint]) return;
        fetched.current[t.mint] = true;
        stkThrottle(() => stkFetchSeries(t.mint, '1D'))
          .then(s => { if (!cancelled && s && s.length >= 2) setSeries(prev => ({ ...prev, [t.mint]: s })); })
          .catch(() => { fetched.current[t.mint] = false; });
      });
    };
    const pull = async () => {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) return;
        const d = await r.json();
        const list = _uniqMint((Array.isArray(d?.tokens) ? d.tokens : []).map(normalize).filter(Boolean)).slice(0, 30);
        if (cancelled) return;
        setToks(list);
        loadSeries(list);
      } catch {}
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!toks.length) return null;

  const radar    = toks.slice(0, 15);
  const trending = [...toks].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 15);
  const gainers  = [...toks].filter(t => Number.isFinite(t.change)).sort((a, b) => b.change - a.change).slice(0, 15);

  // live stats
  const totalVol = toks.reduce((s, t) => s + (t.volume24h || 0), 0);
  const newCount = toks.filter(t => /^\d+(s|m)$/.test(t.age || '')).length;
  const gainCount = toks.filter(t => Number.isFinite(t.change) && t.change > 0).length;

  const mkRow = (t, i, n, sub) => {
    const _cs = pctFromSeries(series[t.mint]); const pct = Number.isFinite(_cs) ? _cs : (Number.isFinite(t.change) ? t.change : null);
    return (
      <Row
        key={t.mint}
        last={i === n - 1}
        onClick={() => onOpenToken({
          mint: t.mint, sym: t.sym, name: t.name, ico: t.icon || t.emoji,
          grad: 'linear-gradient(135deg,#f5921b,#d4760a)',
          price: t.price, pct, tf: '1D',
          stats: `MC ${fmtUsd(t.mcap)} · Liq ${fmtUsd(t.liquidity)}`, tab: 'launchradar',
        })}
        ico={t.icon || t.emoji}
        grad="linear-gradient(135deg,#f5921b,#d4760a)"
        sym={t.sym}
        tag={t.age}
        sub={sub(t)}
        price={fmtUsd(t.price)}
        pct={pct}
        pts={series[t.mint]}
        mint={t.mint}
        rawPrice={t.price}
      />
    );
  };

  const Orb = ({ v, l, c }) => (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 14, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: c || C.ink }}>{v}</div>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>{l}</div>
    </div>
  );

  return (
    <>
      {/* LIVE STATS STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
        <Orb v={fmtUsd(totalVol)} l="24h Vol" />
        <Orb v={newCount} l="New · live" />
        <Orb v={gainCount} l="Gainers" c={C.green} />
      </div>

      <SectionHead title="Launch" italic="Radar" meta="LIVE" onAll={() => onSwitchTab('launchradar')} />
      <ListShell>{radar.map((t, i) => mkRow(t, i, radar.length, x => `MC ${fmtUsd(x.mcap)} · Liq ${fmtUsd(x.liquidity)}`))}</ListShell>

      <WhaleFeed onOpenToken={onOpenToken} />

      <SectionHead title="Trending" italic="now" meta="LIVE" onAll={() => onSwitchTab('wonderland')} />
      <ListShell>{trending.map((t, i) => mkRow(t, i, trending.length, x => `Vol ${fmtUsd(x.volume24h)} · MC ${fmtUsd(x.mcap)}`))}</ListShell>

      <SectionHead title="Top" italic="gainers" meta="LIVE" onAll={() => onSwitchTab('launchradar')} />
      <ListShell>{gainers.map((t, i) => mkRow(t, i, gainers.length, x => `MC ${fmtUsd(x.mcap)} · Liq ${fmtUsd(x.liquidity)}`))}</ListShell>
    </>
  );
}

// ── Whale activity feed — real /api/whale-events source (best-effort).
// Renders nothing if the endpoint is empty/unavailable, so it never leaves a
// dead section on the page.
function WhaleFeed({ onOpenToken }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setEvents(Array.isArray(d?.events) ? d.events.slice(0, 6) : []);
      } catch {}
    };
    load();
    const id = setInterval(load, 12000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!events.length) return null;

  const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - (ms || Date.now())) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    return Math.round(s / 3600) + 'h';
  };

  return (
    <>
      <SectionHead title="Whale" italic="activity" meta="LIVE" />
      <ListShell>
        {events.map((e, i) => (
          <div key={(e.mint || '') + i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', borderBottom: i === events.length - 1 ? 'none' : `1px solid ${C.hairline}` }}>
            <span style={{ fontSize: 14 }}>🐋</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b style={{ fontWeight: 800 }}>Whale</b> bought <b style={{ fontWeight: 800 }}>${e.symbol || 'TOKEN'}</b>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.green, flexShrink: 0 }}>+{Number(e.solAmount || 0).toFixed(1)} SOL</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.ink3, minWidth: 30, textAlign: 'right' }}>{ago(e.detectedAt)}</span>
          </div>
        ))}
      </ListShell>
    </>
  );
}

// ── xStocks strip — same BRANDS catalog + Jupiter price/v3 ─────────────
// Self-contained xStock icon fetcher — inlined so App.js never depends on a
// Stocks.jsx named export (keeps the build green even if the two files drift).
async function appFetchBrandIcons(mints) {
  if (!mints || !mints.length) return {};
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      `/api/jupiter/tokens/search?query=${encodeURIComponent(mints.join(','))}`,
      { headers: { Accept: 'application/json' }, signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return {};
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data?.tokens || []);
    const out = {};
    for (const tk of arr) {
      const id = tk?.id || tk?.address;
      if (!id) continue;
      const url = tk.icon || tk.logoURI || null;
      if (url) out[id] = url;
    }
    return out;
  } catch { return {}; }
}

export function XStocksStrip({ onSwitchTab, onOpenToken, onOpenStock }) {
  const picks = BRANDS.slice(0, 10);
  const [prices, setPrices] = useState({});
  const [series, setSeries] = useState({});
  const [icons,  setIcons]  = useState({});
  useEffect(() => {
    let cancelled = false;
    fetchBrandPrices(picks.map(b => b.mint)).then(p => { if (!cancelled) setPrices(p || {}); }).catch(() => {});
    appFetchBrandIcons(picks.map(b => b.mint)).then(ic => { if (!cancelled) setIcons(ic || {}); }).catch(() => {});
    picks.forEach(b => {
      stkThrottle(() => stkFetchSeries(b.mint, '1M'))
        .then(s => { if (!cancelled && s && s.length >= 2) setSeries(prev => ({ ...prev, [b.mint]: s })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SectionHead title="x" italic="Stocks" meta="LIVE" onAll={() => onSwitchTab('markets')} />
      <ListShell>
        {picks.map((b, i) => {
          const pts = series[b.mint];
          const live = prices[b.mint];
          const last = pts && pts.length ? pts[pts.length - 1].c : null;
          const price = Number.isFinite(live) ? live : last;
          const pct = pctFromSeries(pts);
          return (
            <Row
              key={b.mint}
              last={i === picks.length - 1}
              onClick={() => onOpenStock(b, price, icons[b.mint])}
              ico={icons[b.mint] || b.symbol.charAt(0)}
              grad="linear-gradient(135deg,#2f6bff,#1e49c9)"
              sym={b.symbol}
              tag="24/7"
              sub={b.name}
              price={fmtUsd(price)}
              pct={pct}
              pts={pts}
              mint={b.mint}
              rawPrice={price}
            />
          );
        })}
      </ListShell>
    </>
  );
}

// =====================================================================
// HomeBelow — below-the-fold homepage sections.
// EXPANDED card grid: now includes Bridge, Sol→BTC, Radar, Referrals,
// Why Nexus, and (gated to Flipsy access wallet only) Flipsy.
// =====================================================================
function SwapLabel() {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
      {/* SWAP label — serif whisper, sits right above the widget */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px 6px' }}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 22, color: C.ink, letterSpacing: '-0.015em', lineHeight: 1 }}>Swap</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, color: C.green,
          letterSpacing: '0.12em', background: 'rgba(22,192,138,.10)', border: `1px solid ${C.border}`,
          padding: '4px 10px', borderRadius: 999,
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, animation: 'nx-pulse 1.6s infinite' }} />LIVE QUOTE
        </div>
      </div>
    </div>
  );
}

// Prominent 50%-referral banner for the home page — mirrors the dark CTA
// banner from the SEO landing template (mint-green accents, "50%" highlighted).
function HomeReferralBanner({ onSwitchTab }) {
  return (
    <div style={{ maxWidth: 520, margin: '18px auto 4px', width: '100%' }}>
      <button
        onClick={() => onSwitchTab('referrals')}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '15px 18px', borderRadius: 16, cursor: 'pointer',
          border: 'none', textAlign: 'left', fontFamily: 'inherit',
          background: 'linear-gradient(100deg,#0a0a0a,#1c1c22)',
          boxShadow: '0 10px 30px rgba(10,10,10,.22)',
          transition: 'transform .15s, box-shadow .15s',
          animation: 'nx-rise .45s cubic-bezier(.2,1,.4,1) backwards',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 14px 34px rgba(10,10,10,.30)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(10,10,10,.22)'; }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#9bf5cf' }}>REFERRAL</span>
          <span style={{ fontFamily: 'inherit', fontSize: 17, fontWeight: 800, lineHeight: 1.2, color: '#fff', letterSpacing: '-0.01em' }}>
            Earn <em style={{ fontFamily: "'JetBrains Mono', monospace", fontStyle: 'normal', fontWeight: 800, color: C.green }}>50%</em> of fees from everyone you refer
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', color: '#a7a7b2', marginTop: 2 }}>FOREVER · PAID DAILY IN SOL</span>
        </span>
        <span style={{ flexShrink: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: '#9bf5cf', whiteSpace: 'nowrap' }}>Join →</span>
      </button>
    </div>
  );
}

function HomeBelow({ onSwitchTab, walletAddress, onOpenToken }) {
  const canSeeFlipsy = walletAddress === FLIPSY_ACCESS_WALLET;

  // Build the card list. Order: primary products first, then utility, then meta.
  const products = [
    { tab: 'wonderland',  icon: '✨', name: 'Wonderland',     desc: 'Meme signal scanner. Catch runners before the herd.',           live: 'TRENDING',  grad: 'linear-gradient(135deg,#7c5cff,#5a3ed1)' },
    { tab: 'markets',     icon: '📈', name: 'Markets',         desc: 'Tokenized Tesla, Apple, NVIDIA — trade 24/7 in USDC.',          live: '18 STOCKS', grad: 'linear-gradient(135deg,#2f6bff,#1e49c9)' },
    { tab: 'ape',         icon: '⚡', name: 'Ape',             desc: 'Fresh pump.fun launches with burner-wallet one-tap trades.',    live: 'EARLY',     grad: 'linear-gradient(135deg,#f5921b,#d4760a)' },
    { tab: 'holdings',    icon: '👜', name: 'Bags',            desc: 'Every token you own. Live prices. Buy SOL with USD.',           live: 'PORTFOLIO', grad: 'linear-gradient(135deg,#16c08a,#0f8f67)' },
    { tab: 'buysol',      icon: '💳', name: 'Buy Solana',      desc: 'Buy SOL with card or bank — trusted providers.',                live: 'FIAT',      grad: 'linear-gradient(135deg,#14f195,#0fa968)' },
    { tab: 'bridge',      icon: '🌉', name: 'Cross-Chain',     desc: 'Move any token across 71 chains. Native, ~2 min.',              live: '71 CHAINS', grad: 'linear-gradient(135deg,#2f6bff,#7c5cff)' },
    { tab: 'solbtc',      icon: '₿',  name: 'SOL → BTC',       desc: 'Swap Solana straight to real Bitcoin on the BTC network.',      live: 'NATIVE',    grad: 'linear-gradient(135deg,#f5921b,#a67200)' },
    { tab: 'launchradar', icon: '🚀', name: 'Radar',           desc: 'Every new token, the moment it lands on Solana.',               live: 'FRESH',     grad: 'linear-gradient(135deg,#f5921b,#a67200)' },
    { tab: 'referrals',   icon: '§',  name: 'Referrals',       desc: '50% of every fee, on-chain, same block. Forever.',              live: '50% RATE',  grad: 'linear-gradient(135deg,#16c08a,#2f6bff)' },
    { tab: 'why',         icon: '◌',  name: 'Why Nexus',       desc: 'No email, no KYC, no limits. The three things we never do.',   live: 'READ',      grad: 'linear-gradient(135deg,#7c5cff,#2f6bff)' },
  ];

  if (canSeeFlipsy) {
    products.splice(4, 0, {
      tab: 'flipsy', icon: '🎯', name: 'Flipsy',
      desc: 'Predictions market. Currently in development.',
      live: 'BETA · YOU', grad: 'linear-gradient(135deg,#16c08a,#3ee07f)',
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

      {/* EXPANDED PRODUCT GRID */}
      {sectionHead('Explore the', 'super-app', 'TOOLS')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {products.filter(p => p.tab !== 'markets' && p.tab !== 'launchradar').map((p, i) => (
          <button
            key={p.tab}
            onClick={() => onSwitchTab(p.tab)}
            style={{
              background: C.glassStrong, backdropFilter: 'blur(10px)',
              border: `1px solid ${C.border}`, borderRadius: 14,
              padding: '11px 10px', textAlign: 'left', cursor: 'pointer',
              fontFamily: 'inherit', color: 'inherit',
              transition: 'transform .15s, box-shadow .15s',
              display: 'flex', flexDirection: 'column', gap: 7,
              animation: `nx-rise .45s cubic-bezier(.2,1,.4,1) ${i * 0.03}s backwards`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 22px rgba(160,231,255,.16)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              display: 'grid', placeItems: 'center', fontSize: 14,
              background: p.grad, color: '#fff',
            }}>{p.icon}</div>
            <div style={{
              fontFamily: "'Instrument Serif', serif", fontSize: 15, lineHeight: 1,
              color: C.ink, letterSpacing: '-0.01em',
            }}>{p.name}</div>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 700, color: C.cyan,
              letterSpacing: '0.08em',
            }}>{p.live}</span>
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
    { sym: '+', name: '+68 More',  bg: 'linear-gradient(135deg,#2f6bff,#7c5cff)' },
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
  '/buy-sol': 'buysol', '/buy-solana': 'buysol', '/buy': 'buysol',
  '/referrals': 'referrals', '/refer': 'referrals',
  '/why': 'why', '/why-nexus': 'why', '/about': 'why',
  '/admin': 'admin', '/dashboard': 'admin',
  '/stack': 'swap', '/vip': 'swap', '/perps': 'swap', '/call': 'swap',
};
const TAB_TO_PATH = {
  swap: '/swap', bridge: '/bridge', solbtc: '/sol-btc',
  wonderland: '/wonderland', launchradar: '/radar', ape: '/ape', markets: '/markets', flipsy: '/flipsy',
  getstarted: '/get-started', holdings: '/holdings', buysol: '/buy-sol',
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
              background: canAccept ? '#0b0b0c' : '#f4f4f5',
              color: canAccept ? '#fff' : C.ink3,
              fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em',
              cursor: canAccept ? 'pointer' : 'not-allowed',
              boxShadow: 'none',
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
// Nav icons — one icon per tab (including Admin, which is gated by wallet)
// =====================================================================
function IconSwap()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconApe()        { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>; }
function IconWonderland() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 6.4L21 10l-5.4 4 1.8 7L12 17.5 6.6 21l1.8-7L3 10l6.6-1.6L12 2z"/></svg>; }
function IconMarkets()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>; }
function IconHoldings()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18l-2 13H5L3 7z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/></svg>; }
function IconAdmin()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>; }

const NAV_ICONS = { swap: IconSwap, ape: IconApe, wonderland: IconWonderland, markets: IconMarkets, holdings: IconHoldings, admin: IconAdmin };

// Primary nav: five tabs by default, plus Admin which is only visible
// to wallets in ADMIN_WALLETS. The filter in AppInner handles the gating.
const PRIMARY_NAV_TABS = [
  { id: 'swap',       label: 'Swap' },
  { id: 'ape',        label: 'Launches' },
  { id: 'wonderland', label: 'Memes' },
  { id: 'markets',    label: 'Stocks' },
  { id: 'holdings',   label: 'Wallet' },
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
      <h2 style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", fontWeight: 800, fontSize: 26, color: C.ink, margin: '0 0 8px', letterSpacing: '-0.02em' }}>{title}</h2>
      <p style={{ color: C.ink2, fontSize: 14, fontWeight: 500, lineHeight: 1.5, maxWidth: 340, margin: '0 auto 18px' }}>{body}</p>
      <button onClick={onConnectWallet} style={{
        padding: '13px 22px', borderRadius: 14, border: 'none', cursor: 'pointer',
        background: '#0b0b0c', color: '#fff',
        fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fontWeight: 800, fontSize: 15, boxShadow: 'none',
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
  const [menuOpen, setMenuOpen] = useState(false);
  const swapWidgetRef = useRef(null);
  const [sheetToken, setSheetToken] = useState(null);
  const [swapOutputMint, setSwapOutputMint] = useState(null);

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

  const openToken = useCallback(t => setSheetToken(t), []);
  const [stockTrade, setStockTrade] = useState(null);
  const openStockTrade = useCallback((brand, price, icon) => setStockTrade({ brand, price: price || 0, icon: icon || null }), []);
  const buyToken = useCallback(mint => {
    setSwapOutputMint(mint);
    setSheetToken(null);
    if (tab !== 'swap') { navigate(TAB_TO_PATH['swap'] || '/swap'); setTab('swap'); }
    requestAnimationFrame(() => requestAnimationFrame(scrollToSwapWidget));
  }, [tab, navigate, scrollToSwapWidget]);

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
  const isAdmin   = ADMIN_WALLETS.has(wallet.walletAddress);
  // Primary nav: filter Ape out if non-authorized; filter Admin out unless admin wallet.
  const navTabs = PRIMARY_NAV_TABS.filter(t => {
    if (t.id === 'ape' && !canApe) return false;
    if (t.id === 'admin' && !isAdmin) return false;
    return true;
  });

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
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid #f1f1f2',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              background: '#0b0b0c',
              display: 'grid', placeItems: 'center',
              fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", fontWeight: 800, fontSize: 15, color: '#fff',
            }}>N</div>
            <span style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1, color: C.ink }}>
              nexus
              <span style={{
                fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fontStyle: 'normal', fontSize: 9, fontWeight: 800,
                color: C.ink2, background: '#f4f4f5',
                border: '1px solid #f1f1f2', borderRadius: 6, padding: '2px 6px', marginLeft: 6,
                letterSpacing: '0.08em', verticalAlign: 'middle',
              }}>DEX</span>
            </span>
          </div>
          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {navTabs.map(t => {
              const isActive = tab === t.id;
              return (
                <button key={t.id} onClick={() => switchTab(t.id)} style={{
                  background: isActive ? '#f4f4f5' : 'transparent',
                  border: '1px solid transparent',
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
          <button className="mobile-nav" aria-label="Menu" onClick={() => setMenuOpen(true)} style={{
            display: 'flex', flexDirection: 'column', gap: 3.5, alignItems: 'center', justifyContent: 'center',
            width: 44, height: 34, borderRadius: 11, background: '#f4f4f5', border: 'none', cursor: 'pointer', flexShrink: 0,
          }}>
            <span style={{ width: 18, height: 2, borderRadius: 2, background: '#0b0b0c' }} />
            <span style={{ width: 18, height: 2, borderRadius: 2, background: '#0b0b0c' }} />
            <span style={{ width: 18, height: 2, borderRadius: 2, background: '#0b0b0c' }} />
          </button>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: wallet.isConnected ? '#f4f4f5' : '#0b0b0c',
            border: 'none',
            borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
            fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fontWeight: 700, fontSize: 12,
            color: wallet.isConnected ? C.ink : '#fff', whiteSpace: 'nowrap',
            boxShadow: 'none',
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
            <SwapHero />
            <LiveTokenFeeds onSwitchTab={switchTab} onOpenToken={openToken} onConnectWallet={openWallet} />
            <SwapLabel />
            <div ref={swapWidgetRef}>
              <SwapWidget key={swapOutputMint || 'default'} defaultOutputMint={swapOutputMint || undefined} {...sharedProps} />
            </div>
            <HomeReferralBanner onSwitchTab={switchTab} />
            <XStocksStrip onSwitchTab={switchTab} onOpenToken={openToken} onOpenStock={openStockTrade} />
            <HomeBelow onSwitchTab={switchTab} walletAddress={wallet.walletAddress} onOpenToken={openToken} />
          </>
        )}
        {tab === 'launchradar' && <LaunchRadar onConnectWallet={openWallet} />}
        {tab === 'ape' && (canApe
          ? <Ape onConnectWallet={openWallet} mainWalletPubkey={wallet.walletAddress} onSwitchTab={switchTab} />
          : <ApeLocked connected={wallet.isConnected} onConnectWallet={openWallet} />
        )}
        {tab === 'bridge'      && <CrossChainSwap onConnectWallet={openWallet} />}
        {tab === 'solbtc'      && <SolToBtcChainflip onConnectWallet={openWallet} />}
        {tab === 'wonderland'  && <MemeWonderland onConnectWallet={openWallet} />}
        {tab === 'markets'     && <Stocks {...sharedProps} />}
        {tab === 'flipsy'      && (canFlipsy
          ? <Flipsy onConnectWallet={openWallet} />
          : <FlipsyLocked connected={wallet.isConnected} onConnectWallet={openWallet} />
        )}
        {tab === 'holdings'    && <Holdings {...sharedProps} />}
        {tab === 'buysol'      && <BuySolana />}
        {tab === 'getstarted'  && <GetStarted onConnectWallet={openWallet} onSwitchTab={switchTab} />}
        {tab === 'referrals'   && <ReferralsPage onConnectWallet={openWallet} />}
        {tab === 'why'         && <WhyNexus onSwitchTab={switchTab} />}
        {tab === 'admin'       && <AdminPage onConnectWallet={openWallet} walletAddress={wallet.walletAddress} isConnected={wallet.isConnected} onSwitchTab={switchTab} />}
      </main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-nav" style={{
        position: 'fixed', bottom: 'calc(12px + env(safe-area-inset-bottom))', left: 14, right: 14, zIndex: 100,
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid #f1f1f2', borderRadius: 24,
        display: 'flex', alignItems: 'stretch',
        boxShadow: '0 8px 28px rgba(11,11,12,0.12)',
        padding: 7,
      }}>
        {navTabs.map(t => {
          // FIX 2: fallback to IconSwap if the tab has no icon registered.
          // Belt-and-suspenders: NAV_ICONS now has admin, but this prevents
          // future tabs from crashing the whole app with React #130.
          const Icon = NAV_ICONS[t.id] || IconSwap;
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              background: isActive ? '#f4f4f5' : 'transparent', border: 'none', cursor: 'pointer',
              color: isActive ? C.ink : C.ink3,
              fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fontSize: 9.5, fontWeight: 700,
              padding: '8px 2px', minHeight: 48, position: 'relative', borderRadius: 16,
              transition: 'all .15s',
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

      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(11,11,12,0.28)', zIndex: 200 }} />
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 201, background: '#fff', borderBottom: '1px solid #f1f1f2', borderRadius: '0 0 20px 20px', boxShadow: '0 24px 60px rgba(11,11,12,0.22)', maxHeight: '88vh', overflowY: 'auto', paddingTop: 'env(safe-area-inset-top)', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif" }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 8px' }}>
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: '#0b0b0c' }}>Go to</span>
              <button onClick={() => setMenuOpen(false)} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 9, background: '#f4f4f5', border: 'none', fontSize: 16, color: '#0b0b0c', cursor: 'pointer' }}>×</button>
            </div>
            {[
              { grp: 'Trade', items: [['swap', 'Swap'], ['ape', 'Ape'], ['wonderland', 'Wonderland'], ['markets', 'Markets'], ['holdings', 'Bags'], ['buysol', 'Buy Solana']] },
              { grp: 'Tools', items: [['bridge', 'Cross-Chain'], ['solbtc', 'SOL → BTC'], ['launchradar', 'Radar'], ['flipsy', 'Flipsy']] },
              { grp: 'Earn & info', items: [['referrals', 'Referrals'], ['why', 'Why Nexus'], ['getstarted', 'Get Started']] },
            ].map(section => (
              <div key={section.grp}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aeaeb2', padding: '12px 18px 4px' }}>{section.grp}</div>
                {section.items.map(([id, label]) => (
                  <button key={id} onClick={() => { switchTab(id); setMenuOpen(false); }} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                    background: tab === id ? '#fafafa' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: '#0b0b0c',
                  }}>{label}</button>
                ))}
              </div>
            ))}
            <div style={{ height: 'calc(16px + env(safe-area-inset-bottom))' }} />
          </div>
        </>
      )}
      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
      {sheetToken && (
        <TokenSheet
          token={sheetToken}
          onClose={() => setSheetToken(null)}
          onConnectWallet={openWallet}
          onOpenFull={() => { const tb = sheetToken.tab; setSheetToken(null); switchTab(tb); }}
        />
      )}
      {StockTradeModal && (
        <StockTradeModal
          open={!!stockTrade}
          brand={stockTrade ? stockTrade.brand : null}
          icon={stockTrade ? stockTrade.icon : null}
          price={stockTrade ? stockTrade.price : 0}
          onClose={() => setStockTrade(null)}
          walletPubkey={wallet.walletAddress}
          onConnectWallet={openWallet}
        />
      )}
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }
