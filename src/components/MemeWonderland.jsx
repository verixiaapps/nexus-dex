// MemeWonderland.jsx — pastel wonderland. Matches HTML preview. Swap logic preserved.
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, AddressLookupTableAccount } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

const MW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700&display=swap');
.mw-root{--ink:#1A1B4E;--ink-2:rgba(26,27,78,0.65);--ink-3:rgba(26,27,78,0.45);--pink:#FF8FBE;--mint:#7FFFD4;--lav:#B794F6;--peach:#FFB088;--sky:#A0E7FF;--gold:#FFD46B;--green:#1B7A4F;--red:#D14B6A;--glass:rgba(255,255,255,0.55);--glass-strong:rgba(255,255,255,0.72);--border:rgba(183,148,246,0.22);min-height:100vh;background:radial-gradient(ellipse at 20% 5%,#FFE8F4 0%,transparent 45%),radial-gradient(ellipse at 85% 15%,#E4F2FF 0%,transparent 45%),radial-gradient(ellipse at 50% 60%,#F0E7FF 0%,transparent 55%),radial-gradient(ellipse at 15% 95%,#FFF3E4 0%,transparent 45%),linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);color:var(--ink);font-family:"Space Grotesk",-apple-system,sans-serif;position:relative;overflow-x:hidden;padding-bottom:60px}
.mw-root,.mw-root *{box-sizing:border-box}
@keyframes mw-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes mw-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes mw-pulse-dot{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes mw-ticker{to{transform:translateX(-50%)}}
@keyframes mw-fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.mw-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:0.45;animation:mw-drift 14s ease-in-out infinite;pointer-events:none;z-index:0}
.mw-shimmer-text{background:linear-gradient(90deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:mw-shimmer 6s linear infinite}
.mw-nav{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:rgba(251,245,255,0.7);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.mw-brand{display:flex;align-items:center;gap:10px;cursor:pointer}
.mw-brand-dot{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#FF8FBE,#B794F6 60%,#7FFFD4);box-shadow:0 0 16px rgba(183,148,246,0.5)}
.mw-brand-text{font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;line-height:1}
.mw-brand-text .mw-slash{opacity:0.4;margin:0 4px;font-style:normal}
.mw-nav-right{display:flex;align-items:center;gap:8px}
.mw-live-pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:rgba(127,255,212,0.25);border:1px solid rgba(27,122,79,0.25);font-size:11px;font-weight:600;color:var(--green)}
.mw-live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:mw-pulse-dot 1.5s ease-in-out infinite}
.mw-chain-pill{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:999px;background:var(--glass);border:1px solid var(--border);font-size:12px;font-weight:500}
.mw-chain-dot{width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#B794F6,#FF8FBE)}
.mw-avatar-orb{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 0deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE);padding:2px;position:relative}
.mw-avatar-orb::after{content:'';display:block;width:100%;height:100%;border-radius:50%;background:var(--glass-strong)}
.mw-main{position:relative;z-index:5;padding:18px 16px 60px}
.mw-page{animation:mw-fade-in 0.3s ease}
.mw-eyebrow{font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.mw-eyebrow.mw-accent{background:linear-gradient(90deg,#FF8FBE,#B794F6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.mw-section-head{display:flex;align-items:center;justify-content:space-between;margin:28px 4px 12px}
.mw-section-head .mw-left{display:flex;align-items:center;gap:8px}
.mw-section-head .mw-icon{font-size:14px}
.mw-section-head .mw-view-all{font-size:11px;color:var(--ink-2)}
.mw-stats-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.mw-stat-orb{position:relative;padding:16px;border-radius:28px;background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border);overflow:hidden}
.mw-stat-orb .mw-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.mw-stat-orb .mw-val{font-family:"Instrument Serif",serif;font-size:28px;line-height:1;margin-top:6px}
.mw-stat-orb .mw-delta{font-size:11px;margin-top:4px;font-weight:500;color:var(--green)}
.mw-stat-orb .mw-ico{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px}
.mw-stat-orb .mw-spark{margin-top:10px;height:26px;width:100%}
.mw-ticker-wrap{margin:18px -16px 0;padding:12px 0;background:linear-gradient(90deg,rgba(255,143,190,0.08),rgba(127,255,212,0.08));border-top:1px solid var(--border);border-bottom:1px solid var(--border);overflow:hidden}
.mw-ticker-track{display:flex;gap:28px;white-space:nowrap;animation:mw-ticker 35s linear infinite;font-size:13px;font-weight:500;width:max-content}
.mw-ticker-item{display:inline-flex;gap:6px;align-items:center}
.mw-ticker-sym{color:var(--ink);font-weight:600}
.mw-up{color:var(--green)}
.mw-down{color:var(--red)}
.mw-featured{margin-top:20px;padding:20px;border-radius:32px 56px 32px 56px;background:linear-gradient(135deg,rgba(255,143,190,0.22),rgba(183,148,246,0.18) 50%,rgba(127,255,212,0.18));border:1px solid rgba(255,255,255,0.7);backdrop-filter:blur(12px);position:relative;overflow:hidden;cursor:pointer}
.mw-featured::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 20% 20%,rgba(255,143,190,0.4),transparent 50%);pointer-events:none}
.mw-top-signal-badge{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;background:linear-gradient(90deg,#FF8FBE,#FFB088);color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;position:relative;z-index:2}
.mw-featured-body{display:flex;gap:14px;margin-top:14px;align-items:center;position:relative;z-index:2}
.mw-token-avatar{width:76px;height:76px;border-radius:50%;background:conic-gradient(from 0deg,#FF8FBE,#FFB088,#FFD46B,#7FFFD4,#A0E7FF,#B794F6,#FF8FBE);padding:3px;flex-shrink:0;position:relative}
.mw-token-avatar::after{content:'';display:block;width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,#FFD9A8,#FFAA66)}
.mw-token-avatar .mw-face{position:absolute;inset:3px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:38px;z-index:2;overflow:hidden}
.mw-token-avatar .mw-face img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-crown{position:absolute;top:-6px;left:-2px;z-index:3;width:24px;height:24px;background:var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 4px 12px rgba(255,212,107,0.5)}
.mw-featured-meta{flex:1;min-width:0}
.mw-featured-meta .mw-sym{font-family:"Instrument Serif",serif;font-size:32px;line-height:1}
.mw-featured-meta .mw-sub{font-size:12px;color:var(--ink-2);margin-top:4px}
.mw-signal-score{text-align:right;flex-shrink:0}
.mw-signal-score .mw-num{font-family:"Instrument Serif",serif;font-size:48px;line-height:1;background:linear-gradient(135deg,#FF8FBE,#B794F6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.mw-signal-score .mw-denom{font-size:13px;color:var(--ink-2)}
.mw-signal-score .mw-label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-2);margin-top:2px}
.mw-featured-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:16px;position:relative;z-index:2}
.mw-fm{display:flex;align-items:center;gap:8px}
.mw-fm-ico{width:28px;height:28px;border-radius:50%;background:var(--glass-strong);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.mw-fm-text{line-height:1.15}
.mw-fm-val{font-size:14px;font-weight:600}
.mw-fm-lbl{font-size:10px;color:var(--ink-2)}
.mw-featured-actions{display:flex;gap:8px;margin-top:16px;position:relative;z-index:2}
.mw-btn-gradient{flex:1;border:none;cursor:pointer;padding:14px 16px;border-radius:999px;background:linear-gradient(90deg,#FF8FBE,#FFB088,#FFD46B);color:#fff;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:0.5px;box-shadow:0 8px 24px rgba(255,143,190,0.4);display:flex;align-items:center;justify-content:center;gap:6px}
.mw-btn-ghost{flex:1;border:1px solid var(--border);cursor:pointer;padding:13px 16px;border-radius:999px;background:var(--glass);color:var(--ink);font-family:inherit;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px}
.mw-hscroll{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 16px 8px;margin:0 -16px;scrollbar-width:none}
.mw-hscroll::-webkit-scrollbar{display:none}
.mw-whale-card{flex:0 0 175px;scroll-snap-align:start;padding:14px;border-radius:24px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);position:relative;cursor:pointer}
.mw-whale-card.mw-featured-card{border:1.5px solid transparent;background:linear-gradient(var(--glass),var(--glass)) padding-box,linear-gradient(135deg,#FF8FBE,#B794F6,#7FFFD4) border-box}
.mw-whale-row{display:flex;align-items:center;gap:10px}
.mw-mini-avatar{width:38px;height:38px;border-radius:50%;padding:2px;flex-shrink:0;background:conic-gradient(from 0deg,#FF8FBE,#B794F6,#7FFFD4,#FFB088,#FF8FBE)}
.mw-mini-avatar .mw-inner{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;background:linear-gradient(135deg,#FFD9C9,#E8B8A0)}
.mw-mini-avatar .mw-inner img{width:100%;height:100%;object-fit:cover}
.mw-whale-sym{font-size:14px;font-weight:700}
.mw-whale-pct{font-size:14px;font-weight:700;color:var(--green)}
.mw-whale-pct.mw-down{color:var(--red)}
.mw-whale-foot{display:flex;justify-content:space-between;margin-top:12px;font-size:11px;color:var(--ink-2)}
.mw-signal-card-h{flex:0 0 195px;scroll-snap-align:start;padding:14px;border-radius:24px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);position:relative;cursor:pointer}
.mw-signal-head{display:flex;align-items:center;justify-content:space-between}
.mw-signal-head .mw-left{display:flex;align-items:center;gap:8px}
.mw-signal-card-h .mw-score{text-align:right}
.mw-signal-card-h .mw-score-num{font-family:"Instrument Serif",serif;font-size:26px;line-height:1}
.mw-signal-card-h .mw-score-lbl{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-2)}
.mw-signal-spark{margin-top:10px;height:36px;width:100%}
.mw-signal-foot{font-size:13px;font-weight:600;margin-top:6px}
.mw-narratives{display:flex;gap:8px;overflow-x:auto;padding:4px 16px;margin:0 -16px;scrollbar-width:none}
.mw-narratives::-webkit-scrollbar{display:none}
.mw-narr-chip{flex-shrink:0;padding:12px 16px;border-radius:22px 40px 22px 40px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);min-width:130px}
.mw-narr-emoji{font-size:16px}
.mw-narr-name{font-size:12px;font-weight:600;margin-top:4px}
.mw-narr-pct{font-size:16px;font-weight:700;margin-top:4px;color:var(--green)}
.mw-narr-pct.mw-down{color:var(--red)}
.mw-narr-assets{font-size:10px;color:var(--ink-2);margin-top:2px}
.mw-feed{display:flex;flex-direction:column;gap:8px}
.mw-feed-item{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:28px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px);cursor:pointer}
.mw-feed-ico{width:32px;height:32px;border-radius:50%;background:var(--glass-strong);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.mw-feed-body{flex:1;min-width:0}
.mw-feed-l1{font-size:12px;color:var(--ink-2)}
.mw-feed-l1 b{color:var(--ink);font-weight:600}
.mw-feed-l2{font-size:14px;font-weight:600;margin-top:2px}
.mw-feed-right{text-align:right;flex-shrink:0}
.mw-feed-amt{font-size:13px;font-weight:600;color:var(--green)}
.mw-feed-time{font-size:10px;color:var(--ink-3);margin-top:2px}
.mw-back-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.mw-back-btn{width:36px;height:36px;border-radius:50%;background:var(--glass);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}
.mw-top-actions{display:flex;gap:8px}
.mw-icon-pill{padding:8px 14px;border-radius:999px;background:var(--glass);border:1px solid var(--border);display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;cursor:pointer}
.mw-token-hero{display:flex;gap:14px;align-items:center}
.mw-token-hero .mw-meta{flex:1;min-width:0}
.mw-token-hero .mw-sym{font-family:"Instrument Serif",serif;font-size:36px;line-height:1}
.mw-token-hero .mw-chain{font-size:12px;color:var(--ink-2);margin-top:4px}
.mw-tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.mw-tag{padding:4px 10px;border-radius:999px;font-size:10px;font-weight:600;border:1px solid}
.mw-tag.mw-t1{color:#B794F6;border-color:rgba(183,148,246,0.4);background:rgba(183,148,246,0.1)}
.mw-tag.mw-t2{color:#FF8FBE;border-color:rgba(255,143,190,0.4);background:rgba(255,143,190,0.1)}
.mw-tag.mw-t3{color:#FFB088;border-color:rgba(255,176,136,0.4);background:rgba(255,176,136,0.1)}
.mw-token-actions{display:flex;gap:8px;margin-top:16px}
.mw-star-btn{width:46px;height:46px;border-radius:50%;background:var(--glass);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0}
.mw-signal-big{margin-top:20px;padding:18px;border-radius:32px;background:linear-gradient(135deg,rgba(255,143,190,0.18),rgba(183,148,246,0.18));border:1px solid rgba(255,255,255,0.7);backdrop-filter:blur(12px);display:flex;gap:16px;align-items:center}
.mw-signal-big .mw-left-col{flex:0 0 auto}
.mw-signal-big .mw-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--ink-2)}
.mw-signal-big .mw-num{font-family:"Instrument Serif",serif;font-size:56px;line-height:1;background:linear-gradient(135deg,#FF8FBE,#B794F6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-top:4px}
.mw-signal-big .mw-denom{font-size:13px;color:var(--ink-2)}
.mw-signal-big .mw-top-badge{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;background:linear-gradient(90deg,#FF8FBE,#FFB088);color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;margin-top:10px}
.mw-signal-big .mw-right-col{flex:1;min-width:0}
.mw-radar-row{display:flex;align-items:center;gap:10px;font-size:11px;margin-top:4px}
.mw-radar-row:first-child{margin-top:0}
.mw-radar-dot{width:7px;height:7px;border-radius:50%}
.mw-radar-label{flex:1;color:var(--ink-2)}
.mw-radar-val{font-weight:700;color:var(--ink)}
.mw-stat-mini-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:16px}
.mw-stat-mini{padding:12px 14px;border-radius:20px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px)}
.mw-stat-mini .mw-lbl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.mw-stat-mini .mw-val{font-family:"Instrument Serif",serif;font-size:17px;margin-top:4px;line-height:1}
.mw-stat-mini .mw-dlt{font-size:11px;font-weight:600;margin-top:4px;color:var(--green)}
.mw-stat-mini .mw-dlt.mw-neg{color:var(--red)}
.mw-two-col{display:grid;grid-template-columns:1fr;gap:12px;margin-top:16px}
.mw-card-pill{padding:18px;border-radius:28px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(10px)}
.mw-info-row{display:flex;justify-content:space-between;padding:9px 0;font-size:12px;border-bottom:1px dashed var(--border)}
.mw-info-row:last-child{border-bottom:none}
.mw-info-lbl{color:var(--ink-2)}
.mw-info-val{font-weight:600;font-family:ui-monospace,monospace;font-size:11px}
.mw-sheet-backdrop{position:fixed;inset:0;background:rgba(26,27,78,0.4);backdrop-filter:blur(8px);z-index:9998}
.mw-sheet{position:fixed;bottom:0;left:0;right:0;margin:0 auto;width:100%;max-width:430px;background:linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);border-top-left-radius:32px;border-top-right-radius:32px;border-top:1px solid var(--border);padding:8px 0 calc(env(safe-area-inset-bottom,0px) + 24px);max-height:92dvh;z-index:9999;box-shadow:0 -20px 60px rgba(183,148,246,0.25);overflow-y:auto}
.mw-grabber{width:44px;height:4px;background:rgba(26,27,78,0.18);border-radius:999px;margin:0 auto 14px}
.mw-sheet-head{padding:4px 22px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}
.mw-sheet-emoji{width:52px;height:52px;border-radius:50%;padding:2.5px;background:conic-gradient(from 0deg,#FF8FBE,#FFB088,#7FFFD4,#B794F6,#FF8FBE);flex-shrink:0}
.mw-sheet-emoji-inner{width:100%;height:100%;border-radius:50%;background:var(--glass-strong);display:grid;place-items:center;font-size:24px;overflow:hidden}
.mw-sheet-emoji-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-sheet-info{flex:1;min-width:0}
.mw-sheet-name{font-family:"Instrument Serif",serif;font-size:24px;line-height:1;margin-bottom:6px}
.mw-age-pill{background:var(--glass);color:var(--ink-2);padding:3px 8px;border-radius:999px;font-weight:500;font-size:10px}
.mw-tab-switch{display:grid;grid-template-columns:1fr 1fr;margin:16px 22px 0;background:var(--glass);border:1px solid var(--border);border-radius:14px;padding:4px;position:relative}
.mw-tab{padding:11px 0;text-align:center;font-family:inherit;font-weight:700;font-size:12px;letter-spacing:0.1em;color:var(--ink-2);border-radius:10px;cursor:pointer;position:relative;z-index:2;transition:color 0.2s}
.mw-tab-indicator{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:linear-gradient(135deg,#7FFFD4,#A0E7FF);border-radius:10px;transition:transform 0.4s cubic-bezier(0.2,1.3,0.4,1),background 0.3s;z-index:1;box-shadow:0 4px 12px rgba(127,255,212,0.4)}
.mw-tab-switch.mw-sell-mode .mw-tab-indicator{transform:translateX(100%);background:linear-gradient(135deg,#FF8FBE,#FFB088);box-shadow:0 4px 12px rgba(255,143,190,0.4)}
.mw-tab.mw-active{color:var(--ink)}
.mw-amount-section{padding:18px 22px}
.mw-amount-label{font-size:10px;color:var(--ink-2);letter-spacing:0.18em;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;text-transform:uppercase;font-weight:600}
.mw-balance-pill{color:var(--ink-2);font-size:10px;background:var(--glass);padding:4px 10px;border-radius:999px;text-transform:none;letter-spacing:0}
.mw-balance-pill b{color:var(--green);font-weight:700}
.mw-amount-input-wrap{background:var(--glass);border:1.5px solid var(--border);border-radius:18px;padding:16px;display:flex;align-items:center;gap:10px;transition:all 0.25s}
.mw-amount-input-wrap:focus-within{border-color:var(--lav);box-shadow:0 0 0 4px rgba(183,148,246,0.12)}
.mw-amount-input{background:none;border:none;color:var(--ink);font-family:"Instrument Serif",serif;font-size:34px;flex:1;outline:none;min-width:0;width:100%}
.mw-currency{display:flex;align-items:center;gap:8px;background:var(--glass-strong);padding:8px 12px 8px 8px;border-radius:999px;font-weight:600;font-size:13px;border:1px solid var(--border);flex-shrink:0}
.mw-currency-icon{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#B794F6,#7FFFD4)}
.mw-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}
.mw-preset{background:var(--glass);border:1.5px solid var(--border);color:var(--ink-2);padding:11px 0;border-radius:12px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;transition:all 0.15s}
.mw-preset.mw-selected{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);border-color:var(--mint);color:var(--ink);box-shadow:0 4px 12px rgba(127,255,212,0.4)}
.mw-receive{margin:12px 22px 0;padding:14px 16px;background:linear-gradient(135deg,rgba(127,255,212,0.18),rgba(160,231,255,0.12));border:1.5px solid rgba(127,255,212,0.4);border-radius:16px;display:flex;justify-content:space-between;align-items:center}
.mw-receive-label{font-size:9px;color:var(--ink-2);letter-spacing:0.18em;text-transform:uppercase;font-weight:600}
.mw-receive-amount{font-family:"Instrument Serif",serif;font-size:22px;color:var(--green);margin-top:3px}
.mw-receive-rate{text-align:right;font-size:10px;color:var(--ink-2);font-weight:500}
.mw-receive-rate b{color:var(--ink);font-weight:600}
.mw-cta-wrap{padding:16px 22px 0}
.mw-cta{width:100%;background:linear-gradient(90deg,#7FFFD4,#A0E7FF,#B794F6);color:var(--ink);border:none;padding:18px 0;border-radius:18px;font-family:inherit;font-weight:700;font-size:15px;letter-spacing:0.1em;cursor:pointer;box-shadow:0 8px 24px rgba(127,255,212,0.35);transition:all 0.15s}
.mw-cta.mw-sell-cta{background:linear-gradient(90deg,#FF8FBE,#FFB088,#FFD46B);color:#fff;box-shadow:0 8px 24px rgba(255,143,190,0.4)}
.mw-cta:disabled{opacity:0.5;cursor:not-allowed}
.mw-trust{text-align:center;margin-top:12px;font-size:10px;color:var(--ink-2)}
.mw-empty{text-align:center;padding:40px 20px;color:var(--ink-2);font-size:13px}
.mw-skeleton-card{padding:14px;border-radius:24px;background:var(--glass);border:1px solid var(--border);height:110px;opacity:0.6}
`;

function useMwCSS() {
  useEffect(() => {
    const id = 'nexus-mw-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = MW_CSS;
    document.head.appendChild(el);
  }, []);
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS = 500;
const SLIPPAGE_BPS = 500;
const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const RPC_URL = process.env.REACT_APP_SOLANA_RPC || (process.env.REACT_APP_HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}` : 'https://api.mainnet-beta.solana.com');
const POLL_TOKENS = 10_000, POLL_SOL = 30_000, POLL_WHALES = 20_000;
const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥'];
function emojiFor(sym = '') { let h=0; for (let i=0;i<sym.length;i++) h=(h*31+sym.charCodeAt(i))|0; return EMOJI_POOL[Math.abs(h)%EMOJI_POOL.length]; }

function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '$0';
  if (p >= 1) return '$'+p.toFixed(4);
  if (p >= 0.01) return '$'+p.toFixed(5);
  if (p >= 0.0001) return '$'+p.toFixed(6);
  return '$'+p.toExponential(2);
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function ageOf(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const h = ms/3_600_000;
  if (h < 1) return Math.max(1, Math.round(ms/60_000))+'m';
  if (h < 24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
function timeAgo(ms) {
  const s = Math.floor((Date.now()-ms)/1000);
  if (s < 60) return s+'s ago';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function signalScore(t) {
  if (!t) return 0;
  const change = Math.min(Math.max(t.change || 0, -100), 200);
  const changePts = Math.min(35, Math.max(0, (change/200)*35));
  const volPts = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1))*3.5);
  const liqPts = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1))*3);
  const holdPts = Math.min(15, Math.log10(Math.max(t.holders || 1, 1))*2.5);
  const whalePts = t.whaleSol ? 10 : 0;
  return Math.round(Math.min(100, changePts+volPts+liqPts+holdPts+whalePts));
}
function normalize(t) {
  const change = Number(t?.stats24h?.priceChange ?? t?.priceChange24h ?? 0);
  return {
    mint: t.id || t.address || t.mint,
    sym: t.symbol || '???',
    name: t.name || t.symbol || 'Unknown',
    emoji: emojiFor(t.symbol || ''),
    icon: t.icon || t.logoURI || null,
    price: Number(t.usdPrice ?? t.priceUsd ?? 0),
    change,
    age: ageOf(t.firstPool?.createdAt || t.createdAt),
    mcap: Number(t.mcap ?? t.fdv ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0),
    holders: Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    decimals: Number(t.decimals ?? 6),
    fresh: !!(t.firstPool?.createdAt && (Date.now() - new Date(t.firstPool.createdAt).getTime()) < 24*3600*1000),
  };
}
const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(ix.data, 'base64'),
});
const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient')) return 'Insufficient balance for this swap.';
  if (m.includes('slippage')) return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled')) return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not')) return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate')) return 'Too many requests — please wait a moment.';
  if (m.includes('no route')) return 'No route available for this pair.';
  if (m.includes('too large')) return 'Route too complex. Try a different amount.';
  return err?.message || 'Swap failed. Please try again.';
};

export default function MemeWonderland() {
  useMwCSS();
  const wallet = useWallet();
  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState(0);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [view, setView] = useState({ page: 'explore', mint: null });
  const [sheetMint, setSheetMint] = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
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
      try { token22Accs = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }); } catch {}
      const out = {};
      out[SOL_MINT] = { amount: solBal, decimals: 9, uiAmount: solBal/1e9 };
      const merge = (accs) => {
        for (const acc of accs.value) {
          const info = acc.account.data.parsed?.info;
          if (!info) continue;
          const mint = info.mint, amt = info.tokenAmount?.amount, decimals = info.tokenAmount?.decimals, uiAmount = info.tokenAmount?.uiAmount;
          if (!mint || amt == null) continue;
          out[mint] = { amount: Number(amt), decimals, uiAmount };
        }
      };
      merge(tokenAccs); merge(token22Accs);
      setBalances(out);
    } catch (e) { console.warn('[mw] balances failed', e); }
  }, [wallet.publicKey, connection]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/jupiter/tokens/v2/toporganicscore/24h?limit=20');
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) { setTokens(list.map(normalize).filter(t => t.mint)); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    }
    load();
    const id = setInterval(load, POLL_TOKENS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
    async function load() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48*3600*1000));
        const d = await r.json();
        if (!cancelled) setWhaleEvents(Array.isArray(d?.events) ? d.events : []);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const tokenByMint = useCallback(m => tokens.find(t => t.mint === m), [tokens]);
  const ticker = useMemo(() => tokens.slice(0, 10).map(t => [t.sym, formatPct(t.change), t.change >= 0]), [tokens]);
  const topToken = tokens[0];
  const totalVol = tokens.reduce((s, t) => s + (t.volume24h || 0), 0);
  const freshCount = tokens.filter(t => t.fresh).length;

  const openToken = (mint) => { setView({ page: 'token', mint }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const backToExplore = () => { setView({ page: 'explore', mint: null }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openSheet = (mint, m, e) => {
    if (e) e.stopPropagation();
    setSheetMint(mint); setMode(m);
    setAmount('0.50'); setSelectedPreset('0.5');
  };
  const handlePreset = (amt) => { setSelectedPreset(amt); setAmount(amt === 'MAX' ? '1.0' : amt); };
  const handleAmount = (v) => { setAmount(v); setSelectedPreset(null); };

  const narratives = useMemo(() => {
    const buckets = [
      { emoji: '🐱', name: 'Cat Season', re: /cat|meow|popcat|michi|mew/i },
      { emoji: '🐸', name: 'Frog Meta', re: /pepe|frog|wojak/i },
      { emoji: '🐕', name: 'Dog Revival', re: /dog|shib|bonk|wif|inu/i },
      { emoji: '🤖', name: 'AI Agents', re: /ai|agent|gpt|bot/i },
    ];
    return buckets.map(b => {
      const list = tokens.filter(t => b.re.test((t.sym || '') + ' ' + (t.name || '')));
      const pct = list.length > 0 ? list.reduce((s, t) => s + (t.change || 0), 0) / list.length : 0;
      return { ...b, count: list.length, pct };
    }).filter(b => b.count > 0).sort((a, b) => b.pct - a.pct);
  }, [tokens]);

  const activity = useMemo(() => {
    const items = [];
    for (const ev of whaleEvents.slice(0, 6)) items.push({ type: 'whale', mint: ev.mint, sym: ev.symbol || 'TOKEN', amount: ev.solAmount, at: ev.detectedAt || Date.now() });
    for (const t of tokens.filter(x => x.fresh).slice(0, 4)) items.push({ type: 'launch', mint: t.mint, sym: t.sym, at: Date.now() - Math.random()*3600000 });
    return items.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
  }, [whaleEvents, tokens]);

  return (
    <div className="mw-root">
      <div className="mw-blob" style={{ width: 400, height: 400, background: '#FF8FBE', top: -80, left: -120 }} />
      <div className="mw-blob" style={{ width: 500, height: 500, background: '#A0E7FF', top: '30%', right: -180, animationDelay: '3s' }} />
      <div className="mw-blob" style={{ width: 340, height: 340, background: '#B794F6', bottom: '10%', left: -100, animationDelay: '6s' }} />
      <div className="mw-blob" style={{ width: 260, height: 260, background: '#FFD46B', bottom: '30%', right: '10%', animationDelay: '9s' }} />

      <nav className="mw-nav">
        <div className="mw-brand" onClick={backToExplore}>
          <div className="mw-brand-dot" />
          <span className="mw-brand-text">
            wonderland<span className="mw-slash">//</span>
            <span className="mw-shimmer-text">{view.page === 'token' ? (tokenByMint(view.mint)?.sym?.toLowerCase() || 'token') : 'explore'}</span>
          </span>
        </div>
        <div className="mw-nav-right">
          <div className="mw-live-pill"><span className="mw-live-dot" /> LIVE</div>
          <div className="mw-chain-pill"><span className="mw-chain-dot" /> Solana ▾</div>
          <div className="mw-avatar-orb" />
        </div>
      </nav>

      <main className="mw-main">
        {view.page === 'explore' ? (
          <ExplorePage tokens={tokens} loading={loading} topToken={topToken} ticker={ticker}
            scanning={tokens.length} whaleCount={whaleEvents.length} freshCount={freshCount} totalVol={totalVol}
            whaleEvents={whaleEvents} narratives={narratives} activity={activity}
            onOpen={openToken} onTrade={(mint, m, e) => openSheet(mint, m, e)} />
        ) : tokenByMint(view.mint) ? (
          <TokenPage token={tokenByMint(view.mint)} tokens={tokens}
            onBack={backToExplore} onTrade={(m) => openSheet(view.mint, m)} onOpenRelated={openToken} />
        ) : (
          <div className="mw-empty">Loading token…</div>
        )}
      </main>

      {sheetMint && tokenByMint(sheetMint) && (
        <TradeSheet token={tokenByMint(sheetMint)} solPrice={solPrice} mode={mode} setMode={setMode}
          amount={amount} setAmount={handleAmount} selectedPreset={selectedPreset} handlePreset={handlePreset}
          onClose={() => setSheetMint(null)} wallet={wallet} connection={connection}
          balances={balances} refreshBalances={refreshBalances}
          onSuccess={() => { setSheetMint(null); }} />
      )}
    </div>
  );
}

function ExplorePage({ tokens, loading, topToken, ticker, scanning, whaleCount, freshCount, totalVol, whaleEvents, narratives, activity, onOpen, onTrade }) {
  const spark = (color, points) => (
    <svg className="mw-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
      <path d={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  const whaleCards = whaleEvents.slice(0, 5).map(ev => {
    const t = tokens.find(x => x.mint === ev.mint);
    return { mint: ev.mint, sym: t?.sym || ev.symbol || 'TOKEN', emoji: t?.emoji || emojiFor(ev.symbol || ''), icon: t?.icon, change: t?.change || 0, whaleSol: ev.solAmount };
  });
  const breakingOut = tokens.filter(t => Math.abs(t.change) > 10).slice(0, 6);

  return (
    <section className="mw-page">
      <div className="mw-stats-row">
        <div className="mw-stat-orb">
          <div className="mw-label">scanning</div>
          <div className="mw-val">{scanning}</div>
          <div className="mw-delta">{loading ? 'loading…' : 'live'}</div>
          <div className="mw-ico" style={{ background: 'rgba(255,143,190,0.25)' }}>🎯</div>
          {spark('#FF8FBE', 'M0 18 L12 16 L24 17 L36 12 L48 14 L60 8 L72 10 L84 5 L100 7')}
        </div>
        <div className="mw-stat-orb">
          <div className="mw-label">whales 48h</div>
          <div className="mw-val">{whaleCount}</div>
          <div className="mw-delta">{whaleCount > 0 ? 'active' : 'quiet'}</div>
          <div className="mw-ico" style={{ background: 'rgba(160,231,255,0.4)' }}>🐋</div>
          {spark('#B794F6', 'M0 20 L15 17 L30 19 L45 14 L60 16 L75 11 L90 9 L100 12')}
        </div>
        <div className="mw-stat-orb">
          <div className="mw-label">fresh 24h</div>
          <div className="mw-val">{freshCount}</div>
          <div className="mw-delta">new mints</div>
          <div className="mw-ico" style={{ background: 'rgba(255,212,107,0.35)' }}>🚀</div>
          {spark('#FFB088', 'M0 16 L12 18 L24 14 L36 16 L48 11 L60 13 L72 9 L84 11 L100 6')}
        </div>
        <div className="mw-stat-orb">
          <div className="mw-label">24h volume</div>
          <div className="mw-val">${format(totalVol)}</div>
          <div className="mw-delta">all DEXs</div>
          <div className="mw-ico" style={{ background: 'rgba(127,255,212,0.35)' }}>✦</div>
          {spark('#7FFFD4', 'M0 22 L10 20 L20 21 L30 17 L40 19 L50 13 L60 16 L70 8 L80 11 L90 5 L100 7')}
        </div>
      </div>

      {ticker.length > 0 && (
        <div className="mw-ticker-wrap">
          <div className="mw-ticker-track">
            {[...ticker, ...ticker].map(([sym, change, up], i) => (
              <span className="mw-ticker-item" key={i}>
                <span className="mw-ticker-sym">{sym}</span>
                <span className={up ? 'mw-up' : 'mw-down'}>{change}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {topToken && (
        <div className="mw-featured" onClick={() => onOpen(topToken.mint)}>
          <div className="mw-top-signal-badge">⚡ TOP SIGNAL</div>
          <div className="mw-featured-body">
            <div className="mw-token-avatar">
              <div className="mw-crown">👑</div>
              <div className="mw-face">
                {topToken.icon ? <img src={topToken.icon} alt={topToken.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : topToken.emoji}
              </div>
            </div>
            <div className="mw-featured-meta">
              <div className="mw-sym">${topToken.sym}</div>
              <div className="mw-sub">{topToken.name} · Solana</div>
            </div>
            <div className="mw-signal-score">
              <div className="mw-num">{signalScore(topToken)}</div>
              <div className="mw-denom">/100</div>
              <div className="mw-label">signal</div>
            </div>
          </div>
          <div className="mw-featured-metrics">
            <div className="mw-fm"><div className="mw-fm-ico">🔥</div><div className="mw-fm-text"><div className="mw-fm-val" style={{ color: topToken.change >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPct(topToken.change)}</div><div className="mw-fm-lbl">24h</div></div></div>
            <div className="mw-fm"><div className="mw-fm-ico">⚡</div><div className="mw-fm-text"><div className="mw-fm-val">${format(topToken.volume24h)}</div><div className="mw-fm-lbl">vol</div></div></div>
            <div className="mw-fm"><div className="mw-fm-ico">💰</div><div className="mw-fm-text"><div className="mw-fm-val">${format(topToken.mcap)}</div><div className="mw-fm-lbl">mcap</div></div></div>
            <div className="mw-fm"><div className="mw-fm-ico">👥</div><div className="mw-fm-text"><div className="mw-fm-val">{topToken.holders ? format(topToken.holders) : '—'}</div><div className="mw-fm-lbl">holders</div></div></div>
          </div>
          <div className="mw-featured-actions">
            <button className="mw-btn-gradient" onClick={(e) => onTrade(topToken.mint, 'buy', e)}>⚡ TRADE NOW</button>
            <button className="mw-btn-ghost" onClick={(e) => { e.stopPropagation(); onOpen(topToken.mint); }}>why it's moving →</button>
          </div>
        </div>
      )}

      {whaleCards.length > 0 && (
        <>
          <div className="mw-section-head">
            <div className="mw-left">
              <span className="mw-icon">🐋</span>
              <span className="mw-eyebrow mw-accent">whale radar</span>
              <span className="mw-live-pill" style={{ padding: '3px 8px', fontSize: 9 }}><span className="mw-live-dot" />LIVE</span>
            </div>
            <span className="mw-view-all">view all →</span>
          </div>
          <div className="mw-hscroll">
            {whaleCards.map((w, i) => (
              <div key={w.mint + i} className={'mw-whale-card' + (i === 0 ? ' mw-featured-card' : '')} onClick={() => onOpen(w.mint)}>
                <div className="mw-whale-row">
                  <div className="mw-mini-avatar"><div className="mw-inner">{w.icon ? <img src={w.icon} alt={w.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : w.emoji}</div></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mw-whale-sym">${w.sym}</div>
                    <div className={'mw-whale-pct' + (w.change < 0 ? ' mw-down' : '')}>{formatPct(w.change)}</div>
                  </div>
                </div>
                <div className="mw-whale-foot"><span>🐋 1 whale</span><span className="mw-up">+{Number(w.whaleSol).toLocaleString()} SOL</span></div>
              </div>
            ))}
          </div>
        </>
      )}

      {breakingOut.length > 0 && (
        <>
          <div className="mw-section-head">
            <div className="mw-left">
              <span className="mw-icon">🚀</span>
              <span className="mw-eyebrow mw-accent">breaking out</span>
              <span className="mw-live-pill" style={{ padding: '3px 8px', fontSize: 9 }}><span className="mw-live-dot" />LIVE</span>
            </div>
            <span className="mw-view-all">view all →</span>
          </div>
          <div className="mw-hscroll">
            {breakingOut.map(t => (
              <div key={t.mint} className="mw-signal-card-h" onClick={() => onOpen(t.mint)}>
                <div className="mw-signal-head">
                  <div className="mw-left">
                    <div className="mw-mini-avatar"><div className="mw-inner">{t.icon ? <img src={t.icon} alt={t.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : t.emoji}</div></div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>${t.sym}</div>
                  </div>
                  <div className="mw-score"><div className="mw-score-num">{signalScore(t)}</div><div className="mw-score-lbl">signal</div></div>
                </div>
                <svg className="mw-signal-spark" viewBox="0 0 100 36" preserveAspectRatio="none">
                  <path d={t.change >= 0 ? 'M0 28 L10 26 L20 24 L30 27 L40 20 L50 22 L60 14 L70 17 L80 8 L90 11 L100 4' : 'M0 8 L10 10 L20 12 L30 9 L40 16 L50 14 L60 22 L70 19 L80 28 L90 25 L100 32'} fill="none" stroke={t.change >= 0 ? '#1B7A4F' : '#D14B6A'} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className={'mw-signal-foot ' + (t.change >= 0 ? 'mw-up' : 'mw-down')}>{formatPct(t.change)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {narratives.length > 0 && (
        <>
          <div className="mw-section-head">
            <div className="mw-left"><span className="mw-icon">🔥</span><span className="mw-eyebrow mw-accent">hot narratives</span></div>
            <span className="mw-view-all">{narratives.length} active →</span>
          </div>
          <div className="mw-narratives">
            {narratives.map(n => (
              <div className="mw-narr-chip" key={n.name}>
                <div className="mw-narr-emoji">{n.emoji}</div>
                <div className="mw-narr-name">{n.name}</div>
                <div className={'mw-narr-pct' + (n.pct < 0 ? ' mw-down' : '')}>{formatPct(n.pct)}</div>
                <div className="mw-narr-assets">{n.count} assets</div>
              </div>
            ))}
          </div>
        </>
      )}

      {activity.length > 0 && (
        <>
          <div className="mw-section-head">
            <div className="mw-left"><span className="mw-icon">⚡</span><span className="mw-eyebrow mw-accent">live activity</span></div>
          </div>
          <div className="mw-feed">
            {activity.map((it, i) => (
              <div key={i} className="mw-feed-item" onClick={() => onOpen(it.mint)}>
                <div className="mw-feed-ico" style={{ background: it.type === 'whale' ? 'rgba(160,231,255,0.4)' : 'rgba(255,212,107,0.4)' }}>{it.type === 'whale' ? '🐋' : '🚀'}</div>
                <div className="mw-feed-body">
                  <div className="mw-feed-l1">{it.type === 'whale' ? <><b>whale</b> added liquidity</> : <><b>new launch</b></>}</div>
                  <div className="mw-feed-l2">${it.sym}</div>
                </div>
                <div className="mw-feed-right">
                  {it.type === 'whale' && it.amount && <div className="mw-feed-amt">+{Number(it.amount).toLocaleString()} SOL</div>}
                  <div className="mw-feed-time">{timeAgo(it.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {loading && tokens.length === 0 && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => <div key={i} className="mw-skeleton-card" />)}
        </div>
      )}
    </section>
  );
}

function TokenPage({ token, tokens, onBack, onTrade, onOpenRelated }) {
  const score = signalScore(token);
  const breakdown = {
    'Whale Flow': Math.min(100, Math.round(token.whaleSol ? 88 : (token.liquidity ? Math.log10(token.liquidity)*13 : 40))),
    'Momentum': Math.min(100, Math.round(50 + (token.change || 0)/2)),
    'Community': Math.min(100, Math.round(token.holders ? Math.log10(token.holders)*15 : 40)),
    'Volume': Math.min(100, Math.round(token.volume24h ? Math.log10(token.volume24h)*12 : 40)),
    'Narrative': score,
  };
  const breakdownColors = { 'Whale Flow': 'var(--lav)', 'Momentum': 'var(--pink)', 'Community': 'var(--sky)', 'Volume': 'var(--mint)', 'Narrative': 'var(--peach)' };
  const related = tokens.filter(t => t.mint !== token.mint).slice(0, 5);

  return (
    <section className="mw-page">
      <div className="mw-back-row">
        <div className="mw-back-btn" onClick={onBack}>←</div>
        <div className="mw-top-actions">
          <div className="mw-icon-pill">☆ Watch</div>
          <div className="mw-icon-pill">↗ Share</div>
        </div>
      </div>

      <div className="mw-token-hero">
        <div className="mw-token-avatar" style={{ width: 90, height: 90 }}>
          <div className="mw-crown">👑</div>
          <div className="mw-face" style={{ fontSize: 46 }}>
            {token.icon ? <img src={token.icon} alt={token.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : token.emoji}
          </div>
        </div>
        <div className="mw-meta">
          <div className="mw-sym">${token.sym}</div>
          <div className="mw-chain">{token.name} · Solana</div>
          <div className="mw-tags">
            <div className="mw-tag mw-t1">Token</div>
            <div className="mw-tag mw-t2">Meme</div>
            {token.fresh && <div className="mw-tag mw-t3">Fresh</div>}
          </div>
        </div>
      </div>

      <div className="mw-token-actions">
        <button className="mw-btn-gradient" onClick={() => onTrade('buy')}>⚡ TRADE NOW</button>
        <button className="mw-btn-ghost" onClick={() => onTrade('sell')}>💸 Quick Sell</button>
        <button className="mw-star-btn">☆</button>
      </div>

      <div className="mw-signal-big">
        <div className="mw-left-col">
          <div className="mw-label">signal score</div>
          <div className="mw-num">{score}</div>
          <div className="mw-denom">/100</div>
          {score >= 80 && <div className="mw-top-badge">👑 TOP SIGNAL</div>}
        </div>
        <div className="mw-right-col">
          {Object.entries(breakdown).map(([k, v]) => (
            <div className="mw-radar-row" key={k}>
              <span className="mw-radar-dot" style={{ background: breakdownColors[k] }} />
              <span className="mw-radar-label">{k}</span>
              <span className="mw-radar-val">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mw-stat-mini-row">
        <div className="mw-stat-mini"><div className="mw-lbl">price</div><div className="mw-val">{formatPrice(token.price)}</div><div className={'mw-dlt' + (token.change < 0 ? ' mw-neg' : '')}>{formatPct(token.change)}</div></div>
        <div className="mw-stat-mini"><div className="mw-lbl">mcap</div><div className="mw-val">${format(token.mcap)}</div><div className="mw-dlt">{formatPct(token.change)}</div></div>
        <div className="mw-stat-mini"><div className="mw-lbl">vol 24h</div><div className="mw-val">${format(token.volume24h)}</div><div className="mw-dlt">all DEXs</div></div>
        <div className="mw-stat-mini"><div className="mw-lbl">liquidity</div><div className="mw-val">${format(token.liquidity)}</div><div className="mw-dlt">🔒</div></div>
        <div className="mw-stat-mini"><div className="mw-lbl">holders</div><div className="mw-val">{token.holders ? format(token.holders) : '—'}</div><div className="mw-dlt">on-chain</div></div>
        <div className="mw-stat-mini"><div className="mw-lbl">age</div><div className="mw-val">{token.age || '—'}</div><div className="mw-dlt">since launch</div></div>
      </div>

      <div className="mw-two-col">
        <div className="mw-card-pill">
          <div className="mw-eyebrow mw-accent" style={{ marginBottom: 10 }}>token info</div>
          <div className="mw-info-row"><span className="mw-info-lbl">Contract</span><span className="mw-info-val">{token.mint.slice(0,8)}…{token.mint.slice(-6)}</span></div>
          <div className="mw-info-row"><span className="mw-info-lbl">Decimals</span><span className="mw-info-val">{token.decimals}</span></div>
          <div className="mw-info-row"><span className="mw-info-lbl">Price</span><span className="mw-info-val">{formatPrice(token.price)}</span></div>
          <div className="mw-info-row"><span className="mw-info-lbl">Market Cap</span><span className="mw-info-val">${format(token.mcap)}</span></div>
        </div>
      </div>

      {related.length > 0 && (
        <>
          <div className="mw-section-head">
            <div className="mw-left"><span className="mw-icon">🚀</span><span className="mw-eyebrow mw-accent">related signals</span></div>
          </div>
          <div className="mw-hscroll">
            {related.map(t => (
              <div key={t.mint} className="mw-signal-card-h" onClick={() => onOpenRelated(t.mint)}>
                <div className="mw-signal-head">
                  <div className="mw-left">
                    <div className="mw-mini-avatar"><div className="mw-inner">{t.icon ? <img src={t.icon} alt={t.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : t.emoji}</div></div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>${t.sym}</div>
                  </div>
                  <div className="mw-score"><div className="mw-score-num">{signalScore(t)}</div><div className="mw-score-lbl">signal</div></div>
                </div>
                <div className={'mw-signal-foot ' + (t.change >= 0 ? 'mw-up' : 'mw-down')} style={{ marginTop: 10 }}>{formatPct(t.change)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TradeSheet({ token, solPrice, mode, setMode, amount, setAmount, selectedPreset, handlePreset, onClose, wallet, connection, balances, refreshBalances, onSuccess }) {
  const isSell = mode === 'sell';
  const inputMint = isSell ? token.mint : SOL_MINT;
  const outputMint = isSell ? SOL_MINT : token.mint;
  const inputDecimals = isSell ? (token.decimals ?? 6) : 9;
  const outputDecimals = isSell ? 9 : (token.decimals ?? 6);
  const inputSymbol = isSell ? token.sym : 'SOL';
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
    if (!rawAmount || inputMint === outputMint) { setBuild(null); setQuoteError(null); return; }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;
    setQuoting(true); setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) { setBuild(null); setQuoting(false); return; }
        const params = new URLSearchParams({
          inputMint, outputMint,
          amount: net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker: wallet.publicKey ? wallet.publicKey.toBase58() : '11111111111111111111111111111111',
          computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) { setBuild(data); setQuoteError(null); }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) { setBuild(null); setQuoteError(friendlyError(e)); }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);
    return () => { clearTimeout(t); ac.abort(); };
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => build ? Number(build.outAmount) / Math.pow(10, outputDecimals) : null, [build, outputDecimals]);
  const receiveAmount = quoting ? 'Quoting…' : outAmountUi == null ? '—' : format(outAmountUi) + ' ' + outputSymbol;
  const rate = (outAmountUi && amtNum) ? outAmountUi / amtNum : null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);

  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) { setSwapError('Please connect a wallet.'); return; }
    if (!build) { setSwapError('No quote available — try again.'); return; }
    setSwapping(true); setSwapError(null);
    try {
      const dec = inputDecimals;
      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Amount too small.');
      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        feeIxs.push(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: FEE_WALLET, lamports: Number(feeAmount) }));
      } else {
        const mintPk = new PublicKey(inputMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, tokenProgram);
        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram));
        feeIxs.push(createTransferCheckedInstruction(sourceAta, mintPk, destAta, wallet.publicKey, feeAmount, dec, [], tokenProgram));
      }
      const ixs = [];
      if (Array.isArray(build.computeBudgetInstructions)) for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));
      for (const ix of feeIxs) ixs.push(ix);
      if (Array.isArray(build.setupInstructions)) for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
      if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
      if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
      if (Array.isArray(build.otherInstructions)) for (const ix of build.otherInstructions) ixs.push(deserIx(ix));
      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({ key: new PublicKey(k), state: AddressLookupTableAccount.deserialize(infos[i].data) }) : null).filter(Boolean);
      }
      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message(alts);
      const tx = new VersionedTransaction(message);
      try {
        const sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
        if (sim.value.err) throw new Error('Swap simulation failed — the price may have moved.');
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) throw simErr;
        console.warn('[swap] sim non-fatal', simErr);
      }
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      let confirmed = false;
      try {
        const conf = await Promise.race([
          connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain.');
        confirmed = true;
      } catch {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) { if (/failed on-chain/i.test(String(e.message))) throw e; }
        }
      }
      onSuccess({ signature: sig, pending: !confirmed });
      if (confirmed) setTimeout(() => refreshBalances(), 2000);
    } catch (e) {
      console.error('[mw swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [wallet, build, inputMint, inputDecimals, outputDecimals, rawAmount, connection, onSuccess, refreshBalances]);

  const hasFunds = inputBalance && amtNum > 0 && inputBalance.uiAmount >= amtNum;
  const canSwap = !!wallet.publicKey && !!build && !quoting && !swapping && amtNum > 0 && inputMint !== outputMint && hasFunds;

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
    setAmount(String(maxAmt));
  };

  const ctaLabel = swapping ? (isSell ? 'Selling…' : 'Buying…')
    : !wallet.publicKey ? 'Connect Wallet'
    : amtNum <= 0 ? 'Enter amount'
    : quoting && !build ? 'Getting quote…'
    : !build ? 'No route available'
    : !hasFunds ? `Insufficient ${inputSymbol}`
    : (isSell ? '💸 SELL ' + token.sym : '⚡ BUY ' + token.sym);

  return (
    <>
      <div className="mw-sheet-backdrop" onClick={swapping ? undefined : onClose} />
      <div className="mw-sheet">
        <div className="mw-grabber" />
        <div className="mw-sheet-head">
          <div className="mw-sheet-emoji">
            <div className="mw-sheet-emoji-inner">
              {token.icon ? <img src={token.icon} alt={token.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : token.emoji}
            </div>
          </div>
          <div className="mw-sheet-info">
            <div className="mw-sheet-name">${token.sym}</div>
            {token.age && <span className="mw-age-pill">{token.age} old</span>}
          </div>
          <div className="mw-back-btn" onClick={swapping ? undefined : onClose}>×</div>
        </div>

        <div className={'mw-tab-switch' + (isSell ? ' mw-sell-mode' : '')}>
          <div className="mw-tab-indicator" />
          {['buy', 'sell'].map(m => (
            <div key={m} className={'mw-tab' + (mode === m ? ' mw-active' : '')} onClick={() => !swapping && setMode(m)}>
              {m.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="mw-amount-section">
          <div className="mw-amount-label">
            <span>You Pay</span>
            <span className="mw-balance-pill">
              {inputBalance ? <>Bal: <b>{format(inputBalance.uiAmount)}</b> · ~${usdValue}</> : `~$${usdValue}`}
            </span>
          </div>
          <div className="mw-amount-input-wrap">
            <input className="mw-amount-input" type="text" inputMode="decimal" value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v);
              }}
              disabled={swapping} />
            <div className="mw-currency">
              <div className="mw-currency-icon" />
              {inputSymbol}
            </div>
          </div>
          <div className="mw-presets">
            {['0.1', '0.5', '1', 'MAX'].map(p => (
              <button key={p} className={'mw-preset' + (selectedPreset === p ? ' mw-selected' : '')}
                onClick={() => p === 'MAX' ? setMax() : handlePreset(p)} disabled={swapping}>{p}</button>
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
          <div style={{ margin: '12px 22px 0', padding: '10px 14px', borderRadius: 12, background: 'rgba(209,75,106,0.1)', border: '1px solid rgba(209,75,106,0.3)', color: 'var(--red)', fontSize: 12, textAlign: 'center', fontWeight: 500 }}>
            {swapError || quoteError}
          </div>
        )}

        <div className="mw-cta-wrap">
          <button className={'mw-cta' + (isSell ? ' mw-sell-cta' : '')} onClick={handleSwap} disabled={!canSwap}>
            {ctaLabel}
          </button>
          <div className="mw-trust">Powered by <b>Jupiter</b> · Non-custodial 🔐</div>
        </div>
      </div>
    </>
  );
}
