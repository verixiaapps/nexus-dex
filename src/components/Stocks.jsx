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
// INLINE CSS — combined from Stocks.css into the component so the
// previous "lost CSS file" class of bugs cannot happen again.
// =====================================================================
const STOCKS_CSS = `
.st-page,.st-region-block,.st-sheet,.st-modal-backdrop {
  --st-bg:#04070f; --st-bg-2:#070b16;
  --st-surface:#0a1020; --st-surface-2:#0e1428;
  --st-ink:#e6efff; --st-ink-str:#f5fafe;
  --st-muted:#7a92b3; --st-muted-2:#475670;
  --st-hl:#4dffd2; --st-hl-2:#5ee8ff;
  --st-hl-dim:rgba(77,255,210,.14); --st-violet:#a87fff;
  --st-up:#3dd598; --st-down:#ff8a9e; --st-amber:#f5b53d; --st-gold:#ffcd3c;
  --st-border:rgba(255,255,255,.06);
  --st-border-hi:rgba(77,255,210,.24);
  --st-hairline:rgba(255,255,255,.05);
  --st-font-display:'Unbounded','Syne',system-ui,sans-serif;
  --st-font-body:'Fredoka','DM Sans',system-ui,sans-serif;
  --st-font-mono:'IBM Plex Mono',ui-monospace,monospace;
  font-family:var(--st-font-body); color:var(--st-ink);
}
.st-page,.st-page *,.st-sheet,.st-sheet *,.st-region-block,.st-region-block *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}
@keyframes st-pulse{50%{opacity:0.4}}
@keyframes st-spin{to{transform:rotate(360deg)}}
@keyframes st-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes st-slide-up{from{transform:translate(-50%,100%)}to{transform:translate(-50%,0)}}
@keyframes st-shimmer{0%{left:-110px}50%,100%{left:130%}}

.st-page{max-width:680px;margin:0 auto;width:100%;padding:0 16px calc(env(safe-area-inset-bottom) + 90px)}

/* COMPACT HERO */
.st-mini-hero{margin-top:14px;padding:18px 18px 16px;border-radius:18px;
  background:linear-gradient(135deg,rgba(10,16,32,.96),rgba(7,11,22,.98));
  border:1px solid var(--st-border-hi);position:relative;overflow:hidden}
.st-mini-hero::before{content:'';position:absolute;inset:-1px;border-radius:18px;padding:1px;
  background:linear-gradient(135deg,var(--st-hl),transparent 50%,var(--st-hl-2));
  -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;opacity:.4;pointer-events:none}
.st-mh-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;position:relative;z-index:2}
.st-mh-left{flex:1;min-width:0}
.st-mh-eyebrow{display:inline-block;font-family:var(--st-font-mono);font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--st-hl);margin-bottom:8px}
.st-mh-title{font-family:var(--st-font-display);font-weight:900;font-size:clamp(22px,6.5vw,28px);line-height:1;letter-spacing:-.03em;margin:0 0 6px;color:var(--st-ink-str)}
.st-mh-title .grad{background:linear-gradient(120deg,var(--st-hl),var(--st-hl-2));-webkit-background-clip:text;background-clip:text;color:transparent;font-style:italic;font-weight:500}
.st-mh-sub{font-family:var(--st-font-body);font-size:12px;font-weight:600;color:var(--st-muted);line-height:1.4;margin:0}
.st-mh-live{flex-shrink:0;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.st-mh-live .v{font-family:var(--st-font-display);font-weight:900;font-size:18px;color:var(--st-hl);letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.st-mh-live .l{font-family:var(--st-font-mono);font-size:8px;color:var(--st-muted-2);letter-spacing:.12em;text-transform:uppercase;font-weight:700}
.st-mh-live .pulse{display:inline-block;width:5px;height:5px;border-radius:50%;background:#00ffa3;box-shadow:0 0 8px #00ffa3;animation:st-pulse 1.4s infinite;margin-right:5px;vertical-align:middle}

/* KYC pill */
.st-kyc{margin:12px 0 6px;display:flex;align-items:center;justify-content:center;gap:14px;
  padding:9px 14px;border-radius:100px;
  background:linear-gradient(90deg,rgba(0,0,0,.4),rgba(77,255,210,.06),rgba(0,0,0,.4));
  border:1px solid var(--st-border-hi)}
.st-kyc span{font-family:var(--st-font-mono);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--st-hl);white-space:nowrap}
.st-kyc span:nth-child(3){color:var(--st-hl-2)}
.st-kyc span:nth-child(5){color:#00ffa3}
.st-kyc .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--st-muted);opacity:.5}

/* FILTERS */
.st-filters{display:flex;gap:6px;margin:14px 0 12px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}
.st-filters::-webkit-scrollbar{display:none}
.st-filter{padding:8px 14px;border-radius:999px;border:1.5px solid var(--st-border);background:rgba(255,255,255,.03);color:var(--st-muted);font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:var(--st-font-display);letter-spacing:0.02em;transition:all 0.15s}
.st-filter.st-active{background:linear-gradient(135deg,var(--st-hl),var(--st-hl-2));border-color:var(--st-hl);color:#04070f;box-shadow:0 2px 12px rgba(77,255,210,.3)}

/* LIST */
.st-list{background:rgba(10,16,32,.50);border:1.5px solid var(--st-border);border-radius:18px;overflow:hidden;margin-bottom:18px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.st-empty{padding:30px 16px;text-align:center;color:var(--st-muted);font-size:12px}

.st-tile{padding:14px 16px;display:grid;grid-template-columns:40px 1fr auto;gap:14px;align-items:center;background:transparent;border:none;border-bottom:1px solid var(--st-hairline);width:100%;text-align:left;cursor:pointer;-webkit-tap-highlight-color:rgba(77,255,210,.10);transition:background 0.15s;color:inherit;font-family:inherit}
.st-tile:last-child{border-bottom:none}
.st-tile:hover{background:rgba(77,255,210,.04)}
.st-tile:active{background:rgba(77,255,210,.08)}
.st-tile-mid{min-width:0}
.st-tile-row{display:flex;align-items:center;gap:8px}
.st-tile-sym{color:var(--st-ink-str);font-weight:800;font-size:15px;letter-spacing:-.01em;font-family:var(--st-font-display)}
.st-tile-ticker{color:var(--st-muted-2);font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.04);letter-spacing:.04em;font-family:var(--st-font-mono)}
.st-tile-name{color:var(--st-muted);font-size:11.5px;margin-top:2px}
.st-tile-right{text-align:right}
.st-tile-price{color:var(--st-ink-str);font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;font-family:var(--st-font-mono)}
.st-tile-price.st-muted{color:var(--st-muted)}
.st-tile-cta{font-size:9px;color:var(--st-hl);font-weight:800;letter-spacing:.12em;margin-top:3px;font-family:var(--st-font-display)}

.st-badge{border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;flex-shrink:0;letter-spacing:-.02em;text-shadow:0 1px 3px rgba(0,0,0,.5);font-family:var(--st-font-display)}

.st-powered{display:flex;align-items:center;justify-content:center;gap:9px;padding:12px 16px;border-radius:14px;background:rgba(255,255,255,.02);border:1px solid var(--st-border);margin-bottom:8px}
.st-powered-label{font-size:9px;color:var(--st-muted-2);font-weight:700;letter-spacing:.08em;font-family:var(--st-font-mono)}
.st-powered-name{font-size:11px;font-weight:800;letter-spacing:.04em;background:linear-gradient(135deg,var(--st-hl) 0%,var(--st-violet) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-family:var(--st-font-mono)}
.st-powered-sep{color:var(--st-muted-2);font-size:9px}

/* MODAL / SHEET */
.st-modal-backdrop{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:pointer;animation:st-rise 0.2s}
.st-modal-backdrop.st-busy{cursor:wait}
.st-sheet{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:401;background:linear-gradient(180deg,var(--st-surface-2) 0%,var(--st-bg) 100%);border-top:1.5px solid var(--st-border-hi);border-radius:28px 28px 0 0;max-height:92dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -28px 80px rgba(0,0,0,.7),0 0 60px rgba(77,255,210,.08);animation:st-slide-up 0.4s cubic-bezier(0.2,1.2,0.4,1)}
.st-grabber{width:40px;height:4px;background:rgba(255,255,255,.18);border-radius:99px;margin:0 auto 16px}
.st-sheet-head{flex-shrink:0;padding:14px 22px 12px}
.st-sheet-head-row{display:flex;align-items:center;gap:12px}
.st-sheet-title-wrap{flex:1;min-width:0}
.st-sheet-title-row{display:flex;align-items:center;gap:8px}
.st-sheet-title{font-size:20px;font-weight:900;color:var(--st-ink-str);letter-spacing:-.02em;font-family:var(--st-font-display)}
.st-sheet-subtitle{font-size:11.5px;color:var(--st-muted);margin-top:2px}
.st-close-btn{background:rgba(255,255,255,.05);border:1px solid var(--st-border);color:var(--st-muted);width:34px;height:34px;border-radius:10px;font-size:18px;cursor:pointer;flex-shrink:0;font-family:inherit;transition:all 0.15s}
.st-close-btn:hover{background:rgba(255,255,255,.1);color:var(--st-ink)}
.st-close-btn:disabled{cursor:not-allowed;opacity:0.5}
.st-live-price{margin-top:12px;padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.30);border:1px solid var(--st-border);display:flex;justify-content:space-between;align-items:center}
.st-live-price-label{font-size:10px;color:var(--st-muted-2);font-weight:700;letter-spacing:.10em;font-family:var(--st-font-mono)}
.st-live-price-val{font-size:17px;color:var(--st-ink-str);font-weight:800;font-variant-numeric:tabular-nums;font-family:var(--st-font-mono)}
.st-you-own{margin-top:8px;padding:10px 14px;border-radius:12px;background:rgba(77,255,210,.05);border:1px solid var(--st-border-hi);display:flex;justify-content:space-between;align-items:center;gap:8px}
.st-you-own-label{font-size:10px;color:var(--st-hl);font-weight:800;letter-spacing:.10em;font-family:var(--st-font-mono)}
.st-you-own-val{font-size:12.5px;color:var(--st-ink-str);font-weight:700;font-variant-numeric:tabular-nums;text-align:right;font-family:var(--st-font-mono)}
.st-muted-soft{color:var(--st-muted);font-weight:600}
.st-muted-deep{color:var(--st-muted-2);font-weight:600}
.st-muted{color:var(--st-muted)}
.st-sheet-body{flex:1;overflow-y:auto;padding:4px 22px 14px;min-height:0}
.st-side-switch{display:inline-flex;padding:4px;margin-bottom:14px;background:rgba(255,255,255,.04);border:1px solid var(--st-border);border-radius:999px;gap:3px;width:100%}
.st-side-btn{flex:1;padding:10px 16px;border-radius:999px;border:none;background:transparent;color:var(--st-muted);font-weight:800;font-size:13px;cursor:pointer;letter-spacing:-.01em;font-family:var(--st-font-display);transition:all 0.2s}
.st-side-btn:disabled{cursor:not-allowed;opacity:0.5}
.st-side-btn.st-active.st-buy{background:rgba(61,213,152,.2);color:var(--st-up);box-shadow:0 2px 12px rgba(61,213,152,.2)}
.st-side-btn.st-active.st-sell{background:rgba(255,138,158,.2);color:var(--st-down);box-shadow:0 2px 12px rgba(255,138,158,.2)}
.st-amount-wrap{margin-bottom:12px}
.st-amount-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:10px;color:var(--st-muted);font-weight:700;letter-spacing:.08em;font-family:var(--st-font-mono)}
.st-amount-input-wrap{background:rgba(255,255,255,.04);border:1.5px solid var(--st-border);border-radius:14px;padding:14px;margin-bottom:9px;display:flex;align-items:center;gap:10px;transition:all 0.2s}
.st-amount-input-wrap:focus-within{border-color:var(--st-hl);box-shadow:0 0 0 4px rgba(77,255,210,.1)}
.st-amount-input-wrap.st-busy{opacity:0.6}
.st-amount-dollar{color:var(--st-muted);font-size:20px;font-family:var(--st-font-mono)}
.st-amount-input{flex:1;background:transparent;border:none;font-size:26px;font-weight:900;color:var(--st-ink-str);outline:none;font-variant-numeric:tabular-nums;font-family:var(--st-font-display);letter-spacing:-0.02em;min-width:0;width:100%}
.st-amount-input::placeholder{color:var(--st-muted-2);font-weight:700}
.st-amount-suffix{color:var(--st-ink);font-size:12px;font-weight:800;font-family:var(--st-font-mono);flex-shrink:0}
.st-amount-equiv{font-size:10px;color:var(--st-muted);font-weight:600;margin-bottom:9px;margin-top:-3px;padding-left:4px;font-family:var(--st-font-mono)}
.st-chips{display:flex;gap:6px}
.st-chip{flex:1;padding:9px 0;border-radius:10px;border:1.5px solid var(--st-border);background:rgba(255,255,255,.03);color:var(--st-muted);font-weight:800;font-size:11px;cursor:pointer;font-family:var(--st-font-display);letter-spacing:0.04em;box-shadow:0 2px 0 rgba(0,0,0,.2);transition:all 0.15s cubic-bezier(0.2,1.2,0.4,1)}
.st-chip:not(.st-chip-off):hover{border-color:var(--st-hl);color:var(--st-hl)}
.st-chip:not(.st-chip-off):active{transform:translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.st-chip-off{cursor:not-allowed;opacity:0.4;color:var(--st-muted-2)}
.st-receive{background:rgba(77,255,210,.04);border:1.5px solid rgba(77,255,210,.18);border-radius:14px;padding:14px;margin-bottom:12px}
.st-receive-head{font-size:9px;color:var(--st-muted-2);font-weight:800;letter-spacing:.12em;margin-bottom:10px;display:flex;justify-content:space-between;font-family:var(--st-font-mono)}
.st-receive-loading{color:var(--st-hl)}
.st-receive-val{font-size:22px;font-weight:900;color:var(--st-ink-str);font-variant-numeric:tabular-nums;margin-bottom:10px;font-family:var(--st-font-display);letter-spacing:-0.02em}
.st-receive-val.st-muted{color:var(--st-muted)}
.st-receive-meta{border-top:1px solid var(--st-hairline);padding-top:8px}
.st-receive-meta-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px}
.st-receive-meta-row span:first-child{color:var(--st-muted)}
.st-receive-meta-row span:last-child{color:var(--st-ink);font-weight:700;font-family:var(--st-font-mono)}
.st-cta-wrap{flex-shrink:0;padding:14px 22px calc(env(safe-area-inset-bottom) + 90px);border-top:1px solid var(--st-hairline);background:linear-gradient(180deg,transparent 0%,var(--st-bg) 20%)}
.st-status-banner{margin-bottom:10px;padding:11px 12px;background:rgba(77,255,210,.06);border:1px solid rgba(77,255,210,.22);border-radius:12px;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--st-ink);font-weight:600}
.st-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--st-hl-dim);border-top-color:var(--st-hl);animation:st-spin 0.8s linear infinite}
.st-error-banner{margin-bottom:10px;padding:11px 12px;background:rgba(255,138,158,.08);border:1px solid rgba(255,138,158,.24);border-radius:12px;font-size:12px;color:var(--st-down);font-weight:600}
.st-cta{width:100%;padding:18px;border-radius:18px;border:none;color:#04070f;font-weight:900;font-size:15px;cursor:pointer;min-height:56px;letter-spacing:0.04em;font-family:var(--st-font-display);position:relative;overflow:hidden;transition:all 0.15s cubic-bezier(0.2,1.2,0.4,1)}
.st-cta::after{content:'';position:absolute;top:0;bottom:0;width:70px;left:-110px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:st-shimmer 2.8s ease-in-out infinite}
.st-cta:active:not(.st-cta-disabled){transform:translateY(3px)}
.st-cta-connect{background:linear-gradient(135deg,var(--st-violet) 0%,var(--st-hl-2) 100%);box-shadow:0 8px 28px rgba(168,127,255,.35),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3)}
.st-cta-buy{background:linear-gradient(135deg,var(--st-up) 0%,var(--st-hl-2) 100%);box-shadow:0 8px 28px rgba(61,213,152,.35),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3)}
.st-cta-sell{color:#fff;background:linear-gradient(135deg,var(--st-down) 0%,var(--st-violet) 100%);box-shadow:0 8px 28px rgba(255,138,158,.35),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.18),inset 0 2px 0 rgba(255,255,255,.2)}
.st-cta-success{background:linear-gradient(135deg,var(--st-up) 0%,var(--st-hl-2) 100%)}
.st-cta-disabled{cursor:not-allowed;opacity:0.55}
.st-cta-disabled::after{display:none}
.st-cta-footer{font-size:10px;color:var(--st-muted-2);text-align:center;margin-top:10px;line-height:1.5;font-weight:500}

/* REGION BLOCK */
.st-region-block{max-width:680px;margin:0 auto;width:100%;padding:0 16px calc(env(safe-area-inset-bottom) + 90px);min-height:80vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse 80% 40% at 50% 10%,rgba(168,127,255,.14),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(77,255,210,.08),transparent 50%)}
.st-region-card{width:100%;max-width:480px;padding:44px 28px 40px;border-radius:28px;background:linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98));border:1.5px solid rgba(168,127,255,.22);box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 60px rgba(168,127,255,.10);text-align:center;position:relative;overflow:hidden}
.st-region-glow{position:absolute;inset:0;background:radial-gradient(ellipse 100% 60% at 50% -10%,rgba(77,255,210,.10),transparent 70%);pointer-events:none}
.st-region-inner{position:relative}
.st-region-icon{width:56px;height:56px;margin:0 auto 20px;border-radius:14px;background:var(--st-hl-dim);border:1px solid var(--st-border-hi);display:flex;align-items:center;justify-content:center;color:var(--st-hl)}
.st-region-title{font-family:var(--st-font-display);font-size:28px;line-height:1.05;font-weight:800;margin:0 0 12px;letter-spacing:-.04em;background:linear-gradient(135deg,var(--st-ink-str) 0%,var(--st-violet) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.st-region-sub{font-size:13px;color:var(--st-muted);line-height:1.6;font-weight:500}
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
  { mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', symbol: 'TSLAx',  name: 'Tesla',                 ticker: 'TSLA',  decimals: 8, sector: 'Tech',   color: '#e31837' },
  { mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', symbol: 'AAPLx',  name: 'Apple',                 ticker: 'AAPL',  decimals: 8, sector: 'Tech',   color: '#a2aaad' },
  { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx',  name: 'NVIDIA',                ticker: 'NVDA',  decimals: 8, sector: 'Tech',   color: '#76b900' },
  { mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', symbol: 'METAx',  name: 'Meta Platforms',        ticker: 'META',  decimals: 8, sector: 'Tech',   color: '#0866ff' },
  { mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', symbol: 'GOOGLx', name: 'Alphabet',              ticker: 'GOOGL', decimals: 8, sector: 'Tech',   color: '#4285f4' },
  { mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', symbol: 'AMZNx',  name: 'Amazon',                ticker: 'AMZN',  decimals: 8, sector: 'Tech',   color: '#ff9900' },
  { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', symbol: 'MSFTx',  name: 'Microsoft',             ticker: 'MSFT',  decimals: 8, sector: 'Tech',   color: '#00a4ef' },
  { mint: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', symbol: 'NFLXx',  name: 'Netflix',               ticker: 'NFLX',  decimals: 8, sector: 'Tech',   color: '#e50914' },
  { mint: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', symbol: 'PLTRx',  name: 'Palantir',              ticker: 'PLTR',  decimals: 8, sector: 'Tech',   color: '#0a0a0a' },
  { mint: 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo', symbol: 'AVGOx',  name: 'Broadcom',              ticker: 'AVGO',  decimals: 8, sector: 'Tech',   color: '#cc092f' },
  // ------ CRYPTO-ADJACENT ------
  { mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', symbol: 'COINx',  name: 'Coinbase',              ticker: 'COIN',  decimals: 8, sector: 'Crypto', color: '#0052ff' },
  { mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx',  name: 'MicroStrategy',         ticker: 'MSTR',  decimals: 8, sector: 'Crypto', color: '#fcb017' },
  { mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', symbol: 'CRCLx',  name: 'Circle',                ticker: 'CRCL',  decimals: 8, sector: 'Crypto', color: '#3399ff' },
  { mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', symbol: 'HOODx',  name: 'Robinhood',             ticker: 'HOOD',  decimals: 8, sector: 'Crypto', color: '#cdff00' },
  // ------ INDEX TOKENS ------
  { mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', symbol: 'SPYx',   name: 'Solana 500',            ticker: 'SPY',   decimals: 8, sector: 'Index',  color: '#1c4f9c' },
  { mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', symbol: 'QQQx',   name: 'Solana 100',            ticker: 'QQQ',   decimals: 8, sector: 'Index',  color: '#003b71' },
  { mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', symbol: 'GLDx',   name: 'Gold',                  ticker: 'GLD',   decimals: 8, sector: 'Index',  color: '#d4af37' },
  { mint: 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp', symbol: 'TBLLx',  name: 'Short-Term Solana',     ticker: 'TBLL',  decimals: 8, sector: 'Index',  color: '#2a4d6e' },
];

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Trending', label: 'Trending' },
  { id: 'Tech',     label: 'Tech' },
  { id: 'Crypto',   label: 'Crypto-Adj' },
  { id: 'Index',    label: 'Index' },
];

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
function BrandBadge({ brand, size = 40 }) {
  const letter = (brand.ticker || brand.symbol || '?').charAt(0).toUpperCase();
  return (
    <div className="st-badge" style={{
      width: size, height: size,
      background: `linear-gradient(135deg,${brand.color},${brand.color}dd)`,
      fontSize: Math.round(size * 0.38),
      boxShadow: `0 4px 14px ${brand.color}50`,
    }}>{letter}</div>
  );
}

function BrandTile({ brand, price, onClick }) {
  return (
    <button onClick={onClick} className="st-tile">
      <BrandBadge brand={brand} size={40}/>
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

function TradeModal({ open, brand, price, onClose, walletPubkey, onConnectWallet }) {
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
        <div className="st-sheet-head">
          <div className="st-grabber"/>
          <div className="st-sheet-head-row">
            <BrandBadge brand={brand} size={44}/>
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
      <div className="st-region-card">
        <div className="st-region-glow"/>
        <div className="st-region-inner">
          <div className="st-region-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <h1 className="st-region-title">Not available in your region</h1>
          <div className="st-region-sub">
            Brand tokens are restricted in your region. Swap, Bridge, Wonderland, and Wallet remain fully available.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MAIN — compact hero + list
// =====================================================================
function BrandsInner({ onConnectWallet }) {
  useStocksCSS();

  const [filter, setFilter] = useState('All');
  const [prices, setPrices] = useState({});
  const [active, setActive] = useState(null);

  const { publicKey: solPk } = useWallet();
  const walletPubkey = useMemo(() => solPk ? solPk.toString() : null, [solPk]);

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

  const filtered = useMemo(() => {
    if (filter === 'All')      return BRANDS;
    if (filter === 'Trending') return BRANDS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return BRANDS.filter(s => s.sector === filter);
  }, [filter]);

  const totalPriced = Object.keys(prices).length;

  return (
    <>
      <div className="st-page">
        {/* Compact hero */}
        <div className="st-mini-hero">
          <div className="st-mh-row">
            <div className="st-mh-left">
              <div className="st-mh-eyebrow">📈 Tokenized Brands</div>
              <h1 className="st-mh-title">
                WATCH THE<br /><span className="grad">Market.</span>
              </h1>
              <p className="st-mh-sub">Trade global brands. 24/7. Settle in USDC.</p>
            </div>
            <div className="st-mh-live">
              <div className="v">{totalPriced || BRANDS.length}</div>
              <div className="l"><span className="pulse"></span>Live Prices</div>
            </div>
          </div>
        </div>

        <div className="st-kyc">
          <span>No KYC</span><span className="dot"></span>
          <span>No Account</span><span className="dot"></span>
          <span>No Limits</span>
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
          ) : filtered.map(s => (
            <BrandTile key={s.mint} brand={s} price={prices[s.mint] || 0} onClick={() => setActive(s)}/>
          ))}
        </div>

        <div className="st-powered">
          <span className="st-powered-label">POWERED BY</span>
          <span className="st-powered-name">JUPITER</span>
          <span className="st-powered-sep">|</span>
          <span className="st-powered-label">NON-CUSTODIAL</span>
        </div>
      </div>

      <TradeModal
        open={!!active}
        brand={active}
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
