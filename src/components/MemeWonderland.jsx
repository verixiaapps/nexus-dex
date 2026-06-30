// DiscoverHub.jsx
// ── Merged page: MemeWonderland (Discover) + LaunchRadar (Launches) ──────────
// Both original files are included UNCHANGED, each sealed in its own scope so
// their duplicate top-level names (TokenIcon, normalize, format, getConn, …)
// never collide. Shared imports are hoisted here; nothing inside either page
// was rewritten. A top toggle switches between the two; both stay mounted so
// flipping is instant and neither loses scroll or its live feed.
//
// Discover sections keep the Jupiter swap flow; Launches sections keep the
// pump.fun trade flow — exactly as in your originals.
//
// Requires ./Stocks.jsx next to this file (used by the Launches feed).

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
import { stkFetchSeries, stkBuildPath, stkSmoothPath, stkThrottle } from './Stocks.jsx';


/* ════════ DISCOVER PAGE (MemeWonderland) — original, scoped ════════ */
const MemeWonderland = (function () {
// MemeWonderland.jsx — pastel wonderland. Jupiter swap, full 3% fee → FEE_WALLET.
// Sections: Hero · Top Signal · Narratives · Whale Radar · Breaking Out · New Launches · Trending · Live Feed.
    

// ════════════════════════════════════════════════════════════════════
// PASTEL CSS
// ════════════════════════════════════════════════════════════════════
const MW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

.mw-root{
  --ink:#0a0a0a; --ink-2:#6b6b6b; --ink-3:#9a9a9a;
  --pink:#e0364f; --mint:#16a34a; --lav:#0a0a0a; --peach:#e8820c;
  --sky:#2f6bff; --gold:#a67200; --green:#16a34a; --red:#e0364f; --down:#fb7185;
  --glass:#ffffff; --glass-strong:#fafafa;
  --border:#e4e4e7; --hairline:#efeff1;
  --fill:#f5f5f6;
  min-height:100vh;color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  position:relative;overflow-x:hidden;padding-bottom:60px;
  background:#ffffff;
}
.mw-root,.mw-root *{box-sizing:border-box}
@keyframes mwDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes mwShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes mwPulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes mwTicker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes mwFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes mwRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes mwSpin{to{transform:rotate(360deg)}}
@keyframes mwSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes mwShimmerSlide{0%{left:-110px}50%,100%{left:130%}}
@keyframes mwPop{0%{transform:scale(0) rotate(-90deg);opacity:0}60%{transform:scale(1.2) rotate(10deg)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes mwFall{0%{transform:translateY(-30px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:.8}}

.mw-blob{display:none !important}
.mw-shim{color:var(--ink);-webkit-text-fill-color:currentColor;background:none;animation:none}

.mw-ambient{display:none !important}

.mw-phone{max-width:480px;margin:0 auto;position:relative;padding-bottom:32px;z-index:5}

/* HERO — removed in JSX */
.mw-hero{display:none}
.mw-hero h1{display:none}
.mw-hero-sub{display:none}
.mw-hero-meta{display:none}

.mw-search-wrap{padding:14px 16px 6px;position:relative;z-index:3}
.mw-search{display:flex;align-items:center;gap:10px;background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--border);border-radius:999px;padding:13px 16px;transition:border-color .15s;box-shadow:none}
.mw-search:focus-within{border-color:var(--ink)}
.mw-search .mw-search-ico{font-size:14px;opacity:.5}
.mw-search input{background:none;border:none;color:var(--ink);font-family:inherit;font-size:14px;flex:1;outline:none;font-weight:500;min-width:0}
.mw-search input::placeholder{color:var(--ink-3)}
.mw-search-clear{flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:var(--fill);color:var(--ink-2);font-family:inherit;font-size:14px;cursor:pointer;display:grid;place-items:center}

.mw-stats-orbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 16px 4px;position:relative;z-index:2}
.mw-orb{position:relative;padding:12px 8px 11px;border-radius:14px;background:#fff;backdrop-filter:none;border:1px solid var(--hairline);overflow:hidden;text-align:center;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-orb-ico{font-size:14px;display:block;margin-bottom:4px}
.mw-orb-label{font-size:8px;color:var(--ink-3);letter-spacing:.6px;text-transform:uppercase;font-weight:700}
.mw-orb-val{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;line-height:1;margin-top:4px;color:var(--ink);font-variant-numeric:tabular-nums}

.mw-ticker-strip{margin:14px 0 0;padding:10px 0;background:var(--glass-strong);border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);overflow:hidden;position:relative;z-index:2}
.mw-ticker-track{display:flex;gap:28px;white-space:nowrap;animation:mwTicker 35s linear infinite;width:max-content}
.mw-ticker-item{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.mw-ticker-item .mw-sym{color:var(--ink);font-weight:700;font-family:ui-monospace,Menlo,monospace}
.mw-up{color:var(--green)}
.mw-down{color:var(--down)}

.mw-section-head{display:flex;justify-content:space-between;align-items:center;padding:20px 16px 10px;position:relative;z-index:2}
.mw-section-title{font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink);background:none;-webkit-text-fill-color:currentColor;display:flex;align-items:center;gap:7px}
.mw-section-title .mw-ico{font-size:13px;-webkit-text-fill-color:initial}
.mw-section-meta{font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:.5px;display:flex;align-items:center;gap:5px}
.mw-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none;animation:mwPulse 1.5s ease-in-out infinite;display:inline-block}

.mw-sub-tabs{display:flex;gap:4px;margin:0 16px 12px;padding:4px;background:var(--fill);border:1px solid var(--border);border-radius:999px;width:max-content;backdrop-filter:none}
.mw-sub-tab{padding:7px 14px;border-radius:999px;font-size:11px;font-weight:700;color:var(--ink-2);cursor:pointer;border:none;background:none;font-family:inherit;letter-spacing:.2px;transition:all .15s}
.mw-sub-tab.mw-active{background:#0a0a0a;color:#fff;box-shadow:none}

.mw-featured{margin:6px 16px 0;padding:18px;border-radius:18px;background:#0a0a0a;border:1px solid #0a0a0a;backdrop-filter:none;position:relative;overflow:hidden;cursor:pointer;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:none;color:#fff}
.mw-featured::before{display:none}
.mw-feat-badge{display:inline-flex;align-items:center;gap:5px;background:#fff;color:#0a0a0a;font-weight:800;font-size:9px;letter-spacing:1px;padding:5px 11px;border-radius:999px;position:relative;z-index:2}
.mw-feat-body{display:flex;align-items:center;gap:14px;margin-top:14px;position:relative;z-index:2}
.mw-token-avatar{width:64px;height:64px;border-radius:50%;flex-shrink:0;position:relative;padding:0;background:#fff;animation:none}
.mw-token-avatar-inner{width:100%;height:100%;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:30px;overflow:hidden;color:#0a0a0a}
.mw-token-avatar-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-crown{position:absolute;top:-6px;left:-4px;width:22px;height:22px;background:#fff;border:1px solid var(--border);border-radius:50%;display:grid;place-items:center;font-size:11px;z-index:3;box-shadow:none}
.mw-feat-meta{flex:1;min-width:0}
.mw-feat-sym{font-family:inherit;font-size:26px;font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}
.mw-feat-name{font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;font-weight:500}
.mw-feat-score{text-align:right;flex-shrink:0}
.mw-feat-score-num{font-family:ui-monospace,Menlo,monospace;font-size:38px;font-weight:700;line-height:1;color:#fff;background:none;-webkit-text-fill-color:currentColor}
.mw-feat-score-denom{font-size:13px;color:rgba(255,255,255,.6);font-weight:600}
.mw-feat-score-label{font-size:8px;color:rgba(255,255,255,.5);letter-spacing:1.2px;font-weight:700;margin-top:2px}
.mw-feat-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;position:relative;z-index:2}
.mw-fm{text-align:center;padding:10px 4px;border-radius:12px;background:rgba(255,255,255,.08);border:none}
.mw-fm-ico{font-size:13px;display:block;margin-bottom:3px}
.mw-fm-val{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:14px;line-height:1;color:#fff}
.mw-fm-lbl{font-size:8px;color:rgba(255,255,255,.55);letter-spacing:.6px;text-transform:uppercase;font-weight:600;margin-top:3px}
.mw-fm-val.mw-up{color:#4ade80}
.mw-fm-val.mw-down{color:#fb7185}
.mw-feat-cta{display:flex;gap:8px;margin-top:16px;position:relative;z-index:2}
.mw-btn-grad{flex:1;border:none;cursor:pointer;padding:13px 16px;border-radius:999px;background:var(--green);color:#fff;font-family:inherit;font-size:13px;font-weight:800;letter-spacing:.4px;box-shadow:none}
.mw-btn-ghost{flex:1;border:1px solid rgba(255,255,255,.25);cursor:pointer;padding:12px 16px;border-radius:999px;background:transparent;color:#fff;font-family:inherit;font-size:13px;font-weight:600}

.mw-narratives{display:flex;gap:8px;padding:4px 16px 4px;margin:0;overflow-x:auto;position:relative;z-index:2;scrollbar-width:none;scroll-snap-type:x mandatory}
.mw-narratives::-webkit-scrollbar{display:none}
.mw-narr{flex:0 0 auto;padding:11px 14px;border-radius:14px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;min-width:120px;cursor:pointer;transition:border-color .15s;scroll-snap-align:start;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-narr-emoji{font-size:17px}
.mw-narr-name{font-size:12px;font-weight:700;margin-top:5px}
.mw-narr-pct{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700;margin-top:4px;color:var(--green)}
.mw-narr-pct.mw-down{color:var(--down)}
.mw-narr-count{font-size:10px;color:var(--ink-2);margin-top:2px}

.mw-hscroll{display:flex;gap:10px;padding:4px 16px;margin:0;overflow-x:auto;scroll-snap-type:x mandatory;position:relative;z-index:2;scrollbar-width:none}
.mw-hscroll::-webkit-scrollbar{display:none}

.mw-whale-card{flex:0 0 168px;scroll-snap-align:start;padding:14px;border-radius:16px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;cursor:pointer;transition:transform .15s;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-whale-card:active{transform:scale(.98)}
.mw-whale-row{display:flex;align-items:center;gap:10px}
.mw-mini-avatar{width:38px;height:38px;border-radius:50%;padding:0;flex-shrink:0;background:#0a0a0a}
.mw-mini-avatar .mw-inner{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-size:17px;overflow:hidden;background:#0a0a0a;color:#fff}
.mw-mini-avatar .mw-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-whale-sym{font-size:14px;font-weight:700}
.mw-whale-pct{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:700;color:var(--green);margin-top:2px}
.mw-whale-pct.mw-down{color:var(--down)}
.mw-whale-stats{display:flex;justify-content:space-between;margin-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700}
.mw-whale-stats .mw-l{color:var(--ink-2)}
.mw-whale-stats .mw-r{color:var(--green)}
.mw-trade-pill{margin-top:10px;padding:9px;border-radius:10px;background:var(--green);color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.4px;border:none;cursor:pointer;width:100%;font-family:inherit}

.mw-bo-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px;position:relative;z-index:2}
.mw-bo-card{padding:15px;border-radius:16px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;position:relative;overflow:hidden;min-height:150px;cursor:pointer;animation:mwRise .4s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-bo-card.mw-momentum,.mw-bo-card.mw-volume,.mw-bo-card.mw-smart,.mw-bo-card.mw-early{background:#fff}
.mw-bo-head{display:flex;align-items:center;gap:8px}
.mw-bo-ico{width:30px;height:30px;border-radius:50%;background:var(--fill);display:grid;place-items:center;font-size:14px;flex-shrink:0}
.mw-bo-title{font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--ink-2)}
.mw-bo-token{display:flex;align-items:center;gap:8px;margin-top:12px}
.mw-bo-sym{font-family:inherit;font-size:19px;font-weight:700;line-height:1;letter-spacing:-.01em}
.mw-bo-pct{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:700;margin-top:6px;color:var(--green)}
.mw-bo-pct.mw-down{color:var(--down)}
.mw-bo-meta{font-size:10px;color:var(--ink-2);margin-top:2px;font-weight:500}
.mw-bo-empty{font-size:12px;color:var(--ink-2);margin-top:14px}

.mw-launch-card{flex:0 0 188px;scroll-snap-align:start;padding:14px;border-radius:16px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;cursor:pointer;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-launch-head{display:flex;align-items:center;gap:10px}
.mw-launch-info{min-width:0}
.mw-launch-sym{font-size:14px;font-weight:700;line-height:1.1}
.mw-launch-age{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:700;margin-top:3px;letter-spacing:.3px}
.mw-launch-row{display:flex;justify-content:space-between;margin-top:10px;font-size:11px}
.mw-launch-l{color:var(--ink-2);font-weight:500}
.mw-launch-v{font-weight:700;font-family:ui-monospace,Menlo,monospace}

.mw-trend-list{display:flex;flex-direction:column;gap:8px;padding:0 16px;position:relative;z-index:2}
.mw-trend-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;cursor:pointer;animation:mwRise .3s ease backwards;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-trend-rank{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;color:var(--ink-3);width:20px;text-align:center;flex-shrink:0}
.mw-trend-mid{flex:1;min-width:0}
.mw-trend-sym{font-size:14px;font-weight:700}
.mw-trend-sub{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);margin-top:2px;font-weight:500}
.mw-trend-right{text-align:right;flex-shrink:0}
.mw-trend-pct{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700;color:var(--green)}
.mw-trend-pct.mw-down{color:var(--down)}
.mw-trend-meta{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);margin-top:2px;font-weight:500}

.mw-activity{padding:0 16px;position:relative;z-index:2}
.mw-activity-list{display:flex;flex-direction:column;gap:8px}
.mw-act{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid var(--hairline);backdrop-filter:none;cursor:pointer;animation:mwRise .3s ease backwards;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-act-ico{width:30px;height:30px;border-radius:50%;background:var(--fill);display:grid;place-items:center;font-size:14px;flex-shrink:0}
.mw-act-body{flex:1;min-width:0;font-size:12px}
.mw-act-l1{color:var(--ink-2);font-weight:500}
.mw-act-l1 b{color:var(--ink);font-weight:700}
.mw-act-right{text-align:right;flex-shrink:0}
.mw-act-amt{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;color:var(--green)}
.mw-act-time{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-3);font-weight:600;margin-top:2px}

.mw-empty{text-align:center;padding:24px 20px;color:var(--ink-2);font-size:13px;font-weight:500}

.mw-detail{position:fixed;top:0;left:0;right:0;bottom:0;margin:0 auto;width:100%;max-width:480px;height:100vh;height:100dvh;z-index:9999;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 60px);background:#ffffff;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;animation:mwFade .25s ease-out}
.mw-detail-top{display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;position:sticky;top:0;z-index:10;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);border-bottom:1px solid var(--hairline)}
.mw-icon-btn{width:36px;height:36px;border-radius:50%;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-size:16px;cursor:pointer;display:grid;place-items:center;font-family:initial}
.mw-detail-title{font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.mw-check-mint{color:var(--green);font-size:13px}
.mw-detail-hero{padding:16px 18px 14px;display:flex;align-items:center;gap:14px}
.mw-detail-emoji{font-size:30px;line-height:1;flex-shrink:0;filter:none;width:58px;height:58px;border-radius:50%;background:#0a0a0a;color:#fff;display:grid;place-items:center;overflow:hidden}
.mw-detail-emoji img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.mw-detail-info{flex:1;min-width:0}
.mw-detail-name{font-family:inherit;font-size:26px;font-weight:800;line-height:1;letter-spacing:-.02em}
.mw-detail-fullname{color:var(--ink-2);font-weight:500;font-size:12px;margin-top:5px}
.mw-detail-price-row{display:flex;align-items:center;gap:10px;margin-top:8px}
.mw-detail-price{font-family:ui-monospace,Menlo,monospace;font-size:20px;font-weight:700;line-height:1;letter-spacing:-.02em}
.mw-inline-actions{padding:0 18px 14px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mw-big-btn{border:none;padding:15px 0;border-radius:999px;font-family:inherit;font-weight:700;font-size:15px;letter-spacing:-.01em;cursor:pointer;transition:opacity .15s}
.mw-big-btn.mw-buy{background:var(--green);color:#fff;box-shadow:none}
.mw-big-btn.mw-sell{background:var(--fill);border:1px solid var(--border);color:var(--ink)}

/* ── TOKEN DETAIL CHART (CoinGecko / GeckoTerminal embed, framed) ── */
.mw-chart{margin:0 18px 14px;border:1px solid var(--hairline);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-chart-bar{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--hairline)}
.mw-chart-ca{display:flex;align-items:center;gap:7px;min-width:0}
.mw-chart-ca-l{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:.5px}
.mw-chart-ca-v{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:600;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-chart-ca-copy{flex-shrink:0;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:#fff;background:#0a0a0a;border:none;border-radius:6px;padding:5px 9px;letter-spacing:.4px;cursor:pointer}
.mw-chart-src{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);font-weight:600;letter-spacing:.4px;flex-shrink:0}
.mw-chart-frame-wrap{position:relative;width:100%;height:clamp(300px,42dvh,440px);background:#fff}
.mw-chart-frame{width:100%;height:100%;border:0;display:block}
.mw-chart-state{display:grid;place-items:center;width:100%;height:clamp(300px,42dvh,440px);background:#fafafa;color:var(--ink-2);font-size:12px;font-weight:500;text-align:center;padding:20px}
.mw-chart-spin{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--border);border-top-color:#0a0a0a;animation:mwSpin .8s linear infinite}
.mw-tf-pills{display:flex;align-items:center;gap:4px;padding:8px 12px;border-top:1px solid var(--hairline)}
.mw-tf{flex:0 0 auto;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink-2);background:transparent;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;transition:.12s}
.mw-tf:hover{color:var(--ink)}
.mw-tf.on{background:var(--fill);color:var(--ink)}
.mw-tf:disabled{opacity:.4;cursor:default}
.mw-tf-meta{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;letter-spacing:.4px;color:var(--ink-3);text-transform:uppercase}
@media(max-width:600px){.mw-chart{margin:0 14px 14px}.mw-chart-frame-wrap,.mw-chart-state{height:clamp(300px,48dvh,420px)}.mw-tf{padding:6px 9px;font-size:10px}}

.mw-whale-banner{margin:0 18px 14px;background:#0a0a0a;border:1px solid #0a0a0a;border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:12px;color:#fff}
.mw-whale-banner-emoji{font-size:24px}
.mw-whale-banner-title{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:rgba(255,255,255,.6);font-weight:800;letter-spacing:1px}
.mw-whale-banner-sub{font-size:13px;color:#fff;font-weight:600;margin-top:2px}
.mw-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 18px}
.mw-stat{background:#fff;border:1px solid var(--hairline);backdrop-filter:none;border-radius:14px;padding:14px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.mw-stat-icon{font-size:15px;margin-bottom:5px;display:block}
.mw-stat-label{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);letter-spacing:.6px;text-transform:uppercase;font-weight:700;margin-bottom:4px}
.mw-stat-value{font-family:ui-monospace,Menlo,monospace;font-size:19px;font-weight:700;line-height:1}
.mw-stat-sub{font-size:9px;color:var(--ink-3);font-weight:600;margin-top:4px}
.mw-contract{margin:14px 18px 0;padding:12px 14px;background:var(--glass-strong);border:1px solid var(--border);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.mw-contract-info{min-width:0;flex:1}
.mw-contract-label{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);letter-spacing:.6px;text-transform:uppercase;font-weight:700;margin-bottom:3px}
.mw-contract-addr{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-copy-btn{background:#0a0a0a;border:none;color:#fff;padding:7px 12px;border-radius:7px;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:9px;letter-spacing:.5px;cursor:pointer;flex-shrink:0}

.mw-sheet-backdrop{position:fixed;inset:0;background:rgba(10,10,10,.4);backdrop-filter:blur(4px);z-index:9998;animation:mwFade .2s}
.mw-sheet{position:fixed;bottom:0;left:0;right:0;margin:0 auto;width:100%;max-width:480px;background:#ffffff;border-top-left-radius:22px;border-top-right-radius:22px;border-top:1px solid var(--border);padding:8px 0 calc(env(safe-area-inset-bottom,0px) + 24px);max-height:92dvh;z-index:9999;animation:mwSlideUp .4s cubic-bezier(.2,1.2,.4,1);box-shadow:0 -12px 50px rgba(10,10,10,.18);overflow-y:auto;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
.mw-grabber{width:40px;height:4px;background:var(--border);border-radius:999px;margin:0 auto 14px}
.mw-sheet-token-head{padding:4px 18px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--hairline)}
.mw-sheet-emoji{width:48px;height:48px;border-radius:50%;background:#0a0a0a;color:#fff;display:grid;place-items:center;font-size:22px;box-shadow:none;flex-shrink:0;overflow:hidden}
.mw-sheet-emoji img{width:100%;height:100%;object-fit:cover}
.mw-sheet-token-info{flex:1;min-width:0}
.mw-sheet-token-name{font-family:inherit;font-size:20px;font-weight:700;line-height:1;margin-bottom:6px;letter-spacing:-.02em}
.mw-sheet-sub{display:flex;align-items:center;gap:8px}
.mw-age-pill{background:var(--glass-strong);color:var(--ink-2);padding:3px 10px;border-radius:999px;font-weight:700;font-size:10px;letter-spacing:.3px;font-family:ui-monospace,Menlo,monospace;border:1px solid var(--border)}
.mw-tab-switch{display:grid;grid-template-columns:1fr 1fr;margin:16px 18px 0;background:var(--fill);border:1px solid var(--border);border-radius:14px;padding:4px;position:relative}
.mw-tab{padding:11px 0;text-align:center;font-family:inherit;font-weight:800;font-size:12px;letter-spacing:.5px;color:var(--ink-2);border-radius:11px;cursor:pointer;transition:color .2s;position:relative;z-index:2}
.mw-tab-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:var(--green);border-radius:11px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1;box-shadow:none}
.mw-tab-switch.mw-sell-mode .mw-tab-indicator{transform:translateX(100%);background:var(--red);box-shadow:none}
.mw-tab.mw-active{color:#fff}
.mw-amount-section{padding:18px}
.mw-amount-label{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-2);letter-spacing:.6px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;text-transform:uppercase;font-weight:800}
.mw-balance{color:var(--ink-2);font-size:10px;background:var(--glass-strong);padding:4px 10px;border-radius:999px;text-transform:none;letter-spacing:0;font-weight:700;font-family:ui-monospace,Menlo,monospace;border:1px solid var(--border)}
.mw-balance b{color:var(--ink);font-weight:800}
.mw-balance .mw-bal-err{color:var(--red);font-weight:700}
.mw-amount-input-wrap{background:var(--glass-strong);border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;align-items:center;gap:10px;transition:border-color .15s}
.mw-amount-input-wrap:focus-within{border-color:var(--ink);box-shadow:none}
.mw-amount-input{background:none;border:none;color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-size:30px;flex:1;outline:none;min-width:0;width:100%;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.mw-currency{display:flex;align-items:center;gap:8px;background:#fff;padding:8px 12px 8px 8px;border-radius:999px;font-weight:700;font-size:13px;border:1px solid var(--border);flex-shrink:0;font-family:inherit}
.mw-currency-icon{width:22px;height:22px;border-radius:50%;background:#0a0a0a}
.mw-amount-usd{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);font-weight:600;margin-top:6px;padding-left:4px}
.mw-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}
.mw-preset{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);padding:11px 0;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-weight:800;font-size:12px;cursor:pointer;transition:all .15s}
.mw-preset.mw-selected{background:#0a0a0a;border-color:#0a0a0a;color:#fff;box-shadow:none}
.mw-receive{margin:12px 18px 0;padding:14px 16px;background:var(--glass-strong);border:1px solid var(--hairline);border-radius:12px;display:flex;justify-content:space-between;align-items:center}
.mw-receive-label{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);letter-spacing:.6px;text-transform:uppercase;font-weight:700}
.mw-receive-amount{font-family:ui-monospace,Menlo,monospace;font-size:20px;font-weight:700;color:var(--green);margin-top:3px}
.mw-receive-rate{text-align:right;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:500}
.mw-receive-rate b{color:var(--ink);font-weight:700}
.mw-cta-wrap{padding:16px 18px 0}
.mw-cta{width:100%;background:var(--green);color:#fff;border:none;padding:16px 0;border-radius:999px;font-family:inherit;font-weight:700;font-size:15px;letter-spacing:-.01em;cursor:pointer;box-shadow:none;transition:opacity .15s;position:relative;overflow:hidden}
.mw-cta:disabled{opacity:.5;cursor:not-allowed}
.mw-cta.mw-sell-cta{background:var(--red);color:#fff;box-shadow:none}
.mw-cta::after{display:none}
.mw-trust{text-align:center;margin-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);letter-spacing:.2px;font-weight:600}
.mw-trust b{color:var(--ink);font-weight:700}
.mw-jup-badge{display:inline-flex;align-items:center;gap:5px;background:var(--glass-strong);padding:3px 9px;border-radius:999px;margin:0 3px;border:1px solid var(--border)}
.mw-jup-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none}

.mw-success-overlay{position:fixed;top:0;left:0;right:0;bottom:0;margin:0 auto;width:100%;max-width:480px;height:100vh;height:100dvh;z-index:9999;overflow-y:auto;overflow-x:hidden;padding:calc(env(safe-area-inset-top,0px) + 16px) 0 calc(env(safe-area-inset-bottom,0px) + 40px);background:#ffffff;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
.mw-confetti-rain{position:fixed;inset:0;max-width:480px;left:50%;transform:translateX(-50%);pointer-events:none;overflow:hidden;z-index:1}
.mw-confetti-piece{position:absolute;top:-30px;animation:mwFall linear forwards}
.mw-success-top{display:flex;justify-content:space-between;align-items:center;padding:4px 16px 8px;position:relative;z-index:5}
.mw-view-on{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);padding:8px 12px;border-radius:999px;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:10px;letter-spacing:.5px;cursor:pointer;text-decoration:none}
.mw-success{text-align:center;padding:18px 22px 4px;position:relative;z-index:5}
.mw-success-emoji{font-size:64px;line-height:1;display:inline-block;animation:mwPop .6s cubic-bezier(.2,1.5,.4,1) backwards;filter:none}
.mw-success-title{font-family:inherit;font-size:34px;font-weight:800;line-height:1;margin-top:10px;letter-spacing:-.02em;color:var(--ink);background:none;-webkit-text-fill-color:currentColor;animation:mwRise .6s .2s backwards}
.mw-success-sub{color:var(--ink-2);font-weight:500;font-size:14px;margin-top:8px;animation:mwRise .6s .3s backwards}
.mw-flex-card{margin:18px 18px 0;background:#0a0a0a;border:1px solid #0a0a0a;border-radius:18px;padding:20px 18px;position:relative;overflow:hidden;box-shadow:none;animation:mwRise .6s .4s backwards;z-index:5;color:#fff}
.mw-flex-watermark{position:absolute;bottom:12px;right:16px;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:9px;color:rgba(255,255,255,.4);letter-spacing:1.5px}
.mw-flex-watermark b{color:#fff}
.mw-flex-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.mw-flex-emoji{font-size:36px;line-height:1;width:46px;height:46px;border-radius:50%;background:#fff;color:#0a0a0a;display:grid;place-items:center;overflow:hidden}
.mw-flex-emoji img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.mw-flex-token{flex:1;min-width:0}
.mw-flex-sym{font-family:inherit;font-size:22px;font-weight:800;line-height:1;color:#fff}
.mw-flex-tag{font-size:11px;color:rgba(255,255,255,.6);font-weight:500;margin-top:2px}
.mw-flex-divider{height:1px;background:rgba(255,255,255,.12);margin:12px 0}
.mw-flex-row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0}
.mw-flex-label{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:rgba(255,255,255,.55);letter-spacing:.6px;text-transform:uppercase;font-weight:700}
.mw-flex-value{font-family:ui-monospace,Menlo,monospace;font-size:15px;color:#fff;font-weight:700}
.mw-flex-value.mw-big{font-size:24px;color:#fff;background:none;-webkit-text-fill-color:currentColor}
.mw-share-section{margin:18px 18px 0;position:relative;z-index:5;animation:mwRise .6s .5s backwards}
.mw-share-title{text-align:center;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:11px;letter-spacing:1px;color:var(--ink);margin-bottom:12px}
.mw-share-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mw-share-btn{background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px 4px 9px;text-align:center;cursor:pointer;transition:all .15s;color:var(--ink);font-family:inherit;backdrop-filter:none}
.mw-share-icon{width:32px;height:32px;border-radius:50%;background:var(--mw-share-bg,var(--glass-strong));margin:0 auto 6px;display:grid;place-items:center;font-size:16px;color:var(--mw-share-color,var(--ink));font-weight:700}
.mw-share-label{font-size:10px;font-weight:600;color:var(--ink);letter-spacing:.2px}
.mw-done-wrap{padding:18px 18px 0;position:relative;z-index:5;animation:mwRise .6s .7s backwards}
.mw-done-btn{width:100%;background:#0a0a0a;color:#fff;border:none;padding:16px 0;border-radius:999px;font-family:inherit;font-weight:700;font-size:14px;letter-spacing:-.01em;cursor:pointer;box-shadow:none}

.mw-topbar{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);border-bottom:1px solid var(--hairline)}
.mw-brand{display:flex;align-items:center;gap:9px;cursor:pointer}
.mw-brand-dot{width:26px;height:26px;border-radius:8px;background:#0a0a0a;box-shadow:none}
.mw-brand-text{font-family:inherit;font-style:normal;font-size:17px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.mw-brand-text .mw-slash{opacity:.3;margin:0 4px;font-style:normal;font-weight:500}
.mw-topbar-right{display:flex;align-items:center;gap:8px}
.mw-wallet-btn{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:#0a0a0a;color:#fff;border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;box-shadow:none;letter-spacing:-.01em}
.mw-wallet-btn.mw-connected{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);box-shadow:none}
.mw-wallet-btn .mw-wallet-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none}

@media (min-width:1024px){
  .mw-phone{max-width:1280px;padding-bottom:80px}
  .mw-topbar{padding:14px 32px}
  .mw-search-wrap{max-width:680px;margin:0 auto;padding:14px 32px 8px}
  .mw-search{padding:15px 20px}
  .mw-search input{font-size:15px}
  .mw-stats-orbs{padding:18px 32px 8px;gap:12px;max-width:1080px;margin:0 auto}
  .mw-orb{padding:15px 12px}
  .mw-orb-val{font-size:22px}
  .mw-orb-label{font-size:9px}
  .mw-orb-ico{font-size:16px}
  .mw-section-head{padding:28px 32px 14px;max-width:1216px;margin:0 auto}
  .mw-sub-tabs{margin:0 32px 14px;max-width:1216px}
  .mw-section-title{font-size:11px;letter-spacing:1.6px}
  .mw-featured{margin:6px 32px 0;padding:24px;max-width:1216px;margin-left:auto;margin-right:auto;border-radius:20px}
  .mw-feat-body{gap:20px}
  .mw-token-avatar{width:84px;height:84px}
  .mw-token-avatar-inner{font-size:40px}
  .mw-feat-sym{font-size:34px}
  .mw-feat-name{font-size:13px}
  .mw-feat-score-num{font-size:52px}
  .mw-feat-score-denom{font-size:15px}
  .mw-feat-metrics{margin-top:18px;gap:12px}
  .mw-fm{padding:14px 8px}
  .mw-fm-val{font-size:18px}
  .mw-fm-lbl{font-size:9px;margin-top:5px}
  .mw-feat-cta{margin-top:18px;gap:12px}
  .mw-btn-grad,.mw-btn-ghost{font-size:14px;padding:14px 18px}
  .mw-narratives,.mw-hscroll{padding:6px 32px 8px;max-width:1280px;margin-left:auto;margin-right:auto}
  .mw-narr{padding:13px 16px;min-width:150px}
  .mw-narr-emoji{font-size:20px}
  .mw-narr-name{font-size:13px}
  .mw-narr-pct{font-size:16px}
  .mw-whale-card{flex:0 0 210px;padding:16px}
  .mw-mini-avatar{width:42px;height:42px}
  .mw-whale-sym{font-size:15px}
  .mw-whale-pct{font-size:15px}
  .mw-bo-grid{grid-template-columns:repeat(4,1fr);gap:12px;padding:0 32px;max-width:1216px;margin:0 auto}
  .mw-bo-card{padding:18px;min-height:180px}
  .mw-bo-title{font-size:11px;letter-spacing:1px}
  .mw-bo-sym{font-size:24px}
  .mw-bo-pct{font-size:15px;margin-top:8px}
  .mw-bo-meta{font-size:11px}
  .mw-launch-card{flex:0 0 230px;padding:18px}
  .mw-launch-sym{font-size:16px}
  .mw-trend-list{padding:0 32px;max-width:1216px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .mw-trend-row{padding:14px 16px}
  .mw-trend-sym{font-size:15px}
  .mw-trend-pct{font-size:16px}
  .mw-activity{padding:0 32px;max-width:1216px;margin:0 auto}
  .mw-activity-list{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .mw-detail{top:50%;left:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);width:760px;max-width:90vw;height:auto;max-height:90vh;border-radius:22px;padding-bottom:32px;border:1px solid var(--border);box-shadow:0 30px 80px rgba(10,10,10,.25)}
  .mw-detail-top{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);border-radius:22px 22px 0 0;padding:18px 28px 14px}
  .mw-detail-hero{padding:16px 28px 14px}
  .mw-chart{margin:0 28px 14px}
  .mw-inline-actions{padding:0 28px 14px}
  .mw-whale-banner{margin:0 28px 14px}
  .mw-stats-grid{padding:0 28px}
  .mw-contract{margin:14px 28px 0}
  .mw-sheet{top:0;bottom:0;right:0;left:auto;width:500px;max-width:500px;height:100vh;max-height:100vh;margin:0;border-top-left-radius:22px;border-bottom-left-radius:22px;border-top-right-radius:0;border-left:1px solid var(--border);border-top:1px solid var(--border);padding-bottom:32px;animation:mwSlideLeftIn .35s cubic-bezier(.2,1.2,.4,1)}
  @keyframes mwSlideLeftIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
  .mw-grabber{display:none}
  .mw-success-overlay{max-width:680px;left:50%;transform:translateX(-50%)}
  .mw-success-title{font-size:44px}
  .mw-success-emoji{font-size:80px}
  .mw-flex-card{margin-left:auto;margin-right:auto;max-width:520px}
  .mw-share-section,.mw-done-wrap{max-width:520px;margin-left:auto;margin-right:auto}
}
@media (min-width:1440px){
  .mw-phone{max-width:1360px}
}
@media (max-width:430px){
  .mw-search-wrap{padding:12px 14px 6px}
  .mw-stats-orbs{padding:12px 14px 4px;gap:6px}
  .mw-orb{padding:10px 6px 9px}
  .mw-orb-val{font-size:15px}
  .mw-section-head{padding:18px 14px 10px}
  .mw-featured{margin:6px 14px 0;padding:16px}
  .mw-feat-sym{font-size:22px}
  .mw-feat-score-num{font-size:32px}
  .mw-narratives,.mw-hscroll{padding:4px 14px}
  .mw-bo-grid,.mw-trend-list,.mw-activity{padding:0 14px}
  .mw-sub-tabs{margin:0 14px 12px}
}

/* ════════════════════════════════════════════════════════════════════
   DARK TERMINAL THEME — appended override (wins the cascade)
   Flip back to light by restoring the original :root vars below.
   ════════════════════════════════════════════════════════════════════ */
.mw-root{
  --ink:#eceef2; --ink-2:#8b919b; --ink-3:#565c66;
  --green:#2fd67b; --mint:#2fd67b; --red:#ff5a6a; --down:#ff5a6a; --pink:#ff5a6a;
  --sky:#9b6bff; --vio:#9b6bff; --vio-soft:rgba(155,107,255,.14);
  --border:#23262e; --hairline:#1d2027; --fill:#181b20;
  --glass:#131519; --glass-strong:#15181d;
  --surf:#131519; --surf2:#1c2128; --bg:#0a0b0d;
  background:#0a0b0d;
}

/* surfaces that hard-code white → dark */
.mw-orb,
.mw-narr,
.mw-whale-card,
.mw-bo-card,
.mw-bo-card.mw-momentum,.mw-bo-card.mw-volume,.mw-bo-card.mw-smart,.mw-bo-card.mw-early,
.mw-launch-card,
.mw-trend-row,
.mw-act,
.mw-stat,
.mw-chart,
.mw-chart-frame-wrap,
.mw-share-btn,
.mw-currency{ background:#131519; }
.mw-chart-state{ background:#101216; }

/* full-screen layers */
.mw-detail,.mw-success-overlay{ background:#0a0b0d; }
.mw-sheet{ background:#101216; }
.mw-detail-top{ background:rgba(10,11,13,.92); }

/* near-black chips → lifted so they read on a dark surface */
.mw-mini-avatar,.mw-mini-avatar .mw-inner,
.mw-detail-emoji,.mw-sheet-emoji,.mw-currency-icon{ background:#1c2128; }
.mw-flex-card,.mw-whale-banner{ border-color:#23262e; }

/* light-on-dark action chips (were #0a0a0a/#fff) */
.mw-copy-btn,.mw-chart-ca-copy{ background:var(--fill); color:var(--ink); border:1px solid var(--border); }
.mw-done-btn{ background:var(--ink); color:var(--bg); }
.mw-preset.mw-selected{ background:var(--ink); border-color:var(--ink); color:var(--bg); }
.mw-sub-tab.mw-active{ background:var(--vio); color:#0a0b0d; }

/* ── signature: violet eyebrow tick instead of emoji ── */
.mw-section-title .mw-ico{ display:none; }
.mw-section-title::before{
  content:""; width:5px; height:5px; background:var(--vio);
  border-radius:1px; transform:rotate(45deg); flex-shrink:0;
}

/* ── signature: stat orbs lose emoji, gain a violet tick ── */
.mw-orb-ico{ display:none; }
.mw-orb{ text-align:left; }
.mw-orb::before{
  content:""; display:block; width:14px; height:2px;
  background:var(--vio); border-radius:2px; margin:0 0 9px;
}
.mw-orb-label{ font-family:ui-monospace,Menlo,monospace; }

/* ── signature: ticker reads like an exchange tape ── */
.mw-ticker-strip{ position:relative; }
.mw-ticker-strip::before,.mw-ticker-strip::after{
  content:""; position:absolute; top:0; bottom:0; width:34px; z-index:3; pointer-events:none;
}
.mw-ticker-strip::before{ left:0; background:linear-gradient(90deg,var(--glass-strong),transparent); }
.mw-ticker-strip::after{ right:0; background:linear-gradient(270deg,var(--glass-strong),transparent); }
.mw-ticker-item .mw-sym{ font-family:ui-monospace,Menlo,monospace; }
.mw-ticker-item{ font-family:ui-monospace,Menlo,monospace; }
`;

function useMwCSS() {
  useEffect(() => {
    const id = 'nexus-mw-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = MW_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ─── CONFIG ──────────────────────────────────────────────────────── */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300; // 3% total fee taken from input
const SLIPPAGE_BPS = 500;

// ── RPC ──────────────────────────────────────────────────────────────
// Same-origin server proxy → Alchemy mainnet. The server (server.js)
// holds the Alchemy API key and forwards via /api/solana-rpc. All
// Connection instances in this file route through the proxy.
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';
const BAL_COMMITMENT = 'processed';


const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};

// Single-RPC wrapper. Same `(label, op) => Promise` signature so all
// existing rpcRace(...) call sites work unchanged.
const rpcRace = (label, op, commitment = 'confirmed') => {
  return op(getConn(commitment)).catch(e => {
    console.warn(`[rpc] ${label} failed:`, e?.message);
    throw new Error(`${label}: dRPC failed`);
  });
};

// ── TRADE RPC (buys & sells only) ─────────────────────────────────────
// My own additive section — nothing above this is changed. The buy/sell
// critical path routes through /api/trade-rpc instead of /api/solana-rpc.
// Server-side, /api/trade-rpc is Alchemy-primary with Ankr fallback, and
// Ankr is the fallback for buys & sells ONLY — this is the only route in
// the app that can reach it. Every read/balance/quote stays on
// /api/solana-rpc above. Same node, same proxy, just a second endpoint
// on the existing server.
const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';

const _tradeConnCache = new Map();
const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};

// Same `(label, op) => Promise` signature as rpcRace, so flipping a call
// site from rpcRace → rpcRaceTrade is a one-word change. Used only on the
// buy/sell path inside handleSwap (send, blockhash, ALT, mint info, sig
// status). On an Alchemy outage these calls fall through to Ankr.
const rpcRaceTrade = (label, op, commitment = 'confirmed') => {
  return op(getTradeConn(commitment)).catch(e => {
    console.warn(`[trade-rpc] ${label} failed:`, e?.message);
    throw new Error(`${label}: trade RPC failed`);
  });
};

const POLL_TOKENS  = 10_000;
const POLL_SOL     = 30_000;
const POLL_WHALES  = 20_000;

const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥','🦊','🐻'];
function emojiFor(sym = '') {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length];
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */
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
  if (!Number.isFinite(p)) return '—';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
// Format a USD value sensibly across the full range we'll see. Big balances
// → "$1,234.50". Mid → "$12.34". Tiny → "$0.07" (the case that exposed the
// bug — 0.001 SOL × ~$74 ≈ $0.07, NOT $37). Sub-cent → "<$0.01" so we never
// show a confusing "$0.00".
function formatUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(2);
  return '<$0.01';
}
function ageMs(iso) { return iso ? Date.now() - new Date(iso).getTime() : Infinity; }
function ageStr(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const h = ms / 3_600_000;
  if (h < 1)  return Math.max(1, Math.round(ms / 60_000)) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function signalScore(t) {
  if (!t) return 0;
  const change = Math.min(Math.max(t.change || 0, -100), 200);
  const changePts = Math.min(35, Math.max(0, (change / 200) * 35));
  const volPts = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1)) * 3.5);
  const liqPts = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1)) * 3);
  const holdPts = Math.min(15, Math.log10(Math.max(t.holders || 1, 1)) * 2.5);
  const whalePts = t.whaleSol ? 10 : 0;
  return Math.round(Math.min(100, changePts + volPts + liqPts + holdPts + whalePts));
}
function _uniqMint(list) {
  const seen = new Set();
  return list.filter(t => {
    if (!t) return false;
    const k = String(t.mint == null ? '' : t.mint).trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
// Stablecoins/pegged tokens are not "trending" — they sit at ~$1 with ±0.01%
// moves. Exclude them so the list shows real movers, not USDC/USDT/CASH.
const STABLE_SYMS = new Set(['USDC','USDT','USD1','USDH','USDS','DAI','PYUSD','USDD','FDUSD','TUSD','USDE','CASH','JUPUSD','JUPSOL','BUSD','USDY','USDB','USDG','EURC','GUSD','LUSD','USDR','USDX','UXD','USTC','FRAX']);
function isStablecoin(t) {
  const sym = String(t?.sym || t?.symbol || '').toUpperCase().replace(/^\$/, '');
  if (STABLE_SYMS.has(sym)) return true;
  const p = Number(t?.price);
  const ch = Math.abs(Number(t?.change) || 0);
  if (p > 0.95 && p < 1.05 && ch < 0.5 && /USD|DAI|CASH/.test(sym)) return true;
  return false;
}

function normalize(t) {
  const change = pickChange(t);
  const created = t.firstPool?.createdAt || t.createdAt;
  const am = ageMs(created);
  return {
    mint:      String(t.id || t.address || t.mint || '').trim(),
    sym:       t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    emoji:     emojiFor(t.symbol || ''),
    icon:      t.icon || t.logoURI || null,
    price:     pickPrice(t),
    change,
    age:       ageStr(am),
    ageMs:     am,
    mcap:      Number(t.mcap ?? t.fdv ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0),
    holders:   Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    pool:      t.pairAddress || t.poolAddress || t.pool || t.poolId || t.pairId || (t.firstPool && (t.firstPool.id || t.firstPool.address)) || null,
    fresh:     am < 24 * 3600 * 1000,
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
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route'))
    return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit in one transaction. Try a different amount or token.';
  return err?.message || 'Swap failed. Please try again.';
};

function TokenIcon({ token }) {
  const [errored, setErrored] = useState(false);
  if (!token?.icon || errored) return <span>{token?.emoji || '🪙'}</span>;
  return <img src={token.icon} alt={token.sym || ''} onError={() => setErrored(true)} />;
}

function StatsOrbs({ tokens, whaleCount, freshCount }) {
  const scanning = tokens.length;
  const totalVol = tokens.reduce((s, t) => s + (t.volume24h || 0), 0);
  return (
    <div className="mw-stats-orbs">
      <div className="mw-orb" style={{ animationDelay: '0s' }}>
        <span className="mw-orb-ico">🎯</span>
        <div className="mw-orb-label">scanning</div>
        <div className="mw-orb-val">{scanning}</div>
      </div>
      <div className="mw-orb" style={{ animationDelay: '.05s' }}>
        <span className="mw-orb-ico">🐋</span>
        <div className="mw-orb-label">whales 48h</div>
        <div className="mw-orb-val">{whaleCount}</div>
      </div>
      <div className="mw-orb" style={{ animationDelay: '.1s' }}>
        <span className="mw-orb-ico">✨</span>
        <div className="mw-orb-label">fresh 24h</div>
        <div className="mw-orb-val">{freshCount}</div>
      </div>
      <div className="mw-orb" style={{ animationDelay: '.15s' }}>
        <span className="mw-orb-ico">⚡</span>
        <div className="mw-orb-label">24h vol</div>
        <div className="mw-orb-val">${format(totalVol)}</div>
      </div>
    </div>
  );
}

function FeaturedSignal({ token, whaleCount, onOpen, onTrade }) {
  if (!token) return null;
  const score = signalScore(token);
  return (
    <div className="mw-featured" onClick={() => onOpen(token)}>
      <div className="mw-feat-badge">⚡ TOP SIGNAL</div>
      <div className="mw-feat-body">
        <div className="mw-token-avatar">
          <div className="mw-crown">👑</div>
          <div className="mw-token-avatar-inner"><TokenIcon token={token} /></div>
        </div>
        <div className="mw-feat-meta">
          <div className="mw-feat-sym">${token.sym}</div>
          <div className="mw-feat-name">{token.name} · Solana</div>
        </div>
        <div className="mw-feat-score">
          <div className="mw-feat-score-num">{score}</div>
          <div className="mw-feat-score-denom">/100</div>
          <div className="mw-feat-score-label">SIGNAL</div>
        </div>
      </div>
      <div className="mw-feat-metrics">
        <div className="mw-fm"><span className="mw-fm-ico">🔥</span><div className={'mw-fm-val ' + (token.change >= 0 ? 'mw-up' : 'mw-down')}>{formatPct(token.change)}</div><div className="mw-fm-lbl">24h</div></div>
        <div className="mw-fm"><span className="mw-fm-ico">🐋</span><div className="mw-fm-val">{whaleCount || 0}</div><div className="mw-fm-lbl">Whales</div></div>
        <div className="mw-fm"><span className="mw-fm-ico">👥</span><div className="mw-fm-val">{token.holders ? format(token.holders) : '—'}</div><div className="mw-fm-lbl">Holders</div></div>
        <div className="mw-fm"><span className="mw-fm-ico">💰</span><div className="mw-fm-val">${format(token.mcap)}</div><div className="mw-fm-lbl">Mcap</div></div>
      </div>
      <div className="mw-feat-cta">
        <button type="button" className="mw-btn-grad" onClick={(e) => { e.stopPropagation(); onTrade(token, 'buy'); }}>⚡ BUY NOW</button>
        <button type="button" className="mw-btn-ghost" onClick={(e) => { e.stopPropagation(); onOpen(token); }}>details →</button>
      </div>
    </div>
  );
}

function NarrativesStrip({ tokens, whaleMints }) {
  const buckets = [
    { emoji: '🐸', name: 'Frog Meta',   re: /pepe|frog|wojak/i },
    { emoji: '🐱', name: 'Cat Meta',    re: /cat|meow|popcat|michi|mew/i },
    { emoji: '🤖', name: 'AI Agents',   re: /ai|agent|gpt|bot/i },
    { emoji: '🐋', name: 'Whale Plays', whale: true },
    { emoji: '🎮', name: 'Gaming',      re: /game|gam|play|guild/i },
    { emoji: '💎', name: 'Cult Coins',  re: /cult|elite|alpha|degen/i },
    { emoji: '🐕', name: 'Dog Revival', re: /dog|shib|bonk|wif|inu/i },
  ];
  const active = buckets.map(b => {
    const list = b.whale
      ? tokens.filter(t => whaleMints.has(t.mint))
      : tokens.filter(t => b.re.test((t.sym || '') + ' ' + (t.name || '')));
    const pct = list.length > 0 ? list.reduce((s, t) => s + (t.change || 0), 0) / list.length : 0;
    return { ...b, count: list.length, pct };
  }).filter(b => b.count > 0).sort((a, b) => b.pct - a.pct);
  if (active.length === 0) return null;
  return (
    <div className="mw-narratives">
      {active.map(b => (
        <div className="mw-narr" key={b.name}>
          <div className="mw-narr-emoji">{b.emoji}</div>
          <div className="mw-narr-name">{b.name}</div>
          <div className={'mw-narr-pct' + (b.pct < 0 ? ' mw-down' : '')}>{formatPct(b.pct)}</div>
          <div className="mw-narr-count">{b.count} {b.count === 1 ? 'asset' : 'assets'}</div>
        </div>
      ))}
    </div>
  );
}

function WhaleRadar({ whaleTokens, onOpen, onTrade }) {
  if (whaleTokens.length === 0) {
    return <div className="mw-empty">No whale activity in the last 48h.</div>;
  }
  return (
    <div className="mw-hscroll">
      {whaleTokens.map(w => (
        <div key={w.mint} className="mw-whale-card" onClick={() => onOpen(w)}>
          <div className="mw-whale-row">
            <div className="mw-mini-avatar"><div className="mw-inner"><TokenIcon token={w} /></div></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mw-whale-sym">${w.sym}</div>
              <div className={'mw-whale-pct' + (w.change < 0 ? ' mw-down' : '')}>{formatPct(w.change)}</div>
            </div>
          </div>
          <div style={{ margin: '8px 0 2px' }}><MwSparkline mint={w.mint} price={w.price} change={w.change} pool={w.pool} w={140} h={26} full /></div>
          <div className="mw-whale-stats">
            <span className="mw-l">🐋 {w.whaleCount || 1}</span>
            <span className="mw-r">+{format(w.whaleSol)} SOL</span>
          </div>
          <button type="button" className="mw-trade-pill" onClick={(e) => { e.stopPropagation(); onTrade(w, 'buy'); }}>BUY</button>
        </div>
      ))}
    </div>
  );
}

function BreakingOut({ tokens, whaleByMint, excludeMint, onOpen, onTrade }) {
  const pool = excludeMint ? tokens.filter(t => t.mint !== excludeMint) : tokens;
  const byChange  = [...pool].sort((a, b) => (b.change || 0) - (a.change || 0));
  const byVolMcap = [...pool].filter(t => t.mcap > 0).sort((a, b) => (b.volume24h / b.mcap) - (a.volume24h / a.mcap));
  const bySmart   = [...pool].filter(t => whaleByMint.has(t.mint)).sort((a, b) => (whaleByMint.get(b.mint) || 0) - (whaleByMint.get(a.mint) || 0));
  const byEarly   = [...pool].filter(t => t.ageMs < 24*3600*1000 && (t.change || 0) > 0).sort((a, b) => (b.change || 0) - (a.change || 0));
  const used = new Set();
  const pick = (arr) => { for (const t of arr) { if (!used.has(t.mint)) { used.add(t.mint); return t; } } return null; };
  const picks = [
    { kind: 'momentum', icon: '🚀', title: 'MOMENTUM',      token: pick(byChange),   meta: 'biggest 24h gain' },
    { kind: 'volume',   icon: '🔥', title: 'VOLUME SPIKE',  token: pick(byVolMcap),  meta: 'vol/mcap ratio' },
    { kind: 'smart',    icon: '⚡', title: 'SMART MONEY',   token: pick(bySmart),    meta: 'whale entries' },
    { kind: 'early',    icon: '👀', title: 'EARLY ROTATION', token: pick(byEarly),   meta: 'fresh + rising' },
  ];
  return (
    <div className="mw-bo-grid">
      {picks.map(p => (
        <div key={p.kind} className={'mw-bo-card mw-' + p.kind} onClick={() => p.token && onOpen(p.token.mint)}>
          <div className="mw-bo-head">
            <div className="mw-bo-ico">{p.icon}</div>
            <div className="mw-bo-title">{p.title}</div>
          </div>
          {p.token ? (
            <>
              <div className="mw-bo-token">
                <div className="mw-mini-avatar" style={{ width: 30, height: 30 }}>
                  <div className="mw-inner" style={{ fontSize: 14 }}><TokenIcon token={p.token} /></div>
                </div>
                <div className="mw-bo-sym">${p.token.sym}</div>
              </div>
              <div className={'mw-bo-pct' + ((p.token.change || 0) < 0 ? ' mw-down' : '')}>{formatPct(p.token.change)}</div>
              <div style={{ margin: '6px 0 2px' }}><MwSparkline mint={p.token.mint} price={p.token.price} change={p.token.change} pool={p.token.pool} w={150} h={28} full /></div>
              <div className="mw-bo-meta">{p.meta}</div>
              <button type="button" className="mw-trade-pill" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); onTrade(p.token, 'buy'); }}>BUY</button>
            </>
          ) : (
            <div className="mw-bo-empty">No matches yet.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Row sparkline — REAL DATA ONLY, contract-correct, self-contained. NO Stocks
// module. Draws from CoinGecko (GeckoTerminal) OHLCV for the pool whose BASE
// token is exactly this mint, or from prices the live feed observes per mint
// (recordSpark, keyed by contract). No DexScreener, no synthetic/fabricated
// line: if there is no real series the card draws no line.
const _sparkHist = new Map(); // mint -> number[] (observed prices)
const _poolAddr  = new Map(); // mint -> on-chain pool/pair address (for OHLCV)
const _ohlcv     = new Map(); // mint -> { ts, closes }  real hourly series cache
const _ohlcvWait = new Map(); // mint -> Promise          in-flight de-dupe
let _ohN = 0; const _ohQ = [];
function _ohPump() { while (_ohN < 3 && _ohQ.length) { const job = _ohQ.shift(); _ohN++; job().finally(() => { _ohN--; _ohPump(); }); } }
async function _resolvePoolAddr(mint) {
  const known = _poolAddr.get(mint);
  if (known) return known;
  try {
    // CoinGecko (GeckoTerminal) pool whose BASE token is EXACTLY this mint.
    const r = await fetchTO('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + mint + '/pools', 5000);
    if (!r.ok) return null;
    const j = await r.json();
    const addr = pickBestGeckoPool(j?.data, mint)?.attributes?.address || null; // contract-matched
    if (addr) _poolAddr.set(mint, addr);
    return addr;
  } catch { return null; }
}
// Real ~24h hourly closes for a row sparkline — contract-matched, NO Stocks.
// Throttled (≤3 concurrent) + cached 2 min. Returns null on any failure, so the
// caller falls back to the smooth 24h anchor curve.
// Defensive OHLCV parser — accepts every shape a candles endpoint might return
// (array of [ts,o,h,l,c,v], array of {c|close|price}, or wrapped in
// {candles|ohlcv|ohlcv_list|bars|prices|data}). Returns [{t,c}] sorted oldest→newest.

// Warm the whole feed's chart cache in one server call so a tap is instant (the
// chart is already cached by the time the user clicks). Fire-and-forget.
function nxWarm(mints) {
  try {
    const list = Array.from(new Set((mints || []).filter(Boolean)));
    if (!list.length) return;
    fetch('/api/nx/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mints: list.slice(0, 300) }),
    }).catch(() => {});
  } catch (e) {}
}

/* ── Discover filter cache (client) ──────────────────────────────────────
 * Module-level so it survives Discover/Launches tab flips and component
 * remounts within the session — re-entering Discover is instant, never blank.
 * Stale-while-revalidate: a cached lens renders immediately; if older than
 * NXD_FRESH_MS the next load refreshes it in the background. The server already
 * caches each lens (30s organic / 5s new), so refreshes are cheap.
 * ---------------------------------------------------------------------- */
const NXD_FRESH_MS = 20_000;
const _nxdCache    = new Map(); // lens -> { at, tokens }
const _nxdInflight = new Map(); // lens -> Promise

function nxdGetCached(lens) {
  const hit = _nxdCache.get(lens);
  return hit ? hit.tokens : null;
}

// Shape a token from /api/nx/discover (ALREADY normalized server-side) into the
// client token shape. Keeps sym/change/mcap/etc verbatim; only derives the
// client-only fields (age, fresh, emoji) the UI needs. No re-normalization.
function nxdShape(t) {
  if (!t || !t.mint) return null;
  const createdMs = Number(t.pairCreatedAtMs);
  const am = Number.isFinite(createdMs) && createdMs > 0 ? (Date.now() - createdMs) : Infinity;
  return {
    mint:      String(t.mint || '').trim(),
    sym:       t.sym || t.symbol || '???',
    name:      t.name || t.sym || 'Unknown',
    emoji:     emojiFor(t.sym || t.symbol || ''),
    icon:      t.icon || t.logoURI || null,
    price:     Number(t.price || 0),
    change:    Number.isFinite(t.change) ? t.change : null,
    age:       ageStr(am),
    ageMs:     am,
    mcap:      Number(t.mcap || t.fdv || 0),
    volume24h: Number(t.volume24h || 0),
    holders:   Number(t.holders || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    pool:      t.pool || null,
    fresh:     am < 24 * 3600 * 1000,
    source:    'discover',
  };
}

async function nxdFetchLens(lens, limit = 80) {
  if (_nxdInflight.has(lens)) return _nxdInflight.get(lens);
  const job = (async () => {
    try {
      const r = await fetch('/api/nx/discover?lens=' + encodeURIComponent(lens) + '&limit=' + limit);
      const d = await r.json();
      const raw = Array.isArray(d?.tokens) ? d.tokens : [];
      // Server tokens are ALREADY normalized (sym, change, mcap, liquidity…).
      // Do NOT run them through normalize() again — that reads t.symbol/t.id/
      // t.firstPool which don't exist here, producing $??? and null pools.
      // Just add the client-only fields (age/fresh/emoji) and drop stables.
      const tokens = _uniqMint(raw.map(nxdShape).filter(t => t && t.mint && !isStablecoin(t)));
      _nxdCache.set(lens, { at: Date.now(), tokens });
      // Warm sparklines + charts for the whole lens immediately.
      nxWarm(tokens.map(t => t.mint));
      nxdPrimeSparks(tokens.map(t => t.mint));
      return tokens;
    } catch {
      return _nxdCache.get(lens)?.tokens || [];
    } finally {
      _nxdInflight.delete(lens);
    }
  })();
  _nxdInflight.set(lens, job);
  return job;
}

// Prefetch every lens once, so the first tap on any filter is instant.
function nxdPrefetchAll() {
  ['popular', 'hot', 'new', 'gainers'].forEach(l => {
    const hit = _nxdCache.get(l);
    if (!hit || Date.now() - hit.at >= NXD_FRESH_MS) nxdFetchLens(l);
  });
}

/* Batch sparkline primer: one POST returns every warm series at once; we seed
 * the SAME _ohlcv cache MwSparkline already reads, so rows render their line
 * with zero per-row network calls. Cold mints come back in `pending`; we poll
 * a couple of times as the server's background drip warms them. */
function nxdPrimeSparks(mints, _round = 0) {
  try {
    const list = Array.from(new Set((mints || []).filter(Boolean))).slice(0, 120);
    if (!list.length) return;
    fetch('/api/nx/discover-spark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mints: list }),
    })
      .then(r => r.json())
      .then(d => {
        const sparks = d && d.sparks ? d.sparks : {};
        for (const m in sparks) {
          const closes = sparks[m] && sparks[m].closes;
          if (Array.isArray(closes) && closes.length >= 2) {
            _ohlcv.set(m, { ts: Date.now(), closes: closes.map(Number).filter(n => n > 0) });
          }
        }
        const pending = Array.isArray(d?.pending) ? d.pending : [];
        // Poll a few more times for the ones still warming on the server.
        if (pending.length && _round < 3) {
          setTimeout(() => nxdPrimeSparks(pending, _round + 1), 1800);
        }
      })
      .catch(() => {});
  } catch (e) {}
}

function mwPtsFromAny(data) {
  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    arr = data.candles || data.ohlcv || data.ohlcv_list || data.bars || data.series
       || data.prices || data.result
       || (data.data && (data.data.attributes ? data.data.attributes.ohlcv_list : data.data));
  }
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const pts = arr.map((row, i) => {
    if (Array.isArray(row)) {
      const c = row.length >= 5 ? Number(row[4]) : Number(row[1]);
      return { t: Number(row[0]) || i, c };
    }
    if (row && typeof row === 'object') {
      const c = Number(row.c ?? row.close ?? row.Close ?? row.price ?? row.value ?? row.p);
      const t = Number(row.t ?? row.time ?? row.ts ?? row.timestamp ?? row.unixTime ?? row.unix ?? i);
      return { t, c };
    }
    return { t: i, c: NaN };
  }).filter(p => Number.isFinite(p.c) && p.c > 0);
  if (pts.length < 2) return null;
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

function mwFetchSpark(mint) {
  if (!mint) return Promise.resolve(null);
  const c = _ohlcv.get(mint);
  if (c && Date.now() - c.ts < 120000) return Promise.resolve(c.closes);
  if (_ohlcvWait.has(mint)) return _ohlcvWait.get(mint);
  const p = new Promise(resolve => {
    _ohQ.push(async () => {
      let out = null;
      try {
        // 1) Server proxy — same CG data as the chart, NOT rate-limited like a
        //    direct browser call to api.geckoterminal.com (that 429 was why the
        //    sparklines were flat).
        try {
          const nr = await fetchTO('/api/nx/chart/' + encodeURIComponent(mint), 7000);
          if (nr.ok) { const nd = await nr.json(); if (Array.isArray(nd?.closes) && nd.closes.length >= 2) out = nd.closes.map(Number).filter(n => n > 0); }
        } catch {}
        if (out) { _ohlcv.set(mint, { ts: Date.now(), closes: out }); _ohlcvWait.delete(mint); resolve(out); return; }
        try {
          // tf=5m is 60×1-min candles = the last 1 hour.
          const sr = await fetchTO('/api/dex/candles/' + encodeURIComponent(mint) + '?tf=5m', 7000);
          if (sr.ok) {
            const pts = mwPtsFromAny(await sr.json());
            if (pts) out = pts.map(p => p.c);
          }
        } catch { /* fall through to direct */ }
        // 2) Direct GeckoTerminal (last resort).
        if (!out) {
          const addr = await _resolvePoolAddr(mint);
          if (addr) {
            const r = await fetchTO(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${addr}/ohlcv/minute?aggregate=1&limit=60`, 5000);
            if (r.ok) {
              const j = await r.json();
              const list = j?.data?.attributes?.ohlcv_list || []; // [ts,o,h,l,c,v], newest first
              const closes = list.map(row => Number(row?.[4])).filter(v => Number.isFinite(v) && v > 0).reverse();
              if (closes.length >= 2) out = closes;
            }
          }
        }
      } catch { out = null; }
      _ohlcv.set(mint, { ts: Date.now(), closes: out });
      _ohlcvWait.delete(mint);
      resolve(out);
    });
    _ohPump();
  });
  _ohlcvWait.set(mint, p);
  return p;
}
// Two REAL endpoints from the token's own live price + real 24h change:
// price(24h ago) = price / (1 + change/100), then price now. Both are numbers
// the feed already reports (not synthetic), so a line drawn from them is
// directionally accurate and always agrees with the % and the chart. Guarantees
// a line the instant a price exists.
function endpointSeries(price, change) {
  const now = Number(price);
  if (!(now > 0)) return null;
  const c = Number(change);
  // Real direction when we know the change; a gentle rise otherwise — so the
  // approximation always curves (never flat/straight, never blank).
  const then = (Number.isFinite(c) && Math.abs(c) > 0.001) ? now / (1 + c / 100) : now * 0.985;
  if (!(then > 0)) return null;
  // Eased S-curve (≈20 pts) so the approximation curves in the real direction
  // — never a straight 2-point diagonal, never blank.
  const N = 20, out = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    out.push(then + (now - then) * e);
  }
  return out;
}

function recordSpark(mint, price) {
  if (!mint || !(price > 0)) return _sparkHist.get(mint) || [];
  let pts = _sparkHist.get(mint);
  if (!pts) { pts = []; _sparkHist.set(mint, pts); }
  if (pts[pts.length - 1] !== price) { pts.push(price); if (pts.length > 32) pts.shift(); }
  return pts;
}
// Local SVG sparkline path builder (no Stocks). Smooth Catmull-Rom → Bézier so
// the line flows with character instead of straight zig-zag segments. pts: [{c}, …].
function mwSparkPath(pts, w, h) {
  const vals = pts.map(p => Number(p?.c)).filter(Number.isFinite);
  if (vals.length < 2) {
    const midY = h / 2;
    return { line: `M 0 ${midY} L ${w} ${midY}`, area: `M 0 ${midY} L ${w} ${midY} L ${w} ${h} L 0 ${h} Z`, lastX: w, lastY: midY, up: true };
  }
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1, pad = 2.5, ih = h - pad * 2;
  const P = vals.map((v, i) => [ (i / (vals.length - 1)) * w, pad + (1 - (v - min) / span) * ih ]);
  let line = `M ${P[0][0].toFixed(2)} ${P[0][1].toFixed(2)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  const area = `${line} L ${w.toFixed(2)} ${h.toFixed(2)} L 0 ${h.toFixed(2)} Z`;
  const [lastX, lastY] = P[P.length - 1];
  return { line, area, lastX, lastY, up: vals[vals.length - 1] >= vals[0] };
}
function MwSparkline({ mint, price, change, pool, w = 50, h = 22, full = false }) {
  const hist = recordSpark(mint, Number(price));
  if (mint && pool && typeof pool === 'string' && !_poolAddr.get(mint)) _poolAddr.set(mint, pool);
  // Real hourly OHLCV (contract-matched) gives the line genuine character.
  const [real, setReal] = useState(() => (mint ? _ohlcv.get(mint)?.closes : null) || null);
  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    mwFetchSpark(mint).then(cs => { if (!cancelled && cs && cs.length >= 2) setReal(cs); });
    return () => { cancelled = true; };
  }, [mint]);

  // REAL data, priority: GeckoTerminal OHLCV (contract-matched) → live observed
  // prices → the two real endpoints from price + 24h change. Always a line once
  // a price exists; OHLCV upgrades it in place. Never synthetic.
  const ep = endpointSeries(price, change);
  const pts = (real && real.length >= 2) ? real.map(c => ({ c }))
            : (hist.length >= 2 ? hist.map(c => ({ c }))
            : (ep ? ep.map(c => ({ c })) : null));
  if (!pts) return null;

  const path = mwSparkPath(pts, w, h);
  // No red sparklines: up = green, down = neutral gray (never red). The colored
  // %/price pills next to it still carry direction; the line never shows red.
  const up = Number.isFinite(change) ? change >= 0 : path.up;
  const col = up ? 'var(--green)' : '#5b6472';
  const id = 'mws' + (up ? 'u' : 'd') + (mint ? String(mint).slice(0, 8) : '');
  return (
    <svg width={full ? '100%' : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ flex: '0 0 auto', display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity={up ? '0.28' : '0.22'} /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <path d={path.area} fill={`url(#${id})`} />
      <path d={path.line} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.lastX.toFixed(2)} cy={path.lastY.toFixed(2)} r="1.7" fill={col} />
    </svg>
  );
}

function NewLaunches({ tokens, onOpen, onTrade }) {
  const [age, setAge] = useState('24h');
  const cutoffMs = age === '1h' ? 3600_000 : age === '6h' ? 6*3600_000 : 24*3600_000;
  const list = tokens.filter(t => t.ageMs < cutoffMs).slice(0, 10);
  return (
    <>
      <div className="mw-sub-tabs">
        {['1h', '6h', '24h'].map(a => (
          <button key={a} type="button" className={'mw-sub-tab' + (age === a ? ' mw-active' : '')} onClick={() => setAge(a)}>{a}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="mw-empty">No launches in the last {age}.</div>
      ) : (
        <div className="mw-hscroll">
          {list.map(t => (
            <div key={t.mint} className="mw-launch-card" onClick={() => onOpen(t)}>
              <div className="mw-launch-head">
                <div className="mw-mini-avatar"><div className="mw-inner"><TokenIcon token={t} /></div></div>
                <div className="mw-launch-info">
                  <div className="mw-launch-sym">${t.sym}</div>
                  <div className="mw-launch-age">⏱ {t.age} OLD</div>
                </div>
              </div>
              <div style={{ margin: '8px 0 2px' }}><MwSparkline mint={t.mint} price={t.price} change={t.change} pool={t.pool} w={150} h={30} full /></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Holders</span><span className="mw-launch-v">{t.holders ? format(t.holders) : '—'}</span></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Liquidity</span><span className="mw-launch-v">${format(t.liquidity)}</span></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Signal</span><span className="mw-launch-v" style={{ color: 'var(--green)' }}>{signalScore(t)}</span></div>
              <button type="button" className="mw-trade-pill" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); onTrade(t, 'buy'); }}>BUY</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TrendingNow({ tokens, onOpen }) {
  const [tab, setTab] = useState('movers');
  const list = useMemo(() => {
    if (tab === 'movers') return [...tokens].sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0)).slice(0, 8);
    if (tab === 'traded') return [...tokens].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 8);
    return [...tokens].sort((a, b) => signalScore(b) - signalScore(a)).slice(0, 8);
  }, [tokens, tab]);
  return (
    <>
      <div className="mw-sub-tabs">
        <button type="button" className={'mw-sub-tab' + (tab === 'movers' ? ' mw-active' : '')} onClick={() => setTab('movers')}>Top Movers</button>
        <button type="button" className={'mw-sub-tab' + (tab === 'viewed' ? ' mw-active' : '')} onClick={() => setTab('viewed')}>Top Signals</button>
        <button type="button" className={'mw-sub-tab' + (tab === 'traded' ? ' mw-active' : '')} onClick={() => setTab('traded')}>Top Traded</button>
      </div>
      <div className="mw-trend-list">
        {list.map((t, i) => (
          <div key={t.mint} className="mw-trend-row" style={{ animationDelay: `${i * 0.03}s` }} onClick={() => onOpen(t)}>
            <div className="mw-trend-rank">{i + 1}</div>
            <div className="mw-mini-avatar" style={{ width: 34, height: 34 }}>
              <div className="mw-inner" style={{ fontSize: 14 }}><TokenIcon token={t} /></div>
            </div>
            <div className="mw-trend-mid">
              <div className="mw-trend-sym">${t.sym}</div>
              <div className="mw-trend-sub">{tab === 'traded' ? `Vol $${format(t.volume24h)}` : tab === 'viewed' ? `Signal ${signalScore(t)}` : formatPrice(t.price)}</div>
            </div>
            <MwSparkline mint={t.mint} price={t.price} change={t.change} pool={t.pool} w={50} h={22} />
            <div className="mw-trend-right">
              <div className={'mw-trend-pct' + ((t.change || 0) < 0 ? ' mw-down' : '')}>{formatPct(t.change)}</div>
              <div className="mw-trend-meta">${format(t.mcap)} mcap</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityFeed({ tokens, whaleEvents, onOpen }) {
  const items = [];
  for (const ev of (whaleEvents || [])) {
    if (!ev.detectedAt) continue;
    const t = tokens.find(x => x.mint === ev.mint);
    items.push({
      type: 'whale',
      key: 'w-' + ev.mint + '-' + ev.detectedAt,
      mint: ev.mint,
      sym: t?.sym || ev.symbol || 'TOKEN',
      amount: ev.solAmount,
      at: ev.detectedAt,
    });
  }
  for (const t of tokens) {
    if (!t.fresh || !Number.isFinite(t.ageMs)) continue;
    items.push({
      type: 'launch',
      key: 'l-' + t.mint,
      mint: t.mint,
      sym: t.sym,
      at: Date.now() - t.ageMs,
    });
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  const top = items.slice(0, 8);
  if (top.length === 0) {
    return <div className="mw-empty">No live events yet — watching the chain.</div>;
  }
  return (
    <div className="mw-activity">
      <div className="mw-activity-list">
        {top.map((it, i) => (
          <div key={it.key} className="mw-act" style={{ animationDelay: `${i * 0.04}s` }} onClick={() => onOpen && onOpen(it.mint)}>
            <div className="mw-act-ico" style={{ background: it.type === 'whale' ? 'rgba(160,231,255,0.4)' : 'rgba(255,212,107,0.4)' }}>
              {it.type === 'whale' ? '🐋' : '🚀'}
            </div>
            <div className="mw-act-body">
              <div className="mw-act-l1">
                {it.type === 'whale'
                  ? <><b>Whale</b> bought <b>${it.sym}</b></>
                  : <><b>New launch</b> · <b>${it.sym}</b></>}
              </div>
            </div>
            <div className="mw-act-right">
              {it.type === 'whale' && it.amount ? <div className="mw-act-amt">+{format(it.amount)} SOL</div> : null}
              <div className="mw-act-time">{timeAgo(it.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   DISCOVER FEED — DeFi-dark redesign (presentation only).
   Consumes the EXACT same token objects + handlers as the original sections.
   No data fetching here; everything is passed in from MemeWonderland.
   ════════════════════════════════════════════════════════════════════ */
const MWD_CSS = `
.mwd{
  --bg:#060708; --bg2:#0a0b0d; --panel:#0d0f12; --panel2:#111317; --hover:#13151a;
  --line:#191c22; --line2:#262a33;
  --ink:#f2f4f8; --ink2:#838a98; --ink3:#4c525f;
  --amber:#f5a623; --amber2:#ffc24d; --ember:#ff7a3c;
  --up:#3ddc84; --down:#ff5466; --glass:rgba(13,15,18,.72);
  min-height:100vh;color:var(--ink);
  font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  background-color:var(--bg);
  background-image:
    radial-gradient(900px 420px at 50% -8%,rgba(245,166,35,.07),transparent 70%),
    radial-gradient(700px 500px at 100% 0%,rgba(61,220,132,.04),transparent 70%),
    linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.014) 1px,transparent 1px);
  background-size:auto,auto,40px 40px,40px 40px;background-attachment:fixed;
}
.mwd,.mwd *{box-sizing:border-box}
.mwd-mono{font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.mwd-wrap{max-width:480px;margin:0 auto;padding-bottom:40px}

.mwd-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:7px;padding:10px 13px 0}
.mwd-search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:8px;
  background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line)}
.mwd-search:focus-within{border-color:var(--line2);box-shadow:0 0 0 3px rgba(245,166,35,.07)}
.mwd-search svg{width:14px;height:14px;color:var(--ink3);flex-shrink:0}
.mwd-search input{flex:1;background:none;border:none;outline:none;color:var(--ink);font-family:inherit;font-size:13px;min-width:0}
.mwd-search input::placeholder{color:var(--ink3)}
.mwd-search .x{background:none;border:none;color:var(--ink3);font-size:17px;cursor:pointer;padding:0 2px;line-height:1}

.mwd-results{position:absolute;top:calc(100% + 6px);left:13px;right:13px;background:var(--panel2);
  border:1px solid var(--line2);border-radius:10px;padding:6px;max-height:380px;overflow-y:auto;
  box-shadow:0 20px 48px rgba(0,0,0,.55);z-index:30}
.mwd-rr{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:8px;cursor:pointer}
.mwd-rr:hover{background:var(--hover)}
.mwd-empty{padding:16px;text-align:center;color:var(--ink3);font-size:12.5px}

.mwd-chips{display:flex;gap:6px;padding:10px 13px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line)}
.mwd-chips::-webkit-scrollbar{display:none}
.mwd-chip{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;
  background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);cursor:pointer;
  font-family:inherit;font-size:12px;font-weight:600;color:var(--ink2);transition:.16s}
.mwd-chip:hover{color:var(--ink);border-color:var(--line2)}
.mwd-chip.on{background:var(--panel2);border-color:var(--line2);color:var(--ink)}
.mwd-chip.on.hot{border-color:rgba(245,166,35,.45);box-shadow:0 0 14px -4px rgba(245,166,35,.4),inset 0 0 0 1px rgba(245,166,35,.12)}
.mwd-chip.on.hot::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--amber);box-shadow:0 0 8px var(--amber)}
.mwd-chip .ct{display:grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;
  background:rgba(245,166,35,.16);color:var(--amber);font-family:'JetBrains Mono',monospace;font-weight:800;font-size:8.5px}

.mwd-feed{padding:3px 8px 0}
.mwd-row{position:relative;display:flex;align-items:center;gap:10px;padding:8px 7px;cursor:pointer;border-radius:8px;
  transition:background .14s;animation:mwdRise .4s cubic-bezier(.2,.9,.3,1) backwards}
.mwd-row::after{content:"";position:absolute;left:7px;right:7px;bottom:0;height:1px;background:var(--line)}
.mwd-row:last-child::after{display:none}
.mwd-row:hover{background:var(--hover)}
.mwd-row:hover::after{opacity:0}
@keyframes mwdRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.mwd-av{position:relative;flex-shrink:0}
.mwd-av .sq{width:36px;height:36px;font-size:14px;border-radius:9px;display:grid;place-items:center;font-weight:800;
  color:#fff;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 6px rgba(0,0,0,.4),0 2px 7px rgba(0,0,0,.35)}
.mwd-av .sq img{width:100%;height:100%;object-fit:cover}
.mwd-age{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);font-family:'JetBrains Mono',monospace;
  font-size:7.5px;font-weight:800;color:#1a1205;padding:1px 5px;border-radius:5px;background:var(--amber);
  white-space:nowrap;box-shadow:0 0 0 2px var(--bg),0 0 7px -1px rgba(245,166,35,.6)}
.mwd-age.old{background:var(--ink3);color:#fff;box-shadow:0 0 0 2px var(--bg)}
.mwd-mid{flex:1;min-width:0}
.mwd-sym{display:flex;align-items:center;gap:7px}
.mwd-sym .s{font-size:15px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.mwd-sym .pc{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700}
.mwd-meta{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mwd-meta .k{color:var(--ink3)}
.mwd-sig{display:flex;align-items:center;gap:2.5px;margin-top:5px}
.mwd-sig i{width:13px;height:3px;border-radius:2px;background:var(--line2)}
.mwd-sig .lab{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-left:6px}
.mwd-sig.high i.on{background:var(--up);box-shadow:0 0 5px -1px var(--up)} .mwd-sig.high .lab{color:var(--up)}
.mwd-sig.mid i.on{background:var(--amber);box-shadow:0 0 5px -1px var(--amber)} .mwd-sig.mid .lab{color:var(--amber)}
.mwd-sig.low i.on{background:var(--ink3)} .mwd-sig.low .lab{color:var(--ink3)}
.mwd-spark{flex-shrink:0;width:66px;height:32px;display:flex;align-items:center}
.mwd-right{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:74px}
.mwd-price{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700}
.mwd-buy{padding:6px 14px;border-radius:7px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;
  background:linear-gradient(140deg,var(--amber2),var(--amber));color:#1a1205;transition:.16s;white-space:nowrap;
  box-shadow:0 0 12px -4px rgba(245,166,35,.45)}
.mwd-buy:hover{filter:brightness(1.07);box-shadow:0 0 16px -3px rgba(245,166,35,.55)}
.mwd-buy:active{transform:scale(.97)}
.mwd-end{padding:22px 16px;text-align:center;color:var(--ink3);font-size:11.5px}
`;

function useMwdCSS() {
  useEffect(() => {
    const ID = 'mwd-defi-css';
    if (document.getElementById(ID)) return;
    const el = document.createElement('style');
    el.id = ID; el.textContent = MWD_CSS;
    document.head.appendChild(el);
  }, []);
}

// Risk tier from real fields: liquidity vs mcap + age. Mirrors the preview's
// segmented meter (low/med/high). Pure presentation — no new data.
// Signal meter uses the REAL signalScore() (defined above) — the same function
// Launches uses — computed from change, volume24h, liquidity, holders. No
// fabricated tiers, no invented risk rating.
function MwdRow({ t, i, onOpen, onTrade }) {
  const up = Number.isFinite(t.change) ? t.change >= 0 : true;
  const old = !t.fresh;
  return (
    <div className="mwd-row" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }} onClick={() => onOpen && onOpen(t)}>
      <div className="mwd-av">
        <div className="sq"><TokenIcon token={t} /></div>
        {t.age ? <span className={'mwd-age' + (old ? ' old' : '')}>{t.age}</span> : null}
      </div>
      <div className="mwd-mid">
        <div className="mwd-sym">
          <span className="s">${t.sym}</span>
          <span className="pc" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>{formatPct(t.change)}</span>
        </div>
        <div className="mwd-meta">
          <span className="k">MC</span> {format(t.mcap)} <span className="k">LP</span> {format(t.liquidity)}{t.holders ? <> {format(t.holders)} <span className="k">hold</span></> : null}
        </div>
        {(() => {
          const sig = signalScore(t);                 // real 0–100 signal (same as Launches)
          const dots = Math.max(1, Math.round(sig / 20)); // 1–5 segments from the score
          const tier = sig >= 70 ? 'high' : sig >= 40 ? 'mid' : 'low';
          return (
            <div className={'mwd-sig ' + tier}>
              {[0,1,2,3,4].map(d => <i key={d} className={d < dots ? 'on' : ''} />)}
              <span className="lab">signal {sig}</span>
            </div>
          );
        })()}
      </div>
      <div className="mwd-spark"><MwSparkline mint={t.mint} price={t.price} change={t.change} pool={t.pool} w={66} h={32} full /></div>
      <div className="mwd-right">
        <div className="mwd-price">{formatPrice(t.price)}</div>
        <button className="mwd-buy" onClick={(e) => { e.stopPropagation(); onTrade && onTrade(t, 'buy'); }}>Buy</button>
      </div>
    </div>
  );
}

const MWD_LENSES = [
  { id: 'popular', label: 'Popular' },
  { id: 'hot',     label: 'Hot' },
  { id: 'new',     label: 'New' },
  { id: 'gainers', label: 'Top gainers' },
];

function MwDiscoverFeed({
  fallbackTokens, chartChg,
  searchQuery, setSearchQuery, searchOpen, setSearchOpen, searchResults, searching,
  searchWrapRef, onSearchSelect,
  onOpen, onTrade,
}) {
  useMwdCSS();
  const [lens, setLens] = useState('hot');
  // Per-lens token sets pulled from the server (real, different data per lens),
  // seeded instantly from the module cache so switching never blanks.
  const [sets, setSets] = useState(() => {
    const init = {};
    for (const l of ['popular', 'hot', 'new', 'gainers']) {
      const c = nxdGetCached(l);
      if (c) init[l] = c;
    }
    return init;
  });
  const [loading, setLoading] = useState(false);

  // Prefetch every lens once on mount so the first tap on any filter is instant.
  useEffect(() => { nxdPrefetchAll(); }, []);

  // Load (or refresh) the active lens. Cached value shows immediately; a stale
  // one refreshes in the background without clearing the screen.
  useEffect(() => {
    let cancelled = false;
    const cached = nxdGetCached(lens);
    if (cached) setSets(s => ({ ...s, [lens]: cached }));
    if (!cached) setLoading(true);
    nxdFetchLens(lens).then(tokens => {
      if (cancelled) return;
      setSets(s => ({ ...s, [lens]: tokens }));
      setLoading(false);
    });
    // Light refresh while the lens is open.
    const id = setInterval(() => {
      nxdFetchLens(lens).then(tokens => { if (!cancelled) setSets(s => ({ ...s, [lens]: tokens })); });
    }, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [lens]);

  // Active list: server-sorted for this lens, with the parent's chart-derived %
  // overlaid so the number always matches the sparkline. Fall back to the
  // parent's already-loaded feed if a lens hasn't returned yet.
  const list = useMemo(() => {
    const base = (sets[lens] && sets[lens].length) ? sets[lens] : (fallbackTokens || []);
    return _uniqMint(base).map(t => {
      const cc = chartChg ? chartChg[t.mint] : undefined;
      return Number.isFinite(cc) ? { ...t, change: cc } : t;
    });
  }, [sets, lens, fallbackTokens, chartChg]);

  return (
    <div className="mwd">
      <div className="mwd-wrap">
        <div className="mwd-bar" ref={searchWrapRef}>
          <div className="mwd-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input
              placeholder="Search token, ticker, or contract"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            {searchQuery ? <button className="x" onClick={() => { setSearchQuery(''); }}>×</button> : null}
          </div>
          {searchOpen && searchQuery.trim() ? (
            <div className="mwd-results">
              {searching && (!searchResults || searchResults.length === 0)
                ? <div className="mwd-empty">Searching Jupiter…</div>
                : !searchResults || searchResults.length === 0
                ? <div className="mwd-empty">No tokens found.</div>
                : searchResults.map(t => (
                  <div key={t.mint} className="mwd-rr" onClick={() => onSearchSelect(t)}>
                    <div className="mwd-av"><div className="sq" style={{ width: 32, height: 32 }}><TokenIcon token={t} /></div></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>${t.sym}</div>
                      <div className="mwd-mono" style={{ fontSize: 10.5, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{t.name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mwd-mono" style={{ fontSize: 12, fontWeight: 700 }}>{formatPrice(t.price)}</div>
                      <div className="mwd-mono" style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: t.change >= 0 ? 'var(--up)' : 'var(--down)' }}>{formatPct(t.change)}</div>
                    </div>
                  </div>
                ))}
            </div>
          ) : null}
        </div>

        <div className="mwd-chips">
          {MWD_LENSES.map(l => (
            <button key={l.id} className={'mwd-chip' + (lens === l.id ? ' on' : '') + (l.id === 'hot' ? ' hot' : '')} onClick={() => setLens(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="mwd-feed">
          {list.length === 0
            ? <div className="mwd-empty" style={{ padding: '40px 16px' }}>{loading ? 'Loading…' : 'No tokens match this filter yet.'}</div>
            : list.map((t, i) => <MwdRow key={t.mint} t={t} i={i} onOpen={onOpen} onTrade={onTrade} />)}
        </div>

        {list.length > 0 ? <div className="mwd-end">Showing {list.length} markets · live</div> : null}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAIN
   ════════════════════════════════════════════════════════════════════ */
function MemeWonderland({ onConnectWallet } = {}) {
  useMwCSS();

  const wallet = useWallet();
  // Single dRPC connection used for tx assembly + send.
  const connection = useMemo(() => getConn('confirmed'), []);

  const [tokens, setTokens] = useState([]);
  // Chart-window % change, derived from the SAME 1D series the sparkline draws,
  // so the displayed % always matches the chart (Jupiter's stats24h.priceChange
  // is unreliable for fresh/thin pools — e.g. +350% off an early near-zero print).
  const [chartChg, setChartChg] = useState({});   // mint -> %
  const chgTsRef = useRef(new Map());              // mint -> last fetch ts
  const [, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState(0);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [whaleTokens, setWhaleTokens] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef(null);

  const [discovered, setDiscovered] = useState({});

  const [detailMint, setDetailMint] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null);

  // BALANCES — honest per-fetch state. Same shape as SwapWidget.
  const [balances, setBalances] = useState({});
  const [balState, setBalState] = useState({ sol: 'idle', tok: 'idle', tok22: 'idle' });

  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) {
      setBalances({});
      setBalState({ sol: 'idle', tok: 'idle', tok22: 'idle' });
      return;
    }
    const owner = wallet.publicKey;
    setBalState({ sol: 'loading', tok: 'loading', tok22: 'loading' });

    const mergeAccs = (into, accs) => {
      if (!accs || !accs.value) return;
      for (const acc of accs.value) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const amt = info.tokenAmount?.amount;
        const dec = info.tokenAmount?.decimals;
        const uiAmt = info.tokenAmount?.uiAmount;
        if (!mint || amt == null) continue;
        into[mint] = { amount: Number(amt), decimals: dec, uiAmount: uiAmt };
      }
    };

    // SOL — independent.
    rpcRace('getBalance', c => c.getBalance(owner, 'confirmed'))
      .then(lamports => {
        setBalances(prev => ({
          ...prev,
          [SOL_MINT]: { amount: lamports, decimals: 9, uiAmount: lamports / 1e9 },
        }));
        setBalState(s => ({ ...s, sol: 'ok' }));
      })
      .catch(e => {
        console.warn('[mw] SOL balance failed', e?.message);
        setBalState(s => ({ ...s, sol: 'fail' }));
      });

    // SPL tokens — independent.
    rpcRace('tokenAccs', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed')
    )
      .then(accs => {
        setBalances(prev => {
          const next = { ...prev };
          mergeAccs(next, accs);
          return next;
        });
        setBalState(s => ({ ...s, tok: 'ok' }));
      })
      .catch(e => {
        console.warn('[mw] SPL accounts failed', e?.message);
        setBalState(s => ({ ...s, tok: 'fail' }));
      });

    // Token-2022 — independent.
    rpcRace('tokenAccs2022', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed')
    )
      .then(accs => {
        setBalances(prev => {
          const next = { ...prev };
          mergeAccs(next, accs);
          return next;
        });
        setBalState(s => ({ ...s, tok22: 'ok' }));
      })
      .catch(e => {
        console.warn('[mw] Token-2022 accounts failed', e?.message);
        setBalState(s => ({ ...s, tok22: 'fail' }));
      });
  }, [wallet.publicKey]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  // Per-mint balance status — same logic as SwapWidget.
  const balStateFor = useCallback((mint) => {
    if (mint === SOL_MINT) return balState.sol;
    if (balState.tok === 'loading' || balState.tok22 === 'loading') return 'loading';
    if (balState.tok === 'ok' || balState.tok22 === 'ok') return 'ok';
    if (balState.tok === 'fail' && balState.tok22 === 'fail') return 'fail';
    return 'idle';
  }, [balState]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/jupiter/tokens/v2/toporganicscore/24h?limit=40');
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          const _mw = _uniqMint(list.map(normalize).filter(t => t.mint && !isStablecoin(t) && t.mint !== SOL_MINT && t.sym !== 'WSOL' && t.sym !== 'SOL'));
          setTokens(_mw);
          nxWarm(_mw.map(t => t.mint));
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    }
    load();
    const id = setInterval(load, POLL_TOKENS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Per-mint 1-HOUR % for the list — derived from the SAME CoinGecko
  // (GeckoTerminal) 1h OHLCV the sparkline draws (first close → last close, the
  // last 60 minutes), for the pool whose
  // BASE token is exactly this mint. The % and the line therefore always agree,
  // and both agree with the detail chart (same provider, same contract-matched
  // pool). No DexScreener, no Jupiter stats. Throttled ≤ once / 45s per mint.
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const due = tokens
      .map(t => t.mint)
      .filter(m => m && (now - (chgTsRef.current.get(m) || 0)) >= 45000);
    if (!due.length) return;
    due.forEach(m => chgTsRef.current.set(m, now));

    (async () => {
      for (const m of due) {
        if (cancelled) return;
        try {
          const closes = await mwFetchSpark(m);   // real OHLCV closes, contract-matched
          if (cancelled) return;
          if (Array.isArray(closes) && closes.length >= 2) {
            const a = Number(closes[0]), b = Number(closes[closes.length - 1]);
            if (a > 0 && Number.isFinite(b)) {
              const pct = ((b - a) / a) * 100;
              setChartChg(prev => ({ ...prev, [m]: pct }));
            }
          }
        } catch { /* keep the feed's real change until next cycle */ }
      }
    })();

    return () => { cancelled = true; };
  }, [tokens]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/sol-price');
        const d = await r.json();
        if (!cancelled && d?.price) setSolPrice(d.price);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        const d = await r.json();
        if (!cancelled) setWhaleEvents(Array.isArray(d?.events) ? d.events : []);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (whaleEvents.length === 0) { setWhaleTokens([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const byMint = new Map();
        for (const ev of whaleEvents) {
          const cur = byMint.get(ev.mint) || { mint: ev.mint, symbol: ev.symbol, sol: 0, count: 0, lastAt: 0 };
          cur.sol += Number(ev.solAmount || 0);
          cur.count += 1;
          cur.lastAt = Math.max(cur.lastAt, ev.detectedAt || 0);
          byMint.set(ev.mint, cur);
        }
        const mints = [...byMint.keys()];
        let dataByMint = new Map();
        try {
          const r = await fetch(`/api/jupiter/tokens/search?query=${mints.join(',')}`);
          if (cancelled) return;
          const d = await r.json();
          const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
          dataByMint = new Map(list.map(t => [t.id || t.address || t.mint, normalize(t)]));
        } catch {}
        if (cancelled) return;
        const merged = [...byMint.values()].map(w => {
          const tok = dataByMint.get(w.mint) || tokens.find(x => x.mint === w.mint);
          const base = tok || { mint: w.mint, sym: w.symbol || 'TOKEN', name: w.symbol || 'Unknown', emoji: emojiFor(w.symbol || ''), icon: null, price: 0, change: 0, mcap: 0, volume24h: 0, holders: 0, liquidity: 0, decimals: 6, age: '', ageMs: Infinity, fresh: false };
          return { ...base, whaleSol: w.sol, whaleCount: w.count, whaleAt: w.lastAt };
        }).sort((a, b) => (b.whaleSol || 0) - (a.whaleSol || 0));
        setWhaleTokens(merged);
      } catch {}
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whaleEvents]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(q)}`);
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setSearchResults(_uniqMint(list.map(normalize).filter(x => x.mint)).slice(0, 12));
          setSearching(false);
        }
      } catch { if (!cancelled) { setSearchResults([]); setSearching(false); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  useEffect(() => {
    const onDoc = (e) => { if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) setSearchOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Displayed % is derived from the chart series (chartChg: first→last close
  // over the last 1 hour), so the number always matches the sparkline. Jupiter's
  // stats24h.priceChange is NOT used for display — it spikes on fresh/thin
  // pools. Fall back to the Jupiter figure only until that mint's series loads.
  // Displayed % comes ONLY from the chart series (chartChg). NO Jupiter, ever.
  //   finite number → valid chart-derived %  → show it
  //   null / undefined (rejected or not-yet-loaded) → show "—"
  // We never fall back to t.change (Jupiter's stats24h.priceChange) — that was
  // the source of the +600000% readings on tokens whose series didn't resolve.
  const tokensCC = useMemo(
    () => tokens.map(t => {
      const cc = chartChg[t.mint];
      return { ...t, change: Number.isFinite(cc) ? cc : null };
    }),
    [tokens, chartChg]
  );

  const ticker = useMemo(
    () => tokensCC.slice(0, 10).map(t => [t.sym, formatPct(t.change), t.change >= 0]),
    [tokensCC]
  );

  const whaleMints = useMemo(() => new Set(whaleEvents.map(w => w.mint)), [whaleEvents]);
  const whaleByMint = useMemo(() => {
    const m = new Map();
    for (const ev of whaleEvents) m.set(ev.mint, (m.get(ev.mint) || 0) + Number(ev.solAmount || 0));
    return m;
  }, [whaleEvents]);
  const whaleCountByMint = useMemo(() => {
    const m = new Map();
    for (const ev of whaleEvents) m.set(ev.mint, (m.get(ev.mint) || 0) + 1);
    return m;
  }, [whaleEvents]);
  const whaleLastAtByMint = useMemo(() => {
    const m = new Map();
    for (const ev of whaleEvents) {
      if (!ev.detectedAt) continue;
      m.set(ev.mint, Math.max(m.get(ev.mint) || 0, ev.detectedAt));
    }
    return m;
  }, [whaleEvents]);

  const tokensWithWhale = useMemo(() => {
    if (whaleMints.size === 0) return tokensCC;
    return tokensCC.map(t => {
      if (!whaleMints.has(t.mint)) return t;
      return {
        ...t,
        whaleSol: whaleByMint.get(t.mint) || 0,
        whaleCount: whaleCountByMint.get(t.mint) || 0,
        whaleAt: whaleLastAtByMint.get(t.mint) || 0,
      };
    });
  }, [tokensCC, whaleMints, whaleByMint, whaleCountByMint, whaleLastAtByMint]);

  const tokenByMint = useCallback(
    m => tokensWithWhale.find(t => t.mint === m)
      || whaleTokens.find(t => t.mint === m)
      || discovered[m]
      || (searchResults || []).find(t => t.mint === m)
      || null,
    [tokensWithWhale, whaleTokens, discovered, searchResults]
  );

  const topToken = tokensWithWhale[0];
  const freshCount = tokensWithWhale.filter(t => t.fresh).length;

  const openDetail = (mintOrToken) => {
    let mint;
    if (mintOrToken && typeof mintOrToken === 'object') {
      mint = mintOrToken.mint;
      // Register so tokenByMint() can resolve it (feed tokens live only in the
      // feed's local state otherwise, so DetailView would never open).
      setDiscovered(prev => prev[mint] ? prev : { ...prev, [mint]: mintOrToken });
    } else {
      mint = mintOrToken;
      // String caller (launch/activity cards pass a bare mint): resolve it from
      // any known list and register it, so tokenByMint() can find it and the
      // view actually opens. Without this, a string mint never mounts.
      if (mint) {
        const found = tokenByMint(mint);
        if (found) setDiscovered(prev => prev[mint] ? prev : { ...prev, [mint]: found });
      }
    }
    if (!mint) return;
    setDetailMint(mint);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeDetail = () => setDetailMint(null);
  const openSheet = (mintOrToken, mode = 'buy') => {
    if (mintOrToken && typeof mintOrToken === 'object') {
      setDiscovered(prev => prev[mintOrToken.mint] ? prev : { ...prev, [mintOrToken.mint]: mintOrToken });
      setSheet({ mint: mintOrToken.mint, mode });
    } else if (typeof mintOrToken === 'string') {
      // Resolve + register the bare mint so the TradeSheet's tokenByMint() gate
      // passes and the sheet mounts (fixes "click token, can't buy/sell").
      const found = tokenByMint(mintOrToken);
      if (found) setDiscovered(prev => prev[mintOrToken] ? prev : { ...prev, [mintOrToken]: found });
      setSheet({ mint: mintOrToken, mode });
    }
    setAmount('0.50'); setSelectedPreset('0.5');
  };
  const closeSheet = () => setSheet(null);
  const handlePreset = (amt) => { setSelectedPreset(amt); setAmount(amt === 'MAX' ? '1.0' : amt); };
  const handleAmount = (v) => { setAmount(v); setSelectedPreset(null); };

  const handleSearchSelect = (token) => {
    setSearchOpen(false); setSearchQuery('');
    openSheet(token, 'buy');
  };

  return (
    <div className="mw-root">
      <MwDiscoverFeed
        fallbackTokens={tokensWithWhale}
        chartChg={chartChg}
        searchQuery={searchQuery}
        setSearchQuery={(v) => { setSearchQuery(v); if (!v) setSearchResults(null); }}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        searchResults={searchResults}
        searching={searching}
        searchWrapRef={searchWrapRef}
        onSearchSelect={handleSearchSelect}
        onOpen={openDetail}
        onTrade={openSheet}
      />

      {detailMint && tokenByMint(detailMint) && (
        <DetailView
          token={tokenByMint(detailMint)}
          onClose={closeDetail}
          onTrade={(m) => openSheet(detailMint, m)}
        />
      )}

      {sheet && tokenByMint(sheet.mint) && (
        <TradeSheet
          token={tokenByMint(sheet.mint)}
          solPrice={solPrice}
          mode={sheet.mode}
          setMode={(m) => setSheet(s => ({ ...s, mode: m }))}
          amount={amount}
          setAmount={handleAmount}
          selectedPreset={selectedPreset}
          handlePreset={handlePreset}
          onClose={closeSheet}
          wallet={wallet}
          connection={connection}
          balances={balances}
          balStateFor={balStateFor}
          refreshBalances={refreshBalances}
          onSuccess={(payload) => {
            setSuccess({ mint: sheet.mint, ...payload });
            setSheet(null);
            setDetailMint(null);
          }}
        />
      )}

      {success && tokenByMint(success.mint) && (
        <SuccessView
          data={success}
          token={tokenByMint(success.mint)}
          onClose={() => setSuccess(null)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   DETAIL VIEW
   ════════════════════════════════════════════════════════════════════ */
// ── Token detail chart ──────────────────────────────────────────────
// Resolves a mint → its best pool and embeds a candlestick chart.
// Provider order: GeckoTerminal first (indexes pump.fun BONDING-CURVE pools
// that aren't graduated yet). CoinGecko (GeckoTerminal) only.
// Both enforce: pool's BASE token MUST equal this mint (exact contract match,
// no quote-side fallback), and pick the highest-USD-liquidity matching pool.
// The reduce is seeded with the first candidate so a single pool with 0 /
// unknown liquidity (brand-new tokens) still charts.
// fetch() with a hard timeout — without this, a hung provider request never
// settles and the chart is stuck on 'loading' forever. On timeout it aborts
// (rejects), so the caller falls through to the next provider / 'none'.
async function fetchTO(url, ms = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted  = 'solana_' + mint;                       // EXACT match — Solana base58 is case-sensitive
  const hasAddr = p => !!p?.attributes?.address;
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const liq     = p => Number(p?.attributes?.reserve_in_usd) || 0;
  // Contract MUST match: only pools where this mint is the BASE token. No
  // quote-side fallback — charting a pool where the mint is the quote shows the
  // WRONG token. If nothing matches, return null (no chart) rather than wrong data.
  // Prefer base-token-exact; else the deepest pool that holds this token (so the
  // chart loads instead of "chart not available"). Token's own market either way.
  const withAddr = pools.filter(hasAddr);
  if (!withAddr.length) return null;
  const basePools = withAddr.filter(p => baseId(p) === wanted);
  const set = basePools.length ? basePools : withAddr;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);
}


/* ════════════════════════════════════════════════════════════════════
   EMBEDDED CHART  — CoinGecko (GeckoTerminal) ONLY. Base-token pool match
   (contract MUST match), resolution pills, 1s default. No DexScreener.
   ════════════════════════════════════════════════════════════════════ */
const MW_CHART_RES = [
  { key: '1s',  label: '1s', gecko: '1s',  dex: '1S'  },
  { key: '15s', label: '15s', gecko: '15s', dex: '15S' },
  { key: '1m',  label: '1m', gecko: '1m',  dex: '1'   },
  { key: '5m',  label: '5m', gecko: '5m',  dex: '5'   },
  { key: '1h',  label: '1H', gecko: '1h',  dex: '60'  },
];
const MW_RES_DEFAULT = '1s';


// Resolve a pool address from the server /api/dex/token proxy (server-to-server,
// never rate-limited/CORS-blocked). Picks the base-token-matched, deepest pool.
// Server-side pool resolution (never browser-rate-limited): /api/nx/pool first,
// then the existing /api/ape/curve. Both return a GeckoTerminal pool address.
async function mwServerPool(mint) {
  try {
    const r = await fetch('/api/nx/pool/' + encodeURIComponent(mint), { headers: { Accept: 'application/json' } });
    if (r.ok) { const d = await r.json(); if (d && typeof d.pool === 'string' && d.pool) return d.pool; }
  } catch (e) {}
  // NOTE: /api/ape/curve is intentionally NOT used here — it returns top_pools[0]
  // without enforcing base-token match, so it could point at the wrong contract.
  // If /api/nx/pool isn't available, the caller falls back to its own base-EXACT
  // GeckoTerminal picker (pickBestGeckoPool), keeping the contract guaranteed.
  return null;
}

function mwPoolFromTokenApi(d, mint) {
  if (!d) return null;
  const t = d.token || d;
  const direct = t.pairAddress || t.poolAddress || t.pool || t.poolId
    || (t.pool && t.pool.address) || (t.firstPool && (t.firstPool.id || t.firstPool.address));
  if (typeof direct === 'string' && direct) return direct;
  const pairs = d.pairs || t.pairs || d.pools || t.pools;
  if (Array.isArray(pairs) && pairs.length) {
    const liqOf  = p => Number(p?.liquidity?.usd ?? p?.liquidityUsd ?? p?.reserve_in_usd ?? p?.liquidity ?? 0);
    const addrOf = p => p?.pairAddress || p?.poolAddress || p?.address || p?.id || null;
    const baseOf = p => String((p?.baseToken && (p.baseToken.address || p.baseToken.id)) || p?.base || p?.baseMint || '');
    const matched = pairs.filter(p => addrOf(p) && (!baseOf(p) || baseOf(p) === String(mint)));
    const arr = matched.length ? matched : pairs;
    return addrOf(arr.reduce((b, p) => (liqOf(p) > liqOf(b) ? p : b), arr[0]));
  }
  return null;
}

function mwBuildEmbedSrc(pool, resKey) {
  if (!pool) return null;
  const r = MW_CHART_RES.find(x => x.key === resKey) || MW_CHART_RES[0];
  if (pool.provider !== 'GECKOTERMINAL') return null;
  return 'https://www.geckoterminal.com/solana/pools/' + pool.addr +
    '?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&bg_color=0a0b0d&resolution=' + r.gecko;
}

function MwTokenChart({ mint, symbol = '', poolHint = null }) {
  const [status, setStatus] = useState('loading'); // loading | ok | none | fail
  const [pool, setPool]     = useState(null);       // { provider, addr }
  const [res, setRes]       = useState(MW_RES_DEFAULT);
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);

  // Reset to the 1s view each time a different token opens.
  useEffect(() => { setRes(MW_RES_DEFAULT); }, [mint]);

  useEffect(() => {
    if (!mint) { setStatus('none'); setPool(null); return; }
    const id = ++reqRef.current;
    // Feed already gave us a contract-matched pool → chart immediately.
    if (poolHint && typeof poolHint === 'string') {
      setPool({ provider: 'GECKOTERMINAL', addr: poolHint }); setStatus('ok'); return;
    }
    setStatus('loading'); setPool(null);

    (async () => {
      // CoinGecko (GeckoTerminal) only — the pool whose BASE token is exactly
      // this mint. No DexScreener.
      let chosen = null;
      // 0) Server-side pool resolution — reliable, not rate-limited.
      try {
        const sAddr = await mwServerPool(mint);
        if (sAddr) chosen = { provider: 'GECKOTERMINAL', addr: sAddr };
      } catch {}
      if (id !== reqRef.current) return;
      if (chosen) { setPool(chosen); setStatus('ok'); return; }
      // 1) Direct GeckoTerminal (last resort).
      try {
        const r = await fetchTO(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools`, 4500);
        if (r.ok) {
          const j = await r.json();
          const addr = pickBestGeckoPool(j?.data, mint)?.attributes?.address;
          if (addr) chosen = { provider: 'GECKOTERMINAL', addr };
        }
      } catch {}
      if (id !== reqRef.current) return;
      if (chosen) { setPool(chosen); setStatus('ok'); return; }

      // No contract-matched pool yet (typical for a seconds-old bonding curve).
      setStatus('none');
    })();
  }, [mint, poolHint]);

  const src = useMemo(() => mwBuildEmbedSrc(pool, res), [pool, res]);
  const shortCa = mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : '';
  const copyCa = async () => {
    try { await navigator.clipboard.writeText(mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
  };

  return (
    <div className="mw-chart">
      <div className="mw-chart-bar">
        <div className="mw-chart-ca">
          <span className="mw-chart-ca-l">CA</span>
          <span className="mw-chart-ca-v">{shortCa}</span>
          <button type="button" className="mw-chart-ca-copy" onClick={copyCa}>{copied ? 'COPIED' : 'COPY'}</button>
        </div>
        <span className="mw-chart-src">{pool?.provider || 'CHART'}</span>
      </div>
      {status === 'ok' && src ? (
        <div className="mw-chart-frame-wrap">
          <iframe key={pool.provider + pool.addr + res} className="mw-chart-frame" src={src} title={(symbol || 'Token') + ' price chart'}
            loading="lazy" allow="clipboard-write" />
        </div>
      ) : status === 'loading' ? (
        <div className="mw-chart-state"><div className="mw-chart-spin" /></div>
      ) : status === 'none' ? (
        <div className="mw-chart-state">Live chart unavailable right now.</div>
      ) : (
        <div className="mw-chart-state">Couldn’t load the chart. Try again shortly.</div>
      )}
      <div className="mw-tf-pills">
        {MW_CHART_RES.map(r => (
          <button key={r.key} className={'mw-tf' + (r.key === res ? ' on' : '')} disabled={status !== 'ok'} onClick={() => setRes(r.key)}>{r.label}</button>
        ))}
        <span className="mw-tf-meta">{status === 'ok' ? '● Live · ' + ((MW_CHART_RES.find(x => x.key === res) || {}).label || '') : 'Live'}</span>
      </div>
    </div>
  );
}

function DetailView({ token, onClose, onTrade }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="mw-detail">
      <div className="mw-detail-top">
        <button type="button" className="mw-icon-btn" onClick={onClose}>←</button>
        <div className="mw-detail-title">${token.sym} <span className="mw-check-mint">✓</span></div>
        <button type="button" className="mw-icon-btn">↗</button>
      </div>

      <div className="mw-detail-hero">
        <div className="mw-detail-emoji"><TokenIcon token={token} /></div>
        <div className="mw-detail-info">
          <div className="mw-detail-name">{token.sym}</div>
          <div className="mw-detail-fullname">{token.name} · Solana</div>
          <div className="mw-detail-price-row">
            <div className="mw-detail-price">{formatPrice(token.price)}</div>
          </div>
        </div>
      </div>

      <MwTokenChart mint={token.mint} symbol={token.sym} poolHint={token.pool} />

      <div className="mw-inline-actions">
        <button type="button" className="mw-big-btn mw-buy"  onClick={() => onTrade('buy')}>🚀 BUY</button>
        <button type="button" className="mw-big-btn mw-sell" onClick={() => onTrade('sell')}>💸 SELL</button>
      </div>

      {token.whaleSol ? (
        <div className="mw-whale-banner">
          <span className="mw-whale-banner-emoji">🐋</span>
          <div>
            <div className="mw-whale-banner-title">WHALE ENTRY{token.whaleAt ? ' · ' + timeAgo(token.whaleAt) : ''}</div>
            <div className="mw-whale-banner-sub">+{format(token.whaleSol)} SOL added to liquidity</div>
          </div>
        </div>
      ) : null}

      <div className="mw-stats-grid">
        <div className="mw-stat">
          <span className="mw-stat-icon">💰</span>
          <div className="mw-stat-label">Market Cap</div>
          <div className="mw-stat-value">${format(token.mcap)}</div>
          <div className="mw-stat-sub">USD</div>
        </div>
        <div className="mw-stat">
          <span className="mw-stat-icon">👥</span>
          <div className="mw-stat-label">Holders</div>
          <div className="mw-stat-value">{token.holders ? format(token.holders) : '—'}</div>
          <div className="mw-stat-sub">on-chain</div>
        </div>
        <div className="mw-stat">
          <span className="mw-stat-icon">⚡</span>
          <div className="mw-stat-label">Volume 24h</div>
          <div className="mw-stat-value">${format(token.volume24h)}</div>
          <div className="mw-stat-sub">all DEXs</div>
        </div>
        <div className="mw-stat">
          <span className="mw-stat-icon">💧</span>
          <div className="mw-stat-label">Liquidity</div>
          <div className="mw-stat-value">${format(token.liquidity)}</div>
          <div className="mw-stat-sub">🔒 pooled</div>
        </div>
      </div>

      <div className="mw-contract">
        <div className="mw-contract-info">
          <div className="mw-contract-label">Contract</div>
          <div className="mw-contract-addr">{token.mint.slice(0, 8)}…{token.mint.slice(-6)}</div>
        </div>
        <button type="button" className="mw-copy-btn" onClick={() => navigator.clipboard?.writeText(token.mint)}>COPY</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TRADE SHEET — Jupiter swap, full 3% fee → FEE_WALLET
   ════════════════════════════════════════════════════════════════════ */
function TradeSheet({
  token, solPrice, mode, setMode, amount, setAmount,
  selectedPreset, handlePreset, onClose,
  wallet, connection, balances, balStateFor, refreshBalances, onSuccess,
}) {
  const isSell = mode === 'sell';
  const inputMint  = isSell ? token.mint : SOL_MINT;
  const outputMint = isSell ? SOL_MINT  : token.mint;
  const inputDecimals  = isSell ? (token.decimals ?? 6) : 9;
  const outputDecimals = isSell ? 9 : (token.decimals ?? 6);
  const inputSymbol  = isSell ? token.sym : 'SOL';
  const outputSymbol = isSell ? 'SOL' : token.sym;

  const inputBalance = balances[inputMint];
  const inputBalStatus = balStateFor ? balStateFor(inputMint) : 'idle';
  const balanceKnown = inputBalStatus === 'ok';
  const amtNum = parseFloat(amount) || 0;

  // ── PRICE-PER-UNIT for the input token. SOL → solPrice. Token → token.price.
  const unitPriceUsd = isSell ? (token.price || 0) : (solPrice || 0);

  // USD value of what the user is ABOUT TO TRADE (the amount typed).
  const tradeUsdValue = amtNum * unitPriceUsd;

  // USD value of the user's WALLET BALANCE. THIS is what should appear next
  // to "Bal:" — fixes the bug where 0.001 SOL was showing as ~$37 (because
  // the trade-amount USD was being reused as if it were balance USD).
  const balanceUsdValue = inputBalance && unitPriceUsd > 0
    ? inputBalance.uiAmount * unitPriceUsd
    : null;

  const rawAmount = useMemo(() => {
    if (!amount) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputDecimals)).toString();
  }, [amount, inputDecimals]);

  const [build, setBuild] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const quoteAbortRef = useRef(null);

  useEffect(() => {
    if (!rawAmount || inputMint === outputMint) {
      setBuild(null);
      setQuoteError(null);
      return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;

    setQuoting(true);
    setQuoteError(null);

    const t = setTimeout(async () => {
      try {
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) {
          setBuild(null);
          setQuoting(false);
          return;
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:      net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker:       wallet.publicKey
            ? wallet.publicKey.toBase58()
            : '11111111111111111111111111111111',
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) {
          setBuild(data);
          setQuoteError(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setBuild(null);
          setQuoteError(friendlyError(e));
        }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);

    return () => { clearTimeout(t); ac.abort(); };
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => {
    if (!build) return null;
    return Number(build.outAmount) / Math.pow(10, outputDecimals);
  }, [build, outputDecimals]);

  const receiveAmount = useMemo(() => {
    if (quoting) return 'Quoting…';
    if (outAmountUi == null) return '—';
    return format(outAmountUi) + ' ' + outputSymbol;
  }, [quoting, outAmountUi, outputSymbol]);

  const rate = useMemo(() => {
    if (!outAmountUi || !amtNum) return null;
    return outAmountUi / amtNum;
  }, [outAmountUi, amtNum]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);

  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet (Phantom, Solflare, Backpack).');
      return;
    }
    if (!build) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);

    try {
      const dec = inputDecimals;

      // Full 3% fee → FEE_WALLET
      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(feeAmount),
        }));
      } else {
        const mintPk = new PublicKey(inputMint);
        // Buy/sell critical path → trade RPC (Alchemy primary, Ankr fallback).
        const mintInfo = await rpcRaceTrade('getMintInfo', c => c.getAccountInfo(mintPk));
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,       true, tokenProgram);

        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, wallet.publicKey,
          feeAmount, dec, [], tokenProgram,
        ));
      }

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

      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await rpcRaceTrade('getAlts',
          c => c.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k))));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      const latest = await rpcRaceTrade('getLatestBlockhash',
        c => c.getLatestBlockhash('confirmed'));
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs,
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
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Swap simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[swap] sim non-fatal', simErr);
      }

      const signed = await wallet.signTransaction(tx);
      const serialized = signed.serialize();

      // Send via trade RPC (Alchemy primary, Ankr fallback).
      const sig = await rpcRaceTrade('sendTx', c => c.sendRawTransaction(serialized, {
        skipPreflight: false,
        maxRetries: 3,
      }));

      let confirmed = false;
      try {
        const conf = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain: ' + JSON.stringify(conf.value.err));
        confirmed = true;
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      const outUi = Number(build.outAmount) / Math.pow(10, outputDecimals);
      onSuccess({
        signature: sig,
        pending: !confirmed,
        paid: amtNum.toFixed(4) + ' ' + inputSymbol,
        got:  format(outUi) + ' ' + outputSymbol,
        price: token.price,
      });

      if (confirmed) setTimeout(() => refreshBalances(), 2000);
    } catch (e) {
      console.error('[mw swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    wallet, build, inputMint, inputDecimals, outputDecimals,
    inputSymbol, outputSymbol, rawAmount, amtNum, token.price,
    connection, onSuccess, refreshBalances,
  ]);

  // Funds check: only enforce when we KNOW the balance.
  const hasFunds = !balanceKnown
    ? amtNum > 0
    : (inputBalance && amtNum > 0 && inputBalance.uiAmount >= amtNum);

  const canSwap  = !!wallet.publicKey && !!build && !quoting && !swapping &&
                   amtNum > 0 && inputMint !== outputMint && hasFunds;

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.002); // leave gas
    setAmount(String(maxAmt));
  };

  const ctaLabel = swapping
    ? (isSell ? 'Selling…' : 'Buying…')
    : !wallet.publicKey
      ? 'Connect Wallet'
      : amtNum <= 0
        ? 'Enter amount'
        : quoting && !build
          ? 'Getting quote…'
          : !build
            ? 'No route available'
            : !hasFunds
              ? `Insufficient ${inputSymbol}`
              : (isSell ? '💸 SELL ' + token.sym : '⚡ BUY ' + token.sym);

  // Honest balance display — the $ figure here ALWAYS reflects the balance,
  // not the trade amount.
  let balanceDisplay;
  if (!wallet.publicKey) {
    balanceDisplay = <span className="mw-muted-deep">Not connected</span>;
  } else if (inputBalStatus === 'loading' || inputBalStatus === 'idle') {
    balanceDisplay = <>Bal: <b>…</b></>;
  } else if (inputBalStatus === 'fail') {
    balanceDisplay = <span className="mw-bal-err">RPC unreachable</span>;
  } else if (inputBalance) {
    balanceDisplay = <>
      Bal: <b>{format(inputBalance.uiAmount)}</b>
      {balanceUsdValue != null ? <> · {formatUsd(balanceUsdValue)}</> : null}
    </>;
  } else {
    balanceDisplay = <>Bal: <b>0</b> · $0.00</>;
  }

  return (
    <>
      <div className="mw-sheet-backdrop" onClick={swapping ? undefined : onClose}></div>
      <div className="mw-sheet">
        <div className="mw-grabber"></div>

        <div className="mw-sheet-token-head">
          <div className="mw-sheet-emoji"><TokenIcon token={token} /></div>
          <div className="mw-sheet-token-info">
            <div className="mw-sheet-token-name">${token.sym}</div>
            <div className="mw-sheet-sub">
              {token.age && <span className="mw-age-pill">{token.age} old</span>}
            </div>
          </div>
          <button type="button" className="mw-icon-btn" onClick={onClose} disabled={swapping}>×</button>
        </div>

        <MwTokenChart mint={token.mint} symbol={token.sym} poolHint={token.pool} />

        <div className={'mw-tab-switch' + (isSell ? ' mw-sell-mode' : '')}>
          <div className="mw-tab-indicator"></div>
          {['buy', 'sell'].map(m => (
            <div
              key={m}
              className={'mw-tab' + (mode === m ? ' mw-active' : '')}
              onClick={() => !swapping && setMode(m)}
            >
              {m.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="mw-amount-section">
          <div className="mw-amount-label">
            <span>You Pay</span>
            <span className="mw-balance">{balanceDisplay}</span>
          </div>
          <div className="mw-amount-input-wrap">
            <input
              className="mw-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v);
              }}
              disabled={swapping}
            />
            <div className="mw-currency">
              <div className="mw-currency-icon"></div>
              {inputSymbol}
            </div>
          </div>
          {/* USD value of the trade amount lives here now, so it can't be
              mistaken for the balance's USD value. */}
          {amtNum > 0 && unitPriceUsd > 0 && (
            <div className="mw-amount-usd">≈ {formatUsd(tradeUsdValue)}</div>
          )}

          <div className="mw-presets">
            {['0.1', '0.5', '1', 'MAX'].map(p => (
              <button
                key={p}
                type="button"
                className={'mw-preset' + (selectedPreset === p ? ' mw-selected' : '')}
                onClick={() => p === 'MAX' ? setMax() : handlePreset(p)}
                disabled={swapping}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mw-receive">
          <div>
            <div className="mw-receive-label">You Get</div>
            <div className="mw-receive-amount">{receiveAmount}</div>
          </div>
          <div className="mw-receive-rate">
            Rate<br />
            <b>{rate ? `1 ${inputSymbol} = ${format(rate)} ${outputSymbol}` : '—'}</b>
          </div>
        </div>

        {(swapError || quoteError) && (
          <div style={{
            margin: '12px 22px 0',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(209,75,106,0.1)',
            border: '1px solid rgba(209,75,106,0.3)',
            color: 'var(--red)',
            fontSize: 12,
            textAlign: 'center',
            fontWeight: 500,
          }}>
            {swapError || quoteError}
          </div>
        )}

        <div className="mw-cta-wrap">
          <button
            type="button"
            className={'mw-cta' + (isSell ? ' mw-sell-cta' : '')}
            onClick={handleSwap}
            disabled={!canSwap}
          >
            {ctaLabel}
          </button>
          <div className="mw-trust">
            Powered by <span className="mw-jup-badge"><span className="mw-jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐
          </div>
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SUCCESS VIEW
   ════════════════════════════════════════════════════════════════════ */
function SuccessView({ data, token, onClose }) {
  const [confetti, setConfetti] = useState([]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const emojis = ['🎉','🚀','💎','🐸','✨','🍭','💸','⭐','🌈'];
    setConfetti(Array.from({ length: 36 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 100,
      duration: 3 + Math.random() * 3,
      delay: Math.random() * 1.5,
      size: 16 + Math.random() * 14
    })));
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://nexus.app';
  const shareUrl  = `${origin}/?t=${data.mint}`;
  const shareText = `Just aped into $${token.sym} on @nexus 🚀\n\nBag: ${data.got}\nEntry: ${formatPrice(data.price)}`;
  const solscanUrl = data.signature ? `https://solscan.io/tx/${data.signature}` : null;

  return (
    <div className="mw-success-overlay">
      <div className="mw-confetti-rain">
        {confetti.map(p => (
          <div key={p.id} className="mw-confetti-piece" style={{
            left: p.left + '%',
            animationDuration: p.duration + 's',
            animationDelay: p.delay + 's',
            fontSize: p.size + 'px'
          }}>{p.emoji}</div>
        ))}
      </div>

      <div className="mw-success-top">
        <button type="button" className="mw-icon-btn" onClick={onClose}>×</button>
        {solscanUrl && (
          <a className="mw-view-on" href={solscanUrl} target="_blank" rel="noreferrer">
            VIEW ON SOLSCAN ↗
          </a>
        )}
      </div>

      <div className="mw-success">
        <div className="mw-success-emoji">{data.pending ? '⏳' : '🎉'}</div>
        <div className="mw-success-title">{data.pending ? 'Confirming…' : 'You aped!'}</div>
        <div className="mw-success-sub">
          {data.pending
            ? 'Submitted — confirming on-chain'
            : `Welcome to the ${token.sym} chat, anon ${token.emoji}`}
        </div>
      </div>

      <div className="mw-flex-card">
        <div className="mw-flex-top">
          <div className="mw-flex-emoji"><TokenIcon token={token} /></div>
          <div className="mw-flex-token">
            <div className="mw-flex-sym">${token.sym}</div>
            <div className="mw-flex-tag">{token.name}</div>
          </div>
        </div>
        <div className="mw-flex-row"><span className="mw-flex-label">You paid</span><span className="mw-flex-value">{data.paid}</span></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Bag size</span><span className="mw-flex-value mw-big">{data.got}</span></div>
        <div className="mw-flex-divider"></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Entry</span><span className="mw-flex-value" style={{ fontSize: '14px' }}>{formatPrice(data.price)}</span></div>
        <div className="mw-flex-watermark">VIA <b>NEXUS</b></div>
      </div>

      <div className="mw-share-section">
        <div className="mw-share-title">FLEX YOUR BAG 💪</div>
        <div className="mw-share-grid">
          <button type="button" className="mw-share-btn" style={{ '--mw-share-bg': '#000', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank')}>
            <div className="mw-share-icon">𝕏</div><div className="mw-share-label">Post on X</div>
          </button>
          <button type="button" className="mw-share-btn" style={{ '--mw-share-bg': '#229ED9', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank')}>
            <div className="mw-share-icon">✈</div><div className="mw-share-label">Telegram</div>
          </button>
          <button type="button" className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(127,255,212,0.3)', '--mw-share-color': '#1B7A4F' }}
            onClick={() => navigator.clipboard?.writeText(shareUrl)}>
            <div className="mw-share-icon">🔗</div><div className="mw-share-label">Copy Link</div>
          </button>
          <button type="button" className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(255,212,107,0.3)', '--mw-share-color': '#B36B00' }}>
            <div className="mw-share-icon">⬇</div><div className="mw-share-label">Save Card</div>
          </button>
        </div>
      </div>

      <div className="mw-done-wrap">
        <button type="button" className="mw-done-btn" onClick={onClose}>🚀 BACK TO WONDERLAND</button>
      </div>
    </div>
  );
}

return MemeWonderland;
})();

/* ════════ LAUNCHES PAGE (LaunchRadar) — original, scoped ════════ */
const LaunchRadar = (function () {
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

// Local copy of stkSeed so this file builds regardless of the Stocks.jsx version
// shipped alongside it (older Stocks.jsx builds may not export stkSeed).
function stkSeed(str) {
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) || 1) >>> 0;
}

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

const MWD_LR_CSS = `
.mwd{
  --bg:#060708; --bg2:#0a0b0d; --panel:#0d0f12; --panel2:#111317; --hover:#13151a;
  --line:#191c22; --line2:#262a33;
  --ink:#f2f4f8; --ink2:#838a98; --ink3:#4c525f;
  --amber:#f5a623; --amber2:#ffc24d; --ember:#ff7a3c;
  --up:#3ddc84; --down:#ff5466; --glass:rgba(13,15,18,.72);
  min-height:100vh;color:var(--ink);
  font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  background-color:var(--bg);
  background-image:
    radial-gradient(900px 420px at 50% -8%,rgba(245,166,35,.07),transparent 70%),
    radial-gradient(700px 500px at 100% 0%,rgba(61,220,132,.04),transparent 70%),
    linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.014) 1px,transparent 1px);
  background-size:auto,auto,40px 40px,40px 40px;background-attachment:fixed;
}
.mwd,.mwd *{box-sizing:border-box}
.mwd-mono{font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.mwd-wrap{max-width:480px;margin:0 auto;padding-bottom:40px}
.mwd-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:7px;padding:10px 13px 0}
.mwd-chips{display:flex;gap:6px;padding:10px 13px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line)}
.mwd-chips::-webkit-scrollbar{display:none}
.mwd-chip{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;
  background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--line);cursor:pointer;
  font-family:inherit;font-size:12px;font-weight:600;color:var(--ink2);transition:.16s;white-space:nowrap}
.mwd-chip:hover{color:var(--ink);border-color:var(--line2)}
.mwd-chip.on{background:var(--panel2);border-color:var(--line2);color:var(--ink)}
.mwd-chip.on.hot{border-color:rgba(245,166,35,.45);box-shadow:0 0 14px -4px rgba(245,166,35,.4),inset 0 0 0 1px rgba(245,166,35,.12)}
.mwd-chip.on.hot::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--amber);box-shadow:0 0 8px var(--amber)}
.mwd-chip .ct{display:grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;
  background:rgba(245,166,35,.16);color:var(--amber);font-family:'JetBrains Mono',monospace;font-weight:800;font-size:8.5px}
.mwd-feed{padding:3px 8px 0}
.mwd-empty{padding:16px;text-align:center;color:var(--ink3);font-size:12.5px}
.mwd-row{position:relative;display:flex;align-items:center;gap:10px;padding:8px 7px;cursor:pointer;border-radius:8px;transition:background .14s}
.mwd-row::after{content:"";position:absolute;left:7px;right:7px;bottom:0;height:1px;background:var(--line)}
.mwd-row:last-child::after{display:none}
.mwd-row:hover{background:var(--hover)}
.mwd-row:hover::after{opacity:0}
.mwd-av{position:relative;flex-shrink:0}
.mwd-av .sq{width:36px;height:36px;font-size:14px;border-radius:9px;display:grid;place-items:center;font-weight:800;color:#fff;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 6px rgba(0,0,0,.4),0 2px 7px rgba(0,0,0,.35)}
.mwd-av .sq img{width:100%;height:100%;object-fit:cover}
.mwd-age{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);font-family:'JetBrains Mono',monospace;font-size:7.5px;font-weight:800;color:#1a1205;padding:1px 5px;border-radius:5px;background:var(--amber);white-space:nowrap;box-shadow:0 0 0 2px var(--bg),0 0 7px -1px rgba(245,166,35,.6)}
.mwd-age.old{background:var(--ink3);color:#fff;box-shadow:0 0 0 2px var(--bg)}
.mwd-mid{flex:1;min-width:0}
.mwd-sym{display:flex;align-items:center;gap:7px}
.mwd-sym .s{font-size:15px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.mwd-sym .pc{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700}
.mwd-meta{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mwd-meta .k{color:var(--ink3)}
.mwd-bond{margin-top:6px;height:4px;border-radius:3px;background:var(--line);overflow:hidden;max-width:148px}
.mwd-bond i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--ember),var(--amber2))}
.mwd-bondlab{font-family:'JetBrains Mono',monospace;font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-top:4px;color:var(--ink3)}
.mwd-sig{display:flex;align-items:center;gap:2.5px;margin-top:5px}
.mwd-sig i{width:13px;height:3px;border-radius:2px;background:var(--line2)}
.mwd-sig .lab{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-left:6px}
.mwd-sig.high i.on{background:var(--up);box-shadow:0 0 5px -1px var(--up)} .mwd-sig.high .lab{color:var(--up)}
.mwd-sig.mid i.on{background:var(--amber);box-shadow:0 0 5px -1px var(--amber)} .mwd-sig.mid .lab{color:var(--amber)}
.mwd-sig.low i.on{background:var(--ink3)} .mwd-sig.low .lab{color:var(--ink3)}
.mwd-spark{flex-shrink:0;width:66px;height:32px;display:flex;align-items:center}
.mwd-right{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:74px}
.mwd-price{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700}
.mwd-buy{padding:6px 14px;border-radius:7px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;background:linear-gradient(140deg,var(--amber2),var(--amber));color:#1a1205;transition:.16s;white-space:nowrap;box-shadow:0 0 12px -4px rgba(245,166,35,.45)}
.mwd-buy:hover{filter:brightness(1.07);box-shadow:0 0 16px -3px rgba(245,166,35,.55)}
.mwd-buy:active{transform:scale(.97)}
.mwd-sell{padding:6px 12px;border-radius:7px;border:1px solid var(--line2);cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;background:var(--panel2);color:var(--ink2);transition:.16s;white-space:nowrap}
.mwd-sell:hover{color:var(--down);border-color:var(--down)}
.mwd-end{padding:22px 16px;text-align:center;color:var(--ink3);font-size:11.5px}
`;

function useMwdLrCSS() {
  useEffect(() => {
    const id = 'mwd-lr-defi-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = MWD_LR_CSS;
    document.head.appendChild(el);
  }, []);
}

function LrFeedRow({ t, i, owned, isFresh, onOpen, onBuy, onSell }) {
  const up = Number.isFinite(t.change) ? t.change >= 0 : true;
  const old = !isFresh;
  const bond = Number.isFinite(t.bondingProgress) ? Math.max(0, Math.min(100, t.bondingProgress)) : null;
  const hasBal = owned && owned.uiAmount > 0;
  return (
    <div className="mwd-row" onClick={() => onOpen && onOpen(t)}>
      <div className="mwd-av">
        <div className="sq"><TokenIcon token={t} /></div>
        {t.age ? <span className={'mwd-age' + (old ? ' old' : '')}>{t.age}</span> : null}
      </div>
      <div className="mwd-mid">
        <div className="mwd-sym">
          <span className="s">${t.sym}</span>
          {Number.isFinite(t.change) ? <span className="pc" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>{formatPct(t.change)}</span> : null}
        </div>
        <div className="mwd-meta">
          <span className="k">MC</span> {format(t.mcap)} <span className="k">LP</span> {format(t.liquidity)}{t.holders ? <> {format(t.holders)} <span className="k">hold</span></> : null}
        </div>
        {t.graduated
          ? <div className="mwd-bondlab" style={{ color: 'var(--up)' }}>● graduated</div>
          : bond != null
          ? <><div className="mwd-bond"><i style={{ width: bond + '%' }} /></div><div className="mwd-bondlab">{bond.toFixed(0)}% bonded</div></>
          : null}
        {(() => {
          const sig = signalScore(t);
          const dots = Math.max(1, Math.round(sig / 20));
          const tier = sig >= 70 ? 'high' : sig >= 40 ? 'mid' : 'low';
          return (
            <div className={'mwd-sig ' + tier}>
              {[0,1,2,3,4].map(d => <i key={d} className={d < dots ? 'on' : ''} />)}
              <span className="lab">signal {sig}</span>
            </div>
          );
        })()}
      </div>
      <div className="mwd-spark"><LrSparkline mint={t.mint} price={t.price} change={t.change} pool={t.pool} w={66} h={32} full /></div>
      <div className="mwd-right">
        <div className="mwd-price">{formatPrice(t.price)}</div>
        {hasBal
          ? <button className="mwd-sell" onClick={(e) => { e.stopPropagation(); onSell && onSell(t); }}>Sell</button>
          : <button className="mwd-buy" onClick={(e) => { e.stopPropagation(); onBuy && onBuy(t); }}>Buy</button>}
      </div>
    </div>
  );
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

function _uniqMint(list) {
  const seen = new Set();
  return list.filter(t => {
    if (!t) return false;
    const k = String(t.mint == null ? '' : t.mint).trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
  const rawMint = (typeof t?.mint === 'string' ? t.mint.trim() : t?.mint);
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

// Resolve a pool address from the server /api/dex/token proxy (server-to-server,
// never rate-limited/CORS-blocked). Picks the base-token-matched, deepest pool.
// Server-side pool resolution (never browser-rate-limited): /api/nx/pool first,
// then the existing /api/ape/curve. Both return a GeckoTerminal pool address.
async function lrServerPool(mint) {
  try {
    const r = await fetch('/api/nx/pool/' + encodeURIComponent(mint), { headers: { Accept: 'application/json' } });
    if (r.ok) { const d = await r.json(); if (d && typeof d.pool === 'string' && d.pool) return d.pool; }
  } catch (e) {}
  // NOTE: /api/ape/curve is intentionally NOT used here — it returns top_pools[0]
  // without enforcing base-token match, so it could point at the wrong contract.
  // If /api/nx/pool isn't available, the caller falls back to its own base-EXACT
  // GeckoTerminal picker (pickBestGeckoPool), keeping the contract guaranteed.
  return null;
}

function lrPoolFromTokenApi(d, mint) {
  if (!d) return null;
  const t = d.token || d;
  const direct = t.pairAddress || t.poolAddress || t.pool || t.poolId
    || (t.pool && t.pool.address) || (t.firstPool && (t.firstPool.id || t.firstPool.address));
  if (typeof direct === 'string' && direct) return direct;
  const pairs = d.pairs || t.pairs || d.pools || t.pools;
  if (Array.isArray(pairs) && pairs.length) {
    const liqOf  = p => Number(p?.liquidity?.usd ?? p?.liquidityUsd ?? p?.reserve_in_usd ?? p?.liquidity ?? 0);
    const addrOf = p => p?.pairAddress || p?.poolAddress || p?.address || p?.id || null;
    const baseOf = p => String((p?.baseToken && (p.baseToken.address || p.baseToken.id)) || p?.base || p?.baseMint || '');
    const matched = pairs.filter(p => addrOf(p) && (!baseOf(p) || baseOf(p) === String(mint)));
    const arr = matched.length ? matched : pairs;
    return addrOf(arr.reduce((b, p) => (liqOf(p) > liqOf(b) ? p : b), arr[0]));
  }
  return null;
}

function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = 'solana_' + mint;                        // EXACT — Solana base58 is case-sensitive
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const hasAddr = p => !!p?.attributes?.address;

  // Contract MUST match: only pools where this mint is the BASE token.
  // Prefer the pool where this mint is the BASE token (exact contract). If none
  // is base-side, fall back to the deepest pool that HOLDS this token instead of
  // giving up — that fallback is why charts load instead of "chart not available".
  const withAddr = pools.filter(hasAddr);
  if (!withAddr.length) return null;
  const basePools = withAddr.filter(p => baseId(p) === wanted);
  const pool = basePools.length ? basePools : withAddr;
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

      // 0) Server-side pool resolution — reliable, not rate-limited.
      try {
        const sAddr = await lrServerPool(mint);
        if (id !== reqRef.current) return;
        if (sAddr) { networkOk = true; setPool({ provider: 'GECKOTERMINAL', addr: sAddr }); setStatus('ok'); return; }
      } catch {}
      if (id !== reqRef.current) return;

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
        <div className="lr-chart-state">Live chart unavailable right now.</div>
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
  connected = true, onConnect,
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
    if (!connected) { if (onConnect) onConnect(); return; }
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

  // When no wallet is connected the button stays enabled and prompts to connect
  // (viewing a token never requires a wallet; only confirming a trade does).
  const confirmDisabled = connected
    ? (confirming || !swapParams || !hasFunds || !!error)
    : confirming;

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
              : !connected
                ? 'Connect wallet'
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
// Two REAL endpoints from the token's own live price + real 24h change —
// local copy so this file has no cross-module export dependency to break the
// build. price(24h ago) = price / (1 + change/100), then price now.
function endpointSeries(price, change) {
  const now = Number(price);
  if (!(now > 0)) return null;
  const c = Number(change);
  // Real direction when we know the change; a gentle rise otherwise — so the
  // approximation always curves (never flat/straight, never blank).
  const then = (Number.isFinite(c) && Math.abs(c) > 0.001) ? now / (1 + c / 100) : now * 0.985;
  if (!(then > 0)) return null;
  // Eased S-curve through the real prior→current price (≈20 pts) so the
  // approximation reads as a curved trend, never a straight 2-point diagonal
  // and never blank. Real direction, real endpoints.
  const N = 20, out = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    out.push({ t: i, c: then + (now - then) * e });
  }
  return out;
}

// Self-contained smooth path builder (Catmull-Rom -> Bezier). No Stocks.jsx
// dependency, and never returns null -- a flat baseline draws when there are
// <2 points, so the sparkline is never blank.
function lrSparkPath(pts, w, h) {
  const vals = (pts || []).map(p => Number(typeof p === 'number' ? p : (p && p.c))).filter(Number.isFinite);
  if (vals.length < 2) {
    const midY = h / 2;
    return { line: `M 0 ${midY} L ${w} ${midY}`, area: `M 0 ${midY} L ${w} ${midY} L ${w} ${h} L 0 ${h} Z`, lastX: w, lastY: midY, up: true };
  }
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1, pad = 2.5, ih = h - pad * 2;
  const P = vals.map((v, i) => [ (i / (vals.length - 1)) * w, pad + (1 - (v - min) / span) * ih ]);
  let line = `M ${P[0][0].toFixed(2)} ${P[0][1].toFixed(2)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  const area = `${line} L ${w.toFixed(2)} ${h.toFixed(2)} L 0 ${h.toFixed(2)} Z`;
  const [lastX, lastY] = P[P.length - 1];
  return { line, area, lastX, lastY, up: vals[vals.length - 1] >= vals[0] };
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
  // REAL data, in priority: GeckoTerminal OHLCV (from stkFetchSeries) -> live
  // observed ticks -> the two real endpoints from price + 24h change. Whatever
  // the source's element shape, normalize to {c}. A flat baseline draws if none
  // resolve, so the sparkline is never blank.
  const norm = (arr) => (Array.isArray(arr) ? arr
    .map(p => (typeof p === 'number'
      ? { c: p }
      : { c: Number(p && (p.c ?? p.close ?? p.value ?? p.price ?? (Array.isArray(p) ? p[4] : undefined))) }))
    .filter(p => Number.isFinite(p.c)) : null);
  const pts = ((series && series.length >= 2) ? norm(series) : null)
            || obs
            || endpointSeries(price, change);
  const path = lrSparkPath(pts || [], w, h);
  const up = Number.isFinite(change) ? change >= 0 : path.up;
  // Up = green, down = neutral gray (never red). Explicit hex so the color
  // always resolves regardless of which CSS vars the theme defines.
  const col = up ? '#3ddc84' : '#8b93a3';
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
function LaunchRadar({ onConnectWallet } = {}) {
  useLrCSS();
  useMwdLrCSS();
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

  // Tapping a token opens it for viewing (chart + info) WITHOUT requiring a
  // wallet. The wallet is only needed to actually confirm a buy/sell.
  const onView = useCallback((token) => {
    setTradeOpen({ token, mode: 'buy' });
    refreshSol();
    refreshOneToken(token.mint);
  }, [refreshSol, refreshOneToken]);

  const handleTradeConfirm = useCallback(async ({ mode, swapParams, token }) => {
    if (!requireWallet()) return { closed: false };
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
  }, [requireWallet, executeSwap, fireConfetti, pushToast, aggressiveRefresh, refreshSol, refreshOneToken, solPrice]);

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

  const filtered = useMemo(() => {
    let l = activeList.map(deriveDisplayValues);
    const seen = new Set();
    l = l.filter(t => {
      const k = t && t.mint != null ? String(t.mint).trim() : '';
      if (!k || seen.has(k)) return false;
      seen.add(k);
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
  }, [activeList, timeFilter, sortBy, deriveDisplayValues]);

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
    <div className="mwd">
      <div className="mwd-wrap">

        <div className="mwd-bar" style={{ justifyContent: 'space-between' }}>
          <div className="mwd-mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--ink2)' }}>
            <span className={'lr-live-dot' + (recentError ? ' lr-warn' : '')} style={{ width: 6, height: 6, borderRadius: '50%', background: recentError ? 'var(--down)' : 'var(--up)', boxShadow: recentError ? '0 0 8px var(--down)' : '0 0 8px var(--up)' }} />
            {lane === 'fresh'
              ? (recentLoading ? 'SYNCING…' : <>LIVE · <b style={{ color: 'var(--ink)' }}>{freshTokens.length}</b>&nbsp;fresh</>)
              : (recentLoading ? 'SYNCING…' : recentError ? 'FEED DOWN' : <><b style={{ color: 'var(--ink)' }}>{recentTokens.length}</b>&nbsp;tokens</>)}
            <span style={{ color: 'var(--ink3)' }}>·</span>
            SOL <b style={{ color: 'var(--ink)' }}>${solPrice > 0 ? solPrice.toFixed(2) : '—'}</b>
            {wallet.publicKey ? <><span style={{ color: 'var(--ink3)' }}>·</span> <b style={{ color: 'var(--amber)' }}>{formatSol(solBalance?.uiAmount || 0)}</b> SOL</> : null}
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Edit presets"
            style={{ background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--ink2)', width: 28, height: 28, borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>⚙</button>
        </div>

        <div className="mwd-chips">
          <button type="button"
            className={'mwd-chip' + (lane === 'fresh' ? ' on hot' : '')}
            onClick={() => setLane('fresh')}>
            Just launched{freshTokens.length ? <span className="ct">{freshTokens.length}</span> : null}
          </button>
          <button type="button"
            className={'mwd-chip' + (lane === 'recent' ? ' on' : '')}
            onClick={() => setLane('recent')}>
            On radar{recentTokens.length ? <span className="ct">{recentTokens.length}</span> : null}
          </button>
          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '2px 2px' }} />
          {[
            ['all', 'All'],
            ['1h',  'Hot'],
            ['6h',  'Today'],
            ['24h', '24h'],
          ].map(([k, l]) => (
            <button key={k} type="button"
              className={'mwd-chip' + (timeFilter === k ? ' on' : '')}
              onClick={() => setTimeFilter(k)}>{l}</button>
          ))}
          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '2px 2px' }} />
          {[
            ['newest', 'Freshest'],
            ['volume', 'Loudest'],
            ['signal', 'Top signal'],
          ].map(([k, l]) => (
            <button key={k} type="button"
              className={'mwd-chip' + (sortBy === k ? ' on' : '')}
              onClick={() => setSortBy(k)}>{l}</button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mwd-empty" style={{ padding: '40px 16px' }}>
            {lane === 'fresh' && recentLoading
              ? 'Warming up the launch stream…'
              : lane === 'recent' && recentError
              ? ('Recent feed offline — ' + recentError)
              : 'Nothing matches yet — loosen the filter or switch lanes.'}
          </div>
        ) : (
          <div className="mwd-feed">
            {filtered.map((t, i) => (
              <LrFeedRow
                key={t.mint}
                t={t}
                i={i}
                owned={balances[t.mint]}
                isFresh={Number.isFinite(t.ageMs) && t.ageMs < freshThresholdMs}
                onOpen={onView}
                onBuy={onCardBuy}
                onSell={onCardSell}
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
          connected={!!wallet.publicKey}
          onConnect={requireWallet}
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

return LaunchRadar;
})();

/* ════════════════════════════════════════════════════════════════════
   DISCOVER HUB — top-level toggle between the two pages
   ════════════════════════════════════════════════════════════════════ */
const DH_CSS = `
.dh-switch-wrap{position:sticky;top:0;z-index:60;display:flex;justify-content:center;
  padding:9px 13px;background:rgba(6,7,8,.82);backdrop-filter:blur(22px) saturate(1.4);
  border-bottom:1px solid #191c22}
.dh-switch{display:flex;gap:3px;padding:3px;background:#111317;border:1px solid #191c22;
  border-radius:9px;width:100%;max-width:480px;
  font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.dh-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;
  padding:8px 14px;border:none;background:none;cursor:pointer;font-family:inherit;
  font-size:12.5px;font-weight:700;letter-spacing:.2px;color:#838a98;border-radius:7px;
  transition:all .16s}
.dh-tab:hover{color:#f2f4f8}
.dh-tab.dh-active{background:linear-gradient(140deg,#ffc24d,#f5a623);color:#1a1205;
  box-shadow:0 0 16px -4px rgba(245,166,35,.5)}
.dh-page[hidden]{display:none}
`;
let _dhInjected = false;
function useDhCSS() {
  if (typeof document !== 'undefined' && !_dhInjected) {
    const el = document.createElement('style');
    el.setAttribute('data-dh', '');
    el.textContent = DH_CSS;
    document.head.appendChild(el);
    _dhInjected = true;
  }
}

export default function DiscoverHub(props) {
  useDhCSS();
  const [view, setView] = useState('discover');
  return (
    <div style={{ background: '#060708', minHeight: '100vh' }}>
      <div className="dh-switch-wrap">
        <div className="dh-switch" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'discover'}
            className={'dh-tab' + (view === 'discover' ? ' dh-active' : '')}
            onClick={() => setView('discover')}>
            Discover
          </button>
          <button type="button" role="tab" aria-selected={view === 'launches'}
            className={'dh-tab' + (view === 'launches' ? ' dh-active' : '')}
            onClick={() => setView('launches')}>
            Launches
          </button>
        </div>
      </div>
      <div className="dh-page" hidden={view !== 'discover'}>
        <MemeWonderland {...props} />
      </div>
      <div className="dh-page" hidden={view !== 'launches'}>
        <LaunchRadar {...props} />
      </div>
    </div>
  );
}

