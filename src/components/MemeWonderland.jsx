// =====================================================================
// MemeWonderland.jsx — Solana meme coin trading page.
//
// Built to match the existing Stocks.jsx / Swap.jsx patterns:
//   • Jupiter aggregator only (server proxies at /api/jupiter/*)
//   • Atomic single-tx swaps: fee ix + Jupiter ixs in one VersionedTransaction
//   • 5% platform fee to FEE_WALLET
//       - Buys (SOL/USDC -> meme): fee taken from input (SOL or USDC),
//         prepended before Jupiter ixs.
//       - Sells (meme -> SOL/USDC): swap meme -> SOL/USDC first, then a
//         fee transfer of 5% of the output (SOL or USDC) is appended.
//         Fee wallet only ever receives SOL or USDC -- never random memes.
//   • Reuses your design tokens, fonts, fmt utils, simulate-before-sign,
//     onConnectWallet prop, useNexusWallet + @solana/wallet-adapter-react.
//   • No Privy, no OKX, no LI.FI.
//
// Revenue strategy (from research on Axiom $300M, Photon $438M, BullX $2.29B
// fee revenue): one-tap presets, graduating-soon hero, live trending strip,
// position-aware sell shortcuts (% of holdings), paste-CA instant trade.
// =====================================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// CONFIG
// =====================================================================

const FEE_WALLET_PUBKEY = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const FEE_BPS           = 500;       // 5%
const SLIPPAGE_BPS_MAX  = 1500;      // memes are volatile — Jupiter dynamicSlippage will tighten

// Mints we never want to show in the meme feed (SOL, wrapped SOL, LSTs, stables,
// wrapped BTC variants). Jupiter's toporganicscore is supposed to filter these
// but doesn't always, and /recent surfaces fresh stable launches too.
const MEME_BLOCKLIST = new Set([
  'So11111111111111111111111111111111111111112',  // wSOL
  '11111111111111111111111111111111',              // native SOL placeholder
  // Stables
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
  // LSTs
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',  // jupSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  'jupUSDvMWdGmKHzbDeq2Zy7zCfx5KqsAj9JqPjmqYns',  // jupUSD
]);

// Symbol regex catches stables + wrapped tokens + LSTs that may not be in the
// hardcoded mint list (new wrappers, regional stables, etc.).
const STABLE_SYMBOL_REGEX = /^(W?SOL|USDC|USDT|USDH|USDS|USDE|PYUSD|UXD|sUSD|FDUSD|DAI|FRAX|BUSD|TUSD|GUSD|USDG|USX|CASH|USDP|USDD|EUROC|EURC|JUPSOL|JITOSOL|MSOL|BSOL|JUPUSD|HSOL|CGNTSOL|INF|CB?BTC|W?BTC|TBTC|XBTC|RENBTC|WETH|STETH|WSTETH|WBNB|WMATIC|WAVAX)$/i;

function isMemeWorthy(t) {
  if (!t || !t.mint) return false;
  if (MEME_BLOCKLIST.has(t.mint)) return false;
  if (t.symbol && STABLE_SYMBOL_REGEX.test(t.symbol)) return false;
  if (t.isStable) return false;
  return true;
}

// Classify a token into one of the three Axiom-style lifecycle columns
// based on Jupiter data (bondingProgress, firstPool age, mcap):
//   - 'new'      → newly launched, low mcap, on bonding curve early
//   - 'stretch'  → close to graduation (bonding > 50% OR $20K-$70K mcap)
//   - 'migrated' → already graduated to PumpSwap/Raydium ($70K+ mcap)
// Risk and opportunity both drop left → right.
function classifyStage(t) {
  if (!t) return 'migrated';
  const mcap = t.mcap || 0;
  const bonding = t.bondingProgress;
  const ageMs = t.firstPool ? Date.now() - new Date(t.firstPool).getTime() : null;

  // Bonding curve data is most reliable when Jupiter exposes it (pump.fun pre-grads)
  if (bonding != null) {
    if (bonding >= 100) return 'migrated';
    if (bonding >= 50)  return 'stretch';
    return 'new';
  }

  // No bonding data → fall back to market cap thresholds (Axiom's ~$20K / $70K)
  if (mcap >= 70_000) return 'migrated';
  if (mcap >= 20_000) return 'stretch';

  // Tiny mcap + very young = NEW, otherwise treat as migrated (probably a stale low-cap)
  if (ageMs != null && ageMs < 24 * 60 * 60 * 1000) return 'new';
  return 'migrated';
}

const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_DECIMALS  = 9;
const USDC_DECIMALS = 6;

// Use the same buy presets the rest of the app uses (from WalletContext).
// These match the user's saved presets but are denominated in SOL for memes
// rather than USDC. Falls back to sensible defaults.
const DEFAULT_BUY_PRESETS_SOL  = [0.1, 0.5, 1, 5];
const DEFAULT_SELL_PRESETS_PCT = [25, 50, 75, 100];

// =====================================================================
// DESIGN TOKENS (match Stocks.jsx)
// =====================================================================

const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', violetDim:'rgba(168,127,255,.14)',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d', gold:'#ffcd3c', hotPink:'#ff5d9b',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  borderHot:'rgba(255,93,155,.30)',
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
// UTILS (match Stocks.jsx for visual consistency)
// =====================================================================

function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  if (n >= 0.01)  return '$' + n.toFixed(4);
  return '$' + n.toFixed(8);
}

function fmtAmt(n, d = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  if (n >= 1)    return n.toFixed(d);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60)        return s + 's';
  if (s < 3600)      return Math.floor(s / 60) + 'm';
  if (s < 86400)     return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}

function isValidSolAddr(v) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

// =====================================================================
// JUPITER CLIENT
// =====================================================================

// Normalize the Jupiter Tokens V2 schema to what the UI consumes.
function normalizeJupToken(t) {
  if (!t) return null;
  const mint = t.id || t.address || t.mint;
  if (!mint) return null;
  return {
    mint,
    symbol:    t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    decimals:  typeof t.decimals === 'number' ? t.decimals : 6,
    icon:      t.icon || t.logoURI || null,
    // V2 surfaces real organic / volume / liquidity metrics:
    usdPrice:  Number(t.usdPrice ?? t.price ?? 0) || 0,
    mcap:      Number(t.mcap ?? t.marketCap ?? t.fdv ?? 0) || 0,
    liquidity: Number(t.liquidity ?? 0) || 0,
    vol24h:    Number(t.stats24h?.volume ?? t.volume24h ?? 0) || 0,
    change24h: Number(t.stats24h?.priceChange ?? t.priceChange24h ?? 0) || 0,
    change1h:  Number(t.stats1h?.priceChange ?? 0) || 0,
    holders:   Number(t.holderCount ?? t.holders ?? 0) || 0,
    organicScore: Number(t.organicScore ?? 0) || 0,
    firstPool: t.firstPool?.createdAt || t.firstPoolCreatedAt || null,
    isVerified: Boolean(t.isVerified ?? (Array.isArray(t.tags) && t.tags.includes('verified'))),
    // Bonding curve / graduation hints (Jupiter v2 sometimes exposes these
    // for pump tokens; we tolerate missing fields).
    bondingProgress: typeof t.bondingProgress === 'number' ? t.bondingProgress
                   : typeof t.bonding === 'number'         ? t.bonding
                   : null,
    launchpad: t.launchpad || null,
  };
}

async function fetchTrendingMemes({ interval = '24h', limit = 50 } = {}) {
  try {
    const r = await fetchWithTimeout(
      `/api/jupiter/tokens/v2/toporganicscore/${interval}?limit=${limit}`,
      { headers: { Accept: 'application/json' } }, 10_000,
    );
    if (!r.ok) return [];
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.tokens || []);
    return list.map(normalizeJupToken).filter(Boolean).filter(isMemeWorthy);
  } catch (e) {
    console.warn('[meme] trending fetch failed:', e?.message || e);
    return [];
  }
}

// NEW LAUNCHES — Jupiter's /tokens/v2/recent returns tokens sorted by
// first-pool-creation time. Includes pre-graduation pump.fun tokens
// (Jupiter routes them via Meteora DBC) and post-graduation tokens on
// PumpSwap/Raydium. Default ~30 results from Jupiter; we cap and filter.
async function fetchRecentMemes({ limit = 50, minLiquidityUsd = 0 } = {}) {
  try {
    const r = await fetchWithTimeout(
      `/api/jupiter/tokens/v2/recent?limit=${limit}`,
      { headers: { Accept: 'application/json' } }, 10_000,
    );
    if (!r.ok) return [];
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.tokens || []);
    return list
      .map(normalizeJupToken)
      .filter(Boolean)
      .filter(isMemeWorthy)
      .filter(t => t.liquidity >= minLiquidityUsd);
  } catch (e) {
    console.warn('[meme] recent fetch failed:', e?.message || e);
    return [];
  }
}

async function searchJupTokens(query) {
  if (!query || query.length < 1) return [];
  try {
    const r = await fetchWithTimeout(
      `/api/jupiter/tokens/search?query=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } }, 8_000,
    );
    if (!r.ok) return [];
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.tokens || []);
    return list.map(normalizeJupToken).filter(Boolean);
  } catch (e) {
    console.warn('[meme] search failed:', e?.message || e);
    return [];
  }
}

async function getJupiterQuote({ inputMint, outputMint, amountAtomic, slippageBps }) {
  const params = new URLSearchParams({
    inputMint, outputMint,
    amount:       String(amountAtomic),
    slippageBps:  String(slippageBps),
    swapMode:     'ExactIn',
  });
  const r = await fetchWithTimeout(`/api/jupiter/quote?${params}`,
    { headers: { Accept: 'application/json' } }, 12_000);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `Quote failed (${r.status})`);
  return j;
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
  const r = await fetchWithTimeout('/api/jupiter/swap-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15_000);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `Swap-instructions failed (${r.status})`);
  return j;
}

// =====================================================================
// SOLANA HELPERS (match Stocks.jsx exactly)
// =====================================================================

const TOKEN_PROGRAM_ID      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM_ID        = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

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

// SPL transferChecked encodes both amount and decimals so a wallet can
// display the correct UI amount during simulation. Instruction tag = 12.
function createSplTransferCheckedInstruction({
  source, mint, destination, owner, amountAtomic, decimals, tokenProgramId = TOKEN_PROGRAM_ID,
}) {
  const data = new Uint8Array(10);
  data[0] = 12; // TransferChecked
  const amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) data[1 + i] = Number((amt >> BigInt(i * 8)) & 0xffn);
  data[9] = decimals & 0xff;
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(source),      isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(mint),        isSigner: false, isWritable: false },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner),       isSigner: true,  isWritable: false },
    ],
    programId: tokenProgramId,
    data,
  });
}

// Idempotent ATA create — instruction tag = 1 in the ATA program.
function createIdempotentAtaInstruction({ payer, ata, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID }) {
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true,  isWritable: true  },
      { pubkey: new PublicKey(ata),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint),  isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM_ID,
    data: new Uint8Array([1]),
  });
}

function deriveAta(ownerB58, mintB58, tokenProgramId = TOKEN_PROGRAM_ID) {
  const owner = new PublicKey(ownerB58);
  const mint  = new PublicKey(mintB58);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM_ID,
  );
  return ata;
}

async function fetchLookupTableAccounts(altAddresses) {
  if (!altAddresses?.length) return [];
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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

async function fetchSolBalance(ownerPubkey) {
  try {
    const r = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getBalance',
        params: [ownerPubkey, { commitment: 'confirmed' }],
      }),
    }, 6_000);
    const j = await r.json();
    const lamports = Number(j?.result?.value || 0);
    return { atomic: BigInt(lamports), ui: lamports / 1e9 };
  } catch { return { atomic: 0n, ui: 0 }; }
}

async function fetchTokenBalance({ ownerPubkey, mint, decimals }) {
  try {
    const r = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [
          ownerPubkey,
          { mint },
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ],
      }),
    }, 8_000);
    const j = await r.json();
    const accs = j?.result?.value || [];
    let atomic = 0n;
    for (const a of accs) {
      const raw = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (raw) atomic += BigInt(raw);
    }
    return { atomic, ui: Number(atomic) / 10 ** decimals };
  } catch { return { atomic: 0n, ui: 0 }; }
}

// Determine which token program a mint belongs to (Token vs Token-2022).
// Meme tokens generally use legacy Token, but some new launches use 2022.
async function fetchMintTokenProgram(mintAddress) {
  try {
    const r = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [mintAddress, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    }, 6_000);
    const j = await r.json();
    const owner = j?.result?.value?.owner;
    if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
    return TOKEN_PROGRAM_ID;
  } catch { return TOKEN_PROGRAM_ID; }
}

async function fetchLatestBlockhash() {
  const r = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 8_000);
  const j = await r.json();
  const bh = j?.result?.value?.blockhash;
  if (!bh) throw new Error('Could not fetch recent blockhash');
  return bh;
}

// =====================================================================
// ATOMIC TX ASSEMBLY
//
// Fees ALWAYS land in SOL or USDC at FEE_WALLET — never in a meme coin.
//   BUY  (SOL/USDC -> meme): fee ix(s) prepended (SOL System.transfer or
//                            SPL transferChecked of input USDC).
//   SELL (meme -> SOL/USDC): fee ix(s) APPENDED after Jupiter so we
//                            transfer the post-swap SOL/USDC output.
// =====================================================================

async function assembleSwapTxWithFee({
  swapInstructions,
  feeInstructions,  // array — placed before (buy) or after (sell) Jupiter ixs
  prependFee,
  userPublicKey,
}) {
  const altAddrs    = swapInstructions.addressLookupTableAddresses || [];
  const altAccounts = await fetchLookupTableAccounts(altAddrs);

  const jupIxs = [];
  if (swapInstructions.tokenLedgerInstruction)
    jupIxs.push(deserializeJupInstruction(swapInstructions.tokenLedgerInstruction));
  if (Array.isArray(swapInstructions.computeBudgetInstructions))
    swapInstructions.computeBudgetInstructions.forEach(ix => jupIxs.push(deserializeJupInstruction(ix)));
  if (Array.isArray(swapInstructions.setupInstructions))
    swapInstructions.setupInstructions.forEach(ix => jupIxs.push(deserializeJupInstruction(ix)));
  if (swapInstructions.swapInstruction)
    jupIxs.push(deserializeJupInstruction(swapInstructions.swapInstruction));
  if (swapInstructions.cleanupInstruction)
    jupIxs.push(deserializeJupInstruction(swapInstructions.cleanupInstruction));

  const allIxs = prependFee
    ? [...feeInstructions, ...jupIxs]
    : [...jupIxs, ...feeInstructions];

  const blockhash = await fetchLatestBlockhash();
  const message = new TransactionMessage({
    payerKey:        new PublicKey(userPublicKey),
    recentBlockhash: blockhash,
    instructions:    allIxs,
  }).compileToV0Message(altAccounts);

  return new VersionedTransaction(message);
}

async function simulateBeforeSign(serializedTxBase64) {
  try {
    const r = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    const j = await r.json();
    if (j?.error) return { ok: false, message: j.error.message || 'Simulation RPC error' };
    const value = j?.result?.value;
    if (!value)    return { ok: true, warning: 'No sim result' };
    if (value.err) {
      const logs = Array.isArray(value.logs) ? value.logs.join('\n').toLowerCase() : '';
      if (logs.includes('insufficient')) return { ok: false, message: 'Insufficient balance for this trade.' };
      if (logs.includes('slippage'))     return { ok: false, message: 'Price moved too much — try a smaller amount.' };
      return { ok: false, message: 'Trade would fail — try a different amount.' };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[meme sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

// =====================================================================
// BODY SCROLL LOCK (matches Stocks.jsx pattern)
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

// useTickingNow re-renders every `intervalMs` so age badges, "X ago" labels,
// and other time-relative UI stay accurate without re-fetching data. Cheap
// because re-renders are isolated to components that consume the value.
function useTickingNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// =====================================================================
// WATCHLIST (localStorage)
// =====================================================================

const WATCH_KEY = 'nexus_meme_watch_v1';
function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidSolAddr).slice(0, 50) : [];
  } catch { return []; }
}
function saveWatchlist(mints) {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(mints.slice(0, 50))); } catch {}
}

// =====================================================================
// PRESENTATIONAL SUBCOMPONENTS
// =====================================================================

function TokenIcon({ token, size = 38 }) {
  const [errored, setErrored] = useState(false);
  const letter = (token.symbol || '?').charAt(0).toUpperCase();
  if (token.icon && !errored) {
    return (
      <img
        src={token.icon}
        alt={token.symbol}
        onError={() => setErrored(true)}
        style={{
          width: size, height: size, borderRadius: '50%',
          flexShrink: 0, objectFit: 'cover',
          background: 'rgba(255,255,255,.04)',
        }}
      />
    );
  }
  // Deterministic gradient from mint for fallback
  const seed = token.mint || token.symbol || 'x';
  const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,hsl(${hue},80%,60%),hsl(${(hue + 60) % 360},80%,50%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 900, fontSize: Math.round(size * 0.42),
      flexShrink: 0, letterSpacing: '-.02em', textShadow: '0 1px 3px rgba(0,0,0,.5)',
      boxShadow: `0 4px 14px hsla(${hue},80%,50%,.4)`,
      ...T.display,
    }}>{letter}</div>
  );
}

function ChangeBadge({ pct, size = 'sm' }) {
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <span style={{ fontSize: size === 'lg' ? 13 : 11, color: C.muted2, fontWeight: 700, ...T.mono }}>—</span>
    );
  }
  const up = pct >= 0;
  const fs = size === 'lg' ? 14 : 11;
  return (
    <span style={{
      fontSize: fs,
      color: up ? C.up : C.down,
      fontWeight: 800,
      fontVariantNumeric: 'tabular-nums',
      ...T.mono,
    }}>{fmtPct(pct)}</span>
  );
}

// Liquidity tier — green/yellow/red dot signals rug-risk at a glance.
function liquidityTier(liq) {
  if (!Number.isFinite(liq) || liq <= 0) return { color: '#475670', label: 'NO LIQ' };
  if (liq >= 50_000)  return { color: '#3dd598', label: 'OK' };
  if (liq >= 10_000)  return { color: '#f5b53d', label: 'LOW' };
  return { color: '#ff8a9e', label: 'DANGER' };
}

function MemeRow({ token, onTradeBuy, onTradeSell, holding, presetSol, showAge }) {
  const now = useTickingNow(30_000);
  const owns = holding && holding.ui > 0;
  const liqTier = liquidityTier(token.liquidity);
  const ageMs = token.firstPool ? now - new Date(token.firstPool).getTime() : null;
  const bonding = token.bondingProgress;
  return (
    <div style={{
      padding: '9px 12px',
      borderBottom: `1px solid ${C.hairline}`,
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto',
      gap: 10, alignItems: 'center',
      background: owns ? 'rgba(151,252,228,.025)' : 'transparent',
    }}>
      <TokenIcon token={token} size={32}/>

      <button
        onClick={() => onTradeBuy(token, null)}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          textAlign: 'left', cursor: 'pointer', minWidth: 0,
          color: C.ink, ...T.body,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <span style={{
            color: C.inkStr, fontWeight: 800, fontSize: 13, letterSpacing: '-.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90,
            ...T.display,
          }}>{token.symbol}</span>
          {token.isVerified && (
            <span style={{ color: C.hl, fontSize: 9, lineHeight: 1 }} title="Verified">✓</span>
          )}
          {/* Liquidity tier dot — instant rug-risk indicator */}
          <span title={`${liqTier.label} liquidity: ${fmtUsd(token.liquidity || 0, 0)}`} style={{
            width: 5, height: 5, borderRadius: '50%',
            background: liqTier.color, flexShrink: 0,
          }}/>
          {ageMs != null && (showAge || ageMs < 86_400_000) && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
              background: 'rgba(255,255,255,.04)', color: C.muted,
              letterSpacing: '.05em', ...T.mono,
            }}>{fmtAge(ageMs)}</span>
          )}
          {bonding != null && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
              background: bonding > 80 ? 'rgba(255,205,60,.14)' : 'rgba(168,127,255,.14)',
              color: bonding > 80 ? C.gold : C.violet,
              letterSpacing: '.05em', ...T.mono,
            }}>{bonding > 80 ? '🚀' : ''}{Math.round(bonding)}%</span>
          )}
          {owns && (
            <span style={{
              fontSize: 7.5, fontWeight: 800, letterSpacing: '.06em',
              padding: '1px 4px', borderRadius: 3,
              background: C.hlDim, color: C.hl, ...T.mono,
            }}>HOLD</span>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, color: C.muted, ...T.mono,
        }}>
          <span>{token.usdPrice > 0 ? fmtUsd(token.usdPrice, 6) : '—'}</span>
          <ChangeBadge pct={token.change24h}/>
          {token.mcap > 0 && (
            <span style={{ color: C.muted2 }}>· {fmtUsd(token.mcap, 0)}</span>
          )}
          {token.holders > 0 && (
            <span style={{ color: C.muted2 }}>· {fmtAmt(token.holders, 0)}h</span>
          )}
        </div>
      </button>

      <div style={{ display: 'flex', gap: 5 }}>
        {owns ? (
          <button
            onClick={(e) => { e.stopPropagation(); onTradeSell(token); }}
            style={pillBtn(C.down, 'rgba(255,138,158,.10)')}
          >SELL</button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onTradeBuy(token, presetSol); }}
            style={pillBtn('#04070f', `linear-gradient(135deg,${C.hl} 0%,${C.hl2} 100%)`)}
          >{presetSol}</button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onTradeBuy(token, null); }}
          style={pillBtn(C.muted, 'rgba(255,255,255,.03)')}
        >···</button>
      </div>
    </div>
  );
}

function pillBtn(color, bg) {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: bg,
    color,
    fontSize: 10.5,
    fontWeight: 800,
    cursor: 'pointer',
    letterSpacing: '-.01em',
    whiteSpace: 'nowrap',
    minWidth: 38,
    ...T.mono,
  };
}

// =====================================================================
// PULSE CARD — compact card for the 3-column lifecycle layout.
// Narrow enough for 3 columns on desktop / scrollable on mobile.
// Shows just the essentials: icon, symbol, %, mcap, age, liq dot, quick-buy.
// =====================================================================

function PulseCard({ token, onTradeBuy, onTradeSell, holding, presetSol, stage }) {
  const now = useTickingNow(30_000);
  const owns = holding && holding.ui > 0;
  const liqTier = liquidityTier(token.liquidity);
  const ageMs = token.firstPool ? now - new Date(token.firstPool).getTime() : null;
  const bonding = token.bondingProgress;
  // 1h change feels more "alive" on NEW; 24h is more stable for MIGRATED
  const changePct = stage === 'migrated'
    ? (Number.isFinite(token.change24h) ? token.change24h : token.change1h)
    : (Number.isFinite(token.change1h) && token.change1h !== 0 ? token.change1h : token.change24h);

  return (
    <button
      onClick={() => onTradeBuy(token, null)}
      style={{
        width: '100%', textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 10,
        border: `1px solid ${owns ? C.borderHi : C.border}`,
        background: owns ? 'rgba(151,252,228,.04)' : 'rgba(255,255,255,.02)',
        cursor: 'pointer', marginBottom: 6,
        display: 'flex', flexDirection: 'column', gap: 6,
        color: C.ink, ...T.body,
      }}
    >
      {/* Row 1: icon + symbol + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <TokenIcon token={token} size={28}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              color: C.inkStr, fontWeight: 800, fontSize: 12.5, letterSpacing: '-.01em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70,
              ...T.display,
            }}>{token.symbol}</span>
            <span title={`${liqTier.label} liquidity`} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: liqTier.color, flexShrink: 0,
            }}/>
            {owns && (
              <span style={{
                fontSize: 7, fontWeight: 800, letterSpacing: '.06em',
                padding: '1px 3px', borderRadius: 3,
                background: C.hlDim, color: C.hl, ...T.mono,
              }}>HOLD</span>
            )}
          </div>
          {ageMs != null && (
            <div style={{
              fontSize: 9, color: C.muted2, fontWeight: 700,
              letterSpacing: '.05em', marginTop: 1, ...T.mono,
            }}>{fmtAge(ageMs)} old</div>
          )}
        </div>
      </div>

      {/* Row 2: price/change/mcap */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        fontSize: 10, color: C.muted, ...T.mono,
      }}>
        <ChangeBadge pct={changePct}/>
        {token.mcap > 0 && (
          <span style={{ color: C.muted2, fontSize: 9 }}>
            {fmtUsd(token.mcap, 0)}
          </span>
        )}
      </div>

      {/* Bonding curve progress (for STRETCH column) */}
      {stage === 'stretch' && bonding != null && (
        <div style={{
          height: 4, borderRadius: 99,
          background: 'rgba(255,255,255,.06)',
          overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: Math.max(0, Math.min(100, bonding)) + '%',
            background: bonding > 80
              ? `linear-gradient(90deg,${C.gold},${C.hotPink})`
              : `linear-gradient(90deg,${C.violet},${C.hl})`,
            boxShadow: bonding > 80 ? `0 0 6px ${C.gold}` : 'none',
          }}/>
        </div>
      )}

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        {owns ? (
          <button
            onClick={(e) => { e.stopPropagation(); onTradeSell(token); }}
            style={{
              flex: 1, padding: '6px 4px', borderRadius: 7, border: 'none',
              background: 'rgba(255,138,158,.10)', color: C.down,
              fontSize: 10, fontWeight: 800, cursor: 'pointer', ...T.mono,
            }}
          >SELL</button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onTradeBuy(token, presetSol); }}
            style={{
              flex: 1, padding: '6px 4px', borderRadius: 7, border: 'none',
              background: `linear-gradient(135deg,${C.hl} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '-.01em', ...T.mono,
            }}
          >{presetSol} SOL</button>
        )}
      </div>
    </button>
  );
}

// =====================================================================
// PULSE COLUMN — wrapper for one of the three lifecycle stages.
// Each column gets its own header, color theme, and live token count.
// =====================================================================

const STAGE_THEMES = {
  new: {
    label: 'NEW',
    sublabel: 'fresh launches',
    color: '#ff5d9b',
    accent: 'rgba(255,93,155,.30)',
    bgAccent: 'rgba(255,93,155,.06)',
    icon: '✨',
  },
  stretch: {
    label: 'FINAL STRETCH',
    sublabel: 'about to graduate',
    color: '#ffcd3c',
    accent: 'rgba(255,205,60,.30)',
    bgAccent: 'rgba(255,205,60,.06)',
    icon: '🚀',
  },
  migrated: {
    label: 'MIGRATED',
    sublabel: 'live on DEX',
    color: '#97fce4',
    accent: 'rgba(151,252,228,.24)',
    bgAccent: 'rgba(151,252,228,.04)',
    icon: '💎',
  },
};

function PulseColumn({ stage, tokens, holdings, defaultPreset, onTradeBuy, onTradeSell, loading }) {
  const theme = STAGE_THEMES[stage];
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'rgba(10,16,32,.50)',
      border: `1px solid ${C.border}`,
      borderRadius: 14, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Sticky-feeling column header */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: `1px solid ${C.hairline}`,
        background: theme.bgAccent,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11 }}>{theme.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 800, color: theme.color,
              letterSpacing: '.10em', ...T.mono,
            }}>{theme.label}</span>
          </div>
          <div style={{
            fontSize: 8.5, color: C.muted2, fontWeight: 600,
            letterSpacing: '.04em', marginTop: 1, ...T.mono,
          }}>{theme.sublabel}</div>
        </div>
        <span style={{
          fontSize: 9, color: C.muted, fontWeight: 700,
          padding: '2px 6px', borderRadius: 99,
          background: 'rgba(255,255,255,.04)', ...T.mono,
        }}>{tokens.length}</span>
      </div>

      {/* Column body */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px',
        maxHeight: 'min(70vh, 700px)', minHeight: 200,
      }}>
        {loading && tokens.length === 0 ? (
          <div style={{
            padding: '20px 8px', textAlign: 'center',
            color: C.muted2, fontSize: 10.5, ...T.body,
          }}>Loading...</div>
        ) : tokens.length === 0 ? (
          <div style={{
            padding: '20px 8px', textAlign: 'center',
            color: C.muted2, fontSize: 10.5, ...T.body,
          }}>Nothing yet</div>
        ) : (
          tokens.map(t => (
            <PulseCard
              key={t.mint}
              token={t}
              holding={holdings[t.mint]}
              presetSol={defaultPreset}
              stage={stage}
              onTradeBuy={onTradeBuy}
              onTradeSell={onTradeSell}
            />
          ))
        )}
      </div>
    </div>
  );
}

function GraduationBar({ progress }) {
  if (progress == null || !Number.isFinite(progress)) return null;
  const p = Math.max(0, Math.min(100, progress));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: 4, fontSize: 9, ...T.mono,
        color: p > 80 ? C.gold : C.muted,
        fontWeight: 700, letterSpacing: '.08em',
      }}>
        <span>BONDING CURVE</span>
        <span>{p.toFixed(1)}%</span>
      </div>
      <div style={{
        height: 6, borderRadius: 99,
        background: 'rgba(255,255,255,.06)',
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          position: 'absolute', inset: 0, width: p + '%',
          background: p > 80
            ? `linear-gradient(90deg,${C.gold},${C.hotPink})`
            : `linear-gradient(90deg,${C.hl},${C.violet})`,
          boxShadow: p > 80 ? `0 0 12px ${C.gold}` : `0 0 8px ${C.hl}`,
        }}/>
      </div>
    </div>
  );
}

// =====================================================================
// TRENDING TICKER (auto-scrolling top strip)
// =====================================================================

function TrendingTicker({ tokens, onTap }) {
  if (!tokens?.length) return null;
  // Duplicate so the marquee loops seamlessly
  const items = [...tokens, ...tokens];
  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 12,
      background: 'rgba(0,0,0,.30)',
      border: `1px solid ${C.border}`,
      padding: '6px 0',
      marginBottom: 10,
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 2,
        background: `linear-gradient(90deg,${C.bg},transparent)`, pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 30, zIndex: 2,
        background: `linear-gradient(270deg,${C.bg},transparent)`, pointerEvents: 'none',
      }}/>
      <div style={{
        display: 'inline-flex', gap: 18,
        animation: 'nx-marquee 28s linear infinite',
        whiteSpace: 'nowrap', willChange: 'transform',
      }}>
        {items.map((t, i) => (
          <button
            key={t.mint + ':' + i}
            onClick={() => onTap(t)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.ink, fontSize: 12, ...T.mono, padding: 0,
            }}
          >
            <TokenIcon token={t} size={20}/>
            <span style={{ color: C.inkStr, fontWeight: 800, ...T.display }}>{t.symbol}</span>
            <ChangeBadge pct={t.change24h}/>
          </button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// GRADUATING-SOON HERO CARD
// =====================================================================
// SLIM FEATURED STRIP — replaces the giant hero card. One row, dense.
// =====================================================================

function FeaturedStrip({ token, onBuy }) {
  const now = useTickingNow(30_000);
  if (!token) return null;
  const ageMs = token.firstPool ? now - new Date(token.firstPool).getTime() : null;
  const bonding = token.bondingProgress;
  const change = Number.isFinite(token.change1h) && token.change1h !== 0
    ? token.change1h
    : token.change24h;
  return (
    <div style={{
      marginBottom: 10,
      padding: '10px 12px',
      borderRadius: 14,
      background: `
        radial-gradient(ellipse 60% 80% at 0% 50%,${C.violetDim},transparent 70%),
        linear-gradient(145deg,${C.surface2},${C.bg2})`,
      border: `1px solid ${C.borderHot}`,
      boxShadow: `0 8px 24px rgba(255,93,155,.08)`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <TokenIcon token={token} size={36}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: 8, fontWeight: 800, color: C.hotPink,
            letterSpacing: '.10em', ...T.mono,
          }}>{bonding != null && bonding > 80 ? '🚀 GRADUATING' : '🔥 HOT'}</span>
          {ageMs != null && (
            <span style={{
              fontSize: 8, fontWeight: 700, color: C.muted2,
              letterSpacing: '.06em', ...T.mono,
            }}>· {fmtAge(ageMs)} old</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 15, fontWeight: 800, color: C.inkStr,
            letterSpacing: '-.02em', ...T.display,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: 100,
          }}>{token.symbol}</span>
          <ChangeBadge pct={change}/>
          {token.mcap > 0 && (
            <span style={{
              fontSize: 10, color: C.muted, ...T.mono,
            }}>· {fmtUsd(token.mcap, 0)}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
        {[0.1, 0.5, 1].map(amt => (
          <button
            key={amt}
            onClick={() => onBuy(token, amt)}
            style={{
              padding: '8px 10px', borderRadius: 9, border: 'none',
              background: `linear-gradient(135deg,${C.hl} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 11,
              cursor: 'pointer', letterSpacing: '-.01em', ...T.mono,
              boxShadow: '0 4px 12px rgba(151,252,228,.18)',
            }}
          >{amt}</button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// GRADUATING-SOON HERO CARD (kept for fallback / not currently used)
// (Shows the highest-organic-score, just-discovered token; if bonding
// curve progress is exposed by Jupiter we visualize it. Otherwise it acts
// as a "Hottest right now" feature card.)
// =====================================================================

function HeroFeaturedCard({ token, onBuy }) {
  if (!token) return null;
  const hasBonding = token.bondingProgress != null;
  const ageMs = token.firstPool ? Date.now() - new Date(token.firstPool).getTime() : null;

  return (
    <div style={{
      padding: '18px 18px 16px',
      borderRadius: 22,
      background: `
        radial-gradient(ellipse 90% 60% at 30% 0%,${C.violetDim},transparent 70%),
        radial-gradient(ellipse 60% 50% at 90% 100%,rgba(255,93,155,.10),transparent 70%),
        linear-gradient(145deg,${C.surface2},${C.bg2})`,
      border: `1px solid ${C.borderHot}`,
      boxShadow: `0 12px 40px rgba(255,93,155,.10), ${C.shadowLg}`,
      marginBottom: 14, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: 'rgba(255,93,155,.14)',
        border: '1px solid rgba(255,93,155,.30)',
        marginBottom: 14,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: C.hotPink,
          boxShadow: `0 0 8px ${C.hotPink}`,
          animation: 'nx-pulse 1.4s ease-in-out infinite',
        }}/>
        <span style={{
          color: C.hotPink, fontSize: 9, fontWeight: 800,
          letterSpacing: '.12em', ...T.mono,
        }}>{hasBonding && token.bondingProgress > 80 ? 'GRADUATING SOON' : 'HOT RIGHT NOW'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <TokenIcon token={token} size={56}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 22, fontWeight: 800, color: C.inkStr,
              letterSpacing: '-.02em', ...T.display,
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180,
              whiteSpace: 'nowrap',
            }}>{token.symbol}</span>
            <ChangeBadge pct={token.change24h} size="lg"/>
            {ageMs != null && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '3px 7px', borderRadius: 5,
                background: 'rgba(255,255,255,.05)', color: C.muted2,
                letterSpacing: '.08em', ...T.mono,
              }}>{fmtAge(ageMs)} old</span>
            )}
          </div>
          <div style={{
            fontSize: 12, color: C.muted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: 240, ...T.body,
          }}>{token.name}</div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
        padding: '10px 12px', borderRadius: 12,
        background: 'rgba(0,0,0,.35)', border: `1px solid ${C.border}`,
      }}>
        {[
          { label: 'PRICE',     value: token.usdPrice > 0 ? fmtUsd(token.usdPrice, 6) : '—' },
          { label: 'MCAP',      value: token.mcap > 0 ? fmtUsd(token.mcap, 0) : '—' },
          { label: 'VOL 24H',   value: token.vol24h > 0 ? fmtUsd(token.vol24h, 0) : '—' },
        ].map((s, i) => (
          <div key={s.label} style={{
            textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
            borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none',
          }}>
            <div style={{
              fontSize: 14, fontWeight: 800, color: C.inkStr, ...T.display,
              fontVariantNumeric: 'tabular-nums',
            }}>{s.value}</div>
            <div style={{
              fontSize: 8.5, color: C.muted2, marginTop: 3, fontWeight: 700,
              letterSpacing: '.10em', ...T.mono,
            }}>{s.label}</div>
          </div>
        ))}
      </div>

      {hasBonding && <GraduationBar progress={token.bondingProgress}/>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {DEFAULT_BUY_PRESETS_SOL.slice(0, 3).map(amt => (
          <button
            key={amt}
            onClick={() => onBuy(token, amt)}
            style={{
              flex: 1, padding: '12px 8px', borderRadius: 12, border: 'none',
              background: `linear-gradient(135deg,${C.hl} 0%,${C.hl2} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 13,
              cursor: 'pointer', letterSpacing: '-.01em', ...T.display,
              boxShadow: '0 8px 20px rgba(151,252,228,.18)',
            }}
          >Buy {amt} SOL</button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// TRADE MODAL — buy/sell sheet
// =====================================================================

function MemeTradeModal({
  open, token, initialSol, initialSide, solUsdPrice,
  onClose, walletPubkey, onConnectWallet, onAfterTrade, presets,
}) {
  const { signTransaction, connected } = useWallet();
  const wcon = connected;

  // BUY uses SOL as the base by default (SOL is what meme traders deploy).
  // USDC available via toggle. SELL always returns SOL by default.
  const [side, setSide]         = useState(initialSide || 'BUY');
  const [baseMint, setBaseMint] = useState(SOL_MINT); // SOL | USDC
  const [amount, setAmount]     = useState('');       // BUY: in base units; SELL: in meme tokens
  const [quote, setQuote]       = useState(null);
  const [quoting, setQuoting]   = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]       = useState('');
  const [tokenBal, setTokenBal] = useState({ atomic: 0n, ui: 0, loaded: false });
  const [solBal, setSolBal]     = useState({ atomic: 0n, ui: 0, loaded: false });
  const [usdcBal, setUsdcBal]   = useState({ atomic: 0n, ui: 0, loaded: false });
  const quoteSeq = useRef(0);

  useBodyLock(open);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setSide(initialSide || 'BUY');
      setAmount(initialSol ? String(initialSol) : '');
      setBaseMint(SOL_MINT);
      setError('');
      setSubmitState({ kind: 'idle', message: '' });
      setQuote(null);
    } else {
      setAmount('');
      setQuote(null);
    }
  }, [open, initialSol, initialSide]);

  // Load balances when opened or after a trade
  useEffect(() => {
    if (!open || !token || !walletPubkey) return;
    let cancelled = false;
    (async () => {
      const [tk, sl, uc] = await Promise.all([
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: token.mint, decimals: token.decimals }),
        fetchSolBalance(walletPubkey),
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: USDC_MINT, decimals: USDC_DECIMALS }),
      ]);
      if (cancelled) return;
      setTokenBal({ ...tk, loaded: true });
      setSolBal({ ...sl, loaded: true });
      setUsdcBal({ ...uc, loaded: true });
    })();
    return () => { cancelled = true; };
  }, [open, token, walletPubkey, submitState.kind]);

  const isBuy = side === 'BUY';
  const baseSymbol = baseMint === SOL_MINT ? 'SOL' : 'USDC';
  const baseDecimals = baseMint === SOL_MINT ? SOL_DECIMALS : USDC_DECIMALS;

  // Build the quote whenever inputs change
  useEffect(() => {
    if (!open || !token) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true);
    setError('');

    const t = setTimeout(async () => {
      try {
        let inputMint, outputMint, amountAtomic;
        if (isBuy) {
          // User pays SOL/USDC. Fee comes off the input pre-Jupiter.
          // So we route net-of-fee through Jupiter:  net = gross * (1 - feeBps/10000)
          const grossAtomic = BigInt(Math.round(n * 10 ** baseDecimals));
          const feeAtomic   = (grossAtomic * BigInt(FEE_BPS)) / 10000n;
          amountAtomic      = grossAtomic - feeAtomic;
          inputMint         = baseMint;
          outputMint        = token.mint;
        } else {
          // User sells meme tokens, receives SOL or USDC. Fee comes off the
          // output post-Jupiter — Jupiter routes the full meme amount.
          amountAtomic = BigInt(Math.round(n * 10 ** token.decimals));
          inputMint    = token.mint;
          outputMint   = baseMint;
        }
        if (amountAtomic < 1n) { setQuote(null); setQuoting(false); return; }

        const q = await getJupiterQuote({
          inputMint, outputMint,
          amountAtomic: amountAtomic.toString(),
          slippageBps: SLIPPAGE_BPS_MAX,
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
  }, [amount, side, baseMint, token, open, isBuy, baseDecimals]);

  if (!open || !token) return null;

  const n      = parseFloat(amount) || 0;
  const isBusy = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  // Derived display values
  const outAtomic = quote ? Number(quote.outAmount) : 0;
  const outDecimals = isBuy ? token.decimals : baseDecimals;
  const grossOut = outAtomic / 10 ** outDecimals;

  // BUY: net out is what Jupiter returns (fee already taken from input).
  // SELL: subtract 5% from Jupiter output for our fee in SOL/USDC.
  const feeAmtBuy  = isBuy ? n * (FEE_BPS / 10000) : 0;  // in base units
  const feeAmtSell = !isBuy ? grossOut * (FEE_BPS / 10000) : 0; // in base units
  const netOut = isBuy ? grossOut : Math.max(0, grossOut - feeAmtSell);

  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  // Validation
  const buyAtomicGross = isBuy ? BigInt(Math.round(n * 10 ** baseDecimals)) : 0n;
  const baseBal = baseMint === SOL_MINT ? solBal : usdcBal;
  // For SOL buys leave ~0.005 SOL headroom for rent + tx fees
  const baseReserveAtomic = baseMint === SOL_MINT ? 5_000_000n : 0n;
  const sellAtomic = !isBuy ? BigInt(Math.round(n * 10 ** token.decimals)) : 0n;

  const insufficient = isBuy
    ? (baseBal.loaded && buyAtomicGross + baseReserveAtomic > baseBal.atomic)
    : (tokenBal.loaded && sellAtomic > tokenBal.atomic);

  const valid = (n > 0) && !insufficient;

  // USD-equivalent for the input box for quick reference
  const inputUsd = isBuy
    ? (baseMint === SOL_MINT ? n * (solUsdPrice || 0) : n)
    : (n * (token.usdPrice || 0));

  const handleSubmit = async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!walletPubkey || !isValidSolAddr(walletPubkey)) { setError('Wallet not connected'); return; }
    if (!quote) { setError('No quote available'); return; }
    if (!signTransaction) { setError('Wallet cannot sign transactions'); return; }

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });
    setError('');

    try {
      // --- Compute fee ix(s) ---
      const feeIxs = [];
      if (isBuy) {
        // Fee from input (SOL or USDC), PRE-Jupiter
        const grossAtomic = BigInt(Math.round(n * 10 ** baseDecimals));
        const feeAtomic   = (grossAtomic * BigInt(FEE_BPS)) / 10000n;
        if (feeAtomic <= 0n) throw new Error('Amount too small');

        if (baseMint === SOL_MINT) {
          // Native SOL transfer — Jupiter will then wrap the remainder
          feeIxs.push(SystemProgram.transfer({
            fromPubkey: new PublicKey(walletPubkey),
            toPubkey:   new PublicKey(FEE_WALLET_PUBKEY),
            lamports:   Number(feeAtomic),
          }));
        } else {
          // USDC fee — derive ATAs, create fee wallet's idempotently, transfer
          const srcAta  = deriveAta(walletPubkey, USDC_MINT);
          const destAta = deriveAta(FEE_WALLET_PUBKEY, USDC_MINT);
          feeIxs.push(createIdempotentAtaInstruction({
            payer: walletPubkey,
            ata: destAta,
            owner: FEE_WALLET_PUBKEY,
            mint: USDC_MINT,
          }));
          feeIxs.push(createSplTransferCheckedInstruction({
            source: srcAta, mint: USDC_MINT, destination: destAta,
            owner: walletPubkey, amountAtomic: feeAtomic, decimals: USDC_DECIMALS,
          }));
        }
      } else {
        // SELL: fee from output (SOL or USDC), POST-Jupiter
        // Use otherAmountThreshold (worst-case after slippage) so we never
        // try to transfer more than we'll actually receive.
        const minOutAtomic = BigInt(quote.otherAmountThreshold || quote.outAmount || '0');
        const feeAtomic    = (minOutAtomic * BigInt(FEE_BPS)) / 10000n;
        if (feeAtomic <= 0n) throw new Error('Output too small for fee');

        if (baseMint === SOL_MINT) {
          // Jupiter unwraps wSOL to native via cleanupInstruction — fee is a
          // plain SystemProgram transfer.
          feeIxs.push(SystemProgram.transfer({
            fromPubkey: new PublicKey(walletPubkey),
            toPubkey:   new PublicKey(FEE_WALLET_PUBKEY),
            lamports:   Number(feeAtomic),
          }));
        } else {
          // USDC — same ATA setup, transfer post-swap
          const srcAta  = deriveAta(walletPubkey, USDC_MINT);
          const destAta = deriveAta(FEE_WALLET_PUBKEY, USDC_MINT);
          feeIxs.push(createIdempotentAtaInstruction({
            payer: walletPubkey,
            ata: destAta,
            owner: FEE_WALLET_PUBKEY,
            mint: USDC_MINT,
          }));
          feeIxs.push(createSplTransferCheckedInstruction({
            source: srcAta, mint: USDC_MINT, destination: destAta,
            owner: walletPubkey, amountAtomic: feeAtomic, decimals: USDC_DECIMALS,
          }));
        }
      }

      // --- Get Jupiter ixs and assemble atomic tx ---
      const swapIxs = await getJupiterSwapInstructions({
        quoteResponse: quote,
        userPublicKey: walletPubkey,
      });

      const tx = await assembleSwapTxWithFee({
        swapInstructions: swapIxs,
        feeInstructions:  feeIxs,
        prependFee:       isBuy,   // BUY: fee first; SELL: fee last
        userPublicKey:    walletPubkey,
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'sendTransaction',
          params: [serialized, {
            encoding: 'base64', skipPreflight: true,
            preflightCommitment: 'confirmed', maxRetries: 5,
          }],
        }),
      }, 20_000);
      const submitJson = await submitRes.json();
      if (submitJson.error) throw new Error(submitJson.error.message || 'Submit failed');

      setSubmitState({ kind: 'success', message: 'Trade submitted' });
      onAfterTrade?.();
      setTimeout(() => { onClose(); setSubmitState({ kind: 'idle', message: '' }); }, 2200);
    } catch (e) {
      console.error('[meme trade]', e);
      const msg = e.message || 'Trade failed';
      setSubmitState({ kind: 'error', message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4500);
    }
  };

  // Quick-amount chips. We ignore presets.buy (which is USDC-sized for the
  // stocks page) and use SOL-sized meme presets instead. Memes price in SOL.
  const buyChips = DEFAULT_BUY_PRESETS_SOL
    .slice(0, 4)
    .map(v => ({ label: v + ' ' + baseSymbol, val: String(v) }));

  const sellChips = DEFAULT_SELL_PRESETS_PCT.map(pct => ({
    label: pct === 100 ? 'MAX' : pct + '%',
    val: (() => {
      if (!tokenBal.loaded || tokenBal.atomic <= 0n) return '';
      const portion = (tokenBal.atomic * BigInt(pct)) / 100n;
      const ui = Number(portion) / 10 ** token.decimals;
      // Floor to avoid dust-precision issues at 100%
      return pct === 100 ? String(ui) : ui.toFixed(token.decimals);
    })(),
  }));

  const chips = isBuy ? buyChips : sellChips;

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)',
        cursor: isBusy ? 'wait' : 'pointer',
      }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '14px 22px 12px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 16px' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TokenIcon token={token} size={44}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 18, fontWeight: 800, color: C.inkStr,
                  letterSpacing: '-.02em', ...T.display,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', maxWidth: 160,
                }}>{token.symbol}</span>
                {token.isVerified && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                    background: C.hlDim, color: C.hl, letterSpacing: '.04em', ...T.mono,
                  }}>VERIFIED</span>
                )}
              </div>
              <div style={{
                fontSize: 11.5, color: C.muted, marginTop: 1, ...T.body,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 220,
              }}>{token.name}</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{
              background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`,
              color: C.muted, width: 32, height: 32, borderRadius: 10,
              fontSize: 18, cursor: isBusy ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}>×</button>
          </div>

          {/* Live price + 24h */}
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 12,
            background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}>
            <div>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>LIVE PRICE</div>
              <div style={{ fontSize: 16, color: C.inkStr, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
                {token.usdPrice > 0 ? fmtUsd(token.usdPrice, 6) : '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>24H</div>
              <ChangeBadge pct={token.change24h} size="lg"/>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>MCAP</div>
              <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, ...T.mono }}>
                {token.mcap > 0 ? fmtUsd(token.mcap, 0) : '—'}
              </div>
            </div>
          </div>

          {/* Holdings */}
          {wcon && (
            <div style={{
              marginTop: 8, padding: '9px 12px', borderRadius: 12,
              background: 'rgba(151,252,228,.04)',
              border: `1px solid ${C.borderHi}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 10, color: C.hl, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>WALLET</span>
              <span style={{
                fontSize: 12, color: C.inkStr, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', textAlign: 'right', ...T.mono,
              }}>
                {solBal.loaded ? fmtAmt(solBal.ui, 4) + ' SOL' : '...'}
                {' · '}
                <span style={{ color: C.muted }}>{usdcBal.loaded ? fmtUsd(usdcBal.ui, 2) : '...'} USDC</span>
                {tokenBal.loaded && tokenBal.ui > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: C.hl }}>
                      {fmtAmt(tokenBal.ui, 4)} {token.symbol}
                    </span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 14px', minHeight: 0 }}>
          {/* Buy/Sell tabs */}
          <div style={{
            display: 'inline-flex', padding: 3, marginBottom: 14,
            background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
            borderRadius: 999, gap: 3, width: '100%',
          }}>
            {['BUY', 'SELL'].map(s => {
              const active = side === s;
              const c = s === 'BUY' ? C.up : C.down;
              return (
                <button
                  key={s}
                  onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }}
                  disabled={isBusy}
                  style={{
                    flex: 1, padding: '9px 16px', borderRadius: 999, border: 'none',
                    background: active
                      ? (s === 'BUY' ? 'rgba(61,213,152,.18)' : 'rgba(255,138,158,.18)')
                      : 'transparent',
                    color: active ? c : C.muted,
                    fontWeight: 800, fontSize: 13,
                    cursor: isBusy ? 'not-allowed' : 'pointer',
                    letterSpacing: '-.01em', ...T.display,
                  }}
                >{s === 'BUY' ? 'Buy with ' + baseSymbol : 'Sell to ' + baseSymbol}</button>
              );
            })}
          </div>

          {/* Base mint toggle (SOL/USDC) */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {[
              { mint: SOL_MINT, label: 'SOL' },
              { mint: USDC_MINT, label: 'USDC' },
            ].map(b => (
              <button
                key={b.mint}
                onClick={() => { if (!isBusy) { setBaseMint(b.mint); setAmount(''); setQuote(null); } }}
                disabled={isBusy}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8,
                  border: `1px solid ${baseMint === b.mint ? C.borderHi : C.border}`,
                  background: baseMint === b.mint ? C.hlDim : 'rgba(255,255,255,.03)',
                  color: baseMint === b.mint ? C.hl : C.muted,
                  fontSize: 11, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono,
                }}
              >{b.label}</button>
            ))}
          </div>

          {/* Amount entry */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>
                {isBuy ? 'YOU PAY (' + baseSymbol + ')' : 'YOU SELL (' + token.symbol + ')'}
              </span>
              <span style={{
                fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim,
                border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono,
              }}>5% FEE · in {isBuy ? baseSymbol : baseSymbol}</span>
            </div>
            <div style={{
              background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '13px 14px', marginBottom: 9,
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: isBusy ? 0.6 : 1,
            }}>
              <input
                value={amount}
                onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }}
                placeholder="0.00"
                disabled={isBusy}
                inputMode="decimal"
                enterKeyHint="done"
                style={{
                  flex: 1, background: 'transparent', border: 'none', fontSize: 24,
                  fontWeight: 800, color: C.inkStr, outline: 'none',
                  fontVariantNumeric: 'tabular-nums', ...T.display,
                  minWidth: 0,
                }}
              />
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>
                {isBuy ? baseSymbol : token.symbol}
              </span>
            </div>
            {n > 0 && inputUsd > 0 && (
              <div style={{
                fontSize: 10, color: C.muted, fontWeight: 600,
                marginBottom: 9, marginTop: -3, paddingLeft: 4, ...T.mono,
              }}>
                ≈ {fmtUsd(inputUsd, 2)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {chips.map(c => {
                const disabled = isBusy || !c.val;
                return (
                  <button
                    key={c.label}
                    onClick={() => { if (c.val) { setAmount(c.val); setError(''); } }}
                    disabled={disabled}
                    style={{
                      flex: 1, padding: 8, borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      background: 'rgba(255,255,255,.03)',
                      color: c.val ? C.muted : C.muted2,
                      fontWeight: 700, fontSize: 11,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.4 : 1, ...T.mono,
                    }}
                  >{c.label}</button>
                );
              })}
            </div>
          </div>

          {/* Quote preview */}
          {n > 0 && (
            <div style={{
              background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '12px 14px', marginBottom: 12,
            }}>
              <div style={{
                fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em',
                marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                ...T.mono,
              }}>
                <span>YOU RECEIVE</span>
                {quoting && <span style={{ color: C.hl }}>updating...</span>}
              </div>
              <div style={{
                fontSize: 22, fontWeight: 800,
                color: outAtomic > 0 ? C.inkStr : C.muted,
                fontVariantNumeric: 'tabular-nums', marginBottom: 10, ...T.display,
              }}>
                {outAtomic > 0
                  ? (isBuy
                      ? fmtAmt(netOut, 6) + ' ' + token.symbol
                      : fmtAmt(netOut, baseDecimals === SOL_DECIMALS ? 4 : 2) + ' ' + baseSymbol)
                  : '—'}
              </div>
              {quote && (
                <div style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8 }}>
                  {[
                    ['Platform fee (5%)', isBuy
                      ? '-' + fmtAmt(feeAmtBuy, baseDecimals === SOL_DECIMALS ? 6 : 4) + ' ' + baseSymbol
                      : '-' + fmtAmt(feeAmtSell, baseDecimals === SOL_DECIMALS ? 6 : 4) + ' ' + baseSymbol],
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

          {/* Risk note */}
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(245,181,61,.06)',
            border: '1px solid rgba(245,181,61,.18)',
            fontSize: 10.5, color: C.amber, lineHeight: 1.5,
            fontWeight: 600, ...T.body,
          }}>
            Meme coins are highly volatile and can lose value rapidly. Only trade what you can afford to lose.
          </div>
        </div>

        {/* Footer / submit */}
        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg,transparent 0%,${C.bg} 20%)`,
        }}>
          {submitState.kind === 'loading' && submitState.message && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: 'rgba(151,252,228,.05)',
              border: '1px solid rgba(151,252,228,.20)',
              borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                border: `2px solid ${C.hlDim}`, borderTopColor: C.hl,
                animation: 'nx-spin 0.8s linear infinite',
              }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{submitState.message}</span>
            </div>
          )}
          {(error || submitState.kind === 'error') && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: 'rgba(255,138,158,.08)',
              border: '1px solid rgba(255,138,158,.24)',
              borderRadius: 12, fontSize: 12, color: C.down, ...T.body,
            }}>
              {error || submitState.message}
            </div>
          )}

          {!wcon ? (
            <button
              onClick={() => onConnectWallet?.()}
              style={{
                width: '100%', padding: 17, borderRadius: 16, border: 'none',
                background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`,
                color: '#04070f', fontWeight: 800, fontSize: 16,
                cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display,
              }}
            >Connect Wallet</button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isBusy || !quote || !valid}
              style={{
                width: '100%', padding: 17, borderRadius: 16, border: 'none',
                background: isSuccess
                  ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                  : isBuy
                    ? `linear-gradient(135deg,${C.hl} 0%,${C.hl2} 100%)`
                    : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
                color: '#04070f', fontWeight: 800, fontSize: 16,
                cursor: isBusy || !quote || !valid ? 'not-allowed' : 'pointer',
                minHeight: 56,
                opacity: !quote || !valid ? 0.55 : 1,
                boxShadow: '0 12px 30px rgba(151,252,228,.18)',
                letterSpacing: '-.01em', ...T.display,
              }}
            >
              {isBusy ? 'Processing...' :
               isSuccess ? 'Trade placed' :
               insufficient ? (isBuy ? `Insufficient ${baseSymbol}` : `Insufficient ${token.symbol}`) :
               !valid ? 'Enter amount' :
               !quote ? (quoting ? 'Getting quote...' : 'No route') :
               `${isBuy ? 'Buy' : 'Sell'} ${token.symbol}`}
            </button>
          )}

          <div style={{
            fontSize: 9.5, color: C.muted2, textAlign: 'center',
            marginTop: 10, lineHeight: 1.5, ...T.body,
          }}>
            Atomic swap via Jupiter · 5% builder fee in {baseSymbol} · Non-custodial
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN PAGE
// =====================================================================

export default function MemeWonderland({ onConnectWallet }) {
  const { publicKey: solPk } = useWallet();
  const { presets } = useNexusWallet();
  const walletPubkey = useMemo(() => (solPk ? solPk.toString() : null), [solPk]);

  const [tab, setTab]               = useState('pulse');
  const [tokens, setTokens]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [hot1h, setHot1h]           = useState([]);  // For ticker strip
  const [solPrice, setSolPrice]     = useState(0);
  const [holdings, setHoldings]     = useState({}); // mint -> { atomic, ui, decimals }
  const [watchlist, setWatchlist]   = useState(() => loadWatchlist());
  const [query, setQuery]           = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // Modal state
  const [activeToken, setActiveToken] = useState(null);
  const [initialSol,  setInitialSol]  = useState(null);
  const [initialSide, setInitialSide] = useState('BUY');

  // -- Load watchlist tokens (the main "tokens" state is now only used by
  //    the Watch view; search has its own searchResults state, and the
  //    main Pulse columns load via reloadPulse).
  const reloadMainList = useCallback(async () => {
    if (tab !== 'watch') {
      // Pulse mode manages its own data; nothing to load here.
      setLoading(false);
      return;
    }
    setLoading(true);
    if (watchlist.length === 0) {
      setTokens([]); setLoading(false); return;
    }
    const list = await searchJupTokens(watchlist.join(','));
    setTokens(list);
    setLoading(false);
  }, [tab, watchlist]);

  useEffect(() => { reloadMainList(); }, [reloadMainList]);

  // -- Auto-refresh the Watch list every 30s when on that tab.
  useEffect(() => {
    if (tab !== 'watch') return;
    const id = setInterval(reloadMainList, 30_000);
    return () => clearInterval(id);
  }, [reloadMainList, tab]);

  // -- Load Pulse data: fresh launches + trending tokens, then classify
  //    into NEW / STRETCH / MIGRATED columns by lifecycle stage.
  //    Uses Jupiter's bondingProgress when available, mcap thresholds as
  //    fallback. Polls every 10s for a live feel.
  const [pulseRecent, setPulseRecent]     = useState([]);
  const [pulseTrending, setPulseTrending] = useState([]);
  const [pulseLoading, setPulseLoading]   = useState(true);

  const reloadPulse = useCallback(async () => {
    const [recent, trending] = await Promise.all([
      fetchRecentMemes({ limit: 80, minLiquidityUsd: 0 }),
      fetchTrendingMemes({ interval: '1h', limit: 80 }),
    ]);
    setPulseRecent(recent);
    setPulseTrending(trending);
    setPulseLoading(false);
  }, []);

  useEffect(() => { reloadPulse(); }, [reloadPulse]);

  useEffect(() => {
    const id = setInterval(reloadPulse, 10_000);
    return () => clearInterval(id);
  }, [reloadPulse]);

  // -- Load hot 1h strip independently --
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await fetchTrendingMemes({ interval: '1h', limit: 12 });
      if (alive) setHot1h(list);
    };
    load();
    const id = setInterval(load, 45_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // -- Load SOL price for USD-equivalent display --
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchWithTimeout('/api/sol-price', {}, 6_000);
        const j = await r.json();
        if (alive && Number.isFinite(j.price)) setSolPrice(j.price);
      } catch {}
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // -- Load holdings (which displayed memes the user already owns).
  //    Pull from both the Pulse columns AND the main tokens list so holdings
  //    show up no matter which view the user is on.
  useEffect(() => {
    if (!walletPubkey) { setHoldings({}); return; }
    const seen = new Set();
    const all = [];
    [
      ...pulseColumns.new,
      ...pulseColumns.stretch,
      ...pulseColumns.migrated,
      ...tokens,
    ].forEach(t => {
      if (t?.mint && !seen.has(t.mint)) {
        seen.add(t.mint);
        all.push(t);
      }
    });
    if (all.length === 0) { setHoldings({}); return; }
    let cancelled = false;
    (async () => {
      // Cap at 50 tokens to keep RPC load reasonable
      const slice = all.slice(0, 50);
      const results = await Promise.allSettled(slice.map(t =>
        fetchTokenBalance({ ownerPubkey: walletPubkey, mint: t.mint, decimals: t.decimals }),
      ));
      if (cancelled) return;
      const map = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.ui > 0) {
          map[slice[i].mint] = r.value;
        }
      });
      setHoldings(map);
    })();
    return () => { cancelled = true; };
  }, [walletPubkey, pulseColumns, tokens]);

  // -- Search debounce --
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const handle = setTimeout(async () => {
      const list = await searchJupTokens(query.trim());
      setSearchResults(list);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Hero token: prefer the highest-liquidity meme-worthy token in the
  // MIGRATED column (most established + liquid). Falls back to whichever
  // column has data if migrated is empty.
  const heroToken = useMemo(() => {
    if (searchResults && searchResults.length) {
      const sr = searchResults.filter(isMemeWorthy);
      return sr[0] || null;
    }
    const candidates = [
      ...pulseColumns.migrated,
      ...pulseColumns.stretch,
      ...pulseColumns.new,
    ];
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) =>
      (b.liquidity || 0) - (a.liquidity || 0) ||
      (b.organicScore || 0) - (a.organicScore || 0)
    );
    return sorted[0] || null;
  }, [pulseColumns, searchResults]);

  const listToken = useMemo(() => {
    if (searchResults && query.trim()) return searchResults;
    return tokens;
  }, [tokens, searchResults, query]);

  // -- Derive the 3 Pulse columns from the loaded recent + trending lists.
  //    NEW comes mostly from /recent (sorted newest first).
  //    STRETCH and MIGRATED come from both lists, deduped + classified.
  const pulseColumns = useMemo(() => {
    const seen = new Set();
    const newCol = [];
    const stretchCol = [];
    const migratedCol = [];

    const consider = (t) => {
      if (!t || !t.mint || seen.has(t.mint)) return;
      if (!isMemeWorthy(t)) return;
      seen.add(t.mint);
      const stage = classifyStage(t);
      if (stage === 'new') newCol.push(t);
      else if (stage === 'stretch') stretchCol.push(t);
      else migratedCol.push(t);
    };

    // /recent gives us fresh launches, mostly NEW + some early STRETCH
    pulseRecent.forEach(consider);
    // trending fills out STRETCH and MIGRATED with established movers
    pulseTrending.forEach(consider);

    // Sort each column for the most useful order:
    //  - NEW: newest first (by firstPool desc)
    //  - STRETCH: highest bonding % first, then by mcap
    //  - MIGRATED: best 1h % first (active gainers float to top)
    const t = (x) => x.firstPool ? new Date(x.firstPool).getTime() : 0;
    newCol.sort((a, b) => t(b) - t(a));
    stretchCol.sort((a, b) =>
      (b.bondingProgress || 0) - (a.bondingProgress || 0) ||
      (b.mcap || 0) - (a.mcap || 0)
    );
    migratedCol.sort((a, b) =>
      (b.change1h || b.change24h || 0) - (a.change1h || a.change24h || 0)
    );

    return {
      new:      newCol.slice(0, 40),
      stretch:  stretchCol.slice(0, 40),
      migrated: migratedCol.slice(0, 40),
    };
  }, [pulseRecent, pulseTrending]);

  // -- Watchlist toggling --
  const toggleWatch = useCallback((mint) => {
    setWatchlist(prev => {
      const next = prev.includes(mint) ? prev.filter(m => m !== mint) : [mint, ...prev];
      saveWatchlist(next);
      return next;
    });
  }, []);

  // -- Trade openers --
  const openBuy = (token, presetAmount) => {
    setActiveToken(token);
    setInitialSol(presetAmount);
    setInitialSide('BUY');
  };
  const openSell = (token) => {
    setActiveToken(token);
    setInitialSol(null);
    setInitialSide('SELL');
  };

  // Default preset for the "1-click buy" tile button (smallest meme preset)
  const defaultPreset = DEFAULT_BUY_PRESETS_SOL[0];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');
        @keyframes nx-pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        @keyframes nx-spin { to{transform:rotate(360deg)} }
        @keyframes nx-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        body.nexus-scroll-locked { overflow:hidden; }
      `}</style>

      <div style={{
        maxWidth: 680, margin: '0 auto', width: '100%',
        padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)',
        color: C.ink,
        backgroundImage:
          'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(168,127,255,.10),transparent 60%),' +
          'radial-gradient(ellipse 60% 30% at 80% 20%,rgba(255,93,155,.06),transparent 50%)',
      }}>

        {/* Compact page header — tight, no wasted vertical space */}
        <div style={{
          marginTop: 8, marginBottom: 10, padding: '14px 16px 12px',
          borderRadius: 18,
          background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
          border: '1px solid rgba(255,255,255,.07)',
          boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', right: -40, top: -50, width: 160, height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(255,93,155,.14),transparent 65%)',
            pointerEvents: 'none',
          }}/>
          <div style={{
            position: 'absolute', left: -60, bottom: -80, width: 160, height: 160,
            borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(168,127,255,.12),transparent 65%)',
            pointerEvents: 'none',
          }}/>

          <div style={{ position: 'relative' }}>
            {/* Title row + LIVE pill in one line */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <h1 style={{
                fontSize: 24, lineHeight: 1, fontWeight: 600,
                color: C.inkStr, margin: 0,
                letterSpacing: '-.035em', ...T.hero,
              }}>
                Meme{' '}
                <span style={{
                  fontStyle: 'italic', fontWeight: 500,
                  background: `linear-gradient(135deg,${C.hotPink} 0%,${C.violet} 60%,${C.hl} 100%)`,
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>wonderland</span>
              </h1>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 9px', borderRadius: 999,
                background: 'rgba(255,93,155,.08)',
                border: '1px solid rgba(255,93,155,.24)',
                flexShrink: 0,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: C.hotPink, boxShadow: `0 0 8px ${C.hotPink}`,
                  animation: 'nx-pulse 1.6s ease-in-out infinite',
                }}/>
                <span style={{
                  color: C.hotPink, fontSize: 8.5, fontWeight: 800,
                  letterSpacing: '.10em', ...T.mono,
                }}>LIVE</span>
              </div>
            </div>

            {/* Trending ticker — always there, always moving */}
            <TrendingTicker tokens={hot1h} onTap={(t) => openBuy(t, defaultPreset)}/>

            {/* Compact search */}
            <div style={{
              position: 'relative',
              background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '2px 4px 2px 10px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 12, color: C.muted2 }}>🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search or paste contract..."
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  color: C.ink, fontSize: 12.5, outline: 'none', padding: '7px 4px',
                  ...T.body, minWidth: 0,
                }}
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setSearchResults(null); }}
                  style={{
                    background: 'transparent', border: 'none', color: C.muted2,
                    cursor: 'pointer', fontSize: 15, padding: '0 8px',
                  }}
                >×</button>
              )}
            </div>
          </div>
        </div>

        {/* Slim featured strip — 1-row hero replacement */}
        {heroToken && !query && (
          <FeaturedStrip token={heroToken} onBuy={openBuy}/>
        )}

        {/* Mode toggle — Pulse (default) vs Watch (saved tokens) */}
        {!query && (
          <div style={{
            display: 'flex', gap: 4, marginBottom: 8,
            overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2,
          }}>
            {[
              { id: 'pulse', label: '⚡ Pulse' },
              { id: 'watch', label: `★ Watch${watchlist.length > 0 ? ` (${watchlist.length})` : ''}` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  border: `1px solid ${tab === t.id ? C.borderHi : C.border}`,
                  background: tab === t.id ? C.hlDim : 'rgba(255,255,255,.03)',
                  color: tab === t.id ? C.hl : C.muted,
                  fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0, ...T.body,
                }}
              >{t.label}</button>
            ))}
          </div>
        )}

        {/* PULSE — 3-column lifecycle layout (Axiom-style).
            Mobile: horizontal scroll-snap columns.
            Desktop: 3 columns side-by-side. */}
        {!query && tab !== 'watch' && (
          <div style={{
            display: 'flex',
            gap: 8,
            marginBottom: 12,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollSnapType: 'x mandatory',
            paddingBottom: 4,
          }}>
            {['new', 'stretch', 'migrated'].map(stage => (
              <div key={stage} style={{
                flex: '0 0 min(86vw, 320px)',
                scrollSnapAlign: 'start',
                display: 'flex',
              }}>
                <PulseColumn
                  stage={stage}
                  tokens={pulseColumns[stage]}
                  holdings={holdings}
                  defaultPreset={defaultPreset}
                  onTradeBuy={openBuy}
                  onTradeSell={openSell}
                  loading={pulseLoading}
                />
              </div>
            ))}
          </div>
        )}

        {/* SEARCH / WATCH — fall back to the row list for these views */}
        {(query || tab === 'watch') && (
          <div style={{
            background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`,
            borderRadius: 18, overflow: 'hidden', marginBottom: 14,
            backdropFilter: 'blur(12px)',
          }}>
            {loading && listToken.length === 0 ? (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
                Loading memes...
              </div>
            ) : listToken.length === 0 ? (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
                {query
                  ? 'No tokens found.'
                  : 'Your watchlist is empty. Star tokens to add them.'}
              </div>
            ) : listToken.map(t => (
              <MemeRow
                key={t.mint}
                token={t}
                presetSol={defaultPreset}
                holding={holdings[t.mint]}
                onTradeBuy={openBuy}
                onTradeSell={openSell}
                showAge={true}
              />
            ))}
          </div>
        )}

        {/* Compact footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 12px', borderRadius: 10,
          background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`,
          marginBottom: 6, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 8.5, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>VIA</span>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '.04em',
            background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', ...T.mono,
          }}>JUPITER · SOLANA</span>
          <span style={{ color: C.muted2, fontSize: 8 }}>·</span>
          <span style={{ fontSize: 8.5, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>5% FEE · NON-CUSTODIAL</span>
        </div>
      </div>

      <MemeTradeModal
        open={!!activeToken}
        token={activeToken}
        initialSol={initialSol}
        initialSide={initialSide}
        solUsdPrice={solPrice}
        walletPubkey={walletPubkey}
        onConnectWallet={onConnectWallet}
        onClose={() => setActiveToken(null)}
        onAfterTrade={() => { reloadPulse(); reloadMainList(); }}
        presets={presets}
      />
    </>
  );
}
