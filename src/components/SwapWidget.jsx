/**
 * NEXUS DEX -- Unified Swap Widget (Jupiter + 0x edition)
 *
 * Behavior contract (locked):
 *
 * 1. NO header chain selector. Routing is driven entirely by from/to
 *    tokens. Defaults come from the connected wallet's actual state and
 *    from the user's last-used pair via localStorage.
 *
 * 2. ONE wallet popup per swap action after the first ERC20 approval.
 *    0x uses AllowanceHolder (single-sig path) instead of Permit2 so
 *    subsequent swaps of an already-approved token are exactly one
 *    popup. Privy embedded wallets sign silently.
 *
 * 3. Fees: 5% same-chain. ALWAYS taken from output via the aggregator's
 *    own fee mechanism. Plus positive-slippage / trade-surplus capture
 *    directed to our fee wallet on both routes.
 *
 * 4. Pre-click data sources (NEVER aggregator quote endpoints):
 *      Solana prices  -> Jupiter /price/v3 -> Helius DAS fallback
 *      EVM prices     -> LiFi /v1/token (priceUSD) -- DATA ONLY
 *      Solana paste   -> Helius DAS getAsset
 *      EVM paste      -> on-chain RPC via wagmi public client
 *      Symbol search  -> Jupiter /tokens/v2/search (Solana) +
 *                        LiFi /v1/tokens catalog (EVM, lazy-loaded once)
 *
 * 5. Click routing (only two engines now):
 *      Solana <-> Solana                       -> Jupiter
 *      EVM <-> EVM, same chain, 0x supported   -> 0x AllowanceHolder
 *      Anything else                           -> blocked at UI level
 *    Cross-chain and BTC swaps are temporarily disabled until a
 *    replacement bridge integration ships.
 *
 * 6. Quote engine: pre-click is a price-derived estimate
 *      out = in * fromPriceUsd / toPriceUsd * (1 - feeRate)
 *    Displayed with `~` prefix. Click triggers a real aggregator quote.
 *
 * 7. Buy mode: from = native of viewed token's chain, to = the token.
 *    Sell mode: from = the token, to = USDC of the token's chain.
 *    Swap mode: from = wallet's native (or last-used), to = USDC.
 *
 * Removed in this revision:
 *   - LiFi swap execution (fetchLifiQuote + LiFi tx path entirely)
 *   - Bitcoin tokens from popular list (no path without LiFi)
 *   - Permit2 path on 0x (replaced with AllowanceHolder for 1-popup UX)
 *
 * Kept (data sources, not transactions):
 *   - LiFi /v1/token + /v1/tokens (price + symbol search only)
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
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

/* ============================================================================
 * CONSTANTS
 * ========================================================================= */

const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const EVM_FEE_WALLET = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';

const PLATFORM_FEE = 0.03;
const SAFETY_FEE   = 0.02;
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;             // 0.05 (same-chain)
const JUPITER_PLATFORM_FEE_BPS = Math.round(TOTAL_FEE * 10000);
const OX_SWAP_FEE_BPS          = Math.round(TOTAL_FEE * 10000);

/* Spread / positive-slippage capture: on 0x this is the
 * `tradeSurplusRecipient` mechanism (only active for whitelisted
 * integrators on a custom plan; silently ignored otherwise). On
 * Jupiter we don't capture spread -- the public swap-instructions
 * API does not expose positive-slippage parameters; passing them
 * leaks to the on-chain program and causes integer overflow on
 * tiny outputs. Fee revenue on Jupiter comes entirely from the
 * platformFeeBps + feeAccount pair (in quote + swap-instructions
 * respectively). */

const NATIVE_EVM  = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WSOL_MINT   = 'So11111111111111111111111111111111111111112';

const SOL_RESERVE_LAMPORTS   = 5_000_000;
const EVM_NATIVE_RESERVE_PCT = 0.005;

const QUOTE_DEBOUNCE_MS  = 250;
const PRICE_CACHE_TTL_MS = 60_000;

/* 0x v2 supported chains (Settler + AllowanceHolder deployed). Anything
 * outside this set is treated as unsupported in this build. */
const OX_CHAIN_IDS = new Set([
  1, 10, 56, 130, 137, 146, 324, 1101, 2741, 5000, 8453,
  34443, 42161, 43114, 57073, 59144, 80094, 81457, 534352,
]);

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
  9745: 'PlasmaChain', 999: 'HyperEVM', 4217: 'Yala', 8217: 'Kaia',
};
const CHAIN_SHORT = {
  1:'ETH',10:'OP',25:'CRO',56:'BNB',100:'GNO',130:'UNI',137:'POL',143:'MON',146:'SONIC',
  250:'FTM',252:'FRAX',255:'KROMA',288:'BOBA',324:'zkSync',480:'WORLD',747:'FLOW',
  1116:'CORE',1135:'LISK',1284:'GLMR',1329:'SEI',2020:'RON',2222:'KAVA',2741:'ABS',
  5000:'MNT',8453:'BASE',34443:'MODE',42161:'ARB',42220:'CELO',43111:'HEMI',43114:'AVAX',
  48900:'ZIRC',57073:'INK',59144:'LINEA',60808:'BOB',80094:'BERA',81457:'BLAST',
  200901:'BTRL',534352:'SCROLL',6342:'MEGA',321:'KCC',360:'SHAPE',33139:'APE',
  167000:'TAIKO',7777777:'ZORA',122:'FUSE',1313161554:'AURORA',1088:'METIS',14:'FLR',
  9745:'XPL',999:'HYPE',4217:'YALA',8217:'KAIA',
};

const USDC_BY_CHAIN = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  100: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
  130: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  146: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
  250: '0x2F733095B80A04b38b0D10cC884524a3d09b836a',
  324: '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4',
  480: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
  1135: '0xF242275d3a6527d877f2c927a82D9b057609cc71',
  5000: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  34443: '0xd988097fb8612cc24eeC14542bC03424c656005f',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  59144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  81457: '0x4300000000000000000000000000000000000003',
  534352: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4',
  80094: '0x549943e04f40284185054145c6E4e9568C1D3241',
};
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/* For LiFi catalog price lookup (data source only -- not used for swaps). */
const LIFI_NATIVE = '0x0000000000000000000000000000000000000000';

const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [50, 100];
const PRESETS_LS_KEY      = 'nexus_presets_v2';
const LAST_PAIR_LS_KEY    = 'nexus_last_pair_v1';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad:  'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
  privy:    '#a855f7',
};

const POPULAR_TOKENS = [
  { mint: WSOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: USDC_SOLANA, symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { address: NATIVE_EVM, chainId: 1,     symbol: 'ETH',  name: 'Ethereum', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 8453,  symbol: 'ETH',  name: 'ETH (Base)', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH',  name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 10,    symbol: 'ETH',  name: 'ETH (Optimism)', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 56,    symbol: 'BNB',  name: 'BNB', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
  { address: NATIVE_EVM, chainId: 137,   symbol: 'POL',  name: 'Polygon', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
  { address: NATIVE_EVM, chainId: 43114, symbol: 'AVAX', name: 'Avalanche', decimals: 18, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png' },
  { address: USDC_BY_CHAIN[1],     chainId: 1,     symbol: 'USDC', name: 'USDC (ETH)', decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: USDC_BY_CHAIN[8453],  chainId: 8453,  symbol: 'USDC', name: 'USDC (Base)', decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: USDC_BY_CHAIN[42161], chainId: 42161, symbol: 'USDC', name: 'USDC (Arbitrum)', decimals: 6, chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
];

const NATIVE_COIN_RESOLVE = {
  'ethereum':                { kind: 'evm-native', chainId: 1 },
  'binancecoin':             { kind: 'evm-native', chainId: 56 },
  'matic-network':           { kind: 'evm-native', chainId: 137 },
  'polygon-ecosystem-token': { kind: 'evm-native', chainId: 137 },
  'avalanche-2':             { kind: 'evm-native', chainId: 43114 },
  'fantom':                  { kind: 'evm-native', chainId: 250 },
  's':                       { kind: 'evm-native', chainId: 146 },
  'celo':                    { kind: 'evm-native', chainId: 42220 },
  'xdai':                    { kind: 'evm-native', chainId: 100 },
  'cronos':                  { kind: 'evm-native', chainId: 25 },
  'moonbeam':                { kind: 'evm-native', chainId: 1284 },
  'kava':                    { kind: 'evm-native', chainId: 2222 },
  'mantle':                  { kind: 'evm-native', chainId: 5000 },
  'core':                    { kind: 'evm-native', chainId: 1116 },
  'sei-network':             { kind: 'evm-native', chainId: 1329 },
  'berachain-bera':          { kind: 'evm-native', chainId: 80094 },
  'monad':                   { kind: 'evm-native', chainId: 143 },
  'ronin':                   { kind: 'evm-native', chainId: 2020 },
  'flow':                    { kind: 'evm-native', chainId: 747 },
  'lisk':                    { kind: 'evm-native', chainId: 1135 },
  'apecoin':                 { kind: 'evm-native', chainId: 33139 },
  'fuse-network-token':      { kind: 'evm-native', chainId: 122 },
  'hyperliquid':             { kind: 'evm-native', chainId: 999 },
  'aurora-near':             { kind: 'evm-native', chainId: 1313161554 },
  'solana':                  { kind: 'solana' },
};

const _NATIVE_BY_CHAIN = {
  1:{symbol:'ETH',name:'Ethereum'},10:{symbol:'ETH',name:'ETH (Optimism)'},
  25:{symbol:'CRO',name:'Cronos'},56:{symbol:'BNB',name:'BNB'},
  100:{symbol:'xDAI',name:'xDAI'},122:{symbol:'FUSE',name:'Fuse'},
  130:{symbol:'ETH',name:'ETH (Unichain)'},137:{symbol:'POL',name:'Polygon'},
  146:{symbol:'S',name:'Sonic'},250:{symbol:'FTM',name:'Fantom'},
  252:{symbol:'ETH',name:'ETH (Fraxtal)'},255:{symbol:'ETH',name:'ETH (Kroma)'},
  288:{symbol:'ETH',name:'ETH (Boba)'},321:{symbol:'KCS',name:'KuCoin'},
  324:{symbol:'ETH',name:'ETH (zkSync)'},360:{symbol:'ETH',name:'ETH (Shape)'},
  480:{symbol:'ETH',name:'ETH (World Chain)'},747:{symbol:'FLOW',name:'Flow'},
  1088:{symbol:'METIS',name:'Metis'},1116:{symbol:'CORE',name:'Core'},
  1135:{symbol:'ETH',name:'ETH (Lisk)'},1284:{symbol:'GLMR',name:'Moonbeam'},
  1313161554:{symbol:'ETH',name:'ETH (Aurora)'},1329:{symbol:'SEI',name:'SEI'},
  2020:{symbol:'RON',name:'Ronin'},2222:{symbol:'KAVA',name:'Kava'},
  2741:{symbol:'ETH',name:'ETH (Abstract)'},5000:{symbol:'MNT',name:'Mantle'},
  8217:{symbol:'KAIA',name:'Kaia'},8453:{symbol:'ETH',name:'ETH (Base)'},
  33139:{symbol:'APE',name:'ApeCoin'},34443:{symbol:'ETH',name:'ETH (Mode)'},
  42161:{symbol:'ETH',name:'ETH (Arbitrum)'},42220:{symbol:'CELO',name:'Celo'},
  43111:{symbol:'ETH',name:'ETH (Hemi)'},43114:{symbol:'AVAX',name:'Avalanche'},
  48900:{symbol:'ETH',name:'ETH (Zircuit)'},57073:{symbol:'ETH',name:'ETH (Ink)'},
  59144:{symbol:'ETH',name:'ETH (Linea)'},60808:{symbol:'ETH',name:'ETH (BOB)'},
  80094:{symbol:'BERA',name:'Berachain'},81457:{symbol:'ETH',name:'ETH (Blast)'},
  167000:{symbol:'ETH',name:'ETH (Taiko)'},200901:{symbol:'BTC',name:'Bitlayer BTC'},
  534352:{symbol:'ETH',name:'ETH (Scroll)'},7777777:{symbol:'ETH',name:'ETH (Zora)'},
};

/* ============================================================================
 * NUMERIC SAFETY HELPERS
 *
 * safeBigInt: accept anything (string, number, bigint, hex, decimal,
 * scientific) and produce a BigInt without throwing the iOS JSC error
 * "out of range integral type conversion attempted" on float input. All
 * BigInt() boundaries on the EVM tx path go through this.
 * ========================================================================= */

function safeBigInt(v) {
  if (v == null) return BigInt(0);
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return BigInt(0);
    return BigInt(Math.trunc(v));
  }
  let s = String(v).trim();
  if (!s) return BigInt(0);
  if (/^-?0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  if (/^-?\d+$/.test(s)) return BigInt(s);
  if (/^-?\d+\.\d+$/.test(s)) return BigInt(s.split('.')[0] || '0');
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return BigInt(0);
    return BigInt(n.toFixed(0));
  }
  const n = Number(s);
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : BigInt(0);
}

/* ============================================================================
 * TYPE GUARDS / VALIDATORS / FORMATTERS
 * ========================================================================= */

const isSol = (t) => !!(t && t.chain === 'solana');
const isEvm = (t) => !!(t && t.chain === 'evm');

function isValidSolMint(s) {
  return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function isValidEvmAddr(s) { return !!s && /^0x[0-9a-fA-F]{40}$/.test(s); }

function tokensEqual(a, b) {
  if (!a || !b) return false;
  if (isSol(a) && isSol(b)) return a.mint === b.mint;
  if (isEvm(a) && isEvm(b)) return a.chainId === b.chainId &&
    (a.address || '').toLowerCase() === (b.address || '').toLowerCase();
  return false;
}

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

/* Hardened decimal-string -> raw smallest-units. Handles commas, scientific
 * notation, leading +, multiple/trailing dots. Always truncates fractional
 * digits beyond `decimals` (never rounds up). Always returns a clean
 * integer string suitable for BigInt() consumers. */
function toRawAmount(amountStr, decimals) {
  if (!amountStr || decimals == null) return '0';
  let s = String(amountStr).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!s || s.startsWith('-')) return '0';
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return '0';
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return '0';
    s = n.toFixed(Math.max(Number(decimals) || 0, 20));
  }
  const parsedDecimals = Number(decimals);

if (!Number.isFinite(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 18) {
  return '0';
}

const dec = Math.floor(parsedDecimals);
const [whole, frac = ''] = s.split('.');

const safeWhole = (whole || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
const safeFracRaw = (frac || '').replace(/[^\d]/g, '');

const fracTrunc = safeFracRaw.slice(0, dec);
const fracPadded = (fracTrunc + '0'.repeat(dec)).slice(0, dec) || '0';

try {
  const wholeBig = BigInt(safeWhole);
  const fracBig = dec > 0 ? BigInt(fracPadded) : BigInt(0);
  const scale = 10n ** BigInt(dec);

  return (wholeBig * scale + fracBig).toString();
} catch {
  return '0';
}
}

/* ============================================================================
 * TOKEN NORMALIZATION
 * ========================================================================= */

function normalizeToken(input, opts = {}) {
  if (!input) return null;
  const { defaultChainId = 1 } = opts;
  const nativeRule = input.id ? NATIVE_COIN_RESOLVE[input.id] : null;
  if (nativeRule) {
    const baseLogo = input.logoURI || input.image || input.thumbnail || null;
    const baseSym  = input.symbol || (nativeRule.kind === 'solana' ? 'SOL' : 'TOKEN');
    const baseName = input.name || baseSym;
    if (nativeRule.kind === 'evm-native')
      return { chain: 'evm', address: NATIVE_EVM, chainId: nativeRule.chainId, symbol: baseSym, name: baseName, decimals: 18, logoURI: baseLogo };
    if (nativeRule.kind === 'solana')
      return { chain: 'solana', mint: WSOL_MINT, symbol: baseSym, name: baseName, decimals: 9, logoURI: baseLogo };
  }
  if (isSol(input) && input.mint) return input;
  if (isEvm(input) && input.address && input.chainId) return input;

  const logoURI = input.logoURI || input.image || input.thumbnail || null;
  const symbol  = input.symbol || input.tokenSymbol || 'TOKEN';
  const name    = input.name || input.tokenName || symbol;
  const evmAddr = input.address || input.contractAddress || null;
  if (evmAddr && isValidEvmAddr(evmAddr)) {
    return {
      chain: 'evm', address: evmAddr, chainId: input.chainId || defaultChainId,
      symbol, name,
      decimals: typeof input.decimals === 'number' ? input.decimals
        : typeof input.tokenDecimals === 'number' ? input.tokenDecimals : 18,
      logoURI,
    };
  }
  const solMint = input.mint || (input.isSolanaToken ? input.id : null);
  if (solMint && isValidSolMint(solMint)) {
    return {
      chain: 'solana', mint: solMint, symbol, name,
      decimals: typeof input.decimals === 'number' ? input.decimals : 6,
      logoURI,
    };
  }
  return null;
}

function nativeOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find((t) => t.mint === WSOL_MINT) || null;
  const popular = POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === chainId && t.address === NATIVE_EVM);
  if (popular) return popular;
  const meta = _NATIVE_BY_CHAIN[chainId];
  if (!meta) return null;
  return { chain: 'evm', address: NATIVE_EVM, chainId, symbol: meta.symbol, name: meta.name, decimals: 18, logoURI: null };
}
function usdcOfChain(chainId) {
  if (chainId === 'solana') return POPULAR_TOKENS.find((t) => t.mint === USDC_SOLANA) || null;
  const addr = USDC_BY_CHAIN[chainId];
  if (!addr) return null;
  const popular = POPULAR_TOKENS.find((t) => isEvm(t) && t.chainId === chainId && (t.address || '').toLowerCase() === addr.toLowerCase());
  if (popular) return popular;
  return {
    chain: 'evm', address: addr, chainId, symbol: 'USDC',
    name: 'USDC (' + (CHAIN_NAMES[chainId] || 'EVM') + ')', decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  };
}
function chainOfToken(t) {
  if (isSol(t)) return 'solana';
  if (isEvm(t)) return t.chainId;
  return null;
}

/* ============================================================================
 * DEFAULT TOKEN PAIR
 * ========================================================================= */

function pickDistinct(target, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c && (!target || !tokensEqual(c, target))) return c;
  }
  return null;
}

function defaultTokenPair({ mode, viewedToken, lastFromToken, walletState }) {
  const ws = walletState || {};
  const viewed = viewedToken ? normalizeToken(viewedToken) : null;

  if (mode === 'buy' && viewed) {
    const tokenChain = chainOfToken(viewed);
    const fromCandidates = [
      lastFromToken,
      nativeOfChain(tokenChain),
      usdcOfChain(tokenChain),
      ws.solConnected ? nativeOfChain('solana') : null,
      ws.evmConnected && ws.evmChainId ? nativeOfChain(ws.evmChainId) : null,
      POPULAR_TOKENS[0],
    ];
    return { fromToken: pickDistinct(viewed, fromCandidates) || POPULAR_TOKENS[0], toToken: viewed };
  }

  if (mode === 'sell' && viewed) {
    const tokenChain = chainOfToken(viewed);
    const toCandidates = [
      usdcOfChain(tokenChain),
      nativeOfChain(tokenChain),
      POPULAR_TOKENS[1], POPULAR_TOKENS[0],
    ];
    return { fromToken: viewed, toToken: pickDistinct(viewed, toCandidates) || POPULAR_TOKENS[1] };
  }

  if (lastFromToken) {
    const fromChain = chainOfToken(lastFromToken);
    const usdc = usdcOfChain(fromChain);
    if (usdc && !tokensEqual(usdc, lastFromToken)) {
      return { fromToken: lastFromToken, toToken: usdc };
    }
    const native = nativeOfChain(fromChain);
    if (native && !tokensEqual(native, lastFromToken)) {
      return { fromToken: lastFromToken, toToken: native };
    }
  }
  if (ws.solConnected) {
    return { fromToken: nativeOfChain('solana'), toToken: usdcOfChain('solana') };
  }
  if (ws.evmConnected && ws.evmChainId) {
    const native = nativeOfChain(ws.evmChainId);
    const usdc   = usdcOfChain(ws.evmChainId) || usdcOfChain('solana');
    if (native && usdc && !tokensEqual(native, usdc)) {
      return { fromToken: native, toToken: usdc };
    }
  }
  return { fromToken: nativeOfChain('solana'), toToken: usdcOfChain('solana') };
}

/* ============================================================================
 * ROUTE PICKER
 *
 * jupiter      -- Solana <-> Solana
 * 0x           -- EVM <-> EVM, same chain, 0x-supported
 * unsupported  -- everything else (cross-chain, non-0x EVM, mixed)
 * ========================================================================= */

function pickRoute(from, to) {
  if (!from || !to) return 'unsupported';
  if (isSol(from) && isSol(to)) return 'jupiter';
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId && OX_CHAIN_IDS.has(from.chainId)) return '0x';
  return 'unsupported';
}

function unsupportedReason(from, to) {
  if (!from || !to) return 'Select tokens to swap.';
  if (isSol(from) && isEvm(to)) return 'Cross-chain swaps temporarily unavailable.';
  if (isEvm(from) && isSol(to)) return 'Cross-chain swaps temporarily unavailable.';
  if (isEvm(from) && isEvm(to) && from.chainId !== to.chainId) {
    return 'Cross-chain swaps temporarily unavailable.';
  }
  if (isEvm(from) && isEvm(to) && !OX_CHAIN_IDS.has(from.chainId)) {
    return (CHAIN_NAMES[from.chainId] || 'This chain') + ' swaps temporarily unavailable.';
  }
  return 'This pair is not currently supported.';
}

/* ============================================================================
 * AGGREGATOR HELPERS -- Jupiter + 0x AllowanceHolder only
 * ========================================================================= */

/* 0x v2 AllowanceHolder QUOTE. Single-signature flow: user does an ERC20
 * approve(allowanceHolderSpender, MAX) once per token, then every swap is
 * a single sendTransaction. No EIP-712 typed-data signing needed.
 *
 * tradeSurplusRecipient    captures positive slippage in the buy token
 * swapFeeBps / Recipient   takes our 5% platform fee from the buy token */
async function fetchOxQuote({ chainId, sellToken, buyToken, sellAmount, taker, slipBps, feeRecipient, feeToken, signal }) {
  const qs = new URLSearchParams({
    chainId: String(chainId),
    sellToken: (sellToken || '').toLowerCase(),
    buyToken:  (buyToken  || '').toLowerCase(),
    sellAmount: String(sellAmount),
    taker,
    slippageBps: String(slipBps),
    swapFeeBps: String(OX_SWAP_FEE_BPS),
    swapFeeRecipient: feeRecipient,
    swapFeeToken: (feeToken || '').toLowerCase(),
    tradeSurplusRecipient: feeRecipient,
  });
  const res = await fetch('/api/0x/swap/allowance-holder/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '0x quote failed');
  if (!data.liquidityAvailable) throw new Error('No liquidity for this pair on 0x');
  if (!data.transaction || !data.transaction.to) throw new Error('No route');
  return data;
}

/* Jupiter quote. restrictIntermediateTokens=true keeps the route to
 * battle-tested intermediates -- avoids high-slippage long-tail hops.
 * platformFeeBps is ALWAYS included; the matching feeAccount is paired in
 * the swap-instructions call below. Jupiter rejects the build if one is
 * present without the other. */
async function fetchJupiterQuote({ inputMint, outputMint, amountRaw, slipBps, signal }) {
  const qs = new URLSearchParams({
    inputMint, outputMint,
    amount: String(amountRaw),
    slippageBps: String(slipBps),
    onlyDirectRoutes: 'false',
    restrictIntermediateTokens: 'true',
    platformFeeBps: String(JUPITER_PLATFORM_FEE_BPS),
  });
  const res = await fetch('/api/jupiter/swap/v1/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Jupiter quote failed');
  if (!data.outAmount) throw new Error('No route');
  return data;
}

/* Jupiter swap-INSTRUCTIONS endpoint. Returns individual ixs instead of a
 * sealed transaction so we can prepend our own createAssociatedTokenAccount
 * instruction for the fee ATA. That way the fee ATA gets created on the fly
 * inside the same atomic transaction as the swap -- no separate setup tx,
 * no "feeAccount missing" failures, no operational ATA pre-creation. User
 * pays ~0.002 SOL rent on the first trade to a brand-new output mint, then
 * nothing forever. */
async function fetchJupiterSwapInstructions({ quoteResponse, userPublicKey, feeAccount, signal }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: 5_000_000,
        priorityLevel: 'high',
      },
    },
    feeAccount,
  };
  const res = await fetch('/api/jupiter/swap/v1/swap-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Jupiter swap-instructions failed');
  if (!data.swapInstruction) throw new Error('Jupiter returned no swap instruction');
  return data;
}

/* Convert Jupiter's API-shaped instruction (programId/accounts/data as
 * base64) into a TransactionInstruction the web3.js builder accepts. */
function deserializeJupiterIx(rawIx) {
  return new TransactionInstruction({
    programId: new PublicKey(rawIx.programId),
    keys: (rawIx.accounts || []).map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: !!acc.isSigner,
      isWritable: !!acc.isWritable,
    })),
    data: Buffer.from(rawIx.data || '', 'base64'),
  });
}

/* Build the final VersionedTransaction. Order of instructions matches
 * Jupiter's documented response shape, with our fee-ATA-create slotted
 * in BEFORE the swap so the fee account exists when Jupiter's program
 * writes to it:
 *   1. Jupiter's otherInstructions (jito tips, etc -- normally empty
 *      since we use priorityLevelWithMaxLamports, not jitoTipLamports)
 *   2. Jupiter's compute budget (priority fee + CU limit)
 *   3. Jupiter's setup ixs (e.g., wSOL wrap, user dest ATA)
 *   4. Our createAssociatedTokenAccountIdempotent for the fee ATA
 *      -- idempotent: no-op if exists, creates if missing
 *   5. Jupiter's swap ix
 *   6. Jupiter's cleanup ix (e.g., wSOL unwrap)
 * Address lookup tables come from Jupiter's response so the route can
 * fit within Solana's 64-account limit. */
async function buildJupiterSwapTransaction({
  connection, userPubkey, outputMint, feeWallet, feeAta, ixData,
}) {
  const instructions = [];

  if (Array.isArray(ixData.otherInstructions)) {
    ixData.otherInstructions.forEach((ix) => instructions.push(deserializeJupiterIx(ix)));
  }

  if (Array.isArray(ixData.computeBudgetInstructions)) {
    ixData.computeBudgetInstructions.forEach((ix) => instructions.push(deserializeJupiterIx(ix)));
  }

  if (Array.isArray(ixData.setupInstructions)) {
    ixData.setupInstructions.forEach((ix) => instructions.push(deserializeJupiterIx(ix)));
  }

  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      userPubkey,   // payer = the user (they pay ~0.002 SOL rent on first creation)
      feeAta,       // ata to ensure exists
      feeWallet,    // owner of the new ata
      outputMint,   // mint of the new ata
    )
  );

  if (ixData.swapInstruction) {
    instructions.push(deserializeJupiterIx(ixData.swapInstruction));
  }

  if (ixData.cleanupInstruction) {
    instructions.push(deserializeJupiterIx(ixData.cleanupInstruction));
  }

  const ltAddrs = Array.isArray(ixData.addressLookupTableAddresses)
    ? ixData.addressLookupTableAddresses
    : [];
  const lookupTablesRaw = await Promise.all(
    ltAddrs.map(async (addr) => {
      try {
        const acct = await connection.getAccountInfo(new PublicKey(addr));
        if (!acct) return null;
        return new AddressLookupTableAccount({
          key: new PublicKey(addr),
          state: AddressLookupTableAccount.deserialize(acct.data),
        });
      } catch { return null; }
    })
  );
  const lookupTables = lookupTablesRaw.filter(Boolean);

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  const message = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  return new VersionedTransaction(message);
}

/* ============================================================================
 * USD PRICING -- data sources only, NEVER aggregator quote endpoints.
 * ========================================================================= */

const _priceCache = new Map();
function _priceCacheKey(token) {
  if (!token) return null;
  if (isSol(token)) return 'sol:' + token.mint;
  if (isEvm(token)) return 'evm:' + token.chainId + ':' + (token.address || '').toLowerCase();
  return null;
}
function getCachedPrice(token) {
  const key = _priceCacheKey(token);
  if (!key) return null;
  const e = _priceCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > PRICE_CACHE_TTL_MS) { _priceCache.delete(key); return null; }
  return e.price;
}
function setCachedPrice(token, price) {
  const key = _priceCacheKey(token);
  if (!key || !(price > 0)) return;
  _priceCache.set(key, { price: Number(price), ts: Date.now() });
}

async function fetchJupiterPrice(token) {
  try {
    if (!isSol(token) || !token.mint) return null;
    const r = await fetch('/api/jupiter/price/v3?ids=' + encodeURIComponent(token.mint));
    if (!r.ok) return null;
    const d = await r.json();
    const v = d && d[token.mint] && d[token.mint].usdPrice;
    return Number.isFinite(v) && v > 0 ? Number(v) : null;
  } catch { return null; }
}

async function fetchJupiterTokenSearchPrice(token) {
  try {
    if (!isSol(token) || !token.mint) return null;
    const r = await fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(token.mint));
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const hit = arr.find((t) => t && t.id === token.mint) || arr[0];
    const v = hit && hit.usdPrice;
    return Number.isFinite(v) && v > 0 ? Number(v) : null;
  } catch { return null; }
}

/* LiFi /v1/token (price data only -- not used for swap routing). */
async function fetchLifiTokenPrice(token) {
  try {
    if (!isEvm(token)) return null;
    const chain = String(token.chainId);
    const addr  = (token.address || '').toLowerCase() === NATIVE_EVM ? LIFI_NATIVE : token.address;
    const params = new URLSearchParams({ chain, token: addr });
    const r = await fetch('/api/lifi/v1/token?' + params.toString());
    if (!r.ok) return null;
    const d = await r.json();
    const v = d && d.priceUSD ? parseFloat(d.priceUSD) : null;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

async function fetchLifiCatalogPrice(token) {
  try {
    if (!isEvm(token)) return null;
    const catalog = await loadLifiTokens();
    if (!catalog || !catalog.length) return null;
    const targetAddr = (token.address || '').toLowerCase() === NATIVE_EVM
      ? LIFI_NATIVE
      : (token.address || '').toLowerCase();
    const hit = catalog.find((t) => t.chainId === token.chainId &&
      (t.address || '').toLowerCase() === targetAddr);
    const v = hit && hit.priceUSD;
    return Number.isFinite(v) && v > 0 ? Number(v) : null;
  } catch { return null; }
}

async function fetchHeliusPrice(token) {
  try {
    if (!isSol(token) || !token.mint) return null;
    const r = await fetch('/api/helius/das', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'p', method: 'getAsset', params: { id: token.mint },
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d && d.result && d.result.token_info && d.result.token_info.price_info
      ? d.result.token_info.price_info.price_per_token : null;
    return Number.isFinite(v) && v > 0 ? Number(v) : null;
  } catch { return null; }
}

async function getTokenPriceUsd(token) {
  if (!token) return null;
  const cached = getCachedPrice(token);
  if (cached != null) return cached;
  let p = null;
  if (isSol(token)) {
    p = await fetchJupiterPrice(token);
    if (p == null) p = await fetchJupiterTokenSearchPrice(token);
    if (p == null) p = await fetchHeliusPrice(token);
  } else if (isEvm(token)) {
    p = await fetchLifiTokenPrice(token);
    if (p == null) p = await fetchLifiCatalogPrice(token);
  }
  if (p != null && p > 0) { setCachedPrice(token, p); return p; }
  return null;
}

/* ============================================================================
 * SYMBOL SEARCH -- catalog data only, not transactional
 * ========================================================================= */

async function searchJupiterBySymbol(query, signal) {
  try {
    const r = await fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(query), { signal });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => ({
      chain: 'solana',
      mint: t.id,
      symbol: t.symbol || '',
      name: t.name || t.symbol || '',
      decimals: typeof t.decimals === 'number' ? t.decimals : 6,
      logoURI: t.icon || t.logoURI || null,
    })).filter((t) => isValidSolMint(t.mint) && t.symbol);
  } catch { return []; }
}

let _lifiTokensCache = null;
let _lifiTokensLoading = null;
function loadLifiTokens() {
  if (_lifiTokensCache) return Promise.resolve(_lifiTokensCache);
  if (_lifiTokensLoading) return _lifiTokensLoading;
  _lifiTokensLoading = fetch('/api/lifi/v1/tokens')
    .then((r) => (r.ok ? r.json() : { tokens: {} }))
    .catch(() => ({ tokens: {} }))
    .then((data) => {
      const flat = [];
      const tokens = (data && data.tokens) || {};
      Object.keys(tokens).forEach((cid) => {
        const arr = tokens[cid];
        if (!Array.isArray(arr)) return;
        const chainIdNum = Number(cid);
        if (!Number.isFinite(chainIdNum)) return;
        arr.forEach((t) => {
          if (!t || !t.address || !t.symbol) return;
          const lower = (t.address || '').toLowerCase();
          if (lower !== LIFI_NATIVE && !isValidEvmAddr(t.address)) return;
          flat.push({
            chain: 'evm',
            address: t.address,
            chainId: chainIdNum,
            symbol: t.symbol,
            name: t.name || t.symbol,
            decimals: typeof t.decimals === 'number' ? t.decimals : 18,
            logoURI: t.logoURI || null,
            priceUSD: t.priceUSD ? parseFloat(t.priceUSD) : null,
          });
        });
      });
      _lifiTokensCache = flat;
      _lifiTokensLoading = null;
      return flat;
    });
  return _lifiTokensLoading;
}

/* ============================================================================
 * PRESET + LAST-PAIR HELPERS + MAX-SAFE
 * ========================================================================= */

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return { buy: DEFAULT_BUY_PRESETS.slice(), sell: DEFAULT_SELL_PRESETS.slice() };
    const p = JSON.parse(raw);
    return {
      buy:  Array.isArray(p.buy)  && p.buy.length  >= 2 ? p.buy  : DEFAULT_BUY_PRESETS.slice(),
      sell: Array.isArray(p.sell) && p.sell.length >= 1 ? p.sell : DEFAULT_SELL_PRESETS.slice(),
    };
  } catch { return { buy: DEFAULT_BUY_PRESETS.slice(), sell: DEFAULT_SELL_PRESETS.slice() }; }
}
function savePresets(p) { try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {} }

function loadLastPair() {
  try {
    const raw = localStorage.getItem(LAST_PAIR_LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !v.from) return null;
    return v;
  } catch { return null; }
}
function saveLastPair(fromToken, toToken) {
  if (!fromToken || !toToken) return;
  try {
    localStorage.setItem(LAST_PAIR_LS_KEY, JSON.stringify({ from: fromToken, to: toToken, ts: Date.now() }));
  } catch {}
}

function maxSafeAmount({ balance, isNative }) {
  if (!balance || balance <= 0) return 0;
  if (!isNative) return balance;
  return balance * (1 - EVM_NATIVE_RESERVE_PCT);
}
function maxSafeSolBalance(lamports) {
  if (!lamports) return 0;
  return Math.max(0, lamports - SOL_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL;
}

/* ============================================================================
 * ICONS, BADGES, SCROLL-LOCK HOOKS
 * ========================================================================= */

function ChainBadge({ token }) {
  if (!token) return null;
  const label = isSol(token) ? 'SOL' : (CHAIN_SHORT[token.chainId] || 'EVM');
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
    return <img src={token.logoURI} alt={token.symbol || ''}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }}
      onError={() => setErrored(true)} />;
  }
  const ch = (token && token.symbol) ? token.symbol.charAt(0).toUpperCase() : '?';
  return <div style={{
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: Math.round(size * 0.4), fontWeight: 700, color: C.accent,
  }}>{ch}</div>;
}

let _bodyLockCount = 0;
function useBodyScrollLock(open) {
  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount += 1;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
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

/* ============================================================================
 * TOKEN SELECT MODAL
 * ========================================================================= */

function TokenSelectModal({ open, onClose, onSelect, jupiterTokens }) {
  const [q, setQ] = useState('');
  const [contractInput, setContractInput] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [discoveredSol, setDiscoveredSol] = useState([]);
  const [discoveredEvm, setDiscoveredEvm] = useState([]);
  const [discovering, setDiscovering] = useState(false);

  const { chainId: evmWalletChainId } = useAccount();
  const evmChainForLookup = evmWalletChainId || 1;
  const publicClient = usePublicClient({ chainId: evmChainForLookup });

  const solTokens = useMemo(() => {
    if (jupiterTokens && jupiterTokens.length > 0) {
      return jupiterTokens.map((t) => ({
        chain: 'solana', mint: t.mint, symbol: t.symbol,
        name: t.name || t.symbol, decimals: t.decimals || 6, logoURI: t.logoURI || null,
      }));
    }
    return POPULAR_TOKENS.filter((t) => isSol(t));
  }, [jupiterTokens]);

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
      const evmFromPopular = POPULAR_TOKENS.filter((t) =>
        isEvm(t) && (
          (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
          (t.name && t.name.toLowerCase().includes(ql)) ||
          ((CHAIN_NAMES[t.chainId] || '').toLowerCase().includes(ql))
        )
      );
      setSearchResults([...sol, ...evmFromPopular]);
    }, 250);
    return () => clearTimeout(handle);
  }, [q, solTokens]);

  const discoverReqRef = useRef(0);
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setDiscoveredSol([]); setDiscoveredEvm([]); setDiscovering(false);
      return undefined;
    }
    if (isValidSolMint(trimmed) || isValidEvmAddr(trimmed)) {
      setDiscoveredSol([]); setDiscoveredEvm([]); setDiscovering(false);
      return undefined;
    }
    const reqId = ++discoverReqRef.current;
    const controller = new AbortController();
    setDiscovering(true);
    const handle = setTimeout(async () => {
      const ql = trimmed.toLowerCase();
      const [solHits, lifiCatalog] = await Promise.all([
        searchJupiterBySymbol(trimmed, controller.signal),
        loadLifiTokens(),
      ]);
      if (discoverReqRef.current !== reqId) return;
      const evmHits = (lifiCatalog || [])
        .filter((t) =>
          (t.address || '').toLowerCase() !== LIFI_NATIVE && (
            (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
            (t.name && t.name.toLowerCase().includes(ql))
          )
        )
        .slice(0, 80);
      setDiscoveredSol(solHits);
      setDiscoveredEvm(evmHits);
      setDiscovering(false);
    }, 350);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [q]);

  const handleSelect = useCallback((token) => {
    onSelect(token);
    setQ(''); setContractInput(''); setContractToken(null);
    setSearchResults([]); setDiscoveredSol([]); setDiscoveredEvm([]);
    onClose();
  }, [onSelect, onClose]);

  const lookupReqRef = useRef(0);
  const lookupContract = useCallback(async (addr) => {
    const trimmed = (addr || '').trim();
    if (!isValidSolMint(trimmed) && !isValidEvmAddr(trimmed)) {
      setContractToken(null); return;
    }
    const reqId = ++lookupReqRef.current;
    setContractLoading(true);
    try {
      if (isValidSolMint(trimmed)) {
        const cached = solTokens.find((t) => t.mint === trimmed);
        if (cached) {
          if (lookupReqRef.current === reqId) setContractToken(cached);
        } else {
          let resolved = null;
          try {
            const r = await fetch('/api/helius/das', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 'tk', method: 'getAsset', params: { id: trimmed },
              }),
            });
            if (lookupReqRef.current !== reqId) return;
            if (r.ok) {
              const d = await r.json();
              if (lookupReqRef.current !== reqId) return;
              const result = d && d.result;
              if (result) {
                const ti = result.token_info || {};
                const meta = (result.content && result.content.metadata) || {};
                const links = (result.content && result.content.links) || {};
                const files = (result.content && result.content.files) || [];
                const sym = (ti.symbol || meta.symbol || '').trim();
                const nm  = (meta.name || ti.symbol || '').trim();
                const img = links.image || (files[0] && files[0].uri) || null;
                resolved = {
                  chain: 'solana', mint: trimmed,
                  symbol: sym || shortAddr(trimmed, 4, 4),
                  name:   nm  || 'Custom Token',
                  decimals: typeof ti.decimals === 'number' ? ti.decimals : 6,
                  logoURI: img,
                };
              }
            }
          } catch {}
          if (lookupReqRef.current === reqId) {
            setContractToken(resolved || {
              chain: 'solana', mint: trimmed, symbol: shortAddr(trimmed, 4, 4),
              name: 'Custom Token', decimals: 6, logoURI: null,
            });
          }
        }
      } else {
        let decimals = 18;
        let onChainSymbol = null;
        try {
          if (publicClient) {
            const [decRes, symRes] = await Promise.allSettled([
              publicClient.readContract({
                address: trimmed,
                abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] }],
                functionName: 'decimals',
              }),
              publicClient.readContract({
                address: trimmed,
                abi: [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] }],
                functionName: 'symbol',
              }),
            ]);
            if (decRes.status === 'fulfilled' && (typeof decRes.value === 'number' || typeof decRes.value === 'bigint')) {
              decimals = Number(decRes.value);
            }
            if (symRes.status === 'fulfilled' && typeof symRes.value === 'string' && symRes.value) {
              onChainSymbol = symRes.value;
            }
          }
        } catch {}
        if (lookupReqRef.current === reqId) {
          setContractToken({
            chain: 'evm', address: trimmed, chainId: evmChainForLookup,
            symbol: onChainSymbol || shortAddr(trimmed, 4, 4),
            name: 'Custom Token (' + (CHAIN_NAMES[evmChainForLookup] || 'EVM') + ')',
            decimals, logoURI: null,
          });
        }
      }
    } catch {
      if (lookupReqRef.current === reqId) setContractToken(null);
    }
    if (lookupReqRef.current === reqId) setContractLoading(false);
  }, [solTokens, evmChainForLookup, publicClient]);

  useEffect(() => {
    const v = contractInput.trim();
    if (!v) { setContractToken(null); return undefined; }
    const handle = setTimeout(() => { lookupContract(v); }, 350);
    return () => clearTimeout(handle);
  }, [contractInput, lookupContract]);

  const close = () => {
    setQ(''); setContractInput(''); setContractToken(null);
    setSearchResults([]); setDiscoveredSol([]); setDiscoveredEvm([]);
    onClose();
  };

  useBodyScrollLock(open);
  useEscapeKey(open, close);

  const merged = useMemo(() => {
    if (!q.trim()) return [];
    const seen = new Set();
    const out = [];
    const keyOf = (t) => isSol(t) ? 'sol:' + t.mint
      : isEvm(t) ? 'evm:' + t.chainId + ':' + (t.address || '').toLowerCase()
      : ('?:' + (t.symbol || '') + ':' + (t.name || ''));
    [...searchResults, ...discoveredSol, ...discoveredEvm].forEach((t) => {
      const k = keyOf(t);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    });
    return out;
  }, [q, searchResults, discoveredSol, discoveredEvm]);

  const display = q.trim() ? merged : POPULAR_TOKENS;

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
              <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens - DYOR</div>
            </div>
            <button onClick={close} aria-label="Close" style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
              fontSize: 22, lineHeight: 1, padding: 4, minWidth: 36, minHeight: 36,
            }}>x</button>
          </div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, symbol, chain..."
            style={{
              width: '100%', background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13,
              outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8,
            }} />
          <input value={contractInput} onChange={(e) => setContractInput(e.target.value)}
            placeholder="Or paste any Solana or EVM contract address..."
            style={{
              width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
              borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12,
              outline: 'none', fontFamily: 'monospace',
            }} />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
          {contractToken && !contractLoading && (
            <div onClick={() => handleSelect(contractToken)} style={{
              marginTop: 8, padding: '10px 12px',
              background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)',
              borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            }}>
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
        <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>
          {!q.trim() && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>POPULAR TOKENS</div>}
          {q.trim() && merged.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
              {discovering ? 'Searching...' : 'No matches.'}
              <div style={{ fontSize: 11, marginTop: 4 }}>Or paste the contract address above.</div>
            </div>
          )}
          {display.map((t, i) => {
            const key = (t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i;
            return (
              <div key={key} onClick={() => handleSelect(t)}
                style={{
                  padding: '12px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid rgba(255,255,255,.03)', minHeight: 48,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <TokenIcon token={t} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</span>
                    <ChainBadge token={t} />
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                </div>
              </div>
            );
          })}
          {q.trim() && discovering && merged.length > 0 && (
            <div style={{ padding: '10px 16px', fontSize: 11, color: C.muted, fontStyle: 'italic', textAlign: 'center' }}>
              Loading more matches...
            </div>
          )}
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

  useBodyScrollLock(open);
  useEscapeKey(open, onClose);

  const handleSave = useCallback(() => {
    const buy = buyVals.map((v) => parseFloat(v) || 0).filter((v) => v > 0);
    const sell = sellVals.map((v) => parseFloat(v) || 0).filter((v) => v > 0 && v <= 100);
    while (buy.length  < 2) buy.push(25);
    while (sell.length < 1) sell.push(50);
    onSave({ buy: buy.slice(0, 5), sell: sell.slice(0, 4) });
    onClose();
  }, [buyVals, sellVals, onSave, onClose]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 599, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, zIndex: 600,
        background: C.card, borderTop: '2px solid ' + C.borderHi,
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: 'min(88vh, 100dvh)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '14px 20px 8px' }}>
          <div onClick={onClose} role="button" aria-label="Close" style={{
            width: 40, height: 4, background: C.muted2, borderRadius: 2,
            margin: '0 auto 14px', cursor: 'pointer',
            padding: '8px 0', boxSizing: 'content-box',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 17 }}>Edit Presets</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                Used for the Quick Buy and Quick Sell rows.
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
              fontSize: 24, padding: 8, minWidth: 44, minHeight: 44, lineHeight: 1,
            }}>x</button>
          </div>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '8px 20px 16px',
        }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 10, marginTop: 6 }}>
            QUICK BUY ($)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
            {buyVals.map((v, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.muted, fontSize: 12, width: 50, flexShrink: 0 }}>Slot {i + 1}</span>
                <div style={{
                  flex: 1, background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 6, minHeight: 44,
                }}>
                  <span style={{ color: C.muted }}>$</span>
                  <input value={v}
                    inputMode="decimal"
                    onChange={(e) => {
                      let nv = e.target.value.replace(/[^0-9.]/g, '');
                      const dotIdx = nv.indexOf('.');
                      if (dotIdx >= 0) nv = nv.slice(0, dotIdx + 1) + nv.slice(dotIdx + 1).replace(/\./g, '');
                      setBuyVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                    }}
                    style={{
                      flex: 1, background: 'transparent', border: 'none',
                      color: '#fff', fontSize: 16, fontWeight: 700,
                      outline: 'none', width: '100%',
                    }} />
                </div>
                {buyVals.length > 2 && (
                  <button onClick={() => setBuyVals((p) => p.filter((_, j) => j !== i))} aria-label="Remove slot" style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: 8,
                    background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                    color: C.red, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
                  }}>-</button>
                )}
              </div>
            ))}
          </div>
          {buyVals.length < 5 && (
            <button onClick={() => setBuyVals((p) => p.concat(['25']))} style={{
              width: '100%', padding: '12px', marginBottom: 18, borderRadius: 10,
              background: 'transparent', border: '1px dashed ' + C.border, color: C.muted,
              fontFamily: 'Syne, sans-serif', fontSize: 13, cursor: 'pointer', minHeight: 44,
            }}>+ Add buy slot</button>
          )}

          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 10 }}>
            QUICK SELL (%)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
            {sellVals.map((v, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.muted, fontSize: 12, width: 50, flexShrink: 0 }}>Slot {i + 1}</span>
                <div style={{
                  flex: 1, background: C.card2, border: '1px solid ' + C.border,
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 6, minHeight: 44,
                }}>
                  <input value={v}
                    inputMode="decimal"
                    onChange={(e) => {
                      let nv = e.target.value.replace(/[^0-9.]/g, '');
                      const dotIdx = nv.indexOf('.');
                      if (dotIdx >= 0) nv = nv.slice(0, dotIdx + 1) + nv.slice(dotIdx + 1).replace(/\./g, '');
                      setSellVals((p) => { const n = p.slice(); n[i] = nv; return n; });
                    }}
                    style={{
                      flex: 1, background: 'transparent', border: 'none',
                      color: '#fff', fontSize: 16, fontWeight: 700,
                      outline: 'none', width: '100%',
                    }} />
                  <span style={{ color: C.muted }}>%</span>
                </div>
                {sellVals.length > 1 && (
                  <button onClick={() => setSellVals((p) => p.filter((_, j) => j !== i))} aria-label="Remove slot" style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: 8,
                    background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                    color: C.red, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
                  }}>-</button>
                )}
              </div>
            ))}
          </div>
          {sellVals.length < 4 && (
            <button onClick={() => setSellVals((p) => p.concat(['50']))} style={{
              width: '100%', padding: '12px', marginBottom: 12, borderRadius: 10,
              background: 'transparent', border: '1px dashed ' + C.border, color: C.muted,
              fontFamily: 'Syne, sans-serif', fontSize: 13, cursor: 'pointer', minHeight: 44,
            }}>+ Add sell slot</button>
          )}
        </div>

        <div style={{
          flexShrink: 0, padding: '12px 20px',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          borderTop: '1px solid ' + C.border, background: C.card,
          display: 'flex', gap: 10,
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 12, background: C.card2, border: '1px solid ' + C.border,
            color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600,
            cursor: 'pointer', fontSize: 14, minHeight: 48,
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 2, padding: 14, borderRadius: 12, background: C.buyGrad, border: 'none',
            color: C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800,
            cursor: 'pointer', fontSize: 14, minHeight: 48,
          }}>Save</button>
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * MAIN SWAP WIDGET
 * ========================================================================= */

export default function SwapWidget({
  jupiterTokens = [],
  onConnectWallet,
  defaultFromToken,
  defaultToToken,
  compact = false,
  mode: modeProp = 'swap',
  presets: presetsProp,
  onPresetsChange,
  onStatusChange,
  // eslint-disable-next-line no-unused-vars
  headerChain: _hcIgnored,
  // eslint-disable-next-line no-unused-vars
  onHeaderChainChange: _hcChangeIgnored,
}) {
  /* -- Wallet hooks -- */
  const { publicKey: extPublicKey, sendTransaction: extSolSendTx, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const nexus = useNexusWallet();
  const { activeWalletKind, privyEmbeddedSol, privyEmbeddedEvm, loginPrivy } = nexus;

  const publicKey = useMemo(() => {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; }
    }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const hasSolSigner = solConnected || (!!privyEmbeddedSol && !!publicKey);
  const hasEvmSigner = evmConnected || (!!privyEmbeddedEvm && !!privyEmbeddedEvm.address);

  const effectiveEvmAddress = useMemo(() => {
    if (evmAddress) return evmAddress;
    if (privyEmbeddedEvm && privyEmbeddedEvm.address) return privyEmbeddedEvm.address;
    return null;
  }, [evmAddress, privyEmbeddedEvm]);

  const sendTransaction = useCallback(async (tx, conn, opts) => {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') {
        return privyEmbeddedSol.sendTransaction(tx, conn, opts);
      }
      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const signed = await privyEmbeddedSol.signTransaction(tx);
        return conn.sendRawTransaction(signed.serialize(), opts || { skipPreflight: false, maxRetries: 3 });
      }
      throw new Error('Privy wallet has no sign method');
    }
    return extSolSendTx(tx, conn, opts);
  }, [activeWalletKind, privyEmbeddedSol, extSolSendTx]);

  const walletConnected = solConnected || evmConnected || hasSolSigner || hasEvmSigner;

  const walletClientRef = useRef(walletClient);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  const evmChainIdRef = useRef(evmChainId);
  useEffect(() => { evmChainIdRef.current = evmChainId; }, [evmChainId]);

  const ensureChain = useCallback(async (targetChainId) => {
    if (!targetChainId) return true;
    if (evmChainIdRef.current === targetChainId) return true;
    try {
      if (switchChainAsync) await switchChainAsync({ chainId: targetChainId });
      else if (switchChain)  switchChain({ chainId: targetChainId });
    } catch {
      throw new Error('Please switch your wallet to ' + (CHAIN_NAMES[targetChainId] || 'the correct chain'));
    }
    const start = Date.now();
    while (Date.now() - start < 8_000) {
      const wc = walletClientRef.current;
      if (evmChainIdRef.current === targetChainId) return true;
      if (wc && wc.chain && wc.chain.id === targetChainId) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (evmChainIdRef.current !== targetChainId) {
      throw new Error('Chain switch did not take effect. Try again.');
    }
    return true;
  }, [switchChain, switchChainAsync]);

  /* -- Initial token pair -- */
  const initialPair = useMemo(() => {
    if (defaultFromToken || defaultToToken) {
      const ws = { solConnected, evmConnected, evmChainId };
      const pair = defaultTokenPair({
        mode: modeProp,
        viewedToken: defaultFromToken || defaultToToken
          ? (modeProp === 'sell' ? defaultFromToken : defaultToToken) || defaultFromToken
          : null,
        lastFromToken: null,
        walletState: ws,
      });
      return {
        fromToken: defaultFromToken ? normalizeToken(defaultFromToken) : pair.fromToken,
        toToken:   defaultToToken   ? normalizeToken(defaultToToken)   : pair.toToken,
      };
    }
    const last = loadLastPair();
    const lastFromToken = last && last.from ? normalizeToken(last.from) : null;
    const ws = { solConnected, evmConnected, evmChainId };
    return defaultTokenPair({ mode: modeProp, viewedToken: null, lastFromToken, walletState: ws });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fromToken, setFromToken] = useState(initialPair.fromToken || POPULAR_TOKENS[0]);
  const [toToken,   setToToken]   = useState(initialPair.toToken   || POPULAR_TOKENS[1]);

  /* -- Amount + slippage -- */
  const [fromAmt, setFromAmt] = useState('');
  const [slip, setSlip] = useState(0.5);
  const userTouchedAmtRef = useRef(false);

  /* -- Quote state -- */
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteIsStale, setQuoteIsStale] = useState(false);

  /* -- Swap execution state -- */
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const swapStatusTimerRef = useRef(null);
  const [pendingSwap, setPendingSwap] = useState(false);

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
    setSwapStatus('idle'); setSwapError(''); setSwapTx(null); setStuckSwap(false);
  }, []);

  useEffect(() => {
    if (typeof onStatusChange === 'function') onStatusChange(swapStatus);
  }, [swapStatus, onStatusChange]);

  /* -- Solana balance -- */
  const [solBalanceLamports, setSolBalanceLamports] = useState(null);
  const [solSplBalance, setSolSplBalance] = useState(null);

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

  /* -- Derived -- */
  const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
  const isSupported = route !== 'unsupported';
  const unsupportedMsg = useMemo(() =>
    isSupported ? '' : unsupportedReason(fromToken, toToken),
    [isSupported, fromToken, toToken]
  );
  const isEvmFrom = isEvm(fromToken);
  const isNativeEvmFrom = isEvmFrom && (fromToken.address || '').toLowerCase() === NATIVE_EVM;

  const isPrivyOnly = activeWalletKind === 'privy' && !solConnected && !evmConnected;
  const requiresApproval = isEvmFrom && !isNativeEvmFrom && route === '0x' && !isPrivyOnly;

  /* -- Public client for from-token's chain -- */
  const publicClient = usePublicClient({ chainId: isEvmFrom ? fromToken.chainId : undefined });
  const publicClientRef = useRef(publicClient);
  useEffect(() => { publicClientRef.current = publicClient; }, [publicClient]);

  /* -- EVM balance -- */
  const balanceAddress = effectiveEvmAddress;
  const { data: evmFromBal, refetch: refetchEvmBal } = useBalance({
    address: balanceAddress,
    token:   isEvmFrom && !isNativeEvmFrom ? fromToken.address : undefined,
    chainId: isEvmFrom ? fromToken.chainId : undefined,
    query:   { enabled: !!balanceAddress && isEvmFrom },
  });

  /* -- Solana balance fetch -- */
  const fromMint = isSol(fromToken) ? fromToken.mint : null;
  useEffect(() => {
    if (!publicKey || !connection) { setSolBalanceLamports(null); setSolSplBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const bal = await connection.getBalance(publicKey);
        if (!cancelled) setSolBalanceLamports(bal);
        if (fromMint && fromMint !== WSOL_MINT) {
          const a = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromMint) });
          if (!cancelled) setSolSplBalance(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
        } else {
          if (!cancelled) setSolSplBalance(null);
        }
      } catch {
        if (!cancelled) { setSolBalanceLamports(null); setSolSplBalance(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [publicKey, connection, fromMint]);

  useEffect(() => {
    if (swapStatus !== 'success') return;
    if (typeof refetchEvmBal === 'function') refetchEvmBal();
    if (publicKey && connection && isSol(fromToken)) {
      connection.getBalance(publicKey).then(setSolBalanceLamports).catch(() => {});
      if (fromMint && fromMint !== WSOL_MINT) {
        connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromMint) })
          .then((a) => setSolSplBalance(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0))
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapStatus]);

  const lastSeenWalletState = useRef({ sol: solConnected, evm: evmConnected, chain: evmChainId });
  useEffect(() => {
    if (defaultFromToken || defaultToToken) return;
    if (userTouchedAmtRef.current) return;
    const prev = lastSeenWalletState.current;
    const justConnectedSol = !prev.sol && solConnected;
    const justConnectedEvm = !prev.evm && evmConnected;
    const justSwitchedChain = evmConnected && prev.chain !== evmChainId;
    lastSeenWalletState.current = { sol: solConnected, evm: evmConnected, chain: evmChainId };
    if (!(justConnectedSol || justConnectedEvm || justSwitchedChain)) return;

    const ws = { solConnected, evmConnected, evmChainId };
    const last = loadLastPair();
    const lastFromToken = last && last.from ? normalizeToken(last.from) : null;
    const pair = defaultTokenPair({ mode: modeProp, viewedToken: null, lastFromToken, walletState: ws });
    if (pair.fromToken && !tokensEqual(pair.fromToken, fromToken)) {
      setFromToken(pair.fromToken);
      setQuote(null); setQuoteError(''); setQuoteIsStale(false);
    }
    if (pair.toToken && !tokensEqual(pair.toToken, toToken)) {
      setToToken(pair.toToken);
      setQuote(null); setQuoteError(''); setQuoteIsStale(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solConnected, evmConnected, evmChainId]);

  useEffect(() => {
    if (defaultFromToken) {
      const next = normalizeToken(defaultFromToken);
      if (next && !tokensEqual(next, fromToken)) {
        setFromToken(next); setQuote(null); setQuoteError(''); setQuoteIsStale(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFromToken]);
  useEffect(() => {
    if (defaultToToken) {
      const next = normalizeToken(defaultToToken);
      if (next && !tokensEqual(next, toToken)) {
        setToToken(next); setQuote(null); setQuoteError(''); setQuoteIsStale(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultToToken]);

  /* -- USD prices -- */
  const [fromPriceUsd, setFromPriceUsd] = useState(null);
  const [toPriceUsd, setToPriceUsd] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getTokenPriceUsd(fromToken);
      if (!cancelled) setFromPriceUsd(p);
    })();
    return () => { cancelled = true; };
  }, [fromToken]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getTokenPriceUsd(toToken);
      if (!cancelled) setToPriceUsd(p);
    })();
    return () => { cancelled = true; };
  }, [toToken]);

  /* ============================================================================
   * QUOTE ENGINE -- price-derived estimate, NEVER aggregator pre-click.
   * ========================================================================= */
  const fetchQuote = useCallback(async () => {
    setQuoteError('');

    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) {
      setQuote(null); setQuoteIsStale(false); return;
    }
    if (typeof fromToken.decimals !== 'number' || typeof toToken.decimals !== 'number') {
      setQuote(null); setQuoteIsStale(false); return;
    }
    if (tokensEqual(fromToken, toToken)) {
      setQuote(null); setQuoteIsStale(false);
      setQuoteError('Cannot swap a token for itself.');
      return;
    }

    const fromNum = parseFloat(fromAmt);
    if (!Number.isFinite(fromNum) || fromNum <= 0) {
      setQuote(null); setQuoteIsStale(false); return;
    }
    if (!(fromPriceUsd > 0) || !(toPriceUsd > 0)) {
      setQuote(null); setQuoteIsStale(false);
      return;
    }

    const grossOut = fromNum * fromPriceUsd / toPriceUsd;
    const netOut = grossOut * (1 - TOTAL_FEE);
    const dp = (netOut > 0 && netOut < 0.01) ? 8 : 6;

    setQuote({
      engine: 'estimate',
      outAmountDisplay: netOut.toFixed(dp),
      priceImpactPct: 0,
      preview: true,
    });
    setQuoteIsStale(false);
    return;
  }, [fromAmt, fromToken, toToken, fromPriceUsd, toPriceUsd]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

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

  /* -- MAX -- always clamp to token's actual decimals (and <=9 for JS Number
   * precision safety). Ensures the resulting input string is integer-clean
   * when passed to BigInt boundaries downstream. */
  const onMax = useCallback(() => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    userTouchedAmtRef.current = true;
    const dec = Math.min(typeof fromToken.decimals === 'number' ? fromToken.decimals : 6, 9);

    if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
      const usable = maxSafeSolBalance(solBalanceLamports);
      setFromAmt(usable > 0 ? usable.toFixed(dec) : '0');
      return;
    }
    if (isSol(fromToken)) {
      setFromAmt(fromBalanceDisplay.toFixed(dec));
      return;
    }
    const max = maxSafeAmount({ balance: fromBalanceDisplay, isNative: isNativeEvmFrom });
    setFromAmt(max > 0 ? max.toFixed(dec) : '0');
  }, [fromBalanceDisplay, fromToken, solBalanceLamports, isNativeEvmFrom]);

  const applyBuyPreset = useCallback((dollars) => {
    if (!fromToken) return;
    userTouchedAmtRef.current = true;
    if (fromPriceUsd && fromPriceUsd > 0) {
      const tokens = dollars / fromPriceUsd;
      const dec = Math.min(typeof fromToken.decimals === 'number' ? fromToken.decimals : 6, 9);
      setFromAmt(tokens > 0 ? tokens.toFixed(dec) : '0');
      return;
    }
    if (/^(USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol || '')) {
      setFromAmt(String(dollars));
    }
  }, [fromToken, fromPriceUsd]);

  const applySellPreset = useCallback((pct) => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    userTouchedAmtRef.current = true;
    const isNative = isSol(fromToken) ? fromToken.mint === WSOL_MINT : isNativeEvmFrom;
    const dec = Math.min(typeof fromToken.decimals === 'number' ? fromToken.decimals : 6, 9);
    let amount = fromBalanceDisplay * (pct / 100);
    if (pct === 100) {
      if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
        amount = maxSafeSolBalance(solBalanceLamports);
      } else if (isNative) {
        amount = maxSafeAmount({ balance: fromBalanceDisplay, isNative: true });
      }
    }
    setFromAmt(amount > 0 ? amount.toFixed(dec) : '0');
  }, [fromBalanceDisplay, fromToken, isNativeEvmFrom, solBalanceLamports]);

  const flipTokens = useCallback(() => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt(''); setQuote(null); setQuoteError(''); setQuoteIsStale(false);
    userTouchedAmtRef.current = false;
  }, [fromToken, toToken]);

  /* ============================================================================
   * EXECUTE SWAP -- Jupiter or 0x AllowanceHolder only
   * ========================================================================= */
  const executeSwap = useCallback(async () => {
    if (!walletConnected) {
      setPendingSwap(true);
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }

    if (!isSupported) {
      setSwapError(unsupportedMsg || 'This pair is not supported.');
      setSwapStatus('error');
      return;
    }

    if (swapStatusTimerRef.current) {
      clearTimeout(swapStatusTimerRef.current);
      swapStatusTimerRef.current = null;
    }
    setSwapStatus('loading'); setSwapError(''); setSwapTx(null);

    try {
      const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);
      if (!fromAmtRaw || fromAmtRaw === '0') {
        throw new Error('Invalid amount');
      }

      if (route === 'jupiter') {
        if (!publicKey) throw new Error('Connect a Solana wallet');

        /* Always derive the fee ATA. We will create it atomically inside
         * the swap transaction below, so it does not matter whether it
         * already exists on-chain. */
        const outputMintPk = new PublicKey(toToken.mint);
        const feeWalletPk  = new PublicKey(SOL_FEE_WALLET);
        const feeAta       = await getAssociatedTokenAddress(outputMintPk, feeWalletPk);
        const feeAtaParam  = feeAta.toBase58();

        const freshQuote = await fetchJupiterQuote({
          inputMint:  fromToken.mint,
          outputMint: toToken.mint,
          amountRaw:  fromAmtRaw,
          slipBps:    Math.round(slip * 100),
        });

        const ixData = await fetchJupiterSwapInstructions({
          quoteResponse: freshQuote,
          userPublicKey: publicKey.toString(),
          feeAccount:    feeAtaParam,
        });

        const jupTx = await buildJupiterSwapTransaction({
          connection,
          userPubkey: publicKey,
          outputMint: outputMintPk,
          feeWallet:  feeWalletPk,
          feeAta,
          ixData,
        });

        const sig = await sendTransaction(jupTx, connection, { skipPreflight: true, maxRetries: 3 });
        setSwapTx(sig);

        const bh   = jupTx.message.recentBlockhash;
        const lvbh = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
        connection.confirmTransaction(
          { signature: sig, blockhash: bh, lastValidBlockHeight: lvbh },
          'confirmed'
        ).catch(() => {});
      }

      else if (route === '0x') {
        if (!effectiveEvmAddress || !walletClientRef.current) throw new Error('Connect an EVM wallet');
        if (evmChainId && evmChainId !== fromToken.chainId) {
          await ensureChain(fromToken.chainId);
        }
        const wc = walletClientRef.current;
        const pc = publicClientRef.current;
        if (!wc) throw new Error('Wallet not ready - try again');

        const freshOx = await fetchOxQuote({
          chainId:     fromToken.chainId,
          sellToken:   fromToken.address,
          buyToken:    toToken.address,
          sellAmount:  fromAmtRaw,
          taker:       effectiveEvmAddress,
          slipBps:     Math.round(slip * 100),
          feeRecipient: EVM_FEE_WALLET,
          feeToken:     toToken.address,
        });

        const tx = freshOx.transaction;
        if (!tx || !tx.to || !tx.data) throw new Error('0x: incomplete transaction');

        /* AllowanceHolder approval check. issues.allowance.spender is the
         * AllowanceHolder contract address; only required for non-native
         * sell tokens (native ETH/POL/etc. doesn't need approval). */
        if (!isNativeEvmFrom) {
          const allowanceInfo = freshOx.issues && freshOx.issues.allowance;
          const spender = allowanceInfo && allowanceInfo.spender;
          const need = safeBigInt(fromAmtRaw);
          let have = safeBigInt(0);
          if (spender && pc) {
            try {
              const onchain = await pc.readContract({
                address: fromToken.address,
                abi: [{
                  name: 'allowance', type: 'function', stateMutability: 'view',
                  inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
                  outputs: [{ name: '', type: 'uint256' }],
                }],
                functionName: 'allowance',
                args: [effectiveEvmAddress, spender],
              });
              have = safeBigInt(onchain);
            } catch {}
          }
          if (spender && have < need) {
            const approveData = '0x095ea7b3' +
              spender.slice(2).toLowerCase().padStart(64, '0') +
              'f'.repeat(64);
            const approveHash = await wc.sendTransaction({
              to: fromToken.address, data: approveData, value: safeBigInt(0),
            });
            if (pc) {
              try { await pc.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 }); } catch {}
            }
          }
        }

        const hash = await wc.sendTransaction({
          to:    tx.to,
          data:  tx.data,
          value: safeBigInt(tx.value),
          gas:   tx.gas ? safeBigInt(tx.gas) : undefined,
        });
        setSwapTx(hash);
      }

      else {
        throw new Error(unsupportedMsg || 'This pair is not supported.');
      }

      saveLastPair(fromToken, toToken);

      setSwapStatus('success');
      setFromAmt(''); setQuote(null); setQuoteIsStale(false);
      userTouchedAmtRef.current = false;
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
    walletConnected, onConnectWallet, route, isSupported, unsupportedMsg,
    fromAmt, fromToken, toToken, slip, publicKey, connection, sendTransaction,
    effectiveEvmAddress, evmChainId, ensureChain, isNativeEvmFrom, loginPrivy,
  ]);

  useEffect(() => {
    if (!walletConnected || !pendingSwap) return undefined;
    const t = setTimeout(() => {
      setPendingSwap(false);
      executeSwap();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnected, pendingSwap]);

  const txLink = useMemo(() => {
    if (!swapTx) return null;
    if (route === 'jupiter') return 'https://solscan.io/tx/' + swapTx;
    const exp = {
      1: 'etherscan.io', 10: 'optimistic.etherscan.io', 56: 'bscscan.com',
      130: 'uniscan.xyz', 137: 'polygonscan.com', 146: 'sonicscan.org',
      324: 'explorer.zksync.io', 2741: 'abscan.org', 5000: 'mantlescan.xyz',
      8453: 'basescan.org', 34443: 'modescan.io', 42161: 'arbiscan.io',
      43114: 'snowtrace.io', 57073: 'explorer.inkonchain.com',
      59144: 'lineascan.build', 80094: 'beratrail.io', 81457: 'blastscan.io',
      534352: 'scrollscan.com', 1101: 'zkevm.polygonscan.com',
    }[fromToken.chainId];
    if (!exp) return null;
    return 'https://' + exp + '/tx/' + swapTx;
  }, [swapTx, route, fromToken]);

  /* ============================================================================
   * RENDER
   * ========================================================================= */

  const showBuyPresets  = modeProp === 'buy' || (
    modeProp === 'swap' && fromToken &&
    /^(SOL|ETH|BNB|POL|AVAX|MNT|FTM|CRO|GLMR|CELO|SEI|RON|FUSE|KCS|HYPE|YALA|BERA|APE|FLOW|KAVA|S|CORE|MON|XPL|FLR|METIS|KAIA|USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol)
  );
  const showSellPresets = modeProp === 'sell';

  const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
  const toUsdValue   = quote && toPriceUsd > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;

  const needsSol = route === 'jupiter';
  const needsEvm = route === '0x';
  const hasNeededWallet = (needsSol && hasSolSigner) || (needsEvm && hasEvmSigner);

  const isPreview = !!(quote && quote.preview);
  const toDisplay = quote ? (isPreview ? '~' + quote.outAmountDisplay : quote.outAmountDisplay)
    : (quoteLoading ? '...' : '0.00');
  const toColor = quoteIsStale ? C.muted
    : quoteLoading && !quote ? C.muted
    : quote ? C.green
    : C.muted2;

  return (
    <div style={{ width: '100%', maxWidth: compact ? '100%' : 520, margin: '0 auto', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      {!compact && (
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Swap</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Solana &amp; major EVM chains. No KYC.</p>
        </div>
      )}

      <div style={{
        background: compact ? 'transparent' : C.card,
        border: compact ? 'none' : '1px solid ' + C.border,
        borderRadius: compact ? 0 : 18, padding: compact ? 0 : 18,
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0.1, 0.5, 1.0].map((v) => (
              <button key={v} onClick={() => setSlip(v)} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent',
                border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border),
                color: slip === v ? C.accent : C.muted, fontFamily: 'Syne, sans-serif',
                minHeight: 32,
              }}>{v}%</button>
            ))}
            <button onClick={() => setPresetEditorOpen(true)} title="Edit presets" aria-label="Edit presets" style={{
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer',
              fontSize: 16, marginLeft: 6, padding: '6px 8px', minWidth: 32, minHeight: 32,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{'\u270E'}</button>
          </div>
        </div>

        {showBuyPresets && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 6 }}>QUICK BUY</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {presets.buy.map((amt, i) => (
                <button key={'b-' + i} onClick={() => applyBuyPreset(amt)} style={{
                  flex: '1 1 0', minWidth: 56, padding: '10px 4px', borderRadius: 8,
                  border: '1px solid ' + C.border,
                  background: C.card2, color: C.muted, fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'Syne, sans-serif', minHeight: 40,
                }}>${amt}</button>
              ))}
            </div>
          </div>
        )}

        {showSellPresets && fromBalanceDisplay != null && fromBalanceDisplay > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 6 }}>QUICK SELL</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {presets.sell.map((pct, i) => (
                <button key={'s-' + i} onClick={() => applySellPreset(pct)} style={{
                  flex: 1, padding: '10px 4px', borderRadius: 8, border: '1px solid ' + C.border,
                  background: C.card2, color: C.muted, fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'Syne, sans-serif', minHeight: 40,
                }}>{pct === 100 ? 'MAX' : pct + '%'}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span>
            {fromBalanceDisplay != null && (
              <span style={{ fontSize: 11, color: C.muted }}>
                Balance: <span style={{ color: C.text }}>{fmtTokenAmount(fromBalanceDisplay)}</span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setFromSelectOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: C.card3, border: '1px solid ' + C.border,
              borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 90, flexShrink: 0,
            }}>
              <TokenIcon token={fromToken} size={20} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{fromToken && fromToken.symbol}</span>
              <ChainBadge token={fromToken} />
              <span style={{ color: C.muted, fontSize: 9 }}>v</span>
            </button>
            <input value={fromAmt} onChange={(e) => {
              userTouchedAmtRef.current = true;
              let v = e.target.value.replace(/[^0-9.]/g, '');
              const dotIdx = v.indexOf('.');
              if (dotIdx >= 0) v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, '');
              setFromAmt(v);
            }} placeholder="0.00" inputMode="decimal" style={{
              flex: 1, background: 'transparent', border: 'none',
              fontSize: 22, fontWeight: 500, color: '#fff', textAlign: 'right',
              outline: 'none', minWidth: 0, fontFamily: 'JetBrains Mono, monospace',
            }} />
            {fromBalanceDisplay != null && fromBalanceDisplay > 0 && (
              <button onClick={onMax} style={{
                background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)',
                borderRadius: 6, padding: '6px 10px', color: C.accent,
                fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                fontFamily: 'Syne, sans-serif', minHeight: 32,
              }}>MAX</button>
            )}
          </div>
          {fromAmt && fromUsdValue > 0 && (
            <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>
              {fmtUsd(fromUsdValue)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flipTokens} aria-label="Flip tokens" style={{
            width: 40, height: 40, borderRadius: 10, background: C.card3,
            border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent,
            fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{'\u21F5'}</button>
        </div>

        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
            {quoteIsStale && quoteLoading && (
              <span style={{ fontSize: 10, color: C.muted2, fontStyle: 'italic' }}>Refreshing...</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setToSelectOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: C.card3, border: '1px solid ' + C.border,
              borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 90, flexShrink: 0,
            }}>
              <TokenIcon token={toToken} size={20} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{toToken && toToken.symbol}</span>
              <ChainBadge token={toToken} />
              <span style={{ color: C.muted, fontSize: 9 }}>v</span>
            </button>
            <div style={{
              flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0,
              color: toColor,
              fontFamily: 'JetBrains Mono, monospace',
              opacity: quoteIsStale ? 0.5 : 1,
              transition: 'opacity .15s, color .15s',
            }}>
              {toDisplay}
            </div>
          </div>
          {quote && toUsdValue > 0 && (
            <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted, opacity: quoteIsStale ? 0.5 : 1 }}>
              {fmtUsd(toUsdValue)}
            </div>
          )}
        </div>

        {isPreview && (
          <div style={{
            marginTop: 6, fontSize: 11, color: C.muted,
            textAlign: 'right', fontStyle: 'italic',
          }}>
            Estimated &middot; live route on confirm
          </div>
        )}

        {!quote && !quoteError && fromAmt && parseFloat(fromAmt) > 0 &&
         (!(fromPriceUsd > 0) || !(toPriceUsd > 0)) && (
          <div style={{
            marginTop: 6, fontSize: 11, color: C.muted,
            textAlign: 'right', fontStyle: 'italic',
          }}>
            Live route on confirm
          </div>
        )}

        {!isSupported && (
          <div style={{
            marginTop: 10, padding: 10,
            background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)',
            borderRadius: 8, fontSize: 12, color: '#ff9500',
          }}>{unsupportedMsg}</div>
        )}

        {quoteError && !quoteLoading && !quote && (
          <div style={{
            marginTop: 8, padding: 10,
            background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{quoteError}</div>
        )}

        {quote && fromAmt && (
          <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
            {[
              ['Platform fee', fromUsdValue > 0 ? fmtUsd(fromUsdValue * PLATFORM_FEE) : (PLATFORM_FEE * 100).toFixed(0) + '%'],
              ['Anti-MEV / safety', fromUsdValue > 0 ? fmtUsd(fromUsdValue * SAFETY_FEE) : (SAFETY_FEE * 100).toFixed(0) + '%'],
              quote.outAmountDisplay
                ? ['Min received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken && toToken.symbol)]
                : null,
            ].filter(Boolean).map((item) => (
              <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: C.muted }}>{item[0]}</span>
                <span style={{ color: C.text }}>{item[1]}</span>
              </div>
            ))}
          </div>
        )}

        {swapError && (
          <div style={{
            marginTop: 10, padding: 10,
            background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{swapError}</div>
        )}

        {(() => {
          if (!walletConnected) {
            return (
              <button onClick={() => {
                setPendingSwap(true);
                if (loginPrivy) loginPrivy();
                else if (onConnectWallet) onConnectWallet();
              }} style={{
                width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff',
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                cursor: 'pointer', minHeight: 52,
              }}>Sign in to Swap</button>
            );
          }
          if (!isSupported) {
            return (
              <button disabled style={{
                width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                background: C.card2, color: C.muted2,
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                cursor: 'not-allowed', minHeight: 52,
              }}>Pair not supported</button>
            );
          }
          if (!hasNeededWallet) {
            return (
              <button onClick={() => {
                if (onConnectWallet) onConnectWallet();
                else if (loginPrivy) loginPrivy();
              }} style={{
                width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff',
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                cursor: 'pointer', minHeight: 52,
              }}>Connect {needsSol ? 'Solana' : 'EVM'} wallet</button>
            );
          }
          return (
            <>
              {requiresApproval && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)',
                  borderRadius: 10, fontSize: 11, color: '#ff9500', lineHeight: 1.5,
                }}>
                  <span style={{ fontWeight: 700 }}>First send of {fromToken && fromToken.symbol}: 2 wallet popups.</span>{' '}
                  <span style={{ color: '#cdd6f4' }}>
                    A one-time token approval plus the swap. Future swaps of {fromToken && fromToken.symbol} = 1 popup.
                  </span>
                </div>
              )}
              <button onClick={executeSwap}
                disabled={swapStatus === 'loading' || !fromAmt}
                style={{
                  width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                  background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                    : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
                    : !fromAmt ? C.card2
                    : modeProp === 'sell' ? C.sellGrad : C.buyGrad,
                  color: !fromAmt ? C.muted2 : swapStatus === 'error' ? C.red : '#fff',
                  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                  cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer',
                  minHeight: 52, transition: 'all .2s',
                }}>
                {swapStatus === 'loading' ? 'Confirming...'
                  : swapStatus === 'success' ? 'Confirmed!'
                  : swapStatus === 'error' ? 'Failed - try again'
                  : !fromAmt ? 'Enter amount'
                  : (modeProp === 'sell' ? 'Sell ' : modeProp === 'buy' ? 'Buy ' : 'Swap ') +
                    (fromToken ? fromToken.symbol : '') + ' \u2192 ' + (toToken ? toToken.symbol : '')}
              </button>

              {swapStatus === 'loading' && stuckSwap && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                  borderRadius: 10, fontSize: 11, color: C.muted, lineHeight: 1.4,
                }}>
                  <div style={{ color: '#fff', fontWeight: 600, marginBottom: 4 }}>Still waiting on your wallet...</div>
                  <div>If you've already signed, the transaction may still complete - check your wallet for status.</div>
                  <button onClick={cancelStuckSwap} style={{
                    marginTop: 8, background: 'transparent', border: '1px solid ' + C.red, color: C.red,
                    padding: '6px 12px', borderRadius: 6, fontSize: 11,
                    fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer',
                  }}>Reset</button>
                </div>
              )}
            </>
          );
        })()}

        {swapTx && swapStatus === 'success' && txLink && (
          <a href={txLink} target="_blank" rel="noreferrer" style={{
            display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent,
          }}>View transaction</a>
        )}

        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>
          Non-custodial - No KYC
        </p>
      </div>

      <TokenSelectModal
        open={fromSelectOpen}
        onClose={() => setFromSelectOpen(false)}
        onSelect={(t) => {
          setFromToken(t);
          setQuote(null); setQuoteError(''); setQuoteIsStale(false);
        }}
        jupiterTokens={jupiterTokens}
      />
      <TokenSelectModal
        open={toSelectOpen}
        onClose={() => setToSelectOpen(false)}
        onSelect={(t) => {
          setToToken(t);
          setQuote(null); setQuoteError(''); setQuoteIsStale(false);
        }}
        jupiterTokens={jupiterTokens}
      />
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
 * TRADE DRAWER
 * ========================================================================= */

export function TradeDrawer({
  open, onClose, mode = 'buy', coin,
  jupiterTokens, onConnectWallet,
  presets, onPresetsChange,
  // eslint-disable-next-line no-unused-vars
  headerChain: _hcIgnored,
  // eslint-disable-next-line no-unused-vars
  onHeaderChainChange: _hcChangeIgnored,
}) {
  const { connected: solConnected } = useWallet();
  const { isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const ws = { solConnected, evmConnected, evmChainId };

  const normalizedCoin = useMemo(() => (coin ? normalizeToken(coin) : null), [coin]);

  const pair = useMemo(() => {
    if (!normalizedCoin) {
      return defaultTokenPair({ mode, viewedToken: null, lastFromToken: null, walletState: ws });
    }
    return defaultTokenPair({ mode, viewedToken: normalizedCoin, lastFromToken: null, walletState: ws });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedCoin, mode, solConnected, evmConnected, evmChainId]);

  const widgetKey = useMemo(() => {
    const c = normalizedCoin || coin;
    const id = c ? (c.mint || c.address || c.id || 'tok') : 'none';
    return id + '-' + mode;
  }, [normalizedCoin, coin, mode]);

  const [swapStatus, setSwapStatus] = useState('idle');
  const isBusy = swapStatus === 'loading';

  useEffect(() => { if (open) setSwapStatus('idle'); }, [open]);

  const safeClose = useCallback(() => {
    if (isBusy) return;
    onClose();
  }, [isBusy, onClose]);

  useBodyScrollLock(open);
  useEscapeKey(open, safeClose);

  if (!open) return null;
  const symbol = (normalizedCoin && normalizedCoin.symbol) || (coin && coin.symbol) || '';
  const symbolUpper = symbol ? symbol.toUpperCase() : '';
  const headerImg = (normalizedCoin && (normalizedCoin.logoURI || normalizedCoin.image))
    || (coin && (coin.image || coin.logoURI));

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
          <div onClick={safeClose} role="button" aria-label="Close" style={{
            width: 40, height: 4, background: C.muted2, borderRadius: 2,
            margin: '0 auto 14px', cursor: isBusy ? 'default' : 'pointer',
            opacity: isBusy ? 0.4 : 1, padding: '8px 0', boxSizing: 'content-box',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {headerImg && (
                <img src={headerImg} alt={symbolUpper}
                  style={{ width: 28, height: 28, borderRadius: '50%' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div style={{ color: mode === 'buy' ? C.accent : C.red, fontWeight: 800, fontSize: 17 }}>
                {mode === 'buy' ? 'Buy' : 'Sell'} {symbolUpper}
              </div>
            </div>
            <button onClick={safeClose} disabled={isBusy} aria-label="Close" style={{
              background: 'none', border: 'none',
              color: isBusy ? C.muted2 : C.muted,
              fontSize: 26, cursor: isBusy ? 'not-allowed' : 'pointer',
              padding: 4, minWidth: 36, minHeight: 36, lineHeight: 1, opacity: isBusy ? 0.4 : 1,
            }}>x</button>
          </div>
        </div>
        <div style={{
          flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '4px 20px',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)',
        }}>
          <SwapWidget
            key={widgetKey}
            jupiterTokens={jupiterTokens}
            onConnectWallet={onConnectWallet}
            defaultFromToken={pair.fromToken}
            defaultToToken={pair.toToken}
            compact={true}
            mode={mode}
            presets={presets}
            onPresetsChange={onPresetsChange}
            onStatusChange={setSwapStatus}
          />
        </div>
      </div>
    </>
  );
}
