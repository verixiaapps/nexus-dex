// Ape.jsx — Nexus DEX · Ape (early-launch trading terminal)
//
// Single-file build. Combines the React surface, the CSS, and the heavy
// auxiliary panels (StatsPanel + AutoPanel + useAutoTrade) that were
// temporarily split out during the rewrite.
//
// Pastel Wonderland-light palette throughout (matches /referrals + /why).
// Strips the old "specimen / wild / wonderland//radar" jargon. Fixes the
// open-positions flash bug. Simplifies the nav to two plain-text buttons
// ("Auto-trade" and "Referrals").
//
// Trading helpers (executeSwap, formatters, riskRead, share intents)
// come from ./ape-helpers — that file is unchanged.
//
// Wallet model: local burner keypair, signs locally, never leaves the
// device. mainWalletPubkey (from App.js) drives referral attribution; the
// burner drives trading and the personal trade log.
//
// FLASH-BUG FIX — root cause was that every poll built a brand-new
// balances object via setBalances(map), forcing every row that touched
// balances to re-render. The fix has four parts:
//   1) refreshBalances diffs new amounts against the previous map and
//      skips setBalances when nothing meaningful changed.
//   2) refreshOneToken does the same per-mint.
//   3) OpenPositionsStrip fetches per-token prices SEQUENTIALLY (50 ms
//      gap) and only setPrices for tokens whose price actually moved
//      (epsilon compare). Positions list is diffed before setState.
//   4) SpecimenRow is React.memo'd with a custom comparator (mint, price,
//      mcap, liq, change, holders, ageMs bucket, owned amount, busy,
//      ownedMode, isFresh).

import {
  executeSwap as apeExecuteSwap,
  format, formatMoney, formatPrice, formatPct, formatSol, formatSolSigned,
  formatUsdAbs, formatTokens, fmtAgeShort,
  lamportsToSol, truncWallet,
  RISK_CEIL, riskRead, normalize,
  friendlyError, colorFor, shade,
  buildBuyParams, buildSellParams,
  shareUrlPath, openTwitterShare, inviteUrl, openTelegram,
  refRegister,
  SOL_MINT, FEE_BPS, SOL_RESERVE,
  DEFAULT_BUY_PRESETS, DEFAULT_SELL_PRESETS,
  BAL_COMMITMENT, getConn, getTradeConn, balRpcRace,
} from './ape-helpers';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import bs58 from 'bs58';
import { PublicKey, Keypair, VersionedTransaction, TransactionMessage, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

/* ============================================================
   CSS — pastel Wonderland-light palette throughout
   ============================================================ */
const AP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&display=swap');

.ap-root{
  --ink:#1A1B4E; --ink2:rgba(26,27,78,0.7); --ink3:rgba(26,27,78,0.45);
  --hairline:rgba(26,27,78,0.08); --hairline2:rgba(26,27,78,0.14);
  --cyan:#3DD4F5; --sky:#A0E7FF; --pink:#FF8FBE; --lav:#B794F6; --mint:#7FFFD4;
  --peach:#FFB088; --gold:#FFD46B; --green:#0a7a4c; --red:#D14B6A; --amber:#7a5400;
  --cream:#FFFDF7;
  --glass:rgba(255,255,255,0.65); --glass-strong:rgba(255,255,255,0.85);
  --border:rgba(61,212,245,0.20); --border-hi:rgba(61,212,245,0.32);
  font-family:'Space Grotesk',-apple-system,system-ui,sans-serif;
  color:var(--ink); position:relative; overflow-x:hidden; padding-bottom:46px;
  -webkit-font-smoothing:antialiased;
}
.ap-root,.ap-root *{box-sizing:border-box}
@keyframes ap-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes ap-spin{to{transform:rotate(360deg)}}
@keyframes ap-fade{from{opacity:0}to{opacity:1}}
@keyframes ap-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes ap-pop{0%{opacity:0;transform:scale(.96)}60%{transform:scale(1.01)}100%{opacity:1;transform:scale(1)}}
@keyframes ap-sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes ap-shimmer{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes ap-cta-glow{0%,100%{box-shadow:0 12px 32px rgba(255,143,190,.30),0 0 0 1px rgba(255,143,190,.26)}50%{box-shadow:0 14px 36px rgba(160,231,255,.40),0 0 0 1px rgba(160,231,255,.36)}}
@keyframes ap-confetti{0%{transform:translate(-50%,-50%) rotate(0);opacity:1}100%{transform:translate(calc(-50% + var(--dx,0)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}}
@keyframes ap-toast{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}

.ap-app{max-width:1280px;margin:0 auto;position:relative;z-index:5}
.ap-page{padding:20px 28px 80px}
@media(max-width:768px){.ap-page{padding:14px 14px 80px}}

.ap-nav{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:10px;padding:14px 28px;background:rgba(251,245,255,0.78);backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid rgba(255,255,255,0.85)}
.ap-brand{display:flex;align-items:center;gap:11px;cursor:pointer}
.ap-brand-glyph{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,var(--sky),var(--pink));display:grid;place-items:center;flex-shrink:0;box-shadow:0 4px 14px rgba(160,231,255,.30);font-family:'Instrument Serif',serif;font-style:italic;font-size:18px;color:#fff;text-shadow:0 1px 2px rgba(26,27,78,.18)}
.ap-bname{font-family:'Instrument Serif',serif;font-size:24px;letter-spacing:-.015em;line-height:1;color:var(--ink)}
.ap-bname .it{font-style:italic;color:var(--ink2)}
.ap-bname .dot{color:var(--ink3);margin:0 4px}
.ap-nav-live{margin-left:auto;display:flex;align-items:center;gap:7px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);background:rgba(127,255,212,.14);padding:5px 11px;border-radius:999px;border:1px solid rgba(127,255,212,.30)}
.ap-nav-live .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ap-pulse 1.4s infinite}
.ap-nav-btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 14px;background:var(--glass-strong);border:1px solid var(--hairline);border-radius:999px;color:var(--ink);font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;letter-spacing:.02em;cursor:pointer;transition:.14s}
.ap-nav-btn:hover{border-color:var(--border-hi);background:rgba(61,212,245,.06)}
.ap-nav-wallet{display:flex;align-items:center;gap:8px;padding:9px 14px;background:linear-gradient(135deg,var(--glass-strong),rgba(255,255,255,0.65));border:1px solid var(--border);border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--ink);position:relative;transition:.14s}
.ap-nav-wallet:hover{border-color:var(--border-hi);box-shadow:0 4px 12px rgba(61,212,245,.16)}
.ap-nav-wallet .glyph{color:var(--gold);font-weight:800;font-family:initial}
.ap-nav-wallet .dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}
.ap-nav-wallet .nudge{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--gold);border:2px solid var(--cream);box-shadow:0 0 6px var(--gold)}
@media(max-width:600px){.ap-nav{padding:12px 14px;gap:8px}.ap-nav-live{display:none}.ap-nav-btn{padding:9px 11px;font-size:12px}}

.ap-qbar{position:sticky;top:62px;z-index:55;display:flex;align-items:center;gap:8px;padding:10px 28px;background:rgba(251,245,255,0.86);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,0.6);overflow-x:auto;scrollbar-width:none}
.ap-qbar::-webkit-scrollbar{display:none}
.ap-qlabel{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);flex-shrink:0;display:inline-flex;align-items:center;gap:6px}
.ap-qlabel .b{color:var(--pink);font-size:11px}
.ap-qamt{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);color:var(--ink);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;cursor:pointer;transition:.12s}
.ap-qamt:hover{border-color:var(--border)}
.ap-qamt.active{background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border-color:transparent;box-shadow:0 4px 14px rgba(160,231,255,.30)}
.ap-qamt .s{opacity:.55;font-size:11px}
.ap-qamt.active .s{opacity:.75}
.ap-qedit{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:var(--glass-strong);border:1px solid var(--hairline);display:grid;place-items:center;color:var(--ink2);font-size:13px;cursor:pointer}
.ap-qedit:hover{color:var(--cyan);border-color:var(--border-hi)}
.ap-qfast{flex-shrink:0;margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.06em;color:var(--green);background:rgba(127,255,212,.14);padding:6px 11px;border-radius:999px;white-space:nowrap;border:1px solid rgba(127,255,212,.28)}
.ap-qfast .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ap-pulse 1.3s infinite}
@media(max-width:768px){.ap-qbar{padding:9px 14px}}

.ap-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:6px 0 22px;border-bottom:1px solid var(--hairline);margin-bottom:22px;flex-wrap:wrap}
.ap-hero h1{font-family:'Instrument Serif',serif;font-size:52px;line-height:1;letter-spacing:-.025em;max-width:680px;margin:0;color:var(--ink)}
.ap-hero h1 .it{font-style:italic;background:linear-gradient(120deg,var(--sky),var(--lav),var(--pink));background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ap-shimmer 9s linear infinite}
.ap-hero-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ap-pill-no-connect{display:inline-flex;align-items:center;gap:7px;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--green);padding:7px 12px;border-radius:999px;background:rgba(127,255,212,.14);border:1px solid rgba(127,255,212,.28)}
.ap-hero-ref{display:inline-flex;align-items:center;gap:11px;padding:13px 20px;border-radius:14px;border:1px solid var(--border-hi);background:linear-gradient(135deg,rgba(160,231,255,.18),rgba(255,143,190,.14));color:var(--ink);font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.005em;cursor:pointer;transition:.14s}
.ap-hero-ref:hover{transform:translateY(-1px);border-color:var(--cyan);box-shadow:0 8px 24px rgba(160,231,255,.20)}
.ap-hero-ref .it{font-style:italic;color:var(--lav)}
.ap-hero-ref .pct{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:10.5px;color:#fff;background:linear-gradient(135deg,var(--pink),var(--lav));padding:4px 9px;border-radius:7px;letter-spacing:.06em;font-style:normal}
@media(max-width:768px){.ap-hero-ref{width:100%;justify-content:center}.ap-hero h1{font-size:36px}.ap-hero{flex-direction:column;align-items:flex-start;gap:14px}}

.ap-lure{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:18px;background:linear-gradient(135deg,rgba(160,231,255,.14),rgba(255,143,190,.10));border:1px solid rgba(160,231,255,.32);margin-bottom:18px;animation:ap-rise .35s cubic-bezier(.2,1,.3,1)}
.ap-lure-text{flex:1;min-width:0}
.ap-lure-h{font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-.015em;line-height:1.1;color:var(--ink)}
.ap-lure-h .it{font-style:italic;color:var(--cyan)}
.ap-lure-s{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3);margin-top:6px}
.ap-lure-s b{color:var(--green);font-weight:800}
.ap-lure-intro{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--ink);background:var(--glass-strong);border:1px solid var(--border);padding:9px 14px;border-radius:10px;flex-shrink:0;cursor:pointer;transition:.14s}
.ap-lure-intro:hover{border-color:var(--cyan);color:var(--cyan)}
.ap-lure-close{width:30px;height:30px;border-radius:9px;background:var(--glass-strong);border:1px solid var(--hairline);color:var(--ink2);font-size:14px;cursor:pointer;flex-shrink:0;font-family:initial}
.ap-lure-close:hover{color:var(--ink);border-color:var(--border)}

.ap-positions{background:linear-gradient(135deg,rgba(183,148,246,.12),var(--glass-strong));border:1px solid rgba(183,148,246,.30);border-radius:18px;overflow:hidden;margin-bottom:18px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1)}
.ap-positions-head{padding:12px 18px 8px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.ap-positions-head .e{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--lav)}
.ap-positions-head .roll{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;color:var(--ink2)}
.ap-positions-head .roll b{color:var(--green);font-weight:800}
.ap-positions-head .roll b.dn{color:var(--red)}
.ap-pos-strip-row{padding:9px 18px;display:flex;align-items:center;gap:12px;border-top:1px solid rgba(183,148,246,.14)}
.ap-pos-strip-av{flex-shrink:0;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:13px;color:#fff;overflow:hidden;box-shadow:0 2px 6px rgba(26,27,78,.16)}
.ap-pos-strip-av img{width:100%;height:100%;object-fit:cover}
.ap-pos-strip-sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;letter-spacing:-.005em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.ap-pos-strip-pnl{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;color:var(--green)}
.ap-pos-strip-pnl.dn{color:var(--red)}
.ap-pos-strip-pnl.dim{color:var(--ink3);font-weight:600}
.ap-pos-strip-pct{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;color:var(--ink2);min-width:52px;text-align:right}
.ap-pos-strip-pct.up{color:var(--green)}
.ap-pos-strip-pct.dn{color:var(--red)}
.ap-positions-foot{padding:10px 18px 11px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--lav);text-align:right;border-top:1px solid rgba(183,148,246,.14);cursor:pointer;background:none;border-left:none;border-right:none;border-bottom:none;width:100%;display:block;transition:color .14s}
.ap-positions-foot:hover{color:var(--ink)}

.ap-trending{margin-bottom:18px}
.ap-trending-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:0 4px 10px}
.ap-trending-head .lbl{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);display:inline-flex;align-items:center;gap:6px}
.ap-trending-head .meta{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase}
.ap-trending-rail{display:flex;gap:10px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}
.ap-trending-rail::-webkit-scrollbar{display:none}
.ap-trend-card{flex:0 0 auto;min-width:170px;padding:12px 14px;border-radius:14px;background:var(--glass-strong);border:1px solid rgba(255,212,107,.32);display:flex;align-items:center;gap:10px;cursor:pointer;transition:transform .14s,box-shadow .14s}
.ap-trend-card:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(255,212,107,.18)}
.ap-trend-card .av{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:14px;color:#fff;flex-shrink:0;overflow:hidden;box-shadow:0 2px 6px rgba(26,27,78,.16)}
.ap-trend-card .av img{width:100%;height:100%;object-fit:cover}
.ap-trend-card .meta{min-width:0;flex:1}
.ap-trend-card .sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:15.5px;letter-spacing:-.005em;line-height:1;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-trend-card .chg{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:800;letter-spacing:.02em;margin-top:3px;color:var(--green)}
.ap-trend-card .chg.dn{color:var(--red)}

.ap-list-frame{background:var(--glass-strong);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.85);border-radius:22px;overflow:hidden;margin-bottom:22px}
.ap-list-head{padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--hairline);flex-wrap:wrap}
.ap-list-title{display:flex;flex-direction:column;gap:2px}
.ap-list-title .e{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan)}
.ap-list-title .t{font-family:'Instrument Serif',serif;font-size:26px;letter-spacing:-.015em;color:var(--ink)}
.ap-list-title .t .it{font-style:italic;color:var(--ink2)}
.ap-list-filters{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.ap-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);font-size:12px;font-weight:600;color:var(--ink2);cursor:pointer;transition:.14s}
.ap-chip:hover{color:var(--ink);border-color:var(--border)}
.ap-chip.on{background:linear-gradient(135deg,rgba(160,231,255,.22),rgba(255,143,190,.18));border-color:var(--border-hi);color:var(--ink)}
.ap-chip.owned.on{background:rgba(127,255,212,.16);border-color:rgba(127,255,212,.40);color:var(--green)}
.ap-filter-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:10px;background:var(--glass-strong);border:1px solid var(--border);font-size:12px;font-weight:600;color:var(--ink);cursor:pointer;transition:.14s}
.ap-filter-btn:hover{border-color:var(--border-hi)}
.ap-filter-btn .ct{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--pink);color:#fff;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:9.5px}

.ap-list{padding:4px 0}
.ap-row{display:grid;grid-template-columns:1fr 90px 80px 100px 80px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--hairline);cursor:pointer;transition:background .15s;animation:ap-pop .35s cubic-bezier(.2,1.2,.4,1) backwards}
.ap-row:last-child{border-bottom:none}
.ap-row:hover{background:rgba(160,231,255,.05)}
.ap-row.fresh{animation:ap-pop .5s cubic-bezier(.2,1,.3,1)}

.ap-row-tk{display:flex;align-items:center;gap:12px;min-width:0}
.ap-av{width:40px;height:40px;border-radius:12px;flex-shrink:0;display:grid;place-items:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:16px;color:#fff;text-transform:uppercase;box-shadow:0 4px 14px rgba(26,27,78,.18);overflow:hidden;position:relative}
.ap-av img{width:100%;height:100%;object-fit:cover}
.ap-av .age-dot{position:absolute;bottom:-3px;right:-3px;font-family:'JetBrains Mono',monospace;font-size:8.5px;font-weight:800;color:#fff;padding:2px 5px;border-radius:6px;background:var(--green);box-shadow:0 0 0 2px var(--cream);letter-spacing:.04em;line-height:1}
.ap-av .age-dot.warm{background:var(--lav)}
.ap-av .age-dot.old{background:var(--ink3)}
.ap-av .age-dot.fresh{background:var(--green);box-shadow:0 0 0 2px var(--cream),0 0 10px var(--green);animation:ap-pulse 1.4s infinite}

.ap-name{min-width:0;flex:1}
.ap-sym-row{font-family:'Instrument Serif',serif;font-style:italic;font-size:18px;letter-spacing:-.005em;color:var(--ink);display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1}
.ap-sym-row .chg{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:800;color:var(--green);font-style:normal}
.ap-sym-row .chg.dn{color:var(--red)}
.ap-name-line{font-size:12px;color:var(--ink2);font-weight:500;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-name-line .price{color:var(--ink);font-weight:700;font-family:'JetBrains Mono',monospace}
.ap-name-line .dot{color:var(--ink3);opacity:.5;margin:0 4px}
.ap-name-line .mcap{color:var(--ink);font-family:'JetBrains Mono',monospace;font-weight:600}
.ap-name-line .ghost{color:var(--ink3);font-family:'JetBrains Mono',monospace;font-weight:500;font-size:10.5px}
.ap-name-line .ownedusd{color:var(--green);font-family:'JetBrains Mono',monospace;font-weight:700}

.ap-spark{width:76px;height:32px;flex-shrink:0}
.ap-spark svg{display:block;width:100%;height:100%}

.ap-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:lowercase}
.ap-pill .d{width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor}
.ap-pill.low{background:rgba(127,255,212,.16);color:var(--green)}
.ap-pill.med{background:rgba(255,212,107,.18);color:var(--amber)}
.ap-pill.high{background:rgba(209,75,106,.10);color:var(--red)}

.ap-owned-mark{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:6px;background:rgba(127,255,212,.18);color:var(--green);text-transform:uppercase;font-style:normal}

.wa-locked-edit{grid-column:1/-1;margin-bottom:4px}
.ap-row-action{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.ap-row-pnl{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:1px;margin-left:8px;min-width:74px;flex-shrink:0;font-family:'JetBrains Mono',monospace;line-height:1.1}
.ap-row-pnl .pct{font-size:13px;font-weight:800;letter-spacing:-.01em;color:var(--ink2)}
.ap-row-pnl .sol{font-size:10px;font-weight:700;color:var(--ink3);font-variant-numeric:tabular-nums}
.ap-row-pnl.up .pct,.ap-row-pnl.up .sol{color:var(--green)}
.ap-row-pnl.dn .pct,.ap-row-pnl.dn .sol{color:var(--red)}
.ap-btn-buy{padding:8px 14px;border-radius:10px;border:none;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12.5px;background:var(--sky);color:var(--ink);display:inline-flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(160,231,255,.30);transition:transform .12s,box-shadow .18s}
.ap-btn-buy:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(160,231,255,.40)}
.ap-btn-buy:disabled{opacity:.6;cursor:wait;transform:none}
.ap-btn-buy .arrow{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11px}
.ap-btn-buy.compact{padding:8px 12px;font-size:12px}
.ap-btn-sell{padding:8px 12px;border-radius:10px;border:1px solid rgba(209,75,106,.30);cursor:pointer;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12px;background:rgba(209,75,106,.08);color:var(--red);transition:.12s}
.ap-btn-sell:hover{background:var(--red);color:#fff;border-color:transparent;transform:translateY(-1px)}
.ap-btn-sell:disabled{opacity:.6;cursor:wait;transform:none}
.ap-spinner{width:12px;height:12px;border-radius:50%;border:2px solid rgba(26,27,78,.2);border-top-color:var(--ink);animation:ap-spin .7s linear infinite;display:inline-block}

.ap-list-foot{padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;border-top:1px solid var(--hairline)}
.ap-list-foot .live{display:inline-flex;align-items:center;gap:7px;color:var(--green)}
.ap-list-foot .live .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green);animation:ap-pulse 1.4s infinite}
.ap-list-foot .live.warn{color:var(--amber)}
.ap-list-foot .live.warn .d{background:var(--gold);box-shadow:0 0 10px var(--gold)}

@media(max-width:820px){.ap-row{grid-template-columns:1fr 60px 70px;gap:10px;padding:11px 16px}.ap-row .ap-spark{display:none}.ap-row .ap-pill{display:none}}
@media(max-width:560px){.ap-list-head{padding:14px 16px}}

.ap-empty{padding:48px 24px;text-align:center;color:var(--ink2);font-size:14px}
.ap-empty .glyph{display:block;font-family:'Instrument Serif',serif;font-style:italic;font-size:46px;color:var(--ink3);margin-bottom:14px}
.ap-empty b{display:block;color:var(--ink);font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-.015em;margin-bottom:6px}
.ap-empty .sub{font-size:13px;color:var(--ink3);max-width:380px;margin:0 auto;line-height:1.5}
.ap-empty .err{margin-top:10px;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--red);background:rgba(209,75,106,.08);padding:8px 12px;border-radius:9px;display:inline-block}

.ap-overlay{position:fixed;inset:0;background:rgba(26,27,78,.45);backdrop-filter:blur(8px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:ap-fade .2s}
.ap-overlay.center{align-items:center;padding:18px}
.ap-sheet{width:100%;max-width:520px;background:linear-gradient(180deg,#FBF5FF,#EEF3FF);border:1px solid rgba(255,255,255,0.85);border-radius:24px 24px 0 0;box-shadow:0 -20px 60px rgba(26,27,78,.22);animation:ap-sheet .3s cubic-bezier(.2,1.2,.4,1);max-height:94dvh;overflow-y:auto;padding-bottom:max(8px,env(safe-area-inset-bottom))}
.ap-sheet.mini{border-radius:24px;animation:ap-pop .3s ease;max-width:430px}
.ap-x{position:absolute;top:14px;right:14px;background:var(--glass-strong);border:1px solid var(--hairline);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-size:16px;color:var(--ink2);z-index:2;font-family:initial}
.ap-x:hover{color:var(--ink);border-color:var(--border)}

.ap-tshead{padding:22px 22px 6px;position:relative}
.ap-tshead-row{display:flex;align-items:center;gap:13px;padding-right:38px}
.ap-tshead .ap-av{width:56px;height:56px;border-radius:14px;font-size:21px}
.ap-tshead .title{flex:1;min-width:0}
.ap-tshead .sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:28px;letter-spacing:-.02em;line-height:1;color:var(--ink)}
.ap-tshead .sub{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--ink2);font-weight:600;margin-top:5px}

.ap-chart-wrap{margin:14px 22px 0;padding:12px 0 6px;border-top:1px solid var(--hairline)}
.ap-chart{position:relative;width:100%;height:84px;display:block}
.ap-chart svg{display:block;width:100%;height:100%}
.ap-chart-empty{height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center}
.ap-chart-empty .em-h{font-family:'Instrument Serif',serif;font-style:italic;font-size:14px;color:var(--ink2)}
.ap-chart-empty .em-s{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
.ap-chart-loading{height:84px;display:grid;place-items:center}
.ap-chart-loading .sp{width:14px;height:14px;border-radius:50%;border:2px solid var(--hairline);border-top-color:var(--cyan);animation:ap-spin .8s linear infinite}
.ap-tf-pills{display:flex;align-items:center;gap:4px;margin-top:6px;padding:0 2px}
.ap-tf{flex:0 0 auto;padding:4px 10px;border:none;background:transparent;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--ink3);border-radius:7px;cursor:pointer;transition:.12s}
.ap-tf:hover{color:var(--ink2)}
.ap-tf.on{background:var(--glass-strong);color:var(--ink);border:1px solid var(--hairline)}
.ap-tf.on.up{color:var(--green);border-color:rgba(127,255,212,.40)}
.ap-tf.on.dn{color:var(--red);border-color:rgba(209,75,106,.30)}
.ap-tf:disabled{opacity:.4;cursor:default}
.ap-tf-meta{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase}

.ap-safety{margin:14px 22px 0;border:1px solid var(--hairline);border-radius:14px;padding:13px 16px;background:rgba(127,255,212,.08)}
.ap-safety.amber{border-color:rgba(255,212,107,.32);background:rgba(255,212,107,.10)}
.ap-safety.red{border-color:rgba(209,75,106,.28);background:rgba(209,75,106,.08)}
.ap-safety-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.ap-safety-l{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.ap-safety-s{font-family:'Instrument Serif',serif;font-size:26px;line-height:1;display:flex;align-items:baseline;gap:3px;color:var(--green)}
.ap-safety-s.amber{color:var(--amber)}
.ap-safety-s.red{color:var(--red)}
.ap-safety-s .of{font-size:12px;color:var(--ink3)}
.ap-safety-verdict{font-family:'Instrument Serif',serif;font-style:italic;font-size:16px;line-height:1.35;margin-bottom:10px;color:var(--green)}
.ap-safety-verdict.amber{color:var(--amber)}
.ap-safety-verdict.red{color:var(--red)}
.ap-safety-chks{display:flex;flex-wrap:wrap;gap:6px}
.ap-chk{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;padding:4px 9px;border-radius:999px}
.ap-chk.ok{background:rgba(127,255,212,.18);color:var(--green)}
.ap-chk.cau{background:rgba(255,212,107,.18);color:var(--amber)}
.ap-chk.bad{background:rgba(209,75,106,.12);color:var(--red)}
.ap-dyor{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--ink3);padding:8px 22px 0;font-weight:600;line-height:1.5}

.ap-mode-tabs{display:grid;grid-template-columns:1fr 1fr;margin:14px 22px;background:var(--glass);border:1px solid var(--hairline);border-radius:12px;padding:3px;position:relative}
.ap-mode-ind{position:absolute;top:3px;bottom:3px;width:calc(50% - 3px);background:linear-gradient(135deg,var(--sky),var(--pink));border-radius:10px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1;box-shadow:0 4px 14px rgba(160,231,255,.32)}
.ap-mode-tabs.sell .ap-mode-ind{transform:translateX(100%);background:linear-gradient(135deg,#FFB088,var(--red));box-shadow:0 4px 14px rgba(255,176,136,.40)}
.ap-mode-tab{padding:11px 0;text-align:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:16px;color:var(--ink2);border:none;background:none;cursor:pointer;position:relative;z-index:2}
.ap-mode-tab.active{color:var(--ink)}

.ap-field{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;margin:0 22px}
.ap-field-row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.ap-field-l{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.ap-field-bal{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:var(--ink2);display:flex;align-items:center;gap:8px}
.ap-field-bal b{color:var(--ink);font-weight:700}
.ap-field-max{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;color:var(--cyan);padding:3px 8px;border-radius:6px;background:rgba(61,212,245,.10);border:1px solid var(--border);cursor:pointer;letter-spacing:.06em}
.ap-field-row2{display:flex;align-items:center;gap:11px}
.ap-field-chip{display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:var(--glass);border:1px solid var(--hairline);font-weight:700;font-size:13px;flex-shrink:0}
.ap-field-chip .lg{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--sky),var(--lav));display:grid;place-items:center;font-size:11px;color:#fff;font-weight:800;overflow:hidden}
.ap-field-chip .lg img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.ap-field-amt{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:'Instrument Serif',serif;font-size:26px;text-align:right;width:100%;min-width:0;letter-spacing:-.01em}
.ap-field-amt::placeholder{color:var(--ink3)}

.ap-presets{display:flex;gap:6px;margin:10px 22px 0;overflow-x:auto;scrollbar-width:none}
.ap-presets::-webkit-scrollbar{display:none}
.ap-preset{flex-shrink:0;padding:7px 13px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);color:var(--ink2);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;cursor:pointer;letter-spacing:.04em;transition:.12s}
.ap-preset:hover{color:var(--ink);border-color:var(--border)}
.ap-preset.on{background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border-color:transparent;box-shadow:0 3px 10px rgba(160,231,255,.30)}
.ap-preset.on.sell{background:linear-gradient(135deg,#FFB088,var(--red));color:#fff;box-shadow:0 3px 10px rgba(255,176,136,.30)}

.ap-summary{margin:12px 22px 0;padding:11px 14px;background:var(--glass);border:1px solid var(--hairline);border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:11.5px;display:flex;flex-direction:column;gap:6px}
.ap-sum{display:flex;justify-content:space-between;gap:8px;font-weight:700}
.ap-sum .k{color:var(--ink3);font-weight:600}
.ap-sum .v{color:var(--ink);font-weight:700;text-align:right}
.ap-sum .v.good{color:var(--green)}

.ap-banner{margin:12px 22px 0;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid rgba(209,75,106,.32);background:rgba(209,75,106,.08);color:var(--red)}
.ap-confirm{width:calc(100% - 44px);margin:14px 22px 0;padding:16px 0;border:none;border-radius:14px;font-family:'Instrument Serif',serif;font-size:18px;letter-spacing:-.01em;cursor:pointer;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);box-shadow:0 12px 28px rgba(160,231,255,.30),0 0 0 1px rgba(255,143,190,.18);animation:ap-cta-glow 3.6s ease-in-out infinite;transition:transform .12s}
.ap-confirm:hover:not(:disabled){transform:translateY(-1px)}
.ap-confirm.sell{background:linear-gradient(135deg,#FFB088,var(--red));color:#fff;box-shadow:0 12px 28px rgba(255,176,136,.32),0 0 0 1px rgba(209,75,106,.20)}
.ap-confirm:disabled{opacity:.5;cursor:not-allowed;background:var(--glass);color:var(--ink3);box-shadow:none;animation:none}
.ap-tfoot{margin:10px 22px 18px;font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--ink3);text-align:center;font-weight:700;letter-spacing:.08em;text-transform:uppercase}

.ap-balcard{background:linear-gradient(135deg,rgba(160,231,255,.20),rgba(255,143,190,.16));border:1px solid var(--border);border-radius:18px;padding:18px;text-align:center;margin-bottom:13px}
.ap-ballbl{font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);font-weight:800}
.ap-balval{font-family:'Instrument Serif',serif;font-size:38px;margin-top:6px;letter-spacing:-.02em;color:var(--ink)}
.ap-balval .u{font-size:18px;color:var(--ink2)}
.ap-balusd{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink2);font-weight:700;margin-top:4px}
.ap-wgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}
.ap-wact{padding:13px 0;border-radius:13px;border:1px solid var(--hairline);background:var(--glass-strong);color:var(--ink);font-weight:700;font-size:13px;cursor:pointer;transition:.12s}
.ap-wact:hover{border-color:var(--border)}
.ap-wact.primary{background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border-color:transparent;box-shadow:0 4px 14px rgba(160,231,255,.30)}
.ap-block{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;margin-bottom:11px}
.ap-wtoken{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--hairline)}
.ap-wtoken:last-child{border-bottom:none}
.ap-wtoken .ap-av{width:34px;height:34px;border-radius:9px;font-size:14px;flex-shrink:0}
.ap-wtoken-nm{flex:1;min-width:0}
.ap-wtoken-sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.ap-wtoken-amt{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:var(--ink2);margin-top:2px}
.ap-wtoken-usd{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:12.5px;color:var(--green);flex-shrink:0}
.ap-block-l{font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:800;margin-bottom:9px}
.ap-qr{display:grid;place-items:center;margin-bottom:11px}
.ap-qr canvas,.ap-qr img{border-radius:12px;background:#fff;padding:8px;width:160px;height:160px;box-shadow:0 4px 14px rgba(26,27,78,.10)}
.ap-addr{display:flex;align-items:center;gap:8px}
.ap-addr-v{flex:1;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink);font-weight:600;word-break:break-all;line-height:1.4}
.ap-copy{flex-shrink:0;background:var(--glass);border:1px solid var(--hairline);color:var(--ink2);border-radius:9px;padding:8px 12px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;cursor:pointer;letter-spacing:.08em}
.ap-copy:hover{color:var(--ink);border-color:var(--border)}
.ap-input{width:100%;padding:11px 13px;border-radius:11px;background:var(--glass);border:1px solid var(--hairline);color:var(--ink);font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;outline:none;margin-bottom:8px}
.ap-input:focus{border-color:var(--cyan)}
.ap-go{width:100%;padding:13px 0;border:none;border-radius:12px;font-weight:700;font-size:13.5px;cursor:pointer;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);box-shadow:0 4px 14px rgba(160,231,255,.30)}
.ap-go:disabled{opacity:.5;cursor:not-allowed;background:var(--glass);color:var(--ink3);box-shadow:none}
.ap-secret{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--amber);word-break:break-all;line-height:1.5;background:rgba(255,212,107,.10);border:1px dashed rgba(255,212,107,.40);border-radius:10px;padding:11px 12px}
.ap-warn{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--amber);background:rgba(255,212,107,.12);border:1px solid rgba(255,212,107,.32);border-radius:12px;padding:10px 12px;line-height:1.55;font-weight:600;margin-bottom:11px}
.ap-warn b{color:var(--amber)}
.ap-nc{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green);background:rgba(127,255,212,.18);padding:5px 12px;border-radius:999px;border:1px solid rgba(127,255,212,.32)}

.ap-echips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ap-echip{display:inline-flex;align-items:center;gap:7px;padding:8px 8px 8px 14px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--ink)}
.ap-echip .x{width:19px;height:19px;border-radius:50%;background:rgba(209,75,106,.10);color:var(--red);border:none;cursor:pointer;font-size:12px;display:grid;place-items:center;font-family:initial}
.ap-eadd{display:flex;gap:6px;align-items:center}
.ap-eadd input{width:74px;padding:8px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--ink);outline:none}
.ap-eadd .plus{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border:none;cursor:pointer;font-size:17px;font-family:initial;box-shadow:0 3px 8px rgba(160,231,255,.30)}
.ap-sec-lbl{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--ink3);margin:16px 0 9px}
.ap-esave{width:100%;margin-top:18px;padding:14px 0;border:none;border-radius:13px;font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.005em;cursor:pointer;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);box-shadow:0 6px 18px rgba(160,231,255,.30)}

.ap-filter-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--hairline)}
.ap-filter-row:last-child{border-bottom:none}
.ap-filter-row .lbl{font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.005em;color:var(--ink)}
.ap-filter-row .lbl-sub{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--ink3);margin-top:3px}
.ap-toggle{position:relative;width:48px;height:28px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);cursor:pointer;transition:.2s;flex-shrink:0}
.ap-toggle::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:var(--ink);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.ap-toggle.on{background:linear-gradient(135deg,var(--sky),var(--pink));border-color:transparent}
.ap-toggle.on::after{transform:translateX(20px);background:#fff}
.ap-liq-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.ap-liq-chip{padding:6px 12px;border-radius:999px;background:var(--glass-strong);border:1px solid var(--hairline);color:var(--ink2);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;cursor:pointer}
.ap-liq-chip.on{background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border-color:transparent}

.ap-toasts{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:1100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.ap-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:14px;backdrop-filter:blur(20px);box-shadow:0 14px 36px rgba(26,27,78,.22);animation:ap-toast .3s ease;font-size:13px;font-weight:600;border:1px solid rgba(255,255,255,0.85);color:var(--ink)}
.ap-toast.success{background:linear-gradient(135deg,rgba(255,255,255,0.92),rgba(127,255,212,.30));border-color:rgba(127,255,212,.50)}
.ap-toast.error{background:linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,176,136,.30));border-color:rgba(255,176,136,.50)}
.ap-toast.info{background:rgba(255,255,255,0.94)}
.ap-toast .em{font-size:22px;flex-shrink:0;color:var(--green)}
.ap-toast.error .em{color:var(--red)}
.ap-toast .tb{flex:1;min-width:0;line-height:1.35}
.ap-toast .tb b{font-weight:800}
.ap-toast .ta{display:flex;gap:5px;flex-shrink:0}
.ap-taction{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);padding:6px 10px;border-radius:9px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;letter-spacing:.08em}
.ap-taction.tw{background:linear-gradient(135deg,rgba(160,231,255,.30),rgba(127,255,212,.30));border-color:rgba(160,231,255,.45)}
.ap-taction svg{width:11px;height:11px}

.ap-confetti{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}
.ap-cpiece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:ap-confetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}

.wp-root{position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:'Space Grotesk',sans-serif;background:radial-gradient(ellipse at 80% 0%,#D9ECFF 0%,transparent 50%),radial-gradient(ellipse at 15% 10%,#FFE8F4 0%,transparent 45%),radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),linear-gradient(180deg,#FBF5FF 0%,#EEF3FF 100%);animation:ap-fade .25s ease}
.wp-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:16px 28px;background:rgba(251,245,255,0.84);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid rgba(255,255,255,0.85)}
.wp-headlbl{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);margin-left:auto;display:flex;align-items:center;gap:8px}
.wp-headlbl .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ap-pulse 1.4s infinite}
.wp-close{width:42px;height:42px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--hairline);display:grid;place-items:center;cursor:pointer;color:var(--ink2);font-size:18px;font-family:initial}
.wp-close:hover{color:var(--ink);border-color:var(--border)}
@media(max-width:768px){.wp-head{padding:14px 16px;gap:12px}.wp-headlbl{display:none}}

.wp-tabs{position:sticky;top:67px;z-index:4;display:flex;gap:0;padding:0 28px;background:rgba(251,245,255,0.84);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--hairline);overflow-x:auto;scrollbar-width:none}
.wp-tabs::-webkit-scrollbar{display:none}
.wp-tab{flex-shrink:0;padding:18px 22px;border:none;background:none;cursor:pointer;font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.005em;color:var(--ink2);position:relative;border-bottom:2px solid transparent;display:flex;align-items:center;gap:10px;min-height:54px;transition:color .18s}
.wp-tab .glyph{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;opacity:.5}
.wp-tab:hover{color:var(--ink)}
.wp-tab.on{color:var(--ink);border-bottom-color:var(--pink)}
.wp-tab.on .glyph{opacity:1;color:var(--pink)}
@media(max-width:768px){.wp-tabs{padding:0 14px}.wp-tab{padding:16px 14px;font-size:16px}}

.wp-page{max-width:1080px;margin:0 auto;padding:32px 28px 80px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wp-page{padding:24px 14px 80px}}

.wp-eyebrow{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:10px;margin-bottom:14px}
.wp-eyebrow .rule{flex:1;height:1px;max-width:220px;background:linear-gradient(90deg,var(--hairline2),transparent)}
.wp-eyebrow .glyph{color:var(--cyan);font-size:13px}

.wp-h1{font-family:'Instrument Serif',serif;font-size:48px;line-height:1;letter-spacing:-.025em;margin:0 0 10px;color:var(--ink)}
.wp-h1 .it{font-style:italic;background:linear-gradient(120deg,var(--sky),var(--lav),var(--pink));background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ap-shimmer 9s linear infinite}
.wp-sub{font-size:15.5px;line-height:1.5;color:var(--ink2);margin:0 0 28px;max-width:640px;font-weight:500}
@media(max-width:768px){.wp-h1{font-size:34px}.wp-sub{font-size:14.5px;margin-bottom:22px}}

.wp-card{background:var(--glass-strong);border:1px solid rgba(255,255,255,0.85);border-radius:22px;padding:24px;margin-bottom:18px;animation:ap-rise .45s .05s cubic-bezier(.2,1,.3,1) backwards}
.wp-card.feature{background:linear-gradient(135deg,rgba(160,231,255,.16),var(--glass-strong));border-color:rgba(160,231,255,.32)}
.wp-card-eye{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);display:flex;align-items:center;gap:8px;margin-bottom:14px}

.wp-link{display:flex;align-items:stretch;gap:8px;background:var(--glass);border:1px solid var(--hairline);border-radius:14px;padding:8px;margin:18px 0 14px}
.wp-link-v{flex:1;min-width:0;padding:10px 14px;font-family:'JetBrains Mono',monospace;font-size:13.5px;font-weight:600;color:var(--ink);background:transparent;border:none;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wp-link-cp{flex-shrink:0;display:inline-flex;align-items:center;gap:8px;padding:0 18px;min-height:44px;border-radius:10px;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11.5px;letter-spacing:.08em;box-shadow:0 4px 14px rgba(160,231,255,.30)}
.wp-link-cp:hover{transform:translateY(-1px)}
.wp-link-cp.copied{background:linear-gradient(135deg,var(--mint),var(--green));color:#fff;box-shadow:0 4px 14px rgba(127,255,212,.45)}

.wp-share-row{display:flex;gap:8px;flex-wrap:wrap}
.wp-sh{flex:1;min-width:120px;min-height:44px;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:12px;border:1px solid var(--hairline);background:var(--glass-strong);color:var(--ink);font-weight:700;font-size:13px;cursor:pointer;transition:.15s}
.wp-sh:hover{border-color:var(--border)}
.wp-sh.tw{background:linear-gradient(135deg,rgba(160,231,255,.22),rgba(127,255,212,.20));border-color:rgba(160,231,255,.40)}
.wp-sh.tg{background:linear-gradient(135deg,rgba(160,231,255,.18),rgba(160,231,255,.06));border-color:rgba(160,231,255,.40)}
.wp-sh.ds{background:linear-gradient(135deg,rgba(183,148,246,.22),rgba(160,231,255,.16));border-color:rgba(183,148,246,.40)}
.wp-sh .ico{display:inline-grid;place-items:center;width:18px;height:18px;flex-shrink:0}
.wp-sh .ico svg{width:14px;height:14px}

.wp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.wp-stat{background:var(--glass-strong);border:1px solid rgba(255,255,255,0.85);border-radius:18px;padding:18px;animation:ap-rise .5s cubic-bezier(.2,1,.3,1) backwards}
.wp-stat:nth-child(1){animation-delay:.04s}
.wp-stat:nth-child(2){animation-delay:.08s}
.wp-stat:nth-child(3){animation-delay:.12s}
.wp-stat:nth-child(4){animation-delay:.16s}
.wp-stat-l{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:7px;margin-bottom:10px}
.wp-stat-l .gl{color:var(--cyan);font-size:11px}
.wp-stat-v{font-family:'Instrument Serif',serif;font-size:32px;line-height:1;letter-spacing:-.02em;color:var(--ink)}
.wp-stat-v .u{font-size:14px;color:var(--ink2);font-family:'JetBrains Mono',monospace;font-weight:700;margin-left:5px}
.wp-stat-v.gn{color:var(--green)}
.wp-stat-v.rd{color:var(--red)}
.wp-stat-v.it{font-style:italic;color:var(--ink2)}
.wp-stat-m{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--ink2);margin-top:6px}
@media(max-width:768px){.wp-stats{grid-template-columns:1fr 1fr;gap:10px}.wp-stat-v{font-size:26px}}

.wp-rules{display:grid;gap:12px;margin-top:18px}
.wp-rule{display:flex;gap:14px;padding:14px 16px;border-radius:14px;background:var(--glass);border:1px solid var(--hairline)}
.wp-rule .n{flex-shrink:0;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11px;background:rgba(61,212,245,.10);color:var(--cyan);border:1px solid var(--border)}
.wp-rule .h{font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.005em;line-height:1.3;margin-bottom:3px;color:var(--ink)}
.wp-rule .h .it{font-style:italic;color:var(--cyan)}
.wp-rule .b{font-size:13.5px;line-height:1.5;color:var(--ink2)}
.wp-rule .b b{color:var(--ink);font-weight:700}

.wp-pnl-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:28px 28px 24px;background:linear-gradient(135deg,rgba(127,255,212,.16),var(--glass-strong));border:1px solid rgba(127,255,212,.32);border-radius:22px;margin-bottom:18px;position:relative;overflow:hidden}
.wp-pnl-hero.neg{background:linear-gradient(135deg,rgba(255,176,136,.18),var(--glass-strong));border-color:rgba(255,176,136,.36)}
.wp-pnl-hero-l{min-width:0;flex:1 1 240px}
.wp-pnl-eye{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:9px;margin-bottom:10px}
.wp-pnl-eye .gl{font-size:12px;color:var(--green)}
.wp-pnl-eye.neg .gl{color:var(--red)}
.wp-pnl-val{font-family:'Instrument Serif',serif;font-size:68px;line-height:1;letter-spacing:-.035em;color:var(--green)}
.wp-pnl-val.neg{color:var(--red)}
.wp-pnl-val .u{font-size:24px;color:var(--ink2);font-family:'JetBrains Mono',monospace;font-weight:700;margin-left:8px}
.wp-pnl-usd{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:var(--ink2);margin-top:8px}
.wp-pnl-r{flex-shrink:0;align-self:flex-end}
.wp-pnl-share{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:0 22px;border-radius:13px;background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);border:none;cursor:pointer;font-weight:700;font-size:13.5px;box-shadow:0 8px 24px rgba(160,231,255,.30);transition:transform .12s}
.wp-pnl-share:hover{transform:translateY(-1px)}
.wp-pnl-share svg{width:14px;height:14px}
@media(max-width:768px){.wp-pnl-val{font-size:48px}.wp-pnl-hero{padding:22px 20px 20px}}

.wp-pos-frame{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:18px}
.wp-pos-head{padding:16px 22px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--hairline)}
.wp-pos-head .e{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.wp-pos-row{display:grid;grid-template-columns:36px 1fr 90px 110px 100px 110px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--hairline);transition:background .18s}
.wp-pos-row:last-child{border-bottom:none}
.wp-pos-row:hover{background:rgba(160,231,255,.05)}
.wp-pos-row.thead{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);padding:11px 22px;background:rgba(0,0,0,.02)}
.wp-pos-no{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--ink3)}
.wp-pos-tk{display:flex;align-items:center;gap:10px;min-width:0}
.wp-pos-av{flex-shrink:0;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:13px;color:#fff;text-transform:uppercase;box-shadow:0 3px 10px rgba(26,27,78,.16)}
.wp-pos-sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;letter-spacing:-.005em;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:8px;color:var(--ink)}
.wp-pos-status{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.04em;padding:2px 6px;border-radius:5px;text-transform:uppercase;font-style:normal}
.wp-pos-status.open{background:rgba(127,255,212,.18);color:var(--green)}
.wp-pos-status.closed{background:rgba(26,27,78,.06);color:var(--ink2)}
.wp-pos-meta{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--ink2);margin-top:2px}
.wp-pos-num{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;color:var(--ink)}
.wp-pos-num.dim{color:var(--ink2);font-weight:600}
.wp-pos-num.gn{color:var(--green)}
.wp-pos-num.rd{color:var(--red)}
@media(max-width:900px){.wp-pos-row{grid-template-columns:1.5fr 90px 110px;gap:8px;padding:12px 16px}.wp-pos-row.thead{padding:10px 16px}.wp-pos-no,.wp-col-avg,.wp-col-open{display:none}}

.wp-win-tabs{display:flex;gap:6px;margin-bottom:18px;background:var(--glass);padding:5px;border-radius:14px;border:1px solid var(--hairline);max-width:fit-content}
.wp-win-tab{padding:10px 18px;min-height:40px;border:none;cursor:pointer;border-radius:10px;background:transparent;color:var(--ink2);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;transition:.18s}
.wp-win-tab:hover{color:var(--ink)}
.wp-win-tab.on{background:linear-gradient(135deg,var(--sky),var(--pink));color:var(--ink);box-shadow:0 4px 14px rgba(160,231,255,.30)}

.wp-lb-frame{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;overflow:hidden}
.wp-lb-row{display:grid;grid-template-columns:60px 1fr 130px 80px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--hairline);transition:background .18s}
.wp-lb-row:last-child{border-bottom:none}
.wp-lb-row:hover{background:rgba(160,231,255,.05)}
.wp-lb-row.thead{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);padding:11px 22px;background:rgba(0,0,0,.02)}
.wp-lb-row.mine{background:linear-gradient(90deg,rgba(255,143,190,.14),rgba(255,143,190,.02));border-left:3px solid var(--pink);padding-left:19px}
.wp-lb-rank{font-family:'Instrument Serif',serif;font-size:20px;letter-spacing:-.02em;color:var(--ink)}
.wp-lb-rank.gold{color:var(--gold)}
.wp-lb-rank.silver{color:var(--lav)}
.wp-lb-rank.bronze{color:#D49B7C}
.wp-lb-rank .hash{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;color:var(--ink3);margin-right:2px}
.wp-lb-w{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wp-lb-w .you{font-weight:800;color:var(--pink);font-size:11px;margin-left:8px;letter-spacing:.06em;text-transform:uppercase}
.wp-lb-vol{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13.5px;color:var(--ink);text-align:right}
.wp-lb-vol .u{color:var(--ink2);font-weight:600;font-size:10.5px;margin-left:3px}
.wp-lb-tr{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;color:var(--ink2);text-align:right}
.wp-lb-foot{padding:13px 22px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--hairline)}
@media(max-width:768px){.wp-lb-row{grid-template-columns:50px 1fr 100px;gap:8px;padding:12px 16px}.wp-lb-row.thead{padding:10px 16px}.wp-col-tr{display:none}}

.wp-empty{padding:54px 28px;text-align:center;animation:ap-fade .3s}
.wp-empty .gl{display:block;font-family:'Instrument Serif',serif;font-style:italic;font-size:44px;color:var(--ink3);margin-bottom:14px}
.wp-empty .h{font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-.015em;color:var(--ink);margin-bottom:6px}
.wp-empty .h .it{font-style:italic;color:var(--ink2)}
.wp-empty .s{font-size:13.5px;color:var(--ink2);max-width:380px;margin:0 auto;line-height:1.5}
.wp-empty .e{margin-top:12px;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;color:var(--red);background:rgba(209,75,106,.08);padding:8px 12px;border-radius:9px;display:inline-block}
.wp-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--hairline);border-top-color:var(--cyan);animation:ap-spin .8s linear infinite;display:inline-block;vertical-align:-3px;margin-right:8px}

.wp-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2100;display:flex;align-items:center;gap:10px;padding:13px 18px;border-radius:14px;background:var(--glass-strong);backdrop-filter:blur(20px);border:1px solid rgba(127,255,212,.40);font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:700;color:var(--ink);box-shadow:0 14px 36px rgba(26,27,78,.18);animation:ap-rise .25s ease}
.wp-toast .gl{font-size:14px;color:var(--green)}

.wa-root{position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:'Space Grotesk',sans-serif;background:radial-gradient(ellipse at 80% 0%,#D9ECFF 0%,transparent 50%),radial-gradient(ellipse at 15% 10%,#FFE8F4 0%,transparent 45%),linear-gradient(180deg,#FBF5FF 0%,#EEF3FF 100%);animation:ap-fade .25s ease}
.wa-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:16px 28px;background:rgba(251,245,255,0.84);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid rgba(255,255,255,0.85)}
.wa-stat-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-left:auto}
.wa-stat-pill.off{background:var(--glass);color:var(--ink2);border:1px solid var(--hairline)}
.wa-stat-pill.on{background:rgba(127,255,212,.18);color:var(--green);border:1px solid rgba(127,255,212,.40)}
.wa-stat-pill.on .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ap-pulse 1.4s infinite}
.wa-stat-pill.paused{background:rgba(255,212,107,.18);color:var(--amber);border:1px solid rgba(255,212,107,.40)}
.wa-close{width:42px;height:42px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--hairline);display:grid;place-items:center;cursor:pointer;color:var(--ink2);font-size:18px;font-family:initial}
@media(max-width:768px){.wa-head{padding:14px 16px}}

.wa-page{max-width:920px;margin:0 auto;padding:28px 28px 110px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wa-page{padding:22px 14px 110px}}
.wa-eye{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:10px;margin-bottom:12px}
.wa-eye .gl{color:var(--cyan);font-size:13px}
.wa-eye .rule{flex:1;height:1px;max-width:200px;background:linear-gradient(90deg,var(--hairline2),transparent)}
.wa-h1{font-family:'Instrument Serif',serif;font-size:40px;line-height:1.02;letter-spacing:-.025em;margin:0 0 8px;color:var(--ink)}
.wa-h1 .it{font-style:italic;color:var(--cyan)}
.wa-sub{font-family:'Instrument Serif',serif;font-style:italic;font-size:16px;line-height:1.5;color:var(--ink2);margin:0 0 22px;max-width:620px}
@media(max-width:768px){.wa-h1{font-size:30px}}

.wa-modes{display:grid;grid-template-columns:1fr 1fr;background:var(--glass);border:1px solid var(--hairline);border-radius:14px;padding:4px;position:relative;margin-bottom:18px;max-width:360px}
.wa-mode-ind{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:linear-gradient(135deg,var(--sky),var(--pink));border-radius:11px;transition:transform .28s cubic-bezier(.2,1.3,.4,1);z-index:1;box-shadow:0 4px 14px rgba(160,231,255,.32)}
.wa-modes.custom .wa-mode-ind{transform:translateX(100%)}
.wa-mode-t{position:relative;z-index:2;padding:10px 0;text-align:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:14.5px;color:var(--ink2);border:none;background:none;cursor:pointer;min-height:42px}
.wa-mode-t.active{color:var(--ink)}

.wa-master{display:flex;align-items:center;gap:18px;padding:18px 22px;border-radius:16px;background:var(--glass-strong);border:1px solid var(--hairline);margin-bottom:18px;flex-wrap:wrap}
.wa-master.on{background:linear-gradient(135deg,rgba(127,255,212,.10),var(--glass-strong));border-color:rgba(127,255,212,.32)}
.wa-master.paused{background:linear-gradient(135deg,rgba(255,212,107,.12),var(--glass-strong));border-color:rgba(255,212,107,.36)}
.wa-master-l{flex:1;min-width:200px}
.wa-master-h{font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-.015em;line-height:1.1;margin-bottom:4px;color:var(--ink)}
.wa-master-h .it{font-style:italic;color:var(--cyan)}
.wa-master-h.on .it{color:var(--green)}
.wa-master-s{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--ink2)}
.wa-tog{position:relative;width:64px;height:36px;border-radius:999px;background:var(--glass);border:1px solid var(--hairline);cursor:pointer;transition:.2s;flex-shrink:0}
.wa-tog::after{content:'';position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:var(--ink);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.wa-tog.on{background:linear-gradient(135deg,var(--mint),var(--green));border-color:transparent}
.wa-tog.on::after{transform:translateX(28px);background:#fff}

.wa-locked-card{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;padding:22px;margin-bottom:18px}
.wa-locked-eye{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wa-locked-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid var(--hairline)}
.wa-locked-row{padding:12px 14px 12px 0;border-bottom:1px solid var(--hairline);display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.wa-locked-row:nth-child(even){padding-left:14px;padding-right:0;border-left:1px solid var(--hairline)}
.wa-locked-k{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;color:var(--ink2);letter-spacing:.04em;text-transform:uppercase}
.wa-locked-v{font-family:'Instrument Serif',serif;font-size:18px;letter-spacing:-.01em;color:var(--ink);text-align:right;flex-shrink:0}
.wa-locked-v .u{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-locked-v.gn{color:var(--green)}
.wa-locked-v.rd{color:var(--red)}
@media(max-width:600px){.wa-locked-grid{grid-template-columns:1fr}.wa-locked-row:nth-child(even){padding-left:0;border-left:none}}

.wa-sliders{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;padding:22px;margin-bottom:18px}
.wa-slider{padding:14px 0;border-bottom:1px solid var(--hairline)}
.wa-slider:last-child{border-bottom:none}
.wa-slider-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
.wa-slider-lbl{font-family:'Instrument Serif',serif;font-size:16px;letter-spacing:-.005em;color:var(--ink)}
.wa-slider-lbl .it{font-style:italic;color:var(--cyan)}
.wa-slider-v{font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-.02em;color:var(--pink)}
.wa-slider-v .u{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-slider-desc{font-size:12.5px;line-height:1.5;color:var(--ink2);margin-bottom:10px}
.wa-slider-desc b{color:var(--ink);font-weight:700}
.wa-slider input[type=range]{width:100%;-webkit-appearance:none;background:transparent;cursor:pointer;height:32px;outline:none}
.wa-slider input[type=range]::-webkit-slider-runnable-track{height:5px;background:var(--glass);border:1px solid var(--hairline);border-radius:99px}
.wa-slider input[type=range]::-moz-range-track{height:5px;background:var(--glass);border:1px solid var(--hairline);border-radius:99px}
.wa-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:var(--pink);border:3px solid #fff;box-shadow:0 0 0 1px var(--hairline2),0 4px 10px rgba(255,143,190,.30);margin-top:-9px;cursor:grab}
.wa-slider input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--pink);border:3px solid #fff;box-shadow:0 0 0 1px var(--hairline2),0 4px 10px rgba(255,143,190,.30);cursor:grab}

.wa-floor{margin-top:14px;padding:12px 16px;border-radius:12px;background:rgba(127,255,212,.10);border:1px dashed rgba(127,255,212,.36);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.55;color:var(--ink2);font-weight:600}
.wa-floor b{color:var(--green);font-weight:800}

.wa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0 18px}
.wa-statc{padding:14px 14px 12px;background:var(--glass-strong);border:1px solid var(--hairline);border-radius:14px}
.wa-statc-l{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);margin-bottom:6px}
.wa-statc-v{font-family:'Instrument Serif',serif;font-size:24px;line-height:1;letter-spacing:-.015em;color:var(--ink)}
.wa-statc-v .u{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-statc-v.gn{color:var(--green)}
.wa-statc-v.rd{color:var(--red)}
.wa-statc-v.dim{color:var(--ink3)}
@media(max-width:600px){.wa-stats{grid-template-columns:1fr 1fr;gap:8px}.wa-statc-v{font-size:20px}}

.wa-pos-frame{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:18px}
.wa-section-head{padding:14px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--hairline);font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.wa-section-head .count{margin-left:auto;color:var(--ink2)}
.wa-pos-row{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--hairline);transition:background .15s}
.wa-pos-row:last-child{border-bottom:none}
.wa-pos-row:hover{background:rgba(160,231,255,.04)}
.wa-pos-av{flex-shrink:0;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-family:'Instrument Serif',serif;font-style:italic;font-size:13.5px;color:#fff;text-transform:uppercase;box-shadow:0 3px 10px rgba(26,27,78,.16)}
.wa-pos-nm{flex:1;min-width:0}
.wa-pos-sym{font-family:'Instrument Serif',serif;font-style:italic;font-size:15px;letter-spacing:-.005em;line-height:1.1;color:var(--ink)}
.wa-pos-time{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;color:var(--ink2);margin-top:3px}
.wa-pos-pnl{flex-shrink:0;text-align:right;min-width:90px}
.wa-pos-pnl-v{font-family:'Instrument Serif',serif;font-size:17px;letter-spacing:-.015em;line-height:1;color:var(--ink)}
.wa-pos-pnl-v.gn{color:var(--green)}
.wa-pos-pnl-v.rd{color:var(--red)}
.wa-pos-pnl-p{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;margin-top:2px;color:var(--ink2)}
.wa-pos-pnl-p.gn{color:var(--green)}
.wa-pos-pnl-p.rd{color:var(--red)}
.wa-pos-close{flex-shrink:0;min-width:38px;min-height:38px;padding:0 12px;border-radius:10px;background:var(--glass);border:1px solid var(--hairline);color:var(--ink);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.06em;cursor:pointer}
.wa-pos-close:hover{background:var(--red);color:#fff;border-color:transparent}

.wa-log-frame{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:24px}
.wa-log-list{max-height:340px;overflow-y:auto}
.wa-log-row{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--hairline);font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:600;line-height:1.4}
.wa-log-row:last-child{border-bottom:none}
.wa-log-ts{flex-shrink:0;color:var(--ink3);font-size:10.5px;width:54px}
.wa-log-tag{flex-shrink:0;font-size:9.5px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:5px;text-transform:uppercase;min-width:54px;text-align:center}
.wa-log-tag.skip{background:var(--glass);color:var(--ink3)}
.wa-log-tag.buy{background:rgba(127,255,212,.18);color:var(--green)}
.wa-log-tag.sell{background:rgba(183,148,246,.18);color:var(--lav)}
.wa-log-tag.error{background:rgba(209,75,106,.10);color:var(--red)}
.wa-log-tag.info{background:rgba(61,212,245,.10);color:var(--cyan)}
.wa-log-msg{flex:1;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.wa-kill{position:sticky;bottom:0;left:0;right:0;display:flex;gap:10px;padding:14px 28px;background:linear-gradient(180deg,transparent,rgba(251,245,255,0.95) 30%);backdrop-filter:blur(20px);border-top:1px solid var(--hairline);z-index:10;margin-top:24px}
.wa-kill-btn{flex:1;min-height:48px;padding:0 20px;border-radius:13px;border:none;cursor:pointer;font-weight:700;font-size:13.5px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .12s}
.wa-kill-btn.stop{background:linear-gradient(135deg,#FFB088,var(--red));color:#fff;box-shadow:0 6px 20px rgba(255,176,136,.32)}
.wa-kill-btn.stop:hover{transform:translateY(-1px)}
.wa-kill-btn.flat{background:var(--glass-strong);color:var(--ink);border:1px solid var(--border)}
.wa-kill-btn:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:600px){.wa-kill{padding:12px 14px;flex-direction:column}.wa-kill-btn{width:100%}}

.wa-empty{padding:36px 24px;text-align:center}
.wa-empty .gl{display:block;font-family:'Instrument Serif',serif;font-style:italic;font-size:36px;color:var(--ink3);margin-bottom:10px}
.wa-empty .h{font-family:'Instrument Serif',serif;font-size:18px;letter-spacing:-.005em;color:var(--ink);margin-bottom:4px}
.wa-empty .h .it{font-style:italic;color:var(--ink2)}
.wa-empty .s{font-size:12.5px;color:var(--ink2);max-width:340px;margin:0 auto;line-height:1.5}

.wa-pause-banner{padding:14px 18px;border-radius:14px;background:linear-gradient(135deg,rgba(255,212,107,.14),rgba(255,212,107,.04));border:1px solid rgba(255,212,107,.36);display:flex;align-items:center;gap:14px;margin-bottom:16px}
.wa-pause-banner .gl{font-size:20px;color:var(--amber);flex-shrink:0}
.wa-pause-banner .t{flex:1;min-width:0}
.wa-pause-banner .h{font-family:'Instrument Serif',serif;font-size:17px;color:var(--amber);margin-bottom:2px}
.wa-pause-banner .b{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:var(--ink2)}
.wa-pause-banner button{flex-shrink:0;min-height:36px;padding:0 16px;border-radius:9px;background:linear-gradient(135deg,var(--gold),var(--peach));color:var(--amber);border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:10.5px;letter-spacing:.08em}

@media(prefers-reduced-motion:reduce){.wa-root *,.wp-root *,.ap-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;

function useApCSS() {
  useEffect(() => {
    const id = 'ape-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = AP_CSS;
    document.head.appendChild(el);
  }, []);
}

const POLL_RECENT    = 2500;
const POLL_SOL       = 30000;
const POLL_BALANCE   = 30000;
const POLL_POSITIONS = 30000;
const HAS_TRADED_KEY = 'lr_has_traded_v1';
const SK_KEY         = 'lr_wallet_sk_v1';
const BACKED_KEY     = 'lr_wallet_backed_v1';

/* ============================================================
   BURNER WALLET
   ============================================================ */
function loadOrCreateKeypair() {
  try {
    const sk = localStorage.getItem(SK_KEY);
    if (sk) return Keypair.fromSecretKey(bs58.decode(sk));
  } catch (e) {}
  const kp = Keypair.generate();
  try { localStorage.setItem(SK_KEY, bs58.encode(kp.secretKey)); } catch (e) {}
  return kp;
}
function useLocalWallet() {
  const kpRef = useRef(null);
  if (!kpRef.current) kpRef.current = loadOrCreateKeypair();
  const keypair = kpRef.current;
  const [backedUp, setBackedUp] = useState(() => {
    try { return localStorage.getItem(BACKED_KEY) === '1'; } catch (e) { return false; }
  });
  const markBackedUp = useCallback(() => {
    try { localStorage.setItem(BACKED_KEY, '1'); } catch (e) {}
    setBackedUp(true);
  }, []);
  const exportSecret = useCallback(() => bs58.encode(keypair.secretKey), [keypair]);
  return { keypair, publicKey: keypair.publicKey, backedUp, markBackedUp, exportSecret };
}

/* ============================================================
   TOKEN ICONS
   ============================================================ */
const _iconCache = new Map(), _iconPending = new Map();
async function resolveIconFromDex(mint) {
  if (!mint) return null;
  if (_iconCache.has(mint)) return _iconCache.get(mint);
  if (_iconPending.has(mint)) return _iconPending.get(mint);
  const p = (async () => {
    try {
      const r = await fetch('/api/dex/token/' + encodeURIComponent(mint));
      if (!r.ok) { _iconCache.set(mint, null); return null; }
      const data = await r.json();
      const url = (data && data.token && data.token.icon) || null;
      _iconCache.set(mint, url || null); return url || null;
    } catch (e) { _iconCache.set(mint, null); return null; }
    finally { _iconPending.delete(mint); }
  })();
  _iconPending.set(mint, p); return p;
}
function useTokenIcon(token) {
  const directUrl = (token && token.icon) || null;
  const [resolved, setResolved] = useState(() => directUrl || (_iconCache.get(token && token.mint) || null));
  useEffect(() => {
    if (directUrl) { setResolved(directUrl); return; }
    if (!token || !token.mint) return;
    if (_iconCache.has(token.mint)) { setResolved(_iconCache.get(token.mint)); return; }
    let alive = true;
    resolveIconFromDex(token.mint).then(url => { if (alive) setResolved(url); });
    return () => { alive = false; };
  }, [token && token.mint, directUrl]);
  return resolved;
}
function TokenFace({ token, size, ageMs }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  const c = colorFor(token.mint || token.sym || '');
  const style = {
    background: 'linear-gradient(135deg,' + c + ',' + shade(c, -32) + ')',
    width: size ? size + 'px' : undefined,
    height: size ? size + 'px' : undefined,
    fontSize: size ? Math.round(size * 0.4) + 'px' : undefined,
  };
  let ageDotCls = 'age-dot';
  if (Number.isFinite(ageMs)) {
    if (ageMs < 30000) ageDotCls = 'age-dot fresh';
    else if (ageMs < 180000) ageDotCls = 'age-dot';
    else if (ageMs < 600000) ageDotCls = 'age-dot warm';
    else ageDotCls = 'age-dot old';
  }
  return (
    <div className="ap-av" style={style}>
      {url && !errored ? <img src={url} alt={token.sym || ''} onError={() => setErrored(true)} /> : <span>{(token.sym || '?').charAt(0)}</span>}
      {Number.isFinite(ageMs) && <span className={ageDotCls}>{fmtAgeShort(ageMs)}</span>}
    </div>
  );
}
function TokenChip({ token }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  return url && !errored ? <img src={url} alt="" onError={() => setErrored(true)} /> : <span>{(token.sym || '?').charAt(0)}</span>;
}

const IconX  = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>);
const IconTg = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>);
const IconDs = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>);
const CHART_TFS = ['5m', '1H', '6H', '24H'];
const FRESH_FLOOR_MS = 5 * 60 * 1000;

function TokenChart({ token }) {
  const [tf, setTf] = useState('5m');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const ageMs = token && token.pairCreatedAtMs ? Date.now() - token.pairCreatedAtMs : null;
  const tooFresh = ageMs != null && ageMs < FRESH_FLOOR_MS;
  useEffect(() => {
    if (!token || !token.mint) return;
    if (tooFresh) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch('/api/dex/chart/' + encodeURIComponent(token.mint) + '?tf=' + encodeURIComponent(tf))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token && token.mint, tf, tooFresh]);

  const points = (data && Array.isArray(data.points)) ? data.points.filter(p => p && Number.isFinite(p.price)) : [];
  const hasChart = points.length >= 2;
  if (tooFresh || (!loading && !hasChart)) {
    return (
      <div className="ap-chart-wrap">
        <div className="ap-chart-empty"><div className="em-h">Too fresh to chart <i>yet</i></div><div className="em-s">Check back in a few minutes</div></div>
        <div className="ap-tf-pills">
          {CHART_TFS.map(t => (<button key={t} className={'ap-tf' + (t === tf ? ' on' : '')} disabled>{t}</button>))}
          <span className="ap-tf-meta">{ageMs != null ? fmtAgeShort(ageMs) + ' old' : '—'}</span>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="ap-chart-wrap">
        <div className="ap-chart-loading"><span className="sp" /></div>
        <div className="ap-tf-pills">
          {CHART_TFS.map(t => (<button key={t} className={'ap-tf' + (t === tf ? ' on' : '')} onClick={() => setTf(t)}>{t}</button>))}
          <span className="ap-tf-meta">Loading…</span>
        </div>
      </div>
    );
  }
  const first = points[0].price, last = points[points.length - 1].price;
  const isUp = last >= first;
  const color = isUp ? '#0a7a4c' : '#D14B6A';
  const tfClass = isUp ? ' on up' : ' on dn';
  const minP = Math.min.apply(null, points.map(p => p.price));
  const maxP = Math.max.apply(null, points.map(p => p.price));
  const range = (maxP - minP) || (maxP * 0.001) || 1;
  const W = 320, H = 84, pad = 6;
  const xStep = W / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => [i * xStep, H - pad - ((p.price - minP) / range) * (H - 2 * pad)]);
  const linePath = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const fillPath = linePath + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';
  const gradId = 'ap-cg-' + (token.mint || 'x').slice(0, 8);
  return (
    <div className="ap-chart-wrap">
      <div className="ap-chart">
        <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
          <defs><linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
          <path d={fillPath} fill={'url(#' + gradId + ')'} />
          <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="ap-tf-pills">
        {CHART_TFS.map(t => (<button key={t} className={'ap-tf' + (t === tf ? tfClass : '')} onClick={() => setTf(t)}>{t}</button>))}
        <span className="ap-tf-meta">Dexscreener</span>
      </div>
    </div>
  );
}

function MiniSparkline({ change }) {
  const up = (change || 0) >= 0;
  const color = up ? '#0a7a4c' : '#D14B6A';
  const seed = Math.abs(change || 0);
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const trend = up ? (8 + (1 - t) * 18) : (24 - (1 - t) * 18);
    const wiggle = Math.sin(i * 1.7 + seed) * 2.2 + Math.cos(i * 0.9) * 1.6;
    pts.push([i * 7.6, Math.max(2, Math.min(30, trend + wiggle))]);
  }
  const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const fill = line + ' L 76,32 L 0,32 Z';
  const gradId = 'sp-' + (up ? 'u' : 'd') + Math.round(seed * 10);
  return (
    <div className="ap-spark">
      <svg viewBox="0 0 76 32" preserveAspectRatio="none">
        <defs><linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={up ? '.28' : '.22'} /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={fill} fill={'url(#' + gradId + ')'} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function usePresets() {
  const readStored = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key); if (!raw) return fallback;
      const arr = JSON.parse(raw); if (!Array.isArray(arr) || arr.length === 0) return fallback;
      const cleaned = arr.map(Number).filter(v => Number.isFinite(v) && v > 0);
      return cleaned.length > 0 ? cleaned : fallback;
    } catch (e) { return fallback; }
  };
  const [buyPresets, setBuyPresets] = useState(() => readStored('lr_buy_presets', DEFAULT_BUY_PRESETS));
  const [sellPresets, setSellPresets] = useState(() => readStored('lr_sell_presets', DEFAULT_SELL_PRESETS));
  useEffect(() => { try { localStorage.setItem('lr_buy_presets', JSON.stringify(buyPresets)); } catch (e) {} }, [buyPresets]);
  useEffect(() => { try { localStorage.setItem('lr_sell_presets', JSON.stringify(sellPresets)); } catch (e) {} }, [sellPresets]);
  return { buyPresets, setBuyPresets, sellPresets, setSellPresets };
}

// OPEN POSITIONS STRIP — flash-bug fix (sequential fetch + diff)
function OpenPositionsStrip({ walletStr, solPrice, onOpenStats }) {
  const [positions, setPositions] = useState([]);
  const [prices, setPrices] = useState({});
  useEffect(() => {
    if (!walletStr) return;
    let cancelled = false;
    const sigOf = (p) => p.mint + ':' + (p.open_tokens || 0) + ':' + (p.sol_in || 0) + ':' + (p.sol_out || 0);
    const load = async () => {
      try {
        const r = await fetch('/api/ref/pnl?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const open = (d.positions || []).filter(p => p.open && p.open_tokens > 0);
        setPositions(prev => {
          if (prev.length !== open.length) return open;
          for (let i = 0; i < prev.length; i++) if (sigOf(prev[i]) !== sigOf(open[i])) return open;
          return prev;
        });
        for (const p of open) {
          if (cancelled) return;
          try {
            const pr = await fetch('/api/dex/token/' + encodeURIComponent(p.mint));
            if (!pr.ok) continue;
            const pd = await pr.json();
            const px = Number(pd?.token?.price);
            if (!Number.isFinite(px) || px <= 0) continue;
            if (cancelled) return;
            setPrices(prev => Math.abs((prev[p.mint] || 0) - px) < 1e-12 ? prev : { ...prev, [p.mint]: px });
          } catch (e) {}
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (e) {}
    };
    load();
    const id = setInterval(load, POLL_POSITIONS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr]);
  const enriched = useMemo(() => {
    if (!solPrice) return [];
    return positions.map(p => {
      const px = prices[p.mint] || 0;
      const currentValueSol = (p.open_tokens * px) / solPrice;
      const costBasisSol = Math.max(0, (p.sol_in || 0) - (p.sol_out || 0));
      const unrealizedSol = currentValueSol - costBasisSol;
      const unrealizedPct = costBasisSol > 0 ? (unrealizedSol / costBasisSol) * 100 : 0;
      return { ...p, unrealizedSol, unrealizedPct, hasPrice: px > 0 };
    }).sort((a, b) => Math.abs(b.unrealizedSol) - Math.abs(a.unrealizedSol));
  }, [positions, prices, solPrice]);
  if (enriched.length === 0) return null;
  const total = enriched.reduce((s, p) => s + p.unrealizedSol, 0);
  return (
    <div className="ap-positions">
      <div className="ap-positions-head">
        <span className="e">◉ Your open trades · {enriched.length}</span>
        <span className="roll">Unrealized <b className={total < 0 ? 'dn' : ''}>{formatSolSigned(total)} SOL</b></span>
      </div>
      {enriched.slice(0, 3).map(p => {
        const c = colorFor(p.mint);
        const up = p.unrealizedSol > 0.0001, dn = p.unrealizedSol < -0.0001;
        return (
          <div className="ap-pos-strip-row" key={p.mint}>
            <div className="ap-pos-strip-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
            <div className="ap-pos-strip-sym">${p.sym || '???'}</div>
            <div className={'ap-pos-strip-pnl' + (up ? '' : dn ? ' dn' : ' dim')}>{p.hasPrice ? formatSolSigned(p.unrealizedSol) : '—'}</div>
            <div className={'ap-pos-strip-pct ' + (up ? 'up' : dn ? 'dn' : '')}>{p.hasPrice ? (p.unrealizedPct >= 0 ? '+' : '') + p.unrealizedPct.toFixed(1) + '%' : '…'}</div>
          </div>
        );
      })}
      <button className="ap-positions-foot" onClick={onOpenStats}>See your full trade log →</button>
    </div>
  );
}

const SpecimenRow = React.memo(function SpecimenRow({ token, ageMsLive, owned, costBasis, solPrice, quickAmount, busy, onApe, onSell, onOpen, isFresh, ownedMode }) {
  const r = riskRead(token);
  const ownedUi = (owned && owned.uiAmount) || 0;
  const ownedUsd = ownedUi * (token.price || 0);
  // Live P&L from real cost basis (sol_in - sol_out), same math as the open-
  // positions strip. Only shown when we have a logged basis and a SOL price.
  let pnl = null;
  if (costBasis && solPrice > 0 && (token.price || 0) > 0) {
    const costSol = Math.max(0, (costBasis.sol_in || 0) - (costBasis.sol_out || 0));
    if (costSol > 0) {
      const curValSol = (ownedUi * token.price) / solPrice;
      const gainSol = curValSol - costSol;
      pnl = { gainSol, pct: (gainSol / costSol) * 100, up: gainSol > 0.0001, dn: gainSol < -0.0001 };
    }
  }
  const ape = (e) => { e.stopPropagation(); if (busy) return; onApe(token); };
  const sell = (e) => { e.stopPropagation(); if (busy) return; onSell(token); };
  return (
    <div className={'ap-row' + (isFresh ? ' fresh' : '')} onClick={()=>onOpen(token)}>
      <div className="ap-row-tk">
        <TokenFace token={token} ageMs={ageMsLive} />
        <div className="ap-name">
          <div className="ap-sym-row">
            ${token.sym}
            {Number.isFinite(token.change) && token.change !== 0 ? <span className={'chg' + (token.change < 0 ? ' dn' : '')}>{formatPct(token.change)}</span> : null}
            {(ownedUi > 0 && !ownedMode) ? <span className="ap-owned-mark">owned</span> : null}
          </div>
          <div className="ap-name-line">
            <span className="price">{formatPrice(token.price)}</span><span className="dot">·</span>
            <span className="mcap">{formatMoney(token.mcap)} mcap</span><span className="dot">·</span>
            <span className="ghost">{formatMoney(token.liquidity)} liq · {format(token.holders)} holders</span>
            {ownedMode ? <><span className="dot">·</span><span className="ownedusd">{formatTokens(ownedUi)} · {formatUsdAbs(ownedUsd)}</span></> : null}
          </div>
        </div>
      </div>
      <MiniSparkline change={token.change} />
      <span className={'ap-pill ' + r.tier}><span className="d" />{r.tier === 'low' ? 'low' : r.tier === 'med' ? 'medium' : 'high risk'}</span>
      {(ownedMode && pnl) ? (
        <div className={'ap-row-pnl' + (pnl.up ? ' up' : pnl.dn ? ' dn' : '')}>
          <span className="pct">{(pnl.pct >= 0 ? '+' : '') + pnl.pct.toFixed(1)}%</span>
          <span className="sol">{formatSolSigned(pnl.gainSol)} SOL</span>
        </div>
      ) : null}
      <div className="ap-row-action">
        {ownedMode ? (
          <>
            <button className="ap-btn-buy compact" disabled={busy} onClick={ape}>{busy ? <span className="ap-spinner" /> : 'Buy'}</button>
            <button className="ap-btn-sell" disabled={busy} onClick={sell}>Sell</button>
          </>
        ) : (
          <button className="ap-btn-buy" disabled={busy} onClick={ape}>{busy ? <><span className="ap-spinner" /> Buying</> : <>Buy {quickAmount} <span className="arrow">→</span></>}</button>
        )}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.token.mint === next.token.mint
  && prev.token.price === next.token.price
  && prev.token.mcap === next.token.mcap
  && prev.token.liquidity === next.token.liquidity
  && prev.token.change === next.token.change
  && prev.token.holders === next.token.holders
  && Math.floor(prev.ageMsLive / 5000) === Math.floor(next.ageMsLive / 5000)
  && ((prev.owned && prev.owned.amount) || null) === ((next.owned && next.owned.amount) || null)
  && prev.busy === next.busy
  && prev.solPrice === next.solPrice
  && ((prev.costBasis && prev.costBasis.sol_in) || 0) === ((next.costBasis && next.costBasis.sol_in) || 0)
  && ((prev.costBasis && prev.costBasis.sol_out) || 0) === ((next.costBasis && next.costBasis.sol_out) || 0)
  && prev.quickAmount === next.quickAmount
  && prev.ownedMode === next.ownedMode
  && prev.isFresh === next.isFresh
));

/* ============================================================
   PRESETS MODAL · FILTERS MODAL · WALLET DRAWER
   ============================================================ */
function PresetsModal({ buyPresets, setBuyPresets, sellPresets, setSellPresets, onClose }) {
  const [buyDraft, setBuyDraft] = useState(buyPresets);
  const [sellDraft, setSellDraft] = useState(sellPresets);
  const [nb, setNb] = useState(''); const [ns, setNs] = useState('');
  const addBuy  = () => { const v = parseFloat(nb); if (!(v > 0) || buyDraft.includes(v))  { setNb(''); return; } setBuyDraft([...buyDraft, v].sort((a,b)=>a-b));  setNb(''); };
  const addSell = () => { const v = parseFloat(ns); if (!(v > 0) || v > 100 || sellDraft.includes(v)) { setNs(''); return; } setSellDraft([...sellDraft, v].sort((a,b)=>a-b)); setNs(''); };
  const save = () => { setBuyPresets(buyDraft.length ? buyDraft : DEFAULT_BUY_PRESETS); setSellPresets(sellDraft.length ? sellDraft : DEFAULT_SELL_PRESETS); onClose(); };
  return (
    <div className="ap-overlay center" onClick={onClose}>
      <div className="ap-sheet mini" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Instrument Serif',serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#1A1B4E'}}>Quick <em style={{fontStyle:'italic',color:'#3DD4F5'}}>amounts</em></h3>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10.5,color:'rgba(26,27,78,0.7)',marginTop:5,fontWeight:600}}>Tap to set · edit any time</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="ap-sec-lbl">Buy amounts (SOL)</div>
          <div className="ap-echips">
            {buyDraft.map(v => <span key={v} className="ap-echip">{v}<button className="x" onClick={()=>setBuyDraft(buyDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="ap-eadd"><input type="number" step="0.01" min="0" placeholder="0.5" value={nb} onChange={e=>setNb(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addBuy();}} /><button className="plus" onClick={addBuy}>+</button></span>
          </div>
          <div className="ap-sec-lbl">Sell amounts (%)</div>
          <div className="ap-echips">
            {sellDraft.map(v => <span key={v} className="ap-echip">{v}%<button className="x" onClick={()=>setSellDraft(sellDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="ap-eadd"><input type="number" step="1" min="1" max="100" placeholder="50" value={ns} onChange={e=>setNs(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addSell();}} /><button className="plus" onClick={addSell}>+</button></span>
          </div>
          <button className="ap-esave" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function FiltersModal({ wildOnly, setWildOnly, minLiq, setMinLiq, onClose }) {
  const liqOptions = [0, 5000, 20000, 50000];
  return (
    <div className="ap-overlay center" onClick={onClose}>
      <div className="ap-sheet mini" onClick={e => e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Instrument Serif',serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#1A1B4E'}}>Filters</h3>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10.5,color:'rgba(26,27,78,0.7)',marginTop:5,fontWeight:600}}>Narrow the feed</div>
        </div>
        <div style={{padding:'8px 22px 22px'}}>
          <div className="ap-filter-row">
            <div><div className="lbl">High risk only</div><div className="lbl-sub">Show only the high-risk picks</div></div>
            <div className={'ap-toggle' + (wildOnly ? ' on' : '')} onClick={() => setWildOnly(!wildOnly)} />
          </div>
          <div className="ap-filter-row" style={{flexDirection:'column',alignItems:'stretch'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:12}}>
              <div className="lbl">Minimum liquidity</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:700,color:'rgba(26,27,78,0.7)'}}>{minLiq ? '$' + format(minLiq) : 'any'}</div>
            </div>
            <div className="lbl-sub" style={{marginBottom:6}}>Filter out thin pools</div>
            <div className="ap-liq-chips">
              {liqOptions.map(v => (<button key={v} className={'ap-liq-chip' + (minLiq === v ? ' on' : '')} onClick={() => setMinLiq(v)}>{v === 0 ? 'Any' : '$' + (v >= 1000 ? (v/1000) + 'K' : v)}</button>))}
            </div>
          </div>
          <button className="ap-esave" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function WalletDrawer({ wallet, solBalance, solPrice, onWithdraw, onClose, busy, balances, resolveToken }) {
  const [tab, setTab] = useState('deposit');
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState(''); const [amt, setAmt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const qrRef = useRef(null);
  const addr = wallet.publicKey.toBase58();
  const sol = (solBalance && solBalance.uiAmount) || 0;
  const ownedList = useMemo(() => {
    if (!balances) return [];
    return Object.keys(balances)
      .filter(m => m !== SOL_MINT && (balances[m].uiAmount || 0) > 0)
      .map(m => {
        const tk = resolveToken ? resolveToken(m) : { mint: m, sym: '???', name: 'Unknown', price: 0 };
        const ui = balances[m].uiAmount || 0;
        return { tk, ui, usd: ui * (tk.price || 0) };
      })
      .sort((a, b) => b.usd - a.usd);
  }, [balances, resolveToken]);
  useEffect(() => {
    if (tab !== 'deposit' || !qrRef.current) return;
    let alive = true;
    (async () => {
      try { const QR = await import('qrcode'); if (!alive || !qrRef.current) return; const toCanvas = QR.toCanvas || (QR.default && QR.default.toCanvas); if (typeof toCanvas === 'function') await toCanvas(qrRef.current, addr, { width: 160, margin: 1, color: { dark: '#1A1B4E', light: '#ffffff' } }); } catch (e) {}
    })();
    return () => { alive = false; };
  }, [tab, addr]);
  const copy = () => { try { navigator.clipboard.writeText(addr); setCopied(true); setTimeout(()=>setCopied(false), 1500); } catch (e) {} };
  const maxOut = Math.max(0, sol - 0.001);
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-sheet" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Instrument Serif',serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#1A1B4E',display:'flex',alignItems:'center',gap:10}}><span style={{width:8,height:8,borderRadius:'50%',background:'#0a7a4c',boxShadow:'0 0 8px #0a7a4c'}} />Your <em style={{fontStyle:'italic',color:'#3DD4F5'}}>wallet</em></h3>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10.5,color:'rgba(26,27,78,0.7)',marginTop:5,fontWeight:600}}>lives on this device · signs instantly · your keys</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="ap-balcard">
            <div className="ap-ballbl">Ready to trade</div>
            <div className="ap-balval">{formatSol(sol)} <span className="u">SOL</span></div>
            <div className="ap-balusd">{solPrice > 0 ? '≈ $' + format(sol * solPrice) : ' '}</div>
          </div>
          {ownedList.length > 0 && (
            <div className="ap-block">
              <div className="ap-block-l">Your tokens · {ownedList.length}</div>
              {ownedList.map(({ tk, ui, usd }) => (
                <div className="ap-wtoken" key={tk.mint}>
                  <TokenFace token={tk} size={32} />
                  <div className="ap-wtoken-nm"><div className="ap-wtoken-sym">${tk.sym}</div><div className="ap-wtoken-amt">{formatTokens(ui)}{tk.name && tk.name !== tk.sym ? ' · ' + tk.name : ''}</div></div>
                  <div className="ap-wtoken-usd">{tk.price > 0 ? formatUsdAbs(usd) : '—'}</div>
                </div>
              ))}
            </div>
          )}
          <div className="ap-wgrid">
            <button className={'ap-wact' + (tab==='deposit'?' primary':'')} onClick={()=>setTab('deposit')}>↓ Deposit</button>
            <button className={'ap-wact' + (tab==='withdraw'?' primary':'')} onClick={()=>setTab('withdraw')}>↑ Withdraw</button>
          </div>
          {tab === 'deposit' && (
            <div className="ap-block">
              <div className="ap-block-l">Send SOL to this address</div>
              <div className="ap-qr"><canvas ref={qrRef} width="160" height="160" /></div>
              <div className="ap-addr"><div className="ap-addr-v">{addr}</div><button className="ap-copy" onClick={copy}>{copied?'COPIED':'COPY'}</button></div>
            </div>
          )}
          {tab === 'withdraw' && (
            <div className="ap-block">
              <div className="ap-block-l">Send SOL out</div>
              <input className="ap-input" placeholder="Destination address" value={dest} onChange={e=>setDest(e.target.value.trim())} />
              <input className="ap-input" type="number" step="0.001" placeholder={'Amount (max ' + formatSol(maxOut) + ')'} value={amt} onChange={e=>setAmt(e.target.value)} />
              <button className="ap-go" disabled={busy || !dest || !(Number(amt) > 0) || Number(amt) > maxOut} onClick={()=>onWithdraw(dest, Number(amt))}>{busy ? 'Sending…' : 'Withdraw ' + (Number(amt) > 0 ? Number(amt) + ' SOL' : '')}</button>
            </div>
          )}
          <div className="ap-block">
            <div className="ap-block-l">Back up your wallet {wallet.backedUp ? '✓' : ''}</div>
            {!revealed ? (
              <button className="ap-go" style={{background:'rgba(255,255,255,0.65)',color:'#7a5400',boxShadow:'none',border:'1px solid rgba(255,212,107,.40)'}} onClick={()=>{ setRevealed(true); wallet.markBackedUp(); }}>Show secret key</button>
            ) : (
              <>
                <div className="ap-secret">{wallet.exportSecret()}</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button className="ap-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>{ try{navigator.clipboard.writeText(wallet.exportSecret());}catch(e){} }}>COPY KEY</button>
                  <button className="ap-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>setRevealed(false)}>HIDE</button>
                </div>
              </>
            )}
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:'rgba(26,27,78,0.45)',marginTop:8,fontWeight:600,lineHeight:1.5}}>Save this somewhere safe. Anyone with it controls this wallet. Import into Phantom ("Import private key") to recover.</div>
          </div>
          <div className="ap-warn"><b>Hot burner.</b> Keep only trade-money here. The key is stored on this device — clear your browser and it's gone unless you backed it up.</div>
          <div style={{textAlign:'center'}}><span className="ap-nc">● Non-custodial · your keys</span></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TRADE SHEET — "Safety read" / readable risk verdicts
   ============================================================ */
function TradeSheet({ token, initialMode, onClose, onConfirm, buyPresets, sellPresets, solBalance, tokenBalance, solPrice }) {
  const [mode, setMode] = useState(initialMode || 'buy');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setAmount(''); setError(null); }, [mode]);
  useEffect(() => { setError(null); }, [amount]);
  const isBuy = mode === 'buy';
  const presets = isBuy ? buyPresets : sellPresets;
  const ownedUi = (tokenBalance && tokenBalance.uiAmount) || 0;
  const availSol = Math.max(0, ((solBalance && solBalance.uiAmount) || 0) - SOL_RESERVE);
  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount); if (!Number.isFinite(n) || n <= 0) return null;
    return isBuy ? buildBuyParams(n) : buildSellParams(token, n, tokenBalance, solPrice);
  }, [amount, isBuy, token, tokenBalance, solPrice]);
  const est = useMemo(() => {
    if (!swapParams || !(token && token.price > 0) || !(solPrice > 0)) return null;
    if (swapParams.mode === 'buy') { const tradeSol = Number(swapParams.tradeLamports)/1e9; const tokens = (tradeSol*solPrice)/token.price; return tokens>0?{tokens}:null; }
    const grossSol = (swapParams.tradeTokensUi * token.price)/solPrice; const netSol = grossSol*(1-FEE_BPS/10000); return netSol>0?{sol:netSol}:null;
  }, [swapParams, token && token.price, solPrice]);
  const BUY_MIN_SOL = 0.03;
  const belowBuyMin = isBuy && amount && Number(amount) > 0 && Number(amount) < BUY_MIN_SOL;
  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return Number(amount) >= BUY_MIN_SOL && Number(amount) <= availSol;
    return ownedUi > 0 && ((solBalance && solBalance.uiAmount) || 0) >= 0.003;
  })();
  const disabled = confirming || !swapParams || !hasFunds || !!error;
  const go = async () => {
    if (!swapParams || confirming) return;
    setConfirming(true); setError(null);
    try { await onConfirm({ mode, swapParams, token }); }
    catch (e) { setError(friendlyError(e)); setConfirming(false); }
  };
  const read = riskRead(token);
  const tierClass = read.tier === 'low' ? '' : read.tier === 'med' ? 'amber' : 'red';
  const verdict = read.label === 'Steady' ? 'Looks low risk — still be careful'
              : read.label === 'Mixed'  ? 'Mixed signals'
              : 'High risk · be careful';
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-sheet" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <div className="ap-tshead-row">
            <TokenFace token={token} size={56} />
            <div className="title">
              <div className="sym">${token.sym}</div>
              <div className="sub">{formatPrice(token.price)}{Number.isFinite(token.change) && token.change !== 0 ? <> · <span style={{color:token.change<0?'#D14B6A':'#0a7a4c'}}>{formatPct(token.change)}</span></> : null}</div>
            </div>
          </div>
        </div>
        <TokenChart token={token} />
        <div className={'ap-safety ' + tierClass}>
          <div className="ap-safety-top">
            <span className="ap-safety-l">Safety read</span>
            <span className={'ap-safety-s ' + tierClass}>{read.score}<span className="of">/{RISK_CEIL}</span></span>
          </div>
          <div className={'ap-safety-verdict ' + tierClass}>{verdict}</div>
          <div className="ap-safety-chks">{read.knowns.map((c,i)=><span key={i} className={'ap-chk '+c[0]}>{c[1]}</span>)}</div>
        </div>
        <div className="ap-dyor">Can't be checked: {read.unknowns.join(' · ')}. Even a clean read can rug — only trade what you can lose.</div>
        <div className={'ap-mode-tabs' + (isBuy?'':' sell')}>
          <div className="ap-mode-ind" />
          <button className={'ap-mode-tab'+(isBuy?' active':'')} onClick={()=>setMode('buy')}>Buy</button>
          <button className={'ap-mode-tab'+(!isBuy?' active':'')} onClick={()=>setMode('sell')}>Sell</button>
        </div>
        <div className="ap-field">
          <div className="ap-field-row1">
            <span className="ap-field-l">{isBuy?'You pay':'You sell'}</span>
            <span className="ap-field-bal">
              {isBuy ? <>Wallet: <b>{formatSol((solBalance&&solBalance.uiAmount)||0)} SOL</b></> : <>You own: <b>{formatTokens(ownedUi)} ${token.sym}</b></>}
              {isBuy && availSol > 0 ? <button className="ap-field-max" onClick={()=>setAmount(String(Math.floor(availSol*10000)/10000))}>MAX</button> : null}
            </span>
          </div>
          <div className="ap-field-row2">
            <div className="ap-field-chip">{isBuy ? <><span className="lg">◎</span><span>SOL</span></> : <><span className="lg"><TokenChip token={token} /></span><span>{token.sym}</span></>}</div>
            <input className="ap-field-amt" type="text" inputMode="decimal" placeholder={isBuy?'0.00':'0'} value={amount} onChange={e=>{ const val=e.target.value.replace(/[^\d.]/g,''); if(val.split('.').length>2)return; if(!isBuy&&Number(val)>100){setAmount('100');return;} setAmount(val); }} />
          </div>
        </div>
        <div className="ap-presets">
          {presets.map(pv => <button key={pv} className={'ap-preset'+(Number(amount)===pv?(isBuy?' on':' on sell'):'')} onClick={()=>setAmount(String(pv))}>{isBuy?(pv+' SOL'):(pv+'%')}</button>)}
        </div>
        {swapParams && Number(amount) > 0 && (
          <div className="ap-summary">
            <div className="ap-sum"><span className="k">Route</span><span className="v">{token.dex || 'pump.fun'}</span></div>
            {isBuy ? <>
              <div className="ap-sum"><span className="k">Platform fee (3%)</span><span className="v">{formatSol(Number(swapParams.feeLamports)/1e9)} SOL</span></div>
              <div className="ap-sum"><span className="k">Wallet pays</span><span className="v">{formatSol(Number(swapParams.totalLamports)/1e9)} SOL</span></div>
              <div className="ap-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.tokens>0?'≈ '+formatTokens(est.tokens)+' '+token.sym:'—'}</span></div>
            </> : <>
              <div className="ap-sum"><span className="k">Selling</span><span className="v">{formatTokens(swapParams.tradeTokensUi)} {token.sym} ({Math.min(100,Number(amount)).toFixed(0)}%)</span></div>
              <div className="ap-sum"><span className="k">Platform fee (3%)</span><span className="v">≈ {Number(swapParams.feeLamports)/1e9>0?formatSol(Number(swapParams.feeLamports)/1e9):'—'} SOL</span></div>
              <div className="ap-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.sol>0?'≈ '+formatSol(est.sol)+' SOL':'—'}</span></div>
            </>}
          </div>
        )}
        {error && <div className="ap-banner">{error}</div>}
        <button className={'ap-confirm'+(isBuy?'':' sell')} disabled={disabled} onClick={go}>
          {confirming ? (isBuy?'Buying…':'Selling…') : !amount||Number(amount)<=0 ? (isBuy?'Enter SOL amount':'Enter percentage') : belowBuyMin ? ('Minimum 0.03 SOL') : !hasFunds ? (isBuy?'Not enough SOL':(ownedUi<=0?('No '+token.sym+' to sell'):'Need ~0.003 SOL for fees')) : (isBuy?('Buy '+amount+' SOL → '+token.sym):('Sell '+Math.min(100,Number(amount))+'% of '+token.sym))}
        </button>
        <p className="ap-tfoot">{token.dex || 'pump.fun'} · 3% fee · settles in seconds</p>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN APE PAGE
   ============================================================ */
export default function Ape({ mainWalletPubkey }) {
  useApCSS();
  const wallet = useLocalWallet();
  const walletStr = wallet.publicKey.toBase58();
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();

  const [recent, setRecent] = useState([]);
  const [feedError, setFeedError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('feed');
  const [activeQuickIdx, setActiveQuickIdx] = useState(0);
  const [wildOnly, setWildOnly] = useState(false);
  const [minLiq, setMinLiq] = useState(0);

  const [solBalance, setSolBalance] = useState(null);
  const [solPrice, setSolPrice] = useState(0);
  const [balances, setBalances] = useState({});
  const [tokenIndex, setTokenIndex] = useState({});
  // Per-mint cost basis (sol_in / sol_out) from the server trade log, used to
  // show live P&L on each owned row. Keyed by mint. Refreshed on the same
  // cadence as positions. Only mints traded through the app appear here.
  const [pnlBasis, setPnlBasis] = useState({});
  useEffect(() => {
    if (!walletStr) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/ref/pnl?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const map = {};
        for (const p of (d.positions || [])) {
          if (!p || !p.mint) continue;
          map[p.mint] = { sol_in: Number(p.sol_in) || 0, sol_out: Number(p.sol_out) || 0, open_tokens: Number(p.open_tokens) || 0 };
        }
        setPnlBasis(prev => {
          const keys = Object.keys(map);
          if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] && prev[k].sol_in === map[k].sol_in && prev[k].sol_out === map[k].sol_out && prev[k].open_tokens === map[k].open_tokens)) return prev;
          return map;
        });
      } catch (e) {}
    };
    load();
    const id = setInterval(load, POLL_POSITIONS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr]);

  // FIX 2: tokenMeta for owned tokens not in the live feed, plus tradeConnection
  const [tokenMeta, setTokenMeta] = useState({});
  const tradeConnection = useMemo(() => getTradeConn('confirmed'), []);
  const metaPendingRef = useRef(new Set());

  const [tradeToken, setTradeToken] = useState(null);
  const [tradeMode, setTradeMode] = useState('buy');
  const [showPresets, setShowPresets] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsTab, setStatsTab] = useState('referrals');
  const [showAuto, setShowAuto] = useState(false);
  const [showLure, setShowLure] = useState(() => { try { return localStorage.getItem(HAS_TRADED_KEY) !== '1'; } catch (e) { return true; } });

  const [busyMints, setBusyMints] = useState({});
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confettiAt, setConfettiAt] = useState(0);
  const lastFreshMintRef = useRef(null);

  const quickAmount = buyPresets[activeQuickIdx] || buyPresets[0] || 0.5;

  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration || 6500);
  }, []);

  // Referral registration is keyed on the MAIN wallet (the durable identity),
  // not the burner. The burner only signs trades and never enters the referral
  // graph, so attribution survives a browser/burner reset. The referrer comes
  // from ?ref= on the URL (a main wallet, set by an invite link). Guard against
  // self-referral via either the main wallet or the burner.
  useEffect(() => {
    if (!mainWalletPubkey) return;
    let referrer = null;
    try {
      const r = new URLSearchParams(window.location.search).get('ref');
      if (r && r !== mainWalletPubkey && r !== walletStr) referrer = r;
    } catch (e) {}
    refRegister(mainWalletPubkey, referrer);
  }, [mainWalletPubkey, walletStr]);

  // Feed
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (cancelled) return;
        const list = Array.isArray(d?.tokens) ? d.tokens.map(normalize) : [];
        setRecent(list);
        setTokenIndex(prev => { const next = { ...prev }; for (const t of list) if (t && t.mint) next[t.mint] = t; return next; });
        setFeedError(null);
      } catch (e) { if (!cancelled) setFeedError(String(e.message || 'Network').slice(0, 100)); }
    };
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);

  // FIX 3: balRpcRace called with a function (its real signature)
  const refreshSol = useCallback(async () => {
    try {
      const lamps = await balRpcRace(conn => conn.getBalance(wallet.publicKey, BAL_COMMITMENT));
      setSolBalance(prev => { const ui = Number(lamps) / 1e9; if (prev && Math.abs(prev.uiAmount - ui) < 1e-9) return prev; return { lamports: lamps, uiAmount: ui }; });
    } catch (e) {}
    try {
      const r = await fetch('/api/dex/sol-price');
      if (r.ok) { const d = await r.json(); if (Number.isFinite(d?.price)) setSolPrice(p => Math.abs(p - d.price) < 0.01 ? p : d.price); }
    } catch (e) {}
  }, [wallet.publicKey]);
  useEffect(() => { refreshSol(); const id = setInterval(refreshSol, POLL_SOL); return () => clearInterval(id); }, [refreshSol]);

  // Balances — diffed before set
  const refreshBalances = useCallback(async () => {
    try {
      const conn = getConn();
      const owner = new PublicKey(walletStr);
      const [tk, tk22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT),
      ]);
      const next = {};
      for (const acc of [...tk.value, ...tk22.value]) {
        const info = acc.account.data.parsed.info;
        const mint = info.mint;
        const amount = info.tokenAmount.amount;
        const uiAmount = Number(info.tokenAmount.uiAmount) || 0;
        const decimals = Number(info.tokenAmount.decimals);
        if (uiAmount > 0) next[mint] = { amount, uiAmount, decimals: Number.isFinite(decimals) ? decimals : 6 };
      }
      setBalances(prev => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) return next;
        for (const k of nextKeys) { if (!prev[k]) return next; if (prev[k].amount !== next[k].amount) return next; }
        return prev;
      });
    } catch (e) {}
  }, [walletStr]);
  useEffect(() => { refreshBalances(); const id = setInterval(refreshBalances, POLL_BALANCE); return () => clearInterval(id); }, [refreshBalances]);

  const refreshOneToken = useCallback(async (mint) => {
    try {
      const conn = getConn();
      const owner = new PublicKey(walletStr);
      const [tk, tk22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID, mint: new PublicKey(mint) }, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID, mint: new PublicKey(mint) }, BAL_COMMITMENT),
      ]);
      let amount = '0', uiAmount = 0, decimals = 6;
      for (const acc of [...tk.value, ...tk22.value]) {
        const info = acc.account.data.parsed.info;
        amount = info.tokenAmount.amount;
        uiAmount = Number(info.tokenAmount.uiAmount) || 0;
        const d = Number(info.tokenAmount.decimals);
        if (Number.isFinite(d)) decimals = d;
      }
      setBalances(prev => {
        const cur = prev[mint];
        if (uiAmount === 0) { if (!cur) return prev; const next = { ...prev }; delete next[mint]; return next; }
        if (cur && cur.amount === amount) return prev;
        return { ...prev, [mint]: { amount, uiAmount, decimals } };
      });
    } catch (e) {}
  }, [walletStr]);

  // FIX 4: fetchTokenMeta + resolveToken that includes owned-token metadata
  const fetchTokenMeta = useCallback((mint) => {
    if (!mint || mint === SOL_MINT) return;
    if (tokenIndex[mint] || tokenMeta[mint] || metaPendingRef.current.has(mint)) return;
    metaPendingRef.current.add(mint);
    fetch('/api/dex/token/' + encodeURIComponent(mint))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const t = d && d.token;
        if (!t) return;
        setTokenMeta(prev => (prev[mint] ? prev : {
          ...prev,
          [mint]: { mint, sym: t.sym || '???', name: t.name || t.sym || 'Unknown', icon: t.icon || null, price: Number(t.price || 0) },
        }));
      })
      .catch(() => {})
      .finally(() => { metaPendingRef.current.delete(mint); });
  }, [tokenIndex, tokenMeta]);

  const resolveToken = useCallback(
    (mint) => tokenIndex[mint] || tokenMeta[mint] || { mint, sym: '???', name: 'Unknown', price: 0, icon: null },
    [tokenIndex, tokenMeta]
  );

  // Fetch metadata for owned tokens not in the live feed
  useEffect(() => {
    for (const mint of Object.keys(balances)) {
      if (mint === SOL_MINT) continue;
      if ((balances[mint].uiAmount || 0) > 0) fetchTokenMeta(mint);
    }
  }, [balances, fetchTokenMeta]);

  // solPrice held in a ref so executeSwap's identity stays stable across the
  // 30s price refresh — otherwise the auto-trade exit-loop effect (which
  // depends on executeSwap) tears down and rebuilds its interval every 30s.
  const solPriceRef = useRef(solPrice);
  useEffect(() => { solPriceRef.current = solPrice; }, [solPrice]);

  // FIX 1: executeSwap wrapper with correct arg shape for ape-helpers.executeSwap
  const executeSwap = useCallback(async ({ mode, token, swapParams, tradeLamports, feeLamports, totalLamports, tradeTokensRaw, tradeTokensUi, decimals }) => {
    const params = swapParams || (mode === 'buy'
      ? { mode: 'buy', tradeLamports, feeLamports, totalLamports }
      : { mode: 'sell', tradeTokens: tradeTokensRaw, tradeTokensUi, feeLamports: feeLamports != null ? String(feeLamports) : '0', decimals: decimals != null ? Number(decimals) : 6 });
    const result = await apeExecuteSwap({
      mode: params.mode,
      swapParams: params,
      token,
      keypair: wallet.keypair,
      userPk: wallet.publicKey,
      tradeConnection,
      walletStr,
      refWalletStr: mainWalletPubkey,
      solPrice: solPriceRef.current,
    });
    try { localStorage.setItem(HAS_TRADED_KEY, '1'); } catch (e) {}
    setShowLure(false);
    setTimeout(() => { refreshSol(); refreshOneToken(token.mint); }, 800);
    return result;
  }, [wallet.keypair, wallet.publicKey, tradeConnection, walletStr, mainWalletPubkey, refreshSol, refreshOneToken]);

  // FIX 5: result.sig (ape-helpers returns { confirmed, sig })
  const onApe = useCallback(async (token) => {
    if (busyMints[token.mint]) return;
    setBusyMints(prev => ({ ...prev, [token.mint]: true }));
    try {
      const params = buildBuyParams(quickAmount);
      const result = await executeSwap({ mode: 'buy', token, swapParams: params });
      setConfettiAt(Date.now());
      pushToast({
        type: 'success', em: '✓',
        body: <>Bought <b>{quickAmount} SOL</b> of <b>${token.sym}</b></>,
        actions: result?.sig ? [
          { type: 'link', href: 'https://solscan.io/tx/' + result.sig, label: 'TX' },
          { type: 'tweet', text: 'Just aped ' + quickAmount + ' SOL into $' + token.sym + ' on Nexus 🚀\n\n', url: shareUrlPath(walletStr), label: 'Share' },
        ] : [],
      });
    } catch (e) { pushToast({ type: 'error', em: '⊘', body: friendlyError(e) }); }
    finally { setBusyMints(prev => { const n = { ...prev }; delete n[token.mint]; return n; }); }
  }, [busyMints, quickAmount, executeSwap, pushToast, walletStr]);

  const onSell = useCallback((token) => { setTradeToken(token); setTradeMode('sell'); }, []);
  const onRowClick = useCallback((token) => { setTradeToken(token); setTradeMode('buy'); }, []);

  // FIX 6: result.sig
  const onTradeConfirm = useCallback(async ({ mode, swapParams, token }) => {
    const result = await executeSwap({ mode, token, swapParams });
    setConfettiAt(Date.now());
    setTradeToken(null);
    pushToast({
      type: 'success', em: '✓',
      body: <>{mode === 'buy' ? 'Bought' : 'Sold'} <b>${token.sym}</b></>,
      actions: result?.sig ? [
        { type: 'link', href: 'https://solscan.io/tx/' + result.sig, label: 'TX' },
        { type: 'tweet', text: (mode === 'buy' ? 'Just aped into $' : 'Just sold $') + token.sym + ' on Nexus\n\n', url: shareUrlPath(walletStr), label: 'Share' },
      ] : [],
    });
  }, [executeSwap, pushToast, walletStr]);

  const onWithdraw = useCallback(async (dest, amount) => {
    if (!dest || !(amount > 0)) return;
    setWithdrawBusy(true);
    try {
      const conn = getTradeConn();
      const lamports = Math.round(amount * 1e9);
      const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(dest), lamports });
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
      const tx = new VersionedTransaction(msg); tx.sign([wallet.keypair]);
      const sig = await conn.sendTransaction(tx);
      await conn.confirmTransaction(sig, 'confirmed');
      setTimeout(refreshSol, 1000);
      pushToast({ type: 'success', em: '✓', body: <>Withdrew <b>{amount} SOL</b></>, actions: [{ type: 'link', href: 'https://solscan.io/tx/' + sig, label: 'TX' }] });
      setShowWallet(false);
    } catch (e) { pushToast({ type: 'error', em: '⊘', body: friendlyError(e) }); }
    finally { setWithdrawBusy(false); }
  }, [wallet, refreshSol, pushToast]);

  const auto = useAutoTrade({
    recentTokens: recent, solBalance, solPrice, balances, executeSwap, pushToast,
  });

  const filtered = useMemo(() => {
    let list = recent;
    if (wildOnly) list = list.filter(t => riskRead(t).tier === 'high');
    if (minLiq > 0) list = list.filter(t => (t.liquidity || 0) >= minLiq);
    if (activeTab === 'owned') {
      list = list.filter(t => balances[t.mint] && balances[t.mint].uiAmount > 0);
      const inFeed = new Set(list.map(t => t.mint));
      for (const mint of Object.keys(balances)) {
        if (mint === SOL_MINT) continue;
        if (inFeed.has(mint)) continue;
        if (!(balances[mint].uiAmount > 0)) continue;
        list.push(resolveToken(mint));
      }
    }
    return list.slice(0, 15);
  }, [recent, wildOnly, minLiq, activeTab, balances, resolveToken]);

  const trending = useMemo(() => {
    return [...recent]
      .filter(t => Number.isFinite(t.change))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 6);
  }, [recent]);

  useEffect(() => {
    if (recent.length === 0) return;
    const first = recent[0];
    if (first && first.mint && first.mint !== lastFreshMintRef.current) {
      lastFreshMintRef.current = first.mint;
    }
  }, [recent]);

  const ownedCount = useMemo(() => Object.keys(balances).filter(m => m !== SOL_MINT && balances[m].uiAmount > 0).length, [balances]);
  const activeFiltersCount = (wildOnly ? 1 : 0) + (minLiq > 0 ? 1 : 0);
  const burnerHasNoSol = !solBalance || solBalance.uiAmount < 0.01;

  return (
    <div className="ap-root">
      <div className="ap-app">
        <nav className="ap-nav">
          <div className="ap-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="ap-brand-glyph">A</div>
            <span className="ap-bname">Ape<span className="dot">·</span><span className="it">early</span></span>
          </div>
          <div className="ap-nav-live"><span className="d" /><span>LIVE FEED</span></div>
          <button className="ap-nav-btn" onClick={() => setShowAuto(true)}>Auto-trade</button>
          <button className="ap-nav-btn" onClick={() => { setStatsTab('referrals'); setShowStats(true); }}>Referrals</button>
          <button className="ap-nav-wallet" onClick={() => setShowWallet(true)}>
            <span className="glyph">◎</span>
            <span>{solBalance ? formatSol(solBalance.uiAmount) : '—'} SOL</span>
            <span className="dot" />
            {!wallet.backedUp && <span className="nudge" title="Back up your wallet" />}
          </button>
        </nav>

        <div className="ap-qbar">
          <span className="ap-qlabel"><span className="b">⚡</span>Quick buy</span>
          {buyPresets.map((v, i) => (
            <button key={v} className={'ap-qamt' + (i === activeQuickIdx ? ' active' : '')} onClick={() => setActiveQuickIdx(i)}>
              {v} <span className="s">SOL</span>
            </button>
          ))}
          <button className="ap-qedit" onClick={() => setShowPresets(true)} title="Edit amounts">✎</button>
          <span className="ap-qfast"><span className="d" /><span>2-SEC TRADE</span></span>
        </div>

        <div className="ap-page">
          <div className="ap-hero">
            <h1>Fresh launches, <span className="it">caught at first light.</span></h1>
            <div className="ap-hero-cta">
              <span className="ap-pill-no-connect">● Burner ready · no signup</span>
              {/* FIX 7: Updated referral banner copy */}
              <button className="ap-hero-ref" onClick={() => { setStatsTab('referrals'); setShowStats(true); }}>
                Invite friends, <span className="it">earn 50% of their fees</span>
                <span className="pct">FOREVER</span>
              </button>
            </div>
          </div>

          {showLure && burnerHasNoSol ? (
            <div className="ap-lure">
              <div className="ap-lure-text">
                <div className="ap-lure-h">Fund your <span className="it">burner</span> to trade in 2 seconds.</div>
                <div className="ap-lure-s"><b>0.1 SOL</b> is plenty to start · trades sign on this device · no extension popup</div>
              </div>
              <button className="ap-lure-intro" onClick={() => setShowWallet(true)}>↓ DEPOSIT</button>
              <button className="ap-lure-close" onClick={() => setShowLure(false)}>×</button>
            </div>
          ) : null}

          <OpenPositionsStrip walletStr={walletStr} solPrice={solPrice} onOpenStats={() => { setStatsTab('yourtrades'); setShowStats(true); }} />

          {trending.length > 0 ? (
            <div className="ap-trending">
              <div className="ap-trending-head">
                <span className="lbl">★ Trending now</span>
                <span className="meta">Biggest moves · live</span>
              </div>
              <div className="ap-trending-rail">
                {trending.map(t => {
                  const c = colorFor(t.mint);
                  const up = (t.change || 0) >= 0;
                  return (
                    <div className="ap-trend-card" key={t.mint} onClick={() => onRowClick(t)}>
                      <div className="av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}><TokenChip token={t} /></div>
                      <div className="meta">
                        <div className="sym">${t.sym}</div>
                        <div className={'chg' + (up ? '' : ' dn')}>{formatPct(t.change)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="ap-list-frame">
            <div className="ap-list-head">
              <div className="ap-list-title">
                <span className="e">§ The feed</span>
                <span className="t">{activeTab === 'owned' ? <>Your <span className="it">bag</span></> : <>Fresh <span className="it">tokens</span></>}</span>
              </div>
              <div className="ap-list-filters">
                <button className={'ap-chip' + (activeTab === 'feed' ? ' on' : '')} onClick={() => setActiveTab('feed')}>All new</button>
                <button className={'ap-chip owned' + (activeTab === 'owned' ? ' on' : '')} onClick={() => setActiveTab('owned')}>You own{ownedCount > 0 ? ' · ' + ownedCount : ''}</button>
                <button className="ap-filter-btn" onClick={() => setShowFilters(true)}>
                  <span>Filters</span>{activeFiltersCount > 0 ? <span className="ct">{activeFiltersCount}</span> : null}
                </button>
              </div>
            </div>

            <div className="ap-list">
              {feedError ? (
                <div className="ap-empty"><span className="glyph">⊘</span><b>Couldn't reach the feed</b><span className="sub">Retrying every few seconds. Solana RPC sometimes hiccups.</span><div className="err">{feedError}</div></div>
              ) : filtered.length === 0 ? (
                <div className="ap-empty">
                  <span className="glyph">∅</span>
                  <b>{activeTab === 'owned' ? <>No tokens in your <span style={{fontStyle:'italic',color:'#3DD4F5'}}>bag</span></> : <>Nothing matches</>}</b>
                  <span className="sub">{activeTab === 'owned' ? <>Buy something and it'll appear here.</> : activeFiltersCount > 0 ? 'Try loosening filters.' : 'Waiting for fresh launches…'}</span>
                </div>
              ) : (
                filtered.map(t => {
                  const ageMsLive = t.pairCreatedAtMs ? now - t.pairCreatedAtMs : null;
                  const isFresh = t.mint === lastFreshMintRef.current && ageMsLive != null && ageMsLive < 60000;
                  return (
                    <SpecimenRow
                      key={t.mint}
                      token={t}
                      ageMsLive={ageMsLive}
                      owned={balances[t.mint]}
                      costBasis={pnlBasis[t.mint]}
                      solPrice={solPrice}
                      quickAmount={quickAmount + ' SOL'}
                      busy={!!busyMints[t.mint]}
                      onApe={onApe}
                      onSell={onSell}
                      onOpen={onRowClick}
                      isFresh={isFresh}
                      ownedMode={activeTab === 'owned'}
                    />
                  );
                })
              )}
            </div>

            <div className="ap-list-foot">
              <span className={'live' + (feedError ? ' warn' : '')}>
                <span className="d" />
                <span>{feedError ? 'Reconnecting…' : 'Live · refreshing every ' + (POLL_RECENT / 1000) + 's'}</span>
              </span>
              <span>{filtered.length} of {recent.length} shown</span>
            </div>
          </div>
        </div>
      </div>

      {tradeToken && (
        <TradeSheet
          token={tradeToken}
          initialMode={tradeMode}
          onClose={() => setTradeToken(null)}
          onConfirm={onTradeConfirm}
          buyPresets={buyPresets}
          sellPresets={sellPresets}
          solBalance={solBalance}
          tokenBalance={balances[tradeToken.mint]}
          solPrice={solPrice}
        />
      )}
      {showPresets && (<PresetsModal buyPresets={buyPresets} setBuyPresets={setBuyPresets} sellPresets={sellPresets} setSellPresets={setSellPresets} onClose={() => setShowPresets(false)} />)}
      {showFilters && (<FiltersModal wildOnly={wildOnly} setWildOnly={setWildOnly} minLiq={minLiq} setMinLiq={setMinLiq} onClose={() => setShowFilters(false)} />)}
      {showWallet && (<WalletDrawer wallet={wallet} solBalance={solBalance} solPrice={solPrice} onWithdraw={onWithdraw} onClose={() => setShowWallet(false)} busy={withdrawBusy} balances={balances} resolveToken={resolveToken} />)}
      <StatsPanel open={showStats} onClose={() => setShowStats(false)} wallet={wallet} mainWalletPubkey={mainWalletPubkey} solPrice={solPrice} initialTab={statsTab} />
      <AutoPanel open={showAuto} onClose={() => setShowAuto(false)} auto={auto} solBalance={solBalance} solPrice={solPrice} />

      <div className="ap-toasts">
        {toasts.map(t => (
          <div className={'ap-toast ' + (t.type || 'info')} key={t.id}>
            {t.em ? <span className="em">{t.em}</span> : null}
            <span className="tb">{t.body}</span>
            {t.actions && t.actions.length > 0 && (
              <span className="ta">
                {t.actions.map((a, i) => a.type === 'link'
                  ? <a key={i} className="ap-taction" href={a.href} target="_blank" rel="noopener noreferrer">{a.label}</a>
                  : <button key={i} className="ap-taction tw" onClick={() => openTwitterShare(a.text, a.url)}>{a.label}</button>)}
              </span>
            )}
          </div>
        ))}
      </div>

      {confettiAt > 0 && Date.now() - confettiAt < 2000 ? (
        <div className="ap-confetti" key={confettiAt}>
          {Array.from({ length: 28 }).map((_, i) => {
            const dx = (Math.random() - 0.5) * 600;
            const dy = 300 + Math.random() * 200;
            const dr = (Math.random() - 0.5) * 1200;
            const c = ['#A0E7FF', '#FF8FBE', '#B794F6', '#FFD46B', '#7FFFD4'][i % 5];
            return <span className="ap-cpiece" key={i} style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--dr': dr + 'deg', background: c, animationDelay: (Math.random() * 0.15) + 's' }} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   STATS PANEL — Referrals, Your trades, Standings
   ============================================================ */
function ReferralsTab({ walletStr, stats, statsLoading, statsError }) {
  const link = inviteUrl(walletStr);
  const [copied, setCopied] = useState(false);
  const copyLink = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };

  const earnedSol    = lamportsToSol(stats?.earned_lamports);
  const earned7dSol  = lamportsToSol(stats?.earned_lamports_7d);
  const earned24hSol = lamportsToSol(stats?.earned_lamports_24h);
  const referees     = stats?.referees || 0;
  const active       = stats?.active_referees || 0;

  const inviteTweet = "I've been trading fresh launches on Nexus Ape — burner wallet, 2-second trade, honest reads.\n\nFollow my line:";

  if (!walletStr) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Connect a <span className="it">main wallet.</span></h1>
      <p className="wp-sub">Your referral link pays out on-chain. We won't build it against the burner — burners are disposable, your fees shouldn't be. Connect a wallet you'll still own next year.</p>
    </>
  );

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Your <span className="it">invitation.</span></h1>
      <p className="wp-sub">Pass Nexus forward. Every trade your line makes returns <b>50% of the fee</b> — direct to this wallet, same block as the trade.</p>

      <div className="wp-card feature">
        <div className="wp-card-eye"><span>◌</span><span>Your link</span></div>
        <div className="wp-link">
          <input className="wp-link-v" value={link} readOnly onClick={(e) => e.target.select()} />
          <button className={'wp-link-cp' + (copied ? ' copied' : '')} onClick={copyLink}>{copied ? '✓ COPIED' : 'COPY'}</button>
        </div>
        <div className="wp-share-row">
          <button className="wp-sh tw" onClick={() => openTwitterShare(inviteTweet, link)}><span className="ico"><IconX /></span><span>Share on X</span></button>
          <button className="wp-sh tg" onClick={() => openTelegram(inviteTweet, link)}><span className="ico"><IconTg /></span><span>Telegram</span></button>
          <button className="wp-sh ds" onClick={() => { try { navigator.clipboard.writeText(inviteTweet + '\n' + link); } catch (e) {} }}><span className="ico"><IconDs /></span><span>Copy for Discord</span></button>
        </div>
      </div>

      {statsError ? (
        <div className="wp-card"><div className="wp-empty"><span className="gl">⊘</span><div className="h">Couldn't read your stats</div><div className="e">{statsError}</div></div></div>
      ) : statsLoading && !stats ? (
        <div className="wp-card"><div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Reading the ledger…</div></div></div>
      ) : (
        <div className="wp-stats">
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">№</span>Referees</div><div className="wp-stat-v">{referees}</div><div className="wp-stat-m">{active} have made at least one trade</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Earned · 24h</div><div className={'wp-stat-v ' + (earned24hSol > 0 ? 'gn' : 'it')}>{earned24hSol > 0 ? formatSolSigned(earned24hSol) : '—'}{earned24hSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Last day</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Earned · 7d</div><div className={'wp-stat-v ' + (earned7dSol > 0 ? 'gn' : 'it')}>{earned7dSol > 0 ? formatSolSigned(earned7dSol) : '—'}{earned7dSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Rolling week</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">§</span>Earned · all time</div><div className={'wp-stat-v ' + (earnedSol > 0 ? 'gn' : 'it')}>{earnedSol > 0 ? formatSolSigned(earnedSol) : '—'}{earnedSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Since your first referee</div></div>
        </div>
      )}

      <div className="wp-card">
        <div className="wp-card-eye"><span>§</span><span>How the line pays</span></div>
        <div className="wp-rules">
          <div className="wp-rule"><div className="n">01</div><div><div className="h">Someone follows your <span className="it">link.</span></div><div className="b">They land on Nexus with your wallet attached. The first time they trade, you're locked in as their referrer — <b>permanently</b>.</div></div></div>
          <div className="wp-rule"><div className="n">02</div><div><div className="h">They <span className="it">trade.</span> You get paid in the same block.</div><div className="b">Each trade carries a 3% platform fee. <b>50%</b> is sent directly to your wallet as part of the same on-chain transaction.</div></div></div>
          <div className="wp-rule"><div className="n">03</div><div><div className="h">No withdrawals. No <span className="it">claims.</span></div><div className="b">Earnings are already in this wallet the moment each trade confirms.</div></div></div>
        </div>
      </div>
    </>
  );
}

function YourTradesTab({ walletStr, pnl, pnlLoading, pnlError, solPrice }) {
  const realized = pnl?.realized_pnl_sol || 0;
  const volume = pnl?.total_volume_sol || 0;
  const count = pnl?.trade_count || 0;
  const positions = (pnl?.positions || []);
  const open = positions.filter(p => p.open);
  const realizedUsd = solPrice > 0 ? realized * solPrice : 0;
  const isPos = realized >= 0;
  const best = useMemo(() => positions.length ? [...positions].sort((a,b) => b.realized_pnl_sol - a.realized_pnl_sol)[0] : null, [positions]);
  const worst = useMemo(() => {
    const c = positions.filter(p => p.realized_pnl_sol < 0);
    return c.length ? c.sort((a,b) => a.realized_pnl_sol - b.realized_pnl_sol)[0] : null;
  }, [positions]);
  const shareTweet = useMemo(() => [
    'My trades · ' + truncWallet(walletStr),
    'Realized: ' + formatSolSigned(realized) + ' SOL',
    count + ' trades · ' + formatSol(volume) + ' SOL routed',
    best && best.realized_pnl_sol > 0 ? 'Best: $' + (best.sym || '???') + ' ' + formatSolSigned(best.realized_pnl_sol) + ' SOL' : '',
    '', 'Traded on Nexus:',
  ].filter(Boolean).join('\n'), [walletStr, realized, count, volume, best]);

  if (pnlError) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">⊘</span><div className="h">The ledger is unreachable</div><div className="e">{pnlError}</div></div></div></>;
  if (pnlLoading && !pnl) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Reading the ledger…</div></div></div></>;
  if (!pnl || count === 0) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">∅</span><div className="h">No <span className="it">trades</span> yet</div><div className="s">Your first trade will start the log.</div></div></div></>;

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Your trades</span><span className="rule" /></div>
      <div className={'wp-pnl-hero' + (isPos ? '' : ' neg')}>
        <div className="wp-pnl-hero-l">
          <div className={'wp-pnl-eye' + (isPos ? '' : ' neg')}><span className="gl">{isPos ? '◉' : '⊘'}</span><span>Realized · all time</span></div>
          <div className={'wp-pnl-val' + (isPos ? '' : ' neg')}>{formatSolSigned(realized)}<span className="u">SOL</span></div>
          <div className="wp-pnl-usd">{solPrice > 0 ? '≈ ' + formatUsdAbs(realizedUsd) : ' '}{' · '}{count} {count === 1 ? 'trade' : 'trades'} · {formatSol(volume)} SOL routed</div>
        </div>
        <div className="wp-pnl-r">
          <button className="wp-pnl-share" onClick={() => openTwitterShare(shareTweet, shareUrlPath(walletStr))}><IconX /><span>Share</span></button>
        </div>
      </div>

      <div className="wp-stats">
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">№</span>Volume</div><div className="wp-stat-v">{formatSol(volume)}<span className="u">SOL</span></div><div className="wp-stat-m">{solPrice > 0 ? '≈ ' + formatUsdAbs(volume * solPrice) : ' '}</div></div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Open</div><div className="wp-stat-v">{open.length}<span className="u">/ {positions.length}</span></div><div className="wp-stat-m">{open.length === 0 ? 'All closed' : 'Still in your bag'}</div></div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">↑</span>Best</div>{best && best.realized_pnl_sol > 0 ? <><div className="wp-stat-v gn">{formatSolSigned(best.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${best.sym || '???'}</div></> : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed winners yet</div></>}</div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">↓</span>Worst</div>{worst ? <><div className="wp-stat-v rd">{formatSolSigned(worst.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${worst.sym || '???'}</div></> : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed losers</div></>}</div>
      </div>

      <div className="wp-pos-frame">
        <div className="wp-pos-head"><span className="e">◉ Positions · {positions.length}</span></div>
        <div className="wp-pos-row thead">
          <span className="wp-pos-no">№</span><span>Token</span>
          <span className="wp-col-avg" style={{textAlign:'right'}}>Avg buy</span>
          <span className="wp-col-open" style={{textAlign:'right'}}>Open</span>
          <span style={{textAlign:'right'}}>Realized</span>
          <span style={{textAlign:'right'}}>Status</span>
        </div>
        {positions.map((p, i) => {
          const c = colorFor(p.mint);
          const rp = p.realized_pnl_sol > 0, rn = p.realized_pnl_sol < -0.0001;
          return (
            <div className="wp-pos-row" key={p.mint}>
              <span className="wp-pos-no">№{(i+1).toString().padStart(2,'0')}</span>
              <div className="wp-pos-tk">
                <div className="wp-pos-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
                <div style={{minWidth:0,flex:1}}>
                  <div className="wp-pos-sym"><span>${p.sym || '???'}</span><span className={'wp-pos-status ' + (p.open ? 'open' : 'closed')}>{p.open ? 'open' : 'closed'}</span></div>
                  <div className="wp-pos-meta">{p.buys}b · {p.sells}s · {formatSol(p.sol_in)} in / {formatSol(p.sol_out)} out</div>
                </div>
              </div>
              <span className="wp-pos-num dim wp-col-avg" style={{textAlign:'right'}}>{p.avg_buy_price_sol > 0 ? p.avg_buy_price_sol.toExponential(2) + ' SOL' : '—'}</span>
              <span className="wp-pos-num dim wp-col-open" style={{textAlign:'right'}}>{p.open ? formatTokens(p.open_tokens) : '—'}</span>
              <span className={'wp-pos-num ' + (rp ? 'gn' : rn ? 'rd' : 'dim')} style={{textAlign:'right'}}>{Math.abs(p.realized_pnl_sol) > 0.0001 ? formatSolSigned(p.realized_pnl_sol) + ' SOL' : '—'}</span>
              <span style={{textAlign:'right'}}><span className={'wp-pos-status ' + (p.open ? 'open' : 'closed')}>{p.open ? 'held' : 'flat'}</span></span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StandingsTab({ walletStr, lb, lbLoading, lbError, win, setWin }) {
  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Standings</span><span className="rule" /></div>
      <h1 className="wp-h1">The <span className="it">field</span>, ranked.</h1>
      <p className="wp-sub">Top traders by SOL volume routed through Nexus. Refreshes every 30 seconds.</p>
      <div className="wp-win-tabs">
        <button className={'wp-win-tab' + (win === '24h' ? ' on' : '')} onClick={() => setWin('24h')}>24 hours</button>
        <button className={'wp-win-tab' + (win === '7d'  ? ' on' : '')} onClick={() => setWin('7d')}>7 days</button>
        <button className={'wp-win-tab' + (win === 'all' ? ' on' : '')} onClick={() => setWin('all')}>All time</button>
      </div>
      <div className="wp-lb-frame">
        <div className="wp-lb-row thead"><span>Rank</span><span>Trader</span><span style={{textAlign:'right'}}>Volume</span><span className="wp-col-tr" style={{textAlign:'right'}}>Trades</span></div>
        {lbError ? (
          <div className="wp-empty"><span className="gl">⊘</span><div className="h">Standings unreachable</div><div className="e">{lbError}</div></div>
        ) : lbLoading && !lb ? (
          <div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Counting the field…</div></div>
        ) : !lb || lb.count === 0 ? (
          <div className="wp-empty"><span className="gl">∅</span><div className="h">No <span className="it">trades</span> logged in this window</div></div>
        ) : (
          <>
            {lb.traders.map((t, i) => {
              const rank = i + 1;
              const mine = t.wallet === walletStr;
              const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
              return (
                <div className={'wp-lb-row' + (mine ? ' mine' : '')} key={t.wallet}>
                  <span className={'wp-lb-rank ' + rankClass}><span className="hash">№</span>{rank.toString().padStart(2, '0')}</span>
                  <span className="wp-lb-w">{truncWallet(t.wallet)}{mine ? <span className="you">YOU</span> : null}</span>
                  <span className="wp-lb-vol">{formatSol(t.volume_sol)}<span className="u"> SOL</span></span>
                  <span className="wp-lb-tr wp-col-tr">{t.trades}</span>
                </div>
              );
            })}
            <div className="wp-lb-foot"><span>{lb.total_traders || lb.count} traders · top 50 shown</span><span>Refreshed · {new Date(lb.ts || Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
          </>
        )}
      </div>
    </>
  );
}

function StatsPanel({ open, onClose, wallet, mainWalletPubkey, solPrice, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'referrals');
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);
  const burnerWalletStr = wallet?.publicKey?.toBase58 ? wallet.publicKey.toBase58() : '';
  const refWalletStr = mainWalletPubkey || '';
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState(null);
  const [lb, setLb] = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(null);
  const [lbWin, setLbWin] = useState('24h');

  const fetchStats = useCallback(async () => {
    if (!refWalletStr) return; setStatsLoading(true);
    try { const r = await fetch('/api/ref/stats?wallet=' + refWalletStr); if (!r.ok) throw new Error('HTTP ' + r.status); setStats(await r.json()); setStatsError(null); }
    catch (e) { setStatsError(String(e.message || 'Network').slice(0, 100)); } finally { setStatsLoading(false); }
  }, [refWalletStr]);
  const fetchPnl = useCallback(async () => {
    if (!burnerWalletStr) return; setPnlLoading(true);
    try { const r = await fetch('/api/ref/pnl?wallet=' + burnerWalletStr); if (!r.ok) throw new Error('HTTP ' + r.status); setPnl(await r.json()); setPnlError(null); }
    catch (e) { setPnlError(String(e.message || 'Network').slice(0, 100)); } finally { setPnlLoading(false); }
  }, [burnerWalletStr]);
  const fetchLb = useCallback(async (w) => {
    setLbLoading(true);
    try { const r = await fetch('/api/ref/leaderboard?window=' + (w || lbWin)); if (!r.ok) throw new Error('HTTP ' + r.status); setLb(await r.json()); setLbError(null); }
    catch (e) { setLbError(String(e.message || 'Network').slice(0, 100)); } finally { setLbLoading(false); }
  }, [lbWin]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'referrals' && refWalletStr) fetchStats();
    else if (tab === 'yourtrades' && burnerWalletStr) fetchPnl();
    else if (tab === 'standings') fetchLb(lbWin);
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (tab === 'referrals' && refWalletStr) fetchStats();
      else if (tab === 'yourtrades' && burnerWalletStr) fetchPnl();
      else if (tab === 'standings') fetchLb(lbWin);
    }, 30000);
    return () => clearInterval(id);
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => { if (!open) return; const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, [open]);
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') onClose && onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="wp-root">
      <div className="wp-head">
        <div style={{display:'flex',alignItems:'center',gap:11,cursor:'pointer'}} onClick={onClose}>
          <div style={{width:30,height:30,borderRadius:10,background:'linear-gradient(135deg,#A0E7FF,#FF8FBE)',display:'grid',placeItems:'center',fontFamily:"'Instrument Serif',serif",fontStyle:'italic',fontSize:17,color:'#fff'}}>A</div>
          <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,letterSpacing:'-.015em',color:'#1A1B4E'}}>Ape <em style={{fontStyle:'italic',color:'rgba(26,27,78,0.7)'}}>· early</em></span>
        </div>
        <div className="wp-headlbl"><span className="d" /><span>STATS · PERSONAL</span></div>
        <button className="wp-close" onClick={onClose}>×</button>
      </div>
      <div className="wp-tabs">
        <button className={'wp-tab' + (tab === 'referrals' ? ' on' : '')} onClick={() => setTab('referrals')}><span className="glyph">§ 01</span><span>Referrals</span></button>
        <button className={'wp-tab' + (tab === 'yourtrades' ? ' on' : '')} onClick={() => setTab('yourtrades')}><span className="glyph">§ 02</span><span>Your trades</span></button>
        <button className={'wp-tab' + (tab === 'standings' ? ' on' : '')} onClick={() => setTab('standings')}><span className="glyph">§ 03</span><span>Standings</span></button>
      </div>
      <div className="wp-page" key={tab}>
        {tab === 'referrals' && <ReferralsTab walletStr={refWalletStr} stats={stats} statsLoading={statsLoading} statsError={statsError} />}
        {tab === 'yourtrades' && <YourTradesTab walletStr={burnerWalletStr} pnl={pnl} pnlLoading={pnlLoading} pnlError={pnlError} solPrice={solPrice} />}
        {tab === 'standings' && <StandingsTab walletStr={burnerWalletStr} lb={lb} lbLoading={lbLoading} lbError={lbError} win={lbWin} setWin={setLbWin} />}
      </div>
    </div>
  );
}

/* ============================================================
   AUTO-TRADE
   ============================================================ */
const BALANCED_SETTINGS = {
  perTradeSol: 0.2, takeProfitPct: 150, stopLossPct: 30,
  minAgeMin: 3, maxAgeMin: 30, minLiqUsd: 10000, minHolders: 30,
  minVibe: 40, maxOpen: 5, maxPerHour: 10,
};
const SAFETY_FLOOR = { dailyLossCapSol: 1.0, maxHoldMin: 30, ageMinAbsolute: 3, posPollMs: 7000 };
const AT_SETTINGS_KEY = 'lr_at_settings_v1';
const AT_STATE_KEY = 'lr_at_state_v1';
const AT_POSITIONS_KEY = 'lr_at_positions_v1';
const AT_ENABLED_KEY = 'lr_at_enabled_v1';
const AT_BAL_AMT_KEY = 'lr_at_bal_amount_v1';
const AT_POS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function loadCustomSettings() {
  try { const raw = localStorage.getItem(AT_SETTINGS_KEY); if (!raw) return { ...BALANCED_SETTINGS }; return { ...BALANCED_SETTINGS, ...JSON.parse(raw) }; }
  catch (e) { return { ...BALANCED_SETTINGS }; }
}
function saveCustomSettings(s) { try { localStorage.setItem(AT_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
function loadDailyState() {
  try { const raw = localStorage.getItem(AT_STATE_KEY); if (!raw) return null; const d = JSON.parse(raw); if (!d || d.day !== new Date().toDateString()) return null; return d; }
  catch (e) { return null; }
}
function saveDailyState(d) { try { localStorage.setItem(AT_STATE_KEY, JSON.stringify({ ...d, day: new Date().toDateString() })); } catch (e) {} }
function loadPositions() {
  try {
    const raw = localStorage.getItem(AT_POSITIONS_KEY); if (!raw) return [];
    const arr = JSON.parse(raw); if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - AT_POS_MAX_AGE_MS;
    return arr.filter(p => p && p.mint && Number.isFinite(p.ts) && p.ts > cutoff && Number.isFinite(p.entryPriceUsd)).map(p => ({ ...p, exiting: false }));
  } catch (e) { return []; }
}
function savePositions(arr) { try { localStorage.setItem(AT_POSITIONS_KEY, JSON.stringify(arr || [])); } catch (e) {} }
function loadEnabled() { try { return localStorage.getItem(AT_ENABLED_KEY) === '1'; } catch (e) { return false; } }
function saveEnabled(v) { try { localStorage.setItem(AT_ENABLED_KEY, v ? '1' : '0'); } catch (e) {} }
function loadBalancedAmount() {
  try { const raw = localStorage.getItem(AT_BAL_AMT_KEY); if (raw == null) return BALANCED_SETTINGS.perTradeSol; const n = Number(raw); return Number.isFinite(n) && n > 0 ? n : BALANCED_SETTINGS.perTradeSol; }
  catch (e) { return BALANCED_SETTINGS.perTradeSol; }
}
function saveBalancedAmount(n) { try { localStorage.setItem(AT_BAL_AMT_KEY, String(n)); } catch (e) {} }

function useAutoTrade(deps) {
  const { recentTokens, solBalance, solPrice, balances, executeSwap, pushToast } = deps;
  const initialDaily = useMemo(() => loadDailyState() || {}, []);
  const [enabled, setEnabledState] = useState(() => loadEnabled());
  const [mode, setMode] = useState('balanced');
  const [custom, setCustom] = useState(() => loadCustomSettings());
  const [balancedAmount, setBalancedAmountState] = useState(() => loadBalancedAmount());
  const [positions, setPositionsState] = useState(() => loadPositions());
  const [log, setLog] = useState([]);
  const [dailyPnlSol, setDailyPnlSol] = useState(initialDaily.dailyPnlSol || 0);
  const [tradesToday, setTradesToday] = useState(initialDaily.tradesToday || 0);
  const [paused, setPaused] = useState(initialDaily.paused || false);
  const seenMintsRef = useRef(new Set());
  const inflightRef = useRef(new Set());
  const tradeStampsRef = useRef([]);
  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  const balancesRef = useRef(balances);
  useEffect(() => { balancesRef.current = balances; }, [balances]);
  const exitSolPriceRef = useRef(solPrice);
  useEffect(() => { exitSolPriceRef.current = solPrice; }, [solPrice]);

  const setEnabled = useCallback((v) => {
    setEnabledState(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      saveEnabled(next); return next;
    });
  }, []);
  const setBalancedAmount = useCallback((n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return;
    setBalancedAmountState(v); saveBalancedAmount(v);
  }, []);

  const setPositions = useCallback((updater) => {
    setPositionsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      savePositions(next); return next;
    });
  }, []);

  const settings = mode === 'balanced' ? { ...BALANCED_SETTINGS, perTradeSol: balancedAmount } : custom;
  const effective = useMemo(() => ({ ...settings, minAgeMin: Math.max(SAFETY_FLOOR.ageMinAbsolute, settings.minAgeMin) }), [settings]);

  const updateCustom = useCallback((patch) => {
    setCustom(prev => { const next = { ...prev, ...patch }; saveCustomSettings(next); return next; });
  }, []);

  useEffect(() => { saveDailyState({ dailyPnlSol, tradesToday, paused }); }, [dailyPnlSol, tradesToday, paused]);

  const pushLog = useCallback((tag, msg) => {
    setLog(prev => [{ id: Math.random().toString(36).slice(2, 9), ts: Date.now(), tag, msg }, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    if (-dailyPnlSol >= SAFETY_FLOOR.dailyLossCapSol && !paused) {
      setPaused(true); setEnabled(false);
      pushLog('error', 'Daily loss cap hit — auto-trade paused');
      pushToast && pushToast({ type: 'error', em: '⊘', body: <>Daily loss cap hit. <b>Auto paused.</b></> });
    }
  }, [dailyPnlSol, paused, pushLog, pushToast]);

  // Discovery loop — buy via executeSwap (which now forwards correctly to ape-helpers)
  useEffect(() => {
    if (!enabled || paused) return;
    if (!Array.isArray(recentTokens) || recentTokens.length === 0) return;
    const now = Date.now();
    tradeStampsRef.current = tradeStampsRef.current.filter(t => now - t < 60 * 60 * 1000);
    if (tradeStampsRef.current.length >= effective.maxPerHour) return;
    if (positionsRef.current.length >= effective.maxOpen) return;

    for (const tk of recentTokens) {
      if (!tk || !tk.mint) continue;
      if (seenMintsRef.current.has(tk.mint)) continue;
      if (inflightRef.current.has(tk.mint)) continue;
      if (positionsRef.current.some(p => p.mint === tk.mint)) continue;

      // Only "too old" permanently blacklists. Age-too-young, liquidity,
      // holders, and vibe are all transient — a token that fails now may
      // pass minutes later as it ages into the window and fills out. Marking
      // them seen here is what stopped auto-buys from ever firing.
      const ageMin = tk.pairCreatedAtMs ? (now - tk.pairCreatedAtMs) / 60000 : 999;
      if (ageMin > effective.maxAgeMin) { seenMintsRef.current.add(tk.mint); continue; }
      if (ageMin < effective.minAgeMin) continue;
      if (!Number.isFinite(tk.liquidity) || tk.liquidity < effective.minLiqUsd) continue;
      if (!Number.isFinite(tk.holders) || tk.holders < effective.minHolders) continue;
      const r = riskRead(tk);
      if (r.score < effective.minVibe) continue;
      if (!(tk.price > 0)) continue;
      if (((solBalance && solBalance.uiAmount) || 0) < effective.perTradeSol + 0.01) continue;

      seenMintsRef.current.add(tk.mint);
      inflightRef.current.add(tk.mint);
      pushLog('info', 'Considering $' + tk.sym + ' · score ' + r.score);

      (async () => {
        try {
          // FIX 5/8: use buildBuyParams and read result.sig
          const buyParams = buildBuyParams(effective.perTradeSol);
          if (!buyParams) throw new Error('Bad buy size');
          const result = await executeSwap({ mode: 'buy', token: tk, swapParams: buyParams });
          if (!result || !result.sig) throw new Error('No signature');
          const entryPriceUsd = tk.price;
          setPositions(prev => [...prev, {
            mint: tk.mint, sym: tk.sym, name: tk.name, icon: tk.icon, ts: Date.now(),
            entryPriceUsd, entrySol: effective.perTradeSol, currentPriceUsd: entryPriceUsd,
            signature: result.sig, exiting: false,
          }]);
          tradeStampsRef.current.push(Date.now());
          setTradesToday(n => n + 1);
          pushLog('buy', 'Bought $' + tk.sym + ' · ' + effective.perTradeSol.toFixed(2) + ' SOL');
          pushToast && pushToast({ type: 'success', em: '✓', body: <>Auto: bought <b>${tk.sym}</b></> });
        } catch (e) {
          pushLog('error', 'Skipped $' + tk.sym + ' · ' + (e.message || 'failed'));
        } finally {
          inflightRef.current.delete(tk.mint);
        }
      })();
      break;
    }
  }, [enabled, paused, recentTokens, effective, solBalance, executeSwap, pushLog, pushToast, setPositions]);

  // Exit loop — TP/SL/timeout.
  // Reads positions/balances/solPrice from refs so the interval is built once
  // per on/off transition (gated on hasPositions) rather than rebuilt on every
  // price tick or balance poll. Depending on `solPrice`/`balances` directly
  // would tear the interval down every 30s and could fire tick() mid-trade.
  const hasPositions = positions.length > 0;
  useEffect(() => {
    if (!hasPositions) return;
    let cancelled = false;
    const tick = async () => {
      const now = Date.now();
      for (const p of positionsRef.current) {
        if (cancelled) return;
        if (p.exiting) continue;
        try {
          const r = await fetch('/api/dex/token/' + encodeURIComponent(p.mint));
          if (!r.ok) continue;
          const d = await r.json();
          const px = Number(d?.token?.price);
          if (!Number.isFinite(px) || px <= 0) continue;
          setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, currentPriceUsd: px } : x));
          const pnlPct = ((px - p.entryPriceUsd) / p.entryPriceUsd) * 100;
          const ageMin = (now - p.ts) / 60000;
          const reason = pnlPct >= effective.takeProfitPct ? 'take-profit'
                       : pnlPct <= -effective.stopLossPct ? 'stop-loss'
                       : ageMin >= SAFETY_FLOOR.maxHoldMin ? 'time-out' : null;
          if (!reason) continue;
          setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: true } : x));
          try {
            const owned = balancesRef.current && balancesRef.current[p.mint];
            if (!owned || !((owned.uiAmount || 0) > 0)) {
              // Balance may not have landed yet (refreshOneToken fires ~800ms
              // after buy; the 30s poll is slower). Don't drop a fresh position
              // as "gone" — wait until it's had time to show up.
              if ((Date.now() - p.ts) < 45000) {
                setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: false } : x));
                continue;
              }
              setPositions(prev => prev.filter(x => x.mint !== p.mint));
              pushLog('info', '$' + p.sym + ' position cleared (no balance)');
              continue;
            }
            const tk = { mint: p.mint, sym: p.sym, name: p.name, icon: p.icon, price: px };
            await executeSwap({ mode: 'sell', token: tk, tradeTokensRaw: BigInt(owned.amount || '0'), tradeTokensUi: owned.uiAmount, decimals: owned.decimals, feeLamports: 0n });
            const exitSol = (owned.uiAmount * px) / (exitSolPriceRef.current || 150);
            const pnlSol = exitSol - (p.entrySol || 0);
            setPositions(prev => prev.filter(x => x.mint !== p.mint));
            setDailyPnlSol(n => n + pnlSol);
            tradeStampsRef.current.push(Date.now());
            pushLog('sell', 'Sold $' + p.sym + ' · ' + reason + ' · ' + formatSolSigned(pnlSol) + ' SOL');
          } catch (e) {
            setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: false } : x));
            pushLog('error', 'Exit failed $' + p.sym + ' · ' + (e.message || 'unknown'));
          }
        } catch (e) {}
      }
    };
    tick();
    const id = setInterval(tick, SAFETY_FLOOR.posPollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [hasPositions, effective, executeSwap, setPositions, pushLog]);

  const flatten = useCallback(async () => {
    setEnabled(false);
    for (const p of positionsRef.current) {
      try {
        const owned = balancesRef.current && balancesRef.current[p.mint];
        if (!owned || !((owned.uiAmount || 0) > 0)) continue;
        const tk = { mint: p.mint, sym: p.sym, name: p.name, icon: p.icon, price: p.currentPriceUsd };
        await executeSwap({ mode: 'sell', token: tk, tradeTokensRaw: BigInt(owned.amount || '0'), tradeTokensUi: owned.uiAmount, decimals: owned.decimals, feeLamports: 0n });
        pushLog('sell', 'Flatten $' + p.sym);
      } catch (e) {
        pushLog('error', 'Flatten failed $' + p.sym);
      }
    }
    setPositions([]);
  }, [executeSwap, setPositions, pushLog]);

  return { enabled, setEnabled, paused, setPaused, mode, setMode, custom, updateCustom, balancedAmount, setBalancedAmount, settings, effective, positions, log, dailyPnlSol, tradesToday, flatten };
}

function Slider({ label, hint, value, min, max, step, suffix, onChange }) {
  return (
    <div className="wa-slider">
      <div className="wa-slider-top">
        <span className="wa-slider-lbl">{label}</span>
        <span className="wa-slider-v">{value}<span className="u">{suffix}</span></span>
      </div>
      {hint ? <div className="wa-slider-desc">{hint}</div> : null}
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function AutoPanel({ open, onClose, auto, solBalance, solPrice }) {
  useEffect(() => { if (!open) return; const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, [open]);
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') onClose && onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;

  const { enabled, setEnabled, paused, setPaused, mode, setMode, settings, custom, updateCustom, balancedAmount, setBalancedAmount, positions, log, dailyPnlSol, tradesToday, flatten } = auto;
  const isCustom = mode === 'custom';
  const s = isCustom ? custom : settings;

  return (
    <div className="wa-root">
      <div className="wa-head">
        <div style={{display:'flex',alignItems:'center',gap:11,cursor:'pointer'}} onClick={onClose}>
          <div style={{width:30,height:30,borderRadius:10,background:'linear-gradient(135deg,#A0E7FF,#FF8FBE)',display:'grid',placeItems:'center',fontFamily:"'Instrument Serif',serif",fontStyle:'italic',fontSize:17,color:'#fff'}}>A</div>
          <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,letterSpacing:'-.015em',color:'#1A1B4E'}}>Ape <em style={{fontStyle:'italic',color:'rgba(26,27,78,0.7)'}}>· auto-trade</em></span>
        </div>
        <div className={'wa-stat-pill ' + (paused ? 'paused' : enabled ? 'on' : 'off')}>
          {enabled && !paused ? <><span className="d" /><span>RUNNING</span></> : paused ? <span>PAUSED · CAP HIT</span> : <span>OFF</span>}
        </div>
        <button className="wa-close" onClick={onClose}>×</button>
      </div>
      <div className="wa-page">
        <div className="wa-eye"><span className="gl">◉</span><span>Auto-trade · alpha</span><span className="rule" /></div>
        <h1 className="wa-h1">Trade <span className="it">while you sleep.</span></h1>
        <p className="wa-sub">A small bot watching the feed. It buys what looks safe by your rules and sells on take-profit, stop-loss, or time-out. <b>Test small first.</b></p>

        {paused ? (
          <div className="wa-pause-banner">
            <span className="gl">⊘</span>
            <div className="t"><div className="h">Auto paused</div><div className="b">Daily loss cap of {SAFETY_FLOOR.dailyLossCapSol} SOL hit. Resume when ready.</div></div>
            <button onClick={() => { setPaused(false); setEnabled(false); }}>RESUME</button>
          </div>
        ) : null}

        <div className={'wa-modes' + (isCustom ? ' custom' : '')}>
          <div className="wa-mode-ind" />
          <button className={'wa-mode-t' + (!isCustom ? ' active' : '')} onClick={() => setMode('balanced')}>Balanced</button>
          <button className={'wa-mode-t' + (isCustom ? ' active' : '')} onClick={() => setMode('custom')}>Custom</button>
        </div>

        <div className={'wa-master' + (enabled && !paused ? ' on' : paused ? ' paused' : '')}>
          <div className="wa-master-l">
            <div className={'wa-master-h' + (enabled && !paused ? ' on' : '')}>{enabled && !paused ? <>Running.</> : paused ? <>Paused.</> : <>Ready when you <span className="it">are.</span></>}</div>
            <div className="wa-master-s">{enabled && !paused ? 'Watching the feed · ' + positions.length + ' open · ' + tradesToday + ' today' : 'Flip when ready'}</div>
          </div>
          <div className={'wa-tog' + (enabled && !paused ? ' on' : '')} onClick={() => { if (paused) return; setEnabled(!enabled); }} />
        </div>

        {isCustom ? (
          <div className="wa-sliders">
            <Slider label="Per-trade SOL" hint="Each buy uses this much SOL. Min 0.03." value={s.perTradeSol} min={0.03} max={2} step={0.01} suffix="SOL" onChange={v => updateCustom({ perTradeSol: v })} />
            <Slider label="Take profit at" value={s.takeProfitPct} min={20} max={500} step={10} suffix="%" onChange={v => updateCustom({ takeProfitPct: v })} hint="Sell when up this much." />
            <Slider label="Stop loss at" value={s.stopLossPct} min={10} max={70} step={5} suffix="%" onChange={v => updateCustom({ stopLossPct: v })} hint="Sell if down this much." />
            <Slider label="Min age" value={s.minAgeMin} min={3} max={20} step={1} suffix="min" onChange={v => updateCustom({ minAgeMin: v })} hint="Skip launches younger than this. 3 min floor." />
            <Slider label="Max age" value={s.maxAgeMin} min={5} max={120} step={5} suffix="min" onChange={v => updateCustom({ maxAgeMin: v })} hint="Skip launches older than this." />
            <Slider label="Min liquidity" value={s.minLiqUsd} min={1000} max={100000} step={1000} suffix="$" onChange={v => updateCustom({ minLiqUsd: v })} hint="Thin pools are hard to exit." />
            <Slider label="Min holders" value={s.minHolders} min={10} max={500} step={10} suffix="" onChange={v => updateCustom({ minHolders: v })} hint="Skip lonely tokens." />
            <Slider label="Min safety score" value={s.minVibe} min={20} max={85} step={5} suffix="/85" onChange={v => updateCustom({ minVibe: v })} hint="Skip worse safety reads than this." />
            <Slider label="Max open" value={s.maxOpen} min={1} max={10} step={1} suffix="" onChange={v => updateCustom({ maxOpen: v })} hint="Hold limit." />
            <Slider label="Max / hour" value={s.maxPerHour} min={1} max={30} step={1} suffix="" onChange={v => updateCustom({ maxPerHour: v })} hint="Trade frequency cap." />
            <div className="wa-floor">
              <b>Safety floors that can't be turned off:</b><br/>
              · Daily loss cap: -{SAFETY_FLOOR.dailyLossCapSol} SOL (auto-pauses)<br/>
              · Max hold time: {SAFETY_FLOOR.maxHoldMin} minutes (force-exits)<br/>
              · Absolute min age: {SAFETY_FLOOR.ageMinAbsolute} minutes
            </div>
          </div>
        ) : (
          <div className="wa-locked-card">
            <div className="wa-locked-eye"><span>§</span><span>Balanced settings</span></div>
            <div className="wa-locked-grid">
              <div className="wa-locked-edit">
              <Slider label="Per-trade SOL" hint="Each auto-buy uses this much SOL. Min 0.03." value={balancedAmount} min={0.03} max={2} step={0.01} suffix="SOL" onChange={v => setBalancedAmount(v)} />
            </div>
              <div className="wa-locked-row"><span className="wa-locked-k">Take profit</span><span className="wa-locked-v gn">{s.takeProfitPct}<span className="u">%</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Stop loss</span><span className="wa-locked-v rd">{s.stopLossPct}<span className="u">%</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min age</span><span className="wa-locked-v">{s.minAgeMin}<span className="u">min</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Max age</span><span className="wa-locked-v">{s.maxAgeMin}<span className="u">min</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min liquidity</span><span className="wa-locked-v">${format(s.minLiqUsd)}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min holders</span><span className="wa-locked-v">{s.minHolders}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min safety</span><span className="wa-locked-v">{s.minVibe}/85</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Max open</span><span className="wa-locked-v">{s.maxOpen}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Max / hour</span><span className="wa-locked-v">{s.maxPerHour}</span></div>
            </div>
          </div>
        )}

        <div className="wa-stats">
          <div className="wa-statc"><div className="wa-statc-l">Today P&L</div><div className={'wa-statc-v ' + (dailyPnlSol > 0 ? 'gn' : dailyPnlSol < 0 ? 'rd' : 'dim')}>{Math.abs(dailyPnlSol) > 0.0001 ? formatSolSigned(dailyPnlSol) : '—'}{Math.abs(dailyPnlSol) > 0.0001 ? <span className="u">SOL</span> : null}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Trades today</div><div className="wa-statc-v">{tradesToday}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Open positions</div><div className="wa-statc-v">{positions.length}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Burner SOL</div><div className="wa-statc-v">{formatSol((solBalance && solBalance.uiAmount) || 0)}<span className="u">SOL</span></div></div>
        </div>

        <div className="wa-pos-frame">
          <div className="wa-section-head"><span>◉ Open positions</span><span className="count">{positions.length}</span></div>
          {positions.length === 0 ? (
            <div className="wa-empty"><span className="gl">∅</span><div className="h">No open <span className="it">positions</span></div><div className="s">When auto-trade fires, positions appear here.</div></div>
          ) : positions.map(p => {
            const c = colorFor(p.mint);
            const pnlPct = p.entryPriceUsd > 0 ? ((p.currentPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100 : 0;
            const pnlSol = (p.entrySol || 0) * (pnlPct / 100);
            const up = pnlPct > 0.01, dn = pnlPct < -0.01;
            const ageMin = Math.floor((Date.now() - p.ts) / 60000);
            return (
              <div className="wa-pos-row" key={p.mint}>
                <div className="wa-pos-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
                <div className="wa-pos-nm">
                  <div className="wa-pos-sym">${p.sym || '???'}</div>
                  <div className="wa-pos-time">{ageMin}min open · {formatSol(p.entrySol || 0)} SOL in</div>
                </div>
                <div className="wa-pos-pnl">
                  <div className={'wa-pos-pnl-v ' + (up ? 'gn' : dn ? 'rd' : '')}>{Math.abs(pnlSol) > 0.0001 ? formatSolSigned(pnlSol) : '—'}</div>
                  <div className={'wa-pos-pnl-p ' + (up ? 'gn' : dn ? 'rd' : '')}>{(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%'}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="wa-log-frame">
          <div className="wa-section-head"><span>§ Event log</span><span className="count">{log.length}</span></div>
          <div className="wa-log-list">
            {log.length === 0 ? (
              <div className="wa-empty"><div className="h">No events yet</div></div>
            ) : log.map(e => (
              <div className="wa-log-row" key={e.id}>
                <span className="wa-log-ts">{new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className={'wa-log-tag ' + e.tag}>{e.tag}</span>
                <span className="wa-log-msg">{e.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="wa-kill">
        <button className="wa-kill-btn stop" disabled={!enabled && !paused} onClick={() => { setEnabled(false); setPaused(false); }}>STOP AUTO</button>
        <button className="wa-kill-btn flat" disabled={positions.length === 0} onClick={flatten}>FLATTEN ALL · {positions.length}</button>
      </div>
    </div>
  );
}
