// src/components/Holdings.jsx — wallet holdings page with per-token drawer.
// 
// THREE INDEPENDENT DRAWERS, one per route, each a verbatim port of its
// working reference file:
// 
//   JupiterDrawer → MemeWonderland.jsx TradeSheet
//   XstockDrawer  → Stocks.jsx TradeModal
//   PumpfunDrawer → LaunchRadar.jsx TradeModal + executeSwap
//
// Holdings picks which drawer to mount based on getTokenRoute(token).
// SOL row uses JupiterDrawer with mode forced to 'sell' → USDC.
//
// PUMP.FUN ROUTING: at portfolio-load we ask DexScreener which DEX each
// token lives on. Anything on `pumpfun` or `pumpswap` gets `meta.isPump`
// and routes to PumpfunDrawer. Mint-suffix is kept only as a fallback for
// cases where DexScreener is unreachable or hasn't indexed the token yet.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
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
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// INLINE CSS — Wonderland palette
// =====================================================================
const HP_CSS = `
\u0040import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.hp-root{
  --ink:#0a0a0a; --ink-2:#6b6b6b; --ink-3:#9a9a9a;
  --pink:#e0364f; --mint:#16a34a; --lav:#0a0a0a; --peach:#e8820c;
  --sky:#2f6bff; --gold:#a67200; --cyan:#2f6bff;
  --green:#16a34a; --red:#e0364f;
  --glass:#ffffff; --glass-strong:#fafafa;
  --border:#e4e4e7;
  --border-hi:#0a0a0a;
  --hairline:#efeff1;

  position:relative;min-height:100dvh;min-height:100dvh;
  padding:0 0 40px;overflow-x:hidden;
  color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  background:#ffffff;
  border-radius:0;
}
.hp-root,.hp-root *{box-sizing:border-box}

@keyframes hpDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes hpPulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes hpRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes hpSpin{to{transform:rotate(360deg)}}
@keyframes hpShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes hpSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes hpFade{from{opacity:0}to{opacity:1}}

.hp-blob{display:none !important}

.hp-inner{max-width:520px;margin:0 auto;position:relative;z-index:5;padding:0}

.hp-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid var(--hairline)}
.hp-head-brand{display:flex;align-items:center;gap:9px}
.hp-head-dot{width:26px;height:26px;border-radius:8px;background:#0a0a0a;box-shadow:none}
.hp-head-text{font-family:inherit;font-style:normal;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.hp-head-text .slash{opacity:0.3;margin:0 4px;font-style:normal;font-weight:500}
.hp-head-text .grad{background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink-2);font-weight:700}

/* HERO — flattened; only Connect button remains */
.hp-hero{padding:12px 18px 4px;text-align:left;position:relative;z-index:2}
.hp-hero-eyebrow{display:none}
.hp-hero h1{display:none}
.hp-hero h1 .shim{font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.hp-hero-sub{display:none}
.hp-connect-btn{display:inline-flex;align-items:center;gap:8px;background:#0a0a0a;border:none;border-radius:999px;padding:13px 22px;cursor:pointer;color:#fff;font-family:inherit;font-style:normal;font-size:15px;font-weight:700;letter-spacing:-.01em;box-shadow:none;transition:opacity .15s,transform .15s}
.hp-connect-btn:hover{opacity:.9}
.hp-connect-btn:active{transform:translateY(1px)}

.hp-balance-card{margin:12px 16px 0;padding:22px 20px;border-radius:18px;background:#0a0a0a;border:1px solid #0a0a0a;backdrop-filter:none;position:relative;overflow:hidden;box-shadow:none;animation:hpRise .5s cubic-bezier(.2,.8,.2,1) backwards}
.hp-balance-card::before{display:none}
.hp-bal-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;position:relative;z-index:2}
.hp-status-pill{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);padding:5px 11px;border-radius:999px}
.hp-status-dot{width:6px;height:6px;border-radius:50%;background:#16ff8a;box-shadow:none;animation:hpPulse 1.8s ease-in-out infinite}
.hp-status-text{color:#fff;font-size:9px;font-weight:700;letter-spacing:0.8px}
.hp-refresh{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);display:grid;place-items:center;cursor:pointer;color:rgba(255,255,255,.8);transition:all .15s}
.hp-refresh:hover{background:rgba(255,255,255,.2);color:#fff;border-color:rgba(255,255,255,.3)}
.hp-refresh:disabled{cursor:wait;opacity:.6}
.hp-refresh.spinning svg{animation:hpSpin 1s linear infinite}
.hp-bal-label{font-size:10px;color:rgba(255,255,255,.6);font-weight:700;letter-spacing:1px;margin-bottom:6px;position:relative;z-index:2}
.hp-bal-value{font-family:ui-monospace,Menlo,monospace;font-size:44px;font-weight:700;line-height:0.95;letter-spacing:-.03em;color:#fff;margin-bottom:4px;font-variant-numeric:tabular-nums;position:relative;z-index:2}
.hp-bal-sub{font-size:11px;color:rgba(255,255,255,.6);font-weight:600;letter-spacing:.2px;position:relative;z-index:2}

.hp-search-wrap{margin:12px 16px 0;position:relative;z-index:2}
.hp-search{width:100%;padding:13px 16px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-family:inherit;font-size:14px;font-weight:500;outline:none;transition:border-color .15s}
.hp-search:focus{border-color:var(--ink);box-shadow:none}
.hp-search::placeholder{color:var(--ink-3)}

.hp-moonpay{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 16px 0;padding:13px 16px 13px 18px;border-radius:14px;background:#0a0a0a;border:1px solid #0a0a0a;color:#fff;text-decoration:none;box-shadow:none;transition:transform .15s,opacity .15s;position:relative;z-index:2;-webkit-tap-highlight-color:transparent}
.hp-moonpay:hover{transform:translateY(-1px);opacity:.95}
.hp-moonpay:active{transform:translateY(0)}
.hp-moonpay-left{display:flex;align-items:center;gap:11px;min-width:0}
.hp-moonpay-icon{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;background:#fff;color:#0a0a0a;font-family:inherit;font-style:normal;font-weight:800;font-size:16px;line-height:1;box-shadow:none}
.hp-moonpay-text{min-width:0}
.hp-moonpay-title{font-family:inherit;font-size:15px;font-weight:700;line-height:1.05;letter-spacing:-.01em;color:#fff}
.hp-moonpay-title em{font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:#fff}
.hp-moonpay-sub{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:0.6px;text-transform:uppercase;margin-top:3px}
.hp-moonpay-arrow{flex-shrink:0;font-size:18px;color:#fff;font-family:initial;line-height:1}

.hp-sort-head{display:flex;justify-content:space-between;align-items:center;padding:22px 18px 12px;position:relative;z-index:2}
.hp-sort-label{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.hp-sort-meta{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:.4px}

.hp-sort-chips{display:flex;gap:6px;padding:0 18px;margin-bottom:12px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative;z-index:2}
.hp-sort-chips::-webkit-scrollbar{display:none}
.hp-sort-chip{flex-shrink:0;padding:8px 14px;border-radius:999px;background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--border);color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.2px;cursor:pointer;transition:all .15s;white-space:nowrap}
.hp-sort-chip:hover{border-color:var(--ink);color:var(--ink)}
.hp-sort-chip.hp-active{background:#0a0a0a;color:#fff;border-color:#0a0a0a;box-shadow:none}

.hp-list{margin:0 16px;background:#fff;backdrop-filter:none;border:1px solid var(--hairline);border-radius:16px;overflow:hidden;position:relative;z-index:2}
.hp-row{padding:14px 16px;display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;border-bottom:1px solid var(--hairline);animation:hpRise .35s cubic-bezier(.2,.8,.2,1) backwards}
.hp-row:last-child{border-bottom:none}
.hp-row.hp-row-sol{background:var(--glass-strong)}
.hp-h-badge{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;font-family:inherit;font-size:17px;font-weight:800;color:#fff;background:#0a0a0a}
.hp-h-badge-img{width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover;background:var(--glass-strong)}
.hp-h-mid{min-width:0}
.hp-h-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hp-h-sym{font-family:inherit;font-size:16px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.hp-h-tag{font-family:ui-monospace,Menlo,monospace;font-size:8px;font-weight:700;color:var(--ink-2);background:var(--glass-strong);border:1px solid var(--border);padding:2px 6px;border-radius:5px;letter-spacing:.4px}
.hp-h-tag.hp-tag-sol{background:var(--glass-strong);color:var(--ink-2)}
.hp-h-tag.hp-tag-stable{background:var(--glass-strong);color:var(--ink-2)}
.hp-h-tag.hp-tag-pump{background:var(--glass-strong);color:var(--ink-2)}
.hp-h-sub{font-size:11px;color:var(--ink-2);margin-top:3px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.hp-h-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.hp-h-value{font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.hp-h-actions{display:flex;gap:5px}
.hp-act-btn{border:none;cursor:pointer;padding:6px 12px;border-radius:999px;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.3px;transition:all .15s}
.hp-act-btn:disabled{cursor:wait;opacity:.6}
.hp-act-buy{background:var(--green);color:#fff;box-shadow:none}
.hp-act-buy:hover:not(:disabled){opacity:.9}
.hp-act-sell{background:var(--glass-strong);color:var(--ink);border:1px solid var(--border)!important;box-shadow:none}
.hp-act-sell:hover:not(:disabled){background:#f0f0f1}

.hp-empty{padding:30px 22px;text-align:center}
.hp-empty-title{color:var(--ink-2);font-size:13px;font-weight:600;margin-bottom:4px}
.hp-empty-sub{color:var(--ink-3);font-size:11px;font-weight:500}
.hp-loading{margin:12px 16px 0;padding:60px 22px;border-radius:16px;text-align:center;background:#fff;backdrop-filter:none;border:1px solid var(--hairline)}
.hp-loading-spinner{width:32px;height:32px;border-radius:50%;margin:0 auto 14px;border:2.5px solid var(--border);border-top-color:var(--ink);animation:hpSpin .8s linear infinite}
.hp-loading-text{font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:0.8px;text-transform:uppercase}
.hp-error{margin:12px 16px 0;padding:14px 16px;border-radius:12px;background:rgba(224,54,79,.08);border:1px solid rgba(224,54,79,.3);color:var(--red);font-size:12px;font-weight:600}

.hp-foot{display:flex;align-items:center;justify-content:center;gap:9px;margin:24px 16px 0;padding:14px 16px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--hairline);backdrop-filter:none}
.hp-foot-label{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:.3px}
.hp-foot-name{font-family:inherit;font-style:normal;font-size:13px;font-weight:700;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.hp-foot-sep{color:var(--ink-3);font-size:10px}

.hp-sheet-backdrop{position:fixed;inset:0;background:rgba(10,10,10,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:998;animation:hpFade .2s}
.hp-sheet{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:520px;z-index:999;max-height:90dvh;display:flex;flex-direction:column;overflow:hidden;background:#fff;border-top:1px solid var(--border);border-radius:22px 22px 0 0;box-shadow:0 -12px 50px rgba(10,10,10,.18);animation:hpSlideUp .35s cubic-bezier(.2,1.2,.4,1)}
.hp-grabber{width:40px;height:4px;background:var(--border);border-radius:99px;margin:10px auto 12px;flex-shrink:0}
.hp-sheet-head{flex-shrink:0;padding:0 22px 12px;display:flex;align-items:center;gap:12px}
.hp-sheet-badge{width:46px;height:46px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;color:#fff;font-family:inherit;font-weight:800;font-size:18px;background:#0a0a0a}
.hp-sheet-badge-img{width:46px;height:46px;border-radius:50%;flex-shrink:0;object-fit:cover}
.hp-sheet-title-wrap{flex:1;min-width:0}
.hp-sheet-title{font-family:inherit;font-size:20px;font-weight:700;line-height:1;letter-spacing:-.02em;color:var(--ink)}
.hp-sheet-sub{font-size:12px;color:var(--ink-2);margin-top:3px;font-weight:500}
.hp-route-badge{display:inline-block;margin-left:8px;font-family:ui-monospace,Menlo,monospace;font-size:8px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:0.6px;vertical-align:middle}
.hp-route-badge.hp-route-jup{background:var(--glass-strong);color:var(--ink-2);border:1px solid var(--border)}
.hp-route-badge.hp-route-xstock{background:var(--glass-strong);color:var(--ink-2);border:1px solid var(--border)}
.hp-route-badge.hp-route-pump{background:var(--glass-strong);color:var(--ink-2);border:1px solid var(--border)}
.hp-sheet-close{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-size:18px;cursor:pointer;font-family:inherit;display:grid;place-items:center}
.hp-sheet-close:disabled{cursor:not-allowed;opacity:.5}

.hp-side-switch{display:flex;margin:0 22px 14px;padding:4px;gap:4px;background:var(--glass-strong);border:1px solid var(--border);border-radius:999px;flex-shrink:0}
.hp-side-btn{flex:1;padding:10px 0;border-radius:999px;border:none;background:transparent;color:var(--ink-2);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.3px;transition:all .2s}
.hp-side-btn:disabled{cursor:not-allowed;opacity:.5}
.hp-side-btn.hp-active.hp-buy{background:var(--green);color:#fff;box-shadow:none}
.hp-side-btn.hp-active.hp-sell{background:var(--red);color:#fff;box-shadow:none}

.hp-sheet-body{flex:1;overflow-y:auto;padding:0 22px 12px;min-height:0;-webkit-overflow-scrolling:touch}

.hp-amount-label{display:flex;justify-content:space-between;align-items:center;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:0.6px;margin-bottom:8px}
.hp-amount-bal{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:600;display:flex;align-items:center;gap:6px}
.hp-amount-bal b{color:var(--ink);font-weight:700}
.hp-max-btn{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);padding:3px 8px;border-radius:7px;font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;cursor:pointer;letter-spacing:.4px}
.hp-amount-wrap{background:var(--glass-strong);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:10px;transition:all .2s}
.hp-amount-wrap:focus-within{border-color:var(--ink);box-shadow:none}
.hp-amount-input{flex:1;background:transparent;border:none;outline:none;font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:600;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;text-align:right;min-width:0;width:100%}
.hp-amount-input::placeholder{color:var(--ink-3)}
.hp-amount-chip{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:7px 11px 7px 6px;border-radius:999px;background:#fff;border:1px solid var(--border);font-family:inherit;font-size:14px;font-weight:700;color:var(--ink)}
.hp-amount-chip-icon{width:22px;height:22px;border-radius:50%;flex-shrink:0;object-fit:cover;background:#0a0a0a}
.hp-amount-equiv{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);font-weight:500;text-align:right;margin:-4px 4px 8px}

.hp-presets{display:flex;gap:6px;margin-bottom:12px}
.hp-preset{flex:1;padding:9px 0;border-radius:10px;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:11px;cursor:pointer;transition:all .15s;letter-spacing:.2px}
.hp-preset:hover{border-color:var(--ink);background:#f0f0f1}
.hp-preset.hp-preset-active{background:#0a0a0a;color:#fff;border-color:#0a0a0a;box-shadow:none}
.hp-preset:disabled{cursor:not-allowed;opacity:.4}

.hp-receive{margin-bottom:12px;padding:14px 16px;border-radius:14px;background:var(--glass-strong);border:1px solid var(--hairline)}
.hp-receive-head{display:flex;justify-content:space-between;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:0.6px;margin-bottom:8px}
.hp-receive-loading{color:var(--ink-3)}
.hp-receive-val{font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.hp-receive-val.hp-muted{color:var(--ink-3);font-size:18px}
.hp-receive-meta{margin-top:10px;padding-top:8px;border-top:1px solid var(--hairline)}
.hp-receive-meta-row{display:flex;justify-content:space-between;padding:3px 0;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.hp-receive-meta-row>span:first-child{color:var(--ink-2);font-weight:500}
.hp-receive-meta-row>span:last-child{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}

.hp-sheet-error{margin-bottom:10px;padding:11px 13px;border-radius:12px;background:rgba(224,54,79,.08);border:1px solid rgba(224,54,79,.3);color:var(--red);font-size:12px;font-weight:600}
.hp-sheet-success{margin-bottom:10px;padding:11px 13px;border-radius:12px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.35);font-size:12px;color:var(--ink);font-weight:600}
.hp-sheet-success a{color:var(--ink);text-decoration:underline;font-weight:800;font-family:ui-monospace,Menlo,monospace;font-size:11px}

.hp-cta-wrap{flex-shrink:0;padding:14px 22px calc(env(safe-area-inset-bottom) + 22px);border-top:1px solid var(--hairline);background:#fff}
.hp-cta{width:100%;padding:16px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.01em;color:#fff;transition:opacity .15s,transform .15s;position:relative;overflow:hidden}
.hp-cta-buy{background:var(--green);box-shadow:none}
.hp-cta-sell{background:var(--red);color:#fff;box-shadow:none}
.hp-cta:hover:not(:disabled){opacity:.9}
.hp-cta:active:not(:disabled){transform:translateY(1px)}
.hp-cta:disabled{background:var(--glass-strong);color:var(--ink-3);cursor:not-allowed;box-shadow:none;border:1px solid var(--border)}
.hp-cta-foot{text-align:center;font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);font-weight:600;margin-top:9px;letter-spacing:.3px}
.hp-cta-foot b{color:var(--ink-2);font-weight:700}
`;

function useHpCSS() {
  useEffect(() => {
    const id = 'nexus-hp-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = HP_CSS;
    document.head.appendChild(el);
  }, []);
}

// =====================================================================
// SHARED CONSTANTS
// =====================================================================
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const SPL_LEGACY_PROGRAM    = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MIN_TOKEN_VALUE_USD = 1;

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');

// =====================================================================
// RPC — same-origin server proxy → Alchemy mainnet. The server (server.js)
// holds the Alchemy API key and forwards requests via /api/solana-rpc.
// Both Connection-based drawers (Jupiter, Pumpfun) and the raw
// /api/solana-rpc fetches (xstock, fetchPortfolio) route to the same proxy,
// so view-source / scraping can't extract the key.
// =====================================================================
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';

// =====================================================================
// BRAND TOKENS (xStock route)
// =====================================================================
const BRAND_TOKENS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': true,
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': true,
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': true,
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': true,
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': true,
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': true,
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': true,
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': true,
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': true,
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': true,
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': true,
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': true,
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': true,
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': true,
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': true,
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': true,
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': true,
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': true,
};
const STABLES = new Set([USDC_SOLANA, USDT_SOLANA]);

// Mint-suffix shortcut. Most pump.fun mints end in "pump", but not all —
// graduated tokens, older mints, and some PumpSwap migrations don't. Used
// only as a fast-path / fallback. Authoritative detection happens via
// DexScreener at portfolio-load (see fetchDexScreenerPumpSet).
function isPumpFunMint(mint) {
  if (!mint || typeof mint !== 'string') return false;
  return /pump$/i.test(mint);
}

// Resolve the trade route for a holding. Prefers the meta.isPump flag set
// by the DexScreener pass (reliable for any pump.fun / PumpSwap token);
// falls back to the mint-suffix heuristic when DexScreener is unreachable
// or hasn't indexed the token yet.
function getTokenRoute(token) {
  if (!token?.mint) return 'jupiter';
  if (BRAND_TOKENS[token.mint]) return 'xstock';
  if (token.meta?.isPump) return 'pumpfun';
  if (isPumpFunMint(token.mint)) return 'pumpfun';
  return 'jupiter';
}

const KNOWN_ICONS = {
  [SOL_MINT]:    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  [USDC_SOLANA]: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
};

// =====================================================================
// SHARED UTILS
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
function colorFromMint(mint) {
  const seed = mint || '?';
  const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}
function buildFallbackMeta(mint) {
  return {
    symbol: (mint || '').slice(0, 4) + '…',
    name:   'SPL Token',
    color:  colorFromMint(mint),
    icon:   null,
  };
}

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled')) return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('not a pump') || m.includes('not indexed')) return 'Not a pump.fun bonding-curve token.';
  if (m.includes('could not find any route') || m.includes('no route')) return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large')) return 'Route is too complex to fit in one transaction.';
  return err?.message || 'Swap failed. Please try again.';
};

function MintIcon({ mint, meta, size = 22 }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [mint]);

  const url = KNOWN_ICONS[mint] || meta?.icon || null;
  const radius = Math.round(size * 0.5);

  if (url && !errored) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setErrored(true)}
        style={{
          width: size, height: size, borderRadius: radius,
          objectFit: 'cover', flexShrink: 0,
          background: 'rgba(255,255,255,.5)',
        }}
      />
    );
  }
  const sym = mint === SOL_MINT ? 'S'
            : mint === USDC_SOLANA ? '$'
            : ((meta?.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const bg = mint === SOL_MINT
    ? 'linear-gradient(135deg,#B794F6,#7FFFD4)'
    : mint === USDC_SOLANA
      ? 'linear-gradient(135deg,#2775CA,#A0E7FF)'
      : (() => {
          const c = meta?.color || colorFromMint(mint);
          return `linear-gradient(135deg, ${c}, ${c}cc)`;
        })();
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      flexShrink: 0, display: 'grid', placeItems: 'center',
      background: bg, color: '#fff',
      fontFamily: '"Instrument Serif", serif',
      fontSize: Math.round(size * 0.55), lineHeight: 1,
    }}>{sym}</div>
  );
}

// =====================================================================
// PORTFOLIO FETCH
// =====================================================================
async function fetchPortfolio(addressStr) {
  const rpcBatch = [
    { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addressStr] },
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

  const byId = {};
  for (const item of rpcJson) if (item && item.id != null) byId[item.id] = item;

  const lamports = Number(byId[1]?.result?.value || 0);
  const legacyAccounts  = byId[2]?.result?.value || [];
  const token22Accounts = byId[3]?.result?.value || [];

  const byMint = {};
  const mergeAccs = (accs, isToken2022) => {
    for (const acc of accs) {
      try {
        const info = acc.account.data.parsed.info;
        const ta   = info.tokenAmount || {};
        const ui   = Number(ta.uiAmountString || ta.uiAmount || 0);
        const raw  = ta.amount;
        const mint = info.mint;
        if (!mint || raw == null) continue;
        if (!byMint[mint]) {
          byMint[mint] = {
            mint,
            uiAmount: 0,
            rawAmount: 0n,
            decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6,
            isToken2022,
          };
        }
        byMint[mint].uiAmount += ui;
        try { byMint[mint].rawAmount += BigInt(raw); } catch {}
      } catch {}
    }
  };
  mergeAccs(legacyAccounts, false);
  mergeAccs(token22Accounts, true);

  const tokenMints = Object.keys(byMint).filter(m => m !== SOL_MINT);

  // Meta + price + pump-detection are best-effort. If any service is down or
  // rate-limited we still want to render holdings (without the missing piece).
  const [metaSettled, priceSettled, pumpSettled] = await Promise.allSettled([
    fetchMetaBatched(tokenMints),
    fetchPricesBatched([SOL_MINT, ...tokenMints]),
    fetchDexScreenerPumpSet(tokenMints),
  ]);
  const metaMap  = metaSettled.status  === 'fulfilled' ? metaSettled.value  : {};
  const priceMap = priceSettled.status === 'fulfilled' ? priceSettled.value : {};
  const pumpSet  = pumpSettled.status  === 'fulfilled' ? pumpSettled.value  : new Set();
  if (metaSettled.status  === 'rejected') console.warn('[Holdings] meta fetch failed',  metaSettled.reason);
  if (priceSettled.status === 'rejected') console.warn('[Holdings] price fetch failed', priceSettled.reason);
  if (pumpSettled.status  === 'rejected') console.warn('[Holdings] pump detect failed', pumpSettled.reason);

  const enriched = Object.values(byMint).map(h => {
    const fetched = metaMap[h.mint];
    const meta = fetched || buildFallbackMeta(h.mint);
    const isStable = STABLES.has(h.mint);
    const isBrand  = !!BRAND_TOKENS[h.mint];
    // Authoritative: DexScreener says pump/pumpswap. Fallback: mint suffix.
    const isPump   = pumpSet.has(h.mint) || isPumpFunMint(h.mint);
    const price   = isStable ? 1 : (priceMap[h.mint] || 0);
    const hasPrice = price > 0;
    return {
      ...h,
      meta: { ...meta, isStable, isBrand, isPump },
      price,
      hasPrice,
      value: h.uiAmount * price,
    };
  });

  // Show a token only if it has a real price AND is worth at least $1.
  // EXCEPTION: known xStocks (brand tokens) are real holdings, never dust — always
  // show them so the wallet reflects what the user owns even if the price feed is
  // momentarily down or the position is small.
  const filtered = enriched
    .filter(h => h.mint !== SOL_MINT)
    .filter(h => BRAND_TOKENS[h.mint] || (h.hasPrice && h.value >= MIN_TOKEN_VALUE_USD));

  return {
    solBalance:  lamports / 1e9,
    solLamports: lamports,
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

// Pump.fun detection via the server-side DexScreener proxy at
// /api/dex/pump-check. We can't hit api.dexscreener.com directly — the
// CSP blocks it by design, so the server is the single point of
// DexScreener load (one cached source, no double traffic).
//
// Returns a Set of mint strings whose primary DEX is pumpfun or pumpswap.
// Best-effort: if the proxy is down or slow, falls back silently and the
// mint-suffix heuristic in isPumpFunMint takes over.
async function fetchDexScreenerPumpSet(mints) {
  const out = new Set();
  if (!mints.length) return out;
  // Server caps each request at 100 mints — chunk to match.
  const chunks = [];
  for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await fetch(`/api/dex/pump-check?mints=${chunk.join(',')}`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data?.pumpMints) ? data.pumpMints : [];
    } catch { return []; }
  }));
  for (const list of results) for (const m of list) out.add(m);
  return out;
}

// =====================================================================
// HOLDING ROW
// =====================================================================
function HoldingRow({ token, onBuy, onSell, idx, busy }) {
  const meta    = token.meta || buildFallbackMeta(token.mint);
  const val     = token.value || 0;
  const isSol   = token.mint === SOL_MINT;
  const isBrand = !!meta.isBrand;
  const isStable = !!meta.isStable;
  const isPump   = !!meta.isPump;
  const hasPrice = !!token.hasPrice || isSol;

  return (
    <div
      className={'hp-row' + (isSol ? ' hp-row-sol' : '')}
      style={{ animationDelay: (idx * 0.03) + 's' }}
    >
      <MintIcon mint={token.mint} meta={meta} size={42} />
      <div className="hp-h-mid">
        <div className="hp-h-head">
          <span className="hp-h-sym">{meta.symbol}</span>
          {isSol     && (<span className="hp-h-tag hp-tag-sol">NATIVE</span>)}
          {isBrand   && (<span className="hp-h-tag">xSTOCK</span>)}
          {isStable  && (<span className="hp-h-tag hp-tag-stable">STABLE</span>)}
          {isPump    && (<span className="hp-h-tag hp-tag-pump">PUMP</span>)}
        </div>
        <div className="hp-h-sub">
          {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {hasPrice && token.price > 0 ? fmtUsd(token.price) : 'no price'}
        </div>
      </div>
      <div className="hp-h-right">
        <div className="hp-h-value">{val > 0 ? fmtUsd(val) : '—'}</div>
        {!isSol && (
          <div className="hp-h-actions">
            <button type="button" className="hp-act-btn hp-act-buy"  onClick={() => onBuy(token)}  disabled={busy}>BUY</button>
            <button type="button" className="hp-act-btn hp-act-sell" onClick={() => onSell(token)} disabled={busy}>SELL</button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// JUPITER DRAWER  — verbatim port of MemeWonderland.jsx TradeSheet
// =====================================================================
const JUP_FEE_BPS      = 300;
const JUP_SLIPPAGE_BPS = 500;

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

function JupiterDrawer({
  token, initialMode, isSol,
  solBalance, tokenBalance, solPrice,
  publicKey, signTransaction, connected,
  onClose, onConnectWallet, onTradeComplete,
}) {
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);
  const meta = token.meta || buildFallbackMeta(token.mint);

  const [mode, setMode] = useState(isSol ? 'sell' : (initialMode || 'buy'));
  useEffect(() => { if (isSol && mode !== 'sell') setMode('sell'); }, [isSol, mode]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // SOL row: always SOL → USDC.
  // Token row: BUY  = SOL → token,  SELL = token → SOL.
  const isSell = mode === 'sell' || isSol;
  const inputMint  = isSol ? SOL_MINT  : (isSell ? token.mint : SOL_MINT);
  const outputMint = isSol ? USDC_SOLANA : (isSell ? SOL_MINT  : token.mint);
  const inputDecimals  = inputMint === SOL_MINT ? 9
                       : inputMint === USDC_SOLANA ? 6
                       : (meta.decimals ?? 6);
  const outputDecimals = outputMint === SOL_MINT ? 9
                       : outputMint === USDC_SOLANA ? 6
                       : (meta.decimals ?? 6);
  const inputSymbol  = inputMint === SOL_MINT ? 'SOL'
                     : inputMint === USDC_SOLANA ? 'USDC'
                     : meta.symbol;
  const outputSymbol = outputMint === SOL_MINT ? 'SOL'
                     : outputMint === USDC_SOLANA ? 'USDC'
                     : meta.symbol;

  const inputBalanceUi = inputMint === SOL_MINT ? (solBalance || 0)
                       : inputMint === token.mint ? (tokenBalance?.uiAmount || 0)
                       : 0;
  const inputPriceUsd = inputMint === SOL_MINT ? (solPrice || 0)
                      : inputMint === USDC_SOLANA ? 1
                      : inputMint === token.mint ? (token.price || 0)
                      : 0;

  const [amount, setAmount] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(null);
  useEffect(() => { setAmount(''); setSelectedPreset(null); }, [mode]);

  const amtNum = parseFloat(amount) || 0;
  const usdValue = amtNum * inputPriceUsd;

  const rawAmount = useMemo(() => {
    if (!amount) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputDecimals)).toString();
  }, [amount, inputDecimals]);

  // ── QUOTE — verbatim from MemeWonderland TradeSheet ────────────────
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
        const net = (BigInt(rawAmount) * BigInt(10000 - JUP_FEE_BPS)) / 10000n;
        if (net <= 0n) {
          setBuild(null);
          setQuoting(false);
          return;
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:      net.toString(),
          slippageBps: String(JUP_SLIPPAGE_BPS),
          taker:       publicKey
            ? publicKey.toBase58()
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
  }, [rawAmount, inputMint, outputMint, publicKey]);

  const outAmountUi = useMemo(() => {
    if (!build) return null;
    return Number(build.outAmount) / Math.pow(10, outputDecimals);
  }, [build, outputDecimals]);

  const rate = useMemo(() => {
    if (!outAmountUi || !amtNum) return null;
    return outAmountUi / amtNum;
  }, [outAmountUi, amtNum]);

  // ── EXECUTE — verbatim from MemeWonderland TradeSheet.handleSwap ───
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);
  const [swapResult, setSwapResult] = useState(null);

  const handleSwap = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      onConnectWallet?.();
      return;
    }
    if (!build) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);
    setSwapResult(null);

    try {
      const dec = inputDecimals;

      const feeAmount = (BigInt(rawAmount) * BigInt(JUP_FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(feeAmount),
        }));
      } else {
        const mintPk = new PublicKey(inputMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        const sourceAta = getAssociatedTokenAddressSync(mintPk, publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, tokenProgram);

        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, publicKey,
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
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey:        publicKey,
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
        console.warn('[hp-jup sim non-fatal]', simErr);
      }

      const signed = await signTransaction(tx);

      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

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
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain.');
        confirmed = true;
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      setSwapResult({ signature: sig, pending: !confirmed });
      if (confirmed) setTimeout(() => onTradeComplete?.(), 2000);
    } catch (e) {
      console.error('[hp-jup swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    connected, publicKey, signTransaction, build,
    inputMint, inputDecimals, rawAmount,
    connection, onConnectWallet, onTradeComplete,
  ]);

  // ── PRESETS / MAX ──────────────────────────────────────────────────
  const buyPresets = ['0.1', '0.5', '1', '2'];
  const sellPresets = [
    { label: '25%', pct: 25 },
    { label: '50%', pct: 50 },
    { label: '75%', pct: 75 },
    { label: 'MAX', pct: 100 },
  ];
  const applyBuyPreset = (v) => { setAmount(v); setSelectedPreset(v); };
  const applySellPercent = (pct) => {
    if (!(inputBalanceUi > 0)) return;
    let amt = (inputBalanceUi * pct) / 100;
    if (inputMint === SOL_MINT && pct === 100) amt = Math.max(0, amt - 0.01);
    const factor = Math.pow(10, Math.min(8, inputDecimals));
    amt = Math.floor(amt * factor) / factor;
    setAmount(String(amt));
    setSelectedPreset('pct-' + pct);
  };

  const hasFunds = amtNum > 0 && inputBalanceUi >= amtNum;
  const canSwap = !!publicKey && !!build && !quoting && !swapping &&
                  amtNum > 0 && inputMint !== outputMint && hasFunds;

  const ctaLabel = swapping
    ? (isSell ? 'Selling…' : 'Buying…')
    : !publicKey
      ? 'Connect Wallet'
      : amtNum <= 0
        ? 'Enter amount'
        : quoting && !build
          ? 'Getting quote…'
          : !build
            ? 'No route available'
            : !hasFunds
              ? `Insufficient ${inputSymbol}`
              : isSell
                ? `Swap ${inputSymbol} → ${outputSymbol}`
                : `Buy ${meta.symbol}`;

  return (
    <>
      <div className="hp-sheet-backdrop" onClick={swapping ? undefined : onClose} />
      <div className="hp-sheet">
        <div className="hp-grabber" />

        <div className="hp-sheet-head">
          <MintIcon mint={token.mint} meta={meta} size={46} />
          <div className="hp-sheet-title-wrap">
            <div className="hp-sheet-title">{meta.symbol}</div>
            <div className="hp-sheet-sub">
              {meta.name} · {token.price > 0 ? fmtUsd(token.price) : 'no price'}
              <span className="hp-route-badge hp-route-jup">JUPITER</span>
            </div>
          </div>
          <button type="button" className="hp-sheet-close" onClick={onClose} disabled={swapping}>×</button>
        </div>

        {!isSol && (
          <div className="hp-side-switch">
            {['buy', 'sell'].map(s => {
              const active = mode === s;
              return (
                <button
                  key={s}
                  type="button"
                  className={'hp-side-btn' + (active ? ` hp-active hp-${s}` : '')}
                  onClick={() => !swapping && setMode(s)}
                  disabled={swapping}
                >{s === 'buy' ? 'Buy with SOL' : 'Sell to SOL'}</button>
              );
            })}
          </div>
        )}

        <div className="hp-sheet-body">
          <div className="hp-amount-label">
            <span>{isSell ? 'YOU SELL' : 'YOU PAY'}</span>
            <span className="hp-amount-bal">
              Bal: <b>{fmtTokenAmt(inputBalanceUi)}</b> {inputSymbol}
              {!isSell && inputBalanceUi > 0 && (
                <button type="button" className="hp-max-btn"
                  onClick={() => applySellPercent(100)}>MAX</button>
              )}
            </span>
          </div>

          <div className="hp-amount-wrap">
            <div className="hp-amount-chip">
              <MintIcon mint={inputMint} meta={meta} size={22} />
              {inputSymbol}
            </div>
            <input
              className="hp-amount-input"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v);
                setSelectedPreset(null);
              }}
              disabled={swapping}
            />
          </div>
          {usdValue > 0 && (
            <div className="hp-amount-equiv">≈ {fmtUsd(usdValue)}</div>
          )}

          {(mode === 'buy' && !isSol) ? (
            <div className="hp-presets">
              {buyPresets.map(v => (
                <button key={v} type="button"
                  className={'hp-preset' + (selectedPreset === v ? ' hp-preset-active' : '')}
                  onClick={() => applyBuyPreset(v)}
                  disabled={swapping}>
                  {v} SOL
                </button>
              ))}
            </div>
          ) : (
            <div className="hp-presets">
              {sellPresets.map(p => {
                const k = 'pct-' + p.pct;
                return (
                  <button key={k} type="button"
                    className={'hp-preset' + (selectedPreset === k ? ' hp-preset-active' : '')}
                    onClick={() => applySellPercent(p.pct)}
                    disabled={swapping || !(inputBalanceUi > 0)}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {(amtNum > 0 || quoting) && (
            <div className="hp-receive">
              <div className="hp-receive-head">
                <span>YOU RECEIVE</span>
                {quoting && <span className="hp-receive-loading">updating…</span>}
              </div>
              <div className={'hp-receive-val' + (outAmountUi != null && outAmountUi > 0 ? '' : ' hp-muted')}>
                {outAmountUi != null && outAmountUi > 0
                  ? `${fmtTokenAmt(outAmountUi)} ${outputSymbol}`
                  : '—'}
              </div>
              {build && rate && (
                <div className="hp-receive-meta">
                  <div className="hp-receive-meta-row">
                    <span>Rate</span>
                    <span>1 {inputSymbol} ≈ {fmtTokenAmt(rate)} {outputSymbol}</span>
                  </div>
                  <div className="hp-receive-meta-row">
                    <span>Platform fee</span>
                    <span>3% · in {inputSymbol}</span>
                  </div>
                  <div className="hp-receive-meta-row">
                    <span>Route</span>
                    <span>Jupiter</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {quoteError && !swapping && !swapResult && (
            <div className="hp-sheet-error">{quoteError}</div>
          )}
          {swapError && (
            <div className="hp-sheet-error">{swapError}</div>
          )}
          {swapResult && (
            <div className="hp-sheet-success">
              {swapResult.pending ? 'Submitted but still confirming. ' : 'Swap confirmed. '}
              <a href={`https://solscan.io/tx/${swapResult.signature}`} target="_blank" rel="noreferrer">
                View on Solscan
              </a>
            </div>
          )}
        </div>

        <div className="hp-cta-wrap">
          <button
            type="button"
            className={'hp-cta ' + (isSell ? 'hp-cta-sell' : 'hp-cta-buy')}
            onClick={!connected ? onConnectWallet : handleSwap}
            disabled={connected ? !canSwap : false}
          >
            {ctaLabel}
          </button>
          <div className="hp-cta-foot">
            Powered by <b>Jupiter</b> · Non-custodial · Your keys
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// XSTOCK DRAWER  — verbatim port of Stocks.jsx TradeModal
// =====================================================================
const XSTOCK_FEE_BPS      = 500;
const XSTOCK_SLIPPAGE_BPS = 500;
const USDC_DECIMALS       = 6;
const ATA_PROGRAM_ID      = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function getJupiterQuoteX({ inputMint, outputMint, amountAtomic, slippageBps }) {
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

async function getJupiterSwapInstructionsX({ quoteResponse, userPublicKey }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol:        true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: { maxBps: XSTOCK_SLIPPAGE_BPS },
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

function deriveAtaX(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

function createIdempotentAtaIxX(payer, ata, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
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

function createTransferCheckedIxX({ source, mint, destination, owner, amountAtomic, decimals, tokenProgramId = TOKEN_PROGRAM_ID }) {
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

function deserializeJupInstructionX(ix) {
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

async function fetchLookupTableAccountsX(altAddresses) {
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

async function fetchTokenBalanceX({ ownerPubkey, mint, decimals }) {
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

async function assembleSwapTxX({ swapInstructions, feeIxs, userPublicKey, prependFee }) {
  const altAddrs = swapInstructions.addressLookupTableAddresses || [];
  const altAccounts = await fetchLookupTableAccountsX(altAddrs);

  const computeBudgetIxs = (swapInstructions.computeBudgetInstructions || []).map(deserializeJupInstructionX);
  const setupIxs         = (swapInstructions.setupInstructions || []).map(deserializeJupInstructionX);
  const swapIx           = swapInstructions.swapInstruction ? deserializeJupInstructionX(swapInstructions.swapInstruction) : null;
  const cleanupIx        = swapInstructions.cleanupInstruction ? deserializeJupInstructionX(swapInstructions.cleanupInstruction) : null;

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

function parseSimErrorX(err, logs) {
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

async function simulateBeforeSignX(serializedTxBase64) {
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
    if (value.err)  return { ok: false, message: parseSimErrorX(value.err, value.logs) };
    return { ok: true };
  } catch (e) {
    console.warn('[hp-xstock sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

function XstockDrawer({
  token, initialMode,
  publicKey, signTransaction, connected,
  onClose, onConnectWallet, onTradeComplete,
}) {
  const meta = token.meta || buildFallbackMeta(token.mint);
  const brand = {
    mint:     token.mint,
    symbol:   meta.symbol,
    name:     meta.name,
    decimals: meta.decimals ?? 8,
  };
  const price = token.price || 0;
  const walletPubkey = publicKey ? publicKey.toBase58() : null;

  const [side, setSide]       = useState((initialMode === 'sell' ? 'SELL' : 'BUY'));
  const [amount, setAmount]   = useState('');
  const [quote, setQuote]     = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]     = useState('');
  const [brandBal, setBrandBal] = useState({ atomic: 0n, ui: 0, loaded: false });
  const [usdcBal,  setUsdcBal]  = useState({ atomic: 0n, ui: 0, loaded: false });
  const quoteSeq = useRef(0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Refresh balances on open and after each submit settles.
  useEffect(() => {
    if (!walletPubkey) return;
    let cancelled = false;
    (async () => {
      const [s, u] = await Promise.allSettled([
        fetchTokenBalanceX({ ownerPubkey: walletPubkey, mint: brand.mint, decimals: brand.decimals }),
        fetchTokenBalanceX({ ownerPubkey: walletPubkey, mint: USDC_SOLANA, decimals: USDC_DECIMALS }),
      ]);
      if (cancelled) return;
      if (s.status === 'fulfilled') setBrandBal({ ...s.value, loaded: true });
      else                          setBrandBal({ atomic: 0n, ui: 0, loaded: true });
      if (u.status === 'fulfilled') setUsdcBal({ ...u.value, loaded: true });
      else                          setUsdcBal({ atomic: 0n, ui: 0, loaded: true });
    })();
    return () => { cancelled = true; };
  }, [walletPubkey, brand.mint, brand.decimals, submitState.kind]);

  // Quote — verbatim from Stocks.jsx
  useEffect(() => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const isBuy = side === 'BUY';
        const inputMint  = isBuy ? USDC_SOLANA : brand.mint;
        const outputMint = isBuy ? brand.mint  : USDC_SOLANA;

        let atomic;
        if (isBuy) {
          const grossUsdcAtomic = Math.round(n * 10 ** USDC_DECIMALS);
          const feeUsdcAtomic   = Math.floor(grossUsdcAtomic * XSTOCK_FEE_BPS / 10000);
          atomic = grossUsdcAtomic - feeUsdcAtomic;
        } else {
          if (!(price > 0)) { setQuote(null); setQuoting(false); return; }
          atomic = Math.round((n / price) * 10 ** brand.decimals);
        }
        if (atomic < 1) { setQuote(null); setQuoting(false); return; }

        const q = await getJupiterQuoteX({
          inputMint, outputMint,
          amountAtomic: atomic,
          slippageBps:  XSTOCK_SLIPPAGE_BPS,
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
  }, [amount, side, brand.mint, brand.decimals, price]);

  const usd       = parseFloat(amount) || 0;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  const outAtomic   = quote ? Number(quote.outAmount) : 0;
  const isBuy       = side === 'BUY';
  const outDecimals = isBuy ? brand.decimals : USDC_DECIMALS;
  const grossOut    = outAtomic / 10 ** outDecimals;

  const feeBpsRatio    = XSTOCK_FEE_BPS / 10000;
  const platformFeeUsd = isBuy ? usd * feeBpsRatio : grossOut * feeBpsRatio;
  const netOutUsdc  = !isBuy ? Math.max(0, grossOut - platformFeeUsd) : 0;
  const outAmount   = isBuy ? grossOut : netOutUsdc;
  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  const brandAtomicNeeded = (() => {
    if (isBuy || !(usd > 0) || !(price > 0)) return 0n;
    try { return BigInt(Math.round((usd / price) * 10 ** brand.decimals)); } catch { return 0n; }
  })();
  const validStake = isBuy
    ? (usd >= 1 && usd <= 50000)
    : (brandAtomicNeeded > 0n && brandAtomicNeeded <= brandBal.atomic);
  const insufficientBrand = !isBuy && brandBal.loaded && brandAtomicNeeded > brandBal.atomic;
  const sellBrandEquiv = !isBuy && usd > 0 && price > 0 ? usd / price : 0;

  const handleSubmit = async () => {
    if (!connected) { onConnectWallet?.(); return; }
    if (!walletPubkey) { setError('Wallet not connected'); return; }
    if (!quote) { setError('No quote available'); return; }
    if (!signTransaction) { setError('Wallet cannot sign'); return; }

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });
    setError('');

    try {
      const owner       = new PublicKey(walletPubkey);
      const usdcMintPk  = new PublicKey(USDC_SOLANA);

      const userUsdcAta = deriveAtaX(owner,      usdcMintPk, TOKEN_PROGRAM_ID);
      const feeUsdcAta  = deriveAtaX(FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID);

      let feeAtomic;
      if (side === 'BUY') {
        feeAtomic = BigInt(Math.round(usd * 10 ** USDC_DECIMALS)) * BigInt(XSTOCK_FEE_BPS) / 10000n;
      } else {
        const worstUsdcOut = BigInt(quote.otherAmountThreshold || quote.outAmount || '0');
        feeAtomic = (worstUsdcOut * BigInt(XSTOCK_FEE_BPS)) / 10000n;
      }
      if (feeAtomic <= 0n) throw new Error('Amount too small');

      const feeIxs = [
        createIdempotentAtaIxX(owner, feeUsdcAta, FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID),
        createTransferCheckedIxX({
          source: userUsdcAta,
          mint: usdcMintPk,
          destination: feeUsdcAta,
          owner,
          amountAtomic: feeAtomic,
          decimals: USDC_DECIMALS,
          tokenProgramId: TOKEN_PROGRAM_ID,
        }),
      ];

      const swapIxs = await getJupiterSwapInstructionsX({
        quoteResponse: quote,
        userPublicKey: walletPubkey,
      });

      const tx = await assembleSwapTxX({
        swapInstructions: swapIxs,
        feeIxs,
        userPublicKey:    walletPubkey,
        prependFee:       side === 'BUY',
      });

      setSubmitState({ kind: 'loading', message: 'Simulating...' });
      const serializedForSim = btoa(String.fromCharCode(...tx.serialize()));
      const sim = await simulateBeforeSignX(serializedForSim);
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

      setSubmitState({ kind: 'success', message: 'Swap submitted', signature: submitJson.result });
      setTimeout(() => { onTradeComplete?.(); }, 2200);
    } catch (e) {
      console.error('[hp-xstock swap]', e);
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
  const buyChips  = [
    { label: '$50',   val: '50'   },
    { label: '$100',  val: '100'  },
    { label: '$500',  val: '500'  },
    { label: '$1000', val: '1000' },
  ];
  const sellChips = [
    { label: '25%', val: sellPctUsd(25)  },
    { label: '50%', val: sellPctUsd(50)  },
    { label: '75%', val: sellPctUsd(75)  },
    { label: 'MAX', val: sellPctUsd(100) },
  ];
  const chips = isBuy ? buyChips : sellChips;

  const successSig = submitState.kind === 'success' ? submitState.signature : null;

  return (
    <>
      <div className="hp-sheet-backdrop" onClick={isBusy ? undefined : onClose} />
      <div className="hp-sheet">
        <div className="hp-grabber" />

        <div className="hp-sheet-head">
          <MintIcon mint={token.mint} meta={meta} size={46} />
          <div className="hp-sheet-title-wrap">
            <div className="hp-sheet-title">{meta.symbol}</div>
            <div className="hp-sheet-sub">
              {meta.name} · {price > 0 ? fmtUsd(price) : 'no price'}
              <span className="hp-route-badge hp-route-xstock">xSTOCK</span>
            </div>
          </div>
          <button type="button" className="hp-sheet-close" onClick={onClose} disabled={isBusy}>×</button>
        </div>

        <div className="hp-side-switch">
          {['BUY', 'SELL'].map(s => {
            const active = side === s;
            const cls = s === 'BUY' ? 'hp-buy' : 'hp-sell';
            return (
              <button
                key={s}
                type="button"
                className={'hp-side-btn' + (active ? ` hp-active ${cls}` : '')}
                onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }}
                disabled={isBusy}
              >{s === 'BUY' ? 'Buy with USDC' : 'Sell to USDC'}</button>
            );
          })}
        </div>

        <div className="hp-sheet-body">
          <div className="hp-amount-label">
            <span>{isBuy ? 'YOU PAY (USDC)' : 'YOU SELL (USDC)'}</span>
            <span className="hp-amount-bal">
              {brandBal.loaded
                ? <>Hold: <b>{fmtTokenAmt(brandBal.ui)}</b> {brand.symbol}</>
                : 'Hold: …'}
            </span>
          </div>

          <div className="hp-amount-wrap">
            <div className="hp-amount-chip">
              <MintIcon mint={USDC_SOLANA} meta={{ symbol: 'USDC' }} size={22} />
              USDC
            </div>
            <input
              className="hp-amount-input"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={e => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v); setError('');
              }}
              disabled={isBusy}
            />
          </div>
          {!isBuy && sellBrandEquiv > 0 && (
            <div className="hp-amount-equiv">≈ {fmtTokenAmt(sellBrandEquiv)} {brand.symbol}</div>
          )}

          <div className="hp-presets">
            {chips.map(c => {
              const disabled = isBusy || !c.val;
              return (
                <button key={c.label} type="button"
                  className="hp-preset"
                  onClick={() => { if (c.val) { setAmount(c.val); setError(''); } }}
                  disabled={disabled}>
                  {c.label}
                </button>
              );
            })}
          </div>

          {usd > 0 && (
            <div className="hp-receive">
              <div className="hp-receive-head">
                <span>YOU RECEIVE</span>
                {quoting && <span className="hp-receive-loading">updating…</span>}
              </div>
              <div className={'hp-receive-val' + (outAtomic > 0 ? '' : ' hp-muted')}>
                {outAtomic > 0
                  ? (isBuy ? `${fmtTokenAmt(outAmount)} ${brand.symbol}` : fmtUsd(outAmount))
                  : '—'}
              </div>
              {quote && (
                <div className="hp-receive-meta">
                  <div className="hp-receive-meta-row">
                    <span>Price impact</span>
                    <span>{priceImpactPct.toFixed(2)}%</span>
                  </div>
                  <div className="hp-receive-meta-row">
                    <span>Platform fee</span>
                    <span>5% · in USDC</span>
                  </div>
                  <div className="hp-receive-meta-row">
                    <span>Route</span>
                    <span>Jupiter · {(quote.routePlan?.length || 1)} hop{(quote.routePlan?.length || 1) === 1 ? '' : 's'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {(error || submitState.kind === 'error') && (
            <div className="hp-sheet-error">{error || submitState.message}</div>
          )}
          {successSig && (
            <div className="hp-sheet-success">
              Swap submitted.{' '}
              <a href={`https://solscan.io/tx/${successSig}`} target="_blank" rel="noreferrer">
                View on Solscan
              </a>
            </div>
          )}
          {submitState.kind === 'loading' && submitState.message && (
            <div className="hp-sheet-success" style={{ background: 'rgba(183,148,246,.12)', borderColor: 'rgba(183,148,246,.4)' }}>
              {submitState.message}
            </div>
          )}
        </div>

        <div className="hp-cta-wrap">
          {!connected ? (
            <button type="button" className="hp-cta hp-cta-buy" onClick={() => onConnectWallet?.()}>
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              className={'hp-cta ' + (isBuy ? 'hp-cta-buy' : 'hp-cta-sell')}
              onClick={handleSubmit}
              disabled={isBusy || !quote || !validStake}
            >
              {isBusy ? 'Processing…' :
               isSuccess ? 'Swap placed' :
               insufficientBrand ? `Insufficient ${brand.symbol}` :
               !validStake ? 'Enter USDC amount' :
               !quote ? (quoting ? 'Getting quote…' : 'No quote') :
               `${isBuy ? 'Buy' : 'Sell'} ${brand.symbol} · ${fmtUsd(usd)}`}
            </button>
          )}
          <div className="hp-cta-foot">
            Powered by <b>Jupiter</b> · USDC settles to your wallet · No KYC
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// PUMPFUN DRAWER  — verbatim port of LaunchRadar TradeModal + executeSwap
// =====================================================================
const PUMP_FEE_BPS  = 300;
const SOL_RESERVE   = 0.01;

async function decodeBuiltTx(b64, connection) {
  const txBytes = Buffer.from(b64, 'base64');
  const tx      = VersionedTransaction.deserialize(txBytes);
  const message = tx.message;
  const lookupKeys = (message.addressTableLookups || []).map(l => l.accountKey);
  const alts = [];
  if (lookupKeys.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(lookupKeys);
    for (let i = 0; i < lookupKeys.length; i++) {
      if (!infos[i]) continue;
      alts.push(new AddressLookupTableAccount({
        key:   lookupKeys[i],
        state: AddressLookupTableAccount.deserialize(infos[i].data),
      }));
    }
  }
  const decompiled = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: alts,
  });
  return { instructions: decompiled.instructions, alts };
}

async function getPumpRoute({ action, mint, user, amount, decimals, connection }) {
  const body = {
    action,
    mint,
    user:   user.toBase58(),
    amount: String(amount),
  };
  if (decimals != null) body.decimals = Number(decimals);

  // Build via the SAME PumpPortal route the Ape page uses (/api/ape/pump-trade),
  // which returns a fully-built v0 tx with CURRENT fee accounts. The old
  // /api/pumpfun/trade (raw SDK) returned bare instructions with no .tx, so this
  // path always failed on the data.tx check. Drawer keeps its own sim/sign/send.
  const r = await fetch('/api/ape/pump-trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || ('pump HTTP ' + r.status));
  if (!data.tx) throw new Error('PumpPortal returned no tx.');

  const { instructions, alts } = await decodeBuiltTx(data.tx, connection);
  return { instructions, alts, pool: data.pool, route: data.route };
}

function describeSimLogs(logs, fallbackMsg) {
  const arr = Array.isArray(logs) ? logs : [];
  const j = arr.join('\n').toLowerCase();
  if (j.includes('slippage') || j.includes('toomuchsol') || j.includes('toolittlesol'))
    return 'Price moved past slippage — try again.';
  if (j.includes('insufficient') || j.includes('debit an account')) return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '').replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed → ' + ctx;
  return fallbackMsg ? ('Sim failed → ' + String(fallbackMsg).slice(0, 160)) : 'Sim failed (no logs returned).';
}

function PumpfunDrawer({
  token, initialMode,
  solBalance, tokenBalance, solPrice,
  publicKey, signTransaction, connected,
  onClose, onConnectWallet, onTradeComplete,
}) {
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);
  const meta = token.meta || buildFallbackMeta(token.mint);

  const [mode, setMode] = useState(initialMode || 'buy');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [swapResult, setSwapResult] = useState(null);

  useEffect(() => { setAmount(''); setError(null); }, [mode]);
  useEffect(() => { setError(null); }, [amount]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const isBuy = mode === 'buy';
  const buyPresets  = [0.1, 0.25, 0.5, 1, 2];
  const sellPresets = [25, 50, 100];
  const presets = isBuy ? buyPresets : sellPresets;

  const ownedUiAmount = tokenBalance?.uiAmount || 0;
  const ownedRaw      = tokenBalance?.rawAmount || 0n;
  const ownedDec      = tokenBalance?.decimals ?? meta.decimals ?? 6;
  const availSol      = Math.max(0, (solBalance || 0) - SOL_RESERVE);

  // swapParams — verbatim from LaunchRadar TradeModal
  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;

    if (isBuy) {
      const totalLamports = BigInt(Math.floor(n * 1e9));
      if (totalLamports <= 0n) return null;
      const feeLamports   = (totalLamports * BigInt(PUMP_FEE_BPS)) / 10000n;
      const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
      if (tradeLamports <= 0n || feeLamports <= 0n) return null;
      return {
        mode: 'buy',
        solAmount: n,
        totalLamports: totalLamports.toString(),
        tradeLamports: tradeLamports.toString(),
        feeLamports:   feeLamports.toString(),
      };
    }

    if (!ownedRaw || ownedRaw <= 0n) return null;
    const pct = Math.min(100, Math.max(0.01, n));
    const tradeTokens = (ownedRaw * BigInt(Math.floor(pct * 100))) / 10000n;
    if (tradeTokens <= 0n) return null;
    const tradeTokensUi = Number(tradeTokens) / Math.pow(10, ownedDec);
    let feeLamports = '0';
    if (token?.price > 0 && solPrice > 0) {
      const grossSol = (tradeTokensUi * token.price) / solPrice;
      const lam = Math.floor(grossSol * (PUMP_FEE_BPS / 10000) * 1e9);
      if (lam > 0) feeLamports = String(lam);
    }
    return {
      mode: 'sell',
      decimals: ownedDec,
      percentage: pct,
      tradeTokens:   tradeTokens.toString(),
      tradeTokensUi,
      feeLamports,
    };
  }, [amount, isBuy, token, ownedRaw, ownedDec, solPrice]);

  const estReceive = useMemo(() => {
    if (!swapParams || !(token?.price > 0) || !(solPrice > 0)) return null;
    if (swapParams.mode === 'buy') {
      const tradeSol = Number(swapParams.tradeLamports) / 1e9;
      const tokens = (tradeSol * solPrice) / token.price;
      return tokens > 0 ? { tokens } : null;
    }
    const grossSol = (swapParams.tradeTokensUi * token.price) / solPrice;
    const netSol   = grossSol * (1 - PUMP_FEE_BPS / 10000);
    return netSol > 0 ? { sol: netSol } : null;
  }, [swapParams, token?.price, solPrice]);

  const hasFunds = (() => {
    if (!amount || Number(amount) <= 0) return false;
    if (isBuy) return Number(amount) <= availSol;
    return ownedUiAmount > 0 && (solBalance || 0) >= 0.003;
  })();

  // execute — verbatim from LaunchRadar executeSwap
  const handleConfirm = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      onConnectWallet?.();
      return;
    }
    if (!swapParams) return;
    setConfirming(true);
    setError(null);
    setSwapResult(null);

    try {
      const route = await getPumpRoute({
        action: swapParams.mode === 'buy' ? 'buy' : 'sell',
        mint:   token.mint,
        user:   publicKey,
        amount: swapParams.mode === 'buy' ? swapParams.tradeLamports : swapParams.tradeTokens,
        decimals: swapParams.mode === 'buy' ? undefined : swapParams.decimals,
        connection,
      });

      const feeLamports = BigInt(swapParams.feeLamports || '0');
      if (feeLamports <= 0n) {
        throw new Error(swapParams.mode === 'buy'
          ? 'Fee rounds to zero — amount too small.'
          : 'Could not estimate sell fee — token or SOL price unavailable.');
      }
      const feeIx = SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey:   FEE_WALLET,
        lamports:   Number(feeLamports),
      });

      const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
      const ixs = route.instructions.slice();
      if (swapParams.mode === 'buy') {
        let insertAt = 0;
        while (insertAt < ixs.length && ixs[insertAt].programId.toBase58() === CB_PROGRAM) insertAt++;
        ixs.splice(insertAt, 0, feeIx);
      } else {
        ixs.push(feeIx);
      }

      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey:        publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs,
      }).compileToV0Message(route.alts);
      const tx = new VersionedTransaction(message);

      let simLogs = null;
      try {
        const sim = await connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'processed',
        });
        simLogs = sim?.value?.logs || null;
        if (sim?.value?.err) {
          throw new Error(describeSimLogs(simLogs, JSON.stringify(sim.value.err)));
        }
      } catch (simErr) {
        if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr;
        console.warn('[hp-pump sim non-fatal]', simErr?.message);
      }

      const signed = await signTransaction(tx);
      const raw = signed.serialize();

      let sig;
      try {
        sig = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries:    5,
        });
      } catch (sendErr) {
        let logs = sendErr?.logs || null;
        if (!logs && typeof sendErr?.getLogs === 'function') {
          try { logs = await sendErr.getLogs(connection); } catch {}
        }
        throw new Error(describeSimLogs(logs, sendErr?.message));
      }

      let confirmed = false, onchainErr = null;
      const startedAt = Date.now();
      const HARD_CAP_MS = 60_000;
      while (Date.now() - startedAt < HARD_CAP_MS) {
        try {
          const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          if (st?.value?.err) { onchainErr = st.value.err; break; }
          const cs = st?.value?.confirmationStatus;
          if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
        } catch {}
        try {
          const h = await connection.getBlockHeight('confirmed');
          if (h > latest.lastValidBlockHeight) break;
        } catch {}
        try { await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }
      if (onchainErr) {
        throw new Error('Trade failed on-chain — price likely moved past slippage.');
      }

      setSwapResult({ signature: sig, pending: !confirmed });
      if (confirmed) setTimeout(() => onTradeComplete?.(), 2000);
    } catch (e) {
      console.error('[hp-pump swap]', e);
      setError(friendlyError(e));
    } finally {
      setConfirming(false);
    }
  }, [
    connected, publicKey, signTransaction, swapParams,
    token.mint, connection, onConnectWallet, onTradeComplete,
  ]);

  const setMaxBuy = () => {
    if (!isBuy || availSol <= 0) return;
    setAmount(String(Math.floor(availSol * 10000) / 10000));
  };

  const confirmDisabled = confirming || !swapParams || !hasFunds || !!error;
  const ctaLabel = confirming
    ? (isBuy ? 'Buying…' : 'Selling…')
    : !connected
      ? 'Connect Wallet'
      : !amount || Number(amount) <= 0
        ? (isBuy ? 'Enter SOL amount' : 'Enter percentage')
        : !hasFunds
          ? (isBuy
              ? 'Insufficient SOL'
              : (ownedUiAmount <= 0 ? `No ${meta.symbol} to sell` : 'Need ~0.003 SOL for fees'))
          : (isBuy ? `Buy ${amount} SOL of ${meta.symbol}`
                   : `Sell ${Math.min(100, Number(amount)).toFixed(0)}% of ${meta.symbol}`);

  return (
    <>
      <div className="hp-sheet-backdrop" onClick={confirming ? undefined : onClose} />
      <div className="hp-sheet">
        <div className="hp-grabber" />

        <div className="hp-sheet-head">
          <MintIcon mint={token.mint} meta={meta} size={46} />
          <div className="hp-sheet-title-wrap">
            <div className="hp-sheet-title">{meta.symbol}</div>
            <div className="hp-sheet-sub">
              {meta.name} · {token.price > 0 ? fmtUsd(token.price) : 'no price'}
              <span className="hp-route-badge hp-route-pump">PUMP.FUN</span>
            </div>
          </div>
          <button type="button" className="hp-sheet-close" onClick={onClose} disabled={confirming}>×</button>
        </div>

        <div className="hp-side-switch">
          {['buy', 'sell'].map(s => {
            const active = mode === s;
            return (
              <button
                key={s}
                type="button"
                className={'hp-side-btn' + (active ? ` hp-active hp-${s}` : '')}
                onClick={() => !confirming && setMode(s)}
                disabled={confirming}
              >{s === 'buy' ? 'Buy with SOL' : 'Sell to SOL'}</button>
            );
          })}
        </div>

        <div className="hp-sheet-body">
          <div className="hp-amount-label">
            <span>{isBuy ? 'YOU PAY' : 'YOU SELL (% OF HOLDING)'}</span>
            <span className="hp-amount-bal">
              {isBuy
                ? <>Wallet: <b>{fmtTokenAmt(solBalance || 0)}</b> SOL</>
                : <>You own: <b>{fmtTokenAmt(ownedUiAmount)}</b> {meta.symbol}</>}
              {isBuy && availSol > 0 && (
                <button type="button" className="hp-max-btn" onClick={setMaxBuy}>MAX</button>
              )}
            </span>
          </div>

          <div className="hp-amount-wrap">
            <div className="hp-amount-chip">
              {isBuy
                ? <MintIcon mint={SOL_MINT} meta={meta} size={22} />
                : <div className="hp-amount-chip-icon" />}
              {isBuy ? 'SOL' : '%'}
            </div>
            <input
              className="hp-amount-input"
              type="text"
              inputMode="decimal"
              placeholder={isBuy ? '0.00' : '0-100'}
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                if (!isBuy && Number(v) > 100) { setAmount('100'); return; }
                setAmount(v);
              }}
              disabled={confirming}
            />
          </div>
          {!isBuy && amount && (
            <div className="hp-amount-equiv">
              {Math.min(100, Math.max(0, Number(amount) || 0)).toFixed(0)}% of holding
            </div>
          )}

          <div className="hp-presets">
            {presets.map(v => {
              const active = Number(amount) === v;
              return (
                <button key={v} type="button"
                  className={'hp-preset' + (active ? ' hp-preset-active' : '')}
                  onClick={() => setAmount(String(v))}
                  disabled={confirming}>
                  {isBuy ? `${v} SOL` : `${v}%`}
                </button>
              );
            })}
          </div>

          {swapParams && Number(amount) > 0 && (
            <div className="hp-receive">
              <div className="hp-receive-head">
                <span>YOU RECEIVE (EST.)</span>
              </div>
              <div className={'hp-receive-val' + (estReceive ? '' : ' hp-muted')}>
                {isBuy
                  ? (estReceive?.tokens > 0 ? `≈ ${fmtTokenAmt(estReceive.tokens)} ${meta.symbol}` : '—')
                  : (estReceive?.sol > 0   ? `≈ ${fmtTokenAmt(estReceive.sol)} SOL`           : '—')}
              </div>
              <div className="hp-receive-meta">
                {isBuy ? (
                  <>
                    <div className="hp-receive-meta-row">
                      <span>To curve</span>
                      <span>{fmtTokenAmt(Number(swapParams.tradeLamports) / 1e9)} SOL</span>
                    </div>
                    <div className="hp-receive-meta-row">
                      <span>Platform fee (3%)</span>
                      <span>{fmtTokenAmt(Number(swapParams.feeLamports) / 1e9)} SOL</span>
                    </div>
                    <div className="hp-receive-meta-row">
                      <span>Wallet pays</span>
                      <span>{fmtTokenAmt(Number(swapParams.totalLamports) / 1e9)} SOL</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="hp-receive-meta-row">
                      <span>Selling</span>
                      <span>{fmtTokenAmt(swapParams.tradeTokensUi)} {meta.symbol}</span>
                    </div>
                    <div className="hp-receive-meta-row">
                      <span>Platform fee (3%)</span>
                      <span>in SOL (after curve)</span>
                    </div>
                  </>
                )}
                <div className="hp-receive-meta-row">
                  <span>Route</span>
                  <span>pump.fun bonding curve</span>
                </div>
              </div>
            </div>
          )}

          {error && (<div className="hp-sheet-error">{error}</div>)}
          {swapResult && (
            <div className="hp-sheet-success">
              {swapResult.pending ? 'Submitted but still confirming. ' : 'Trade confirmed. '}
              <a href={`https://solscan.io/tx/${swapResult.signature}`} target="_blank" rel="noreferrer">
                View on Solscan
              </a>
            </div>
          )}
        </div>

        <div className="hp-cta-wrap">
          <button
            type="button"
            className={'hp-cta ' + (isBuy ? 'hp-cta-buy' : 'hp-cta-sell')}
            onClick={!connected ? onConnectWallet : handleConfirm}
            disabled={connected ? confirmDisabled : false}
          >
            {ctaLabel}
          </button>
          <div className="hp-cta-foot">
            Routed via <b>pump.fun</b> · Your keys, your coins
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN
// =====================================================================
const SORT_OPTIONS = [
  { id: 'value',   label: 'Value' },
  { id: 'newest',  label: 'Newest' },
  { id: 'name',    label: 'A–Z'   },
  { id: 'balance', label: 'Balance' },
];

const SEEN_STORAGE_PREFIX = 'nx_holdings_seen_v1:';
function loadSeenMap(walletAddress) {
  if (!walletAddress) return {};
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_PREFIX + walletAddress);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}
function saveSeenMap(walletAddress, map) {
  if (!walletAddress) return;
  try { localStorage.setItem(SEEN_STORAGE_PREFIX + walletAddress, JSON.stringify(map)); } catch {}
}

export default function Holdings({ onConnectWallet }) {
  useHpCSS();

  // Wallet identity: the adapter (useWallet) is the source of truth — it's what
  // signs every trade on this page and across the app. The Nexus context is a
  // fallback. Previously balance keyed ONLY off useNexusWallet().walletAddress,
  // so when the adapter was connected but that context lagged/returned empty,
  // loadPortfolio early-returned and the balance never showed. Deriving from the
  // adapter first fixes that; isConnected is true if EITHER source is connected.
  const { isConnected: nexusConnected, walletAddress: nexusAddr } = useNexusWallet();
  const { publicKey, signTransaction, connected } = useWallet();
  const walletAddress = publicKey ? publicKey.toBase58() : (nexusAddr || null);
  const isConnected   = connected || nexusConnected || !!publicKey;

  const [portfolio, setPortfolio]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState('');
  const [sortBy, setSortBy]         = useState('value');
  const [query, setQuery]           = useState('');
  const [drawer, setDrawer]         = useState(null);
  const [seenMap, setSeenMap]       = useState({});
  const inFlightRef = useRef(false);

  useEffect(() => {
    setSeenMap(loadSeenMap(walletAddress));
  }, [walletAddress]);

  const loadPortfolio = useCallback(async (isInitial) => {
    if (!walletAddress) { setLoading(false); return; }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!isInitial) setRefreshing(true);
    setError('');
    try {
      const result = await fetchPortfolio(walletAddress);
      setPortfolio(result);
      const existing = loadSeenMap(walletAddress);
      const now = Date.now();
      let touched = false;
      for (const t of (result?.tokens || [])) {
        if (!existing[t.mint]) { existing[t.mint] = now; touched = true; }
      }
      if (touched) {
        saveSeenMap(walletAddress, existing);
        setSeenMap(existing);
      }
    } catch (e) {
      console.warn('[Holdings] portfolio failed', e);
      setError('Failed to load wallet');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) { setLoading(false); setPortfolio(null); return; }
    setLoading(true);
    setPortfolio(null);
    loadPortfolio(true);
  }, [walletAddress, loadPortfolio]);

  const handleRefresh = useCallback(() => loadPortfolio(false), [loadPortfolio]);

  const sortedTokens = useMemo(() => {
    if (!portfolio?.tokens) return [];
    const arr = [...portfolio.tokens];
    if (sortBy === 'name') {
      arr.sort((a, b) => (a.meta.symbol || '').localeCompare(b.meta.symbol || ''));
    } else if (sortBy === 'balance') {
      arr.sort((a, b) => (b.uiAmount || 0) - (a.uiAmount || 0));
    } else if (sortBy === 'newest') {
      arr.sort((a, b) => {
        const ta = seenMap[a.mint] || 0;
        const tb = seenMap[b.mint] || 0;
        if (tb !== ta) return tb - ta;
        return (b.value || 0) - (a.value || 0);
      });
    } else {
      arr.sort((a, b) => (b.value || 0) - (a.value || 0));
    }
    return arr;
  }, [portfolio, sortBy, seenMap]);

  // ─── ROUTING ──────────────────────────────────────────────────────
  // SOL row                  → JupiterDrawer (SOL→USDC).
  // Pump.fun / PumpSwap      → PumpfunDrawer (detected via DexScreener,
  //                            with mint-suffix as fallback).
  // Brand xStock mints       → XstockDrawer.
  // Everything else          → JupiterDrawer.
  // ─────────────────────────────────────────────────────────────────
  const openTrade = useCallback((token, mode) => {
    if (!token?.mint) return;

    if (token.mint === SOL_MINT) {
      setDrawer({ token, mode, route: 'jupiter' });
      return;
    }

    setDrawer({ token, mode, route: getTokenRoute(token) });
  }, []);

  const openBuy  = useCallback((token) => openTrade(token, 'buy'),  [openTrade]);
  const openSell = useCallback((token) => openTrade(token, 'sell'), [openTrade]);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  // Disconnected screen
  if (!isConnected) {
    return (
      <div className="hp-root">
        <div className="hp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
        <div className="hp-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
        <div className="hp-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

        <div className="hp-inner">
          <div className="hp-head">
            <div className="hp-head-brand">
              <div className="hp-head-dot"/>
              <span className="hp-head-text">
                wallet<span className="slash">//</span><span className="grad">holdings</span>
              </span>
            </div>
          </div>
          <div className="hp-hero">
            <button type="button" onClick={() => onConnectWallet?.()} className="hp-connect-btn">
              Connect wallet →
            </button>
          </div>
          <div className="hp-foot">
            <span className="hp-foot-label">powered by</span>
            <span className="hp-foot-name">jupiter</span>
            <span className="hp-foot-sep">·</span>
            <span className="hp-foot-label">non-custodial</span>
          </div>
        </div>
      </div>
    );
  }

  // Loading
  if (loading && !portfolio) {
    return (
      <div className="hp-root">
        <div className="hp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
        <div className="hp-inner">
          <div className="hp-head">
            <div className="hp-head-brand">
              <div className="hp-head-dot"/>
              <span className="hp-head-text">holdings</span>
            </div>
          </div>
          <div className="hp-loading">
            <div className="hp-loading-spinner"/>
            <div className="hp-loading-text">Loading holdings</div>
          </div>
        </div>
      </div>
    );
  }

  // Ready
  const solBalance  = portfolio?.solBalance  || 0;
  const solPriceUsd = portfolio?.solPriceUsd || 0;
  const tokens      = sortedTokens;
  const solValue    = solBalance * solPriceUsd;
  const tokensTotal = tokens.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue  = solValue + tokensTotal;
  const tokenCount  = tokens.length + (solBalance > 0 ? 1 : 0);

  const solHolding = {
    mint:      SOL_MINT,
    meta:      { symbol: 'SOL', name: 'Solana', color: '#B794F6', icon: null, decimals: 9 },
    price:     solPriceUsd,
    value:     solValue,
    uiAmount:  solBalance,
    rawAmount: BigInt(portfolio?.solLamports || 0),
    decimals:  9,
    isToken2022: false,
    hasPrice:  solPriceUsd > 0,
  };

  const tokenBalanceFor = (mint) => {
    if (mint === SOL_MINT) return null;
    return tokens.find(t => t.mint === mint) || null;
  };

  const qRaw = query.trim();
  const q    = qRaw.toLowerCase();
  const matchHolding = (t) => {
    if (!qRaw) return true;
    if (t.mint && (t.mint === qRaw || t.mint.startsWith(qRaw))) return true;
    const m = t.meta || {};
    return (
      (m.symbol || '').toLowerCase().includes(q) ||
      (m.name   || '').toLowerCase().includes(q)
    );
  };
  const showSol       = matchHolding(solHolding);
  const visibleTokens = tokens.filter(matchHolding);
  const noMatches     = !showSol && visibleTokens.length === 0;

  // Pick the right drawer for the open token. Honor the route field
  // set by openTrade (so we never re-decide and accidentally route a
  // pump mint back to Jupiter).
  let drawerEl = null;
  if (drawer) {
    const isSolRow = drawer.token.mint === SOL_MINT;
    const route = isSolRow
      ? 'jupiter'
      : (drawer.route || getTokenRoute(drawer.token));
    const sharedProps = {
      token: drawer.token,
      initialMode: drawer.mode,
      solBalance,
      tokenBalance: tokenBalanceFor(drawer.token.mint),
      solPrice: solPriceUsd,
      publicKey,
      signTransaction,
      connected,
      onClose: closeDrawer,
      onConnectWallet,
      onTradeComplete: () => { handleRefresh(); },
    };
    if (route === 'xstock')        drawerEl = <XstockDrawer  {...sharedProps} />;
    else if (route === 'pumpfun')  drawerEl = <PumpfunDrawer {...sharedProps} />;
    else                           drawerEl = <JupiterDrawer {...sharedProps} isSol={isSolRow} />;
  }

  return (
    <div className="hp-root">
      <div className="hp-blob" style={{ width: 380, height: 380, background: '#FF8FBE', top: -80, left: -120 }}/>
      <div className="hp-blob" style={{ width: 440, height: 440, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
      <div className="hp-blob" style={{ width: 320, height: 320, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }}/>

      <div className="hp-inner">
        <div className="hp-head">
          <div className="hp-head-brand">
            <div className="hp-head-dot"/>
            <span className="hp-head-text">
              wallet<span className="slash">//</span><span className="grad">holdings</span>
            </span>
          </div>
        </div>

        <a
          className="hp-moonpay"
          href={
            'https://buy.moonpay.com/?defaultCurrencyCode=sol&baseCurrencyCode=usd' +
            (walletAddress ? '&walletAddress=' + encodeURIComponent(walletAddress) : '')
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="hp-moonpay-left">
            <span className="hp-moonpay-icon">◎</span>
            <span className="hp-moonpay-text">
              <span className="hp-moonpay-title">Buy <em>Solana</em> with USD</span>
              <span className="hp-moonpay-sub">via MoonPay · card or bank</span>
            </span>
          </span>
          <span className="hp-moonpay-arrow">→</span>
        </a>

        <div className="hp-search-wrap">
          <input
            className="hp-search"
            type="text"
            inputMode="search"
            placeholder="Search name, symbol, or contract address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="hp-balance-card">
          <div className="hp-bal-top">
            <div className="hp-status-pill">
              <span className="hp-status-dot"/>
              <span className="hp-status-text">{tokenCount} {tokenCount === 1 ? 'ASSET' : 'ASSETS'}</span>
            </div>
            <button type="button" onClick={handleRefresh} disabled={refreshing}
              className={'hp-refresh' + (refreshing ? ' spinning' : '')} aria-label="Refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
          <div className="hp-bal-label">TOTAL VALUE</div>
          <div className="hp-bal-value">{fmtUsd(totalValue)}</div>
          <div className="hp-bal-sub">
            {fmtTokenAmt(solBalance)} SOL · {tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}
          </div>
        </div>

        <div className="hp-sort-head">
          <div className="hp-sort-label">sort by</div>
          <div className="hp-sort-meta">JUPITER PRICES</div>
        </div>
        <div className="hp-sort-chips">
          {SORT_OPTIONS.map(opt => (
            <button key={opt.id} type="button"
              className={'hp-sort-chip' + (sortBy === opt.id ? ' hp-active' : '')}
              onClick={() => setSortBy(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>

        {error && (<div className="hp-error">{error}</div>)}

        <div className="hp-list">
          {showSol && (
            <HoldingRow
              token={solHolding}
              idx={0}
              onBuy={openBuy}
              onSell={openSell}
            />
          )}
          {!qRaw && tokens.length === 0 && (
            <div className="hp-empty">
              <div className="hp-empty-title">No other holdings yet.</div>
              <div className="hp-empty-sub">Tokens under ${MIN_TOKEN_VALUE_USD} are hidden.</div>
            </div>
          )}
          {qRaw && noMatches && (
            <div className="hp-empty">
              <div className="hp-empty-title">No matches.</div>
              <div className="hp-empty-sub">Try a different name, symbol, or contract address.</div>
            </div>
          )}
          {visibleTokens.map((t, i) => (
            <HoldingRow
              key={t.mint}
              token={t}
              idx={i + 1}
              onBuy={openBuy}
              onSell={openSell}
            />
          ))}
        </div>

        <div className="hp-foot">
          <span className="hp-foot-label">powered by</span>
          <span className="hp-foot-name">jupiter</span>
          <span className="hp-foot-sep">·</span>
          <span className="hp-foot-label">non-custodial</span>
        </div>
      </div>

      {drawerEl}
    </div>
  );
}
