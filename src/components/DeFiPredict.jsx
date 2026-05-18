import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction, Transaction, TransactionInstruction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// CONFIG — Kalshi prediction markets via DFlow API on Solana
//
// DFlow tokenizes Kalshi markets as SPL tokens on Solana and routes
// liquidity through Jupiter. Builder code = our 1.5% revenue share on
// every order. Builder code is permissionless — generate at docs.dflow.net.
// Fees stream to TREASURY_ADDRESS in USDC automatically, no claim step.
//
// API is plain REST/JSON over the /api/dflow Express proxy — same
// pattern as /api/hyperliquid in PerpsTrade.jsx. No SDK to babysit.
// =====================================================================
const ENABLE_TRADING        = process.env.REACT_APP_KALSHI_LIVE_TRADING === '1';
const DFLOW_BUILDER_CODE    = process.env.REACT_APP_DFLOW_BUILDER_CODE || ''; // TODO: paste after generating at docs.dflow.net
const DFLOW_BUILDER_FEE_BPS = 150; // 1.5% — stacks on Kalshi's per-contract fee
const DFLOW_API_BASE        = process.env.REACT_APP_DFLOW_API_BASE || '/api/dflow';

const TREASURY_ADDRESS      = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
// Treasury's USDC associated token account — bundled-fee destination.
// Shared env var across Stocks + ParlayBuilder + PredictionsTonight.
const TREASURY_USDC_ATA     = process.env.REACT_APP_TREASURY_USDC_ATA || '';
const USDC_MINT_SOL         = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS         = 6;
const LAMPORTS_PER_SOL      = 1_000_000_000;

const RESTRICTED_STATES = ['AZ', 'IL', 'MD', 'MI', 'MT', 'NJ', 'OH', 'MA', 'NV'];
const TOS_VERSION       = 1;
const MIN_ORDER_USDC    = 1;
const MAX_ORDER_USDC    = 25000;

// =====================================================================
// DESIGN TOKENS — must stay identical to PerpsTrade.jsx
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d',
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

const CATEGORIES = [
  { id: 'All',    label: 'All' },
  { id: '5min',   label: '5-Min' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily',  label: 'Daily' },
  { id: 'events', label: 'Events' },
  { id: 'weekly', label: 'Weekly' },
];

const CAT_META = {
  '5min':   { label: '5-MIN',  color: '#ff8a9e', bg: 'rgba(255,138,158,.12)', bd: 'rgba(255,138,158,.30)' },
  'hourly': { label: 'HOURLY', color: '#f5b53d', bg: 'rgba(245,181,61,.12)',  bd: 'rgba(245,181,61,.30)'  },
  'daily':  { label: 'DAILY',  color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' },
  'weekly': { label: 'WEEKLY', color: '#a87fff', bg: 'rgba(168,127,255,.12)', bd: 'rgba(168,127,255,.30)' },
  'events': { label: 'EVENT',  color: '#5ce9c8', bg: 'rgba(92,233,200,.12)',  bd: 'rgba(92,233,200,.30)'  },
};

function coinAccent(symbol) {
  const map = {
    BTC:['#f7931a','#ffbf5c'], ETH:['#627eea','#8fa8ff'], SOL:['#14f195','#9945ff'],
    HYPE:['#97fce4','#5ce9c8'], DOGE:['#c2a633','#e8c84a'],
    XRP:['#7989ad','#bcc6e0'], BNB:['#f0b90b','#f5d060'], SUI:['#4da2ff','#80c4ff'],
    FED:['#a87fff','#97fce4'], CPI:['#f5b53d','#ff8a9e'],
  };
  return map[(symbol || '').toUpperCase()] || ['#a87fff','#97fce4'];
}

// =====================================================================
// HOOKS / UTILS
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
function priceToCents(price) {
  const p = Math.max(0, Math.min(1, Number(price) || 0));
  return Math.round(p * 100);
}
function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'CLOSED';
  const s = Math.floor(msRemaining / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function loadCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - (d.ts || 0) > ttlMs) return null;
    return d.data;
  } catch { return null; }
}
function saveCached(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function hasAcceptedTos() {
  try { return localStorage.getItem('nexus_kalshi_tos_v' + TOS_VERSION) === '1'; }
  catch { return false; }
}
function acceptTos() {
  try { localStorage.setItem('nexus_kalshi_tos_v' + TOS_VERSION, '1'); } catch {}
}

// =====================================================================
// DFLOW API CLIENT
// =====================================================================
async function dflowRequest(path, body, opts = {}) {
  const url = DFLOW_API_BASE + path;
  const res = await fetchWithTimeout(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, opts.timeoutMs || 12_000);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(data?.error || data?.detail || `DFlow request failed (${res.status})`);
  }
  return data;
}

async function fetchKalshiCryptoMarkets() {
  if (!ENABLE_TRADING) return getMockMarkets();
  try {
    // DFlow Metadata API: /api/v1/markets — fetch all initialized active
    // markets and client-side filter to crypto. Crypto markets are mostly
    // short-duration (5/15-min price brackets) tagged 'crypto' OR with a
    // recognizable base symbol.
    const data = await dflowRequest('/markets?isInitialized=true&status=active&limit=200');
    const list = Array.isArray(data?.markets) ? data.markets
               : Array.isArray(data?.data)    ? data.data
               : Array.isArray(data)          ? data
               : [];
    if (list.length > 0) {
      const normalized = list.map(normalizeMarket).filter(m =>
        String(m.category || '').toLowerCase() === 'crypto'
        || /^(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|MATIC|LINK|DOT)$/i.test(m.base || '')
      );
      if (normalized.length > 0) return normalized;
    }
    return getMockMarkets();
  } catch (e) {
    console.warn('[dflow markets — using mocks]', e?.message || e);
    return getMockMarkets();
  }
}

async function fetchUserPositions(walletPubkey) {
  // Positions endpoint will be wired in a later phase — DFlow derives them
  // from on-chain token accounts (getTokenAccountsByOwner) filtered through
  // /api/v1/filter_outcome_mints, not from a single REST endpoint.
  return [];
}

async function buildOrderTx({ market, side, usdcAmount, walletPubkey }) {
  if (!market?.id) throw new Error('Market unavailable');
  if (!walletPubkey) throw new Error('Wallet not connected');
  if (!(usdcAmount >= MIN_ORDER_USDC)) throw new Error(`Minimum order is $${MIN_ORDER_USDC}`);
  if (usdcAmount > MAX_ORDER_USDC) throw new Error(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`);
  if (!ENABLE_TRADING) {
    throw new Error('Live trading is disabled. Set REACT_APP_KALSHI_LIVE_TRADING=1 in env.');
  }
  // We do NOT pass builderFeeBps/feeRecipient — fee is injected as an SPL
  // Transfer instruction prepended to DFlow's order in the same atomic tx
  // (see decompileVersionedTx + assembleOrderTx).
  return await dflowRequest('/prediction/order/build', {
    marketId:   market.id,
    side:       side === 'YES' ? 'YES' : 'NO',
    usdcAmount: Number(usdcAmount.toFixed(2)),
    userWallet: walletPubkey,
  });
}

async function buildSellTx({ position, walletPubkey, contracts }) {
  if (!position?.id) throw new Error('Position unavailable');
  if (!walletPubkey) throw new Error('Wallet not connected');
  if (!ENABLE_TRADING) throw new Error('Live trading is disabled');
  // Reserved for future direct-sell flow; current sell UX routes through
  // buildOrderTx with the opposite side via handleSell. Fee still bundled
  // atomically the same way when this path is wired up.
  return await dflowRequest('/prediction/position/sell', {
    positionId: position.id,
    contracts:  Number(contracts || position.contracts),
    userWallet: walletPubkey,
  });
}

async function submitSignedTx(serializedTx) {
  return await dflowRequest('/prediction/order/submit', {
    signedTxBase64: serializedTx,
  }, { timeoutMs: 20_000 });
}

// =====================================================================
// ATOMIC FEE PIPELINE — same pattern as Stocks.jsx, ParlayBuilder.jsx,
// PredictionsTonight.jsx. DFlow returns a serialized VersionedTransaction;
// we deserialize, decompile to instructions + ALTs, prepend our SPL
// Transfer (USDC → treasury), recompile, pre-sim, then user signs once.
// Atomic: if order fails, fee reverts. Same sim contract as Stocks for
// consistent Phantom UX across all four products.
// =====================================================================
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID   = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function deriveUsdcAta(ownerB58) {
  const owner        = new PublicKey(ownerB58);
  const mint         = new PublicKey(USDC_MINT_SOL);
  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
  const ataProgram   = new PublicKey(ATA_PROGRAM_ID);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ataProgram
  );
  return ata.toBase58();
}

function createSplTransferInstruction(sourceB58, destinationB58, ownerB58, amountAtomic) {
  // SPL Token Transfer: discriminator (3) + u64 amount little-endian
  const data = new Uint8Array(9);
  data[0] = 3;
  let amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) {
    data[1 + i] = Number(amt & 0xffn);
    amt >>= 8n;
  }
  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(sourceB58),      isSigner: false, isWritable: true },
      { pubkey: new PublicKey(destinationB58), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(ownerB58),       isSigner: true,  isWritable: false },
    ],
    data,
  });
}

async function fetchLookupTableAccounts(altAddresses) {
  if (!altAddresses || altAddresses.length === 0) return [];
  const accounts = [];
  for (const addr of altAddresses) {
    try {
      const res = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
          params: [addr, { encoding: 'base64' }],
        }),
      }, 8_000);
      const data = await res.json();
      const raw = data?.result?.value?.data?.[0];
      if (!raw) continue;
      const buf = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const state = AddressLookupTableAccount.deserialize(buf);
      accounts.push(new AddressLookupTableAccount({ key: new PublicKey(addr), state }));
    } catch (e) {
      console.warn('[ALT fetch fail]', addr, e?.message);
    }
  }
  return accounts;
}

async function decompileVersionedTx(versionedTx) {
  const message = versionedTx.message;
  const altLookups = message.addressTableLookups || [];
  const altAddresses = altLookups.map(l =>
    typeof l.accountKey === 'string' ? l.accountKey : l.accountKey.toBase58()
  );
  const altAccounts = await fetchLookupTableAccounts(altAddresses);
  const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: altAccounts });
  const instructions = message.compiledInstructions.map(ci => {
    const programId = accountKeys.get(ci.programIdIndex);
    const keys = Array.from(ci.accountKeyIndexes).map(idx => ({
      pubkey:     accountKeys.get(idx),
      isSigner:   message.isAccountSigner(idx),
      isWritable: message.isAccountWritable(idx),
    }));
    return new TransactionInstruction({ programId, keys, data: Buffer.from(ci.data) });
  });
  return {
    instructions,
    payerKey:   accountKeys.get(0),
    altAccounts,
    blockhash:  message.recentBlockhash,
  };
}

function assembleOrderTx({ instructions, payerKey, altAccounts, blockhash, feeInstruction }) {
  const allInstructions = [feeInstruction, ...instructions];
  const msg = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(altAccounts);
  return new VersionedTransaction(msg);
}

async function simulateBeforeSign(serializedTxBase64) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
        params: [serializedTxBase64, {
          encoding:               'base64',
          commitment:             'processed',
          replaceRecentBlockhash: true,
          sigVerify:              false,
        }],
      }),
    }, 12_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message || 'Simulation RPC error' };
    const value = json?.result?.value;
    if (!value)     return { ok: true,  warning: 'No sim result' };
    if (value.err)  return { ok: false, message: parseSimError(value.err, value.logs) };
    return { ok: true };
  } catch (e) {
    console.warn('[sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

const DFLOW_ERROR_CODES = {
  // 6000-6099 reserved for DFlow CLP program errors (populate as observed)
  // 6100-6199 reserved for Kalshi outcome-token program errors
};

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const code  = Number(detail.Custom);
      const known = DFLOW_ERROR_CODES[code];
      if (known) return known;
      if (code === 1)  return 'Not enough USDC for stake + fee';
      if (code === 3)  return 'Token account not found — fund USDC first';
      return `Program error 0x${code.toString(16)} at instruction ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at instruction ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage|liquidity/i.test(String(l)));
  if (errLog) return String(errLog).slice(0, 140);
  return 'Order unavailable — try a different stake or market';
}

function normalizeMarket(raw) {
  // DFlow's /api/v1/markets returns fields like ticker, eventTicker, title,
  // yesMint, noMint, volume, status, closeTime. Multiple aliases let mock
  // and real data flow through the same UI.
  const yesMint = raw.yesMint || raw.yes_mint || raw.yesTokenMint || null;
  const noMint  = raw.noMint  || raw.no_mint  || raw.noTokenMint  || null;
  return {
    id:           raw.id || raw.ticker || raw.eventTicker || raw.market_id || yesMint,
    yesMint, noMint,
    base:         raw.base || raw.symbol || raw.asset || raw.underlying || 'BTC',
    category:     raw.category || raw.eventCategory || categorizeMarket(raw),
    question:     raw.question || raw.title || raw.name || raw.eventTitle || '',
    description:  raw.description || raw.subtitle || '',
    yesPrice:     Number(raw.yesPrice ?? raw.yes_price ?? raw.lastPriceYes ?? raw.lastYesPrice ?? raw.markPriceYes ?? 0.5),
    noPrice:      Number(raw.noPrice  ?? raw.no_price  ?? raw.lastPriceNo  ?? raw.lastNoPrice  ?? raw.markPriceNo  ?? 0.5),
    closeTs:      Number(raw.closeTs  ?? raw.close_time ?? raw.closeTime ?? raw.expiry ?? raw.expirationTime ?? Date.now() + 3600_000),
    volume24h:    Number(raw.volume24h ?? raw.volume_24h ?? raw.volume ?? raw.vol ?? 0),
    openInterest: Number(raw.openInterest ?? raw.open_interest ?? 0),
    hot:          Boolean(raw.hot ?? raw.featured),
  };
}

function categorizeMarket(m) {
  const closeMs = Number(m.closeTs ?? m.close_time ?? 0) - Date.now();
  if (closeMs <= 0) return 'events';
  if (closeMs < 10 * 60_000) return '5min';
  if (closeMs < 90 * 60_000) return 'hourly';
  if (closeMs < 36 * 3600_000) return 'daily';
  if (closeMs < 14 * 86400_000) return 'weekly';
  return 'events';
}

// =====================================================================
// MOCK MARKETS — used until DFlow endpoints are live
// =====================================================================
function getMockMarkets() {
  const now = Date.now();
  return [
    { id:'BTC-5M-NEXT', base:'BTC', category:'5min',
      question:'Bitcoin up at next 5-min close?',
      description:'Resolves YES if BTC at the next 5-minute candle close is higher than current price.',
      yesPrice:0.51, noPrice:0.49,
      closeTs: now + 4 * 60_000 + 30_000,
      volume24h: 482_000, openInterest: 96_000, hot: true },
    { id:'ETH-5M-NEXT', base:'ETH', category:'5min',
      question:'Ethereum up at next 5-min close?',
      description:'Resolves YES if ETH at the next 5-minute candle close is higher than current price.',
      yesPrice:0.48, noPrice:0.52,
      closeTs: now + 4 * 60_000 + 30_000,
      volume24h: 287_000, openInterest: 54_000, hot: true },
    { id:'SOL-5M-NEXT', base:'SOL', category:'5min',
      question:'Solana up at next 5-min close?',
      description:'Resolves YES if SOL at the next 5-minute candle close is higher than current price.',
      yesPrice:0.50, noPrice:0.50,
      closeTs: now + 4 * 60_000 + 30_000,
      volume24h: 64_000, openInterest: 18_000 },
    { id:'BTC-1H-UP', base:'BTC', category:'hourly',
      question:'Bitcoin up over the next hour?',
      description:'Resolves YES if BTC closes higher 1 hour from now than right now.',
      yesPrice:0.53, noPrice:0.47,
      closeTs: now + 47 * 60_000,
      volume24h: 168_000, openInterest: 42_000 },
    { id:'ETH-1H-UP', base:'ETH', category:'hourly',
      question:'Ethereum up over the next hour?',
      description:'Resolves YES if ETH closes higher 1 hour from now than right now.',
      yesPrice:0.49, noPrice:0.51,
      closeTs: now + 47 * 60_000,
      volume24h: 98_000, openInterest: 21_000 },
    { id:'BTC-EOD-UP', base:'BTC', category:'daily',
      question:'Bitcoin closes green today?',
      description:'Resolves YES if BTC at 5pm ET close is above the 12am ET open.',
      yesPrice:0.56, noPrice:0.44,
      closeTs: nextHourAt(17),
      volume24h: 924_000, openInterest: 215_000, hot: true },
    { id:'ETH-EOD-UP', base:'ETH', category:'daily',
      question:'Ethereum closes green today?',
      description:'Resolves YES if ETH at 5pm ET close is above the 12am ET open.',
      yesPrice:0.52, noPrice:0.48,
      closeTs: nextHourAt(17),
      volume24h: 412_000, openInterest: 88_000 },
    { id:'FED-RATE-CUT', base:'FED', category:'events',
      question:'Will the Fed cut rates at next FOMC?',
      description:'Resolves YES if FOMC announces a rate cut at the next scheduled meeting.',
      yesPrice:0.62, noPrice:0.38,
      closeTs: now + 21 * 86400_000,
      volume24h: 1_240_000, openInterest: 890_000, hot: true },
    { id:'CPI-ABOVE-3', base:'CPI', category:'events',
      question:'Next CPI print above 3.0%?',
      description:'Resolves YES if headline CPI YoY is above 3.0% in the next release.',
      yesPrice:0.34, noPrice:0.66,
      closeTs: now + 11 * 86400_000,
      volume24h: 480_000, openInterest: 220_000 },
    { id:'BTC-WK-100K', base:'BTC', category:'weekly',
      question:'BTC above $100,000 at Friday close?',
      description:'Resolves YES if BTC closes above $100,000 on Friday 5pm ET.',
      yesPrice:0.41, noPrice:0.59,
      closeTs: nextFridayAt(17),
      volume24h: 312_000, openInterest: 184_000 },
    { id:'ETH-WK-4K', base:'ETH', category:'weekly',
      question:'ETH above $4,000 at Friday close?',
      description:'Resolves YES if ETH closes above $4,000 on Friday 5pm ET.',
      yesPrice:0.36, noPrice:0.64,
      closeTs: nextFridayAt(17),
      volume24h: 158_000, openInterest: 72_000 },
    { id:'SOL-WK-250', base:'SOL', category:'weekly',
      question:'SOL above $250 at Friday close?',
      description:'Resolves YES if SOL closes above $250 on Friday 5pm ET.',
      yesPrice:0.29, noPrice:0.71,
      closeTs: nextFridayAt(17),
      volume24h: 64_000, openInterest: 38_000 },
  ];
}
function nextHourAt(hourET) {
  const d = new Date();
  d.setHours(hourET, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function nextFridayAt(hourET) {
  const d = new Date();
  const day = d.getDay();
  const daysUntilFri = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFri);
  d.setHours(hourET, 0, 0, 0);
  return d.getTime();
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
    }}>
      {closed ? 'CLOSED' : formatCountdown(remaining)}
    </span>
  );
}

function YesNoPills({ yesPrice, noPrice, large }) {
  const sz = large ? { fs: 13, py: '5px 11px' } : { fs: 11, py: '3px 8px' };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{
        padding: sz.py, borderRadius: 8,
        background: 'rgba(61,213,152,.10)', border: '1px solid rgba(61,213,152,.28)', ...T.mono,
      }}>
        <span style={{ color: C.muted2, fontSize: sz.fs - 3, fontWeight: 700, marginRight: 4 }}>YES</span>
        <span style={{ color: C.up, fontSize: sz.fs, fontWeight: 800 }}>{priceToCents(yesPrice)}¢</span>
      </div>
      <div style={{
        padding: sz.py, borderRadius: 8,
        background: 'rgba(255,138,158,.10)', border: '1px solid rgba(255,138,158,.28)', ...T.mono,
      }}>
        <span style={{ color: C.muted2, fontSize: sz.fs - 3, fontWeight: 700, marginRight: 4 }}>NO</span>
        <span style={{ color: C.down, fontSize: sz.fs, fontWeight: 800 }}>{priceToCents(noPrice)}¢</span>
      </div>
    </div>
  );
}

function CategoryBadge({ category, small }) {
  const meta = CAT_META[category];
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

function PositionsPanel({ positions, markets, onSell }) {
  if (!positions || positions.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 8, ...T.mono }}>YOUR POSITIONS</div>
      {positions.map(pos => {
        const market = markets.find(m => m.id === pos.marketId);
        const livePx = pos.side === 'YES' ? (market?.yesPrice ?? pos.entryPrice) : (market?.noPrice ?? pos.entryPrice);
        const cost   = pos.contracts * pos.entryPrice;
        const value  = pos.contracts * livePx;
        const pnl    = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        const inProfit = pnl >= 0;
        return (
          <div key={pos.id} style={{
            marginBottom: 8, padding: '12px 14px', borderRadius: 14,
            background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
            border: `1px solid ${inProfit ? 'rgba(61,213,152,.24)' : 'rgba(255,138,158,.24)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: pos.side === 'YES' ? C.up : C.down, padding: '1px 6px', borderRadius: 4, background: pos.side === 'YES' ? 'rgba(61,213,152,.12)' : 'rgba(255,138,158,.12)', ...T.mono }}>
                    {pos.side}
                  </span>
                  <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, ...T.mono }}>{pos.contracts} contracts</span>
                </div>
                <div style={{ fontSize: 12, color: C.ink, fontWeight: 600, lineHeight: 1.3, ...T.body }}>
                  {market?.question || pos.question || pos.marketId}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: inProfit ? C.up : C.down, ...T.display }}>
                  {inProfit ? '+' : ''}{fmt(pnl, 2)}
                </div>
                <div style={{ fontSize: 10, color: inProfit ? C.up : C.down, marginTop: 2, ...T.mono }}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 10 }}>
              {[['ENTRY', priceToCents(pos.entryPrice) + '¢'], ['NOW', priceToCents(livePx) + '¢'], ['COST', fmt(cost, 2)]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{l}</div>
                  <div style={{ fontSize: 11, color: C.ink, fontWeight: 700, marginTop: 2, ...T.mono }}>{v}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onSell(pos, market)} style={{
              width: '100%', padding: 9, borderRadius: 10,
              border: `1px solid ${inProfit ? 'rgba(61,213,152,.30)' : 'rgba(255,138,158,.30)'}`,
              background: inProfit ? 'rgba(61,213,152,.06)' : 'rgba(255,138,158,.06)',
              color: inProfit ? C.up : C.down,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
            }}>Sell position</button>
          </div>
        );
      })}
    </div>
  );
}

function TosModal({ open, onAccept, onClose }) {
  const [checked, setChecked] = useState(false);
  useBodyLock(open);
  useEffect(() => { if (!open) setChecked(false); }, [open]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 460, background: 'rgba(0,0,0,.86)', backdropFilter: 'blur(14px)', cursor: 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 461,
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        boxShadow: '0 -24px 70px rgba(0,0,0,.6)',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 22px 0' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 19, letterSpacing: '-.02em', ...T.display }}>Before you start</div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 16, ...T.body }}>
            One-time acknowledgement. We won't ask again on this device.
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 8px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.06)', border: '1px solid rgba(151,252,228,.20)', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>POWERED BY KALSHI</div>
            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.55, ...T.body }}>
              Trades execute on <strong style={{ color: C.inkStr }}>Kalshi</strong>, a CFTC-regulated event-contract exchange. NexusDEX is a non-custodial frontend and is not affiliated with Kalshi Inc.
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245,181,61,.06)', border: '1px solid rgba(245,181,61,.20)', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.amber, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>U.S. STATE RESTRICTIONS</div>
            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.55, marginBottom: 8, ...T.body }}>
              Kalshi prediction markets are not available to residents of:
            </div>
            <div style={{ fontSize: 12, color: C.inkStr, fontWeight: 700, letterSpacing: '.04em', ...T.mono }}>
              {RESTRICTED_STATES.join(' · ')}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5, ...T.body }}>
              By continuing you confirm you do not reside in any of the above.
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted2, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>WHAT YOU AGREE TO</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.ink, lineHeight: 1.7, ...T.body }}>
              <li>You are 18 or older.</li>
              <li>You may lose the full amount you spend on any contract.</li>
              <li>NexusDEX charges a 1.5% builder fee per trade in addition to Kalshi's exchange fees.</li>
              <li>You waive any claim against NexusDEX for losses from trading on Kalshi.</li>
              <li>You will not use this app while located in a restricted jurisdiction.</li>
            </ul>
          </div>
        </div>

        <div style={{
          flexShrink: 0,
          padding: '14px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: C.bg,
        }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, accentColor: C.hl, cursor: 'pointer', flexShrink: 0 }}/>
            <span style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5, fontWeight: 600, ...T.body }}>
              I have read and accept the above terms.
            </span>
          </label>
          <button onClick={checked ? onAccept : undefined} disabled={!checked} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none',
            background: checked ? `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)` : 'rgba(255,255,255,.06)',
            color: checked ? '#04070f' : C.muted2,
            fontWeight: 800, fontSize: 15,
            cursor: checked ? 'pointer' : 'not-allowed', minHeight: 52, ...T.display,
          }}>Continue</button>
        </div>
      </div>
    </>
  );
}

function BuyModal({ open, onClose, market, initialSide, walletPubkey, onConnectWallet, refreshPositions }) {
  const { connected, signTransaction } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]           = useState('YES');
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setSide(initialSide || 'YES');
      setAmount('');
      setStatus('idle');
      setError('');
      setStatusMsg('');
    }
  }, [open, initialSide, market?.id]);

  if (!open || !market) return null;

  const isYes      = side === 'YES';
  const livePrice  = isYes ? market.yesPrice : market.noPrice;
  const usd        = parseFloat(amount) || 0;
  const contracts  = livePrice > 0 ? usd / livePrice : 0;
  const maxPayout  = contracts * 1;
  const profitIfWin = Math.max(0, maxPayout - usd);
  const builderFee = usd * (DFLOW_BUILDER_FEE_BPS / 10_000);
  const tooSmall   = usd > 0 && usd < MIN_ORDER_USDC;
  const tooLarge   = usd > MAX_ORDER_USDC;

  const isBusy    = status === 'loading';
  const isSuccess = status === 'success';
  const isError   = status === 'error';

  const quickChips = [5, 25, 100, 500];

  const execute = async () => {
    if (!wcon)            { onConnectWallet?.(); return; }
    if (!walletPubkey)    { setError('Wallet not connected'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana address'); return; }
    if (!usd || tooSmall) { setError(`Minimum order is $${MIN_ORDER_USDC}`); return; }
    if (tooLarge)         { setError(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`); return; }
    if (!TREASURY_USDC_ATA) { setError('Treasury not configured'); return; }
    if (!signTransaction)   { setError('Wallet cannot sign transactions'); return; }

    setStatus('loading'); setError(''); setStatusMsg('Building order…');
    try {
      // 1. Get DFlow's order tx (raw, no builder-fee args)
      const built = await buildOrderTx({ market, side, usdcAmount: usd, walletPubkey });
      if (!built?.serializedTx) throw new Error('Order builder returned no transaction');

      // 2. Deserialize DFlow's tx
      const txBytes = Uint8Array.from(atob(built.serializedTx), c => c.charCodeAt(0));
      let originalTx;
      try { originalTx = VersionedTransaction.deserialize(txBytes); }
      catch { throw new Error('Unsupported transaction format from order builder'); }

      // 3. Decompile → raw instructions + ALTs
      const decompiled = await decompileVersionedTx(originalTx);

      // 4. Build SPL Transfer fee (USDC: user ATA → treasury ATA)
      const userUsdcAta = deriveUsdcAta(walletPubkey);
      const feeAtomic = Math.floor(
        usd * (DFLOW_BUILDER_FEE_BPS / 10_000) * Math.pow(10, USDC_DECIMALS)
      );
      const feeIx = createSplTransferInstruction(
        userUsdcAta, TREASURY_USDC_ATA, walletPubkey, feeAtomic
      );

      // 5. Recompile with fee prepended
      const wrappedTx = assembleOrderTx({
        instructions: decompiled.instructions,
        payerKey:     decompiled.payerKey,
        altAccounts:  decompiled.altAccounts,
        blockhash:    decompiled.blockhash,
        feeInstruction: feeIx,
      });

      // 6. Pre-sim — never trigger Phantom if sim fails
      setStatusMsg('Checking order…');
      const serializedForSim = btoa(String.fromCharCode(...wrappedTx.serialize()));
      const sim = await simulateBeforeSign(serializedForSim);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      // 7. User signs once
      setStatusMsg('Sign in your wallet…');
      const signed = await signTransaction(wrappedTx);

      // 8. Submit
      setStatusMsg('Submitting order…');
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const result = await submitSignedTx(serialized);
      if (!result?.ok) throw new Error(result?.error || 'Order rejected');

      setStatus('success');
      setStatusMsg('');
      refreshPositions?.();
      setTimeout(() => { setStatus('idle'); onClose(); }, 2200);
    } catch (e) {
      console.error('[buy]', e);
      setError(e.message || 'Order failed');
      setStatus('error');
      setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4000);
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
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>AMOUNT (USDC)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>1.5% FEE</span>
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
                  flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono,
                }}>${c}</button>
              ))}
            </div>

            {tooSmall && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Minimum order is ${MIN_ORDER_USDC}</div>}
            {tooLarge && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Max order is ${MAX_ORDER_USDC.toLocaleString()}</div>}
          </div>

          {/* Preview */}
          {usd > 0 && !tooSmall && !tooLarge && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>ORDER PREVIEW</div>
              {[
                ['You buy',          contracts.toFixed(2) + ' ' + side + ' contracts'],
                ['Price per share',  priceToCents(livePrice) + '¢'],
                ['Builder fee 1.5%', '-' + fmt(builderFee, 2)],
                ['Max payout',       fmt(maxPayout, 2)],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 6, borderTop: `1px solid ${C.hairline}` }}>
                <span style={{ color: C.ink, fontWeight: 700, fontSize: 12, ...T.body }}>Profit if {side === 'YES' ? 'yes' : 'no'}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: C.up, fontWeight: 800, fontSize: 14, ...T.mono }}>+{fmt(profitIfWin, 2)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {(isBusy || isSuccess) && statusMsg && (
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
            <button onClick={execute} disabled={isBusy || !amount || tooSmall || tooLarge} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : isError
                ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                : isYes
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !amount || tooSmall || tooLarge ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !amount || tooSmall || tooLarge ? 0.55 : 1,
              boxShadow: isYes ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' : isSuccess ? `${side} bought` : isError ? 'Retry' : usd > 0 && !tooSmall && !tooLarge ? `Buy ${contracts.toFixed(1)} ${side} for ${fmt(usd, 2)}` : `Buy ${side}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Non-custodial | Powered by Kalshi
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
  const [markets, setMarkets]       = useState(() => loadCached('nexus_kalshi_crypto', 60_000) || []);
  const [positions, setPositions]   = useState([]);
  const [filter, setFilter]         = useState('All');
  const [buyOpen, setBuyOpen]       = useState(false);
  const [activeMarket, setActiveMarket]   = useState(null);
  const [initialSide, setInitialSide]     = useState('YES');
  const [tosOpen, setTosOpen]       = useState(false);

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Poll markets every 10 sec
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchKalshiCryptoMarkets();
        if (!alive || !Array.isArray(data) || data.length === 0) return;
        setMarkets(data);
        saveCached('nexus_kalshi_crypto', data);
      } catch (e) { console.warn('[markets poll]', e?.message || e); }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Poll positions every 15 sec when wallet is connected
  const refreshPositions = useCallback(async () => {
    if (!walletPubkey) { setPositions([]); return; }
    try {
      const pos = await fetchUserPositions(walletPubkey);
      setPositions(pos);
    } catch (e) { console.warn('[positions]', e?.message || e); }
  }, [walletPubkey]);

  useEffect(() => {
    if (!walletPubkey) return;
    refreshPositions();
    const id = setInterval(refreshPositions, 15_000);
    return () => clearInterval(id);
  }, [walletPubkey, refreshPositions]);

  const handleBuy = (market, side) => {
    // Global TermsGate in App.js covers all ToS — no per-page modal needed.
    setActiveMarket(market);
    setInitialSide(side);
    setBuyOpen(true);
  };

  const handleTosAccept = () => {
    acceptTos();
    setTosOpen(false);
    if (activeMarket) setBuyOpen(true);
  };

  const handleSell = async (pos, market) => {
    // Open the buy modal in reverse: selling YES = buying NO at current price
    // For simplicity, we open BuyModal pre-filled with the opposite side.
    if (!market) return;
    setActiveMarket(market);
    setInitialSide(pos.side === 'YES' ? 'NO' : 'YES');
    setBuyOpen(true);
  };

  // Apply "live > closing-soon > profit-ranked categories" ordering
  const ordered = useMemo(() => {
    if (!markets.length) return [];
    const now = Date.now();
    // Live = closing within 10 min, sorted by soonest first
    const live = markets.filter(m => m.closeTs - now > 0 && m.closeTs - now < 10 * 60_000)
      .sort((a, b) => a.closeTs - b.closeTs);
    // Closing-soon = 10min - 90min
    const closingSoon = markets.filter(m => m.closeTs - now >= 10 * 60_000 && m.closeTs - now < 90 * 60_000)
      .sort((a, b) => a.closeTs - b.closeTs);
    // Everything else, sorted by 24h volume (most profitable first)
    const rest = markets.filter(m => m.closeTs - now >= 90 * 60_000)
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    return [...live, ...closingSoon, ...rest];
  }, [markets]);

  const filtered = useMemo(() => {
    if (filter === 'All') return ordered;
    return ordered.filter(m => m.category === filter);
  }, [ordered, filter]);

  const featured = useMemo(() => {
    // Always feature the highest-vol live or closing-soon market, fallback to highest-vol overall
    if (!ordered.length) return null;
    const now = Date.now();
    const live = ordered.filter(m => m.closeTs - now > 0 && m.closeTs - now < 90 * 60_000);
    const pool = live.length ? live : ordered;
    return pool.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0] || null;
  }, [ordered]);

  // Markets to show in the row list = filtered, excluding the featured one
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
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POWERED BY KALSHI</span>
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
              DeFi{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Predict</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Trade BTC, ETH and SOL prediction markets from your Solana wallet. Settles on Kalshi.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { label: 'MARKETS', value: markets.length || '-' },
                { label: '24H VOL', value: shortNum(totalVol) },
                { label: 'POSITIONS', value: positions.length || '0' },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* POSITIONS (if any) */}
        <PositionsPanel positions={positions} markets={markets} onSell={handleSell}/>

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

        {/* FEATURED (when "All" filter) */}
        {filter === 'All' && featured && <FeaturedMarketCard market={featured} onBuy={handleBuy}/>}

        {/* MARKET LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {listMarkets.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              No markets in this category right now.
            </div>
          ) : listMarkets.map(m => (
            <MarketRow key={m.id} market={m} onClick={() => handleBuy(m, 'YES')}/>
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>KALSHI</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          Trades execute on Kalshi, a CFTC-regulated exchange. NexusDEX is a non-custodial frontend and is not affiliated with Kalshi Inc. 1.5% builder fee applies.
        </div>

        <BuyModal
          open={buyOpen}
          onClose={() => setBuyOpen(false)}
          market={activeMarket}
          initialSide={initialSide}
          walletPubkey={walletPubkey}
          onConnectWallet={onConnectWallet}
          refreshPositions={refreshPositions}
        />
        <TosModal
          open={tosOpen}
          onAccept={handleTosAccept}
          onClose={() => setTosOpen(false)}
        />
      </div>
    </>
  );
}
