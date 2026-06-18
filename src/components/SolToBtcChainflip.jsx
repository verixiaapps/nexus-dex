/**
 * NEXUS · SolToBtcChainflip.jsx
 * SOL → Native BTC via Chainflip (single-signature, two-tx atomic flow).
 *
 * Same Wonderland-lite identity as SolToBtc.jsx.
 *
 * Chainflip flow:
 *   - quote   → /api/chainflip/quote?amount=<lamports>
 *   - channel → /api/chainflip/channel  (POST quote+addrs)
 *   - status  → /api/chainflip/status?id=<depositChannelId>
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionMessage,
} from '@solana/web3.js';

// =====================================================================
// INLINE CSS — Wonderland-lite · identical to SolToBtc.jsx
// =====================================================================
const STBTC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

.ax-page{
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
.ax-page,.ax-page *{box-sizing:border-box}

@keyframes ax-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes ax-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes ax-spin{to{transform:rotate(360deg)}}
@keyframes ax-rate-glow{0%,100%{box-shadow:0 12px 40px rgba(79,125,255,.12)}50%{box-shadow:0 12px 40px rgba(79,125,255,.22)}}
@keyframes ax-tick{0%{opacity:0;transform:translateY(2px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ax-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.ax-page{
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
.ax-blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:0.42;animation:ax-drift 14s ease-in-out infinite;pointer-events:none;z-index:0}
.ax-emblem{
  position:absolute;font-family:"Instrument Serif",serif;font-style:italic;font-weight:400;
  pointer-events:none;user-select:none;z-index:1;line-height:1;
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  opacity:0.08;animation:ax-drift 18s ease-in-out infinite;
}
.ax-inner{position:relative;z-index:5}

.ax-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 4px}
.ax-brand{display:flex;align-items:center;gap:10px}
.ax-brand-dot{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4f7dff,#a87fff 60%,#7FFFD4);box-shadow:0 0 14px rgba(79,125,255,0.5)}
.ax-wordmark{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.ax-wordmark .slash{opacity:0.4;margin:0 3px;font-style:normal}
.ax-wordmark .grad{background:linear-gradient(90deg,#4f7dff,#a87fff,#7FFFD4);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ax-head-live{
  display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border);
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--blue);letter-spacing:1.2px;
}
.ax-head-live .d{width:5px;height:5px;border-radius:50%;background:var(--blue);box-shadow:0 0 8px var(--blue);animation:ax-pulse 1.6s ease-in-out infinite}

.ax-mini-hero{padding:18px 22px 8px}
.ax-mh-eyebrow{display:inline-flex;align-items:center;gap:7px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--blue);letter-spacing:1.6px;margin-bottom:8px}
.ax-mh-title{font-family:"Instrument Serif",serif;font-weight:400;font-size:34px;line-height:1;letter-spacing:-.02em;margin:0 0 6px;color:var(--ink)}
.ax-mh-title em{font-style:italic;background:linear-gradient(120deg,#4f7dff,#a87fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ax-mh-sub{font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}

.ax-rate-card{
  margin:14px 22px 0;padding:18px 20px 16px;border-radius:24px;
  background:var(--glass-strong);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.85);
  position:relative;overflow:hidden;animation:ax-rate-glow 4s ease-in-out infinite;
}
.ax-rate-card::before{
  content:'';position:absolute;inset:0;border-radius:24px;padding:1.5px;
  background:linear-gradient(135deg,rgba(79,125,255,.45),transparent 40%,transparent 60%,rgba(168,127,255,.45));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.8;
}
.ax-rate-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.ax-rate-label{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase}
.ax-rate-live{display:flex;align-items:center;gap:5px;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--green);letter-spacing:1px}
.ax-rate-live .d{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ax-pulse 1.4s ease-in-out infinite}
.ax-rate-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.ax-rate-from{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700;color:var(--ink-2);letter-spacing:0.4px}
.ax-rate-arrow{font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1}
.ax-rate-val{
  font-family:"Instrument Serif",serif;font-style:italic;font-size:44px;line-height:1;letter-spacing:-.025em;
  background:linear-gradient(120deg,#4f7dff,#a87fff 70%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  font-variant-numeric:tabular-nums;animation:ax-tick .3s ease-out;
}
.ax-rate-to{font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--ink);line-height:1}
.ax-rate-usd{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500;letter-spacing:0.3px}
.ax-rate-usd b{color:var(--ink);font-weight:700}

.ax-kyc{margin:14px 22px 0;display:flex;align-items:center;justify-content:center;gap:14px;padding:9px 14px;border-radius:100px;background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border)}
.ax-kyc span{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-2);white-space:nowrap}
.ax-kyc .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--blue);opacity:.7}

.ax-card{margin:14px 22px 0;padding:18px;border-radius:24px;background:var(--glass);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.85);box-shadow:0 12px 40px rgba(79,125,255,.10)}

.ax-io{background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);border-radius:18px;padding:14px 16px;transition:border-color .15s,box-shadow .15s}
.ax-io:focus-within{border-color:var(--border-hi);box-shadow:0 0 0 4px rgba(79,125,255,.08)}
.ax-io-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.ax-io-label{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase}
.ax-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ax-io-bal{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:500}
.ax-io-bal-val{color:var(--ink);font-weight:700}
.ax-io-bal-err{color:var(--red);font-weight:700}
.ax-io-row{display:flex;align-items:center;gap:10px}

.ax-tok-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border:1px solid var(--border);border-radius:999px;color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;flex-shrink:0;box-shadow:0 2px 8px rgba(26,27,78,.06)}
.ax-tok-sym{font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;letter-spacing:-.01em;color:var(--ink)}
.ax-tok-dot-sol{width:20px;height:20px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#9945ff,#14f195);box-shadow:inset 0 -2px 4px rgba(0,0,0,.15),0 0 6px rgba(153,69,255,.3)}
.ax-tok-dot-btc{width:20px;height:20px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%,#ffb84d,#f7931a 50%,#cc6e00);box-shadow:inset 0 -2px 4px rgba(0,0,0,.15),0 0 6px rgba(247,147,26,.3)}

.ax-amt{flex:1;background:transparent;border:none;outline:none;font-family:"Instrument Serif",serif;font-size:34px;line-height:1;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums;min-width:0;width:100%}
.ax-amt:disabled{opacity:.5}
.ax-amt::placeholder{color:var(--ink-3)}
.ax-amt.out{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.ax-max{background:rgba(79,125,255,.10);border:1px solid var(--border);color:var(--blue);padding:6px 10px;border-radius:10px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:0.8px;flex-shrink:0;transition:all .15s}
.ax-max:hover:not(:disabled){background:rgba(79,125,255,.18)}
.ax-max:disabled{opacity:.4;cursor:not-allowed}
.ax-io-usd{text-align:right;margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500}

.ax-flip-wrap{display:flex;justify-content:center;margin:-12px 0;position:relative;z-index:3}
.ax-flip-arrow{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#fff,#F5F8FF);border:3px solid #EEF3FF;display:grid;place-items:center;font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1;box-shadow:0 6px 18px rgba(168,127,255,.18)}

.ax-tag{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:6px;text-transform:uppercase;color:var(--blue);background:rgba(79,125,255,.10);border:1px solid var(--border)}

.ax-addr-wrap{margin-top:12px}
.ax-addr-label{display:flex;align-items:center;justify-content:space-between;gap:6px;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px}
.ax-addr-status{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:1px}
.ax-addr-input-wrap{position:relative}
.ax-addr-input{width:100%;padding:13px 42px 13px 14px;background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);border-radius:12px;color:var(--ink);font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;outline:none;transition:border-color .15s,box-shadow .15s}
.ax-addr-input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.ax-addr-input:disabled{opacity:.55}
.ax-addr-input::placeholder{color:var(--ink-3);font-weight:500}
.ax-addr-input.invalid{border-color:rgba(209,75,106,.5)}
.ax-addr-check{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);display:grid;place-items:center;font-size:13px;font-weight:800}
.ax-addr-hint{margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);font-weight:600;letter-spacing:0.6px}
.ax-addr-hint.err{color:var(--red)}

.ax-route{margin-top:12px;padding:12px 14px;border-radius:14px;background:rgba(79,125,255,.05);border:1px dashed var(--border-hi)}
.ax-route-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-family:"JetBrains Mono",monospace;font-size:11px}
.ax-route-row .k{color:var(--ink-2);font-weight:600;letter-spacing:0.4px}
.ax-route-row .v{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.ax-route-row .v.blue{color:var(--blue)}
.ax-route-row .v.btc{color:#cc6e00}

.ax-banner{margin-top:14px;padding:12px 14px;border-radius:14px;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;font-family:"Space Grotesk",sans-serif}
.ax-banner.info{background:rgba(79,125,255,.08);border:1px solid var(--border);color:var(--blue)}
.ax-banner.err{background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.35);color:var(--red)}
.ax-banner.ok{background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));border:1px solid rgba(127,255,212,.45);color:var(--green);animation:ax-rise .4s}
.ax-spinner{width:14px;height:14px;border-radius:50%;flex-shrink:0;border:2px solid rgba(79,125,255,.20);border-top-color:var(--blue);animation:ax-spin .8s linear infinite}

.ax-cta{
  width:100%;margin-top:14px;padding:18px;border-radius:18px;border:none;
  font-family:"Instrument Serif",serif;font-size:19px;letter-spacing:-.01em;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  box-shadow:0 10px 28px rgba(79,125,255,.32),inset 0 1px 0 rgba(255,255,255,.25);
  transition:transform .15s,box-shadow .15s,opacity .15s;position:relative;overflow:hidden;min-height:56px;
}
.ax-cta em{font-style:italic;opacity:.9;margin:0 4px}
.ax-cta:hover:not(:disabled){transform:translateY(-1px)}
.ax-cta:active:not(:disabled){transform:translateY(1px)}
.ax-cta:disabled{background:rgba(26,27,78,.06);color:var(--ink-3);border:1.5px solid var(--hairline);box-shadow:none;cursor:not-allowed}

.ax-cta-footer{margin-top:14px;text-align:center;font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:500;color:var(--ink-3);letter-spacing:0.6px}

.ax-powered{margin:14px 22px 0;display:flex;align-items:center;justify-content:center;gap:9px;padding:12px 16px;border-radius:14px;background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--border)}
.ax-powered-label{font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--ink-3);font-weight:700;letter-spacing:1.4px;text-transform:uppercase}
.ax-powered-name{font-family:"Instrument Serif",serif;font-style:italic;font-size:15px;letter-spacing:-.01em;background:linear-gradient(90deg,#4f7dff,#a87fff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ax-powered-sep{color:var(--ink-3);font-size:9px;opacity:.5}
`;

// =====================================================================
// CONFIG
// =====================================================================
const FEE_WALLET    = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const PLATFORM_BPS  = 300;
const MIN_SOL       = 0.2;
const MAX_SOL       = 50;

const LAMPORTS_PER_SOL = 1_000_000_000;
const SATS_PER_BTC     = 1e8;
const MAX_RESERVE_LAMPORTS = 10_000_000;

// ── RPC ──────────────────────────────────────────────────────────────
// Same-origin server proxy → Alchemy mainnet. The server (server.js)
// holds the Alchemy API key and forwards via /api/solana-rpc. All
// Connection instances in this file route through the proxy.
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';
const BAL_COMMITMENT = 'processed';


const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};

// Single-RPC wrapper. Same `(label, op) => Promise` signature so all
// existing rpcRace(...) call sites work unchanged.
const rpcRace = (label, op, commitment = 'confirmed') => {
  return op(getConn(commitment)).catch(e => {
    console.warn(`[rpc] ${label} failed:`, e?.message);
    throw new Error(`${label}: RPC failed`);
  });
};

// =====================================================================
// UTILS
// =====================================================================
const fmtUsd = (n, d = 2) => {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
};
const fmtBtc = (n, d = 8) => {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  return Number(n).toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
};
const cleanAmount = v => {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
};
const isValidBtcAddr = addr => {
  if (!addr || typeof addr !== 'string') return false;
  const s = addr.trim();
  if (/^bc1p[a-z0-9]{6,87}$/i.test(s)) return true;
  if (/^bc1[a-z0-9]{6,87}$/i.test(s))  return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(s)) return true;
  return false;
};

async function fetchWithTimeout(url, opts = {}, timeoutMs = 14_000) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(id); }
}

async function fetchJupPrice(mint) {
  try {
    const url = `https://lite-api.jup.ag/price/v3?ids=${mint}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 6_000);
    if (!res.ok) return 0;
    const json = await res.json();
    const entry = Object.values(json || {})[0];
    const p = Number(entry?.usdPrice);
    return Number.isFinite(p) && p > 0 ? p : 0;
  } catch { return 0; }
}
const fetchBtcPrice = () => fetchJupPrice('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const fetchSolPrice = () => fetchJupPrice('So11111111111111111111111111111111111111112');

const LS_KEY_BTC = 'soltobtc:lastBtcAddr';
const ls = {
  get: k => { try { return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); } catch { /* noop */ } },
};

// ===== Chainflip API calls — all same-origin /api/chainflip/* =====

async function cfQuote({ lamports }) {
  const res = await fetchWithTimeout(
    `/api/chainflip/quote?amount=${lamports.toString()}`,
    { headers: { Accept: 'application/json' } },
    14_000,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || `Quote failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (!json.quote) throw new Error('Empty quote response');
  return json.quote;
}

async function cfChannel({ quote, destAddress, refundAddress }) {
  const res = await fetchWithTimeout(
    '/api/chainflip/channel',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ quote, destAddress, refundAddress }),
    },
    20_000,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || `Channel open failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (!json.channel?.depositAddress) throw new Error('No deposit address returned');
  return json.channel;
}

async function cfStatus(id) {
  try {
    const res = await fetchWithTimeout(
      `/api/chainflip/status?id=${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json' } },
      10_000,
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.status || null;
  } catch { return null; }
}

function deriveStatusLabel(status) {
  if (!status || typeof status !== 'object') return { label: 'Waiting for Chainflip to observe deposit…', done: false };
  const s = String(status.state || '').toUpperCase();
  switch (s) {
    case 'WAITING':     return { label: 'Waiting for deposit to land on Solana…',       done: false };
    case 'RECEIVING':   return { label: 'Deposit detected · confirming on Solana…',     done: false };
    case 'SWAPPING':    return { label: 'Confirmed · swapping SOL → BTC…',              done: false };
    case 'SENDING':     return { label: 'Broadcasting BTC to your wallet…',             done: false };
    case 'SENT':        return { label: 'BTC sent · awaiting Bitcoin confirmation…',    done: false };
    case 'COMPLETED':   return { label: 'Sent BTC ✓ Check your wallet',                 done: true  };
    case 'FAILED':      return { label: 'Swap failed · refund processing on Solana…',   done: true  };
    default:            return { label: 'In flight…',                                   done: false };
  }
}

function useStbtcCSS() {
  useEffect(() => {
    const id = 'nexus-stbtc-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = STBTC_CSS;
    document.head.appendChild(el);
  }, []);
}

// =====================================================================
// MAIN
// =====================================================================
export default function SolToBtcChainflip({ onConnectWallet }) {
  useStbtcCSS();

  const { publicKey, connected, signAllTransactions } = useWallet();

  // Single connection — independent of app-level ConnectionProvider.
  const connection = useMemo(() => getConn('confirmed'), []);

  const [solAmount, setSolAmount] = useState('');
  const [btcAddr,   setBtcAddr]   = useState(() => {
    const saved = ls.get(LS_KEY_BTC);
    return saved && isValidBtcAddr(saved) ? saved : '';
  });
  const [btcAddrTouched, setBtcAddrTouched] = useState(false);
  const [quote,     setQuote]     = useState(null);
  const [quoting,   setQuoting]   = useState(false);
  const [error,     setError]     = useState('');
  const [submit,    setSubmit]    = useState({ kind: 'idle', message: '' });
  const [btcPrice,  setBtcPrice]  = useState(0);
  const [solPrice,  setSolPrice]  = useState(0);

  // BALANCE — honest state. 'idle' | 'loading' | 'ok' | 'fail'
  const [solBalance, setSolBalance] = useState(null);
  const [balStatus,  setBalStatus]  = useState('idle');

  const [channelId,     setChannelId]     = useState(null);
  const [bridgeStatus,  setBridgeStatus]  = useState(null);

  const quoteSeq = useRef(0);

  // Live prices.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [b, s] = await Promise.all([fetchBtcPrice(), fetchSolPrice()]);
      if (!alive) return;
      if (b > 0) setBtcPrice(b);
      if (s > 0) setSolPrice(s);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // SOL balance — uses proxied RPC. Sets 'fail' if the endpoint rejects.
  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setSolBalance(null);
      setBalStatus('idle');
      return;
    }
    setBalStatus('loading');
    try {
      const lamports = await rpcRace('getBalance', c => c.getBalance(publicKey, 'confirmed'));
      setSolBalance(lamports);
      setBalStatus('ok');
    } catch (e) {
      console.warn('[sol→btc cf] balance failed', e?.message);
      setBalStatus('fail');
    }
  }, [publicKey]);

  useEffect(() => {
    refreshBalance();
    if (!publicKey) return;
    const id = setInterval(refreshBalance, 30_000);
    return () => clearInterval(id);
  }, [publicKey, refreshBalance]);

  // Persist BTC address when valid.
  useEffect(() => {
    if (btcAddr && isValidBtcAddr(btcAddr)) ls.set(LS_KEY_BTC, btcAddr);
  }, [btcAddr]);

  // Quote.
  useEffect(() => {
    const n = parseFloat(solAmount);
    if (!Number.isFinite(n) || n <= 0)     { setQuote(null); return; }
    if (n < MIN_SOL || n > MAX_SOL)        { setQuote(null); return; }

    const userHasAddr = isValidBtcAddr(btcAddr);
    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');

    const t = setTimeout(async () => {
      try {
        const grossLamports    = BigInt(Math.round(n * LAMPORTS_PER_SOL));
        const platformLamports = (grossLamports * BigInt(PLATFORM_BPS)) / 10000n;
        const swapLamports     = grossLamports - platformLamports;
        if (swapLamports <= 0n) throw new Error('Amount too small');

        const cf = await cfQuote({ lamports: swapLamports });
        if (seq !== quoteSeq.current) return;
        setQuote({
          cf,
          grossLamports,
          platformLamports,
          swapLamports,
          isPreview: !userHasAddr,
          fetchedAt: Date.now(),
        });
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setError(e.message || 'Quote failed');
        setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [solAmount, btcAddr]);

  // Status polling.
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
      if (derived.done) done = true;
    };

    tick();
    const id = setInterval(() => {
      if (done) { clearInterval(id); return; }
      tick();
    }, 6_000);

    const stopAt = setTimeout(() => { alive = false; clearInterval(id); }, 30 * 60_000);
    return () => { alive = false; clearInterval(id); clearTimeout(stopAt); };
  }, [channelId]);

  const isBusy    = submit.kind === 'loading';
  const isSuccess = submit.kind === 'success';

  const n = parseFloat(solAmount) || 0;
  const stakeValid = n >= MIN_SOL && n <= MAX_SOL;
  const addrValid  = isValidBtcAddr(btcAddr);
  const usdEquiv   = solPrice > 0 ? n * solPrice : 0;
  const balanceSol = solBalance != null ? solBalance / LAMPORTS_PER_SOL : null;
  const balanceKnown = balStatus === 'ok';

  const expectedSats   = quote?.cf?.egressAmount ? Number(quote.cf.egressAmount) : 0;
  const expectedBtc    = expectedSats / SATS_PER_BTC;
  const expectedBtcUsd = expectedBtc * btcPrice;

  const liveSolToBtc = (solPrice > 0 && btcPrice > 0) ? solPrice / btcPrice : 0;
  const dispSlippage = Number(quote?.cf?.recommendedSlippageTolerancePercent ?? 3);

  const handleMax = () => {
    if (solBalance == null) return;
    const usable = Math.max(0, solBalance - MAX_RESERVE_LAMPORTS);
    const sol = usable / LAMPORTS_PER_SOL;
    if (sol < MIN_SOL) setSolAmount(MIN_SOL.toString());
    else if (sol > MAX_SOL) setSolAmount(MAX_SOL.toString());
    else setSolAmount(sol.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  };

  const handleSubmit = async () => {
    if (!connected) { onConnectWallet?.(); return; }
    if (!publicKey || !signAllTransactions) { setError('Wallet not ready'); return; }
    if (!quote || quote.isPreview) { setError('Enter a valid BTC address'); return; }
    if (!addrValid) { setError('Invalid BTC address'); return; }

    // Only enforce client-side balance check when we actually know it.
    if (balanceKnown) {
      const TX_FEE_RESERVE = 500_000n;
      const totalNeeded = BigInt(quote.platformLamports) + BigInt(quote.swapLamports) + TX_FEE_RESERVE;
      if (solBalance != null && BigInt(solBalance) < totalNeeded) {
        setError('Not enough SOL for swap + tx fees');
        return;
      }
    }

    setError('');
    setChannelId(null);
    setBridgeStatus(null);
    setSubmit({ kind: 'loading', message: 'Refreshing route…' });

    try {
      const freshQuote = await cfQuote({ lamports: quote.swapLamports });

      setSubmit({ kind: 'loading', message: 'Opening deposit channel…' });
      const channel = await cfChannel({
        quote:         freshQuote,
        destAddress:   btcAddr,
        refundAddress: publicKey.toString(),
      });
      const vault = new PublicKey(channel.depositAddress);
      const owner = publicKey;

      setSubmit({ kind: 'loading', message: 'Building transactions…' });
      const { blockhash, lastValidBlockHeight } = await rpcRace(
        'getLatestBlockhash',
        c => c.getLatestBlockhash('confirmed'),
      );

      const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const cuLimitIx  = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });

      const feeMsg = new TransactionMessage({
        payerKey:        owner,
        recentBlockhash: blockhash,
        instructions: [
          cuLimitIx,
          priorityIx,
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey:   FEE_WALLET,
            lamports:   Number(quote.platformLamports),
          }),
        ],
      }).compileToV0Message();
      const feeTx = new VersionedTransaction(feeMsg);

      const bridgeMsg = new TransactionMessage({
        payerKey:        owner,
        recentBlockhash: blockhash,
        instructions: [
          cuLimitIx,
          priorityIx,
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey:   vault,
            lamports:   Number(quote.swapLamports),
          }),
        ],
      }).compileToV0Message();
      const bridgeTx = new VersionedTransaction(bridgeMsg);

      setSubmit({ kind: 'loading', message: 'Confirm in your wallet…' });
      const [signedFee, signedBridge] = await signAllTransactions([feeTx, bridgeTx]);

      setSubmit({ kind: 'loading', message: 'Sending fee tx…' });
      const feeSerialized = signedFee.serialize();
      const feeSig = await rpcRace('sendFee', c => c.sendRawTransaction(feeSerialized, {
        skipPreflight: false, maxRetries: 3,
      }));

      setSubmit({ kind: 'loading', message: 'Confirming fee…' });
      const feeConfirm = await connection.confirmTransaction(
        { signature: feeSig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (feeConfirm?.value?.err) throw new Error('Fee tx failed — bridge not sent');

      setSubmit({ kind: 'loading', message: 'Sending bridge tx…' });
      const bridgeSerialized = signedBridge.serialize();
      const sig = await rpcRace('sendBridge', c => c.sendRawTransaction(bridgeSerialized, {
        skipPreflight: false, maxRetries: 3,
      }));

      console.log('[sol→btc cf] fee', feeSig, 'bridge', sig, 'channel', channel.depositChannelId);

      setChannelId(channel.depositChannelId);
      setBridgeStatus({ label: 'Bridge submitted · waiting for Chainflip to observe…', done: false });
      setSubmit({ kind: 'success', message: `Submitted · ${sig.slice(0, 8)}…` });

      setSolAmount(''); setQuote(null);
      setTimeout(() => { setSubmit({ kind: 'idle', message: '' }); refreshBalance(); }, 6000);
    } catch (e) {
      console.error('[sol→btc cf]', e);
      const msg = e.message || 'Transaction failed';
      setSubmit({
        kind: 'error',
        message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg,
      });
      setTimeout(() => setSubmit({ kind: 'idle', message: '' }), 5000);
    }
  };

  // Balance display — honest.
  const renderBalanceMeta = () => {
    if (!connected) {
      return <span className="ax-io-bal">Min <span className="ax-io-bal-val">{MIN_SOL}</span> · Max <span className="ax-io-bal-val">{MAX_SOL}</span></span>;
    }
    if (balStatus === 'loading' || balStatus === 'idle') {
      return <span className="ax-io-bal">Balance: <span className="ax-io-bal-val">…</span></span>;
    }
    if (balStatus === 'fail') {
      return <span className="ax-io-bal">Balance: <span className="ax-io-bal-err">RPC unreachable</span></span>;
    }
    return <span className="ax-io-bal">Balance: <span className="ax-io-bal-val">{balanceSol != null ? balanceSol.toFixed(4) : '0'}</span> SOL</span>;
  };

  return (
    <div className="ax-page">
      <div className="ax-blob" style={{ width: 380, height: 380, background: '#A0E7FF', top: -100, right: -120 }}/>
      <div className="ax-blob" style={{ width: 420, height: 420, background: '#B794F6', top: '35%', left: -160, animationDelay: '3s' }}/>
      <div className="ax-blob" style={{ width: 300, height: 300, background: '#FFE8F4', bottom: '10%', right: -80, animationDelay: '6s' }}/>

      <div className="ax-emblem" style={{ fontSize: 280, top: -40, left: -60, transform: 'rotate(-12deg)' }}>₿</div>
      <div className="ax-emblem" style={{ fontSize: 180, top: '42%', right: -30, transform: 'rotate(15deg)', animationDelay: '4s' }}>₿</div>
      <div className="ax-emblem" style={{ fontSize: 220, bottom: '8%', left: -40, transform: 'rotate(-8deg)', animationDelay: '8s' }}>₿</div>

      <div className="ax-inner">
        <div className="ax-head">
          <div className="ax-brand">
            <div className="ax-brand-dot"/>
            <span className="ax-wordmark">native<span className="slash">//</span><span className="grad">bitcoin</span></span>
          </div>
          <div className="ax-head-live"><span className="d"/>CHAINFLIP</div>
        </div>

        <div className="ax-mini-hero">
          <div className="ax-mh-eyebrow">⟁ NO KYC · NO WRAPS</div>
          <h1 className="ax-mh-title">Get native <em>Bitcoin.</em></h1>
          <div className="ax-mh-sub">Real BTC straight to your wallet. Not synthetic.</div>
        </div>

        <div className="ax-rate-card">
          <div className="ax-rate-top">
            <span className="ax-rate-label">Live Rate</span>
            <div className="ax-rate-live">
              <span className="d"/>BTC {btcPrice > 0 ? fmtUsd(btcPrice, 0) : '—'}
            </div>
          </div>
          <div className="ax-rate-main">
            <span className="ax-rate-from">1 SOL</span>
            <span className="ax-rate-arrow">→</span>
            <span className="ax-rate-val">{liveSolToBtc > 0 ? liveSolToBtc.toFixed(5) : '—'}</span>
            <span className="ax-rate-to">BTC</span>
          </div>
          <div className="ax-rate-usd">
            <b>{solPrice > 0 ? fmtUsd(solPrice, 2) : '—'}</b> per SOL · ~5 min delivery
          </div>
        </div>

        <div className="ax-kyc">
          <span>No KYC</span><span className="dot"/>
          <span>No Account</span><span className="dot"/>
          <span>No Limits</span>
        </div>

        <div className="ax-card">
          <div className="ax-io">
            <div className="ax-io-head">
              <span className="ax-io-label">You Send</span>
              <div className="ax-io-meta">{renderBalanceMeta()}</div>
            </div>
            <div className="ax-io-row">
              <div className="ax-tok-btn">
                <div className="ax-tok-dot-sol"/>
                <span className="ax-tok-sym">SOL</span>
              </div>
              <input
                className="ax-amt"
                value={solAmount}
                onChange={e => { setSolAmount(cleanAmount(e.target.value)); setError(''); }}
                placeholder="0.00"
                disabled={isBusy}
                inputMode="decimal"
              />
              {connected && balanceSol != null && balanceSol >= MIN_SOL && !isBusy && balStatus === 'ok' && (
                <button type="button" className="ax-max" onClick={handleMax}>MAX</button>
              )}
            </div>
            {usdEquiv > 0 && (<div className="ax-io-usd">≈ {fmtUsd(usdEquiv, 2)}</div>)}
          </div>

          <div className="ax-flip-wrap"><div className="ax-flip-arrow">↓</div></div>

          <div className="ax-io">
            <div className="ax-io-head">
              <span className="ax-io-label">You Receive (Native BTC)</span>
              {quoting
                ? <span className="ax-tag">QUOTING…</span>
                : quote?.isPreview
                  ? <span className="ax-tag">PREVIEW RATE</span>
                  : <span className="ax-tag">NATIVE L1</span>}
            </div>
            <div className="ax-io-row">
              <div className="ax-tok-btn">
                <div className="ax-tok-dot-btc"/>
                <span className="ax-tok-sym">BTC</span>
              </div>
              <div className="ax-amt out">{expectedBtc > 0 ? fmtBtc(expectedBtc, 8) : '0.00'}</div>
            </div>
            {expectedBtcUsd > 0 && (<div className="ax-io-usd">≈ {fmtUsd(expectedBtcUsd, 2)}</div>)}
          </div>

          <div className="ax-addr-wrap">
            <div className="ax-addr-label">
              <span>Your BTC Address</span>
              <span
                className="ax-addr-status"
                style={{ color: addrValid ? 'var(--green)' : (btcAddrTouched && btcAddr ? 'var(--red)' : 'var(--ink-3)') }}
              >
                {addrValid ? '✓ VALID' : (btcAddrTouched && btcAddr ? '✗ INVALID' : 'BC1… / 1… / 3…')}
              </span>
            </div>
            <div className="ax-addr-input-wrap">
              <input
                className={'ax-addr-input' + (btcAddrTouched && btcAddr && !addrValid ? ' invalid' : '')}
                value={btcAddr}
                onChange={e => setBtcAddr(e.target.value.trim())}
                onBlur={() => setBtcAddrTouched(true)}
                placeholder="bc1q…"
                disabled={isBusy}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {addrValid && <div className="ax-addr-check">✓</div>}
            </div>
            <div className={'ax-addr-hint' + (btcAddrTouched && btcAddr && !addrValid ? ' err' : '')}>
              {btcAddrTouched && btcAddr && !addrValid
                ? 'Address format not recognized'
                : 'Native Bitcoin only · No Lightning · No Wrapped'}
            </div>
          </div>

          {quote && (
            <div className="ax-route">
              <div className="ax-route-row"><span className="k">You send</span><span className="v">{n.toFixed(4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Bridged</span><span className="v">{(Number(quote.swapLamports)/LAMPORTS_PER_SOL).toFixed(4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Route</span><span className="v blue">Chainflip · Native L1</span></div>
              <div className="ax-route-row"><span className="k">Max slippage</span><span className="v">{dispSlippage.toFixed(2)}%</span></div>
              {quote.cf?.estimatedDurationSeconds != null && (
                <div className="ax-route-row"><span className="k">Est. delivery</span><span className="v">~{Math.max(1, Math.round(Number(quote.cf.estimatedDurationSeconds) / 60))} min</span></div>
              )}
              <div className="ax-route-row"><span className="k">You receive</span><span className="v btc">{fmtBtc(expectedBtc, 8)} BTC</span></div>
            </div>
          )}

          {isBusy && submit.message && (
            <div className="ax-banner info"><div className="ax-spinner"/><span>{submit.message}</span></div>
          )}
          {(error || submit.kind === 'error') && (
            <div className="ax-banner err">{error || submit.message}</div>
          )}
          {isSuccess && !bridgeStatus && (
            <div className="ax-banner ok">✓ {submit.message}</div>
          )}
          {channelId && bridgeStatus && (
            <div className={'ax-banner ' + (bridgeStatus.done ? 'ok' : 'info')}>
              {!bridgeStatus.done && <div className="ax-spinner"/>}
              <span>{bridgeStatus.label}</span>
            </div>
          )}

          {!connected ? (
            <button onClick={() => onConnectWallet?.()} className="ax-cta">Connect Wallet</button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isBusy || !quote || quote.isPreview || !stakeValid || !addrValid}
              className="ax-cta"
            >
              {isBusy ? 'Processing…' :
               isSuccess ? 'Submitted ✓' :
               !stakeValid ? `Enter ${MIN_SOL}–${MAX_SOL} SOL` :
               !addrValid ? 'Enter BTC address' :
               !quote || quote.isPreview ? (quoting ? 'Getting quote…' : 'No quote') :
               <>Bridge {n.toFixed(4)} SOL <em>→</em> BTC</>}
            </button>
          )}

          <div className="ax-cta-footer">One signature · Two txs · Native BTC via Chainflip</div>
        </div>

        <div className="ax-powered">
          <span className="ax-powered-label">Powered by</span>
          <span className="ax-powered-name">Chainflip</span>
          <span className="ax-powered-sep">·</span>
          <span className="ax-powered-label">Native Bitcoin</span>
        </div>
      </div>
    </div>
  );
}
