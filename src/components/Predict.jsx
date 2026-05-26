// Predict.jsx — Jupiter Prediction Markets
//
// ARCHITECTURE (Jupiter-native, no swaps):
//   Access fee: $1.99/day in SOL on wallet connect → fee wallet (1 sig)
//   Buy:   1 sig — Predict order tx, exactly as Jupiter returns it. No fee from us. (Jupiter charges its own trading fee.)
//   Sell:  1 sig — Predict sell ix (DELETE /positions/{pubkey}) + one SPL transfer of our 5% fee in the deposit mint.
//   Claim: 1 sig — Predict claim ix (POST /positions/{pubkey}/claim) + one SPL transfer of our 5% fee in the deposit mint.
//   Payouts remain in USDC/JupUSD. The user can swap separately if they want SOL.
//
// All price-to-beat / spread data is sourced from Jupiter's own event.closeCondition + market.rulesPrimary.
// Live crypto prices come from Jupiter's public Price API.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection, PublicKey, VersionedTransaction, TransactionMessage,
  AddressLookupTableAccount, ComputeBudgetProgram, SystemProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// ── Constants ────────────────────────────────────────────────────────────────
const SOL_MINT          = 'So11111111111111111111111111111111111111112';
const USDC_MINT         = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEPOSIT_MINT      = USDC_MINT;
const DEPOSIT_DECIMALS  = 6;
const FEE_WALLET_B58    = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const FEE_WALLET        = new PublicKey(FEE_WALLET_B58);
const FEE_BPS           = 500;            // 5% on sell + claim (our fee, on top of Jupiter's)
const ACCESS_FEE_USD    = 1.99;
const ACCESS_FEE_TTL    = 24 * 60 * 60_000;
const ACCESS_FEE_KEY    = 'verixia.predict.accessFee.v1';
const SOL_RPC           = '/api/solana-rpc';
const MIN_TRADE_USD     = 5;
const NAV_CLEARANCE     = 120;
const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const CONFIRM_TIMEOUT_MS  = 15_000;
const CONFIRM_FALLBACK_MS = 12_000;
const KEEPER_POLL_INTERVAL = 1500;
const KEEPER_POLL_ATTEMPTS = 20;
const FETCH_TIMEOUT_MS  = 8_000;
const FETCH_MAX_RETRIES = 1;
const REFRESH_NORMAL_MS = 300_000;
const REFRESH_URGENT_MS = 30_000;
const URGENT_WINDOW_MS  = 15 * 60_000;
const JUP_PRICE_API     = 'https://lite-api.jup.ag/price/v3';
const LIVE_PRICE_POLL_MS = 5_000;

// Mints we want live prices for (used to compute spread vs price-to-beat in Up/Down crypto markets)
const SYMBOL_MINTS = {
  'btc/usd':  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC on Solana
  'eth/usd':  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH (portal)
  'sol/usd':  SOL_MINT,
  'jup/usd':  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

// ── Access fee helpers ───────────────────────────────────────────────────────
function getAccessFeeRecord(pubkey) {
  try {
    const raw = localStorage.getItem(ACCESS_FEE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj?.[pubkey] || null;
  } catch { return null; }
}
function setAccessFeeRecord(pubkey) {
  try {
    const raw = localStorage.getItem(ACCESS_FEE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[pubkey] = { paidAt: Date.now() };
    localStorage.setItem(ACCESS_FEE_KEY, JSON.stringify(obj));
  } catch {}
}
function hasValidAccessFee(pubkey) {
  const rec = getAccessFeeRecord(pubkey);
  if (!rec) return false;
  return Date.now() - rec.paidAt < ACCESS_FEE_TTL;
}

// ── Utilities ────────────────────────────────────────────────────────────────
// Convert a Jupiter API price (micro-USD, 1_000_000 = $1.00) to a JS number in dollars.
function toUsd(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n / 1e6 : null; }
function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  n = Number(n);
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)    return '$' + n.toFixed(d);
  if (n === 0)   return '$0.00';
  return '$' + n.toFixed(4);
}
function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}
function formatEndDate(closeTime) {
  const ms = toMs(closeTime); if (ms == null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return 'Closed';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m left`;
  if (diff < 24 * 60 * 60_000) {
    const h = Math.floor(diff / 3_600_000);
    const mm = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${mm}m left`;
  }
  const d = new Date(ms);
  return `Ends ${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
async function jfetch(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const maxAttempts = FETCH_MAX_RETRIES + 1;
  let attempt = 0;
  while (true) {
    attempt++;
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: c.signal });
      if (r.status === 429 && attempt < maxAttempts) { clearTimeout(id); await new Promise(res => setTimeout(res, 400)); continue; }
      if (!r.ok) {
        let body = ''; try { body = await r.text(); } catch {}
        const err = new Error(`HTTP ${r.status}: ${body.slice(0, 300) || r.statusText}`);
        err.status = r.status; err.body = body;
        throw err;
      }
      return r;
    } finally { clearTimeout(id); }
  }
}
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
}
async function copyToClipboard(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
  return false;
}

function friendlyError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  const body = String(err?.body || '').toLowerCase();
  const hay = m + ' ' + body;
  const status = err?.status;
  if (hay.includes('no_shares_available') || hay.includes('no shares available')) return 'No shares available at this price.';
  if (hay.includes('not_enough_liquidity') || hay.includes('insufficient liquidity')) return 'Not enough liquidity.';
  if (hay.includes('market_closed') || hay.includes('market closed')) return 'Market is closed.';
  if (hay.includes('market_settled') || hay.includes('already settled')) return 'Market already settled.';
  if (hay.includes('order_too_small') || hay.includes('below minimum')) return `Below $${MIN_TRADE_USD} minimum.`;
  if (status === 451 || status === 403 || hay.includes('geographic') || hay.includes('region')) return 'Not available in your region.';
  if (status === 429 || hay.includes('too many requests')) return 'Rate limited. Wait a moment.';
  if (hay.includes('insufficient')) return 'Insufficient balance.';
  if (hay.includes('slippage')) return 'Price moved too much. Try again.';
  if (hay.includes('blockhash') || hay.includes('expired')) return 'Transaction expired. Try again.';
  if (hay.includes('user reject') || hay.includes('user denied') || hay.includes('cancel')) return 'Cancelled.';
  if (hay.includes('aborted') || hay.includes('abort')) return 'Cancelled.';
  return err?.message || 'Something went wrong.';
}

// ── Versioned transaction helpers ────────────────────────────────────────────
// Append an additional instruction to a Jupiter-built VersionedTransaction without
// losing its ALTs. Re-uses the original blockhash & ALTs so Blowfish sees the same
// account graph plus one extra readable transfer.
async function appendIxToVtx({ connection, vtx, extraIxs }) {
  const msg = vtx.message;
  const staticKeys = msg.staticAccountKeys;
  const altAddresses = (msg.addressTableLookups || []).map(a => a.accountKey);

  // Load ALTs so we can resolve writable+readonly indexes when recompiling.
  const alts = [];
  if (altAddresses.length) {
    const infos = await connection.getMultipleAccountsInfo(altAddresses);
    for (let i = 0; i < altAddresses.length; i++) {
      if (!infos[i]) throw new Error('ALT not found on chain: ' + altAddresses[i].toBase58());
      alts.push(new AddressLookupTableAccount({
        key: altAddresses[i],
        state: AddressLookupTableAccount.deserialize(infos[i].data),
      }));
    }
  }

  // Walk compiled instructions and resolve each account index against static keys + ALTs.
  // Index layout for v0 messages:
  //   [0 .. numStatic)                      → staticAccountKeys
  //   [numStatic .. numStatic + writable)   → ALT writable entries (in order of address table lookups)
  //   [numStatic + writable .. end)         → ALT readonly entries
  const numStatic = staticKeys.length;
  const writablePool = []; // [{ pubkey, isWritable: true }]
  const readonlyPool = []; // [{ pubkey, isWritable: false }]
  for (let i = 0; i < (msg.addressTableLookups || []).length; i++) {
    const lookup = msg.addressTableLookups[i];
    const alt = alts[i];
    for (const idx of lookup.writableIndexes) {
      writablePool.push({ pubkey: alt.state.addresses[idx], isWritable: true });
    }
    for (const idx of lookup.readonlyIndexes) {
      readonlyPool.push({ pubkey: alt.state.addresses[idx], isWritable: false });
    }
  }

  const payerKey = staticKeys[0];
  const resolveKey = (idx) => {
    if (idx < numStatic) {
      return {
        pubkey: staticKeys[idx],
        isSigner: msg.isAccountSigner(idx),
        isWritable: msg.isAccountWritable(idx),
      };
    }
    const altIdx = idx - numStatic;
    if (altIdx < writablePool.length) {
      return { pubkey: writablePool[altIdx].pubkey, isSigner: false, isWritable: true };
    }
    const roIdx = altIdx - writablePool.length;
    if (roIdx < readonlyPool.length) {
      return { pubkey: readonlyPool[roIdx].pubkey, isSigner: false, isWritable: false };
    }
    throw new Error(`Could not resolve account index ${idx}`);
  };

  const decompiledIxs = msg.compiledInstructions.map(ci => ({
    programId: staticKeys[ci.programIdIndex],
    keys: ci.accountKeyIndexes.map(resolveKey),
    data: Buffer.from(ci.data),
  }));

  const allIxs = [...decompiledIxs, ...extraIxs];

  const newMsg = new TransactionMessage({
    payerKey,
    recentBlockhash: msg.recentBlockhash,
    instructions: allIxs,
  }).compileToV0Message(alts);

  return new VersionedTransaction(newMsg);
}

// Build SPL transfer ix(s) for our 5% fee from user's deposit-mint ATA → fee wallet ATA.
// Includes idempotent ATA creation in case fee wallet has never received this mint.
function buildFeeTransferIxs({ ownerPubkey, feeAtomic, mint = DEPOSIT_MINT, decimals = DEPOSIT_DECIMALS }) {
  const mintPk = new PublicKey(mint);
  const userAta = getAssociatedTokenAddressSync(mintPk, ownerPubkey);
  const feeAta  = getAssociatedTokenAddressSync(mintPk, FEE_WALLET, true, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(ownerPubkey, feeAta, FEE_WALLET, mintPk),
    createTransferCheckedInstruction(userAta, mintPk, feeAta, ownerPubkey, feeAtomic, decimals),
  ];
}

// ── Solana helpers ───────────────────────────────────────────────────────────
async function fetchSolBalance(connection, ownerB58) {
  try { return BigInt(await connection.getBalance(new PublicKey(ownerB58), 'confirmed')); }
  catch { return 0n; }
}

// Jupiter Price API — single source for SOL, BTC, ETH, etc.
// Returns Map<lowercase-symbol, { value, timestamp }> from a single batched call.
async function fetchJupPrices(symbols) {
  try {
    const wanted = symbols.filter(s => SYMBOL_MINTS[s]);
    if (!wanted.length) return new Map();
    const ids = wanted.map(s => SYMBOL_MINTS[s]).join(',');
    const r = await fetch(`${JUP_PRICE_API}?ids=${ids}`);
    if (!r.ok) return new Map();
    const j = await r.json();
    const out = new Map();
    for (const sym of wanted) {
      const mint = SYMBOL_MINTS[sym];
      const entry = j?.[mint];
      const price = Number(entry?.usdPrice ?? entry?.price ?? 0);
      if (Number.isFinite(price) && price > 0) {
        out.set(sym, { value: price, timestamp: Date.now() });
      }
    }
    return out;
  } catch { return new Map(); }
}

// SOL price for converting $1.99 → lamports for the access fee.
async function fetchSolPrice() {
  const prices = await fetchJupPrices(['sol/usd']);
  return prices.get('sol/usd')?.value ?? 150;
}

// ── Build access fee transaction ($1.99 in SOL to fee wallet) ────────────────
async function buildAccessFeeTx({ connection, ownerPubkey }) {
  const solPrice = await fetchSolPrice();
  const lamports = BigInt(Math.round((ACCESS_FEE_USD / solPrice) * LAMPORTS_PER_SOL));
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const ixs = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
    SystemProgram.transfer({ fromPubkey: ownerPubkey, toPubkey: FEE_WALLET, lamports }),
  ];
  const msg = new TransactionMessage({
    payerKey: ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  return { tx: new VersionedTransaction(msg), lamports, latestBlockhash };
}

// ── Jupiter Predict API ──────────────────────────────────────────────────────
async function fetchEvents() {
  const qs = new URLSearchParams({
    category: 'crypto',
    filter: 'live',
    includeMarkets: 'true',
    start: '0',
    end: '50',
  });
  const r = await jfetch('/api/predict/events?' + qs.toString());
  const j = await r.json();
  return Array.isArray(j) ? j : (j?.data || j?.events || []);
}

// Parse price-to-beat from Jupiter's own rule/close-condition text.
// Up/Down crypto markets put a reference price in one of these spots; everything we need
// is in Jupiter's payload. No Polymarket dependency.
function extractPriceToBeat(text) {
  if (!text) return null;
  const clean = s => Number(String(s).replace(/[$,\s]/g, ''));
  const ok = n => Number.isFinite(n) && n > 0 && n < 1e9;

  const patterns = [
    /"[Pp]rice\s+to\s+[Bb]eat"\s+of\s+\$([0-9][0-9.,]*)/,
    /[Pp]rice\s+to\s+[Bb]eat[^0-9$]{0,20}\$([0-9][0-9.,]*)/,
    /(?:opening|reference|starting)\s+(?:reference\s+)?price[^0-9$]{0,30}\$([0-9][0-9.,]*)/i,
    /(?:above|over|greater\s+than|>=?)\s*\$([0-9][0-9.,]*)/i,
    /(?:reach(?:es|ed)?|hits?|trades?\s+at)\s*\$([0-9][0-9.,]*)/i,
    /closes?\s+(?:above|at)\s*\$([0-9][0-9.,]*)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) { const n = clean(m[1]); if (ok(n)) return n; }
  }
  return null;
}

function pickEventFields(ev) {
  if (!ev) return null;
  const market = (ev.markets && ev.markets[0]) || ev.market || null;
  if (!market) return null;
  const pricing = market.pricing || {};
  const yesPrice = toUsd(pricing.buyYesPriceUsd) ?? 0;
  let noPrice = toUsd(pricing.buyNoPriceUsd) ?? 0;
  if (!noPrice && yesPrice) noPrice = +(1 - yesPrice).toFixed(4);
  const evMeta = ev.metadata || {};
  const mktMeta = market.metadata || {};
  // Jupiter exposes the up/down reference price either in event.closeCondition or market.rulesPrimary.
  const ruleHaystack = [
    ev.closeCondition,
    evMeta.closeCondition,
    mktMeta.rulesPrimary,
    market.rulesPrimary,
    mktMeta.description,
  ].filter(Boolean).join('\n');
  const priceToBeat = extractPriceToBeat(ruleHaystack);
  return {
    eventId: ev.eventId || ev.id,
    title: ev.title || evMeta.title || 'Untitled',
    image: evMeta.imageUrl || ev.imageUrl || market.imageUrl || ev.image || null,
    category: String(ev.category || '').toLowerCase(),
    subcategory: ev.subcategory || null,
    tags: Array.isArray(ev.tags) ? ev.tags.filter(Boolean) : [],
    closeCondition: ev.closeCondition || evMeta.closeCondition || null,
    closeTime: evMeta.closeTime ?? mktMeta.closeTime ?? market.closeTime ?? ev.closeTime ?? null,
    volume24h: toUsd(ev.volumeUsd ?? pricing.volume ?? 0) ?? 0,
    isLive: ev.isLive !== false,
    isActive: ev.isActive !== false,
    priceToBeat,
    rulesText: mktMeta.rulesPrimary || market.rulesPrimary || ev.closeCondition || evMeta.closeCondition || null,
    market: {
      marketId: market.marketId || market.id,
      title: mktMeta.title || market.title || null,
      description: mktMeta.description || null,
      rulesPrimary: mktMeta.rulesPrimary || market.rulesPrimary || null,
      status: mktMeta.status || market.status || 'open',
      result: mktMeta.result || market.result || null,
      closeTime: market.closeTime || mktMeta.closeTime || null,
      yesPrice,
      noPrice,
      sellYesPrice: toUsd(pricing.sellYesPriceUsd) ?? 0,
      sellNoPrice:  toUsd(pricing.sellNoPriceUsd) ?? 0,
      volume: toUsd(pricing.volume || 0) ?? 0,
      yesPct: Math.max(0, Math.min(99, Math.round(yesPrice * 100))),
      noPct:  Math.max(0, Math.min(99, Math.round(noPrice  * 100))),
    },
  };
}

const CLOSE_BUFFER_MS = 60_000;
function isMarketOpen(event) {
  if (!event || event.isActive === false || event.isLive === false) return false;
  const m = event.market; if (!m) return false;
  if (m.status && m.status !== 'open') return false;
  if (m.result && m.result !== 'pending' && m.result !== '') return false;
  const ms = toMs(event.closeTime);
  if (ms != null && (ms - Date.now()) <= CLOSE_BUFFER_MS) return false;
  return true;
}

// Live prices for crypto markets — polled from Jupiter Price API on the Markets tab.
function useLiveJupPrices(enabled, symbols) {
  const [prices, setPrices] = useState(() => new Map());
  // Stable serialization of the symbol set so we don't re-trigger the effect on every render.
  const symbolKey = useMemo(() => Array.from(new Set(symbols)).sort().join(','), [symbols]);
  useEffect(() => {
    if (!enabled || !symbolKey) return;
    const wanted = symbolKey.split(',').filter(Boolean);
    if (!wanted.length) return;
    let alive = true;
    const tick = async () => {
      const next = await fetchJupPrices(wanted);
      if (!alive) return;
      // Merge so we don't drop symbols on a transient failure.
      setPrices(prev => {
        if (next.size === 0) return prev;
        const merged = new Map(prev);
        for (const [k, v] of next) merged.set(k, v);
        return merged;
      });
    };
    tick();
    const id = setInterval(tick, LIVE_PRICE_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [enabled, symbolKey]);
  return prices;
}

function symbolFromSubcategory(sub) {
  if (!sub) return null;
  const s = String(sub).toLowerCase().trim();
  if (s.includes('btc') || s.includes('bitcoin'))  return 'btc/usd';
  if (s.includes('eth') || s.includes('ethereum')) return 'eth/usd';
  if (s.includes('sol') || s.includes('solana'))   return 'sol/usd';
  if (s.includes('jup') || s.includes('jupiter'))  return 'jup/usd';
  return null;
}
function symbolFromTitle(title) {
  if (!title) return null;
  const t = (' ' + String(title).toLowerCase() + ' ');
  if (t.includes('bitcoin') || t.includes(' btc '))      return 'btc/usd';
  if (t.includes('ethereum') || t.includes(' eth '))     return 'eth/usd';
  if (t.includes('solana')   || t.includes(' sol '))     return 'sol/usd';
  if (t.includes('jupiter')  || t.includes(' jup '))     return 'jup/usd';
  return null;
}

function pickPositionFields(p) {
  if (!p) return null;
  const contracts = Number(p.contracts || 0);
  const avgPriceUsd  = toUsd(p.avgPriceUsd) ?? 0;
  const markPriceUsd = toUsd(p.markPriceUsd);                       // null when closed
  const sellPriceUsd = toUsd(p.sellPriceUsd);                       // null when no liquidity
  const costUsd      = toUsd(p.totalCostUsd ?? p.sizeUsd) ?? (contracts * avgPriceUsd);
  // Prefer sellPriceUsd for an honest exit estimate; fall back to mark, then null.
  const exitPrice = sellPriceUsd ?? markPriceUsd ?? null;
  const valueUsd  = toUsd(p.valueUsd) ?? (exitPrice != null ? contracts * exitPrice : null);
  const pnlUsd    = toUsd(p.pnlUsd) ?? (valueUsd != null ? valueUsd - costUsd : null);
  const evMeta  = p.eventMetadata  || {};
  const mktMeta = p.marketMetadata || {};
  return {
    positionPubkey: p.pubkey || p.positionPubkey,
    marketId: p.marketId,
    isYes: !!p.isYes,
    title: evMeta.title || mktMeta.title || p.title || 'Position',
    outcomeLabel: mktMeta.title || null,
    marketStatus: mktMeta.status || null,
    marketResult: mktMeta.result || null,
    contracts,
    claimable: !!p.claimable,
    claimed: !!p.claimed,
    avgPriceUsd,
    markPriceUsd,                // may be null
    sellPriceUsd,                // may be null
    exitPrice,                   // may be null
    costUsd,
    valueUsd,                    // may be null
    payoutUsd: toUsd(p.payoutUsd) ?? (contracts * 1),
    pnlUsd,                      // may be null
    pnlUsdPercent: (costUsd > 0 && pnlUsd != null) ? (pnlUsd / costUsd) * 100 : null,
  };
}

// ── Transaction helpers ──────────────────────────────────────────────────────
async function pollOrderStatus(orderPubkey, { maxAttempts = KEEPER_POLL_ATTEMPTS, intervalMs = KEEPER_POLL_INTERVAL, onTick, signal } = {}) {
  if (!orderPubkey) return 'pending';
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return 'aborted';
    try {
      onTick?.(i + 1, maxAttempts);
      const c = new AbortController();
      const tid = setTimeout(() => c.abort(), 4000);
      try {
        const r = await fetch(`/api/predict/orders/status/${encodeURIComponent(orderPubkey)}`, { signal: c.signal });
        clearTimeout(tid);
        if (r.ok) {
          const j = await r.json();
          const status = (j?.status || j?.data?.status || '').toLowerCase();
          if (status === 'filled' || status === 'complete' || status === 'completed') return 'filled';
          if (status === 'failed' || status === 'rejected' || status === 'cancelled' || status === 'canceled') return 'failed';
        }
      } finally { clearTimeout(tid); }
    } catch {}
    if (signal?.aborted) return 'aborted';
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return 'pending';
}

async function sendAndConfirm(connection, signedTx, blockhashInfo, setStMsg, signal) {
  if (signal?.aborted) throw new Error('Cancelled.');
  setStMsg('Submitting…');
  const sig = await connection.sendRawTransaction(signedTx.serialize(), {
    maxRetries: 3,
    skipPreflight: true,
    preflightCommitment: 'confirmed',
  });
  setStMsg('Confirming…');
  const bh = blockhashInfo || await connection.getLatestBlockhash('confirmed');
  try {
    const conf = await Promise.race([
      connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      }, 'confirmed'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), CONFIRM_TIMEOUT_MS)),
    ]);
    if (conf?.value?.err) throw new Error('On-chain error: ' + JSON.stringify(conf.value.err));
    return { sig, status: 'confirmed' };
  } catch (e) {
    if (/on-chain/i.test(String(e?.message))) throw e;
    const deadline = Date.now() + CONFIRM_FALLBACK_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Cancelled.');
      await new Promise(r => setTimeout(r, 1500));
      try {
        const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (st?.value?.err) throw new Error('On-chain error: ' + JSON.stringify(st.value.err));
        const cs = st?.value?.confirmationStatus;
        if (cs === 'confirmed' || cs === 'finalized') return { sig, status: 'confirmed' };
      } catch (inner) { if (/on-chain/i.test(String(inner?.message))) throw inner; }
    }
    return { sig, status: 'pending' };
  }
}

async function loggedFetch(url, opts, dbg, label) {
  dbg(`http:${label}:req`, `${opts?.method || 'GET'} ${url}`);
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    if (!r.ok) {
      dbg(`http:${label}:fail`, `${r.status}`, parsed || text.slice(0, 400));
      const err = new Error(`HTTP ${r.status}: ${(text || r.statusText).slice(0, 300)}`);
      err.status = r.status; err.body = text;
      throw err;
    }
    dbg(`http:${label}:ok`, `${r.status}`);
    return { response: r, json: parsed, text };
  } catch (e) {
    if (e.status === undefined) dbg(`http:${label}:error`, e?.message || String(e));
    throw e;
  }
}

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#03060f', card: '#080d1a', cardHi: '#0c1428',
  ink: '#e8ecf5', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no:  '#ff5f7a', noDim:  'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow:   '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// ── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner({ size = 12, color = C.hl }) {
  return <div style={{ width: size, height: size, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: color, animation: 'nexus-spin .8s linear infinite', flexShrink: 0 }} />;
}

function useDebugLog() {
  const [log, setLog] = useState([]);
  const push = useCallback((tag, msg, data) => {
    const time = new Date().toISOString().slice(11, 23);
    let payload = '';
    if (data !== undefined) {
      try { payload = typeof data === 'string' ? data : JSON.stringify(data, (k, v) => typeof v === 'bigint' ? v.toString() + 'n' : v, 2); }
      catch { payload = String(data); }
    }
    setLog(prev => [...prev, { time, tag, msg, payload }].slice(-100));
    console.log(`[predict:${tag}] ${msg}`, data !== undefined ? data : '');
  }, []);
  const clear = useCallback(() => setLog([]), []);
  return { log, push, clear };
}

function DebugPanel({ log, onClear }) {
  const [expanded, setExpanded] = useState(true);
  if (log.length === 0) return null;
  const text = log.map(l => `[${l.time}] ${l.tag}: ${l.msg}${l.payload ? '\n  ' + l.payload.replace(/\n/g, '\n  ') : ''}`).join('\n');
  return (
    <div style={{ marginTop: 10, padding: 8, borderRadius: 10, background: 'rgba(0,0,0,.45)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: 0, ...T.mono }}>
          DEBUG ({log.length}) {expanded ? '▼' : '▶'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => copyToClipboard(text)} style={{ padding: '3px 8px', borderRadius: 6, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>COPY</button>
          <button onClick={onClear} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,95,122,.1)', border: '1px solid rgba(255,95,122,.3)', color: C.no, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>CLEAR</button>
        </div>
      </div>
      {expanded && (
        <div style={{ maxHeight: 200, overflowY: 'auto', color: C.ink, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {log.map((l, i) => {
            const isErr = l.tag.includes('error') || l.tag.includes('fail');
            return (
              <div key={i} style={{ marginBottom: 4, color: isErr ? C.no : C.ink }}>
                <span style={{ color: C.muted2 }}>[{l.time}]</span>{' '}
                <span style={{ color: isErr ? C.no : C.hl, fontWeight: 700 }}>{l.tag}:</span>{' '}
                <span>{l.msg}</span>
                {l.payload && <div style={{ paddingLeft: 8, color: C.muted, fontSize: 9 }}>{l.payload}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusLine({ msg, step }) {
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Spinner />
      <div style={{ flex: 1 }}>
        {step && <div style={{ fontSize: 9, color: C.hl, fontWeight: 800, letterSpacing: 1.2, ...T.mono, marginBottom: 1 }}>{step}</div>}
        <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{msg}</span>
      </div>
    </div>
  );
}
function ErrorLine({ msg }) {
  return <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no, wordBreak: 'break-word' }}>{msg}</div>;
}
function WarnLine({ msg }) {
  return <div style={{ marginBottom: 8, padding: 8, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', borderRadius: 10, fontSize: 11, color: C.amber, fontWeight: 600, lineHeight: 1.4 }}>{msg}</div>;
}
function PrimaryButton({ onClick, disabled, label, color = 'hl' }) {
  const bg = color === 'no' ? `linear-gradient(135deg,${C.no}33,${C.no}22)` :
             color === 'yes' ? `linear-gradient(135deg,${C.yes}33,${C.yes}22)` :
             `linear-gradient(135deg,${C.hl},${C.hl2})`;
  const textColor = color === 'no' ? C.no : color === 'yes' ? C.yes : C.bg;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ width: '100%', padding: 12, borderRadius: 11, background: bg, color: textColor, fontWeight: 800, fontSize: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...T.body }}>
      {label}
    </button>
  );
}
function CancelButton({ onClick, disabled, label = 'Cancel' }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ width: '100%', marginTop: 6, padding: 9, borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontWeight: 700, fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .4 : 1, ...T.mono }}>
      {label}
    </button>
  );
}
function Skeleton() {
  return (
    <div style={{ padding: 10, borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, marginBottom: 7 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, width: '85%', background: 'rgba(255,255,255,.06)', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '50%', background: 'rgba(255,255,255,.03)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 34, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
        <div style={{ flex: 1, height: 34, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
      </div>
    </div>
  );
}
function Row({ label, value, valueColor, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: valueColor || C.ink, fontWeight: bold ? 700 : 600 }}>{value}</span>
    </div>
  );
}

// ── Access fee modal ─────────────────────────────────────────────────────────
function AccessFeeModal({ onPaid, onDismiss, connection, publicKey, signTransaction }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const { log, push: dbg, clear } = useDebugLog();
  const pay = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setError(''); setStep(1);
    try {
      dbg('access-fee:build', `$${ACCESS_FEE_USD} → ${FEE_WALLET_B58.slice(0, 8)}…`);
      const { tx, latestBlockhash } = await buildAccessFeeTx({ connection, ownerPubkey: publicKey });
      const signed = await signTransaction(tx);
      const result = await sendAndConfirm(connection, signed, latestBlockhash, () => {}, null);
      dbg('access-fee:done', result.sig);
      setAccessFeeRecord(publicKey.toBase58());
      setStep(2);
      setTimeout(() => onPaid(), 800);
    } catch (e) {
      dbg('access-fee:error', e?.message);
      setError(friendlyError(e));
      setStep(0);
    }
  }, [publicKey, signTransaction, connection, onPaid, dbg]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(3,6,15,.85)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380, background: `linear-gradient(180deg,${C.cardHi},${C.card})`, border: `1px solid ${C.borderHi}`, borderRadius: 20, padding: 20, boxShadow: C.shadowLg }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔮</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, ...T.display, marginBottom: 6 }}>Predict Access</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, ...T.body }}>
            Daily access fee of <span style={{ color: C.hl, fontWeight: 700 }}>${ACCESS_FEE_USD}</span> in SOL.<br />
            Valid for 24 hours.
          </div>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 14, ...T.mono, fontSize: 10 }}>
          <Row label="Access fee" value={`$${ACCESS_FEE_USD} in SOL`} />
          <Row label="Valid for" value="24 hours" />
          <Row label="Buy fee" value="None (Jupiter only)" valueColor={C.yes} />
          <Row label="Sell / claim fee" value="5%" valueColor={C.hl} />
        </div>
        {step === 0 && <PrimaryButton onClick={pay} label={`Pay $${ACCESS_FEE_USD} & Enter`} color="hl" />}
        {step === 1 && <StatusLine msg="Confirm payment in wallet…" />}
        {step === 2 && <div style={{ textAlign: 'center', padding: 12, color: C.yes, fontWeight: 800, fontSize: 14, ...T.display }}>✓ Access granted</div>}
        {error && <ErrorLine msg={error} />}
        {step === 0 && <CancelButton onClick={onDismiss} label="Cancel" />}
        <DebugPanel log={log} onClear={clear} />
      </div>
    </div>
  );
}

// ── Page header ──────────────────────────────────────────────────────────────
function PageHeader({ connected, solBal, tab, setTab, pubkey, onCopy }) {
  const sol = Number(solBal) / 1e9;
  return (
    <div style={{ marginTop: 4, marginBottom: 10, padding: '14px 14px 12px', borderRadius: 18, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: -0.5, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Crypto markets · live</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>JUPITER</div>
        </div>
        {connected ? (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>
                  {sol.toFixed(4)}<span style={{ fontSize: 10, color: C.muted, ...T.mono, marginLeft: 4 }}>SOL</span>
                </div>
              </div>
              {pubkey && (
                <button onClick={onCopy} style={{ padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
                  {pubkey.slice(0, 4)}…{pubkey.slice(-4)}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: 10, borderRadius: 12, background: 'rgba(168,127,255,.05)', border: '1px solid rgba(168,127,255,.30)', marginBottom: 10, fontSize: 12, color: C.ink }}>
            Connect a Solana wallet to start trading.
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, padding: 2, background: 'rgba(255,255,255,.03)', borderRadius: 9 }}>
          {['markets', 'positions'].map(id => (
            <button key={id} onClick={() => setTab(id)}
              style={{ flex: 1, padding: '7px 4px', borderRadius: 7, background: tab === id ? C.hlDim : 'transparent', border: `1px solid ${tab === id ? C.borderHi : 'transparent'}`, color: tab === id ? C.hl : C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>
              {id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Price panel ──────────────────────────────────────────────────────────────
function fmtPrice(n) {
  if (n == null) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function PricePanel({ event, livePrices, compact = false }) {
  const symbol = symbolFromSubcategory(event.subcategory) || symbolFromTitle(event.title);
  const live = symbol ? livePrices?.get(symbol) : null;
  const currentPrice = live?.value ?? null;
  const priceToBeat  = event.priceToBeat ?? null;
  const isCrypto = event.category === 'crypto' || !!symbol;
  if (!isCrypto && priceToBeat == null && currentPrice == null) return null;
  const hasBoth = priceToBeat != null && currentPrice != null;
  const delta = hasBoth ? currentPrice - priceToBeat : null;
  const deltaPct = hasBoth && priceToBeat > 0 ? (delta / priceToBeat) * 100 : null;
  const isUp = delta != null && delta >= 0;
  const borderColor = hasBoth ? (isUp ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)') : 'rgba(255,255,255,.08)';
  const bg = hasBoth ? (isUp ? 'rgba(0,212,163,.06)' : 'rgba(255,95,122,.06)') : 'rgba(255,255,255,.02)';
  const sz = compact ? 10 : 12;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: compact ? 6 : 8, marginBottom: compact ? 6 : 10, padding: compact ? '6px 8px' : '8px 12px', borderRadius: 10, background: bg, border: `1px solid ${borderColor}`, ...T.mono }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>PRICE TO BEAT</div>
        <div style={{ fontSize: sz, fontWeight: 800, color: C.ink, ...T.display }}>{fmtPrice(priceToBeat)}</div>
      </div>
      {hasBoth && (
        <div style={{ textAlign: 'center', minWidth: compact ? 60 : 72, paddingLeft: compact ? 4 : 8, paddingRight: compact ? 4 : 8, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>SPREAD</div>
          <div style={{ fontSize: sz, fontWeight: 800, color: isUp ? C.yes : C.no, ...T.display }}>{isUp ? '+' : '−'}{fmtPrice(Math.abs(delta))}</div>
          <div style={{ fontSize: 8, fontWeight: 700, color: isUp ? C.yes : C.no, marginTop: 1 }}>{isUp ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(2)}%</div>
        </div>
      )}
      <div style={{ flex: 1, textAlign: 'right' }}>
        <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>NOW</div>
        <div style={{ fontSize: sz, fontWeight: 800, color: hasBoth ? (isUp ? C.yes : C.no) : C.ink, ...T.display }}>{fmtPrice(currentPrice)}</div>
        {currentPrice != null && <div style={{ fontSize: 7, color: C.muted2, marginTop: 1 }}>live</div>}
      </div>
    </div>
  );
}

// ── Market card ──────────────────────────────────────────────────────────────
function MarketCard({ event, livePrices, onTrade }) {
  const m = event.market;
  const yp = m.yesPrice; const np = m.noPrice;
  const upside = p => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  const closed = m.status !== 'open';
  const isUrgent = toMs(event.closeTime) && (toMs(event.closeTime) - Date.now()) > 0 && (toMs(event.closeTime) - Date.now()) < URGENT_WINDOW_MS;
  const symbol = symbolFromSubcategory(event.subcategory) || symbolFromTitle(event.title);
  const live = symbol ? livePrices?.get(symbol) : null;
  const currentPrice = live?.value ?? null;
  const ruleSnippet = (() => {
    const txt = event.rulesText || event.closeCondition;
    if (!txt) return null;
    const f = String(txt).trim().split(/(?<=[.!?])\s/)[0];
    return f.length > 160 ? f.slice(0, 157) + '…' : f;
  })();
  return (
    <div style={{ padding: 10, borderRadius: 14, background: `linear-gradient(145deg,${C.card},${C.cardHi})`, border: `1px solid ${isUrgent ? 'rgba(245,181,61,.40)' : C.border}`, marginBottom: 7, boxShadow: C.shadow, opacity: closed ? 0.55 : 1 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {event.image && <img src={event.image} alt="" onError={e => e.currentTarget.style.display = 'none'} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 3, ...T.body, ...clamp2 }}>{event.title}</div>
          {m.title && m.title !== event.title && <div style={{ fontSize: 11, fontWeight: 600, color: C.hl, lineHeight: 1.3, marginBottom: 4, ...T.body, ...clamp2 }}>{m.title}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 9, color: C.muted, ...T.mono, alignItems: 'center' }}>
            {event.subcategory && <span style={{ color: C.hl, textTransform: 'uppercase', fontWeight: 700 }}>{event.subcategory}</span>}
            {event.subcategory && <span style={{ opacity: .4 }}>·</span>}
            <span>Vol {formatVol(event.volume24h)}</span>
            {formatEndDate(event.closeTime) && <><span style={{ opacity: .4 }}>·</span><span style={{ color: isUrgent ? C.amber : C.muted, fontWeight: isUrgent ? 700 : 400 }}>{formatEndDate(event.closeTime)}</span></>}
            {currentPrice != null && <><span style={{ opacity: .4 }}>·</span><span style={{ color: C.violet }}>{'$' + currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 38 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: m.yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{m.yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono, textTransform: 'uppercase' }}>YES</div>
        </div>
      </div>
      <PricePanel event={event} livePrices={livePrices} />
      {ruleSnippet && <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4, marginBottom: 8, padding: '5px 7px', borderLeft: `2px solid ${C.hlDim}`, ...T.body, ...clamp2 }}>{ruleSnippet}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => !closed && onTrade(event, true)} disabled={closed}
          style={{ flex: 1, padding: 8, borderRadius: 10, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: closed ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>Yes · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}% upside</span>}
        </button>
        <button onClick={() => !closed && onTrade(event, false)} disabled={closed}
          style={{ flex: 1, padding: 8, borderRadius: 10, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: closed ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>No · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}% upside</span>}
        </button>
      </div>
    </div>
  );
}

// ── BuyDrawer (1 sig — Predict order only, no fee from us) ───────────────────
function BuyDrawer({ event, isYes, onClose, onDone, connection, livePrices }) {
  const { publicKey, signTransaction } = useWallet();
  const [amount, setAmount] = useState('10');
  const [step, setStep] = useState(0);
  const [statusMsg, setStMsg] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const { log: debugLog, push: dbg, clear: clearDbg } = useDebugLog();
  const abortRef = useRef(null);
  const onChainRef = useRef(false);
  useBodyLock(true);

  const m = event.market;
  const depositUsd = Number(amount) || 0;
  const price = isYes ? m.yesPrice : m.noPrice;
  const contractsEst = price > 0 ? depositUsd / price : 0;
  const sideLabel = isYes ? 'YES' : 'NO';
  const sideColor = isYes ? C.yes : C.no;
  const sideDim   = isYes ? C.yesDim : C.noDim;
  const busy = step > 0 && step < 3;
  const canBuy = !busy && depositUsd >= MIN_TRADE_USD && publicKey && m.marketId;
  const canCancel = busy && !onChainRef.current;

  const cancel = useCallback(() => {
    if (!canCancel) return;
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    setStep(0); setStMsg(''); setError('Cancelled.');
  }, [canCancel]);

  const placeOrder = useCallback(async () => {
    if (!publicKey || !signTransaction) { setError('Connect a wallet.'); return; }
    if (depositUsd < MIN_TRADE_USD) { setError(`Minimum $${MIN_TRADE_USD}.`); return; }
    dbg('buy:start', `side=${sideLabel} deposit=$${depositUsd}`);
    setError(''); setWarning(''); onChainRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const checkAbort = () => { if (signal.aborted) throw new Error('Cancelled.'); };
    try {
      const ownerB58 = publicKey.toBase58();
      const depositAtomic = BigInt(Math.round(depositUsd * 1e6));
      setStep(1); setStMsg('Building order…');
      const orderRequest = await loggedFetch('/api/predict/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerPubkey: ownerB58,
          marketId: m.marketId,
          isYes,
          isBuy: true,
          depositAmount: depositAtomic.toString(),
          depositMint: DEPOSIT_MINT,
        }),
        signal,
      }, dbg, 'predict-orders');
      const j = orderRequest.json;
      if (!j?.transaction) throw new Error('Jupiter Predict returned no transaction.');
      const orderPubkey = j.order?.orderPubkey || j.orderPubkey || (typeof j.order === 'string' ? j.order : null) || null;
      const orderBh = j.txMeta?.blockhash ? { blockhash: j.txMeta.blockhash, lastValidBlockHeight: j.txMeta.lastValidBlockHeight } : null;
      dbg('buy:1', `orderPubkey: ${orderPubkey || '(none)'}`);

      // Use Jupiter's tx exactly as-is. No fee ix, no merging, no swap.
      const buyTx = VersionedTransaction.deserialize(b64ToBytes(j.transaction));
      checkAbort();
      setStMsg(`Confirm — Buy ${sideLabel}`);
      const signedBuy = await signTransaction(buyTx);
      onChainRef.current = true;
      const orderResult = await sendAndConfirm(connection, signedBuy, orderBh, setStMsg, signal);
      dbg('buy:1', `order: ${orderResult.status} sig=${orderResult.sig}`);
      if (!orderPubkey) {
        setWarning('Order submitted. Check Positions tab.');
        setStep(3); setStMsg(''); onDone?.();
        setTimeout(() => onClose(), 3000);
        return;
      }
      setStMsg('Waiting for keeper…');
      const fillStatus = await pollOrderStatus(orderPubkey, { signal, onTick: (i, total) => setStMsg(`Keeper filling… (${i}/${total})`) });
      dbg('buy:2', `keeper: ${fillStatus}`);
      if (fillStatus === 'aborted') {
        setWarning('Order in flight. Check Positions tab.');
        setStep(3); setStMsg(''); onDone?.();
        setTimeout(() => onClose(), 3000);
        return;
      }
      if (fillStatus === 'failed') throw new Error('Order rejected by keeper.');
      setStep(3); setStMsg(''); onDone?.();
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      dbg('buy:error', e?.message || String(e));
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    } finally {
      onChainRef.current = false;
    }
  }, [publicKey, signTransaction, m, isYes, depositUsd, connection, onClose, onDone, sideLabel, dbg]);

  const presets = ['5', '10', '25', '50'];
  const rulesText = event.rulesText || event.closeCondition;
  const [showRules, setShowRules] = useState(false);
  const buttonLabel = busy ? (statusMsg || 'Working…')
    : step === 3 ? (warning ? '⚠ Check Positions' : '✓ Placed')
    : `Buy ${sideLabel} · $${depositUsd.toFixed(2)}`;

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg,${C.cardHi},${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{event.title}</div>
        {m.title && m.title !== event.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.hl, marginBottom: 8, ...T.body }}>{m.title}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ padding: '3px 8px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{sideLabel}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          {event.subcategory && <div style={{ fontSize: 9, color: C.hl, ...T.mono, fontWeight: 700, padding: '2px 6px', background: C.hlDim, borderRadius: 99 }}>{event.subcategory}</div>}
        </div>
        <PricePanel event={event} livePrices={livePrices || new Map()} compact={true} />
        {rulesText && (
          <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
            <button onClick={() => setShowRules(!showRules)} style={{ width: '100%', background: 'none', border: 'none', color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, ...T.mono }}>
              <span>RULES</span><span>{showRules ? '−' : '+'}</span>
            </button>
            {showRules && <div style={{ marginTop: 6, fontSize: 10, color: C.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', ...T.body }}>{rulesText}</div>}
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>Deposit amount (USDC)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 16, color: C.muted, fontWeight: 700, ...T.display }}>$</span>
            <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USD</span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
            {presets.map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={busy}
                style={{ flex: 1, padding: 6, borderRadius: 7, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: 'pointer', ...T.mono }}>
                ${v}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: 9, borderRadius: 10, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 10 }}>
          <Row label="Deposit" value={fmtUsd(depositUsd)} />
          <Row label="Our fee" value="None on buys" valueColor={C.yes} />
          <Row label="Est. contracts" value={`~${contractsEst.toFixed(2)}`} />
          <Row label={`If ${sideLabel} wins`} value={`~${fmtUsd(contractsEst)}`} valueColor={sideColor} bold />
          {formatEndDate(event.closeTime) && <Row label="Closes" value={formatEndDate(event.closeTime)} />}
        </div>
        {statusMsg && <StatusLine msg={statusMsg} />}
        {error && <ErrorLine msg={error} />}
        {warning && !error && <WarnLine msg={warning} />}
        <PrimaryButton onClick={canBuy ? placeOrder : undefined} disabled={!canBuy || step === 3} color={isYes ? 'yes' : 'no'} label={buttonLabel} />
        {busy && <CancelButton onClick={cancel} disabled={!canCancel} label={canCancel ? 'Cancel' : 'Cancel unavailable'} />}
        <DebugPanel log={debugLog} onClear={clearDbg} />
      </div>
    </div>
  );
}

// ── PositionsList + PositionCard ─────────────────────────────────────────────
function PositionsList({ positions, loading, onAction }) {
  if (loading) return <>{[1, 2, 3].map(i => <Skeleton key={i} />)}</>;
  if (positions.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
        No open positions yet.
        <div style={{ fontSize: 11, marginTop: 6, color: C.muted2 }}>Switch to Markets to place your first trade.</div>
      </div>
    );
  }
  return positions.map(p => <PositionCard key={p.positionPubkey} p={p} onAction={onAction} />);
}

function PositionCard({ p, onAction }) {
  const sideColor = p.isYes ? C.yes : C.no;
  const sideDim   = p.isYes ? C.yesDim : C.noDim;
  const isClaimable = p.claimable && !p.claimed;
  const isClaimed   = p.claimed;
  const isResolved  = p.marketStatus === 'settled' || p.marketStatus === 'resolved'
    || (p.marketResult && p.marketResult !== 'pending' && p.marketResult !== '');
  const lostResolved = isResolved && !isClaimable && !isClaimed;
  const closedNoExit = p.exitPrice == null && !isResolved;
  const pnl = p.pnlUsd;                                                // may be null
  const pnlColor = pnl == null ? C.muted : (pnl >= 0 ? C.yes : C.no);
  return (
    <div style={{ padding: 10, borderRadius: 14, background: `linear-gradient(145deg,${C.card},${C.cardHi})`, border: `1px solid ${lostResolved ? 'rgba(255,95,122,.20)' : isClaimable ? 'rgba(0,212,163,.30)' : C.border}`, marginBottom: 7, boxShadow: C.shadow, opacity: lostResolved || isClaimed ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 4, ...T.body }}>{p.title}</div>
          {p.outcomeLabel && p.outcomeLabel !== p.title && <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, ...T.mono }}>{p.outcomeLabel}</div>}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, ...T.mono }}>{p.isYes ? 'YES' : 'NO'}</div>
            {isClaimable && <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: C.yesDim, border: `1px solid ${C.yes}55`, color: C.yes, fontSize: 9, fontWeight: 800, ...T.mono }}>WON</div>}
            {lostResolved && <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: C.noDim, border: `1px solid ${C.no}55`, color: C.no, fontSize: 9, fontWeight: 800, ...T.mono }}>LOST</div>}
            {isClaimed && <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 800, ...T.mono }}>CLAIMED</div>}
            {closedNoExit && <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'rgba(245,181,61,.10)', border: `1px solid ${C.amber}55`, color: C.amber, fontSize: 9, fontWeight: 800, ...T.mono }}>AWAITING</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>{p.valueUsd == null ? '—' : fmtUsd(p.valueUsd)}</div>
          {pnl != null && (
            <div style={{ fontSize: 10, color: pnlColor, fontWeight: 700, ...T.mono, marginTop: 2 }}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{(p.pnlUsdPercent ?? 0).toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.02)', marginBottom: 8, ...T.mono, fontSize: 10 }}>
        <Row label="Contracts" value={`${p.contracts.toFixed(2)} @ $${p.avgPriceUsd.toFixed(3)}`} />
        <Row label="Exit price" value={p.exitPrice == null ? '—' : `$${p.exitPrice.toFixed(3)}`} />
        {isClaimable && <Row label="Payout" value={fmtUsd(p.payoutUsd)} valueColor={C.yes} bold />}
      </div>
      {isClaimable ? (
        <PrimaryButton onClick={() => onAction('claim', p)} color="yes" label={`Claim ${fmtUsd(p.payoutUsd)}`} />
      ) : isClaimed ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, fontWeight: 600, padding: 8, ...T.mono }}>✓ Claimed {fmtUsd(p.payoutUsd)}</div>
      ) : lostResolved ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.no, fontWeight: 700, padding: 8, ...T.mono }}>Lost · −{fmtUsd(p.costUsd)}</div>
      ) : closedNoExit ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.amber, fontWeight: 700, padding: 8, ...T.mono }}>Market closed — awaiting settlement</div>
      ) : (
        <button onClick={() => onAction('sell', p)}
          style={{ width: '100%', padding: 9, borderRadius: 10, background: (pnl ?? 0) >= 0 ? `linear-gradient(135deg,${C.yes}22,${C.yes}11)` : `linear-gradient(135deg,${C.no}22,${C.no}11)`, border: `1px solid ${(pnl ?? 0) >= 0 ? C.yes : C.no}55`, color: (pnl ?? 0) >= 0 ? C.yes : C.no, fontSize: 12, fontWeight: 700, cursor: 'pointer', ...T.body }}>
          Sell · {p.valueUsd == null ? '—' : fmtUsd(p.valueUsd)}
        </button>
      )}
    </div>
  );
}

// ── SellOrClaimDrawer (1 sig — Predict tx + our 5% SPL fee transfer) ─────────
function SellOrClaimDrawer({ position, kind, onClose, onDone, connection }) {
  const { publicKey, signTransaction } = useWallet();
  const [step, setStep] = useState(0);
  const [statusMsg, setStMsg] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const { log: debugLog, push: dbg, clear: clearDbg } = useDebugLog();
  const abortRef = useRef(null);
  const onChainRef = useRef(false);
  useBodyLock(true);

  const isClaim = kind === 'claim';
  const busy = step > 0 && step < 3;
  const canCancel = busy && !onChainRef.current;
  const cancel = useCallback(() => {
    if (!canCancel) return;
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    setStep(0); setStMsg(''); setError('Cancelled.');
  }, [canCancel]);

  // For sell, gross = current exit value. For claim, gross = $1 × contracts.
  const grossUsd = isClaim
    ? position.payoutUsd
    : (position.valueUsd != null ? position.valueUsd : (position.exitPrice != null ? position.contracts * position.exitPrice : 0));
  const feeUsd = grossUsd * (FEE_BPS / 10000);
  const netUsd = grossUsd - feeUsd;

  const handleAction = useCallback(async () => {
    if (!publicKey || !signTransaction) { setError('Connect a wallet.'); return; }
    if (!isClaim && (grossUsd == null || grossUsd <= 0)) { setError('No exit value available.'); return; }
    dbg(`${kind}:start`, `position=${position.positionPubkey}`);
    setError(''); setWarning(''); onChainRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const checkAbort = () => { if (signal.aborted) throw new Error('Cancelled.'); };
    let warned = false;
    try {
      const ownerB58 = publicKey.toBase58();
      setStep(1); setStMsg(`Building ${isClaim ? 'claim' : 'sell'}…`);

      // Jupiter docs: sell = DELETE /positions/{pubkey}, claim = POST /positions/{pubkey}/claim
      const url = isClaim
        ? `/api/predict/positions/${encodeURIComponent(position.positionPubkey)}/claim`
        : `/api/predict/positions/${encodeURIComponent(position.positionPubkey)}`;
      const method = isClaim ? 'POST' : 'DELETE';
      const request = await loggedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerPubkey: ownerB58 }),
        signal,
      }, dbg, `predict-${kind}`);
      checkAbort();
      const j = request.json;
      if (!j?.transaction) throw new Error(`No ${kind} transaction returned.`);

      // The Predict tx already has its own blockhash + ALTs. We append our fee transfer
      // to it without disturbing anything else (no Jupiter swap, no extra route accounts).
      const predictVtx = VersionedTransaction.deserialize(b64ToBytes(j.transaction));
      const feeAtomic = BigInt(Math.max(0, Math.round(feeUsd * 1e6)));
      dbg(`${kind}:fee`, `5% fee = ${(Number(feeAtomic) / 1e6).toFixed(6)} USDC`);

      let finalTx = predictVtx;
      let blockhashInfo = j.blockhash
        ? { blockhash: j.blockhash, lastValidBlockHeight: j.lastValidBlockHeight }
        : (j.txMeta?.blockhash ? { blockhash: j.txMeta.blockhash, lastValidBlockHeight: j.txMeta.lastValidBlockHeight } : null);

      if (feeAtomic > 0n) {
        setStMsg('Adding service fee…');
        const feeIxs = buildFeeTransferIxs({ ownerPubkey: publicKey, feeAtomic });
        try {
          finalTx = await appendIxToVtx({ connection, vtx: predictVtx, extraIxs: feeIxs });
          dbg(`${kind}:tx`, 'Predict ix + 5% fee transfer appended');
        } catch (appendErr) {
          // If ALT resolution fails for any reason, we'd rather take the sell/claim
          // without our fee than block the user from their funds. Fail soft.
          dbg(`${kind}:fee-skip`, appendErr?.message || String(appendErr));
          finalTx = predictVtx;
          warned = true;
          setWarning('Could not attach service fee; processing without it.');
        }
      }
      checkAbort();

      setStMsg(`Confirm — ${isClaim ? 'Claim' : 'Sell'}`);
      const signed = await signTransaction(finalTx);
      onChainRef.current = true;
      const result = await sendAndConfirm(connection, signed, blockhashInfo, setStMsg, signal);
      dbg(`${kind}:done`, `${result.status} sig=${result.sig}`);

      if (result.status === 'pending') {
        warned = true;
        setWarning(`Submitted (${result.sig.slice(0, 12)}…) — funds will appear shortly.`);
      }
      setStep(3); setStMsg(''); onDone?.();
      setTimeout(() => onClose(), warned ? 4000 : 1500);
    } catch (e) {
      dbg(`${kind}:error`, e?.message || String(e));
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    } finally {
      onChainRef.current = false;
    }
  }, [publicKey, signTransaction, position, isClaim, kind, grossUsd, feeUsd, connection, onDone, onClose, dbg]);

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg,${C.cardHi},${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        {isClaim && <div style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: C.yesDim, border: `1px solid ${C.yes}55`, color: C.yes, fontSize: 9, fontWeight: 800, marginBottom: 6, ...T.mono }}>🏆 YOU WON</div>}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, ...T.body }}>{position.title}</div>
        <div style={{ padding: 10, borderRadius: 10, background: isClaim ? 'rgba(0,212,163,.05)' : 'rgba(255,255,255,.02)', border: isClaim ? '1px solid rgba(0,212,163,.20)' : `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 11 }}>
          <Row label="Contracts" value={position.contracts.toFixed(2)} />
          {!isClaim && <Row label="Exit price" value={position.exitPrice == null ? '—' : `$${position.exitPrice.toFixed(3)}`} />}
          <Row label={isClaim ? 'Payout' : 'Sell value'} value={fmtUsd(grossUsd)} />
          <Row label="Service fee (5%)" value={fmtUsd(feeUsd)} />
          <Row label="You receive" value={`~${fmtUsd(netUsd)} USDC`} valueColor={C.hl} bold />
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 9 }}>
            One signature — {isClaim ? 'claim' : 'sell'} from Jupiter + 5% fee transfer.
          </div>
        </div>
        {statusMsg && <StatusLine msg={statusMsg} />}
        {error && <ErrorLine msg={error} />}
        {warning && !error && <WarnLine msg={warning} />}
        <PrimaryButton onClick={busy ? undefined : handleAction} disabled={busy || step === 3 || (!isClaim && grossUsd <= 0)} color={isClaim || (position.pnlUsd ?? 0) >= 0 ? 'yes' : 'no'}
          label={busy ? (statusMsg || 'Working…') : step === 3 ? `✓ ${isClaim ? 'Claimed' : 'Sold'}` : isClaim ? `Claim · ${fmtUsd(grossUsd)}` : `Sell · ${fmtUsd(grossUsd)}`} />
        {busy && <CancelButton onClick={cancel} disabled={!canCancel} label={canCancel ? 'Cancel' : 'Cannot cancel'} />}
        <DebugPanel log={debugLog} onClear={clearDbg} />
      </div>
    </div>
  );
}

// ── Top-level Predict page ───────────────────────────────────────────────────
export default function Predict() {
  const { publicKey, connected, signTransaction } = useWallet();
  const [tab, setTab] = useState('markets');
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState([]);
  const [evLoading, setEvLoading] = useState(true);
  const [evError, setEvError] = useState(null);
  const [positions, setPositions] = useState([]);
  const [posLoading, setPosLoading] = useState(false);
  const [solBal, setSolBal] = useState(0n);
  const [buyState, setBuyState] = useState(null);
  const [actionPos, setActionPos] = useState(null);
  const [toast, setToast] = useState('');
  const [showAccessFee, setShowAccessFee] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [pendingTrade, setPendingTrade] = useState(null);

  // Collect every symbol we need a live price for, then poll Jupiter Price API once.
  const liveSymbols = useMemo(() => {
    const out = new Set();
    for (const e of events) {
      const s = symbolFromSubcategory(e.subcategory) || symbolFromTitle(e.title);
      if (s) out.add(s);
    }
    return Array.from(out);
  }, [events]);
  const livePrices = useLiveJupPrices(tab === 'markets', liveSymbols);

  const connection = useMemo(() => {
    const o = (typeof window !== 'undefined' && window.location?.origin) || '';
    return new Connection(o + SOL_RPC, 'confirmed');
  }, []);

  useEffect(() => {
    if (!publicKey) { setAccessGranted(false); setShowAccessFee(false); return; }
    const b58 = publicKey.toBase58();
    if (b58 === FEE_WALLET_B58 || hasValidAccessFee(b58)) setAccessGranted(true);
    else setAccessGranted(false);
  }, [publicKey]);

  const handleTrade = (event, isYes) => {
    if (!connected) { setToast('Connect wallet first'); setTimeout(() => setToast(''), 1500); return; }
    if (!accessGranted) {
      setPendingTrade({ event, isYes });
      setShowAccessFee(true);
      return;
    }
    setBuyState({ event, isYes });
  };

  const onAccessPaid = useCallback(() => {
    setAccessGranted(true);
    setShowAccessFee(false);
    if (pendingTrade) { setBuyState(pendingTrade); setPendingTrade(null); }
  }, [pendingTrade]);
  const onAccessDismiss = useCallback(() => { setShowAccessFee(false); setPendingTrade(null); }, []);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) { setSolBal(0n); return; }
    setSolBal(await fetchSolBalance(connection, publicKey.toBase58()));
  }, [publicKey, connection]);

  useEffect(() => {
    if (!publicKey) { setSolBal(0n); return; }
    let alive = true;
    const tick = async () => {
      const s = await fetchSolBalance(connection, publicKey.toBase58());
      if (alive) setSolBal(s);
    };
    tick();
    const id = setInterval(tick, 300_000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection]);

  const reloadEvents = useCallback(async () => {
    try {
      setEvError(null);
      const raw = await fetchEvents();
      const normalized = raw
        .map(ev => { try { return pickEventFields(ev); } catch { return null; } })
        .filter(Boolean)
        .filter(isMarketOpen);
      setEvents(normalized);
    } catch (e) {
      setEvError(friendlyError(e));
    } finally {
      setEvLoading(false);
    }
  }, []);

  useEffect(() => { setEvLoading(true); reloadEvents(); }, [reloadEvents]);

  useEffect(() => {
    const hasUrgent = events.some(e => { const ms = toMs(e.closeTime); return ms && ms - Date.now() < URGENT_WINDOW_MS && ms > Date.now(); });
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (buyState || actionPos) return;
      reloadEvents();
    };
    const id = setInterval(tick, hasUrgent ? REFRESH_URGENT_MS : REFRESH_NORMAL_MS);
    return () => clearInterval(id);
  }, [reloadEvents, buyState, actionPos, events]);

  const reloadPositions = useCallback(async () => {
    if (!publicKey) { setPositions([]); return; }
    setPosLoading(true);
    try {
      const r = await fetch(`/api/predict/positions?ownerPubkey=${encodeURIComponent(publicKey.toBase58())}`);
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      if (!r.ok) { setPositions([]); return; }
      const raw = Array.isArray(j) ? j : (j?.data || j?.positions || []);
      setPositions(raw.map(pickPositionFields).filter(Boolean));
    } catch { setPositions([]); }
    finally { setPosLoading(false); }
  }, [publicKey]);

  useEffect(() => {
    if (tab !== 'positions' || !publicKey) return;
    reloadPositions();
    const id = setInterval(reloadPositions, 300_000);
    return () => clearInterval(id);
  }, [tab, publicKey, reloadPositions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = events.filter(isMarketOpen);
    if (q) r = r.filter(e => [e.title, e.market?.title, e.subcategory, ...(e.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
    const now = Date.now();
    r.sort((a, b) => {
      const ta = toMs(a.closeTime); const tb = toMs(b.closeTime);
      return ((ta ? ta - now : Infinity) - (tb ? tb - now : Infinity));
    });
    return r;
  }, [events, search]);

  const handleCopyAddr = useCallback(async () => {
    if (!publicKey) return;
    if (await copyToClipboard(publicKey.toBase58())) {
      setToast('Copied');
      setTimeout(() => setToast(''), 1500);
    }
  }, [publicKey]);

  return (
    <>
      <style>{`@keyframes nexus-spin{to{transform:rotate(360deg);}}`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink }}>
        <PageHeader connected={connected} solBal={solBal} tab={tab} setTab={setTab} pubkey={publicKey?.toBase58()} onCopy={handleCopyAddr} />
        {toast && <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 8, fontSize: 11, color: C.yes, textAlign: 'center', fontWeight: 700, ...T.mono }}>{toast}</div>}
        {tab === 'markets' && (
          <>
            <div style={{ marginBottom: 10, position: 'relative' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…" inputMode="search"
                style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontSize: 12, outline: 'none', ...T.body }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            {evLoading && [1, 2, 3, 4].map(i => <Skeleton key={i} />)}
            {evError && <ErrorLine msg={evError} />}
            {!evLoading && !evError && filtered.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
                {search ? `No markets match "${search}"` : 'No live crypto markets right now.'}
              </div>
            )}
            {!evLoading && filtered.map(ev => <MarketCard key={ev.eventId} event={ev} livePrices={livePrices} onTrade={handleTrade} />)}
          </>
        )}
        {tab === 'positions' && (
          <PositionsList positions={positions} loading={posLoading}
            onAction={(kind, p) => {
              if (!accessGranted) { setShowAccessFee(true); return; }
              setActionPos({ kind, position: p });
            }} />
        )}
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 9, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Jupiter Predict · $1.99/day access · 5% fee on sell & claim
        </div>
      </div>
      {showAccessFee && publicKey && (
        <AccessFeeModal onPaid={onAccessPaid} onDismiss={onAccessDismiss} connection={connection} publicKey={publicKey} signTransaction={signTransaction} />
      )}
      {buyState && accessGranted && (
        <BuyDrawer event={buyState.event} isYes={buyState.isYes} livePrices={livePrices}
          onClose={() => setBuyState(null)}
          onDone={() => { reloadEvents(); reloadPositions(); refreshBalances(); }}
          connection={connection} />
      )}
      {actionPos && accessGranted && (
        <SellOrClaimDrawer position={actionPos.position} kind={actionPos.kind}
          onClose={() => setActionPos(null)}
          onDone={() => { reloadPositions(); refreshBalances(); }}
          connection={connection} />
      )}
    </>
  );
}
