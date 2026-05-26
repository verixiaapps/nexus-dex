import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
} from '@solana/web3.js';
import './Stocks.css';

// =====================================================================
// CONFIG — brand tokens via Jupiter Aggregator. 5% platform fee to FEE_WALLET.
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
// US GEO BLOCK — required for compliance. No VIP override.
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
// BRAND TOKEN LIST — verified mints. Decimals: 8 (Token-2022 standard).
// =====================================================================
const BRANDS = [
  // ------ TECH MEGABRANDS ------
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

  // ------ INDEX TOKENS ------
  { mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', symbol: 'SPYx',   name: 'S&P 500 Index',         ticker: 'SPY',   decimals: 8, sector: 'Index',  color: '#1c4f9c' },
  { mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', symbol: 'QQQx',   name: 'Nasdaq 100 Index',      ticker: 'QQQ',   decimals: 8, sector: 'Index',  color: '#003b71' },
  { mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', symbol: 'GLDx',   name: 'Gold',                  ticker: 'GLD',   decimals: 8, sector: 'Index',  color: '#d4af37' },
  { mint: 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp', symbol: 'TBLLx',  name: 'Short-Term Treasury',   ticker: 'TBLL',  decimals: 8, sector: 'Index',  color: '#2a4d6e' },
];

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Trending', label: 'Trending' },
  { id: 'Tech',     label: 'Tech' },
  { id: 'Crypto',   label: 'Crypto-Adj' },
  { id: 'Index',    label: 'Indexes' },
];

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

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchBrandPrices(mints) {
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
// BUY (USDC -> brand):
//   [Jupiter compute budget ixs]
//   [fee ATA-idempotent + transferChecked]   ← prepended
//   [Jupiter setup ixs]
//   [Jupiter swap ix]
//   [Jupiter cleanup ix]
//
// SELL (brand -> USDC):
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
  6014: 'Token program incompatibility — this brand may need different routing',
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
  return 'Trade unavailable — try a different amount or brand';
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
function BrandBadge({ brand, size = 40 }) {
  const letter = (brand.ticker || brand.symbol || '?').charAt(0).toUpperCase();
  return (
    <div
      className="st-badge"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg,${brand.color},${brand.color}dd)`,
        fontSize: Math.round(size * 0.38),
        boxShadow: `0 4px 14px ${brand.color}50`,
      }}
    >{letter}</div>
  );
}

function BrandTile({ brand, price, onClick }) {
  return (
    <button onClick={onClick} className="st-tile">
      <BrandBadge brand={brand} size={40}/>
      <div className="st-tile-mid">
        <div className="st-tile-row">
          <span className="st-tile-sym">{brand.symbol}</span>
          <span className="st-tile-ticker">{brand.ticker}</span>
        </div>
        <div className="st-tile-name">{brand.name}</div>
      </div>
      <div className="st-tile-right">
        <div className={'st-tile-price' + (price > 0 ? '' : ' st-muted')}>
          {price > 0 ? fmtUsd(price) : '—'}
        </div>
        <div className="st-tile-cta">TAP TO TRADE</div>
      </div>
    </button>
  );
}

function TradeModal({ open, brand, price, onClose, walletPubkey, onConnectWallet }) {
  const { signTransaction, connected } = useWallet();
  const wcon = connected;

  const [side, setSide]       = useState('BUY');
  const [amount, setAmount]   = useState('');
  const [quote, setQuote]     = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]     = useState('');
  const [brandBal, setBrandBal] = useState({ atomic: 0n, ui: 0, loaded: false });
  const [usdcBal,  setUsdcBal]  = useState({ atomic: 0n, ui: 0, loaded: false });
  const quoteSeq = useRef(0);

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setAmount(''); setQuote(null); setError(''); setSubmitState({ kind: 'idle', message: '' });
      setSide('BUY');
      setBrandBal({ atomic: 0n, ui: 0, loaded: false });
      setUsdcBal({ atomic: 0n, ui: 0, loaded: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !brand || !walletPubkey) return;
    let cancelled = false;
    (async () => {
      const [s, u] = await Promise.allSettled([
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: brand.mint, decimals: brand.decimals }),
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: USDC_MINT,  decimals: USDC_DECIMALS }),
      ]);
      if (cancelled) return;
      if (s.status === 'fulfilled') setBrandBal({ ...s.value, loaded: true });
      else                          setBrandBal({ atomic: 0n, ui: 0, loaded: true });
      if (u.status === 'fulfilled') setUsdcBal({ ...u.value, loaded: true });
      else                          setUsdcBal({ atomic: 0n, ui: 0, loaded: true });
    })();
    return () => { cancelled = true; };
  }, [open, brand, walletPubkey, submitState.kind]);

  // QUOTE — Jupiter routes the NET amount after our 5% fee for BUY,
  // and the FULL brand amount for SELL (fee deducted from USDC output).
  useEffect(() => {
    if (!open || !brand) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const isBuy = side === 'BUY';
        const inputMint  = isBuy ? USDC_MINT : brand.mint;
        const outputMint = isBuy ? brand.mint : USDC_MINT;

        let atomic;
        if (isBuy) {
          // User pays N USDC. 5% fee taken from input → Jupiter routes net.
          const grossUsdcAtomic = Math.round(n * 10 ** USDC_DECIMALS);
          const feeUsdcAtomic   = Math.floor(grossUsdcAtomic * FEE_BPS / 10000);
          atomic = grossUsdcAtomic - feeUsdcAtomic;
        } else {
          // User wants ~N USDC out. Translate to brand units via live price,
          // sell the full brand amount, fee taken from USDC output.
          if (!(price > 0)) { setQuote(null); setQuoting(false); return; }
          atomic = Math.round((n / price) * 10 ** brand.decimals);
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
  }, [amount, side, brand, open, price]);

  if (!open || !brand) return null;

  const usd       = parseFloat(amount) || 0;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  const outAtomic   = quote ? Number(quote.outAmount) : 0;
  const isBuy       = side === 'BUY';
  const outDecimals = isBuy ? brand.decimals : USDC_DECIMALS;
  const grossOut    = outAtomic / 10 ** outDecimals;

  const feeBpsRatio    = FEE_BPS / 10000;
  const platformFeeUsd = isBuy
    ? usd * feeBpsRatio
    : grossOut * feeBpsRatio;
  const netOutUsdc  = !isBuy ? Math.max(0, grossOut - platformFeeUsd) : 0;
  const outAmount   = isBuy ? grossOut : netOutUsdc;
  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  const brandAtomicNeeded = (() => {
    if (isBuy || !(usd > 0) || !(price > 0) || !brand) return 0n;
    try { return BigInt(Math.round((usd / price) * 10 ** brand.decimals)); } catch { return 0n; }
  })();
  const validStake = isBuy
    ? (usd >= MIN_USDC && usd <= MAX_USDC)
    : (brandAtomicNeeded > 0n && brandAtomicNeeded <= brandBal.atomic);
  const insufficientBrand = !isBuy && brandBal.loaded && brandAtomicNeeded > brandBal.atomic;
  const sellBrandEquiv = !isBuy && usd > 0 && price > 0 ? usd / price : 0;

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
      console.error('[brands swap]', e);
      const msg = e.message || 'Swap failed';
      setSubmitState({ kind: 'error', message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4500);
    }
  };

  const sellPctUsd = (pct) => {
    if (!brandBal.loaded || brandBal.atomic <= 0n || !(price > 0)) return '';
    if (pct === 100) {
      const exactUsd = (Number(brandBal.atomic) / 10 ** brand.decimals) * price;
      return (Math.floor(exactUsd * 100) / 100).toFixed(2);
    }
    const partUsd = (Number(brandBal.atomic) * (pct / 100) / 10 ** brand.decimals) * price;
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
      <div onClick={isBusy ? undefined : onClose} className={'st-modal-backdrop' + (isBusy ? ' st-busy' : '')}/>
      <div className="st-sheet">
        <div className="st-sheet-head">
          <div className="st-grabber"/>
          <div className="st-sheet-head-row">
            <BrandBadge brand={brand} size={44}/>
            <div className="st-sheet-title-wrap">
              <div className="st-sheet-title-row">
                <span className="st-sheet-title">{brand.symbol}</span>
                <span className="st-tile-ticker">{brand.ticker}</span>
              </div>
              <div className="st-sheet-subtitle">{brand.name}</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} className="st-close-btn">×</button>
          </div>
          {price > 0 && (
            <div className="st-live-price">
              <span className="st-live-price-label">LIVE PRICE</span>
              <span className="st-live-price-val">{fmtUsd(price)}</span>
            </div>
          )}
          {wcon && (
            <div className="st-you-own">
              <span className="st-you-own-label">YOU OWN</span>
              <span className="st-you-own-val">
                {!brandBal.loaded
                  ? '...'
                  : brandBal.ui > 0
                    ? <>{fmtAmt(brandBal.ui, 6)} {brand.symbol} <span className="st-muted-soft">· {fmtUsd(brandBal.ui * price, 2)}</span></>
                    : <span className="st-muted">0 {brand.symbol}</span>}
                {' '}
                <span className="st-muted-deep">
                  · {usdcBal.loaded ? fmtUsd(usdcBal.ui, 2) : '...'} USDC
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="st-sheet-body">
          <div className="st-side-switch">
            {['BUY', 'SELL'].map(s => {
              const active = side === s;
              return (
                <button
                  key={s}
                  onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }}
                  disabled={isBusy}
                  className={'st-side-btn' + (active ? ` st-active st-${s.toLowerCase()}` : '')}
                >{s === 'BUY' ? 'Buy with USDC' : 'Sell to USDC'}</button>
              );
            })}
          </div>

          <div className="st-amount-wrap">
            <div className="st-amount-label">
              <span>{isBuy ? 'YOU PAY (USDC)' : 'YOU SELL (USDC)'}</span>
            </div>
            <div className={'st-amount-input-wrap' + (isBusy ? ' st-busy' : '')}>
              <span className="st-amount-dollar">$</span>
              <input
                value={amount}
                onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }}
                placeholder="0.00"
                disabled={isBusy}
                inputMode="decimal"
                enterKeyHint="done"
                className="st-amount-input"
              />
              <span className="st-amount-suffix">USDC</span>
            </div>
            {!isBuy && sellBrandEquiv > 0 && (
              <div className="st-amount-equiv">
                ≈ {fmtAmt(sellBrandEquiv, 6)} {brand.symbol}
              </div>
            )}
            <div className="st-chips">
              {chips.map(c => {
                const disabled = isBusy || !c.val;
                return (
                  <button
                    key={c.label}
                    onClick={() => { if (c.val) { setAmount(c.val); setError(''); } }}
                    disabled={disabled}
                    className={'st-chip' + (disabled ? ' st-chip-off' : '')}
                  >{c.label}</button>
                );
              })}
            </div>
          </div>

          {usd > 0 && (
            <div className="st-receive">
              <div className="st-receive-head">
                <span>YOU RECEIVE</span>
                {quoting && <span className="st-receive-loading">updating...</span>}
              </div>
              <div className={'st-receive-val' + (outAtomic > 0 ? '' : ' st-muted')}>
                {outAtomic > 0 ? (isBuy ? fmtAmt(outAmount, 6) + ' ' + brand.symbol : fmtUsd(outAmount, 2)) : '—'}
              </div>
              {quote && (
                <div className="st-receive-meta">
                  {[
                    ['Price impact', priceImpactPct.toFixed(2) + '%'],
                    ['Route', (quote.routePlan?.length || 1) + ' hop' + ((quote.routePlan?.length || 1) === 1 ? '' : 's')],
                  ].map(([l, v]) => (
                    <div key={l} className="st-receive-meta-row">
                      <span>{l}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="st-cta-wrap">
          {submitState.kind === 'loading' && submitState.message && (
            <div className="st-status-banner">
              <div className="st-spinner"/>
              <span>{submitState.message}</span>
            </div>
          )}
          {(error || submitState.kind === 'error') && (
            <div className="st-error-banner">
              {error || submitState.message}
            </div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} className="st-cta st-cta-connect">
              Connect Wallet
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isBusy || !quote || !validStake}
              className={
                'st-cta '
                + (isSuccess
                  ? 'st-cta-success'
                  : side === 'BUY' ? 'st-cta-buy' : 'st-cta-sell')
                + (isBusy || !quote || !validStake ? ' st-cta-disabled' : '')
              }
            >
              {isBusy ? 'Processing...' :
               isSuccess ? 'Swap placed' :
               insufficientBrand ? `Insufficient ${brand.symbol}` :
               !validStake ? 'Enter USDC amount' :
               !quote ? (quoting ? 'Getting quote...' : 'No quote') :
               `${side === 'BUY' ? 'Buy' : 'Sell'} ${brand.symbol} · ${fmtUsd(usd, 2)}`}
            </button>
          )}

          <div className="st-cta-footer">
            Trade brand tokens via Jupiter · USDC settles to your Solana wallet · No KYC
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// REGION BLOCK
// =====================================================================
function BrandsRegionBlock() {
  return (
    <div className="st-region-block">
      <div className="st-region-card">
        <div className="st-region-glow"/>
        <div className="st-region-inner">
          <div className="st-region-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <h1 className="st-region-title">
            Not available in your region
          </h1>
          <div className="st-region-sub">
            Brand tokens are restricted in your region. Swap, Bridge, Wonderland, and Wallet remain fully available.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MAIN
// =====================================================================
function BrandsInner({ onConnectWallet }) {
  const [filter, setFilter]   = useState('All');
  const [prices, setPrices]   = useState({});
  const [active, setActive]   = useState(null);

  const { publicKey: solPk } = useWallet();
  const walletPubkey = useMemo(() => solPk ? solPk.toString() : null, [solPk]);

  useEffect(() => {
    let alive = true;
    const mints = BRANDS.map(s => s.mint);
    const tick = async () => {
      const result = await fetchBrandPrices(mints);
      if (!alive) return;
      setPrices(result);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'All')      return BRANDS;
    if (filter === 'Trending') return BRANDS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return BRANDS.filter(s => s.sector === filter);
  }, [filter]);

  const totalListed = BRANDS.length;
  const totalPriced = Object.keys(prices).length;

  return (
    <>
      <div className="st-page">
        <div className="st-hero">
          <div className="st-hero-glow-1"/>
          <div className="st-hero-glow-2"/>
          <div className="st-hero-inner">
            <div className="st-hero-pills">
              <div className="st-hero-pill st-live-pill">
                <span className="st-live-dot"/>
                <span className="st-pill-text">24/7 LIVE</span>
              </div>
              <div className="st-hero-pill st-trade-pill">
                <span className="st-pill-text st-gold">TRADE WITH SOL</span>
              </div>
            </div>
            <h1 className="st-hero-title">
              Trade global{' '}
              <span className="st-hero-italic">brands</span>
            </h1>
            <p className="st-hero-sub">
              Price-tracked brand tokens, settled in USDC on Solana. No broker. No KYC. No market hours.
            </p>
            <div className="st-stats">
              <div className="st-stat">
                <div className="st-stat-val">{totalListed}</div>
                <div className="st-stat-label">BRANDS</div>
              </div>
              <div className="st-stat">
                <div className={'st-stat-val' + (totalPriced > 0 ? ' st-stat-live' : '')}>{totalPriced}</div>
                <div className="st-stat-label">LIVE</div>
              </div>
              <div className="st-stat">
                <div className="st-stat-val st-stat-gold">24/7</div>
                <div className="st-stat-label">TRADE WITH SOL</div>
              </div>
            </div>
          </div>
        </div>

        <div className="st-filters">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={'st-filter' + (filter === f.id ? ' st-active' : '')}
            >{f.label}</button>
          ))}
        </div>

        <div className="st-list">
          {filtered.length === 0 ? (
            <div className="st-empty">No brands in this category.</div>
          ) : filtered.map(s => (
            <BrandTile key={s.mint} brand={s} price={prices[s.mint] || 0} onClick={() => setActive(s)}/>
          ))}
        </div>

        <div className="st-powered">
          <span className="st-powered-label">POWERED BY</span>
          <span className="st-powered-name">JUPITER</span>
          <span className="st-powered-sep">|</span>
          <span className="st-powered-label">NON-CUSTODIAL</span>
        </div>
      </div>

      <TradeModal
        open={!!active}
        brand={active}
        price={active ? prices[active.mint] || 0 : 0}
        onClose={() => setActive(null)}
        walletPubkey={walletPubkey}
        onConnectWallet={onConnectWallet}
      />
    </>
  );
}

// =====================================================================
// US geo block. Owner wallet bypass: when this wallet connects, geo is
// skipped entirely.
// =====================================================================
const OWNER_BYPASS_PUBKEY = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

export default function Stocks({ onConnectWallet }) {
  const { publicKey } = useWallet();
  const connectedPk = publicKey ? publicKey.toBase58() : null;
  const ownerBypass = connectedPk === OWNER_BYPASS_PUBKEY;

  const [country, setCountry] = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    if (ownerBypass) { setGeoChecked(true); return; }
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, [ownerBypass]);

  if (!ownerBypass && geoChecked && country && GEO_BLOCKED.has(country)) {
    return <BrandsRegionBlock/>;
  }

  return <BrandsInner onConnectWallet={onConnectWallet}/>;
}
