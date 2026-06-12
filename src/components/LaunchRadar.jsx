// LaunchRadar.jsx — Solana new launches + per-card BUY/SELL trade flow.
//
// All trades route through pumpportal.fun /api/trade-local:
//   • preGrad === true  → pool: 'pump'  (bonding curve)
//   • preGrad === false → pool: 'auto'  (graduated — pumpportal picks pump-amm,
//                                        raydium, raydium-cpmm, bonk or launchlab)
//
// 3% SOL fee on every buy AND sell goes to:
//   Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV
// Fee is appended as SystemProgram.transfer instructions AFTER the pump.fun
// swap instructions inside the same atomic v0 transaction:
//   1. Fetch unsigned tx from pumpportal
//   2. Deserialize, load ALTs, decompile message
//   3. Append fee transfer ix(s)  (+ optional referrer split)
//   4. Recompile with fresh blockhash → sign → send → confirm

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

/* ════════════════════════════════════════════════════════════════════
   CSS
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

.lr-status{display:flex;justify-content:center;align-items:center;gap:14px;padding:8px 14px;margin:0 18px 14px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);backdrop-filter:blur(10px);font-family:ui-monospace,monospace;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.5px}
.lr-status-item{display:flex;align-items:center;gap:5px}
.lr-status-item b{color:var(--ink);font-weight:800}
.lr-status-divider{width:1px;height:12px;background:var(--border)}
.lr-status .lr-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:lrPulse 1.5s ease-in-out infinite}
.lr-status .lr-live-dot.lr-warn{background:var(--peach);box-shadow:0 0 8px var(--peach)}

.lr-tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 18px 14px;background:var(--glass);border:1px solid var(--border);border-radius:18px;padding:5px;position:relative;backdrop-filter:blur(10px)}
.lr-tab{padding:12px 0;text-align:center;font-family:inherit;font-weight:700;font-size:12px;letter-spacing:1px;color:var(--ink-2);border-radius:14px;cursor:pointer;transition:color .2s;position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:6px;background:none;border:none}
.lr-tab .lr-tab-emoji{font-size:14px}
.lr-tab-indicator{position:absolute;top:5px;bottom:5px;width:calc(50% - 5px);background:linear-gradient(135deg,#FF8FBE,#FFB088);border-radius:14px;transition:transform .4s cubic-bezier(.2,1.3,.4,1),background .3s;z-index:1;box-shadow:0 4px 14px rgba(255,143,190,.35)}
.lr-tabs.lr-tab-recent .lr-tab-indicator{transform:translateX(100%);background:linear-gradient(135deg,#7FFFD4,#A0E7FF);box-shadow:0 4px 14px rgba(127,255,212,.4)}
.lr-tab.lr-active{color:var(--ink)}
.lr-tab-count{font-family:ui-monospace,monospace;font-size:10px;background:rgba(255,255,255,.5);padding:2px 7px;border-radius:999px;font-weight:800;color:var(--ink);margin-left:3px}

.lr-filters{display:flex;gap:6px;padding:0 18px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
.lr-filters::-webkit-scrollbar{display:none}
.lr-filter{flex-shrink:0;padding:8px 14px;border-radius:999px;background:var(--glass);border:1px solid var(--border);color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.4px;cursor:pointer;transition:all .15s;backdrop-filter:blur(10px)}
.lr-filter.lr-active{background:linear-gradient(135deg,#B794F6,#FF8FBE);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(183,148,246,.3)}
.lr-filter-divider{flex-shrink:0;width:1px;height:24px;background:var(--border);align-self:center;margin:0 4px}

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

.lr-empty{text-align:center;padding:48px 24px;color:var(--ink-2);font-size:14px;font-weight:500}
.lr-empty .lr-empty-emoji{font-size:48px;margin-bottom:14px;display:block;opacity:.6}
.lr-empty b{color:var(--ink);font-weight:700}
.lr-empty-sub{font-size:12px;margin-top:6px;color:var(--ink-3);font-weight:500}
.lr-empty-err{margin-top:10px;font-family:ui-monospace,monospace;font-size:10px;color:var(--red);background:rgba(209,75,106,.08);border:1px solid rgba(209,75,106,.25);padding:7px 12px;border-radius:10px;display:inline-block;max-width:100%;overflow-wrap:break-word}

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

.lr-refchip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:linear-gradient(90deg,rgba(127,255,212,.25),rgba(160,231,255,.18));border:1px solid rgba(127,255,212,.4);font-size:10px;font-weight:700;color:var(--ink);letter-spacing:.2px;font-family:ui-monospace,monospace}

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

.lr-card.lr-tint-0{background:linear-gradient(135deg,rgba(255,143,190,.18),var(--glass) 60%)}
.lr-card.lr-tint-1{background:linear-gradient(135deg,rgba(127,255,212,.18),var(--glass) 60%)}
.lr-card.lr-tint-2{background:linear-gradient(135deg,rgba(183,148,246,.18),var(--glass) 60%)}
.lr-card.lr-tint-3{background:linear-gradient(135deg,rgba(160,231,255,.18),var(--glass) 60%)}
.lr-card.lr-tint-4{background:linear-gradient(135deg,rgba(255,212,107,.18),var(--glass) 60%)}
.lr-card.lr-fresh{background:linear-gradient(135deg,rgba(255,176,136,.22),var(--glass) 60%) !important}

.lr-confetti{position:fixed;inset:0;pointer-events:none;z-index:200;overflow:hidden}
.lr-confetti-piece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:lrConfetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}
@keyframes lrConfetti{
  0%{transform:translate(-50%,-50%) rotate(0);opacity:1}
  100%{transform:translate(calc(-50% + var(--dx,0px)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}
}

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
.lr-trade-banner{margin-top:12px;padding:11px 13px;border-radius:13px;font-size:12px;font-weight:600;border:1.5px solid}
.lr-trade-banner-error{background:rgba(209,75,106,.08);border-color:rgba(209,75,106,.35);color:var(--red)}
.lr-trade-confirm{width:100%;margin-top:14px;padding:16px 0;border:none;border-radius:16px;color:#fff;font-family:inherit;font-size:14px;font-weight:800;letter-spacing:.5px;cursor:pointer;transition:transform .12s cubic-bezier(.2,1.3,.4,1),box-shadow .2s;position:relative;overflow:hidden}
.lr-trade-confirm.lr-mode-buy{background:linear-gradient(135deg,#FFB088,#FFD46B);box-shadow:0 8px 20px rgba(255,176,136,.4)}
.lr-trade-confirm.lr-mode-sell{background:linear-gradient(135deg,#FF8FBE,#B794F6);box-shadow:0 8px 20px rgba(255,143,190,.4)}
.lr-trade-confirm:active:not(:disabled){transform:scale(.98)}
.lr-trade-confirm:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;background:linear-gradient(135deg,#E5E0EE,#D5D0E0);color:var(--ink-2)}
.lr-trade-footer{margin-top:10px;font-family:ui-monospace,monospace;font-size:9px;color:var(--ink-3);text-align:center;font-weight:600;letter-spacing:.3px}

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
// 3% fee on every trade goes to this wallet (in SOL)
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;  // 3%
const REF_BPS    = 100;  // referrer cut (1% of the trade = 1/3 of the 3% fee, when present)
const SLIPPAGE_PCT = 15; // pump.fun expects percent, not bps
const SOL_RESERVE  = 0.005;
const PRIORITY_FEE = 0.001;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

const RUNTIME_CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const RPC_POOL = [
  RUNTIME_CFG.rpc,
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOLANA_RPC) || null,
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
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
const PUMP_WSS_URL   = 'wss://pumpportal.fun/api/data';
const PUMP_TRADE_URL = 'https://pumpportal.fun/api/trade-local';
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
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1)           return '$' + p.toFixed(4);
  if (p >= 0.01)        return '$' + p.toFixed(5);
  if (p >= 0.0001)      return '$' + p.toFixed(6);
  if (p >= 0.00000001)  return '$' + p.toFixed(9);
  return '$' + p.toExponential(2);
}
function formatPriceSol(p) {
  if (!Number.isFinite(p) || p <= 0) return null;
  if (p >= 0.01)     return p.toFixed(4) + ' SOL';
  if (p >= 0.000001) return p.toFixed(8) + ' SOL';
  return p.toExponential(2) + ' SOL';
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000)  return n.toFixed(0);
  if (n >= 1)     return n.toFixed(3);
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
  const volPts   = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1)) * 3.5);
  const liqPts   = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1)) * 3);
  const holdPts  = Math.min(15, Math.log10(Math.max(t.holders || 1, 1)) * 2.5);
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
    // Tokens from Jupiter's recent feed are listed → already graduated.
    // Bonding-curve tokens come from the WSS feed which sets preGrad: true.
    preGrad:   false,
  };
}

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))                          return 'Insufficient balance.';
  if (m.includes('slippage'))                              return 'Price moved — try again.';
  if (m.includes('blockhash') || m.includes('expired'))    return 'Tx expired. Retry.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('cancelled')) return 'Cancelled.';
  if (m.includes('simulation failed'))                     return 'Simulation failed — price moved.';
  if (m.includes('account not'))                           return 'Token account not ready.';
  if (m.includes('rate'))                                  return 'Rate limited.';
  if (m.includes('no route') || m.includes('could not find any route')) return 'No route yet — too fresh.';
  if (m.includes('too large'))                             return 'Route too complex. Try smaller.';
  return err?.message?.slice(0, 80) || 'Trade failed.';
};

/* ════════════════════════════════════════════════════════════════════
   TWITTER SHARE
   ════════════════════════════════════════════════════════════════════ */
function buildShareUrl(referrerAddr) {
  if (typeof window === 'undefined') return '';
  try {
    const u = new URL(window.location.origin + window.location.pathname);
    if (referrerAddr) u.searchParams.set('ref', referrerAddr);
    return u.toString();
  } catch { return ''; }
}
function buildTweetText({ mode, token, solAmount, percentage }) {
  if (mode === 'buy') {
    return `Just aped ${solAmount} SOL into $${token.sym} on Wonderland Radar 🍭\n\nFresh launch sniped:`;
  }
  return `Just sold ${percentage}% of my $${token.sym} on Wonderland Radar 💸\n\nFresh launches every minute:`;
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
  if (Number.isFinite(t.ageMs) && t.ageMs < 3600_000) out.push({ k: 'new',     emoji: '🚀', label: 'New Launch',     cls: 'lr-sig-new' });
  if ((t.change || 0) > 50)                           out.push({ k: 'fire',    emoji: '🔥', label: 'Breaking Out',    cls: 'lr-sig-fire' });
  if (t.mcap > 0 && (t.volume24h / t.mcap) > 0.3)     out.push({ k: 'vol',     emoji: '⚡', label: 'Volume Spike',    cls: 'lr-sig-vol' });
  if ((t.change || 0) > 0 && (t.change || 0) <= 50 && (t.volume24h || 0) > 50_000)
                                                       out.push({ k: 'rising',  emoji: '📈', label: 'Rising',          cls: 'lr-sig-rising' });
  if ((t.holders || 0) > 500)                         out.push({ k: 'holders', emoji: '💎', label: 'Strong Holders',  cls: 'lr-sig-holders' });
  return out.slice(0, 3);
}
function deriveRiskBadge(t) {
  const liq = t.liquidity || 0;
  if (liq < 5_000)  return { emoji: '🔴', label: 'Thin Liquidity',    cls: 'lr-risk-danger' };
  if (liq < 30_000) return { emoji: '🟡', label: 'Early Liquidity',   cls: 'lr-risk-warn' };
  return                    { emoji: '🟢', label: 'Healthy Liquidity', cls: 'lr-risk-good' };
}

/* ════════════════════════════════════════════════════════════════════
   TOKEN ICON
   ════════════════════════════════════════════════════════════════════ */
const _iconCache   = new Map();
const _iconPending = new Map();

async function resolveIconFromJupiter(mint) {
  if (!mint) return null;
  if (_iconCache.has(mint))   return _iconCache.get(mint);
  if (_iconPending.has(mint)) return _iconPending.get(mint);
  const p = (async () => {
    try {
      const r = await fetch('/api/jupiter/tokens/search?query=' + encodeURIComponent(mint));
      if (!r.ok) { _iconCache.set(mint, null); return null; }
      const data = await r.json();
      const arr  = Array.isArray(data) ? data : (data?.tokens || data?.data || []);
      const hit  = arr.find(t => (t.address || t.id || t.mint) === mint) || arr[0];
      const url  = hit?.logoURI || hit?.icon || hit?.image || null;
      _iconCache.set(mint, url || null);
      return url || null;
    } catch {
      _iconCache.set(mint, null);
      return null;
    } finally {
      _iconPending.delete(mint);
    }
  })();
  _iconPending.set(mint, p);
  return p;
}

function useTokenIcon(token) {
  const directUrl = token?.icon || null;
  const [resolved, setResolved] = useState(() => directUrl || (_iconCache.get(token?.mint) || null));
  useEffect(() => {
    if (directUrl) { setResolved(directUrl); return; }
    if (!token?.mint) return;
    if (_iconCache.has(token.mint)) { setResolved(_iconCache.get(token.mint)); return; }
    let alive = true;
    resolveIconFromJupiter(token.mint).then(url => { if (alive) setResolved(url); });
    return () => { alive = false; };
  }, [token?.mint, directUrl]);
  return resolved;
}

function TokenIcon({ token }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (!url || errored) {
    const letter = (token?.sym || '?').replace(/^\$/, '').charAt(0).toUpperCase();
    return (
      <span style={{
        display: 'grid', placeItems: 'center', width: '100%', height: '100%',
        fontFamily: '"Instrument Serif", serif', fontStyle: 'italic',
        color: 'rgba(26,27,78,0.4)', fontSize: '1em', lineHeight: 1,
      }}>{letter}</span>
    );
  }
  return (
    <img src={url} alt={token.sym || ''}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
      onError={() => setErrored(true)} />
  );
}

/* ════════════════════════════════════════════════════════════════════
   pump.fun new-token stream + DexScreener enrichment
   ════════════════════════════════════════════════════════════════════ */
function usePumpFunStream(enabled) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | connecting | live | offline
  const wsRef       = useRef(null);
  const subbedRef   = useRef(false);
  const retryRef    = useRef(0);
  const retryTimer  = useRef(null);
  const enrichTimer = useRef(null);
  const pendingMintsRef = useRef([]);
  const itemsRef    = useRef([]);
  itemsRef.current  = items;

  const enrichMints = useCallback(async (mints) => {
    if (!mints?.length) return;
    const batches = [];
    for (let i = 0; i < mints.length; i += 30) batches.push(mints.slice(i, i + 30));
    for (const b of batches) {
      try {
        const r = await fetch(DEXSCREENER_TOKEN_URL(b.join(',')));
        if (!r.ok) continue;
        const data = await r.json();
        const pairs = data?.pairs || [];
        const byMint = new Map();
        for (const p of pairs) {
          const isBase  = p?.baseToken?.address;
          const m       = isBase;
          if (!m) continue;
          const prev = byMint.get(m);
          const liq  = Number(p?.liquidity?.usd || 0);
          if (!prev || liq > prev.__liq) byMint.set(m, { ...p, __liq: liq });
        }
        setItems(prev => prev.map(t => {
          const p = byMint.get(t.mint);
          if (!p) return t;
          const priceUsd = Number(p.priceUsd || 0);
          const priceSol = Number(p.priceNative || 0);
          const change   = Number(p?.priceChange?.h24 ?? p?.priceChange?.h1 ?? 0);
          const liqUsd   = Number(p?.liquidity?.usd || 0);
          const v24      = Number(p?.volume?.h24 || 0);
          const mcap     = Number(p?.fdv || p?.marketCap || 0);
          const icon     = p?.info?.imageUrl || t.icon || null;
          const name     = p?.baseToken?.name || t.name;
          return {
            ...t,
            price: priceUsd > 0 ? priceUsd : t.price,
            priceSol: priceSol > 0 ? priceSol : t.priceSol,
            change,
            liquidity: liqUsd,
            volume24h: v24,
            mcap,
            icon,
            name,
            enriched: true,
          };
        }));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let killed = false;

    const open = () => {
      if (killed) return;
      try { setStatus('connecting'); } catch {}
      let ws;
      try { ws = new WebSocket(PUMP_WSS_URL); }
      catch { setStatus('offline'); scheduleRetry(); return; }
      wsRef.current = ws;
      subbedRef.current = false;

      ws.onopen = () => {
        if (killed) return;
        retryRef.current = 0;
        setStatus('live');
        try {
          ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
          subbedRef.current = true;
        } catch {}
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.message || msg?.errors) return;
          const mint = msg?.mint || msg?.tokenMint;
          if (!mint) return;
          const sym = msg?.symbol || msg?.ticker || '???';
          const name = msg?.name || msg?.tokenName || sym;
          const icon = msg?.image || msg?.uri || msg?.imageUri || null;
          const now = Date.now();
          const next = {
            mint,
            sym,
            name,
            emoji: emojiFor(sym),
            icon,
            price: 0,
            priceSol: 0,
            change: 0,
            age: '0s',
            ageMs: 0,
            createdAt: now,
            mcap: Number(msg?.marketCapSol || 0),
            volume24h: 0,
            holders: 0,
            liquidity: Number(msg?.solInPool ? msg.solInPool * 2 : 0),
            decimals: 6,
            source: 'pump',
            preGrad: true,   // bonding-curve token
            enriched: false,
          };
          setItems(prev => {
            if (prev.some(t => t.mint === mint)) return prev;
            const out = [next, ...prev];
            if (out.length > 60) out.length = 60;
            return out;
          });
          pendingMintsRef.current.push(mint);
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (killed) return;
        setStatus('offline');
        subbedRef.current = false;
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (killed) return;
      const n = Math.min(retryRef.current++, 6);
      const delay = 1000 * Math.pow(2, n);
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(open, delay);
    };

    open();

    // Age recalc + drain pending enrichment mints every 8s
    enrichTimer.current = setInterval(() => {
      const now = Date.now();
      setItems(prev => prev.map(t => {
        const am = t.createdAt ? now - t.createdAt : t.ageMs;
        return { ...t, ageMs: am, age: ageStr(am) };
      }));
      const pending = pendingMintsRef.current.splice(0, 30);
      if (pending.length) enrichMints(pending);
      // Re-enrich first 10 (price refresh) every cycle
      const top = itemsRef.current.slice(0, 10).map(t => t.mint);
      if (top.length) enrichMints(top);
    }, 8000);

    return () => {
      killed = true;
      clearTimeout(retryTimer.current);
      clearInterval(enrichTimer.current);
      try { wsRef.current?.close(); } catch {}
    };
  }, [enabled, enrichMints]);

  return { items, status };
}

/* ════════════════════════════════════════════════════════════════════
   PRESETS (localStorage)
   ════════════════════════════════════════════════════════════════════ */
function usePresets() {
  const [buyPresets, setBuyPresets] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_BUY_PRESETS;
    try {
      const v = JSON.parse(window.localStorage.getItem('lr_buy_presets') || 'null');
      if (Array.isArray(v) && v.length) return v.filter(n => Number.isFinite(n) && n > 0).slice(0, 8);
    } catch {}
    return DEFAULT_BUY_PRESETS;
  });
  const [sellPresets, setSellPresets] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SELL_PRESETS;
    try {
      const v = JSON.parse(window.localStorage.getItem('lr_sell_presets') || 'null');
      if (Array.isArray(v) && v.length) return v.filter(n => Number.isFinite(n) && n > 0 && n <= 100).slice(0, 8);
    } catch {}
    return DEFAULT_SELL_PRESETS;
  });
  useEffect(() => {
    try { window.localStorage.setItem('lr_buy_presets', JSON.stringify(buyPresets)); } catch {}
  }, [buyPresets]);
  useEffect(() => {
    try { window.localStorage.setItem('lr_sell_presets', JSON.stringify(sellPresets)); } catch {}
  }, [sellPresets]);

  const reset = useCallback(() => {
    setBuyPresets(DEFAULT_BUY_PRESETS);
    setSellPresets(DEFAULT_SELL_PRESETS);
  }, []);
  return { buyPresets, setBuyPresets, sellPresets, setSellPresets, reset };
}

/* ════════════════════════════════════════════════════════════════════
   SettingsModal
   ════════════════════════════════════════════════════════════════════ */
function SettingsModal({ open, onClose, buyPresets, setBuyPresets, sellPresets, setSellPresets, onReset }) {
  const [newBuy, setNewBuy] = useState('');
  const [newSell, setNewSell] = useState('');
  if (!open) return null;

  const addBuy = () => {
    const n = Number(newBuy);
    if (!Number.isFinite(n) || n <= 0) return;
    if (buyPresets.includes(n)) { setNewBuy(''); return; }
    setBuyPresets([...buyPresets, n].sort((a,b) => a-b).slice(0, 8));
    setNewBuy('');
  };
  const addSell = () => {
    const n = Number(newSell);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    if (sellPresets.includes(n)) { setNewSell(''); return; }
    setSellPresets([...sellPresets, n].sort((a,b) => a-b).slice(0, 8));
    setNewSell('');
  };

  return (
    <div className="lr-settings-overlay" onClick={onClose}>
      <div className="lr-settings-card" onClick={e => e.stopPropagation()}>
        <div className="lr-settings-head">
          <h2 className="lr-settings-title">Settings</h2>
          <button className="lr-settings-close" onClick={onClose}>×</button>
        </div>

        <div className="lr-settings-section">
          <div className="lr-settings-section-label">Buy presets (SOL)</div>
          <div className="lr-preset-edit-row">
            {buyPresets.map(p => (
              <span key={p} className="lr-preset-tag">
                {p}
                <button className="lr-preset-tag-x" onClick={() => setBuyPresets(buyPresets.filter(x => x !== p))}>×</button>
              </span>
            ))}
            <span className="lr-preset-add">
              <input
                type="number" step="0.01" min="0" placeholder="0.5"
                value={newBuy} onChange={e => setNewBuy(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBuy()}
              />
              <button className="lr-preset-add-btn" onClick={addBuy}>+</button>
            </span>
          </div>
        </div>

        <div className="lr-settings-section">
          <div className="lr-settings-section-label">Sell presets (%)</div>
          <div className="lr-preset-edit-row">
            {sellPresets.map(p => (
              <span key={p} className="lr-preset-tag">
                {p}%
                <button className="lr-preset-tag-x" onClick={() => setSellPresets(sellPresets.filter(x => x !== p))}>×</button>
              </span>
            ))}
            <span className="lr-preset-add">
              <input
                type="number" step="1" min="1" max="100" placeholder="25"
                value={newSell} onChange={e => setNewSell(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSell()}
              />
              <button className="lr-preset-add-btn" onClick={addSell}>+</button>
            </span>
          </div>
        </div>

        <div className="lr-settings-actions">
          <button className="lr-settings-btn lr-settings-btn-reset" onClick={onReset}>Reset defaults</button>
          <button className="lr-settings-btn lr-settings-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TradeModal — BUY or SELL via pump.fun
   ════════════════════════════════════════════════════════════════════ */
function TradeModal({ token, initialMode, onClose, onConfirm, buyPresets, sellPresets, solBalance, tokenBalance, solPrice }) {
  const [mode, setMode] = useState(initialMode || 'buy');
  const [amount, setAmount] = useState('');
  const [activePreset, setActivePreset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const numAmount = Number(amount) || 0;
  const presets   = mode === 'buy' ? buyPresets : sellPresets;

  // For BUY: amount is SOL number
  // For SELL: amount is a percentage (number 1-100)
  const validate = () => {
    if (mode === 'buy') {
      if (!numAmount || numAmount <= 0) return 'Enter SOL amount.';
      const max = Math.max(0, (solBalance || 0) - SOL_RESERVE);
      if (numAmount > max) return `Max ${formatSol(max)} SOL (keep ${SOL_RESERVE} for fees).`;
    } else {
      if (!numAmount || numAmount <= 0)   return 'Enter percentage.';
      if (numAmount > 100)                return 'Max 100%.';
      if (!tokenBalance || tokenBalance <= 0) return 'No tokens to sell.';
    }
    return '';
  };
  const validationMsg = validate();
  const canTrade      = !busy && !validationMsg && Number.isFinite(numAmount) && numAmount > 0;

  // Build swap parameters that the parent's executor will use.
  const swapParams = useMemo(() => {
    if (!canTrade) return null;
    const lamports = Math.floor(numAmount * 1e9);

    if (mode === 'buy') {
      // 3% of SOL in
      const feeLamports = (BigInt(lamports) * BigInt(FEE_BPS)) / 1000n;
      const estTokensOut = token.price > 0 && solPrice > 0
        ? (numAmount * solPrice) / token.price
        : null;
      return {
        action: 'buy',
        pumpAmount: numAmount,            // SOL number
        pumpDenominatedInSol: 'true',
        feeLamports,
        estTokensOut,
        estSolOut: null,
      };
    } else {
      // SELL: tokens sold = (pct/100) * tokenBalance
      const tokensSold = (tokenBalance || 0) * (numAmount / 100);
      // SOL out estimate: tokensSold * priceSol  (fallback: priceUsd / solPrice)
      let estSolOut = 0;
      if (token.priceSol > 0)            estSolOut = tokensSold * token.priceSol;
      else if (token.price > 0 && solPrice > 0) estSolOut = (tokensSold * token.price) / solPrice;
      const estLamports = Math.max(0, Math.floor(estSolOut * 1e9));
      const feeLamports = (BigInt(estLamports) * BigInt(FEE_BPS)) / 1000n;
      return {
        action: 'sell',
        pumpAmount: numAmount + '%',      // pumpportal accepts "X%" strings
        pumpDenominatedInSol: 'false',
        feeLamports,
        estTokensOut: null,
        estSolOut,
      };
    }
  }, [canTrade, mode, numAmount, token, tokenBalance, solPrice]);

  const confirm = async () => {
    if (!canTrade || !swapParams) return;
    setBusy(true); setErr('');
    try {
      await onConfirm({
        mode,
        token,
        amount: numAmount,
        swapParams,
      });
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const route = token.preGrad
    ? 'pump.fun bonding curve'
    : 'pumpswap (auto)';

  const buySolUsd = mode === 'buy' && solPrice > 0 ? numAmount * solPrice : 0;

  const setFromPreset = (p) => {
    if (mode === 'buy') {
      const max = Math.max(0, (solBalance || 0) - SOL_RESERVE);
      const val = Math.min(p, max);
      setAmount(String(val > 0 ? val : p));
    } else {
      setAmount(String(p));
    }
    setActivePreset(p);
  };

  const setMax = () => {
    if (mode === 'buy') {
      const max = Math.max(0, (solBalance || 0) - SOL_RESERVE);
      setAmount(max > 0 ? max.toFixed(6) : '0');
    } else {
      setAmount('100');
      setActivePreset(100);
    }
  };

  return (
    <div className="lr-trade-overlay" onClick={onClose}>
      <div className="lr-trade-card" onClick={e => e.stopPropagation()}>
        <button className="lr-trade-close" onClick={onClose}>×</button>

        <div className="lr-trade-head">
          <div className="lr-trade-avatar">
            <div className="lr-inner"><TokenIcon token={token} /></div>
          </div>
          <div className="lr-trade-token-info">
            <h2 className="lr-trade-token-sym">${token.sym}</h2>
            <div className="lr-trade-token-sub">
              {token.preGrad ? 'pump.fun · bonding curve' : 'pumpswap · graduated'} · {formatPrice(token.price)}
            </div>
          </div>
        </div>

        <div className={`lr-trade-mode-tabs ${mode === 'sell' ? 'lr-mode-sell' : ''}`}>
          <div className="lr-trade-mode-indicator" />
          <button
            className={`lr-trade-mode-tab ${mode === 'buy' ? 'lr-active' : ''}`}
            onClick={() => { setMode('buy'); setAmount(''); setActivePreset(null); setErr(''); }}
          >BUY</button>
          <button
            className={`lr-trade-mode-tab ${mode === 'sell' ? 'lr-active' : ''}`}
            onClick={() => { setMode('sell'); setAmount(''); setActivePreset(null); setErr(''); }}
          >SELL</button>
        </div>

        <div className="lr-trade-body">
          <div className="lr-trade-row">
            <div className="lr-trade-row-top">
              <span className="lr-trade-row-label">
                {mode === 'buy' ? 'You pay' : 'Percentage of holdings'}
              </span>
              <span className="lr-trade-row-bal">
                {mode === 'buy'
                  ? <>SOL: <b>{formatSol(solBalance || 0)}</b></>
                  : <>{token.sym}: <b>{formatTokens(tokenBalance || 0)}</b></>}
                <button className="lr-trade-max-btn" onClick={setMax}>MAX</button>
              </span>
            </div>
            <div className="lr-trade-row-mid">
              <span className="lr-trade-token-chip">
                {mode === 'buy' ? (
                  <>
                    <span className="lr-trade-token-chip-logo" style={{ background:'linear-gradient(135deg,#FFB088,#FFD46B)', color:'#fff' }}>◎</span>
                    SOL
                  </>
                ) : (
                  <>%</>
                )}
              </span>
              <input
                className="lr-trade-amount-input"
                type="number" inputMode="decimal" placeholder="0"
                value={amount}
                onChange={e => { setAmount(e.target.value); setActivePreset(null); }}
              />
            </div>
            {mode === 'buy' && buySolUsd > 0 && (
              <div style={{ marginTop:8, fontFamily:'ui-monospace,monospace', fontSize:10, color:'var(--ink-2)', fontWeight:700, textAlign:'right' }}>
                ≈ ${buySolUsd.toFixed(2)}
              </div>
            )}
          </div>

          <div className={`lr-trade-presets lr-mode-${mode}`}>
            {presets.map(p => (
              <button
                key={p}
                className={`lr-trade-preset ${activePreset === p ? 'lr-active' : ''}`}
                onClick={() => setFromPreset(p)}
              >
                {mode === 'buy' ? `${p} SOL` : `${p}%`}
              </button>
            ))}
          </div>

          <div className="lr-trade-details">
            <div className="lr-trade-detail-row">
              <span>Route</span>
              <span className="lr-trade-detail-val">{route}</span>
            </div>
            <div className="lr-trade-detail-row">
              <span>Slippage</span>
              <span className="lr-trade-detail-val">{SLIPPAGE_PCT}%</span>
            </div>
            <div className="lr-trade-detail-row">
              <span>Priority fee</span>
              <span className="lr-trade-detail-val">{PRIORITY_FEE} SOL</span>
            </div>
            <div className="lr-trade-detail-row">
              <span>Platform fee</span>
              <span className="lr-trade-detail-val">3% in SOL</span>
            </div>
            {mode === 'sell' && swapParams?.estSolOut > 0 && (
              <div className="lr-trade-detail-row">
                <span>Est. SOL out</span>
                <span className="lr-trade-detail-val">~{formatSol(swapParams.estSolOut)} SOL</span>
              </div>
            )}
          </div>

          {(err || validationMsg) && numAmount > 0 && (
            <div className="lr-trade-banner lr-trade-banner-error">{err || validationMsg}</div>
          )}

          <button
            className={`lr-trade-confirm lr-mode-${mode}`}
            disabled={!canTrade}
            onClick={confirm}
          >
            {busy
              ? 'Confirming…'
              : mode === 'buy'
                ? `Buy $${token.sym}`
                : `Sell ${numAmount || 0}% of $${token.sym}`
            }
          </button>

          <div className="lr-trade-footer">
            Powered by pump.fun · trade-local · 3% platform fee
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LaunchCard
   ════════════════════════════════════════════════════════════════════ */
function LaunchCard({ token, index, lane, ownedAmount, ownedSol, onBuy, onSell }) {
  const isFresh    = lane === 'fresh' && Number.isFinite(token.ageMs) && token.ageMs < 30 * 60_000;
  const tintClass  = `lr-tint-${index % 5}`;
  const isVeryFresh= isFresh && Number.isFinite(token.ageMs) && token.ageMs < 5 * 60_000;
  const signals    = deriveSignalBadges(token);
  const risk       = deriveRiskBadge(token);
  const priceSolStr= formatPriceSol(token.priceSol);
  return (
    <div className={`lr-card ${isFresh ? 'lr-fresh' : tintClass}`}
         style={{ animationDelay: `${Math.min(index, 9) * 30}ms` }}>
      <div className="lr-card-head">
        <div className={`lr-mini-avatar ${isFresh ? 'lr-fresh-avatar' : ''}`}>
          <div className="lr-inner"><TokenIcon token={token} /></div>
        </div>
        <div className="lr-card-info">
          <div className="lr-card-sym-row">
            <span className="lr-card-sym">${token.sym}</span>
            <span className={`lr-age-pill ${isVeryFresh ? 'lr-very-fresh' : ''}`}>
              {isVeryFresh ? '⚡ ' : ''}{token.age}
            </span>
          </div>
          <div className="lr-card-name">{token.name}</div>
        </div>
        <div className="lr-card-right">
          <div className="lr-card-price">{formatPrice(token.price)}</div>
          {priceSolStr && (
            <div style={{ fontFamily:'ui-monospace,monospace', fontSize:9, color:'var(--ink-3)', fontWeight:700, marginTop:1 }}>
              {priceSolStr}
            </div>
          )}
          {Number.isFinite(token.change) && token.change !== 0 && (
            <div className={`lr-card-change ${token.change < 0 ? 'lr-down' : ''}`}>{formatPct(token.change)}</div>
          )}
        </div>
      </div>

      <div className="lr-metrics">
        <div className="lr-metric">
          <div className="lr-metric-l">MCAP</div>
          <div className="lr-metric-v">${format(token.mcap)}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">VOL</div>
          <div className="lr-metric-v">${format(token.volume24h)}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">LIQ</div>
          <div className="lr-metric-v">${format(token.liquidity)}</div>
        </div>
        <div className="lr-metric">
          <div className="lr-metric-l">SCORE</div>
          <div className="lr-metric-v lr-mint-text">{signalScore(token)}</div>
        </div>
      </div>

      {(signals.length > 0 || risk) && (
        <div className="lr-badges">
          {signals.map(s => (
            <span key={s.k} className={`lr-badge ${s.cls}`}>
              <span className="lr-b-ico">{s.emoji}</span>{s.label}
            </span>
          ))}
          {risk && (
            <span className={`lr-badge ${risk.cls}`}>
              <span className="lr-b-ico">{risk.emoji}</span>{risk.label}
            </span>
          )}
        </div>
      )}

      {ownedAmount > 0 && (
        <div className="lr-owned-strip">
          <span>👜</span>
          <span>You hold <b>{formatTokens(ownedAmount)} {token.sym}</b>{ownedSol > 0 ? ` · ${formatSol(ownedSol)} SOL` : ''}</span>
        </div>
      )}

      <div className="lr-card-actions">
        <button className="lr-card-btn lr-card-buy"  onClick={() => onBuy(token)}>BUY</button>
        <button className="lr-card-btn lr-card-sell" onClick={() => onSell(token)} disabled={!(ownedAmount > 0)}>
          SELL{ownedAmount > 0 ? '' : ''}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Main LaunchRadar
   ════════════════════════════════════════════════════════════════════ */
export default function LaunchRadar() {
  useLrCSS();
  const wallet  = useWallet();
  const pubkey  = wallet.publicKey?.toBase58?.() || null;

  /* ───── Referrer ───── */
  const [referrer, setReferrer] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const u = new URL(window.location.href);
      const r = u.searchParams.get('ref');
      if (r) {
        try { new PublicKey(r); window.localStorage.setItem('lr_referrer', r); window.localStorage.setItem('mw_referrer', r); return r; } catch {}
      }
      return window.localStorage.getItem('lr_referrer') || window.localStorage.getItem('mw_referrer') || null;
    } catch { return null; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = () => {
      setReferrer(window.localStorage.getItem('lr_referrer') || window.localStorage.getItem('mw_referrer') || null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const effectiveReferrer = useMemo(() => {
    if (!referrer) return null;
    try {
      const pk = new PublicKey(referrer);
      if (pubkey && pk.toBase58() === pubkey) return null;
      if (pk.toBase58() === FEE_WALLET.toBase58()) return null;
      return pk;
    } catch { return null; }
  }, [referrer, pubkey]);

  /* ───── State ───── */
  const [recentTokens, setRecentTokens] = useState([]);
  const [solPrice, setSolPrice]         = useState(0);
  const [solBalance, setSolBalance]     = useState(0);
  const [tokenBalances, setTokenBalances] = useState({}); // mint → { amount, decimals }
  const [activeTab, setActiveTab]       = useState('pump'); // pump | recent
  const [filter, setFilter]             = useState('all');
  const [feedErr, setFeedErr]           = useState('');
  const [trade, setTrade]               = useState(null); // { token, mode } | null
  const [toasts, setToasts]             = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets, reset: resetPresets } = usePresets();

  /* ───── pump.fun stream ───── */
  const { items: pumpItems, status: streamStatus } = usePumpFunStream(true);

  /* ───── Recent feed (Jupiter — display only, NOT used for swaps) ───── */
  useEffect(() => {
    let alive = true;
    const fetchRecent = async () => {
      try {
        const r = await fetch('/api/jupiter/tokens/v2/recent?limit=50');
        if (!r.ok) throw new Error('recent ' + r.status);
        const data = await r.json();
        const arr  = Array.isArray(data) ? data : (data?.tokens || data?.data || []);
        if (!alive) return;
        setRecentTokens(arr.map(normalize).filter(t => t.mint));
        setFeedErr('');
      } catch (e) {
        if (alive) setFeedErr(e?.message || 'feed offline');
      }
    };
    fetchRecent();
    const t = setInterval(fetchRecent, POLL_RECENT);
    return () => { alive = false; clearInterval(t); };
  }, []);

  /* ───── SOL price ───── */
  useEffect(() => {
    let alive = true;
    const fetchPrice = async () => {
      try {
        const r = await fetch('/api/sol-price');
        if (!r.ok) return;
        const data = await r.json();
        if (alive && Number.isFinite(data?.price)) setSolPrice(data.price);
      } catch {}
    };
    fetchPrice();
    const t = setInterval(fetchPrice, POLL_SOL);
    return () => { alive = false; clearInterval(t); };
  }, []);

  /* ───── Balances ───── */
  const loadBalances = useCallback(async () => {
    if (!wallet.publicKey) { setSolBalance(0); setTokenBalances({}); return; }
    const pk = wallet.publicKey;
    try {
      const lamports = await rpcRace('getBalance', c => c.getBalance(pk, BAL_COMMITMENT));
      setSolBalance(lamports / 1e9);
    } catch {}
    try {
      const [classic, t22] = await Promise.allSettled([
        rpcRace('parsedTokens', c => c.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID })),
        rpcRace('parsedTokens22', c => c.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM_ID })),
      ]);
      const map = {};
      const ingest = (r) => {
        if (r.status !== 'fulfilled') return;
        for (const a of (r.value?.value || [])) {
          const info = a.account?.data?.parsed?.info;
          if (!info) continue;
          const amt = info?.tokenAmount?.uiAmount;
          if (!amt || amt <= 0) continue;
          map[info.mint] = { amount: amt, decimals: info.tokenAmount.decimals };
        }
      };
      ingest(classic); ingest(t22);
      setTokenBalances(map);
    } catch {}
  }, [wallet.publicKey]);

  useEffect(() => {
    loadBalances();
    const t = setInterval(loadBalances, POLL_BALANCE);
    return () => clearInterval(t);
  }, [loadBalances]);

  /* ───── Tokens display set ───── */
  const tokens = activeTab === 'pump' ? pumpItems : recentTokens;

  const filteredTokens = useMemo(() => {
    let list = tokens;
    if (filter === 'gainers')   list = list.filter(t => (t.change || 0) > 0);
    if (filter === 'fresh')     list = list.filter(t => Number.isFinite(t.ageMs) && t.ageMs < 3600_000);
    if (filter === 'volume')    list = [...list].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    if (filter === 'liquidity') list = list.filter(t => (t.liquidity || 0) > 10_000);
    return list;
  }, [tokens, filter]);

  const counts = useMemo(() => ({
    pump:   pumpItems.length,
    recent: recentTokens.length,
  }), [pumpItems.length, recentTokens.length]);

  const featuredToken = useMemo(() => {
    if (activeTab !== 'pump') return null;
    // First enriched token (has liquidity & price) is featured
    return pumpItems.find(t => t.enriched && (t.liquidity || 0) > 1000) || pumpItems[0] || null;
  }, [pumpItems, activeTab]);

  const otherFilteredTokens = useMemo(() => {
    if (!featuredToken) return filteredTokens;
    return filteredTokens.filter(t => t.mint !== featuredToken.mint);
  }, [filteredTokens, featuredToken]);

  /* ───── Toast helpers ───── */
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.persistent ? 18000 : 5000);
  }, []);
  const dismissToast = useCallback((id) => setToasts(prev => prev.filter(x => x.id !== id)), []);

  const fireConfetti = useCallback(() => {
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 1800);
  }, []);

  /* ════════════════════════════════════════════════════════════════
     executePumpTrade — pump.fun /api/trade-local + 3% SOL fee
     ════════════════════════════════════════════════════════════════ */
  const executePumpTrade = useCallback(async ({ mode, token, swapParams }) => {
    if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected.');

    const pool = token.preGrad === true ? 'pump' : 'auto';

    // 1) Fetch unsigned tx from pumpportal
    const tradeRes = await fetch(PUMP_TRADE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
      body: JSON.stringify({
        publicKey:         wallet.publicKey.toBase58(),
        action:            swapParams.action,
        mint:              token.mint,
        amount:            swapParams.pumpAmount,
        denominatedInSol:  swapParams.pumpDenominatedInSol,
        slippage:          SLIPPAGE_PCT,
        priorityFee:       PRIORITY_FEE,
        pool,
      }),
    });
    if (!tradeRes.ok) {
      let detail = '';
      try { detail = await tradeRes.text(); } catch {}
      throw new Error(`pump.fun ${tradeRes.status}: ${detail.slice(0, 200) || 'build failed'}`);
    }
    const txBytes = new Uint8Array(await tradeRes.arrayBuffer());
    if (txBytes.length < 32) throw new Error('pump.fun returned empty tx');

    // 2) Deserialize
    const pumpTx = VersionedTransaction.deserialize(txBytes);

    // 3) Load ALTs so we can decompile the message
    const altKeys = pumpTx.message.addressTableLookups?.map(l => l.accountKey) || [];
    let alts = [];
    if (altKeys.length) {
      const accs = await rpcRace('getALTs', c => c.getMultipleAccountsInfo(altKeys), 'confirmed');
      alts = accs.map((acc, i) => {
        if (!acc) throw new Error('ALT not found: ' + altKeys[i].toBase58());
        return new AddressLookupTableAccount({
          key:   altKeys[i],
          state: AddressLookupTableAccount.deserialize(acc.data),
        });
      });
    }

    // 4) Decompile and append fee transfer instruction(s)
    const decompiled = TransactionMessage.decompile(pumpTx.message, {
      addressLookupTableAccounts: alts,
    });

    const totalFee = BigInt(swapParams.feeLamports || 0n);
    if (totalFee > 0n) {
      let platformLamports = totalFee;
      let refLamports      = 0n;
      if (effectiveReferrer) {
        refLamports      = (totalFee * BigInt(REF_BPS)) / BigInt(FEE_BPS);
        platformLamports = totalFee - refLamports;
      }
      if (platformLamports > 0n) {
        decompiled.instructions.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(platformLamports),
        }));
      }
      if (refLamports > 0n && effectiveReferrer) {
        decompiled.instructions.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   effectiveReferrer,
          lamports:   Number(refLamports),
        }));
      }
    }

    // 5) Recompile with fresh blockhash, sign and send
    const latest = await rpcRace('getLatestBlockhash', c => c.getLatestBlockhash('confirmed'), 'confirmed');
    decompiled.recentBlockhash = latest.blockhash;
    decompiled.payerKey        = wallet.publicKey;

    const newMsg = decompiled.compileToV0Message(alts);
    const newTx  = new VersionedTransaction(newMsg);
    const signed = await wallet.signTransaction(newTx);
    const rawTx  = signed.serialize();

    const sig = await rpcRace('sendRawTransaction', c => c.sendRawTransaction(rawTx, {
      skipPreflight: false,
      maxRetries:    3,
      preflightCommitment: 'processed',
    }), 'confirmed');

    // 6) Confirm — use the primary conn for the strategy, fall back to polling on any RPC
    const conn = getConn(RPC_POOL[0], 'confirmed');
    const confirmed = await Promise.race([
      conn.confirmTransaction({
        signature:        sig,
        blockhash:        latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }, 'confirmed'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('confirm timeout')), 35_000)),
    ]).catch(async (err) => {
      // Poll fallback — up to ~20s, racing across all RPCs each tick
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const st = await rpcRace('getSignatureStatus',
            c => c.getSignatureStatus(sig, { searchTransactionHistory: true }), 'confirmed');
          const val = st?.value;
          if (val && (val.confirmationStatus === 'confirmed' || val.confirmationStatus === 'finalized')) {
            if (val.err) throw new Error('Tx error: ' + JSON.stringify(val.err));
            return { value: { err: null } };
          }
          if (val?.err) throw new Error('Tx error: ' + JSON.stringify(val.err));
        } catch {}
      }
      throw err;
    });
    if (confirmed?.value?.err) throw new Error('Tx error: ' + JSON.stringify(confirmed.value.err));

    return { signature: sig };
  }, [wallet, effectiveReferrer]);

  /* ───── handleTradeConfirm — router ───── */
  const handleTradeConfirm = useCallback(async ({ mode, token, amount, swapParams }) => {
    const result = await executePumpTrade({ mode, token, swapParams });

    const sigShort = result.signature.slice(0, 8) + '…';
    const tweetText = buildTweetText({
      mode,
      token,
      solAmount: mode === 'buy' ? amount : undefined,
      percentage: mode === 'sell' ? amount : undefined,
    });
    const shareUrl  = buildShareUrl(pubkey);

    fireConfetti();
    pushToast({
      kind: 'success',
      emoji: mode === 'buy' ? '🍭' : '💸',
      body: (
        <>
          <b>{mode === 'buy' ? `Bought` : `Sold ${amount}%`}</b>{' '}
          ${token.sym} · {sigShort}
        </>
      ),
      persistent: true,
      actions: [
        { kind: 'twitter', label: 'Share', onClick: () => openTwitterShare(tweetText, shareUrl) },
        { kind: 'link', label: 'Solscan', href: `https://solscan.io/tx/${result.signature}` },
      ],
    });

    // Refresh balances shortly after
    setTimeout(loadBalances, 1500);
    setTimeout(loadBalances, 6000);

    setTrade(null);
  }, [executePumpTrade, pubkey, pushToast, fireConfetti, loadBalances]);

  /* ───── connect helper ───── */
  const connectWallet = useCallback(() => {
    if (wallet.connected) { wallet.disconnect?.(); return; }
    try {
      // Try walletconnect-style modal if available
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('verixia:open-wallet-modal'));
      }
    } catch {}
  }, [wallet]);

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  const liveCount = filteredTokens.length;
  const isLive    = streamStatus === 'live';

  return (
    <div className="lr-root">
      {/* Background blobs */}
      <div className="lr-blob" style={{ top:'5%',  left:'-15%', width:'320px', height:'320px', background:'#FF8FBE' }} />
      <div className="lr-blob" style={{ top:'30%', right:'-20%', width:'380px', height:'380px', background:'#B794F6', animationDelay:'-3s' }} />
      <div className="lr-blob" style={{ bottom:'10%', left:'-10%', width:'300px', height:'300px', background:'#7FFFD4', animationDelay:'-7s' }} />
      <div className="lr-blob" style={{ bottom:'30%', right:'-15%', width:'260px', height:'260px', background:'#FFB088', animationDelay:'-10s' }} />

      <div className="lr-phone">
        {/* Top bar */}
        <div className="lr-topbar">
          <div className="lr-brand">
            <div className="lr-brand-dot" />
            <div className="lr-brand-text">
              <i>verixia</i>
              <span className="lr-slash">/</span>
              <i>radar</i>
            </div>
          </div>
          <div className="lr-topbar-right">
            {effectiveReferrer && (
              <span className="lr-refchip" title={effectiveReferrer.toBase58()}>
                ref · {effectiveReferrer.toBase58().slice(0, 4)}…
              </span>
            )}
            <button className="lr-gear-btn" onClick={() => setShowSettings(true)} title="Quick trade presets">⚙</button>
            <button
              className={`lr-wallet-btn ${wallet.connected ? 'lr-connected' : ''}`}
              onClick={connectWallet}
            >
              {wallet.connected
                ? <><span className="lr-wallet-dot" />{(pubkey || '').slice(0,4)}…{(pubkey || '').slice(-4)}</>
                : 'Connect'}
            </button>
          </div>
        </div>

        {/* Hero */}
        <div className="lr-hero">
          <div className="lr-hero-eyebrow">
            <span className="lr-radar-pulse" />
            Launch Radar · Solana
          </div>
          <h1>
            <span className="lr-grad">Fresh launches,</span><br/>
            <span className="lr-italic">live <span className="lr-sparkle">✨</span></span>
          </h1>
          <p className="lr-hero-sub">Snipe new tokens the moment they hit pump.fun.</p>
          <div className="lr-hero-meta">
            Pre-grad <span className="lr-dot">·</span> Graduated <span className="lr-dot">·</span> Atomic 3% fee
          </div>
        </div>

        {/* Status bar */}
        <div className="lr-status">
          <span className="lr-status-item">
            <span className={`lr-live-dot ${isLive ? '' : 'lr-warn'}`} />
            <b>{isLive ? 'LIVE' : (streamStatus || 'idle').toUpperCase()}</b>
          </span>
          <span className="lr-status-divider" />
          <span className="lr-status-item"><b>{liveCount}</b> shown</span>
          <span className="lr-status-divider" />
          <span className="lr-status-item">SOL <b>${format(solPrice)}</b></span>
        </div>

        {/* Orbs */}
        <div className="lr-orbs">
          <div className="lr-orb lr-orb-1" style={{ animationDelay: '0ms' }}>
            <span className="lr-orb-emoji">🚀</span>
            <div className="lr-orb-val lr-orb-mono">{counts.pump}</div>
            <div className="lr-orb-lbl">Fresh</div>
          </div>
          <div className="lr-orb lr-orb-2" style={{ animationDelay: '60ms' }}>
            <span className="lr-orb-emoji">⚡</span>
            <div className="lr-orb-val lr-orb-mono">{counts.recent}</div>
            <div className="lr-orb-lbl">Recent</div>
          </div>
          <div className="lr-orb lr-orb-3" style={{ animationDelay: '120ms' }}>
            <span className="lr-orb-emoji">💎</span>
            <div className="lr-orb-val lr-orb-mono">{formatSol(solBalance)}</div>
            <div className="lr-orb-lbl">SOL</div>
          </div>
          <div className="lr-orb lr-orb-4" style={{ animationDelay: '180ms' }}>
            <span className="lr-orb-emoji">🎴</span>
            <div className="lr-orb-val lr-orb-mono">{Object.keys(tokenBalances).length}</div>
            <div className="lr-orb-lbl">Bags</div>
          </div>
        </div>

        {/* Tabs */}
        <div className={`lr-tabs ${activeTab === 'recent' ? 'lr-tab-recent' : ''}`}>
          <div className="lr-tab-indicator" />
          <button
            className={`lr-tab ${activeTab === 'pump' ? 'lr-active' : ''}`}
            onClick={() => setActiveTab('pump')}
          >
            <span className="lr-tab-emoji">🚀</span>
            Fresh
            <span className="lr-tab-count">{counts.pump}</span>
          </button>
          <button
            className={`lr-tab ${activeTab === 'recent' ? 'lr-active' : ''}`}
            onClick={() => setActiveTab('recent')}
          >
            <span className="lr-tab-emoji">⚡</span>
            Recent
            <span className="lr-tab-count">{counts.recent}</span>
          </button>
        </div>

        {/* Filters */}
        <div className="lr-filters">
          {[
            { id: 'all',       label: 'All' },
            { id: 'gainers',   label: 'Gainers' },
            { id: 'fresh',     label: '< 1h' },
            { id: 'volume',    label: 'Volume' },
            { id: 'liquidity', label: 'Liq > 10k' },
          ].map(f => (
            <button
              key={f.id}
              className={`lr-filter ${filter === f.id ? 'lr-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >{f.label}</button>
          ))}
        </div>

        {/* Featured (only on Fresh tab) */}
        {activeTab === 'pump' && featuredToken && (
          <div className="lr-feature">
            <div className="lr-feature-badge"><span className="lr-egg">🥚</span>FRESH</div>
            <div className="lr-feature-head">
              <div className="lr-feature-avatar">
                <div className="lr-inner"><TokenIcon token={featuredToken} /></div>
              </div>
              <div className="lr-feature-name">
                <div className="lr-feature-sym">${featuredToken.sym}</div>
                <div className="lr-feature-sub">{featuredToken.name}</div>
                <span className="lr-feature-age">{featuredToken.age || 'now'} old</span>
              </div>
            </div>
            <div className="lr-feature-actions">
              <button
                className="lr-feature-btn"
                disabled={!wallet.connected}
                onClick={() => setTrade({ token: featuredToken, mode: 'buy' })}
              >
                {wallet.connected ? `Snipe $${featuredToken.sym}` : 'Connect to snipe'}
              </button>
            </div>
          </div>
        )}

        {/* Feed */}
        <div className="lr-feed">
          {feedErr && (
            <div className="lr-empty">
              <span className="lr-empty-emoji">⚠️</span>
              <div><b>Couldn't load feed.</b></div>
              <div className="lr-empty-sub">{feedErr}</div>
            </div>
          )}

          {!feedErr && otherFilteredTokens.length === 0 && (
            <div className="lr-empty">
              <span className="lr-empty-emoji">{activeTab === 'pump' ? '🥚' : '⏳'}</span>
              <div><b>{activeTab === 'pump' ? 'Waiting for hatch…' : 'No matches.'}</b></div>
              <div className="lr-empty-sub">
                {activeTab === 'pump'
                  ? 'New tokens appear here the second they launch.'
                  : 'Try a different filter or check back in a moment.'}
              </div>
            </div>
          )}

          {!feedErr && otherFilteredTokens.map((tok, i) => {
            const bal = tokenBalances[tok.mint];
            const ownedAmount = bal?.amount || 0;
            const ownedSol = (() => {
              if (!ownedAmount) return 0;
              if (tok.priceSol > 0)               return ownedAmount * tok.priceSol;
              if (tok.price > 0 && solPrice > 0)  return (ownedAmount * tok.price) / solPrice;
              return 0;
            })();
            return (
              <LaunchCard
                key={tok.mint}
                token={tok}
                index={i}
                lane={activeTab === 'pump' ? 'fresh' : 'recent'}
                ownedAmount={ownedAmount}
                ownedSol={ownedSol}
                onBuy={() => {
                  if (!wallet.connected) { connectWallet(); return; }
                  setTrade({ token: tok, mode: 'buy' });
                }}
                onSell={() => {
                  if (!wallet.connected) { connectWallet(); return; }
                  setTrade({ token: tok, mode: 'sell' });
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Trade modal */}
      {trade && (
        <TradeModal
          token={trade.token}
          initialMode={trade.mode}
          onClose={() => setTrade(null)}
          onConfirm={handleTradeConfirm}
          buyPresets={buyPresets}
          sellPresets={sellPresets}
          solBalance={solBalance}
          tokenBalance={tokenBalances[trade.token.mint]?.amount || 0}
          solPrice={solPrice}
        />
      )}

      {/* Settings modal */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        buyPresets={buyPresets}
        sellPresets={sellPresets}
        setBuyPresets={setBuyPresets}
        setSellPresets={setSellPresets}
        onReset={resetPresets}
      />

      {/* Toasts */}
      <div className="lr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`lr-toast lr-toast-${t.kind || 'info'}`}>
            <span className="lr-toast-emoji">{t.emoji || '✨'}</span>
            <div className="lr-toast-body">{t.body}</div>
            {Array.isArray(t.actions) && t.actions.length > 0 && (
              <div className="lr-toast-actions">
                {t.actions.map((a, i) =>
                  a.href ? (
                    <a key={i} className="lr-toast-action" href={a.href} target="_blank" rel="noopener noreferrer">
                      {a.label}
                    </a>
                  ) : (
                    <button
                      key={i}
                      className={`lr-toast-action ${a.kind === 'twitter' ? 'lr-toast-twitter' : ''}`}
                      onClick={() => { a.onClick?.(); dismissToast(t.id); }}
                    >
                      {a.kind === 'twitter' && (
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      )}
                      {a.label}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Confetti */}
      {showConfetti && (
        <div className="lr-confetti">
          {Array.from({ length: 60 }).map((_, i) => {
            const angle = (Math.PI * 2 * i) / 60 + Math.random() * 0.5;
            const dist  = 140 + Math.random() * 240;
            const dx    = Math.cos(angle) * dist;
            const dy    = Math.sin(angle) * dist + Math.random() * 200;
            const dr    = (Math.random() * 1440) - 720;
            const colors= ['#FF8FBE','#FFB088','#FFD46B','#7FFFD4','#A0E7FF','#B794F6'];
            const color = colors[i % colors.length];
            return (
              <div
                key={i}
                className="lr-confetti-piece"
                style={{
                  background: color,
                  '--dx': dx + 'px',
                  '--dy': dy + 'px',
                  '--dr': dr + 'deg',
                  animationDelay: (Math.random() * 0.15) + 's',
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
