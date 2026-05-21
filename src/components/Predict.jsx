// ─────────────────────────────────────────────────────────────────────
// Predict — Polymarket prediction markets, crypto focus.
//
// FLOW (one user signature per trade):
//   1. User taps Buy YES/NO $X
//   2. POST bridge.polymarket.com/deposit → get a Solana deposit address
//      that funnels USDC → pUSD on Polygon at user's Polymarket account
//   3. Build ONE Solana versioned tx with TWO SPL transfer ixs:
//        • $X × 0.97 → Polymarket's Solana bridge address
//        • $X × 0.03 → our fee wallet on Solana
//   4. ALWAYS pre-sim the exact tx bytes via Solana RPC simulateTransaction
//      (same pattern as Stocks.jsx — catches failures BEFORE Phantom prompt,
//      keeps Blowfish output clean since we already validated everything)
//   5. User signs ONCE in Phantom
//   6. ~30 seconds later, pUSD lands in user's Polymarket account
//   7. Sign + post the Polymarket CLOB order silently from derived Polygon
//      key (one-time derivation, cached in sessionStorage)
//
// No LI.FI, no gas sponsorship, no Polygon RPC, no viem, no ethers Wallet
// for bridging. Polymarket's Bridge API (fun.xyz under the hood) handles
// everything once funds reach their Solana address.
//
// Withdrawals: free, instant. POST /withdraw to Polymarket's API with the
// user's Solana wallet as recipient. No fee, matches Polymarket's own UX.
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction, TransactionInstruction, TransactionMessage, PublicKey,
} from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// ═════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════

const VIP_WALLETS = new Set(['Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV']);

// 3% service fee bundled into the Solana SPL transfer.
const SERVICE_FEE_PCT = 0.03;
const FEE_RECIPIENT_SOL = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

// Polymarket referrer (Polygon address). Leave blank, fill in when account ready.
const POLYMARKET_REFERRER = ''; // TODO: your Polymarket Polygon address

// Polymarket APIs
const BRIDGE_URL          = 'https://bridge.polymarket.com';
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL           = 'https://gamma-api.polymarket.com';
const CRYPTO_TAG_ID       = 21;

// Solana constants
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS    = 6;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM_ID   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Polymarket settles in pUSD (6 decimals on Polygon).
const POLYGON_CHAIN_ID    = 137;
const POLYMARKET_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

// Minimum deposit Polymarket accepts (per their /supported-assets) — $5 typical.
const MIN_DEPOSIT_USD = 5;

// Geo block
const GEO_URL       = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;
const US_BLOCK      = new Set(['US']);

const DERIVATION_MSG = (pub) =>
  `Verixia Predict: Authorize Polymarket Account\n\nWallet: ${pub}\n\nThis creates your non-custodial Polymarket account on Polygon. No funds are moved.`;

// ═════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═════════════════════════════════════════════════════════════════════

const C = {
  bg:        '#03060f',
  card:      '#080d1a',
  cardHi:    '#0c1428',
  ink:       '#e8ecf5',
  inkStr:    '#f5fafe',
  muted:     '#8a96b8',
  muted2:    '#475670',
  border:    'rgba(151,252,228,.10)',
  borderHi:  'rgba(151,252,228,.30)',
  hl:        '#97fce4',
  hl2:       '#5ce9c8',
  hlDim:     'rgba(151,252,228,.10)',
  violet:    '#a87fff',
  yes:       '#00d4a3',
  yesDim:    'rgba(0,212,163,.12)',
  no:        '#ff5f7a',
  noDim:     'rgba(255,95,122,.12)',
  amber:     '#f5b53d',
  shadow:    '0 8px 28px rgba(0,0,0,.45)',
  shadowLg:  '0 18px 56px rgba(0,0,0,.55)',
};
const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
  hero:    { fontFamily: "'Clash Display', 'Syne', system-ui, sans-serif" },
};

// ═════════════════════════════════════════════════════════════════════
// UTILS
// ═════════════════════════════════════════════════════════════════════

function isValidEthAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '')); }
function isValidSolAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Resolving';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d >= 30) return `${Math.floor(d / 30)}mo`;
  if (d >= 1)  return `${d}d ${h}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
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
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

// ═════════════════════════════════════════════════════════════════════
// GEO DETECTION
// ═════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════
// POLYGON WALLET DERIVATION (for CLOB order signing only — no on-chain
// Polygon txs ever happen from the app's side, so we don't need viem/
// ethers Wallet for funding. Just signing typed data.)
// ═════════════════════════════════════════════════════════════════════

let _ethersModule = null;
async function getEthers() {
  if (_ethersModule) return _ethersModule;
  _ethersModule = await import('ethers');
  return _ethersModule;
}
function getEthersNs(mod) {
  if (!mod) return null;
  if (mod.ethers?.Wallet) return mod.ethers;
  if (mod.Wallet)          return mod;
  if (mod.default?.Wallet) return mod.default;
  return null;
}

function getSessionPolyWallet(solPubkey) {
  try {
    const raw = sessionStorage.getItem('verixia_poly_' + solPubkey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setSessionPolyWallet(solPubkey, address, privateKey) {
  try { sessionStorage.setItem('verixia_poly_' + solPubkey, JSON.stringify({ address, privateKey })); }
  catch {}
}
function getKnownPolyAddress(solPubkey) {
  try { return localStorage.getItem('verixia_poly_addr_' + solPubkey) || null; }
  catch { return null; }
}
function setKnownPolyAddress(solPubkey, address) {
  try { localStorage.setItem('verixia_poly_addr_' + solPubkey, address); } catch {}
}
function getResolvedPolyAddress(solPubkey) {
  return getSessionPolyWallet(solPubkey)?.address || getKnownPolyAddress(solPubkey);
}

async function derivePolygonWallet(signMessage, solPubkey) {
  const cached = getSessionPolyWallet(solPubkey);
  if (cached) return cached;
  const encoded  = new TextEncoder().encode(DERIVATION_MSG(solPubkey));
  const sig      = await signMessage(encoded);
  const hash     = await crypto.subtle.digest('SHA-256', sig);
  const pk       = '0x' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ethersNs = getEthersNs(await getEthers());
  const wallet   = new ethersNs.Wallet(pk);
  const result   = { address: wallet.address, privateKey: pk };
  setSessionPolyWallet(solPubkey, wallet.address, pk);
  setKnownPolyAddress(solPubkey, wallet.address);
  return result;
}

// ═════════════════════════════════════════════════════════════════════
// POLYMARKET BRIDGE API
// ═════════════════════════════════════════════════════════════════════

// Generate deposit addresses for the user's Polymarket Polygon wallet.
// Returns { evm, svm, btc, tvm } — we only use `svm` (Solana address).
async function fetchPolymarketDepositAddresses(polyAddress) {
  const res = await fetchWithTimeout(`${BRIDGE_URL}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: polyAddress.toLowerCase() }),
  }, 10_000);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch {}
    throw new Error(`Polymarket bridge ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  const data = await res.json();
  // Response shape per Polymarket docs:
  //   { address: { evm, svm, btc, tvm }, ... }
  const addrs = data?.address || data;
  if (!addrs?.svm) throw new Error('Polymarket did not return a Solana deposit address');
  return addrs;
}

// Initiate a withdrawal from user's Polymarket account back to their Solana wallet.
// Free, instant per Polymarket docs.
async function initiatePolymarketWithdraw({ polyAddress, solRecipient, amountAtomic }) {
  const res = await fetchWithTimeout(`${BRIDGE_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:        polyAddress.toLowerCase(),
      toChainId:      'solana',           // per Polymarket docs
      toTokenAddress: USDC_SOLANA_MINT,   // USDC on Solana
      recipientAddr:  solRecipient,
      ...(amountAtomic ? { amount: String(amountAtomic) } : {}),
    }),
  }, 12_000);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch {}
    throw new Error(`Withdraw ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  return await res.json();
}

// Poll Polymarket's status endpoint after deposit.
async function fetchDepositStatus(svmDepositAddress) {
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/status/${svmDepositAddress}`, {}, 6_000);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Read user's pUSD balance on Polymarket — used to detect funds arrival
// and to power bring-home banner.
async function fetchPolymarketBalance(polyAddress) {
  try {
    const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/balance/${polyAddress.toLowerCase()}`, {}, 6_000);
    if (!res.ok) return 0n;
    const data = await res.json();
    const bal = data?.balance ?? data?.pusd ?? data?.usdc ?? 0;
    // Return as atomic units (6 decimals)
    if (typeof bal === 'string') return BigInt(bal);
    if (typeof bal === 'number') return BigInt(Math.floor(bal * 1e6));
    return 0n;
  } catch { return 0n; }
}

// ═════════════════════════════════════════════════════════════════════
// SOLANA TX ASSEMBLY (bundled bridge + fee transfer)
// ═════════════════════════════════════════════════════════════════════

// Build SPL Token Transfer instruction without pulling @solana/spl-token.
// Layout: [opcode=3, amount as u64 little-endian].
function createSplTransferInstruction(source, destination, owner, amountAtomic) {
  const data = new Uint8Array(9);
  data[0] = 3;
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(source),      isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner),       isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

// Create-ATA-if-needed instruction (idempotent — succeeds if ATA already exists).
function createAtaIfNeededInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(payer),  isSigner: true,  isWritable: true  },
      { pubkey: new PublicKey(ata),    isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner),  isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint),   isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System Program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    // Empty data = "CreateIdempotent" variant in newer ATA program, but for
    // wide compat we use the legacy Create instruction (single byte 0x01).
    data: new Uint8Array([1]),
  });
}

function deriveUsdcAta(ownerPubkeyB58) {
  const owner = new PublicKey(ownerPubkeyB58);
  const mint  = new PublicKey(USDC_SOLANA_MINT);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata.toBase58();
}

// Check if a token account already exists. Needed so we don't waste lamports
// trying to re-create existing ATAs.
async function ataExists(ataAddress) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [ataAddress, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    }, 6_000);
    const json = await res.json();
    return !!json?.result?.value;
  } catch { return false; }
}

async function fetchUsdcBalance(walletPubkey) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [
          walletPubkey,
          { mint: USDC_SOLANA_MINT },
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ],
      }),
    }, 6_000);
    const json = await res.json();
    const accs = json?.result?.value || [];
    let atomic = 0n;
    for (const a of accs) {
      const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (raw) atomic += BigInt(raw);
    }
    return atomic;
  } catch { return 0n; }
}

async function getRecentBlockhash() {
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 6_000);
  const json = await res.json();
  const bh = json?.result?.value?.blockhash;
  if (!bh) throw new Error('Could not fetch recent blockhash');
  return bh;
}

// Assemble the trade tx: ensure recipient ATAs exist + fee transfer + Polymarket transfer.
// Order matters: Polymarket's tx parser expects clean SPL transfers, so we put any
// ATA creation first, then both transfers.
async function buildBundledDepositTx({
  userPubkey,
  polymarketSvmAddress,    // base58 — the OWNER (Polymarket bridge wallet on Solana)
  totalUsdcAtomic,         // BigInt — total user wants to spend (gross)
}) {
  const feeAtomic     = (totalUsdcAtomic * BigInt(Math.round(SERVICE_FEE_PCT * 10000))) / 10000n;
  const polyAtomic    = totalUsdcAtomic - feeAtomic;
  if (polyAtomic <= 0n || feeAtomic <= 0n) {
    throw new Error('Amount too small after fee split');
  }

  const userAta       = deriveUsdcAta(userPubkey);
  const polyOwnerAta  = deriveUsdcAta(polymarketSvmAddress);
  const feeOwnerAta   = deriveUsdcAta(FEE_RECIPIENT_SOL);

  const ixs = [];

  // Create-ATA-if-needed for Polymarket's USDC account. Most likely exists
  // since they use a single funnel address, but cheap insurance.
  const polyExists = await ataExists(polyOwnerAta);
  if (!polyExists) {
    ixs.push(createAtaIfNeededInstruction(userPubkey, polyOwnerAta, polymarketSvmAddress, USDC_SOLANA_MINT));
  }
  // Same for our fee recipient.
  const feeExists = await ataExists(feeOwnerAta);
  if (!feeExists) {
    ixs.push(createAtaIfNeededInstruction(userPubkey, feeOwnerAta, FEE_RECIPIENT_SOL, USDC_SOLANA_MINT));
  }

  // SPL Transfer 1: Polymarket bridge address (the larger chunk)
  ixs.push(createSplTransferInstruction(userAta, polyOwnerAta, userPubkey, polyAtomic));
  // SPL Transfer 2: our fee wallet
  ixs.push(createSplTransferInstruction(userAta, feeOwnerAta, userPubkey, feeAtomic));

  const blockhash = await getRecentBlockhash();
  const message = new TransactionMessage({
    payerKey:        new PublicKey(userPubkey),
    recentBlockhash: blockhash,
    instructions:    ixs,
  }).compileToV0Message();

  return {
    tx: new VersionedTransaction(message),
    feeAtomic,
    polyAtomic,
  };
}

// ═════════════════════════════════════════════════════════════════════
// PRE-SIGN SIMULATION (Stocks-style)
// Same bytes we sim are the bytes user will sign. RPC substitutes a fresh
// blockhash internally via `replaceRecentBlockhash`, so sim reflects current
// chain state. If sim fails → clean error in UI, Phantom never triggered.
// ═════════════════════════════════════════════════════════════════════

const SPL_ERROR_CODES = {
  1: 'Insufficient USDC balance — top up your wallet',
  2: 'USDC account is frozen',
  3: 'Owner mismatch on token account',
  4: 'Amount overflow',
  5: 'Required signature missing',
};

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const code = Number(detail.Custom);
      const known = SPL_ERROR_CODES[code];
      if (known) return known;
      return `Program error at instruction ${idx} (code ${code})`;
    }
    if (typeof detail === 'string') return `${detail} at instruction ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient/i.test(String(l)));
  if (errLog) {
    const msg = String(errLog);
    if (/insufficient.*funds|insufficient.*lamports/i.test(msg)) return 'Not enough SOL for transaction fees';
    if (/insufficient.*tokens|insufficient.*balance/i.test(msg)) return 'Not enough USDC';
    return msg.slice(0, 140);
  }
  return 'Trade would fail — try a different amount';
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
    }, 10_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message || 'Simulation RPC error' };
    const value = json?.result?.value;
    if (!value)    return { ok: true,  warning: 'No sim result' };
    if (value.err) return { ok: false, message: parseSimError(value.err, value.logs) };
    return { ok: true };
  } catch (e) {
    // If our sim endpoint is down, don't block — Phantom's own sim is the
    // ultimate safety net. Fail-open with a warning.
    console.warn('[sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

// ═════════════════════════════════════════════════════════════════════
// POLYMARKET CLOB ORDER SIGNING (silent, from derived Polygon key)
// ═════════════════════════════════════════════════════════════════════

const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

const ORDER_DOMAIN = {
  name:              'Polymarket CTF Exchange',
  version:           '1',
  chainId:           POLYGON_CHAIN_ID,
  verifyingContract: POLYMARKET_EXCHANGE,
};

function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')).toString();
}

async function signPolymarketOrder({
  polyPrivateKey,
  polyAddress,
  tokenId,
  side,           // 'BUY' or 'SELL'
  usdcAtomic,     // pUSD atomic units (6 dec) the user is committing to spend
  sharePrice,     // 0.0 to 1.0
}) {
  const ethersNs = getEthersNs(await getEthers());
  const wallet   = new ethersNs.Wallet(polyPrivateKey);
  const isBuy    = String(side).toUpperCase() === 'BUY' || side === 0;

  const usdcAmt  = BigInt(usdcAtomic);
  const shareAmt = BigInt(Math.floor(Number(usdcAtomic) / sharePrice));

  const order = {
    salt:          generateSalt(),
    maker:         polyAddress.toLowerCase(),
    signer:        polyAddress.toLowerCase(),
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       String(tokenId),
    makerAmount:   isBuy ? usdcAmt.toString()  : shareAmt.toString(),
    takerAmount:   isBuy ? shareAmt.toString() : usdcAmt.toString(),
    expiration:    '0',
    nonce:         '0',
    feeRateBps:    '0',
    side:          isBuy ? 0 : 1,
    signatureType: 0,
  };

  const signature = typeof wallet.signTypedData === 'function'
    ? await wallet.signTypedData(ORDER_DOMAIN, ORDER_TYPES, order)
    : await wallet._signTypedData(ORDER_DOMAIN, ORDER_TYPES, order);

  return { order, signature };
}

async function postPolymarketOrder({ order, signature, polyAddress }) {
  const body = {
    order: { ...order, signature },
    owner: polyAddress.toLowerCase(),
    orderType: 'GTC',
    ...(POLYMARKET_REFERRER ? { referrer: POLYMARKET_REFERRER.toLowerCase() } : {}),
  };
  const res = await fetchWithTimeout(`${POLYMARKET_CLOB_URL}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || data?.errorMsg || `CLOB returned ${res.status}`);
  }
  return data;
}

// ═════════════════════════════════════════════════════════════════════
// BRIDGE STATE PERSISTENCE
// User signs → we save intent → background poller waits for pUSD to land
// at user's Polymarket account → fires the order silently. Survives modal
// close + app refresh. Never shows "timed out" errors.
// ═════════════════════════════════════════════════════════════════════

function saveTrade(payload) {
  try { localStorage.setItem('verixia_predict_pending_trade', JSON.stringify({ ...payload, ts: Date.now() })); } catch {}
}
function loadTrade() {
  try {
    const raw = localStorage.getItem('verixia_predict_pending_trade');
    if (!raw) return null;
    const d = JSON.parse(raw);
    // Auto-expire after 1 hour. By then Polymarket has either bridged or
    // their support tool needs to be used.
    return Date.now() - d.ts < 60 * 60_000 ? d : null;
  } catch { return null; }
}
function clearTrade() {
  try { localStorage.removeItem('verixia_predict_pending_trade'); } catch {}
}

async function pollUntilPolymarketFunded(polyAddress, targetIncreaseAtomic, baselineAtomic, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  const target = BigInt(baselineAtomic) + BigInt(targetIncreaseAtomic);
  while (Date.now() < deadline) {
    try {
      const bal = await fetchPolymarketBalance(polyAddress);
      // Tolerate ~3% slippage from Polymarket's swap path.
      if (bal >= (target * 97n) / 100n) return { ok: true, balance: bal };
    } catch {}
    await new Promise(r => setTimeout(r, 4_000));
  }
  return { ok: false };
}

// ═════════════════════════════════════════════════════════════════════
// END-TO-END TRADE
// ═════════════════════════════════════════════════════════════════════

async function executePolymarketTrade({
  market,
  side,           // 'yes' | 'no'
  usdAmount,
  walletPubkey,
  signTransaction,    // Solana wallet adapter
  signMessage,        // for Polygon derivation
  onStatus,
}) {
  // ── 1. Validate inputs ─────────────────────────────────────────────
  const tokenId = side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  const price   = side === 'yes' ? market.yesPrice : market.noPrice;
  if (!tokenId)                  throw new Error('Market token ID missing');
  if (!(price > 0 && price < 1)) throw new Error('Invalid market price');
  if (usdAmount < MIN_DEPOSIT_USD) throw new Error(`Minimum trade is $${MIN_DEPOSIT_USD}`);

  const totalAtomic = BigInt(Math.floor(usdAmount * 1e6));

  // ── 2. Derive Polygon wallet (silent if cached) ────────────────────
  onStatus?.('Preparing Polymarket account...');
  const polyWallet = await derivePolygonWallet(signMessage, walletPubkey);

  // ── 3. Get Solana deposit address from Polymarket ──────────────────
  onStatus?.('Getting Polymarket bridge address...');
  const addrs = await fetchPolymarketDepositAddresses(polyWallet.address);
  const polymarketSvmAddress = addrs.svm;

  // ── 4. Record current Polymarket balance baseline ──────────────────
  const baselineBalance = await fetchPolymarketBalance(polyWallet.address);

  // ── 5. Build the bundled SPL tx (Polymarket transfer + fee transfer) ─
  onStatus?.('Building transaction...');
  const { tx, feeAtomic, polyAtomic } = await buildBundledDepositTx({
    userPubkey:           walletPubkey,
    polymarketSvmAddress,
    totalUsdcAtomic:      totalAtomic,
  });

  // ── 6. Pre-sign simulation ─────────────────────────────────────────
  onStatus?.('Simulating...');
  const serializedForSim = btoa(String.fromCharCode(...tx.serialize()));
  const sim = await simulateBeforeSign(serializedForSim);
  if (!sim.ok) throw new Error(sim.message || 'Pre-sim failed');

  // ── 7. User signs (ONE prompt) ─────────────────────────────────────
  onStatus?.('Confirm in your wallet...');
  const signed = await signTransaction(tx);

  // ── 8. Persist trade intent BEFORE submitting (in case user refreshes) ─
  saveTrade({
    polyAddress:        polyWallet.address,
    tokenId:            String(tokenId),
    side,
    sharePrice:         price,
    polyAtomic:         polyAtomic.toString(),
    baselineBalance:    baselineBalance.toString(),
    marketTitle:        market.title,
  });

  // ── 9. Submit on Solana ────────────────────────────────────────────
  onStatus?.('Submitting on Solana...');
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
  if (submitJson.error) {
    clearTrade();
    throw new Error(submitJson.error.message || 'Submit failed');
  }

  // ── 10. Wait for Polymarket to bridge ──────────────────────────────
  onStatus?.('Bridging to Polymarket (~30s)...');
  const landed = await pollUntilPolymarketFunded(
    polyWallet.address,
    polyAtomic.toString(),
    baselineBalance.toString(),
    5 * 60_000,
  );

  // If still hasn't landed in 5 min, hand off to background poller and return.
  if (!landed.ok) {
    return { bridging: true };
  }

  // ── 11. Sign + post Polymarket order (silent) ──────────────────────
  onStatus?.('Placing order on Polymarket...');
  const { order, signature } = await signPolymarketOrder({
    polyPrivateKey: polyWallet.privateKey,
    polyAddress:    polyWallet.address,
    tokenId,
    side:           'BUY',
    usdcAtomic:     polyAtomic.toString(),
    sharePrice:     price,
  });
  const result = await postPolymarketOrder({
    order, signature, polyAddress: polyWallet.address,
  });

  clearTrade();
  return { ok: true, result };
}

// Background resumer — picks up pending trades after refresh.
async function resumePendingTrade(walletPubkey, signMessage) {
  const pending = loadTrade();
  if (!pending) return;
  if (!signMessage) return;

  let polyWallet;
  try {
    polyWallet = getSessionPolyWallet(walletPubkey);
    if (!polyWallet) {
      // Don't auto-trigger sig prompt on resume — wait for user activity.
      return;
    }
  } catch { return; }

  if (polyWallet.address.toLowerCase() !== pending.polyAddress.toLowerCase()) return;

  const landed = await pollUntilPolymarketFunded(
    polyWallet.address,
    pending.polyAtomic,
    pending.baselineBalance,
    30 * 60_000,
  );
  if (!landed.ok) {
    // Funds may have arrived already by another path or Polymarket support
    // routed manually. Clear the marker; bring-home banner will catch it.
    clearTrade();
    return;
  }

  try {
    const { order, signature } = await signPolymarketOrder({
      polyPrivateKey: polyWallet.privateKey,
      polyAddress:    polyWallet.address,
      tokenId:        pending.tokenId,
      side:           'BUY',
      usdcAtomic:     pending.polyAtomic,
      sharePrice:     pending.sharePrice,
    });
    await postPolymarketOrder({
      order, signature, polyAddress: polyWallet.address,
    });
  } catch (e) {
    console.warn('[resume order]', e?.message || e);
  }
  clearTrade();
}

// ═════════════════════════════════════════════════════════════════════
// GAMMA MARKETS
// ═════════════════════════════════════════════════════════════════════

async function fetchCryptoMarkets() {
  const url = `${GAMMA_URL}/events?tag_id=${CRYPTO_TAG_ID}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function normalizeEvent(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (markets.length === 0) return null;
  const market = markets[0];
  let outcomePrices = [];
  try {
    outcomePrices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : (market.outcomePrices || []);
  } catch {}
  let clobTokenIds = [];
  try {
    clobTokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : (market.clobTokenIds || []);
  } catch {}
  const yesPrice = Number(outcomePrices[0] || market.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  return {
    id:           ev.id,
    slug:         ev.slug,
    title:        ev.title || market.question || 'Untitled',
    image:        ev.image || ev.icon || market.image || null,
    volume24h:    Number(ev.volume24hr || market.volume24hr || 0),
    volumeTotal:  Number(ev.volume || market.volume || 0),
    liquidity:    Number(ev.liquidity || market.liquidity || 0),
    endDate:      ev.endDate || market.endDate || null,
    yesPrice,
    noPrice,
    yesPct:       Math.round(yesPrice * 100),
    noPct:        Math.round(noPrice * 100),
    marketCount:  markets.length,
    conditionId:  market.conditionId,
    clobTokenIds,
  };
}

// ═════════════════════════════════════════════════════════════════════
// UI: Gate screens
// ═════════════════════════════════════════════════════════════════════

function RegionBlock() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '36px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict isn't available here</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Prediction markets are restricted in your region. Swap, VIP, and Wallet remain fully available.
        </div>
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 14l3-3 4 4 6-7"/>
            <circle cx="20" cy="8" r="1.5" fill={C.hl}/>
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display, letterSpacing: -.5 }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Coming soon. Trade crypto prediction markets directly from your Solana wallet.
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Market list
// ═════════════════════════════════════════════════════════════════════

function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, width: '85%', background: 'rgba(255,255,255,.06)', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '50%', background: 'rgba(255,255,255,.03)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
      </div>
    </div>
  );
}

function MarketCard({ market, onTrade }) {
  const { title, image, yesPct, volume24h, endDate, marketCount } = market;
  const resolves = timeUntil(endDate);
  // Coerce to numbers — Gamma sometimes returns prices as strings.
  const yesPrice = Number(market.yesPrice) || 0;
  const noPrice  = Number(market.noPrice)  || 0;
  // Upside = (1 / price - 1) × 100. Only show when price is in a realistic
  // tradeable range. Below $0.02 means the market is effectively decided
  // against that side — "+9999% upside" would mislead. Above $0.99 means
  // it's a near-certain win and the upside is noise.
  const upsideForPrice = (px) => {
    if (px < 0.02 || px > 0.99) return 0;
    return Math.round((1 / px - 1) * 100);
  };
  const yesUpside = upsideForPrice(yesPrice);
  const noUpside  = upsideForPrice(noPrice);

  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        {image && (
          <img src={image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: 6, ...T.body }}>{title}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {resolves && (<><span style={{ opacity: .4 }}>·</span><span>{resolves}</span></>)}
            {marketCount > 1 && (<><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '10px 10px 11px', borderRadius: 11, background: C.yesDim, border: `1px solid rgba(0,212,163,.30)`, color: C.yes, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Yes · ${yesPrice.toFixed(2)}</span>
          {yesUpside > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{yesUpside}% upside</span>
          )}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '10px 10px 11px', borderRadius: 11, background: C.noDim, border: `1px solid rgba(255,95,122,.30)`, color: C.no, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, ...T.body }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>No · ${noPrice.toFixed(2)}</span>
          {noUpside > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, opacity: .8, ...T.mono }}>+{noUpside}% upside</span>
          )}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Order drawer
// ═════════════════════════════════════════════════════════════════════

function OrderDrawer({ market, side, onClose, walletPubkey, signTransaction, signMessage, refreshBalances }) {
  const [amount, setAmount]       = useState('10');
  const [status, setStatus]       = useState('idle'); // idle | working | success | bridging | error
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(true);

  if (!market) return null;
  const price       = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd         = Number(amount) || 0;
  const netUsd      = usd * (1 - SERVICE_FEE_PCT);
  const shares      = price > 0 ? netUsd / price : 0;
  const potentialReturn = shares;
  const upside      = netUsd > 0 ? ((potentialReturn - netUsd) / netUsd) * 100 : 0;
  const sideColor   = side === 'yes' ? C.yes : C.no;
  const sideDim     = side === 'yes' ? C.yesDim : C.noDim;
  const isBusy      = status === 'working';
  const isSuccess   = status === 'success' || status === 'bridging';
  const canExecute  = !isBusy && usd >= MIN_DEPOSIT_USD && walletPubkey && signMessage && signTransaction && market.clobTokenIds?.length >= 2;

  const handleExecute = async () => {
    if (!signTransaction) { setError('Wallet cannot sign transactions'); return; }
    if (!signMessage)     { setError('Wallet cannot sign messages'); return; }
    if (usd < MIN_DEPOSIT_USD) { setError(`Minimum trade is $${MIN_DEPOSIT_USD}`); return; }

    setStatus('working'); setError(''); setStatusMsg('');
    try {
      const result = await executePolymarketTrade({
        market, side, usdAmount: usd,
        walletPubkey, signTransaction, signMessage,
        onStatus: setStatusMsg,
      });
      if (result?.bridging) {
        setStatus('bridging');
        setStatusMsg('Order will fire automatically when funds land.');
      } else {
        setStatus('success');
        setStatusMsg('');
      }
      refreshBalances?.();
      setTimeout(() => onClose(), result?.bridging ? 4500 : 2500);
    } catch (e) {
      console.error('[predict trade]', e);
      const msg = e?.message || 'Trade failed';
      setError(/reject|cancel|user/i.test(msg) ? 'Cancelled' : msg);
      setStatus('error');
      setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4500);
    }
  };

  return (
    <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: isBusy ? 'wait' : 'pointer' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg, maxHeight: '92dvh', overflowY: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
        </div>

        {/* Feel-good marketing — trade Polymarket direct from Solana */}
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: 'linear-gradient(135deg,rgba(151,252,228,.08),rgba(168,127,255,.06))', border: `1px solid ${C.borderHi}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>⚡</span>
            <span style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: .4, ...T.display }}>POLYMARKET, DIRECT FROM SOLANA</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, ...T.body }}>
            One signature · ~30 seconds · No KYC · Free withdrawals
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); setError(''); }} disabled={isBusy} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['10', '25', '100', '250'].map(v => (
              <button key={v} onClick={() => setAmount(v)} disabled={isBusy} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono }}>${v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 12, ...T.mono, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Service fee (3%)</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>-{fmtUsd(usd * SERVICE_FEE_PCT, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Into Polymarket</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{fmtUsd(netUsd, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>Shares</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>{fmtUsd(potentialReturn, 2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Upside</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span>
          </div>
        </div>

        {statusMsg && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite' }} />
            <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,95,122,.08)', border: '1px solid rgba(255,95,122,.25)', borderRadius: 12, fontSize: 12, color: C.no, ...T.body }}>
            {error}
          </div>
        )}

        <button onClick={canExecute ? handleExecute : undefined} disabled={!canExecute} style={{
          width: '100%', padding: '14px', borderRadius: 13,
          background: isSuccess
            ? `linear-gradient(135deg, ${C.yes}33, ${C.yes}22)`
            : `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`,
          border: `1px solid ${sideColor}66`,
          color: sideColor,
          fontWeight: 800, fontSize: 14,
          cursor: canExecute ? 'pointer' : 'not-allowed',
          opacity: canExecute ? 1 : .55,
          ...T.body, letterSpacing: .5,
        }}>
          {isBusy ? 'Processing...' :
           status === 'success' ? '✓ Order placed' :
           status === 'bridging' ? '✓ Bridging — order pending' :
           `Buy ${side.toUpperCase()} · ${fmtUsd(usd, 2)}`}
        </button>
        <div style={{ fontSize: 10, color: C.muted2, marginTop: 10, textAlign: 'center', lineHeight: 1.5, ...T.mono }}>
          One signature on Solana · Polymarket bridges + settles automatically
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Bring-home banner (free withdraw, matches Polymarket's policy)
// ═════════════════════════════════════════════════════════════════════

function BringHomeBanner({ polyAddress, polyBalance, walletPubkey, signMessage, refreshBalances }) {
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');
  const [error, setError] = useState('');
  const [done, setDone]   = useState(false);

  const usd = Number(polyBalance) / 1e6;
  if (usd < 1 && !done && !busy) return null;

  const handleWithdraw = async () => {
    if (!signMessage) { setError('Wallet cannot sign'); return; }
    setBusy(true); setError(''); setMsg('Unlocking Polymarket account...');
    try {
      const polyWallet = await derivePolygonWallet(signMessage, walletPubkey);
      setMsg('Requesting withdrawal...');
      await initiatePolymarketWithdraw({
        polyAddress: polyWallet.address,
        solRecipient: walletPubkey,
      });
      setMsg('');
      setDone(true);
      refreshBalances?.();
      setTimeout(() => setDone(false), 10_000);
    } catch (e) {
      console.error('[bring home]', e);
      setError(e?.message || 'Withdraw failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(145deg,rgba(0,212,163,.16),rgba(151,252,228,.08))', border: `1px solid ${C.yes}`, boxShadow: '0 0 24px rgba(0,212,163,.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 12, color: C.yes, fontWeight: 800, letterSpacing: .5, ...T.display }}>WITHDRAW INITIATED</span>
        </div>
        <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5, ...T.body }}>
          USDC will land in your Solana wallet in about <strong>30 seconds</strong>. Free, instant, no fees.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(145deg,rgba(0,212,163,.10),rgba(151,252,228,.06))', border: `1px solid ${C.yes}55`, boxShadow: '0 0 20px rgba(0,212,163,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.yes, boxShadow: `0 0 8px ${C.yes}`, animation: 'nexus-pulse 1.6s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, color: C.yes, fontWeight: 800, letterSpacing: .5, ...T.display }}>FUNDS ON POLYMARKET</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 6, ...T.display }}>{fmtUsd(usd)}</div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 10, ...T.body }}>
        Withdraw to your Solana wallet — free and instant, takes ~30 seconds.
      </div>
      {msg && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(151,252,228,.05)', borderRadius: 8, fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 8, ...T.body }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin .8s linear infinite', flexShrink: 0 }} />
          <span>{msg}</span>
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(255,95,122,.08)', borderRadius: 8, fontSize: 11, color: C.no, ...T.body }}>{error}</div>
      )}
      <button onClick={busy ? undefined : handleWithdraw} disabled={busy} style={{
        width: '100%', padding: '12px', borderRadius: 10,
        background: `linear-gradient(135deg, ${C.yes}, ${C.hl})`,
        color: C.bg, fontWeight: 800, fontSize: 14, border: 'none',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? .65 : 1, ...T.body,
      }}>
        {busy ? 'Processing...' : `Bring ${fmtUsd(usd)} home — free`}
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// UI: Header
// ═════════════════════════════════════════════════════════════════════

function Header({ polyAddress }) {
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, ...T.mono, marginTop: 6 }}>Polymarket direct from Solana · One sig · ~30s</div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// MAIN (gated)
// ═════════════════════════════════════════════════════════════════════

function PredictInner({ bypassGeo = false }) {
  const [country, setCountry]           = useState(null);
  const [geoChecked, setGeoChecked]     = useState(false);
  const [markets, setMarkets]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [search, setSearch]             = useState('');
  const [orderMarket, setOrderMarket]   = useState(null);
  const [orderSide, setOrderSide]       = useState('yes');
  const [polyAddress, setPolyAddress]   = useState(null);
  const [polyBalance, setPolyBalance]   = useState(0n);

  const { publicKey: solPk, wallet: solWallet, signMessage, signTransaction } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Resolve cached Polygon address.
  useEffect(() => {
    if (!walletPubkey) return;
    const addr = getResolvedPolyAddress(walletPubkey);
    if (addr) setPolyAddress(addr);
  }, [walletPubkey]);

  // Poll Polymarket balance every 10s — drives the bring-home banner.
  useEffect(() => {
    if (!polyAddress) return;
    let alive = true;
    const tick = async () => {
      try {
        const bal = await fetchPolymarketBalance(polyAddress);
        if (alive) setPolyBalance(bal);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [polyAddress]);

  const refreshBalances = useCallback(async () => {
    if (!polyAddress) return;
    try { setPolyBalance(await fetchPolymarketBalance(polyAddress)); } catch {}
  }, [polyAddress]);

  // Background trade resumer — if user signed earlier and closed app
  // before Polymarket bridged, this picks up and fires the CLOB order.
  useEffect(() => {
    if (!walletPubkey || !signMessage) return;
    let alive = true;
    (async () => {
      try { await resumePendingTrade(walletPubkey, signMessage); }
      catch (e) { if (alive) console.warn('[resume]', e?.message || e); }
    })();
    return () => { alive = false; };
  }, [walletPubkey, signMessage]);

  // Geo detection.
  useEffect(() => {
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, []);

  // Fetch markets after geo passes. Refresh every 30s.
  useEffect(() => {
    if (!geoChecked) return;
    if (!bypassGeo && country && US_BLOCK.has(country)) return;
    let alive = true;
    const load = async () => {
      try {
        const events = await fetchCryptoMarkets();
        if (!alive) return;
        const normalized = events.map(normalizeEvent).filter(Boolean);
        setMarkets(normalized);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [geoChecked, country, bypassGeo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return markets;
    return markets.filter(m => (m.title || '').toLowerCase().includes(q));
  }, [markets, search]);

  const openTrade = useCallback((market, side) => {
    setOrderMarket(market);
    setOrderSide(side);
  }, []);

  if (!bypassGeo && geoChecked && country && US_BLOCK.has(country)) {
    return <RegionBlock />;
  }

  if (!geoChecked || loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
        <Header polyAddress={polyAddress} />
        {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes nexus-spin { to { transform: rotate(360deg); } } @keyframes nexus-pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }`}</style>
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header polyAddress={polyAddress} />

        {polyAddress && (
          <BringHomeBanner
            polyAddress={polyAddress}
            polyBalance={polyBalance}
            walletPubkey={walletPubkey}
            signMessage={signMessage}
            refreshBalances={refreshBalances}
          />
        )}

        <div style={{ marginBottom: 14, position: 'relative' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crypto markets..."
            inputMode="search"
            enterKeyHint="search"
            style={{
              width: '100%', padding: '11px 14px 11px 38px',
              background: 'rgba(255,255,255,.04)',
              border: `1px solid ${C.border}`,
              borderRadius: 12, color: C.ink, fontSize: 13, outline: 'none',
              ...T.body,
            }}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12, ...T.body }}>
            {error}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active crypto markets right now.'}
          </div>
        )}

        {filtered.map(m => (
          <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />
        ))}

        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 11, color: C.muted, lineHeight: 1.55, textAlign: 'center', ...T.mono }}>
          Polymarket direct from Solana · One signature per trade · Free instant withdrawals · 3% service fee · Markets resolve via UMA oracle
        </div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket}
          side={orderSide}
          onClose={() => { setOrderMarket(null); refreshBalances(); }}
          walletPubkey={walletPubkey}
          signTransaction={signTransaction}
          signMessage={signMessage}
          refreshBalances={refreshBalances}
        />
      )}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════
// GATED EXPORT
// ═════════════════════════════════════════════════════════════════════

export default function Predict(props) {
  const solWallet = useWallet();
  const nexus     = useNexusWallet();
  const address =
    (solWallet?.publicKey && solWallet.publicKey.toBase58 && solWallet.publicKey.toBase58()) ||
    nexus?.walletAddress ||
    nexus?.privyEmbeddedSol ||
    null;
  const isVip = !!address && VIP_WALLETS.has(address);
  return isVip ? <PredictInner {...props} bypassGeo /> : <ComingSoon />;
}
