/** 
 * NEXUS DEX — CrossChainSwap.jsx
 * Chainflip native, two-tx atomic, fee in SOL.
 *
 * SOLANA-SIDE = pure public + free.
 *   • RPC: race of publicnode / drpc / ankr / mainnet-beta (Promise.any)
 *   • SOL price: lite-api.jup.ag/price/v3 (no key, no backend)
 *   • Honest balance state: per-source 'idle'|'loading'|'ok'|'fail'.
 *     UI shows '…' or 'RPC down' — never silent zero.
 *   • Sends broadcast to ALL public RPCs in parallel (more inclusion paths).
 *
 * CHAINFLIP-SIDE: still backed by /api/cf/* because the broker channel-open
 * step requires a registered on-chain broker (1000 FLIP bond + tx signing).
 * That cannot be done purely client-side without leaking broker keys.
 *
 * Flow (unchanged):
 *   1. /api/cf/quote    → REGULAR quote (egressAmount in dest atomic units)
 *   2. /api/cf/channel  → server opens deposit channel via SDK
 *   3. Two txs, signed atomically:
 *        Tx-A: 5% input-USD platform fee in SOL → FEE_WALLET
 *        Tx-B: bridge transfer to channel.depositAddress
 *   4. Send Tx-A, await confirm, then Tx-B. Status polls on depositChannelId.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// =====================================================================
// PUBLIC RPC POOL — no env vars, no proxy
// =====================================================================
const RPC_POOL = [
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
];
const CONNECTIONS = RPC_POOL.map(url => new Connection(url, { commitment: 'confirmed' }));

// Race a Connection-level call across the pool. `fn(conn)` is invoked once
// per pool entry; whichever resolves first wins. Rejects only if ALL fail.
async function raceConn(label, fn) {
  return Promise.any(CONNECTIONS.map(c => fn(c))).catch((agg) => {
    console.warn('[cc-rpc] ' + label + ' all RPCs failed', agg?.errors?.[0]?.message);
    const e = new Error(label + ': all public RPCs failed');
    e.aggregateErrors = agg?.errors;
    throw e;
  });
}

// Broadcast a signed raw tx to every RPC in parallel; resolve with the
// first accepted signature. More inclusion paths = better confirm odds on
// public infra. Rejects only if every RPC rejects.
async function raceSend(rawTx, sendOpts) {
  return Promise.any(CONNECTIONS.map(c => c.sendRawTransaction(rawTx, sendOpts)))
    .catch((agg) => {
      console.warn('[cc-rpc] send all RPCs rejected', agg?.errors?.[0]?.message);
      throw new Error(agg?.errors?.[0]?.message || 'All public RPCs rejected the transaction');
    });
}

// =====================================================================
// INLINE CSS — unchanged
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

.cc-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 4px}
.cc-brand{display:flex;align-items:center;gap:10px}
.cc-brand-dot{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4f7dff,#a87fff 60%,#7FFFD4);box-shadow:0 0 14px rgba(79,125,255,0.5)}
.cc-wordmark{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.cc-wordmark .slash{opacity:0.4;margin:0 3px;font-style:normal}
.cc-wordmark .grad{background:linear-gradient(90deg,#4f7dff,#a87fff,#7FFFD4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.cc-head-live{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border);font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--blue);letter-spacing:1.2px}
.cc-head-live .d{width:5px;height:5px;border-radius:50%;background:var(--blue);box-shadow:0 0 8px var(--blue);animation:cc-pulse 1.6s ease-in-out infinite}

.cc-mini-hero{padding:18px 22px 8px}
.cc-mh-eyebrow{display:inline-flex;align-items:center;gap:7px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--blue);letter-spacing:1.6px;margin-bottom:8px}
.cc-mh-title{font-family:"Instrument Serif",serif;font-weight:400;font-size:34px;line-height:1;letter-spacing:-.02em;margin:0 0 6px;color:var(--ink)}
.cc-mh-title em{font-style:italic;background:linear-gradient(120deg,#4f7dff,#a87fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.cc-mh-sub{font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}

.cc-card{margin:14px 22px 0;padding:18px;border-radius:24px;background:var(--glass);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.85);box-shadow:0 12px 40px rgba(79,125,255,.10)}

.cc-steps{display:flex;align-items:flex-start;gap:0;margin:0 -2px 16px}
.cc-step{display:flex;flex-direction:column;align-items:center;flex:0 0 auto;width:48px}
.cc-step-num{width:44px;height:44px;border-radius:16px;background:var(--glass-strong);border:1.5px solid var(--hairline);display:grid;place-items:center;font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1;color:var(--ink-3);transition:all .3s}
.cc-step.cc-step-active .cc-step-num{background:linear-gradient(135deg,#4f7dff,#a87fff);border-color:#4f7dff;color:#fff;animation:cc-glow 2s ease-in-out infinite}
.cc-step.cc-step-done .cc-step-num{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);border-color:#7FFFD4;color:var(--ink)}
.cc-step-label{margin-top:7px;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:0.8px;text-transform:uppercase;transition:color .3s}
.cc-step.cc-step-active .cc-step-label{color:var(--blue)}
.cc-step.cc-step-done .cc-step-label{color:var(--green)}
.cc-step-line{flex:1;height:2px;margin-top:21px;background:var(--hairline);border-radius:2px;transition:background .3s}
.cc-step-line.cc-step-line-done{background:linear-gradient(90deg,#7FFFD4,#A0E7FF)}

.cc-io-box{background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);border-radius:18px;padding:14px 16px;transition:border-color .15s,box-shadow .15s}
.cc-io-box:focus-within{border-color:var(--border-hi);box-shadow:0 0 0 4px rgba(79,125,255,.08)}
.cc-io-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.cc-io-label{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase}
.cc-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cc-io-bal{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:500}
.cc-io-bal-val{color:var(--ink);font-weight:700}
.cc-io-bal-val.cc-bal-loading{color:var(--ink-3)}
.cc-io-bal-val.cc-bal-fail{color:var(--red);font-weight:700}

.cc-io-row{display:flex;align-items:center;gap:10px}
.cc-token-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border:1px solid var(--border);border-radius:999px;color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0;transition:all .15s;box-shadow:0 2px 8px rgba(26,27,78,.06)}
.cc-token-btn:hover:not(:disabled){border-color:var(--blue);box-shadow:0 2px 12px rgba(79,125,255,.18)}
.cc-token-btn:active:not(:disabled){transform:translateY(1px)}
.cc-token-btn:disabled{cursor:not-allowed;opacity:.6}
.cc-token-sym{font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;letter-spacing:-.01em;color:var(--ink)}
.cc-token-caret{font-size:10px;color:var(--ink-3);margin-left:-2px}

.cc-io-input{flex:1;background:transparent;border:none;outline:none;font-family:"Instrument Serif",serif;font-size:34px;line-height:1;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums;min-width:0;width:100%}
.cc-io-input:disabled{opacity:.5}
.cc-io-input::placeholder{color:var(--ink-3)}
.cc-io-output{flex:1;text-align:right;font-family:"Instrument Serif",serif;font-size:34px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis}
.cc-io-output-loading{color:var(--ink-3);font-size:24px}
.cc-io-output-empty{color:var(--ink-3)}

.cc-max-btn{background:rgba(79,125,255,.10);border:1px solid var(--border);color:var(--blue);padding:6px 10px;border-radius:10px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.8px;flex-shrink:0;transition:all .15s}
.cc-max-btn:hover{background:rgba(79,125,255,.18)}
.cc-io-usd{text-align:right;margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500}

.cc-route-meta{margin-top:10px;padding-top:10px;border-top:1px dashed var(--hairline);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:600;letter-spacing:0.6px}
.cc-route-meta b{color:var(--ink);font-weight:700}
.cc-route-via{display:flex;align-items:center;gap:6px}
.cc-route-tag{padding:2px 7px;border-radius:5px;background:rgba(79,125,255,.10);border:1px solid var(--border);color:var(--blue);font-weight:700;letter-spacing:0.4px;text-transform:uppercase}

.cc-flip-wrap{display:flex;justify-content:center;margin:-12px 0;position:relative;z-index:3}
.cc-flip-arrow{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#fff,#F5F8FF);border:3px solid #EEF3FF;display:grid;place-items:center;font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1;box-shadow:0 6px 18px rgba(168,127,255,.18);transition:transform .3s}

.cc-chain-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:7px;font-family:"Space Grotesk",sans-serif;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase}
.cc-chain-badge-sm{padding:2px 7px;font-size:9px}
.cc-chain-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.cc-chain-badge-sm .cc-chain-dot{width:5px;height:5px}

.cc-dest{margin-top:12px}
.cc-dest-label{display:flex;align-items:center;gap:6px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px}
.cc-dest-chain{font-weight:700}
.cc-dest-input-wrap{position:relative}
.cc-dest-input{width:100%;padding:13px 42px 13px 14px;background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);border-radius:12px;color:var(--ink);font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;outline:none;transition:border-color .15s,box-shadow .15s}
.cc-dest-input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.cc-dest-input:disabled{opacity:.55}
.cc-dest-input::placeholder{color:var(--ink-3);font-weight:500}
.cc-dest-err{border-color:rgba(209,75,106,.5)}
.cc-dest-ok{border-color:rgba(127,255,212,.6)}
.cc-dest-check{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);display:grid;place-items:center;font-size:13px;font-weight:800}
.cc-dest-err-msg{margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--red);font-weight:600}

.cc-status{margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(79,125,255,.08);border:1px solid var(--border);display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--blue);font-family:"Space Grotesk",sans-serif}
.cc-spinner{width:14px;height:14px;border-radius:50%;flex-shrink:0;border:2px solid rgba(79,125,255,.20);border-top-color:var(--blue);animation:cc-spin .8s linear infinite}
.cc-warn{margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(255,176,136,.14);border:1px solid rgba(255,176,136,.45);font-size:12px;font-weight:600;color:#8a4a1d;font-family:"Space Grotesk",sans-serif}
.cc-error{margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.35);font-size:12px;font-weight:600;color:var(--red);font-family:"Space Grotesk",sans-serif}

.cc-success{margin-top:14px;padding:16px;border-radius:18px;text-align:center;background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));border:1px solid rgba(127,255,212,.45);animation:cc-rise .4s}
.cc-success-pending{background:linear-gradient(135deg,rgba(255,205,107,.18),rgba(255,176,136,.18));border-color:rgba(255,205,107,.45)}
.cc-success-fail{background:linear-gradient(135deg,rgba(209,75,106,.14),rgba(255,143,190,.14));border-color:rgba(209,75,106,.4)}
.cc-success-icon{font-size:24px;margin-bottom:4px;line-height:1}
.cc-success-title{font-family:"Instrument Serif",serif;font-size:18px;color:var(--ink);letter-spacing:-.01em;line-height:1.1}
.cc-success-pending .cc-success-title{color:#7a5400}
.cc-success-fail .cc-success-title{color:var(--red)}
.cc-success-sub{margin-top:4px;font-size:12px;color:var(--ink-2);font-weight:500}

.cc-cta{width:100%;margin-top:14px;padding:18px;border-radius:18px;border:none;font-family:"Instrument Serif",serif;font-size:19px;letter-spacing:-.01em;color:#fff;cursor:pointer;background:linear-gradient(135deg,#4f7dff,#a87fff);box-shadow:0 10px 28px rgba(79,125,255,.32),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .15s,box-shadow .15s,opacity .15s;position:relative;overflow:hidden;min-height:56px}
.cc-cta em{font-style:italic;opacity:.9;margin:0 4px}
.cc-cta:hover:not(.cc-cta-disabled){transform:translateY(-1px)}
.cc-cta:active:not(.cc-cta-disabled){transform:translateY(1px)}
.cc-cta-spinner{display:inline-block;margin-right:8px;animation:cc-spin .8s linear infinite}
.cc-cta-success{background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);box-shadow:0 10px 28px rgba(127,255,212,.32),inset 0 1px 0 rgba(255,255,255,.25)}
.cc-cta-error{background:rgba(209,75,106,.14);color:var(--red);border:1.5px solid rgba(209,75,106,.40);box-shadow:none}
.cc-cta-disabled{background:rgba(26,27,78,.06);color:var(--ink-3);border:1.5px solid var(--hairline);box-shadow:none;cursor:not-allowed}
.cc-cta-reset{background:rgba(79,125,255,.10);color:var(--blue);border:1.5px solid var(--border);box-shadow:none}
.cc-cta-reset:hover{background:rgba(79,125,255,.18)}

.cc-solscan-link{display:block;text-align:center;margin-top:10px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--blue);font-weight:700;text-decoration:none;letter-spacing:0.6px}
.cc-solscan-link:hover{text-decoration:underline}
.cc-footer-note{margin-top:14px;text-align:center;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:500;color:var(--ink-3);letter-spacing:0.6px}

.cc-token-img{border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(79,125,255,.06)}
.cc-token-fallback{border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,rgba(79,125,255,.18),rgba(168,127,255,.18));border:1px solid var(--border);display:grid;place-items:center;font-family:"Instrument Serif",serif;font-style:italic;color:var(--blue)}

.cc-modal-backdrop{position:fixed;inset:0;z-index:499;background:rgba(26,27,78,0.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.cc-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:500;width:94vw;max-width:440px;max-height:85dvh;display:flex;flex-direction:column;background:radial-gradient(ellipse at 20% 0%,#E4F2FF 0%,transparent 50%),radial-gradient(ellipse at 80% 0%,#F0E7FF 0%,transparent 50%),linear-gradient(180deg,#F5F8FF 0%,#EEF3FF 100%);border:1px solid rgba(255,255,255,.85);border-radius:24px;box-shadow:0 24px 80px rgba(26,27,78,.25);animation:cc-modal-in .25s cubic-bezier(.2,1.2,.4,1);overflow:hidden}
.cc-modal-to{max-width:460px;max-height:88dvh}
.cc-modal-head{padding:18px 18px 12px;border-bottom:1px solid var(--hairline)}
.cc-modal-head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cc-modal-title{font-family:"Instrument Serif",serif;font-size:22px;letter-spacing:-.015em;color:var(--ink);line-height:1}
.cc-modal-title em{font-style:italic;background:linear-gradient(120deg,#4f7dff,#a87fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.cc-modal-sub{font-size:11px;color:var(--ink-2);font-weight:500;margin-left:6px}
.cc-modal-close{width:34px;height:34px;border-radius:50%;background:var(--glass-strong);border:1px solid var(--border);color:var(--ink);font-size:18px;cursor:pointer;font-family:inherit;display:grid;place-items:center;transition:all .15s}
.cc-modal-close:hover{background:#fff;border-color:var(--blue)}

.cc-modal-search{width:100%;padding:11px 13px;background:var(--glass-strong);border:1.5px solid var(--border);border-radius:12px;color:var(--ink);font-family:inherit;font-size:13px;font-weight:500;outline:none;transition:border-color .15s,box-shadow .15s}
.cc-modal-search:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.cc-modal-search::placeholder{color:var(--ink-3)}

.cc-chain-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}
.cc-chain-chips::-webkit-scrollbar{display:none}
.cc-chain-chip{flex-shrink:0;padding:6px 12px;border-radius:999px;background:var(--glass);border:1px solid var(--border);color:var(--ink-2);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.4px;cursor:pointer;white-space:nowrap;transition:all .15s}
.cc-chain-chip:hover{border-color:var(--blue);color:var(--ink)}

.cc-modal-body{overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding-bottom:env(safe-area-inset-bottom)}
.cc-modal-loading,.cc-modal-empty{padding:28px;text-align:center;color:var(--ink-2);font-size:12.5px;font-weight:500}
.cc-modal-section{padding:12px 18px 6px;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:700;letter-spacing:1.4px;text-transform:uppercase}
.cc-modal-row{padding:12px 18px;cursor:pointer;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--hairline);transition:background .15s}
.cc-modal-row:last-child{border-bottom:none}
.cc-modal-row:hover{background:rgba(255,255,255,.5)}
.cc-modal-row-info{flex:1;min-width:0}
.cc-modal-row-sym{font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;color:var(--ink);letter-spacing:-.01em;line-height:1}
.cc-modal-row-name{font-size:11.5px;color:var(--ink-2);font-weight:500;margin-top:3px}
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

/* ─── CONFIG ─── */
const FEE_WALLET       = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS          = 500;            // 5% of input USD value, paid in SOL
const MIN_FEE_LAMPORTS = 1_000_000;      // floor: 0.001 SOL
const SOL_RESERVE      = 1_500_000;      // ~0.0015 SOL kept for tx fees
const QUOTE_DEBOUNCE   = 500;

const SOL_NATIVE_MINT  = 'So11111111111111111111111111111111111111112';
const USDC_SOL_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOL_MINT    = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const CF_SOURCES = [
  {
    asset:'SOL', chain:'Solana', symbol:'SOL', name:'Solana',
    decimals:9, mint:SOL_NATIVE_MINT, isNative:true, uiMin:0.05,
    logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  {
    asset:'USDC', chain:'Solana', symbol:'USDC', name:'USD Coin',
    decimals:6, mint:USDC_SOL_MINT, isNative:false, uiMin:5,
    logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  {
    asset:'USDT', chain:'Solana', symbol:'USDT', name:'Tether USD',
    decimals:6, mint:USDT_SOL_MINT, isNative:false, uiMin:5,
    logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
];

const CF_DESTS = [
  { chain:'Ethereum', name:'Ethereum', chainType:'EVM', color:'#627eea',
    assets:[
      { asset:'ETH',  symbol:'ETH',  name:'Ether',           decimals:18, logoURI:'https://assets.coingecko.com/coins/images/279/standard/ethereum.png' },
      { asset:'USDC', symbol:'USDC', name:'USD Coin',        decimals:6,  logoURI:'https://assets.coingecko.com/coins/images/6319/standard/usdc.png' },
      { asset:'USDT', symbol:'USDT', name:'Tether USD',      decimals:6,  logoURI:'https://assets.coingecko.com/coins/images/325/standard/Tether.png' },
      { asset:'WBTC', symbol:'WBTC', name:'Wrapped Bitcoin', decimals:8,  logoURI:'https://assets.coingecko.com/coins/images/7598/standard/wrapped_bitcoin_wbtc.png' },
      { asset:'FLIP', symbol:'FLIP', name:'Chainflip',       decimals:18, logoURI:'https://assets.coingecko.com/coins/images/29622/standard/Chainflip-FLIP-Logo-RGB-OnLight.png' },
    ],
  },
  { chain:'Arbitrum', name:'Arbitrum', chainType:'EVM', color:'#28a0f0',
    assets:[
      { asset:'ETH',  symbol:'ETH',  name:'Ether',      decimals:18, logoURI:'https://assets.coingecko.com/coins/images/279/standard/ethereum.png' },
      { asset:'USDC', symbol:'USDC', name:'USD Coin',   decimals:6,  logoURI:'https://assets.coingecko.com/coins/images/6319/standard/usdc.png' },
      { asset:'USDT', symbol:'USDT', name:'Tether USD', decimals:6,  logoURI:'https://assets.coingecko.com/coins/images/325/standard/Tether.png' },
    ],
  },
  { chain:'Bitcoin', name:'Bitcoin', chainType:'BTC', color:'#f7931a',
    assets:[
      { asset:'BTC', symbol:'BTC', name:'Bitcoin', decimals:8, logoURI:'https://assets.coingecko.com/coins/images/1/standard/bitcoin.png' },
    ],
  },
  { chain:'Polkadot', name:'Polkadot', chainType:'DOT', color:'#e6007a',
    assets:[
      { asset:'DOT', symbol:'DOT', name:'Polkadot', decimals:10, logoURI:'https://assets.coingecko.com/coins/images/12171/standard/polkadot.png' },
    ],
  },
  { chain:'Assethub', name:'Assethub', chainType:'DOT', color:'#aa5cdb',
    assets:[
      { asset:'SOL',  symbol:'SOL',  name:'Solana',     decimals:9, logoURI:'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
      { asset:'USDC', symbol:'USDC', name:'USD Coin',   decimals:6, logoURI:'https://assets.coingecko.com/coins/images/6319/standard/usdc.png' },
      { asset:'USDT', symbol:'USDT', name:'Tether USD', decimals:6, logoURI:'https://assets.coingecko.com/coins/images/325/standard/Tether.png' },
    ],
  },
  { chain:'Tron', name:'Tron', chainType:'TRX', color:'#ff060a',
    assets:[
      { asset:'TRX',  symbol:'TRX',  name:'Tronix',     decimals:6, logoURI:'https://assets.coingecko.com/coins/images/1094/standard/tron-logo.png' },
      { asset:'USDT', symbol:'USDT', name:'Tether USD', decimals:6, logoURI:'https://assets.coingecko.com/coins/images/325/standard/Tether.png' },
    ],
  },
];

const ALL_DESTS = CF_DESTS.flatMap(c =>
  c.assets.map(a => ({
    ...a,
    chain: c.chain, chainName: c.name, chainType: c.chainType, color: c.color,
    key: c.chain + ':' + a.asset,
  }))
);
const DEST_BY_KEY = Object.fromEntries(ALL_DESTS.map(d => [d.key, d]));

const DEFAULT_FROM = CF_SOURCES[0];
const DEFAULT_TO   = DEST_BY_KEY['Ethereum:ETH'];

/* ─── FORMATTERS (unchanged) ─── */
const trimZeros = v => String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
const decsForDisplay = n => {
  const v = +n;
  if (!Number.isFinite(v)) return 4;
  if (v === 0)  return 2;
  if (v < 1e-8) return 12;
  if (v < 1e-6) return 10;
  if (v < 0.01) return 8;
  if (v < 1)    return 6;
  return 4;
};
const fmtTok = n => {
  if (n == null || isNaN(n)) return '0';
  const v = +n;
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9)  return trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)  return trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
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

const isValidSolAddr = s =>
  !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

const validateDest = (addr, chainType) => {
  const a = String(addr || '').trim();
  if (!a) return 'Destination address required';
  if (chainType === 'EVM') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return 'Invalid EVM address (0x + 40 hex)';
  } else if (chainType === 'BTC') {
    if (!/^(bc1[a-z0-9]{20,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a)) return 'Invalid Bitcoin address';
  } else if (chainType === 'DOT') {
    if (!/^1[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(a)) return 'Invalid Polkadot/Assethub address (SS58)';
  } else if (chainType === 'TRX') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'Invalid Tron address (T + 33 chars)';
  } else if (chainType === 'SVM') {
    if (!isValidSolAddr(a)) return 'Invalid Solana address';
  }
  return null;
};

const destInputPlaceholder = (chainType) =>
  chainType === 'EVM'  ? '0x...'
: chainType === 'BTC'  ? 'bc1... / 1... / 3...'
: chainType === 'DOT'  ? '1... (SS58)'
: chainType === 'TRX'  ? 'T...'
: chainType === 'SVM'  ? 'Solana address'
:                        'Destination address';

const destExplorerUrl = (chain, txRef) => {
  if (!txRef) return null;
  const clean = String(txRef).replace(/^0x/, '');
  switch (chain) {
    case 'Ethereum': return 'https://etherscan.io/tx/0x' + clean;
    case 'Arbitrum': return 'https://arbiscan.io/tx/0x'  + clean;
    case 'Bitcoin':  return 'https://mempool.space/tx/'  + clean;
    case 'Polkadot': return 'https://polkadot.subscan.io/extrinsic/' + txRef;
    case 'Assethub': return 'https://assethub-polkadot.subscan.io/extrinsic/' + txRef;
    case 'Tron':     return 'https://tronscan.org/#/transaction/' + clean;
    case 'Solana':   return 'https://solscan.io/tx/' + txRef;
    default:         return null;
  }
};

const deriveStatusLabel = (status) => {
  if (!status?.state) return { label: 'Waiting for Chainflip to observe deposit…', done: false, failed: false };
  switch (String(status.state).toUpperCase()) {
    case 'WAITING':   return { label: 'Waiting for deposit on Solana…',     done: false, failed: false };
    case 'RECEIVING': return { label: 'Deposit detected · confirming…',     done: false, failed: false };
    case 'SWAPPING':  return { label: 'Swapping cross-chain via Chainflip…',done: false, failed: false };
    case 'SENDING':   return { label: 'Broadcasting on destination chain…', done: false, failed: false };
    case 'SENT':      return { label: 'Sent · awaiting block inclusion…',   done: false, failed: false };
    case 'COMPLETED': return { label: 'Arrived ✓',                          done: true,  failed: false };
    case 'FAILED':    return { label: 'Swap failed · refund in flight…',    done: true,  failed: true  };
    default:          return { label: 'In flight…',                         done: false, failed: false };
  }
};

const friendlyError = err => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('all public rpcs failed'))             return 'All public Solana RPCs are unreachable. Try again in a moment.';
  if (m.includes('below') && m.includes('minimum'))     return 'Amount below Chainflip minimum for this asset.';
  if (m.includes('above') && m.includes('maximum'))     return 'Amount above Chainflip maximum for this asset.';
  if (m.includes('insufficient sol') || m.includes('not enough sol')) return 'Not enough SOL in your wallet (need SOL for fees + reserve).';
  if (m.includes('insufficient') || m.includes('not enough')) return 'Insufficient balance for this swap.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled')) return 'Transaction cancelled.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Transaction expired. Please try again.';
  if (m.includes('slippage'))                           return 'Price moved too much. Try again.';
  if (m.includes('no route') || m.includes('no available') || m.includes('does not support')) return 'Chainflip does not support this route right now.';
  if (m.includes('liquidity'))                          return 'Not enough Chainflip liquidity right now — try a smaller amount.';
  if (m.includes('429') || m.includes('rate limit'))    return 'Too many requests — please wait a moment.';
  if (m.includes('timeout') || m.includes('timed out')) return 'Network is slow — please try again.';
  if (m.includes('account not') || m.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
  return err?.message || 'Swap failed. Please try again.';
};

/* ─── CHAINFLIP API ─── */
async function cfQuote({ src, dest, atomicAmount, signal }) {
  const p = new URLSearchParams({
    srcChain:  src.chain,
    srcAsset:  src.asset,
    destChain: dest.chain,
    destAsset: dest.asset,
    amount:    atomicAmount,
  });
  const r = await fetch('/api/cf/quote?' + p.toString(), { signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Quote failed (${r.status})`);
  if (!j.quote) throw new Error('Empty quote response');
  return j.quote;
}

async function cfChannel({ quote, destAddress, refundAddress }) {
  const r = await fetch('/api/cf/channel', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ quote, destAddress, refundAddress }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Channel open failed (${r.status})`);
  if (!j.channel?.depositAddress) throw new Error('No deposit address returned');
  return j.channel;
}

async function cfStatus(id) {
  try {
    const r = await fetch('/api/cf/status?id=' + encodeURIComponent(id));
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.status || null;
  } catch { return null; }
}

/* ─── SOL PRICE (public Jupiter lite-api) ─── */
let _solPriceCache = { p: 0, ts: 0 };
async function fetchSolPriceUsd() {
  const now = Date.now();
  if (now - _solPriceCache.ts < 30_000 && _solPriceCache.p > 0) return _solPriceCache.p;
  try {
    const r = await fetch('https://lite-api.jup.ag/price/v3?ids=' + SOL_NATIVE_MINT);
    if (!r.ok) return _solPriceCache.p || 0;
    const j = await r.json();
    const p = Number(j?.[SOL_NATIVE_MINT]?.usdPrice || 0);
    if (Number.isFinite(p) && p > 0) _solPriceCache = { p, ts: now };
    return _solPriceCache.p;
  } catch { return _solPriceCache.p || 0; }
}

function inputAmountUsd(src, inputAmount) {
  const v = Number(inputAmount);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (src.asset === 'USDC' || src.asset === 'USDT') return v;
  if (src.asset === 'SOL' && _solPriceCache.p > 0)  return v * _solPriceCache.p;
  return 0;
}

function computeSolFeeLamports(fromAmountUsd, solPriceUsd) {
  if (!fromAmountUsd || !solPriceUsd || fromAmountUsd <= 0 || solPriceUsd <= 0) return MIN_FEE_LAMPORTS;
  const feeUsd = fromAmountUsd * (FEE_BPS / 10000);
  const lamports = Math.floor((feeUsd / solPriceUsd) * LAMPORTS_PER_SOL);
  return Math.max(lamports, MIN_FEE_LAMPORTS);
}

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
  useEffect(() => { setErr(false); }, [token?.logoURI]);
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
    <div className="cc-token-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>{ch}</div>
  );
};

const ChainBadge = ({ chain, name, color, small = false }) => {
  if (!chain && !name) return null;
  const c = color || '#4f7dff';
  return (
    <div
      className={'cc-chain-badge' + (small ? ' cc-chain-badge-sm' : '')}
      style={{ background: c + '1f', color: c }}
    >
      <div className="cc-chain-dot" style={{ background: c }}/>
      {name || chain}
    </div>
  );
};

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

const FromTokenModal = ({ open, onClose, onSelect }) => {
  const close = useCallback(() => onClose(), [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);
  if (!open) return null;
  return (
    <>
      <div onClick={close} className="cc-modal-backdrop"/>
      <div className="cc-modal cc-modal-from">
        <div className="cc-modal-head">
          <div className="cc-modal-head-row">
            <div className="cc-modal-title">From <em>solana</em></div>
            <button onClick={close} className="cc-modal-close">✕</button>
          </div>
        </div>
        <div className="cc-modal-body">
          <div className="cc-modal-section">Chainflip-supported on Solana</div>
          {CF_SOURCES.map((t, i) => (
            <div
              key={t.asset + i}
              onClick={() => { onSelect(t); close(); }}
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

const ToTokenModal = ({ open, onClose, onSelect }) => {
  const [q, setQ]     = useState('');
  const [sel, setSel] = useState('all');
  const close = useCallback(() => { setQ(''); setSel('all'); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);

  const chainChips = useMemo(() =>
    ['all', ...CF_DESTS.map(c => c.chain)]
  , []);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = sel === 'all' ? ALL_DESTS : ALL_DESTS.filter(d => d.chain === sel);
    if (!t) return base;
    return base.filter(d =>
      d.symbol.toLowerCase().includes(t) ||
      d.name.toLowerCase().includes(t)   ||
      d.chain.toLowerCase().includes(t)
    );
  }, [q, sel]);

  if (!open) return null;
  return (
    <>
      <div onClick={close} className="cc-modal-backdrop"/>
      <div className="cc-modal cc-modal-to">
        <div className="cc-modal-head">
          <div className="cc-modal-head-row">
            <div className="cc-modal-title">To <em>any chain</em></div>
            <button onClick={close} className="cc-modal-close">✕</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search asset or chain…"
            className="cc-modal-search"
          />
          <div className="cc-chain-chips">
            {chainChips.map(id => {
              const active = sel === id;
              const dest   = CF_DESTS.find(c => c.chain === id);
              const color  = id === 'all' ? '#4f7dff' : (dest?.color || '#9b8fc0');
              const name   = id === 'all' ? 'All' : (dest?.name || id);
              return (
                <button
                  key={id}
                  onClick={() => setSel(id)}
                  className="cc-chain-chip"
                  style={active ? { borderColor: color, background: color + '22', color } : undefined}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="cc-modal-body">
          {list.length === 0 && <div className="cc-modal-empty">No matches</div>}
          {list.map((t) => (
            <div
              key={t.key}
              onClick={() => { onSelect(t); close(); }}
              className="cc-modal-row"
            >
              <TokenIcon token={t} size={30}/>
              <div className="cc-modal-row-info">
                <div className="cc-modal-row-sym">{t.symbol}</div>
                <div className="cc-modal-row-name cc-truncate">{t.name}</div>
              </div>
              <ChainBadge chain={t.chain} name={t.chainName} color={t.color} small/>
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

  // useConnection() removed — we own a public RPC pool above (CONNECTIONS).
  const { publicKey, signAllTransactions, connected } = useWallet();
  const pubkey = publicKey || null;
  const wcon   = !!connected && !!pubkey;

  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken,   setToToken]   = useState(DEFAULT_TO);
  const [fromAmt,   setFromAmt]   = useState('');
  const [destAddr,  setDestAddr]  = useState('');
  const [destAddrTouched, setDestAddrTouched] = useState(false);
  const [addrErr,   setAddrErr]   = useState('');

  const [quote,    setQuote]    = useState(null);
  const [quoting,  setQuoting]  = useState(false);
  const [quoteErr, setQuoteErr] = useState('');

  const [step,      setStep]      = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [swapErr,   setSwapErr]   = useState('');
  const [txSig,     setTxSig]     = useState(null);

  const [channelId,    setChannelId]    = useState(null);
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [egressTxRef,  setEgressTxRef]  = useState(null);
  const [bridgeMeta,   setBridgeMeta]   = useState(null);

  const [solBalance,   setSolBalance]   = useState(null);   // lamports
  const [tokenBalance, setTokenBalance] = useState(null);   // ui units of fromToken (when SPL)
  // Per-balance honesty: 'idle' | 'loading' | 'ok' | 'fail'.
  const [solBalStatus,   setSolBalStatus]   = useState('idle');
  const [tokenBalStatus, setTokenBalStatus] = useState('idle');
  const [solPrice,     setSolPrice]     = useState(0);

  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen,   setToOpen]   = useState(false);

  const reqIdRef = useRef(0);

  // SOL price — every 30s.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const p = await fetchSolPriceUsd();
      if (alive && p > 0) setSolPrice(p);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Wallet balances — raced across the public RPC pool, honest per-call status.
  useEffect(() => {
    if (!pubkey) {
      setSolBalance(null); setTokenBalance(null);
      setSolBalStatus('idle'); setTokenBalStatus('idle');
      return;
    }
    let cancelled = false;

    setSolBalStatus('loading');
    raceConn('getBalance', c => c.getBalance(pubkey, 'confirmed'))
      .then(b => { if (!cancelled) { setSolBalance(b); setSolBalStatus('ok'); } })
      .catch(() => { if (!cancelled) { setSolBalance(null); setSolBalStatus('fail'); } });

    if (fromToken?.mint && !fromToken.isNative) {
      setTokenBalStatus('loading');
      const mintPk = new PublicKey(fromToken.mint);
      raceConn('tokenAccs', c => c.getParsedTokenAccountsByOwner(pubkey, { mint: mintPk }, 'confirmed'))
        .then(a => {
          if (cancelled) return;
          const ui = a.value.length ? Number(a.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0) : 0;
          setTokenBalance(ui);
          setTokenBalStatus('ok');
        })
        .catch(() => { if (!cancelled) { setTokenBalance(null); setTokenBalStatus('fail'); } });
    } else {
      setTokenBalance(null);
      setTokenBalStatus('idle');
    }
    return () => { cancelled = true; };
  }, [pubkey, fromToken, step]);

  // Display balance for the FROM token + its status.
  const fbd = useMemo(() => {
    if (!fromToken) return null;
    if (fromToken.isNative) return solBalance != null ? solBalance / LAMPORTS_PER_SOL : null;
    return tokenBalance;
  }, [fromToken, solBalance, tokenBalance]);

  const fbdStatus = fromToken?.isNative ? solBalStatus : tokenBalStatus;

  // Live address validation.
  useEffect(() => {
    if (!destAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateDest(destAddr, toToken.chainType) || '');
  }, [destAddr, toToken]);

  // Persist destination address per dest chain.
  const destLsKey = useMemo(() => 'cf:cc:dest:' + (toToken?.chainType || ''), [toToken]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(destLsKey);
      if (saved && !validateDest(saved, toToken.chainType)) setDestAddr(saved);
      else setDestAddr('');
      setDestAddrTouched(false);
    } catch { setDestAddr(''); }
  }, [destLsKey, toToken]);
  useEffect(() => {
    if (destAddr && !validateDest(destAddr, toToken.chainType)) {
      try { window.localStorage.setItem(destLsKey, destAddr); } catch {}
    }
  }, [destAddr, destLsKey, toToken]);

  // Debounced quote.
  const fetchQuote = useCallback(async () => {
    setQuoteErr('');
    const n = Number(fromAmt);
    if (!fromAmt || !Number.isFinite(n) || n <= 0) { setQuote(null); return; }
    if (n < (fromToken.uiMin || 0)) { setQuote(null); setQuoteErr(`Minimum ${fromToken.uiMin} ${fromToken.symbol}`); return; }
    const myReq = ++reqIdRef.current;
    setQuoting(true);
    try {
      const atomicAmount = toRaw(fromAmt, fromToken.decimals);
      if (!atomicAmount || atomicAmount === '0') { setQuote(null); setQuoting(false); return; }
      const q = await cfQuote({ src: fromToken, dest: toToken, atomicAmount });
      if (myReq !== reqIdRef.current) return;

      const egressUi = Number(q.egressAmount) / Math.pow(10, toToken.decimals);
      const inputUsd = inputAmountUsd(fromToken, fromAmt);
      const sp = solPrice || _solPriceCache.p || 0;
      const feeLamports = computeSolFeeLamports(inputUsd, sp);

      setQuote({
        cf:           q,
        egressUi,
        egressDisplay: fmtTok(egressUi),
        durationSec:  Number(q.estimatedDurationSeconds) || null,
        slippagePct:  Number(q.recommendedSlippageTolerancePercent ?? 1),
        atomicAmount,
        inputUsd,
        feeLamports,
        feeSOL:       feeLamports / LAMPORTS_PER_SOL,
        feeUSD:       sp ? (feeLamports / LAMPORTS_PER_SOL) * sp : null,
        fetchedAt:    Date.now(),
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (myReq === reqIdRef.current) { setQuote(null); setQuoteErr(friendlyError(e)); }
    } finally {
      if (myReq === reqIdRef.current) setQuoting(false);
    }
  }, [fromAmt, fromToken, toToken, solPrice]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  // MAX.
  const onMax = useCallback(() => {
    if (fbd == null || fbd <= 0) return;
    const dec = Math.min(fromToken.decimals, 9);
    if (fromToken.isNative) {
      const reserveLamports = SOL_RESERVE + MIN_FEE_LAMPORTS;
      setFromAmt(fmtInput(Math.max(0, (solBalance - reserveLamports)) / LAMPORTS_PER_SOL, dec));
    } else {
      setFromAmt(fmtInput(fbd, dec));
    }
  }, [fbd, fromToken, solBalance]);

  // SOL shortfall — only meaningful when we KNOW the SOL balance.
  const solShortfall = useMemo(() => {
    if (!quote) return null;
    if (solBalStatus !== 'ok' || solBalance == null) return null;
    const need = quote.feeLamports + SOL_RESERVE;
    if (fromToken.isNative) {
      const inputLamports = Math.floor(Number(fromAmt) * LAMPORTS_PER_SOL);
      const total = inputLamports + quote.feeLamports + SOL_RESERVE;
      return solBalance < total ? (total - solBalance) : 0;
    }
    return solBalance < need ? (need - solBalance) : 0;
  }, [quote, solBalance, solBalStatus, fromToken, fromAmt]);

  // Status polling once channel is open.
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    let done = false;

    const tick = async () => {
      if (!alive) return;
      const status = await cfStatus(channelId);
      if (!alive) return;
      const derived = deriveStatusLabel(status);
      setBridgeStatus(derived);
      const ref = status?.swapEgress?.txRef || status?.refundEgress?.txRef;
      if (ref) setEgressTxRef(ref);
      if (derived.done) done = true;
    };

    tick();
    const id = setInterval(() => { if (done) { clearInterval(id); return; } tick(); }, 6_000);
    const stopAt = setTimeout(() => { alive = false; clearInterval(id); }, 30 * 60_000);
    return () => { alive = false; clearInterval(id); clearTimeout(stopAt); };
  }, [channelId]);

  const execute = useCallback(async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    const addrError = validateDest(destAddr, toToken.chainType);
    if (addrError) { setAddrErr(addrError); setDestAddrTouched(true); return; }
    if (!quote)    { setSwapErr('No route. Wait for routing.'); return; }
    if (!signAllTransactions) {
      setSwapErr('Wallet does not support signing multiple transactions. Use Phantom or Solflare.');
      return;
    }
    if (solShortfall && solShortfall > 0) {
      setSwapErr(`Not enough SOL — need ~${(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet.`);
      return;
    }

    setStep(1);
    setSwapErr('');
    setStatusMsg('Refreshing route…');
    setTxSig(null);
    setChannelId(null);
    setBridgeStatus(null);
    setEgressTxRef(null);
    setBridgeMeta(null);

    try {
      // Fresh quote — stale quotes can drift past slippage tolerance.
      const freshQuote = await cfQuote({
        src:          fromToken,
        dest:         toToken,
        atomicAmount: quote.atomicAmount,
      });

      setStatusMsg('Opening Chainflip deposit channel…');
      const channel = await cfChannel({
        quote:         freshQuote,
        destAddress:   destAddr.trim(),
        refundAddress: pubkey.toString(),
      });
      const depositAddress = new PublicKey(channel.depositAddress);

      setStatusMsg('Building transactions…');
      const { blockhash, lastValidBlockHeight } = await raceConn(
        'getLatestBlockhash',
        c => c.getLatestBlockhash('confirmed'),
      );

      const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
      const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });

      // Tx A: platform fee in SOL → FEE_WALLET.
      const feeMsg = new TransactionMessage({
        payerKey:        pubkey,
        recentBlockhash: blockhash,
        instructions: [
          cuLimitIx, priorityIx,
          SystemProgram.transfer({
            fromPubkey: pubkey,
            toPubkey:   FEE_WALLET,
            lamports:   Number(quote.feeLamports),
          }),
        ],
      }).compileToV0Message();
      const feeTx = new VersionedTransaction(feeMsg);

      // Tx B: bridge transfer to Chainflip deposit address.
      let bridgeIx;
      if (fromToken.isNative) {
        bridgeIx = SystemProgram.transfer({
          fromPubkey: pubkey,
          toPubkey:   depositAddress,
          lamports:   Number(quote.atomicAmount),
        });
      } else {
        // SPL source: TransferChecked from user ATA → Chainflip's deposit
        // channel token account. depositAddress may be the token account
        // itself or an owner pubkey — detect at runtime via getAccountInfo.
        const mint    = new PublicKey(fromToken.mint);
        const userAta = getAssociatedTokenAddressSync(mint, pubkey);

        setStatusMsg('Resolving Chainflip deposit account…');
        let destTokenAccount = depositAddress;
        try {
          const info = await raceConn(
            'getAccountInfo(deposit)',
            c => c.getAccountInfo(depositAddress, 'confirmed'),
          );
          const isAta =
            info &&
            info.owner.equals(TOKEN_PROGRAM_ID) &&
            info.data?.length === 165;
          if (!isAta) {
            destTokenAccount = getAssociatedTokenAddressSync(mint, depositAddress, true);
          }
        } catch {
          // If all RPCs fail to return account info, fall back to deriving
          // the ATA — safe assumption matching wallet UX.
          destTokenAccount = getAssociatedTokenAddressSync(mint, depositAddress, true);
        }

        bridgeIx = createTransferCheckedInstruction(
          userAta,
          mint,
          destTokenAccount,
          pubkey,
          BigInt(quote.atomicAmount),
          fromToken.decimals,
          [],
          TOKEN_PROGRAM_ID,
        );
      }
      const bridgeMsg = new TransactionMessage({
        payerKey:        pubkey,
        recentBlockhash: blockhash,
        instructions: [cuLimitIx, priorityIx, bridgeIx],
      }).compileToV0Message();
      const bridgeTx = new VersionedTransaction(bridgeMsg);

      setStep(2);
      setStatusMsg('Confirm in your wallet…');
      const [signedFee, signedBridge] = await signAllTransactions([feeTx, bridgeTx]);

      setStep(3);
      setStatusMsg('Sending fee transaction…');
      // Race-send: broadcast to all RPCs in parallel, first accepted wins.
      const feeSig = await raceSend(signedFee.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });

      setStatusMsg('Confirming fee…');
      const feeConfirm = await raceConn(
        'confirmTransaction(fee)',
        c => c.confirmTransaction({ signature: feeSig, blockhash, lastValidBlockHeight }, 'confirmed'),
      );
      if (feeConfirm?.value?.err) throw new Error('Fee transaction failed — bridge not sent.');

      setStatusMsg('Sending bridge transaction…');
      const bridgeSig = await raceSend(signedBridge.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      setTxSig(bridgeSig);

      // Don't wait for full bridge confirmation — Chainflip status polling
      // takes over from here.
      setChannelId(channel.depositChannelId);
      setBridgeMeta({
        chain:     toToken.chain,
        chainName: toToken.chainName,
        color:     toToken.color,
        symbol:    toToken.symbol,
      });
      setBridgeStatus({ label: 'Bridge tx submitted · Chainflip observing…', done: false, failed: false });

      setStep(4);
      setStatusMsg('');
      setFromAmt('');
      setQuote(null);
    } catch (e) {
      console.error('[CrossChain CF]', e);
      setSwapErr(friendlyError(e));
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 6000);
    }
  }, [
    wcon, destAddr, toToken, fromToken, quote, signAllTransactions,
    pubkey, onConnectWallet, solShortfall,
  ]);

  const reset = useCallback(() => {
    setStep(0); setStatusMsg(''); setSwapErr(''); setTxSig(null);
    setChannelId(null); setBridgeStatus(null); setEgressTxRef(null);
    setBridgeMeta(null);
    setFromAmt(''); setQuote(null); setQuoteErr('');
  }, []);

  /* ─── DERIVED ─── */
  const n          = Number(fromAmt) || 0;
  const inputUsd   = inputAmountUsd(fromToken, fromAmt);
  const busy       = step > 0 && step < 4 && step !== -1;
  const isSuccess  = step === 4;
  const isError    = step === -1;
  const addrValid  = !!destAddr && !addrErr;
  const solscan    = txSig ? 'https://solscan.io/tx/' + txSig : null;
  const destExplorer = destExplorerUrl(bridgeMeta?.chain || toToken.chain, egressTxRef);

  const destUsd = useMemo(() => {
    if (!quote) return 0;
    if (toToken.asset === 'USDC' || toToken.asset === 'USDT') return quote.egressUi;
    return null;
  }, [quote, toToken]);

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1)   return 'Refreshing…';
    if (step === 2)   return 'Sign in Wallet…';
    if (step === 3)   return 'Bridging…';
    if (isSuccess)    return 'Submitted ✓';
    if (isError)      return 'Try Again';
    if (!fromAmt)     return 'Enter Amount';
    if (n < (fromToken.uiMin || 0)) return `Min ${fromToken.uiMin} ${fromToken.symbol}`;
    if (!destAddr.trim())   return `Enter ${toToken.chain} address`;
    if (addrErr)            return 'Invalid Address';
    if (!quote)             return quoting ? 'Quoting Chainflip…' : 'No Route';
    if (solShortfall)       return 'Need more SOL';
    return null;
  };

  // Block the button only when we KNOW there's a shortfall or balance issue.
  // If balance status is loading/fail, let the user try — chain will decide.
  const btnDisabled = busy ||
    (wcon && (!fromAmt
      || n < (fromToken.uiMin || 0)
      || !destAddr.trim()
      || !!addrErr
      || (!quote && !isError && !isSuccess)
      || (solShortfall != null && solShortfall > 0)
    ));

  const btnClass = () => {
    if (isSuccess)  return 'cc-cta cc-cta-success';
    if (isError)    return 'cc-cta cc-cta-error';
    if (btnDisabled && wcon) return 'cc-cta cc-cta-disabled';
    return 'cc-cta';
  };

  const labelOverride = btnLabel();

  // Honest balance display.
  const renderBal = () => {
    if (fbdStatus === 'loading' || fbdStatus === 'idle') {
      return <span className="cc-io-bal">Bal: <span className="cc-io-bal-val cc-bal-loading">…</span></span>;
    }
    if (fbdStatus === 'fail') {
      return <span className="cc-io-bal" title="All public Solana RPCs declined the balance lookup">Bal: <span className="cc-io-bal-val cc-bal-fail">RPC down</span></span>;
    }
    if (fbd != null) {
      return <span className="cc-io-bal">Bal: <span className="cc-io-bal-val">{fmtTok(fbd)}</span></span>;
    }
    return null;
  };

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
          <div className="cc-head-live"><span className="d"/>CHAINFLIP</div>
        </div>

        <div className="cc-mini-hero">
          <div className="cc-mh-eyebrow">∞ NATIVE · NO WRAPS</div>
          <h1 className="cc-mh-title">Move it <em>anywhere.</em></h1>
          <div className="cc-mh-sub">Real assets, native on every chain. Auto-refund if a swap can't fill — no stuck funds.</div>
        </div>

        <div className="cc-card">
          <StepProgress step={step}/>

          {/* FROM */}
          <div className="cc-io-box">
            <div className="cc-io-head">
              <span className="cc-io-label">You Send</span>
              <div className="cc-io-meta">
                <ChainBadge chain="Solana" name="Solana" color="#14f195" small/>
                {renderBal()}
              </div>
            </div>
            <div className="cc-io-row">
              <button
                onClick={() => !busy && setFromOpen(true)}
                className="cc-token-btn"
                disabled={busy}
              >
                <TokenIcon token={fromToken} size={22}/>
                <span className="cc-token-sym">{fromToken.symbol}</span>
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
              {fbdStatus === 'ok' && fbd > 0 && !busy && (<button onClick={onMax} className="cc-max-btn">MAX</button>)}
            </div>
            {inputUsd > 0 && (<div className="cc-io-usd">≈ {fmtUsd(inputUsd)}</div>)}
          </div>

          <div className="cc-flip-wrap"><div className="cc-flip-arrow">↓</div></div>

          {/* TO */}
          <div className="cc-io-box">
            <div className="cc-io-head">
              <span className="cc-io-label">You Receive (est.)</span>
              <ChainBadge chain={toToken.chain} name={toToken.chainName} color={toToken.color} small/>
            </div>
            <div className="cc-io-row">
              <button
                onClick={() => !busy && setToOpen(true)}
                className="cc-token-btn"
                disabled={busy}
              >
                <TokenIcon token={toToken} size={22}/>
                <span className="cc-token-sym">{toToken.symbol}</span>
                {!busy && <span className="cc-token-caret">▾</span>}
              </button>
              <div className={'cc-io-output' + ((!quote && !quoting) ? ' cc-io-output-empty' : '')}>
                {quoting ? <span className="cc-io-output-loading">…</span> : (quote?.egressDisplay || '0')}
              </div>
            </div>
            {destUsd != null && destUsd > 0 && (<div className="cc-io-usd">≈ {fmtUsd(destUsd)}</div>)}
            {quote && (
              <div className="cc-route-meta">
                <span className="cc-route-via">via <span className="cc-route-tag">Chainflip</span></span>
                <span>
                  <b>{quote.slippagePct.toFixed(2)}%</b> slip
                  {quote.durationSec ? <> · <b>~{Math.max(1, Math.ceil(quote.durationSec / 60))} min</b></> : null}
                </span>
              </div>
            )}
          </div>

          {/* DESTINATION ADDRESS */}
          <div className="cc-dest">
            <div className="cc-dest-label">
              DESTINATION · <span className="cc-dest-chain" style={{ color: toToken.color }}>
                {toToken.chainName?.toUpperCase()}
              </span>
            </div>
            <div className="cc-dest-input-wrap">
              <input
                value={destAddr}
                onChange={e => { if (!busy) setDestAddr(e.target.value.trim()); }}
                onBlur={() => setDestAddrTouched(true)}
                placeholder={destInputPlaceholder(toToken.chainType)}
                disabled={busy}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={'cc-dest-input' + (addrErr && destAddrTouched ? ' cc-dest-err' : addrValid ? ' cc-dest-ok' : '')}
              />
              {addrValid && (<div className="cc-dest-check">✓</div>)}
            </div>
            {addrErr && destAddrTouched && <div className="cc-dest-err-msg">{addrErr}</div>}
          </div>

          {quoteErr && !quote && (<div className="cc-warn">{quoteErr}</div>)}

          {solShortfall > 0 && quote && (
            <div className="cc-warn">
              You need ~{(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet to cover swap + fee.
            </div>
          )}

          {/* Surface RPC-down for source balance — important before signing. */}
          {wcon && fbdStatus === 'fail' && (
            <div className="cc-warn">
              Couldn't fetch your {fromToken.symbol} balance — all public Solana RPCs declined the lookup. You can still try the swap; the chain will reject if balance is insufficient.
            </div>
          )}

          {statusMsg && busy && (
            <div className="cc-status"><div className="cc-spinner"/>{statusMsg}</div>
          )}

          {swapErr && (<div className="cc-error">{swapErr}</div>)}

          {channelId && bridgeStatus && !bridgeStatus.done && (
            <div className="cc-status" style={{ marginTop: 14 }}>
              <div className="cc-spinner"/>
              <span>{bridgeStatus.label}</span>
            </div>
          )}

          {isSuccess && (
            <div className={
              'cc-success' +
              (bridgeStatus?.failed ? ' cc-success-fail' :
               bridgeStatus?.done && !bridgeStatus.failed ? '' :
               ' cc-success-pending')
            }>
              <div className="cc-success-icon">
                {bridgeStatus?.failed ? '⚠️' : bridgeStatus?.done ? '🎉' : '⏳'}
              </div>
              <div className="cc-success-title">
                {bridgeStatus?.failed ? 'Refund in flight' :
                 bridgeStatus?.done   ? 'Arrived on ' + (bridgeMeta?.chainName || 'destination') :
                                        'Chainflip is bridging…'}
              </div>
              <div className="cc-success-sub">
                {bridgeStatus?.failed
                  ? 'Funds will return to your Solana wallet.'
                  : (quote?.durationSec
                      ? `Funds arrive in ~${Math.max(1, Math.ceil(quote.durationSec / 60))} min`
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
                <>Bridge {fromToken.symbol} <em>→</em> {toToken.symbol}</>
              )}
            </button>
          ) : (
            <button onClick={reset} className="cc-cta cc-cta-reset">New Bridge</button>
          )}

          {txSig && solscan && (
            <a href={solscan} target="_blank" rel="noreferrer" className="cc-solscan-link">View deposit on Solscan ↗</a>
          )}
          {destExplorer && (
            <a href={destExplorer} target="_blank" rel="noreferrer" className="cc-solscan-link">View arrival on {bridgeMeta?.chainName || 'destination chain'} ↗</a>
          )}

          <p className="cc-footer-note">Non-custodial · Chainflip native · Auto-refund · Solana origin</p>
        </div>
      </div>

      <FromTokenModal
        open={fromOpen}
        onClose={() => setFromOpen(false)}
        onSelect={t => { setFromToken(t); setQuote(null); setFromAmt(''); }}
      />
      <ToTokenModal
        open={toOpen}
        onClose={() => setToOpen(false)}
        onSelect={t => { setToToken(t); setQuote(null); }}
      />
    </div>
  );
}
