/**
* NEXUS DEX -- Unified Swap Widget
*
* Single source of truth for buy / sell / swap across the entire app.
* Embeds in: home Swap tab, TokenDetail buy/sell, NewLaunches buy/sell,
*            Markets buy/sell, Portfolio sell, Send (uses sub-pieces).
*
* Behavior contract (locked):
*   1. ONE user signature per action. Approval + swap + fee bundled.
*   2. ONE quote shown to user. Internal route picker is silent.
*   3. Header network selector = DESTINATION chain. Source auto-picks.
*   4. Cross-chain works for any pair. LiFi primary, multi-hop fallback.
*   5. User stays on swap.verixiaapps.com. No external redirects.
*   6. Buy mode: from = native of source chain, to = the token.
*      Sell mode: from = the token, to = native of header chain.
*   7. Quick-buy presets ($) + Sell presets (%) appear for every token.
*/

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useBalance, useSwitchChain, usePublicClient } from 'wagmi';
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

// Chain IDs that 0x v2 supports for same-chain Permit2 swaps.
//
// Authoritative list: GET https://api.0x.org/swap/permit2/getChains
// (call from server.js with the API key -- chains evolve over time)
//
// Verified via 0x docs and changelog as of Q1 2026:
//   1     Ethereum
//   10    Optimism
//   56    BNB Chain
//   130   Unichain        (added 2025)
//   137   Polygon
//   324   zkSync Era
//   1101  Polygon zkEVM
//   2741  Abstract        (added 2025)
//   5000  Mantle
//   8453  Base
//   34443 Mode
//   42161 Arbitrum
//   43114 Avalanche
//   59144 Linea
//   80094 Berachain       (added 2025)
//   81457 Blast
//   146   Sonic           (added 2025)
//   57073 Ink             (added 2025)
//   534352 Scroll
//
// Removed since previous version (0x returns "chain not supported" for these,
// so route picker now correctly falls through to LiFi):
//   100, 250, 252, 255, 480, 1135, 9745, 42220, 4217, 999, 143
const OX_CHAIN_IDS = new Set([
 1, 10, 56, 130, 137, 146, 324, 1101, 2741, 5000, 8453,
 34443, 42161, 43114, 57073, 59144, 80094, 81457, 534352,
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

// Stablecoin USDC addresses per chain (for default to-token in swap mode)
const USDC_BY_CHAIN = {
 1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 10:    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
 56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
 100:   '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
 130:   '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
 137:   '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
 146:   '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
 250:   '0x2F733095B80A04b38b0D10cC884524a3d09b836a',
 324:   '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4',
 480:   '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
 1135:  '0xF242275d3a6527d877f2c927a82D9b057609cc71',
 5000:  '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9',
 8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
 34443: '0xd988097fb8612cc24eeC14542bC03424c656005f',
 42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
 43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
 59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
 81457: '0x4300000000000000000000000000000000000003',
 534352: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4',
 80094: '0x549943e04f40284185054145c6E4e9568C1D3241',
};
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Default Quick Buy preset dollar amounts (loaded/saved from localStorage)
const DEFAULT_BUY_PRESETS  = [10, 25, 50, 100, 250];
const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];   // percentages
const PRESETS_LS_KEY       = 'nexus_presets_v1';

// LocalStorage keys
const HEADER_CHAIN_LS_KEY  = 'nexus_header_chain_v1';

// LiFi token metadata cache (single-flight)
let _lifiTokensCache  = null;
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
 { address: NATIVE_EVM, chainId: 1,     symbol: 'ETH',  name: 'Ethereum',  decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
 { address: NATIVE_EVM, chainId: 8453,  symbol: 'ETH',  name: 'ETH (Base)', decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
 { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH',  name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
 { address: NATIVE_EVM, chainId: 10,    symbol: 'ETH',  name: 'ETH (Optimism)', decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
 { address: NATIVE_EVM, chainId: 56,    symbol: 'BNB',  name: 'BNB',       decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
 { address: NATIVE_EVM, chainId: 137,   symbol: 'POL',  name: 'Polygon',   decimals: 18, chain: 'evm',
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
 { address: NATIVE_EVM, chainId: 43114, symbol: 'AVAX', name: 'Avalanche', decimals: 18, chain: 'evm',
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

/* Convert a decimal token amount string (e.g., "1.5") to raw smallest-units
* using BigInt so precision is preserved at any size -- Math.pow(10,18) loses
* precision for large 18-decimal amounts. */
function toRawAmount(amountStr, decimals) {
 if (!amountStr) return '0';
 const s = String(amountStr).trim();
 if (!s || isNaN(Number(s))) return '0';
 const [whole, frac = ''] = s.split('.');
 const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
 const wholeBig = BigInt(whole || '0');
 const fracBig  = fracPadded ? BigInt(fracPadded) : BigInt(0);
 const scale    = BigInt(10) ** BigInt(decimals);
 return (wholeBig * scale + fracBig).toString();
}

/* ============================================================================
* TOKEN NORMALIZATION -- convert any "coin" shape to a strict Token object
*
* Inputs we may see:
*   - CoinGecko coin: { id, symbol, name, image, current_price, ... }
*     where id is "ethereum" / "solana" -- NOT an on-chain address.
*   - Solana token from Jupiter: { mint, symbol, name, logoURI, decimals }
*   - EVM token from LiFi: { address, chainId, symbol, name, logoURI, decimals }
*   - EVM token from Portfolio: { contractAddress, chainId, tokenSymbol, ... }
*   - User-pasted contract: bare address string
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
     decimals: typeof input.decimals === 'number' ? input.decimals
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
* Mode 'buy'  -> user wants to acquire viewedToken
* Mode 'sell' -> user wants to dispose of viewedToken
* Mode 'swap' -> free-form
* ========================================================================= */

// Native symbol lookup per chain -- used when synthesizing native tokens
// for chains not in POPULAR_TOKENS.
const _NATIVE_BY_CHAIN = {
 1: { symbol: 'ETH', name: 'Ethereum' },
 10: { symbol: 'ETH', name: 'ETH (Optimism)' },
 25: { symbol: 'CRO', name: 'Cronos' },
 56: { symbol: 'BNB', name: 'BNB' },
 100: { symbol: 'xDAI', name: 'xDAI' },
 122: { symbol: 'FUSE', name: 'Fuse' },
 130: { symbol: 'ETH', name: 'ETH (Unichain)' },
 137: { symbol: 'POL', name: 'Polygon' },
 146: { symbol: 'S', name: 'Sonic' },
 250: { symbol: 'FTM', name: 'Fantom' },
 252: { symbol: 'ETH', name: 'ETH (Fraxtal)' },
 255: { symbol: 'ETH', name: 'ETH (Kroma)' },
 288: { symbol: 'ETH', name: 'ETH (Boba)' },
 321: { symbol: 'KCS', name: 'KuCoin' },
 324: { symbol: 'ETH', name: 'ETH (zkSync)' },
 360: { symbol: 'ETH', name: 'ETH (Shape)' },
 480: { symbol: 'ETH', name: 'ETH (World Chain)' },
 747: { symbol: 'FLOW', name: 'Flow' },
 1088: { symbol: 'METIS', name: 'Metis' },
 1116: { symbol: 'CORE', name: 'Core' },
 1135: { symbol: 'ETH', name: 'ETH (Lisk)' },
 1284: { symbol: 'GLMR', name: 'Moonbeam' },
 1313161554: { symbol: 'ETH', name: 'ETH (Aurora)' },
 1329: { symbol: 'SEI', name: 'SEI' },
 2020: { symbol: 'RON', name: 'Ronin' },
 2222: { symbol: 'KAVA', name: 'Kava' },
 2741: { symbol: 'ETH', name: 'ETH (Abstract)' },
 5000: { symbol: 'MNT', name: 'Mantle' },
 8453: { symbol: 'ETH', name: 'ETH (Base)' },
 33139: { symbol: 'APE', name: 'ApeCoin' },
 34443: { symbol: 'ETH', name: 'ETH (Mode)' },
 42161: { symbol: 'ETH', name: 'ETH (Arbitrum)' },
 42220: { symbol: 'CELO', name: 'Celo' },
 43111: { symbol: 'ETH', name: 'ETH (Hemi)' },
 43114: { symbol: 'AVAX', name: 'Avalanche' },
 48900: { symbol: 'ETH', name: 'ETH (Zircuit)' },
 57073: { symbol: 'ETH', name: 'ETH (Ink)' },
 59144: { symbol: 'ETH', name: 'ETH (Linea)' },
 60808: { symbol: 'ETH', name: 'ETH (BOB)' },
 80094: { symbol: 'BERA', name: 'Berachain' },
 81457: { symbol: 'ETH', name: 'ETH (Blast)' },
 167000: { symbol: 'ETH', name: 'ETH (Taiko)' },
 200901: { symbol: 'BTC', name: 'Bitlayer BTC' },
 534352: { symbol: 'ETH', name: 'ETH (Scroll)' },
 7777777: { symbol: 'ETH', name: 'ETH (Zora)' },
};

function nativeOfChain(chainId) {
 if (chainId === 'solana') {
   return POPULAR_TOKENS.find((t) => t.mint === WSOL_MINT) || null;
 }
 // First try POPULAR_TOKENS for the icon
 const popular = POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === chainId && t.address === NATIVE_EVM);
 if (popular) return popular;
 // Synthesize from chain meta
 const meta = _NATIVE_BY_CHAIN[chainId];
 if (!meta) return null;
 return {
   chain: 'evm',
   address: NATIVE_EVM,
   chainId,
   symbol: meta.symbol,
   name: meta.name,
   decimals: 18,
   logoURI: null,
 };
}

function usdcOfChain(chainId) {
 if (chainId === 'solana') {
   return POPULAR_TOKENS.find((t) => t.mint === USDC_SOLANA) || null;
 }
 const addr = USDC_BY_CHAIN[chainId];
 if (!addr) return null;
 // First try POPULAR_TOKENS for the icon
 const popular = POPULAR_TOKENS.find((t) =>
   isEvm(t) && t.chainId === chainId && (t.address || '').toLowerCase() === addr.toLowerCase()
 );
 if (popular) return popular;
 // Synthesize from address
 return {
   chain: 'evm',
   address: addr,
   chainId,
   symbol: 'USDC',
   name: 'USDC (' + (CHAIN_NAMES[chainId] || 'EVM') + ')',
   decimals: 6,
   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
 };
}

function chainOfToken(t) {
 if (isSol(t)) return 'solana';
 if (isEvm(t)) return t.chainId;
 return null;
}

function defaultTokenPair({ mode, viewedToken, headerChain, lastFromToken }) {
 const viewed = viewedToken ? normalizeToken(viewedToken, { defaultChainId: headerChain === 'solana' ? 1 : headerChain }) : null;

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
 const toToken   = usdcOfChain(headerChain) || POPULAR_TOKENS[1];
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
   .then((r) => (r.ok ? r.json() : null))
   .catch(() => null)
   .then((data) => {
     _lifiTokensInflight = null;
     // Only cache successful, non-empty results -- otherwise let next call retry
     if (data && data.tokens && Object.keys(data.tokens).length > 0) {
       _lifiTokensCache = data;
       return data;
     }
     return { tokens: {} };
   });
 return _lifiTokensInflight;
}

async function fetchLifiQuote({ fromToken, toToken, fromAmtRaw, fromAddress, toAddress, slip, signal }) {
 const params = new URLSearchParams({
   fromChain:   lifiChainParam(fromToken),
   toChain:     lifiChainParam(toToken),
   fromToken:   lifiTokenParam(fromToken),
   toToken:     lifiTokenParam(toToken),
   fromAmount:  String(fromAmtRaw),
   fromAddress,
   toAddress:   toAddress || fromAddress,
   slippage:    String(slip / 100),
   fee:         String(LIFI_FEE),
   integrator:  LIFI_INTEGRATOR,
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
   // 0x is for same-chain swaps only -- use TOTAL_FEE (5%), not the cross-chain rate.
   swapFeeBps:            String(Math.round(TOTAL_FEE * 10000)),
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
   amount:        String(amountRaw),
   slippageBps:   String(slipBps),
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
     wrapAndUnwrapSol:        true,
     dynamicComputeUnitLimit: true,
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
 } catch { return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS }; }
}
function savePresets(p) {
 try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {}
}

function loadHeaderChain() {
 try {
   const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY);
   if (!raw) return 1; // Default to Ethereum
   const v = JSON.parse(raw);
   if (v === 'solana') return 'solana';
   if (typeof v === 'number') return v;
   return 1;
 } catch { return 1; }
}
function saveHeaderChain(c) {
 try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {}
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
   // 1) Keep 0.5% of balance for gas
   // 2) Subtract our platform fee % (will be deducted in the same tx)
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

// Short labels for chain badges (8 chars max -- keeps from/to buttons compact)
const CHAIN_SHORT = {
 1: 'ETH', 10: 'OP', 25: 'CRO', 56: 'BNB', 100: 'GNO',
 130: 'UNI', 137: 'POL', 143: 'MON', 146: 'SONIC', 250: 'FTM',
 252: 'FRAX', 255: 'KROMA', 288: 'BOBA', 324: 'zkSync', 480: 'WORLD',
 747: 'FLOW', 1116: 'CORE', 1135: 'LISK', 1284: 'GLMR', 1329: 'SEI',
 2020: 'RON', 2222: 'KAVA', 2741: 'ABS', 5000: 'MNT', 8453: 'BASE',
 34443: 'MODE', 42161: 'ARB', 42220: 'CELO', 43111: 'HEMI', 43114: 'AVAX',
 48900: 'ZIRC', 57073: 'INK', 59144: 'LINEA', 60808: 'BOB', 80094: 'BERA',
 81457: 'BLAST', 200901: 'BTRL', 534352: 'SCROLL', 6342: 'MEGA',
 321: 'KCC', 360: 'SHAPE', 33139: 'APE', 167000: 'TAIKO', 7777777: 'ZORA',
 122: 'FUSE', 1313161554: 'AURORA', 1088: 'METIS', 14: 'FLR',
 9745: 'XPL', 999: 'HYPE', 4217: 'YALA',
};

function ChainBadge({ token }) {
 if (!token) return null;
 const label = isSol(token)
   ? 'SOL'
   : (CHAIN_SHORT[token.chainId] || 'EVM');
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

/* ============================================================================
* DRAWER / MODAL SHARED HOOKS
*
* useBodyScrollLock(open):
*   When `open` is true, locks document.body scroll so the underlying page
*   doesn't scroll when the drawer's backdrop or its inner overflow is
*   touch-dragged on mobile. Saves and restores prior overflow / position
*   so it composes when multiple drawers stack (Token select on top of
*   Trade drawer).
*
* useEscapeKey(open, handler):
*   When `open` is true, attaches a keydown listener and calls `handler`
*   on Escape. Removes itself on close / unmount.
*
* These are required for drawer correctness -- without them, the backdrop
* is decorative (page still scrolls under it) and Escape does nothing.
* ========================================================================= */

// Counter so stacked drawers don't fight over body.style. Only the first
// open drawer locks; the last one to close restores.
let _bodyLockCount = 0;
let _bodyLockSaved = null;

function useBodyScrollLock(open) {
 useEffect(() => {
   if (!open) return undefined;
   if (typeof document === 'undefined') return undefined;
   if (_bodyLockCount === 0) {
     _bodyLockSaved = {
       overflow: document.body.style.overflow,
       touchAction: document.body.style.touchAction,
     };
     document.body.style.overflow = 'hidden';
     document.body.style.touchAction = 'none';
   }
   _bodyLockCount += 1;
   return () => {
     _bodyLockCount = Math.max(0, _bodyLockCount - 1);
     if (_bodyLockCount === 0 && _bodyLockSaved) {
       document.body.style.overflow = _bodyLockSaved.overflow || '';
       document.body.style.touchAction = _bodyLockSaved.touchAction || '';
       _bodyLockSaved = null;
     }
   };
 }, [open]);
}

function useEscapeKey(open, handler) {
 useEffect(() => {
   if (!open) return undefined;
   const onKey = (e) => {
     if (e.key === 'Escape' || e.keyCode === 27) {
       e.stopPropagation();
       if (typeof handler === 'function') handler();
     }
   };
   window.addEventListener('keydown', onKey);
   return () => window.removeEventListener('keydown', onKey);
 }, [open, handler]);
}

function TokenSelectModal({ open, onClose, onSelect, jupiterTokens, headerChain }) {
 const [q, setQ] = useState('');
 const [contractInput, setContractInput] = useState('');
 const [contractToken, setContractToken] = useState(null);
 const [contractLoading, setContractLoading] = useState(false);
 const [searchResults, setSearchResults] = useState([]);
 const [evmIndex, setEvmIndex] = useState([]);

 // wagmi public client for the user's currently-viewed EVM chain. Used by
 // the contract paste lookup to read decimals() / symbol() on-chain when
 // the address isn't in our LiFi index. headerChain may be 'solana' -- in
 // that case we fall back to mainnet (1) so the hook gets a number; the
 // resulting client is unused for solana lookups anyway.
 const evmChainForLookup = typeof headerChain === 'number' ? headerChain : 1;
 const publicClient = usePublicClient({ chainId: evmChainForLookup });

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

 // Search effect -- debounced 250ms so each keystroke doesn't filter through
 // thousands of LiFi-indexed EVM tokens. The visible "popular" list is what
 // the user sees while typing, so the small lag is invisible.
 useEffect(() => {
   const trimmed = q.trim();
   if (!trimmed) { setSearchResults([]); return undefined; }
   const handle = setTimeout(() => {
     const ql = trimmed.toLowerCase();

     const sol = solTokens.filter((t) =>
       (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
       (t.name && t.name.toLowerCase().includes(ql)) ||
       (t.mint && t.mint === trimmed)
     ).slice(0, 50);

     const evmFromIndex = evmIndex.filter((t) =>
       (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
       (t.name && t.name.toLowerCase().includes(ql)) ||
       ((CHAIN_NAMES[t.chainId] || '').toLowerCase().includes(ql))
     ).slice(0, 80);

     const evmFromPopular = POPULAR_TOKENS.filter((t) =>
       isEvm(t) && (
         (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
         (t.name && t.name.toLowerCase().includes(ql))
       )
     );

     const evmCombined = [];
     const seen = new Set();
     [...evmFromPopular, ...evmFromIndex].forEach((t) => {
       const key = (t.address || '').toLowerCase() + '-' + t.chainId;
       if (!seen.has(key)) { seen.add(key); evmCombined.push(t); }
     });

     setSearchResults([...sol, ...evmCombined]);
   }, 250);
   return () => { clearTimeout(handle); };
 }, [q, solTokens, evmIndex]);

 // Contract paste lookup
 // Request id ref -- only commit lookup result if input still matches the
 // address that initiated it. Prevents paste A -> blur -> paste B -> blur from
 // having lookup-A's late response overwrite the lookup-B result.
 const lookupReqRef = useRef(0);

 const lookupContract = useCallback(async (addr) => {
   const trimmed = addr.trim();
   if (!isValidSolMint(trimmed) && !isValidEvmAddr(trimmed)) {
     setContractToken(null); return;
   }
   const reqId = ++lookupReqRef.current;
   setContractLoading(true);
   try {
     if (isValidSolMint(trimmed)) {
       // Try jupiter token list first
       const cached = solTokens.find((t) => t.mint === trimmed);
       if (cached) {
         if (lookupReqRef.current === reqId) setContractToken(cached);
       } else {
         let resolved = null;
         try {
           const r = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + trimmed);
           if (lookupReqRef.current !== reqId) return;
           if (r.ok) {
             const d = await r.json();
             if (lookupReqRef.current !== reqId) return;
             if (d && d.address) {
               resolved = {
                 chain: 'solana', mint: d.address, symbol: d.symbol || shortAddr(d.address, 4, 4),
                 name: d.name || 'Unknown', decimals: typeof d.decimals === 'number' ? d.decimals : 6,
                 logoURI: d.logoURI || null,
               };
             }
           }
         } catch { /* fall through to placeholder */ }

         if (lookupReqRef.current === reqId) {
           setContractToken(resolved || {
             chain: 'solana', mint: trimmed, symbol: shortAddr(trimmed, 4, 4),
             name: 'Custom Token', decimals: 6, logoURI: null,
           });
         }
       }
     } else {
       // EVM address -- search LiFi index across ALL chains, prefer headerChain match
       const targetAddr = trimmed.toLowerCase();
       const allMatches = evmIndex.filter((t) => (t.address || '').toLowerCase() === targetAddr);
       const headerChainNum = headerChain === 'solana' ? 1 : headerChain;
       const preferred = allMatches.find((t) => t.chainId === headerChainNum);
       const found = preferred || allMatches[0];

       if (found) {
         if (lookupReqRef.current === reqId) setContractToken(found);
       } else {
         // Not in LiFi index -- try to read on-chain decimals from the
         // current chain's public client. A naive default of 18 produces
         // wrong amount displays for stablecoins (USDC/USDT are 6) when
         // pasted on chains LiFi doesn't index. If the read fails (wrong
         // chain, RPC error, not actually a contract), fall back to 18.
         const chainId = headerChainNum || 1;
         let decimals = 18;
         let onChainSymbol = null;
         try {
           const pc = publicClient;
           if (pc) {
             // ERC20 decimals() and symbol() -- read in parallel.
             // selector for decimals() is 0x313ce567 (uint8)
             // selector for symbol() is 0x95d89b41 (string)
             const [decRes, symRes] = await Promise.allSettled([
               pc.readContract({
                 address: trimmed,
                 abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] }],
                 functionName: 'decimals',
               }),
               pc.readContract({
                 address: trimmed,
                 abi: [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] }],
                 functionName: 'symbol',
               }),
             ]);
             if (decRes.status === 'fulfilled' && typeof decRes.value === 'number') {
               decimals = Number(decRes.value);
             } else if (decRes.status === 'fulfilled' && typeof decRes.value === 'bigint') {
               decimals = Number(decRes.value);
             }
             if (symRes.status === 'fulfilled' && typeof symRes.value === 'string' && symRes.value) {
               onChainSymbol = symRes.value;
             }
           }
         } catch { /* keep defaults */ }

         if (lookupReqRef.current === reqId) {
           setContractToken({
             chain: 'evm', address: trimmed, chainId,
             symbol: onChainSymbol || shortAddr(trimmed, 4, 4),
             name: 'Custom EVM Token (' + (CHAIN_NAMES[chainId] || 'EVM') + ')',
             decimals: decimals,
             logoURI: null,
           });
         }
       }
     }
   } catch {
     if (lookupReqRef.current === reqId) setContractToken(null);
   }
   if (lookupReqRef.current === reqId) setContractLoading(false);
 }, [solTokens, evmIndex, headerChain, publicClient]);

 const close = () => {
   setQ(''); setContractInput(''); setContractToken(null); setSearchResults([]);
   onClose();
 };

 // Drawer correctness: lock background scroll + Escape closes.
 useBodyScrollLock(open);
 useEscapeKey(open, close);

 // Clear the contract preview when the input is emptied -- otherwise stale
 // suggestion stays visible after user clears the field.
 useEffect(() => {
   if (!contractInput) setContractToken(null);
 }, [contractInput]);

 const display = q.trim() ? searchResults : POPULAR_TOKENS;

 if (!open) return null;
 return (
   <>
     <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }} />
     <div style={{
       position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
       zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
       borderRadius: 18, width: '94vw', maxWidth: 440, maxHeight: 'min(85vh, 100dvh)',
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
           }}>x</button>
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

 // Drawer correctness: body lock + Escape close.
 useBodyScrollLock(open);
 useEscapeKey(open, onClose);

 if (!open) return null;
 return (
   <>
     <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 599, background: 'rgba(0,0,0,.85)' }} />
     <div style={{
       position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
       zIndex: 600, background: C.card, border: '1px solid ' + C.borderHi,
       borderRadius: 18, padding: 20, width: '92vw', maxWidth: 380,
       boxShadow: '0 24px 80px rgba(0,0,0,.95)',
       maxHeight: 'min(90vh, 100dvh)', overflowY: 'auto',
     }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
         <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Edit Presets</div>
         <button onClick={onClose} style={{
           background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
           fontSize: 24, padding: 0, lineHeight: 1,
         }}>x</button>
       </div>

       <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
         QUICK BUY ($)
       </div>
       <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
         {buyVals.map((v, i) => (
           <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
             <span style={{ color: C.muted, fontSize: 12, width: 48, flexShrink: 0 }}>Slot {i + 1}</span>
             <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
               <span style={{ color: C.muted }}>$</span>
               <input
                 value={v}
                 onChange={(e) => {
                   let nv = e.target.value.replace(/[^0-9.]/g, '');
                   const dotIdx = nv.indexOf('.');
                   if (dotIdx >= 0) nv = nv.slice(0, dotIdx + 1) + nv.slice(dotIdx + 1).replace(/\./g, '');
                   setBuyVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                 }}
                 style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none', width: '100%' }}
               />
             </div>
             {buyVals.length > 1 && (
               <button
                 onClick={() => setBuyVals((p) => p.filter((_, j) => j !== i))}
                 aria-label="Remove slot"
                 style={{
                   flexShrink: 0, width: 28, height: 28, borderRadius: 6,
                   background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                   color: C.red, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
                 }}
               >-</button>
             )}
           </div>
         ))}
       </div>
       {buyVals.length < 5 && (
         <button
           onClick={() => setBuyVals((p) => p.concat(['25']))}
           style={{
             width: '100%', padding: '8px 12px', marginBottom: 16,
             borderRadius: 8, background: 'transparent',
             border: '1px dashed ' + C.border, color: C.muted,
             fontFamily: 'Syne, sans-serif', fontSize: 12, cursor: 'pointer',
           }}
         >+ Add buy slot</button>
       )}
       {buyVals.length >= 5 && <div style={{ height: 8 }} />}

       <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
         QUICK SELL (%)
       </div>
       <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
         {sellVals.map((v, i) => (
           <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
             <span style={{ color: C.muted, fontSize: 12, width: 48, flexShrink: 0 }}>Slot {i + 1}</span>
             <div style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
               <input
                 value={v}
                 onChange={(e) => {
                   let nv = e.target.value.replace(/[^0-9.]/g, '');
                   const dotIdx = nv.indexOf('.');
                   if (dotIdx >= 0) nv = nv.slice(0, dotIdx + 1) + nv.slice(dotIdx + 1).replace(/\./g, '');
                   setSellVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                 }}
                 style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none', width: '100%' }}
               />
               <span style={{ color: C.muted }}>%</span>
             </div>
             {sellVals.length > 1 && (
               <button
                 onClick={() => setSellVals((p) => p.filter((_, j) => j !== i))}
                 aria-label="Remove slot"
                 style={{
                   flexShrink: 0, width: 28, height: 28, borderRadius: 6,
                   background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                   color: C.red, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
                 }}
               >-</button>
             )}
           </div>
         ))}
       </div>
       {sellVals.length < 4 && (
         <button
           onClick={() => setSellVals((p) => p.concat(['50']))}
           style={{
             width: '100%', padding: '8px 12px', marginBottom: 18,
             borderRadius: 8, background: 'transparent',
             border: '1px dashed ' + C.border, color: C.muted,
             fontFamily: 'Syne, sans-serif', fontSize: 12, cursor: 'pointer',
           }}
         >+ Add sell slot</button>
       )}
       {sellVals.length >= 4 && <div style={{ height: 10 }} />}

       <div style={{ display: 'flex', gap: 10 }}>
         <button onClick={onClose} style={{
           flex: 1, padding: 12, borderRadius: 10, background: C.card2, border: '1px solid ' + C.border,
           color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, cursor: 'pointer', fontSize: 13,
         }}>Cancel</button>
         <button
           onClick={() => {
             const buy = buyVals.map((v) => parseFloat(v) || 0).filter((v) => v > 0);
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
*   onStatusChange     -- optional callback fired with the current swap status
*                         ('idle' | 'loading' | 'success' | 'error'). Used by
*                         TradeDrawer to lock dismissal during in-flight tx so
*                         user can't accidentally close the drawer mid-signature
*                         and lose the tx confirmation.
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
 onStatusChange,
}) {
 /* --- Wallet hooks --- */
 const { publicKey, sendTransaction, connected: solConnected } = useWallet();
 const { connection } = useConnection();
 const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
 const { data: walletClient } = useWalletClient();
 const { switchChain, switchChainAsync } = useSwitchChain();
 const walletConnected = solConnected || evmConnected;

 // Ref to walletClient so async code paths (after chain switch) can read
 // the freshest client instead of the closure-captured stale one.
 const walletClientRef = useRef(walletClient);
 useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);

 // SW-5: track chainId via ref so the poll-after-switch loop reads the
 // fresh value instead of a captured closure snapshot.
 const evmChainIdRef = useRef(evmChainId);
 useEffect(() => { evmChainIdRef.current = evmChainId; }, [evmChainId]);

 // Poll-and-wait helper that resolves only after the wallet has actually
 // switched chains. Replaces the previous fixed 400ms sleep, which raced
 // against wagmi's reactive state propagation on slow mobile wallets.
 const ensureChain = useCallback(async (targetChainId) => {
   if (!targetChainId) return true;
   if (evmChainIdRef.current === targetChainId) return true;
   try {
     if (switchChainAsync) {
       await switchChainAsync({ chainId: targetChainId });
     } else if (switchChain) {
       switchChain({ chainId: targetChainId });
     }
   } catch (e) {
     throw new Error('Please switch your wallet to ' + (CHAIN_NAMES[targetChainId] || 'the correct chain'));
   }
   // Poll up to 8s for wagmi state to publish the post-switch walletClient.
   // Mobile Safari + Coinbase Wallet sometimes takes 5-7s.
   const start = Date.now();
   while (Date.now() - start < 8_000) {
     const wc = walletClientRef.current;
     if (evmChainIdRef.current === targetChainId) return true;
     if (wc && wc.chain && wc.chain.id === targetChainId) return true;
     await new Promise((r) => setTimeout(r, 100));
   }
   // Last check -- if still mismatched, throw with a clear message
   if (evmChainIdRef.current !== targetChainId) {
     throw new Error('Chain switch did not take effect. Try again.');
   }
   return true;
 }, [switchChain, switchChainAsync]);

 /* --- Header chain (controlled from parent or fallback to localStorage) --- */
 const [headerChainLocal, setHeaderChainLocal] = useState(() =>
   headerChainProp != null ? headerChainProp : loadHeaderChain()
 );
 const headerChain = headerChainProp != null ? headerChainProp : headerChainLocal;
 const setHeaderChain = useCallback((c) => {
   if (onHeaderChainChange) onHeaderChainChange(c);
   else { setHeaderChainLocal(c); saveHeaderChain(c); }
 }, [onHeaderChainChange]);

 /* --- Token state --- */
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

 /* --- Amount + slippage state --- */
 const [fromAmt, setFromAmt] = useState('');
 const [slip, setSlip] = useState(0.5);

 /* --- Quote state --- */
 const [quote, setQuote] = useState(null);
 const [quoteLoading, setQuoteLoading] = useState(false);
 const [quoteError, setQuoteError] = useState('');
 const quoteAbortRef = useRef(null);

 /* --- Swap execution state --- */
 const [swapStatus, setSwapStatus] = useState('idle');
 const [swapTx, setSwapTx] = useState(null);
 const [swapError, setSwapError] = useState('');
 const swapStatusTimerRef = useRef(null);

 // Stuck-swap escape hatch. If swapStatus stays 'loading' for >30s, the
 // wallet popup most likely got dismissed/lost or the user is just stuck.
 // We surface a "Cancel" link that resets local state to idle without
 // touching the actual wallet (which we can't cancel -- but if the user
 // already signed, the tx will still propagate; we just stop blocking the
 // UI). Without this, a stuck loading state held the drawer captive
 // forever (TradeDrawer also locks dismissal during loading).
 const [stuckSwap, setStuckSwap] = useState(false);
 const stuckTimerRef = useRef(null);
 useEffect(() => {
   if (swapStatus === 'loading') {
     if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
     setStuckSwap(false);
     stuckTimerRef.current = setTimeout(() => { setStuckSwap(true); }, 30_000);
   } else {
     if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
     setStuckSwap(false);
   }
   return () => {
     if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
   };
 }, [swapStatus]);

 const cancelStuckSwap = useCallback(() => {
   setSwapStatus('idle');
   setSwapError('');
   setSwapTx(null);
   setStuckSwap(false);
 }, []);

 // Bubble swap status to parent (TradeDrawer uses it to lock dismissal
 // during the loading phase so the user can't accidentally close mid-tx
 // and lose the tx feedback).
 useEffect(() => {
   if (typeof onStatusChange === 'function') onStatusChange(swapStatus);
 }, [swapStatus, onStatusChange]);

 /* --- Balance state --- */
 const [solBalanceLamports, setSolBalanceLamports] = useState(null);
 const [solSplBalance, setSolSplBalance] = useState(null);

 /* --- Cross-chain destination address (when user receives on a chain
        their connected wallet doesn't cover) --- */
 const [customDestAddr, setCustomDestAddr] = useState('');

 /* --- Preset state --- */
 const [presetsLocal, setPresetsLocal] = useState(() => presetsProp || loadPresets());
 const presets = presetsProp || presetsLocal;
 const setPresets = useCallback((p) => {
   if (onPresetsChange) onPresetsChange(p);
   else { setPresetsLocal(p); savePresets(p); }
 }, [onPresetsChange]);
 const [presetEditorOpen, setPresetEditorOpen] = useState(false);

 /* --- Token select modals --- */
 const [fromSelectOpen, setFromSelectOpen] = useState(false);
 const [toSelectOpen,   setToSelectOpen]   = useState(false);

 /* --- Derived values --- */
 const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
 const isCrossChain = route === 'lifi';

 const isEvmFrom = isEvm(fromToken);
 const isNativeEvmFrom = isEvmFrom && (fromToken.address || '').toLowerCase() === NATIVE_EVM;

 // True only for the path that genuinely requires two wallet popups:
 // ERC20 (non-native) cross-chain via LiFi. Every other path is single-sig:
 //   - Jupiter (Solana same-chain): 1 sig (fee bundled)
 //   - 0x (EVM same-chain): 1 sig (Permit2 typed-data sig is off-chain, only the swap tx is signed)
 //   - LiFi Solana source: 1 sig (LiFi builds the bundled tx)
 //   - LiFi native EVM source: 1 sig (no approval needed for native)
 // The flag stays false on first render until the user picks tokens.
 // We display a clear UI banner on this exact path so the user knows
 // upfront they'll see two prompts (approval + bridge) instead of one.
 const requiresApproval = isCrossChain && isEvmFrom && !isNativeEvmFrom;

 /* --- Public client for the from-token's chain (read-only EVM RPC).
        Used for allowance checks and tx receipt waits. --- */
 const publicClient = usePublicClient({ chainId: isEvmFrom ? fromToken.chainId : undefined });
 const publicClientRef = useRef(publicClient);
 useEffect(() => { publicClientRef.current = publicClient; }, [publicClient]);

 /* --- EVM balance (wagmi) --- */
 const { data: evmFromBal } = useBalance({
   address: evmAddress,
   token:   isEvmFrom && !isNativeEvmFrom ? fromToken.address : undefined,
   chainId: isEvmFrom ? fromToken.chainId : undefined,
   query:   { enabled: !!evmAddress && isEvmFrom },
 });

 /* --- Solana balance fetch (separate from EVM since wagmi doesn't cover SOL) --- */
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
     } catch {
       if (!cancelled) { setSolBalanceLamports(null); setSolSplBalance(null); }
     }
   })();
   return () => { cancelled = true; };
 }, [publicKey, connection, fromToken]);

 /* --- Sync header chain when user explicitly picks a different-chain to-token --- */
 useEffect(() => {
   if (!toToken) return;
   const tokenChain = chainOfToken(toToken);
   if (tokenChain != null && tokenChain !== headerChain) setHeaderChain(tokenChain);
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [toToken]);

 /* --- Sync default tokens when mode/headerChain changes (only when no override) --- */
 useEffect(() => {
   if (defaultFromToken || defaultToToken) return; // parent-controlled drawer
   const pair = defaultTokenPair({ mode: modeProp, viewedToken: null, headerChain, lastFromToken: fromToken });
   if (pair.fromToken && !tokensEqual(pair.fromToken, fromToken)) setFromToken(pair.fromToken);
   if (pair.toToken && !tokensEqual(pair.toToken, toToken)) setToToken(pair.toToken);
   setQuote(null); setQuoteError(''); setFromAmt('');
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [modeProp, headerChain]);

 /* --- Quote engine (debounced + abortable) --- */
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
     const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);
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
       // 0x v2 requires swapFeeToken to be the buyToken (toToken).
       const data = await fetchOxQuote({
         chainId:    fromToken.chainId,
         sellToken:  fromToken.address,
         buyToken:   toToken.address,
         sellAmount: fromAmtRaw,
         taker,
         slipBps,
         feeRecipient: EVM_FEE_WALLET,
         feeToken:     toToken.address,
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

 /* --- Pricing helpers (USD values from CoinGecko data) --- */
 const getPrice = useCallback((symbol) => {
   if (!symbol || !coins.length) return 0;
   const c = coins.find((x) => x.symbol && x.symbol.toLowerCase() === symbol.toLowerCase());
   return c ? Number(c.current_price) : 0;
 }, [coins]);

 const fromPriceUsd = getPrice(fromToken && fromToken.symbol);
 const toPriceUsd   = getPrice(toToken && toToken.symbol);
 const solPriceUsd  = getPrice('SOL') || 150;

 /* --- Display balance --- */
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

 /* --- MAX button handler (correct math, fixes the old TOTAL_FEE bug) --- */
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

 /* --- Quick-buy preset application: "I want to spend $X of native"
        Sets fromAmt based on $X / nativePrice. --- */
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

 /* --- Quick-sell preset: "Sell X% of my balance" --- */
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

 /* --- Flip from<->to --- */
 const flipTokens = useCallback(() => {
   setFromToken(toToken);
   setToToken(fromToken);
   setFromAmt(''); setQuote(null); setQuoteError(''); setCustomDestAddr('');
 }, [fromToken, toToken]);

 /* --- Determine if cross-chain destination needs a manual address --- */
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

   // Clear any pending status reset from a previous attempt
   if (swapStatusTimerRef.current) {
     clearTimeout(swapStatusTimerRef.current);
     swapStatusTimerRef.current = null;
   }

   setSwapStatus('loading'); setSwapError(''); setSwapTx(null);

   try {
     const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);
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
       if (!evmAddress || !walletClientRef.current) throw new Error('Connect EVM wallet');

       // Auto-switch chain if needed. ensureChain() polls walletClient
       // until wagmi has actually published the post-switch state, then
       // returns. Replaces a 400ms fixed sleep that raced on slow mobile.
       if (evmChainId && evmChainId !== fromToken.chainId) {
         await ensureChain(fromToken.chainId);
       }

       // Read the freshest walletClient (post chain-switch)
       const wc = walletClientRef.current;
       if (!wc) throw new Error('Wallet not ready -- try again');

       const oxData = quote.oxResponse;

       // Permit2 path: 0x quote returns `permit2.eip712` typed data we sign off-chain
       const permit2 = oxData.permit2;
       const tx = oxData.transaction;
       if (!tx || !tx.to || !tx.data) throw new Error('0x: incomplete transaction');

       let finalTxData = tx.data;

       if (permit2 && permit2.eip712) {
         // Sign the EIP-712 permit (off-chain, no gas, no chain interaction)
         const signature = await wc.signTypedData({
           domain:      permit2.eip712.domain,
           types:       permit2.eip712.types,
           primaryType: permit2.eip712.primaryType,
           message:     permit2.eip712.message,
         });

         // 0x expects the signature appended with a 32-byte length prefix.
         // Format: data = quote.transaction.data + uint256(sig.length) + sig
         const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
         const sigLen = (sigHex.length / 2).toString(16).padStart(64, '0');
         finalTxData = tx.data + sigLen + sigHex;
       }

       // ONE signature: the swap tx itself (which includes Permit2-authorized transfer)
       const hash = await wc.sendTransaction({
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
       if (!dstAddr) throw new Error('Enter destination wallet address');
       // Validate destination address format matches the destination chain
       if (isSol(toToken) && !isValidSolMint(dstAddr)) {
         throw new Error('Invalid Solana destination address');
       }
       if (isEvm(toToken) && !isValidEvmAddr(dstAddr)) {
         throw new Error('Invalid EVM destination address');
       }

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
         // LiFi returns a base64 v0 transaction; fee already included via integrator param.
         // SW-4 fix: confirm against the blockhash the tx was signed with
         // (extracted from the deserialized message), NOT a freshly-fetched
         // one -- those can mismatch and cause "tx confirmed too early"
         // false positives on the UI.
         const lifiSolTx = VersionedTransaction.deserialize(Buffer.from(txReq.data, 'base64'));
         const lifiBh = lifiSolTx.message.recentBlockhash;
         // We still need lastValidBlockHeight for the deadline; query the
         // current one -- it's a forward-looking cap, doesn't have to match
         // the tx's blockhash.
         const lvbh = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
         // ONE signature
         const sig = await sendTransaction(lifiSolTx, connection, { skipPreflight: true, maxRetries: 3 });
         setSwapTx(sig);
         connection
           .confirmTransaction(
             { signature: sig, blockhash: lifiBh, lastValidBlockHeight: lvbh },
             'confirmed'
           )
           .catch(() => {});
       } else {
         if (!evmAddress || !walletClientRef.current) throw new Error('Connect EVM wallet');

         // SW-5 fix: ensureChain polls until wagmi publishes the new walletClient
         if (evmChainId && evmChainId !== fromToken.chainId) {
           await ensureChain(fromToken.chainId);
         }

         const wc = walletClientRef.current;
         const pc = publicClientRef.current;
         if (!wc) throw new Error('Wallet not ready -- try again');

         const isNativeFrom = (fromToken.address || '').toLowerCase() === NATIVE_EVM;

         // For ERC20: need approval. For native: skip approval entirely (single sig).
         if (!isNativeFrom) {
           const spender = txReq.to;
           const sellBig = BigInt(fromAmtRaw);
           // Check current allowance via the public client
           let needsApprove = true;
           if (pc) {
             try {
               const allowance = await pc.readContract({
                 address: fromToken.address,
                 abi: [{
                   name: 'allowance', type: 'function', stateMutability: 'view',
                   inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
                   outputs: [{ name: '', type: 'uint256' }],
                 }],
                 functionName: 'allowance',
                 args: [evmAddress, spender],
               });
               needsApprove = BigInt(allowance) < sellBig;
             } catch { /* default to needing approve */ }
           }

           if (needsApprove) {
             // Use max-uint approval so subsequent swaps don't need re-approval
             const approveData = '0x095ea7b3' +
               spender.slice(2).padStart(64, '0') +
               'f'.repeat(64);
             const approveHash = await wc.sendTransaction({
               to: fromToken.address,
               data: approveData,
               value: BigInt(0),
             });
             // Wait for confirmation before bridge tx (must be on-chain)
             if (pc) {
               try {
                 await pc.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
               } catch {
                 // If wait fails, proceed anyway -- bridge will revert if approval not landed
               }
             }
           }
         }

         // Final bridge tx -- ONE signature (or two total if approval was needed)
         const hash = await wc.sendTransaction({
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
     swapStatusTimerRef.current = setTimeout(() => {
       setSwapStatus('idle'); setSwapTx(null);
       swapStatusTimerRef.current = null;
     }, 6000);
   } catch (e) {
     console.error('[SwapWidget] swap error:', e);
     setSwapError(e.message || 'Swap failed');
     setSwapStatus('error');
     swapStatusTimerRef.current = setTimeout(() => {
       setSwapStatus('idle'); setSwapError('');
       swapStatusTimerRef.current = null;
     }, 5000);
   }
 }, [
   walletConnected, onConnectWallet, quote, route, fromAmt, fromToken, toToken,
   slip, publicKey, connection, sendTransaction, evmAddress,
   evmChainId, switchChain, switchChainAsync, ensureChain, customDestAddr, fromPriceUsd, solPriceUsd,
 ]);

 /* --- Tx explorer link --- */
 const txLink = useMemo(() => {
   if (!swapTx) return null;
   if (route === 'jupiter') return 'https://solscan.io/tx/' + swapTx;
   if (route === 'lifi')    return isSol(fromToken)
     ? 'https://solscan.io/tx/' + swapTx
     : 'https://scan.li.fi/tx/' + swapTx;
   // 0x -- explorer based on chain. SW-7 fix: every chain in OX_CHAIN_IDS
   // also has an entry here so successful 0x swaps always show a tx link.
   const exp = {
     1: 'etherscan.io', 10: 'optimistic.etherscan.io', 25: 'cronoscan.com',
     56: 'bscscan.com', 100: 'gnosisscan.io', 130: 'uniscan.xyz',
     137: 'polygonscan.com', 146: 'sonicscan.org', 250: 'ftmscan.com',
     324: 'explorer.zksync.io', 480: 'worldscan.org', 1101: 'zkevm.polygonscan.com',
     1135: 'blockscout.lisk.com', 1284: 'moonscan.io', 1329: 'seitrace.com',
     2741: 'abscan.org', 5000: 'mantlescan.xyz', 8453: 'basescan.org',
     34443: 'modescan.io', 42161: 'arbiscan.io', 42220: 'celoscan.io',
     43111: 'explorer.hemi.xyz', 43114: 'snowtrace.io', 48900: 'explorer.zircuit.com',
     57073: 'explorer.inkonchain.com', 59144: 'lineascan.build',
     60808: 'explorer.gobob.xyz', 80094: 'beratrail.io', 81457: 'blastscan.io',
     167000: 'taikoscan.io', 200901: 'btrscan.com', 534352: 'scrollscan.com',
     1116: 'scan.coredao.org', 122: 'explorer.fuse.io', 288: 'bobascan.com',
     747: 'flowdiver.io', 2222: 'kavascan.com', 33139: 'apescan.io',
   }[fromToken.chainId];
   if (!exp) return null;
   return 'https://' + exp + '/tx/' + swapTx;
 }, [swapTx, route, fromToken]);

 /* ============================================================================
  * RENDER
  * ========================================================================= */

 const showBuyPresets  = modeProp === 'buy'  || (modeProp === 'swap' && fromToken && /^(SOL|ETH|BNB|POL|AVAX|MNT|FTM|CRO|GLMR|CELO|SEI|RON|FUSE|KCS|HYPE|YALA|BERA|APE|FLOW|KAVA|S|CORE|MON|BTC|XPL|FLR|METIS|USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol));
 const showSellPresets = modeProp === 'sell';

 const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
 const toUsdValue   = quote && toPriceUsd > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;

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
             {presets.buy.map((amt, i) => (
               <button
                 key={'b-' + i}
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
             {presets.sell.map((pct, i) => (
               <button
                 key={'s-' + i}
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
             <span style={{ color: C.muted, fontSize: 9 }}>v</span>
           </button>
           <input
             value={fromAmt}
             onChange={(e) => {
               let v = e.target.value.replace(/[^0-9.]/g, '');
               const dotIdx = v.indexOf('.');
               if (dotIdx >= 0) {
                 v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, '');
               }
               setFromAmt(v);
             }}
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
             <span style={{ color: C.muted, fontSize: 9 }}>v</span>
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
       {(() => {
         // Determine if user has the right wallet type for this route
         const needsSol = (route === 'jupiter')
                      || (route === 'lifi' && isSol(fromToken));
         const needsEvm = (route === '0x')
                      || (route === 'lifi' && isEvm(fromToken));
         const hasNeededWallet = (needsSol && solConnected) || (needsEvm && evmConnected);

         if (!walletConnected) {
           return (
             <button
               onClick={onConnectWallet}
               style={{
                 width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                 background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
                 color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                 cursor: 'pointer', minHeight: 52,
               }}
             >Connect Wallet</button>
           );
         }

         if (!hasNeededWallet) {
           return (
             <button
               onClick={onConnectWallet}
               style={{
                 width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                 background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
                 color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                 cursor: 'pointer', minHeight: 52,
               }}
             >Connect {needsSol ? 'Solana' : 'EVM'} wallet</button>
           );
         }

         return (
           <>
           {requiresApproval && (
             <div style={{
               marginTop: 10, padding: '10px 12px',
               background: 'rgba(255,149,0,.08)',
               border: '1px solid rgba(255,149,0,.25)',
               borderRadius: 10, fontSize: 11, color: '#ff9500',
               display: 'flex', alignItems: 'center', gap: 8,
             }}>
               <span style={{ fontWeight: 700 }}>2 signatures may be needed:</span>
               <span style={{ color: '#cdd6f4' }}>first to approve {fromToken && fromToken.symbol} for the bridge, then to swap. Future swaps of {fromToken && fromToken.symbol} are 1 signature.</span>
             </div>
           )}
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

           {/* Stuck-swap escape hatch -- shown after 30s of loading. Lets
               the user reset local UI state without affecting any tx that
               actually got signed (which we can't cancel). */}
           {swapStatus === 'loading' && stuckSwap && (
             <div style={{
               marginTop: 10, padding: '10px 12px',
               background: 'rgba(255,59,107,.08)',
               border: '1px solid rgba(255,59,107,.25)',
               borderRadius: 10, fontSize: 11, color: C.muted, lineHeight: 1.4,
             }}>
               <div style={{ color: '#fff', fontWeight: 600, marginBottom: 4 }}>Still waiting on your wallet...</div>
               <div>If you've already signed, the transaction may still complete -- check your wallet for status.</div>
               <button
                 onClick={cancelStuckSwap}
                 style={{
                   marginTop: 8, background: 'transparent',
                   border: '1px solid ' + C.red, color: C.red,
                   padding: '6px 12px', borderRadius: 6,
                   fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer',
                 }}
               >Reset</button>
             </div>
           )}
           </>
         );
       })()}

       {swapTx && swapStatus === 'success' && txLink && (
         <a
           href={txLink}
           target="_blank"
           rel="noreferrer"
           style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}
         >View transaction</a>
       )}

       <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>
         Non-custodial - No KYC - Single signature
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

 // Track in-flight swap status from the embedded SwapWidget. When 'loading',
 // we lock backdrop + X close so the user can't accidentally dismiss the
 // drawer while a tx is in the wallet popup -- that would unmount SwapWidget
 // and lose the tx-confirmation UI even though the tx is still propagating.
 const [swapStatus, setSwapStatus] = useState('idle');
 const isBusy = swapStatus === 'loading';

 // Reset status when drawer opens fresh, so a previous 'success' or 'error'
 // from a prior session doesn't leak in.
 useEffect(() => {
   if (open) setSwapStatus('idle');
 }, [open]);

 const safeClose = useCallback(() => {
   if (isBusy) return;     // ignore close while swap is in-flight
   onClose();
 }, [isBusy, onClose]);

 // Drawer correctness: body scroll lock + Escape close (also locked when busy).
 useBodyScrollLock(open);
 useEscapeKey(open, safeClose);

 if (!open) return null;
 const symbol = coin && coin.symbol ? coin.symbol.toUpperCase() : '';

 return (
   <>
     <div onClick={safeClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
     <div style={{
       position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
       width: '100%', maxWidth: 560, zIndex: 401,
       background: C.card, borderTop: '2px solid ' + C.borderHi,
       borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
       maxHeight: 'min(90vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
     }}>
       <div style={{ flexShrink: 0, padding: '16px 20px 12px' }}>
         <div
           onClick={() => { if (swapStatus !== 'loading') onClose(); }}
           role="button"
           aria-label="Close"
           style={{
             width: 40, height: 4, background: C.muted2, borderRadius: 2,
             margin: '0 auto 14px',
             cursor: swapStatus === 'loading' ? 'default' : 'pointer',
             opacity: swapStatus === 'loading' ? 0.4 : 1,
             // Larger invisible tap target around the visual bar
             padding: '8px 0', boxSizing: 'content-box',
           }}
         />
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
             onClick={safeClose}
             disabled={isBusy}
             aria-label="Close"
             style={{
               background: 'none', border: 'none',
               color: isBusy ? C.muted2 : C.muted,
               fontSize: 26, cursor: isBusy ? 'not-allowed' : 'pointer',
               padding: 0, lineHeight: 1,
               opacity: isBusy ? 0.4 : 1,
             }}
           >x</button>
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
           onStatusChange={setSwapStatus}
         />
       </div>
     </div>
   </>
 );
}
