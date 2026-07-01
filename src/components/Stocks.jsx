import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  VersionedTransaction, 
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  SystemProgram,
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
// CONFIG — atomic Jupiter swap: user receives the EXACT swap output, plus a
// separate 3% fee paid in SOL to FEE_WALLET in the SAME transaction (two
// instructions, one atomic tx). Jupiter's native platformFeeBps can't take the
// fee in SOL for a USDC↔stock pair, so the fee is a plain SystemProgram.transfer.
// =====================================================================
const FEE_WALLET   = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS      = 300;   // 3% platform fee, charged in SOL, additional to the swap
const USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const USDC_DECIMALS = 6;
const SLIPPAGE_BPS_MAX = 300;   // hardcoded 3% max slippage
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
    const url = `/api/jupiter/price?ids=${mints.join(',')}`;
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

// Price + 24h change in one call (Jupiter price v3 returns both). Returns
// { [mint]: { price, change } }. `change` is null when the feed omits it, so
// callers must treat it as optional. fetchBrandPrices (above) is left intact
// for any other importers that expect the price-only shape.
export async function fetchBrandQuotes(mints) {
  if (!mints.length) return {};
  try {
    const url = `/api/jupiter/price?ids=${mints.join(',')}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8_000);
    if (!res.ok) return {};
    const json = await res.json();
    const out = {};
    Object.entries(json || {}).forEach(([mint, info]) => {
      const p = Number(info?.usdPrice);
      if (!(Number.isFinite(p) && p > 0)) return;
      const rawChg = info?.priceChange24h ?? info?.priceChange ?? info?.change24h ?? info?.change;
      const c = Number(rawChg);
      out[mint] = { price: p, change: Number.isFinite(c) ? c : null };
    });
    return out;
  } catch (e) {
    console.warn('[jupiter quotes]', e?.message || e);
    return {};
  }
}
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
// SOL/USD for converting the 3% fee into a lamports transfer. Server proxy
// first (stable IP, not browser-rate-limited), Jupiter price proxy as a
// fallback. Never throws — returns 0 if unavailable so the caller can bail.
async function fetchSolUsd() {
  try {
    const r = await fetchWithTimeout('/api/sol-price', { headers: { Accept: 'application/json' } }, 6000);
    const j = await r.json();
    const p = Number(j?.price);
    if (Number.isFinite(p) && p > 0) return p;
  } catch (e) {}
  try {
    const r = await fetchWithTimeout('/api/jupiter/price?ids=' + SOL_MINT, { headers: { Accept: 'application/json' } }, 6000);
    const j = await r.json();
    const p = Number(j?.[SOL_MINT]?.usdPrice);
    if (Number.isFinite(p) && p > 0) return p;
  } catch (e) {}
  return 0;
}

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
    // xStocks are Token-2022. With shared accounts OFF, Jupiter inlines extra
    // per-user intermediate accounts; combined with our prepended fee transfer
    // that pushes the tx past Solana's 1232-byte limit, so the QUOTE succeeds
    // but the buy/sell tx fails to build/send. Jupiter's default (shared
    // accounts ON) is smaller and safe here because the xStocks transfer hook
    // is initialized-but-disabled (no per-transfer extra accounts required).
    useSharedAccounts: true,
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
// The fee is now a SOL transfer, so these SPL-ATA helpers are no longer called.
// Kept for reference / potential USDC-fee reuse.
// eslint-disable-next-line no-unused-vars
function deriveAta(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

// eslint-disable-next-line no-unused-vars
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

// eslint-disable-next-line no-unused-vars
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
// EXCHANGE BOARD — new browse UI (dark board). Scoped under .xb-* so it
// coexists with the existing st-* trade sheet styles above.
// =====================================================================
const XB_CSS = `
.xb-page{--bg:#0a0d12;--surf:#11151b;--surf2:#161b22;--line:#1f262e;--line2:#2b333d;--ink:#eaeff5;--ink2:#8e99a6;--ink3:#5a6470;--up:#34d8a0;--down:#ff6b6b;--gold:#f5b544;
  --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;--disp:'Space Grotesk',system-ui,sans-serif;--body:'Inter',system-ui,sans-serif;
  background:var(--bg);color:var(--ink);font-family:var(--body);min-height:100%;-webkit-font-smoothing:antialiased}
.xb-page *{box-sizing:border-box}
.xb-wrap{max-width:520px;margin:0 auto}
.xb-tape{overflow:hidden;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#0d1117,#0a0d12)}
.xb-tape-track{display:inline-flex;gap:26px;white-space:nowrap;padding:9px 0;animation:xb-tape 38s linear infinite;will-change:transform}
@keyframes xb-tape{to{transform:translateX(-50%)}}
.xb-tape-item{font-family:var(--mono);font-size:11px;display:inline-flex;gap:7px;align-items:center;color:var(--ink2)}
.xb-tape-item b{color:var(--ink);font-weight:600}.xb-tape-item i{font-style:normal;font-weight:600}
.xb-tape-item i.u{color:var(--up)}.xb-tape-item i.d{color:var(--down)}
@media (prefers-reduced-motion:reduce){.xb-tape-track{animation:none}}
.xb-hd{padding:18px 18px 10px;display:flex;align-items:flex-end;justify-content:space-between}
.xb-ey{font-family:var(--mono);font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-weight:600}
.xb-hd h1{font-family:var(--disp);font-size:30px;font-weight:700;letter-spacing:-.02em;margin:3px 0 0;line-height:1}
.xb-status{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--ink2);background:var(--surf);border:1px solid var(--line);border-radius:999px;padding:6px 11px}
.xb-dot{width:6px;height:6px;border-radius:50%;background:var(--up);box-shadow:0 0 9px -1px var(--up);animation:xb-pulse 2s ease-in-out infinite}
@keyframes xb-pulse{50%{opacity:.45}}
.xb-breadth{margin:6px 18px 2px;display:flex;align-items:center;gap:10px}
.xb-breadth .bar{flex:1;height:5px;border-radius:3px;background:var(--down);overflow:hidden}
.xb-breadth .bar i{display:block;height:100%;background:var(--up);border-radius:3px;transition:width .5s}
.xb-breadth .lab{font-family:var(--mono);font-size:10px;color:var(--ink2);white-space:nowrap}
.xb-breadth .lab b{color:var(--up)}.xb-breadth .lab u{color:var(--down);text-decoration:none}
.xb-seclbl{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3);font-weight:600;padding:16px 20px 9px;display:flex;justify-content:space-between}
.xb-seclbl .r{color:var(--ink3)}
.xb-movers{display:flex;gap:11px;padding:0 18px 4px;overflow-x:auto;scrollbar-width:none}.xb-movers::-webkit-scrollbar{display:none}
.xb-mv{flex:0 0 168px;color:var(--ink);background:var(--surf);border:1px solid var(--line);border-radius:16px;padding:13px;cursor:pointer;text-align:left;transition:border-color .14s,transform .14s}
.xb-mv:hover{border-color:var(--line2);transform:translateY(-2px)}
.xb-mv-top{display:flex;align-items:center;justify-content:space-between}
.xb-mv-chip{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 8px;border-radius:7px}
.xb-mv-chip.u{color:var(--up);background:color-mix(in srgb,var(--up) 14%,transparent)}
.xb-mv-chip.d{color:var(--down);background:color-mix(in srgb,var(--down) 14%,transparent)}
.xb-mv-name{color:var(--ink);font-family:var(--disp);font-size:14px;font-weight:600;margin-top:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xb-mv-spark{margin:8px 0 6px;height:40px}
.xb-mv-price{color:var(--ink);font-family:var(--mono);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.xb-tile{font-family:var(--mono);font-weight:700;font-size:11px;letter-spacing:-.01em;display:grid;place-items:center;flex:0 0 auto;overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 2px 8px rgba(0,0,0,.32)}
.xb-logo{background:#11151b;position:relative}
.xb-logo::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.09);pointer-events:none}
.xb-tile img{width:100%;height:100%;object-fit:cover;display:block}
.xb-search{margin:6px 18px 12px;display:flex;align-items:center;gap:9px;background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:11px 13px;transition:border-color .14s}
.xb-search:focus-within{border-color:var(--line2)}
.xb-search svg{width:15px;height:15px;color:var(--ink3);flex:0 0 auto}
.xb-search input{flex:1;min-width:0;background:none;border:none;outline:none;color:var(--ink);font-family:var(--body);font-size:13.5px}
.xb-search input::placeholder{color:var(--ink3)}
.xb-clear{background:none;border:none;color:var(--ink3);font-size:16px;cursor:pointer;padding:0 2px;line-height:1}
.xb-chips{display:flex;gap:7px;padding:0 18px 4px;overflow-x:auto;scrollbar-width:none}.xb-chips::-webkit-scrollbar{display:none}
.xb-chip{flex:0 0 auto;font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--ink2);background:transparent;border:1px solid var(--line);border-radius:999px;padding:8px 14px;cursor:pointer;transition:.14s}
.xb-chip:hover{color:var(--ink);border-color:var(--line2)}
.xb-chip.on{background:var(--gold);border-color:var(--gold);color:#1a1405}
.xb-board{padding:0 8px 10px}
.xb-row{width:100%;color:var(--ink);display:grid;grid-template-columns:44px 1fr 72px auto;align-items:center;gap:12px;background:none;border:none;border-bottom:1px solid var(--line);padding:11px 12px;cursor:pointer;text-align:left;transition:background .14s}
.xb-row:hover{background:var(--surf)}.xb-row:last-child{border-bottom:none}
.xb-id{min-width:0;display:flex;flex-direction:column;gap:2px}
.xb-nm{color:var(--ink);font-family:var(--disp);font-size:14px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xb-sy{font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:.02em}
.xb-num{display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:92px}
.xb-pr{color:var(--ink);font-family:var(--mono);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.xb-pr.muted{color:var(--ink3)}
.xb-chg{font-family:var(--mono);font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;font-variant-numeric:tabular-nums}
.xb-chg.u{color:var(--up);background:color-mix(in srgb,var(--up) 13%,transparent)}
.xb-chg.d{color:var(--down);background:color-mix(in srgb,var(--down) 13%,transparent)}
.xb-chg.flat{color:var(--ink3);background:var(--surf2)}
.xb-spark-wrap{height:34px;display:flex;align-items:center}
.xb-empty{font-family:var(--mono);font-size:12px;color:var(--ink3);text-align:center;padding:40px 20px}
.xb-foot{padding:18px 20px 34px;text-align:center;font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:.04em}
.xb-foot b{color:var(--gold)}
`;
function useXbCSS() {
  useEffect(() => {
    const id = 'nexus-xb-css';
    if (document.getElementById(id)) return;
    // Pull the two display/mono faces (Inter is a safe system fallback).
    const fid = 'nexus-xb-fonts';
    if (!document.getElementById(fid)) {
      const link = document.createElement('link');
      link.id = fid; link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
    const el = document.createElement('style');
    el.id = id; el.textContent = XB_CSS;
    document.head.appendChild(el);
    return () => { /* leave injected */ };
  }, []);
}

// Brand signature colors for the lettermark fallback (used only until the real
// Jupiter icon loads). { bg, fg } per ticker.
const BRAND_COLORS = {
  TSLA:['#e82127','#fff'], NVDA:['#76b900','#0c1400'], AAPL:['#d6dadd','#15171a'],
  META:['#0866ff','#fff'], GOOGL:['#4285f4','#fff'], AMZN:['#ff9900','#1a1200'],
  MSFT:['#00a4ef','#04121c'], NFLX:['#e50914','#fff'], PLTR:['#19c3d6','#04181c'],
  AVGO:['#cc092f','#fff'], COIN:['#0052ff','#fff'], MSTR:['#f7931a','#1a1100'],
  CRCL:['#1aab9b','#02140f'], HOOD:['#00c805','#03130a'], SPY:['#5b7cfa','#fff'],
  QQQ:['#9b7cff','#fff'], GLD:['#d4af37','#1a1400'], TBLL:['#7b8794','#fff'],
};
function brandColors(b){ return BRAND_COLORS[b.ticker] || ['#222a33','#eaeff5']; }

// Brand logos: real Jupiter token logos, cleaned (clover/X container removed,
// corners filled with each tile's own color) and embedded as base64 PNGs. They
// render with no network and no external hosts, so the in-app webview can't
// block them. Any ticker without an entry falls back to a monogram (BrandBadge).
const BRAND_LOGOS = {
  TSLA: "data:image/png;base64,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",
  AAPL: "data:image/png;base64,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",
  NVDA: "data:image/png;base64,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",
  META: "data:image/png;base64,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",
  GOOGL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAobElEQVR42u2deZxtV1Xnv2vvc+5Yc9WrN7+XSZIwBJJACKBtQAiKtooTBMUPkzatNtL6UWk/rXl0OzSOtPppoqI4QUtQURS1A4QwBAyCBDQEEzK8IXnv1Vy37njO2Xv1H/vcqnqVelPVreEl77zPeffWrXvrnrPXb631W2uvvbawQYeqmu7TQ4cOydvf/nYP8PhM8+Du4fLTZ+bb3qsvo7zfWlvw3vNUOowxOOcShFcZMa2RwZI5Ptv6yp6RymGAW2+91Rw6dEgBARCRDRkg2SDBWxFJl78+Od1488hI5RnTs82X7hiuXJV4MAK1WhtV5al4iAgDAyW8QsHA5Gzzq6PDlY/OzDTv2zFavW3FuMaA6zUQol7+sY9//OORiGSAn5hvf12Rokld87ZSpXQgTbLLDFAqFpmYbmTWGlQVEYl4ih6qytxcMxMRnPOUy6WrDFwVxRH1tvupdrN9JLaVN3foeBF5sDvGL37xi7NtZQFU1QIqIn56url/ZKT8vZOzzV8d6K+YLAva3Wq1VJVMBCsihovHauPoVXEiROVyWQCiSKgtNP2O4cpPzcy0PjA6WjmaW1kREbflAFDVrtYzN99+d1SMXlIt2kunZps+mDlQhYtCP38wdMcOYGy4Yhod90jWye4cGiy9aeXYbzoAVLVLTvTEiYWXFsrx64cHiq+pNTI6nSQxRgoXxdi7w3tNisVCYaAaMVvrvC9ppe/Ztav/o8vlsCYyupYP3X67WhFREdGpWuuNO3f2faRULr5mcqbpkiTxF4W/EVGDFJIk8ZMzTVcqF1+zc2ffR6ZqrTd25XD77Wo3xQKoqhUR99DRmWtGBit/B7IfvEtThzHGXhTVZlgD7+LYAsaCHp2Zb37b5ftHvtyVzYZYAFUV1VuNiLhjE/Vr9+zo/1i5XNyfZZnPMm8vCn9Tcwg2y7zNssyXy8X9e3b0f+zYRP1aEXGqt5quW+gZAFRVREQPfeB7oyTR60cGy3dkTsdqtYYTESMiF6WyBTkEETG1WsNlTsdGBst3JIlef+gD3xuJiJ4rCOQchG/uugtz1U0UBzvph4zITc22M2maaRRZeaomcbYTELLMaRxHUilZ71Xvmi/G3/7Vu+jcdBP+bImjcwFABOjUbPMTo8OVF03NNLzkx4WSbEEV7dmAh2Hbbrev+TE2UjXTs827x4Yr35jnCrI1A6BLKo4enXn2+O7he+drTWeNsRea1nvve5ZuNiKIMdvWGjjv3eBAxU4cn33O/v0jXzobMZSzCX9ion5tX3/hDqcy0OkkEVxYCR0RQVVJ0xRVv57UB9Zaoija5nMX6ovFQmZFa/WF5Obx8b4vngkEcjq/D9jJucazquXSR7z3I61W6o3prfA304x670mShCxLzxMEiiAUikXiON44N9XbpJEvl2NjjJlptNov2zFU/VdOM5EkZ2L9E1ONw4NDlQPz801nbe9M/1b5T69Ks1EnSZLuHOtZBSMiVMoViqXS5vCVXrkC593gYMXOzzWPjI9VD3ZluvK90WlIH5PTjTf09xXGGo1OaozE6724Mwl9swBhRahWqqRpSrvVCr58FYIoeRJegf6BgUXh9/o6V47p8r+/nvFWVYwR22h00oH+wtjkdOOHgT/MAZ2d1gLkwvfT083njo5W7pmrtVzm1KyX8Z/u41thCULYlDI5NUWzUeeUOapc47uaPzQ8wtDg4FktxUZp/nqVTlU1suKHBsp2err5/NHRyucDj10CQbTKAPmTU/W3tjuOLFPErP3uz0Xwywd8s444LjA2uoOTaUZtYR4ji7UJi49jO3YyNDS0Yde18vvOZBHWCgQRkSxT2h2HQ98qIq9ZVql1aiawO7V4cqp+2/ho9ZaFRseJXXt6d+XA5ZmrJwh/KyyB955iMWbnrl2USmVarVZwC50OSZIwPDzC2Njohl7Xave+2hitd3zEGrvQ6Ljx0eotJ6fqt4lI1nXziwDIUeGnpmpXV8vxzc2OS0QQ1o68M2r8aje52W7Ae6VYLLJv/wH6BwZot1s4lzG+cyc7d+3e1Os7k3KsGwSqiCDNjkuq5fjmqana1YEPB0sQLfEjSadm6t9drRQunZptddZawHG6m1jtBrY6m6aqVMplDh68BFWlXCmzd+/e7rht2vUtN/HLzf5KF9B1GWuQiWk2Ex0bLl/a7qTfLSK/kNcYelFVIyJ+YqL9tOpA8QutVrMMYjdC87eT8FdGw967LbVMKwW7/Ocz/e48v8WVy5VWo9a5fny89ICqmkVfkGW+E0X0qeLXMgbnqvnbcwpBMVuc3l1N23ttCVSRKKIvy3xnkQMcOnQIVbXFEu9JU68bcVPL/dzF49z4wEYpTJp6LZZ4j6raQ4cOBRIoIs55vULESC8EffHYWCuxnnEWMRJkHeYGRFXN1GzzzQN9xXfUm2nZe39eiZ+zhXXbAhBdc6lddqfLcmC6kg6ASv64Il8mbHhS6EzcoPv8TPzgbIkhY4zvq8StWr3zM2PDldsiEfEnJutXF2Lb530nEZEnR2lXXgcQHF0uTVGwcSilkzwIllNTwdL93xNOVciSHA0GukvYRDYdDD2wIOK9d4XY9jmnV4uIj6Zq7aurpeiF9Wbi6MFKoS3X/q7gjYHIBmF3A17vYW4OOXYMOX4EmZ6F2iy0GuBc+EyxDH0D6Mgoums3un8/jO2AOAaXg8L78H6fTy+blRajt2Z/veRvxRHVm4kbHCy9cKrWvjpSx5Wl2F43UWtn9jwzf9vK1HsfBB8ZsIVcOxN04jjm85/DfuGfkPvvgxMnkMYc0m5Cpw1pAlmaS0/ARhAXoFBAixWo9qFjO9ErrsJfdx36/K9HDxyEuBjen6XgfPi4NZulyWsGhYiYZivNxiuF6+qN7MoojmwjA2+M9PwiN1XwBQtRDGmCTD+O+fQnkA//FebfvgrzU0htEloe8aA2dwvdR1nGB7IOtNvgQZwiGSj3wWfvxH5wGB3YgV52EH/zK3AvewXs3gelCvgUEpdbBLNhAu/FYYyQgY8j25DJ2fZ3Dg0WP5gvUozWo/2bntt3HqIoCD9JkMMPY//8jzH/8EHk5HGo15AUiASNDcRRbqp1yVyfbmBFlkifaviu1COJRw1QLaFDO/H/4cX417wOd+0NSKkc3tdJgzXosVtYSQLXQQazoaFKNDffeaVMzTbaIlI8X4BtKQC8B/VQKoJX5MGvYP/oXZi//xtk8nFICdpdjMDKEplbJIZyCrk/TW5o2ZMcDCb39wokKSQ5t6gO4m56Kf6Hfgx/3Y1oqYQ0O+G7rN12AGAR19qRmfm2rqU5w5lCvg0FgHPBz5cK8NhR7Pvfi/3930EmHwuDHUcgOTlzbuOuw5hwZh5SFzS/fxR3yy24N/4oetlV4B2000BGNwAAp3vt3G/BIFOzzTUZqTNp/YYAQAiDXS6CKubuO7HvuBVzz2fBanAFsQmsP0lgswo3JbcKngCExKNXXk32E2/Df/urA1Ab7Z5YgjMJfs01AxcMALIMrRYxc/OYP3s30Tt/GWZmoRot+WmfcwJjIelsXpze9Sp5iRntDOIC7rVvxL31Z9Hd+6CVp9+tXTM4n7oAyFIYqCBHD2N/5eexf/6+MOpFC14DH1huKqIogME7Nv0QCZXzzkMjw7/kZbif/yX8dc+FThZeX+P4bAQAtn+Nv3PQV8F87X4KP/dG7If+BIYE+i3gVgif8LP3ucndgvp91QA8CwyXMHd+hOjHXof5xMd6Sgh7htdtbQFcBtUy8uC9FH7ph5Ev/HNg9plAx0MKmgUckIfgQeayZGpddqrGdVO40o3XV8Zq+c++GzX4tfMJAUwE9Q7s2kX6rvfib3oJ1NfGCTbCAmzfBk1ZBn1l5PB9FN75Q5gHP4/uKAUzanywXbkRIM3PrsX3Lhg3YwI567J2yX10koQQLv+MLA/7hBDnR0ChG0pGS5blfLlB/qjDw4EQZrqt5hC2JwC8QytlzMlHKfzhf8E8/HnYUQwhlShEshjrSxbuQqNcoBngZClcjAvBCiQpNMJndM8Yesnl6M5dMLIDqv1BI50PWcD5aczkCTjyKHLkMDQzKAHlfG7Bn6NViGOYbeOf8xyy3/oD9LrroNbZtJTxhQkAdVAoIvVJ4g/+LPbfP46ORpBkCBquONNc6BIEnoFE+d1koJmBNA/Pmm2kqfirr0Bf+I34ZzwbvfTr0D370OEdMDQMxUKwKAqkPmQQpyfh5AnM0YcwX/ky3PMp7BfvRTsJ9EfBtKs7PRCiCObb+OuvJ/vV/4Neex3Uk3xm8iIHOI3wfTDTVog/8g4KHzoUpvDTPAeQLtPyDDRdAgBJ93VBnSC1FPUWf/2LcN/8Xei1z4Urr8GP9IdrzHJhuzxa6I6C6U4ImQAyAdNI4OEHkC9/AfsPf4254x+DpSjHOWVY4RoiC7MJ/trnkP3G76LX3xByAcasy/w/+cNAn0K5gr3vwxT/7LXQqoVB67jg37MuGJYBIe1qPZBZSDwsOPSKZ5K+6sfQF7wcf8klocy16fIk0bIEjqySE16eNtY8yVQtoAbksQnsPZ/E/sltyMc/BnFu6rv8IIqg1kGf+SzS3/g99IYbod4KoLqYCDqz9muhgJl5iOJf/CD2wc8G0pRmpzL9rvYnK4DgI2gkqKngXv56slf+CHr504Npr3eWagSMLDF9PetNLgHC5X6/UoICyOFj2L94L+a2X0cmJ6FSCH+2lqDXPIfsV9+Fv/FGaCSn/q2LADgNXRYDeAp3/zLFOw/h4wjSEI5pRmDzbuk8xRI4C/UUHdxD9upDZC++Ba1UkUYSzHPUQ6rjsoCdShFxHvPJjxL9wn9D7rsXOqDXPIv0125Db3ghNNdv9p8aAPApWqoQHfsnyh/8dmhOg5dA9pTVAbBoEUzIuO28kuT7fxv/7JcFn95J8kmYDSJdmQvRSF8R+df7iH7mR2BiAvdbf4B//gtDrN9D4T95AaAhaydpi8LdP0Hx3nejUYRmfqkEKweAuhUg0AhpJbidV5He8vu4p319CBXV5bH7BmYChZAsAqgWkEcehdlZ9JprQ8ipvY/3n5wA8BlaLBOduJvq370CzRq50P2i8NXLkuCXv5Z4tO8AnVf/Ie7Kl0C7tZQA2tTUb16bgATLs0HVw0++TKAqRDGS1IkPvx+hFubzvUclF7aAeAUD2p12jQzScWjfAJ1vezvuaS8JVThiNz/LJnnauZMsZRwvoCNaj/b3AAGoibALjxA/9ldQFkQ1xOddYZtl/j9TUEFdIIfp895Eds2rkSwNb9rK/lXmwmyGHp2fwobqV+nJrJaCWMQ5osnPYtKTQftVwCi4/JRlQDCAGqSd4fY/l/TGt4AJhaBc7FS7Ntyet7tTJct6sGFFTtQkmyc+8oEQXi0mU2IktkjBQkEgVogViQWsRyolkuf/JNp/IGi/XBT+proA5xzeewqF9XSFl6DszSPYmS/lxImQ4VEJQrUWMQreLLoASRzp/ptwB74ZRYPLuLgVxeYCACBNEtR7iuXyGiLtkPgRr9iZexBt5DHzstDJ51ZGbEjkWAGbgimRXPUGtDSEZMkF63svSBewgr7RaDZp1BfWxP7VCLgW0fSnUGmh1oR5+G7ptTXhNB7ogEnBKNnuZ+N3XJ9ncdfX+fPisa4wMOTTa7UazjkGB4dCt61zKsMKVZTim0S1LyGiYT7fryjHB1DJW7kZ0JRszyvwpb2Iy3ru+7dTA9jzhXV39dD5dlxbVx6g21BxdmYa5xyjYzvOfRTFQjIBnYmlWTlzGmloyBhqMcaNPg+Ni0inFSKAHoptq1sAC0sFxt0V6ueTJOqu79g0AACIMajCxMQEWZaxc+euc7pVUcE0HkKkmZt6eaLQF58acCmu/0p8+eCyNKv2TPDWwGBRttQMLO9a0HJKx50bCLxXnMvW1IUlWv/g5Q0PvefE8cdR79m9Zy+nXxgXCKCqx7aOgKQsdq3rbnKxsn+DSFjUOfhMtDCKuN5JySlUIuHYgudX7kmI7Iat9D4HixqmFyKBlx60XLsropnoGYqIQnOrJOkgItg11BxEvUJut8nSY48/hldlz559GHP6Va1CiklOIOJQkRAB6GnMf44GV70UjYfzChzTE5Prfaj7nGgpv/bPnbDI2CzN82wqI5dQ+zJcEi4bLHLjHqjr6lVkoeVtRrPZAEL3000mgatZAoP6hKNHDqOq7Nu3H0GeSAwlJIIkncSb7AmXcYp17+YHDPjyXtQWkKy3q34Wv0qXXMKW8AEJdSfVGAYLcto1JCJCmibMz8+jqhQKxa2IAk4PAtRx5MhhAPbu3XeqX+qad/HgF5YFo0vbZOopViBHgxW00L+shttsiAnuRqFb4f8jCZnWamwYLEmoIF9F+EmSMD09SZY5yuXyVoWBZ7JlYWnU4cOPosD+fQdW8aoKkuQ5flkS9hPcQG4CLIH1Szf+txsiBA3zTZvOATQ/nULZCgNFg/O6iuannDh+nCTpUK5UtjIP0KO4p7vAQ1chf6ulrJ6Em5TpctcnQn9RGChuzq1uTB7VexA4ePAS9u3dd6rUlgvY5PX4XSCc8dR8nmDjLnvLdCB3O7EJTayNKJXoiURUVYnjmF27d1Ptq7KWvg4bCoCQjQrM5cCBg+zbt5/TbjMkFo36c9O+bBSMPFHwEl4TV8tb/MmTwhR0C4eiPOmTekV9WIDUH0sAgDwRBIVCgbGxHZTL5XX3DjK9Fr4Yy/4DB9m7d394bTVBKaAWLe5AbRx8rghqwro8Xc7GloHCpMfBdzbE/292vG/zyrXuYiS3LPIYKgrlgnQN6apkO4piBgeH8hnZtYMg6hWSu+Zo7569i4mgM6JTIny8MxRv+vTUO31CGBZgJJ1HMG4OH+0Is4U9nguIDcQ2byukvRkY55f+Vm7IFkNNv8IzqoaamLGKWexVac8QcVkbUalUSZLOmkEQ9UbzFTGGXbv3LEsF65ngAhLjSwfBxAjpUr0fPAEMi+aq/a+QTqHxeE/nAA2hBrVW92FETI/CAFXi2NCXK2nXca0GLiEsgxgsCnv6zDkWFYcu54VCCeeyrQGAeo8IjI+P55NBek4Do4AvXQ5RGdLmshU7q1FkBYkxnQeR5FGk+oxlIcM6dtfKZZ14ZawsvO76AnHeOmC98vceyrFw30zGFyYSrAhOBVGz6n0agXam7KpYLh0ypE45zYisEnULItGaSGG0PoAHmA6PjDI4OHRKNvfsH3YQjePjHRh/Mqy2PV16TgNpRDtErXvxA9+ESkwv6gGsgVYK+/uF226u9MyyeIVSQfi5z8zyiRNNBuNCSDB42yU6p1IwgSSD0TJcMSyk7vySnSKCMea8SeE6ABA0cGBggL6+/tMTvjO4AZUqrnotkn4FEV3KB+SCVwTUIhrlvMDD3Idg5FVQvAJcu2c8wCs0Uu0JAJwP2bx7T3b45PEmmCyUM3hBbQCAeIOEWndUDd0tmvb0GS4btLSdoucB75UbTWx4FCAI1UqFal//mmhwqOUr4fq/HmwFNaFKSC2otagUQGPwBu8dqVfaqrTq9+Lqn8+nhE1Pw0G7WvCxhlMFyrHhnskGn5+u0VdKcSZFbRrK2myKRinepqhJEZuSqqO/BM8Ys6H3ld+cbMeavyMuFCiWSmvUmKVVH658Q+ABFjBF8HG+AtjjnSP1jpZ66jgWKFBDqE39KepmQ2pYPdvpcEAlshxrJNxxfI6maxPZDG/ysjYJp3afmxRjU1qasLM/4wV7Da1085KeawKAtXadFcEs0mKNDuCK1yGJQidFM4dzjo5zNNWzgFDTiJra8CgFZmp3U5//SD57t32SQmG5oFKxwkcfn+OO41NUyp7UJGCC0L1J8CYBk6AmwdsEiVISOuwfUm7YHZF4XWxVvK0AEPIzQtST5dY2xPJ2ENf3SnyqpC6hrUodYZ6IeY2ZV0sNwwIRNYQFCsyp48iJ3yFJjiCmkG8Lv/VHqjAQWb463+SPH36MumtjbYY3CWpTNBc6Nv/ZBvPfIaG/5HjhHstAQTa1FuE8AWDChsu90hd1YCxZ3400410siFAjpkZEHUsdkz8unQ2NaEqFE437eOjE7wIdjIlQthYEXpVYIHXKnx1+nE9NTVIteNxiRXMQOlFuDSSAwUQZTd9hV9XxHZeV6WRPTIVsOxfQs971IqAZWryc9tD3UPOemgoLGrNAxAI2POrSGaxBgRpF7pt8Pw9N/SVGIsCcRxTS20NzRtMXRfzt8RO86+EHsbHLtTyYeW+7mp8tPsemOOlgbcrzdhd51kiZbJNLkba4S5igPsNEfZiRV9OYei+JJiTEJCgpQqJCignP88cUSKVMO2vz6WO/QRTv5fKhm+j4Tr5VqtlE4StOlaGowKenp7j1gS8z6xtU4iLeuTxSCWFfWFvpEGtQb7Di6KQwXinyg08bCulhNneB85bPqwqCekeh8nSi0VuYzzo0sNQ1pq6WOtGpp1rqallQoWX7eTyZ4O8e/Z88VLuHkikiYvH4DTehXcLnFYaiIl+sTfNT93+OBxrTlGIlk86iz9ecAOoiFwihoDPhfMGuMl+/s4/E+5BW5ykEAPI6wijqZ3DktXTifcx7n5t/ywKGBTUsqA2PWGr5Oa9KWwZ4pP0w733kv/PFmbuIJaIkMYk68lTSBhE+j4gwFBf4XO04P/qVT/G5+ccpFjxellj/kv9PFvMAahLEprS1w2gFfuSqvRgkXwy9ufVo26KyQsSSuYyBvmsY3/XDzPqMBYmpdX0/EbVl5wI5R1BLTSExgzzYPMJtj/w8Hz75fmq+yaAthq6wmvU0TMzUkaqnz8ZEYvjQ5H388L//NZ9bOEoc+5zxL/l8H4Xn2v1ZOojN8DkR/L5Lxnn+2CBJd1XPZo/9dmkTp+qJbYGFzqN87Gtv5XDtM0g0QkcdGYYUQ4LkHEBIdIkPJEQ4EeqqHGaEG0dfxlt2fyfPrjyNghHmXQenYEWwy4ZYz8HMd9/n1KNA1RQoWOHR1jR/cvJf+O0jn2bGdajaYXxaJcnTvGDCxE9+itqwyhnBEtHJlKv7hvirF7yI/aUSLe+xZxm3J3WzaBFD4toMli7lWXvewkOtr7HgWiAl2ngybE4Iw9nBkCGLoMiIeEwGeMQJD5/8W+6u3ct/2vkdfOvwC7iicoCKERrO0/LJonANYepPVmH1qorPIRKJYTAqIgJH2nPcPfUQv3f8bj459xBoCSsxbd+iaCHSMqkIhkD0lqpcAiE0Ysmco68Q87arruRAqULbuy0zxduqU6jiEQyRGO58/DY+fOw3UUokSN7cuxsNBAsQhG/wGCakwmGN8Kph6tV1gIxr+q7me8ZezAv6n87V5UvZVRjCmlCFk3iPw+PVL4aQBoMVQ4SlYENuv5YmPNQ+wb8sHOaD01/io9P30/Eea6oIFq8W1QhLRNFUyHxMqoogQes1WANDhGDopI4fv/QafuHK5wY+4T3mHMbsKbFjSNcVNLNZ3vfIL/KJqb/Bmr4cBLIIgDQHgEOoSYljWiDV7qYBklfSCE474BJ2Vfbxjf3P4Tl9V/B1pX3sK+5gRzzMoO2nZApEYsJmYN7R8E2msxonOjM80p7k3+qP8ana1/jSwuEAMNOPFYvTCFUbsprEqFosMQUpkanFLW5PF9bsWSI6nYRvHr+Cdz/zxQxFJTreEYmc25rqp8qWMR5HyRSZbD/Gbz98K/fMfYZiNEjL+0VLkGDIgLYUmPAF2nnot6KSPph5wGsKvg2q9BVGuay0h72FMUaiQfpsmaKxeBWaPmM+a3IyqfFoZ4ZjranQeNKUEalgiMNiVY1ywdswa6ndduUGQ0wsJTIVnCoGiIylnbR47tA+/uDql/O0yjBNn53V7z8lARDYdkZ/VObhxkP84kO38oWZL1EqDNA2mhNASKXAvEY0z2EuwCCLZjbTLNQh+izvPpmvwdJQf4AUw2lKGMpYCdrtFneSMIjGOQCifCvS/GeNECyGGEuBLCefnazDs/p28DtXv5QXDOxlwaenENKLAFjlcOqoRiW+Wv93fu7BX+Ke+r9RjPryzvCWtsQ0vD+vME+CZw4VNKtSryBQxaIY1IfnS4IOmn82AIDFUiCWiEbS4qr+cf73ld/EfxjaSztvfyMXAXBuIOizJR5sP8rbHn4nfz9zD+WoipEiDZ/ge94mJtfy3MTLsudLZj8KVUp0X+8CIIBBiBBiImLaLuXagT38+tfdxIsG99L06XkLfiMBsO2X2FixLLgWV5Yv4Tcvexs/sOvbSREaro0RCWVVGzK9s/LklOe6/Hey9Lmw0kcAR9u1eNnoJfzeVTfnws+2vAvJBWcBlmfg+myRuazOn07+P/7X0T9mOp1BpIwYg1ftUcZPTmMBuqa+q+1dHtC1GAWMRKganIOCFHj9nuv56YMvZHexSttleZHHxR1D1iyWTD0lWwBVPl37Mv/j6Hv4bO3ekD2QKCw3WxbTr/2b7DJ/H4Us3qK/jxZBIF1zLzH4CK/gvXBVdQ8/ffAb+K4dT6dkLHWXEW3XDSMutM2jHR6LoWpiHutM8t6pj/Gu4x/gWDIV2giYCCRCUfyaKoXycu0nAOBUHmAoYAga7z14bxmNq3zfzhv40X03cnl5BAe0XUbUo+npDdo8+sLbPt6r4vFUTAEFHmgf410nPsjfTN7JyawWdpgQizHBRCual43pKpn+01CjRU03iBZydxAjufl3vruSKWYgqvJNw8/gR/Z+A8/rP0DJ2EV/bzdgw4iebh8/Odv+zqHB4gfn5pqZiEQXAgCWIgRPbCwFiUh8ykPtx/mjib/nw9Of5EQ6S923cjDEiMTYfA2B5v9WHTwhr9ePFtk8aoOmQ+hUTkTR9jFuB/iGoWfwut0v4ob+A5RMTKqexGdYMT0vV+0VAFQ1GxqqRHPznVfK3EL6smpf9I9zs01/PgDYLiBQDYFgQSyxiUg1YSKd46Oz/8LfznySB5oPM53VmXaNfGUxoUpHwq7jZrFBgSxCAzSfyCG4AhUwFQZMP2NRP/vLu3n58HX8x7FrOVAcpiAxHk/Hhc+aDdwsohfar6rZ0HDFNOrZN0dp5qoRkfFevbW9NVebAQIRgwUS9SSuQySGXfEYrx2/me8f/yYOJ9PcU/tX7ln4N+5vHmYynWXBNWlqQtsldDTDqVvUVRFDQQqU4zJlKdFnq4xFo1xa3sfz+57GCwefzpXlnUREqAQr1DrF3G/sTiE9caFeicCkmavKVK19dbUU/VmWume3O5nIeRbUrbQCGx0NnD2CD4UVRgw2n9kTJN9tNuNEMs8j7eOcSCY4mcwz6+u0XAenGUYsRRMzaPsZLwyyKxrjYGk3+4rDlE0Bl5eAOTyOvDOnhDTzRq5OWKnt69R+XypGGsX2S4129gPR2EDp/hOT9c/sHKte1+5kCWHL5J5o/mZZgSekevN1iqlmpORTQnkJ13g8zM54FCsgLGvCKHpKo0qHBJ/vFUdKw3VCajhvXiAip5j6zRJ+L1IqfZVC4eRU4zO7dvTdH6mqmZpt3p+krm6MKXvvVUQu+BbcXSB0rYLPOy44CZAQDypnGFCVpcaBvls4ootFJBfioapqjLFJ6urWyv2qaiwg3/qKmz/3lh//mf9cqZSH0jQ9bwCczuxvtTs4BQw5IFY+X/bbxX/mNO+VTazYO53mr9MiaLlctgsL7ZPjo9XX0N1lSVWtNfI11bWtStgAM7WJ4HjiuY01eN3jrOo1yFpt8HyqRkT84483D46Olx+t1Zpe1rCy4lw1/0ngXTZNyD3WflTVDwxUzPRE65I9eyqHVXVpoV8UmWKWUT/H6qRzZqqrsdbtZyUEny/K2ErBn88Yri1kRrOMehSZxebCRkS8qsbj46UHWs3GO0aHKlaVzkbHq9sFBNZakqTD1772IMceOxpm7GRrtX4jxk2VzuhQxbaajXeMj5ceUNVYRHy0mFVVNdPTC3/ZaCZvqFQKe5vNzppcwcowsGv2V2thstUgMMbQbLU4cvhRZmemqdUirLHs3r23myvfVn5+7cJXX6kUpdFMHsH7v1RVQ+hlkffpFvGAGRsbuL/RSu+oFG1BFV2rKpzNj221G1BVjBE6nQ7Hjh5hoVajVCpjbcTEyZOcPHF8U69vtTHplfARQRWtFG2h0UrvGBsbuL9r+VlJelU1EpHs5FT9fQN9pVvqjY4Ts/YuTKcjfCtJ4mYnjELL9ZSTJ45TW5gPm111dz7JH8d27GR0dGTDrmv5951NyOsBo3p1fdWirdXb/3fnWN9rujJe5H6rfJmZnm6+s1S0t7Q7QuZ0zYmh03WuWs01bJbGdTdbmJqeopO0KZXKpzjK7jUt1Oaw1jA0OLhhpOBs977eMVFVjSKhVLQ06vLO3PQ/IQxe+aEIYGqm+Yb+vsJvNtsu9t7HvRj4tfyu14d3jrn5OdqtVuh2ok+sH+ruhqZA/8AAfdW+DbnOMwm4FwphjEkrJZsu1JP/OjZS+cP8HrIzAiD/chERnZhqHB4cqhyYn286a43tlZZuVS7Aq9Js1EmSJNz4OSzGFBEq5QrFUmlbRQNnG1/nvBscrNj5ueaR8bHqwa5MV773dPP/oqrR5FzjlVnmPlIuxyOtVuqN6U1t01qbGq5L+N6TJGFh6PntsRM2yzZpShzH21rw3cM578vl2GaZm8HqK1U1zlm/ntUFLLsoKyJuYqJ+bV9/4Q6nMtDpJFE3fXyhHF2fnqZpXha2dtBZa4miaJunu9UXi4XMitbqC8nN4+N9X+zKcvUU2JmRaUXEHT068+zx3cP3zteazpreuYLN1P5eXbMR6WGntN6D3XnvBgcqduL47HP27x/50pmEz7moQ04KdWq2+YnR4cqLpmYaXvLjQhC+5nvAac8GOQzbdrt9zY+xkaqZnm3ePTZc+caACTljH/lzgbK/6y4kG668vN1J7xzoK2KtFee8XggYkFxjTY9OEbOthJ8TPrXWykBfkXYnvTMbrrz8rrsW+/GyLgCIiL/pJtxukcY7PvTAtxiJbiiV4qlKuSDOOcfFY0sP55yrlAtSKsVTRqIb3vGhB75lt0jjpptw3WzfGeV7HiZG4JCIvN0fm6hfOzpQvENsNLaw0PR5avGiNDbbtYHv768YddnUdK1z877xvi+q3mrgkK4W8q0LACuJ4UNHZ64ZGaz8Hch+8C5NHcYYe1E0m0JqXRxbwFjQozPzzW+7fP/Il89G+NbKAVa6BHf77Wov3z/y5eGB0gGHf9NQf8n29Vet9+pUt1n/9ieX1nvv1fX1V+1Qf8k6/JuGB0oHLt8/8uXbbz9/4a/JApzqEkBE9MSJhZcWyvHrhweKr6k1MjqdJDFGChdF1kut16RYLBQGqhGztc77klb6nl27+j+6XA5rIpE9QOXi7NLcfPvdUTF6SbVoL52abfpu2BS2FhJzUYznp+2ytJ82Y8MV0+i4R7JOdufQYOlNK8d+rUcvto3L8gJDFZE3TU8391eL5e9V+NWB/orJsnAHrVZLVclEsBfBcHqhq+JEiMrlsgGIIqEWiPZPdhrJB0ZHK0fzWT1Zr/B7AoAuLwD4+Mc/Ho2OVo4CvzEx3/7bThOTutZtpUrpQBRFlw31F+KFpqPVamfWLs7BR09xoWd5LE+5XIr6K9bMLSQg+nC72T4S28qbsdaLyIPdMe6F4HvmAla5IQNYEUmXvz453XjzyEjlGdOzzZfuGK5clfi8CWOtfcGVkvcyiTMwUMIrFAxMzja/Ojpc+ejMTPO+HaPV21aMawznFttvugVYmTgC/LLiAz106JB0b+jxmeZB4On1hbb36sso77fWFnqxE/aFdBhjcM4lc/PNVxkxrZHBksmQr1iRwwC33nqrOXTo0OLOcSsVqlfH/wfCYpjPDKI6uAAAAABJRU5ErkJggg==",
  AMZN: "data:image/png;base64,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",
  MSFT: "data:image/png;base64,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",
  NFLX: "data:image/png;base64,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",
  PLTR: "data:image/png;base64,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",
  AVGO: "data:image/png;base64,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",
  COIN: "data:image/png;base64,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",
  MSTR: "data:image/png;base64,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",
  CRCL: "data:image/png;base64,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",
  HOOD: "data:image/png;base64,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",
  SPY: "data:image/png;base64,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",
  QQQ: "data:image/png;base64,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",
  GLD: "data:image/png;base64,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",
  TBLL: "data:image/png;base64,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",
};
function logoSources(brand) {
  const u = brand && BRAND_LOGOS[brand.ticker];
  return u ? [u] : [];
}
// =====================================================================
// Charts  CoinGecko (GeckoTerminal) OHLCV — the ONLY source. No DexScreener,
// Pool resolution ALWAYS enforces base-token == this mint and picks the
// highest-liquidity pool, with a seeded reduce so a thin pool still
// charts  the chart can never show the wrong asset. Self-contained and
// degrades gracefully (live-tick line when no history is indexed yet).
// =====================================================================
const STK_GT = 'https://api.geckoterminal.com/api/v2';

// base-token-match + highest USD-liquidity, seeded reduce (mirrors LaunchRadar)
function stkPickGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted  = 'solana_' + mint;                       // EXACT match — Solana base58 is case-sensitive
  const addr    = p => p?.attributes?.address;
  const baseId  = p => String(p?.relationships?.base_token?.data?.id || '');
  const quoteId = p => String(p?.relationships?.quote_token?.data?.id || '');
  const liq     = p => Number(p?.attributes?.reserve_in_usd) || 0;
  // EXACT base-token match ONLY. A pool where this mint is the QUOTE charts the
  // OTHER (base) token — the wrong contract. Never fall back to that. If no pool
  // has this mint as base, return null (no chart) rather than wrong-token data.
  // Prefer base-token-exact; else the deepest pool that holds this token, so the
  // chart loads instead of "chart not available". Token's own market either way.
  const withAddr = pools.filter(addr);
  if (!withAddr.length) return null;
  const basePools = withAddr.filter(p => baseId(p) === wanted);
  const set = basePools.length ? basePools : withAddr;
  return set.reduce((best, p) => liq(p) > liq(best) ? p : best, set[0]);
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

async function stkResolvePool(mint, poolHint) {
  // A pool address handed in by the feed wins immediately — no round-trip, so
  // the chart/sparkline have a contract-matched pool the instant the card mounts.
  if (poolHint && typeof poolHint === 'string') {
    stkPoolCache.set(mint, poolHint);
    stkLsSet(STK_POOL_LS + mint, poolHint);
    return poolHint;
  }
  if (stkPoolCache.has(mint)) return stkPoolCache.get(mint);
  const cached = stkLsGet(STK_POOL_LS + mint, STK_POOL_TTL);
  if (cached !== undefined) { stkPoolCache.set(mint, cached); return cached; }
  let pool = null;
  // Server-side pool resolution first (reliable), then direct GeckoTerminal.
  pool = await stkServerPool(mint);
  if (!pool) {
    const gj = await stkFetchJson(`${STK_GT}/networks/solana/tokens/${encodeURIComponent(mint)}/pools`);
    const gp = stkPickGeckoPool(gj?.data, mint);
    if (gp) pool = gp.attributes.address;
  }
  stkPoolCache.set(mint, pool);
  stkLsSet(STK_POOL_LS + mint, pool);
  return pool;
}

// Defensive OHLCV parser — accepts every shape a candles endpoint might return
// (array of [ts,o,h,l,c,v], array of {c|close|price}, or wrapped in
// {candles|ohlcv|ohlcv_list|bars|prices|data}). Returns [{t,c}] sorted oldest→newest.
function stkPtsFromAny(data) {
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

// Server-proxied candles — same CoinGecko (GeckoTerminal) data the iframe chart
// shows, but fetched server-to-server so it is NOT rate-limited or CORS-blocked
// the way a per-row browser call to api.geckoterminal.com is. This is why the
// row sparklines were flat: the direct calls were getting 429'd.
async function stkServerCandles(mint /* tf ignored: always the 1-hour window */) {
  // 1) Our bundled endpoint — closes already 1h, oldest→newest.
  const nx = await stkFetchJson('/api/nx/chart/' + encodeURIComponent(mint), 7000);
  if (nx && Array.isArray(nx.closes) && nx.closes.length >= 2) {
    return nx.closes.map((c, i) => ({ t: i, c: Number(c) })).filter(p => p.c > 0);
  }
  // 2) Existing server route — tf=5m is 60×1-min candles = the last 1 hour.
  const j = await stkFetchJson('/api/dex/candles/' + encodeURIComponent(mint) + '?tf=5m', 7000);
  return stkPtsFromAny(j);
}

// Real OHLCV — server proxy first (reliable), direct GeckoTerminal as a last
// resort. Never throws; returns pts | null.
async function stkGeckoSeries(mint, tf, poolHint) {
  const viaServer = await stkServerCandles(mint, tf).catch(() => null);
  if (viaServer) return viaServer;
  const pool = await stkResolvePool(mint, poolHint);
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


const stkSeriesInflight = new Map(); // key -> Promise (dedup concurrent fetches of same series)
export async function stkFetchSeries(mint, tf, poolHint) {
  const key = mint + '|' + tf;
  if (stkSeriesCache.has(key)) return stkSeriesCache.get(key);
  const cached = stkLsGet(STK_SERIES_LS + key, STK_SERIES_TTL);
  if (cached !== undefined) { stkSeriesCache.set(key, cached); return cached; }
  if (stkSeriesInflight.has(key)) return stkSeriesInflight.get(key);

  const inflightP = (async () => {
    const save = (out) => { stkSeriesCache.set(key, out); stkLsSet(STK_SERIES_LS + key, out); return out; };

    // CoinGecko (GeckoTerminal) real OHLCV — the only source. Contract-matched
    // pool, real candles, or nothing. No synthetic series, no DexScreener.
    const gecko = await stkGeckoSeries(mint, tf, poolHint).catch(() => null);
    return save(gecko);
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

// Two REAL endpoints from the token's own live price + real 24h change:
// price(24h ago) = price / (1 + change/100), then price now. Both are numbers
// the feed already reports — not synthetic — so a sparkline drawn from them is
// directionally accurate and always agrees with the displayed % and the chart.
// Guarantees a line the instant a price exists, before OHLCV is fetched.
export function stkEndpointSeries(price, change) {
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

// ── Embedded chart (trade sheet) ──────────────────────────────────────
// Switched from a hand-drawn SVG to the provider's live embedded chart —
// CoinGecko (GeckoTerminal) only — reusing the same base-token
// pool resolution as the sparklines so it can never show the wrong asset.
// Defaults to the 1D (24-hour) view. Resolution per timeframe mirrors the
// page's own STK_TF_PARAMS so 1H/1D/1W/1M/1Y feel the same as before.
// (GeckoTerminal honors `resolution`. If a pool
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
  // 1) Server-side pool resolution (reliable, not browser-rate-limited).
  let res = null;
  const sAddr = await stkServerPool(mint);
  if (sAddr) res = { provider: 'GECKOTERMINAL', addr: sAddr };
  // 2) Direct GeckoTerminal (last resort).
  if (!res) {
    const gj = await stkFetchJson(`${STK_GT}/networks/solana/tokens/${encodeURIComponent(mint)}/pools`, 6000);
    const gp = stkPickGeckoPool(gj?.data, mint);
    if (gp?.attributes?.address) res = { provider: 'GECKOTERMINAL', addr: gp.attributes.address };
  }
  stkEmbedPoolCache.set(mint, res);
  stkLsSet(STK_EMBED_LS + mint, res);
  return res;
}

// Resolve a pool address from our server (server-to-server, never browser-
// rate-limited): /api/nx/pool first, then the existing /api/ape/curve. Both
// return a GeckoTerminal pool address for the chart embed.
async function stkServerPool(mint) {
  try {
    const a = await stkFetchJson('/api/nx/pool/' + encodeURIComponent(mint), 6000);
    if (a && typeof a.pool === 'string' && a.pool) return a.pool;
  } catch (e) {}
  // /api/ape/curve intentionally NOT used — it isn't base-token-strict and could
  // resolve the wrong contract. Caller falls back to the base-EXACT picker.
  return null;
}

// (legacy) Resolve a pool address from the server's /api/dex/token proxy (server-to-
// server, never rate-limited/CORS-blocked like a direct browser call). Picks
// the base-token-matched, deepest-liquidity pool. Defensive across shapes.
function stkPoolFromTokenApi(d, mint) {
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
    const pool = arr.reduce((b, p) => (liqOf(p) > liqOf(b) ? p : b), arr[0]);
    return addrOf(pool);
  }
  return null;
}
function stkBuildEmbedSrc(pool, tfKey) {
  if (!pool) return null;
  const r = STK_EMBED_RES.find(x => x.key === tfKey) || STK_EMBED_RES[1];
  if (pool.provider !== 'GECKOTERMINAL') return null;
  return `https://www.geckoterminal.com/solana/pools/${pool.addr}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&bg_color=ffffff&resolution=${r.gecko}`;
}

function StockChart({ mint, price, symbol }) {
  const [tf, setTf]         = useState(STK_EMBED_DEFAULT); // '1W' = 1 week
  const [pool, setPool]     = useState(null);              // { provider, addr }
  const [status, setStatus] = useState('loading');         // loading | ok | none | fail
  const [nativePts, setNativePts] = useState(null);        // real closes fallback
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);

  // Reset views each time a different stock opens.
  useEffect(() => { setTf(STK_EMBED_DEFAULT); }, [mint]);
  useEffect(() => { setNativePts(null); }, [mint]);

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

  // Native OHLCV fallback: if no embed pool resolves, draw a REAL chart from the
  // token's own candle closes (/api/dex/candles via stkFetchSeries) so a chart
  // still shows. Also re-fetches when the timeframe changes in fallback mode.
  useEffect(() => {
    if (status !== 'none' && status !== 'fail') return;
    let stop = false;
    (async () => {
      const s = await stkFetchSeries(mint, tf).catch(() => null);
      if (!stop && s && s.length >= 2) setNativePts(s);
    })();
    return () => { stop = true; };
  }, [status, mint, tf]);

  const src = useMemo(() => stkBuildEmbedSrc(pool, tf), [pool, tf]);
  const nativeBuilt = (nativePts && nativePts.length >= 2) ? stkBuildPath(nativePts, 1000, 400, 6) : null;
  const nativeUp = (nativePts && nativePts.length >= 2)
    ? nativePts[nativePts.length - 1].c >= nativePts[0].c : true;
  const nativeCol = nativeUp ? '#34d8a0' : '#ff6b6b';
  const chartShown = (status === 'ok' && src) || !!nativeBuilt;
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
        <span className="st-chart-prov">{status === 'ok' ? 'GECKOTERMINAL' : (nativeBuilt ? 'LIVE OHLCV' : 'CHART')}</span>
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
      ) : nativeBuilt ? (
        <div className="st-chart-embed" style={{ background: '#0a0b0e' }}>
          <svg viewBox="0 0 1000 400" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
            <path d={nativeBuilt.area} fill={nativeUp ? 'rgba(52,216,160,0.14)' : 'rgba(255,107,107,0.14)'} />
            <path d={nativeBuilt.line} fill="none" stroke={nativeCol} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      ) : status === 'loading' ? (
        <div className="st-chart-embed st-chart-sk">
          <span className="st-chart-sk-gl" style={{ top: '25%' }} />
          <span className="st-chart-sk-gl" style={{ top: '50%' }} />
          <span className="st-chart-sk-gl" style={{ top: '75%' }} />
          <svg className="st-chart-sk-svg" viewBox="0 0 300 150" preserveAspectRatio="none"><path d="M0 95 L40 88 L80 100 L120 82 L160 92 L200 70 L240 86 L300 64" /></svg>
        </div>
      ) : status === 'none' ? (
        <div className="st-chart-embed st-chart-state">Live chart unavailable right now.</div>
      ) : (
        <div className="st-chart-embed st-chart-state">Couldn’t load the chart. Try again shortly.</div>
      )}
      <div className="st-chart-tfs">
        {STK_TFS.map(t => (
          <button key={t} className={'st-chart-tf' + (t === tf ? ' on' : '')} disabled={!chartShown} onClick={() => setTf(t)}>{t}</button>
        ))}
        <span className="st-chart-tfmeta">{status === 'ok' ? '● Live · ' + tf : (nativeBuilt ? '● ' + tf : 'Live')}</span>
      </div>
    </div>
  );
}

// Fast sparkline. Draws an instant line from the live price + 24h change the
// moment it mounts (stkEndpointSeries), so the board is never blank. When the
// row scrolls near view it upgrades to real OHLCV in place (throttled, cached,
// deduped). Never shows a skeleton or a flat blank.
function StockSparkline({ mint, price, change, w = 72, h = 34, sw = 1.6, color }) {
  const [pts, setPts] = useState(null);
  const ref = useRef(null);
  const doneRef = useRef(false);
  const gidRef = useRef('xb-sp-' + Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!mint || !ref.current || typeof IntersectionObserver === 'undefined') {
      // No IO support → just fetch once.
      if (mint && !doneRef.current) {
        doneRef.current = true;
        stkThrottle(() => stkFetchSeries(mint, '1M')).then(s => { if (s && s.length >= 2) setPts(s); }).catch(() => {});
      }
      return;
    }
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !doneRef.current) {
          doneRef.current = true;
          io.disconnect();
          stkThrottle(() => stkFetchSeries(mint, '1M')).then(s => { if (s && s.length >= 2) setPts(s); }).catch(() => {});
        }
      });
    }, { rootMargin: '220px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mint]);

  // Real OHLCV once loaded; otherwise the instant endpoint line from price+change.
  const series = (pts && pts.length >= 2) ? pts
               : (stkEndpointSeries(price, change) || null);
  const built  = series ? stkBuildPath(series, w, h, 2) : null;
  // Direction: prefer the real 24h change; fall back to the series' own slope.
  const up = Number.isFinite(change) ? change >= 0
           : (series ? series[series.length - 1].c >= series[0].c : true);
  const col = color || (up ? '#34d8a0' : '#ff6b6b');
  const gid = gidRef.current + (up ? 'u' : 'd');

  return (
    <div className="xb-spark-wrap" ref={ref}>
      {built ? (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={w} height={h} style={{ display: 'block' }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={col} stopOpacity="0.22" />
              <stop offset="1" stopColor={col} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={built.area} fill={`url(#${gid})`} />
          <path d={built.line} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={built.lastX.toFixed(1)} cy={built.lastY.toFixed(1)} r={sw + 0.3} fill={col} />
        </svg>
      ) : null}
    </div>
  );
}

function BrandBadge({ brand, size = 44 }) {
  const radius = Math.round(size * 0.29);
  const [bg, fg] = brandColors(brand);
  const label = (brand.ticker || brand.symbol || '?').slice(0, 4).toUpperCase();
  // Embedded SVG logo if we have one, else a brand-color monogram. The logo is a
  // self-contained app icon (own background + rounding) so it renders full-bleed.
  const sources = logoSources(brand);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [brand.mint]);

  const src = sources[idx];
  if (src) {
    return (
      <span className="xb-tile xb-logo" style={{ width: size, height: size, borderRadius: radius }}>
        <img src={src} alt={brand.name || ''} loading="lazy" onError={() => setIdx(i => i + 1)} />
      </span>
    );
  }
  return (
    <span
      className="xb-tile"
      style={{ width: size, height: size, borderRadius: radius, background: bg, color: fg, fontSize: Math.round(size * 0.25) }}
    >{label}</span>
  );
}

function BrandRow({ brand, price, change, onClick }) {
  const hasChg = Number.isFinite(change);
  const up = hasChg ? change >= 0 : true;
  return (
    <button className="xb-row" onClick={onClick}>
      <BrandBadge brand={brand} size={44} />
      <span className="xb-id">
        <span className="xb-nm">{brand.name}</span>
        <span className="xb-sy">{brand.symbol} · {brand.sector}</span>
      </span>
      <StockSparkline mint={brand.mint} price={price} change={change} w={72} h={34} />
      <span className="xb-num">
        <span className={'xb-pr' + (price > 0 ? '' : ' muted')}>{price > 0 ? fmtUsd(price) : '—'}</span>
        <span className={'xb-chg ' + (hasChg ? (up ? 'u' : 'd') : 'flat')}>
          {hasChg ? <>{up ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</> : '—'}
        </span>
      </span>
    </button>
  );
}

function MoverCard({ brand, price, change, onClick }) {
  const up = change >= 0;
  return (
    <button className="xb-mv" onClick={onClick}>
      <div className="xb-mv-top">
        <BrandBadge brand={brand} size={34} />
        <span className={'xb-mv-chip ' + (up ? 'u' : 'd')}>{up ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>
      </div>
      <div className="xb-mv-name">{brand.name}</div>
      <div className="xb-mv-spark"><StockSparkline mint={brand.mint} price={price} change={change} w={150} h={40} sw={1.8} /></div>
      <div className="xb-mv-price">{price > 0 ? fmtUsd(price) : '—'}</div>
    </button>
  );
}

export function TradeModal({ open, brand, price, onClose, walletPubkey, onConnectWallet }) {
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
          // Swap the FULL USDC amount so the user receives the exact quoted
          // stock. The 3% fee is a separate SOL transfer in the same tx.
          atomic = Math.round(n * 10 ** USDC_DECIMALS);
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
  // Fee is a separate SOL transfer, so the user receives the EXACT swap output
  // on both buy and sell — the displayed amount is the full quote.
  const platformFeeUsd = usd * feeBpsRatio;   // fee value in USD (charged in SOL)
  const outAmount   = grossOut;
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
      const owner = new PublicKey(walletPubkey);

      // 3% platform fee, charged in SOL (additional — the user still receives
      // the exact swap output). Convert the trade's USD value to lamports at the
      // live SOL price, fetched fresh here so the fee is current at sign time.
      const solUsdNow = await fetchSolUsd();
      if (!(solUsdNow > 0)) throw new Error('Couldn’t fetch SOL price for the fee — try again');
      const feeUsd      = usd * (FEE_BPS / 10000);
      const feeLamports = Math.round((feeUsd / solUsdNow) * 1e9);
      if (feeLamports <= 0) throw new Error('Amount too small');

      // Two instructions, one atomic tx: the Jupiter swap + the SOL fee transfer
      // to FEE_WALLET. Both land together or not at all.
      const feeIxs = [
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey:   FEE_WALLET,
          lamports:   feeLamports,
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
            <BrandBadge brand={brand} size={48}/>
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
                    ['Fee (3%)', '≈ ' + fmtUsd(platformFeeUsd) + ' in SOL'],
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
  useXbCSS();

  const [filter, setFilter] = useState('All');
  const [query,  setQuery]  = useState('');
  const [quotes, setQuotes] = useState({});   // mint -> { price, change }
  const [active, setActive] = useState(null);

  const { publicKey: solPk } = useWallet();
  const walletPubkey = useMemo(() => solPk ? solPk.toString() : null, [solPk]);

  // QUOTES (price + 24h change) — poll every 30s.
  useEffect(() => {
    let alive = true;
    const mints = BRANDS.map(s => s.mint);
    const tick = async () => {
      const result = await fetchBrandQuotes(mints);
      if (!alive) return;
      if (Object.keys(result).length) setQuotes(result);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Logos are embedded SVG data URIs (see BRAND_LOGOS) — no fetch needed.

  // SPARKLINE WARM-UP — kick off every series on mount (parallel, throttled,
  // cached + deduped) so real OHLCV is ready by the time a row scrolls in.
  useEffect(() => {
    BRANDS.forEach(b => { stkThrottle(() => stkFetchSeries(b.mint, '1M')).catch(() => {}); });
  }, []);

  const priceOf  = (m) => quotes[m]?.price ?? 0;
  const changeOf = (m) => quotes[m]?.change;

  const filtered = useMemo(() => {
    const base = filter === 'All' ? BRANDS
      : filter === 'Trending' ? BRANDS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker))
      : BRANDS.filter(s => s.sector === filter);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(s => (s.name + ' ' + s.ticker + ' ' + s.symbol).toLowerCase().includes(q));
  }, [filter, query]);

  const movers = useMemo(() => BRANDS
    .filter(b => Number.isFinite(quotes[b.mint]?.change))
    .sort((a, b) => Math.abs(quotes[b.mint].change) - Math.abs(quotes[a.mint].change))
    .slice(0, 5), [quotes]);

  const searching = query.trim().length > 0;
  const hasQuotes = Object.keys(quotes).length > 0;

  return (
    <>
      <div className="xb-page">
        <div className="xb-wrap">

          {/* ticker tape */}
          {hasQuotes && (
            <div className="xb-tape">
              <div className="xb-tape-track">
                {[...BRANDS, ...BRANDS].map((b, i) => {
                  const c = quotes[b.mint]?.change;
                  return (
                    <span className="xb-tape-item" key={b.mint + i}>
                      <b>{b.ticker}</b>
                      {Number.isFinite(c) ? <i className={c >= 0 ? 'u' : 'd'}>{(c >= 0 ? '+' : '') + c.toFixed(2)}%</i> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* header */}
          <div className="xb-hd">
            <div>
              <div className="xb-ey">Tokenized · Solana</div>
              <h1>Exchange</h1>
            </div>
            <div className="xb-status"><span className="xb-dot" />OPEN 24/7</div>
          </div>

          {/* top movers */}
          {!searching && movers.length >= 3 && (
            <>
              <div className="xb-seclbl"><span>Top movers</span><span className="r">24h</span></div>
              <div className="xb-movers">
                {movers.map(b => (
                  <MoverCard key={b.mint} brand={b} price={priceOf(b.mint)} change={changeOf(b.mint)} onClick={() => setActive(b)} />
                ))}
              </div>
            </>
          )}

          {/* search */}
          <div className="xb-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or ticker"
              aria-label="Search stocks"
            />
            {searching && <button className="xb-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </div>

          {/* sector filters (hidden while searching) */}
          {!searching && (
            <div className="xb-chips">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={'xb-chip' + (filter === f.id ? ' on' : '')}>{f.label}</button>
              ))}
            </div>
          )}

          {/* board */}
          <div className="xb-seclbl">
            <span>{searching ? 'Results' : 'Market board'}</span>
            <span className="r">{filtered.length} listed · live</span>
          </div>
          <div className="xb-board">
            {filtered.length === 0 ? (
              <div className="xb-empty">No stocks match "{query}".</div>
            ) : filtered.map(s => (
              <BrandRow
                key={s.mint}
                brand={s}
                price={priceOf(s.mint)}
                change={changeOf(s.mint)}
                onClick={() => setActive(s)}
              />
            ))}
          </div>

          <div className="xb-foot">Routed on-chain via <b>Jupiter</b> · your keys, your coins</div>
        </div>
      </div>

      <TradeModal
        open={!!active}
        brand={active}
       
        price={active ? priceOf(active.mint) : 0}
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
