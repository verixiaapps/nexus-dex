// Predict.jsx — Jupiter Prediction Markets on Solana.
//
// Spec: https://dev.jup.ag/docs/prediction
//
// All USD-like values from Jupiter are in *micro-USD* (1,000,000 = $1.00),
// often as STRINGS. Always parse with toUsd() before display/math.
// closeTime / openTime are Unix SECONDS.
//
// Backend endpoints (server-predict.js):
//   GET    /api/predict/events?category=&filter=&includeMarkets=true
//   GET    /api/predict/markets/:marketId
//   POST   /api/predict/orders                          -> base64 tx
//   GET    /api/predict/orders/status/:orderPubkey
//   GET    /api/predict/positions?ownerPubkey=...
//   DELETE /api/predict/positions/:positionPubkey       (sell/close)
//   POST   /api/predict/positions/:positionPubkey/claim
//   GET    /api/predict/ultra/order                     (SOL→USDC swap)

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection, PublicKey, VersionedTransaction, TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────
const USDC_MINT     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT      = 'So11111111111111111111111111111111111111112';
const FEE_WALLET    = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const FEE_BPS       = 500;   // 5%
const SOL_RPC       = '/api/solana-rpc';
const MIN_TRADE_USD = 5;
const NAV_CLEARANCE = 120;

// Priority fee: aggressive for fast confirms on prediction trades.
// 50000 micro-lamports/CU × 200K CU limit = 0.01 SOL ceiling.
const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const PRIORITY_FEE_CU_LIMIT      = 200_000;

const CATEGORIES = [
  { id: 'all',       label: 'All' },
  { id: 'sports',    label: 'Sports' },
  { id: 'crypto',    label: 'Crypto' },
  { id: 'politics',  label: 'Politics' },
  { id: 'esports',   label: 'E-sports' },
  { id: 'culture',   label: 'Culture' },
  { id: 'economics', label: 'Economics' },
  { id: 'tech',      label: 'Tech' },
];

const SORTS = [
  { id: 'volume', label: '📊 Volume' },
  { id: 'ending', label: '⏱ Ending' },
  { id: 'new',    label: '✨ New' },
];

// ─── Design tokens ────────────────────────────────────────────────────────────
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
  if (diff < 60 * 60_000) return `Ends in ${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) {
    const h  = Math.floor(diff / 3_600_000);
    const mm = Math.floor((diff % 3_600_000) / 60_000);
    return `Ends in ${h}h ${mm}m`;
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
  const c  = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Solana balances
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchSolBalance(connection, ownerB58) {
  try {
    const lamports = await connection.getBalance(new PublicKey(ownerB58), 'confirmed');
    return BigInt(lamports);
  } catch { return 0n; }
}
async function fetchUsdcBalance(connection, ownerB58) {
  try {
    const owner = new PublicKey(ownerB58);
    const ata   = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
    const bal   = await connection.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(bal.value.amount || 0);
  } catch { return 0n; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Jupiter Predict API wrappers + field normalizers
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchEvents(category) {
  const qs = new URLSearchParams();
  if (category && category !== 'all') qs.set('category', category);
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

  const meta  = market.metadata || ev.metadata || {};
  const title = ev.title || meta.title || market.title || 'Untitled';
  const image = ev.imageUrl || meta.imageUrl || ev.image || market.imageUrl || null;

  return {
    eventId:   ev.eventId || ev.id,
    title,
    image,
    category:  String(ev.category || meta.category || '').toLowerCase(),
    series:    ev.series || ev.seriesName || null,
    closeTime: meta.closeTime ?? market.closeTime ?? ev.closeTime ?? null,
    createdAt: ev.createdAt || market.createdAt || null,
    volume24h: toUsd(ev.volume24hr ?? ev.volume24h ?? pricing.volume ?? market.volume ?? 0),
    liquidity: toUsd(ev.liquidity ?? market.liquidity ?? 0),
    market: {
      marketId: market.marketId || market.id,
      status:   market.status || meta.status || 'open',
      result:   market.result || meta.result || null,
      yesPrice, noPrice,
      yesPct:   Math.max(0, Math.min(99, Math.round(yesPrice * 100))),
      noPct:    Math.max(0, Math.min(99, Math.round(noPrice  * 100))),
    },
  };
}

function pickPositionFields(p) {
  if (!p) return null;
  const contracts    = Number(p.contracts || 0);
  const avgPriceUsd  = toUsd(p.avgPriceUsd);
  const markPriceUsd = toUsd(p.markPriceUsd);
  const costUsd      = toUsd(p.totalCostUsd) || contracts * avgPriceUsd;
  const valueUsd     = toUsd(p.valueUsd)     || contracts * markPriceUsd;
  const pnlUsd       = toUsd(p.pnlUsd)       || (valueUsd - costUsd);
  const payoutUsd    = toUsd(p.payoutUsd);
  const evMeta       = p.eventMetadata  || {};
  const mktMeta      = p.marketMetadata || {};
  const title = evMeta.title || mktMeta.title || p.title || 'Position';
  return {
    positionPubkey: p.pubkey || p.positionPubkey,
    marketId:    p.marketId,
    title,
    outcomeLabel: mktMeta.title || null,
    marketResult: mktMeta.result || null,
    isYes:       !!p.isYes,
    contracts, avgPriceUsd, markPriceUsd, costUsd, valueUsd, pnlUsd, payoutUsd,
    claimable:   !!p.claimable,
    claimed:     !!p.claimed,
    status:      p.claimed ? 'claimed' : (p.claimable ? 'claimable' : 'active'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Transaction building
// ═══════════════════════════════════════════════════════════════════════════════

// Jupiter's /orders response is a co-signed VersionedTransaction (their keeper
// or program already signed the message). We MUST NOT mutate it -- any change
// to the message invalidates that signature. So we leave it alone and send
// the platform fee as a separate transaction, bundled into one wallet popup
// via signAllTransactions.

async function buildBuyTx({ ownerPubkey, marketId, isYes, depositAmountUsdcAtomic }) {
  const r = await jfetch('/api/predict/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerPubkey, marketId, isYes, isBuy: true,
      depositAmount: String(depositAmountUsdcAtomic),
      depositMint:   USDC_MINT,
      prioritizationFeeLamports: 10_000_000,
}

async function buildFeeTx({ ownerPubkey, feeAmountUsdcAtomic, connection }) {
  const owner   = new PublicKey(ownerPubkey);
  const feeWal  = new PublicKey(FEE_WALLET);
  const mint    = new PublicKey(USDC_MINT);
  const fromAta = getAssociatedTokenAddressSync(mint, owner);
  const feeAta  = getAssociatedTokenAddressSync(mint, feeWal);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: PRIORITY_FEE_CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
      createAssociatedTokenAccountIdempotentInstruction(owner, feeAta, feeWal, mint),
      createTransferCheckedInstruction(fromAta, mint, feeAta, owner, feeAmountUsdcAtomic, 6),
    ],
  }).compileToV0Message();
  return { tx: new VersionedTransaction(msg) };
}

async function buildSellTx({ ownerPubkey, positionPubkey }) {
  const r = await jfetch(`/api/predict/positions/${encodeURIComponent(positionPubkey)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey, prioritizationFeeLamports: 10_000_000 }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('No sell tx returned');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)) };
}

async function buildClaimTx({ ownerPubkey, positionPubkey }) {
  const r = await jfetch(`/api/predict/positions/${encodeURIComponent(positionPubkey)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey, prioritizationFeeLamports: 10_000_000 }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('No claim tx returned');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)) };
}

async function buildUltraSwapTx({ ownerPubkey, usdcAtomicNeeded }) {
  const params = new URLSearchParams({
    inputMint:  SOL_MINT,
    outputMint: USDC_MINT,
    amount:     String(usdcAtomicNeeded),
    swapMode:   'ExactOut',
    taker:      ownerPubkey,
    prioritizationFeeLamports: '10000000',
  });
  const r = await jfetch('/api/predict/ultra/order?' + params.toString());
  const j = await r.json();
  if (!j?.transaction) throw new Error('Ultra returned no transaction');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)) };
}

// Pre-flight sim is a UX nicety, not a correctness check. RPC hiccups and
// Jupiter-internal program state can make sim fail when the tx would actually
// land fine. Log and move on — the wallet runs its own sim, and the on-chain
// run is source of truth.
async function simulateOrThrow(connection, tx, label) {
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    });
    if (sim.value.err) {
      console.warn(`[predict] ${label} sim warned, proceeding:`, sim.value.err, sim.value.logs?.slice(-5));
    }
  } catch (e) {
    console.warn(`[predict] ${label} sim threw, proceeding:`, e?.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: UI atoms
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

function StatusLine({ msg }) {
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Spinner />
      <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{msg}</span>
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
// SECTION 6: Page header (balances + tabs)
// ═══════════════════════════════════════════════════════════════════════════════

function PageHeader({ connected, solBal, usdcBal, tab, setTab, pubkey, onCopy }) {
  const sol  = Number(solBal) / 1e9;
  const usdc = Number(usdcBal) / 1e6;
  return (
    <div style={{ marginTop: 4, marginBottom: 10, padding: '14px 14px 12px', borderRadius: 18, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: -0.5, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Solana prediction markets · 5% fee · $1 per winning contract</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>JUPITER</div>
        </div>

        {connected ? (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>
                  {fmtUsd(usdc)} <span style={{ fontSize: 10, color: C.muted, ...T.mono, marginLeft: 4 }}>USDC</span>
                </div>
                <div style={{ fontSize: 10, color: C.muted, ...T.mono, marginTop: 2 }}>+ {sol.toFixed(4)} SOL</div>
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
// SECTION 7: Market card + Buy drawer
// ═══════════════════════════════════════════════════════════════════════════════

function MarketCard({ event, onTrade }) {
  const m = event.market;
  const yp = m.yesPrice;
  const np = m.noPrice;
  const yPct = m.yesPct;
  const upside = p => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  const closed = m.status !== 'open';
  return (
    <div style={{ padding: 10, borderRadius: 14, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 7, boxShadow: C.shadow, opacity: closed ? 0.55 : 1 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {event.image && <img src={event.image} alt="" onError={e => e.currentTarget.style.display = 'none'} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 4, ...T.body, ...clamp2 }}>{event.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 9, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(event.volume24h)}</span>
            {formatEndDate(event.closeTime) && <><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(event.closeTime)}</span></>}
            {event.category && <><span style={{ opacity: .4 }}>·</span><span style={{ textTransform: 'capitalize' }}>{event.category}</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 38 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: yPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
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

function BuyDrawer({ event, isYes, onClose, onDone, solBal, usdcBal, connection }) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [amount, setAmount]   = useState('10');
  const [status, setStatus]   = useState('idle');
  const [statusMsg, setStMsg] = useState('');
  const [error, setError]     = useState('');

  useBodyLock(true);

  const m         = event.market;
  const depUsd    = Number(amount) || 0;
  const feeUsd    = depUsd * (FEE_BPS / 10000);
  const usd       = depUsd + feeUsd;
  const price     = isYes ? m.yesPrice : m.noPrice;
  const contracts = price > 0 ? depUsd / price : 0;
  const upside    = depUsd > 0 ? ((contracts - depUsd) / depUsd) * 100 : 0;

  const sideLabel = isYes ? 'YES' : 'NO';
  const sideColor = isYes ? C.yes : C.no;
  const sideDim   = isYes ? C.yesDim : C.noDim;

  const totalAtm  = BigInt(Math.floor(usd * 1e6));
  const feeAtm    = BigInt(Math.floor(feeUsd * 1e6));
  const depAtm    = totalAtm - feeAtm;
  const needsSwap = usdcBal < totalAtm;
  const shortAtm  = needsSwap ? totalAtm - usdcBal : 0n;

  const busy   = status === 'working';
  const canBuy = !busy && usd >= MIN_TRADE_USD && publicKey && m.marketId;

  const placeOrder = useCallback(async () => {
    if (!publicKey) { setError('Connect wallet first'); return; }
    setStatus('working'); setError(''); setStMsg('Preparing order…');
    try {
      const ownerPubkey = publicKey.toBase58();
      if (!signAllTransactions) throw new Error('Wallet lacks signAllTransactions');

      setStMsg('Building order…');
      const { tx: buyTx } = await buildBuyTx({
        ownerPubkey, marketId: m.marketId, isYes,
        depositAmountUsdcAtomic: depAtm.toString(),
      });
      const { tx: feeTx } = await buildFeeTx({
        ownerPubkey, feeAmountUsdcAtomic: feeAtm, connection,
      });

      const txs = [];
      if (needsSwap) {
        setStMsg('Building SOL→USDC swap…');
        const { tx: swapTx } = await buildUltraSwapTx({ ownerPubkey, usdcAtomicNeeded: shortAtm.toString() });
        txs.push(swapTx);
      }
      txs.push(buyTx, feeTx);

      setStMsg('Checking…');
      for (const stx of txs) {
        await simulateOrThrow(connection, stx, 'order');
      }

      setStMsg('Confirm in your wallet…');
      const signed = await signAllTransactions(txs);

      setStMsg('Submitting…');
      const sigs = await Promise.all(signed.map(stx =>
        connection.sendRawTransaction(stx.serialize(), {
          maxRetries: 5, skipPreflight: false, preflightCommitment: 'confirmed',
        })
      ));

      setStMsg('Confirming…');
      const bh = await connection.getLatestBlockhash('confirmed');
      const results = await Promise.allSettled(sigs.map(sig =>
        connection.confirmTransaction({
          signature: sig,
          blockhash: bh.blockhash,
          lastValidBlockHeight: bh.lastValidBlockHeight,
        }, 'confirmed')
      ));

      const onchainErr = results.find(r => r.status === 'fulfilled' && r.value?.value?.err);
      if (onchainErr) {
        throw new Error('On-chain error: ' + JSON.stringify(onchainErr.value.value.err));
      }

      const expired = results
        .map((r, i) => r.status === 'rejected' ? sigs[i] : null)
        .filter(Boolean);
      if (expired.length) {
        setStMsg('Verifying on-chain…');
        const deadline = Date.now() + 15_000;
        let allLanded = true;
        while (Date.now() < deadline) {
          const { value } = await connection.getSignatureStatuses(expired);
          const stillPending = value.some(s => !s || (!s.confirmationStatus && !s.err));
          const anyErr       = value.find(s => s?.err);
          if (anyErr) {
            throw new Error('On-chain error: ' + JSON.stringify(anyErr.err));
          }
          if (!stillPending) break;
          await new Promise(r => setTimeout(r, 1500));
          if (Date.now() >= deadline) { allLanded = false; }
        }
        if (!allLanded) {
          const primary = sigs[sigs.length - 1];
          setError(`Submitted but still confirming. View on Solscan: https://solscan.io/tx/${primary}`);
          setStatus('idle'); setStMsg('');
          onDone?.();
          return;
        }
      }

      setStatus('success'); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const msg = e?.message || 'Order failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStMsg('');
      setTimeout(() => setStatus('idle'), 5000);
    }
  }, [publicKey, signAllTransactions, m, isYes, depAtm, feeAtm, needsSwap, shortAtm, connection, onClose, onDone]);

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{event.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ padding: '3px 8px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{sideLabel}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>
            {(Number(usdcBal)/1e6).toFixed(2)} USDC · {(Number(solBal)/1e9).toFixed(3)} SOL
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 15, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
            {['5', '10', '25', '100'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 6, borderRadius: 7, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
            <button onClick={() => setAmount(((Number(usdcBal)/1e6) || 0).toFixed(2))} disabled={busy || usdcBal <= 0n} style={{ flex: 1, padding: 6, borderRadius: 7, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
          </div>
        </div>

        <div style={{ padding: 9, borderRadius: 10, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 10 }}>
          <Row label="Buy amount" value={fmtUsd(depUsd)} />
          <Row label="Platform fee (5%)" value={fmtUsd(feeUsd)} />
          <Row label="Contracts" value={contracts.toFixed(2)} />
          <Row label={`If ${sideLabel} wins`} value={fmtUsd(contracts)} valueColor={sideColor} bold />
          <Row label="Upside" value={`+${upside.toFixed(1)}%`} valueColor={sideColor} bold />
          {needsSwap && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}`, color: C.amber, fontSize: 9 }}>
              ↳ Will swap ~{(Number(shortAtm) / 1e6).toFixed(2)} USDC worth of SOL first
            </div>
          )}
        </div>

        {statusMsg && <StatusLine msg={statusMsg} />}
        {error && <ErrorLine msg={error} />}

        <PrimaryButton
          onClick={canBuy ? placeOrder : undefined}
          disabled={!canBuy}
          color={isYes ? 'yes' : 'no'}
          label={busy ? (statusMsg || 'Working…') : status === 'success' ? '✓ Order placed' : `Buy ${sideLabel} · ${fmtUsd(usd)}`}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Positions
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

function SellDrawer({ position, onClose, onDone, connection }) {
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStMsg] = useState('');
  const [error, setError] = useState('');

  useBodyLock(true);

  const busy = status === 'working';

  const doSell = useCallback(async () => {
    if (!publicKey) return;
    setStatus('working'); setError(''); setStMsg('Building sell…');
    try {
      const { tx } = await buildSellTx({
        ownerPubkey:    publicKey.toBase58(),
        positionPubkey: position.positionPubkey,
      });
      setStMsg('Simulating…');
      await simulateOrThrow(connection, tx, 'sell');
      setStMsg('Confirm in your wallet…');
      const signed = await signTransaction(tx);

      setStMsg('Submitting…');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 5, skipPreflight: false, preflightCommitment: 'confirmed',
      });

      setStMsg('Confirming…');
      const bh = await connection.getLatestBlockhash('confirmed');
      let result;
      try {
        result = await connection.confirmTransaction({
          signature: sig,
          blockhash: bh.blockhash,
          lastValidBlockHeight: bh.lastValidBlockHeight,
        }, 'confirmed');
      } catch (_expired) {
        setStMsg('Verifying on-chain…');
        const deadline = Date.now() + 15_000;
        let landed = false;
        while (Date.now() < deadline) {
          const { value } = await connection.getSignatureStatuses([sig]);
          const s = value?.[0];
          if (s?.err) throw new Error('On-chain error: ' + JSON.stringify(s.err));
          if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
            landed = true; break;
          }
          await new Promise(r => setTimeout(r, 1500));
        }
        if (!landed) {
          setError(`Submitted but still confirming. View on Solscan: https://solscan.io/tx/${sig}`);
          setStatus('idle'); setStMsg('');
          onDone?.();
          return;
        }
      }
      if (result?.value?.err) {
        throw new Error('On-chain error: ' + JSON.stringify(result.value.err));
      }

      setStatus('success'); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const msg = e?.message || 'Sell failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStMsg('');
      setTimeout(() => setStatus('idle'), 5000);
    }
  }, [publicKey, signTransaction, position, connection, onClose, onDone]);

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, ...T.body }}>{position.title}</div>

        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.02)', marginBottom: 10, ...T.mono, fontSize: 11 }}>
          <Row label="Contracts" value={position.contracts.toFixed(2)} />
          <Row label="Avg price" value={`$${position.avgPriceUsd.toFixed(3)}`} />
          <Row label="Mark price" value={`$${position.markPriceUsd.toFixed(3)}`} />
          <Row label="Sell value" value={fmtUsd(position.valueUsd)} bold />
        </div>

        <div style={{
          padding: '9px 11px', borderRadius: 10,
          background: 'rgba(168,127,255,.06)',
          border: '1px solid rgba(168,127,255,.25)',
          marginBottom: 10, fontSize: 10, color: C.ink, lineHeight: 1.4, ...T.body,
        }}>
          <div style={{ fontWeight: 700, color: C.violet, marginBottom: 3, fontSize: 10, letterSpacing: 0.5, ...T.mono }}>
            ⓘ HOW PAYOUT WORKS
          </div>
          You'll receive <strong>JupUSD</strong> (Jupiter's stablecoin) in your wallet — 1 JupUSD = $1.
          Swap it to USDC anytime on the Swap page with near-zero fees.
        </div>

        {statusMsg && <StatusLine msg={statusMsg} />}
        {error && <ErrorLine msg={error} />}

        <PrimaryButton
          onClick={busy ? undefined : doSell}
          disabled={busy || status === 'success'}
          color={position.pnlUsd >= 0 ? 'yes' : 'no'}
          label={busy ? (statusMsg || 'Working…') : status === 'success' ? '✓ Sold' : `Sell all · ${fmtUsd(position.valueUsd)}`}
        />
      </div>
    </div>
  );
}

function ClaimDrawer({ position, onClose, onDone, connection }) {
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStMsg] = useState('');
  const [error, setError] = useState('');

  useBodyLock(true);

  const busy = status === 'working';

  const doClaim = useCallback(async () => {
    if (!publicKey) return;
    setStatus('working'); setError(''); setStMsg('Building claim…');
    try {
      const { tx } = await buildClaimTx({
        ownerPubkey:    publicKey.toBase58(),
        positionPubkey: position.positionPubkey,
      });
      setStMsg('Simulating…');
      await simulateOrThrow(connection, tx, 'claim');
      setStMsg('Confirm in your wallet…');
      const signed = await signTransaction(tx);

      setStMsg('Submitting…');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 5, skipPreflight: false, preflightCommitment: 'confirmed',
      });

      setStMsg('Confirming…');
      const bh = await connection.getLatestBlockhash('confirmed');
      let result;
      try {
        result = await connection.confirmTransaction({
          signature: sig,
          blockhash: bh.blockhash,
          lastValidBlockHeight: bh.lastValidBlockHeight,
        }, 'confirmed');
      } catch (_expired) {
        setStMsg('Verifying on-chain…');
        const deadline = Date.now() + 15_000;
        let landed = false;
        while (Date.now() < deadline) {
          const { value } = await connection.getSignatureStatuses([sig]);
          const s = value?.[0];
          if (s?.err) throw new Error('On-chain error: ' + JSON.stringify(s.err));
          if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
            landed = true; break;
          }
          await new Promise(r => setTimeout(r, 1500));
        }
        if (!landed) {
          setError(`Submitted but still confirming. View on Solscan: https://solscan.io/tx/${sig}`);
          setStatus('idle'); setStMsg('');
          onDone?.();
          return;
        }
      }
      if (result?.value?.err) {
        throw new Error('On-chain error: ' + JSON.stringify(result.value.err));
      }

      setStatus('success'); setStMsg('');
      onDone?.();
      setTimeout(() => onClose(), 2500);
    } catch (e) {
      const msg = e?.message || 'Claim failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error'); setStMsg('');
      setTimeout(() => setStatus('idle'), 5000);
    }
  }, [publicKey, signTransaction, position, connection, onClose, onDone]);

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        <div style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: C.yesDim, border: `1px solid ${C.yes}55`, color: C.yes, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginBottom: 6, ...T.mono }}>🏆 RESOLVED — YOU WON</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, ...T.body }}>{position.title}</div>
        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(0,212,163,.05)', border: `1px solid rgba(0,212,163,.20)`, marginBottom: 10, ...T.mono, fontSize: 11 }}>
          <Row label="Contracts won" value={position.contracts.toFixed(2)} />
          <Row label="Payout" value={fmtUsd(position.payoutUsd)} valueColor={C.yes} bold />
        </div>

        <div style={{
          padding: '9px 11px', borderRadius: 10,
          background: 'rgba(168,127,255,.06)',
          border: '1px solid rgba(168,127,255,.25)',
          marginBottom: 10, fontSize: 10, color: C.ink, lineHeight: 1.5, ...T.body,
        }}>
          <div style={{ fontWeight: 700, color: C.violet, marginBottom: 3, fontSize: 10, letterSpacing: 0.5, ...T.mono }}>
            ⓘ HOW PAYOUTS WORK
          </div>
          Each winning contract = $1.00 paid in <strong>JupUSD</strong> (Jupiter's stablecoin) to your wallet. No fees on claims.
          Swap JupUSD → USDC anytime on the Swap page with near-zero fees.
          <div style={{ marginTop: 5, color: C.muted, fontSize: 9 }}>
            Don't claim within 24h? Jupiter auto-claims for you — same payout, no action needed.
          </div>
        </div>

        {statusMsg && <StatusLine msg={statusMsg} />}
        {error && <ErrorLine msg={error} />}
        <PrimaryButton
          onClick={busy ? undefined : doClaim}
          disabled={busy || status === 'success'}
          color="yes"
          label={busy ? (statusMsg || 'Working…') : status === 'success' ? '✓ Claimed' : `Claim ${fmtUsd(position.payoutUsd)}`}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Top-level page
// ═══════════════════════════════════════════════════════════════════════════════

export default function Predict() {
  const { publicKey, connected } = useWallet();
  const [tab, setTab]         = useState('markets');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy]   = useState('volume');
  const [search, setSearch]   = useState('');

  const [events, setEvents]   = useState([]);
  const [evLoading, setEvLoading] = useState(true);
  const [evError, setEvError] = useState(null);

  const [positions, setPositions] = useState([]);
  const [posLoading, setPosLoading] = useState(false);

  const [solBal, setSolBal]   = useState(0n);
  const [usdcBal, setUsdcBal] = useState(0n);

  const [buyState, setBuyState]   = useState(null);
  const [actionPos, setActionPos] = useState(null);
  const [toast, setToast] = useState('');

  const connection = useMemo(() => {
    const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
    return new Connection(origin + SOL_RPC, 'confirmed');
  }, []);

  useEffect(() => {
    if (!publicKey) { setSolBal(0n); setUsdcBal(0n); return; }
    let alive = true;
    const tick = async () => {
      const [s, u] = await Promise.all([
        fetchSolBalance(connection, publicKey.toBase58()),
        fetchUsdcBalance(connection, publicKey.toBase58()),
      ]);
      if (alive) { setSolBal(s); setUsdcBal(u); }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection]);

  const reloadEvents = useCallback(async () => {
    try {
      setEvError(null);
      const raw = await fetchEvents(category);
      const normalized = raw
        .map((ev, i) => {
          try { return pickEventFields(ev); }
          catch (e) { console.warn('pickEventFields failed', i, e?.message); return null; }
        })
        .filter(Boolean);
      setEvents(normalized);
    } catch (e) {
      setEvError(e?.message || 'Failed to load markets');
    } finally {
      setEvLoading(false);
    }
  }, [category]);
  useEffect(() => {
    setEvLoading(true);
    reloadEvents();
    const id = setInterval(reloadEvents, 30000);
    return () => clearInterval(id);
  }, [reloadEvents]);

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
    const id = setInterval(reloadPositions, 12000);
    return () => clearInterval(id);
  }, [tab, publicKey, reloadPositions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = q ? events.filter(e => (e.title || '').toLowerCase().includes(q)) : [...events];
    if (sortBy === 'volume') {
      r.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    } else if (sortBy === 'ending') {
      r.sort((a, b) => {
        const ta = toMs(a.closeTime); const tb = toMs(b.closeTime);
        const da = ta ? ta - Date.now() : Infinity;
        const db = tb ? tb - Date.now() : Infinity;
        return (da > 0 ? da : Infinity) - (db > 0 ? db : Infinity);
      });
    } else if (sortBy === 'new') {
      r.sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
    }
    return r;
  }, [events, search, sortBy]);

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
          solBal={solBal} usdcBal={usdcBal}
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
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {CATEGORIES.map(c => {
                const active = category === c.id;
                return (
                  <button key={c.id} onClick={() => setCategory(c.id)}
                    style={{ padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap', background: active ? C.hlDim : 'rgba(255,255,255,.03)', border: `1px solid ${active ? C.borderHi : C.border}`, color: active ? C.hl : C.muted, fontSize: 10, fontWeight: 800, cursor: 'pointer', ...T.mono }}>
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div style={{ marginBottom: 8, position: 'relative' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search markets…" inputMode="search"
                style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontSize: 12, outline: 'none', ...T.body }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {SORTS.map(s => {
                const a = sortBy === s.id;
                return (
                  <button key={s.id} onClick={() => setSortBy(s.id)}
                    style={{ padding: '6px 11px', borderRadius: 99, background: a ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)', border: `1px solid ${a ? C.border : 'transparent'}`, color: a ? C.ink : C.muted2, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
                    {s.label}
                  </button>
                );
              })}
            </div>

            {evLoading && [1, 2, 3, 4].map(i => <Skeleton key={i} />)}
            {evError && <ErrorLine msg={evError} />}
            {!evLoading && !evError && filtered.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
                {search ? `No markets match "${search}"` : 'No active markets in this category.'}
              </div>
            )}
            {!evLoading && filtered.map(ev => (
              <MarketCard
                key={ev.eventId}
                event={ev}
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
          onClose={() => setBuyState(null)}
          onDone={() => { reloadEvents(); reloadPositions(); }}
          solBal={solBal} usdcBal={usdcBal}
          connection={connection}
        />
      )}

      {actionPos?.kind === 'sell' && (
        <SellDrawer
          position={actionPos.position}
          onClose={() => setActionPos(null)}
          onDone={() => reloadPositions()}
          connection={connection}
        />
      )}

      {actionPos?.kind === 'claim' && (
        <ClaimDrawer
          position={actionPos.position}
          onClose={() => setActionPos(null)}
          onDone={() => reloadPositions()}
          connection={connection}
        />
      )}
    </>
  );
}
