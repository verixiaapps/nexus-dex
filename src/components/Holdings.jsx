// src/components/Holdings.jsx — wallet holdings page with per-token buy/sell drawer.
//
// Wonderland palette (matches GetStarted.jsx DNA). Shows every SPL token in the
// connected wallet (legacy + Token-2022) + SOL pinned top, with sort options and
// a buy/sell drawer that reuses the atomic Jupiter swap flow from SwapWidget /
// MemeWonderland (3% fee → FEE_WALLET, single signed tx).
//
// DATA — same `fetchPortfolio` pattern as GetStarted.jsx:
//   • Batched JSON-RPC via /api/solana-rpc (getBalance + both SPL programs)
//   • Jupiter meta (/api/jupiter/tokens/search) + Jupiter prices (lite-api.jup.ag)
//   • Manual refresh only. No polling.
//   • SOL always shows (pinned top). Other tokens need ≥ MIN_TOKEN_VALUE_USD ($1).
//
// PROPS
//   isConnected, solConnected, walletAddress, publicKey, activeWalletKind
//   onConnectWallet — opens the WalletModal (passed from App.js)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
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
// INLINE CSS — Wonderland palette · Instrument Serif + Space Grotesk
// (same DNA as GetStarted.jsx, prefixed .hp- to avoid collisions)
// =====================================================================
const HP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.hp-root{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --pink:#FF8FBE; --mint:#7FFFD4; --lav:#B794F6; --peach:#FFB088;
  --sky:#A0E7FF; --gold:#FFD46B; --cyan:#3DD4F5;
  --green:#1B7A4F; --red:#D14B6A;
  --glass:rgba(255,255,255,0.6); --glass-strong:rgba(255,255,255,0.78);
  --border:rgba(183,148,246,0.22);
  --border-hi:rgba(61,212,245,0.32);
  --hairline:rgba(26,27,78,0.08);

  position:relative;min-height:100vh;min-height:100dvh;
  padding:0 0 40px;overflow-x:hidden;
  color:var(--ink);
  font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;
  background:
    radial-gradient(ellipse at 20% 5%,#FFE8F4 0%,transparent 45%),
    radial-gradient(ellipse at 85% 15%,#E4F2FF 0%,transparent 45%),
    radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),
    radial-gradient(ellipse at 15% 95%,#FFF3E4 0%,transparent 45%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  background-attachment:fixed;
  border-radius:24px;
}
.hp-root,.hp-root *{box-sizing:border-box}

@keyframes hpDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes hpPulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes hpRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes hpSpin{to{transform:rotate(360deg)}}
@keyframes hpShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes hpSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes hpFade{from{opacity:0}to{opacity:1}}

.hp-blob{
  position:absolute;border-radius:50%;filter:blur(70px);opacity:0.45;
  animation:hpDrift 14s ease-in-out infinite;pointer-events:none;z-index:0;
}

.hp-inner{max-width:520px;margin:0 auto;position:relative;z-index:5;padding:0}

/* HEADER */
.hp-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px 4px;
}
.hp-head-brand{display:flex;align-items:center;gap:10px}
.hp-head-dot{
  width:28px;height:28px;border-radius:50%;
  background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);
  box-shadow:0 0 14px rgba(183,148,246,0.5);
}
.hp-head-text{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.hp-head-text .slash{opacity:0.4;margin:0 3px;font-style:normal}
.hp-head-text .grad{
  background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}

/* DISCONNECTED HERO */
.hp-hero{padding:32px 22px 10px;text-align:center;position:relative;z-index:2}
.hp-hero-eyebrow{
  display:inline-flex;align-items:center;gap:7px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);border-radius:999px;
  padding:6px 14px;margin-bottom:16px;
  font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.5px;
}
.hp-hero-eyebrow .dot{
  width:6px;height:6px;border-radius:50%;
  background:var(--pink);box-shadow:0 0 8px var(--pink);
}
.hp-hero h1{
  font-family:"Instrument Serif",serif;font-weight:400;
  font-size:48px;line-height:0.95;letter-spacing:-0.015em;
  margin:0 0 14px;
}
.hp-hero h1 .shim{
  font-style:italic;
  background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE);
  background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  animation:hpShimmer 6s linear infinite;
}
.hp-hero-sub{
  color:var(--ink-2);font-size:14px;font-weight:500;
  margin:0 auto 20px;max-width:340px;line-height:1.45;
}
.hp-connect-btn{
  display:inline-flex;align-items:center;gap:8px;
  background:linear-gradient(135deg,#A0E7FF,#FF8FBE);
  border:none;border-radius:999px;
  padding:13px 24px;cursor:pointer;color:var(--ink);
  font-family:"Instrument Serif",serif;font-style:italic;font-size:17px;
  box-shadow:0 8px 24px rgba(160,231,255,.35);
  transition:transform .15s;
}
.hp-connect-btn:hover{transform:translateY(-1px)}
.hp-connect-btn:active{transform:translateY(1px)}

/* BALANCE CARD */
.hp-balance-card{
  margin:14px 22px 0;padding:22px 22px;border-radius:32px 56px 32px 56px;
  background:linear-gradient(135deg,rgba(255,143,190,.20),rgba(183,148,246,.16) 50%,rgba(127,255,212,.16));
  border:1px solid rgba(255,255,255,.8);backdrop-filter:blur(14px);
  position:relative;overflow:hidden;
  box-shadow:0 12px 32px rgba(255,143,190,.15);
  animation:hpRise .5s cubic-bezier(.2,.8,.2,1) backwards;
}
.hp-balance-card::before{
  content:'';position:absolute;inset:0;
  background:radial-gradient(circle at 20% 20%,rgba(255,143,190,.3),transparent 50%);
  pointer-events:none;
}
.hp-bal-top{
  display:flex;justify-content:space-between;align-items:center;
  margin-bottom:14px;position:relative;z-index:2;
}
.hp-status-pill{
  display:inline-flex;align-items:center;gap:7px;
  background:var(--glass-strong);border:1px solid var(--border);
  padding:5px 11px;border-radius:999px;
}
.hp-status-dot{
  width:6px;height:6px;border-radius:50%;background:var(--green);
  box-shadow:0 0 8px var(--green);animation:hpPulse 1.8s ease-in-out infinite;
}
.hp-status-text{color:var(--ink);font-size:9px;font-weight:700;letter-spacing:1.4px}
.hp-refresh{
  width:34px;height:34px;border-radius:50%;
  background:var(--glass-strong);border:1px solid var(--border);
  display:grid;place-items:center;cursor:pointer;color:var(--ink-2);
  transition:all .15s;
}
.hp-refresh:hover{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);border-color:#7FFFD4}
.hp-refresh:disabled{cursor:wait;opacity:.6}
.hp-refresh.spinning svg{animation:hpSpin 1s linear infinite}
.hp-bal-label{
  font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.8px;
  margin-bottom:6px;position:relative;z-index:2;
}
.hp-bal-value{
  font-family:"Instrument Serif",serif;font-size:48px;font-weight:400;
  line-height:0.95;letter-spacing:-.025em;color:var(--ink);
  margin-bottom:4px;font-variant-numeric:tabular-nums;
  position:relative;z-index:2;
}
.hp-bal-sub{
  font-size:11px;color:var(--ink-2);font-weight:600;letter-spacing:.4px;
  position:relative;z-index:2;
}

/* SORT BAR */
.hp-sort-head{
  display:flex;justify-content:space-between;align-items:center;
  padding:24px 26px 12px;position:relative;z-index:2;
}
.hp-sort-label{
  font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;
  background:linear-gradient(90deg,#FF8FBE,#B794F6);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.hp-sort-meta{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:.8px}

.hp-sort-chips{
  display:flex;gap:6px;padding:0 22px;margin-bottom:12px;
  overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;
  position:relative;z-index:2;
}
.hp-sort-chips::-webkit-scrollbar{display:none}
.hp-sort-chip{
  flex-shrink:0;padding:8px 14px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);color:var(--ink-2);
  font-family:"Space Grotesk",sans-serif;font-size:11px;font-weight:700;letter-spacing:.4px;
  cursor:pointer;transition:all .15s;white-space:nowrap;
}
.hp-sort-chip:hover{border-color:var(--lav);color:var(--ink)}
.hp-sort-chip.hp-active{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  color:var(--ink);border-color:#7FFFD4;
  box-shadow:0 4px 12px rgba(127,255,212,.35);
}

/* HOLDINGS LIST */
.hp-list{
  margin:0 22px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);border-radius:24px;overflow:hidden;
  position:relative;z-index:2;
}
.hp-row{
  padding:14px 16px;display:grid;
  grid-template-columns:42px 1fr auto;gap:12px;align-items:center;
  border-bottom:1px solid var(--border);
  animation:hpRise .35s cubic-bezier(.2,.8,.2,1) backwards;
}
.hp-row:last-child{border-bottom:none}
.hp-row.hp-row-sol{
  background:linear-gradient(135deg,rgba(183,148,246,.10),transparent);
}
.hp-h-badge{
  width:42px;height:42px;border-radius:50%;display:grid;place-items:center;flex-shrink:0;
  font-family:"Instrument Serif",serif;font-size:20px;font-weight:400;color:#fff;
}
.hp-h-badge-img{width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(255,255,255,.5)}
.hp-h-mid{min-width:0}
.hp-h-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hp-h-sym{font-family:"Instrument Serif",serif;font-size:18px;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.hp-h-tag{
  font-size:8px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#FFD46B,#FFB088);
  padding:2px 6px;border-radius:5px;letter-spacing:.8px;
}
.hp-h-tag.hp-tag-sol{
  background:linear-gradient(135deg,#B794F6,#FF8FBE);
}
.hp-h-tag.hp-tag-stable{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  color:var(--ink);
}
.hp-h-tag.hp-tag-pump{
  background:linear-gradient(135deg,#FFB088,#FFD46B);
  color:var(--ink);
}
.hp-h-sub{
  font-size:11px;color:var(--ink-2);margin-top:3px;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;
}
.hp-h-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.hp-h-value{
  font-family:"Instrument Serif",serif;font-size:18px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.hp-h-actions{display:flex;gap:5px}
.hp-act-btn{
  border:none;cursor:pointer;
  padding:6px 12px;border-radius:999px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:.6px;transition:all .15s;
}
.hp-act-buy{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  color:var(--ink);box-shadow:0 2px 8px rgba(127,255,212,.30);
}
.hp-act-buy:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(127,255,212,.40)}
.hp-act-sell{
  background:linear-gradient(135deg,#FF8FBE,#FFB088);
  color:#fff;box-shadow:0 2px 8px rgba(255,143,190,.30);
}
.hp-act-sell:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(255,143,190,.40)}

/* EMPTY / LOADING */
.hp-empty{padding:30px 22px;text-align:center}
.hp-empty-title{color:var(--ink-2);font-size:13px;font-weight:600;margin-bottom:4px}
.hp-empty-sub{color:var(--ink-3);font-size:11px;font-weight:500}
.hp-loading{
  margin:14px 22px 0;padding:60px 22px;border-radius:24px;text-align:center;
  background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border);
}
.hp-loading-spinner{
  width:32px;height:32px;border-radius:50%;margin:0 auto 14px;
  border:2.5px solid rgba(183,148,246,.20);border-top-color:var(--lav);
  animation:hpSpin .8s linear infinite;
}
.hp-loading-text{
  font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.4px;text-transform:uppercase;
}
.hp-error{
  margin:14px 22px 0;padding:14px 16px;border-radius:14px;
  background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.30);
  color:var(--red);font-size:12px;font-weight:600;
}

/* FOOTER */
.hp-foot{
  display:flex;align-items:center;justify-content:center;gap:9px;
  margin:24px 22px 0;padding:14px 16px;border-radius:16px;
  background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);
}
.hp-foot-label{font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:.6px}
.hp-foot-name{
  font-family:"Instrument Serif",serif;font-style:italic;font-size:14px;
  background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.hp-foot-sep{color:var(--ink-3);font-size:10px}

/* ─── TRADE DRAWER ──────────────────────────────────────────────── */
.hp-sheet-backdrop{
  position:fixed;inset:0;background:rgba(26,27,78,0.40);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  z-index:998;animation:hpFade .2s;
}
.hp-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:999;max-height:90dvh;
  display:flex;flex-direction:column;overflow:hidden;
  background:
    radial-gradient(ellipse at 20% 0%,#FFE8F4 0%,transparent 50%),
    radial-gradient(ellipse at 80% 0%,#D9ECFF 0%,transparent 50%),
    linear-gradient(180deg,#FBF5FF 0%,#EEF3FF 100%);
  border-top:1px solid rgba(255,255,255,.8);
  border-radius:28px 28px 0 0;
  box-shadow:0 -20px 60px rgba(26,27,78,.18);
  animation:hpSlideUp .35s cubic-bezier(.2,1.2,.4,1);
}
.hp-grabber{
  width:40px;height:4px;background:rgba(26,27,78,.18);
  border-radius:99px;margin:10px auto 12px;flex-shrink:0;
}
.hp-sheet-head{
  flex-shrink:0;padding:0 22px 12px;
  display:flex;align-items:center;gap:12px;
}
.hp-sheet-badge{
  width:46px;height:46px;border-radius:50%;flex-shrink:0;
  display:grid;place-items:center;color:#fff;
  font-family:"Instrument Serif",serif;font-size:20px;
}
.hp-sheet-badge-img{
  width:46px;height:46px;border-radius:50%;flex-shrink:0;object-fit:cover;
}
.hp-sheet-title-wrap{flex:1;min-width:0}
.hp-sheet-title{
  font-family:"Instrument Serif",serif;font-size:22px;line-height:1;
  letter-spacing:-.015em;color:var(--ink);
}
.hp-sheet-sub{font-size:12px;color:var(--ink-2);margin-top:3px;font-weight:500}
.hp-route-badge{
  display:inline-block;margin-left:8px;
  font-family:"JetBrains Mono",monospace;font-size:8px;font-weight:800;
  padding:2px 7px;border-radius:6px;letter-spacing:1px;vertical-align:middle;
}
.hp-route-badge.hp-route-jup   {background:linear-gradient(135deg,#A0E7FF,#B794F6);color:#fff}
.hp-route-badge.hp-route-xstock{background:linear-gradient(135deg,#FFD46B,#FFB088);color:var(--ink)}
.hp-route-badge.hp-route-pump  {background:linear-gradient(135deg,#FFB088,#FFD46B);color:var(--ink)}
.hp-sheet-close{
  width:34px;height:34px;border-radius:50%;flex-shrink:0;
  background:var(--glass-strong);border:1px solid var(--border);
  color:var(--ink);font-size:18px;cursor:pointer;
  display:grid;place-items:center;
}
.hp-sheet-close:disabled{cursor:not-allowed;opacity:.5}

.hp-side-switch{
  display:flex;margin:0 22px 14px;padding:4px;gap:4px;
  background:var(--glass-strong);border:1px solid var(--border);border-radius:999px;
  flex-shrink:0;
}
.hp-side-btn{
  flex:1;padding:10px 0;border-radius:999px;border:none;background:transparent;
  color:var(--ink-2);font-family:"Space Grotesk",sans-serif;font-size:12px;font-weight:700;
  cursor:pointer;letter-spacing:.4px;transition:all .2s;
}
.hp-side-btn:disabled{cursor:not-allowed;opacity:.5}
.hp-side-btn.hp-active.hp-buy{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  box-shadow:0 3px 10px rgba(127,255,212,.35);
}
.hp-side-btn.hp-active.hp-sell{
  background:linear-gradient(135deg,#FF8FBE,#FFB088);color:#fff;
  box-shadow:0 3px 10px rgba(255,143,190,.35);
}

.hp-sheet-body{
  flex:1;overflow-y:auto;padding:0 22px 12px;min-height:0;
  -webkit-overflow-scrolling:touch;
}

.hp-amount-label{
  display:flex;justify-content:space-between;align-items:center;
  font-family:"JetBrains Mono",monospace;font-size:10px;
  color:var(--ink-2);font-weight:700;letter-spacing:1.4px;
  margin-bottom:8px;
}
.hp-amount-bal{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:600;display:flex;align-items:center;gap:6px}
.hp-amount-bal b{color:var(--ink);font-weight:700}
.hp-max-btn{
  background:rgba(183,148,246,.18);border:1px solid rgba(183,148,246,.35);
  color:#5A3C9E;padding:3px 8px;border-radius:7px;
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;cursor:pointer;
  letter-spacing:.5px;
}
.hp-amount-wrap{
  background:var(--glass-strong);border:1.5px solid var(--border);
  border-radius:16px;padding:14px 16px;margin-bottom:10px;
  display:flex;align-items:center;gap:10px;transition:all .2s;
}
.hp-amount-wrap:focus-within{border-color:var(--lav);box-shadow:0 0 0 4px rgba(183,148,246,.10)}
.hp-amount-input{
  flex:1;background:transparent;border:none;outline:none;
  font-family:"Instrument Serif",serif;font-size:32px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;text-align:right;min-width:0;width:100%;
}
.hp-amount-input::placeholder{color:var(--ink-3)}
.hp-amount-chip{
  display:flex;align-items:center;gap:6px;flex-shrink:0;
  padding:7px 11px 7px 6px;border-radius:999px;
  background:rgba(160,231,255,.18);border:1px solid var(--border);
  font-family:"Instrument Serif",serif;font-size:15px;color:var(--ink);
}
.hp-amount-chip-icon{
  width:22px;height:22px;border-radius:50%;flex-shrink:0;object-fit:cover;
  background:linear-gradient(135deg,#B794F6,#7FFFD4);
}
.hp-amount-equiv{
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);
  font-weight:500;text-align:right;margin:-4px 4px 8px;
}

.hp-presets{display:flex;gap:6px;margin-bottom:12px}
.hp-preset{
  flex:1;padding:9px 0;border-radius:12px;
  background:var(--glass);border:1px solid var(--border);
  color:var(--ink);font-family:"JetBrains Mono",monospace;font-weight:700;font-size:11px;
  cursor:pointer;transition:all .15s;letter-spacing:.3px;
}
.hp-preset:hover{border-color:var(--lav);background:var(--glass-strong)}
.hp-preset.hp-preset-active{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  color:var(--ink);border-color:#7FFFD4;
  box-shadow:0 3px 10px rgba(127,255,212,.30);
}
.hp-preset:disabled{cursor:not-allowed;opacity:.4}

.hp-receive{
  margin-bottom:12px;padding:14px 16px;border-radius:16px;
  background:linear-gradient(135deg,rgba(127,255,212,.16),rgba(160,231,255,.12));
  border:1px solid rgba(127,255,212,.35);
}
.hp-receive-head{
  display:flex;justify-content:space-between;
  font-family:"JetBrains Mono",monospace;font-size:10px;
  color:var(--ink-2);font-weight:700;letter-spacing:1.4px;margin-bottom:8px;
}
.hp-receive-loading{color:var(--lav)}
.hp-receive-val{
  font-family:"Instrument Serif",serif;font-size:24px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.hp-receive-val.hp-muted{color:var(--ink-3);font-size:18px}
.hp-receive-meta{
  margin-top:10px;padding-top:8px;border-top:1px solid rgba(127,255,212,.30);
}
.hp-receive-meta-row{
  display:flex;justify-content:space-between;padding:3px 0;
  font-family:"JetBrains Mono",monospace;font-size:11px;
}
.hp-receive-meta-row>span:first-child{color:var(--ink-2);font-weight:500}
.hp-receive-meta-row>span:last-child{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}

.hp-sheet-error{
  margin-bottom:10px;padding:11px 13px;border-radius:12px;
  background:rgba(209,75,106,.10);border:1.5px solid rgba(209,75,106,.30);
  color:var(--red);font-size:12px;font-weight:600;
}
.hp-sheet-success{
  margin-bottom:10px;padding:11px 13px;border-radius:12px;
  background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));
  border:1.5px solid rgba(127,255,212,.45);
  font-size:12px;color:var(--ink);font-weight:600;
}
.hp-sheet-success a{
  color:var(--ink);text-decoration:underline;font-weight:800;
  font-family:"JetBrains Mono",monospace;font-size:11px;
}

.hp-cta-wrap{
  flex-shrink:0;padding:14px 22px calc(env(safe-area-inset-bottom) + 22px);
  border-top:1px solid var(--border);
  background:linear-gradient(180deg,transparent 0%,rgba(255,255,255,.7) 30%);
}
.hp-cta{
  width:100%;padding:17px;border-radius:18px;border:none;cursor:pointer;
  font-family:"Instrument Serif",serif;font-size:18px;letter-spacing:-.01em;
  color:var(--ink);transition:transform .15s;
  position:relative;overflow:hidden;
}
.hp-cta-buy{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  box-shadow:0 8px 24px rgba(127,255,212,.35);
}
.hp-cta-sell{
  background:linear-gradient(135deg,#FF8FBE,#FFB088);color:#fff;
  box-shadow:0 8px 24px rgba(255,143,190,.35);
}
.hp-cta:hover:not(:disabled){transform:translateY(-1px)}
.hp-cta:active:not(:disabled){transform:translateY(1px)}
.hp-cta:disabled{
  background:rgba(26,27,78,.06);color:var(--ink-3);
  cursor:not-allowed;box-shadow:none;
  border:1px solid var(--hairline);
}
.hp-cta-foot{
  text-align:center;font-family:"JetBrains Mono",monospace;
  font-size:9px;color:var(--ink-3);font-weight:600;
  margin-top:9px;letter-spacing:.4px;
}
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
// CONSTANTS — matches SwapWidget / MemeWonderland
// =====================================================================
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const SPL_LEGACY_PROGRAM    = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Tokens under $1 are hidden; SOL always shows.
const MIN_TOKEN_VALUE_USD = 1;

// Atomic Jupiter swap config — matches MemeWonderland exactly.
const FEE_WALLET   = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS      = 300;  // 3% taken from input
const SLIPPAGE_BPS = 500;

const RPC_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOLANA_RPC) ||
  ((typeof process !== 'undefined' && process.env && process.env.REACT_APP_HELIUS_API_KEY)
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

// Brand / xStock detection so we can tag them in the list.
const BRAND_TOKENS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { isBrand: true },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { isBrand: true },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { isBrand: true },
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { isBrand: true },
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { isBrand: true },
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { isBrand: true },
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { isBrand: true },
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { isBrand: true },
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { isBrand: true },
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { isBrand: true },
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { isBrand: true },
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { isBrand: true },
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { isBrand: true },
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { isBrand: true },
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { isBrand: true },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { isBrand: true },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { isBrand: true },
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { isBrand: true },
};
const STABLES = new Set([USDC_SOLANA, USDT_SOLANA]);

// Pump.fun mints use a "pump" suffix (vanity address convention). When a
// holding matches this AND has no Jupiter price, it's almost certainly an
// ungraduated bonding-curve token that needs the /api/pumpfun/trade route.
function isPumpFunMint(mint) {
  if (!mint || typeof mint !== 'string') return false;
  return /pump$/i.test(mint);
}

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

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled')) return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route')) return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large')) return 'Route is too complex to fit in one transaction.';
  return err?.message || 'Swap failed. Please try again.';
};

// =====================================================================
// PORTFOLIO FETCH — same shape as GetStarted, but keeps RAW amounts too.
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

  // Track which program owns each mint — needed for Token-2022 fee transfers later.
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

  const [metaMap, priceMap] = await Promise.all([
    fetchMetaBatched(tokenMints),
    fetchPricesBatched([SOL_MINT, ...tokenMints]),
  ]);

  const enriched = Object.values(byMint).map(h => {
    const fetched = metaMap[h.mint];
    const meta = fetched || buildFallbackMeta(h.mint);
    const isStable = STABLES.has(h.mint);
    const isBrand  = !!BRAND_TOKENS[h.mint];
    const isPump   = isPumpFunMint(h.mint);
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

  // Visibility rules:
  //   • Tokens WITH a price under $1 → hide (dust)
  //   • Tokens WITHOUT a price (e.g. ungraduated pump.fun) → SHOW so the user
  //     can still sell them via the pump.fun route. Display "—" for value.
  const filtered = enriched
    .filter(h => h.mint !== SOL_MINT)
    .filter(h => h.hasPrice ? h.value >= MIN_TOKEN_VALUE_USD : (h.uiAmount > 0));

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
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${chunk.join(',')}`);
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

// =====================================================================
// HOLDING ROW
// =====================================================================
function HoldingRow({ token, onBuy, onSell, idx }) {
  const meta    = token.meta || buildFallbackMeta(token.mint);
  const val     = token.value || 0;
  const isSol   = token.mint === SOL_MINT;
  const isBrand = !!meta.isBrand;
  const isStable = !!meta.isStable;
  const isPump   = !!meta.isPump;
  const hasPrice = !!token.hasPrice || isSol;
  const [iconErrored, setIconErrored] = useState(false);
  const showImg = meta.icon && !iconErrored;
  const letter  = ((meta.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const bgColor = meta.color || colorFromMint(token.mint);

  const solGradient = 'linear-gradient(135deg,#B794F6,#9D7BE0)';
  const badgeStyle = isSol
    ? { background: solGradient, boxShadow: '0 4px 12px rgba(183,148,246,.35)' }
    : { background: `linear-gradient(135deg, ${bgColor}, ${bgColor}cc)`, boxShadow: `0 4px 12px ${bgColor}33` };

  return (
    <div
      className={'hp-row' + (isSol ? ' hp-row-sol' : '')}
      style={{ animationDelay: (idx * 0.03) + 's' }}
    >
      {showImg ? (
        <img
          src={meta.icon}
          alt={meta.symbol || ''}
          className="hp-h-badge-img"
          onError={() => setIconErrored(true)}
        />
      ) : (
        <div className="hp-h-badge" style={badgeStyle}>{letter}</div>
      )}
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
        <div className="hp-h-actions">
          {!isSol && (
            <button type="button" className="hp-act-btn hp-act-buy" onClick={() => onBuy(token)}>
              BUY
            </button>
          )}
          <button type="button" className="hp-act-btn hp-act-sell" onClick={() => onSell(token)}>
            {isSol ? 'SWAP' : 'SELL'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// EXTRA HELPERS — COPIED FROM SwapWidget.jsx / LaunchRadar.jsx / Stocks.jsx
// Holdings is self-contained: it doesn't import from those files. Each
// trade route below mirrors the exact logic used in its source component.
// =====================================================================

// Reserve some SOL for tx fees, priority fees, and (on first buy of a new
// mint) ATA rent — matches LaunchRadar's pump.fun flow.
const SOL_RESERVE = 0.01;

// xStock USDC pair config — matches Stocks.jsx exactly.
const XSTOCK_FEE_BPS         = 500;   // 5%
const USDC_DECIMALS          = 6;
const XSTOCK_SLIPPAGE_BPS    = 500;
const XSTOCK_MIN_USDC        = 1;
const XSTOCK_MAX_USDC        = 50_000;

const TOKEN_PROGRAM_ID_PK      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID_PK = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM_ID_PK        = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Route detection. xStock list trumps pump suffix (an "Xs...pump" mint is an
// xStock, not a pump-fun token).
function getTokenRoute(token) {
  if (!token?.mint) return 'jupiter';
  if (BRAND_TOKENS[token.mint]) return 'xstock';
  if (isPumpFunMint(token.mint)) return 'pumpfun';
  return 'jupiter';
}

// ─── PUMP.FUN HELPERS — copied verbatim from LaunchRadar.jsx ─────────
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
  const body = { action, mint, user: user.toBase58(), amount: String(amount) };
  if (decimals != null) body.decimals = Number(decimals);
  const r = await fetch('/api/pumpfun/trade', {
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
  if (j.includes('insufficient') || j.includes('debit an account'))
    return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '')
    .replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed → ' + ctx;
  return fallbackMsg ? ('Sim failed → ' + String(fallbackMsg).slice(0, 160))
                     : 'Sim failed (no logs returned).';
}

// ─── XSTOCK HELPERS — copied verbatim from Stocks.jsx ────────────────
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
  const res = await fetchWithTimeout(`/api/jupiter/quote?${params}`, {
    headers: { Accept: 'application/json' },
  }, 12_000);
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

function deriveAtaX(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID_PK) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID_PK,
  );
  return ata;
}

function createIdempotentAtaIxX(payer, ata, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID_PK) {
  return {
    programId: ATA_PROGRAM_ID_PK,
    keys: [
      { pubkey: payer,             isSigner: true,  isWritable: true  },
      { pubkey: ata,               isSigner: false, isWritable: true  },
      { pubkey: owner,             isSigner: false, isWritable: false },
      { pubkey: mint,              isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: tokenProgramId,    isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([1]),
  };
}

function createTransferCheckedIxX({ source, mint, destination, owner, amountAtomic, decimals, tokenProgramId = TOKEN_PROGRAM_ID_PK }) {
  const data = new Uint8Array(10);
  data[0] = 12;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  data[9] = decimals & 0xff;
  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: source,      isSigner: false, isWritable: true  },
      { pubkey: mint,        isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true  },
      { pubkey: owner,       isSigner: true,  isWritable: false },
    ],
    data,
  };
}

function deserializeJupInstructionX(ix) {
  return {
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map(a => ({
      pubkey:     new PublicKey(a.pubkey),
      isSigner:   Boolean(a.isSigner),
      isWritable: Boolean(a.isWritable),
    })),
    data: Uint8Array.from(atob(ix.data), c => c.charCodeAt(0)),
  };
}

// =====================================================================
// TRADE DRAWER — three routes, auto-detected from token type.
//
//   • jupiter  → SwapWidget.jsx style: /api/jupiter/build, SOL pair, 3% fee
//   • xstock   → Stocks.jsx style: /api/jupiter/quote + /api/jupiter/swap-
//                instructions, USDC pair, 5% fee in USDC
//   • pumpfun  → LaunchRadar.jsx style: /api/pumpfun/trade, SOL pair, 3%
//                fee (prepended on buy, appended on sell)
//
// SOL row → "swap" routes SOL → USDC via the jupiter path.
// =====================================================================
function TradeDrawer({
  token,             // the holding being acted on
  initialMode,       // 'buy' | 'sell'
  solBalance,        // uiAmount of SOL
  tokenBalance,      // { uiAmount, rawAmount, decimals, isToken2022 } for non-SOL
  solPrice,
  onClose,
  onConnectWallet,
  onTradeComplete,
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  const isSol = token.mint === SOL_MINT;
  const baseRoute = useMemo(() => isSol ? 'jupiter' : getTokenRoute(token), [isSol, token]);

  const [mode, setMode] = useState(initialMode || 'buy');
  // SOL row: only "sell" makes sense (swap SOL → USDC).
  useEffect(() => {
    if (isSol && mode !== 'sell') setMode('sell');
  }, [isSol, mode]);

  // Lock scroll while drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Side / input / output configuration ────────────────────────────
  // jupiter:  buy → SOL→token, sell → token→SOL
  // pumpfun:  buy → SOL→token, sell → token→SOL (no different from jupiter
  //           routing-wise, just different endpoint)
  // xstock:   buy → USDC→token, sell → token→USDC
  // SOL row:  always "sell" → SOL→USDC via jupiter
  const inputMint = useMemo(() => {
    if (isSol) return SOL_MINT;
    if (baseRoute === 'xstock') return mode === 'buy' ? USDC_SOLANA : token.mint;
    return mode === 'buy' ? SOL_MINT : token.mint;
  }, [isSol, baseRoute, mode, token.mint]);

  const outputMint = useMemo(() => {
    if (isSol) return USDC_SOLANA;
    if (baseRoute === 'xstock') return mode === 'buy' ? token.mint : USDC_SOLANA;
    return mode === 'buy' ? token.mint : SOL_MINT;
  }, [isSol, baseRoute, mode, token.mint]);

  const tokenMeta = token.meta || buildFallbackMeta(token.mint);

  const inputDecimals = useMemo(() => {
    if (inputMint === SOL_MINT) return 9;
    if (inputMint === USDC_SOLANA) return USDC_DECIMALS;
    return tokenMeta.decimals ?? 6;
  }, [inputMint, tokenMeta.decimals]);
  const outputDecimals = useMemo(() => {
    if (outputMint === SOL_MINT) return 9;
    if (outputMint === USDC_SOLANA) return USDC_DECIMALS;
    return tokenMeta.decimals ?? 6;
  }, [outputMint, tokenMeta.decimals]);

  const inputSymbol = inputMint === SOL_MINT ? 'SOL'
                    : inputMint === USDC_SOLANA ? 'USDC'
                    : tokenMeta.symbol;
  const outputSymbol = outputMint === SOL_MINT ? 'SOL'
                    : outputMint === USDC_SOLANA ? 'USDC'
                    : tokenMeta.symbol;

  // Balance the user can spend on the input side (SOL or token).
  // USDC balance for xStock BUYs comes from `usdcBalance` state below.
  const inputBalanceUi = useMemo(() => {
    if (inputMint === SOL_MINT)   return solBalance || 0;
    if (inputMint === token.mint) return tokenBalance?.uiAmount || 0;
    return 0;
  }, [inputMint, solBalance, tokenBalance, token.mint]);

  const inputPriceUsd = useMemo(() => {
    if (inputMint === SOL_MINT)   return solPrice || 0;
    if (inputMint === USDC_SOLANA) return 1;
    if (inputMint === token.mint) return token.price || 0;
    return 0;
  }, [inputMint, solPrice, token.mint, token.price]);

  // ── USDC balance fetch (for xstock BUY) ───────────────────────────
  const [usdcBalance, setUsdcBalance] = useState(0);
  useEffect(() => {
    if (baseRoute !== 'xstock' || !publicKey || mode !== 'buy') return;
    let cancelled = false;
    (async () => {
      try {
        const usdcMintPk = new PublicKey(USDC_SOLANA);
        const ata = deriveAtaX(publicKey, usdcMintPk, TOKEN_PROGRAM_ID_PK);
        const acc = await connection.getParsedAccountInfo(ata);
        const ui = Number(acc?.value?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
        if (!cancelled) setUsdcBalance(ui);
      } catch { if (!cancelled) setUsdcBalance(0); }
    })();
    return () => { cancelled = true; };
  }, [baseRoute, publicKey, mode, connection]);

  // Effective input balance (xstock BUY uses USDC balance).
  const effInputBalanceUi = (baseRoute === 'xstock' && mode === 'buy')
    ? usdcBalance
    : inputBalanceUi;

  // ── Amount state ───────────────────────────────────────────────────
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

  // ── Quote / preview state ──────────────────────────────────────────
  // For jupiter (build endpoint): stores the full build payload.
  // For xstock: stores the quoteResponse from /api/jupiter/quote.
  // For pumpfun: stores an estimate {outAmount, mode, params}.
  const [build, setBuild] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const quoteAbortRef = useRef(null);

  // ── JUPITER QUOTE (route=jupiter) ─────────────────────────────────
  useEffect(() => {
    if (baseRoute !== 'jupiter') return;
    if (!rawAmount || inputMint === outputMint) {
      setBuild(null); setQuoteError(null); return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController(); quoteAbortRef.current = ac;
    setQuoting(true); setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) { setBuild(null); setQuoting(false); return; }
        const params = new URLSearchParams({
          inputMint, outputMint,
          amount: net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker: publicKey ? publicKey.toBase58() : '11111111111111111111111111111111',
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) { setBuild({ kind: 'jupiter', ...data }); setQuoteError(null); }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) { setBuild(null); setQuoteError(friendlyError(e)); }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);
    return () => { clearTimeout(t); ac.abort(); };
  }, [baseRoute, rawAmount, inputMint, outputMint, publicKey]);

  // ── XSTOCK QUOTE (route=xstock) ────────────────────────────────────
  useEffect(() => {
    if (baseRoute !== 'xstock') return;
    if (!rawAmount || inputMint === outputMint) {
      setBuild(null); setQuoteError(null); return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController(); quoteAbortRef.current = ac;
    setQuoting(true); setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        // BUY  USDC→xstock: net = grossUSDC - feeUSDC (5%)
        // SELL xstock→USDC: net = all tokens (fee taken from USDC out later)
        let atomic;
        if (mode === 'buy') {
          const gross = BigInt(rawAmount);
          const fee = (gross * BigInt(XSTOCK_FEE_BPS)) / 10000n;
          atomic = gross - fee;
        } else {
          atomic = BigInt(rawAmount);
        }
        if (atomic < 1n) { setBuild(null); setQuoting(false); return; }
        const q = await getJupiterQuoteX({
          inputMint, outputMint,
          amountAtomic: atomic,
          slippageBps:  XSTOCK_SLIPPAGE_BPS,
        });
        if (!ac.signal.aborted) { setBuild({ kind: 'xstock', quoteResponse: q }); setQuoteError(null); }
      } catch (e) {
        if (!ac.signal.aborted) { setBuild(null); setQuoteError(friendlyError(e)); }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);
    return () => { clearTimeout(t); ac.abort(); };
  }, [baseRoute, rawAmount, inputMint, outputMint, mode]);

  // ── PUMPFUN ESTIMATE (route=pumpfun) ───────────────────────────────
  // Pump.fun doesn't expose a quote endpoint — we estimate output from
  // current price feeds (matches LaunchRadar's approach).
  useEffect(() => {
    if (baseRoute !== 'pumpfun') return;
    if (!amtNum || amtNum <= 0) { setBuild(null); setQuoteError(null); return; }

    if (mode === 'buy') {
      // BUY: user enters X SOL. Curve gets ((X - fee) * 100/110) lamports.
      const totalLamports = BigInt(Math.floor(amtNum * 1e9));
      const feeLamports   = (totalLamports * BigInt(FEE_BPS)) / 10000n;
      const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
      if (tradeLamports <= 0n || feeLamports <= 0n) { setBuild(null); return; }
      // Estimate output from price feed.
      let estTokens = 0;
      if (token?.price > 0 && solPrice > 0) {
        const tradeSol = Number(tradeLamports) / 1e9;
        estTokens = (tradeSol * solPrice) / token.price;
      }
      setBuild({
        kind: 'pumpfun',
        mode: 'buy',
        totalLamports: totalLamports.toString(),
        tradeLamports: tradeLamports.toString(),
        feeLamports:   feeLamports.toString(),
        estOut: estTokens,
      });
      setQuoteError(null);
    } else {
      // SELL: user enters % of holding. Full token amount goes to curve.
      if (!tokenBalance?.rawAmount || tokenBalance.rawAmount <= 0n) {
        setBuild(null); setQuoteError(null); return;
      }
      const pct = Math.min(100, Math.max(0.01, amtNum));
      const tradeTokens = (tokenBalance.rawAmount * BigInt(Math.floor(pct * 100))) / 10000n;
      if (tradeTokens <= 0n) { setBuild(null); return; }
      const decimals = tokenBalance.decimals ?? tokenMeta.decimals ?? 6;
      const tradeTokensUi = Number(tradeTokens) / Math.pow(10, decimals);
      // Fee = 3% of estimated SOL out.
      let feeLamports = '0';
      let estSolOut = 0;
      if (token?.price > 0 && solPrice > 0) {
        const grossSol = (tradeTokensUi * token.price) / solPrice;
        const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
        if (lam > 0) feeLamports = String(lam);
        estSolOut = Math.max(0, grossSol * (1 - FEE_BPS / 10000));
      }
      setBuild({
        kind: 'pumpfun',
        mode: 'sell',
        decimals,
        percentage: pct,
        tradeTokens: tradeTokens.toString(),
        tradeTokensUi,
        feeLamports,
        estOut: estSolOut,
      });
      setQuoteError(null);
    }
  }, [baseRoute, amtNum, mode, token, tokenBalance, solPrice, tokenMeta.decimals]);

  // ── Display "you receive" ──────────────────────────────────────────
  const outAmountUi = useMemo(() => {
    if (!build) return null;
    if (build.kind === 'jupiter') {
      return Number(build.outAmount) / Math.pow(10, outputDecimals);
    }
    if (build.kind === 'xstock') {
      const gross = Number(build.quoteResponse?.outAmount || 0) / Math.pow(10, outputDecimals);
      // For SELL we deduct fee from USDC out.
      if (mode === 'sell') return Math.max(0, gross * (1 - XSTOCK_FEE_BPS / 10000));
      return gross;
    }
    if (build.kind === 'pumpfun') return build.estOut || 0;
    return null;
  }, [build, outputDecimals, mode]);

  const rate = useMemo(() => {
    if (!outAmountUi || !amtNum) return null;
    return outAmountUi / amtNum;
  }, [outAmountUi, amtNum]);

  // ── Presets ─────────────────────────────────────────────────────────
  // xstock BUY: USDC amounts. Others BUY: SOL amounts. SELL: percentages.
  const buyPresetsSol  = ['0.1', '0.5', '1', '2'];
  const buyPresetsUsd  = ['50', '100', '500', '1000'];
  const sellPresets    = [
    { label: '25%',  pct: 25 },
    { label: '50%',  pct: 50 },
    { label: '75%',  pct: 75 },
    { label: 'MAX',  pct: 100 },
  ];

  const isSellSide = mode === 'sell' || isSol;
  const isXstock   = baseRoute === 'xstock';
  const isPump     = baseRoute === 'pumpfun';

  const applyBuyPreset = (v) => { setAmount(v); setSelectedPreset(v); };
  const applySellPercent = (pct) => {
    if (!(effInputBalanceUi > 0)) return;
    let amt = (effInputBalanceUi * pct) / 100;
    // For SOL input with MAX, leave a gas cushion.
    if (inputMint === SOL_MINT && pct === 100) amt = Math.max(0, amt - SOL_RESERVE);
    const factor = Math.pow(10, Math.min(8, inputDecimals));
    amt = Math.floor(amt * factor) / factor;
    setAmount(String(amt));
    setSelectedPreset('pct-' + pct);
  };
  // For pump.fun SELL, the input IS the percentage directly.
  const applyPumpSellPct = (pct) => {
    setAmount(String(pct));
    setSelectedPreset('pct-' + pct);
  };

  // ── Execute ────────────────────────────────────────────────────────
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);
  const [swapResult, setSwapResult] = useState(null);

  // --- JUPITER (route=jupiter) -- copied from MemeWonderland TradeSheet ---
  const executeJupiter = useCallback(async () => {
    const b = build;
    if (!b || b.kind !== 'jupiter') throw new Error('No Jupiter quote.');
    const dec = inputDecimals;
    const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
    if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

    const feeIxs = [];
    if (inputMint === SOL_MINT) {
      feeIxs.push(SystemProgram.transfer({
        fromPubkey: publicKey, toPubkey: FEE_WALLET, lamports: Number(feeAmount),
      }));
    } else {
      const mintPk = new PublicKey(inputMint);
      let tokenProgram = (inputMint === token.mint && tokenBalance?.isToken2022)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
      if (inputMint !== token.mint) {
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      }
      const sourceAta = getAssociatedTokenAddressSync(mintPk, publicKey, true, tokenProgram);
      const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, tokenProgram);
      feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
        publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
      ));
      feeIxs.push(createTransferCheckedInstruction(
        sourceAta, mintPk, destAta, publicKey, feeAmount, dec, [], tokenProgram,
      ));
    }

    const ixs = [];
    if (Array.isArray(b.computeBudgetInstructions))
      for (const ix of b.computeBudgetInstructions) ixs.push(deserIx(ix));
    for (const ix of feeIxs) ixs.push(ix);
    if (Array.isArray(b.setupInstructions))
      for (const ix of b.setupInstructions) ixs.push(deserIx(ix));
    if (b.swapInstruction) ixs.push(deserIx(b.swapInstruction));
    if (b.cleanupInstruction) ixs.push(deserIx(b.cleanupInstruction));
    if (Array.isArray(b.otherInstructions))
      for (const ix of b.otherInstructions) ixs.push(deserIx(ix));

    const altKeys = Object.keys(b.addressesByLookupTableAddress || {});
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
      payerKey: publicKey, recentBlockhash: latest.blockhash, instructions: ixs,
    }).compileToV0Message(alts);
    const tx = new VersionedTransaction(message);

    try {
      const sim = await connection.simulateTransaction(tx, {
        replaceRecentBlockhash: true, sigVerify: false,
      });
      if (sim.value.err) {
        const j = (sim.value.logs || []).join('\n').toLowerCase();
        const m = j.includes('insufficient') ? 'Insufficient balance for this swap.'
                : j.includes('slippage') ? 'Price moved — try a higher slippage or smaller amount.'
                : j.includes('account not') ? 'Token account not ready. Try again in a moment.'
                : j.includes('blockhash') || j.includes('expired') ? 'Quote expired. Refresh and retry.'
                : 'Swap simulation failed — the price may have moved.';
        throw new Error(m);
      }
    } catch (simErr) {
      if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) throw simErr;
      console.warn('[hp jupiter sim non-fatal]', simErr);
    }

    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false, maxRetries: 3,
    });
    return { sig, latest };
  }, [build, inputMint, inputDecimals, rawAmount, token.mint, tokenBalance,
      connection, publicKey, signTransaction]);

  // --- XSTOCK (route=xstock) -- copied from Stocks.jsx TradeModal ---
  const executeXstock = useCallback(async () => {
    const b = build;
    if (!b || b.kind !== 'xstock') throw new Error('No xStock quote.');
    const quote = b.quoteResponse;
    const usdcMintPk = new PublicKey(USDC_SOLANA);
    const userUsdcAta = deriveAtaX(publicKey, usdcMintPk, TOKEN_PROGRAM_ID_PK);
    const feeUsdcAta  = deriveAtaX(FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID_PK);

    // Fee in USDC: BUY → 5% of input USDC. SELL → 5% of worst-case USDC out.
    let feeAtomic;
    if (mode === 'buy') {
      feeAtomic = BigInt(rawAmount) * BigInt(XSTOCK_FEE_BPS) / 10000n;
    } else {
      const worstUsdcOut = BigInt(quote.otherAmountThreshold || quote.outAmount || '0');
      feeAtomic = (worstUsdcOut * BigInt(XSTOCK_FEE_BPS)) / 10000n;
    }
    if (feeAtomic <= 0n) throw new Error('Amount too small.');

    const feeIxs = [
      createIdempotentAtaIxX(publicKey, feeUsdcAta, FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID_PK),
      createTransferCheckedIxX({
        source: userUsdcAta, mint: usdcMintPk, destination: feeUsdcAta, owner: publicKey,
        amountAtomic: feeAtomic, decimals: USDC_DECIMALS, tokenProgramId: TOKEN_PROGRAM_ID_PK,
      }),
    ];

    const swapIxs = await getJupiterSwapInstructionsX({
      quoteResponse: quote, userPublicKey: publicKey.toBase58(),
    });

    const altAddrs = swapIxs.addressLookupTableAddresses || [];
    const altAccounts = [];
    if (altAddrs.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(altAddrs.map(a => new PublicKey(a)));
      for (let i = 0; i < altAddrs.length; i++) {
        if (!infos[i]) continue;
        altAccounts.push(new AddressLookupTableAccount({
          key:   new PublicKey(altAddrs[i]),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }));
      }
    }

    const computeBudgetIxs = (swapIxs.computeBudgetInstructions || []).map(deserializeJupInstructionX);
    const setupIxs         = (swapIxs.setupInstructions || []).map(deserializeJupInstructionX);
    const swapIx           = swapIxs.swapInstruction ? deserializeJupInstructionX(swapIxs.swapInstruction) : null;
    const cleanupIx        = swapIxs.cleanupInstruction ? deserializeJupInstructionX(swapIxs.cleanupInstruction) : null;

    const allIxs = [];
    for (const ix of computeBudgetIxs) allIxs.push(ix);
    // BUY: prepend fee (so we charge before swap). SELL: append (after swap nets USDC).
    if (mode === 'buy') for (const ix of feeIxs) allIxs.push(ix);
    for (const ix of setupIxs) allIxs.push(ix);
    if (swapIx)    allIxs.push(swapIx);
    if (cleanupIx) allIxs.push(cleanupIx);
    if (mode === 'sell') for (const ix of feeIxs) allIxs.push(ix);

    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: publicKey, recentBlockhash: latest.blockhash, instructions: allIxs,
    }).compileToV0Message(altAccounts);
    const tx = new VersionedTransaction(message);

    try {
      const sim = await connection.simulateTransaction(tx, {
        replaceRecentBlockhash: true, sigVerify: false,
      });
      if (sim.value.err) throw new Error(describeSimLogs(sim.value.logs, JSON.stringify(sim.value.err)));
    } catch (simErr) {
      if (simErr?.message && /sim failed|insufficient|slippage|expired/i.test(simErr.message)) throw simErr;
      console.warn('[hp xstock sim non-fatal]', simErr);
    }

    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true, maxRetries: 5,
    });
    return { sig, latest };
  }, [build, mode, rawAmount, connection, publicKey, signTransaction]);

  // --- PUMPFUN (route=pumpfun) -- copied from LaunchRadar executeSwap ---
  const executePumpfun = useCallback(async () => {
    const b = build;
    if (!b || b.kind !== 'pumpfun') throw new Error('No pump.fun route.');

    const route = await getPumpRoute({
      action:   b.mode === 'buy' ? 'buy' : 'sell',
      mint:     token.mint,
      user:     publicKey,
      amount:   b.mode === 'buy' ? b.tradeLamports : b.tradeTokens,
      decimals: b.mode === 'buy' ? undefined : b.decimals,
      connection,
    });

    const feeLamports = BigInt(b.feeLamports || '0');
    if (feeLamports <= 0n) {
      throw new Error(b.mode === 'buy'
        ? 'Fee rounds to zero — amount too small.'
        : 'Could not estimate sell fee — token or SOL price unavailable.');
    }
    const feeIx = SystemProgram.transfer({
      fromPubkey: publicKey, toPubkey: FEE_WALLET, lamports: Number(feeLamports),
    });

    // PumpPortal's tx already has ComputeBudget ixs at the start — insert after.
    const CB_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    const ixs = route.instructions.slice();
    if (b.mode === 'buy') {
      let insertAt = 0;
      while (insertAt < ixs.length && ixs[insertAt].programId.toBase58() === CB_PROGRAM) insertAt++;
      ixs.splice(insertAt, 0, feeIx);
    } else {
      ixs.push(feeIx);
    }

    const latest = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: publicKey, recentBlockhash: latest.blockhash, instructions: ixs,
    }).compileToV0Message(route.alts);
    const tx = new VersionedTransaction(message);

    let simLogs = null;
    try {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed',
      });
      simLogs = sim?.value?.logs || null;
      if (sim?.value?.err) {
        throw new Error(describeSimLogs(simLogs, JSON.stringify(sim.value.err)));
      }
    } catch (simErr) {
      if (simErr instanceof Error && /sim failed/i.test(simErr.message)) throw simErr;
      console.warn('[hp pumpfun sim non-fatal]', simErr?.message);
    }

    const signed = await signTransaction(tx);
    const raw = signed.serialize();
    let sig;
    try {
      sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
    } catch (sendErr) {
      let logs = sendErr?.logs || null;
      if (!logs && typeof sendErr?.getLogs === 'function') {
        try { logs = await sendErr.getLogs(connection); } catch {}
      }
      throw new Error(describeSimLogs(logs, sendErr?.message));
    }
    return { sig, latest, raw };
  }, [build, token.mint, connection, publicKey, signTransaction]);

  // ── Master swap handler ────────────────────────────────────────────
  const handleSwap = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      onConnectWallet?.(); return;
    }
    if (!build) { setSwapError('No quote available — try again.'); return; }
    setSwapping(true); setSwapError(null); setSwapResult(null);

    try {
      let res;
      if (build.kind === 'jupiter')      res = await executeJupiter();
      else if (build.kind === 'xstock')  res = await executeXstock();
      else if (build.kind === 'pumpfun') res = await executePumpfun();
      else throw new Error('Unknown route');

      const { sig, latest } = res;

      // Confirm
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
      console.error('[hp swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [connected, publicKey, signTransaction, build, executeJupiter,
      executeXstock, executePumpfun, connection, onConnectWallet, onTradeComplete]);

  // ── CTA + validity ─────────────────────────────────────────────────
  const hasFunds = amtNum > 0 && effInputBalanceUi >= amtNum;
  // For pump.fun SELL we input a percentage, not an amount in tokens.
  const pumpSellHasHolding = !!(isPump && mode === 'sell' &&
    tokenBalance?.rawAmount && tokenBalance.rawAmount > 0n);
  const inputOk = isPump && mode === 'sell' ? pumpSellHasHolding : hasFunds;
  const canSwap  = !!publicKey && !!build && !quoting && !swapping &&
                   amtNum > 0 && inputMint !== outputMint && inputOk;

  const ctaLabel = swapping
    ? (isSellSide ? 'Swapping…' : 'Buying…')
    : !publicKey
      ? 'Connect Wallet'
      : amtNum <= 0
        ? 'Enter amount'
        : quoting && !build
          ? 'Getting quote…'
          : !build
            ? 'No route available'
            : !inputOk
              ? (isPump && mode === 'sell' ? `No ${tokenMeta.symbol} to sell` : `Insufficient ${inputSymbol}`)
              : isPump
                ? (mode === 'buy' ? `Buy ${tokenMeta.symbol} via pump.fun` : `Sell ${Math.min(100, amtNum).toFixed(0)}% of ${tokenMeta.symbol}`)
                : isXstock
                  ? (mode === 'buy' ? `Buy ${tokenMeta.symbol} · ${fmtUsd(amtNum)}` : `Sell ${tokenMeta.symbol} → USDC`)
                  : isSellSide
                    ? `Swap ${inputSymbol} → ${outputSymbol}`
                    : `Buy ${tokenMeta.symbol}`;

  // ── Visual ─────────────────────────────────────────────────────────
  const meta = tokenMeta;
  const letter = ((meta.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const bgColor = meta.color || colorFromMint(token.mint);
  const showImg = !!meta.icon;

  const routeBadge = isXstock ? { label: 'xSTOCK', cls: 'hp-route-xstock' }
                  : isPump    ? { label: 'PUMP.FUN', cls: 'hp-route-pump' }
                  : isSol     ? { label: 'JUPITER', cls: 'hp-route-jup' }
                  :             { label: 'JUPITER', cls: 'hp-route-jup' };

  // For xstock BUY the input is USD; for pump.fun SELL it's a percent.
  const inputPlaceholder = isXstock && mode === 'buy' ? '0.00'
                         : isPump && mode === 'sell' ? '0-100'
                         : '0.00';
  const inputChipLabel = isPump && mode === 'sell' ? '%' : inputSymbol;

  return (
    <>
      <div className="hp-sheet-backdrop" onClick={swapping ? undefined : onClose} />
      <div className="hp-sheet">
        <div className="hp-grabber" />

        <div className="hp-sheet-head">
          {showImg ? (
            <img src={meta.icon} alt="" className="hp-sheet-badge-img"
              onError={(e) => { e.target.style.display = 'none'; }} />
          ) : (
            <div className="hp-sheet-badge" style={{
              background: isSol
                ? 'linear-gradient(135deg,#B794F6,#9D7BE0)'
                : `linear-gradient(135deg, ${bgColor}, ${bgColor}cc)`,
            }}>{letter}</div>
          )}
          <div className="hp-sheet-title-wrap">
            <div className="hp-sheet-title">{meta.symbol}</div>
            <div className="hp-sheet-sub">
              {meta.name} · {token.price > 0 ? fmtUsd(token.price) : 'no price'}
              <span className={'hp-route-badge ' + routeBadge.cls}>{routeBadge.label}</span>
            </div>
          </div>
          <button type="button" className="hp-sheet-close" onClick={onClose} disabled={swapping}>×</button>
        </div>

        {!isSol && (
          <div className="hp-side-switch">
            {['buy', 'sell'].map(s => {
              const active = mode === s;
              const buyLabel  = isXstock ? 'Buy with USDC' : 'Buy with SOL';
              const sellLabel = isXstock ? 'Sell to USDC'  : 'Sell to SOL';
              return (
                <button
                  key={s}
                  type="button"
                  className={'hp-side-btn' + (active ? ` hp-active hp-${s}` : '')}
                  onClick={() => !swapping && setMode(s)}
                  disabled={swapping}
                >{s === 'buy' ? buyLabel : sellLabel}</button>
              );
            })}
          </div>
        )}

        <div className="hp-sheet-body">
          <div className="hp-amount-label">
            <span>
              {isPump && mode === 'sell' ? 'YOU SELL (% OF HOLDING)' :
               isSellSide ? 'YOU SELL' : 'YOU PAY'}
            </span>
            <span className="hp-amount-bal">
              {isPump && mode === 'sell' ? (
                <>Holding: <b>{fmtTokenAmt(tokenBalance?.uiAmount || 0)}</b> {tokenMeta.symbol}</>
              ) : (
                <>Bal: <b>{fmtTokenAmt(effInputBalanceUi)}</b> {inputSymbol}</>
              )}
              {!isPump && mode === 'buy' && effInputBalanceUi > 0 && !isXstock && (
                <button type="button" className="hp-max-btn"
                  onClick={() => applySellPercent(100)}>MAX</button>
              )}
            </span>
          </div>

          <div className="hp-amount-wrap">
            <div className="hp-amount-chip">
              <div className="hp-amount-chip-icon" />
              {inputChipLabel}
            </div>
            <input
              className="hp-amount-input"
              type="text"
              inputMode="decimal"
              placeholder={inputPlaceholder}
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                // Clamp pump-sell percentage to 100.
                if (isPump && mode === 'sell' && Number(v) > 100) { setAmount('100'); setSelectedPreset(null); return; }
                setAmount(v); setSelectedPreset(null);
              }}
              disabled={swapping}
            />
          </div>
          {usdValue > 0 && !(isPump && mode === 'sell') && (
            <div className="hp-amount-equiv">≈ {fmtUsd(usdValue)}</div>
          )}

          {/* PRESETS */}
          {(mode === 'buy' && !isSol) ? (
            <div className="hp-presets">
              {(isXstock ? buyPresetsUsd : buyPresetsSol).map(v => (
                <button key={v} type="button"
                  className={'hp-preset' + (selectedPreset === v ? ' hp-preset-active' : '')}
                  onClick={() => applyBuyPreset(v)}
                  disabled={swapping}>
                  {isXstock ? '$' + v : v + ' SOL'}
                </button>
              ))}
            </div>
          ) : (
            <div className="hp-presets">
              {sellPresets.map(p => {
                const k = 'pct-' + p.pct;
                const disabled = swapping || (isPump
                  ? !(tokenBalance?.uiAmount > 0)
                  : !(effInputBalanceUi > 0));
                return (
                  <button key={k} type="button"
                    className={'hp-preset' + (selectedPreset === k ? ' hp-preset-active' : '')}
                    onClick={() => isPump ? applyPumpSellPct(p.pct) : applySellPercent(p.pct)}
                    disabled={disabled}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* RECEIVE */}
          {(amtNum > 0 || quoting) && (
            <div className="hp-receive">
              <div className="hp-receive-head">
                <span>YOU RECEIVE {isPump ? '(EST.)' : ''}</span>
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
                    <span>{isXstock ? '5%' : '3%'} · in {isXstock ? 'USDC' : (isPump ? 'SOL' : inputSymbol)}</span>
                  </div>
                  <div className="hp-receive-meta-row">
                    <span>Route</span>
                    <span>{isXstock ? 'Jupiter · USDC pair' : isPump ? 'pump.fun bonding curve' : 'Jupiter'}</span>
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
            className={'hp-cta ' + (isSellSide ? 'hp-cta-sell' : 'hp-cta-buy')}
            onClick={!connected ? onConnectWallet : handleSwap}
            disabled={connected ? !canSwap : false}
          >
            {ctaLabel}
          </button>
          <div className="hp-cta-foot">
            Powered by <b>{isPump ? 'pump.fun' : 'Jupiter'}</b> · Non-custodial · Your keys
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

// localStorage key for tracking when each mint was first seen in this wallet.
// Used by the "Newest" sort. Keyed per-wallet so switching wallets doesn't
// leak history. Shape: { [mint]: timestampMs }
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

  const { isConnected, walletAddress } = useNexusWallet();

  const [portfolio, setPortfolio]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState('');
  const [sortBy, setSortBy]         = useState('value');
  const [drawer, setDrawer]         = useState(null); // { token, mode }
  const [seenMap, setSeenMap]       = useState({});   // mint → first-seen timestamp
  const inFlightRef = useRef(false);

  // When wallet changes, load that wallet's seen-map from localStorage.
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
      // Stamp first-seen timestamps for any new mints. Use a single Date.now()
      // so all newly-discovered tokens get the same value (preserves stable
      // ordering between them via secondary sort).
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

  // ── Sort ────────────────────────────────────────────────────────
  const sortedTokens = useMemo(() => {
    if (!portfolio?.tokens) return [];
    const arr = [...portfolio.tokens];
    if (sortBy === 'name') {
      arr.sort((a, b) => (a.meta.symbol || '').localeCompare(b.meta.symbol || ''));
    } else if (sortBy === 'balance') {
      arr.sort((a, b) => (b.uiAmount || 0) - (a.uiAmount || 0));
    } else if (sortBy === 'newest') {
      // Newer first-seen timestamps float to top. Ties broken by value desc.
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

  // ── Drawer ──────────────────────────────────────────────────────
  const openBuy  = useCallback((token) => setDrawer({ token, mode: 'buy' }),  []);
  const openSell = useCallback((token) => setDrawer({ token, mode: 'sell' }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  // ── Disconnected ────────────────────────────────────────────────
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
            <div className="hp-hero-eyebrow"><span className="dot"/>YOUR BAGS</div>
            <h1>See <span className="shim">everything.</span></h1>
            <p className="hp-hero-sub">
              Every token. Live prices. Buy or sell straight from your holdings.
            </p>
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

  // ── Loading ─────────────────────────────────────────────────────
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

  // ── Ready ───────────────────────────────────────────────────────
  const solBalance  = portfolio?.solBalance  || 0;
  const solPriceUsd = portfolio?.solPriceUsd || 0;
  const tokens      = sortedTokens;
  const solValue    = solBalance * solPriceUsd;
  const tokensTotal = tokens.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue  = solValue + tokensTotal;
  const tokenCount  = tokens.length + (solBalance > 0 ? 1 : 0);

  const solHolding = {
    mint:     SOL_MINT,
    meta:     { symbol: 'SOL', name: 'Solana', color: '#B794F6', icon: null, decimals: 9 },
    price:    solPriceUsd,
    value:    solValue,
    uiAmount: solBalance,
    rawAmount: BigInt(portfolio?.solLamports || 0),
    decimals: 9,
    isToken2022: false,
  };

  // Token balance lookup for drawer.
  const tokenBalanceFor = (mint) => {
    if (mint === SOL_MINT) return null;
    return tokens.find(t => t.mint === mint) || null;
  };

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
          <HoldingRow
            token={solHolding}
            idx={0}
            onBuy={openBuy}     // SOL row's BUY is hidden inside HoldingRow
            onSell={openSell}   // "SWAP" for SOL → routes SOL → USDC
          />
          {tokens.length === 0 ? (
            <div className="hp-empty">
              <div className="hp-empty-title">No other holdings yet.</div>
              <div className="hp-empty-sub">Tokens under ${MIN_TOKEN_VALUE_USD} are hidden.</div>
            </div>
          ) : tokens.map((t, i) => (
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

      {drawer && (
        <TradeDrawer
          token={drawer.token}
          initialMode={drawer.mode}
          solBalance={solBalance}
          tokenBalance={tokenBalanceFor(drawer.token.mint)}
          solPrice={solPriceUsd}
          onClose={closeDrawer}
          onConnectWallet={onConnectWallet}
          onTradeComplete={() => { handleRefresh(); }}
        />
      )}
    </div>
  );
}
 