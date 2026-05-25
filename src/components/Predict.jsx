// Predict.jsx — Jupiter Prediction Markets on Solana.
//
// PATCHED: Buy flow now waits for keeper fill before showing success.
// The on-chain tx only opens an order account; the keeper network has to
// pick it up and fill it on the underlying market. Showing "✓ Order placed"
// the instant the tx confirms was misleading — orders could (and did) fail
// to fill while the UI claimed success.

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
const MIN_TRADE_USD = 5;
const NAV_CLEARANCE = 120;
const JUPUSD_DECIMALS = 6;
const SOL_DECIMALS    = 9;

// Priority fee paid per compute unit. Bumped to 5M microlamports for faster
// landing on time-sensitive predict orders.
const PRIORITY_FEE_MICROLAMPORTS = 5_000_000;
const CU_LIMIT_MAX      = 1_400_000;
const CU_LIMIT_FALLBACK = 600_000;
const CU_BUFFER_PERCENT = 120;

// Timeouts — tuned for "fail fast" UX. The previous values could keep a user
// hanging for 90+ seconds before surfacing an error.
const CONFIRM_TIMEOUT_MS    = 15_000;   // was 30_000
const CONFIRM_FALLBACK_MS   = 8_000;    // was 20_000
const KEEPER_POLL_INTERVAL  = 1500;     // was 2000
const KEEPER_POLL_ATTEMPTS  = 12;       // 12 × 1.5s = 18s total (was 30s)
const FETCH_TIMEOUT_MS      = 8_000;    // was 15_000
const FETCH_MAX_RETRIES     = 1;        // was 4 — no aggressive 429 backoff

const REFRESH_NORMAL_MS = 300_000;
const REFRESH_URGENT_MS = 30_000;
const URGENT_WINDOW_MS  = 15 * 60_000;

const POLY_GAMMA_BASE = 'https://gamma-api.polymarket.com';
const POLY_RTDS_WSS   = 'wss://ws-live-data.polymarket.com';
const POLY_RTDS_TOPIC = 'crypto_prices_chainlink';
const POLY_RTDS_PING_MS = 5000;

// ─── Extract reference price from Polymarket description ─────────────────────
function extractStartingPrice(text) {
  if (!text || typeof text !== 'string') return null;
  const parseNum = (raw) => {
    if (!raw) return null;
    const n = Number(String(raw).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : null;
  };
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
  return null;
}

// ─── Opening-price snapshots ─────────────────────────────────────────────────
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
      if (next[id]) continue;
      if (!isUpDownMarket(ev)) continue;
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

function isUpDownMarket(event) {
  if (!event) return false;
  const haystack = [event.title, event.market?.title, event.poly?.description]
    .filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return false;
  if (haystack.includes('up or down')) return true;
  if (haystack.includes('price to beat')) return true;
  const outcomes = event.poly?.outcomes;
  if (Array.isArray(outcomes)) {
    const set = outcomes.map(o => String(o).toLowerCase());
    if (set.includes('up') && set.includes('down')) return true;
  }
  return false;
}

function resolvePriceToBeat(event, snapshots) {
  if (!event) return null;
  if (!isUpDownMarket(event)) return null;
  const marketId = event.market?.marketId;
  if (marketId && snapshots && snapshots[marketId]) {
    const snap = snapshots[marketId];
    if (snap && Number.isFinite(snap.price) && snap.price > 0) return snap.price;
  }
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

function symbolFromSubcategory(sub) {
  if (!sub) return null;
  const s = String(sub).toLowerCase().trim();
  const map = {
    bitcoin: 'btc/usd', btc: 'btc/usd',
    ethereum: 'eth/usd', eth: 'eth/usd',
    solana: 'sol/usd', sol: 'sol/usd',
    ripple: 'xrp/usd', xrp: 'xrp/usd',
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

async function jfetch(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const maxAttempts = FETCH_MAX_RETRIES + 1;
  let attempt = 0;
  while (true) {
    attempt++;
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: c.signal });
      if (r.status === 429 && attempt < maxAttempts) {
        clearTimeout(id);
        await new Promise(res => setTimeout(res, 400));
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
  const body = String(err?.body || '').toLowerCase();
  const hay = m + ' ' + body;
  const status = err?.status;

  // Jupiter Predict API explicit error codes (from response body)
  if (hay.includes('no_shares_available') || hay.includes('no shares available'))
    return 'No shares available at this price. The market is illiquid right now — try the opposite side or a different market.';
  if (hay.includes('not_enough_liquidity') || hay.includes('insufficient liquidity'))
    return 'Not enough liquidity on this side. Try a smaller amount or the opposite side.';
  if (hay.includes('market_closed') || hay.includes('market closed') || hay.includes('market_not_open'))
    return 'Market is closed. Try a different one.';
  if (hay.includes('market_settled') || hay.includes('already settled'))
    return 'This market has already settled. Refresh the list.';
  if (hay.includes('order_too_small') || hay.includes('minimum') || hay.includes('below minimum'))
    return 'Trade is below the $5 minimum.';
  if (hay.includes('order_too_large') || hay.includes('exceeds maximum'))
    return 'Trade exceeds the market\'s maximum. Try a smaller amount.';
  if (hay.includes('price_moved') || hay.includes('price has moved'))
    return 'Price moved while we were building your order. Try again.';

  // Generic HTTP / network
  if (status === 451 || status === 403 || hay.includes('geographic') || hay.includes('region') || hay.includes('forbidden region'))
    return 'Predict is not available in your region (US / South Korea blocked by Jupiter).';
  if (status === 429 || hay.includes('too many requests'))
    return 'Rate limited. Wait a few seconds and try again.';
  if (hay.includes('insufficient'))      return 'Insufficient balance.';
  if (hay.includes('slippage'))          return 'Price moved too much. Try again.';
  if (hay.includes('blockhash') || hay.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (hay.includes('user reject') || hay.includes('user denied') || hay.includes('user cancelled') || hay.includes('cancel'))
    return 'Cancelled.';
  if (hay.includes('simulation failed')) return 'Simulation failed — the price may have moved.';
  if (hay.includes('no route'))          return 'No swap route available right now.';
  if (hay.includes('too large'))         return 'Transaction too complex. Try a smaller amount.';
  if (hay.includes('aborted') || hay.includes('abort'))
    return 'Cancelled.';
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

// Live SOL price from server (OKX ticker, cached 30s server-side).
// Fallback to a conservative 100 if the server is unreachable — this
// inflates SOL spend a bit, ensuring we always have enough JupUSD output.
async function fetchSolPrice() {
  try {
    const r = await fetch('/api/sol-price');
    if (!r.ok) return 100;
    const j = await r.json();
    const p = Number(j?.price || 0);
    return Number.isFinite(p) && p > 0 ? p : 100;
  } catch { return 100; }
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

  const eventTitle  = ev.title || evMeta.title || 'Untitled';
  const marketTitle = mktMeta.title || market.title || null;
  const image = evMeta.imageUrl || ev.imageUrl || market.imageUrl || ev.image || null;

  return {
    eventId:     ev.eventId || ev.id,
    title:       eventTitle,
    subtitle:    evMeta.subtitle || null,
    slug:        evMeta.slug || null,
    image,
    category:    String(ev.category || '').toLowerCase(),
    subcategory: ev.subcategory || null,
    series:      evMeta.series || ev.series || null,
    tags:        Array.isArray(ev.tags) ? ev.tags.filter(Boolean) : [],
    closeCondition: ev.closeCondition || null,
    rulesPdf:       ev.rulesPdf || null,
    closeTime: evMeta.closeTime ?? mktMeta.closeTime ?? market.closeTime ?? ev.closeTime ?? null,
    beginAt:   ev.beginAt || null,
    volume24h: toUsd(ev.volumeUsd ?? pricing.volume ?? 0),
    isLive:    ev.isLive !== false,
    isActive:  ev.isActive !== false,
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

const CLOSE_BUFFER_MS = 60_000;

function isMarketOpen(event) {
  if (!event) return false;
  if (event.isActive === false) return false;
  if (event.isLive === false)   return false;
  const m = event.market;
  if (!m) return false;
  if (m.status && m.status !== 'open') return false;
  if (m.result && m.result !== 'pending' && m.result !== '') return false;
  const ms = toMs(event.closeTime);
  if (ms != null && (ms - Date.now()) <= CLOSE_BUFFER_MS) return false;
  return true;
}

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

function pickPolymarketFields(pmEvent) {
  if (!pmEvent) return null;
  const pmMkt = (pmEvent.markets && pmEvent.markets[0]) || null;
  if (!isPolymarketOpen(pmEvent, pmMkt)) return { settled: true };

  let outcomes = null, outcomePrices = null;
  try { outcomes      = pmMkt?.outcomes      ? JSON.parse(pmMkt.outcomes)      : null; } catch {}
  try { outcomePrices = pmMkt?.outcomePrices ? JSON.parse(pmMkt.outcomePrices) : null; } catch {}

  const description = pmEvent.description || pmMkt?.description || null;

  return {
    settled: false,
    description,
    startingPrice: extractStartingPrice(description),
    outcomes,
    outcomePrices: Array.isArray(outcomePrices) ? outcomePrices.map(Number) : null,
    groupItemTitle:  pmMkt?.groupItemTitle  || null,
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
        pingId = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send('PING'); } catch {}
          }
        }, POLY_RTDS_PING_MS);
      };

      ws.onmessage = (ev) => {
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
      ws.onerror = () => { };
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
      if (ws) { try { ws.close(); } catch {} }
    };
  }, [enabled]);

  return prices;
}

function pickPositionFields(p) {
  if (!p) return null;
  const contracts     = Number(p.contracts || 0);
  const openOrders    = Number(p.openOrders || 0);
  const avgPriceUsd   = toUsd(p.avgPriceUsd);
  const markPriceUsd  = p.markPriceUsd != null ? toUsd(p.markPriceUsd) : null;
  const sellPriceUsd  = p.sellPriceUsd != null ? toUsd(p.sellPriceUsd) : null;
  const costUsd       = toUsd(p.totalCostUsd ?? p.sizeUsd) || contracts * avgPriceUsd;
  const valueUsd      = p.valueUsd != null
    ? toUsd(p.valueUsd)
    : (markPriceUsd != null ? contracts * markPriceUsd : null);
  const pnlUsd        = p.pnlUsd != null
    ? toUsd(p.pnlUsd)
    : (valueUsd != null ? (valueUsd - costUsd) : null);
  const pnlUsdPercent = p.pnlUsdPercent != null
    ? Number(p.pnlUsdPercent)
    : (costUsd > 0 && pnlUsd != null ? (pnlUsd / costUsd) * 100 : null);
  const pnlAfterFeesUsd     = p.pnlUsdAfterFees != null ? toUsd(p.pnlUsdAfterFees) : null;
  const pnlAfterFeesPercent = p.pnlUsdAfterFeesPercent != null
    ? Number(p.pnlUsdAfterFeesPercent) : null;
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
    positionPubkey: p.pubkey || p.positionPubkey,
    ownerPubkey:    p.ownerPubkey || null,
    marketId:       p.marketId,
    isYes:          !!p.isYes,
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
    contracts,
    openOrders,
    claimable: !!p.claimable,
    claimed:   !!p.claimed,
    status:    p.claimed ? 'claimed' : (p.claimable ? 'claimable' : 'active'),
    openedAt:       p.openedAt || null,
    updatedAt:      p.updatedAt || null,
    claimableAt:    p.claimableAt || null,
    settlementDate: p.settlementDate || null,
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

// JupUSD ATA owned by FEE_WALLET — Jupiter sends platform fees here on
// every swap. Account must exist on-chain (created once via Phantom or
// a setup script). Same address for both buy and sell swap legs since
// we always take the fee in JupUSD.
const FEE_JUPUSD_ATA = getAssociatedTokenAddressSync(
  new PublicKey(JUPUSD_MINT), FEE_WALLET, true, TOKEN_PROGRAM_ID,
);

// SOL → JupUSD swap, with 5% fee taken in JupUSD via Jupiter's native
// platformFeeBps parameter. Jupiter bakes the fee transfer into its own
// swap instruction — no manual splicing, no Blowfish flags.
// SOL → JupUSD swap in ExactIn mode. Caller specifies the SOL amount to
// spend (calculated client-side to include 5% headroom). Jupiter takes the
// 5% fee out of the JupUSD output → user nets ~target_deposit_usd.
//
// Why ExactIn: Jupiter's /build endpoint silently ignores swapMode=ExactOut.
// To still charge "fee on top", we inflate the SOL input by ~5% upstream.
//
// Fee mint for ExactIn can be input OR output. We use OUTPUT (JupUSD) so
// the fee lands as stable dollars in our wallet — easier to account for.
//
// Tip: pass tipAmount so Jupiter adds a tip-receiver transfer. Required for
// landing via /submit (fast TPU forwarding via Jupiter's staked validator).
const JUPITER_TIP_LAMPORTS = 1_000_000n; // 0.001 SOL (~$0.17), minimum per docs

async function buildSolToJupUsdSwapTx({ connection, ownerPubkey, grossLamports }) {
  if (grossLamports <= 0n) throw new Error('Amount too small.');

  const params = new URLSearchParams({
    inputMint:      SOL_MINT,
    outputMint:     JUPUSD_MINT,
    amount:         grossLamports.toString(),
    slippageBps:    String(SLIPPAGE_BPS),
    taker:          ownerPubkey.toBase58(),
    platformFeeBps: String(FEE_BPS),
    feeAccount:     FEE_JUPUSD_ATA.toBase58(),
    tipAmount:      JUPITER_TIP_LAMPORTS.toString(),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  // outAmount is the NET JupUSD the user receives after Jupiter takes our fee.
  const expectedJupUsdAtomic = BigInt(build.outAmount || 0);
  if (expectedJupUsdAtomic <= 0n) throw new Error('Jupiter quote returned zero output');

  // Per Jupiter docs: include their `computeBudgetInstructions` (CU price,
  // routing-aware priority fee) and add our own CU limit. Don't override
  // Jupiter's price — it's tuned to the route.
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT_FALLBACK }),
    ...(build.computeBudgetInstructions || []).map(deserIx),
    ...(build.setupInstructions || []).map(deserIx),
    deserIx(build.swapInstruction),
    ...(build.cleanupInstruction ? [deserIx(build.cleanupInstruction)] : []),
    ...(build.otherInstructions || []).map(deserIx),
    ...(build.tipInstruction ? [deserIx(build.tipInstruction)] : []),
  ];

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
  const msg = new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  return { tx: new VersionedTransaction(msg), expectedJupUsdAtomic, latestBlockhash };
}

// JupUSD → SOL swap (ExactIn). 5% fee taken in JupUSD (input mint).
// User receives ~95% of their JupUSD as SOL.
// Tip included for fast landing via /submit.
async function buildJupUsdToSolSwapTx({ connection, ownerPubkey, grossJupUsdAtomic }) {
  if (grossJupUsdAtomic <= 0n) throw new Error('Amount too small.');

  const params = new URLSearchParams({
    inputMint:      JUPUSD_MINT,
    outputMint:     SOL_MINT,
    amount:         grossJupUsdAtomic.toString(),
    slippageBps:    String(SLIPPAGE_BPS),
    taker:          ownerPubkey.toBase58(),
    platformFeeBps: String(FEE_BPS),
    feeAccount:     FEE_JUPUSD_ATA.toBase58(),
    tipAmount:      JUPITER_TIP_LAMPORTS.toString(),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  const expectedSolLamports = BigInt(build.outAmount || 0);

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT_FALLBACK }),
    ...(build.computeBudgetInstructions || []).map(deserIx),
    ...(build.setupInstructions || []).map(deserIx),
    deserIx(build.swapInstruction),
    ...(build.cleanupInstruction ? [deserIx(build.cleanupInstruction)] : []),
    ...(build.otherInstructions || []).map(deserIx),
    ...(build.tipInstruction ? [deserIx(build.tipInstruction)] : []),
  ];

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
  const msg = new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  return { tx: new VersionedTransaction(msg), expectedSolLamports, latestBlockhash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Predict order builders
// ═══════════════════════════════════════════════════════════════════════════════

// Build a buy order tx. Predict orders are unchanged from Jupiter — no fee
// instructions added. The 5% fee is taken on the SOL↔JupUSD swap legs
// instead, via Jupiter's native platformFeeBps. Keeps the order tx clean,
// fast, and free of Blowfish warnings.
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

  // Per Jupiter docs (open-positions guide), canonical path is
  // `j.order.orderPubkey`. Check that first; fall back to other possible
  // shapes for safety against minor API variations.
  const orderPubkey =
    j.order?.orderPubkey ||
    j.orderPubkey ||
    j.order?.pubkey ||
    (typeof j.order === 'string' ? j.order : null) ||
    j.pubkey ||
    null;

  return {
    tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)),
    orderPubkey,
    orderInfo: j.order || null,
  };
}

// Poll the order status endpoint until the keeper either fills, rejects,
// or we time out. Returns 'filled' | 'failed' | 'pending'.
//
// IMPORTANT: 'pending' here means we timed out waiting. The order may still
// fill later — the caller should not treat 'pending' as success.
async function pollOrderStatus(orderPubkey, {
  maxAttempts = KEEPER_POLL_ATTEMPTS,
  intervalMs = KEEPER_POLL_INTERVAL,
  onTick,
  signal,
} = {}) {
  if (!orderPubkey) return 'pending';
  // Quick first poll — keeper may have filled instantly.
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return 'aborted';
    try {
      onTick?.(i + 1, maxAttempts);
      const r = await jfetch(`/api/predict/orders/status/${encodeURIComponent(orderPubkey)}`, {}, 4000);
      if (r.ok) {
        const j = await r.json();
        const status = (j?.status || j?.data?.status || '').toLowerCase();
        if (status === 'filled' || status === 'complete' || status === 'completed') return 'filled';
        if (status === 'failed' || status === 'rejected' || status === 'cancelled' || status === 'canceled') return 'failed';
      }
    } catch {}
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

// Pre-flight simulation. Runs the tx against current chain state WITHOUT
// signing or submitting. If it would fail on-chain, throw with a friendly
// message so the user never signs a doomed tx and never loses funds to a
// failed Predict order.
//
// This catches Custom Program Error: 1 (InsufficientFunds), slippage
// rejections, expired blockhashes, account-not-ready errors, etc.
async function simulateOrThrow(connection, tx, label) {
  const mapSimErr = (logs, errObj) => {
    const errStr = JSON.stringify(errObj || '').toLowerCase();
    const logsStr = (logs || []).join('\n').toLowerCase();
    const all = errStr + ' ' + logsStr;
    if (all.includes('"custom":1') || all.includes('custom program error: 1') || all.includes('insufficient'))
      return 'Not enough JupUSD to place the order. Refresh balances and try again.';
    if (all.includes('slippage') || all.includes('0x1771'))
      return 'Price moved too far — try again.';
    if (all.includes('account not') || all.includes('uninitialized') || all.includes('accountnotinitialized'))
      return 'Token account not ready. Try again in a moment.';
    if (all.includes('blockhash') || all.includes('expired'))
      return 'Quote expired. Please retry.';
    if (all.includes('no_shares') || all.includes('no shares'))
      return 'No shares available at this price right now.';
    if (all.includes('not_enough_liquidity') || all.includes('not enough liquidity'))
      return 'Not enough liquidity for this trade size.';
    if (all.includes('market_closed') || all.includes('market closed'))
      return 'Market is closed.';
    return null;
  };
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
    });
    if (sim.value.err) {
      const mapped = mapSimErr(sim.value.logs, sim.value.err);
      console.warn(`[predict] ${label} simulation failed:`, sim.value.err, sim.value.logs?.slice(-8));
      throw new Error(mapped || `Pre-flight check failed for ${label}: ${JSON.stringify(sim.value.err)}`);
    }
  } catch (e) {
    // Bubble up known pre-flight errors. Network errors during sim are
    // non-fatal — we'd rather submit and let the on-chain confirm decide
    // than block on a flaky RPC.
    const msg = String(e?.message || '');
    if (/not enough|moved|expired|not ready|no shares|liquidity|market closed|pre-flight/i.test(msg)) {
      throw e;
    }
    console.warn(`[predict] ${label} sim non-fatal (network):`, msg);
  }
}

async function sendAndConfirm(connection, signedTx, blockhashInfo, setStMsg, signal) {
  if (signal?.aborted) throw new Error('Cancelled.');
  setStMsg('Submitting…');
  // skipPreflight=true: trust client-side simulation we already did, skip
  // the second server-side preflight. Saves ~1-2s per tx.
  const sig = await connection.sendRawTransaction(signedTx.serialize(), {
    maxRetries: 3, skipPreflight: true, preflightCommitment: 'confirmed',
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
    return { sig, pending: false };
  } catch (e) {
    if (/on-chain/i.test(String(e?.message))) throw e;
    // Fallback: poll signature status briefly. Many txs land but the
    // blockhash-based confirm subscription misses the event.
    const deadline = Date.now() + CONFIRM_FALLBACK_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Cancelled.');
      await new Promise(r => setTimeout(r, 1500));
      try {
        const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (st?.value?.err) throw new Error('On-chain error: ' + JSON.stringify(st.value.err));
        const cs = st?.value?.confirmationStatus;
        if (cs === 'confirmed' || cs === 'finalized') return { sig, pending: false };
      } catch (inner) {
        if (/on-chain/i.test(String(inner?.message))) throw inner;
      }
    }
    return { sig, pending: true };
  }
}

// Submit a signed swap tx via Jupiter's /submit endpoint for fast landing.
// Jupiter forwards via their high-stake validator's TPU (SWQoS) → typically
// lands in 1-2 slots vs 3-10 slots for generic RPC. Costs 0.001 SOL tip
// (~$0.17) baked into the tx via tipAmount on /build.
//
// Per docs, /submit is keyless and works without an API key. We hit Jupiter
// directly from the client to avoid needing a new server proxy route.
async function submitViaJupiter(connection, signedTx, blockhashInfo, setStMsg, signal) {
  if (signal?.aborted) throw new Error('Cancelled.');
  setStMsg('Submitting via Jupiter…');

  const b64 = Buffer.from(signedTx.serialize()).toString('base64');
  const res = await fetch('https://api.jup.ag/tx/v1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTransaction: b64 }),
    signal,
  });
  const body = await res.text();
  let json; try { json = JSON.parse(body); } catch {}
  if (!res.ok || !json?.signature) {
    // Fall back to regular RPC if /submit refuses.
    console.warn('[predict] /submit failed, falling back to RPC:', res.status, body.slice(0, 200));
    return sendAndConfirm(connection, signedTx, blockhashInfo, setStMsg, signal);
  }
  const sig = json.signature;

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
    return { sig, pending: false };
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

// ─── Debug log ─────────────────────────────────────────────────────────────
// On-screen log that lets us see what's happening on iPhone without
// DevTools. Every step of the buy/sell/claim flow pushes a line here, and
// the DebugPanel renders them with a copy button so you can paste the log
// back to me to diagnose failures.
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
    // Also log to console for desktop debugging.
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
        <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: 'pointer', padding: 0, ...T.mono }}>
          DEBUG LOG ({log.length}) {expanded ? '▼' : '▶'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => copyToClipboard(text)} style={{ padding: '3px 8px', borderRadius: 6, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 9, fontWeight: 700, cursor: 'pointer', ...T.mono }}>COPY</button>
          <button onClick={onClear} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,95,122,.1)', border: '1px solid rgba(255,95,122,.3)', color: C.no, fontSize: 9, fontWeight: 700, cursor: 'pointer', ...T.mono }}>CLEAR</button>
        </div>
      </div>
      {expanded && (
        <div style={{ maxHeight: 220, overflowY: 'auto', color: C.ink, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {log.map((l, i) => {
            const isErr = l.tag.includes('error') || l.tag.includes('fail');
            return (
              <div key={i} style={{ marginBottom: 4, color: isErr ? C.no : C.ink }}>
                <span style={{ color: C.muted2 }}>[{l.time}]</span>{' '}
                <span style={{ color: isErr ? C.no : C.hl, fontWeight: 700 }}>{l.tag}:</span>{' '}
                <span>{l.msg}</span>
                {l.payload && <div style={{ paddingLeft: 8, color: C.muted, fontSize: 9, marginTop: 2 }}>{l.payload}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Wrap a fetch-style call and log its full request/response cycle. Used
// inside placeOrder/sell/claim so any non-2xx from /api/predict surfaces.
async function loggedFetch(url, opts, dbg, label) {
  dbg(`http:${label}:req`, `${opts?.method || 'GET'} ${url}`, opts?.body ? { body: opts.body } : undefined);
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    if (!r.ok) {
      dbg(`http:${label}:fail`, `${r.status} ${r.statusText}`, parsed || text.slice(0, 400));
      const err = new Error(`HTTP ${r.status}: ${(text || r.statusText).slice(0, 300)}`);
      err.status = r.status; err.body = text;
      throw err;
    }
    dbg(`http:${label}:ok`, `${r.status}`, parsed ? Object.keys(parsed) : text.slice(0, 200));
    return { response: r, json: parsed, text };
  } catch (e) {
    if (e.status === undefined) {
      dbg(`http:${label}:error`, e?.message || String(e));
    }
    throw e;
  }
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

  const yesLabel = poly?.outcomes?.[0] || 'Yes';
  const noLabel  = poly?.outcomes?.[1] || 'No';

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

  // USD-denominated amount. We always swap SOL → JupUSD via Jupiter (which
  // takes our 5% fee in JupUSD natively), then place the Predict order with
  // the JupUSD we received. Two signatures, clean Jupiter txs, no Blowfish.
  const [amount, setAmount]   = useState('10');
  const [step, setStep]       = useState(0);
  const [statusMsg, setStMsg] = useState('');
  const [error, setError]     = useState('');
  const [warning, setWarning] = useState('');
  const [showRules, setShowRules] = useState(false);
  const { log: debugLog, push: dbg, clear: clearDbg } = useDebugLog();
  const abortRef = React.useRef(null);

  useBodyLock(true);

  const m          = event.market;
  const poly       = event.poly || null;

  // User types the DEPOSIT amount (what they want going into the prediction).
  // User types the DEPOSIT amount. Fee is 5% ON TOP. We swap enough SOL to
  // receive deposit+fee in JupUSD; Jupiter takes the 5% fee from the JupUSD
  // output, user nets the full deposit into Predict.
  //
  // SOL_PRICE_GUESS is used ONLY for the disabled/enabled state of the Buy
  // button. The actual swap uses a live SOL price fetched server-side at
  // placeOrder() time.
  const SOL_PRICE_GUESS = 100;
  const depositUsd      = Number(amount) || 0;
  const feeUsd          = depositUsd * (FEE_BPS / 10000);
  const totalUsd        = depositUsd + feeUsd;
  const depositAtomic   = BigInt(Math.round(depositUsd * 1e6));   // JupUSD to deposit
  const estTotalLamports = BigInt(Math.round((totalUsd / SOL_PRICE_GUESS) * 1e9)) + JUPITER_TIP_LAMPORTS;
  const hasBalance      = solBal >= estTotalLamports && estTotalLamports > 0n;

  const price         = isYes ? m.yesPrice : m.noPrice;
  const contractsEst  = price > 0 ? depositUsd / price : 0;

  const sideLabel = (poly?.outcomes && poly.outcomes[isYes ? 0 : 1]) || (isYes ? 'YES' : 'NO');
  const sideColor = isYes ? C.yes : C.no;
  const sideDim   = isYes ? C.yesDim : C.noDim;

  const busy   = step > 0 && step < 4;
  const canBuy = !busy && depositUsd >= MIN_TRADE_USD && publicKey && m.marketId && hasBalance;

  const placeOrder = useCallback(async () => {
    dbg('buy:start', `marketId=${m.marketId} side=${isYes ? 'YES' : 'NO'} deposit=$${depositUsd}`);
    if (!publicKey || !signTransaction) {
      setError('Connect a wallet that supports signTransaction.');
      return;
    }
    if (depositUsd < MIN_TRADE_USD) {
      setError(`Minimum deposit is $${MIN_TRADE_USD}.`);
      return;
    }

    setError(''); setWarning('');
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const checkAbort = () => { if (signal.aborted) throw new Error('Cancelled.'); };

    try {
      const ownerB58 = publicKey.toBase58();

      // STEP 1: Swap SOL → JupUSD (ExactIn).
      // Compute SOL input so JupUSD output ≈ deposit + 5% fee.
      // Jupiter takes 5% from the output → user nets the deposit.
      setStep(1); setStMsg('Pricing swap…');
      const solPrice = await fetchSolPrice();
      dbg('buy:1', `live SOL price: $${solPrice.toFixed(2)}`);
      // Add a small safety margin (1%) for SOL price drift between fetch and swap.
      const grossUsdToSwap = totalUsd * 1.01;
      const grossLamports  = BigInt(Math.round((grossUsdToSwap / solPrice) * 1e9));
      dbg('buy:1', `ExactIn: spend ${(Number(grossLamports) / 1e9).toFixed(6)} SOL → ~$${grossUsdToSwap.toFixed(2)} JupUSD (5% goes to fee, user nets $${depositUsd})`);
      checkAbort();

      const { tx: swapTx, expectedJupUsdAtomic, latestBlockhash: swapBh } =
        await buildSolToJupUsdSwapTx({ connection, ownerPubkey: publicKey, grossLamports });
      const netJupUsd = Number(expectedJupUsdAtomic) / 1e6;
      dbg('buy:1', `expected JupUSD out (net of 5% fee): ${netJupUsd.toFixed(4)}`);
      checkAbort();

      if (expectedJupUsdAtomic < depositAtomic) {
        // SOL price drifted upward — output less than target deposit.
        // Proceed but warn; the order will use whatever we received.
        dbg('buy:1', `WARNING: net ${netJupUsd.toFixed(4)} < target ${depositUsd}, proceeding with reduced deposit`);
      }

      setStMsg('Confirm Step 1 of 2 — Swap SOL → JupUSD');
      const signedSwap = await signTransaction(swapTx);
      checkAbort();

      setStMsg('Swapping (fast)…');
      const swapResult = await submitViaJupiter(connection, signedSwap, swapBh, setStMsg, signal);
      dbg('buy:1', `swap confirmed: ${swapResult.sig}`);
      if (swapResult.pending) throw new Error(`Swap confirming: ${swapResult.sig}`);

      // STEP 2: Place Predict order. CRITICAL: must re-fetch actual JupUSD
      // balance, NOT trust the swap quote's expectedJupUsdAtomic. The quote
      // is what we ASKED for; slippage can mean we got slightly less. If we
      // ask Predict to deposit more than we actually have, it fails with
      // Custom Program Error: 1 (InsufficientFunds) and you lose ~all the
      // collateral. This re-fetch costs ~1s but prevents that loss.
      setStep(2); setStMsg('Reading JupUSD balance…');
      const actualJupUsd = await fetchJupUsdBalance(connection, ownerB58);
      dbg('buy:2', `JupUSD balance: ${(Number(actualJupUsd) / 1e6).toFixed(4)} (quoted: ${(Number(expectedJupUsdAtomic) / 1e6).toFixed(4)})`);

      // Use what user ACTUALLY has, capped at the quoted amount (so we
      // don't accidentally spend their pre-existing JupUSD).
      // Then subtract a tiny safety margin (1000 atomic = $0.001) to absorb
      // any rounding inside Predict's program.
      const SAFETY_MARGIN = 1000n;
      let orderDeposit = actualJupUsd < expectedJupUsdAtomic ? actualJupUsd : expectedJupUsdAtomic;
      if (orderDeposit > SAFETY_MARGIN) orderDeposit -= SAFETY_MARGIN;
      if (orderDeposit <= 0n) throw new Error('Swap landed but no JupUSD found. Refresh.');
      dbg('buy:2', `order deposit (after safety margin): ${(Number(orderDeposit) / 1e6).toFixed(4)}`);

      setStMsg('Building order…');
      const orderRequest = await loggedFetch(
        '/api/predict/orders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerPubkey: ownerB58,
            marketId: m.marketId,
            isYes,
            isBuy: true,
            depositAmount: orderDeposit.toString(),
            depositMint: JUPUSD_MINT,
          }),
          signal,
        },
        dbg,
        'predict-orders',
      );
      checkAbort();

      const j = orderRequest.json;
      if (!j?.transaction) {
        dbg('buy:2:fail', 'no transaction in response', j);
        throw new Error('Jupiter Predict returned no transaction.');
      }
      const orderPubkey =
        j.order?.orderPubkey || j.orderPubkey ||
        (typeof j.order === 'string' ? j.order : null) || j.pubkey || null;
      dbg('buy:2', `orderPubkey: ${orderPubkey || '(none)'}`);

      const buyTx = VersionedTransaction.deserialize(b64ToBytes(j.transaction));

      // PRE-FLIGHT: simulate against current chain state before asking the
      // user to sign. If this fails, we throw a friendly error and the user
      // never signs a doomed tx and never loses funds.
      setStMsg('Pre-checking order…');
      dbg('buy:2', 'simulating order tx');
      await simulateOrThrow(connection, buyTx, 'buy order');
      dbg('buy:2', 'simulation passed');
      checkAbort();

      setStMsg(`Confirm Step 2 of 2 — Buy ${sideLabel}`);
      const signedBuy = await signTransaction(buyTx);
      checkAbort();

      setStMsg('Submitting order…');
      const orderResult = await sendAndConfirm(connection, signedBuy, null, setStMsg, signal);
      dbg('buy:2', `order tx landed: ${orderResult.sig}`);
      if (orderResult.pending) throw new Error(`Order confirming: ${orderResult.sig}`);

      // STEP 3: Wait for keeper fill — tx landing ≠ filled
      setStep(3);

      if (!orderPubkey) {
        setWarning('Order submitted but no order pubkey to track. Check Positions.');
        setStep(4); setStMsg('');
        onDone?.(); setTimeout(() => onClose(), 3200);
        return;
      }

      setStMsg('Waiting for keeper to fill…');
      let lastStatus = null;
      const fillStatus = await pollOrderStatus(orderPubkey, {
        signal,
        onTick: async (i, total) => {
          setStMsg(`Waiting for keeper… (${i}/${total})`);
          try {
            const r = await fetch(`/api/predict/orders/status/${encodeURIComponent(orderPubkey)}`, { signal });
            const t = await r.text();
            let p = null; try { p = JSON.parse(t); } catch {}
            const st = p?.status || p?.data?.status || `(http ${r.status})`;
            if (st !== lastStatus) { dbg('buy:3:poll', `[${i}/${total}] status=${st}`); lastStatus = st; }
          } catch (e) { dbg('buy:3:poll', `[${i}/${total}] error: ${e.message}`); }
        },
      });
      dbg('buy:3', `final: ${fillStatus}`);

      if (fillStatus === 'aborted') throw new Error('Cancelled.');
      if (fillStatus === 'failed') {
        throw new Error('Order rejected by keeper. Check wallet for refund.');
      }
      if (fillStatus === 'pending') {
        setWarning('Order hasn\'t filled yet. May still go through — check Positions.');
        setStep(4); setStMsg('');
        onDone?.(); setTimeout(() => onClose(), 3200);
        return;
      }

      // CRITICAL: status='filled' from the keeper API doesn't always mean
      // a position was actually created. Verify by fetching positions and
      // confirming one exists for this market+side.
      setStMsg('Verifying position…');
      try {
        const positions = await fetchPositions(ownerB58);
        const found = positions?.find(p =>
          p?.marketId === m.marketId && Boolean(p?.isYes) === Boolean(isYes) && Number(p?.contracts || 0) > 0
        );
        if (!found) {
          dbg('buy:verify', 'keeper said filled but no position exists', { positionCount: positions?.length });
          throw new Error('Keeper reported filled but no position was created. Check wallet — your JupUSD should be refunded shortly.');
        }
        dbg('buy:verify', `position found: ${found.contracts} contracts @ ${found.avgPriceUsd || '?'}`);
      } catch (e) {
        if (/no position|refund/i.test(e?.message || '')) throw e;
        // Position fetch failed — don't claim success without confirmation.
        dbg('buy:verify', `position check error: ${e?.message}`);
        setWarning('Order submitted. Could not verify position — check Positions tab.');
        setStep(4); setStMsg('');
        onDone?.(); setTimeout(() => onClose(), 3200);
        return;
      }

      dbg('buy:done', 'position confirmed');
      setStep(4); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 1800);
    } catch (e) {
      dbg('buy:error', e?.message || String(e), { status: e?.status, body: e?.body?.slice?.(0, 400) });
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    }
  }, [
    publicKey, signTransaction, m, isYes, depositUsd, depositAtomic,
    connection, onClose, onDone, sideLabel, dbg,
  ]);

  // USD presets
  const presets = ['5', '10', '25', '50'];

  const rulesText = poly?.description || m.rulesPrimary || event.closeCondition;
  const threshold = poly?.groupItemTitle;

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

  const buttonLabel = (() => {
    if (busy) return statusMsg || 'Working…';
    if (step === 4) return warning ? '⚠ Submitted — check Positions' : '✓ Order filled';
    return `Buy ${sideLabel} · $${totalUsd.toFixed(2)}`;
  })();

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />

        {/* Progress bar: 3 phases. Sign+swap, sign+order, wait for fill. */}
        {busy && <StepBadge current={step} total={3} />}

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
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>Deposit amount (fee added on top)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 16, color: C.muted, fontWeight: 700, ...T.display }}>$</span>
            <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USD</span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
            {presets.map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 6, borderRadius: 7, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: 9, borderRadius: 10, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 10 }}>
          <Row label="Deposit (to Predict)" value={fmtUsd(depositUsd)} />
          <Row label="Platform fee (5%)" value={`~${fmtUsd(feeUsd)}`} />
          <Row label="Network tip" value="~$0.17 (fast landing)" />
          <Row label="Total cost" value={`~${fmtUsd(totalUsd + 0.17)} in SOL`} valueColor={C.hl} bold />
          <Row label="Est. contracts" value={`~${contractsEst.toFixed(2)}`} />
          <Row label={`If ${sideLabel} wins`} value={`~${fmtUsd(contractsEst)}`} valueColor={sideColor} bold />
          {formatEndDate(event.closeTime) && (
            <Row label="Closes" value={formatEndDate(event.closeTime)} />
          )}
        </div>

        {statusMsg && <StatusLine msg={statusMsg} step={busy ? `STEP ${Math.min(step, 3)} OF 3` : null} />}
        {error && <ErrorLine msg={error} />}
        {warning && !error && (
          <div style={{ marginBottom: 8, padding: 8, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', borderRadius: 10, fontSize: 11, color: C.amber, fontWeight: 600, lineHeight: 1.4 }}>
            {warning}
          </div>
        )}

        {!hasBalance && depositUsd > 0 && !busy && (
          <div style={{ marginBottom: 8, padding: 8, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', borderRadius: 10, fontSize: 11, color: C.amber, fontWeight: 600 }}>
            Insufficient SOL — need ~${totalUsd.toFixed(2)} worth (deposit + 5% fee).
          </div>
        )}

        <PrimaryButton
          onClick={canBuy ? placeOrder : undefined}
          disabled={!canBuy || step === 4}
          color={isYes ? 'yes' : 'no'}
          label={buttonLabel}
        />

        <DebugPanel log={debugLog} onClear={clearDbg} />
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

  // ─── Position state ─────────────────────────────────────────────────────
  // A position can be in one of:
  //   - active   : market still open, can sell at mark price
  //   - claimable: market resolved in user's favor, claim payout
  //   - claimed  : user has already claimed payout
  //   - lost     : market resolved against user, contracts worth $0
  //   - settling : market closed but result not finalized yet
  //
  // The previous code only handled active/claimable/claimed and showed a
  // Sell button on lost positions, which is misleading — there's nothing
  // to sell when mark price is $0 on a settled market.
  const isClaimable = p.claimable && !p.claimed;
  const isClaimed   = p.claimed;
  const isResolved  = p.marketStatus === 'settled' || p.marketStatus === 'resolved'
                    || (p.marketResult && p.marketResult !== 'pending' && p.marketResult !== '');
  const wonResolved = isResolved && !!p.marketResult && (
    (p.marketResult.toLowerCase() === 'yes' && p.isYes) ||
    (p.marketResult.toLowerCase() === 'no'  && !p.isYes)
  );
  const lostResolved = isResolved && !isClaimable && !isClaimed && !wonResolved;
  const isSettling   = isResolved && !isClaimable && !isClaimed && !lostResolved;

  // Mark price = 0 with no claimable flag and not yet settled is a strong
  // hint the market resolved against us (server hasn't surfaced the result
  // field yet). Treat the same as lost.
  const inferredLost = !isClaimable && !isClaimed && !isResolved
                    && p.markPriceUsd === 0 && p.contracts > 0;

  return (
    <div style={{
      padding: 10, borderRadius: 14,
      background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`,
      border: `1px solid ${lostResolved || inferredLost ? 'rgba(255,95,122,.20)' : isClaimable ? 'rgba(0,212,163,.30)' : C.border}`,
      marginBottom: 7,
      boxShadow: C.shadow,
      opacity: lostResolved || inferredLost || isClaimed ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 4, ...T.body }}>{p.title}</div>
          {p.outcomeLabel && p.outcomeLabel !== p.title && (
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, ...T.mono }}>{p.outcomeLabel}</div>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{p.isYes ? 'YES' : 'NO'}</div>
            {isClaimable && (
              <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: C.yesDim, border: `1px solid ${C.yes}55`, color: C.yes, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>WON</div>
            )}
            {(lostResolved || inferredLost) && (
              <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: C.noDim, border: `1px solid ${C.no}55`, color: C.no, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>LOST</div>
            )}
            {isSettling && (
              <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'rgba(245,181,61,.15)', border: '1px solid rgba(245,181,61,.40)', color: C.amber, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>SETTLING</div>
            )}
            {isClaimed && (
              <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>CLAIMED</div>
            )}
          </div>
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
      ) : (lostResolved || inferredLost) ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.no, fontWeight: 700, padding: 8, ...T.mono }}>
          Lost · −{fmtUsd(p.costUsd)}
        </div>
      ) : isSettling ? (
        <div style={{ textAlign: 'center', fontSize: 11, color: C.amber, fontWeight: 700, padding: 8, ...T.mono }}>
          Awaiting settlement…
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
  const { log: debugLog, push: dbg, clear: clearDbg } = useDebugLog();
  const abortRef = React.useRef(null);
  const cancel = useCallback(() => {
    if (abortRef.current) { try { abortRef.current.abort(); } catch {} }
    dbg(`${kind}:cancel`, 'user cancelled');
    setStep(0); setStMsg(''); setError('Cancelled.');
  }, [dbg, kind]);

  useBodyLock(true);

  const busy   = step > 0 && step < 3;
  const isClaim = kind === 'claim';
  const grossUsd = isClaim ? position.payoutUsd : position.valueUsd;

  const handleAction = useCallback(async () => {
    dbg(`${kind}:start`, `position=${position.positionPubkey} contracts=${position.contracts} side=${position.isYes ? 'YES' : 'NO'}`);
    if (!publicKey || !signTransaction) {
      dbg(`${kind}:abort`, 'no wallet');
      setError('Connect a wallet that supports signTransaction.');
      return;
    }
    setError('');
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const checkAbort = () => { if (signal.aborted) throw new Error('Cancelled.'); };

    try {
      setStep(1);
      setStMsg(`Building ${isClaim ? 'claim' : 'sell'}…`);
      const ownerB58 = publicKey.toBase58();

      const url = isClaim
        ? `/api/predict/positions/${encodeURIComponent(position.positionPubkey)}/claim`
        : `/api/predict/positions/${encodeURIComponent(position.positionPubkey)}`;
      const method = isClaim ? 'POST' : 'DELETE';
      dbg(`${kind}:1`, `${method} ${url}`);

      const request = await loggedFetch(
        url,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerPubkey: ownerB58 }),
          signal,
        },
        dbg,
        `predict-${kind}`,
      );
      checkAbort();

      const j = request.json;
      if (!j?.transaction) {
        dbg(`${kind}:1:fail`, 'no transaction in response', j);
        throw new Error(`No ${kind} tx returned. See debug log.`);
      }
      const predictTx = VersionedTransaction.deserialize(b64ToBytes(j.transaction));
      dbg(`${kind}:1`, 'tx deserialized');

      // PRE-FLIGHT: simulate before signing so user never signs a doomed tx.
      setStMsg('Pre-checking…');
      await simulateOrThrow(connection, predictTx, kind);
      dbg(`${kind}:1`, 'simulation passed');
      checkAbort();

      setStMsg(`Confirm Step 1 of 2 in wallet — ${isClaim ? 'Claim winnings' : 'Sell contracts'}`);
      const signedPredict = await signTransaction(predictTx);
      checkAbort();
      dbg(`${kind}:1`, 'signed');

      setStMsg(isClaim ? 'Claiming…' : 'Selling…');
      const predictResult = await sendAndConfirm(connection, signedPredict, null, setStMsg, signal);
      dbg(`${kind}:1`, `landed: ${predictResult.sig}`, { pending: predictResult.pending });
      if (predictResult.pending) throw new Error(`${kind} tx confirming: ${predictResult.sig}`);

      setStep(2);
      setStMsg('Reading JupUSD balance…');
      const actualJupUsd = await fetchJupUsdBalance(connection, ownerB58);
      dbg(`${kind}:2`, `JupUSD balance: ${(Number(actualJupUsd) / 1e6).toFixed(4)}`);
      if (actualJupUsd <= 0n) throw new Error('No JupUSD to swap. Refresh and try again.');

      setStMsg('Building swap…');
      const { tx: swapTx, latestBlockhash: swapBh } = await buildJupUsdToSolSwapTx({
        connection,
        ownerPubkey: publicKey,
        grossJupUsdAtomic: actualJupUsd,
      });
      checkAbort();
      dbg(`${kind}:2`, 'swap tx built');

      setStMsg('Confirm Step 2 of 2 in wallet — Swap JupUSD → SOL');
      const signedSwap = await signTransaction(swapTx);
      checkAbort();
      dbg(`${kind}:2`, 'swap signed');

      setStMsg('Swapping (fast)…');
      const swapResult = await submitViaJupiter(connection, signedSwap, swapBh, setStMsg, signal);
      dbg(`${kind}:2`, `swap landed: ${swapResult.sig}`, { pending: swapResult.pending });
      if (swapResult.pending) throw new Error(`Swap confirming: ${swapResult.sig}`);

      dbg(`${kind}:done`, 'complete');
      setStep(3); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 1800);
    } catch (e) {
      dbg(`${kind}:error`, e?.message || String(e), { status: e?.status, body: e?.body?.slice?.(0, 400) });
      setError(friendlyError(e));
      setStep(0); setStMsg('');
    }
  }, [publicKey, signTransaction, position, isClaim, kind, connection, onDone, onClose, dbg]);

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

        <DebugPanel log={debugLog} onClear={clearDbg} />
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
  const { log: pageLog, push: pageDbg, clear: clearPageDbg } = useDebugLog();

  const livePrices = useLiveCryptoPrices(tab === 'markets');
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
      const normalized = raw
        .map((ev, i) => {
          try { return pickEventFields(ev); }
          catch (e) { console.warn('pickEventFields failed', i, e?.message); return null; }
        })
        .filter(Boolean)
        .filter(isMarketOpen);

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
          if (pm?.settled) return null;
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
      pageDbg('positions:fetch', `GET /api/predict/positions?ownerPubkey=${publicKey.toBase58().slice(0, 8)}…`);
      const r = await fetch(`/api/predict/positions?ownerPubkey=${encodeURIComponent(publicKey.toBase58())}`);
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      if (!r.ok) {
        pageDbg('positions:fail', `HTTP ${r.status}`, j || text.slice(0, 300));
        setPositions([]);
        return;
      }
      const raw = Array.isArray(j) ? j : (j?.data || j?.positions || []);
      pageDbg('positions:ok', `received ${raw.length} positions`);
      setPositions(raw.map(pickPositionFields).filter(Boolean));
    } catch (e) {
      pageDbg('positions:error', e?.message || String(e));
      setPositions([]);
    } finally {
      setPosLoading(false);
    }
  }, [publicKey, pageDbg]);

  useEffect(() => {
    if (tab !== 'positions' || !publicKey) return;
    reloadPositions();
    const id = setInterval(reloadPositions, 300_000);
    return () => clearInterval(id);
  }, [tab, publicKey, reloadPositions]);

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

        <DebugPanel log={pageLog} onClear={clearPageDbg} />

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
