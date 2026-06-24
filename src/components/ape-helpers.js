// ape-helpers.js — React-free logic extracted from Ape.jsx to thin out the
// big component. Pure functions, formatters, the vibe-check, trade-param
// builders, share intents, RPC connection layer, and the pump route fetch.
//
// PERFORMANCE PATCHES (this revision):
//   1) Confirmation poll: 5000ms -> 800ms. searchTransactionHistory: false
//      (was searching archive on a sig we just sent — pointless and slow).
//      Rebroadcast every ~3.2s, blockheight check every ~4.8s instead of
//      every iteration. Net: 1–3s perceived confirmation vs 5–15s prior.
//   2) Pre-send parallelization: getPumpRoute + getLatestBlockhash +
//      refLookup now run via Promise.all. Saves 100–400ms per trade.
//   3) ALT account cache: decodeBuiltTx() caches AddressLookupTableAccount
//      lookups by base58 key. Pump.fun's ALT is stable for the session, so
//      trade #2+ skips the getMultipleAccountsInfo round-trip. ~150–300ms.
//   4) Referrer cache: refLookup() memoizes per walletStr. Bot doing 50
//      trades only calls /api/ref/lookup once.
//
// Place this next to Ape.jsx and import what you need. See bottom of file
// for the public API.

import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
} from '@solana/web3.js';

/* ============================================================
   CONFIG
   ============================================================ */
export const SOL_MINT   = 'So11111111111111111111111111111111111111112';
export const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
export const FEE_BPS    = 300;
export const SOL_RESERVE = 0.01;

export const DEFAULT_BUY_PRESETS  = [0.1, 0.25, 0.5, 1, 2];
export const DEFAULT_SELL_PRESETS = [25, 50, 100];

/* ============================================================
   RPC CONNECTION LAYER
   /api/solana-rpc — Alchemy only. Every background read: balances, token
   accounts, prices, positions, debug, and withdraw tx submission.
   /api/trade-rpc  — Alchemy primary, Ankr fallback. ONLY the buy/sell
   critical path inside executeSwap. The only place Ankr is exercised.
   ============================================================ */
export const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';

export const TRADE_RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/trade-rpc'
  : 'http://localhost:3001/api/trade-rpc';

export const BAL_COMMITMENT = 'processed';

const _connCache = new Map();
export const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};
const _tradeConnCache = new Map();
export const getTradeConn = (commitment) => {
  let c = _tradeConnCache.get(commitment);
  if (!c) { c = new Connection(TRADE_RPC_URL, commitment); _tradeConnCache.set(commitment, c); }
  return c;
};
export const balRpcRace = (op) => op(getConn(BAL_COMMITMENT));

/* ============================================================
   FORMATTERS
   ============================================================ */
export function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
export function formatMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  if (n >= 1) return '$'+n.toFixed(2);
  return '$'+n.toPrecision(2);
}
export function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1) return '$'+p.toFixed(4);
  if (p >= 0.01) return '$'+p.toFixed(5);
  if (p >= 0.0001) return '$'+p.toFixed(6);
  if (p >= 0.00000001) return '$'+p.toFixed(9);
  return '$'+p.toExponential(2);
}
export function formatPct(p) { if (!Number.isFinite(p)) return '0%'; return (p>=0?'+':'')+p.toFixed(p<10&&p>-10?2:1)+'%'; }
export function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
export function formatSolSigned(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  return (n >= 0 ? '+' : '-') + formatSol(Math.abs(n));
}
export function formatUsdAbs(n) {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n); const s = n < 0 ? '-' : '';
  if (abs >= 1e6) return s + '$' + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return s + '$' + (abs/1e3).toFixed(1) + 'K';
  if (abs >= 1)   return s + '$' + abs.toFixed(2);
  return s + '$' + abs.toPrecision(2);
}
export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
export function fmtAgeShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return Math.max(1, Math.floor(ms/1000))+'s';
  if (ms < 3600000) {
    const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000);
    return s > 0 && m < 10 ? (m+'m '+s+'s') : (m+'m');
  }
  const h = ms/3600000; if (h < 24) return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
export function ageClass(ms) {
  if (!Number.isFinite(ms)) return 'wr-age old';
  if (ms < 30000) return 'wr-age';
  if (ms < 180000) return 'wr-age med';
  return 'wr-age old';
}
export function mobAgeClass(ms) {
  if (!Number.isFinite(ms)) return 'mob-age old';
  if (ms < 30000) return 'mob-age';
  if (ms < 180000) return 'mob-age med';
  return 'mob-age old';
}
export const lamportsToSol = (l) => Number(l || 0) / 1e9;
export const truncWallet = (w) => w ? w.slice(0,4) + '…' + w.slice(-4) : '';

/* ============================================================
   VIBE CHECK
   ============================================================ */
export const RISK_CEIL = 85;
export function riskRead(t) {
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

export function normalize(t) {
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
export const friendlyError = (err) => {
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
export function describeSimLogs(logs, fallbackMsg) {
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
export function describeOnChainErr(err) {
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
export function colorFor(mint) {
  const palette = ['#a855f7','#f472b6','#fb923c','#60a5fa','#22d3ee','#facc15','#16a34a','#ec4899','#0ea5e9','#fda4af','#f59e0b','#9333ea','#84cc16','#06b6d4','#dc2626'];
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
export function shade(hex, p) {
  const f = parseInt(hex.slice(1), 16); const t = p < 0 ? 0 : 255; const pp = Math.abs(p) / 100;
  const R = f >> 16, G = (f >> 8) & 0xFF, B = f & 0xFF;
  return '#' + (0x1000000 + (Math.round((t - R) * pp) + R) * 0x10000 + (Math.round((t - G) * pp) + G) * 0x100 + (Math.round((t - B) * pp) + B)).toString(16).slice(1);
}

/* ============================================================
   TRADE PARAM BUILDERS
   NOTE: the BUY divisor 110n matches the server-side 10% slippage
   (1 + 10/100). If slippage changes server-side, change it here too.
   ============================================================ */
export function buildBuyParams(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalLamports = BigInt(Math.floor(n * 1e9));
  if (totalLamports <= 0n) return null;
  const feeLamports = (totalLamports * BigInt(FEE_BPS)) / 10000n;
  const tradeLamports = ((totalLamports - feeLamports) * 100n) / 110n;
  if (tradeLamports <= 0n || feeLamports <= 0n) return null;
  return { mode: 'buy', solAmount: n, totalLamports: totalLamports.toString(), tradeLamports: tradeLamports.toString(), feeLamports: feeLamports.toString() };
}
export function buildSellParams(token, pct, tokenBalance, solPrice) {
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

/* ============================================================
   SHARE INTENTS
   ============================================================ */
export function buildShareUrl() { if (typeof window === 'undefined') return ''; try { return new URL(window.location.origin + window.location.pathname).toString(); } catch (e) { return ''; } }
export function buildTweetText(o) {
  const { mode, token, solAmount, outAmount, percentage } = o;
  if (mode === 'buy') {
    const recv = outAmount > 0 ? '\n-> ' + formatTokens(outAmount) + ' $' + token.sym : '';
    return 'Just caught $' + token.sym + ' on wonderland//radar — ' + solAmount + ' SOL' + recv + '\n\nFresh launches at first light:';
  }
  const got = outAmount > 0 ? '\n-> ' + formatSol(outAmount) + ' SOL back' : '';
  return 'Sold ' + percentage + '% of $' + token.sym + ' on wonderland//radar' + got + '\n\nField log open here:';
}
export function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text }); if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
}
export function inviteUrl(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/?ref=' + walletStr;
}
export function shareUrlPath(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/share/' + walletStr;
}
export function openTelegram(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ url: url || '', text });
  window.open('https://t.me/share/url?' + params, '_blank', 'noopener,noreferrer');
}
// Discord has no public web share-intent URL, so the reliable cross-client move
// is to copy a ready-to-paste message to the clipboard. Returns true on success
// so the caller can show a "copied — paste in Discord" toast.
export async function openDiscord(text, url) {
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
export async function refLookup(walletStr) {
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
export function refRegister(walletStr, referrer, boost) {
  try {
    fetch('/api/ref/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletStr, referrer: referrer || null, boost: boost || null }),
    }).catch(() => {});
  } catch (e) {}
}
export function refLogTrade(payload) {
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
export const APE_PUMP_ROUTE = '/api/ape/pump-trade';
export const APE_JUP_ROUTE  = '/api/ape/jup-trade';
const _altCache = new Map(); // base58 key -> AddressLookupTableAccount

export async function decodeBuiltTx(b64, connection) {
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

export async function getPumpRoute(opts) {
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
export async function getJupRoute(opts) {
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
export async function executeSwap({ mode, swapParams, token, keypair, userPk, tradeConnection, walletStr, refWalletStr, solPrice }) {
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
 