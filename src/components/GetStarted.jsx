// src/components/GetStarted.jsx — combined Wallet + Get Started page.
//  
// Wonderland palette (pink/mint/lavender/peach pastel on cream gradient).
// Renders inside the dark Nexus app shell; brings its own background.
// 
// THREE STATES — same component, branches on wallet connection + SOL balance:
//
//   1) Disconnected → "Get Started"
//        Hero pitch · live xStock prices · wallet install rows · MoonPay
//   2) Connected + low SOL → "Wallet"
//        Balance card · stats · URGENT MoonPay · holdings
//   3) Connected + funded → "Wallet"
//        Balance card · stats · holdings · mini MoonPay link
//
// DATA
//   • Portfolio: one batched JSON-RPC via /api/solana-rpc (server routes to
//     dRPC; DRPC_RPC_URL env var — no fallbacks) + parallel Jupiter meta
//     (/api/jupiter/tokens/search) + Jupiter prices (direct lite-api.jup.ag,
//     CSP-permitted).
//   • xStock prices: one call to /api/jupiter/price (server proxy) on mount.
//   • Manual refresh only. No polling.
//   • SOL always shows. Other tokens need ≥ MIN_TOKEN_VALUE_USD ($1).
//
// PROPS
//   onConnectWallet   — opens the WalletModal (passed from App.js)
//   onSwitchTab(tab)  — navigates to another tab; used by xStock cards →
//                       'markets'. Optional; cards become non-clickable
//                       links if not provided.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNexusWallet } from '../WalletContext.js';
import { useWallet } from '@solana/wallet-adapter-react';

// =====================================================================
// INLINE CSS — Wonderland palette · Instrument Serif + Space Grotesk
// =====================================================================
const WP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

.wp-root{
 --ink:#0a0a0a; --ink-2:#6b6b6b; --ink-3:#9a9a9a;
 --pink:#e0364f; --mint:#16a34a; --lav:#0a0a0a; --peach:#e8820c;
 --sky:#2f6bff; --gold:#a67200; --green:#16a34a; --red:#e0364f;
 --glass:#ffffff; --glass-strong:#fafafa;
 --border:#e4e4e7; --hairline:#efeff1;

 position:relative;min-height:100dvh;min-height:100dvh;
 padding:0 0 40px;overflow-x:hidden;
 color:var(--ink);
 font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
 background:#ffffff;
 border-radius:0;
}
.wp-root,.wp-root *{box-sizing:border-box}

@keyframes wpDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes wpPulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes wpRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes wpSpin{to{transform:rotate(360deg)}}
@keyframes wpShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}

.wp-blob{display:none !important}

.wp-inner{
 max-width:520px;margin:0 auto;position:relative;z-index:5;
 padding:0;
}

/* HEADER */
.wp-head{
 display:flex;align-items:center;justify-content:space-between;
 padding:16px 18px 4px;
}
.wp-head-brand{display:flex;align-items:center;gap:9px}
.wp-head-dot{
 width:26px;height:26px;border-radius:8px;
 background:#0a0a0a;
 box-shadow:none;
}
.wp-head-text{font-family:inherit;font-style:normal;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.wp-head-text .slash{opacity:0.3;margin:0 4px;font-style:normal;font-weight:500}
.wp-head-text .grad{
 background:none;
 -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink-2);font-weight:700;
}

/* HERO — flattened; only the Connect button remains */
.wp-hero{padding:12px 18px 4px;text-align:left;position:relative;z-index:2}
.wp-hero-eyebrow{display:none}
.wp-hero h1{display:none}
.wp-hero h1 .shim{font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.wp-hero-sub{display:none}
.wp-hero-connect{
 display:inline-flex;align-items:center;gap:8px;
 background:var(--glass-strong);backdrop-filter:none;
 border:1px solid var(--border);border-radius:999px;
 padding:10px 16px;cursor:pointer;color:var(--ink);
 font-family:inherit;font-size:12px;font-weight:700;
 transition:all .15s;
}
.wp-hero-connect:hover{
 background:#f0f0f1;border-color:var(--ink);
 box-shadow:none;
}

/* SECTION HEAD */
.wp-section{
 display:flex;justify-content:space-between;align-items:center;
 padding:22px 18px 12px;position:relative;z-index:2;
}
.wp-section-title{
 font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;
 background:none;
 -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink);
 display:flex;align-items:center;gap:10px;
}
.wp-section-title .num{
 font-family:ui-monospace,Menlo,monospace;font-style:normal;font-size:13px;font-weight:700;
 background:none;
 -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink-3);
 letter-spacing:0;
}
.wp-section-meta{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.4px}

/* XSTOCKS GRID */
.wp-xs-grid{
 display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
 padding:0 18px;position:relative;z-index:2;
}
.wp-xs-card{
 padding:14px;border-radius:16px;
 background:#fff;backdrop-filter:none;
 border:1px solid var(--hairline);
 display:flex;flex-direction:column;gap:10px;
 cursor:pointer;transition:all .15s;text-align:left;
 font-family:inherit;color:inherit;
 box-shadow:0 1px 2px rgba(10,10,10,.04);
 animation:wpRise .4s cubic-bezier(.2,.8,.2,1) backwards;
}
.wp-xs-card[disabled]{cursor:default}
.wp-xs-card:not([disabled]):hover{
 transform:translateY(-1px);
 box-shadow:0 4px 12px rgba(10,10,10,.08);
 border-color:var(--border);
}
.wp-xs-head{display:flex;align-items:center;gap:10px}
.wp-xs-logo{
 width:38px;height:38px;border-radius:11px;
 display:grid;place-items:center;flex-shrink:0;
 font-family:inherit;font-weight:800;font-size:15px;
}
.wp-xs-logo.aapl{background:var(--fill,#f5f5f6);color:#0a0a0a}
.wp-xs-logo.tsla{background:#0a0a0a;color:#fff}
.wp-xs-logo.nvda{background:var(--fill,#f5f5f6);color:#0a0a0a}
.wp-xs-logo.msft{background:#0a0a0a;color:#fff}
.wp-xs-logo.googl{background:var(--fill,#f5f5f6);color:#0a0a0a}
.wp-xs-logo.amzn{background:var(--fill,#f5f5f6);color:#0a0a0a}
.wp-xs-info{flex:1;min-width:0}
.wp-xs-tick{font-family:inherit;font-size:16px;font-weight:700;line-height:1;letter-spacing:-.01em}
.wp-xs-name{font-size:10px;color:var(--ink-2);font-weight:500;margin-top:3px;letter-spacing:0.1px}
.wp-xs-foot{display:flex;justify-content:space-between;align-items:baseline}
.wp-xs-price{
 font-family:ui-monospace,Menlo,monospace;font-size:18px;font-weight:700;line-height:1;color:var(--ink);
 font-variant-numeric:tabular-nums;
}
.wp-xs-price.loading{color:var(--ink-3);font-size:12px;font-family:inherit;font-weight:500}
.wp-xs-tag{
 font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;letter-spacing:0.6px;color:var(--ink-2);
 background:var(--fill,#f5f5f6);border:1px solid var(--border);padding:3px 7px;border-radius:6px;
}

/* WALLET INSTALL LIST */
.wp-list{
 background:#fff;backdrop-filter:none;
 border:1px solid var(--hairline);border-radius:16px;overflow:hidden;
 margin:0 18px;
}
.wp-row{
 padding:14px 16px;display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;
 border-bottom:1px solid var(--hairline);
 text-decoration:none;color:inherit;
 transition:background .15s;
}
.wp-row:last-child{border-bottom:none}
.wp-row:hover{background:var(--fill-2,#fafafa)}
.wp-w-logo{
 width:42px;height:42px;border-radius:12px;flex-shrink:0;
 display:grid;place-items:center;
 font-family:inherit;font-size:18px;font-weight:800;color:#fff;
}
.wp-w-logo.phantom{background:#0a0a0a;box-shadow:none}
.wp-w-logo.backpack{background:#0a0a0a;box-shadow:none}
.wp-w-logo.solflare{background:#0a0a0a;color:#fff;box-shadow:none}
.wp-w-mid{min-width:0}
.wp-w-name{font-family:inherit;font-size:16px;font-weight:700;line-height:1.1;letter-spacing:-.01em}
.wp-w-sub{font-size:11px;color:var(--ink-2);margin-top:3px;font-weight:500}
.wp-w-cta{
 display:inline-flex;align-items:center;gap:5px;
 font-size:10px;font-weight:700;color:var(--ink);
 background:var(--glass-strong);border:1px solid var(--border);
 padding:7px 12px;border-radius:999px;letter-spacing:0.4px;
 flex-shrink:0;transition:all .15s;
}
.wp-row:hover .wp-w-cta{background:#0a0a0a;border-color:#0a0a0a;color:#fff}

/* MOONPAY */
.wp-moonpay{
 display:flex;align-items:center;gap:12px;
 margin:0 18px;padding:16px 18px;border-radius:16px;
 background:#0a0a0a;
 border:1px solid #0a0a0a;
 text-decoration:none;color:#fff;font-family:inherit;
 box-shadow:none;
 transition:transform .15s,opacity .15s;
 position:relative;overflow:hidden;
}
.wp-moonpay::before{display:none}
.wp-moonpay:hover{transform:translateY(-1px);opacity:.95}
.wp-moonpay.urgent{background:#0a0a0a;box-shadow:0 0 0 1px var(--green)}
.wp-moonpay-logo{
 width:40px;height:40px;border-radius:50%;background:#fff;
 display:grid;place-items:center;flex-shrink:0;
 box-shadow:none;position:relative;z-index:2;
}
.wp-moonpay-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;position:relative;z-index:2}
.wp-moonpay-title{font-family:inherit;font-size:16px;font-weight:700;line-height:1;color:#fff}
.wp-moonpay-sub{font-size:11px;font-weight:500;color:rgba(255,255,255,.7);margin-top:4px;letter-spacing:0.2px}
.wp-moonpay-arrow{font-size:18px;color:#fff;flex-shrink:0;font-weight:700;position:relative;z-index:2}

.wp-moonpay-mini{
 display:flex;align-items:center;justify-content:center;gap:9px;
 margin:18px 18px 0;padding:12px 16px;border-radius:12px;
 background:var(--glass-strong);border:1px solid var(--border);
 text-decoration:none;color:var(--ink);font-family:inherit;
 transition:all .15s;
}
.wp-moonpay-mini:hover{background:#f0f0f1;border-color:var(--ink)}
.wp-moonpay-mini-text{font-size:12px;font-weight:600;letter-spacing:0.1px}

/* BALANCE CARD (connected) */
.wp-balance-card{
 margin:14px 18px 0;padding:22px 20px;border-radius:18px;
 background:#0a0a0a;
 border:1px solid #0a0a0a;backdrop-filter:none;
 position:relative;overflow:hidden;
 box-shadow:none;
 animation:wpRise .5s cubic-bezier(.2,.8,.2,1) backwards;
}
.wp-balance-card::before{display:none}
.wp-bal-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;position:relative;z-index:2}
.wp-status-pill{
 display:inline-flex;align-items:center;gap:7px;
 background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
 padding:5px 11px;border-radius:999px;
}
.wp-status-dot{width:6px;height:6px;border-radius:50%;background:#16ff8a;box-shadow:none;animation:wpPulse 1.8s ease-in-out infinite}
.wp-status-text{color:#fff;font-size:9px;font-weight:700;letter-spacing:0.8px}
.wp-refresh{
 width:34px;height:34px;border-radius:50%;
 background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
 display:grid;place-items:center;cursor:pointer;color:rgba(255,255,255,.8);
 transition:all .15s;
}
.wp-refresh:hover{background:rgba(255,255,255,.2);color:#fff;border-color:rgba(255,255,255,.3)}
.wp-refresh:disabled{cursor:wait;opacity:.6}
.wp-refresh.spinning svg{animation:wpSpin 1s linear infinite}
.wp-bal-label{font-size:10px;color:rgba(255,255,255,.6);font-weight:700;letter-spacing:1px;margin-bottom:6px;position:relative;z-index:2}
.wp-bal-value{
 font-family:ui-monospace,Menlo,monospace;font-size:48px;font-weight:700;
 line-height:0.95;letter-spacing:-.03em;color:#fff;
 margin-bottom:18px;font-variant-numeric:tabular-nums;
 position:relative;z-index:2;
}
.wp-addr-card{
 background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
 border-radius:12px;padding:10px 14px;cursor:pointer;width:100%;
 display:flex;align-items:center;gap:10px;
 color:#fff;font-family:inherit;
 transition:border-color .15s;position:relative;z-index:2;
}
.wp-addr-card:hover{border-color:rgba(255,255,255,.3)}
.wp-addr-ring{width:28px;height:28px;border-radius:50%;flex-shrink:0;padding:2px;background:#fff;animation:none}
.wp-addr-ring-inner{width:100%;height:100%;border-radius:50%;background:#0a0a0a;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff}
.wp-addr-info{flex:1;text-align:left;min-width:0}
.wp-addr-label{font-size:9px;color:rgba(255,255,255,.6);font-weight:700;letter-spacing:0.8px}
.wp-addr-val{font-family:ui-monospace,monospace;font-size:12px;color:#fff;font-weight:600;margin-top:2px}
.wp-copy{
 font-size:9px;font-weight:700;color:#0a0a0a;
 background:#fff;border:1px solid #fff;padding:6px 11px;border-radius:8px;
 letter-spacing:0.6px;flex-shrink:0;transition:all .15s;
}
.wp-copy.copied{background:var(--green);border-color:var(--green);color:#fff}

/* STATS ORBS */
.wp-orbs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:14px 18px 4px;position:relative;z-index:2}
.wp-orb{
 position:relative;padding:14px 10px 12px;border-radius:14px;
 background:#fff;backdrop-filter:none;
 border:1px solid var(--hairline);text-align:center;
 box-shadow:0 1px 2px rgba(10,10,10,.04);
 animation:wpRise .5s cubic-bezier(.2,.8,.2,1) backwards;
}
.wp-orb-label{font-size:9px;color:var(--ink-2);letter-spacing:0.8px;text-transform:uppercase;font-weight:700}
.wp-orb-val{font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;line-height:1;margin-top:6px;font-variant-numeric:tabular-nums}
.wp-orb-val.sol{background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.wp-orb-val.mint{color:var(--green)}
.wp-orb-val.gold{background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.wp-orb-sub{font-size:9px;color:var(--ink-3);font-weight:600;margin-top:4px;letter-spacing:0.2px}

/* HOLDINGS LIST */
.wp-holdings-head{display:flex;justify-content:space-between;align-items:center;padding:22px 18px 10px;position:relative;z-index:2}
.wp-h-label{
 font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;
 background:none;
 -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink);
}
.wp-h-meta{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.4px}
.wp-h-row{
 padding:14px 16px;display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:center;
 border-bottom:1px solid var(--hairline);
}
.wp-h-row:last-child{border-bottom:none}
.wp-h-badge{
 width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;
 font-family:inherit;font-size:15px;font-weight:800;color:#fff;
 background:#0a0a0a;object-fit:cover;
}
.wp-h-badge-img{width:38px;height:38px;border-radius:50%;flex-shrink:0;object-fit:cover;background:var(--fill,#f5f5f6)}
.wp-h-mid{min-width:0}
.wp-h-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wp-h-sym{font-family:inherit;font-size:16px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.wp-h-tag{
 font-family:ui-monospace,Menlo,monospace;font-size:8px;font-weight:700;color:var(--ink-2);
 background:var(--fill,#f5f5f6);border:1px solid var(--border);
 padding:2px 6px;border-radius:5px;letter-spacing:0.4px;
}
.wp-h-price{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);font-weight:600;font-variant-numeric:tabular-nums}
.wp-h-sub{font-size:11px;color:var(--ink-2);margin-top:2px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.wp-h-right{text-align:right}
.wp-h-value{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}

/* LOADING */
.wp-loading{margin:14px 18px 0;padding:60px 22px;border-radius:16px;text-align:center;background:#fff;backdrop-filter:none;border:1px solid var(--hairline)}
.wp-loading-spinner{width:32px;height:32px;border-radius:50%;margin:0 auto 14px;border:2.5px solid var(--border);border-top-color:var(--ink);animation:wpSpin .8s linear infinite}
.wp-loading-text{font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:0.8px;text-transform:uppercase}

/* ERROR */
.wp-error{margin:14px 18px 0;padding:14px 16px;border-radius:12px;background:rgba(224,54,79,.08);border:1px solid rgba(224,54,79,.3);color:var(--red);font-size:12px;font-weight:600}

/* EMPTY */
.wp-empty{padding:24px 18px;text-align:center}
.wp-empty-title{color:var(--ink-2);font-size:13px;font-weight:600;margin-bottom:4px}
.wp-empty-sub{color:var(--ink-3);font-size:11px;font-weight:500}

/* FOOTER */
.wp-foot{
 display:flex;align-items:center;justify-content:center;gap:9px;
 margin:24px 18px 0;padding:14px 16px;border-radius:12px;
 background:var(--glass-strong);border:1px solid var(--hairline);backdrop-filter:none;
}
.wp-foot-label{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.3px}
.wp-foot-name{
 font-family:inherit;font-style:normal;font-size:13px;font-weight:700;
 background:none;
 -webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink);
}
.wp-foot-sep{color:var(--ink-3);font-size:10px}
`;

function useWpCSS() {
 useEffect(() => {
   const id = 'nexus-wp-css';
   if (document.getElementById(id)) return;
   const el = document.createElement('style');
   el.id = id;
   el.textContent = WP_CSS;
   document.head.appendChild(el);
 }, []);
}

// =====================================================================
// CONSTANTS
// =====================================================================
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const SPL_LEGACY_PROGRAM    = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Token must be worth at least this much to render. SOL always shows.
const MIN_TOKEN_VALUE_USD = 1;

// Below this SOL balance the page shows the URGENT "you need SOL" MoonPay.
// Roughly enough for ~5 swaps + ATA rent buffer.
const LOW_SOL_THRESHOLD = 0.05;

const MOONPAY_BUY_BASE = 'https://buy.moonpay.com/?defaultCurrencyCode=sol';

// 6 most recognizable xStocks for the Get Started teaser
const XSTOCKS_FEATURED = [
 { mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', tick: 'AAPL',  name: 'Apple Inc.',  tile: 'aapl'  },
 { mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', tick: 'TSLA',  name: 'Tesla',       tile: 'tsla'  },
 { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', tick: 'NVDA',  name: 'NVIDIA',      tile: 'nvda'  },
 { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', tick: 'MSFT',  name: 'Microsoft',   tile: 'msft'  },
 { mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', tick: 'GOOGL', name: 'Alphabet',    tile: 'googl' },
 { mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', tick: 'AMZN',  name: 'Amazon',      tile: 'amzn'  },
];

// Brand tokens (Backed Finance xStocks) — used to tag holdings.
const BRAND_TOKENS = {
 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol: 'TSLAx',  name: 'Tesla',                isBrand: true },
 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol: 'AAPLx',  name: 'Apple',                isBrand: true },
 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol: 'NVDAx',  name: 'NVIDIA',               isBrand: true },
 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { symbol: 'METAx',  name: 'Meta Platforms',       isBrand: true },
 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { symbol: 'GOOGLx', name: 'Alphabet',             isBrand: true },
 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { symbol: 'AMZNx',  name: 'Amazon',               isBrand: true },
 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { symbol: 'MSFTx',  name: 'Microsoft',            isBrand: true },
 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { symbol: 'NFLXx',  name: 'Netflix',              isBrand: true },
 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { symbol: 'PLTRx',  name: 'Palantir',             isBrand: true },
 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { symbol: 'AVGOx',  name: 'Broadcom',             isBrand: true },
 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { symbol: 'COINx',  name: 'Coinbase',             isBrand: true },
 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { symbol: 'MSTRx',  name: 'MicroStrategy',        isBrand: true },
 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { symbol: 'CRCLx',  name: 'Circle',               isBrand: true },
 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { symbol: 'HOODx',  name: 'Robinhood',            isBrand: true },
 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol: 'SPYx',   name: 'S&P 500 Index',        isBrand: true },
 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol: 'QQQx',   name: 'Nasdaq 100 Index',     isBrand: true },
 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol: 'GLDx',   name: 'Gold',                 isBrand: true },
 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { symbol: 'TBLLx',  name: 'Short-Term Treasury',  isBrand: true },
};

const CORE_TOKENS = {
 [SOL_MINT]:    { symbol: 'SOL',  name: 'Solana' },
 [USDC_SOLANA]: { symbol: 'USDC', name: 'USD Coin',   isStable: true },
 [USDT_SOLANA]: { symbol: 'USDT', name: 'Tether USD', isStable: true },
};

// =====================================================================
// UTILS
// =====================================================================
function fmtUsd(n, d = 2) {
 if (n == null || !Number.isFinite(Number(n))) return '$0.00';
 n = Number(n);
 if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
 if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
 if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
 if (n >= 1)    return '$' + n.toFixed(d);
 if (n > 0)     return '$' + n.toFixed(4);
 return '$0.00';
}
function fmtTokenAmt(n) {
 if (n == null || !Number.isFinite(Number(n))) return '0';
 n = Number(n);
 if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
 if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
 if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
 if (n >= 1)    return n.toFixed(4);
 if (n > 0)     return n.toFixed(6);
 return '0';
}
function shortAddr(s) {
 if (!s || typeof s !== 'string') return '';
 if (s.length <= 14) return s;
 return s.slice(0, 6) + '…' + s.slice(-4);
}
async function copyText(text) {
 try {
   if (navigator.clipboard?.writeText) {
     await navigator.clipboard.writeText(text);
     return true;
   }
   const ta = document.createElement('textarea');
   ta.value = text;
   ta.style.position = 'fixed';
   ta.style.left = '-9999px';
   document.body.appendChild(ta);
   ta.select();
   document.execCommand('copy');
   document.body.removeChild(ta);
   return true;
 } catch { return false; }
}
function colorFromMint(mint) {
 const seed = mint || '?';
 const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
 return `hsl(${hue}, 70%, 65%)`;
}

function getCoreMeta(mint) {
 if (BRAND_TOKENS[mint]) return BRAND_TOKENS[mint];
 if (CORE_TOKENS[mint])  return CORE_TOKENS[mint];
 return null;
}
function buildFallbackMeta(mint) {
 return {
   symbol: (mint || '').slice(0, 4) + '…',
   name:   'SPL Token',
   color:  colorFromMint(mint),
   icon:   null,
 };
}

// =====================================================================
// PORTFOLIO FETCH — single batched RPC + parallel meta + prices
// =====================================================================
async function fetchPortfolio(addressStr) {
 // Batched JSON-RPC — SOL balance + both SPL programs in one call.
 const rpcBatch = [
   { jsonrpc: '2.0', id: 1, method: 'getBalance',
     params: [addressStr] },
   { jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
     params: [addressStr, { programId: SPL_LEGACY_PROGRAM },    { encoding: 'jsonParsed' }] },
   { jsonrpc: '2.0', id: 3, method: 'getTokenAccountsByOwner',
     params: [addressStr, { programId: SPL_TOKEN2022_PROGRAM }, { encoding: 'jsonParsed' }] },
 ];

 const rpcResp = await fetch('/api/solana-rpc', {
   method:  'POST',
   headers: { 'Content-Type': 'application/json' },
   body:    JSON.stringify(rpcBatch),
 });
 if (!rpcResp.ok) throw new Error('RPC HTTP ' + rpcResp.status);
 const rpcJson = await rpcResp.json();
 if (!Array.isArray(rpcJson)) throw new Error('RPC: expected batch array');

 // Match responses by id — Solana RPC may reorder batch items.
 const byId = {};
 for (const item of rpcJson) {
   if (item && item.id != null) byId[item.id] = item;
 }

 // getBalance → { result: { context, value: lamports } }
 const lamports = Number(byId[1]?.result?.value || 0);

 // getTokenAccountsByOwner → { result: { context, value: [...] } }
 const legacyAccounts  = byId[2]?.result?.value || [];
 const token22Accounts = byId[3]?.result?.value || [];
 const allAccounts     = legacyAccounts.concat(token22Accounts);

 // Aggregate by mint (a wallet can have multiple accounts per mint).
 const byMint = {};
 for (const acc of allAccounts) {
   try {
     const info = acc.account.data.parsed.info;
     const ta   = info.tokenAmount || {};
     const ui   = Number(ta.uiAmountString || ta.uiAmount || 0);
     const mint = info.mint;
     if (!mint || !Number.isFinite(ui) || ui <= 0) continue;
     if (!byMint[mint]) {
       byMint[mint] = {
         mint,
         uiAmount: 0,
         decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6,
       };
     }
     byMint[mint].uiAmount += ui;
   } catch {}
 }

 const tokenMints = Object.keys(byMint).filter(m => m !== SOL_MINT);

 // Parallel: token meta + token prices (price call includes SOL).
 const [metaMap, priceMap] = await Promise.all([
   fetchMetaBatched(tokenMints),
   fetchPricesBatched([SOL_MINT, ...tokenMints]),
 ]);

 // Enrich, threshold-filter, sort.
 const enriched = Object.values(byMint).map(h => {
   const core    = getCoreMeta(h.mint);
   const fetched = metaMap[h.mint];
   const meta    = core || fetched || buildFallbackMeta(h.mint);
   const price   = meta.isStable ? 1 : (priceMap[h.mint] || 0);
   return { ...h, meta, price, value: h.uiAmount * price };
 });

 const filtered = enriched
   .filter(h => h.mint !== SOL_MINT)
   .filter(h => h.value >= MIN_TOKEN_VALUE_USD);

 filtered.sort((a, b) => {
   const rank = m => m.isStable ? 0 : m.isBrand ? 1 : 2;
   const ra = rank(a.meta);
   const rb = rank(b.meta);
   if (ra !== rb) return ra - rb;
   return b.value - a.value;
 });

 return {
   solBalance:  lamports / 1e9,
   solPriceUsd: priceMap[SOL_MINT] || 0,
   tokens:      filtered,
 };
}

async function fetchMetaBatched(mints) {
 const out = {};
 if (!mints.length) return out;
 const chunks = [];
 for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
 const results = await Promise.all(chunks.map(async (chunk) => {
   try {
     const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(chunk.join(','))}`);
     if (!r.ok) return [];
     const data = await r.json();
     return Array.isArray(data) ? data : (data?.tokens || []);
   } catch { return []; }
 }));
 for (const list of results) {
   for (const t of list) {
     const m = t.id || t.address || t.mint;
     if (!m) continue;
     out[m] = {
       symbol:   t.symbol || (m.slice(0, 4) + '…'),
       name:     t.name   || 'SPL Token',
       icon:     t.icon || t.logoURI || null,
       decimals: Number.isFinite(t.decimals) ? t.decimals : 6,
       color:    colorFromMint(m),
     };
   }
 }
 return out;
}

async function fetchPricesBatched(mints) {
 const out = {};
 if (!mints.length) return out;
 const chunks = [];
 for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
 const results = await Promise.all(chunks.map(async (chunk) => {
   try {
     const r = await fetch(`/api/jupiter/price?ids=${chunk.join(',')}`);
     if (!r.ok) return {};
     return await r.json();
   } catch { return {}; }
 }));
 for (const j of results) {
   for (const [m, info] of Object.entries(j || {})) {
     const p = Number(info?.usdPrice);
     if (Number.isFinite(p) && p > 0) out[m] = p;
   }
 }
 return out;
}

async function fetchXStockPrices() {
 const mints = XSTOCKS_FEATURED.map(s => s.mint);
 try {
   const r = await fetch(`/api/jupiter/price?ids=${mints.join(',')}`);
   if (!r.ok) return {};
   const data = await r.json();
   const out = {};
   for (const [m, info] of Object.entries(data || {})) {
     const p = Number(info?.usdPrice);
     if (Number.isFinite(p) && p > 0) out[m] = p;
   }
   return out;
 } catch { return {}; }
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function HoldingRow({ token }) {
 const meta    = token.meta || buildFallbackMeta(token.mint);
 const val     = token.value || 0;
 const isBrand = !!meta.isBrand;
 const [iconErrored, setIconErrored] = useState(false);
 const showImg = meta.icon && !iconErrored;
 const letter  = ((meta.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
 const bgColor = meta.color || colorFromMint(token.mint);

 return (
   <div className="wp-h-row">
     {showImg ? (
       <img
         src={meta.icon}
         alt={meta.symbol || ''}
         className="wp-h-badge-img"
         onError={() => setIconErrored(true)}
       />
     ) : (
       <div
         className="wp-h-badge"
         style={{
           background: `linear-gradient(135deg, ${bgColor}, ${bgColor}cc)`,
           boxShadow: `0 4px 12px ${bgColor}33`,
         }}
       >{letter}</div>
     )}
     <div className="wp-h-mid">
       <div className="wp-h-head">
         <span className="wp-h-sym">{meta.symbol}</span>
         {isBrand && (<span className="wp-h-tag">xSTOCK</span>)}
         <span className="wp-h-price">{token.price > 0 ? fmtUsd(token.price) : '—'}</span>
       </div>
       <div className="wp-h-sub">
         {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {meta.name}
       </div>
     </div>
     <div className="wp-h-right">
       <div className="wp-h-value">{val > 0 ? fmtUsd(val) : '—'}</div>
     </div>
   </div>
 );
}

function WalletInstallRow({ url, name, sub, tileClass, letter }) {
 return (
   <a href={url} target="_blank" rel="noopener noreferrer" className="wp-row">
     <div className={'wp-w-logo ' + tileClass}>{letter}</div>
     <div className="wp-w-mid">
       <div className="wp-w-name">{name}</div>
       <div className="wp-w-sub">{sub}</div>
     </div>
     <span className="wp-w-cta">INSTALL ↗</span>
   </a>
 );
}

function XStockCard({ stock, price, onClick, delay }) {
 const display = Number.isFinite(price) && price > 0
   ? '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 })
   : null;
 return (
   <button
     type="button"
     className="wp-xs-card"
     onClick={onClick}
     disabled={!onClick}
     style={{ animationDelay: delay + 's' }}
   >
     <div className="wp-xs-head">
       <div className={'wp-xs-logo ' + stock.tile}></div>
       <div className="wp-xs-info">
         <div className="wp-xs-tick">{stock.tick}</div>
         <div className="wp-xs-name">{stock.name}</div>
       </div>
     </div>
     <div className="wp-xs-foot">
       <div className={'wp-xs-price' + (display ? '' : ' loading')}>
         {display || (price === null ? '—' : 'loading…')}
       </div>
       <span className="wp-xs-tag">xSTOCK</span>
     </div>
   </button>
 );
}

function MoonPayLogo() {
 return (
   <span className="wp-moonpay-logo" aria-hidden="true">
     <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
       <circle cx="16" cy="16" r="16" fill="#7D00FE"/>
       <path
         d="M9.6 22V10h3.1l3.3 5.6L19.3 10h3.1v12h-2.9v-7.6l-2.7 4.5h-1.6l-2.7-4.5V22H9.6Z"
         fill="#fff"
       />
     </svg>
   </span>
 );
}

function MoonPayBlock({ walletAddress, urgent }) {
 const url = walletAddress
   ? `${MOONPAY_BUY_BASE}&walletAddress=${encodeURIComponent(walletAddress)}`
   : MOONPAY_BUY_BASE;
 return (
   <a
     href={url}
     target="_blank"
     rel="noopener noreferrer"
     className={'wp-moonpay' + (urgent ? ' urgent' : '')}
   >
     <MoonPayLogo/>
     <span className="wp-moonpay-text">
       <span className="wp-moonpay-title">
         {urgent ? 'You need SOL to trade' : 'Buy Solana with USD'}
       </span>
       <span className="wp-moonpay-sub">
         {urgent ? 'Buy with card · Apple Pay · Bank' : 'Powered by MoonPay'}
       </span>
     </span>
     <span className="wp-moonpay-arrow">↗</span>
   </a>
 );
}

function MoonPayMini({ walletAddress }) {
 const url = walletAddress
   ? `${MOONPAY_BUY_BASE}&walletAddress=${encodeURIComponent(walletAddress)}`
   : MOONPAY_BUY_BASE;
 return (
   <a href={url} target="_blank" rel="noopener noreferrer" className="wp-moonpay-mini">
     <span className="wp-moonpay-mini-text">Need more SOL? Buy with card ↗</span>
   </a>
 );
}

// =====================================================================
// MAIN
// =====================================================================
export default function GetStarted({ onConnectWallet, onSwitchTab }) {
 useWpCSS();

 // Wallet identity: the adapter (useWallet) is the source of truth — it's the
 // canonical connection used across the app. The Nexus context is a fallback.
 // Keying only off useNexusWallet meant that when the adapter was connected but
 // that context lagged/returned empty, this page showed the disconnected screen
 // and never loaded the balance. Adapter-first fixes that.
 const { isConnected: nexusConnected, walletAddress: nexusAddr } = useNexusWallet();
 const { publicKey, connected } = useWallet();
 const walletAddress = publicKey ? publicKey.toBase58() : (nexusAddr || null);
 const isConnected   = connected || nexusConnected || !!publicKey;

 // Portfolio state (connected view)
 const [portfolio, setPortfolio]   = useState(null);
 const [loading, setLoading]       = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError]           = useState('');
 const [copied, setCopied]         = useState(false);
 const inFlightRef = useRef(false);

 // xStock prices (Get Started view)
 const [xStockPrices, setXStockPrices] = useState({});

 const loadPortfolio = useCallback(async (isInitial) => {
   if (!walletAddress) { setLoading(false); return; }
   if (inFlightRef.current) return;
   inFlightRef.current = true;
   if (!isInitial) setRefreshing(true);
   setError('');
   try {
     const result = await fetchPortfolio(walletAddress);
     setPortfolio(result);
   } catch (e) {
     console.warn('[GetStarted] portfolio failed', e);
     setError('Failed to load wallet');
   } finally {
     inFlightRef.current = false;
     setLoading(false);
     setRefreshing(false);
   }
 }, [walletAddress]);

 // Fetch portfolio on connect / address change. No polling.
 useEffect(() => {
   if (!walletAddress) {
     setLoading(false);
     setPortfolio(null);
     return;
   }
   setLoading(true);
   setPortfolio(null);
   loadPortfolio(true);
 }, [walletAddress, loadPortfolio]);

 // Fetch xStock prices when disconnected. One-shot, on mount.
 useEffect(() => {
   if (isConnected) return;
   let cancelled = false;
   fetchXStockPrices().then(p => { if (!cancelled) setXStockPrices(p); });
   return () => { cancelled = true; };
 }, [isConnected]);

 const handleRefresh = useCallback(() => loadPortfolio(false), [loadPortfolio]);

 const handleCopyAddr = useCallback(async () => {
   if (!walletAddress) return;
   if (await copyText(walletAddress)) {
     setCopied(true);
     setTimeout(() => setCopied(false), 1600);
   }
 }, [walletAddress]);

 const goToMarkets = useMemo(
   () => (onSwitchTab ? () => onSwitchTab('markets') : null),
   [onSwitchTab],
 );

 // ===================================================================
 // DISCONNECTED — GET STARTED
 // ===================================================================
 if (!isConnected) {
   return (
     <div className="wp-root">
       <div className="wp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
       <div className="wp-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
       <div className="wp-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

       <div className="wp-inner">
         <div className="wp-head">
           <div className="wp-head-brand">
             <div className="wp-head-dot"/>
             <span className="wp-head-text">
               wallet<span className="slash">//</span><span className="grad">get started</span>
             </span>
           </div>
         </div>

         <div className="wp-hero">
           <button type="button" onClick={() => onConnectWallet?.()} className="wp-hero-connect">
             Already have a wallet? Connect
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
               <polyline points="9 18 15 12 9 6"/>
             </svg>
           </button>
         </div>

         {/* xStocks live showcase */}
         <div className="wp-section">
           <div className="wp-section-title"><span className="num">i</span>stocks on-chain · live</div>
           <div className="wp-section-meta">JUPITER</div>
         </div>
         <div className="wp-xs-grid">
           {XSTOCKS_FEATURED.map((stock, i) => (
             <XStockCard
               key={stock.mint}
               stock={stock}
               price={xStockPrices[stock.mint]}
               onClick={goToMarkets}
               delay={i * 0.05}
             />
           ))}
         </div>

         {/* Step 01 — install */}
         <div className="wp-section">
           <div className="wp-section-title"><span className="num">01</span>get a wallet</div>
           <div className="wp-section-meta">FREE · 60 SECONDS</div>
         </div>
         <div className="wp-list">
           <WalletInstallRow
             url="https://phantom.app"
             name="Phantom"
             sub="Most popular · iOS, Android, browser"
             tileClass="phantom"
             letter="P"
           />
           <WalletInstallRow
             url="https://backpack.app"
             name="Backpack"
             sub="Built for xNFTs · all-in-one"
             tileClass="backpack"
             letter="B"
           />
           <WalletInstallRow
             url="https://solflare.com"
             name="Solflare"
             sub="Native Solana · staking built-in"
             tileClass="solflare"
             letter="S"
           />
         </div>

         {/* Step 02 — buy SOL */}
         <div className="wp-section">
           <div className="wp-section-title"><span className="num">02</span>buy sol</div>
           <div className="wp-section-meta">CARD · APPLE PAY · BANK</div>
         </div>
         <MoonPayBlock walletAddress={null} urgent={false}/>

         <div className="wp-foot">
           <span className="wp-foot-label">powered by</span>
           <span className="wp-foot-name">jupiter</span>
           <span className="wp-foot-sep">·</span>
           <span className="wp-foot-label">non-custodial</span>
         </div>
       </div>
     </div>
   );
 }

 // ===================================================================
 // CONNECTED — LOADING (one-shot reveal)
 // ===================================================================
 if (loading && !portfolio) {
   return (
     <div className="wp-root">
       <div className="wp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
       <div className="wp-inner">
         <div className="wp-head">
           <div className="wp-head-brand">
             <div className="wp-head-dot"/>
             <span className="wp-head-text">wallet</span>
           </div>
         </div>
         <div className="wp-loading">
           <div className="wp-loading-spinner"/>
           <div className="wp-loading-text">Loading wallet</div>
         </div>
       </div>
     </div>
   );
 }

 // ===================================================================
 // CONNECTED — READY
 // ===================================================================
 const solBalance  = portfolio?.solBalance  || 0;
 const solPriceUsd = portfolio?.solPriceUsd || 0;
 const tokens      = portfolio?.tokens      || [];

 const solValue    = solBalance * solPriceUsd;
 const tokensTotal = tokens.reduce((s, h) => s + (h.value || 0), 0);
 const totalValue  = solValue + tokensTotal;
 const tokenCount  = tokens.length + (solBalance > 0 ? 1 : 0);
 const brandsCount = tokens.filter(t => t.meta.isBrand).length;
 const lowSol      = solBalance < LOW_SOL_THRESHOLD;

 const solHolding = {
   mint:     SOL_MINT,
   meta:     { symbol: 'SOL', name: 'Solana', color: '#B794F6' },
   price:    solPriceUsd,
   value:    solValue,
   uiAmount: solBalance,
 };

 return (
   <div className="wp-root">
     <div className="wp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
     <div className="wp-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
     <div className="wp-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

     <div className="wp-inner">
       <div className="wp-head">
         <div className="wp-head-brand">
           <div className="wp-head-dot"/>
           <span className="wp-head-text">wallet</span>
         </div>
       </div>

       <div className="wp-balance-card">
         <div className="wp-bal-top">
           <div className="wp-status-pill">
             <span className="wp-status-dot"/>
             <span className="wp-status-text">SOLANA · MAINNET</span>
           </div>
           <button
             type="button"
             onClick={handleRefresh}
             disabled={refreshing}
             className={'wp-refresh' + (refreshing ? ' spinning' : '')}
             aria-label="Refresh"
           >
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
               <polyline points="23 4 23 10 17 10"/>
               <polyline points="1 20 1 14 7 14"/>
               <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
             </svg>
           </button>
         </div>
         <div className="wp-bal-label">PORTFOLIO VALUE</div>
         <div className="wp-bal-value">{fmtUsd(totalValue)}</div>
         <button type="button" onClick={handleCopyAddr} className="wp-addr-card">
           <div className="wp-addr-ring"><div className="wp-addr-ring-inner">S</div></div>
           <div className="wp-addr-info">
             <div className="wp-addr-label">WALLET</div>
             <div className="wp-addr-val">{shortAddr(walletAddress)}</div>
           </div>
           <span className={'wp-copy' + (copied ? ' copied' : '')}>
             {copied ? 'COPIED' : 'COPY'}
           </span>
         </button>
       </div>

       <div className="wp-orbs">
         <div className="wp-orb">
           <div className="wp-orb-label">SOL</div>
           <div className="wp-orb-val sol">{solBalance.toFixed(3)}</div>
           <div className="wp-orb-sub">{solValue > 0 ? fmtUsd(solValue) : '—'}</div>
         </div>
         <div className="wp-orb">
           <div className="wp-orb-label">HOLDINGS</div>
           <div className="wp-orb-val mint">{tokenCount}</div>
           <div className="wp-orb-sub">{tokenCount === 1 ? 'asset' : 'assets'}</div>
         </div>
         <div className="wp-orb">
           <div className="wp-orb-label">xSTOCKS</div>
           <div className="wp-orb-val gold">{brandsCount}</div>
           <div className="wp-orb-sub">{brandsCount === 1 ? 'stock' : 'stocks'}</div>
         </div>
       </div>

       {/* Urgent MoonPay shows above holdings when SOL is low */}
       {lowSol && (
         <>
           <div style={{ height: 14 }}/>
           <MoonPayBlock walletAddress={walletAddress} urgent={true}/>
         </>
       )}

       {error && (<div className="wp-error">{error}</div>)}

       <div className="wp-holdings-head">
         <div className="wp-h-label">holdings</div>
         <div className="wp-h-meta">JUPITER PRICES</div>
       </div>

       <div className="wp-list">
         <HoldingRow token={solHolding}/>
         {tokens.length === 0 ? (
           <div className="wp-empty">
             <div className="wp-empty-title">No other holdings yet.</div>
             <div className="wp-empty-sub">Tokens under ${MIN_TOKEN_VALUE_USD} are hidden.</div>
           </div>
         ) : tokens.map(t => (<HoldingRow key={t.mint} token={t}/>))}
       </div>

       {/* Funded users: mini MoonPay link at the bottom */}
       {!lowSol && (<MoonPayMini walletAddress={walletAddress}/>)}

       <div className="wp-foot">
         <span className="wp-foot-label">powered by</span>
         <span className="wp-foot-name">jupiter</span>
         <span className="wp-foot-sep">·</span>
         <span className="wp-foot-label">non-custodial</span>
       </div>
     </div>
   </div>
 );
}
