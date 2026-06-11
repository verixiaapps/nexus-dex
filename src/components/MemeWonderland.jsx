// MemeWonderland.jsx — buy/sell mirrors SwapWidget.jsx exactly.
//
// MERGED VERSION: original component + integrated additions
//   • CSS combined inline as MW_CSS + useMwCSS injector
//   • New sections: stats orbs, featured top signal, hot narratives, activity feed
//   • All existing swap/RPC/Jupiter logic preserved verbatim

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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

// =====================================================================
// INLINE CSS
// =====================================================================
const MW_CSS = `
.mw-root{
  --mw-bg:#0a0815; --mw-bg-deep:#050410;
  --mw-card:#1a1530; --mw-card-hi:#241d42; --mw-card-deep:#2a2350;
  --mw-border:rgba(255,255,255,0.08); --mw-border-hi:rgba(255,255,255,0.18);
  --mw-text:#fff5fb; --mw-text-dim:#b9a7d6; --mw-text-dimmer:#6c5d8c;
  --mw-mint:#4dffd2; --mw-mint-hi:#7dffe0;
  --mw-pink:#ff5ec4; --mw-pink-hi:#ffb3e3;
  --mw-yellow:#ffe14d; --mw-orange:#ff9a3c;
  --mw-purple:#c084fc; --mw-cyan:#5ee8ff;
  --mw-green:#4dff88; --mw-red:#ff5577;
  --mw-gold:#ffd966; --mw-gold-hi:#ffeaa6;
  background:var(--mw-bg);color:var(--mw-text);
  font-family:'Fredoka',system-ui,-apple-system,sans-serif;
  min-height:100vh;position:relative;overflow-x:hidden;
}
.mw-root,.mw-root *{box-sizing:border-box}
.mw-root{
  background:
    radial-gradient(circle at 20% 0%,rgba(255,94,196,0.18),transparent 50%),
    radial-gradient(circle at 80% 30%,rgba(77,255,210,0.15),transparent 50%),
    radial-gradient(circle at 50% 80%,rgba(192,132,252,0.12),transparent 60%),
    var(--mw-bg);
  background-attachment:fixed;
}
.mw-ambient{position:fixed;inset:0;pointer-events:none;max-width:430px;left:50%;transform:translateX(-50%);overflow:hidden;z-index:0}
.mw-ambient span{position:absolute;font-size:18px;opacity:.25;animation:mwDrift 12s ease-in-out infinite}
.mw-ambient span:nth-child(1){top:12%;left:6%}
.mw-ambient span:nth-child(2){top:30%;right:8%;font-size:22px;animation-delay:3s}
.mw-ambient span:nth-child(3){top:60%;left:10%;animation-delay:6s}
.mw-ambient span:nth-child(4){top:78%;right:12%;font-size:20px;animation-delay:1.5s}
@keyframes mwDrift{0%,100%{transform:translate(0,0) rotate(-10deg)}50%{transform:translate(8px,-20px) rotate(10deg)}}

.mw-phone{max-width:430px;margin:0 auto;position:relative;padding-bottom:32px}
.mw-header{display:none}

.mw-hero{padding:16px 18px 12px;position:relative;z-index:2}
.mw-live-tag{display:inline-flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.15em;color:var(--mw-pink);border:1px solid rgba(255,94,196,.3);background:rgba(255,94,196,.06);padding:4px 10px;border-radius:999px;font-weight:700}
.mw-live-tag::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--mw-pink);box-shadow:0 0 6px var(--mw-pink);animation:mwPulse 1.5s ease-in-out infinite}
@keyframes mwPulse{50%{opacity:.4}}
.mw-hero h1{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:30px;line-height:1;margin:10px 0 8px;letter-spacing:-.02em}
.mw-wonder{background:linear-gradient(90deg,var(--mw-pink) 0%,var(--mw-purple) 50%,var(--mw-cyan) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;font-style:italic;font-weight:400}
.mw-hero p{color:var(--mw-text-dim);font-size:12px;line-height:1.4;max-width:320px;font-weight:500;margin:0}

.mw-ticker-strip{margin:12px 0 0;border-top:1px solid var(--mw-border);border-bottom:1px solid var(--mw-border);background:rgba(255,255,255,.01);overflow:hidden;position:relative;z-index:2}
.mw-ticker-track{display:flex;gap:28px;padding:10px 0;white-space:nowrap;animation:mwTicker 30s linear infinite;width:max-content}
@keyframes mwTicker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.mw-ticker-item{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700}
.mw-ticker-item .mw-sym{color:var(--mw-text-dim)}
.mw-up{color:var(--mw-green)}
.mw-down{color:var(--mw-red)}

.mw-search-wrap{padding:14px 18px 8px;position:relative;z-index:2}
.mw-search{display:flex;align-items:center;gap:10px;background:var(--mw-card);border:1.5px solid var(--mw-border);border-radius:14px;padding:12px 14px;transition:border-color .2s}
.mw-search:focus-within{border-color:var(--mw-border-hi)}
.mw-search input{background:none;border:none;color:var(--mw-text);font-family:inherit;font-size:13px;flex:1;outline:none;font-weight:500}
.mw-search input::placeholder{color:var(--mw-text-dimmer)}
.mw-search-clear{flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:var(--mw-text-dim);font-family:inherit;font-size:15px;line-height:1;font-weight:700;cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s}
.mw-search-clear:active{background:rgba(255,255,255,.14);color:var(--mw-text)}

.mw-filters{display:flex;gap:8px;padding:4px 18px 14px;overflow-x:auto;position:relative;z-index:2;scrollbar-width:none}
.mw-filters::-webkit-scrollbar{display:none}
.mw-chip{flex:0 0 auto;padding:7px 14px;border:1.5px solid var(--mw-border);border-radius:999px;font-size:11px;font-weight:700;color:var(--mw-text-dim);background:var(--mw-card);letter-spacing:.05em;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:6px;position:relative}
.mw-chip.mw-active{color:#0a0815;background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));border-color:var(--mw-mint);box-shadow:0 2px 12px rgba(77,255,210,.3)}
.mw-whale-chip{border-color:rgba(255,217,102,.35);color:var(--mw-gold);background:linear-gradient(135deg,rgba(255,217,102,.06),rgba(94,232,255,.04))}
.mw-whale-chip.mw-active{background:linear-gradient(135deg,var(--mw-gold),var(--mw-cyan));border-color:var(--mw-gold-hi);color:#0a0815;box-shadow:0 2px 14px rgba(255,217,102,.4)}
.mw-whale-chip.mw-whale-live:not(.mw-active)::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--mw-gold);box-shadow:0 0 8px var(--mw-gold);animation:mwPulse 1.4s ease-in-out infinite}
.mw-whale-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:rgba(10,8,21,.25);color:inherit;font-size:10px;font-weight:900;font-family:'Unbounded',system-ui,sans-serif}
.mw-whale-chip.mw-active .mw-whale-count{background:rgba(10,8,21,.35)}

.mw-section-head{display:flex;justify-content:space-between;align-items:baseline;padding:6px 18px 12px;position:relative;z-index:2}
.mw-section-title{font-family:'Unbounded',system-ui,sans-serif;font-size:11px;font-weight:800;letter-spacing:.2em;color:var(--mw-text);display:flex;align-items:center;gap:8px}
.mw-section-title::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--mw-pink);box-shadow:0 0 8px var(--mw-pink);animation:mwPulse 1.5s ease-in-out infinite}
.mw-section-title.mw-section-whale::before{background:var(--mw-gold);box-shadow:0 0 8px var(--mw-gold)}
.mw-section-meta{font-size:10px;color:var(--mw-text-dimmer);letter-spacing:.1em}

.mw-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 18px;position:relative;z-index:2}
.mw-card{background:var(--mw-card);border:1.5px solid var(--mw-border);border-radius:18px;padding:14px 12px 12px;position:relative;overflow:hidden;transition:transform .15s,border-color .15s;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.2);animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards}
.mw-card:active{transform:scale(.97) translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-card.mw-hot{border-color:rgba(255,94,196,.22)}
.mw-card.mw-hot::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 100% 60% at 50% 0%,rgba(255,94,196,.18),transparent 70%);pointer-events:none;opacity:.6}
.mw-card.mw-fresh{border-color:rgba(255,225,77,.22)}
.mw-card.mw-fresh::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 100% 60% at 50% 0%,rgba(255,225,77,.15),transparent 70%);pointer-events:none;opacity:.6}
.mw-card.mw-whale{border-color:rgba(255,217,102,.35);box-shadow:0 3px 0 rgba(0,0,0,.2),0 0 30px rgba(255,217,102,.15)}
.mw-card.mw-whale::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 100% 60% at 50% 0%,rgba(255,217,102,.22),transparent 70%),radial-gradient(ellipse 100% 60% at 50% 100%,rgba(94,232,255,.12),transparent 70%);pointer-events:none}
@keyframes mwRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.mw-card-top{display:flex;align-items:center;gap:10px;margin-bottom:8px;position:relative}
.mw-token-icon{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#fbbf24,#84cc16);display:grid;place-items:center;font-size:20px;flex-shrink:0;box-shadow:inset 0 -2px 0 rgba(0,0,0,.15);overflow:hidden}
.mw-token-icon img{width:100%;height:100%;object-fit:cover}
.mw-token-meta{min-width:0;flex:1}
.mw-token-sym{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:15px;letter-spacing:-.01em;line-height:1;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mw-token-age{font-size:9px;color:var(--mw-text-dimmer);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.mw-change{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.02em;line-height:1;position:relative;margin-bottom:12px}
.mw-change.mw-up{color:var(--mw-green);text-shadow:0 0 18px rgba(77,255,136,.3)}
.mw-change.mw-down{color:var(--mw-red);text-shadow:0 0 18px rgba(255,85,119,.25)}
.mw-change-label{font-size:9px;color:var(--mw-text-dimmer);letter-spacing:.15em;text-transform:uppercase;display:block;margin-top:4px;font-family:inherit;font-weight:600}
.mw-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;position:relative}
.mw-mini-btn{border:none;padding:9px 0;border-radius:10px;font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:10px;letter-spacing:.12em;cursor:pointer;transition:transform .1s,filter .15s;box-shadow:0 2px 0 rgba(0,0,0,.2)}
.mw-mini-btn:active{transform:translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-mini-btn.mw-buy{background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));color:#0a0815;box-shadow:0 2px 0 rgba(0,0,0,.2),0 0 18px rgba(77,255,210,.2)}
.mw-mini-btn.mw-sell{background:transparent;color:var(--mw-pink);border:1.5px solid rgba(255,94,196,.4)}
.mw-hot-badge,.mw-fresh-badge,.mw-whale-badge{position:absolute;top:10px;right:10px;font-size:8px;padding:3px 7px;border-radius:6px;letter-spacing:.1em;font-weight:800;z-index:2}
.mw-hot-badge{background:rgba(255,94,196,.18);color:var(--mw-pink);border:1px solid rgba(255,94,196,.35)}
.mw-fresh-badge{background:rgba(255,225,77,.18);color:var(--mw-yellow);border:1px solid rgba(255,225,77,.35)}
.mw-whale-badge{background:linear-gradient(135deg,rgba(255,217,102,.25),rgba(94,232,255,.18));color:var(--mw-gold-hi);border:1px solid rgba(255,217,102,.5);letter-spacing:.05em;box-shadow:0 0 12px rgba(255,217,102,.25)}

.mw-detail{position:fixed;top:0;left:0;right:0;bottom:0;margin:0 auto;width:100%;max-width:430px;height:100vh;height:100dvh;z-index:9999;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 60px);background:radial-gradient(circle at 10% 0%,rgba(255,225,77,.12),transparent 45%),radial-gradient(circle at 90% 20%,rgba(77,255,136,.15),transparent 50%),radial-gradient(circle at 50% 70%,rgba(255,94,196,.1),transparent 55%),var(--mw-bg);animation:mwFadeIn .25s ease-out}
.mw-detail-top{display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 12px) 18px 12px;position:sticky;top:0;z-index:10;background:linear-gradient(180deg,var(--mw-bg) 80%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.mw-icon-btn{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--mw-border);color:var(--mw-text);font-size:18px;cursor:pointer;display:grid;place-items:center;font-weight:600;font-family:inherit}
.mw-detail-title{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:14px;display:flex;align-items:center;gap:6px}
.mw-check-mint{color:var(--mw-mint);font-size:12px}
.mw-detail-hero{padding:4px 22px 18px;display:flex;align-items:center;gap:14px}
.mw-detail-emoji{font-size:52px;line-height:1;flex-shrink:0;animation:mwBounce 2.5s ease-in-out infinite;filter:drop-shadow(0 6px 18px rgba(77,255,136,.4))}
.mw-detail-emoji img{width:60px;height:60px;border-radius:50%;object-fit:cover}
@keyframes mwBounce{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}
.mw-detail-info{flex:1;min-width:0}
.mw-detail-name{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:24px;letter-spacing:-.02em;line-height:1;background:linear-gradient(135deg,var(--mw-yellow),var(--mw-green),var(--mw-mint));-webkit-background-clip:text;background-clip:text;color:transparent}
.mw-detail-fullname{color:var(--mw-text-dim);font-weight:600;font-size:12px;margin-top:3px}
.mw-detail-price-row{display:flex;align-items:center;gap:10px;margin-top:8px}
.mw-detail-price{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.02em;line-height:1}
.mw-inline-actions{padding:0 22px 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mw-big-btn{border:none;padding:16px 0;border-radius:16px;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:13px;letter-spacing:.12em;cursor:pointer;transition:all .15s cubic-bezier(.2,1.2,.4,1)}
.mw-big-btn.mw-buy{background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));color:#0a0815;box-shadow:0 8px 24px rgba(77,255,210,.4),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3)}
.mw-big-btn.mw-sell{background:linear-gradient(135deg,var(--mw-pink),var(--mw-red));color:#fff;box-shadow:0 8px 24px rgba(255,94,196,.4),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.18),inset 0 2px 0 rgba(255,255,255,.2)}
.mw-big-btn:active{transform:translateY(4px)}
.mw-whale-banner{margin:0 22px 14px;background:radial-gradient(ellipse 80% 100% at 0% 50%,rgba(255,217,102,.2),transparent 70%),linear-gradient(135deg,rgba(255,217,102,.08),rgba(94,232,255,.04));border:1.5px solid rgba(255,217,102,.35);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 0 24px rgba(255,217,102,.12)}
.mw-whale-banner-emoji{font-size:28px}
.mw-whale-banner-title{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:11px;color:var(--mw-gold);letter-spacing:.12em}
.mw-whale-banner-sub{font-size:12px;color:var(--mw-text);font-weight:600;margin-top:2px}
.mw-stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 22px}
.mw-stat{background:var(--mw-card);border:1.5px solid var(--mw-border);border-radius:16px;padding:14px 14px 12px;position:relative;overflow:hidden}
.mw-stat::before{content:'';position:absolute;top:0;right:0;width:60px;height:60px;background:radial-gradient(circle,var(--mw-stat-glow,transparent),transparent 70%);opacity:.6}
.mw-stat.mw-mcap{--mw-stat-glow:rgba(192,132,252,.3)}
.mw-stat.mw-holders{--mw-stat-glow:rgba(77,255,136,.3)}
.mw-stat.mw-volume{--mw-stat-glow:rgba(255,225,77,.3)}
.mw-stat.mw-liq{--mw-stat-glow:rgba(94,232,255,.3)}
.mw-stat-icon{font-size:16px;margin-bottom:2px;display:block}
.mw-stat-label{font-size:9px;color:var(--mw-text-dim);letter-spacing:.15em;text-transform:uppercase;font-weight:700;margin-bottom:4px}
.mw-stat-value{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:18px;letter-spacing:-.01em}
.mw-stat-sub{font-size:9px;color:var(--mw-text-dimmer);font-weight:600;margin-top:3px}
.mw-contract{margin:14px 22px 0;padding:12px 14px;background:rgba(255,255,255,.03);border:1px dashed var(--mw-border-hi);border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.mw-contract-info{min-width:0;flex:1}
.mw-contract-label{font-size:9px;color:var(--mw-text-dim);letter-spacing:.15em;text-transform:uppercase;font-weight:700;margin-bottom:2px}
.mw-contract-addr{font-family:'Space Mono',ui-monospace,monospace;font-size:11px;color:var(--mw-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-copy-btn{background:var(--mw-card-hi);border:1px solid var(--mw-border-hi);color:var(--mw-mint);padding:7px 12px;border-radius:9px;font-family:'Unbounded',system-ui,sans-serif;font-weight:700;font-size:10px;letter-spacing:.1em;cursor:pointer;flex-shrink:0}

.mw-sheet-backdrop{position:fixed;inset:0;background:rgba(7,7,11,.6);backdrop-filter:blur(8px);z-index:9998;animation:mwFadeIn .2s}
@keyframes mwFadeIn{from{opacity:0}to{opacity:1}}
.mw-sheet{position:fixed;bottom:0;left:0;right:0;margin:0 auto;width:100%;max-width:430px;background:linear-gradient(180deg,#1a1530 0%,var(--mw-bg-deep) 100%);border-top-left-radius:32px;border-top-right-radius:32px;border-top:2px solid rgba(255,255,255,.08);padding:8px 0 calc(env(safe-area-inset-bottom,0px) + 24px);max-height:92dvh;z-index:9999;animation:mwSlideUp .4s cubic-bezier(.2,1.2,.4,1);box-shadow:0 -20px 60px rgba(255,94,196,.15);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
@keyframes mwSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.mw-grabber{width:44px;height:4px;background:rgba(255,255,255,.18);border-radius:999px;margin:0 auto 14px}
.mw-sheet-token-head{padding:4px 22px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--mw-border)}
.mw-sheet-emoji{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#ffe14d,#4dff88);display:grid;place-items:center;font-size:26px;box-shadow:0 0 0 4px rgba(77,255,136,.15),0 0 30px rgba(255,225,77,.3);flex-shrink:0;overflow:hidden}
.mw-sheet-emoji img{width:100%;height:100%;object-fit:cover}
.mw-sheet-token-info{flex:1;min-width:0}
.mw-sheet-token-name{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:20px;line-height:1;margin-bottom:6px}
.mw-sheet-sub{display:flex;align-items:center;gap:8px}
.mw-age-pill{background:rgba(255,255,255,.06);color:var(--mw-text-dim);padding:3px 8px;border-radius:999px;font-weight:600;font-size:10px;letter-spacing:.05em}
.mw-tab-switch{display:grid;grid-template-columns:1fr 1fr;margin:16px 22px 0;background:var(--mw-bg-deep);border-radius:14px;padding:4px;position:relative;box-shadow:inset 0 2px 4px rgba(0,0,0,.3)}
.mw-tab{padding:11px 0;text-align:center;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:12px;letter-spacing:.12em;color:var(--mw-text-dim);border-radius:10px;cursor:pointer;transition:color .2s;position:relative;z-index:2}
.mw-tab-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));border-radius:10px;transition:transform .4s cubic-bezier(.2,1.3,.4,1),background .3s;z-index:1;box-shadow:0 4px 18px rgba(77,255,210,.35),inset 0 -2px 0 rgba(0,0,0,.1)}
.mw-tab-switch.mw-sell-mode .mw-tab-indicator{transform:translateX(100%);background:linear-gradient(135deg,var(--mw-pink),var(--mw-red));box-shadow:0 4px 18px rgba(255,94,196,.35),inset 0 -2px 0 rgba(0,0,0,.1)}
.mw-tab.mw-active{color:#0a0815}
.mw-amount-section{padding:18px 22px}
.mw-amount-label{font-size:10px;color:var(--mw-text-dim);letter-spacing:.18em;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;text-transform:uppercase;font-weight:700}
.mw-balance{color:var(--mw-text-dim);font-size:10px;background:rgba(255,255,255,.04);padding:4px 10px;border-radius:999px;text-transform:none;letter-spacing:0}
.mw-balance b{color:var(--mw-mint);font-weight:700}
.mw-amount-input-wrap{background:var(--mw-card);border:2px solid var(--mw-border);border-radius:18px;padding:16px;display:flex;align-items:center;gap:10px;transition:all .25s;box-shadow:inset 0 2px 4px rgba(0,0,0,.15)}
.mw-amount-input-wrap:focus-within{border-color:var(--mw-mint);box-shadow:0 0 0 4px rgba(77,255,210,.12),inset 0 2px 4px rgba(0,0,0,.15)}
.mw-amount-input{background:none;border:none;color:var(--mw-text);font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:30px;flex:1;outline:none;letter-spacing:-.02em;min-width:0;width:100%}
.mw-currency{display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--mw-card-hi),var(--mw-card));padding:8px 12px 8px 8px;border-radius:999px;font-weight:700;font-family:'Unbounded',system-ui,sans-serif;font-size:13px;border:1px solid var(--mw-border-hi);flex-shrink:0}
.mw-currency-icon{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#9945ff,#14f195)}
.mw-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}
.mw-preset{background:var(--mw-card);border:2px solid var(--mw-border);color:var(--mw-text-dim);padding:11px 0;border-radius:12px;font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:12px;cursor:pointer;transition:all .15s cubic-bezier(.2,1.2,.4,1);box-shadow:0 2px 0 rgba(0,0,0,.2)}
.mw-preset:active{transform:translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-preset.mw-selected{background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));border-color:var(--mw-mint-hi);color:#0a0815;box-shadow:0 4px 18px rgba(77,255,210,.35),0 2px 0 rgba(0,0,0,.2)}
.mw-receive{margin:12px 22px 0;padding:14px 16px;background:linear-gradient(135deg,rgba(77,255,210,.08),rgba(94,232,255,.04));border:1.5px solid rgba(77,255,210,.22);border-radius:16px;display:flex;justify-content:space-between;align-items:center}
.mw-receive-label{font-size:9px;color:var(--mw-text-dim);letter-spacing:.18em;text-transform:uppercase;font-weight:700}
.mw-receive-amount{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:16px;color:var(--mw-mint-hi);margin-top:3px}
.mw-receive-rate{text-align:right;font-size:9px;color:var(--mw-text-dim);font-weight:600;letter-spacing:.05em}
.mw-receive-rate b{color:var(--mw-text);font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:11px}
.mw-cta-wrap{padding:16px 22px 0}
.mw-cta{width:100%;background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));color:#0a0815;border:none;padding:18px 0;border-radius:18px;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:14px;letter-spacing:.15em;cursor:pointer;box-shadow:0 8px 28px rgba(77,255,210,.4),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3);transition:all .15s cubic-bezier(.2,1.2,.4,1);position:relative;overflow:hidden}
.mw-cta:active{transform:translateY(4px);box-shadow:0 4px 16px rgba(77,255,210,.3),0 0 0 rgba(0,0,0,.25)}
.mw-cta:disabled{opacity:.5;cursor:not-allowed}
.mw-cta.mw-sell-cta{background:linear-gradient(135deg,var(--mw-pink),var(--mw-red));color:#fff}
.mw-cta::after{content:'';position:absolute;top:0;bottom:0;width:70px;left:-110px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:mwShimmer 2.5s ease-in-out infinite}
@keyframes mwShimmer{0%{left:-110px}50%,100%{left:130%}}
.mw-trust{text-align:center;margin-top:12px;font-size:10px;color:var(--mw-text-dim);letter-spacing:.05em;font-weight:600}
.mw-trust b{color:var(--mw-text);font-weight:800}
.mw-jup-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.06);padding:3px 9px;border-radius:999px;margin:0 3px}
.mw-jup-dot{width:6px;height:6px;border-radius:50%;background:var(--mw-green);box-shadow:0 0 6px var(--mw-green)}

.mw-success-overlay{position:fixed;top:0;left:0;right:0;bottom:0;margin:0 auto;width:100%;max-width:430px;height:100vh;height:100dvh;z-index:9999;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:calc(env(safe-area-inset-top,0px) + 16px) 0 calc(env(safe-area-inset-bottom,0px) + 40px);background:radial-gradient(circle at 20% 10%,rgba(77,255,210,.22),transparent 50%),radial-gradient(circle at 80% 30%,rgba(255,225,77,.15),transparent 50%),radial-gradient(circle at 50% 80%,rgba(255,94,196,.18),transparent 55%),var(--mw-bg)}
.mw-confetti-rain{position:fixed;inset:0;max-width:430px;left:50%;transform:translateX(-50%);pointer-events:none;overflow:hidden;z-index:1}
.mw-confetti-piece{position:absolute;top:-30px;animation:mwFall linear forwards}
@keyframes mwFall{0%{transform:translateY(-30px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:.8}}
.mw-success-top{display:flex;justify-content:space-between;align-items:center;padding:4px 18px 8px;position:relative;z-index:5}
.mw-view-on{background:rgba(255,255,255,.06);border:1px solid var(--mw-border-hi);color:var(--mw-text-dim);padding:8px 12px;border-radius:999px;font-family:'Unbounded',system-ui,sans-serif;font-weight:700;font-size:10px;letter-spacing:.1em;cursor:pointer}
.mw-success{text-align:center;padding:18px 22px 4px;position:relative;z-index:5}
.mw-success-emoji{font-size:76px;line-height:1;display:inline-block;animation:mwPop .6s cubic-bezier(.2,1.5,.4,1) backwards;filter:drop-shadow(0 10px 30px rgba(77,255,136,.5))}
@keyframes mwPop{0%{transform:scale(0) rotate(-90deg);opacity:0}60%{transform:scale(1.2) rotate(10deg)}100%{transform:scale(1) rotate(0);opacity:1}}
.mw-success-title{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:34px;letter-spacing:-.02em;line-height:1;margin-top:8px;background:linear-gradient(135deg,var(--mw-yellow),var(--mw-green),var(--mw-mint));-webkit-background-clip:text;background-clip:text;color:transparent;animation:mwRiseDelay .6s .2s backwards}
.mw-success-sub{color:var(--mw-text-dim);font-weight:600;font-size:13px;margin-top:6px;animation:mwRiseDelay .6s .3s backwards}
@keyframes mwRiseDelay{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.mw-flex-card{margin:18px 22px 0;background:radial-gradient(circle at 0% 0%,rgba(77,255,136,.18),transparent 60%),radial-gradient(circle at 100% 100%,rgba(255,94,196,.15),transparent 60%),linear-gradient(135deg,var(--mw-card-hi),var(--mw-card));border:2px solid rgba(77,255,210,.25);border-radius:24px;padding:20px 18px;position:relative;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4),0 0 0 4px rgba(77,255,210,.05);animation:mwRiseDelay .6s .4s backwards;z-index:5}
.mw-flex-watermark{position:absolute;bottom:12px;right:16px;font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:9px;color:var(--mw-text-dimmer);letter-spacing:.2em;opacity:.6}
.mw-flex-watermark b{color:var(--mw-mint)}
.mw-flex-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.mw-flex-emoji{font-size:40px;line-height:1;filter:drop-shadow(0 4px 12px rgba(77,255,136,.4))}
.mw-flex-emoji img{width:44px;height:44px;border-radius:50%;object-fit:cover}
.mw-flex-token{flex:1;min-width:0}
.mw-flex-sym{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.01em;line-height:1;margin-bottom:4px}
.mw-flex-tag{font-size:11px;color:var(--mw-text-dim);font-weight:600}
.mw-flex-divider{height:1px;background:linear-gradient(90deg,transparent,var(--mw-border-hi),transparent);margin:12px 0}
.mw-flex-row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0}
.mw-flex-label{font-size:10px;color:var(--mw-text-dim);letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.mw-flex-value{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:14px;letter-spacing:-.01em}
.mw-flex-value.mw-big{font-size:26px;background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.mw-share-section{margin:18px 22px 0;position:relative;z-index:5;animation:mwRiseDelay .6s .5s backwards}
.mw-share-title{text-align:center;font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:12px;letter-spacing:.15em;color:var(--mw-text);margin-bottom:4px}
.mw-share-sub{text-align:center;font-size:11px;color:var(--mw-text-dim);font-weight:600;margin-bottom:12px}
.mw-share-sub b{color:var(--mw-yellow)}
.mw-share-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mw-share-btn{background:var(--mw-card);border:1.5px solid var(--mw-border);border-radius:14px;padding:12px 4px 9px;text-align:center;cursor:pointer;transition:all .2s cubic-bezier(.2,1.2,.4,1);box-shadow:0 3px 0 rgba(0,0,0,.22);color:var(--mw-text);font-family:inherit}
.mw-share-btn:active{transform:translateY(3px);box-shadow:0 0 0 rgba(0,0,0,.22)}
.mw-share-icon{width:32px;height:32px;border-radius:50%;background:var(--mw-share-bg,var(--mw-card-hi));margin:0 auto 6px;display:grid;place-items:center;font-size:16px;color:var(--mw-share-color,var(--mw-text));font-weight:800;font-family:'Unbounded',system-ui,sans-serif}
.mw-share-label{font-size:10px;font-weight:700;color:var(--mw-text);letter-spacing:.02em}
.mw-refer{margin:14px 22px 0;background:linear-gradient(135deg,rgba(255,225,77,.1),rgba(255,154,60,.06));border:1.5px dashed rgba(255,225,77,.3);border-radius:16px;padding:12px 14px;position:relative;z-index:5;animation:mwRiseDelay .6s .6s backwards}
.mw-refer-row{display:flex;align-items:center;gap:10px}
.mw-refer-emoji{font-size:24px}
.mw-refer-text{flex:1;min-width:0}
.mw-refer-title{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:12px;color:var(--mw-yellow);letter-spacing:.02em}
.mw-refer-sub{font-size:10px;color:var(--mw-text-dim);font-weight:600;margin-top:2px}
.mw-refer-link{margin-top:9px;display:flex;align-items:center;background:rgba(0,0,0,.3);border-radius:9px;padding:7px 10px;gap:8px}
.mw-refer-url{flex:1;font-family:'Space Mono',ui-monospace,monospace;font-size:10px;color:var(--mw-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mw-refer-url b{color:var(--mw-mint)}
.mw-refer-copy{background:linear-gradient(135deg,var(--mw-yellow),var(--mw-orange));color:#1a0f0f;border:none;padding:6px 11px;border-radius:8px;font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:10px;letter-spacing:.1em;cursor:pointer}
.mw-refer-copy:active{transform:translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-done-wrap{padding:18px 22px 0;position:relative;z-index:5;animation:mwRiseDelay .6s .7s backwards}
.mw-done-btn{width:100%;background:linear-gradient(135deg,var(--mw-mint),var(--mw-cyan));color:#0a0815;border:none;padding:16px 0;border-radius:16px;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:13px;letter-spacing:.15em;cursor:pointer;box-shadow:0 8px 24px rgba(77,255,210,.4),0 4px 0 rgba(0,0,0,.22),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3);transition:all .15s cubic-bezier(.2,1.2,.4,1)}
.mw-done-btn:active{transform:translateY(4px)}

.mw-skeleton{opacity:.5;pointer-events:none}
.mw-skel-circle{background:linear-gradient(90deg,#2a1a3a 0%,#3a2a4a 50%,#2a1a3a 100%);background-size:200% 100%;animation:mwSkelShimmer 1.4s linear infinite}
.mw-skel-line{height:10px;border-radius:6px;background:linear-gradient(90deg,#2a1a3a 0%,#3a2a4a 50%,#2a1a3a 100%);background-size:200% 100%;animation:mwSkelShimmer 1.4s linear infinite;margin:4px 0}
.mw-skel-tall{height:28px;margin:10px 0}
.mw-skel-w-40{width:40%}
.mw-skel-w-60{width:60%}
.mw-skel-w-80{width:80%}
@keyframes mwSkelShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.mw-empty{grid-column:1 / -1;text-align:center;padding:40px 20px;color:var(--mw-text-dimmer);font-size:12px}
.mw-empty-whale{padding:56px 24px;background:linear-gradient(180deg,rgba(255,217,102,.05),transparent);border:1.5px dashed rgba(255,217,102,.3);border-radius:20px;color:var(--mw-text)}
.mw-empty-whale-emoji{font-size:56px;line-height:1;margin-bottom:14px;filter:drop-shadow(0 6px 20px rgba(255,217,102,.4));animation:mwBounce 3s ease-in-out infinite}
.mw-empty-whale-title{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:20px;letter-spacing:-.01em;margin-bottom:8px;background:linear-gradient(135deg,var(--mw-gold),var(--mw-cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.mw-empty-whale-sub{font-size:12px;color:var(--mw-text-dim);font-weight:600;line-height:1.6}

/* ====== ADDITIONS: stat orbs, featured signal, narratives, activity ====== */
.mw-stats-orbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 18px 4px;position:relative;z-index:2}
.mw-orb{position:relative;padding:11px 10px 9px;border-radius:18px;background:var(--mw-card);border:1.5px solid var(--mw-border);overflow:hidden;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards}
.mw-orb::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,var(--mw-orb-glow,transparent),transparent 70%);opacity:.7;pointer-events:none}
.mw-orb.mw-orb-scan{--mw-orb-glow:rgba(255,94,196,.25)}
.mw-orb.mw-orb-whale{--mw-orb-glow:rgba(255,217,102,.28);border-color:rgba(255,217,102,.25)}
.mw-orb.mw-orb-fresh{--mw-orb-glow:rgba(255,225,77,.25)}
.mw-orb.mw-orb-vol{--mw-orb-glow:rgba(77,255,210,.28)}
.mw-orb-ico{font-size:13px;display:block;margin-bottom:3px;position:relative;z-index:2}
.mw-orb-label{font-size:8px;color:var(--mw-text-dim);letter-spacing:.12em;text-transform:uppercase;font-weight:700;position:relative;z-index:2}
.mw-orb-val{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:18px;line-height:1;letter-spacing:-.01em;margin-top:4px;position:relative;z-index:2}
.mw-orb-spark{margin-top:4px;height:14px;width:100%;position:relative;z-index:2}

.mw-featured{margin:14px 18px 0;padding:16px 14px 14px;border-radius:22px;background:linear-gradient(135deg,rgba(255,94,196,.12),rgba(192,132,252,.08) 50%,rgba(77,255,210,.08));border:1.5px solid rgba(255,94,196,.22);position:relative;overflow:hidden;cursor:pointer;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:0 4px 24px rgba(255,94,196,.12),0 3px 0 rgba(0,0,0,.2)}
.mw-featured::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 0% 0%,rgba(255,94,196,.2),transparent 70%);pointer-events:none}
.mw-featured:active{transform:scale(.99) translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-featured-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(90deg,var(--mw-pink),var(--mw-orange));color:#0a0815;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:9px;letter-spacing:.15em;padding:4px 10px;border-radius:999px;position:relative;z-index:2}
.mw-featured-body{display:flex;align-items:center;gap:12px;margin-top:12px;position:relative;z-index:2}
.mw-featured-avatar{width:60px;height:60px;border-radius:50%;flex-shrink:0;position:relative;padding:2.5px;background:conic-gradient(from 0deg,var(--mw-pink),var(--mw-orange),var(--mw-yellow),var(--mw-mint),var(--mw-cyan),var(--mw-purple),var(--mw-pink));animation:mwSpin 8s linear infinite}
@keyframes mwSpin{to{transform:rotate(360deg)}}
.mw-featured-avatar-inner{width:100%;height:100%;border-radius:50%;background:var(--mw-card);display:grid;place-items:center;font-size:28px;overflow:hidden}
.mw-featured-avatar-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-featured-crown{position:absolute;top:-3px;left:-2px;width:20px;height:20px;background:linear-gradient(135deg,var(--mw-gold),var(--mw-orange));border-radius:50%;display:grid;place-items:center;font-size:11px;z-index:3;box-shadow:0 2px 8px rgba(255,217,102,.5)}
.mw-featured-meta{flex:1;min-width:0}
.mw-featured-sym{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.02em;line-height:1}
.mw-featured-name{font-size:11px;color:var(--mw-text-dim);font-weight:600;margin-top:4px}
.mw-featured-score{text-align:right;flex-shrink:0}
.mw-featured-score-num{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:36px;line-height:1;background:linear-gradient(135deg,var(--mw-pink),var(--mw-orange));-webkit-background-clip:text;background-clip:text;color:transparent}
.mw-featured-score-denom{font-size:11px;color:var(--mw-text-dim);font-weight:700}
.mw-featured-score-label{font-size:8px;color:var(--mw-text-dim);letter-spacing:.15em;font-weight:700;margin-top:2px}
.mw-featured-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;position:relative;z-index:2}
.mw-fm{text-align:center;padding:8px 4px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--mw-border)}
.mw-fm-ico{font-size:13px;display:block;margin-bottom:2px}
.mw-fm-val{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:13px;line-height:1}
.mw-fm-lbl{font-size:8px;color:var(--mw-text-dim);letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-top:3px}
.mw-fm-val.mw-up{color:var(--mw-green)}
.mw-fm-val.mw-down{color:var(--mw-red)}

.mw-narratives{display:flex;gap:8px;padding:4px 18px 4px;overflow-x:auto;position:relative;z-index:2;scrollbar-width:none}
.mw-narratives::-webkit-scrollbar{display:none}
.mw-narr{flex:0 0 auto;padding:9px 13px;border-radius:14px;background:var(--mw-card);border:1.5px solid var(--mw-border);display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color .15s;min-width:0}
.mw-narr:active{transform:scale(.97)}
.mw-narr-emoji{font-size:18px;flex-shrink:0}
.mw-narr-body{min-width:0}
.mw-narr-name{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:10px;letter-spacing:.05em;line-height:1;white-space:nowrap}
.mw-narr-pct{font-size:11px;font-weight:800;color:var(--mw-green);margin-top:3px;line-height:1}
.mw-narr-pct.mw-down{color:var(--mw-red)}

.mw-activity{padding:8px 18px 0;position:relative;z-index:2}
.mw-activity-list{display:flex;flex-direction:column;gap:6px}
.mw-act{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--mw-card);border:1px solid var(--mw-border);transition:border-color .15s;cursor:pointer}
.mw-act:active{transform:scale(.99)}
.mw-act.mw-act-whale{border-color:rgba(255,217,102,.3);background:linear-gradient(90deg,rgba(255,217,102,.06),transparent 60%)}
.mw-act.mw-act-launch{border-color:rgba(255,225,77,.3);background:linear-gradient(90deg,rgba(255,225,77,.05),transparent 60%)}
.mw-act-ico{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.06);display:grid;place-items:center;font-size:14px;flex-shrink:0}
.mw-act-body{flex:1;min-width:0}
.mw-act-l1{font-size:10px;color:var(--mw-text-dim);letter-spacing:.05em;font-weight:600}
.mw-act-l1 b{color:var(--mw-text);font-weight:800}
.mw-act-l2{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:12px;margin-top:2px;line-height:1}
.mw-act-right{text-align:right;flex-shrink:0}
.mw-act-amt{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:11px;color:var(--mw-mint)}
.mw-act-amt.mw-gold{color:var(--mw-gold)}
.mw-act-time{font-size:9px;color:var(--mw-text-dimmer);font-weight:700;margin-top:2px}

@media (max-width:430px){
  .mw-phone{padding-bottom:24px}
  .mw-hero{padding:14px 14px 10px}
  .mw-hero h1{font-size:28px;margin:8px 0 6px}
  .mw-hero p{font-size:11px;max-width:280px}
  .mw-live-tag{font-size:9px;padding:3px 8px}
  .mw-ticker-item{font-size:10px}
  .mw-ticker-track{gap:22px;padding:8px 0}
  .mw-search-wrap{padding:10px 14px 6px}
  .mw-search{padding:10px 12px}
  .mw-search input{font-size:12px}
  .mw-filters{padding:4px 14px 10px;gap:6px}
  .mw-chip{padding:6px 11px;font-size:10px}
  .mw-section-head{padding:4px 14px 8px}
  .mw-section-title{font-size:10px}
  .mw-section-meta{font-size:9px}
  .mw-grid{padding:0 14px;gap:8px}
  .mw-card{padding:12px 10px 10px;border-radius:14px}
  .mw-token-icon{width:32px;height:32px;font-size:18px}
  .mw-token-sym{font-size:13px}
  .mw-token-age{font-size:8px}
  .mw-change{font-size:20px;margin-bottom:10px}
  .mw-change-label{font-size:8px}
  .mw-mini-btn{font-size:10px;padding:8px 0}
  .mw-hot-badge,.mw-fresh-badge,.mw-whale-badge{font-size:7px;padding:2px 5px;top:8px;right:8px}
  .mw-detail-top{padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px}
  .mw-icon-btn{width:36px;height:36px;font-size:16px}
  .mw-detail-title{font-size:13px}
  .mw-detail-hero{padding:2px 16px 14px;gap:12px}
  .mw-detail-emoji{font-size:44px}
  .mw-detail-emoji img{width:56px;height:56px}
  .mw-detail-name{font-size:20px}
  .mw-detail-fullname{font-size:11px}
  .mw-detail-price{font-size:19px}
  .mw-inline-actions{padding:0 16px 14px;gap:8px}
  .mw-big-btn{font-size:12px;padding:14px 0}
  .mw-whale-banner{margin:0 16px 12px}
  .mw-stats-grid{padding:0 16px;gap:8px}
  .mw-stat{padding:12px 12px 10px;border-radius:14px}
  .mw-stat-label{font-size:8px}
  .mw-stat-value{font-size:16px}
  .mw-stat-sub{font-size:8px}
  .mw-contract{margin:12px 16px 0;padding:10px 12px}
  .mw-contract-addr{font-size:10px}
  .mw-copy-btn{font-size:9px;padding:6px 10px}
  .mw-sheet{padding:8px 0 calc(env(safe-area-inset-bottom,0px) + 20px)}
  .mw-sheet-token-head{padding:2px 16px 14px;gap:10px}
  .mw-sheet-emoji{width:44px;height:44px;font-size:22px}
  .mw-sheet-token-name{font-size:17px}
  .mw-tab{font-size:11px;padding:9px 0}
  .mw-tab-switch{margin:12px 16px 0}
  .mw-amount-section{padding:14px 16px}
  .mw-amount-input{font-size:26px}
  .mw-currency{font-size:12px;padding:6px 10px 6px 6px}
  .mw-currency-icon{width:18px;height:18px}
  .mw-preset{font-size:11px;padding:9px 0}
  .mw-receive{margin:10px 16px 0;padding:12px 14px}
  .mw-receive-amount{font-size:15px}
  .mw-cta-wrap{padding:14px 16px 0}
  .mw-cta{font-size:13px;padding:15px 0}
  .mw-success{padding:14px 16px 4px}
  .mw-success-emoji{font-size:64px}
  .mw-success-title{font-size:28px}
  .mw-success-sub{font-size:12px}
  .mw-flex-card{margin:14px 16px 0;padding:16px 14px}
  .mw-flex-sym{font-size:20px}
  .mw-flex-value.mw-big{font-size:22px}
  .mw-share-section{margin:14px 16px 0}
  .mw-share-btn{padding:10px 4px 7px}
  .mw-share-icon{width:28px;height:28px;font-size:14px}
  .mw-share-label{font-size:9px}
  .mw-refer{margin:12px 16px 0;padding:10px 12px}
  .mw-done-wrap{padding:14px 16px 0}
  .mw-done-btn{font-size:12px;padding:14px 0}
  .mw-stats-orbs{padding:12px 14px 4px;gap:6px}
  .mw-orb{padding:9px 8px 7px;border-radius:14px}
  .mw-orb-val{font-size:15px}
  .mw-orb-ico{font-size:11px}
  .mw-orb-label{font-size:7px}
  .mw-featured{margin:12px 14px 0;padding:14px 12px}
  .mw-featured-avatar{width:54px;height:54px}
  .mw-featured-avatar-inner{font-size:24px}
  .mw-featured-sym{font-size:19px}
  .mw-featured-score-num{font-size:32px}
  .mw-featured-metrics{gap:6px}
  .mw-fm{padding:7px 3px}
  .mw-fm-val{font-size:12px}
  .mw-narratives{padding:4px 14px}
  .mw-narr{padding:8px 11px}
  .mw-activity{padding:8px 14px 0}
}
@media (max-width:380px){
  .mw-hero h1{font-size:25px}
  .mw-grid{gap:7px}
  .mw-card{padding:10px 8px 8px}
  .mw-change{font-size:18px}
  .mw-mini-btn{font-size:9px;padding:7px 0}
  .mw-amount-input{font-size:23px}
  .mw-detail-price{font-size:17px}
  .mw-stat-value{font-size:15px}
}
`;

function useMwCSS() {
  useEffect(() => {
    const id = 'nexus-mw-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = MW_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ─── CONFIG ──────────────────────────────────────────────────────── */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;
const SLIPPAGE_BPS = 500;
const PRIORITY_FEE_MICROLAMPORTS = 50_000;

const RPC_URL =
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const POLL_TOKENS  = 10_000;
const POLL_SOL     = 30_000;
const POLL_WHALES  = 20_000;

const FILTERS = [
  { key: 'trending', label: 'Trending', tf: '24h' },
  { key: '1h',       label: '🔥 1H',    tf: '1h'  },
  { key: '6h',       label: '6H',       tf: '6h'  },
  { key: '24h',      label: '24H',      tf: '24h' },
  { key: 'whales',   label: '🐋 WHALES', tf: null },
  { key: 'new',      label: '🆕 New',   tf: null  },
  { key: 'watch',    label: '⭐ Watch', tf: null  },
];

const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥'];
function emojiFor(sym = '') {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length];
}

/* ─── HELPERS ─────────────────────────────────────────────────────── */
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1)   return n.toFixed(2);
  return n.toPrecision(3);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '$0';
  if (p >= 1)      return '$' + p.toFixed(4);
  if (p >= 0.01)   return '$' + p.toFixed(5);
  if (p >= 0.0001) return '$' + p.toFixed(6);
  return '$' + p.toExponential(2);
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function ageOf(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const h = ms / 3_600_000;
  if (h < 1)  return Math.max(1, Math.round(ms / 60_000)) + 'M OLD';
  if (h < 24) return Math.round(h) + 'H OLD';
  const d = h / 24;
  if (d < 365) return Math.round(d) + 'D OLD';
  return Math.round(d / 365) + 'Y OLD';
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// Heuristic 0–100 signal score. Replace with backend score if you have one.
function signalScore(t) {
  if (!t) return 0;
  const change = Math.min(Math.max(t.change || 0, -100), 200);
  const changePts = Math.min(35, Math.max(0, (change / 200) * 35));
  const volPts = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1)) * 3.5);
  const liqPts = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1)) * 3);
  const holdPts = Math.min(15, Math.log10(Math.max(t.holders || 1, 1)) * 2.5);
  const whalePts = t.whaleSol ? 10 : 0;
  return Math.round(Math.min(100, changePts + volPts + liqPts + holdPts + whalePts));
}

function normalize(t, i = 0) {
  const change = Number(t?.stats24h?.priceChange ?? t?.priceChange24h ?? 0);
  return {
    mint:      t.id || t.address || t.mint,
    sym:       t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    emoji:     emojiFor(t.symbol || ''),
    icon:      t.icon || t.logoURI || null,
    price:     Number(t.usdPrice ?? t.priceUsd ?? 0),
    change,
    age:       ageOf(t.firstPool?.createdAt || t.createdAt),
    mcap:      Number(t.mcap ?? t.fdv ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0),
    holders:   Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    hot:       i < 2 && change > 50,
    fresh:     !!(t.firstPool?.createdAt && (Date.now() - new Date(t.firstPool.createdAt).getTime()) < 24*3600*1000),
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
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route'))
    return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit in one transaction. Try a different amount or token.';
  return err?.message || 'Swap failed. Please try again.';
};

/* ─── NEW SECTIONS ────────────────────────────────────────────────── */

function StatsOrbs({ tokens, whaleCount, freshCount }) {
  const scanning = tokens.length;
  const totalVol = tokens.reduce((s, t) => s + (t.volume24h || 0), 0);

  const spark = (color, points) => (
    <svg className="mw-orb-spark" viewBox="0 0 100 14" preserveAspectRatio="none">
      <path d={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="mw-stats-orbs">
      <div className="mw-orb mw-orb-scan" style={{ animationDelay: '0s' }}>
        <span className="mw-orb-ico">🎯</span>
        <div className="mw-orb-label">scanning</div>
        <div className="mw-orb-val">{scanning}</div>
        {spark('#ff5ec4', 'M0 11 L15 9 L30 10 L45 6 L60 8 L75 4 L90 5 L100 3')}
      </div>
      <div className="mw-orb mw-orb-whale" style={{ animationDelay: '.05s' }}>
        <span className="mw-orb-ico">🐋</span>
        <div className="mw-orb-label">whales 48h</div>
        <div className="mw-orb-val">{whaleCount}</div>
        {spark('#ffd966', 'M0 12 L15 10 L30 11 L45 7 L60 9 L75 5 L90 6 L100 3')}
      </div>
      <div className="mw-orb mw-orb-fresh" style={{ animationDelay: '.1s' }}>
        <span className="mw-orb-ico">🆕</span>
        <div className="mw-orb-label">fresh 24h</div>
        <div className="mw-orb-val">{freshCount}</div>
        {spark('#ffe14d', 'M0 9 L15 11 L30 8 L45 10 L60 6 L75 8 L90 4 L100 6')}
      </div>
      <div className="mw-orb mw-orb-vol" style={{ animationDelay: '.15s' }}>
        <span className="mw-orb-ico">⚡</span>
        <div className="mw-orb-label">24h vol</div>
        <div className="mw-orb-val">${format(totalVol)}</div>
        {spark('#4dffd2', 'M0 12 L10 11 L20 11 L30 8 L40 10 L50 6 L60 8 L70 4 L80 5 L90 2 L100 3')}
      </div>
    </div>
  );
}

function FeaturedSignal({ token, onOpen }) {
  if (!token) return null;
  const score = signalScore(token);
  return (
    <div className="mw-featured" onClick={() => onOpen(token.mint)} style={{ animationDelay: '.1s' }}>
      <div className="mw-featured-badge">⚡ TOP SIGNAL</div>
      <div className="mw-featured-body">
        <div className="mw-featured-avatar">
          <div className="mw-featured-crown">👑</div>
          <div className="mw-featured-avatar-inner">
            {token.icon
              ? <img src={token.icon} alt={token.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              : token.emoji}
          </div>
        </div>
        <div className="mw-featured-meta">
          <div className="mw-featured-sym">${token.sym}</div>
          <div className="mw-featured-name">{token.name} · Solana</div>
        </div>
        <div className="mw-featured-score">
          <div className="mw-featured-score-num">{score}</div>
          <div className="mw-featured-score-denom">/100</div>
          <div className="mw-featured-score-label">SIGNAL</div>
        </div>
      </div>
      <div className="mw-featured-metrics">
        <div className="mw-fm">
          <span className="mw-fm-ico">🔥</span>
          <div className={'mw-fm-val ' + (token.change >= 0 ? 'mw-up' : 'mw-down')}>{formatPct(token.change)}</div>
          <div className="mw-fm-lbl">24h</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">⚡</span>
          <div className="mw-fm-val">${format(token.volume24h)}</div>
          <div className="mw-fm-lbl">vol</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">💰</span>
          <div className="mw-fm-val">${format(token.mcap)}</div>
          <div className="mw-fm-lbl">mcap</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">👥</span>
          <div className="mw-fm-val">{token.holders ? format(token.holders) : '—'}</div>
          <div className="mw-fm-lbl">holders</div>
        </div>
      </div>
    </div>
  );
}

function NarrativesStrip({ tokens, whaleCount }) {
  const matches = (re) => tokens.filter(t => re.test((t.sym || '') + ' ' + (t.name || ''))).length;
  const avgChange = (re) => {
    const list = tokens.filter(t => re.test((t.sym || '') + ' ' + (t.name || '')));
    if (list.length === 0) return 0;
    return list.reduce((s, t) => s + (t.change || 0), 0) / list.length;
  };

  const buckets = [
    { emoji: '🐱', name: 'Cat Season',  re: /cat|meow|popcat|michi|mew/i },
    { emoji: '🐸', name: 'Frog Meta',   re: /pepe|frog|wojak/i },
    { emoji: '🐕', name: 'Dog Revival', re: /dog|shib|bonk|wif|inu/i },
    { emoji: '🤖', name: 'AI Agents',   re: /ai|agent|gpt|bot/i },
    { emoji: '🐋', name: 'Whale Flow',  re: /./, count: whaleCount, fixedPct: whaleCount > 0 ? 18 : 0 },
    { emoji: '🚀', name: 'Fresh Mints', re: /./, count: tokens.filter(t => t.fresh).length, fixedPct: 12 },
  ];

  const active = buckets
    .map(b => ({ ...b, count: b.count ?? matches(b.re), pct: b.fixedPct ?? avgChange(b.re) }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.pct - a.pct);

  if (active.length === 0) return null;

  return (
    <>
      <div className="mw-section-head">
        <div className="mw-section-title">HOT NARRATIVES</div>
        <div className="mw-section-meta">{active.length} ACTIVE</div>
      </div>
      <div className="mw-narratives">
        {active.map(b => (
          <div className="mw-narr" key={b.name}>
            <span className="mw-narr-emoji">{b.emoji}</span>
            <div className="mw-narr-body">
              <div className="mw-narr-name">{b.name}</div>
              <div className={'mw-narr-pct' + (b.pct < 0 ? ' mw-down' : '')}>{formatPct(b.pct)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityFeed({ tokens, whaleEvents, onOpen }) {
  const items = [];
  for (const ev of (whaleEvents || []).slice(0, 8)) {
    items.push({
      type: 'whale',
      mint: ev.mint,
      sym: ev.symbol || 'TOKEN',
      amount: ev.solAmount,
      at: ev.detectedAt || Date.now(),
    });
  }
  for (const t of tokens) {
    if (t.fresh) items.push({
      type: 'launch',
      mint: t.mint,
      sym: t.sym,
      at: Date.now() - Math.random() * 3600000,
    });
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  const top = items.slice(0, 6);
  if (top.length === 0) return null;

  return (
    <>
      <div className="mw-section-head">
        <div className="mw-section-title">LIVE ACTIVITY</div>
        <div className="mw-section-meta">{items.length} EVENTS</div>
      </div>
      <div className="mw-activity">
        <div className="mw-activity-list">
          {top.map((it, i) => (
            <div
              key={i}
              className={'mw-act ' + (it.type === 'whale' ? 'mw-act-whale' : 'mw-act-launch')}
              onClick={() => onOpen && onOpen(it.mint)}
            >
              <div className="mw-act-ico">{it.type === 'whale' ? '🐋' : '🚀'}</div>
              <div className="mw-act-body">
                <div className="mw-act-l1">
                  {it.type === 'whale' ? <><b>whale entry</b> · added liquidity</> : <><b>new launch</b> · just deployed</>}
                </div>
                <div className="mw-act-l2">${it.sym}</div>
              </div>
              <div className="mw-act-right">
                {it.type === 'whale' && it.amount && (
                  <div className="mw-act-amt mw-gold">+{Number(it.amount).toLocaleString()} SOL</div>
                )}
                <div className="mw-act-time">{timeAgo(it.at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── COMPONENT ───────────────────────────────────────────────────── */
export default function MemeWonderland() {
  useMwCSS();

  const wallet = useWallet();
  const { publicKey } = wallet;
  const refCode = publicKey ? publicKey.toString().slice(0, 6) : 'guest';

  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  const [activeFilter, setActiveFilter] = useState('trending');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState(0);
  const [whaleEvents, setWhaleEvents] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [detailMint, setDetailMint] = useState(null);
  const [sheetMint,  setSheetMint]  = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null);

  const [balances, setBalances] = useState({});
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); return; }
    try {
      const owner = wallet.publicKey;
      const [solBal, tokenAccs] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      ]);
      let token22Accs = { value: [] };
      try {
        token22Accs = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
      } catch {}
      const out = {};
      out[SOL_MINT] = { amount: solBal, decimals: 9, uiAmount: solBal / 1e9 };
      const merge = (accs) => {
        for (const acc of accs.value) {
          const info = acc.account.data.parsed?.info;
          if (!info) continue;
          const mint     = info.mint;
          const amount   = info.tokenAmount?.amount;
          const decimals = info.tokenAmount?.decimals;
          const uiAmount = info.tokenAmount?.uiAmount;
          if (!mint || amount == null) continue;
          out[mint] = { amount: Number(amount), decimals, uiAmount };
        }
      };
      merge(tokenAccs);
      merge(token22Accs);
      setBalances(out);
    } catch (e) {
      console.warn('[mw] balances failed', e);
    }
  }, [wallet.publicKey, connection]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  useEffect(() => {
    if (activeFilter === 'whales') return;
    let cancelled = false;
    const f = FILTERS.find(x => x.key === activeFilter);
    async function load() {
      try {
        let url;
        if (activeFilter === 'new')        url = '/api/jupiter/tokens/v2/recent?limit=20';
        else if (activeFilter === 'watch') url = '/api/jupiter/tokens/v2/toporganicscore/24h?limit=20';
        else                               url = `/api/jupiter/tokens/v2/toporganicscore/${f.tf}?limit=20`;
        const r = await fetch(url);
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setTokens(list.map(normalize).filter(t => t.mint));
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    }
    setLoading(true);
    load();
    const id = setInterval(load, POLL_TOKENS);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeFilter]);

  useEffect(() => {
    if (activeFilter !== 'whales') return;
    let cancelled = false;
    async function loadWhales() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        const d = await r.json();
        const events = Array.isArray(d?.events) ? d.events : [];
        if (cancelled) return;
        setWhaleEvents(events);
        if (events.length === 0) { setTokens([]); setLoading(false); return; }
        const mints = events.map(e => e.mint).join(',');
        const tr = await fetch(`/api/jupiter/tokens/search?query=${mints}`);
        const td = await tr.json();
        const list = Array.isArray(td) ? td : (td?.data || []);
        const byMint = new Map(list.map(t => [t.id || t.address, t]));
        const merged = events.map(ev => {
          const t = byMint.get(ev.mint);
          if (!t) {
            return {
              mint: ev.mint, sym: ev.symbol || 'TOKEN', name: ev.name || '',
              emoji: emojiFor(ev.symbol || ''), icon: null,
              price: 0, change: 0, mcap: 0, volume24h: 0, holders: 0, liquidity: 0,
              decimals: 6, whaleSol: ev.solAmount, whaleAt: ev.detectedAt,
            };
          }
          const n = normalize(t);
          n.whaleSol = ev.solAmount;
          n.whaleAt  = ev.detectedAt;
          return n;
        });
        setTokens(merged);
        setLoading(false);
      } catch { if (!cancelled) setLoading(false); }
    }
    setLoading(true);
    loadWhales();
    const id = setInterval(loadWhales, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeFilter]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/sol-price');
        const d = await r.json();
        if (!cancelled && d?.price) setSolPrice(d.price);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        const d = await r.json();
        if (!cancelled) setWhaleEvents(Array.isArray(d?.events) ? d.events : []);
      } catch {}
    }
    loadCount();
    const id = setInterval(loadCount, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(q)}`);
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setSearchResults(list.map(normalize).filter(x => x.mint));
          setSearching(false);
        }
      } catch { if (!cancelled) { setSearchResults([]); setSearching(false); } }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  const ticker = useMemo(
    () => tokens.slice(0, 8).map(t => [t.sym, formatPct(t.change), t.change >= 0]),
    [tokens]
  );

  const tokenByMint = useCallback(
    m => tokens.find(t => t.mint === m) || (searchResults || []).find(t => t.mint === m),
    [tokens, searchResults]
  );

  const isSearching = searchResults !== null;
  const gridTokens = isSearching ? searchResults : tokens;
  const freshCount = tokens.filter(t => t.fresh).length;
  const topToken = !isSearching && activeFilter === 'trending' && tokens.length > 0 ? tokens[0] : null;

  const openDetail = (mint) => setDetailMint(mint);
  const closeDetail = () => setDetailMint(null);
  const openSheet = (mint, m, e) => {
    if (e) e.stopPropagation();
    setSheetMint(mint); setMode(m);
    setAmount('0.50'); setSelectedPreset('0.5');
  };
  const closeSheet = () => setSheetMint(null);
  const handlePreset = (amt) => { setSelectedPreset(amt); setAmount(amt === 'MAX' ? '1.0' : amt); };
  const handleAmount = (v) => { setAmount(v); setSelectedPreset(null); };

  const isWhalesView = activeFilter === 'whales';
  const sectionTitle = isWhalesView ? 'WHALE ENTRIES · 48H'
    : activeFilter === 'new'   ? 'FRESH LAUNCHES'
    : activeFilter === 'watch' ? 'WATCHLIST'
    : 'HOT RIGHT NOW';

  return (
    <div className="mw-root">
      <div className="mw-ambient">
        <span>🐸</span><span>🚀</span><span>💎</span><span>🍭</span>
      </div>

      <div className="mw-phone">
        <div className="mw-hero">
          <span className="mw-live-tag">LIVE MEME MARKET</span>
          <h1>Meme <span className="mw-wonder">wonderland</span></h1>
          <p>Solana memes, routed through Jupiter. One tap to ape.</p>
        </div>

        <StatsOrbs
          tokens={tokens}
          whaleCount={whaleEvents.length}
          freshCount={freshCount}
        />

        {ticker.length > 0 && (
          <div className="mw-ticker-strip">
            <div className="mw-ticker-track">
              {[...ticker, ...ticker].map(([sym, change, up], i) => (
                <span className="mw-ticker-item" key={i}>
                  <span className="mw-sym">{sym}</span>
                  <span className={up ? 'mw-up' : 'mw-down'}>{change}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {topToken && (
          <FeaturedSignal token={topToken} onOpen={openDetail} />
        )}

        <div className="mw-search-wrap">
          <div className="mw-search">
            <span>🔍</span>
            <input
              placeholder="Search ticker, name, or paste contract"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="mw-search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        <div className="mw-filters">
          {FILTERS.map(f => {
            const isWhale = f.key === 'whales';
            const count = isWhale ? whaleEvents.length : 0;
            return (
              <div
                key={f.key}
                className={
                  'mw-chip'
                  + (activeFilter === f.key ? ' mw-active' : '')
                  + (isWhale ? ' mw-whale-chip' : '')
                  + (isWhale && count > 0 ? ' mw-whale-live' : '')
                }
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label}
                {isWhale && count > 0 && <span className="mw-whale-count">{count}</span>}
              </div>
            );
          })}
        </div>

        {!isSearching && (
          <NarrativesStrip tokens={tokens} whaleCount={whaleEvents.length} />
        )}

        <div className="mw-section-head">
          <div className={'mw-section-title' + (isWhalesView && !isSearching ? ' mw-section-whale' : '')}>
            {isSearching ? 'SEARCH RESULTS' : sectionTitle}
          </div>
          <div className="mw-section-meta">
            {isSearching
              ? (searching ? 'SEARCHING…' : `${gridTokens.length} FOUND`)
              : (loading ? 'LOADING…' : isWhalesView ? `${tokens.length} ENTRIES` : `LIVE · ${tokens.length}`)}
          </div>
        </div>

        <div className="mw-grid">
          {(isSearching ? searching && gridTokens.length === 0 : loading && tokens.length === 0) ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mw-card mw-skeleton" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="mw-card-top">
                  <div className="mw-token-icon mw-skel-circle" />
                  <div className="mw-token-meta">
                    <div className="mw-skel-line mw-skel-w-60" />
                    <div className="mw-skel-line mw-skel-w-40" />
                  </div>
                </div>
                <div className="mw-skel-line mw-skel-w-80 mw-skel-tall" />
              </div>
            ))
          ) : gridTokens.length === 0 ? (
            isSearching ? (
              <div className="mw-empty">No tokens match “{searchQuery.trim()}”. Try a ticker, name, or paste a contract address.</div>
            ) : isWhalesView ? (
              <div className="mw-empty mw-empty-whale">
                <div className="mw-empty-whale-emoji">🐋</div>
                <div className="mw-empty-whale-title">No whales today.</div>
                <div className="mw-empty-whale-sub">
                  We watch every Solana pool 24/7.<br />
                  Whales averaging 4-8 entries per month.
                </div>
              </div>
            ) : (
              <div className="mw-empty">No tokens right now. Try another filter.</div>
            )
          ) : (
            gridTokens.slice(0, 12).map((t, i) => (
              <div
                key={t.mint}
                className={
                  'mw-card'
                  + (t.hot ? ' mw-hot' : '')
                  + (t.fresh ? ' mw-fresh' : '')
                  + (t.whaleSol ? ' mw-whale' : '')
                }
                style={{ animationDelay: `${0.03 + i * 0.04}s` }}
                onClick={() => openDetail(t.mint)}
              >
                {t.whaleSol ? (
                  <div className="mw-whale-badge">🐋 +{t.whaleSol.toLocaleString()} SOL</div>
                ) : t.hot ? (
                  <div className="mw-hot-badge">🔥 HOT</div>
                ) : t.fresh ? (
                  <div className="mw-fresh-badge">🆕 NEW</div>
                ) : null}
                <div className="mw-card-top">
                  <div className="mw-token-icon">
                    {t.icon
                      ? <img src={t.icon} alt={t.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : t.emoji}
                  </div>
                  <div className="mw-token-meta">
                    <div className="mw-token-sym">{t.sym}</div>
                    <div className="mw-token-age">
                      {t.whaleAt ? timeAgo(t.whaleAt).toUpperCase() : (t.age || formatPrice(t.price))}
                    </div>
                  </div>
                </div>
                <div className={'mw-change ' + (t.change < 0 ? 'mw-down' : 'mw-up')}>
                  {formatPct(t.change)}
                  <span className="mw-change-label">24H</span>
                </div>
                <div className="mw-actions">
                  <button className="mw-mini-btn mw-buy"  onClick={(e) => openSheet(t.mint, 'buy', e)}>BUY</button>
                  <button className="mw-mini-btn mw-sell" onClick={(e) => openSheet(t.mint, 'sell', e)}>SELL</button>
                </div>
              </div>
            ))
          )}
        </div>

        {!isSearching && (
          <ActivityFeed
            tokens={tokens}
            whaleEvents={whaleEvents}
            onOpen={openDetail}
          />
        )}
      </div>

      {detailMint && tokenByMint(detailMint) && (
        <DetailView
          token={tokenByMint(detailMint)}
          onClose={closeDetail}
          onTrade={(m) => openSheet(detailMint, m)}
        />
      )}

      {sheetMint && tokenByMint(sheetMint) && (
        <TradeSheet
          token={tokenByMint(sheetMint)}
          solPrice={solPrice}
          mode={mode}
          setMode={setMode}
          amount={amount}
          setAmount={handleAmount}
          selectedPreset={selectedPreset}
          handlePreset={handlePreset}
          onClose={closeSheet}
          wallet={wallet}
          connection={connection}
          balances={balances}
          refreshBalances={refreshBalances}
          onSuccess={(payload) => {
            setSuccess({ mint: sheetMint, ...payload });
            setSheetMint(null);
            setDetailMint(null);
          }}
        />
      )}

      {success && tokenByMint(success.mint) && (
        <SuccessView
          data={success}
          token={tokenByMint(success.mint)}
          refCode={refCode}
          onClose={() => setSuccess(null)}
        />
      )}
    </div>
  );
}

/* ─── DETAIL VIEW ─────────────────────────────────────────────────── */
function DetailView({ token, onClose, onTrade }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="mw-detail mw-show">
      <div className="mw-detail-top">
        <button className="mw-icon-btn" onClick={onClose}>←</button>
        <div className="mw-detail-title">${token.sym} <span className="mw-check-mint">✓</span></div>
        <button className="mw-icon-btn">↗</button>
      </div>

      <div className="mw-detail-hero">
        <div className="mw-detail-emoji">
          {token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}
        </div>
        <div className="mw-detail-info">
          <div className="mw-detail-name">{token.sym}</div>
          <div className="mw-detail-fullname">{token.name} · Solana</div>
          <div className="mw-detail-price-row">
            <div className="mw-detail-price">{formatPrice(token.price)}</div>
          </div>
        </div>
      </div>

      <div className="mw-inline-actions">
        <button className="mw-big-btn mw-buy"  onClick={() => onTrade('buy')}>🚀 BUY</button>
        <button className="mw-big-btn mw-sell" onClick={() => onTrade('sell')}>💸 SELL</button>
      </div>

      {token.whaleSol && (
        <div className="mw-whale-banner">
          <span className="mw-whale-banner-emoji">🐋</span>
          <div>
            <div className="mw-whale-banner-title">WHALE ENTRY · {timeAgo(token.whaleAt)}</div>
            <div className="mw-whale-banner-sub">+{token.whaleSol.toLocaleString()} SOL added to liquidity</div>
          </div>
        </div>
      )}

      <div className="mw-stats-grid">
        <div className="mw-stat mw-mcap">
          <span className="mw-stat-icon">💰</span>
          <div className="mw-stat-label">Market Cap</div>
          <div className="mw-stat-value">${format(token.mcap)}</div>
          <div className="mw-stat-sub">USD</div>
        </div>
        <div className="mw-stat mw-holders">
          <span className="mw-stat-icon">{token.emoji}</span>
          <div className="mw-stat-label">Holders</div>
          <div className="mw-stat-value">{token.holders ? format(token.holders) : '—'}</div>
          <div className="mw-stat-sub">on-chain</div>
        </div>
        <div className="mw-stat mw-volume">
          <span className="mw-stat-icon">⚡</span>
          <div className="mw-stat-label">Volume 24h</div>
          <div className="mw-stat-value">${format(token.volume24h)}</div>
          <div className="mw-stat-sub">all DEXs</div>
        </div>
        <div className="mw-stat mw-liq">
          <span className="mw-stat-icon">💧</span>
          <div className="mw-stat-label">Liquidity</div>
          <div className="mw-stat-value">${format(token.liquidity)}</div>
          <div className="mw-stat-sub">🔒 pooled</div>
        </div>
      </div>

      <div className="mw-contract">
        <div className="mw-contract-info">
          <div className="mw-contract-label">Contract</div>
          <div className="mw-contract-addr">{token.mint.slice(0, 8)}…{token.mint.slice(-6)}</div>
        </div>
        <button className="mw-copy-btn" onClick={() => navigator.clipboard?.writeText(token.mint)}>COPY</button>
      </div>
    </div>
  );
}

/* ─── TRADE SHEET ─────────────────────────────────────────────────── */
function TradeSheet({
  token, solPrice, mode, setMode, amount, setAmount,
  selectedPreset, handlePreset, onClose,
  wallet, connection, balances, refreshBalances, onSuccess,
}) {
  const isSell = mode === 'sell';
  const inputMint  = isSell ? token.mint : SOL_MINT;
  const outputMint = isSell ? SOL_MINT  : token.mint;
  const inputDecimals  = isSell ? (token.decimals ?? 6) : 9;
  const outputDecimals = isSell ? 9 : (token.decimals ?? 6);
  const inputSymbol  = isSell ? token.sym : 'SOL';
  const outputSymbol = isSell ? 'SOL' : token.sym;

  const inputBalance = balances[inputMint];
  const amtNum = parseFloat(amount) || 0;
  const usdValue = (amtNum * (isSell ? (token.price || 0) : (solPrice || 0))).toFixed(2);

  const rawAmount = useMemo(() => {
    if (!amount) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputDecimals)).toString();
  }, [amount, inputDecimals]);

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
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) {
          setBuild(null);
          setQuoting(false);
          return;
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:      net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker:       wallet.publicKey
            ? wallet.publicKey.toBase58()
            : '11111111111111111111111111111111',
          computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
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
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => {
    if (!build) return null;
    return Number(build.outAmount) / Math.pow(10, outputDecimals);
  }, [build, outputDecimals]);

  const receiveAmount = useMemo(() => {
    if (quoting) return 'Quoting…';
    if (outAmountUi == null) return '—';
    return format(outAmountUi) + ' ' + outputSymbol;
  }, [quoting, outAmountUi, outputSymbol]);

  const rate = useMemo(() => {
    if (!outAmountUi || !amtNum) return null;
    return outAmountUi / amtNum;
  }, [outAmountUi, amtNum]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);

  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet (Phantom, Solflare, Backpack).');
      return;
    }
    if (!build) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);

    try {
      const dec = inputDecimals;

      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Amount too small.');

      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
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

        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,       true, tokenProgram);

        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, wallet.publicKey,
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
        payerKey:        wallet.publicKey,
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
        console.warn('[swap] sim non-fatal', simErr);
      }

      const signed = await wallet.signTransaction(tx);

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
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain: ' + JSON.stringify(conf.value.err));
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

      const outUi = Number(build.outAmount) / Math.pow(10, outputDecimals);
      onSuccess({
        signature: sig,
        pending: !confirmed,
        paid: amtNum.toFixed(4) + ' ' + inputSymbol,
        got:  format(outUi) + ' ' + outputSymbol,
        price: token.price,
      });

      if (confirmed) setTimeout(() => refreshBalances(), 2000);
    } catch (e) {
      console.error('[mw swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    wallet, build, inputMint, inputDecimals, outputDecimals,
    inputSymbol, outputSymbol, rawAmount, amtNum, token.price,
    connection, onSuccess, refreshBalances,
  ]);

  const hasFunds = inputBalance && amtNum > 0 && inputBalance.uiAmount >= amtNum;
  const canSwap  = !!wallet.publicKey && !!build && !quoting && !swapping &&
                   amtNum > 0 && inputMint !== outputMint && hasFunds;

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
    setAmount(String(maxAmt));
  };

  const ctaLabel = swapping
    ? (isSell ? 'Dumping…' : 'Aping…')
    : !wallet.publicKey
      ? 'Connect Wallet'
      : amtNum <= 0
        ? 'Enter amount'
        : quoting && !build
          ? 'Getting quote…'
          : !build
            ? 'No route available'
            : !hasFunds
              ? `Insufficient ${inputSymbol}`
              : (isSell ? '💸 DUMP ' + token.sym : '🚀 APE INTO ' + token.sym);

  return (
    <>
      <div className="mw-sheet-backdrop mw-show" onClick={swapping ? undefined : onClose}></div>
      <div className="mw-sheet mw-show">
        <div className="mw-grabber"></div>

        <div className="mw-sheet-token-head">
          <div className="mw-sheet-emoji">
            {token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}
          </div>
          <div className="mw-sheet-token-info">
            <div className="mw-sheet-token-name">{token.sym}</div>
            <div className="mw-sheet-sub">
              {token.age && <span className="mw-age-pill">{token.age}</span>}
            </div>
          </div>
          <button className="mw-icon-btn" onClick={onClose} disabled={swapping}>×</button>
        </div>

        <div className={'mw-tab-switch' + (isSell ? ' mw-sell-mode' : '')}>
          <div className="mw-tab-indicator"></div>
          {['buy', 'sell'].map(m => (
            <div
              key={m}
              className={'mw-tab' + (mode === m ? ' mw-active' : '')}
              onClick={() => !swapping && setMode(m)}
            >
              {m.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="mw-amount-section">
          <div className="mw-amount-label">
            <span>You Pay</span>
            <span className="mw-balance">
              {inputBalance
                ? `Bal: ${format(inputBalance.uiAmount)} · ~$${usdValue}`
                : `~$${usdValue}`}
            </span>
          </div>
          <div className="mw-amount-input-wrap">
            <input
              className="mw-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v);
              }}
              disabled={swapping}
            />
            <div className="mw-currency">
              <div className="mw-currency-icon"></div>
              {inputSymbol}
            </div>
          </div>

          <div className="mw-presets">
            {['0.1', '0.5', '1', 'MAX'].map(p => (
              <button
                key={p}
                className={'mw-preset' + (selectedPreset === p ? ' mw-selected' : '')}
                onClick={() => p === 'MAX' ? setMax() : handlePreset(p)}
                disabled={swapping}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mw-receive">
          <div>
            <div className="mw-receive-label">You Get</div>
            <div className="mw-receive-amount">{receiveAmount}</div>
          </div>
          <div className="mw-receive-rate">
            Rate<br />
            <b>{rate ? `1 ${inputSymbol} = ${format(rate)} ${outputSymbol}` : '—'}</b>
          </div>
        </div>

        {(swapError || quoteError) && (
          <div style={{
            margin: '0 16px 8px',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(255, 80, 80, 0.12)',
            color: '#ff8080',
            fontSize: 13,
            textAlign: 'center',
          }}>
            {swapError || quoteError}
          </div>
        )}

        <div className="mw-cta-wrap">
          <button
            className={'mw-cta' + (isSell ? ' mw-sell-cta' : '')}
            onClick={handleSwap}
            disabled={!canSwap}
          >
            {ctaLabel}
          </button>
          <div className="mw-trust">
            Powered by <span className="mw-jup-badge"><span className="mw-jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── SUCCESS VIEW ────────────────────────────────────────────────── */
function SuccessView({ data, token, refCode, onClose }) {
  const [confetti, setConfetti] = useState([]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const emojis = ['🎉','🚀','💎','🐸','✨','🍭','💸','⭐','🌈'];
    setConfetti(Array.from({ length: 36 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 100,
      duration: 3 + Math.random() * 3,
      delay: Math.random() * 1.5,
      size: 16 + Math.random() * 14
    })));
  }, []);

  const shareUrl  = `https://nexus.app/t/${data.mint}?ref=${refCode}`;
  const shareText = `Just aped into $${token.sym} on @nexus 🚀\n\nBag: ${data.got}\nEntry: ${formatPrice(data.price)}`;
  const solscanUrl = data.signature ? `https://solscan.io/tx/${data.signature}` : null;

  return (
    <div className="mw-success-overlay mw-show">
      <div className="mw-confetti-rain">
        {confetti.map(p => (
          <div key={p.id} className="mw-confetti-piece" style={{
            left: p.left + '%',
            animationDuration: p.duration + 's',
            animationDelay: p.delay + 's',
            fontSize: p.size + 'px'
          }}>{p.emoji}</div>
        ))}
      </div>

      <div className="mw-success-top">
        <button className="mw-icon-btn" onClick={onClose}>×</button>
        {solscanUrl && (
          <a className="mw-view-on" href={solscanUrl} target="_blank" rel="noreferrer">
            VIEW ON SOLSCAN ↗
          </a>
        )}
      </div>

      <div className="mw-success">
        <div className="mw-success-emoji">{data.pending ? '⏳' : '🎉'}</div>
        <div className="mw-success-title">{data.pending ? 'CONFIRMING…' : 'YOU APED!'}</div>
        <div className="mw-success-sub">
          {data.pending
            ? 'Submitted — confirming on-chain'
            : `Welcome to the ${token.sym} chat, anon ${token.emoji}`}
        </div>
      </div>

      <div className="mw-flex-card">
        <div className="mw-flex-top">
          <div className="mw-flex-emoji">{token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}</div>
          <div className="mw-flex-token">
            <div className="mw-flex-sym">${token.sym}</div>
            <div className="mw-flex-tag">{token.name}</div>
          </div>
        </div>
        <div className="mw-flex-row"><span className="mw-flex-label">You paid</span><span className="mw-flex-value">{data.paid}</span></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Bag size</span><span className="mw-flex-value mw-big">{data.got}</span></div>
        <div className="mw-flex-divider"></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Entry</span><span className="mw-flex-value" style={{ fontSize: '13px' }}>{formatPrice(data.price)}</span></div>
        <div className="mw-flex-watermark">VIA <b>NEXUS</b></div>
      </div>

      <div className="mw-share-section">
        <div className="mw-share-title">FLEX YOUR BAG 💪</div>
        <div className="mw-share-sub">Earn <b>20%</b> of fees from anyone who apes with your link</div>
        <div className="mw-share-grid">
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#000', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank')}>
            <div className="mw-share-icon">𝕏</div><div className="mw-share-label">Post on X</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#229ED9', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank')}>
            <div className="mw-share-icon">✈</div><div className="mw-share-label">Telegram</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(77,255,210,0.18)', '--mw-share-color': '#4dffd2' }}
            onClick={() => navigator.clipboard?.writeText(shareUrl)}>
            <div className="mw-share-icon">🔗</div><div className="mw-share-label">Copy Link</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(255,225,77,0.18)', '--mw-share-color': '#ffe14d' }}>
            <div className="mw-share-icon">⬇</div><div className="mw-share-label">Save Card</div>
          </button>
        </div>
      </div>

      <div className="mw-refer">
        <div className="mw-refer-row">
          <div className="mw-refer-emoji">💰</div>
          <div className="mw-refer-text">
            <div className="mw-refer-title">YOUR REFERRAL LINK</div>
            <div className="mw-refer-sub">Earn 20% of every swap fee — forever</div>
          </div>
        </div>
        <div className="mw-refer-link">
          <span className="mw-refer-url">nexus.app/t/{data.mint.slice(0, 6)}…?ref=<b>{refCode}</b></span>
          <button className="mw-refer-copy" onClick={() => navigator.clipboard?.writeText(shareUrl)}>COPY</button>
        </div>
      </div>

      <div className="mw-done-wrap">
        <button className="mw-done-btn" onClick={onClose}>🚀 BACK TO WONDERLAND</button>
      </div>
    </div>
  );
}
