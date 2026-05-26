import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
} from '@solana/web3.js';

// =====================================================================
// CONFIG — xStocks via Jupiter Aggregator. 5% platform fee to FEE_WALLET.
// Atomic single-tx pattern: BUY prepends USDC fee transfer (deducted from
// user's input before Jupiter routes it); SELL appends USDC fee transfer
// taken from `otherAmountThreshold` so it never overdraws after slippage.
// =====================================================================
const FEE_WALLET   = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS      = 500;            // 5% — matches Wonderland/Swap/Bridge
const USDC_MINT    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

// Jupiter dynamicSlippage cap. UI doesn't expose a slippage knob.
const SLIPPAGE_BPS_MAX = 500;        // 5% — Jupiter picks tighter when possible

const MIN_USDC = 1;
const MAX_USDC = 50_000;

const TOKEN_PROGRAM_ID      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM_ID        = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// =====================================================================
// US GEO BLOCK — required for xStocks compliance. No VIP override.
// =====================================================================
const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const GEO_BLOCKED   = new Set(['US']);

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

// =====================================================================
// XSTOCKS LIST — verified mints. Decimals: 8 (Token-2022 standard).
// =====================================================================
const STOCKS = [
  // ------ TECH MEGACAPS ------
  { mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', symbol: 'TSLAx',  name: 'Tesla',                 ticker: 'TSLA',  decimals: 8, sector: 'Tech',   color: '#e31837' },
  { mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', symbol: 'AAPLx',  name: 'Apple',                 ticker: 'AAPL',  decimals: 8, sector: 'Tech',   color: '#a2aaad' },
  { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx',  name: 'NVIDIA',                ticker: 'NVDA',  decimals: 8, sector: 'Tech',   color: '#76b900' },
  { mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', symbol: 'METAx',  name: 'Meta Platforms',        ticker: 'META',  decimals: 8, sector: 'Tech',   color: '#0866ff' },
  { mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', symbol: 'GOOGLx', name: 'Alphabet',              ticker: 'GOOGL', decimals: 8, sector: 'Tech',   color: '#4285f4' },
  { mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', symbol: 'AMZNx',  name: 'Amazon',                ticker: 'AMZN',  decimals: 8, sector: 'Tech',   color: '#ff9900' },
  { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', symbol: 'MSFTx',  name: 'Microsoft',             ticker: 'MSFT',  decimals: 8, sector: 'Tech',   color: '#00a4ef' },
  { mint: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', symbol: 'NFLXx',  name: 'Netflix',               ticker: 'NFLX',  decimals: 8, sector: 'Tech',   color: '#e50914' },
  { mint: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', symbol: 'PLTRx',  name: 'Palantir',              ticker: 'PLTR',  decimals: 8, sector: 'Tech',   color: '#0a0a0a' },
  { mint: 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo', symbol: 'AVGOx',  name: 'Broadcom',              ticker: 'AVGO',  decimals: 8, sector: 'Tech',   color: '#cc092f' },

  // ------ CRYPTO-ADJACENT ------
  { mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', symbol: 'COINx',  name: 'Coinbase',              ticker: 'COIN',  decimals: 8, sector: 'Crypto', color: '#0052ff' },
  { mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx',  name: 'MicroStrategy',         ticker: 'MSTR',  decimals: 8, sector: 'Crypto', color: '#fcb017' },
  { mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', symbol: 'CRCLx',  name: 'Circle',                ticker: 'CRCL',  decimals: 8, sector: 'Crypto', color: '#3399ff' },
  { mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', symbol: 'HOODx',  name: 'Robinhood',             ticker: 'HOOD',  decimals: 8, sector: 'Crypto', color: '#cdff00' },

  // ------ ETFs ------
  { mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', symbol: 'SPYx',   name: 'S&P 500 ETF',           ticker: 'SPY',   decimals: 8, sector: 'ETF',    color: '#1c4f9c' },
  { mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', symbol: 'QQQx',   name: 'Nasdaq 100 ETF',        ticker: 'QQQ',   decimals: 8, sector: 'ETF',    color: '#003b71' },
  { mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', symbol: 'GLDx',   name: 'Gold Trust',            ticker: 'GLD',   decimals: 8, sector: 'ETF',    color: '#d4af37' },
  { mint: 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp', symbol: 'TBLLx',  name: '1-3 Month T-Bill ETF',  ticker: 'TBLL',  decimals: 8, sector: 'ETF',    color: '#2a4d6e' },
];

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Trending', label: 'Trending' },
  { id: 'Tech',     label: 'Tech' },
  { id: 'Crypto',   label: 'Crypto-Adj' },
  { id: 'ETF',      label: 'ETFs' },
];

// =====================================================================
// DESIGN TOKENS
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d', gold:'#ffcd3c',
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

// =====================================================================
// UTILS
// =====================================================================
function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}
function fmtAmt(n, d = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(d);
  return n.toFixed(6);
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidSolAddr(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }

// US market hours (informational only — xStocks trade 24/7 regardless)
function getUsMarketStatus() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
  const parts = fmt.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const day = parts.weekday;
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const timeMin = hour * 60 + minute;
  if (day === 'Sat' || day === 'Sun') return { open: false, label: 'Closed · Weekend' };
  if (timeMin >= 9*60+30 && timeMin < 16*60) return { open: true,  label: 'US Market Open' };
  if (timeMin >= 4*60   && timeMin < 9*60+30) return { open: false, label: 'Pre-Market' };
  if (timeMin >= 16*60  && timeMin < 20*60)   return { open: false, label: 'After-Hours' };
  return { open: false, label: 'Closed · Overnight' };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchStockPrices(mints) {
  if (!mints.length) return {};
  try {
    const url = `https://lite-api.jup.ag/price/v3?ids=${mints.join(',')}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8_000);
    if (!res.ok) return {};
    const json = await res.json();
    const out = {};
    Object.entries(json || {}).forEach(([mint, info]) => {
      const p = Number(info?.usdPrice);
      if (Number.isFinite(p) && p > 0) out[mint] = p;
    });
    return out;
  } catch (e) {
    console.warn('[jupiter price]', e?.message || e);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────
// JUPITER ROUTING
// ─────────────────────────────────────────────────────────────────────
async function getJupiterQuote({ inputMint, outputMint, amountAtomic, slippageBps }) {
  const params = new URLSearchParams({
    inputMint, outputMint,
    amount:      String(amountAtomic),
    slippageBps: String(slippageBps),
    swapMode:    'ExactIn',
  });
  const res = await fetchWithTimeout(`/api/jupiter/quote?${params}`, { headers: { Accept: 'application/json' } }, 12_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Quote failed (${res.status})`);
  return json;
}

async function getJupiterSwapInstructions({ quoteResponse, userPublicKey }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol:        true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: { maxBps: SLIPPAGE_BPS_MAX },
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports:   10_000_000,
        priorityLevel: 'high',
      },
    },
    useSharedAccounts: false,
  };
  const res = await fetchWithTimeout('/api/jupiter/swap-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Swap-instructions failed (${res.status})`);
  return json;
}

// ─────────────────────────────────────────────────────────────────────
// INSTRUCTION BUILDERS (atomic fee transfer)
// ─────────────────────────────────────────────────────────────────────
function deriveAta(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

// Idempotent create-ATA — instruction discriminator = 1 (Create) with the
// idempotent flag; the ATA program treats this as a no-op if the account
// already exists. Same shape Wonderland uses.
function createIdempotentAtaIx(payer, ata, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer,             isSigner: true,  isWritable: true  },
      { pubkey: ata,               isSigner: false, isWritable: true  },
      { pubkey: owner,             isSigner: false, isWritable: false },
      { pubkey: mint,              isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System
      { pubkey: tokenProgramId,    isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    data: new Uint8Array([1]),
  });
}

// SPL Token TransferChecked — discriminator 12 + amount(u64) + decimals(u8).
// Safer than legacy Transfer since the runtime verifies decimals.
function createTransferCheckedIx({ source, mint, destination, owner, amountAtomic, decimals, tokenProgramId = TOKEN_PROGRAM_ID }) {
  const data = new Uint8Array(10);
  data[0] = 12;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  data[9] = decimals & 0xff;
  return new TransactionInstruction({
    keys: [
      { pubkey: source,      isSigner: false, isWritable: true  },
      { pubkey: mint,        isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true  },
      { pubkey: owner,       isSigner: true,  isWritable: false },
    ],
    programId: tokenProgramId,
    data,
  });
}

function deserializeJupInstruction(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map(a => ({
      pubkey:     new PublicKey(a.pubkey),
      isSigner:   Boolean(a.isSigner),
      isWritable: Boolean(a.isWritable),
    })),
    data: Uint8Array.from(atob(ix.data), c => c.charCodeAt(0)),
  });
}

async function fetchLookupTableAccounts(altAddresses) {
  if (!altAddresses?.length) return [];
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
      params: [altAddresses, { encoding: 'base64', commitment: 'confirmed' }],
    }),
  }, 10_000);
  const json = await res.json();
  const values = json?.result?.value || [];
  const out = [];
  for (let i = 0; i < altAddresses.length; i++) {
    const acc = values[i];
    if (!acc?.data?.[0]) continue;
    const dataBytes = Uint8Array.from(atob(acc.data[0]), c => c.charCodeAt(0));
    out.push(new AddressLookupTableAccount({
      key:   new PublicKey(altAddresses[i]),
      state: AddressLookupTableAccount.deserialize(dataBytes),
    }));
  }
  return out;
}

async function fetchTokenBalance({ ownerPubkey, mint, decimals }) {
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
      params: [
        ownerPubkey,
        { mint },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    }),
  }, 8_000);
  const json = await res.json();
  const accs = json?.result?.value || [];
  let atomic = 0n;
  for (const a of accs) {
    const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (raw) atomic += BigInt(raw);
  }
  const ui = Number(atomic) / 10 ** decimals;
  return { atomic, ui };
}

// ─────────────────────────────────────────────────────────────────────
// ATOMIC TX ASSEMBLY
//
// BUY (USDC -> stock):
//   [Jupiter compute budget ixs]
//   [fee ATA-idempotent + transferChecked]   ← prepended
//   [Jupiter setup ixs]
//   [Jupiter swap ix]
//   [Jupiter cleanup ix]
//
// SELL (stock -> USDC):
//   [Jupiter compute budget ixs]
//   [Jupiter setup ixs]
//   [Jupiter swap ix]
//   [Jupiter cleanup ix]
//   [fee ATA-idempotent + transferChecked]   ← appended
//
// SELL fee is taken from `otherAmountThreshold` (worst-case USDC output)
// so it can never overdraw the user's USDC ATA after the swap.
// ─────────────────────────────────────────────────────────────────────
async function assembleSwapTx({ swapInstructions, feeIxs, userPublicKey, prependFee }) {
  const altAddrs = swapInstructions.addressLookupTableAddresses || [];
  const altAccounts = await fetchLookupTableAccounts(altAddrs);

  const computeBudgetIxs = (swapInstructions.computeBudgetInstructions || []).map(deserializeJupInstruction);
  const setupIxs         = (swapInstructions.setupInstructions || []).map(deserializeJupInstruction);
  const swapIx           = swapInstructions.swapInstruction ? deserializeJupInstruction(swapInstructions.swapInstruction) : null;
  const cleanupIx        = swapInstructions.cleanupInstruction ? deserializeJupInstruction(swapInstructions.cleanupInstruction) : null;

  const allIxs = [];
  // Compute budget MUST be first per Solana runtime
  for (const ix of computeBudgetIxs) allIxs.push(ix);
  if (prependFee) for (const ix of feeIxs) allIxs.push(ix);
  for (const ix of setupIxs)        allIxs.push(ix);
  if (swapIx)    allIxs.push(swapIx);
  if (cleanupIx) allIxs.push(cleanupIx);
  if (!prependFee) for (const ix of feeIxs) allIxs.push(ix);

  const bhRes = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 8_000);
  const bhJson = await bhRes.json();
  const blockhash = bhJson?.result?.value?.blockhash;
  if (!blockhash) throw new Error('Could not fetch recent blockhash');

  const message = new TransactionMessage({
    payerKey:        new PublicKey(userPublicKey),
    recentBlockhash: blockhash,
    instructions:    allIxs,
  }).compileToV0Message(altAccounts);

  return new VersionedTransaction(message);
}

const JUPITER_ERROR_CODES = {
  6000: 'No swap route available',
  6001: 'Price moved — try a slightly different amount',
  6002: 'Routing calculation error — try again',
  6003: 'Fee account misconfigured',
  6004: 'Invalid slippage value',
  6005: 'Insufficient liquidity along route',
  6006: 'Invalid input mint',
  6007: 'Invalid output mint',
  6008: 'Account setup error',
  6009: 'Order constraint not supported',
  6010: 'Invalid route plan',
  6011: 'Invalid referral authority',
  6012: 'Token ledger mismatch',
  6013: 'Invalid token ledger',
  6014: 'Token program incompatibility — this stock may need different routing',
};

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const code = Number(detail.Custom);
      const known = JUPITER_ERROR_CODES[code];
      if (known) return known;
      return `Program error 0x${code.toString(16)} at instruction ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at instruction ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage/i.test(String(l)));
  if (errLog) return String(errLog).slice(0, 140);
  return 'Trade unavailable — try a different amount or stock';
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

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function StockBadge({ stock, size = 40 }) {
  const letter = (stock.ticker || stock.symbol || '?').charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${stock.color},${stock.color}dd)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 900, fontSize: Math.round(size * 0.38),
      flexShrink: 0, letterSpacing: '-.02em', textShadow: '0 1px 3px rgba(0,0,0,.5)',
      boxShadow: `0 4px 14px ${stock.color}50`,
      ...T.display,
    }}>{letter}</div>
  );
}

function StockTile({ stock, price, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '14px 16px',
      display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center',
      background: 'transparent',
      border: 'none', borderBottom: `1px solid ${C.hairline}`,
      width: '100%', textAlign: 'left', cursor: 'pointer',
      WebkitTapHighlightColor: 'rgba(151,252,228,.10)', transition: 'background .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(151,252,228,.03)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <StockBadge stock={stock} size={40}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 14, letterSpacing: '-.01em', ...T.display }}>{stock.symbol}</span>
          <span style={{ color: C.muted2, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.04)', letterSpacing: '.04em', ...T.mono }}>{stock.ticker}</span>
        </div>
        <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2, ...T.body }}>{stock.name}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: price > 0 ? C.inkStr : C.muted, fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {price > 0 ? fmtUsd(price) : '—'}
        </div>
        <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', marginTop: 2, ...T.mono }}>TAP TO TRADE</div>
      </div>
    </button>
  );
}

function TradeModal({ open, stock, price, onClose, walletPubkey, onConnectWallet }) {
  const { signTransaction, connected } = useWallet();
  const wcon = connected;

  const [side, setSide]       = useState('BUY');
  const [amount, setAmount]   = useState('');
  const [quote, setQuote]     = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]     = useState('');
  const [stockBal, setStockBal] = useState({ atomic: 0n, ui: 0, loaded: false });
  const [usdcBal,  setUsdcBal]  = useState({ atomic: 0n, ui: 0, loaded: false });
  const quoteSeq = useRef(0);

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setAmount(''); setQuote(null); setError(''); setSubmitState({ kind: 'idle', message: '' });
      setSide('BUY');
      setStockBal({ atomic: 0n, ui: 0, loaded: false });
      setUsdcBal({ atomic: 0n, ui: 0, loaded: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !stock || !walletPubkey) return;
    let cancelled = false;
    (async () => {
      const [s, u] = await Promise.allSettled([
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: stock.mint, decimals: stock.decimals }),
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: USDC_MINT,  decimals: USDC_DECIMALS }),
      ]);
      if (cancelled) return;
      if (s.status === 'fulfilled') setStockBal({ ...s.value, loaded: true });
      else                          setStockBal({ atomic: 0n, ui: 0, loaded: true });
      if (u.status === 'fulfilled') setUsdcBal({ ...u.value, loaded: true });
      else                          setUsdcBal({ atomic: 0n, ui: 0, loaded: true });
    })();
    return () => { cancelled = true; };
  }, [open, stock, walletPubkey, submitState.kind]);

  // QUOTE — Jupiter routes the NET amount after our 5% fee for BUY,
  // and the FULL stock amount for SELL (fee deducted from USDC output).
  useEffect(() => {
    if (!open || !stock) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const isBuy = side === 'BUY';
        const inputMint  = isBuy ? USDC_MINT : stock.mint;
        const outputMint = isBuy ? stock.mint : USDC_MINT;

        let atomic;
        if (isBuy) {
          // User pays N USDC. 5% fee taken from input → Jupiter routes net.
          const grossUsdcAtomic = Math.round(n * 10 ** USDC_DECIMALS);
          const feeUsdcAtomic   = Math.floor(grossUsdcAtomic * FEE_BPS / 10000);
          atomic = grossUsdcAtomic - feeUsdcAtomic;
        } else {
          // User wants ~N USDC out. Translate to stock units via live price,
          // sell the full stock amount, fee taken from USDC output.
          if (!(price > 0)) { setQuote(null); setQuoting(false); return; }
          atomic = Math.round((n / price) * 10 ** stock.decimals);
        }
        if (atomic < 1) { setQuote(null); setQuoting(false); return; }

        const q = await getJupiterQuote({
          inputMint, outputMint,
          amountAtomic: atomic,
          slippageBps:  SLIPPAGE_BPS_MAX,
        });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setError(e.message || 'Quote failed');
        setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [amount, side, stock, open, price]);

  if (!open || !stock) return null;

  const usd       = parseFloat(amount) || 0;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  const outAtomic   = quote ? Number(quote.outAmount) : 0;
  const isBuy       = side === 'BUY';
  const outDecimals = isBuy ? stock.decimals : USDC_DECIMALS;
  const grossOut    = outAtomic / 10 ** outDecimals;

  const feeBpsRatio    = FEE_BPS / 10000;
  const platformFeeUsd = isBuy
    ? usd * feeBpsRatio
    : grossOut * feeBpsRatio;
  const netOutUsdc  = !isBuy ? Math.max(0, grossOut - platformFeeUsd) : 0;
  const outAmount   = isBuy ? grossOut : netOutUsdc;
  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  const stockAtomicNeeded = (() => {
    if (isBuy || !(usd > 0) || !(price > 0) || !stock) return 0n;
    try { return BigInt(Math.round((usd / price) * 10 ** stock.decimals)); } catch { return 0n; }
  })();
  const validStake = isBuy
    ? (usd >= MIN_USDC && usd <= MAX_USDC)
    : (stockAtomicNeeded > 0n && stockAtomicNeeded <= stockBal.atomic);
  const insufficientStock = !isBuy && stockBal.loaded && stockAtomicNeeded > stockBal.atomic;
  const sellStockEquiv = !isBuy && usd > 0 && price > 0 ? usd / price : 0;

  const handleSubmit = async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!walletPubkey || !isValidSolAddr(walletPubkey)) { setError('Wallet not connected'); return; }
    if (!quote) { setError('No quote available'); return; }
    if (!signTransaction) { setError('Wallet cannot sign'); return; }

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });
    setError('');

    try {
      const owner       = new PublicKey(walletPubkey);
      const usdcMintPk  = new PublicKey(USDC_MINT);

      // Fee always lands in USDC at the fee wallet's USDC ATA.
      const userUsdcAta = deriveAta(owner,      usdcMintPk, TOKEN_PROGRAM_ID);
      const feeUsdcAta  = deriveAta(FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID);

      // Fee base:
      //   BUY  → gross USDC input × 5%
      //   SELL → worst-case USDC output (otherAmountThreshold) × 5%
      //          using worst-case ensures the transferChecked can never overdraw.
      let feeAtomic;
      if (side === 'BUY') {
        feeAtomic = BigInt(Math.round(usd * 10 ** USDC_DECIMALS)) * BigInt(FEE_BPS) / 10000n;
      } else {
        const worstUsdcOut = BigInt(quote.otherAmountThreshold || quote.outAmount || '0');
        feeAtomic = (worstUsdcOut * BigInt(FEE_BPS)) / 10000n;
      }
      if (feeAtomic <= 0n) throw new Error('Fee amount rounds to zero — amount too small');

      // Ensure fee wallet's USDC ATA exists, then transfer.
      const feeIxs = [
        createIdempotentAtaIx(owner, feeUsdcAta, FEE_WALLET, usdcMintPk, TOKEN_PROGRAM_ID),
        createTransferCheckedIx({
          source: userUsdcAta,
          mint: usdcMintPk,
          destination: feeUsdcAta,
          owner,
          amountAtomic: feeAtomic,
          decimals: USDC_DECIMALS,
          tokenProgramId: TOKEN_PROGRAM_ID,
        }),
      ];

      const swapIxs = await getJupiterSwapInstructions({
        quoteResponse: quote,
        userPublicKey: walletPubkey,
      });

      const tx = await assembleSwapTx({
        swapInstructions: swapIxs,
        feeIxs,
        userPublicKey:    walletPubkey,
        prependFee:       side === 'BUY',
      });

      setSubmitState({ kind: 'loading', message: 'Simulating...' });
      const serializedForSim = btoa(String.fromCharCode(...tx.serialize()));
      const sim = await simulateBeforeSign(serializedForSim);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      setSubmitState({ kind: 'loading', message: 'Confirm in your wallet...' });
      const signed = await signTransaction(tx);

      setSubmitState({ kind: 'loading', message: 'Submitting on Solana...' });
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const submitRes = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'sendTransaction',
          params: [serialized, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 5 }],
        }),
      }, 20_000);
      const submitJson = await submitRes.json();
      if (submitJson.error) throw new Error(submitJson.error.message || 'Submit failed');

      setSubmitState({ kind: 'success', message: 'Swap submitted' });
      setTimeout(() => { onClose(); setSubmitState({ kind: 'idle', message: '' }); }, 2200);
    } catch (e) {
      console.error('[stocks swap]', e);
      const msg = e.message || 'Swap failed';
      setSubmitState({ kind: 'error', message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4500);
    }
  };

  const sellPctUsd = (pct) => {
    if (!stockBal.loaded || stockBal.atomic <= 0n || !(price > 0)) return '';
    if (pct === 100) {
      const exactUsd = (Number(stockBal.atomic) / 10 ** stock.decimals) * price;
      return (Math.floor(exactUsd * 100) / 100).toFixed(2);
    }
    const partUsd = (Number(stockBal.atomic) * (pct / 100) / 10 ** stock.decimals) * price;
    return (Math.floor(partUsd * 100) / 100).toFixed(2);
  };
  const buyChips  = [{ label: '$50', val: '50' }, { label: '$100', val: '100' }, { label: '$500', val: '500' }, { label: '$1000', val: '1000' }];
  const sellChips = [
    { label: '25%', val: sellPctUsd(25)  },
    { label: '50%', val: sellPctUsd(50)  },
    { label: '75%', val: sellPctUsd(75)  },
    { label: 'MAX', val: sellPctUsd(100) },
  ];
  const chips = isBuy ? buyChips : sellChips;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px 12px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 16px' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StockBadge stock={stock} size={44}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.02em', ...T.display }}>{stock.symbol}</span>
                <span style={{ color: C.muted2, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,.04)', letterSpacing: '.04em', ...T.mono }}>{stock.ticker}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, ...T.body }}>{stock.name}</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: isBusy ? 'not-allowed' : 'pointer', flexShrink: 0 }}>×</button>
          </div>
          {price > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>LIVE PRICE</span>
              <span style={{ fontSize: 16, color: C.inkStr, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...T.mono }}>{fmtUsd(price)}</span>
            </div>
          )}
          {wcon && (
            <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.borderHi}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: C.hl, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>
                YOU OWN
              </span>
              <span style={{ fontSize: 12.5, color: C.inkStr, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', ...T.mono }}>
                {!stockBal.loaded
                  ? '...'
                  : stockBal.ui > 0
                    ? <>{fmtAmt(stockBal.ui, 6)} {stock.symbol} <span style={{ color: C.muted, fontWeight: 600 }}>· {fmtUsd(stockBal.ui * price, 2)}</span></>
                    : <span style={{ color: C.muted }}>0 {stock.symbol}</span>}
                {' '}
                <span style={{ color: C.muted2, fontWeight: 600 }}>
                  · {usdcBal.loaded ? fmtUsd(usdcBal.ui, 2) : '...'} USDC
                </span>
              </span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 14px', minHeight: 0 }}>
          <div style={{ display: 'inline-flex', padding: 3, marginBottom: 14, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 999, gap: 3, width: '100%' }}>
            {['BUY', 'SELL'].map(s => {
              const active = side === s;
              const c = s === 'BUY' ? C.up : C.down;
              return (
                <button key={s} onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }} disabled={isBusy} style={{
                  flex: 1, padding: '9px 16px', borderRadius: 999, border: 'none',
                  background: active ? (s === 'BUY' ? 'rgba(61,213,152,.18)' : 'rgba(255,138,158,.18)') : 'transparent',
                  color: active ? c : C.muted, fontWeight: 800, fontSize: 13,
                  cursor: isBusy ? 'not-allowed' : 'pointer', letterSpacing: '-.01em', ...T.display,
                }}>{s === 'BUY' ? 'Buy with USDC' : 'Sell to USDC'}</button>
              );
            })}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>
                {isBuy ? 'YOU PAY (USDC)' : 'YOU SELL (USDC)'}
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy} inputMode="decimal" enterKeyHint="done"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}/>
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>USDC</span>
            </div>
            {!isBuy && sellStockEquiv > 0 && (
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 9, marginTop: -3, paddingLeft: 4, ...T.mono }}>
                ≈ {fmtAmt(sellStockEquiv, 6)} {stock.symbol}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {chips.map(c => {
                const disabled = isBusy || !c.val;
                return (
                  <button key={c.label} onClick={() => { if (c.val) { setAmount(c.val); setError(''); } }} disabled={disabled} style={{ flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,.03)', color: c.val ? C.muted : C.muted2, fontWeight: 700, fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, ...T.mono }}>{c.label}</button>
                );
              })}
            </div>
          </div>

          {usd > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...T.mono }}>
                <span>YOU RECEIVE</span>
                {quoting && <span style={{ color: C.hl }}>updating...</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: outAtomic > 0 ? C.inkStr : C.muted, fontVariantNumeric: 'tabular-nums', marginBottom: 10, ...T.display }}>
                {outAtomic > 0 ? (isBuy ? fmtAmt(outAmount, 6) + ' ' + stock.symbol : fmtUsd(outAmount, 2)) : '—'}
              </div>
              {quote && (
                <div style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8 }}>
                  {[
                    ['Price impact', priceImpactPct.toFixed(2) + '%'],
                    ['Route', (quote.routePlan?.length || 1) + ' hop' + ((quote.routePlan?.length || 1) === 1 ? '' : 's')],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ color: C.muted, fontSize: 11, ...T.body }}>{l}</span>
                      <span style={{ color: C.ink, fontSize: 11, fontWeight: 700, ...T.mono }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)', borderTop: `1px solid ${C.hairline}`, background: `linear-gradient(180deg,transparent 0%,${C.bg} 20%)` }}>
          {submitState.kind === 'loading' && submitState.message && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nx-spin 0.8s linear infinite' }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{submitState.message}</span>
            </div>
          )}
          {(error || submitState.kind === 'error') && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>
              {error || submitState.message}
            </div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Wallet
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={isBusy || !quote || !validStake} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : side === 'BUY'
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !quote || !validStake ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !quote || !validStake ? 0.55 : 1,
              boxShadow: '0 12px 30px rgba(151,252,228,.18)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' :
               isSuccess ? 'Swap placed' :
               insufficientStock ? `Insufficient ${stock.symbol}` :
               !validStake ? 'Enter USDC amount' :
               !quote ? (quoting ? 'Getting quote...' : 'No quote') :
               `${side === 'BUY' ? 'Buy' : 'Sell'} ${stock.symbol} · ${fmtUsd(usd, 2)}`}
            </button>
          )}

          <div style={{ fontSize: 9.5, color: C.muted2, textAlign: 'center', marginTop: 10, lineHeight: 1.5, ...T.body }}>
            Trade tokenized equity via Jupiter · USDC settles to your Solana wallet · No KYC
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// US REGION BLOCK
// =====================================================================
function StocksRegionBlock() {
  return (
    <div style={{
      maxWidth: 680, margin: '0 auto', width: '100%',
      padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
      color: C.ink, minHeight: '80vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 10%,rgba(168,127,255,.14),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 30%,rgba(151,252,228,.08),transparent 50%)',
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');@import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap')`}</style>
      <div style={{
        width: '100%', maxWidth: 480,
        padding: '44px 28px 40px', borderRadius: 28,
        background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
        border: '1px solid rgba(168,127,255,.22)',
        boxShadow: '0 24px 80px rgba(0,0,0,.55), 0 0 60px rgba(168,127,255,.10)',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 60% at 50% -10%,rgba(151,252,228,.10),transparent 70%)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: 28, lineHeight: 1.05, fontWeight: 600,
            margin: '0 0 12px', letterSpacing: '-.045em',
            background: `linear-gradient(135deg,${C.inkStr} 0%,${C.violet} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            ...T.hero,
          }}>
            Stocks isn't available here
          </h1>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
            Tokenized equities are restricted in your region. Swap, Bridge, Wonderland, and Wallet remain fully available.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MAIN
// =====================================================================
function StocksInner({ onConnectWallet }) {
  const [filter, setFilter]   = useState('All');
  const [prices, setPrices]   = useState({});
  const [active, setActive]   = useState(null);
  const [marketStatus, setMarketStatus] = useState(() => getUsMarketStatus());

  const { publicKey: solPk } = useWallet();
  const walletPubkey = useMemo(() => solPk ? solPk.toString() : null, [solPk]);

  useEffect(() => {
    let alive = true;
    const mints = STOCKS.map(s => s.mint);
    const tick = async () => {
      const result = await fetchStockPrices(mints);
      if (!alive) return;
      setPrices(result);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setMarketStatus(getUsMarketStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'All')      return STOCKS;
    if (filter === 'Trending') return STOCKS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return STOCKS.filter(s => s.sector === filter);
  }, [filter]);

  const totalListed = STOCKS.length;
  const totalPriced = Object.keys(prices).length;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nx-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nx-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        <div style={{ marginTop: 10, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(168,127,255,.16),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', left: -60, bottom: -80, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.10),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketStatus.open ? C.up : C.muted2, boxShadow: marketStatus.open ? `0 0 8px ${C.up}` : 'none', animation: marketStatus.open ? 'nx-pulse 1.6s ease-in-out infinite' : 'none' }}/>
                <span style={{ color: marketStatus.open ? C.up : C.muted, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>{marketStatus.label.toUpperCase()}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: 'rgba(255,205,60,.08)', border: '1px solid rgba(255,205,60,.20)' }}>
                <span style={{ color: C.gold, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>24/7 TRADING</span>
              </div>
            </div>
            <h1 style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.04em', ...T.hero }}>
              Trade global{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>stocks</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 16px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Tokenized equities settle in USDC on Solana. No broker, no KYC, no market hours.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { value: String(totalListed),        label: 'STOCKS',         color: C.inkStr,                       align: 'left'  },
                { value: String(totalPriced),        label: 'PRICED',         color: totalPriced > 0 ? C.hl : C.muted, align: 'center' },
                { value: '24/7',                     label: 'TRADE WITH SOL', color: C.gold,                         align: 'right' },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: s.align, borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '7px 13px', borderRadius: 999,
              border: `1px solid ${filter === f.id ? C.borderHi : C.border}`,
              background: filter === f.id ? C.hlDim : 'rgba(255,255,255,.03)',
              color: filter === f.id ? C.hl : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, ...T.body,
            }}>{f.label}</button>
          ))}
        </div>

        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              No stocks in this category.
            </div>
          ) : filtered.map(s => (
            <StockTile key={s.mint} stock={s} price={prices[s.mint] || 0} onClick={() => setActive(s)}/>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>JUPITER · xSTOCKS</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          xStocks issued by Backed Finance (Swiss-regulated). Each token backed 1:1 by underlying equity in qualified custody. Settles in USDC on Solana.
        </div>
      </div>

      <TradeModal
        open={!!active}
        stock={active}
        price={active ? prices[active.mint] || 0 : 0}
        onClose={() => setActive(null)}
        walletPubkey={walletPubkey}
        onConnectWallet={onConnectWallet}
      />
    </>
  );
}

// =====================================================================
// US geo block — required for xStocks. Everyone else gets full access.
// Owner wallet bypass: when this wallet connects, geo is skipped entirely.
// =====================================================================
const OWNER_BYPASS_PUBKEY = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

export default function Stocks({ onConnectWallet }) {
  const { publicKey } = useWallet();
  const connectedPk = publicKey ? publicKey.toBase58() : null;
  const ownerBypass = connectedPk === OWNER_BYPASS_PUBKEY;

  const [country, setCountry] = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    // Skip the geo lookup entirely for owner — saves a network call too.
    if (ownerBypass) { setGeoChecked(true); return; }
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, [ownerBypass]);

  // Block US users unless the owner wallet is connected.
  if (!ownerBypass && geoChecked && country && GEO_BLOCKED.has(country)) {
    return <StocksRegionBlock/>;
  }

  return <StocksInner onConnectWallet={onConnectWallet}/>;
}
