// LaunchRadar.jsx — Solana new launches + quick buy/sell.
// Pastel UI consistent with Wonderland. Two isolated lanes:
//   FRESH  → pump.fun WSS + DexScreener (browser-direct, no backend)
//   RECENT → /api/jupiter/tokens/v2/recent (existing backend)
// One-click buy/sell via Jupiter — atomic fee split (3% total, 1% to referrer if present).
// Swap logic reuses Wonderland's exact pattern.
//
// ⚠️  BEFORE THIS WORKS IN PRODUCTION:
// The CSP in server.js must allow the fresh-lane endpoints. Add to connect-src:
//   wss://pumpportal.fun
//   https://api.dexscreener.com
// Easiest way: set the env var EXTRA_CSP_CONNECT_SRC="wss://pumpportal.fun,https://api.dexscreener.com"
// Without these, the websocket and DexScreener calls will be blocked silently in production
// (you'll see the FRESH tab forever stuck on "Warming up the launch stream…").

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

/* ════════════════════════════════════════════════════════════════════
   CSS — pastel, matched to Wonderland's language
   ════════════════════════════════════════════════════════════════════ */
const LR_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
.lr-root{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --pink:#FF8FBE; --mint:#7FFFD4; --lav:#B794F6; --peach:#FFB088;
  --sky:#A0E7FF; --gold:#FFD46B; --green:#1B7A4F; --red:#D14B6A;
  --glass:rgba(255,255,255,0.6); --glass-strong:rgba(255,255,255,0.78);
  --border:rgba(183,148,246,0.22);
  min-height:100vh;color:var(--ink);
  font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;
  position:relative;overflow-x:hidden;padding-bottom:80px;
  background:
    radial-gradient(ellipse at 20% 5%,#FFE8F4 0%,transparent 45%),
    radial-gradient(ellipse at 85% 15%,#E4F2FF 0%,transparent 45%),
    radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),
    radial-gradient(ellipse at 15% 95%,#FFF3E4 0%,transparent 45%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  background-attachment:fixed;
}
.lr-root,.lr-root *{box-sizing:border-box}
@keyframes lrDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes lrPulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes lrPulseScale{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.5}}
@keyframes lrFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes lrRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes lrPopIn{0%{opacity:0;transform:scale(.92) translateY(8px)}60%{transform:scale(1.02) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes lrSpin{to{transform:rotate(360deg)}}
@keyframes lrSweep{0%{transform:rotate(0deg);opacity:.5}100%{transform:rotate(360deg);opacity:.5}}
@keyframes lrTickerNum{0%{transform:translateY(0)}100%{transform:translateY(-100%)}}
@keyframes lrShimmerSlide{0%{left:-110px}50%,100%{left:130%}}
@keyframes lrSlideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes lrSlideDown{to{transform:translateY(120%);opacity:0}}

.lr-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:0.45;animation:lrDrift 14s ease-in-out infinite;pointer-events:none;z-index:0}

.lr-phone{max-width:480px;margin:0 auto;position:relative;padding-bottom:32px;z-index:5}

/* ───── TOPBAR (matches Wonderland) ───── */
.lr-topbar{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:rgba(251,245,255,0.72);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.lr-brand{display:flex;align-items:center;gap:10px;cursor:pointer}
.lr-brand-dot{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);box-shadow:0 0 14px rgba(183,148,246,.5);position:relative}
.lr-brand-dot::after{content:'';position:absolute;inset:-6px;border-radius:50%;border:1.5px solid rgba(183,148,246,.4);border-top-color:transparent;border-right-color:transparent;animation:lrSpin 18s linear infinite}
.lr-brand-text{font-family:"Instrument Serif",serif;font-style:italic;font-size:18px;line-height:1}
.lr-brand-text .lr-slash{opacity:.4;margin:0 3px;font-style:normal}
.lr-topbar-right{display:flex;align-items:center;gap:8px}
.lr-wallet-btn{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(127,255,212,.35);letter-spacing:.2px}
.lr-wallet-btn.lr-connected{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);box-shadow:none}
.lr-wallet-btn .lr-wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}

/* ───── HERO ───── */
.lr-hero{padding:28px 18px 8px;text-align:center;position:relative;z-index:2}
.lr-hero-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:var(--ink-2);padding:5px 12px;border-radius:999px;background:var(--glass);border:1px solid var(--border);margin-bottom:14px}
.lr-radar-pulse{position:relative;width:8px;height:8px;border-radius:50%;background:var(--peach);box-shadow:0 0 8px var(--peach)}
.lr-radar-pulse::before{content:'';position:absolute;inset:-3px;border-radius:50%;background:var(--peach);opacity:.4;animation:lrPulseScale 1.6s ease-in-out infinite}
.lr-hero h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:42px;line-height:.98;letter-spacing:-.01em;margin:0 0 8px}
.lr-hero h1 .lr-rocket{display:inline-block;margin-right:6px;font-family:initial}
.lr-hero h1 .lr-grad{background:linear-gradient(90deg,#FF8FBE,#FFB088 50%,#FFD46B);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lr-hero-sub{color:var(--ink-2);font-size:15px;font-weight:500;margin:0 0 6px}
.lr-hero-meta{font-size:11px;color:var(--ink-3);font-weight:600;letter-spacing:.5px;margin-bottom:14px}
.lr-hero-meta .lr-dot{margin:0 6px;opacity:.4}

/* ───── LIVE STATUS BAR ───── */
.lr-status{display:flex;justify-content:center;align-items:center;gap:14px;padding:8px 14px;margin:0 18px 14px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);backdrop-filter:blur(10px);font-family:ui-monospace,monospace;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.5px}
.lr-status-item{display:flex;align-items:center;gap:5px}
.lr-status-item b{color:var(--ink);font-weight:800}
.lr-status-divider{width:1px;height:12px;background:var(--border)}
.lr-status .lr-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:lrPulse 1.5s ease-in-out infinite}
.lr-status .lr-live-dot.lr-warn{background:var(--peach);box-shadow:0 0 8px var(--peach)}

/* ───── TAB SWITCHER (Fresh / Recent) ───── */
.lr-tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 18px 14px;background:var(--glass);border:1px solid var(--border);border-radius:18px;padding:5px;position:relative;backdrop-filter:blur(10px)}
.lr-tab{padding:12px 0;text-align:center;font-family:inherit;font-weight:700;font-size:12px;letter-spacing:1px;color:var(--ink-2);border-radius:14px;cursor:pointer;transition:color .2s;position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:6px;background:none;border:none}
.lr-tab .lr-tab-emoji{font-size:14px}
.lr-tab-indicator{position:absolute;top:5px;bottom:5px;width:calc(50% - 5px);background:linear-gradient(135deg,#FF8FBE,#FFB088);border-radius:14px;transition:transform .4s cubic-bezier(.2,1.3,.4,1),background .3s;z-index:1;box-shadow:0 4px 14px rgba(255,143,190,.35)}
.lr-tabs.lr-tab-recent .lr-tab-indicator{transform:translateX(100%);background:linear-gradient(135deg,#7FFFD4,#A0E7FF);box-shadow:0 4px 14px rgba(127,255,212,.4)}
.lr-tab.lr-active{color:var(--ink)}
.lr-tab-count{font-family:ui-monospace,monospace;font-size:10px;background:rgba(255,255,255,.5);padding:2px 7px;border-radius:999px;font-weight:800;color:var(--ink);margin-left:3px}

/* ───── FILTERS ───── */
.lr-filters{display:flex;gap:6px;padding:0 18px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
.lr-filters::-webkit-scrollbar{display:none}
.lr-filter{flex-shrink:0;padding:8px 14px;border-radius:999px;background:var(--glass);border:1px solid var(--border);color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.4px;cursor:pointer;transition:all .15s;backdrop-filter:blur(10px)}
.lr-filter.lr-active{background:linear-gradient(135deg,#B794F6,#FF8FBE);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(183,148,246,.3)}
.lr-filter-divider{flex-shrink:0;width:1px;height:24px;background:var(--border);align-self:center;margin:0 4px}

/* ───── CARDS GRID ───── */
.lr-feed{display:flex;flex-direction:column;gap:10px;padding:0 18px;position:relative;z-index:2}
.lr-card{padding:14px;border-radius:24px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);position:relative;overflow:hidden;animation:lrPopIn .45s cubic-bezier(.2,.9,.2,1) backwards;transition:border-color .2s,box-shadow .2s}
.lr-card:hover{border-color:rgba(183,148,246,.4);box-shadow:0 8px 24px rgba(183,148,246,.12)}
.lr-card.lr-fresh{background:linear-gradient(135deg,rgba(255,176,136,.18),var(--glass) 60%)}
.lr-card.lr-busy{pointer-events:none}
.lr-card.lr-busy::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.4);border-radius:24px;backdrop-filter:blur(2px);z-index:5}

.lr-card-head{display:flex;align-items:center;gap:12px}
.lr-mini-avatar{width:44px;height:44px;border-radius:50%;padding:2px;flex-shrink:0;background:conic-gradient(from 0deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE)}
.lr-mini-avatar.lr-fresh-avatar{background:conic-gradient(from 0deg,#FFB088,#FFD46B,#FF8FBE,#FFB088)}
.lr-mini-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:20px;overflow:hidden;background:linear-gradient(135deg,#FFD9C9,#E8B8A0)}
.lr-mini-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}

.lr-card-info{flex:1;min-width:0}
.lr-card-sym-row{display:flex;align-items:center;gap:7px}
.lr-card-sym{font-family:"Instrument Serif",serif;font-size:22px;line-height:1}
.lr-card-name{font-size:11px;color:var(--ink-2);margin-top:2px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-age-pill{font-family:ui-monospace,monospace;font-size:10px;font-weight:800;letter-spacing:.5px;padding:3px 9px;border-radius:999px;background:rgba(255,176,136,.25);color:var(--peach);text-transform:uppercase}
.lr-age-pill.lr-very-fresh{background:linear-gradient(90deg,rgba(255,143,190,.3),rgba(255,176,136,.3));color:var(--ink);animation:lrPulse 1.8s ease-in-out infinite}

.lr-card-right{flex-shrink:0;text-align:right}
.lr-card-price{font-family:"Instrument Serif",serif;font-size:16px;line-height:1}
.lr-card-change{font-size:11px;font-weight:700;color:var(--green);margin-top:3px;font-family:ui-monospace,monospace}
.lr-card-change.lr-down{color:var(--red)}

.lr-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px;padding:10px 8px;border-radius:14px;background:var(--glass-strong);border:1px solid var(--border)}
.lr-metric{text-align:center;min-width:0}
.lr-metric-l{font-size:8px;color:var(--ink-2);letter-spacing:1.2px;text-transform:uppercase;font-weight:700}
.lr-metric-v{font-family:ui-monospace,monospace;font-weight:800;font-size:12px;margin-top:3px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lr-metric-v.lr-mint-text{color:var(--green)}

.lr-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.lr-badge{font-family:ui-monospace,monospace;font-size:9px;font-weight:800;letter-spacing:.8px;padding:4px 9px;border-radius:999px;text-transform:uppercase;display:inline-flex;align-items:center;gap:4px}
.lr-badge .lr-b-ico{font-family:initial;font-size:11px}
.lr-badge.lr-sig-fire{background:linear-gradient(90deg,rgba(255,143,190,.25),rgba(255,176,136,.25));color:#B8395E;border:1px solid rgba(255,143,190,.4)}
.lr-badge.lr-sig-vol{background:rgba(255,212,107,.25);color:#8B6B00;border:1px solid rgba(255,212,107,.5)}
.lr-badge.lr-sig-new{background:linear-gradient(90deg,rgba(127,255,212,.3),rgba(160,231,255,.3));color:#0F6E4D;border:1px solid rgba(127,255,212,.5)}
.lr-badge.lr-sig-holders{background:rgba(183,148,246,.25);color:#5A3C9E;border:1px solid rgba(183,148,246,.45)}
.lr-badge.lr-sig-rising{background:rgba(160,231,255,.3);color:#1E5C7A;border:1px solid rgba(160,231,255,.5)}
.lr-badge.lr-risk-good{background:rgba(127,255,212,.3);color:var(--green);border:1px solid rgba(127,255,212,.5)}
.lr-badge.lr-risk-warn{background:rgba(255,212,107,.3);color:#8B6B00;border:1px solid rgba(255,212,107,.5)}
.lr-badge.lr-risk-danger{background:rgba(209,75,106,.2);color:var(--red);border:1px solid rgba(209,75,106,.45)}

.lr-actions{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);display:flex;gap:6px}
.lr-action-label{font-size:9px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:var(--ink-2);margin-bottom:8px}
.lr-action-mode{margin-top:12px}
.lr-action-row{display:flex;gap:6px}
.lr-action-btn{flex:1;border:none;cursor:pointer;padding:11px 0;border-radius:14px;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.6px;transition:transform .12s cubic-bezier(.2,1.3,.4,1),box-shadow .2s}
.lr-action-btn:active{transform:scale(.96)}
.lr-action-btn:disabled{opacity:.55;cursor:not-allowed}
.lr-buy-btn{background:linear-gradient(135deg,#FFB088,#FFD46B);color:#fff;box-shadow:0 4px 12px rgba(255,176,136,.35)}
.lr-buy-btn:hover{box-shadow:0 6px 18px rgba(255,176,136,.45)}
.lr-sell-btn{background:linear-gradient(135deg,#FF8FBE,#B794F6);color:#fff;box-shadow:0 4px 12px rgba(255,143,190,.35)}
.lr-sell-btn:hover{box-shadow:0 6px 18px rgba(255,143,190,.45)}
.lr-owned-bar{display:flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:10px;color:var(--ink-2);margin-bottom:6px;font-weight:700}
.lr-owned-bar b{color:var(--green);font-weight:800}

.lr-card-spinner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,.55);backdrop-filter:blur(4px);border-radius:24px;z-index:10}
.lr-spinner-ring{width:32px;height:32px;border-radius:50%;border:3px solid rgba(183,148,246,.2);border-top-color:var(--lav);animation:lrSpin .9s linear infinite}
.lr-spinner-label{font-family:ui-monospace,monospace;font-size:10px;font-weight:800;letter-spacing:1.5px;color:var(--ink);text-transform:uppercase}

/* ───── EMPTY + LOADING ───── */
.lr-empty{text-align:center;padding:48px 24px;color:var(--ink-2);font-size:14px;font-weight:500}
.lr-empty .lr-empty-emoji{font-size:48px;margin-bottom:14px;display:block;opacity:.6}
.lr-empty b{color:var(--ink);font-weight:700}
.lr-empty-sub{font-size:12px;margin-top:6px;color:var(--ink-3);font-weight:500}

/* ───── TOAST ───── */
.lr-toasts{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.lr-toast{pointer-events:auto;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:18px;backdrop-filter:blur(20px);box-shadow:0 12px 32px rgba(26,27,78,.15);animation:lrSlideUp .35s cubic-bezier(.2,1.3,.4,1);font-size:13px;font-weight:600}
.lr-toast.lr-toast-leaving{animation:lrSlideDown .25s ease-in forwards}
.lr-toast-success{background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(127,255,212,.4));border:1px solid rgba(127,255,212,.5);color:var(--ink)}
.lr-toast-error{background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(255,143,190,.35));border:1px solid rgba(209,75,106,.4);color:var(--ink)}
.lr-toast-info{background:rgba(255,255,255,.92);border:1px solid var(--border);color:var(--ink)}
.lr-toast-emoji{font-size:22px;line-height:1;flex-shrink:0}
.lr-toast-body{flex:1;min-width:0;line-height:1.35}
.lr-toast-body b{font-weight:800}
.lr-toast-action{flex-shrink:0;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);padding:6px 11px;border-radius:9px;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.5px;cursor:pointer;text-decoration:none}

/* ───── REFERRER CHIP (shown when ?ref=… is active) ───── */
.lr-refchip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:linear-gradient(90deg,rgba(127,255,212,.25),rgba(160,231,255,.18));border:1px solid rgba(127,255,212,.4);font-size:10px;font-weight:700;color:var(--ink);letter-spacing:.2px;font-family:ui-monospace,monospace}

/* ───── DESKTOP ───── */
@media (min-width:1024px){
  .lr-phone{max-width:1100px;padding-bottom:80px}
  .lr-topbar{padding:14px 32px}
  .lr-hero{padding:48px 32px 12px;max-width:760px;margin:0 auto}
  .lr-hero h1{font-size:64px}
  .lr-hero-sub{font-size:17px}
  .lr-tabs{margin:0 32px 16px;max-width:540px;margin-left:auto;margin-right:auto}
  .lr-filters{padding:0 32px;max-width:1036px;margin-left:auto;margin-right:auto;justify-content:center;flex-wrap:wrap}
  .lr-status{max-width:540px;margin:0 auto 14px}
  .lr-feed{padding:0 32px;max-width:1036px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .lr-card{padding:18px}
  .lr-card-sym{font-size:24px}
  .lr-metrics{padding:12px 10px}
  .lr-metric-v{font-size:13px}
  .lr-orbs{padding:0 32px;max-width:760px;margin:0 auto 18px}
  .lr-feature{margin:0 32px 18px;max-width:760px;margin-left:auto;margin-right:auto;padding:24px 22px 20px}
  .lr-feature-sym{font-size:36px}
  .lr-feature-avatar{width:72px;height:72px}
  .lr-orb-val{font-size:22px}
  .lr-orb-val.lr-orb-mono{font-size:16px}
}
@media (min-width:1440px){
  .lr-phone{max-width:1320px}
  .lr-feed{max-width:1256px;grid-template-columns:repeat(3,1fr)}
}

/* ───── STAT ORBS (Wonderland signature) ───── */
.lr-orbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 18px;margin-bottom:16px;position:relative;z-index:2}
.lr-orb{position:relative;padding:12px 6px 11px;border-radius:20px;text-align:center;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);overflow:hidden;animation:lrRise .5s cubic-bezier(.2,.9,.2,1) backwards}
.lr-orb::before{content:'';position:absolute;inset:0;border-radius:20px;opacity:.35;pointer-events:none}
.lr-orb.lr-orb-1::before{background:radial-gradient(ellipse at top,#FFB088,transparent 70%)}
.lr-orb.lr-orb-2::before{background:radial-gradient(ellipse at top,#FF8FBE,transparent 70%)}
.lr-orb.lr-orb-3::before{background:radial-gradient(ellipse at top,#7FFFD4,transparent 70%)}
.lr-orb.lr-orb-4::before{background:radial-gradient(ellipse at top,#FFD46B,transparent 70%)}
.lr-orb-emoji{font-size:18px;margin-bottom:2px;display:block;position:relative;z-index:1;line-height:1}
.lr-orb-val{font-family:"Instrument Serif",serif;font-size:18px;line-height:1;position:relative;z-index:1;color:var(--ink)}
.lr-orb-val.lr-orb-mono{font-family:ui-monospace,monospace;font-weight:800;font-size:14px}
.lr-orb-lbl{font-size:8px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-2);font-weight:700;margin-top:3px;position:relative;z-index:1}

/* ───── FEATURED "JUST HATCHED" CARD ───── */
.lr-feature{position:relative;margin:0 18px 16px;padding:18px 16px 16px;border-radius:28px;background:linear-gradient(135deg,rgba(255,255,255,.85),rgba(255,176,136,.35) 60%,rgba(255,212,107,.3));border:1px solid rgba(255,176,136,.5);backdrop-filter:blur(14px);overflow:hidden;box-shadow:0 10px 36px rgba(255,176,136,.25);animation:lrPopIn .55s cubic-bezier(.2,1.3,.4,1) backwards;z-index:2}
.lr-feature::after{content:'';position:absolute;top:-60%;left:-40%;width:60%;height:300%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);transform:rotate(20deg);animation:lrShimmerSlide 9s ease-in-out infinite}
.lr-feature-badge{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:linear-gradient(90deg,#FFB088,#FFD46B);color:#fff;font-size:10px;font-weight:800;letter-spacing:1px;box-shadow:0 4px 10px rgba(255,176,136,.45);z-index:3}
.lr-feature-badge .lr-egg{display:inline-block;animation:lrPulseScale 1.6s ease-in-out infinite;font-size:14px}
.lr-feature-head{display:flex;align-items:center;gap:14px;margin-bottom:14px;position:relative;z-index:2}
.lr-feature-avatar{width:60px;height:60px;border-radius:50%;padding:3px;flex-shrink:0;background:conic-gradient(from 0deg,#FFB088,#FFD46B,#FF8FBE,#FFB088);box-shadow:0 8px 20px rgba(255,176,136,.4)}
.lr-feature-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:26px;background:linear-gradient(135deg,#FFEFE0,#FFD9C9);overflow:hidden}
.lr-feature-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-feature-name{flex:1;min-width:0}
.lr-feature-sym{font-family:"Instrument Serif",serif;font-size:30px;line-height:1;font-style:italic}
.lr-feature-sub{font-size:11px;color:var(--ink-2);font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-feature-age{font-family:ui-monospace,monospace;font-size:11px;font-weight:800;color:var(--ink);background:rgba(255,255,255,.7);padding:4px 10px;border-radius:999px;margin-top:5px;display:inline-block;letter-spacing:.5px}
.lr-feature-actions{display:flex;gap:7px;position:relative;z-index:2}
.lr-feature-btn{flex:1;border:none;cursor:pointer;padding:13px 0;border-radius:16px;font-family:inherit;font-weight:800;font-size:13px;letter-spacing:.5px;color:#fff;background:linear-gradient(135deg,#FFB088,#FFD46B);box-shadow:0 6px 16px rgba(255,176,136,.45);transition:transform .12s cubic-bezier(.2,1.3,.4,1)}
.lr-feature-btn:active{transform:scale(.96)}
.lr-feature-btn:disabled{opacity:.55;cursor:not-allowed}
.lr-feature-btn.lr-feature-skip{background:rgba(255,255,255,.75);color:var(--ink);box-shadow:none;border:1px solid var(--border);flex:0 0 auto;padding:0 16px;font-size:11px}

/* ───── CARD TINT VARIANTS (rotate through palette) ───── */
.lr-card.lr-tint-0{background:linear-gradient(135deg,rgba(255,143,190,.18),var(--glass) 60%)}
.lr-card.lr-tint-1{background:linear-gradient(135deg,rgba(127,255,212,.18),var(--glass) 60%)}
.lr-card.lr-tint-2{background:linear-gradient(135deg,rgba(183,148,246,.18),var(--glass) 60%)}
.lr-card.lr-tint-3{background:linear-gradient(135deg,rgba(160,231,255,.18),var(--glass) 60%)}
.lr-card.lr-tint-4{background:linear-gradient(135deg,rgba(255,212,107,.18),var(--glass) 60%)}
.lr-card.lr-fresh{background:linear-gradient(135deg,rgba(255,176,136,.22),var(--glass) 60%) !important}

/* ───── CONFETTI BURST (on successful buy) ───── */
.lr-confetti{position:fixed;inset:0;pointer-events:none;z-index:200;overflow:hidden}
.lr-confetti-piece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:lrConfetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}
@keyframes lrConfetti{
  0%{transform:translate(-50%,-50%) rotate(0);opacity:1}
  100%{transform:translate(calc(-50% + var(--dx,0px)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}
}

/* ───── PLAYFUL HERO FLOURISH ───── */
.lr-hero h1 .lr-italic{font-style:italic;font-weight:400}
.lr-hero h1 .lr-sparkle{display:inline-block;font-family:initial;animation:lrPulse 1.8s ease-in-out infinite}

/* ───── small phones ───── */
@media (max-width:430px){
  .lr-hero{padding:24px 14px 8px}
  .lr-hero h1{font-size:36px}
  .lr-status{margin:0 14px 12px;padding:7px 12px;font-size:10px;gap:10px}
  .lr-tabs{margin:0 14px 12px}
  .lr-filters{padding:0 14px}
  .lr-feed{padding:0 14px}
  .lr-orbs{padding:0 14px;gap:6px}
  .lr-orb{padding:10px 4px 9px}
  .lr-orb-emoji{font-size:16px}
  .lr-orb-val{font-size:16px}
  .lr-orb-val.lr-orb-mono{font-size:13px}
  .lr-feature{margin:0 14px 14px;padding:16px 14px 14px}
  .lr-feature-sym{font-size:26px}
  .lr-feature-avatar{width:54px;height:54px}
}
`;

function useLrCSS() {
  useEffect(() => {
    const id = 'nexus-lr-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = LR_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ════════════════════════════════════════════════════════════════════
   CONFIG — same constants as Wonderland
   ════════════════════════════════════════════════════════════════════ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;  // 3% total fee
const REF_BPS    = 100;  // 1% to referrer (3% - 1% = 2% to platform when referred)
const SLIPPAGE_BPS = 1500; // 15% — memecoins move
const PRIORITY_FEE_MICROLAMPORTS = 100_000;

const RPC_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOLANA_RPC) ||
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const POLL_RECENT  = 8_000;   // poll Jupiter recent every 8s
const POLL_SOL     = 30_000;
const POLL_BALANCE = 12_000;  // user balance refresh
const PUMP_WSS_URL = 'wss://pumpportal.fun/api/data';
const DEXSCREENER_TOKEN_URL = (mint) => `https://api.dexscreener.com/latest/dex/tokens/${mint}`;

const BUY_PRESETS  = [0.25, 0.5, 1, 2];
const SELL_PRESETS = [25, 50, 100];

/* ════════════════════════════════════════════════════════════════════
   HELPERS — copied from Wonderland to keep parity
   ════════════════════════════════════════════════════════════════════ */
const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥','🦊','🐻'];
function emojiFor(sym = '') {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length];
}

function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1)   return n.toFixed(2);
  return n.toPrecision(3);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '$0';
  if (p >= 1)      return '$' + p.toFixed(4);
  if (p >= 0.01)   return '$' + p.toFixed(5);
  if (p >= 0.0001) return '$' + p.toFixed(6);
  return '$' + p.toExponential(2);
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function ageMs(iso) { return iso ? Date.now() - new Date(iso).getTime() : Infinity; }
function ageStr(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = ms / 60_000;
  if (m < 1)  return Math.max(1, Math.round(ms / 1000)) + 's';
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  const h = m / 60;
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}
function timeAgo(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function signalScore(t) {
  if (!t) return 0;
  const change = Math.min(Math.max(t.change || 0, -100), 500);
  const changePts = Math.min(35, Math.max(0, (change / 200) * 35));
  const volPts = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1)) * 3.5);
  const liqPts = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1)) * 3);
  const holdPts = Math.min(15, Math.log10(Math.max(t.holders || 1, 1)) * 2.5);
  const freshPts = (Number.isFinite(t.ageMs) && t.ageMs < 3600_000) ? 5 : 0;
  return Math.round(Math.min(100, changePts + volPts + liqPts + holdPts + freshPts));
}

function normalize(t) {
  const change = Number(t?.stats24h?.priceChange ?? t?.priceChange24h ?? t?.priceChange ?? 0);
  const created = t.firstPool?.createdAt || t.createdAt || t.pairCreatedAt;
  const am = ageMs(created);
  return {
    mint:      t.id || t.address || t.mint,
    sym:       t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    emoji:     emojiFor(t.symbol || ''),
    icon:      t.icon || t.logoURI || t.image || null,
    price:     Number(t.usdPrice ?? t.priceUsd ?? 0),
    change,
    age:       ageStr(am),
    ageMs:     am,
    mcap:      Number(t.mcap ?? t.fdv ?? t.marketCap ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0) || Number(t.volume24h ?? 0),
    holders:   Number(t.holderCount ?? t.holders ?? 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    source:    t.source || 'jupiter',
  };
}

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance.';
  if (m.includes('slippage'))          return 'Price moved — try again.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Tx expired. Retry.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('cancelled')) return 'Cancelled.';
  if (m.includes('simulation failed')) return 'Simulation failed — price moved.';
  if (m.includes('account not'))       return 'Token account not ready.';
  if (m.includes('rate'))              return 'Rate limited.';
  if (m.includes('no route') || m.includes('could not find any route')) return 'No route yet — too fresh.';
  if (m.includes('too large'))         return 'Route too complex. Try smaller.';
  return err?.message?.slice(0, 80) || 'Swap failed.';
};

/* ════════════════════════════════════════════════════════════════════
   SIGNAL / RISK BADGE DERIVATION
   ════════════════════════════════════════════════════════════════════ */
function deriveSignalBadges(t) {
  const out = [];
  if (Number.isFinite(t.ageMs) && t.ageMs < 3600_000) out.push({ k: 'new',     emoji: '🚀', label: 'New Launch', cls: 'lr-sig-new' });
  if ((t.change || 0) > 50)                          out.push({ k: 'fire',    emoji: '🔥', label: 'Breaking Out', cls: 'lr-sig-fire' });
  if (t.mcap > 0 && (t.volume24h / t.mcap) > 0.3)    out.push({ k: 'vol',     emoji: '⚡', label: 'Volume Spike', cls: 'lr-sig-vol' });
  if ((t.change || 0) > 0 && (t.change || 0) <= 50 && (t.volume24h || 0) > 50_000) out.push({ k: 'rising', emoji: '📈', label: 'Rising', cls: 'lr-sig-rising' });
  if ((t.holders || 0) > 500)                        out.push({ k: 'holders', emoji: '💎', label: 'Strong Holders', cls: 'lr-sig-holders' });
  return out.slice(0, 3);
}

function deriveRiskBadge(t) {
  const liq = t.liquidity || 0;
  if (liq < 5_000)  return { emoji: '🔴', label: 'Thin Liquidity',   cls: 'lr-risk-danger' };
  if (liq < 30_000) return { emoji: '🟡', label: 'Early Liquidity',  cls: 'lr-risk-warn' };
  return                    { emoji: '🟢', label: 'Healthy Liquidity', cls: 'lr-risk-good' };
}

/* ════════════════════════════════════════════════════════════════════
   TOKEN ICON
   ════════════════════════════════════════════════════════════════════ */
function TokenIcon({ token }) {
  const [errored, setErrored] = useState(false);
  if (!token?.icon || errored) return <span>{token?.emoji || '🪙'}</span>;
  return <img src={token.icon} alt={token.sym || ''} onError={() => setErrored(true)} />;
}

/* ════════════════════════════════════════════════════════════════════
   PUMP.FUN WSS + DEXSCREENER ENRICHMENT (isolated lane — no backend)
   ════════════════════════════════════════════════════════════════════ */
function usePumpFunStream(enabled) {
  const [tokens, setTokens] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pendingEnrich = useRef(new Set());

  // DexScreener enrichment, queued + soft-rate-limited
  const enrich = useCallback(async (mint) => {
    if (pendingEnrich.current.has(mint)) return;
    pendingEnrich.current.add(mint);
    try {
      const r = await fetch(DEXSCREENER_TOKEN_URL(mint));
      if (!r.ok) return;
      const d = await r.json();
      // CRITICAL: DexScreener's /tokens/{addr} returns pairs where the addr can be
      // either base or quote. priceUsd / priceChange always refer to baseToken.
      // We must ONLY use pairs where baseToken.address === mint — otherwise we'd
      // attribute another token's price (e.g. SOL's) to our token.
      const pair = (d?.pairs || [])
        .filter(p => p.chainId === 'solana' && p.baseToken?.address === mint)
        .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
      if (!pair) return;
      // Belt-and-suspenders: make sure decimals from chain match what we cached,
      // and that the address is really ours after JSON round-trip.
      if (pair.baseToken.address !== mint) return;
      const enriched = {
        price:     Number(pair.priceUsd || 0),
        change:    Number(pair.priceChange?.h24 || 0),
        change1h:  Number(pair.priceChange?.h1 || 0),
        volume24h: Number(pair.volume?.h24 || 0),
        liquidity: Number(pair.liquidity?.usd || 0),
        mcap:      Number(pair.marketCap || pair.fdv || 0),
        enriched:  true,
      };
      setTokens(prev => prev.map(t => t.mint === mint ? { ...t, ...enriched } : t));
    } catch {} finally {
      pendingEnrich.current.delete(mint);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    function connect() {
      if (!alive) return;
      let ws;
      try { ws = new WebSocket(PUMP_WSS_URL); }
      catch { return scheduleReconnect(); }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { try { ws.close(); } catch {} return; }
        reconnectAttempts = 0;
        setConnected(true);
        try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); } catch {}
      };

      ws.onmessage = (evt) => {
        if (!alive) return;
        let msg = null;
        try { msg = JSON.parse(evt.data); } catch { return; }
        if (!msg || msg.txType !== 'create' || !msg.mint) return;

        const tok = {
          mint:       msg.mint,
          sym:        msg.symbol || '???',
          name:       msg.name || msg.symbol || 'Unknown',
          emoji:      emojiFor(msg.symbol || ''),
          icon:       null, // metadata URI fetch is too slow inline; emoji fallback is fine
          decimals:   6, // pump.fun mints are 6 decimals
          price:      0,
          change:     0,
          mcap:       0,                                       // USD — filled by DexScreener enrichment when token graduates
          mcapSol:    Number(msg.marketCapSol || 0),           // pre-grad cap in SOL
          volume24h:  0,
          holders:    0,
          liquidity:  0,                                       // USD — filled by DexScreener enrichment
          liquiditySol: Number(msg.vSolInBondingCurve || 0),   // pre-grad bonding-curve liquidity in SOL
          createdAt:  Date.now(),
          ageMs:      0,
          age:        '0s',
          source:     'pumpfun',
          enriched:   false,
          preGrad:    true,
        };

        setTokens(prev => {
          if (prev.some(t => t.mint === tok.mint)) return prev;
          return [tok, ...prev].slice(0, 60);
        });
        // queue enrichment after a tiny delay so we don't hammer DexScreener
        setTimeout(() => { if (alive) enrich(msg.mint); }, 800);
      };

      ws.onerror = () => { /* swallow — onclose handles reconnect */ };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (alive) scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (!alive) return;
      reconnectAttempts = Math.min(reconnectAttempts + 1, 6);
      const wait = Math.min(30_000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectTimer = setTimeout(connect, wait);
    }

    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, [enabled, enrich]);

  // Re-enrich tokens still missing DexScreener data, and tick age strings.
  // Retry window: 90s after creation up to 5 min. Past 5 min without enrichment,
  // assume the token won't appear on DexScreener (most pump.fun launches never
  // graduate to Raydium) and stop trying — avoids saturating the 300/min limit.
  useEffect(() => {
    const id = setInterval(() => {
      let snapshot = [];
      setTokens(prev => {
        snapshot = prev;
        return prev.map(t => ({ ...t, ageMs: Date.now() - t.createdAt, age: ageStr(Date.now() - t.createdAt) }));
      });
      for (const t of snapshot) {
        if (t.enriched) continue;
        const age = Date.now() - t.createdAt;
        if (age > 90_000 && age < 5 * 60_000) enrich(t.mint);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [enrich]);

  return { tokens, connected };
}

/* ════════════════════════════════════════════════════════════════════
   LAUNCH CARD
   ════════════════════════════════════════════════════════════════════ */
function LaunchCard({ token, owned, busy, onBuy, onSell, isFresh, tintIndex = 0 }) {
  const signals = useMemo(() => deriveSignalBadges(token), [token]);
  const risk    = useMemo(() => deriveRiskBadge(token), [token]);
  const ownedBalance = owned?.uiAmount || 0;
  const ownedUsd = ownedBalance * (token.price || 0);
  const veryFresh = isFresh && Number.isFinite(token.ageMs) && token.ageMs < 5 * 60_000;
  const tintClass = isFresh ? ' lr-fresh' : ' lr-tint-' + tintIndex;

  return (
    <div className={'lr-card' + tintClass + (busy ? ' lr-busy' : '')} style={{ animationDelay: (tintIndex * 0.04) + 's' }}>
      {busy && (
        <div className="lr-card-spinner">
          <div className="lr-spinner-ring" />
          <div className="lr-spinner-label">{busy}</div>
        </div>
      )}

      <div className="lr-card-head">
        <div className={'lr-mini-avatar' + (isFresh ? ' lr-fresh-avatar' : '')}>
          <div className="lr-inner"><TokenIcon token={token} /></div>
        </div>
        <div className="lr-card-info">
          <div className="lr-card-sym-row">
            <span className="lr-card-sym">${token.sym}</span>
            <span className={'lr-age-pill' + (veryFresh ? ' lr-very-fresh' : '')}>
              {token.age || (token.preGrad ? 'pre-grad' : 'new')}
            </span>
          </div>
          <div className="lr-card-name">{token.name}</div>
        </div>
        <div className="lr-card-right">
          <div className="lr-card-price">{token.price > 0 ? formatPrice(token.price) : (token.preGrad ? 'bonding' : '—')}</div>
          {Number.isFinite(token.change) && token.change !== 0 ? (
            <div className={'lr-card-change' + (token.change < 0 ? ' lr-down' : '')}>{formatPct(token.change)}</div>
          ) : null}
        </div>
      </div>

      <div className="lr-metrics">
        <div className="lr-metric">
          <div className="lr-metric-l">Liq</div>
          <div className="lr-metric-v">{token.liquidity > 0 ? '$' + format(token.liquidity) : (token.liquiditySol ? format(token.liquiditySol) + ' SOL' : '—')}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">Vol 24h</div>
          <div className="lr-metric-v">{token.volume24h > 0 ? '$' + format(token.volume24h) : '—'}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">Holders</div>
          <div className="lr-metric-v">{token.holders > 0 ? format(token.holders) : '—'}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">Signal</div>
          <div className="lr-metric-v lr-mint-text">{signalScore(token)}</div>
        </div>
      </div>

      {(signals.length > 0 || risk) && (
        <div className="lr-badges">
          {signals.map(s => (
            <span key={s.k} className={'lr-badge ' + s.cls}>
              <span className="lr-b-ico">{s.emoji}</span>{s.label}
            </span>
          ))}
          <span className={'lr-badge ' + risk.cls}>
            <span className="lr-b-ico">{risk.emoji}</span>{risk.label}
          </span>
        </div>
      )}

      <div className="lr-action-mode">
        {ownedBalance > 0 ? (
          <>
            <div className="lr-owned-bar">
              <span>YOU OWN</span>
              <b>{format(ownedBalance)} ${token.sym}</b>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>≈ ${format(ownedUsd)}</span>
            </div>
            <div className="lr-action-row">
              {SELL_PRESETS.map(pct => (
                <button
                  key={pct}
                  type="button"
                  className="lr-action-btn lr-sell-btn"
                  disabled={!!busy}
                  onClick={() => onSell(token, pct)}
                >
                  SELL {pct}%
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="lr-action-label">🍭 APE IN</div>
            <div className="lr-action-row">
              {BUY_PRESETS.map(sol => (
                <button
                  key={sol}
                  type="button"
                  className="lr-action-btn lr-buy-btn"
                  disabled={!!busy}
                  onClick={() => onBuy(token, sol)}
                >
                  {sol} SOL
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════ */
export default function LaunchRadar({ onConnectWallet } = {}) {
  useLrCSS();
  const wallet = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  /* ──── referrer (same shape as Wonderland) ──── */
  const [referrer] = useState(() => {
    if (typeof window === 'undefined') return null;
    const tryParse = (v) => { try { return new PublicKey(v); } catch { return null; } };
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('ref');
      if (fromUrl) {
        const pk = tryParse(fromUrl);
        if (pk) { try { localStorage.setItem('lr_referrer', fromUrl); } catch {} return pk; }
      }
    } catch {}
    try { const s = localStorage.getItem('lr_referrer') || localStorage.getItem('mw_referrer'); if (s) return tryParse(s); } catch {}
    return null;
  });
  const effectiveReferrer = useMemo(() => {
    if (!referrer) return null;
    if (wallet.publicKey && referrer.equals(wallet.publicKey)) return null;
    if (referrer.equals(FEE_WALLET)) return null;
    return referrer;
  }, [referrer, wallet.publicKey]);

  /* ──── tabs + filters ──── */
  const [lane, setLane] = useState('fresh'); // 'fresh' | 'recent'
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | '1h' | '6h' | '24h'
  const [sortBy, setSortBy]         = useState('newest'); // 'newest' | 'volume' | 'signal'

  /* ──── fresh lane (pump.fun + dexscreener) ──── */
  const { tokens: pumpTokens, connected: pumpConnected } = usePumpFunStream(true);

  /* ──── recent lane (Jupiter) ──── */
  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/jupiter/tokens/v2/recent?limit=60');
        if (!r.ok) { setRecentLoading(false); return; }
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setRecentTokens(list.map(normalize).filter(t => t.mint));
          setRecentLoading(false);
        }
      } catch { if (!cancelled) setRecentLoading(false); }
    }
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ──── SOL price (not strictly required, but useful for USD displays) ──── */
  const [solPrice, setSolPrice] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try { const r = await fetch('/api/sol-price'); const d = await r.json(); if (!cancelled && d?.price) setSolPrice(d.price); } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ──── user balances — for owned-token detection ──── */
  const [balances, setBalances] = useState({});
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); return; }
    try {
      const owner = wallet.publicKey;
      const [solBal, tAccs] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      ]);
      let t22 = { value: [] };
      try { t22 = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }); } catch {}
      const out = {};
      out[SOL_MINT] = { amount: String(solBal), decimals: 9, uiAmount: solBal / 1e9 };
      const merge = (a) => {
        for (const acc of a.value) {
          const info = acc.account.data.parsed?.info; if (!info) continue;
          const mint = info.mint; if (!mint) continue;
          out[mint] = {
            amount:   String(info.tokenAmount?.amount || '0'),   // keep raw as string — token supplies can exceed Number.MAX_SAFE_INTEGER
            decimals: Number(info.tokenAmount?.decimals ?? 6),
            uiAmount: Number(info.tokenAmount?.uiAmount || 0),
          };
        }
      };
      merge(tAccs); merge(t22);
      setBalances(out);
    } catch (e) { /* swallow */ }
  }, [wallet.publicKey, connection]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);
  useEffect(() => {
    if (!wallet.publicKey) return;
    const id = setInterval(refreshBalances, POLL_BALANCE);
    return () => clearInterval(id);
  }, [wallet.publicKey, refreshBalances]);

  /* ──── toasts ──── */
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration || 6000);
  }, []);

  /* ──── confetti burst on successful buy (must be declared before handleBuy) ──── */
  const [confettiKey, setConfettiKey] = useState(0);
  const fireConfetti = useCallback(() => setConfettiKey(k => k + 1), []);
  const confettiPieces = useMemo(() => {
    if (!confettiKey) return [];
    const colors = ['#FF8FBE', '#7FFFD4', '#B794F6', '#FFB088', '#FFD46B', '#A0E7FF'];
    return Array.from({ length: 60 }, (_, i) => {
      const angle = (Math.random() - 0.5) * Math.PI;
      const dist = 220 + Math.random() * 200;
      const dx = Math.sin(angle) * dist;
      const dy = -Math.abs(Math.cos(angle) * dist) + 420 * Math.random();
      const dr = (Math.random() - 0.5) * 1440;
      const color = colors[i % colors.length];
      const delay = Math.random() * 0.15;
      return { i, dx, dy, dr, color, delay };
    });
  }, [confettiKey]);
  useEffect(() => {
    if (!confettiKey) return;
    const id = setTimeout(() => setConfettiKey(0), 1800);
    return () => clearTimeout(id);
  }, [confettiKey]);

  /* ──── busy state per-token ──── */
  const [busy, setBusy] = useState({}); // { [mint]: 'Buying…' | 'Selling…' }

  /* ──── the swap — same atomic-fee pattern as Wonderland ──── */
  const executeSwap = useCallback(async ({ token, mode, rawAmount, balanceDecimals }) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      onConnectWallet?.(); throw new Error('connect_wallet');
    }
    const isSell = mode === 'sell';
    const inputMint  = isSell ? token.mint : SOL_MINT;
    const outputMint = isSell ? SOL_MINT  : token.mint;
    // For sells: prefer the decimals from the user's on-chain token account (always correct)
    // over the token-list value which can be missing on very-recent launches.
    const inputDecimals  = isSell ? (balanceDecimals ?? token.decimals ?? 6) : 9;
    const outputDecimals = isSell ? 9 : (token.decimals ?? 6);

    // 1. ask Jupiter for the build (net of our 3% fee)
    const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
    if (net <= 0n) throw new Error('Amount too small');
    const params = new URLSearchParams({
      inputMint, outputMint,
      amount: net.toString(),
      slippageBps: String(SLIPPAGE_BPS),
      taker: wallet.publicKey.toBase58(),
      computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
    });
    const buildRes = await fetch(`/api/jupiter/build?${params}`);
    if (!buildRes.ok) {
      const j = await buildRes.json().catch(() => ({}));
      throw new Error(j.error || `Build failed (${buildRes.status})`);
    }
    const build = await buildRes.json();
    if (!build?.swapInstruction) throw new Error('No route');

    // 2. build atomic fee transfers — split between platform (2-3%) and referrer (1% if present)
    const totalFee     = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
    const refFee       = effectiveReferrer ? (BigInt(rawAmount) * BigInt(REF_BPS)) / 10000n : 0n;
    const platformFee  = totalFee - refFee;

    const feeIxs = [];
    if (inputMint === SOL_MINT) {
      if (platformFee > 0n) feeIxs.push(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: FEE_WALLET, lamports: Number(platformFee) }));
      if (refFee > 0n && effectiveReferrer) feeIxs.push(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: effectiveReferrer, lamports: Number(refFee) }));
    } else {
      const mintPk = new PublicKey(inputMint);
      const mintInfo = await connection.getAccountInfo(mintPk);
      if (!mintInfo) throw new Error('Mint not found');
      const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const src = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
      if (platformFee > 0n) {
        const ata = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, tokenProgram);
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, FEE_WALLET, mintPk, tokenProgram));
        feeIxs.push(createTransferCheckedInstruction(src, mintPk, ata, wallet.publicKey, platformFee, inputDecimals, [], tokenProgram));
      }
      if (refFee > 0n && effectiveReferrer) {
        const ata = getAssociatedTokenAddressSync(mintPk, effectiveReferrer, true, tokenProgram);
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, effectiveReferrer, mintPk, tokenProgram));
        feeIxs.push(createTransferCheckedInstruction(src, mintPk, ata, wallet.publicKey, refFee, inputDecimals, [], tokenProgram));
      }
    }

    // 3. compose all ixs: compute budget → fees → setup → swap → cleanup → other
    const ixs = [];
    if (Array.isArray(build.computeBudgetInstructions)) for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));
    for (const ix of feeIxs) ixs.push(ix);
    if (Array.isArray(build.setupInstructions)) for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
    if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
    if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
    if (Array.isArray(build.otherInstructions)) for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

    // 4. address lookup tables
    const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
    let alts = [];
    if (altKeys.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
      alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
        key: new PublicKey(k),
        state: AddressLookupTableAccount.deserialize(infos[i].data),
      }) : null).filter(Boolean);
    }

    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions: ixs,
    }).compileToV0Message(alts);
    const tx = new VersionedTransaction(message);

    // soft simulate (non-fatal on RPC errors)
    try {
      const sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
      if (sim.value.err) {
        const logs = (sim.value.logs || []).join('\n').toLowerCase();
        if (logs.includes('insufficient') || logs.includes('0x1')) throw new Error('Insufficient balance');
        if (logs.includes('slippage') || logs.includes('0x1771')) throw new Error('Price moved — try again');
        throw new Error('Simulation failed');
      }
    } catch (e) {
      if (/insufficient|slippage|simulation failed/i.test(String(e.message))) throw e;
    }

    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });

    // confirm with timeout + fallback polling
    let confirmed = false;
    try {
      const conf = await Promise.race([
        connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
      ]);
      if (conf?.value?.err) throw new Error('Tx failed on-chain');
      confirmed = true;
    } catch {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          const cs = st?.value?.confirmationStatus;
          if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
          if (st?.value?.err) throw new Error('Tx failed on-chain');
        } catch (e) { if (/failed on-chain/i.test(String(e.message))) throw e; }
      }
    }

    const outAmount = Number(build.outAmount) / Math.pow(10, outputDecimals);
    return { sig, confirmed, outAmount };
  }, [wallet, connection, effectiveReferrer, onConnectWallet]);

  /* ──── quick buy ──── */
  const handleBuy = useCallback(async (token, solAmount) => {
    if (!wallet.publicKey) { onConnectWallet?.(); return; }
    if (busy[token.mint]) return;
    setBusy(b => ({ ...b, [token.mint]: 'Buying…' }));
    try {
      const rawAmount = BigInt(Math.floor(solAmount * 1e9)).toString();
      const { sig, confirmed, outAmount } = await executeSwap({ token, mode: 'buy', rawAmount });
      if (confirmed) fireConfetti();
      pushToast({
        kind: 'success',
        emoji: confirmed ? '🎉' : '⏳',
        body: <><b>Bought ${token.sym}</b><br/>{solAmount} SOL → {format(outAmount)} {token.sym}</>,
        link: `https://solscan.io/tx/${sig}`,
      });
      setTimeout(refreshBalances, 2500);
    } catch (e) {
      if (e.message !== 'connect_wallet') {
        pushToast({ kind: 'error', emoji: '⚠️', body: friendlyError(e) });
      }
    } finally {
      setBusy(b => { const c = { ...b }; delete c[token.mint]; return c; });
    }
  }, [wallet.publicKey, busy, executeSwap, pushToast, refreshBalances, onConnectWallet, fireConfetti]);
  const handleSell = useCallback(async (token, percentage) => {
    if (!wallet.publicKey) { onConnectWallet?.(); return; }
    if (busy[token.mint]) return;
    const bal = balances[token.mint];
    if (!bal || !bal.amount || BigInt(bal.amount) <= 0n) {
      pushToast({ kind: 'error', emoji: '⚠️', body: `No ${token.sym} to sell` });
      return;
    }
    setBusy(b => ({ ...b, [token.mint]: 'Selling…' }));
    try {
      const rawAmount = ((BigInt(bal.amount) * BigInt(percentage)) / 100n).toString();
      const { sig, confirmed, outAmount } = await executeSwap({ token, mode: 'sell', rawAmount, balanceDecimals: bal.decimals });
      pushToast({
        kind: 'success',
        emoji: confirmed ? '💸' : '⏳',
        body: <><b>Sold {percentage}% of ${token.sym}</b><br/>Got {format(outAmount)} SOL</>,
        link: `https://solscan.io/tx/${sig}`,
      });
      setTimeout(refreshBalances, 2500);
    } catch (e) {
      if (e.message !== 'connect_wallet') {
        pushToast({ kind: 'error', emoji: '⚠️', body: friendlyError(e) });
      }
    } finally {
      setBusy(b => { const c = { ...b }; delete c[token.mint]; return c; });
    }
  }, [wallet.publicKey, busy, balances, executeSwap, pushToast, refreshBalances, onConnectWallet]);

  /* ──── lane-aware list + filters + sort ──── */
  const activeList = lane === 'fresh' ? pumpTokens : recentTokens;
  const filtered = useMemo(() => {
    let l = activeList;
    if (timeFilter !== 'all') {
      const cap = timeFilter === '1h' ? 3600_000 : timeFilter === '6h' ? 6*3600_000 : 24*3600_000;
      l = l.filter(t => Number.isFinite(t.ageMs) && t.ageMs < cap);
    }
    if (sortBy === 'newest')      l = [...l].sort((a, b) => (a.ageMs || 0) - (b.ageMs || 0));
    else if (sortBy === 'volume') l = [...l].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    else if (sortBy === 'signal') l = [...l].sort((a, b) => signalScore(b) - signalScore(a));
    return l.slice(0, 30);
  }, [activeList, timeFilter, sortBy]);

  /* ──── derived stats for orbs + featured ──── */
  const featured = useMemo(() => {
    // freshest pump.fun launch under 30 min — the "just hatched" hero
    const pool = pumpTokens.filter(t => Number.isFinite(t.ageMs) && t.ageMs < 30 * 60_000);
    return pool.length ? pool[0] : null;
  }, [pumpTokens]);
  const topGainer = useMemo(() => {
    const pool = [...pumpTokens, ...recentTokens].filter(t => Number.isFinite(t.change) && t.change > 0);
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.change > a.change ? b : a));
  }, [pumpTokens, recentTokens]);
  const totalVol24h = useMemo(() => {
    return [...pumpTokens, ...recentTokens].reduce((s, t) => s + (t.volume24h || 0), 0);
  }, [pumpTokens, recentTokens]);

  /* ──── render ──── */
  return (
    <div className="lr-root">
      <div className="lr-blob" style={{ width: 400, height: 400, background: '#FFB088', top: -80, left: -120 }} />
      <div className="lr-blob" style={{ width: 500, height: 500, background: '#FF8FBE', top: '30%', right: -180, animationDelay: '3s' }} />
      <div className="lr-blob" style={{ width: 340, height: 340, background: '#FFD46B', bottom: '10%', left: -100, animationDelay: '6s' }} />

      <div className="lr-phone">
        {/* TOPBAR */}
        <div className="lr-topbar">
          <div className="lr-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="lr-brand-dot" />
            <span className="lr-brand-text">
              wonderland<span className="lr-slash">//</span>
              <span style={{ background: 'linear-gradient(90deg,#FFB088,#FFD46B,#FF8FBE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>radar</span>
            </span>
          </div>
          <div className="lr-topbar-right">
            {effectiveReferrer && (
              <span className="lr-refchip" title={'Referred by ' + effectiveReferrer.toBase58()}>
                🎁 {effectiveReferrer.toBase58().slice(0,4)}…{effectiveReferrer.toBase58().slice(-4)}
              </span>
            )}
            <button
              type="button"
              className={'lr-wallet-btn' + (wallet.publicKey ? ' lr-connected' : '')}
              onClick={() => {
                if (wallet.publicKey && wallet.disconnect) wallet.disconnect();
                else if (onConnectWallet) onConnectWallet();
                else if (wallet.connect) wallet.connect().catch(() => {});
              }}
            >
              {wallet.publicKey
                ? <><span className="lr-wallet-dot" />{wallet.publicKey.toBase58().slice(0,4)}…{wallet.publicKey.toBase58().slice(-4)}</>
                : 'Connect Wallet'}
            </button>
          </div>
        </div>

        {/* HERO */}
        <div className="lr-hero">
          <div className="lr-hero-eyebrow">
            <div className="lr-radar-pulse" />
            JUST LANDED · ON SOLANA
          </div>
          <h1>
            <span className="lr-italic">what just</span>{' '}
            <span className="lr-grad">dropped</span>
            <span className="lr-sparkle"> ✨</span>
          </h1>
          <p className="lr-hero-sub">Catch fresh Solana launches while they're still warm.</p>
          <div className="lr-hero-meta">
            No KYC<span className="lr-dot">•</span>No Accounts<span className="lr-dot">•</span>One-Click Buy
          </div>
        </div>

        {/* STATUS */}
        <div className="lr-status">
          <div className="lr-status-item">
            <span className={'lr-live-dot' + (lane === 'fresh' && !pumpConnected ? ' lr-warn' : '')} />
            {lane === 'fresh'
              ? (pumpConnected ? <>LIVE · <b>{pumpTokens.length}</b> tracked</> : <>RECONNECTING…</>)
              : (recentLoading ? <>SYNCING…</> : <><b>{recentTokens.length}</b> tokens</>)}
          </div>
          <div className="lr-status-divider" />
          <div className="lr-status-item">
            SOL <b>${solPrice > 0 ? solPrice.toFixed(2) : '—'}</b>
          </div>
        </div>

        {/* STAT ORBS */}
        <div className="lr-orbs">
          <div className="lr-orb lr-orb-1" style={{ animationDelay: '0s' }}>
            <span className="lr-orb-emoji">🥚</span>
            <div className="lr-orb-val">{pumpTokens.length}</div>
            <div className="lr-orb-lbl">Just Hatched</div>
          </div>
          <div className="lr-orb lr-orb-2" style={{ animationDelay: '.05s' }}>
            <span className="lr-orb-emoji">🔥</span>
            <div className="lr-orb-val lr-orb-mono">{topGainer ? formatPct(topGainer.change) : '—'}</div>
            <div className="lr-orb-lbl">Top Mover</div>
          </div>
          <div className="lr-orb lr-orb-3" style={{ animationDelay: '.1s' }}>
            <span className="lr-orb-emoji">🍿</span>
            <div className="lr-orb-val lr-orb-mono">${format(totalVol24h)}</div>
            <div className="lr-orb-lbl">Vol 24h</div>
          </div>
          <div className="lr-orb lr-orb-4" style={{ animationDelay: '.15s' }}>
            <span className="lr-orb-emoji">📡</span>
            <div className="lr-orb-val">{recentTokens.length}</div>
            <div className="lr-orb-lbl">On Radar</div>
          </div>
        </div>

        {/* FEATURED "JUST HATCHED" — the freshest pump.fun launch */}
        {featured && (
          <div className="lr-feature">
            <div className="lr-feature-badge">
              <span className="lr-egg">🐣</span>JUST HATCHED
            </div>
            <div className="lr-feature-head">
              <div className="lr-feature-avatar">
                <div className="lr-inner"><TokenIcon token={featured} /></div>
              </div>
              <div className="lr-feature-name">
                <div className="lr-feature-sym">${featured.sym}</div>
                <div className="lr-feature-sub">{featured.name}</div>
                <div className="lr-feature-age">⚡ {featured.age} old</div>
              </div>
            </div>
            <div className="lr-feature-actions">
              <button
                type="button"
                className="lr-feature-btn"
                disabled={!!busy[featured.mint]}
                onClick={() => handleBuy(featured, 0.25)}
              >🍭 APE 0.25 SOL</button>
              <button
                type="button"
                className="lr-feature-btn"
                disabled={!!busy[featured.mint]}
                onClick={() => handleBuy(featured, 0.5)}
              >🚀 APE 0.5 SOL</button>
            </div>
          </div>
        )}

        {/* TABS */}
        <div className={'lr-tabs' + (lane === 'recent' ? ' lr-tab-recent' : '')}>
          <div className="lr-tab-indicator" />
          <button
            type="button"
            className={'lr-tab' + (lane === 'fresh' ? ' lr-active' : '')}
            onClick={() => setLane('fresh')}
          >
            <span className="lr-tab-emoji">🐣</span>
            JUST HATCHED
            <span className="lr-tab-count">{pumpTokens.length}</span>
          </button>
          <button
            type="button"
            className={'lr-tab' + (lane === 'recent' ? ' lr-active' : '')}
            onClick={() => setLane('recent')}
          >
            <span className="lr-tab-emoji">🌈</span>
            ON RADAR
            <span className="lr-tab-count">{recentTokens.length}</span>
          </button>
        </div>

        {/* FILTERS */}
        <div className="lr-filters">
          {[
            ['all', '🌟 ALL'],
            ['1h',  '⚡ STILL HOT'],
            ['6h',  '🍿 TODAY'],
            ['24h', '🌙 24H'],
          ].map(([k, l]) => (
            <button
              key={k} type="button"
              className={'lr-filter' + (timeFilter === k ? ' lr-active' : '')}
              onClick={() => setTimeFilter(k)}
            >
              {l}
            </button>
          ))}
          <div className="lr-filter-divider" />
          {[
            ['newest', '🆕 FRESHEST'],
            ['volume', '🔥 LOUDEST'],
            ['signal', '✨ TOP SIGNAL'],
          ].map(([k, l]) => (
            <button
              key={k} type="button"
              className={'lr-filter' + (sortBy === k ? ' lr-active' : '')}
              onClick={() => setSortBy(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {/* FEED */}
        {filtered.length === 0 ? (
          <div className="lr-empty">
            <span className="lr-empty-emoji">{lane === 'fresh' ? '🥚' : '🍿'}</span>
            {lane === 'fresh' && !pumpConnected ? (
              <><b>Warming up the launch stream…</b><div className="lr-empty-sub">Hatching new tokens from pump.fun any second now.</div></>
            ) : (
              <><b>Nothing matches yet</b><div className="lr-empty-sub">Loosen the filter or switch lanes — fresh drops are landing all day.</div></>
            )}
          </div>
        ) : (
          <div className="lr-feed">
            {filtered.map((t, i) => (
              <LaunchCard
                key={t.mint}
                token={t}
                owned={balances[t.mint]}
                busy={busy[t.mint]}
                onBuy={handleBuy}
                onSell={handleSell}
                isFresh={t.source === 'pumpfun'}
                tintIndex={i % 5}
              />
            ))}
          </div>
        )}
      </div>

      {/* TOASTS */}
      <div className="lr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={'lr-toast lr-toast-' + t.kind}>
            <span className="lr-toast-emoji">{t.emoji}</span>
            <div className="lr-toast-body">{t.body}</div>
            {t.link && (
              <a className="lr-toast-action" href={t.link} target="_blank" rel="noreferrer">VIEW</a>
            )}
          </div>
        ))}
      </div>

      {/* CONFETTI BURST */}
      {confettiKey > 0 && (
        <div className="lr-confetti" key={confettiKey}>
          {confettiPieces.map(p => (
            <div
              key={p.i}
              className="lr-confetti-piece"
              style={{
                background: p.color,
                animationDelay: p.delay + 's',
                '--dx': p.dx + 'px',
                '--dy': p.dy + 'px',
                '--dr': p.dr + 'deg',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
