// Ape.jsx — wonderland//radar — field log + one-tap launch list + stats panel
//
// All-in-one frontend. Includes:
//   - The radar feed (specimen list, vibe check, trade sheet, burner wallet)
//   - The stats panel (referrals, personal P&L, standings) — opens from the
//     "STATS" button in the nav. Same field-log register, same palette.
//
// Backend it talks to: referrals.js mounted on server.js
//   POST /api/ref/register      ?ref= and ?boost= bootstrap
//   GET  /api/ref/lookup        per-trade fee-split config
//   POST /api/ref/log-trade     after each trade confirms
//   GET  /api/ref/stats         referrer dashboard
//   GET  /api/ref/leaderboard   standings (24h/7d/all)
//   GET  /api/ref/pnl           personal field log
//   GET  /share/:wallet         OG-unfurl + redirect with ?ref locked in
//   GET  /api/dex/chart/:mint?tf=5m   NEW — pair price history (see TokenChart)
//
// On-chain fee splitting: 70/30 default (50/50 boosted). The referrer's share
// is a second SystemProgram.transfer instruction in the SAME signed tx as the
// trade. Server never holds funds. No withdraw flow needed.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

/* ============================================================
   CSS — wr- (radar) + wp- (stats panel). One injection.
   ============================================================ */
const WR_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700;800&display=swap');
.wr-root{
  --iris:#0E0B1F; --plum:#19132F; --vapor:#251D43; --vapor2:#312756;
  --line:rgba(244,239,255,.07); --line2:rgba(244,239,255,.16); --line3:rgba(244,239,255,.28);
  --magenta:#FF3D8A; --magenta-glow:rgba(255,61,138,.5);
  --mint:#3DFFC2; --mint-soft:rgba(61,255,194,.12);
  --coral:#FF7A6E; --coral-soft:rgba(255,122,110,.12);
  --cyan:#6BEEFF; --butter:#FFD86B; --lavender:#C9B8FF;
  --ink:#F4EFFF; --ink2:rgba(244,239,255,.62); --ink3:rgba(244,239,255,.38);
  min-height:100vh;color:var(--ink);font-family:'Inter',-apple-system,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;padding-bottom:46px;
  background:
    radial-gradient(900px 600px at 88% -10%,rgba(255,61,138,.10),transparent 55%),
    radial-gradient(700px 500px at -5% 8%,rgba(107,238,255,.08),transparent 55%),
    radial-gradient(800px 600px at 50% 110%,rgba(201,184,255,.06),transparent 60%),
    var(--iris);
  background-attachment:fixed;
}
.wr-root,.wr-root *{box-sizing:border-box}
@keyframes wr-sweep{to{transform:rotate(360deg)}}
@keyframes wr-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes wr-develop{0%{opacity:0;filter:blur(8px) saturate(.3);transform:translateY(-8px);background:rgba(61,255,194,.12)}40%{filter:blur(4px) saturate(.6)}100%{opacity:1;filter:blur(0) saturate(1);transform:translateY(0);background:transparent}}
@keyframes wr-fade{from{opacity:0}to{opacity:1}}
@keyframes wr-sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes wr-pop{0%{opacity:0;transform:scale(.92)}60%{transform:scale(1.02)}100%{opacity:1;transform:scale(1)}}
@keyframes wr-spin{to{transform:rotate(360deg)}}
@keyframes wr-glow{0%,100%{box-shadow:0 0 0 0 rgba(255,61,138,0)}50%{box-shadow:0 0 32px 0 rgba(255,61,138,.25)}}
@keyframes wr-toast{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes wr-confetti{0%{transform:translate(-50%,-50%) rotate(0);opacity:1}100%{transform:translate(calc(-50% + var(--dx,0)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}}
@keyframes wr-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}

.wr-app{max-width:1280px;margin:0 auto;position:relative;z-index:5}
.wr-page{padding:24px 28px 80px}
@media(max-width:768px){.wr-page{padding:16px 14px 80px}}

.wr-nav{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:18px;padding:14px 28px;background:rgba(14,11,31,.7);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--line)}
.wr-brand{display:flex;align-items:center;gap:11px;cursor:pointer}
.wr-radar-icon{position:relative;width:30px;height:30px;border-radius:50%;border:1px solid rgba(107,238,255,.4);background:radial-gradient(circle,rgba(107,238,255,.15),transparent 70%);overflow:hidden;flex-shrink:0}
.wr-radar-icon::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 280deg,var(--cyan) 350deg,transparent 360deg);animation:wr-sweep 3.5s linear infinite;opacity:.7}
.wr-radar-icon::after{content:'';position:absolute;inset:6px;border-radius:50%;border:1px solid rgba(107,238,255,.25)}
.wr-bname{font-family:'Fraunces';font-weight:600;font-size:17px;letter-spacing:-.015em;font-variation-settings:"opsz" 60}
.wr-bname .it{font-style:italic;font-weight:500;color:var(--cyan)}
.wr-bname .sep{opacity:.4;margin:0 4px;font-weight:400}
.wr-nav-eyebrow{margin-left:auto;display:flex;align-items:center;gap:10px;font-family:'JetBrains Mono';font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3)}
.wr-nav-eyebrow .live{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-nav-stats{display:inline-flex;align-items:center;gap:7px;padding:0 14px;min-height:38px;background:var(--vapor);border:1px solid var(--line);border-radius:999px;color:var(--ink);font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;cursor:pointer;transition:.14s}
.wr-nav-stats:hover{border-color:var(--cyan);color:var(--cyan);background:rgba(107,238,255,.08)}
.wr-nav-stats .gl{font-size:11px;color:var(--cyan)}
.wr-nav-wallet{display:flex;align-items:center;gap:9px;padding:8px 14px;background:linear-gradient(135deg,var(--vapor),var(--plum));border:1px solid var(--line2);border-radius:999px;font-family:'JetBrains Mono';font-size:12px;font-weight:700;cursor:pointer;color:var(--ink);position:relative}
.wr-nav-wallet:hover{border-color:var(--line3)}
.wr-nav-wallet .glyph{color:var(--butter);font-weight:800}
.wr-nav-wallet .dot{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.wr-nav-wallet .nudge{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--butter);border:2px solid var(--iris);box-shadow:0 0 6px var(--butter)}
@media(max-width:768px){.wr-nav{padding:12px 14px;gap:10px}.wr-nav-eyebrow{display:none}.wr-nav-stats span:not(.gl){display:none}.wr-nav-stats{padding:0 11px}}

.wr-qbar{position:sticky;top:54px;z-index:55;display:flex;align-items:center;gap:8px;padding:10px 28px;background:rgba(14,11,31,.85);backdrop-filter:blur(18px);border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.wr-qbar::-webkit-scrollbar{display:none}
.wr-qlabel{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--ink3);flex-shrink:0;display:flex;align-items:center;gap:6px}
.wr-qlabel .b{color:var(--magenta)}
.wr-qamt{flex-shrink:0;display:flex;align-items:center;gap:5px;padding:6px 13px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);color:var(--ink2);font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;cursor:pointer;transition:.12s}
.wr-qamt:hover{color:var(--ink);border-color:var(--line2)}
.wr-qamt.active{background:var(--magenta);color:#1B0410;border-color:transparent;box-shadow:0 4px 16px -4px var(--magenta-glow)}
.wr-qamt .s{opacity:.55;font-size:11px}
.wr-qamt.active .s{opacity:.7;color:#1B0410}
.wr-qedit{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:var(--vapor);border:1px solid var(--line);display:grid;place-items:center;color:var(--ink2);font-size:13px;cursor:pointer}
.wr-qedit:hover{color:var(--cyan);border-color:rgba(107,238,255,.35)}
.wr-qfast{flex-shrink:0;margin-left:auto;display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:.6px;color:var(--mint);background:var(--mint-soft);padding:6px 11px;border-radius:999px;white-space:nowrap}
.wr-qfast .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.3s infinite}
@media(max-width:768px){.wr-qbar{padding:9px 14px}}

.wr-field-log{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink3);display:flex;align-items:center;gap:10px;margin-bottom:14px}
.wr-field-log .rule{flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent);max-width:200px}
.wr-field-log .glyph{color:var(--cyan);font-size:14px}

.wr-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:4px 0 22px;border-bottom:1px solid var(--line);margin-bottom:22px;flex-wrap:wrap}
.wr-hero h1{font-family:'Fraunces';font-weight:500;font-size:46px;line-height:1;letter-spacing:-.025em;font-variation-settings:"opsz" 144;max-width:680px;margin:0}
.wr-hero h1 .it{font-style:italic;font-weight:400;color:var(--cyan)}
.wr-hero-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.wr-btn-ape{display:inline-flex;align-items:center;gap:9px;padding:13px 22px;border-radius:13px;border:none;cursor:pointer;background:var(--magenta);color:#1B0410;font-family:inherit;font-weight:700;font-size:13.5px;letter-spacing:.2px;box-shadow:0 8px 28px -8px var(--magenta-glow);transition:transform .12s,box-shadow .2s}
.wr-btn-ape:hover{transform:translateY(-1px);box-shadow:0 12px 36px -8px var(--magenta-glow)}
.wr-btn-ape .arrow{font-family:'JetBrains Mono';font-weight:800}
.wr-no-connect{display:inline-flex;align-items:center;gap:7px;font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:.6px;color:var(--mint);padding:6px 11px;border-radius:999px;background:var(--mint-soft);border:1px solid rgba(61,255,194,.2)}
@media(max-width:768px){.wr-hero h1{font-size:32px}.wr-hero{flex-direction:column;align-items:flex-start;gap:14px}}

/* ── NEW: Returning-user lure (replaces hero+offers for repeat visits) ── */
.wr-lure{display:flex;align-items:center;gap:14px;padding:14px 0 16px;border-bottom:1px solid var(--line);margin-bottom:18px;animation:wr-rise .35s cubic-bezier(.2,1,.3,1)}
.wr-lure-text{flex:1;min-width:0}
.wr-lure-h{font-family:'Fraunces';font-weight:500;font-size:24px;letter-spacing:-.015em;line-height:1.1;font-variation-settings:"opsz" 96}
.wr-lure-h .it{font-style:italic;font-weight:400;color:var(--cyan)}
.wr-lure-s{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink3);margin-top:5px}
.wr-lure-s b{color:var(--mint);font-weight:800}
.wr-lure-intro{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--ink2);background:var(--vapor);border:1px solid var(--line);padding:8px 12px;border-radius:8px;flex-shrink:0;cursor:pointer;transition:.14s}
.wr-lure-intro:hover{color:var(--cyan);border-color:rgba(107,238,255,.32)}
.wr-lure-close{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:var(--vapor);border:1px solid var(--line);color:var(--ink2);font-family:initial;font-size:14px;cursor:pointer;flex-shrink:0}
.wr-lure-close:hover{color:var(--ink);border-color:var(--line2)}
@media(max-width:768px){.wr-lure-h{font-size:20px}.wr-lure-s{font-size:9.5px}}

/* ── NEW: Open positions strip ── */
.wr-positions{background:linear-gradient(135deg,rgba(155,123,255,.10),rgba(25,19,47,.7));border:1px solid rgba(155,123,255,.25);border-radius:16px;overflow:hidden;margin-bottom:22px;animation:wr-rise .4s cubic-bezier(.2,1,.3,1)}
.wr-positions-head{padding:11px 16px 8px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.wr-positions-head .e{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--lavender)}
.wr-positions-head .roll{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink2)}
.wr-positions-head .roll b{color:var(--mint);font-weight:800}
.wr-positions-head .roll b.dn{color:var(--coral)}
.wr-pos-strip-row{padding:8px 16px;display:flex;align-items:center;gap:12px;border-top:1px solid rgba(155,123,255,.12)}
.wr-pos-strip-av{flex-shrink:0;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font-family:'Fraunces';font-weight:700;font-size:11px;color:#fff;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.wr-pos-strip-av img{width:100%;height:100%;object-fit:cover}
.wr-pos-strip-sym{font-family:'Fraunces';font-weight:600;font-size:13.5px;letter-spacing:-.005em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-pos-strip-pnl{font-family:'JetBrains Mono';font-weight:700;font-size:12px;color:var(--mint);letter-spacing:.2px}
.wr-pos-strip-pnl.dn{color:var(--coral)}
.wr-pos-strip-pnl.dim{color:var(--ink3);font-weight:500}
.wr-pos-strip-pct{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;color:var(--ink2);min-width:50px;text-align:right;letter-spacing:.2px}
.wr-pos-strip-pct.up{color:var(--mint)}
.wr-pos-strip-pct.dn{color:var(--coral)}
.wr-positions-foot{padding:8px 16px 10px;font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--lavender);text-align:right;border-top:1px solid rgba(155,123,255,.12);cursor:pointer;background:none;border-left:none;border-right:none;border-bottom:none;width:100%;display:block}
.wr-positions-foot:hover{color:var(--ink)}

.wr-offer-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
.wr-offer{position:relative;overflow:hidden;background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.6));border:1px solid var(--line);border-radius:18px;padding:22px 22px 20px;transition:border-color .2s}
.wr-offer:hover{border-color:var(--line2)}
.wr-offer::before{content:'';position:absolute;top:-40%;right:-30%;width:90%;height:90%;background:radial-gradient(circle,var(--wr-acc-bg,rgba(107,238,255,.08)),transparent 55%);pointer-events:none}
.wr-offer-num{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.4px;color:var(--wr-acc-c,var(--cyan));text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:9px}
.wr-offer-num .glyph{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--wr-acc-bg-strong,rgba(107,238,255,.1));border:1px solid var(--wr-acc-border,rgba(107,238,255,.22));font-size:13px;color:var(--wr-acc-c,var(--cyan))}
.wr-offer h3{font-family:'Fraunces';font-weight:500;font-size:22px;line-height:1.1;letter-spacing:-.015em;margin:0 0 8px;font-variation-settings:"opsz" 96}
.wr-offer h3 .it{font-style:italic;font-weight:400;color:var(--wr-acc-c,var(--cyan))}
.wr-offer p{font-size:13px;line-height:1.5;color:var(--ink2);font-weight:400;margin:0}
.wr-offer p b{color:var(--ink);font-weight:600}
.wr-offer.o1{--wr-acc-c:var(--magenta);--wr-acc-bg:rgba(255,61,138,.10);--wr-acc-bg-strong:rgba(255,61,138,.12);--wr-acc-border:rgba(255,61,138,.24);animation:wr-glow 3.4s ease-in-out infinite}
.wr-offer.o2{--wr-acc-c:var(--cyan);--wr-acc-bg:rgba(107,238,255,.08);--wr-acc-bg-strong:rgba(107,238,255,.1);--wr-acc-border:rgba(107,238,255,.22)}
.wr-offer.o3{--wr-acc-c:var(--mint);--wr-acc-bg:rgba(61,255,194,.08);--wr-acc-bg-strong:rgba(61,255,194,.1);--wr-acc-border:rgba(61,255,194,.22)}
.wr-offer .mini-radar{position:absolute;right:18px;bottom:18px;width:54px;height:54px;border-radius:50%;border:1px solid rgba(61,255,194,.25);background:radial-gradient(circle,rgba(61,255,194,.08),transparent 70%);overflow:hidden}
.wr-offer .mini-radar::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 280deg,rgba(61,255,194,.5) 350deg,transparent 360deg);animation:wr-sweep 4s linear infinite}
.wr-offer .mini-radar::after{content:'';position:absolute;inset:10px;border-radius:50%;border:1px solid rgba(61,255,194,.2)}
.wr-offer .mini-radar .b{position:absolute;width:5px;height:5px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.wr-offer .mini-radar .b1{left:30%;top:32%;animation:wr-pulse 1.6s infinite}
.wr-offer .mini-radar .b2{left:62%;top:54%;animation:wr-pulse 2s .4s infinite}
@media(max-width:900px){.wr-offer-strip{grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}.wr-offer.o3{grid-column:1/-1}}
@media(max-width:560px){.wr-offer-strip{grid-template-columns:1fr}.wr-offer h3{font-size:19px}.wr-offer{padding:18px}}

.wr-list-frame{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:20px;overflow:hidden;margin-bottom:22px}
.wr-list-head{padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.wr-list-title{display:flex;flex-direction:column;gap:2px}
.wr-list-title .e{font-family:'JetBrains Mono';font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--cyan)}
.wr-list-title .t{font-family:'Fraunces';font-weight:500;font-size:24px;letter-spacing:-.015em}
.wr-list-title .t .it{font-style:italic;color:var(--ink2);font-weight:400}

/* ── NEW: Sort bar (replaces wr-list-filters) ── */
.wr-sortbar{padding:10px 22px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.wr-sortbar::-webkit-scrollbar{display:none}
.wr-sortbar .label{font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3);margin-right:4px;flex-shrink:0}
.wr-sortbar .wr-chip{flex-shrink:0}
.wr-filter-btn{flex-shrink:0;margin-left:auto;display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:10px;background:var(--vapor);border:1px solid var(--line2);font-family:inherit;font-size:11.5px;font-weight:600;color:var(--ink);cursor:pointer;transition:.14s}
.wr-filter-btn:hover{background:var(--vapor2);border-color:var(--line3)}
.wr-filter-btn.on{border-color:var(--magenta);color:var(--ink)}
.wr-filter-btn .ct{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--magenta);color:#1B0410;font-family:'JetBrains Mono';font-weight:800;font-size:9.5px;letter-spacing:.3px}
.wr-list-filters{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.wr-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);font-family:inherit;font-size:11.5px;font-weight:500;color:var(--ink2);cursor:pointer;transition:.15s}
.wr-chip:hover{color:var(--ink);border-color:var(--line2)}
.wr-chip.on{background:rgba(107,238,255,.1);border-color:rgba(107,238,255,.3);color:var(--cyan)}

.wr-list{padding:6px 0}
.wr-row{display:grid;grid-template-columns:48px 1fr 80px 90px 100px 100px 110px 100px 130px;gap:14px;align-items:center;padding:14px 22px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .2s;position:relative;animation:wr-pop .4s cubic-bezier(.2,1.2,.4,1) backwards}
.wr-row:last-child{border-bottom:none}
.wr-row:hover{background:rgba(244,239,255,.025)}
.wr-row.fresh{animation:wr-develop .8s cubic-bezier(.2,1,.3,1)}
.wr-row.thead{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3);padding:12px 22px;cursor:default;background:rgba(0,0,0,.15);animation:none}
.wr-row.thead:hover{background:rgba(0,0,0,.15)}
.wr-row-num{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.5px}
.wr-row-tk{display:flex;align-items:center;gap:12px;min-width:0}
.wr-av{width:38px;height:38px;border-radius:11px;flex-shrink:0;display:grid;place-items:center;font-family:'Fraunces';font-weight:700;font-size:15px;color:#fff;text-transform:uppercase;box-shadow:0 4px 14px rgba(0,0,0,.3);overflow:hidden;position:relative}
.wr-av img{width:100%;height:100%;object-fit:cover}
.wr-name{min-width:0;flex:1}
.wr-sym-row{font-family:'Fraunces';font-weight:600;font-size:15px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-sym-row .chg{font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;color:var(--mint)}
.wr-sym-row .chg.dn{color:var(--coral)}
.wr-full{font-size:11.5px;color:var(--ink2);font-weight:400;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-full .dex{color:var(--ink3);font-family:'JetBrains Mono';font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-left:6px}
/* NEW: Mobile-only second line (price · age · MC) */
.wr-mob-meta{display:none;font-family:'JetBrains Mono';font-size:10.5px;font-weight:600;color:var(--ink2);margin-top:3px;letter-spacing:.15px;align-items:center;gap:6px;overflow:hidden;white-space:nowrap}
.wr-mob-meta .price{color:var(--ink);font-weight:700}
.wr-mob-meta .mob-age{color:var(--mint);font-weight:700}
.wr-mob-meta .mob-age.med{color:var(--lavender)}
.wr-mob-meta .mob-age.old{color:var(--ink3)}
.wr-mob-meta .dot{color:var(--ink3);opacity:.5}
.wr-num{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--ink)}
.wr-num.dim{color:var(--ink2);font-weight:500}
.wr-age{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--mint)}
.wr-age.med{color:var(--lavender)}
.wr-age.old{color:var(--ink3)}
.wr-risk{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:7px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:.3px}
.wr-risk.low{background:var(--mint-soft);color:var(--mint)}
.wr-risk.med{background:rgba(255,216,107,.1);color:var(--butter)}
.wr-risk.high{background:var(--coral-soft);color:var(--coral)}
.wr-risk-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.wr-curve{display:flex;align-items:center;gap:8px}
.wr-curve-bar{flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden}
.wr-curve-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--butter),var(--mint));border-radius:99px}
.wr-curve-pct{font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;color:var(--ink2);min-width:32px;text-align:right}
.wr-row-actions{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.wr-btn-spec{padding:8px 13px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:12px;background:var(--magenta);color:#1B0410;display:inline-flex;align-items:center;gap:6px;box-shadow:0 4px 14px -5px var(--magenta-glow);transition:transform .1s,box-shadow .2s}
.wr-btn-spec:hover{transform:translateY(-1px);box-shadow:0 6px 18px -5px var(--magenta-glow)}
.wr-btn-spec:disabled{opacity:.6;cursor:wait}
.wr-btn-spec .arrow{font-family:'JetBrains Mono';font-weight:800;font-size:11px}
.wr-spinner{width:12px;height:12px;border-radius:50%;border:2px solid rgba(27,4,16,.3);border-top-color:#1B0410;animation:wr-spin .7s linear infinite;display:inline-block}
.wr-owned-mark{font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:.5px;padding:2px 7px;border-radius:5px;background:var(--mint-soft);color:var(--mint);text-transform:uppercase}
.wr-list-foot{padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.7px;text-transform:uppercase;border-top:1px solid var(--line)}
.wr-list-foot .live{display:inline-flex;align-items:center;gap:7px;color:var(--mint)}
.wr-list-foot .live .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-list-foot .live.warn{color:var(--butter)}
.wr-list-foot .live.warn .d{background:var(--butter);box-shadow:0 0 10px var(--butter)}
@media(max-width:1100px){.wr-row{grid-template-columns:40px 1fr 70px 80px 90px 100px 120px;gap:10px;padding:12px 16px}.wr-row.thead{padding:10px 16px}.wr-col-vol,.wr-col-holders{display:none}}
/* ── NEW: Mobile row override — flex layout with 2-line stack ── */
@media(max-width:720px){
  .wr-row{display:flex;grid-template-columns:none;align-items:center;gap:11px;padding:11px 14px}
  .wr-row.thead{display:none}
  .wr-row-tk{flex:1;min-width:0;gap:11px}
  .wr-row-actions{flex-shrink:0;margin-left:0}
  .wr-col-num,.wr-col-liq,.wr-col-vol,.wr-col-holders,.wr-col-curve{display:none}
  .wr-row > .wr-age{display:none}
  .wr-row > .wr-num{display:none}
  .wr-full{display:none}
  .wr-mob-meta{display:flex}
  .wr-av{width:36px;height:36px;font-size:14px;border-radius:10px}
  .wr-sym-row{font-size:14px}
}

.wr-proof{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px 22px;border-radius:18px;background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.4));border:1px solid var(--line)}
.wr-proof .e{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--ink3);display:flex;align-items:center;gap:8px}
.wr-proof .e .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-proof-div{width:1px;height:24px;background:var(--line2)}
.wr-proof-stat{display:flex;align-items:baseline;gap:8px;font-family:'Fraunces';font-weight:500;letter-spacing:-.01em}
.wr-proof-stat .v{font-size:20px}
.wr-proof-stat .v .it{font-style:italic;color:var(--ink2)}
.wr-proof-stat .k{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;color:var(--ink2);letter-spacing:.6px;text-transform:uppercase}
.wr-proof-stat .m{font-family:'JetBrains Mono';font-size:11px;font-weight:800;color:var(--mint);margin-left:4px}
.wr-proof-stat .m.dn{color:var(--coral)}
@media(max-width:768px){.wr-proof{flex-direction:column;align-items:flex-start;gap:10px;padding:14px 16px}.wr-proof-div{display:none}.wr-proof-stat .v{font-size:17px}}

.wr-empty{padding:48px 24px;text-align:center;color:var(--ink2);font-size:14px}
.wr-empty .glyph{display:block;font-size:42px;margin-bottom:12px;opacity:.5;font-family:'Fraunces';font-style:italic}
.wr-empty b{color:var(--ink);font-weight:600;font-family:'Fraunces';font-weight:500;font-size:18px}
.wr-empty .sub{font-size:12.5px;margin-top:6px;color:var(--ink3)}
.wr-empty .err{margin-top:10px;font-family:'JetBrains Mono';font-size:10px;color:var(--coral);background:var(--coral-soft);padding:7px 12px;border-radius:10px;display:inline-block}

.wr-overlay{position:fixed;inset:0;background:rgba(4,4,12,.66);backdrop-filter:blur(8px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:wr-fade .2s}
.wr-overlay.center{align-items:center;padding:18px}
.wr-sheet{width:100%;max-width:520px;background:linear-gradient(180deg,var(--vapor),var(--plum));border:1px solid var(--line2);border-radius:22px 22px 0 0;box-shadow:0 -20px 60px rgba(0,0,0,.7);animation:wr-sheet .3s cubic-bezier(.2,1.2,.4,1);max-height:92dvh;overflow-y:auto}
.wr-sheet.mini{border-radius:22px;animation:wr-pop .3s ease;max-width:430px}
.wr-x{position:absolute;top:14px;right:14px;background:var(--vapor);border:1px solid var(--line);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-family:initial;font-size:16px;color:var(--ink2);z-index:2}
.wr-x:hover{color:var(--ink);border-color:var(--line2)}

.wr-tshead{padding:22px 22px 4px;position:relative}
.wr-tshead-row{display:flex;align-items:center;gap:13px;padding-right:38px}
.wr-tshead .wr-av{width:54px;height:54px;border-radius:14px;font-size:20px}
.wr-tshead .title{flex:1;min-width:0}
.wr-tshead .sym{font-family:'Fraunces';font-weight:500;font-size:26px;letter-spacing:-.02em;line-height:1;font-variation-settings:"opsz" 96}
.wr-tshead .sub{font-family:'JetBrains Mono';font-size:11px;color:var(--ink2);font-weight:600;margin-top:4px}

/* ── NEW: Token chart (inside TradeSheet header) ── */
.wr-chart-wrap{margin:14px 22px 0;padding:12px 0 6px;border-top:1px solid var(--line)}
.wr-chart{position:relative;width:100%;height:84px;display:block}
.wr-chart svg{display:block;width:100%;height:100%}
.wr-chart-empty{height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center}
.wr-chart-empty .radar-mini{width:30px;height:30px;border-radius:50%;border:1px solid rgba(201,184,255,.4);background:radial-gradient(circle,rgba(201,184,255,.15),transparent 70%);position:relative;overflow:hidden}
.wr-chart-empty .radar-mini::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 280deg,var(--lavender) 350deg,transparent 360deg);animation:wr-sweep 3.5s linear infinite;opacity:.7}
.wr-chart-empty .radar-mini::after{content:'';position:absolute;inset:5px;border-radius:50%;border:1px solid rgba(201,184,255,.25)}
.wr-chart-empty .em-h{font-family:'Fraunces';font-style:italic;font-weight:400;font-size:13.5px;color:var(--ink2);letter-spacing:-.005em;line-height:1.2}
.wr-chart-empty .em-s{font-family:'JetBrains Mono';font-size:9px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:var(--ink3)}
.wr-chart-loading{height:84px;display:grid;place-items:center}
.wr-chart-loading .sp{width:14px;height:14px;border-radius:50%;border:2px solid rgba(244,239,255,.18);border-top-color:var(--cyan);animation:wr-spin .8s linear infinite}
.wr-tf-pills{display:flex;align-items:center;gap:4px;margin-top:6px;padding:0 2px}
.wr-tf{flex:0 0 auto;padding:4px 10px;border:none;background:transparent;font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:.7px;color:var(--ink3);border-radius:7px;transition:.12s;cursor:pointer}
.wr-tf:hover{color:var(--ink2)}
.wr-tf.on{background:var(--vapor2);color:var(--ink)}
.wr-tf.on.up{color:var(--mint)}
.wr-tf.on.dn{color:var(--coral)}
.wr-tf:disabled{opacity:.4;cursor:default}
.wr-tf:disabled:hover{color:var(--ink3)}
.wr-tf-meta{margin-left:auto;font-family:'JetBrains Mono';font-size:8.5px;font-weight:700;letter-spacing:.6px;color:var(--ink3);text-transform:uppercase}

.wr-vibe{margin:14px 22px 0;background:rgba(0,0,0,.2);border:1px solid var(--line);border-radius:14px;padding:13px 15px}
.wr-vibe.amber{border-color:rgba(255,216,107,.2);background:rgba(255,216,107,.06)}
.wr-vibe.red{border-color:rgba(255,122,110,.22);background:var(--coral-soft)}
.wr-vibe-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.wr-vibe-l{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3)}
.wr-vibe-s{font-family:'Fraunces';font-weight:500;font-size:24px;line-height:1;display:flex;align-items:baseline;gap:3px}
.wr-vibe-s .of{font-size:12px;color:var(--ink3);font-weight:500}
.wr-vibe-verdict{font-weight:600;font-size:14px;line-height:1.35;margin-bottom:10px}
.wr-vibe-chks{display:flex;flex-wrap:wrap;gap:6px}
.wr-chk{font-family:'JetBrains Mono';font-size:9.5px;font-weight:700;padding:4px 9px;border-radius:999px}
.wr-chk.ok{background:var(--mint-soft);color:var(--mint)}
.wr-chk.cau{background:rgba(255,216,107,.12);color:var(--butter)}
.wr-chk.bad{background:var(--coral-soft);color:var(--coral)}
.wr-dyor{font-family:'JetBrains Mono';font-size:9.5px;color:var(--ink3);padding:8px 22px 0;font-weight:600;line-height:1.5}

.wr-mode-tabs{display:grid;grid-template-columns:1fr 1fr;margin:14px 22px;background:rgba(0,0,0,.25);border-radius:12px;padding:3px;position:relative}
.wr-mode-ind{position:absolute;top:3px;bottom:3px;width:calc(50% - 3px);background:var(--magenta);border-radius:10px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1;box-shadow:0 4px 14px -4px var(--magenta-glow)}
.wr-mode-tabs.sell .wr-mode-ind{transform:translateX(100%);background:var(--coral);box-shadow:0 4px 14px -4px rgba(255,122,110,.5)}
.wr-mode-tab{padding:11px 0;text-align:center;font-family:'Fraunces';font-weight:500;font-size:14px;letter-spacing:.5px;color:var(--ink2);border:none;background:none;cursor:pointer;position:relative;z-index:2}
.wr-mode-tab.active{color:#1B0410}
.wr-mode-tabs.sell .wr-mode-tab.active{color:#2E0009}

.wr-field{background:rgba(0,0,0,.2);border:1px solid var(--line);border-radius:14px;padding:13px 14px;margin:0 22px}
.wr-field-row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.wr-field-l{font-family:'JetBrains Mono';font-size:9.5px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--ink3)}
.wr-field-bal{font-family:'JetBrains Mono';font-size:10.5px;font-weight:600;color:var(--ink2);display:flex;align-items:center;gap:8px}
.wr-field-bal b{color:var(--ink);font-weight:700}
.wr-field-max{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;color:var(--lavender);padding:3px 7px;border-radius:5px;letter-spacing:.5px;background:rgba(201,184,255,.1);border:1px solid rgba(201,184,255,.2);cursor:pointer}
.wr-field-row2{display:flex;align-items:center;gap:11px}
.wr-field-chip{display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:var(--vapor2);font-weight:600;font-size:13px;font-family:inherit;flex-shrink:0}
.wr-field-chip .lg{width:22px;height:22px;border-radius:50%;background:var(--plum);display:grid;place-items:center;font-size:11px;color:var(--butter);font-weight:800;overflow:hidden}
.wr-field-chip .lg img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.wr-field-amt{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:'Fraunces';font-weight:500;font-size:24px;text-align:right;width:100%;min-width:0;letter-spacing:-.01em}
.wr-field-amt::placeholder{color:var(--ink3)}

.wr-presets{display:flex;gap:6px;margin:10px 22px 0;overflow-x:auto;scrollbar-width:none}
.wr-presets::-webkit-scrollbar{display:none}
.wr-preset{flex-shrink:0;padding:7px 13px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);color:var(--ink2);font-family:'JetBrains Mono';font-weight:700;font-size:11px;cursor:pointer;letter-spacing:.3px}
.wr-preset:hover{color:var(--ink);border-color:var(--line2)}
.wr-preset.on{background:var(--magenta);color:#1B0410;border-color:transparent}
.wr-preset.on.sell{background:var(--coral);color:#2E0009}

.wr-summary{margin:12px 22px 0;padding:11px 14px;background:rgba(0,0,0,.2);border-radius:12px;font-family:'JetBrains Mono';font-size:11px;display:flex;flex-direction:column;gap:6px}
.wr-sum{display:flex;justify-content:space-between;gap:8px;font-weight:700}
.wr-sum .k{color:var(--ink3);font-weight:500}
.wr-sum .v{color:var(--ink);font-weight:700;text-align:right}
.wr-sum .v.good{color:var(--mint)}
.wr-banner{margin:12px 22px 0;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid rgba(255,122,110,.32);background:var(--coral-soft);color:var(--coral)}
.wr-confirm{width:calc(100% - 44px);margin:14px 22px 0;padding:15px 0;border:none;border-radius:14px;font-family:'Fraunces';font-weight:500;font-size:14.5px;letter-spacing:-.005em;cursor:pointer;background:var(--magenta);color:#1B0410;box-shadow:0 10px 28px -10px var(--magenta-glow);transition:transform .12s}
.wr-confirm:hover:not(:disabled){transform:translateY(-1px)}
.wr-confirm.sell{background:var(--coral);color:#2E0009;box-shadow:0 10px 28px -10px rgba(255,122,110,.5)}
.wr-confirm:disabled{opacity:.45;cursor:not-allowed;background:var(--vapor2);color:var(--ink2);box-shadow:none}
.wr-tfoot{margin:10px 22px 22px;font-family:'JetBrains Mono';font-size:9.5px;color:var(--ink3);text-align:center;font-weight:600;letter-spacing:.5px;text-transform:uppercase}

.wr-balcard{background:linear-gradient(135deg,var(--vapor2),rgba(155,123,255,.12));border:1px solid rgba(155,123,255,.25);border-radius:18px;padding:18px;text-align:center;margin-bottom:13px}
.wr-ballbl{font-family:'JetBrains Mono';font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink3);font-weight:800}
.wr-balval{font-family:'Fraunces';font-weight:500;font-size:33px;margin-top:6px;letter-spacing:-.02em}
.wr-balval .u{font-size:17px;color:var(--ink2)}
.wr-balusd{font-family:'JetBrains Mono';font-size:12px;color:var(--ink2);font-weight:700;margin-top:2px}
.wr-wgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}
.wr-wact{padding:13px 0;border-radius:13px;border:1px solid var(--line);background:var(--vapor);color:var(--ink);font-family:inherit;font-weight:600;font-size:13px;cursor:pointer}
.wr-wact.primary{background:var(--magenta);color:#1B0410;border-color:transparent;box-shadow:0 4px 14px -4px var(--magenta-glow)}
.wr-block{background:var(--vapor);border-radius:14px;padding:13px 14px;margin-bottom:11px}
.wr-block-l{font-family:'JetBrains Mono';font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3);font-weight:800;margin-bottom:8px}
.wr-qr{display:grid;place-items:center;margin-bottom:11px}
.wr-qr canvas,.wr-qr img{border-radius:12px;background:#fff;padding:8px;width:160px;height:160px}
.wr-addr{display:flex;align-items:center;gap:8px}
.wr-addr-v{flex:1;font-family:'JetBrains Mono';font-size:12px;color:var(--ink);font-weight:600;word-break:break-all;line-height:1.4}
.wr-copy{flex-shrink:0;background:var(--vapor2);border:none;color:var(--ink2);border-radius:9px;padding:8px 12px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;cursor:pointer}
.wr-input{width:100%;padding:11px 13px;border-radius:11px;background:var(--vapor2);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-size:13px;font-weight:600;outline:none;margin-bottom:8px}
.wr-input:focus{border-color:var(--cyan)}
.wr-go{width:100%;padding:13px 0;border:none;border-radius:12px;font-family:inherit;font-weight:600;font-size:13.5px;cursor:pointer;background:var(--magenta);color:#1B0410;box-shadow:0 4px 14px -4px var(--magenta-glow)}
.wr-go:disabled{opacity:.5;cursor:not-allowed;background:var(--vapor2);color:var(--ink2);box-shadow:none}
.wr-secret{font-family:'JetBrains Mono';font-size:11px;color:var(--butter);word-break:break-all;line-height:1.5;background:rgba(255,216,107,.06);border:1px dashed rgba(255,216,107,.3);border-radius:10px;padding:11px 12px}
.wr-warn{font-family:'JetBrains Mono';font-size:10px;color:var(--butter);background:rgba(255,216,107,.08);border-radius:12px;padding:10px 12px;line-height:1.55;font-weight:600;margin-bottom:11px}
.wr-warn b{color:var(--butter)}
.wr-nc{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--mint);background:var(--mint-soft);padding:4px 11px;border-radius:999px}

.wr-echips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.wr-echip{display:inline-flex;align-items:center;gap:7px;padding:8px 8px 8px 14px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700}
.wr-echip .x{width:19px;height:19px;border-radius:50%;background:var(--coral-soft);color:var(--coral);border:none;cursor:pointer;font-size:12px;display:grid;place-items:center;font-family:initial}
.wr-eadd{display:flex;gap:6px;align-items:center}
.wr-eadd input{width:74px;padding:8px 12px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700;color:var(--ink);outline:none}
.wr-eadd .plus{width:30px;height:30px;border-radius:50%;background:var(--magenta);color:#1B0410;border:none;cursor:pointer;font-size:17px;font-family:initial}
.wr-sec-lbl{font-family:'JetBrains Mono';font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--ink3);margin:16px 0 9px}
.wr-esave{width:100%;margin-top:18px;padding:14px 0;border:none;border-radius:13px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;background:var(--magenta);color:#1B0410;box-shadow:0 6px 18px -6px var(--magenta-glow)}

/* ── NEW: Filters modal rows ── */
.wr-filter-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.wr-filter-row:last-child{border-bottom:none}
.wr-filter-row .lbl{font-family:'Fraunces';font-weight:500;font-size:15px;letter-spacing:-.005em}
.wr-filter-row .lbl-sub{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.3px;margin-top:3px;text-transform:none}
.wr-toggle{position:relative;width:48px;height:28px;border-radius:999px;background:var(--vapor2);border:1px solid var(--line2);cursor:pointer;transition:.2s;flex-shrink:0}
.wr-toggle::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:var(--ink);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.wr-toggle.on{background:var(--magenta);border-color:transparent}
.wr-toggle.on::after{transform:translateX(20px);background:#1B0410}
.wr-liq-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.wr-liq-chip{padding:6px 12px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);color:var(--ink2);font-family:'JetBrains Mono';font-weight:700;font-size:11px;cursor:pointer}
.wr-liq-chip.on{background:var(--magenta);color:#1B0410;border-color:transparent}

.wr-toasts{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:1100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.wr-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:14px;backdrop-filter:blur(20px);box-shadow:0 12px 32px rgba(0,0,0,.5);animation:wr-toast .3s ease;font-size:13px;font-weight:500;border:1px solid var(--line2)}
.wr-toast.success{background:linear-gradient(135deg,rgba(25,19,47,.95),rgba(61,255,194,.22));border-color:rgba(61,255,194,.4)}
.wr-toast.error{background:linear-gradient(135deg,rgba(25,19,47,.95),rgba(255,122,110,.2));border-color:rgba(255,122,110,.4)}
.wr-toast.info{background:rgba(25,19,47,.95)}
.wr-toast .em{font-size:21px;flex-shrink:0}
.wr-toast .tb{flex:1;min-width:0;line-height:1.35}
.wr-toast .tb b{font-weight:700}
.wr-toast .ta{display:flex;gap:5px;flex-shrink:0}
.wr-taction{background:var(--vapor);border:1px solid var(--line);color:var(--ink);padding:6px 10px;border-radius:9px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;letter-spacing:.4px}
.wr-taction.tw{background:linear-gradient(135deg,rgba(107,238,255,.28),rgba(61,255,194,.28));border-color:rgba(107,238,255,.4)}
.wr-taction svg{width:11px;height:11px}

.wr-confetti{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}
.wr-cpiece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:wr-confetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}

/* ── STATS PANEL (wp-) — committed field-log register ──────── */
.wp-root{
  --ink2x:rgba(244,239,255,.66); --ink3x:rgba(244,239,255,.42);
  position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;
  color:var(--ink);font-family:'Inter',-apple-system,system-ui,sans-serif;
  background:
    radial-gradient(900px 600px at 88% -10%,rgba(255,61,138,.10),transparent 55%),
    radial-gradient(700px 500px at -5% 8%,rgba(107,238,255,.08),transparent 55%),
    radial-gradient(800px 600px at 50% 110%,rgba(201,184,255,.06),transparent 60%),
    var(--iris);
  animation:wr-fade .25s ease;
}
.wp-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;padding:18px 28px;background:rgba(14,11,31,.82);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--line)}
.wp-headlbl{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink2x);margin-left:auto;display:flex;align-items:center;gap:9px}
.wp-headlbl .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.4s infinite}
.wp-close{width:44px;height:44px;border-radius:12px;background:var(--vapor);border:1px solid var(--line);display:grid;place-items:center;cursor:pointer;color:var(--ink2x);font-size:18px;transition:.15s;font-family:initial}
.wp-close:hover{color:var(--ink);border-color:var(--line2);background:var(--vapor2)}
@media(max-width:768px){.wp-head{padding:14px 16px;gap:12px}.wp-headlbl{display:none}}

.wp-tabs{position:sticky;top:67px;z-index:4;display:flex;gap:0;padding:0 28px;background:rgba(14,11,31,.82);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.wp-tabs::-webkit-scrollbar{display:none}
.wp-tab{flex-shrink:0;padding:18px 22px;border:none;background:none;cursor:pointer;font-family:'Fraunces';font-weight:500;font-size:16px;letter-spacing:-.005em;color:var(--ink2x);position:relative;transition:color .2s;border-bottom:2px solid transparent;display:flex;align-items:center;gap:10px;min-height:54px}
.wp-tab .glyph{font-family:'JetBrains Mono';font-size:11px;font-weight:700;opacity:.5}
.wp-tab:hover{color:var(--ink)}
.wp-tab.on{color:var(--ink);border-bottom-color:var(--magenta)}
.wp-tab.on .glyph{opacity:1;color:var(--magenta)}
@media(max-width:768px){.wp-tabs{padding:0 14px}.wp-tab{padding:16px 14px;font-size:15px}}

.wp-page{max-width:1080px;margin:0 auto;padding:32px 28px 80px;animation:wr-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wp-page{padding:24px 14px 80px}}

.wp-eyebrow{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink2x);display:flex;align-items:center;gap:10px;margin-bottom:14px}
.wp-eyebrow .rule{flex:1;height:1px;max-width:220px;background:linear-gradient(90deg,var(--line2),transparent)}
.wp-eyebrow .glyph{color:var(--cyan);font-size:13px;opacity:.9}

.wp-h1{font-family:'Fraunces';font-weight:500;font-size:44px;line-height:1.02;letter-spacing:-.025em;font-variation-settings:"opsz" 144;margin:0 0 10px}
.wp-h1 .it{font-style:italic;font-weight:400;color:var(--cyan)}
.wp-sub{font-family:'Fraunces';font-style:italic;font-weight:400;font-size:17px;line-height:1.5;color:var(--ink2x);margin:0 0 28px;max-width:640px}
@media(max-width:768px){.wp-h1{font-size:32px}.wp-sub{font-size:15px;margin-bottom:22px}}

.wp-card{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:20px;padding:24px;margin-bottom:18px;animation:wr-rise .45s .05s cubic-bezier(.2,1,.3,1) backwards}
.wp-card.feature{position:relative;overflow:hidden;background:radial-gradient(700px 300px at 100% 0%,rgba(255,61,138,.10),transparent 60%),linear-gradient(180deg,var(--plum),rgba(25,19,47,.7));border-color:var(--line2)}
.wp-card-eye{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--cyan);display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wp-card-eye .gl{font-size:12px}

.wp-link{display:flex;align-items:stretch;gap:8px;background:rgba(0,0,0,.28);border:1px solid var(--line);border-radius:14px;padding:8px;margin:18px 0 14px}
.wp-link-v{flex:1;min-width:0;padding:10px 14px;font-family:'JetBrains Mono';font-size:13.5px;font-weight:600;color:var(--ink);background:transparent;border:none;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wp-link-cp{flex-shrink:0;display:inline-flex;align-items:center;gap:8px;padding:0 18px;min-height:44px;border-radius:10px;background:var(--magenta);color:#1B0410;border:none;cursor:pointer;font-family:'JetBrains Mono';font-weight:800;font-size:11.5px;letter-spacing:.8px;box-shadow:0 4px 16px -5px var(--magenta-glow);transition:transform .12s}
.wp-link-cp:hover{transform:translateY(-1px)}
.wp-link-cp.copied{background:var(--mint);color:#001B0F;box-shadow:0 4px 16px -5px rgba(61,255,194,.45)}

.wp-share-row{display:flex;gap:8px;flex-wrap:wrap}
.wp-sh{flex:1;min-width:140px;min-height:44px;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:12px;border:1px solid var(--line2);background:var(--vapor);color:var(--ink);font-family:inherit;font-weight:600;font-size:13.5px;cursor:pointer;transition:.15s}
.wp-sh:hover{border-color:var(--line3);background:var(--vapor2)}
.wp-sh.tw{background:linear-gradient(135deg,rgba(107,238,255,.18),rgba(61,255,194,.16));border-color:rgba(107,238,255,.32)}
.wp-sh .ico{display:inline-grid;place-items:center;width:18px;height:18px;flex-shrink:0}
.wp-sh .ico svg{width:14px;height:14px}

.wp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.wp-stat{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.6));border:1px solid var(--line);border-radius:16px;padding:18px 18px 16px;animation:wr-rise .5s cubic-bezier(.2,1,.3,1) backwards}
.wp-stat:nth-child(1){animation-delay:.04s}
.wp-stat:nth-child(2){animation-delay:.08s}
.wp-stat:nth-child(3){animation-delay:.12s}
.wp-stat:nth-child(4){animation-delay:.16s}
.wp-stat-l{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--ink2x);display:flex;align-items:center;gap:7px;margin-bottom:10px}
.wp-stat-l .gl{color:var(--cyan);font-size:11px}
.wp-stat-v{font-family:'Fraunces';font-weight:500;font-size:30px;line-height:1;letter-spacing:-.02em;font-variation-settings:"opsz" 96}
.wp-stat-v .u{font-size:14px;color:var(--ink2x);font-family:'JetBrains Mono';font-weight:700;margin-left:5px;letter-spacing:.3px}
.wp-stat-v.gn{color:var(--mint)}
.wp-stat-v.rd{color:var(--coral)}
.wp-stat-v.it{font-style:italic;color:var(--ink2x)}
.wp-stat-m{font-family:'JetBrains Mono';font-size:11px;font-weight:600;color:var(--ink2x);margin-top:6px}
@media(max-width:768px){.wp-stats{grid-template-columns:1fr 1fr;gap:10px}.wp-stat-v{font-size:24px}}

.wp-boost-on{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 20px;border-radius:14px;background:linear-gradient(135deg,rgba(255,216,107,.14),rgba(255,216,107,.04));border:1px solid rgba(255,216,107,.32)}
.wp-boost-on .gl{font-family:'JetBrains Mono';font-size:18px;color:var(--butter)}
.wp-boost-on .t{flex:1;min-width:200px}
.wp-boost-on .h{font-family:'Fraunces';font-weight:500;font-size:18px;letter-spacing:-.01em;color:var(--butter);line-height:1.2;margin-bottom:3px}
.wp-boost-on .s{font-family:'JetBrains Mono';font-size:11px;font-weight:600;color:var(--ink2x);letter-spacing:.3px}
.wp-boost-on .pct{font-family:'Fraunces';font-weight:500;font-size:26px;letter-spacing:-.02em;color:var(--butter);display:flex;align-items:baseline;gap:4px}
.wp-boost-on .pct .u{font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:var(--ink2x);letter-spacing:.4px}

.wp-boost-in{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.wp-boost-in input{flex:1;min-width:160px;min-height:44px;padding:0 16px;border-radius:12px;background:rgba(0,0,0,.28);border:1px solid var(--line2);color:var(--ink);font-family:'JetBrains Mono';font-size:14px;font-weight:700;outline:none;letter-spacing:1px;text-transform:uppercase}
.wp-boost-in input:focus{border-color:var(--butter)}
.wp-boost-in input::placeholder{color:var(--ink3x);text-transform:none;letter-spacing:.3px;font-weight:600}
.wp-boost-in button{flex-shrink:0;min-height:44px;padding:0 22px;border-radius:12px;background:var(--butter);color:#2A1E00;border:none;cursor:pointer;font-family:'JetBrains Mono';font-weight:800;font-size:11.5px;letter-spacing:.8px;transition:transform .12s}
.wp-boost-in button:hover:not(:disabled){transform:translateY(-1px)}
.wp-boost-in button:disabled{opacity:.5;cursor:wait}
.wp-boost-err{margin-top:10px;font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:var(--coral);background:var(--coral-soft);padding:8px 12px;border-radius:9px;letter-spacing:.3px}
.wp-boost-ok{margin-top:10px;font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:var(--mint);background:var(--mint-soft);padding:8px 12px;border-radius:9px;letter-spacing:.3px}

.wp-rules{display:grid;gap:12px;margin-top:18px}
.wp-rule{display:flex;gap:14px;padding:14px 16px;border-radius:14px;background:rgba(0,0,0,.18);border:1px solid var(--line)}
.wp-rule .n{flex-shrink:0;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-family:'JetBrains Mono';font-weight:800;font-size:11px;background:rgba(107,238,255,.10);color:var(--cyan);border:1px solid rgba(107,238,255,.25)}
.wp-rule .t{flex:1}
.wp-rule .h{font-family:'Fraunces';font-weight:500;font-size:15.5px;letter-spacing:-.005em;line-height:1.3;margin-bottom:3px}
.wp-rule .h .it{font-style:italic;color:var(--cyan)}
.wp-rule .b{font-size:13px;line-height:1.5;color:var(--ink2x)}
.wp-rule .b b{color:var(--ink);font-weight:600}

.wp-pnl-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:28px 28px 24px;background:radial-gradient(800px 320px at 30% 0%,rgba(61,255,194,.07),transparent 60%),linear-gradient(180deg,var(--plum),rgba(25,19,47,.7));border:1px solid var(--line2);border-radius:22px;margin-bottom:18px;position:relative;overflow:hidden}
.wp-pnl-hero.neg{background:radial-gradient(800px 320px at 30% 0%,rgba(255,122,110,.08),transparent 60%),linear-gradient(180deg,var(--plum),rgba(25,19,47,.7))}
.wp-pnl-hero-l{min-width:0;flex:1 1 240px}
.wp-pnl-eye{font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink2x);display:flex;align-items:center;gap:9px;margin-bottom:10px}
.wp-pnl-eye .gl{font-size:12px;color:var(--mint)}
.wp-pnl-eye.neg .gl{color:var(--coral)}
.wp-pnl-val{font-family:'Fraunces';font-weight:500;font-size:64px;line-height:1;letter-spacing:-.035em;font-variation-settings:"opsz" 144;color:var(--mint)}
.wp-pnl-val.neg{color:var(--coral)}
.wp-pnl-val .u{font-size:24px;color:var(--ink2x);font-family:'JetBrains Mono';font-weight:700;margin-left:8px;letter-spacing:.3px}
.wp-pnl-usd{font-family:'JetBrains Mono';font-size:13px;font-weight:600;color:var(--ink2x);margin-top:8px;letter-spacing:.3px}
.wp-pnl-r{flex-shrink:0;align-self:flex-end}
.wp-pnl-share{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:0 22px;border-radius:13px;background:var(--magenta);color:#1B0410;border:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:13.5px;letter-spacing:.2px;box-shadow:0 8px 28px -8px var(--magenta-glow);transition:transform .12s}
.wp-pnl-share:hover{transform:translateY(-1px)}
.wp-pnl-share svg{width:14px;height:14px}
@media(max-width:768px){.wp-pnl-val{font-size:48px}.wp-pnl-hero{padding:22px 20px 20px}}

.wp-pos-frame{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:18px}
.wp-pos-head{padding:16px 22px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line)}
.wp-pos-head .e{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--cyan)}
.wp-pos-row{display:grid;grid-template-columns:36px 1fr 90px 110px 100px 110px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--line);transition:background .18s}
.wp-pos-row:last-child{border-bottom:none}
.wp-pos-row:hover{background:rgba(244,239,255,.025)}
.wp-pos-row.thead{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink2x);padding:11px 22px;background:rgba(0,0,0,.18)}
.wp-pos-row.thead:hover{background:rgba(0,0,0,.18)}
.wp-pos-no{font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:var(--ink3x)}
.wp-pos-tk{display:flex;align-items:center;gap:10px;min-width:0}
.wp-pos-av{flex-shrink:0;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-family:'Fraunces';font-weight:700;font-size:13px;color:#fff;text-transform:uppercase;box-shadow:0 3px 10px rgba(0,0,0,.3)}
.wp-pos-nm{min-width:0;flex:1}
.wp-pos-sym{font-family:'Fraunces';font-weight:600;font-size:14.5px;letter-spacing:-.005em;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:8px}
.wp-pos-status{font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:.5px;padding:2px 6px;border-radius:5px;text-transform:uppercase}
.wp-pos-status.open{background:var(--mint-soft);color:var(--mint)}
.wp-pos-status.closed{background:rgba(244,239,255,.06);color:var(--ink2x)}
.wp-pos-meta{font-family:'JetBrains Mono';font-size:11px;font-weight:600;color:var(--ink2x);margin-top:2px;letter-spacing:.2px}
.wp-pos-num{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--ink);letter-spacing:.2px}
.wp-pos-num.dim{color:var(--ink2x);font-weight:600}
.wp-pos-num.gn{color:var(--mint)}
.wp-pos-num.rd{color:var(--coral)}
@media(max-width:900px){.wp-pos-row{grid-template-columns:1.5fr 90px 110px;gap:8px;padding:12px 16px}.wp-pos-row.thead{padding:10px 16px}.wp-pos-no,.wp-col-avg,.wp-col-open{display:none}}

.wp-win-tabs{display:flex;gap:6px;margin-bottom:18px;background:rgba(0,0,0,.22);padding:5px;border-radius:14px;border:1px solid var(--line);max-width:fit-content}
.wp-win-tab{padding:10px 18px;min-height:40px;border:none;cursor:pointer;border-radius:10px;background:transparent;color:var(--ink2x);font-family:'JetBrains Mono';font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;transition:.18s}
.wp-win-tab:hover{color:var(--ink)}
.wp-win-tab.on{background:var(--magenta);color:#1B0410;box-shadow:0 4px 14px -5px var(--magenta-glow)}

.wp-lb-frame{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;overflow:hidden}
.wp-lb-row{display:grid;grid-template-columns:60px 1fr 130px 80px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--line);transition:background .18s}
.wp-lb-row:last-child{border-bottom:none}
.wp-lb-row:hover{background:rgba(244,239,255,.025)}
.wp-lb-row.thead{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink2x);padding:11px 22px;background:rgba(0,0,0,.18)}
.wp-lb-row.thead:hover{background:rgba(0,0,0,.18)}
.wp-lb-row.mine{background:linear-gradient(90deg,rgba(255,61,138,.10),rgba(255,61,138,.02));border-left:3px solid var(--magenta);padding-left:19px}
.wp-lb-rank{font-family:'Fraunces';font-weight:500;font-size:20px;letter-spacing:-.02em;color:var(--ink)}
.wp-lb-rank.gold{color:var(--butter)}
.wp-lb-rank.silver{color:var(--lavender)}
.wp-lb-rank.bronze{color:#D49B7C}
.wp-lb-rank .hash{font-family:'JetBrains Mono';font-weight:700;font-size:11px;color:var(--ink3x);margin-right:2px}
.wp-lb-w{font-family:'JetBrains Mono';font-weight:700;font-size:13px;color:var(--ink);letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wp-lb-w .you{font-family:inherit;font-weight:800;color:var(--magenta);font-size:11px;margin-left:8px;letter-spacing:.6px;text-transform:uppercase}
.wp-lb-vol{font-family:'JetBrains Mono';font-weight:700;font-size:13.5px;color:var(--ink);text-align:right;letter-spacing:.2px}
.wp-lb-vol .u{color:var(--ink2x);font-weight:600;font-size:10.5px;margin-left:3px}
.wp-lb-tr{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--ink2x);text-align:right}
.wp-lb-foot{padding:13px 22px;font-family:'JetBrains Mono';font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--ink2x);display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line)}
@media(max-width:768px){.wp-lb-row{grid-template-columns:50px 1fr 100px;gap:8px;padding:12px 16px}.wp-lb-row.thead{padding:10px 16px}.wp-col-tr{display:none}}

.wp-empty{padding:54px 28px;text-align:center;animation:wr-fade .3s}
.wp-empty .gl{display:block;font-family:'Fraunces';font-style:italic;font-size:44px;color:var(--ink3x);margin-bottom:14px;font-weight:400}
.wp-empty .h{font-family:'Fraunces';font-weight:500;font-size:19px;letter-spacing:-.01em;color:var(--ink);margin-bottom:6px}
.wp-empty .h .it{font-style:italic;color:var(--ink2x)}
.wp-empty .s{font-size:13px;color:var(--ink2x);max-width:380px;margin:0 auto;line-height:1.5}
.wp-empty .e{margin-top:12px;font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;color:var(--coral);background:var(--coral-soft);padding:8px 12px;border-radius:9px;display:inline-block;letter-spacing:.3px}
.wp-spin{width:18px;height:18px;border-radius:50%;border:2px solid rgba(244,239,255,.18);border-top-color:var(--cyan);animation:wr-spin .8s linear infinite;display:inline-block;vertical-align:-3px;margin-right:8px}

.wp-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2100;display:flex;align-items:center;gap:10px;padding:13px 18px;border-radius:14px;background:rgba(25,19,47,.95);backdrop-filter:blur(20px);border:1px solid var(--line2);font-family:'JetBrains Mono';font-size:11.5px;font-weight:700;letter-spacing:.4px;color:var(--ink);box-shadow:0 14px 36px rgba(0,0,0,.5);animation:wr-rise .25s ease}
.wp-toast .gl{font-size:14px;color:var(--mint)}

/* ── AUTO-TRADE PANEL (wa-) ───────────────────────────────────── */
.wa-root{position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:'Inter',-apple-system,system-ui,sans-serif;background:radial-gradient(900px 600px at 88% -10%,rgba(255,61,138,.10),transparent 55%),radial-gradient(700px 500px at -5% 8%,rgba(107,238,255,.08),transparent 55%),var(--iris);animation:wr-fade .25s ease}
.wa-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:16px 28px;background:rgba(14,11,31,.84);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--line)}
.wa-stat-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;margin-left:auto}
.wa-stat-pill.off{background:rgba(244,239,255,.06);color:rgba(244,239,255,.66);border:1px solid var(--line)}
.wa-stat-pill.on{background:rgba(61,255,194,.14);color:var(--mint);border:1px solid rgba(61,255,194,.32)}
.wa-stat-pill.on .d{width:7px;height:7px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.4s infinite}
.wa-stat-pill.paused{background:rgba(255,216,107,.12);color:var(--butter);border:1px solid rgba(255,216,107,.3)}
.wa-close{width:44px;height:44px;border-radius:12px;background:var(--vapor);border:1px solid var(--line);display:grid;place-items:center;cursor:pointer;color:rgba(244,239,255,.66);font-size:18px;font-family:initial}
.wa-close:hover{color:var(--ink);background:var(--vapor2)}
@media(max-width:768px){.wa-head{padding:14px 16px}}

.wa-page{max-width:920px;margin:0 auto;padding:28px 28px 110px;animation:wr-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wa-page{padding:22px 14px 110px}}

.wa-eye{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(244,239,255,.66);display:flex;align-items:center;gap:10px;margin-bottom:12px}
.wa-eye .gl{color:var(--cyan);font-size:13px}
.wa-eye .rule{flex:1;height:1px;max-width:200px;background:linear-gradient(90deg,var(--line2),transparent)}

.wa-h1{font-family:'Fraunces';font-weight:500;font-size:38px;line-height:1.02;letter-spacing:-.025em;font-variation-settings:"opsz" 144;margin:0 0 8px}
.wa-h1 .it{font-style:italic;font-weight:400;color:var(--cyan)}
.wa-sub{font-family:'Fraunces';font-style:italic;font-weight:400;font-size:16px;line-height:1.5;color:rgba(244,239,255,.66);margin:0 0 22px;max-width:620px}
@media(max-width:768px){.wa-h1{font-size:30px}}

.wa-modes{display:grid;grid-template-columns:1fr 1fr;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:14px;padding:4px;position:relative;margin-bottom:18px;max-width:360px}
.wa-mode-ind{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:var(--magenta);border-radius:11px;transition:transform .28s cubic-bezier(.2,1.3,.4,1);z-index:1;box-shadow:0 4px 14px -4px var(--magenta-glow)}
.wa-modes.custom .wa-mode-ind{transform:translateX(100%)}
.wa-mode-t{position:relative;z-index:2;padding:10px 0;text-align:center;font-family:'Fraunces';font-weight:500;font-size:14.5px;letter-spacing:-.005em;color:rgba(244,239,255,.66);border:none;background:none;cursor:pointer;min-height:42px}
.wa-mode-t.active{color:#1B0410;font-weight:600}

.wa-master{display:flex;align-items:center;gap:18px;padding:18px 22px;border-radius:16px;background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.7));border:1px solid var(--line2);margin-bottom:18px;flex-wrap:wrap}
.wa-master.on{background:linear-gradient(180deg,rgba(61,255,194,.06),rgba(25,19,47,.7));border-color:rgba(61,255,194,.28)}
.wa-master.paused{background:linear-gradient(180deg,rgba(255,216,107,.08),rgba(25,19,47,.7));border-color:rgba(255,216,107,.3)}
.wa-master-l{flex:1;min-width:200px}
.wa-master-h{font-family:'Fraunces';font-weight:500;font-size:22px;letter-spacing:-.015em;line-height:1.1;margin-bottom:4px}
.wa-master-h .it{font-style:italic;color:var(--cyan)}
.wa-master-h.on .it{color:var(--mint)}
.wa-master-s{font-family:'JetBrains Mono';font-size:11px;font-weight:600;color:rgba(244,239,255,.66);letter-spacing:.3px}
.wa-tog{position:relative;width:64px;height:36px;border-radius:999px;background:var(--vapor2);border:1px solid var(--line2);cursor:pointer;transition:.2s;flex-shrink:0}
.wa-tog::after{content:'';position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:var(--ink);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.wa-tog.on{background:var(--mint);border-color:transparent}
.wa-tog.on::after{transform:translateX(28px);background:#001B0F}

.wa-locked-card{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:18px}
.wa-locked-eye{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--cyan);display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wa-locked-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid var(--line)}
.wa-locked-row{padding:12px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-right:14px}
.wa-locked-row:nth-child(odd){padding-left:0;padding-right:14px}
.wa-locked-row:nth-child(even){padding-left:14px;border-left:1px solid var(--line)}
.wa-locked-k{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;color:rgba(244,239,255,.66);letter-spacing:.3px;text-transform:uppercase}
.wa-locked-v{font-family:'Fraunces';font-weight:500;font-size:18px;letter-spacing:-.01em;color:var(--ink);text-align:right;flex-shrink:0}
.wa-locked-v .u{font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:rgba(244,239,255,.66);margin-left:4px;letter-spacing:.2px}
.wa-locked-v.gn{color:var(--mint)}
.wa-locked-v.rd{color:var(--coral)}
@media(max-width:600px){.wa-locked-grid{grid-template-columns:1fr}.wa-locked-row:nth-child(even){padding-left:0;border-left:none}}

.wa-sliders{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:18px}
.wa-slider{padding:14px 0;border-bottom:1px solid var(--line)}
.wa-slider:last-child{border-bottom:none}
.wa-slider-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
.wa-slider-lbl{font-family:'Fraunces';font-weight:500;font-size:15.5px;letter-spacing:-.005em}
.wa-slider-lbl .it{font-style:italic;color:var(--cyan)}
.wa-slider-v{font-family:'Fraunces';font-weight:500;font-size:22px;letter-spacing:-.02em;color:var(--magenta)}
.wa-slider-v .u{font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:rgba(244,239,255,.66);margin-left:4px;letter-spacing:.2px}
.wa-slider-desc{font-size:12.5px;line-height:1.5;color:rgba(244,239,255,.66);margin-bottom:10px}
.wa-slider-desc b{color:var(--ink);font-weight:600}
.wa-slider input[type=range]{width:100%;-webkit-appearance:none;background:transparent;cursor:pointer;height:32px;outline:none}
.wa-slider input[type=range]::-webkit-slider-runnable-track{height:5px;background:linear-gradient(90deg,var(--vapor2),var(--vapor));border-radius:99px}
.wa-slider input[type=range]::-moz-range-track{height:5px;background:linear-gradient(90deg,var(--vapor2),var(--vapor));border-radius:99px}
.wa-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:var(--magenta);border:3px solid var(--iris);box-shadow:0 0 0 1px var(--line2),0 4px 10px -2px var(--magenta-glow);margin-top:-9px;cursor:grab}
.wa-slider input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--magenta);border:3px solid var(--iris);box-shadow:0 0 0 1px var(--line2),0 4px 10px -2px var(--magenta-glow);cursor:grab}

.wa-floor{margin-top:14px;padding:12px 16px;border-radius:12px;background:rgba(61,255,194,.05);border:1px dashed rgba(61,255,194,.22);font-family:'JetBrains Mono';font-size:11px;line-height:1.55;color:rgba(244,239,255,.66);font-weight:600;letter-spacing:.2px}
.wa-floor b{color:var(--mint);font-weight:700}

.wa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0 18px}
.wa-statc{padding:14px 14px 12px;background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.5));border:1px solid var(--line);border-radius:14px}
.wa-statc-l{font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:rgba(244,239,255,.66);margin-bottom:6px}
.wa-statc-v{font-family:'Fraunces';font-weight:500;font-size:24px;line-height:1;letter-spacing:-.015em}
.wa-statc-v .u{font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:rgba(244,239,255,.66);margin-left:4px}
.wa-statc-v.gn{color:var(--mint)}
.wa-statc-v.rd{color:var(--coral)}
.wa-statc-v.dim{color:rgba(244,239,255,.42)}
@media(max-width:600px){.wa-stats{grid-template-columns:1fr 1fr;gap:8px}.wa-statc-v{font-size:20px}}

.wa-pos-frame{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:18px}
.wa-section-head{padding:14px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--cyan)}
.wa-section-head .count{margin-left:auto;color:rgba(244,239,255,.66)}
.wa-pos-row{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line);transition:background .15s}
.wa-pos-row:last-child{border-bottom:none}
.wa-pos-row:hover{background:rgba(244,239,255,.02)}
.wa-pos-av{flex-shrink:0;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-family:'Fraunces';font-weight:700;font-size:13.5px;color:#fff;text-transform:uppercase;box-shadow:0 3px 10px rgba(0,0,0,.3)}
.wa-pos-nm{flex:1;min-width:0}
.wa-pos-sym{font-family:'Fraunces';font-weight:600;font-size:14.5px;letter-spacing:-.005em;line-height:1.1;display:flex;align-items:center;gap:8px}
.wa-pos-time{font-family:'JetBrains Mono';font-size:10.5px;font-weight:600;color:rgba(244,239,255,.66);margin-top:3px;letter-spacing:.2px}
.wa-pos-pnl{flex-shrink:0;text-align:right;min-width:90px}
.wa-pos-pnl-v{font-family:'Fraunces';font-weight:500;font-size:17px;letter-spacing:-.015em;line-height:1}
.wa-pos-pnl-v.gn{color:var(--mint)}
.wa-pos-pnl-v.rd{color:var(--coral)}
.wa-pos-pnl-p{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;margin-top:2px;letter-spacing:.2px;color:var(--ink2)}
.wa-pos-pnl-p.gn{color:var(--mint)}
.wa-pos-pnl-p.rd{color:var(--coral)}
.wa-pos-close{flex-shrink:0;min-width:38px;min-height:38px;padding:0 12px;border-radius:10px;background:var(--vapor);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:.5px;cursor:pointer}
.wa-pos-close:hover{background:var(--coral);color:#2E0009;border-color:transparent}

.wa-log-frame{background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:24px}
.wa-log-list{max-height:340px;overflow-y:auto}
.wa-log-list::-webkit-scrollbar{width:8px}
.wa-log-list::-webkit-scrollbar-thumb{background:var(--vapor2);border-radius:4px}
.wa-log-row{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--line);font-family:'JetBrains Mono';font-size:11.5px;font-weight:600;line-height:1.4}
.wa-log-row:last-child{border-bottom:none}
.wa-log-ts{flex-shrink:0;color:rgba(244,239,255,.42);font-size:10.5px;letter-spacing:.2px;width:54px}
.wa-log-tag{flex-shrink:0;font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:2px 7px;border-radius:5px;text-transform:uppercase;min-width:54px;text-align:center}
.wa-log-tag.skip{background:rgba(244,239,255,.05);color:rgba(244,239,255,.5)}
.wa-log-tag.buy{background:var(--mint-soft);color:var(--mint)}
.wa-log-tag.sell{background:rgba(201,184,255,.12);color:var(--lavender)}
.wa-log-tag.error{background:var(--coral-soft);color:var(--coral)}
.wa-log-tag.info{background:rgba(107,238,255,.1);color:var(--cyan)}
.wa-log-msg{flex:1;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.wa-kill{position:sticky;bottom:0;left:0;right:0;display:flex;gap:10px;padding:14px 28px;background:linear-gradient(180deg,transparent,rgba(14,11,31,.95) 30%);backdrop-filter:blur(20px);border-top:1px solid var(--line);z-index:10;margin-top:24px}
.wa-kill-btn{flex:1;min-height:48px;padding:0 20px;border-radius:13px;border:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:13.5px;letter-spacing:.4px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .12s}
.wa-kill-btn.stop{background:var(--coral);color:#2E0009;box-shadow:0 6px 20px -6px rgba(255,122,110,.5)}
.wa-kill-btn.stop:hover{transform:translateY(-1px)}
.wa-kill-btn.flat{background:var(--vapor);color:var(--ink);border:1px solid var(--line2)}
.wa-kill-btn.flat:hover{background:var(--vapor2)}
.wa-kill-btn:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:600px){.wa-kill{padding:12px 14px;flex-direction:column}.wa-kill-btn{width:100%}}

.wa-empty{padding:36px 24px;text-align:center}
.wa-empty .gl{display:block;font-family:'Fraunces';font-style:italic;font-size:36px;color:rgba(244,239,255,.42);margin-bottom:10px}
.wa-empty .h{font-family:'Fraunces';font-weight:500;font-size:16px;letter-spacing:-.005em;color:var(--ink);margin-bottom:4px}
.wa-empty .h .it{font-style:italic;color:rgba(244,239,255,.66)}
.wa-empty .s{font-size:12.5px;color:rgba(244,239,255,.66);max-width:340px;margin:0 auto;line-height:1.5}

.wa-pause-banner{padding:14px 18px;border-radius:14px;background:linear-gradient(135deg,rgba(255,216,107,.14),rgba(255,216,107,.04));border:1px solid rgba(255,216,107,.32);display:flex;align-items:center;gap:14px;margin-bottom:16px}
.wa-pause-banner .gl{font-size:20px;color:var(--butter);flex-shrink:0}
.wa-pause-banner .t{flex:1;min-width:0}
.wa-pause-banner .h{font-family:'Fraunces';font-weight:500;font-size:16px;letter-spacing:-.01em;color:var(--butter);margin-bottom:2px}
.wa-pause-banner .b{font-family:'JetBrains Mono';font-size:11px;font-weight:600;color:rgba(244,239,255,.66)}
.wa-pause-banner button{flex-shrink:0;min-height:36px;padding:0 16px;border-radius:9px;background:var(--butter);color:#2A1E00;border:none;cursor:pointer;font-family:'JetBrains Mono';font-weight:800;font-size:10.5px;letter-spacing:.6px}

@media(prefers-reduced-motion:reduce){.wa-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;

function useWrCSS() {
  useEffect(() => {
    const id = 'wonderland-wr-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = WR_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ============================================================
   CONFIG
   ============================================================ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;
const SOL_RESERVE = 0.01;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';
// Dedicated trade-path RPC — Ankr primary, Alchemy fallback (configured in
// server.js as /api/trade-rpc). Routes sendRawTransaction, getSignatureStatus,
// getLatestBlockhash, and ALT lookups OFF the free Alchemy quota that the
// background reads (balances, positions, prices) share.
const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';
const BAL_COMMITMENT = 'processed';
const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};
const _tradeConnCache = new Map();
const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};
const balRpcRace = (op) => op(getConn(BAL_COMMITMENT));


const POLL_RECENT    = 2500;
const POLL_SOL       = 30000;
const POLL_BALANCE   = 30000;
const POLL_POSITIONS = 30000;  // NEW — open positions strip refresh

// NEW: flag set on first confirmed trade — used to detect returning users
// and collapse the marketing hero+offers on subsequent visits.
const HAS_TRADED_KEY = 'lr_has_traded_v1';

/* ============================================================
   BURNER WALLET
   ============================================================ */
const SK_KEY = 'lr_wallet_sk_v1';
const BACKED_KEY = 'lr_wallet_backed_v1';
function loadOrCreateKeypair() {
  try {
    const sk = localStorage.getItem(SK_KEY);
    if (sk) return Keypair.fromSecretKey(bs58.decode(sk));
  } catch (e) { console.warn('[wr-wallet] load failed, regenerating', e && e.message); }
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
   REFERRAL HELPERS — fire-and-forget; never block a trade.
   ============================================================ */
async function refLookup(walletStr) {
  try {
    const r = await fetch('/api/ref/lookup?wallet=' + encodeURIComponent(walletStr));
    if (!r.ok) return { referrer: null, refSplitBps: 0 };
    const d = await r.json();
    if (!d || !d.referrer) return { referrer: null, refSplitBps: 0 };
    return { referrer: d.referrer, refSplitBps: Number(d.refSplitBps) || 0 };
  } catch (e) { return { referrer: null, refSplitBps: 0 }; }
}
function refRegister(walletStr, referrer, boost) {
  try {
    fetch('/api/ref/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletStr, referrer: referrer || null, boost: boost || null }),
    }).catch(() => {});
  } catch (e) {}
}
function refLogTrade(payload) {
  try {
    fetch('/api/ref/log-trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) {}
}

/* ============================================================
   FORMATTERS
   ============================================================ */
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function formatMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  if (n >= 1) return '$'+n.toFixed(2);
  return '$'+n.toPrecision(2);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1) return '$'+p.toFixed(4);
  if (p >= 0.01) return '$'+p.toFixed(5);
  if (p >= 0.0001) return '$'+p.toFixed(6);
  if (p >= 0.00000001) return '$'+p.toFixed(9);
  return '$'+p.toExponential(2);
}
function formatPct(p) { if (!Number.isFinite(p)) return '0%'; return (p>=0?'+':'')+p.toFixed(p<10&&p>-10?2:1)+'%'; }
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
function formatUsdAbs(n) {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n); const s = n < 0 ? '-' : '';
  if (abs >= 1e6) return s + '$' + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return s + '$' + (abs/1e3).toFixed(1) + 'K';
  if (abs >= 1)   return s + '$' + abs.toFixed(2);
  return s + '$' + abs.toPrecision(2);
}
function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function fmtAgeShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return Math.max(1, Math.floor(ms/1000))+'s';
  if (ms < 3600000) {
    const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000);
    return s > 0 && m < 10 ? (m+'m '+s+'s') : (m+'m');
  }
  const h = ms/3600000; if (h < 24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
function ageClass(ms) {
  if (!Number.isFinite(ms)) return 'wr-age old';
  if (ms < 30000) return 'wr-age';
  if (ms < 180000) return 'wr-age med';
  return 'wr-age old';
}
// NEW: variant of ageClass for the mobile-meta line (uses `.mob-age` base)
function mobAgeClass(ms) {
  if (!Number.isFinite(ms)) return 'mob-age old';
  if (ms < 30000) return 'mob-age';
  if (ms < 180000) return 'mob-age med';
  return 'mob-age old';
}
const lamportsToSol = (l) => Number(l || 0) / 1e9;
const truncWallet = (w) => w ? w.slice(0,4) + '…' + w.slice(-4) : '';

/* ============================================================
   VIBE CHECK
   ============================================================ */
const RISK_CEIL = 85;
function riskRead(t) {
  if (!t) return { score: 0, verdict: 'Unknown', tier: 'high', label: 'Wild', knowns: [], unknowns: [] };
  const liq = t.liquidity || 0, mcap = t.mcap || 0, hold = t.holders || 0, vol = t.volume24h || 0;
  const ageMin = Number.isFinite(t.ageMs) ? t.ageMs / 60000 : Infinity;
  const dataPoints = (liq > 0 ? 1 : 0) + (hold > 0 ? 1 : 0) + (vol > 0 ? 1 : 0) + (mcap > 0 ? 1 : 0);
  const tooThin = dataPoints <= 1;
  let s = 0;
  s += Math.min(26, Math.log10(Math.max(liq, 1)) * 5.6);
  let liqRatio = null;
  if (mcap > 0 && liq > 0) { liqRatio = liq / mcap; s += liqRatio >= 0.15 ? 22 : liqRatio >= 0.08 ? 16 : liqRatio >= 0.03 ? 9 : liqRatio >= 0.01 ? 4 : 0; }
  s += Math.min(16, Math.log10(Math.max(hold, 1)) * 5.3);
  if (hold >= 50 && mcap > 0) { const perHolder = mcap / hold; s += perHolder < 500 ? 6 : perHolder < 2000 ? 3 : 0; }
  if (liq > 0) { const turn = vol / liq; s += (turn >= 0.1 && turn <= 4) ? 12 : (turn > 4 && turn <= 12) ? 6 : turn > 0 ? 3 : 0; }
  s += ageMin >= 30 ? 8 : ageMin >= 10 ? 5 : ageMin >= 3 ? 2 : 0;
  if (t.bond != null) s += (t.bond >= 20 && t.bond <= 90) ? 6 : 3;
  let score = Math.round(Math.max(3, Math.min(RISK_CEIL, s)));
  if (tooThin) score = Math.min(score, 28);
  const knowns = [];
  knowns.push(liq >= 30000 ? ['ok', '✓ Liq ' + formatMoney(liq)] : liq >= 5000 ? ['cau', 'Liq ' + formatMoney(liq)] : ['bad', 'Thin liq ' + formatMoney(liq || 0)]);
  knowns.push(hold >= 500 ? ['ok', '✓ ' + format(hold) + ' holders'] : hold >= 100 ? ['cau', format(hold) + ' holders'] : ['bad', (hold || 0) + ' holders']);
  if (liqRatio != null) knowns.push(liqRatio >= 0.08 ? ['ok', '✓ Liq ' + (liqRatio * 100).toFixed(0) + '% of mcap'] : ['bad', 'Liq only ' + (liqRatio * 100).toFixed(1) + '% of mcap']);
  const unknowns = ['LP lock duration', 'dev wallet plans', 'mint/freeze authority', 'bundled buys'];
  let verdict, tier, label;
  if (tooThin) { verdict = 'Too fresh to read'; tier = 'med'; label = 'Mixed'; }
  else if (score >= 60) { verdict = 'Looks steady — still risky'; tier = 'low'; label = 'Steady'; }
  else if (score >= 38) { verdict = 'Mixed signals'; tier = 'med'; label = 'Mixed'; }
  else { verdict = 'High risk'; tier = 'high'; label = 'Wild'; }
  return { score, verdict, tier, label, knowns, unknowns };
}

function normalize(t) {
  const rawMint = t && t.mint;
  if (!rawMint || typeof rawMint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawMint)) return null;
  const createdAtMs = t.pairCreatedAt ? new Date(t.pairCreatedAt).getTime() : null;
  let bond = Number(t.bondingProgress != null ? t.bondingProgress : (t.curveProgress != null ? t.curveProgress : NaN));
  bond = Number.isFinite(bond) ? Math.max(0, Math.min(100, bond)) : null;
  return {
    mint: rawMint, sym: t.sym || '???', name: t.name || t.sym || 'Unknown',
    icon: t.icon || null,
    price: Number(t.price || 0), change: Number(t.priceChange24h || 0),
    pairCreatedAtMs: createdAtMs,
    mcap: Number(t.mcap || t.fdv || 0), volume24h: Number(t.volume24h || 0),
    holders: Number(t.holders || 0), liquidity: Number(t.liquidity || 0),
    decimals: Number(t.decimals != null ? t.decimals : 6), pumpPool: t.pumpPool || 'auto',
    bond, dex: t.dexId || (t.pumpPool ? 'pump.fun' : null), source: 'dexscreener',
  };
}

const friendlyError = (err) => {
  const m = String((err && err.message) || err || '').toLowerCase();
  if (m.includes('user reject') || m.includes('cancelled')) return 'Cancelled.';
  if (m.includes('graduat')) return 'Token graduated off the bonding curve — not tradable here.';
  if (m.includes('not a pump') || m.includes('not indexed')) return 'Not a pump.fun bonding-curve token.';
  if (m.includes('slippage')) return 'Price moved past slippage — try again.';
  if (m.includes('insufficient') || m.includes('debit an account')) return 'Not enough SOL for this trade + fees.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Tx expired — retry.';
  if (m.includes("didn't confirm") || m.includes('not confirm')) return "Sent but didn't confirm — check Solscan before retrying.";
  if (m.includes('simulation failed')) return 'Trade would fail right now — price likely moved.';
  if (m.includes('incorrectprogramid')) return 'Pump SDK fee-config stale — try again.';
  if (m.includes('rate')) return 'Rate limited — try again.';
  return (err && err.message ? err.message.slice(0, 200) : 'Trade failed.');
};
function describeSimLogs(logs, fallbackMsg) {
  const arr = Array.isArray(logs) ? logs : [];
  const j = arr.join('\n').toLowerCase();
  if (j.includes('slippage') || j.includes('toomuchsol') || j.includes('toolittlesol')) return 'Price moved past slippage — try again.';
  if (j.includes('insufficient') || j.includes('debit an account')) return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '').replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed -> ' + ctx;
  return fallbackMsg ? ('Sim failed -> ' + String(fallbackMsg).slice(0, 160)) : 'Sim failed (no logs).';
}

/* ============================================================
   PUMP.FUN TRADE
   ============================================================ */
async function decodeBuiltTx(b64, connection) {
  const txBytes = Buffer.from(b64, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
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
async function getPumpRoute(opts) {
  const { action, mint, user, amount, decimals, connection } = opts;
  const body = { action, mint, user: user.toBase58(), amount: String(amount) };
  if (decimals != null) body.decimals = Number(decimals);
  const r = await fetch('/api/pumpfun/trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error) || ('pump HTTP ' + r.status));
  if (!data.tx) throw new Error('PumpPortal returned no tx.');
  const dec = await decodeBuiltTx(data.tx, connection);
  return { instructions: dec.instructions, alts: dec.alts, pool: data.pool, route: data.route };
}

function buildBuyParams(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalLamports = BigInt(Math.floor(n * 1e9));
  if (totalLamports <= 0n) return null;
  const feeLamports = (totalLamports * BigInt(FEE_BPS)) / 10000n;
  const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
  if (tradeLamports <= 0n || feeLamports <= 0n) return null;
  return { mode: 'buy', solAmount: n, totalLamports: totalLamports.toString(), tradeLamports: tradeLamports.toString(), feeLamports: feeLamports.toString() };
}
function buildSellParams(token, pct, tokenBalance, solPrice) {
  if (!tokenBalance || !tokenBalance.amount || BigInt(tokenBalance.amount) <= 0n) return null;
  const p = Math.min(100, Math.max(0.01, pct));
  const tradeTokens = (BigInt(tokenBalance.amount) * BigInt(Math.floor(p * 100))) / 10000n;
  if (tradeTokens <= 0n) return null;
  const decimals = tokenBalance.decimals || token.decimals || 6;
  const tradeTokensUi = Number(tradeTokens) / Math.pow(10, decimals);
  let feeLamports = '0';
  if (token && token.price > 0 && solPrice > 0) {
    const grossSol = (tradeTokensUi * token.price) / solPrice;
    const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
    if (lam > 0) feeLamports = String(lam);
  }
  return { mode: 'sell', decimals, percentage: p, tradeTokens: tradeTokens.toString(), tradeTokensUi, feeLamports };
}

/* ============================================================
   SHARE INTENTS
   ============================================================ */
function buildShareUrl() { if (typeof window === 'undefined') return ''; try { return new URL(window.location.origin + window.location.pathname).toString(); } catch (e) { return ''; } }
function buildTweetText(o) {
  const { mode, token, solAmount, outAmount, percentage } = o;
  if (mode === 'buy') {
    const recv = outAmount > 0 ? '\n-> ' + formatTokens(outAmount) + ' $' + token.sym : '';
    return 'Just caught $' + token.sym + ' on wonderland//radar — ' + solAmount + ' SOL' + recv + '\n\nFresh launches at first light:';
  }
  const got = outAmount > 0 ? '\n-> ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Sold ' + percentage + '% of $' + token.sym + ' on wonderland//radar' + got + '\n\nField log open here:';
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text }); if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
}
function inviteUrl(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/?ref=' + walletStr;
}
function shareUrlPath(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/share/' + walletStr;
}
function openTelegram(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ url: url || '', text });
  window.open('https://t.me/share/url?' + params, '_blank', 'noopener,noreferrer');
}

/* ============================================================
   TOKEN ICON
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
      const url = (data && data.token && data.token.icon) || null; _iconCache.set(mint, url || null); return url || null;
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

function colorFor(mint) {
  const palette = ['#a855f7','#f472b6','#fb923c','#60a5fa','#22d3ee','#facc15','#16a34a','#ec4899','#0ea5e9','#fda4af','#f59e0b','#9333ea','#84cc16','#06b6d4','#dc2626'];
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
function shade(hex, p) {
  const f = parseInt(hex.slice(1), 16); const t = p < 0 ? 0 : 255; const pp = Math.abs(p) / 100;
  const R = f >> 16, G = (f >> 8) & 0xFF, B = f & 0xFF;
  return '#' + (0x1000000 + (Math.round((t - R) * pp) + R) * 0x10000 + (Math.round((t - G) * pp) + G) * 0x100 + (Math.round((t - B) * pp) + B)).toString(16).slice(1);
}

function TokenFace({ token, size }) {
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
  return (
    <div className="wr-av" style={style}>
      {url && !errored
        ? <img src={url} alt={token.sym || ''} onError={() => setErrored(true)} />
        : <span>{(token.sym || '?').charAt(0)}</span>}
    </div>
  );
}
function TokenChip({ token }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  return url && !errored
    ? <img src={url} alt="" onError={() => setErrored(true)} />
    : <span>{(token.sym || '?').charAt(0)}</span>;
}

const IconX = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>);
const IconTg = () => (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>);

/* ════════════════════════════════════════════════════════════════
   NEW — TOKEN CHART. Simple SVG line + soft gradient. PancakeSwap-style.
   ════════════════════════════════════════════════════════════════
   Fetches from GET /api/dex/chart/:mint?tf=5m
   Expected response shape:  { points: [{ts: number, price: number}, ...] }
   Server should cache 5 minutes per (mint, tf) and proxy Dexscreener
   pair-candles. If endpoint 404s or returns fewer than 2 points, the
   "too fresh" empty state shows — the chart degrades gracefully.
   ════════════════════════════════════════════════════════════════ */
const CHART_TFS = ['5m', '1H', '6H', '24H'];
const FRESH_FLOOR_MS = 5 * 60 * 1000; // tokens younger than 5min → empty state

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
      <div className="wr-chart-wrap">
        <div className="wr-chart-empty">
          <div className="radar-mini" />
          <div className="em-h">Too fresh to chart <i>yet</i></div>
          <div className="em-s">Check back in a few minutes</div>
        </div>
        <div className="wr-tf-pills">
          {CHART_TFS.map(t => (
            <button key={t} className={'wr-tf' + (t === tf ? ' on' : '')} disabled>{t}</button>
          ))}
          <span className="wr-tf-meta">{ageMs != null ? fmtAgeShort(ageMs) + ' old' : '—'}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="wr-chart-wrap">
        <div className="wr-chart-loading"><span className="sp" /></div>
        <div className="wr-tf-pills">
          {CHART_TFS.map(t => (
            <button key={t} className={'wr-tf' + (t === tf ? ' on' : '')} onClick={() => setTf(t)}>{t}</button>
          ))}
          <span className="wr-tf-meta">Loading…</span>
        </div>
      </div>
    );
  }

  const first = points[0].price, last = points[points.length - 1].price;
  const isUp = last >= first;
  const color = isUp ? '#3DFFC2' : '#FF7A6E';
  const tfClass = isUp ? ' on up' : ' on dn';

  const minP = Math.min.apply(null, points.map(p => p.price));
  const maxP = Math.max.apply(null, points.map(p => p.price));
  const range = (maxP - minP) || (maxP * 0.001) || 1;
  const W = 320, H = 84, pad = 6;
  const xStep = W / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * xStep;
    const y = H - pad - ((p.price - minP) / range) * (H - 2 * pad);
    return [x, y];
  });
  const linePath = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const fillPath = linePath + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';
  const gradId = 'wr-chart-grad-' + (token.mint || 'x').slice(0, 8);

  return (
    <div className="wr-chart-wrap">
      <div className="wr-chart">
        <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fillPath} fill={'url(#' + gradId + ')'} />
          <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="wr-tf-pills">
        {CHART_TFS.map(t => (
          <button key={t} className={'wr-tf' + (t === tf ? tfClass : '')} onClick={() => setTf(t)}>{t}</button>
        ))}
        <span className="wr-tf-meta">Dexscreener</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   STATS PANEL — Referrals · Field log · Standings
   ════════════════════════════════════════════════════════════════ */

function ReferralsSection({ walletStr, stats, statsLoading, statsError, onBoostActivated }) {
  const link = inviteUrl(walletStr);
  const [copied, setCopied] = useState(false);
  const [boostCode, setBoostCode] = useState('');
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostMsg, setBoostMsg] = useState(null);

  const copyLink = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };

  const activateBoost = async () => {
    const code = boostCode.trim().toUpperCase();
    if (!code) return;
    setBoostBusy(true); setBoostMsg(null);
    try {
      const r = await fetch('/api/ref/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletStr, boost: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.boostActivated) { setBoostMsg({ kind: 'ok', text: '✓ Boost active. Your line now pays 1.5% per trade for 60 days.' }); setBoostCode(''); onBoostActivated && onBoostActivated(); }
      else if (d.boosted)   { setBoostMsg({ kind: 'err', text: 'Boost already running on this wallet.' }); }
      else                  { setBoostMsg({ kind: 'err', text: 'Code not recognised. Check the spelling.' }); }
    } catch (e) { setBoostMsg({ kind: 'err', text: 'Could not reach the server. Try again.' }); }
    finally { setBoostBusy(false); }
  };

  const earnedSol    = lamportsToSol(stats?.earned_lamports);
  const earned7dSol  = lamportsToSol(stats?.earned_lamports_7d);
  const earned24hSol = lamportsToSol(stats?.earned_lamports_24h);
  const referees     = stats?.referees || 0;
  const active       = stats?.active_referees || 0;
  const boosted      = !!stats?.boost_active;
  const boostUntil   = stats?.boost_until ? new Date(stats.boost_until) : null;
  const splitPct     = ((stats?.split_bps_now || 3000) / 100);

  const inviteTweet = "I've been logging fresh launches on Wonderland Radar — burner wallet, 2-second trade, honest reads.\n\nFollow my line:";

  if (!walletStr) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Connect a <span className="it">main wallet.</span></h1>
      <p className="wp-sub">Your referral link pays out on-chain to whichever wallet it points at. We won't build that link against the burner — burners are disposable, and your fees shouldn't be. Connect a wallet you'll still own next year (Phantom, Solflare, Backpack) and your link will appear here.</p>
      <div className="wp-card feature">
        <div className="wp-card-eye"><span className="gl">⊘</span><span>Not connected</span></div>
        <div style={{padding:'18px 4px 4px',fontFamily:"'JetBrains Mono'",fontSize:11.5,lineHeight:1.7,color:'var(--ink2)',letterSpacing:.2}}>
          <div>· Use the wallet button in the top nav to connect.</div>
          <div>· Once connected, your link shows here and starts earning immediately.</div>
          <div>· Already shared a link? Earnings on it route to whichever wallet was in it — no migration available.</div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Your <span className="it">invitation.</span></h1>
      <p className="wp-sub">Pass the radar forward. Every entry your line logs returns a share of the fee — direct to this wallet, same block as the trade. No claims, no payouts. It's already yours.</p>

      <div className="wp-card feature">
        <div className="wp-card-eye"><span className="gl">◌</span><span>Your link</span></div>
        <div className="wp-link">
          <input className="wp-link-v" value={link} readOnly onClick={(e) => e.target.select()} />
          <button className={'wp-link-cp' + (copied ? ' copied' : '')} onClick={copyLink}>{copied ? '✓ COPIED' : 'COPY'}</button>
        </div>
        <div className="wp-share-row">
          <button className="wp-sh tw" onClick={() => openTwitterShare(inviteTweet, link)}><span className="ico"><IconX /></span><span>Share on X</span></button>
          <button className="wp-sh" onClick={() => openTelegram(inviteTweet, link)}><span className="ico"><IconTg /></span><span>Share on Telegram</span></button>
        </div>
      </div>

      {statsError ? (
        <div className="wp-card"><div className="wp-empty">
          <span className="gl">⊘</span>
          <div className="h">Couldn't read your stats</div>
          <div className="s">The server didn't respond. Retrying automatically.</div>
          <div className="e">{statsError}</div>
        </div></div>
      ) : statsLoading && !stats ? (
        <div className="wp-card"><div className="wp-empty">
          <span className="gl">⏳</span>
          <div className="h"><span className="wp-spin" />Reading the ledger…</div>
          <div className="s">Pulling everything attributed to your line.</div>
        </div></div>
      ) : (
        <div className="wp-stats">
          <div className="wp-stat">
            <div className="wp-stat-l"><span className="gl">№</span>Entries brought</div>
            <div className="wp-stat-v">{referees}</div>
            <div className="wp-stat-m">{active} have logged at least one trade</div>
          </div>
          <div className="wp-stat">
            <div className="wp-stat-l"><span className="gl">◉</span>Earned · 24h</div>
            <div className={'wp-stat-v ' + (earned24hSol > 0 ? 'gn' : 'it')}>{earned24hSol > 0 ? formatSolSigned(earned24hSol) : '—'}{earned24hSol > 0 ? <span className="u">SOL</span> : null}</div>
            <div className="wp-stat-m">Last day</div>
          </div>
          <div className="wp-stat">
            <div className="wp-stat-l"><span className="gl">◉</span>Earned · 7d</div>
            <div className={'wp-stat-v ' + (earned7dSol > 0 ? 'gn' : 'it')}>{earned7dSol > 0 ? formatSolSigned(earned7dSol) : '—'}{earned7dSol > 0 ? <span className="u">SOL</span> : null}</div>
            <div className="wp-stat-m">Rolling week</div>
          </div>
          <div className="wp-stat">
            <div className="wp-stat-l"><span className="gl">§</span>Earned · all time</div>
            <div className={'wp-stat-v ' + (earnedSol > 0 ? 'gn' : 'it')}>{earnedSol > 0 ? formatSolSigned(earnedSol) : '—'}{earnedSol > 0 ? <span className="u">SOL</span> : null}</div>
            <div className="wp-stat-m">Since your first referee</div>
          </div>
        </div>
      )}

      <div className="wp-card">
        <div className="wp-card-eye"><span className="gl">†</span><span>Your rate</span></div>
        {boosted ? (
          <div className="wp-boost-on">
            <span className="gl">⚡</span>
            <div className="t">
              <div className="h">Boost active</div>
              <div className="s">Ends {boostUntil ? boostUntil.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'soon'} · then returns to 0.9% per trade</div>
            </div>
            <div className="pct">{splitPct.toFixed(1)}<span className="u">% / trade</span></div>
          </div>
        ) : (
          <>
            <p style={{margin:'0 0 4px',fontSize:14,lineHeight:1.55,color:'rgba(244,239,255,.66)'}}>
              Standard rate is <b style={{color:'var(--ink)'}}>0.9% of every trade</b> made through your link. If you have a KOL code, redeem it here for <b style={{color:'var(--butter)'}}>1.5% for 60 days</b>.
            </p>
            <div className="wp-boost-in">
              <input placeholder="KOL code" value={boostCode}
                onChange={(e) => setBoostCode(e.target.value.toUpperCase().slice(0, 24))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !boostBusy) activateBoost(); }} />
              <button disabled={boostBusy || !boostCode.trim()} onClick={activateBoost}>{boostBusy ? 'CHECKING…' : 'ACTIVATE'}</button>
            </div>
            {boostMsg && <div className={boostMsg.kind === 'ok' ? 'wp-boost-ok' : 'wp-boost-err'}>{boostMsg.text}</div>}
          </>
        )}
      </div>

      <div className="wp-card">
        <div className="wp-card-eye"><span className="gl">§</span><span>How the line pays</span></div>
        <div className="wp-rules">
          <div className="wp-rule"><div className="n">01</div><div className="t">
            <div className="h">Someone follows your <span className="it">link.</span></div>
            <div className="b">They land on Wonderland Radar with your wallet attached. The first time they trade, you're locked in as their referrer — <b>permanently</b>. No one can overwrite it.</div>
          </div></div>
          <div className="wp-rule"><div className="n">02</div><div className="t">
            <div className="h">They <span className="it">trade.</span> You get paid in the same block.</div>
            <div className="b">Each trade carries a 3% platform fee. <b>30% of that fee</b> is sent directly to your wallet as part of the same on-chain transaction. The server never touches it.</div>
          </div></div>
          <div className="wp-rule"><div className="n">03</div><div className="t">
            <div className="h">Boost codes raise your <span className="it">share.</span></div>
            <div className="b">If you redeem a KOL code, your line pays <b>50% of the fee</b> for 60 days. After that it reverts to the standard rate.</div>
          </div></div>
          <div className="wp-rule"><div className="n">04</div><div className="t">
            <div className="h">No withdrawals. No <span className="it">claims.</span></div>
            <div className="b">Earnings are already in this wallet the moment each trade confirms. The numbers above are a ledger of what's been routed to you — not a balance to claim.</div>
          </div></div>
        </div>
      </div>
    </>
  );
}

function FieldLogSection({ walletStr, pnl, pnlLoading, pnlError, solPrice }) {
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
    'Field log · ' + truncWallet(walletStr),
    'Realized: ' + formatSolSigned(realized) + ' SOL',
    count + ' entries · ' + formatSol(volume) + ' SOL routed',
    best && best.realized_pnl_sol > 0 ? 'Best mark: $' + (best.sym || '???') + ' ' + formatSolSigned(best.realized_pnl_sol) + ' SOL' : '',
    '', 'Caught on Wonderland Radar:',
  ].filter(Boolean).join('\n'), [walletStr, realized, count, volume, best]);

  if (pnlError) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Personal field log</span><span className="rule" /></div>
      <div className="wp-card"><div className="wp-empty">
        <span className="gl">⊘</span>
        <div className="h">The ledger is unreachable</div>
        <div className="s">Couldn't pull your trade history. Retrying automatically.</div>
        <div className="e">{pnlError}</div>
      </div></div>
    </>
  );
  if (pnlLoading && !pnl) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Personal field log</span><span className="rule" /></div>
      <div className="wp-card"><div className="wp-empty">
        <span className="gl">⏳</span>
        <div className="h"><span className="wp-spin" />Reading the ledger…</div>
        <div className="s">Aggregating every trade you've logged through this terminal.</div>
      </div></div>
    </>
  );
  if (!pnl || count === 0) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Personal field log</span><span className="rule" /></div>
      <div className="wp-card"><div className="wp-empty">
        <span className="gl">∅</span>
        <div className="h">No <span className="it">entries</span> yet</div>
        <div className="s">Your first trade will start the log. Open the radar, mark a specimen, return here.</div>
      </div></div>
    </>
  );

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Personal field log</span><span className="rule" /></div>
      <div className={'wp-pnl-hero' + (isPos ? '' : ' neg')}>
        <div className="wp-pnl-hero-l">
          <div className={'wp-pnl-eye' + (isPos ? '' : ' neg')}><span className="gl">{isPos ? '◉' : '⊘'}</span><span>Realized · all time</span></div>
          <div className={'wp-pnl-val' + (isPos ? '' : ' neg')}>{formatSolSigned(realized)}<span className="u">SOL</span></div>
          <div className="wp-pnl-usd">{solPrice > 0 ? '≈ ' + formatUsdAbs(realizedUsd) : ' '}{' · '}{count} {count === 1 ? 'entry' : 'entries'} · {formatSol(volume)} SOL routed</div>
        </div>
        <div className="wp-pnl-r">
          <button className="wp-pnl-share" onClick={() => openTwitterShare(shareTweet, shareUrlPath(walletStr))}><IconX /><span>Share my field log</span></button>
        </div>
      </div>

      <div className="wp-stats">
        <div className="wp-stat">
          <div className="wp-stat-l"><span className="gl">№</span>Volume</div>
          <div className="wp-stat-v">{formatSol(volume)}<span className="u">SOL</span></div>
          <div className="wp-stat-m">{solPrice > 0 ? '≈ ' + formatUsdAbs(volume * solPrice) : ' '}</div>
        </div>
        <div className="wp-stat">
          <div className="wp-stat-l"><span className="gl">◉</span>Open marks</div>
          <div className="wp-stat-v">{open.length}<span className="u">/ {positions.length}</span></div>
          <div className="wp-stat-m">{open.length === 0 ? 'All positions closed' : 'Still in your bag'}</div>
        </div>
        <div className="wp-stat">
          <div className="wp-stat-l"><span className="gl">↑</span>Best mark</div>
          {best && best.realized_pnl_sol > 0
            ? <><div className="wp-stat-v gn">{formatSolSigned(best.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${best.sym || '???'}</div></>
            : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed winners yet</div></>}
        </div>
        <div className="wp-stat">
          <div className="wp-stat-l"><span className="gl">↓</span>Worst mark</div>
          {worst
            ? <><div className="wp-stat-v rd">{formatSolSigned(worst.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${worst.sym || '???'}</div></>
            : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed losers</div></>}
        </div>
      </div>

      <div className="wp-pos-frame">
        <div className="wp-pos-head"><span className="e">◉ Positions · {positions.length}</span><span style={{fontFamily:"'Fraunces'",fontWeight:500,fontSize:15,color:'rgba(244,239,255,.66)',marginLeft:'auto'}}>by most recent</span></div>
        <div className="wp-pos-row thead">
          <span className="wp-pos-no">№</span><span>Specimen</span>
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
                <div className="wp-pos-nm">
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

function StandingsSection({ walletStr, lb, lbLoading, lbError, win, setWin }) {
  const myRank = useMemo(() => {
    if (!lb || !lb.traders) return null;
    const idx = lb.traders.findIndex(t => t.wallet === walletStr);
    return idx >= 0 ? { rank: idx + 1, row: lb.traders[idx] } : null;
  }, [lb, walletStr]);

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Standings</span><span className="rule" /></div>
      <h1 className="wp-h1">The <span className="it">field</span>, ranked.</h1>
      <p className="wp-sub">Top hunters by SOL volume routed through the radar. Refreshes every thirty seconds. Your line is highlighted if you've logged anything in the window.</p>

      <div className="wp-win-tabs">
        <button className={'wp-win-tab' + (win === '24h' ? ' on' : '')} onClick={() => setWin('24h')}>24 hours</button>
        <button className={'wp-win-tab' + (win === '7d'  ? ' on' : '')} onClick={() => setWin('7d')}>7 days</button>
        <button className={'wp-win-tab' + (win === 'all' ? ' on' : '')} onClick={() => setWin('all')}>All time</button>
      </div>

      <div className="wp-lb-frame">
        <div className="wp-lb-row thead">
          <span>Rank</span><span>Hunter</span>
          <span style={{textAlign:'right'}}>Volume</span>
          <span className="wp-col-tr" style={{textAlign:'right'}}>Trades</span>
        </div>
        {lbError ? (
          <div className="wp-empty"><span className="gl">⊘</span><div className="h">Standings unreachable</div><div className="s">The server didn't return. Retrying automatically.</div><div className="e">{lbError}</div></div>
        ) : lbLoading && !lb ? (
          <div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Counting the field…</div><div className="s">Aggregating every trade in the window.</div></div>
        ) : !lb || lb.count === 0 ? (
          <div className="wp-empty"><span className="gl">∅</span><div className="h">No <span className="it">entries</span> logged in this window</div><div className="s">When trades start moving through the radar, the leaderboard fills here.</div></div>
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
            <div className="wp-lb-foot">
              <span>{lb.total_traders || lb.count} total hunters · top 50 shown</span>
              <span>Refreshed · {new Date(lb.ts || Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          </>
        )}
      </div>

      {myRank && lb && lb.count > 0 && (
        <div className="wp-card" style={{marginTop:18}}>
          <div className="wp-card-eye"><span className="gl">◉</span><span>Your standing</span></div>
          <div style={{display:'flex',alignItems:'baseline',gap:18,flexWrap:'wrap'}}>
            <div style={{fontFamily:"'Fraunces'",fontWeight:500,fontSize:38,letterSpacing:'-.025em',lineHeight:1}}>№ <span style={{color:'var(--magenta)'}}>{myRank.rank.toString().padStart(2, '0')}</span></div>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontFamily:"'JetBrains Mono'",fontSize:11,fontWeight:700,letterSpacing:'.6px',color:'rgba(244,239,255,.66)',textTransform:'uppercase',marginBottom:4}}>
                Of {lb.total_traders || lb.count} hunters · {win === '24h' ? 'last 24 hours' : win === '7d' ? 'last 7 days' : 'all time'}
              </div>
              <div style={{fontFamily:"'JetBrains Mono'",fontSize:14,fontWeight:700,color:'var(--ink)'}}>{formatSol(myRank.row.volume_sol)} SOL routed · {myRank.row.trades} trades</div>
            </div>
          </div>
        </div>
      )}
      {!myRank && lb && lb.count > 0 && (
        <div className="wp-card" style={{marginTop:18}}>
          <div className="wp-empty" style={{padding:'28px 16px'}}>
            <div className="h">Not on the board <span className="it">yet.</span></div>
            <div className="s">Log a trade through the radar in this window and you'll appear here.</div>
          </div>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   AUTO-TRADE — Balanced & Custom modes
   ════════════════════════════════════════════════════════════════ */

const BALANCED_SETTINGS = {
  perTradeSol:     0.2,
  takeProfitPct:   150,
  stopLossPct:     30,
  minAgeMin:       3,
  maxAgeMin:       30,
  minLiqUsd:       10000,
  minHolders:      30,
  minVibe:         40,
  maxOpen:         5,
  maxPerHour:      10,
};

const SAFETY_FLOOR = {
  dailyLossCapSol:    1.0,
  maxHoldMin:         30,
  ageMinAbsolute:     3,
  posPollMs:          7000,
};

const AT_SETTINGS_KEY   = 'lr_at_settings_v1';
const AT_STATE_KEY      = 'lr_at_state_v1';
const AT_POSITIONS_KEY  = 'lr_at_positions_v1';
const AT_POS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function loadCustomSettings() {
  try {
    const raw = localStorage.getItem(AT_SETTINGS_KEY);
    if (!raw) return { ...BALANCED_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...BALANCED_SETTINGS, ...parsed };
  } catch (e) { return { ...BALANCED_SETTINGS }; }
}
function saveCustomSettings(s) { try { localStorage.setItem(AT_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

function loadDailyState() {
  try {
    const raw = localStorage.getItem(AT_STATE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.day !== new Date().toDateString()) return null;
    return d;
  } catch (e) { return null; }
}
function saveDailyState(d) { try { localStorage.setItem(AT_STATE_KEY, JSON.stringify({ ...d, day: new Date().toDateString() })); } catch (e) {} }

function loadPositions() {
  try {
    const raw = localStorage.getItem(AT_POSITIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - AT_POS_MAX_AGE_MS;
    return arr
      .filter(p => p && p.mint && Number.isFinite(p.ts) && p.ts > cutoff && Number.isFinite(p.entryPriceUsd))
      .map(p => ({ ...p, exiting: false }));
  } catch (e) { return []; }
}
function savePositions(arr) { try { localStorage.setItem(AT_POSITIONS_KEY, JSON.stringify(arr || [])); } catch (e) {} }

function useAutoTrade(deps) {
  const { wallet, recentTokens, solBalance, solPrice, balances, executeSwap, refreshSol, refreshOneToken, pushToast } = deps;

  const initialDaily = useMemo(() => loadDailyState() || {}, []);

  const [enabled, setEnabled]   = useState(false);
  const [mode, setMode]         = useState('balanced');
  const [custom, setCustom]     = useState(() => loadCustomSettings());
  const [positions, setPositions] = useState(() => loadPositions());
  const [log, setLog]           = useState([]);
  const [stats, setStats]       = useState(() => ({
    scanned:  initialDaily.scanned  || 0,
    passed:   initialDaily.passed   || 0,
    traded:   initialDaily.traded   || 0,
    realized: initialDaily.realized || 0,
  }));
  const [paused, setPaused]     = useState(false);
  const recentTradesRef         = useRef(initialDaily.recentTradeTs || []);

  const config = mode === 'balanced' ? BALANCED_SETTINGS : custom;

  const evaluatedRef = useRef(new Set());
  const firingRef    = useRef(new Set());
  const positionsRef = useRef([]);
  useEffect(() => {
    positionsRef.current = positions;
    for (const p of positions) firingRef.current.delete(p.mint);
  }, [positions]);

  const appendLog = useCallback((tag, msg) => {
    setLog(prev => [{ ts: Date.now(), tag, msg }, ...prev].slice(0, 120));
  }, []);

  useEffect(() => { savePositions(positions); }, [positions]);

  useEffect(() => {
    saveDailyState({
      scanned: stats.scanned, passed: stats.passed, traded: stats.traded, realized: stats.realized,
      recentTradeTs: recentTradesRef.current,
    });
  }, [stats]);

  useEffect(() => { if (mode === 'custom') saveCustomSettings(custom); }, [custom, mode]);

  useEffect(() => {
    if (!paused && stats.realized <= -SAFETY_FLOOR.dailyLossCapSol) {
      setPaused(true);
      appendLog('info', '· daily loss cap reached — auto paused for the day');
      if (pushToast) pushToast({ kind: 'info', emoji: '⏸', body: <><b>Auto paused</b><br/>Daily loss cap reached. Resumes tomorrow.</>, duration: 9000 });
    }
  }, [stats.realized, paused, appendLog, pushToast]);

  useEffect(() => {
    if (positions.length > 0 && log.length === 0) {
      appendLog('info', '· restored ' + positions.length + ' position(s) from previous session');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || paused) return;
    if (!recentTokens || recentTokens.length === 0) return;
    let cancelled = false;

    (async () => {
      let runSpentSol = 0;

      for (const token of recentTokens) {
        if (cancelled) return;
        if (evaluatedRef.current.has(token.mint)) continue;
        evaluatedRef.current.add(token.mint);
        setStats(s => ({ ...s, scanned: s.scanned + 1 }));

        if (positionsRef.current.some(p => p.mint === token.mint)) continue;
        if (firingRef.current.has(token.mint)) continue;

        if (positionsRef.current.length + firingRef.current.size >= config.maxOpen) {
          appendLog('skip', '· ' + token.sym + ' — at max positions (' + config.maxOpen + ')');
          continue;
        }

        const hourAgo = Date.now() - 3600000;
        recentTradesRef.current = recentTradesRef.current.filter(ts => ts > hourAgo);
        if (recentTradesRef.current.length >= config.maxPerHour) {
          appendLog('skip', '· ' + token.sym + ' — hourly cap (' + config.maxPerHour + '/hr)');
          continue;
        }

        if (Math.abs(Math.min(0, stats.realized)) >= SAFETY_FLOOR.dailyLossCapSol) {
          appendLog('skip', '· daily loss cap hit, pausing for the day');
          setPaused(true);
          return;
        }

        const ageMs = token.pairCreatedAtMs ? Date.now() - token.pairCreatedAtMs : 0;
        const minAgeMs = Math.max(SAFETY_FLOOR.ageMinAbsolute, config.minAgeMin) * 60000;
        if (ageMs < minAgeMs) {
          appendLog('skip', '· ' + token.sym + ' — too fresh (' + Math.floor(ageMs/1000) + 's)');
          continue;
        }
        if (ageMs > config.maxAgeMin * 60000) {
          appendLog('skip', '· ' + token.sym + ' — too old (' + Math.floor(ageMs/60000) + 'm)');
          continue;
        }

        if ((token.liquidity || 0) < config.minLiqUsd) {
          appendLog('skip', '· ' + token.sym + ' — thin liq ' + formatMoney(token.liquidity || 0));
          continue;
        }
        if ((token.holders || 0) < config.minHolders) {
          appendLog('skip', '· ' + token.sym + ' — low holders (' + (token.holders || 0) + ')');
          continue;
        }
        const vibe = riskRead(token);
        if (vibe.score < config.minVibe) {
          appendLog('skip', '· ' + token.sym + ' — vibe ' + vibe.score + ' below floor');
          continue;
        }

        const walletSol = (solBalance && solBalance.uiAmount) || 0;
        const availSol = Math.max(0, walletSol - SOL_RESERVE - runSpentSol);
        if (config.perTradeSol > availSol) {
          appendLog('error', '· ' + token.sym + ' — need ' + config.perTradeSol + ' SOL, have ' + formatSol(availSol));
          continue;
        }

        try {
          const r = await fetch('/api/honeypot-check/' + encodeURIComponent(token.mint));
          const d = await r.json();
          if (!d.safe) {
            appendLog('skip', '· ' + token.sym + ' — failed honeypot: ' + (d.reasons?.[0] || 'unsafe'));
            continue;
          }
        } catch (e) {
          appendLog('skip', '· ' + token.sym + ' — honeypot check unavailable');
          continue;
        }

        setStats(s => ({ ...s, passed: s.passed + 1 }));
        if (firingRef.current.has(token.mint)) continue;
        firingRef.current.add(token.mint);

        try {
          const params = buildBuyParams(config.perTradeSol);
          if (!params) {
            appendLog('error', '· ' + token.sym + ' — could not build trade');
            firingRef.current.delete(token.mint);
            continue;
          }

          appendLog('buy', '· ' + token.sym + ' (vibe ' + vibe.score + ', ' + Math.floor(ageMs/60000) + 'm old, ' + formatMoney(token.liquidity) + ' liq)');
          const res = await executeSwap({ mode: 'buy', swapParams: params, token });

          if (res && res.confirmed) {
            runSpentSol += config.perTradeSol;
            recentTradesRef.current.push(Date.now());
            const tokensReceived = (token.price > 0 && solPrice > 0)
              ? (Number(params.tradeLamports)/1e9 * solPrice) / token.price : 0;
            setPositions(p => [...p, {
              mint: token.mint, sym: token.sym, name: token.name, icon: token.icon,
              entrySol: config.perTradeSol,
              entryTokens: tokensReceived,
              entryPriceUsd: token.price,
              peakPriceUsd: token.price,
              currentPriceUsd: token.price,
              ts: Date.now(),
              exiting: false,
            }]);
            setStats(s => ({ ...s, traded: s.traded + 1 }));
            appendLog('buy', '✓ ' + token.sym + ' filled at ' + formatPrice(token.price));
            refreshSol();
            setTimeout(() => refreshOneToken(token.mint), 3000);
          } else {
            firingRef.current.delete(token.mint);
            appendLog('error', '· ' + token.sym + ' — not confirmed');
          }
        } catch (e) {
          firingRef.current.delete(token.mint);
          appendLog('error', '· ' + token.sym + ' — ' + friendlyError(e));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, paused, recentTokens, config, solBalance, solPrice, executeSwap, refreshSol, refreshOneToken, appendLog, stats.realized]);

  const sellPositionRef = useRef(null);

  useEffect(() => {
    if (positions.length === 0) return;
    let cancelled = false;

    const tick = async () => {
      const snapshot = positionsRef.current.slice();
      for (const pos of snapshot) {
        if (cancelled) return;
        if (pos.exiting) continue;

        let priceUsd = pos.currentPriceUsd;
        try {
          const r = await fetch('/api/dex/token/' + encodeURIComponent(pos.mint));
          if (r.ok) {
            const d = await r.json();
            const p = Number(d?.token?.price);
            if (Number.isFinite(p) && p > 0) priceUsd = p;
          }
        } catch (e) {}

        const peakPriceUsd = Math.max(pos.peakPriceUsd, priceUsd);
        const pnlPct = pos.entryPriceUsd > 0 ? ((priceUsd / pos.entryPriceUsd) - 1) * 100 : 0;
        const ageMin = (Date.now() - pos.ts) / 60000;

        let exitReason = null;
        if (pnlPct >= config.takeProfitPct)         exitReason = 'TP +' + Math.round(pnlPct) + '%';
        else if (pnlPct <= -config.stopLossPct)     exitReason = 'SL ' + Math.round(pnlPct) + '%';
        else if (ageMin >= SAFETY_FLOOR.maxHoldMin) exitReason = 'max hold ' + SAFETY_FLOOR.maxHoldMin + 'm';

        setPositions(prev => prev.map(p => p.mint === pos.mint ? { ...p, currentPriceUsd: priceUsd, peakPriceUsd } : p));

        if (exitReason) {
          if (sellPositionRef.current) {
            await sellPositionRef.current(pos, exitReason);
          }
        }
      }
    };

    const id = setInterval(tick, SAFETY_FLOOR.posPollMs);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [positions.length, config.takeProfitPct, config.stopLossPct]);

  const sellPosition = useCallback(async (pos, reason) => {
    const live = positionsRef.current.find(p => p.mint === pos.mint);
    if (!live || live.exiting) return;
    setPositions(prev => prev.map(p => p.mint === pos.mint ? { ...p, exiting: true } : p));
    appendLog('sell', '· ' + pos.sym + ' — ' + reason);

    let success = false;
    try {
      const bal = balances[pos.mint];
      if (!bal || !bal.amount || BigInt(bal.amount) <= 0n) {
        appendLog('info', '· ' + pos.sym + ' — no balance to sell, removing');
        success = true;
        return;
      }
      const params = buildSellParams({ price: pos.currentPriceUsd, decimals: bal.decimals }, 100, bal, solPrice);
      if (!params) {
        appendLog('error', '· ' + pos.sym + ' — could not build sell, will retry');
        return;
      }
      const token = { mint: pos.mint, sym: pos.sym, name: pos.name, price: pos.currentPriceUsd, decimals: bal.decimals };
      const res = await executeSwap({ mode: 'sell', swapParams: params, token });

      if (res && res.confirmed) {
        success = true;
        const grossSol = (params.tradeTokensUi * pos.currentPriceUsd) / solPrice;
        const netSol = grossSol * (1 - FEE_BPS/10000);
        const realizedDelta = netSol - pos.entrySol;
        const sign = realizedDelta >= 0 ? '+' : '';
        appendLog('sell', '✓ ' + pos.sym + ' closed · ' + sign + formatSol(realizedDelta) + ' SOL');

        setStats(s => ({ ...s, realized: s.realized + realizedDelta }));
      } else {
        appendLog('error', '· ' + pos.sym + ' — exit not confirmed, will retry');
      }
    } catch (e) {
      appendLog('error', '· ' + pos.sym + ' exit — ' + friendlyError(e));
    } finally {
      if (success) {
        setPositions(prev => prev.filter(p => p.mint !== pos.mint));
      } else {
        setPositions(prev => prev.map(p => p.mint === pos.mint ? { ...p, exiting: false } : p));
      }
      refreshSol();
      setTimeout(() => refreshOneToken(pos.mint), 3000);
    }
  }, [balances, solPrice, executeSwap, refreshSol, refreshOneToken, appendLog, pushToast]);

  useEffect(() => { sellPositionRef.current = sellPosition; }, [sellPosition]);

  const closeManual = useCallback((pos) => { sellPosition(pos, 'manual close'); }, [sellPosition]);

  const killSwitch = useCallback(() => {
    setEnabled(false);
    appendLog('info', '· auto-trade stopped by user');
  }, [appendLog]);

  const flattenAll = useCallback(async () => {
    setEnabled(false);
    const snapshot = positionsRef.current.slice();
    appendLog('info', '· flattening ' + snapshot.length + ' position(s)');
    for (const pos of snapshot) {
      await sellPosition(pos, 'flatten all');
    }
  }, [sellPosition, appendLog]);

  const resumeFromPause = useCallback(() => {
    setPaused(false);
    setStats(s => ({ ...s, realized: 0 }));
    appendLog('info', '· resumed — daily counter reset, you have another ' + SAFETY_FLOOR.dailyLossCapSol + ' SOL of rope');
  }, [appendLog]);

  return {
    enabled, setEnabled, mode, setMode, custom, setCustom,
    positions, log, stats, paused,
    config, killSwitch, flattenAll, closeManual, resumeFromPause,
  };
}

/* ── Auto-trade panel UI ──────────────────────────────────────── */

function AutoSlider({ label, labelIt, value, unit, min, max, step, onChange, desc }) {
  return (
    <div className="wa-slider">
      <div className="wa-slider-top">
        <div className="wa-slider-lbl">{label} {labelIt && <span className="it">{labelIt}</span>}</div>
        <div className="wa-slider-v">{value}<span className="u">{unit}</span></div>
      </div>
      <div className="wa-slider-desc">{desc}</div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function AutoPanel({ open, onClose, autoState }) {
  const a = autoState;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const statusPill = a.paused
    ? <span className="wa-stat-pill paused">⏸ paused</span>
    : a.enabled
      ? <span className="wa-stat-pill on"><span className="d" />watching</span>
      : <span className="wa-stat-pill off">○ off</span>;

  const _feeMul = (1 - FEE_BPS/10000);
  const positionPnlSol = (p) => {
    if (!(p.entryPriceUsd > 0) || !(p.currentPriceUsd > 0)) return 0;
    const ratio = p.currentPriceUsd / p.entryPriceUsd;
    return p.entrySol * _feeMul * ratio * _feeMul - p.entrySol;
  };
  const openPnl = a.positions.reduce((sum, p) => sum + positionPnlSol(p), 0);

  return (
    <div className="wa-root">
      <div className="wa-head">
        <div className="wr-brand">
          <div className="wr-radar-icon" />
          <span className="wr-bname">wonderland<span className="sep">//</span><span className="it">radar</span></span>
        </div>
        {statusPill}
        <button className="wa-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="wa-page">
        <div className="wa-eye"><span className="gl">◉</span><span>Section § Auto-trade</span><span className="rule" /></div>
        <h1 className="wa-h1">The radar <span className="it">works for you.</span></h1>
        <p className="wa-sub">We wait three minutes for the dust to settle, screen every token for honeypots and red flags, then buy the survivors that match your preset. Exits are managed for you. You can stop it any time.</p>

        {a.paused && (
          <div className="wa-pause-banner">
            <span className="gl">⏸</span>
            <div className="t">
              <div className="h">Auto paused for the day</div>
              <div className="b">Daily loss cap reached. Resumes automatically tomorrow, or resume now.</div>
            </div>
            <button onClick={a.resumeFromPause}>RESUME</button>
          </div>
        )}

        <div className={'wa-master' + (a.enabled && !a.paused ? ' on' : '') + (a.paused ? ' paused' : '')}>
          <div className="wa-master-l">
            <div className={'wa-master-h' + (a.enabled && !a.paused ? ' on' : '')}>
              Auto-trade is <span className="it">{a.paused ? 'paused' : a.enabled ? 'on' : 'off'}.</span>
            </div>
            <div className="wa-master-s">
              {a.enabled && !a.paused
                ? 'Scanning the feed. New entries that pass your filters will be bought automatically.'
                : 'Toggle on when you\'re ready. Settings stay locked while running.'}
            </div>
          </div>
          <div className={'wa-tog' + (a.enabled ? ' on' : '')} onClick={() => !a.paused && a.setEnabled(!a.enabled)} role="switch" aria-checked={a.enabled} />
        </div>

        <div className={'wa-modes' + (a.mode === 'custom' ? ' custom' : '')}>
          <div className="wa-mode-ind" />
          <button className={'wa-mode-t' + (a.mode === 'balanced' ? ' active' : '')} onClick={() => a.setMode('balanced')}>Balanced</button>
          <button className={'wa-mode-t' + (a.mode === 'custom'   ? ' active' : '')} onClick={() => a.setMode('custom')}>Custom</button>
        </div>

        {a.mode === 'balanced' && (
          <div className="wa-locked-card">
            <div className="wa-locked-eye"><span>◌</span><span>What's locked in</span></div>
            <div className="wa-locked-grid">
              <div className="wa-locked-row"><span className="wa-locked-k">Per trade</span><span className="wa-locked-v">{BALANCED_SETTINGS.perTradeSol}<span className="u">SOL</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Take profit</span><span className="wa-locked-v gn">+{BALANCED_SETTINGS.takeProfitPct}<span className="u">%</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Stop loss</span><span className="wa-locked-v rd">−{BALANCED_SETTINGS.stopLossPct}<span className="u">%</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Token age</span><span className="wa-locked-v">{BALANCED_SETTINGS.minAgeMin}–{BALANCED_SETTINGS.maxAgeMin}<span className="u">min</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min liquidity</span><span className="wa-locked-v">${(BALANCED_SETTINGS.minLiqUsd/1000).toFixed(0)}K</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Min holders</span><span className="wa-locked-v">{BALANCED_SETTINGS.minHolders}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Vibe floor</span><span className="wa-locked-v">{BALANCED_SETTINGS.minVibe}<span className="u">/ 85</span></span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Open positions</span><span className="wa-locked-v">max {BALANCED_SETTINGS.maxOpen}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Trades / hour</span><span className="wa-locked-v">max {BALANCED_SETTINGS.maxPerHour}</span></div>
              <div className="wa-locked-row"><span className="wa-locked-k">Daily loss cap</span><span className="wa-locked-v rd">−{SAFETY_FLOOR.dailyLossCapSol}<span className="u">SOL</span></span></div>
            </div>
            <div className="wa-floor">
              <b>Always on, both modes:</b> honeypot scan · daily loss cap · 3-minute age floor · max-hold timer ({SAFETY_FLOOR.maxHoldMin}m). These aren't features. They're the floor.
            </div>
          </div>
        )}

        {a.mode === 'custom' && (
          <div className="wa-sliders">
            <AutoSlider label="Per trade" value={a.custom.perTradeSol} unit=" SOL" min={0.05} max={2} step={0.05}
              onChange={(v) => a.setCustom({ ...a.custom, perTradeSol: v })}
              desc={<>How much SOL on each buy. <b>Bigger = bigger wins and bigger losses.</b> We cap every trade at this; nothing more.</>} />
            <AutoSlider label="Take profit" labelIt="(+)" value={a.custom.takeProfitPct} unit="%" min={50} max={1000} step={10}
              onChange={(v) => a.setCustom({ ...a.custom, takeProfitPct: v })}
              desc={<>Sell automatically when up this much. <b>Lower = more frequent small wins.</b> Higher = waiting for runners and watching some round-trip.</>} />
            <AutoSlider label="Stop loss" labelIt="(−)" value={a.custom.stopLossPct} unit="%" min={10} max={50} step={5}
              onChange={(v) => a.setCustom({ ...a.custom, stopLossPct: v })}
              desc={<>Sell automatically when down this much. <b>Tighter protects more but gets whipped by normal swings.</b> Looser survives volatility but costs more when wrong.</>} />
            <AutoSlider label="Token age" labelIt="(min)" value={a.custom.minAgeMin} unit=" min" min={3} max={20} step={1}
              onChange={(v) => a.setCustom({ ...a.custom, minAgeMin: v })}
              desc={<>Skip anything younger. <b>3-minute floor is hardcoded</b> — most rugs die before then. Above 5 adds more safety; above 15 you're chasing.</>} />
            <AutoSlider label="Min liquidity" value={(a.custom.minLiqUsd/1000).toFixed(0)} unit="K USD" min={1} max={100} step={1}
              onChange={(v) => a.setCustom({ ...a.custom, minLiqUsd: v * 1000 })}
              desc={<>Skip tokens with less liquidity. <b>Low = price swings wildly</b> on every trade. Too high = miss small launches that might run.</>} />
            <AutoSlider label="Min holders" value={a.custom.minHolders} unit="" min={0} max={200} step={5}
              onChange={(v) => a.setCustom({ ...a.custom, minHolders: v })}
              desc={<>Skip tokens with fewer holders. <b>More holders = more organic interest.</b> Below 20 you're often the only retail buyer in the room.</>} />
            <AutoSlider label="Vibe score" labelIt="floor" value={a.custom.minVibe} unit="/ 85" min={0} max={85} step={1}
              onChange={(v) => a.setCustom({ ...a.custom, minVibe: v })}
              desc={<>Our combined risk read. <b>Higher = fewer trades, safer picks.</b> Below 30 you've effectively turned the filter off.</>} />
            <AutoSlider label="Open positions" labelIt="max" value={a.custom.maxOpen} unit="" min={1} max={10} step={1}
              onChange={(v) => a.setCustom({ ...a.custom, maxOpen: v })}
              desc={<>How many trades held at once. <b>More = more shots on goal but bigger total exposure</b> if several rug together.</>} />
            <AutoSlider label="Trades / hour" labelIt="max" value={a.custom.maxPerHour} unit="" min={1} max={30} step={1}
              onChange={(v) => a.setCustom({ ...a.custom, maxPerHour: v })}
              desc={<>Caps firing rate. <b>Prevents revenge-trading after losses</b> and over-exposure during hot streaks.</>} />
            <div className="wa-floor">
              <b>Always on, can't be changed:</b> honeypot scan · daily loss cap (−{SAFETY_FLOOR.dailyLossCapSol} SOL) · 3-min age floor · {SAFETY_FLOOR.maxHoldMin}-min max-hold timer. These aren't features. They're the floor.
            </div>
          </div>
        )}

        <div className="wa-stats">
          <div className="wa-statc">
            <div className="wa-statc-l">Scanned today</div>
            <div className="wa-statc-v">{a.stats.scanned.toLocaleString()}</div>
          </div>
          <div className="wa-statc">
            <div className="wa-statc-l">Passed filters</div>
            <div className="wa-statc-v">{a.stats.passed}</div>
          </div>
          <div className="wa-statc">
            <div className="wa-statc-l">Trades fired</div>
            <div className="wa-statc-v">{a.stats.traded}</div>
          </div>
          <div className="wa-statc">
            <div className="wa-statc-l">Realized P&L</div>
            <div className={'wa-statc-v ' + (a.stats.realized > 0.0001 ? 'gn' : a.stats.realized < -0.0001 ? 'rd' : 'dim')}>
              {Math.abs(a.stats.realized) > 0.0001 ? formatSolSigned(a.stats.realized) : '—'}
              {Math.abs(a.stats.realized) > 0.0001 ? <span className="u">SOL</span> : null}
            </div>
          </div>
        </div>

        <div className="wa-pos-frame">
          <div className="wa-section-head"><span>◉ Open positions</span><span className="count">{a.positions.length} · open {openPnl >= 0 ? '+' : ''}{formatSol(openPnl)} SOL</span></div>
          {a.positions.length === 0 ? (
            <div className="wa-empty">
              <span className="gl">∅</span>
              <div className="h">No open <span className="it">marks.</span></div>
              <div className="s">{a.enabled ? 'Watching the feed. Buys will show up here.' : 'Toggle auto-trade on to start.'}</div>
            </div>
          ) : a.positions.map(pos => {
            const c = colorFor(pos.mint);
            const pnlPct = pos.entryPriceUsd > 0 ? ((pos.currentPriceUsd / pos.entryPriceUsd) - 1) * 100 : 0;
            const pnlSol = positionPnlSol(pos);
            const pos_ = pnlSol > 0.0001, neg_ = pnlSol < -0.0001;
            const ageMin = (Date.now() - pos.ts) / 60000;
            return (
              <div className="wa-pos-row" key={pos.mint}>
                <div className="wa-pos-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(pos.sym || '?').charAt(0)}</div>
                <div className="wa-pos-nm">
                  <div className="wa-pos-sym">${pos.sym || '???'}</div>
                  <div className="wa-pos-time">held {ageMin < 1 ? '<1m' : Math.floor(ageMin) + 'm'} · {formatSol(pos.entrySol)} in</div>
                </div>
                <div className="wa-pos-pnl">
                  <div className={'wa-pos-pnl-v ' + (pos_ ? 'gn' : neg_ ? 'rd' : '')}>{formatSolSigned(pnlSol)}</div>
                  <div className={'wa-pos-pnl-p ' + (pos_ ? 'gn' : neg_ ? 'rd' : '')}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>
                </div>
                <button className="wa-pos-close" disabled={pos.exiting} onClick={() => a.closeManual(pos)}>
                  {pos.exiting ? '...' : 'CLOSE'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="wa-log-frame">
          <div className="wa-section-head"><span>§ Today's log</span><span className="count">{a.log.length} entries</span></div>
          <div className="wa-log-list">
            {a.log.length === 0 ? (
              <div className="wa-empty">
                <span className="gl">∅</span>
                <div className="h">Nothing logged <span className="it">yet.</span></div>
                <div className="s">Every action — buys, sells, skips, errors — shows up here in real time.</div>
              </div>
            ) : a.log.map((e, i) => {
              const t = new Date(e.ts);
              const hh = t.getHours().toString().padStart(2,'0');
              const mm = t.getMinutes().toString().padStart(2,'0');
              return (
                <div className="wa-log-row" key={i}>
                  <span className="wa-log-ts">{hh}:{mm}</span>
                  <span className={'wa-log-tag ' + e.tag}>{e.tag}</span>
                  <span className="wa-log-msg">{e.msg}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(a.enabled || a.positions.length > 0) && (
        <div className="wa-kill">
          {a.enabled && (
            <button className="wa-kill-btn stop" onClick={a.killSwitch}>
              STOP AUTO-TRADE
            </button>
          )}
          {a.positions.length > 0 && (
            <button className="wa-kill-btn flat" onClick={() => { if (window.confirm('Flatten all ' + a.positions.length + ' position(s) at market?')) a.flattenAll(); }}>
              FLATTEN ALL ({a.positions.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatsPanel({ open, onClose, wallet, mainWalletPubkey, solPrice }) {
  const [tab, setTab] = useState('referrals');
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
  const [toast, setToast] = useState(null);

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
    if (tab === 'referrals') { if (refWalletStr) fetchStats(); }
    else if (tab === 'fieldlog') { if (burnerWalletStr) fetchPnl(); }
    else if (tab === 'standings') { fetchLb(lbWin); }
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (tab === 'referrals') { if (refWalletStr) fetchStats(); }
      else if (tab === 'fieldlog') { if (burnerWalletStr) fetchPnl(); }
      else if (tab === 'standings') { fetchLb(lbWin); }
    }, 30000);
    return () => clearInterval(id);
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const onBoostActivated = useCallback(() => { fetchStats(); setToast('✓ Boost active'); setTimeout(() => setToast(null), 2200); }, [fetchStats]);

  if (!open) return null;

  return (
    <div className="wp-root">
      <div className="wp-head">
        <div className="wr-brand">
          <div className="wr-radar-icon" />
          <span className="wr-bname">wonderland<span className="sep">//</span><span className="it">radar</span></span>
        </div>
        <div className="wp-headlbl"><span className="d" /><span>FIELD LOG · PERSONAL</span></div>
        <button className="wp-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="wp-tabs">
        <button className={'wp-tab' + (tab === 'referrals' ? ' on' : '')} onClick={() => setTab('referrals')}><span className="glyph">§ 01</span><span>Referrals</span></button>
        <button className={'wp-tab' + (tab === 'fieldlog' ? ' on' : '')} onClick={() => setTab('fieldlog')}><span className="glyph">§ 02</span><span>Field log</span></button>
        <button className={'wp-tab' + (tab === 'standings' ? ' on' : '')} onClick={() => setTab('standings')}><span className="glyph">§ 03</span><span>Standings</span></button>
      </div>

      <div className="wp-page" key={tab}>
        {tab === 'referrals' && <ReferralsSection walletStr={refWalletStr} stats={stats} statsLoading={statsLoading} statsError={statsError} onBoostActivated={onBoostActivated} />}
        {tab === 'fieldlog' && <FieldLogSection walletStr={burnerWalletStr} pnl={pnl} pnlLoading={pnlLoading} pnlError={pnlError} solPrice={solPrice} />}
        {tab === 'standings' && <StandingsSection walletStr={burnerWalletStr} lb={lb} lbLoading={lbLoading} lbError={lbError} win={lbWin} setWin={setLbWin} />}
      </div>

      {toast && <div className="wp-toast"><span className="gl">✓</span><span>{toast}</span></div>}
    </div>
  );
}

/* ============================ PRESETS ============================ */
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

function PresetsModal({ buyPresets, setBuyPresets, sellPresets, setSellPresets, onClose }) {
  const [buyDraft, setBuyDraft] = useState(buyPresets);
  const [sellDraft, setSellDraft] = useState(sellPresets);
  const [nb, setNb] = useState(''); const [ns, setNs] = useState('');
  const addBuy = () => { const v = parseFloat(nb); if (!(v > 0) || buyDraft.includes(v)) { setNb(''); return; } setBuyDraft([...buyDraft, v].sort((a,b)=>a-b)); setNb(''); };
  const addSell = () => { const v = parseFloat(ns); if (!(v > 0) || v > 100 || sellDraft.includes(v)) { setNs(''); return; } setSellDraft([...sellDraft, v].sort((a,b)=>a-b)); setNs(''); };
  const save = () => { setBuyPresets(buyDraft.length ? buyDraft : DEFAULT_BUY_PRESETS); setSellPresets(sellDraft.length ? sellDraft : DEFAULT_SELL_PRESETS); onClose(); };
  return (
    <div className="wr-overlay center" onClick={onClose}>
      <div className="wr-sheet mini" onClick={e=>e.stopPropagation()}>
        <div className="wr-tshead">
          <button className="wr-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Fraunces'",fontWeight:500,fontSize:24,margin:0,letterSpacing:'-.015em'}}>Quick amounts</h3>
          <div style={{fontFamily:"'JetBrains Mono'",fontSize:10.5,color:'var(--ink2)',marginTop:5,fontWeight:600,letterSpacing:'.3px'}}>Tap to set · edit any time</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="wr-sec-lbl">Buy amounts (SOL)</div>
          <div className="wr-echips">
            {buyDraft.map(v => <span key={v} className="wr-echip">{v}<button className="x" onClick={()=>setBuyDraft(buyDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="wr-eadd"><input type="number" step="0.01" min="0" placeholder="0.5" value={nb} onChange={e=>setNb(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addBuy();}} /><button className="plus" onClick={addBuy}>+</button></span>
          </div>
          <div className="wr-sec-lbl">Sell amounts (%)</div>
          <div className="wr-echips">
            {sellDraft.map(v => <span key={v} className="wr-echip">{v}%<button className="x" onClick={()=>setSellDraft(sellDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="wr-eadd"><input type="number" step="1" min="1" max="100" placeholder="50" value={ns} onChange={e=>setNs(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addSell();}} /><button className="plus" onClick={addSell}>+</button></span>
          </div>
          <button className="wr-esave" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function WalletDrawer({ wallet, solBalance, solPrice, onWithdraw, onClose, busy }) {
  const [tab, setTab] = useState('deposit');
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState(''); const [amt, setAmt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const qrRef = useRef(null);
  const addr = wallet.publicKey.toBase58();
  const sol = (solBalance && solBalance.uiAmount) || 0;

  useEffect(() => {
    if (tab !== 'deposit' || !qrRef.current) return;
    let alive = true;
    (async () => {
      try {
        const QR = await import('qrcode');
        if (!alive || !qrRef.current) return;
        const toCanvas = QR.toCanvas || (QR.default && QR.default.toCanvas);
        if (typeof toCanvas === 'function') await toCanvas(qrRef.current, addr, { width: 160, margin: 1, color: { dark: '#0E0B1F', light: '#ffffff' } });
      } catch (e) {}
    })();
    return () => { alive = false; };
  }, [tab, addr]);

  const copy = () => { try { navigator.clipboard.writeText(addr); setCopied(true); setTimeout(()=>setCopied(false), 1500); } catch (e) {} };
  const maxOut = Math.max(0, sol - 0.001);

  return (
    <div className="wr-overlay" onClick={onClose}>
      <div className="wr-sheet" onClick={e=>e.stopPropagation()}>
        <div className="wr-tshead">
          <button className="wr-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Fraunces'",fontWeight:500,fontSize:24,margin:0,letterSpacing:'-.015em',display:'flex',alignItems:'center',gap:10}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'var(--mint)',boxShadow:'0 0 8px var(--mint)'}} />Your wallet
          </h3>
          <div style={{fontFamily:"'JetBrains Mono'",fontSize:10.5,color:'var(--ink2)',marginTop:5,fontWeight:600,letterSpacing:'.3px'}}>lives on this device · signs instantly · your keys</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="wr-balcard">
            <div className="wr-ballbl">Ready to trade</div>
            <div className="wr-balval">{formatSol(sol)} <span className="u">SOL</span></div>
            <div className="wr-balusd">{solPrice > 0 ? '≈ $' + format(sol * solPrice) : ' '}</div>
          </div>
          <div className="wr-wgrid">
            <button className={'wr-wact' + (tab==='deposit'?' primary':'')} onClick={()=>setTab('deposit')}>↓ Deposit</button>
            <button className={'wr-wact' + (tab==='withdraw'?' primary':'')} onClick={()=>setTab('withdraw')}>↑ Withdraw</button>
          </div>
          {tab === 'deposit' && (
            <div className="wr-block">
              <div className="wr-block-l">Send SOL to this address</div>
              <div className="wr-qr"><canvas ref={qrRef} width="160" height="160" /></div>
              <div className="wr-addr"><div className="wr-addr-v">{addr}</div><button className="wr-copy" onClick={copy}>{copied?'COPIED':'COPY'}</button></div>
            </div>
          )}
          {tab === 'withdraw' && (
            <div className="wr-block">
              <div className="wr-block-l">Send SOL out</div>
              <input className="wr-input" placeholder="Destination address" value={dest} onChange={e=>setDest(e.target.value.trim())} />
              <input className="wr-input" type="number" step="0.001" placeholder={'Amount (max ' + formatSol(maxOut) + ')'} value={amt} onChange={e=>setAmt(e.target.value)} />
              <button className="wr-go" disabled={busy || !dest || !(Number(amt) > 0) || Number(amt) > maxOut} onClick={()=>onWithdraw(dest, Number(amt))}>{busy ? 'Sending…' : 'Withdraw ' + (Number(amt) > 0 ? Number(amt) + ' SOL' : '')}</button>
            </div>
          )}
          <div className="wr-block">
            <div className="wr-block-l">Back up your wallet {wallet.backedUp ? '✓' : ''}</div>
            {!revealed ? (
              <button className="wr-go" style={{background:'var(--vapor2)',color:'var(--butter)',boxShadow:'none'}} onClick={()=>{ setRevealed(true); wallet.markBackedUp(); }}>Show secret key</button>
            ) : (
              <>
                <div className="wr-secret">{wallet.exportSecret()}</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button className="wr-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>{ try{navigator.clipboard.writeText(wallet.exportSecret());}catch(e){} }}>COPY KEY</button>
                  <button className="wr-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>setRevealed(false)}>HIDE</button>
                </div>
              </>
            )}
            <div style={{fontFamily:"'JetBrains Mono'",fontSize:10,color:'var(--ink3)',marginTop:8,fontWeight:600,lineHeight:1.5}}>Save this somewhere safe. Anyone with it controls this wallet. Import into Phantom ("Import private key") to recover.</div>
          </div>
          <div className="wr-warn"><b>Hot burner.</b> Keep only trade-money here. The key is stored on this device — clear your browser and it's gone unless you backed it up.</div>
          <div style={{textAlign:'center'}}><span className="wr-nc">● Non-custodial · your keys</span></div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   NEW — FILTERS MODAL.  Wild-only + min-liq.
   Called from the .wr-filter-btn in the new sortbar.
   ════════════════════════════════════════════════════════════════ */
function FiltersModal({ wildOnly, setWildOnly, minLiq, setMinLiq, onClose }) {
  const liqOptions = [0, 5000, 20000, 50000];
  return (
    <div className="wr-overlay center" onClick={onClose}>
      <div className="wr-sheet mini" onClick={e => e.stopPropagation()}>
        <div className="wr-tshead">
          <button className="wr-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Fraunces'",fontWeight:500,fontSize:24,margin:0,letterSpacing:'-.015em'}}>Filters</h3>
          <div style={{fontFamily:"'JetBrains Mono'",fontSize:10.5,color:'var(--ink2)',marginTop:5,fontWeight:600,letterSpacing:'.3px'}}>Narrow the feed</div>
        </div>
        <div style={{padding:'8px 22px 22px'}}>
          <div className="wr-filter-row">
            <div>
              <div className="lbl">Wild only</div>
              <div className="lbl-sub">Show only high-risk · high-reward specimens</div>
            </div>
            <div className={'wr-toggle' + (wildOnly ? ' on' : '')} onClick={() => setWildOnly(!wildOnly)} role="switch" aria-checked={wildOnly} />
          </div>
          <div className="wr-filter-row" style={{flexDirection:'column',alignItems:'stretch'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:12}}>
              <div className="lbl">Minimum liquidity</div>
              <div style={{fontFamily:"'JetBrains Mono'",fontSize:11,fontWeight:700,color:'var(--ink2)'}}>{minLiq ? '$' + format(minLiq) : 'any'}</div>
            </div>
            <div className="lbl-sub" style={{marginBottom:6}}>Filter out thin pools</div>
            <div className="wr-liq-chips">
              {liqOptions.map(v => (
                <button key={v} className={'wr-liq-chip' + (minLiq === v ? ' on' : '')} onClick={() => setMinLiq(v)}>
                  {v === 0 ? 'Any' : '$' + (v >= 1000 ? (v/1000) + 'K' : v)}
                </button>
              ))}
            </div>
          </div>
          <button className="wr-esave" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   NEW — OPEN POSITIONS STRIP.  Live P&L for held positions.
   ════════════════════════════════════════════════════════════════
   Polls /api/ref/pnl every 30s for the wallet's open positions, then
   per-mint /api/dex/token/:mint for current prices. Computes unrealized
   P&L = currentValueSol − costBasisSol. Shows top 3 by absolute size,
   plus a rollup. Only renders when there's at least one open position.
   ════════════════════════════════════════════════════════════════ */
function OpenPositionsStrip({ walletStr, solPrice, onOpenStats }) {
  const [positions, setPositions] = useState([]);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    if (!walletStr) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/ref/pnl?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const open = (d.positions || []).filter(p => p.open && p.open_tokens > 0);
        setPositions(open);

        const next = {};
        await Promise.all(open.map(async p => {
          try {
            const pr = await fetch('/api/dex/token/' + encodeURIComponent(p.mint));
            if (!pr.ok) return;
            const pd = await pr.json();
            const px = Number(pd?.token?.price);
            if (Number.isFinite(px) && px > 0) next[p.mint] = px;
          } catch (e) {}
        }));
        if (!cancelled) setPrices(prev => ({ ...prev, ...next }));
      } catch (e) {}
    };
    load();
    const id = setInterval(load, POLL_POSITIONS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr]);

  // Compute unrealized P&L per position.
  const enriched = useMemo(() => {
    if (!solPrice) return [];
    return positions.map(p => {
      const px = prices[p.mint] || 0;
      const currentValueUsd = p.open_tokens * px;
      const currentValueSol = currentValueUsd / solPrice;
      // cost basis: sol_in minus sol already received from partial sells
      const costBasisSol = Math.max(0, (p.sol_in || 0) - (p.sol_out || 0));
      const unrealizedSol = currentValueSol - costBasisSol;
      const unrealizedPct = costBasisSol > 0 ? (unrealizedSol / costBasisSol) * 100 : 0;
      return { ...p, currentValueSol, costBasisSol, unrealizedSol, unrealizedPct, hasPrice: px > 0 };
    }).sort((a, b) => Math.abs(b.unrealizedSol) - Math.abs(a.unrealizedSol));
  }, [positions, prices, solPrice]);

  if (enriched.length === 0) return null;

  const total = enriched.reduce((s, p) => s + p.unrealizedSol, 0);
  const top = enriched.slice(0, 3);

  return (
    <div className="wr-positions">
      <div className="wr-positions-head">
        <span className="e">◉ Your open marks · {enriched.length}</span>
        <span className="roll">Unrealized <b className={total < 0 ? 'dn' : ''}>{formatSolSigned(total)} SOL</b></span>
      </div>
      {top.map(p => {
        const c = colorFor(p.mint);
        const up = p.unrealizedSol > 0.0001, dn = p.unrealizedSol < -0.0001;
        return (
          <div className="wr-pos-strip-row" key={p.mint}>
            <div className="wr-pos-strip-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
            <div className="wr-pos-strip-sym">${p.sym || '???'}</div>
            <div className={'wr-pos-strip-pnl' + (up ? '' : dn ? ' dn' : ' dim')}>
              {p.hasPrice ? formatSolSigned(p.unrealizedSol) : '—'}
            </div>
            <div className={'wr-pos-strip-pct ' + (up ? 'up' : dn ? 'dn' : '')}>
              {p.hasPrice ? (p.unrealizedPct >= 0 ? '+' : '') + p.unrealizedPct.toFixed(1) + '%' : '…'}
            </div>
          </div>
        );
      })}
      <button className="wr-positions-foot" onClick={onOpenStats}>
        See full field log →
      </button>
    </div>
  );
}

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

  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return Number(amount) <= availSol;
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
  const tierColor = read.tier === 'low' ? 'var(--mint)' : read.tier === 'med' ? 'var(--butter)' : 'var(--coral)';

  return (
    <div className="wr-overlay" onClick={onClose}>
      <div className="wr-sheet" onClick={e=>e.stopPropagation()}>
        <div className="wr-tshead">
          <button className="wr-x" onClick={onClose}>×</button>
          <div className="wr-tshead-row">
            <TokenFace token={token} size={54} />
            <div className="title">
              <div className="sym">${token.sym}</div>
              <div className="sub">{formatPrice(token.price)}{Number.isFinite(token.change) && token.change !== 0 ? <> · <span style={{color:token.change<0?'var(--coral)':'var(--mint)'}}>{formatPct(token.change)}</span></> : null}</div>
            </div>
          </div>
        </div>
        {/* NEW: Token chart — pulls /api/dex/chart/:mint?tf= */}
        <TokenChart token={token} />
        <div className={'wr-vibe ' + tierClass}>
          <div className="wr-vibe-top"><span className="wr-vibe-l">Vibe check</span><span className="wr-vibe-s" style={{color:tierColor}}>{read.score}<span className="of">/{RISK_CEIL}</span></span></div>
          <div className="wr-vibe-verdict" style={{color:tierColor}}>{read.verdict}</div>
          <div className="wr-vibe-chks">{read.knowns.map((c,i)=><span key={i} className={'wr-chk '+c[0]}>{c[1]}</span>)}</div>
        </div>
        <div className="wr-dyor">Can't be checked: {read.unknowns.join(' · ')}. Even a clean read can rug — only trade what you can lose.</div>
        <div className={'wr-mode-tabs' + (isBuy?'':' sell')}>
          <div className="wr-mode-ind" />
          <button className={'wr-mode-tab'+(isBuy?' active':'')} onClick={()=>setMode('buy')}>Buy</button>
          <button className={'wr-mode-tab'+(!isBuy?' active':'')} onClick={()=>setMode('sell')}>Sell</button>
        </div>
        <div className="wr-field">
          <div className="wr-field-row1">
            <span className="wr-field-l">{isBuy?'You pay':'You sell'}</span>
            <span className="wr-field-bal">
              {isBuy ? <>Wallet: <b>{formatSol((solBalance&&solBalance.uiAmount)||0)} SOL</b></> : <>You own: <b>{formatTokens(ownedUi)} ${token.sym}</b></>}
              {isBuy && availSol > 0 ? <button className="wr-field-max" onClick={()=>setAmount(String(Math.floor(availSol*10000)/10000))}>MAX</button> : null}
            </span>
          </div>
          <div className="wr-field-row2">
            <div className="wr-field-chip">
              {isBuy ? <><span className="lg">◎</span><span>SOL</span></> : <><span className="lg"><TokenChip token={token} /></span><span>{token.sym}</span></>}
            </div>
            <input className="wr-field-amt" type="text" inputMode="decimal" placeholder={isBuy?'0.00':'0'} value={amount}
              onChange={e=>{ const val=e.target.value.replace(/[^\d.]/g,''); if(val.split('.').length>2)return; if(!isBuy&&Number(val)>100){setAmount('100');return;} setAmount(val); }} />
          </div>
        </div>
        <div className="wr-presets">
          {presets.map(pv => <button key={pv} className={'wr-preset'+(Number(amount)===pv?(isBuy?' on':' on sell'):'')} onClick={()=>setAmount(String(pv))}>{isBuy?(pv+' SOL'):(pv+'%')}</button>)}
        </div>
        {swapParams && Number(amount) > 0 && (
          <div className="wr-summary">
            <div className="wr-sum"><span className="k">Route</span><span className="v">{token.dex || 'pump.fun'}</span></div>
            {isBuy ? <>
              <div className="wr-sum"><span className="k">Platform fee (3%)</span><span className="v">{formatSol(Number(swapParams.feeLamports)/1e9)} SOL</span></div>
              <div className="wr-sum"><span className="k">Wallet pays</span><span className="v">{formatSol(Number(swapParams.totalLamports)/1e9)} SOL</span></div>
              <div className="wr-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.tokens>0?'≈ '+formatTokens(est.tokens)+' '+token.sym:'—'}</span></div>
            </> : <>
              <div className="wr-sum"><span className="k">Selling</span><span className="v">{formatTokens(swapParams.tradeTokensUi)} {token.sym} ({Math.min(100,Number(amount)).toFixed(0)}%)</span></div>
              <div className="wr-sum"><span className="k">Platform fee (3%)</span><span className="v">≈ {Number(swapParams.feeLamports)/1e9>0?formatSol(Number(swapParams.feeLamports)/1e9):'—'} SOL</span></div>
              <div className="wr-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.sol>0?'≈ '+formatSol(est.sol)+' SOL':'—'}</span></div>
            </>}
          </div>
        )}
        {error && <div className="wr-banner">{error}</div>}
        <button className={'wr-confirm'+(isBuy?'':' sell')} disabled={disabled} onClick={go}>
          {confirming ? (isBuy?'Buying…':'Selling…')
            : !amount||Number(amount)<=0 ? (isBuy?'Enter SOL amount':'Enter percentage')
            : !hasFunds ? (isBuy?'Not enough SOL':(ownedUi<=0?('No '+token.sym+' to sell'):'Need ~0.003 SOL for fees'))
            : (isBuy?('Buy '+amount+' SOL → '+token.sym):('Sell '+Math.min(100,Number(amount))+'% of '+token.sym))}
        </button>
        <p className="wr-tfoot">{token.dex || 'pump.fun'} · 3% fee · settles in seconds</p>
      </div>
    </div>
  );
}

const SpecimenRow = React.memo(function SpecimenRow({ token, ageMsLive, owned, quickAmount, busy, onApe, onOpen, isFresh, specimenNo }) {
  const r = riskRead(token);
  const ownedUi = (owned && owned.uiAmount) || 0;
  const ape = (e) => { e.stopPropagation(); if (busy) return; onApe(token); };
  return (
    <div className={'wr-row' + (isFresh ? ' fresh' : '')} onClick={()=>onOpen(token)}>
      <span className="wr-row-num wr-col-num">№{specimenNo.toLocaleString()}</span>
      <div className="wr-row-tk">
        <TokenFace token={token} />
        <div className="wr-name">
          <div className="wr-sym-row">
            {token.sym}
            {Number.isFinite(token.change) && token.change !== 0 ? <span className={'chg' + (token.change < 0 ? ' dn' : '')}>{formatPct(token.change)}</span> : null}
            {ownedUi > 0 ? <span className="wr-owned-mark">owned</span> : null}
          </div>
          <div className="wr-full">{token.name}{token.dex ? <span className="dex">· {token.dex}</span> : null}</div>
          {/* NEW: Mobile-only second line — price · age · MC. Hidden on desktop via CSS. */}
          <div className="wr-mob-meta">
            <span className="price">{formatPrice(token.price)}</span>
            <span className="dot">·</span>
            <span className={mobAgeClass(ageMsLive)}>{fmtAgeShort(ageMsLive)}</span>
            <span className="dot">·</span>
            <span>{formatMoney(token.mcap)}</span>
          </div>
        </div>
      </div>
      <span className={ageClass(ageMsLive)}>{fmtAgeShort(ageMsLive)}</span>
      <span className="wr-num">{formatMoney(token.mcap)}</span>
      <span className="wr-num dim wr-col-liq">{formatMoney(token.liquidity)}</span>
      <span className="wr-num dim wr-col-vol">{formatMoney(token.volume24h)}</span>
      <span className="wr-col-holders"><span className={'wr-risk ' + r.tier}><span className="wr-risk-dot" />{r.label}</span></span>
      <div className="wr-col-curve wr-curve">
        {token.bond != null ? (<><span className="wr-curve-bar"><i style={{width:token.bond+'%'}} /></span><span className="wr-curve-pct">{token.bond}%</span></>) : <span className="wr-curve-pct">—</span>}
      </div>
      <div className="wr-row-actions" onClick={e=>e.stopPropagation()}>
        <button className="wr-btn-spec" disabled={busy} onClick={ape}>{busy ? <><span className="wr-spinner" /> Buying</> : <>Buy {quickAmount} <span className="arrow">→</span></>}</button>
      </div>
    </div>
  );
});

/* ════════════════════════════════════════════════════════════════
   MAIN
   ════════════════════════════════════════════════════════════════ */
// mainWalletPubkey: base58 of the user's CONNECTED main wallet (e.g. Phantom),
// passed in from the parent layout. Used only for the Referrals tab so that
// referral fees route to a persistent wallet instead of the disposable burner.
// If not provided, the Referrals tab shows a "connect a main wallet" gate.
// Field log + standings still use the burner because the burner is the trader.
export default function Ape({ mainWalletPubkey } = {}) {
  useWrCSS();
  const wallet = useLocalWallet();
    // Trade-path connection — used by executeSwap and onWithdraw. Background
  // reads (balances, token accounts) still go through balRpcRace → /api/solana-rpc.
  const connection = useMemo(() => getConn('confirmed'), []);
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();
  const [quickAmount, setQuickAmount] = useState(() => buyPresets[Math.min(2, buyPresets.length-1)] || 0.5);
  useEffect(() => { if (!buyPresets.includes(quickAmount)) setQuickAmount(buyPresets[Math.min(2, buyPresets.length-1)] || buyPresets[0]); }, [buyPresets]); // eslint-disable-line

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [busyMint, setBusyMint] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [filterWild, setFilterWild] = useState(false);
  const [minLiq, setMinLiq] = useState(0);

  // NEW: filters modal
  const [filtersOpen, setFiltersOpen] = useState(false);

  // NEW: returning-user state. Anyone whose wallet has SOL OR who's traded
  // before is treated as "returning" and gets the compact .wr-lure strip
  // instead of the marketing hero + 3 offer cards. The trade-once flag is
  // set inside runTrade on the confirmed branch.
  const [hasTraded, setHasTraded] = useState(() => {
    try { return localStorage.getItem(HAS_TRADED_KEY) === '1'; } catch (e) { return false; }
  });
  const [showIntro, setShowIntro] = useState(false);

  const refRegisteredRef = useRef(false);
  useEffect(() => {
    if (refRegisteredRef.current) return;
    refRegisteredRef.current = true;
    let ref = null, boost = null;
    try {
      const params = new URLSearchParams(window.location.search);
      ref = params.get('ref'); boost = params.get('boost');
    } catch (e) {}
    refRegister(wallet.publicKey.toBase58(), ref, boost);
  }, [wallet.publicKey]);

  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);
  const seenMintsRef = useRef(new Map());
  const specimenCounterRef = useRef(1247);
  const [newlyArrived, setNewlyArrived] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) { if (!cancelled) { setRecentError('Feed unreachable (HTTP '+r.status+')'); setRecentLoading(false); } return; }
        const d = await r.json();
        const list = Array.isArray(d && d.tokens) ? d.tokens : [];
        const normalized = list.map(normalize).filter(Boolean);
        const justArrived = new Set();
        for (const t of normalized) {
          if (!seenMintsRef.current.has(t.mint)) {
            specimenCounterRef.current += 1;
            seenMintsRef.current.set(t.mint, { specimenNo: specimenCounterRef.current, firstSeenAt: Date.now() });
            justArrived.add(t.mint);
          }
        }
        if (!cancelled) {
          setRecentTokens(normalized); setRecentLoading(false); setRecentError(null);
          if (justArrived.size > 0) { setNewlyArrived(justArrived); setTimeout(() => setNewlyArrived(new Set()), 1000); }
        }
      } catch (e) { if (!cancelled) { setRecentError(String((e && e.message)||'Feed unreachable').slice(0,120)); setRecentLoading(false); } }
    }
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const [, setAgeTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setAgeTick(t => (t + 1) | 0), 1000); return () => clearInterval(id); }, []);

  const [solPrice, setSolPrice] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() { try { const r = await fetch('/api/dex/sol-price'); if (!r.ok) return; const d = await r.json(); if (!cancelled && d && d.price) setSolPrice(d.price); } catch (e) {} }
    load(); const id = setInterval(load, POLL_SOL); return () => { cancelled = true; clearInterval(id); };
  }, []);

  const [balances, setBalances] = useState({});
  const refreshBalances = useCallback(async () => {
    const owner = wallet.publicKey;
    const mergeAccs = (into, accs) => {
      if (!accs || !accs.value) return;
      for (const acc of accs.value) {
        const info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info; if (!info) continue;
        const mint = info.mint, amt = info.tokenAmount && info.tokenAmount.amount; if (!mint || amt == null) continue;
        into[mint] = { amount: String(amt), decimals: Number((info.tokenAmount && info.tokenAmount.decimals) != null ? info.tokenAmount.decimals : 6), uiAmount: Number((info.tokenAmount && info.tokenAmount.uiAmount) || 0) };
      }
    };
    const solP = balRpcRace(c => c.getBalance(owner, BAL_COMMITMENT)).then(l => setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(l), decimals: 9, uiAmount: l/1e9 } }))).catch(e => console.warn('[wr-bal] SOL', e && e.message));
    const tokP = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT)).then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; })).catch(e => console.warn('[wr-bal] SPL', e && e.message));
    const t22P = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT)).then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; })).catch(e => console.warn('[wr-bal] T22', e && e.message));
    await Promise.allSettled([solP, tokP, t22P]);
  }, [wallet.publicKey]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);
  useEffect(() => { const id = setInterval(refreshBalances, POLL_BALANCE); return () => clearInterval(id); }, [refreshBalances]);
  const aggressiveRefresh = useCallback(() => { [1500, 4000, 8000].forEach(ms => setTimeout(refreshBalances, ms)); }, [refreshBalances]);

  const refreshSol = useCallback(async () => {
    try { const l = await balRpcRace(c => c.getBalance(wallet.publicKey, BAL_COMMITMENT)); setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(l), decimals: 9, uiAmount: l/1e9 } })); } catch (e) { console.warn('[wr-bal] SOL', e && e.message); }
  }, [wallet.publicKey]);
  const refreshOneToken = useCallback(async (mintStr) => {
    if (!mintStr || mintStr === SOL_MINT) return;
    let mintPk; try { mintPk = new PublicKey(mintStr); } catch (e) { return; }
    try {
      const accs = await balRpcRace(c => c.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: mintPk }, BAL_COMMITMENT));
      let best = null;
      for (const acc of ((accs && accs.value) || [])) {
        const info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
        const amt = info && info.tokenAmount && info.tokenAmount.amount; if (amt == null) continue;
        const ui = Number((info.tokenAmount && info.tokenAmount.uiAmount)||0);
        if (!best || ui > best.uiAmount) best = { amount: String(amt), decimals: Number((info.tokenAmount && info.tokenAmount.decimals)!=null?info.tokenAmount.decimals:6), uiAmount: ui };
      }
      setBalances(prev => ({ ...prev, [mintStr]: best || { amount:'0', decimals:6, uiAmount:0 } }));
    } catch (e) { console.warn('[wr-bal] one-token', e && e.message); }
  }, [wallet.publicKey]);

  const solBalance = balances[SOL_MINT];

  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => { const id = Math.random().toString(36).slice(2); setToasts(p => [...p, { ...t, id }]); setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), t.duration || 8000); }, []);

  const [confettiKey, setConfettiKey] = useState(0);
  const confettiPieces = useMemo(() => {
    if (!confettiKey) return [];
    const colors = ['#FF3D8A','#3DFFC2','#C9B8FF','#FFD86B','#6BEEFF','#FF7A6E'];
    return Array.from({ length: 56 }, (_, i) => { const angle=(Math.random()-.5)*Math.PI; const dist=220+Math.random()*200; return { i, dx: Math.sin(angle)*dist, dy: -Math.abs(Math.cos(angle)*dist)+420*Math.random(), dr:(Math.random()-.5)*1440, color: colors[i%colors.length], delay: Math.random()*0.15 }; });
  }, [confettiKey]);
  useEffect(() => { if (!confettiKey) return; const id = setTimeout(() => setConfettiKey(0), 1800); return () => clearTimeout(id); }, [confettiKey]);
  const fireConfetti = useCallback(() => setConfettiKey(k => k + 1), []);

  /* ====== executeSwap — with on-chain referral split ====== */
  const executeSwap = useCallback(async (args) => {
    const { mode, swapParams, token } = args;
    if (!swapParams) throw new Error('Nothing to trade.');
    const isBuy = mode === 'buy';
    const userPk = wallet.publicKey;

    const route = await getPumpRoute({
      action: isBuy ? 'buy' : 'sell', mint: token.mint, user: userPk,
      amount: isBuy ? swapParams.tradeLamports : swapParams.tradeTokens,
      decimals: isBuy ? undefined : swapParams.decimals, connection,
    });

    const feeLamports = BigInt(swapParams.feeLamports || '0');
    if (feeLamports <= 0n) throw new Error(isBuy ? 'Fee rounds to zero — amount too small.' : 'Could not estimate sell fee — price unavailable.');

    const refInfo = await refLookup(userPk.toBase58());
    let refWalletPk = null;
    let refLamports = 0n;
    let platformLamports = feeLamports;
    if (refInfo.referrer && refInfo.refSplitBps > 0) {
      try {
        const candidate = new PublicKey(refInfo.referrer);
        if (!candidate.equals(userPk)) {
          refWalletPk = candidate;
          refLamports = (feeLamports * BigInt(refInfo.refSplitBps)) / 10000n;
          if (refLamports > feeLamports) refLamports = feeLamports;
          platformLamports = feeLamports - refLamports;
        }
      } catch (e) {}
    }

    const feeIxs = [];
    if (platformLamports > 0n) feeIxs.push(SystemProgram.transfer({ fromPubkey: userPk, toPubkey: FEE_WALLET, lamports: Number(platformLamports) }));
    if (refLamports > 0n && refWalletPk) feeIxs.push(SystemProgram.transfer({ fromPubkey: userPk, toPubkey: refWalletPk, lamports: Number(refLamports) }));

    const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    const ixs = route.instructions.slice();
    if (isBuy) {
      let at = 0;
      while (at < ixs.length && ixs[at].programId.toBase58() === CB_PROGRAM) at++;
      ixs.splice(at, 0, ...feeIxs);
    } else {
      ixs.push(...feeIxs);
    }

    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: userPk, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message(route.alts);
    const tx = new VersionedTransaction(message);

    // [wr-sim] removed — PumpPortal tx is pre-validated; sim was doubling RPC cost
    // per trade. Send-error path below still uses describeSimLogs() on returned logs.


    tx.sign([wallet.keypair]);
    const raw = tx.serialize();

    let sig;
    try { sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 }); }
    catch (sendErr) { let logs = (sendErr && sendErr.logs) || null; if (!logs && sendErr && typeof sendErr.getLogs === 'function') { try { logs = await sendErr.getLogs(connection); } catch (e2) {} } throw new Error(describeSimLogs(logs, sendErr && sendErr.message)); }

    let confirmed = false, onchainErr = null; const startedAt = Date.now(); const HARD_CAP_MS = 60000;
    while (Date.now() - startedAt < HARD_CAP_MS) {
      try { const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true }); if (st && st.value && st.value.err) { onchainErr = st.value.err; break; } const cs = st && st.value && st.value.confirmationStatus; if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; } } catch (e) {}
      try { const h = await connection.getBlockHeight('confirmed'); if (h > latest.lastValidBlockHeight) break; } catch (e) {}
      try { await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch (e) {}
      await new Promise(r => setTimeout(r, 5000));
    }
    if (onchainErr) throw new Error('Trade failed on-chain — price likely moved past slippage.');

    return {
      sig, confirmed, mode, token, route: route.route,
      refWallet: refWalletPk ? refWalletPk.toBase58() : null,
      refLamports: Number(refLamports),
      platformLamports: Number(platformLamports),
    };
  }, [wallet.keypair, wallet.publicKey, connection]);

  const runTrade = useCallback(async (args) => {
    const { mode, swapParams, token } = args;
    const res = await executeSwap({ mode, swapParams, token });
    const sig = res.sig, confirmed = res.confirmed;
    let outAmount = 0;
    if (mode === 'buy' && token && token.price > 0 && solPrice > 0) outAmount = ((Number(swapParams.tradeLamports)/1e9)*solPrice)/token.price;
    else if (mode === 'sell' && token && token.price > 0 && solPrice > 0) outAmount = Math.max(0, ((swapParams.tradeTokensUi*token.price)/solPrice)*(1-FEE_BPS/10000));

    if (sig) {
      refLogTrade({
        wallet: wallet.publicKey.toBase58(),
        mint: token.mint, sym: token.sym, name: token.name,
        side: mode,
        sol_amount:   mode === 'buy' ? swapParams.solAmount : (outAmount || 0),
        token_amount: mode === 'buy' ? (outAmount || 0) : swapParams.tradeTokensUi,
        price_usd:     token.price || 0,
        sol_price_usd: solPrice || 0,
        sig,
        ref_wallet: res.refWallet,
        ref_lamports: res.refLamports || 0,
        platform_lamports: res.platformLamports || 0,
      });
    }

    if (confirmed) {
      // NEW: mark this user as "has traded" so the marketing hero collapses
      // on their next visit. Persistent, opt-out via WHAT'S THIS? in the lure.
      try { localStorage.setItem(HAS_TRADED_KEY, '1'); } catch (e) {}
      setHasTraded(true);

      fireConfetti();
      const tweetText = buildTweetText({ mode, token, solAmount: swapParams.solAmount, outAmount, percentage: swapParams.percentage });
      pushToast({
        kind: 'success', emoji: '✓',
        body: mode === 'buy'
          ? <><b>Caught ${token.sym}</b><br/>{swapParams.solAmount} SOL{outAmount>0?<> → ~{formatTokens(outAmount)} {token.sym}</>:null}</>
          : <><b>Sold {Math.round(swapParams.percentage)}% of ${token.sym}</b>{outAmount>0?<><br/>~{formatSol(outAmount)} SOL</>:null}</>,
        solscan: 'https://solscan.io/tx/' + sig, tweetText, shareUrl: buildShareUrl(),
      });
    } else {
      pushToast({ kind: 'error', emoji: '⏳', body: <><b>Not confirmed</b><br/>Sent but didn't confirm. Check Solscan before retrying.</>, solscan: 'https://solscan.io/tx/' + sig, duration: 13000 });
    }
    refreshSol();
    [1200, 3000, 6000].forEach(ms => setTimeout(() => { refreshSol(); refreshOneToken(token.mint); }, ms));
    aggressiveRefresh();
    return { confirmed };
  }, [executeSwap, fireConfetti, pushToast, refreshSol, refreshOneToken, aggressiveRefresh, solPrice, wallet.publicKey]);

  const onApe = useCallback(async (token) => {
    if (busyMint) return;
    const availSol = Math.max(0, ((solBalance && solBalance.uiAmount) || 0) - SOL_RESERVE);
    if (quickAmount > availSol) { pushToast({ kind: 'error', emoji: '◌', body: <><b>Need more SOL</b><br/>Deposit to your wallet to trade {quickAmount} SOL.</> }); setWalletOpen(true); return; }
    const params = buildBuyParams(quickAmount);
    if (!params) { pushToast({ kind: 'error', emoji: '⚠', body: 'Amount too small.' }); return; }
    setBusyMint(token.mint);
    try { await runTrade({ mode: 'buy', swapParams: params, token }); }
    catch (e) { pushToast({ kind: 'error', emoji: '⊘', body: friendlyError(e) }); }
    finally { setBusyMint(null); }
  }, [busyMint, quickAmount, solBalance, runTrade, pushToast]);

  const onSheetConfirm = useCallback(async (args) => {
    await runTrade(args);
    setTradeOpen(null);
    return { closed: true };
  }, [runTrade]);

  const onWithdraw = useCallback(async (destStr, solAmt) => {
    setWithdrawing(true);
    try {
      const dest = new PublicKey(destStr);
      const lamports = Math.floor(solAmt * 1e9);
      const latest = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: dest, lamports })] }).compileToV0Message();
      const tx = new VersionedTransaction(msg); tx.sign([wallet.keypair]);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
      pushToast({ kind: 'success', emoji: '✓', body: <><b>Sent {solAmt} SOL</b></>, solscan: 'https://solscan.io/tx/' + sig });
      refreshSol(); [1500, 4000].forEach(ms => setTimeout(refreshSol, ms)); aggressiveRefresh();
    } catch (e) { pushToast({ kind: 'error', emoji: '⊘', body: friendlyError(e) }); }
    finally { setWithdrawing(false); }
  }, [connection, wallet.keypair, wallet.publicKey, pushToast, refreshSol, aggressiveRefresh]);

  const auto = useAutoTrade({
    wallet, recentTokens, solBalance, solPrice, balances,
    executeSwap, refreshSol, refreshOneToken, pushToast,
  });

  const filtered = useMemo(() => {
    let l = recentTokens.slice();
    const seenMint = new Set(), seenName = new Set(), seenSym = new Set();
    l = l.filter(t => {
      if (!t || !t.mint) return false;
      if (seenMint.has(t.mint)) return false;
      const nm = String(t.name || '').trim().toLowerCase();
      const sm = String(t.sym  || '').trim().toLowerCase();
      if (nm && seenName.has(nm)) return false;
      if (sm && sm !== '???' && seenSym.has(sm)) return false;
      seenMint.add(t.mint); if (nm) seenName.add(nm); if (sm && sm !== '???') seenSym.add(sm);
      return true;
    });
    if (filterWild) l = l.filter(t => riskRead(t).tier === 'high');
    if (minLiq > 0) l = l.filter(t => (t.liquidity || 0) >= minLiq);
    const ageNow = (t) => t.pairCreatedAtMs ? Date.now() - t.pairCreatedAtMs : Infinity;
    if (sortBy === 'newest')      l = l.sort((a,b) => ageNow(a) - ageNow(b));
    else if (sortBy === 'volume') l = l.sort((a,b) => (b.volume24h||0) - (a.volume24h||0));
    else if (sortBy === 'vibe')   l = l.sort((a,b) => riskRead(b).score - riskRead(a).score);
    return l.slice(0, 40);
  }, [recentTokens, sortBy, filterWild, minLiq]);

  const stats = useMemo(() => {
    const now = Date.now();
    const fresh = filtered.filter(t => t.pairCreatedAtMs && (now - t.pairCreatedAtMs) < 60000).length;
    const trending = filtered.filter(t => (t.volume24h || 0) > 40000).length;
    const totalVol = filtered.reduce((s, t) => s + (t.volume24h || 0), 0);
    const topMover = filtered.filter(t => Number.isFinite(t.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null;
    return { fresh, trending, totalVol, topMover };
  }, [filtered]);

  const fieldLogNo = specimenCounterRef.current;

  // NEW: returning-user check. Either has SOL OR has logged a trade before.
  // Honour showIntro override so users can re-expand the marketing block.
  const isReturning = ((solBalance && solBalance.uiAmount > 0) || hasTraded) && !showIntro;

  // NEW: count of active filters (for the magenta badge on the filter button)
  const filterCount = (filterWild ? 1 : 0) + (minLiq > 0 ? 1 : 0);

  // NEW: fresh-count for the lure microcopy
  const freshCount = stats.fresh;

  // Burner wallet str for positions strip (positions tracked under the
  // wallet that did the trading — the burner).
  const burnerStr = wallet.publicKey.toBase58();

  return (
    <div className="wr-root">
      <nav className="wr-nav">
        <div className="wr-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="wr-radar-icon" />
          <span className="wr-bname">wonderland<span className="sep">//</span><span className="it">radar</span></span>
        </div>
        <div className="wr-nav-eyebrow"><span className="live" /><span>FIELD LOG · ENTRY № {fieldLogNo.toLocaleString()}</span></div>
        <button className="wr-nav-stats" onClick={() => setStatsOpen(true)}>
          <span className="gl">§</span><span>STATS</span>
        </button>
        <button className="wr-nav-stats" onClick={() => setAutoOpen(true)} style={auto.enabled && !auto.paused ? {borderColor:'rgba(61,255,194,.4)',background:'rgba(61,255,194,.08)'} : auto.paused ? {borderColor:'rgba(255,216,107,.4)',background:'rgba(255,216,107,.08)'} : null}>
          <span className="gl" style={{color: auto.enabled && !auto.paused ? 'var(--mint)' : auto.paused ? 'var(--butter)' : 'var(--cyan)'}}>⚡</span>
          <span>AUTO{auto.enabled && !auto.paused ? ' · ON' : auto.paused ? ' · PAUSED' : ''}</span>
        </button>
        <div className="wr-nav-wallet" onClick={() => setWalletOpen(true)}>
          <span className="dot" /><span className="glyph">◎</span>
          <b>{formatSol((solBalance && solBalance.uiAmount) || 0)}</b>
          {!wallet.backedUp ? <span className="nudge" title="Back up your wallet" /> : null}
        </div>
      </nav>

      <div className="wr-qbar">
        <span className="wr-qlabel"><span className="b">⚡</span>Quick buy</span>
        {buyPresets.map(v => (
          <button key={v} className={'wr-qamt' + (v === quickAmount ? ' active' : '')} onClick={() => setQuickAmount(v)}>
            <span>{v}</span><span className="s">◎</span>
          </button>
        ))}
        <button className="wr-qedit" onClick={() => setPresetsOpen(true)}>✎</button>
        <span className="wr-qfast"><span className="d" />INSTANT</span>
      </div>

      <div className="wr-app">
        <div className="wr-page">
          <div className="wr-field-log">
            <span className="glyph">◎</span>
            <span>FIELD LOG · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
            <span className="rule" />
            <span>SOLANA · PUMP.FUN + RAYDIUM</span>
          </div>

          {/* NEW: hero/offers collapse on return visits. Lure strip + WHAT'S THIS? */}
          {isReturning ? (
            <div className="wr-lure">
              <div className="wr-lure-text">
                <div className="wr-lure-h">Welcome <span className="it">back.</span></div>
                <div className="wr-lure-s">
                  ENTRY № {fieldLogNo.toLocaleString()} ·{' '}
                  {freshCount > 0 ? <><b>{freshCount}</b> launches in &lt;60s</> : 'feed loaded'}
                </div>
              </div>
              <button className="wr-lure-intro" onClick={() => setShowIntro(true)} title="Re-show the intro">
                WHAT'S THIS?
              </button>
            </div>
          ) : (
            <>
              <section className="wr-hero" style={{position:'relative'}}>
                {hasTraded && showIntro && (
                  <button className="wr-lure-close" style={{position:'absolute',top:6,right:0}} onClick={() => setShowIntro(false)} title="Collapse">×</button>
                )}
                <h1>Fresh launches, <span className="it">caught at first light.</span></h1>
                <div className="wr-hero-cta">
                  <button className="wr-btn-ape" onClick={() => { const el = document.getElementById('wr-feed'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                    Start trading <span className="arrow">→</span>
                  </button>
                  <span className="wr-no-connect">◌ No wallet connect needed</span>
                </div>
              </section>

              <section className="wr-offer-strip">
                <div className="wr-offer o1">
                  <div className="wr-offer-num"><span className="glyph">⚡</span><span>① The hook</span></div>
                  <h3>Two-second <span className="it">trade.</span></h3>
                  <p>No wallet popup. No signup. We generate a burner the moment you land — <b>your keys, your trades</b>, ready before your phone wakes.</p>
                </div>
                <div className="wr-offer o2">
                  <div className="wr-offer-num"><span className="glyph">◉</span><span>② The honesty</span></div>
                  <h3>Vibe-checked, <span className="it">openly.</span></h3>
                  <p>Every specimen gets a real read on liquidity, holders, curve health. We also tell you <b>what can't be checked</b>. No fake green badges.</p>
                </div>
                <div className="wr-offer o3">
                  <div className="wr-offer-num"><span className="glyph">◌</span><span>③ The timing</span></div>
                  <h3>The <span className="it">moment</span> they hatch.</h3>
                  <p>We watch pump.fun and Raydium so you don't refresh. New specimens land in the feed <b>within seconds</b> of going live.</p>
                  <div className="mini-radar"><div className="b b1" /><div className="b b2" /></div>
                </div>
              </section>
            </>
          )}

          {/* NEW: Open positions strip — renders only when there's something held */}
          <OpenPositionsStrip walletStr={burnerStr} solPrice={solPrice} onOpenStats={() => setStatsOpen(true)} />

          <div className="wr-list-frame" id="wr-feed">
            <div className="wr-list-head">
              <div className="wr-list-title">
                <span className="e">◉ Live feed</span>
                <span className="t">Recently <span className="it">emerged</span></span>
              </div>
            </div>

            {/* NEW: Simplified sort bar replaces the 5-chip row. Filters live in modal. */}
            <div className="wr-sortbar">
              <span className="label">SORT</span>
              <button className={'wr-chip' + (sortBy === 'newest' ? ' on' : '')} onClick={() => setSortBy('newest')}>Freshest</button>
              <button className={'wr-chip' + (sortBy === 'vibe'   ? ' on' : '')} onClick={() => setSortBy('vibe')}>Steadiest</button>
              <button className={'wr-chip' + (sortBy === 'volume' ? ' on' : '')} onClick={() => setSortBy('volume')}>Active</button>
              <button className={'wr-filter-btn' + (filterCount > 0 ? ' on' : '')} onClick={() => setFiltersOpen(true)}>
                ⌖ Filter
                {filterCount > 0 ? <span className="ct">{filterCount}</span> : null}
              </button>
            </div>

            <div className="wr-list">
              <div className="wr-row thead">
                <span className="wr-col-num">№</span>
                <span>Specimen</span>
                <span>Age</span>
                <span>MC</span>
                <span className="wr-col-liq">Liq</span>
                <span className="wr-col-vol">Vol</span>
                <span className="wr-col-holders">Vibe</span>
                <span className="wr-col-curve">Curve</span>
                <span style={{textAlign:'right'}}>Action</span>
              </div>
              {filtered.length === 0 ? (
                <div className="wr-empty">
                  <span className="glyph">∅</span>
                  {recentLoading ? <><b>Checking the lens.</b><div className="sub">New entries arrive every few seconds.</div></>
                    : recentError ? <><b>The radar is dark.</b><div className="sub">Retrying automatically.</div><div className="err">{recentError}</div></>
                    : <><b>Nothing in view at these settings.</b><div className="sub">Loosen min liquidity or turn off Wild only.</div></>}
                </div>
              ) : filtered.map((t) => {
                const seen = seenMintsRef.current.get(t.mint);
                const ageMsLive = t.pairCreatedAtMs ? Date.now() - t.pairCreatedAtMs : 0;
                return (
                  <SpecimenRow
                    key={t.mint}
                    token={t}
                    ageMsLive={ageMsLive}
                    owned={balances[t.mint]}
                    quickAmount={quickAmount}
                    busy={busyMint === t.mint}
                    onApe={onApe}
                    onOpen={(tok) => setTradeOpen({ token: tok, mode: 'buy' })}
                    isFresh={newlyArrived.has(t.mint)}
                    specimenNo={seen ? seen.specimenNo : 0}
                  />
                );
              })}
            </div>

            <div className="wr-list-foot">
              <span className={'live' + (recentError ? ' warn' : '')}>
                <span className="d" />{recentLoading ? 'Syncing…' : recentError ? 'Feed offline' : 'Updating · top to bottom'}
              </span>
              <span>{filtered.length} specimens · refreshing every 2.5s</span>
            </div>
          </div>

          <div className="wr-proof">
            <span className="e"><span className="d" />Activity right now</span>
            <span className="wr-proof-div" />
            <span className="wr-proof-stat"><span className="v">{stats.fresh}<span className="it"> fresh</span></span><span className="k">in &lt;60s</span></span>
            <span className="wr-proof-div" />
            <span className="wr-proof-stat"><span className="v">{stats.trending}</span><span className="k">trending</span></span>
            <span className="wr-proof-div" />
            <span className="wr-proof-stat"><span className="v">{formatMoney(stats.totalVol)}</span><span className="k">volume tracked</span></span>
            {stats.topMover && (<><span className="wr-proof-div" /><span className="wr-proof-stat"><span className="v">{stats.topMover.sym}</span><span className="k">top mover</span><span className={'m' + (stats.topMover.change < 0 ? ' dn' : '')}>{formatPct(stats.topMover.change)}</span></span></>)}
          </div>
        </div>
      </div>

      {presetsOpen ? <PresetsModal buyPresets={buyPresets} setBuyPresets={setBuyPresets} sellPresets={sellPresets} setSellPresets={setSellPresets} onClose={()=>setPresetsOpen(false)} /> : null}
      {walletOpen ? <WalletDrawer wallet={wallet} solBalance={solBalance} solPrice={solPrice} onWithdraw={onWithdraw} busy={withdrawing} onClose={()=>setWalletOpen(false)} /> : null}
      {tradeOpen ? <TradeSheet token={tradeOpen.token} initialMode={tradeOpen.mode} onClose={()=>setTradeOpen(null)} onConfirm={onSheetConfirm}
        buyPresets={buyPresets} sellPresets={sellPresets} solBalance={solBalance} tokenBalance={balances[tradeOpen.token.mint]} solPrice={solPrice} /> : null}
      {filtersOpen ? <FiltersModal wildOnly={filterWild} setWildOnly={setFilterWild} minLiq={minLiq} setMinLiq={setMinLiq} onClose={() => setFiltersOpen(false)} /> : null}

      <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} wallet={wallet} mainWalletPubkey={mainWalletPubkey} solPrice={solPrice} />
      <AutoPanel open={autoOpen} onClose={() => setAutoOpen(false)} autoState={auto} />

      <div className="wr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={'wr-toast ' + t.kind}>
            <span className="em">{t.emoji}</span>
            <div className="tb">{t.body}</div>
            <div className="ta">
              {t.solscan ? <a className="wr-taction" href={t.solscan} target="_blank" rel="noreferrer">VIEW</a> : null}
              {t.tweetText ? <button className="wr-taction tw" onClick={()=>openTwitterShare(t.tweetText, t.shareUrl)}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>SHARE
              </button> : null}
            </div>
          </div>
        ))}
      </div>

      {confettiKey > 0 && (
        <div className="wr-confetti" key={confettiKey}>
          {confettiPieces.map(p => <div key={p.i} className="wr-cpiece" style={{ background: p.color, animationDelay: p.delay+'s', '--dx': p.dx+'px', '--dy': p.dy+'px', '--dr': p.dr+'deg' }} />)}
        </div>
      )}
    </div>
  );
}