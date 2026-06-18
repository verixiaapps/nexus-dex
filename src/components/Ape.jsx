// Ape.jsx — wonderland//radar — field log + one-tap launch list
//
// What changed from prior version:
//   - UI: field-naturalist register (iris/magenta/mint/cyan, Fraunces serif).
//     Slim hero → 3 "what we offer" cards → live specimen feed (table) →
//     proof band. Mascot + mooning ribbon removed; coin micro-animation
//     removed (was an extra React state per tile per tap).
//   - Speed: POLL_RECENT 5s → 2.5s. Ages tick live every 1s. Removed the
//     animated coin state on the row buy button (was forcing a re-render
//     per tap on top of the trade flow).
//   - Token detail: still the TradeSheet modal — same flow as before.
//   - Burner wallet, executeSwap, runTrade, balance refreshes, Twitter
//     share, confetti, toasts: ALL UNCHANGED. The trade pipeline is
//     identical to the previous Ape.jsx.

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
   CSS — field-naturalist palette. Everything prefixed `wr-` so
   nothing leaks into the rest of the app. Imported once via
   useWrCSS().
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
  -webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;
  padding-bottom:46px;
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

.wr-app{max-width:1280px;margin:0 auto;position:relative;z-index:5}
.wr-page{padding:24px 28px 80px}
@media(max-width:768px){.wr-page{padding:16px 14px 80px}}

/* ── NAV ───────────────────────────────────────────── */
.wr-nav{
  position:sticky;top:0;z-index:60;
  display:flex;align-items:center;gap:18px;padding:14px 28px;
  background:rgba(14,11,31,.7);backdrop-filter:blur(20px) saturate(140%);
  border-bottom:1px solid var(--line);
}
.wr-brand{display:flex;align-items:center;gap:11px;cursor:pointer}
.wr-radar-icon{
  position:relative;width:30px;height:30px;border-radius:50%;
  border:1px solid rgba(107,238,255,.4);
  background:radial-gradient(circle,rgba(107,238,255,.15),transparent 70%);
  overflow:hidden;flex-shrink:0;
}
.wr-radar-icon::before{
  content:'';position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0 280deg,var(--cyan) 350deg,transparent 360deg);
  animation:wr-sweep 3.5s linear infinite;opacity:.7;
}
.wr-radar-icon::after{content:'';position:absolute;inset:6px;border-radius:50%;border:1px solid rgba(107,238,255,.25)}
.wr-bname{font-family:'Fraunces';font-weight:600;font-size:17px;letter-spacing:-.015em;font-variation-settings:"opsz" 60}
.wr-bname .it{font-style:italic;font-weight:500;color:var(--cyan)}
.wr-bname .sep{opacity:.4;margin:0 4px;font-weight:400}
.wr-nav-eyebrow{
  margin-left:auto;display:flex;align-items:center;gap:10px;
  font-family:'JetBrains Mono';font-size:10px;font-weight:700;
  letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3);
}
.wr-nav-eyebrow .live{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-nav-wallet{
  display:flex;align-items:center;gap:9px;padding:8px 14px;
  background:linear-gradient(135deg,var(--vapor),var(--plum));
  border:1px solid var(--line2);border-radius:999px;
  font-family:'JetBrains Mono';font-size:12px;font-weight:700;
  cursor:pointer;color:var(--ink);position:relative;
}
.wr-nav-wallet:hover{border-color:var(--line3)}
.wr-nav-wallet .glyph{color:var(--butter);font-weight:800}
.wr-nav-wallet .dot{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.wr-nav-wallet .nudge{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--butter);border:2px solid var(--iris);box-shadow:0 0 6px var(--butter)}
@media(max-width:768px){
  .wr-nav{padding:12px 14px;gap:10px}
  .wr-nav-eyebrow{display:none}
}

/* ── QUICK BUY BAR ───────────────────────────────── */
.wr-qbar{
  position:sticky;top:54px;z-index:55;
  display:flex;align-items:center;gap:8px;padding:10px 28px;
  background:rgba(14,11,31,.85);backdrop-filter:blur(18px);
  border-bottom:1px solid var(--line);
  overflow-x:auto;scrollbar-width:none;
}
.wr-qbar::-webkit-scrollbar{display:none}
.wr-qlabel{
  font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;
  letter-spacing:1.3px;text-transform:uppercase;color:var(--ink3);
  flex-shrink:0;display:flex;align-items:center;gap:6px;
}
.wr-qlabel .b{color:var(--magenta)}
.wr-qamt{
  flex-shrink:0;display:flex;align-items:center;gap:5px;
  padding:6px 13px;border-radius:999px;
  background:var(--vapor);border:1px solid var(--line);color:var(--ink2);
  font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;cursor:pointer;
  transition:.12s;
}
.wr-qamt:hover{color:var(--ink);border-color:var(--line2)}
.wr-qamt.active{background:var(--magenta);color:#1B0410;border-color:transparent;box-shadow:0 4px 16px -4px var(--magenta-glow)}
.wr-qamt .s{opacity:.55;font-size:11px}
.wr-qamt.active .s{opacity:.7;color:#1B0410}
.wr-qedit{
  flex-shrink:0;width:30px;height:30px;border-radius:50%;
  background:var(--vapor);border:1px solid var(--line);
  display:grid;place-items:center;color:var(--ink2);font-size:13px;cursor:pointer;
}
.wr-qedit:hover{color:var(--cyan);border-color:rgba(107,238,255,.35)}
.wr-qfast{
  flex-shrink:0;margin-left:auto;display:flex;align-items:center;gap:6px;
  font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;letter-spacing:.6px;
  color:var(--mint);background:var(--mint-soft);padding:6px 11px;border-radius:999px;
  white-space:nowrap;
}
.wr-qfast .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.3s infinite}
@media(max-width:768px){.wr-qbar{padding:9px 14px}}

/* ── FIELD LOG EYEBROW ───────────────────────────── */
.wr-field-log{
  font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;color:var(--ink3);
  display:flex;align-items:center;gap:10px;margin-bottom:14px;
}
.wr-field-log .rule{flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent);max-width:200px}
.wr-field-log .glyph{color:var(--cyan);font-size:14px}

/* ── SLIM HERO ───────────────────────────────────── */
.wr-hero{
  display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
  padding:4px 0 22px;border-bottom:1px solid var(--line);margin-bottom:22px;
  flex-wrap:wrap;
}
.wr-hero h1{
  font-family:'Fraunces';font-weight:500;font-size:46px;line-height:1;
  letter-spacing:-.025em;font-variation-settings:"opsz" 144;
  max-width:680px;margin:0;
}
.wr-hero h1 .it{font-style:italic;font-weight:400;color:var(--cyan)}
.wr-hero-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.wr-btn-ape{
  display:inline-flex;align-items:center;gap:9px;
  padding:13px 22px;border-radius:13px;border:none;cursor:pointer;
  background:var(--magenta);color:#1B0410;font-family:inherit;
  font-weight:700;font-size:13.5px;letter-spacing:.2px;
  box-shadow:0 8px 28px -8px var(--magenta-glow);
  transition:transform .12s,box-shadow .2s;
}
.wr-btn-ape:hover{transform:translateY(-1px);box-shadow:0 12px 36px -8px var(--magenta-glow)}
.wr-btn-ape .arrow{font-family:'JetBrains Mono';font-weight:800}
.wr-no-connect{
  display:inline-flex;align-items:center;gap:7px;
  font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;
  letter-spacing:.6px;color:var(--mint);
  padding:6px 11px;border-radius:999px;
  background:var(--mint-soft);border:1px solid rgba(61,255,194,.2);
}
@media(max-width:768px){
  .wr-hero h1{font-size:32px}
  .wr-hero{flex-direction:column;align-items:flex-start;gap:14px}
}

/* ── OFFER CARDS ─────────────────────────────────── */
.wr-offer-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
.wr-offer{
  position:relative;overflow:hidden;
  background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.6));
  border:1px solid var(--line);border-radius:18px;
  padding:22px 22px 20px;transition:border-color .2s;
}
.wr-offer:hover{border-color:var(--line2)}
.wr-offer::before{
  content:'';position:absolute;top:-40%;right:-30%;width:90%;height:90%;
  background:radial-gradient(circle,var(--wr-acc-bg,rgba(107,238,255,.08)),transparent 55%);
  pointer-events:none;
}
.wr-offer-num{
  font-family:'JetBrains Mono';font-size:10px;font-weight:800;
  letter-spacing:1.4px;color:var(--wr-acc-c,var(--cyan));text-transform:uppercase;
  margin-bottom:14px;display:flex;align-items:center;gap:9px;
}
.wr-offer-num .glyph{
  display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;
  background:var(--wr-acc-bg-strong,rgba(107,238,255,.1));
  border:1px solid var(--wr-acc-border,rgba(107,238,255,.22));
  font-size:13px;color:var(--wr-acc-c,var(--cyan));
}
.wr-offer h3{
  font-family:'Fraunces';font-weight:500;font-size:22px;line-height:1.1;
  letter-spacing:-.015em;margin:0 0 8px;font-variation-settings:"opsz" 96;
}
.wr-offer h3 .it{font-style:italic;font-weight:400;color:var(--wr-acc-c,var(--cyan))}
.wr-offer p{font-size:13px;line-height:1.5;color:var(--ink2);font-weight:400;margin:0}
.wr-offer p b{color:var(--ink);font-weight:600}
.wr-offer.o1{--wr-acc-c:var(--magenta);--wr-acc-bg:rgba(255,61,138,.10);--wr-acc-bg-strong:rgba(255,61,138,.12);--wr-acc-border:rgba(255,61,138,.24);animation:wr-glow 3.4s ease-in-out infinite}
.wr-offer.o2{--wr-acc-c:var(--cyan);--wr-acc-bg:rgba(107,238,255,.08);--wr-acc-bg-strong:rgba(107,238,255,.1);--wr-acc-border:rgba(107,238,255,.22)}
.wr-offer.o3{--wr-acc-c:var(--mint);--wr-acc-bg:rgba(61,255,194,.08);--wr-acc-bg-strong:rgba(61,255,194,.1);--wr-acc-border:rgba(61,255,194,.22)}
.wr-offer .mini-radar{
  position:absolute;right:18px;bottom:18px;width:54px;height:54px;border-radius:50%;
  border:1px solid rgba(61,255,194,.25);
  background:radial-gradient(circle,rgba(61,255,194,.08),transparent 70%);overflow:hidden;
}
.wr-offer .mini-radar::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 280deg,rgba(61,255,194,.5) 350deg,transparent 360deg);animation:wr-sweep 4s linear infinite}
.wr-offer .mini-radar::after{content:'';position:absolute;inset:10px;border-radius:50%;border:1px solid rgba(61,255,194,.2)}
.wr-offer .mini-radar .b{position:absolute;width:5px;height:5px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.wr-offer .mini-radar .b1{left:30%;top:32%;animation:wr-pulse 1.6s infinite}
.wr-offer .mini-radar .b2{left:62%;top:54%;animation:wr-pulse 2s .4s infinite}
@media(max-width:900px){
  .wr-offer-strip{grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
  .wr-offer.o3{grid-column:1/-1}
}
@media(max-width:560px){
  .wr-offer-strip{grid-template-columns:1fr}
  .wr-offer h3{font-size:19px}
  .wr-offer{padding:18px}
}

/* ── LIST ─────────────────────────────────────────── */
.wr-list-frame{
  background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.8));
  border:1px solid var(--line);border-radius:20px;overflow:hidden;margin-bottom:22px;
}
.wr-list-head{
  padding:18px 22px;display:flex;align-items:center;justify-content:space-between;
  gap:16px;border-bottom:1px solid var(--line);flex-wrap:wrap;
}
.wr-list-title{display:flex;flex-direction:column;gap:2px}
.wr-list-title .e{font-family:'JetBrains Mono';font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--cyan)}
.wr-list-title .t{font-family:'Fraunces';font-weight:500;font-size:24px;letter-spacing:-.015em}
.wr-list-title .t .it{font-style:italic;color:var(--ink2);font-weight:400}
.wr-list-filters{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.wr-chip{
  display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;
  background:var(--vapor);border:1px solid var(--line);
  font-family:inherit;font-size:11.5px;font-weight:500;color:var(--ink2);cursor:pointer;
  transition:.15s;
}
.wr-chip:hover{color:var(--ink);border-color:var(--line2)}
.wr-chip.on{background:rgba(107,238,255,.1);border-color:rgba(107,238,255,.3);color:var(--cyan)}

.wr-list{padding:6px 0}
.wr-row{
  display:grid;
  grid-template-columns:48px 1fr 80px 90px 100px 100px 110px 100px 130px;
  gap:14px;align-items:center;padding:14px 22px;
  border-bottom:1px solid var(--line);cursor:pointer;
  transition:background .2s;position:relative;
  animation:wr-pop .4s cubic-bezier(.2,1.2,.4,1) backwards;
}
.wr-row:last-child{border-bottom:none}
.wr-row:hover{background:rgba(244,239,255,.025)}
.wr-row.fresh{animation:wr-develop .8s cubic-bezier(.2,1,.3,1)}
.wr-row.thead{
  font-family:'JetBrains Mono';font-size:9.5px;font-weight:800;
  letter-spacing:1.2px;text-transform:uppercase;color:var(--ink3);
  padding:12px 22px;cursor:default;background:rgba(0,0,0,.15);animation:none;
}
.wr-row.thead:hover{background:rgba(0,0,0,.15)}

.wr-row-num{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.5px}
.wr-row-tk{display:flex;align-items:center;gap:12px;min-width:0}
.wr-av{
  width:38px;height:38px;border-radius:11px;flex-shrink:0;display:grid;place-items:center;
  font-family:'Fraunces';font-weight:700;font-size:15px;color:#fff;text-transform:uppercase;
  box-shadow:0 4px 14px rgba(0,0,0,.3);overflow:hidden;position:relative;
}
.wr-av img{width:100%;height:100%;object-fit:cover}
.wr-name{min-width:0}
.wr-sym-row{
  font-family:'Fraunces';font-weight:600;font-size:15px;letter-spacing:-.01em;
  display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.wr-sym-row .chg{font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;color:var(--mint)}
.wr-sym-row .chg.dn{color:var(--coral)}
.wr-full{font-size:11.5px;color:var(--ink2);font-weight:400;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-full .dex{color:var(--ink3);font-family:'JetBrains Mono';font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-left:6px}

.wr-num{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--ink)}
.wr-num.dim{color:var(--ink2);font-weight:500}
.wr-age{font-family:'JetBrains Mono';font-weight:700;font-size:12.5px;color:var(--mint)}
.wr-age.med{color:var(--lavender)}
.wr-age.old{color:var(--ink3)}

.wr-risk{
  display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:7px;
  font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:.3px;
}
.wr-risk.low{background:var(--mint-soft);color:var(--mint)}
.wr-risk.med{background:rgba(255,216,107,.1);color:var(--butter)}
.wr-risk.high{background:var(--coral-soft);color:var(--coral)}
.wr-risk-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}

.wr-curve{display:flex;align-items:center;gap:8px}
.wr-curve-bar{flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden}
.wr-curve-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--butter),var(--mint));border-radius:99px}
.wr-curve-pct{font-family:'JetBrains Mono';font-size:10.5px;font-weight:800;color:var(--ink2);min-width:32px;text-align:right}

.wr-row-actions{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.wr-btn-spec{
  padding:8px 13px;border-radius:10px;border:none;cursor:pointer;
  font-family:inherit;font-weight:600;font-size:12px;
  background:var(--magenta);color:#1B0410;
  display:inline-flex;align-items:center;gap:6px;
  box-shadow:0 4px 14px -5px var(--magenta-glow);transition:transform .1s,box-shadow .2s;
}
.wr-btn-spec:hover{transform:translateY(-1px);box-shadow:0 6px 18px -5px var(--magenta-glow)}
.wr-btn-spec:disabled{opacity:.6;cursor:wait}
.wr-btn-spec .arrow{font-family:'JetBrains Mono';font-weight:800;font-size:11px}
.wr-spinner{width:12px;height:12px;border-radius:50%;border:2px solid rgba(27,4,16,.3);border-top-color:#1B0410;animation:wr-spin .7s linear infinite;display:inline-block}
.wr-owned-mark{
  font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:.5px;
  padding:2px 7px;border-radius:5px;background:var(--mint-soft);color:var(--mint);
  text-transform:uppercase;
}

.wr-list-foot{
  padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink3);
  letter-spacing:.7px;text-transform:uppercase;border-top:1px solid var(--line);
}
.wr-list-foot .live{display:inline-flex;align-items:center;gap:7px;color:var(--mint)}
.wr-list-foot .live .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-list-foot .live.warn{color:var(--butter)}
.wr-list-foot .live.warn .d{background:var(--butter);box-shadow:0 0 10px var(--butter)}

@media(max-width:1100px){
  .wr-row{grid-template-columns:40px 1fr 70px 80px 90px 100px 120px;gap:10px;padding:12px 16px}
  .wr-row.thead{padding:10px 16px}
  .wr-col-vol,.wr-col-holders{display:none}
}
@media(max-width:720px){
  .wr-row{grid-template-columns:1.5fr 60px 80px 95px 110px;gap:8px;padding:11px 14px}
  .wr-row.thead{padding:10px 14px}
  .wr-col-num,.wr-col-liq,.wr-col-curve{display:none}
  .wr-av{width:32px;height:32px;font-size:13px}
  .wr-sym-row{font-size:13.5px}
  .wr-full{font-size:10.5px}
}

/* ── PROOF BAND ──────────────────────────────────── */
.wr-proof{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:18px 22px;border-radius:18px;
  background:linear-gradient(180deg,var(--plum),rgba(25,19,47,.4));
  border:1px solid var(--line);
}
.wr-proof .e{font-family:'JetBrains Mono';font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--ink3);display:flex;align-items:center;gap:8px}
.wr-proof .e .d{width:6px;height:6px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint);animation:wr-pulse 1.4s infinite}
.wr-proof-div{width:1px;height:24px;background:var(--line2)}
.wr-proof-stat{display:flex;align-items:baseline;gap:8px;font-family:'Fraunces';font-weight:500;letter-spacing:-.01em}
.wr-proof-stat .v{font-size:20px}
.wr-proof-stat .v .it{font-style:italic;color:var(--ink2)}
.wr-proof-stat .k{font-family:'JetBrains Mono';font-size:10.5px;font-weight:700;color:var(--ink2);letter-spacing:.6px;text-transform:uppercase}
.wr-proof-stat .m{font-family:'JetBrains Mono';font-size:11px;font-weight:800;color:var(--mint);margin-left:4px}
.wr-proof-stat .m.dn{color:var(--coral)}
@media(max-width:768px){
  .wr-proof{flex-direction:column;align-items:flex-start;gap:10px;padding:14px 16px}
  .wr-proof-div{display:none}
  .wr-proof-stat .v{font-size:17px}
}

/* ── EMPTY STATE ─────────────────────────────────── */
.wr-empty{padding:48px 24px;text-align:center;color:var(--ink2);font-size:14px}
.wr-empty .glyph{display:block;font-size:42px;margin-bottom:12px;opacity:.5;font-family:'Fraunces';font-style:italic}
.wr-empty b{color:var(--ink);font-weight:600;font-family:'Fraunces';font-weight:500;font-size:18px}
.wr-empty .sub{font-size:12.5px;margin-top:6px;color:var(--ink3)}
.wr-empty .err{margin-top:10px;font-family:'JetBrains Mono';font-size:10px;color:var(--coral);background:var(--coral-soft);padding:7px 12px;border-radius:10px;display:inline-block}

/* ── MODALS (shared) ─────────────────────────────── */
.wr-overlay{position:fixed;inset:0;background:rgba(4,4,12,.66);backdrop-filter:blur(8px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:wr-fade .2s}
.wr-overlay.center{align-items:center;padding:18px}
.wr-sheet{
  width:100%;max-width:520px;
  background:linear-gradient(180deg,var(--vapor),var(--plum));
  border:1px solid var(--line2);border-radius:22px 22px 0 0;
  box-shadow:0 -20px 60px rgba(0,0,0,.7);
  animation:wr-sheet .3s cubic-bezier(.2,1.2,.4,1);
  max-height:92dvh;overflow-y:auto;
}
.wr-sheet.mini{border-radius:22px;animation:wr-pop .3s ease;max-width:430px}
.wr-x{
  position:absolute;top:14px;right:14px;
  background:var(--vapor);border:1px solid var(--line);border-radius:50%;
  width:32px;height:32px;display:grid;place-items:center;cursor:pointer;
  font-family:initial;font-size:16px;color:var(--ink2);z-index:2;
}
.wr-x:hover{color:var(--ink);border-color:var(--line2)}

/* ── TRADE SHEET ─────────────────────────────────── */
.wr-tshead{padding:22px 22px 4px;position:relative}
.wr-tshead-row{display:flex;align-items:center;gap:13px;padding-right:38px}
.wr-tshead .wr-av{width:54px;height:54px;border-radius:14px;font-size:20px}
.wr-tshead .title{flex:1;min-width:0}
.wr-tshead .sym{font-family:'Fraunces';font-weight:500;font-size:26px;letter-spacing:-.02em;line-height:1;font-variation-settings:"opsz" 96}
.wr-tshead .sub{font-family:'JetBrains Mono';font-size:11px;color:var(--ink2);font-weight:600;margin-top:4px}

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

.wr-confirm{
  width:calc(100% - 44px);margin:14px 22px 0;padding:15px 0;border:none;border-radius:14px;
  font-family:'Fraunces';font-weight:500;font-size:14.5px;letter-spacing:-.005em;cursor:pointer;
  background:var(--magenta);color:#1B0410;
  box-shadow:0 10px 28px -10px var(--magenta-glow);transition:transform .12s;
}
.wr-confirm:hover:not(:disabled){transform:translateY(-1px)}
.wr-confirm.sell{background:var(--coral);color:#2E0009;box-shadow:0 10px 28px -10px rgba(255,122,110,.5)}
.wr-confirm:disabled{opacity:.45;cursor:not-allowed;background:var(--vapor2);color:var(--ink2);box-shadow:none}
.wr-tfoot{margin:10px 22px 22px;font-family:'JetBrains Mono';font-size:9.5px;color:var(--ink3);text-align:center;font-weight:600;letter-spacing:.5px;text-transform:uppercase}

/* ── WALLET DRAWER ───────────────────────────────── */
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

/* ── PRESETS EDITOR ──────────────────────────────── */
.wr-echips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.wr-echip{display:inline-flex;align-items:center;gap:7px;padding:8px 8px 8px 14px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700}
.wr-echip .x{width:19px;height:19px;border-radius:50%;background:var(--coral-soft);color:var(--coral);border:none;cursor:pointer;font-size:12px;display:grid;place-items:center;font-family:initial}
.wr-eadd{display:flex;gap:6px;align-items:center}
.wr-eadd input{width:74px;padding:8px 12px;border-radius:999px;background:var(--vapor);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700;color:var(--ink);outline:none}
.wr-eadd .plus{width:30px;height:30px;border-radius:50%;background:var(--magenta);color:#1B0410;border:none;cursor:pointer;font-size:17px;font-family:initial}
.wr-sec-lbl{font-family:'JetBrains Mono';font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--ink3);margin:16px 0 9px}
.wr-esave{width:100%;margin-top:18px;padding:14px 0;border:none;border-radius:13px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;background:var(--magenta);color:#1B0410;box-shadow:0 6px 18px -6px var(--magenta-glow)}

/* ── TOASTS ──────────────────────────────────────── */
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

/* ── CONFETTI ────────────────────────────────────── */
.wr-confetti{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}
.wr-cpiece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:wr-confetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}

@media(prefers-reduced-motion:reduce){.wr-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
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
   CONFIG — unchanged from prior Ape.jsx.
   Pump.fun bonding curve. Atomic 3% SOL fee → FEE_WALLET.
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
const BAL_COMMITMENT = 'processed';
const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};
const balRpcRace = (op) => op(getConn(BAL_COMMITMENT));

// Sped up: fresh tokens land in the feed twice as fast as before.
const POLL_RECENT  = 2500;
const POLL_SOL     = 30000;
const POLL_BALANCE = 30000;

/* ============================================================
   LOCAL BURNER WALLET — unchanged.
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

/* ============================================================
   VIBE CHECK — same algo as before. Verdicts relabeled to
   Steady / Mixed / Wild for the new register.
   ============================================================ */
const RISK_CEIL = 85;
function riskRead(t) {
  if (!t) return { score: 0, verdict: 'Unknown', tier: 'high', label: 'Wild', knowns: [], unknowns: [] };
  const liq = t.liquidity || 0;
  const mcap = t.mcap || 0;
  const hold = t.holders || 0;
  const vol = t.volume24h || 0;
  const ageMin = Number.isFinite(t.ageMs) ? t.ageMs / 60000 : Infinity;

  const dataPoints = (liq > 0 ? 1 : 0) + (hold > 0 ? 1 : 0) + (vol > 0 ? 1 : 0) + (mcap > 0 ? 1 : 0);
  const tooThin = dataPoints <= 1;

  let s = 0;
  s += Math.min(26, Math.log10(Math.max(liq, 1)) * 5.6);
  let liqRatio = null;
  if (mcap > 0 && liq > 0) {
    liqRatio = liq / mcap;
    s += liqRatio >= 0.15 ? 22 : liqRatio >= 0.08 ? 16 : liqRatio >= 0.03 ? 9 : liqRatio >= 0.01 ? 4 : 0;
  }
  s += Math.min(16, Math.log10(Math.max(hold, 1)) * 5.3);
  if (hold >= 50 && mcap > 0) {
    const perHolder = mcap / hold;
    s += perHolder < 500 ? 6 : perHolder < 2000 ? 3 : 0;
  }
  if (liq > 0) {
    const turn = vol / liq;
    s += (turn >= 0.1 && turn <= 4) ? 12 : (turn > 4 && turn <= 12) ? 6 : turn > 0 ? 3 : 0;
  }
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

function ageMs(iso) { return iso ? Date.now() - new Date(iso).getTime() : Infinity; }

/* normalize — adds pairCreatedAtMs so we can re-compute live ages
   without re-fetching the feed. */
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
    bond, dex: t.dexId || (t.pumpPool ? 'pump.fun' : null),
    source: 'dexscreener',
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
   PUMP.FUN TRADE — unchanged.
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

/* ============================ TWITTER ============================ */
function buildShareUrl() { if (typeof window === 'undefined') return ''; try { return new URL(window.location.origin + window.location.pathname).toString(); } catch (e) { return ''; } }
function buildTweetText(o) {
  const { mode, token, solAmount, outAmount, percentage } = o;
  if (mode === 'buy') {
    const recv = outAmount > 0 ? '\n-> ' + formatTokens(outAmount) + ' $' + token.sym : '';
    return 'Just aped ' + solAmount + ' SOL into $' + token.sym + ' on wonderland//radar' + recv + '\n\nFresh launch caught at first light:';
  }
  const got = outAmount > 0 ? '\n-> ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Just sold ' + percentage + '% of my $' + token.sym + ' on wonderland//radar' + got + '\n\nFresh launches every minute:';
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text }); if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
}

/* ============================ TOKEN ICON ============================ */
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

/* Token color from mint — stable, recognizable. */
function colorFor(mint) {
  const palette = ['#a855f7','#f472b6','#fb923c','#60a5fa','#22d3ee','#facc15','#16a34a','#ec4899','#0ea5e9','#fda4af','#f59e0b','#9333ea','#84cc16','#06b6d4','#dc2626'];
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
function shade(hex, p) {
  const f = parseInt(hex.slice(1), 16); const t = p < 0 ? 0 : 255; const pp = Math.abs(p) / 100;
  const R = f >> 16, G = (f >> 8) & 0xFF, B = f & 0xFF;
  const r = Math.round((t - R) * pp) + R;
  const g = Math.round((t - G) * pp) + G;
  const b = Math.round((t - B) * pp) + B;
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
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

/* ============================ PRESETS EDITOR ============================ */
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

/* ============================ WALLET DRAWER ============================ */
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
        if (typeof toCanvas === 'function') {
          await toCanvas(qrRef.current, addr, { width: 160, margin: 1, color: { dark: '#0E0B1F', light: '#ffffff' } });
        }
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
            <span style={{width:8,height:8,borderRadius:'50%',background:'var(--mint)',boxShadow:'0 0 8px var(--mint)'}} />
            Your wallet
          </h3>
          <div style={{fontFamily:"'JetBrains Mono'",fontSize:10.5,color:'var(--ink2)',marginTop:5,fontWeight:600,letterSpacing:'.3px'}}>lives on this device · signs instantly · your keys</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="wr-balcard">
            <div className="wr-ballbl">Ready to ape</div>
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
              <button className="wr-go" disabled={busy || !dest || !(Number(amt) > 0) || Number(amt) > maxOut} onClick={()=>onWithdraw(dest, Number(amt))}>
                {busy ? 'Sending…' : 'Withdraw ' + (Number(amt) > 0 ? Number(amt) + ' SOL' : '')}
              </button>
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

          <div className="wr-warn"><b>Hot burner.</b> Keep only ape-money here. The key is stored on this device — clear your browser and it's gone unless you backed it up.</div>
          <div style={{textAlign:'center'}}><span className="wr-nc">● Non-custodial · your keys</span></div>
        </div>
      </div>
    </div>
  );
}

/* ============================ TRADE SHEET ============================ */
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
              <div className="sub">
                {formatPrice(token.price)}
                {Number.isFinite(token.change) && token.change !== 0 ? <> · <span style={{color:token.change<0?'var(--coral)':'var(--mint)'}}>{formatPct(token.change)}</span></> : null}
              </div>
            </div>
          </div>
        </div>

        <div className={'wr-vibe ' + tierClass}>
          <div className="wr-vibe-top">
            <span className="wr-vibe-l">Vibe check</span>
            <span className="wr-vibe-s" style={{color:tierColor}}>{read.score}<span className="of">/{RISK_CEIL}</span></span>
          </div>
          <div className="wr-vibe-verdict" style={{color:tierColor}}>{read.verdict}</div>
          <div className="wr-vibe-chks">
            {read.knowns.map((c,i)=><span key={i} className={'wr-chk '+c[0]}>{c[1]}</span>)}
          </div>
        </div>
        <div className="wr-dyor">Can't be checked: {read.unknowns.join(' · ')}. Even a clean read can rug — only ape what you can lose.</div>

        <div className={'wr-mode-tabs' + (isBuy?'':' sell')}>
          <div className="wr-mode-ind" />
          <button className={'wr-mode-tab'+(isBuy?' active':'')} onClick={()=>setMode('buy')}>Ape</button>
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
          {confirming ? (isBuy?'Aping…':'Selling…')
            : !amount||Number(amount)<=0 ? (isBuy?'Enter SOL amount':'Enter percentage')
            : !hasFunds ? (isBuy?'Not enough SOL':(ownedUi<=0?('No '+token.sym+' to sell'):'Need ~0.003 SOL for fees'))
            : (isBuy?('Ape '+amount+' SOL → '+token.sym):('Sell '+Math.min(100,Number(amount))+'% of '+token.sym))}
        </button>
        <p className="wr-tfoot">{token.dex || 'pump.fun'} · 3% fee · settles in seconds</p>
      </div>
    </div>
  );
}

/* ============================ SPECIMEN ROW ============================ */
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
        </div>
      </div>
      <span className={ageClass(ageMsLive)}>{fmtAgeShort(ageMsLive)}</span>
      <span className="wr-num">{formatMoney(token.mcap)}</span>
      <span className="wr-num dim wr-col-liq">{formatMoney(token.liquidity)}</span>
      <span className="wr-num dim wr-col-vol">{formatMoney(token.volume24h)}</span>
      <span className="wr-col-holders">
        <span className={'wr-risk ' + r.tier}><span className="wr-risk-dot" />{r.label}</span>
      </span>
      <div className="wr-col-curve wr-curve">
        {token.bond != null ? (
          <>
            <span className="wr-curve-bar"><i style={{width:token.bond+'%'}} /></span>
            <span className="wr-curve-pct">{token.bond}%</span>
          </>
        ) : <span className="wr-curve-pct">—</span>}
      </div>
      <div className="wr-row-actions" onClick={e=>e.stopPropagation()}>
        <button className="wr-btn-spec" disabled={busy} onClick={ape}>
          {busy ? <><span className="wr-spinner" /> Aping</> : <>Ape {quickAmount} <span className="arrow">→</span></>}
        </button>
      </div>
    </div>
  );
});

/* ============================ MAIN ============================ */
export default function Ape() {
  useWrCSS();
  const wallet = useLocalWallet();
  const connection = useMemo(() => getConn('confirmed'), []);

  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();
  const [quickAmount, setQuickAmount] = useState(() => buyPresets[Math.min(2, buyPresets.length-1)] || 0.5);
  useEffect(() => { if (!buyPresets.includes(quickAmount)) setQuickAmount(buyPresets[Math.min(2, buyPresets.length-1)] || buyPresets[0]); }, [buyPresets]); // eslint-disable-line

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [busyMint, setBusyMint] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [filterWild, setFilterWild] = useState(false);
  const [minLiq, setMinLiq] = useState(0);
  const freshThresholdMs = 30 * 60000;

  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);

  // Track which mints we've ever seen so we can flag new arrivals + give
  // each a stable "specimen number" for the field-log feel.
  const seenMintsRef = useRef(new Map()); // mint -> { specimenNo, firstSeenAt }
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

        // Assign specimen numbers to any mints we haven't seen yet.
        const justArrived = new Set();
        for (const t of normalized) {
          if (!seenMintsRef.current.has(t.mint)) {
            specimenCounterRef.current += 1;
            seenMintsRef.current.set(t.mint, { specimenNo: specimenCounterRef.current, firstSeenAt: Date.now() });
            justArrived.add(t.mint);
          }
        }
        if (!cancelled) {
          setRecentTokens(normalized);
          setRecentLoading(false);
          setRecentError(null);
          if (justArrived.size > 0) {
            setNewlyArrived(justArrived);
            // Clear the "fresh" highlight after the develop animation finishes.
            setTimeout(() => setNewlyArrived(new Set()), 1000);
          }
        }
      } catch (e) {
        if (!cancelled) { setRecentError(String((e && e.message)||'Feed unreachable').slice(0,120)); setRecentLoading(false); }
      }
    }
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // 1-second tick so ages count up live without re-fetching.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAgeTick(t => (t + 1) | 0), 1000);
    return () => clearInterval(id);
  }, []);

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
    const solP = balRpcRace(c => c.getBalance(owner, BAL_COMMITMENT))
      .then(l => setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(l), decimals: 9, uiAmount: l/1e9 } })))
      .catch(e => console.warn('[wr-bal] SOL', e && e.message));
    const tokP = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT))
      .then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; }))
      .catch(e => console.warn('[wr-bal] SPL', e && e.message));
    const t22P = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT))
      .then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; }))
      .catch(e => console.warn('[wr-bal] T22', e && e.message));
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

  /* ====== executeSwap — UNCHANGED. Local keypair signs instantly. ====== */
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
    const feeIx = SystemProgram.transfer({ fromPubkey: userPk, toPubkey: FEE_WALLET, lamports: Number(feeLamports) });

    const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    const ixs = route.instructions.slice();
    if (isBuy) { let at = 0; while (at < ixs.length && ixs[at].programId.toBase58() === CB_PROGRAM) at++; ixs.splice(at, 0, feeIx); }
    else { ixs.push(feeIx); }

    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({ payerKey: userPk, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message(route.alts);
    const tx = new VersionedTransaction(message);

    let simLogs = null;
    try {
      const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' });
      simLogs = (sim && sim.value && sim.value.logs) || null;
      if (sim && sim.value && sim.value.err) { console.error('[wr-sim]', JSON.stringify(sim.value.err)); throw new Error(describeSimLogs(simLogs, JSON.stringify(sim.value.err))); }
    } catch (simErr) { if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr; console.warn('[wr-sim] skip', simErr && simErr.message); }

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
      await new Promise(r => setTimeout(r, 2000));
    }
    if (onchainErr) throw new Error('Trade failed on-chain — price likely moved past slippage.');
    return { sig, confirmed, mode, token, route: route.route };
  }, [wallet.keypair, wallet.publicKey, connection]);

  const runTrade = useCallback(async (args) => {
    const { mode, swapParams, token } = args;
    const res = await executeSwap({ mode, swapParams, token });
    const sig = res.sig, confirmed = res.confirmed;
    let outAmount = 0;
    if (mode === 'buy' && token && token.price > 0 && solPrice > 0) outAmount = ((Number(swapParams.tradeLamports)/1e9)*solPrice)/token.price;
    else if (mode === 'sell' && token && token.price > 0 && solPrice > 0) outAmount = Math.max(0, ((swapParams.tradeTokensUi*token.price)/solPrice)*(1-FEE_BPS/10000));

    if (confirmed) {
      fireConfetti();
      const tweetText = buildTweetText({ mode, token, solAmount: swapParams.solAmount, outAmount, percentage: swapParams.percentage });
      pushToast({
        kind: 'success', emoji: '🎉',
        body: mode === 'buy'
          ? <><b>Aped ${token.sym}</b><br/>{swapParams.solAmount} SOL{outAmount>0?<> → ~{formatTokens(outAmount)} {token.sym}</>:null}</>
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
  }, [executeSwap, fireConfetti, pushToast, refreshSol, refreshOneToken, aggressiveRefresh, solPrice]);

  const onApe = useCallback(async (token) => {
    if (busyMint) return;
    const availSol = Math.max(0, ((solBalance && solBalance.uiAmount) || 0) - SOL_RESERVE);
    if (quickAmount > availSol) { pushToast({ kind: 'error', emoji: '🪙', body: <><b>Need more SOL</b><br/>Deposit to your wallet to ape {quickAmount} SOL.</> }); setWalletOpen(true); return; }
    const params = buildBuyParams(quickAmount);
    if (!params) { pushToast({ kind: 'error', emoji: '⚠️', body: 'Amount too small.' }); return; }
    setBusyMint(token.mint);
    try { await runTrade({ mode: 'buy', swapParams: params, token }); }
    catch (e) { pushToast({ kind: 'error', emoji: '😵', body: friendlyError(e) }); }
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
      pushToast({ kind: 'success', emoji: '✅', body: <><b>Sent {solAmt} SOL</b></>, solscan: 'https://solscan.io/tx/' + sig });
      refreshSol();
      [1500, 4000].forEach(ms => setTimeout(refreshSol, ms));
      aggressiveRefresh();
    } catch (e) { pushToast({ kind: 'error', emoji: '😵', body: friendlyError(e) }); }
    finally { setWithdrawing(false); }
  }, [connection, wallet.keypair, wallet.publicKey, pushToast, refreshSol, aggressiveRefresh]);

  /* ===== Derived list ===== */
  const filtered = useMemo(() => {
    let l = recentTokens.slice();

    // Aggressive dedup by mint + name + symbol — first wins.
    const seenMint = new Set(), seenName = new Set(), seenSym = new Set();
    l = l.filter(t => {
      if (!t || !t.mint) return false;
      if (seenMint.has(t.mint)) return false;
      const nm = String(t.name || '').trim().toLowerCase();
      const sm = String(t.sym  || '').trim().toLowerCase();
      if (nm && seenName.has(nm)) return false;
      if (sm && sm !== '???' && seenSym.has(sm)) return false;
      seenMint.add(t.mint);
      if (nm) seenName.add(nm);
      if (sm && sm !== '???') seenSym.add(sm);
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

  /* ===== Proof band stats ===== */
  const stats = useMemo(() => {
    const now = Date.now();
    const fresh = filtered.filter(t => t.pairCreatedAtMs && (now - t.pairCreatedAtMs) < 60000).length;
    const trending = filtered.filter(t => (t.volume24h || 0) > 40000).length;
    const totalVol = filtered.reduce((s, t) => s + (t.volume24h || 0), 0);
    const topMover = filtered
      .filter(t => Number.isFinite(t.change))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null;
    return { fresh, trending, totalVol, topMover };
  }, [filtered]);

  const fieldLogNo = specimenCounterRef.current;

  return (
    <div className="wr-root">
      <nav className="wr-nav">
        <div className="wr-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div className="wr-radar-icon" />
          <span className="wr-bname">wonderland<span className="sep">//</span><span className="it">radar</span></span>
        </div>
        <div className="wr-nav-eyebrow">
          <span className="live" />
          <span>FIELD LOG · ENTRY № {fieldLogNo.toLocaleString()}</span>
        </div>
        <div className="wr-nav-wallet" onClick={() => setWalletOpen(true)}>
          <span className="dot" />
          <span className="glyph">◎</span>
          <b>{formatSol((solBalance && solBalance.uiAmount) || 0)}</b>
          {!wallet.backedUp ? <span className="nudge" title="Back up your wallet" /> : null}
        </div>
      </nav>

      <div className="wr-qbar">
        <span className="wr-qlabel"><span className="b">⚡</span>Quick ape</span>
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

          <section className="wr-hero">
            <h1>Fresh launches, <span className="it">caught at first light.</span></h1>
            <div className="wr-hero-cta">
              <button className="wr-btn-ape" onClick={() => { const el = document.getElementById('wr-feed'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                Start aping <span className="arrow">→</span>
              </button>
              <span className="wr-no-connect">◌ No wallet connect needed</span>
            </div>
          </section>

          <section className="wr-offer-strip">
            <div className="wr-offer o1">
              <div className="wr-offer-num"><span className="glyph">⚡</span><span>① The hook</span></div>
              <h3>Two-second <span className="it">ape.</span></h3>
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
              <div className="mini-radar">
                <div className="b b1" />
                <div className="b b2" />
              </div>
            </div>
          </section>

          <div className="wr-list-frame" id="wr-feed">
            <div className="wr-list-head">
              <div className="wr-list-title">
                <span className="e">◉ Live feed</span>
                <span className="t">Recently <span className="it">emerged</span></span>
              </div>
              <div className="wr-list-filters">
                <button className={'wr-chip' + (filterWild ? ' on' : '')} onClick={() => setFilterWild(v => !v)}>⌖ Wild only</button>
                <button className={'wr-chip' + (minLiq ? ' on' : '')} onClick={() => { const opts = [0, 5000, 20000, 50000]; setMinLiq(opts[(opts.indexOf(minLiq) + 1) % opts.length]); }}>
                  ⌬ Min liq {minLiq ? '$' + format(minLiq) : 'any'}
                </button>
                <span style={{width:1,height:22,background:'var(--line)',margin:'0 2px'}} />
                <button className={'wr-chip' + (sortBy === 'newest' ? ' on' : '')} onClick={() => setSortBy('newest')}>Freshest</button>
                <button className={'wr-chip' + (sortBy === 'vibe'   ? ' on' : '')} onClick={() => setSortBy('vibe')}>Steadiest</button>
                <button className={'wr-chip' + (sortBy === 'volume' ? ' on' : '')} onClick={() => setSortBy('volume')}>Loudest</button>
              </div>
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
                  {recentLoading ? <><b>Warming up the radar…</b><div className="sub">Pulling fresh pump.fun launches.</div></>
                    : recentError ? <><b>Feed offline</b><div className="sub">Retrying automatically.</div><div className="err">{recentError}</div></>
                    : <><b>Nothing matches the filter</b><div className="sub">Loosen min liquidity or turn off Wild only.</div></>}
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
            <span className="wr-proof-stat">
              <span className="v">{stats.fresh}<span className="it"> fresh</span></span>
              <span className="k">in &lt;60s</span>
            </span>
            <span className="wr-proof-div" />
            <span className="wr-proof-stat">
              <span className="v">{stats.trending}</span>
              <span className="k">trending</span>
            </span>
            <span className="wr-proof-div" />
            <span className="wr-proof-stat">
              <span className="v">{formatMoney(stats.totalVol)}</span>
              <span className="k">volume tracked</span>
            </span>
            {stats.topMover && (
              <>
                <span className="wr-proof-div" />
                <span className="wr-proof-stat">
                  <span className="v">{stats.topMover.sym}</span>
                  <span className="k">top mover</span>
                  <span className={'m' + (stats.topMover.change < 0 ? ' dn' : '')}>{formatPct(stats.topMover.change)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {presetsOpen ? <PresetsModal buyPresets={buyPresets} setBuyPresets={setBuyPresets} sellPresets={sellPresets} setSellPresets={setSellPresets} onClose={()=>setPresetsOpen(false)} /> : null}
      {walletOpen ? <WalletDrawer wallet={wallet} solBalance={solBalance} solPrice={solPrice} onWithdraw={onWithdraw} busy={withdrawing} onClose={()=>setWalletOpen(false)} /> : null}
      {tradeOpen ? <TradeSheet token={tradeOpen.token} initialMode={tradeOpen.mode} onClose={()=>setTradeOpen(null)} onConfirm={onSheetConfirm}
        buyPresets={buyPresets} sellPresets={sellPresets} solBalance={solBalance} tokenBalance={balances[tradeOpen.token.mint]} solPrice={solPrice} /> : null}

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
