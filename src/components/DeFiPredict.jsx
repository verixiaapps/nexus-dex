import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction, TransactionInstruction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// DeFi Predict — Polymarket markets, our own route + bridge.
//
// Architecture (the "our own route" pattern, not Polymarket Builders):
//
//   1. Pull market data from Polymarket's public Gamma API (no auth).
//   2. User picks a market, enters a stake, taps Buy.
//   3. We build ONE Solana VersionedTransaction containing:
//         a. SPL Transfer  — our fee (USDC) to TREASURY_USDC_ATA on Solana
//         b. Bridge call   — remaining USDC via Mayan/Wormhole CCTP to the
//                            user's Polygon address (their Phantom EVM addr)
//   4. User signs once. Both effects are atomic — if the bridge fails, the
//      fee reverts. Pre-sim before signing so we never trigger Phantom on a
//      tx that would fail.
//   5. We poll the bridge and once USDC lands on Polygon we deep-link the
//      user to polymarket.com with our builder code in the URL for any
//      attribution rewards Polymarket pays on top.
//
// We bypass Polymarket's Builder Program for the fee itself. Our fee is
// captured 100% on the Solana side before any cross-chain hop. No KYB,
// no Verified-tier approval, no rate limits from Polymarket, no risk of
// builder code revocation. We set our own rate.
// =====================================================================

// ---- Fee config -----------------------------------------------------
const FEE_BPS_DEFAULT = Number(process.env.REACT_APP_NEXUS_PREDICT_FEE_BPS || 200);   // 2.00%
const FEE_BPS_CRYPTO  = Number(process.env.REACT_APP_NEXUS_PREDICT_FEE_BPS_CRYPTO || 100); // 1.00%
function feeBpsFor(category) {
  return String(category || '').toLowerCase() === 'crypto' ? FEE_BPS_CRYPTO : FEE_BPS_DEFAULT;
}

// ---- Provider config ------------------------------------------------
const GAMMA_API_BASE   = process.env.REACT_APP_POLYMARKET_GAMMA_BASE || 'https://gamma-api.polymarket.com';
const POLY_HOST        = 'https://polymarket.com';
// REACT_APP_POLYMARKET_BUILDER_CODE is reserved for a future CLOB
// integration. Polymarket's builder code is a bytes32 attached to signed
// orders (not a URL query param), so this env var is currently unused.
const POLY_BUILDER_REF = process.env.REACT_APP_POLYMARKET_BUILDER_CODE || '';

// ---- Treasury & token config ----------------------------------------
const TREASURY_USDC_ATA = process.env.REACT_APP_TREASURY_USDC_ATA || '';
const USDC_MINT_SOL     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS     = 6;
const TOKEN_PROGRAM_ID  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID    = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ---- Bridge config (Mayan Swap; swappable for Wormhole CCTP/deBridge) -
// The bridge module exposes two methods used here:
//   await bridge.quote({ amountAtomic, destAddress }) -> { fees, txBase64, alts }
//   await bridge.status({ txid }) -> { state: 'pending'|'confirmed'|'failed', destTxHash? }
// In production this hits /api/bridge (Express proxy on server.js) which
// wraps @mayanfinance/swap-sdk. The frontend never holds API keys.
const BRIDGE_API_BASE = process.env.REACT_APP_BRIDGE_API_BASE || '/api/bridge';

const MIN_ORDER_USDC = 5;
const MAX_ORDER_USDC = 25000;
const ENABLE_TRADING = process.env.REACT_APP_NEXUS_PREDICT_LIVE === '1';

// =====================================================================
// DESIGN TOKENS — identical to Stocks/PerpsTrade/scaffolding files
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

// Category surface — each maps to a Polymarket Gamma tag/slug.
// Order is by typical engagement (Trending first, Crypto second since we
// have the highest expected vol there from our own user base).
const CATEGORIES = [
  { id: 'all',         label: 'Trending',     tag: null },
  { id: 'crypto',      label: 'Crypto',       tag: 'crypto' },
  { id: 'politics',    label: 'Politics',     tag: 'politics' },
  { id: 'economics',   label: 'Economics',    tag: 'economy' },
  { id: 'geopolitics', label: 'Geopolitics',  tag: 'geopolitics' },
  { id: 'culture',     label: 'Culture',      tag: 'culture' },
  { id: 'tech',        label: 'Tech',         tag: 'tech' },
];

const CAT_META = {
  crypto:      { label: 'CRYPTO',   color: '#f5b53d', bg: 'rgba(245,181,61,.12)',  bd: 'rgba(245,181,61,.30)'  },
  politics:    { label: 'POLITICS', color: '#a87fff', bg: 'rgba(168,127,255,.12)', bd: 'rgba(168,127,255,.30)' },
  economics:   { label: 'ECON',     color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' },
  geopolitics: { label: 'GEO',      color: '#5ce9c8', bg: 'rgba(92,233,200,.12)',  bd: 'rgba(92,233,200,.30)'  },
  culture:     { label: 'CULTURE',  color: '#ff8a9e', bg: 'rgba(255,138,158,.12)', bd: 'rgba(255,138,158,.30)' },
  tech:        { label: 'TECH',     color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' },
  trending:    { label: 'HOT',      color: '#ff3d5d', bg: 'rgba(255,61,93,.12)',   bd: 'rgba(255,61,93,.30)'   },
};

function coinAccent(symbol) {
  const map = {
    BTC:['#f7931a','#ffbf5c'], ETH:['#627eea','#8fa8ff'], SOL:['#14f195','#9945ff'],
    DOGE:['#c2a633','#e8c84a'], XRP:['#7989ad','#bcc6e0'],
    POLITICS:['#a87fff','#97fce4'], ECON:['#97fce4','#5ce9c8'],
    GEO:['#5ce9c8','#97fce4'], CULTURE:['#ff8a9e','#a87fff'], TECH:['#97fce4','#a87fff'],
    DEFAULT:['#a87fff','#97fce4'],
  };
  return map[(symbol || 'DEFAULT').toUpperCase()] || map.DEFAULT;
}

// =====================================================================
// HOOKS / UTILS — same shapes as the scaffolding
// =====================================================================
let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  n = Number(n);
  d = d != null ? d : (n >= 1000 ? 2 : n >= 1 ? 4 : 8);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}
function shortNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(1) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(0) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
  return '$' + x.toFixed(0);
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidSolAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }
function isValidEvmAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '')); }
function priceToCents(price) {
  const p = Math.max(0, Math.min(1, Number(price) || 0));
  return Math.round(p * 100);
}
function formatCountdown(ms) {
  if (ms <= 0) return 'CLOSED';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}
async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(id); }
}
function loadCached(k, ttl) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return Date.now() - (d.ts || 0) > ttl ? null : d.data;
  } catch { return null; }
}
function saveCached(k, data) {
  try { localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// De-dupes incoming refund toasts against what's already rendered.
function mergeRefunds(prev, next) {
  const seen = new Set(prev.map(r => r.id));
  const add = next.filter(r => r && r.id && !seen.has(r.id));
  return add.length ? [...prev, ...add] : prev;
}

// =====================================================================
// POLYMARKET GAMMA API — public, no auth (CORS open as of 2026). We pull
// markets, normalize to our internal shape, and cache.
// Reference: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
//
// Verified against real Gamma response (May 2026):
//   - order=volume_24hr  (snake_case in query, camelCase in response)
//   - tag_id, not tag_slug — we skip tag filtering at the API level and
//     categorize client-side because we don't keep a tag-ID table.
//   - response fields are stringified JSON for outcomes/outcomePrices
//   - acceptingOrders + enableOrderBook must both be true for the market
//     to be tradeable on polymarket.com
// =====================================================================
async function fetchPolymarketMarkets({ limit = 100 } = {}) {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    archived: 'false',
    limit: String(limit),
    order: 'volume_24hr',
    ascending: 'false',
  });
  const url = `${GAMMA_API_BASE}/markets?${params.toString()}`;
  const res = await fetchWithTimeout(url, { headers: { 'accept': 'application/json' } }, 10_000);
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  return list.map(normalizePolyMarket).filter(Boolean);
}

function normalizePolyMarket(m) {
  if (!m) return null;
  // Skip non-tradeable markets — Polymarket UI grays these out too.
  if (m.acceptingOrders === false) return null;
  if (m.enableOrderBook === false) return null;
  if (m.closed === true || m.archived === true || m.active === false) return null;
  // Gamma returns outcomes/outcomePrices as stringified JSON arrays.
  let outcomes = [];
  let prices = [];
  try {
    outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || []);
    prices   = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
  } catch {}
  // Binary markets only on this page; skip multi-outcome.
  if (outcomes.length !== 2) return null;
  const yesIdx = outcomes.findIndex(o => String(o).toLowerCase() === 'yes');
  if (yesIdx < 0) return null;
  const noIdx = yesIdx === 0 ? 1 : 0;
  const yesPrice = Number(prices[yesIdx]) || 0.5;
  const noPrice  = Number(prices[noIdx])  || (1 - yesPrice);
  const closeTs  = m.endDate ? new Date(m.endDate).getTime() : Date.now() + 86_400_000;
  const cat      = detectCategory(m);
  if (!m.slug && !m.conditionId) return null;
  // Deep-link target: prefer event slug (the canonical Polymarket URL),
  // fall back to market slug. Event slug groups related markets so the
  // user lands on the parent page when one exists.
  const events    = Array.isArray(m.events) ? m.events : [];
  const eventSlug = events[0]?.slug || '';
  return {
    id:           m.conditionId || m.id || m.slug,
    slug:         eventSlug || m.slug || '',
    marketSlug:   m.slug || '',
    question:     m.question || m.title || '',
    description:  m.description || '',
    category:     cat,
    base:         detectBase(m, cat),
    yesPrice, noPrice,
    closeTs,
    volume24h:    Number(m.volume24hr || m.volume24h || m.volume || 0),
    volumeAll:    Number(m.volume || 0),
    liquidity:    Number(m.liquidity || m.liquidityNum || 0),
    openInterest: Number(m.openInterest || 0),
    hot:          Boolean(m.featured) || Number(m.volume24hr || 0) > 250_000,
    eventTitle:   events[0]?.title || '',
    image:        m.image || m.icon || null,
  };
}

function detectCategory(m) {
  // Polymarket's /markets response doesn't include top-level tags in the
  // default payload — we have to categorize from question/event text.
  // It's heuristic; for finer control add tag fetching via /tags later.
  const events = Array.isArray(m.events) ? m.events : [];
  const eventTitle = events[0]?.title || '';
  const text = `${m.question || ''} ${eventTitle} ${m.description || ''}`.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|doge|crypto|usdc|stablecoin)\b/.test(text)) return 'crypto';
  if (/\b(election|president|congress|senate|gop|democrat|republican|trump|biden|harris)\b/.test(text)) return 'politics';
  if (/\b(fed|cpi|inflation|gdp|rate cut|recession|jobs report|payrolls)\b/.test(text)) return 'economics';
  if (/\b(russia|ukraine|china|israel|iran|war|invasion|hormuz|taiwan|nato)\b/.test(text)) return 'geopolitics';
  if (/\b(oscar|grammy|emmy|movie|song|album|netflix|spotify|grammy|gta)\b/.test(text)) return 'culture';
  if (/\b(openai|gpt|google|apple|tesla|nvidia| ai |chatgpt|claude)\b/.test(text)) return 'tech';
  return 'trending';
}

function detectBase(m, cat) {
  const text = `${m.question || ''} ${m.eventTitle || ''}`.toUpperCase();
  if (cat === 'crypto') {
    if (text.includes('BITCOIN') || text.includes('BTC')) return 'BTC';
    if (text.includes('ETHEREUM') || text.includes('ETH')) return 'ETH';
    if (text.includes('SOLANA') || text.includes('SOL')) return 'SOL';
    if (text.includes('XRP')) return 'XRP';
    if (text.includes('DOGE')) return 'DOGE';
    return 'CRYPTO';
  }
  return (cat || 'TRENDING').toUpperCase();
}

// =====================================================================
// SOLANA FEE+BRIDGE PIPELINE — one signature, atomic. Fee SPL transfer
// is prepended to the bridge's serialized tx so either both succeed or
// both revert. Same shape as Stocks.jsx / ParlayBuilder.jsx.
// =====================================================================
function deriveUsdcAta(ownerB58) {
  const owner    = new PublicKey(ownerB58);
  const mint     = new PublicKey(USDC_MINT_SOL);
  const tokProg  = new PublicKey(TOKEN_PROGRAM_ID);
  const ataProg  = new PublicKey(ATA_PROGRAM_ID);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokProg.toBuffer(), mint.toBuffer()],
    ataProg,
  );
  return ata.toBase58();
}

function createSplTransferInstruction(srcB58, dstB58, ownerB58, amountAtomic) {
  // SPL Transfer: discriminator (3) + u64 amount LE
  const data = new Uint8Array(9);
  data[0] = 3;
  let amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) { data[1 + i] = Number(amt & 0xffn); amt >>= 8n; }
  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(srcB58),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(dstB58),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(ownerB58), isSigner: true,  isWritable: false },
    ],
    data,
  });
}

async function fetchLookupTableAccounts(addrs) {
  if (!addrs?.length) return [];
  const out = [];
  for (const addr of addrs) {
    try {
      const res = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getAccountInfo', params:[addr,{encoding:'base64'}] }),
      }, 8_000);
      const data = await res.json();
      const raw = data?.result?.value?.data?.[0];
      if (!raw) continue;
      const buf = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const state = AddressLookupTableAccount.deserialize(buf);
      out.push(new AddressLookupTableAccount({ key: new PublicKey(addr), state }));
    } catch (e) { console.warn('[ALT fetch]', addr, e?.message); }
  }
  return out;
}

async function decompileVersionedTx(vtx) {
  const message = vtx.message;
  const altLookups = message.addressTableLookups || [];
  const altAddrs = altLookups.map(l => typeof l.accountKey === 'string' ? l.accountKey : l.accountKey.toBase58());
  const altAccounts = await fetchLookupTableAccounts(altAddrs);
  const keys = message.getAccountKeys({ addressLookupTableAccounts: altAccounts });
  const instructions = message.compiledInstructions.map(ci => ({
    programId: keys.get(ci.programIdIndex),
    keys: Array.from(ci.accountKeyIndexes).map(idx => ({
      pubkey:     keys.get(idx),
      isSigner:   message.isAccountSigner(idx),
      isWritable: message.isAccountWritable(idx),
    })),
    data: Buffer.from(ci.data),
  })).map(i => new TransactionInstruction(i));
  return {
    instructions,
    payerKey:  keys.get(0),
    altAccounts,
    blockhash: message.recentBlockhash,
  };
}

function assembleFeeAndBridgeTx({ instructions, payerKey, altAccounts, blockhash, feeInstruction }) {
  const all = [feeInstruction, ...instructions];
  const msg = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: all,
  }).compileToV0Message(altAccounts);
  return new VersionedTransaction(msg);
}

async function simulateBeforeSign(serializedBase64) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc:'2.0', id:1, method:'simulateTransaction',
        params:[serializedBase64, { encoding:'base64', commitment:'processed', replaceRecentBlockhash:true, sigVerify:false }],
      }),
    }, 12_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message };
    const v = json?.result?.value;
    if (!v) return { ok: true };
    if (v.err) return { ok: false, message: parseSimError(v.err, v.logs) };
    return { ok: true };
  } catch (e) {
    return { ok: true, warning: 'sim unavailable' };
  }
}

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail?.Custom != null) {
      const code = Number(detail.Custom);
      if (code === 1) return 'Not enough USDC for stake + fee + bridge';
      if (code === 3) return 'USDC account not found — fund USDC first';
      return `Program error 0x${code.toString(16)} at ix ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at ix ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage/i.test(String(l)));
  return errLog ? String(errLog).slice(0, 140) : 'Order unavailable';
}

// ---- Bridge client (Mayan Swap via our /api/bridge Express proxy) ----
async function bridgeQuote({ amountUsdcAtomic, srcAddress, dstAddress }) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromChain: 'solana',
      toChain:   'polygon',
      fromToken: USDC_MINT_SOL,
      toToken:   'native-usdc', // backend resolves to Polygon native USDC mint
      amountAtomic: String(amountUsdcAtomic),
      srcAddress, dstAddress,
      slippageBps: 50,
    }),
  }, 15_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Bridge quote failed (${res.status})`);
  // Backend returns { serializedTx: base64, expectedOutAtomic, etaSeconds, route }
  return data;
}
async function bridgeSubmit(serializedSignedTxB64) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTxBase64: serializedSignedTxB64 }),
  }, 20_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Bridge submit failed (${res.status})`);
  // Backend returns { txid, trackerId }
  return data;
}
async function bridgeStatus(trackerId) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/status?id=${encodeURIComponent(trackerId)}`, {}, 8_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { state: 'pending' };
  // { state: 'pending'|'confirmed'|'failed', destTxHash? }
  return data;
}

// Fire-and-forget. Frontend hands the trackerId + fee details to the
// backend so its cron job can reconcile bridge outcomes and refund the
// Solana-side fee on failure. We do NOT poll for outcomes here.
async function trackBridge({ trackerId, userWallet, feeAtomic, marketId, marketSlug }) {
  try {
    await fetchWithTimeout(`${BRIDGE_API_BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackerId, userWallet,
        feeAtomicUsdc: String(feeAtomic || 0),
        marketId, marketSlug,
      }),
    }, 6_000);
  } catch (e) {
    // Non-fatal: if /track fails, backend reconciler picks up the
    // pending Mayan tx by polling its own state. Refunds still work.
    console.warn('[trackBridge]', e?.message);
  }
}

// On page load, ask the backend whether any pending refunds exist for
// this wallet that the user hasn't been shown yet. Backend returns a
// list of { id, marketSlug, feeUsd, refundedAt } entries; we render a
// RefundToast for each and call /ack to mark them seen.
async function fetchUnseenRefunds(walletPubkey) {
  if (!walletPubkey) return [];
  try {
    const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/refunds?wallet=${encodeURIComponent(walletPubkey)}`, {}, 6_000);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.refunds) ? data.refunds : [];
  } catch { return []; }
}
async function ackRefund(walletPubkey, refundId) {
  try {
    await fetchWithTimeout(`${BRIDGE_API_BASE}/refunds/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletPubkey, refundId }),
    }, 6_000);
  } catch {}
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function CoinIcon({ symbol, size = 38 }) {
  const [a, b] = coinAccent(symbol);
  const sym = (symbol || '?').slice(0, 3);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${a},${b})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(0,0,0,.78)', fontWeight: 900,
      fontSize: Math.round(size * 0.30), letterSpacing: '-.03em', flexShrink: 0,
      boxShadow: `0 4px 12px ${a}30`, ...T.display,
    }}>{sym}</div>
  );
}

function CountdownText({ closeTs, style }) {
  const [now, setNow] = useState(Date.now());
  const remaining = (closeTs || 0) - now;
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), remaining < 90 * 60_000 ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [remaining]);
  const closed = remaining <= 0;
  const urgent = remaining > 0 && remaining < 5 * 60_000;
  return (
    <span style={{
      color: closed ? C.muted2 : urgent ? C.down : C.muted,
      fontWeight: urgent ? 800 : 600, ...style,
    }}>{closed ? 'CLOSED' : formatCountdown(remaining)}</span>
  );
}

function YesNoPills({ yesPrice, noPrice }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ padding: '3px 8px', borderRadius: 8, background: 'rgba(61,213,152,.10)', border: '1px solid rgba(61,213,152,.28)', ...T.mono }}>
        <span style={{ color: C.muted2, fontSize: 8, fontWeight: 700, marginRight: 4 }}>YES</span>
        <span style={{ color: C.up, fontSize: 11, fontWeight: 800 }}>{priceToCents(yesPrice)}¢</span>
      </div>
      <div style={{ padding: '3px 8px', borderRadius: 8, background: 'rgba(255,138,158,.10)', border: '1px solid rgba(255,138,158,.28)', ...T.mono }}>
        <span style={{ color: C.muted2, fontSize: 8, fontWeight: 700, marginRight: 4 }}>NO</span>
        <span style={{ color: C.down, fontSize: 11, fontWeight: 800 }}>{priceToCents(noPrice)}¢</span>
      </div>
    </div>
  );
}

function CategoryBadge({ category, small }) {
  const meta = CAT_META[category] || CAT_META.trending;
  if (!meta) return null;
  return (
    <span style={{
      color: meta.color, fontSize: small ? 8 : 9, fontWeight: 700,
      padding: small ? '1px 5px' : '2px 6px', borderRadius: 4,
      background: meta.bg, border: `1px solid ${meta.bd}`,
      letterSpacing: '.06em', ...T.mono,
    }}>{meta.label}</span>
  );
}

function FeaturedMarketCard({ market, onBuy }) {
  if (!market) return null;
  return (
    <div style={{
      marginBottom: 14, padding: 18, borderRadius: 20,
      background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
      border: '1px solid rgba(151,252,228,.18)',
      boxShadow: C.glow, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', right: -50, top: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.12),transparent 65%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CoinIcon symbol={market.base} size={44}/>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CategoryBadge category={market.category}/>
                {market.hot && (
                  <span style={{ color: C.amber, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)', ...T.mono }}>HOT</span>
                )}
              </div>
              <CountdownText closeTs={market.closeTs} style={{ fontSize: 10, ...T.mono }}/>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>24H VOL</div>
            <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 800, marginTop: 2, ...T.mono }}>{shortNum(market.volume24h)}</div>
          </div>
        </div>

        <div style={{ fontSize: 19, fontWeight: 700, color: C.inkStr, lineHeight: 1.25, letterSpacing: '-.02em', marginBottom: 16, ...T.display }}>
          {market.question}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => onBuy(market, 'YES')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(61,213,152,.40)',
            background: 'linear-gradient(135deg,rgba(61,213,152,.14),rgba(92,233,200,.06))',
            color: C.up, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(61,213,152,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY YES</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if yes</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.yesPrice)}¢</div>
          </button>
          <button onClick={() => onBuy(market, 'NO')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(255,138,158,.40)',
            background: 'linear-gradient(135deg,rgba(255,138,158,.14),rgba(168,127,255,.06))',
            color: C.down, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(255,138,158,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY NO</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if no</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.noPrice)}¢</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function MarketRow({ market, onClick }) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(151,252,228,.025)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: '100%', padding: '14px 16px', background: 'transparent', border: 'none',
        borderBottom: `1px solid ${C.hairline}`, cursor: 'pointer', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
        transition: 'background .15s',
      }}
    >
      <CoinIcon symbol={market.base} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-.01em', ...T.body, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {market.question}
        </div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <CategoryBadge category={market.category} small/>
          <span style={{ color: C.muted2, fontSize: 9, ...T.mono }}>•</span>
          <CountdownText closeTs={market.closeTs} style={{ fontSize: 9, ...T.mono }}/>
          <span style={{ color: C.muted2, fontSize: 9, ...T.mono }}>•</span>
          <span style={{ color: C.muted, fontSize: 9, fontWeight: 600, ...T.mono }}>{shortNum(market.volume24h)} vol</span>
        </div>
      </div>
      <YesNoPills yesPrice={market.yesPrice} noPrice={market.noPrice}/>
    </button>
  );
}

// =====================================================================
// BUY MODAL — the trade flow. Fee+bridge atomic on Solana, then redirect
// to Polymarket with funds already in flight. Builder code attached in
// URL for any attribution-based rewards Polymarket pays on top.
// =====================================================================
function BuyModal({ open, onClose, market, initialSide, walletPubkey, evmAddress, onConnectWallet, onAddEvm }) {
  const { connected, signTransaction } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]           = useState('YES');
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle'); // idle|quoting|signing|submitting|error
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(open);
  useEffect(() => {
    if (open) {
      setSide(initialSide || 'YES');
      setAmount(''); setStatus('idle'); setError(''); setStatusMsg('');
    }
  }, [open, initialSide, market?.id]);

  // No bridge polling on the frontend. After the user signs and we
  // hand off the trackerId to the backend, the modal closes and the
  // user is free. Bridge outcomes (delivery / refund) are reconciled
  // by the backend cron job against /api/bridge/track and surfaced
  // only on refund via the main page's RefundToast.

  if (!open || !market) return null;

  const isYes      = side === 'YES';
  const livePrice  = isYes ? market.yesPrice : market.noPrice;
  const usd        = parseFloat(amount) || 0;
  const feeBps     = feeBpsFor(market.category);
  const feeUsd     = usd * (feeBps / 10_000);
  const netUsd     = Math.max(0, usd - feeUsd);
  const contracts  = livePrice > 0 ? netUsd / livePrice : 0;
  const maxPayout  = contracts;
  const profitIfWin = Math.max(0, maxPayout - usd);
  const tooSmall   = usd > 0 && usd < MIN_ORDER_USDC;
  const tooLarge   = usd > MAX_ORDER_USDC;

  const isBusy    = ['quoting','signing','submitting'].includes(status);
  const isError   = status === 'error';
  const quickChips = [10, 50, 250, 1000];

  const execute = async () => {
    if (!wcon)                    { onConnectWallet?.(); return; }
    if (!walletPubkey)            { setError('Wallet not connected'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana address'); return; }
    if (!evmAddress || !isValidEvmAddress(evmAddress)) {
      setError('Add a Polygon (EVM) address to receive bridged USDC');
      onAddEvm?.();
      return;
    }
    if (!usd || tooSmall) { setError(`Minimum order is $${MIN_ORDER_USDC}`); return; }
    if (tooLarge)         { setError(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`); return; }
    if (!TREASURY_USDC_ATA) { setError('Treasury not configured'); return; }
    if (!signTransaction)   { setError('Wallet cannot sign transactions'); return; }
    if (!ENABLE_TRADING)    { setError('Live trading disabled — set REACT_APP_NEXUS_PREDICT_LIVE=1'); return; }

    setStatus('quoting'); setError(''); setStatusMsg('Getting bridge quote…');
    try {
      // 1. Quote the bridge for net amount (post-fee USDC, in atomic units)
      const netAtomic = Math.floor(netUsd * Math.pow(10, USDC_DECIMALS));
      const feeAtomic = Math.floor(feeUsd * Math.pow(10, USDC_DECIMALS));
      if (feeAtomic <= 0) throw new Error('Fee too small to compute');

      const quote = await bridgeQuote({
        amountUsdcAtomic: netAtomic,
        srcAddress:       walletPubkey,
        dstAddress:       evmAddress,
      });
      if (!quote?.serializedTx) throw new Error('Bridge returned no transaction');

      // 2. Deserialize the bridge tx
      const txBytes = Uint8Array.from(atob(quote.serializedTx), c => c.charCodeAt(0));
      let bridgeTx;
      try { bridgeTx = VersionedTransaction.deserialize(txBytes); }
      catch { throw new Error('Bridge returned an unsupported tx format'); }

      // 3. Decompile, prepend our fee SPL transfer
      const decompiled = await decompileVersionedTx(bridgeTx);
      const userUsdcAta = deriveUsdcAta(walletPubkey);
      const feeIx = createSplTransferInstruction(userUsdcAta, TREASURY_USDC_ATA, walletPubkey, feeAtomic);
      const wrapped = assembleFeeAndBridgeTx({
        instructions:    decompiled.instructions,
        payerKey:        decompiled.payerKey,
        altAccounts:     decompiled.altAccounts,
        blockhash:       decompiled.blockhash,
        feeInstruction:  feeIx,
      });

      // 4. Pre-sim
      setStatusMsg('Checking transaction…');
      const serializedForSim = btoa(String.fromCharCode(...wrapped.serialize()));
      const sim = await simulateBeforeSign(serializedForSim);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      // 5. User signs once
      setStatus('signing'); setStatusMsg('Sign in your wallet…');
      const signed = await signTransaction(wrapped);

      // 6. Submit
      setStatus('submitting'); setStatusMsg('Submitting transaction…');
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const submit = await bridgeSubmit(serialized);
      if (!submit?.trackerId) throw new Error('Bridge submit returned no tracker');

      // 7. Hand the tracker off to backend (fire-and-forget).
      //    Backend cron polls Mayan; on bridge failure it refunds the
      //    Solana fee from treasury and the user gets notified via
      //    RefundToast on their next visit. No frontend polling.
      void trackBridge({
        trackerId:    submit.trackerId,
        userWallet:   walletPubkey,
        feeAtomic,
        marketId:     market.id,
        marketSlug:   market.slug,
      });

      // 8. Close the modal immediately. User moves on.
      setStatus('idle'); setStatusMsg('');
      onClose();
    } catch (e) {
      console.error('[buy]', e);
      setError(e.message || 'Order failed');
      setStatus('error'); setStatusMsg('');
    }
  };

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
              <CoinIcon symbol={market.base} size={42}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <CategoryBadge category={market.category}/>
                  <CountdownText closeTs={market.closeTs} style={{ fontSize: 10, ...T.mono }}/>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.inkStr, lineHeight: 1.3, letterSpacing: '-.02em', ...T.display }}>
                  {market.question}
                </div>
              </div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1, flexShrink: 0 }}>×</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', marginTop: 14, padding: '10px 0', borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            {[
              ['YES', priceToCents(market.yesPrice) + '¢', C.up],
              ['NO',  priceToCents(market.noPrice)  + '¢', C.down],
              ['VOL', shortNum(market.volume24h),          C.ink],
            ].map(([l, v, c], i) => (
              <div key={l} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{l}</div>
                <div style={{ fontSize: 13, color: c, fontWeight: 800, marginTop: 3, ...T.mono }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 14px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          {/* YES/NO toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              ['YES', C.up,   'rgba(61,213,152,.10)',  'rgba(61,213,152,.42)'],
              ['NO',  C.down, 'rgba(255,138,158,.10)', 'rgba(255,138,158,.42)'],
            ].map(([s, color, bg, bdr]) => {
              const active = side === s;
              return (
                <button key={s} onClick={() => setSide(s)} disabled={isBusy} style={{
                  padding: 14, borderRadius: 14,
                  border: `1px solid ${active ? bdr : C.border}`,
                  background: active ? bg : 'rgba(255,255,255,.03)',
                  color: active ? color : C.muted,
                  fontWeight: 800, fontSize: 15, cursor: isBusy ? 'not-allowed' : 'pointer',
                  transition: 'all .15s', boxShadow: active ? `0 0 20px ${color}1c` : 'none', ...T.display,
                }}>{s}</button>
              );
            })}
          </div>

          {/* Amount input */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>AMOUNT (USDC ON SOLANA)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>
                {(feeBps / 100).toFixed(2)}% FEE
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${tooSmall || tooLarge ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
                inputMode="decimal" enterKeyHint="done"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
              />
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {quickChips.map(c => (
                <button key={c} onClick={() => { setAmount(String(c)); setError(''); }} disabled={isBusy} style={{
                  flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono,
                }}>${c}</button>
              ))}
            </div>
            {tooSmall && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Minimum order is ${MIN_ORDER_USDC}</div>}
            {tooLarge && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Max order is ${MAX_ORDER_USDC.toLocaleString()}</div>}
          </div>

          {/* Order preview */}
          {usd > 0 && !tooSmall && !tooLarge && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>ORDER PREVIEW</div>
              {[
                ['Stake',                fmt(usd, 2)],
                [`Nexus fee ${(feeBps/100).toFixed(2)}%`, '-' + fmt(feeUsd, 2)],
                ['Bridged to Polygon',   fmt(netUsd, 2)],
                ['Buys',                 contracts.toFixed(2) + ' ' + side + ' contracts'],
                ['Price per share',      priceToCents(livePrice) + '¢'],
                ['Max payout',           fmt(maxPayout, 2)],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 6, borderTop: `1px solid ${C.hairline}` }}>
                <span style={{ color: C.ink, fontWeight: 700, fontSize: 12, ...T.body }}>Profit if {side === 'YES' ? 'yes' : 'no'}</span>
                <div style={{ color: C.up, fontWeight: 800, fontSize: 14, ...T.mono }}>+{fmt(profitIfWin, 2)}</div>
              </div>
            </div>
          )}

          {/* EVM destination panel */}
          <div style={{ background: 'rgba(168,127,255,.04)', border: '1px solid rgba(168,127,255,.18)', borderRadius: 14, padding: '11px 13px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.violet, fontWeight: 800, letterSpacing: '.08em', ...T.mono }}>BRIDGE DESTINATION (POLYGON)</span>
              {!evmAddress && (
                <button onClick={() => onAddEvm?.()} style={{ background: 'transparent', border: 'none', color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>+ Add</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: evmAddress ? C.ink : C.muted2, fontFamily: 'monospace', wordBreak: 'break-all', ...T.mono }}>
              {evmAddress || 'No EVM address linked — required to receive bridged USDC.'}
            </div>
          </div>
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {(isBusy) && statusMsg && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Solana Wallet
            </button>
          ) : (
            <button onClick={execute} disabled={isBusy || !amount || tooSmall || tooLarge || !evmAddress} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isError
                ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                : isYes
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !amount || tooSmall || tooLarge || !evmAddress ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !amount || tooSmall || tooLarge || !evmAddress ? 0.55 : 1,
              boxShadow: isYes ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing…' : isError ? 'Retry' : usd > 0 && !tooSmall && !tooLarge
                ? `Stake ${fmt(usd, 2)} on ${side}`
                : `Buy ${side}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Non-custodial · Solana fee + Polygon bridge · One signature
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN COMPONENT — DeFi Predict
// =====================================================================
export default function DeFiPredict({ onConnectWallet }) {
  const [markets, setMarkets]     = useState(() => loadCached('nexus_poly_predict_v2', 45_000) || []);
  const [filter, setFilter]       = useState('all');
  const [buyOpen, setBuyOpen]     = useState(false);
  const [activeMarket, setActive] = useState(null);
  const [initialSide, setSide]    = useState('YES');
  const [evmAddress, setEvmAddr]  = useState(() => {
    try { return localStorage.getItem('nexus_evm_address') || ''; } catch { return ''; }
  });
  const [evmPromptOpen, setEvmPromptOpen] = useState(false);
  const [refunds, setRefunds]             = useState([]); // queued refund toasts

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // On wallet connect (and again every 5 min), pull any unseen refund
  // entries the backend has reconciled for this wallet. Backend already
  // sent USDC back to the user's Solana wallet — this is just the UX
  // notification so they know it happened.
  useEffect(() => {
    if (!walletPubkey) { setRefunds([]); return; }
    let alive = true;
    const tick = async () => {
      const list = await fetchUnseenRefunds(walletPubkey);
      if (alive && list.length) setRefunds(prev => mergeRefunds(prev, list));
    };
    tick();
    const id = setInterval(tick, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [walletPubkey]);

  const dismissRefund = useCallback((refundId) => {
    setRefunds(prev => prev.filter(r => r.id !== refundId));
    if (walletPubkey) void ackRefund(walletPubkey, refundId);
  }, [walletPubkey]);

  // Polymarket Gamma poll — every 30s. Single pull of top-volume markets,
  // we categorize client-side so changing the filter pill doesn't refetch.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchPolymarketMarkets({ limit: 150 });
        if (!alive || !data?.length) return;
        setMarkets(data);
        saveCached('nexus_poly_predict_v2', data);
      } catch (e) { console.warn('[gamma poll]', e?.message); }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const handleBuy = (market, sideArg) => {
    setActive(market); setSide(sideArg); setBuyOpen(true);
  };

  const handleAddEvm = () => setEvmPromptOpen(true);
  const saveEvm = (addr) => {
    const a = String(addr || '').trim();
    if (!isValidEvmAddress(a)) return false;
    setEvmAddr(a);
    try { localStorage.setItem('nexus_evm_address', a); } catch {}
    setEvmPromptOpen(false);
    return true;
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return markets;
    return markets.filter(m => m.category === filter);
  }, [markets, filter]);

  const featured = useMemo(() => {
    if (!filtered.length) return null;
    return filtered.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0];
  }, [filtered]);

  const listMarkets = useMemo(() => {
    if (!featured) return filtered;
    return filtered.filter(m => m.id !== featured.id);
  }, [filtered, featured]);

  const totalVol = useMemo(() => markets.reduce((s, m) => s + Number(m.volume24h || 0), 0), [markets]);

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin  { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl, boxShadow: `0 0 10px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POLYMARKET LIQUIDITY</span>
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
              DeFi{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Predict</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Trade crypto, politics, economics and culture markets. Stake in USDC on Solana, we route to Polymarket on Polygon — one signature.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { label: 'MARKETS', value: markets.length || '-' },
                { label: '24H VOL', value: shortNum(totalVol) },
                { label: 'CHAIN',   value: 'SOL→POL' },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CATEGORY FILTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>Live markets</div>
            <div style={{ color: C.muted2, fontSize: 10, fontWeight: 600, marginTop: 2, ...T.mono }}>Tap any market to trade</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)} style={{
              padding: '7px 13px', borderRadius: 999, border: `1px solid ${filter === c.id ? C.borderHi : C.border}`,
              background: filter === c.id ? C.hlDim : 'rgba(255,255,255,.03)',
              color: filter === c.id ? C.hl : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, ...T.body,
            }}>{c.label}</button>
          ))}
        </div>

        {/* FEATURED */}
        {featured && <FeaturedMarketCard market={featured} onBuy={handleBuy}/>}

        {/* MARKET LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {listMarkets.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              {markets.length === 0 ? 'Loading markets from Polymarket…' : 'No markets in this category right now.'}
            </div>
          ) : listMarkets.map(m => (
            <MarketRow key={m.id} market={m} onClick={() => handleBuy(m, 'YES')}/>
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>MARKETS</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>POLYMARKET</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>BRIDGE</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.ink, letterSpacing: '.04em', ...T.mono }}>MAYAN</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          Stake USDC on Solana. Atomic fee + cross-chain bridge in one signature. Position settles on Polymarket. Nexus is non-custodial and not affiliated with Polymarket Inc.
        </div>

        <BuyModal
          open={buyOpen}
          onClose={() => setBuyOpen(false)}
          market={activeMarket}
          initialSide={initialSide}
          walletPubkey={walletPubkey}
          evmAddress={evmAddress}
          onConnectWallet={onConnectWallet}
          onAddEvm={handleAddEvm}
        />
        <EvmAddressPrompt open={evmPromptOpen} onClose={() => setEvmPromptOpen(false)} onSave={saveEvm} current={evmAddress}/>
        <RefundToastStack refunds={refunds} onDismiss={dismissRefund}/>
      </div>
    </>
  );
}

// =====================================================================
// RefundToastStack — the only async outcome the user sees. If the
// bridge fails for any of their trades, the backend has already
// returned the USDC fee to their Solana wallet; this surfaces that.
// Renders in the bottom-right corner, dismissible, stacks if many.
// =====================================================================
function RefundToastStack({ refunds, onDismiss }) {
  if (!refunds || refunds.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', right: 14,
      bottom: 'calc(env(safe-area-inset-bottom) + 96px)',
      zIndex: 380, display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 360,
    }}>
      {refunds.slice(-3).map(r => (
        <div key={r.id} style={{
          padding: '12px 14px', borderRadius: 14,
          background: 'linear-gradient(145deg,rgba(61,213,152,.10),rgba(151,252,228,.06))',
          border: '1px solid rgba(61,213,152,.32)',
          boxShadow: '0 12px 36px rgba(0,0,0,.55), 0 0 24px rgba(61,213,152,.18)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(61,213,152,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: C.up, fontSize: 14, fontWeight: 900 }}>↺</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.up, letterSpacing: '.06em', ...T.mono, marginBottom: 2 }}>FEE REFUNDED</div>
            <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.4, ...T.body }}>
              Bridge didn't complete on a recent trade. We returned {fmt(Number(r.feeUsd || 0), 2)} USDC to your Solana wallet.
            </div>
            {r.marketSlug && (
              <div style={{ fontSize: 10, color: C.muted2, marginTop: 3, ...T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.marketSlug}
              </div>
            )}
          </div>
          <button onClick={() => onDismiss(r.id)} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// EvmAddressPrompt — once-per-device modal to capture/edit the user's
// Polygon address. Stored in localStorage as 'nexus_evm_address'. Phantom
// users can use their existing multichain EVM address (same secret, same
// wallet, just the EVM side of it).
// =====================================================================
function EvmAddressPrompt({ open, onClose, onSave, current }) {
  const [val, setVal] = useState(current || '');
  const [err, setErr] = useState('');
  useBodyLock(open);
  useEffect(() => { if (open) { setVal(current || ''); setErr(''); } }, [open, current]);
  if (!open) return null;
  const handleSave = () => {
    if (!isValidEvmAddress(val.trim())) { setErr('Not a valid Polygon address'); return; }
    if (!onSave(val.trim())) setErr('Could not save address');
  };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 470, background: 'rgba(0,0,0,.86)', backdropFilter: 'blur(14px)', cursor: 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 471,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        padding: '20px 22px calc(env(safe-area-inset-bottom) + 90px)',
      }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
        <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 19, letterSpacing: '-.02em', marginBottom: 6, ...T.display }}>Add Polygon address</div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 16, lineHeight: 1.5, ...T.body }}>
          Where your bridged USDC lands. Phantom Multichain users: paste your Ethereum/Polygon address from Phantom (same wallet, EVM side).
        </div>
        <input value={val} onChange={e => { setVal(e.target.value); setErr(''); }} placeholder="0x…"
          style={{ width: '100%', padding: '13px 14px', borderRadius: 14, border: `1px solid ${err ? 'rgba(255,138,158,.40)' : C.border}`, background: 'rgba(255,255,255,.04)', color: C.inkStr, fontSize: 13, ...T.mono, outline: 'none', marginBottom: err ? 6 : 12 }}/>
        {err && <div style={{ fontSize: 11, color: C.down, marginBottom: 12, ...T.body }}>{err}</div>}
        <button onClick={handleSave} style={{
          width: '100%', padding: 16, borderRadius: 16, border: 'none',
          background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
          color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display,
        }}>Save address</button>
      </div>
    </>
  );
}
 