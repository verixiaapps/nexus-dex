/**
 * NEXUS DEX — CrossChainSwap.jsx
 * (LI.FI atomic single-tx, fee in SOL)
 *
 * VISUAL REDESIGN — same DNA as Stocks/GetStarted (Wonderland), regional
 * blue/violet accent for the bridge flow. All trading/RPC/LI.FI logic
 * preserved verbatim. Class prefix stays cc-.
 *
 *   • Light cream surface with cool-tuned blobs (more sky/lav, less pink).
 *   • Step bar (01 → 04) is the signature element — Instrument Serif
 *     italic numerals on glass tiles, blue→violet glow on active,
 *     mint→sky on done. Always visible.
 *   • Instrument Serif for headline + numbers + token symbols.
 *     JetBrains Mono for tabular data, labels, captions.
 *   • CTA: blue→violet gradient (primary), mint→sky (success), pink (error).
 *   • Route info merged into the RECEIVE box as a single tight line.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';

// =====================================================================
// INLINE CSS — Wonderland-lite · Instrument Serif + Space Grotesk + JetBrains Mono
// =====================================================================
const CC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

.cc-page,.cc-modal-backdrop,.cc-modal{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --blue:#4f7dff; --violet:#a87fff;
  --mint:#7FFFD4; --sky:#A0E7FF; --lav:#B794F6;
  --pink:#FF8FBE; --peach:#FFB088; --gold:#FFD46B;
  --green:#1B7A4F; --red:#D14B6A;
  --glass:rgba(255,255,255,0.6); --glass-strong:rgba(255,255,255,0.78);
  --border:rgba(79,125,255,0.18);
  --border-hi:rgba(79,125,255,0.32);
  --hairline:rgba(26,27,78,0.08);
  font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;
  color:var(--ink);
}
.cc-page,.cc-page *,.cc-modal,.cc-modal *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}

@keyframes cc-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes cc-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes cc-spin{to{transform:rotate(360deg)}}
@keyframes cc-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes cc-glow{0%,100%{box-shadow:0 4px 18px rgba(79,125,255,.35),0 0 0 0 rgba(79,125,255,.25)}50%{box-shadow:0 4px 18px rgba(79,125,255,.45),0 0 0 8px rgba(79,125,255,0)}}
@keyframes cc-modal-in{from{opacity:0;transform:translate(-50%,-48%)}to{opacity:1;transform:translate(-50%,-50%)}}

/* PAGE */
.cc-page{
  position:relative;min-height:100vh;min-height:100dvh;
  max-width:520px;margin:0 auto;width:100%;
  padding:0 0 calc(env(safe-area-inset-bottom) + 80px);
  border-radius:24px;overflow-x:hidden;
  background:
    radial-gradient(ellipse at 80% 0%,#D9ECFF 0%,transparent 50%),
    radial-gradient(ellipse at 15% 10%,#F0E7FF 0%,transparent 45%),
    radial-gradient(ellipse at 50% 70%,#E4F2FF 0%,transparent 55%),
    radial-gradient(ellipse at 90% 95%,#FFE8F4 0%,transparent 35%),
    linear-gradient(180deg,#F5F8FF 0%,#EEF3FF 100%);
  background-attachment:fixed;
}
.cc-blob{
  position:absolute;border-radius:50%;filter:blur(70px);opacity:0.42;
  animation:cc-drift 14s ease-in-out infinite;pointer-events:none;z-index:0;
}
.cc-inner{position:relative;z-index:5}

/* HEADER */
.cc-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px 4px;
}
.cc-brand{display:flex;align-items:center;gap:10px}
.cc-brand-dot{
  width:28px;height:28px;border-radius:50%;
  background:linear-gradient(135deg,#4f7dff,#a87fff 60%,#7FFFD4);
  box-shadow:0 0 14px rgba(79,125,255,0.5);
}
.cc-wordmark{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.cc-wordmark .slash{opacity:0.4;margin:0 3px;font-style:normal}
.cc-wordmark .grad{
  background:linear-gradient(90deg,#4f7dff,#a87fff,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.cc-head-live{
  display:flex;align-items:center;gap:6px;
  padding:5px 11px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--blue);
  letter-spacing:1.2px;
}
.cc-head-live .d{width:5px;height:5px;border-radius:50%;background:var(--blue);box-shadow:0 0 8px var(--blue);animation:cc-pulse 1.6s ease-in-out infinite}

/* MINI HERO */
.cc-mini-hero{padding:18px 22px 8px}
.cc-mh-eyebrow{
  display:inline-flex;align-items:center;gap:7px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--blue);letter-spacing:1.6px;margin-bottom:8px;
}
.cc-mh-title{
  font-family:"Instrument Serif",serif;font-weight:400;
  font-size:34px;line-height:1;letter-spacing:-.02em;margin:0 0 6px;
  color:var(--ink);
}
.cc-mh-title em{
  font-style:italic;
  background:linear-gradient(120deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.cc-mh-sub{font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}

/* CARD */
.cc-card{
  margin:14px 22px 0;padding:18px;border-radius:24px;
  background:var(--glass);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.85);
  box-shadow:0 12px 40px rgba(79,125,255,.10);
}

/* STEP BAR — SIGNATURE */
.cc-steps{
  display:flex;align-items:flex-start;gap:0;
  margin:0 -2px 16px;
}
.cc-step{display:flex;flex-direction:column;align-items:center;flex:0 0 auto;width:48px}
.cc-step-num{
  width:44px;height:44px;border-radius:16px;
  background:var(--glass-strong);border:1.5px solid var(--hairline);
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1;
  color:var(--ink-3);transition:all .3s;
}
.cc-step.cc-step-active .cc-step-num{
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  border-color:#4f7dff;color:#fff;
  animation:cc-glow 2s ease-in-out infinite;
}
.cc-step.cc-step-done .cc-step-num{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);
  border-color:#7FFFD4;color:var(--ink);
}
.cc-step-label{
  margin-top:7px;
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:0.8px;text-transform:uppercase;
  transition:color .3s;
}
.cc-step.cc-step-active .cc-step-label{color:var(--blue)}
.cc-step.cc-step-done .cc-step-label{color:var(--green)}
.cc-step-line{
  flex:1;height:2px;margin-top:21px;
  background:var(--hairline);border-radius:2px;transition:background .3s;
}
.cc-step-line.cc-step-line-done{background:linear-gradient(90deg,#7FFFD4,#A0E7FF)}

/* I/O BOX */
.cc-io-box{
  background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);
  border-radius:18px;padding:14px 16px;
  transition:border-color .15s,box-shadow .15s;
}
.cc-io-box:focus-within{border-color:var(--border-hi);box-shadow:0 0 0 4px rgba(79,125,255,.08)}
.cc-io-head{
  display:flex;justify-content:space-between;align-items:center;gap:8px;
  margin-bottom:10px;flex-wrap:wrap;
}
.cc-io-label{
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;
}
.cc-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cc-io-bal{
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:500;
}
.cc-io-bal-val{color:var(--ink);font-weight:700}

.cc-io-row{display:flex;align-items:center;gap:10px}
.cc-token-btn{
  display:flex;align-items:center;gap:8px;padding:8px 12px;
  background:#fff;border:1px solid var(--border);border-radius:999px;
  color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;
  cursor:pointer;flex-shrink:0;transition:all .15s;
  box-shadow:0 2px 8px rgba(26,27,78,.06);
}
.cc-token-btn:hover:not(:disabled){border-color:var(--blue);box-shadow:0 2px 12px rgba(79,125,255,.18)}
.cc-token-btn:active:not(:disabled){transform:translateY(1px)}
.cc-token-btn:disabled{cursor:not-allowed;opacity:.6}
.cc-token-sym{font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;letter-spacing:-.01em;color:var(--ink)}
.cc-token-caret{font-size:10px;color:var(--ink-3);margin-left:-2px}

.cc-io-input{
  flex:1;background:transparent;border:none;outline:none;
  font-family:"Instrument Serif",serif;font-size:34px;line-height:1;
  color:var(--ink);text-align:right;font-variant-numeric:tabular-nums;
  min-width:0;width:100%;
}
.cc-io-input:disabled{opacity:.5}
.cc-io-input::placeholder{color:var(--ink-3)}

.cc-io-output{
  flex:1;text-align:right;
  font-family:"Instrument Serif",serif;font-size:34px;line-height:1;
  color:var(--ink);font-variant-numeric:tabular-nums;
  min-width:0;overflow:hidden;text-overflow:ellipsis;
}
.cc-io-output-loading{color:var(--ink-3);font-size:24px}
.cc-io-output-empty{color:var(--ink-3)}

.cc-max-btn{
  background:rgba(79,125,255,.10);border:1px solid var(--border);color:var(--blue);
  padding:6px 10px;border-radius:10px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;cursor:pointer;
  letter-spacing:0.8px;flex-shrink:0;transition:all .15s;
}
.cc-max-btn:hover{background:rgba(79,125,255,.18)}

.cc-io-usd{
  text-align:right;margin-top:6px;
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500;
}

/* ROUTE META (inside RECEIVE box) */
.cc-route-meta{
  margin-top:10px;padding-top:10px;border-top:1px dashed var(--hairline);
  display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:600;
  letter-spacing:0.6px;
}
.cc-route-meta b{color:var(--ink);font-weight:700}
.cc-route-via{display:flex;align-items:center;gap:6px}
.cc-route-tag{
  padding:2px 7px;border-radius:5px;
  background:rgba(79,125,255,.10);border:1px solid var(--border);
  color:var(--blue);font-weight:700;letter-spacing:0.4px;text-transform:uppercase;
}

/* FLIP — soft glass tile with italic violet arrow */
.cc-flip-wrap{display:flex;justify-content:center;margin:-12px 0;position:relative;z-index:3}
.cc-flip-arrow{
  width:42px;height:42px;border-radius:14px;
  background:linear-gradient(135deg,#fff,#F5F8FF);
  border:3px solid #EEF3FF;
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1;
  box-shadow:0 6px 18px rgba(168,127,255,.18);
  transition:transform .3s;
}

/* CHAIN BADGE */
.cc-chain-badge{
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 9px;border-radius:7px;
  font-family:"Space Grotesk",sans-serif;font-size:10px;font-weight:700;
  letter-spacing:0.4px;text-transform:uppercase;
}
.cc-chain-badge-sm{padding:2px 7px;font-size:9px}
.cc-chain-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.cc-chain-badge-sm .cc-chain-dot{width:5px;height:5px}

/* DESTINATION */
.cc-dest{margin-top:12px}
.cc-dest-label{
  display:flex;align-items:center;gap:6px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px;
}
.cc-dest-chain{font-weight:700}
.cc-dest-input-wrap{position:relative}
.cc-dest-input{
  width:100%;padding:13px 42px 13px 14px;
  background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);
  border-radius:12px;color:var(--ink);
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;
  outline:none;transition:border-color .15s,box-shadow .15s;
}
.cc-dest-input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.cc-dest-input:disabled{opacity:.55}
.cc-dest-input::placeholder{color:var(--ink-3);font-weight:500}
.cc-dest-err{border-color:rgba(209,75,106,.5)}
.cc-dest-ok{border-color:rgba(127,255,212,.6)}
.cc-dest-check{
  position:absolute;right:12px;top:50%;transform:translateY(-50%);
  width:22px;height:22px;border-radius:50%;
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  display:grid;place-items:center;font-size:13px;font-weight:800;
}
.cc-dest-err-msg{
  margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:11px;
  color:var(--red);font-weight:600;
}

/* MESSAGES */
.cc-status{
  margin-top:14px;padding:12px 14px;border-radius:14px;
  background:rgba(79,125,255,.08);border:1px solid var(--border);
  display:flex;align-items:center;gap:10px;
  font-size:12px;font-weight:600;color:var(--blue);font-family:"Space Grotesk",sans-serif;
}
.cc-spinner{
  width:14px;height:14px;border-radius:50%;flex-shrink:0;
  border:2px solid rgba(79,125,255,.20);border-top-color:var(--blue);
  animation:cc-spin .8s linear infinite;
}
.cc-warn{
  margin-top:14px;padding:12px 14px;border-radius:14px;
  background:rgba(255,176,136,.14);border:1px solid rgba(255,176,136,.45);
  font-size:12px;font-weight:600;color:#8a4a1d;font-family:"Space Grotesk",sans-serif;
}
.cc-error{
  margin-top:14px;padding:12px 14px;border-radius:14px;
  background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.35);
  font-size:12px;font-weight:600;color:var(--red);font-family:"Space Grotesk",sans-serif;
}

/* SUCCESS */
.cc-success{
  margin-top:14px;padding:16px;border-radius:18px;text-align:center;
  background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));
  border:1px solid rgba(127,255,212,.45);
  animation:cc-rise .4s;
}
.cc-success-pending{
  background:linear-gradient(135deg,rgba(255,205,107,.18),rgba(255,176,136,.18));
  border-color:rgba(255,205,107,.45);
}
.cc-success-icon{font-size:24px;margin-bottom:4px;line-height:1}
.cc-success-title{
  font-family:"Instrument Serif",serif;font-size:18px;color:var(--ink);letter-spacing:-.01em;line-height:1.1;
}
.cc-success-pending .cc-success-title{color:#7a5400}
.cc-success-sub{
  margin-top:4px;font-size:12px;color:var(--ink-2);font-weight:500;
}

/* CTA */
.cc-cta{
  width:100%;margin-top:14px;padding:18px;border-radius:18px;border:none;
  font-family:"Instrument Serif",serif;font-size:19px;letter-spacing:-.01em;
  color:#fff;cursor:pointer;
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  box-shadow:0 10px 28px rgba(79,125,255,.32),inset 0 1px 0 rgba(255,255,255,.25);
  transition:transform .15s,box-shadow .15s,opacity .15s;
  position:relative;overflow:hidden;min-height:56px;
}
.cc-cta em{font-style:italic;opacity:.9;margin:0 4px}
.cc-cta:hover:not(.cc-cta-disabled){transform:translateY(-1px)}
.cc-cta:active:not(.cc-cta-disabled){transform:translateY(1px)}
.cc-cta-spinner{display:inline-block;margin-right:8px;animation:cc-spin .8s linear infinite}
.cc-cta-success{
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  box-shadow:0 10px 28px rgba(127,255,212,.32),inset 0 1px 0 rgba(255,255,255,.25);
}
.cc-cta-error{
  background:rgba(209,75,106,.14);color:var(--red);
  border:1.5px solid rgba(209,75,106,.40);box-shadow:none;
}
.cc-cta-disabled{
  background:rgba(26,27,78,.06);color:var(--ink-3);
  border:1.5px solid var(--hairline);box-shadow:none;
  cursor:not-allowed;
}
.cc-cta-reset{
  background:rgba(79,125,255,.10);color:var(--blue);
  border:1.5px solid var(--border);box-shadow:none;
}
.cc-cta-reset:hover{background:rgba(79,125,255,.18)}

.cc-solscan-link{
  display:block;text-align:center;margin-top:10px;
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--blue);
  font-weight:700;text-decoration:none;letter-spacing:0.6px;
}
.cc-solscan-link:hover{text-decoration:underline}
.cc-footer-note{
  margin-top:14px;text-align:center;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:500;color:var(--ink-3);
  letter-spacing:0.6px;
}

/* TOKEN ICON */
.cc-token-img{border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(79,125,255,.06)}
.cc-token-fallback{
  border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,rgba(79,125,255,.18),rgba(168,127,255,.18));
  border:1px solid var(--border);
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;color:var(--blue);
}

/* MODALS — light Wonderland */
.cc-modal-backdrop{
  position:fixed;inset:0;z-index:499;
  background:rgba(26,27,78,0.35);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
}
.cc-modal{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:500;
  width:94vw;max-width:440px;max-height:85dvh;
  display:flex;flex-direction:column;
  background:
    radial-gradient(ellipse at 20% 0%,#E4F2FF 0%,transparent 50%),
    radial-gradient(ellipse at 80% 0%,#F0E7FF 0%,transparent 50%),
    linear-gradient(180deg,#F5F8FF 0%,#EEF3FF 100%);
  border:1px solid rgba(255,255,255,.85);border-radius:24px;
  box-shadow:0 24px 80px rgba(26,27,78,.25);
  animation:cc-modal-in .25s cubic-bezier(.2,1.2,.4,1);
  overflow:hidden;
}
.cc-modal-to{max-width:460px;max-height:88dvh}
.cc-modal-head{padding:18px 18px 12px;border-bottom:1px solid var(--hairline)}
.cc-modal-head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cc-modal-title{
  font-family:"Instrument Serif",serif;font-size:22px;letter-spacing:-.015em;color:var(--ink);line-height:1;
}
.cc-modal-title em{
  font-style:italic;
  background:linear-gradient(120deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.cc-modal-sub{font-size:11px;color:var(--ink-2);font-weight:500;margin-left:6px}
.cc-modal-close{
  width:34px;height:34px;border-radius:50%;
  background:var(--glass-strong);border:1px solid var(--border);
  color:var(--ink);font-size:18px;cursor:pointer;font-family:inherit;
  display:grid;place-items:center;transition:all .15s;
}
.cc-modal-close:hover{background:#fff;border-color:var(--blue)}

.cc-modal-search{
  width:100%;padding:11px 13px;
  background:var(--glass-strong);border:1.5px solid var(--border);
  border-radius:12px;color:var(--ink);
  font-family:inherit;font-size:13px;font-weight:500;
  outline:none;transition:border-color .15s,box-shadow .15s;
}
.cc-modal-search:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.cc-modal-search::placeholder{color:var(--ink-3)}

.cc-chain-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}
.cc-chain-chips::-webkit-scrollbar{display:none}
.cc-chain-chip{
  flex-shrink:0;padding:6px 12px;border-radius:999px;
  background:var(--glass);border:1px solid var(--border);
  color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.4px;
  cursor:pointer;white-space:nowrap;transition:all .15s;
}
.cc-chain-chip:hover{border-color:var(--blue);color:var(--ink)}

.cc-modal-body{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding-bottom:env(safe-area-inset-bottom)}
.cc-modal-loading,.cc-modal-empty{padding:28px;text-align:center;color:var(--ink-2);font-size:12.5px;font-weight:500}
.cc-modal-section{
  padding:12px 18px 6px;
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:700;
  letter-spacing:1.4px;text-transform:uppercase;
}
.cc-modal-row{
  padding:12px 18px;cursor:pointer;
  display:flex;align-items:center;gap:12px;
  border-bottom:1px solid var(--hairline);
  transition:background .15s;
}
.cc-modal-row:last-child{border-bottom:none}
.cc-modal-row:hover{background:rgba(255,255,255,.5)}
.cc-modal-row-info{flex:1;min-width:0}
.cc-modal-row-sym{
  font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;
  color:var(--ink);letter-spacing:-.01em;line-height:1;
}
.cc-modal-row-name{
  font-size:11.5px;color:var(--ink-2);font-weight:500;margin-top:3px;
}
.cc-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

function useCcCSS() {
  useEffect(() => {
    const id = 'nexus-cc-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = CC_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ─── CONSTANTS — UNCHANGED ─── */

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;
const SLIPPAGE   = 0.05;

const SOL_NATIVE       = '11111111111111111111111111111111';
const WSOL_MINT        = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LIFI_SOLANA_ID   = 1151111081099710;
const SOL_RESERVE      = 1_500_000;
const MIN_FEE_LAMPORTS = 1_000_000;
const QUOTE_DEBOUNCE   = 400;

/* ─── FORMATTERS — UNCHANGED ─── */

const trimZeros = v => String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
const decsForDisplay = n => {
  const v = +n;
  if (!Number.isFinite(v)) return 4;
  if (v === 0)   return 2;
  if (v < 1e-8)  return 12;
  if (v < 1e-6)  return 10;
  if (v < 0.01)  return 8;
  if (v < 1)     return 6;
  return 4;
};
const fmtTok = n => {
  if (n == null || isNaN(n)) return '0';
  const v = +n;
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9)   return trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)   return trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000)  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return trimZeros(v.toFixed(decsForDisplay(v)));
};
const fmtInput = (n, dec = 9) => {
  const v = +n;
  if (!Number.isFinite(v) || v <= 0) return '';
  const m = Math.min(Math.max(+dec || 6, 0), 12);
  return trimZeros(v.toFixed(m));
};
const fmtUsd = (n, d = 2) => {
  if (n == null || isNaN(n)) return '-';
  const v = +n;
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9)  return '$' + trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)  return '$' + trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (v >= 1)    return '$' + v.toFixed(d);
  if (v > 0)     return '$' + trimZeros(v.toFixed(v < 1e-6 ? 10 : 8));
  return '$0.00';
};
const toRaw = (s, dec) => {
  if (!s || dec == null) return '0';
  let v = String(s).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!v || v.startsWith('-')) return '0';
  if (/e/i.test(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return '0';
    v = n.toFixed(Math.max(+dec || 0, 20));
  }
  const d = Math.floor(+dec);
  if (!Number.isFinite(d) || d < 0 || d > 18) return '0';
  const [w, f = ''] = v.split('.');
  const sw = (w || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const ft = (f || '').replace(/[^\d]/g, '').slice(0, d);
  const fp = (ft + '0'.repeat(d)).slice(0, d);
  try { return (BigInt(sw) * (10n ** BigInt(d)) + BigInt(fp)).toString(); }
  catch { return '0'; }
};

const isValidSolMint = s =>
  !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

const validateDest = (addr, chainType) => {
  if (!addr || !addr.trim()) return 'Destination address required';
  const a = addr.trim();
  if (chainType === 'EVM') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'Invalid EVM address';
  } else if (chainType === 'SVM') {
    if (!isValidSolMint(a)) return 'Invalid Solana address';
  } else if (chainType === 'UTXO') {
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,80}$/.test(a)) return 'Invalid Bitcoin address';
  } else if (chainType === 'MVM') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(a)) return 'Invalid SUI address';
  }
  return null;
};

const lifiFromToken = mint => (mint === WSOL_MINT ? SOL_NATIVE : mint);

/* ─── ERRORS — UNCHANGED ─── */
const friendlyError = err => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient sol') || m.includes('not enough sol'))
    return 'Not enough SOL in your wallet.';
  if (m.includes('insufficient') || m.includes('not enough'))
    return 'Insufficient balance for this bridge.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('slippage'))
    return 'Price moved too much. Try again.';
  if (m.includes('no route') || m.includes('no available') || m.includes('not found'))
    return 'No bridge route available for this pair right now.';
  if (m.includes('minimum') || m.includes('too small'))
    return 'Amount is too small for this route.';
  if (m.includes('429') || m.includes('rate limit'))
    return 'Too many requests — please wait a moment.';
  if (m.includes('timeout') || m.includes('timed out'))
    return 'Network is slow — please try again.';
  if (m.includes('account not') || m.includes('uninitialized'))
    return 'Token account not ready. Try again in a moment.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex for a single transaction. Try a different token or amount.';
  return err?.message || 'Bridge failed. Please try again.';
};

/* ─── CHAINS — UNCHANGED ─── */
let _chainsCache = null, _chainsLoading = null;
const loadChains = () => {
  if (_chainsCache)   return Promise.resolve(_chainsCache);
  if (_chainsLoading) return _chainsLoading;
  _chainsLoading = fetch('/api/lifi/chains')
    .then(r => (r.ok ? r.json() : { chains: [] }))
    .then(j => {
      const list = Array.isArray(j?.chains) ? j.chains : (Array.isArray(j) ? j : []);
      const out = {};
      for (const c of list) {
        out[String(c.id)] = {
          id:       String(c.id),
          key:      c.key || c.coin || String(c.id),
          name:     c.name || ('Chain ' + c.id),
          chainType: c.chainType || 'EVM',
          logoURI:  c.logoURI || c.iconUrl || null,
        };
      }
      _chainsCache = out;
      _chainsLoading = null;
      return out;
    })
    .catch(e => {
      _chainsLoading = null;
      _chainsCache = {
        '1':     { id:'1',     name:'Ethereum',  chainType:'EVM' },
        '56':    { id:'56',    name:'BNB Chain', chainType:'EVM' },
        '137':   { id:'137',   name:'Polygon',   chainType:'EVM' },
        '42161': { id:'42161', name:'Arbitrum',  chainType:'EVM' },
        '10':    { id:'10',    name:'Optimism',  chainType:'EVM' },
        '43114': { id:'43114', name:'Avalanche', chainType:'EVM' },
        '8453':  { id:'8453',  name:'Base',      chainType:'EVM' },
        '59144': { id:'59144', name:'Linea',     chainType:'EVM' },
        '324':   { id:'324',   name:'zkSync',    chainType:'EVM' },
        '100':   { id:'100',   name:'Gnosis',    chainType:'EVM' },
        [String(LIFI_SOLANA_ID)]: { id: String(LIFI_SOLANA_ID), name:'Solana', chainType:'SVM' },
      };
      throw e;
    });
  return _chainsLoading;
};

const FALLBACK_CHAIN_COLORS = {
  '1':     '#627eea',
  '56':    '#f0b90b',
  '137':   '#8247e5',
  '42161': '#28a0f0',
  '10':    '#ff0420',
  '43114': '#e84142',
  '8453':  '#0052ff',
  '59144': '#61dfff',
  '324':   '#8c8dfc',
  '100':   '#04795b',
  [String(LIFI_SOLANA_ID)]: '#14f195',
};
const chainColorOf = (chain) =>
  (chain && FALLBACK_CHAIN_COLORS[chain.id]) || '#4f7dff';

/* ─── TOKENS — UNCHANGED ─── */
let _tokensCache = null, _tokensLoading = null;
const loadAllTokens = () => {
  if (_tokensCache)   return Promise.resolve(_tokensCache);
  if (_tokensLoading) return _tokensLoading;
  _tokensLoading = fetch('/api/lifi/tokens')
    .then(r => (r.ok ? r.json() : { tokens: {} }))
    .then(j => {
      const byChain = {};
      for (const [cid, tokens] of Object.entries(j?.tokens || {})) {
        byChain[String(cid)] = (tokens || []).filter(t => t.address && t.symbol).map(t => ({
          chainId:  String(cid),
          address:  t.address,
          symbol:   t.symbol,
          name:     t.name || t.symbol,
          decimals: +t.decimals || 0,
          logoURI:  t.logoURI || null,
          priceUSD: t.priceUSD || null,
        }));
      }
      _tokensCache = byChain;
      _tokensLoading = null;
      return byChain;
    })
    .catch(e => { _tokensLoading = null; throw e; });
  return _tokensLoading;
};

const getSolPriceUSD = () => {
  const solTokens = _tokensCache?.[String(LIFI_SOLANA_ID)] || [];
  const sol = solTokens.find(t =>
    t.address === SOL_NATIVE || t.address === WSOL_MINT ||
    t.symbol?.toUpperCase() === 'SOL'
  );
  const p = sol?.priceUSD ? Number(sol.priceUSD) : null;
  return Number.isFinite(p) && p > 0 ? p : null;
};

/* ─── LI.FI QUOTE — UNCHANGED ─── */
const lifiQuote = async ({ fromChainId, fromMint, toChainId, toAddress, amount, sender, receiver, signal }) => {
  if (!sender) throw new Error('Connect wallet first');
  const p = new URLSearchParams({
    fromChain:   String(fromChainId),
    toChain:     String(toChainId),
    fromToken:   lifiFromToken(fromMint),
    toToken:     toAddress,
    fromAmount:  String(amount),
    fromAddress: sender,
    toAddress:   receiver || sender,
    slippage:    String(SLIPPAGE),
    order:       'FASTEST',
    skipSimulation: 'true',
  });
  const r = await fetch('/api/lifi/quote?' + p.toString(), { signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = j?.message || j?.errors?.[0]?.message || j?.error || `HTTP ${r.status}`;
    throw new Error(detail);
  }
  return j;
};

/* ─── FEE CALCULATION — UNCHANGED ─── */
const computeSolFeeLamports = (fromAmountUSD, solPriceUSD) => {
  if (!fromAmountUSD || !solPriceUSD || fromAmountUSD <= 0 || solPriceUSD <= 0) {
    return MIN_FEE_LAMPORTS;
  }
  const feeUSD = fromAmountUSD * (FEE_BPS / 10000);
  const feeSOL = feeUSD / solPriceUSD;
  const lamports = Math.floor(feeSOL * LAMPORTS_PER_SOL);
  return Math.max(lamports, MIN_FEE_LAMPORTS);
};

/* ─── ATOMIC TX BUILDER — UNCHANGED ─── */
const buildAtomicTx = async ({
  connection, payer, bridgeTxBase64, feeLamports, blockhash,
}) => {
  const bridgeTx = VersionedTransaction.deserialize(Buffer.from(bridgeTxBase64, 'base64'));
  const altLookups = bridgeTx.message.addressTableLookups || [];
  let alts = [];
  if (altLookups.length > 0) {
    const altKeys = altLookups.map(l => l.accountKey);
    const infos = await connection.getMultipleAccountsInfo(altKeys);
    alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
      key:   k,
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }) : null).filter(Boolean);
    if (alts.length !== altKeys.length) {
      throw new Error('Could not resolve all address lookup tables for bridge tx');
    }
  }
  const decompiled = TransactionMessage.decompile(bridgeTx.message, {
    addressLookupTableAccounts: alts,
  });
  const feeIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey:   FEE_WALLET,
    lamports:   feeLamports,
  });
  decompiled.instructions = [feeIx, ...decompiled.instructions];
  decompiled.recentBlockhash = blockhash;
  decompiled.payerKey = payer;
  const newMessage = decompiled.compileToV0Message(alts);
  return new VersionedTransaction(newMessage);
};

/* ─── DEFAULTS ─── */
const DEFAULT_FROM = {
  chainId:  String(LIFI_SOLANA_ID),
  mint:     WSOL_MINT,
  address:  WSOL_MINT,
  symbol:   'SOL',
  name:     'Solana',
  decimals: 9,
  logoURI:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const DEFAULT_TO = {
  chainId:  '1',
  address:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol:   'USDC',
  name:     'USD Coin',
  decimals: 6,
  logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

/* ─── HOOKS ─── */
let _bl = 0;
const useBodyScrollLock = open => {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bl === 0) document.body.classList.add('nexus-scroll-locked');
    _bl++;
    return () => {
      _bl = Math.max(0, _bl - 1);
      if (_bl === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
};
const useEscape = (open, h) => {
  useEffect(() => {
    if (!open) return;
    const fn = e => { if (e.key === 'Escape') { e.stopPropagation(); h?.(); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, h]);
};

/* ─── UI BITS ─── */
const TokenIcon = ({ token, size = 32 }) => {
  const [err, setErr] = useState(false);
  if (token?.logoURI && !err) {
    return (
      <img
        src={token.logoURI}
        alt=""
        className="cc-token-img"
        style={{ width: size, height: size }}
        onError={() => setErr(true)}
      />
    );
  }
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return (
    <div
      className="cc-token-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >{ch}</div>
  );
};

const ChainBadge = ({ chain, small = false }) => {
  if (!chain) return null;
  const color = chainColorOf(chain);
  return (
    <div
      className={'cc-chain-badge' + (small ? ' cc-chain-badge-sm' : '')}
      style={{ background: color + '1f', color }}
    >
      <div className="cc-chain-dot" style={{ background: color }}/>
      {chain.name}
    </div>
  );
};

// Step bar — signature element. Always rendered; idle = all subdued.
const StepProgress = ({ step }) => {
  const steps = [
    { label: 'Quote',  id: 1 },
    { label: 'Sign',   id: 2 },
    { label: 'Bridge', id: 3 },
    { label: 'Done',   id: 4 },
  ];
  return (
    <div className="cc-steps">
      {steps.map((s, i) => {
        const done   = step > s.id;
        const active = step === s.id;
        const cls = 'cc-step' + (done ? ' cc-step-done' : active ? ' cc-step-active' : '');
        const numLabel = s.id < 10 ? '0' + s.id : String(s.id);
        return (
          <React.Fragment key={s.id}>
            <div className={cls}>
              <div className="cc-step-num">{done ? '✓' : numLabel}</div>
              <div className="cc-step-label">{s.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={'cc-step-line' + (done ? ' cc-step-line-done' : '')}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* ─── FROM (Solana) MODAL ─── */
const FromTokenModal = ({ open, onClose, onSelect }) => {
  const [q, setQ]     = useState('');
  const [r, setR]     = useState([]);
  const [loading, setL] = useState(false);

  useEffect(() => {
    if (!open) return;
    setL(true);
    loadAllTokens().finally(() => setL(false));
  }, [open]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    const solTokens = (_tokensCache?.[String(LIFI_SOLANA_ID)] || []).map(tk => ({ ...tk, mint: tk.address }));
    if (!t) { setR([]); return; }
    const tm = setTimeout(() => {
      setR(solTokens
        .filter(tk =>
          tk.symbol?.toLowerCase().includes(t) ||
          tk.name?.toLowerCase().includes(t)   ||
          tk.address?.toLowerCase().includes(t)
        )
        .slice(0, 50));
    }, 150);
    return () => clearTimeout(tm);
  }, [q]);

  const close = useCallback(() => { setQ(''); setR([]); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);

  const popular = [
    DEFAULT_FROM,
    {
      chainId:  String(LIFI_SOLANA_ID),
      mint:     USDC_SOLANA,
      address:  USDC_SOLANA,
      symbol:   'USDC',
      name:     'USD Coin',
      decimals: 6,
      logoURI:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    },
  ];
  const display = q.trim() ? r : popular;

  if (!open) return null;
  return (
    <>
      <div onClick={close} className="cc-modal-backdrop"/>
      <div className="cc-modal cc-modal-from">
        <div className="cc-modal-head">
          <div className="cc-modal-head-row">
            <div className="cc-modal-title">
              From <em>solana</em>
            </div>
            <button onClick={close} className="cc-modal-close">✕</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            className="cc-modal-search"
          />
        </div>
        <div className="cc-modal-body">
          {loading && <div className="cc-modal-loading">Loading tokens…</div>}
          {!q.trim() && !loading && (<div className="cc-modal-section">Popular</div>)}
          {display.length === 0 && !loading && (<div className="cc-modal-empty">No matches</div>)}
          {display.map((t, i) => (
            <div
              key={(t.mint || t.address || '') + i}
              onClick={() => { onSelect({ ...t, mint: t.address || t.mint }); close(); }}
              className="cc-modal-row"
            >
              <TokenIcon token={t} size={32}/>
              <div className="cc-modal-row-info">
                <div className="cc-modal-row-sym">{t.symbol}</div>
                <div className="cc-modal-row-name">{t.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

/* ─── TO MODAL ─── */
const ToTokenModal = ({ open, onClose, onSelect, chains }) => {
  const [q, setQ]       = useState('');
  const [tokens, setTokens] = useState([]);
  const [r, setR]       = useState([]);
  const [loading, setL] = useState(false);
  const [sel, setSel]   = useState('all');

  useEffect(() => {
    if (!open) return;
    setL(true);
    loadAllTokens()
      .then(byChain => {
        const all = [];
        for (const [cid, list] of Object.entries(byChain)) {
          if (String(cid) === String(LIFI_SOLANA_ID)) continue;
          for (const t of list) all.push(t);
        }
        setTokens(all);
      })
      .finally(() => setL(false));
  }, [open]);

  const chainChips = useMemo(() => {
    const seen = new Set(tokens.map(t => t.chainId));
    const order = ['1', '56', '137', '42161', '10', '43114', '8453', '324', '59144', '100'];
    const all = Array.from(seen);
    const known   = all.filter(c => order.includes(c)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const others  = all.filter(c => !order.includes(c)).sort((a, b) => {
      const an = chains?.[a]?.name || a;
      const bn = chains?.[b]?.name || b;
      return an.localeCompare(bn);
    });
    return ['all', ...known, ...others];
  }, [tokens, chains]);

  useEffect(() => {
    const t    = q.trim().toLowerCase();
    const filt = sel === 'all' ? tokens : tokens.filter(tk => tk.chainId === sel);
    if (!t) {
      setR(filt
        .filter(tk => ['USDC', 'USDT', 'ETH', 'BNB', 'MATIC', 'AVAX', 'WETH', 'DAI', 'WBTC', 'BTC'].includes(tk.symbol?.toUpperCase()))
        .slice(0, 30));
      return;
    }
    const tm = setTimeout(() => {
      setR(filt
        .filter(tk =>
          tk.symbol?.toLowerCase().includes(t) ||
          tk.name?.toLowerCase().includes(t)   ||
          tk.address?.toLowerCase().includes(t)
        )
        .slice(0, 60));
    }, 150);
    return () => clearTimeout(tm);
  }, [q, tokens, sel]);

  const close = useCallback(() => { setQ(''); setR([]); setSel('all'); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);

  if (!open) return null;
  return (
    <>
      <div onClick={close} className="cc-modal-backdrop"/>
      <div className="cc-modal cc-modal-to">
        <div className="cc-modal-head">
          <div className="cc-modal-head-row">
            <div className="cc-modal-title">
              To <em>any chain</em>
            </div>
            <button onClick={close} className="cc-modal-close">✕</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            className="cc-modal-search"
          />
          <div className="cc-chain-chips">
            {chainChips.map(id => {
              const active = sel === id;
              const chain  = chains?.[id];
              const color  = id === 'all' ? '#4f7dff' : (chain ? chainColorOf(chain) : '#9b8fc0');
              return (
                <button
                  key={id}
                  onClick={() => setSel(id)}
                  className="cc-chain-chip"
                  style={active ? { borderColor: color, background: color + '22', color } : undefined}
                >
                  {id === 'all' ? 'All' : (chain?.name || ('Chain ' + id))}
                </button>
              );
            })}
          </div>
        </div>
        <div className="cc-modal-body">
          {loading && <div className="cc-modal-loading">Loading tokens…</div>}
          {!loading && r.length === 0 && (<div className="cc-modal-empty">No matches</div>)}
          {r.map((t, i) => (
            <div
              key={t.chainId + ':' + t.address + i}
              onClick={() => { onSelect(t); close(); }}
              className="cc-modal-row"
            >
              <TokenIcon token={t} size={30}/>
              <div className="cc-modal-row-info">
                <div className="cc-modal-row-sym">{t.symbol}</div>
                <div className="cc-modal-row-name cc-truncate">{t.name}</div>
              </div>
              <ChainBadge chain={chains?.[t.chainId] || { id: t.chainId, name: 'Chain ' + t.chainId }} small/>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

/* ═══════════ MAIN ═══════════ */
export default function CrossChainSwap({ onConnectWallet }) {
  useCcCSS();

  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const pubkey = publicKey || null;
  const wcon   = !!connected && !!pubkey;

  const [chains, setChains]       = useState(null);
  const [chainsLoading, setChainsLoading] = useState(true);

  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken,   setToToken]   = useState(DEFAULT_TO);
  const [fromAmt,   setFromAmt]   = useState('');
  const [destAddr,  setDestAddr]  = useState('');
  const [addrErr,   setAddrErr]   = useState('');

  const [quote,    setQuote]    = useState(null);
  const [quoting,  setQuoting]  = useState(false);
  const [quoteErr, setQuoteErr] = useState('');

  const [step,      setStep]      = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [swapErr,   setSwapErr]   = useState('');
  const [txSig,     setTxSig]     = useState(null);
  const [pendingMsg, setPendingMsg] = useState(null);

  const [sbl, setSbl] = useState(null);
  const [ssb, setSsb] = useState(null);

  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen,   setToOpen]   = useState(false);

  const reqIdRef = useRef(0);

  useEffect(() => {
    loadChains()
      .then(c => { setChains(c); setChainsLoading(false); })
      .catch(() => { setChains(_chainsCache); setChainsLoading(false); });
    loadAllTokens().catch(() => {});
  }, []);

  const toChain = chains?.[String(toToken?.chainId)] || null;
  const toChainType = toChain?.chainType || 'EVM';
  const needsDest = toToken && String(toToken.chainId) !== String(LIFI_SOLANA_ID);

  useEffect(() => {
    if (!pubkey || !connection) { setSbl(null); setSsb(null); return; }
    let cancelled = false;
    connection.getBalance(pubkey)
      .then(b => { if (!cancelled) setSbl(b); })
      .catch(() => {});
    if (fromToken?.mint && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(fromToken.mint) })
        .then(a => {
          if (cancelled) return;
          setSsb(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
        })
        .catch(() => {});
    } else {
      setSsb(null);
    }
    return () => { cancelled = true; };
  }, [pubkey, connection, fromToken, step]);

  const fbd = useMemo(() => {
    if (fromToken?.mint === WSOL_MINT) return sbl != null ? sbl / LAMPORTS_PER_SOL : null;
    return ssb;
  }, [fromToken, sbl, ssb]);

  useEffect(() => {
    if (!needsDest || !destAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateDest(destAddr, toChainType) || '');
  }, [destAddr, toChainType, needsDest]);

  const fetchQuote = useCallback(async () => {
    setQuoteErr('');
    if (!fromAmt || +fromAmt <= 0 || !fromToken || !toToken) { setQuote(null); return; }
    if (!pubkey) { setQuote(null); setQuoteErr('Connect a wallet to see a quote'); return; }

    const myReq = ++reqIdRef.current;
    setQuoting(true);

    try {
      const dec = fromToken.decimals;
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') { setQuote(null); setQuoting(false); return; }

      const sender   = pubkey.toString();
      const userDest = destAddr.trim();
      const userDestOk = userDest && !validateDest(userDest, toChainType);
      const receiver = userDestOk
        ? userDest
        : (toChainType === 'EVM' ? '0x000000000000000000000000000000000000dEaD' : sender);

      const j = await lifiQuote({
        fromChainId: LIFI_SOLANA_ID,
        fromMint:    fromToken.mint || fromToken.address,
        toChainId:   toToken.chainId,
        toAddress:   toToken.address,
        amount:      raw,
        sender, receiver,
      });
      if (myReq !== reqIdRef.current) return;

      if (!j?.estimate) throw new Error('No route available');
      const outAmt = Number(j.estimate.toAmountMin || j.estimate.toAmount) / Math.pow(10, toToken.decimals);
      const fromUSD = Number(j.estimate.fromAmountUSD) || 0;
      const solPrice = getSolPriceUSD();
      const feeLamports = computeSolFeeLamports(fromUSD, solPrice);
      const feeSOL = feeLamports / LAMPORTS_PER_SOL;
      const feeUSD = solPrice ? feeSOL * solPrice : null;

      setQuote({
        outAmt,
        outDisplay: fmtTok(outAmt),
        estTime:    j.estimate.executionDuration || null,
        bridge:     j.toolDetails?.name || j.tool || 'LI.FI',
        raw:        j,
        rawAmount:  raw,
        feeLamports,
        feeSOL,
        feeUSD,
        fromUSD,
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (myReq === reqIdRef.current) {
        setQuote(null);
        setQuoteErr(friendlyError(e));
      }
    } finally {
      if (myReq === reqIdRef.current) setQuoting(false);
    }
  }, [fromAmt, fromToken, toToken, destAddr, pubkey, toChainType]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  const onMax = useCallback(() => {
    if (fbd == null || fbd <= 0) return;
    const dec = Math.min(fromToken.decimals, 9);
    if (fromToken?.mint === WSOL_MINT) {
      const reserveLamports = SOL_RESERVE + MIN_FEE_LAMPORTS;
      setFromAmt(fmtInput(Math.max(0, (sbl - reserveLamports)) / LAMPORTS_PER_SOL, dec));
    } else {
      setFromAmt(fmtInput(fbd, dec));
    }
  }, [fbd, fromToken, sbl]);

  const solShortfall = useMemo(() => {
    if (!quote || sbl == null) return null;
    const need = quote.feeLamports + SOL_RESERVE;
    if (fromToken?.mint === WSOL_MINT) {
      const inputLamports = Math.floor(Number(fromAmt) * LAMPORTS_PER_SOL);
      const total = inputLamports + quote.feeLamports + SOL_RESERVE;
      return sbl < total ? (total - sbl) : 0;
    }
    return sbl < need ? (need - sbl) : 0;
  }, [quote, sbl, fromToken, fromAmt]);

  const execute = useCallback(async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (needsDest) {
      const e = validateDest(destAddr, toChainType);
      if (e) { setAddrErr(e); return; }
    }
    if (!quote) { setSwapErr('No route. Wait for routing.'); return; }
    if (!signTransaction) { setSwapErr('Wallet does not support signing. Use Phantom or Solflare.'); return; }
    if (solShortfall && solShortfall > 0) {
      setSwapErr(`Not enough SOL — need ~${(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet.`);
      return;
    }

    setStep(1);
    setSwapErr('');
    setStatusMsg('Building route…');
    setTxSig(null);
    setPendingMsg(null);

    try {
      const dec = fromToken.decimals;
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') throw new Error('Invalid amount');

      const j = quote.raw;
      const txData = j?.transactionRequest?.data;
      if (!txData) throw new Error('LI.FI returned no transaction');

      const feeLamports = quote.feeLamports;

      setStatusMsg('Preparing transaction…');
      const latest = await connection.getLatestBlockhash('confirmed');
      const tx = await buildAtomicTx({
        connection, payer: pubkey,
        bridgeTxBase64: txData,
        feeLamports,
        blockhash: latest.blockhash,
      });

      const mapSimErr = (logs) => {
        const t = (logs || []).join('\n').toLowerCase();
        if (t.includes('insufficient') || t.includes('0x1')) return 'Insufficient balance for this bridge.';
        if (t.includes('slippage') || t.includes('0x1771'))  return 'Price moved — try a smaller amount or wait a moment.';
        if (t.includes('account not') || t.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (t.includes('blockhash') || t.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Bridge simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[crosschain] sim non-fatal', simErr);
      }

      setStep(2);
      setStatusMsg('Sign in wallet…');
      const signed = await signTransaction(tx);

      setStep(3);
      setStatusMsg('Submitting transaction…');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      setTxSig(sig);

      let bridgeOk = false;
      try {
        const result = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 35_000)),
        ]);
        bridgeOk = !result?.value?.err;
        if (result?.value?.err) throw new Error('Bridge tx failed on-chain: ' + JSON.stringify(result.value.err));
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { bridgeOk = true; break; }
            if (st?.value?.err) throw new Error('Bridge tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      if (bridgeOk) {
        setStep(4);
        setStatusMsg('');
      } else {
        setStep(4);
        setStatusMsg('');
        setPendingMsg('Submitted but still confirming. Check Solscan for status.');
      }
    } catch (e) {
      console.error('[CrossChain]', e);
      setSwapErr(friendlyError(e));
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 6000);
    }
  }, [
    wcon, needsDest, destAddr, toToken, fromToken, fromAmt,
    pubkey, signTransaction, connection, quote, onConnectWallet, toChainType, solShortfall,
  ]);

  const reset = useCallback(() => {
    setStep(0); setStatusMsg(''); setSwapErr(''); setTxSig(null); setPendingMsg(null);
    setFromAmt(''); setQuote(null); setQuoteErr('');
  }, []);

  const tuv = quote?.raw?.estimate?.toAmountUSD ? Number(quote.raw.estimate.toAmountUSD) : 0;
  const fromUsd = quote?.fromUSD || 0;
  const busy      = step > 0 && step < 4 && step !== -1;
  const isSuccess = step === 4;
  const isError   = step === -1;
  const solscan   = txSig ? 'https://solscan.io/tx/' + txSig : null;

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1)   return 'Building Route…';
    if (step === 2)   return 'Sign in Wallet…';
    if (step === 3)   return 'Bridging…';
    if (isSuccess)    return pendingMsg ? 'Submitted ✓' : 'Bridge Submitted ✓';
    if (isError)      return 'Try Again';
    if (!fromAmt)     return 'Enter Amount';
    if (needsDest && !destAddr.trim()) return 'Enter Destination';
    if (addrErr)      return 'Invalid Address';
    if (!quote)       return quoting ? 'Finding Route…' : 'No Route';
    if (solShortfall) return 'Need more SOL';
    return null; // render with italic arrow below
  };

  const btnDisabled = busy ||
    (wcon && (!fromAmt || (needsDest && !destAddr.trim()) || !!addrErr ||
              (!quote && !isError && !isSuccess) || !!solShortfall));

  const btnClass = () => {
    if (isSuccess)  return 'cc-cta cc-cta-success';
    if (isError)    return 'cc-cta cc-cta-error';
    if (btnDisabled && wcon) return 'cc-cta cc-cta-disabled';
    return 'cc-cta';
  };

  const fromChain = chains?.[String(LIFI_SOLANA_ID)] || { id: String(LIFI_SOLANA_ID), name: 'Solana', chainType: 'SVM' };
  const toChainDisplay = chains?.[String(toToken?.chainId)] || { id: toToken?.chainId, name: 'Chain ' + toToken?.chainId };
  const toChainColor = chainColorOf(toChainDisplay);

  const labelOverride = btnLabel();

  return (
    <div className="cc-page">
      <div className="cc-blob" style={{ width: 380, height: 380, background: '#A0E7FF', top: -100, right: -120 }}/>
      <div className="cc-blob" style={{ width: 420, height: 420, background: '#B794F6', top: '35%', left: -160, animationDelay: '3s' }}/>
      <div className="cc-blob" style={{ width: 300, height: 300, background: '#FFE8F4', bottom: '10%', right: -80, animationDelay: '6s' }}/>

      <div className="cc-inner">
        <div className="cc-head">
          <div className="cc-brand">
            <div className="cc-brand-dot"/>
            <span className="cc-wordmark">bridge<span className="slash">//</span><span className="grad">cross-chain</span></span>
          </div>
          <div className="cc-head-live"><span className="d"/>LI.FI</div>
        </div>

        <div className="cc-mini-hero">
          <div className="cc-mh-eyebrow">∞ ANY CHAIN</div>
          <h1 className="cc-mh-title">Move it <em>anywhere.</em></h1>
          <div className="cc-mh-sub">One transaction. Solana out, any chain in.</div>
        </div>

        <div className="cc-card">
          <StepProgress step={step}/>

          {/* FROM */}
          <div className="cc-io-box">
            <div className="cc-io-head">
              <span className="cc-io-label">You Send</span>
              <div className="cc-io-meta">
                <ChainBadge chain={fromChain} small/>
                {fbd != null && (
                  <span className="cc-io-bal">Bal: <span className="cc-io-bal-val">{fmtTok(fbd)}</span></span>
                )}
              </div>
            </div>
            <div className="cc-io-row">
              <button
                onClick={() => !busy && setFromOpen(true)}
                className="cc-token-btn"
                disabled={busy}
              >
                <TokenIcon token={fromToken} size={22}/>
                <span className="cc-token-sym">{fromToken?.symbol}</span>
                {!busy && <span className="cc-token-caret">▾</span>}
              </button>
              <input
                value={fromAmt}
                onChange={e => { if (!busy) setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
                placeholder="0.00"
                inputMode="decimal"
                disabled={busy}
                className="cc-io-input"
              />
              {fbd > 0 && !busy && (<button onClick={onMax} className="cc-max-btn">MAX</button>)}
            </div>
            {fromUsd > 0 && (<div className="cc-io-usd">≈ {fmtUsd(fromUsd)}</div>)}
          </div>

          <div className="cc-flip-wrap"><div className="cc-flip-arrow">↓</div></div>

          {/* TO */}
          <div className="cc-io-box">
            <div className="cc-io-head">
              <span className="cc-io-label">You Receive (est.)</span>
              {toToken && <ChainBadge chain={toChainDisplay} small/>}
            </div>
            <div className="cc-io-row">
              <button
                onClick={() => !busy && setToOpen(true)}
                className="cc-token-btn"
                disabled={busy}
              >
                <TokenIcon token={toToken} size={22}/>
                <span className="cc-token-sym">{toToken?.symbol}</span>
                {!busy && <span className="cc-token-caret">▾</span>}
              </button>
              <div className={'cc-io-output' + ((!quote && !quoting) ? ' cc-io-output-empty' : '')}>
                {quoting ? <span className="cc-io-output-loading">…</span> : (quote?.outDisplay || '0')}
              </div>
            </div>
            {tuv > 0 && (<div className="cc-io-usd">≈ {fmtUsd(tuv)}</div>)}
            {quote && (
              <div className="cc-route-meta">
                <span className="cc-route-via">via <span className="cc-route-tag">{quote.bridge}</span></span>
                <span>
                  <b>{(SLIPPAGE * 100).toFixed(1)}%</b> slip
                  {quote.estTime ? <> · <b>~{Math.max(1, Math.ceil(quote.estTime / 60))} min</b></> : null}
                </span>
              </div>
            )}
          </div>

          {needsDest && (
            <div className="cc-dest">
              <div className="cc-dest-label">
                DESTINATION · <span className="cc-dest-chain" style={{ color: toChainColor }}>
                  {(toChainDisplay?.name || '').toUpperCase()}
                </span>
              </div>
              <div className="cc-dest-input-wrap">
                <input
                  value={destAddr}
                  onChange={e => { if (!busy) setDestAddr(e.target.value.trim()); }}
                  placeholder={
                    toChainType === 'EVM'  ? '0x...'
                    : toChainType === 'SVM' ? 'Solana address'
                    : toChainType === 'UTXO' ? 'bc1... / 1... / 3...'
                    : toChainType === 'MVM' ? '0x... (64 hex)'
                    : 'Destination address'
                  }
                  disabled={busy}
                  className={'cc-dest-input' + (addrErr ? ' cc-dest-err' : destAddr && !addrErr ? ' cc-dest-ok' : '')}
                />
                {destAddr && !addrErr && (<div className="cc-dest-check">✓</div>)}
              </div>
              {addrErr && <div className="cc-dest-err-msg">{addrErr}</div>}
            </div>
          )}

          {quoteErr && !quote && (<div className="cc-warn">{quoteErr}</div>)}

          {solShortfall > 0 && quote && (
            <div className="cc-warn">
              You need ~{(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet to complete this bridge.
            </div>
          )}

          {statusMsg && busy && (
            <div className="cc-status"><div className="cc-spinner"/>{statusMsg}</div>
          )}

          {swapErr && (<div className="cc-error">{swapErr}</div>)}

          {isSuccess && (
            <div className={'cc-success' + (pendingMsg ? ' cc-success-pending' : '')}>
              <div className="cc-success-icon">{pendingMsg ? '⏳' : '🎉'}</div>
              <div className="cc-success-title">{pendingMsg ? 'Bridge Submitted' : 'Bridge Submitted!'}</div>
              <div className="cc-success-sub">
                {pendingMsg || (quote?.estTime
                  ? 'Funds arrive in ~' + Math.max(1, Math.ceil(quote.estTime / 60)) + ' min'
                  : 'Funds arrive in a few minutes')}
              </div>
            </div>
          )}

          {!isSuccess ? (
            <button
              onClick={isError ? reset : (!wcon ? () => onConnectWallet?.() : execute)}
              disabled={btnDisabled && !isError}
              className={btnClass()}
            >
              {busy && <span className="cc-cta-spinner">⟳</span>}
              {labelOverride != null ? labelOverride : (
                <>Bridge {fromToken?.symbol || ''} <em>→</em> {toToken?.symbol || ''}</>
              )}
            </button>
          ) : (
            <button onClick={reset} className="cc-cta cc-cta-reset">New Bridge</button>
          )}

          {txSig && solscan && (
            <a href={solscan} target="_blank" rel="noreferrer" className="cc-solscan-link">View on Solscan ↗</a>
          )}
          <p className="cc-footer-note">Non-custodial · LI.FI aggregator · Solana origin</p>
        </div>
      </div>

      <FromTokenModal
        open={fromOpen}
        onClose={() => setFromOpen(false)}
        onSelect={t => { setFromToken(t); setQuote(null); }}
      />
      <ToTokenModal
        open={toOpen}
        onClose={() => setToOpen(false)}
        onSelect={t => { setToToken(t); setQuote(null); setDestAddr(''); setAddrErr(''); }}
        chains={chains}
      />
    </div>
  );
}
