// MemeWonderland.jsx — pastel wonderland. Jupiter swap, full 3% fee → FEE_WALLET.
// Sections: Hero · Top Signal · Narratives · Whale Radar · Breaking Out · New Launches · Trending · Live Feed.
   
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

/* ── TOKEN DETAIL CHART (GeckoTerminal / DexScreener embed, framed) ── */
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
  if (!Number.isFinite(p)) return '0%';
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
function normalize(t) {
  const change = Number(t?.stats24h?.priceChange ?? t?.priceChange24h ?? 0);
  const created = t.firstPool?.createdAt || t.createdAt;
  const am = ageMs(created);
  return {
    mint:      t.id || t.address || t.mint,
    sym:       t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    emoji:     emojiFor(t.symbol || ''),
    icon:      t.icon || t.logoURI || null,
    price:     Number(t.usdPrice ?? t.priceUsd ?? 0),
    change,
    age:       ageStr(am),
    ageMs:     am,
    mcap:      Number(t.mcap ?? t.fdv ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0),
    holders:   Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
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
    <div className="mw-featured" onClick={() => onOpen(token.mint)}>
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
        <button type="button" className="mw-btn-grad" onClick={(e) => { e.stopPropagation(); onTrade(token.mint, 'buy'); }}>⚡ TRADE NOW</button>
        <button type="button" className="mw-btn-ghost" onClick={(e) => { e.stopPropagation(); onOpen(token.mint); }}>details →</button>
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
        <div key={w.mint} className="mw-whale-card" onClick={() => onOpen(w.mint)}>
          <div className="mw-whale-row">
            <div className="mw-mini-avatar"><div className="mw-inner"><TokenIcon token={w} /></div></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mw-whale-sym">${w.sym}</div>
              <div className={'mw-whale-pct' + (w.change < 0 ? ' mw-down' : '')}>{formatPct(w.change || 0)}</div>
            </div>
          </div>
          <div className="mw-whale-stats">
            <span className="mw-l">🐋 {w.whaleCount || 1}</span>
            <span className="mw-r">+{format(w.whaleSol)} SOL</span>
          </div>
          <button type="button" className="mw-trade-pill" onClick={(e) => { e.stopPropagation(); onTrade(w.mint, 'buy'); }}>TRADE</button>
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
              <div className={'mw-bo-pct' + ((p.token.change || 0) < 0 ? ' mw-down' : '')}>{formatPct(p.token.change || 0)}</div>
              <div className="mw-bo-meta">{p.meta}</div>
              <button type="button" className="mw-trade-pill" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); onTrade(p.token.mint, 'buy'); }}>TRADE</button>
            </>
          ) : (
            <div className="mw-bo-empty">No matches yet.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Real-data sparkline — fetches actual OHLCV closes for the token's BEST pool
// (resolved BY CONTRACT, highest USD liquidity) from GeckoTerminal, DexScreener
// fallback. No synthetic price+change line. Lazy (IntersectionObserver) +
// in-memory cached so a list of rows doesn't hammer the API. If there's no real
// series yet, the row simply shows nothing rather than a fabricated shape.
const MWS_GT = 'https://api.geckoterminal.com/api/v2';
const MWS_DS = 'https://api.dexscreener.com/latest/dex';
const mwsSeriesCache = new Map();   // mint -> pts[] | null
const mwsInflight    = new Map();   // mint -> Promise

function mwsPickGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = ('solana_' + mint).toLowerCase();
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '').toLowerCase();
  const quoteId = p => String(p?.relationships?.quote_token?.data?.id || '').toLowerCase();
  const addr    = p => p?.attributes?.address;
  const liq     = p => Number(p?.attributes?.reserve_in_usd) || 0;
  const base = pools.filter(p => addr(p) && baseId(p) === wanted);
  const any  = pools.filter(p => addr(p) && (baseId(p) === wanted || quoteId(p) === wanted));
  const set  = base.length ? base : any;
  if (!set.length) return null;
  return set.reduce((b, p) => liq(p) > liq(b) ? p : b, set[0]);
}
async function mwsFetchSeries(mint) {
  if (!mint) return null;
  if (mwsSeriesCache.has(mint)) return mwsSeriesCache.get(mint);
  if (mwsInflight.has(mint)) return mwsInflight.get(mint);
  const p = (async () => {
    let pool = null;
    try {
      const r = await fetch(`${MWS_GT}/networks/solana/tokens/${mint}/pools`, { headers: { Accept: 'application/json' } });
      if (r.ok) { const j = await r.json(); const best = mwsPickGeckoPool(j?.data, mint); if (best?.attributes?.address) pool = best.attributes.address; }
    } catch (e) {}
    let out = null;
    if (pool) {
      try {
        const r = await fetch(`${MWS_GT}/networks/solana/pools/${pool}/ohlcv/hour?aggregate=1&limit=24&currency=usd`, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const j = await r.json();
          const list = j?.data?.attributes?.ohlcv_list;
          if (Array.isArray(list) && list.length >= 2) {
            const pts = list.map(x => Number(x[4])).filter(v => Number.isFinite(v) && v > 0).reverse();
            if (pts.length >= 2) out = pts;
          }
        }
      } catch (e) {}
    }
    mwsSeriesCache.set(mint, out);
    return out;
  })();
  mwsInflight.set(mint, p);
  try { return await p; } finally { mwsInflight.delete(mint); }
}
function mwSparkPath(vals, w, h, pad) {
  const xs = vals.length - 1, mn = Math.min(...vals), mx = Math.max(...vals), rg = (mx - mn) || 1;
  const X = i => (i / xs) * w, Y = v => h - pad - ((v - mn) / rg) * (h - 2 * pad);
  let d = 'M' + X(0).toFixed(1) + ' ' + Y(vals[0]).toFixed(1);
  for (let i = 1; i < vals.length; i++) d += ' L' + X(i).toFixed(1) + ' ' + Y(vals[i]).toFixed(1);
  return { line: d, area: d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' };
}
function MwSparkline({ mint, change, w = 50, h = 22, full = false }) {
  const [vals, setVals] = useState(() => (mint && mwsSeriesCache.get(mint)) || null);
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
    const cached = mint ? mwsSeriesCache.get(mint) : undefined;
    if (cached !== undefined) { setVals(cached); return; }
    setVals(null);
    if (!mint || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !done.current) {
          done.current = true; io.disconnect();
          mwsFetchSeries(mint).then(s => setVals(s || null)).catch(() => {});
        }
      });
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mint]);

  const ok = vals && vals.length >= 2;
  const up = ok ? vals[vals.length - 1] >= vals[0] : (Number(change) || 0) >= 0;
  const col = up ? 'var(--green)' : 'var(--down)';
  const pa = ok ? mwSparkPath(vals, w, h, 2) : null;
  const id = 'mws' + Math.random().toString(36).slice(2, 7);
  return (
    <svg ref={ref} width={full ? '100%' : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ flex: '0 0 auto', display: 'block' }}>
      {pa && (
        <>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.18" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
          <path d={pa.area} fill={`url(#${id})`} />
          <path d={pa.line} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
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
            <div key={t.mint} className="mw-launch-card" onClick={() => onOpen(t.mint)}>
              <div className="mw-launch-head">
                <div className="mw-mini-avatar"><div className="mw-inner"><TokenIcon token={t} /></div></div>
                <div className="mw-launch-info">
                  <div className="mw-launch-sym">${t.sym}</div>
                  <div className="mw-launch-age">⏱ {t.age} OLD</div>
                </div>
              </div>
              <div style={{ margin: '8px 0 2px' }}><MwSparkline mint={t.mint} change={t.change} w={150} h={30} full /></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Holders</span><span className="mw-launch-v">{t.holders ? format(t.holders) : '—'}</span></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Liquidity</span><span className="mw-launch-v">${format(t.liquidity)}</span></div>
              <div className="mw-launch-row"><span className="mw-launch-l">Signal</span><span className="mw-launch-v" style={{ color: 'var(--green)' }}>{signalScore(t)}</span></div>
              <button type="button" className="mw-trade-pill" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); onTrade(t.mint, 'buy'); }}>TRADE</button>
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
          <div key={t.mint} className="mw-trend-row" style={{ animationDelay: `${i * 0.03}s` }} onClick={() => onOpen(t.mint)}>
            <div className="mw-trend-rank">{i + 1}</div>
            <div className="mw-mini-avatar" style={{ width: 34, height: 34 }}>
              <div className="mw-inner" style={{ fontSize: 14 }}><TokenIcon token={t} /></div>
            </div>
            <div className="mw-trend-mid">
              <div className="mw-trend-sym">${t.sym}</div>
              <div className="mw-trend-sub">{tab === 'traded' ? `Vol $${format(t.volume24h)}` : tab === 'viewed' ? `Signal ${signalScore(t)}` : formatPrice(t.price)}</div>
            </div>
            <MwSparkline mint={t.mint} change={t.change} w={50} h={22} />
            <div className="mw-trend-right">
              <div className={'mw-trend-pct' + ((t.change || 0) < 0 ? ' mw-down' : '')}>{formatPct(t.change || 0)}</div>
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
   MAIN
   ════════════════════════════════════════════════════════════════════ */
export default function MemeWonderland({ onConnectWallet } = {}) {
  useMwCSS();

  const wallet = useWallet();
  // Single dRPC connection used for tx assembly + send.
  const connection = useMemo(() => getConn('confirmed'), []);

  const [tokens, setTokens] = useState([]);
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
          setTokens(list.map(normalize).filter(t => t.mint && t.mint !== SOL_MINT && t.sym !== 'WSOL' && t.sym !== 'SOL'));
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    }
    load();
    const id = setInterval(load, POLL_TOKENS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
          setSearchResults(list.map(normalize).filter(x => x.mint).slice(0, 12));
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

  const ticker = useMemo(
    () => tokens.slice(0, 10).map(t => [t.sym, formatPct(t.change), t.change >= 0]),
    [tokens]
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
    if (whaleMints.size === 0) return tokens;
    return tokens.map(t => {
      if (!whaleMints.has(t.mint)) return t;
      return {
        ...t,
        whaleSol: whaleByMint.get(t.mint) || 0,
        whaleCount: whaleCountByMint.get(t.mint) || 0,
        whaleAt: whaleLastAtByMint.get(t.mint) || 0,
      };
    });
  }, [tokens, whaleMints, whaleByMint, whaleCountByMint, whaleLastAtByMint]);

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

  const openDetail = (mint) => { setDetailMint(mint); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const closeDetail = () => setDetailMint(null);
  const openSheet = (mintOrToken, mode = 'buy') => {
    if (mintOrToken && typeof mintOrToken === 'object') {
      setDiscovered(prev => prev[mintOrToken.mint] ? prev : { ...prev, [mintOrToken.mint]: mintOrToken });
      setSheet({ mint: mintOrToken.mint, mode });
    } else if (typeof mintOrToken === 'string') {
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
      <div className="mw-blob" style={{ width: 400, height: 400, background: '#FF8FBE', top: -80, left: -120 }} />
      <div className="mw-blob" style={{ width: 500, height: 500, background: '#A0E7FF', top: '30%', right: -180, animationDelay: '3s' }} />
      <div className="mw-blob" style={{ width: 340, height: 340, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }} />
      <div className="mw-blob" style={{ width: 260, height: 260, background: '#FFD46B', bottom: '30%', right: '10%', animationDelay: '9s' }} />

      <div className="mw-ambient">
        <span>🐸</span><span>🚀</span><span>💎</span><span>🍭</span>
      </div>

      <div className="mw-phone">


        <div className="mw-search-wrap" ref={searchWrapRef}>
          <div className="mw-search">
            <span className="mw-search-ico">🔍</span>
            <input
              placeholder="Search any token, ticker, or contract"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            {searchQuery && (
              <button type="button" className="mw-search-clear" onClick={() => { setSearchQuery(''); setSearchResults(null); }}>×</button>
            )}
          </div>
          {searchOpen && searchQuery.trim() && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 18, right: 18, background: 'var(--glass-strong)', backdropFilter: 'blur(20px)', border: '1px solid var(--border)', borderRadius: 24, padding: 8, maxHeight: 380, overflowY: 'auto', boxShadow: '0 20px 48px rgba(183,148,246,0.25)', zIndex: 30 }}>
              {searching && (!searchResults || searchResults.length === 0) ? (
                <div className="mw-empty">Searching Jupiter…</div>
              ) : !searchResults || searchResults.length === 0 ? (
                <div className="mw-empty">No tokens found.</div>
              ) : (
                searchResults.map(t => (
                  <div key={t.mint} onClick={() => handleSearchSelect(t)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, cursor: 'pointer' }}>
                    <div className="mw-mini-avatar" style={{ width: 36, height: 36 }}>
                      <div className="mw-inner" style={{ fontSize: 16 }}><TokenIcon token={t} /></div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>${t.sym}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{t.name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{formatPrice(t.price)}</div>
                      <div style={{ fontSize: 10, color: t.change >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: 2 }}>{formatPct(t.change)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <StatsOrbs tokens={tokensWithWhale} whaleCount={whaleEvents.length} freshCount={freshCount} />

        {ticker.length > 0 && (
          <div className="mw-ticker-strip">
            <div className="mw-ticker-track">
              {[...ticker, ...ticker].map(([sym, change, up], i) => (
                <span className="mw-ticker-item" key={i}>
                  <span className="mw-sym">{sym}</span>
                  <span className={up ? 'mw-up' : 'mw-down'}>{change}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {topToken && (
          <>
            <div className="mw-section-head">
              <div className="mw-section-title"><span className="mw-ico">⚡</span>top signal</div>
              <div className="mw-section-meta"><span className="mw-live-dot" /> LIVE</div>
            </div>
            <FeaturedSignal token={topToken} whaleCount={whaleCountByMint.get(topToken.mint) || 0} onOpen={openDetail} onTrade={openSheet} />
          </>
        )}

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">🔥</span>narratives</div>
        </div>
        <NarrativesStrip tokens={tokensWithWhale} whaleMints={whaleMints} />

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">🐋</span>whale radar</div>
          <div className="mw-section-meta"><span className="mw-live-dot" /> {whaleTokens.length} ACTIVE</div>
        </div>
        <WhaleRadar whaleTokens={whaleTokens} onOpen={openDetail} onTrade={openSheet} />

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">🚀</span>breaking out</div>
        </div>
        <BreakingOut tokens={tokensWithWhale} whaleByMint={whaleByMint} excludeMint={topToken?.mint} onOpen={openDetail} onTrade={openSheet} />

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">✨</span>new launches</div>
        </div>
        <NewLaunches tokens={tokensWithWhale} onOpen={openDetail} onTrade={openSheet} />

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">📈</span>trending now</div>
        </div>
        <TrendingNow tokens={tokensWithWhale} onOpen={openDetail} />

        <div className="mw-section-head">
          <div className="mw-section-title"><span className="mw-ico">⚡</span>live feed</div>
          <div className="mw-section-meta"><span className="mw-live-dot" /> LIVE</div>
        </div>
        <ActivityFeed tokens={tokensWithWhale} whaleEvents={whaleEvents} onOpen={openDetail} />
      </div>

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
// that DexScreener has no pair for until graduation), DexScreener fallback.
// Both enforce: pool's BASE token must equal this mint (contract match;
// quote-side-only is a last resort), and pick the highest-USD-liquidity pool.
// The reduce is seeded with the first candidate so a single pool with 0 /
// unknown liquidity (brand-new tokens) still charts.
function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted  = 'solana_' + mint;                       // EXACT match — Solana base58 is case-sensitive
  const hasAddr = p => !!p?.attributes?.address;
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const quoteId = p => String(p?.relationships?.quote_token?.data?.id || '');
  const liq     = p => Number(p?.attributes?.reserve_in_usd) || 0;
  const base = pools.filter(p => hasAddr(p) && baseId(p) === wanted);                 // token is BASE → chart IS this token
  const any  = pools.filter(p => hasAddr(p) && (baseId(p) === wanted || quoteId(p) === wanted));
  const set  = base.length ? base : any;
  if (!set.length) return null;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);              // highest-liquidity pool
}

function pickBestPair(pairs, mint) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const ok  = p => p && p.chainId === 'solana' && p.pairAddress;
  const liq = p => Number(p.liquidity?.usd) || 0;
  const base = pairs.filter(p => ok(p) && p.baseToken?.address === mint);             // EXACT, case-sensitive
  const any  = pairs.filter(p => ok(p) && (p.baseToken?.address === mint || p.quoteToken?.address === mint));
  const set  = base.length ? base : any;
  if (!set.length) return null;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);              // highest-liquidity pair
}

/* ════════════════════════════════════════════════════════════════════
   EMBEDDED CHART  (matches Ape: GeckoTerminal → DexScreener, base-token
   pool match, resolution pills, 1s default, bigger frame). Resolution map
   is centralized in MW_CHART_RES so a provider tweak is one edit.
   ════════════════════════════════════════════════════════════════════ */
const MW_CHART_RES = [
  { key: '1s',  label: '1s', gecko: '1s',  dex: '1S'  },
  { key: '15s', label: '15s', gecko: '15s', dex: '15S' },
  { key: '1m',  label: '1m', gecko: '1m',  dex: '1'   },
  { key: '5m',  label: '5m', gecko: '5m',  dex: '5'   },
  { key: '1h',  label: '1H', gecko: '1h',  dex: '60'  },
];
const MW_RES_DEFAULT = '1s';

function mwBuildEmbedSrc(pool, resKey) {
  if (!pool) return null;
  const r = MW_CHART_RES.find(x => x.key === resKey) || MW_CHART_RES[0];
  if (pool.provider === 'GECKOTERMINAL') {
    return 'https://www.geckoterminal.com/solana/pools/' + pool.addr +
      '?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&bg_color=ffffff&resolution=' + r.gecko;
  }
  return 'https://dexscreener.com/solana/' + pool.addr +
    '?embed=1&theme=light&info=0&trades=0&interval=' + r.dex;
}

function MwTokenChart({ mint, symbol = '' }) {
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
    setStatus('loading'); setPool(null);

    (async () => {
      let networkOk = false;

      // 1) GeckoTerminal — covers pump.fun bonding-curve pools.
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

      // 2) DexScreener — fallback for graduated / older pairs.
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`,
          { headers: { Accept: 'application/json' } });
        if (id !== reqRef.current) return;
        if (r.ok) {
          networkOk = true;
          const j = await r.json();
          if (id !== reqRef.current) return;
          const best = pickBestPair(j?.pairs, mint);
          if (best?.pairAddress) { setPool({ provider: 'DEXSCREENER', addr: best.pairAddress }); setStatus('ok'); return; }
        }
      } catch {}
      if (id !== reqRef.current) return;

      // Neither provider had a pool. If at least one responded, the token
      // just isn't indexed yet (typical for a seconds-old bonding curve);
      // otherwise it's a network failure.
      setStatus(networkOk ? 'none' : 'fail');
    })();
  }, [mint]);

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
        <div className="mw-chart-state">Chart appears once {symbol || 'this token'} is indexed — trading on the bonding curve for now.</div>
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

      <MwTokenChart mint={token.mint} symbol={token.sym} />

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
            const st = await rpcRaceTrade('getSigStatus',
              c => c.getSignatureStatus(sig, { searchTransactionHistory: true }));
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
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
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
