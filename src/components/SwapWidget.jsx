```js
/**
 * NEXUS DEX - Unified Swap Widget (OKX DEX edition)
 *
 * Swap engine: OKX DEX API
 *   Solana swaps  -> GET /api/okx/dex/aggregator/swap-instruction
 *   EVM swaps     -> GET /api/okx/dex/aggregator/swap
 *
 * Price data: DexScreener (replaces LiFi + Helius)
 * Token search: OKX (Solana) + DexScreener (all chains)
 *
 * OKX referrer tag added to all OKX requests for partner tracking.
 * Fees injected server-side in server.js.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { useAccount, useWalletClient, useBalance, useSwitchChain, usePublicClient } from 'wagmi';
import {
  VersionedTransaction, PublicKey, LAMPORTS_PER_SOL,
  TransactionInstruction, TransactionMessage, AddressLookupTableAccount,
} from '@solana/web3.js';

/* ===== OKX REFERRER ====================================================== */
const OKX_REFERRER = 'nexus-dex';

/* ===== CONSTANTS ========================================================== */

const PLATFORM_FEE = 0.03;
const SAFETY_FEE   = 0.02;
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;

const OKX_SOL_NATIVE = '11111111111111111111111111111111';
const OKX_EVM_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WSOL_MINT  = 'So11111111111111111111111111111111111111112';

const OKX_EVM_CHAINS = new Set([
  1, 10, 56, 130, 137, 146, 324, 1101, 5000, 8453, 34443, 42161, 43114,
  57073, 59144, 80094, 81457, 534352, 1329, 2741,
]);

const SOL_RESERVE_LAMPORTS   = 5_000_000;
const EVM_NATIVE_RESERVE_PCT = 0.005;
const QUOTE_DEBOUNCE_MS      = 250;
const PRICE_CACHE_TTL_MS     = 60_000;

const CHAIN_NAMES = {
  1: 'Ethereum', 10: 'Optimism', 25: 'Cronos', 56: 'BNB Chain', 100: 'Gnosis',
  130: 'Unichain', 137: 'Polygon', 146: 'Sonic', 250: 'Fantom', 324: 'zkSync Era',
  2741: 'Abstract', 5000: 'Mantle', 8453: 'Base', 34443: 'Mode', 42161: 'Arbitrum',
  43114: 'Avalanche', 57073: 'Ink', 59144: 'Linea', 80094: 'Berachain',
  81457: 'Blast', 534352: 'Scroll', 1329: 'SEI', 1101: 'Polygon zkEVM',
};

const CHAIN_SHORT = {
  1: 'ETH', 10: 'OP', 56: 'BNB', 130: 'UNI', 137: 'POL', 146: 'SONIC',
  324: 'zkSync', 2741: 'ABS', 5000: 'MNT', 8453: 'BASE', 34443: 'MODE',
  42161: 'ARB', 43114: 'AVAX', 57073: 'INK', 59144: 'LINEA', 80094: 'BERA',
  81457: 'BLAST', 534352: 'SCROLL', 1329: 'SEI', 1101: 'POL-ZK',
};

const USDC_BY_CHAIN = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
};
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEXSCREENER_BASE = '/api/dexscreener';

const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [50, 100];
const PRESETS_LS_KEY       = 'nexus_presets_v2';
const LAST_PAIR_LS_KEY     = 'nexus_last_pair_v1';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad: 'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
  privy: '#a855f7',
};

const POPULAR_TOKENS = [
  { mint: WSOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: USDC_SOLANA, symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'solana' },
  { address: NATIVE_EVM, chainId: 1, symbol: 'ETH', name: 'Ethereum', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 8453, symbol: 'ETH', name: 'ETH (Base)', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH', name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 10, symbol: 'ETH', name: 'ETH (Optimism)', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 56, symbol: 'BNB', name: 'BNB', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 137, symbol: 'POL', name: 'Polygon', decimals: 18, chain: 'evm' },
  { address: NATIVE_EVM, chainId: 43114, symbol: 'AVAX', name: 'Avalanche', decimals: 18, chain: 'evm' },
  { address: USDC_BY_CHAIN[1], chainId: 1, symbol: 'USDC', name: 'USDC (ETH)', decimals: 6, chain: 'evm' },
  { address: USDC_BY_CHAIN[8453], chainId: 8453, symbol: 'USDC', name: 'USDC (Base)', decimals: 6, chain: 'evm' },
  { address: USDC_BY_CHAIN[42161], chainId: 42161, symbol: 'USDC', name: 'USDC (Arbitrum)', decimals: 6, chain: 'evm' },
];

const _NATIVE_BY_CHAIN = {
  1: { symbol: 'ETH', name: 'Ethereum' }, 56: { symbol: 'BNB', name: 'BNB' },
  137: { symbol: 'POL', name: 'Polygon' }, 43114: { symbol: 'AVAX', name: 'Avalanche' },
  8453: { symbol: 'ETH', name: 'ETH (Base)' }, 42161: { symbol: 'ETH', name: 'ETH (Arbitrum)' },
  10: { symbol: 'ETH', name: 'ETH (Optimism)' },
};

/* ===== NUMERIC HELPERS ==================================================== */

function safeBigInt(v) {
  if (v == null) return BigInt(0);
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)) : BigInt(0);
  let s = String(v).trim();
  if (!s) return BigInt(0);
  if (/^-?0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  if (/^-?\d+$/.test(s)) return BigInt(s);
  const n = Number(s);
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : BigInt(0);
}

function tokensEqual(a, b) {
  if (!a || !b) return false;
  if (a.chain === 'solana' && b.chain === 'solana') return a.mint === b.mint;
  if (a.chain === 'evm' && b.chain === 'evm') return a.chainId === b.chainId && (a.address || '').toLowerCase() === (b.address || '').toLowerCase();
  return false;
}

function fmtUsd(n, decimals = 2) {
  if (n == null || isNaN(n)) return '-';
  const v = Number(n);
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: decimals });
  if (v >= 1) return '$' + v.toFixed(decimals);
  if (v > 0) return '$' + v.toFixed(6);
  return '$0.00';
}

function fmtTokenAmount(n, decimals = 4) {
  if (n == null || isNaN(n)) return '0';
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toFixed(decimals);
}

function shortAddr(addr, head = 4, tail = 4) {
  if (!addr || addr.length < head + tail) return addr || '';
  return addr.slice(0, head) + '\u2026' + addr.slice(-tail);
}

function isValidSolMint(s) { return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s); }
function isValidEvmAddr(s) { return !!s && /^0x[0-9a-fA-F]{40}$/.test(s); }

function toRawAmount(amountStr, decimals) {
  if (!amountStr || decimals == null) return '0';
  let s = String(amountStr).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!s || s.startsWith('-')) return '0';
  if (/e/i.test(s)) { const n = Number(s); if (!Number.isFinite(n) || n < 0) return '0'; s = n.toFixed(Math.max(Number(decimals) || 0, 20)); }
  const dec = Math.floor(Number(decimals));
  if (!Number.isFinite(dec) || dec < 0 || dec > 18) return '0';
  const [whole, frac = ''] = s.split('.');
  const safeWhole = (whole || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const fracTrunc = (frac || '').replace(/[^\d]/g, '').slice(0, dec);
  const fracPadded = (fracTrunc + '0'.repeat(dec)).slice(0, dec) || '0';
  try { return (BigInt(safeWhole) * (10n ** BigInt(dec)) + BigInt(fracPadded)).toString(); }
  catch { return '0'; }
}

/* ===== TOKEN NORMALIZATION ================================================ */

function normalizeToken(input) {
  if (!input) return null;
  if (input.chain === 'solana' && input.mint) return input;
  if (input.chain === 'evm' && input.address && input.chainId) return input;
  const logoURI = input.logoURI || input.image || input.thumbnail || null;
  const symbol = input.symbol || 'TOKEN';
  const name = input.name || symbol;
  const evmAddr = input.address || input.contractAddress || null;
  if (evmAddr && isValidEvmAddr(evmAddr)) return { chain: 'evm', address: evmAddr, chainId: input.chainId || 1, symbol, name, decimals: input.decimals || 18, logoURI };
  const solMint = input.mint || (input.isSolanaToken ? input.id : null);
  if (solMint && isValidSolMint(solMint)) return { chain: 'solana', mint: solMint, symbol, name, decimals: input.decimals || 6, logoURI };
  return null;
}

function nativeOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find(t => t.mint === WSOL_MINT);
  const pop = POPULAR_TOKENS.find(t => t.chain === 'evm' && t.chainId === chainId && t.address === NATIVE_EVM);
  if (pop) return pop;
  const meta = _NATIVE_BY_CHAIN[chainId];
  if (!meta) return null;
  return { chain: 'evm', address: NATIVE_EVM, chainId, symbol: meta.symbol, name: meta.name, decimals: 18, logoURI: null };
}

function usdcOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find(t => t.mint === USDC_SOLANA);
  const addr = USDC_BY_CHAIN[chainId];
  if (!addr) return null;
  return POPULAR_TOKENS.find(t => t.chain === 'evm' && t.chainId === chainId && (t.address || '').toLowerCase() === addr.toLowerCase())
    || { chain: 'evm', address: addr, chainId, symbol: 'USDC', name: 'USDC', decimals: 6, logoURI: null };
}

function pickDistinct(target, candidates) {
  for (const c of candidates) { if (c && (!target || !tokensEqual(c, target))) return c; }
  return null;
}

function defaultTokenPair({ mode, viewedToken, lastFromToken, walletState }) {
  const ws = walletState || {};
  const viewed = viewedToken ? normalizeToken(viewedToken) : null;
  if (mode === 'buy' && viewed) {
    const chain = viewed.chain === 'solana' ? 'solana' : viewed.chainId;
    const from = pickDistinct(viewed, [lastFromToken, nativeOfChain(chain), usdcOfChain(chain), POPULAR_TOKENS[0]]);
    return { fromToken: from || POPULAR_TOKENS[0], toToken: viewed };
  }
  if (mode === 'sell' && viewed) {
    const chain = viewed.chain === 'solana' ? 'solana' : viewed.chainId;
    const to = pickDistinct(viewed, [usdcOfChain(chain), nativeOfChain(chain), POPULAR_TOKENS[1], POPULAR_TOKENS[0]]);
    return { fromToken: viewed, toToken: to || POPULAR_TOKENS[1] };
  }
  if (lastFromToken) {
    const chain = lastFromToken.chain === 'solana' ? 'solana' : lastFromToken.chainId;
    const usdc = usdcOfChain(chain);
    if (usdc && !tokensEqual(usdc, lastFromToken)) return { fromToken: lastFromToken, toToken: usdc };
  }
  if (ws.solConnected) return { fromToken: nativeOfChain('solana'), toToken: usdcOfChain('solana') };
  if (ws.evmConnected && ws.evmChainId) {
    const n = nativeOfChain(ws.evmChainId), u = usdcOfChain(ws.evmChainId) || usdcOfChain('solana');
    if (n && u) return { fromToken: n, toToken: u };
  }
  return { fromToken: nativeOfChain('solana'), toToken: usdcOfChain('solana') };
}

/* ===== ROUTE PICKER ======================================================= */

function pickRoute(from, to) {
  if (!from || !to) return 'unsupported';
  if (from.chain === 'solana' && to.chain === 'solana') return 'okx-sol';
  if (from.chain === 'evm' && to.chain === 'evm' && from.chainId === to.chainId && OKX_EVM_CHAINS.has(from.chainId)) return 'okx-evm';
  return 'unsupported';
}

/* ===== OKX ADDRESS HELPERS ================================================ */

function toOkxSolAddress(mint) { return mint === WSOL_MINT ? OKX_SOL_NATIVE : mint; }
function toOkxEvmAddress(address) { return (address || '').toLowerCase() === NATIVE_EVM ? OKX_EVM_NATIVE : address; }

/* ===== DEXSCREENER PRICE + SEARCH HELPERS ================================= */

const _dsPriceCache = new Map();

function dsCacheKey(token) {
  if (!token) return null;
  return token.chain === 'solana' ? 'sol:' + token.mint : 'evm:' + token.chainId + ':' + (token.address || '').toLowerCase();
}

function getCachedDsPrice(token) {
  const key = dsCacheKey(token);
  if (!key) return null;
  const e = _dsPriceCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > PRICE_CACHE_TTL_MS) { _dsPriceCache.delete(key); return null; }
  return e.price;
}

function setCachedDsPrice(token, price) {
  const key = dsCacheKey(token);
  if (!key || !(price > 0)) return;
  _dsPriceCache.set(key, { price: Number(price), ts: Date.now() });
}

async function fetchDsTokenPrice(token) {
  if (!token) return null;
  const cached = getCachedDsPrice(token);
  if (cached != null) return cached;
  try {
    const addr = token.chain === 'solana' ? token.mint : token.address;
    const res = await fetch(DEXSCREENER_BASE + '/latest/dex/tokens/' + encodeURIComponent(addr));
    const data = await res.json().catch(() => null);
    if (data && data.pairs && data.pairs.length > 0) {
      let best = null;
      for (const p of data.pairs) {
        const pr = Number(p.priceUsd || 0);
        if (pr > 0 && (!best || (p.liquidity?.usd || 0) > (best.liquidity?.usd || 0))) best = p;
      }
      if (best) {
        const price = Number(best.priceUsd || 0);
        if (price > 0) { setCachedDsPrice(token, price); return price; }
      }
    }
  } catch {}
  return null;
}

async function fetchDsSearch(query) {
  try {
    const res = await fetch(DEXSCREENER_BASE + '/latest/dex/search?q=' + encodeURIComponent(query));
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.pairs)) return [];
    const seen = new Set();
    const tokens = [];
    for (const p of data.pairs) {
      const bt = p.baseToken || {};
      const addr = bt.address || '';
      if (!addr || seen.has(addr.toLowerCase())) continue;
      seen.add(addr.toLowerCase());
      const chainId = p.chainId || 'ethereum';
      const isSol = chainId === 'solana';
      tokens.push({
        chain: isSol ? 'solana' : 'evm',
        mint: isSol ? addr : undefined,
        address: isSol ? undefined : addr,
        chainId: isSol ? undefined : (CHAIN_SHORT[chainId] ? Number(Object.keys(CHAIN_SHORT).find(k => CHAIN_SHORT[k] === chainId)) || 1 : 1),
        symbol: bt.symbol || '???',
        name: bt.name || bt.symbol || 'Unknown',
        decimals: isSol ? 6 : (bt.decimals || 18),
        logoURI: bt.imgUrl || p.info?.imageUrl || null,
      });
    }
    return tokens.slice(0, 40);
  } catch { return []; }
}

let _okxSolTokensCache = null;
let _okxSolTokensLoading = null;

function loadOkxSolTokens() {
  if (_okxSolTokensCache) return Promise.resolve(_okxSolTokensCache);
  if (_okxSolTokensLoading) return _okxSolTokensLoading;
  _okxSolTokensLoading = fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501')
    .then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }))
    .then(json => {
      const tokens = (json.data || []).map(t => ({
        chain: 'solana', mint: t.tokenContractAddress,
        symbol: t.tokenSymbol || '', name: t.tokenName || t.tokenSymbol || '',
        decimals: parseInt(t.decimals) || 6, logoURI: t.tokenLogoUrl || null,
      })).filter(t => isValidSolMint(t.mint) && t.symbol);
      _okxSolTokensCache = tokens;
      _okxSolTokensLoading = null;
      return tokens;
    });
  return _okxSolTokensLoading;
}

/* ===== OKX SWAP HELPERS =================================================== */

async function fetchOkxSolanaSwap({ fromMint, toMint, amount, slippage, userWallet, signal }) {
  const params = new URLSearchParams({
    chainIndex: '501',
    fromTokenAddress: toOkxSolAddress(fromMint),
    toTokenAddress: toOkxSolAddress(toMint),
    amount: String(amount),
    slippagePercent: (slippage / 100).toFixed(4),
    userWalletAddress: userWallet,
    referrer: OKX_REFERRER,
  });
  const res = await fetch('/api/okx/dex/aggregator/swap-instruction?' + params.toString(), { signal });
  const json = await res.json();
  if (json.code !== '0' || !json.data || !json.data[0]) throw new Error(json.msg || 'OKX swap-instruction failed');
  return json.data[0];
}

async function fetchOkxEvmSwap({ chainId, fromAddress, toAddress, amount, slippage, userWallet, signal }) {
  const params = new URLSearchParams({
    chainIndex: String(chainId),
    fromTokenAddress: toOkxEvmAddress(fromAddress),
    toTokenAddress: toOkxEvmAddress(toAddress),
    amount: String(amount),
    slippagePercent: (slippage / 100).toFixed(4),
    userWalletAddress: userWallet,
    referrer: OKX_REFERRER,
  });
  const res = await fetch('/api/okx/dex/aggregator/swap?' + params.toString(), { signal });
  const json = await res.json();
  if (json.code !== '0' || !json.data || !json.data[0]) throw new Error(json.msg || 'OKX EVM swap failed');
  return json.data[0];
}

async function fetchOkxEvmApproval({ chainId, tokenAddress, amount }) {
  try {
    const params = new URLSearchParams({
      chainIndex: String(chainId),
      tokenContractAddress: tokenAddress,
      approveAmount: String(amount),
      referrer: OKX_REFERRER,
    });
    const res = await fetch('/api/okx/dex/aggregator/approve-transaction?' + params.toString());
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data[0]) return null;
    return json.data[0];
  } catch { return null; }
}

function deserializeOkxIx(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: !!a.isSigner, isWritable: !!a.isWritable })),
    data: Buffer.from(ix.data || '', 'base64'),
  });
}

async function buildOkxSolanaTransaction({ connection, userPubkey, swapData }) {
  const instructions = (swapData.instructionLists || []).map(deserializeOkxIx);
  const ltAddrs = Array.isArray(swapData.addressLookupTableAccount) ? swapData.addressLookupTableAccount : [];
  const lookupTables = (await Promise.all(ltAddrs.map(async addr => {
    try {
      const acct = await connection.getAccountInfo(new PublicKey(addr));
      if (!acct) return null;
      return new AddressLookupTableAccount({ key: new PublicKey(addr), state: AddressLookupTableAccount.deserialize(acct.data) });
    } catch { return null; }
  }))).filter(Boolean);
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  return new VersionedTransaction(new TransactionMessage({ payerKey: userPubkey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables));
}

/* ===== PRESET HELPERS ===================================================== */

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return { buy: DEFAULT_BUY_PRESETS.slice(), sell: DEFAULT_SELL_PRESETS.slice() };
    const p = JSON.parse(raw);
    return { buy: Array.isArray(p.buy) && p.buy.length >= 2 ? p.buy : DEFAULT_BUY_PRESETS.slice(), sell: Array.isArray(p.sell) && p.sell.length >= 1 ? p.sell : DEFAULT_SELL_PRESETS.slice() };
  } catch { return { buy: DEFAULT_BUY_PRESETS.slice(), sell: DEFAULT_SELL_PRESETS.slice() }; }
}

function savePresets(p) { try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {} }

function loadLastPair() { try { const v = JSON.parse(localStorage.getItem(LAST_PAIR_LS_KEY) || 'null'); return (!v || !v.from) ? null : v; } catch { return null; } }
function saveLastPair(from, to) { if (!from || !to) return; try { localStorage.setItem(LAST_PAIR_LS_KEY, JSON.stringify({ from, to, ts: Date.now() })); } catch {} }

function maxSafeAmount({ balance, isNative }) {
  if (!balance || balance <= 0) return 0;
  return isNative ? balance * (1 - EVM_NATIVE_RESERVE_PCT) : balance;
}
function maxSafeSolBalance(lamports) { return lamports ? Math.max(0, lamports - SOL_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL : 0; }

/* ===== UI COMPONENTS ====================================================== */

function ChainBadge({ token }) {
  if (!token) return null;
  const label = token.chain === 'solana' ? 'SOL' : (CHAIN_SHORT[token.chainId] || 'EVM');
  const color = token.chain === 'solana' ? '#9945ff' : '#627eea';
  return <span style={{ fontSize: 9, color, background: color + '22', border: '1px solid ' + color + '44', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>{label}</span>;
}

function TokenIcon({ token, size = 32 }) {
  const [errored, setErrored] = useState(false);
  if (token && token.logoURI && !errored) return <img src={token.logoURI} alt="" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} onError={() => setErrored(true)} />;
  const ch = (token && token.symbol) ? token.symbol.charAt(0).toUpperCase() : '?';
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, color: C.accent }}>{ch}</div>;
}

let _bodyLockCount = 0;
function useBodyScrollLock(open) {
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => { _bodyLockCount = Math.max(0, _bodyLockCount - 1); if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked'); };
  }, [open]);
}

function useEscapeKey(open, handler) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); handler?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handler]);
}

/* ===== TOKEN SELECT MODAL ================================================= */

function TokenSelectModal({ open, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [contractInput, setContractInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);

  const { chainId: evmChainId } = useAccount();
  const publicClient = usePublicClient({ chainId: evmChainId || 1 });

  // OKX Solana search
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults([]); return; }
    const handle = setTimeout(async () => {
      const solTokens = (_okxSolTokensCache || []);
      const sol = solTokens.filter(t => (t.symbol && t.symbol.toLowerCase().includes(trimmed.toLowerCase())) || (t.mint && t.mint === trimmed)).slice(0, 30);
      const pop = POPULAR_TOKENS.filter(t => t.symbol && t.symbol.toLowerCase().includes(trimmed.toLowerCase()));
      setSearchResults([...sol, ...pop]);
    }, 200);
    return () => clearTimeout(handle);
  }, [q]);

  // DexScreener EVM search for longer queries
  const discoverRef = useRef(0);
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2 || isValidSolMint(trimmed) || isValidEvmAddr(trimmed)) { setDiscovering(false); return; }
    const reqId = ++discoverRef.current;
    setDiscovering(true);
    const handle = setTimeout(async () => {
      const ds = await fetchDsSearch(trimmed);
      if (discoverRef.current !== reqId) return;
      const seen = new Set(searchResults.map(t => (t.mint || t.address || '').toLowerCase()));
      const newTokens = ds.filter(t => !seen.has((t.mint || t.address || '').toLowerCase()));
      if (newTokens.length > 0) setSearchResults(prev => [...prev, ...newTokens].slice(0, 60));
      setDiscovering(false);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Contract address lookup
  useEffect(() => {
    const addr = contractInput.trim();
    if (!addr) { setContractToken(null); setContractLoading(false); return; }
    if (!isValidSolMint(addr) && !isValidEvmAddr(addr)) { setContractToken(null); return; }
    setContractLoading(true);
    let cancelled = false;
    (async () => {
      try {
        if (isValidSolMint(addr)) {
          const cached = (_okxSolTokensCache || []).find(t => t.mint === addr);
          if (!cancelled) { setContractToken(cached || { chain: 'solana', mint: addr, symbol: shortAddr(addr), name: 'Custom Token', decimals: 6, logoURI: null }); setContractLoading(false); }
        } else {
          let symbol = shortAddr(addr), decimals = 18;
          try {
            if (publicClient) {
              const [d, s] = await Promise.allSettled([
                publicClient.readContract({ address: addr, abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }], functionName: 'decimals' }),
                publicClient.readContract({ address: addr, abi: [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' }),
              ]);
              if (d.status === 'fulfilled') decimals = Number(d.value);
              if (s.status === 'fulfilled' && s.value) symbol = s.value;
            }
          } catch {}
          if (!cancelled) { setContractToken({ chain: 'evm', address: addr, chainId: evmChainId || 1, symbol, name: 'Custom Token', decimals, logoURI: null }); setContractLoading(false); }
        }
      } catch { if (!cancelled) { setContractToken(null); setContractLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [contractInput, evmChainId, publicClient]);

  const close = () => { setQ(''); setContractInput(''); setContractToken(null); setSearchResults([]); onClose(); };
  useBodyScrollLock(open);
  useEscapeKey(open, close);

  const handleSelect = useCallback(t => { onSelect(t); close(); }, [onSelect, close]);

  const display = q.trim() ? searchResults : POPULAR_TOKENS;

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 440, maxHeight: 'min(85vh, 100dvh)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, padding: 4 }}>x</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, symbol..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', marginBottom: 8, fontFamily: 'Syne, sans-serif' }} />
          <input value={contractInput} onChange={e => setContractInput(e.target.value)} placeholder="Or paste contract address..." style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up...</div>}
          {contractToken && !contractLoading && (
            <div onClick={() => handleSelect(contractToken)} style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenIcon token={contractToken} size={28} />
              <div style={{ flex: 1 }}><span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</span></div>
              <span style={{ color: C.accent, fontSize: 11 }}>Select</span>
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700 }}>POPULAR</div>}
          {display.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>{discovering ? 'Searching...' : 'No matches'}</div>}
          {display.map((t, i) => (
            <div key={(t.mint || t.address || '') + i} onClick={() => handleSelect(t)} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}>
              <TokenIcon token={t} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</span><ChainBadge token={t} /></div>
                <div style={{ color: C.muted, fontSize: 11 }}>{t.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * MAIN SWAP WIDGET
 * ========================================================================== */

export default function SwapWidget({
  onConnectWallet, defaultFromToken, defaultToToken, compact = false, mode: modeProp = 'swap',
  presets: presetsProp, onPresetsChange, onStatusChange,
}) {
  const { publicKey: extPublicKey, sendTransaction: extSolSendTx, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const nexus = useNexusWallet();
  const { activeWalletKind, privyEmbeddedSol, privyEmbeddedEvm, loginPrivy } = nexus;

  const publicKey = useMemo(() => {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol?.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const hasSolSigner = solConnected || (!!privyEmbeddedSol && !!publicKey);
  const hasEvmSigner = evmConnected || (!!privyEmbeddedEvm && !!privyEmbeddedEvm.address);
  const effectiveEvmAddress = evmAddress || (privyEmbeddedEvm?.address) || null;
  const walletConnected = solConnected || evmConnected || hasSolSigner || hasEvmSigner;

  const walletClientRef = useRef(walletClient);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  const evmChainIdRef = useRef(evmChainId);
  useEffect(() => { evmChainIdRef.current = evmChainId; }, [evmChainId]);
  const publicClientRef = useRef(null);

  const sendTransaction = useCallback(async (tx, conn, opts) => {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') return privyEmbeddedSol.sendTransaction(tx, conn, opts);
      if (typeof privyEmbeddedSol.signTransaction === 'function') { const s = await privyEmbeddedSol.signTransaction(tx); return conn.sendRawTransaction(s.serialize(), opts || {}); }
      throw new Error('Privy wallet has no sign method');
    }
    return extSolSendTx(tx, conn, opts);
  }, [activeWalletKind, privyEmbeddedSol, extSolSendTx]);

  const ensureChain = useCallback(async (targetChainId) => {
    if (evmChainIdRef.current === targetChainId) return true;
    try { if (switchChainAsync) await switchChainAsync({ chainId: targetChainId }); else if (switchChain) switchChain({ chainId: targetChainId }); }
    catch { throw new Error('Please switch to ' + (CHAIN_NAMES[targetChainId] || 'correct chain')); }
    for (let i = 0; i < 80; i++) { if (evmChainIdRef.current === targetChainId) return true; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Chain switch did not take effect');
  }, [switchChain, switchChainAsync]);

  const initialPair = useMemo(() => {
    if (defaultFromToken || defaultToToken) {
      const ws = { solConnected, evmConnected, evmChainId };
      const pair = defaultTokenPair({ mode: modeProp, viewedToken: defaultToToken || defaultFromToken, lastFromToken: null, walletState: ws });
      return { fromToken: defaultFromToken ? normalizeToken(defaultFromToken) : pair.fromToken, toToken: defaultToToken ? normalizeToken(defaultToToken) : pair.toToken };
    }
    const last = loadLastPair();
    const ws = { solConnected, evmConnected, evmChainId };
    return defaultTokenPair({ mode: modeProp, viewedToken: null, lastFromToken: last?.from ? normalizeToken(last.from) : null, walletState: ws });
  }, []);

  const [fromToken, setFromToken] = useState(initialPair.fromToken || POPULAR_TOKENS[0]);
  const [toToken, setToToken] = useState(initialPair.toToken || POPULAR_TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [slip, setSlip] = useState(0.5);
  const userTouchedRef = useRef(false);

  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteStale, setQuoteStale] = useState(false);

  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const [pendingSwap, setPendingSwap] = useState(false);
  const [stuckSwap, setStuckSwap] = useState(false);
  const stuckRef = useRef(null);

  useEffect(() => {
    if (swapStatus === 'loading') { setStuckSwap(false); stuckRef.current = setTimeout(() => setStuckSwap(true), 30000); }
    else { if (stuckRef.current) clearTimeout(stuckRef.current); setStuckSwap(false); }
    return () => { if (stuckRef.current) clearTimeout(stuckRef.current); };
  }, [swapStatus]);

  useEffect(() => { onStatusChange?.(swapStatus); }, [swapStatus, onStatusChange]);

  const [solBalanceLamports, setSolBalanceLamports] = useState(null);
  const [solSplBalance, setSolSplBalance] = useState(null);

  const [presetsLocal, setPresetsLocal] = useState(() => presetsProp || loadPresets());
  const presets = presetsProp || presetsLocal;
  const setPresets = useCallback(p => { if (onPresetsChange) onPresetsChange(p); else { setPresetsLocal(p); savePresets(p); } }, [onPresetsChange]);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [fromSelectOpen, setFromSelectOpen] = useState(false);
  const [toSelectOpen, setToSelectOpen] = useState(false);

  const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
  const isSupported = route !== 'unsupported';
  const needsSol = route === 'okx-sol';
  const needsEvm = route === 'okx-evm';
  const hasNeededWallet = (needsSol && hasSolSigner) || (needsEvm && hasEvmSigner);
  const isNativeEvmFrom = fromToken?.chain === 'evm' && (fromToken.address || '').toLowerCase() === NATIVE_EVM;
  const requiresApproval = fromToken?.chain === 'evm' && !isNativeEvmFrom && route === 'okx-evm';

  const publicClient = usePublicClient({ chainId: fromToken?.chain === 'evm' ? fromToken.chainId : undefined });
  useEffect(() => { publicClientRef.current = publicClient; }, [publicClient]);

  const { data: evmFromBal, refetch: refetchEvmBal } = useBalance({
    address: effectiveEvmAddress, token: fromToken?.chain === 'evm' && !isNativeEvmFrom ? fromToken.address : undefined,
    chainId: fromToken?.chain === 'evm' ? fromToken.chainId : undefined,
    query: { enabled: !!effectiveEvmAddress && fromToken?.chain === 'evm' },
  });

  useEffect(() => {
    if (!publicKey || !connection) { setSolBalanceLamports(null); setSolSplBalance(null); return; }
    let c = false;
    connection.getBalance(publicKey).then(b => { if (!c) setSolBalanceLamports(b); }).catch(() => {});
    if (fromToken?.chain === 'solana' && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) })
        .then(a => { if (!c) setSolSplBalance(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); }).catch(() => {});
    } else { setSolSplBalance(null); }
    return () => { c = true; };
  }, [publicKey, connection, fromToken]);

  useEffect(() => {
    if (swapStatus !== 'success') return;
    refetchEvmBal?.();
    if (publicKey && connection && fromToken?.chain === 'solana') {
      connection.getBalance(publicKey).then(setSolBalanceLamports).catch(() => {});
      if (fromToken.mint !== WSOL_MINT) connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) }).then(a => setSolSplBalance(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0)).catch(() => {});
    }
  }, [swapStatus]);

  const [fromPriceUsd, setFromPriceUsd] = useState(null);
  const [toPriceUsd, setToPriceUsd] = useState(null);
  useEffect(() => { let c = false; fetchDsTokenPrice(fromToken).then(p => { if (!c) setFromPriceUsd(p); }); return () => { c = true; }; }, [fromToken]);
  useEffect(() => { let c = false; fetchDsTokenPrice(toToken).then(p => { if (!c) setToPriceUsd(p); }); return () => { c = true; }; }, [toToken]);

  useEffect(() => { loadOkxSolTokens().catch(() => {}); }, []);

  const fetchQuote = useCallback(async () => {
    setQuoteError('');
    if (!fromAmt || parseFloat(fromAmt) <= 0 || tokensEqual(fromToken, toToken)) { setQuote(null); setQuoteStale(false); if (tokensEqual(fromToken, toToken)) setQuoteError('Cannot swap a token for itself.'); return; }
    const fromNum = parseFloat(fromAmt);
    if (!(fromPriceUsd > 0) || !(toPriceUsd > 0)) { setQuote(null); setQuoteStale(false); return; }
    const gross = fromNum * fromPriceUsd / toPriceUsd;
    const net = gross * (1 - TOTAL_FEE);
    setQuote({ engine: 'estimate', outAmountDisplay: net.toFixed(net < 0.01 ? 8 : 6), priceImpactPct: 0, preview: true });
    setQuoteStale(false);
  }, [fromAmt, fromToken, toToken, fromPriceUsd, toPriceUsd]);

  useEffect(() => { const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS); return () => clearTimeout(t); }, [fetchQuote]);

  const fromBalanceDisplay = useMemo(() => {
    if (fromToken?.chain === 'solana') return fromToken.mint === WSOL_MINT ? (solBalanceLamports != null ? solBalanceLamports / LAMPORTS_PER_SOL : null) : solSplBalance;
    if (fromToken?.chain === 'evm' && evmFromBal) return parseFloat(evmFromBal.formatted);
    return null;
  }, [fromToken, solBalanceLamports, solSplBalance, evmFromBal]);

  const onMax = useCallback(() => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return; userTouchedRef.current = true;
    const dec = Math.min(fromToken.decimals || 6, 9);
    if (fromToken?.chain === 'solana' && fromToken.mint === WSOL_MINT) { setFromAmt(maxSafeSolBalance(solBalanceLamports).toFixed(dec)); return; }
    if (fromToken?.chain === 'solana') { setFromAmt(fromBalanceDisplay.toFixed(dec)); return; }
    setFromAmt(maxSafeAmount({ balance: fromBalanceDisplay, isNative: isNativeEvmFrom }).toFixed(dec));
  }, [fromBalanceDisplay, fromToken, solBalanceLamports, isNativeEvmFrom]);

  const applyBuyPreset = useCallback(dollars => { if (fromPriceUsd > 0) { userTouchedRef.current = true; setFromAmt((dollars / fromPriceUsd).toFixed(Math.min(fromToken.decimals || 6, 9))); } }, [fromPriceUsd, fromToken]);
  const applySellPreset = useCallback(pct => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return; userTouchedRef.current = true;
    const dec = Math.min(fromToken.decimals || 6, 9);
    let amt = fromBalanceDisplay * (pct / 100);
    if (pct === 100 && fromToken?.chain === 'solana' && fromToken.mint === WSOL_MINT) amt = maxSafeSolBalance(solBalanceLamports);
    else if (pct === 100 && isNativeEvmFrom) amt = maxSafeAmount({ balance: fromBalanceDisplay, isNative: true });
    setFromAmt(amt.toFixed(dec));
  }, [fromBalanceDisplay, fromToken, isNativeEvmFrom, solBalanceLamports]);

  const flipTokens = useCallback(() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null); setQuoteError(''); userTouchedRef.current = false; }, [fromToken, toToken]);

  const executeSwap = useCallback(async () => {
    if (!walletConnected) { setPendingSwap(true); loginPrivy?.() || onConnectWallet?.(); return; }
    if (!isSupported) { setSwapError('Pair not supported'); setSwapStatus('error'); return; }
    setSwapStatus('loading'); setSwapError(''); setSwapTx(null);
    try {
      const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);
      if (!fromAmtRaw || fromAmtRaw === '0') throw new Error('Invalid amount');

      if (route === 'okx-sol') {
        if (!publicKey) throw new Error('Connect Solana wallet');
        const swapData = await fetchOkxSolanaSwap({ fromMint: fromToken.mint, toMint: toToken.mint, amount: fromAmtRaw, slippage: slip, userWallet: publicKey.toString() });
        const tx = await buildOkxSolanaTransaction({ connection, userPubkey: publicKey, swapData });
        const sig = await sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
        setSwapTx(sig);
        connection.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight }, 'confirmed').catch(() => {});
      } else if (route === 'okx-evm') {
        if (!effectiveEvmAddress || !walletClientRef.current) throw new Error('Connect EVM wallet');
        if (evmChainId !== fromToken.chainId) await ensureChain(fromToken.chainId);
        const wc = walletClientRef.current;
        const pc = publicClientRef.current;
        if (!wc) throw new Error('Wallet not ready');

        const swapData = await fetchOkxEvmSwap({ chainId: fromToken.chainId, fromAddress: fromToken.address, toAddress: toToken.address, amount: fromAmtRaw, slippage: slip, userWallet: effectiveEvmAddress });
        const tx = swapData.tx;
        if (!tx?.to || !tx?.data) throw new Error('OKX returned no tx data');

        if (!isNativeEvmFrom) {
          try {
            const approvalData = await fetchOkxEvmApproval({ chainId: fromToken.chainId, tokenAddress: fromToken.address, amount: fromAmtRaw });
            if (approvalData?.dexContractAddress) {
              let needApprove = true;
              if (pc) {
                try {
                  const allowance = await pc.readContract({ address: fromToken.address, abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'allowance', args: [effectiveEvmAddress, approvalData.dexContractAddress] });
                  needApprove = safeBigInt(allowance) < safeBigInt(fromAmtRaw);
                } catch { needApprove = false; }
              }
              if (needApprove) {
                const approveData = approvalData.callData || ('0x095ea7b3' + approvalData.dexContractAddress.slice(2).toLowerCase().padStart(64, '0') + 'f'.repeat(64));
                const approveHash = await wc.sendTransaction({ to: fromToken.address, data: approveData, value: BigInt(0) });
                if (pc) { try { await pc.waitForTransactionReceipt({ hash: approveHash, timeout: 90000 }); } catch {} }
              }
            }
          } catch (e) { throw new Error('Approval failed: ' + (e.message || 'unknown error')); }
        }
        const hash = await wc.sendTransaction({ to: tx.to, data: tx.data, value: safeBigInt(tx.value), gas: tx.gas ? safeBigInt(tx.gas) : undefined });
        setSwapTx(hash);
      }
      saveLastPair(fromToken, toToken);
      setSwapStatus('success'); setFromAmt(''); setQuote(null); userTouchedRef.current = false;
      setTimeout(() => { setSwapStatus('idle'); setSwapTx(null); }, 6000);
    } catch (e) {
      setSwapError(e.message || 'Swap failed'); setSwapStatus('error');
      setTimeout(() => { setSwapStatus('idle'); setSwapError(''); }, 5000);
    }
  }, [walletConnected, isSupported, fromAmt, fromToken, toToken, slip, route, publicKey, sendTransaction, connection, effectiveEvmAddress, evmChainId, ensureChain, isNativeEvmFrom, loginPrivy, onConnectWallet]);

  useEffect(() => { if (walletConnected && pendingSwap) { setPendingSwap(false); executeSwap(); } }, [walletConnected, pendingSwap, executeSwap]);

  const txLink = useMemo(() => {
    if (!swapTx) return null;
    if (route === 'okx-sol') return 'https://solscan.io/tx/' + swapTx;
    const explorers = { 1: 'etherscan.io', 10: 'optimistic.etherscan.io', 56: 'bscscan.com', 137: 'polygonscan.com', 42161: 'arbiscan.io', 43114: 'snowtrace.io', 8453: 'basescan.org', 324: 'explorer.zksync.io', 5000: 'mantlescan.xyz', 81457: 'blastscan.io', 534352: 'scrollscan.com' };
    return explorers[fromToken?.chainId] ? 'https://' + explorers[fromToken.chainId] + '/tx/' + swapTx : null;
  }, [swapTx, route, fromToken]);

  const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
  const toUsdValue = quote && toPriceUsd > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;
  const toDisplay = quote ? (quote.preview ? '~' + quote.outAmountDisplay : quote.outAmountDisplay) : '0.00';
  const toColor = quote ? C.green : C.muted2;
  const showBuyPresets = fromToken && /^(SOL|ETH|BNB|POL|AVAX|USDC|USDT)$/i.test(fromToken.symbol || '');
  const showSellPresets = modeProp === 'sell';

  return (
    <div style={{ width: '100%', maxWidth: compact ? '100%' : 520, margin: '0 auto' }}>
      {!compact && (
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Swap</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Solana & 20+ EVM chains. Powered by OKX DEX.</p>
        </div>
      )}
      <div style={{ background: compact ? 'transparent' : C.card, border: compact ? 'none' : '1px solid ' + C.border, borderRadius: compact ? 0 : 18, padding: compact ? 0 : 18 }}>

        {/* Slippage */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0.1, 0.5, 1.0].map(v => <button key={v} onClick={() => setSlip(v)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent', border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border), color: slip === v ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', minHeight: 32 }}>{v}%</button>)}
            <button onClick={() => setPresetEditorOpen(true)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, marginLeft: 6, padding: 6 }}>{'\u270E'}</button>
          </div>
        </div>

        {/* Quick buy */}
        {showBuyPresets && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6 }}>QUICK BUY</div><div style={{ display: 'flex', gap: 5 }}>{presets.buy.map((amt, i) => <button key={i} onClick={() => applyBuyPreset(amt)} style={{ flex: 1, padding: '10px 4px', borderRadius: 8, border: '1px solid ' + C.border, background: C.card2, color: C.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', minHeight: 40 }}>${amt}</button>)}</div></div>}
        {showSellPresets && fromBalanceDisplay > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6 }}>QUICK SELL</div><div style={{ display: 'flex', gap: 5 }}>{presets.sell.map((pct, i) => <button key={i} onClick={() => applySellPreset(pct)} style={{ flex: 1, padding: '10px 4px', borderRadius: 8, border: '1px solid ' + C.border, background: C.card2, color: C.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', minHeight: 40 }}>{pct === 100 ? 'MAX' : pct + '%'}</button>)}</div></div>}

        {/* From */}
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span style={{ fontSize: 11, color: C.muted }}>YOU PAY</span>{fromBalanceDisplay != null && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{fmtTokenAmount(fromBalanceDisplay)}</span></span>}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setFromSelectOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card3, border: '1px solid ' + C.border, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', flexShrink: 0 }}><TokenIcon token={fromToken} size={20} /><span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{fromToken?.symbol}</span><ChainBadge token={fromToken} /></button>
            <input value={fromAmt} onChange={e => { userTouchedRef.current = true; setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" inputMode="decimal" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, color: '#fff', textAlign: 'right', outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
            {fromBalanceDisplay > 0 && <button onClick={onMax} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '6px 10px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: 'Syne, sans-serif' }}>MAX</button>}
          </div>
          {fromUsdValue > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmtUsd(fromUsdValue)}</div>}
        </div>

        {/* Flip */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}><button onClick={flipTokens} style={{ width: 40, height: 40, borderRadius: 10, background: C.card3, border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'\u21F5'}</button></div>

        {/* To */}
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span style={{ fontSize: 11, color: C.muted }}>YOU RECEIVE</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setToSelectOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card3, border: '1px solid ' + C.border, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', flexShrink: 0 }}><TokenIcon token={toToken} size={20} /><span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{toToken?.symbol}</span><ChainBadge token={toToken} /></button>
            <div style={{ flex: 1, textAlign: 'right', fontSize: 22, color: toColor, fontFamily: 'JetBrains Mono, monospace' }}>{toDisplay}</div>
          </div>
          {toUsdValue > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmtUsd(toUsdValue)}</div>}
        </div>

        {quoteError && <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red }}>{quoteError}</div>}
        {!isSupported && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)', borderRadius: 8, fontSize: 12, color: '#ff9500' }}>Pair not supported. Cross-chain coming soon.</div>}

        {quote && fromAmt && <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>{[['Platform fee', fromUsdValue > 0 ? fmtUsd(fromUsdValue * PLATFORM_FEE) : (PLATFORM_FEE * 100) + '%'], ['Anti-MEV', (SAFETY_FEE * 100) + '%']].map(i => <div key={i[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}><span style={{ color: C.muted }}>{i[0]}</span><span style={{ color: C.text }}>{i[1]}</span></div>)}</div>}
        {swapError && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red }}>{swapError}</div>}

        {!walletConnected ? <button onClick={() => { setPendingSwap(true); loginPrivy?.() || onConnectWallet?.(); }} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52 }}>Sign in to Swap</button>
        : !hasNeededWallet ? <button onClick={() => { loginPrivy?.() || onConnectWallet?.(); }} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52 }}>Connect {needsSol ? 'Solana' : 'EVM'} wallet</button>
        : <button onClick={executeSwap} disabled={swapStatus === 'loading' || !fromAmt} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : swapStatus === 'error' ? 'rgba(255,59,107,.2)' : !fromAmt ? C.card2 : C.buyGrad, color: !fromAmt ? C.muted2 : '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer', minHeight: 52 }}>{swapStatus === 'loading' ? 'Confirming...' : swapStatus === 'success' ? 'Done!' : swapStatus === 'error' ? 'Retry' : !fromAmt ? 'Enter amount' : 'Swap ' + (fromToken?.symbol || '') + ' → ' + (toToken?.symbol || '')}</button>}
        {swapStatus === 'loading' && stuckSwap && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)', borderRadius: 10, fontSize: 11, color: C.muted }}><button onClick={() => { setSwapStatus('idle'); setSwapError(''); }} style={{ background: 'transparent', border: '1px solid ' + C.red, color: C.red, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>Reset</button></div>}
        {swapTx && swapStatus === 'success' && txLink && <a href={txLink} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}>View transaction</a>}
        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>Non-custodial · Powered by OKX DEX</p>
      </div>
      <TokenSelectModal open={fromSelectOpen} onClose={() => setFromSelectOpen(false)} onSelect={t => { setFromToken(t); setQuote(null); setQuoteError(''); }} />
      <TokenSelectModal open={toSelectOpen} onClose={() => setToSelectOpen(false)} onSelect={t => { setToToken(t); setQuote(null); setQuoteError(''); }} />
    </div>
  );
}
