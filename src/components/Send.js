import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { useNexusWallet } from '../WalletContext.js';
import {
  PublicKey, SystemProgram, Transaction, VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress, createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { Buffer } from 'buffer';

// LOCKED FEE RULES -- DO NOT MODIFY.
// Same-chain: 3% platform + 2% safety = 5%. Cross-chain: + 3% bridge = 8%.
// All sends are ONE TX, ONE SIGNATURE:
//   - Solana: multi-instruction transaction
//   - EVM native: Multicall3.aggregate3Value (splits ETH/BNB/etc atomically)
//   - EVM ERC20: Multicall3.aggregate3 with two transferFrom calls
//                (requires one-time MAX approval to Multicall3 per token)
//   - Cross-chain: LiFi (fee charged + routed via integrator config)
const FEE_WALLET_SOL = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const FEE_WALLET_EVM = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';
const PLATFORM_FEE   = 0.03;
const SAFETY_FEE     = 0.02;
const BRIDGE_FEE     = 0.03;
const TOTAL_FEE      = PLATFORM_FEE + SAFETY_FEE;
const TOTAL_FEE_CC   = PLATFORM_FEE + SAFETY_FEE + BRIDGE_FEE;
const LIFI_INTEGRATOR = 'nexus-dex';

// Multicall3 -- deterministic address on every major EVM chain.
// https://www.multicall3.com -- audited, used by everyone (1inch, Uni, etc.)
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MAX_UINT256 = (BigInt(2) ** BigInt(256)) - BigInt(1);

const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SOL_MINT   = 'So11111111111111111111111111111111111111112';

const CHAIN_NAMES = {
  1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB Chain',
  43114: 'Avalanche', 10: 'Optimism', 100: 'Gnosis', 324: 'zkSync Era', 59144: 'Linea',
  534352: 'Scroll', 5000: 'Mantle', 81457: 'Blast',
};

const EVM_EXPLORERS = {
  1: 'etherscan.io', 10: 'optimistic.etherscan.io', 25: 'cronoscan.com',
  56: 'bscscan.com', 100: 'gnosisscan.io', 137: 'polygonscan.com',
  250: 'ftmscan.com', 324: 'explorer.zksync.io', 1284: 'moonscan.io',
  5000: 'mantlescan.xyz', 8453: 'basescan.org', 42161: 'arbiscan.io',
  43114: 'snowtrace.io', 59144: 'lineascan.build', 81457: 'blastscan.io',
  534352: 'scrollscan.com',
};

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

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

// ============ ABI fragments for Multicall3 + ERC20 ============
const aggregate3ValueAbi = [{
  name: 'aggregate3Value', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'calls', type: 'tuple[]', components: [
    { name: 'target', type: 'address' },
    { name: 'allowFailure', type: 'bool' },
    { name: 'value', type: 'uint256' },
    { name: 'callData', type: 'bytes' },
  ]}],
  outputs: [],
}];

const aggregate3Abi = [{
  name: 'aggregate3', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'calls', type: 'tuple[]', components: [
    { name: 'target', type: 'address' },
    { name: 'allowFailure', type: 'bool' },
    { name: 'callData', type: 'bytes' },
  ]}],
  outputs: [],
}];

const erc20TransferFromAbi = [{
  name: 'transferFrom', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}];

const erc20AllowanceAbi = [{
  name: 'allowance', type: 'function', stateMutability: 'view',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}];

const erc20ApproveAbi = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}];

const POPULAR_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana', isNative: true, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: USDC_SOLANA, symbol: 'USDC', name: 'USD Coin (SOL)', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether (SOL)', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, chain: 'solana', logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, chain: 'solana', logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { address: NATIVE_EVM, chainId: 1,     symbol: 'ETH',  name: 'Ethereum',       decimals: 18, chain: 'evm', isNative: true, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 8453,  symbol: 'ETH',  name: 'ETH (Base)',     decimals: 18, chain: 'evm', isNative: true, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH',  name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm', isNative: true, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 56,    symbol: 'BNB',  name: 'BNB Chain',      decimals: 18, chain: 'evm', isNative: true, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
  { address: NATIVE_EVM, chainId: 137,   symbol: 'POL',  name: 'Polygon',        decimals: 18, chain: 'evm', isNative: true, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1,    symbol: 'USDC', name: 'USD Coin (ETH)',  decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453, symbol: 'USDC', name: 'USD Coin (Base)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chainId: 1,    symbol: 'USDT', name: 'Tether (ETH)',     decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
];

function isSol(t) { return t && t.chain === 'solana'; }
function isEvm(t) { return t && t.chain === 'evm'; }

function getRoute(fromToken, destChain) {
  if (!fromToken || !destChain) return null;
  if (isSol(fromToken) && destChain === 'solana') return 'solana';
  if (isEvm(fromToken) && destChain === fromToken.chainId) return 'evm';
  return 'lifi';
}

function pickDestToken(fromToken, destChain) {
  const fromSym = (fromToken.symbol || '').toUpperCase();
  if (destChain === 'solana') {
    if (fromSym === 'USDT') return { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, symbol: 'USDT' };
    if (fromSym === 'SOL')  return { mint: SOL_MINT, decimals: 9, symbol: 'SOL' };
    return { mint: USDC_SOLANA, decimals: 6, symbol: 'USDC' };
  }
  const usdc = USDC_BY_CHAIN[destChain];
  if (usdc) return { address: usdc, decimals: 6, symbol: 'USDC' };
  return { address: NATIVE_EVM, decimals: 18, symbol: CHAIN_NAMES[destChain] || 'NATIVE' };
}

async function getSolDecimals(token) {
  if (!token || !token.mint) return 6;
  var popular = POPULAR_TOKENS.find(function(t) { return t.mint === token.mint; });
  if (popular) return popular.decimals;
  try {
    var r = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + token.mint);
    if (r.ok) {
      var d = await r.json();
      var dec = parseInt(d.decimals);
      return (!isNaN(dec) && dec >= 0 && dec <= 18) ? dec : (token.decimals || 6);
    }
  } catch (e) {}
  return token.decimals || 6;
}

function fmt(n) {
  if (!n) return '$0.00';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function toRawAmount(amountStr, decimals) {
  if (amountStr == null) return BigInt(0);
  var s = String(amountStr).trim();
  if (!s || isNaN(Number(s))) return BigInt(0);
  var parts = s.split('.');
  var whole = parts[0] || '0';
  var frac  = parts[1] || '';
  var fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + (fracPadded ? BigInt(fracPadded) : BigInt(0));
}

function splitFeeRaw(totalRaw) {
  var feeRaw = (totalRaw * BigInt(5)) / BigInt(100);
  return { feeRaw: feeRaw, recipientRaw: totalRaw - feeRaw };
}

function ChainBadge({ token }) {
  if (!token) return null;
  var label = isSol(token) ? 'SOL' : (CHAIN_NAMES[token.chainId] || 'EVM');
  var color = isSol(token) ? '#9945ff' : '#627eea';
  return <span style={{ fontSize: 9, color, background: color + '22', border: '1px solid ' + color + '44', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>{label}</span>;
}

function TokenModal({ open, onClose, jupiterTokens, currentEvmChainId }) {
  const [q, setQ] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const lookupReqRef = React.useRef(0);

  var solTokens = jupiterTokens && jupiterTokens.length > 0
    ? jupiterTokens.map(function(t) { return Object.assign({}, t, { chain: 'solana' }); })
    : POPULAR_TOKENS.filter(function(t) { return t.chain === 'solana'; });

  var isValidSol = function(s) { return s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s); };
  var isValidEvm = function(s) { return s && /^0x[0-9a-fA-F]{40}$/.test(s); };

  var lookupContract = async function(addr) {
    if (!isValidSol(addr) && !isValidEvm(addr)) return;
    var reqId = ++lookupReqRef.current;
    setContractLoading(true);
    try {
      if (isValidSol(addr)) {
        var found = solTokens.find(function(t) { return t.mint === addr; });
        if (found) { if (lookupReqRef.current === reqId) setContractToken(found); }
        else {
          var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr);
          if (lookupReqRef.current !== reqId) return;
          if (res.ok) {
            var data = await res.json();
            setContractToken({ mint: data.address, symbol: data.symbol, name: data.name, decimals: data.decimals || 6, chain: 'solana', logoURI: data.logoURI });
          } else {
            setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
          }
        }
      } else if (isValidEvm(addr)) {
        var chainId = (typeof currentEvmChainId === 'number' && currentEvmChainId > 0) ? currentEvmChainId : 1;
        if (lookupReqRef.current === reqId) {
          setContractToken({ address: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom EVM Token (' + (CHAIN_NAMES[chainId] || ('Chain ' + chainId)) + ')', decimals: 18, chain: 'evm', chainId: chainId });
        }
      }
    } catch (e) {
      if (lookupReqRef.current === reqId) setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
    }
    if (lookupReqRef.current === reqId) setContractLoading(false);
  };

  useEffect(function() {
    if (!q || q.length < 1) { setSearchResults([]); return; }
    var ql = q.toLowerCase();
    var sm = solTokens.filter(function(t) {
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql)) || (t.mint && t.mint.toLowerCase().includes(ql));
    }).slice(0, 40);
    var em = POPULAR_TOKENS.filter(function(t) {
      if (t.chain !== 'evm') return false;
      var cn = CHAIN_NAMES[t.chainId] || '';
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql)) || cn.toLowerCase().includes(ql);
    }).slice(0, 20);
    setSearchResults(sm.concat(em));
  }, [q, solTokens]);

  var displayTokens = q ? searchResults : POPULAR_TOKENS;
  var close = function() { setQ(''); setContractAddr(''); setContractToken(null); setSearchResults([]); onClose(null); };

  useEffect(function() {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    var prevOverflow = document.body.style.overflow;
    var prevTouch = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 27) close(); }
    window.addEventListener('keydown', onKey);
    return function() {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.touchAction = prevTouch || '';
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(function() { if (!contractAddr) setContractToken(null); }, [contractAddr]);

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
              <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens - DYOR</div>
            </div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>x</button>
          </div>
          <input autoFocus value={q} onChange={function(e) { setQ(e.target.value); }} placeholder="Search name, symbol, chain..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8 }} />
          <input value={contractAddr} onChange={function(e) { setContractAddr(e.target.value); }} onBlur={function() { if (contractAddr) lookupContract(contractAddr); }} placeholder="Or paste Solana or EVM contract address..." style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
          {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
          {contractToken && !contractLoading && (
            <div onClick={function() { onClose(contractToken); setContractAddr(''); setContractToken(null); setQ(''); }} style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              {contractToken.logoURI ? <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>{contractToken.symbol && contractToken.symbol.charAt(0)}</div>}
              <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div><div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div></div>
              <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>POPULAR TOKENS</div>}
          {q && searchResults.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found. Paste a contract address above.</div>}
          {displayTokens.map(function(t, i) {
            var key = (t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i;
            return (
              <div key={key} onClick={function() { onClose(t); setQ(''); }} style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }} onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }} onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}>
                {t.logoURI ? <img src={t.logoURI} alt={t.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{t.symbol && t.symbol.charAt(0)}</div>}
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

export default function Send({ coins, jupiterTokens, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const { publicKey, sendTransaction, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchToChain } = useNexusWallet();

  const walletConnected = isConnected || solConnected || evmConnected;

  const [selectedToken, setSelectedToken] = useState(POPULAR_TOKENS[0]);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [slip, setSlip] = useState(0.5);
  const [destChain, setDestChain] = useState('solana');
  const [sendStatus, setSendStatus] = useState('idle');
  const [txSig, setTxSig] = useState(null);
  const [error, setError] = useState('');
  const [solBalance, setSolBalance] = useState(null);
  const [lifiRoute, setLifiRoute] = useState(null);
  const [lifiLoading, setLifiLoading] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);

  var route = getRoute(selectedToken, destChain);
  var isCrossChain = route === 'lifi';
  var feeRate = isCrossChain ? TOTAL_FEE_CC : TOTAL_FEE;

  useEffect(function() {
    if (isSol(selectedToken)) setDestChain('solana');
    else if (isEvm(selectedToken)) setDestChain(selectedToken.chainId);
  }, [selectedToken]);

  useEffect(function() {
    if (!publicKey || !connection) return;
    connection.getBalance(publicKey).then(function(b) { setSolBalance(b / 1e9); }).catch(function() {});
  }, [publicKey, connection]);

  // Pre-flight allowance check for EVM ERC20 same-chain so we can show a
  // truthful "first send needs one-time approval" hint in the UI before
  // the user clicks Send. After the MAX approval is set, every future
  // send of this token is one signature.
  useEffect(function() {
    setNeedsApproval(false);
    if (route !== 'evm') return;
    if (!evmAddress || !walletClient) return;
    var isNative = selectedToken.address && selectedToken.address.toLowerCase() === NATIVE_EVM;
    if (isNative) return;
    if (!amount || parseFloat(amount) <= 0) return;
    var aborted = false;
    (async function() {
      try {
        var allowanceData = encodeFunctionData({
          abi: erc20AllowanceAbi, functionName: 'allowance',
          args: [evmAddress, MULTICALL3],
        });
        var hex = await walletClient.request({
          method: 'eth_call',
          params: [{ to: selectedToken.address, data: allowanceData }, 'latest'],
        });
        if (aborted) return;
        var current = BigInt(hex || '0x0');
        var totalRaw = toRawAmount(amount, selectedToken.decimals);
        setNeedsApproval(current < totalRaw);
      } catch (e) {
        if (!aborted) setNeedsApproval(true);
      }
    })();
    return function() { aborted = true; };
  }, [route, selectedToken, amount, evmAddress, walletClient]);

  useEffect(function() {
    setLifiRoute(null);
    if (route !== 'lifi' || !amount || parseFloat(amount) <= 0 || !selectedToken) return;
    var aborted = false;
    setLifiLoading(true);
    var fromAddr = isSol(selectedToken)
      ? (publicKey ? publicKey.toString() : '11111111111111111111111111111111')
      : (evmAddress || '0x0000000000000000000000000000000000000001');
    var fromChainId  = isSol(selectedToken) ? 'SOL' : selectedToken.chainId.toString();
    var toChainId    = destChain === 'solana' ? 'SOL' : destChain.toString();
    var fromTokenAddr = isSol(selectedToken) ? selectedToken.mint : selectedToken.address;
    var destTok = pickDestToken(selectedToken, destChain);
    var toTokenAddr = destTok.address || destTok.mint;
    var fromAmtRaw = toRawAmount(amount, selectedToken.decimals || 6).toString();
    var toAddr = recipient && recipient.length > 10 ? recipient : (destChain === 'solana' ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000001');
    var params = new URLSearchParams({
      fromChain: fromChainId, toChain: toChainId,
      fromToken: fromTokenAddr, toToken: toTokenAddr,
      fromAmount: fromAmtRaw, fromAddress: fromAddr, toAddress: toAddr,
      slippage: String(slip / 100),
      fee: String(TOTAL_FEE_CC), integrator: LIFI_INTEGRATOR,
    });
    fetch('https://li.quest/v1/quote?' + params.toString())
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!aborted && data && data.estimate) {
          data._destDecimals = destTok.decimals;
          data._destSymbol = destTok.symbol;
          setLifiRoute(data);
        }
        if (!aborted) setLifiLoading(false);
      })
      .catch(function() { if (!aborted) setLifiLoading(false); });
    return function() { aborted = true; };
  }, [route, amount, selectedToken, destChain, recipient, publicKey, evmAddress, slip]);

  var getPrice = function(symbol) {
    var coin = (coins || []).find(function(c) { return c.symbol && c.symbol.toLowerCase() === (symbol || '').toLowerCase(); });
    return coin ? coin.current_price : 0;
  };

  var isValidSolAddr = function(a) { try { new PublicKey(a); return a.length >= 32; } catch (e) { return false; } };
  var isValidEvmAddr = function(a) { return a && /^0x[0-9a-fA-F]{40}$/.test(a); };
  var isValidRecipient = function(a) {
    if (!a) return false;
    if (destChain === 'solana') return isValidSolAddr(a);
    return isValidEvmAddr(a);
  };

  var amountNum = parseFloat(amount) || 0;
  var price = getPrice(selectedToken.symbol);
  var usdValue = amountNum * price;
  var feeAmountDisp = amountNum * feeRate;
  var recipientAmountDisp = amountNum - feeAmountDisp;

  var handleSend = async function() {
    if (!walletConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!isValidRecipient(recipient)) { setError('Invalid recipient address'); return; }
    if (!amountNum || amountNum <= 0) { setError('Enter a valid amount'); return; }
    setError(''); setSendStatus('loading');

    try {
      if (route === 'solana') {
        // SOLANA SAME-CHAIN -- one tx, multiple instructions, one signature.
        if (!publicKey) throw new Error('Connect Solana wallet');
        var recipientPubkey = new PublicKey(recipient);
        var feeWalletPk = new PublicKey(FEE_WALLET_SOL);
        var transaction = new Transaction();

        if (selectedToken.mint === SOL_MINT) {
          var totalLam = toRawAmount(amount, 9);
          var split = splitFeeRaw(totalLam);
          transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipientPubkey, lamports: split.recipientRaw }));
          transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeWalletPk, lamports: split.feeRaw }));
        } else {
          var decimals = await getSolDecimals(selectedToken);
          var totalRaw = toRawAmount(amount, decimals);
          var split2 = splitFeeRaw(totalRaw);
          var mintPk = new PublicKey(selectedToken.mint);
          var fromAta = await getAssociatedTokenAddress(mintPk, publicKey);
          var toAta   = await getAssociatedTokenAddress(mintPk, recipientPubkey);
          var feeAta  = await getAssociatedTokenAddress(mintPk, feeWalletPk);
          var atas = await Promise.all([
            connection.getAccountInfo(toAta).catch(function() { return null; }),
            connection.getAccountInfo(feeAta).catch(function() { return null; }),
          ]);
          if (!atas[0]) transaction.add(createAssociatedTokenAccountInstruction(publicKey, toAta, recipientPubkey, mintPk));
          if (!atas[1]) transaction.add(createAssociatedTokenAccountInstruction(publicKey, feeAta, feeWalletPk, mintPk));
          transaction.add(createTransferInstruction(fromAta, toAta, publicKey, split2.recipientRaw));
          transaction.add(createTransferInstruction(fromAta, feeAta, publicKey, split2.feeRaw));
        }

        var lb = await connection.getLatestBlockhash();
        transaction.recentBlockhash = lb.blockhash;
        transaction.feePayer = publicKey;
        var sig = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        setTxSig(sig);

      } else if (route === 'evm') {
        // EVM SAME-CHAIN via Multicall3 -- ONE tx, ONE signature.
        // Native: aggregate3Value forwards lamports to recipient + fee
        // wallet from the call's own value. ERC20: aggregate3 calls
        // token.transferFrom twice, pulling allowance from Multicall3
        // (which the user has approved MAX once per token, lifetime).
        // First-send-per-token requires that one-time MAX approval; this
        // is the chain-level minimum (every EVM DEX works this way). The
        // approval popup is unavoidable and is shown explicitly so the
        // user knows what they're signing.
        if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
        if (evmChainId && evmChainId !== selectedToken.chainId) {
          var ok = await switchToChain(selectedToken.chainId);
          if (!ok) throw new Error('Could not switch to ' + (CHAIN_NAMES[selectedToken.chainId] || ('chain ' + selectedToken.chainId)) + '. Switch in your wallet and retry.');
        }
        var totalRawE = toRawAmount(amount, selectedToken.decimals);
        var splitE = splitFeeRaw(totalRawE);
        var isNative = selectedToken.address.toLowerCase() === NATIVE_EVM;

        if (isNative) {
          // Multicall3.aggregate3Value: ETH/native goes to caller,
          // forwarded to each target with the per-call value.
          var nativeCalls = [
            { target: recipient,      allowFailure: false, value: splitE.recipientRaw, callData: '0x' },
            { target: FEE_WALLET_EVM, allowFailure: false, value: splitE.feeRaw,       callData: '0x' },
          ];
          var nativeData = encodeFunctionData({
            abi: aggregate3ValueAbi, functionName: 'aggregate3Value',
            args: [nativeCalls],
          });
          var nativeHash = await walletClient.sendTransaction({
            to: MULTICALL3, value: totalRawE, data: nativeData,
          });
          setTxSig(nativeHash);
        } else {
          // ERC20: ensure MAX approval to Multicall3 first (one-time per
          // token). Then aggregate3 with two transferFrom calls.
          var allowanceData = encodeFunctionData({
            abi: erc20AllowanceAbi, functionName: 'allowance',
            args: [evmAddress, MULTICALL3],
          });
          var allowanceHex = await walletClient.request({
            method: 'eth_call',
            params: [{ to: selectedToken.address, data: allowanceData }, 'latest'],
          });
          var currentAllowance = BigInt(allowanceHex || '0x0');

          if (currentAllowance < totalRawE) {
            var approveData = encodeFunctionData({
              abi: erc20ApproveAbi, functionName: 'approve',
              args: [MULTICALL3, MAX_UINT256],
            });
            var approveHash = await walletClient.sendTransaction({
              to: selectedToken.address, data: approveData, value: BigInt(0),
            });
            // Wait long enough for the allowance to be visible to the
            // next eth_call. Most chains finalize in 2-5s.
            await new Promise(function(r) { setTimeout(r, 5000); });
          }

          var transferFromRecipient = encodeFunctionData({
            abi: erc20TransferFromAbi, functionName: 'transferFrom',
            args: [evmAddress, recipient, splitE.recipientRaw],
          });
          var transferFromFee = encodeFunctionData({
            abi: erc20TransferFromAbi, functionName: 'transferFrom',
            args: [evmAddress, FEE_WALLET_EVM, splitE.feeRaw],
          });

          var erc20Calls = [
            { target: selectedToken.address, allowFailure: false, callData: transferFromRecipient },
            { target: selectedToken.address, allowFailure: false, callData: transferFromFee },
          ];
          var erc20Data = encodeFunctionData({
            abi: aggregate3Abi, functionName: 'aggregate3',
            args: [erc20Calls],
          });
          var erc20Hash = await walletClient.sendTransaction({
            to: MULTICALL3, data: erc20Data, value: BigInt(0),
          });
          setTxSig(erc20Hash);
        }

      } else if (route === 'lifi') {
        // CROSS-CHAIN -- ONE TX, ONE SIGNATURE. 8% fee handled by LiFi
        // via fee=0.08 + integrator=nexus-dex; LiFi routes the fee to
        // our registered integrator wallets.
        var srcAddr = isSol(selectedToken) ? (publicKey ? publicKey.toString() : null) : (evmAddress || null);
        if (!srcAddr) throw new Error('Connect your ' + (isSol(selectedToken) ? 'Solana' : 'EVM') + ' wallet');
        if (!recipient || recipient.length < 10) throw new Error('Enter recipient address');
        var execFromChain = isSol(selectedToken) ? 'SOL' : selectedToken.chainId.toString();
        var execToChain   = destChain === 'solana' ? 'SOL' : destChain.toString();
        var execFromToken = isSol(selectedToken) ? selectedToken.mint : selectedToken.address;
        var execDestTok   = pickDestToken(selectedToken, destChain);
        var execToToken   = execDestTok.address || execDestTok.mint;
        var execFromAmt   = toRawAmount(amount, selectedToken.decimals || 6).toString();
        var freshParams = new URLSearchParams({
          fromChain: execFromChain, toChain: execToChain,
          fromToken: execFromToken, toToken: execToToken,
          fromAmount: execFromAmt, fromAddress: srcAddr, toAddress: recipient,
          slippage: String(slip / 100),
          fee: String(TOTAL_FEE_CC), integrator: LIFI_INTEGRATOR,
        });
        var freshRes = await fetch('https://li.quest/v1/quote?' + freshParams.toString());
        var freshRoute = await freshRes.json();
        if (!freshRes.ok || !freshRoute.transactionRequest) {
          throw new Error(freshRoute.message || 'LiFi could not find a route -- try adjusting amount');
        }
        var txReq = freshRoute.transactionRequest;
        if (isSol(selectedToken)) {
          if (!publicKey) throw new Error('Connect Solana wallet');
          var lifiSolTx = VersionedTransaction.deserialize(Buffer.from(txReq.data, 'base64'));
          var lifiBh = await connection.getLatestBlockhash('confirmed');
          var lifiSig = await sendTransaction(lifiSolTx, connection, { skipPreflight: false, maxRetries: 3 });
          await connection.confirmTransaction({ signature: lifiSig, blockhash: lifiBh.blockhash, lastValidBlockHeight: lifiBh.lastValidBlockHeight }, 'confirmed');
          setTxSig(lifiSig);
        } else {
          if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
          if (evmChainId && evmChainId !== selectedToken.chainId) {
            var ok2 = await switchToChain(selectedToken.chainId);
            if (!ok2) throw new Error('Could not switch to ' + (CHAIN_NAMES[selectedToken.chainId] || ('chain ' + selectedToken.chainId)) + '. Switch in your wallet and retry.');
          }
          var isNativeSell = selectedToken.address.toLowerCase() === NATIVE_EVM;
          if (!isNativeSell) {
            var spender = txReq.to;
            var sellBig = BigInt(execFromAmt);
            var allowCalldata = encodeFunctionData({
              abi: erc20AllowanceAbi, functionName: 'allowance',
              args: [evmAddress, spender],
            });
            var needsApproveLifi = true;
            try {
              var allowHex = await walletClient.request({ method: 'eth_call', params: [{ to: selectedToken.address, data: allowCalldata }, 'latest'] });
              needsApproveLifi = BigInt(allowHex || '0x0') < sellBig;
            } catch (_) {}
            if (needsApproveLifi) {
              var approveLifiData = encodeFunctionData({
                abi: erc20ApproveAbi, functionName: 'approve',
                args: [spender, MAX_UINT256],
              });
              await walletClient.sendTransaction({ to: selectedToken.address, data: approveLifiData, value: BigInt(0) });
              await new Promise(function(r) { setTimeout(r, 5000); });
            }
          }
          var lifiHash = await walletClient.sendTransaction({
            to: txReq.to, data: txReq.data,
            value: txReq.value ? BigInt(txReq.value) : BigInt(0),
            gas: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
          });
          setTxSig(lifiHash);
        }
      }

      setSendStatus('success'); setAmount(''); setRecipient(''); setLifiRoute(null);
      setTimeout(function() { setSendStatus('idle'); setTxSig(null); }, 6000);
    } catch (e) {
      console.error('Send error:', e); setError(e.message || 'Transaction failed'); setSendStatus('error');
      setTimeout(function() { setSendStatus('idle'); setError(''); }, 5000);
    }
  };

  var txLink = (function() {
    if (!txSig) return null;
    if (route === 'solana') return 'https://solscan.io/tx/' + txSig;
    if (route === 'lifi') return isSol(selectedToken) ? 'https://solscan.io/tx/' + txSig : 'https://scan.li.fi/tx/' + txSig;
    var host = EVM_EXPLORERS[selectedToken.chainId];
    return host ? 'https://' + host + '/tx/' + txSig : null;
  })();

  var destChainOptions = [
    { id: 'solana', label: 'Solana' }, { id: 1, label: 'Ethereum' }, { id: 8453, label: 'Base' },
    { id: 42161, label: 'Arbitrum' }, { id: 137, label: 'Polygon' }, { id: 56, label: 'BNB Chain' },
    { id: 43114, label: 'Avalanche' }, { id: 10, label: 'Optimism' },
  ];

  if (!walletConnected) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Solana, EVM, and cross-chain</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>-&gt;</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Wallet to Send</h2>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>Send any token on Solana, EVM, or cross-chain via LI.FI.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Send Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
          {route === 'solana' ? 'Solana same-chain - 5% fee' : route === 'evm' ? 'EVM same-chain - 5% fee' : 'Cross-chain via LI.FI - 8% fee'}
        </p>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>SELECT TOKEN</div>
          <button onClick={function() { setTokenModalOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', width: '100%' }}>
            {selectedToken.logoURI ? <img src={selectedToken.logoURI} alt={selectedToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent }}>{selectedToken.symbol && selectedToken.symbol.charAt(0)}</div>}
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</span>
                <ChainBadge token={selectedToken} />
              </div>
              <div style={{ color: C.muted, fontSize: 11 }}>{selectedToken.name}</div>
            </div>
            <span style={{ color: C.muted, fontSize: 11 }}>Change v</span>
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>DESTINATION CHAIN</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {destChainOptions.map(function(opt) {
              var active = destChain === opt.id;
              return <button key={opt.id} onClick={function() { setDestChain(opt.id); }} style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600, background: active ? 'rgba(0,229,255,.12)' : 'transparent', border: '1px solid ' + (active ? 'rgba(0,229,255,.35)' : C.border), color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif' }}>{opt.label}</button>;
            })}
          </div>
          {route === 'lifi' && <div style={{ fontSize: 10, color: C.accent, marginTop: 6 }}>Cross-chain bridge via LI.FI</div>}
        </div>

        {route === 'lifi' && (
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0.1, 0.5, 1.0].map(function(v) {
                return <button key={v} onClick={function() { setSlip(v); }} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent', border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border), color: slip === v ? C.accent : C.muted }}>{v}%</button>;
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>RECIPIENT ADDRESS</div>
          <input value={recipient} onChange={function(e) { setRecipient(e.target.value); }} placeholder={destChain === 'solana' ? 'Solana wallet address...' : '0x EVM address...'} style={{ width: '100%', background: C.card2, border: '1px solid ' + (recipient && !isValidRecipient(recipient) ? C.red : C.border), borderRadius: 12, padding: '14px 16px', color: C.text, fontFamily: 'monospace', fontSize: 12, outline: 'none' }} />
          {recipient && !isValidRecipient(recipient) && <div style={{ color: C.red, fontSize: 11, marginTop: 4 }}>Invalid address for {destChain === 'solana' ? 'Solana' : 'EVM'}</div>}
          {recipient && isValidRecipient(recipient) && <div style={{ color: C.green, fontSize: 11, marginTop: 4 }}>Valid address</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>AMOUNT</span>
            {isSol(selectedToken) && solBalance != null && <span style={{ fontSize: 11, color: C.muted }}>Balance: {solBalance.toFixed(4)} SOL</span>}
          </div>
          <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input value={amount} onChange={function(e) { setAmount(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 600, color: '#fff', outline: 'none', minWidth: 0 }} />
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{selectedToken.symbol}</div>
              {price > 0 && amount && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{fmt(usdValue)}</div>}
            </div>
          </div>
          {isSol(selectedToken) && selectedToken.mint === SOL_MINT && solBalance != null && solBalance > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[0.25, 0.5, 0.75, 1].map(function(p) {
                return <button key={p} onClick={function() { setAmount((solBalance * p * 0.99).toFixed(6)); }} style={{ flex: 1, padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid ' + C.border, color: C.muted, fontFamily: 'Syne, sans-serif' }}>{p === 1 ? 'MAX' : (p * 100) + '%'}</button>;
              })}
            </div>
          )}
        </div>

        {route === 'evm' && needsApproval && selectedToken.address && selectedToken.address.toLowerCase() !== NATIVE_EVM && (
          <div style={{ marginBottom: 14, padding: 12, background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 10, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
            <span style={{ color: C.accent, fontWeight: 700 }}>First send of this token:</span> your wallet will prompt a one-time MAX approval to Multicall3 (0xcA11...CA11). After that, every future send of {selectedToken.symbol} is a single signature.
          </div>
        )}

        {route === 'lifi' && (
          <div style={{ marginBottom: 14, padding: 12, background: 'rgba(0,229,255,.04)', border: '1px solid rgba(0,229,255,.12)', borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>CROSS-CHAIN ROUTE</div>
            {lifiLoading && <div style={{ color: C.muted, fontSize: 12 }}>Finding best route...</div>}
            {!lifiLoading && lifiRoute && lifiRoute.estimate && (
              <div style={{ fontSize: 12, color: C.text }}>
                Recipient gets: <span style={{ color: C.green, fontWeight: 700 }}>
                  {(parseInt(lifiRoute.estimate.toAmount) / Math.pow(10, lifiRoute._destDecimals || 6)).toFixed(6)} {lifiRoute._destSymbol || ''}
                </span>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>via {lifiRoute.tool || 'LI.FI'}</div>
              </div>
            )}
            {!lifiLoading && !lifiRoute && amount && parseFloat(amount) > 0 && <div style={{ color: C.red, fontSize: 12 }}>No cross-chain route found for this pair</div>}
          </div>
        )}

        <div style={{ background: '#050912', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          {amount && amountNum > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform fee (3%)', (amountNum * PLATFORM_FEE).toFixed(6) + ' ' + selectedToken.symbol],
                ['Safety fee (2%)',   (amountNum * SAFETY_FEE).toFixed(6)   + ' ' + selectedToken.symbol],
                isCrossChain ? ['Bridge fee (3%)', (amountNum * BRIDGE_FEE).toFixed(6) + ' ' + selectedToken.symbol] : null,
                ['Total fee (' + (feeRate * 100).toFixed(0) + '%)', feeAmountDisp.toFixed(6) + ' ' + selectedToken.symbol],
                !isCrossChain ? ['Recipient gets', recipientAmountDisp.toFixed(6) + ' ' + selectedToken.symbol] : null,
                price > 0 ? ['USD Value', fmt(usdValue)] : null,
              ].filter(Boolean).map(function(item) {
                var isHighlight = item[0] === 'Recipient gets';
                return <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}><span style={{ color: C.muted }}>{item[0]}</span><span style={{ color: isHighlight ? C.green : C.text, fontWeight: isHighlight ? 700 : 400 }}>{item[1]}</span></div>;
              })}
            </div>
          )}
        </div>

        {error && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{error}</div>}

        <button onClick={handleSend} disabled={sendStatus === 'loading'} style={{ width: '100%', padding: 18, borderRadius: 14, border: 'none', background: sendStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : sendStatus === 'error' ? 'rgba(255,59,107,.2)' : !amount || !recipient ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: !amount || !recipient ? C.muted2 : sendStatus === 'error' ? C.red : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: sendStatus === 'loading' ? 'not-allowed' : 'pointer', transition: 'all .3s', minHeight: 52 }}>
          {sendStatus === 'loading' ? 'Confirming in Wallet...' : sendStatus === 'success' ? 'Sent!' : sendStatus === 'error' ? 'Failed -- Try Again' : !recipient ? 'Enter Recipient Address' : !amount ? 'Enter Amount' : route === 'lifi' && lifiLoading ? 'Finding Route...' : route === 'lifi' && !lifiRoute ? 'No Route Found' : 'Send ' + selectedToken.symbol + (route === 'lifi' ? ' Cross-Chain' : '')}
        </button>

        {txSig && sendStatus === 'success' && txLink && (
          <a href={txLink} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 12, color: C.accent, fontSize: 12 }}>View Transaction</a>
        )}
        <p style={{ textAlign: 'center', fontSize: 11, color: C.muted2, marginTop: 14, lineHeight: 1.6 }}>Non-custodial &mdash; one signature, one transaction. Fee paid in same token to Nexus DEX.</p>
      </div>

      <TokenModal open={tokenModalOpen} jupiterTokens={jupiterTokens || []} currentEvmChainId={evmChainId} onClose={function(token) { setTokenModalOpen(false); if (token) setSelectedToken(token); }} />
    </div>
  );
}
