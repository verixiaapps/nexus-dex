/**
 * NEXUS · SolToBtcChainflip.jsx
 * SOL → Native BTC via Chainflip (single-signature, single-tx atomic flow).
 *
 * Fee model — ADDITIVE:
 *   User enters X SOL → the FULL X SOL bridges to BTC (user receives BTC
 *   priced off X SOL). On top, 3% of X SOL is charged separately to the
 *   user's wallet and routed to FEE_WALLET. Total wallet debit = X × 1.03.
 *
 * Chainflip flow:
 *   - quote   → /api/chainflip/quote?amount=<lamports>
 *   - channel → /api/chainflip/channel  (POST quote+addrs, slippage hint 3%)
 *   - status  → /api/chainflip/status?id=<depositChannelId>
 *
 * Submit flow (one tx, sim-then-sign):
 *   1. Reuse the existing quote (NO refetch, NO requote).
 *   2. Open Chainflip deposit channel.
 *   3. Build a single VersionedTransaction containing both:
 *        ix-1: platform fee (3% of bridge amount) in SOL → FEE_WALLET
 *        ix-2: full bridge transfer to channel.depositAddress
 *   4. Simulate the EXACT tx we're about to sign.
 *   5. Hand the same tx to signAllTransactions([tx]).
 *   6. Send raw, then poll getSignatureStatuses (decoupled from blockhash).
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
  --ink:#0a0a0a; --ink-2:#6b6b6b; --ink-3:#9a9a9a;
  --blue:#2f6bff; --violet:#2f6bff;
  --mint:#16a34a; --sky:#2f6bff; --lav:#2f6bff;
  --pink:#e0364f; --peach:#e8820c; --gold:#e8820c;
  --green:#16a34a; --red:#e0364f;
  --glass:#ffffff; --glass-strong:#fafafa;
  --border:#e4e4e7;
  --border-hi:#0a0a0a;
  --hairline:#efeff1;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink);
}
.ax-page,.ax-page *{box-sizing:border-box}

@keyframes ax-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes ax-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes ax-spin{to{transform:rotate(360deg)}}
@keyframes ax-rate-glow{0%,100%{box-shadow:none}50%{box-shadow:none}}
@keyframes ax-tick{0%{opacity:0;transform:translateY(2px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ax-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.ax-page{
  position:relative;min-height:100dvh;min-height:100dvh;
  max-width:520px;margin:0 auto;width:100%;
  padding:0 0 calc(env(safe-area-inset-bottom) + 80px);
  border-radius:0;overflow-x:hidden;
  background:#ffffff;
}
.ax-blob{display:none !important}
.ax-emblem{display:none !important}
.ax-inner{position:relative;z-index:5}

.ax-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid var(--hairline)}
.ax-brand{display:flex;align-items:center;gap:9px}
.ax-brand-dot{width:26px;height:26px;border-radius:8px;background:#0a0a0a;box-shadow:none}
.ax-wordmark{font-family:inherit;font-style:normal;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.ax-wordmark .slash{opacity:0.3;margin:0 4px;font-style:normal;font-weight:500}
.ax-wordmark .grad{background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink-2);font-weight:700}
.ax-head-live{
  display:flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;
  background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--border);
  font-family:inherit;font-size:10px;font-weight:700;color:var(--ink);letter-spacing:.6px;
}
.ax-head-live .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none;animation:ax-pulse 1.6s ease-in-out infinite}

/* description line (replaces hero) */
.ax-desc{padding:14px 18px 4px;font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}
.ax-desc b{color:var(--ink);font-weight:700}

/* legacy hero classes kept harmless */
.ax-mini-hero{padding:14px 18px 4px}
.ax-mh-eyebrow{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.6px;margin-bottom:6px}
.ax-mh-title{font-family:inherit;font-weight:700;font-size:22px;line-height:1.1;letter-spacing:-.02em;margin:0 0 6px;color:var(--ink)}
.ax-mh-title em{font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.ax-mh-sub{font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}

.ax-rate-card{
  margin:12px 16px 0;padding:15px 16px 14px;border-radius:16px;
  background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--hairline);
  position:relative;overflow:hidden;animation:none;
}
.ax-rate-card::before{display:none}
.ax-rate-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.ax-rate-label{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.4px;text-transform:uppercase}
.ax-rate-live{display:flex;align-items:center;gap:5px;font-family:inherit;font-size:11px;font-weight:700;color:var(--green);letter-spacing:.2px}
.ax-rate-live .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:none;animation:ax-pulse 1.4s ease-in-out infinite}
.ax-rate-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:5px}
.ax-rate-from{font-family:inherit;font-size:13px;font-weight:700;color:var(--ink-2);letter-spacing:0}
.ax-rate-arrow{font-family:inherit;font-style:normal;font-size:18px;color:var(--ink-3);line-height:1}
.ax-rate-val{
  font-family:ui-monospace,Menlo,monospace;font-style:normal;font-size:38px;font-weight:700;line-height:1;letter-spacing:-.03em;
  background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink);
  font-variant-numeric:tabular-nums;animation:ax-tick .3s ease-out;
}
.ax-rate-to{font-family:inherit;font-style:normal;font-size:20px;font-weight:700;color:var(--ink);line-height:1}
.ax-rate-usd{font-family:inherit;font-size:11px;color:var(--ink-2);font-weight:500;letter-spacing:0}
.ax-rate-usd b{color:var(--ink);font-weight:700}

.ax-kyc{margin:12px 16px 0;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 14px;border-radius:999px;background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--hairline)}
.ax-kyc span{font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-2);white-space:nowrap}
.ax-kyc .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--ink-3);opacity:1}

.ax-card{margin:12px 16px 0;padding:16px;border-radius:18px;background:#fff;backdrop-filter:none;border:1px solid var(--hairline);box-shadow:0 1px 2px rgba(10,10,10,.04)}

.ax-io{background:var(--glass-strong);border:1px solid var(--hairline);border-radius:16px;padding:14px 15px;transition:border-color .15s}
.ax-io:focus-within{border-color:var(--border);box-shadow:none}
.ax-io-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.ax-io-label{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.4px;text-transform:uppercase}
.ax-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ax-io-bal{font-family:inherit;font-size:11px;color:var(--ink-2);font-weight:500}
.ax-io-bal-val{color:var(--ink);font-weight:700}
.ax-io-bal-err{color:var(--red);font-weight:700}
.ax-io-row{display:flex;align-items:center;gap:10px}

.ax-tok-btn{display:flex;align-items:center;gap:7px;padding:7px 11px;background:#fff;border:1px solid var(--border);border-radius:999px;color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;flex-shrink:0;box-shadow:none}
.ax-tok-sym{font-family:inherit;font-size:16px;font-style:normal;font-weight:700;letter-spacing:-.01em;color:var(--ink)}
.ax-tok-dot-sol{width:22px;height:22px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#9945ff,#14f195);box-shadow:none}
.ax-tok-dot-btc{width:22px;height:22px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%,#ffb84d,#f7931a 50%,#cc6e00);box-shadow:none}

.ax-amt{flex:1;background:transparent;border:none;outline:none;font-family:inherit;font-size:30px;font-weight:600;line-height:1;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-.02em;min-width:0;width:100%}
.ax-amt:disabled{opacity:.5}
.ax-amt::placeholder{color:var(--ink-3)}
.ax-amt.out{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.ax-max{background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);padding:6px 9px;border-radius:8px;font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.4px;flex-shrink:0;transition:all .15s}
.ax-max:hover:not(:disabled){background:#f0f0f1;color:var(--ink)}
.ax-max:disabled{opacity:.4;cursor:not-allowed}
.ax-io-usd{text-align:right;margin-top:6px;font-family:inherit;font-size:11px;color:var(--ink-2);font-weight:500}

.ax-flip-wrap{display:flex;justify-content:center;margin:-6px 0;position:relative;z-index:3}
.ax-flip-arrow{width:36px;height:36px;border-radius:50%;background:#fff;border:3px solid #fff;box-shadow:0 0 0 1px var(--border);display:grid;place-items:center;font-family:inherit;font-style:normal;font-size:16px;color:var(--ink);line-height:1}

.ax-tag{font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.4px;padding:3px 8px;border-radius:6px;text-transform:uppercase;color:var(--ink-2);background:var(--glass-strong);border:1px solid var(--border)}

.ax-addr-wrap{margin-top:12px}
.ax-addr-label{display:flex;align-items:center;justify-content:space-between;gap:6px;font-family:inherit;font-size:11px;font-weight:700;color:var(--ink-2);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px}
.ax-addr-status{font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.3px}
.ax-addr-input-wrap{position:relative}
.ax-addr-input{width:100%;padding:13px 42px 13px 14px;background:var(--glass-strong);border:1px solid var(--border);border-radius:12px;color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:600;outline:none;transition:border-color .15s}
.ax-addr-input:focus{border-color:var(--ink);box-shadow:none}
.ax-addr-input:disabled{opacity:.55}
.ax-addr-input::placeholder{color:var(--ink-3);font-weight:500}
.ax-addr-input.invalid{border-color:var(--red)}
.ax-addr-check{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:800}
.ax-addr-hint{margin-top:6px;font-family:inherit;font-size:11px;color:var(--ink-3);font-weight:500;letter-spacing:.2px}
.ax-addr-hint.err{color:var(--red)}

.ax-route{margin-top:12px;padding:6px 14px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--hairline)}
.ax-route-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-family:inherit;font-size:12px;border-bottom:1px solid var(--hairline)}
.ax-route-row:last-child{border-bottom:none}
.ax-route-row .k{color:var(--ink-2);font-weight:500;letter-spacing:0}
.ax-route-row .v{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.ax-route-row .v.blue{color:var(--ink)}
.ax-route-row .v.btc{color:#cc6e00}
.ax-route-row.total{margin-top:2px;padding-top:8px;border-top:1px solid var(--border)}
.ax-route-row.total .k{color:var(--ink);font-weight:700}
.ax-route-row.total .v{font-size:12px}

.ax-banner{margin-top:14px;padding:12px 14px;border-radius:12px;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;font-family:inherit;line-height:1.4}
.ax-banner.info{background:var(--glass-strong);border:1px solid var(--hairline);color:var(--ink)}
.ax-banner.err{background:rgba(224,54,79,.07);border:1px solid rgba(224,54,79,.3);color:var(--red)}
.ax-banner.ok{background:rgba(22,163,74,.07);border:1px solid rgba(22,163,74,.3);color:var(--green);animation:ax-rise .4s}
.ax-spinner{width:14px;height:14px;border-radius:50%;flex-shrink:0;border:2px solid var(--border);border-top-color:var(--ink);animation:ax-spin .8s linear infinite}

.ax-cta{
  width:100%;margin-top:16px;padding:16px;border-radius:999px;border:none;
  font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.01em;color:#fff;cursor:pointer;
  background:#0a0a0a;
  box-shadow:none;
  transition:transform .15s,opacity .15s;position:relative;overflow:hidden;min-height:54px;
}
.ax-cta em{font-style:normal;opacity:.6;margin:0 5px;font-weight:500}
.ax-cta:hover:not(:disabled){opacity:.9}
.ax-cta:active:not(:disabled){transform:translateY(1px)}
.ax-cta:disabled{background:var(--glass-strong);color:var(--ink-3);border:1px solid var(--border);box-shadow:none;cursor:not-allowed}

.ax-cta-footer{margin-top:14px;text-align:center;font-family:inherit;font-size:10.5px;font-weight:500;color:var(--ink-3);letter-spacing:.2px}

.ax-powered{margin:12px 16px 0;display:flex;align-items:center;justify-content:center;gap:7px;padding:12px 16px;border-radius:12px;background:var(--glass-strong);backdrop-filter:none;border:1px solid var(--hairline)}
.ax-powered-label{font-family:inherit;font-size:10px;color:var(--ink-3);font-weight:600;letter-spacing:.3px;text-transform:uppercase}
.ax-powered-name{font-family:inherit;font-style:normal;font-size:14px;font-weight:700;letter-spacing:-.01em;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--ink)}
.ax-powered-sep{color:var(--ink-3);font-size:10px;opacity:.6}
`;

// =====================================================================
// CONFIG
// =====================================================================
const FEE_WALLET    = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const PLATFORM_BPS  = 300;      // 3% fee, charged ON TOP of the bridge amount
const MIN_SOL       = 0.2;      // applies to the BRIDGE amount (= user input)
const MAX_SOL       = 50;

const LAMPORTS_PER_SOL = 1_000_000_000;
const SATS_PER_BTC     = 1e8;
const TX_FEE_RESERVE   = 500_000;       // ~0.0005 SOL kept for Solana tx fees
const MAX_RESERVE_LAMPORTS = 10_000_000;

const SLIPPAGE_PCT           = 3;          // client-side hint to server (3%)
const PRIORITY_MICROLAMPORTS = 100_000;    // doubled from 50k
const COMPUTE_UNIT_LIMIT     = 200_000;

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

// Poll signature status — decoupled from blockhash validity window.
async function pollSignatureStatus(signature, { timeoutMs = 90_000, intervalMs = 1_500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await rpcRace(
        'getSignatureStatuses',
        c => c.getSignatureStatuses([signature], { searchTransactionHistory: true }),
      );
      const s = res?.value?.[0];
      if (s) {
        if (s.err) throw new Error('Transaction failed on-chain: ' + JSON.stringify(s.err));
        const cs = s.confirmationStatus;
        if (cs === 'confirmed' || cs === 'finalized') return { ok: true };
      }
    } catch (e) {
      if (String(e?.message || '').includes('Transaction failed on-chain')) throw e;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Confirmation timed out — check Solscan for tx ' + signature);
}

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
const fmtSol = (n, d = 4) => {
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

async function cfChannel({ quote, destAddress, refundAddress, slippagePct }) {
  const res = await fetchWithTimeout(
    '/api/chainflip/channel',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ quote, destAddress, refundAddress, slippagePct }),
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

  // Quote — bridge amount = full user input. Fee = 3% on top (separate).
  useEffect(() => {
    const n = parseFloat(solAmount);
    if (!Number.isFinite(n) || n <= 0)     { setQuote(null); return; }
    if (n < MIN_SOL || n > MAX_SOL)        { setQuote(null); return; }

    const userHasAddr = isValidBtcAddr(btcAddr);
    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');

    const t = setTimeout(async () => {
      try {
        const bridgeLamports   = BigInt(Math.round(n * LAMPORTS_PER_SOL));
        const platformLamports = (bridgeLamports * BigInt(PLATFORM_BPS)) / 10000n;
        const totalLamports    = bridgeLamports + platformLamports;
        if (bridgeLamports <= 0n) throw new Error('Amount too small');

        const cf = await cfQuote({ lamports: bridgeLamports });
        if (seq !== quoteSeq.current) return;
        setQuote({
          cf,
          bridgeLamports,    // full amount sent to Chainflip
          platformLamports,  // 3% fee, additional outflow
          totalLamports,     // bridge + fee, total wallet debit (excl. tx reserve)
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
  // Display the slippage we actually hint to the server — hardcoded 3%.
  const dispSlippage = SLIPPAGE_PCT;

  // Derived display values for the route panel.
  const feeSol    = quote ? Number(quote.platformLamports) / LAMPORTS_PER_SOL : 0;
  const totalSol  = quote ? Number(quote.totalLamports)    / LAMPORTS_PER_SOL : 0;
  const totalUsd  = solPrice > 0 ? totalSol * solPrice : 0;

  // MAX — must fit (bridge + 3% fee + tx reserve) into balance.
  //   balance ≥ input × 1.03 + reserve
  //   input_max = (balance - reserve) / 1.03
  const handleMax = () => {
    if (solBalance == null) return;
    const reserve     = TX_FEE_RESERVE + MAX_RESERVE_LAMPORTS;
    const usable      = Math.max(0, solBalance - reserve);
    const feeMult     = 1 + (PLATFORM_BPS / 10000);
    const maxInputSol = (usable / LAMPORTS_PER_SOL) / feeMult;
    if (maxInputSol < MIN_SOL)      setSolAmount(MIN_SOL.toString());
    else if (maxInputSol > MAX_SOL) setSolAmount(MAX_SOL.toString());
    else                            setSolAmount(maxInputSol.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  };

  const handleSubmit = async () => {
    if (!connected) { onConnectWallet?.(); return; }
    if (!publicKey || !signAllTransactions) { setError('Wallet not ready'); return; }
    if (!quote || quote.isPreview) { setError('Enter a valid BTC address'); return; }
    if (!addrValid) { setError('Invalid BTC address'); return; }

    // Balance check: bridge + 3% fee + tx reserve, only when balance is known.
    if (balanceKnown) {
      const totalNeeded = BigInt(quote.totalLamports) + BigInt(TX_FEE_RESERVE);
      if (solBalance != null && BigInt(solBalance) < totalNeeded) {
        const need = (Number(totalNeeded) - solBalance) / LAMPORTS_PER_SOL;
        setError(`Not enough SOL — need ~${need.toFixed(4)} more in your wallet`);
        return;
      }
    }

    setError('');
    setChannelId(null);
    setBridgeStatus(null);
    setSubmit({ kind: 'loading', message: 'Opening deposit channel…' });

    try {
      // Reuse existing quote (no refetch, no requote). Override slippage on
      // the quote so the server's `quote.recommendedSlippageTolerancePercent`
      // read picks up our hint; also pass slippagePct in the body for
      // handlers that read it explicitly.
      const quoteForChannel = {
        ...quote.cf,
        recommendedSlippageTolerancePercent: SLIPPAGE_PCT,
      };
      const channel = await cfChannel({
        quote:         quoteForChannel,
        destAddress:   btcAddr,
        refundAddress: publicKey.toString(),
        slippagePct:   SLIPPAGE_PCT,
      });
      const vault = new PublicKey(channel.depositAddress);
      const owner = publicKey;

      setSubmit({ kind: 'loading', message: 'Building transaction…' });
      const { blockhash, lastValidBlockHeight } = await rpcRace(
        'getLatestBlockhash',
        c => c.getLatestBlockhash('finalized'),
      );

      const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS });
      const cuLimitIx  = ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT });

      // ── Single transaction: fee + bridge in one shot ────────────────
      // Fee first so the user has paid for service before the bridge IX
      // touches Chainflip's deposit account; both succeed-or-fail atomically.
      // Bridge amount = full user input. Fee is ADDITIONAL.
      const msg = new TransactionMessage({
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
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey:   vault,
            lamports:   Number(quote.bridgeLamports),
          }),
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      // ── Simulate the EXACT tx we're about to sign ───────────────────
      setSubmit({ kind: 'loading', message: 'Simulating transaction…' });
      const sim = await rpcRace('simulateTransaction', c => c.simulateTransaction(tx, {
        commitment:             'confirmed',
        sigVerify:              false,
        replaceRecentBlockhash: false,
      }));
      if (sim?.value?.err) {
        const logs = (sim.value.logs || []).slice(-6).join(' | ');
        throw new Error('Simulation failed: ' + JSON.stringify(sim.value.err) + (logs ? ' — ' + logs : ''));
      }

      // ── Sign the SAME tx that simulated cleanly ─────────────────────
      setSubmit({ kind: 'loading', message: 'Confirm in your wallet…' });
      const [signedTx] = await signAllTransactions([tx]);

      // ── Send and poll status (decoupled from blockhash validity) ────
      setSubmit({ kind: 'loading', message: 'Sending transaction…' });
      const serialized = signedTx.serialize();
      const sig = await rpcRace('sendTx', c => c.sendRawTransaction(serialized, {
        skipPreflight: false,
        maxRetries:    5,
      }));

      setSubmit({ kind: 'loading', message: 'Confirming on Solana…' });
      await pollSignatureStatus(sig, { timeoutMs: 90_000, intervalMs: 1_500 });

      console.log('[sol→btc cf] tx', sig, 'channel', channel.depositChannelId);

      setChannelId(channel.depositChannelId);
      setBridgeStatus({ label: 'Bridge confirmed · waiting for Chainflip to observe…', done: false });
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

        <div className="ax-desc">
          <b>Get native Bitcoin.</b> Real BTC straight to your wallet, not synthetic. No KYC, no wraps.
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
              <span className="ax-io-label">You Bridge</span>
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
              <div className="ax-route-row"><span className="k">Bridge amount</span><span className="v">{fmtSol(n, 4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Platform fee (3%)</span><span className="v">{fmtSol(feeSol, 4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Route</span><span className="v blue">Chainflip · Native L1</span></div>
              <div className="ax-route-row"><span className="k">Max slippage</span><span className="v">{dispSlippage.toFixed(2)}%</span></div>
              {quote.cf?.estimatedDurationSeconds != null && (
                <div className="ax-route-row"><span className="k">Est. delivery</span><span className="v">~{Math.max(1, Math.round(Number(quote.cf.estimatedDurationSeconds) / 60))} min</span></div>
              )}
              <div className="ax-route-row"><span className="k">You receive</span><span className="v btc">{fmtBtc(expectedBtc, 8)} BTC</span></div>
              <div className="ax-route-row total">
                <span className="k">Total wallet debit</span>
                <span className="v">{fmtSol(totalSol, 4)} SOL{totalUsd > 0 ? ` · ${fmtUsd(totalUsd, 2)}` : ''}</span>
              </div>
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

          <div className="ax-cta-footer">One signature · One tx · Native BTC via Chainflip</div>
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
