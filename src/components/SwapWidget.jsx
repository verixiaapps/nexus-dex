/**
 * NEXUS DEX -- Unified Swap Widget
 *
 * Single source of truth for buy / sell / swap across the entire app.
 * Embeds in: home Swap tab, TokenDetail buy/sell, NewLaunches buy/sell,
 *            Markets buy/sell, Portfolio sell, Send (uses sub-pieces).
 *
 * Behavior contract (locked):
 *  1. ONE user signature per action. Approval + swap + fee bundled.
 *  2. ONE quote shown to user. Internal route picker is silent.
 *  3. Header network selector = DESTINATION chain. Source auto-picks.
 *  4. Cross-chain works for any pair. LiFi primary, multi-hop fallback.
 *  5. User stays on swap.verixiaapps.com. No external redirects.
 *  6. Buy mode:  from = native of source chain, to = the token.
 *     Sell mode: from = the token, to = native of header chain.
 *  7. Quick-buy presets ($) + Sell presets (%) appear for every token.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useBalance, useSwitchChain } from 'wagmi';
import {
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

/* ============================================================================
 * CONSTANTS
 * ========================================================================= */

// Fee wallets (revenue collection)
const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const EVM_FEE_WALLET = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';

// Fee structure (locked: 5% same-chain, 8% cross-chain)
const PLATFORM_FEE = 0.03;       // base platform fee
const SAFETY_FEE   = 0.02;       // anti-MEV / safety
const CROSS_FEE    = 0.03;       // additional cross-chain bridging fee
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;          // 0.05
const TOTAL_FEE_CC = TOTAL_FEE + CROSS_FEE;              // 0.08
const LIFI_FEE     = TOTAL_FEE_CC;                       // sent to LiFi as integrator fee
const LIFI_INTEGRATOR = 'nexus-dex';

// Address constants
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WSOL_MINT  = 'So11111111111111111111111111111111111111112';

// Solana network defaults
const SOL_RESERVE_LAMPORTS = 5_000_000;   // 0.005 SOL kept aside for tx fees + ATA rent
const SOL_MIN_FOR_SWAP     = 3_000_000;   // 0.003 SOL minimum to even attempt a swap

// EVM native reserve (in wei) -- keeps a small native balance for gas after MAX swap
const EVM_NATIVE_RESERVE_PCT = 0.005;     // 0.5% of native balance reserved for gas

// Quote engine timeouts (ms)
const QUOTE_DEBOUNCE_MS = 200;
const QUOTE_TIMEOUT_MS  = 12_000;

// Chain IDs that 0x supports (for same-chain EVM swaps with Permit2)
const OX_CHAIN_IDS = new Set([
  1, 10, 56, 100, 137, 146, 250, 252, 255, 480, 1135, 5000, 8453, 9745,
  34443, 42161, 42220, 43114, 57073, 59144, 80094, 81457, 130, 143, 534352,
  2741, 999, 4217,
]);

// Display names for chain badges and labels
const CHAIN_NAMES = {
  1: 'Ethereum', 10: 'Optimism', 25: 'Cronos', 56: 'BNB Chain', 100: 'Gnosis',
  130: 'Unichain', 137: 'Polygon', 143: 'Monad', 146: 'Sonic', 250: 'Fantom',
  252: 'Fraxtal', 255: 'Kroma', 288: 'Boba', 324: 'zkSync Era', 480: 'World Chain',
  747: 'Flow', 1116: 'Core', 1135: 'Lisk', 1284: 'Moonbeam', 1329: 'SEI',
  2020: 'Ronin', 2222: 'Kava', 2741: 'Abstract', 5000: 'Mantle', 8453: 'Base',
  34443: 'Mode', 42161: 'Arbitrum', 42220: 'Celo', 43111: 'Hemi', 43114: 'Avalanche',
  48900: 'Zircuit', 57073: 'Ink', 59144: 'Linea', 60808: 'BOB', 80094: 'Berachain',
  81457: 'Blast', 200901: 'Bitlayer', 534352: 'Scroll', 6342: 'MegaETH',
  321: 'KCC', 360: 'Shape', 33139: 'ApeChain', 167000: 'Taiko', 7777777: 'Zora',
  122: 'Fuse', 1313161554: 'Aurora', 1088: 'Metis', 14: 'Flare',
  9745: 'PlasmaChain', 999: 'HyperEVM', 4217: 'Yala',
};

// Native token symbol per chain (for default-token resolution)
const NATIVE_SYMBOL = {
  1: 'ETH', 10: 'ETH', 8453: 'ETH', 42161: 'ETH', 59144: 'ETH', 534352: 'ETH',
  324: 'ETH', 5000: 'MNT', 81457: 'ETH', 34443: 'ETH', 130: 'ETH', 57073: 'ETH',
  60808: 'ETH', 2741: 'ETH', 480: 'ETH', 360: 'ETH', 6342: 'ETH', 1135: 'ETH',
  43111: 'ETH', 167000: 'ETH', 7777777: 'ETH', 252: 'ETH', 255: 'ETH', 48900: 'ETH',
  56: 'BNB', 137: 'POL', 43114: 'AVAX', 250: 'FTM', 100: 'xDAI', 25: 'CRO',
  1284: 'GLMR', 42220: 'CELO', 1329: 'SEI', 2020: 'RON', 1116: 'CORE',
  146: 'S', 80094: 'BERA', 33139: 'APE', 747: 'FLOW', 2222: 'KAVA',
  288: 'ETH', 122: 'FUSE', 321: 'KCS', 200901: 'BTC', 143: 'MON',
  1313161554: 'ETH', 1088: 'METIS', 14: 'FLR', 9745: 'XPL', 999: 'HYPE', 4217: 'YALA',
};

// Stablecoin USDC addresses per chain (for default to-token in swap mode)
const USDC_BY_CHAIN = {
  1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10:    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  137:   '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  324:   '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4',
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
};
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Default Quick Buy preset dollar amounts (loaded/saved from localStorage)
const DEFAULT_BUY_PRESETS  = [10, 25, 50, 100, 250];
const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];   // percentages
const PRESETS_LS_KEY       = 'nexus_presets_v1';

// LocalStorage keys
const HEADER_CHAIN_LS_KEY  = 'nexus_header_chain_v1';

// LiFi token metadata cache (single-flight)
let _lifiTokensCache    = null;
let _lifiTokensInflight = null;

// Theme (matches existing app)
const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad:  'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
};

/* ============================================================================
 * POPULAR TOKENS -- used as defaults / fallbacks. Real lists come from props.
 * ========================================================================= */

const POPULAR_TOKENS = [
  // Solana
  { mint: WSOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: USDC_SOLANA, symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },

  // EVM natives (one per major chain)
  { address: NATIVE_EVM, chainId: 1,     symbol: 'ETH',  name: 'Ethereum',       decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 8453,  symbol: 'ETH',  name: 'ETH (Base)',     decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH',  name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 10,    symbol: 'ETH',  name: 'ETH (Optimism)', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 56,    symbol: 'BNB',  name: 'BNB',            decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
  { address: NATIVE_EVM, chainId: 137,   symbol: 'POL',  name: 'Polygon',        decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
  { address: NATIVE_EVM, chainId: 43114, symbol: 'AVAX', name: 'Avalanche',      decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png' },

  // EVM USDCs (major chains)
  { address: USDC_BY_CHAIN[1],     chainId: 1,     symbol: 'USDC', name: 'USDC (ETH)',      decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: USDC_BY_CHAIN[8453],  chainId: 8453,  symbol: 'USDC', name: 'USDC (Base)',     decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: USDC_BY_CHAIN[42161], chainId: 42161, symbol: 'USDC', name: 'USDC (Arbitrum)', decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
];

/* ============================================================================
 * TYPE GUARDS / VALIDATORS
 * ========================================================================= */

const isSol = (t) => !!(t && t.chain === 'solana');
const isEvm = (t) => !!(t && t.chain === 'evm');

function isValidSolMint(s) {
  return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function isValidEvmAddr(s) {
  return !!s && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function tokensEqual(a, b) {
  if (!a || !b) return false;
  if (isSol(a) && isSol(b)) return a.mint === b.mint;
  if (isEvm(a) && isEvm(b)) return (
    a.chainId === b.chainId &&
    (a.address || '').toLowerCase() === (b.address || '').toLowerCase()
  );
  return false;
}

/* ============================================================================
 * FORMATTING HELPERS
 * ========================================================================= */

function fmtUsd(n, decimals = 2) {
  if (n == null || isNaN(n)) return '-';
  const v = Number(n);
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: decimals });
  if (v >= 1)    return '$' + v.toFixed(decimals);
  if (v > 0)     return '$' + v.toFixed(6);
  return '$0.00';
}

function fmtTokenAmount(n, decimals = 4) {
  if (n == null || isNaN(n)) return '0';
  const v = Number(n);
  if (v >= 1e9)  return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6)  return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toFixed(decimals);
}

function shortAddr(addr, head = 4, tail = 4) {
  if (!addr || addr.length < head + tail) return addr || '';
  return addr.slice(0, head) + '...' + addr.slice(-tail);
}

/* ============================================================================
 * TOKEN NORMALIZATION -- convert any "coin" shape to a strict Token object
 *
 * Inputs we may see:
 *   - CoinGecko coin: { id, symbol, name, image, current_price, ... }
 *     where id is "ethereum" / "solana" -- NOT an on-chain address.
 *   - Solana token from Jupiter:  { mint, symbol, name, logoURI, decimals }
 *   - EVM token from LiFi:        { address, chainId, symbol, name, logoURI, decimals }
 *   - EVM token from Portfolio:   { contractAddress, chainId, tokenSymbol, ... }
 *   - User-pasted contract:       bare address string
 *
 * Output strict Token shape:
 *   Solana: { chain:'solana', mint, symbol, name, decimals, logoURI }
 *   EVM:    { chain:'evm', address, chainId, symbol, name, decimals, logoURI }
 * ========================================================================= */

function normalizeToken(input, opts = {}) {
  if (!input) return null;
  const { defaultChainId = 1 } = opts;

  // Already a strict token
  if (isSol(input) && input.mint) return input;
  if (isEvm(input) && input.address && input.chainId) return input;

  const logoURI = input.logoURI || input.image || input.thumbnail || null;
  const symbol  = input.symbol || input.tokenSymbol || 'TOKEN';
  const name    = input.name || input.tokenName || symbol;

  // Direct EVM address
  const evmAddr = input.address || input.contractAddress || null;
  if (evmAddr && isValidEvmAddr(evmAddr)) {
    return {
      chain: 'evm',
      address: evmAddr,
      chainId: input.chainId || defaultChainId,
      symbol,
      name,
      decimals: typeof input.decimals === 'number'      ? input.decimals
              : typeof input.tokenDecimals === 'number' ? input.tokenDecimals
              : 18,
      logoURI,
    };
  }

  // Direct Solana mint
  const solMint = input.mint || (input.isSolanaToken ? input.id : null);
  if (solMint && isValidSolMint(solMint)) {
    return {
      chain: 'solana',
      mint: solMint,
      symbol,
      name,
      decimals: typeof input.decimals === 'number' ? input.decimals : 6,
      logoURI,
    };
  }

  // CoinGecko-style coin where id is a string slug ("solana", "ethereum") -- try by symbol
  if (input.symbol) {
    const lc = input.symbol.toLowerCase();
    const found = POPULAR_TOKENS.find((t) => t.symbol.toLowerCase() === lc);
    if (found) return found;
  }

  return null;
}

/* ============================================================================
 * DEFAULT TOKEN RESOLVERS
 *
 * For a given "destination chain" (header selector) + "viewed token" (if any) + "mode",
 * decide what from-token and to-token should be.
 *
 *  Mode 'buy'  -> user wants to acquire viewedToken
 *  Mode 'sell' -> user wants to dispose of viewedToken
 *  Mode 'swap' -> free-form
 * ========================================================================= */

function nativeOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find((t) => t.mint === WSOL_MINT);
  return POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === chainId && t.address === NATIVE_EVM)
      || POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === 1       && t.address === NATIVE_EVM);
}

function usdcOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find((t) => t.mint === USDC_SOLANA);
  const addr = USDC_BY_CHAIN[chainId];
  if (!addr) return null;
  return POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === chainId && (t.address || '').toLowerCase() === addr.toLowerCase());
}

function chainOfToken(t) {
  if (isSol(t)) return 'solana';
  if (isEvm(t)) return t.chainId;
  return null;
}

function defaultTokenPair({ mode, viewedToken, headerChain, lastFromToken }) {
  const viewed = viewedToken
    ? normalizeToken(viewedToken, { defaultChainId: headerChain === 'solana' ? 1 : headerChain })
    : null;

  if (mode === 'buy' && viewed) {
    const tokenChain = chainOfToken(viewed);
    const fromToken = lastFromToken || nativeOfChain(tokenChain) || nativeOfChain(headerChain) || POPULAR_TOKENS[0];
    return { fromToken, toToken: viewed };
  }
  if (mode === 'sell' && viewed) {
    const tokenChain = chainOfToken(viewed);
    const toToken = usdcOfChain(headerChain) || usdcOfChain(tokenChain) || nativeOfChain(headerChain) || POPULAR_TOKENS[1];
    return { fromToken: viewed, toToken };
  }
  // mode === 'swap' or no viewed token
  const fromToken = lastFromToken || nativeOfChain(headerChain) || POPULAR_TOKENS[0];
  const toToken   = usdcOfChain(headerChain)   || POPULAR_TOKENS[1];
  return { fromToken, toToken };
}

/* ============================================================================
 * ROUTE PICKER -- decides Jupiter / 0x / LiFi / multi-hop, silently.
 * Never shown to user.
 * ========================================================================= */

function pickRoute(from, to) {
  if (!from || !to) return 'lifi';
  // Same-chain Solana -> Jupiter
  if (isSol(from) && isSol(to)) return 'jupiter';
  // Same-chain EVM with 0x support -> 0x Permit2
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId && OX_CHAIN_IDS.has(from.chainId)) return '0x';
  // Anything else -> LiFi (cross-chain or unsupported same-chain EVM)
  return 'lifi';
}

/* ============================================================================
 * LIFI HELPERS
 * ========================================================================= */

function lifiChainParam(t) {
  if (isSol(t)) return 'SOL';
  return String(t.chainId);
}
function lifiTokenParam(t) {
  if (isSol(t)) return t.mint;
  return t.address;
}

async function fetchLifiTokens() {
  if (_lifiTokensCache) return _lifiTokensCache;
  if (_lifiTokensInflight) return _lifiTokensInflight;
  _lifiTokensInflight = fetch('https://li.quest/v1/tokens?chainTypes=EVM,SVM')
    .then((r) => (r.ok ? r.json() : { tokens: {} }))
    .catch(() => ({ tokens: {} }))
    .then((data) => {
      _lifiTokensCache = data;
      _lifiTokensInflight = null;
      return data;
    });
  return _lifiTokensInflight;
}

async function fetchLifiQuote({ fromToken, toToken, fromAmtRaw, fromAddress, toAddress, slip, signal }) {
  const params = new URLSearchParams({
    fromChain:  lifiChainParam(fromToken),
    toChain:    lifiChainParam(toToken),
    fromToken:  lifiTokenParam(fromToken),
    toToken:    lifiTokenParam(toToken),
    fromAmount: String(fromAmtRaw),
    fromAddress,
    toAddress:  toAddress || fromAddress,
    slippage:   String(slip / 100),
    fee:        String(LIFI_FEE),
    integrator: LIFI_INTEGRATOR,
  });
  const res = await fetch('https://li.quest/v1/quote?' + params.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'LiFi quote failed');
  if (!data.estimate || !data.estimate.toAmount) throw new Error('No cross-chain route');
  return data;
}

/* ============================================================================
 * 0X HELPERS (Permit2 -- single-signature swap+approval)
 *
 * Calls go through our /api/0x proxy so the API key never touches the browser.
 * ========================================================================= */

async function fetchOxQuote({ chainId, sellToken, buyToken, sellAmount, taker, slipBps, feeRecipient, feeToken, signal }) {
  // Use Permit2 endpoint -- user signs an EIP-712 permit (off-chain, no gas, no popup-2)
  // and the resulting signed quote can be executed in a single on-chain tx that includes the swap.
  const qs = new URLSearchParams({
    chainId:               String(chainId),
    sellToken:             (sellToken || '').toLowerCase(),
    buyToken:              (buyToken  || '').toLowerCase(),
    sellAmount:            String(sellAmount),
    taker:                 taker || '',
    slippageBps:           String(slipBps),
    swapFeeBps:            String(Math.round(LIFI_FEE * 10000)), // 0x expects bps; using same fee bps as LiFi
    swapFeeRecipient:      feeRecipient,
    swapFeeToken:          (feeToken || '').toLowerCase(),
    tradeSurplusRecipient: feeRecipient,
  });
  const res = await fetch('/api/0x/swap/permit2/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '0x quote failed');
  if (!data.buyAmount) throw new Error('0x: no buyAmount in response');
  return data;
}

/* ============================================================================
 * JUPITER HELPERS
 *
 * These hit api.jup.ag directly (read-only price/quote endpoints, no key needed
 * for v1 quote, key for higher rate limits goes via x-api-key header).
 * ========================================================================= */

async function fetchJupiterQuote({ inputMint, outputMint, amountRaw, slipBps, signal }) {
  const qs = new URLSearchParams({
    inputMint,
    outputMint,
    amount:           String(amountRaw),
    slippageBps:      String(slipBps),
    onlyDirectRoutes: 'false',
  });
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.REACT_APP_JUPITER_API_KEY1) headers['x-api-key'] = process.env.REACT_APP_JUPITER_API_KEY1;
  const res = await fetch('https://api.jup.ag/swap/v1/quote?' + qs.toString(), { headers, signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Jupiter quote failed');
  if (!data.outAmount) throw new Error('Jupiter: no route');
  return data;
}

async function fetchJupiterSwapTx({ quoteResponse, userPublicKey, signal }) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.REACT_APP_JUPITER_API_KEY1) headers['x-api-key'] = process.env.REACT_APP_JUPITER_API_KEY1;
  const res = await fetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol:          true,
      dynamicComputeUnitLimit:   true,
      prioritizationFeeLamports: 'auto',
    }),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.swapTransaction) throw new Error(data.error || 'Jupiter swap tx build failed');
  return data;
}

/* ============================================================================
 * FEE CALCULATION
 *
 * For Solana same-chain swaps we deduct the platform fee in SOL
 * (converted from USD via current SOL price) and append a SystemProgram.transfer
 * to the swap's instruction list -- bundled in the same single signature.
 *
 * For EVM 0x swaps the fee is part of the 0x quote (swapFeeBps + swapFeeRecipient),
 * so 0x already takes care of routing the fee to our wallet.
 *
 * For LiFi swaps the fee is part of the LiFi quote (fee param + integrator),
 * also bundled.
 * ========================================================================= */

function calcSolFeeLamports({ fromAmtTokens, fromTokenSymbol, fromTokenPriceUsd, solPriceUsd, isCrossChain }) {
  const feeRate = isCrossChain ? TOTAL_FEE_CC : TOTAL_FEE;
  const tradeUsd = fromAmtTokens * (fromTokenPriceUsd || 0);

  let lamports;
  if (tradeUsd > 0 && solPriceUsd > 0) {
    lamports = Math.round((tradeUsd * feeRate / solPriceUsd) * LAMPORTS_PER_SOL);
  } else if (fromTokenSymbol === 'SOL') {
    // direct: take % of SOL amount itself
    lamports = Math.round(fromAmtTokens * feeRate * LAMPORTS_PER_SOL);
  } else {
    // can't price the trade -- fall back to a small fixed minimum
    lamports = 50_000;
  }
  return Math.max(lamports, 50_000); // never less than 0.00005 SOL
}

/* ============================================================================
 * PRESET HELPERS (localStorage)
 * ========================================================================= */

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
    const p = JSON.parse(raw);
    return {
      buy:  Array.isArray(p.buy)  && p.buy.length  >= 3 ? p.buy  : DEFAULT_BUY_PRESETS,
      sell: Array.isArray(p.sell) && p.sell.length >= 3 ? p.sell : DEFAULT_SELL_PRESETS,
    };
  } catch (_) { return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS }; }
}
function savePresets(p) {
  try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch (_) {}
}

function loadHeaderChain() {
  try {
    const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY);
    if (!raw) return 1; // Default to Ethereum
    const v = JSON.parse(raw);
    if (v === 'solana') return 'solana';
    if (typeof v === 'number') return v;
    return 1;
  } catch (_) { return 1; }
}
function saveHeaderChain(c) {
  try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch (_) {}
}

/* ============================================================================
 * MAX-SAFE AMOUNT CALCULATION
 *
 * The old bug: TOTAL_FEE (0.05) was subtracted as if it were a SOL amount.
 * Correct: subtract a proportional fee % AND a tx-cost reserve.
 * ========================================================================= */

function maxSafeAmount({ balance, isNative, isCrossChain }) {
  if (!balance || balance <= 0) return 0;
  const feeRate = isCrossChain ? TOTAL_FEE_CC : TOTAL_FEE;

  if (isNative) {
    // For native tokens (SOL, ETH, BNB...) we have to leave gas/fee headroom.
    //   1) Keep 0.5% of balance for gas
    //   2) Subtract our platform fee % (will be deducted in the same tx)
    const afterGas = balance * (1 - EVM_NATIVE_RESERVE_PCT);
    const afterFee = afterGas * (1 - feeRate);
    return Math.max(0, afterFee);
  }
  // Non-native: full balance is swap-eligible. Fee is deducted from output side.
  return balance;
}

function maxSafeSolBalance(lamports) {
  if (!lamports) return 0;
  const usable = Math.max(0, lamports - SOL_RESERVE_LAMPORTS);
  return usable / LAMPORTS_PER_SOL;
}

/* ============================================================================
 * TOKEN SELECT MODAL
 *
 * Searches across:
 *   - jupiterTokens prop (Solana, big list)
 *   - LiFi tokens (EVM, lazy fetched on first search)
 *   - POPULAR_TOKENS (built-in fallback)
 *   - Direct contract paste (Solana mint or EVM address)
 *
 * For pasted EVM addresses we default chainId to the headerChain rather than 1.
 * ========================================================================= */

function ChainBadge({ token }) {
  if (!token) return null;
  const label = isSol(token) ? 'SOL' : (CHAIN_NAMES[token.chainId] || 'EVM');
  const color = isSol(token) ? '#9945ff' : '#627eea';
  return (
    <span style={{
      fontSize: 9, color, background: color + '22', border: '1px solid ' + color + '44',
      borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700,
    }}>{label}</span>
  );
}

function TokenIcon({ token, size = 32 }) {
  const [errored, setErrored] = useState(false);
  if (token && token.logoURI && !errored) {
    return (
      <img
        src={token.logoURI}
        alt={token.symbol || ''}
        style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }}
        onError={() => setErrored(true)}
      />
    );
  }
  const ch = (token && token.symbol) ? token.symbol.charAt(0).toUpperCase() : '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, color: C.accent,
    }}>{ch}</div>
  );
}

function TokenSelectModal({ open, onClose, onSelect, jupiterTokens, headerChain }) {
  const [q, setQ] = useState('');
  const [contractInput, setContractInput] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [evmIndex, setEvmIndex] = useState([]);

  // Lazy-load EVM token index from LiFi on open
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    fetchLifiTokens().then((data) => {
      if (aborted || !data || !data.tokens) return;
      const arr = [];
      Object.values(data.tokens).forEach((chainTokens) => {
        chainTokens.forEach((t) => {
          if (!t.symbol || !t.address || !t.chainId) return;
          arr.push({
            chain: 'evm',
            address: t.address,
            chainId: Number(t.chainId),
            symbol: t.symbol,
            name: t.name || t.symbol,
            decimals: t.decimals || 18,
            logoURI: t.logoURI || null,
          });
        });
      });
      setEvmIndex(arr);
    });
    return () => { aborted = true; };
  }, [open]);

  // Solana token list (use full Jupiter list when available)
  const solTokens = useMemo(() => {
    if (jupiterTokens && jupiterTokens.length > 0) {
      return jupiterTokens.map((t) => ({
        chain: 'solana',
        mint: t.mint,
        symbol: t.symbol,
        name: t.name || t.symbol,
        decimals: t.decimals || 6,
        logoURI: t.logoURI || null,
      }));
    }
    return POPULAR_TOKENS.filter((t) => isSol(t));
  }, [jupiterTokens]);

  // Search effect
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults([]); return; }
    const ql = trimmed.toLowerCase();

    const sol = solTokens.filter((t) =>
      (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
      (t.name   && t.name.toLowerCase().includes(ql)) ||
      (t.mint   && t.mint.toLowerCase() === ql)
    ).slice(0, 50);

    const evmFromIndex = evmIndex.filter((t) =>
      (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
      (t.name   && t.name.toLowerCase().includes(ql)) ||
      ((CHAIN_NAMES[t.chainId] || '').toLowerCase().includes(ql))
    ).slice(0, 80);

    const evmFromPopular = POPULAR_TOKENS.filter((t) =>
      isEvm(t) && (
        (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
        (t.name   && t.name.toLowerCase().includes(ql))
      )
    );

    const evmCombined = [];
    const seen = new Set();
    [...evmFromPopular, ...evmFromIndex].forEach((t) => {
      const key = (t.address || '').toLowerCase() + '-' + t.chainId;
      if (!seen.has(key)) { seen.add(key); evmCombined.push(t); }
    });

    setSearchResults([...sol, ...evmCombined]);
  }, [q, solTokens, evmIndex]);

  // Contract paste lookup
  const lookupContract = useCallback(async (addr) => {
    const trimmed = addr.trim();
    if (!isValidSolMint(trimmed) && !isValidEvmAddr(trimmed)) {
      setContractToken(null); return;
    }
    setContractLoading(true);
    try {
      if (isValidSolMint(trimmed)) {
        // Try jupiter token list first
        const cached = solTokens.find((t) => t.mint === trimmed);
        if (cached) { setContractToken(cached); }
        else {
          const r = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + trimmed);
          if (r.ok) {
            const d = await r.json();
            setContractToken({
              chain: 'solana', mint: d.address, symbol: d.symbol, name: d.name,
              decimals: d.decimals || 6, logoURI: d.logoURI,
            });
          } else {
            setContractToken({
              chain: 'solana', mint: trimmed, symbol: shortAddr(trimmed, 4, 4),
              name: 'Custom Token', decimals: 6, logoURI: null,
            });
          }
        }
      } else {
        // EVM address -- default chainId from header (correct fix for the old chainId:1 bug)
        const chainId = headerChain === 'solana' ? 1 : headerChain;
        // Try LiFi index for symbol/decimals
        const found = evmIndex.find((t) =>
          (t.address || '').toLowerCase() === trimmed.toLowerCase() && t.chainId === chainId
        );
        if (found) { setContractToken(found); }
        else {
          setContractToken({
            chain: 'evm', address: trimmed, chainId,
            symbol: shortAddr(trimmed, 4, 4),
            name: 'Custom EVM Token (' + (CHAIN_NAMES[chainId] || 'EVM') + ')',
            decimals: 18, logoURI: null,
          });
        }
      }
    } catch (_) {
      setContractToken(null);
    }
    setContractLoading(false);
  }, [solTokens, evmIndex, headerChain]);

  const close = () => {
    setQ(''); setContractInput(''); setContractToken(null); setSearchResults([]);
    onClose();
  };

  const display = q.trim() ? searchResults : POPULAR_TOKENS;

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
        borderRadius: 18, width: '94vw', maxWidth: 440, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
              <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens -- DYOR</div>
            </div>
            <button onClick={close} aria-label="Close" style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
              fontSize: 22, lineHeight: 1, padding: 0,
            }}>&times;</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, symbol, chain..."
            style={{
              width: '100%', background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13,
              outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8,
            }}
          />
          <input
            value={contractInput}
            onChange={(e) => setContractInput(e.target.value)}
            onBlur={() => { if (contractInput) lookupContract(contractInput); }}
            placeholder="Or paste any Solana or EVM contract address..."
            style={{
              width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
              borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12,
              outline: 'none', fontFamily: 'monospace',
            }}
          />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
          {contractToken && !contractLoading && (
            <div
              onClick={() => { onSelect(contractToken); close(); }}
              style={{
                marginTop: 8, padding: '10px 12px',
                background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)',
                borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <TokenIcon token={contractToken} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</span>
                  <ChainBadge token={contractToken} />
                </div>
                <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {contractToken.name}
                </div>
              </div>
              <div style={{ color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!q.trim() && (
            <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              POPULAR TOKENS
            </div>
          )}
          {q.trim() && searchResults.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found.
              <div style={{ fontSize: 11, marginTop: 4 }}>Paste the contract address above.</div>
            </div>
          )}
          {display.map((t, i) => {
            const key = (t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i;
            return (
              <div
                key={key}
                onClick={() => { onSelect(t); close(); }}
                style={{
                  padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <TokenIcon token={t} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</span>
                    <ChainBadge token={t} />
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * PRESET EDITOR
 * ========================================================================= */

function PresetEditor({ open, onClose, presets, onSave }) {
  const [buyVals,  setBuyVals]  = useState(presets.buy.map(String));
  const [sellVals, setSellVals] = useState(presets.sell.map(String));

  useEffect(() => {
    if (!open) return;
    setBuyVals(presets.buy.map(String));
    setSellVals(presets.sell.map(String));
  }, [open, presets]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 599, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 600, background: C.card, border: '1px solid ' + C.borderHi,
        borderRadius: 18, padding: 20, width: '92vw', maxWidth: 380,
        boxShadow: '0 24px 80px rgba(0,0,0,.95)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Edit Presets</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
            fontSize: 24, padding: 0, lineHeight: 1,
          }}>&times;</button>
        </div>

        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
          QUICK BUY ($)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {buyVals.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 12, width: 48, flexShrink: 0 }}>Slot {i + 1}</span>
              <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.muted }}>$</span>
                <input
                  value={v}
                  onChange={(e) => {
                    const nv = e.target.value.replace(/[^0-9.]/g, '');
                    setBuyVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                  }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none', width: '100%' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
          QUICK SELL (%)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {sellVals.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 12, width: 48, flexShrink: 0 }}>Slot {i + 1}</span>
              <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  value={v}
                  onChange={(e) => {
                    const nv = e.target.value.replace(/[^0-9.]/g, '');
                    setSellVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                  }}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none', width: '100%' }}
                />
                <span style={{ color: C.muted }}>%</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border,
            color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
          <button
            onClick={() => {
              const buy  = buyVals.map((v) => parseFloat(v) || 0).filter((v) => v > 0);
              const sell = sellVals.map((v) => parseFloat(v) || 0).filter((v) => v > 0 && v <= 100);
              while (buy.length  < 3) buy.push(25);
              while (sell.length < 3) sell.push(50);
              const next = { buy: buy.slice(0, 5), sell: sell.slice(0, 4) };
              onSave(next);
              onClose();
            }}
            style={{
              flex: 2, padding: 12, borderRadius: 10, background: C.buyGrad, border: 'none',
              color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, cursor: 'pointer', fontSize: 13,
            }}>Save</button>
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * MAIN SWAP WIDGET
 *
 * Props:
 *   coins              -- CoinGecko market data (used for USD pricing)
 *   jupiterTokens      -- Solana token list
 *   onConnectWallet    -- opens app's wallet modal
 *   isConnected        -- boolean (passed for early signal, but we double-check
 *                         wagmi/solana hooks ourselves)
 *   defaultFromToken   -- optional, used by TradeDrawer to seed buy/sell mode
 *   defaultToToken     -- optional, used by TradeDrawer
 *   compact            -- boolean, hides the title block when true
 *   headerChain        -- current header network selector (number or 'solana')
 *   onHeaderChainChange-- optional callback to bump header when user changes
 *                         from-token to a different chain
 *   mode               -- 'swap' | 'buy' | 'sell' (default 'swap')
 *   presets            -- { buy:[], sell:[] } from parent (or loaded internally)
 *   onPresetsChange    -- bubble preset changes up to parent for global sync
 * ========================================================================= */

export default function SwapWidget({
  coins = [],
  jupiterTokens = [],
  jupiterLoading,
  onGoToToken,
  onConnectWallet,
  isConnected: _isConnectedProp,
  defaultFromToken,
  defaultToToken,
  compact = false,
  headerChain: headerChainProp,
  onHeaderChainChange,
  mode: modeProp = 'swap',
  presets: presetsProp,
  onPresetsChange,
}) {
  /* -- Wallet hooks -- */
  const { publicKey, sendTransaction, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const walletConnected = solConnected || evmConnected;

  /* -- Header chain (controlled from parent or fallback to localStorage) -- */
  const [headerChainLocal, setHeaderChainLocal] = useState(() =>
    headerChainProp != null ? headerChainProp : loadHeaderChain()
  );
  const headerChain = headerChainProp != null ? headerChainProp : headerChainLocal;
  const setHeaderChain = useCallback((c) => {
    if (onHeaderChainChange) onHeaderChainChange(c);
    else { setHeaderChainLocal(c); saveHeaderChain(c); }
  }, [onHeaderChainChange]);

  /* -- Token state -- */
  const initialPair = useMemo(() => {
    if (defaultFromToken || defaultToToken) {
      return {
        fromToken: defaultFromToken ? normalizeToken(defaultFromToken) : nativeOfChain(headerChain),
        toToken:   defaultToToken   ? normalizeToken(defaultToToken)   : usdcOfChain(headerChain),
      };
    }
    return defaultTokenPair({ mode: modeProp, viewedToken: null, headerChain, lastFromToken: null });
  }, []); // intentional: only on mount; updates handled by separate effects

  const [fromToken, setFromToken] = useState(initialPair.fromToken || POPULAR_TOKENS[0]);
  const [toToken,   setToToken]   = useState(initialPair.toToken   || POPULAR_TOKENS[1]);

  /* -- Amount + slippage state -- */
  const [fromAmt, setFromAmt] = useState('');
  const [slip, setSlip] = useState(0.5);

  /* -- Quote state -- */
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const quoteAbortRef = useRef(null);

  /* -- Swap execution state -- */
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');

  /* -- Balance state -- */
  const [solBalanceLamports, setSolBalanceLamports] = useState(null);
  const [solSplBalance, setSolSplBalance] = useState(null);

  /* -- Cross-chain destination address (when user receives on a chain
        their connected wallet doesn't cover) -- */
  const [customDestAddr, setCustomDestAddr] = useState('');

  /* -- Preset state -- */
  const [presetsLocal, setPresetsLocal] = useState(() => presetsProp || loadPresets());
  const presets = presetsProp || presetsLocal;
  const setPresets = useCallback((p) => {
    if (onPresetsChange) onPresetsChange(p);
    else { setPresetsLocal(p); savePresets(p); }
  }, [onPresetsChange]);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  /* -- Token select modals -- */
  const [fromSelectOpen, setFromSelectOpen] = useState(false);
  const [toSelectOpen,   setToSelectOpen]   = useState(false);

  /* -- Derived values -- */
  const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
  const isCrossChain = route === 'lifi';

  const isEvmFrom = isEvm(fromToken);
  const isNativeEvmFrom = isEvmFrom && (fromToken.address || '').toLowerCase() === NATIVE_EVM;

  /* -- EVM balance (wagmi) -- */
  const { data: evmFromBal } = useBalance({
    address: evmAddress,
    token:   isEvmFrom && !isNativeEvmFrom ? fromToken.address : undefined,
    chainId: isEvmFrom ? fromToken.chainId : undefined,
    query:   { enabled: !!evmAddress && isEvmFrom },
  });

  /* -- Solana balance fetch (separate from EVM since wagmi doesn't cover SOL) -- */
  useEffect(() => {
    if (!publicKey || !connection) { setSolBalanceLamports(null); setSolSplBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
          const bal = await connection.getBalance(publicKey);
          if (!cancelled) setSolBalanceLamports(bal);
        } else if (isSol(fromToken)) {
          const bal = await connection.getBalance(publicKey);
          if (!cancelled) setSolBalanceLamports(bal);
          const a = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) });
          if (!cancelled) setSolSplBalance(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
        } else {
          // EVM from-token but Solana wallet still connected -- keep solBalance for fee calc
          const bal = await connection.getBalance(publicKey);
          if (!cancelled) setSolBalanceLamports(bal);
          if (!cancelled) setSolSplBalance(null);
        }
      } catch (_) {
        if (!cancelled) { setSolBalanceLamports(null); setSolSplBalance(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [publicKey, connection, fromToken]);

  /* -- Sync header chain when user explicitly picks a different-chain to-token -- */
  useEffect(() => {
    if (!toToken) return;
    const tokenChain = chainOfToken(toToken);
    if (tokenChain != null && tokenChain !== headerChain) setHeaderChain(tokenChain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toToken]);

  /* -- Sync default tokens when mode/headerChain changes (only when no override) -- */
  useEffect(() => {
    if (defaultFromToken || defaultToToken) return; // parent-controlled drawer
    const pair = defaultTokenPair({ mode: modeProp, viewedToken: null, headerChain, lastFromToken: fromToken });
    if (pair.fromToken && !tokensEqual(pair.fromToken, fromToken)) setFromToken(pair.fromToken);
    if (pair.toToken   && !tokensEqual(pair.toToken,   toToken))   setToToken(pair.toToken);
    setQuote(null); setQuoteError(''); setFromAmt('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeProp, headerChain]);

  /* -- Quote engine (debounced + abortable) -- */
  const fetchQuote = useCallback(async () => {
    setQuote(null); setQuoteError('');
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) return;
    if (tokensEqual(fromToken, toToken)) {
      setQuoteError('Cannot swap a token for itself.');
      return;
    }

    // Cancel previous in-flight quote
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;

    setQuoteLoading(true);
    const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
    try {
      const fromAmtRaw = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
      const slipBps = Math.round(slip * 100);

      if (route === 'jupiter') {
        const data = await fetchJupiterQuote({
          inputMint:  fromToken.mint,
          outputMint: toToken.mint,
          amountRaw:  fromAmtRaw,
          slipBps,
          signal: controller.signal,
        });
        setQuote({
          engine: 'jupiter',
          outAmountDisplay: (Number(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: data.priceImpactPct,
          quoteResponse: data,
        });
      } else if (route === '0x') {
        // For Permit2 we need the taker address. If wallet not connected, use a sentinel.
        const taker = evmAddress || '0x0000000000000000000000000000000000000001';
        // Fee token: charge fee in the buy token if it's a stablecoin/native, else from token
        const isNatTo = (toToken.address || '').toLowerCase() === NATIVE_EVM;
        const feeToken = isNatTo ? fromToken.address : toToken.address;
        const data = await fetchOxQuote({
          chainId:    fromToken.chainId,
          sellToken:  fromToken.address,
          buyToken:   toToken.address,
          sellAmount: fromAmtRaw,
          taker,
          slipBps,
          feeRecipient: EVM_FEE_WALLET,
          feeToken,
          signal: controller.signal,
        });
        setQuote({
          engine: '0x',
          outAmountDisplay: (Number(data.buyAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: 0,
          oxResponse: data,
        });
      } else {
        // LiFi (cross-chain or unsupported same-chain EVM)
        const previewFrom = isSol(fromToken)
          ? (publicKey ? publicKey.toString() : '11111111111111111111111111111111')
          : (evmAddress || '0x0000000000000000000000000000000000000001');
        const previewTo = isSol(toToken)
          ? (publicKey ? publicKey.toString() : '11111111111111111111111111111111')
          : (evmAddress || customDestAddr || '0x0000000000000000000000000000000000000001');
        const data = await fetchLifiQuote({
          fromToken, toToken,
          fromAmtRaw,
          fromAddress: previewFrom,
          toAddress:   previewTo,
          slip,
          signal: controller.signal,
        });
        setQuote({
          engine: 'lifi',
          outAmountDisplay: (Number(data.estimate.toAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: 0,
          lifiResponse: data,
        });
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setQuoteError('Failed to get quote: ' + (e.message || ''));
      }
    } finally {
      clearTimeout(timer);
      setQuoteLoading(false);
    }
  }, [fromAmt, fromToken, toToken, slip, route, evmAddress, publicKey, customDestAddr]);

  // Debounce quote fetch
  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  /* -- Pricing helpers (USD values from CoinGecko data) -- */
  const getPrice = useCallback((symbol) => {
    if (!symbol || !coins.length) return 0;
    const c = coins.find((x) => x.symbol && x.symbol.toLowerCase() === symbol.toLowerCase());
    return c ? Number(c.current_price) : 0;
  }, [coins]);

  const fromPriceUsd = getPrice(fromToken && fromToken.symbol);
  const toPriceUsd   = getPrice(toToken   && toToken.symbol);
  const solPriceUsd  = getPrice('SOL') || 150;

  /* -- Display balance -- */
  const fromBalanceDisplay = useMemo(() => {
    if (isSol(fromToken)) {
      if (fromToken.mint === WSOL_MINT) {
        return solBalanceLamports != null ? solBalanceLamports / LAMPORTS_PER_SOL : null;
      }
      return solSplBalance;
    }
    if (isEvm(fromToken) && evmFromBal) return parseFloat(evmFromBal.formatted);
    return null;
  }, [fromToken, solBalanceLamports, solSplBalance, evmFromBal]);

  /* -- MAX button handler (correct math, fixes the old TOTAL_FEE bug) -- */
  const onMax = useCallback(() => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
      // Native SOL: balance minus rent reserve, then minus platform fee headroom
      const usable = maxSafeSolBalance(solBalanceLamports);
      const afterFee = usable * (1 - (isCrossChain ? TOTAL_FEE_CC : TOTAL_FEE));
      setFromAmt(afterFee > 0 ? afterFee.toFixed(6) : '0');
      return;
    }
    if (isSol(fromToken)) {
      // SPL: full balance is swap-eligible (fee comes out of separate SOL balance for Jupiter)
      setFromAmt(fromBalanceDisplay.toFixed(6));
      return;
    }
    // EVM
    const max = maxSafeAmount({
      balance: fromBalanceDisplay,
      isNative: isNativeEvmFrom,
      isCrossChain,
    });
    setFromAmt(max > 0 ? max.toFixed(fromToken.decimals <= 2 ? 2 : 6) : '0');
  }, [fromBalanceDisplay, fromToken, solBalanceLamports, isNativeEvmFrom, isCrossChain]);

  /* -- Quick-buy preset application: "I want to spend $X of native"
        Sets fromAmt based on $X / nativePrice. -- */
  const applyBuyPreset = useCallback((dollars) => {
    if (!fromToken || !fromPriceUsd) {
      // If we don't know the from-token price, set the dollars directly if from-token is a stable
      if (fromToken && /^(USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol)) {
        setFromAmt(String(dollars));
      }
      return;
    }
    const tokens = dollars / fromPriceUsd;
    setFromAmt(tokens > 0 ? tokens.toFixed(6) : '0');
  }, [fromToken, fromPriceUsd]);

  /* -- Quick-sell preset: "Sell X% of my balance" -- */
  const applySellPreset = useCallback((pct) => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    const isNative = isSol(fromToken) ? fromToken.mint === WSOL_MINT : isNativeEvmFrom;
    let amount = fromBalanceDisplay * (pct / 100);
    if (pct === 100) {
      // For 100% on native, apply the full safety calc to leave gas + fee headroom
      if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
        const safe = maxSafeSolBalance(solBalanceLamports);
        amount = safe * (1 - (isCrossChain ? TOTAL_FEE_CC : TOTAL_FEE));
      } else if (isNative) {
        amount = maxSafeAmount({ balance: fromBalanceDisplay, isNative: true, isCrossChain });
      }
    }
    setFromAmt(amount > 0 ? amount.toFixed(6) : '0');
  }, [fromBalanceDisplay, fromToken, isNativeEvmFrom, solBalanceLamports, isCrossChain]);

  /* -- Flip from <-> to -- */
  const flipTokens = useCallback(() => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt(''); setQuote(null); setQuoteError(''); setCustomDestAddr('');
  }, [fromToken, toToken]);

  /* -- Determine if cross-chain destination needs a manual address -- */
  const needsDestAddr = useMemo(() => {
    if (!isCrossChain) return false;
    if (isSol(toToken) && !publicKey) return true;
    if (isEvm(toToken) && !evmAddress) return true;
    return false;
  }, [isCrossChain, toToken, publicKey, evmAddress]);

  /* ============================================================================
   * EXECUTE SWAP -- single-signature flows
   *
   * Jupiter (Solana same-chain):
   *   1. Get swap tx from Jupiter
   *   2. Decompile, append SystemProgram.transfer for our fee
   *   3. Recompile, user signs ONCE, broadcast
   *
   * 0x (EVM same-chain) with Permit2:
   *   1. Get permit2 quote -- includes EIP-712 typed data + transaction
   *   2. User signs typed data (off-chain, no popup-2, no gas)
   *   3. We attach signature + length prefix to the calldata
   *   4. User signs the resulting tx ONCE, broadcast
   *   (Fee is built into 0x quote via swapFeeBps + swapFeeRecipient)
   *
   * LiFi (cross-chain):
   *   1. Get fresh quote with real addresses
   *   2. Solana side: deserialize, send (fee already included via integrator)
   *   3. EVM side:
   *      - If from is ERC20, check allowance on LiFi diamond
   *      - If insufficient, send approval tx (this IS a separate tx -- LiFi
   *        doesn't support Permit2-style flows on most chains/bridges yet,
   *        so we accept this as the one unavoidable extra signature)
   *      - Then send bridge tx
   *      Note: For ERC20 cross-chain swaps, this is currently TWO sigs.
   *      For native cross-chain, ONE sig.
   * ========================================================================= */

  const executeSwap = useCallback(async () => {
    if (!walletConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!quote) return;

    setSwapStatus('loading'); setSwapError(''); setSwapTx(null);

    try {
      const fromAmtRaw = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
      const slipBps = Math.round(slip * 100);

      /* ============================================================
       * JUPITER (Solana same-chain) -- bundled single-sig
       * ============================================================ */
      if (route === 'jupiter') {
        if (!publicKey) throw new Error('Connect Solana wallet');
        const solBal = await connection.getBalance(publicKey);
        if (solBal < SOL_MIN_FOR_SWAP) throw new Error('Need at least 0.003 SOL for fees.');

        // Get the swap tx from Jupiter
        const swapData = await fetchJupiterSwapTx({
          quoteResponse: quote.quoteResponse,
          userPublicKey: publicKey.toString(),
        });

        // Deserialize the v0 transaction
        const jupTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));

        // Resolve all address-table-lookup accounts
        let altAccts = [];
        if (jupTx.message.addressTableLookups && jupTx.message.addressTableLookups.length) {
          const altRes = await Promise.all(
            jupTx.message.addressTableLookups.map((l) => connection.getAddressLookupTable(l.accountKey))
          );
          altAccts = altRes.map((r) => r.value).filter(Boolean);
        }

        // Decompile to a regular TransactionMessage so we can append our fee instruction
        const msg = TransactionMessage.decompile(jupTx.message, { addressLookupTableAccounts: altAccts });

        // Compute fee in lamports based on USD value of trade
        const feeLamports = calcSolFeeLamports({
          fromAmtTokens:     parseFloat(fromAmt),
          fromTokenSymbol:   fromToken.symbol,
          fromTokenPriceUsd: fromPriceUsd,
          solPriceUsd,
          isCrossChain:      false,
        });

        // Append fee transfer to the SAME message -- bundled in one signature
        msg.instructions.push(SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey:   new PublicKey(SOL_FEE_WALLET),
          lamports:   feeLamports,
        }));

        // Refresh blockhash
        const bh = await connection.getLatestBlockhash('confirmed');
        msg.recentBlockhash = bh.blockhash;

        // Recompile with the address tables
        const finalTx = new VersionedTransaction(msg.compileToV0Message(altAccts));

        // ONE signature
        const sig = await sendTransaction(finalTx, connection, { skipPreflight: true, maxRetries: 3 });
        setSwapTx(sig);

        // Confirm in background
        connection
          .confirmTransaction(
            { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
            'confirmed'
          )
          .catch(() => {});
      }

      /* ============================================================
       * 0X (EVM same-chain) -- Permit2 single-sig
       * ============================================================ */
      else if (route === '0x') {
        if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');

        // Auto-switch chain if needed
        if (evmChainId && evmChainId !== fromToken.chainId) {
          try {
            await switchChain({ chainId: fromToken.chainId });
            // Wait briefly for wallet to update
            const start = Date.now();
            while (Date.now() - start < 5000) {
              if (walletClient.chain && walletClient.chain.id === fromToken.chainId) break;
              await new Promise((r) => setTimeout(r, 250));
            }
          } catch (e) {
            throw new Error('Please switch your wallet to ' + (CHAIN_NAMES[fromToken.chainId] || 'the correct chain'));
          }
        }

        const oxData = quote.oxResponse;

        // Permit2 path: 0x quote returns `permit2.eip712` typed data we sign off-chain
        const permit2 = oxData.permit2;
        const tx = oxData.transaction;
        if (!tx || !tx.to || !tx.data) throw new Error('0x: incomplete transaction');

        let finalTxData = tx.data;

        if (permit2 && permit2.eip712) {
          // Sign the EIP-712 permit (off-chain, no gas, no chain interaction)
          const signature = await walletClient.signTypedData({
            domain:      permit2.eip712.domain,
            types:       permit2.eip712.types,
            primaryType: permit2.eip712.primaryType,
            message:     permit2.eip712.message,
          });

          // 0x expects the signature appended with a 32-byte length prefix
          // per their permit2 docs. Format:
          //   data = quote.transaction.data + uint256(sig.length) + sig
          const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
          const sigLen = (sigHex.length / 2).toString(16).padStart(64, '0');
          finalTxData = tx.data + sigLen + sigHex;
        }

        // ONE signature: the swap tx itself (which includes Permit2-authorized transfer)
        const hash = await walletClient.sendTransaction({
          to:    tx.to,
          data:  finalTxData,
          value: tx.value ? BigInt(tx.value) : BigInt(0),
          gas:   tx.gas ? BigInt(tx.gas) : undefined,
        });
        setSwapTx(hash);
      }

      /* ============================================================
       * LIFI (cross-chain or unsupported same-chain EVM)
       * ============================================================ */
      else if (route === 'lifi') {
        // Resolve real addresses
        const srcAddr = isSol(fromToken)
          ? (publicKey ? publicKey.toString() : null)
          : (evmAddress || null);
        const dstAddr = isSol(toToken)
          ? (publicKey ? publicKey.toString() : customDestAddr.trim())
          : (evmAddress || customDestAddr.trim());

        if (!srcAddr) throw new Error('Connect your ' + (isSol(fromToken) ? 'Solana' : 'EVM') + ' wallet');
        if (!dstAddr || dstAddr.length < 10) throw new Error('Enter destination wallet address');

        // Fresh quote with real addresses
        const lifiQ = await fetchLifiQuote({
          fromToken, toToken,
          fromAmtRaw,
          fromAddress: srcAddr,
          toAddress:   dstAddr,
          slip,
        });
        if (!lifiQ.transactionRequest) throw new Error('LiFi: no transaction returned');

        const txReq = lifiQ.transactionRequest;

        if (isSol(fromToken)) {
          if (!publicKey) throw new Error('Connect Solana wallet');
          // LiFi returns a base64 v0 transaction; fee already included via integrator param
          const lifiSolTx = VersionedTransaction.deserialize(Buffer.from(txReq.data, 'base64'));
          const bh = await connection.getLatestBlockhash('confirmed');
          // ONE signature
          const sig = await sendTransaction(lifiSolTx, connection, { skipPreflight: true, maxRetries: 3 });
          setSwapTx(sig);
          connection
            .confirmTransaction(
              { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
              'confirmed'
            )
            .catch(() => {});
        } else {
          if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');

          // Auto-switch chain if needed
          if (evmChainId && evmChainId !== fromToken.chainId) {
            try { await switchChain({ chainId: fromToken.chainId }); } catch (_) {}
            const start = Date.now();
            while (Date.now() - start < 5000) {
              if (walletClient.chain && walletClient.chain.id === fromToken.chainId) break;
              await new Promise((r) => setTimeout(r, 250));
            }
          }

          const isNativeFrom = (fromToken.address || '').toLowerCase() === NATIVE_EVM;

          // For ERC20: need approval. For native: skip approval entirely (single sig).
          if (!isNativeFrom) {
            const spender = txReq.to;
            const sellBig = BigInt(fromAmtRaw);
            // Check current allowance
            const allowCalldata = '0xdd62ed3e' +
              evmAddress.slice(2).padStart(64, '0') +
              spender.slice(2).padStart(64, '0');
            let needsApprove = true;
            try {
              const allowHex = await walletClient.request({
                method: 'eth_call',
                params: [{ to: fromToken.address, data: allowCalldata }, 'latest'],
              });
              needsApprove = BigInt(allowHex || '0x0') < sellBig;
            } catch (_) { /* default to needing approve */ }

            if (needsApprove) {
              // Use exact-amount approval (safer than infinite) but use max uint to save future approvals
              const approveData = '0x095ea7b3' +
                spender.slice(2).padStart(64, '0') +
                'f'.repeat(64);
              const approveHash = await walletClient.sendTransaction({
                to: fromToken.address,
                data: approveData,
                value: BigInt(0),
              });
              // Wait for confirmation before bridge tx (must be on-chain)
              const startedAt = Date.now();
              while (Date.now() - startedAt < 30_000) {
                try {
                  const r = await walletClient.waitForTransactionReceipt({ hash: approveHash, timeout: 5_000 });
                  if (r) break;
                } catch (_) {}
                await new Promise((r) => setTimeout(r, 2_000));
              }
            }
          }

          // Final bridge tx -- ONE signature (or two total if approval was needed)
          const hash = await walletClient.sendTransaction({
            to:    txReq.to,
            data:  txReq.data,
            value: txReq.value ? BigInt(txReq.value) : BigInt(0),
            gas:   txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
          });
          setSwapTx(hash);
        }
      }

      // Success state
      setSwapStatus('success');
      setFromAmt('');
      setQuote(null);
      setTimeout(() => { setSwapStatus('idle'); setSwapTx(null); }, 6000);
    } catch (e) {
      console.error('[SwapWidget] swap error:', e);
      setSwapError(e.message || 'Swap failed');
      setSwapStatus('error');
      setTimeout(() => { setSwapStatus('idle'); setSwapError(''); }, 5000);
    }
  }, [
    walletConnected, onConnectWallet, quote, route, fromAmt, fromToken, toToken,
    slip, publicKey, connection, sendTransaction, evmAddress, walletClient,
    evmChainId, switchChain, customDestAddr, fromPriceUsd, solPriceUsd,
  ]);

  /* -- Tx explorer link -- */
  const txLink = useMemo(() => {
    if (!swapTx) return null;
    if (route === 'jupiter') return 'https://solscan.io/tx/' + swapTx;
    if (route === 'lifi')    return isSol(fromToken)
      ? 'https://solscan.io/tx/' + swapTx
      : 'https://scan.li.fi/tx/' + swapTx;
    // 0x -- explorer based on chain
    const exp = {
      1:'etherscan.io', 10:'optimistic.etherscan.io', 56:'bscscan.com',
      137:'polygonscan.com', 8453:'basescan.org', 42161:'arbiscan.io',
      43114:'snowtrace.io', 59144:'lineascan.build', 534352:'scrollscan.com',
    }[fromToken.chainId] || 'etherscan.io';
    return 'https://' + exp + '/tx/' + swapTx;
  }, [swapTx, route, fromToken]);

  /* ============================================================================
   * RENDER
   * ========================================================================= */

  const showBuyPresets  = modeProp === 'buy'  || (modeProp === 'swap' && fromToken && /^(SOL|ETH|BNB|POL|AVAX|MNT|FTM|CRO|GLMR|CELO|SEI|RON|FUSE|KCS|HYPE|YALA|BERA|APE|FLOW|KAVA|S|CORE|MON|BTC|XPL|FLR|METIS|USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol));
  const showSellPresets = modeProp === 'sell';

  const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
  const toUsdValue   = quote   && toPriceUsd   > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;

  return (
    <div style={{
      width: '100%', maxWidth: compact ? '100%' : 520, margin: '0 auto',
      boxSizing: 'border-box', overscrollBehavior: 'none',
    }}>
      {!compact && (
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Swap</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            Best price across every chain. Single signature. No KYC.
          </p>
        </div>
      )}

      <div style={{
        background: compact ? 'transparent' : C.card,
        border: compact ? 'none' : '1px solid ' + C.border,
        borderRadius: compact ? 0 : 18, padding: compact ? 0 : 18,
      }}>

        {/* SLIPPAGE + PRESET EDIT */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0.1, 0.5, 1.0].map((v) => (
              <button
                key={v}
                onClick={() => setSlip(v)}
                style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent',
                  border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border),
                  color: slip === v ? C.accent : C.muted,
                  fontFamily: 'Syne, sans-serif',
                }}
              >{v}%</button>
            ))}
            <button
              onClick={() => setPresetEditorOpen(true)}
              style={{
                background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
                fontSize: 10, fontFamily: 'Syne, sans-serif', fontWeight: 600,
                marginLeft: 8, padding: 0,
              }}
              title="Edit presets"
            >Presets</button>
          </div>
        </div>

        {/* QUICK BUY PRESETS (buy mode or swap-from-native) */}
        {showBuyPresets && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 6 }}>
              QUICK BUY
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {presets.buy.map((amt) => (
                <button
                  key={amt}
                  onClick={() => applyBuyPreset(amt)}
                  style={{
                    flex: 1, padding: '9px 2px', borderRadius: 8,
                    border: '1px solid ' + C.border,
                    background: C.card2, color: C.muted,
                    fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >${amt}</button>
              ))}
            </div>
          </div>
        )}

        {/* QUICK SELL PRESETS (sell mode) */}
        {showSellPresets && fromBalanceDisplay != null && fromBalanceDisplay > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 6 }}>
              QUICK SELL
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {presets.sell.map((pct) => (
                <button
                  key={pct}
                  onClick={() => applySellPreset(pct)}
                  style={{
                    flex: 1, padding: '9px 2px', borderRadius: 8,
                    border: '1px solid ' + C.border,
                    background: C.card2, color: C.muted,
                    fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    fontFamily: 'Syne, sans-serif',
                  }}
                >{pct === 100 ? 'MAX' : pct + '%'}</button>
              ))}
            </div>
          </div>
        )}

        {/* FROM */}
        <div style={{
          background: C.card2, borderRadius: 12, padding: 14,
          border: '1px solid ' + C.border, marginBottom: 4,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span>
            {fromBalanceDisplay != null && (
              <span style={{ fontSize: 11, color: C.muted }}>
                Balance: <span style={{ color: C.text }}>{fmtTokenAmount(fromBalanceDisplay)}</span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setFromSelectOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: C.card3, border: '1px solid ' + C.border,
                borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
                minWidth: 90, flexShrink: 0,
              }}
            >
              <TokenIcon token={fromToken} size={20} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{fromToken && fromToken.symbol}</span>
              <ChainBadge token={fromToken} />
              <span style={{ color: C.muted, fontSize: 9 }}>&#9662;</span>
            </button>
            <input
              value={fromAmt}
              onChange={(e) => setFromAmt(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              inputMode="decimal"
              style={{
                flex: 1, background: 'transparent', border: 'none',
                fontSize: 22, fontWeight: 500, color: '#fff',
                textAlign: 'right', outline: 'none', minWidth: 0,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
            {fromBalanceDisplay != null && fromBalanceDisplay > 0 && (
              <button
                onClick={onMax}
                style={{
                  background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)',
                  borderRadius: 6, padding: '3px 8px', color: C.accent,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                  fontFamily: 'Syne, sans-serif',
                }}
              >MAX</button>
            )}
          </div>
          {fromAmt && fromUsdValue > 0 && (
            <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>
              {fmtUsd(fromUsdValue)}
            </div>
          )}
        </div>

        {/* FLIP BUTTON */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button
            onClick={flipTokens}
            style={{
              width: 36, height: 36, borderRadius: 10, background: C.card3,
              border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent,
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Flip tokens"
          >&#8645;</button>
        </div>

        {/* TO */}
        <div style={{
          background: C.card2, borderRadius: 12, padding: 14,
          border: '1px solid ' + C.border,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setToSelectOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: C.card3, border: '1px solid ' + C.border,
                borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
                minWidth: 90, flexShrink: 0,
              }}
            >
              <TokenIcon token={toToken} size={20} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{toToken && toToken.symbol}</span>
              <ChainBadge token={toToken} />
              <span style={{ color: C.muted, fontSize: 9 }}>&#9662;</span>
            </button>
            <div style={{
              flex: 1, textAlign: 'right',
              fontSize: 22, fontWeight: 500,
              minWidth: 0,
              color: quoteLoading ? C.muted : quote ? C.green : C.muted2,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}
            </div>
          </div>
          {quote && toUsdValue > 0 && (
            <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>
              {fmtUsd(toUsdValue)}
            </div>
          )}
        </div>

        {/* QUOTE ERROR */}
        {quoteError && (
          <div style={{
            marginTop: 8, padding: 10,
            background: 'rgba(255,59,107,.1)',
            border: '1px solid rgba(255,59,107,.2)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{quoteError}</div>
        )}

        {/* FEE / DETAIL BREAKDOWN */}
        {quote && fromAmt && (
          <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
            {[
              ['Platform fee', fromUsdValue > 0
                ? fmtUsd(fromUsdValue * PLATFORM_FEE)
                : (PLATFORM_FEE * 100).toFixed(0) + '%'],
              ['Anti-MEV / safety', fromUsdValue > 0
                ? fmtUsd(fromUsdValue * SAFETY_FEE)
                : (SAFETY_FEE * 100).toFixed(0) + '%'],
              isCrossChain ? ['Cross-chain fee', fromUsdValue > 0
                ? fmtUsd(fromUsdValue * CROSS_FEE)
                : (CROSS_FEE * 100).toFixed(0) + '%'] : null,
              route === 'jupiter' && quote.priceImpactPct != null
                ? ['Price impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%']
                : null,
              quote.outAmountDisplay
                ? ['Min received',
                    (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken && toToken.symbol)]
                : null,
            ].filter(Boolean).map((item) => (
              <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: C.muted }}>{item[0]}</span>
                <span style={{ color: C.text }}>{item[1]}</span>
              </div>
            ))}
          </div>
        )}

        {/* DESTINATION ADDRESS (cross-chain to a wallet user doesn't have connected) */}
        {needsDestAddr && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>
              DESTINATION WALLET
            </div>
            <input
              value={customDestAddr}
              onChange={(e) => setCustomDestAddr(e.target.value)}
              placeholder={isSol(toToken)
                ? 'Your Solana wallet address...'
                : 'Your ' + (CHAIN_NAMES[toToken && toToken.chainId] || 'EVM') + ' address (0x...)'}
              style={{
                width: '100%', background: C.card2,
                border: '1px solid rgba(0,229,255,.2)', borderRadius: 10,
                padding: '10px 12px', color: C.accent,
                fontFamily: 'monospace', fontSize: 11, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
              Where you want to receive your tokens
            </div>
          </div>
        )}

        {/* SWAP ERROR */}
        {swapError && (
          <div style={{
            marginTop: 10, padding: 10,
            background: 'rgba(255,59,107,.1)',
            border: '1px solid rgba(255,59,107,.3)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{swapError}</div>
        )}

        {/* ACTION BUTTON */}
        {walletConnected ? (
          <button
            onClick={executeSwap}
            disabled={swapStatus === 'loading' || !fromAmt || !quote || quoteLoading}
            style={{
              width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
              background: swapStatus === 'success'
                ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                : swapStatus === 'error'
                ? 'rgba(255,59,107,.2)'
                : !fromAmt || !quote
                ? C.card2
                : modeProp === 'sell' ? C.sellGrad : C.buyGrad,
              color: !fromAmt || !quote
                ? C.muted2
                : swapStatus === 'error' ? C.red : '#fff',
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
              cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer',
              minHeight: 52, transition: 'all .2s',
            }}
          >
            {swapStatus === 'loading' ? 'Confirming...'
              : swapStatus === 'success' ? 'Confirmed!'
              : swapStatus === 'error' ? 'Failed -- try again'
              : !fromAmt ? 'Enter amount'
              : quoteLoading ? 'Getting best route...'
              : !quote ? 'No route'
              : (modeProp === 'sell' ? 'Sell ' : modeProp === 'buy' ? 'Buy ' : 'Swap ')
                + (fromToken ? fromToken.symbol : '') + ' -> ' + (toToken ? toToken.symbol : '')}
          </button>
        ) : (
          <button
            onClick={onConnectWallet}
            style={{
              width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
              color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', minHeight: 52,
            }}
          >Connect Wallet</button>
        )}

        {swapTx && swapStatus === 'success' && txLink && (
          <a
            href={txLink}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}
          >View transaction</a>
        )}

        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>
          Non-custodial &middot; No KYC &middot; Single signature
        </p>
      </div>

      {/* TOKEN SELECT MODALS */}
      <TokenSelectModal
        open={fromSelectOpen}
        onClose={() => setFromSelectOpen(false)}
        onSelect={(t) => {
          setFromToken(t); setQuote(null); setQuoteError(''); setCustomDestAddr('');
        }}
        jupiterTokens={jupiterTokens}
        headerChain={headerChain}
      />
      <TokenSelectModal
        open={toSelectOpen}
        onClose={() => setToSelectOpen(false)}
        onSelect={(t) => {
          setToToken(t); setQuote(null); setQuoteError(''); setCustomDestAddr('');
        }}
        jupiterTokens={jupiterTokens}
        headerChain={headerChain}
      />

      {/* PRESET EDITOR */}
      <PresetEditor
        open={presetEditorOpen}
        onClose={() => setPresetEditorOpen(false)}
        presets={presets}
        onSave={setPresets}
      />
    </div>
  );
}

/* ============================================================================
 * TRADE DRAWER -- bottom-sheet wrapper used by TokenDetail / NewLaunches /
 * Markets / Portfolio. Just opens SwapWidget in compact mode with mode + token
 * defaults pre-applied.
 *
 * Props:
 *   open       -- boolean
 *   onClose    -- () => void
 *   mode       -- 'buy' | 'sell'
 *   coin       -- the viewed token (CoinGecko / Jupiter / etc shape)
 *   coins, jupiterTokens, onConnectWallet, isConnected -- pass through
 *   headerChain, onHeaderChainChange -- same as SwapWidget
 *   presets, onPresetsChange -- global preset state
 * ========================================================================= */

export function TradeDrawer({
  open, onClose, mode = 'buy', coin,
  coins, jupiterTokens, onConnectWallet, isConnected,
  headerChain, onHeaderChainChange,
  presets, onPresetsChange,
}) {
  // Resolve default tokens from mode + viewed coin + header chain
  const pair = useMemo(() => {
    if (!coin) return defaultTokenPair({ mode, viewedToken: null, headerChain, lastFromToken: null });
    return defaultTokenPair({ mode, viewedToken: coin, headerChain, lastFromToken: null });
  }, [coin, mode, headerChain]);

  // Force re-mount of SwapWidget when coin/mode changes so it picks up new defaults
  const widgetKey = useMemo(() => {
    const id = coin ? (coin.mint || coin.address || coin.id || 'tok') : 'none';
    return id + '-' + mode + '-' + (headerChain || 'na');
  }, [coin, mode, headerChain]);

  if (!open) return null;
  const symbol = coin && coin.symbol ? coin.symbol.toUpperCase() : '';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 560, zIndex: 401,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 20px 12px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {coin && coin.image && (
                <img src={coin.image} alt={symbol} style={{ width: 28, height: 28, borderRadius: '50%' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div style={{ color: mode === 'buy' ? C.accent : C.red, fontWeight: 800, fontSize: 17 }}>
                {mode === 'buy' ? 'Buy' : 'Sell'} {symbol}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none', border: 'none', color: C.muted,
                fontSize: 26, cursor: 'pointer', padding: 0, lineHeight: 1,
              }}
            >&times;</button>
          </div>
        </div>
        <div style={{
          flex: 1, overflowY: 'auto', padding: '4px 20px',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)',
        }}>
          <SwapWidget
            key={widgetKey}
            coins={coins}
            jupiterTokens={jupiterTokens}
            onConnectWallet={onConnectWallet}
            isConnected={isConnected}
            defaultFromToken={pair.fromToken}
            defaultToToken={pair.toToken}
            compact={true}
            mode={mode}
            headerChain={headerChain}
            onHeaderChainChange={onHeaderChainChange}
            presets={presets}
            onPresetsChange={onPresetsChange}
          />
        </div>
      </div>
    </>
  );
}
