Fixes (5): same as doc 10 — '--' in fmt/pct, '...' in lookupByAddress ×3.

Differences from doc 10: adds same-token guard in fetchQuote, uses Math.floor instead of .toFixed(0) for 0x sellAmt, adds console.log('0x params:', ...), and slightly different lifi error message strings.

import React, { useState, useEffect, useCallback } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient } from 'wagmi';
import { VersionedTransaction, TransactionMessage, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const EVM_FEE_WALLET = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';
const PLATFORM_FEE = 0.03;
const SAFETY_FEE = 0.02;
const TOTAL_FEE = PLATFORM_FEE + SAFETY_FEE;
var NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

var CHAIN_NAMES = {
  1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB Chain',
  43114: 'Avalanche', 10: 'Optimism', 100: 'Gnosis', 324: 'zkSync Era', 59144: 'Linea',
  534352: 'Scroll', 5000: 'Mantle', 81457: 'Blast', 34443: 'Mode', 130: 'Unichain',
  146: 'Sonic', 80094: 'Berachain', 57073: 'Ink', 10143: 'Monad', 480: 'World Chain',
  1101: 'Polygon zkEVM', 250: 'Fantom', 25: 'Cronos', 1284: 'Moonbeam', 42220: 'Celo',
  1313161554: 'Aurora', 2222: 'Kava', 1088: 'Metis', 288: 'Boba', 167000: 'Taiko',
  1329: 'SEI', 2741: 'Abstract', 33139: 'ApeChain', 60808: 'BOB', 7777777: 'Zora',
  2020: 'Ronin', 122: 'Fuse', 1135: 'Lisk', 48900: 'Zircuit', 747: 'Flow',
  43111: 'Hemi', 1116: 'Core', 8217: 'Klaytn', 252: 'Fraxtal', 255: 'Kroma',
  200901: 'Bitlayer', 6342: 'MegaETH', 321: 'KCC', 360: 'Shape',
};

const POPULAR_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, chain: 'solana', logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, chain: 'solana', logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth', decimals: 6, chain: 'solana', logoURI: 'https://pyth.network/token.svg' },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'WETH', name: 'Wrapped Ether', decimals: 8, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
  // Popular EVM tokens
  { address: NATIVE, chainId: 1, symbol: 'ETH', name: 'Ethereum', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE, chainId: 8453, symbol: 'ETH', name: 'ETH (Base)', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE, chainId: 42161, symbol: 'ETH', name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE, chainId: 10, symbol: 'ETH', name: 'ETH (Optimism)', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE, chainId: 56, symbol: 'BNB', name: 'BNB Chain', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
  { address: NATIVE, chainId: 137, symbol: 'POL', name: 'Polygon', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
  { address: NATIVE, chainId: 43114, symbol: 'AVAX', name: 'Avalanche', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png' },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, symbol: 'USDC', name: 'USD Coin (ETH)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453, symbol: 'USDC', name: 'USD Coin (Base)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, symbol: 'USDC', name: 'USD Coin (Arbitrum)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chainId: 1, symbol: 'USDT', name: 'Tether (ETH)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chainId: 1, symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png' },
];

function isSol(t) { return t && t.chain === 'solana'; }
function isEvm(t) { return t && t.chain === 'evm'; }
function getRoute(from, to) {
  if (!from || !to) return 'jupiter';
  if (isSol(from) && isSol(to)) return 'jupiter';
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId) return '0x';
  return 'lifi';
}

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (!n && n !== 0) return '--';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function ChainBadge({ token }) {
  if (!token) return null;
  var label = isSol(token) ? 'SOL' : (CHAIN_NAMES[token.chainId] || 'EVM');
  var color = isSol(token) ? '#9945ff' : '#627eea';
  return <span style={{ fontSize: 9, color: color, background: color + '22', border: '1px solid ' + color + '44', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>{label}</span>;
}

function TokenSelect({ selected, onSelect, jupiterTokens }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  var solTokens = jupiterTokens && jupiterTokens.length > 0
    ? jupiterTokens.map(function(t) { return Object.assign({}, t, { chain: 'solana' }); })
    : POPULAR_TOKENS.filter(function(t) { return t.chain === 'solana'; });

  var isValidSolAddress = function(str) {
    return str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
  };

  var isValidEvmAddress = function(str) {
    return str && /^0x[0-9a-fA-F]{40}$/.test(str);
  };

  var lookupByAddress = async function(addr) {
    if (!isValidSolAddress(addr) && !isValidEvmAddress(addr)) return;
    setContractLoading(true);
    try {
      if (isValidSolAddress(addr)) {
        var found = solTokens.find(function(t) { return t.mint === addr; });
        if (found) { setContractToken(found); }
        else {
          var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr);
          if (res.ok) {
            var data = await res.json();
            setContractToken({ mint: data.address, symbol: data.symbol, name: data.name, decimals: data.decimals, logoURI: data.logoURI, chain: 'solana' });
          } else {
            setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
          }
        }
      } else if (isValidEvmAddress(addr)) {
        setContractToken({ address: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom EVM Token', decimals: 18, chain: 'evm', chainId: 1 });
      }
    } catch (e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
    }
    setContractLoading(false);
  };

  useEffect(function() {
    if (!q || q.length < 1) { setSearchResults([]); return; }
    var ql = q.toLowerCase();

    var chainMatch = Object.entries(CHAIN_NAMES).find(function(entry) {
      return entry[1].toLowerCase().includes(ql);
    });

    var sm = solTokens.filter(function(t) {
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
             (t.name && t.name.toLowerCase().includes(ql)) ||
             (t.mint && t.mint.toLowerCase().includes(ql));
    }).slice(0, 50);

    var em = POPULAR_TOKENS.filter(function(t) {
      if (t.chain !== 'evm') return false;
      var chainName = CHAIN_NAMES[t.chainId] || '';
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) ||
             (t.name && t.name.toLowerCase().includes(ql)) ||
             chainName.toLowerCase().includes(ql);
    }).slice(0, 20);

    setSearchResults(sm.concat(em));

    var searchEvm = async function() {
      try {
        var lifiRes = await fetch('https://li.quest/v1/tokens?chainTypes=EVM');
        var lifiData = await lifiRes.json();
        if (!lifiData.tokens) return;
        var evmResults = [];
        var seen = new Set(em.map(function(t) { return t.address + '-' + t.chainId; }));
        Object.values(lifiData.tokens).forEach(function(chainTokens) {
          chainTokens.forEach(function(t) {
            if (!t.symbol || !t.address || !t.chainId) return;
            var key = t.address.toLowerCase() + '-' + t.chainId;
            if (seen.has(key)) return;
            if ((t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql))) {
              seen.add(key);
              evmResults.push({ address: t.address, chainId: t.chainId, symbol: t.symbol, name: t.name, decimals: t.decimals || 18, chain: 'evm', logoURI: t.logoURI });
            }
          });
        });
        setSearchResults(sm.concat(em).concat(evmResults.slice(0, 100)));
      } catch (e) {}
    };
    if (q.length >= 2) searchEvm();
  }, [q, solTokens]);

  var displayTokens = q ? searchResults : POPULAR_TOKENS;
  var close = function() { setOpen(false); setQ(''); setContractAddr(''); setContractToken(null); setSearchResults([]); };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={function() { setOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card3, border: '1px solid ' + C.border, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', minWidth: 90 }}>
        {selected && selected.logoURI && <img src={selected.logoURI} alt={selected.symbol} style={{ width: 20, height: 20, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} />}
        {selected && !selected.logoURI && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: C.accent }}>{selected.symbol && selected.symbol.charAt(0)}</div>}
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{selected ? selected.symbol : 'Select'}</span>
        <span style={{ color: C.muted, fontSize: 9 }}>v</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,.75)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 300, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
            <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Select Token</div>
                  <div style={{ fontSize: 10, color: C.red, marginTop: 2 }}>Includes unverified tokens -- DYOR</div>
                </div>
                <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }}>x</button>
              </div>
              <input autoFocus value={q} onChange={function(e) { setQ(e.target.value); }} placeholder="Search name, symbol, chain, or address..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 8 }} />
              <input value={contractAddr} onChange={function(e) { setContractAddr(e.target.value); }} onBlur={function() { if (contractAddr) lookupByAddress(contractAddr); }} placeholder="Or paste any Solana or EVM contract address..." style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '10px 12px', color: C.accent, fontSize: 12, outline: 'none', fontFamily: 'monospace' }} />
              {contractLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Looking up token...</div>}
              {contractToken && !contractLoading && (
                <div onClick={function() { onSelect(contractToken); close(); }} style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {contractToken.logoURI ? <img src={contractToken.logoURI} alt={contractToken.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} onError={function(e) { e.target.style.display = 'none'; }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.accent }}>{contractToken.symbol && contractToken.symbol.charAt(0)}</div>}
                  <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{contractToken.symbol}</div><div style={{ color: C.muted, fontSize: 11 }}>{contractToken.name}</div></div>
                  <div style={{ marginLeft: 'auto', color: C.accent, fontSize: 11, fontWeight: 600 }}>Select</div>
                </div>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!q && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>POPULAR TOKENS</div>}
              {q && searchResults.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No tokens found.<br /><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>Paste the contract address above.</span></div>}
              {displayTokens.map(function(t, i) {
                var key = (t.mint || t.address || '') + '-' + (t.chainId || 'sol') + '-' + i;
                return (
                  <div key={key} onClick={function() { onSelect(t); close(); }} style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }} onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,229,255,.05)'; }} onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}>
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
      )}
    </div>
  );
}

export default function SwapWidget({ coins, jupiterTokens, jupiterLoading, onGoToToken, onConnectWallet, isConnected, isSolanaConnected, walletAddress }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [fromToken, setFromToken] = useState(POPULAR_TOKENS[0]);
  const [toToken, setToToken] = useState(POPULAR_TOKENS[1]);
  const [fromAmt, setFromAmt] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [slip, setSlip] = useState(0.5);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx, setSwapTx] = useState(null);
  const [swapError, setSwapError] = useState('');
  const [fromBalance, setFromBalance] = useState(null);
  const [toBalance, setToBalance] = useState(null);
  const [lifiRoute, setLifiRoute] = useState(null);
  const [customAddress, setCustomAddress] = useState('');

  var route = getRoute(fromToken, toToken);
  var totalFee = route === 'lifi' ? PLATFORM_FEE + SAFETY_FEE + 0.04 : TOTAL_FEE;

  var fetchQuote = useCallback(async function() {
    setQuote(null); setQuoteError('');
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) return;
    if (!route) { setQuoteError('Cross-chain swaps not supported. Use same-chain tokens.'); return; }
    var fromId = fromToken.mint || fromToken.address;
    var toId = toToken.mint || toToken.address;
    if (fromId && toId && fromId.toLowerCase() === toId.toLowerCase() && (fromToken.chainId === toToken.chainId || (isSol(fromToken) && isSol(toToken)))) {
      setQuoteError('Cannot swap a token for itself.');
      setQuoteLoading(false);
      return;
    }
    setQuoteLoading(true);
    try {
      if (route === 'jupiter') {
        var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
        var url = 'https://api.jup.ag/swap/v1/quote?inputMint=' + fromToken.mint + '&outputMint=' + toToken.mint + '&amount=' + amount + '&slippageBps=' + Math.round(slip * 100);
        var res = await fetch(url, { headers: { 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' } });
        var data = await res.json();
        if (data && data.outAmount) {
          setQuote({ outAmount: data.outAmount, outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: data.priceImpactPct, quoteResponse: data, engine: 'jupiter' });
        } else { setQuoteError(data.error || 'No route found for this pair'); }

      } else if (route === '0x') {
        var sellAmt = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var oxParams = new URLSearchParams({ chainId: fromToken.chainId.toString(), sellToken: fromToken.address, buyToken: toToken.address, sellAmount: sellAmt, slippageBps: Math.round(slip * 100).toString(), tradeSurplusRecipient: EVM_FEE_WALLET });
        console.log('0x params:', oxParams.toString());
        var oxRes = await fetch('/api/0x/swap/allowance-holder/price?' + oxParams.toString());
        var oxData = await oxRes.json();
        if (oxData && oxData.buyAmount) {
          setQuote({ outAmountDisplay: (parseInt(oxData.buyAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: 0, engine: '0x' });
        } else { setQuoteError('0x price error: ' + JSON.stringify(oxData)); }

      } else if (route === 'lifi') {
        var fromAddr = isSol(fromToken) ? (publicKey ? publicKey.toString() : '') : (evmAddress || '');
        var fromChainId = isSol(fromToken) ? 'SOL' : fromToken.chainId.toString();
        var toChainId = isSol(toToken) ? 'SOL' : toToken.chainId.toString();
        var fromTokenAddr = isSol(fromToken) ? fromToken.mint : fromToken.address;
        var toTokenAddr = isSol(toToken) ? toToken.mint : toToken.address;
        var fromAmtRaw = (parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toFixed(0);
        var toAddr = isSol(toToken) ? (publicKey ? publicKey.toString() : customAddress) : (evmAddress || customAddress);
        var lifiQParams = new URLSearchParams({
          fromChain: fromChainId, toChain: toChainId,
          fromToken: fromTokenAddr, toToken: toTokenAddr,
          fromAmount: fromAmtRaw, slippage: (slip / 100).toString(),
          fee: '0.09', integrator: 'nexus-dex',
        });
        lifiQParams.set('fromAddress', (fromAddr && fromAddr.length > 10) ? fromAddr : (isSol(fromToken) ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000001'));
        lifiQParams.set('toAddress', (toAddr && toAddr.length > 10) ? toAddr : (isSol(toToken) ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000001'));
        var lifiRes = await fetch('https://li.quest/v1/quote?' + lifiQParams.toString());
        var lifiQuote = await lifiRes.json();
        if (!lifiRes.ok) throw new Error('LI.FI error: ' + JSON.stringify(lifiQuote));
        var toAmt = lifiQuote && lifiQuote.estimate && lifiQuote.estimate.toAmount;
        if (toAmt) {
          setQuote({ outAmountDisplay: (parseInt(toAmt) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: 0, engine: 'lifi' });
          setLifiRoute(lifiQuote);
        } else { setQuoteError('LI.FI: no toAmount in response - ' + JSON.stringify(lifiQuote)); }
      }
    } catch (e) { setQuoteError('Failed to get quote: ' + (e.message || '')); }
    setQuoteLoading(false);
  }, [fromAmt, fromToken, toToken, slip, route, evmAddress, publicKey, customAddress]);

  useEffect(function() { var t = setTimeout(fetchQuote, 300); return function() { clearTimeout(t); }; }, [fetchQuote]);

  useEffect(function() {
    if (!publicKey || !connection || !isSol(fromToken)) { setFromBalance(null); setToBalance(null); return; }
    var fetchBals = async function() {
      try {
        if (fromToken.mint === 'So11111111111111111111111111111111111111112') {
          var solLam = await connection.getBalance(publicKey);
          setFromBalance(solLam / 1e9);
        } else if (fromToken.mint) {
          var accts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) });
          setFromBalance(accts.value.length > 0 ? accts.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
        }
        if (isSol(toToken)) {
          if (toToken.mint === 'So11111111111111111111111111111111111111112') {
            var solLam2 = await connection.getBalance(publicKey);
            setToBalance(solLam2 / 1e9);
          } else if (toToken.mint) {
            var accts2 = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(toToken.mint) });
            setToBalance(accts2.value.length > 0 ? accts2.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
          }
        }
      } catch (e) {}
    };
    fetchBals();
  }, [publicKey, connection, fromToken, toToken]);

  var executeSwap = async function() {
    if (!isConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!quote) return;
    if (!route) { setSwapError('Cross-chain swaps not supported.'); return; }
    setSwapStatus('loading'); setSwapError('');
    try {
      if (route === 'jupiter') {
        if (!publicKey) throw new Error('Connect Solana wallet');
        var _solBal = (await connection.getBalance(publicKey)) / 1e9;
        if (_solBal < 0.005) throw new Error('Need at least 0.005 SOL for fees and gas.');

        var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
        var solCoin = coins.find(function(c) { return c.id === 'solana' || (c.symbol && c.symbol.toLowerCase() === 'sol'); });
        var solPrice = solCoin ? solCoin.current_price : 150;
        var fromPriceUsd = fromCoin ? fromCoin.current_price : (fromToken.symbol === 'SOL' ? solPrice : 0);
        if (!fromPriceUsd && quote) {
          var toCoin = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
          var toPriceUsd = toCoin ? toCoin.current_price : ((toToken.symbol === 'USDC' || toToken.symbol === 'USDT') ? 1 : 0);
          if (toPriceUsd > 0) fromPriceUsd = (parseFloat(quote.outAmountDisplay) * toPriceUsd) / parseFloat(fromAmt);
        }
        var tradeUsd = parseFloat(fromAmt) * fromPriceUsd;

        var dynamicSpread = 0;
        try {
          var mktRes = await fetch('https://api.jup.ag/price/v2?ids=' + fromToken.mint + ',' + toToken.mint);
          var mktData = await mktRes.json();
          var fromMktPrice = mktData.data && mktData.data[fromToken.mint] && parseFloat(mktData.data[fromToken.mint].price);
          var toMktPrice = mktData.data && mktData.data[toToken.mint] && parseFloat(mktData.data[toToken.mint].price);
          if (fromMktPrice && toMktPrice && parseFloat(fromAmt) > 0) {
            var expectedOut = (parseFloat(fromAmt) * fromMktPrice) / toMktPrice;
            var actualOut = parseFloat(quote.outAmountDisplay);
            if (expectedOut > actualOut && expectedOut > 0) {
              dynamicSpread = (expectedOut - actualOut) / expectedOut;
            }
          }
        } catch (e) {}

        var totalFeePct = TOTAL_FEE + dynamicSpread;
        var feeLamports = Math.round(Math.max(
          tradeUsd > 0 ? (tradeUsd * totalFeePct / solPrice) * LAMPORTS_PER_SOL : parseFloat(fromAmt) * totalFeePct * LAMPORTS_PER_SOL,
          50000
        ));

        var swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' },
          body: JSON.stringify({ quoteResponse: quote.quoteResponse, userPublicKey: publicKey.toString(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
        });
        var swapData = await swapRes.json();
        if (!swapData || !swapData.swapTransaction) throw new Error(swapData.error || 'Failed to get swap transaction');

        var jupTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
        var altAccounts = [];
        if (jupTx.message.addressTableLookups && jupTx.message.addressTableLookups.length) {
          var altResults = await Promise.all(jupTx.message.addressTableLookups.map(function(l) { return connection.getAddressLookupTable(l.accountKey); }));
          altAccounts = altResults.map(function(r) { return r.value; }).filter(Boolean);
        }
        var decompiledMsg = TransactionMessage.decompile(jupTx.message, { addressLookupTableAccounts: altAccounts });
        decompiledMsg.instructions.push(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(SOL_FEE_WALLET), lamports: feeLamports }));
        var bh = await connection.getLatestBlockhash('confirmed');
        decompiledMsg.recentBlockhash = bh.blockhash;
        var finalTx = new VersionedTransaction(decompiledMsg.compileToV0Message(altAccounts));
        var accountKeys = finalTx.message.staticAccountKeys || [];
        if (!accountKeys.some(function(k) { return k.toString() === SOL_FEE_WALLET; })) throw new Error('Fee instruction missing from transaction');
        var sig = await sendTransaction(finalTx, connection, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
        setSwapTx(sig);

      } else if (route === '0x') {
        if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
        var sellAmt2 = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var oxExecParams = new URLSearchParams({ chainId: fromToken.chainId.toString(), sellToken: fromToken.address, buyToken: toToken.address, sellAmount: sellAmt2, taker: evmAddress, swapFeeBps: '500', swapFeeRecipient: EVM_FEE_WALLET, swapFeeToken: toToken.address === NATIVE ? fromToken.address : toToken.address, slippageBps: Math.round(slip * 100).toString(), tradeSurplusRecipient: EVM_FEE_WALLET });
        var oxQuoteRes = await fetch('/api/0x/swap/allowance-holder/quote?' + oxExecParams.toString());
        var oxQuote = await oxQuoteRes.json();
        if (!oxQuote || !oxQuote.transaction) throw new Error('0x: ' + JSON.stringify(oxQuote));
        if (oxQuote.issues && oxQuote.issues.allowance && oxQuote.issues.allowance.spender) {
          var spender = oxQuote.issues.allowance.spender;
          var approvalData = '0x095ea7b3' + spender.slice(2).padStart(64, '0') + 'f'.repeat(64);
          await walletClient.sendTransaction({ to: fromToken.address, data: approvalData, value: BigInt(0) });
          await new Promise(function(r) { setTimeout(r, 3000); });
        }
        var tx = oxQuote.transaction;
        var txHash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : BigInt(0), gas: tx.gas ? BigInt(tx.gas) : undefined });
        setSwapTx(txHash);

      } else if (route === 'lifi') {
        if (!lifiRoute) throw new Error('No cross-chain route available');
        var destAddr = isSol(toToken) ? (publicKey ? publicKey.toString() : customAddress) : (evmAddress || customAddress);
        if (!destAddr || destAddr.length < 10) throw new Error('Please enter your ' + (isSol(toToken) ? 'Solana' : CHAIN_NAMES[toToken && toToken.chainId] || 'EVM') + ' destination wallet address');
        var lifiStep = lifiRoute.transactionRequest;
        if (!lifiStep) throw new Error('No transaction data in route');
        if (isSol(fromToken)) {
          if (!publicKey) throw new Error('Connect Solana wallet');
          var lifiTx = VersionedTransaction.deserialize(Buffer.from(lifiStep.data.replace('0x', ''), 'hex'));
          var lifiSig = await sendTransaction(lifiTx, connection, { skipPreflight: false, maxRetries: 3 });
          setSwapTx(lifiSig);
        } else {
          if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
          var lifiTxHash = await walletClient.sendTransaction({ to: lifiStep.to, data: lifiStep.data, value: lifiStep.value ? BigInt(lifiStep.value) : BigInt(0), gasLimit: lifiStep.gasLimit ? BigInt(lifiStep.gasLimit) : undefined });
          setSwapTx(lifiTxHash);
        }
      }

      setSwapStatus('success'); setFromAmt(''); setQuote(null); setLifiRoute(null);
      setTimeout(function() { setSwapStatus('idle'); setSwapTx(null); }, 5000);
    } catch (e) {
      console.error('Swap error:', e); setSwapError(e.message || 'Swap failed'); setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
    }
  };

  var flipTokens = function() { var tmp = fromToken; setFromToken(toToken); setToToken(tmp); setFromAmt(''); setQuote(null); setLifiRoute(null); };

  var fromCoin = coins.find(function(c) { return c.symbol && fromToken && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  var fromPriceVal = fromCoin ? fromCoin.current_price : 0;
  var toCoin = coins.find(function(c) { return c.symbol && toToken && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  var toPriceVal = toCoin ? toCoin.current_price : 0;
  var solCoinPrice = (coins.find(function(c) { return c.id === 'solana'; }) || {}).current_price || 150;
  if (!fromPriceVal && quote && fromAmt && parseFloat(fromAmt) > 0) {
    if (toToken && (toToken.symbol === 'SOL' || toToken.symbol === 'USDC' || toToken.symbol === 'USDT')) {
      var outVal = parseFloat(quote.outAmountDisplay) * (toPriceVal || (toToken.symbol === 'SOL' ? solCoinPrice : 1));
      fromPriceVal = outVal / parseFloat(fromAmt);
    }
  }
  var feeUsd = fromAmt && fromPriceVal ? (parseFloat(fromAmt) * fromPriceVal * TOTAL_FEE).toFixed(2) : '0.00';
  var engineLabel = route === 'jupiter' ? 'Jupiter' : route === '0x' ? '0x' : route === 'lifi' ? 'LI.FI' : 'Nexus';
  var txLink = swapTx ? (route === 'jupiter' ? 'https://solscan.io/tx/' + swapTx : route === 'lifi' ? 'https://scan.li.fi/tx/' + swapTx : 'https://etherscan.io/tx/' + swapTx) : null;

  return (
    <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Swap Tokens</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Powered by {engineLabel} - Instant swaps - No account needed</p>
      </div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 18, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>SLIPPAGE</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0.1, 0.5, 1.0].map(function(v) {
              return <button key={v} onClick={function() { setSlip(v); }} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: slip === v ? 'rgba(0,229,255,.15)' : 'transparent', border: '1px solid ' + (slip === v ? 'rgba(0,229,255,.4)' : C.border), color: slip === v ? C.accent : C.muted }}>{v}%</button>;
            })}
          </div>
        </div>

        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU PAY</span>
            {fromBalance != null && isSol(fromToken) && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{fromBalance >= 1000 ? fromBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : fromBalance.toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={fromToken} onSelect={function(t) { setFromToken(t); setQuote(null); setQuoteError(''); setLifiRoute(null); }} />
            <input value={fromAmt} onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none', minWidth: 0 }} />
            {fromBalance != null && fromBalance > 0 && isSol(fromToken) && (
              <button onClick={function() {
                var maxAmt = fromToken.symbol === 'SOL' ? Math.max(0, fromBalance - TOTAL_FEE - 0.002) : fromBalance;
                setFromAmt(maxAmt > 0 ? maxAmt.toFixed(fromToken.decimals <= 2 ? 2 : 6) : '0');
              }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '3px 8px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>
            )}
          </div>
          {fromAmt && fromPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(fromAmt) * fromPriceVal)}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flipTokens} style={{ width: 36, height: 36, borderRadius: 10, background: C.card3, border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>^v</button>
        </div>

        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
            {toBalance != null && isSol(toToken) && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{toBalance >= 1000 ? toBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : toBalance.toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={toToken} onSelect={function(t) { setToToken(t); setQuote(null); setQuoteError(''); setLifiRoute(null); }} />
            <div style={{ flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>{quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}</div>
          </div>
          {quote && toPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>}
        </div>

        {quoteError && <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red }}>{quoteError}</div>}

        {quote && fromAmt && (
          <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Platform Fee (3%)', fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * PLATFORM_FEE).toFixed(2) : '3% of swap'],
                ['Safety & Anti-MEV (2%)', fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * SAFETY_FEE).toFixed(2) : '2% of swap'],
                route === 'lifi' ? ['Cross-Chain Fee (4%)', fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * 0.04).toFixed(2) : '4% of swap'] : null,
                ['Total Fee (' + (route === 'lifi' ? '9%' : '5%') + ')', fromPriceVal > 0 ? '$' + feeUsd : (route === 'lifi' ? '9%' : '5%') + ' of swap'],
                route === 'jupiter' ? ['Price Impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'] : null,
                route === 'jupiter' ? ['Min Received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken ? toToken.symbol : '')] : null,
              ].filter(Boolean).map(function(item) {
                return <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}><span style={{ color: C.muted }}>{item[0]}</span><span style={{ color: item[0].includes('Total') ? C.accent : C.text }}>{item[1]}</span></div>;
              })}
            </div>
          </div>
        )}

        {route === 'lifi' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>DESTINATION WALLET</div>
            <input value={customAddress} onChange={function(e) { setCustomAddress(e.target.value); }} placeholder={isSol(toToken) ? 'Your Solana wallet address...' : 'Your ' + (CHAIN_NAMES[toToken && toToken.chainId] || 'EVM') + ' wallet address (0x...)...'} style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 10, padding: '10px 12px', color: C.accent, fontFamily: 'monospace', fontSize: 11, outline: 'none' }} />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Enter the wallet where you want to receive your tokens</div>
          </div>
        )}
        {swapError && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red }}>{swapError}</div>}

        {isConnected ? (
          <button onClick={executeSwap} disabled={swapStatus === 'loading'} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : swapStatus === 'error' ? 'rgba(255,59,107,.2)' : !fromAmt || !quote ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer', transition: 'all .3s', minHeight: 52 }}>
            {swapStatus === 'loading' ? 'Confirming...' : swapStatus === 'success' ? 'Swap Confirmed!' : swapStatus === 'error' ? 'Failed - Try Again' : !fromAmt ? 'Enter Amount' : quoteLoading ? 'Getting Best Route...' : !quote ? 'No Route Found' : 'Swap ' + (fromToken ? fromToken.symbol : '') + ' > ' + (toToken ? toToken.symbol : '')}
          </button>
        ) : (
          <button onClick={onConnectWallet} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52 }}>Connect Wallet to Swap</button>
        )}

        {swapTx && swapStatus === 'success' && txLink && <a href={txLink} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent }}>View Transaction</a>}
        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 10 }}>Non-custodial - No KYC - Fees paid by user</p>
      </div>
    </div>
  );
}
