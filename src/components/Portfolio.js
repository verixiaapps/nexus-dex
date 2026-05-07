/**
 * NEXUS DEX -- Portfolio
 *
 * Sources (locked: Jupiter Solana, 0x EVM, LiFi everything cross-chain):
 *   - Solana SPL balances:    Solana RPC (via /api/solana-rpc proxy)
 *   - Solana token metadata:  Jupiter v2 /tokens/v2/search batched
 *   - Solana prices:          baked into Jupiter v2 search response
 *   - EVM ERC20 balances:     viem multicall via the user's wagmi public
 *                             client for each connected chain (no proxy
 *                             needed -- multicall is read-only chain RPC)
 *   - EVM token catalog:      LiFi /v1/tokens via /api/lifi proxy
 *                             (priceUSD baked in, used for USD valuation)
 *   - EVM native balance:     wagmi useBalance per chain
 *
 * Removed (banned):
 *   - Moralis everywhere
 *   - GeckoTerminal everywhere
 *   - api.jup.ag/price/v2 (deprecated)
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAccount, useConfig } from 'wagmi';
import { getPublicClient } from 'wagmi/actions';
import { erc20Abi } from 'viem';

const C = {
  card: '#080d1a', card2: '#0c1220',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
};

/* ============================================================================
 * Chain display names. Used for the chain pill on each EVM row.
 * (Only chains LiFi indexes are useful here; the wagmi config covers more
 * for swap routing but we surface balances on the popular ones.)
 * ========================================================================= */
const CHAIN_NAMES = {
  1:     'Ethereum',
  10:    'Optimism',
  56:    'BNB Chain',
  100:   'Gnosis',
  137:   'Polygon',
  250:   'Fantom',
  324:   'zkSync',
  8453:  'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  534352:'Scroll',
  5000:  'Mantle',
  81457: 'Blast',
  34443: 'Mode',
  130:   'Unichain',
  146:   'Sonic',
  80094: 'Berachain',
  57073: 'Ink',
  480:   'World Chain',
  25:    'Cronos',
  1284:  'Moonbeam',
  42220: 'Celo',
  1313161554: 'Aurora',
  1088:  'Metis',
  8217:  'Kaia',
  1329:  'Sei',
  2020:  'Ronin',
  7777777: 'Zora',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SPL_LEGACY_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_TOKEN2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/* Maximum ERC20 balanceOf calls per chain. Multicall batches this. */
const EVM_TOP_TOKENS_PER_CHAIN = 100;

/* ============================================================================
 * Formatters
 * ========================================================================= */
function fmt(n, d = 2) {
  if (n == null) return '$0.00';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1) return '$' + n.toFixed(d);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}
function fmtTokenAmt(n) {
  if (n == null) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}

/* ============================================================================
 * Lazy LiFi token catalog cache. One fetch per session, covers every
 * chain LiFi indexes. We index by `<chainId>-<address>` for fast lookup.
 * ========================================================================= */
let _lifiCache = null;
let _lifiLoading = false;
let _lifiCallbacks = [];
function getLifiTokens() {
  return new Promise(function (resolve) {
    if (_lifiCache) { resolve(_lifiCache); return; }
    _lifiCallbacks.push(resolve);
    if (_lifiLoading) return;
    _lifiLoading = true;
    fetch('/api/lifi/v1/tokens')
      .then(function (r) { return r.ok ? r.json() : { tokens: {} }; })
      .catch(function () { return { tokens: {} }; })
      .then(function (data) {
        const byChain = {};
        if (data && data.tokens) {
          Object.keys(data.tokens).forEach(function (cid) {
            const arr = data.tokens[cid];
            if (!Array.isArray(arr)) return;
            byChain[Number(cid)] = arr;
          });
        }
        _lifiCache = byChain;
        _lifiCallbacks.forEach(function (cb) { cb(byChain); });
        _lifiCallbacks = [];
        _lifiLoading = false;
      });
  });
}

/* ============================================================================
 * Jupiter v2 search batched -- one fetch per mint, parallelized.
 * Returns { [mint]: { name, symbol, image, price, decimals, mcap } }
 * ========================================================================= */
async function fetchJupiterMintData(mints) {
  if (!mints || !mints.length) return {};
  const slice = mints.slice(0, 50);
  const results = await Promise.all(slice.map(function (m) {
    return fetch('/api/jupiter/tokens/v2/search?query=' + encodeURIComponent(m))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }));
  const out = {};
  results.forEach(function (arr, i) {
    if (!Array.isArray(arr) || !arr.length) return;
    const mint = slice[i];
    const t = arr.find(function (x) { return x && x.id === mint; }) || arr[0];
    if (!t) return;
    out[mint] = {
      name: t.name || null,
      symbol: t.symbol || null,
      image: t.icon || t.logoURI || null,
      decimals: t.decimals != null ? t.decimals : 6,
      price: t.usdPrice != null ? Number(t.usdPrice) : 0,
      mcap: t.mcap != null ? Number(t.mcap) : 0,
    };
  });
  return out;
}

/* ============================================================================
 * EVM ERC20 balance scan via viem multicall.
 *
 * For a connected EVM wallet on chains we care about, multicall `balanceOf`
 * for the top-N priced tokens from LiFi's catalog for each chain. Results
 * with non-zero balances are merged with LiFi's metadata + priceUSD.
 *
 * The chain list comes from intersect(wagmi configured chains, LiFi
 * supported chains) so we never call multicall on a chain we don't have
 * a public client for.
 *
 * Returns flat array of { chainId, address, symbol, name, logoURI,
 *                         decimals, balance, priceUsd, balanceUsd }
 * ========================================================================= */
async function fetchEvmBalances(walletAddress, wagmiConfig, lifiByChain) {
  if (!walletAddress || !wagmiConfig || !lifiByChain) return [];

  const configuredChainIds = (wagmiConfig.chains || []).map(function (c) { return c.id; });
  const targetChains = configuredChainIds.filter(function (cid) {
    return lifiByChain[cid] && lifiByChain[cid].length > 0;
  });

  /* Per-chain scan in parallel */
  const perChain = await Promise.all(targetChains.map(async function (chainId) {
    let publicClient;
    try { publicClient = getPublicClient(wagmiConfig, { chainId }); }
    catch (e) { return []; }
    if (!publicClient) return [];

    /* Pick the priced tokens from LiFi's list for this chain.
     * Filtering by priceUSD removes spam / abandoned tokens. */
    const all = lifiByChain[chainId] || [];
    const priced = all.filter(function (t) {
      return t.address && t.address !== '0x0000000000000000000000000000000000000000'
        && t.priceUSD && parseFloat(t.priceUSD) > 0;
    }).slice(0, EVM_TOP_TOKENS_PER_CHAIN);

    if (!priced.length) return [];

    /* Multicall balanceOf for each candidate ERC20 */
    let balances;
    try {
      balances = await publicClient.multicall({
        contracts: priced.map(function (t) {
          return {
            address: t.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress],
          };
        }),
        allowFailure: true,
      });
    } catch (e) {
      return [];
    }

    /* Merge results with metadata, filter zero */
    const out = [];
    balances.forEach(function (res, i) {
      if (res.status !== 'success' || res.result == null) return;
      const raw = res.result;
      if (!raw || raw === 0n) return;
      const t = priced[i];
      const decimals = t.decimals != null ? Number(t.decimals) : 18;
      const balance = Number(raw) / Math.pow(10, decimals);
      if (balance <= 0) return;
      const priceUsd = parseFloat(t.priceUSD) || 0;
      out.push({
        chainId,
        address: t.address,
        symbol: t.symbol || '???',
        name: t.name || t.symbol || 'Unknown Token',
        logoURI: t.logoURI || null,
        decimals,
        balance,
        priceUsd,
        balanceUsd: balance * priceUsd,
      });
    });

    /* Native balance (ETH/MATIC/BNB/etc.) */
    try {
      const nativeWei = await publicClient.getBalance({ address: walletAddress });
      const nativeAmt = Number(nativeWei) / 1e18;
      if (nativeAmt > 0) {
        /* Find the native entry in LiFi catalog (address 0x000...000) */
        const native = (lifiByChain[chainId] || []).find(function (t) {
          return t.address === '0x0000000000000000000000000000000000000000';
        });
        const symbol = (native && native.symbol) || 'ETH';
        const priceUsd = native && native.priceUSD ? parseFloat(native.priceUSD) : 0;
        out.push({
          chainId,
          address: '0x0000000000000000000000000000000000000000',
          symbol,
          name: (native && native.name) || symbol,
          logoURI: (native && native.logoURI) || null,
          decimals: 18,
          balance: nativeAmt,
          priceUsd,
          balanceUsd: nativeAmt * priceUsd,
          isNative: true,
        });
      }
    } catch (e) { /* ignore */ }

    return out;
  }));

  return perChain.flat();
}

/* ============================================================================
 * Component
 * ========================================================================= */
export default function Portfolio({ coins, jupiterTokens, onSend, onConnectWallet, isConnected, isSolanaConnected, walletAddress, refreshKey, onSelectToken }) {
  const { publicKey, connected: solConnected } = useWallet();
  const { connection } = useConnection();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const wagmiConfig = useConfig();

  const walletConnected = isConnected || solConnected || evmConnected;

  const [solBalances, setSolBalances] = useState([]);
  const [solBalance, setSolBalance] = useState(0);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState('');
  const [evmTokens, setEvmTokens] = useState([]);
  const [evmLoading, setEvmLoading] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [lookupAddress, setLookupAddress] = useState('');

  const getTokenInfoRef = useRef(null);
  const getTokenInfo = useCallback(function (mint) {
    if (!jupiterTokens || !jupiterTokens.length) return null;
    return jupiterTokens.find(function (t) { return t.mint === mint || t.id === mint; });
  }, [jupiterTokens]);
  useEffect(function () { getTokenInfoRef.current = getTokenInfo; }, [getTokenInfo]);

  /* -------- Solana fetch -------- */
  const fetchSolBalances = useCallback(async function () {
    const addrToUse = publicKey ? publicKey.toString() : lookupAddress;
    if (!addrToUse || !connection) return;
    setSolLoading(true); setSolError('');
    try {
      const lookupPubkey = new PublicKey(addrToUse);
      const lamports = await connection.getBalance(lookupPubkey);
      setSolBalance(lamports / 1e9);

      const accountsResults = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_LEGACY_PROGRAM }),
        connection.getParsedTokenAccountsByOwner(lookupPubkey, { programId: SPL_TOKEN2022_PROGRAM }),
      ]);
      let allAccounts = [];
      accountsResults.forEach(function (r) {
        if (r.status === 'fulfilled' && r.value && r.value.value) {
          allAccounts = allAccounts.concat(r.value.value);
        }
      });

      const seenMints = new Set();
      let holdings = [];
      allAccounts.forEach(function (account) {
        try {
          const info = account.account.data.parsed.info;
          const uiAmount = info.tokenAmount.uiAmount;
          if (uiAmount && uiAmount > 0.000001 && !seenMints.has(info.mint)) {
            seenMints.add(info.mint);
            const cached = getTokenInfoRef.current ? getTokenInfoRef.current(info.mint) : null;
            holdings.push({
              mint: info.mint,
              symbol: cached ? cached.symbol : info.mint.slice(0, 4) + '...',
              name: cached ? cached.name : null,
              logoURI: cached ? cached.logoURI : null,
              decimals: info.tokenAmount.decimals,
              uiAmount,
              price: 0,
            });
          }
        } catch (e) {}
      });

      /* Fetch metadata + price for ALL holdings via Jupiter v2 search */
      const allMints = holdings.map(function (h) { return h.mint; });
      const metaPlusPrice = await fetchJupiterMintData(allMints.concat([SOL_MINT]));

      const solMeta = metaPlusPrice[SOL_MINT];
      if (solMeta && solMeta.price > 0) setSolPriceUsd(solMeta.price);

      holdings = holdings.map(function (h) {
        const m = metaPlusPrice[h.mint] || {};
        return {
          mint: h.mint,
          symbol: m.symbol || h.symbol,
          name: m.name || h.name || 'Unknown Token',
          logoURI: m.image || h.logoURI || null,
          decimals: h.decimals,
          uiAmount: h.uiAmount,
          price: m.price || 0,
        };
      });

      holdings.sort(function (a, b) {
        return (b.uiAmount * b.price) - (a.uiAmount * a.price);
      });

      setSolBalances(holdings);
    } catch (e) {
      console.error('Solana balance error:', e);
      setSolError('Failed to load Solana balances: ' + (e.message || ''));
    }
    setSolLoading(false);
  }, [publicKey, connection, lookupAddress]);

  /* -------- EVM fetch -------- */
  const fetchEvmData = useCallback(async function () {
    if (!evmAddress || !wagmiConfig) { setEvmTokens([]); return; }
    setEvmLoading(true);
    try {
      const lifi = await getLifiTokens();
      const tokens = await fetchEvmBalances(evmAddress, wagmiConfig, lifi);
      tokens.sort(function (a, b) { return (b.balanceUsd || 0) - (a.balanceUsd || 0); });
      setEvmTokens(tokens);
    } catch (e) {
      console.error('EVM balance error:', e);
      setEvmTokens([]);
    }
    setEvmLoading(false);
  }, [evmAddress, wagmiConfig]);

  const effectiveAddress = publicKey ? publicKey.toString() : lookupAddress;

  useEffect(function () {
    if (effectiveAddress) {
      fetchSolBalances();
      const interval = setInterval(fetchSolBalances, 30000);
      return function () { clearInterval(interval); };
    }
  }, [effectiveAddress, fetchSolBalances]);

  useEffect(function () { fetchEvmData(); }, [fetchEvmData]);

  useEffect(function () {
    if (refreshKey > 0) {
      if (publicKey || lookupAddress) fetchSolBalances();
      if (evmAddress) fetchEvmData();
    }
  }, [refreshKey, publicKey, lookupAddress, evmAddress, fetchSolBalances, fetchEvmData]);

  /* -------- Totals -------- */
  const solValue = solBalance * solPriceUsd;
  const solTokensTotal = solBalances.reduce(function (sum, h) {
    return sum + (h.uiAmount * h.price);
  }, 0);
  const evmTotal = evmTokens.reduce(function (sum, t) { return sum + (t.balanceUsd || 0); }, 0);
  const totalValue = solValue + solTokensTotal + evmTotal;

  const rootStyle = { width: '100%', boxSizing: 'border-box', overscrollBehavior: 'none' };

  function SendButton(props) {
    return (
      <button
        onClick={function () { onSend && onSend(); }}
        disabled={!onSend}
        style={Object.assign({
          background: onSend ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.04)',
          border: 'none', borderRadius: 12,
          padding: '14px 22px', color: onSend ? '#03060f' : C.muted,
          fontSize: 14, fontWeight: 800, cursor: onSend ? 'pointer' : 'not-allowed',
          fontFamily: 'Syne, sans-serif',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          minHeight: 48,
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

  if (!walletConnected) {
    return (
      <div style={Object.assign({ maxWidth: 520, margin: '0 auto' }, rootStyle)}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>All tokens across Solana and every chain LiFi indexes</p>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 30px', background: C.card, border: '1px solid ' + C.border, borderRadius: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Connect Your Wallet</h2>
          <p style={{ color: C.muted, fontSize: 13, maxWidth: 300, margin: '0 auto 24px', lineHeight: 1.6 }}>Connect to view real-time balances across all chains.</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#9945ff,#7c3aed)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  const evmChainCount = Object.keys(evmTokens.reduce(function (acc, t) { acc[t.chainId] = 1; return acc; }, {})).length;

  return (
    <div style={Object.assign({ maxWidth: 600, margin: '0 auto' }, rootStyle)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Portfolio</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>Solana &middot; every chain LiFi supports &middot; auto-refresh 30s</p>
        </div>
        <button onClick={function () { fetchSolBalances(); fetchEvmData(); }} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 8, padding: '7px 14px', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 600, alignSelf: 'flex-start' }}>Refresh</button>
      </div>

      {/* Hero card -- Total + Send */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(0,85,255,0.04) 100%)',
        border: '1px solid ' + C.borderHi,
        borderRadius: 18, padding: 20, marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 4 }}>TOTAL PORTFOLIO VALUE</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{fmt(totalValue)}</div>
        </div>
        <SendButton style={{ flexShrink: 0 }} />
      </div>

      {/* Wallet pills */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {(solConnected || publicKey) && (
          <div style={{ background: C.card, border: '1px solid rgba(153,69,255,.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#9945ff', flexShrink: 0 }}>S</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .6 }}>SOLANA WALLET</div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(publicKey ? publicKey.toString() : walletAddress || '')}</div>
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

      {!solConnected && !publicKey && (
        <div style={{ background: C.card, border: '1px solid rgba(0,229,255,.15)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 8 }}>LOOK UP SOLANA ADDRESS (OPTIONAL)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={manualAddress} onChange={function (e) { setManualAddress(e.target.value); }} placeholder="Paste Solana address..." style={{ flex: 1, background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: 'monospace', fontSize: 12, outline: 'none' }} />
            <button onClick={function () { setLookupAddress(manualAddress.trim()); }} style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#03060f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif', flexShrink: 0 }}>Load</button>
          </div>
          {lookupAddress && <div style={{ fontSize: 11, color: C.green, marginTop: 6 }}>Showing: {shortAddr(lookupAddress)}</div>}
        </div>
      )}

      {solError && <div style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: C.red }}>{solError}</div>}

      {/* Solana table */}
      {(solConnected || publicKey || lookupAddress) && (
        <>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>SOLANA TOKENS</div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '10px 16px', borderBottom: '1px solid rgba(0,229,255,.06)', fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: .8 }}>
              <div>TOKEN</div><div style={{ textAlign: 'right' }}>BALANCE</div><div style={{ textAlign: 'right' }}>PRICE</div><div style={{ textAlign: 'right' }}>VALUE</div>
            </div>
            <div
              onClick={function () { onSelectToken && onSelectToken({ id: 'solana', symbol: 'SOL', name: 'Solana', current_price: solPriceUsd, image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png', mint: SOL_MINT, address: SOL_MINT, isSolanaToken: true, chain: 'solana' }); }}
              style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
              onMouseEnter={function (e) { e.currentTarget.style.background = 'rgba(0,229,255,.03)'; }}
              onMouseLeave={function (e) { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(153,69,255,.2)', border: '1px solid rgba(153,69,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9945ff', flexShrink: 0 }}>S</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>SOL</div>
                  <div style={{ color: C.muted, fontSize: 10 }}>Solana</div>
                </div>
              </div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{solBalance.toFixed(4)}</div>
              <div style={{ textAlign: 'right', color: C.text, fontSize: 12 }}>{fmt(solPriceUsd)}</div>
              <div style={{ textAlign: 'right', color: solValue > 0 ? C.green : C.muted, fontSize: 13, fontWeight: 600 }}>{fmt(solValue)}</div>
            </div>
            {solLoading && solBalances.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading Solana tokens...</div>
            ) : solBalances.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: C.muted, fontSize: 12 }}>No other SPL tokens found</div>
            ) : (
              solBalances.map(function (token) {
                const value = token.uiAmount * token.price;
                return (
                  <div
                    key={token.mint}
                    onClick={function () {
                      onSelectToken && onSelectToken({
                        id: token.mint, mint: token.mint, address: token.mint,
                        symbol: token.symbol, name: token.name,
                        image: token.logoURI, current_price: token.price,
                        isSolanaToken: true, chain: 'solana',
                        decimals: token.decimals,
                      });
                    }}
                    style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,.025)', cursor: 'pointer' }}
                    onMouseEnter={function (e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                    onMouseLeave={function (e) { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {token.logoURI
                        ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function (e) { e.target.style.display = 'none'; }} />
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

      {/* EVM table */}
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
            {evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Scanning EVM balances across every connected chain...</div>}
            {!evmLoading && evmTokens.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>No EVM token balances found</div>}
            {evmTokens.map(function (token) {
              const stableId = token.chainId + '-' + token.address.toLowerCase();
              const chainName = CHAIN_NAMES[token.chainId] || ('Chain ' + token.chainId);
              return (
                <div
                  key={stableId}
                  onClick={function () {
                    onSelectToken && onSelectToken({
                      id: stableId,
                      symbol: token.symbol, name: token.name,
                      image: token.logoURI || null, current_price: token.priceUsd,
                      address: token.address, chainId: token.chainId, chain: 'evm',
                      decimals: token.decimals,
                    });
                  }}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.025)', alignItems: 'center', cursor: 'pointer' }}
                  onMouseEnter={function (e) { e.currentTarget.style.background = 'rgba(0,229,255,.02)'; }}
                  onMouseLeave={function (e) { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {token.logoURI
                      ? <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} onError={function (e) { e.target.style.display = 'none'; }} />
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
          <p style={{ color: C.muted, fontSize: 12, marginBottom: 14 }}>See balances across every chain LiFi indexes</p>
          <button onClick={onConnectWallet} style={{ background: 'linear-gradient(135deg,#627eea,#4a5fcc)', border: 'none', borderRadius: 8, padding: '10px 22px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Connect</button>
        </div>
      )}
    </div>
  );
}
