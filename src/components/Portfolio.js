/**
 * NEXUS DEX -- Portfolio
 * 
 * Data sources:
 *   - Solana balances: wallet-adapter connection (RPC)
 *   - EVM balances: viem multicall via wagmi
 *   - Token prices: OKX /api/okx/dex/aggregator/all-tokens (batched)
 *   - Token metadata: OKX for name/logo/symbol, fallback to address truncation
 *
 * Removed: LiFi, Helius DAS for prices, Jupiter, 0x, Moralis, GeckoTerminal
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAccount, useConfig } from 'wagmi';
import { getPublicClient } from 'wagmi/actions';
import { erc20Abi, formatUnits } from 'viem';

const C = {
  card: '#080d1a',
  card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)',
  borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff',
  green: '#00ffa3',
  red: '#ff3b6b',
  text: '#cdd6f4',
  muted: '#586994',
  muted2: '#2e3f5e',
};

const CHAIN_NAMES = {
  1: 'Ethereum', 10: 'Optimism', 56: 'BNB Chain', 100: 'Gnosis',
  137: 'Polygon', 250: 'Fantom', 324: 'zkSync', 8453: 'Base',
  42161: 'Arbitrum', 43114: 'Avalanche', 59144: 'Linea', 534352: 'Scroll',
  5000: 'Mantle', 81457: 'Blast', 34443: 'Mode', 130: 'Unichain',
  146: 'Sonic', 80094: 'Berachain', 57073: 'Ink', 480: 'World Chain',
  25: 'Cronos', 1284: 'Moonbeam', 42220: 'Celo', 1313161554: 'Aurora',
  1088: 'Metis', 8217: 'Kaia', 1329: 'Sei', 2020: 'Ronin', 7777777: 'Zora',
  1101: 'Polygon zkEVM', 252: 'Fraxtal', 255: 'Kroma', 167000: 'Taiko',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const OKX_SOL_CHAIN = '501';

const SPL_LEGACY_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_TOKEN2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const EVM_NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Pre-built EVM token list per chain for balance scanning (top tokens)
// We scan these addresses + the user's actual holdings will show
const EVM_SCAN_TOKENS = {
  1: [
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', // MATIC
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
    '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', // SHIB
  ],
  8453: [
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
  ],
  42161: [
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC
    '0x912ce59144191c1204e64559fe8253a0e49e6548', // ARB
  ],
  10: [
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // USDC
    '0x4200000000000000000000000000000000000042', // OP
  ],
  137: [
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
  ],
  56: [
    '0x55d398326f99059ff775485246999027b3197955', // USDT
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
    '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  ],
  43114: [
    '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', // USDT
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', // USDC
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', // WAVAX
  ],
};

function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}

function fmtTokenAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n > 0) return n.toFixed(6);
  return '0';
}

function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

function isValidSolAddress(s) {
  if (!s || typeof s !== 'string') return false;
  try { new PublicKey(s.trim()); return true; }
  catch { return false; }
}

function getSolPriceFromCoins(coins) {
  if (!Array.isArray(coins)) return 0;
  const sol = coins.find(c => c && (c.id === 'solana' || c.symbol === 'SOL'));
  return sol && Number(sol.current_price) > 0 ? Number(sol.current_price) : 0;
}

/* ============================================================================
 * OKX Token Price Lookup (batched)
 * ========================================================================= */
const okxPriceCache = new Map();

async function fetchOkxPrices(addresses, chainIndex) {
  if (!addresses || !addresses.length) return {};
  
  const deduped = [...new Set(addresses.map(a => a.toLowerCase().trim()).filter(Boolean))];
  const uncached = deduped.filter(a => !okxPriceCache.has(a + ':' + chainIndex));
  
  if (uncached.length === 0) {
    const result = {};
    deduped.forEach(a => {
      const cached = okxPriceCache.get(a + ':' + chainIndex);
      if (cached) result[a] = cached;
    });
    return result;
  }

  const chunkSize = 10;
  const results = {};

  for (let i = 0; i < uncached.length; i += chunkSize) {
    const chunk = uncached.slice(i, i + chunkSize);
    const qs = new URLSearchParams({
      chainIndex: String(chainIndex),
      keyword: chunk.join(','),
    });

    try {
      const res = await fetch('/api/okx/dex/aggregator/all-tokens?' + qs.toString());
      const data = await res.json().catch(() => null);
      
      if (data && Array.isArray(data.data)) {
        data.data.forEach(t => {
          const addr = (t.tokenContractAddress || t.address || '').toLowerCase();
          const price = Number(t.tokenUnitPrice || t.price || 0) || 0;
          const info = {
            symbol: t.tokenSymbol || t.symbol || '',
            name: t.tokenName || t.name || '',
            logoURI: t.tokenLogoUrl || t.logoURI || null,
            decimals: t.decimals != null ? Number(t.decimals) : 18,
            price,
          };
          okxPriceCache.set(addr + ':' + chainIndex, info);
          results[addr] = info;
        });
      }
    } catch {}
  }

  // Return all requested, from cache if not freshly fetched
  const out = {};
  deduped.forEach(a => {
    out[a] = results[a] || okxPriceCache.get(a + ':' + chainIndex) || null;
  });
  return out;
}

/* ============================================================================
 * EVM Balance Scanner (multicall)
 * ========================================================================= */
async function fetchEvmBalances(walletAddress, wagmiConfig) {
  if (!walletAddress || !wagmiConfig) return [];

  const configuredChainIds = (wagmiConfig.chains || []).map(c => c.id);
  const scanChains = configuredChainIds.filter(cid => EVM_SCAN_TOKENS[cid]);

  const results = await Promise.all(scanChains.map(async chainId => {
    let publicClient;
    try {
      publicClient = getPublicClient(wagmiConfig, { chainId });
    } catch { return []; }
    if (!publicClient) return [];

    const tokenAddresses = EVM_SCAN_TOKENS[chainId] || [];
    const out = [];

    // ERC20 balances
    if (tokenAddresses.length) {
      try {
        const balances = await publicClient.multicall({
          contracts: tokenAddresses.map(addr => ({
            address: addr,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress],
          })),
          allowFailure: true,
        });

        balances.forEach((res, i) => {
          if (!res || res.status !== 'success' || !res.result || res.result === 0n) return;
          out.push({
            chainId,
            address: tokenAddresses[i],
            rawBalance: res.result,
          });
        });
      } catch {}
    }

    // Native balance
    try {
      const nativeWei = await publicClient.getBalance({ address: walletAddress });
      if (nativeWei > 0n) {
        out.push({
          chainId,
          address: EVM_NATIVE_ADDRESS,
          rawBalance: nativeWei,
          isNative: true,
        });
      }
    } catch {}

    return out;
  }));

  return results.flat();
}

/* ============================================================================
 * Component
 * ========================================================================= */
export default function Portfolio({
  coins,
  onSend,
  onConnectWallet,
  isConnected,
  isSolanaConnected,
  walletAddress,
  refreshKey,
  onSelectToken,
}) {
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const wagmiConfig = useConfig();

  const [solBalances, setSolBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState('');

  const [evmTokens, setEvmTokens] = useState([]);
  const [evmLoading, setEvmLoading] = useState(false);

  const [manualAddress, setManualAddress] = useState('');
  const [lookupAddress, setLookupAddress] = useState('');

  const walletConnected = Boolean(isConnected || solConnected || evmConnected || publicKey || evmAddress);
  const effectiveSolAddress = publicKey ? publicKey.toString() : lookupAddress;

  const rootStyle = { width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' };

  useEffect(() => {
    setSolPriceUsd(getSolPriceFromCoins(coins));
  }, [coins]);

  /* -- Solana balances + prices -- */
  const fetchSolBalances = useCallback(async () => {
    const addrToUse = publicKey ? publicKey.toString() : lookupAddress;
    if (!addrToUse || !connection) return;

    setSolLoading(true);
    setSolError('');

    try {
      const lookupPubkey = new PublicKey(addrToUse);
      const lamports = await connection.getBalance(lookupPubkey);
      setSolBalance(lamports / 1e9);

      const accountsResults = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_LEGACY_PROGRAM }),
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_TOKEN2022_PROGRAM }),
      ]);

      let allAccounts = [];
      accountsResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.value) {
          allAccounts = allAccounts.concat(r.value.value);
        }
      });

      const byMint = {};
      allAccounts.forEach(account => {
        try {
          const info = account.account.data.parsed.info;
          const tokenAmount = info.tokenAmount || {};
          const uiAmount = parseFloat(tokenAmount.uiAmountString || tokenAmount.uiAmount || 0);
          if (!uiAmount || uiAmount <= 0.000001 || !info.mint) return;
          if (!byMint[info.mint]) {
            byMint[info.mint] = { mint: info.mint, uiAmount: 0, decimals: tokenAmount.decimals };
          }
          byMint[info.mint].uiAmount += uiAmount;
        } catch {}
      });

      let holdings = Object.values(byMint);
      
      // Batch fetch prices from OKX
      if (holdings.length > 0) {
        const allMints = [...holdings.map(h => h.mint)];
        if (lamports > 0) allMints.push(SOL_MINT);
        
        const prices = await fetchOkxPrices(allMints, OKX_SOL_CHAIN);
        
        holdings = holdings.map(h => {
          const p = prices[h.mint.toLowerCase()] || {};
          return {
            ...h,
            symbol: p.symbol || h.mint.slice(0, 4) + '...',
            name: p.name || 'Unknown Token',
            logoURI: p.logoURI || null,
            decimals: p.decimals != null ? p.decimals : h.decimals,
            price: p.price || 0,
          };
        });

        // Update SOL price from OKX as fallback
        const solOkx = prices[SOL_MINT.toLowerCase()];
        if (solOkx && solOkx.price > 0 && solPriceUsd === 0) {
          setSolPriceUsd(solOkx.price);
        }
      }

      holdings.sort((a, b) => (b.uiAmount * b.price) - (a.uiAmount * a.price));
      setSolBalances(holdings);
    } catch (e) {
      setSolError('Failed to load Solana balances');
    }
    setSolLoading(false);
  }, [publicKey, connection, lookupAddress, solPriceUsd]);

  /* -- EVM balances + prices -- */
  const fetchEvmData = useCallback(async () => {
    if (!evmAddress || !wagmiConfig) { setEvmTokens([]); return; }
    setEvmLoading(true);

    try {
      const rawBalances = await fetchEvmBalances(evmAddress, wagmiConfig);
      
      if (rawBalances.length === 0) {
        setEvmTokens([]);
        setEvmLoading(false);
        return;
      }

      // Group addresses by chain for batched price lookup
      const byChain = {};
      rawBalances.forEach(b => {
        if (!byChain[b.chainId]) byChain[b.chainId] = [];
        byChain[b.chainId].push(b);
      });

      const allTokens = [];

      for (const [chainId, balances] of Object.entries(byChain)) {
        const addresses = balances.map(b => b.address);
        const prices = await fetchOkxPrices(addresses, chainId);

        balances.forEach(b => {
          const p = prices[b.address.toLowerCase()] || {};
          const decimals = p.decimals != null ? p.decimals : 18;
          const balance = Number(formatUnits(b.rawBalance, decimals));
          const priceUsd = p.price || 0;

          if (!Number.isFinite(balance) || balance <= 0) return;

          allTokens.push({
            chainId: Number(chainId),
            address: b.address,
            symbol: p.symbol || (b.isNative ? 'ETH' : shortAddr(b.address)),
            name: p.name || (b.isNative ? 'Native Token' : 'Unknown'),
            logoURI: p.logoURI || null,
            decimals,
            balance,
            priceUsd,
            balanceUsd: balance * priceUsd,
            isNative: !!b.isNative,
          });
        });
      }

      allTokens.sort((a, b) => (b.balanceUsd || 0) - (a.balanceUsd || 0));
      setEvmTokens(allTokens);
    } catch (e) {
      setEvmTokens([]);
    }
    setEvmLoading(false);
  }, [evmAddress, wagmiConfig]);

  useEffect(() => {
    if (effectiveSolAddress) {
      fetchSolBalances();
      const interval = setInterval(fetchSolBalances, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [effectiveSolAddress, fetchSolBalances]);

  useEffect(() => {
    fetchEvmData();
  }, [fetchEvmData]);

  useEffect(() => {
    if (refreshKey > 0) {
      if (publicKey || lookupAddress) fetchSolBalances();
      if (evmAddress) fetchEvmData();
    }
  }, [refreshKey, publicKey, lookupAddress, evmAddress, fetchSolBalances, fetchEvmData]);

  const solValue = solBalance * solPriceUsd;
  const solTokensTotal = solBalances.reduce((sum, h) => sum + (h.uiAmount * h.price), 0);
  const evmTotal = evmTokens.reduce((sum, t) => sum + (t.balanceUsd || 0), 0);
  const totalValue = solValue + solTokensTotal + evmTotal;

  const evmChainCount = Object.keys(evmTokens.reduce((acc, t) => { acc[t.chainId] = 1; return acc; }, {})).length;

  function SendButton(props) {
    return (
      <button
        onClick={() => onSend && onSend()}
        disabled={!onSend}
        style={Object.assign({
          background: onSend ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.04)',
          border: 'none', borderRadius: 12, padding: '14px 22px',
          color: onSend ? '#03060f' : C.muted, fontSize: 14, fontWeight: 800,
          cursor: onSend ? 'pointer' : 'not-allowed', fontFamily: 'Syne, sans-serif',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, minHeight: 48,
        }, props.style || {})}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        Send
      </button>
    );
  }

  function ManualSolLookup() {
    return (
      <div style={{ background: C.card, border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>LOOK UP SOLANA ADDRESS</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={manualAddress}
            onChange={e => setManualAddress(e.target.value)}
            placeholder="Paste Solana address..."
            style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: 'monospace', fontSize: 12, outline: 'none', minWidth: 0 }}
          />
          <button
            onClick={() => {
              const next = manualAddress.trim();
              if (!isValidSolAddress(next)) { setSolError('Invalid Solana address'); return; }
              setSolError(''); setLookupAddress(next);
            }}
            style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#03060f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0 }}
          >
            Load
          </button>
        </div>
        {lookupAddress && <div style={{ fontSize: 11, color: C.green, marginTop: 6 }}>Showing: {shortAddr(lookupAddress)}</div>}
      </div>
    );
  }

  if (!walletConnected && !lookupAddress) {
    return (
      <div style={Object.assign({ maxWidth: 520, margin: '0 auto' }, rootStyle)}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Solana and EVM portfolio tracking via OKX</p>
        </div>

        <div style={{ textAlign: 'center', padding: '50px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, maxWidth: 320, margin: '0 auto 24px', lineHeight: 1.6 }}>Connect to view Solana and EVM balances.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>

        <ManualSolLookup />
        {solError && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{solError}</div>}
      </div>
    );
  }

  return (
    <div style={Object.assign({ maxWidth: 600, margin: '0 auto' }, rootStyle)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Solana &middot; EVM chains &middot; auto-refresh 30s &middot; OKX prices</p>
        </div>
        <button onClick={() => { fetchSolBalances(); fetchEvmData(); }} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '7px 14px', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, alignSelf: 'flex-start' }}>Refresh</button>
      </div>

      <div style={{ background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(0,85,255,0.04) 100%)', border: '1px solid ' + C.borderHi, borderRadius: 18, padding: 20, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 4 }}>TOTAL PORTFOLIO VALUE</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{fmt(totalValue)}</div>
        </div>
        <SendButton style={{ flexShrink: 0 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(solConnected || publicKey || lookupAddress) && (
          <div style={{ background: C.card, border: '1px solid rgba(153,69,255,.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#9945ff', flexShrink: 0 }}>S</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .6 }}>SOLANA WALLET</div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(publicKey ? publicKey.toString() : lookupAddress || '')}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{solBalance.toFixed(4)} SOL</div>
              <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{fmt(solValue + solTokensTotal)}</div>
            </div>
          </div>
        )}

        {(evmConnected || evmAddress) && (
          <div style={{ background: C.card, border: '1px solid rgba(98,126,234,.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(98,126,234,.2)', border: '1px solid rgba(98,126,234,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#627eea', flexShrink: 0 }}>E</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .6 }}>EVM WALLET</div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(evmAddress || '')}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{evmTokens.length} tokens &middot; {evmChainCount} chains</div>
              <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{fmt(evmTotal)}</div>
            </div>
          </div>
        )}
      </div>

      {!publicKey && <ManualSolLookup />}
      {solError && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{solError}</div>}

      {(solConnected || publicKey || lookupAddress) && (
        <>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>SOLANA TOKENS</div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
            </div>

            <div
              onClick={() => onSelectToken && onSelectToken({ id: 'solana', symbol: 'SOL', name: 'Solana', current_price: solPriceUsd, mint: SOL_MINT, address: SOL_MINT, isSolanaToken: true, chain: 'solana' })}
              style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.03)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
                <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div><div style={{ color: C.muted, fontSize: 10 }}>Solana</div></div>
              </div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solPriceUsd > 0 ? fmt(solPriceUsd) : '-'}</div>
              <div style={{ textAlign: 'right', color: solValue > 0 ? C.green : C.muted, fontSize: 13, fontWeight: 600 }}>{solValue > 0 ? fmt(solValue) : '-'}</div>
            </div>

            {solLoading && solBalances.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading Solana tokens...</div>
            ) : solBalances.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 12 }}>No other SPL tokens found</div>
            ) : (
              solBalances.map(token => {
                const value = token.uiAmount * token.price;
                return (
                  <div
                    key={token.mint}
                    onClick={() => onSelectToken && onSelectToken({ id: token.mint, mint: token.mint, symbol: token.symbol, name: token.name, image: token.logoURI, current_price: token.price, isSolanaToken: true, chain: 'solana', decimals: token.decimals })}
                    style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {token.logoURI
                        ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={e => e.target.style.display = 'none'} />
                        : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{token.symbol && token.symbol.charAt(0)}</div>
                      }
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.symbol}</div>
                        <div style={{ color: C.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmtTokenAmt(token.uiAmount)}</div>
                    <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.price > 0 ? fmt(token.price) : '-'}</div>
                    <div style={{ textAlign: 'right', color: value > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{value > 0 ? fmt(value) : '-'}</div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {evmConnected || evmAddress ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>EVM TOKENS &middot; {evmChainCount} CHAINS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {evmLoading && <span style={{ fontSize: 11, color: C.accent }}>Scanning...</span>}
              {!evmLoading && evmTokens.length > 0 && <span style={{ fontSize: 11, color: C.muted }}>Total: <span style={{ color: C.green, fontWeight: 700 }}>{fmt(evmTotal)}</span></span>}
            </div>
          </div>

          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
            </div>

            {evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Scanning balances across chains...</div>}
            {!evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>No EVM token balances found</div>}

            {evmTokens.map(token => {
              const stableId = token.chainId + '-' + token.address.toLowerCase();
              const chainName = CHAIN_NAMES[token.chainId] || ('Chain ' + token.chainId);

              return (
                <div
                  key={stableId}
                  onClick={() => onSelectToken && onSelectToken({ id: stableId, symbol: token.symbol, name: token.name, image: token.logoURI, current_price: token.priceUsd, address: token.address, chainId: token.chainId, chain: 'evm', decimals: token.decimals })}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', alignItems: 'center', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {token.logoURI
                      ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={e => e.target.style.display = 'none'} />
                      : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(98,126,234,.15)', border: '1px solid rgba(98,126,234,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#627eea', flexShrink: 0 }}>{token.symbol && token.symbol.charAt(0)}</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.symbol}</div>
                      <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name} &middot; {chainName}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmtTokenAmt(token.balance)}</div>
                  <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{token.priceUsd > 0 ? fmt(token.priceUsd) : '-'}</div>
                  <div style={{ textAlign: 'right', color: token.balanceUsd > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 600 }}>{token.balanceUsd > 0 ? fmt(token.balanceUsd) : '-'}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ background: C.card, border: '1px solid rgba(98,126,234,.2)', borderRadius: 14, padding: 20, textAlign: 'center' }}>
          <div style={{ color: '#627eea', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Connect EVM Wallet</div>
          <p style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>See EVM balances across supported chains.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#627eea,#4a5fcc)', border: 'none', borderRadius: 8, padding: '10px 22px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
        </div>
      )}
    </div>
  );
}
