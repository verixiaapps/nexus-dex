// ReferralsPage.jsx — standalone /referrals tab for Nexus DEX
//
// Design: Wonderland-light to match the rest of the app
// (pastel cream/sky/pink/lavender, Instrument Serif + Space Grotesk + JetBrains Mono).
// One signature moment: a giant Instrument Serif italic "50%" hero.
//
// Rate: 50% of every fee, paid on-chain to the referrer's wallet in the same
// block as each trade. Boost code system stays in the backend but is hidden
// from the UI — kept dormant in case we want extra-tier partners later.
//
// Wallet model: MAIN WALLET ONLY. Uses useNexusWallet() from WalletContext,
// not the burner from Ape. KOLs need a wallet they'll still own next year.
// Empty state still shows the marketing pitch; CTA opens the existing WalletModal
// via the onConnectWallet prop the parent passes down (same pattern as every
// other tab in App.js: Holdings, MemeWonderland, etc.).
//
// Backend: hits /api/ref/register (also for boost activation) and /api/ref/stats.
// No server.js changes needed.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNexusWallet } from './WalletContext.js';

// Inherit the same design tokens used in App.js / MemeWonderland.
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

// Scoped styles — vrf- prefix so nothing collides with mw- / nx- / wp-.
const VRF_CSS = `
@keyframes vrf-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes vrf-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes vrf-fade{from{opacity:0}to{opacity:1}}
@keyframes vrf-shimmer{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes vrf-spin{to{transform:rotate(360deg)}}
@keyframes vrf-cta-glow{0%,100%{box-shadow:0 12px 32px rgba(255,143,190,.40),0 0 0 1px rgba(255,143,190,.32)}50%{box-shadow:0 14px 38px rgba(160,231,255,.48),0 0 0 1px rgba(160,231,255,.42)}}
@keyframes vrf-orbit{from{transform:rotate(0deg) translateX(160px) rotate(0deg)}to{transform:rotate(360deg) translateX(160px) rotate(-360deg)}}
@keyframes vrf-orbit-sm{from{transform:rotate(0deg) translateX(110px) rotate(0deg)}to{transform:rotate(360deg) translateX(110px) rotate(-360deg)}}

.vrf-root{min-height:100dvh;position:relative;overflow-x:hidden}
.vrf-root *{box-sizing:border-box}

/* HERO ============================================================ */
.vrf-hero{
  max-width:1100px;margin:0 auto;padding:32px 18px 24px;
  position:relative;
}
.vrf-eyebrow{
  display:inline-flex;align-items:center;gap:8px;
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;
  letter-spacing:.18em;text-transform:uppercase;color:${C.cyan};
  padding:6px 12px;border-radius:999px;
  background:rgba(61,212,245,.10);border:1px solid ${C.border};
  margin-bottom:22px;
}
.vrf-eyebrow .d{
  width:5px;height:5px;border-radius:50%;
  background:${C.cyan};box-shadow:0 0 8px ${C.cyan};
  animation:vrf-pulse 1.6s infinite;
}
.vrf-hero-grid{
  display:grid;grid-template-columns:1.3fr .9fr;gap:32px;align-items:center;
}
@media(max-width:900px){.vrf-hero-grid{grid-template-columns:1fr;gap:24px}}

.vrf-hero-l{position:relative;z-index:2}
.vrf-h1{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:clamp(48px,8vw,80px);line-height:.95;letter-spacing:-.025em;
  color:${C.ink};margin:0 0 12px;
}
.vrf-h1 .it{
  font-style:italic;
  background:linear-gradient(120deg,${C.sky} 0%,${C.lav} 50%,${C.pink} 100%);
  background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:vrf-shimmer 9s linear infinite;
}
.vrf-sub{
  color:${C.ink2};font-family:'Space Grotesk',sans-serif;
  font-size:clamp(14px,2.2vw,16px);font-weight:500;line-height:1.55;
  margin:0 0 22px;max-width:520px;
}
.vrf-sub b{color:${C.ink};font-weight:700}
.vrf-cta-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.vrf-cta-primary{
  display:inline-flex;align-items:center;gap:9px;
  padding:14px 22px;border:none;cursor:pointer;
  border-radius:14px;
  background:linear-gradient(135deg,${C.sky},${C.pink});
  color:${C.ink};font-family:'Space Grotesk',sans-serif;
  font-weight:700;font-size:14px;letter-spacing:.02em;
  animation:vrf-cta-glow 3.6s ease-in-out infinite;
  transition:transform .12s;
}
.vrf-cta-primary:hover{transform:translateY(-1px)}
.vrf-cta-primary:active{transform:translateY(1px)}
.vrf-cta-primary .arrow{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:13px}
.vrf-cta-ghost{
  display:inline-flex;align-items:center;gap:7px;
  padding:14px 18px;border:1px solid ${C.border};cursor:pointer;
  border-radius:14px;background:${C.glassStrong};backdrop-filter:blur(12px);
  color:${C.ink};font-family:'Space Grotesk',sans-serif;
  font-weight:600;font-size:13px;transition:all .15s;
}
.vrf-cta-ghost:hover{border-color:${C.borderHi};transform:translateY(-1px)}
.vrf-trust-strip{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-top:18px;
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;
  color:${C.ink3};letter-spacing:.06em;
}
.vrf-trust-strip .item{display:inline-flex;align-items:center;gap:5px}
.vrf-trust-strip .glyph{color:${C.green};font-size:12px}
.vrf-trust-strip .dot{color:${C.ink3};opacity:.5}

/* THIRTY-THREE — the signature moment ============================ */
.vrf-hero-r{
  position:relative;
  min-height:240px;
  display:flex;align-items:center;justify-content:center;
}
.vrf-thirty-three{
  position:relative;
  font-family:'Instrument Serif',serif;
  font-weight:400;font-style:italic;
  font-size:clamp(180px,28vw,280px);
  line-height:.85;letter-spacing:-.04em;
  background:linear-gradient(135deg,${C.pink} 0%,${C.lav} 40%,${C.sky} 80%);
  background-size:200% 200%;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:vrf-shimmer 8s ease-in-out infinite;
  text-shadow:0 12px 40px rgba(255,143,190,.18);
  user-select:none;
  z-index:3;
  position:relative;
}
.vrf-thirty-three .pct{
  font-style:normal;font-size:.45em;
  vertical-align:baseline;margin-left:.04em;letter-spacing:-.02em;
}
.vrf-thirty-three-label{
  position:absolute;
  bottom:8px;left:50%;transform:translateX(-50%);
  font-family:'JetBrains Mono',monospace;
  font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:${C.ink2};white-space:nowrap;
  z-index:4;
}
.vrf-thirty-three-label b{color:${C.ink};font-weight:800}
.vrf-orbit{
  position:absolute;inset:0;
  display:flex;align-items:center;justify-content:center;
  pointer-events:none;z-index:1;
}
.vrf-orbit-ring{
  position:absolute;
  width:340px;height:340px;border-radius:50%;
  border:1px dashed rgba(183,148,246,.22);
}
.vrf-orbit-ring.sm{width:260px;height:260px;border-color:rgba(255,143,190,.20)}
.vrf-orbit-dot{
  position:absolute;left:50%;top:50%;
  width:8px;height:8px;border-radius:50%;
  margin:-4px 0 0 -4px;
  background:${C.cyan};box-shadow:0 0 14px ${C.cyan};
  animation:vrf-orbit 22s linear infinite;
  transform-origin:0 0;
}
.vrf-orbit-dot.b{background:${C.pink};box-shadow:0 0 14px ${C.pink};animation-duration:30s;animation-direction:reverse}
.vrf-orbit-dot.c{background:${C.mint};box-shadow:0 0 12px ${C.mint};animation:vrf-orbit-sm 16s linear infinite}
@media(max-width:900px){
  .vrf-hero-r{min-height:200px}
  .vrf-orbit-ring{width:240px;height:240px}
  .vrf-orbit-ring.sm{width:180px;height:180px}
  .vrf-orbit-dot{animation-duration:22s}
  .vrf-orbit-dot.b{animation-duration:30s}
}

/* SECTION FRAMING ================================================ */
.vrf-section{max-width:1100px;margin:0 auto;padding:32px 18px}
.vrf-section-head{
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  margin-bottom:18px;
}
.vrf-section-eye{
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;
  letter-spacing:.18em;text-transform:uppercase;color:${C.ink3};
  display:inline-flex;align-items:center;gap:8px;
}
.vrf-section-eye .gl{color:${C.cyan};font-size:11px}
.vrf-section-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:clamp(26px,4vw,34px);line-height:1;letter-spacing:-.02em;
  color:${C.ink};margin:0;
}
.vrf-section-h .it{
  font-style:italic;
  background:linear-gradient(120deg,${C.sky},${C.pink});
  -webkit-background-clip:text;background-clip:text;color:transparent;
}

/* CONNECT / STATS CARD =========================================== */
.vrf-connect-card{
  padding:24px;border-radius:24px;
  background:${C.glassStrong};backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.85);
  box-shadow:0 12px 32px rgba(160,231,255,.14);
  position:relative;overflow:hidden;
}
.vrf-connect-card::before{
  content:'';position:absolute;top:-30%;right:-20%;
  width:60%;height:160%;
  background:radial-gradient(closest-side,rgba(255,143,190,.10),transparent);
  pointer-events:none;
}
.vrf-connect-empty{
  display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  position:relative;z-index:2;
}
.vrf-connect-empty-l{flex:1;min-width:240px}
.vrf-connect-empty-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:24px;line-height:1.15;letter-spacing:-.015em;
  color:${C.ink};margin:0 0 8px;
}
.vrf-connect-empty-h .it{font-style:italic;color:${C.lav}}
.vrf-connect-empty-s{
  font-size:13.5px;color:${C.ink2};line-height:1.55;margin:0;
  max-width:480px;
}
.vrf-connect-empty-s b{color:${C.ink};font-weight:700}

.vrf-connect-active{position:relative;z-index:2}
.vrf-wallet-row{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:14px 18px;border-radius:18px;
  background:linear-gradient(135deg,rgba(127,255,212,.16),rgba(160,231,255,.16));
  border:1px solid rgba(127,255,212,.32);
  margin-bottom:18px;
}
.vrf-wallet-avatar{
  width:44px;height:44px;border-radius:13px;flex-shrink:0;
  background:linear-gradient(135deg,${C.pink},${C.lav});
  display:grid;place-items:center;
  font-family:'Instrument Serif',serif;font-weight:400;font-style:italic;
  font-size:18px;color:#fff;
  box-shadow:0 4px 14px rgba(255,143,190,.4);
}
.vrf-wallet-meta{flex:1;min-width:160px}
.vrf-wallet-label{
  font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;
  letter-spacing:.15em;text-transform:uppercase;color:${C.ink2};
  display:flex;align-items:center;gap:8px;
}
.vrf-wallet-label .d{
  width:6px;height:6px;border-radius:50%;
  background:${C.green};box-shadow:0 0 8px ${C.green};
  animation:vrf-pulse 1.6s infinite;
}
.vrf-wallet-addr{
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;
  color:${C.ink};margin-top:4px;letter-spacing:.02em;word-break:break-all;
  line-height:1.3;
}
.vrf-wallet-switch{
  flex-shrink:0;padding:9px 14px;
  background:${C.glass};border:1px solid ${C.border};border-radius:10px;
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;
  letter-spacing:.08em;color:${C.ink2};cursor:pointer;
}
.vrf-wallet-switch:hover{color:${C.ink};border-color:${C.borderHi}}

/* LINK BOX ====================================================== */
.vrf-link-box{
  display:flex;align-items:stretch;gap:6px;
  background:rgba(255,255,255,.55);border:1.5px solid ${C.border};
  border-radius:16px;padding:6px;margin-bottom:12px;
  transition:border-color .2s;
}
.vrf-link-box:focus-within{border-color:${C.borderHi}}
.vrf-link-input{
  flex:1;min-width:0;padding:11px 14px;
  background:transparent;border:none;outline:none;color:${C.ink};
  font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.vrf-link-copy{
  flex-shrink:0;display:inline-flex;align-items:center;gap:7px;
  padding:0 18px;min-height:44px;border-radius:11px;
  background:linear-gradient(135deg,${C.sky},${C.pink});color:${C.ink};
  border:none;cursor:pointer;
  font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11px;
  letter-spacing:.1em;transition:transform .12s,background .2s;
}
.vrf-link-copy:hover{transform:translateY(-1px)}
.vrf-link-copy.copied{
  background:linear-gradient(135deg,${C.mint},${C.sky});
}
.vrf-share-row{display:flex;gap:8px;flex-wrap:wrap}
.vrf-share-btn{
  flex:1;min-width:130px;min-height:44px;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:0 16px;border-radius:12px;
  background:${C.glass};border:1px solid ${C.border};color:${C.ink};
  font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:13px;
  cursor:pointer;transition:all .15s;
}
.vrf-share-btn:hover{background:${C.glassStrong};border-color:${C.borderHi};transform:translateY(-1px)}
.vrf-share-btn.tw{
  background:linear-gradient(135deg,rgba(0,0,0,.04),rgba(0,0,0,.02));
  color:${C.ink};
}
.vrf-share-btn svg{width:14px;height:14px}

/* STATS GRID ===================================================== */
.vrf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.vrf-stat{
  padding:16px 14px;border-radius:18px;
  background:${C.glass};backdrop-filter:blur(10px);
  border:1px solid ${C.border};
  animation:vrf-rise .5s cubic-bezier(.2,1,.3,1) backwards;
}
.vrf-stat:nth-child(1){animation-delay:.04s}
.vrf-stat:nth-child(2){animation-delay:.08s}
.vrf-stat:nth-child(3){animation-delay:.12s}
.vrf-stat:nth-child(4){animation-delay:.16s}
.vrf-stat-l{
  font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;
  letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};
  display:flex;align-items:center;gap:6px;margin-bottom:8px;
}
.vrf-stat-l .gl{font-size:11px;color:${C.cyan}}
.vrf-stat-v{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:24px;line-height:1;letter-spacing:-.015em;color:${C.ink};
}
.vrf-stat-v .u{
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  color:${C.ink2};margin-left:4px;letter-spacing:.04em;
}
.vrf-stat-v.gn{color:${C.green}}
.vrf-stat-v.it{font-style:italic;color:${C.ink3};font-weight:400}
.vrf-stat-m{
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;
  color:${C.ink2};margin-top:6px;letter-spacing:.02em;
}
@media(max-width:768px){
  .vrf-stats{grid-template-columns:1fr 1fr}
  .vrf-stat-v{font-size:22px}
}

/* BOOST =========================================================== */
.vrf-boost{
  margin-top:14px;padding:20px;border-radius:22px;
  background:linear-gradient(135deg,rgba(255,212,107,.18),rgba(255,176,136,.10));
  border:1px solid rgba(255,212,107,.32);
}
.vrf-boost-head{
  display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;flex-wrap:wrap;margin-bottom:14px;
}
.vrf-boost-l{flex:1;min-width:200px}
.vrf-boost-eye{
  font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;
  letter-spacing:.16em;text-transform:uppercase;color:#9F7400;
  margin-bottom:6px;
}
.vrf-boost-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:22px;line-height:1.15;letter-spacing:-.015em;
  color:${C.ink};margin:0 0 4px;
}
.vrf-boost-h .it{font-style:italic;color:#B36B00}
.vrf-boost-s{font-size:13px;color:${C.ink2};line-height:1.5;margin:0;max-width:420px}
.vrf-boost-s b{color:${C.ink};font-weight:700}
.vrf-boost-rate{
  display:flex;align-items:baseline;gap:5px;flex-shrink:0;
  font-family:'Instrument Serif',serif;
}
.vrf-boost-rate .v{font-size:42px;line-height:1;color:#B36B00;letter-spacing:-.025em}
.vrf-boost-rate .u{
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  color:${C.ink2};letter-spacing:.06em;
}
.vrf-boost-in{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.vrf-boost-input{
  flex:1;min-width:180px;min-height:44px;
  padding:0 16px;border-radius:12px;
  background:rgba(255,255,255,.55);
  border:1.5px solid rgba(255,212,107,.32);
  color:${C.ink};font-family:'JetBrains Mono',monospace;
  font-size:14px;font-weight:700;outline:none;
  letter-spacing:.12em;text-transform:uppercase;
  transition:border-color .2s;
}
.vrf-boost-input:focus{border-color:#FFB347}
.vrf-boost-input::placeholder{
  color:${C.ink3};text-transform:none;letter-spacing:.02em;font-weight:600;
}
.vrf-boost-go{
  flex-shrink:0;min-height:44px;padding:0 22px;border-radius:12px;
  background:linear-gradient(135deg,${C.gold},${C.peach});
  color:${C.ink};border:none;cursor:pointer;
  font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11px;
  letter-spacing:.1em;transition:transform .12s;
}
.vrf-boost-go:hover:not(:disabled){transform:translateY(-1px)}
.vrf-boost-go:disabled{opacity:.5;cursor:wait}
.vrf-boost-msg{
  margin-top:10px;font-family:'JetBrains Mono',monospace;
  font-size:11px;font-weight:700;padding:9px 14px;border-radius:10px;
  letter-spacing:.02em;
}
.vrf-boost-msg.ok{color:${C.green};background:rgba(127,255,212,.2)}
.vrf-boost-msg.err{color:${C.red};background:rgba(209,75,106,.12)}

.vrf-boost-active{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:16px 18px;border-radius:14px;
  background:rgba(255,255,255,.45);
  border:1px solid rgba(255,212,107,.40);
}
.vrf-boost-active-glyph{
  width:42px;height:42px;border-radius:12px;flex-shrink:0;
  background:linear-gradient(135deg,${C.gold},#FFB347);
  display:grid;place-items:center;font-size:22px;color:#5C4200;
  box-shadow:0 4px 14px rgba(255,212,107,.42);
}
.vrf-boost-active-t{flex:1;min-width:160px}
.vrf-boost-active-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:18px;color:#9F7400;letter-spacing:-.005em;
}
.vrf-boost-active-s{
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;
  color:${C.ink2};letter-spacing:.02em;margin-top:3px;
}
.vrf-boost-active-pct{
  flex-shrink:0;display:flex;align-items:baseline;gap:4px;
  font-family:'Instrument Serif',serif;color:#9F7400;letter-spacing:-.02em;
}
.vrf-boost-active-pct .v{font-size:28px}
.vrf-boost-active-pct .u{
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  color:${C.ink2};letter-spacing:.06em;
}

/* MECHANICS GRID ================================================== */
.vrf-mech{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.vrf-mech-card{
  position:relative;overflow:hidden;
  padding:22px 20px 20px;border-radius:24px;
  background:${C.glassStrong};backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.85);
  transition:transform .15s,box-shadow .2s;
  animation:vrf-rise .45s cubic-bezier(.2,1,.3,1) backwards;
}
.vrf-mech-card:nth-child(1){animation-delay:.04s}
.vrf-mech-card:nth-child(2){animation-delay:.08s}
.vrf-mech-card:nth-child(3){animation-delay:.12s}
.vrf-mech-card:nth-child(4){animation-delay:.16s}
.vrf-mech-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(160,231,255,.16)}
.vrf-mech-num{
  display:inline-flex;align-items:center;gap:8px;
  font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;
  letter-spacing:.16em;text-transform:uppercase;color:var(--vrf-acc,${C.cyan});
  margin-bottom:14px;
}
.vrf-mech-num .glyph{
  width:30px;height:30px;border-radius:10px;
  display:inline-grid;place-items:center;
  background:var(--vrf-acc-bg,rgba(61,212,245,.14));
  border:1px solid var(--vrf-acc-border,rgba(61,212,245,.30));
  font-family:'Instrument Serif',serif;font-style:italic;
  font-weight:400;font-size:13px;color:var(--vrf-acc,${C.cyan});
}
.vrf-mech-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:19px;line-height:1.2;letter-spacing:-.015em;
  color:${C.ink};margin:0 0 8px;
}
.vrf-mech-h .it{font-style:italic;color:var(--vrf-acc,${C.cyan})}
.vrf-mech-b{
  font-size:13px;line-height:1.55;color:${C.ink2};margin:0;
  font-family:'Space Grotesk',sans-serif;
}
.vrf-mech-b b{color:${C.ink};font-weight:700}
.vrf-mech-card.c1{--vrf-acc:${C.cyan};--vrf-acc-bg:rgba(61,212,245,.14);--vrf-acc-border:rgba(61,212,245,.30)}
.vrf-mech-card.c2{--vrf-acc:${C.pink};--vrf-acc-bg:rgba(255,143,190,.16);--vrf-acc-border:rgba(255,143,190,.32)}
.vrf-mech-card.c3{--vrf-acc:#B36B00;--vrf-acc-bg:rgba(255,212,107,.20);--vrf-acc-border:rgba(255,212,107,.36)}
.vrf-mech-card.c4{--vrf-acc:${C.green};--vrf-acc-bg:rgba(127,255,212,.20);--vrf-acc-border:rgba(127,255,212,.40)}
@media(max-width:1000px){.vrf-mech{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.vrf-mech{grid-template-columns:1fr}}

/* MATH EXAMPLE =================================================== */
.vrf-math{
  padding:28px;border-radius:24px;
  background:linear-gradient(135deg,rgba(127,255,212,.10),${C.glassStrong});
  border:1px solid rgba(127,255,212,.30);
  display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;
}
.vrf-math-h{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:28px;line-height:1.1;letter-spacing:-.02em;
  color:${C.ink};margin:0 0 10px;
}
.vrf-math-h .it{font-style:italic;color:${C.green}}
.vrf-math-s{font-size:14px;line-height:1.55;color:${C.ink2};margin:0}
.vrf-calc{
  padding:22px 24px;border-radius:18px;
  background:rgba(255,255,255,.60);border:1px solid ${C.border};
  font-family:'JetBrains Mono',monospace;
}
.vrf-calc-row{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  padding:9px 0;border-bottom:1px solid ${C.hairline};
}
.vrf-calc-row:last-child{
  border-bottom:none;padding-top:14px;margin-top:6px;
  border-top:1px solid ${C.border};
}
.vrf-calc-k{
  font-size:11px;font-weight:700;color:${C.ink2};
  letter-spacing:.04em;text-transform:uppercase;
}
.vrf-calc-v{
  font-size:16px;font-weight:800;color:${C.ink};
  letter-spacing:.02em;font-variant-numeric:tabular-nums;
}
.vrf-calc-v.dim{color:${C.ink3};font-weight:600}
.vrf-calc-row:last-child .vrf-calc-k{
  font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;
  font-size:14px;color:${C.green};text-transform:none;letter-spacing:0;
}
.vrf-calc-row:last-child .vrf-calc-v{
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:28px;color:${C.green};letter-spacing:-.015em;
}
.vrf-calc-row:last-child .vrf-calc-v .u{
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  color:${C.ink2};margin-left:5px;
}
.vrf-calc-note{
  font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;
  color:${C.ink3};margin-top:12px;line-height:1.5;letter-spacing:.01em;
  text-align:right;
}
@media(max-width:900px){
  .vrf-math{grid-template-columns:1fr;gap:20px;padding:22px}
  .vrf-math-h{font-size:24px}
}

/* FAQ ============================================================ */
.vrf-faq{display:flex;flex-direction:column;gap:8px}
.vrf-faq-item{
  background:${C.glassStrong};border:1px solid ${C.border};
  border-radius:16px;overflow:hidden;
  transition:border-color .2s;
}
.vrf-faq-item.open{border-color:${C.borderHi}}
.vrf-faq-q{
  width:100%;padding:18px 22px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:transparent;border:none;cursor:pointer;
  color:${C.ink};text-align:left;
  font-family:'Instrument Serif',serif;font-weight:400;
  font-size:17px;letter-spacing:-.005em;line-height:1.3;
}
.vrf-faq-q .ic{
  flex-shrink:0;width:28px;height:28px;border-radius:50%;
  background:${C.glass};border:1px solid ${C.border};
  display:grid;place-items:center;color:${C.ink2};
  transition:transform .25s;font-family:initial;
}
.vrf-faq-item.open .vrf-faq-q .ic{
  transform:rotate(45deg);color:${C.pink};border-color:rgba(255,143,190,.4);
}
.vrf-faq-a{
  padding:0 22px;font-size:14px;line-height:1.6;color:${C.ink2};
  max-height:0;overflow:hidden;
  transition:max-height .3s cubic-bezier(.2,1,.3,1),padding .3s;
  font-family:'Space Grotesk',sans-serif;
}
.vrf-faq-item.open .vrf-faq-a{padding:0 22px 20px;max-height:400px}
.vrf-faq-a b{color:${C.ink};font-weight:700}

/* SPINNER / ERROR ================================================ */
.vrf-spin{
  display:inline-block;width:14px;height:14px;border-radius:50%;
  border:2px solid rgba(26,27,78,.15);border-top-color:${C.cyan};
  animation:vrf-spin .8s linear infinite;vertical-align:-3px;margin-right:7px;
}
.vrf-error-msg{
  margin-top:10px;padding:9px 14px;border-radius:10px;
  background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.28);
  font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
  color:${C.red};letter-spacing:.02em;
}

/* TOAST ========================================================== */
.vrf-toast{
  position:fixed;left:50%;bottom:calc(80px + env(safe-area-inset-bottom));
  transform:translateX(-50%);z-index:200;
  display:flex;align-items:center;gap:10px;
  padding:13px 20px;border-radius:14px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(16px);
  border:1px solid ${C.borderHi};
  font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:700;
  color:${C.ink};letter-spacing:.04em;
  box-shadow:0 12px 32px rgba(26,27,78,.18);
  animation:vrf-rise .25s ease;
}
.vrf-toast .gl{color:${C.green};font-size:14px}

@media(prefers-reduced-motion:reduce){
  .vrf-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}
  .vrf-orbit-dot{display:none}
}
`;

function useVrfCss() {
  useEffect(() => {
    const id = 'nexus-vrf-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = VRF_CSS;
    document.head.appendChild(el);
  }, []);
}

// ── helpers ─────────────────────────────────────────────────────────
const lamportsToSol = (l) => Number(l || 0) / 1e9;
function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
function formatSolSigned(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  return (n >= 0 ? '+' : '-') + formatSol(Math.abs(n));
}
function truncWallet(w) { return w ? w.slice(0, 4) + '…' + w.slice(-4) : ''; }

const IconX = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);
const IconTg = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
  </svg>
);
const IconDs = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);
const IconLink = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
export default function ReferralsPage({ onConnectWallet } = {}) {
  useVrfCss();
  const nexus = useNexusWallet();
  // Main wallet only — the externally-connected one (Phantom/Solflare via WalletModal).
  // Burner wallets from Ape aren't used here; KOLs need a wallet they can trust long-term.
  const walletStr = nexus?.walletAddress || '';
  const isConnected = !!walletStr;

  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [copied, setCopied] = useState(false);
  const [dsCopied, setDsCopied] = useState(false);
  const [faqOpen, setFaqOpen] = useState(0);
  const [toast, setToast] = useState(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://swap.verixiaapps.com';
  const refLink = walletStr ? `${origin}/?ref=${walletStr}` : '';

  // Register this wallet so it shows up in the users table — also captures any
  // ?ref= or ?boost= that brought them in.
  const registeredRef = useRef('');
  useEffect(() => {
    if (!walletStr || registeredRef.current === walletStr) return;
    registeredRef.current = walletStr;
    let referrer = null, boost = null;
    try {
      const p = new URLSearchParams(window.location.search);
      referrer = p.get('ref');
      boost = p.get('boost');
    } catch (e) {}
    fetch('/api/ref/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletStr, referrer: referrer || null, boost: boost || null }),
    }).catch(() => {});
  }, [walletStr]);

  const fetchStats = useCallback(async () => {
    if (!walletStr) return;
    setStatsLoading(true);
    try {
      const r = await fetch('/api/ref/stats?wallet=' + walletStr);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setStats(d); setStatsErr(null);
    } catch (e) {
      setStatsErr(String((e && e.message) || 'Network').slice(0, 100));
    } finally {
      setStatsLoading(false);
    }
  }, [walletStr]);

  useEffect(() => {
    if (!walletStr) { setStats(null); return; }
    fetchStats();
    const id = setInterval(fetchStats, 30000);
    return () => clearInterval(id);
  }, [walletStr, fetchStats]);

  const onCopy = useCallback(() => {
    if (!refLink) return;
    try {
      navigator.clipboard.writeText(refLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {}
  }, [refLink]);

  const tweetText = useMemo(() => [
    "Routing trades through Nexus DEX — Solana super-app with the brand tokens, fresh launches, and bridges all in one wallet.",
    '',
    "My line pays out on-chain, same block as every trade. No claims, no withdrawals:",
  ].join('\n'), []);

  const onShareX = useCallback(() => {
    if (!refLink) return;
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweetText) + '&url=' + encodeURIComponent(refLink);
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
  }, [refLink, tweetText]);

  const onShareTg = useCallback(() => {
    if (!refLink) return;
    const url = 'https://t.me/share/url?url=' + encodeURIComponent(refLink) + '&text=' + encodeURIComponent(tweetText);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [refLink, tweetText]);

  // Pull data out of stats
  const earnedAll = lamportsToSol(stats?.earned_lamports);
  const earned7d  = lamportsToSol(stats?.earned_lamports_7d);
  const earned24h = lamportsToSol(stats?.earned_lamports_24h);
  const referees     = stats?.referees || 0;
  const activeReferees = stats?.active_referees || 0;
  const boosted      = !!stats?.boost_active;
  const boostUntil   = stats?.boost_until ? new Date(stats.boost_until) : null;
  // bps_now: 5000 = 50% (default). Stays at 5000 unless we lower the rate later.
  const splitPct     = ((stats?.split_bps_now || 5000) / 100);

  const faq = [
    {
      q: 'How exactly does the payout work?',
      a: <>Every trade on Nexus DEX carries a small platform fee. <b>50% of that fee</b> is included as a second transfer instruction in the same transaction your referee signs to trade. The moment their trade confirms, your wallet has the SOL. The server never touches the money — there's nothing to claim, nothing to withdraw, no team in the loop.</>,
    },
    {
      q: 'Is the 50% rate going to stay?',
      a: <>It's the rate today, and it's not going down for anyone who's already signed up. If we ever lower the default for new sign-ups, every existing referral relationship is <b>locked in at the rate that was active when it started</b> — same wallet, same link, same payout. That's why early adopters get rewarded for being early.</>,
    },
    {
      q: 'Can someone overwrite a referee I brought?',
      a: <>No. The first time a wallet trades through any referral link, that link is <b>locked in permanently</b>. Even if they later visit a different link, click another invite, or follow another KOL — the trade fee still routes to whoever was their first referrer. You don't lose people you brought.</>,
    },
    {
      q: 'Why does this require a main wallet?',
      a: <>Earnings are settled trade-by-trade into the wallet attached to your link. If you lose access to that wallet, you lose access to past earnings — same as any other on-chain asset. <b>Use a wallet you'll still own next year</b> (Phantom, Solflare, Backpack), not a burner you might wipe.</>,
    },
    {
      q: 'Where can I share the link?',
      a: <>Anywhere your audience hangs out. Crypto Twitter, Telegram, Discord, your YouTube, Substack — all fine. Just don't claim Nexus DEX is something it isn't (no fake APY, no fake screenshots). If you've got real volume and want a custom landing page for your audience, DM us.</>,
    },
    {
      q: "How do I see what's been earned and when?",
      a: <>Stats appear above in real time, refreshing every 30 seconds. Every payout is a real Solana transaction — you can also see them in any block explorer pointed at your wallet. <b>If a number on this page disagrees with the chain, the chain wins.</b></>,
    },
  ];

  return (
    <div className="vrf-root">

      {/* HERO ================================================== */}
      <section className="vrf-hero">
        <div className="vrf-eyebrow">
          <span className="d" />
          <span>NEXUS DEX · PARTNER PROGRAM</span>
        </div>
        <div className="vrf-hero-grid">
          <div className="vrf-hero-l">
            <h1 className="vrf-h1">
              Get paid<br />
              on every trade<br />
              <span className="it">your line brings in.</span>
            </h1>
            <p className="vrf-sub">
              Hand someone your link. The moment they trade through Nexus DEX, <b>50% of the platform fee lands in your wallet</b> — built into the same Solana transaction they sign. No claims. No withdrawals. Same block.
            </p>
            <div className="vrf-cta-row">
              <button
                className="vrf-cta-primary"
                onClick={() => {
                  if (isConnected) {
                    const el = document.getElementById('vrf-your-line');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } else if (onConnectWallet) {
                    onConnectWallet();
                  }
                }}
              >
                {isConnected ? <>See your line <span className="arrow">→</span></> : <>Connect &amp; get my link <span className="arrow">→</span></>}
              </button>
              <button
                className="vrf-cta-ghost"
                onClick={() => {
                  const el = document.getElementById('vrf-how');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                How it works
              </button>
            </div>
            <div className="vrf-trust-strip">
              <span className="item"><span className="glyph">●</span><span>On-chain payouts</span></span>
              <span className="dot">·</span>
              <span className="item"><span className="glyph">●</span><span>Permanent attribution</span></span>
              <span className="dot">·</span>
              <span className="item"><span className="glyph">●</span><span>Same-block settlement</span></span>
            </div>
          </div>
          <div className="vrf-hero-r">
            <div className="vrf-orbit">
              <div className="vrf-orbit-ring" />
              <div className="vrf-orbit-ring sm" />
              <div className="vrf-orbit-dot" />
              <div className="vrf-orbit-dot b" style={{ animationDelay: '-4s' }} />
              <div className="vrf-orbit-dot c" style={{ animationDelay: '-8s' }} />
            </div>
            <div className="vrf-thirty-three">50<span className="pct">%</span></div>
            <div className="vrf-thirty-three-label">of every <b>fee</b> · in your wallet</div>
          </div>
        </div>
      </section>

      {/* YOUR LINE / STATS ===================================== */}
      <section className="vrf-section" id="vrf-your-line">
        <div className="vrf-section-head">
          <div>
            <span className="vrf-section-eye"><span className="gl">01 ·</span> Your line</span>
          </div>
        </div>

        <div className="vrf-connect-card">
          {!isConnected ? (
            <div className="vrf-connect-empty">
              <div className="vrf-connect-empty-l">
                <h3 className="vrf-connect-empty-h">Connect a wallet you'll <span className="it">still own next year.</span></h3>
                <p className="vrf-connect-empty-s">
                  Referral earnings land in this wallet directly — there's no balance on a server you can claim later. Use Phantom, Solflare, or Backpack with a backed-up seed phrase. <b>Don't use a burner you might wipe.</b>
                </p>
              </div>
              <button className="vrf-cta-primary" onClick={onConnectWallet}>
                Connect wallet <span className="arrow">→</span>
              </button>
            </div>
          ) : (
            <div className="vrf-connect-active">
              <div className="vrf-wallet-row">
                <div className="vrf-wallet-avatar">{walletStr.charAt(0).toUpperCase()}</div>
                <div className="vrf-wallet-meta">
                  <div className="vrf-wallet-label"><span className="d" />Earnings land here</div>
                  <div className="vrf-wallet-addr">{walletStr}</div>
                </div>
                <button className="vrf-wallet-switch" onClick={onConnectWallet}>SWITCH</button>
              </div>

              {/* link */}
              <div className="vrf-link-box">
                <input className="vrf-link-input" value={refLink} readOnly onClick={(e) => e.target.select()} />
                <button className={'vrf-link-copy' + (copied ? ' copied' : '')} onClick={onCopy}>
                  <IconLink /> {copied ? '✓ COPIED' : 'COPY'}
                </button>
              </div>
              <div className="vrf-share-row">
                <button className="vrf-share-btn tw" onClick={onShareX}>
                  <IconX /><span>Share on X</span>
                </button>
                <button className="vrf-share-btn" onClick={onShareTg}>
                  <IconTg /><span>Share on Telegram</span>
                </button>
                <button className="vrf-share-btn" onClick={() => {
                  try {
                    const text = tweetText + '\n' + refLink;
                    navigator.clipboard.writeText(text);
                    setDsCopied(true);
                    setTimeout(() => setDsCopied(false), 1800);
                  } catch (e) {}
                }}>
                  <IconDs /><span>{dsCopied ? '✓ Copied for Discord' : 'Copy for Discord'}</span>
                </button>
              </div>

              {/* stats */}
              {statsErr ? (
                <div className="vrf-error-msg" style={{ marginTop: 14 }}>Stats unreachable · {statsErr}</div>
              ) : (
                <div className="vrf-stats">
                  <div className="vrf-stat">
                    <div className="vrf-stat-l"><span className="gl">№</span>Traders brought</div>
                    <div className="vrf-stat-v">
                      {statsLoading && !stats ? <span className="vrf-spin" /> : referees}
                    </div>
                    <div className="vrf-stat-m">{activeReferees} active</div>
                  </div>
                  <div className="vrf-stat">
                    <div className="vrf-stat-l"><span className="gl">◉</span>Earned · 24h</div>
                    <div className={'vrf-stat-v ' + (earned24h > 0 ? 'gn' : 'it')}>
                      {statsLoading && !stats ? <span className="vrf-spin" /> : earned24h > 0 ? formatSolSigned(earned24h) : '—'}
                      {!statsLoading && earned24h > 0 && <span className="u">SOL</span>}
                    </div>
                    <div className="vrf-stat-m">Last 24h</div>
                  </div>
                  <div className="vrf-stat">
                    <div className="vrf-stat-l"><span className="gl">◉</span>Earned · 7d</div>
                    <div className={'vrf-stat-v ' + (earned7d > 0 ? 'gn' : 'it')}>
                      {statsLoading && !stats ? <span className="vrf-spin" /> : earned7d > 0 ? formatSolSigned(earned7d) : '—'}
                      {!statsLoading && earned7d > 0 && <span className="u">SOL</span>}
                    </div>
                    <div className="vrf-stat-m">Rolling week</div>
                  </div>
                  <div className="vrf-stat">
                    <div className="vrf-stat-l"><span className="gl">§</span>All time</div>
                    <div className={'vrf-stat-v ' + (earnedAll > 0 ? 'gn' : 'it')}>
                      {statsLoading && !stats ? <span className="vrf-spin" /> : earnedAll > 0 ? formatSolSigned(earnedAll) : '—'}
                      {!statsLoading && earnedAll > 0 && <span className="u">SOL</span>}
                    </div>
                    <div className="vrf-stat-m">Since first referee</div>
                  </div>
                </div>
              )}

              {/* boost — input hidden; 50% is default for everyone.
                  The boosted-active card stays in case anyone activated a
                  boost code before the rate flip (legacy display only). */}
              {boosted && (
                <div className="vrf-boost">
                  <div className="vrf-boost-active">
                    <div className="vrf-boost-active-glyph">⚡</div>
                    <div className="vrf-boost-active-t">
                      <div className="vrf-boost-active-h">Partner rate locked</div>
                      <div className="vrf-boost-active-s">
                        {boostUntil ? 'Through ' + boostUntil.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Permanent rate'} · same link, no action needed
                      </div>
                    </div>
                    <div className="vrf-boost-active-pct"><span className="v">{splitPct.toFixed(0)}</span><span className="u">% / FEE</span></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* HOW IT WORKS ========================================== */}
      <section className="vrf-section" id="vrf-how">
        <div className="vrf-section-head">
          <div>
            <span className="vrf-section-eye"><span className="gl">02 ·</span> How the line pays</span>
            <h2 className="vrf-section-h" style={{ marginTop: 6 }}>Four steps. <span className="it">No middleman.</span></h2>
          </div>
        </div>

        <div className="vrf-mech">
          <div className="vrf-mech-card c1">
            <div className="vrf-mech-num"><span className="glyph">01</span><span>Share</span></div>
            <h4 className="vrf-mech-h">You post your <span className="it">link.</span></h4>
            <p className="vrf-mech-b">Drop it on X, Telegram, Discord, your podcast — wherever your people are. The link is wallet-keyed, so <b>nobody else's traffic ever credits you</b>.</p>
          </div>
          <div className="vrf-mech-card c2">
            <div className="vrf-mech-num"><span className="glyph">02</span><span>Lock</span></div>
            <h4 className="vrf-mech-h">First trade <span className="it">locks them in.</span></h4>
            <p className="vrf-mech-b">When someone trades for the first time via your link, that wallet is <b>permanently attributed to you</b>. They can never be claimed by another referrer.</p>
          </div>
          <div className="vrf-mech-card c3">
            <div className="vrf-mech-num"><span className="glyph">03</span><span>Pay</span></div>
            <h4 className="vrf-mech-h">Every trade pays <span className="it">same block.</span></h4>
            <p className="vrf-mech-b">A platform fee runs through every Nexus trade. <b>50% of that fee</b> is added to your referee's transaction as a second transfer — to your wallet.</p>
          </div>
          <div className="vrf-mech-card c4">
            <div className="vrf-mech-num"><span className="glyph">04</span><span>Hold</span></div>
            <h4 className="vrf-mech-h">It's <span className="it">already yours.</span></h4>
            <p className="vrf-mech-b">No claims, no withdrawals, no server balance. SOL hits your wallet as the trade settles. <b>If it's not in your wallet, the trade didn't happen.</b></p>
          </div>
        </div>
      </section>

      {/* MATH ================================================== */}
      <section className="vrf-section">
        <div className="vrf-section-head">
          <div>
            <span className="vrf-section-eye"><span className="gl">03 ·</span> Quick math</span>
          </div>
        </div>
        <div className="vrf-math">
          <div>
            <h3 className="vrf-math-h">One follower, <span className="it">a month of trading.</span></h3>
            <p className="vrf-math-s">Not a promise — just the arithmetic. Real numbers depend entirely on your audience and how often they trade. We don't inflate projections.</p>
          </div>
          <div>
            <div className="vrf-calc">
              <div className="vrf-calc-row">
                <span className="vrf-calc-k">Trades / month</span>
                <span className="vrf-calc-v">40</span>
              </div>
              <div className="vrf-calc-row">
                <span className="vrf-calc-k">Avg trade size</span>
                <span className="vrf-calc-v">2 SOL</span>
              </div>
              <div className="vrf-calc-row">
                <span className="vrf-calc-k">Platform fee · 3%</span>
                <span className="vrf-calc-v dim">2.4 SOL</span>
              </div>
              <div className="vrf-calc-row">
                <span className="vrf-calc-k">Your 50% share</span>
                <span className="vrf-calc-v">1.2<span className="u">SOL</span></span>
              </div>
            </div>
            <div className="vrf-calc-note">Illustrative · per referee · varies entirely with activity</div>
          </div>
        </div>
      </section>

      {/* FAQ =================================================== */}
      <section className="vrf-section">
        <div className="vrf-section-head">
          <div>
            <span className="vrf-section-eye"><span className="gl">04 ·</span> FAQ</span>
            <h2 className="vrf-section-h" style={{ marginTop: 6 }}>Anything else?</h2>
          </div>
        </div>
        <div className="vrf-faq">
          {faq.map((item, i) => (
            <div className={'vrf-faq-item' + (faqOpen === i ? ' open' : '')} key={i}>
              <button className="vrf-faq-q" onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}>
                <span>{item.q}</span>
                <span className="ic">+</span>
              </button>
              <div className="vrf-faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      {toast && <div className="vrf-toast"><span className="gl">✓</span><span>{toast}</span></div>}
    </div>
  );
}
