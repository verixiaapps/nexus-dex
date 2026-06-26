// Ape.jsx — Nexus DEX · Ape (early-launch trading terminal)
//
// Fully self-contained single-file build. The React surface, the CSS, the
// heavy auxiliary panels (StatsPanel + AutoPanel + useAutoTrade), AND the
// former ./ape-helpers logic (executeSwap, formatters, riskRead, vibe-check,
// trade-param builders, share intents, RPC layer) are all inlined below — no
// local module imports. The only externals are npm packages
// (react / bs58 / @solana/*) and the same backend API routes as before.
//
// Pastel Wonderland-light palette throughout (matches /referrals + /why).
// Strips the old "specimen / wild / wonderland//radar" jargon. Fixes the
// open-positions flash bug.
//
// DETAIL CHART: the token sheet now embeds a live candlestick iframe
// (GeckoTerminal primary, DexScreener fallback) instead of drawing SVG
// candles from /api/dex/candles. It resolves the mint to its deepest pool
// and defaults to the 1-second resolution so the chart is live and moving
// the moment the sheet opens. See TokenChart / CHART_RES below.
//
// Wallet model: local burner keypair, signs locally, never leaves the
// device. mainWalletPubkey (from App.js) drives referral attribution; the
// burner drives trading and the personal trade log.
//
// FLASH-BUG FIX — root cause was that every poll built a brand-new
// balances object via setBalances(map), forcing every row that touched
// balances to re-render. The fix has four parts:
//   1) refreshBalances diffs new amounts against the previous map and
//      skips setBalances when nothing meaningful changed.
//   2) refreshOneToken does the same per-mint.
//   3) OpenPositionsStrip fetches per-token prices SEQUENTIALLY (50 ms
//      gap) and only setPrices for tokens whose price actually moved
//      (epsilon compare). Positions list is diffed before setState.
//   4) SpecimenRow is React.memo'd with a custom comparator (mint, price,
//      mcap, liq, change, holders, ageMs bucket, owned amount, busy,
//      ownedMode, isFresh).

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import {
  Connection,
  PublicKey, Keypair, VersionedTransaction, TransactionMessage, SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

/* ============================================================
   INLINED HELPERS (formerly ./ape-helpers.js) — page is now self-contained.
   Pure logic, formatters, vibe-check, trade builders, share intents, the
   RPC layer, and the buy/sell hot path (executeSwap -> apeExecuteSwap).
   ============================================================ */
/* ============================================================
   CONFIG
   ============================================================ */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;
const SOL_RESERVE = 0.003;

const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
const DEFAULT_SELL_PRESETS = [25, 50, 100];

/* ============================================================
   RPC CONNECTION LAYER
   /api/solana-rpc — Alchemy only. Every background read: balances, token
   accounts, prices, positions, debug, and withdraw tx submission.
   /api/trade-rpc  — Alchemy primary, Ankr fallback. ONLY the buy/sell
   critical path inside executeSwap. The only place Ankr is exercised.
   ============================================================ */
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';

const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';

const BAL_COMMITMENT = 'processed';

const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};
const _tradeConnCache = new Map();
const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};
const balRpcRace = (op) => op(getConn(BAL_COMMITMENT));

/* ============================================================
   FORMATTERS
   ============================================================ */
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function formatMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  if (n >= 1) return '$'+n.toFixed(2);
  return '$'+n.toPrecision(2);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1) return '$'+p.toFixed(4);
  if (p >= 0.01) return '$'+p.toFixed(5);
  if (p >= 0.0001) return '$'+p.toFixed(6);
  if (p >= 0.00000001) return '$'+p.toFixed(9);
  return '$'+p.toExponential(2);
}
function formatPct(p) { if (!Number.isFinite(p)) return '0%'; return (p>=0?'+':'')+p.toFixed(p<10&&p>-10?2:1)+'%'; }
function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
function formatSolSigned(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  return (n >= 0 ? '+' : '-') + formatSol(Math.abs(n));
}
function formatUsdAbs(n) {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n); const s = n < 0 ? '-' : '';
  if (abs >= 1e6) return s + '$' + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return s + '$' + (abs/1e3).toFixed(1) + 'K';
  if (abs >= 1)   return s + '$' + abs.toFixed(2);
  return s + '$' + abs.toPrecision(2);
}
function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function fmtAgeShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return Math.max(1, Math.floor(ms/1000))+'s';
  if (ms < 3600000) {
    const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000);
    return s > 0 && m < 10 ? (m+'m '+s+'s') : (m+'m');
  }
  const h = ms/3600000; if (h < 24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
function ageClass(ms) {
  if (!Number.isFinite(ms)) return 'wr-age old';
  if (ms < 30000) return 'wr-age';
  if (ms < 180000) return 'wr-age med';
  return 'wr-age old';
}
function mobAgeClass(ms) {
  if (!Number.isFinite(ms)) return 'mob-age old';
  if (ms < 30000) return 'mob-age';
  if (ms < 180000) return 'mob-age med';
  return 'mob-age old';
}
const lamportsToSol = (l) => Number(l || 0) / 1e9;
const truncWallet = (w) => w ? w.slice(0,4) + '…' + w.slice(-4) : '';

/* ============================================================
   VIBE CHECK
   ============================================================ */
const RISK_CEIL = 85;
function riskRead(t) {
  if (!t) return { score: 0, verdict: 'Unknown', tier: 'high', label: 'Wild', knowns: [], unknowns: [] };
  const liq = t.liquidity || 0, mcap = t.mcap || 0, hold = t.holders || 0, vol = t.volume24h || 0;
  // Age in minutes. Tokens from normalize() carry pairCreatedAtMs (not ageMs);
  // accept either so the age component of the score actually contributes.
  const _ageMs = Number.isFinite(t.ageMs) ? t.ageMs
               : (Number.isFinite(t.pairCreatedAtMs) ? Date.now() - t.pairCreatedAtMs : NaN);
  const ageMin = Number.isFinite(_ageMs) ? _ageMs / 60000 : Infinity;
  const dataPoints = (liq > 0 ? 1 : 0) + (hold > 0 ? 1 : 0) + (vol > 0 ? 1 : 0) + (mcap > 0 ? 1 : 0);
  const tooThin = dataPoints <= 1;
  let s = 0;
  s += Math.min(26, Math.log10(Math.max(liq, 1)) * 5.6);
  let liqRatio = null;
  if (mcap > 0 && liq > 0) { liqRatio = liq / mcap; s += liqRatio >= 0.15 ? 22 : liqRatio >= 0.08 ? 16 : liqRatio >= 0.03 ? 9 : liqRatio >= 0.01 ? 4 : 0; }
  s += Math.min(16, Math.log10(Math.max(hold, 1)) * 5.3);
  if (hold >= 50 && mcap > 0) { const perHolder = mcap / hold; s += perHolder < 500 ? 6 : perHolder < 2000 ? 3 : 0; }
  if (liq > 0) { const turn = vol / liq; s += (turn >= 0.1 && turn <= 4) ? 12 : (turn > 4 && turn <= 12) ? 6 : turn > 0 ? 3 : 0; }
  s += ageMin >= 30 ? 8 : ageMin >= 10 ? 5 : ageMin >= 3 ? 2 : 0;
  if (t.bond != null) s += (t.bond >= 20 && t.bond <= 90) ? 6 : 3;
  let score = Math.round(Math.max(3, Math.min(RISK_CEIL, s)));
  if (tooThin) score = Math.min(score, 28);
  const knowns = [];
  knowns.push(liq >= 30000 ? ['ok', '✓ Liq ' + formatMoney(liq)] : liq >= 5000 ? ['cau', 'Liq ' + formatMoney(liq)] : ['bad', 'Thin liq ' + formatMoney(liq || 0)]);
  knowns.push(hold >= 500 ? ['ok', '✓ ' + format(hold) + ' holders'] : hold >= 100 ? ['cau', format(hold) + ' holders'] : ['bad', (hold || 0) + ' holders']);
  if (liqRatio != null) knowns.push(liqRatio >= 0.08 ? ['ok', '✓ Liq ' + (liqRatio * 100).toFixed(0) + '% of mcap'] : ['bad', 'Liq only ' + (liqRatio * 100).toFixed(1) + '% of mcap']);
  const unknowns = ['LP lock duration', 'dev wallet plans', 'mint/freeze authority', 'bundled buys'];
  let verdict, tier, label;
  if (tooThin) { verdict = 'Too fresh to read'; tier = 'med'; label = 'Mixed'; }
  else if (score >= 60) { verdict = 'Looks steady — still risky'; tier = 'low'; label = 'Steady'; }
  else if (score >= 38) { verdict = 'Mixed signals'; tier = 'med'; label = 'Mixed'; }
  else { verdict = 'High risk'; tier = 'high'; label = 'Wild'; }
  return { score, verdict, tier, label, knowns, unknowns };
}

function normalize(t) {
  const rawMint = t && t.mint;
  if (!rawMint || typeof rawMint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawMint)) return null;
  const createdAtMs = t.pairCreatedAt ? new Date(t.pairCreatedAt).getTime() : null;
  let bond = Number(t.bondingProgress != null ? t.bondingProgress : (t.curveProgress != null ? t.curveProgress : NaN));
  bond = Number.isFinite(bond) ? Math.max(0, Math.min(100, bond)) : null;
  return {
    mint: rawMint, sym: t.sym || '???', name: t.name || t.sym || 'Unknown',
    icon: t.icon || null,
    price: Number(t.price || 0), change: Number(t.priceChange24h || 0),
    pairCreatedAtMs: createdAtMs,
    mcap: Number(t.mcap || t.fdv || 0), volume24h: Number(t.volume24h || 0),
    holders: Number(t.holders || 0), liquidity: Number(t.liquidity || 0),
    decimals: Number(t.decimals != null ? t.decimals : 6), pumpPool: t.pumpPool || 'auto',
    bond, dex: t.dexId || (t.pumpPool ? 'pump.fun' : null), source: 'dexscreener',
  };
}

/* ============================================================
   ERROR MAPPERS
   ============================================================ */
const friendlyError = (err) => {
  const m = String((err && err.message) || err || '').toLowerCase();
  if (m.includes('user reject') || m.includes('cancelled')) return 'Cancelled.';
  if (m.includes('graduat')) return 'Token graduated off the bonding curve — not tradable here.';
  if (m.includes('not a pump') || m.includes('not indexed')) return 'Not a pump.fun bonding-curve token.';
  if (m.includes('slippage')) return 'Price moved past slippage — try again.';
  if (m.includes('insufficient') || m.includes('debit an account')) return 'Not enough SOL for this trade + fees.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Tx expired — retry.';
  if (m.includes("didn't confirm") || m.includes('not confirm')) return "Sent but didn't confirm — check Solscan before retrying.";
  if (m.includes('simulation failed')) return 'Trade would fail right now — price likely moved.';
  if (m.includes('incorrectprogramid')) return 'Pump SDK fee-config stale — try again.';
  if (m.includes('rate')) return 'Rate limited — try again.';
  return (err && err.message ? err.message.slice(0, 200) : 'Trade failed.');
};
function describeSimLogs(logs, fallbackMsg) {
  const arr = Array.isArray(logs) ? logs : [];
  const j = arr.join('\n').toLowerCase();
  if (j.includes('slippage') || j.includes('toomuchsol') || j.includes('toolittlesol')) return 'Price moved past slippage — try again.';
  if (j.includes('insufficient') || j.includes('debit an account')) return 'Not enough SOL for the trade + fees.';
  if (j.includes('exceeded') && j.includes('compute')) return 'Hit the compute limit — retry.';
  const ctx = (arr.filter(l => /program log:|error|0x/i.test(l)).pop() || '').replace(/^Program log:\s*/i, '').slice(0, 150);
  if (ctx) return 'Sim failed -> ' + ctx;
  return fallbackMsg ? ('Sim failed -> ' + String(fallbackMsg).slice(0, 160)) : 'Sim failed (no logs).';
}

// Decode a Solana transaction error object (st.value.err) into plain language.
// The object is usually { InstructionError: [i, { Custom: <code> }] } or a bare
// string. Pump.fun's bonding-curve program throws a handful of custom codes;
// the most common buy failures are slippage and graduated/complete curves.
function describeOnChainErr(err) {
  if (err == null) return 'On-chain error.';
  if (typeof err === 'string') {
    const s = err.toLowerCase();
    if (s.includes('slippage')) return 'Slippage exceeded — price moved before it landed.';
    if (s.includes('insufficient')) return 'Not enough SOL for the trade + fees.';
    return 'On-chain error: ' + err.slice(0, 100);
  }
  try {
    const ie = err.InstructionError;
    if (Array.isArray(ie) && ie[1] && typeof ie[1] === 'object' && 'Custom' in ie[1]) {
      const code = ie[1].Custom;
      // Common pump.fun bonding-curve custom error codes.
      const map = {
        6000: 'Token not on a bonding curve (may have graduated).',
        6001: 'Slippage exceeded — price moved before it landed.',
        6002: 'Bonding curve complete — token graduated, trade on a DEX instead.',
        6003: 'Trade too small for this curve.',
        6004: 'Not enough SOL for the trade + fees.',
      };
      return map[code] || ('On-chain error (pump code ' + code + ') — token may have graduated or moved.');
    }
    if (Array.isArray(ie) && typeof ie[1] === 'string') {
      const s = ie[1].toLowerCase();
      if (s.includes('insufficient')) return 'Not enough SOL for the trade + fees.';
      return 'On-chain error: ' + ie[1];
    }
  } catch (e) {}
  return 'On-chain error: ' + JSON.stringify(err).slice(0, 100);
}

/* ============================================================
   COLOR
   ============================================================ */
function colorFor(mint) {
  const palette = ['#a855f7','#f472b6','#fb923c','#60a5fa','#22d3ee','#facc15','#16a34a','#ec4899','#0ea5e9','#fda4af','#f59e0b','#9333ea','#84cc16','#06b6d4','#dc2626'];
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
function shade(hex, p) {
  const f = parseInt(hex.slice(1), 16); const t = p < 0 ? 0 : 255; const pp = Math.abs(p) / 100;
  const R = f >> 16, G = (f >> 8) & 0xFF, B = f & 0xFF;
  return '#' + (0x1000000 + (Math.round((t - R) * pp) + R) * 0x10000 + (Math.round((t - G) * pp) + G) * 0x100 + (Math.round((t - B) * pp) + B)).toString(16).slice(1);
}

/* ============================================================
   TRADE PARAM BUILDERS
   NOTE: the BUY divisor 110n matches the server-side 10% slippage
   (1 + 10/100). If slippage changes server-side, change it here too.
   ============================================================ */
function buildBuyParams(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalLamports = BigInt(Math.floor(n * 1e9));
  if (totalLamports <= 0n) return null;
  const feeLamports = (totalLamports * BigInt(FEE_BPS)) / 10000n;
  const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
  if (tradeLamports <= 0n || feeLamports <= 0n) return null;
  return { mode: 'buy', solAmount: n, totalLamports: totalLamports.toString(), tradeLamports: tradeLamports.toString(), feeLamports: feeLamports.toString() };
}
function buildSellParams(token, pct, tokenBalance, solPrice) {
  if (!tokenBalance || !tokenBalance.amount || BigInt(tokenBalance.amount) <= 0n) return null;
  const p = Math.min(100, Math.max(0.01, pct));
  const tradeTokens = (BigInt(tokenBalance.amount) * BigInt(Math.floor(p * 100))) / 10000n;
  if (tradeTokens <= 0n) return null;
  const decimals = tokenBalance.decimals || token.decimals || 6;
  const tradeTokensUi = Number(tradeTokens) / Math.pow(10, decimals);
  let feeLamports = '0';
  if (token && token.price > 0 && solPrice > 0) {
    const grossSol = (tradeTokensUi * token.price) / solPrice;
    const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
    if (lam > 0) feeLamports = String(lam);
  }
  return { mode: 'sell', decimals, percentage: p, tradeTokens: tradeTokens.toString(), tradeTokensUi, feeLamports };
}
// 3% platform fee (in lamports, as a BigInt) for a sell of `uiAmount` tokens at
// `priceUsd`, given `solPriceUsd`. Same estimate as buildSellParams; used by the
// auto-trade exit loop + flatten so automated sells charge the fee like manual
// ones. Returns 0n when price/SOL price isn't known (matches the manual guard).
function sellFeeLamports(uiAmount, priceUsd, solPriceUsd) {
  if (!(uiAmount > 0) || !(priceUsd > 0) || !(solPriceUsd > 0)) return 0n;
  const grossSol = (uiAmount * priceUsd) / solPriceUsd;
  const lam = Math.floor(grossSol * (FEE_BPS / 10000) * 1e9);
  return lam > 0 ? BigInt(lam) : 0n;
}

/* ============================================================
   SHARE INTENTS
   ============================================================ */
function buildShareUrl() { if (typeof window === 'undefined') return ''; try { return new URL(window.location.origin + window.location.pathname).toString(); } catch (e) { return ''; } }
function buildTweetText(o) {
  const { mode, token, solAmount, outAmount, percentage } = o;
  if (mode === 'buy') {
    const recv = outAmount > 0 ? '\n-> ' + formatTokens(outAmount) + ' $' + token.sym : '';
    return 'Just caught $' + token.sym + ' on wonderland//radar — ' + solAmount + ' SOL' + recv + '\n\nFresh launches at first light:';
  }
  const got = outAmount > 0 ? '\n-> ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Sold ' + percentage + '% of $' + token.sym + ' on wonderland//radar' + got + '\n\nField log open here:';
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text }); if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
}
function inviteUrl(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/?ref=' + walletStr;
}
function shareUrlPath(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/share/' + walletStr;
}
function openTelegram(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ url: url || '', text });
  window.open('https://t.me/share/url?' + params, '_blank', 'noopener,noreferrer');
}
// Discord has no public web share-intent URL, so the reliable cross-client move
// is to copy a ready-to-paste message to the clipboard. Returns true on success
// so the caller can show a "copied — paste in Discord" toast.
async function openDiscord(text, url) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try { await navigator.clipboard.writeText((text || '') + (url ? '\n' + url : '')); return true; }
  catch (e) { return false; }
}

/* ============================================================
   REFERRAL HELPERS
   refLookup is cached per walletStr: the referrer never changes for a
   given burner, so the bot's 50th trade hits memory, not the network.
   refRegister / refLogTrade stay fire-and-forget.
   ============================================================ */
const _refCache = new Map();
async function refLookup(walletStr) {
  if (!walletStr) return { referrer: null, refSplitBps: 0 };
  if (_refCache.has(walletStr)) return _refCache.get(walletStr);
  try {
    const r = await fetch('/api/ref/lookup?wallet=' + encodeURIComponent(walletStr));
    if (!r.ok) { const v = { referrer: null, refSplitBps: 0 }; _refCache.set(walletStr, v); return v; }
    const d = await r.json();
    const v = (!d || !d.referrer)
      ? { referrer: null, refSplitBps: 0 }
      : { referrer: d.referrer, refSplitBps: Number(d.refSplitBps) || 0 };
    _refCache.set(walletStr, v);
    return v;
  } catch (e) { return { referrer: null, refSplitBps: 0 }; }
}
function refRegister(walletStr, referrer, boost) {
  try {
    fetch('/api/ref/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletStr, referrer: referrer || null, boost: boost || null }),
    }).catch(() => {});
  } catch (e) {}
}
function refLogTrade(payload) {
  try {
    fetch('/api/ref/log-trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) {}
}

/* ============================================================
   PUMP ROUTE  (hits the dedicated Ape route)
   ALT cache: Pump.fun's address lookup table is stable for the life of
   the session. The first trade pays for the getMultipleAccountsInfo;
   every subsequent trade hits memory.
   ============================================================ */
const APE_PUMP_ROUTE = '/api/ape/pump-trade';
const APE_JUP_ROUTE  = '/api/ape/jup-trade';
const _altCache = new Map(); // base58 key -> AddressLookupTableAccount

async function decodeBuiltTx(b64, connection) {
  const txBytes = Buffer.from(b64, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
  const message = tx.message;
  const lookupKeys = (message.addressTableLookups || []).map(l => l.accountKey);
  const alts = [];
  if (lookupKeys.length > 0) {
    const uncached = [];
    for (const k of lookupKeys) {
      const hit = _altCache.get(k.toBase58());
      if (hit) alts.push(hit);
      else uncached.push(k);
    }
    if (uncached.length > 0) {
      const infos = await connection.getMultipleAccountsInfo(uncached);
      for (let i = 0; i < uncached.length; i++) {
        if (!infos[i]) continue;
        const alt = new AddressLookupTableAccount({
          key: uncached[i],
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        });
        _altCache.set(uncached[i].toBase58(), alt);
        alts.push(alt);
      }
    }
  }
  const decompiled = TransactionMessage.decompile(message, { addressLookupTableAccounts: alts });
  return { instructions: decompiled.instructions, alts };
}

async function getPumpRoute(opts) {
  const { action, mint, user, amount, decimals, connection } = opts;
  const body = { action, mint, user: user.toBase58(), amount: String(amount) };
  if (decimals != null) body.decimals = Number(decimals);
  const r = await fetch(APE_PUMP_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // 409 'graduated' is the distinct signal to fall back to Jupiter.
    const err = new Error((data && data.error) || ('pump HTTP ' + r.status));
    if (r.status === 409 || (data && data.error === 'graduated')) err.graduated = true;
    throw err;
  }
  if (!data.tx) throw new Error('PumpPortal returned no tx.');
  const dec = await decodeBuiltTx(data.tx, connection);
  return { instructions: dec.instructions, alts: dec.alts, pool: data.pool, route: data.route };
}

// Jupiter route for graduated tokens. Same call shape + return shape as
// getPumpRoute, so executeSwap can use either interchangeably. The returned
// tx is a full Jupiter swap (burner = userPublicKey); we decode it to
// instructions + ALTs so the fee/referral transfer can be appended exactly
// like the pump path, then recompile + sign once.
async function getJupRoute(opts) {
  const { action, mint, user, amount, decimals, connection } = opts;
  const body = { action, mint, user: user.toBase58(), amount: String(amount) };
  if (decimals != null) body.decimals = Number(decimals);
  const r = await fetch(APE_JUP_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error) || ('jupiter HTTP ' + r.status));
  if (!data.tx) throw new Error('Jupiter returned no tx.');
  const dec = await decodeBuiltTx(data.tx, connection);
  // outAmount = exact units out from the Jupiter quote. For a SELL (mint->SOL)
  // this is the exact lamports received, which gives an exact P&L basis
  // instead of a price estimate. For a BUY it's token units (unused — buy
  // P&L uses SOL in).
  return { instructions: dec.instructions, alts: dec.alts, route: data.route || 'jupiter', outAmount: data.outAmount != null ? String(data.outAmount) : null };
}

/* ============================================================
   BUY/SELL HOT PATH
   Speed work in this revision:
     · Promise.all the three independent network calls (route fetch,
       blockhash, refLookup) instead of running them in series.
     · Confirmation loop: 800ms poll, searchTransactionHistory: false.
       Rebroadcast every ~3.2s, blockheight check every ~4.8s. Bail
       early on on-chain error / past lastValidBlockHeight.
     · ALT and referrer caches above eliminate the per-trade lookups
       after the first call.

   Inputs are passed explicitly to keep the React wrapper's useCallback
   dep array stable across solPrice / balance refreshes.
   ============================================================ */
async function apeExecuteSwap({ mode, swapParams, token, keypair, userPk, tradeConnection, walletStr, refWalletStr, solPrice }) {
  if (!swapParams) throw new Error('No trade params.');
  const isBuy = mode === 'buy';
  const feeLamports = BigInt(swapParams.feeLamports || '0');

  // Fire the three independent network calls in parallel.
  // refLookup is cached after first call; the first call costs ~80–200ms.
  const routeP = (async () => {
    try {
      return await getPumpRoute({
        action: isBuy ? 'buy' : 'sell',
        mint: token.mint,
        user: userPk,
        amount: isBuy ? swapParams.tradeLamports : swapParams.tradeTokens,
        decimals: isBuy ? undefined : swapParams.decimals,
        connection: tradeConnection,
      });
    } catch (e) {
      // Graduated off the bonding curve → route through Jupiter instead.
      if (e && e.graduated) {
        return await getJupRoute({
          action: isBuy ? 'buy' : 'sell',
          mint: token.mint,
          user: userPk,
          amount: isBuy ? swapParams.tradeLamports : swapParams.tradeTokens,
          decimals: isBuy ? undefined : swapParams.decimals,
          connection: tradeConnection,
        });
      }
      throw e;
    }
  })();

  const [route, latest, refData] = await Promise.all([
    routeP,
    tradeConnection.getLatestBlockhash('confirmed'),
    feeLamports > 0n
      ? refLookup(refWalletStr || walletStr).catch(() => ({ referrer: null, refSplitBps: 0 }))
      : Promise.resolve({ referrer: null, refSplitBps: 0 }),
  ]);

  const ixs = [...route.instructions];

  if (feeLamports > 0n) {
    ixs.push(SystemProgram.transfer({ fromPubkey: userPk, toPubkey: FEE_WALLET, lamports: feeLamports }));
    if (refData.referrer && refData.refSplitBps > 0) {
      const refLamports = (feeLamports * BigInt(refData.refSplitBps)) / 10000n;
      if (refLamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: userPk, toPubkey: new PublicKey(refData.referrer), lamports: refLamports }));
    }
  }

  const message = new TransactionMessage({
    payerKey: userPk,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message(route.alts);
  const tx = new VersionedTransaction(message);

  // [wr-sim] removed — PumpPortal tx is pre-validated; sim was doubling RPC
  // cost per trade. Send-error path below still uses describeSimLogs() on
  // returned logs.

  tx.sign([keypair]);
  const raw = tx.serialize();

  let sig;
  try {
    sig = await tradeConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
  } catch (sendErr) {
    let logs = (sendErr && sendErr.logs) || null;
    if (!logs && sendErr && typeof sendErr.getLogs === 'function') {
      try { logs = await sendErr.getLogs(tradeConnection); } catch (e2) {}
    }
    throw new Error(describeSimLogs(logs, sendErr && sendErr.message));
  }

  // Fast confirmation loop.
  // Status check every 800ms (searchTransactionHistory: false — we just sent
  // it, no need to scan archive). Rebroadcast every 4 polls (~3.2s).
  // Blockheight check every 6 polls (~4.8s) — cheap bail-out for expiry.
  let confirmed = false;
  let onchainErr = null;
  const startedAt = Date.now();
  const HARD_CAP_MS = 60000;
  const POLL_MS = 800;
  const REBROADCAST_EVERY = 4;
  const BLOCKHEIGHT_CHECK_EVERY = 6;
  let pollCount = 0;

  while (Date.now() - startedAt < HARD_CAP_MS) {
    try {
      const st = await tradeConnection.getSignatureStatus(sig, { searchTransactionHistory: false });
      if (st && st.value && st.value.err) { onchainErr = st.value.err; break; }
      const cs = st && st.value && st.value.confirmationStatus;
      if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
    } catch (e) {}

    pollCount++;

    if (pollCount % BLOCKHEIGHT_CHECK_EVERY === 0) {
      try {
        const h = await tradeConnection.getBlockHeight('confirmed');
        if (h > latest.lastValidBlockHeight) break;
      } catch (e) {}
    }

    if (pollCount % REBROADCAST_EVERY === 0) {
      try { await tradeConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch (e) {}
    }

    await new Promise(r => setTimeout(r, POLL_MS));
  }

  if (onchainErr) throw new Error(describeOnChainErr(onchainErr));
  if (!confirmed) throw new Error("Sent but didn't confirm in time — check Solscan before retrying.");

  // log to referral / pnl ledger (fire and forget)
  try {
    let volSol;
    if (isBuy) {
      volSol = Number(swapParams.tradeLamports) / 1e9;
    } else if (route && route.outAmount != null && Number(route.outAmount) > 0) {
      // Exact SOL received from the route's quote (Jupiter sell = mint->SOL,
      // outAmount is lamports). More accurate than the price estimate and
      // never zero on a confirmed trade.
      volSol = Number(route.outAmount) / 1e9;
    } else {
      // Fallback: estimate from current price (pump route has no quote-out).
      volSol = (swapParams.tradeTokensUi * (token.price || 0)) / (solPrice || 1);
    }
    refLogTrade({ wallet: walletStr, mint: token.mint, sym: token.sym, side: mode, sol: volSol, sig, ts: Date.now() });
  } catch (e) {}

  return { confirmed: true, sig };
}


/* ============================================================
   CSS — pastel Wonderland-light palette throughout
   ============================================================ */
const AP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&display=swap');

.ap-root{
  --ink:#0b0b0c; --ink2:#86868b; --ink3:#aeaeb2;
  --hairline:#f1f1f2; --hairline2:#e9e9eb;
  --cyan:#11b87f; --sky:#16c08a; --pink:#f0425a; --lav:#7c5cff; --mint:#16c08a;
  --peach:#f5921b; --gold:#a67200; --green:#11b87f; --greent:#0f9d6c; --red:#f0425a; --amber:#a67200;
  --orange:#f5921b; --purple:#7c5cff; --blue:#2f6bff;
  --cream:#ffffff; --dep:#3ee07f; --buyblk:#0b0b0c;
  --glass:#ffffff; --glass-strong:#ffffff;
  --fill:#f4f4f5; --fill2:#fafafa;
  --border:#e9e9eb; --border-hi:#d4d4d8;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink); position:relative; overflow-x:hidden; padding-bottom:46px;
  background:#ffffff;
  -webkit-font-smoothing:antialiased;
}
.ap-root,.ap-root *{box-sizing:border-box}
.ap-root [class*="num"],.ap-root .num{font-variant-numeric:tabular-nums}
@keyframes ap-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes ap-spin{to{transform:rotate(360deg)}}
@keyframes ap-fade{from{opacity:0}to{opacity:1}}
@keyframes ap-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes ap-pop{0%{opacity:0;transform:scale(.98)}60%{transform:scale(1.005)}100%{opacity:1;transform:scale(1)}}
@keyframes ap-sheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes ap-shimmer{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes ap-cta-glow{0%,100%{box-shadow:none}50%{box-shadow:none}}
@keyframes ap-confetti{0%{transform:translate(-50%,-50%) rotate(0);opacity:1}100%{transform:translate(calc(-50% + var(--dx,0)),calc(-50% + var(--dy,400px))) rotate(var(--dr,720deg));opacity:0}}
@keyframes ap-toast{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}

.ap-app{max-width:1280px;margin:0 auto;position:relative;z-index:5}
.ap-page{padding:16px 28px 80px}
@media(max-width:768px){.ap-page{padding:12px 14px 80px}}

/* NAV */
.ap-nav{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:10px;padding:11px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hairline)}
.ap-brand{display:flex;align-items:center;gap:9px;cursor:pointer}
.ap-brand-glyph{width:28px;height:28px;border-radius:8px;background:#0b0b0c;display:grid;place-items:center;flex-shrink:0;font-family:inherit;font-style:normal;font-size:15px;font-weight:800;color:#fff}
.ap-bname{font-family:inherit;font-size:17px;letter-spacing:-.01em;line-height:1;color:var(--ink);font-weight:700}
.ap-bname .it{font-style:normal;color:var(--ink2);font-weight:600}
.ap-bname .dot{color:var(--ink3);margin:0 3px;font-weight:500}
.ap-nav-live{margin-left:auto;display:flex;align-items:center;gap:5px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--greent);background:rgba(22,192,138,.12);padding:5px 10px;border-radius:999px;border:none}
.ap-nav-live .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:ap-pulse 1.4s infinite}
.ap-nav-btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 13px;background:var(--fill);border:1px solid transparent;border-radius:999px;color:var(--ink);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:.14s}
.ap-nav-btn:hover{background:#ececee}
.ap-nav-wallet{display:flex;align-items:center;gap:7px;padding:8px 13px;background:#0b0b0c;border:none;border-radius:999px;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;color:#fff;position:relative;font-variant-numeric:tabular-nums;transition:.14s}
.ap-nav-wallet:hover{opacity:.92}
.ap-nav-wallet.ap-connected{background:var(--fill);color:var(--ink)}
.ap-nav-wallet .glyph{color:#fff;font-weight:800;font-family:initial}
.ap-nav-wallet.ap-connected .glyph{color:var(--ink)}
.ap-nav-wallet .dot{width:6px;height:6px;border-radius:50%;background:var(--dep)}
.ap-nav-wallet .nudge{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:var(--orange);border:2px solid #fff}
@media(max-width:600px){.ap-nav{padding:10px 14px;gap:8px}.ap-nav-live{display:none}.ap-nav-btn{padding:8px 11px;font-size:12px}}
@media(max-width:430px){.ap-nav{gap:6px;padding:10px 12px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.ap-nav::-webkit-scrollbar{display:none}.ap-nav>*{flex-shrink:0}.ap-nav-btn{padding:7px 9px;font-size:11.5px;white-space:nowrap}.ap-nav-wallet{padding:7px 10px;font-size:11px;white-space:nowrap}.ap-bname{font-size:16px}}

/* QUICK BUY BAR */
.ap-qbar{position:sticky;top:50px;z-index:55;display:flex;align-items:center;gap:7px;padding:10px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hairline);overflow-x:auto;scrollbar-width:none}
.ap-qbar::-webkit-scrollbar{display:none}
.ap-qlabel{font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);flex-shrink:0;display:inline-flex;align-items:center;gap:5px}
.ap-qlabel .b{color:var(--orange);font-size:11px}
.ap-qamt{flex-shrink:0;display:inline-flex;align-items:center;gap:4px;padding:7px 13px;border-radius:999px;background:var(--fill);border:1px solid transparent;color:var(--ink);font-family:inherit;font-weight:700;font-size:12.5px;cursor:pointer;font-variant-numeric:tabular-nums;transition:.12s}
.ap-qamt:hover{background:#ececee}
.ap-qamt.active{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-qamt .s{opacity:.55;font-size:11px}
.ap-qamt.active .s{opacity:.7}
.ap-qedit{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:var(--fill);border:none;display:grid;place-items:center;color:var(--ink2);font-size:13px;cursor:pointer}
.ap-qedit:hover{color:var(--ink)}
.ap-qfast{flex-shrink:0;margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.04em;color:var(--greent);background:rgba(22,192,138,.12);padding:6px 10px;border-radius:999px;white-space:nowrap;border:none}
.ap-qfast .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:ap-pulse 1.3s infinite}
@media(max-width:768px){.ap-qbar{padding:9px 14px}}

/* HERO — removed in JSX */
.ap-hero{display:none}
.ap-hero h1{display:none}
.ap-hero-cta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ap-pill-no-connect{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:10.5px;font-weight:700;color:var(--greent);padding:7px 12px;border-radius:999px;background:rgba(22,192,138,.12);border:none}
.ap-hero-ref{display:inline-flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;border:1px solid var(--hairline2);background:#fff;color:var(--ink);font-family:inherit;font-size:15px;font-weight:600;letter-spacing:-.005em;cursor:pointer;transition:.14s}
.ap-hero-ref:hover{border-color:var(--border-hi)}
.ap-hero-ref .it{font-style:normal;color:var(--ink2)}
.ap-hero-ref .pct{font-family:inherit;font-weight:800;font-size:10px;color:#fff;background:#0b0b0c;padding:4px 9px;border-radius:7px;letter-spacing:.04em;font-style:normal}

/* DEPOSIT LURE — flat black */
.ap-lure{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;background:#0b0b0c;border:none;margin-bottom:16px;animation:ap-rise .35s cubic-bezier(.2,1,.3,1);color:#fff}
.ap-lure-text{flex:1;min-width:0}
.ap-lure-h{font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.2;color:#fff}
.ap-lure-h .it{font-style:normal;color:#fff}
.ap-lure-s{font-family:inherit;font-size:11px;font-weight:600;color:rgba(255,255,255,.6);margin-top:5px}
.ap-lure-s b{color:#fff;font-weight:800}
.ap-lure-intro{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.04em;color:#0b0b0c;background:#fff;border:none;padding:10px 13px;border-radius:10px;flex-shrink:0;cursor:pointer;transition:.14s}
.ap-lure-intro:hover{opacity:.9}
.ap-lure-close{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.12);border:none;color:rgba(255,255,255,.7);font-size:14px;cursor:pointer;flex-shrink:0;font-family:initial}
.ap-lure-close:hover{color:#fff}

/* OPEN POSITIONS */
.ap-positions{background:#fff;border:1px solid var(--hairline);border-radius:16px;overflow:hidden;margin-bottom:16px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1);box-shadow:0 1px 2px rgba(11,11,12,.04)}
.ap-positions-head{padding:12px 16px 9px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.ap-positions-head .e{font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink2)}
.ap-positions-head .roll{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);font-variant-numeric:tabular-nums}
.ap-positions-head .roll b{color:var(--greent);font-weight:800}
.ap-positions-head .roll b.dn{color:var(--red)}
.ap-pos-strip-row{padding:10px 16px;display:flex;align-items:center;gap:12px;border-top:1px solid var(--hairline)}
.ap-pos-strip-av{flex-shrink:0;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-family:inherit;font-style:normal;font-weight:800;font-size:12px;color:#fff;overflow:hidden}
.ap-pos-strip-av img{width:100%;height:100%;object-fit:cover}
.ap-pos-strip-sym{font-family:inherit;font-size:14px;font-weight:700;letter-spacing:-.005em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.ap-pos-strip-pnl{font-family:inherit;font-weight:800;font-size:13px;color:var(--greent);font-variant-numeric:tabular-nums}
.ap-pos-strip-pnl.dn{color:var(--red)}
.ap-pos-strip-pnl.dim{color:var(--ink3);font-weight:600}
.ap-pos-strip-pct{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.ap-pos-strip-pct.up{color:var(--greent)}
.ap-pos-strip-pct.dn{color:var(--red)}
.ap-positions-foot{padding:11px 16px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2);text-align:right;border-top:1px solid var(--hairline);cursor:pointer;background:none;border-left:none;border-right:none;border-bottom:none;width:100%;display:block;transition:color .14s}
.ap-positions-foot:hover{color:var(--ink)}

/* TRENDING */
.ap-trending{margin-bottom:16px}
.ap-trending-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:0 2px 9px}
.ap-trending-head .lbl{font-family:inherit;font-size:13px;font-weight:800;letter-spacing:-.01em;color:var(--ink);display:inline-flex;align-items:center;gap:6px}
.ap-trending-head .meta{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink3)}
.ap-trending-rail{display:flex;gap:9px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}
.ap-trending-rail::-webkit-scrollbar{display:none}
.ap-trend-card{flex:0 0 auto;min-width:150px;padding:11px 13px;border-radius:14px;background:#fff;border:1px solid var(--hairline);display:flex;align-items:center;gap:9px;cursor:pointer;transition:border-color .14s;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.ap-trend-card:hover{border-color:var(--border-hi)}
.ap-trend-card .av{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-family:inherit;font-style:normal;font-weight:800;font-size:13px;color:#fff;flex-shrink:0;overflow:hidden}
.ap-trend-card .av img{width:100%;height:100%;object-fit:cover}
.ap-trend-card .meta{min-width:0;flex:1}
.ap-trend-card .sym{font-family:inherit;font-size:14.5px;font-weight:700;letter-spacing:-.005em;line-height:1;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-trend-card .chg{font-family:inherit;font-size:12px;font-weight:800;margin-top:3px;color:var(--greent);font-variant-numeric:tabular-nums}
.ap-trend-card .chg.dn{color:var(--red)}

/* LIST FRAME */
.ap-list-frame{background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:18px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.ap-list-head{padding:15px 16px 12px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--hairline);flex-wrap:wrap}
.ap-list-title{display:flex;flex-direction:column;gap:3px}
.ap-list-title .e{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.ap-list-title .t{font-family:inherit;font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.ap-list-title .t .it{font-style:normal;color:var(--ink2)}
.ap-list-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ap-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--fill);border:1px solid transparent;font-size:12px;font-weight:700;color:var(--ink2);cursor:pointer;transition:.14s}
.ap-chip:hover{color:var(--ink)}
.ap-chip.on{background:#0b0b0c;border-color:transparent;color:#fff}
.ap-chip.owned.on{background:#0b0b0c;border-color:transparent;color:#fff}
.ap-filter-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--fill);border:1px solid transparent;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;transition:.14s}
.ap-filter-btn:hover{background:#ececee}
.ap-filter-btn .ct{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 5px;border-radius:99px;background:#0b0b0c;color:#fff;font-family:inherit;font-weight:800;font-size:9.5px}

/* ROWS */
.ap-list{padding:0}
.ap-row{display:grid;grid-template-columns:1fr 90px 80px 100px 80px;gap:14px;align-items:center;padding:13px 18px;border-bottom:1px solid var(--hairline);cursor:pointer;transition:background .15s;animation:ap-pop .35s cubic-bezier(.2,1.2,.4,1) backwards}
.ap-row:last-child{border-bottom:none}
.ap-row:hover{background:var(--fill2)}
.ap-row.fresh{animation:ap-pop .5s cubic-bezier(.2,1,.3,1)}
.ap-row-tk{display:flex;align-items:center;gap:11px;min-width:0}
.ap-av{width:44px;height:44px;border-radius:13px;flex-shrink:0;display:grid;place-items:center;font-family:inherit;font-weight:800;font-size:17px;color:#fff;text-transform:uppercase;overflow:hidden;position:relative}
.ap-av img{width:100%;height:100%;object-fit:cover}
.ap-av .age-dot{position:absolute;bottom:-3px;right:-3px;font-family:inherit;font-size:8.5px;font-weight:800;color:#fff;padding:1px 5px;border-radius:6px;background:var(--green);box-shadow:0 0 0 2px #fff;letter-spacing:.02em;line-height:1.3;font-variant-numeric:tabular-nums}
.ap-av .age-dot.warm{background:var(--ink3)}
.ap-av .age-dot.old{background:var(--ink3)}
.ap-av .age-dot.fresh{background:var(--green);box-shadow:0 0 0 2px #fff;animation:ap-pulse 1.4s infinite}
.ap-name{min-width:0;flex:1}
.ap-sym-row{font-family:inherit;font-weight:700;font-size:15.5px;letter-spacing:-.01em;color:var(--ink);display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1}
.ap-sym-row .chg{font-family:inherit;font-size:12px;font-weight:700;color:var(--greent);font-variant-numeric:tabular-nums}
.ap-sym-row .chg.dn{color:var(--red)}
.ap-name-line{font-size:12px;color:var(--ink2);font-weight:600;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.ap-name-line .price{color:var(--ink);font-weight:700;font-family:inherit}
.ap-name-line .dot{color:var(--ink3);opacity:.6;margin:0 4px}
.ap-name-line .mcap{color:var(--ink);font-family:inherit;font-weight:600}
.ap-name-line .ghost{color:var(--ink3);font-family:inherit;font-weight:600;font-size:11px}
.ap-name-line .ownedusd{color:var(--greent);font-family:inherit;font-weight:700}
.ap-spark{width:76px;height:32px;flex-shrink:0}
.ap-spark svg{display:block;width:100%;height:100%}
.ap-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.02em;text-transform:lowercase}
.ap-pill .d{width:5px;height:5px;border-radius:50%;background:currentColor}
.ap-pill.low{background:rgba(22,192,138,.12);color:var(--greent)}
.ap-pill.med{background:rgba(166,114,0,.12);color:var(--gold)}
.ap-pill.high{background:rgba(240,66,90,.10);color:var(--red)}
.ap-owned-mark{font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.02em;padding:2px 7px;border-radius:6px;background:rgba(22,192,138,.14);color:var(--greent);text-transform:uppercase;font-style:normal}
.wa-locked-edit{grid-column:1/-1;margin-bottom:4px}
.ap-row-action{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.ap-row-pnl{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:1px;margin-left:8px;min-width:74px;flex-shrink:0;font-family:inherit;line-height:1.1;font-variant-numeric:tabular-nums}
.ap-row-pnl .pct{font-size:13px;font-weight:800;letter-spacing:-.01em;color:var(--ink2)}
.ap-row-pnl .sol{font-size:10px;font-weight:700;color:var(--ink3)}
.ap-row-pnl.up .pct,.ap-row-pnl.up .sol{color:var(--greent)}
.ap-row-pnl.dn .pct,.ap-row-pnl.dn .sol{color:var(--red)}
.ap-btn-buy{padding:9px 14px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;background:var(--buyblk);color:#fff;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;transition:opacity .18s}
.ap-btn-buy:hover{opacity:.88}
.ap-btn-buy:disabled{opacity:.55;cursor:wait}
.ap-btn-buy .arrow{font-family:inherit;font-weight:800;font-size:11px;color:#ffd23f}
.ap-btn-buy.compact{padding:8px 12px;font-size:12px}
.ap-btn-sell{padding:9px 13px;border-radius:999px;border:1px solid var(--border);cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;background:var(--fill);color:var(--ink);transition:.12s}
.ap-btn-sell:hover{background:#ececee}
.ap-btn-sell:disabled{opacity:.55;cursor:wait}
.ap-spinner{width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:ap-spin .7s linear infinite;display:inline-block}
.ap-list-foot{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:inherit;font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.04em;text-transform:uppercase;border-top:1px solid var(--hairline);font-variant-numeric:tabular-nums}
.ap-list-foot .live{display:inline-flex;align-items:center;gap:6px;color:var(--greent)}
.ap-list-foot .live .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:ap-pulse 1.4s infinite}
.ap-list-foot .live.warn{color:var(--gold)}
.ap-list-foot .live.warn .d{background:var(--orange)}
@media(max-width:820px){.ap-row{grid-template-columns:1fr 46px auto;gap:10px;padding:11px 16px}.ap-row .ap-pill{display:none}.ap-spark{width:44px;height:26px}.ap-row.owned{grid-template-columns:1fr 64px auto}.ap-row.owned .ap-spark{display:none}}
@media(max-width:560px){.ap-list-head{padding:14px 14px}}

.ap-empty{padding:46px 24px;text-align:center;color:var(--ink2);font-size:14px}
.ap-empty .glyph{display:block;font-family:inherit;font-style:normal;font-size:40px;color:var(--ink3);margin-bottom:12px}
.ap-empty b{display:block;color:var(--ink);font-family:inherit;font-size:20px;font-weight:800;letter-spacing:-.01em;margin-bottom:6px}
.ap-empty .sub{font-size:13px;color:var(--ink3);max-width:380px;margin:0 auto;line-height:1.5}
.ap-empty .err{margin-top:10px;font-family:inherit;font-size:10.5px;color:var(--red);background:rgba(240,66,90,.08);padding:8px 12px;border-radius:9px;display:inline-block}

/* OVERLAY / SHEET */
.ap-overlay{position:fixed;inset:0;background:rgba(11,11,12,.4);backdrop-filter:blur(6px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:ap-fade .2s}
.ap-overlay.center{align-items:center;padding:18px}
.ap-sheet{width:100%;max-width:520px;background:#ffffff;border:none;border-radius:24px 24px 0 0;box-shadow:0 -18px 50px rgba(11,11,12,.18);animation:ap-sheet .3s cubic-bezier(.2,1.2,.4,1);max-height:94dvh;overflow-y:auto;padding-bottom:max(8px,env(safe-area-inset-bottom))}
.ap-sheet.mini{border-radius:24px;animation:ap-pop .3s ease;max-width:430px}
.ap-x{position:absolute;top:14px;right:14px;background:var(--fill);border:none;border-radius:50%;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;font-size:16px;color:var(--ink2);z-index:2;font-family:initial}
.ap-x:hover{color:var(--ink)}
.ap-tshead{padding:22px 22px 6px;position:relative}
.ap-tshead-row{display:flex;align-items:center;gap:13px;padding-right:38px}
.ap-tshead .ap-av{width:54px;height:54px;border-radius:14px;font-size:20px}
.ap-tshead .title{flex:1;min-width:0}
.ap-tshead .sym{font-family:inherit;font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1;color:var(--ink)}
.ap-tshead .sub{font-family:inherit;font-size:13px;color:var(--ink2);font-weight:600;margin-top:6px;font-variant-numeric:tabular-nums}

/* DETAIL CHART (TokenChart) — live embedded iframe (bigger, responsive) */
.ap-chart-wrap{margin:14px 22px 0;padding:14px 0 6px;border-top:1px solid var(--hairline)}
.ap-chart-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.ap-chart-ca{display:flex;align-items:center;gap:7px;min-width:0}
.ap-chart-ca .lbl{font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--ink3);flex-shrink:0}
.ap-chart-ca .val{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-chart-ca .cp{flex-shrink:0;font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:#0b0b0c;border:none;border-radius:7px;padding:5px 9px;cursor:pointer;transition:opacity .15s}
.ap-chart-ca .cp:hover{opacity:.88}
.ap-chart-src{flex-shrink:0;font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase}
.ap-chart-embed{position:relative;width:100%;height:clamp(320px,44dvh,460px);border:1px solid var(--hairline);border-radius:16px;overflow:hidden;background:#fff}
.ap-chart-frame{width:100%;height:100%;border:0;display:block}
.ap-chart-state{display:grid;place-items:center;width:100%;height:clamp(320px,44dvh,460px);border:1px solid var(--hairline);border-radius:16px;background:var(--fill2);color:var(--ink2);font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.5;text-align:center;padding:24px}
.ap-chart-state .sp{width:24px;height:24px;border-radius:50%;border:2.5px solid var(--border);border-top-color:#0b0b0c;animation:ap-spin .8s linear infinite}
.ap-tf:disabled{opacity:.4;cursor:default}
@media(max-width:600px){.ap-chart-wrap{margin:14px 16px 0}.ap-chart-embed,.ap-chart-state{height:clamp(300px,52dvh,440px)}}

/* RESEARCH */
.ap-research{margin:12px 22px 0;padding:14px;background:#fff;border:1px solid var(--hairline);border-radius:16px}
.ap-research-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px 10px}
.ap-rstat{display:flex;flex-direction:column;gap:3px}
.ap-rstat .k{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.ap-rstat .v{font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--ink);font-variant-numeric:tabular-nums}
.ap-research-links{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline)}
.ap-share-row{display:flex;gap:8px;margin-top:10px}
.ap-share{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:12px;font-weight:700;border:none;border-radius:11px;padding:11px 0;color:#fff;cursor:pointer;transition:opacity .18s}
.ap-share:hover{opacity:.9}
.ap-share.x{background:#0b0b0c}
.ap-share.tg{background:#229ED9}
.ap-share.dc{background:#5865F2}
.ap-share.dc.done{background:var(--green)}
.ap-rlink{flex:1;font-family:inherit;font-size:10.5px;font-weight:700;color:var(--ink);text-decoration:none;text-align:center;padding:10px;background:var(--fill);border:none;border-radius:10px}
.ap-rlink:hover{background:#ececee}
.ap-rcopy{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);background:var(--fill);border:none;border-radius:10px;padding:10px 12px;cursor:pointer}

/* WATCHED WALLETS DRAWER */
.ap-watch{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:480px;max-height:88dvh;overflow-y:auto;background:#ffffff;border-top-left-radius:26px;border-top-right-radius:26px;border:none;padding:18px 18px calc(env(safe-area-inset-bottom,0) + 22px);z-index:9999;animation:ap-sheet .34s cubic-bezier(.2,1.1,.4,1)}
.ap-watch-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.ap-watch-title{font-family:inherit;font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}
.ap-watch-title .it{font-style:normal;color:var(--ink2)}
.ap-watch-add{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.ap-watch-in{grid-column:1/2;padding:12px 14px;background:var(--fill);border:1px solid transparent;border-radius:12px;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink);outline:none}
.ap-watch-in.label{grid-column:1/2}
.ap-watch-in:focus{border-color:var(--border-hi)}
.ap-watch-addbtn{grid-row:1/3;grid-column:2/3;padding:0 18px;background:#0b0b0c;border:none;border-radius:12px;font-family:inherit;font-size:14px;font-weight:700;color:#fff;cursor:pointer}
.ap-watch-err{margin-top:8px;font-family:inherit;font-size:11px;color:var(--red);font-weight:600}
.ap-watch-empty{text-align:center;padding:36px 20px;display:flex;flex-direction:column;align-items:center;gap:7px}
.ap-watch-empty .glyph{font-size:28px;opacity:.4}
.ap-watch-empty b{font-family:inherit;font-size:18px;font-weight:800;color:var(--ink)}
.ap-watch-empty .sub{font-size:12px;color:var(--ink2);max-width:280px;line-height:1.5}
.ap-watch-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.ap-watch-row{padding:13px 14px;background:#fff;border:1px solid var(--hairline);border-radius:15px}
.ap-watch-row-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ap-watch-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.ap-watch-id .lbl{font-family:inherit;font-size:16px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-watch-id .addr{font-family:inherit;font-size:9.5px;color:var(--ink3);font-variant-numeric:tabular-nums}
.ap-watch-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
.ap-watch-actions .sol{font-family:inherit;font-size:12px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.ap-watch-actions .rm{width:24px;height:24px;border-radius:50%;border:none;background:var(--fill);color:var(--ink3);font-size:15px;line-height:1;cursor:pointer}
.ap-watch-holds{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.ap-watch-holds .hold{font-family:inherit;font-size:10px;font-weight:700;color:var(--ink2);background:var(--fill);border:none;border-radius:7px;padding:3px 8px}
.ap-watch-links{display:flex;gap:8px;margin-top:11px;padding-top:10px;border-top:1px solid var(--hairline)}
.ap-watch-links a{flex:1;text-align:center;font-family:inherit;font-size:10px;font-weight:700;color:var(--ink);text-decoration:none;padding:8px;background:var(--fill);border:none;border-radius:9px}

/* HOT WINDOW + DISCOVERY */
.ap-hotwin{display:flex;align-items:center;gap:6px;padding:10px 16px 0}
.ap-hotwin-pill{font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink2);background:var(--fill);border:none;border-radius:999px;padding:6px 12px;cursor:pointer}
.ap-hotwin-pill.on{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-hotwin-meta{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3);margin-left:auto}
.ap-disc{padding:4px 16px 10px}
.ap-disc-sorts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ap-disc-sort{font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink2);background:var(--fill);border:none;border-radius:999px;padding:6px 12px;cursor:pointer}
.ap-disc-sort.on{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-disc-ftoggle{margin-left:auto;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);background:var(--fill);border:none;border-radius:999px;padding:6px 12px;cursor:pointer}
.ap-disc-ftoggle.on{color:#fff;background:#0b0b0c}
.ap-disc-filters{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:11px;padding:13px;background:var(--fill2);border:1px solid var(--hairline);border-radius:14px}
.ap-disc-f{display:flex;flex-direction:column;gap:4px}
.ap-disc-f span{font-family:inherit;font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.ap-disc-f select{font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--border);border-radius:9px;padding:8px 10px;outline:none;cursor:pointer}
.ap-disc-f select:focus{border-color:var(--border-hi)}
.ap-disc-clear{grid-column:1/3;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:var(--red);background:rgba(240,66,90,.08);border:none;border-radius:9px;padding:9px;cursor:pointer}

/* MINI CHART (legacy) */
.ap-chart{position:relative;width:100%;height:84px;display:block}
.ap-chart svg{display:block;width:100%;height:100%}
.ap-chart-empty{height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center}
.ap-chart-empty .em-h{font-family:inherit;font-style:normal;font-size:14px;font-weight:600;color:var(--ink2)}
.ap-chart-empty .em-s{font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.ap-chart-loading{height:84px;display:grid;place-items:center}
.ap-chart-loading .sp{width:14px;height:14px;border-radius:50%;border:2px solid var(--hairline);border-top-color:#0b0b0c;animation:ap-spin .8s linear infinite}
.ap-tf-pills{display:flex;align-items:center;gap:4px;margin-top:6px;padding:0 2px}
.ap-tf{flex:0 0 auto;padding:5px 11px;border:none;background:transparent;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--ink2);border-radius:8px;cursor:pointer;transition:.12s}
.ap-tf:hover{color:var(--ink)}
.ap-tf.on{background:var(--fill);color:var(--ink);border:none}
.ap-tf.on.up{color:var(--greent);background:rgba(22,192,138,.12)}
.ap-tf.on.dn{color:var(--red);background:rgba(240,66,90,.10)}
.ap-tf:disabled{opacity:.4;cursor:default}
.ap-tf-meta{margin-left:auto;font-family:inherit;font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--ink3);text-transform:uppercase}

/* SAFETY READ */
.ap-safety{margin:14px 22px 0;border:1px solid var(--hairline);border-radius:14px;padding:13px 16px;background:var(--fill2)}
.ap-safety.amber{border-color:rgba(166,114,0,.22);background:rgba(166,114,0,.06)}
.ap-safety.red{border-color:rgba(240,66,90,.20);background:rgba(240,66,90,.05)}
.ap-safety-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.ap-safety-l{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.ap-safety-s{font-family:inherit;font-size:24px;font-weight:800;line-height:1;display:flex;align-items:baseline;gap:3px;color:var(--greent);font-variant-numeric:tabular-nums}
.ap-safety-s.amber{color:var(--gold)}
.ap-safety-s.red{color:var(--red)}
.ap-safety-s .of{font-size:12px;color:var(--ink3);font-weight:600}
.ap-safety-verdict{font-family:inherit;font-style:normal;font-size:15px;font-weight:700;line-height:1.35;margin-bottom:10px;color:var(--greent)}
.ap-safety-verdict.amber{color:var(--gold)}
.ap-safety-verdict.red{color:var(--red)}
.ap-safety-chks{display:flex;flex-wrap:wrap;gap:6px}
.ap-chk{font-family:inherit;font-size:10px;font-weight:700;padding:4px 9px;border-radius:999px}
.ap-chk.ok{background:rgba(22,192,138,.14);color:var(--greent)}
.ap-chk.cau{background:rgba(166,114,0,.12);color:var(--gold)}
.ap-chk.bad{background:rgba(240,66,90,.10);color:var(--red)}
.ap-dyor{font-family:inherit;font-size:9.5px;color:var(--ink3);padding:8px 22px 0;font-weight:600;line-height:1.5}

/* MODE TABS (buy/sell) */
.ap-mode-tabs{display:grid;grid-template-columns:1fr 1fr;margin:14px 22px;background:var(--fill);border:none;border-radius:12px;padding:3px;position:relative}
.ap-mode-ind{position:absolute;top:3px;bottom:3px;width:calc(50% - 3px);background:var(--green);border-radius:10px;transition:transform .3s cubic-bezier(.2,1.3,.4,1),background .25s;z-index:1}
.ap-mode-tabs.sell .ap-mode-ind{transform:translateX(100%);background:var(--red)}
.ap-mode-tab{padding:11px 0;text-align:center;font-family:inherit;font-size:15px;font-weight:700;color:var(--ink2);border:none;background:none;cursor:pointer;position:relative;z-index:2}
.ap-mode-tab.active{color:#fff}

/* FIELD */
.ap-field{background:var(--fill2);border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;margin:0 22px}
.ap-field-row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.ap-field-l{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.ap-field-bal{font-family:inherit;font-size:10.5px;font-weight:600;color:var(--ink2);display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.ap-field-bal b{color:var(--ink);font-weight:700}
.ap-field-max{font-family:inherit;font-size:9.5px;font-weight:800;color:var(--ink);padding:3px 8px;border-radius:6px;background:var(--fill);border:none;cursor:pointer;letter-spacing:.04em}
.ap-field-row2{display:flex;align-items:center;gap:11px}
.ap-field-chip{display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;background:#fff;border:1px solid var(--border);font-weight:700;font-size:13px;flex-shrink:0}
.ap-field-chip .lg{width:22px;height:22px;border-radius:50%;background:#0b0b0c;display:grid;place-items:center;font-size:11px;color:#fff;font-weight:800;overflow:hidden}
.ap-field-chip .lg img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.ap-field-amt{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:inherit;font-size:26px;font-weight:700;text-align:right;width:100%;min-width:0;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ap-field-amt::placeholder{color:var(--ink3)}
.ap-presets{display:flex;gap:6px;margin:10px 22px 0;overflow-x:auto;scrollbar-width:none}
.ap-presets::-webkit-scrollbar{display:none}
.ap-preset{flex-shrink:0;padding:7px 13px;border-radius:999px;background:var(--fill);border:none;color:var(--ink2);font-family:inherit;font-weight:700;font-size:11px;cursor:pointer;letter-spacing:.02em;font-variant-numeric:tabular-nums;transition:.12s}
.ap-preset:hover{color:var(--ink)}
.ap-preset.on{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-preset.on.sell{background:var(--red);color:#fff}
.ap-summary{margin:12px 22px 0;padding:11px 14px;background:var(--fill2);border:1px solid var(--hairline);border-radius:12px;font-family:inherit;font-size:11.5px;display:flex;flex-direction:column;gap:6px;font-variant-numeric:tabular-nums}
.ap-sum{display:flex;justify-content:space-between;gap:8px;font-weight:700}
.ap-sum .k{color:var(--ink3);font-weight:600}
.ap-sum .v{color:var(--ink);font-weight:700;text-align:right}
.ap-sum .v.good{color:var(--greent)}
.ap-banner{margin:12px 22px 0;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:600;border:1px solid rgba(240,66,90,.28);background:rgba(240,66,90,.07);color:var(--red)}
.ap-confirm{width:calc(100% - 44px);margin:14px 22px 0;padding:16px 0;border:none;border-radius:999px;font-family:inherit;font-size:17px;font-weight:800;letter-spacing:-.01em;cursor:pointer;background:var(--green);color:#fff;animation:none;transition:opacity .12s}
.ap-confirm:hover:not(:disabled){opacity:.92}
.ap-confirm.sell{background:var(--red);color:#fff}
.ap-confirm:disabled{opacity:.5;cursor:not-allowed;background:var(--fill);color:var(--ink3);box-shadow:none;animation:none}
.ap-tfoot{margin:10px 22px 18px;font-family:inherit;font-size:9.5px;color:var(--ink3);text-align:center;font-weight:700;letter-spacing:.06em;text-transform:uppercase}

/* WALLET DRAWER */
.ap-balcard{background:#0b0b0c;border:none;border-radius:18px;padding:18px;text-align:center;margin-bottom:13px;color:#fff}
.ap-ballbl{font-family:inherit;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55);font-weight:800}
.ap-balval{font-family:inherit;font-size:36px;font-weight:800;margin-top:6px;letter-spacing:-.02em;color:#fff;font-variant-numeric:tabular-nums}
.ap-balval .u{font-size:17px;color:rgba(255,255,255,.6)}
.ap-balusd{font-family:inherit;font-size:12px;color:rgba(255,255,255,.6);font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
.ap-wgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}
.ap-wact{padding:13px 0;border-radius:13px;border:1px solid var(--border);background:var(--fill);color:var(--ink);font-weight:700;font-size:13px;cursor:pointer;transition:.12s}
.ap-wact:hover{background:#ececee}
.ap-wact.primary{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-block{background:var(--fill2);border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;margin-bottom:11px}
.ap-wtoken{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--hairline)}
.ap-wtoken:last-child{border-bottom:none}
.ap-wtoken .ap-av{width:34px;height:34px;border-radius:9px;font-size:14px;flex-shrink:0}
.ap-wtoken-nm{flex:1;min-width:0}
.ap-wtoken-sym{font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.ap-wtoken-amt{font-family:inherit;font-size:10.5px;font-weight:600;color:var(--ink2);margin-top:2px;font-variant-numeric:tabular-nums}
.ap-wtoken-usd{font-family:inherit;font-weight:800;font-size:12.5px;color:var(--greent);flex-shrink:0;font-variant-numeric:tabular-nums}
.ap-block-l{font-family:inherit;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);font-weight:800;margin-bottom:9px}
.ap-qr{display:grid;place-items:center;margin-bottom:11px}
.ap-qr canvas,.ap-qr img{border-radius:12px;background:#fff;padding:8px;width:160px;height:160px;box-shadow:0 1px 3px rgba(11,11,12,.10)}
.ap-addr{display:flex;align-items:center;gap:8px}
.ap-addr-v{flex:1;font-family:inherit;font-size:12px;color:var(--ink);font-weight:600;word-break:break-all;line-height:1.4;font-variant-numeric:tabular-nums}
.ap-copy{flex-shrink:0;background:var(--fill);border:none;color:var(--ink);border-radius:9px;padding:8px 12px;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;letter-spacing:.06em}
.ap-copy:hover{background:#ececee}
.ap-input{width:100%;padding:11px 13px;border-radius:11px;background:var(--fill);border:1px solid transparent;color:var(--ink);font-family:inherit;font-size:13px;font-weight:600;outline:none;margin-bottom:8px;font-variant-numeric:tabular-nums}
.ap-input:focus{border-color:var(--border-hi)}
.ap-go{width:100%;padding:13px 0;border:none;border-radius:12px;font-family:inherit;font-weight:700;font-size:13.5px;cursor:pointer;background:#0b0b0c;color:#fff}
.ap-go:disabled{opacity:.5;cursor:not-allowed;background:var(--fill);color:var(--ink3);box-shadow:none}
.ap-secret{font-family:inherit;font-size:11px;color:var(--gold);word-break:break-all;line-height:1.5;background:rgba(166,114,0,.08);border:1px dashed rgba(166,114,0,.32);border-radius:10px;padding:11px 12px;font-variant-numeric:tabular-nums}
.ap-warn{font-family:inherit;font-size:10px;color:var(--gold);background:rgba(166,114,0,.08);border:1px solid rgba(166,114,0,.24);border-radius:12px;padding:10px 12px;line-height:1.55;font-weight:600;margin-bottom:11px}
.ap-warn b{color:var(--gold)}
.ap-nc{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--greent);background:rgba(22,192,138,.12);padding:5px 12px;border-radius:999px;border:none}

/* PRESETS / ECHIPS */
.ap-echips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ap-echip{display:inline-flex;align-items:center;gap:7px;padding:8px 8px 8px 14px;border-radius:999px;background:var(--fill);border:none;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.ap-echip .x{width:19px;height:19px;border-radius:50%;background:rgba(240,66,90,.10);color:var(--red);border:none;cursor:pointer;font-size:12px;display:grid;place-items:center;font-family:initial}
.ap-eadd{display:flex;gap:6px;align-items:center}
.ap-eadd input{width:74px;padding:8px 12px;border-radius:999px;background:var(--fill);border:none;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink);outline:none;font-variant-numeric:tabular-nums}
.ap-eadd .plus{width:30px;height:30px;border-radius:50%;background:#0b0b0c;color:#fff;border:none;cursor:pointer;font-size:17px;font-family:initial}
.ap-sec-lbl{font-family:inherit;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--ink3);margin:16px 0 9px}
.ap-esave{width:100%;margin-top:18px;padding:14px 0;border:none;border-radius:13px;font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.005em;cursor:pointer;background:#0b0b0c;color:#fff}

/* FILTER ROWS */
.ap-filter-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--hairline)}
.ap-filter-row:last-child{border-bottom:none}
.ap-filter-row .lbl{font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.005em;color:var(--ink)}
.ap-filter-row .lbl-sub{font-family:inherit;font-size:10px;font-weight:700;color:var(--ink3);margin-top:3px}
.ap-toggle{position:relative;width:48px;height:28px;border-radius:999px;background:var(--fill);border:1px solid var(--border);cursor:pointer;transition:.2s;flex-shrink:0}
.ap-toggle::after{content:'';position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(11,11,12,.2);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.ap-toggle.on{background:#0b0b0c;border-color:transparent}
.ap-toggle.on::after{transform:translateX(20px);background:#fff}
.ap-liq-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.ap-liq-chip{padding:6px 12px;border-radius:999px;background:var(--fill);border:none;color:var(--ink2);font-family:inherit;font-weight:700;font-size:11px;cursor:pointer;font-variant-numeric:tabular-nums}
.ap-liq-chip.on{background:#0b0b0c;color:#fff;border-color:transparent}

/* TOASTS */
.ap-toasts{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:1100;display:flex;flex-direction:column;gap:8px;max-width:440px;width:calc(100% - 24px);pointer-events:none}
.ap-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:14px;background:#fff;box-shadow:0 12px 32px rgba(11,11,12,.16);animation:ap-toast .3s ease;font-size:13px;font-weight:600;border:1px solid var(--hairline);color:var(--ink)}
.ap-toast.success{border-color:rgba(22,192,138,.4)}
.ap-toast.error{border-color:rgba(240,66,90,.4)}
.ap-toast.info{background:#fff}
.ap-toast .em{font-size:20px;flex-shrink:0;color:var(--greent)}
.ap-toast.error .em{color:var(--red)}
.ap-toast .tb{flex:1;min-width:0;line-height:1.35}
.ap-toast .tb b{font-weight:800}
.ap-toast .ta{display:flex;gap:5px;flex-shrink:0}
.ap-taction{background:var(--fill);border:none;color:var(--ink);padding:6px 10px;border-radius:9px;font-family:inherit;font-size:10px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;letter-spacing:.06em}
.ap-taction.tw{background:#0b0b0c;color:#fff;border-color:transparent}
.ap-taction svg{width:11px;height:11px}

.ap-confetti{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}
.ap-cpiece{position:absolute;top:50%;left:50%;width:8px;height:14px;border-radius:2px;animation:ap-confetti 1.6s cubic-bezier(.15,.9,.3,1) forwards}

/* ===== STATS PANEL (wp-) ===== */
.wp-root{position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:inherit;background:#ffffff;animation:ap-fade .25s ease}
.wp-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:16px 28px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hairline)}
.wp-headlbl{font-family:inherit;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);margin-left:auto;display:flex;align-items:center;gap:8px}
.wp-headlbl .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:ap-pulse 1.4s infinite}
.wp-close{width:40px;height:40px;border-radius:12px;background:var(--fill);border:none;display:grid;place-items:center;cursor:pointer;color:var(--ink2);font-size:18px;font-family:initial}
.wp-close:hover{color:var(--ink)}
@media(max-width:768px){.wp-head{padding:14px 16px;gap:12px}.wp-headlbl{display:none}}
.wp-tabs{position:sticky;top:65px;z-index:4;display:flex;gap:0;padding:0 28px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hairline);overflow-x:auto;scrollbar-width:none}
.wp-tabs::-webkit-scrollbar{display:none}
.wp-tab{flex-shrink:0;padding:16px 20px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.005em;color:var(--ink2);position:relative;border-bottom:2px solid transparent;display:flex;align-items:center;gap:9px;min-height:52px;transition:color .18s}
.wp-tab .glyph{font-family:inherit;font-size:10px;font-weight:800;opacity:.5}
.wp-tab:hover{color:var(--ink)}
.wp-tab.on{color:var(--ink);border-bottom-color:#0b0b0c}
.wp-tab.on .glyph{opacity:1;color:var(--ink)}
@media(max-width:768px){.wp-tabs{padding:0 14px}.wp-tab{padding:14px 14px;font-size:15px}}
.wp-page{max-width:1080px;margin:0 auto;padding:28px 28px 80px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wp-page{padding:22px 14px 80px}}
.wp-eyebrow{font-family:inherit;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:10px;margin-bottom:14px}
.wp-eyebrow .rule{flex:1;height:1px;max-width:220px;background:var(--hairline)}
.wp-eyebrow .glyph{color:var(--ink3);font-size:13px}
.wp-h1{font-family:inherit;font-size:36px;font-weight:800;line-height:1.05;letter-spacing:-.03em;margin:0 0 10px;color:var(--ink)}
.wp-h1 .it{font-style:normal;color:var(--ink2)}
.wp-sub{font-size:15px;line-height:1.5;color:var(--ink2);margin:0 0 26px;max-width:640px;font-weight:500}
@media(max-width:768px){.wp-h1{font-size:28px}.wp-sub{font-size:14px;margin-bottom:22px}}
.wp-card{background:#fff;border:1px solid var(--hairline);border-radius:18px;padding:22px;margin-bottom:16px;box-shadow:0 1px 2px rgba(11,11,12,.04);animation:ap-rise .45s .05s cubic-bezier(.2,1,.3,1) backwards}
.wp-card.feature{background:#fff;border-color:var(--hairline2)}
.wp-card-eye{font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wp-link{display:flex;align-items:stretch;gap:8px;background:var(--fill);border:none;border-radius:14px;padding:8px;margin:18px 0 14px}
.wp-link-v{flex:1;min-width:0;padding:10px 14px;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--ink);background:transparent;border:none;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.wp-link-cp{flex-shrink:0;display:inline-flex;align-items:center;gap:8px;padding:0 18px;min-height:44px;border-radius:10px;background:#0b0b0c;color:#fff;border:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:11.5px;letter-spacing:.06em}
.wp-link-cp:hover{opacity:.9}
.wp-link-cp.copied{background:var(--green);color:#fff}
.wp-share-row{display:flex;gap:8px;flex-wrap:wrap}
.wp-sh{flex:1;min-width:120px;min-height:44px;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:12px;border:1px solid var(--border);background:var(--fill);color:var(--ink);font-weight:700;font-size:13px;cursor:pointer;transition:.15s}
.wp-sh:hover{background:#ececee}
.wp-sh.tw{background:#0b0b0c;border-color:transparent;color:#fff}
.wp-sh.tg{background:#229ED9;border-color:transparent;color:#fff}
.wp-sh.ds{background:#5865F2;border-color:transparent;color:#fff}
.wp-sh .ico{display:inline-grid;place-items:center;width:18px;height:18px;flex-shrink:0}
.wp-sh .ico svg{width:14px;height:14px}
.wp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.wp-stat{background:#fff;border:1px solid var(--hairline);border-radius:16px;padding:18px;box-shadow:0 1px 2px rgba(11,11,12,.04);animation:ap-rise .5s cubic-bezier(.2,1,.3,1) backwards}
.wp-stat:nth-child(1){animation-delay:.04s}
.wp-stat:nth-child(2){animation-delay:.08s}
.wp-stat:nth-child(3){animation-delay:.12s}
.wp-stat:nth-child(4){animation-delay:.16s}
.wp-stat-l{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:7px;margin-bottom:10px}
.wp-stat-l .gl{color:var(--ink3);font-size:11px}
.wp-stat-v{font-family:inherit;font-size:30px;font-weight:800;line-height:1;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.wp-stat-v .u{font-size:14px;color:var(--ink2);font-family:inherit;font-weight:700;margin-left:5px}
.wp-stat-v.gn{color:var(--greent)}
.wp-stat-v.rd{color:var(--red)}
.wp-stat-v.it{font-style:normal;color:var(--ink3)}
.wp-stat-m{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink2);margin-top:6px}
@media(max-width:768px){.wp-stats{grid-template-columns:1fr 1fr;gap:10px}.wp-stat-v{font-size:25px}}
.wp-rules{display:grid;gap:12px;margin-top:18px}
.wp-rule{display:flex;gap:14px;padding:14px 16px;border-radius:14px;background:var(--fill2);border:1px solid var(--hairline)}
.wp-rule .n{flex-shrink:0;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-family:inherit;font-weight:800;font-size:11px;background:#0b0b0c;color:#fff;border:none}
.wp-rule .h{font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.01em;line-height:1.3;margin-bottom:3px;color:var(--ink)}
.wp-rule .h .it{font-style:normal;color:var(--ink2)}
.wp-rule .b{font-size:13.5px;line-height:1.5;color:var(--ink2)}
.wp-rule .b b{color:var(--ink);font-weight:700}
.wp-pnl-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:26px 26px 24px;background:#fff;border:1px solid var(--hairline2);border-radius:18px;margin-bottom:16px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wp-pnl-hero.neg{background:#fff;border-color:var(--hairline2)}
.wp-pnl-hero-l{min-width:0;flex:1 1 240px}
.wp-pnl-eye{font-family:inherit;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:9px;margin-bottom:10px}
.wp-pnl-eye .gl{font-size:12px;color:var(--greent)}
.wp-pnl-eye.neg .gl{color:var(--red)}
.wp-pnl-val{font-family:inherit;font-size:60px;font-weight:800;line-height:1;letter-spacing:-.04em;color:var(--greent);font-variant-numeric:tabular-nums}
.wp-pnl-val.neg{color:var(--red)}
.wp-pnl-val .u{font-size:22px;color:var(--ink2);font-family:inherit;font-weight:700;margin-left:8px}
.wp-pnl-usd{font-family:inherit;font-size:13px;font-weight:600;color:var(--ink2);margin-top:8px;font-variant-numeric:tabular-nums}
.wp-pnl-r{flex-shrink:0;align-self:flex-end}
.wp-pnl-share{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:0 22px;border-radius:13px;background:#0b0b0c;color:#fff;border:none;cursor:pointer;font-weight:700;font-size:13.5px;transition:opacity .12s}
.wp-pnl-share:hover{opacity:.9}
.wp-pnl-share svg{width:14px;height:14px}
@media(max-width:768px){.wp-pnl-val{font-size:46px}.wp-pnl-hero{padding:22px 20px 20px}}
.wp-pos-frame{background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:16px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wp-pos-head{padding:16px 22px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--hairline)}
.wp-pos-head .e{font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.wp-pos-row{display:grid;grid-template-columns:36px 1fr 90px 110px 100px 110px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--hairline);transition:background .18s}
.wp-pos-row:last-child{border-bottom:none}
.wp-pos-row:hover{background:var(--fill2)}
.wp-pos-row.thead{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);padding:11px 22px;background:var(--fill2)}
.wp-pos-no{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink3);font-variant-numeric:tabular-nums}
.wp-pos-tk{display:flex;align-items:center;gap:10px;min-width:0}
.wp-pos-av{flex-shrink:0;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-family:inherit;font-style:normal;font-weight:800;font-size:13px;color:#fff;text-transform:uppercase}
.wp-pos-sym{font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.005em;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:8px;color:var(--ink)}
.wp-pos-status{font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.02em;padding:2px 6px;border-radius:5px;text-transform:uppercase;font-style:normal}
.wp-pos-status.open{background:rgba(22,192,138,.14);color:var(--greent)}
.wp-pos-status.closed{background:var(--fill);color:var(--ink2)}
.wp-pos-meta{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink2);margin-top:2px;font-variant-numeric:tabular-nums}
.wp-pos-num{font-family:inherit;font-weight:700;font-size:12.5px;color:var(--ink);font-variant-numeric:tabular-nums}
.wp-pos-num.dim{color:var(--ink2);font-weight:600}
.wp-pos-num.gn{color:var(--greent)}
.wp-pos-num.rd{color:var(--red)}
@media(max-width:900px){.wp-pos-row{grid-template-columns:1.5fr 90px 110px;gap:8px;padding:12px 16px}.wp-pos-row.thead{padding:10px 16px}.wp-pos-no,.wp-col-avg,.wp-col-open{display:none}}
.wp-win-tabs{display:flex;gap:6px;margin-bottom:18px;background:var(--fill);padding:5px;border-radius:14px;border:none;max-width:fit-content}
.wp-win-tab{padding:10px 18px;min-height:40px;border:none;cursor:pointer;border-radius:10px;background:transparent;color:var(--ink2);font-family:inherit;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;transition:.18s}
.wp-win-tab:hover{color:var(--ink)}
.wp-win-tab.on{background:#0b0b0c;color:#fff}
.wp-lb-frame{background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wp-lb-row{display:grid;grid-template-columns:60px 1fr 130px 80px;gap:14px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--hairline);transition:background .18s}
.wp-lb-row:last-child{border-bottom:none}
.wp-lb-row:hover{background:var(--fill2)}
.wp-lb-row.thead{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);padding:11px 22px;background:var(--fill2)}
.wp-lb-row.mine{background:var(--fill2);border-left:3px solid #0b0b0c;padding-left:19px}
.wp-lb-rank{font-family:inherit;font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.wp-lb-rank.gold{color:var(--gold)}
.wp-lb-rank.silver{color:var(--ink3)}
.wp-lb-rank.bronze{color:#b07a4c}
.wp-lb-rank .hash{font-family:inherit;font-weight:700;font-size:11px;color:var(--ink3);margin-right:2px}
.wp-lb-w{font-family:inherit;font-weight:700;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.wp-lb-w .you{font-weight:800;color:var(--ink);font-size:11px;margin-left:8px;letter-spacing:.06em;text-transform:uppercase}
.wp-lb-vol{font-family:inherit;font-weight:700;font-size:13.5px;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.wp-lb-vol .u{color:var(--ink2);font-weight:600;font-size:10.5px;margin-left:3px}
.wp-lb-tr{font-family:inherit;font-weight:700;font-size:12.5px;color:var(--ink2);text-align:right;font-variant-numeric:tabular-nums}
.wp-lb-foot{padding:13px 22px;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2);display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--hairline)}
@media(max-width:768px){.wp-lb-row{grid-template-columns:50px 1fr 100px;gap:8px;padding:12px 16px}.wp-lb-row.thead{padding:10px 16px}.wp-col-tr{display:none}}
.wp-empty{padding:54px 28px;text-align:center;animation:ap-fade .3s}
.wp-empty .gl{display:block;font-family:inherit;font-style:normal;font-size:40px;color:var(--ink3);margin-bottom:14px}
.wp-empty .h{font-family:inherit;font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--ink);margin-bottom:6px}
.wp-empty .h .it{font-style:normal;color:var(--ink2)}
.wp-empty .s{font-size:13.5px;color:var(--ink2);max-width:380px;margin:0 auto;line-height:1.5}
.wp-empty .e{margin-top:12px;font-family:inherit;font-size:10.5px;font-weight:700;color:var(--red);background:rgba(240,66,90,.08);padding:8px 12px;border-radius:9px;display:inline-block}
.wp-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--hairline);border-top-color:#0b0b0c;animation:ap-spin .8s linear infinite;display:inline-block;vertical-align:-3px;margin-right:8px}
.wp-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2100;display:flex;align-items:center;gap:10px;padding:13px 18px;border-radius:14px;background:#fff;border:1px solid var(--hairline);font-family:inherit;font-size:11.5px;font-weight:700;color:var(--ink);box-shadow:0 12px 32px rgba(11,11,12,.16);animation:ap-rise .25s ease}
.wp-toast .gl{font-size:14px;color:var(--greent)}

/* ===== AUTO PANEL (wa-) ===== */
.wa-root{position:fixed;inset:0;z-index:2000;overflow-y:auto;overflow-x:hidden;color:var(--ink);font-family:inherit;background:#ffffff;animation:ap-fade .25s ease}
.wa-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:16px 28px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hairline)}
.wa-stat-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;font-family:inherit;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-left:auto}
.wa-stat-pill.off{background:var(--fill);color:var(--ink2);border:none}
.wa-stat-pill.on{background:rgba(22,192,138,.14);color:var(--greent);border:none}
.wa-stat-pill.on .d{width:6px;height:6px;border-radius:50%;background:var(--green);animation:ap-pulse 1.4s infinite}
.wa-stat-pill.paused{background:rgba(166,114,0,.14);color:var(--gold);border:none}
.wa-close{width:40px;height:40px;border-radius:12px;background:var(--fill);border:none;display:grid;place-items:center;cursor:pointer;color:var(--ink2);font-size:18px;font-family:initial}
@media(max-width:768px){.wa-head{padding:14px 16px}}
.wa-page{max-width:920px;margin:0 auto;padding:28px 28px 110px;animation:ap-rise .4s cubic-bezier(.2,1,.3,1)}
@media(max-width:768px){.wa-page{padding:22px 14px 110px}}
.wa-eye{font-family:inherit;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);display:flex;align-items:center;gap:10px;margin-bottom:12px}
.wa-eye .gl{color:var(--ink3);font-size:13px}
.wa-eye .rule{flex:1;height:1px;max-width:200px;background:var(--hairline)}
.wa-h1{font-family:inherit;font-size:34px;font-weight:800;line-height:1.05;letter-spacing:-.03em;margin:0 0 8px;color:var(--ink)}
.wa-h1 .it{font-style:normal;color:var(--ink2)}
.wa-sub{font-family:inherit;font-style:normal;font-size:15px;line-height:1.5;color:var(--ink2);margin:0 0 22px;max-width:620px}
@media(max-width:768px){.wa-h1{font-size:27px}}
.wa-modes{display:grid;grid-template-columns:1fr 1fr;background:var(--fill);border:none;border-radius:14px;padding:4px;position:relative;margin-bottom:18px;max-width:360px}
.wa-mode-ind{position:absolute;top:4px;bottom:4px;width:calc(50% - 4px);background:#0b0b0c;border-radius:11px;transition:transform .28s cubic-bezier(.2,1.3,.4,1);z-index:1}
.wa-modes.custom .wa-mode-ind{transform:translateX(100%)}
.wa-mode-t{position:relative;z-index:2;padding:10px 0;text-align:center;font-family:inherit;font-style:normal;font-size:14px;font-weight:700;color:var(--ink2);border:none;background:none;cursor:pointer;min-height:42px}
.wa-mode-t.active{color:#fff}
.wa-master{display:flex;align-items:center;gap:18px;padding:18px 22px;border-radius:16px;background:#fff;border:1px solid var(--hairline);margin-bottom:18px;flex-wrap:wrap;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-master.on{background:#fff;border-color:rgba(22,192,138,.32)}
.wa-master.paused{background:#fff;border-color:rgba(166,114,0,.32)}
.wa-master-l{flex:1;min-width:200px}
.wa-master-h{font-family:inherit;font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;margin-bottom:4px;color:var(--ink)}
.wa-master-h .it{font-style:normal;color:var(--ink2)}
.wa-master-h.on .it{color:var(--greent)}
.wa-master-s{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink2);font-variant-numeric:tabular-nums}
.wa-tog{position:relative;width:64px;height:36px;border-radius:999px;background:var(--fill);border:1px solid var(--border);cursor:pointer;transition:.2s;flex-shrink:0}
.wa-tog::after{content:'';position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(11,11,12,.2);transition:.22s cubic-bezier(.2,1.3,.4,1)}
.wa-tog.on{background:var(--green);border-color:transparent}
.wa-tog.on::after{transform:translateX(28px);background:#fff}
.wa-locked-card{background:#fff;border:1px solid var(--hairline);border-radius:18px;padding:22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-locked-eye{font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wa-locked-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid var(--hairline)}
.wa-locked-row{padding:12px 14px 12px 0;border-bottom:1px solid var(--hairline);display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.wa-locked-row:nth-child(even){padding-left:14px;padding-right:0;border-left:1px solid var(--hairline)}
.wa-locked-k{font-family:inherit;font-size:10.5px;font-weight:700;color:var(--ink2);letter-spacing:.02em;text-transform:uppercase}
.wa-locked-v{font-family:inherit;font-size:18px;font-weight:700;letter-spacing:-.01em;color:var(--ink);text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.wa-locked-v .u{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-locked-v.gn{color:var(--greent)}
.wa-locked-v.rd{color:var(--red)}
@media(max-width:600px){.wa-locked-grid{grid-template-columns:1fr}.wa-locked-row:nth-child(even){padding-left:0;border-left:none}}
.wa-sliders{background:#fff;border:1px solid var(--hairline);border-radius:18px;padding:22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-slider{padding:14px 0;border-bottom:1px solid var(--hairline)}
.wa-slider:last-child{border-bottom:none}
.wa-slider-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
.wa-slider-lbl{font-family:inherit;font-size:16px;font-weight:700;letter-spacing:-.005em;color:var(--ink)}
.wa-slider-lbl .it{font-style:normal;color:var(--ink2)}
.wa-slider-v{font-family:inherit;font-size:22px;font-weight:800;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.wa-slider-v .u{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-slider-desc{font-size:12.5px;line-height:1.5;color:var(--ink2);margin-bottom:10px}
.wa-slider-desc b{color:var(--ink);font-weight:700}
.wa-slider input[type=range]{width:100%;-webkit-appearance:none;background:transparent;cursor:pointer;height:32px;outline:none}
.wa-slider input[type=range]::-webkit-slider-runnable-track{height:5px;background:var(--fill);border:1px solid var(--border);border-radius:99px}
.wa-slider input[type=range]::-moz-range-track{height:5px;background:var(--fill);border:1px solid var(--border);border-radius:99px}
.wa-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:#0b0b0c;border:3px solid #fff;box-shadow:0 0 0 1px var(--border),0 2px 6px rgba(11,11,12,.2);margin-top:-9px;cursor:grab}
.wa-slider input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#0b0b0c;border:3px solid #fff;box-shadow:0 0 0 1px var(--border),0 2px 6px rgba(11,11,12,.2);cursor:grab}
.wa-floor{margin-top:14px;padding:12px 16px;border-radius:12px;background:var(--fill2);border:1px dashed var(--border);font-family:inherit;font-size:11px;line-height:1.55;color:var(--ink2);font-weight:600}
.wa-floor b{color:var(--greent);font-weight:800}
.wa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0 18px}
.wa-statc{padding:14px 14px 12px;background:#fff;border:1px solid var(--hairline);border-radius:14px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-statc-l{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);margin-bottom:6px}
.wa-statc-v{font-family:inherit;font-size:24px;font-weight:800;line-height:1;letter-spacing:-.015em;color:var(--ink);font-variant-numeric:tabular-nums}
.wa-statc-v .u{font-family:inherit;font-size:11px;font-weight:700;color:var(--ink2);margin-left:4px}
.wa-statc-v.gn{color:var(--greent)}
.wa-statc-v.rd{color:var(--red)}
.wa-statc-v.dim{color:var(--ink3)}
@media(max-width:600px){.wa-stats{grid-template-columns:1fr 1fr;gap:8px}.wa-statc-v{font-size:20px}}
.wa-pos-frame{background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:18px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-section-head{padding:14px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--hairline);font-family:inherit;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.wa-section-head .count{margin-left:auto;color:var(--ink3)}
.wa-pos-row{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--hairline);transition:background .15s}
.wa-pos-row:last-child{border-bottom:none}
.wa-pos-row:hover{background:var(--fill2)}
.wa-pos-av{flex-shrink:0;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-family:inherit;font-style:normal;font-weight:800;font-size:13px;color:#fff;text-transform:uppercase}
.wa-pos-nm{flex:1;min-width:0}
.wa-pos-sym{font-family:inherit;font-size:15px;font-weight:700;letter-spacing:-.005em;line-height:1.1;color:var(--ink)}
.wa-pos-time{font-family:inherit;font-size:10.5px;font-weight:600;color:var(--ink2);margin-top:3px;font-variant-numeric:tabular-nums}
.wa-pos-pnl{flex-shrink:0;text-align:right;min-width:90px}
.wa-pos-pnl-v{font-family:inherit;font-size:17px;font-weight:800;letter-spacing:-.015em;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.wa-pos-pnl-v.gn{color:var(--greent)}
.wa-pos-pnl-v.rd{color:var(--red)}
.wa-pos-pnl-p{font-family:inherit;font-size:10.5px;font-weight:700;margin-top:2px;color:var(--ink2);font-variant-numeric:tabular-nums}
.wa-pos-pnl-p.gn{color:var(--greent)}
.wa-pos-pnl-p.rd{color:var(--red)}
.wa-pos-close{flex-shrink:0;min-width:38px;min-height:38px;padding:0 12px;border-radius:10px;background:var(--fill);border:none;color:var(--ink);font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.04em;cursor:pointer}
.wa-pos-close:hover{background:var(--red);color:#fff}
.wa-log-frame{background:#fff;border:1px solid var(--hairline);border-radius:18px;overflow:hidden;margin-bottom:24px;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wa-log-list{max-height:340px;overflow-y:auto}
.wa-log-row{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--hairline);font-family:inherit;font-size:11.5px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums}
.wa-log-row:last-child{border-bottom:none}
.wa-log-ts{flex-shrink:0;color:var(--ink3);font-size:10.5px;width:54px}
.wa-log-tag{flex-shrink:0;font-size:9.5px;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:5px;text-transform:uppercase;min-width:54px;text-align:center}
.wa-log-tag.skip{background:var(--fill);color:var(--ink3)}
.wa-log-tag.buy{background:rgba(22,192,138,.14);color:var(--greent)}
.wa-log-tag.sell{background:rgba(124,92,255,.14);color:var(--purple)}
.wa-log-tag.error{background:rgba(240,66,90,.10);color:var(--red)}
.wa-log-tag.info{background:var(--fill);color:var(--ink2)}
.wa-log-msg{flex:1;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wa-kill{position:sticky;bottom:0;left:0;right:0;display:flex;gap:10px;padding:14px 28px;background:rgba(255,255,255,.95);backdrop-filter:blur(16px);border-top:1px solid var(--hairline);z-index:10;margin-top:24px}
.wa-kill-btn{flex:1;min-height:48px;padding:0 20px;border-radius:13px;border:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:13.5px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:opacity .12s}
.wa-kill-btn.stop{background:var(--red);color:#fff}
.wa-kill-btn.stop:hover{opacity:.92}
.wa-kill-btn.flat{background:var(--fill);color:var(--ink);border:1px solid var(--border)}
.wa-kill-btn:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:600px){.wa-kill{padding:12px 14px;flex-direction:column}.wa-kill-btn{width:100%}}
.wa-empty{padding:36px 24px;text-align:center}
.wa-empty .gl{display:block;font-family:inherit;font-style:normal;font-size:34px;color:var(--ink3);margin-bottom:10px}
.wa-empty .h{font-family:inherit;font-size:18px;font-weight:800;letter-spacing:-.005em;color:var(--ink);margin-bottom:4px}
.wa-empty .h .it{font-style:normal;color:var(--ink2)}
.wa-empty .s{font-size:12.5px;color:var(--ink2);max-width:340px;margin:0 auto;line-height:1.5}
.wa-pause-banner{padding:14px 18px;border-radius:14px;background:var(--fill2);border:1px solid rgba(166,114,0,.32);display:flex;align-items:center;gap:14px;margin-bottom:16px}
.wa-pause-banner .gl{font-size:20px;color:var(--gold);flex-shrink:0}
.wa-pause-banner .t{flex:1;min-width:0}
.wa-pause-banner .h{font-family:inherit;font-size:17px;font-weight:700;color:var(--gold);margin-bottom:2px}
.wa-pause-banner .b{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink2)}
.wa-pause-banner button{flex-shrink:0;min-height:36px;padding:0 16px;border-radius:9px;background:#0b0b0c;color:#fff;border:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:10.5px;letter-spacing:.06em}

@media(prefers-reduced-motion:reduce){.wa-root *,.wp-root *,.ap-root *{animation-duration:.01ms!important;animation-iteration-count:1!important}}

/* ============================================================
   DARK TERMINAL THEME — overrides the pastel-light palette.
   Same class names; appended last so it wins on equal specificity.
   Re-skins via tokens + the few hardcoded light surfaces.
   ============================================================ */
.ap-root{
  --ink:#f4f5f7; --ink2:#9aa0ab; --ink3:#646a76;
  --hairline:#242830; --hairline2:#2e333c;
  --cyan:#1ad98a; --sky:#1ad98a; --pink:#ff4d61; --lav:#8b7bff; --mint:#1ad98a;
  --peach:#f5b545; --gold:#f5b545; --green:#1ad98a; --greent:#1ad98a; --red:#ff4d61; --amber:#f5b545;
  --orange:#f5b545; --purple:#8b7bff; --blue:#4d8bff;
  --cream:#16181d; --dep:#1ad98a; --buyblk:#1ad98a;
  --glass:#16181d; --glass-strong:#16181d;
  --fill:#1b1e23; --fill2:#16181d;
  --border:#242830; --border-hi:#30343d;
  background:#0a0b0e;
}
/* full-page overlays */
.wp-root,.wa-root{background:#0a0b0e}
/* translucent sticky bars */
.ap-nav,.ap-qbar,.wp-head,.wp-tabs,.wa-head,.wa-kill{background:rgba(10,11,14,.82)}
/* solid card surfaces */
.ap-hero-ref,.ap-positions,.ap-trend-card,.ap-list-frame,.ap-sheet,.ap-chart-embed,
.ap-research,.ap-watch,.ap-watch-row,.ap-field-chip,.ap-toast,.ap-toast.info,
.wp-card,.wp-card.feature,.wp-stat,.wp-pnl-hero,.wp-pnl-hero.neg,.wp-pos-frame,
.wp-lb-frame,.wp-toast,.wa-master,.wa-master.on,.wa-master.paused,.wa-locked-card,
.wa-sliders,.wa-statc,.wa-pos-frame,.wa-log-frame{background:#16181d}
.ap-disc-f select{background:#1b1e23;color:var(--ink)}
.ap-btn-sell:hover{background:#22262d}
/* primary actions: green button with dark, high-contrast label */
.ap-btn-buy{background:var(--green);color:#04130d}
.ap-btn-buy .arrow{color:#04130d}
.ap-confirm{color:#04130d}
`;

function useApCSS() {
  useEffect(() => {
    const id = 'ape-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = AP_CSS;
    document.head.appendChild(el);
  }, []);
}

const POLL_RECENT    = 2500;
const POLL_SOL       = 30000;
const POLL_BALANCE   = 30000;
const POLL_POSITIONS = 30000;
const HAS_TRADED_KEY = 'lr_has_traded_v1';
const SK_KEY         = 'lr_wallet_sk_v1';
const BACKED_KEY     = 'lr_wallet_backed_v1';

/* ============================================================
   BURNER WALLET
   ============================================================ */
function loadOrCreateKeypair() {
  try {
    const sk = localStorage.getItem(SK_KEY);
    if (sk) return Keypair.fromSecretKey(bs58.decode(sk));
  } catch (e) {}
  const kp = Keypair.generate();
  try { localStorage.setItem(SK_KEY, bs58.encode(kp.secretKey)); } catch (e) {}
  return kp;
}
function useLocalWallet() {
  const kpRef = useRef(null);
  if (!kpRef.current) kpRef.current = loadOrCreateKeypair();
  const keypair = kpRef.current;
  const [backedUp, setBackedUp] = useState(() => {
    try { return localStorage.getItem(BACKED_KEY) === '1'; } catch (e) { return false; }
  });
  const markBackedUp = useCallback(() => {
    try { localStorage.setItem(BACKED_KEY, '1'); } catch (e) {}
    setBackedUp(true);
  }, []);
  const exportSecret = useCallback(() => bs58.encode(keypair.secretKey), [keypair]);
  return { keypair, publicKey: keypair.publicKey, backedUp, markBackedUp, exportSecret };
}

/* ============================================================
   TOKEN ICONS
   ============================================================ */
const _iconCache = new Map(), _iconPending = new Map();
async function resolveIconFromDex(mint) {
  if (!mint) return null;
  if (_iconCache.has(mint)) return _iconCache.get(mint);
  if (_iconPending.has(mint)) return _iconPending.get(mint);
  const p = (async () => {
    try {
      const r = await fetch('/api/dex/token/' + encodeURIComponent(mint));
      if (!r.ok) { _iconCache.set(mint, null); return null; }
      const data = await r.json();
      const url = (data && data.token && data.token.icon) || null;
      _iconCache.set(mint, url || null); return url || null;
    } catch (e) { _iconCache.set(mint, null); return null; }
    finally { _iconPending.delete(mint); }
  })();
  _iconPending.set(mint, p); return p;
}
function useTokenIcon(token) {
  const directUrl = (token && token.icon) || null;
  const [resolved, setResolved] = useState(() => directUrl || (_iconCache.get(token && token.mint) || null));
  useEffect(() => {
    if (directUrl) { setResolved(directUrl); return; }
    if (!token || !token.mint) return;
    if (_iconCache.has(token.mint)) { setResolved(_iconCache.get(token.mint)); return; }
    let alive = true;
    resolveIconFromDex(token.mint).then(url => { if (alive) setResolved(url); });
    return () => { alive = false; };
  }, [token && token.mint, directUrl]);
  return resolved;
}
function TokenFace({ token, size, ageMs }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  const c = colorFor(token.mint || token.sym || '');
  const style = {
    background: 'linear-gradient(135deg,' + c + ',' + shade(c, -32) + ')',
    width: size ? size + 'px' : undefined,
    height: size ? size + 'px' : undefined,
    fontSize: size ? Math.round(size * 0.4) + 'px' : undefined,
  };
  let ageDotCls = 'age-dot';
  if (Number.isFinite(ageMs)) {
    if (ageMs < 30000) ageDotCls = 'age-dot fresh';
    else if (ageMs < 180000) ageDotCls = 'age-dot';
    else if (ageMs < 600000) ageDotCls = 'age-dot warm';
    else ageDotCls = 'age-dot old';
  }
  return (
    <div className="ap-av" style={style}>
      {url && !errored ? <img src={url} alt={token.sym || ''} onError={() => setErrored(true)} /> : <span>{(token.sym || '?').charAt(0)}</span>}
      {Number.isFinite(ageMs) && <span className={ageDotCls}>{fmtAgeShort(ageMs)}</span>}
    </div>
  );
}
function TokenChip({ token }) {
  const url = useTokenIcon(token);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  return url && !errored ? <img src={url} alt="" onError={() => setErrored(true)} /> : <span>{(token.sym || '?').charAt(0)}</span>;
}

const IconX  = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>);
const IconTg = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>);
const IconDs = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>);
/* ============================================================
   DETAIL CHART (TokenChart) — live embedded chart.
   Ported from the LaunchRadar approach: resolve the mint to its best
   pool, then embed a live candlestick iframe. GeckoTerminal is primary
   (it indexes pump.fun BONDING-CURVE pools, so seconds-old launches
   still chart); DexScreener is the fallback for graduated / older pairs.
   Defaults to the 1-second resolution so the chart is live and moving
   the moment the token detail sheet opens.

   NOTE on the "1s" resolution param: GeckoTerminal honors `resolution`
   and DexScreener honors `interval`. The second-level values below are
   centralized in CHART_RES so they're trivial to adjust if a provider
   changes its accepted tokens; if a given pool can't serve 1s the
   provider falls back to its own default rather than erroring.
   ============================================================ */
const CHART_RES = [
  { key: '1s',  label: '1s', gecko: '1s',  dex: '1S'  },
  { key: '15s', label: '15s', gecko: '15s', dex: '15S' },
  { key: '1m',  label: '1m', gecko: '1m',  dex: '1'   },
  { key: '5m',  label: '5m', gecko: '5m',  dex: '5'   },
  { key: '1h',  label: '1H', gecko: '1h',  dex: '60'  },
];
const CHART_RES_DEFAULT = '1s';

// GeckoTerminal: pools come back with relationships.base_token.data.id of
// the form "solana_<mint>" and attributes.{address, reserve_in_usd}. Accept
// only a pool whose BASE token is exactly this mint (quote-only matches are a
// last resort), then pick the deepest by USD liquidity, so the chart can never
// be for a look-alike token.
function pickBestGeckoPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = ('solana_' + mint).toLowerCase();
  const baseId  = p => p?.relationships?.base_token?.data?.id;
  const quoteId = p => p?.relationships?.quote_token?.data?.id;
  const hasAddr = p => !!p?.attributes?.address;
  const baseMatches = pools.filter(p => hasAddr(p) && String(baseId(p) || '').toLowerCase() === wanted);
  const pool = baseMatches.length
    ? baseMatches
    : pools.filter(p => hasAddr(p) && (
        String(baseId(p) || '').toLowerCase() === wanted ||
        String(quoteId(p) || '').toLowerCase() === wanted));
  if (!pool.length) return null;
  return pool.reduce(
    (best, p) => (Number(p?.attributes?.reserve_in_usd) || 0) > (Number(best?.attributes?.reserve_in_usd) || 0) ? p : best,
    pool[0],
  );
}

// DexScreener: pairs have chainId, pairAddress, baseToken.address,
// quoteToken.address, liquidity.usd. Same base-match + deepest-liquidity rule.
function pickBestPair(pairs, mint) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const wanted = String(mint).toLowerCase();
  const baseMatches = pairs.filter(
    p => p && p.chainId === 'solana' && p.pairAddress &&
         p.baseToken?.address?.toLowerCase() === wanted);
  const pool = baseMatches.length
    ? baseMatches
    : pairs.filter(
        p => p && p.chainId === 'solana' && p.pairAddress &&
             (p.baseToken?.address?.toLowerCase() === wanted ||
              p.quoteToken?.address?.toLowerCase() === wanted));
  if (!pool.length) return null;
  return pool.reduce(
    (best, p) => (Number(p.liquidity?.usd) || 0) > (Number(best.liquidity?.usd) || 0) ? p : best,
    pool[0],
  );
}

function buildEmbedSrc(pool, resKey) {
  if (!pool) return null;
  const r = CHART_RES.find(x => x.key === resKey) || CHART_RES[0];
  if (pool.provider === 'GECKOTERMINAL') {
    return 'https://www.geckoterminal.com/solana/pools/' + pool.addr +
      '?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&bg_color=0a0b0e&resolution=' + r.gecko;
  }
  return 'https://dexscreener.com/solana/' + pool.addr +
    '?embed=1&theme=dark&info=0&trades=0&interval=' + r.dex;
}

function TokenChart({ token, solPrice }) {
  const mint = token && token.mint;
  const [status, setStatus] = useState('loading'); // loading | ok | none | fail
  const [pool, setPool]     = useState(null);       // { provider, addr }
  const [res, setRes]       = useState(CHART_RES_DEFAULT);
  const [copied, setCopied] = useState(false);
  const reqRef = useRef(0);

  // Reset to the live 1s view each time a different token opens, so every
  // detail sheet starts moving immediately.
  useEffect(() => { setRes(CHART_RES_DEFAULT); }, [mint]);

  useEffect(() => {
    if (!mint) { setStatus('none'); setPool(null); return; }
    const id = ++reqRef.current;

    // 0) Server-resolved pool (from /api/ape/curve · /api/ape/enrich → GeckoTerminal).
    //    Skips the browser's cross-origin GeckoTerminal call when we already have it.
    const poolHint = token && token.pool;
    if (poolHint && typeof poolHint === 'string') {
      setPool({ provider: 'GECKOTERMINAL', addr: poolHint }); setStatus('ok'); return;
    }

    setStatus('loading'); setPool(null);

    (async () => {
      let networkOk = false;

      // 1) GeckoTerminal — covers pump.fun bonding-curve pools.
      try {
        const r = await fetch(
          'https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + mint + '/pools',
          { headers: { Accept: 'application/json' } });
        if (id !== reqRef.current) return;
        if (r.ok) {
          networkOk = true;
          const j = await r.json();
          if (id !== reqRef.current) return;
          const best = pickBestGeckoPool(j?.data, mint);
          const addr = best?.attributes?.address;
          if (addr) { setPool({ provider: 'GECKOTERMINAL', addr }); setStatus('ok'); return; }
        }
      } catch (e) {}
      if (id !== reqRef.current) return;

      // 2) DexScreener — fallback for graduated / older pairs.
      try {
        const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint,
          { headers: { Accept: 'application/json' } });
        if (id !== reqRef.current) return;
        if (r.ok) {
          networkOk = true;
          const j = await r.json();
          if (id !== reqRef.current) return;
          const best = pickBestPair(j?.pairs, mint);
          if (best?.pairAddress) { setPool({ provider: 'DEXSCREENER', addr: best.pairAddress }); setStatus('ok'); return; }
        }
      } catch (e) {}
      if (id !== reqRef.current) return;

      setStatus(networkOk ? 'none' : 'fail');
    })();
  }, [mint, token && token.pool]);

  const src = useMemo(() => buildEmbedSrc(pool, res), [pool, res]);
  const shortCa = mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : '';
  const copyCa = async () => {
    try { await navigator.clipboard.writeText(mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (e) {}
  };
  const resPills = (
    <div className="ap-tf-pills">
      {CHART_RES.map(r => (
        <button key={r.key} type="button"
          className={'ap-tf' + (r.key === res ? ' on' : '')}
          disabled={status !== 'ok'}
          onClick={() => setRes(r.key)}>{r.label}</button>
      ))}
      <span className="ap-tf-meta">{status === 'ok' ? '● Live · ' + (CHART_RES.find(x => x.key === res) || {}).label : 'Live'}</span>
    </div>
  );

  return (
    <div className="ap-chart-wrap">
      <div className="ap-chart-bar">
        <div className="ap-chart-ca">
          <span className="lbl">CA</span>
          <span className="val">{shortCa}</span>
          <button type="button" className="cp" onClick={copyCa}>{copied ? 'COPIED' : 'COPY'}</button>
        </div>
        <span className="ap-chart-src">{pool?.provider || 'CHART'}</span>
      </div>
      {status === 'ok' && src ? (
        <div className="ap-chart-embed">
          <iframe key={pool.provider + ':' + pool.addr + ':' + res}
            className="ap-chart-frame" src={src}
            title={(token?.sym || 'Token') + ' price chart'}
            loading="lazy" allow="clipboard-write" />
        </div>
      ) : status === 'loading' ? (
        <div className="ap-chart-state"><span className="sp" /></div>
      ) : status === 'none' ? (
        <div className="ap-chart-state">Chart appears once ${token?.sym || 'this token'} is indexed — trading on the bonding curve for now.</div>
      ) : (
        <div className="ap-chart-state">Couldn’t load the chart. Try again shortly.</div>
      )}
      {resPills}
    </div>
  );
}

// Per-mint live price history for the row sparklines. Filled from the price
// the feed already polls (~every 2.5s) — no extra network. Capped per mint;
// persists across tab switches and re-sorts so the little charts keep building
// the longer you watch, like the iOS Stocks list.
const _sparkHist = new Map(); // mint -> number[]
function recordSpark(mint, price) {
  if (!mint || !(price > 0)) return _sparkHist.get(mint) || [];
  let pts = _sparkHist.get(mint);
  if (!pts) { pts = []; _sparkHist.set(mint, pts); }
  if (pts[pts.length - 1] !== price) { pts.push(price); if (pts.length > 32) pts.shift(); }
  return pts;
}

function MiniSparkline({ mint, price, change }) {
  const up = (change || 0) >= 0;
  const color = up ? '#11b87f' : '#f0425a';
  const W = 76, H = 32, padY = 3;
  const hist = recordSpark(mint, Number(price));
  let line, fill;
  if (hist.length >= 3) {
    // Real observed-price trend, auto-scaled to the window (never zero-based).
    const min = Math.min.apply(null, hist), max = Math.max.apply(null, hist);
    const rng = (max - min) || (max * 0.0001) || 1;
    const xOf = (i) => (i / (hist.length - 1)) * W;
    const yOf = (v) => H - padY - ((v - min) / rng) * (H - 2 * padY);
    line = hist.map((v, i) => (i === 0 ? 'M' : 'L') + xOf(i).toFixed(1) + ',' + yOf(v).toFixed(1)).join(' ');
    fill = line + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';
  } else {
    // Not enough live points yet — draw a directional placeholder from the 24h
    // change so the row is never blank in its first seconds, then real data
    // takes over as prices tick in.
    const seed = Math.abs(change || 0);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const trend = up ? (8 + (1 - t) * 18) : (24 - (1 - t) * 18);
      const wiggle = Math.sin(i * 1.7 + seed) * 2.0 + Math.cos(i * 0.9) * 1.4;
      pts.push([i * (W / 10), Math.max(2, Math.min(H - 2, trend + wiggle))]);
    }
    line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    fill = line + ' L ' + W + ',' + H + ' L 0,' + H + ' Z';
  }
  const gradId = 'spk' + (up ? 'u' : 'd') + (mint ? mint.slice(0, 8) : '');
  return (
    <div className="ap-spark">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
        <defs><linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={up ? '.28' : '.22'} /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={fill} fill={'url(#' + gradId + ')'} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function usePresets() {
  const readStored = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key); if (!raw) return fallback;
      const arr = JSON.parse(raw); if (!Array.isArray(arr) || arr.length === 0) return fallback;
      const cleaned = arr.map(Number).filter(v => Number.isFinite(v) && v > 0);
      return cleaned.length > 0 ? cleaned : fallback;
    } catch (e) { return fallback; }
  };
  const [buyPresets, setBuyPresets] = useState(() => readStored('lr_buy_presets', DEFAULT_BUY_PRESETS));
  const [sellPresets, setSellPresets] = useState(() => readStored('lr_sell_presets', DEFAULT_SELL_PRESETS));
  useEffect(() => { try { localStorage.setItem('lr_buy_presets', JSON.stringify(buyPresets)); } catch (e) {} }, [buyPresets]);
  useEffect(() => { try { localStorage.setItem('lr_sell_presets', JSON.stringify(sellPresets)); } catch (e) {} }, [sellPresets]);
  return { buyPresets, setBuyPresets, sellPresets, setSellPresets };
}

// OPEN POSITIONS STRIP — flash-bug fix (sequential fetch + diff)
function OpenPositionsStrip({ walletStr, solPrice, onOpenStats }) {
  const [positions, setPositions] = useState([]);
  const [prices, setPrices] = useState({});
  useEffect(() => {
    if (!walletStr) return;
    let cancelled = false;
    const sigOf = (p) => p.mint + ':' + (p.open_tokens || 0) + ':' + (p.sol_in || 0) + ':' + (p.sol_out || 0);
    const load = async () => {
      try {
        const r = await fetch('/api/ref/pnl?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const open = (d.positions || []).filter(p => p.open && p.open_tokens > 0);
        setPositions(prev => {
          if (prev.length !== open.length) return open;
          for (let i = 0; i < prev.length; i++) if (sigOf(prev[i]) !== sigOf(open[i])) return open;
          return prev;
        });
        for (const p of open) {
          if (cancelled) return;
          try {
            const pr = await fetch('/api/dex/token/' + encodeURIComponent(p.mint));
            if (!pr.ok) continue;
            const pd = await pr.json();
            const px = Number(pd?.token?.price);
            if (!Number.isFinite(px) || px <= 0) continue;
            if (cancelled) return;
            setPrices(prev => Math.abs((prev[p.mint] || 0) - px) < 1e-12 ? prev : { ...prev, [p.mint]: px });
          } catch (e) {}
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (e) {}
    };
    load();
    const id = setInterval(load, POLL_POSITIONS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr]);
  const enriched = useMemo(() => {
    if (!solPrice) return [];
    return positions.map(p => {
      const px = prices[p.mint] || 0;
      const currentValueSol = (p.open_tokens * px) / solPrice;
      const costBasisSol = Math.max(0, (p.sol_in || 0) - (p.sol_out || 0));
      const unrealizedSol = currentValueSol - costBasisSol;
      const unrealizedPct = costBasisSol > 0 ? (unrealizedSol / costBasisSol) * 100 : 0;
      return { ...p, unrealizedSol, unrealizedPct, hasPrice: px > 0 };
    }).sort((a, b) => Math.abs(b.unrealizedSol) - Math.abs(a.unrealizedSol));
  }, [positions, prices, solPrice]);
  if (enriched.length === 0) return null;
  const total = enriched.reduce((s, p) => s + p.unrealizedSol, 0);
  return (
    <div className="ap-positions">
      <div className="ap-positions-head">
        <span className="e">◉ Your open trades · {enriched.length}</span>
        <span className="roll">Unrealized <b className={total < 0 ? 'dn' : ''}>{formatSolSigned(total)} SOL</b></span>
      </div>
      {enriched.slice(0, 3).map(p => {
        const c = colorFor(p.mint);
        const up = p.unrealizedSol > 0.0001, dn = p.unrealizedSol < -0.0001;
        return (
          <div className="ap-pos-strip-row" key={p.mint}>
            <div className="ap-pos-strip-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
            <div className="ap-pos-strip-sym">${p.sym || '???'}</div>
            <div className={'ap-pos-strip-pnl' + (up ? '' : dn ? ' dn' : ' dim')}>{p.hasPrice ? formatSolSigned(p.unrealizedSol) : '—'}</div>
            <div className={'ap-pos-strip-pct ' + (up ? 'up' : dn ? 'dn' : '')}>{p.hasPrice ? (p.unrealizedPct >= 0 ? '+' : '') + p.unrealizedPct.toFixed(1) + '%' : '…'}</div>
          </div>
        );
      })}
      <button className="ap-positions-foot" onClick={onOpenStats}>See your full trade log →</button>
    </div>
  );
}

const SpecimenRow = React.memo(function SpecimenRow({ token, ageMsLive, owned, costBasis, solPrice, quickAmount, busy, onApe, onSell, onOpen, isFresh, ownedMode }) {
  const r = riskRead(token);
  const ownedUi = (owned && owned.uiAmount) || 0;
  const ownedUsd = ownedUi * (token.price || 0);
  // Live P&L from real cost basis (sol_in - sol_out), same math as the open-
  // positions strip. Only shown when we have a logged basis and a SOL price.
  let pnl = null;
  let pnlMiss = null; // why P&L can't show, in owned mode (diagnostic)
  if (costBasis && solPrice > 0 && (token.price || 0) > 0) {
    const costSol = Math.max(0, (costBasis.sol_in || 0) - (costBasis.sol_out || 0));
    if (costSol > 0) {
      const curValSol = (ownedUi * token.price) / solPrice;
      const gainSol = curValSol - costSol;
      pnl = { gainSol, pct: (gainSol / costSol) * 100, up: gainSol > 0.0001, dn: gainSol < -0.0001 };
    } else {
      pnlMiss = 'no cost';
    }
  } else if (!costBasis) {
    pnlMiss = 'no basis';
  } else if (!(token.price > 0)) {
    pnlMiss = 'no price';
  } else if (!(solPrice > 0)) {
    pnlMiss = 'no SOL px';
  }
  const ape = (e) => { e.stopPropagation(); if (busy) return; onApe(token); };
  const sell = (e) => { e.stopPropagation(); if (busy) return; onSell(token); };
  return (
    <div className={'ap-row' + (isFresh ? ' fresh' : '') + (ownedMode ? ' owned' : '')} onClick={()=>onOpen(token)}>
      <div className="ap-row-tk">
        <TokenFace token={token} ageMs={ageMsLive} />
        <div className="ap-name">
          <div className="ap-sym-row">
            ${token.sym}
            {Number.isFinite(token.change) && token.change !== 0 ? <span className={'chg' + (token.change < 0 ? ' dn' : '')}>{formatPct(token.change)}</span> : null}
            {(ownedUi > 0 && !ownedMode) ? <span className="ap-owned-mark">owned</span> : null}
          </div>
          <div className="ap-name-line">
            <span className="price">{formatPrice(token.price)}</span><span className="dot">·</span>
            <span className="mcap">{formatMoney(token.mcap)} mcap</span><span className="dot">·</span>
            <span className="ghost">{formatMoney(token.liquidity)} liq · {token.holders > 0 ? Math.round(token.holders).toLocaleString() : 0} holders</span>
            {ownedMode ? <><span className="dot">·</span><span className="ownedusd">{formatTokens(ownedUi)} · {formatUsdAbs(ownedUsd)}</span></> : null}
          </div>
        </div>
      </div>
      <MiniSparkline mint={token.mint} price={token.price} change={token.change} />
      <span className={'ap-pill ' + r.tier}><span className="d" />{r.tier === 'low' ? 'low' : r.tier === 'med' ? 'medium' : 'high risk'}</span>
      {(ownedMode && pnl) ? (
        <div className={'ap-row-pnl' + (pnl.up ? ' up' : pnl.dn ? ' dn' : '')}>
          <span className="pct">{(pnl.pct >= 0 ? '+' : '') + pnl.pct.toFixed(1)}%</span>
          <span className="sol">{formatSolSigned(pnl.gainSol)} SOL</span>
        </div>
      ) : (ownedMode && pnlMiss) ? (
        <div className="ap-row-pnl dim"><span className="pct" style={{ fontSize: '10px', opacity: 0.6 }}>{pnlMiss}</span></div>
      ) : null}
      <div className="ap-row-action">
        {ownedMode ? (
          <>
            <button className="ap-btn-buy compact" disabled={busy} onClick={ape}>{busy ? <span className="ap-spinner" /> : 'Buy'}</button>
            <button className="ap-btn-sell" disabled={busy} onClick={sell}>Sell</button>
          </>
        ) : (
          <button className="ap-btn-buy" disabled={busy} onClick={ape}>{busy ? <><span className="ap-spinner" /> Buying</> : <>Buy {quickAmount} <span className="arrow">→</span></>}</button>
        )}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.token.mint === next.token.mint
  && prev.token.price === next.token.price
  && prev.token.mcap === next.token.mcap
  && prev.token.liquidity === next.token.liquidity
  && prev.token.change === next.token.change
  && prev.token.holders === next.token.holders
  && Math.floor(prev.ageMsLive / 5000) === Math.floor(next.ageMsLive / 5000)
  && ((prev.owned && prev.owned.amount) || null) === ((next.owned && next.owned.amount) || null)
  && prev.busy === next.busy
  && prev.solPrice === next.solPrice
  && ((prev.costBasis && prev.costBasis.sol_in) || 0) === ((next.costBasis && next.costBasis.sol_in) || 0)
  && ((prev.costBasis && prev.costBasis.sol_out) || 0) === ((next.costBasis && next.costBasis.sol_out) || 0)
  && prev.quickAmount === next.quickAmount
  && prev.ownedMode === next.ownedMode
  && prev.isFresh === next.isFresh
));

/* ============================================================
   PRESETS MODAL · FILTERS MODAL · WALLET DRAWER
   ============================================================ */
function PresetsModal({ buyPresets, setBuyPresets, sellPresets, setSellPresets, onClose }) {
  const [buyDraft, setBuyDraft] = useState(buyPresets);
  const [sellDraft, setSellDraft] = useState(sellPresets);
  const [nb, setNb] = useState(''); const [ns, setNs] = useState('');
  const addBuy  = () => { const v = parseFloat(nb); if (!(v > 0) || buyDraft.includes(v))  { setNb(''); return; } setBuyDraft([...buyDraft, v].sort((a,b)=>a-b));  setNb(''); };
  const addSell = () => { const v = parseFloat(ns); if (!(v > 0) || v > 100 || sellDraft.includes(v)) { setNs(''); return; } setSellDraft([...sellDraft, v].sort((a,b)=>a-b)); setNs(''); };
  const save = () => { setBuyPresets(buyDraft.length ? buyDraft : DEFAULT_BUY_PRESETS); setSellPresets(sellDraft.length ? sellDraft : DEFAULT_SELL_PRESETS); onClose(); };
  return (
    <div className="ap-overlay center" onClick={onClose}>
      <div className="ap-sheet mini" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Inter',sans-serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#0b0b0c'}}>Quick <em style={{fontStyle:'italic',color:'#86868b'}}>amounts</em></h3>
          <div style={{fontFamily:'inherit',fontSize:10.5,color:'#86868b',marginTop:5,fontWeight:600}}>Tap to set · edit any time</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="ap-sec-lbl">Buy amounts (SOL)</div>
          <div className="ap-echips">
            {buyDraft.map(v => <span key={v} className="ap-echip">{v}<button className="x" onClick={()=>setBuyDraft(buyDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="ap-eadd"><input type="number" step="0.01" min="0" placeholder="0.5" value={nb} onChange={e=>setNb(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addBuy();}} /><button className="plus" onClick={addBuy}>+</button></span>
          </div>
          <div className="ap-sec-lbl">Sell amounts (%)</div>
          <div className="ap-echips">
            {sellDraft.map(v => <span key={v} className="ap-echip">{v}%<button className="x" onClick={()=>setSellDraft(sellDraft.filter(x=>x!==v))}>×</button></span>)}
            <span className="ap-eadd"><input type="number" step="1" min="1" max="100" placeholder="50" value={ns} onChange={e=>setNs(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addSell();}} /><button className="plus" onClick={addSell}>+</button></span>
          </div>
          <button className="ap-esave" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function FiltersModal({ wildOnly, setWildOnly, minLiq, setMinLiq, onClose }) {
  const liqOptions = [0, 5000, 20000, 50000];
  return (
    <div className="ap-overlay center" onClick={onClose}>
      <div className="ap-sheet mini" onClick={e => e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Inter',sans-serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#0b0b0c'}}>Filters</h3>
          <div style={{fontFamily:'inherit',fontSize:10.5,color:'#86868b',marginTop:5,fontWeight:600}}>Narrow the feed</div>
        </div>
        <div style={{padding:'8px 22px 22px'}}>
          <div className="ap-filter-row">
            <div><div className="lbl">High risk only</div><div className="lbl-sub">Show only the high-risk picks</div></div>
            <div className={'ap-toggle' + (wildOnly ? ' on' : '')} onClick={() => setWildOnly(!wildOnly)} />
          </div>
          <div className="ap-filter-row" style={{flexDirection:'column',alignItems:'stretch'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:12}}>
              <div className="lbl">Minimum liquidity</div>
              <div style={{fontFamily:'inherit',fontSize:11,fontWeight:700,color:'#86868b'}}>{minLiq ? '$' + format(minLiq) : 'any'}</div>
            </div>
            <div className="lbl-sub" style={{marginBottom:6}}>Filter out thin pools</div>
            <div className="ap-liq-chips">
              {liqOptions.map(v => (<button key={v} className={'ap-liq-chip' + (minLiq === v ? ' on' : '')} onClick={() => setMinLiq(v)}>{v === 0 ? 'Any' : '$' + (v >= 1000 ? (v/1000) + 'K' : v)}</button>))}
            </div>
          </div>
          <button className="ap-esave" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function WalletDrawer({ wallet, solBalance, solPrice, onWithdraw, onClose, busy, balances, resolveToken }) {
  const [tab, setTab] = useState('deposit');
  const [copied, setCopied] = useState(false);
  const [dest, setDest] = useState(''); const [amt, setAmt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const qrRef = useRef(null);
  const addr = wallet.publicKey.toBase58();
  const sol = (solBalance && solBalance.uiAmount) || 0;
  const ownedList = useMemo(() => {
    if (!balances) return [];
    return Object.keys(balances)
      .filter(m => m !== SOL_MINT && (balances[m].uiAmount || 0) > 0)
      .map(m => {
        const tk = resolveToken ? resolveToken(m) : { mint: m, sym: '???', name: 'Unknown', price: 0 };
        const ui = balances[m].uiAmount || 0;
        return { tk, ui, usd: ui * (tk.price || 0) };
      })
      .sort((a, b) => b.usd - a.usd);
  }, [balances, resolveToken]);
  useEffect(() => {
    if (tab !== 'deposit' || !qrRef.current) return;
    let alive = true;
    (async () => {
      try { const QR = await import('qrcode'); if (!alive || !qrRef.current) return; const toCanvas = QR.toCanvas || (QR.default && QR.default.toCanvas); if (typeof toCanvas === 'function') await toCanvas(qrRef.current, addr, { width: 160, margin: 1, color: { dark: '#0b0b0c', light: '#ffffff' } }); } catch (e) {}
    })();
    return () => { alive = false; };
  }, [tab, addr]);
  const copy = () => { try { navigator.clipboard.writeText(addr); setCopied(true); setTimeout(()=>setCopied(false), 1500); } catch (e) {} };
  const maxOut = Math.max(0, sol - 0.001);
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-sheet" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <h3 style={{fontFamily:"'Inter',sans-serif",fontSize:26,margin:0,letterSpacing:'-.015em',color:'#0b0b0c',display:'flex',alignItems:'center',gap:10}}><span style={{width:8,height:8,borderRadius:'50%',background:'#11b87f',boxShadow:'0 0 8px #11b87f'}} />Your <em style={{fontStyle:'italic',color:'#86868b'}}>wallet</em></h3>
          <div style={{fontFamily:'inherit',fontSize:10.5,color:'#86868b',marginTop:5,fontWeight:600}}>lives on this device · signs instantly · your keys</div>
        </div>
        <div style={{padding:'14px 22px 22px'}}>
          <div className="ap-balcard">
            <div className="ap-ballbl">Ready to trade</div>
            <div className="ap-balval">{formatSol(sol)} <span className="u">SOL</span></div>
            <div className="ap-balusd">{solPrice > 0 ? '≈ $' + format(sol * solPrice) : ' '}</div>
          </div>
          {ownedList.length > 0 && (
            <div className="ap-block">
              <div className="ap-block-l">Your tokens · {ownedList.length}</div>
              {ownedList.map(({ tk, ui, usd }) => (
                <div className="ap-wtoken" key={tk.mint}>
                  <TokenFace token={tk} size={32} />
                  <div className="ap-wtoken-nm"><div className="ap-wtoken-sym">${tk.sym}</div><div className="ap-wtoken-amt">{formatTokens(ui)}{tk.name && tk.name !== tk.sym ? ' · ' + tk.name : ''}</div></div>
                  <div className="ap-wtoken-usd">{tk.price > 0 ? formatUsdAbs(usd) : '—'}</div>
                </div>
              ))}
            </div>
          )}
          <div className="ap-wgrid">
            <button className={'ap-wact' + (tab==='deposit'?' primary':'')} onClick={()=>setTab('deposit')}>↓ Deposit</button>
            <button className={'ap-wact' + (tab==='withdraw'?' primary':'')} onClick={()=>setTab('withdraw')}>↑ Withdraw</button>
          </div>
          {tab === 'deposit' && (
            <div className="ap-block">
              <div className="ap-block-l">Send SOL to this address</div>
              <div className="ap-qr"><canvas ref={qrRef} width="160" height="160" /></div>
              <div className="ap-addr"><div className="ap-addr-v">{addr}</div><button className="ap-copy" onClick={copy}>{copied?'COPIED':'COPY'}</button></div>
            </div>
          )}
          {tab === 'withdraw' && (
            <div className="ap-block">
              <div className="ap-block-l">Send SOL out</div>
              <input className="ap-input" placeholder="Destination address" value={dest} onChange={e=>setDest(e.target.value.trim())} />
              <input className="ap-input" type="number" step="0.001" placeholder={'Amount (max ' + formatSol(maxOut) + ')'} value={amt} onChange={e=>setAmt(e.target.value)} />
              <button className="ap-go" disabled={busy || !dest || !(Number(amt) > 0) || Number(amt) > maxOut} onClick={()=>onWithdraw(dest, Number(amt))}>{busy ? 'Sending…' : 'Withdraw ' + (Number(amt) > 0 ? Number(amt) + ' SOL' : '')}</button>
            </div>
          )}
          <div className="ap-block">
            <div className="ap-block-l">Back up your wallet {wallet.backedUp ? '✓' : ''}</div>
            {!revealed ? (
              <button className="ap-go" style={{background:'#f4f4f5',color:'#a67200',boxShadow:'none',border:'1px solid rgba(166,114,0,.30)'}} onClick={()=>{ setRevealed(true); wallet.markBackedUp(); }}>Show secret key</button>
            ) : (
              <>
                <div className="ap-secret">{wallet.exportSecret()}</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button className="ap-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>{ try{navigator.clipboard.writeText(wallet.exportSecret());}catch(e){} }}>COPY KEY</button>
                  <button className="ap-copy" style={{flex:1,padding:'10px 0'}} onClick={()=>setRevealed(false)}>HIDE</button>
                </div>
              </>
            )}
            <div style={{fontFamily:'inherit',fontSize:10,color:'#aeaeb2',marginTop:8,fontWeight:600,lineHeight:1.5}}>Save this somewhere safe. Anyone with it controls this wallet. Import into Phantom ("Import private key") to recover.</div>
          </div>
          <div className="ap-warn"><b>Hot burner.</b> Keep only trade-money here. The key is stored on this device — clear your browser and it's gone unless you backed it up.</div>
          <div style={{textAlign:'center'}}><span className="ap-nc">● Non-custodial · your keys</span></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TRADE SHEET — "Safety read" / readable risk verdicts
   ============================================================ */
function TradeSheet({ token, initialMode, onClose, onConfirm, buyPresets, sellPresets, solBalance, tokenBalance, solPrice }) {
  const [mode, setMode] = useState(initialMode || 'buy');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [dcCopied, setDcCopied] = useState(false);
  useEffect(() => { setAmount(''); setError(null); }, [mode]);
  useEffect(() => { setError(null); }, [amount]);
  const isBuy = mode === 'buy';
  const presets = isBuy ? buyPresets : sellPresets;
  const ownedUi = (tokenBalance && tokenBalance.uiAmount) || 0;
  const availSol = Math.max(0, ((solBalance && solBalance.uiAmount) || 0) - SOL_RESERVE);
  const swapParams = useMemo(() => {
    if (!amount) return null;
    const n = Number(amount); if (!Number.isFinite(n) || n <= 0) return null;
    return isBuy ? buildBuyParams(n) : buildSellParams(token, n, tokenBalance, solPrice);
  }, [amount, isBuy, token, tokenBalance, solPrice]);
  const est = useMemo(() => {
    if (!swapParams || !(token && token.price > 0) || !(solPrice > 0)) return null;
    if (swapParams.mode === 'buy') { const tradeSol = Number(swapParams.tradeLamports)/1e9; const tokens = (tradeSol*solPrice)/token.price; return tokens>0?{tokens}:null; }
    const grossSol = (swapParams.tradeTokensUi * token.price)/solPrice; const netSol = grossSol*(1-FEE_BPS/10000); return netSol>0?{sol:netSol}:null;
  }, [swapParams, token && token.price, solPrice]);
  // No client-side buy/sell limits: any positive amount is allowed to fire.
  // The chain validates funds — we don't block the trade here.
  const hasAmount = isBuy
    ? (!!amount && Number(amount) > 0)
    : (!!amount && Number(amount) > 0 && ownedUi > 0);
  const disabled = confirming || !swapParams || !hasAmount || !!error;
  const go = async () => {
    if (!swapParams || confirming) return;
    setConfirming(true); setError(null);
    try { await onConfirm({ mode, swapParams, token }); }
    catch (e) { setError(friendlyError(e)); setConfirming(false); }
  };
  const read = riskRead(token);
  const tierClass = read.tier === 'low' ? '' : read.tier === 'med' ? 'amber' : 'red';
  const verdict = read.label === 'Steady' ? 'Looks low risk — still be careful'
              : read.label === 'Mixed'  ? 'Mixed signals'
              : 'High risk · be careful';
  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-sheet" onClick={e=>e.stopPropagation()}>
        <div className="ap-tshead">
          <button className="ap-x" onClick={onClose}>×</button>
          <div className="ap-tshead-row">
            <TokenFace token={token} size={56} />
            <div className="title">
              <div className="sym">${token.sym}</div>
              <div className="sub">{formatPrice(token.price)}{Number.isFinite(token.change) && token.change !== 0 ? <> · <span style={{color:token.change<0?'#f0425a':'#11b87f'}}>{formatPct(token.change)}</span></> : null}</div>
            </div>
          </div>
        </div>
        <TokenChart token={token} solPrice={solPrice} />
        <div className={'ap-safety ' + tierClass}>
          <div className="ap-safety-top">
            <span className="ap-safety-l">Safety read</span>
            <span className={'ap-safety-s ' + tierClass}>{read.score}<span className="of">/{RISK_CEIL}</span></span>
          </div>
          <div className={'ap-safety-verdict ' + tierClass}>{verdict}</div>
          <div className="ap-safety-chks">{read.knowns.map((c,i)=><span key={i} className={'ap-chk '+c[0]}>{c[1]}</span>)}</div>
        </div>
        <div className="ap-dyor">Can't be checked: {read.unknowns.join(' · ')}. Even a clean read can rug — only trade what you can lose.</div>
        <div className="ap-research">
          <div className="ap-research-grid">
            <div className="ap-rstat"><span className="k">Market cap</span><span className="v">{token.mcap > 0 ? '$' + format(token.mcap) : '—'}</span></div>
            <div className="ap-rstat"><span className="k">Liquidity</span><span className="v">{token.liquidity > 0 ? '$' + format(token.liquidity) : '—'}</span></div>
            <div className="ap-rstat"><span className="k">Volume 24h</span><span className="v">{token.volume24h > 0 ? '$' + format(token.volume24h) : '—'}</span></div>
            <div className="ap-rstat"><span className="k">Holders</span><span className="v">{token.holders > 0 ? Math.round(token.holders).toLocaleString() : '—'}</span></div>
            <div className="ap-rstat"><span className="k">Age</span><span className="v">{token.pairCreatedAtMs ? fmtAgeShort(Date.now() - token.pairCreatedAtMs) : '—'}</span></div>
            <div className="ap-rstat"><span className="k">Bonding</span><span className="v">{token.bond != null ? token.bond.toFixed(0) + '%' : (token.dex && !/^pump/i.test(token.dex) ? 'graduated' : '—')}</span></div>
          </div>
          <div className="ap-research-links">
            <a className="ap-rlink" href={'https://dexscreener.com/solana/' + encodeURIComponent(token.mint)} target="_blank" rel="noreferrer">Live transactions on DexScreener ↗</a>
            <button className="ap-rcopy" onClick={() => { try { navigator.clipboard.writeText(token.mint); } catch (e) {} }} title="Copy contract address">Copy CA</button>
          </div>
          <div className="ap-share-row">
            <button className="ap-share x" onClick={() => { const txt = 'Eyeing $' + token.sym + ' on Ape — fresh launches caught at first light:'; openTwitterShare(txt, buildShareUrl()); }}>𝕏 Share</button>
            <button className="ap-share tg" onClick={() => { const txt = 'Eyeing $' + token.sym + ' on Ape — fresh launches caught at first light:'; openTelegram(txt, buildShareUrl()); }}>Telegram</button>
            <button className={'ap-share dc' + (dcCopied ? ' done' : '')} onClick={async () => { const txt = 'Eyeing $' + token.sym + ' on Ape — fresh launches caught at first light:'; const ok = await openDiscord(txt, buildShareUrl()); if (ok) { setDcCopied(true); setTimeout(() => setDcCopied(false), 1800); } }}>{dcCopied ? 'Copied ✓' : 'Discord'}</button>
          </div>
        </div>
        <div className={'ap-mode-tabs' + (isBuy?'':' sell')}>
          <div className="ap-mode-ind" />
          <button className={'ap-mode-tab'+(isBuy?' active':'')} onClick={()=>setMode('buy')}>Buy</button>
          <button className={'ap-mode-tab'+(!isBuy?' active':'')} onClick={()=>setMode('sell')}>Sell</button>
        </div>
        <div className="ap-field">
          <div className="ap-field-row1">
            <span className="ap-field-l">{isBuy?'You pay':'You sell'}</span>
            <span className="ap-field-bal">
              {isBuy ? <>Wallet: <b>{formatSol((solBalance&&solBalance.uiAmount)||0)} SOL</b></> : <>You own: <b>{formatTokens(ownedUi)} ${token.sym}</b></>}
              {isBuy && availSol > 0 ? <button className="ap-field-max" onClick={()=>setAmount(String(Math.floor(availSol*10000)/10000))}>MAX</button> : null}
            </span>
          </div>
          <div className="ap-field-row2">
            <div className="ap-field-chip">{isBuy ? <><span className="lg">◎</span><span>SOL</span></> : <><span className="lg"><TokenChip token={token} /></span><span>{token.sym}</span></>}</div>
            <input className="ap-field-amt" type="text" inputMode="decimal" placeholder={isBuy?'0.00':'0'} value={amount} onChange={e=>{ const val=e.target.value.replace(/[^\d.]/g,''); if(val.split('.').length>2)return; if(!isBuy&&Number(val)>100){setAmount('100');return;} setAmount(val); }} />
          </div>
        </div>
        <div className="ap-presets">
          {presets.map(pv => <button key={pv} className={'ap-preset'+(Number(amount)===pv?(isBuy?' on':' on sell'):'')} onClick={()=>setAmount(String(pv))}>{isBuy?(pv+' SOL'):(pv+'%')}</button>)}
        </div>
        {swapParams && Number(amount) > 0 && (
          <div className="ap-summary">
            <div className="ap-sum"><span className="k">Route</span><span className="v">{token.dex || 'pump.fun'}</span></div>
            {isBuy ? <>
              <div className="ap-sum"><span className="k">Platform fee (3%)</span><span className="v">{formatSol(Number(swapParams.feeLamports)/1e9)} SOL</span></div>
              <div className="ap-sum"><span className="k">Wallet pays</span><span className="v">{formatSol(Number(swapParams.totalLamports)/1e9)} SOL</span></div>
              <div className="ap-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.tokens>0?'≈ '+formatTokens(est.tokens)+' '+token.sym:'—'}</span></div>
            </> : <>
              <div className="ap-sum"><span className="k">Selling</span><span className="v">{formatTokens(swapParams.tradeTokensUi)} {token.sym} ({Math.min(100,Number(amount)).toFixed(0)}%)</span></div>
              <div className="ap-sum"><span className="k">Platform fee (3%)</span><span className="v">≈ {Number(swapParams.feeLamports)/1e9>0?formatSol(Number(swapParams.feeLamports)/1e9):'—'} SOL</span></div>
              <div className="ap-sum"><span className="k">You receive (est)</span><span className="v good">{est&&est.sol>0?'≈ '+formatSol(est.sol)+' SOL':'—'}</span></div>
            </>}
          </div>
        )}
        {error && <div className="ap-banner">{error}</div>}
        <button className={'ap-confirm'+(isBuy?'':' sell')} disabled={disabled} onClick={go}>
          {confirming ? (isBuy?'Buying…':'Selling…') : !amount||Number(amount)<=0 ? (isBuy?'Enter SOL amount':'Enter percentage') : (!isBuy && ownedUi<=0) ? ('No '+token.sym+' to sell') : (isBuy?('Buy '+amount+' SOL → '+token.sym):('Sell '+Math.min(100,Number(amount))+'% of '+token.sym))}
        </button>
        <p className="ap-tfoot">{token.dex || 'pump.fun'} · 3% fee · settles in seconds</p>
      </div>
    </div>
  );
}

/* ============================================================
   WATCHED WALLETS — user-curated wallet tracker.
   Users paste any Solana address; we show its live SOL + token
   holdings (via RPC, the same call balances use) and deep-link to
   Solscan / GMGN for full trade history + PnL. No hardcoded list,
   no scraping — the user curates who's worth watching.
   ============================================================ */
const WATCH_KEY = 'lr_watched_wallets_v1';
const BASE58_WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function loadWatched() {
  try { const r = localStorage.getItem(WATCH_KEY); if (!r) return []; const a = JSON.parse(r); return Array.isArray(a) ? a.filter(w => w && BASE58_WALLET_RE.test(w.addr)) : []; }
  catch (e) { return []; }
}
function saveWatched(list) { try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) {} }

function WatchedWallets({ open, onClose, solPrice, resolveToken }) {
  const [list, setList] = useState(() => loadWatched());
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState(null);
  const [holdings, setHoldings] = useState({}); // addr -> { sol, tokens:[{mint,uiAmount}], loading, error }

  useEffect(() => { saveWatched(list); }, [list]);

  const refreshOne = useCallback(async (addr) => {
    setHoldings(prev => ({ ...prev, [addr]: { ...(prev[addr] || {}), loading: true, error: null } }));
    try {
      const conn = getConn();
      const owner = new PublicKey(addr);
      const [lamports, tk, tk22] = await Promise.all([
        conn.getBalance(owner, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT),
      ]);
      const tokens = [];
      for (const accs of [tk, tk22]) {
        for (const acc of (accs.value || [])) {
          const info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
          const uiAmount = info && info.tokenAmount && info.tokenAmount.uiAmount;
          if (info && info.mint && uiAmount > 0) tokens.push({ mint: info.mint, uiAmount });
        }
      }
      tokens.sort((a, b) => b.uiAmount - a.uiAmount);
      setHoldings(prev => ({ ...prev, [addr]: { sol: lamports / 1e9, tokens: tokens.slice(0, 12), loading: false, error: null } }));
    } catch (e) {
      setHoldings(prev => ({ ...prev, [addr]: { ...(prev[addr] || {}), loading: false, error: 'Could not load' } }));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    for (const w of list) refreshOne(w.addr);
    const id = setInterval(() => { for (const w of list) refreshOne(w.addr); }, 30000);
    return () => clearInterval(id);
  }, [open, list, refreshOne]);

  if (!open) return null;

  const add = () => {
    const addr = input.trim();
    if (!BASE58_WALLET_RE.test(addr)) { setErr('That does not look like a Solana address.'); return; }
    if (list.some(w => w.addr === addr)) { setErr('Already watching that wallet.'); return; }
    setList(prev => [{ addr, label: label.trim() || null, addedAt: Date.now() }, ...prev]);
    setInput(''); setLabel(''); setErr(null);
  };
  const remove = (addr) => { setList(prev => prev.filter(w => w.addr !== addr)); };

  return (
    <div className="ap-overlay" onClick={onClose}>
      <div className="ap-watch" onClick={e => e.stopPropagation()}>
        <div className="ap-watch-head">
          <div className="ap-watch-title">Watched <span className="it">wallets</span></div>
          <button className="ap-x" onClick={onClose}>×</button>
        </div>
        <div className="ap-watch-add">
          <input className="ap-watch-in" placeholder="Paste a Solana wallet address" value={input} onChange={e => { setInput(e.target.value); setErr(null); }} />
          <input className="ap-watch-in label" placeholder="Label (optional)" value={label} onChange={e => setLabel(e.target.value)} />
          <button className="ap-watch-addbtn" onClick={add}>Track</button>
        </div>
        {err ? <div className="ap-watch-err">{err}</div> : null}
        {list.length === 0 ? (
          <div className="ap-watch-empty">
            <span className="glyph">◎</span>
            <b>No wallets yet</b>
            <span className="sub">Paste any Solana address to track what it holds. Find smart-money wallets on Nansen, Dune, or by watching who buys early.</span>
          </div>
        ) : (
          <div className="ap-watch-list">
            {list.map(w => {
              const h = holdings[w.addr] || {};
              return (
                <div className="ap-watch-row" key={w.addr}>
                  <div className="ap-watch-row-top">
                    <div className="ap-watch-id">
                      <span className="lbl">{w.label || (w.addr.slice(0, 4) + '…' + w.addr.slice(-4))}</span>
                      <span className="addr">{w.addr.slice(0, 6)}…{w.addr.slice(-6)}</span>
                    </div>
                    <div className="ap-watch-actions">
                      <span className="sol">{h.loading ? '…' : h.sol != null ? formatSol(h.sol) + ' SOL' : (h.error || '—')}</span>
                      <button className="rm" onClick={() => remove(w.addr)} title="Stop watching">×</button>
                    </div>
                  </div>
                  {h.tokens && h.tokens.length > 0 ? (
                    <div className="ap-watch-holds">
                      {h.tokens.map(t => {
                        const tok = resolveToken ? resolveToken(t.mint) : null;
                        return <span className="hold" key={t.mint}>{tok && tok.sym && tok.sym !== '???' ? '$' + tok.sym : (t.mint.slice(0, 4) + '…')}</span>;
                      })}
                    </div>
                  ) : null}
                  <div className="ap-watch-links">
                    <a href={'https://solscan.io/account/' + w.addr} target="_blank" rel="noreferrer">Trades on Solscan ↗</a>
                    <a href={'https://gmgn.ai/sol/address/' + w.addr} target="_blank" rel="noreferrer">PnL ↗</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   MAIN APE PAGE
   ============================================================ */
export default function Ape({ mainWalletPubkey }) {
  useApCSS();
  const wallet = useLocalWallet();
  const walletStr = wallet.publicKey.toBase58();
  const { buyPresets, setBuyPresets, sellPresets, setSellPresets } = usePresets();

  const [recent, setRecent] = useState([]);
  const [feedError, setFeedError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('feed');
  const [activeQuickIdx, setActiveQuickIdx] = useState(0);
  const [wildOnly, setWildOnly] = useState(false);
  const [minLiq, setMinLiq] = useState(0);

  const [solBalance, setSolBalance] = useState(null);
  const [solPrice, setSolPrice] = useState(0);
  const [balances, setBalances] = useState({});
  const [tokenIndex, setTokenIndex] = useState({});
  // Per-mint cost basis (sol_in / sol_out) from the server trade log, used to
  // show live P&L on each owned row. Keyed by mint. Refreshed on the same
  // cadence as positions. Only mints traded through the app appear here.
  const [pnlBasis, setPnlBasis] = useState({});
  useEffect(() => {
    if (!walletStr) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/ref/pnl?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const map = {};
        for (const p of (d.positions || [])) {
          if (!p || !p.mint) continue;
          map[p.mint] = { sol_in: Number(p.sol_in) || 0, sol_out: Number(p.sol_out) || 0, open_tokens: Number(p.open_tokens) || 0 };
        }
        setPnlBasis(prev => {
          const keys = Object.keys(map);
          if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] && prev[k].sol_in === map[k].sol_in && prev[k].sol_out === map[k].sol_out && prev[k].open_tokens === map[k].open_tokens)) return prev;
          return map;
        });
      } catch (e) {}
    };
    load();
    const id = setInterval(load, POLL_POSITIONS);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr]);

  // FIX 2: tokenMeta for owned tokens not in the live feed, plus tradeConnection
  const [tokenMeta, setTokenMeta] = useState({});
  const tradeConnection = useMemo(() => getTradeConn('confirmed'), []);
  const metaPendingRef = useRef(new Set());

  const [tradeToken, setTradeToken] = useState(null);
  const [tradeMode, setTradeMode] = useState('buy');
  const [showPresets, setShowPresets] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsTab, setStatsTab] = useState('referrals');
  const [showAuto, setShowAuto] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [hotWindow, setHotWindow] = useState('1h'); // 5m | 1h | 24h
  // Discovery view: a research lens over the same feed. Sort toggle decides the
  // lead (no default bias); filters narrow the live launch set. Reuses riskRead
  // + normalize so mint discipline and safety scoring are identical to the feed.
  const [discSort, setDiscSort] = useState('new'); // new | hot | gainers | safest
  const [discMinLiq, setDiscMinLiq] = useState(0);
  const [discMinMcap, setDiscMinMcap] = useState(0);
  const [discMaxMcap, setDiscMaxMcap] = useState(0); // 0 = no cap
  const [discMinHolders, setDiscMinHolders] = useState(0);
  const [discMinScore, setDiscMinScore] = useState(0);
  const [discAge, setDiscAge] = useState('any'); // any | 5m | 1h | 6h | 24h
  const [discFiltersOpen, setDiscFiltersOpen] = useState(false);
  // Discover pulls its own universe (all tradable Solana via Jupiter), separate
  // from the launch feed. Sort 'new' hits Jupiter /recent; others hit the
  // organic-ranked list. Client-side filters then narrow it.
  const [discTokens, setDiscTokens] = useState([]);
  const [discLoading, setDiscLoading] = useState(false);
  const [discError, setDiscError] = useState(null);
  const [showLure, setShowLure] = useState(() => { try { return localStorage.getItem(HAS_TRADED_KEY) !== '1'; } catch (e) { return true; } });

  const [busyMints, setBusyMints] = useState({});
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confettiAt, setConfettiAt] = useState(0);
  const lastFreshMintRef = useRef(null);

  const quickAmount = buyPresets[activeQuickIdx] || buyPresets[0] || 0.5;

  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration || 6500);
  }, []);

  // Referral registration is keyed on the MAIN wallet (the durable identity),
  // not the burner. The burner only signs trades and never enters the referral
  // graph, so attribution survives a browser/burner reset. The referrer comes
  // from ?ref= on the URL (a main wallet, set by an invite link). Guard against
  // self-referral via either the main wallet or the burner.
  useEffect(() => {
    if (!mainWalletPubkey) return;
    let referrer = null;
    try {
      const r = new URLSearchParams(window.location.search).get('ref');
      if (r && r !== mainWalletPubkey && r !== walletStr) referrer = r;
    } catch (e) {}
    refRegister(mainWalletPubkey, referrer);
  }, [mainWalletPubkey, walletStr]);

  // Feed
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/dex/launches');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (cancelled) return;
        const raw = Array.isArray(d?.tokens) ? d.tokens.map(normalize) : [];
        const seen = new Set();
        const list = [];
        for (const t of raw) { if (t && t.mint && !seen.has(t.mint)) { seen.add(t.mint); list.push(t); } }
        setRecent(list);
        setTokenIndex(prev => { const next = { ...prev }; for (const t of list) if (t && t.mint) next[t.mint] = t; return next; });
        setFeedError(null);

        // Enrich rows with market cap + bonding % from pump.fun's curve, which
        // the launches feed doesn't carry. Fire-and-forget; fills gaps only.
        const mints = list.filter(t => t && t.mint).map(t => t.mint).slice(0, 60);
        if (mints.length) {
          fetch('/api/ape/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mints }) })
            .then(er => (er.ok ? er.json() : null))
            .then(ed => {
              if (cancelled || !ed || !ed.tokens) return;
              const map = ed.tokens;
              const fill = (t) => {
                const x = t && t.mint && map[t.mint];
                if (!x) return t;
                const nt = { ...t };
                if (!(nt.mcap > 0) && Number(x.mcap) > 0) nt.mcap = Number(x.mcap);
                if (!(nt.price > 0) && Number(x.price) > 0) nt.price = Number(x.price);
                if (!(nt.volume24h > 0) && Number(x.volume24h) > 0) nt.volume24h = Number(x.volume24h);
                if (!(nt.liquidity > 0) && Number(x.liquidity) > 0) nt.liquidity = Number(x.liquidity);
                if (!nt.pool && x.pool) nt.pool = x.pool;
                return nt;
              };
              setRecent(prev => prev.map(fill));
              setTokenIndex(prev => { const next = { ...prev }; for (const m in map) if (next[m]) next[m] = fill(next[m]); return next; });
            })
            .catch(() => {});
        }
      } catch (e) { if (!cancelled) setFeedError(String(e.message || 'Network').slice(0, 100)); }
    };
    load();
    const id = setInterval(load, POLL_RECENT);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Discover universe — all tradable Solana via Jupiter. Only fetches while the
  // Discover tab is open. 'new' sort -> Jupiter /recent; the momentum/safety
  // sorts all draw from the organic-ranked universe and re-sort client-side.
  useEffect(() => {
    if (activeTab !== 'discovery') return;
    let cancelled = false;
    const srt = discSort === 'new' ? 'new' : 'organic';
    const load = async () => {
      try {
        setDiscLoading(true);
        const r = await fetch('/api/dex/discover?sort=' + srt + '&tf=24h');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (cancelled) return;
        // Server already normalized to our token shape; keep mint verbatim.
        const _seen = new Set();
        const list = (Array.isArray(d?.tokens) ? d.tokens : []).filter(t => {
          if (!t || !t.mint || _seen.has(t.mint)) return false;
          _seen.add(t.mint); return true;
        });
        setDiscTokens(list);
        setTokenIndex(prev => { const next = { ...prev }; for (const t of list) if (t && t.mint && !next[t.mint]) next[t.mint] = t; return next; });
        setDiscError(null);
      } catch (e) { if (!cancelled) setDiscError(String(e.message || 'Network').slice(0, 100)); }
      finally { if (!cancelled) setDiscLoading(false); }
    };
    load();
    const id = setInterval(load, srt === 'new' ? 8000 : 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTab, discSort]);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);

  // FIX 3: balRpcRace called with a function (its real signature)
  const refreshSol = useCallback(async () => {
    try {
      const lamps = await balRpcRace(conn => conn.getBalance(wallet.publicKey, BAL_COMMITMENT));
      setSolBalance(prev => { const ui = Number(lamps) / 1e9; if (prev && Math.abs(prev.uiAmount - ui) < 1e-9) return prev; return { lamports: lamps, uiAmount: ui }; });
    } catch (e) {}
    try {
      const r = await fetch('/api/dex/sol-price');
      if (r.ok) { const d = await r.json(); if (Number.isFinite(d?.price)) setSolPrice(p => Math.abs(p - d.price) < 0.01 ? p : d.price); }
    } catch (e) {}
  }, [wallet.publicKey]);
  useEffect(() => { refreshSol(); const id = setInterval(refreshSol, POLL_SOL); return () => clearInterval(id); }, [refreshSol]);

  // Balances — diffed before set
  const refreshBalances = useCallback(async () => {
    try {
      const conn = getConn();
      const owner = new PublicKey(walletStr);
      const [tk, tk22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT),
      ]);
      const next = {};
      for (const acc of [...tk.value, ...tk22.value]) {
        const info = acc.account.data.parsed.info;
        const mint = info.mint;
        const amount = info.tokenAmount.amount;
        const uiAmount = Number(info.tokenAmount.uiAmount) || 0;
        const decimals = Number(info.tokenAmount.decimals);
        if (uiAmount > 0) next[mint] = { amount, uiAmount, decimals: Number.isFinite(decimals) ? decimals : 6 };
      }
      setBalances(prev => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length !== nextKeys.length) return next;
        for (const k of nextKeys) { if (!prev[k]) return next; if (prev[k].amount !== next[k].amount) return next; }
        return prev;
      });
    } catch (e) {}
  }, [walletStr]);
  useEffect(() => { refreshBalances(); const id = setInterval(refreshBalances, POLL_BALANCE); return () => clearInterval(id); }, [refreshBalances]);

  const refreshOneToken = useCallback(async (mint) => {
    try {
      const conn = getConn();
      const owner = new PublicKey(walletStr);
      const [tk, tk22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID, mint: new PublicKey(mint) }, BAL_COMMITMENT),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID, mint: new PublicKey(mint) }, BAL_COMMITMENT),
      ]);
      let amount = '0', uiAmount = 0, decimals = 6;
      for (const acc of [...tk.value, ...tk22.value]) {
        const info = acc.account.data.parsed.info;
        amount = info.tokenAmount.amount;
        uiAmount = Number(info.tokenAmount.uiAmount) || 0;
        const d = Number(info.tokenAmount.decimals);
        if (Number.isFinite(d)) decimals = d;
      }
      setBalances(prev => {
        const cur = prev[mint];
        if (uiAmount === 0) { if (!cur) return prev; const next = { ...prev }; delete next[mint]; return next; }
        if (cur && cur.amount === amount) return prev;
        return { ...prev, [mint]: { amount, uiAmount, decimals } };
      });
    } catch (e) {}
  }, [walletStr]);

  // FIX 4: fetchTokenMeta + resolveToken that includes owned-token metadata
  const fetchTokenMeta = useCallback((mint) => {
    if (!mint || mint === SOL_MINT) return;
    if (metaPendingRef.current.has(mint)) return;
    metaPendingRef.current.add(mint);
    fetch('/api/dex/token/' + encodeURIComponent(mint))
      .then(r => (r.ok ? r.json() : null))
      .then(async (d) => {
        const t = (d && d.token) || null;
        let price = t ? Number(t.price || 0) : 0;
        let mcap = t ? Number(t.mcap || t.fdv || 0) : 0;
        let liquidity = t ? Number(t.liquidity || 0) : 0;
        let holders = t ? Number(t.holders || 0) : 0;
        let sym = t && t.sym, name = t && t.name, icon = t && t.icon;
        let volume24h = t ? Number(t.volume24h || 0) : 0;
        let pool = null;
        let bond = null;
        // DexScreener thin/missing → pull pump.fun bonding-curve data and merge.
        if (!t || !(liquidity > 0) || !(holders > 0)) {
          try {
            const pr = await fetch('/api/pump/info/' + encodeURIComponent(mint));
            if (pr.ok) {
              const pf = await pr.json();
              if (pf) {
                if (!(liquidity > 0) && Number(pf.liquidity) > 0) liquidity = Number(pf.liquidity);
                if (!(holders > 0) && Number(pf.holders) > 0)     holders   = Number(pf.holders);
                if (!icon && pf.icon)                             icon      = pf.icon;
                if (!sym && pf.sym)                               sym       = pf.sym;
                if (!name && pf.name)                             name      = pf.name;
              }
            }
          } catch (e) {}
        }
        // GeckoTerminal (via /api/ape/curve) — market cap, volume, price, and
        // the pool address for the chart embed. Available before DexScreener indexes.
        try {
          const cr = await fetch('/api/ape/curve/' + encodeURIComponent(mint));
          if (cr.ok) {
            const cv = await cr.json();
            if (cv && cv.found) {
              if (!(mcap > 0)      && Number(cv.mcap) > 0)      mcap      = Number(cv.mcap);
              if (!(price > 0)     && Number(cv.price) > 0)     price     = Number(cv.price);
              if (!(volume24h > 0) && Number(cv.volume24h) > 0) volume24h = Number(cv.volume24h);
              if (!(liquidity > 0) && Number(cv.liquidity) > 0) liquidity = Number(cv.liquidity);
              if (!pool && cv.pool)                             pool      = cv.pool;
            }
          }
        } catch (e) {}
        if (!t && !(price > 0) && !(liquidity > 0) && !(mcap > 0) && !pool) return; // nothing usable
        setTokenMeta(prev => ({
          ...prev,
          [mint]: {
            mint,
            sym: sym || (prev[mint] && prev[mint].sym) || '???',
            name: name || (prev[mint] && prev[mint].name) || 'Unknown',
            icon: icon || (prev[mint] && prev[mint].icon) || null,
            price,
            mcap,
            liquidity,
            holders,
            volume24h,
            pool,
            bond,
          },
        }));
      })
      .catch(() => {})
      .finally(() => { metaPendingRef.current.delete(mint); });
  }, []);

  const resolveToken = useCallback(
    (mint) => tokenMeta[mint] || tokenIndex[mint] || { mint, sym: '???', name: 'Unknown', price: 0, icon: null },
    [tokenIndex, tokenMeta]
  );

  // Refresh metadata/price for owned tokens not in the live feed, on a timer
  // so P&L stays current even after they age off the launch feed.
  useEffect(() => {
    const refreshOwned = () => {
      for (const mint of Object.keys(balances)) {
        if (mint === SOL_MINT) continue;
        if ((balances[mint].uiAmount || 0) > 0) fetchTokenMeta(mint);
      }
    };
    refreshOwned();
    const id = setInterval(refreshOwned, 5000);
    return () => clearInterval(id);
  }, [balances, fetchTokenMeta]);

  // Backfill the OPEN token sheet from /api/dex/token + /api/pump/info so
  // holders + liquidity fill in immediately, and mcap/volume/price appear the
  // moment DexScreener indexes the pair — no dependence on the launches feed.
  useEffect(() => {
    if (!tradeToken || !tradeToken.mint) return;
    fetchTokenMeta(tradeToken.mint);
    const id = setInterval(() => fetchTokenMeta(tradeToken.mint), 4000);
    return () => clearInterval(id);
  }, [tradeToken, fetchTokenMeta]);

  // Merge feed data with on-demand metadata. A real value always wins over a
  // missing/zero one, so backfilled fields never blank out good feed numbers.
  const mergeTokenData = useCallback((base) => {
    if (!base || !base.mint) return base;
    const idx = tokenIndex[base.mint] || {};
    const meta = tokenMeta[base.mint] || {};
    const out = { ...base, ...idx };
    if (Number(meta.price) > 0) out.price = Number(meta.price);
    for (const k of ['mcap', 'liquidity', 'volume24h', 'holders']) {
      const v = Number(meta[k]);
      if (Number.isFinite(v) && v > 0) out[k] = Math.max(Number(out[k]) || 0, v);
    }
    if (meta.bond != null && Number.isFinite(Number(meta.bond))) out.bond = Number(meta.bond);
    if (!out.pool && meta.pool) out.pool = meta.pool;
    if (!out.icon && meta.icon) out.icon = meta.icon;
    if ((!out.sym || out.sym === '???') && meta.sym) out.sym = meta.sym;
    if ((!out.name || out.name === 'Unknown') && meta.name) out.name = meta.name;
    return out;
  }, [tokenIndex, tokenMeta]);

  // solPrice held in a ref so executeSwap's identity stays stable across the
  // 30s price refresh — otherwise the auto-trade exit-loop effect (which
  // depends on executeSwap) tears down and rebuilds its interval every 30s.
  const solPriceRef = useRef(solPrice);
  useEffect(() => { solPriceRef.current = solPrice; }, [solPrice]);

  // FIX 1: executeSwap wrapper with correct arg shape for ape-helpers.executeSwap
  const executeSwap = useCallback(async ({ mode, token, swapParams, tradeLamports, feeLamports, totalLamports, tradeTokensRaw, tradeTokensUi, decimals }) => {
    const params = swapParams || (mode === 'buy'
      ? { mode: 'buy', tradeLamports, feeLamports, totalLamports }
      : { mode: 'sell', tradeTokens: tradeTokensRaw, tradeTokensUi, feeLamports: feeLamports != null ? String(feeLamports) : '0', decimals: decimals != null ? Number(decimals) : 6 });
    const result = await apeExecuteSwap({
      mode: params.mode,
      swapParams: params,
      token,
      keypair: wallet.keypair,
      userPk: wallet.publicKey,
      tradeConnection,
      walletStr,
      refWalletStr: mainWalletPubkey,
      solPrice: solPriceRef.current,
    });
    try { localStorage.setItem(HAS_TRADED_KEY, '1'); } catch (e) {}
    setShowLure(false);
    setTimeout(() => { refreshSol(); refreshOneToken(token.mint); }, 800);
    return result;
  }, [wallet.keypair, wallet.publicKey, tradeConnection, walletStr, mainWalletPubkey, refreshSol, refreshOneToken]);

  // FIX 5: result.sig (ape-helpers returns { confirmed, sig })
  const onApe = useCallback(async (token) => {
    if (busyMints[token.mint]) return;
    setBusyMints(prev => ({ ...prev, [token.mint]: true }));
    try {
      const params = buildBuyParams(quickAmount);
      const result = await executeSwap({ mode: 'buy', token, swapParams: params });
      setConfettiAt(Date.now());
      pushToast({
        type: 'success', em: '✓',
        body: <>Bought <b>{quickAmount} SOL</b> of <b>${token.sym}</b></>,
        actions: result?.sig ? [
          { type: 'link', href: 'https://solscan.io/tx/' + result.sig, label: 'TX' },
          { type: 'tweet', text: 'Just aped ' + quickAmount + ' SOL into $' + token.sym + ' on Nexus 🚀\n\n', url: shareUrlPath(walletStr), label: 'Share' },
        ] : [],
      });
    } catch (e) { pushToast({ type: 'error', em: '⊘', body: friendlyError(e) }); }
    finally { setBusyMints(prev => { const n = { ...prev }; delete n[token.mint]; return n; }); }
  }, [busyMints, quickAmount, executeSwap, pushToast, walletStr]);

  const onSell = useCallback((token) => { setTradeToken(token); setTradeMode('sell'); }, []);
  const onRowClick = useCallback((token) => { setTradeToken(token); setTradeMode('buy'); }, []);

  // FIX 6: result.sig
  const onTradeConfirm = useCallback(async ({ mode, swapParams, token }) => {
    const result = await executeSwap({ mode, token, swapParams });
    setConfettiAt(Date.now());
    setTradeToken(null);
    pushToast({
      type: 'success', em: '✓',
      body: <>{mode === 'buy' ? 'Bought' : 'Sold'} <b>${token.sym}</b></>,
      actions: result?.sig ? [
        { type: 'link', href: 'https://solscan.io/tx/' + result.sig, label: 'TX' },
        { type: 'tweet', text: (mode === 'buy' ? 'Just aped into $' : 'Just sold $') + token.sym + ' on Nexus\n\n', url: shareUrlPath(walletStr), label: 'Share' },
      ] : [],
    });
  }, [executeSwap, pushToast, walletStr]);

  const onWithdraw = useCallback(async (dest, amount) => {
    if (!dest || !(amount > 0)) return;
    setWithdrawBusy(true);
    try {
      const conn = getTradeConn();
      const lamports = Math.round(amount * 1e9);
      const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(dest), lamports });
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
      const tx = new VersionedTransaction(msg); tx.sign([wallet.keypair]);
      const sig = await conn.sendTransaction(tx);
      await conn.confirmTransaction(sig, 'confirmed');
      setTimeout(refreshSol, 1000);
      pushToast({ type: 'success', em: '✓', body: <>Withdrew <b>{amount} SOL</b></>, actions: [{ type: 'link', href: 'https://solscan.io/tx/' + sig, label: 'TX' }] });
      setShowWallet(false);
    } catch (e) { pushToast({ type: 'error', em: '⊘', body: friendlyError(e) }); }
    finally { setWithdrawBusy(false); }
  }, [wallet, refreshSol, pushToast]);

  const auto = useAutoTrade({
    recentTokens: recent, solBalance, solPrice, balances, executeSwap, pushToast,
  });

  const filtered = useMemo(() => {
    // OWNED tab = your bag. Driven entirely by wallet balances, never by the
    // launch feed. Show EVERYTHING you hold (no cap), biggest position value
    // first, and do NOT apply the discovery filters (wild / min-liq) — those
    // shape "All new" only and must never hide a token you actually own.
    if (activeTab === 'owned') {
      const held = [];
      for (const mint of Object.keys(balances)) {
        if (mint === SOL_MINT) continue;
        const bal = balances[mint];
        if (!bal || !(bal.uiAmount > 0)) continue;
        // Prefer live feed data for the token if present, else resolve metadata.
        const fromFeed = recent.find(t => t.mint === mint);
        const tok = fromFeed || resolveToken(mint);
        if (tok) held.push(tok);
      }
      held.sort((a, b) => {
        const av = ((balances[a.mint] && balances[a.mint].uiAmount) || 0) * (a.price || 0);
        const bv = ((balances[b.mint] && balances[b.mint].uiAmount) || 0) * (b.price || 0);
        return bv - av;
      });
      return held;
    }

    // ALL-NEW tab = discovery feed. Filters apply here; capped for scannability.
    let list = recent;
    if (wildOnly) list = list.filter(t => riskRead(t).tier === 'high');
    if (minLiq > 0) list = list.filter(t => (t.liquidity || 0) >= minLiq);

    // HOT tab = same feed data (so mints stay identical to "New"), re-lensed by
    // momentum: recent + moving + liquid. No new fetch, no second mint source.
    if (activeTab === 'hot') {
      const now2 = Date.now();
      // Time-window filter: only tokens created within the window. Falls back to
      // "no age = include" so tokens missing a timestamp still surface.
      const winMs = hotWindow === '5m' ? 5 * 60000 : hotWindow === '1h' ? 60 * 60000 : 24 * 60 * 60000;
      const windowed = list.filter(t => {
        if (!t.pairCreatedAtMs) return hotWindow === '24h'; // unknown age only in the widest window
        return (now2 - t.pairCreatedAtMs) <= winMs;
      });
      const score = (t) => {
        const chg = Math.abs(Number(t.change) || 0);            // movement
        const vol = Math.log10(Math.max(1, t.volume24h || 0));  // traded
        const liq = Math.log10(Math.max(1, t.liquidity || 0));  // tradable
        const ageMin = t.pairCreatedAtMs ? (now2 - t.pairCreatedAtMs) / 60000 : 9999;
        const fresh = ageMin < 720 ? (1 - ageMin / 720) : 0;     // decays over 12h
        return chg * 0.5 + vol * 8 + liq * 4 + fresh * 20;
      };
      return [...windowed].sort((a, b) => score(b) - score(a)).slice(0, 15);
    }

    // DISCOVERY = research lens over the FULL Jupiter universe (all tradable
    // Solana), not just the launch feed. Apply each filter (0/'any' = off),
    // then sort. Same mint keys, same riskRead. discTokens is server-normalized.
    if (activeTab === 'discovery') {
      const now2 = Date.now();
      let d = discTokens.slice();
      if (discMinLiq > 0) d = d.filter(t => (t.liquidity || 0) >= discMinLiq);
      if (discMinMcap > 0) d = d.filter(t => (t.mcap || 0) >= discMinMcap);
      if (discMaxMcap > 0) d = d.filter(t => (t.mcap || 0) <= discMaxMcap);
      if (discMinHolders > 0) d = d.filter(t => (t.holders || 0) >= discMinHolders);
      if (discMinScore > 0) d = d.filter(t => riskRead(t).score >= discMinScore);
      if (discAge !== 'any') {
        const winMs = discAge === '5m' ? 5 * 60000 : discAge === '1h' ? 60 * 60000 : discAge === '6h' ? 6 * 60 * 60000 : 24 * 60 * 60000;
        d = d.filter(t => t.pairCreatedAtMs ? (now2 - t.pairCreatedAtMs) <= winMs : false);
      }
      const byHot = (t) => {
        const chg = Math.abs(Number(t.change) || 0);
        const vol = Math.log10(Math.max(1, t.volume24h || 0));
        const liq = Math.log10(Math.max(1, t.liquidity || 0));
        return chg * 0.5 + vol * 8 + liq * 4;
      };
      if (discSort === 'hot') d.sort((a, b) => byHot(b) - byHot(a));
      else if (discSort === 'gainers') d.sort((a, b) => (Number(b.change) || 0) - (Number(a.change) || 0));
      else if (discSort === 'safest') d.sort((a, b) => riskRead(b).score - riskRead(a).score);
      // 'new' arrives already newest-first from Jupiter /recent; keep order.
      return d.slice(0, 30);
    }

    return list.slice(0, 15);
  }, [recent, discTokens, wildOnly, minLiq, activeTab, hotWindow, discSort, discMinLiq, discMinMcap, discMaxMcap, discMinHolders, discMinScore, discAge, balances, resolveToken]);

  const trending = useMemo(() => {
    return [...recent]
      .filter(t => Number.isFinite(t.change))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 6);
  }, [recent]);

  useEffect(() => {
    if (recent.length === 0) return;
    const first = recent[0];
    if (first && first.mint && first.mint !== lastFreshMintRef.current) {
      lastFreshMintRef.current = first.mint;
    }
  }, [recent]);

  const ownedCount = useMemo(() => Object.keys(balances).filter(m => m !== SOL_MINT && balances[m].uiAmount > 0).length, [balances]);
  const activeFiltersCount = (wildOnly ? 1 : 0) + (minLiq > 0 ? 1 : 0);
  const discActiveCount = (discMinLiq > 0 ? 1 : 0) + (discMinMcap > 0 ? 1 : 0) + (discMaxMcap > 0 ? 1 : 0) + (discMinHolders > 0 ? 1 : 0) + (discMinScore > 0 ? 1 : 0) + (discAge !== 'any' ? 1 : 0);
  const burnerHasNoSol = !solBalance || solBalance.uiAmount < 0.01;

  return (
    <div className="ap-root">
      <div className="ap-app">
        <nav className="ap-nav">
          <div className="ap-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="ap-brand-glyph">A</div>
            <span className="ap-bname">Ape<span className="dot">·</span><span className="it">early</span></span>
          </div>
          <div className="ap-nav-live"><span className="d" /><span>LIVE FEED</span></div>
          <button className="ap-nav-btn" onClick={() => setShowAuto(true)}>Auto-trade</button>
          <button className="ap-nav-btn" onClick={() => setShowWatch(true)}>Wallets</button>
          <button className="ap-nav-btn" onClick={() => { setStatsTab('referrals'); setShowStats(true); }}>Earnings</button>
          <button className="ap-nav-wallet" onClick={() => setShowWallet(true)}>
            <span className="glyph">◎</span>
            <span>{solBalance ? formatSol(solBalance.uiAmount) : '—'} SOL</span>
            <span className="dot" />
            {!wallet.backedUp && <span className="nudge" title="Back up your wallet" />}
          </button>
        </nav>

        <div className="ap-qbar">
          <span className="ap-qlabel"><span className="b">⚡</span>Quick buy</span>
          {buyPresets.map((v, i) => (
            <button key={v} className={'ap-qamt' + (i === activeQuickIdx ? ' active' : '')} onClick={() => setActiveQuickIdx(i)}>
              {v} <span className="s">SOL</span>
            </button>
          ))}
          <button className="ap-qedit" onClick={() => setShowPresets(true)} title="Edit amounts">✎</button>
          <span className="ap-qfast"><span className="d" /><span>2-SEC TRADE</span></span>
        </div>

        <div className="ap-page">
          {showLure && burnerHasNoSol ? (
            <div className="ap-lure">
              <div className="ap-lure-text">
                <div className="ap-lure-h">Fund your <span className="it">burner</span> to trade in 2 seconds.</div>
                <div className="ap-lure-s"><b>0.1 SOL</b> is plenty to start · trades sign on this device · no extension popup</div>
              </div>
              <button className="ap-lure-intro" onClick={() => setShowWallet(true)}>↓ DEPOSIT</button>
              <button className="ap-lure-close" onClick={() => setShowLure(false)}>×</button>
            </div>
          ) : null}

          <OpenPositionsStrip walletStr={walletStr} solPrice={solPrice} onOpenStats={() => { setStatsTab('yourtrades'); setShowStats(true); }} />

          {trending.length > 0 ? (
            <div className="ap-trending">
              <div className="ap-trending-head">
                <span className="lbl">★ Trending now</span>
                <span className="meta">Biggest moves · live</span>
              </div>
              <div className="ap-trending-rail">
                {trending.map(t => {
                  const c = colorFor(t.mint);
                  const up = (t.change || 0) >= 0;
                  return (
                    <div className="ap-trend-card" key={t.mint} onClick={() => onRowClick(t)}>
                      <div className="av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}><TokenChip token={t} /></div>
                      <div className="meta">
                        <div className="sym">${t.sym}</div>
                        <div className={'chg' + (up ? '' : ' dn')}>{formatPct(t.change)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="ap-list-frame">
            <div className="ap-list-head">
              <div className="ap-list-title">
                <span className="e">§ The feed</span>
                <span className="t">{activeTab === 'owned' ? <>Your <span className="it">bag</span></> : activeTab === 'hot' ? <>Hot <span className="it">right now</span></> : activeTab === 'discovery' ? <>Discover <span className="it">tokens</span></> : <>Fresh <span className="it">tokens</span></>}</span>
              </div>
              <div className="ap-list-filters">
                <button className={'ap-chip' + (activeTab === 'hot' ? ' on' : '')} onClick={() => setActiveTab('hot')}>🔥 Hot</button>
                <button className={'ap-chip' + (activeTab === 'feed' ? ' on' : '')} onClick={() => setActiveTab('feed')}>All new</button>
                <button className={'ap-chip' + (activeTab === 'discovery' ? ' on' : '')} onClick={() => setActiveTab('discovery')}>🔎 Discover</button>
                <button className={'ap-chip owned' + (activeTab === 'owned' ? ' on' : '')} onClick={() => setActiveTab('owned')}>You own{ownedCount > 0 ? ' · ' + ownedCount : ''}</button>
                <button className="ap-filter-btn" onClick={() => setShowFilters(true)}>
                  <span>Filters</span>{activeFiltersCount > 0 ? <span className="ct">{activeFiltersCount}</span> : null}
                </button>
              </div>
            </div>

            {activeTab === 'discovery' ? (
              <div className="ap-disc">
                <div className="ap-disc-sorts">
                  {[['new','New'],['hot','Hot'],['gainers','Gainers'],['safest','Safest']].map(([k,lbl]) => (
                    <button key={k} className={'ap-disc-sort' + (discSort === k ? ' on' : '')} onClick={() => setDiscSort(k)}>{lbl}</button>
                  ))}
                  <button className={'ap-disc-ftoggle' + (discFiltersOpen ? ' on' : '')} onClick={() => setDiscFiltersOpen(v => !v)}>Filters {discActiveCount > 0 ? '· ' + discActiveCount : ''}</button>
                </div>
                {discFiltersOpen ? (
                  <div className="ap-disc-filters">
                    <label className="ap-disc-f"><span>Min liquidity</span><select value={discMinLiq} onChange={e => setDiscMinLiq(Number(e.target.value))}>
                      <option value={0}>Any</option><option value={5000}>$5K+</option><option value={20000}>$20K+</option><option value={50000}>$50K+</option><option value={100000}>$100K+</option></select></label>
                    <label className="ap-disc-f"><span>Min market cap</span><select value={discMinMcap} onChange={e => setDiscMinMcap(Number(e.target.value))}>
                      <option value={0}>Any</option><option value={50000}>$50K+</option><option value={250000}>$250K+</option><option value={1000000}>$1M+</option></select></label>
                    <label className="ap-disc-f"><span>Max market cap</span><select value={discMaxMcap} onChange={e => setDiscMaxMcap(Number(e.target.value))}>
                      <option value={0}>Any</option><option value={250000}>$250K</option><option value={1000000}>$1M</option><option value={10000000}>$10M</option></select></label>
                    <label className="ap-disc-f"><span>Min holders</span><select value={discMinHolders} onChange={e => setDiscMinHolders(Number(e.target.value))}>
                      <option value={0}>Any</option><option value={50}>50+</option><option value={200}>200+</option><option value={500}>500+</option></select></label>
                    <label className="ap-disc-f"><span>Min safety</span><select value={discMinScore} onChange={e => setDiscMinScore(Number(e.target.value))}>
                      <option value={0}>Any</option><option value={40}>40+</option><option value={60}>60+</option><option value={75}>75+</option></select></label>
                    <label className="ap-disc-f"><span>Age</span><select value={discAge} onChange={e => setDiscAge(e.target.value)}>
                      <option value="any">Any</option><option value="5m">≤ 5m</option><option value="1h">≤ 1h</option><option value="6h">≤ 6h</option><option value="24h">≤ 24h</option></select></label>
                    {discActiveCount > 0 ? <button className="ap-disc-clear" onClick={() => { setDiscMinLiq(0); setDiscMinMcap(0); setDiscMaxMcap(0); setDiscMinHolders(0); setDiscMinScore(0); setDiscAge('any'); }}>Clear filters</button> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'hot' ? (
              <div className="ap-hotwin">
                {['5m', '1h', '24h'].map(w => (
                  <button key={w} className={'ap-hotwin-pill' + (hotWindow === w ? ' on' : '')} onClick={() => setHotWindow(w)}>{w}</button>
                ))}
                <span className="ap-hotwin-meta">Momentum · last {hotWindow}</span>
              </div>
            ) : null}

            <div className="ap-list">
              {feedError ? (
                <div className="ap-empty"><span className="glyph">⊘</span><b>Couldn't reach the feed</b><span className="sub">Retrying every few seconds. Solana RPC sometimes hiccups.</span><div className="err">{feedError}</div></div>
              ) : filtered.length === 0 ? (
                <div className="ap-empty">
                  <span className="glyph">∅</span>
                  <b>{activeTab === 'owned' ? <>No tokens in your <span style={{fontStyle:'italic',color:'#86868b'}}>bag</span></> : <>Nothing matches</>}</b>
                  <span className="sub">{activeTab === 'owned' ? <>Buy something and it'll appear here.</> : activeFiltersCount > 0 ? 'Try loosening filters.' : 'Waiting for fresh launches…'}</span>
                </div>
              ) : (
                filtered.map(t => {
                  const ageMsLive = t.pairCreatedAtMs ? now - t.pairCreatedAtMs : null;
                  const isFresh = t.mint === lastFreshMintRef.current && ageMsLive != null && ageMsLive < 60000;
                  return (
                    <SpecimenRow
                      key={t.mint}
                      token={t}
                      ageMsLive={ageMsLive}
                      owned={balances[t.mint]}
                      costBasis={pnlBasis[t.mint]}
                      solPrice={solPrice}
                      quickAmount={quickAmount + ' SOL'}
                      busy={!!busyMints[t.mint]}
                      onApe={onApe}
                      onSell={onSell}
                      onOpen={onRowClick}
                      isFresh={isFresh}
                      ownedMode={activeTab === 'owned'}
                    />
                  );
                })
              )}
            </div>

            <div className="ap-list-foot">
              <span className={'live' + (feedError ? ' warn' : '')}>
                <span className="d" />
                <span>{feedError ? 'Reconnecting…' : 'Live · refreshing every ' + (POLL_RECENT / 1000) + 's'}</span>
              </span>
              <span>{activeTab === 'owned' ? (filtered.length + (filtered.length === 1 ? ' token held' : ' tokens held')) : activeTab === 'hot' ? (filtered.length + ' hot now') : activeTab === 'discovery' ? (discLoading && filtered.length === 0 ? 'Loading Solana…' : filtered.length + ' of ' + discTokens.length + (discActiveCount > 0 ? ' · ' + discActiveCount + ' filter' + (discActiveCount === 1 ? '' : 's') : '')) : (filtered.length + ' of ' + recent.length + ' shown')}</span>
            </div>
          </div>
        </div>
      </div>

      {tradeToken && (
        <TradeSheet
          token={mergeTokenData(tradeToken)}
          initialMode={tradeMode}
          onClose={() => setTradeToken(null)}
          onConfirm={onTradeConfirm}
          buyPresets={buyPresets}
          sellPresets={sellPresets}
          solBalance={solBalance}
          tokenBalance={balances[tradeToken.mint]}
          solPrice={solPrice}
        />
      )}
      {showPresets && (<PresetsModal buyPresets={buyPresets} setBuyPresets={setBuyPresets} sellPresets={sellPresets} setSellPresets={setSellPresets} onClose={() => setShowPresets(false)} />)}
      {showFilters && (<FiltersModal wildOnly={wildOnly} setWildOnly={setWildOnly} minLiq={minLiq} setMinLiq={setMinLiq} onClose={() => setShowFilters(false)} />)}
      {showWallet && (<WalletDrawer wallet={wallet} solBalance={solBalance} solPrice={solPrice} onWithdraw={onWithdraw} onClose={() => setShowWallet(false)} busy={withdrawBusy} balances={balances} resolveToken={resolveToken} />)}
      <StatsPanel open={showStats} onClose={() => setShowStats(false)} wallet={wallet} mainWalletPubkey={mainWalletPubkey} solPrice={solPrice} initialTab={statsTab} />
      <AutoPanel open={showAuto} onClose={() => setShowAuto(false)} auto={auto} solBalance={solBalance} solPrice={solPrice} />
      <WatchedWallets open={showWatch} onClose={() => setShowWatch(false)} solPrice={solPrice} resolveToken={resolveToken} />

      <div className="ap-toasts">
        {toasts.map(t => (
          <div className={'ap-toast ' + (t.type || 'info')} key={t.id}>
            {t.em ? <span className="em">{t.em}</span> : null}
            <span className="tb">{t.body}</span>
            {t.actions && t.actions.length > 0 && (
              <span className="ta">
                {t.actions.map((a, i) => a.type === 'link'
                  ? <a key={i} className="ap-taction" href={a.href} target="_blank" rel="noopener noreferrer">{a.label}</a>
                  : <button key={i} className="ap-taction tw" onClick={() => openTwitterShare(a.text, a.url)}>{a.label}</button>)}
              </span>
            )}
          </div>
        ))}
      </div>

      {confettiAt > 0 && Date.now() - confettiAt < 2000 ? (
        <div className="ap-confetti" key={confettiAt}>
          {Array.from({ length: 28 }).map((_, i) => {
            const dx = (Math.random() - 0.5) * 600;
            const dy = 300 + Math.random() * 200;
            const dr = (Math.random() - 0.5) * 1200;
            const c = ['#16c08a', '#0b0b0c', '#a67200', '#2f6bff', '#3ee07f'][i % 5];
            return <span className="ap-cpiece" key={i} style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--dr': dr + 'deg', background: c, animationDelay: (Math.random() * 0.15) + 's' }} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   STATS PANEL — Referrals, Your trades, Standings
   ============================================================ */
function ReferralsTab({ walletStr, stats, statsLoading, statsError }) {
  const link = inviteUrl(walletStr);
  const [copied, setCopied] = useState(false);
  const copyLink = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };

  const earnedSol    = lamportsToSol(stats?.earned_lamports);
  const earned7dSol  = lamportsToSol(stats?.earned_lamports_7d);
  const earned24hSol = lamportsToSol(stats?.earned_lamports_24h);
  const referees     = stats?.referees || 0;
  const active       = stats?.active_referees || 0;

  const inviteTweet = "I've been trading fresh launches on Nexus Ape — burner wallet, 2-second trade, honest reads.\n\nFollow my line:";

  if (!walletStr) return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Connect a <span className="it">main wallet.</span></h1>
      <p className="wp-sub">Your referral link pays out on-chain. We won't build it against the burner — burners are disposable, your fees shouldn't be. Connect a wallet you'll still own next year.</p>
    </>
  );

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">◉</span><span>Section § Referrals</span><span className="rule" /></div>
      <h1 className="wp-h1">Your <span className="it">invitation.</span></h1>
      <p className="wp-sub">Pass Nexus forward. Every trade your line makes returns <b>50% of the fee</b> — direct to this wallet, same block as the trade.</p>

      <div className="wp-card feature">
        <div className="wp-card-eye"><span>◌</span><span>Your link</span></div>
        <div className="wp-link">
          <input className="wp-link-v" value={link} readOnly onClick={(e) => e.target.select()} />
          <button className={'wp-link-cp' + (copied ? ' copied' : '')} onClick={copyLink}>{copied ? '✓ COPIED' : 'COPY'}</button>
        </div>
        <div className="wp-share-row">
          <button className="wp-sh tw" onClick={() => openTwitterShare(inviteTweet, link)}><span className="ico"><IconX /></span><span>Share on X</span></button>
          <button className="wp-sh tg" onClick={() => openTelegram(inviteTweet, link)}><span className="ico"><IconTg /></span><span>Telegram</span></button>
          <button className="wp-sh ds" onClick={() => { try { navigator.clipboard.writeText(inviteTweet + '\n' + link); } catch (e) {} }}><span className="ico"><IconDs /></span><span>Copy for Discord</span></button>
        </div>
      </div>

      {statsError ? (
        <div className="wp-card"><div className="wp-empty"><span className="gl">⊘</span><div className="h">Couldn't read your stats</div><div className="e">{statsError}</div></div></div>
      ) : statsLoading && !stats ? (
        <div className="wp-card"><div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Reading the ledger…</div></div></div>
      ) : (
        <div className="wp-stats">
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">№</span>Referees</div><div className="wp-stat-v">{referees}</div><div className="wp-stat-m">{active} have made at least one trade</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Earned · 24h</div><div className={'wp-stat-v ' + (earned24hSol > 0 ? 'gn' : 'it')}>{earned24hSol > 0 ? formatSolSigned(earned24hSol) : '—'}{earned24hSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Last day</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Earned · 7d</div><div className={'wp-stat-v ' + (earned7dSol > 0 ? 'gn' : 'it')}>{earned7dSol > 0 ? formatSolSigned(earned7dSol) : '—'}{earned7dSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Rolling week</div></div>
          <div className="wp-stat"><div className="wp-stat-l"><span className="gl">§</span>Earned · all time</div><div className={'wp-stat-v ' + (earnedSol > 0 ? 'gn' : 'it')}>{earnedSol > 0 ? formatSolSigned(earnedSol) : '—'}{earnedSol > 0 ? <span className="u">SOL</span> : null}</div><div className="wp-stat-m">Since your first referee</div></div>
        </div>
      )}

      <div className="wp-card">
        <div className="wp-card-eye"><span>§</span><span>How the line pays</span></div>
        <div className="wp-rules">
          <div className="wp-rule"><div className="n">01</div><div><div className="h">Someone follows your <span className="it">link.</span></div><div className="b">They land on Nexus with your wallet attached. The first time they trade, you're locked in as their referrer — <b>permanently</b>.</div></div></div>
          <div className="wp-rule"><div className="n">02</div><div><div className="h">They <span className="it">trade.</span> You get paid in the same block.</div><div className="b">Each trade carries a 3% platform fee. <b>50%</b> is sent directly to your wallet as part of the same on-chain transaction.</div></div></div>
          <div className="wp-rule"><div className="n">03</div><div><div className="h">No withdrawals. No <span className="it">claims.</span></div><div className="b">Earnings are already in this wallet the moment each trade confirms.</div></div></div>
        </div>
      </div>
    </>
  );
}

function YourTradesTab({ walletStr, pnl, pnlLoading, pnlError, solPrice }) {
  const realized = pnl?.realized_pnl_sol || 0;
  const volume = pnl?.total_volume_sol || 0;
  const count = pnl?.trade_count || 0;
  const positions = (pnl?.positions || []);
  const open = positions.filter(p => p.open);
  const realizedUsd = solPrice > 0 ? realized * solPrice : 0;
  const isPos = realized >= 0;
  const best = useMemo(() => positions.length ? [...positions].sort((a,b) => b.realized_pnl_sol - a.realized_pnl_sol)[0] : null, [positions]);
  const worst = useMemo(() => {
    const c = positions.filter(p => p.realized_pnl_sol < 0);
    return c.length ? c.sort((a,b) => a.realized_pnl_sol - b.realized_pnl_sol)[0] : null;
  }, [positions]);
  const shareTweet = useMemo(() => [
    'My trades · ' + truncWallet(walletStr),
    'Realized: ' + formatSolSigned(realized) + ' SOL',
    count + ' trades · ' + formatSol(volume) + ' SOL routed',
    best && best.realized_pnl_sol > 0 ? 'Best: $' + (best.sym || '???') + ' ' + formatSolSigned(best.realized_pnl_sol) + ' SOL' : '',
    '', 'Traded on Nexus:',
  ].filter(Boolean).join('\n'), [walletStr, realized, count, volume, best]);

  if (pnlError) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">⊘</span><div className="h">The ledger is unreachable</div><div className="e">{pnlError}</div></div></div></>;
  if (pnlLoading && !pnl) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Reading the ledger…</div></div></div></>;
  if (!pnl || count === 0) return <><div className="wp-eyebrow"><span className="glyph">∅</span><span>Section § Your trades</span><span className="rule" /></div><div className="wp-card"><div className="wp-empty"><span className="gl">∅</span><div className="h">No <span className="it">trades</span> yet</div><div className="s">Your first trade will start the log.</div></div></div></>;

  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Your trades</span><span className="rule" /></div>
      <div className={'wp-pnl-hero' + (isPos ? '' : ' neg')}>
        <div className="wp-pnl-hero-l">
          <div className={'wp-pnl-eye' + (isPos ? '' : ' neg')}><span className="gl">{isPos ? '◉' : '⊘'}</span><span>Realized · all time</span></div>
          <div className={'wp-pnl-val' + (isPos ? '' : ' neg')}>{formatSolSigned(realized)}<span className="u">SOL</span></div>
          <div className="wp-pnl-usd">{solPrice > 0 ? '≈ ' + formatUsdAbs(realizedUsd) : ' '}{' · '}{count} {count === 1 ? 'trade' : 'trades'} · {formatSol(volume)} SOL routed</div>
        </div>
        <div className="wp-pnl-r">
          <button className="wp-pnl-share" onClick={() => openTwitterShare(shareTweet, shareUrlPath(walletStr))}><IconX /><span>Share</span></button>
        </div>
      </div>

      <div className="wp-stats">
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">№</span>Volume</div><div className="wp-stat-v">{formatSol(volume)}<span className="u">SOL</span></div><div className="wp-stat-m">{solPrice > 0 ? '≈ ' + formatUsdAbs(volume * solPrice) : ' '}</div></div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">◉</span>Open</div><div className="wp-stat-v">{open.length}<span className="u">/ {positions.length}</span></div><div className="wp-stat-m">{open.length === 0 ? 'All closed' : 'Still in your bag'}</div></div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">↑</span>Best</div>{best && best.realized_pnl_sol > 0 ? <><div className="wp-stat-v gn">{formatSolSigned(best.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${best.sym || '???'}</div></> : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed winners yet</div></>}</div>
        <div className="wp-stat"><div className="wp-stat-l"><span className="gl">↓</span>Worst</div>{worst ? <><div className="wp-stat-v rd">{formatSolSigned(worst.realized_pnl_sol)}<span className="u">SOL</span></div><div className="wp-stat-m">${worst.sym || '???'}</div></> : <><div className="wp-stat-v it">—</div><div className="wp-stat-m">No closed losers</div></>}</div>
      </div>

      <div className="wp-pos-frame">
        <div className="wp-pos-head"><span className="e">◉ Positions · {positions.length}</span></div>
        <div className="wp-pos-row thead">
          <span className="wp-pos-no">№</span><span>Token</span>
          <span className="wp-col-avg" style={{textAlign:'right'}}>Avg buy</span>
          <span className="wp-col-open" style={{textAlign:'right'}}>Open</span>
          <span style={{textAlign:'right'}}>Realized</span>
          <span style={{textAlign:'right'}}>Status</span>
        </div>
        {positions.map((p, i) => {
          const c = colorFor(p.mint);
          const rp = p.realized_pnl_sol > 0, rn = p.realized_pnl_sol < -0.0001;
          return (
            <div className="wp-pos-row" key={p.mint}>
              <span className="wp-pos-no">№{(i+1).toString().padStart(2,'0')}</span>
              <div className="wp-pos-tk">
                <div className="wp-pos-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
                <div style={{minWidth:0,flex:1}}>
                  <div className="wp-pos-sym"><span>${p.sym || '???'}</span><span className={'wp-pos-status ' + (p.open ? 'open' : 'closed')}>{p.open ? 'open' : 'closed'}</span></div>
                  <div className="wp-pos-meta">{p.buys}b · {p.sells}s · {formatSol(p.sol_in)} in / {formatSol(p.sol_out)} out</div>
                </div>
              </div>
              <span className="wp-pos-num dim wp-col-avg" style={{textAlign:'right'}}>{p.avg_buy_price_sol > 0 ? p.avg_buy_price_sol.toExponential(2) + ' SOL' : '—'}</span>
              <span className="wp-pos-num dim wp-col-open" style={{textAlign:'right'}}>{p.open ? formatTokens(p.open_tokens) : '—'}</span>
              <span className={'wp-pos-num ' + (rp ? 'gn' : rn ? 'rd' : 'dim')} style={{textAlign:'right'}}>{Math.abs(p.realized_pnl_sol) > 0.0001 ? formatSolSigned(p.realized_pnl_sol) + ' SOL' : '—'}</span>
              <span style={{textAlign:'right'}}><span className={'wp-pos-status ' + (p.open ? 'open' : 'closed')}>{p.open ? 'held' : 'flat'}</span></span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StandingsTab({ walletStr, lb, lbLoading, lbError, win, setWin }) {
  return (
    <>
      <div className="wp-eyebrow"><span className="glyph">§</span><span>Section § Standings</span><span className="rule" /></div>
      <h1 className="wp-h1">The <span className="it">field</span>, ranked.</h1>
      <p className="wp-sub">Top traders by SOL volume routed through Nexus. Refreshes every 30 seconds.</p>
      <div className="wp-win-tabs">
        <button className={'wp-win-tab' + (win === '24h' ? ' on' : '')} onClick={() => setWin('24h')}>24 hours</button>
        <button className={'wp-win-tab' + (win === '7d'  ? ' on' : '')} onClick={() => setWin('7d')}>7 days</button>
        <button className={'wp-win-tab' + (win === 'all' ? ' on' : '')} onClick={() => setWin('all')}>All time</button>
      </div>
      <div className="wp-lb-frame">
        <div className="wp-lb-row thead"><span>Rank</span><span>Trader</span><span style={{textAlign:'right'}}>Volume</span><span className="wp-col-tr" style={{textAlign:'right'}}>Trades</span></div>
        {lbError ? (
          <div className="wp-empty"><span className="gl">⊘</span><div className="h">Standings unreachable</div><div className="e">{lbError}</div></div>
        ) : lbLoading && !lb ? (
          <div className="wp-empty"><span className="gl">⏳</span><div className="h"><span className="wp-spin" />Counting the field…</div></div>
        ) : !lb || lb.count === 0 ? (
          <div className="wp-empty"><span className="gl">∅</span><div className="h">No <span className="it">trades</span> logged in this window</div></div>
        ) : (
          <>
            {lb.traders.map((t, i) => {
              const rank = i + 1;
              const mine = t.wallet === walletStr;
              const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
              return (
                <div className={'wp-lb-row' + (mine ? ' mine' : '')} key={t.wallet}>
                  <span className={'wp-lb-rank ' + rankClass}><span className="hash">№</span>{rank.toString().padStart(2, '0')}</span>
                  <span className="wp-lb-w">{truncWallet(t.wallet)}{mine ? <span className="you">YOU</span> : null}</span>
                  <span className="wp-lb-vol">{formatSol(t.volume_sol)}<span className="u"> SOL</span></span>
                  <span className="wp-lb-tr wp-col-tr">{t.trades}</span>
                </div>
              );
            })}
            <div className="wp-lb-foot"><span>{lb.total_traders || lb.count} traders · top 50 shown</span><span>Refreshed · {new Date(lb.ts || Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
          </>
        )}
      </div>
    </>
  );
}

function StatsPanel({ open, onClose, wallet, mainWalletPubkey, solPrice, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'referrals');
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);
  const burnerWalletStr = wallet?.publicKey?.toBase58 ? wallet.publicKey.toBase58() : '';
  const refWalletStr = mainWalletPubkey || '';
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState(null);
  const [lb, setLb] = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(null);
  const [lbWin, setLbWin] = useState('24h');

  const fetchStats = useCallback(async () => {
    if (!refWalletStr) return; setStatsLoading(true);
    try { const r = await fetch('/api/ref/stats?wallet=' + refWalletStr); if (!r.ok) throw new Error('HTTP ' + r.status); setStats(await r.json()); setStatsError(null); }
    catch (e) { setStatsError(String(e.message || 'Network').slice(0, 100)); } finally { setStatsLoading(false); }
  }, [refWalletStr]);
  const fetchPnl = useCallback(async () => {
    if (!burnerWalletStr) return; setPnlLoading(true);
    try { const r = await fetch('/api/ref/pnl?wallet=' + burnerWalletStr); if (!r.ok) throw new Error('HTTP ' + r.status); setPnl(await r.json()); setPnlError(null); }
    catch (e) { setPnlError(String(e.message || 'Network').slice(0, 100)); } finally { setPnlLoading(false); }
  }, [burnerWalletStr]);
  const fetchLb = useCallback(async (w) => {
    setLbLoading(true);
    try { const r = await fetch('/api/ref/leaderboard?window=' + (w || lbWin)); if (!r.ok) throw new Error('HTTP ' + r.status); setLb(await r.json()); setLbError(null); }
    catch (e) { setLbError(String(e.message || 'Network').slice(0, 100)); } finally { setLbLoading(false); }
  }, [lbWin]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'referrals' && refWalletStr) fetchStats();
    else if (tab === 'yourtrades' && burnerWalletStr) fetchPnl();
    else if (tab === 'standings') fetchLb(lbWin);
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (tab === 'referrals' && refWalletStr) fetchStats();
      else if (tab === 'yourtrades' && burnerWalletStr) fetchPnl();
      else if (tab === 'standings') fetchLb(lbWin);
    }, 30000);
    return () => clearInterval(id);
  }, [open, tab, refWalletStr, burnerWalletStr, lbWin, fetchStats, fetchPnl, fetchLb]);

  useEffect(() => { if (!open) return; const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, [open]);
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') onClose && onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="wp-root">
      <div className="wp-head">
        <div style={{display:'flex',alignItems:'center',gap:11,cursor:'pointer'}} onClick={onClose}>
          <div style={{width:30,height:30,borderRadius:10,background:'#0b0b0c',display:'grid',placeItems:'center',fontFamily:"'Inter',sans-serif",fontStyle:'italic',fontSize:17,color:'#fff'}}>A</div>
          <span style={{fontFamily:"'Inter',sans-serif",fontSize:22,letterSpacing:'-.015em',color:'#0b0b0c'}}>Ape <em style={{fontStyle:'italic',color:'#86868b'}}>· early</em></span>
        </div>
        <div className="wp-headlbl"><span className="d" /><span>STATS · PERSONAL</span></div>
        <button className="wp-close" onClick={onClose}>×</button>
      </div>
      <div className="wp-tabs">
        <button className={'wp-tab' + (tab === 'referrals' ? ' on' : '')} onClick={() => setTab('referrals')}><span className="glyph">§ 01</span><span>Referrals</span></button>
        <button className={'wp-tab' + (tab === 'yourtrades' ? ' on' : '')} onClick={() => setTab('yourtrades')}><span className="glyph">§ 02</span><span>Your trades</span></button>
        <button className={'wp-tab' + (tab === 'standings' ? ' on' : '')} onClick={() => setTab('standings')}><span className="glyph">§ 03</span><span>Standings</span></button>
      </div>
      <div className="wp-page" key={tab}>
        {tab === 'referrals' && <ReferralsTab walletStr={refWalletStr} stats={stats} statsLoading={statsLoading} statsError={statsError} />}
        {tab === 'yourtrades' && <YourTradesTab walletStr={burnerWalletStr} pnl={pnl} pnlLoading={pnlLoading} pnlError={pnlError} solPrice={solPrice} />}
        {tab === 'standings' && <StandingsTab walletStr={burnerWalletStr} lb={lb} lbLoading={lbLoading} lbError={lbError} win={lbWin} setWin={setLbWin} />}
      </div>
    </div>
  );
}

/* ============================================================
   AUTO-TRADE
   ============================================================ */
const BALANCED_SETTINGS = {
  perTradeSol: 0.2, takeProfitPct: 150, stopLossPct: 30,
  minAgeMin: 0, maxAgeMin: 30, minLiqUsd: 10000, minMcapUsd: 0, minHolders: 30,
  minVibe: 40, maxOpen: 5, maxPerHour: 10,
};
const SAFETY_FLOOR = { dailyLossCapSol: 1.0, maxHoldMin: 30, ageMinAbsolute: 0, posPollMs: 7000 };
const AT_SETTINGS_KEY = 'lr_at_settings_v1';
const AT_STATE_KEY = 'lr_at_state_v1';
const AT_POSITIONS_KEY = 'lr_at_positions_v1';
const AT_ENABLED_KEY = 'lr_at_enabled_v1';
const AT_BAL_AMT_KEY = 'lr_at_bal_amount_v1';
const AT_POS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function loadCustomSettings() {
  try { const raw = localStorage.getItem(AT_SETTINGS_KEY); if (!raw) return { ...BALANCED_SETTINGS }; return { ...BALANCED_SETTINGS, ...JSON.parse(raw) }; }
  catch (e) { return { ...BALANCED_SETTINGS }; }
}
function saveCustomSettings(s) { try { localStorage.setItem(AT_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
function loadDailyState() {
  try { const raw = localStorage.getItem(AT_STATE_KEY); if (!raw) return null; const d = JSON.parse(raw); if (!d || d.day !== new Date().toDateString()) return null; return d; }
  catch (e) { return null; }
}
function saveDailyState(d) { try { localStorage.setItem(AT_STATE_KEY, JSON.stringify({ ...d, day: new Date().toDateString() })); } catch (e) {} }
function loadPositions() {
  try {
    const raw = localStorage.getItem(AT_POSITIONS_KEY); if (!raw) return [];
    const arr = JSON.parse(raw); if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - AT_POS_MAX_AGE_MS;
    return arr.filter(p => p && p.mint && Number.isFinite(p.ts) && p.ts > cutoff && Number.isFinite(p.entryPriceUsd)).map(p => ({ ...p, exiting: false }));
  } catch (e) { return []; }
}
function savePositions(arr) { try { localStorage.setItem(AT_POSITIONS_KEY, JSON.stringify(arr || [])); } catch (e) {} }
function loadEnabled() { try { return localStorage.getItem(AT_ENABLED_KEY) === '1'; } catch (e) { return false; } }
function saveEnabled(v) { try { localStorage.setItem(AT_ENABLED_KEY, v ? '1' : '0'); } catch (e) {} }

function useAutoTrade(deps) {
  const { recentTokens, solBalance, solPrice, balances, executeSwap, pushToast } = deps;
  const initialDaily = useMemo(() => loadDailyState() || {}, []);
  const [enabled, setEnabledState] = useState(() => loadEnabled());
  const [custom, setCustom] = useState(() => loadCustomSettings());
  const [positions, setPositionsState] = useState(() => loadPositions());
  const [log, setLog] = useState([]);
  const [dailyPnlSol, setDailyPnlSol] = useState(initialDaily.dailyPnlSol || 0);
  const [tradesToday, setTradesToday] = useState(initialDaily.tradesToday || 0);
  const [paused, setPaused] = useState(initialDaily.paused || false);
  const seenMintsRef = useRef(new Set());
  const inflightRef = useRef(new Set());
  const tradeStampsRef = useRef([]);
  const positionsRef = useRef(positions);
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  const balancesRef = useRef(balances);
  useEffect(() => { balancesRef.current = balances; }, [balances]);
  const exitSolPriceRef = useRef(solPrice);
  useEffect(() => { exitSolPriceRef.current = solPrice; }, [solPrice]);

  const setEnabled = useCallback((v) => {
    setEnabledState(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      saveEnabled(next); return next;
    });
  }, []);

  const setPositions = useCallback((updater) => {
    setPositionsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      savePositions(next); return next;
    });
  }, []);

  // Single mode (Custom only). Hard-cap per-trade buy at 1 SOL regardless of
  // any stored value, as the last guardrail on auto-buy blast radius.
  // Memoized so `effective` (and the exit-loop interval that depends on it)
  // stays referentially stable across renders — otherwise the interval would
  // tear down and rebuild on every render, re-polling prices needlessly.
  const settings = useMemo(
    () => ({ ...custom, perTradeSol: Math.min(1, Math.max(0.03, Number(custom.perTradeSol) || 0.2)) }),
    [custom]
  );
  const effective = useMemo(() => ({ ...settings, minAgeMin: Math.max(SAFETY_FLOOR.ageMinAbsolute, settings.minAgeMin) }), [settings]);

  const updateCustom = useCallback((patch) => {
    setCustom(prev => { const next = { ...prev, ...patch }; saveCustomSettings(next); return next; });
  }, []);

  useEffect(() => { saveDailyState({ dailyPnlSol, tradesToday, paused }); }, [dailyPnlSol, tradesToday, paused]);

  const pushLog = useCallback((tag, msg) => {
    setLog(prev => [{ id: Math.random().toString(36).slice(2, 9), ts: Date.now(), tag, msg }, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    if (-dailyPnlSol >= SAFETY_FLOOR.dailyLossCapSol && !paused) {
      setPaused(true); setEnabled(false);
      pushLog('error', 'Daily loss cap hit — auto-trade paused');
      pushToast && pushToast({ type: 'error', em: '⊘', body: <>Daily loss cap hit. <b>Auto paused.</b></> });
    }
  }, [dailyPnlSol, paused, pushLog, pushToast]);

  // Discovery loop — buy via executeSwap (which now forwards correctly to ape-helpers)
  useEffect(() => {
    if (!enabled || paused) return;
    if (!Array.isArray(recentTokens) || recentTokens.length === 0) return;
    const now = Date.now();
    tradeStampsRef.current = tradeStampsRef.current.filter(t => now - t < 60 * 60 * 1000);
    if (tradeStampsRef.current.length >= effective.maxPerHour) return;
    if (positionsRef.current.length >= effective.maxOpen) return;

    // Not enough SOL for even one trade → stop the engine and tell the user
    // once, rather than scanning the whole feed and failing every token.
    const availSol = (solBalance && solBalance.uiAmount) || 0;
    if (availSol < effective.perTradeSol + 0.01) {
      setEnabled(false);
      pushLog('error', 'Auto-trade stopped — burner out of SOL');
      pushToast && pushToast({ type: 'error', em: '◎', body: <>Out of SOL — auto-trade stopped. <b>Add funds to your burner</b> to keep going.</>, duration: 9000 });
      return;
    }

    for (const tk of recentTokens) {
      if (!tk || !tk.mint) continue;
      if (seenMintsRef.current.has(tk.mint)) continue;
      if (inflightRef.current.has(tk.mint)) continue;
      if (positionsRef.current.some(p => p.mint === tk.mint)) continue;

      // Only "too old" permanently blacklists. Age-too-young, liquidity,
      // holders, and vibe are all transient — a token that fails now may
      // pass minutes later as it ages into the window and fills out. Marking
      // them seen here is what stopped auto-buys from ever firing.
      const ageMin = tk.pairCreatedAtMs ? (now - tk.pairCreatedAtMs) / 60000 : 999;
      if (ageMin > effective.maxAgeMin) { seenMintsRef.current.add(tk.mint); continue; }
      if (ageMin < effective.minAgeMin) continue;
      if (!Number.isFinite(tk.liquidity) || tk.liquidity < effective.minLiqUsd) continue;
      if (effective.minMcapUsd > 0 && (!Number.isFinite(tk.mcap) || tk.mcap < effective.minMcapUsd)) continue;
      if (!Number.isFinite(tk.holders) || tk.holders < effective.minHolders) continue;
      const r = riskRead(tk);
      if (r.score < effective.minVibe) continue;
      if (!(tk.price > 0)) continue;
      if (((solBalance && solBalance.uiAmount) || 0) < effective.perTradeSol + 0.01) continue;

      seenMintsRef.current.add(tk.mint);
      inflightRef.current.add(tk.mint);
      pushLog('info', 'Considering $' + tk.sym + ' · score ' + r.score);

      (async () => {
        try {
          // FIX 5/8: use buildBuyParams and read result.sig
          const buyParams = buildBuyParams(effective.perTradeSol);
          if (!buyParams) throw new Error('Bad buy size');
          const result = await executeSwap({ mode: 'buy', token: tk, swapParams: buyParams });
          if (!result || !result.sig) throw new Error('No signature');
          const entryPriceUsd = tk.price;
          setPositions(prev => [...prev, {
            mint: tk.mint, sym: tk.sym, name: tk.name, icon: tk.icon, ts: Date.now(),
            entryPriceUsd, entrySol: effective.perTradeSol, currentPriceUsd: entryPriceUsd,
            signature: result.sig, exiting: false,
          }]);
          tradeStampsRef.current.push(Date.now());
          setTradesToday(n => n + 1);
          pushLog('buy', 'Bought $' + tk.sym + ' · ' + effective.perTradeSol.toFixed(2) + ' SOL');
          pushToast && pushToast({ type: 'success', em: '✓', body: <>Auto: bought <b>${tk.sym}</b></> });
        } catch (e) {
          const msg = (e && e.message) || 'failed';
          // Out of SOL: there's nothing left to trade with, so stop the engine
          // and show ONE clear message instead of spraying identical errors
          // every cycle until the user notices.
          if (/not enough sol|insufficient/i.test(msg)) {
            setEnabled(false);
            pushLog('error', 'Auto-trade stopped — burner out of SOL');
            pushToast && pushToast({ type: 'error', em: '◎', body: <>Out of SOL — auto-trade stopped. <b>Add funds to your burner</b> to keep going.</>, duration: 9000 });
          } else {
            pushLog('error', 'Skipped $' + tk.sym + ' · ' + msg);
          }
        } finally {
          inflightRef.current.delete(tk.mint);
        }
      })();
      break;
    }
  }, [enabled, paused, recentTokens, effective, solBalance, executeSwap, pushLog, pushToast, setPositions]);

  // Exit loop — TP/SL/timeout.
  // Reads positions/balances/solPrice from refs so the interval is built once
  // per on/off transition (gated on hasPositions) rather than rebuilt on every
  // price tick or balance poll. Depending on `solPrice`/`balances` directly
  // would tear the interval down every 30s and could fire tick() mid-trade.
  const hasPositions = positions.length > 0;
  useEffect(() => {
    if (!hasPositions) return;
    let cancelled = false;
    const tick = async () => {
      const now = Date.now();
      for (const p of positionsRef.current) {
        if (cancelled) return;
        if (p.exiting) continue;
        try {
          const r = await fetch('/api/dex/token/' + encodeURIComponent(p.mint));
          if (!r.ok) continue;
          const d = await r.json();
          const px = Number(d?.token?.price);
          if (!Number.isFinite(px) || px <= 0) continue;
          setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, currentPriceUsd: px } : x));
          const pnlPct = ((px - p.entryPriceUsd) / p.entryPriceUsd) * 100;
          // Auto-sell fires ONLY on take-profit or stop-loss. The time-based
          // force-exit has been removed — positions are held until they hit
          // the user's TP/SL target (or are sold manually).
          const reason = pnlPct >= effective.takeProfitPct ? 'take-profit'
                       : pnlPct <= -effective.stopLossPct ? 'stop-loss' : null;
          if (!reason) continue;
          setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: true } : x));
          try {
            const owned = balancesRef.current && balancesRef.current[p.mint];
            if (!owned || !((owned.uiAmount || 0) > 0)) {
              // Balance may not have landed yet (refreshOneToken fires ~800ms
              // after buy; the 30s poll is slower). Don't drop a fresh position
              // as "gone" — wait until it's had time to show up.
              if ((Date.now() - p.ts) < 45000) {
                setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: false } : x));
                continue;
              }
              setPositions(prev => prev.filter(x => x.mint !== p.mint));
              pushLog('info', '$' + p.sym + ' position cleared (no balance)');
              continue;
            }
            const tk = { mint: p.mint, sym: p.sym, name: p.name, icon: p.icon, price: px };
            const exitFee = sellFeeLamports(owned.uiAmount, px, exitSolPriceRef.current);
            await executeSwap({ mode: 'sell', token: tk, tradeTokensRaw: BigInt(owned.amount || '0'), tradeTokensUi: owned.uiAmount, decimals: owned.decimals, feeLamports: exitFee });
            const exitSol = (owned.uiAmount * px) / (exitSolPriceRef.current || 150);
            const pnlSol = exitSol - (p.entrySol || 0);
            setPositions(prev => prev.filter(x => x.mint !== p.mint));
            setDailyPnlSol(n => n + pnlSol);
            tradeStampsRef.current.push(Date.now());
            pushLog('sell', 'Sold $' + p.sym + ' · ' + reason + ' · ' + formatSolSigned(pnlSol) + ' SOL');
          } catch (e) {
            setPositions(prev => prev.map(x => x.mint === p.mint ? { ...x, exiting: false } : x));
            pushLog('error', 'Exit failed $' + p.sym + ' · ' + (e.message || 'unknown'));
          }
        } catch (e) {}
      }
    };
    tick();
    const id = setInterval(tick, SAFETY_FLOOR.posPollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [hasPositions, effective, executeSwap, setPositions, pushLog]);

  const flatten = useCallback(async () => {
    setEnabled(false);
    for (const p of positionsRef.current) {
      try {
        const owned = balancesRef.current && balancesRef.current[p.mint];
        if (!owned || !((owned.uiAmount || 0) > 0)) continue;
        const tk = { mint: p.mint, sym: p.sym, name: p.name, icon: p.icon, price: p.currentPriceUsd };
        const flatFee = sellFeeLamports(owned.uiAmount, p.currentPriceUsd, exitSolPriceRef.current);
        await executeSwap({ mode: 'sell', token: tk, tradeTokensRaw: BigInt(owned.amount || '0'), tradeTokensUi: owned.uiAmount, decimals: owned.decimals, feeLamports: flatFee });
        pushLog('sell', 'Flatten $' + p.sym);
      } catch (e) {
        pushLog('error', 'Flatten failed $' + p.sym);
      }
    }
    setPositions([]);
  }, [executeSwap, setPositions, pushLog]);

  return { enabled, setEnabled, paused, setPaused, custom, updateCustom, settings, effective, positions, log, dailyPnlSol, tradesToday, flatten };
}

function Slider({ label, hint, value, min, max, step, suffix, onChange }) {
  return (
    <div className="wa-slider">
      <div className="wa-slider-top">
        <span className="wa-slider-lbl">{label}</span>
        <span className="wa-slider-v">{value}<span className="u">{suffix}</span></span>
      </div>
      {hint ? <div className="wa-slider-desc">{hint}</div> : null}
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function AutoPanel({ open, onClose, auto, solBalance, solPrice }) {
  useEffect(() => { if (!open) return; const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, [open]);
  useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') onClose && onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;

  const { enabled, setEnabled, paused, setPaused, settings, custom, updateCustom, positions, log, dailyPnlSol, tradesToday, flatten } = auto;
  const s = settings;

  return (
    <div className="wa-root">
      <div className="wa-head">
        <div style={{display:'flex',alignItems:'center',gap:11,cursor:'pointer'}} onClick={onClose}>
          <div style={{width:30,height:30,borderRadius:10,background:'#0b0b0c',display:'grid',placeItems:'center',fontFamily:"'Inter',sans-serif",fontStyle:'italic',fontSize:17,color:'#fff'}}>A</div>
          <span style={{fontFamily:"'Inter',sans-serif",fontSize:22,letterSpacing:'-.015em',color:'#0b0b0c'}}>Ape <em style={{fontStyle:'italic',color:'#86868b'}}>· auto-trade</em></span>
        </div>
        <div className={'wa-stat-pill ' + (paused ? 'paused' : enabled ? 'on' : 'off')}>
          {enabled && !paused ? <><span className="d" /><span>RUNNING</span></> : paused ? <span>PAUSED · CAP HIT</span> : <span>OFF</span>}
        </div>
        <button className="wa-close" onClick={onClose}>×</button>
      </div>
      <div className="wa-page">
        <div className="wa-eye"><span className="gl">◉</span><span>Auto-trade · alpha</span><span className="rule" /></div>
        <h1 className="wa-h1">Trade <span className="it">while you sleep.</span></h1>
        <p className="wa-sub">A small bot watching the feed. It buys what looks safe by your rules and sells on take-profit or stop-loss. <b>Test small first.</b></p>

        {paused ? (
          <div className="wa-pause-banner">
            <span className="gl">⊘</span>
            <div className="t"><div className="h">Auto paused</div><div className="b">Daily loss cap of {SAFETY_FLOOR.dailyLossCapSol} SOL hit. Resume when ready.</div></div>
            <button onClick={() => { setPaused(false); setEnabled(false); }}>RESUME</button>
          </div>
        ) : null}

        <div className={'wa-master' + (enabled && !paused ? ' on' : paused ? ' paused' : '')}>
          <div className="wa-master-l">
            <div className={'wa-master-h' + (enabled && !paused ? ' on' : '')}>{enabled && !paused ? <>Running.</> : paused ? <>Paused.</> : <>Ready when you <span className="it">are.</span></>}</div>
            <div className="wa-master-s">{enabled && !paused ? 'Watching the feed · ' + positions.length + ' open · ' + tradesToday + ' today' : 'Flip when ready'}</div>
          </div>
          <div className={'wa-tog' + (enabled && !paused ? ' on' : '')} onClick={() => { if (paused) return; setEnabled(!enabled); }} />
        </div>

        <div className="wa-sliders">
          <Slider label="Per-trade SOL" hint="Each auto-buy uses this much SOL. Max 1 SOL." value={s.perTradeSol} min={0.03} max={1} step={0.01} suffix="SOL" onChange={v => updateCustom({ perTradeSol: v })} />
          <Slider label="Take profit at" value={s.takeProfitPct} min={20} max={500} step={10} suffix="%" onChange={v => updateCustom({ takeProfitPct: v })} hint="Sell when up this much." />
          <Slider label="Stop loss at" value={s.stopLossPct} min={10} max={70} step={5} suffix="%" onChange={v => updateCustom({ stopLossPct: v })} hint="Sell if down this much." />
          <Slider label="Min age" value={s.minAgeMin} min={0} max={20} step={1} suffix="min" onChange={v => updateCustom({ minAgeMin: v })} hint="Skip launches younger than this. 0 = buy immediately." />
          <Slider label="Max age" value={s.maxAgeMin} min={5} max={120} step={5} suffix="min" onChange={v => updateCustom({ maxAgeMin: v })} hint="Skip launches older than this." />
          <Slider label="Min liquidity" value={s.minLiqUsd} min={0} max={100000} step={500} suffix="$" onChange={v => updateCustom({ minLiqUsd: v })} hint="0 = buy anything. Thin pools are hard to SELL — your stop-loss may not fill." />
          <Slider label="Min market cap" value={s.minMcapUsd} min={0} max={500000} step={1000} suffix="$" onChange={v => updateCustom({ minMcapUsd: v })} hint="0 = no market-cap floor. Skip tokens below this mcap." />
          <Slider label="Min holders" value={s.minHolders} min={0} max={500} step={5} suffix="" onChange={v => updateCustom({ minHolders: v })} hint="0 = no holder requirement." />
          <Slider label="Min safety score" value={s.minVibe} min={0} max={85} step={5} suffix="/85" onChange={v => updateCustom({ minVibe: v })} hint="0 = ignore safety score entirely." />
          <Slider label="Max open" value={s.maxOpen} min={1} max={10} step={1} suffix="" onChange={v => updateCustom({ maxOpen: v })} hint="Hold limit." />
          <Slider label="Max / hour" value={s.maxPerHour} min={1} max={30} step={1} suffix="" onChange={v => updateCustom({ maxPerHour: v })} hint="Trade frequency cap." />
          <div className="wa-floor">
            <b>Safety floors that can't be turned off:</b><br/>
            · Daily loss cap: -{SAFETY_FLOOR.dailyLossCapSol} SOL (auto-pauses)<br/>
            · Per-trade buy capped at 1 SOL<br/>
            · Sells only on your take-profit or stop-loss target
          </div>
        </div>

        <div className="wa-stats">
          <div className="wa-statc"><div className="wa-statc-l">Today P&L</div><div className={'wa-statc-v ' + (dailyPnlSol > 0 ? 'gn' : dailyPnlSol < 0 ? 'rd' : 'dim')}>{Math.abs(dailyPnlSol) > 0.0001 ? formatSolSigned(dailyPnlSol) : '—'}{Math.abs(dailyPnlSol) > 0.0001 ? <span className="u">SOL</span> : null}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Trades today</div><div className="wa-statc-v">{tradesToday}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Open positions</div><div className="wa-statc-v">{positions.length}</div></div>
          <div className="wa-statc"><div className="wa-statc-l">Burner SOL</div><div className="wa-statc-v">{formatSol((solBalance && solBalance.uiAmount) || 0)}<span className="u">SOL</span></div></div>
        </div>

        <div className="wa-pos-frame">
          <div className="wa-section-head"><span>◉ Open positions</span><span className="count">{positions.length}</span></div>
          {positions.length === 0 ? (
            <div className="wa-empty"><span className="gl">∅</span><div className="h">No open <span className="it">positions</span></div><div className="s">When auto-trade fires, positions appear here.</div></div>
          ) : positions.map(p => {
            const c = colorFor(p.mint);
            const pnlPct = p.entryPriceUsd > 0 ? ((p.currentPriceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100 : 0;
            const pnlSol = (p.entrySol || 0) * (pnlPct / 100);
            const up = pnlPct > 0.01, dn = pnlPct < -0.01;
            const ageMin = Math.floor((Date.now() - p.ts) / 60000);
            return (
              <div className="wa-pos-row" key={p.mint}>
                <div className="wa-pos-av" style={{background:'linear-gradient(135deg,'+c+','+shade(c,-30)+')'}}>{(p.sym || '?').charAt(0)}</div>
                <div className="wa-pos-nm">
                  <div className="wa-pos-sym">${p.sym || '???'}</div>
                  <div className="wa-pos-time">{ageMin}min open · {formatSol(p.entrySol || 0)} SOL in</div>
                </div>
                <div className="wa-pos-pnl">
                  <div className={'wa-pos-pnl-v ' + (up ? 'gn' : dn ? 'rd' : '')}>{Math.abs(pnlSol) > 0.0001 ? formatSolSigned(pnlSol) : '—'}</div>
                  <div className={'wa-pos-pnl-p ' + (up ? 'gn' : dn ? 'rd' : '')}>{(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%'}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="wa-log-frame">
          <div className="wa-section-head"><span>§ Event log</span><span className="count">{log.length}</span></div>
          <div className="wa-log-list">
            {log.length === 0 ? (
              <div className="wa-empty"><div className="h">No events yet</div></div>
            ) : log.map(e => (
              <div className="wa-log-row" key={e.id}>
                <span className="wa-log-ts">{new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className={'wa-log-tag ' + e.tag}>{e.tag}</span>
                <span className="wa-log-msg">{e.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="wa-kill">
        <button className="wa-kill-btn stop" disabled={!enabled && !paused} onClick={() => { setEnabled(false); setPaused(false); }}>STOP AUTO</button>
        <button className="wa-kill-btn flat" disabled={positions.length === 0} onClick={flatten}>FLATTEN ALL · {positions.length}</button>
      </div>
    </div>
  );
}
 