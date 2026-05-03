import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useBalance, useSwitchChain } from 'wagmi';
import { VersionedTransaction, TransactionMessage, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
 
const SOL_FEE_WALLET  = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
const EVM_FEE_WALLET  = '0xC41c1de4250104dC1EE2854ffD5b40a04B9AC9fF';
const PLATFORM_FEE    = 0.03;
const SAFETY_FEE      = 0.02;
const CROSS_FEE       = 0.03;
const TOTAL_FEE       = PLATFORM_FEE + SAFETY_FEE;
const TOTAL_FEE_CC    = PLATFORM_FEE + SAFETY_FEE + CROSS_FEE;
const LIFI_FEE        = TOTAL_FEE_CC;
const LIFI_INTEGRATOR = 'nexus-dex';
var NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
var WSOL_MINT  = 'So11111111111111111111111111111111111111112';

var OX_CHAIN_IDS = new Set([
  1, 2741, 42161, 43114, 8453, 80094, 81457, 56,
  999, 57073, 59144, 5000, 34443, 143, 10, 9745,
  137, 534352, 146, 4217, 130, 480,
]);

var CHAIN_NAMES = {
  1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB Chain',
  43114: 'Avalanche', 10: 'Optimism', 100: 'Gnosis', 324: 'zkSync Era', 59144: 'Linea',
  534352: 'Scroll', 5000: 'Mantle', 81457: 'Blast', 34443: 'Mode', 130: 'Unichain',
  146: 'Sonic', 80094: 'Berachain', 57073: 'Ink', 143: 'Monad', 480: 'World Chain',
  250: 'Fantom', 25: 'Cronos', 1284: 'Moonbeam', 42220: 'Celo', 1329: 'SEI',
  7777777: 'Zora', 2020: 'Ronin', 1135: 'Lisk', 252: 'Fraxtal', 255: 'Kroma',
};

function isSol(t) { return t && t.chain === 'solana'; }
function isEvm(t) { return t && t.chain === 'evm'; }

function isValidSolMint(str) {
  return str && str.length >= 32 && str.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
}
function isValidEvmAddr(str) {
  return str && /^0x[0-9a-fA-F]{40}$/.test(str);
}

function getRoute(from, to) {
  if (!from || !to) return 'jupiter';
  if (isSol(from) && isSol(to)) return 'jupiter';
  if (isEvm(from) && isEvm(to) && from.chainId === to.chainId && OX_CHAIN_IDS.has(from.chainId)) return '0x';
  return 'lifi';
}

function lifiChain(t) { return isSol(t) ? 'SOL' : String(t.chainId); }
function lifiToken(t) { return isSol(t) ? t.mint : t.address; }

async function fetchLifiQuote({ fromToken, toToken, fromAmtRaw, fromAddress, toAddress, slip }) {
  var params = new URLSearchParams({
    fromChain:   lifiChain(fromToken),
    toChain:     lifiChain(toToken),
    fromToken:   lifiToken(fromToken),
    toToken:     lifiToken(toToken),
    fromAmount:  fromAmtRaw,
    fromAddress: fromAddress,
    toAddress:   toAddress || fromAddress,
    slippage:    String(slip / 100),
    fee:         String(LIFI_FEE),
    integrator:  LIFI_INTEGRATOR,
  });
  var res = await fetch('https://li.quest/v1/quote?' + params.toString());
  var data = await res.json();
  if (!res.ok) throw new Error(data.message || JSON.stringify(data));
  if (!data.estimate || !data.estimate.toAmount) throw new Error('LiFi: no route found for this pair');
  return data;
}

var _lifiTokenCache = null;
var _lifiTokenFetch = null;
function getLifiTokens() {
  if (_lifiTokenCache) return Promise.resolve(_lifiTokenCache);
  if (_lifiTokenFetch) return _lifiTokenFetch;
  _lifiTokenFetch = fetch('https://li.quest/v1/tokens?chainTypes=EVM')
    .then(function(r) { return r.json(); })
    .then(function(d) { _lifiTokenCache = d; return d; })
    .catch(function() { return null; });
  return _lifiTokenFetch;
}

const POPULAR_TOKENS = [
  { mint: WSOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, chain: 'solana', logoURI: 'https://static.jup.ag/jup/icon.png' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5, chain: 'solana', logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', symbol: 'mSOL', name: 'Marinade SOL', decimals: 9, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth', decimals: 6, chain: 'solana', logoURI: 'https://pyth.network/token.svg' },
  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', symbol: 'ORCA', name: 'Orca', decimals: 6, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
  { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', symbol: 'WETH', name: 'Wrapped Ether', decimals: 8, chain: 'solana', logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
  { address: NATIVE_EVM, chainId: 1,     symbol: 'ETH',  name: 'Ethereum',        decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 8453,  symbol: 'ETH',  name: 'ETH (Base)',      decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 42161, symbol: 'ETH',  name: 'ETH (Arbitrum)', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 10,    symbol: 'ETH',  name: 'ETH (Optimism)', decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { address: NATIVE_EVM, chainId: 56,    symbol: 'BNB',  name: 'BNB Chain',      decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
  { address: NATIVE_EVM, chainId: 137,   symbol: 'POL',  name: 'Polygon',        decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
  { address: NATIVE_EVM, chainId: 43114, symbol: 'AVAX', name: 'Avalanche',      decimals: 18, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png' },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1,     symbol: 'USDC', name: 'USDC (ETH)',      decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453,  symbol: 'USDC', name: 'USDC (Base)',     decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, symbol: 'USDC', name: 'USDC (Arbitrum)', decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chainId: 1,     symbol: 'USDT', name: 'Tether (ETH)',    decimals: 6, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chainId: 1,     symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chain: 'evm', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png' },
];

function getNativeToken(token) {
  if (!token) return POPULAR_TOKENS[0];
  if (isSol(token)) return POPULAR_TOKENS[0];
  var native = POPULAR_TOKENS.find(function(t) {
    return t.chain === 'evm' && t.chainId === token.chainId && t.address === NATIVE_EVM;
  });
  return native || POPULAR_TOKENS.find(function(t) { return t.address === NATIVE_EVM && t.chainId === 1; });
}

function normalizeToToken(coin) {
  if (!coin) return POPULAR_TOKENS[0];
  var logoURI = coin.logoURI || coin.image || null;

  if (coin.chain === 'evm' || isValidEvmAddr(coin.address)) {
    return {
      address: coin.address, chainId: coin.chainId || 1,
      symbol: coin.symbol || 'TOKEN', name: coin.name || 'Token',
      decimals: coin.decimals || 18, chain: 'evm', logoURI,
    };
  }

  var mintCandidate =
    coin.mint ||
    (coin.isSolanaToken ? coin.id : null) ||
    (coin.chain === 'solana' ? coin.id : null) ||
    (isValidSolMint(coin.id) ? coin.id : null) ||
    '';

  if (isValidSolMint(mintCandidate)) {
    return {
      mint: mintCandidate, symbol: coin.symbol || 'TOKEN',
      name: coin.name || 'Token', decimals: coin.decimals || 6,
      chain: 'solana', logoURI,
    };
  }

  if (coin.symbol) {
    var bySymbol = POPULAR_TOKENS.find(function(t) {
      return t.symbol && t.symbol.toLowerCase() === coin.symbol.toLowerCase();
    });
    if (bySymbol) return bySymbol;
  }

  return POPULAR_TOKENS[0];
}

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

function fmt(n, d) {
  d = d || 2;
  if (n == null) return '-';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function ChainBadge({ token }) {
  if (!token) return null;
  var label = isSol(token) ? 'SOL' : (CHAIN_NAMES[token.chainId] || 'EVM');
  var color = isSol(token) ? '#9945ff' : '#627eea';
  return <span style={{ fontSize: 9, color, background: color + '22', border: '1px solid ' + color + '44', borderRadius: 4, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>{label}</span>;
}

function TokenSelect({ selected, onSelect, jupiterTokens }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [contractAddr, setContractAddr] = useState('');
  const [contractToken, setContractToken] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  var solTokens = useMemo(function() {
    return jupiterTokens && jupiterTokens.length > 0
      ? jupiterTokens.map(function(t) { return Object.assign({}, t, { chain: 'solana' }); })
      : POPULAR_TOKENS.filter(function(t) { return t.chain === 'solana'; });
  }, [jupiterTokens]);

  var isValidSol = function(s) { return s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s); };
  var isValidEvm = function(s) { return s && /^0x[0-9a-fA-F]{40}$/.test(s); };

  var lookupByAddress = async function(addr) {
    if (!isValidSol(addr) && !isValidEvm(addr)) return;
    setContractLoading(true);
    try {
      if (isValidSol(addr)) {
        var found = solTokens.find(function(t) { return t.mint === addr; });
        if (found) { setContractToken(found); }
        else {
          var res = await fetch('https://lite-api.jup.ag/tokens/v1/token/' + addr);
          if (res.ok) {
            var d = await res.json();
            setContractToken({ mint: d.address, symbol: d.symbol, name: d.name, decimals: d.decimals, logoURI: d.logoURI, chain: 'solana' });
          } else {
            setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
          }
        }
      } else {
        setContractToken({ address: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom EVM Token', decimals: 18, chain: 'evm', chainId: 1 });
      }
    } catch(e) {
      setContractToken({ mint: addr, symbol: addr.slice(0, 6) + '...', name: 'Custom Token', decimals: 6, chain: 'solana' });
    }
    setContractLoading(false);
  };

  useEffect(function() {
    if (!q || q.length < 1) { setSearchResults([]); return; }
    var ql = q.toLowerCase();
    var sm = solTokens.filter(function(t) {
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql)) || (t.mint && t.mint.toLowerCase().includes(ql));
    }).slice(0, 50);
    var em = POPULAR_TOKENS.filter(function(t) {
      if (t.chain !== 'evm') return false;
      return (t.symbol && t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql)) || ((CHAIN_NAMES[t.chainId] || '').toLowerCase().includes(ql));
    }).slice(0, 20);
    setSearchResults(sm.concat(em));
    if (q.length >= 2) {
      getLifiTokens().then(function(lifiData) {
        if (!lifiData || !lifiData.tokens) return;
        var extra = [];
        var seen = new Set(em.map(function(t) { return (t.address || '').toLowerCase() + '-' + t.chainId; }));
        Object.values(lifiData.tokens).forEach(function(chainTokens) {
          chainTokens.forEach(function(t) {
            if (!t.symbol || !t.address || !t.chainId) return;
            var key = t.address.toLowerCase() + '-' + t.chainId;
            if (seen.has(key)) return;
            if ((t.symbol.toLowerCase().includes(ql)) || (t.name && t.name.toLowerCase().includes(ql))) {
              seen.add(key);
              extra.push({ address: t.address, chainId: t.chainId, symbol: t.symbol, name: t.name, decimals: t.decimals || 18, chain: 'evm', logoURI: t.logoURI });
            }
          });
        });
        setSearchResults(sm.concat(em).concat(extra.slice(0, 80)));
      });
    }
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
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.75)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
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

export function TradeDrawer({ open, onClose, mode, coin, jupiterTokens, coins, onConnectWallet, isConnected }) {
  const coinToken   = useMemo(function() { return normalizeToToken(coin); }, [coin]);
  const nativeToken = useMemo(function() { return getNativeToken(coinToken); }, [coinToken]);

  const defaultFromToken = mode === 'buy' ? nativeToken : coinToken;
  const defaultToToken   = mode === 'buy' ? coinToken   : nativeToken;

  const swapKey = useMemo(function() {
    var id = coin ? (coin.mint || coin.address || coin.id || 'token') : 'default';
    return id + '-' + mode;
  }, [coin, mode]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.8)' }} />
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
              {coin && coin.image && <img src={coin.image} alt={coin.symbol} style={{ width: 28, height: 28, borderRadius: '50%' }} />}
              <div style={{ color: mode === 'buy' ? C.accent : C.red, fontWeight: 800, fontSize: 17 }}>
                {mode === 'buy' ? 'Buy' : 'Sell'} {coin && coin.symbol && coin.symbol.toUpperCase()}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer', padding: 0 }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          <SwapWidget
            key={swapKey}
            coins={coins}
            jupiterTokens={jupiterTokens}
            onConnectWallet={onConnectWallet}
            isConnected={isConnected}
            defaultFromToken={defaultFromToken}
            defaultToToken={defaultToToken}
            compact={true}
          />
        </div>
      </div>
    </>
  );
}

export default function SwapWidget({ coins, jupiterTokens, jupiterLoading, onGoToToken, onConnectWallet, isConnected, isSolanaConnected, walletAddress, defaultFromToken, defaultToToken, compact }) {
  const { publicKey, sendTransaction, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected, chainId: evmChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();

  const walletConnected = solConnected || evmConnected;

  const [fromToken, setFromToken] = useState(defaultFromToken || POPULAR_TOKENS[0]);
  const [toToken,   setToToken]   = useState(defaultToToken   || POPULAR_TOKENS[1]);
  const [fromAmt,   setFromAmt]   = useState('');
  const [quote,     setQuote]     = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError,   setQuoteError]   = useState('');
  const [slip,      setSlip]      = useState(0.5);
  const [swapStatus, setSwapStatus] = useState('idle');
  const [swapTx,    setSwapTx]    = useState(null);
  const [swapError, setSwapError] = useState('');
  const [fromBalance, setFromBalance] = useState(null);
  const [toBalance,   setToBalance]   = useState(null);
  const [customAddress, setCustomAddress] = useState('');

  // Multi-chain balance detection.
  // When EVM wallet connects, query native balance on all supported chains in parallel.
  // Auto-select the chain with the highest balance as fromToken so user never has
  // to manually switch chains.
  useEffect(function() {
    if (!evmAddress || !evmConnected) return;
    var aborted = false;

    var CHAIN_RPCS = [
      { id: 1,      rpc: 'https://eth.llamarpc.com' },
      { id: 8453,   rpc: 'https://mainnet.base.org' },
      { id: 42161,  rpc: 'https://arb1.arbitrum.io/rpc' },
      { id: 137,    rpc: 'https://polygon-rpc.com' },
      { id: 56,     rpc: 'https://bsc-dataseed.binance.org' },
      { id: 43114,  rpc: 'https://api.avax.network/ext/bc/C/rpc' },
      { id: 10,     rpc: 'https://mainnet.optimism.io' },
      { id: 59144,  rpc: 'https://rpc.linea.build' },
      { id: 534352, rpc: 'https://rpc.scroll.io' },
      { id: 5000,   rpc: 'https://rpc.mantle.xyz' },
      { id: 81457,  rpc: 'https://rpc.blast.io' },
      { id: 146,    rpc: 'https://rpc.soniclabs.com' },
      { id: 130,    rpc: 'https://mainnet.unichain.org' },
      { id: 480,    rpc: 'https://worldchain-mainnet.g.alchemy.com/public' },
    ];

    Promise.all(CHAIN_RPCS.map(function(chain) {
      return fetch(chain.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [evmAddress, 'latest'], id: 1 }),
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var raw = data.result ? parseInt(data.result, 16) : 0;
          return { chainId: chain.id, balance: raw / 1e18 };
        })
        .catch(function() { return { chainId: chain.id, balance: 0 }; });
    })).then(function(results) {
      if (aborted) return;
      var best = results.reduce(function(a, b) { return b.balance > a.balance ? b : a; }, results[0]);
      if (!best || best.balance <= 0) return;
      if (!isEvm(fromToken)) {
        var nativeToken = POPULAR_TOKENS.find(function(t) {
          return t.chain === 'evm' && t.chainId === best.chainId && t.address === NATIVE_EVM;
        });
        if (nativeToken) { setFromToken(nativeToken); setQuote(null); setFromAmt(''); }
      }
    });

    return function() { aborted = true; };
  }, [evmAddress, evmConnected]);

  var isEvmFrom       = isEvm(fromToken);
  var isNativeEvmFrom = isEvmFrom && fromToken.address === NATIVE_EVM;
  const { data: evmFromBalanceData } = useBalance({
    address: evmAddress,
    token:   isEvmFrom && !isNativeEvmFrom ? fromToken.address : undefined,
    chainId: isEvmFrom ? fromToken.chainId : undefined,
    query:   { enabled: !!evmAddress && isEvmFrom },
  });

  var route        = getRoute(fromToken, toToken);
  var isCrossChain = route === 'lifi';

  var fetchQuote = useCallback(async function() {
    setQuote(null); setQuoteError('');
    if (!fromAmt || parseFloat(fromAmt) <= 0 || !fromToken || !toToken) return;
    var fId = (fromToken.mint || fromToken.address || '').toLowerCase();
    var tId = (toToken.mint   || toToken.address   || '').toLowerCase();
    if (fId === tId && (isSol(fromToken) === isSol(toToken)) && fromToken.chainId === toToken.chainId) {
      setQuoteError('Cannot swap a token for itself.'); return;
    }
    setQuoteLoading(true);
    try {
      if (route === 'jupiter') {
        var amount = Math.round(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals));
        var res = await fetch(
          'https://api.jup.ag/swap/v1/quote?inputMint=' + fromToken.mint +
          '&outputMint=' + toToken.mint + '&amount=' + amount +
          '&slippageBps=' + Math.round(slip * 100),
          { headers: { 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' } }
        );
        var data = await res.json();
        if (data && data.outAmount) {
          setQuote({ outAmountDisplay: (parseInt(data.outAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: data.priceImpactPct, quoteResponse: data, engine: 'jupiter' });
        } else { setQuoteError(data.error || 'No route found'); }
      } else if (route === '0x') {
        var sellAmt = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var oxRes = await fetch('/api/0x/swap/allowance-holder/price?' + new URLSearchParams({
          chainId: fromToken.chainId.toString(), sellToken: fromToken.address.toLowerCase(),
          buyToken: toToken.address.toLowerCase(), sellAmount: sellAmt,
          slippageBps: Math.round(slip * 100).toString(),
        }).toString());
        var oxData = await oxRes.json();
        if (oxData && oxData.buyAmount) {
          setQuote({ outAmountDisplay: (parseInt(oxData.buyAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: 0, engine: '0x' });
        } else { setQuoteError('0x: ' + JSON.stringify(oxData)); }
      } else if (route === 'lifi') {
        var fromAmtRaw = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var previewFrom = isSol(fromToken) ? (publicKey ? publicKey.toString() : '11111111111111111111111111111111') : (evmAddress || '0x0000000000000000000000000000000000000001');
        var previewTo   = isSol(toToken)   ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000001';
        var lifiQ = await fetchLifiQuote({ fromToken, toToken, fromAmtRaw, fromAddress: previewFrom, toAddress: previewTo, slip });
        setQuote({ outAmountDisplay: (parseInt(lifiQ.estimate.toAmount) / Math.pow(10, toToken.decimals)).toFixed(6), priceImpactPct: 0, engine: 'lifi' });
      }
    } catch(e) { setQuoteError('Failed to get quote: ' + (e.message || '')); }
    setQuoteLoading(false);
  }, [fromAmt, fromToken, toToken, slip, route, evmAddress, publicKey]);

  useEffect(function() { var t = setTimeout(fetchQuote, 150); return function() { clearTimeout(t); }; }, [fetchQuote]);

  useEffect(function() {
    if (!publicKey || !connection || !isSol(fromToken)) { setFromBalance(null); setToBalance(null); return; }
    (async function() {
      try {
        if (fromToken.mint === WSOL_MINT) { setFromBalance((await connection.getBalance(publicKey)) / 1e9); }
        else if (fromToken.mint) {
          var a = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(fromToken.mint) });
          setFromBalance(a.value.length > 0 ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
        }
        if (isSol(toToken)) {
          if (toToken.mint === WSOL_MINT) { setToBalance((await connection.getBalance(publicKey)) / 1e9); }
          else if (toToken.mint) {
            var b = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(toToken.mint) });
            setToBalance(b.value.length > 0 ? b.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0);
          }
        }
      } catch(e) {}
    })();
  }, [publicKey, connection, fromToken, toToken]);

  var executeSwap = async function() {
    if (!walletConnected) { if (onConnectWallet) onConnectWallet(); return; }
    if (!quote) return;
    setSwapStatus('loading'); setSwapError('');
    try {
      if (route === 'jupiter') {
        if (!publicKey) throw new Error('Connect Solana wallet');
        var solBal = (await connection.getBalance(publicKey)) / 1e9;
        if (solBal < 0.005) throw new Error('Need at least 0.005 SOL for fees.');
        var solCoin   = coins.find(function(c) { return c.id === 'solana'; });
        var solPrice  = solCoin ? solCoin.current_price : 150;
        var fromCoinJ = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
        var fromPriceJ = fromCoinJ ? fromCoinJ.current_price : (fromToken.symbol === 'SOL' ? solPrice : 0);
        if (!fromPriceJ && quote) {
          var toCoinJ = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
          var toPriceJ = toCoinJ ? toCoinJ.current_price : (['USDC','USDT'].includes(toToken.symbol) ? 1 : 0);
          if (toPriceJ > 0) fromPriceJ = (parseFloat(quote.outAmountDisplay) * toPriceJ) / parseFloat(fromAmt);
        }
        var tradeUsd = parseFloat(fromAmt) * fromPriceJ;
        var spread = 0;
        try {
          var mkt = await (await fetch('https://api.jup.ag/price/v2?ids=' + fromToken.mint + ',' + toToken.mint)).json();
          var fMkt = mkt.data && mkt.data[fromToken.mint] && parseFloat(mkt.data[fromToken.mint].price);
          var tMkt = mkt.data && mkt.data[toToken.mint]  && parseFloat(mkt.data[toToken.mint].price);
          if (fMkt && tMkt) {
            var expected = (parseFloat(fromAmt) * fMkt) / tMkt;
            var actual   = parseFloat(quote.outAmountDisplay);
            if (expected > actual && expected > 0) spread = (expected - actual) / expected;
          }
        } catch(e) {}
        var totalPct    = TOTAL_FEE + spread;
        var feeLamports = Math.round(Math.max(
          tradeUsd > 0 ? (tradeUsd * totalPct / solPrice) * LAMPORTS_PER_SOL : parseFloat(fromAmt) * totalPct * LAMPORTS_PER_SOL,
          50000
        ));
        var swapRes  = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' },
          body: JSON.stringify({ quoteResponse: quote.quoteResponse, userPublicKey: publicKey.toString(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
        });
        var swapData = await swapRes.json();
        if (!swapData || !swapData.swapTransaction) throw new Error(swapData.error || 'Failed to get swap transaction');
        var jupTx    = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
        var altAccts = [];
        if (jupTx.message.addressTableLookups && jupTx.message.addressTableLookups.length) {
          var altRes = await Promise.all(jupTx.message.addressTableLookups.map(function(l) { return connection.getAddressLookupTable(l.accountKey); }));
          altAccts = altRes.map(function(r) { return r.value; }).filter(Boolean);
        }
        var msg = TransactionMessage.decompile(jupTx.message, { addressLookupTableAccounts: altAccts });
        msg.instructions.push(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(SOL_FEE_WALLET), lamports: feeLamports }));
        var bh    = await connection.getLatestBlockhash('confirmed');
        msg.recentBlockhash = bh.blockhash;
        var final = new VersionedTransaction(msg.compileToV0Message(altAccts));
        var sig = await sendTransaction(final, connection, { skipPreflight: true, maxRetries: 3 });
        setSwapTx(sig);
        connection.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed')
          .catch(function(e) { console.warn('Confirm warning (tx may still be processing):', e); });
      } else if (route === '0x') {
        if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
        if (evmChainId && evmChainId !== fromToken.chainId) {
          await switchChain({ chainId: fromToken.chainId });
          var switchStart = Date.now();
          while (Date.now() - switchStart < 5000) {
            var currentChain = walletClient.chain && walletClient.chain.id;
            if (currentChain === fromToken.chainId) break;
            await new Promise(function(r) { setTimeout(r, 300); });
          }
        }
        var sell0x   = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var isNatTo  = isEvm(toToken) && toToken.address && toToken.address.toLowerCase() === NATIVE_EVM;
        var feeTok0x = isNatTo ? fromToken.address : toToken.address;
        var oxQ      = await (await fetch('/api/0x/swap/allowance-holder/quote?' + new URLSearchParams({
          chainId: fromToken.chainId.toString(), sellToken: fromToken.address.toLowerCase(),
          buyToken: toToken.address.toLowerCase(), sellAmount: sell0x, taker: evmAddress,
          swapFeeBps: '500', swapFeeRecipient: EVM_FEE_WALLET, swapFeeToken: feeTok0x.toLowerCase(),
          slippageBps: Math.round(slip * 100).toString(), tradeSurplusRecipient: EVM_FEE_WALLET,
        }).toString())).json();
        if (!oxQ || !oxQ.transaction) throw new Error('0x: ' + JSON.stringify(oxQ));
        if (oxQ.issues && oxQ.issues.allowance && oxQ.issues.allowance.spender) {
          var approveTxHash = await walletClient.sendTransaction({ to: fromToken.address, data: '0x095ea7b3' + oxQ.issues.allowance.spender.slice(2).padStart(64, '0') + 'f'.repeat(64), value: BigInt(0) });
          var approveStart = Date.now();
          while (Date.now() - approveStart < 30000) {
            try {
              var receipt = await walletClient.waitForTransactionReceipt({ hash: approveTxHash, timeout: 5000 }).catch(function() { return null; });
              if (receipt) break;
            } catch(_) {}
            await new Promise(function(r) { setTimeout(r, 2000); });
          }
        }
        setSwapTx(await walletClient.sendTransaction({ to: oxQ.transaction.to, data: oxQ.transaction.data, value: oxQ.transaction.value ? BigInt(oxQ.transaction.value) : BigInt(0), gas: oxQ.transaction.gas ? BigInt(oxQ.transaction.gas) : undefined }));
      } else if (route === 'lifi') {
        var srcAddr = isSol(fromToken) ? (publicKey ? publicKey.toString() : null) : (evmAddress || null);
        var dstAddr = isSol(toToken) ? (publicKey ? publicKey.toString() : customAddress.trim()) : (evmAddress || customAddress.trim());
        if (!srcAddr) throw new Error('Connect your ' + (isSol(fromToken) ? 'Solana' : 'EVM') + ' wallet');
        if (!dstAddr || dstAddr.length < 10) throw new Error('Enter destination wallet address');
        var lfAmtRaw = Math.floor(parseFloat(fromAmt) * Math.pow(10, fromToken.decimals)).toString();
        var lifiQ = await fetchLifiQuote({ fromToken, toToken, fromAmtRaw: lfAmtRaw, fromAddress: srcAddr, toAddress: dstAddr, slip });
        if (!lifiQ.transactionRequest) throw new Error('LiFi: no transaction returned -- try again');
        var txReq = lifiQ.transactionRequest;
        if (isSol(fromToken)) {
          if (!publicKey) throw new Error('Connect Solana wallet');
          var lifiSolTx = VersionedTransaction.deserialize(Buffer.from(txReq.data, 'base64'));
          var lifiBh    = await connection.getLatestBlockhash('confirmed');
          var lifiSig = await sendTransaction(lifiSolTx, connection, { skipPreflight: true, maxRetries: 3 });
          setSwapTx(lifiSig);
          connection.confirmTransaction({ signature: lifiSig, blockhash: lifiBh.blockhash, lastValidBlockHeight: lifiBh.lastValidBlockHeight }, 'confirmed')
            .catch(function(e) { console.warn('LiFi confirm warning:', e); });
        } else {
          if (!evmAddress || !walletClient) throw new Error('Connect EVM wallet');
          if (evmChainId && evmChainId !== fromToken.chainId) {
            await switchChain({ chainId: fromToken.chainId });
            var lifiSwitchStart = Date.now();
            while (Date.now() - lifiSwitchStart < 5000) {
              var lifiCurrentChain = walletClient.chain && walletClient.chain.id;
              if (lifiCurrentChain === fromToken.chainId) break;
              await new Promise(function(r) { setTimeout(r, 300); });
            }
          }
          var isNatSell = fromToken.address.toLowerCase() === NATIVE_EVM;
          if (!isNatSell) {
            var spender      = txReq.to;
            var sellBig      = BigInt(lfAmtRaw);
            var allowData    = '0xdd62ed3e' + evmAddress.slice(2).padStart(64, '0') + spender.slice(2).padStart(64, '0');
            var needsApprove = true;
            try {
              var allowHex = await walletClient.request({ method: 'eth_call', params: [{ to: fromToken.address, data: allowData }, 'latest'] });
              needsApprove = BigInt(allowHex || '0x0') < sellBig;
            } catch(_) {}
            if (needsApprove) {
              var lifiApproveTxHash = await walletClient.sendTransaction({ to: fromToken.address, data: '0x095ea7b3' + spender.slice(2).padStart(64, '0') + 'f'.repeat(64), value: BigInt(0) });
              var lifiApproveStart = Date.now();
              while (Date.now() - lifiApproveStart < 30000) {
                try {
                  var lifiApproveReceipt = await walletClient.waitForTransactionReceipt({ hash: lifiApproveTxHash, timeout: 5000 }).catch(function() { return null; });
                  if (lifiApproveReceipt) break;
                } catch(_) {}
                await new Promise(function(r) { setTimeout(r, 2000); });
              }
            }
          }
          setSwapTx(await walletClient.sendTransaction({ to: txReq.to, data: txReq.data, value: txReq.value ? BigInt(txReq.value) : BigInt(0), gas: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined }));
        }
      }
      setSwapStatus('success'); setFromAmt(''); setQuote(null);
      setTimeout(function() { setSwapStatus('idle'); setSwapTx(null); }, 6000);
    } catch(e) {
      console.error('Swap error:', e); setSwapError(e.message || 'Swap failed'); setSwapStatus('error');
      setTimeout(function() { setSwapStatus('idle'); setSwapError(''); }, 4000);
    }
  };

  var flipTokens = function() {
    var tmp = fromToken; setFromToken(toToken); setToToken(tmp);
    setFromAmt(''); setQuote(null); setFromBalance(null); setToBalance(null); setCustomAddress('');
  };

  var fromCoin     = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === fromToken.symbol.toLowerCase(); });
  var fromPriceVal = fromCoin ? fromCoin.current_price : 0;
  var toCoin       = coins.find(function(c) { return c.symbol && c.symbol.toLowerCase() === toToken.symbol.toLowerCase(); });
  var toPriceVal   = toCoin ? toCoin.current_price : 0;
  if (!fromPriceVal && quote && fromAmt && parseFloat(fromAmt) > 0 && toPriceVal > 0)
    fromPriceVal = (parseFloat(quote.outAmountDisplay) * toPriceVal) / parseFloat(fromAmt);

  var engineLabel  = route === 'jupiter' ? 'Jupiter' : route === '0x' ? '0x' : 'LiFi';
  var txLink       = swapTx ? (isSol(fromToken) ? 'https://solscan.io/tx/' + swapTx : (isCrossChain ? 'https://scan.li.fi/tx/' + swapTx : 'https://etherscan.io/tx/' + swapTx)) : null;
  var needsDstAddr = isCrossChain && ((isSol(toToken) && !publicKey) || (isEvm(toToken) && !evmAddress));

  return (
    <div style={{ width: '100%', maxWidth: compact ? '100%' : 520, margin: '0 auto', boxSizing: 'border-box', overscrollBehavior: 'none' }}>
      {!compact && (
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Swap Tokens</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Powered by {engineLabel}{isCrossChain ? ' - Cross-chain' : ''} - Instant swaps - No account needed</p>
        </div>
      )}
      <div style={{ background: compact ? 'transparent' : C.card, border: compact ? 'none' : '1px solid ' + C.border, borderRadius: compact ? 0 : 18, padding: compact ? 0 : 18 }}>
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
            {evmFromBalanceData && isEvm(fromToken) && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{parseFloat(evmFromBalanceData.formatted).toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={fromToken} onSelect={function(t) { setFromToken(t); setQuote(null); setQuoteError(''); setCustomAddress(''); }} />
            <input value={fromAmt} onChange={function(e) { setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 500, color: '#fff', textAlign: 'right', outline: 'none', minWidth: 0 }} />
            {fromBalance != null && fromBalance > 0 && isSol(fromToken) && (
              <button onClick={function() { var m = fromToken.symbol === 'SOL' ? Math.max(0, fromBalance - TOTAL_FEE - 0.002) : fromBalance; setFromAmt(m > 0 ? m.toFixed(fromToken.decimals <= 2 ? 2 : 6) : '0'); }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '3px 8px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>
            )}
            {evmFromBalanceData && isEvm(fromToken) && parseFloat(evmFromBalanceData.formatted) > 0 && (
              <button onClick={function() { var b = parseFloat(evmFromBalanceData.formatted); var m = isNativeEvmFrom ? Math.max(0, b - 0.002) : b; setFromAmt(m > 0 ? m.toFixed(fromToken.decimals <= 2 ? 2 : 6) : '0'); }} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '3px 8px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>MAX</button>
            )}
          </div>
          {fromAmt && fromPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(fromAmt) * fromPriceVal)}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flipTokens} style={{ width: 36, height: 36, borderRadius: 10, background: C.card3, border: '1px solid ' + C.border, cursor: 'pointer', color: C.accent, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>^v</button>
        </div>
        <div style={{ background: C.card2, borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>YOU RECEIVE</span>
            {toBalance != null && isSol(toToken) && <span style={{ fontSize: 11, color: C.muted }}>Balance: <span style={{ color: C.text }}>{toBalance >= 1000 ? toBalance.toLocaleString('en-US', { maximumFractionDigits: 2 }) : toBalance.toFixed(4)}</span></span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenSelect jupiterTokens={jupiterTokens} selected={toToken} onSelect={function(t) { setToToken(t); setQuote(null); setQuoteError(''); setCustomAddress(''); }} />
            <div style={{ flex: 1, textAlign: 'right', fontSize: 22, fontWeight: 500, minWidth: 0, color: quoteLoading ? C.muted : quote ? C.green : C.muted2 }}>{quoteLoading ? '...' : quote ? quote.outAmountDisplay : '0.00'}</div>
          </div>
          {quote && toPriceVal > 0 && <div style={{ textAlign: 'right', marginTop: 5, fontSize: 11, color: C.muted }}>{fmt(parseFloat(quote.outAmountDisplay) * toPriceVal)}</div>}
        </div>
        {quoteError && <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red }}>{quoteError}</div>}
        {quote && fromAmt && (
          <div style={{ marginTop: 12, background: '#050912', borderRadius: 10, padding: 12 }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,.05)', paddingTop: 8 }}>
              {[
                ['Fee',                 fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * PLATFORM_FEE).toFixed(2) : '3%'],
                ['Safety and Anti-MEV', fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * SAFETY_FEE).toFixed(2) : '2%'],
                isCrossChain ? ['Cross-chain fee', fromPriceVal > 0 ? '$' + (parseFloat(fromAmt) * fromPriceVal * CROSS_FEE).toFixed(2) : '3%'] : null,
                route === 'jupiter' ? ['Price impact', '~' + parseFloat(quote.priceImpactPct || 0).toFixed(3) + '%'] : null,
                route === 'jupiter' ? ['Min received', (parseFloat(quote.outAmountDisplay) * (1 - slip / 100)).toFixed(6) + ' ' + (toToken ? toToken.symbol : '')] : null,
              ].filter(Boolean).map(function(item) {
                return <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}><span style={{ color: C.muted }}>{item[0]}</span><span style={{ color: C.text }}>{item[1]}</span></div>;
              })}
            </div>
          </div>
        )}
        {needsDstAddr && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>DESTINATION WALLET</div>
            <input value={customAddress} onChange={function(e) { setCustomAddress(e.target.value); }} placeholder={isSol(toToken) ? 'Your Solana wallet address...' : 'Your ' + (CHAIN_NAMES[toToken && toToken.chainId] || 'EVM') + ' address (0x...)...'} style={{ width: '100%', background: C.card2, border: '1px solid rgba(0,229,255,.2)', borderRadius: 10, padding: '10px 12px', color: C.accent, fontFamily: 'monospace', fontSize: 11, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Where you want to receive your tokens</div>
          </div>
        )}
        {swapError && <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red }}>{swapError}</div>}
        {walletConnected ? (
          <button onClick={executeSwap} disabled={swapStatus === 'loading'} style={{ width: '100%', marginTop: 14, padding: 16, borderRadius: 12, border: 'none', background: swapStatus === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : swapStatus === 'error' ? 'rgba(255,59,107,.2)' : !fromAmt || !quote ? C.card2 : 'linear-gradient(135deg,#00e5ff,#0055ff)', color: !fromAmt || !quote ? C.muted2 : swapStatus === 'error' ? C.red : C.bg, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: swapStatus === 'loading' ? 'not-allowed' : 'pointer', transition: 'all .3s', minHeight: 52 }}>
            {swapStatus === 'loading' ? 'Confirming...' : swapStatus === 'success' ? 'Swap Confirmed!' : swapStatus === 'error' ? 'Failed -- Try Again' : !fromAmt ? 'Enter Amount' : quoteLoading ? 'Getting Best Route...' : !quote ? 'No Route Found' : 'Swap ' + (fromToken ? fromToken.symbol : '') + ' > ' + (toToken ? toToken.symbol : '')}
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
