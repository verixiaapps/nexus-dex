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
  --ink:#0b0b0c; --ink-2:#86868b; --ink-3:#aeaeb2;
  --pink:#f0425a; --mint:#16c08a; --lav:#7c5cff; --peach:#f5921b;
  --sky:#2f6bff; --gold:#a67200; --green:#16c08a; --greent:#11b87f; --red:#f0425a; --down:#fb7185;
  --fill:#f4f4f5; --fill-2:#fafafa;
  --glass:#ffffff; --glass-strong:#ffffff;
  --border:#e9e9eb; --hairline:#f1f1f2;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink);
}
.st-page,.st-page *,.st-sheet,.st-sheet *,.st-region-block,.st-region-block *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}
.st-page [class*="num"],.st-tile-price,.st-live-price-val,.st-bal-amt,.st-bal-usd,.st-amount-input,.st-amount-equiv,.st-receive-val,.st-receive-usd,.st-chart-price,.st-chart-chg,.st-spark-chg,.st-eyebrow b{font-variant-numeric:tabular-nums}
@keyframes st-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes st-pulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes st-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes st-spin{to{transform:rotate(360deg)}}
@keyframes st-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}

/* page shell */
.st-page{position:relative;min-height:100dvh;background:#ffffff;overflow-x:hidden;padding-bottom:46px}
.st-blob{display:none}
.st-inner{position:relative;z-index:2;max-width:560px;margin:0 auto;padding:8px 16px 40px}
@media(max-width:600px){.st-inner{padding:8px 14px 40px}}

/* hero removed */
.st-hero{display:none}
.st-hero h1,.st-hero p,.shim{display:none}
.st-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--greent);background:rgba(22,192,138,.12);padding:5px 11px;border-radius:999px;border:none}
.st-eyebrow .dot{width:5px;height:5px;border-radius:50%;background:var(--green);animation:st-pulse 1.4s infinite}
.st-eyebrow b{color:var(--ink);font-weight:800;margin-left:2px}

/* wordmark / head */
.st-head{display:flex;align-items:center;gap:11px;padding:8px 0 6px}
.st-wordmark{font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.st-wordmark .grad{color:var(--ink)}
.st-wordmark .slash{color:var(--ink-3);margin:0 3px;font-weight:500}

/* trust chips */
.st-trust{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 0 4px}
.st-trust span{font-size:11px;font-weight:700;color:var(--ink-2);background:var(--fill);padding:6px 11px;border-radius:999px}
.st-trust .sep{display:none}

/* section header */
.st-section{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:14px 2px 10px}
.st-section-title{font-size:13px;font-weight:800;letter-spacing:-.01em;color:var(--ink);text-transform:lowercase}
.st-section-meta{font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}

/* filters */
.st-filters{display:flex;gap:6px;flex-wrap:wrap;padding:0 0 14px}
.st-filter{padding:7px 13px;border-radius:999px;background:var(--fill);border:1px solid transparent;font-size:12px;font-weight:700;color:var(--ink-2);cursor:pointer;transition:.14s}
.st-filter:hover{color:var(--ink)}
.st-filter.st-active{background:#0b0b0c;color:#fff;border-color:transparent}

/* list + tiles */
.st-list{display:flex;flex-direction:column;background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.st-empty{padding:44px 24px;text-align:center;color:var(--ink-2);font-size:13.5px;font-weight:600}
.st-tile{display:flex;align-items:center;gap:12px;padding:13px 16px;border:none;border-bottom:1px solid var(--hairline);background:none;width:100%;text-align:left;cursor:pointer;transition:background .15s;animation:st-rise .4s cubic-bezier(.2,1,.3,1) backwards}
.st-tile:last-child{border-bottom:none}
.st-tile:hover{background:var(--fill-2)}
.st-tile:active{background:#efeff1}
.st-badge{flex-shrink:0;display:grid;place-items:center;font-weight:800;color:#fff;letter-spacing:-.02em;background:#0b0b0c}
.st-badge.st-sec-tech{background:linear-gradient(135deg,#2f6bff,#1e49c9)}
.st-badge.st-sec-crypto{background:linear-gradient(135deg,#f5921b,#d4760a)}
.st-badge.st-sec-index{background:linear-gradient(135deg,#7c5cff,#5a3ed1)}
.st-badge-img{flex-shrink:0;object-fit:cover;background:var(--fill);display:block}
.st-tile-mid{flex:1;min-width:0}
.st-tile-row{display:flex;align-items:center;gap:8px}
.st-tile-sym{font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--ink)}
.st-tile-ticker{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--ink-2);background:var(--fill);padding:2px 7px;border-radius:6px}
.st-tile-name{font-size:12px;color:var(--ink-2);font-weight:600;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-tile-right{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;min-width:72px}
.st-tile-price{font-size:15.5px;font-weight:700;color:var(--ink)}
.st-tile-price.st-muted{color:var(--ink-3);font-weight:600}
.st-tile-cta{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:#0b0b0c;padding:5px 10px;border-radius:999px}

/* tile sparkline */
.st-spark{flex-shrink:0;width:54px;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.st-spark-svg{width:54px;height:28px;display:block}
.st-spark-ph{width:54px;height:28px;display:block;border-radius:6px;background:linear-gradient(90deg,var(--fill),var(--fill-2),var(--fill));background-size:200% 100%;animation:st-shimmer 1.4s linear infinite}
.st-spark-chg{font-size:10.5px;font-weight:800}
.st-spark-chg.up{color:var(--greent)}
.st-sk{background:linear-gradient(100deg,#eef0f2 28%,#f7f8fa 50%,#eef0f2 72%);background-size:200% 100%;animation:stsh 1.15s ease-in-out infinite;border-radius:7px}
@keyframes stsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
.st-spark-sk{width:54px;height:18px;display:inline-block}
.st-chart-sk{position:relative;overflow:hidden;background:#fafbfc}
.st-chart-sk::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.6) 50%,transparent 70%);background-size:200% 100%;animation:stsh 1.15s ease-in-out infinite}
.st-chart-sk-gl{position:absolute;left:0;right:0;height:1px;background:#f0f1f3}
.st-chart-sk-svg{position:absolute;inset:0;width:100%;height:100%}
.st-chart-sk-svg path{stroke:#aeaeb2;stroke-width:1.6;fill:none;opacity:.3;animation:stpl 1.3s ease-in-out infinite}
@keyframes stpl{0%,100%{opacity:.18}50%{opacity:.42}}
.st-spark-chg.dn{color:var(--down)}

/* muted helpers */
.st-muted{color:var(--ink-3)}
.st-muted-soft{color:var(--ink-2)}
.st-muted-deep{color:var(--ink-3)}

/* brand misc (legacy) */
.st-brand{display:flex;align-items:center;gap:8px}
.st-brand-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}

/* chips (presets) */
.st-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.st-chip{padding:7px 13px;border-radius:999px;background:var(--fill);border:1px solid transparent;font-size:12px;font-weight:700;color:var(--ink-2);cursor:pointer;transition:.12s;font-variant-numeric:tabular-nums}
.st-chip:hover{color:var(--ink)}
.st-chip:not(.st-chip-off){color:var(--ink-2)}
.st-chip.st-chip-off{opacity:.55}

/* footer */
.st-foot{display:flex;align-items:center;justify-content:center;gap:8px;padding:20px 0 8px;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.st-foot-label{color:var(--ink-3)}
.st-foot-name{color:var(--ink)}
.st-foot-sep{width:3px;height:3px;border-radius:50%;background:var(--ink-3)}

/* region gate */
.st-region-block{min-height:100dvh;background:#fff;display:grid;place-items:center;padding:24px}
.st-region-card{max-width:420px;width:100%;background:#fff;border:1px solid var(--hairline);border-radius:20px;padding:28px 24px;text-align:center;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.st-region-icon{width:52px;height:52px;border-radius:15px;background:var(--fill);display:grid;place-items:center;font-size:24px;margin:0 auto 16px}
.st-region-title{font-size:22px;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin-bottom:8px}
.st-region-sub{font-size:14px;font-weight:500;line-height:1.5;color:var(--ink-2)}

/* ===== trade sheet ===== */
.st-modal-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(11,11,12,.4);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;animation:st-rise .2s}
.st-modal-backdrop.st-busy{cursor:progress}
.st-sheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;z-index:2001;width:100%;max-width:520px;background:#fff;border-radius:24px 24px 0 0;box-shadow:0 -18px 50px rgba(11,11,12,.2);max-height:96dvh;overflow-y:auto;padding-bottom:max(10px,env(safe-area-inset-bottom));animation:st-rise .3s cubic-bezier(.2,1.2,.4,1)}
.st-grabber{width:38px;height:4px;border-radius:3px;background:var(--border);margin:10px auto 2px}
.st-sheet-head{padding:8px 20px 12px;position:relative}
.st-sheet-head-row{display:flex;align-items:center;gap:12px}
.st-sheet-title-wrap{flex:1;min-width:0}
.st-sheet-title-row{display:flex;align-items:center;gap:8px}
.st-sheet-title{font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.st-sheet-subtitle{font-size:12.5px;font-weight:600;color:var(--ink-2);margin-top:3px}
.st-close-btn{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--fill);border:none;color:var(--ink-2);font-size:16px;cursor:pointer;display:grid;place-items:center;transition:.14s}
.st-close-btn:hover{color:var(--ink);background:#ececee}
.st-close-btn:disabled{opacity:.5;cursor:progress}

/* live price (in head) */
.st-live-price{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:11px 14px;border-radius:12px;background:var(--fill-2);border:1px solid var(--hairline)}
.st-live-price-label{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.st-live-price-val{font-size:17px;font-weight:800;color:var(--ink)}

/* balances */
.st-balances{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.st-balances.st-bal-one{grid-template-columns:1fr}
.st-bal-pill{border:1px solid var(--hairline);border-radius:12px;padding:10px 13px;background:var(--fill-2);display:flex;flex-direction:column;gap:3px}
.st-bal-pill.st-bal-usdc{background:var(--fill-2)}
.st-bal-label{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.st-bal-pill.st-bal-usdc .st-bal-label{color:var(--ink-3)}
.st-bal-amt{font-size:15px;font-weight:700;color:var(--ink)}
.st-bal-usd{font-size:11px;font-weight:600;color:var(--ink-2)}
.st-bal-pill.st-bal-usdc .st-bal-usd{color:var(--ink-2)}

/* ===== chart (trade sheet) — embedded live chart ===== */
.st-chart{padding:6px 20px 6px}
.st-chart-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 0 8px}
.st-chart-price{font-size:24px;font-weight:800;letter-spacing:-.03em;color:var(--ink)}
.st-chart-ca{display:flex;align-items:center;gap:7px;min-width:0}
.st-chart-ca .lbl{font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--ink-3);flex-shrink:0}
.st-chart-ca .val{font-size:11px;font-weight:700;color:var(--ink-2);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-chart-ca .cp{flex-shrink:0;font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:#0b0b0c;border:none;border-radius:7px;padding:5px 9px;cursor:pointer;transition:opacity .15s}
.st-chart-ca .cp:hover{opacity:.88}
.st-chart-prov{font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3)}
.st-chart-embed{position:relative;width:100%;height:clamp(300px,42dvh,440px);border:1px solid var(--hairline);border-radius:16px;overflow:hidden;background:#fff}
.st-chart-frame{width:100%;height:100%;border:0;display:block}
.st-chart-state{display:grid;place-items:center;text-align:center;font-size:12px;font-weight:600;color:var(--ink-3);padding:0 24px;background:var(--fill-2)}
.st-chart-tfs{display:flex;align-items:center;gap:4px;padding:8px 2px 2px}
.st-chart-tf{flex:0 0 auto;text-align:center;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink-2);background:transparent;border:none;padding:6px 11px;border-radius:8px;cursor:pointer;transition:.12s}
.st-chart-tf:hover{color:var(--ink)}
.st-chart-tf.on{background:var(--fill);color:var(--ink)}
.st-chart-tf:disabled{opacity:.4;cursor:default}
.st-chart-tfmeta{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--ink-3);text-transform:uppercase}
@media(max-width:600px){.st-chart{padding:6px 14px 6px}.st-chart-embed{height:clamp(300px,50dvh,420px)}}

/* sheet body / side switch */
.st-sheet-body{padding:14px 20px 0}
.st-side-switch{display:grid;grid-template-columns:1fr 1fr;background:var(--fill);border:none;border-radius:12px;padding:3px;position:relative;margin-bottom:16px}
.st-side-btn{padding:11px 0;text-align:center;font-size:15px;font-weight:700;color:var(--ink-2);border:none;background:none;cursor:pointer;border-radius:10px;transition:color .2s,background .25s}
.st-side-btn.st-active.st-buy{background:var(--green);color:#fff}
.st-side-btn.st-active.st-sell{background:var(--red);color:#fff}
.st-side-btn:disabled{opacity:.5;cursor:not-allowed}

/* amount */
.st-amount-wrap{margin-bottom:14px}
.st-amount-label{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.st-amount-input-wrap{display:flex;align-items:center;gap:8px;padding:14px 16px;border:1px solid var(--border);border-radius:14px;background:#fff;transition:border-color .14s}
.st-amount-input-wrap:focus-within{border-color:#0b0b0c}
.st-amount-input-wrap.st-busy{opacity:.6;pointer-events:none}
.st-amount-dollar{font-size:28px;font-weight:800;color:var(--ink-3)}
.st-amount-input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:28px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.st-amount-input::placeholder{color:var(--ink-3)}
.st-amount-suffix{font-size:13px;font-weight:700;color:var(--ink-2);background:var(--fill);padding:7px 12px;border-radius:999px;flex-shrink:0}
.st-amount-equiv{font-size:12px;font-weight:600;color:var(--ink-2);margin-top:8px;text-align:right}

/* receive */
.st-receive{margin-bottom:16px;border:1px solid var(--hairline);border-radius:14px;padding:14px;background:var(--fill-2)}
.st-receive-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.st-receive-loading{font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--ink-3);text-transform:none}
.st-receive-val{font-size:23px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.st-receive-val.st-muted{color:var(--ink-3)}
.st-receive-usd{font-size:12px;font-weight:600;color:var(--ink-2);margin-top:2px}
.st-receive-meta{margin-top:12px;padding-top:11px;border-top:1px solid var(--hairline);display:flex;flex-direction:column;gap:7px}
.st-receive-meta-row{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:600}
.st-receive-meta-row span:first-child{color:var(--ink-3)}
.st-receive-meta-row span:last-child{color:var(--ink);font-weight:700}

/* cta */
.st-cta-wrap{padding:0 20px 14px;position:sticky;bottom:0;background:linear-gradient(to top,#fff 70%,rgba(255,255,255,0));padding-top:8px}
.st-status-banner{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:var(--fill-2);border:1px solid var(--hairline);font-size:12.5px;font-weight:600;color:var(--ink-2);margin-bottom:10px}
.st-error-banner{padding:11px 13px;border-radius:12px;background:rgba(240,66,90,.07);border:1px solid rgba(240,66,90,.28);font-size:12px;font-weight:600;color:var(--red);margin-bottom:10px}
.st-cta{width:100%;padding:16px 0;border:none;border-radius:999px;font-family:inherit;font-size:17px;font-weight:800;letter-spacing:-.01em;color:#fff;cursor:pointer;transition:opacity .12s;background:#0b0b0c}
.st-cta:hover:not(.st-cta-disabled){opacity:.92}
.st-cta:active:not(.st-cta-disabled){transform:translateY(1px)}
.st-cta-buy{background:var(--green)}
.st-cta-sell{background:var(--red)}
.st-cta-connect{background:#0b0b0c}
.st-cta-success{background:var(--green)}
.st-cta-disabled{opacity:.5;cursor:not-allowed;background:var(--fill);color:var(--ink-3)}
.st-cta-footer{text-align:center;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:12px 0 4px}

/* spinner */
.st-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--hairline);border-top-color:#0b0b0c;animation:st-spin .75s linear infinite;display:inline-block;flex-shrink:0}
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

// ── RPC ──────────────────────────────────────────────────────────────
// Same-origin server proxy → Alchemy mainnet. server.js holds the API
// key and forwards via /api/solana-rpc. No env var needed.
const RPC_URL = '/api/solana-rpc';


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
export const BRANDS = [
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

export async function fetchBrandPrices(mints) {
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
export async function fetchBrandIcons(mints) {
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
  const res = await fetchWithTimeout(RPC_URL, {
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
  const res = await fetchWithTimeout(RPC_URL, {
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

  const bhRes = await fetchWithTimeout(RPC_URL, {
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
    const res = await fetchWithTimeout(RPC_URL, {
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
// =====================================================================
// Charts  GeckoTerminal OHLCV (primary) + DexScreener (fallback).
// Pool resolution ALWAYS enforces base-token == this mint and picks the
// highest-liquidity pool, with a seeded reduce so a thin pool still
// charts  the chart can never show the wrong asset. Self-contained and
// degrades gracefully (live-tick line when no history is indexed yet).
// =====================================================================
const STK_GT = 'https://api.geckoterminal.com/api/v2';
const STK_DS = 'https://api.dexscreener.com/latest/dex';

// base-token-match + highest USD-liquidity, seeded reduce (mirrors LaunchRadar)
function stkPickGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted  = 'solana_' + mint;                       // EXACT match — Solana base58 is case-sensitive
  const addr    = p => p?.attributes?.address;
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const quoteId = p => String(p?.relationships?.quote_token?.data?.id || '');
  const liq     = p => Number(p?.attributes?.reserve_in_usd) || 0;
  const base = pools.filter(p => addr(p) && baseId(p) === wanted);                    // token is BASE → chart IS this token
  const any  = pools.filter(p => addr(p) && (baseId(p) === wanted || quoteId(p) === wanted));
  const set  = base.length ? base : any;                                             // prefer base; else any pool holding it
  if (!set.length) return null;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);             // highest-liquidity pool
}
function stkPickPair(pairs, mint) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const ok  = p => p && p.chainId === 'solana' && p.pairAddress;
  const liq = p => Number(p.liquidity?.usd) || 0;
  const base = pairs.filter(p => ok(p) && p.baseToken?.address === mint);             // EXACT, case-sensitive
  const any  = pairs.filter(p => ok(p) && (p.baseToken?.address === mint || p.quoteToken?.address === mint));
  const set  = base.length ? base : any;
  if (!set.length) return null;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);              // highest-liquidity pair
}

const STK_TFS = ['1H', '1D', '1W', '1M', '1Y'];
const STK_TF_PARAMS = {
  '1H': { unit: 'minute', agg: 1, limit: 60  },
  '1D': { unit: 'hour',   agg: 1, limit: 24  },
  '1W': { unit: 'hour',   agg: 4, limit: 42  },
  '1M': { unit: 'day',    agg: 1, limit: 30  },
  '1Y': { unit: 'day',    agg: 1, limit: 365 },
};

const stkPoolCache   = new Map(); // mint -> poolAddress | null  (in-memory, this session)
const stkSeriesCache = new Map(); // mint|tf -> pts | null

// localStorage-backed cache so charts survive reloads and paint instantly on
// revisit. Pools are stable (long TTL); series kept briefly fresh. A cached
// value may legitimately be null ("no pool"/"no data"), so `undefined` == miss.
const STK_POOL_LS    = 'nx_stk_pool_';
const STK_SERIES_LS  = 'nx_stk_series_';
const STK_POOL_TTL   = 24 * 60 * 60 * 1000; // 24h — pool addresses are stable
const STK_SERIES_TTL = 5 * 60 * 1000;       // 5 min — keep prices fresh-ish
function stkLsGet(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const o = JSON.parse(raw);
    if (!o || (Date.now() - o.ts) > ttl) { localStorage.removeItem(key); return undefined; }
    return o.v;
  } catch { return undefined; }
}
function stkLsSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ v, ts: Date.now() })); } catch {}
}

// Concurrency-limited scheduler: a few fetches in flight at once so visible
// charts fill fast, while lazy-loading + caching keep us within GeckoTerminal's
// ~30/min. Replaces the old single-lane 350ms queue; same stkThrottle(fn) API.
const STK_MAX_CONCURRENT = 6;
let stkActive = 0;
const stkWaiters = [];
export function stkThrottle(fn) {
  return new Promise((resolve, reject) => {
    const launch = () => {
      stkActive++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        stkActive--;
        const next = stkWaiters.shift();
        if (next) next();
      });
    };
    if (stkActive < STK_MAX_CONCURRENT) launch();
    else stkWaiters.push(launch);
  });
}

async function stkFetchJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(id); }
}

async function stkResolvePool(mint) {
  if (stkPoolCache.has(mint)) return stkPoolCache.get(mint);
  const cached = stkLsGet(STK_POOL_LS + mint, STK_POOL_TTL);
  if (cached !== undefined) { stkPoolCache.set(mint, cached); return cached; }
  let pool = null;
  const gj = await stkFetchJson(`${STK_GT}/networks/solana/tokens/${encodeURIComponent(mint)}/pools`);
  const gp = stkPickGeckoPool(gj?.data, mint);
  if (gp) pool = gp.attributes.address;
  stkPoolCache.set(mint, pool);
  stkLsSet(STK_POOL_LS + mint, pool);
  return pool;
}

// GeckoTerminal series — real OHLCV (pool resolve + ohlcv). Higher fidelity but
// can be slow / rate-limited. Never throws; returns pts | null.
async function stkGeckoSeries(mint, tf) {
  const pool = await stkResolvePool(mint);
  if (!pool) return null;
  const p = STK_TF_PARAMS[tf] || STK_TF_PARAMS['1D'];
  const url = `${STK_GT}/networks/solana/pools/${pool}/ohlcv/${p.unit}?aggregate=${p.agg}&limit=${p.limit}&currency=usd`;
  const j = await stkFetchJson(url, 6000);
  const list = j?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length < 2) return null;
  const pts = list
    .map(r => ({ t: Number(r[0]), c: Number(r[4]) }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.c) && x.c > 0)
    .sort((a, b) => a.t - b.t);
  return pts.length >= 2 ? pts : null;
}

// DexScreener fallback — one fast request. No OHLCV, so we synthesize a coarse
// real-direction series from the live price + its 24h/6h/1h/5m % changes
// (price_then = price_now / (1 + chg/100)). Enough to draw an accurate sparkline
// the instant GeckoTerminal is slow/rate-limited.
async function stkDexSeries(mint) {
  const j = await stkFetchJson(`${STK_DS}/tokens/${encodeURIComponent(mint)}`, 4000);
  const pair = stkPickPair(j?.pairs, mint);
  const price = Number(pair?.priceUsd);
  if (!(price > 0)) return null;
  const pc = pair.priceChange || {};
  const at = chg => { const c = Number(chg); return Number.isFinite(c) ? price / (1 + c / 100) : null; };
  const raw = [at(pc.h24), at(pc.h6), at(pc.h1), at(pc.m5), price]; // oldest → now
  const pts = raw.filter(v => Number.isFinite(v) && v > 0).map((c, i) => ({ t: i, c }));
  return pts.length >= 2 ? pts : null;
}

// How long we'll wait on GeckoTerminal before dropping to DexScreener pricing.
const STK_GECKO_GRACE_MS = 1400;

const stkSeriesInflight = new Map(); // key -> Promise (dedup concurrent fetches of same series)
export async function stkFetchSeries(mint, tf) {
  const key = mint + '|' + tf;
  if (stkSeriesCache.has(key)) return stkSeriesCache.get(key);
  const cached = stkLsGet(STK_SERIES_LS + key, STK_SERIES_TTL);
  if (cached !== undefined) { stkSeriesCache.set(key, cached); return cached; }
  if (stkSeriesInflight.has(key)) return stkSeriesInflight.get(key);

  const inflightP = (async () => {
    const save = (out) => { stkSeriesCache.set(key, out); stkLsSet(STK_SERIES_LS + key, out); return out; };

    // Fire both providers at once.
    const geckoP = stkGeckoSeries(mint, tf).catch(() => null);
    const dexP   = stkDexSeries(mint).catch(() => null);

    // Prefer GeckoTerminal, but only if it answers within the grace window —
    // otherwise fall straight back to DexScreener pricing so the sparkline paints fast.
    const raced = await Promise.race([
      geckoP.then(p => (p ? { p } : null)),               // resolves null if gecko had no data
      new Promise(res => setTimeout(() => res('SLOW'), STK_GECKO_GRACE_MS)),
    ]);
    if (raced && raced !== 'SLOW' && raced.p) return save(raced.p);

    // Gecko slow or empty → use DexScreener now.
    const dex = await dexP;
    if (dex) {
      // Let a successful Gecko result quietly upgrade the cache afterwards.
      geckoP.then(p => { if (p) save(p); });
      return save(dex);
    }

    // DexScreener empty too → wait out Gecko as last resort.
    return save(await geckoP);
  })();

  stkSeriesInflight.set(key, inflightP);
  try { return await inflightP; } finally { stkSeriesInflight.delete(key); }
}

// SVG line + area from closes, auto-scaled (never zero-based)
export function stkBuildPath(pts, w, h, pad = 2) {
  const cs = pts.map(p => p.c);
  let lo = Math.min(...cs), hi = Math.max(...cs);
  if (!(hi > lo)) { const m = lo || 1; hi = m * 1.0005; lo = m * 0.9995; }
  const n = pts.length;
  const xAt = i => pad + (i / (n - 1)) * (w - pad * 2);
  const yAt = c => pad + (1 - (c - lo) / (hi - lo)) * (h - pad * 2);
  let line = '';
  pts.forEach((p, i) => { line += (i === 0 ? 'M' : 'L') + xAt(i).toFixed(2) + ',' + yAt(p.c).toFixed(2) + ' '; });
  const area = line + 'L' + xAt(n - 1).toFixed(2) + ',' + h + ' L' + xAt(0).toFixed(2) + ',' + h + ' Z';
  let hiI = 0, loI = 0;
  pts.forEach((p, i) => { if (p.c > pts[hiI].c) hiI = i; if (p.c < pts[loI].c) loI = i; });
  const coords = pts.map((p, i) => ({ x: xAt(i), y: yAt(p.c), c: p.c, t: p.t }));
  return {
    line: line.trim(), area, w, h, coords,
    lastX: xAt(n - 1), lastY: yAt(pts[n - 1].c),
    hi, lo, hiX: xAt(hiI), hiY: yAt(pts[hiI].c), loX: xAt(loI), loY: yAt(pts[loI].c), openY: yAt(pts[0].c),
  };
}

// Some components import the path builder under the name `stkSmoothPath`.
// It is the SAME function as stkBuildPath (no new logic) — aliased here so the
// import resolves and the build compiles.
export const stkSmoothPath = stkBuildPath;

// ── Embedded chart (trade sheet) ──────────────────────────────────────
// Switched from a hand-drawn SVG to the provider's live embedded chart —
// GeckoTerminal primary, DexScreener fallback — reusing the same base-token
// pool resolution as the sparklines so it can never show the wrong asset.
// Defaults to the 1D (24-hour) view. Resolution per timeframe mirrors the
// page's own STK_TF_PARAMS so 1H/1D/1W/1M/1Y feel the same as before.
// (GeckoTerminal honors `resolution`; DexScreener honors `interval`. If a pool
// can't serve a given granularity the provider falls back to its own default.)
const STK_EMBED_RES = [
  { key: '1H', gecko: '1m', dex: '1'   },
  { key: '1D', gecko: '1h', dex: '60'  },
  { key: '1W', gecko: '4h', dex: '240' },
  { key: '1M', gecko: '1d', dex: '1D'  },
  { key: '1Y', gecko: '1d', dex: '1D'  },
];
const STK_EMBED_DEFAULT = '1W'; // 1-week view

const STK_EMBED_LS = 'nx_stk_embed_';                    // localStorage cache for the big chart's pool (24h)
const stkEmbedPoolCache = new Map(); // mint -> { provider, addr } | null
async function stkResolveEmbedPool(mint) {
  if (stkEmbedPoolCache.has(mint)) return stkEmbedPoolCache.get(mint);
  const cached = stkLsGet(STK_EMBED_LS + mint, STK_POOL_TTL);
  if (cached !== undefined) { stkEmbedPoolCache.set(mint, cached); return cached; }
  // GeckoTerminal only — no DexScreener fallback for the embedded chart.
  let res = null;
  const gj = await stkFetchJson(`${STK_GT}/networks/solana/tokens/${encodeURIComponent(mint)}/pools`);
  const gp = stkPickGeckoPool(gj?.data, mint);
  if (gp?.attributes?.address) res = { provider: 'GECKOTERMINAL', addr: gp.attributes.address };
  stkEmbedPoolCache.set(mint, res);
  stkLsSet(STK_EMBED_LS + mint, res);
  return res;
}

function stkBuildEmbedSrc(pool, tfKey) {
  if (!pool) return null;
  const r = STK_EMBED_RES.find(x => x.key === tfKey) || STK_EMBED_RES[1];
  // GeckoTerminal only.
  return `https://www.geckoterminal.com/solana/pools/${pool.addr}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&bg_color=ffffff&resolution=${r.gecko}`;
}

function StockChart({ mint, price, symbol }) {
  const [tf, setTf]         = useState(STK_EMBED_DEFAULT); // '1W' = 1 week
  const [pool, setPool]     = useState(null);              // { provider, addr }
  const [status, setStatus] = useState('loading');         // loading | ok | none | fail
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);

  // Reset to the 24-hour view each time a different stock opens.
  useEffect(() => { setTf(STK_EMBED_DEFAULT); }, [mint]);

  useEffect(() => {
    if (!mint) { setStatus('none'); setPool(null); return; }
    const id = ++reqRef.current;
    setStatus('loading'); setPool(null);
    stkResolveEmbedPool(mint)
      .then(res => {
        if (id !== reqRef.current) return;
        if (res) { setPool(res); setStatus('ok'); }
        else setStatus('none');
      })
      .catch(() => { if (id === reqRef.current) setStatus('fail'); });
  }, [mint]);

  const src = useMemo(() => stkBuildEmbedSrc(pool, tf), [pool, tf]);
  const shortCa = mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : '';
  const copyCa = async () => { try { await navigator.clipboard.writeText(mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (e) {} };

  return (
    <div className="st-chart">
      <div className="st-chart-bar">
        <div className="st-chart-ca">
          <span className="lbl">CA</span>
          <span className="val">{shortCa}</span>
          <button type="button" className="cp" onClick={copyCa}>{copied ? 'COPIED' : 'COPY'}</button>
        </div>
        <span className="st-chart-prov">{status === 'ok' ? 'GECKOTERMINAL' : 'CHART'}</span>
      </div>
      {status === 'ok' && src ? (
        <div className="st-chart-embed">
          <iframe
            key={pool.provider + ':' + pool.addr + ':' + tf}
            className="st-chart-frame"
            src={src}
            title={(symbol || 'Stock') + ' price chart'}
            loading="lazy"
            allow="clipboard-write"
          />
        </div>
      ) : status === 'loading' ? (
        <div className="st-chart-embed st-chart-sk">
          <span className="st-chart-sk-gl" style={{ top: '25%' }} />
          <span className="st-chart-sk-gl" style={{ top: '50%' }} />
          <span className="st-chart-sk-gl" style={{ top: '75%' }} />
          <svg className="st-chart-sk-svg" viewBox="0 0 300 150" preserveAspectRatio="none"><path d="M0 95 L40 88 L80 100 L120 82 L160 92 L200 70 L240 86 L300 64" /></svg>
        </div>
      ) : status === 'none' ? (
        <div className="st-chart-embed st-chart-state">No chart indexed yet for {symbol || 'this stock'} — it’ll appear once it’s trading on-chain.</div>
      ) : (
        <div className="st-chart-embed st-chart-state">Couldn’t load the chart. Try again shortly.</div>
      )}
      <div className="st-chart-tfs">
        {STK_TFS.map(t => (
          <button key={t} className={'st-chart-tf' + (t === tf ? ' on' : '')} disabled={status !== 'ok'} onClick={() => setTf(t)}>{t}</button>
        ))}
        <span className="st-chart-tfmeta">{status === 'ok' ? '● Live · ' + tf : 'Live'}</span>
      </div>
    </div>
  );
}

function StockSparkline({ mint }) {
  const [pts, setPts] = useState(null);
  const ref = useRef(null);
  const doneRef = useRef(false);
  const gidRef = useRef('stk-sp-' + Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!mint || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !doneRef.current) {
          doneRef.current = true;
          io.disconnect();
          stkThrottle(() => stkFetchSeries(mint, '1M')).then(s => setPts(s || []));
        }
      });
    }, { rootMargin: '140px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mint]);

  const series = (pts && pts.length >= 2) ? pts : null;
  const W = 54, H = 28;
  const built = series ? stkBuildPath(series, W, H, 2) : null;
  const chg = series ? ((series[series.length - 1].c - series[0].c) / series[0].c) * 100 : null;
  const up = chg == null ? true : chg >= 0;
  const col = up ? '#11b87f' : '#fb7185';
  const gid = gidRef.current;

  return (
    <div className="st-spark" ref={ref}>
      {built ? (
        <svg className="st-spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={col} stopOpacity="0.20" />
              <stop offset="1" stopColor={col} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={built.area} fill={`url(#${gid})`} />
          <path d={built.line} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (pts === null ? <span className="st-sk st-spark-sk" /> : <span className="st-spark-ph" />)}
      {chg != null && <span className={'st-spark-chg ' + (up ? 'up' : 'dn')}>{(up ? '+' : '') + chg.toFixed(2) + '%'}</span>}
    </div>
  );
}

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
      <StockSparkline mint={brand.mint} />
      <div className="st-tile-right">
        <div className={'st-tile-price' + (price > 0 ? '' : ' st-muted')}>
          {price > 0 ? fmtUsd(price) : '—'}
        </div>
        <div className="st-tile-cta">TAP TO TRADE</div>
      </div>
    </button>
  );
}

export function TradeModal({ open, brand, icon, price, onClose, walletPubkey, onConnectWallet }) {
  useStocksCSS();
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
  // USD value of the brand tokens you'll receive on BUY (for sanity-check).
  const buyReceiveUsd = isBuy && price > 0 ? grossOut * price : 0;

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
      const submitRes = await fetchWithTimeout(RPC_URL, {
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

  // Brand pill only shown when wallet holds some.
  const showBrandPill = wcon && brandBal.loaded && brandBal.ui > 0;

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

          {/* Wallet balances — USDC always (it's how you pay/get paid),
              brand only when held. Both show USD value. */}
          {wcon && (
            <div className={'st-balances' + (showBrandPill ? '' : ' st-bal-one')}>
              <div className="st-bal-pill st-bal-usdc">
                <span className="st-bal-label">USDC BALANCE</span>
                <span className="st-bal-amt">
                  {usdcBal.loaded ? fmtAmt(usdcBal.ui, 2) : '...'}
                </span>
                <span className="st-bal-usd">
                  {usdcBal.loaded ? '≈ ' + fmtUsd(usdcBal.ui, 2) : ' '}
                </span>
              </div>
              {showBrandPill && (
                <div className="st-bal-pill">
                  <span className="st-bal-label">{brand.symbol} BALANCE</span>
                  <span className="st-bal-amt">{fmtAmt(brandBal.ui, 4)}</span>
                  <span className="st-bal-usd">
                    {price > 0 ? '≈ ' + fmtUsd(brandBal.ui * price, 2) : ' '}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {brand ? <StockChart mint={brand.mint} price={price} symbol={brand.symbol} /> : null}

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
              {/* USD value of brand tokens received on BUY — easy gut-check. */}
              {isBuy && outAtomic > 0 && buyReceiveUsd > 0 && (
                <div className="st-receive-usd">≈ {fmtUsd(buyReceiveUsd, 2)}</div>
              )}
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
// (Internal .st-head removed — global nexus DEX header above handles brand.)
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

  // SPARKLINE WARM-UP — kick off every tile's series on mount (parallel, throttled)
  // so the whole grid fills top-to-bottom immediately instead of each tile waiting
  // to scroll into view. stkFetchSeries dedups + caches, so the per-tile observer
  // fetch then resolves instantly from cache.
  useEffect(() => {
    BRANDS.forEach(b => { stkThrottle(() => stkFetchSeries(b.mint, '1M')).catch(() => {}); });
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'All')      return BRANDS;
    if (filter === 'Trending') return BRANDS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return BRANDS.filter(s => s.sector === filter);
  }, [filter]);

  return (
    <>
      <div className="st-page">
        <div className="st-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
        <div className="st-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
        <div className="st-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

        <div className="st-inner">
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
