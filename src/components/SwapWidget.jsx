/**
 * NEXUS DEX - Unified Swap Widget
 *
 * Behavior contract (locked):
 *   1. NO header chain selector. Routing is driven entirely by the from/to
 *      tokens. Defaults come from the connected wallet's actual state and
 *      from the user's last-used pair via localStorage.
 *
 *   2. ONE wallet popup per swap action for external wallets. Privy embedded
 *      wallets sign silently (configured in PrivyProvider via
 *      noPromptOnSignature). ERC20 first-send still adds 1 approval popup
 *      because that's the underlying chain's requirement.
 *
 *   3. Fees: 5% same-chain, 8% cross-chain. ALWAYS taken from output via
 *      the aggregator's own fee mechanism. Never bundled separately.
 *
 *   4. Pre-click data sources (NEVER aggregator endpoints):
 *        Prices    -> CoinGecko -> GeckoTerminal -> Moralis (EVM) ->
 *                     Helius DAS (Solana). First positive hit wins.
 *        Metadata  -> Helius DAS for Solana mint paste, on-chain RPC for
 *                     EVM contract paste, CG /coins/{id} for resolving
 *                     CG-shaped Markets entries to a contract address.
 *        Directory -> POPULAR_TOKENS hardcoded + jupiterTokens prop from
 *                     parent for the search modal.
 *
 *   5. Click routing (aggregator endpoints fire here and ONLY here):
 *        Solana <-> Solana                       -> Jupiter
 *        EVM <-> EVM, same chain, 0x supported   -> 0x (Permit2)
 *        Anything else                           -> LiFi
 *
 *   6. Quote engine:
 *        Pre-click: price-derived estimate
 *           out = in * fromPriceUsd / toPriceUsd * (1 - feeRate)
 *           Displayed with `~` prefix and "Estimated - live route on
 *           confirm" hint. NEVER hits Jupiter/0x/LiFi.
 *        On click: executeSwap fetches a fresh aggregator /quote (or
 *           /swap-build for Jupiter) using the user's real wallet
 *           address and submits the signed tx.
 *
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

/* (LiFi tokens index removed - aggregator endpoints are reserved for
 * executeSwap only. Pre-click data comes from CG/GT/Moralis/Helius.) */

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
 * a header chain selector.
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
 * ROUTE PICKER + LIFI SAME-CHAIN DETECTOR
 * ========================================================================= */

function pickRoute(from, to) {
  if (!from || !to) return 'lifi';
  if (isSol(from) && isSol(to)) return 'jupiter';
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId && OX_CHAIN_IDS.has(from.chainId)) return '0x';
  return 'lifi';
}
function isLifiSameChain(from, to) {
  return isEvm(from) && isEvm(to) && from.chainId === to.chainId;
}

/* ============================================================================
 * AGGREGATOR HELPERS
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

/* LiFi quote. fromAddress + toAddress are required and validated by their
 * API against the source/destination chain. ONLY called from executeSwap
 * after the user clicks - never pre-click. */
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

/* 0x v2 QUOTE endpoint - taker required. ONLY called from executeSwap. */
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
  const res = await fetch('/api/0x/swap/permit2/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '0x quote failed');
  if (!data.buyAmount) throw new Error('No route');
  return data;
}

/* Jupiter quote. Doesn't need a user address. */
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
 * USD PRICING - data sources only, NO aggregator calls. Cached 60s.
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

/* ============================================================================
 * PRE-CLICK PRICE HELPERS - CoinGecko + Moralis ONLY
 *
 * No aggregator (Jupiter, 0x, LiFi) calls happen pre-click. Aggregators are
 * reserved for the actual swap execution after the user clicks. Pre-click
 * numbers come from these two proxies wired up in server.js:
 *
 *   /api/coingecko/* -> CoinGecko free + paid (handles native coins, EVM
 *                       contracts via /simple/token_price/{platform}, and
 *                       Solana SPL contracts via /simple/token_price/solana)
 *   /api/moralis/*   -> Moralis EVM token price API (used as fallback when
 *                       CoinGecko doesn't index a contract)
 *
 * Cached 60s. If neither source has the token, getTokenPriceUsd returns null
 * and the YOU RECEIVE box stays at 0.00. Click still works because
 * executeSwap fetches the real aggregator quote at click time.
 * ========================================================================= */

/* CoinGecko asset platform slugs by chain ID. Used for the
 * /simple/token_price/{platform} endpoint. Covers every chain CG indexes;
 * chains not in this map fall through to GeckoTerminal/Moralis/Helius. */
const CG_PLATFORM = {
  1: 'ethereum', 10: 'optimistic-ethereum', 14: 'flare-network', 25: 'cronos',
  56: 'binance-smart-chain', 100: 'xdai', 122: 'fuse', 130: 'unichain',
  137: 'polygon-pos', 146: 'sonic', 250: 'fantom', 252: 'fraxtal',
  255: 'kroma', 288: 'boba', 321: 'kucoin-community-chain', 324: 'zksync',
  360: 'shape', 480: 'world-chain', 747: 'flow-evm', 999: 'hyperliquid',
  1088: 'metis-andromeda', 1101: 'polygon-zkevm', 1116: 'core',
  1135: 'lisk', 1284: 'moonbeam', 1313161554: 'aurora', 1329: 'sei-evm',
  2020: 'ronin', 2222: 'kava', 2741: 'abstract', 5000: 'mantle',
  8453: 'base', 9745: 'plasma', 33139: 'apechain', 34443: 'mode',
  42161: 'arbitrum-one', 42220: 'celo', 43111: 'hemi', 43114: 'avalanche',
  48900: 'zircuit', 57073: 'ink', 59144: 'linea', 60808: 'bob-network',
  80094: 'berachain', 81457: 'blast', 167000: 'taiko', 200901: 'bitlayer',
  534352: 'scroll', 7777777: 'zora',
};

/* CoinGecko coin IDs for native chain coins. Used for the /simple/price
 * endpoint (the contract endpoint doesn't return a price for the native
 * coin since it has no contract). Every chain in CHAIN_NAMES with a known
 * native coin price source is mapped. */
const CG_NATIVE_ID = {
  1: 'ethereum', 10: 'ethereum', 14: 'flare-networks',
  25: 'crypto-com-chain', 56: 'binancecoin', 100: 'xdai',
  122: 'fuse-network-token', 130: 'ethereum', 137: 'matic-network',
  146: 'sonic-3', 250: 'fantom', 252: 'ethereum', 255: 'ethereum',
  288: 'ethereum', 321: 'kucoin-shares', 324: 'ethereum',
  360: 'ethereum', 480: 'ethereum', 747: 'flow', 999: 'hyperliquid',
  1088: 'metis-token', 1101: 'ethereum', 1116: 'core',
  1135: 'ethereum', 1284: 'moonbeam', 1313161554: 'ethereum',
  1329: 'sei-network', 2020: 'ronin', 2222: 'kava', 2741: 'ethereum',
  5000: 'mantle', 8453: 'ethereum', 9745: 'plasma', 33139: 'apecoin',
  34443: 'ethereum', 42161: 'ethereum', 42220: 'celo', 43111: 'ethereum',
  43114: 'avalanche-2', 48900: 'ethereum', 57073: 'ethereum',
  59144: 'ethereum', 60808: 'ethereum', 80094: 'berachain-bera',
  81457: 'ethereum', 167000: 'ethereum', 200901: 'bitcoin',
  534352: 'ethereum', 7777777: 'ethereum',
};

/* Moralis chain keys for the EVM token price endpoint. Used as fallback
 * when CG and GeckoTerminal don't have a contract. */
const MORALIS_CHAIN = {
  1: 'eth', 10: 'optimism', 25: 'cronos', 56: 'bsc', 100: 'gnosis',
  137: 'polygon', 250: 'fantom', 324: 'zksync', 1101: 'polygon-zkevm',
  5000: 'mantle', 8453: 'base', 42161: 'arbitrum', 43114: 'avalanche',
  59144: 'linea', 81457: 'blast', 167000: 'taiko', 534352: 'scroll',
};

async function fetchCgPrice(token) {
  try {
    if (isBtc(token)) {
      const r = await fetch('/api/coingecko/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!r.ok) return null;
      const d = await r.json();
      const v = d && d.bitcoin && d.bitcoin.usd;
      return Number.isFinite(v) && v > 0 ? Number(v) : null;
    }
    if (isSol(token)) {
      if (token.mint === WSOL_MINT) {
        const r = await fetch('/api/coingecko/api/v3/simple/price?ids=solana&vs_currencies=usd');
        if (!r.ok) return null;
        const d = await r.json();
        const v = d && d.solana && d.solana.usd;
        return Number.isFinite(v) && v > 0 ? Number(v) : null;
      }
      const r = await fetch('/api/coingecko/api/v3/simple/token_price/solana?contract_addresses=' + encodeURIComponent(token.mint) + '&vs_currencies=usd');
      if (!r.ok) return null;
      const d = await r.json();
      const k = d && Object.keys(d)[0];
      const v = k && d[k] && d[k].usd;
      return Number.isFinite(v) && v > 0 ? Number(v) : null;
    }
    if (isEvm(token)) {
      if ((token.address || '').toLowerCase() === NATIVE_EVM) {
        const id = CG_NATIVE_ID[token.chainId];
        if (!id) return null;
        const r = await fetch('/api/coingecko/api/v3/simple/price?ids=' + id + '&vs_currencies=usd');
        if (!r.ok) return null;
        const d = await r.json();
        const v = d && d[id] && d[id].usd;
        return Number.isFinite(v) && v > 0 ? Number(v) : null;
      }
      const platform = CG_PLATFORM[token.chainId];
      if (!platform) return null;
      const r = await fetch('/api/coingecko/api/v3/simple/token_price/' + platform + '?contract_addresses=' + encodeURIComponent(token.address) + '&vs_currencies=usd');
      if (!r.ok) return null;
      const d = await r.json();
      const k = d && Object.keys(d)[0];
      const v = k && d[k] && d[k].usd;
      return Number.isFinite(v) && v > 0 ? Number(v) : null;
    }
    return null;
  } catch { return null; }
}

async function fetchMoralisPrice(token) {
  try {
    if (!isEvm(token)) return null;
    const chain = MORALIS_CHAIN[token.chainId];
    if (!chain) return null;
    if ((token.address || '').toLowerCase() === NATIVE_EVM) {
      /* Moralis price needs an ERC20 contract; it can't price native coins
       * by this endpoint. Fall through. */
      return null;
    }
    const r = await fetch('/api/moralis/api/v2.2/erc20/' + token.address + '/price?chain=' + chain);
    if (!r.ok) return null;
    const d = await r.json();
    const v = d && d.usdPrice;
    return Number.isFinite(v) && v > 0 ? Number(v) : null;
  } catch { return null; }
}

/* GeckoTerminal network slugs (different from CG asset platform slugs).
 * Used for /api/v2/networks/{network}/tokens/{address} which covers
 * on-chain DEX prices for memecoins and fresh launches not yet indexed in
 * the main CoinGecko coins list. Falls back to Moralis (EVM) / Helius
 * (Solana) for chains GT doesn't index. */
const GT_NETWORK = {
  1: 'eth', 10: 'optimism', 14: 'flare', 25: 'cro', 56: 'bsc',
  100: 'xdai', 122: 'fuse', 130: 'unichain', 137: 'polygon_pos',
  146: 'sonic', 250: 'ftm', 252: 'fraxtal', 255: 'kroma', 288: 'boba',
  321: 'kcc', 324: 'zksync', 480: 'wc', 1088: 'metis', 1101: 'polygon-zkevm',
  1116: 'core', 1135: 'lisk', 1284: 'moonbeam', 1313161554: 'aurora',
  1329: 'sei-evm-1329', 2020: 'ronin', 2222: 'kava', 2741: 'abstract',
  5000: 'mantle', 8453: 'base', 33139: 'apechain', 34443: 'mode',
  42161: 'arbitrum', 42220: 'celo', 43111: 'hemi', 43114: 'avax',
  48900: 'zircuit', 57073: 'ink', 59144: 'linea', 60808: 'bob-network',
  80094: 'berachain', 81457: 'blast', 167000: 'taiko', 200901: 'bitlayer',
  534352: 'scroll', 7777777: 'zora',
};

async function fetchGeckoTerminalPrice(token) {
  try {
    let network = null;
    let addr = null;
    if (isSol(token)) {
      network = 'solana';
      addr = token.mint;
    } else if (isEvm(token)) {
      network = GT_NETWORK[token.chainId];
      if (!network) return null;
      addr = (token.address || '').toLowerCase() === NATIVE_EVM
        ? null  /* GT prices contracts only - native handled by CG primary */
        : token.address;
    } else {
      return null;
    }
    if (!network || !addr) return null;
    const r = await fetch('/api/geckoterminal/api/v2/networks/' + network + '/tokens/' + encodeURIComponent(addr));
    if (!r.ok) return null;
    const d = await r.json();
    const raw = d && d.data && d.data.attributes && d.data.attributes.price_usd;
    const v = raw == null ? null : Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

/* Helius: last-resort fallback for Solana tokens not in CG or GT. The DAS
 * getAsset call returns token_info.price_info.price_per_token for many
 * SPL tokens. */
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
  /* Order: CG (curated, most accurate for top tokens) -> GT (memecoins,
   * pump.fun, anything with a DEX pool) -> Moralis (EVM long-tail) ->
   * Helius (Solana long-tail). First positive hit wins and is cached. */
  let p = await fetchCgPrice(token);
  if (p != null) { setCachedPrice(token, p); return p; }
  p = await fetchGeckoTerminalPrice(token);
  if (p != null) { setCachedPrice(token, p); return p; }
  if (isEvm(token)) {
    p = await fetchMoralisPrice(token);
    if (p != null) { setCachedPrice(token, p); return p; }
  }
  if (isSol(token)) {
    p = await fetchHeliusPrice(token);
    if (p != null) { setCachedPrice(token, p); return p; }
  }
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

function TokenSelectModal({ open, onClose, onSelect, jupiterTokens, excludeBtc }) {
  const [q, setQ] = useState('');
  const [contractInput, setContractInput] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  /* `cgDiscovered` holds CoinGecko /search hits (id-only stubs). They're
   * appended to the visible list immediately so symbol search like "pepe"
   * always returns hits, but each item has `chain: 'deferred'` until the
   * user clicks; on click we resolve via /coins/{id} to a real chain +
   * contract before forwarding to the parent's onSelect. */
  const [cgDiscovered, setCgDiscovered] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);

  const { chainId: evmWalletChainId } = useAccount();
  const evmChainForLookup = evmWalletChainId || 1;
  const publicClient = usePublicClient({ chainId: evmChainForLookup });

  /* Solana token list comes in via the `jupiterTokens` prop, populated by
   * the parent page (App.js or whoever owns the directory). Treat that as
   * cached metadata, not a live aggregator call from this component. */
  const solTokens = useMemo(() => {
    if (jupiterTokens && jupiterTokens.length > 0) {
      return jupiterTokens.map((t) => ({
        chain: 'solana', mint: t.mint, symbol: t.symbol,
        name: t.name || t.symbol, decimals: t.decimals || 6, logoURI: t.logoURI || null,
      }));
    }
    return POPULAR_TOKENS.filter((t) => isSol(t));
  }, [jupiterTokens]);

  /* Local fast-path search: hardcoded popular tokens + jupiterTokens prop.
   * Fires synchronously on every keystroke so the user sees popular hits
   * immediately, then CG discovery (below) appends long-tail matches. */
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
      const btcMatches = POPULAR_TOKENS.filter((t) =>
        isBtc(t) && (
          (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
          (t.name && t.name.toLowerCase().includes(ql))
        )
      );
      setSearchResults([...sol, ...evmFromPopular, ...btcMatches]);
    }, 250);
    return () => clearTimeout(handle);
  }, [q, solTokens]);

  /* CG symbol discovery. Hits CG /search (cheap, returns id+symbol+name+
   * logo, no contracts) and appends results as deferred-chain stubs. Skip
   * for short queries, contract-shaped queries (the paste field handles
   * those), and tokens already in NATIVE_COIN_RESOLVE / popular lists. */
  const cgSearchReqRef = useRef(0);
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setCgDiscovered([]); return undefined; }
    if (isValidSolMint(trimmed) || isValidEvmAddr(trimmed)) { setCgDiscovered([]); return undefined; }
    const reqId = ++cgSearchReqRef.current;
    const handle = setTimeout(async () => {
      try {
        const r = await fetch('/api/coingecko/api/v3/search?query=' + encodeURIComponent(trimmed));
        if (cgSearchReqRef.current !== reqId || !r.ok) return;
        const d = await r.json();
        if (cgSearchReqRef.current !== reqId) return;
        const coins = (d && Array.isArray(d.coins)) ? d.coins : [];
        const popularSymbols = new Set(POPULAR_TOKENS.map((t) => (t.symbol || '').toUpperCase()));
        const solSymbols = new Set(solTokens.map((t) => (t.symbol || '').toUpperCase()));
        const stubs = coins
          /* Skip native coins already covered by NATIVE_COIN_RESOLVE -
           * those resolve through the popular tokens list with proper
           * chain assignments. */
          .filter((c) => !NATIVE_COIN_RESOLVE[c.id])
          /* Skip symbols already in the local popular results to avoid
           * duplicates. */
          .filter((c) => {
            const sym = (c.symbol || '').toUpperCase();
            return !popularSymbols.has(sym) && !solSymbols.has(sym);
          })
          .slice(0, 25)
          .map((c) => ({
            chain: 'deferred', id: c.id,
            symbol: (c.symbol || '').toUpperCase(),
            name: c.name || c.id,
            logoURI: c.large || c.thumb || null,
            marketCapRank: c.market_cap_rank == null ? 9999 : c.market_cap_rank,
          }))
          .sort((a, b) => a.marketCapRank - b.marketCapRank);
        setCgDiscovered(stubs);
      } catch {
        if (cgSearchReqRef.current === reqId) setCgDiscovered([]);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [q, solTokens]);

  /* Click handler. For real tokens, forwards to onSelect immediately. For
   * deferred CG stubs, fetches /coins/{id} -> resolveFromCgCoin -> forwards
   * the resolved token. Shows a brief in-row spinner during resolution. */
  const handleSelect = useCallback(async (token) => {
    if (token.chain !== 'deferred') {
      onSelect(token);
      setQ(''); setContractInput(''); setContractToken(null);
      setSearchResults([]); setCgDiscovered([]); setResolvingId(null);
      onClose();
      return;
    }
    setResolvingId(token.id);
    try {
      const r = await fetch('/api/coingecko/api/v3/coins/' + encodeURIComponent(token.id) +
        '?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false');
      if (!r.ok) { setResolvingId(null); return; }
      const d = await r.json();
      const resolved = resolveFromCgCoin({ symbol: token.symbol, name: token.name, image: token.logoURI }, d, evmWalletChainId);
      if (resolved) {
        setResolvingId(null);
        onSelect(resolved);
        setQ(''); setContractInput(''); setContractToken(null);
        setSearchResults([]); setCgDiscovered([]);
        onClose();
      } else {
        setResolvingId(null);
      }
    } catch {
      setResolvingId(null);
    }
  }, [onSelect, onClose, evmWalletChainId]);

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
          /* Helius DAS - data source, NOT an aggregator. Returns metadata
           * (symbol, name, decimals, image) for any SPL mint. Replaces the
           * old Jupiter tokens API call which violated the no-aggregator
           * pre-click rule. */
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
        /* EVM contract paste -> resolve via on-chain RPC (decimals + symbol).
         * No aggregator hit; pure chain read via the wallet's public client. */
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
  }, [solTokens, evmWalletChainId, evmChainForLookup, publicClient]);

  useEffect(() => {
    const v = contractInput.trim();
    if (!v) { setContractToken(null); return undefined; }
    const handle = setTimeout(() => { lookupContract(v); }, 350);
    return () => clearTimeout(handle);
  }, [contractInput, lookupContract]);

  const close = () => {
    setQ(''); setContractInput(''); setContractToken(null);
    setSearchResults([]); setCgDiscovered([]); setResolvingId(null);
    onClose();
  };

  useBodyScrollLock(open);
  useEscapeKey(open, close);

  /* Merge local fast-path results with CG-discovered stubs. ChainBadge
   * handles deferred entries gracefully (returns null since chain
   * isn't 'solana'/'evm'/'bitcoin'). */
  const merged = useMemo(() => {
    if (!q.trim()) return [];
    const seenSym = new Set(searchResults.map((t) => (t.symbol || '').toUpperCase()));
    const filteredCg = cgDiscovered.filter((t) => !seenSym.has((t.symbol || '').toUpperCase()));
    return [...searchResults, ...filteredCg];
  }, [q, searchResults, cgDiscovered]);

  const display = q.trim() ? merged : (excludeBtc ? POPULAR_TOKENS.filter((t) => !isBtc(t)) : POPULAR_TOKENS);

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
              Searching...
              <div style={{ fontSize: 11, marginTop: 4 }}>Or paste the contract address above.</div>
            </div>
          )}
          {display.map((t, i) => {
            const isDeferred = t.chain === 'deferred';
            const isResolving = isDeferred && resolvingId === t.id;
            const key = isDeferred ? ('cg-' + t.id) : ((t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i);
            return (
              <div key={key} onClick={() => { if (!isResolving) handleSelect(t); }}
                style={{
                  padding: '12px 16px', cursor: isResolving ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid rgba(255,255,255,.03)', minHeight: 48,
                  opacity: isResolving ? 0.6 : 1,
                }}
                onMouseEnter={(e) => { if (!isResolving) e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <TokenIcon token={t} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</span>
                    {!isDeferred && <ChainBadge token={t} />}
                    {isDeferred && (
                      <span style={{
                        fontSize: 9, color: '#a855f7',
                        background: 'rgba(168,85,247,.15)', border: '1px solid rgba(168,85,247,.3)',
                        borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700,
                      }}>CG</span>
                    )}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                </div>
                {isResolving && (
                  <div style={{ color: C.accent, fontSize: 10, fontStyle: 'italic' }}>Resolving...</div>
                )}
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
  /* legacy / silently ignored: */
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
  /* needsWalletForQuote removed - pre-click numbers come from price sources */
  const quoteAbortRef = useRef(null);
  const quoteReqIdRef = useRef(0);
  /* quoteRef lets fetchQuote read the latest quote WITHOUT taking quote as
   * a useCallback dep. If we put quote in the deps, every successful fetch
   * recreates fetchQuote, which retriggers the debounced effect, which
   * fires another fetch -- an infinite refetch loop that hammers the
   * aggregator and surfaces rate-limit errors over a perfectly good
   * displayed quote. */
  const quoteRef = useRef(null);
  useEffect(() => { quoteRef.current = quote; }, [quote]);

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

  /* -- Cross-chain destination address -- */
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

  /* -- Derived -- */
  const route = useMemo(() => pickRoute(fromToken, toToken), [fromToken, toToken]);
  const isCrossChain = route === 'lifi' && !isLifiSameChain(fromToken, toToken);
  const isEvmFrom = isEvm(fromToken);
  const isNativeEvmFrom = isEvmFrom && (fromToken.address || '').toLowerCase() === NATIVE_EVM;

  const isPrivyOnly = activeWalletKind === 'privy' && !solConnected && !evmConnected;
  const requiresApproval = isEvmFrom && !isNativeEvmFrom && (route === '0x' || route === 'lifi') && !isPrivyOnly;

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

  /* -- USD prices (price-source derived, NOT aggregator) --
   * Each effect fires exactly once per token reference change. There is
   * no polling, no focus refetch, no interval. Once a price is set it
   * stays until the user picks a different token. Server-side CG/GT/
   * Moralis/Helius proxies provide their own caching. */
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
   * QUOTE ENGINE - price-derived estimate, NEVER aggregator pre-click.
   *
   *   out = in * fromPriceUsd / toPriceUsd * (1 - feeRate)
   *
   * fromPriceUsd / toPriceUsd are populated by getTokenPriceUsd which
   * walks CG -> GeckoTerminal -> Moralis (EVM) -> Helius (Solana).
   * Returns null if no source has the token, in which case the YOU
   * RECEIVE box stays at 0.00 until prices arrive.
   *
   * feeRate: 5% (TOTAL_FEE) for same-chain or Solana<->Solana, 8%
   * (TOTAL_FEE_CC) for any LiFi cross-chain route.
   *
   * Cross-chain coverage is identical to same-chain coverage - both
   * source and destination tokens are priced independently against USD,
   * so any combination that resolves both prices produces an estimate
   * (e.g. ETH -> SOL, ETH -> BTC, USDC.Base -> USDC.Polygon, ETH ->
   * pump.fun memecoin).
   *
   * On click, executeSwap fetches a real aggregator quote with the
   * user's actual wallet address and submits the tx.
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

    /* Pre-click pricing is ALWAYS price-source-derived. No aggregator
     * /quote or /price calls are made until the user actually clicks
     * Buy / Sell / Swap. Prices come from getTokenPriceUsd which walks
     * CoinGecko -> GeckoTerminal -> Moralis (EVM) -> Helius DAS (Solana).
     * Those upstream calls fire ONCE per token change in the price
     * effects above. fetchQuote itself never hits the network - it just
     * does local math: out = in * fromPriceUsd / toPriceUsd * (1 - fee).
     * So this body re-runs on amount typing (recomputes the local math)
     * or on price arrival (one-shot per token change), never on a poll. */
    const fromNum = parseFloat(fromAmt);
    if (!Number.isFinite(fromNum) || fromNum <= 0) {
      setQuote(null); setQuoteIsStale(false); return;
    }
    if (!(fromPriceUsd > 0) || !(toPriceUsd > 0)) {
      /* Prices not loaded yet - the price effects will refire and re-call
       * fetchQuote once they resolve. Don't set an error; just stay quiet. */
      setQuote(null); setQuoteIsStale(false);
      return;
    }

    const isCC = route === 'lifi' && !isLifiSameChain(fromToken, toToken);
    const feeRate = isCC ? TOTAL_FEE_CC : TOTAL_FEE;
    const grossOut = fromNum * fromPriceUsd / toPriceUsd;
    const netOut = grossOut * (1 - feeRate);

    /* Eight decimal places for sub-dollar tokens, six otherwise. */
    const dp = (netOut > 0 && netOut < 0.01) ? 8 : 6;

    setQuote({
      engine: 'estimate',
      outAmountDisplay: netOut.toFixed(dp),
      priceImpactPct: 0,
      preview: true,
    });
    setQuoteIsStale(false);
    return;
  }, [fromAmt, fromToken, toToken, route, fromPriceUsd, toPriceUsd]);

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

  /* -- MAX -- */
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

  /* -- Quick-buy preset: "spend $X of from-token" -- */
  const applyBuyPreset = useCallback((dollars) => {
    if (!fromToken) return;
    userTouchedAmtRef.current = true;
    if (fromPriceUsd && fromPriceUsd > 0) {
      const tokens = dollars / fromPriceUsd;
      setFromAmt(tokens > 0 ? tokens.toFixed(6) : '0');
      return;
    }
    if (/^(USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol || '')) {
      setFromAmt(String(dollars));
    }
  }, [fromToken, fromPriceUsd]);

  /* -- Quick-sell preset: "Sell X% of balance" -- */
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
    setFromAmt(''); setQuote(null); setQuoteError(''); setQuoteIsStale(false);
    setCustomDestAddr('');
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
   * ========================================================================= */
  const executeSwap = useCallback(async () => {
    if (!walletConnected) {
      setPendingSwap(true);
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    /* No `!quote` gate here. The pre-click `quote` is only a price-derived
     * estimate for display; the real route is fetched fresh at execution
     * time below. Letting the user click without an estimate covers the
     * brief window before prices arrive AND tokens whose USD price isn't
     * indexed by any of CG/GT/Moralis/Helius (the swap still routes via
     * Jupiter/0x/LiFi at click time). */

    if (swapStatusTimerRef.current) {
      clearTimeout(swapStatusTimerRef.current);
      swapStatusTimerRef.current = null;
    }
    setSwapStatus('loading'); setSwapError(''); setSwapTx(null);

    const engineUsed = route;

    try {
      const fromAmtRaw = toRawAmount(fromAmt, fromToken.decimals);

      /* Reusable LiFi swap runner. Called directly for cross-chain or
       * 0x-unsupported same-chain routes, AND as a fallback when 0x has
       * no route on a supported same-chain pair (LiFi has broader DEX
       * coverage on long-tail pairs). */
      const runLifiSwap = async () => {
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
          if (!wc) throw new Error('Wallet not ready - try again');

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
      };

      /* ============ JUPITER ============ */
      if (engineUsed === 'jupiter') {
        if (!publicKey) throw new Error('Connect a Solana wallet');
        const outputMintPk = new PublicKey(toToken.mint);
        const feeWalletPk  = new PublicKey(SOL_FEE_WALLET);
        const feeAta = await getAssociatedTokenAddress(outputMintPk, feeWalletPk);

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

        const bh   = jupTx.message.recentBlockhash;
        const lvbh = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
        connection.confirmTransaction(
          { signature: sig, blockhash: bh, lastValidBlockHeight: lvbh },
          'confirmed'
        ).catch(() => {});
      }

      /* ============ 0X (EVM same-chain Permit2) with LiFi fallback ============ */
      else if (engineUsed === '0x') {
        if (!effectiveEvmAddress || !walletClientRef.current) throw new Error('Connect an EVM wallet');
        if (evmChainId && evmChainId !== fromToken.chainId) {
          await ensureChain(fromToken.chainId);
        }
        const wc = walletClientRef.current;
        if (!wc) throw new Error('Wallet not ready - try again');

        try {
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
        } catch (oxErr) {
          if (oxErr && oxErr.name === 'AbortError') throw oxErr;
          /* 0x failed (typically "no route" on long-tail same-chain pairs)
           * - LiFi has broader DEX coverage so retry there. We only fall
           * back if 0x didn't actually submit a tx (no setSwapTx hit). */
          console.warn('[SwapWidget] 0x failed (' + (oxErr.message || 'unknown') + '), retrying via LiFi');
          await runLifiSwap();
        }
      }

      /* ============ LIFI (cross-chain or 0x-unsupported same-chain) ============ */
      else {
        await runLifiSwap();
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

  /* -- Tx explorer link -- */
  const txLink = useMemo(() => {
    if (!swapTx) return null;
    const engineUsed = route;
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

  const showBuyPresets  = modeProp === 'buy' || (
    modeProp === 'swap' && fromToken &&
    /^(SOL|ETH|BNB|POL|AVAX|MNT|FTM|CRO|GLMR|CELO|SEI|RON|FUSE|KCS|HYPE|YALA|BERA|APE|FLOW|KAVA|S|CORE|MON|BTC|XPL|FLR|METIS|USDC|USDT|DAI|USDE|TUSD|FRAX|USDP|GUSD)$/i.test(fromToken.symbol)
  );
  const showSellPresets = modeProp === 'sell';

  const fromUsdValue = fromAmt && fromPriceUsd > 0 ? parseFloat(fromAmt) * fromPriceUsd : 0;
  const toUsdValue   = quote && toPriceUsd > 0 ? parseFloat(quote.outAmountDisplay) * toPriceUsd : 0;

  const needsSol = (route === 'jupiter') || (route === 'lifi' && isSol(fromToken));
  const needsEvm = (route === '0x') || (route === 'lifi' && isEvm(fromToken));
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

        {/* PREVIEW HINT - shown when the quote is a price-derived estimate
         * (i.e. user hasn't clicked yet). On click, executeSwap fetches a
         * real aggregator quote using their actual wallet. */}
        {isPreview && (
          <div style={{
            marginTop: 6, fontSize: 11, color: C.muted,
            textAlign: 'right', fontStyle: 'italic',
          }}>
            Estimated &middot; live route on confirm
          </div>
        )}

        {/* QUOTE ERROR - only shown when we have NO valid quote to display.
         * If a refresh attempt fails but we already have a working quote on
         * screen, we keep showing the numbers and stay silent. The user
         * came here to see the price, not to read about API hiccups. */}
        {quoteError && !quoteLoading && !quote && (
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
            ].filter(Boolean).map((item) => (
              <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                <span style={{ color: C.muted }}>{item[0]}</span>
                <span style={{ color: C.text }}>{item[1]}</span>
              </div>
            ))}
          </div>
        )}

        {/* DESTINATION ADDRESS */}
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

/* CoinGecko platform slug -> our chain ID. Used to translate CG /coins/{id}
 * platforms map into a token shape SwapWidget understands. */
const CG_SLUG_TO_CHAIN = {
  ethereum: 1, 'optimistic-ethereum': 10, cronos: 25, 'binance-smart-chain': 56,
  xdai: 100, unichain: 130, 'polygon-pos': 137, sonic: 146,
  fantom: 250, fraxtal: 252, zksync: 324, 'world-chain': 480,
  core: 1116, lisk: 1135, moonbeam: 1284, 'sei-evm': 1329, ronin: 2020,
  kava: 2222, abstract: 2741, mantle: 5000, base: 8453,
  apechain: 33139, mode: 34443, 'arbitrum-one': 42161, celo: 42220,
  avalanche: 43114, zircuit: 48900, ink: 57073, linea: 59144,
  'bob-network': 60808, berachain: 80094, blast: 81457,
  taiko: 167000, bitlayer: 200901, scroll: 534352, zora: 7777777,
};

/* Resolve a CG /coins/{id} response into a normalized token. Picks chain in
 * order: preferred (user's connected EVM chain) -> Ethereum -> Solana ->
 * any other EVM. Returns null if no usable platform is found. */
function resolveFromCgCoin(originalCoin, cgData, preferredChainId) {
  if (!cgData) return null;
  const platforms = cgData.platforms || {};
  const detail = cgData.detail_platforms || {};
  const baseLogo = (cgData.image && (cgData.image.large || cgData.image.small || cgData.image.thumb))
    || originalCoin.image || originalCoin.logoURI || null;
  const baseSym  = (cgData.symbol || originalCoin.symbol || 'TOKEN').toUpperCase();
  const baseName = cgData.name || originalCoin.name || baseSym;

  const tryEvm = (slug, chainId) => {
    const addr = platforms[slug];
    if (!addr) return null;
    return {
      chain: 'evm', address: addr, chainId,
      symbol: baseSym, name: baseName,
      decimals: (detail[slug] && typeof detail[slug].decimal_place === 'number') ? detail[slug].decimal_place : 18,
      logoURI: baseLogo,
    };
  };

  /* 1. Preferred chain (user's connected EVM chain) */
  if (preferredChainId) {
    const slug = Object.keys(CG_SLUG_TO_CHAIN).find((s) => CG_SLUG_TO_CHAIN[s] === preferredChainId);
    if (slug) {
      const e = tryEvm(slug, preferredChainId);
      if (e) return e;
    }
  }
  /* 2. Ethereum mainnet */
  const eth = tryEvm('ethereum', 1);
  if (eth) return eth;
  /* 3. Solana */
  if (platforms.solana) {
    return {
      chain: 'solana', mint: platforms.solana,
      symbol: baseSym, name: baseName,
      decimals: (detail.solana && typeof detail.solana.decimal_place === 'number') ? detail.solana.decimal_place : 6,
      logoURI: baseLogo,
    };
  }
  /* 4. Any other EVM, in popularity order */
  const fallback = [56, 8453, 42161, 137, 10, 43114, 59144, 81457, 5000, 534352, 324];
  for (let i = 0; i < fallback.length; i++) {
    const cid = fallback[i];
    const slug = Object.keys(CG_SLUG_TO_CHAIN).find((s) => CG_SLUG_TO_CHAIN[s] === cid);
    if (!slug) continue;
    const e = tryEvm(slug, cid);
    if (e) return e;
  }
  return null;
}

/* ============================================================================
 * TRADE DRAWER
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

  /* Coin enrichment. The drawer is the integration boundary between
   * Markets/TokenDetail/NewLaunches and SwapWidget. Markets passes
   * CoinGecko-shaped objects (id, symbol, name, image - NO contract).
   * NewLaunches passes pump.fun shapes ({ mint, ... }). TokenDetail can pass
   * either. We probe normalizeToken first; if it fails (typically a CG
   * ERC20 with only `id`), we fetch /coins/{id} from the CG proxy to pull
   * the contract address from `platforms`, then build a real token shape
   * for SwapWidget to consume.
   *
   * If enrichment fails (CG doesn't have the coin, or it has no usable
   * platform), the drawer still opens with a sensible default pair
   * (SOL/USDC) and a small inline note so the user isn't stuck. */
  const [enrichedCoin, setEnrichedCoin] = useState(null);
  const [enrichFailed, setEnrichFailed] = useState(false);

  const directNormalized = coin ? normalizeToken(coin) : null;
  const needsEnrichment = !!(coin && !directNormalized && coin.id);
  const enriching = !!(open && needsEnrichment && !enrichedCoin && !enrichFailed);

  useEffect(() => {
    if (!open) {
      setEnrichedCoin(null);
      setEnrichFailed(false);
      return undefined;
    }
    if (!coin || directNormalized || !coin.id) {
      setEnrichedCoin(null);
      setEnrichFailed(false);
      return undefined;
    }
    let cancelled = false;
    setEnrichedCoin(null);
    setEnrichFailed(false);
    fetch('/api/coingecko/api/v3/coins/' + encodeURIComponent(coin.id) +
      '?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const resolved = resolveFromCgCoin(coin, d, evmChainId);
        if (resolved) setEnrichedCoin(resolved);
        else setEnrichFailed(true);
      })
      .catch(() => { if (!cancelled) setEnrichFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coin && coin.id, evmChainId]);

  const effectiveCoin = enrichedCoin || coin;

  const pair = useMemo(() => {
    if (!effectiveCoin) return defaultTokenPair({ mode, viewedToken: null, lastFromToken: null, walletState: ws });
    return defaultTokenPair({ mode, viewedToken: effectiveCoin, lastFromToken: null, walletState: ws });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCoin, mode, solConnected, evmConnected, evmChainId]);

  const widgetKey = useMemo(() => {
    const c = effectiveCoin || coin;
    const id = c ? (c.mint || c.address || c.id || 'tok') : 'none';
    return id + '-' + mode;
  }, [effectiveCoin, coin, mode]);

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
  const symbol = (effectiveCoin && effectiveCoin.symbol) || (coin && coin.symbol) || '';
  const symbolUpper = symbol ? symbol.toUpperCase() : '';
  const headerImg = (effectiveCoin && (effectiveCoin.image || effectiveCoin.logoURI))
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
