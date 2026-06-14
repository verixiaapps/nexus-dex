/**
 * NEXUS · SolToBtc.jsx
 * SOL → Native BTC via ThorChain (single-signature, two-tx atomic flow).
 *
 * VISUAL REDESIGN — same DNA as Bridge / Stocks / GetStarted (Wonderland).
 * Light cream surface with cool-tuned blobs, blue → violet accent, faint
 * floating ₿ emblems for page identity. Signature element is the LIVE RATE
 * card (1 SOL → BTC, ticking with price feed).
 *
 * Instrument Serif italic for headline + numbers + token symbols.
 * JetBrains Mono for tabular data, labels, captions.
 * Space Grotesk for body.
 *
 * ALL ThorChain / RPC / quote / submit / polling logic preserved verbatim.
 * Class prefix stays ax-.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
} from '@solana/web3.js';

// =====================================================================
// INLINE CSS — Wonderland-lite · Instrument Serif + Space Grotesk + JetBrains Mono
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

/* PAGE */
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
.ax-blob{
  position:absolute;border-radius:50%;filter:blur(70px);opacity:0.42;
  animation:ax-drift 14s ease-in-out infinite;pointer-events:none;z-index:0;
}
.ax-emblem{
  position:absolute;font-family:"Instrument Serif",serif;font-style:italic;font-weight:400;
  pointer-events:none;user-select:none;z-index:1;line-height:1;
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  opacity:0.08;animation:ax-drift 18s ease-in-out infinite;
}
.ax-inner{position:relative;z-index:5}

/* HEADER */
.ax-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px 4px;
}
.ax-brand{display:flex;align-items:center;gap:10px}
.ax-brand-dot{
  width:28px;height:28px;border-radius:50%;
  background:linear-gradient(135deg,#4f7dff,#a87fff 60%,#7FFFD4);
  box-shadow:0 0 14px rgba(79,125,255,0.5);
}
.ax-wordmark{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;line-height:1}
.ax-wordmark .slash{opacity:0.4;margin:0 3px;font-style:normal}
.ax-wordmark .grad{
  background:linear-gradient(90deg,#4f7dff,#a87fff,#7FFFD4);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.ax-head-live{
  display:flex;align-items:center;gap:6px;
  padding:5px 11px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--blue);
  letter-spacing:1.2px;
}
.ax-head-live .d{width:5px;height:5px;border-radius:50%;background:var(--blue);box-shadow:0 0 8px var(--blue);animation:ax-pulse 1.6s ease-in-out infinite}

/* MINI HERO */
.ax-mini-hero{padding:18px 22px 8px}
.ax-mh-eyebrow{
  display:inline-flex;align-items:center;gap:7px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--blue);letter-spacing:1.6px;margin-bottom:8px;
}
.ax-mh-title{
  font-family:"Instrument Serif",serif;font-weight:400;
  font-size:34px;line-height:1;letter-spacing:-.02em;margin:0 0 6px;
  color:var(--ink);
}
.ax-mh-title em{
  font-style:italic;
  background:linear-gradient(120deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.ax-mh-sub{font-size:13px;color:var(--ink-2);font-weight:500;line-height:1.45}

/* SIGNATURE: LIVE RATE CARD */
.ax-rate-card{
  margin:14px 22px 0;padding:18px 20px 16px;border-radius:24px;
  background:var(--glass-strong);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.85);
  position:relative;overflow:hidden;
  animation:ax-rate-glow 4s ease-in-out infinite;
}
.ax-rate-card::before{
  content:'';position:absolute;inset:0;border-radius:24px;padding:1.5px;
  background:linear-gradient(135deg,rgba(79,125,255,.45),transparent 40%,transparent 60%,rgba(168,127,255,.45));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.8;
}
.ax-rate-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.ax-rate-label{
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;
}
.ax-rate-live{
  display:flex;align-items:center;gap:5px;
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--green);letter-spacing:1px;
}
.ax-rate-live .d{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:ax-pulse 1.4s ease-in-out infinite}
.ax-rate-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.ax-rate-from{
  font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700;
  color:var(--ink-2);letter-spacing:0.4px;
}
.ax-rate-arrow{font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1}
.ax-rate-val{
  font-family:"Instrument Serif",serif;font-style:italic;
  font-size:44px;line-height:1;letter-spacing:-.025em;
  background:linear-gradient(120deg,#4f7dff,#a87fff 70%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  font-variant-numeric:tabular-nums;animation:ax-tick .3s ease-out;
}
.ax-rate-to{font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--ink);line-height:1}
.ax-rate-usd{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500;letter-spacing:0.3px}
.ax-rate-usd b{color:var(--ink);font-weight:700}

/* KYC PILLS */
.ax-kyc{
  margin:14px 22px 0;display:flex;align-items:center;justify-content:center;gap:14px;
  padding:9px 14px;border-radius:100px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
}
.ax-kyc span{
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-2);white-space:nowrap;
}
.ax-kyc .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--blue);opacity:.7}

/* CARD */
.ax-card{
  margin:14px 22px 0;padding:18px;border-radius:24px;
  background:var(--glass);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.85);
  box-shadow:0 12px 40px rgba(79,125,255,.10);
}

/* I/O BOX */
.ax-io{
  background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);
  border-radius:18px;padding:14px 16px;
  transition:border-color .15s,box-shadow .15s;
}
.ax-io:focus-within{border-color:var(--border-hi);box-shadow:0 0 0 4px rgba(79,125,255,.08)}
.ax-io-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.ax-io-label{
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;
}
.ax-io-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ax-io-bal{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);font-weight:500}
.ax-io-bal-val{color:var(--ink);font-weight:700}
.ax-io-row{display:flex;align-items:center;gap:10px}

.ax-tok-btn{
  display:flex;align-items:center;gap:8px;padding:8px 12px;
  background:#fff;border:1px solid var(--border);border-radius:999px;
  color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;
  flex-shrink:0;
  box-shadow:0 2px 8px rgba(26,27,78,.06);
}
.ax-tok-sym{font-family:"Instrument Serif",serif;font-size:17px;font-style:italic;letter-spacing:-.01em;color:var(--ink)}
.ax-tok-dot-sol{
  width:20px;height:20px;border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,#9945ff,#14f195);
  box-shadow:inset 0 -2px 4px rgba(0,0,0,.15),0 0 6px rgba(153,69,255,.3);
}
.ax-tok-dot-btc{
  width:20px;height:20px;border-radius:50%;flex-shrink:0;
  background:radial-gradient(circle at 35% 30%,#ffb84d,#f7931a 50%,#cc6e00);
  box-shadow:inset 0 -2px 4px rgba(0,0,0,.15),0 0 6px rgba(247,147,26,.3);
}

.ax-amt{
  flex:1;background:transparent;border:none;outline:none;
  font-family:"Instrument Serif",serif;font-size:34px;line-height:1;
  color:var(--ink);text-align:right;font-variant-numeric:tabular-nums;
  min-width:0;width:100%;
}
.ax-amt:disabled{opacity:.5}
.ax-amt::placeholder{color:var(--ink-3)}
.ax-amt.out{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.ax-max{
  background:rgba(79,125,255,.10);border:1px solid var(--border);color:var(--blue);
  padding:6px 10px;border-radius:10px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;cursor:pointer;
  letter-spacing:0.8px;flex-shrink:0;transition:all .15s;
}
.ax-max:hover:not(:disabled){background:rgba(79,125,255,.18)}
.ax-max:disabled{opacity:.4;cursor:not-allowed}
.ax-io-usd{
  text-align:right;margin-top:6px;
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-weight:500;
}

/* FLIP */
.ax-flip-wrap{display:flex;justify-content:center;margin:-12px 0;position:relative;z-index:3}
.ax-flip-arrow{
  width:42px;height:42px;border-radius:14px;
  background:linear-gradient(135deg,#fff,#F5F8FF);
  border:3px solid #EEF3FF;
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;font-size:22px;color:var(--violet);line-height:1;
  box-shadow:0 6px 18px rgba(168,127,255,.18);
}

/* TAGS */
.ax-tag{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  letter-spacing:1px;padding:3px 8px;border-radius:6px;text-transform:uppercase;
  color:var(--blue);background:rgba(79,125,255,.10);border:1px solid var(--border);
}
.ax-tag.cyan{color:var(--blue)}

/* ADDRESS */
.ax-addr-wrap{margin-top:12px}
.ax-addr-label{
  display:flex;align-items:center;justify-content:space-between;gap:6px;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  color:var(--ink-2);letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px;
}
.ax-addr-status{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:1px}
.ax-addr-input-wrap{position:relative}
.ax-addr-input{
  width:100%;padding:13px 42px 13px 14px;
  background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);
  border-radius:12px;color:var(--ink);
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;
  outline:none;transition:border-color .15s,box-shadow .15s;
}
.ax-addr-input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(79,125,255,.10)}
.ax-addr-input:disabled{opacity:.55}
.ax-addr-input::placeholder{color:var(--ink-3);font-weight:500}
.ax-addr-input.invalid{border-color:rgba(209,75,106,.5)}
.ax-addr-check{
  position:absolute;right:12px;top:50%;transform:translateY(-50%);
  width:22px;height:22px;border-radius:50%;
  background:linear-gradient(135deg,#7FFFD4,#A0E7FF);color:var(--ink);
  display:grid;place-items:center;font-size:13px;font-weight:800;
}
.ax-addr-hint{
  margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:10px;
  color:var(--ink-3);font-weight:600;letter-spacing:0.6px;
}
.ax-addr-hint.err{color:var(--red)}

/* ROUTE SUMMARY */
.ax-route{
  margin-top:12px;padding:12px 14px;border-radius:14px;
  background:rgba(79,125,255,.05);border:1px dashed var(--border-hi);
}
.ax-route-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-family:"JetBrains Mono",monospace;font-size:11px}
.ax-route-row .k{color:var(--ink-2);font-weight:600;letter-spacing:0.4px}
.ax-route-row .v{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.ax-route-row .v.blue{color:var(--blue)}
.ax-route-row .v.btc{color:#cc6e00}

/* BANNERS */
.ax-banner{
  margin-top:14px;padding:12px 14px;border-radius:14px;
  display:flex;align-items:center;gap:10px;
  font-size:12px;font-weight:600;font-family:"Space Grotesk",sans-serif;
}
.ax-banner.info{background:rgba(79,125,255,.08);border:1px solid var(--border);color:var(--blue)}
.ax-banner.err{background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.35);color:var(--red)}
.ax-banner.ok{
  background:linear-gradient(135deg,rgba(127,255,212,.18),rgba(160,231,255,.18));
  border:1px solid rgba(127,255,212,.45);color:var(--green);
  animation:ax-rise .4s;
}
.ax-spinner{
  width:14px;height:14px;border-radius:50%;flex-shrink:0;
  border:2px solid rgba(79,125,255,.20);border-top-color:var(--blue);
  animation:ax-spin .8s linear infinite;
}

/* CTA */
.ax-cta{
  width:100%;margin-top:14px;padding:18px;border-radius:18px;border:none;
  font-family:"Instrument Serif",serif;font-size:19px;letter-spacing:-.01em;
  color:#fff;cursor:pointer;
  background:linear-gradient(135deg,#4f7dff,#a87fff);
  box-shadow:0 10px 28px rgba(79,125,255,.32),inset 0 1px 0 rgba(255,255,255,.25);
  transition:transform .15s,box-shadow .15s,opacity .15s;
  position:relative;overflow:hidden;min-height:56px;
}
.ax-cta em{font-style:italic;opacity:.9;margin:0 4px}
.ax-cta:hover:not(:disabled){transform:translateY(-1px)}
.ax-cta:active:not(:disabled){transform:translateY(1px)}
.ax-cta:disabled{
  background:rgba(26,27,78,.06);color:var(--ink-3);
  border:1.5px solid var(--hairline);box-shadow:none;cursor:not-allowed;
}

.ax-cta-footer{
  margin-top:14px;text-align:center;
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:500;
  color:var(--ink-3);letter-spacing:0.6px;
}

/* POWERED FOOTER */
.ax-powered{
  margin:14px 22px 0;display:flex;align-items:center;justify-content:center;gap:9px;
  padding:12px 16px;border-radius:14px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
}
.ax-powered-label{
  font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--ink-3);font-weight:700;
  letter-spacing:1.4px;text-transform:uppercase;
}
.ax-powered-name{
  font-family:"Instrument Serif",serif;font-style:italic;font-size:15px;letter-spacing:-.01em;
  background:linear-gradient(90deg,#4f7dff,#a87fff);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.ax-powered-sep{color:var(--ink-3);font-size:9px;opacity:.5}
`;

// =====================================================================
// CONFIG — UNCHANGED
// =====================================================================
const FEE_WALLET    = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const PLATFORM_BPS  = 300;  // 3% — your spread, collected on-chain in SOL
const SLIPPAGE_BPS  = 300;  // 3% — hard-coded slippage tolerance
const MIN_SOL       = 0.05;
const MAX_SOL       = 50;

const THORNODE         = 'https://thornode.ninerealms.com';
const MEMO_PROGRAM     = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const LAMPORTS_PER_SOL = 1_000_000_000;
const SATS_PER_BTC     = 1e8;
const PREVIEW_BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'; // for rate-only quotes
const MAX_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL kept back when user taps MAX

// =====================================================================
// UTILS — UNCHANGED
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

// localStorage with safe fallback (private mode / SSR).
const LS_KEY_BTC = 'soltobtc:lastBtcAddr';
const ls = {
  get: k => { try { return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); } catch { /* noop */ } },
};

// ThorChain quote — SOL→BTC. Lamports → thor 1e8 units via /10.
// `liquidity_tolerance_bps` is ThorChain's preferred slippage param —
// it bakes a min-out `limit` into the returned `memo` based on the expected
// output AFTER liquidity + outbound + affiliate fees (more accurate than
// the legacy `tolerance_bps`, which only tolerates flat-rate slip).
async function getThorQuoteOnce({ swapLamports, btcAddress, refundAddress }) {
  const thorUnits = (BigInt(swapLamports) / 10n).toString();
  const params = new URLSearchParams({
    from_asset:              'SOL.SOL',
    to_asset:                'BTC.BTC',
    amount:                  thorUnits,
    destination:             btcAddress,
    liquidity_tolerance_bps: String(SLIPPAGE_BPS),
  });
  if (refundAddress) params.set('refund_address', refundAddress);

  const res = await fetchWithTimeout(
    `${THORNODE}/thorchain/quote/swap?${params}`,
    { headers: { Accept: 'application/json' } },
    14_000,
  );
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `Quote failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (!json.inbound_address) throw new Error('No active vault — retry');
  if (!json.memo)            throw new Error('Quote missing memo');
  return json;
}

async function getThorQuote(args) {
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getThorQuoteOnce(args);
    } catch (e) {
      lastErr = e;
      const status = e.status;
      const isNetwork = !status;
      const retryable = isNetwork || (typeof status === 'number' && RETRYABLE.has(status));
      if (!retryable || attempt === 2) break;
      await new Promise(r => setTimeout(r, 700 * (attempt + 1) + attempt * 100));
    }
  }
  throw lastErr;
}

async function getThorTxStatus(txHash) {
  try {
    const res = await fetchWithTimeout(
      `${THORNODE}/thorchain/tx/status/${txHash}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function deriveStatusLabel(status) {
  if (!status || typeof status !== 'object') return { label: 'Waiting for ThorChain to observe…', done: false };
  const s = status.stages || {};
  if (s.outbound_signed?.completed) return { label: 'Sent BTC ✓ Check your wallet', done: true };
  if (s.swap_finalised?.completed)  return { label: 'Sending BTC to your address…', done: false };
  if (s.swap_status?.pending === false || s.swap_status?.completed) return { label: 'Swap complete · preparing outbound…', done: false };
  if (s.inbound_finalised?.completed)        return { label: 'Confirmed by ThorChain · swapping…', done: false };
  if (s.inbound_confirmation_counted?.completed) return { label: 'Confirmed on Solana · counting blocks…', done: false };
  if (s.inbound_observed?.completed)         return { label: 'Observed by ThorChain…', done: false };
  return { label: 'Waiting for ThorChain to observe…', done: false };
}

function memoIx(memo, signer) {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM,
    data: new TextEncoder().encode(memo),
  });
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
export default function SolToBtc({ onConnectWallet }) {
  useStbtcCSS();

  const { publicKey, connected, signAllTransactions } = useWallet();
  const { connection } = useConnection();

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
  const [solBalance, setSolBalance] = useState(null);
  const [bridgeSig, setBridgeSig] = useState(null);
  const [bridgeStatus, setBridgeStatus] = useState(null); // { label, done }

  const quoteSeq = useRef(0);

  // Prices (every 30s)
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

  // SOL balance (only when connected)
  useEffect(() => {
    if (!publicKey || !connection) { setSolBalance(null); return; }
    let alive = true;
    const tick = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, 'confirmed');
        if (alive) setSolBalance(lamports);
      } catch { /* ignore — show no balance */ }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection]);

  // Persist BTC address to localStorage when it's valid.
  useEffect(() => {
    if (btcAddr && isValidBtcAddr(btcAddr)) ls.set(LS_KEY_BTC, btcAddr);
  }, [btcAddr]);

  // Quote — works without wallet OR without address (preview rate mode).
  useEffect(() => {
    const n = parseFloat(solAmount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }
    if (n < MIN_SOL || n > MAX_SOL) { setQuote(null); return; }

    const userHasAddr = isValidBtcAddr(btcAddr);
    const addrForQuote = userHasAddr ? btcAddr : PREVIEW_BTC_ADDR;
    const refundAddress = publicKey ? publicKey.toString() : undefined;

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const grossLamports    = BigInt(Math.round(n * LAMPORTS_PER_SOL));
        const platformLamports = (grossLamports * BigInt(PLATFORM_BPS)) / 10000n;
        const swapLamports     = grossLamports - platformLamports;
        if (swapLamports <= 0n) throw new Error('Amount too small');

        const q = await getThorQuote({ swapLamports, btcAddress: addrForQuote, refundAddress });
        if (seq !== quoteSeq.current) return;
        setQuote({
          thor: q,
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
    }, 1100);
    return () => clearTimeout(t);
  }, [solAmount, btcAddr, publicKey]);

  // ThorChain inbound-tx status polling.
  useEffect(() => {
    if (!bridgeSig) return;
    let alive = true;
    let done = false;

    const tick = async () => {
      if (!alive) return;
      const status = await getThorTxStatus(bridgeSig);
      if (!alive) return;
      const derived = deriveStatusLabel(status);
      setBridgeStatus(derived);
      if (derived.done) { done = true; }
    };

    tick();
    const id = setInterval(() => {
      if (done) { clearInterval(id); return; }
      tick();
    }, 6_000);

    const stopAt = setTimeout(() => { alive = false; clearInterval(id); }, 15 * 60_000);
    return () => { alive = false; clearInterval(id); clearTimeout(stopAt); };
  }, [bridgeSig]);

  const isBusy    = submit.kind === 'loading';
  const isSuccess = submit.kind === 'success';

  const n = parseFloat(solAmount) || 0;
  const stakeValid = n >= MIN_SOL && n <= MAX_SOL;
  const addrValid  = isValidBtcAddr(btcAddr);
  const usdEquiv   = solPrice > 0 ? n * solPrice : 0;
  const balanceSol = solBalance != null ? solBalance / LAMPORTS_PER_SOL : null;

  const expectedSats   = quote?.thor?.expected_amount_out
    ? Number(quote.thor.expected_amount_out) : 0;
  const expectedBtc    = expectedSats / SATS_PER_BTC;
  const expectedBtcUsd = expectedBtc * btcPrice;

  // Live 1-SOL → BTC rate for the signature card.
  const liveSolToBtc = (solPrice > 0 && btcPrice > 0) ? solPrice / btcPrice : 0;

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
    if (!publicKey || !signAllTransactions || !connection) {
      setError('Wallet not ready'); return;
    }
    if (!quote || quote.isPreview) { setError('Enter a valid BTC address'); return; }
    if (!addrValid) { setError('Invalid BTC address'); return; }

    const TX_FEE_RESERVE = 500_000n;
    const totalNeeded = BigInt(quote.platformLamports) + BigInt(quote.swapLamports) + TX_FEE_RESERVE;
    if (solBalance != null && BigInt(solBalance) < totalNeeded) {
      setError('Not enough SOL for swap + tx fees');
      return;
    }

    setError('');
    setBridgeSig(null);
    setBridgeStatus(null);
    setSubmit({ kind: 'loading', message: 'Refreshing route…' });

    try {
      const fresh = await getThorQuote({
        swapLamports:  quote.swapLamports,
        btcAddress:    btcAddr,
        refundAddress: publicKey.toString(),
      });
      const vault = new PublicKey(fresh.inbound_address);
      const owner = publicKey;

      setSubmit({ kind: 'loading', message: 'Building transactions…' });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

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
          memoIx(fresh.memo, owner),
        ],
      }).compileToV0Message();
      const bridgeTx = new VersionedTransaction(bridgeMsg);

      setSubmit({ kind: 'loading', message: 'Confirm in your wallet…' });
      const [signedFee, signedBridge] = await signAllTransactions([feeTx, bridgeTx]);

      setSubmit({ kind: 'loading', message: 'Sending fee tx…' });
      const feeSig = await connection.sendRawTransaction(signedFee.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      setSubmit({ kind: 'loading', message: 'Confirming fee…' });
      const feeConfirm = await connection.confirmTransaction(
        { signature: feeSig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (feeConfirm?.value?.err) {
        throw new Error('Fee tx failed — bridge not sent');
      }

      setSubmit({ kind: 'loading', message: 'Sending bridge tx…' });
      const sig = await connection.sendRawTransaction(signedBridge.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      console.log('[sol→btc] fee', feeSig, 'bridge', sig);

      setBridgeSig(sig);
      setBridgeStatus({ label: 'Bridge submitted · waiting for ThorChain…', done: false });
      setSubmit({
        kind: 'success',
        message: `Submitted · ${sig.slice(0, 8)}…`,
      });

      setSolAmount(''); setQuote(null);
      setTimeout(() => setSubmit({ kind: 'idle', message: '' }), 6000);
    } catch (e) {
      console.error('[sol→btc]', e);
      const msg = e.message || 'Transaction failed';
      setSubmit({
        kind: 'error',
        message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg,
      });
      setTimeout(() => setSubmit({ kind: 'idle', message: '' }), 5000);
    }
  };

  return (
    <div className="ax-page">
      {/* Blobs */}
      <div className="ax-blob" style={{ width: 380, height: 380, background: '#A0E7FF', top: -100, right: -120 }}/>
      <div className="ax-blob" style={{ width: 420, height: 420, background: '#B794F6', top: '35%', left: -160, animationDelay: '3s' }}/>
      <div className="ax-blob" style={{ width: 300, height: 300, background: '#FFE8F4', bottom: '10%', right: -80, animationDelay: '6s' }}/>

      {/* Faint ₿ emblems for page identity */}
      <div className="ax-emblem" style={{ fontSize: 280, top: -40, left: -60, transform: 'rotate(-12deg)' }}>₿</div>
      <div className="ax-emblem" style={{ fontSize: 180, top: '42%', right: -30, transform: 'rotate(15deg)', animationDelay: '4s' }}>₿</div>
      <div className="ax-emblem" style={{ fontSize: 220, bottom: '8%', left: -40, transform: 'rotate(-8deg)', animationDelay: '8s' }}>₿</div>

      <div className="ax-inner">
        {/* HEADER */}
        <div className="ax-head">
          <div className="ax-brand">
            <div className="ax-brand-dot"/>
            <span className="ax-wordmark">native<span className="slash">//</span><span className="grad">bitcoin</span></span>
          </div>
          <div className="ax-head-live"><span className="d"/>THORCHAIN</div>
        </div>

        {/* MINI HERO */}
        <div className="ax-mini-hero">
          <div className="ax-mh-eyebrow">⟁ NO KYC · NO WRAPS</div>
          <h1 className="ax-mh-title">Get native <em>Bitcoin.</em></h1>
          <div className="ax-mh-sub">Real BTC straight to your wallet. Not synthetic.</div>
        </div>

        {/* SIGNATURE — LIVE RATE CARD */}
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

        {/* KYC PILLS */}
        <div className="ax-kyc">
          <span>No KYC</span><span className="dot"/>
          <span>No Account</span><span className="dot"/>
          <span>No Limits</span>
        </div>

        {/* FORM CARD */}
        <div className="ax-card">
          {/* SOL input */}
          <div className="ax-io">
            <div className="ax-io-head">
              <span className="ax-io-label">You Send</span>
              <div className="ax-io-meta">
                {connected && balanceSol != null ? (
                  <span className="ax-io-bal">Balance: <span className="ax-io-bal-val">{balanceSol.toFixed(4)}</span> SOL</span>
                ) : (
                  <span className="ax-io-bal">Min <span className="ax-io-bal-val">{MIN_SOL}</span> · Max <span className="ax-io-bal-val">{MAX_SOL}</span></span>
                )}
              </div>
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
              {connected && balanceSol != null && balanceSol >= MIN_SOL && !isBusy && (
                <button type="button" className="ax-max" onClick={handleMax}>MAX</button>
              )}
            </div>
            {usdEquiv > 0 && (<div className="ax-io-usd">≈ {fmtUsd(usdEquiv, 2)}</div>)}
          </div>

          <div className="ax-flip-wrap"><div className="ax-flip-arrow">↓</div></div>

          {/* BTC output */}
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

          {/* BTC address */}
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

          {/* Route summary */}
          {quote && (
            <div className="ax-route">
              <div className="ax-route-row"><span className="k">You send</span><span className="v">{n.toFixed(4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Bridged</span><span className="v">{(Number(quote.swapLamports)/LAMPORTS_PER_SOL).toFixed(4)} SOL</span></div>
              <div className="ax-route-row"><span className="k">Route</span><span className="v blue">ThorChain · Native L1</span></div>
              <div className="ax-route-row"><span className="k">Max slippage</span><span className="v">{(SLIPPAGE_BPS/100).toFixed(1)}%</span></div>
              {quote.thor.outbound_delay_seconds != null && (
                <div className="ax-route-row"><span className="k">Est. delivery</span><span className="v">~{Math.max(1, Math.round(Number(quote.thor.outbound_delay_seconds) / 60))} min</span></div>
              )}
              <div className="ax-route-row"><span className="k">You receive</span><span className="v btc">{fmtBtc(expectedBtc, 8)} BTC</span></div>
            </div>
          )}

          {/* Status banners */}
          {isBusy && submit.message && (
            <div className="ax-banner info"><div className="ax-spinner"/><span>{submit.message}</span></div>
          )}
          {(error || submit.kind === 'error') && (
            <div className="ax-banner err">{error || submit.message}</div>
          )}
          {isSuccess && !bridgeStatus && (
            <div className="ax-banner ok">✓ {submit.message}</div>
          )}
          {bridgeSig && bridgeStatus && (
            <div className={'ax-banner ' + (bridgeStatus.done ? 'ok' : 'info')}>
              {!bridgeStatus.done && <div className="ax-spinner"/>}
              <span>{bridgeStatus.done ? '✓ ' : ''}{bridgeStatus.label}</span>
            </div>
          )}

          {/* CTA */}
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

          <div className="ax-cta-footer">One signature · Two txs · Native BTC via ThorChain</div>
        </div>

        {/* POWERED FOOTER */}
        <div className="ax-powered">
          <span className="ax-powered-label">Powered by</span>
          <span className="ax-powered-name">ThorChain</span>
          <span className="ax-powered-sep">·</span>
          <span className="ax-powered-label">Native Bitcoin</span>
        </div>
      </div>
    </div>
  );
}
