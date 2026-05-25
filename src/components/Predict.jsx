// Predict.jsx — Jupiter Prediction Markets on Solana.
//
// Spec: https://dev.jup.ag/docs/prediction
// Get Events: https://dev.jup.ag/docs/api-reference/prediction/get-events
//
// ─── FLOW ────────────────────────────────────────────────────────────────────
// BUY (SOL only, two signatures):
//   Sig 1 — ATOMIC: SOL fee → FEE_WALLET + SOL → JupUSD swap (one tx)
//   Sig 2 — Jupiter Predict order with JupUSD deposit (sealed tx from /orders)
//
// SELL / CLAIM (two signatures):
//   Sig 1 — Sell or claim tx from Jupiter Predict (sealed)
//   Sig 2 — ATOMIC: JupUSD fee → FEE_WALLET + JupUSD → SOL swap (one tx)
//
// ─── FEE MODEL ──────────────────────────────────────────────────────────────
// 5% fee on every swap leg, taken in input mint, manual transfer composed
// into the swap tx. Same pattern as Swap.jsx widget.
//
// ─── MARKETS ────────────────────────────────────────────────────────────────
// Live crypto only. Sorted client-side by closeTime ascending. Auto-refresh
// every 5 min, 30s when anything closes within 15 min.
//
// ─── DATA SHAPE (from API spec) ─────────────────────────────────────────────
// Event:   eventId, isActive, isLive, category, subcategory, volumeUsd,
//          closeCondition, beginAt, rulesPdf, tags[]
// Event metadata: title, subtitle, slug, series, closeTime, imageUrl, isLive
// Market:  marketId, openTime, closeTime, resolveAt, marketResultPubkey,
//          imageUrl
// Market metadata: title (the prediction question), status, result,
//          rulesPrimary, rulesSecondary, isTeamMarket
// Market pricing: buyYesPriceUsd, buyNoPriceUsd, sellYesPriceUsd,
//          sellNoPriceUsd, volume (all in micro-USD, ÷1e6 = $)

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Buffer } from 'buffer';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection, PublicKey, VersionedTransaction, TransactionMessage,
  SystemProgram, AddressLookupTableAccount, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────
const SOL_MINT      = 'So11111111111111111111111111111111111111112';
const JUPUSD_MINT   = 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD';
const FEE_WALLET_B58 = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const FEE_WALLET    = new PublicKey(FEE_WALLET_B58);
const FEE_BPS       = 500;
const SLIPPAGE_BPS  = 1000;
const SOL_RPC       = '/api/solana-rpc';
const MIN_TRADE_USD = 1;
const NAV_CLEARANCE = 120;
const JUPUSD_DECIMALS = 6;
const SOL_DECIMALS    = 9;

// Priority fee paid per compute unit. The Jupiter /build response already
// includes a computeUnitPrice instruction in computeBudgetInstructions, but
// we override it with our own value to make sure short-lived market orders
// land before they close. 2.8M microlamports = roughly 0.0028 lamports per CU,
// which is a healthy bid in normal network conditions.
const PRIORITY_FEE_MICROLAMPORTS = 2_800_000;

// Compute unit limit. Per dev.jup.ag/docs/swap/build, /build returns a
// CU price instruction but NOT a CU limit. The Solana runtime defaults to
// ~200k when no limit is set, which is too low for complex Jupiter routes.
//
// We follow Jupiter's recommended pattern: build the tx with CU_LIMIT_MAX,
// simulate, then rebuild with 1.2x the simulated value (capped at the max).
// This keeps the priority fee accurate to what we actually consume.
const CU_LIMIT_MAX      = 1_400_000;   // Solana hard cap
const CU_LIMIT_FALLBACK = 600_000;     // used when simulation fails
const CU_BUFFER_PERCENT = 120;         // 1.2x simulated value

const REFRESH_NORMAL_MS = 300_000;
const REFRESH_URGENT_MS = 30_000;
const URGENT_WINDOW_MS  = 15 * 60_000;

// ─── Polymarket integration ─────────────────────────────────────────────────
// Polymarket is Jupiter's upstream provider. Their public Gamma API gives us
// the full description text (which states the starting price for short
// up/down markets), the outcome labels, and group thresholds. Their RTDS
// WebSocket streams live Chainlink oracle prices — the same feed used for
// settlement, so the "current price" we show matches what the market resolves
// against.
const POLY_GAMMA_BASE = 'https://gamma-api.polymarket.com';
const POLY_RTDS_WSS   = 'wss://ws-live-data.polymarket.com';
const POLY_RTDS_TOPIC = 'crypto_prices_chainlink';
const POLY_RTDS_PING_MS = 5000;     // docs: send PING every 5 seconds
// Price-to-beat is fetched through this app's proxy at
// /api/polymarket/price-to-beat/{slug} which forwards to
// https://polymarket.com/api/equity/price-to-beat/{slug} (CORS-blocked
// from the browser, so it must go through the backend).

// Extract the reference price from a Polymarket market description.
//
// Polymarket's up/down crypto markets explicitly state the reference value
// using consistent phrasing — every market page reads "above or below the
// opening 'Price to Beat' of $X". We match every form of that phrasing
// (and similar: "starting price", "opening price", "above $X", "hit $X",
// "reaches $X", "crosses $X"). If none match, we return null rather than
// guessing — descriptions often contain unrelated numbers like "resolve
// 50-50" that fallback heuristics would wrongly pick up.
function extractStartingPrice(text) {
  if (!text || typeof text !== 'string') return null;
  const parseNum = (raw) => {
    if (!raw) return null;
    const n = Number(String(raw).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : null;
  };

  // Patterns Polymarket actually uses, in order of specificity.
  const patterns = [
    /price\s+to\s+beat[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i,
    /opening\s+price[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i,
    /starting\s+price[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i,
    /reference\s+price[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i,
    /strike\s+price[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i,
    /open(?:s|ed)?\s+at[^0-9$]{0,30}\$?\s*([0-9][0-9.,]*)/i,
    /above\s+\$?\s*([0-9][0-9.,]*)/i,
    /below\s+\$?\s*([0-9][0-9.,]*)/i,
    /hit(?:s|ting)?\s+\$?\s*([0-9][0-9.,]*)/i,
    /reach(?:es|ed|ing)?\s+\$?\s*([0-9][0-9.,]*)/i,
    /cross(?:es|ed|ing)?\s+\$?\s*([0-9][0-9.,]*)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseNum(m[1]);
      if (n != null) return n;
    }
  }

  // No fallback. Polymarket descriptions routinely contain phrases like
  // "the market will resolve 50-50" or "55-45 in favor of No" — picking the
  // largest number in the text catches those and produces "50" for every
  // market that doesn't have an explicit Price-to-Beat phrase. Better to
  // return null and let the caller skip the price strip entirely.
  return null;
}

// ─── Opening-price snapshots ─────────────────────────────────────────────────
// Polymarket's /api/equity/price-to-beat endpoint is for stocks/forex/oil
// (the "equity_prices" feed). It returns 404 for crypto markets, which use
// the separate "crypto_prices_chainlink" feed and do NOT publish a public
// price-to-beat URL.
//
// Workaround: snapshot the live Chainlink price for the relevant symbol the
// first time we see an open market, key it by marketId, and persist in
// localStorage. From then on we use that snapshot as the "price to beat"
// for the SPREAD column. This isn't pixel-perfect — the snapshot is taken
// whenever the user happens to load the page, not at the exact market
// openTime — but it's the best signal available client-side and matches
// the asset feed Polymarket actually settles on.
//
// Snapshots are pruned after 24h so storage doesn't grow forever.
const SNAPSHOT_KEY = 'verixia.predict.priceSnapshots.v1';
const SNAPSHOT_TTL_MS = 24 * 60 * 60_000;

function loadSnapshots() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(SNAPSHOT_KEY) : null;
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const now = Date.now();
    let mutated = false;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (!v || typeof v.takenAt !== 'number' || now - v.takenAt > SNAPSHOT_TTL_MS) {
        delete obj[k];
        mutated = true;
      }
    }
    if (mutated) {
      try { window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(obj)); } catch {}
    }
    return obj;
  } catch {
    return {};
  }
}

function saveSnapshots(obj) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(obj));
  } catch {}
}

// Walk every visible up/down market, find its Chainlink symbol, and store
// the current live price keyed by marketId if we don't already have one.
// Called as a side-effect after events + live prices are both available.
function usePriceSnapshots(events, livePrices) {
  const [snapshots, setSnapshots] = useState(() => loadSnapshots());

  useEffect(() => {
    if (!Array.isArray(events) || events.length === 0) return;
    if (!livePrices || livePrices.size === 0) return;

    let next = snapshots;
    let mutated = false;
    for (const ev of events) {
      const m = ev?.market;
      const id = m?.marketId;
      if (!id) continue;
      if (next[id]) continue;                          // already snapshotted
      if (!isUpDownMarket(ev)) continue;               // not an up/down market
      const sym = symbolFromSubcategory(ev.subcategory);
      if (!sym) continue;
      const live = livePrices.get(sym);
      if (!live || !Number.isFinite(live.value) || live.value <= 0) continue;
      if (!mutated) { next = { ...snapshots }; mutated = true; }
      next[id] = { price: live.value, symbol: sym, takenAt: Date.now() };
    }
    if (mutated) {
      setSnapshots(next);
      saveSnapshots(next);
    }
  }, [events, livePrices, snapshots]);

  return snapshots;
}

// True iff this looks like an up/down market — i.e., one where the user is
// betting whether the asset's price will be higher or lower than an opening
// reference at the close of a fixed window. For these markets, comparing
// reference vs live spot is meaningful. For threshold markets ("Will BTC
// hit $150k by Dec 31"), it isn't: the threshold is a future target, not
// an opening reference, so subtracting live spot from it is misleading.
function isUpDownMarket(event) {
  if (!event) return false;
  const haystack = [
    event.title,
    event.market?.title,
    event.poly?.description,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return false;
  // Polymarket up/down markets always have these exact phrases.
  if (haystack.includes('up or down')) return true;
  if (haystack.includes('price to beat')) return true;
  // Outcome labels are another tell — Up/Down rather than Yes/No.
  const outcomes = event.poly?.outcomes;
  if (Array.isArray(outcomes)) {
    const set = outcomes.map(o => String(o).toLowerCase());
    if (set.includes('up') && set.includes('down')) return true;
  }
  return false;
}

// Resolve the reference price ("Price to Beat") for an up/down market.
// Strictly only returns a number for up/down markets — threshold markets
// like "Will BTC hit $150k by Dec 31" return null because $150k is a future
// target, not an opening reference, and comparing it to live spot would be
// misleading.
//
// For an up/down market, sources in order:
//   1. Opening-price snapshot (live Chainlink price captured when we first
//      observed this market — see usePriceSnapshots).
//   2. Parsing "Price to Beat" / "opening price" phrases out of the
//      Polymarket description (explicit phrase required — we do NOT fall
//      back to "the largest number in the text" because that picks up
//      unrelated figures and produces wildly wrong references).
function resolvePriceToBeat(event, snapshots) {
  if (!event) return null;
  if (!isUpDownMarket(event)) return null;
  // 1. Local snapshot — most reliable for crypto markets.
  const marketId = event.market?.marketId;
  if (marketId && snapshots && snapshots[marketId]) {
    const snap = snapshots[marketId];
    if (snap && Number.isFinite(snap.price) && snap.price > 0) return snap.price;
  }
  // 2. Description-extracted starting price (rare but happens).
  const poly = event.poly || null;
  if (poly?.startingPrice != null && Number.isFinite(poly.startingPrice) && poly.startingPrice > 0) {
    return poly.startingPrice;
  }
  if (poly?.description) {
    const m = poly.description.match(/price\s+to\s+beat[^0-9$]{0,40}\$?\s*([0-9][0-9.,]*)/i);
    if (m) {
      const n = Number(String(m[1]).replace(/[$,\s]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// For threshold markets ("Will BTC hit $150k by Dec 31"), the threshold is
// already surfaced via the `groupItemTitle` chip in the card and drawer.
// We deliberately do NOT compare it against live spot — that would be
// misleading, since $150k is a future target, not an opening reference.

// Map a subcategory tag like "BTC" or "Bitcoin" to a Chainlink RTDS symbol
// like "btc/usd". Returns null for unmapped assets so we show '—' rather
// than risk a wrong NOW price.
//
// Polymarket's docs (docs.polymarket.com/market-data/websocket/rtds) only
// formally list btc/usd, eth/usd, sol/usd, xrp/usd as supported Chainlink
// symbols, but live observation has confirmed doge/usd, bnb/usd, hype/usd
// stream as well. We include the latter three with a note that if Polymarket
// removes them silently, the NOW column will go blank for those markets —
// which is the safe failure mode.
function symbolFromSubcategory(sub) {
  if (!sub) return null;
  const s = String(sub).toLowerCase().trim();
  const map = {
    // Documented in RTDS spec
    bitcoin: 'btc/usd', btc: 'btc/usd',
    ethereum: 'eth/usd', eth: 'eth/usd',
    solana: 'sol/usd', sol: 'sol/usd',
    ripple: 'xrp/usd', xrp: 'xrp/usd',
    // Observed live on Polymarket Chainlink stream (not in their public docs).
    // If these stop emitting, the NOW column will gracefully show '—'.
    dogecoin: 'doge/usd', doge: 'doge/usd',
    binancecoin: 'bnb/usd', bnb: 'bnb/usd',
    hyperliquid: 'hype/usd', hype: 'hype/usd',
  };
  return map[s] || null;
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function toUsd(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n / 1e6;
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)   return '$' + n.toFixed(d);
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
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}
function formatEndDate(closeTime) {
  const ms = toMs(closeTime);
  if (ms == null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return 'Closed';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m left`;
  if (diff < 24 * 60 * 60_000) {
    const h  = Math.floor(diff / 3_600_000);
    const mm = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${mm}m left`;
  }
  const d   = new Date(ms);
  const mo  = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  return `Ends ${mo} ${day}`;
}

function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function jfetch(url, opts = {}, ms = 15000) {
  const maxAttempts = 4;
  let attempt = 0;
  while (true) {
    attempt++;
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: c.signal });
      if (r.status === 429 && attempt < maxAttempts) {
        const ra = Number(r.headers.get('retry-after'));
        const wait = Number.isFinite(ra) && ra > 0
          ? ra * 1000
          : Math.min(8000, 600 * 2 ** (attempt - 1)) + Math.random() * 250;
        clearTimeout(id);
        await new Promise(res => setTimeout(res, wait));
        continue;
      }
      if (!r.ok) {
        let body = '';
        try { body = await r.text(); } catch {}
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
  const status = err?.status;
  // Per Jupiter Predict docs (developers.jup.ag/docs/prediction), US and South
  // Korean IPs are blocked from the Prediction Market API. Detect and surface
  // a clearer message.
  if (status === 451 || status === 403 || m.includes('geographic') || m.includes('region') || m.includes('forbidden region') || m.includes('not available in your'))
    return 'Predict is not available in your region (US / South Korea blocked by Jupiter).';
  if (status === 429 || m.includes('too many requests') || m.includes('slow down'))
    return 'Rate limited. Wait a few seconds and try again.';
  if (m.includes('insufficient'))      return 'Insufficient balance.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled') || m.includes('cancel'))
    return 'Cancelled.';
  if (m.includes('simulation failed')) return 'Simulation failed — the price may have moved.';
  if (m.includes('no route'))          return 'No swap route available right now.';
  if (m.includes('too large'))         return 'Transaction too complex. Try a smaller amount.';
  return err?.message || 'Something went wrong. Please try again.';
}

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Solana balances
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchSolBalance(connection, ownerB58) {
  try {
    const lamports = await connection.getBalance(new PublicKey(ownerB58), 'confirmed');
    return BigInt(lamports);
  } catch { return 0n; }
}

async function fetchJupUsdBalance(connection, ownerB58) {
  try {
    const owner = new PublicKey(ownerB58);
    const ata   = getAssociatedTokenAddressSync(new PublicKey(JUPUSD_MINT), owner);
    const bal   = await connection.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(bal.value.amount || 0);
  } catch { return 0n; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Jupiter Predict API + normalizers
// ═══════════════════════════════════════════════════════════════════════════════

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

async function fetchPositions(ownerB58) {
  if (!ownerB58) return [];
  try {
    const r = await jfetch(`/api/predict/positions?ownerPubkey=${encodeURIComponent(ownerB58)}`);
    const j = await r.json();
    return Array.isArray(j) ? j : (j?.data || j?.positions || []);
  } catch { return []; }
}

// Normalize an event from the Jupiter /events response. Captures every
// field documented in the API spec so the UI can surface what the user
// needs to understand the prediction.
function pickEventFields(ev) {
  if (!ev) return null;
  const market = (ev.markets && ev.markets[0]) || ev.market || null;
  if (!market) return null;

  const pricing = market.pricing || {};
  const yesPrice = toUsd(pricing.buyYesPriceUsd);
  let   noPrice  = toUsd(pricing.buyNoPriceUsd);
  if (!noPrice && yesPrice) noPrice = +(1 - yesPrice).toFixed(4);

  const evMeta  = ev.metadata || {};
  const mktMeta = market.metadata || {};

  // Event title = broad topic. Market title = the actual YES/NO question.
  const eventTitle  = ev.title || evMeta.title || 'Untitled';
  const marketTitle = mktMeta.title || market.title || null;

  const image = evMeta.imageUrl || ev.imageUrl || market.imageUrl || ev.image || null;

  return {
    // — Event identification —
    eventId:     ev.eventId || ev.id,
    title:       eventTitle,
    subtitle:    evMeta.subtitle || null,
    slug:        evMeta.slug || null,
    image,

    // — Classification —
    category:    String(ev.category || '').toLowerCase(),
    subcategory: ev.subcategory || null,
    series:      evMeta.series || ev.series || null,
    tags:        Array.isArray(ev.tags) ? ev.tags.filter(Boolean) : [],

    // — Resolution —
    closeCondition: ev.closeCondition || null,
    rulesPdf:       ev.rulesPdf || null,

    // — Timing —
    closeTime: evMeta.closeTime ?? mktMeta.closeTime ?? market.closeTime ?? ev.closeTime ?? null,
    beginAt:   ev.beginAt || null,

    // — Stats —
    volume24h: toUsd(ev.volumeUsd ?? pricing.volume ?? 0),
    isLive:    ev.isLive !== false,
    isActive:  ev.isActive !== false,

    // — Market —
    market: {
      marketId:    market.marketId || market.id,
      title:       marketTitle,
      subtitle:    mktMeta.subtitle || null,
      description: mktMeta.description || null,
      rulesPrimary:   mktMeta.rulesPrimary || null,
      rulesSecondary: mktMeta.rulesSecondary || null,
      status:      mktMeta.status || market.status || 'open',
      result:      mktMeta.result || market.result || null,
      isTeamMarket:!!mktMeta.isTeamMarket,
      openTime:    market.openTime || mktMeta.openTime || null,
      closeTime:   market.closeTime || mktMeta.closeTime || null,
      resolveAt:   market.resolveAt || null,
      resultPubkey:market.marketResultPubkey || null,

      yesPrice, noPrice,
      sellYesPrice: toUsd(pricing.sellYesPriceUsd),
      sellNoPrice:  toUsd(pricing.sellNoPriceUsd),
      volume:       toUsd(pricing.volume || 0),

      yesPct: Math.max(0, Math.min(99, Math.round(yesPrice * 100))),
      noPct:  Math.max(0, Math.min(99, Math.round(noPrice  * 100))),
    },
  };
}

// ─── Open-market filter ──────────────────────────────────────────────────────
// Per Jupiter Predict docs, market.status can be: open | closed | settled |
// cancelled. We only want 'open' for trading. Jupiter's filter=live param
// only means the event has begun — it does NOT mean the market is still
// tradeable. So we check every signal locally and drop anything that's
// settled, cancelled, past close, or already has a YES/NO result.
function isMarketOpen(event) {
  if (!event) return false;
  if (event.isActive === false) return false;
  if (event.isLive === false)   return false;
  const m = event.market;
  if (!m) return false;
  if (m.status && m.status !== 'open') return false;     // closed | settled | cancelled
  if (m.result && m.result !== 'pending' && m.result !== '') return false;  // 'yes' or 'no' → settled
  const ms = toMs(event.closeTime);
  if (ms != null && ms <= Date.now()) return false;
  return true;
}

// ─── Polymarket Gamma supplement ─────────────────────────────────────────────
// Jupiter passes Polymarket data through but strips the long-form description,
// outcome labels, group thresholds, and short-window price changes. We hit
// gamma-api.polymarket.com directly by slug to fill those gaps so users can
// actually see what they're betting on.
//
// One batched fetch per page load. Result cached by slug for the refresh
// cycle. Failures are silent — Jupiter's data is enough on its own, this is
// purely additive context.
async function fetchPolymarketEvent(slug) {
  if (!slug) return null;
  try {
    const url = `${POLY_GAMMA_BASE}/events/slug/${encodeURIComponent(slug)}`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j[0] : j;
  } catch { return null; }
}

// Polymarket-side "still tradeable" check. The Gamma API has a known bug
// where eliminated/settled markets can still report active=true; acceptingOrders
// is the most reliable flag. We also reject anything UMA has resolved.
function isPolymarketOpen(pmEvent, pmMarket) {
  if (pmEvent) {
    if (pmEvent.closed === true)   return false;
    if (pmEvent.archived === true) return false;
    if (pmEvent.active === false)  return false;
  }
  if (pmMarket) {
    if (pmMarket.closed === true)        return false;
    if (pmMarket.archived === true)      return false;
    if (pmMarket.active === false)       return false;
    if (pmMarket.acceptingOrders === false) return false;
    const ums = String(pmMarket.umaResolutionStatus || '').toLowerCase();
    if (ums === 'resolved' || ums === 'proposed') return false;
  }
  return true;
}

// Extract the field set we actually use from a Polymarket event response.
// First market in the array is the one Jupiter's first market mirrors —
// they're indexed in the same order.
function pickPolymarketFields(pmEvent) {
  if (!pmEvent) return null;
  const pmMkt = (pmEvent.markets && pmEvent.markets[0]) || null;
  if (!isPolymarketOpen(pmEvent, pmMkt)) return { settled: true };

  // outcomes / outcomePrices are JSON-encoded strings in the response.
  let outcomes = null, outcomePrices = null;
  try { outcomes      = pmMkt?.outcomes      ? JSON.parse(pmMkt.outcomes)      : null; } catch {}
  try { outcomePrices = pmMkt?.outcomePrices ? JSON.parse(pmMkt.outcomePrices) : null; } catch {}

  const description = pmEvent.description || pmMkt?.description || null;

  return {
    settled: false,
    description,
    startingPrice: extractStartingPrice(description),
    outcomes,                                  // ["Yes","No"] or ["Up","Down"] or team names
    outcomePrices: Array.isArray(outcomePrices) ? outcomePrices.map(Number) : null,
    groupItemTitle:  pmMkt?.groupItemTitle  || null,  // "$150k" / "March 31" / team name
    lastTradePrice:  pmMkt?.lastTradePrice  != null ? Number(pmMkt.lastTradePrice)  : null,
    bestBid:         pmMkt?.bestBid         != null ? Number(pmMkt.bestBid)         : null,
    bestAsk:         pmMkt?.bestAsk         != null ? Number(pmMkt.bestAsk)         : null,
    spread:          pmMkt?.spread          != null ? Number(pmMkt.spread)          : null,
    oneHourPriceChange:  pmMkt?.oneHourPriceChange  != null ? Number(pmMkt.oneHourPriceChange)  : null,
    oneDayPriceChange:   pmMkt?.oneDayPriceChange   != null ? Number(pmMkt.oneDayPriceChange)   : null,
    oneWeekPriceChange:  pmMkt?.oneWeekPriceChange  != null ? Number(pmMkt.oneWeekPriceChange)  : null,
    volume24hr:      pmMkt?.volume24hr      != null ? Number(pmMkt.volume24hr)      : (pmEvent.volume24hr != null ? Number(pmEvent.volume24hr) : null),
    liquidity:       pmMkt?.liquidityNum    != null ? Number(pmMkt.liquidityNum)    : (pmEvent.liquidity  != null ? Number(pmEvent.liquidity)  : null),
    competitive:     pmEvent.competitive    != null ? Number(pmEvent.competitive)   : null,
    commentCount:    pmEvent.commentCount   != null ? Number(pmEvent.commentCount)  : null,
  };
}

// ─── Live crypto prices via Polymarket RTDS WebSocket ────────────────────────
// Endpoint:  wss://ws-live-data.polymarket.com  (no auth)
// Topic:     crypto_prices_chainlink            (same feed Polymarket settles on)
// Symbols:   slash-separated, e.g. btc/usd, eth/usd, sol/usd, xrp/usd, doge/usd
// Subscribe with empty filters to receive every symbol the topic carries.
// Send PING every 5s per docs to keep the connection alive.
// Reconnect with exponential backoff on close/error.
//
// Returns a Map<symbol, { value, timestamp }> updated in place via React state.
function useLiveCryptoPrices(enabled) {
  const [prices, setPrices] = useState(() => new Map());

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    let ws = null;
    let pingId = null;
    let reconnectId = null;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try { ws = new WebSocket(POLY_RTDS_WSS); }
      catch (e) { scheduleReconnect(); return; }

      ws.onopen = () => {
        attempt = 0;
        try {
          ws.send(JSON.stringify({
            action: 'subscribe',
            subscriptions: [{ topic: POLY_RTDS_TOPIC, type: '*', filters: '' }],
          }));
        } catch {}
        // PING loop per docs (every 5s).
        pingId = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send('PING'); } catch {}
          }
        }, POLY_RTDS_PING_MS);
      };

      ws.onmessage = (ev) => {
        // PONG / non-JSON frames — skip.
        if (typeof ev.data !== 'string') return;
        if (ev.data === 'PONG' || ev.data === 'PING') return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg || msg.topic !== POLY_RTDS_TOPIC) return;
        const p = msg.payload;
        if (!p || typeof p.symbol !== 'string' || typeof p.value !== 'number') return;
        const sym = p.symbol.toLowerCase();
        const value = p.value;
        const ts    = Number(p.timestamp) || Date.now();
        setPrices(prev => {
          const next = new Map(prev);
          next.set(sym, { value, timestamp: ts });
          return next;
        });
      };

      ws.onclose = () => {
        if (pingId) { clearInterval(pingId); pingId = null; }
        scheduleReconnect();
      };
      ws.onerror = () => { /* onclose handles reconnect */ };
    };

    const scheduleReconnect = () => {
      if (closed) return;
      attempt += 1;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5)) + Math.random() * 500;
      reconnectId = setTimeout(connect, wait);
    };

    connect();

    return () => {
      closed = true;
      if (pingId)      clearInterval(pingId);
      if (reconnectId) clearTimeout(reconnectId);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, [enabled]);

  return prices;
}

function pickPositionFields(p) {
  if (!p) return null;

  // Numerics — contracts is u64 as string per spec
  const contracts     = Number(p.contracts || 0);
  const openOrders    = Number(p.openOrders || 0);

  // All micro-USD strings → USD numbers
  const avgPriceUsd   = toUsd(p.avgPriceUsd);
  const markPriceUsd  = p.markPriceUsd != null ? toUsd(p.markPriceUsd) : null;
  const sellPriceUsd  = p.sellPriceUsd != null ? toUsd(p.sellPriceUsd) : null;

  const costUsd       = toUsd(p.totalCostUsd ?? p.sizeUsd) || contracts * avgPriceUsd;
  const valueUsd      = p.valueUsd != null
    ? toUsd(p.valueUsd)
    : (markPriceUsd != null ? contracts * markPriceUsd : null);

  // Prefer server-computed P&L; fall back to client calc only if missing.
  const pnlUsd        = p.pnlUsd != null
    ? toUsd(p.pnlUsd)
    : (valueUsd != null ? (valueUsd - costUsd) : null);
  const pnlUsdPercent = p.pnlUsdPercent != null
    ? Number(p.pnlUsdPercent)
    : (costUsd > 0 && pnlUsd != null ? (pnlUsd / costUsd) * 100 : null);

  // Fee-adjusted P&L — what they'd actually realize on exit
  const pnlAfterFeesUsd     = p.pnlUsdAfterFees != null ? toUsd(p.pnlUsdAfterFees) : null;
  const pnlAfterFeesPercent = p.pnlUsdAfterFeesPercent != null
    ? Number(p.pnlUsdAfterFeesPercent) : null;

  // Already-realized P&L from closed portions + fees paid
  const realizedPnlUsd = p.realizedPnlUsd != null ? toUsd(p.realizedPnlUsd) : 0;
  const feesPaidUsd    = toUsd(p.feesPaidUsd || 0);

  const payoutUsd      = toUsd(p.payoutUsd);
  const claimedUsd     = toUsd(p.claimedUsd || 0);

  const evMeta  = p.eventMetadata  || {};
  const mktMeta = p.marketMetadata || {};
  const title         = evMeta.title || mktMeta.title || p.title || 'Position';
  const eventSubtitle = evMeta.subtitle || null;
  const eventImage    = evMeta.imageUrl || null;
  const marketStatus  = mktMeta.status || null;
  const marketResult  = mktMeta.result || null;

  return {
    // — Identity —
    positionPubkey: p.pubkey || p.positionPubkey,
    ownerPubkey:    p.ownerPubkey || null,
    marketId:       p.marketId,
    isYes:          !!p.isYes,

    // — Display —
    title,
    eventSubtitle,
    eventImage,
    eventId:      evMeta.eventId || null,
    eventCategory:    evMeta.category || null,
    eventSubcategory: evMeta.subcategory || null,
    closeCondition:   evMeta.closeCondition || null,
    outcomeLabel: mktMeta.title || null,
    marketDescription: mktMeta.description || null,
    marketStatus,
    marketResult,
    marketCloseTime:  mktMeta.closeTime || null,

    // — State —
    contracts,
    openOrders,
    claimable: !!p.claimable,
    claimed:   !!p.claimed,
    status:    p.claimed ? 'claimed' : (p.claimable ? 'claimable' : 'active'),

    // — Timestamps —
    openedAt:       p.openedAt || null,
    updatedAt:      p.updatedAt || null,
    claimableAt:    p.claimableAt || null,
    settlementDate: p.settlementDate || null,

    // — Pricing / P&L —
    avgPriceUsd,
    markPriceUsd,
    sellPriceUsd,
    costUsd,
    valueUsd,
    payoutUsd,
    claimedUsd,

    pnlUsd,
    pnlUsdPercent,
    pnlAfterFeesUsd,
    pnlAfterFeesPercent,
    realizedPnlUsd,
    feesPaidUsd,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: ATOMIC SWAP
// ═══════════════════════════════════════════════════════════════════════════════

async function buildSolToJupUsdSwapTx({ connection, ownerPubkey, grossLamports }) {
  const feeLamports = (grossLamports * BigInt(FEE_BPS)) / 10000n;
  const netLamports = grossLamports - feeLamports;
  if (feeLamports <= 0n) throw new Error('Fee rounds to zero — amount too small.');
  if (netLamports <= 0n) throw new Error('Net amount after fee is zero.');

  // Build a Jupiter swap quote. We pass only documented /build parameters
  // (per dev.jup.ag/docs/swap/build). The compute unit price comes back
  // inside build.computeBudgetInstructions; we add our own setComputeUnitLimit
  // and setComputeUnitPrice below to ensure short-window orders land.
  const params = new URLSearchParams({
    inputMint:   SOL_MINT,
    outputMint:  JUPUSD_MINT,
    amount:      netLamports.toString(),
    slippageBps: String(SLIPPAGE_BPS),
    taker:       ownerPubkey.toBase58(),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  const expectedJupUsdAtomic = BigInt(build.outAmount || 0);
  if (expectedJupUsdAtomic <= 0n) throw new Error('Jupiter quote returned zero output');

  const feeIx = SystemProgram.transfer({
    fromPubkey: ownerPubkey,
    toPubkey:   FEE_WALLET,
    lamports:   Number(feeLamports),
  });

  // Assemble instructions in the order documented by dev.jup.ag/docs/swap/build:
  //   computeBudgetInstructions (CU limit + price) -> setupInstructions ->
  //   swapInstruction -> cleanupInstruction -> otherInstructions
  // We override the CU budget with our own values: /build returns only the
  // CU price (no limit), and we want a deterministic priority fee for time-
  // sensitive orders. The CU limit is determined by simulating once with the
  // network max, reading actual usage, then rebuilding at 1.2x usage.
  const buildIxs = (cuLimit) => {
    const ixs = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }));
    ixs.push(feeIx);
    if (Array.isArray(build.setupInstructions))
      for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
    if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
    if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
    if (Array.isArray(build.otherInstructions))
      for (const ix of build.otherInstructions) ixs.push(deserIx(ix));
    return ixs;
  };

  const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
  let alts = [];
  if (altKeys.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
    alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
      key:   new PublicKey(k),
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }) : null).filter(Boolean);
  }

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const compile = (ixs) => new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  // Simulate with the max CU limit, then rebuild with the actual usage + buffer.
  const probeTx = new VersionedTransaction(compile(buildIxs(CU_LIMIT_MAX)));
  const cuLimit = await simulateForCuLimit(connection, probeTx, 'sol-jupusd');
  const tx = new VersionedTransaction(compile(buildIxs(cuLimit)));

  return { tx, expectedJupUsdAtomic, latestBlockhash };
}

async function buildJupUsdToSolSwapTx({ connection, ownerPubkey, grossJupUsdAtomic }) {
  const feeAtomic = (grossJupUsdAtomic * BigInt(FEE_BPS)) / 10000n;
  const netAtomic = grossJupUsdAtomic - feeAtomic;
  if (feeAtomic <= 0n) throw new Error('Fee rounds to zero — amount too small.');
  if (netAtomic <= 0n) throw new Error('Net amount after fee is zero.');

  const params = new URLSearchParams({
    inputMint:   JUPUSD_MINT,
    outputMint:  SOL_MINT,
    amount:      netAtomic.toString(),
    slippageBps: String(SLIPPAGE_BPS),
    taker:       ownerPubkey.toBase58(),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  const expectedSolLamports = BigInt(build.outAmount || 0);

  const mintPk    = new PublicKey(JUPUSD_MINT);
  const sourceAta = getAssociatedTokenAddressSync(mintPk, ownerPubkey, true, TOKEN_PROGRAM_ID);
  const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,  true, TOKEN_PROGRAM_ID);

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    ownerPubkey, destAta, FEE_WALLET, mintPk, TOKEN_PROGRAM_ID,
  );
  const transferIx = createTransferCheckedInstruction(
    sourceAta, mintPk, destAta, ownerPubkey,
    feeAtomic, JUPUSD_DECIMALS, [], TOKEN_PROGRAM_ID,
  );

  // Same instruction ordering as the buy path: explicit CU budget first,
  // then our fee transfer, then Jupiter's setup/swap/cleanup/other. CU limit
  // is determined by simulation per dev.jup.ag/docs/swap/advanced/compute-units.
  const buildIxs = (cuLimit) => {
    const ixs = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }));
    ixs.push(ataIx);
    ixs.push(transferIx);
    if (Array.isArray(build.setupInstructions))
      for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
    if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
    if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
    if (Array.isArray(build.otherInstructions))
      for (const ix of build.otherInstructions) ixs.push(deserIx(ix));
    return ixs;
  };

  const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
  let alts = [];
  if (altKeys.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
    alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
      key:   new PublicKey(k),
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }) : null).filter(Boolean);
  }

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const compile = (ixs) => new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  const probeTx = new VersionedTransaction(compile(buildIxs(CU_LIMIT_MAX)));
  const cuLimit = await simulateForCuLimit(connection, probeTx, 'jupusd-sol');
  const tx = new VersionedTransaction(compile(buildIxs(cuLimit)));

  return { tx, expectedSolLamports, latestBlockhash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Predict order builders
// ═══════════════════════════════════════════════════════════════════════════════

async function buildBuyTx({ ownerPubkey, marketId, isYes, depositAmountJupUsdAtomic }) {
  const r = await jfetch('/api/predict/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerPubkey, marketId, isYes, isBuy: true,
      depositAmount: depositAmountJupUsdAtomic.toString(),
      depositMint:   JUPUSD_MINT,
    }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('Jupiter Predict returned no transaction');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)), orderInfo: j.order || null };
}

// Defensive precheck — Jupiter docs recommend calling GET /trading-status
// before placing orders to confirm the exchange is up. Returns true if the
// API explicitly reports trading_active, also true on any error so we don't
// block users when the status check itself is unavailable. Only returns
// false when Jupiter explicitly says trading is off.
async function fetchTradingStatus() {
  try {
    const r = await jfetch('/api/predict/trading-status');
    if (!r.ok) return true;
    const j = await r.json();
    if (j && typeof j.trading_active === 'boolean') return j.trading_active;
    return true;
  } catch {
    return true;
  }
}

// Poll GET /orders/status/{orderPubkey} after submitting a buy. Per docs:
// orders go through a keeper network for matching — the on-chain tx only
// opens an order account, it does NOT guarantee a fill. Polling tells us
// if the order filled, is still pending, or failed.
//
// We start polling after a 2s delay (docs warn the first few polls may
// return 'no order history found') and give up after maxAttempts. Returns
// the terminal status: 'filled', 'failed', or 'pending' (if we timed out).
async function pollOrderStatus(orderPubkey, { maxAttempts = 10, intervalMs = 2000 } = {}) {
  if (!orderPubkey) return 'pending';
  // First poll after initial delay so the keeper has a chance to pick it up.
  await new Promise(r => setTimeout(r, intervalMs));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await jfetch(`/api/predict/orders/status/${encodeURIComponent(orderPubkey)}`);
      if (r.ok) {
        const j = await r.json();
        const status = j?.status || j?.data?.status;
        if (status === 'filled') return 'filled';
        if (status === 'failed') return 'failed';
      }
    } catch {
      // Network blips are fine, keep polling.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return 'pending';
}

async function buildSellTx({ ownerPubkey, positionPubkey }) {
  const r = await jfetch(`/api/predict/positions/${encodeURIComponent(positionPubkey)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('No sell tx returned');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)) };
}

async function buildClaimTx({ ownerPubkey, positionPubkey }) {
  const r = await jfetch(`/api/predict/positions/${encodeURIComponent(positionPubkey)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('No claim tx returned');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Submit + confirm helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function simulateOrThrow(connection, tx, label) {
  const mapSimErr = (logs) => {
    const j = (logs || []).join('\n').toLowerCase();
    if (j.includes('insufficient') || j.includes('0x1'))   return 'Insufficient balance.';
    if (j.includes('slippage') || j.includes('0x1771'))    return 'Price moved — try again.';
    if (j.includes('account not') || j.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
    if (j.includes('blockhash') || j.includes('expired'))  return 'Quote expired. Please retry.';
    return null;
  };
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      commitment: 'confirmed',
    });
    if (sim.value.err) {
      const mapped = mapSimErr(sim.value.logs);
      console.warn(`[predict] ${label} sim error:`, sim.value.err, sim.value.logs?.slice(-5));
      throw new Error(mapped || `Simulation failed for ${label}.`);
    }
  } catch (e) {
    if (e?.message && /balance|slippage|expired|account not|simulation failed/i.test(e.message)) {
      throw e;
    }
    console.warn(`[predict] ${label} sim non-fatal:`, e?.message);
  }
}

// Simulate a built transaction to estimate compute unit usage, then return
// 1.2x that value (capped at the network max). Implements the pattern Jupiter
// recommends in dev.jup.ag/docs/swap/advanced/compute-units. Falls back to
// CU_LIMIT_FALLBACK if simulation can't estimate.
async function simulateForCuLimit(connection, tx, label) {
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
    });
    const used = Number(sim?.value?.unitsConsumed || 0);
    if (used > 0) {
      const buffered = Math.ceil((used * CU_BUFFER_PERCENT) / 100);
      return Math.min(buffered, CU_LIMIT_MAX);
    }
  } catch (e) {
    console.warn(`[predict] ${label} CU sim failed:`, e?.message);
  }
  return CU_LIMIT_FALLBACK;
}

async function sendAndConfirm(connection, signedTx, blockhashInfo, setStMsg) {
  setStMsg('Submitting…');
  const sig = await connection.sendRawTransaction(signedTx.serialize(), {
    maxRetries: 5, skipPreflight: false, preflightCommitment: 'confirmed',
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
      new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
    ]);
    if (conf?.value?.err) {
      throw new Error('On-chain error: ' + JSON.stringify(conf.value.err));
    }
    return { sig, pending: false };
  } catch (e) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        const cs = st?.value?.confirmationStatus;
        if (st?.value?.err) throw new Error('On-chain error: ' + JSON.stringify(st.value.err));
        if (cs === 'confirmed' || cs === 'finalized') return { sig, pending: false };
      } catch (inner) {
        if (/on-chain/i.test(String(inner?.message))) throw inner;
      }
    }
    return { sig, pending: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: UI atoms
// ═══════════════════════════════════════════════════════════════════════════════

function Spinner({ size = 12, color = C.hl }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${C.hlDim}`, borderTopColor: color,
      animation: 'nexus-spin .8s linear infinite', flexShrink: 0,
    }} />
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
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no, wordBreak: 'break-word' }}>
      {msg}
    </div>
  );
}

function StepBadge({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {Array.from({ length: total }).map((_, i) => {
        const done   = i < current - 1;
        const active = i === current - 1;
        return (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: done ? C.hl : active ? C.hl2 : 'rgba(255,255,255,.08)',
            transition: 'background .2s',
          }} />
        );
      })}
    </div>
  );
}

function PrimaryButton({ onClick, disabled, label, color = 'hl' }) {
  const bg = color === 'no'  ? `linear-gradient(135deg, ${C.no}33, ${C.no}22)`
           : color === 'yes' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)`
           : color === 'amber' ? `linear-gradient(135deg, ${C.amber}, ${C.amber}aa)`
           : `linear-gradient(135deg, ${C.hl}, ${C.hl2})`;
  const textColor = color === 'no' ? C.no : color === 'yes' ? C.yes : C.bg;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ width: '100%', padding: 12, borderRadius: 11, background: bg, color: textColor, fontWeight: 800, fontSize: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...T.body }}>
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Page header
// ═══════════════════════════════════════════════════════════════════════════════

function PageHeader({ connected, solBal, tab, setTab, pubkey, onCopy }) {
  const sol = Number(solBal) / 1e9;
  return (
    <div style={{ marginTop: 4, marginBottom: 10, padding: '14px 14px 12px', borderRadius: 18, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: -0.5, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Crypto markets · live · ending soonest</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>JUPITER</div>
        </div>

        {connected ? (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>
                  {sol.toFixed(4)} <span style={{ fontSize: 10, color: C.muted, ...T.mono, marginLeft: 4 }}>SOL</span>
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Market card + Buy drawer
// ═══════════════════════════════════════════════════════════════════════════════

function MarketCard({ event, livePrices, priceSnapshots, onTrade }) {
  const m = event.market;
  const poly = event.poly || null;
  const yp = m.yesPrice;
  const np = m.noPrice;
  const yPct = m.yesPct;
  const upside = p => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  const clamp1 = { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  const closed = m.status !== 'open';

  const closeMs = toMs(event.closeTime);
  const isUrgent = closeMs && (closeMs - Date.now()) > 0 && (closeMs - Date.now()) < URGENT_WINDOW_MS;

  // Outcome labels — Polymarket gives the real labels (e.g., "Up"/"Down",
  // team names, "Trump"/"Harris"). Fall back to YES/NO if missing.
  const yesLabel = poly?.outcomes?.[0] || 'Yes';
  const noLabel  = poly?.outcomes?.[1] || 'No';

  // Price-to-beat (the reference) and the current live Chainlink price for
  // the asset. Reference comes from our localStorage snapshot captured the
  // first time we saw this market open. Current is from the RTDS WebSocket.
  const priceToBeat = resolvePriceToBeat(event, priceSnapshots);
  const symbol      = symbolFromSubcategory(event.subcategory);
  const live        = symbol ? livePrices?.get(symbol) : null;
  const currentPrice = live?.value ?? null;
  const hasPrices    = priceToBeat != null && currentPrice != null;
  const priceDelta   = hasPrices ? currentPrice - priceToBeat : null;
  const priceDeltaPct = hasPrices && priceToBeat > 0 ? (priceDelta / priceToBeat) * 100 : null;
  const isUp = priceDelta != null && priceDelta >= 0;
  const fmtPrice = (n) => {
    if (n == null) return '—';
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1)    return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(6);
  };

  // First sentence of the description — so the user sees the resolution
  // criteria right on the card, not just an abstract question.
  const ruleSnippet = (() => {
    const txt = poly?.description || m.rulesPrimary || event.closeCondition;
    if (!txt) return null;
    const firstSentence = String(txt).trim().split(/(?<=[.!?])\s/)[0];
    return firstSentence.length > 160 ? firstSentence.slice(0, 157) + '…' : firstSentence;
  })();

  return (
    <div style={{
      padding: 10, borderRadius: 14,
      background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`,
      border: `1px solid ${isUrgent ? 'rgba(245,181,61,.40)' : C.border}`,
      marginBottom: 7,
      boxShadow: C.shadow,
      opacity: closed ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {event.image && <img src={event.image} alt="" onError={e => e.currentTarget.style.display = 'none'} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 3, ...T.body, ...clamp2 }}>
            {event.title}
          </div>
          {m.title && m.title !== event.title && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.hl, lineHeight: 1.3, marginBottom: 4, ...T.body, ...clamp1 }}>
              {m.title}
            </div>
          )}

          {/* Threshold / differentiator chip — most meaningful for grouped
              markets ("$150k" / "March 31" / a player name). */}
          {poly?.groupItemTitle && (
            <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, marginBottom: 4, ...T.mono }}>
              {poly.groupItemTitle}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 9, color: C.muted, ...T.mono, alignItems: 'center' }}>
            {event.subcategory && (
              <span style={{ color: C.hl, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>
                {event.subcategory}
              </span>
            )}
            {event.subcategory && <span style={{ opacity: .4 }}>·</span>}
            <span>Vol {formatVol(event.volume24h)}</span>
            {formatEndDate(event.closeTime) && (
              <>
                <span style={{ opacity: .4 }}>·</span>
                <span style={{ color: isUrgent ? C.amber : C.muted, fontWeight: isUrgent ? 700 : 400 }}>
                  {formatEndDate(event.closeTime)}
                </span>
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 38 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: yPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono, textTransform: 'uppercase' }}>{yesLabel}</div>
        </div>
      </div>

      {/* Price strip — the ACTUAL bet. Reference (price-to-beat) on the
          left, live current price on the right, delta in the middle.
          Live current price comes from the Polymarket RTDS Chainlink
          stream — the same feed the market resolves against. */}
      {(priceToBeat != null || currentPrice != null) && (
        <div style={{
          display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 8,
          padding: '7px 10px', borderRadius: 10,
          background: hasPrices
            ? (isUp ? 'rgba(0,212,163,.06)' : 'rgba(255,95,122,.06)')
            : 'rgba(255,255,255,.02)',
          border: `1px solid ${hasPrices ? (isUp ? 'rgba(0,212,163,.25)' : 'rgba(255,95,122,.25)') : C.border}`,
          ...T.mono,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1 }}>PRICE TO BEAT</div>
            <div style={{ fontSize: 12, color: C.ink, fontWeight: 700, ...T.display }}>
              {priceToBeat != null ? fmtPrice(priceToBeat) : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 68, paddingLeft: 6, paddingRight: 6, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1 }}>SPREAD</div>
            {priceDelta != null ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: isUp ? C.yes : C.no, lineHeight: 1.1, ...T.display }}>
                  {isUp ? '+' : '−'}{fmtPrice(Math.abs(priceDelta))}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: isUp ? C.yes : C.no, marginTop: 1, opacity: .85 }}>
                  {isUp ? '▲' : '▼'} {Math.abs(priceDeltaPct).toFixed(2)}%
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: C.muted2, fontWeight: 700, ...T.display }}>—</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1 }}>NOW</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: hasPrices ? (isUp ? C.yes : C.no) : C.ink, ...T.display }}>
              {currentPrice != null ? fmtPrice(currentPrice) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* First sentence of resolution rules — so the user sees what they're
          betting on without having to open the drawer. */}
      {ruleSnippet && (
        <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4, marginBottom: 8, padding: '5px 7px', borderLeft: `2px solid ${C.hlDim}`, ...T.body, ...clamp2 }}>
          {ruleSnippet}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => !closed && onTrade(event, true)} disabled={closed}
          style={{ flex: 1, padding: 8, borderRadius: 10, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: closed ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{yesLabel} · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}% upside</span>}
        </button>
        <button onClick={() => !closed && onTrade(event, false)} disabled={closed}
          style={{ flex: 1, padding: 8, borderRadius: 10, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: closed ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{noLabel} · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function BuyDrawer({ event, isYes, livePrices, priceSnapshots, onClose, onDone, solBal, connection }) {
  const { publicKey, signTransaction } = useWallet();

  const [amount, setAmount]   = useState('0.1');
  const [step, setStep]       = useState(0);
  const [statusMsg, setStMsg] = useState('');
  const [error, setError]     = useState('');
  const [showRules, setShowRules] = useState(false);

  useBodyLock(true);

  const m          = event.market;
  const poly       = event.poly || null;
  const solAmount  = Number(amount) || 0;
  const grossLamports = BigInt(Math.round(solAmount * 1e9));

  const SOL_PRICE_GUESS = 150;
  const estGrossUsd   = solAmount * SOL_PRICE_GUESS;
  const estFeeUsd     = estGrossUsd * (FEE_BPS / 10000);
  const estDepositUsd = estGrossUsd - estFeeUsd;
  const price         = isYes ? m.yesPrice : m.noPrice;
  const contractsEst  = price > 0 ? estDepositUsd / price : 0;

  // Use Polymarket's actual outcome labels (e.g., "Up"/"Down", team names)
  // instead of generic YES/NO whenever they're available.
  const sideLabel = (poly?.outcomes && poly.outcomes[isYes ? 0 : 1]) || (isYes ? 'YES' : 'NO');
  const sideColor = isYes ? C.yes : C.no;
  const sideDim   = isYes ? C.yesDim : C.noDim;

  const hasSol = solBal >= grossLamports && grossLamports > 0n;
  const busy   = step > 0 && step < 3;
  const canBuy = !busy && solAmount > 0 && publicKey && m.marketId && hasSol;

  const placeOrder = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setError('Connect a wallet that supports signTransaction.');
      return;
    }
    if (estGrossUsd < MIN_TRADE_USD) {
      setError(`Minimum trade is $${MIN_TRADE_USD}. Try a larger SOL amount.`);
      return;
    }

    setError('');

    try {
      // Defensive precheck — confirm Jupiter is actually accepting orders
      // before we ask the user to sign anything. Avoids the bad UX of two
      // wallet prompts followed by a failed order.
      setStep(1);
      setStMsg('Checking trading status…');
      const tradingActive = await fetchTradingStatus();
      if (!tradingActive) {
        throw new Error('Prediction market trading is paused. Please try again shortly.');
      }

      setStMsg('Building swap…');

      const { tx: swapTx, expectedJupUsdAtomic, latestBlockhash: swapBh } =
        await buildSolToJupUsdSwapTx({
          connection,
          ownerPubkey: publicKey,
          grossLamports,
        });

      const minJupUsdAtomic = BigInt(Math.round(MIN_TRADE_USD * 1e6));
      if (expectedJupUsdAtomic < minJupUsdAtomic) {
        throw new Error(`Minimum trade is $${MIN_TRADE_USD}. Try a larger SOL amount.`);
      }

      setStMsg('Checking…');
      await simulateOrThrow(connection, swapTx, 'swap');

      setStMsg('Confirm Step 1 of 2 in your wallet — Swap SOL → JupUSD');
      const signedSwap = await signTransaction(swapTx);

      setStMsg('Swapping SOL → JupUSD…');
      const swapResult = await sendAndConfirm(connection, signedSwap, swapBh, setStMsg);
      if (swapResult.pending) {
        throw new Error(`Swap submitted but still confirming. Solscan: https://solscan.io/tx/${swapResult.sig}`);
      }

      setStep(2);
      setStMsg('Reading JupUSD balance…');

      const ownerB58 = publicKey.toBase58();
      let actualJupUsd = await fetchJupUsdBalance(connection, ownerB58);

      const depositAtomic = actualJupUsd < expectedJupUsdAtomic ? actualJupUsd : expectedJupUsdAtomic;

      if (depositAtomic <= 0n) {
        throw new Error('Swap landed but no JupUSD found. Please refresh.');
      }

      setStMsg('Building order…');
      const { tx: buyTx, orderInfo } = await buildBuyTx({
        ownerPubkey: ownerB58,
        marketId: m.marketId,
        isYes,
        depositAmountJupUsdAtomic: depositAtomic,
      });

      setStMsg('Checking…');
      await simulateOrThrow(connection, buyTx, 'predict-buy');

      setStMsg(`Confirm Step 2 of 2 in your wallet — Buy ${sideLabel}`);
      const signedBuy = await signTransaction(buyTx);

      setStMsg('Placing order…');
      const orderResult = await sendAndConfirm(connection, signedBuy, null, setStMsg);
      if (orderResult.pending) {
        throw new Error(`Order submitted but still confirming. Solscan: https://solscan.io/tx/${orderResult.sig}`);
      }

      // Tx landed on-chain. Poll the keeper for actual fill — per Jupiter's
      // open-positions docs, the on-chain tx only opens an order account; a
      // keeper has to match it for the position to actually fill. We poll
      // for up to ~20 seconds and report the outcome.
      if (orderInfo?.orderPubkey) {
        setStMsg('Waiting for fill…');
        const fillStatus = await pollOrderStatus(orderInfo.orderPubkey);
        if (fillStatus === 'failed') {
          throw new Error('Order could not be filled. Your JupUSD is back in your wallet.');
        }
        // 'filled' or 'pending' (timeout) — both proceed to the done state.
        // For 'pending', the keeper may still fill it after we close; the
        // user's positions page will reflect the outcome.
      }

      setStep(3); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    }
  }, [
    publicKey, signTransaction, m, isYes, grossLamports, estGrossUsd,
    connection, onClose, onDone, sideLabel,
  ]);

  const solPresets = ['0.05', '0.1', '0.25', '0.5'];

  // Prefer Polymarket's full description — it contains the threshold price,
  // resolution source, and exact criteria. Fall back to Jupiter's truncated
  // rulesPrimary / closeCondition only if Polymarket is unavailable.
  const rulesText = poly?.description || m.rulesPrimary || event.closeCondition;
  const threshold = poly?.groupItemTitle;       // e.g. "$150k", "March 31"

  // Live price comparison — what the user is actually betting on.
  // Reference comes from the localStorage snapshot of the asset's live
  // Chainlink price when this market first opened on the user's device.
  const priceToBeat = resolvePriceToBeat(event, priceSnapshots);
  const symbol      = symbolFromSubcategory(event.subcategory);
  const live        = symbol ? livePrices?.get(symbol) : null;
  const currentPrice = live?.value ?? null;
  const hasPrices    = priceToBeat != null && currentPrice != null;
  const priceDelta   = hasPrices ? currentPrice - priceToBeat : null;
  const priceDeltaPct = hasPrices && priceToBeat > 0 ? (priceDelta / priceToBeat) * 100 : null;
  const isUp = priceDelta != null && priceDelta >= 0;
  const fmtPrice = (n) => {
    if (n == null) return '—';
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1)    return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(6);
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />

        {busy && <StepBadge current={step} total={2} />}

        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>
          {event.title}
        </div>

        {event.subtitle && (
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, ...T.body }}>{event.subtitle}</div>
        )}

        {m.title && m.title !== event.title && (
          <div style={{ fontSize: 13, fontWeight: 700, color: C.hl, marginBottom: 8, lineHeight: 1.3, ...T.body }}>
            {m.title}
          </div>
        )}

        {/* Live price strip — bigger here than on the card since this is the
            confirm step. Reference → live current → delta. Updates in real
            time from the same Chainlink feed the market resolves against. */}
        {(priceToBeat != null || currentPrice != null) && (
          <div style={{
            display: 'flex', alignItems: 'stretch', gap: 10, marginBottom: 10,
            padding: '10px 12px', borderRadius: 12,
            background: hasPrices
              ? (isUp ? 'rgba(0,212,163,.08)' : 'rgba(255,95,122,.08)')
              : 'rgba(255,255,255,.03)',
            border: `1px solid ${hasPrices ? (isUp ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)') : C.border}`,
            ...T.mono,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1.2, marginBottom: 2 }}>PRICE TO BEAT</div>
              <div style={{ fontSize: 16, color: C.ink, fontWeight: 800, ...T.display, lineHeight: 1 }}>
                {priceToBeat != null ? fmtPrice(priceToBeat) : '—'}
              </div>
            </div>
            <div style={{ textAlign: 'center', minWidth: 84, paddingLeft: 8, paddingRight: 8, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1.2, marginBottom: 2 }}>SPREAD</div>
              {priceDelta != null ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, color: isUp ? C.yes : C.no, lineHeight: 1.1, ...T.display }}>
                    {isUp ? '+' : '−'}{fmtPrice(Math.abs(priceDelta))}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: isUp ? C.yes : C.no, marginTop: 2, opacity: .9 }}>
                    {isUp ? '▲' : '▼'} {Math.abs(priceDeltaPct).toFixed(2)}%
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 16, color: C.muted2, fontWeight: 800, ...T.display }}>—</div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: 1.2, marginBottom: 2 }}>NOW</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: hasPrices ? (isUp ? C.yes : C.no) : C.ink, ...T.display, lineHeight: 1 }}>
                {currentPrice != null ? fmtPrice(currentPrice) : '—'}
              </div>
              {currentPrice != null && (
                <div style={{ fontSize: 8, color: C.muted2, marginTop: 3 }}>chainlink · live</div>
              )}
            </div>
          </div>
        )}

        {threshold && (
          <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, marginBottom: 8, ...T.mono }}>
            {threshold}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ padding: '3px 8px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', ...T.mono }}>{sideLabel}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          {event.subcategory && (
            <div style={{ fontSize: 9, color: C.hl, ...T.mono, fontWeight: 700, padding: '2px 6px', background: C.hlDim, borderRadius: 99 }}>{event.subcategory}</div>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>
            {(Number(solBal) / 1e9).toFixed(4)} SOL
          </div>
        </div>

        {rulesText && (
          <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
            <button onClick={() => setShowRules(!showRules)} style={{ width: '100%', background: 'none', border: 'none', color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, ...T.mono }}>
              <span>{poly ? 'FULL RULES (from Polymarket)' : 'RESOLUTION'}</span>
              <span style={{ fontSize: 11 }}>{showRules ? '−' : '+'}</span>
            </button>
            {showRules && (
              <>
                <div style={{ marginTop: 6, fontSize: 10, color: C.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', ...T.body }}>
                  {rulesText}
                </div>
                {m.rulesSecondary && m.rulesSecondary !== rulesText && !poly && (
                  <div style={{ marginTop: 6, fontSize: 10, color: C.muted, lineHeight: 1.5, ...T.body }}>{m.rulesSecondary}</div>
                )}
                {event.rulesPdf && (
                  <a href={event.rulesPdf} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: 10, color: C.hl, textDecoration: 'underline', ...T.mono }}>
                    Full rules ↗
                  </a>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>SOL</span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
            {solPresets.map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 6, borderRadius: 7, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: 'pointer', ...T.mono }}>{v}</button>
            ))}
            <button onClick={() => setAmount(Math.max(0, (Number(solBal) / 1e9) - 0.01).toFixed(4))} disabled={busy || solBal <= 0n} style={{ flex: 1, padding: 6, borderRadius: 7, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
          </div>
        </div>

        <div style={{ padding: 9, borderRadius: 10, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 10 }}>
          <Row label="You pay" value={`${solAmount.toFixed(4)} SOL`} />
          <Row label="Platform fee (5%)" value={`~${(solAmount * FEE_BPS / 10000).toFixed(4)} SOL`} />
          <Row label="Est. deposit" value={`~${fmtUsd(estDepositUsd)} JupUSD`} />
          <Row label="Est. contracts" value={`~${contractsEst.toFixed(2)}`} />
          <Row label={`If ${sideLabel} wins`} value={`~${fmtUsd(contractsEst)}`} valueColor={sideColor} bold />
          {formatEndDate(event.closeTime) && (
            <Row label="Closes" value={formatEndDate(event.closeTime)} />
          )}
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 9 }}>
            Two signatures: Swap SOL → JupUSD, then place order.
          </div>
        </div>

        {statusMsg && <StatusLine msg={statusMsg} step={busy ? `STEP ${step} OF 2` : null} />}
        {error && <ErrorLine msg={error} />}

        {!hasSol && solAmount > 0 && !busy && (
          <div style={{ marginBottom: 8, padding: 8, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', borderRadius: 10, fontSize: 11, color: C.amber, fontWeight: 600 }}>
            Insufficient SOL balance.
          </div>
        )}

        <PrimaryButton
          onClick={canBuy ? placeOrder : undefined}
          disabled={!canBuy}
          color={isYes ? 'yes' : 'no'}
          label={
            busy ? (statusMsg || 'Working…')
            : step === 3 ? '✓ Order placed'
            : `Buy ${sideLabel} · ${solAmount.toFixed(4)} SOL`
          }
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Positions
// ═══════════════════════════════════════════════════════════════════════════════

function PositionsList({ positions, loading, onAction }) {
  if (loading) return <>{[1,2,3].map(i => <Skeleton key={i} />)}</>;
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
  const pnl       = p.pnlUsd;
  const pnlColor  = pnl >= 0 ? C.yes : C.no;
  const pnlPct    = p.costUsd > 0 ? (pnl / p.costUsd) * 100 : 0;

  const isClaimable = p.claimable && !p.claimed;
  const isClaimed   = p.claimed;

  return (
    <div style={{ padding: 10, borderRadius: 14, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 7, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 4, ...T.body }}>{p.title}</div>
          {p.outcomeLabel && p.outcomeLabel !== p.title && (
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, ...T.mono }}>{p.outcomeLabel}</div>
          )}
          <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{p.isYes ? 'YES' : 'NO'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>{fmtUsd(p.valueUsd)}</div>
          <div style={{ fontSize: 10, color: pnlColor, fontWeight: 700, ...T.mono, marginTop: 2 }}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
          </div>
        </div>
      </div>

      <div style={{ padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.02)', marginBottom: 8, ...T.mono, fontSize: 10 }}>
        <Row label="Contracts" value={`${p.contracts.toFixed(2)} @ $${p.avgPriceUsd.toFixed(3)}`} />
        <Row label="Mark price" value={`$${p.markPriceUsd.toFixed(3)}`} />
        {isClaimable && <Row label="Payout" value={fmtUsd(p.payoutUsd)} valueColor={C.yes} bold />}
      </div>

      {isClaimable ? (
        <PrimaryButton onClick={() => onAction('claim', p)} color="yes" label={`Claim ${fmtUsd(p.payoutUsd)}`} />
      ) : isClaimed ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, fontWeight: 600, padding: 8, ...T.mono }}>
          ✓ Claimed {fmtUsd(p.payoutUsd)}
        </div>
      ) : (
        <button onClick={() => onAction('sell', p)}
          style={{ width: '100%', padding: 9, borderRadius: 10, background: pnl >= 0 ? `linear-gradient(135deg, ${C.yes}22, ${C.yes}11)` : `linear-gradient(135deg, ${C.no}22, ${C.no}11)`, border: `1px solid ${pnl >= 0 ? C.yes : C.no}55`, color: pnl >= 0 ? C.yes : C.no, fontSize: 12, fontWeight: 700, cursor: 'pointer', ...T.body }}>
          Sell {p.contracts.toFixed(2)} contracts · {fmtUsd(p.valueUsd)}
        </button>
      )}
    </div>
  );
}

function SellOrClaimDrawer({ position, kind, onClose, onDone, connection }) {
  const { publicKey, signTransaction } = useWallet();
  const [step, setStep]       = useState(0);
  const [statusMsg, setStMsg] = useState('');
  const [error, setError]     = useState('');

  useBodyLock(true);

  const busy   = step > 0 && step < 3;
  const isClaim = kind === 'claim';
  const grossUsd = isClaim ? position.payoutUsd : position.valueUsd;

  const handleAction = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setError('Connect a wallet that supports signTransaction.');
      return;
    }
    setError('');

    try {
      setStep(1);
      setStMsg(`Building ${isClaim ? 'claim' : 'sell'}…`);

      const ownerB58 = publicKey.toBase58();
      const { tx: predictTx } = isClaim
        ? await buildClaimTx({ ownerPubkey: ownerB58, positionPubkey: position.positionPubkey })
        : await buildSellTx({ ownerPubkey: ownerB58, positionPubkey: position.positionPubkey });

      setStMsg('Checking…');
      await simulateOrThrow(connection, predictTx, kind);

      setStMsg(`Confirm Step 1 of 2 in your wallet — ${isClaim ? 'Claim winnings' : 'Sell contracts'}`);
      const signedPredict = await signTransaction(predictTx);

      setStMsg(isClaim ? 'Claiming…' : 'Selling…');
      const predictResult = await sendAndConfirm(connection, signedPredict, null, setStMsg);
      if (predictResult.pending) {
        throw new Error(`${isClaim ? 'Claim' : 'Sell'} submitted but still confirming. Solscan: https://solscan.io/tx/${predictResult.sig}`);
      }

      setStep(2);
      setStMsg('Reading JupUSD balance…');

      const actualJupUsd = await fetchJupUsdBalance(connection, ownerB58);
      if (actualJupUsd <= 0n) {
        throw new Error('No JupUSD found to swap. Refresh and try again.');
      }

      setStMsg('Building swap…');
      const { tx: swapTx, latestBlockhash: swapBh } = await buildJupUsdToSolSwapTx({
        connection,
        ownerPubkey: publicKey,
        grossJupUsdAtomic: actualJupUsd,
      });

      setStMsg('Checking…');
      await simulateOrThrow(connection, swapTx, 'jupusd-sol');

      setStMsg('Confirm Step 2 of 2 in your wallet — Swap JupUSD → SOL');
      const signedSwap = await signTransaction(swapTx);

      setStMsg('Swapping JupUSD → SOL…');
      const swapResult = await sendAndConfirm(connection, signedSwap, swapBh, setStMsg);
      if (swapResult.pending) {
        throw new Error(`Swap submitted but still confirming. Solscan: https://solscan.io/tx/${swapResult.sig}`);
      }

      setStep(3); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    }
  }, [publicKey, signTransaction, position, isClaim, kind, connection, onDone, onClose]);

  const feeUsd  = grossUsd * (FEE_BPS / 10000);
  const netUsd  = grossUsd - feeUsd;
  const headerBadge = isClaim
    ? <div style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: C.yesDim, border: `1px solid ${C.yes}55`, color: C.yes, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginBottom: 6, ...T.mono }}>🏆 RESOLVED — YOU WON</div>
    : null;

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />

        {busy && <StepBadge current={step} total={2} />}

        {headerBadge}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, ...T.body }}>{position.title}</div>

        <div style={{ padding: 10, borderRadius: 10, background: isClaim ? 'rgba(0,212,163,.05)' : 'rgba(255,255,255,.02)', border: isClaim ? '1px solid rgba(0,212,163,.20)' : `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 11 }}>
          <Row label="Contracts" value={position.contracts.toFixed(2)} />
          {!isClaim && <Row label="Mark price" value={`$${position.markPriceUsd.toFixed(3)}`} />}
          <Row label={isClaim ? 'Payout' : 'Sell value'} value={fmtUsd(grossUsd)} />
          <Row label="Fee (5%)" value={fmtUsd(feeUsd)} />
          <Row label="You collect" value={`~${fmtUsd(netUsd)} in SOL`} valueColor={C.hl} bold />
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 9 }}>
            Two signatures: {isClaim ? 'Claim' : 'Sell'} then swap JupUSD → SOL.
          </div>
        </div>

        {statusMsg && <StatusLine msg={statusMsg} step={busy ? `STEP ${step} OF 2` : null} />}
        {error && <ErrorLine msg={error} />}

        <PrimaryButton
          onClick={busy ? undefined : handleAction}
          disabled={busy || step === 3}
          color={isClaim || position.pnlUsd >= 0 ? 'yes' : 'no'}
          label={
            busy ? (statusMsg || 'Working…')
            : step === 3 ? `✓ ${isClaim ? 'Claimed' : 'Sold'}`
            : isClaim ? `Claim · ${fmtUsd(grossUsd)}` : `Sell all · ${fmtUsd(grossUsd)}`
          }
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: Top-level page
// ═══════════════════════════════════════════════════════════════════════════════

export default function Predict() {
  const { publicKey, connected } = useWallet();
  const [tab, setTab]     = useState('markets');
  const [search, setSearch] = useState('');

  const [events, setEvents]         = useState([]);
  const [evLoading, setEvLoading]   = useState(true);
  const [evError, setEvError]       = useState(null);

  const [positions, setPositions]   = useState([]);
  const [posLoading, setPosLoading] = useState(false);

  const [solBal, setSolBal] = useState(0n);

  const [buyState, setBuyState]   = useState(null);
  const [actionPos, setActionPos] = useState(null);
  const [toast, setToast]         = useState('');

  // Live crypto prices streamed from Polymarket's RTDS Chainlink topic.
  // Only connect when the user is viewing markets to save bandwidth and a
  // WS connection slot.
  const livePrices = useLiveCryptoPrices(tab === 'markets');

  // Opening-price snapshots — captures each up/down market's reference price
  // the first time we see it, persists to localStorage. Powers the PRICE TO
  // BEAT and SPREAD columns since Polymarket doesn't expose a public crypto
  // price-to-beat endpoint.
  const priceSnapshots = usePriceSnapshots(events, livePrices);

  const connection = useMemo(() => {
    const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
    return new Connection(origin + SOL_RPC, 'confirmed');
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) { setSolBal(0n); return; }
    const s = await fetchSolBalance(connection, publicKey.toBase58());
    setSolBal(s);
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

      // Pass 1: normalize Jupiter fields, drop anything closed/cancelled/settled
      // before we even consider rendering it.
      const normalized = raw
        .map((ev, i) => {
          try { return pickEventFields(ev); }
          catch (e) { console.warn('pickEventFields failed', i, e?.message); return null; }
        })
        .filter(Boolean)
        .filter(isMarketOpen);

      // Pass 2: enrich with Polymarket Gamma data for descriptions, outcome
      // labels, group thresholds. We do NOT call /api/equity/price-to-beat
      // here — that endpoint is for stocks/forex/oil markets only and 404s
      // on crypto markets. For crypto up/down markets, the "price to beat"
      // is the live Chainlink price at market openTime, which we snapshot
      // client-side via usePriceSnapshots (see SECTION 1).
      //
      // Failures are silent — Jupiter's data alone is enough to render. We
      // also use Polymarket's flags to drop any market THEIR side considers
      // settled (catches the known Gamma-bug cases Jupiter still relays).
      const slugs = normalized.map(e => e.slug).filter(Boolean);
      const pmResults = await Promise.all(
        slugs.map(async (s) => {
          const gamma = await fetchPolymarketEvent(s)
            .then(pickPolymarketFields)
            .catch(() => null);
          return gamma || null;
        })
      );
      const pmBySlug = new Map();
      slugs.forEach((s, i) => { if (pmResults[i]) pmBySlug.set(s, pmResults[i]); });

      const enriched = normalized
        .map(e => {
          const pm = e.slug ? pmBySlug.get(e.slug) : null;
          if (pm?.settled) return null;       // Polymarket says it's done
          return pm ? { ...e, poly: pm } : e;
        })
        .filter(Boolean);

      setEvents(enriched);
    } catch (e) {
      setEvError(friendlyError(e));
    } finally {
      setEvLoading(false);
    }
  }, []);

  useEffect(() => {
    setEvLoading(true);
    reloadEvents();
  }, [reloadEvents]);

  useEffect(() => {
    const hasUrgent = events.some(e => {
      const ms = toMs(e.closeTime);
      return ms && ms - Date.now() < URGENT_WINDOW_MS && ms > Date.now();
    });
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
      const raw = await fetchPositions(publicKey.toBase58());
      setPositions(raw.map(pickPositionFields).filter(Boolean));
    } catch {
      setPositions([]);
    } finally {
      setPosLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (tab !== 'positions' || !publicKey) return;
    reloadPositions();
    const id = setInterval(reloadPositions, 300_000);
    return () => clearInterval(id);
  }, [tab, publicKey, reloadPositions]);

  // Sort: ascending close time. Search filters by event title, market title
  // (the prediction), subcategory (the token), and tags. Safety net: re-apply
  // isMarketOpen at render so anything that ticks past its close while the
  // user is viewing the list disappears without waiting for the next refresh.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = events.filter(isMarketOpen);
    if (q) {
      r = r.filter(e => {
        const fields = [
          e.title,
          e.market?.title,
          e.subcategory,
          ...(e.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return fields.includes(q);
      });
    }
    const now = Date.now();
    r.sort((a, b) => {
      const ta = toMs(a.closeTime);
      const tb = toMs(b.closeTime);
      const da = ta ? ta - now : Infinity;
      const db = tb ? tb - now : Infinity;
      return da - db;
    });
    return r;
  }, [events, search]);

  const handleCopyAddr = useCallback(async () => {
    if (!publicKey) return;
    const ok = await copyToClipboard(publicKey.toBase58());
    if (ok) { setToast('Address copied'); setTimeout(() => setToast(''), 1500); }
  }, [publicKey]);

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink }}>

        <PageHeader
          connected={connected}
          solBal={solBal}
          tab={tab} setTab={setTab}
          pubkey={publicKey?.toBase58()}
          onCopy={handleCopyAddr}
        />

        {toast && (
          <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 8, fontSize: 11, color: C.yes, textAlign: 'center', fontWeight: 700, ...T.mono }}>
            {toast}
          </div>
        )}

        {tab === 'markets' && (
          <>
            <div style={{ marginBottom: 10, position: 'relative' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL, JUP…" inputMode="search"
                style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontSize: 12, outline: 'none', ...T.body }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
            </div>

            {evLoading && [1, 2, 3, 4].map(i => <Skeleton key={i} />)}
            {evError && <ErrorLine msg={evError} />}
            {!evLoading && !evError && filtered.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
                {search ? `No markets match "${search}"` : 'No live crypto markets right now — new ones drop constantly. Auto-refreshing…'}
              </div>
            )}
            {!evLoading && filtered.map(ev => (
              <MarketCard
                key={ev.eventId}
                event={ev}
                livePrices={livePrices}
                priceSnapshots={priceSnapshots}
                onTrade={(event, isYes) => {
                  if (!connected) { setToast('Connect wallet first'); setTimeout(() => setToast(''), 1500); return; }
                  setBuyState({ event, isYes });
                }}
              />
            ))}
          </>
        )}

        {tab === 'positions' && (
          <PositionsList
            positions={positions}
            loading={posLoading}
            onAction={(kind, p) => setActionPos({ kind, position: p })}
          />
        )}

        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 9, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Jupiter Predict · Solana-native · Beta
        </div>
      </div>

      {buyState && (
        <BuyDrawer
          event={buyState.event}
          isYes={buyState.isYes}
          livePrices={livePrices}
          priceSnapshots={priceSnapshots}
          onClose={() => setBuyState(null)}
          onDone={() => { reloadEvents(); reloadPositions(); refreshBalances(); }}
          solBal={solBal}
          connection={connection}
        />
      )}

      {actionPos && (
        <SellOrClaimDrawer
          position={actionPos.position}
          kind={actionPos.kind}
          onClose={() => setActionPos(null)}
          onDone={() => { reloadPositions(); refreshBalances(); }}
          connection={connection}
        />
      )}
    </>
  );
}
