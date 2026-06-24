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
import { useNexusWallet } from '../WalletContext.js';

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

.vrf-root{
  --ink:#0b0b0c; --ink-2:#86868b; --ink-3:#aeaeb2;
  --border:#e9e9eb; --hairline:#f1f1f2; --fill:#f4f4f5; --fill-2:#fafafa;
  --green:#16c08a; --greent:#11b87f; --red:#f0425a; --blue:#2f6bff; --gold:#a67200; --indigo:#5865F2;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink); background:#ffffff; min-height:100dvh; position:relative; overflow-x:hidden;
  -webkit-font-smoothing:antialiased;
}
.vrf-root *{box-sizing:border-box}
.vrf-root [class*="-v"],.vrf-stat-v,.vrf-calc-v,.vrf-wallet-addr,.vrf-link-input,.vrf-boost-active-pct,.vrf-boost-rate,.vrf-thirty-three{font-variant-numeric:tabular-nums}
@keyframes vrf-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes vrf-fade{from{opacity:0}to{opacity:1}}
@keyframes vrf-shimmer{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes vrf-spin{to{transform:rotate(360deg)}}
@keyframes vrf-pulse{0%,100%{opacity:1}50%{opacity:.35}}

/* HERO removed */
.vrf-hero{display:none}
.vrf-h1,.vrf-sub,.vrf-orbit,.vrf-orbit-ring,.vrf-orbit-dot,.vrf-thirty-three,.vrf-thirty-three-label,.vrf-hero-grid,.vrf-hero-l,.vrf-hero-r,.vrf-trust-strip{display:none}
.vrf-h1 .it{font-style:normal;color:var(--ink-2)}

/* eyebrow */
.vrf-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);background:var(--fill);padding:6px 12px;border-radius:999px;margin:8px 0 0}
.vrf-eyebrow .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:vrf-pulse 1.4s infinite}

/* layout */
.vrf-section{max-width:560px;margin:0 auto;padding:18px 16px 6px;animation:vrf-rise .4s cubic-bezier(.2,1,.3,1) backwards}
.vrf-section-head{margin-bottom:12px}
.vrf-section-eye{display:block;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.vrf-section-eye .gl{color:var(--ink);font-weight:800}
.vrf-section-h{font-size:21px;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin-top:6px}
.vrf-section-h .it{font-style:normal;color:var(--ink-2)}
.vrf-sub{font-size:14px;line-height:1.5;color:var(--ink-2);font-weight:500}

/* connect card */
.vrf-connect-card{max-width:560px;margin:0 auto;border:1px solid var(--hairline);border-radius:18px;background:#fff;box-shadow:0 1px 2px rgba(11,11,12,.04);overflow:hidden}
.vrf-connect-empty{display:flex;align-items:center;gap:16px;padding:22px 18px;flex-wrap:wrap}
.vrf-connect-empty-l{flex:1;min-width:200px}
.vrf-connect-empty-h{font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.25;color:var(--ink);margin:0 0 6px}
.vrf-connect-empty-h .it{font-style:normal;color:var(--ink-2)}
.vrf-connect-empty-s{font-size:13px;font-weight:500;line-height:1.5;color:var(--ink-2);margin:0}
.vrf-connect-active{padding:0}

/* wallet row */
.vrf-wallet-row{display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--hairline)}
.vrf-wallet-avatar{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#7c5cff,#5a3ed1);display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;flex-shrink:0;text-transform:uppercase}
.vrf-wallet-meta{flex:1;min-width:0}
.vrf-wallet-label{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);display:flex;align-items:center;gap:6px}
.vrf-wallet-label .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:vrf-pulse 1.4s infinite}
.vrf-wallet-addr{font-size:12px;color:var(--ink);font-weight:600;margin-top:3px;word-break:break-all;line-height:1.35}
.vrf-wallet-switch{flex-shrink:0;font-size:9.5px;font-weight:800;letter-spacing:.06em;color:var(--ink);background:var(--fill);border:none;padding:8px 12px;border-radius:9px;cursor:pointer;transition:.14s}
.vrf-wallet-switch:hover{background:#ececee}

/* link box */
.vrf-link-box{display:flex;gap:8px;padding:14px 16px 4px}
.vrf-link-box:focus-within .vrf-link-input{border-color:#0b0b0c}
.vrf-link-input{flex:1;min-width:0;border:1px solid var(--border);border-radius:11px;padding:11px 13px;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:var(--fill-2);outline:none;text-overflow:ellipsis}
.vrf-link-copy{flex-shrink:0;background:#0b0b0c;color:#fff;border:none;border-radius:11px;padding:0 18px;font-family:inherit;font-size:11.5px;font-weight:800;letter-spacing:.04em;cursor:pointer;transition:.14s}
.vrf-link-copy:hover{opacity:.9}
.vrf-link-copy.copied{background:var(--green)}

/* share */
.vrf-share-row{display:flex;gap:8px;padding:10px 16px 16px}
.vrf-share-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--border);border-radius:11px;padding:11px 0;font-family:inherit;font-size:12px;font-weight:700;background:var(--fill);color:var(--ink);cursor:pointer;transition:.14s}
.vrf-share-btn:hover{background:#ececee}
.vrf-share-btn.tw{background:#0b0b0c;color:#fff;border-color:transparent}

/* stats */
.vrf-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:14px 16px}
.vrf-stat{border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;background:var(--fill-2);animation:vrf-rise .5s cubic-bezier(.2,1,.3,1) backwards}
.vrf-stat:nth-child(1){animation-delay:.04s}.vrf-stat:nth-child(2){animation-delay:.08s}.vrf-stat:nth-child(3){animation-delay:.12s}.vrf-stat:nth-child(4){animation-delay:.16s}
.vrf-stat-l{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);display:flex;align-items:center;gap:6px}
.vrf-stat-l .gl{color:var(--ink-3);font-size:11px}
.vrf-stat-v{font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin-top:6px;line-height:1.05}
.vrf-stat-v .u{font-size:12px;font-weight:700;color:var(--ink-2);margin-left:3px}
.vrf-stat-v.gn{color:var(--greent)}
.vrf-stat-v.it{font-style:normal;color:var(--ink-3)}
.vrf-stat-m{font-size:10.5px;font-weight:600;color:var(--ink-2);margin-top:4px}

/* boost (legacy active card) */
.vrf-boost{padding:14px 16px 0}
.vrf-boost-head{margin-bottom:10px}
.vrf-boost-eye{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.vrf-boost-h{font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--ink);margin-top:4px}
.vrf-boost-h .it{font-style:normal;color:var(--ink-2)}
.vrf-boost-s,.vrf-boost-l{font-size:12px;font-weight:500;color:var(--ink-2);line-height:1.5}
.vrf-boost-in{display:flex;gap:8px;margin-top:10px}
.vrf-boost-input{flex:1;min-width:0;border:1px solid var(--border);border-radius:11px;padding:11px 13px;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink);background:var(--fill-2);outline:none}
.vrf-boost-input:focus{border-color:#0b0b0c}
.vrf-boost-go{flex-shrink:0;background:#0b0b0c;color:#fff;border:none;border-radius:11px;padding:0 18px;font-family:inherit;font-size:12px;font-weight:800;letter-spacing:.04em;cursor:pointer;transition:.14s}
.vrf-boost-go:hover:not(:disabled){opacity:.9}
.vrf-boost-go:disabled{opacity:.5;cursor:not-allowed;background:var(--fill);color:var(--ink-3)}
.vrf-boost-msg{font-size:11.5px;font-weight:600;margin-top:8px}
.vrf-boost-msg.ok{color:var(--greent)}
.vrf-boost-msg.err{color:var(--red)}
.vrf-boost-rate{font-weight:800;color:var(--ink)}
.vrf-boost-rate .v{color:var(--greent)}
.vrf-boost-rate .u{color:var(--ink-2);font-size:.8em}
.vrf-boost-active{display:flex;align-items:center;gap:12px;border:1px solid rgba(22,192,138,.3);border-radius:14px;padding:14px 16px;background:rgba(22,192,138,.05)}
.vrf-boost-active-glyph{width:36px;height:36px;border-radius:11px;background:var(--green);display:grid;place-items:center;color:#fff;font-size:17px;flex-shrink:0}
.vrf-boost-active-t{flex:1;min-width:0}
.vrf-boost-active-h{font-size:15px;font-weight:700;color:var(--ink)}
.vrf-boost-active-s{font-size:11.5px;font-weight:500;color:var(--ink-2);margin-top:2px}
.vrf-boost-active-pct{text-align:right;flex-shrink:0}
.vrf-boost-active-pct .v{font-size:22px;font-weight:800;letter-spacing:-.02em;color:var(--greent)}
.vrf-boost-active-pct .u{font-size:9px;font-weight:800;letter-spacing:.04em;color:var(--ink-2);display:block}

/* mechanics */
.vrf-mech{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.vrf-mech-card{border:1px solid var(--hairline);border-radius:16px;padding:15px 16px;background:#fff;box-shadow:0 1px 2px rgba(11,11,12,.04);animation:vrf-rise .45s cubic-bezier(.2,1,.3,1) backwards;transition:border-color .14s}
.vrf-mech-card:hover{border-color:var(--border)}
.vrf-mech-card:nth-child(1){animation-delay:.04s}.vrf-mech-card:nth-child(2){animation-delay:.09s}.vrf-mech-card:nth-child(3){animation-delay:.14s}.vrf-mech-card:nth-child(4){animation-delay:.19s}
.vrf-mech-card.c1,.vrf-mech-card.c2,.vrf-mech-card.c3,.vrf-mech-card.c4{background:#fff}
.vrf-mech-num{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.vrf-mech-num .glyph{width:26px;height:26px;border-radius:8px;background:#0b0b0c;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:800;flex-shrink:0;font-variant-numeric:tabular-nums}
.vrf-mech-num span:last-child{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.vrf-mech-h{font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--ink);margin:0 0 5px}
.vrf-mech-h .it{font-style:normal;color:var(--ink-2)}
.vrf-mech-b{font-size:12.5px;line-height:1.5;color:var(--ink-2);font-weight:500;margin:0}
.vrf-mech-b b{color:var(--ink);font-weight:700}

/* math / calc */
.vrf-math{max-width:560px;margin:0 auto}
.vrf-math-h{font-size:17px;font-weight:700;letter-spacing:-.01em;color:var(--ink);margin:0 0 5px}
.vrf-math-h .it{font-style:normal;color:var(--ink-2)}
.vrf-math-s{font-size:12px;line-height:1.5;color:var(--ink-2);font-weight:500;margin:0 0 12px}
.vrf-calc{border:1px solid var(--hairline);border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.vrf-calc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--hairline);font-size:13px;font-weight:600}
.vrf-calc-row:last-child{background:rgba(22,192,138,.06);border-bottom:none}
.vrf-calc-row:last-child .vrf-calc-k{color:var(--ink);font-weight:700}
.vrf-calc-row:last-child .vrf-calc-v{color:var(--greent);font-size:18px}
.vrf-calc-row:last-child .vrf-calc-v .u{font-size:11px;color:var(--ink-2);margin-left:3px;font-weight:700}
.vrf-calc-k{color:var(--ink-2)}
.vrf-calc-v{font-weight:800;color:var(--ink)}
.vrf-calc-v.dim{color:var(--ink-3)}
.vrf-calc-note{font-size:10px;font-weight:600;color:var(--ink-3);text-align:center;padding:11px 12px}

/* faq */
.vrf-faq{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.vrf-faq-item{border:1px solid var(--hairline);border-radius:14px;background:#fff;overflow:hidden;transition:border-color .14s}
.vrf-faq-item.open{border-color:var(--border)}
.vrf-faq-q{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;font-family:inherit;font-size:14px;font-weight:700;background:none;border:none;text-align:left;color:var(--ink);cursor:pointer}
.vrf-faq-q .ic{color:var(--ink-3);font-size:14px;flex-shrink:0;transition:transform .2s}
.vrf-faq-item.open .vrf-faq-q .ic{transform:rotate(45deg);color:var(--ink)}
.vrf-faq-a{max-height:0;overflow:hidden;padding:0 16px;font-size:12.5px;line-height:1.55;color:var(--ink-2);font-weight:500;transition:max-height .25s ease,padding .25s ease}
.vrf-faq-item.open .vrf-faq-a{max-height:340px;padding:0 16px 14px}

/* cta */
.vrf-cta-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.vrf-cta-primary{display:inline-flex;align-items:center;gap:8px;background:#0b0b0c;color:#fff;border:none;border-radius:999px;padding:13px 22px;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:-.005em;cursor:pointer;animation:none;transition:opacity .14s}
.vrf-cta-primary:hover{opacity:.92}
.vrf-cta-primary:active{transform:translateY(1px)}
.vrf-cta-primary .arrow{font-weight:800}
.vrf-cta-ghost{display:inline-flex;align-items:center;gap:8px;background:var(--fill);color:var(--ink);border:1px solid transparent;border-radius:999px;padding:13px 20px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:.14s}
.vrf-cta-ghost:hover{background:#ececee}

/* toast / spin / error */
.vrf-toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:9px;padding:13px 18px;border-radius:14px;background:#fff;border:1px solid var(--hairline);box-shadow:0 12px 32px rgba(11,11,12,.16);font-size:12.5px;font-weight:700;color:var(--ink);animation:vrf-rise .25s ease}
.vrf-toast .gl{font-size:14px;color:var(--greent)}
.vrf-spin{width:16px;height:16px;border-radius:50%;border:2px solid var(--hairline);border-top-color:#0b0b0c;animation:vrf-spin .75s linear infinite;display:inline-block;vertical-align:-3px}
.vrf-error-msg{font-size:11.5px;font-weight:600;color:var(--red);background:rgba(240,66,90,.07);border:1px solid rgba(240,66,90,.24);border-radius:10px;padding:9px 12px}
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
