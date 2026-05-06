/**
 * NEXUS DEX - Unified Swap Widget
 *
 * Behavior contract (locked):
 *   1. NO header chain selector. Routing is driven entirely by the from/to
 *      tokens. Defaults come from the connected wallet's actual state, and
 *      from the user's last-used pair via localStorage.
 *   2. ONE wallet popup per swap action for external wallets. Privy embedded
 *      wallets sign silently (configured in WalletContext via Privy's
 *      noPromptOnSignature). ERC20 first-send still adds 1 approval popup
 *      because that's the underlying chain's requirement, not ours.
 *   3. Fees: 5% same-chain, 8% cross-chain. ALWAYS taken from output via
 *      the aggregator's own fee mechanism. Never bundled separately.
 *   4. Pricing: aggregator only, NEVER CoinGecko.
 *        Solana  -> Jupiter price API
 *        EVM/BTC -> LiFi tokens API priceUSD
 *   5. Route picker:
 *        Solana <-> Solana                       -> Jupiter
 *        EVM <-> EVM, same chain, 0x supported   -> 0x (Permit2)
 *        Anything else                           -> LiFi
 *      0x failures fall back to LiFi automatically.
 *   6. Quotes work without a connected wallet:
 *        - Jupiter: doesn't need any address (already address-free)
 *        - 0x: omit taker entirely (v2 returns price-only when taker absent)
 *        - LiFi: pass a known-rich placeholder address so simulation passes
 *      User connects only when they actually press the swap button.
 *   7. Buy mode: from = native of the viewed token's chain, to = the token.
 *      Sell mode: from = the token, to = USDC of the token's chain.
 *      Swap mode: from = wallet's native (or last-used), to = USDC.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { useAccount, useWalletClient, useBalance, useSwitchChain, usePublicClient } from 'wagmi';
import {
  VersionedTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

/* ============================================================================
 * CONSTANTS
 * ========================================================================= */

const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const EVM_FEE_WALLET = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';

const PLATFORM_FEE = 0.03;
const SAFETY_FEE   = 0.02;
const CROSS_FEE    = 0.03;
const TOTAL_FEE    = PLATFORM_FEE + SAFETY_FEE;          // 0.05
const TOTAL_FEE_CC = TOTAL_FEE + CROSS_FEE;              // 0.08
const LIFI_INTEGRATOR = 'nexus-dex';
const JUPITER_PLATFORM_FEE_BPS = Math.round(TOTAL_FEE * 10000);
const OX_SWAP_FEE_BPS          = Math.round(TOTAL_FEE * 10000);

const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WSOL_MINT  = 'So11111111111111111111111111111111111111112';

const SOL_RESERVE_LAMPORTS   = 5_000_000;
const EVM_NATIVE_RESERVE_PCT = 0.005;

const QUOTE_DEBOUNCE_MS  = 250;
const QUOTE_TIMEOUT_MS   = 12_000;
const PRICE_CACHE_TTL_MS = 60_000;

/* Preview addresses for un-connected quotes. Vitalik's wallet holds basically
 * every common ERC20 across every major EVM chain, so any LiFi/0x simulation
 * against it passes regardless of the source token. The Solana address below
 * is the System Program ("11111...") - it always exists, and Jupiter quotes
 * don't actually need a user address anyway, but LiFi expects something. */
const PREVIEW_EVM_ADDR = '0xd8dA6BF26964aF9D7eED9e03E53415D37aA96045';
const PREVIEW_SOL_ADDR = '11111111111111111111111111111111';
const PREVIEW_BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

/* 0x v2 supported chains (Settler/Permit2 deployed). Anything outside this
 * set falls through to LiFi automatically. */
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
  9745: 'PlasmaChain', 999: 'HyperEVM', 4217: 'Yala',
  20000000000001: 'Bitcoin',
};
const CHAIN_SHORT = {
  1:'ETH',10:'OP',25:'CRO',56:'BNB',100:'GNO',130:'UNI',137:'POL',143:'MON',146:'SONIC',
  250:'FTM',252:'FRAX',255:'KROMA',288:'BOBA',324:'zkSync',480:'WORLD',747:'FLOW',
  1116:'CORE',1135:'LISK',1284:'GLMR',1329:'SEI',2020:'RON',2222:'KAVA',2741:'ABS',
  5000:'MNT',8453:'BASE',34443:'MODE',42161:'ARB',42220:'CELO',43111:'HEMI',43114:'AVAX',
  48900:'ZIRC',57073:'INK',59144:'LINEA',60808:'BOB',80094:'BERA',81457:'BLAST',
  200901:'BTRL',534352:'SCROLL',6342:'MEGA',321:'KCC',360:'SHAPE',33139:'APE',
  167000:'TAIKO',7777777:'ZORA',122:'FUSE',1313161554:'AURORA',1088:'METIS',14:'FLR',
  9745:'XPL',999:'HYPE',4217:'YALA',20000000000001:'BTC',
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

/* Defaults match the new card / detail-page spec:
 *   Cards          show first 3 buy presets        (e.g. $25, $50, $100)
 *   Detail page    shows all 5 buy presets         + 2 sell presets
 *   Swap drawer    shows whatever the user has saved
 */
const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [50, 100];
const PRESETS_LS_KEY      = 'nexus_presets_v2';
const LAST_PAIR_LS_KEY    = 'nexus_last_pair_v1';

let _lifiTokensCache  = null;
let _lifiTokensInflight = null;

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
  { address: 'bitcoin', chainId: 20000000000001, symbol: 'BTC', name: 'Bitcoin', decimals: 8, chain: 'bitcoin',
    logoURI: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' },
];

/* ============================================================================
 * TYPE GUARDS / VALIDATORS / FORMATTERS
 * ========================================================================= */

const isSol = (t) => !!(t && t.chain === 'solana');
const isEvm = (t) => !!(t && t.chain === 'evm');
const isBtc = (t) => !!(t && t.chain === 'bitcoin');

function isValidSolMint(s) {
  return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function isValidEvmAddr(s) { return !!s && /^0x[0-9a-fA-F]{40}$/.test(s); }
function isValidBtcAddr(s) {
  if (!s || typeof s !== 'string') return false;
  const v = s.trim();
  if (/^bc1[ac-hj-np-z02-9]{6,87}$/i.test(v)) return true;
  if (/^[13]{25,34}$/.test(v)) return true;
  return false;
}

function tokensEqual(a, b) {
  if (!a || !b) return false;
  if (isSol(a) && isSol(b)) return a.mint === b.mint;
  if (isBtc(a) && isBtc(b)) return true;
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

/* BigInt-safe decimal-string -> raw smallest-units. */
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
 * NATIVE COIN RESOLUTION + TOKEN NORMALIZATION
 * ========================================================================= */

const NATIVE_COIN_RESOLVE = {
  'ethereum':                { kind: 'evm-native', chainId: 1 },
  'binancecoin':             { kind: 'evm-native', chainId: 56 },
  'matic-network':           { kind: 'evm-native', chainId: 137 },
  'polygon-ecosystem-token': { kind: 'evm-native', chainId: 137 },
  'avalanche-2':             { kind: 'evm-native', chainId: 43114 },
  'fantom':                  { kind: 'evm-native', chainId: 250 },
  'sonic-3':                 { kind: 'evm-native', chainId: 146 },
  's':                       { kind: 'evm-native', chainId: 146 },
  'celo':                    { kind: 'evm-native', chainId: 42220 },
  'xdai':                    { kind: 'evm-native', chainId: 100 },
  'cronos':                  { kind: 'evm-native', chainId: 25 },
  'moonbeam':                { kind: 'evm-native', chainId: 1284 },
  'kava':                    { kind: 'evm-native', chainId: 2222 },
  'mantle':                  { kind: 'evm-native', chainId: 5000 },
  'core':                    { kind: 'evm-native', chainId: 1116 },
  'flare-networks':          { kind: 'evm-native', chainId: 14 },
  'metis-token':             { kind: 'evm-native', chainId: 1088 },
  'sei-network':             { kind: 'evm-native', chainId: 1329 },
  'berachain-bera':          { kind: 'evm-native', chainId: 80094 },
  'monad':                   { kind: 'evm-native', chainId: 143 },
  'ronin':                   { kind: 'evm-native', chainId: 2020 },
  'kucoin-shares':           { kind: 'evm-native', chainId: 321 },
  'flow':                    { kind: 'evm-native', chainId: 747 },
  'lisk':                    { kind: 'evm-native', chainId: 1135 },
  'apecoin':                 { kind: 'evm-native', chainId: 33139 },
  'fuse-network-token':      { kind: 'evm-native', chainId: 122 },
  'hyperliquid':             { kind: 'evm-native', chainId: 999 },
  'plasma':                  { kind: 'evm-native', chainId: 9745 },
  'aurora-near':             { kind: 'evm-native', chainId: 1313161554 },
  'solana':                  { kind: 'solana' },
  'bitcoin':                 { kind: 'btc' },
};

const BTC_RESOLVE_SHAPE = {
  chain: 'bitcoin', address: 'bitcoin', chainId: 20000000000001,
  symbol: 'BTC', name: 'Bitcoin', decimals: 8,
};

function normalizeToken(input, opts = {}) {
  if (!input) return null;
  const { defaultChainId = 1 } = opts;
  const nativeRule = input.id ? NATIVE_COIN_RESOLVE[input.id] : null;
  if (nativeRule) {
    const baseLogo = input.logoURI || input.image || input.thumbnail || null;
    const baseSym  = input.symbol || (nativeRule.kind === 'btc' ? 'BTC' : nativeRule.kind === 'solana' ? 'SOL' : 'TOKEN');
    const baseName = input.name || baseSym;
    if (nativeRule.kind === 'evm-native')
      return { chain: 'evm', address: NATIVE_EVM, chainId: nativeRule.chainId, symbol: baseSym, name: baseName, decimals: 18, logoURI: baseLogo };
    if (nativeRule.kind === 'solana')
      return { chain: 'solana', mint: WSOL_MINT, symbol: baseSym, name: baseName, decimals: 9, logoURI: baseLogo };
    if (nativeRule.kind === 'btc')
      return Object.assign({}, BTC_RESOLVE_SHAPE, { logoURI: baseLogo });
  }
  if (isSol(input) && input.mint) return input;
  if (isEvm(input) && input.address && input.chainId) return input;
  if (isBtc(input)) return input;

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
  8453:{symbol:'ETH',name:'ETH (Base)'},33139:{symbol:'APE',name:'ApeCoin'},
  34443:{symbol:'ETH',name:'ETH (Mode)'},42161:{symbol:'ETH',name:'ETH (Arbitrum)'},
  42220:{symbol:'CELO',name:'Celo'},43111:{symbol:'ETH',name:'ETH (Hemi)'},
  43114:{symbol:'AVAX',name:'Avalanche'},48900:{symbol:'ETH',name:'ETH (Zircuit)'},
  57073:{symbol:'ETH',name:'ETH (Ink)'},59144:{symbol:'ETH',name:'ETH (Linea)'},
  60808:{symbol:'ETH',name:'ETH (BOB)'},80094:{symbol:'BERA',name:'Berachain'},
  81457:{symbol:'ETH',name:'ETH (Blast)'},167000:{symbol:'ETH',name:'ETH (Taiko)'},
  200901:{symbol:'BTC',name:'Bitlayer BTC'},534352:{symbol:'ETH',name:'ETH (Scroll)'},
  7777777:{symbol:'ETH',name:'ETH (Zora)'},
};

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
  if (isBtc(t)) return 'bitcoin';
  if (isEvm(t)) return t.chainId;
  return null;
}

/* ============================================================================
 * DEFAULT TOKEN PAIR - driven by wallet state and last-used pair, NEVER by
 * a header chain selector. The viewedToken arg comes from TradeDrawer when a
 * specific token is being bought or sold; otherwise the function picks
 * sensible defaults from what the user is connected to.
 *
 * Priority order for fresh visits:
 *   1. lastFromToken from localStorage           (returning user)
 *   2. Solana wallet connected -> SOL/USDC      (most common user)
 *   3. EVM wallet connected -> native/USDC      (EVM-only user)
 *   4. Hardcoded SOL -> USDC                    (cold visit)
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

  /* Buy mode with a specific token -> from = native of token's chain */
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

  /* Sell mode with a specific token -> to = USDC of token's chain */
  if (mode === 'sell' && viewed) {
    const tokenChain = chainOfToken(viewed);
    const toCandidates = [
      usdcOfChain(tokenChain),
      nativeOfChain(tokenChain),
      POPULAR_TOKENS[1], POPULAR_TOKENS[0],
    ];
    return { fromToken: viewed, toToken: pickDistinct(viewed, toCandidates) || POPULAR_TOKENS[1] };
  }

  /* Generic swap mode with no specific token */
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
 * ROUTE PICKER + LIFI SAME-CHAIN DETECTOR
 * ========================================================================= */

function pickRoute(from, to) {
  if (!from || !to) return 'lifi';
  if (isSol(from) && isSol(to)) return 'jupiter';
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId && OX_CHAIN_IDS.has(from.chainId)) return '0x';
  return 'lifi';
}
/* LiFi handles same-chain EVM fallback (chains 0x doesn't support) AND
 * cross-chain. Fee rate must match the locked rule:
 *   same-chain  -> 5%   (TOTAL_FEE)
 *   cross-chain -> 8%   (TOTAL_FEE_CC) */
function isLifiSameChain(from, to) {
  return isEvm(from) && isEvm(to) && from.chainId === to.chainId;
}

/* ============================================================================
 * AGGREGATOR HELPERS (all proxied through server.js - no API keys in browser)
 * ========================================================================= */

function lifiChainParam(t) {
  if (isSol(t)) return 'SOL';
  if (isBtc(t)) return 'BTC';
  return String(t.chainId);
}
function lifiTokenParam(t) {
  if (isSol(t)) return t.mint;
  if (isBtc(t)) return 'bitcoin';
  return t.address;
}

async function fetchLifiTokens() {
  if (_lifiTokensCache) return _lifiTokensCache;
  if (_lifiTokensInflight) return _lifiTokensInflight;
  _lifiTokensInflight = fetch('/api/lifi/tokens?chainTypes=EVM,SVM,UTXO')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      _lifiTokensInflight = null;
      if (data && data.tokens && Object.keys(data.tokens).length > 0) {
        _lifiTokensCache = data;
        return data;
      }
      return { tokens: {} };
    });
  return _lifiTokensInflight;
}

/* LiFi quote. fromAddress / toAddress are required by the API but only
 * used for simulation. For preview-only quotes, we substitute placeholder
 * addresses in the caller (see fetchQuote in SwapWidget). */
async function fetchLifiQuote({ fromToken, toToken, fromAmtRaw, fromAddress, toAddress, slip, signal }) {
  const feeRate = isLifiSameChain(fromToken, toToken) ? TOTAL_FEE : TOTAL_FEE_CC;
  const params = new URLSearchParams({
    fromChain: lifiChainParam(fromToken),
    toChain:   lifiChainParam(toToken),
    fromToken: lifiTokenParam(fromToken),
    toToken:   lifiTokenParam(toToken),
    fromAmount: String(fromAmtRaw),
    fromAddress,
    toAddress: toAddress || fromAddress,
    slippage: String(slip / 100),
    fee: String(feeRate),
    integrator: LIFI_INTEGRATOR,
  });
  const res = await fetch('/api/lifi/quote?' + params.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'LiFi quote failed');
  if (!data.estimate || !data.estimate.toAmount) throw new Error('No route');
  return data;
}

/* 0x v2 quote.
 *   - When `taker` is undefined/empty, we OMIT the parameter entirely so 0x
 *     returns a price-only quote without simulating against an address that
 *     may not have balance. This lets us show prices before wallet connect.
 *   - When the user actually executes, the caller passes their real address,
 *     which produces a quote with calldata + permit2 typed-data. */
async function fetchOxQuote({ chainId, sellToken, buyToken, sellAmount, taker, slipBps, feeRecipient, feeToken, signal }) {
  const qs = new URLSearchParams({
    chainId: String(chainId),
    sellToken: (sellToken || '').toLowerCase(),
    buyToken:  (buyToken  || '').toLowerCase(),
    sellAmount: String(sellAmount),
    slippageBps: String(slipBps),
    swapFeeBps: String(OX_SWAP_FEE_BPS),
    swapFeeRecipient: feeRecipient,
    swapFeeToken: (feeToken || '').toLowerCase(),
    tradeSurplusRecipient: feeRecipient,
  });
  if (taker && isValidEvmAddr(taker)) {
    qs.set('taker', taker);
  }
  const res = await fetch('/api/0x/swap/permit2/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '0x quote failed');
  if (!data.buyAmount) throw new Error('No route');
  return data;
}

/* Jupiter quote. Doesn't need a user address at all. */
async function fetchJupiterQuote({ inputMint, outputMint, amountRaw, slipBps, signal }) {
  const qs = new URLSearchParams({
    inputMint, outputMint,
    amount: String(amountRaw),
    slippageBps: String(slipBps),
    onlyDirectRoutes: 'false',
    platformFeeBps: String(JUPITER_PLATFORM_FEE_BPS),
  });
  const res = await fetch('/api/jupiter/swap/v1/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Jupiter quote failed');
  if (!data.outAmount) throw new Error('No route');
  return data;
}

async function fetchJupiterSwapTx({ quoteResponse, userPublicKey, feeAccount, signal }) {
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
  };
  if (feeAccount) body.feeAccount = feeAccount;
  const res = await fetch('/api/jupiter/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.swapTransaction) throw new Error(data.error || 'Jupiter swap build failed');
  return data;
}

/* ============================================================================
 * USD PRICING (aggregator-derived, NEVER CoinGecko). Cached 60s.
 * ========================================================================= */

const _priceCache = new Map();
function _priceCacheKey(token) {
  if (!token) return null;
  if (isSol(token)) return 'sol:' + token.mint;
  if (isBtc(token)) return 'btc';
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

async function fetchJupiterPrice(mints) {
  const ids = (Array.isArray(mints) ? mints : [mints]).filter(Boolean).join(',');
  if (!ids) return {};
  try {
    const res = await fetch('/api/jupiter/price/v2?ids=' + encodeURIComponent(ids));
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    if (data && data.data) {
      Object.keys(data.data).forEach((mint) => {
        const p = data.data[mint];
        if (p && p.price != null) out[mint] = Number(p.price);
      });
    }
    return out;
  } catch { return {}; }
}

async function fetchLifiPriceFromIndex(token) {
  try {
    const data = await fetchLifiTokens();
    if (!data || !data.tokens) return null;
    const chainId = isBtc(token) ? 20000000000001 : token.chainId;
    const list = data.tokens[String(chainId)];
    if (!list) return null;
    const target = isBtc(token) ? 'bitcoin' : (token.address || '').toLowerCase();
    const match = list.find((t) => (t.address || '').toLowerCase() === target);
    if (!match) return null;
    const p = parseFloat(match.priceUSD);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch { return null; }
}

async function getTokenPriceUsd(token) {
  if (!token) return null;
  const cached = getCachedPrice(token);
  if (cached != null) return cached;
  if (isSol(token)) {
    const map = await fetchJupiterPrice([token.mint]);
    const p = map[token.mint];
    if (p != null) { setCachedPrice(token, p); return p; }
    return null;
  }
  const p = await fetchLifiPriceFromIndex(token);
  if (p != null) { setCachedPrice(token, p); return p; }
  return null;
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

/* Aggregators take fees from OUTPUT, so user input is the FULL amount.
 * We only reserve gas headroom on native tokens. */
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
  const label = isSol(token) ? 'SOL' : isBtc(token) ? 'BTC' : (CHAIN_SHORT[token.chainId] || 'EVM');
  const color = isSol(token) ? '#9945ff' : isBtc(token) ? '#f7931a' : '#627eea';
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

/* Body scroll lock uses a CSS class from App.js's GLOBAL_STYLES instead of
 * setting touch-action: none, which broke modal scrolling on iOS. */
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
 *
 *   - Searches across Jupiter (Solana), LiFi tokens index (every EVM chain),
 *     and POPULAR_TOKENS (curated).
 *   - Contract paste lookup runs on input (debounced 350ms), not on blur.
 *   - For pasted EVM addresses, decimals are read on-chain via the connected
 *     wallet's current chain. If no EVM wallet is connected, we read from
 *     Ethereum mainnet by default and surface a hint to the user that they
 *     may need to switch chains. With the header selector gone, this is the
 *     cleanest fallback - the user can correct chain at the select moment.
 * ========================================================================= */

function TokenSelectModal({ open, onClose, onSelect, jupiterTokens, excludeBtc }) {
  const [q, setQ] = useState('');
  const [contractInput, setContractInput] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [evmIndex, setEvmIndex] = useState([]);

  /* Connected EVM wallet's current chain becomes the default for pasted EVM
   * contract lookups. If no wallet, fall back to Ethereum mainnet. */
  const { chainId: evmWalletChainId } = useAccount();
  const evmChainForLookup = evmWalletChainId || 1;
  const publicClient = usePublicClient({ chainId: evmChainForLookup });

  useEffect(() => {
    if (!open) return undefined;
    let aborted = false;
    fetchLifiTokens().then((data) => {
      if (aborted || !data || !data.tokens) return;
      const arr = [];
      Object.values(data.tokens).forEach((chainTokens) => {
        chainTokens.forEach((t) => {
          if (!t.symbol || !t.address || !t.chainId) return;
          const cid = Number(t.chainId);
          if (!Number.isFinite(cid) || cid > 1_000_000_000) return;
          arr.push({
            chain: 'evm', address: t.address, chainId: cid,
            symbol: t.symbol, name: t.name || t.symbol,
            decimals: t.decimals || 18, logoURI: t.logoURI || null,
          });
        });
      });
      setEvmIndex(arr);
    });
    return () => { aborted = true; };
  }, [open]);

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
      const btcMatches = POPULAR_TOKENS.filter((t) =>
        isBtc(t) && (
          (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
          (t.name && t.name.toLowerCase().includes(ql))
        )
      );
      setSearchResults([...sol, ...evmCombined, ...btcMatches]);
    }, 250);
    return () => clearTimeout(handle);
  }, [q, solTokens, evmIndex]);

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
            const r = await fetch('/api/jupiter/tokens/v1/token/' + trimmed);
            if (lookupReqRef.current !== reqId) return;
            if (r.ok) {
              const d = await r.json();
              if (lookupReqRef.current !== reqId) return;
              if (d && d.address) {
                resolved = {
                  chain: 'solana', mint: d.address,
                  symbol: d.symbol || shortAddr(d.address, 4, 4),
                  name: d.name || 'Unknown',
                  decimals: typeof d.decimals === 'number' ? d.decimals : 6,
                  logoURI: d.logoURI || null,
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
        /* EVM address. Resolve from LiFi index across every chain it appears
         * on; if multi-chain, prefer the user's currently-connected chain. */
        const targetAddr = trimmed.toLowerCase();
        const allMatches = evmIndex.filter((t) => (t.address || '').toLowerCase() === targetAddr);
        const preferred = evmWalletChainId ? allMatches.find((t) => t.chainId === evmWalletChainId) : null;
        const found = preferred || allMatches[0];

        if (found) {
          if (lookupReqRef.current === reqId) setContractToken(found);
        } else {
          /* Not in any index. Read on-chain decimals + symbol from the
           * wallet's current EVM chain. If no wallet, default to Ethereum
           * mainnet -- the user can change chains by selecting the right
           * version from search results, or by using a wallet on the
           * correct chain. */
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
      }
    } catch {
      if (lookupReqRef.current === reqId) setContractToken(null);
    }
    if (lookupReqRef.current === reqId) setContractLoading(false);
  }, [solTokens, evmIndex, evmWalletChainId, evmChainForLookup, publicClient]);

  /* Debounce lookup on input change. */
  useEffect(() => {
    const v = contractInput.trim();
    if (!v) { setContractToken(null); return undefined; }
    const handle = setTimeout(() => { lookupContract(v); }, 350);
    return () => clearTimeout(handle);
  }, [contractInput, lookupContract]);

  const close = () => {
    setQ(''); setContractInput(''); setContractToken(null); setSearchResults([]);
    onClose();
  };

  useBodyScrollLock(open);
  useEscapeKey(open, close);

  const display = q.trim() ? searchResults : (excludeBtc ? POPULAR_TOKENS.filter((t) => !isBtc(t)) : POPULAR_TOKENS);

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
            <div onClick={() => { onSelect(contractToken); close(); }} style={{
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
          {q.trim() && searchResults.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found.
              <div style={{ fontSize: 11, marginTop: 4 }}>Paste the contract address above.</div>
            </div>
          )}
          {display.map((t, i) => {
            const key = (t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i;
            return (
              <div key={key} onClick={() => { onSelect(t); close(); }}
                style={{
                  padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
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
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * PRESET EDITOR - bottom sheet, sticky save, big tap targets.
 *
 * Two sections: BUY (USD amounts, up to 5) and SELL (% of holdings, up to 4).
 * Removed the centered-modal/cramped-spacing problems from the previous
 * version that made it feel "jenky" on mobile.
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
        {/* Drag handle (visual only) + title */}
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

        {/* Scrollable body */}
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

        {/* Sticky save bar */}
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
 *
 * Props:
 *   jupiterTokens     - Solana token list (from parent)
 *   onConnectWallet   - opens app's wallet modal
 *   defaultFromToken  - optional, used by TradeDrawer to seed buy/sell mode
 *   defaultToToken    - optional, used by TradeDrawer
 *   compact           - boolean, hides title block when true
 *   mode              - 'swap' | 'buy' | 'sell' (default 'swap')
 *   presets           - { buy:[], sell:[] } from parent (or loaded internally)
 *   onPresetsChange   - bubble preset changes for global sync
 *   onStatusChange    - TradeDrawer hooks this to lock dismissal during tx
 *
 * Removed props: headerChain, onHeaderChainChange. Routing is now driven
 * entirely by the from/to tokens. The props are still accepted (silently
 * ignored) so existing callers don't break.
 *
 * NOTE: Pricing comes from aggregators only (Jupiter price API for SOL,
 * LiFi tokens index priceUSD for EVM/BTC). No CoinGecko anywhere.
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
  /* legacy / silently ignored: */
  // eslint-disable-next-line no-unused-vars
  headerChain: _hcIgnored,
  // eslint-disable-next-line no-unused-vars
  onHeaderChainChange: _hcChangeIgnored,
}) {
  /* ---- Wallet hooks ---- */
  const { publicKey: extPublicKey, sendTransaction: extSolSendTx, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const nexus = useNexusWallet();
  const { activeWalletKind, privyEmbeddedSol, privyEmbeddedEvm, loginPrivy } = nexus;

  /* Unified Solana publicKey (external wallet OR Privy embedded). */
  const publicKey = useMemo(() => {
    if (extPublicKey) return extPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch (e) { return null; }
    }
    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  /* True iff the user has a usable Solana signer (external or Privy). */
  const hasSolSigner = solConnected || (!!privyEmbeddedSol && !!publicKey);
  /* True iff the user has a usable EVM signer (external or Privy). */
  const hasEvmSigner = evmConnected || (!!privyEmbeddedEvm && !!privyEmbeddedEvm.address);

  /* The unified EVM address: external takes priority, Privy embedded fallback. */
  const effectiveEvmAddress = useMemo(() => {
    if (evmAddress) return evmAddress;
    if (privyEmbeddedEvm && privyEmbeddedEvm.address) return privyEmbeddedEvm.address;
    return null;
  }, [evmAddress, privyEmbeddedEvm]);

  /* Unified Solana sender. Privy uses noPromptOnSignature -> silent sign. */
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

  /* Aggregate "any wallet at all" - includes Privy. */
  const walletConnected = solConnected || evmConnected || hasSolSigner || hasEvmSigner;

  /* Refs to wagmi state so async paths after chain-switch read fresh values. */
  const walletClientRef = useRef(walletClient);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  const evmChainIdRef = useRef(evmChainId);
  useEffect(() => { evmChainIdRef.current = evmChainId; }, [evmChainId]);

  /* Poll-and-wait helper for chain switches. */
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

  /* ---- Initial token pair (mount-only). After mount, effects react
   *      to wallet connect / token override changes. ---- */
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

  /* ---- Amount + slippage ---- */
  const [fromAmt, setFromAmt] = useState('');
  const [slip, setSlip] = useState(0.5);
  const userTouchedAmtRef = useRef(false);

  /* ---- Quote state ---- */
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteIsStale, setQuoteIsStale] = useState(false);
  const quoteAbortRef = useRef(null);
  const quoteReqIdRef = useRef(0);

  /* ---- Swap execution state ---- */
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const swapStatusTimerRef = useRef(null);
  const [pendingSwap, setPendingSwap] = useState(false);

  /* Stuck-swap escape hatch - shows a Reset button after 30s of 'loading'. */
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

  /* ---- Solana balance ---- */
  const [solBalanceLamports, setSolBalanceLamports] = useState(null);
  const [solSplBalance, setSolSplBalance] = useState(null);

  /* ---- Cross-chain destination address ---- */
  const [customDestAddr, setCustomDestAddr] = useState('');

  /* ---- Preset state ---- */
  const [presetsLocal, setPresetsLocal] = useState(() => presetsProp || loadPresets());
  const presets = presetsProp || presetsLocal;
  const setPresets = useCallback((p) => {
    if (onPresetsChange) onPresetsChange(p);
    else { setPresetsLocal(p); savePresets(p); }
  }, [onPresetsChange]);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  /* ---- Token select modals ---- */
  const [fromSelectOpen, setFromSelectOpen] = useState(false);
  const [toSelectOpen,   setToSelectOpen]   = useState(false);

  /* ---- Derived ---- */
  const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
  const isCrossChain = route === 'lifi' && !isLifiSameChain(fromToken, toToken);
  const isEvmFrom = isEvm(fromToken);
  const isNativeEvmFrom = isEvmFrom && (fromToken.address || '').toLowerCase() === NATIVE_EVM;

  /* For Privy users on Solana (with noPromptOnSignature) the "popup" framing
   * is misleading - they don't see popups. Hide the approval banner for
   * Privy-only flows and keep it for external EVM ERC20 flows. */
  const isPrivyOnly = activeWalletKind === 'privy' && !solConnected && !evmConnected;
  const requiresApproval = isEvmFrom && !isNativeEvmFrom && (route === '0x' || route === 'lifi') && !isPrivyOnly;

  /* ---- Public client for from-token's chain ---- */
  const publicClient = usePublicClient({ chainId: isEvmFrom ? fromToken.chainId : undefined });
  const publicClientRef = useRef(publicClient);
  useEffect(() => { publicClientRef.current = publicClient; }, [publicClient]);

  /* ---- EVM balance ---- */
  const balanceAddress = effectiveEvmAddress;
  const { data: evmFromBal, refetch: refetchEvmBal } = useBalance({
    address: balanceAddress,
    token:   isEvmFrom && !isNativeEvmFrom ? fromToken.address : undefined,
    chainId: isEvmFrom ? fromToken.chainId : undefined,
    query:   { enabled: !!balanceAddress && isEvmFrom },
  });

  /* ---- Solana balance fetch ---- */
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

  /* Refetch balances after a successful swap. */
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

  /* On wallet connect, if user hasn't typed an amount, auto-replace the
   * from/to to match what they can actually trade. Skipped when TradeDrawer
   * has supplied explicit defaults. */
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

  /* Sync to parent-supplied defaults when they change AFTER mount. */
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

  /* ---- USD prices via aggregators ---- */
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
   * QUOTE ENGINE
   *
   * Works without a wallet by substituting placeholder addresses for the
   * preview-only call. Uses Vitalik's wallet for EVM (he holds every common
   * ERC20, so simulations pass) and the System Program for Solana (Jupiter
   * doesn't actually need an address; LiFi only reads the address shape).
   *
   * Per-aggregator behavior:
   *   Jupiter - no address needed, just tokens + amount
   *   0x      - omit `taker` for preview, include real address for execution
   *   LiFi    - pass the placeholder address; LiFi simulates, but Vitalik's
   *             address has every token so it passes
   *
   * Fallback: if 0x returns "no route" or any error other than rate-limit /
   * abort, automatically retry with LiFi. 0x has narrower DEX coverage on
   * less popular pairs and LiFi often fills the gap.
   * ========================================================================= */

  const fetchQuote = useCallback(async () => {
    /* Reset error-only state. Keep `quote` visible (greyed via quoteIsStale
     * below) so the user doesn't see numbers blank out on every keystroke. */
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

    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    const reqId = ++quoteReqIdRef.current;

    setQuoteLoading(true);
    setQuoteIsStale(!!quote); /* show grey if we're refreshing on top of a quote */
    const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);

    try {
      const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);
      if (fromAmtRaw === '0') return;
      const slipBps = Math.round(slip * 100);

      /* Preview addresses for un-connected quotes. Real wallet addresses
       * take priority when available. */
      const previewSrcEvm = effectiveEvmAddress || PREVIEW_EVM_ADDR;
      const previewSrcSol = publicKey ? publicKey.toString() : PREVIEW_SOL_ADDR;
      const previewDstEvm = effectiveEvmAddress || (customDestAddr.trim() && isValidEvmAddr(customDestAddr.trim()) ? customDestAddr.trim() : PREVIEW_EVM_ADDR);
      const previewDstSol = publicKey ? publicKey.toString() : (customDestAddr.trim() && isValidSolMint(customDestAddr.trim()) ? customDestAddr.trim() : PREVIEW_SOL_ADDR);
      const previewDstBtc = customDestAddr.trim() && isValidBtcAddr(customDestAddr.trim()) ? customDestAddr.trim() : PREVIEW_BTC_ADDR;

      let result = null;

      if (route === 'jupiter') {
        const data = await fetchJupiterQuote({
          inputMint:  fromToken.mint,
          outputMint: toToken.mint,
          amountRaw:  fromAmtRaw,
          slipBps,
          signal: controller.signal,
        });
        result = {
          engine: 'jupiter',
          outAmountDisplay: (Number(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: data.priceImpactPct,
          quoteResponse: data,
        };
      } else if (route === '0x') {
        try {
          const data = await fetchOxQuote({
            chainId:    fromToken.chainId,
            sellToken:  fromToken.address,
            buyToken:   toToken.address,
            sellAmount: fromAmtRaw,
            taker:      effectiveEvmAddress || undefined, /* omit when un-connected */
            slipBps,
            feeRecipient: EVM_FEE_WALLET,
            feeToken:     toToken.address,
            signal: controller.signal,
          });
          result = {
            engine: '0x',
            outAmountDisplay: (Number(data.buyAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
            priceImpactPct: 0,
            oxResponse: data,
          };
        } catch (oxErr) {
          /* Don't fall back on aborts. */
          if (oxErr.name === 'AbortError') throw oxErr;
          /* On any 0x failure, try LiFi (same chain). LiFi may have a route
           * that 0x missed -- broader DEX coverage. */
          const data = await fetchLifiQuote({
            fromToken, toToken, fromAmtRaw,
            fromAddress: previewSrcEvm,
            toAddress:   previewDstEvm,
            slip, signal: controller.signal,
          });
          result = {
            engine: 'lifi',
            outAmountDisplay: (Number(data.estimate.toAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
            priceImpactPct: 0,
            lifiResponse: data,
            fallback: true,
          };
        }
      } else {
        /* LiFi for everything else (cross-chain or unsupported same-chain). */
        const previewFrom = isSol(fromToken) ? previewSrcSol : previewSrcEvm;
        const previewTo = isBtc(toToken) ? previewDstBtc
          : isSol(toToken) ? previewDstSol
          : previewDstEvm;
        const data = await fetchLifiQuote({
          fromToken, toToken, fromAmtRaw,
          fromAddress: previewFrom,
          toAddress:   previewTo,
          slip, signal: controller.signal,
        });
        result = {
          engine: 'lifi',
          outAmountDisplay: (Number(data.estimate.toAmount) / Math.pow(10, toToken.decimals)).toFixed(6),
          priceImpactPct: 0,
          lifiResponse: data,
        };
      }

      /* Discard if a newer request is in flight. */
      if (quoteReqIdRef.current !== reqId) return;
      setQuote(result);
      setQuoteIsStale(false);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (quoteReqIdRef.current !== reqId) return;
      setQuoteError('Failed to get quote: ' + (e.message || ''));
      setQuoteIsStale(false);
    } finally {
      clearTimeout(timer);
      if (quoteReqIdRef.current === reqId) setQuoteLoading(false);
    }
  }, [fromAmt, fromToken, toToken, slip, route, effectiveEvmAddress, publicKey, customDestAddr, quote]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  /* ---- Display balance ---- */
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

  /* ---- MAX ---- */
  const onMax = useCallback(() => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    userTouchedAmtRef.current = true;
    if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
      const usable = maxSafeSolBalance(solBalanceLamports);
      setFromAmt(usable > 0 ? usable.toFixed(6) : '0');
      return;
    }
    if (isSol(fromToken)) {
      setFromAmt(fromBalanceDisplay.toFixed(6));
      return;
    }
    const max = maxSafeAmount({ balance: fromBalanceDisplay, isNative: isNativeEvmFrom });
    setFromAmt(max > 0 ? max.toFixed(fromToken.decimals <= 2 ? 2 : 6) : '0');
  }, [fromBalanceDisplay, fromToken, solBalanceLamports, isNativeEvmFrom]);

  /* ---- Quick-buy preset: "spend $X of from-token" ---- */
  const applyBuyPreset = useCallback((dollars) => {
    if (!fromToken) return;
    userTouchedAmtRef.current = true;
    if (fromPriceUsd && fromPriceUsd > 0) {
      const tokens = dollars / fromPriceUsd;
      setFromAmt(tokens > 0 ? tokens.toFixed(6) : '0');
      return;
    }
    /* No price yet - if from-token is a stablecoin, $X is just X tokens. */
    if (/^(USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol || '')) {
      setFromAmt(String(dollars));
    }
    /* Otherwise wait for price; quote will refresh when it loads. */
  }, [fromToken, fromPriceUsd]);

  /* ---- Quick-sell preset: "Sell X% of balance" ---- */
  const applySellPreset = useCallback((pct) => {
    if (fromBalanceDisplay == null || fromBalanceDisplay <= 0) return;
    userTouchedAmtRef.current = true;
    const isNative = isSol(fromToken) ? fromToken.mint === WSOL_MINT : isNativeEvmFrom;
    let amount = fromBalanceDisplay * (pct / 100);
    if (pct === 100) {
      if (isSol(fromToken) && fromToken.mint === WSOL_MINT) {
        amount = maxSafeSolBalance(solBalanceLamports);
      } else if (isNative) {
        amount = maxSafeAmount({ balance: fromBalanceDisplay, isNative: true });
      }
    }
    setFromAmt(amount > 0 ? amount.toFixed(6) : '0');
  }, [fromBalanceDisplay, fromToken, isNativeEvmFrom, solBalanceLamports]);

  const flipTokens = useCallback(() => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt(''); setQuote(null); setQuoteError(''); setQuoteIsStale(false); setCustomDestAddr('');
    userTouchedAmtRef.current = false;
  }, [fromToken, toToken]);

  const needsDestAddr = useMemo(() => {
    if (route !== 'lifi' || isLifiSameChain(fromToken, toToken)) return false;
    if (isBtc(toToken)) return true;
    if (isSol(toToken) && !publicKey) return true;
    if (isEvm(toToken) && !effectiveEvmAddress) return true;
    return false;
  }, [route, fromToken, toToken, publicKey, effectiveEvmAddress]);

  /* ============================================================================
   * EXECUTE SWAP
   *
   * Jupiter: ONE silent sign for Privy (noPromptOnSignature) or ONE popup for
   * external wallets. Fee bundled via platformFeeBps + feeAccount.
   *
   * 0x Permit2: Native source = 1 sig. ERC20 = 2 sigs (typed-data + tx).
   * Fee taken via swapFeeBps. Privy embedded EVM signs silently.
   *
   * LiFi: Solana source = 1 sig. EVM native source = 1 sig. EVM ERC20 source
   * = 2 sigs (approve + bridge). Fee = 5% same-chain or 8% cross-chain.
   * ========================================================================= */
  const executeSwap = useCallback(async () => {
    if (!walletConnected) {
      /* No wallet at all - queue the swap, open Privy login (or fall back
       * to the wallet modal). useEffect below auto-fires after connect. */
      setPendingSwap(true);
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!quote) return;

    if (swapStatusTimerRef.current) {
      clearTimeout(swapStatusTimerRef.current);
      swapStatusTimerRef.current = null;
    }
    setSwapStatus('loading'); setSwapError(''); setSwapTx(null);

    /* Determine actual engine to use. The quote may have come back via
     * fallback (0x -> LiFi), in which case we need to honor that. */
    const engineUsed = quote.engine || route;

    try {
      const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);

      /* ============ JUPITER ============ */
      if (engineUsed === 'jupiter') {
        if (!publicKey) throw new Error('Connect a Solana wallet');
        const outputMintPk = new PublicKey(toToken.mint);
        const feeWalletPk  = new PublicKey(SOL_FEE_WALLET);
        const feeAta = await getAssociatedTokenAddress(outputMintPk, feeWalletPk);

        /* Always re-quote at execution time -- the cached preview quote is
         * fine for display but the swap-build endpoint wants a fresh one. */
        const freshQuote = await fetchJupiterQuote({
          inputMint:  fromToken.mint,
          outputMint: toToken.mint,
          amountRaw:  fromAmtRaw,
          slipBps:    Math.round(slip * 100),
        });

        const swapData = await fetchJupiterSwapTx({
          quoteResponse: freshQuote,
          userPublicKey: publicKey.toString(),
          feeAccount:    feeAta.toBase58(),
        });

        const jupTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
        const sig = await sendTransaction(jupTx, connection, { skipPreflight: true, maxRetries: 3 });
        setSwapTx(sig);

        /* Confirm against the blockhash that's already in the tx. */
        const bh   = jupTx.message.recentBlockhash;
        const lvbh = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
        connection.confirmTransaction(
          { signature: sig, blockhash: bh, lastValidBlockHeight: lvbh },
          'confirmed'
        ).catch(() => {});
      }

      /* ============ 0X (EVM same-chain Permit2) ============ */
      else if (engineUsed === '0x') {
        if (!effectiveEvmAddress || !walletClientRef.current) throw new Error('Connect an EVM wallet');
        if (evmChainId && evmChainId !== fromToken.chainId) {
          await ensureChain(fromToken.chainId);
        }
        const wc = walletClientRef.current;
        if (!wc) throw new Error('Wallet not ready -- try again');

        /* Re-quote with the real taker so we get calldata + permit2. */
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
        const permit2 = freshOx.permit2;
        const tx = freshOx.transaction;
        if (!tx || !tx.to || !tx.data) throw new Error('0x: incomplete transaction');

        let finalTxData = tx.data;
        if (permit2 && permit2.eip712) {
          const signature = await wc.signTypedData({
            domain:      permit2.eip712.domain,
            types:       permit2.eip712.types,
            primaryType: permit2.eip712.primaryType,
            message:     permit2.eip712.message,
          });
          const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
          const sigLen = (sigHex.length / 2).toString(16).padStart(64, '0');
          finalTxData = tx.data + sigLen + sigHex;
        }

        const hash = await wc.sendTransaction({
          to:    tx.to,
          data:  finalTxData,
          value: tx.value ? BigInt(tx.value) : BigInt(0),
          gas:   tx.gas ? BigInt(tx.gas) : undefined,
        });
        setSwapTx(hash);
      }

      /* ============ LIFI (cross-chain or unsupported same-chain EVM) ============ */
      else {
        if (isBtc(fromToken)) {
          throw new Error('Sending FROM Bitcoin is not yet supported. Pick another source token.');
        }
        const srcAddr = isSol(fromToken)
          ? (publicKey ? publicKey.toString() : null)
          : (effectiveEvmAddress || null);
        const dstAddr = isBtc(toToken)
          ? customDestAddr.trim()
          : isSol(toToken)
            ? (publicKey ? publicKey.toString() : customDestAddr.trim())
            : (effectiveEvmAddress || customDestAddr.trim());

        if (!srcAddr) throw new Error('Connect your ' + (isSol(fromToken) ? 'Solana' : 'EVM') + ' wallet');
        if (!dstAddr) throw new Error('Enter destination wallet address');
        if (isSol(toToken) && !isValidSolMint(dstAddr)) throw new Error('Invalid Solana destination address');
        if (isEvm(toToken) && !isValidEvmAddr(dstAddr)) throw new Error('Invalid EVM destination address');
        if (isBtc(toToken) && !isValidBtcAddr(dstAddr)) throw new Error('Invalid Bitcoin destination address');

        /* Re-quote with the user's real address. */
        const freshLifi = await fetchLifiQuote({
          fromToken, toToken, fromAmtRaw,
          fromAddress: srcAddr, toAddress: dstAddr, slip,
        });
        if (!freshLifi.transactionRequest) throw new Error('LiFi: no transaction returned');
        const txReq = freshLifi.transactionRequest;

        if (isSol(fromToken)) {
          if (!publicKey) throw new Error('Connect Solana wallet');
          const lifiSolTx = VersionedTransaction.deserialize(Buffer.from(txReq.data, 'base64'));
          const lifiBh = lifiSolTx.message.recentBlockhash;
          const lvbh = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
          const sig = await sendTransaction(lifiSolTx, connection, { skipPreflight: true, maxRetries: 3 });
          setSwapTx(sig);
          connection.confirmTransaction(
            { signature: sig, blockhash: lifiBh, lastValidBlockHeight: lvbh },
            'confirmed'
          ).catch(() => {});
        } else {
          if (!effectiveEvmAddress || !walletClientRef.current) throw new Error('Connect EVM wallet');
          if (evmChainId && evmChainId !== fromToken.chainId) {
            await ensureChain(fromToken.chainId);
          }
          const wc = walletClientRef.current;
          const pc = publicClientRef.current;
          if (!wc) throw new Error('Wallet not ready -- try again');

          const isNativeFrom = (fromToken.address || '').toLowerCase() === NATIVE_EVM;
          if (!isNativeFrom) {
            const spender = txReq.to;
            const sellBig = BigInt(fromAmtRaw);
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
                  args: [effectiveEvmAddress, spender],
                });
                needsApprove = BigInt(allowance) < sellBig;
              } catch {}
            }
            if (needsApprove) {
              /* Max-uint approval -- subsequent swaps of this token are 1 sig. */
              const approveData = '0x095ea7b3' +
                spender.slice(2).padStart(64, '0') +
                'f'.repeat(64);
              const approveHash = await wc.sendTransaction({
                to: fromToken.address, data: approveData, value: BigInt(0),
              });
              if (pc) {
                try { await pc.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 }); } catch {}
              }
            }
          }

          const hash = await wc.sendTransaction({
            to:    txReq.to,
            data:  txReq.data,
            value: txReq.value ? BigInt(txReq.value) : BigInt(0),
            gas:   txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
          });
          setSwapTx(hash);
        }
      }

      /* Persist the pair the user just swapped so we restore it next visit. */
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
    walletConnected, onConnectWallet, quote, route, fromAmt, fromToken, toToken,
    slip, publicKey, connection, sendTransaction, effectiveEvmAddress, evmChainId,
    ensureChain, customDestAddr, loginPrivy,
  ]);

  /* Auto-resume pending swap after Privy login completes. */
  useEffect(() => {
    if (!walletConnected || !pendingSwap) return undefined;
    const t = setTimeout(() => {
      setPendingSwap(false);
      executeSwap();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnected, pendingSwap]);

  /* ---- Tx explorer link ---- */
  const txLink = useMemo(() => {
    if (!swapTx) return null;
    const engineUsed = (quote && quote.engine) || route;
    if (engineUsed === 'jupiter') return 'https://solscan.io/tx/' + swapTx;
    if (engineUsed === 'lifi')    return isSol(fromToken)
      ? 'https://solscan.io/tx/' + swapTx
      : 'https://scan.li.fi/tx/' + swapTx;
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
  }, [swapTx, route, quote, fromToken]);

  /* ============================================================================
   * RENDER
   * ========================================================================= */

  /* In 'buy' mode, always show buy presets. In 'swap' mode, show them only
   * when the from-token is something users typically pay with - i.e. a gas
   * token or a stable. Avoids cluttering the UI with "spend $25 of WIF". */
  const showBuyPresets  = modeProp === 'buy' || (
    modeProp === 'swap' && fromToken &&
    /^(SOL|ETH|BNB|POL|AVAX|MNT|FTM|CRO|GLMR|CELO|SEI|RON|FUSE|KCS|HYPE|YALA|BERA|APE|FLOW|KAVA|S|CORE|MON|BTC|XPL|FLR|METIS|USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol)
  );
  const showSellPresets = modeProp === 'sell';

  const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
  const toUsdValue   = quote && toPriceUsd > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;

  /* Wallet check used by the action button. Includes Privy. */
  const needsSol = (route === 'jupiter') || (route === 'lifi' && isSol(fromToken));
  const needsEvm = (route === '0x') || (route === 'lifi' && isEvm(fromToken));
  const hasNeededWallet = (needsSol && hasSolSigner) || (needsEvm && hasEvmSigner);

  /* TO box display: when a quote is loading on top of an existing quote we
   * keep showing the old number greyed out so the UI doesn't blink to "0.00"
   * on every keystroke. */
  const toDisplay = quote ? quote.outAmountDisplay : (quoteLoading ? '...' : '0.00');
  const toColor = quoteIsStale ? C.muted
    : quoteLoading && !quote ? C.muted
    : quote ? C.green : C.muted2;

  return (
    <div style={{ width: '100%', maxWidth: compact ? '100%' : 520, margin: '0 auto', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      {!compact && (
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>Swap</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Best price across every chain. No KYC.</p>
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

        {/* QUICK BUY */}
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

        {/* QUICK SELL */}
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

        {/* FROM */}
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

        {/* FLIP */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flipTokens} aria-label="Flip tokens" style={{
            width: 40, height: 40, borderRadius: 10, background: C.card3,
            border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent,
            fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{'\u21F5'}</button>
        </div>

        {/* TO */}
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

        {/* QUOTE ERROR */}
        {quoteError && !quoteLoading && (
          <div style={{
            marginTop: 8, padding: 10,
            background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{quoteError}</div>
        )}

        {/* FEE BREAKDOWN */}
        {quote && fromAmt && (
          <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
            {[
              ['Platform fee', fromUsdValue > 0 ? fmtUsd(fromUsdValue * PLATFORM_FEE) : (PLATFORM_FEE * 100).toFixed(0) + '%'],
              ['Anti-MEV / safety', fromUsdValue > 0 ? fmtUsd(fromUsdValue * SAFETY_FEE) : (SAFETY_FEE * 100).toFixed(0) + '%'],
              isCrossChain ? ['Cross-chain fee', fromUsdValue > 0 ? fmtUsd(fromUsdValue * CROSS_FEE) : (CROSS_FEE * 100).toFixed(0) + '%'] : null,
              quote.engine === 'jupiter' && quote.priceImpactPct != null
                ? ['Price impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%']
                : null,
              quote.outAmountDisplay
                ? ['Min received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken && toToken.symbol)]
                : null,
              quote.fallback ? ['Route', 'LiFi (0x had no route)'] : null,
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
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>DESTINATION WALLET</div>
            <input value={customDestAddr} onChange={(e) => setCustomDestAddr(e.target.value)}
              placeholder={isBtc(toToken) ? 'Your Bitcoin address (bc1..., 3..., or 1...)'
                : isSol(toToken) ? 'Your Solana wallet address...'
                : 'Your ' + (CHAIN_NAMES[toToken && toToken.chainId] || 'EVM') + ' address (0x...)'}
              style={{
                width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)',
                borderRadius: 10, padding: '12px 14px', color: C.accent,
                fontFamily: 'monospace', fontSize: 11, outline: 'none',
                boxSizing: 'border-box', minHeight: 44,
              }} />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Where you want to receive your tokens</div>
          </div>
        )}

        {/* SWAP ERROR */}
        {swapError && (
          <div style={{
            marginTop: 10, padding: 10,
            background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{swapError}</div>
        )}

        {/* ACTION BUTTON */}
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
              {/* "First send" approval banner -- shown only for external EVM
               * ERC20 sources. Privy users sign silently and don't see popups,
               * so the messaging is hidden for them. */}
              {requiresApproval && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)',
                  borderRadius: 10, fontSize: 11, color: '#ff9500', lineHeight: 1.5,
                }}>
                  <span style={{ fontWeight: 700 }}>First send of {fromToken && fromToken.symbol}: 2 wallet popups.</span>{' '}
                  <span style={{ color: '#cdd6f4' }}>
                    {route === '0x'
                      ? 'A Permit2 signature (off-chain, no gas) plus the swap. Future swaps of ' + (fromToken && fromToken.symbol) + ' = 1 popup.'
                      : 'A token approval plus the bridge tx. Future swaps of ' + (fromToken && fromToken.symbol) + ' = 1 popup.'}
                  </span>
                </div>
              )}
              <button onClick={executeSwap}
                disabled={swapStatus === 'loading' || !fromAmt || !quote || quoteLoading}
                style={{
                  width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none',
                  background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                    : swapStatus === 'error' ? 'rgba(255,59,107,.2)'
                    : !fromAmt || !quote ? C.card2
                    : modeProp === 'sell' ? C.sellGrad : C.buyGrad,
                  color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : '#fff',
                  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
                  cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer',
                  minHeight: 52, transition: 'all .2s',
                }}>
                {swapStatus === 'loading' ? 'Confirming...'
                  : swapStatus === 'success' ? 'Confirmed!'
                  : swapStatus === 'error' ? 'Failed -- try again'
                  : !fromAmt ? 'Enter amount'
                  : quoteLoading && !quote ? 'Getting best route...'
                  : !quote ? 'No route'
                  : (modeProp === 'sell' ? 'Sell ' : modeProp === 'buy' ? 'Buy ' : 'Swap ') +
                    (fromToken ? fromToken.symbol : '') + ' \u2192 ' + (toToken ? toToken.symbol : '')}
              </button>

              {/* Stuck-swap reset (>30s loading) */}
              {swapStatus === 'loading' && stuckSwap && (
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.25)',
                  borderRadius: 10, fontSize: 11, color: C.muted, lineHeight: 1.4,
                }}>
                  <div style={{ color: '#fff', fontWeight: 600, marginBottom: 4 }}>Still waiting on your wallet...</div>
                  <div>If you've already signed, the transaction may still complete -- check your wallet for status.</div>
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
          setCustomDestAddr('');
        }}
        jupiterTokens={jupiterTokens}
        excludeBtc={true}
      />
      <TokenSelectModal
        open={toSelectOpen}
        onClose={() => setToSelectOpen(false)}
        onSelect={(t) => {
          setToToken(t);
          setQuote(null); setQuoteError(''); setQuoteIsStale(false);
          setCustomDestAddr('');
        }}
        jupiterTokens={jupiterTokens}
        excludeBtc={false}
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
 * Bottom-sheet wrapper used by TokenDetail / NewLaunches / Markets / Portfolio.
 * Opens SwapWidget in compact mode with mode + token defaults pre-applied.
 *
 * The headerChain / onHeaderChainChange props are accepted (for backward
 * compatibility with older callers) but no longer used internally - routing
 * is driven entirely by the from/to tokens.
 * ========================================================================= */

export function TradeDrawer({
  open, onClose, mode = 'buy', coin,
  jupiterTokens, onConnectWallet,
  presets, onPresetsChange,
  /* legacy / silently ignored: */
  // eslint-disable-next-line no-unused-vars
  headerChain: _hcIgnored,
  // eslint-disable-next-line no-unused-vars
  onHeaderChainChange: _hcChangeIgnored,
}) {
  const { connected: solConnected } = useWallet();
  const { isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const ws = { solConnected, evmConnected, evmChainId };

  const pair = useMemo(() => {
    if (!coin) return defaultTokenPair({ mode, viewedToken: null, lastFromToken: null, walletState: ws });
    return defaultTokenPair({ mode, viewedToken: coin, lastFromToken: null, walletState: ws });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, mode, solConnected, evmConnected, evmChainId]);

  const widgetKey = useMemo(() => {
    const id = coin ? (coin.mint || coin.address || coin.id || 'tok') : 'none';
    return id + '-' + mode;
  }, [coin, mode]);

  /* Lock dismissal during in-flight swap (loading state). */
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
          <div onClick={safeClose} role="button" aria-label="Close" style={{
            width: 40, height: 4, background: C.muted2, borderRadius: 2,
            margin: '0 auto 14px', cursor: isBusy ? 'default' : 'pointer',
            opacity: isBusy ? 0.4 : 1, padding: '8px 0', boxSizing: 'content-box',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {coin && (coin.image || coin.logoURI) && (
                <img src={coin.image || coin.logoURI} alt={symbol}
                  style={{ width: 28, height: 28, borderRadius: '50%' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div style={{ color: mode === 'buy' ? C.accent : C.red, fontWeight: 800, fontSize: 17 }}>
                {mode === 'buy' ? 'Buy' : 'Sell'} {symbol}
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
