// LaunchRadar.jsx — Solana new launches + per-card BUY/SELL modal trade flow.
//     
// TRADE PATH:
//   • BUILD : /api/pumpfun/trade (your existing pumpfun-trade.js) returns a
//             built v0 tx. Pump.fun bonding curve only.
//   • SUBMIT: the signed buy/sell tx is sent through /api/trade-rpc — Alchemy
//             primary, Ankr fallback. This is the ONLY path in the file that
//             uses the Ankr fallback (via `tradeConnection`). Everything else
//             (balances, SOL price, feed) uses /api/solana-rpc (Alchemy only)
//             via `connection`.
//   One signature per trade. Atomic 3% SOL fee.
//
//   BUY  : user enters X SOL. 0.97 * X → pump curve (server builds the ix
//          set with this as the trade amount); SystemProgram.transfer of
//          0.03 * X → FEE_WALLET, PREPENDED to the curve buy. Wallet
//          debit = exactly X.
//   SELL : full token amount → pump curve. Server returns expectedSol.
//          SystemProgram.transfer of 3% of expectedSol → FEE_WALLET,
//          APPENDED so it runs after the curve has paid native SOL into
//          the user's wallet. Pump curve pays NATIVE SOL — no WSOL ATA,
//          no unwrap step.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { stkFetchSeries, stkBuildPath, stkSmoothPath, stkThrottle, stkEndpointSeries } from './Stocks.jsx';
// Local copy of stkSeed so this file builds regardless of the Stocks.jsx version
// shipped alongside it (older Stocks.jsx builds may not export stkSeed).
function stkSeed(str) {
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) || 1) >>> 0;
}
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
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

const LR_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.lr-root{
  --ink:#0a0a0a; --ink-2:#6b6b6b; --ink-3:#9a9a9a;
  --pink:#e0364f; --mint:#16a34a; --lav:#0a0a0a; --peach:#e8820c;
  --sky:#2f6bff; --gold:#a67200; --green:#16a34a; --red:#e0364f;
  --twitter:#0a0a0a;
  --glass:#ffffff; --glass-strong:#fafafa;
  --border:#e4e4e7;
  --hairline:#efeff1;
  min-height:100vh;color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  position:relative;overflow-x:hidden;padding-bottom:80px;
  background:#ffffff;
}
.lr-root,.lr-root *{box-sizing:border-box}
@keyframes lrDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes lrPulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes lrPulseScale{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.5}}
@keyframes lrFade{from{opacity:0}to{opacity:1}}
@keyframes lrRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes lrPopIn{0%{opacity:0;transform:scale(.96) translateY(8px)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes lrSpin{to{transform:rotate(360deg)}}
@keyframes lrShimmerSlide{0%{left:-110px}50%,100%{left:130%}}
@keyframes lrSlideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes lrSlideDown{to{transform:translateY(120%);opacity:0}}
@keyframes lrModalIn{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}

.lr-blob{display:none !important}

.lr-phone{max-width:480px;margin:0 auto;position:relative;padding-bottom:32px;z-index:5}

.lr-topbar{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);border-bottom:1px solid var(--hairline)}
.lr-brand{display:flex;align-items:center;gap:9px;cursor:pointer}
.lr-brand-dot{width:26px;height:26px;border-radius:8px;background:#0a0a0a;box-shadow:none;position:relative}
.lr-brand-dot::after{display:none}
.lr-brand-text{font-family:inherit;font-style:normal;font-size:17px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.lr-brand-text .lr-slash{opacity:.3;margin:0 4px;font-style:normal;font-weight:500}
.lr-topbar-right{display:flex;align-items:center;gap:8px}
.lr-gear-btn{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--glass-strong);border:1px solid var(--border);display:grid;place-items:center;cursor:pointer;font-size:13px;transition:background .15s;font-family:initial;color:var(--ink-2)}
.lr-gear-btn:hover{background:#f0f0f1}
.lr-wallet-btn{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:#0a0a0a;color:#fff;border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;box-shadow:none;letter-spacing:-.01em}
.lr-wallet-btn.lr-connected{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);box-shadow:none}
.lr-wallet-btn .lr-wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none}

/* HERO — flattened (removed in JSX) */
.lr-hero{display:none}
.lr-hero-eyebrow{display:none}
.lr-radar-pulse{display:none}
.lr-hero h1{display:none}
.lr-hero-sub{display:none}
.lr-hero-meta{display:none}

.lr-status{display:flex;justify-content:center;align-items:center;gap:12px;padding:9px 14px;margin:12px 18px 14px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);backdrop-filter:none;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.3px}
.lr-status-item{display:flex;align-items:center;gap:5px}
.lr-status-item b{color:var(--ink);font-weight:800}
.lr-status-divider{width:1px;height:12px;background:var(--border)}
.lr-status .lr-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none;animation:lrPulse 1.5s ease-in-out infinite}
.lr-status .lr-live-dot.lr-warn{background:var(--peach);box-shadow:none}

.lr-tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 18px 14px;background:var(--fill,#f5f5f6);border:1px solid var(--border);border-radius:14px;padding:4px;position:relative;backdrop-filter:none}
.lr-tab{padding:11px 0;text-align:center;font-family:inherit;font-weight:700;font-size:12px;letter-spacing:.5px;color:var(--ink-2);border-radius:11px;cursor:pointer;transition:color .2s;position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:6px;background:none;border:none}
.lr-tab .lr-tab-emoji{font-size:14px}
.lr-tab-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:#0a0a0a;border-radius:11px;transition:transform .35s cubic-bezier(.2,1.3,.4,1);z-index:1;box-shadow:none}
.lr-tabs.lr-tab-recent .lr-tab-indicator{transform:translateX(100%);background:#0a0a0a;box-shadow:none}
.lr-tab.lr-active{color:#fff}
.lr-tab-count{font-family:ui-monospace,Menlo,monospace;font-size:10px;background:var(--border);padding:2px 7px;border-radius:999px;font-weight:800;color:var(--ink-2);margin-left:3px}
.lr-tab.lr-active .lr-tab-count{background:rgba(255,255,255,.2);color:#fff}

.lr-filters{display:flex;gap:6px;padding:0 18px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
.lr-filters::-webkit-scrollbar{display:none}
.lr-filter{flex-shrink:0;padding:8px 13px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.2px;cursor:pointer;transition:all .15s;backdrop-filter:none}
.lr-filter.lr-active{background:#0a0a0a;color:#fff;border-color:#0a0a0a;box-shadow:none}
.lr-filter-divider{flex-shrink:0;width:1px;height:24px;background:var(--border);align-self:center;margin:0 4px}

.lr-feed{display:flex;flex-direction:column;gap:10px;padding:0 18px;position:relative;z-index:2}
.lr-card{padding:14px;border-radius:16px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;position:relative;overflow:hidden;animation:lrPopIn .4s cubic-bezier(.2,.9,.2,1) backwards;transition:border-color .2s,box-shadow .2s;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.lr-card:hover{border-color:var(--border);box-shadow:0 4px 12px rgba(10,10,10,.08)}
.lr-card.lr-fresh{background:#fff}

.lr-card-head{display:flex;align-items:center;gap:12px}
.lr-mini-avatar{width:42px;height:42px;border-radius:50%;padding:0;flex-shrink:0;background:#0a0a0a}
.lr-mini-avatar.lr-fresh-avatar{background:#0a0a0a}
.lr-mini-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:19px;overflow:hidden;background:#0a0a0a;color:#fff}
.lr-mini-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}

.lr-card-info{flex:1;min-width:0}
.lr-card-sym-row{display:flex;align-items:center;gap:7px}
.lr-card-sym{font-family:inherit;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.lr-card-name{font-size:11px;color:var(--ink-2);margin-top:2px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-age-pill{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 8px;border-radius:999px;background:var(--glass-strong);color:var(--ink-2);text-transform:uppercase}
.lr-age-pill.lr-very-fresh{background:rgba(22,163,74,.12);color:var(--green);animation:none}

.lr-card-right{flex-shrink:0;text-align:right}
.lr-card-price{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;line-height:1;color:var(--ink)}
.lr-card-change{font-size:11px;font-weight:700;color:var(--green);margin-top:3px;font-family:ui-monospace,Menlo,monospace}
.lr-card-change.lr-down{color:var(--red)}

.lr-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px;padding:10px 8px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--hairline)}
.lr-metric{text-align:center;min-width:0}
.lr-metric-l{font-size:8px;color:var(--ink-3);letter-spacing:.8px;text-transform:uppercase;font-weight:700}
.lr-metric-v{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:12px;margin-top:3px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lr-metric-v.lr-mint-text{color:var(--green)}

.lr-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.lr-badge{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:800;letter-spacing:.5px;padding:4px 9px;border-radius:999px;text-transform:uppercase;display:inline-flex;align-items:center;gap:4px;border:1px solid}
.lr-badge .lr-b-ico{font-family:initial;font-size:11px}
.lr-badge.lr-sig-fire{background:rgba(224,54,79,.08);color:var(--red);border-color:rgba(224,54,79,.3)}
.lr-badge.lr-sig-vol{background:var(--glass-strong);color:var(--ink-2);border-color:var(--border)}
.lr-badge.lr-sig-new{background:rgba(22,163,74,.1);color:var(--green);border-color:rgba(22,163,74,.3)}
.lr-badge.lr-sig-holders{background:var(--glass-strong);color:var(--ink-2);border-color:var(--border)}
.lr-badge.lr-sig-rising{background:rgba(22,163,74,.1);color:var(--green);border-color:rgba(22,163,74,.3)}
.lr-badge.lr-risk-good{background:rgba(22,163,74,.1);color:var(--green);border-color:rgba(22,163,74,.3)}
.lr-badge.lr-risk-warn{background:rgba(232,130,12,.1);color:#8a5a0c;border-color:rgba(232,130,12,.3)}
.lr-badge.lr-risk-danger{background:rgba(224,54,79,.08);color:var(--red);border-color:rgba(224,54,79,.3)}

.lr-card-actions{margin-top:12px;padding-top:12px;border-top:1px solid var(--hairline);display:flex;gap:8px}
.lr-card-btn{flex:1;border:none;cursor:pointer;padding:11px 0;border-radius:12px;font-family:inherit;font-weight:800;font-size:13px;letter-spacing:.4px;transition:opacity .15s,transform .12s}
.lr-card-btn:active{transform:scale(.97)}
.lr-card-btn:disabled{opacity:.55;cursor:not-allowed}
.lr-card-buy{background:var(--green);color:#fff;box-shadow:none}
.lr-card-buy:hover:not(:disabled){opacity:.9}
.lr-card-sell{background:var(--glass-strong);color:var(--ink);border:1px solid var(--border);box-shadow:none}
.lr-card-sell:hover:not(:disabled){background:#f0f0f1}
.lr-owned-strip{display:flex;align-items:center;gap:6px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);margin-top:10px;font-weight:700;padding:6px 10px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.3);border-radius:10px}
.lr-owned-strip b{color:var(--green);font-weight:800}

.lr-empty{text-align:center;padding:48px 24px;color:var(--ink-2);font-size:14px;font-weight:500}
.lr-empty .lr-empty-emoji{font-size:44px;margin-bottom:14px;display:block;opacity:.6}
.lr-empty b{color:var(--ink);font-weight:700}
.lr-empty-sub{font-size:12px;margin-top:6px;color:var(--ink-3);font-weight:500}
.lr-empty-err{margin-top:10px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--red);background:rgba(224,54,79,.06);border:1px solid rgba(224,54,79,.25);padding:7px 12px;border-radius:10px;display:inline-block;max-width:100%;overflow-wrap:break-word}

.lr-toasts{position:fixed;bottom:calc(140px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.lr-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:14px;backdrop-filter:none;box-shadow:0 8px 28px rgba(10,10,10,.16);animation:lrSlideUp .35s cubic-bezier(.2,1.3,.4,1);font-size:13px;font-weight:600;background:#fff;border:1px solid var(--border);color:var(--ink)}
.lr-toast.lr-toast-success{background:#fff;border:1px solid rgba(22,163,74,.4);color:var(--ink)}
.lr-toast.lr-toast-error{background:#fff;border:1px solid rgba(224,54,79,.4);color:var(--ink)}
.lr-toast.lr-toast-info{background:#fff;border:1px solid var(--border);color:var(--ink)}
.lr-toast-emoji{font-size:20px;line-height:1;flex-shrink:0}
.lr-toast-body{flex:1;min-width:0;line-height:1.35}
.lr-toast-body b{font-weight:800}
.lr-toast-actions{display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap}
.lr-toast-action{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);padding:6px 10px;border-radius:9px;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.4px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.lr-toast-action.lr-toast-twitter{background:#0a0a0a;border-color:#0a0a0a;color:#fff}
.lr-toast-action.lr-toast-twitter:hover{opacity:.9}
.lr-toast-action svg{width:11px;height:11px}

.lr-orbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 18px;margin-bottom:16px;position:relative;z-index:2}
.lr-orb{position:relative;padding:12px 6px 11px;border-radius:14px;text-align:center;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;overflow:hidden;animation:lrRise .5s cubic-bezier(.2,.9,.2,1) backwards;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.lr-orb::before{display:none}
.lr-orb-emoji{font-size:17px;margin-bottom:2px;display:block;position:relative;z-index:1;line-height:1}
.lr-orb-val{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;line-height:1;position:relative;z-index:1;color:var(--ink);font-variant-numeric:tabular-nums}
.lr-orb-val.lr-orb-mono{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:14px}
.lr-orb-lbl{font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:var(--ink-3);font-weight:700;margin-top:3px;position:relative;z-index:1}

.lr-feature{position:relative;margin:0 18px 16px;padding:16px;border-radius:16px;background:#0a0a0a;border:1px solid #0a0a0a;backdrop-filter:none;overflow:hidden;box-shadow:none;animation:lrPopIn .5s cubic-bezier(.2,1.3,.4,1) backwards;z-index:2}
.lr-feature::after{display:none}
.lr-feature-badge{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:#fff;color:#0a0a0a;font-size:9px;font-weight:800;letter-spacing:.6px;box-shadow:none;z-index:3}
.lr-feature-badge .lr-egg{display:inline-block;animation:none;font-size:12px}
.lr-feature-head{display:flex;align-items:center;gap:13px;margin-bottom:14px;position:relative;z-index:2}
.lr-feature-avatar{width:54px;height:54px;border-radius:50%;padding:0;flex-shrink:0;background:#fff;box-shadow:none}
.lr-feature-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:24px;background:#fff;overflow:hidden}
.lr-feature-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-feature-name{flex:1;min-width:0}
.lr-feature-sym{font-family:inherit;font-size:24px;font-weight:800;line-height:1;font-style:normal;color:#fff}
.lr-feature-sub{font-size:11px;color:rgba(255,255,255,.6);font-weight:500;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-feature-age{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:800;color:#0a0a0a;background:#fff;padding:4px 9px;border-radius:999px;margin-top:5px;display:inline-block;letter-spacing:.4px}
.lr-feature-actions{display:flex;gap:7px;position:relative;z-index:2}
.lr-feature-btn{flex:1;border:none;cursor:pointer;padding:12px 0;border-radius:12px;font-family:inherit;font-weight:800;font-size:13px;letter-spacing:.4px;color:#fff;background:var(--green);box-shadow:none;transition:opacity .15s,transform .12s}
.lr-feature-btn:active{transform:scale(.97)}

.lr-card.lr-tint-0,.lr-card.lr-tint-1,.lr-card.lr-tint-2,.lr-card.lr-tint-3,.lr-card.lr-tint-4{background:#fff}
.lr-card.lr-fresh{background:#fff !important}

.lr-confetti{display:none}
.lr-confetti-piece{display:none}

/* ── TOKEN DETAIL CHART (CoinGecko / GeckoTerminal embed, framed) ── */
.lr-chart{margin:0 20px 14px;border:1px solid var(--hairline);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.lr-chart-bar{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--hairline)}
.lr-chart-ca{display:flex;align-items:center;gap:7px;min-width:0}
.lr-chart-ca-l{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:.5px}
.lr-chart-ca-v{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:600;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-chart-ca-copy{flex-shrink:0;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:#fff;background:#0a0a0a;border:none;border-radius:6px;padding:5px 9px;letter-spacing:.4px;cursor:pointer}
.lr-chart-src{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);font-weight:600;letter-spacing:.4px;flex-shrink:0}
.lr-chart-frame-wrap{position:relative;width:100%;height:clamp(300px,42dvh,440px);background:#fff}
.lr-chart-frame{width:100%;height:100%;border:0;display:block}
.lr-chart-state{display:grid;place-items:center;width:100%;height:clamp(300px,42dvh,440px);background:#fafafa;color:var(--ink-2);font-size:12px;font-weight:500;text-align:center;padding:20px}
.lr-chart-spin{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--border);border-top-color:#0a0a0a;animation:lrSpin .8s linear infinite}
.lr-tf-pills{display:flex;align-items:center;gap:4px;padding:8px 12px;border-top:1px solid var(--hairline)}
.lr-tf{flex:0 0 auto;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink-2);background:transparent;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;transition:.12s}
.lr-tf:hover{color:var(--ink)}
.lr-tf.on{background:#f1f1f4;color:var(--ink)}
.lr-tf:disabled{opacity:.4;cursor:default}
.lr-tf-meta{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;letter-spacing:.4px;color:var(--ink-3);text-transform:uppercase}
@media(max-width:600px){.lr-chart{margin:0 14px 14px}.lr-chart-frame-wrap,.lr-chart-state{height:clamp(300px,48dvh,420px)}.lr-tf{padding:6px 9px;font-size:10px}}

.lr-trade-overlay{position:fixed;inset:0;background:rgba(10,10,10,.4);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding:0 0 calc(120px + env(safe-area-inset-bottom)) 0;animation:lrFade .2s}
@media(min-width:640px){.lr-trade-overlay{align-items:center;padding:16px}}
.lr-trade-card{width:100%;max-width:460px;max-height:80dvh;overflow-y:auto;background:#fff;border:1px solid var(--border);border-top:1px solid var(--border);border-radius:22px 22px 22px 22px;backdrop-filter:none;box-shadow:0 -12px 50px rgba(10,10,10,.18);animation:lrModalIn .3s cubic-bezier(.2,1.2,.4,1)}
@media(min-width:640px){.lr-trade-card{border-radius:22px}}
.lr-trade-head{display:flex;align-items:center;gap:12px;padding:18px 18px 12px;position:relative}
.lr-trade-close{position:absolute;top:14px;right:14px;background:var(--glass-strong);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-family:initial;font-size:16px;color:var(--ink);line-height:1;z-index:2}
.lr-trade-avatar{width:46px;height:46px;border-radius:50%;padding:0;flex-shrink:0;background:#0a0a0a}
.lr-trade-avatar .lr-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:21px;overflow:hidden;background:#0a0a0a;color:#fff}
.lr-trade-avatar .lr-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-trade-token-info{flex:1;min-width:0;padding-right:36px}
.lr-trade-token-sym{font-family:inherit;font-size:22px;font-weight:700;line-height:1;margin:0;letter-spacing:-.02em;color:var(--ink)}
.lr-trade-token-sub{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.lr-trade-mode-tabs{display:grid;grid-template-columns:1fr 1fr;margin:0 18px 14px;background:var(--fill,#f5f5f6);border:1px solid var(--border);border-radius:14px;padding:4px;position:relative}
.lr-trade-mode-tab{padding:10px 0;text-align:center;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.5px;color:var(--ink-2);border-radius:11px;cursor:pointer;background:none;border:none;position:relative;z-index:2;transition:color .2s}
.lr-trade-mode-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);border-radius:11px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1;background:var(--green);box-shadow:none}
.lr-trade-mode-tabs.lr-mode-sell .lr-trade-mode-indicator{transform:translateX(100%);background:var(--red);box-shadow:none}
.lr-trade-mode-tab.lr-active{color:#fff}

.lr-trade-body{padding:0 18px 18px}

.lr-trade-row{background:var(--glass-strong);border:1px solid var(--border);border-radius:14px;padding:14px;transition:border-color .15s}
.lr-trade-row:focus-within{border-color:var(--ink);box-shadow:none}
.lr-trade-row+.lr-trade-row{margin-top:8px}
.lr-trade-row-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.lr-trade-row-label{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-2);font-weight:800;letter-spacing:.6px;text-transform:uppercase}
.lr-trade-row-bal{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:700;display:flex;align-items:center;gap:6px}
.lr-trade-row-bal b{color:var(--ink);font-weight:800}
.lr-trade-max-btn{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);padding:3px 8px;border-radius:7px;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:800;cursor:pointer;letter-spacing:.4px}
.lr-trade-row-mid{display:flex;align-items:center;gap:10px}
.lr-trade-token-chip{display:flex;align-items:center;gap:6px;padding:8px 11px;background:#fff;border:1px solid var(--border);border-radius:999px;flex-shrink:0;font-weight:700;font-size:13px;font-family:inherit}
.lr-trade-token-chip-logo{width:22px;height:22px;border-radius:50%;background:#0a0a0a;color:#fff;display:grid;place-items:center;font-size:13px;overflow:hidden;flex-shrink:0}
.lr-trade-token-chip-logo img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-trade-amount-input{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-size:26px;text-align:right;font-weight:600;min-width:0;width:100%;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.lr-trade-amount-input::placeholder{color:var(--ink-3);font-weight:600}
.lr-trade-amount-input:read-only{cursor:default}

.lr-trade-presets{display:flex;gap:6px;margin:10px 0 4px;overflow-x:auto;scrollbar-width:none}
.lr-trade-presets::-webkit-scrollbar{display:none}
.lr-trade-preset{flex-shrink:0;padding:7px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:11px;cursor:pointer;transition:all .15s;letter-spacing:.2px}
.lr-trade-preset:hover{border-color:var(--ink)}
.lr-trade-preset.lr-active{color:#fff;border-color:transparent}
.lr-trade-presets.lr-mode-buy .lr-trade-preset.lr-active{background:var(--green);box-shadow:none}
.lr-trade-presets.lr-mode-sell .lr-trade-preset.lr-active{background:var(--red);box-shadow:none}

.lr-trade-details{margin-top:12px;padding:11px 14px;background:var(--glass-strong);border:1px solid var(--hairline);border-radius:12px;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.lr-trade-detail-row{display:flex;justify-content:space-between;padding:3px 0;font-weight:700;gap:8px}
.lr-trade-detail-row>span:first-child{color:var(--ink-2);font-weight:600}
.lr-trade-detail-val{color:var(--ink);font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.lr-trade-detail-val.lr-good{color:var(--green)}
.lr-trade-detail-val.lr-warn{color:#8a5a0c}
.lr-trade-detail-val.lr-bad{color:var(--red)}

.lr-trade-banner{margin-top:12px;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid}
.lr-trade-banner-error{background:rgba(224,54,79,.07);border-color:rgba(224,54,79,.3);color:var(--red)}
.lr-trade-banner-info{background:var(--glass-strong);border-color:var(--hairline);color:var(--ink)}

.lr-trade-confirm{width:100%;margin-top:14px;padding:16px 0;border:none;border-radius:999px;color:#fff;font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.01em;cursor:pointer;transition:opacity .15s,transform .12s;position:relative;overflow:hidden}
.lr-trade-confirm.lr-mode-buy{background:var(--green);box-shadow:none}
.lr-trade-confirm.lr-mode-sell{background:var(--red);box-shadow:none}
.lr-trade-confirm:active:not(:disabled){transform:scale(.98)}
.lr-trade-confirm:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;background:var(--glass-strong);color:var(--ink-3);border:1px solid var(--border)}

.lr-trade-footer{margin-top:10px;font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);text-align:center;font-weight:600;letter-spacing:.2px}

.lr-settings-overlay{position:fixed;inset:0;background:rgba(10,10,10,.4);backdrop-filter:blur(4px);z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px;animation:lrFade .2s}
.lr-settings-card{width:100%;max-width:420px;background:#fff;border:1px solid var(--border);border-radius:18px;padding:22px;backdrop-filter:none;box-shadow:0 12px 50px rgba(10,10,10,.2);animation:lrPopIn .3s cubic-bezier(.2,1.3,.4,1)}
.lr-settings-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.lr-settings-title{font-family:inherit;font-size:20px;font-weight:700;line-height:1;margin:0;color:var(--ink);letter-spacing:-.02em}
.lr-settings-close{background:var(--glass-strong);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-family:initial;font-size:16px;color:var(--ink);line-height:1}
.lr-settings-section{margin-bottom:18px}
.lr-settings-section-label{font-size:10px;letter-spacing:.6px;text-transform:uppercase;font-weight:800;color:var(--ink-2);margin-bottom:9px}
.lr-preset-edit-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.lr-preset-tag{display:inline-flex;align-items:center;gap:5px;padding:6px 4px 6px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:800;color:var(--ink)}
.lr-preset-tag-x{width:18px;height:18px;border-radius:50%;background:rgba(224,54,79,.12);color:var(--red);border:none;cursor:pointer;font-size:12px;line-height:1;display:grid;place-items:center;font-family:initial}
.lr-preset-tag-x:hover{background:rgba(224,54,79,.25)}
.lr-preset-add{display:flex;gap:5px;align-items:center;margin-left:4px}
.lr-preset-add input{width:64px;padding:6px 10px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--border);font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;color:var(--ink);outline:none}
.lr-preset-add input:focus{border-color:var(--ink)}
.lr-preset-add-btn{width:26px;height:26px;border-radius:50%;background:#0a0a0a;color:#fff;border:none;cursor:pointer;font-weight:800;font-size:16px;display:grid;place-items:center;font-family:initial;line-height:1}
.lr-settings-actions{display:flex;gap:8px;margin-top:8px}
.lr-settings-btn{flex:1;padding:12px 0;border-radius:12px;border:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.4px}
.lr-settings-btn-primary{background:#0a0a0a;color:#fff;box-shadow:none}
.lr-settings-btn-reset{background:var(--glass-strong);color:var(--ink-2);border:1px solid var(--border)}

@media (min-width:1024px){
  .lr-phone{max-width:1100px;padding-bottom:80px}
  .lr-topbar{padding:14px 32px}
  .lr-tabs{margin:0 32px 16px;max-width:540px;margin-left:auto;margin-right:auto}
  .lr-filters{padding:0 32px;max-width:1036px;margin-left:auto;margin-right:auto;justify-content:center;flex-wrap:wrap}
  .lr-status{max-width:540px;margin:12px auto 14px}
  .lr-feed{padding:0 32px;max-width:1036px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .lr-card{padding:16px}
  .lr-card-sym{font-size:20px}
  .lr-metrics{padding:12px 10px}
  .lr-metric-v{font-size:13px}
  .lr-orbs{padding:0 32px;max-width:760px;margin:0 auto 18px}
  .lr-feature{margin:0 32px 18px;max-width:760px;margin-left:auto;margin-right:auto;padding:20px}
  .lr-feature-sym{font-size:30px}
  .lr-feature-avatar{width:64px;height:64px}
  .lr-orb-val{font-size:18px}
  .lr-orb-val.lr-orb-mono{font-size:15px}
}
@media (min-width:1440px){
  .lr-phone{max-width:1320px}
  .lr-feed{max-width:1256px;grid-template-columns:repeat(3,1fr)}
}

@media (max-width:430px){
  .lr-status{margin:12px 14px;padding:8px 12px;font-size:10px;gap:10px}
  .lr-tabs{margin:0 14px 12px}
  .lr-filters{padding:0 14px}
  .lr-feed{padding:0 14px}
  .lr-orbs{padding:0 14px;gap:6px}
  .lr-orb{padding:10px 4px 9px}
  .lr-orb-emoji{font-size:16px}
  .lr-orb-val{font-size:15px}
  .lr-orb-val.lr-orb-mono{font-size:13px}
  .lr-feature{margin:0 14px 14px;padding:14px}
  .lr-feature-sym{font-size:22px}
  .lr-feature-avatar{width:48px;height:48px}
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
   CONFIG — pump.fun bonding curve only. 3% SOL fee → FEE_WALLET, atomic
   in the same signed tx. No ATAs touched on the fee side — pure
   SystemProgram.transfer of lamports. The pump SDK on the server
   handles the token ATA for the trade itself.
   ════════════════════════════════════════════════════════════════════ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;   // 3%

// Cushion for tx + priority fees + the pump SDK's own associated-token-account
// creation rent on a first buy of a new mint. ATA rent (~0.00204 SOL) is paid
// by the user but goes to their OWN token account — not a real loss.
const SOL_RESERVE = 0.01;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

// ── RPC ──────────────────────────────────────────────────────────────
// /api/solana-rpc — Alchemy mainnet only. Used for everything EXCEPT the
// buy/sell submit path: balances, SOL price, the launch feed. The server
// (server.js) holds the Alchemy API key and forwards.
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';

// /api/trade-rpc — Alchemy primary, Ankr fallback. Used ONLY by the buy/sell
// critical path inside executeSwap (ALT lookup, getLatestBlockhash,
// simulateTransaction, sendRawTransaction, getSignatureStatus, getBlockHeight).
// This is the only place in the file that exercises the Ankr fallback.
const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';

const BAL_COMMITMENT = 'processed';


const _connCache = new Map();
const getConn = (commitment, url = RPC_URL) => {
  const key = url + '|' + commitment;
  let c = _connCache.get(key);
  if (!c) { c = new Connection(url, commitment); _connCache.set(key, c); }
  return c;
};

// Trade-path connection — /api/trade-rpc (Alchemy primary, Ankr fallback).
// Separate cache so it never collides with the general-purpose connection.
const _tradeConnCache = new Map();
const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};

// Single-RPC wrapper. Keeps the same `(op) => Promise` signature so existing
// call sites like `balRpcRace(c => c.getBalance(...))` work unchanged.
const balRpcRace = (op) => op(getConn(BAL_COMMITMENT));

const POLL_RECENT  = 5_000;
const POLL_SOL     = 30_000;
const POLL_BALANCE = 30_000;

/* ════════════════════════════════════════════════════════════════════
   FORMATTERS
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

export function _uniqMint(list) {
  const seen = new Set();
  return list.filter(t => t && t.mint && !seen.has(t.mint) && seen.add(t.mint));
}
// Robust 24h %: read every field name a Solana feed uses for it.
function pickChange(t) {
  const v = Number(
    t?.priceChange24h ?? t?.priceChange?.h24 ?? t?.stats24h?.priceChange ??
    t?.change24h ?? t?.change ?? t?.priceChangePercent24h ?? t?.h24 ?? 0,
  );
  return Number.isFinite(v) ? v : 0;
}
// Robust price: a new token ALWAYS has a price — read every field name the feed
// might use, and if only market cap + supply came through, derive it (real, not
// invented). Returns a positive number whenever ANY pricing data exists.
function pickPrice(t) {
  const direct = Number(
    t?.price ?? t?.priceUsd ?? t?.usdPrice ?? t?.price_usd ??
    t?.priceUSD ?? t?.usd ?? t?.priceNative ?? t?.lastPrice ??
    t?.stats24h?.price ?? t?.firstPool?.price ?? 0,
  );
  if (direct > 0) return direct;
  const mc = Number(t?.mcap ?? t?.marketCap ?? t?.fdv ?? t?.marketCapUsd ?? 0);
  const supply = Number(t?.supply ?? t?.totalSupply ?? t?.circulatingSupply ?? t?.circSupply ?? 0);
  if (mc > 0 && supply > 0) return mc / supply;
  return 0;
}
function normalize(t) {
  const rawMint = t?.mint;
  if (!rawMint || typeof rawMint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawMint)) {
    return null;
  }
  const am = ageMs(t.pairCreatedAt);
  return {
    mint:      rawMint,
    sym:       t.sym || '???',
    name:      t.name || t.sym || 'Unknown',
    emoji:     emojiFor(t.sym || ''),
    icon:      t.icon || null,
    price:     pickPrice(t),
    change:    pickChange(t),
    age:       ageStr(am),
    ageMs:     am,
    mcap:      Number(t.mcap || t.fdv || 0),
    volume24h: Number(t.volume24h || 0),
    holders:   Number(t.holders || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    pumpPool:  t.pumpPool || 'auto',
    dexId:     t.dexId || null,
    pool:      t.pairAddress || t.poolAddress || t.pool || t.poolId || t.pairId || (t.firstPool && (t.firstPool.id || t.firstPool.address)) || null,
    source:    'launches',
  };
}

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('user reject') || m.includes('user denied') || m.includes('cancelled') || m.includes('request rejected')) return 'Cancelled.';
  if (m.includes('graduat')) return 'Token graduated off the bonding curve — not tradable here.';
  if (m.includes('not a pump') || m.includes('not indexed')) return 'Not a pump.fun bonding-curve token.';
  if (m.includes('slippage')) return 'Price moved past slippage — try again.';
  if (m.includes('insufficient') || m.includes('debit an account')) return 'Not enough SOL for this trade + fees.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Tx expired — retry.';
  if (m.includes("didn't confirm") || m.includes('not confirm')) return "Sent but didn't confirm — check Solscan before retrying.";
  if (m.includes('simulation failed')) return 'Trade would fail right now — price likely moved.';
  if (m.includes('incorrectprogramid')) return "Pump SDK fee-config stale — try again. If it keeps happening, the server RPC is rate-limited.";
  if (m.includes('rate')) return 'Rate limited — try again.';
  return err?.message?.slice(0, 200) || 'Trade failed.';
};

function describeSimLogs(logs, fallbackMsg) {
  const arr = Array.isArray(logs) ? logs : [];
  const j = arr.join('\n').toLowerCase();
  if (j.includes('slippage') || j.includes('toomuchsol') || j.includes('toolittlesol'))
    return 'Price moved past slippage — try again.';
  if (j.includes('insufficient') || j.includes('debit an account')) return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '').replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed → ' + ctx;
  return fallbackMsg ? ('Sim failed → ' + String(fallbackMsg).slice(0, 160)) : 'Sim failed (no logs returned).';
}

/* ════════════════════════════════════════════════════════════════════
   PUMP.FUN TRADE via PumpPortal — server returns a built v0 tx as
   base64. Client decompiles it (fetching any address-lookup tables),
   splices in the 3% SOL fee, recompiles with a fresh blockhash, signs,
   sends. The ALT lookup here runs on the trade connection (passed in).
   ════════════════════════════════════════════════════════════════════ */
async function decodeBuiltTx(b64, connection) {
  const txBytes = Buffer.from(b64, 'base64');
  const tx      = VersionedTransaction.deserialize(txBytes);
  const message = tx.message;
  const lookupKeys = (message.addressTableLookups || []).map(l => l.accountKey);
  const alts = [];
  if (lookupKeys.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(lookupKeys);
    for (let i = 0; i < lookupKeys.length; i++) {
      if (!infos[i]) continue;
      alts.push(new AddressLookupTableAccount({
        key:   lookupKeys[i],
        state: AddressLookupTableAccount.deserialize(infos[i].data),
      }));
    }
  }
  const decompiled = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: alts,
  });
  return { instructions: decompiled.instructions, alts };
}

async function getPumpRoute({ action, mint, user, amount, decimals, connection }) {
  const body = {
    action,
    mint,
    user:   user.toBase58(),
    amount: String(amount),
  };
  if (decimals != null) body.decimals = Number(decimals);

  const r = await fetch('/api/pumpfun/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || ('pump HTTP ' + r.status));
  if (!data.tx) throw new Error('PumpPortal returned no tx.');

  const { instructions, alts } = await decodeBuiltTx(data.tx, connection);
  try {
    console.log('[lr-pump]', action, '| pool:', data.pool,
      '| ixs:', instructions.length, '| alts:', alts.length,
      '| slippage:', data.slippagePct + '%');
  } catch {}
  return { instructions, alts, pool: data.pool, route: data.route };
}

/* ════════════════════════════════════════════════════════════════════
   TWITTER SHARE
   ════════════════════════════════════════════════════════════════════ */
function buildShareUrl() {
  if (typeof window === 'undefined') return '';
  try { return new URL(window.location.origin + window.location.pathname).toString(); }
  catch { return ''; }
}
function buildTweetText({ mode, token, solAmount, outAmount, percentage }) {
  if (mode === 'buy') {
    const recv = outAmount > 0 ? '\n→ ' + formatTokens(outAmount) + ' $' + token.sym : '';
    return 'Just aped ' + solAmount + ' SOL into $' + token.sym + ' on Wonderland Radar 🍭' + recv + '\n\nFresh launch sniped:';
  }
  const got = outAmount > 0 ? '\n→ ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Just sold ' + percentage + '% of my $' + token.sym + ' on Wonderland Radar 💸' + got + '\n\nFresh launches every minute:';
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
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

/* ════════════════════════════════════════════════════════════════════
   TOKEN ICON
   ════════════════════════════════════════════════════════════════════ */
const _iconCache = new Map();
const _iconPending = new Map();

async function resolveIconFromDex(mint) {
  if (!mint) return null;
  if (_iconCache.has(mint)) return _iconCache.get(mint);
  if (_iconPending.has(mint)) return _iconPending.get(mint);
  const p = (async () => {
    try {
      const r = await fetch('/api/dex/token/' + encodeURIComponent(mint));
      if (!r.ok) { _iconCache.set(mint, null); return null; }
      const data = await r.json();
      const url = data?.token?.icon || null;
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
    if (_iconCache.has(token.mint)) {
      setResolved(_iconCache.get(token.mint));
      return;
    }
    let alive = true;
    resolveIconFromDex(token.mint).then(url => { if (alive) setResolved(url); });
    return () => { alive = false; };
  }, [token?.mint, directUrl]);
  return resolved;
}

// ── Token detail chart ──────────────────────────────────────────────
// Resolves a mint → its best pool and embeds a candlestick chart.
//
// Provider: CoinGecko (GeckoTerminal) ONLY — it indexes pump.fun
// BONDING-CURVE pools as well as graduated pairs. No DexScreener.
//
// Two hard rules:
//   • Contract match: ONLY accept a pool whose BASE token is exactly this
//     mint. A pool where the mint is the quote charts the WRONG token, so
//     there is no quote-side fallback — no match means no chart.
//   • Highest liquidity: among matching pools, pick the deepest by USD
//     liquidity (reduce seeded with the first so a brand-new 0-liquidity
//     pool still charts).

// GeckoTerminal: pools come back with relationships.base_token.data.id of
// the form "solana_<mint>" and attributes.{address, reserve_in_usd}.
function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = 'solana_' + mint;                        // EXACT — Solana base58 is case-sensitive
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const hasAddr = p => !!p?.attributes?.address;

  // Contract MUST match: only pools where this mint is the BASE token.
  const pool = pools.filter(p => hasAddr(p) && baseId(p) === wanted);
  if (!pool.length) return null;
  return pool.reduce(
    (best, p) =>
      (Number(p?.attributes?.reserve_in_usd) || 0) > (Number(best?.attributes?.reserve_in_usd) || 0) ? p : best,
    pool[0],
  );
}


/* ════════════════════════════════════════════════════════════════════
   EMBEDDED CHART — CoinGecko (GeckoTerminal) ONLY. Base-token pool match
   (contract MUST match), resolution pills, 1s default. No DexScreener.
   ════════════════════════════════════════════════════════════════════ */
const LR_CHART_RES = [
  { key: '1s',  label: '1s', gecko: '1s',  dex: '1S'  },
  { key: '15s', label: '15s', gecko: '15s', dex: '15S' },
  { key: '1m',  label: '1m', gecko: '1m',  dex: '1'   },
  { key: '5m',  label: '5m', gecko: '5m',  dex: '5'   },
  { key: '1h',  label: '1H', gecko: '1h',  dex: '60'  },
];
const LR_RES_DEFAULT = '1s';

function lrBuildEmbedSrc(pool, resKey) {
  if (!pool) return null;
  const r = LR_CHART_RES.find(x => x.key === resKey) || LR_CHART_RES[0];
  if (pool.provider !== 'GECKOTERMINAL') return null;
  return 'https://www.geckoterminal.com/solana/pools/' + pool.addr +
    '?embed=1&info=0&swaps=0&grayscale=0&light_chart=1&bg_color=ffffff&resolution=' + r.gecko;
}

function LrTokenChart({ mint, symbol = '', poolHint = null }) {
  const [status, setStatus] = useState('loading'); // loading | ok | none | fail
  const [pool, setPool]     = useState(null);       // { provider, addr }
  const [res, setRes]       = useState(LR_RES_DEFAULT);
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);

  // Reset to the 1s view each time a different token opens.
  useEffect(() => { setRes(LR_RES_DEFAULT); }, [mint]);

  useEffect(() => {
    if (!mint) { setStatus('none'); setPool(null); return; }
    const id = ++reqRef.current;
    // Feed already gave us a contract-matched pool → chart immediately.
    if (poolHint && typeof poolHint === 'string') {
      setPool({ provider: 'GECKOTERMINAL', addr: poolHint }); setStatus('ok'); return;
    }
    setStatus('loading'); setPool(null);

    (async () => {
      let networkOk = false;

      // GeckoTerminal only — covers pump.fun bonding-curve pools and graduated pairs.
      try {
        const r = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools`,
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
      } catch {}
      if (id !== reqRef.current) return;

      // No pool. If GeckoTerminal responded, the token just isn't indexed yet
      // (typical for a seconds-old bonding curve); otherwise it's a network failure.
      setStatus(networkOk ? 'none' : 'fail');
    })();
  }, [mint, poolHint]);

  const src = useMemo(() => lrBuildEmbedSrc(pool, res), [pool, res]);
  const shortCa = mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : '';
  const copyCa = async () => {
    try { await navigator.clipboard.writeText(mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
  };

  return (
    <div className="lr-chart">
      <div className="lr-chart-bar">
        <div className="lr-chart-ca">
          <span className="lr-chart-ca-l">CA</span>
          <span className="lr-chart-ca-v">{shortCa}</span>
          <button type="button" className="lr-chart-ca-copy" onClick={copyCa}>{copied ? 'COPIED' : 'COPY'}</button>
        </div>
        <span className="lr-chart-src">{pool?.provider || 'CHART'}</span>
      </div>
      {status === 'ok' && src ? (
        <div className="lr-chart-frame-wrap">
          <iframe key={pool.provider + pool.addr + res} className="lr-chart-frame" src={src} title={(symbol || 'Token') + ' price chart'}
            loading="lazy" allow="clipboard-write" />
        </div>
      ) : status === 'loading' ? (
        <div className="lr-chart-state"><div className="lr-chart-spin" /></div>
      ) : status === 'none' ? (
        <div className="lr-chart-state">Chart appears once {symbol || 'this token'} is indexed — trading on the bonding curve for now.</div>
      ) : (
        <div className="lr-chart-state">Couldn’t load the chart. Try again shortly.</div>
      )}
      <div className="lr-tf-pills">
        {LR_CHART_RES.map(r => (
          <button key={r.key} className={'lr-tf' + (r.key === res ? ' on' : '')} disabled={status !== 'ok'} onClick={() => setRes(r.key)}>{r.label}</button>
        ))}
        <span className="lr-tf-meta">{status === 'ok' ? '● Live · ' + ((LR_CHART_RES.find(x => x.key === res) || {}).label || '') : 'Live'}</span>
      </div>
    </div>
  );
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
    <img
      src={url}
      alt={token.sym || ''}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
      onError={() => setErrored(true)}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════
   PRESETS
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
   SETTINGS MODAL
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
                <button className="lr-preset-tag-x" onClick={() => removeBuy(v)} aria-label={'Remove ' + v}>×</button>
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
                <button className="lr-preset-tag-x" onClick={() => removeSell(v)} aria-label={'Remove ' + v}>×</button>
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
   TRADE MODAL
     BUY  : user enters X SOL. Trade portion sent to server = 0.97 X.
            Client prepends SystemProgram.transfer of 0.03 X SOL to
            FEE_WALLET. Total wallet debit = X.
     SELL : user enters % of holding. Full token amount goes to the
            pump curve. Client appends SystemProgram.transfer of 3%
            of expectedSol to FEE_WALLET, after the curve has paid
            native SOL into the user's wallet.
   ════════════════════════════════════════════════════════════════════ */
function TradeModal({
  token, initialMode, onClose, onConfirm,
  buyPresets, sellPresets,
  solBalance, tokenBalance, solPrice,
}) {
  const [mode, setMode] = useState(initialMode || 'buy');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setAmount(''); setError(null); }, [mode]);
  useEffect(() => { setError(null); }, [amount]);

  const isBuy = mode === 'buy';
  const presets = isBuy ? buyPresets : sellPresets;

  // BUY  → user enters X SOL.
  //   totalLamports = X * 1e9               (wallet debit = X)
  //   tradeLamports = floor(X * 1e9 * 0.97) (to pump curve via server)
  //   feeLamports   = totalLamports - tradeLamports  (to FEE_WALLET)
  // SELL → user enters percent.
  //   tradeTokens   = pct% of holding (raw units) → full sell
  //   fee in SOL is computed AFTER server returns expectedSol
  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;

    if (isBuy) {
      const totalLamports = BigInt(Math.floor(n * 1e9));
      if (totalLamports <= 0n) return null;
      // Pump curve is exact-out-tokens, max-in-SOL. Server slippage = 10% means
      // the curve may pull up to 1.10× what we send. We need:
      //   feeLamports + tradeLamports * 1.10 ≤ totalLamports
      // So size the curve send accordingly.
      const feeLamports   = (totalLamports * BigInt(FEE_BPS)) / 10000n;
      const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
      if (tradeLamports <= 0n || feeLamports <= 0n) return null;
      return {
        mode: 'buy',
        solAmount: n,
        totalLamports: totalLamports.toString(),
        tradeLamports: tradeLamports.toString(),
        feeLamports:   feeLamports.toString(),
      };
    }

    if (!tokenBalance || !tokenBalance.amount || BigInt(tokenBalance.amount) <= 0n) return null;
    const pct = Math.min(100, Math.max(0.01, n));
    const tradeTokens = (BigInt(tokenBalance.amount) * BigInt(Math.floor(pct * 100))) / 10000n;
    if (tradeTokens <= 0n) return null;
    const decimals = tokenBalance.decimals || token.decimals || 6;
    // SELL fee (in SOL) — client-side estimate from token.price and solPrice.
    // PumpPortal's built tx doesn't return an expected-output value, so we
    // compute the fee from current price feeds. The appended SystemProgram
    // transfer runs AFTER the curve pays native SOL into the wallet, so the
    // wallet just needs `feeLamports - actual_sol_out` worth of pre-trade SOL
    // headroom — and `actual_sol_out` is usually within a few % of estimate.
    const tradeTokensUi = Number(tradeTokens) / Math.pow(10, decimals);
    let feeLamports = '0';
    if (token?.price > 0 && solPrice > 0) {
      const grossSol = (tradeTokensUi * token.price) / solPrice;
      const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
      if (lam > 0) feeLamports = String(lam);
    }
    return {
      mode: 'sell',
      decimals,
      percentage: pct,
      tradeTokens:   tradeTokens.toString(),
      tradeTokensUi,
      feeLamports,
    };
  }, [amount, isBuy, token, tokenBalance, solPrice]);

  // Display estimate from the current price feed; the on-chain amount comes
  // from the pump curve at sign-time. Marked "(est.)".
  const estReceive = useMemo(() => {
    if (!swapParams || !(token?.price > 0) || !(solPrice > 0)) return null;
    if (swapParams.mode === 'buy') {
      const tradeSol = Number(swapParams.tradeLamports) / 1e9;
      const tokens = (tradeSol * solPrice) / token.price;
      return tokens > 0 ? { tokens } : null;
    }
    const grossSol = (swapParams.tradeTokensUi * token.price) / solPrice;
    const netSol   = grossSol * (1 - FEE_BPS / 10000);
    return netSol > 0 ? { sol: netSol } : null;
  }, [swapParams, token?.price, solPrice]);

  const ownedUiAmount = tokenBalance?.uiAmount || 0;
  const availSol = Math.max(0, (solBalance?.uiAmount || 0)); // no reserve

  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return Number(amount) <= availSol;
    return ownedUiAmount > 0;
  })();

  const handleConfirm = async () => {
    if (!swapParams || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirm({ mode, swapParams, token });
    } catch (e) {
      setError(friendlyError(e));
      setConfirming(false);
    }
  };

  const setMaxBuy = () => {
    if (!isBuy || availSol <= 0) return;
    setAmount(String(Math.floor(Math.max(0, availSol - 0.002) * 10000) / 10000));
  };

  const confirmDisabled = confirming || !swapParams || !hasFunds || !!error;

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

        <LrTokenChart mint={token.mint} symbol={token.sym} poolHint={token.pool} />

        <div className={'lr-trade-mode-tabs' + (mode === 'sell' ? ' lr-mode-sell' : '')}>
          <div className="lr-trade-mode-indicator" />
          <button type="button"
            className={'lr-trade-mode-tab' + (mode === 'buy' ? ' lr-active' : '')}
            onClick={() => setMode('buy')}>🍭 BUY</button>
          <button type="button"
            className={'lr-trade-mode-tab' + (mode === 'sell' ? ' lr-active' : '')}
            onClick={() => setMode('sell')}>💸 SELL</button>
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
                {isBuy ? (<><span className="lr-trade-token-chip-logo">◎</span><span>SOL</span></>)
                       : (<><span className="lr-trade-token-chip-logo"><TokenIcon token={token} /></span><span>{token.sym}</span></>)}
              </div>
              <input
                type="text" inputMode="decimal"
                placeholder={isBuy ? '0.00' : '0'}
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, '');
                  const parts = v.split('.');
                  if (parts.length > 2) return;
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
                <button key={v} type="button"
                  className={'lr-trade-preset' + (active ? ' lr-active' : '')}
                  onClick={() => setAmount(String(v))}>
                  {isBuy ? (v + ' SOL') : (v + '%')}
                </button>
              );
            })}
          </div>

          {swapParams && Number(amount) > 0 && (
            <div className="lr-trade-details">
              <div className="lr-trade-detail-row">
                <span>Route</span>
                <span className="lr-trade-detail-val">pump.fun bonding curve</span>
              </div>
              {isBuy ? (
                <>
                  <div className="lr-trade-detail-row">
                    <span>To curve</span>
                    <span className="lr-trade-detail-val">
                      {formatSol(Number(swapParams.tradeLamports) / 1e9)} SOL
                    </span>
                  </div>
                  <div className="lr-trade-detail-row">
                    <span>Platform fee (3%)</span>
                    <span className="lr-trade-detail-val">
                      {formatSol(Number(swapParams.feeLamports) / 1e9)} SOL
                    </span>
                  </div>
                  <div className="lr-trade-detail-row">
                    <span>Wallet pays</span>
                    <span className="lr-trade-detail-val">
                      {formatSol(Number(swapParams.totalLamports) / 1e9)} SOL
                    </span>
                  </div>
                  <div className="lr-trade-detail-row">
                    <span>You receive (est.)</span>
                    <span className="lr-trade-detail-val lr-good">
                      {estReceive?.tokens > 0 ? '≈ ' + formatTokens(estReceive.tokens) + ' ' + token.sym : '—'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="lr-trade-detail-row">
                    <span>Selling</span>
                    <span className="lr-trade-detail-val">
                      {formatTokens(swapParams.tradeTokensUi)} {token.sym}
                      <span style={{ marginLeft: 6, color: 'var(--ink-2)', fontWeight: 600 }}>
                        ({Math.min(100, Number(amount)).toFixed(0)}%)
                      </span>
                    </span>
                  </div>
                  <div className="lr-trade-detail-row">
                    <span>Platform fee (3%)</span>
                    <span className="lr-trade-detail-val">
                      ≈ {estReceive?.sol > 0 ? formatSol((estReceive.sol / (1 - FEE_BPS/10000)) * (FEE_BPS/10000)) : '—'} SOL
                    </span>
                  </div>
                  <div className="lr-trade-detail-row">
                    <span>You receive (est.)</span>
                    <span className="lr-trade-detail-val lr-good">
                      {estReceive?.sol > 0 ? '≈ ' + formatSol(estReceive.sol) + ' SOL' : '—'}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="lr-trade-banner lr-trade-banner-error">{error}</div>
          )}

          <button type="button"
            className={'lr-trade-confirm ' + (isBuy ? 'lr-mode-buy' : 'lr-mode-sell')}
            disabled={confirmDisabled}
            onClick={handleConfirm}>
            {confirming
              ? (isBuy ? 'Buying…' : 'Selling…')
              : !amount || Number(amount) <= 0
                ? (isBuy ? 'Enter SOL amount' : 'Enter percentage')
                : !hasFunds
                  ? (isBuy
                      ? 'Insufficient SOL'
                      : ('No ' + token.sym + ' to sell'))
                  : (isBuy ? ('🍭 Buy ' + amount + ' SOL of $' + token.sym)
                           : ('💸 Sell ' + Math.min(100, Number(amount)) + '% of $' + token.sym))}
          </button>

          <p className="lr-trade-footer">
            Routed via <b style={{ color: 'var(--ink)' }}>pump.fun</b> · Your keys, your coins
          </p>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LAUNCH CARD
   ════════════════════════════════════════════════════════════════════ */
// Card sparkline — REAL DATA ONLY (mirrors MemeWonderland). Sources: OHLCV via
// stkFetchSeries (contract-matched, highest-liquidity, cached + throttled) and
// the live observed price the feed polls. No synthetic fallback — nothing draws
// until real data exists.
const _lrSparkHist = new Map();
function lrRecordSpark(mint, price) {
  if (!mint || !(price > 0)) return _lrSparkHist.get(mint) || [];
  let pts = _lrSparkHist.get(mint);
  if (!pts) { pts = []; _lrSparkHist.set(mint, pts); }
  if (pts[pts.length - 1] !== price) { pts.push(price); if (pts.length > 32) pts.shift(); }
  return pts;
}
function LrSparkline({ mint, price, change, pool, w = 280, h = 40, full = true }) {
  const [series, setSeries] = useState(null);
  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    stkThrottle(() => stkFetchSeries(mint, '1D', pool))
      .then(s => { if (!cancelled && Array.isArray(s) && s.length >= 2) setSeries(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mint, pool]);
  const hist = lrRecordSpark(mint, Number(price));
  const obs = hist.length >= 2 ? hist.map(c => ({ c })) : null;
  // REAL data, in priority: GeckoTerminal OHLCV → live observed ticks → the two
  // real endpoints from price + 24h change. Always a line the moment a price
  // exists; OHLCV upgrades it in place. Never synthetic, never blank.
  const pts = (series && series.length >= 2) ? series
            : (obs || stkEndpointSeries(price, change));
  if (!pts) return null;
  const path = stkSmoothPath(pts, w, h, 2, stkSeed(mint));
  const up = Number.isFinite(change) ? change >= 0 : path.up;
  const col = up ? 'var(--green)' : 'var(--red)';
  const id = 'lrs' + (up ? 'u' : 'd') + (mint ? String(mint).slice(0, 8) : '');
  return (
    <svg width={full ? '100%' : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', marginTop: 10, overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity={up ? '0.28' : '0.22'} /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <path d={path.area} fill={`url(#${id})`} />
      <path d={path.line} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.lastX.toFixed(2)} cy={path.lastY.toFixed(2)} r="2.1" fill={col} />
    </svg>
  );
}

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
          <div className="lr-card-price">
            {formatPrice(token.price)}
          </div>
          {Number.isFinite(token.change) && token.change !== 0 ? (
            <div className={'lr-card-change' + (token.change < 0 ? ' lr-down' : '')}>{formatPct(token.change)}</div>
          ) : null}
        </div>
      </div>

      <LrSparkline mint={token.mint} price={token.price} change={token.change} pool={token.pool} />

      <div className="lr-metrics">
        <div className="lr-metric"><div className="lr-metric-l">Liq</div>
          <div className="lr-metric-v">{token.liquidity > 0 ? '$' + format(token.liquidity) : '—'}</div></div>
        <div className="lr-metric"><div className="lr-metric-l">MCap</div>
          <div className="lr-metric-v">{token.mcap > 0 ? '$' + format(token.mcap) : '—'}</div></div>
        <div className="lr-metric"><div className="lr-metric-l">Holders</div>
          <div className="lr-metric-v">{token.holders > 0 ? format(token.holders) : '—'}</div></div>
        <div className="lr-metric"><div className="lr-metric-l">Signal</div>
          <div className="lr-metric-v lr-mint-text">{signalScore(token)}</div></div>
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
        <button type="button" className="lr-card-btn lr-card-buy" onClick={() => onBuy(token)}>🍭 BUY</button>
        <button type="button" className="lr-card-btn lr-card-sell" onClick={() => onSell(token)}>💸 SELL</button>
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
  // General-purpose connection — /api/solana-rpc (Alchemy only). Balances,
  // SOL price, the launch feed.
  const connection = useMemo(() => getConn('confirmed'), []);
  // Trade-path connection — /api/trade-rpc (Alchemy primary, Ankr fallback).
  // Used ONLY by executeSwap. This is the only Ankr-fallback path in the file.
  const tradeConnection = useMemo(() => getTradeConn('confirmed'), []);

  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(null);
  const [lane, setLane] = useState('fresh');
  const [timeFilter, setTimeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const freshThresholdMs = 30 * 60_000;

  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);
  // Chart-window % from the same 1D series the sparkline draws, so the displayed
  // % matches the chart (derived from the same GeckoTerminal OHLCV the sparkline draws).
  const [chartChg, setChartChg] = useState({});   // mint -> %
  const chgTsRef = useRef(new Map());              // mint -> last fetch ts
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) {
          if (!cancelled) {
            setRecentError('Launch feed unreachable (HTTP ' + r.status + ')');
            setRecentLoading(false);
          }
          return;
        }
        const d = await r.json();
        const list = Array.isArray(d?.tokens) ? d.tokens : [];
        if (!cancelled) {
          setRecentTokens(_uniqMint(list.map(normalize).filter(Boolean)));
          setRecentLoading(false);
          setRecentError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRecentError(String(e?.message || 'Launch feed unreachable').slice(0, 120));
          setRecentLoading(false);
        }
      }
    }
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Chart-window % from the same 1D OHLCV the sparkline uses (throttled, ≤ once/45s per mint).
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    recentTokens.forEach(t => {
      const mint = t.mint;
      if (!mint) return;
      const last = chgTsRef.current.get(mint) || 0;
      if (now - last < 45000) return;
      chgTsRef.current.set(mint, now);
      stkThrottle(() => stkFetchSeries(mint, '1D', t.pool))
        .then(s => {
          if (cancelled || !Array.isArray(s) || s.length < 2) return;
          const first = Number(s[0]?.c), lastC = Number(s[s.length - 1]?.c);
          if (!(first > 0) || !Number.isFinite(lastC)) return;
          const pct = ((lastC - first) / first) * 100;
          setChartChg(prev => (Math.abs((prev[mint] ?? NaN) - pct) < 0.01 ? prev : { ...prev, [mint]: pct }));
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [recentTokens]);

  const [solPrice, setSolPrice] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/dex/sol-price');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d?.price) setSolPrice(d.price);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
    const solP = balRpcRace(c => c.getBalance(owner, BAL_COMMITMENT))
      .then(lamports => {
        setBalances(prev => ({
          ...prev,
          [SOL_MINT]: { amount: String(lamports), decimals: 9, uiAmount: lamports / 1e9 },
        }));
      })
      .catch(e => console.warn('[lr] SOL balance failed', e?.message));
    const tokP = balRpcRace(c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT))
      .then(accs => {
        setBalances(prev => { const next = { ...prev }; mergeAccs(next, accs); return next; });
      })
      .catch(e => console.warn('[lr] SPL accounts failed', e?.message));
    const tok22P = balRpcRace(c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT))
      .then(accs => {
        setBalances(prev => { const next = { ...prev }; mergeAccs(next, accs); return next; });
      })
      .catch(e => console.warn('[lr] Token-2022 accounts failed', e?.message));
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

  const refreshOneToken = useCallback(async (mintStr) => {
    if (!wallet.publicKey || !mintStr || mintStr === SOL_MINT) return;
    const owner = wallet.publicKey;
    let mintPk;
    try { mintPk = new PublicKey(mintStr); } catch { return; }
    try {
      const accs = await balRpcRace(c =>
        c.getParsedTokenAccountsByOwner(owner, { mint: mintPk }, BAL_COMMITMENT));
      let best = null;
      for (const acc of (accs?.value || [])) {
        const info = acc.account?.data?.parsed?.info;
        const amt = info?.tokenAmount?.amount;
        if (amt == null) continue;
        const ui = Number(info.tokenAmount?.uiAmount || 0);
        if (!best || ui > best.uiAmount) {
          best = {
            amount:   String(amt),
            decimals: Number(info.tokenAmount?.decimals ?? 6),
            uiAmount: ui,
          };
        }
      }
      if (best) setBalances(prev => ({ ...prev, [mintStr]: best }));
      else      setBalances(prev => ({ ...prev, [mintStr]: { amount: '0', decimals: 6, uiAmount: 0 } }));
    } catch (e) {
      console.warn('[lr] single-token balance failed', e?.message);
    }
  }, [wallet.publicKey]);

  const refreshSol = useCallback(async () => {
    if (!wallet.publicKey) return;
    const owner = wallet.publicKey;
    try {
      const lamports = await balRpcRace(c => c.getBalance(owner, BAL_COMMITMENT));
      setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(lamports), decimals: 9, uiAmount: lamports / 1e9 } }));
    } catch (e) { console.warn('[lr] SOL balance failed', e?.message); }
  }, [wallet.publicKey]);

  const solBalance = balances[SOL_MINT];

  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration || 8000);
  }, []);

  const requireWallet = useCallback(() => {
    if (wallet.publicKey && wallet.signTransaction) return true;
    if (onConnectWallet) { onConnectWallet(); return false; }
    pushToast({ kind: 'error', emoji: '🔌', body: 'Connect a wallet first (Phantom, Solflare, Backpack).' });
    return false;
  }, [wallet.publicKey, wallet.signTransaction, onConnectWallet, pushToast]);

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
     executeSwap — PumpPortal pump.fun/PumpSwap. The submit path runs on
     `tradeConnection` (/api/trade-rpc, Alchemy primary + Ankr fallback):
       1. POST /api/pumpfun/trade → built v0 tx (base64) including
          PumpPortal's own compute-budget priority fee. The ALT lookup
          inside decodeBuiltTx uses tradeConnection.
       2. decodeBuiltTx: deserialize, fetch any ALTs, decompile to a
          flat instruction list.
       3. Build the 3% SOL fee transfer:
            BUY  → 3% of entered SOL (already in swapParams.feeLamports)
            SELL → 3% of estimated SOL out (computed from price feeds
                   in swapParams.feeLamports; appended AFTER curve pays
                   native SOL to wallet).
       4. Splice the fee transfer:
            BUY  → after the leading compute-budget ixs, before swap
            SELL → at the very end
       5. Compile v0 with fresh blockhash and the SAME ALTs.
       6. Pre-sign simulateTransaction — if it fails, modal shows the
          on-chain reason and Phantom never opens.
       7. Sign once, send skipPreflight, rebroadcast until confirmed
          or blockhash expires.
     All RPC in this function uses tradeConnection so the Ankr fallback
     covers the entire buy/sell critical path.
     ════════════════════════════════════════════════════════════════ */
  const executeSwap = useCallback(async ({ mode, swapParams, token }) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      throw new Error('Please connect a wallet (Phantom, Solflare, Backpack).');
    }
    if (!swapParams) throw new Error('Nothing to trade.');

    const isBuy  = mode === 'buy';
    const userPk = wallet.publicKey;

    // 1. PumpPortal builds the tx; we decompile it locally. ALT lookup runs
    //    on the trade connection.
    const route = await getPumpRoute({
      action: isBuy ? 'buy' : 'sell',
      mint:   token.mint,
      user:   userPk,
      amount: isBuy ? swapParams.tradeLamports : swapParams.tradeTokens,
      decimals: isBuy ? undefined : swapParams.decimals,
      connection: tradeConnection,
    });

    // 2. Build the 3% SOL fee transfer.
    const feeLamports = BigInt(swapParams.feeLamports || '0');
    if (feeLamports <= 0n) {
      throw new Error(isBuy
        ? 'Fee rounds to zero — amount too small.'
        : 'Could not estimate sell fee — token or SOL price unavailable.');
    }
    const feeIx = SystemProgram.transfer({
      fromPubkey: userPk,
      toPubkey:   FEE_WALLET,
      lamports:   Number(feeLamports),
    });

    // 3. Splice. PumpPortal's tx already includes its own ComputeBudget
    //    instructions at the start — we insert AFTER them so they keep
    //    setting the priority fee for the whole tx.
    const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    const ixs = route.instructions.slice();
    if (isBuy) {
      let insertAt = 0;
      while (insertAt < ixs.length && ixs[insertAt].programId.toBase58() === CB_PROGRAM) insertAt++;
      ixs.splice(insertAt, 0, feeIx);
    } else {
      ixs.push(feeIx);
    }

    // 4. Fresh blockhash, recompile with the SAME ALTs PumpPortal used.
    const latest = await tradeConnection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey:        userPk,
      recentBlockhash: latest.blockhash,
      instructions:    ixs,
    }).compileToV0Message(route.alts);
    const tx = new VersionedTransaction(message);

    // 5. Pre-sign simulation against fresh chain state. Catches stale
    //    bonding-curve state, slippage failures, balance shortfalls —
    //    without spending a Phantom popup.
    let simLogs = null;
    try {
      const sim = await tradeConnection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'processed',
      });
      simLogs = sim?.value?.logs || null;
      if (sim?.value?.err) {
        console.error('[lr-sim] failed:', JSON.stringify(sim.value.err),
          simLogs ? '\n' + simLogs.join('\n') : '');
        throw new Error(describeSimLogs(simLogs, JSON.stringify(sim.value.err)));
      }
      try {
        console.log('[lr-sim] ok | CU:', sim?.value?.unitsConsumed,
          '| logs:', (simLogs || []).length);
      } catch {}
    } catch (simErr) {
      if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr;
      console.warn('[lr-sim] could not run sim, proceeding:', simErr?.message);
    }

    // 6. User signs.
    const signed = await wallet.signTransaction(tx);
    const raw = signed.serialize();

    // 7. Send.
    let sig;
    try {
      sig = await tradeConnection.sendRawTransaction(raw, {
        skipPreflight: true,
        maxRetries:    5,
      });
    } catch (sendErr) {
      let logs = sendErr?.logs || null;
      if (!logs && typeof sendErr?.getLogs === 'function') {
        try { logs = await sendErr.getLogs(tradeConnection); } catch {}
      }
      console.error('[lr-send] rejected:', sendErr?.message, logs ? '\n' + logs.join('\n') : '');
      throw new Error(describeSimLogs(logs, sendErr?.message));
    }

    // 8. Rebroadcast same bytes until confirmed or blockhash expires.
    let confirmed = false, onchainErr = null;
    const startedAt = Date.now();
    const HARD_CAP_MS = 60_000;
    while (Date.now() - startedAt < HARD_CAP_MS) {
      try {
        const st = await tradeConnection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (st?.value?.err) { onchainErr = st.value.err; break; }
        const cs = st?.value?.confirmationStatus;
        if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
      } catch {}
      try {
        const h = await tradeConnection.getBlockHeight('confirmed');
        if (h > latest.lastValidBlockHeight) break;
      } catch {}
      try { await tradeConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    if (onchainErr) {
      console.warn('[lr-confirm] on-chain err:', JSON.stringify(onchainErr));
      throw new Error('Trade failed on-chain — price likely moved past slippage.');
    }

    return { sig, confirmed, mode, token, route: route.route };
  }, [wallet, connection, tradeConnection]);

  /* ──── card actions ──── */
  const onCardBuy = useCallback((token) => {
    if (!requireWallet()) return;
    setTradeOpen({ token, mode: 'buy' });
    refreshSol();
    refreshOneToken(token.mint);
  }, [requireWallet, refreshSol, refreshOneToken]);
  const onCardSell = useCallback((token) => {
    if (!requireWallet()) return;
    setTradeOpen({ token, mode: 'sell' });
    refreshSol();
    refreshOneToken(token.mint);
  }, [requireWallet, refreshSol, refreshOneToken]);

  const handleTradeConfirm = useCallback(async ({ mode, swapParams, token }) => {
    const { sig, confirmed } = await executeSwap({ mode, swapParams, token });

    // Estimated output for the toast, from current price feed.
    let outAmount = 0;
    if (mode === 'buy' && token?.price > 0 && solPrice > 0) {
      const tradeSol = Number(swapParams.tradeLamports) / 1e9;
      outAmount = (tradeSol * solPrice) / token.price;
    } else if (mode === 'sell' && token?.price > 0 && solPrice > 0) {
      const gross = (swapParams.tradeTokensUi * token.price) / solPrice;
      outAmount = Math.max(0, gross * (1 - FEE_BPS / 10000));
    }

    if (confirmed) {
      fireConfetti();
      const shareUrl = buildShareUrl();
      const tweetText = buildTweetText({
        mode, token,
        solAmount:  swapParams.solAmount,
        outAmount:  outAmount || 0,
        percentage: swapParams.percentage,
      });
      pushToast({
        kind: 'success',
        emoji: '🎉',
        body: mode === 'buy'
          ? <><b>Bought ${token.sym}</b><br/>{swapParams.solAmount} SOL{outAmount > 0 ? <> → ~{formatTokens(outAmount)} {token.sym}</> : null}</>
          : <><b>Sold {Math.round(swapParams.percentage)}% of ${token.sym}</b>{outAmount > 0 ? <><br/>~{formatSol(outAmount)} SOL</> : null}</>,
        solscan: 'https://solscan.io/tx/' + sig,
        tweetText, shareUrl,
      });
    } else {
      pushToast({
        kind: 'error',
        emoji: '⏳',
        body: <><b>Not confirmed</b><br/>Sent, but didn't confirm in time. Check Solscan before retrying so you don't trade twice.</>,
        solscan: 'https://solscan.io/tx/' + sig,
        duration: 13000,
      });
    }

    refreshSol();
    [1200, 3000, 6000].forEach(ms => setTimeout(() => {
      refreshSol();
      refreshOneToken(token.mint);
    }, ms));
    aggressiveRefresh();
    setTradeOpen(null);
    return { closed: true };
  }, [executeSwap, fireConfetti, pushToast, aggressiveRefresh, refreshSol, refreshOneToken, solPrice]);

  /* ──── derived display ──── */
  const deriveDisplayValues = useCallback(
    (t) => (chartChg[t.mint] != null ? { ...t, change: chartChg[t.mint] } : t),
    [chartChg],
  );

  const freshTokens = useMemo(
    () => recentTokens.filter(t => Number.isFinite(t.ageMs) && t.ageMs < freshThresholdMs),
    [recentTokens, freshThresholdMs],
  );
  const activeList = lane === 'fresh' ? freshTokens : recentTokens;

  const featured = useMemo(() => {
    const pool = freshTokens.map(deriveDisplayValues);
    return pool.length ? pool[0] : null;
  }, [freshTokens, deriveDisplayValues]);

  const filtered = useMemo(() => {
    let l = activeList.map(deriveDisplayValues);
    const seen = new Set();
    if (featured?.mint) seen.add(featured.mint);
    l = l.filter(t => {
      if (!t?.mint || seen.has(t.mint)) return false;
      seen.add(t.mint);
      return true;
    });
    if (timeFilter !== 'all') {
      const cap = timeFilter === '1h' ? 3600_000 : timeFilter === '6h' ? 6*3600_000 : 24*3600_000;
      l = l.filter(t => Number.isFinite(t.ageMs) && t.ageMs < cap);
    }
    if (sortBy === 'newest')      l = [...l].sort((a, b) => (a.ageMs || 0) - (b.ageMs || 0));
    else if (sortBy === 'volume') l = [...l].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    else if (sortBy === 'signal') l = [...l].sort((a, b) => signalScore(b) - signalScore(a));
    return l.slice(0, 30);
  }, [activeList, timeFilter, sortBy, deriveDisplayValues, featured]);

  const topGainer = useMemo(() => {
    const pool = recentTokens.map(deriveDisplayValues).filter(t => Number.isFinite(t.change) && t.change > 0);
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.change > a.change ? b : a));
  }, [recentTokens, deriveDisplayValues]);
  const totalVol24h = useMemo(
    () => recentTokens.reduce((s, t) => s + (t.volume24h || 0), 0),
    [recentTokens],
  );

  const onConnectClick = useCallback(async () => {
    if (wallet.publicKey && wallet.disconnect) {
      try { await wallet.disconnect(); } catch {}
      return;
    }
    if (onConnectWallet) { onConnectWallet(); return; }
    if (wallet.connect) {
      try { await wallet.connect(); }
      catch {
        pushToast({ kind: 'error', emoji: '🔌', body: 'Could not connect — pick a wallet first (Phantom, Solflare, Backpack).' });
      }
    }
  }, [wallet, onConnectWallet, pushToast]);

  return (
    <div className="lr-root">
      <div className="lr-blob" style={{ width: 400, height: 400, background: '#FFB088', top: -80, left: -120 }} />
      <div className="lr-blob" style={{ width: 500, height: 500, background: '#FF8FBE', top: '30%', right: -180, animationDelay: '3s' }} />
      <div className="lr-blob" style={{ width: 340, height: 340, background: '#FFD46B', bottom: '10%', left: -100, animationDelay: '6s' }} />

      <div className="lr-phone">


        <div className="lr-status">
  <button type="button" className="lr-gear-btn" style={{ width: 22, height: 22, fontSize: 11 }}
    onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Edit presets">⚙</button>
  <div className="lr-status-divider" />
  <div className="lr-status-item">

            <span className={'lr-live-dot' + (recentError ? ' lr-warn' : '')} />
            {lane === 'fresh'
              ? (recentLoading ? <>SYNCING…</> : <>LIVE · <b>{freshTokens.length}</b> fresh</>)
              : (recentLoading ? <>SYNCING…</> : recentError ? <>FEED DOWN</> : <><b>{recentTokens.length}</b> tokens</>)}
          </div>
          <div className="lr-status-divider" />
          <div className="lr-status-item">SOL <b>${solPrice > 0 ? solPrice.toFixed(2) : '—'}</b></div>
          {wallet.publicKey && (
            <>
              <div className="lr-status-divider" />
              <div className="lr-status-item">💰 <b>{formatSol(solBalance?.uiAmount || 0)}</b></div>
            </>
          )}
        </div>

        <div className="lr-orbs">
          <div className="lr-orb lr-orb-1" style={{ animationDelay: '0s' }}>
            <span className="lr-orb-emoji">🥚</span>
            <div className="lr-orb-val">{freshTokens.length}</div>
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
                <div className="lr-feature-sub">{featured.name} · {formatPrice(featured.price)}</div>
                <div className="lr-feature-age">⚡ {featured.age} old</div>
              </div>
            </div>
            <div className="lr-feature-actions">
              <button type="button" className="lr-feature-btn" onClick={() => onCardBuy(featured)}>
                🚀 BUY ${featured.sym}
              </button>
            </div>
          </div>
        )}

        <div className={'lr-tabs' + (lane === 'recent' ? ' lr-tab-recent' : '')}>
          <div className="lr-tab-indicator" />
          <button type="button"
            className={'lr-tab' + (lane === 'fresh' ? ' lr-active' : '')}
            onClick={() => setLane('fresh')}>
            <span className="lr-tab-emoji">🐣</span>
            JUST HATCHED
            <span className="lr-tab-count">{freshTokens.length}</span>
          </button>
          <button type="button"
            className={'lr-tab' + (lane === 'recent' ? ' lr-active' : '')}
            onClick={() => setLane('recent')}>
            <span className="lr-tab-emoji">🌈</span>
            ON RADAR
            <span className="lr-tab-count">{recentTokens.length}</span>
          </button>
        </div>

        <div className="lr-filters">
          {[
            ['all', '🌟 ALL'],
            ['1h',  '⚡ STILL HOT'],
            ['6h',  '🍿 TODAY'],
            ['24h', '🌙 24H'],
          ].map(([k, l]) => (
            <button key={k} type="button"
              className={'lr-filter' + (timeFilter === k ? ' lr-active' : '')}
              onClick={() => setTimeFilter(k)}>{l}</button>
          ))}
          <div className="lr-filter-divider" />
          {[
            ['newest', '🆕 FRESHEST'],
            ['volume', '🔥 LOUDEST'],
            ['signal', '✨ TOP SIGNAL'],
          ].map(([k, l]) => (
            <button key={k} type="button"
              className={'lr-filter' + (sortBy === k ? ' lr-active' : '')}
              onClick={() => setSortBy(k)}>{l}</button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="lr-empty">
            <span className="lr-empty-emoji">{lane === 'fresh' ? '🥚' : '🍿'}</span>
            {lane === 'fresh' && recentLoading ? (
              <>
                <b>Warming up the launch stream…</b>
                <div className="lr-empty-sub">Pulling fresh pump.fun launches any second now.</div>
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
                isFresh={Number.isFinite(t.ageMs) && t.ageMs < freshThresholdMs}
                tintIndex={i % 5}
              />
            ))}
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          buyPresets={buyPresets} setBuyPresets={setBuyPresets}
          sellPresets={sellPresets} setSellPresets={setSellPresets}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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

      <div className="lr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={'lr-toast lr-toast-' + t.kind}>
            <span className="lr-toast-emoji">{t.emoji}</span>
            <div className="lr-toast-body">{t.body}</div>
            <div className="lr-toast-actions">
              {t.solscan && (
                <a className="lr-toast-action" href={t.solscan} target="_blank" rel="noreferrer">VIEW</a>
              )}
              {t.tweetText && (
                <button type="button"
                  className="lr-toast-action lr-toast-twitter"
                  onClick={() => openTwitterShare(t.tweetText, t.shareUrl)}
                  aria-label="Share on Twitter">
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

      {confettiKey > 0 && (
        <div className="lr-confetti" key={confettiKey}>
          {confettiPieces.map(p => (
            <div key={p.i} className="lr-confetti-piece"
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
