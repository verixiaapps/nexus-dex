// Predict.jsx — Polymarket V2 deposit-wallet flow.
//
// All Polymarket protocol logic lives in:
//   ./predictPolymarket.js   (frontend module — Solana sig -> EVM key, proxy calls)
//   /api/poly/*              (server-poly-relayer.js)
//
// This file is UI only. It never loads a Polymarket SDK.

import React, {
  useEffect, useState, useCallback, useMemo, useRef,
} from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

import {
  usePolymarketWallet,
  setupAccount, getBalance, getPositions,
  buy as pmBuy, sell as pmSell, redeem as pmRedeem,
} from './predictPolymarket.js';

// ─── External endpoints ─────────────────────────────────────────────────────
const GAMMA_URL    = 'https://gamma-api.polymarket.com';
const CLOB_URL     = 'https://clob.polymarket.com';
const SOL_RPC      = '/api/solana-rpc';

// Solana
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_NATIVE_MINT  = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID   = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// Our server routes
const BRIDGE_DEPOSIT  = '/api/poly/deposit';
const BRIDGE_STATUS   = '/api/poly/status';
const BRIDGE_WITHDRAW = '/api/poly/withdraw';
const OKX_SWAP_PATH   = '/api/okx/dex/aggregator/swap';
const OKX_SOL_CHAIN   = '501';
const OKX_SLIPPAGE    = '0.5';

const FEE_WALLET_SOL  = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const USDC_FEE_PCT    = 5;
const CRYPTO_TAG_ID   = 21;
const MIN_TRADE_USD   = 5;
const MIN_DEPOSIT_USD = 5;
const NAV_CLEARANCE   = 120;

const HORIZONS = [
  { id: 'hourly',  label: 'Hourly',  slug: '15-min-crypto',  maxMs: 2  * 60 * 60_000 },
  { id: 'daily',   label: 'Daily',   slug: 'daily-crypto',   maxMs: 36 * 60 * 60_000 },
  { id: 'weekly',  label: 'Weekly',  slug: 'weekly-crypto',  maxMs: 8  * 24 * 60 * 60_000 },
  { id: 'monthly', label: 'Monthly', slug: 'monthly-crypto', maxMs: 45 * 24 * 60 * 60_000 },
  { id: 'all',     label: 'All',     slug: null,             maxMs: Infinity },
];

// ─── Debug logger ───────────────────────────────────────────────────────────
const DBG_MAX = 400;
const _dbgListeners = new Set();
function _emit(e) { for (const fn of _dbgListeners) { try { fn(e); } catch {} } }
function _redact(v) {
  if (typeof v !== 'object' || v == null) return v;
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) {
    out[k] = /secret|passphrase|private|seed|mnemonic|api[_-]?key|signature/i.test(k) ? '***' : v[k];
  }
  return out;
}
function dbg(scope, msg, data) {
  const entry = { ts: Date.now(), scope, msg, data: data === undefined ? undefined : _redact(data) };
  try {
    if (typeof window !== 'undefined') {
      window.__predictDebug = window.__predictDebug || [];
      window.__predictDebug.push(entry);
      if (window.__predictDebug.length > DBG_MAX) window.__predictDebug.shift();
    }
  } catch {}
  try { console.log(`[predict:${scope}]`, msg, entry.data !== undefined ? entry.data : ''); } catch {}
  _emit(entry);
}
function dbgErr(scope, msg, err) {
  dbg(scope, 'ERROR: ' + msg, {
    name: err?.name, message: err?.message || String(err),
    code: err?.code, status: err?.status || err?.response?.status,
    body: err?.body || err?.response?.data,
  });
}
function dbgClear() {
  try { if (typeof window !== 'undefined') window.__predictDebug = []; } catch {}
  _emit({ ts: Date.now(), scope: 'debug', msg: '— cleared —' });
}
function useDbgLog() {
  const [, force] = useState(0);
  const ref = useRef([]);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && Array.isArray(window.__predictDebug)) {
        ref.current = [...window.__predictDebug];
      }
    } catch {}
    const fn = (entry) => {
      if (entry.msg === '— cleared —') ref.current = [];
      else {
        ref.current = [...ref.current, entry];
        if (ref.current.length > DBG_MAX) ref.current = ref.current.slice(-DBG_MAX);
      }
      force(x => x + 1);
    };
    _dbgListeners.add(fn);
    return () => { _dbgListeners.delete(fn); };
  }, []);
  return ref.current;
}

// ─── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg: '#03060f', card: '#080d1a', cardHi: '#0c1428',
  ink: '#e8ecf5', muted: '#8a96b8', muted2: '#475670',
  border: 'rgba(151,252,228,.10)', borderHi: 'rgba(151,252,228,.30)',
  hl: '#97fce4', hl2: '#5ce9c8', hlDim: 'rgba(151,252,228,.10)',
  violet: '#a87fff',
  yes: '#00d4a3', yesDim: 'rgba(0,212,163,.12)',
  no: '#ff5f7a',  noDim: 'rgba(255,95,122,.12)',
  amber: '#f5b53d',
  shadow: '0 8px 28px rgba(0,0,0,.45)',
  shadowLg: '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// ─── Utility functions ──────────────────────────────────────────────────────
async function jfetch(url, opts = {}, ms = 12000) {
  const c  = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) {
      let body = '';
      try { body = await r.text(); } catch {}
      dbg('http', `${opts.method || 'GET'} ${url} → ${r.status}`, { body: body.slice(0, 400) });
      const err = new Error(`HTTP ${r.status}: ${body.slice(0, 300) || r.statusText}`);
      err.status = r.status; err.body = body;
      throw err;
    }
    return r;
  } finally { clearTimeout(id); }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
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
function formatEndDate(iso) {
  if (!iso) return null;
  const d  = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const mo  = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (ms < 60 * 60_000) return `Ends in ${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) {
    const h  = Math.floor(ms / 3_600_000);
    const mm = Math.floor((ms % 3_600_000) / 60_000);
    return `Ends in ${h}h ${mm}m`;
  }
  return `Ends ${mo} ${day}`;
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.style.overflow = 'hidden';
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.style.overflow = '';
    };
  }, [open]);
}
async function copyToClipboard(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// ─── Solana helpers ─────────────────────────────────────────────────────────
function deriveSolanaAta(ownerB58, mint = USDC_SOLANA_MINT) {
  const TOKEN = new PublicKey(TOKEN_PROGRAM_ID);
  const ATA   = new PublicKey(ATA_PROGRAM_ID);
  const owner = new PublicKey(ownerB58);
  const mintK = new PublicKey(mint);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN.toBuffer(), mintK.toBuffer()], ATA,
  );
  return ata.toBase58();
}

async function fetchSolanaUsdcBalance(ownerB58) {
  try {
    const ata = deriveSolanaAta(ownerB58, USDC_SOLANA_MINT);
    const r = await jfetch(SOL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance',
        params: [ata, { commitment: 'confirmed' }],
      }),
    }, 6000);
    const j = await r.json();
    return j?.result?.value?.amount ? BigInt(j.result.value.amount) : 0n;
  } catch { return 0n; }
}

async function fetchSolanaSolBalance(ownerB58) {
  try {
    const r = await jfetch(SOL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getBalance',
        params: [ownerB58, { commitment: 'confirmed' }],
      }),
    }, 6000);
    const j = await r.json();
    return j?.result?.value ? BigInt(j.result.value) : 0n;
  } catch { return 0n; }
}

// ─── Bridge helpers ─────────────────────────────────────────────────────────
async function fetchBridgeAddresses(depositWallet) {
  const r = await jfetch(BRIDGE_DEPOSIT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: depositWallet }),
  }, 15000);
  const j = await r.json();
  dbg('bridge', 'addresses', j);
  return {
    evm: j.evm || j.evmAddress || j.evm_address || null,
    svm: j.svm || j.svmAddress || j.svm_address || null,
  };
}

async function fetchBridgeStatus(addr) {
  try {
    const r = await jfetch(`${BRIDGE_STATUS}/${encodeURIComponent(addr)}`, {}, 8000);
    return await r.json();
  } catch { return null; }
}

async function waitForBridge(statusAddress, sig) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const s   = await fetchBridgeStatus(statusAddress);
      const arr = Array.isArray(s?.deposits) ? s.deposits : Array.isArray(s) ? s : [];
      const hit = arr.find(d => {
        const status = String(d.status || d.state || d.bridgeStatus || '').toUpperCase();
        return d.txHash === sig || d.sourceTxHash === sig || d.sigSrc === sig
          || status === 'COMPLETED' || status === 'CONFIRMED' || status === 'SUCCESS';
      });
      if (hit) { dbg('bridge', 'completed', hit); return true; }
    } catch {}
    await new Promise(r => setTimeout(r, 2500));
  }
  dbg('bridge', 'wait timed out — deposit may still arrive');
  return true;
}

async function submitSolTx(signedTx) {
  const raw = signedTx.serialize();
  const b64 = bytesToBase64(new Uint8Array(raw));
  const r   = await jfetch(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendTransaction',
      params: [b64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }],
    }),
  }, 20000);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'Solana submit failed');
  return j.result;
}

async function depositFromSol({ ownerB58, depositWallet, solAtomic, signFn, onStatus }) {
  onStatus?.('Getting deposit address…');
  const addrs = await fetchBridgeAddresses(depositWallet);
  if (!addrs.svm) throw new Error('No SVM bridge deposit address');

  onStatus?.('Quoting swap…');
  const params = new URLSearchParams({
    chainIndex: OKX_SOL_CHAIN, chainId: OKX_SOL_CHAIN,
    fromTokenAddress: SOL_NATIVE_MINT, toTokenAddress: USDC_SOLANA_MINT,
    amount: String(solAtomic), userWalletAddress: ownerB58,
    swapReceiverAddress: addrs.svm,
    slippage: OKX_SLIPPAGE, slippagePercent: OKX_SLIPPAGE,
  });
  const r   = await jfetch(`${OKX_SWAP_PATH}?${params}`, {}, 15000);
  const j   = await r.json();
  if (j.code && j.code !== '0') throw new Error('OKX swap: ' + (j.msg || j.code));
  const swap   = j.data?.[0];
  const txData = swap?.tx?.data || swap?.transaction?.data || swap?.data;
  if (!txData) throw new Error('OKX returned no tx data');

  onStatus?.('Confirm in your wallet…');
  const rawBytes = typeof txData === 'string'
    ? Uint8Array.from(atob(txData), c => c.charCodeAt(0))
    : new Uint8Array(txData);
  const tx     = VersionedTransaction.deserialize(rawBytes);
  const signed = await signFn(tx);

  onStatus?.('Submitting…');
  const sig = await submitSolTx(signed);
  dbg('deposit-sol', 'submitted', { sig });

  onStatus?.('Bridging to pUSD (~30-60s)…');
  await waitForBridge(addrs.svm, sig);
  return { sig };
}

async function buildUsdcSplitTx({ ownerB58, bridgeSvm, totalAtomic }) {
  const web3 = await import('@solana/web3.js');
  const spl  = await import('@solana/spl-token');
  const { Connection, PublicKey: PK, Transaction, ComputeBudgetProgram } = web3;
  const {
    createTransferCheckedInstruction, createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress, getAccount,
  } = spl;

  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  const conn   = new Connection(origin + SOL_RPC, 'confirmed');
  const owner  = new PK(ownerB58);
  const bridge = new PK(bridgeSvm);
  const fee    = new PK(FEE_WALLET_SOL);
  const mint   = new PK(USDC_SOLANA_MINT);
  const total  = BigInt(totalAtomic);
  const feeAmt = (total * BigInt(USDC_FEE_PCT * 100)) / 10000n;
  const sendAmt = total - feeAmt;
  if (sendAmt <= 0n) throw new Error('Deposit amount too small after fee');

  const fromAta   = await getAssociatedTokenAddress(mint, owner);
  const bridgeAta = await getAssociatedTokenAddress(mint, bridge);
  const feeAta    = await getAssociatedTokenAddress(mint, fee);

  const ixs = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })];
  try { await getAccount(conn, bridgeAta); }
  catch { ixs.push(createAssociatedTokenAccountInstruction(owner, bridgeAta, bridge, mint)); }
  try { await getAccount(conn, feeAta); }
  catch { ixs.push(createAssociatedTokenAccountInstruction(owner, feeAta, fee, mint)); }
  ixs.push(createTransferCheckedInstruction(fromAta, mint, bridgeAta, owner, sendAmt, 6));
  ixs.push(createTransferCheckedInstruction(fromAta, mint, feeAta,    owner, feeAmt,  6));

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: owner });
  for (const ix of ixs) tx.add(ix);
  return { tx, sendAmt, feeAmt };
}

async function depositFromUsdc({ ownerB58, depositWallet, usdcAtomic, signFn, onStatus }) {
  onStatus?.('Getting deposit address…');
  const addrs = await fetchBridgeAddresses(depositWallet);
  if (!addrs.svm) throw new Error('No SVM bridge deposit address');

  onStatus?.('Building transfer (95% bridge + 5% fee)…');
  const { tx, sendAmt, feeAmt } = await buildUsdcSplitTx({
    ownerB58, bridgeSvm: addrs.svm, totalAtomic: usdcAtomic,
  });
  dbg('deposit-usdc', 'amounts', { sendAmt: sendAmt.toString(), feeAmt: feeAmt.toString() });

  onStatus?.('Confirm in your wallet…');
  const signed = await signFn(tx);

  onStatus?.('Submitting…');
  const sig = await submitSolTx(signed);
  onStatus?.('Bridging to pUSD (~30-60s)…');
  await waitForBridge(addrs.svm, sig);
  return { sig };
}

async function requestWithdraw({ depositWallet, solanaAddress, amountAtomic, onStatus }) {
  onStatus?.('Initiating withdrawal…');
  const r = await jfetch(BRIDGE_WITHDRAW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:   depositWallet,
      to:     solanaAddress,
      chain:  'solana',
      asset:  'USDC',
      amount: amountAtomic.toString(),
    }),
  }, 20000);
  const j = await r.json();
  if (j?.error) throw new Error(j.error);
  dbg('withdraw', 'submitted', j);
  return j;
}

// ─── Market data ────────────────────────────────────────────────────────────
async function fetchMarketsByTagSlug(slug) {
  const url = `${GAMMA_URL}/events?tag_slug=${encodeURIComponent(slug)}&closed=false&order=volume24hr&ascending=false&limit=60`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}
async function fetchMarketsByTagId(tagId) {
  const url = `${GAMMA_URL}/events?tag_id=${tagId}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=80`;
  const r   = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Gamma ${r.status}`);
  return await r.json();
}
function normalizeEvent(ev) {
  const ms = Array.isArray(ev.markets) ? ev.markets : [];
  if (ms.length === 0) return null;
  const m = ms[0];
  let outcomePrices = [], clobTokenIds = [];
  try { outcomePrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices || []; } catch {}
  try { clobTokenIds  = typeof m.clobTokenIds  === 'string' ? JSON.parse(m.clobTokenIds)  : m.clobTokenIds  || []; } catch {}
  const yesPrice = Number(outcomePrices[0] || m.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || 1 - yesPrice);
  return {
    id: ev.id, slug: ev.slug,
    title: ev.title || m.question || 'Untitled',
    childQuestion: ms.length > 1 ? m.question || m.groupItemTitle || null : null,
    image: ev.image || ev.icon || m.image || null,
    volume24h: Number(ev.volume24hr || m.volume24hr || 0),
    liquidity:  Number(ev.liquidity  || m.liquidity  || 0),
    endDate: ev.endDate || m.endDate || null,
    yesPrice, noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct:  Math.round(noPrice  * 100),
    marketCount: ms.length,
    conditionId: m.conditionId,
    clobTokenIds,
    negRisk:  !!(m.negRisk || ev.negRisk),
    tickSize: String(m.orderPriceMinTickSize || m.minimum_tick_size || m.tickSize || '0.01'),
  };
}
function isTradableMarket(m, h) {
  if (!m || !m.clobTokenIds || m.clobTokenIds.length < 2 || !m.conditionId) return false;
  const y = Number(m.yesPrice) || 0;
  if (y <= 0.02 || y >= 0.98) return false;
  if (!m.endDate) return false;
  const ms = new Date(m.endDate).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (h && Number.isFinite(h.maxMs) && ms > h.maxMs) return false;
  if ((Number(m.volume24h) || 0) < 500) return false;
  if ((Number(m.liquidity) || 0) < 100) return false;
  return true;
}

// ─── Best bid lookup ────────────────────────────────────────────────────────
async function fetchBestBid(tokenId) {
  try {
    const r = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
    if (!r.ok) return 0;
    const d = await r.json();
    let best = 0;
    for (const b of (d?.bids || [])) { const p = Number(b.price || b.p || 0); if (p > best) best = p; }
    return best;
  } catch { return 0; }
}

// ═════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function MarketSkeleton() {
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

function MarketCard({ market, onTrade }) {
  const { title, childQuestion, image, yesPct, volume24h, endDate, marketCount } = market;
  const yp = Number(market.yesPrice) || 0;
  const np = Number(market.noPrice)  || 0;
  const upside = p => (p < 0.02 || p > 0.98) ? 0 : Math.min(9999, Math.round((1 / p - 1) * 100));
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
  return (
    <div style={{ padding: 10, borderRadius: 14, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 7, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {image && <img src={image} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: childQuestion ? 2 : 4, ...T.body, ...clamp2 }}>{title}</div>
          {childQuestion && <div style={{ fontSize: 10, fontWeight: 600, color: C.hl, marginBottom: 4, ...T.body, ...clamp2 }}>{childQuestion}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 9, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {formatEndDate(endDate) && <><span style={{ opacity: .4 }}>·</span><span>{formatEndDate(endDate)}</span></>}
            {marketCount > 1 && <><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 38 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: 8, borderRadius: 10, background: C.yesDim, border: '1px solid rgba(0,212,163,.30)', color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>Yes · ${yp.toFixed(2)}</span>
          {upside(yp) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(yp)}% upside</span>}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: 8, borderRadius: 10, background: C.noDim, border: '1px solid rgba(255,95,122,.30)', color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>No · ${np.toFixed(2)}</span>
          {upside(np) > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{upside(np)}% upside</span>}
        </button>
      </div>
    </div>
  );
}

function DebugPanel({ open, onToggle }) {
  const log = useDbgLog();
  const ref = useRef(null);
  useEffect(() => { if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log.length, open]);
  const copy = () => {
    try {
      const t = log.map(e => `${new Date(e.ts).toISOString().slice(11,23)} [${e.scope}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n');
      navigator.clipboard?.writeText(t);
    } catch {}
  };
  return (
    <div style={{ marginBottom: 10, borderRadius: 10, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '7px 10px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span style={{ fontSize: 9, color: C.muted, fontWeight: 800, letterSpacing: 1.2, ...T.mono }}>DEBUG · {log.length} {open ? '▾' : '▸'}</span>
        {open && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={e => { e.stopPropagation(); copy(); }} style={{ padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>COPY</button>
            <button onClick={e => { e.stopPropagation(); dbgClear(); }} style={{ padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 9, fontWeight: 700, ...T.mono }}>CLEAR</button>
          </div>
        )}
      </div>
      {open && (
        <div ref={ref} style={{ maxHeight: 180, overflowY: 'auto', padding: '6px 10px', background: 'rgba(0,0,0,.25)', borderTop: `1px solid ${C.border}`, ...T.mono, fontSize: 9, lineHeight: 1.5 }}>
          {log.length === 0
            ? <div style={{ color: C.muted2, fontStyle: 'italic' }}>No entries yet.</div>
            : log.map((e, i) => {
                const isErr = String(e.msg).startsWith('ERROR');
                return (
                  <div key={i} style={{ color: isErr ? C.no : C.ink, marginBottom: 2, wordBreak: 'break-word' }}>
                    <span style={{ color: C.muted2 }}>{new Date(e.ts).toISOString().slice(11,23)}</span>{' '}
                    <span style={{ color: C.hl, fontWeight: 700 }}>[{e.scope}]</span> {e.msg}
                    {e.data !== undefined && <span style={{ color: C.muted }}> {JSON.stringify(e.data).slice(0, 220)}</span>}
                  </div>
                );
              })}
        </div>
      )}
    </div>
  );
}

function StatusLine({ msg }) {
  return (
    <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: C.ink, fontWeight: 600 }}>{msg}</span>
    </div>
  );
}
function ErrorLine({ msg }) {
  return <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>{msg}</div>;
}
function PrimaryButton({ onClick, disabled, label }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ width: '100%', padding: 11, borderRadius: 10, background: `linear-gradient(135deg, ${C.hl}, ${C.hl2})`, color: C.bg, fontWeight: 800, fontSize: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...T.body }}>
      {label}
    </button>
  );
}

// ── FundingSheet ────────────────────────────────────────────────────────────
function FundingSheet({ open, onClose, depositWallet, tradingBalance, fundingPubkey, solBalance, usdcBalance, signSolanaTx, refreshAll }) {
  const [tab, setTab]           = useState('usdc');
  const [amount, setAmount]     = useState('25');
  const [status, setStatus]     = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(false);
  const [dbgOpen, setDbgOpen]   = useState(false);
  const [withdrawAddr, setWithdrawAddr] = useState('');

  useBodyLock(open);
  useEffect(() => {
    if (!open) { setStatus('idle'); setStatusMsg(''); setError(''); }
    if (open && fundingPubkey && !withdrawAddr) setWithdrawAddr(fundingPubkey);
  }, [open, fundingPubkey]);

  if (!open) return null;
  const usdcUsd  = Number(usdcBalance) / 1e6;
  const tradeUsd = Number(tradingBalance) / 1e6;
  const usd      = Number(amount) || 0;
  const busy     = status === 'working';

  const handleDepositUsdc = async () => {
    if (!fundingPubkey || !depositWallet) return;
    if (usd < MIN_DEPOSIT_USD) { setError(`Min $${MIN_DEPOSIT_USD}`); return; }
    if (usd > usdcUsd)         { setError(`Max ${fmtUsd(usdcUsd, 2)}`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      await depositFromUsdc({ ownerB58: fundingPubkey, depositWallet, usdcAtomic: BigInt(Math.floor(usd * 1e6)), signFn: signSolanaTx, onStatus: setStatusMsg });
      setStatus('done');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 4000);
    } catch (e) {
      const m = e?.message || 'Deposit failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleDepositSol = async () => {
    if (!fundingPubkey || !depositWallet) return;
    const solAmt = Number(amount);
    if (!(solAmt > 0)) { setError('Invalid amount'); return; }
    if (solAmt > Number(solBalance) / 1e9 - 0.005) { setError('Insufficient SOL (keep 0.005 for fees)'); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      await depositFromSol({ ownerB58: fundingPubkey, depositWallet, solAtomic: BigInt(Math.floor(solAmt * 1e9)), signFn: signSolanaTx, onStatus: setStatusMsg });
      setStatus('done');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 4000);
    } catch (e) {
      const m = e?.message || 'Deposit failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleWithdraw = async () => {
    if (!depositWallet) return;
    if (!withdrawAddr || withdrawAddr.length < 32) { setError('Invalid Solana address'); return; }
    if (usd < 1)        { setError('Min $1'); return; }
    if (usd > tradeUsd) { setError(`Max ${fmtUsd(tradeUsd, 2)}`); return; }
    setStatus('working'); setError(''); setStatusMsg('');
    try {
      await requestWithdraw({ depositWallet, solanaAddress: withdrawAddr, amountAtomic: BigInt(Math.floor(usd * 1e6)), onStatus: setStatusMsg });
      setStatus('done');
      setStatusMsg('Withdrawal submitted — arrives in 2-5 min');
      setTimeout(() => { refreshAll?.(); setStatus('idle'); setStatusMsg(''); }, 6000);
    } catch (e) {
      const m = e?.message || 'Withdraw failed';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const handleCopy = async () => {
    if (!depositWallet) return;
    if (await copyToClipboard(depositWallet)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '12px 12px 14px', boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, overflowY: 'auto' }}>
        <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 2, ...T.display }}>Account</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, ...T.body }}>
          Balance: <span style={{ color: C.hl, fontWeight: 700 }}>{fmtUsd(tradeUsd, 2)}</span>
          <span style={{ color: C.muted2, marginLeft: 8, fontSize: 10 }}>pUSD</span>
        </div>

        <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

        <div style={{ display: 'flex', gap: 4, marginBottom: 10, padding: 2, background: 'rgba(255,255,255,.03)', borderRadius: 9 }}>
          {[
            { id: 'usdc', label: 'USDC' },
            { id: 'sol',  label: 'SOL' },
            { id: 'addr', label: 'Address' },
            { id: 'wd',   label: 'Withdraw' },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setAmount(t.id === 'sol' ? '0.1' : t.id === 'wd' ? String(Math.floor(tradeUsd)) : '25'); setError(''); }}
              disabled={t.id === 'sol' && !fundingPubkey}
              style={{ flex: 1, padding: '6px 4px', borderRadius: 7, background: tab === t.id ? C.hlDim : 'transparent', border: `1px solid ${tab === t.id ? C.borderHi : 'transparent'}`, color: tab === t.id ? C.hl : C.muted, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'usdc' && (
          <div style={{ padding: 10, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: C.hl, fontWeight: 800, ...T.display }}>DEPOSIT USDC (SOLANA)</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(usdcUsd, 2)} available</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 6 }}>
              <span style={{ fontSize: 15, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>USDC</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, marginBottom: 10, ...T.mono }}>5% fee · You receive {fmtUsd(usd * 0.95, 2)} as pUSD for trading</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['10', '25', '100', '250'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.floor(usdcUsd * 100) / 100))} disabled={busy || usdcUsd <= 0} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
            {statusMsg && <StatusLine msg={statusMsg} />}
            {error     && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>✓ Deposit submitted</div>}
            <PrimaryButton onClick={handleDepositUsdc} disabled={busy || !fundingPubkey} label={busy ? 'Depositing…' : `Deposit ${fmtUsd(usd, 2)}`} />
          </div>
        )}

        {tab === 'sol' && (
          <div style={{ padding: 10, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: C.hl, fontWeight: 800, ...T.display }}>DEPOSIT SOL</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{(Number(solBalance) / 1e9).toFixed(4)} SOL available</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 6 }}>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>SOL</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, marginBottom: 10, ...T.mono }}>Auto-swap to USDC → pUSD · 5% fee included</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['0.1', '0.5', '1', '5'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>{v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.max(0, Number(solBalance) / 1e9 - 0.005).toFixed(4)))} disabled={busy} style={{ flex: 1, padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
            {statusMsg && <StatusLine msg={statusMsg} />}
            {error     && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>✓ Deposit submitted</div>}
            <PrimaryButton onClick={handleDepositSol} disabled={busy || !fundingPubkey} label={busy ? 'Depositing…' : `Deposit ${amount} SOL`} />
          </div>
        )}

        {tab === 'addr' && (
          <div style={{ padding: 10, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: C.hl, fontWeight: 800, marginBottom: 6, ...T.display }}>YOUR POLYGON DEPOSIT WALLET</div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, ...T.mono, fontSize: 11, color: C.ink, wordBreak: 'break-all', marginBottom: 10 }}>{depositWallet || 'Setting up…'}</div>
            <button onClick={handleCopy} disabled={!depositWallet} style={{ width: '100%', padding: 10, borderRadius: 10, background: copied ? C.yesDim : C.hlDim, border: `1px solid ${copied ? C.yes + '55' : C.borderHi}`, color: copied ? C.yes : C.hl, fontSize: 12, fontWeight: 700, cursor: depositWallet ? 'pointer' : 'not-allowed', ...T.mono }}>
              {copied ? '✓ Copied' : 'Copy address'}
            </button>
            <div style={{ fontSize: 10, color: C.muted2, marginTop: 8, ...T.mono }}>⚠ Send pUSD on Polygon only. Wrong network = lost funds.</div>
          </div>
        )}

        {tab === 'wd' && (
          <div style={{ padding: 10, borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: C.hl, fontWeight: 800, ...T.display }}>WITHDRAW TO SOLANA</div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>{fmtUsd(tradeUsd, 2)} available</div>
            </div>
            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.muted2, marginBottom: 2, ...T.mono }}>SOLANA ADDRESS</div>
              <input value={withdrawAddr} onChange={e => { setWithdrawAddr(e.target.value.trim()); setError(''); }} disabled={busy} placeholder="Solana address…" style={{ width: '100%', background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 11, ...T.mono }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
              <span style={{ fontSize: 15, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>pUSD</span>
            </div>
            <button onClick={() => setAmount(String(Math.floor(tradeUsd * 100) / 100))} disabled={busy || tradeUsd <= 0} style={{ width: '100%', padding: 7, borderRadius: 8, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginBottom: 10, ...T.mono }}>Max</button>
            {statusMsg && <StatusLine msg={statusMsg} />}
            {error     && <ErrorLine msg={error} />}
            {status === 'done' && <div style={{ marginBottom: 8, padding: 8, background: 'rgba(0,212,163,.10)', border: `1px solid ${C.yes}55`, borderRadius: 10, fontSize: 11, color: C.yes, fontWeight: 700 }}>{statusMsg || '✓ Withdrawal submitted'}</div>}
            <PrimaryButton onClick={handleWithdraw} disabled={busy} label={busy ? 'Withdrawing…' : `Withdraw ${fmtUsd(usd, 2)}`} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── OrderDrawer ─────────────────────────────────────────────────────────────
function OrderDrawer({ market, side, onClose, evmAddress, evmAccount, depositWallet, tradingBalance, onNeedFunds, refreshAll }) {
  const [amount, setAmount]     = useState('10');
  const [status, setStatus]     = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]       = useState('');
  const [pos, setPos]           = useState(null);
  const [bids, setBids]         = useState({ yes: 0, no: 0 });
  const [sellStatus, setSellStatus] = useState('idle');
  const [redeemStatus, setRedeemStatus] = useState('idle');
  const [dbgOpen, setDbgOpen]   = useState(false);

  useBodyLock(!!market);

  useEffect(() => {
    if (!market || !evmAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const positions = await getPositions(evmAddress, market.conditionId);
        const [yesTid, noTid] = market.clobTokenIds || [];
        let yPos = null, nPos = null;
        for (const p of (positions || [])) {
          const tid = String(p.asset || p.tokenId || p.token_id || '');
          if (yesTid && tid === String(yesTid)) yPos = p;
          if (noTid  && tid === String(noTid))  nPos = p;
        }
        const sz = p => p ? Number(p.size  || p.shares  || p.balance   || 0) : 0;
        const av = p => p ? Number(p.avgPrice || p.average_price || p.avg_price || 0) : 0;
        if (alive) setPos({
          sharesYes: sz(yPos), sharesNo: sz(nPos),
          avgPriceYes: av(yPos), avgPriceNo: av(nPos),
          resolved: !!(yPos?.resolved || nPos?.resolved),
          winningSide: yPos?.winningOutcome ? 'yes' : nPos?.winningOutcome ? 'no' : null,
        });
        const [yb, nb] = await Promise.all([
          fetchBestBid(market.clobTokenIds[0]),
          fetchBestBid(market.clobTokenIds[1]),
        ]);
        if (alive) setBids({ yes: yb, no: nb });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [market, side, evmAddress]);

  if (!market) return null;

  const price      = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd        = Number(amount) || 0;
  const shares     = price > 0 ? usd / price : 0;
  const upside     = usd > 0 ? ((shares - usd) / usd) * 100 : 0;
  const sideColor  = side === 'yes' ? C.yes : C.no;
  const sideDim    = side === 'yes' ? C.yesDim : C.noDim;
  const tradeUsd   = Number(tradingBalance) / 1e6;
  const needsFunds = usd > tradeUsd;
  const busy       = status === 'working' || sellStatus === 'selling' || redeemStatus === 'redeeming';

  const held   = side === 'yes' ? Number(pos?.sharesYes || 0) : Number(pos?.sharesNo || 0);
  const avgPx  = side === 'yes' ? Number(pos?.avgPriceYes || 0) : Number(pos?.avgPriceNo || 0);
  const bid    = side === 'yes' ? bids.yes : bids.no;
  const value  = held * bid;
  const cost   = held * avgPx;
  const pnl    = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const hasPos = held > 0.01;

  const isResolved = pos?.resolved;
  const isWinner   = isResolved && pos?.winningSide === side;

  const canBuy = !busy && usd >= MIN_TRADE_USD && evmAddress && depositWallet && !needsFunds && market.clobTokenIds?.length >= 2;

  const handleBuy = async () => {
    if (needsFunds) { onNeedFunds?.(); return; }
    if (usd < MIN_TRADE_USD) { setError(`Min $${MIN_TRADE_USD}`); return; }
    setStatus('working'); setError(''); setStatusMsg('Setting up account…');
    try {
      await setupAccount(evmAddress, evmAccount);
      setStatusMsg('Placing order…');
      await pmBuy({ evmAddress, evmAccount, market, side, usd });
      setStatus('success'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Trade failed';
      dbgErr('buy', m, e);
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  const handleSell = async () => {
    if (!hasPos) return;
    setSellStatus('selling'); setError(''); setStatusMsg('Selling…');
    try {
      await setupAccount(evmAddress, evmAccount);
      await pmSell({ evmAddress, evmAccount, market, side, shares: held });
      setSellStatus('sold'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      const m = e?.message || 'Sell failed';
      dbgErr('sell', m, e);
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setSellStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setSellStatus('idle'), 4500);
    }
  };

  const handleRedeem = async () => {
    if (!isWinner) return;
    setRedeemStatus('redeeming'); setError(''); setStatusMsg('Redeeming…');
    try {
      await pmRedeem({ evmAddress, evmAccount, market });
      setRedeemStatus('redeemed'); setStatusMsg('');
      refreshAll?.();
      setTimeout(() => onClose(), 2500);
    } catch (e) {
      const m = e?.message || 'Redeem failed';
      dbgErr('redeem', m, e);
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      setRedeemStatus('error'); setStatusMsg(''); setDbgOpen(true);
      setTimeout(() => setRedeemStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: NAV_CLEARANCE, cursor: busy ? 'wait' : 'pointer' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: C.shadowLg, maxHeight: `calc(100dvh - ${NAV_CLEARANCE}px - 24px)`, display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
          <div style={{ width: 32, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ padding: '3px 8px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 9, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted, ...T.mono }}>Bal {fmtUsd(tradeUsd, 2)}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          <DebugPanel open={dbgOpen} onToggle={() => setDbgOpen(o => !o)} />

          {isWinner && redeemStatus !== 'redeemed' && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 11, background: 'rgba(0,212,163,.10)', border: '1px solid rgba(0,212,163,.40)' }}>
              <div style={{ fontSize: 10, color: C.yes, fontWeight: 800, marginBottom: 6, ...T.mono }}>🏆 MARKET RESOLVED — YOU WON</div>
              <div style={{ fontSize: 11, color: C.ink, marginBottom: 10, ...T.body }}>
                Redeem {held.toFixed(2)} shares for {fmtUsd(held, 2)} pUSD
              </div>
              <PrimaryButton
                onClick={redeemStatus === 'redeeming' ? undefined : handleRedeem}
                disabled={redeemStatus === 'redeeming'}
                label={redeemStatus === 'redeeming' ? statusMsg || 'Redeeming…' : `Redeem ${fmtUsd(held, 2)}`}
              />
            </div>
          )}

          {hasPos && !isResolved && sellStatus !== 'sold' && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 11, background: pnl >= 0 ? 'rgba(0,212,163,.07)' : 'rgba(255,95,122,.07)', border: `1px solid ${pnl >= 0 ? 'rgba(0,212,163,.30)' : 'rgba(255,95,122,.30)'}` }}>
              <div style={{ fontSize: 10, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, marginBottom: 8, ...T.mono }}>YOUR POSITION · {side.toUpperCase()}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, ...T.mono }}>
                <span style={{ color: C.muted }}>Shares</span>
                <span style={{ color: C.ink, fontWeight: 700 }}>{held.toFixed(2)} @ ${avgPx.toFixed(3)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11, ...T.mono }}>
                <span style={{ color: C.muted }}>Value · P&amp;L</span>
                <span style={{ color: pnl >= 0 ? C.yes : C.no, fontWeight: 800 }}>
                  {fmtUsd(value, 2)} · {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                </span>
              </div>
              <button
                onClick={sellStatus === 'selling' ? undefined : handleSell}
                disabled={sellStatus === 'selling' || bid <= 0}
                style={{ width: '100%', padding: 10, borderRadius: 10, background: pnl >= 0 ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : `linear-gradient(135deg, ${C.no}33, ${C.no}22)`, border: `1px solid ${pnl >= 0 ? C.yes : C.no}66`, color: pnl >= 0 ? C.yes : C.no, fontWeight: 800, fontSize: 12, cursor: (sellStatus === 'selling' || bid <= 0) ? 'not-allowed' : 'pointer', opacity: (sellStatus === 'selling' || bid <= 0) ? .55 : 1, ...T.body }}>
                {sellStatus === 'selling' ? statusMsg || 'Selling…' : bid <= 0 ? 'No bids available' : `Sell all · ${fmtUsd(value, 2)}`}
              </button>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 15, color: C.muted, ...T.display }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={busy} inputMode="decimal"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 18, fontWeight: 700, ...T.display }} />
              <span style={{ fontSize: 10, color: C.muted, ...T.mono }}>pUSD</span>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
              {['5', '10', '25', '100'].map(v => (
                <button key={v} onClick={() => setAmount(v)} disabled={busy} style={{ flex: 1, padding: 6, borderRadius: 7, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
              ))}
              <button onClick={() => setAmount(String(Math.floor(tradeUsd * 100) / 100))} disabled={busy || tradeUsd <= 0} style={{ flex: 1, padding: 6, borderRadius: 7, background: C.hlDim, border: `1px solid ${C.borderHi}`, color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>Max</button>
            </div>
          </div>

          <div style={{ padding: 9, borderRadius: 10, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 10, ...T.mono, fontSize: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: C.muted }}>Shares</span><span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span><span style={{ color: sideColor, fontWeight: 700 }}>{fmtUsd(shares, 2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.muted }}>Upside</span><span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span></div>
          </div>

          {statusMsg && <StatusLine msg={statusMsg} />}
          {error && (
            <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 10, fontSize: 11, color: C.no }}>
              {error}
              <div style={{ marginTop: 4, fontSize: 9, color: C.muted, ...T.mono }}>See Debug panel above for details.</div>
            </div>
          )}
        </div>

        <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${C.border}`, background: C.card, flexShrink: 0 }}>
          <button
            onClick={canBuy ? handleBuy : needsFunds ? onNeedFunds : undefined}
            disabled={busy || (!canBuy && !needsFunds)}
            style={{ width: '100%', padding: 12, borderRadius: 11, background: status === 'success' ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)` : needsFunds ? `linear-gradient(135deg, ${C.amber}33, ${C.amber}22)` : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`, border: `1px solid ${needsFunds ? C.amber : sideColor}66`, color: needsFunds ? C.amber : sideColor, fontWeight: 800, fontSize: 14, cursor: (canBuy || needsFunds) ? 'pointer' : 'not-allowed', opacity: (canBuy || needsFunds) ? 1 : .55, ...T.body }}>
            {busy           ? (statusMsg || 'Working…')
              : status === 'success' ? '✓ Order placed'
              : needsFunds         ? `Fund · need ${fmtUsd(usd - tradeUsd, 2)} more`
              :                      `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Header({ tradingBalance, onOpenFund, canFund, signedIn, onSignIn, signingIn }) {
  const usd = Number(tradingBalance) / 1e6;
  return (
    <div style={{ marginTop: 4, marginBottom: 10, padding: '14px 14px 12px', borderRadius: 18, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: -0.5, ...T.display }}>Predict</h1>
            <div style={{ fontSize: 11, color: C.muted, ...T.mono, marginTop: 4 }}>Crypto prediction markets · 5% deposit · 0% trading</div>
          </div>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '2px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        {signedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: 'rgba(151,252,228,.05)', border: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.2, ...T.mono, marginBottom: 2 }}>BALANCE (pUSD)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, ...T.display, lineHeight: 1 }}>{fmtUsd(usd, 2)}</div>
            </div>
            <button onClick={canFund ? onOpenFund : undefined} disabled={!canFund}
              style={{ padding: '8px 14px', borderRadius: 10, background: canFund ? `linear-gradient(135deg, ${C.hl}, ${C.hl2})` : 'rgba(255,255,255,.04)', color: canFund ? C.bg : C.muted2, fontWeight: 800, fontSize: 13, border: 'none', cursor: canFund ? 'pointer' : 'not-allowed', opacity: canFund ? 1 : .55, ...T.body, whiteSpace: 'nowrap' }}>
              Manage
            </button>
          </div>
        ) : (
          <button onClick={onSignIn} disabled={signingIn}
            style={{ width: '100%', padding: 12, borderRadius: 11, background: `linear-gradient(135deg, ${C.violet}, ${C.hl})`, color: C.bg, fontWeight: 800, fontSize: 13, border: 'none', cursor: signingIn ? 'wait' : 'pointer', opacity: signingIn ? .7 : 1, ...T.body }}>
            {signingIn ? 'Signing in…' : 'Sign in to trade'}
          </button>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

function PredictInner() {
  const [markets, setMarkets]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [horizonId, setHorizonId]   = useState('daily');
  const [sortBy, setSortBy]         = useState('volume');
  const [orderMarket, setOrderMarket] = useState(null);
  const [orderSide, setOrderSide]   = useState('yes');
  const [fundOpen, setFundOpen]     = useState(false);

  const [depositWallet, setDepositWallet] = useState(null);
  const [tradingBalance, setTradingBalance] = useState(0n);
  const [solBalance, setSolBalance]     = useState(0n);
  const [usdcBalance, setUsdcBalance]   = useState(0n);

  // Solana adapter (funding source)
  const { publicKey: solPk, signTransaction: solSignTx } = useWallet();

  // Predict-page-only Polymarket wallet (Solana sig -> EVM key in memory)
  const {
    evmAddress, evmAccount, authenticated, signingIn, signIn,
  } = usePolymarketWallet();

  const fundingPubkey = solPk?.toString() || null;

  const signSolanaTx = useCallback(async (tx) => {
    if (!solSignTx) throw new Error('Solana wallet does not support signTransaction');
    return await solSignTx(tx);
  }, [solSignTx]);

  // Fetch deposit wallet address + balance from server (server derives it).
  useEffect(() => {
    if (!evmAddress) { setDepositWallet(null); setTradingBalance(0n); return; }
    let alive = true;
    const tick = async () => {
      try {
        const r = await getBalance(evmAddress);
        if (!alive) return;
        if (r?.depositWallet) setDepositWallet(r.depositWallet);
        if (r?.balance != null) setTradingBalance(BigInt(r.balance));
      } catch (e) { dbgErr('balance', e?.message || 'failed', e); }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [evmAddress]);

  useEffect(() => {
    if (!fundingPubkey) return;
    let alive = true;
    const tick = async () => {
      try {
        const [u, s] = await Promise.all([
          fetchSolanaUsdcBalance(fundingPubkey),
          fetchSolanaSolBalance(fundingPubkey),
        ]);
        if (alive) { setUsdcBalance(u); setSolBalance(s); }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [fundingPubkey]);

  const refreshAll = useCallback(async () => {
    if (evmAddress) {
      try {
        const r = await getBalance(evmAddress);
        if (r?.depositWallet) setDepositWallet(r.depositWallet);
        if (r?.balance != null) setTradingBalance(BigInt(r.balance));
      } catch {}
    }
    if (fundingPubkey) {
      try {
        const [u, s] = await Promise.all([
          fetchSolanaUsdcBalance(fundingPubkey),
          fetchSolanaSolBalance(fundingPubkey),
        ]);
        setUsdcBalance(u); setSolBalance(s);
      } catch {}
    }
  }, [evmAddress, fundingPubkey]);

  useEffect(() => {
    let alive = true;
    const h = HORIZONS.find(x => x.id === horizonId) || HORIZONS[1];
    const load = async () => {
      try {
        let raw = [];
        if (h.slug) {
          raw = await fetchMarketsByTagSlug(h.slug);
          if (!Array.isArray(raw) || raw.length === 0) raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        } else {
          raw = await fetchMarketsByTagId(CRYPTO_TAG_ID);
        }
        if (!alive) return;
        const norm = (Array.isArray(raw) ? raw : []).map(normalizeEvent).filter(Boolean);
        setMarkets(norm.filter(m => isTradableMarket(m, h)));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true); load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [horizonId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = q
      ? markets.filter(m => (m.title || '').toLowerCase().includes(q) || (m.childQuestion || '').toLowerCase().includes(q))
      : [...markets];
    if (sortBy === 'upside') {
      const u = m => {
        const yU = m.yesPrice >= 0.02 && m.yesPrice < 0.98 ? (1 / m.yesPrice - 1) * 100 : 0;
        const nU = m.noPrice  >= 0.02 && m.noPrice  < 0.98 ? (1 / m.noPrice  - 1) * 100 : 0;
        return Math.max(yU, nU);
      };
      r.sort((a, b) => u(b) - u(a));
    } else if (sortBy === 'ending') {
      const t = m => {
        if (!m.endDate) return Infinity;
        const ms = new Date(m.endDate).getTime() - Date.now();
        return ms > 0 ? ms : Infinity;
      };
      r.sort((a, b) => t(a) - t(b));
    } else {
      r.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    return r;
  }, [markets, search, sortBy]);

  const openTrade = useCallback((m, s) => { setOrderMarket(m); setOrderSide(s); }, []);

  if (loading) {
    return (
      <>
        <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)' }}>
          <Header tradingBalance={tradingBalance} onOpenFund={() => setFundOpen(true)} canFund={!!depositWallet} signedIn={authenticated} onSignIn={signIn} signingIn={signingIn} />
          {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 12px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink }}>
        <Header tradingBalance={tradingBalance} onOpenFund={() => setFundOpen(true)} canFund={!!depositWallet} signedIn={authenticated} onSignIn={signIn} signingIn={signingIn} />

        <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
          {HORIZONS.map(h => {
            const active = horizonId === h.id;
            return (
              <button key={h.id} onClick={() => setHorizonId(h.id)}
                style={{ padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap', background: active ? C.hlDim : 'rgba(255,255,255,.03)', border: `1px solid ${active ? C.borderHi : C.border}`, color: active ? C.hl : C.muted, fontSize: 10, fontWeight: 800, cursor: 'pointer', ...T.mono }}>
                {h.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginBottom: 8, position: 'relative' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" inputMode="search"
            style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 10, color: C.ink, fontSize: 12, outline: 'none', ...T.body }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { id: 'volume', label: '📊 Volume' },
            { id: 'upside', label: '🔥 Upside' },
            { id: 'ending', label: '⏱ Ending' },
          ].map(o => {
            const a = sortBy === o.id;
            return (
              <button key={o.id} onClick={() => setSortBy(o.id)}
                style={{ padding: '6px 11px', borderRadius: 99, whiteSpace: 'nowrap', background: a ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)', border: `1px solid ${a ? C.border : 'transparent'}`, color: a ? C.ink : C.muted2, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>
                {o.label}
              </button>
            );
          })}
        </div>

        {error && <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {filtered.length === 0 && !error && <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>{search ? `No markets match "${search}"` : 'No active markets.'}</div>}
        {filtered.map(m => <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />)}

        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 9, color: C.muted, textAlign: 'center', ...T.mono }}>
          Powered by Polymarket V2 · pUSD collateral
        </div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket} side={orderSide}
          onClose={() => { setOrderMarket(null); refreshAll(); }}
          evmAddress={evmAddress} evmAccount={evmAccount}
          depositWallet={depositWallet} tradingBalance={tradingBalance}
          onNeedFunds={() => { setOrderMarket(null); setFundOpen(true); }}
          refreshAll={refreshAll}
        />
      )}

      <FundingSheet
        open={fundOpen} onClose={() => setFundOpen(false)}
        depositWallet={depositWallet}
        tradingBalance={tradingBalance} fundingPubkey={fundingPubkey}
        solBalance={solBalance} usdcBalance={usdcBalance}
        signSolanaTx={signSolanaTx}
        refreshAll={refreshAll}
      />
    </>
  );
}

export default function Predict() {
  return <PredictInner />;
}
