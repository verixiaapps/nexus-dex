import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

/*
 * NEXUS DEX -- Send
 *
 * SAME-CHAIN SEND ONLY:
 *   - Solana -> Solana
 *   - EVM -> same EVM chain
 *
 * Removed:
 *   - LI.FI
 *   - bridges
 *   - cross-chain routing
 *   - VersionedTransaction bridge deserialization
 *   - Buffer usage
 *   - ERC20 approval spender flow
 *
 * Fee:
 *   - 5% total fee
 *   - SOL/SPL: recipient + fee transfer bundled into same Solana tx
 *   - EVM native: recipient + fee transfer bundled into one Multicall3 tx
 *   - EVM ERC20: two direct ERC20 transfer txs, no approval spender
 */

const FEE_WALLET_SOL = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const FEE_WALLET_EVM = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';

const PLATFORM_FEE = 0.03;
const SAFETY_FEE = 0.02;
const TOTAL_FEE = PLATFORM_FEE + SAFETY_FEE;

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const CHAIN_NAMES = {
  1: 'Ethereum',
  10: 'Optimism',
  25: 'Cronos',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  250: 'Fantom',
  324: 'zkSync Era',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  5000: 'Mantle',
  81457: 'Blast',
  534352: 'Scroll',
};

const EVM_EXPLORERS = {
  1: 'etherscan.io',
  10: 'optimistic.etherscan.io',
  25: 'cronoscan.com',
  56: 'bscscan.com',
  100: 'gnosisscan.io',
  137: 'polygonscan.com',
  250: 'ftmscan.com',
  324: 'explorer.zksync.io',
  5000: 'mantlescan.xyz',
  8453: 'basescan.org',
  42161: 'arbiscan.io',
  43114: 'snowtrace.io',
  59144: 'lineascan.build',
  81457: 'blastscan.io',
  534352: 'scrollscan.com',
};

const C = {
  bg: '#03060f',
  card: '#080d1a',
  card2: '#0c1220',
  card3: '#111d30',
  border: 'rgba(0,229,255,0.10)',
  borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff',
  green: '#00ffa3',
  red: '#ff3b6b',
  text: '#cdd6f4',
  muted: '#586994',
  muted2: '#2e3f5e',
};

const aggregate3ValueAbi = [
  {
    name: 'aggregate3Value',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
];

const erc20TransferAbi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const POPULAR_TOKENS = [
  {
    mint: SOL_MINT,
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    chain: 'solana',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  {
    mint: USDC_SOLANA,
    symbol: 'USDC',
    name: 'USD Coin (SOL)',
    decimals: 6,
    chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether (SOL)',
    decimals: 6,
    chain: 'solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    chain: 'solana',
    logoURI: 'https://static.jup.ag/jup/icon.png',
  },
  {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    chain: 'solana',
    logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  },
  {
    address: NATIVE_EVM,
    chainId: 1,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    chain: 'evm',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  },
  {
    address: NATIVE_EVM,
    chainId: 8453,
    symbol: 'ETH',
    name: 'ETH (Base)',
    decimals: 18,
    chain: 'evm',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  },
  {
    address: NATIVE_EVM,
    chainId: 42161,
    symbol: 'ETH',
    name: 'ETH (Arbitrum)',
    decimals: 18,
    chain: 'evm',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  },
  {
    address: NATIVE_EVM,
    chainId: 56,
    symbol: 'BNB',
    name: 'BNB Chain',
    decimals: 18,
    chain: 'evm',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png',
  },
  {
    address: NATIVE_EVM,
    chainId: 137,
    symbol: 'POL',
    name: 'Polygon',
    decimals: 18,
    chain: 'evm',
    isNative: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
  },
  {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    symbol: 'USDC',
    name: 'USD Coin (ETH)',
    decimals: 6,
    chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  },
  {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    symbol: 'USDC',
    name: 'USD Coin (Base)',
    decimals: 6,
    chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  },
  {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    symbol: 'USDC',
    name: 'USD Coin (Arbitrum)',
    decimals: 6,
    chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xaf88d065e77c8cC2239327C5EDb3A432268e5831/logo.png',
  },
  {
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    chainId: 137,
    symbol: 'USDC',
    name: 'USD Coin (Polygon)',
    decimals: 6,
    chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x3c499c542cef5e3811e1192ce70d8cc03d5c3359/logo.png',
  },
  {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    chainId: 1,
    symbol: 'USDT',
    name: 'Tether (ETH)',
    decimals: 6,
    chain: 'evm',
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  },
];

function isSol(token) {
  return token && token.chain === 'solana';
}

function isEvm(token) {
  return token && token.chain === 'evm';
}

function isNativeEvmToken(token) {
  return isEvm(token) && token.address && token.address.toLowerCase() === NATIVE_EVM;
}

function normalizeEvmAddress(address) {
  return String(address || '').toLowerCase();
}

function fmt(n) {
  n = Number(n || 0);
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function isValidSolAddress(address) {
  try {
    if (!address || typeof address !== 'string') return false;
    new PublicKey(address.trim());
    return address.trim().length >= 32;
  } catch (e) {
    return false;
  }
}

function isValidEvmAddress(address) {
  return !!address && /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

function toRawAmount(value, decimals) {
  if (value == null) return BigInt(0);

  const clean = String(value).trim();
  if (!clean || Number.isNaN(Number(clean))) return BigInt(0);

  const parts = clean.split('.');
  const whole = parts[0] || '0';
  const fraction = parts[1] || '';
  const safeDecimals = Number.isFinite(Number(decimals)) ? Number(decimals) : 18;
  const paddedFraction = (fraction + '0'.repeat(safeDecimals)).slice(0, safeDecimals);

  return BigInt(whole) * (BigInt(10) ** BigInt(safeDecimals)) + BigInt(paddedFraction || '0');
}

function splitFeeRaw(totalRaw) {
  const feeRaw = (totalRaw * BigInt(5)) / BigInt(100);
  return {
    feeRaw,
    recipientRaw: totalRaw - feeRaw,
  };
}

function splitFeeNumber(total) {
  const feeAmount = total * TOTAL_FEE;
  return {
    feeAmount,
    recipientAmount: total - feeAmount,
  };
}

function shortAddress(address) {
  if (!address || typeof address !== 'string') return '';
  if (address.length <= 14) return address;
  return address.slice(0, 6) + '...' + address.slice(-4);
}

function getPrice(coins, symbol) {
  const match = (coins || []).find(function (coin) {
    return coin && coin.symbol && coin.symbol.toLowerCase() === String(symbol || '').toLowerCase();
  });

  return match && Number(match.current_price) > 0 ? Number(match.current_price) : 0;
}

function getExplorerTxUrl(token, txSig) {
  if (!token || !txSig) return null;
  if (isSol(token)) return 'https://solscan.io/tx/' + txSig;

  const host = EVM_EXPLORERS[token.chainId];
  if (!host) return null;

  return 'https://' + host + '/tx/' + txSig;
}

function ChainBadge({ token }) {
  if (!token) return null;

  const label = isSol(token) ? 'SOL' : CHAIN_NAMES[token.chainId] || 'EVM';
  const color = isSol(token) ? '#9945ff' : '#627eea';

  return (
    <span
      style={{
        fontSize: 9,
        color,
        background: color + '22',
        border: '1px solid ' + color + '44',
        borderRadius: 4,
        padding: '1px 5px',
        marginLeft: 4,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

async function getSolTokenProgramId(connection, mintPk) {
  try {
    const mintInfo = await connection.getAccountInfo(mintPk);
    if (mintInfo && mintInfo.owner && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return TOKEN_2022_PROGRAM_ID;
    }
  } catch (e) {}

  return TOKEN_PROGRAM_ID;
}

async function getSolDecimals(token) {
  if (!token || !token.mint) return 6;

  const popular = POPULAR_TOKENS.find(function (t) {
    return t.mint === token.mint;
  });

  if (popular && Number.isFinite(popular.decimals)) return popular.decimals;

  try {
    const r = await fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(token.mint));
    if (r.ok) {
      const arr = await r.json();
      const match = Array.isArray(arr)
        ? arr.find(function (x) { return x && x.id === token.mint; }) || arr[0]
        : null;

      if (match && Number.isFinite(Number(match.decimals))) return Number(match.decimals);
    }
  } catch (e) {}

  return Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : 6;
}

function normalizeJupiterToken(token) {
  const mint = token.mint || token.id || token.address;
  if (!mint) return null;

  return {
    mint,
    symbol: token.symbol || mint.slice(0, 4).toUpperCase(),
    name: token.name || token.symbol || 'Solana Token',
    decimals: token.decimals != null ? Number(token.decimals) : 6,
    chain: 'solana',
    logoURI: token.logoURI || token.icon || token.image || null,
  };
}

function TokenModal({ open, onClose, jupiterTokens, currentEvmChainId }) {
  const [query, setQuery] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const lookupReqRef = useRef(0);

  const solTokens = useMemo(function () {
    if (Array.isArray(jupiterTokens) && jupiterTokens.length > 0) {
      return jupiterTokens
        .map(normalizeJupiterToken)
        .filter(Boolean);
    }

    return POPULAR_TOKENS.filter(function (token) {
      return token.chain === 'solana';
    });
  }, [jupiterTokens]);

  const close = useCallback(function () {
    setQuery('');
    setContractAddr('');
    setContractToken(null);
    setSearchResults([]);
    onClose(null);
  }, [onClose]);

  const selectToken = useCallback(function (token) {
    setQuery('');
    setContractAddr('');
    setContractToken(null);
    setSearchResults([]);
    onClose(token);
  }, [onClose]);

  const lookupContract = useCallback(async function (address) {
    const addr = String(address || '').trim();
    if (!addr) return;

    const isSolAddr = isValidSolAddress(addr);
    const isEvmAddr = isValidEvmAddress(addr);

    if (!isSolAddr && !isEvmAddr) return;

    const reqId = ++lookupReqRef.current;
    setContractLoading(true);

    try {
      if (isSolAddr) {
        const existing = solTokens.find(function (token) {
          return token && token.mint === addr;
        });

        if (existing) {
          if (lookupReqRef.current === reqId) setContractToken(existing);
        } else {
          const res = await fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(addr));
          if (lookupReqRef.current !== reqId) return;

          if (res.ok) {
            const arr = await res.json();
            const found = Array.isArray(arr)
              ? arr.find(function (item) { return item && item.id === addr; }) || arr[0]
              : null;

            if (found) {
              setContractToken({
                mint: found.id || addr,
                symbol: found.symbol || addr.slice(0, 6) + '...',
                name: found.name || found.symbol || 'Custom Solana Token',
                decimals: found.decimals != null ? Number(found.decimals) : 6,
                chain: 'solana',
                logoURI: found.icon || found.logoURI || null,
              });
            } else {
              setContractToken({
                mint: addr,
                symbol: addr.slice(0, 6) + '...',
                name: 'Custom Solana Token',
                decimals: 6,
                chain: 'solana',
              });
            }
          } else {
            setContractToken({
              mint: addr,
              symbol: addr.slice(0, 6) + '...',
              name: 'Custom Solana Token',
              decimals: 6,
              chain: 'solana',
            });
          }
        }
      } else if (isEvmAddr) {
        const chainId = typeof currentEvmChainId === 'number' && currentEvmChainId > 0
          ? currentEvmChainId
          : 1;

        if (lookupReqRef.current === reqId) {
          setContractToken({
            address: addr,
            symbol: addr.slice(0, 6) + '...',
            name: 'Custom EVM Token (' + (CHAIN_NAMES[chainId] || 'Chain ' + chainId) + ')',
            decimals: 18,
            chain: 'evm',
            chainId,
          });
        }
      }
    } catch (e) {
      if (lookupReqRef.current === reqId) {
        setContractToken({
          mint: addr,
          symbol: addr.slice(0, 6) + '...',
          name: 'Custom Token',
          decimals: 6,
          chain: 'solana',
        });
      }
    }

    if (lookupReqRef.current === reqId) setContractLoading(false);
  }, [currentEvmChainId, solTokens]);

  useEffect(function () {
    if (!query || query.length < 1) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase();

    const solMatches = solTokens.filter(function (token) {
      return (
        (token.symbol && token.symbol.toLowerCase().includes(q)) ||
        (token.name && token.name.toLowerCase().includes(q)) ||
        (token.mint && token.mint.toLowerCase().includes(q))
      );
    }).slice(0, 40);

    const evmMatches = POPULAR_TOKENS.filter(function (token) {
      if (token.chain !== 'evm') return false;
      const chainName = CHAIN_NAMES[token.chainId] || '';

      return (
        (token.symbol && token.symbol.toLowerCase().includes(q)) ||
        (token.name && token.name.toLowerCase().includes(q)) ||
        chainName.toLowerCase().includes(q)
      );
    }).slice(0, 30);

    setSearchResults(solMatches.concat(evmMatches));
  }, [query, solTokens]);

  useEffect(function () {
    if (!contractAddr) setContractToken(null);
  }, [contractAddr]);

  useEffect(function () {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;

    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) close();
    }

    window.addEventListener('keydown', onKey);

    return function () {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.touchAction = prevTouch || '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!open) return null;

  const displayTokens = query ? searchResults : POPULAR_TOKENS;

  return (
    <>
      <div
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 299,
          background: 'rgba(0,0,0,.75)',
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          zIndex: 300,
          background: C.card,
          border: '1px solid ' + C.borderHi,
          borderRadius: 18,
          width: '94vw',
          maxWidth: 420,
          maxHeight: 'min(85vh, 100dvh)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,.95)',
        }}
      >
        <div
          style={{
            padding: '16px 16px 10px',
            borderBottom: '1px solid ' + C.border,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                Same-chain sends only. Custom tokens are unverified.
              </div>
            </div>

            <button
              onClick={close}
              style={{
                background: 'none',
                border: 'none',
                color: C.muted,
                cursor: 'pointer',
                fontSize: 22,
                lineHeight: 1,
                padding: 0,
              }}
            >
              x
            </button>
          </div>

          <input
            autoFocus
            value={query}
            onChange={function (e) { setQuery(e.target.value); }}
            placeholder="Search name, symbol, chain..."
            style={{
              width: '100%',
              background: C.card2,
              border: '1px solid ' + C.border,
              borderRadius: 8,
              padding: '10px 12px',
              color: C.text,
              fontSize: 13,
              outline: 'none',
              fontFamily: 'Syne, sans-serif',
              marginBottom: 8,
              boxSizing: 'border-box',
            }}
          />

          <input
            value={contractAddr}
            onChange={function (e) { setContractAddr(e.target.value); }}
            onBlur={function () { if (contractAddr) lookupContract(contractAddr); }}
            onKeyDown={function (e) { if (e.key === 'Enter' && contractAddr) lookupContract(contractAddr); }}
            placeholder="Or paste Solana mint / EVM contract..."
            style={{
              width: '100%',
              background: C.card2,
              border: '1px solid rgba(0,229,255,.2)',
              borderRadius: 8,
              padding: '10px 12px',
              color: C.accent,
              fontSize: 12,
              outline: 'none',
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
          />

          {contractLoading && (
            <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>
          )}

          {contractToken && !contractLoading && (
            <div
              onClick={function () { selectToken(contractToken); }}
              style={{
                marginTop: 8,
                padding: '10px 12px',
                background: 'rgba(0,229,255,.08)',
                border: '1px solid rgba(0,229,255,.3)',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              {contractToken.logoURI ? (
                <img
                  src={contractToken.logoURI}
                  alt={contractToken.symbol}
                  style={{ width: 28, height: 28, borderRadius: '50%' }}
                  onError={function (e) { e.target.style.display = 'none'; }}
                />
              ) : (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'rgba(0,229,255,.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.accent,
                  }}
                >
                  {contractToken.symbol && contractToken.symbol.charAt(0)}
                </div>
              )}

              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div>
              </div>

              <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>
                Select
              </div>
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!query && (
            <div
              style={{
                padding: '8px 16px 4px',
                fontSize: 10,
                color: C.muted,
                fontWeight: 700,
                letterSpacing: .8,
              }}
            >
              POPULAR TOKENS
            </div>
          )}

          {query && searchResults.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>
              No tokens found. Paste a contract address above.
            </div>
          )}

          {displayTokens.map(function (token, index) {
            const key = (token.mint || token.address || '') + '-' + (token.chainId || 'sol') + '-' + index;

            return (
              <div
                key={key}
                onClick={function () { selectToken(token); }}
                style={{
                  padding: '11px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderBottom: '1px solid rgba(255,255,255,.03)',
                }}
                onMouseEnter={function (e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }}
                onMouseLeave={function (e) { e.currentTarget.style.background = 'transparent'; }}
              >
                {token.logoURI ? (
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
                    onError={function (e) { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'rgba(0,229,255,.1)',
                      border: '1px solid rgba(0,229,255,.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.accent,
                      flexShrink: 0,
                    }}
                  >
                    {token.symbol && token.symbol.charAt(0)}
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{token.symbol}</span>
                    <ChainBadge token={token} />
                  </div>

                  <div
                    style={{
                      color: C.muted,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {token.name}
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

export default function Send({
  coins,
  jupiterTokens,
  onConnectWallet,
  isConnected,
}) {
  const {
    publicKey: extPublicKey,
    sendTransaction: extSolSendTx,
    connected: solConnected,
  } = useWallet();

  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchToChain, activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();

  const publicKey = useMemo(function () {
    if (extPublicKey) return extPublicKey;

    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try {
        return new PublicKey(privyEmbeddedSol.address);
      } catch (e) {
        return null;
      }
    }

    return null;
  }, [extPublicKey, privyEmbeddedSol]);

  const sendSolanaTx = useCallback(async function (tx, conn, opts) {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function') {
        return privyEmbeddedSol.sendTransaction(tx, conn, opts);
      }

      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const signed = await privyEmbeddedSol.signTransaction(tx);
        return conn.sendRawTransaction(
          signed.serialize(),
          opts || { skipPreflight: false, maxRetries: 3 },
        );
      }

      throw new Error('Privy Solana wallet has no send/sign method');
    }

    if (!extSolSendTx) throw new Error('No Solana wallet send method');
    return extSolSendTx(tx, conn, opts);
  }, [activeWalletKind, privyEmbeddedSol, extSolSendTx]);

  const walletConnected = Boolean(isConnected || solConnected || evmConnected || publicKey || evmAddress);

  const [selectedToken, setSelectedToken] = useState(POPULAR_TOKENS[0]);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sendStatus, setSendStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [txSig2, setTxSig2] = useState(null);
  const [error, setError] = useState('');
  const [solBalance, setSolBalance] = useState(null);
  const [pendingSend, setPendingSend] = useState(false);

  const amountNum = parseFloat(amount) || 0;
  const splitDisplay = splitFeeNumber(amountNum);
  const price = getPrice(coins, selectedToken.symbol);
  const usdValue = amountNum * price;
  const tokenChainName = isSol(selectedToken)
    ? 'Solana'
    : CHAIN_NAMES[selectedToken.chainId] || 'EVM';

  const feeAmountDisplay = splitDisplay.feeAmount;
  const recipientAmountDisplay = splitDisplay.recipientAmount;

  const recipientIsValid = useMemo(function () {
    if (!recipient) return false;
    return isSol(selectedToken)
      ? isValidSolAddress(recipient)
      : isValidEvmAddress(recipient);
  }, [recipient, selectedToken]);

  useEffect(function () {
    setRecipient('');
    setAmount('');
    setError('');
    setTxSig(null);
    setTxSig2(null);
    setSendStatus('idle');
  }, [selectedToken]);

  useEffect(function () {
    if (!walletConnected || !pendingSend) return undefined;

    const t = setTimeout(function () {
      setPendingSend(false);
      handleSend();
    }, 200);

    return function () {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnected, pendingSend]);

  useEffect(function () {
    if (!publicKey || !connection) {
      setSolBalance(null);
      return;
    }

    let cancelled = false;

    connection.getBalance(publicKey)
      .then(function (balance) {
        if (!cancelled) setSolBalance(balance / 1e9);
      })
      .catch(function () {
        if (!cancelled) setSolBalance(null);
      });

    return function () {
      cancelled = true;
    };
  }, [publicKey, connection]);

  async function handleSolanaSend() {
    if (!publicKey) throw new Error('Connect Solana wallet');
    if (!connection) throw new Error('Solana connection unavailable');

    const recipientPubkey = new PublicKey(recipient.trim());
    const feeWalletPubkey = new PublicKey(FEE_WALLET_SOL);
    const transaction = new Transaction();

    if (selectedToken.mint === SOL_MINT) {
      const totalLamports = toRawAmount(amount, 9);
      if (totalLamports <= BigInt(0)) throw new Error('Amount too small');

      const split = splitFeeRaw(totalLamports);

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipientPubkey,
          lamports: split.recipientRaw,
        }),
      );

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: feeWalletPubkey,
          lamports: split.feeRaw,
        }),
      );
    } else {
      const decimals = await getSolDecimals(selectedToken);
      const totalRaw = toRawAmount(amount, decimals);
      if (totalRaw <= BigInt(0)) throw new Error('Amount too small');

      const split = splitFeeRaw(totalRaw);
      const mintPk = new PublicKey(selectedToken.mint);
      const programId = await getSolTokenProgramId(connection, mintPk);

      const fromAta = await getAssociatedTokenAddress(mintPk, publicKey, false, programId);
      const recipientAta = await getAssociatedTokenAddress(mintPk, recipientPubkey, false, programId);
      const feeAta = await getAssociatedTokenAddress(mintPk, feeWalletPubkey, false, programId);

      const ataInfos = await Promise.all([
        connection.getAccountInfo(recipientAta).catch(function () { return null; }),
        connection.getAccountInfo(feeAta).catch(function () { return null; }),
      ]);

      if (!ataInfos[0]) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientAta,
            recipientPubkey,
            mintPk,
            programId,
          ),
        );
      }

      if (!ataInfos[1]) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            feeAta,
            feeWalletPubkey,
            mintPk,
            programId,
          ),
        );
      }

      transaction.add(
        createTransferInstruction(
          fromAta,
          recipientAta,
          publicKey,
          split.recipientRaw,
          [],
          programId,
        ),
      );

      transaction.add(
        createTransferInstruction(
          fromAta,
          feeAta,
          publicKey,
          split.feeRaw,
          [],
          programId,
        ),
      );
    }

    const latest = await connection.getLatestBlockhash('confirmed');

    transaction.recentBlockhash = latest.blockhash;
    transaction.feePayer = publicKey;

    const sig = await sendSolanaTx(transaction, connection, {
      skipPreflight: false,
      maxRetries: 3,
    });

    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      'confirmed',
    );

    return { sig };
  }

  async function handleEvmSend() {
    if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');

    if (!selectedToken.chainId) throw new Error('Missing EVM chain id');

    if (evmChainId && evmChainId !== selectedToken.chainId) {
      if (typeof switchToChain === 'function') {
        const switched = await switchToChain(selectedToken.chainId);
        if (!switched) {
          throw new Error(
            'Switch to ' + (CHAIN_NAMES[selectedToken.chainId] || 'chain ' + selectedToken.chainId) + ' and retry.',
          );
        }
      } else {
        throw new Error(
          'Switch to ' + (CHAIN_NAMES[selectedToken.chainId] || 'chain ' + selectedToken.chainId) + ' and retry.',
        );
      }
    }

    const totalRaw = toRawAmount(amount, selectedToken.decimals || 18);
    if (totalRaw <= BigInt(0)) throw new Error('Amount too small');

    const split = splitFeeRaw(totalRaw);

    if (isNativeEvmToken(selectedToken)) {
      const calls = [
        {
          target: recipient.trim(),
          allowFailure: false,
          value: split.recipientRaw,
          callData: '0x',
        },
        {
          target: FEE_WALLET_EVM,
          allowFailure: false,
          value: split.feeRaw,
          callData: '0x',
        },
      ];

      const data = encodeFunctionData({
        abi: aggregate3ValueAbi,
        functionName: 'aggregate3Value',
        args: [calls],
      });

      const hash = await walletClient.sendTransaction({
        to: MULTICALL3,
        value: totalRaw,
        data,
        chain: walletClient.chain,
        account: evmAddress,
      });

      return { sig: hash };
    }

    const tokenAddress = selectedToken.address;
    if (!isValidEvmAddress(tokenAddress)) throw new Error('Invalid ERC20 token address');

    const recipientData = encodeFunctionData({
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [recipient.trim(), split.recipientRaw],
    });

    const feeData = encodeFunctionData({
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [FEE_WALLET_EVM, split.feeRaw],
    });

    const firstHash = await walletClient.sendTransaction({
      to: tokenAddress,
      data: recipientData,
      value: BigInt(0),
      chain: walletClient.chain,
      account: evmAddress,
    });

    const secondHash = await walletClient.sendTransaction({
      to: tokenAddress,
      data: feeData,
      value: BigInt(0),
      chain: walletClient.chain,
      account: evmAddress,
    });

    return {
      sig: firstHash,
      sig2: secondHash,
    };
  }

  async function handleSend() {
    if (!walletConnected) {
      setPendingSend(true);

      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();

      return;
    }

    if (!recipientIsValid) {
      setError('Invalid recipient address for ' + tokenChainName);
      return;
    }

    if (!amountNum || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }

    setError('');
    setTxSig(null);
    setTxSig2(null);
    setSendStatus('loading');

    try {
      const result = isSol(selectedToken)
        ? await handleSolanaSend()
        : await handleEvmSend();

      setTxSig(result.sig || null);
      setTxSig2(result.sig2 || null);
      setSendStatus('success');
      setAmount('');
      setRecipient('');

      setTimeout(function () {
        setSendStatus('idle');
        setTxSig(null);
        setTxSig2(null);
      }, 7000);
    } catch (e) {
      console.error('Send error:', e);
      setError(e && e.message ? e.message : 'Transaction failed');
      setSendStatus('error');

      setTimeout(function () {
        setSendStatus('idle');
      }, 5000);
    }
  }

  const txLink = getExplorerTxUrl(selectedToken, txSig);
  const txLink2 = getExplorerTxUrl(selectedToken, txSig2);

  if (!walletConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Same-chain sends only</p>
        </div>

        <div
          style={{
            textAlign: 'center',
            padding: '60px 30px',
            background: C.card,
            border: '1px solid ' + C.border,
            borderRadius: 20,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>--&gt;</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Sign in to Send</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            Send Solana tokens to Solana wallets or EVM tokens on the same EVM chain.
          </p>

          <button
            onClick={function () {
              if (loginPrivy) loginPrivy();
              else if (onConnectWallet) onConnectWallet();
            }}
            style={{
              background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
              border: 'none',
              borderRadius: 10,
              padding: '12px 28px',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'Syne, sans-serif',
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          {isSol(selectedToken)
            ? 'Solana to Solana only - 5% fee'
            : (CHAIN_NAMES[selectedToken.chainId] || 'EVM') + ' same-chain only - 5% fee'}
        </p>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
            SELECT TOKEN
          </div>

          <button
            onClick={function () { setTokenModalOpen(true); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: C.card2,
              border: '1px solid ' + C.border,
              borderRadius: 12,
              padding: '12px 16px',
              cursor: 'pointer',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {selectedToken.logoURI ? (
              <img
                src={selectedToken.logoURI}
                alt={selectedToken.symbol}
                style={{ width: 28, height: 28, borderRadius: '50%' }}
                onError={function (e) { e.target.style.display = 'none'; }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'rgba(0,229,255,.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.accent,
                }}
              >
                {selectedToken.symbol && selectedToken.symbol.charAt(0)}
              </div>
            )}

            <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</span>
                <ChainBadge token={selectedToken} />
              </div>
              <div
                style={{
                  color: C.muted,
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedToken.name}
              </div>
            </div>

            <span style={{ color: C.muted, fontSize: 11 }}>Change</span>
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
            RECIPIENT ADDRESS
          </div>

          <input
            value={recipient}
            onChange={function (e) { setRecipient(e.target.value.trim()); }}
            placeholder={isSol(selectedToken) ? 'Solana wallet address...' : '0x EVM address...'}
            style={{
              width: '100%',
              background: C.card2,
              border: '1px solid ' + (recipient && !recipientIsValid ? C.red : C.border),
              borderRadius: 12,
              padding: '14px 16px',
              color: C.text,
              fontFamily: 'monospace',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          {recipient && !recipientIsValid && (
            <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>
              Invalid address for {tokenChainName}
            </div>
          )}

          {recipient && recipientIsValid && (
            <div style={{ color: C.green, fontSize: 11, marginTop: 4 }}>
              Valid {tokenChainName} address
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>AMOUNT</span>

            {isSol(selectedToken) && selectedToken.mint === SOL_MINT && solBalance != null && (
              <span style={{ fontSize: 11, color: C.muted }}>Balance: {solBalance.toFixed(4)} SOL</span>
            )}
          </div>

          <div
            style={{
              background: C.card2,
              border: '1px solid ' + C.border,
              borderRadius: 12,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <input
              value={amount}
              onChange={function (e) {
                const next = e.target.value.replace(/[^0-9.]/g, '');
                const parts = next.split('.');
                setAmount(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : next);
              }}
              placeholder="0.00"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                fontSize: 24,
                fontWeight: 600,
                color: '#fff',
                outline: 'none',
                minWidth: 0,
              }}
            />

            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
              {price > 0 && amount && (
                <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{fmt(usdValue)}</div>
              )}
            </div>
          </div>

          {isSol(selectedToken) && selectedToken.mint === SOL_MINT && solBalance != null && solBalance > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[0.25, 0.5, 0.75, 1].map(function (pct) {
                return (
                  <button
                    key={                    key={pct}
                    onClick={function () {
                      setAmount((solBalance * pct * 0.99).toFixed(6));
                    }}
                    style={{
                      flex: 1,
                      padding: '5px',
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                      background: 'transparent',
                      border: '1px solid ' + C.border,
                      color: C.muted,
                      fontFamily: 'Syne, sans-serif',
                    }}
                  >
                    {pct === 1 ? 'MAX' : (pct * 100) + '%'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          {amount && amountNum > 0 ? (
            <div>
              {[
                ['Platform fee (3%)', (amountNum * PLATFORM_FEE).toFixed(6) + ' ' + selectedToken.symbol],
                ['Safety fee (2%)', (amountNum * SAFETY_FEE).toFixed(6) + ' ' + selectedToken.symbol],
                ['Total fee (5%)', feeAmountDisplay.toFixed(6) + ' ' + selectedToken.symbol],
                ['Recipient gets', recipientAmountDisplay.toFixed(6) + ' ' + selectedToken.symbol],
                price > 0 ? ['USD Value', fmt(usdValue)] : null,
              ].filter(Boolean).map(function (item) {
                const isHighlight = item[0] === 'Recipient gets';

                return (
                  <div
                    key={item[0]}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '3px 0',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: C.muted }}>{item[0]}</span>
                    <span
                      style={{
                        color: isHighlight ? C.green : C.text,
                        fontWeight: isHighlight ? 700 : 400,
                      }}
                    >
                      {item[1]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: C.muted2, fontSize: 11, lineHeight: 1.5 }}>
              Same-chain only. No bridges. No routing. Your wallet signs the transfer.
            </div>
          )}
        </div>

        {isEvm(selectedToken) && !isNativeEvmToken(selectedToken) && (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              background: 'rgba(0,229,255,.04)',
              border: '1px solid rgba(0,229,255,.12)',
              borderRadius: 10,
              fontSize: 11,
              color: C.text,
              lineHeight: 1.5,
            }}
          >
            ERC20 sends use two direct token transfers: one to the recipient and one to the fee wallet. No approval spender is used.
          </div>
        )}

        {error && (
          <div
            style={{
              background: 'rgba(255,59,107,.1)',
              border: '1px solid rgba(255,59,107,.3)',
              borderRadius: 10,
              padding: 12,
              marginBottom: 16,
              fontSize: 13,
              color: C.red,
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sendStatus === 'loading'}
          style={{
            width: '100%',
            padding: 18,
            borderRadius: 14,
            border: 'none',
            background:
              sendStatus === 'success'
                ? 'linear-gradient(135deg,#00ffa3,#00b36b)'
                : sendStatus === 'error'
                  ? 'rgba(255,59,107,.2)'
                  : !amount || !recipient
                    ? C.card2
                    : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            color:
              !amount || !recipient
                ? C.muted2
                : sendStatus === 'error'
                  ? C.red
                  : C.bg,
            fontFamily: 'Syne, sans-serif',
            fontWeight: 800,
            fontSize: 16,
            cursor: sendStatus === 'loading' ? 'not-allowed' : 'pointer',
            transition: 'all .3s',
            minHeight: 52,
          }}
        >
          {sendStatus === 'loading'
            ? activeWalletKind === 'privy'
              ? 'Signing...'
              : 'Confirming in Wallet...'
            : sendStatus === 'success'
              ? 'Sent!'
              : sendStatus === 'error'
                ? 'Failed -- Try Again'
                : !recipient
                  ? 'Enter Recipient Address'
                  : !amount
                    ? 'Enter Amount'
                    : 'Send ' + selectedToken.symbol}
        </button>

        {txSig && sendStatus === 'success' && txLink && (
          <a
            href={txLink}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textAlign: 'center',
              marginTop: 12,
              color: C.accent,
              fontSize: 12,
            }}
          >
            View Transaction
          </a>
        )}

        {txSig2 && sendStatus === 'success' && txLink2 && (
          <a
            href={txLink2}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textAlign: 'center',
              marginTop: 8,
              color: C.accent,
              fontSize: 12,
            }}
          >
            View Fee Transaction
          </a>
        )}

        <p
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: C.muted2,
            marginTop: 14,
            lineHeight: 1.6,
          }}
        >
          Non-custodial -- same-chain send only. Fee is paid in the same token.
        </p>
      </div>

      <TokenModal
        open={tokenModalOpen}
        jupiterTokens={jupiterTokens || []}
        currentEvmChainId={evmChainId}
        onClose={function (token) {
          setTokenModalOpen(false);
          if (token) setSelectedToken(token);
        }}
      />
    </div>
  );
}