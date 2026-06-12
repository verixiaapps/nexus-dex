// LaunchRadar.jsx — Solana new launches + per-card BUY/SELL modal trade flow.
//
// CHANGES (per latest direction):
//   • Each card now has just two actions: BUY and SELL.
//   • Tapping either opens a wonderland-themed trade modal (SwapWidget-style:
//     two rows, amount input, live quote, big confirm) — quote fetches as the
//     amount changes, confirm triggers the wallet popup.
//   • Inside the modal: quick preset chips for fast amount entry (SOL for
//     buy, % of holding for sell), still editable via the settings gear.
//   • After a confirmed trade, the toast adds a "Share on Twitter" button
//     alongside View on Solscan. The pre-filled tweet includes the trade
//     details and the user's ?ref= link so shares are also referrals.
//   • Removed the top buy-preset bar; gear icon moved to the topbar.
//   • All Jupiter routing / fee logic / RPC pool / simulate-sign-send flow
//     preserved verbatim from the SwapWidget pattern.

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
   CSS — pastel wonderland palette
   ════════════════════════════════════════════════════════════════════ */
const LR_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
.lr-root{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --pink:#FF8FBE; --mint:#7FFFD4; --lav:#B794F6; --peach:#FFB088;
  --sky:#A0E7FF; --gold:#FFD46B; --green:#1B7A4F; --red:#D14B6A;
  --twitter:#1DA1F2;
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
@keyframes lrFade{from{opacity:0}to{opacity:1}}
@keyframes lrRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes lrPopIn{0%{opacity:0;transform:scale(.92) translateY(8px)}60%{transform:scale(1.02) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes lrSpin{to{transform:rotate(360deg)}}
@keyframes lrShimmerSlide{0%{left:-110px}50%,100%{left:130%}}
@keyframes lrSlideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes lrSlideDown{to{transform:translateY(120%);opacity:0}}
@keyframes lrModalIn{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}

.lr-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:0.45;animation:lrDrift 14s ease-in-out infinite;pointer-events:none;z-index:0}

.lr-phone{max-width:480px;margin:0 auto;position:relative;padding-bottom:32px;z-index:5}

/* ───── TOPBAR ───── */
.lr-topbar{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:rgba(251,245,255,0.72);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.lr-brand{display:flex;align-items:center;gap:10px;cursor:pointer}
.lr-brand-dot{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);box-shadow:0 0 14px rgba(183,148,246,.5);position:relative}
.lr-brand-dot::after{content:'';position:absolute;inset:-6px;border-radius:50%;border:1.5px solid rgba(183,148,246,.4);border-top-color:transparent;border-right-color:transparent;animation:lrSpin 18s linear infinite}
.lr-brand-text{font-family:"Instrument Serif",serif;font-style:italic;font-size:18px;line-height:1}
.lr-brand-text .lr-slash{opacity:.4;margin:0 3px;font-style:normal}
.lr-topbar-right{display:flex;align-items:center;gap:8px}
.lr-gear-btn{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:var(--glass);border:1px solid var(--border);display:grid;place-items:center;cursor:pointer;font-size:14px;transition:transform .25s,background .15s;font-family:initial;color:var(--ink)}
.lr-gear-btn:hover{transform:rotate(60deg);background:var(--glass-strong)}
.lr-wallet-btn{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(127,255,212,.35);letter-spacing:.2px}
.lr-wallet-btn.lr-connected{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);box-shadow:none}
.lr-wallet-btn .lr-wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}

/* ───── HERO ───── */
.lr-hero{padding:28px 18px 8px;text-align:center;position:relative;z-index:2}
.lr-hero-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:var(--ink-2);padding:5px 12px;border-radius:999px;background:var(--glass);border:1px solid var(--border);margin-bottom:14px}
.lr-radar-pulse{position:relative;width:8px;height:8px;border-radius:50%;background:var(--peach);box-shadow:0 0 8px var(--peach)}
.lr-radar-pulse::before{content:'';position:absolute;inset:-3px;border-radius:50%;background:var(--peach);opacity:.4;animation:lrPulseScale 1.6s ease-in-out infinite}
.lr-hero h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:42px;line-height:.98;letter-spacing:-.01em;margin:0 0 8px}
.lr-hero h1 .lr-grad{background:linear-gradient(90deg,#FF8FBE,#FFB088 50%,#FFD46B);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lr-hero h1 .lr-italic{font-style:italic;font-weight:400}
.lr-hero h1 .lr-sparkle{display:inline-block;font-family:initial;animation:lrPulse 1.8s ease-in-out infinite}
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

/* ───── TABS ───── */
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

/* ───── CARDS ───── */
.lr-feed{display:flex;flex-direction:column;gap:10px;padding:0 18px;position:relative;z-index:2}
.lr-card{padding:14px;border-radius:24px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);position:relative;overflow:hidden;animation:lrPopIn .45s cubic-bezier(.2,.9,.2,1) backwards;transition:border-color .2s,box-shadow .2s}
.lr-card:hover{border-color:rgba(183,148,246,.4);box-shadow:0 8px 24px rgba(183,148,246,.12)}
.lr-card.lr-fresh{background:linear-gradient(135deg,rgba(255,176,136,.18),var(--glass) 60%)}

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

/* ───── CARD ACTIONS (single BUY + SELL buttons) ───── */
.lr-card-actions{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);display:flex;gap:8px}
.lr-card-btn{flex:1;border:none;cursor:pointer;padding:12px 0;border-radius:14px;font-family:inherit;font-weight:800;font-size:13px;letter-spacing:.6px;transition:transform .12s cubic-bezier(.2,1.3,.4,1),box-shadow .2s}
.lr-card-btn:active{transform:scale(.96)}
.lr-card-btn:disabled{opacity:.55;cursor:not-allowed}
.lr-card-buy{background:linear-gradient(135deg,#FFB088,#FFD46B);color:#fff;box-shadow:0 4px 12px rgba(255,176,136,.35)}
.lr-card-buy:hover:not(:disabled){box-shadow:0 6px 18px rgba(255,176,136,.45)}
.lr-card-sell{background:linear-gradient(135deg,#FF8FBE,#B794F6);color:#fff;box-shadow:0 4px 12px rgba(255,143,190,.35)}
.lr-card-sell:hover:not(:disabled){box-shadow:0 6px 18px rgba(255,143,190,.45)}
.lr-owned-strip{display:flex;align-items:center;gap:6px;font-family:ui-monospace,monospace;font-size:10px;color:var(--ink-2);margin-top:10px;font-weight:700;padding:6px 10px;background:rgba(127,255,212,.15);border:1px solid rgba(127,255,212,.35);border-radius:10px}
.lr-owned-strip b{color:var(--green);font-weight:800}

/* ───── EMPTY ───── */
.lr-empty{text-align:center;padding:48px 24px;color:var(--ink-2);font-size:14px;font-weight:500}
.lr-empty .lr-empty-emoji{font-size:48px;margin-bottom:14px;display:block;opacity:.6}
.lr-empty b{color:var(--ink);font-weight:700}
.lr-empty-sub{font-size:12px;margin-top:6px;color:var(--ink-3);font-weight:500}
.lr-empty-err{margin-top:10px;font-family:ui-monospace,monospace;font-size:10px;color:var(--red);background:rgba(209,75,106,.08);border:1px solid rgba(209,75,106,.25);padding:7px 12px;border-radius:10px;display:inline-block;max-width:100%;overflow-wrap:break-word}

/* ───── TOAST ───── */
.lr-toasts{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.lr-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:18px;backdrop-filter:blur(20px);box-shadow:0 12px 32px rgba(26,27,78,.15);animation:lrSlideUp .35s cubic-bezier(.2,1.3,.4,1);font-size:13px;font-weight:600}
.lr-toast.lr-toast-success{background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(127,255,212,.4));border:1px solid rgba(127,255,212,.5);color:var(--ink)}
.lr-toast.lr-toast-error{background:linear-gradient(135deg,rgba(255,255,255,.95),rgba(255,143,190,.35));border:1px solid rgba(209,75,106,.4);color:var(--ink)}
.lr-toast.lr-toast-info{background:rgba(255,255,255,.92);border:1px solid var(--border);color:var(--ink)}
.lr-toast-emoji{font-size:22px;line-height:1;flex-shrink:0}
.lr-toast-body{flex:1;min-width:0;line-height:1.35}
.lr-toast-body b{font-weight:800}
.lr-toast-actions{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap}
.lr-toast-action{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);padding:6px 10px;border-radius:9px;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.5px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.lr-toast-action.lr-toast-twitter{background:linear-gradient(135deg,rgba(160,231,255,.5),rgba(127,255,212,.5));border-color:rgba(127,255,212,.5)}
.lr-toast-action.lr-toast-twitter:hover{box-shadow:0 4px 12px rgba(127,255,212,.35)}
.lr-toast-action svg{width:11px;height:11px}

/* ───── REFERRER CHIP ───── */
.lr-refchip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:linear-gradient(90deg,rgba(127,255,212,.25),rgba(160,231,255,.18));border:1px solid rgba(127,255,212,.4);font-size:10px;font-weight:700;color:var(--ink);letter-spacing:.2px;font-family:ui-monospace,monospace}

/* ───── STAT ORBS ───── */
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

/* ───── FEATURED CARD ───── */
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

/* ───── CARD TINT VARIANTS ───── */
.lr-card.lr-tint-0{background:linear-gradient(135deg,rgba(255,143,190,.18),var(--glass) 60%)}
.lr-card.lr-tint-1{background:linear-gradient(135deg,rgba(127,255,212,.18),var(--glass) 60%)}
.lr-card.lr-tint-2{background:linear-gradient(135deg,rgba(183,148,246,.18),var(--glass) 60%)}
.lr-card.lr-tint-3{background:linear-gradient(135deg,rgba(160,231,255,.18),var(--glass) 60%)}
.lr-card.lr-tint-4{background:linear-gradient(135deg,rgba(255,212,107,.18),var(--glass) 60%)}
.lr-card.lr-fresh{background:linear-gradient(135deg,rgba(255,176,136,.22),var(--glass) 60%) !important}

/* ───── CONFETTI ───── */
.lr-confetti{position:fixed;inset:0;pointer-events:none;z-index:200;overflow:hidden}
.lr-confetti-piece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:lrConfetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}
@keyframes lrConfetti{
  0%{transform:translate(-50%,-50%) rotate(0);opacity:1}
  100%{transform:translate(calc(-50% + var(--dx,0px)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}
}

/* ═══════════════════════════════════════════════════════════════
   TRADE MODAL — appears when user taps BUY or SELL on a card
   ═══════════════════════════════════════════════════════════════ */
.lr-trade-overlay{position:fixed;inset:0;background:rgba(26,27,78,.42);backdrop-filter:blur(14px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding:0;animation:lrFade .2s}
@media(min-width:640px){.lr-trade-overlay{align-items:center;padding:16px}}
.lr-trade-card{width:100%;max-width:460px;max-height:90dvh;overflow-y:auto;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(251,245,255,.96));border:1px solid var(--border);border-top:1.5px solid rgba(183,148,246,.4);border-radius:28px 28px 0 0;backdrop-filter:blur(20px);box-shadow:0 -20px 60px rgba(26,27,78,.2);animation:lrModalIn .3s cubic-bezier(.2,1.2,.4,1)}
@media(min-width:640px){.lr-trade-card{border-radius:28px}}
.lr-trade-head{display:flex;align-items:center;gap:12px;padding:20px 20px 14px;position:relative}
.lr-trade-close{position:absolute;top:14px;right:14px;background:var(--glass);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-family:initial;font-size:16px;color:var(--ink);line-height:1;z-index:2}
.lr-trade-avatar{width:48px;height:48px;border-radius:50%;padding:2px;flex-shrink:0;background:conic-gradient(from 0deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE)}
.lr-trade-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:22px;overflow:hidden;background:linear-gradient(135deg,#FFD9C9,#E8B8A0)}
.lr-trade-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-trade-token-info{flex:1;min-width:0;padding-right:36px}
.lr-trade-token-sym{font-family:"Instrument Serif",serif;font-size:24px;line-height:1;margin:0}
.lr-trade-token-sub{font-size:11px;color:var(--ink-2);font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.lr-trade-mode-tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 20px 14px;background:var(--glass);border:1px solid var(--border);border-radius:14px;padding:4px;position:relative}
.lr-trade-mode-tab{padding:10px 0;text-align:center;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.8px;color:var(--ink-2);border-radius:11px;cursor:pointer;background:none;border:none;position:relative;z-index:2;transition:color .2s}
.lr-trade-mode-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);border-radius:11px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1;background:linear-gradient(135deg,#FFB088,#FFD46B);box-shadow:0 3px 10px rgba(255,176,136,.4)}
.lr-trade-mode-tabs.lr-mode-sell .lr-trade-mode-indicator{transform:translateX(100%);background:linear-gradient(135deg,#FF8FBE,#B794F6);box-shadow:0 3px 10px rgba(255,143,190,.4)}
.lr-trade-mode-tab.lr-active{color:#fff}

.lr-trade-body{padding:0 20px 20px}

.lr-trade-row{background:var(--glass-strong);border:1.5px solid var(--border);border-radius:16px;padding:14px;transition:border-color .15s}
.lr-trade-row:focus-within{border-color:rgba(183,148,246,.5);box-shadow:0 0 0 3px rgba(183,148,246,.1)}
.lr-trade-row+.lr-trade-row{margin-top:8px}
.lr-trade-row-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.lr-trade-row-label{font-family:ui-monospace,monospace;font-size:9px;color:var(--ink-2);font-weight:800;letter-spacing:1.2px;text-transform:uppercase}
.lr-trade-row-bal{font-family:ui-monospace,monospace;font-size:10px;color:var(--ink-2);font-weight:700;display:flex;align-items:center;gap:6px}
.lr-trade-row-bal b{color:var(--ink);font-weight:800}
.lr-trade-max-btn{background:rgba(183,148,246,.2);border:1px solid rgba(183,148,246,.4);color:#5A3C9E;padding:3px 8px;border-radius:7px;font-family:ui-monospace,monospace;font-size:9px;font-weight:800;cursor:pointer;letter-spacing:.5px}
.lr-trade-row-mid{display:flex;align-items:center;gap:10px}
.lr-trade-token-chip{display:flex;align-items:center;gap:6px;padding:8px 11px;background:rgba(255,255,255,.7);border:1px solid var(--border);border-radius:999px;flex-shrink:0;font-weight:800;font-size:13px;font-family:"Instrument Serif",serif}
.lr-trade-token-chip-logo{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#FFD9C9,#E8B8A0);display:grid;place-items:center;font-size:13px;overflow:hidden;flex-shrink:0}
.lr-trade-token-chip-logo img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-trade-amount-input{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:"Instrument Serif",serif;font-size:28px;text-align:right;font-weight:400;min-width:0;width:100%;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.lr-trade-amount-input::placeholder{color:var(--ink-3);font-weight:400}
.lr-trade-amount-input:read-only{cursor:default}

.lr-trade-presets{display:flex;gap:6px;margin:10px 0 4px;overflow-x:auto;scrollbar-width:none}
.lr-trade-presets::-webkit-scrollbar{display:none}
.lr-trade-preset{flex-shrink:0;padding:7px 12px;border-radius:999px;background:var(--glass);border:1.5px solid var(--border);color:var(--ink);font-family:ui-monospace,monospace;font-weight:800;font-size:11px;cursor:pointer;transition:all .15s;letter-spacing:.3px}
.lr-trade-preset:hover{border-color:rgba(183,148,246,.5)}
.lr-trade-preset.lr-active{color:#fff;border-color:transparent}
.lr-trade-presets.lr-mode-buy .lr-trade-preset.lr-active{background:linear-gradient(135deg,#FFB088,#FFD46B);box-shadow:0 3px 10px rgba(255,176,136,.4)}
.lr-trade-presets.lr-mode-sell .lr-trade-preset.lr-active{background:linear-gradient(135deg,#FF8FBE,#B794F6);box-shadow:0 3px 10px rgba(255,143,190,.4)}

.lr-trade-details{margin-top:12px;padding:11px 14px;background:rgba(255,255,255,.5);border:1px solid var(--border);border-radius:14px;font-family:ui-monospace,monospace;font-size:11px}
.lr-trade-detail-row{display:flex;justify-content:space-between;padding:3px 0;font-weight:700;gap:8px}
.lr-trade-detail-row>span:first-child{color:var(--ink-2);font-weight:600}
.lr-trade-detail-val{color:var(--ink);font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.lr-trade-detail-val.lr-good{color:var(--green)}
.lr-trade-detail-val.lr-warn{color:#8B6B00}
.lr-trade-detail-val.lr-bad{color:var(--red)}

.lr-trade-banner{margin-top:12px;padding:11px 13px;border-radius:13px;font-size:12px;font-weight:600;border:1.5px solid}
.lr-trade-banner-error{background:rgba(209,75,106,.08);border-color:rgba(209,75,106,.35);color:var(--red)}

.lr-trade-confirm{width:100%;margin-top:14px;padding:16px 0;border:none;border-radius:16px;color:#fff;font-family:inherit;font-size:14px;font-weight:800;letter-spacing:.5px;cursor:pointer;transition:transform .12s cubic-bezier(.2,1.3,.4,1),box-shadow .2s;position:relative;overflow:hidden}
.lr-trade-confirm.lr-mode-buy{background:linear-gradient(135deg,#FFB088,#FFD46B);box-shadow:0 8px 20px rgba(255,176,136,.4)}
.lr-trade-confirm.lr-mode-sell{background:linear-gradient(135deg,#FF8FBE,#B794F6);box-shadow:0 8px 20px rgba(255,143,190,.4)}
.lr-trade-confirm:active:not(:disabled){transform:scale(.98)}
.lr-trade-confirm:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;background:linear-gradient(135deg,#E5E0EE,#D5D0E0);color:var(--ink-2)}

.lr-trade-footer{margin-top:10px;font-family:ui-monospace,monospace;font-size:9px;color:var(--ink-3);text-align:center;font-weight:600;letter-spacing:.3px}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL — edit preset values
   ═══════════════════════════════════════════════════════════════ */
.lr-settings-overlay{position:fixed;inset:0;background:rgba(26,27,78,.42);backdrop-filter:blur(10px);z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;animation:lrFade .2s}
.lr-settings-card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(251,245,255,.95));border:1px solid var(--border);border-radius:24px;padding:22px;backdrop-filter:blur(20px);box-shadow:0 20px 60px rgba(26,27,78,.2);animation:lrPopIn .3s cubic-bezier(.2,1.3,.4,1)}
.lr-settings-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.lr-settings-title{font-family:"Instrument Serif",serif;font-size:24px;line-height:1;margin:0;color:var(--ink)}
.lr-settings-close{background:var(--glass);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-family:initial;font-size:16px;color:var(--ink);line-height:1}
.lr-settings-section{margin-bottom:18px}
.lr-settings-section-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;color:var(--ink-2);margin-bottom:9px}
.lr-preset-edit-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.lr-preset-tag{display:inline-flex;align-items:center;gap:5px;padding:6px 4px 6px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);font-family:ui-monospace,monospace;font-size:12px;font-weight:800;color:var(--ink)}
.lr-preset-tag-x{width:18px;height:18px;border-radius:50%;background:rgba(209,75,106,.15);color:var(--red);border:none;cursor:pointer;font-size:12px;line-height:1;display:grid;place-items:center;font-family:initial}
.lr-preset-tag-x:hover{background:rgba(209,75,106,.3)}
.lr-preset-add{display:flex;gap:5px;align-items:center;margin-left:4px}
.lr-preset-add input{width:64px;padding:6px 10px;border-radius:999px;background:var(--glass);border:1px solid var(--border);font-family:ui-monospace,monospace;font-size:12px;font-weight:700;color:var(--ink);outline:none}
.lr-preset-add input:focus{border-color:var(--lav)}
.lr-preset-add-btn{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);border:none;cursor:pointer;font-weight:800;font-size:16px;display:grid;place-items:center;font-family:initial;line-height:1}
.lr-settings-actions{display:flex;gap:8px;margin-top:8px}
.lr-settings-btn{flex:1;padding:12px 0;border-radius:14px;border:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.6px}
.lr-settings-btn-primary{background:linear-gradient(135deg,#B794F6,#FF8FBE);color:#fff;box-shadow:0 4px 12px rgba(183,148,246,.3)}
.lr-settings-btn-reset{background:var(--glass);color:var(--ink-2);border:1px solid var(--border)}

/* ───── DESKTOP ───── */
@media (min-width:1024px){
  .lr-phone{max-width:1100px;padding-bottom:80px}
  .lr-topbar{padding:14px 32px}
  .lr-hero{padding:36px 32px 12px;max-width:760px;margin:0 auto}
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
   CONFIG
   ════════════════════════════════════════════════════════════════════ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;
const REF_BPS    = 100;
const SLIPPAGE_BPS = 1500;
const SOL_RESERVE = 0.005;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

/* RPC pool — same pattern as SwapWidget */
const RUNTIME_CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const RPC_POOL = [
  RUNTIME_CFG.rpc,
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOLANA_RPC) || null,
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_HELIUS_API_KEY)
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : null,
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

const BAL_COMMITMENT = 'processed';

const _connCache = new Map();
const getConn = (url, commitment) => {
  const key = url + '|' + commitment;
  let c = _connCache.get(key);
  if (!c) { c = new Connection(url, commitment); _connCache.set(key, c); }
  return c;
};

const rpcRace = (label, op, commitment = BAL_COMMITMENT) => {
  const conns = RPC_POOL.map(u => getConn(u, commitment));
  return Promise.any(conns.map((c, i) =>
    op(c).catch(e => {
      if (typeof console !== 'undefined') console.warn(`[lr-rpc] ${label} failed on ${RPC_POOL[i]}:`, e?.message);
      throw e;
    })
  )).catch(() => { throw new Error(`${label}: all RPCs failed`); });
};

const POLL_RECENT  = 8_000;
const POLL_SOL     = 30_000;
const POLL_BALANCE = 12_000;
const PUMP_WSS_URL = 'wss://pumpportal.fun/api/data';
const DEXSCREENER_TOKEN_URL = (mint) => `https://api.dexscreener.com/latest/dex/tokens/${mint}`;

/* ════════════════════════════════════════════════════════════════════
   HELPERS
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
  if (p >= 0.00000001) return '$' + p.toFixed(9);
  return '$' + p.toExponential(2);
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1)    return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1)   return n.toFixed(2);
  return n.toPrecision(3);
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
    preGrad:   false,
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
   TWITTER SHARE — pre-fills the tweet + uses ?ref= for referral attribution
   ════════════════════════════════════════════════════════════════════ */
function buildShareUrl(referrerAddr) {
  if (typeof window === 'undefined') return '';
  try {
    const u = new URL(window.location.origin + window.location.pathname);
    if (referrerAddr) u.searchParams.set('ref', referrerAddr);
    return u.toString();
  } catch { return ''; }
}
function buildTweetText({ mode, token, solAmount, outAmount, percentage }) {
  if (mode === 'buy') {
    const recv = outAmount > 0 ? `\n→ ${formatTokens(outAmount)} $${token.sym}` : '';
    return `Just aped ${solAmount} SOL into $${token.sym} on Wonderland Radar 🍭${recv}\n\nFresh launch sniped:`;
  }
  const got = outAmount > 0 ? `\n→ ${formatSol(outAmount)} SOL back` : '';
  return `Just sold ${percentage}% of my $${token.sym} on Wonderland Radar 💸${got}\n\nFresh launches every minute:`;
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  window.open(`https://twitter.com/intent/tweet?${params}`, '_blank', 'noopener,noreferrer,width=600,height=500');
}

/* ════════════════════════════════════════════════════════════════════
   SIGNAL / RISK BADGES
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

function TokenIcon({ token }) {
  const [errored, setErrored] = useState(false);
  if (!token?.icon || errored) return <span>{token?.emoji || '🪙'}</span>;
  return <img src={token.icon} alt={token.sym || ''} onError={() => setErrored(true)} />;
}

/* ════════════════════════════════════════════════════════════════════
   PUMP.FUN WSS STREAM (bonding-curve price computed on arrival)
   ════════════════════════════════════════════════════════════════════ */
function usePumpFunStream(enabled) {
  const [tokens, setTokens] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pendingEnrich = useRef(new Set());

  const enrich = useCallback(async (mint) => {
    if (pendingEnrich.current.has(mint)) return;
    pendingEnrich.current.add(mint);
    try {
      const r = await fetch(DEXSCREENER_TOKEN_URL(mint));
      if (!r.ok) return;
      const d = await r.json();
      const pairs = (d?.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken?.address === mint);
      if (pairs.length === 0) return;
      const graduated = pairs.some(p => p.dexId && p.dexId !== 'pumpfun' && p.dexId !== 'pump');
      const pair = pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
      if (pair.baseToken.address !== mint) return;
      const enriched = {
        price:     Number(pair.priceUsd || 0),
        change:    Number(pair.priceChange?.h24 || 0),
        change1h:  Number(pair.priceChange?.h1 || 0),
        volume24h: Number(pair.volume?.h24 || 0),
        liquidity: Number(pair.liquidity?.usd || 0),
        mcap:      Number(pair.marketCap || pair.fdv || 0),
        enriched:  true,
        preGrad:   !graduated,
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

        const vSol    = Number(msg.vSolInBondingCurve   || 0);
        const vTokens = Number(msg.vTokensInBondingCurve || 0);
        const priceSol = (vSol > 0 && vTokens > 0) ? vSol / vTokens : 0;
        const mcapSol  = Number(msg.marketCapSol || 0);

        const tok = {
          mint:         msg.mint,
          sym:          msg.symbol || '???',
          name:         msg.name || msg.symbol || 'Unknown',
          emoji:        emojiFor(msg.symbol || ''),
          icon:         null,
          decimals:     6,
          price:        0,
          priceSol,
          change:       0,
          mcap:         0,
          mcapSol,
          volume24h:    0,
          holders:      0,
          liquidity:    0,
          liquiditySol: vSol,
          createdAt:    Date.now(),
          ageMs:        0,
          age:          '0s',
          source:       'pumpfun',
          enriched:     false,
          preGrad:      true,
        };

        setTokens(prev => {
          if (prev.some(t => t.mint === tok.mint)) return prev;
          return [tok, ...prev].slice(0, 60);
        });
        setTimeout(() => { if (alive) enrich(msg.mint); }, 800);
      };

      ws.onerror = () => {};
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
   PRESETS — localStorage-backed buy/sell amounts (used inside trade modal)
   ════════════════════════════════════════════════════════════════════ */
function usePresets() {
  const readStored = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return fallback;
      const cleaned = arr.map(Number).filter(v => Number.isFinite(v) && v > 0);
      return cleaned.length > 0 ? cleaned : fallback;
    } catch { return fallback; }
  };
  const [buyPresets,  setBuyPresets]  = useState(() => readStored('lr_buy_presets',  DEFAULT_BUY_PRESETS));
  const [sellPresets, setSellPresets] = useState(() => readStored('lr_sell_presets', DEFAULT_SELL_PRESETS));
  useEffect(() => { try { localStorage.setItem('lr_buy_presets',  JSON.stringify(buyPresets));  } catch {} }, [buyPresets]);
  useEffect(() => { try { localStorage.setItem('lr_sell_presets', JSON.stringify(sellPresets)); } catch {} }, [sellPresets]);
  return { buyPresets, setBuyPresets, sellPresets, setSellPresets };
}

/* ════════════════════════════════════════════════════════════════════
   SETTINGS MODAL — edit preset values
   ════════════════════════════════════════════════════════════════════ */
function SettingsModal({ buyPresets, setBuyPresets, sellPresets, setSellPresets, onClose }) {
  const [buyDraft,  setBuyDraft]  = useState(buyPresets);
  const [sellDraft, setSellDraft] = useState(sellPresets);
  const [newBuy,  setNewBuy]  = useState('');
  const [newSell, setNewSell] = useState('');

  const addBuy = () => {
    const v = parseFloat(newBuy);
    if (!Number.isFinite(v) || v <= 0) return;
    if (buyDraft.includes(v)) { setNewBuy(''); return; }
    setBuyDraft([...buyDraft, v].sort((a, b) => a - b));
    setNewBuy('');
  };
  const addSell = () => {
    const v = parseFloat(newSell);
    if (!Number.isFinite(v) || v <= 0 || v > 100) return;
    if (sellDraft.includes(v)) { setNewSell(''); return; }
    setSellDraft([...sellDraft, v].sort((a, b) => a - b));
    setNewSell('');
  };
  const removeBuy  = (v) => setBuyDraft(buyDraft.filter(x => x !== v));
  const removeSell = (v) => setSellDraft(sellDraft.filter(x => x !== v));

  const save = () => {
    setBuyPresets(buyDraft.length > 0 ? buyDraft : DEFAULT_BUY_PRESETS);
    setSellPresets(sellDraft.length > 0 ? sellDraft : DEFAULT_SELL_PRESETS);
    onClose();
  };
  const reset = () => {
    setBuyDraft(DEFAULT_BUY_PRESETS);
    setSellDraft(DEFAULT_SELL_PRESETS);
  };

  return (
    <div className="lr-settings-overlay" onClick={onClose}>
      <div className="lr-settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="lr-settings-head">
          <h3 className="lr-settings-title">Presets</h3>
          <button className="lr-settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="lr-settings-section">
          <div className="lr-settings-section-label">Buy amounts (SOL)</div>
          <div className="lr-preset-edit-row">
            {buyDraft.map(v => (
              <span key={v} className="lr-preset-tag">
                {v}
                <button className="lr-preset-tag-x" onClick={() => removeBuy(v)} aria-label={`Remove ${v}`}>×</button>
              </span>
            ))}
            <span className="lr-preset-add">
              <input type="number" step="0.01" min="0" placeholder="0.5" value={newBuy}
                onChange={(e) => setNewBuy(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addBuy(); }} />
              <button className="lr-preset-add-btn" onClick={addBuy} aria-label="Add">+</button>
            </span>
          </div>
        </div>
        <div className="lr-settings-section">
          <div className="lr-settings-section-label">Sell percentages (%)</div>
          <div className="lr-preset-edit-row">
            {sellDraft.map(v => (
              <span key={v} className="lr-preset-tag">
                {v}%
                <button className="lr-preset-tag-x" onClick={() => removeSell(v)} aria-label={`Remove ${v}`}>×</button>
              </span>
            ))}
            <span className="lr-preset-add">
              <input type="number" step="1" min="1" max="100" placeholder="50" value={newSell}
                onChange={(e) => setNewSell(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSell(); }} />
              <button className="lr-preset-add-btn" onClick={addSell} aria-label="Add">+</button>
            </span>
          </div>
        </div>
        <div className="lr-settings-actions">
          <button className="lr-settings-btn lr-settings-btn-reset" onClick={reset}>Reset</button>
          <button className="lr-settings-btn lr-settings-btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TRADE MODAL — opens when user taps BUY or SELL on a card.
   Two-row SwapWidget-style layout, live quote, confirm → wallet sig.
   ════════════════════════════════════════════════════════════════════ */
function TradeModal({
  token, initialMode, onClose, onConfirm,
  buyPresets, sellPresets,
  solBalance, tokenBalance,
  solPrice,
}) {
  const [mode, setMode] = useState(initialMode || 'buy');
  // For buy: amount is in SOL. For sell: amount is in percentage (1–100).
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const quoteAbortRef = useRef(null);

  // Reset state when switching mode
  useEffect(() => {
    setAmount('');
    setQuote(null);
    setQuoteError(null);
    setError(null);
  }, [mode]);

  const isBuy = mode === 'buy';
  const presets = isBuy ? buyPresets : sellPresets;

  // Compute the raw amount to swap (in lamports for buy, in raw token units for sell)
  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (isBuy) {
      const rawAmount = BigInt(Math.floor(n * 1e9)).toString();
      return {
        rawAmount,
        inputMint:  SOL_MINT,
        outputMint: token.mint,
        inputDecimals: 9,
        outputDecimals: token.decimals || 6,
        solAmount: n,
      };
    }
    if (!tokenBalance || !tokenBalance.amount || BigInt(tokenBalance.amount) <= 0n) return null;
    const pct = Math.min(100, Math.max(0.01, n));
    const rawAmount = ((BigInt(tokenBalance.amount) * BigInt(Math.floor(pct * 100))) / 10000n).toString();
    if (BigInt(rawAmount) <= 0n) return null;
    return {
      rawAmount,
      inputMint:  token.mint,
      outputMint: SOL_MINT,
      inputDecimals: tokenBalance.decimals || token.decimals || 6,
      outputDecimals: 9,
      percentage: pct,
    };
  }, [amount, isBuy, token, tokenBalance]);

  // Live quote — debounced fetch to /api/jupiter/build
  useEffect(() => {
    if (!swapParams) {
      setQuote(null); setQuoteError(null); return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;
    setQuoting(true);
    setQuoteError(null);

    const t = setTimeout(async () => {
      try {
        const net = (BigInt(swapParams.rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) { setQuote(null); setQuoting(false); return; }
        const params = new URLSearchParams({
          inputMint:   swapParams.inputMint,
          outputMint:  swapParams.outputMint,
          amount:      net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker:       '11111111111111111111111111111111',
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) {
          setQuote(data);
          setQuoteError(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setQuote(null);
          setQuoteError(friendlyError(e));
        }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 300);

    return () => { clearTimeout(t); ac.abort(); };
  }, [swapParams]);

  const outAmountUi = useMemo(() => {
    if (!quote || !swapParams) return null;
    return Number(quote.outAmount) / Math.pow(10, swapParams.outputDecimals);
  }, [quote, swapParams]);

  const priceImpact = useMemo(() => {
    if (!quote || quote.priceImpactPct == null) return null;
    const n = Number(quote.priceImpactPct);
    return Number.isFinite(n) ? n * (Math.abs(n) <= 1 ? 100 : 1) : null;
  }, [quote]);

  const ownedUiAmount = tokenBalance?.uiAmount || 0;
  const availSol = Math.max(0, (solBalance?.uiAmount || 0) - SOL_RESERVE);

  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return availSol >= Number(amount);
    return ownedUiAmount > 0;
  })();

  const handleConfirm = async () => {
    if (!swapParams || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await onConfirm({
        mode,
        swapParams,
        token,
        outAmount: outAmountUi || 0,
      });
      // On success, parent shows the toast and closes the modal.
      // If we got here without a thrown error, parent has handled it.
      if (result?.closed !== false) {
        // parent will close us; no further action
      }
    } catch (e) {
      setError(friendlyError(e));
      setConfirming(false);
    }
  };

  const setMaxBuy = () => {
    if (!isBuy) return;
    const m = Math.max(0, availSol);
    if (m > 0) setAmount(String(Number(m.toFixed(4))));
  };

  const confirmDisabled = confirming || quoting || !quote || !hasFunds || !!error;

  return (
    <div className="lr-trade-overlay" onClick={onClose}>
      <div className="lr-trade-card" onClick={(e) => e.stopPropagation()}>
        <button className="lr-trade-close" onClick={onClose} aria-label="Close">×</button>

        <div className="lr-trade-head">
          <div className="lr-trade-avatar">
            <div className="lr-inner"><TokenIcon token={token} /></div>
          </div>
          <div className="lr-trade-token-info">
            <div className="lr-trade-token-sym">${token.sym}</div>
            <div className="lr-trade-token-sub">
              {formatPrice(token.price)}
              {Number.isFinite(token.change) && token.change !== 0 && (
                <> · <span style={{ color: token.change < 0 ? 'var(--red)' : 'var(--green)' }}>
                  {formatPct(token.change)}
                </span></>
              )}
            </div>
          </div>
        </div>

        <div className={'lr-trade-mode-tabs' + (mode === 'sell' ? ' lr-mode-sell' : '')}>
          <div className="lr-trade-mode-indicator" />
          <button
            type="button"
            className={'lr-trade-mode-tab' + (mode === 'buy' ? ' lr-active' : '')}
            onClick={() => setMode('buy')}
          >🍭 BUY</button>
          <button
            type="button"
            className={'lr-trade-mode-tab' + (mode === 'sell' ? ' lr-active' : '')}
            onClick={() => setMode('sell')}
            disabled={!ownedUiAmount}
            title={!ownedUiAmount ? `You don't own any ${token.sym}` : ''}
            style={!ownedUiAmount ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
          >💸 SELL</button>
        </div>

        <div className="lr-trade-body">
          <div className="lr-trade-row">
            <div className="lr-trade-row-top">
              <span className="lr-trade-row-label">{isBuy ? 'You pay' : 'You sell'}</span>
              <span className="lr-trade-row-bal">
                {isBuy
                  ? <>Wallet: <b>{formatSol(solBalance?.uiAmount || 0)} SOL</b></>
                  : <>You own: <b>{formatTokens(ownedUiAmount)} ${token.sym}</b></>}
                {isBuy && availSol > 0 && (
                  <button className="lr-trade-max-btn" onClick={setMaxBuy}>MAX</button>
                )}
              </span>
            </div>
            <div className="lr-trade-row-mid">
              <div className="lr-trade-token-chip">
                {isBuy ? (
                  <>
                    <span className="lr-trade-token-chip-logo">◎</span>
                    <span>SOL</span>
                  </>
                ) : (
                  <>
                    <span className="lr-trade-token-chip-logo"><TokenIcon token={token} /></span>
                    <span>{token.sym}</span>
                  </>
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder={isBuy ? '0.00' : '0'}
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, '');
                  const parts = v.split('.');
                  if (parts.length > 2) return;
                  // For sell, clamp to 100
                  if (!isBuy && Number(v) > 100) { setAmount('100'); return; }
                  setAmount(v);
                }}
                className="lr-trade-amount-input"
              />
            </div>
            {!isBuy && amount && (
              <div style={{
                marginTop: 6, textAlign: 'right',
                fontFamily: 'ui-monospace,monospace', fontSize: 10, fontWeight: 700,
                color: 'var(--ink-2)', letterSpacing: '.4px',
              }}>
                {Math.min(100, Math.max(0, Number(amount) || 0)).toFixed(0)}% of holding
              </div>
            )}
          </div>

          <div className={'lr-trade-presets ' + (isBuy ? 'lr-mode-buy' : 'lr-mode-sell')}>
            {presets.map(v => {
              const active = Number(amount) === v;
              return (
                <button
                  key={v}
                  type="button"
                  className={'lr-trade-preset' + (active ? ' lr-active' : '')}
                  onClick={() => setAmount(String(v))}
                >
                  {isBuy ? `${v} SOL` : `${v}%`}
                </button>
              );
            })}
          </div>

          <div className="lr-trade-row">
            <div className="lr-trade-row-top">
              <span className="lr-trade-row-label">{isBuy ? 'You receive' : 'You receive'}</span>
            </div>
            <div className="lr-trade-row-mid">
              <div className="lr-trade-token-chip">
                {isBuy ? (
                  <>
                    <span className="lr-trade-token-chip-logo"><TokenIcon token={token} /></span>
                    <span>{token.sym}</span>
                  </>
                ) : (
                  <>
                    <span className="lr-trade-token-chip-logo">◎</span>
                    <span>SOL</span>
                  </>
                )}
              </div>
              <input
                type="text"
                readOnly
                placeholder={quoting ? '…' : '0.00'}
                value={outAmountUi != null
                  ? (isBuy ? formatTokens(outAmountUi) : formatSol(outAmountUi))
                  : (quoting ? '…' : '')}
                className="lr-trade-amount-input"
              />
            </div>
          </div>

          {quote && swapParams && Number(amount) > 0 && (
            <div className="lr-trade-details">
              <div className="lr-trade-detail-row">
                <span>Rate</span>
                <span className="lr-trade-detail-val">
                  {isBuy
                    ? `1 SOL ≈ ${formatTokens((outAmountUi || 0) / Number(amount))} ${token.sym}`
                    : `${formatTokens(Number(quote.inAmount) / Math.pow(10, swapParams.inputDecimals))} ${token.sym} → ${formatSol(outAmountUi || 0)} SOL`}
                </span>
              </div>
              <div className="lr-trade-detail-row">
                <span>Price impact</span>
                <span className={'lr-trade-detail-val ' +
                  (priceImpact == null ? '' : priceImpact > 5 ? 'lr-bad' : priceImpact > 1 ? 'lr-warn' : 'lr-good')}>
                  {priceImpact != null ? `${priceImpact.toFixed(2)}%` : '—'}
                </span>
              </div>
              <div className="lr-trade-detail-row">
                <span>Slippage</span>
                <span className="lr-trade-detail-val">{(SLIPPAGE_BPS / 100).toFixed(0)}%</span>
              </div>
              <div className="lr-trade-detail-row">
                <span>Fee</span>
                <span className="lr-trade-detail-val">{(FEE_BPS / 100).toFixed(1)}% baked in</span>
              </div>
            </div>
          )}

          {(quoteError || error) && (
            <div className="lr-trade-banner lr-trade-banner-error">
              {error || quoteError}
            </div>
          )}

          <button
            type="button"
            className={'lr-trade-confirm ' + (isBuy ? 'lr-mode-buy' : 'lr-mode-sell')}
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
            {confirming
              ? (isBuy ? 'Buying…' : 'Selling…')
              : !amount || Number(amount) <= 0
                ? (isBuy ? 'Enter SOL amount' : 'Enter percentage')
                : !hasFunds
                  ? (isBuy ? 'Insufficient SOL' : `No ${token.sym} to sell`)
                  : quoting
                    ? 'Getting quote…'
                    : !quote
                      ? 'No route'
                      : (isBuy ? `🍭 Buy ${amount} SOL of $${token.sym}` : `💸 Sell ${Math.min(100, Number(amount))}% of $${token.sym}`)}
          </button>

          <p className="lr-trade-footer">
            Powered by <b style={{ color: 'var(--ink)' }}>Jupiter</b> · Your wallet stays yours
          </p>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LAUNCH CARD — just BUY and SELL buttons (no preset chips)
   ════════════════════════════════════════════════════════════════════ */
function LaunchCard({ token, owned, onBuy, onSell, isFresh, tintIndex = 0 }) {
  const signals = useMemo(() => deriveSignalBadges(token), [token]);
  const risk    = useMemo(() => deriveRiskBadge(token), [token]);
  const ownedBalance = owned?.uiAmount || 0;
  const ownedUsd = ownedBalance * (token.price || 0);
  const veryFresh = isFresh && Number.isFinite(token.ageMs) && token.ageMs < 5 * 60_000;
  const tintClass = isFresh ? ' lr-fresh' : ' lr-tint-' + tintIndex;

  return (
    <div className={'lr-card' + tintClass} style={{ animationDelay: (tintIndex * 0.04) + 's' }}>
      <div className="lr-card-head">
        <div className={'lr-mini-avatar' + (isFresh ? ' lr-fresh-avatar' : '')}>
          <div className="lr-inner"><TokenIcon token={token} /></div>
        </div>
        <div className="lr-card-info">
          <div className="lr-card-sym-row">
            <span className="lr-card-sym">${token.sym}</span>
            <span className={'lr-age-pill' + (veryFresh ? ' lr-very-fresh' : '')}>
              {token.age || 'new'}
            </span>
          </div>
          <div className="lr-card-name">{token.name}</div>
        </div>
        <div className="lr-card-right">
          <div className="lr-card-price">{formatPrice(token.price)}</div>
          {Number.isFinite(token.change) && token.change !== 0 ? (
            <div className={'lr-card-change' + (token.change < 0 ? ' lr-down' : '')}>{formatPct(token.change)}</div>
          ) : null}
        </div>
      </div>

      <div className="lr-metrics">
        <div className="lr-metric">
          <div className="lr-metric-l">Liq</div>
          <div className="lr-metric-v">{token.liquidity > 0 ? '$' + format(token.liquidity) : '—'}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">MCap</div>
          <div className="lr-metric-v">{token.mcap > 0 ? '$' + format(token.mcap) : '—'}</div>
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

      {ownedBalance > 0 && (
        <div className="lr-owned-strip">
          <span>YOU OWN</span>
          <b>{formatTokens(ownedBalance)} ${token.sym}</b>
          {ownedUsd > 0 && (
            <span style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>≈ ${format(ownedUsd)}</span>
          )}
        </div>
      )}

      <div className="lr-card-actions">
        <button
          type="button"
          className="lr-card-btn lr-card-buy"
          onClick={() => onBuy(token)}
        >🍭 BUY</button>
        <button
          type="button"
          className="lr-card-btn lr-card-sell"
          disabled={ownedBalance <= 0}
          onClick={() => onSell(token)}
          title={ownedBalance <= 0 ? `You don't own any ${token.sym}` : ''}
        >💸 SELL</button>
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
  const connection = useMemo(() => getConn(RPC_POOL[0], 'confirmed'), []);

  /* ──── referrer (for the share-as-referral link) ──── */
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

  /* ──── presets + settings ──── */
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* ──── trade modal ──── */
  // null when closed; { token, mode } when open
  const [tradeOpen, setTradeOpen] = useState(null);

  /* ──── tabs + filters ──── */
  const [lane, setLane] = useState('fresh');
  const [timeFilter, setTimeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  /* ──── fresh lane ──── */
  const { tokens: pumpTokens, connected: pumpConnected } = usePumpFunStream(true);

  /* ──── recent lane (Jupiter) ──── */
  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/jupiter/tokens/v2/recent?limit=60');
        if (!r.ok) {
          if (!cancelled) {
            setRecentError(`Recent feed unreachable (HTTP ${r.status})`);
            setRecentLoading(false);
          }
          return;
        }
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setRecentTokens(list.map(normalize).filter(t => t.mint));
          setRecentLoading(false);
          setRecentError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRecentError(String(e?.message || 'Recent feed unreachable').slice(0, 120));
          setRecentLoading(false);
        }
      }
    }
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ──── SOL price ──── */
  const [solPrice, setSolPrice] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/sol-price');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d?.price) setSolPrice(d.price);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ──── balances ──── */
  const [balances, setBalances] = useState({});
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); return; }
    const owner = wallet.publicKey;
    const mergeAccs = (into, accs) => {
      if (!accs || !accs.value) return;
      for (const acc of accs.value) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const amt = info.tokenAmount?.amount;
        if (!mint || amt == null) continue;
        into[mint] = {
          amount:   String(amt),
          decimals: Number(info.tokenAmount?.decimals ?? 6),
          uiAmount: Number(info.tokenAmount?.uiAmount || 0),
        };
      }
    };

    const solP = rpcRace('getBalance', c => c.getBalance(owner, BAL_COMMITMENT))
      .then(lamports => {
        setBalances(prev => ({
          ...prev,
          [SOL_MINT]: { amount: String(lamports), decimals: 9, uiAmount: lamports / 1e9 },
        }));
      })
      .catch(e => console.warn('[lr] SOL balance failed', e?.message));

    const tokP = rpcRace('tokenAccs', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT)
    ).then(accs => {
      setBalances(prev => {
        const next = { ...prev };
        mergeAccs(next, accs);
        return next;
      });
    }).catch(e => console.warn('[lr] SPL accounts failed', e?.message));

    const tok22P = rpcRace('tokenAccs2022', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT)
    ).then(accs => {
      setBalances(prev => {
        const next = { ...prev };
        mergeAccs(next, accs);
        return next;
      });
    }).catch(e => console.warn('[lr] Token-2022 accounts failed', e?.message));

    await Promise.allSettled([solP, tokP, tok22P]);
  }, [wallet.publicKey]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);
  useEffect(() => {
    if (!wallet.publicKey) return;
    const id = setInterval(refreshBalances, POLL_BALANCE);
    return () => clearInterval(id);
  }, [wallet.publicKey, refreshBalances]);

  const aggressiveRefresh = useCallback(() => {
    [1500, 4000, 8000].forEach(ms => setTimeout(refreshBalances, ms));
  }, [refreshBalances]);

  const solBalance = balances[SOL_MINT];

  /* ──── toasts (with Twitter share) ──── */
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration || 8000);
  }, []);

  const requireWallet = useCallback(() => {
    if (wallet.publicKey && wallet.signTransaction) return true;
    if (onConnectWallet) { onConnectWallet(); return false; }
    pushToast({
      kind: 'error', emoji: '🔌',
      body: 'Connect a wallet first (Phantom, Solflare, Backpack).',
    });
    return false;
  }, [wallet.publicKey, wallet.signTransaction, onConnectWallet, pushToast]);

  /* ──── confetti ──── */
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

  /* ════════════════════════════════════════════════════════════════
     JUPITER SWAP — same flow as SwapWidget.handleSwap, just parametric.
     ════════════════════════════════════════════════════════════════ */
  const executeSwap = useCallback(async ({ mode, swapParams, token }) => {
    if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected');

    const { rawAmount, inputMint, outputMint, inputDecimals, outputDecimals } = swapParams;
    const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
    if (net <= 0n) throw new Error('Amount too small');

    // 1. Build via /api/jupiter/build (same shape as SwapWidget)
    const params = new URLSearchParams({
      inputMint, outputMint,
      amount:      net.toString(),
      slippageBps: String(SLIPPAGE_BPS),
      taker:       wallet.publicKey.toBase58(),
    });
    const buildRes = await fetch(`/api/jupiter/build?${params}`);
    if (!buildRes.ok) {
      const body = await buildRes.json().catch(() => ({}));
      throw new Error(body.error || `Build failed (${buildRes.status})`);
    }
    const build = await buildRes.json();
    if (!build?.swapInstruction) throw new Error('No route');

    // 2. Fee transfer instructions (platform + optional referrer split)
    const totalFee = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
    if (totalFee <= 0n) throw new Error('Fee amount rounds to zero.');
    const refFee = effectiveReferrer ? (BigInt(rawAmount) * BigInt(REF_BPS)) / 10000n : 0n;
    const platformFee = totalFee - refFee;

    const feeIxs = [];
    if (inputMint === SOL_MINT) {
      if (platformFee > 0n) feeIxs.push(SystemProgram.transfer({
        fromPubkey: wallet.publicKey, toPubkey: FEE_WALLET, lamports: Number(platformFee),
      }));
      if (refFee > 0n && effectiveReferrer) feeIxs.push(SystemProgram.transfer({
        fromPubkey: wallet.publicKey, toPubkey: effectiveReferrer, lamports: Number(refFee),
      }));
    } else {
      const mintPk = new PublicKey(inputMint);
      const mintInfo = await connection.getAccountInfo(mintPk);
      if (!mintInfo) throw new Error('Input mint not found on-chain.');
      const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
      if (platformFee > 0n) {
        const destAta = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, tokenProgram);
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram));
        feeIxs.push(createTransferCheckedInstruction(sourceAta, mintPk, destAta, wallet.publicKey, platformFee, inputDecimals, [], tokenProgram));
      }
      if (refFee > 0n && effectiveReferrer) {
        const refAta = getAssociatedTokenAddressSync(mintPk, effectiveReferrer, true, tokenProgram);
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, refAta, effectiveReferrer, mintPk, tokenProgram));
        feeIxs.push(createTransferCheckedInstruction(sourceAta, mintPk, refAta, wallet.publicKey, refFee, inputDecimals, [], tokenProgram));
      }
    }

    // 3. Compose ixs — same order as SwapWidget
    const ixs = [];
    if (Array.isArray(build.computeBudgetInstructions))
      for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));
    for (const ix of feeIxs) ixs.push(ix);
    if (Array.isArray(build.setupInstructions))
      for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
    if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
    if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
    if (Array.isArray(build.otherInstructions))
      for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

    // 4. ALTs
    const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
    let alts = [];
    if (altKeys.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
      alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
        key:   new PublicKey(k),
        state: AddressLookupTableAccount.deserialize(infos[i].data),
      }) : null).filter(Boolean);
    }

    // 5. Compile + simulate + sign + send + confirm
    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions: ixs,
    }).compileToV0Message(alts);
    const tx = new VersionedTransaction(message);

    const mapSimErr = (logs) => {
      const j = (logs || []).join('\n').toLowerCase();
      if (j.includes('insufficient') || j.includes('0x1')) return 'Insufficient balance for this swap.';
      if (j.includes('slippage') || j.includes('0x1771'))  return 'Price moved — try a higher slippage or smaller amount.';
      if (j.includes('account not') || j.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
      if (j.includes('blockhash') || j.includes('expired')) return 'Quote expired. Please refresh and retry.';
      return null;
    };
    try {
      const sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
      if (sim.value.err) throw new Error(mapSimErr(sim.value.logs) || 'Swap simulation failed — the price may have moved.');
    } catch (simErr) {
      if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) throw simErr;
      console.warn('[lr] sim non-fatal', simErr);
    }

    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });

    let confirmed = false;
    try {
      const conf = await Promise.race([
        connection.confirmTransaction({
          signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
        }, 'confirmed'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
      ]);
      if (conf?.value?.err) throw new Error('Swap tx failed on-chain.');
      confirmed = true;
    } catch {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          const cs = st?.value?.confirmationStatus;
          if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
          if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
        } catch (e) { if (/failed on-chain/i.test(String(e.message))) throw e; }
      }
    }

    const outAmount = Number(build.outAmount) / Math.pow(10, outputDecimals);
    return { sig, confirmed, outAmount, mode, token };
  }, [wallet, connection, effectiveReferrer]);

  /* ──── card BUY/SELL → opens modal ──── */
  const onCardBuy = useCallback((token) => {
    if (!requireWallet()) return;
    setTradeOpen({ token, mode: 'buy' });
  }, [requireWallet]);

  const onCardSell = useCallback((token) => {
    if (!requireWallet()) return;
    setTradeOpen({ token, mode: 'sell' });
  }, [requireWallet]);

  /* ──── modal CONFIRM → actual swap ──── */
  const handleTradeConfirm = useCallback(async ({ mode, swapParams, token, outAmount: estOut }) => {
    const { sig, confirmed, outAmount } = await executeSwap({ mode, swapParams, token });
    if (confirmed) fireConfetti();

    // Build the Twitter share text + URL
    const shareUrl = buildShareUrl(wallet.publicKey?.toBase58());
    const tweetText = buildTweetText({
      mode, token,
      solAmount:  swapParams.solAmount,
      outAmount:  outAmount || estOut || 0,
      percentage: swapParams.percentage,
    });

    pushToast({
      kind: 'success',
      emoji: confirmed ? '🎉' : '⏳',
      body: mode === 'buy'
        ? <><b>Bought ${token.sym}</b><br/>{swapParams.solAmount} SOL{outAmount > 0 ? <> → {formatTokens(outAmount)} {token.sym}</> : null}</>
        : <><b>Sold {Math.round(swapParams.percentage)}% of ${token.sym}</b>{outAmount > 0 ? <><br/>Got {formatSol(outAmount)} SOL</> : null}</>,
      solscan: `https://solscan.io/tx/${sig}`,
      tweetText, shareUrl,
    });

    aggressiveRefresh();
    setTradeOpen(null);
    return { closed: true };
  }, [executeSwap, fireConfetti, pushToast, aggressiveRefresh, wallet.publicKey]);

  /* ──── lane + filters ──── */
  const deriveDisplayValues = useCallback((t) => {
    if (!t) return t;
    let price = t.price;
    let mcap  = t.mcap;
    let liquidity = t.liquidity;
    if ((price == null || price <= 0) && t.priceSol > 0 && solPrice > 0) price = t.priceSol * solPrice;
    if ((mcap == null || mcap <= 0) && t.mcapSol > 0 && solPrice > 0) mcap = t.mcapSol * solPrice;
    if ((liquidity == null || liquidity <= 0) && t.liquiditySol > 0 && solPrice > 0) liquidity = t.liquiditySol * solPrice;
    if (price === t.price && mcap === t.mcap && liquidity === t.liquidity) return t;
    return { ...t, price, mcap, liquidity };
  }, [solPrice]);

  const activeList = lane === 'fresh' ? pumpTokens : recentTokens;
  const filtered = useMemo(() => {
    let l = activeList.map(deriveDisplayValues);
    if (timeFilter !== 'all') {
      const cap = timeFilter === '1h' ? 3600_000 : timeFilter === '6h' ? 6*3600_000 : 24*3600_000;
      l = l.filter(t => Number.isFinite(t.ageMs) && t.ageMs < cap);
    }
    if (sortBy === 'newest')      l = [...l].sort((a, b) => (a.ageMs || 0) - (b.ageMs || 0));
    else if (sortBy === 'volume') l = [...l].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    else if (sortBy === 'signal') l = [...l].sort((a, b) => signalScore(b) - signalScore(a));
    return l.slice(0, 30);
  }, [activeList, timeFilter, sortBy, deriveDisplayValues]);

  const featured = useMemo(() => {
    const pool = pumpTokens.filter(t => Number.isFinite(t.ageMs) && t.ageMs < 30 * 60_000).map(deriveDisplayValues);
    return pool.length ? pool[0] : null;
  }, [pumpTokens, deriveDisplayValues]);
  const topGainer = useMemo(() => {
    const pool = [...pumpTokens, ...recentTokens].filter(t => Number.isFinite(t.change) && t.change > 0);
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.change > a.change ? b : a));
  }, [pumpTokens, recentTokens]);
  const totalVol24h = useMemo(() => {
    return [...pumpTokens, ...recentTokens].reduce((s, t) => s + (t.volume24h || 0), 0);
  }, [pumpTokens, recentTokens]);

  const onConnectClick = useCallback(async () => {
    if (wallet.publicKey && wallet.disconnect) {
      try { await wallet.disconnect(); } catch {}
      return;
    }
    if (onConnectWallet) { onConnectWallet(); return; }
    if (wallet.connect) {
      try { await wallet.connect(); }
      catch (e) {
        pushToast({
          kind: 'error', emoji: '🔌',
          body: 'Could not connect — pick a wallet first (Phantom, Solflare, Backpack).',
        });
      }
    }
  }, [wallet, onConnectWallet, pushToast]);

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
              className="lr-gear-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Edit presets"
            >⚙</button>
            <button
              type="button"
              className={'lr-wallet-btn' + (wallet.publicKey ? ' lr-connected' : '')}
              onClick={onConnectClick}
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
            No KYC<span className="lr-dot">•</span>No Accounts<span className="lr-dot">•</span>Your Keys Stay Yours
          </div>
        </div>

        {/* STATUS */}
        <div className="lr-status">
          <div className="lr-status-item">
            <span className={'lr-live-dot' + (lane === 'fresh' && !pumpConnected ? ' lr-warn' : '')} />
            {lane === 'fresh'
              ? (pumpConnected ? <>LIVE · <b>{pumpTokens.length}</b> tracked</> : <>RECONNECTING…</>)
              : (recentLoading ? <>SYNCING…</> : recentError ? <>FEED DOWN</> : <><b>{recentTokens.length}</b> tokens</>)}
          </div>
          <div className="lr-status-divider" />
          <div className="lr-status-item">
            SOL <b>${solPrice > 0 ? solPrice.toFixed(2) : '—'}</b>
          </div>
          {wallet.publicKey && (
            <>
              <div className="lr-status-divider" />
              <div className="lr-status-item">
                💰 <b>{formatSol(solBalance?.uiAmount || 0)}</b>
              </div>
            </>
          )}
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

        {/* FEATURED */}
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
                <div className="lr-feature-sub">
                  {featured.name} · {formatPrice(featured.price)}
                </div>
                <div className="lr-feature-age">⚡ {featured.age} old</div>
              </div>
            </div>
            <div className="lr-feature-actions">
              <button
                type="button"
                className="lr-feature-btn"
                onClick={() => onCardBuy(featured)}
              >
                🚀 BUY ${featured.sym}
              </button>
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
              <>
                <b>Warming up the launch stream…</b>
                <div className="lr-empty-sub">Hatching new tokens from pump.fun any second now.</div>
              </>
            ) : lane === 'recent' && recentError ? (
              <>
                <b>Recent feed offline</b>
                <div className="lr-empty-sub">Switch to JUST HATCHED while we retry.</div>
                <div className="lr-empty-err">{recentError}</div>
              </>
            ) : (
              <>
                <b>Nothing matches yet</b>
                <div className="lr-empty-sub">Loosen the filter or switch lanes — fresh drops are landing all day.</div>
              </>
            )}
          </div>
        ) : (
          <div className="lr-feed">
            {filtered.map((t, i) => (
              <LaunchCard
                key={t.mint}
                token={t}
                owned={balances[t.mint]}
                onBuy={onCardBuy}
                onSell={onCardSell}
                isFresh={t.source === 'pumpfun'}
                tintIndex={i % 5}
              />
            ))}
          </div>
        )}
      </div>

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <SettingsModal
          buyPresets={buyPresets}
          setBuyPresets={setBuyPresets}
          sellPresets={sellPresets}
          setSellPresets={setSellPresets}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* TRADE MODAL */}
      {tradeOpen && (
        <TradeModal
          token={tradeOpen.token}
          initialMode={tradeOpen.mode}
          onClose={() => setTradeOpen(null)}
          onConfirm={handleTradeConfirm}
          buyPresets={buyPresets}
          sellPresets={sellPresets}
          solBalance={solBalance}
          tokenBalance={balances[tradeOpen.token.mint]}
          solPrice={solPrice}
        />
      )}

      {/* TOASTS — with Twitter share */}
      <div className="lr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={'lr-toast lr-toast-' + t.kind}>
            <span className="lr-toast-emoji">{t.emoji}</span>
            <div className="lr-toast-body">{t.body}</div>
            <div className="lr-toast-actions">
              {t.solscan && (
                <a className="lr-toast-action" href={t.solscan} target="_blank" rel="noreferrer">
                  VIEW
                </a>
              )}
              {t.tweetText && (
                <button
                  type="button"
                  className="lr-toast-action lr-toast-twitter"
                  onClick={() => openTwitterShare(t.tweetText, t.shareUrl)}
                  aria-label="Share on Twitter"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  SHARE
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* CONFETTI */}
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
