/**
 * NEXUS DEX — CrossChainSwap.jsx
 * (Originally CrossChain.jsx — LI.FI atomic single-tx, fee in SOL)
 *
 * CHANGES (visual only — all trading/RPC/LI.FI logic preserved exactly):
 *   • CSS combined inline as CC_CSS + useCcCSS injector (no CrossChain.css)
 *   • Theme switched from mint/violet to blue #4f7dff + violet #a87fff
 *     so the widget feels native under the new BridgeHero.
 *   • Fonts normalized to Syne + JetBrains Mono (matches App.jsx).
 *   • All LI.FI quote/build/sign/send/confirm flow UNCHANGED. Same cc-
 *     class prefix.
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
// INLINE CSS — Syne + JetBrains Mono · blue + violet matching BridgeHero
// =====================================================================
const CC_CSS = `
.cc-page,.cc-modal-backdrop,.cc-modal{
  --cc-bg:#03060f;
  --cc-card:#080d1a; --cc-card-2:#0c1220; --cc-card-3:#111d30;
  --cc-ink:#e6efff; --cc-ink-str:#f5fafe;
  --cc-muted:#9b8fc0; --cc-muted-2:#564670;
  --cc-hl:#4f7dff; --cc-hl-2:#7a9eff;
  --cc-hl-dim:rgba(79,125,255,.14);
  --cc-violet:#a87fff;
  --cc-up:#00ffa3; --cc-down:#ff5566; --cc-warn:#f5b53d;
  --cc-border:rgba(255,255,255,.06);
  --cc-border-hi:rgba(79,125,255,.32);
  --cc-hairline:rgba(255,255,255,.05);
  --cc-font-display:'Syne',system-ui,sans-serif;
  --cc-font-body:'Syne',system-ui,sans-serif;
  --cc-font-mono:'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace;
  font-family:var(--cc-font-body);
  color:var(--cc-ink);
  box-sizing:border-box;
}
.cc-page *,.cc-modal *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}

@keyframes cc-spin{to{transform:rotate(360deg)}}
@keyframes cc-pulse{50%{opacity:.4}}
@keyframes cc-rise{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes cc-modal-in{from{opacity:0;transform:translate(-50%,-48%)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes cc-shimmer{0%{left:-110px}50%,100%{left:130%}}

/* PAGE */
.cc-page{width:100%;max-width:480px;margin:0 auto;padding:0}

/* WIDGET TITLE (matches App.jsx pattern) */
.cc-widget-title{display:flex;align-items:center;justify-content:space-between;padding:0 4px 12px;margin-top:-4px}
.cc-widget-title .nm{font-family:var(--cc-font-display);font-weight:800;font-size:20px;letter-spacing:-.01em;color:var(--cc-ink-str)}
.cc-widget-title .live{display:flex;align-items:center;gap:6px;font-family:var(--cc-font-mono);font-size:10px;font-weight:800;color:var(--cc-hl);border:1px solid var(--cc-border-hi);border-radius:100px;padding:5px 11px;background:var(--cc-hl-dim)}
.cc-widget-title .live .d{width:5px;height:5px;border-radius:50%;background:var(--cc-hl);box-shadow:0 0 8px var(--cc-hl);animation:cc-pulse 1.6s ease-in-out infinite}

/* CARD */
.cc-card{background:linear-gradient(180deg,rgba(14,20,40,.96),rgba(7,11,22,.98));border:1.5px solid rgba(79,125,255,.18);border-radius:22px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.55)}

/* STEPS */
.cc-steps{display:flex;align-items:flex-start;gap:0;margin:0 0 14px}
.cc-step{display:flex;flex-direction:column;align-items:center;flex:0 0 auto}
.cc-step-circle{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:900;background:var(--cc-card-3);color:var(--cc-muted);border:2px solid var(--cc-muted-2);font-family:var(--cc-font-display);transition:all .2s}
.cc-step-active{background:linear-gradient(135deg,var(--cc-hl),var(--cc-violet));color:#fff;border-color:var(--cc-hl);box-shadow:0 0 16px rgba(79,125,255,.4)}
.cc-step-done{background:var(--cc-up);color:#03060f;border-color:var(--cc-up)}
.cc-step-label{font-size:9px;margin-top:5px;font-weight:800;color:var(--cc-muted);font-family:var(--cc-font-mono);letter-spacing:.04em}
.cc-step-label-active{color:var(--cc-hl)}
.cc-step-label-done{color:var(--cc-up)}
.cc-step-line{height:2px;flex:1;margin-top:14px;background:var(--cc-muted-2);border-radius:2px;transition:background .2s}
.cc-step-line-done{background:var(--cc-up)}

/* IO BOXES */
.cc-io-box{background:rgba(255,255,255,.025);border-radius:14px;padding:14px;border:1.5px solid var(--cc-border);transition:border-color .15s}
.cc-io-box:focus-within{border-color:var(--cc-border-hi);box-shadow:0 0 0 3px rgba(79,125,255,.08)}
.cc-io-box+.cc-io-box{margin-top:0}
.cc-io-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap}
.cc-io-label{font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.cc-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cc-io-bal{font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);font-weight:600}
.cc-io-bal-val{color:var(--cc-ink-str);font-weight:800}

.cc-io-row{display:flex;align-items:center;gap:10px}
.cc-token-btn{display:flex;align-items:center;gap:7px;padding:9px 12px;background:linear-gradient(135deg,#1a1f2e,#101015);border:1.5px solid rgba(255,255,255,.14);border-radius:999px;color:var(--cc-ink-str);font-family:var(--cc-font-display);font-size:13px;font-weight:800;cursor:pointer;transition:all .15s;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.25),inset 0 -1px 0 rgba(0,0,0,.15);min-width:110px}
.cc-token-btn:hover:not(:disabled){border-color:var(--cc-hl);box-shadow:0 2px 12px rgba(79,125,255,.18),inset 0 -1px 0 rgba(0,0,0,.15)}
.cc-token-btn:active{transform:translateY(1px)}
.cc-token-btn:disabled{cursor:not-allowed;opacity:.6}
.cc-token-sym{color:var(--cc-ink-str);font-weight:800;font-size:13px;font-family:var(--cc-font-display);letter-spacing:-.01em}
.cc-token-caret{color:var(--cc-muted);font-size:11px}

.cc-io-input{flex:1;background:transparent;border:none;font-family:var(--cc-font-display);font-size:24px;font-weight:900;color:var(--cc-ink-str);text-align:right;outline:none;font-variant-numeric:tabular-nums;letter-spacing:-.02em;min-width:0;width:100%}
.cc-io-input:disabled{opacity:.5}
.cc-io-input::placeholder{color:var(--cc-muted-2);font-weight:700}

.cc-io-output{flex:1;text-align:right;font-family:var(--cc-font-display);font-size:24px;font-weight:900;color:var(--cc-muted-2);font-variant-numeric:tabular-nums;letter-spacing:-.02em;min-width:0;overflow:hidden;text-overflow:ellipsis}
.cc-io-output-active{color:var(--cc-hl)}
.cc-io-output-loading{font-size:16px;color:var(--cc-muted)}

.cc-max-btn{background:var(--cc-hl-dim);border:1px solid var(--cc-border-hi);color:var(--cc-hl);padding:6px 10px;border-radius:8px;font-family:var(--cc-font-mono);font-size:10px;font-weight:800;cursor:pointer;letter-spacing:.08em;transition:all .15s;flex-shrink:0}
.cc-max-btn:hover{background:rgba(79,125,255,.22);box-shadow:0 0 10px rgba(79,125,255,.2)}

.cc-io-usd{text-align:right;margin-top:6px;font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);font-weight:600}
.cc-route-meta{margin-top:10px;font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);display:flex;justify-content:space-between;letter-spacing:.04em;font-weight:600}

/* FLIP ARROW */
.cc-flip-wrap{display:flex;justify-content:center;margin:-6px 0;position:relative;z-index:2}
.cc-flip-arrow{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--cc-hl),var(--cc-violet));border:3px solid var(--cc-card);display:grid;place-items:center;color:#fff;font-size:18px;font-weight:900;box-shadow:0 4px 18px rgba(168,127,255,.35),inset 0 -2px 0 rgba(0,0,0,.15)}

/* CHAIN BADGE */
.cc-chain-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid;border-radius:6px;padding:3px 8px;font-family:var(--cc-font-display);font-size:10px;font-weight:800;letter-spacing:.02em}
.cc-chain-badge-sm{padding:2px 6px;font-size:9px}
.cc-chain-dot{width:6px;height:6px;border-radius:50%}
.cc-chain-badge-sm .cc-chain-dot{width:5px;height:5px}

/* DESTINATION */
.cc-dest{margin-top:14px}
.cc-dest-label{font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);font-weight:800;letter-spacing:.12em;margin-bottom:8px;text-transform:uppercase}
.cc-dest-chain{font-weight:600}
.cc-dest-input-wrap{position:relative}
.cc-dest-input{width:100%;background:rgba(255,255,255,.025);border:1.5px solid var(--cc-border);border-radius:12px;padding:13px 14px;color:var(--cc-ink-str);font-family:var(--cc-font-mono);font-size:13px;outline:none;transition:border-color .15s}
.cc-dest-input:focus{border-color:var(--cc-hl);box-shadow:0 0 0 3px rgba(79,125,255,.08)}
.cc-dest-input:disabled{opacity:.5}
.cc-dest-err{border-color:var(--cc-down)}
.cc-dest-ok{border-color:var(--cc-up)}
.cc-dest-check{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--cc-up);font-size:16px;font-weight:900}
.cc-dest-err-msg{margin-top:6px;font-family:var(--cc-font-mono);font-size:11px;color:var(--cc-down);font-weight:600}

/* MESSAGES */
.cc-warn{margin-top:10px;padding:11px 13px;background:rgba(245,181,61,.08);border:1px solid rgba(245,181,61,.22);border-radius:10px;font-size:12px;color:var(--cc-warn);font-weight:600;font-family:var(--cc-font-body)}
.cc-error{margin-top:10px;padding:11px 13px;background:rgba(255,85,102,.08);border:1px solid rgba(255,85,102,.24);border-radius:10px;font-size:12px;color:var(--cc-down);font-weight:600;font-family:var(--cc-font-body)}
.cc-status{margin-top:10px;padding:11px 13px;background:rgba(79,125,255,.06);border:1px solid rgba(79,125,255,.22);border-radius:10px;font-size:12px;color:var(--cc-hl);display:flex;align-items:center;gap:10px;font-weight:600;font-family:var(--cc-font-body)}
.cc-spinner{width:12px;height:12px;border-radius:50%;border:2px solid var(--cc-hl-dim);border-top-color:var(--cc-hl);animation:cc-spin .8s linear infinite;flex-shrink:0}

/* ROUTE DETAILS */
.cc-route-details{margin-top:12px;background:rgba(79,125,255,.04);border-radius:12px;padding:12px 14px;border:1px solid rgba(79,125,255,.18);font-family:var(--cc-font-mono);font-size:11px}
.cc-detail-row{display:flex;justify-content:space-between;padding:4px 0;gap:8px}
.cc-detail-key{color:var(--cc-muted);font-weight:600}
.cc-detail-val{color:var(--cc-ink-str);font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
.cc-detail-note{margin-top:10px;padding-top:10px;border-top:1px solid rgba(79,125,255,.16);font-size:10.5px;color:var(--cc-muted);line-height:1.5;font-weight:500;font-family:var(--cc-font-body)}

/* SUCCESS */
.cc-success{margin-top:12px;padding:16px;background:rgba(79,125,255,.06);border:1.5px solid rgba(79,125,255,.24);border-radius:14px;text-align:center;animation:cc-rise .4s}
.cc-success-pending{background:rgba(245,181,61,.06);border-color:rgba(245,181,61,.24)}
.cc-success-icon{font-size:26px;margin-bottom:6px}
.cc-success-title{color:var(--cc-hl);font-family:var(--cc-font-display);font-weight:900;font-size:15px;letter-spacing:-.01em}
.cc-success-pending .cc-success-title{color:var(--cc-warn)}
.cc-success-sub{color:var(--cc-muted);font-size:11.5px;margin-top:4px;font-family:var(--cc-font-body)}

/* CTA */
.cc-cta{width:100%;margin-top:14px;padding:18px;border-radius:14px;border:none;font-family:var(--cc-font-display);font-weight:900;font-size:15px;min-height:56px;letter-spacing:.04em;cursor:pointer;transition:all .15s;color:inherit;position:relative;overflow:hidden}
.cc-cta-primary{background:linear-gradient(135deg,var(--cc-hl),var(--cc-violet));color:#fff;box-shadow:0 10px 30px -8px rgba(168,127,255,.5),0 4px 14px rgba(79,125,255,.3),inset 0 2px 0 rgba(255,255,255,.25),inset 0 -2px 0 rgba(0,0,0,.15)}
.cc-cta-primary::after{content:'';position:absolute;top:0;bottom:0;width:70px;left:-110px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:cc-shimmer 2.8s ease-in-out infinite;pointer-events:none}
.cc-cta-primary:active:not(:disabled){transform:translateY(3px)}
.cc-cta-success{background:linear-gradient(135deg,var(--cc-up),var(--cc-hl-2));color:#03060f;box-shadow:0 8px 28px rgba(0,255,163,.35),0 4px 0 rgba(0,0,0,.25)}
.cc-cta-error{background:rgba(255,85,102,.15);color:var(--cc-down);border:1.5px solid rgba(255,85,102,.35)}
.cc-cta-disabled{background:linear-gradient(135deg,#2a2a35,#1f1f28);color:var(--cc-muted-2);cursor:not-allowed;border:1.5px solid var(--cc-border)}
.cc-cta-disabled::after{display:none}
.cc-cta-reset{background:rgba(79,125,255,.06);color:var(--cc-hl);border:1.5px solid var(--cc-border-hi)}
.cc-cta-reset:hover{background:rgba(79,125,255,.12)}
.cc-cta-spinner{margin-right:8px;display:inline-block;animation:cc-spin .8s linear infinite}

.cc-solscan-link{display:block;text-align:center;margin-top:10px;font-family:var(--cc-font-mono);font-size:11px;color:var(--cc-hl);font-weight:800;text-decoration:none;letter-spacing:.04em}
.cc-solscan-link:hover{text-decoration:underline}
.cc-footer-note{text-align:center;font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted-2);margin-top:14px;font-weight:600;letter-spacing:.04em}

/* MODALS */
.cc-modal-backdrop{position:fixed;inset:0;z-index:499;background:rgba(3,6,15,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.cc-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:500;background:linear-gradient(180deg,#101015,var(--cc-card));border:1.5px solid var(--cc-border-hi);border-radius:22px;width:94vw;max-width:440px;max-height:85dvh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.95);animation:cc-modal-in .25s cubic-bezier(.2,1.2,.4,1)}
.cc-modal-to{max-width:460px;max-height:88dvh}

.cc-modal-head{padding:18px 18px 12px;border-bottom:1px solid var(--cc-border)}
.cc-modal-head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cc-modal-title{color:var(--cc-ink-str);font-family:var(--cc-font-display);font-weight:800;font-size:17px;letter-spacing:-.02em}
.cc-modal-sub{font-size:11px;color:var(--cc-muted);font-weight:500}
.cc-modal-close{background:rgba(255,255,255,.05);border:1px solid var(--cc-border);border-radius:10px;width:32px;height:32px;color:var(--cc-ink);cursor:pointer;font-size:16px;display:grid;place-items:center;transition:all .15s}
.cc-modal-close:hover{background:rgba(255,255,255,.1);transform:rotate(90deg)}

.cc-modal-search{width:100%;background:#1a1a22;border:1.5px solid var(--cc-border);border-radius:10px;padding:11px 13px;color:var(--cc-ink-str);font-family:var(--cc-font-body);font-size:13px;outline:none;font-weight:500;transition:border-color .15s}
.cc-modal-search:focus{border-color:var(--cc-hl);box-shadow:0 0 0 3px rgba(79,125,255,.1)}
.cc-modal-search::placeholder{color:var(--cc-muted-2)}

.cc-chain-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}
.cc-chain-chips::-webkit-scrollbar{display:none}
.cc-chain-chip{flex-shrink:0;padding:5px 11px;border-radius:20px;border:1.5px solid var(--cc-muted-2);background:transparent;color:var(--cc-muted);font-family:var(--cc-font-display);font-size:11px;font-weight:800;cursor:pointer;letter-spacing:.02em;transition:all .15s}

.cc-modal-body{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding-bottom:env(safe-area-inset-bottom)}
.cc-modal-loading,.cc-modal-empty{padding:28px;text-align:center;color:var(--cc-muted);font-size:12.5px;font-weight:500;font-family:var(--cc-font-body)}
.cc-modal-section{padding:10px 18px 6px;font-family:var(--cc-font-mono);font-size:10px;color:var(--cc-muted);font-weight:800;letter-spacing:.12em}
.cc-modal-row{padding:12px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.03);transition:background .15s}
.cc-modal-row:hover{background:rgba(79,125,255,.06)}
.cc-modal-row-info{flex:1;min-width:0}
.cc-modal-row-sym{color:var(--cc-ink-str);font-family:var(--cc-font-display);font-weight:800;font-size:13.5px;letter-spacing:-.01em}
.cc-modal-row-name{color:var(--cc-muted);font-size:11.5px;font-weight:500}
.cc-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* TOKEN ICON */
.cc-token-img{border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(255,255,255,.04)}
.cc-token-fallback{border-radius:50%;flex-shrink:0;background:rgba(79,125,255,.1);border:1px solid rgba(79,125,255,.2);display:grid;place-items:center;font-family:var(--cc-font-display);font-weight:800;color:var(--cc-hl)}
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
    <div className="cc-token-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{ch}</div>
  );
};

const ChainBadge = ({ chain, small = false }) => {
  if (!chain) return null;
  const color = chainColorOf(chain);
  return (
    <div
      className={'cc-chain-badge' + (small ? ' cc-chain-badge-sm' : '')}
      style={{ background: color + '22', borderColor: color + '55', color }}
    >
      <div className="cc-chain-dot" style={{ background: color }}/>
      {chain.name}
    </div>
  );
};

const StepProgress = ({ step }) => {
  if (step <= 0) return null;
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
        return (
          <React.Fragment key={s.id}>
            <div className="cc-step">
              <div className={'cc-step-circle' + (done ? ' cc-step-done' : active ? ' cc-step-active' : '')}>
                {done ? '✓' : s.id}
              </div>
              <div className={'cc-step-label' + (done ? ' cc-step-label-done' : active ? ' cc-step-label-active' : '')}>
                {s.label}
              </div>
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
              From <span className="cc-modal-sub">· Solana</span>
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
          {!q.trim() && !loading && (<div className="cc-modal-section">POPULAR</div>)}
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
              To <span className="cc-modal-sub">· All Chains</span>
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
                  className={'cc-chain-chip' + (active ? ' cc-chain-chip-active' : '')}
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
    return `Bridge ${fromToken?.symbol || ''} → ${toToken?.symbol || ''}`;
  };
  const btnDisabled = busy ||
    (wcon && (!fromAmt || (needsDest && !destAddr.trim()) || !!addrErr ||
              (!quote && !isError && !isSuccess) || !!solShortfall));

  const btnClass = () => {
    if (isSuccess)  return 'cc-cta cc-cta-success';
    if (isError)    return 'cc-cta cc-cta-error';
    if (btnDisabled && wcon) return 'cc-cta cc-cta-disabled';
    return 'cc-cta cc-cta-primary';
  };

  const fromChain = chains?.[String(LIFI_SOLANA_ID)] || { id: String(LIFI_SOLANA_ID), name: 'Solana', chainType: 'SVM' };
  const toChainDisplay = chains?.[String(toToken?.chainId)] || { id: toToken?.chainId, name: 'Chain ' + toToken?.chainId };

  return (
    <div className="cc-page">
      <div className="cc-widget-title">
        <div className="nm">Bridge</div>
        <div className="live"><span className="d"></span>LIVE</div>
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
              <TokenIcon token={fromToken} size={20}/>
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
          {fromUsd > 0 && (<div className="cc-io-usd">{fmtUsd(fromUsd)}</div>)}
        </div>

        <div className="cc-flip-wrap"><div className="cc-flip-arrow">↓</div></div>

        {/* TO */}
        <div className="cc-io-box">
          <div className="cc-io-head">
            <span className="cc-io-label">You Receive (Est.)</span>
            {toToken && <ChainBadge chain={toChainDisplay} small/>}
          </div>
          <div className="cc-io-row">
            <button
              onClick={() => !busy && setToOpen(true)}
              className="cc-token-btn"
              disabled={busy}
            >
              <TokenIcon token={toToken} size={20}/>
              <span className="cc-token-sym">{toToken?.symbol}</span>
              {!busy && <span className="cc-token-caret">▾</span>}
            </button>
            <div className={'cc-io-output' + (quote ? ' cc-io-output-active' : '')}>
              {quoting ? <span className="cc-io-output-loading">…</span> : (quote?.outDisplay || '0')}
            </div>
          </div>
          {tuv > 0 && (<div className="cc-io-usd">{fmtUsd(tuv)}</div>)}
          {quote && (
            <div className="cc-route-meta">
              <span>via {quote.bridge}</span>
              {quote.estTime && <span>~{Math.max(1, Math.ceil(quote.estTime / 60))} min</span>}
            </div>
          )}
        </div>

        {needsDest && (
          <div className="cc-dest">
            <div className="cc-dest-label">
              DESTINATION{' '}
              <span className="cc-dest-chain" style={{ color: chainColorOf(toChainDisplay) }}>
                · {toChainDisplay?.name}
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

        {quote && fromAmt && (
          <div className="cc-route-details">
            {[
              ['Route',        quote.bridge],
              ['Slippage',     (SLIPPAGE * 100).toFixed(1) + '%'],
              ['Est. time',    quote.estTime ? '~' + Math.max(1, Math.ceil(quote.estTime / 60)) + ' min' : '—'],
            ].map(([k, v]) => (
              <div key={k} className="cc-detail-row">
                <span className="cc-detail-key">{k}</span>
                <span className="cc-detail-val">{v}</span>
              </div>
            ))}
          </div>
        )}

        {solShortfall > 0 && quote && (
          <div className="cc-warn">
            You need ~{(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet to complete this bridge.
          </div>
        )}

        {statusMsg && busy && (<div className="cc-status"><div className="cc-spinner"/>{statusMsg}</div>)}

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
            {btnLabel()}
          </button>
        ) : (
          <button onClick={reset} className="cc-cta cc-cta-reset">New Bridge</button>
        )}

        {txSig && solscan && (
          <a href={solscan} target="_blank" rel="noreferrer" className="cc-solscan-link">View on Solscan ↗</a>
        )}
        <p className="cc-footer-note">Non-custodial · LI.FI aggregator · Solana origin</p>
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
