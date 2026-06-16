import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
} from '@solana/web3.js';

// Admin wallets — defined locally so this file doesn't depend on App.jsx's
// export. Must stay in sync with the ADMIN_WALLETS set in App.jsx.
const ADMIN_WALLETS = new Set([
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

// =====================================================================
// INLINE CSS — Wonderland palette · Instrument Serif + Space Grotesk
// =====================================================================
const STOCKS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

.st-page,.st-region-block,.st-sheet,.st-modal-backdrop{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --pink:#FF8FBE; --mint:#7FFFD4; --lav:#B794F6; --peach:#FFB088;
  --sky:#A0E7FF; --gold:#FFD46B; --green:#1B7A4F; --red:#D14B6A;
  --glass:rgba(255,255,255,0.6); --glass-strong:rgba(255,255,255,0.78);
  --border:rgba(183,148,246,0.22);
  font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;
  color:var(--ink);
}
.st-page,.st-page *,.st-sheet,.st-sheet *,.st-region-block,.st-region-block *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}

@keyframes st-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes st-pulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes st-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes st-spin{to{transform:rotate(360deg)}}
@keyframes st-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes st-slide-up{from{transform:translate(-50%,100%)}to{transform:translate(-50%,0)}}

/* ROOT PAGE */
.st-page{
  position:relative;min-height:100vh;min-height:100dvh;
  max-width:520px;margin:0 auto;width:100%;
  padding:0 0 calc(env(safe-area-inset-bottom) + 90px);
  border-radius:24px;overflow-x:hidden;
  background:
    radial-gradient(ellipse at 20% 5%,#FFE8F4 0%,transparent 45%),
    radial-gradient(ellipse at 85% 15%,#E4F2FF 0%,transparent 45%),
    radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),
    radial-gradient(ellipse at 15% 95%,#FFF3E4 0%,transparent 45%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  background-attachment:fixed;
}
.st-blob{
  position:absolute;border-radius:50%;filter:blur(70px);opacity:0.45;
  animation:st-drift 14s ease-in-out infinite;pointer-events:none;z-index:0;
}
.st-inner{position:relative;z-index:5}

/* HEADER */
.st-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px 4px;
}
.st-brand{display:flex;align-items:center;gap:10px}
.st-brand-dot{
  width:28px;height:28px;border-radius:50%;
  background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);
  box-shadow:0 0 14px rgba(183,148,246,0.5);
}
.st-wordmark{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.st-wordmark .slash{opacity:0.4;margin:0 3px;font-style:normal}
.st-wordmark .grad{
  background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}

/* HERO */
.st-hero{padding:28px 22px 8px;text-align:center;position:relative;z-index:2}
.st-eyebrow{
  display:inline-flex;align-items:center;gap:7px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);border-radius:999px;
  padding:6px 14px;margin-bottom:18px;
  font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.5px;
}
.st-eyebrow .dot{
  width:6px;height:6px;border-radius:50%;
  background:var(--green);box-shadow:0 0 8px var(--green);
  animation:st-pulse 1.6s ease-in-out infinite;
}
.st-eyebrow b{color:var(--ink);font-weight:700;letter-spacing:1.5px}
.st-hero h1{
  font-family:"Instrument Serif",serif;font-weight:400;
  font-size:54px;line-height:0.95;letter-spacing:-0.015em;
  margin:0 0 14px;color:var(--ink);
}
.st-hero h1 .shim{
  font-style:italic;
  background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE);
  background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  animation:st-shimmer 6s linear infinite;
}
.st-hero p{
  color:var(--ink-2);font-size:14px;font-weight:500;
  margin:0 auto;max-width:340px;line-height:1.5;
}

/* TRUST PILL */
.st-trust{
  margin:18px 22px 0;
  display:flex;align-items:center;justify-content:center;gap:10px;
  padding:10px 14px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
}
.st-trust span{font-size:10px;font-weight:700;color:var(--ink);letter-spacing:1.4px}
.st-trust .sep{color:var(--ink-3);opacity:0.6}

/* SECTION HEAD */
.st-section{
  display:flex;justify-content:space-between;align-items:center;
  padding:26px 26px 12px;position:relative;z-index:2;
}
.st-section-title{
  font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;
  background:linear-gradient(90deg,#FF8FBE,#B794F6);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.st-section-meta{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.8px}

/* FILTERS */
.st-filters{
  display:flex;gap:8px;padding:0 22px;overflow-x:auto;
  scrollbar-width:none;-webkit-overflow-scrolling:touch;
}
.st-filters::-webkit-scrollbar{display:none}
.st-filter{
  flex-shrink:0;padding:9px 16px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);color:var(--ink-2);
  font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.4px;
  cursor:pointer;transition:all .15s;white-space:nowrap;
}
.st-filter:hover{border-color:var(--lav);color:var(--ink)}
.st-filter.st-active{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  color:var(--ink);border-color:#7FFFD4;
  box-shadow:0 4px 14px rgba(127,255,212,.35);
}

/* LIST */
.st-list{
  margin:14px 22px 0;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);border-radius:24px;overflow:hidden;
}
.st-empty{padding:30px 16px;text-align:center;color:var(--ink-2);font-size:12px}
.st-tile{
  padding:14px 16px;display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;
  border-bottom:1px solid var(--border);
  background:transparent;border-left:none;border-right:none;border-top:none;width:100%;text-align:left;
  font-family:inherit;color:inherit;cursor:pointer;
  -webkit-tap-highlight-color:rgba(127,255,212,.12);
  transition:background .15s;
  animation:st-rise .35s cubic-bezier(.2,.8,.2,1) backwards;
}
.st-tile:last-child{border-bottom:none}
.st-tile:hover{background:rgba(255,255,255,.35)}
.st-tile-mid{min-width:0}
.st-tile-row{display:flex;align-items:center;gap:8px}
.st-tile-sym{font-family:"Instrument Serif",serif;font-size:18px;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.st-tile-ticker{
  font-size:9px;font-weight:700;color:var(--ink-2);letter-spacing:1.2px;
  background:rgba(183,148,246,.12);padding:3px 7px;border-radius:5px;
  font-family:"Space Grotesk",sans-serif;
}
.st-tile-name{font-size:11px;color:var(--ink-2);margin-top:3px;font-weight:500}
.st-tile-right{text-align:right}
.st-tile-price{
  font-family:"Instrument Serif",serif;font-size:20px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.st-tile-price.st-muted{color:var(--ink-3);font-size:14px;font-family:"Space Grotesk",sans-serif;font-weight:500}
.st-tile-cta{
  font-size:9px;font-weight:700;color:var(--lav);letter-spacing:1.2px;
  margin-top:4px;
}

/* BADGE — sector-based pastel gradient with Instrument Serif italic letter */
.st-badge{
  border-radius:13px;flex-shrink:0;
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;line-height:1;color:#fff;
  box-shadow:0 4px 12px rgba(26,27,78,.10);
}
.st-badge.st-sec-tech{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink)}
.st-badge.st-sec-crypto{background:linear-gradient(135deg,#FF8FBE,#B794F6)}
.st-badge.st-sec-index{background:linear-gradient(135deg,#FFD46B,#FFB088);color:var(--ink)}

/* Real Jupiter token icon — drop-in replacement for .st-badge */
.st-badge-img{
  flex-shrink:0;object-fit:cover;
  background:#fff;
  box-shadow:0 4px 12px rgba(26,27,78,.10);
}

/* FOOTER */
.st-foot{
  display:flex;align-items:center;justify-content:center;gap:9px;
  margin:24px 22px 0;padding:14px 16px;border-radius:16px;
  background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);
}
.st-foot-label{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.6px}
.st-foot-name{
  font-family:"Instrument Serif",serif;font-style:italic;font-size:14px;
  background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.st-foot-sep{color:var(--ink-3);font-size:10px}

/* MODAL / SHEET — LIGHT GLASS */
.st-modal-backdrop{
  position:fixed;inset:0;z-index:400;
  background:rgba(26,27,78,0.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  cursor:pointer;animation:st-rise .2s;
}
.st-modal-backdrop.st-busy{cursor:wait}
.st-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:401;max-height:92dvh;
  display:flex;flex-direction:column;overflow:hidden;
  background:
    radial-gradient(ellipse at 20% 0%,#FFE8F4 0%,transparent 50%),
    radial-gradient(ellipse at 80% 0%,#E4F2FF 0%,transparent 50%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  border-top:1px solid rgba(255,255,255,.8);
  border-radius:28px 28px 0 0;
  box-shadow:0 -24px 80px rgba(26,27,78,.18);
  animation:st-slide-up .4s cubic-bezier(0.2,1.2,0.4,1);
}
.st-grabber{width:40px;height:4px;background:rgba(26,27,78,.18);border-radius:99px;margin:10px auto 14px}
.st-sheet-head{flex-shrink:0;padding:0 22px 12px}
.st-sheet-head-row{display:flex;align-items:center;gap:12px}
.st-sheet-title-wrap{flex:1;min-width:0}
.st-sheet-title-row{display:flex;align-items:center;gap:8px}
.st-sheet-title{
  font-family:"Instrument Serif",serif;font-size:24px;letter-spacing:-.015em;
  color:var(--ink);line-height:1;
}
.st-sheet-subtitle{font-size:12px;color:var(--ink-2);margin-top:4px;font-weight:500}
.st-close-btn{
  width:36px;height:36px;border-radius:50%;flex-shrink:0;
  background:var(--glass-strong);border:1px solid var(--border);
  color:var(--ink);font-size:20px;cursor:pointer;font-family:inherit;
  display:grid;place-items:center;transition:all .15s;
}
.st-close-btn:hover{background:#fff;border-color:var(--lav)}
.st-close-btn:disabled{cursor:not-allowed;opacity:.5}

.st-live-price{
  margin-top:14px;padding:12px 16px;border-radius:14px;
  background:var(--glass-strong);border:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;
}
.st-live-price-label{font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.4px}
.st-live-price-val{
  font-family:"Instrument Serif",serif;font-size:22px;color:var(--ink);
  font-variant-numeric:tabular-nums;line-height:1;
}

.st-you-own{
  margin-top:10px;padding:10px 14px;border-radius:14px;
  background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));
  border:1px solid rgba(127,255,212,.40);
  display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;
}
.st-you-own-label{color:var(--green);font-weight:700;letter-spacing:1.2px;font-size:10px}
.st-you-own-val{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.st-muted-soft{color:var(--ink-2);font-weight:500}
.st-muted-deep{color:var(--ink-3);font-weight:500}
.st-muted{color:var(--ink-3)}

.st-sheet-body{flex:1;overflow-y:auto;padding:4px 22px 12px;min-height:0}

.st-side-switch{
  display:flex;padding:4px;margin:14px 0;gap:4px;width:100%;
  background:var(--glass-strong);border:1px solid var(--border);border-radius:999px;
}
.st-side-btn{
  flex:1;padding:11px 16px;border-radius:999px;border:none;background:transparent;
  color:var(--ink-2);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
  letter-spacing:0.2px;transition:all .2s;
}
.st-side-btn:disabled{cursor:not-allowed;opacity:0.5}
.st-side-btn.st-active.st-buy{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  box-shadow:0 4px 14px rgba(127,255,212,.35);
}
.st-side-btn.st-active.st-sell{
  background:linear-gradient(135deg,#FF8FBE,#FFB088);color:#fff;
  box-shadow:0 4px 14px rgba(255,143,190,.35);
}

.st-amount-wrap{margin-bottom:10px}
.st-amount-label{
  display:flex;justify-content:space-between;
  font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.4px;
  margin-bottom:8px;
}
.st-amount-input-wrap{
  background:var(--glass-strong);border:1.5px solid var(--border);
  border-radius:16px;padding:14px 16px;margin-bottom:10px;
  display:flex;align-items:center;gap:10px;transition:all .2s;
}
.st-amount-input-wrap:focus-within{border-color:var(--lav);box-shadow:0 0 0 4px rgba(183,148,246,.12)}
.st-amount-input-wrap.st-busy{opacity:.6}
.st-amount-dollar{font-family:"Instrument Serif",serif;font-size:28px;color:var(--ink-2);line-height:1}
.st-amount-input{
  flex:1;background:transparent;border:none;outline:none;
  font-family:"Instrument Serif",serif;font-size:36px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;min-width:0;width:100%;
}
.st-amount-input::placeholder{color:var(--ink-3)}
.st-amount-suffix{font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:1px;flex-shrink:0}
.st-amount-equiv{font-size:11px;color:var(--ink-2);font-weight:500;margin:-4px 0 8px;padding-left:4px}

.st-chips{display:flex;gap:6px}
.st-chip{
  flex:1;padding:9px 0;border-radius:12px;
  background:var(--glass);border:1px solid var(--border);color:var(--ink);
  font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.4px;cursor:pointer;
  transition:all .15s;
}
.st-chip:not(.st-chip-off):hover{background:#fff;border-color:var(--lav)}
.st-chip-off{cursor:not-allowed;opacity:0.4;color:var(--ink-3)}

.st-receive{
  margin-top:14px;padding:14px 16px;border-radius:18px;
  background:linear-gradient(135deg,rgba(183,148,246,.10),rgba(127,255,212,.10));
  border:1px solid rgba(183,148,246,.30);
}
.st-receive-head{
  display:flex;justify-content:space-between;
  font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.4px;
  margin-bottom:10px;
}
.st-receive-loading{color:var(--lav)}
.st-receive-val{
  font-family:"Instrument Serif",serif;font-size:30px;line-height:1;
  color:var(--ink);font-variant-numeric:tabular-nums;margin-bottom:10px;
}
.st-receive-val.st-muted{color:var(--ink-3)}
.st-receive-meta{border-top:1px solid var(--border);padding-top:8px}
.st-receive-meta-row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px}
.st-receive-meta-row span:first-child{color:var(--ink-2);font-weight:500}
.st-receive-meta-row span:last-child{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}

.st-cta-wrap{
  flex-shrink:0;padding:14px 22px calc(env(safe-area-inset-bottom) + 90px);
  border-top:1px solid var(--border);
  background:linear-gradient(180deg,transparent 0%,rgba(255,255,255,.7) 30%);
}
.st-status-banner{
  margin-bottom:10px;padding:11px 12px;border-radius:12px;
  background:rgba(183,148,246,.10);border:1px solid rgba(183,148,246,.30);
  display:flex;align-items:center;gap:10px;font-size:12px;color:var(--ink);font-weight:600;
}
.st-spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid rgba(183,148,246,.25);border-top-color:var(--lav);
  animation:st-spin .8s linear infinite;
}
.st-error-banner{
  margin-bottom:10px;padding:11px 12px;border-radius:12px;
  background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.30);
  font-size:12px;color:var(--red);font-weight:600;
}
.st-cta{
  width:100%;padding:18px;border-radius:18px;border:none;
  font-family:"Instrument Serif",serif;font-size:18px;letter-spacing:-.01em;cursor:pointer;
  color:var(--ink);transition:transform .15s,box-shadow .15s;
  position:relative;overflow:hidden;min-height:56px;
}
.st-cta-connect{
  background:linear-gradient(135deg,#B794F6,#FF8FBE);color:#fff;
  box-shadow:0 8px 24px rgba(183,148,246,.35);
}
.st-cta-buy{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  box-shadow:0 8px 24px rgba(127,255,212,.35);
}
.st-cta-sell{
  background:linear-gradient(135deg,#FF8FBE,#FFB088);color:#fff;
  box-shadow:0 8px 24px rgba(255,143,190,.35);
}
.st-cta-success{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink)}
.st-cta:hover:not(.st-cta-disabled){transform:translateY(-1px)}
.st-cta:active:not(.st-cta-disabled){transform:translateY(1px)}
.st-cta-disabled{cursor:not-allowed;opacity:.55;box-shadow:none}
.st-cta-footer{
  text-align:center;font-size:10px;color:var(--ink-3);font-weight:500;
  margin-top:10px;letter-spacing:0.2px;line-height:1.5;
}

/* REGION BLOCK */
.st-region-block{
  position:relative;min-height:100vh;min-height:100dvh;
  max-width:520px;margin:0 auto;width:100%;
  padding:60px 22px calc(env(safe-area-inset-bottom) + 90px);
  display:flex;align-items:center;justify-content:center;
  background:
    radial-gradient(ellipse at 20% 5%,#FFE8F4 0%,transparent 45%),
    radial-gradient(ellipse at 85% 15%,#E4F2FF 0%,transparent 45%),
    radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  background-attachment:fixed;
  border-radius:24px;overflow:hidden;
}
.st-region-card{
  width:100%;max-width:440px;padding:40px 28px;
  border-radius:28px;text-align:center;position:relative;
  background:var(--glass-strong);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.8);
  box-shadow:0 24px 60px rgba(183,148,246,.18);
}
.st-region-icon{
  width:56px;height:56px;margin:0 auto 20px;border-radius:18px;
  background:linear-gradient(135deg,#FF8FBE,#B794F6);
  display:grid;place-items:center;color:#fff;
  box-shadow:0 8px 20px rgba(255,143,190,.35);
}
.st-region-title{
  font-family:"Instrument Serif",serif;font-size:32px;line-height:1.05;
  letter-spacing:-.025em;margin:0 0 12px;color:var(--ink);font-weight:400;
}
.st-region-title em{
  font-style:italic;
  background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.st-region-sub{
  font-size:13px;color:var(--ink-2);line-height:1.6;font-weight:500;
}
`;

// =====================================================================
// CONFIG — atomic Jupiter swap with 5% USDC fee
// =====================================================================
const FEE_WALLET   = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS      = 500;
const USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const SLIPPAGE_BPS_MAX = 500;
const MIN_USDC = 1;
const MAX_USDC = 50_000;

const TOKEN_PROGRAM_ID      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM_ID        = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// =====================================================================
// US GEO BLOCK — ADMIN_WALLETS bypass everywhere
// =====================================================================
const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const GEO_BLOCKED   = new Set(['US']);

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

// =====================================================================
// ALL 18 BRAND TOKENS — verified mints, Token-2022 standard (8 decimals)
// =====================================================================
const BRANDS = [
  // ------ TECH MEGABRANDS ------
  { mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', symbol: 'TSLAx',  name: 'Tesla',                 ticker: 'TSLA',  decimals: 8, sector: 'Tech'   },
  { mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', symbol: 'AAPLx',  name: 'Apple',                 ticker: 'AAPL',  decimals: 8, sector: 'Tech'   },
  { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx',  name: 'NVIDIA',                ticker: 'NVDA',  decimals: 8, sector: 'Tech'   },
  { mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', symbol: 'METAx',  name: 'Meta Platforms',        ticker: 'META',  decimals: 8, sector: 'Tech'   },
  { mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', symbol: 'GOOGLx', name: 'Alphabet',              ticker: 'GOOGL', decimals: 8, sector: 'Tech'   },
  { mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', symbol: 'AMZNx',  name: 'Amazon',                ticker: 'AMZN',  decimals: 8, sector: 'Tech'   },
  { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', symbol: 'MSFTx',  name: 'Microsoft',             ticker: 'MSFT',  decimals: 8, sector: 'Tech'   },
  { mint: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', symbol: 'NFLXx',  name: 'Netflix',               ticker: 'NFLX',  decimals: 8, sector: 'Tech'   },
  { mint: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', symbol: 'PLTRx',  name: 'Palantir',              ticker: 'PLTR',  decimals: 8, sector: 'Tech'   },
  { mint: 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo', symbol: 'AVGOx',  name: 'Broadcom',              ticker: 'AVGO',  decimals: 8, sector: 'Tech'   },
  // ------ CRYPTO-ADJACENT ------
  { mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', symbol: 'COINx',  name: 'Coinbase',              ticker: 'COIN',  decimals: 8, sector: 'Crypto' },
  { mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx',  name: 'MicroStrategy',         ticker: 'MSTR',  decimals: 8, sector: 'Crypto' },
  { mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', symbol: 'CRCLx',  name: 'Circle',                ticker: 'CRCL',  decimals: 8, sector: 'Crypto' },
  { mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', symbol: 'HOODx',  name: 'Robinhood',             ticker: 'HOOD',  decimals: 8, sector: 'Crypto' },
  // ------ INDEX TOKENS ------
  { mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', symbol: 'SPYx',   name: 'Solana 500',            ticker: 'SPY',   decimals: 8, sector: 'Index'  },
  { mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', symbol: 'QQQx',   name: 'Solana 100',            ticker: 'QQQ',   decimals: 8, sector: 'Index'  },
  { mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', symbol: 'GLDx',   name: 'Gold',                  ticker: 'GLD',   decimals: 8, sector: 'Index'  },
  { mint: 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp', symbol: 'TBLLx',  name: 'Short-Term Solana',     ticker: 'TBLL',  decimals: 8, sector: 'Index'  },
];

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Trending', label: 'Trending' },
  { id: 'Tech',     label: 'Tech' },
  { id: 'Crypto',   label: 'Crypto-Adj' },
  { id: 'Index',    label: 'Index' },
];

// Sector → badge class (kept in sync with .st-sec-* CSS)
function sectorClass(sector) {
  if (sector === 'Tech')   return 'st-sec-tech';
  if (sector === 'Crypto') return 'st-sec-crypto';
  return 'st-sec-index';
}

// =====================================================================
// UTILS — UNCHANGED
// =====================================================================
function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}
function fmtAmt(n, d = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(d);
  return n.toFixed(6);
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidSolAddr(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchBrandPrices(mints) {
  if (!mints.length) return {};
  try {
    const url = `https://lite-api.jup.ag/price/v3?ids=${mints.join(',')}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8_000);
    if (!res.ok) return {};
    const json = await res.json();
    const out = {};
    Object.entries(json || {}).forEach(([mint, info]) => {
      const p = Number(info?.usdPrice);
      if (Number.isFinite(p) && p > 0) out[mint] = p;
    });
    return out;
  } catch (e) {
    console.warn('[jupiter price]', e?.message || e);
    return {};
  }
}

// Brand icons via Jupiter token search — mirrors Holdings.jsx pattern.
// Same /api/jupiter/tokens/search?query=<mints> endpoint as elsewhere.
async function fetchBrandIcons(mints) {
  if (!mints.length) return {};
  try {
    const r = await fetchWithTimeout(
      `/api/jupiter/tokens/search?query=${encodeURIComponent(mints.join(','))}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!r.ok) return {};
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data?.tokens || []);
    const out = {};
    for (const t of arr) {
      const id = t?.id || t?.address;
      if (!id) continue;
      const url = t.icon || t.logoURI || null;
      if (url) out[id] = url;
    }
    return out;
  } catch (e) {
    console.warn('[brand icons]', e?.message || e);
    return {};
  }
}

// ───────────────── JUPITER ROUTING — UNCHANGED ─────────────────
async function getJupiterQuote({ inputMint, outputMint, amountAtomic, slippageBps }) {
  const params = new URLSearchParams({
    inputMint, outputMint,
    amount:      String(amountAtomic),
    slippageBps: String(slippageBps),
    swapMode:    'ExactIn',
  });
  const res = await fetchWithTimeout(`/api/jupiter/quote?${params}`, { headers: { Accept: 'application/json' } }, 12_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Quote failed (${res.status})`);
  return json;
}

async function getJupiterSwapInstructions({ quoteResponse, userPublicKey }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol:        true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: { maxBps: SLIPPAGE_BPS_MAX },
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports:   10_000_000,
        priorityLevel: 'high',
      },
    },
    useSharedAccounts: false,
  };
  const res = await fetchWithTimeout('/api/jupiter/swap-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Swap-instructions failed (${res.status})`);
  return json;
}

// ───────────────── INSTRUCTION BUILDERS — UNCHANGED ─────────────────
function deriveAta(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

function createIdempotentAtaIx(payer, ata, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer,             isSigner: true,  isWritable: true  },
      { pubkey: ata,               isSigner: false, isWritable: true  },
      { pubkey: owner,             isSigner: false, isWritable: false },
      { pubkey: mint,              isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: tokenProgramId,    isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    data: new Uint8Array([1]),
  });
}

function createTransferCheckedIx({ source, mint, destination, owner, amountAtomic, decimals, tokenProgramId = TOKEN_PROGRAM_ID }) {
  const data = new Uint8Array(10);
  data[0] = 12;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  data[9] = decimals & 0xff;
  return new TransactionInstruction({
    keys: [
      { pubkey: source,      isSigner: false, isWritable: true  },
      { pubkey: mint,        isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true  },
      { pubkey: owner,       isSigner: true,  isWritable: false },
    ],
    programId: tokenProgramId,
    data,
  });
}

function deserializeJupInstruction(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map(a => ({
      pubkey:     new PublicKey(a.pubkey),
      isSigner:   Boolean(a.isSigner),
      isWritable: Boolean(a.isWritable),
    })),
    data: Uint8Array.from(atob(ix.data), c => c.charCodeAt(0)),
  });
}

async function fetchLookupTableAccounts(altAddresses) {
  if (!altAddresses?.length) return [];
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
      params: [altAddresses, { encoding: 'base64', commitment: 'confirmed' }],
    }),
  }, 10_000);
  const json = await res.json();
  const values = json?.result?.value || [];
  const out = [];
  for (let i = 0; i < altAddresses.length; i++) {
    const acc = values[i];
    if (!acc?.data?.[0]) continue;
    const dataBytes = Uint8Array.from(atob(acc.data[0]), c => c.charCodeAt(0));
    out.push(new AddressLookupTableAccount({
      key:   new PublicKey(altAddresses[i]),
      state: AddressLookupTableAccount.deserialize(dataBytes),
    }));
  }
  return out;
}

async function fetchTokenBalance({ ownerPubkey, mint, decimals }) {
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
      params: [ ownerPubkey, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' } ],
    }),
  }, 8_000);
  const json = await res.json();
  const accs = json?.result?.value || [];
  let atomic = 0n;
  for (const a of accs) {
    const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (raw) atomic += BigInt(raw);
  }
  const ui = Number(atomic) / 10 ** decimals;
  return { atomic, ui };
}

async function assembleSwapTx({ swapInstructions, feeIxs, userPublicKey, prependFee }) {
  const altAddrs = swapInstructions.addressLookupTableAddresses || [];
  const altAccounts = await fetchLookupTableAccounts(altAddrs);

  const computeBudgetIxs = (swapInstructions.computeBudgetInstructions || []).map(deserializeJupInstruction);
  const setupIxs         = (swapInstructions.setupInstructions || []).map(deserializeJupInstruction);
  const swapIx           = swapInstructions.swapInstruction ? deserializeJupInstruction(swapInstructions.swapInstruction) : null;
  const cleanupIx        = swapInstructions.cleanupInstruction ? deserializeJupInstruction(swapInstructions.cleanupInstruction) : null;

  const allIxs = [];
  for (const ix of computeBudgetIxs) allIxs.push(ix);
  if (prependFee) for (const ix of feeIxs) allIxs.push(ix);
  for (const ix of setupIxs)        allIxs.push(ix);
  if (swapIx)    allIxs.push(swapIx);
  if (cleanupIx) allIxs.push(cleanupIx);
  if (!prependFee) for (const ix of feeIxs) allIxs.push(ix);

  const bhRes = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 8_000);
  const bhJson = await bhRes.json();
  const blockhash = bhJson?.result?.value?.blockhash;
  if (!blockhash) throw new Error('Could not fetch recent blockhash');

  const message = new TransactionMessage({
    payerKey:        new PublicKey(userPublicKey),
    recentBlockhash: blockhash,
    instructions:    allIxs,
  }).compileToV0Message(altAccounts);

  return new VersionedTransaction(message);
}

const JUPITER_ERROR_CODES = {
  6000: 'No swap route available',
  6001: 'Price moved — try a slightly different amount',
  6002: 'Routing calculation error — try again',
  6003: 'Configuration error',
  6004: 'Invalid slippage value',
  6005: 'Insufficient liquidity along route',
  6006: 'Invalid input mint',
  6007: 'Invalid output mint',
  6008: 'Account setup error',
  6009: 'Order constraint not supported',
  6010: 'Invalid route plan',
  6011: 'Invalid referral authority',
  6012: 'Token ledger mismatch',
  6013: 'Invalid token ledger',
  6014: 'Token program incompatibility — this brand may need different routing',
};

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const code = Number(detail.Custom);
      const known = JUPITER_ERROR_CODES[code];
      if (known) return known;
      return `Program error 0x${code.toString(16)} at instruction ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at instruction ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage/i.test(String(l)));
  if (errLog) return String(errLog).slice(0, 140);
  return 'Trade unavailable — try a different amount or brand';
}

async function simulateBeforeSign(serializedTxBase64) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
        params: [serializedTxBase64, {
          encoding:               'base64',
          commitment:             'processed',
          replaceRecentBlockhash: true,
          sigVerify:              false,
        }],
      }),
    }, 12_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message || 'Simulation RPC error' };
    const value = json?.result?.value;
    if (!value)     return { ok: true,  warning: 'No sim result' };
    if (value.err)  return { ok: false, message: parseSimError(value.err, value.logs) };
    return { ok: true };
  } catch (e) {
    console.warn('[sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

// CSS injector — runs once
function useStocksCSS() {
  useEffect(() => {
    const id = 'nexus-stocks-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = STOCKS_CSS;
    document.head.appendChild(el);
    return () => { /* leave injected — other Stocks mounts may need it */ };
  }, []);
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
// BrandBadge now accepts an optional `icon` (Jupiter token icon URL). If
// provided, we render the real image and fall back to the sector-letter
// gradient on load error. Same shape & size in both modes.
function BrandBadge({ brand, icon, size = 42 }) {
  const letter = (brand.ticker || brand.symbol || '?').charAt(0).toUpperCase();
  const fontSize = Math.round(size * 0.52);
  const radius   = Math.round(size * 0.31);
  const [errored, setErrored] = useState(false);
  // Reset error when the icon URL changes (different brand opened).
  useEffect(() => { setErrored(false); }, [icon]);

  if (icon && !errored) {
    return (
      <img
        src={icon}
        alt={brand.symbol || ''}
        onError={() => setErrored(true)}
        className="st-badge-img"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <div
      className={'st-badge ' + sectorClass(brand.sector)}
      style={{ width: size, height: size, fontSize, borderRadius: radius }}
    >
      {letter}
    </div>
  );
}

function BrandTile({ brand, icon, price, onClick, idx }) {
  return (
    <button
      onClick={onClick}
      className="st-tile"
      style={{ animationDelay: (idx * 0.03) + 's' }}
    >
      <BrandBadge brand={brand} icon={icon} size={42}/>
      <div className="st-tile-mid">
        <div className="st-tile-row">
          <span className="st-tile-sym">{brand.symbol}</span>
          <span className="st-tile-ticker">{brand.ticker}</span>
        </div>
        <div className="st-tile-name">{brand.name}</div>
      </div>
      <div className="st-tile-right">
        <div className={'st-tile-price' + (price > 0 ? '' : ' st-muted')}>
          {price > 0 ? fmtUsd(price) : '—'}
        </div>
        <div className="st-tile-cta">TAP TO TRADE</div>
      </div>
    </button>
  );
}

function TradeModal({ open, brand, icon, price, onClose, walletPubkey, onConnectWallet }) {
  const { signTransaction, connected } = useWallet();
  const wcon = connected;

  const [side, setSide]       = useState('BUY');
  const [amount, setAmount]   = useState('');
  const [quote, setQuote]     = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]     = useState('');
  const [brandBal, setBrandBal] = useState({ atomic: 0n, ui: 0, loaded: false });
  const [usdcBal,  setUsdcBal]  = useState({ atomic: 0n, ui: 0, loaded: false });
  const quoteSeq = useRef(0);

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setAmount(''); setQuote(null); setError(''); setSubmitState({ kind: 'idle', message: '' });
      setSide('BUY');
      setBrandBal({ atomic: 0n, ui: 0, loaded: false });
      setUsdcBal({ atomic: 0n, ui: 0, loaded: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !brand || !walletPubkey) return;
    let cancelled = false;
    (async () => {
      const [s, u] = await Promise.allSettled([
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: brand.mint, decimals: brand.decimals }),
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: USDC_MINT,  decimals: USDC_DECIMALS }),
      ]);
      if (cancelled) return;
      if (s.status === 'fulfilled') setBrandBal({ ...s.value, loaded: true });
      else                          setBrandBal({ atomic: 0n, ui: 0, loaded: true });
      if (u.status === 'fulfilled') setUsdcBal({ ...u.value, loaded: true });
      else                          setUsdcBal({ atomic: 0n, ui: 0, loaded: true });
    })();
    return () => { cancelled = true; };
  }, [open, brand, walletPubkey, submitState.kind]);

  useEffect(() => {
    if (!open || !brand) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const isBuy = side === 'BUY';
        const inputMint  = isBuy ? USDC_MINT : brand.mint;
        const outputMint = isBuy ? brand.mint : USDC_MINT;

        let atomic;
        if (isBuy) {
          const grossUsdcAtomic = Math.round(n * 10 ** USDC_DECIMALS);
          const feeUsdcAtomic   = Math.floor(grossUsdcAtomic * FEE_BPS / 10000);
          atomic = grossUsdcAtomic - feeUsdcAtomic;
        } else {
          if (!(price > 0)) { setQuote(null); setQuoting(false); return; }
          atomic = Math.round((n / price) * 10 ** brand.decimals);
        }
        if (atomic < 1) { setQuote(null); setQuoting(false); return; }

        const q = await getJupiterQuote({
          inputMint, outputMint,
          amountAtomic: atomic,
          slippageBps:  SLIPPAGE_BPS_MAX,
        });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setError(e.message || 'Quote failed');
        setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [amount, side, brand, open, price]);

  if (!open || !brand) return null;

  const usd       = parseFloat(amount) || 0;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  const outAtomic   = quote ? Number(quote.outAmount) : 0;
  const isBuy       = side === 'BUY';
  const outDecimals = isBuy ? brand.decimals : USDC_DECIMALS;
  const grossOut    = outAtomic / 10 ** outDecimals;

  const feeBpsRatio    = FEE_BPS / 10000;
  const platformFeeUsd = isBuy ? usd * feeBpsRatio : grossOut * feeBpsRatio;
  const netOutUsdc  = !isBuy ? Math.max(0, grossOut - platformFeeUsd) : 0;
  const outAmount   = isBuy ? grossOut : netOutUsdc;
  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  const brandAtomicNeeded = (() => {
    if (isBuy || !(usd > 0) || !(price > 0) || !brand) return 0n;
    try { return BigInt(Math.round((usd / price) * 10 ** brand.decimals)); } catch { return 0n; }
  })();
  const validStake = isBuy
    ? (usd >= MIN_USDC && usd <= MAX_USDC)
    : (brandAtomicNeeded > 0n && brandAtomicNeeded <= brandBal.atomic);
  const insufficientBrand = !isBuy && brandBal.loaded && brandAtomicNeeded > brandBal.atomic;
  const sellBrandEquiv = !isBuy && usd > 0 && price > 0 ? usd / price : 0;

  const handleSubmit = async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!walletPubkey || !isValidSolAddr(walletPubkey)) { setError('Wallet not connected'); return; }
    if (!quote) { setError('No quote available'); return; }
    if (!signTransaction) { setError('Wallet cannot sign'); return; }

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });
    setError('');

    try {
      const owner       = new PublicKey(walletPubkey);
      const usdcMintPk  = new PublicKey(USDC_MINT);

      const userUsdcAta = deriveAta(owner,      usdcMintPk, TOKEN_PROGRAM_ID);
      const feeUsdcAta  = deriveAta(FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID);

      let feeAtomic;
      if (side === 'BUY') {
        feeAtomic = BigInt(Math.round(usd * 10 ** USDC_DECIMALS)) * BigInt(FEE_BPS) / 10000n;
      } else {
        const worstUsdcOut = BigInt(quote.otherAmountThreshold || quote.outAmount || '0');
        feeAtomic = (worstUsdcOut * BigInt(FEE_BPS)) / 10000n;
      }
      if (feeAtomic <= 0n) throw new Error('Amount too small');

      const feeIxs = [
        createIdempotentAtaIx(owner, feeUsdcAta, FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID),
        createTransferCheckedIx({
          source: userUsdcAta,
          mint: usdcMintPk,
          destination: feeUsdcAta,
          owner,
          amountAtomic: feeAtomic,
          decimals: USDC_DECIMALS,
          tokenProgramId: TOKEN_PROGRAM_ID,
        }),
      ];

      const swapIxs = await getJupiterSwapInstructions({
        quoteResponse: quote,
        userPublicKey: walletPubkey,
      });

      const tx = await assembleSwapTx({
        swapInstructions: swapIxs,
        feeIxs,
        userPublicKey:    walletPubkey,
        prependFee:       side === 'BUY',
      });

      setSubmitState({ kind: 'loading', message: 'Simulating...' });
      const serializedForSim = btoa(String.fromCharCode(...tx.serialize()));
      const sim = await simulateBeforeSign(serializedForSim);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      setSubmitState({ kind: 'loading', message: 'Confirm in your wallet...' });
      const signed = await signTransaction(tx);

      setSubmitState({ kind: 'loading', message: 'Submitting on Solana...' });
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const submitRes = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'sendTransaction',
          params: [serialized, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 5 }],
        }),
      }, 20_000);
      const submitJson = await submitRes.json();
      if (submitJson.error) throw new Error(submitJson.error.message || 'Submit failed');

      setSubmitState({ kind: 'success', message: 'Swap submitted' });
      setTimeout(() => { onClose(); setSubmitState({ kind: 'idle', message: '' }); }, 2200);
    } catch (e) {
      console.error('[brands swap]', e);
      const msg = e.message || 'Swap failed';
      setSubmitState({ kind: 'error', message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4500);
    }
  };

  const sellPctUsd = (pct) => {
    if (!brandBal.loaded || brandBal.atomic <= 0n || !(price > 0)) return '';
    if (pct === 100) {
      const exactUsd = (Number(brandBal.atomic) / 10 ** brand.decimals) * price;
      return (Math.floor(exactUsd * 100) / 100).toFixed(2);
    }
    const partUsd = (Number(brandBal.atomic) * (pct / 100) / 10 ** brand.decimals) * price;
    return (Math.floor(partUsd * 100) / 100).toFixed(2);
  };
  const buyChips  = [{ label: '$50', val: '50' }, { label: '$100', val: '100' }, { label: '$500', val: '500' }, { label: '$1000', val: '1000' }];
  const sellChips = [
    { label: '25%', val: sellPctUsd(25)  },
    { label: '50%', val: sellPctUsd(50)  },
    { label: '75%', val: sellPctUsd(75)  },
    { label: 'MAX', val: sellPctUsd(100) },
  ];
  const chips = isBuy ? buyChips : sellChips;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} className={'st-modal-backdrop' + (isBusy ? ' st-busy' : '')}/>
      <div className="st-sheet">
        <div className="st-grabber"/>
        <div className="st-sheet-head">
          <div className="st-sheet-head-row">
            <BrandBadge brand={brand} icon={icon} size={48}/>
            <div className="st-sheet-title-wrap">
              <div className="st-sheet-title-row">
                <span className="st-sheet-title">{brand.symbol}</span>
                <span className="st-tile-ticker">{brand.ticker}</span>
              </div>
              <div className="st-sheet-subtitle">{brand.name}</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} className="st-close-btn">×</button>
          </div>
          {price > 0 && (
            <div className="st-live-price">
              <span className="st-live-price-label">LIVE PRICE</span>
              <span className="st-live-price-val">{fmtUsd(price)}</span>
            </div>
          )}
          {wcon && (
            <div className="st-you-own">
              <span className="st-you-own-label">YOU OWN</span>
              <span className="st-you-own-val">
                {!brandBal.loaded
                  ? '...'
                  : brandBal.ui > 0
                    ? <>{fmtAmt(brandBal.ui, 6)} {brand.symbol} <span className="st-muted-soft">· {fmtUsd(brandBal.ui * price, 2)}</span></>
                    : <span className="st-muted">0 {brand.symbol}</span>}
                {' '}
                <span className="st-muted-deep">· {usdcBal.loaded ? fmtUsd(usdcBal.ui, 2) : '...'} USDC</span>
              </span>
            </div>
          )}
        </div>

        <div className="st-sheet-body">
          <div className="st-side-switch">
            {['BUY', 'SELL'].map(s => {
              const active = side === s;
              return (
                <button
                  key={s}
                  onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }}
                  disabled={isBusy}
                  className={'st-side-btn' + (active ? ` st-active st-${s.toLowerCase()}` : '')}
                >{s === 'BUY' ? 'Buy with USDC' : 'Sell to USDC'}</button>
              );
            })}
          </div>

          <div className="st-amount-wrap">
            <div className="st-amount-label">
              <span>{isBuy ? 'YOU PAY (USDC)' : 'YOU SELL (USDC)'}</span>
            </div>
            <div className={'st-amount-input-wrap' + (isBusy ? ' st-busy' : '')}>
              <span className="st-amount-dollar">$</span>
              <input
                value={amount}
                onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }}
                placeholder="0.00"
                disabled={isBusy}
                inputMode="decimal"
                enterKeyHint="done"
                className="st-amount-input"
              />
              <span className="st-amount-suffix">USDC</span>
            </div>
            {!isBuy && sellBrandEquiv > 0 && (
              <div className="st-amount-equiv">≈ {fmtAmt(sellBrandEquiv, 6)} {brand.symbol}</div>
            )}
            <div className="st-chips">
              {chips.map(c => {
                const disabled = isBusy || !c.val;
                return (
                  <button
                    key={c.label}
                    onClick={() => { if (c.val) { setAmount(c.val); setError(''); } }}
                    disabled={disabled}
                    className={'st-chip' + (disabled ? ' st-chip-off' : '')}
                  >{c.label}</button>
                );
              })}
            </div>
          </div>

          {usd > 0 && (
            <div className="st-receive">
              <div className="st-receive-head">
                <span>YOU RECEIVE</span>
                {quoting && <span className="st-receive-loading">updating...</span>}
              </div>
              <div className={'st-receive-val' + (outAtomic > 0 ? '' : ' st-muted')}>
                {outAtomic > 0 ? (isBuy ? fmtAmt(outAmount, 6) + ' ' + brand.symbol : fmtUsd(outAmount, 2)) : '—'}
              </div>
              {quote && (
                <div className="st-receive-meta">
                  {[
                    ['Price impact', priceImpactPct.toFixed(2) + '%'],
                    ['Route', (quote.routePlan?.length || 1) + ' hop' + ((quote.routePlan?.length || 1) === 1 ? '' : 's')],
                  ].map(([l, v]) => (
                    <div key={l} className="st-receive-meta-row">
                      <span>{l}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="st-cta-wrap">
          {submitState.kind === 'loading' && submitState.message && (
            <div className="st-status-banner">
              <div className="st-spinner"/>
              <span>{submitState.message}</span>
            </div>
          )}
          {(error || submitState.kind === 'error') && (
            <div className="st-error-banner">{error || submitState.message}</div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} className="st-cta st-cta-connect">Connect Wallet</button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isBusy || !quote || !validStake}
              className={'st-cta ' + (isSuccess ? 'st-cta-success' : side === 'BUY' ? 'st-cta-buy' : 'st-cta-sell') + (isBusy || !quote || !validStake ? ' st-cta-disabled' : '')}
            >
              {isBusy ? 'Processing...' :
               isSuccess ? 'Swap placed' :
               insufficientBrand ? `Insufficient ${brand.symbol}` :
               !validStake ? 'Enter USDC amount' :
               !quote ? (quoting ? 'Getting quote...' : 'No quote') :
               `${side === 'BUY' ? 'Buy' : 'Sell'} ${brand.symbol} · ${fmtUsd(usd, 2)}`}
            </button>
          )}

          <div className="st-cta-footer">
            Trade brand tokens via Jupiter · USDC settles to your Solana wallet · No KYC
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// REGION BLOCK
// =====================================================================
function BrandsRegionBlock() {
  return (
    <div className="st-region-block">
      <div className="st-blob" style={{ width: 320, height: 320, background: '#FF8FBE', top: '5%', left: '-80px' }}/>
      <div className="st-blob" style={{ width: 360, height: 360, background: '#A0E7FF', bottom: '10%', right: '-100px', animationDelay: '3s' }}/>
      <div className="st-region-card">
        <div className="st-region-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <h1 className="st-region-title">Not available in <em>your region</em></h1>
        <div className="st-region-sub">
          Brand tokens are restricted in your region. Swap, Bridge, Wonderland, and Wallet remain fully available.
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MAIN — Wonderland hero + glass list
// =====================================================================
function BrandsInner({ onConnectWallet }) {
  useStocksCSS();

  const [filter, setFilter] = useState('All');
  const [prices, setPrices] = useState({});
  const [icons,  setIcons]  = useState({});
  const [active, setActive] = useState(null);

  const { publicKey: solPk } = useWallet();
  const walletPubkey = useMemo(() => solPk ? solPk.toString() : null, [solPk]);

  // PRICES — poll every 30s.
  useEffect(() => {
    let alive = true;
    const mints = BRANDS.map(s => s.mint);
    const tick = async () => {
      const result = await fetchBrandPrices(mints);
      if (!alive) return;
      setPrices(result);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ICONS — one-shot fetch on mount. xStocks icons come from Backed Finance
  // via Jupiter's token search; falls back to letter badge if any fail.
  useEffect(() => {
    let alive = true;
    (async () => {
      const mints = BRANDS.map(s => s.mint);
      const result = await fetchBrandIcons(mints);
      if (alive && Object.keys(result).length > 0) setIcons(result);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'All')      return BRANDS;
    if (filter === 'Trending') return BRANDS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return BRANDS.filter(s => s.sector === filter);
  }, [filter]);

  const totalPriced = Object.keys(prices).length;

  return (
    <>
      <div className="st-page">
        <div className="st-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
        <div className="st-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
        <div className="st-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

        <div className="st-inner">
          <div className="st-head">
            <div className="st-brand">
              <div className="st-brand-dot"/>
              <span className="st-wordmark">
                stocks<span className="slash">//</span><span className="grad">on-chain</span>
              </span>
            </div>
          </div>

          <div className="st-hero">
            <div className="st-eyebrow">
              <span className="dot"/>LIVE · <b>{totalPriced || BRANDS.length} BRANDS</b>
            </div>
            <h1>Trade the<br/><span className="shim">whole market.</span></h1>
            <p>Tokenized stocks on Solana. 24/7. Settle in USDC.</p>
          </div>

          <div className="st-trust">
            <span>No KYC</span><span className="sep">·</span>
            <span>No Account</span><span className="sep">·</span>
            <span>No Limits</span>
          </div>

          <div className="st-section">
            <div className="st-section-title">browse</div>
            <div className="st-section-meta">JUPITER PRICES</div>
          </div>

          <div className="st-filters">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={'st-filter' + (filter === f.id ? ' st-active' : '')}
              >{f.label}</button>
            ))}
          </div>

          <div className="st-list">
            {filtered.length === 0 ? (
              <div className="st-empty">No brands in this category.</div>
            ) : filtered.map((s, i) => (
              <BrandTile
                key={s.mint}
                brand={s}
                icon={icons[s.mint]}
                price={prices[s.mint] || 0}
                onClick={() => setActive(s)}
                idx={i}
              />
            ))}
          </div>

          <div className="st-foot">
            <span className="st-foot-label">powered by</span>
            <span className="st-foot-name">jupiter</span>
            <span className="st-foot-sep">·</span>
            <span className="st-foot-label">non-custodial</span>
          </div>
        </div>
      </div>

      <TradeModal
        open={!!active}
        brand={active}
        icon={active ? icons[active.mint] : null}
        price={active ? prices[active.mint] || 0 : 0}
        onClose={() => setActive(null)}
        walletPubkey={walletPubkey}
        onConnectWallet={onConnectWallet}
      />
    </>
  );
}

// =====================================================================
// Geo gate — ADMIN_WALLETS bypass
// =====================================================================
export default function Stocks({ onConnectWallet, walletAddress }) {
  useStocksCSS();
  const [country, setCountry] = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, []);

  const isAdmin = walletAddress && ADMIN_WALLETS.has(walletAddress);

  if (!isAdmin && geoChecked && country && GEO_BLOCKED.has(country)) {
    return <BrandsRegionBlock/>;
  }

  return <BrandsInner onConnectWallet={onConnectWallet}/>;
}
