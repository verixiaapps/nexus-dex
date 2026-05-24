// Predict.jsx — Jupiter Prediction Markets on Solana.
//
// Spec: https://dev.jup.ag/docs/prediction
//
// ─── FLOW ────────────────────────────────────────────────────────────────────
// BUY (SOL only, two signatures):
//   Sig 1 — ATOMIC: SOL fee → FEE_WALLET + SOL → JupUSD swap (one tx, one sig)
//           Built from Jupiter /build instructions, fee is a manual
//           SystemProgram.transfer BEFORE Jupiter's setup ixs. Blowfish sees
//           the full net effect (fee + swap) in one simulation.
//   Sig 2 — Jupiter Predict order with JupUSD deposit (sealed tx from /orders)
//
// SELL / CLAIM (two signatures):
//   Sig 1 — Sell or claim tx from Jupiter Predict (sealed)
//   Sig 2 — ATOMIC: JupUSD fee → FEE_WALLET + JupUSD → SOL swap (one tx, one sig)
//
// ─── FEE MODEL ──────────────────────────────────────────────────────────────
// 5% fee on every swap leg, taken in the INPUT mint, via manual transfer
// instruction composed INTO the swap tx. Same pattern as Swap.jsx widget.
// No platformFeeBps. Fee lands in FEE_WALLET before Jupiter touches anything.
//
// ─── DEPOSIT MINT ───────────────────────────────────────────────────────────
// Jupiter Predict accepts USDC or JupUSD as depositMint. We use JupUSD
// throughout — single mint pipeline keeps the code clean and matches the
// swap target.
//
// ─── WHY TWO SIGS ───────────────────────────────────────────────────────────
// Predict /orders returns a sealed (pre-built) transaction. It cannot be
// composed with the swap, and the API validates JupUSD balance at build time.
// So the swap must land BEFORE we ask Predict to build the order. Two
// signatures, clearly labeled "Step 1 of 2: Swap" and "Step 2 of 2: Order".

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Buffer } from 'buffer';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection, PublicKey, VersionedTransaction, TransactionMessage,
  SystemProgram, AddressLookupTableAccount,
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
const FEE_BPS       = 500;   // 5% — taken in input mint
const SLIPPAGE_BPS  = 1000;  // 10% swap slippage tolerance
const SOL_RPC       = '/api/solana-rpc';
const MIN_TRADE_USD = 5;
const NAV_CLEARANCE = 120;
const JUPUSD_DECIMALS = 6;
const SOL_DECIMALS    = 9;

const PRIORITY_FEE_MICROLAMPORTS = 2_800_000;

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

function friendlyError(err) {
  const m = String(err?.message || err || '').toLowerCase();
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

// Deserialize a Jupiter /build instruction into a web3.js TransactionInstruction-shaped object.
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
// SECTION 4: ATOMIC SWAP — fee + swap composed into one signed transaction
// ═══════════════════════════════════════════════════════════════════════════════
//
// Same pattern as the Swap.jsx widget:
//   1. Compute fee in input mint (5% of gross)
//   2. Quote Jupiter for the NET amount (95%)
//   3. Build single tx: [computeBudget] [fee transfer] [Jupiter setup] [swap] [cleanup]
//   4. One signature, atomic on-chain, clean Blowfish sim.

/**
 * SOL → JupUSD atomic swap with 5% SOL fee.
 *
 * @param {Object} args
 * @param {Connection} args.connection
 * @param {PublicKey}  args.ownerPubkey
 * @param {bigint}     args.grossLamports   total SOL the user is spending (fee + swap)
 * @returns {Promise<{tx: VersionedTransaction, expectedJupUsdAtomic: bigint, latestBlockhash: object}>}
 */
async function buildSolToJupUsdSwapTx({ connection, ownerPubkey, grossLamports }) {
  const feeLamports = (grossLamports * BigInt(FEE_BPS)) / 10000n;
  const netLamports = grossLamports - feeLamports;
  if (feeLamports <= 0n) throw new Error('Fee rounds to zero — amount too small.');
  if (netLamports <= 0n) throw new Error('Net amount after fee is zero.');

  // Ask Jupiter to route ONLY the net amount.
  const params = new URLSearchParams({
    inputMint:   SOL_MINT,
    outputMint:  JUPUSD_MINT,
    amount:      netLamports.toString(),
    slippageBps: String(SLIPPAGE_BPS),
    taker:       ownerPubkey.toBase58(),
    computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  const expectedJupUsdAtomic = BigInt(build.outAmount || 0);
  if (expectedJupUsdAtomic <= 0n) throw new Error('Jupiter quote returned zero output');

  // Build the fee transfer (SOL → FEE_WALLET) BEFORE Jupiter wraps the rest.
  const feeIx = SystemProgram.transfer({
    fromPubkey: ownerPubkey,
    toPubkey:   FEE_WALLET,
    lamports:   Number(feeLamports),   // safe: 5% of a reasonable SOL trade fits in Number
  });

  // Assemble: compute-budget → fee → setup → swap → cleanup → other
  const ixs = [];
  if (Array.isArray(build.computeBudgetInstructions))
    for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));
  ixs.push(feeIx);
  if (Array.isArray(build.setupInstructions))
    for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
  if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
  if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
  if (Array.isArray(build.otherInstructions))
    for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

  // Resolve ALTs
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
  const message = new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  const tx = new VersionedTransaction(message);
  return { tx, expectedJupUsdAtomic, latestBlockhash };
}

/**
 * JupUSD → SOL atomic swap with 5% JupUSD fee.
 * Used after sell / claim to convert winnings back to SOL.
 *
 * @param {Object} args
 * @param {Connection} args.connection
 * @param {PublicKey}  args.ownerPubkey
 * @param {bigint}     args.grossJupUsdAtomic   total JupUSD to spend (fee + swap)
 */
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
    computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
  });
  const r = await jfetch(`/api/jupiter/build?${params}`);
  const build = await r.json();
  if (!build?.swapInstruction) throw new Error('Jupiter /build returned no swapInstruction');

  const expectedSolLamports = BigInt(build.outAmount || 0);

  // Fee is an SPL transfer in JupUSD. Need source/dest ATAs.
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

  const ixs = [];
  if (Array.isArray(build.computeBudgetInstructions))
    for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));
  ixs.push(ataIx);
  ixs.push(transferIx);
  if (Array.isArray(build.setupInstructions))
    for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
  if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
  if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
  if (Array.isArray(build.otherInstructions))
    for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

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
  const message = new TransactionMessage({
    payerKey:        ownerPubkey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions:    ixs,
  }).compileToV0Message(alts);

  const tx = new VersionedTransaction(message);
  return { tx, expectedSolLamports, latestBlockhash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Predict order builders (sealed txs from /orders, /positions/...)
// ═══════════════════════════════════════════════════════════════════════════════

async function buildBuyTx({ ownerPubkey, marketId, isYes, depositAmountJupUsdAtomic }) {
  const r = await jfetch('/api/predict/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerPubkey, marketId, isYes, isBuy: true,
      depositAmount: depositAmountJupUsdAtomic.toString(),  // BigInt → integer string
      depositMint:   JUPUSD_MINT,
    }),
  });
  const j = await r.json();
  if (!j?.transaction) throw new Error('Jupiter Predict returned no transaction');
  return { tx: VersionedTransaction.deserialize(b64ToBytes(j.transaction)), orderInfo: j.order || null };
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

// Sim the EXACT tx the user will sign. No replaceRecentBlockhash — we want
// the wallet to simulate the same bytes. Throws on hard errors (insufficient
// balance, slippage, etc) so we catch them before bothering the wallet.
// Swallows transport-level glitches and proceeds.
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
    // Re-throw mapped errors; swallow transport glitches.
    if (e?.message && /balance|slippage|expired|account not|simulation failed/i.test(e.message)) {
      throw e;
    }
    console.warn(`[predict] ${label} sim non-fatal:`, e?.message);
  }
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
    // Poll status as fallback
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

// ─── BuyDrawer ────────────────────────────────────────────────────────────────
// BUY FLOW:
//   Step 1 of 2 — SIGN: Atomic [fee + swap] tx. SOL leaves wallet, JupUSD arrives.
//   Step 2 of 2 — SIGN: Predict /orders tx. JupUSD deposited, contracts issued.
function BuyDrawer({ event, isYes, onClose, onDone, solBal, connection }) {
  const { publicKey, signTransaction } = useWallet();

  const [amount, setAmount]   = useState('0.1');
  const [step, setStep]       = useState(0);          // 0 idle, 1 swap, 2 order, 3 done
  const [statusMsg, setStMsg] = useState('');
  const [error, setError]     = useState('');

  useBodyLock(true);

  const m          = event.market;
  const solAmount  = Number(amount) || 0;
  const grossLamports = BigInt(Math.round(solAmount * 1e9));

  // Display-only estimates
  const SOL_PRICE_GUESS = 150;
  const estGrossUsd   = solAmount * SOL_PRICE_GUESS;
  const estFeeUsd     = estGrossUsd * (FEE_BPS / 10000);
  const estDepositUsd = estGrossUsd - estFeeUsd;
  const price         = isYes ? m.yesPrice : m.noPrice;
  const contractsEst  = price > 0 ? estDepositUsd / price : 0;

  const sideLabel = isYes ? 'YES' : 'NO';
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
      // ─── STEP 1 of 2: ATOMIC SWAP (fee + SOL→JupUSD) ────────────────────
      setStep(1);
      setStMsg('Building swap…');

      const { tx: swapTx, expectedJupUsdAtomic, latestBlockhash: swapBh } =
        await buildSolToJupUsdSwapTx({
          connection,
          ownerPubkey: publicKey,
          grossLamports,
        });

      // Sanity: post-fee output should exceed minimum trade size
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

      // ─── STEP 2 of 2: PREDICT ORDER ─────────────────────────────────────
      setStep(2);
      setStMsg('Reading JupUSD balance…');

      // Read actual on-chain JupUSD balance (more accurate than the quote estimate)
      const ownerB58 = publicKey.toBase58();
      let actualJupUsd = await fetchJupUsdBalance(connection, ownerB58);

      // Use whichever is smaller — the new swap output, or the wallet's total.
      // Cap to expectedJupUsdAtomic so we don't accidentally deposit pre-existing JupUSD.
      const depositAtomic = actualJupUsd < expectedJupUsdAtomic ? actualJupUsd : expectedJupUsdAtomic;

      if (depositAtomic <= 0n) {
        throw new Error('Swap landed but no JupUSD found. Please refresh.');
      }

      setStMsg('Building order…');
      const { tx: buyTx } = await buildBuyTx({
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

      // ─── DONE ───────────────────────────────────────────────────────────
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

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />

        {busy && <StepBadge current={step} total={2} />}

        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{event.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ padding: '3px 8px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{sideLabel}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>
            {(Number(solBal) / 1e9).toFixed(4)} SOL
          </div>
        </div>

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

// ─── Sell + Claim drawers ────────────────────────────────────────────────────
// Both follow the same two-step shape as Buy, but in reverse:
//   Step 1 of 2 — Sell or Claim tx from Predict (JupUSD lands in wallet)
//   Step 2 of 2 — Atomic JupUSD → SOL swap (5% fee in JupUSD)

function SellOrClaimDrawer({ position, kind, onClose, onDone, connection }) {
  const { publicKey, signTransaction } = useWallet();
  const [step, setStep]       = useState(0);  // 0 idle, 1 predict tx, 2 swap, 3 done
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
      // ─── STEP 1 of 2: Predict (sell or claim) ──────────────────────────
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

      // ─── STEP 2 of 2: Atomic JupUSD → SOL swap (5% fee) ────────────────
      setStep(2);
      setStMsg('Reading JupUSD balance…');

      // Read actual JupUSD balance — what Predict actually paid out, may differ
      // slightly from the displayed value.
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
  const [tab, setTab]           = useState('markets');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy]     = useState('volume');
  const [search, setSearch]     = useState('');

  const [events, setEvents]         = useState([]);
  const [evLoading, setEvLoading]   = useState(true);
  const [evError, setEvError]       = useState(null);

  const [positions, setPositions]   = useState([]);
  const [posLoading, setPosLoading] = useState(false);

  const [solBal, setSolBal] = useState(0n);

  const [buyState, setBuyState]   = useState(null);
  const [actionPos, setActionPos] = useState(null);
  const [toast, setToast]         = useState('');

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
    const id = setInterval(tick, 300000);
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
    const id = setInterval(reloadEvents, 300000);
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
    const id = setInterval(reloadPositions, 300000);
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
