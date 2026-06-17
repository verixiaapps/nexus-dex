// Ape.jsx — instant one-tap launch gallery (private)
// Isolated one-tap memecoin gallery on Solana. Self-generated local burner
// wallet (no Phantom, no connect) signs instantly in-browser. pump.fun
// bonding curve only. Atomic 3% SOL fee (unchanged).
//
//   WALLET : Keypair.generate() on first visit, secret key stored plain in
//            localStorage (true burner — zero friction). Signs with
//            tx.sign([keypair]) — no popup, no prompt. Deposit by address/QR,
//            withdraw to any address, back up by exporting the secret key
//            (Phantom-importable). Backup is always available, never blocking.
//
//   BUY    : pure one-tap. Quick-buy bar sets X SOL. Tap Ape -> 0.97/1.10-sized
//            curve buy + prepended 0.03X SOL fee -> FEE_WALLET. Wallet debit = X.
//   SELL   : one-tap presets (25/50/100%). Full token amount -> curve; 3% of
//            estimated SOL out appended as fee after the curve pays native SOL.
//
//   TRUST  : honest signal computed from liquidity + holders + volume + age.
//            NOT a contract audit. Wire RugCheck/GoPlus server-side for a real
//            rug check.

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

const LR_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@600;700;800&display=swap');
.lr-root{
  --bg:#0B0A1A; --bg2:#100E22; --surf:#181534; --surf2:#221E45; --line:rgba(255,255,255,.08); --line2:rgba(255,255,255,.14);
  --amber:#FFB52E; --gold:#FFD46B; --green:#2BE08A; --red:#FF5470; --violet:#9B7BFF; --sky:#56C8FF; --pink:#FF7BC8;
  --ink:#F2F0FF; --ink2:rgba(242,240,255,.6); --ink3:rgba(242,240,255,.34);
  min-height:100vh;color:var(--ink);font-family:'Inter',-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased;
  position:relative;overflow-x:hidden;padding-bottom:46px;
  background:
    radial-gradient(820px 520px at 85% -8%,rgba(155,123,255,.18),transparent 58%),
    radial-gradient(640px 440px at 5% 0%,rgba(255,123,200,.12),transparent 55%),
    radial-gradient(700px 500px at 50% 112%,rgba(86,200,255,.1),transparent 60%),
    var(--bg);
  background-attachment:fixed;
}
.lr-root,.lr-root *{box-sizing:border-box}
@keyframes lrSweep{to{transform:rotate(360deg)}}
@keyframes lrPulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes lrBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-4px) rotate(3deg)}}
@keyframes lrPop{0%{opacity:0;transform:scale(.8) translateY(8px)}60%{transform:scale(1.04)}100%{opacity:1;transform:scale(1) translateY(0)}}
@keyframes lrLand{0%{opacity:0;transform:scale(.6);box-shadow:0 0 0 2px var(--green),0 0 40px rgba(43,224,138,.6)}100%{opacity:1;transform:scale(1)}}
@keyframes lrSheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes lrFade{from{opacity:0}to{opacity:1}}
@keyframes lrCoin{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--cx),-42px) scale(.4)}}
@keyframes lrSquish{0%{transform:scale(1)}35%{transform:scale(.9,1.08)}70%{transform:scale(1.04,.96)}100%{transform:scale(1)}}
@keyframes lrSpin{to{transform:rotate(360deg)}}
@keyframes lrToastIn{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes lrConfetti{0%{transform:translate(-50%,-50%) rotate(0);opacity:1}100%{transform:translate(calc(-50% + var(--dx,0)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}}

.lr-app{max-width:560px;margin:0 auto;position:relative;z-index:5}
@media(min-width:1024px){.lr-app{max-width:1100px}}

.lr-top{position:sticky;top:0;z-index:42;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(11,10,26,.82);backdrop-filter:blur(18px)}
.lr-brand{display:flex;align-items:center;gap:9px;cursor:pointer}
.lr-radar{width:30px;height:30px;border-radius:50%;position:relative;flex-shrink:0;border:1px solid rgba(255,181,46,.35);background:radial-gradient(circle,rgba(255,181,46,.12),transparent 70%);overflow:hidden}
.lr-radar::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 290deg,rgba(255,181,46,.65) 350deg,transparent 360deg);animation:lrSweep 2.8s linear infinite}
.lr-radar::after{content:'';position:absolute;inset:6px;border-radius:50%;border:1px solid rgba(255,181,46,.25)}
.lr-bname{font-family:'Space Grotesk';font-weight:700;font-size:15px}
.lr-bname .sl{opacity:.4;margin:0 2px;font-weight:500}
.lr-bname .ra{background:linear-gradient(90deg,var(--pink),var(--violet),var(--sky));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lr-wbtn{display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;cursor:pointer;background:var(--surf);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-size:12px;font-weight:700;position:relative}
.lr-wbtn:hover{border-color:var(--line2)}
.lr-wbtn .lr-sol{color:var(--amber)}
.lr-wdot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green)}
.lr-wbtn .lr-nudge{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--amber);border:2px solid var(--bg);box-shadow:0 0 6px var(--amber)}

.lr-qbar{position:sticky;top:54px;z-index:41;display:flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(11,10,26,.9);backdrop-filter:blur(18px);overflow-x:auto;scrollbar-width:none}
.lr-qbar::-webkit-scrollbar{display:none}
.lr-qlabel{font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink2);flex-shrink:0;display:flex;align-items:center;gap:5px}
.lr-qlabel .b{color:var(--amber)}
.lr-qamt{flex-shrink:0;display:flex;align-items:center;gap:4px;padding:6px 13px;border-radius:999px;background:var(--surf);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-weight:700;font-size:13px;cursor:pointer;transition:.12s}
.lr-qamt.active{background:linear-gradient(135deg,var(--amber),var(--gold));color:#1a1400;border-color:transparent;box-shadow:0 0 16px rgba(255,181,46,.4)}
.lr-qamt .lr-sol{opacity:.55;font-size:11px}
.lr-qedit{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:var(--surf);border:1px solid var(--line);display:grid;place-items:center;cursor:pointer;color:var(--ink2);font-size:12px;font-family:initial}
.lr-qedit:hover{border-color:var(--amber);color:var(--amber)}
.lr-qinstant{flex-shrink:0;margin-left:auto;display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:.5px;color:var(--green);background:rgba(43,224,138,.12);padding:6px 10px;border-radius:999px;white-space:nowrap}
.lr-qinstant .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green);animation:lrPulse 1.3s infinite}

.lr-ribbon{display:flex;align-items:center;gap:8px;padding:10px 16px 2px;overflow-x:auto;scrollbar-width:none}
.lr-ribbon::-webkit-scrollbar{display:none}
.lr-rlbl{font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--pink);flex-shrink:0}
.lr-rchip{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--surf);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:11px;font-weight:700;cursor:pointer}
.lr-rchip .up{color:var(--green);font-weight:800}
.lr-rchip .dn{color:var(--red);font-weight:800}

.lr-hero{padding:14px 16px 2px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.lr-hero h1{font-family:'Space Grotesk';font-weight:700;font-size:21px;margin:0;letter-spacing:-.01em}
.lr-hero h1 .g{background:linear-gradient(90deg,var(--amber),var(--pink));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lr-meta{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--ink2);display:flex;align-items:center;gap:6px;flex-shrink:0}
.lr-meta .live{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:lrPulse 1.3s infinite}
.lr-meta .live.warn{background:var(--amber);box-shadow:0 0 8px var(--amber)}

.lr-controls{display:flex;gap:6px;padding:10px 16px 2px;overflow-x:auto;scrollbar-width:none}
.lr-controls::-webkit-scrollbar{display:none}
.lr-seg{flex-shrink:0;padding:7px 13px;border-radius:999px;background:var(--surf);border:1px solid var(--line);color:var(--ink2);font-family:'Space Grotesk';font-size:11px;font-weight:700;cursor:pointer;transition:.15s}
.lr-seg.active{background:linear-gradient(135deg,var(--violet),var(--pink));color:#fff;border-color:transparent}
.lr-seg-div{flex-shrink:0;width:1px;height:22px;background:var(--line);align-self:center;margin:0 3px}

.lr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:11px;padding:12px 16px 0}
@media(min-width:430px){.lr-grid{grid-template-columns:repeat(3,1fr)}}
@media(min-width:720px){.lr-grid{grid-template-columns:repeat(4,1fr)}}
.lr-tile{position:relative;border-radius:20px;background:var(--surf);border:1px solid var(--line);overflow:hidden;animation:lrPop .4s cubic-bezier(.2,1.2,.4,1) backwards;cursor:pointer;transition:border-color .15s,transform .1s}
.lr-tile:hover{border-color:var(--line2)}
.lr-tile.new{animation:lrLand .55s cubic-bezier(.2,1,.3,1)}
.lr-tile:active{transform:scale(.985)}
.lr-face{position:relative;aspect-ratio:1/1;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 32%,rgba(155,123,255,.28),transparent 70%),linear-gradient(160deg,#2a2350,#181534)}
.lr-face .lr-img{width:100%;height:100%;object-fit:cover}
.lr-face .lr-emoji{font-size:46px;animation:lrBob 4s ease-in-out infinite;filter:drop-shadow(0 6px 14px rgba(0,0,0,.4))}
.lr-agep{position:absolute;top:9px;left:9px;font-family:'JetBrains Mono';font-size:9px;font-weight:800;padding:3px 8px;border-radius:999px;background:rgba(11,10,26,.72);backdrop-filter:blur(6px);color:var(--gold);letter-spacing:.3px}
.lr-trust{position:absolute;top:7px;right:7px;width:40px;height:40px}
.lr-trust svg{transform:rotate(-90deg)}
.lr-trust .tnum{position:absolute;inset:0;display:grid;place-items:center;font-family:'JetBrains Mono';font-weight:800;font-size:13px;padding-bottom:2px}
.lr-trust .tlbl{position:absolute;left:50%;bottom:-2px;transform:translateX(-50%);font-family:'JetBrains Mono';font-size:6.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase}
.lr-curve{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,.35)}
.lr-curve i{display:block;height:100%;background:linear-gradient(90deg,var(--amber),var(--gold))}
.lr-body{padding:10px 11px 11px}
.lr-symrow{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
.lr-sym{font-family:'Space Grotesk';font-weight:700;font-size:15px;line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-chg{font-family:'JetBrains Mono';font-size:11px;font-weight:800;color:var(--green);flex-shrink:0}
.lr-chg.down{color:var(--red)}
.lr-name{font-size:10px;color:var(--ink2);font-weight:500;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-statline{display:flex;align-items:center;gap:6px;margin-top:7px;font-family:'JetBrains Mono';font-size:9.5px;font-weight:700;color:var(--ink2)}
.lr-statline .price{color:var(--ink);font-weight:800}
.lr-statline b{color:var(--ink)}
.lr-ape{width:100%;margin-top:10px;border:none;cursor:pointer;padding:10px 0;border-radius:12px;font-family:'Space Grotesk';font-weight:700;font-size:13px;color:#04210f;background:linear-gradient(135deg,var(--green),#54f0ad);display:flex;align-items:center;justify-content:center;gap:5px;box-shadow:0 5px 16px -7px rgba(43,224,138,.6);transition:.1s;position:relative;overflow:hidden}
.lr-ape:active{animation:lrSquish .3s}
.lr-ape:disabled{opacity:.75;cursor:wait}
.lr-ape.filled{background:linear-gradient(135deg,#1FA968,#2BE08A);color:#fff}
.lr-ape .b{font-size:12px}
.lr-coinfx{position:absolute;left:50%;top:50%;font-size:14px;pointer-events:none;animation:lrCoin .7s ease forwards}
.lr-sells{display:flex;gap:5px;margin-top:7px}
.lr-sellbtn{flex:1;border:1px solid rgba(255,84,112,.4);background:rgba(255,84,112,.08);color:var(--red);cursor:pointer;padding:7px 0;border-radius:9px;font-family:'JetBrains Mono';font-weight:800;font-size:10px}
.lr-sellbtn:active{transform:scale(.95)}
.lr-sellbtn:disabled{opacity:.6;cursor:wait}
.lr-owned{display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:9px;color:var(--ink2);margin-top:8px;font-weight:700;padding:5px 8px;background:rgba(43,224,138,.07);border-radius:9px}
.lr-owned b{color:var(--green)}
.lr-spinner{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:lrSpin .7s linear infinite;display:inline-block}

.lr-empty{grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--ink2);font-size:14px}
.lr-empty .e{font-size:46px;display:block;margin-bottom:12px;opacity:.6}
.lr-empty b{color:var(--ink);font-weight:700}
.lr-empty .sub{font-size:12px;margin-top:6px;color:var(--ink3)}
.lr-empty .err{margin-top:10px;font-family:'JetBrains Mono';font-size:10px;color:var(--red);background:rgba(255,84,112,.08);padding:7px 12px;border-radius:10px;display:inline-block}

.lr-mascot{position:fixed;right:14px;bottom:16px;z-index:60;width:52px;height:52px;border-radius:50%;background:linear-gradient(150deg,var(--violet),var(--pink));display:grid;place-items:center;font-size:27px;cursor:pointer;box-shadow:0 10px 30px -8px rgba(155,123,255,.7);border:1.5px solid rgba(255,255,255,.2)}
.lr-mascot .e{animation:lrBob 3s ease-in-out infinite}
.lr-mbubble{position:fixed;right:14px;bottom:76px;z-index:60;max-width:210px;padding:9px 13px;border-radius:14px 14px 4px 14px;background:var(--surf2);border:1px solid var(--line);font-size:11.5px;font-weight:600;color:var(--ink);box-shadow:0 10px 30px rgba(0,0,0,.4);animation:lrPop .3s ease}

.lr-overlay{position:fixed;inset:0;background:rgba(4,4,12,.66);backdrop-filter:blur(8px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:lrFade .2s}
.lr-overlay.center{align-items:center;padding:18px}
.lr-sheet{width:100%;max-width:520px;background:var(--bg2);border:1px solid var(--line);border-radius:22px 22px 0 0;box-shadow:0 -20px 60px rgba(0,0,0,.7);animation:lrSheetIn .3s cubic-bezier(.2,1.2,.4,1);max-height:92dvh;overflow-y:auto}
.lr-sheet.mini{border-radius:22px;animation:lrPop .3s ease;max-width:430px}
.lr-x{position:absolute;top:14px;right:14px;background:var(--surf);border:1px solid var(--line);border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-size:16px;color:var(--ink2);z-index:2;font-family:initial}
.lr-shead{padding:22px 20px 4px;position:relative}
.lr-stitle{font-family:'Space Grotesk';font-weight:700;font-size:21px;margin:0;display:flex;align-items:center;gap:9px}
.lr-ssub{font-family:'JetBrains Mono';font-size:10px;color:var(--ink2);margin-top:5px;font-weight:600;letter-spacing:.3px}
.lr-sbody{padding:14px 20px 22px}

.lr-dhead{display:flex;align-items:center;gap:13px;padding:20px 20px 8px;position:relative}
.lr-dav{width:60px;height:60px;border-radius:18px;display:grid;place-items:center;font-size:30px;flex-shrink:0;overflow:hidden;background:radial-gradient(circle at 50% 35%,rgba(155,123,255,.3),transparent 70%),linear-gradient(160deg,#2a2350,#181534)}
.lr-dav .lr-img{width:100%;height:100%;object-fit:cover}
.lr-dsym{font-family:'Space Grotesk';font-weight:700;font-size:23px;line-height:1}
.lr-dsub{font-family:'JetBrains Mono';font-size:11px;color:var(--ink2);font-weight:600;margin-top:5px}
.lr-tcard{display:flex;align-items:center;gap:13px;margin:4px 20px 0;background:rgba(43,224,138,.08);border:1px solid rgba(43,224,138,.25);border-radius:16px;padding:13px 15px}
.lr-tcard.amber{background:rgba(255,181,46,.08);border-color:rgba(255,181,46,.28)}
.lr-tcard.red{background:rgba(255,84,112,.08);border-color:rgba(255,84,112,.28)}
.lr-tcnum{font-family:'Space Grotesk';font-weight:700;font-size:30px;line-height:1}
.lr-tcv{font-weight:700;font-size:14px}
.lr-tcs{font-family:'JetBrains Mono';font-size:9.5px;color:var(--ink2);font-weight:600;margin-top:3px;line-height:1.4}
.lr-checks{display:flex;flex-wrap:wrap;gap:7px;padding:12px 20px 0}
.lr-chk{font-family:'JetBrains Mono';font-size:9.5px;font-weight:700;padding:4px 10px;border-radius:999px;display:inline-flex;gap:4px}
.lr-chk.ok{background:rgba(43,224,138,.12);color:var(--green)}.lr-chk.cau{background:rgba(255,181,46,.12);color:var(--amber)}.lr-chk.bad{background:rgba(255,84,112,.12);color:var(--red)}
.lr-dyor{font-family:'JetBrains Mono';font-size:9px;color:var(--ink3);padding:8px 20px 0;font-weight:600;line-height:1.5}
.lr-modetabs{display:grid;grid-template-columns:1fr 1fr;margin:14px 20px 14px;background:var(--surf);border-radius:13px;padding:4px;position:relative}
.lr-mind{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);border-radius:10px;z-index:1;background:linear-gradient(135deg,var(--green),#54f0ad);transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s}
.lr-modetabs.sell .lr-mind{transform:translateX(100%);background:linear-gradient(135deg,var(--red),#ff86a0)}
.lr-mtab{padding:10px 0;text-align:center;font-family:'Space Grotesk';font-weight:700;font-size:12px;letter-spacing:.6px;color:var(--ink2);border-radius:10px;cursor:pointer;background:none;border:none;position:relative;z-index:2}
.lr-mtab.active{color:#04210f}.lr-modetabs.sell .lr-mtab.active{color:#2a0008}
.lr-row{background:var(--surf);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 20px}
.lr-rowtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.lr-rlabel{font-family:'JetBrains Mono';font-size:9px;color:var(--ink2);font-weight:800;letter-spacing:1px;text-transform:uppercase}
.lr-rbal{font-family:'JetBrains Mono';font-size:10px;color:var(--ink2);font-weight:700;display:flex;align-items:center;gap:6px}
.lr-rbal b{color:var(--ink)}
.lr-max{background:rgba(155,123,255,.2);border:1px solid rgba(155,123,255,.4);color:var(--violet);padding:3px 8px;border-radius:7px;font-family:'JetBrains Mono';font-size:9px;font-weight:800;cursor:pointer}
.lr-rmid{display:flex;align-items:center;gap:10px}
.lr-chip{display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--surf2);border-radius:999px;flex-shrink:0;font-weight:700;font-size:13px;font-family:'Space Grotesk'}
.lr-chiplogo{width:22px;height:22px;border-radius:50%;background:var(--surf);display:grid;place-items:center;font-size:13px;overflow:hidden}
.lr-chiplogo .lr-img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.lr-amt{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:'Space Grotesk';font-size:26px;text-align:right;font-weight:600;width:100%;min-width:0}
.lr-amt::placeholder{color:var(--ink3)}
.lr-presets{display:flex;gap:6px;margin:10px 20px 0;overflow-x:auto;scrollbar-width:none}.lr-presets::-webkit-scrollbar{display:none}
.lr-pchip{flex-shrink:0;padding:7px 13px;border-radius:999px;background:var(--surf);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-weight:700;font-size:11px;cursor:pointer}
.lr-pchip.active{background:var(--green);color:#04210f;border-color:transparent}
.lr-details{margin:12px 20px 0;padding:11px 15px;background:var(--surf);border-radius:14px;font-family:'JetBrains Mono';font-size:11px}
.lr-drow{display:flex;justify-content:space-between;padding:3px 0;font-weight:700;gap:8px}
.lr-drow>span:first-child{color:var(--ink2);font-weight:500}
.lr-dval{color:var(--ink);font-weight:700;text-align:right}.lr-dval.good{color:var(--green)}
.lr-banner{margin:12px 20px 0;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid rgba(255,84,112,.35);background:rgba(255,84,112,.08);color:var(--red)}
.lr-confirm{width:calc(100% - 40px);margin:14px 20px 0;padding:16px 0;border:none;border-radius:14px;font-family:'Space Grotesk';font-size:14px;font-weight:700;cursor:pointer;color:#04210f;background:linear-gradient(135deg,var(--green),#54f0ad)}
.lr-confirm.sell{background:linear-gradient(135deg,var(--red),#ff86a0);color:#2a0008}
.lr-confirm:disabled{opacity:.45;cursor:not-allowed;background:var(--surf2);color:var(--ink2)}
.lr-tfoot{margin:10px 20px 0;font-family:'JetBrains Mono';font-size:9px;color:var(--ink3);text-align:center;font-weight:700}

.lr-balcard{background:linear-gradient(135deg,var(--surf2),rgba(155,123,255,.12));border:1px solid rgba(155,123,255,.25);border-radius:18px;padding:18px;text-align:center;margin-bottom:13px}
.lr-ballbl{font-family:'JetBrains Mono';font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink2);font-weight:800}
.lr-balval{font-family:'Space Grotesk';font-weight:700;font-size:33px;margin-top:6px}
.lr-balval .u{font-size:17px;color:var(--ink2)}
.lr-balusd{font-family:'JetBrains Mono';font-size:12px;color:var(--ink2);font-weight:700;margin-top:2px}
.lr-wgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}
.lr-wact{padding:13px 0;border-radius:13px;border:1px solid var(--line);background:var(--surf);color:var(--ink);font-family:'Space Grotesk';font-weight:700;font-size:13px;cursor:pointer}
.lr-wact.primary{background:linear-gradient(135deg,var(--amber),var(--gold));color:#1a1400;border-color:transparent}
.lr-block{background:var(--surf);border-radius:14px;padding:13px 14px;margin-bottom:11px}
.lr-block-l{font-family:'JetBrains Mono';font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink2);font-weight:800;margin-bottom:8px}
.lr-qr{display:grid;place-items:center;margin-bottom:11px}
.lr-qr canvas,.lr-qr img{border-radius:12px;background:#fff;padding:8px;width:160px;height:160px}
.lr-addr{display:flex;align-items:center;gap:8px}
.lr-addr-v{flex:1;font-family:'JetBrains Mono';font-size:12px;color:var(--ink);font-weight:600;word-break:break-all;line-height:1.4}
.lr-copy{flex-shrink:0;background:var(--surf2);border:none;color:var(--ink2);border-radius:9px;padding:8px 12px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;cursor:pointer}
.lr-input{width:100%;padding:11px 13px;border-radius:11px;background:var(--surf2);border:1px solid var(--line);color:var(--ink);font-family:'JetBrains Mono';font-size:13px;font-weight:600;outline:none;margin-bottom:8px}
.lr-input:focus{border-color:var(--amber)}
.lr-go{width:100%;padding:13px 0;border:none;border-radius:12px;font-family:'Space Grotesk';font-weight:700;font-size:13px;cursor:pointer;background:linear-gradient(135deg,var(--violet),var(--pink));color:#fff}
.lr-go:disabled{opacity:.5;cursor:not-allowed}
.lr-secret{font-family:'JetBrains Mono';font-size:11px;color:var(--gold);word-break:break-all;line-height:1.5;background:rgba(255,181,46,.06);border:1px dashed rgba(255,181,46,.3);border-radius:10px;padding:11px 12px}
.lr-warn{font-family:'JetBrains Mono';font-size:10px;color:var(--amber);background:rgba(255,181,46,.08);border-radius:12px;padding:10px 12px;line-height:1.55;font-weight:600;margin-bottom:11px}
.lr-warn b{color:var(--gold)}
.lr-nc{display:inline-flex;align-items:center;gap:6px;font-family:'JetBrains Mono';font-size:9px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--green);background:rgba(43,224,138,.1);padding:4px 11px;border-radius:999px}

.lr-echips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lr-echip{display:inline-flex;align-items:center;gap:7px;padding:8px 8px 8px 14px;border-radius:999px;background:var(--surf);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700}
.lr-echip .x{width:19px;height:19px;border-radius:50%;background:rgba(255,84,112,.14);color:var(--red);border:none;cursor:pointer;font-size:12px;display:grid;place-items:center;font-family:initial}
.lr-eadd{display:flex;gap:6px}
.lr-eadd input{width:74px;padding:8px 12px;border-radius:999px;background:var(--surf);border:1px solid var(--line);font-family:'JetBrains Mono';font-size:13px;font-weight:700;color:var(--ink);outline:none}
.lr-eadd .plus{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--amber),var(--gold));color:#1a1400;border:none;cursor:pointer;font-size:17px;font-family:initial}
.lr-sec-lbl{font-family:'JetBrains Mono';font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--ink2);margin:16px 0 9px}
.lr-esave{width:100%;margin-top:18px;padding:14px 0;border:none;border-radius:13px;font-family:'Space Grotesk';font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(135deg,var(--amber),var(--gold));color:#1a1400}

.lr-toasts{position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:1100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.lr-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:16px;backdrop-filter:blur(20px);box-shadow:0 12px 32px rgba(0,0,0,.4);animation:lrToastIn .3s ease;font-size:13px;font-weight:600;border:1px solid var(--line)}
.lr-toast.success{background:linear-gradient(135deg,rgba(24,21,52,.95),rgba(43,224,138,.22));border-color:rgba(43,224,138,.4);color:var(--ink)}
.lr-toast.error{background:linear-gradient(135deg,rgba(24,21,52,.95),rgba(255,84,112,.2));border-color:rgba(255,84,112,.4);color:var(--ink)}
.lr-toast.info{background:rgba(24,21,52,.95);color:var(--ink)}
.lr-toast .em{font-size:21px;flex-shrink:0}
.lr-toast .tb{flex:1;min-width:0;line-height:1.35}.lr-toast .tb b{font-weight:800}
.lr-toast .ta{display:flex;gap:5px;flex-shrink:0}
.lr-taction{background:var(--surf);border:1px solid var(--line);color:var(--ink);padding:6px 10px;border-radius:9px;font-family:'JetBrains Mono';font-size:10px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.lr-taction.tw{background:linear-gradient(135deg,rgba(86,200,255,.3),rgba(43,224,138,.3));border-color:rgba(86,200,255,.4)}
.lr-taction svg{width:11px;height:11px}

.lr-confetti{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}
.lr-cpiece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:lrConfetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}

@media(prefers-reduced-motion:reduce){.lr-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;

function useLrCSS() {
  useEffect(() => {
    const id = 'wonderland-lr-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = LR_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ============================ CONFIG ============================ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;   // 3% — unchanged
const SOL_RESERVE = 0.01;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

const ALCHEMY_RPC =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_ALCHEMY_RPC) || '';
const BAL_RPC_POOL = [
  ALCHEMY_RPC,
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
const RPC_URL = BAL_RPC_POOL[0];
const BAL_COMMITMENT = 'processed';
const _connCache = new Map();
const getConn = (commitment, url = RPC_URL) => {
  const key = url + '|' + commitment;
  let c = _connCache.get(key);
  if (!c) { c = new Connection(url, commitment); _connCache.set(key, c); }
  return c;
};
const balRpcRace = (op) => {
  const conns = BAL_RPC_POOL.map(u => getConn(BAL_COMMITMENT, u));
  return Promise.any(conns.map((c, i) =>
    op(c).catch(e => { console.warn('[lr-bal] ' + BAL_RPC_POOL[i] + ':', e && e.message); throw e; })
  )).catch(() => { throw new Error('All balance RPCs failed'); });
};
const POLL_RECENT = 5000, POLL_SOL = 30000, POLL_BALANCE = 30000;

/* ===================== LOCAL BURNER WALLET =====================
   Self-generated keypair, secret key stored plain in localStorage.
   Signs in-browser with tx.sign([keypair]) — instant, no popup.
   Non-custodial (key never leaves device). Hot wallet: ape-money
   only, always backable. base58 via the project's bs58 dep. */
const SK_KEY = 'lr_wallet_sk_v1';
const BACKED_KEY = 'lr_wallet_backed_v1';
function loadOrCreateKeypair() {
  try {
    const sk = localStorage.getItem(SK_KEY);
    if (sk) return Keypair.fromSecretKey(bs58.decode(sk));
  } catch (e) { console.warn('[lr-wallet] load failed, regenerating', e && e.message); }
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

/* ============================ FORMATTERS ============================ */
const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥','🦊','🐻'];
function emojiFor(sym) { sym = sym || ''; let h = 0; for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0; return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length]; }
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
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
function ageMs(iso) { return iso ? Date.now() - new Date(iso).getTime() : Infinity; }
function ageStr(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = ms/60000;
  if (m < 1) return Math.max(1, Math.round(ms/1000))+'s';
  if (m < 60) return Math.max(1, Math.round(m))+'m';
  const h = m/60; if (h < 24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}

/* ===================== VIBE CHECK — our own read =====================
   This is OUR analysis of the on-chain signals the feed exposes
   (liquidity depth, liquidity vs valuation, holder breadth + average
   position, turnover sanity, maturity, curve stage). It is deliberately
   NOT framed as safety:
     - the score is capped at RISK_CEIL — nothing ever reads "safe",
     - missing/too-thin data is treated as risk, never rewarded,
     - things we genuinely cannot see (LP lock DURATION, dev wallet plans,
       mint/freeze authority, bundled buys) are surfaced as explicit
       unknowns instead of being hidden behind a green number.
   A clean read can still rug. The honesty IS the product. */
const RISK_CEIL = 85;

function riskRead(t) {
  if (!t) return { score: 0, verdict: 'Unknown', tier: 'red', knowns: [], unknowns: [] };
  const liq = t.liquidity || 0;
  const mcap = t.mcap || 0;
  const hold = t.holders || 0;
  const vol = t.volume24h || 0;
  const ageMin = Number.isFinite(t.ageMs) ? t.ageMs / 60000 : Infinity;

  // how much can we actually see? unknown is NOT good.
  const dataPoints = (liq > 0 ? 1 : 0) + (hold > 0 ? 1 : 0) + (vol > 0 ? 1 : 0) + (mcap > 0 ? 1 : 0);
  const tooThin = dataPoints <= 1;

  let s = 0;
  // 1. liquidity depth (absolute) — harder to nuke in one sell
  s += Math.min(26, Math.log10(Math.max(liq, 1)) * 5.6);
  // 2. liquidity backing the valuation (liq/mcap) — the thin-float rug tell
  let liqRatio = null;
  if (mcap > 0 && liq > 0) {
    liqRatio = liq / mcap;
    s += liqRatio >= 0.15 ? 22 : liqRatio >= 0.08 ? 16 : liqRatio >= 0.03 ? 9 : liqRatio >= 0.01 ? 4 : 0;
  }
  // 3. holder breadth + average position (concentration proxy)
  s += Math.min(16, Math.log10(Math.max(hold, 1)) * 5.3);
  if (hold >= 50 && mcap > 0) {
    const perHolder = mcap / hold;
    s += perHolder < 500 ? 6 : perHolder < 2000 ? 3 : 0;
  }
  // 4. turnover sanity (vol/liq) — dead AND frenzied both score low
  if (liq > 0) {
    const turn = vol / liq;
    s += (turn >= 0.1 && turn <= 4) ? 12 : (turn > 4 && turn <= 12) ? 6 : turn > 0 ? 3 : 0;
  }
  // 5. maturity — surviving a bit is mildly reassuring
  s += ageMin >= 30 ? 8 : ageMin >= 10 ? 5 : ageMin >= 3 ? 2 : 0;
  // 6. curve stage (when known) — mid-curve sweet spot
  if (t.bond != null) s += (t.bond >= 20 && t.bond <= 90) ? 6 : 3;

  let score = Math.round(Math.max(3, Math.min(RISK_CEIL, s)));
  if (tooThin) score = Math.min(score, 28); // can't read it -> treat as risky

  // what the data DOES show
  const knowns = [];
  knowns.push(liq >= 30000 ? ['ok', '✓ Liquidity $' + format(liq)] : liq >= 5000 ? ['cau', 'Liquidity $' + format(liq)] : ['bad', 'Thin liq $' + format(liq || 0)]);
  knowns.push(hold >= 500 ? ['ok', '✓ ' + format(hold) + ' holders'] : hold >= 100 ? ['cau', format(hold) + ' holders'] : ['bad', (hold || 0) + ' holders']);
  if (liqRatio != null) knowns.push(liqRatio >= 0.08 ? ['ok', '✓ Liq ' + (liqRatio * 100).toFixed(0) + '% of mcap'] : ['bad', 'Liq only ' + (liqRatio * 100).toFixed(1) + '% of mcap']);

  // what NOBODY can see from this data — surfaced, not faked
  const unknowns = ['LP lock duration', 'dev wallet plans', 'mint/freeze authority', 'bundled buys'];

  let verdict, tier;
  if (tooThin) { verdict = 'Too fresh to read'; tier = 'amber'; }
  else if (score >= 68) { verdict = 'Looks okay — still risky'; tier = 'ok'; }
  else if (score >= 45) { verdict = 'Mixed signals'; tier = 'amber'; }
  else { verdict = 'High risk'; tier = 'red'; }

  return { score, verdict, tier, knowns, unknowns };
}
const riskColor = (tier) => tier === 'ok' ? 'var(--green)' : tier === 'amber' ? 'var(--amber)' : 'var(--red)';

function normalize(t) {
  const rawMint = t && t.mint;
  if (!rawMint || typeof rawMint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawMint)) return null;
  const am = ageMs(t.pairCreatedAt);
  let bond = Number(t.bondingProgress != null ? t.bondingProgress : (t.curveProgress != null ? t.curveProgress : NaN));
  bond = Number.isFinite(bond) ? Math.max(0, Math.min(100, bond)) : null;
  return {
    mint: rawMint, sym: t.sym || '???', name: t.name || t.sym || 'Unknown',
    emoji: emojiFor(t.sym || ''), icon: t.icon || null,
    price: Number(t.price || 0), change: Number(t.priceChange24h || 0),
    age: ageStr(am), ageMs: am,
    mcap: Number(t.mcap || t.fdv || 0), volume24h: Number(t.volume24h || 0),
    holders: Number(t.holders || 0), liquidity: Number(t.liquidity || 0),
    decimals: Number(t.decimals != null ? t.decimals : 6), pumpPool: t.pumpPool || 'auto',
    bond,
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

/* ================= PUMP.FUN TRADE (PumpPortal) ================= */
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

/* trade-size math — shared by one-tap and the manual sheet */
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
    return 'Just aped ' + solAmount + ' SOL into $' + token.sym + ' on wonderland//radar 🍭' + recv + '\n\nFresh launch sniped:';
  }
  const got = outAmount > 0 ? '\n-> ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Just sold ' + percentage + '% of my $' + token.sym + ' on wonderland//radar 💸' + got + '\n\nFresh launches every minute:';
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
function TokenFace(props) {
  const token = props.token;
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (url && !errored) return <img className="lr-img" src={url} alt={token.sym || ''} onError={() => setErrored(true)} />;
  return <span className="lr-emoji">{token.emoji || emojiFor(token.sym)}</span>;
}
function TokenIconSmall(props) {
  const token = props.token;
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (url && !errored) return <img className="lr-img" src={url} alt={token.sym || ''} onError={() => setErrored(true)} />;
  return <span>{token.emoji || emojiFor(token.sym)}</span>;
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
function PresetsModal(props) {
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets, onClose } = props;
  const [buyDraft, setBuyDraft] = useState(buyPresets);
  const [sellDraft, setSellDraft] = useState(sellPresets);
  const [nb, setNb] = useState(''); const [ns, setNs] = useState('');
  const addBuy = () => { const v = parseFloat(nb); if (!(v > 0) || buyDraft.includes(v)) { setNb(''); return; } setBuyDraft([...buyDraft, v].sort((a,b)=>a-b)); setNb(''); };
  const addSell = () => { const v = parseFloat(ns); if (!(v > 0) || v > 100 || sellDraft.includes(v)) { setNs(''); return; } setSellDraft([...sellDraft, v].sort((a,b)=>a-b)); setNs(''); };
  const save = () => { setBuyPresets(buyDraft.length ? buyDraft : DEFAULT_BUY_PRESETS); setSellPresets(sellDraft.length ? sellDraft : DEFAULT_SELL_PRESETS); onClose(); };
  return (
    <div className="lr-overlay center" onClick={onClose}>
      <div className="lr-sheet mini" onClick={e=>e.stopPropagation()}>
        <div className="lr-shead">
          <button className="lr-x" onClick={onClose}>×</button>
          <h3 className="lr-stitle">Quick amounts</h3>
          <div className="lr-ssub">tap to set, edit any time</div>
        </div>
        <div className="lr-sbody">
          <div className="lr-sec-lbl">Buy amounts (SOL)</div>
          <div className="lr-echips">
            {buyDraft.map(v => <span key={v} className="lr-echip">{v}<button className="x" onClick={()=>setBuyDraft(buyDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="lr-eadd"><input type="number" step="0.01" min="0" placeholder="0.5" value={nb} onChange={e=>setNb(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addBuy();}} /><button className="plus" onClick={addBuy}>+</button></span>
          </div>
          <div className="lr-sec-lbl">Sell amounts (%)</div>
          <div className="lr-echips">
            {sellDraft.map(v => <span key={v} className="lr-echip">{v}%<button className="x" onClick={()=>setSellDraft(sellDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="lr-eadd"><input type="number" step="1" min="1" max="100" placeholder="50" value={ns} onChange={e=>setNs(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addSell();}} /><button className="plus" onClick={addSell}>+</button></span>
          </div>
          <button className="lr-esave" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ WALLET DRAWER ============================ */
function WalletDrawer(props) {
  const { wallet, solBalance, solPrice, onWithdraw, onClose, busy } = props;
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
        const QR = await import('qrcode'); // requires: npm i qrcode
        if (!alive || !qrRef.current) return;
        const toCanvas = QR.toCanvas || (QR.default && QR.default.toCanvas);
        if (typeof toCanvas === 'function') {
          await toCanvas(qrRef.current, addr, { width: 160, margin: 1, color: { dark: '#0B0A1A', light: '#ffffff' } });
        }
      } catch (e) { /* qrcode not installed — address + copy still works */ }
    })();
    return () => { alive = false; };
  }, [tab, addr]);

  const copy = () => { try { navigator.clipboard.writeText(addr); setCopied(true); setTimeout(()=>setCopied(false), 1500); } catch (e) {} };
  const maxOut = Math.max(0, sol - 0.001);

  return (
    <div className="lr-overlay" onClick={onClose}>
      <div className="lr-sheet" onClick={e=>e.stopPropagation()}>
        <div className="lr-shead">
          <button className="lr-x" onClick={onClose}>×</button>
          <h3 className="lr-stitle"><span className="lr-wdot" />Your wallet</h3>
          <div className="lr-ssub">lives on this device · signs instantly · your keys</div>
        </div>
        <div className="lr-sbody">
          <div className="lr-balcard">
            <div className="lr-ballbl">Ready to ape</div>
            <div className="lr-balval">{formatSol(sol)} <span className="u">SOL</span></div>
            <div className="lr-balusd">{solPrice > 0 ? '≈ $' + format(sol * solPrice) : ' '}</div>
          </div>

          <div className="lr-wgrid">
            <button className={'lr-wact' + (tab==='deposit'?' primary':'')} onClick={()=>setTab('deposit')}>↓ Deposit</button>
            <button className={'lr-wact' + (tab==='withdraw'?' primary':'')} onClick={()=>setTab('withdraw')}>↑ Withdraw</button>
          </div>

          {tab === 'deposit' && (
            <div className="lr-block">
              <div className="lr-block-l">Send SOL to this address</div>
              <div className="lr-qr"><canvas ref={qrRef} width="160" height="160" /></div>
              <div className="lr-addr"><div className="lr-addr-v">{addr}</div><button className="lr-copy" onClick={copy}>{copied?'COPIED':'COPY'}</button></div>
            </div>
          )}

          {tab === 'withdraw' && (
            <div className="lr-block">
              <div className="lr-block-l">Send SOL out</div>
              <input className="lr-input" placeholder="Destination address" value={dest} onChange={e=>setDest(e.target.value.trim())} />
              <input className="lr-input" type="number" step="0.001" placeholder={'Amount (max ' + formatSol(maxOut) + ')'} value={amt} onChange={e=>setAmt(e.target.value)} />
              <button className="lr-go" disabled={busy || !dest || !(Number(amt) > 0) || Number(amt) > maxOut} onClick={()=>onWithdraw(dest, Number(amt))}>
                {busy ? 'Sending…' : 'Withdraw ' + (Number(amt) > 0 ? Number(amt) + ' SOL' : '')}
              </button>
            </div>
          )}

          <div className="lr-block">
            <div className="lr-block-l">Back up your wallet {wallet.backedUp ? '✓' : ''}</div>
            {!revealed ? (
              <button className="lr-go" style={{background:'var(--surf2)',color:'var(--gold)'}} onClick={()=>{ setRevealed(true); wallet.markBackedUp(); }}>Show secret key</button>
            ) : (
              <>
                <div className="lr-secret">{wallet.exportSecret()}</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button className="lr-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>{ try{navigator.clipboard.writeText(wallet.exportSecret());}catch(e){} }}>COPY KEY</button>
                  <button className="lr-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>setRevealed(false)}>HIDE</button>
                </div>
              </>
            )}
            <div className="lr-ssub" style={{marginTop:8}}>Save this somewhere safe. Anyone with it controls this wallet. Import into Phantom ("Import private key") to recover.</div>
          </div>

          <div className="lr-warn">🔥 <b>Hot burner.</b> Keep only ape-money here. The key is stored on this device — clear your browser and it's gone unless you backed it up.</div>
          <div style={{textAlign:'center'}}><span className="lr-nc">● Non-custodial · your keys</span></div>
        </div>
      </div>
    </div>
  );
}

/* ============================ MANUAL TRADE SHEET ============================ */
function TradeSheet(props) {
  const { token, initialMode, onClose, onConfirm, buyPresets, sellPresets, solBalance, tokenBalance, solPrice } = props;
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

  return (
    <div className="lr-overlay" onClick={onClose}>
      <div className="lr-sheet" onClick={e=>e.stopPropagation()}>
        <div className="lr-dhead">
          <button className="lr-x" onClick={onClose}>×</button>
          <div className="lr-dav"><TokenFace token={token} /></div>
          <div>
            <div className="lr-dsym">${token.sym}</div>
            <div className="lr-dsub">{formatPrice(token.price)}{Number.isFinite(token.change)&&token.change!==0 ? <> · <span style={{color:token.change<0?'var(--red)':'var(--green)'}}>{formatPct(token.change)}</span></> : null}</div>
          </div>
        </div>

        <div className={'lr-tcard ' + (read.tier==='ok'?'':read.tier)}>
          <div className="lr-tcnum" style={{color:riskColor(read.tier)}}>{read.score}<span style={{fontSize:14,color:'var(--ink3)'}}>/{RISK_CEIL}</span></div>
          <div><div className="lr-tcv">{read.verdict}</div><div className="lr-tcs">Vibe check · our read of the on-chain signals — not a safety guarantee</div></div>
        </div>
        <div className="lr-checks">{read.knowns.map((c,i)=><span key={i} className={'lr-chk '+c[0]}>{c[1]}</span>)}</div>
        <div className="lr-dyor">⚠ Can't be checked: {read.unknowns.join(' · ')}. Even a clean read can rug — only ape what you can lose.</div>

        <div className={'lr-modetabs' + (isBuy?'':' sell')}>
          <div className="lr-mind" />
          <button className={'lr-mtab'+(isBuy?' active':'')} onClick={()=>setMode('buy')}>🍭 BUY</button>
          <button className={'lr-mtab'+(!isBuy?' active':'')} onClick={()=>setMode('sell')}>💸 SELL</button>
        </div>

        <div className="lr-row">
          <div className="lr-rowtop">
            <span className="lr-rlabel">{isBuy?'You pay':'You sell'}</span>
            <span className="lr-rbal">
              {isBuy ? <>Wallet: <b>{formatSol((solBalance&&solBalance.uiAmount)||0)} SOL</b></> : <>You own: <b>{formatTokens(ownedUi)} ${token.sym}</b></>}
              {isBuy && availSol > 0 ? <button className="lr-max" onClick={()=>setAmount(String(Math.floor(availSol*10000)/10000))}>MAX</button> : null}
            </span>
          </div>
          <div className="lr-rmid">
            <div className="lr-chip">{isBuy ? <><span className="lr-chiplogo">◎</span><span>SOL</span></> : <><span className="lr-chiplogo"><TokenIconSmall token={token} /></span><span>{token.sym}</span></>}</div>
            <input className="lr-amt" type="text" inputMode="decimal" placeholder={isBuy?'0.00':'0'} value={amount}
              onChange={e=>{ const val=e.target.value.replace(/[^\d.]/g,''); if(val.split('.').length>2)return; if(!isBuy&&Number(val)>100){setAmount('100');return;} setAmount(val); }} />
          </div>
        </div>

        <div className="lr-presets">
          {presets.map(pv => <button key={pv} className={'lr-pchip'+(Number(amount)===pv?' active':'')} onClick={()=>setAmount(String(pv))}>{isBuy?(pv+' SOL'):(pv+'%')}</button>)}
        </div>

        {swapParams && Number(amount) > 0 && (
          <div className="lr-details">
            <div className="lr-drow"><span>Route</span><span className="lr-dval">pump.fun bonding curve</span></div>
            {isBuy ? <>
              <div className="lr-drow"><span>Platform fee (3%)</span><span className="lr-dval">{formatSol(Number(swapParams.feeLamports)/1e9)} SOL</span></div>
              <div className="lr-drow"><span>Wallet pays</span><span className="lr-dval">{formatSol(Number(swapParams.totalLamports)/1e9)} SOL</span></div>
              <div className="lr-drow"><span>You get (est.)</span><span className="lr-dval good">{est&&est.tokens>0?'≈ '+formatTokens(est.tokens)+' '+token.sym:'—'}</span></div>
            </> : <>
              <div className="lr-drow"><span>Selling</span><span className="lr-dval">{formatTokens(swapParams.tradeTokensUi)} {token.sym} ({Math.min(100,Number(amount)).toFixed(0)}%)</span></div>
              <div className="lr-drow"><span>Platform fee (3%)</span><span className="lr-dval">≈ {Number(swapParams.feeLamports)/1e9>0?formatSol(Number(swapParams.feeLamports)/1e9):'—'} SOL</span></div>
              <div className="lr-drow"><span>You get (est.)</span><span className="lr-dval good">{est&&est.sol>0?'≈ '+formatSol(est.sol)+' SOL':'—'}</span></div>
            </>}
          </div>
        )}

        {error && <div className="lr-banner">{error}</div>}

        <button className={'lr-confirm'+(isBuy?'':' sell')} disabled={disabled} onClick={go}>
          {confirming ? (isBuy?'Buying…':'Selling…')
            : !amount||Number(amount)<=0 ? (isBuy?'Enter SOL amount':'Enter percentage')
            : !hasFunds ? (isBuy?'Not enough SOL':(ownedUi<=0?('No '+token.sym+' to sell'):'Need ~0.003 SOL for fees'))
            : (isBuy?('🍭 Buy '+amount+' SOL of $'+token.sym):('💸 Sell '+Math.min(100,Number(amount))+'% of $'+token.sym))}
        </button>
        <p className="lr-tfoot">pump.fun · 3% fee · trading wallet · instant, no pop-up</p>
      </div>
    </div>
  );
}

/* ============================ TOKEN TILE ============================ */
function TokenTile(props) {
  const { token, owned, quickAmount, sellPresets, onApe, onSell, onOpen, busy, isFresh, idx } = props;
  const read = riskRead(token);
  const sc = read.score;
  const col = riskColor(read.tier);
  const C = 39.6, off = C - (sc / 100) * C;
  const ownedUi = (owned && owned.uiAmount) || 0;
  const [coins, setCoins] = useState(0);

  const ape = (e) => {
    e.stopPropagation();
    if (busy) return;
    for (let k = 0; k < 5; k++) setTimeout(()=>setCoins(c=>c+1), k*40);
    setTimeout(()=>setCoins(0), 800);
    onApe(token);
  };

  return (
    <div className={'lr-tile' + (isFresh?' new':'')} style={{ animationDelay: (idx*0.04)+'s' }} onClick={()=>onOpen(token)}>
      <div className="lr-face">
        <TokenFace token={token} />
        <span className="lr-agep">{token.age || 'new'}</span>
        <div className="lr-trust">
          <svg width="40" height="40"><circle cx="20" cy="20" r="15.7" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="3.4" />
            <circle cx="20" cy="20" r="15.7" fill="none" stroke={col} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={C+' '+C} strokeDashoffset={off} /></svg>
          <span className="tnum" style={{color:col}}>{sc}</span><span className="tlbl" style={{color:col}}>Vibe</span>
        </div>
        {token.bond != null ? <div className="lr-curve"><i style={{width:token.bond+'%'}} /></div> : null}
      </div>
      <div className="lr-body">
        <div className="lr-symrow"><span className="lr-sym">${token.sym}</span>{Number.isFinite(token.change)&&token.change!==0 ? <span className={'lr-chg'+(token.change<0?' down':'')}>{formatPct(token.change)}</span> : null}</div>
        <div className="lr-name">{token.name}</div>
        <div className="lr-statline"><span className="price">{formatPrice(token.price)}</span>·<span>Liq <b>{token.liquidity>0?'$'+format(token.liquidity):'—'}</b></span></div>
        <button className={'lr-ape'+(busy?' filled':'')} disabled={busy} onClick={ape}>
          {busy ? <><span className="lr-spinner" /> Aping…</> : <><span className="b">⚡</span> Ape {quickAmount} ◎</>}
          {Array.from({length:coins}).map((_,i)=><span key={i} className="lr-coinfx" style={{'--cx':((Math.random()-.5)*70)+'px',animationDelay:(i*.05)+'s'}}>🪙</span>)}
        </button>
        {ownedUi > 0 ? (
          <>
            <div className="lr-owned"><span>You own</span><b>{formatTokens(ownedUi)}</b></div>
            <div className="lr-sells">{sellPresets.map(p => <button key={p} className="lr-sellbtn" disabled={busy} onClick={e=>{e.stopPropagation(); onSell(token, p);}}>{p===100?'All':p+'%'}</button>)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ============================ MAIN ============================ */
export default function Ape() {
  useLrCSS();
  const wallet = useLocalWallet();
  const connection = useMemo(() => getConn('confirmed'), []);

  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();
  const [quickAmount, setQuickAmount] = useState(() => buyPresets[Math.min(2, buyPresets.length-1)] || 0.5);
  useEffect(() => { if (!buyPresets.includes(quickAmount)) setQuickAmount(buyPresets[Math.min(2, buyPresets.length-1)] || buyPresets[0]); }, [buyPresets]); // eslint-disable-line

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(null);
  const [lane, setLane] = useState('fresh');
  const [sortBy, setSortBy] = useState('newest');
  const [busyMint, setBusyMint] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const freshThresholdMs = 30 * 60000;

  const [recentTokens, setRecentTokens] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) { if (!cancelled) { setRecentError('Feed unreachable (HTTP '+r.status+')'); setRecentLoading(false); } return; }
        const d = await r.json();
        const list = Array.isArray(d && d.tokens) ? d.tokens : [];
        if (!cancelled) { setRecentTokens(list.map(normalize).filter(Boolean)); setRecentLoading(false); setRecentError(null); }
      } catch (e) { if (!cancelled) { setRecentError(String((e && e.message)||'Feed unreachable').slice(0,120)); setRecentLoading(false); } }
    }
    load(); const id = setInterval(load, POLL_RECENT); return () => { cancelled = true; clearInterval(id); };
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
    const solP = balRpcRace(c => c.getBalance(owner, BAL_COMMITMENT)).then(l => setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(l), decimals: 9, uiAmount: l/1e9 } }))).catch(e=>console.warn('[lr] SOL',e&&e.message));
    const tokP = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT)).then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; })).catch(e=>console.warn('[lr] SPL',e&&e.message));
    const t22P = balRpcRace(c => c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT)).then(a => setBalances(prev => { const n={...prev}; mergeAccs(n,a); return n; })).catch(e=>console.warn('[lr] T22',e&&e.message));
    await Promise.allSettled([solP, tokP, t22P]);
  }, [wallet.publicKey]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);
  useEffect(() => { const id = setInterval(refreshBalances, POLL_BALANCE); return () => clearInterval(id); }, [refreshBalances]);

  const refreshSol = useCallback(async () => {
    try { const l = await balRpcRace(c => c.getBalance(wallet.publicKey, BAL_COMMITMENT)); setBalances(prev => ({ ...prev, [SOL_MINT]: { amount: String(l), decimals: 9, uiAmount: l/1e9 } })); } catch (e) { console.warn('[lr] SOL', e&&e.message); }
  }, [wallet.publicKey]);
  const refreshOneToken = useCallback(async (mintStr) => {
    if (!mintStr || mintStr === SOL_MINT) return;
    let mintPk; try { mintPk = new PublicKey(mintStr); } catch (e) { return; }
    try {
      const accs = await balRpcRace(c => c.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: mintPk }, BAL_COMMITMENT));
      let best = null;
      for (const acc of ((accs && accs.value) || [])) { const info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info; const amt = info && info.tokenAmount && info.tokenAmount.amount; if (amt == null) continue; const ui = Number((info.tokenAmount && info.tokenAmount.uiAmount)||0); if (!best || ui > best.uiAmount) best = { amount: String(amt), decimals: Number((info.tokenAmount && info.tokenAmount.decimals)!=null?info.tokenAmount.decimals:6), uiAmount: ui }; }
      setBalances(prev => ({ ...prev, [mintStr]: best || { amount:'0', decimals:6, uiAmount:0 } }));
    } catch (e) { console.warn('[lr] one-token', e&&e.message); }
  }, [wallet.publicKey]);

  const solBalance = balances[SOL_MINT];

  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((t) => { const id = Math.random().toString(36).slice(2); setToasts(p => [...p, { ...t, id }]); setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), t.duration || 8000); }, []);

  const [confettiKey, setConfettiKey] = useState(0);
  const confettiPieces = useMemo(() => {
    if (!confettiKey) return [];
    const colors = ['#FF7BC8','#2BE08A','#9B7BFF','#FFB52E','#FFD46B','#56C8FF'];
    return Array.from({ length: 56 }, (_, i) => { const angle=(Math.random()-.5)*Math.PI; const dist=220+Math.random()*200; return { i, dx: Math.sin(angle)*dist, dy: -Math.abs(Math.cos(angle)*dist)+420*Math.random(), dr:(Math.random()-.5)*1440, color: colors[i%colors.length], delay: Math.random()*0.15 }; });
  }, [confettiKey]);
  useEffect(() => { if (!confettiKey) return; const id = setTimeout(() => setConfettiKey(0), 1800); return () => clearTimeout(id); }, [confettiKey]);
  const fireConfetti = useCallback(() => setConfettiKey(k => k + 1), []);

  /* ====== executeSwap — local keypair signs instantly ====== */
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
      if (sim && sim.value && sim.value.err) { console.error('[lr-sim]', JSON.stringify(sim.value.err)); throw new Error(describeSimLogs(simLogs, JSON.stringify(sim.value.err))); }
    } catch (simErr) { if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr; console.warn('[lr-sim] skip', simErr && simErr.message); }

    // sign locally — INSTANT, no popup
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
    refreshSol(); [1200, 3000, 6000].forEach(ms => setTimeout(() => { refreshSol(); refreshOneToken(token.mint); }, ms));
    return { confirmed };
  }, [executeSwap, fireConfetti, pushToast, refreshSol, refreshOneToken, solPrice]);

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

  const onSell = useCallback(async (token, pct) => {
    if (busyMint) return;
    const tb = balances[token.mint];
    const params = buildSellParams(token, pct, tb, solPrice);
    if (!params) { pushToast({ kind: 'error', emoji: '⚠️', body: 'Nothing to sell.' }); return; }
    if (((solBalance && solBalance.uiAmount) || 0) < 0.003) { pushToast({ kind: 'error', emoji: '⛽', body: 'Need ~0.003 SOL for fees.' }); return; }
    setBusyMint(token.mint);
    try { await runTrade({ mode: 'sell', swapParams: params, token }); }
    catch (e) { pushToast({ kind: 'error', emoji: '😵', body: friendlyError(e) }); }
    finally { setBusyMint(null); }
  }, [busyMint, balances, solPrice, solBalance, runTrade, pushToast]);

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
      [1500, 4000].forEach(ms => setTimeout(refreshSol, ms));
    } catch (e) { pushToast({ kind: 'error', emoji: '😵', body: friendlyError(e) }); }
    finally { setWithdrawing(false); }
  }, [connection, wallet.keypair, wallet.publicKey, pushToast, refreshSol]);

  const freshTokens = useMemo(() => recentTokens.filter(t => Number.isFinite(t.ageMs) && t.ageMs < freshThresholdMs), [recentTokens, freshThresholdMs]);
  const activeList = lane === 'fresh' ? freshTokens : recentTokens;
  const filtered = useMemo(() => {
    let l = activeList.slice();
    const seen = new Set(); l = l.filter(t => { if (!t || !t.mint || seen.has(t.mint)) return false; seen.add(t.mint); return true; });
    if (sortBy === 'newest') l = l.sort((a,b)=>(a.ageMs||0)-(b.ageMs||0));
    else if (sortBy === 'volume') l = l.sort((a,b)=>(b.volume24h||0)-(a.volume24h||0));
    else if (sortBy === 'trust') l = l.sort((a,b)=>riskRead(b).score-riskRead(a).score);
    return l.slice(0, 40);
  }, [activeList, sortBy]);

  const moon = useMemo(() => recentTokens.filter(t => Number.isFinite(t.change) && t.change > 0).sort((a,b)=>b.change-a.change).slice(0,5), [recentTokens]);

  const [bubble, setBubble] = useState('Fresh launches landing all day 👀');
  const [bubbleShown, setBubbleShown] = useState(true);
  const mascotLines = useMemo(() => {
    const lines = ['Set your ape amount up top ⚡','Trust score on every tile — green is cleaner 🟢','Tap a coin for the full breakdown 👀','Keep only ape-money in your burner 🔥'];
    if (moon[0]) lines.unshift('$' + moon[0].sym + ' is mooning ' + formatPct(moon[0].change) + ' 🚀');
    return lines;
  }, [moon]);
  useEffect(() => { const id = setTimeout(() => setBubbleShown(false), 4500); return () => clearTimeout(id); }, []);
  const pokeMascot = () => { setBubble(mascotLines[Math.floor(Math.random()*mascotLines.length)]); setBubbleShown(true); setTimeout(()=>setBubbleShown(false), 3500); };

  return (
    <div className="lr-root">
      <div className="lr-app">
        <div className="lr-top">
          <div className="lr-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="lr-radar" />
            <span className="lr-bname">wonderland<span className="sl">//</span><span className="ra">radar</span></span>
          </div>
          <div className="lr-wbtn" onClick={() => setWalletOpen(true)}>
            <span className="lr-wdot" /><span className="lr-sol">◎</span> <b>{formatSol((solBalance && solBalance.uiAmount) || 0)}</b>
            {!wallet.backedUp ? <span className="lr-nudge" title="Back up your wallet" /> : null}
          </div>
        </div>

        <div className="lr-qbar">
          <span className="lr-qlabel"><span className="b">⚡</span>Quick buy</span>
          {buyPresets.map(v => <button key={v} className={'lr-qamt'+(v===quickAmount?' active':'')} onClick={()=>setQuickAmount(v)}><span>{v}</span><span className="lr-sol">◎</span></button>)}
          <button className="lr-qedit" onClick={()=>setPresetsOpen(true)}>✎</button>
          <span className="lr-qinstant"><span className="d" />INSTANT</span>
        </div>

        {moon.length > 0 && (
          <div className="lr-ribbon">
            <span className="lr-rlbl">🚀 Mooning</span>
            {moon.map(t => <span key={t.mint} className="lr-rchip" onClick={()=>setTradeOpen({ token: t, mode: 'buy' })}>{t.emoji} ${t.sym} <span className="up">{formatPct(t.change)}</span></span>)}
          </div>
        )}

        <div className="lr-hero">
          <h1>just <span className="g">hatched</span> 🥚</h1>
          <div className="lr-meta"><span className={'live'+(recentError?' warn':'')} />{recentLoading?'syncing…':recentError?'feed down':<>{freshTokens.length} fresh · tap to ape</>}</div>
        </div>

        <div className="lr-controls">
          <button className={'lr-seg'+(lane==='fresh'?' active':'')} onClick={()=>setLane('fresh')}>🐣 Just hatched</button>
          <button className={'lr-seg'+(lane==='recent'?' active':'')} onClick={()=>setLane('recent')}>🌈 On radar</button>
          <span className="lr-seg-div" />
          <button className={'lr-seg'+(sortBy==='newest'?' active':'')} onClick={()=>setSortBy('newest')}>🆕 Freshest</button>
          <button className={'lr-seg'+(sortBy==='trust'?' active':'')} onClick={()=>setSortBy('trust')}>🛡️ Safest</button>
          <button className={'lr-seg'+(sortBy==='volume'?' active':'')} onClick={()=>setSortBy('volume')}>🔥 Loudest</button>
        </div>

        <div className="lr-grid">
          {filtered.length === 0 ? (
            <div className="lr-empty">
              <span className="e">{lane==='fresh'?'🥚':'🍿'}</span>
              {recentLoading ? <><b>Warming up the radar…</b><div className="sub">Pulling fresh pump.fun launches.</div></>
                : recentError ? <><b>Feed offline</b><div className="sub">Retrying automatically.</div><div className="err">{recentError}</div></>
                : <><b>Nothing here yet</b><div className="sub">Switch lanes — drops land all day.</div></>}
            </div>
          ) : filtered.map((t, i) => (
            <TokenTile key={t.mint} token={t} owned={balances[t.mint]} quickAmount={quickAmount} sellPresets={sellPresets}
              onApe={onApe} onSell={onSell} onOpen={(tok)=>setTradeOpen({ token: tok, mode: 'buy' })}
              busy={busyMint === t.mint} isFresh={Number.isFinite(t.ageMs) && t.ageMs < freshThresholdMs} idx={i} />
          ))}
        </div>
      </div>

      {bubbleShown ? <div className="lr-mbubble">{bubble}</div> : null}
      <div className="lr-mascot" onClick={pokeMascot}><span className="e">🐰</span></div>

      {presetsOpen ? <PresetsModal buyPresets={buyPresets} setBuyPresets={setBuyPresets} sellPresets={sellPresets} setSellPresets={setSellPresets} onClose={()=>setPresetsOpen(false)} /> : null}
      {walletOpen ? <WalletDrawer wallet={wallet} solBalance={solBalance} solPrice={solPrice} onWithdraw={onWithdraw} busy={withdrawing} onClose={()=>setWalletOpen(false)} /> : null}
      {tradeOpen ? <TradeSheet token={tradeOpen.token} initialMode={tradeOpen.mode} onClose={()=>setTradeOpen(null)} onConfirm={onSheetConfirm}
        buyPresets={buyPresets} sellPresets={sellPresets} solBalance={solBalance} tokenBalance={balances[tradeOpen.token.mint]} solPrice={solPrice} /> : null}

      <div className="lr-toasts">
        {toasts.map(t => (
          <div key={t.id} className={'lr-toast '+t.kind}>
            <span className="em">{t.emoji}</span>
            <div className="tb">{t.body}</div>
            <div className="ta">
              {t.solscan ? <a className="lr-taction" href={t.solscan} target="_blank" rel="noreferrer">VIEW</a> : null}
              {t.tweetText ? <button className="lr-taction tw" onClick={()=>openTwitterShare(t.tweetText, t.shareUrl)}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>SHARE</button> : null}
            </div>
          </div>
        ))}
      </div>

      {confettiKey > 0 && (
        <div className="lr-confetti" key={confettiKey}>
          {confettiPieces.map(p => <div key={p.i} className="lr-cpiece" style={{ background: p.color, animationDelay: p.delay+'s', '--dx': p.dx+'px', '--dy': p.dy+'px', '--dr': p.dr+'deg' }} />)}
        </div>
      )}
    </div>
  );
}
 