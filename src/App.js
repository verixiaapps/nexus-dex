import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useDisconnect } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget from './components/SwapWidget.jsx';
import Markets from './components/Markets.js';
import BuyCrypto from './components/BuyCrypto.js';
import Portfolio from './components/Portfolio.js';
import TokenDetail from './components/TokenDetail.js';
import Send from './components/Send.js';
import NewLaunches from './components/NewLaunches.js';
import TokenLaunch from './components/TokenLaunch.js';
 
/* ============================================================================
 * Changes vs the previous App.js (preserves original structure and visuals;
 * only the listed fixes applied):
 *
 *   - M12 (DRY):       HEADER_TABS removed. NAV_TABS is the single source
 *                      used by both the desktop header and the mobile bottom nav.
 *
 *   - M13 (props):     BuyCrypto now receives the same sharedProps every
 *                      other route gets (isConnected, walletAddress, etc.). Was missing
 *                      before, so isConnected was unavailable inside BuyCrypto.
 *
 *   - H15 (cache):     localStorage market cache key bumped to
 *                      `nexus_market_cache_v2` with an explicit `v: 2` field. Old cache
 *                      entries under the unversioned key are simply ignored on upgrade --
 *                      next cache-shape change just bumps the suffix.
 *
 *   - A6 (locked rule): NetworkSelector dropdown placed in the header to
 *                      the LEFT of the Connect Wallet button. Reads `headerChain` from
 *                      WalletContext (persisted across sessions). SwapWidget reads the same
 *                      value for its default token pair.
 *
 *   - WC1, WC3, WC5 (race conditions): WalletModal connect flow rewritten
 *                      as a single useReducer state machine instead of three useEffects
 *                      fighting over `connecting` / `pendingWallet` flags. States are
 *                      idle -> connecting{wallet} -> idle | error{message}.
 *
 *   - WC2 (interrupted promise): WalletConnect path now calls openWeb3Modal()
 *                      FIRST, then closes our modal on a 200ms delay. Previously closed our
 *                      modal before opening Web3Modal, which interrupted the open flow on
 *                      slower devices.
 *
 *   - WC6 (silent failures): Connect errors now display in the modal UI
 *                      with a Retry button instead of just console.error.
 *
 *   - Minor: `@keyframes wc-spin` moved from an inline <style> tag inside
 *                      WalletModal into GLOBAL_STYLES so it injects once at app startup
 *                      rather than each time the modal mounts.
 *
 * Things intentionally NOT changed:
 *
 *   - Direct browser calls to api.coingecko.com and lite-api.jup.ag (H14 in
 *                      the review). Server-side proxying is a Round 4 task.
 *   - useAppWallet shim -- kept as a backwards-compat wrapper, AppInner
 *                      still uses it (it's not dead code; just a 1-line passthrough).
 *   - autoConnect on Solana provider (handled in index.js, already off).
 *   - Visual styling, icons, layout, SOLANA_MINTS list, CG_IDS list -- all
 *                      preserved as-is.
 * ========================================================================= */

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
};

const SOLANA_MINTS = [
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'jtojtomepa8tDDcS9EeQJwAkNnhvbTVS6ZoXgbCXyzz',
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
];

const CG_IDS = 'bitcoin,ethereum,binancecoin,ripple,cardano,dogecoin,solana,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near';

// H15 fix -- versioned cache key. Old `nexus_market_cache` entries are simply
// ignored on upgrade. Bump suffix any time the cache shape changes.
const MARKET_CACHE_KEY = 'nexus_market_cache_v2';

const GLOBAL_STYLES = `html,body{margin:0;padding:0;width:100%;min-height:100vh;overflow-x:hidden;overscroll-behavior:none;} *,*::before,*::after{box-sizing:border-box;} input,button,select,textarea{font-family:'Syne',sans-serif;} ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}} @keyframes wc-spin { to { transform: rotate(360deg); } }`;

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/markets': 'markets',
  '/launches': 'launches', '/launch': 'launch',
  '/buy': 'buy', '/send': 'send', '/portfolio': 'portfolio',
};
const TAB_TO_PATH = {
  swap: '/swap', markets: '/markets', launches: '/launches',
  launch: '/launch', buy: '/buy', send: '/send', portfolio: '/portfolio',
};

function tabFromPathname(pathname) {
  return PATH_TO_TAB[pathname] || (pathname.startsWith('/markets/token') ? 'token' : 'swap');
}
function getActiveTab(tab) {
  return tab === 'token' ? 'markets' : tab;
}

/* ============================================================================
 * useAppWallet -- backwards-compat shim, just delegates to useNexusWallet.
 * Kept as an export so external components can keep importing it; AppInner
 * also uses it directly.
 * ========================================================================= */
export function useAppWallet() {
  return useNexusWallet();
}

/* ============================================================================
 * NETWORK SELECTOR -- header dropdown to the LEFT of the Connect Wallet button.
 * Selecting a chain updates `headerChain` in WalletContext (persisted to
 * localStorage). SwapWidget reads this for default token pairs.
 * ========================================================================= */

const HEADER_CHAINS = [
  { id: 'solana', label: 'Solana',    symbol: 'SOL',  color: '#9945ff' },
  { id: 1,        label: 'Ethereum',  symbol: 'ETH',  color: '#627eea' },
  { id: 8453,     label: 'Base',      symbol: 'ETH',  color: '#0052ff' },
  { id: 42161,    label: 'Arbitrum',  symbol: 'ETH',  color: '#28a0f0' },
  { id: 10,       label: 'Optimism',  symbol: 'ETH',  color: '#ff0420' },
  { id: 137,      label: 'Polygon',   symbol: 'POL',  color: '#8247e5' },
  { id: 56,       label: 'BNB Chain', symbol: 'BNB',  color: '#f3ba2f' },
  { id: 43114,    label: 'Avalanche', symbol: 'AVAX', color: '#e84142' },
  { id: 59144,    label: 'Linea',     symbol: 'ETH',  color: '#000000' },
  { id: 534352,   label: 'Scroll',    symbol: 'ETH',  color: '#ffeeda' },
  { id: 5000,     label: 'Mantle',    symbol: 'MNT',  color: '#000000' },
  { id: 81457,    label: 'Blast',     symbol: 'ETH',  color: '#fcfc03' },
  { id: 324,      label: 'zkSync',    symbol: 'ETH',  color: '#1e69ff' },
  { id: 100,      label: 'Gnosis',    symbol: 'xDAI', color: '#3e6957' },
  { id: 250,      label: 'Fantom',    symbol: 'FTM',  color: '#1969ff' },
  { id: 25,       label: 'Cronos',    symbol: 'CRO',  color: '#002d74' },
  { id: 80094,    label: 'Berachain', symbol: 'BERA', color: '#814625' },
  { id: 130,      label: 'Unichain',  symbol: 'ETH',  color: '#ff007a' },
];

function NetworkSelector({ headerChain, onSelect, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(function() {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return function() { document.removeEventListener('mousedown', onDocClick); };
  }, [open]);

  const current = HEADER_CHAINS.find(function(c) { return c.id === headerChain; }) || HEADER_CHAINS[0];

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={function() { setOpen(function(v) { return !v; }); }}
        title="Select destination network"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.18)',
          borderRadius: 10, padding: compact ? '6px 8px' : '7px 12px',
          color: C.text, cursor: 'pointer',
          fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: current.color, flexShrink: 0 }} />
        <span style={{ color: '#fff' }}>{compact ? current.symbol : current.label}</span>
        <span style={{ color: C.muted, fontSize: 9 }}>v</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 220, maxHeight: 360, overflowY: 'auto',
          background: C.card, border: '1px solid rgba(0,229,255,.25)',
          borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.6)',
          zIndex: 200, padding: 6,
        }}>
          {HEADER_CHAINS.map(function(ch) {
            const active = ch.id === headerChain;
            return (
              <button
                key={String(ch.id)}
                onClick={function() { onSelect(ch.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 10px', borderRadius: 8,
                  background: active ? 'rgba(0,229,255,.08)' : 'transparent',
                  border: 'none', color: '#fff', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'Syne, sans-serif', fontSize: 13,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: ch.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{ch.label}</span>
                <span style={{ color: C.muted, fontSize: 11 }}>{ch.symbol}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * WALLET MODAL -- single state machine
 *
 * Replaces the previous (pendingWallet, connecting, connectRef) tangle that
 * caused WC1, WC3, WC5. Three states:
 *   { kind: 'idle' }
 *   { kind: 'connecting', wallet }
 *   { kind: 'error', message, wallet }
 * ========================================================================= */

const WM_INITIAL = { kind: 'idle', message: '', wallet: '' };

function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':   return { kind: 'connecting', message: '', wallet: action.wallet };
    case 'SUCCESS': return WM_INITIAL;
    case 'ERROR':   return { kind: 'error', message: action.message || 'Connection failed', wallet: state.wallet };
    case 'RESET':   return WM_INITIAL;
    default:        return state;
  }
}

function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);

  const { wallet: selectedWallet, select, wallets, connect, disconnect, connected, publicKey } = useWallet();
  const { open: openWeb3Modal } = useWeb3Modal();
  const { isConnected: evmConnected, address: evmAddress } = useAccount();
  const { disconnect: evmDisconnect } = useDisconnect();

  // Reset state machine when the modal closes externally -- otherwise next
  // open shows leftover error or stuck "connecting" state (WC3).
  useEffect(function() {
    if (!open) dispatch({ type: 'RESET' });
  }, [open]);

  // Auto-close once the SPECIFIC wallet they picked actually connects.
  // Checking generic isConnected was the WC3 source -- would close the modal
  // immediately if the user already had the OTHER wallet type connected.
  useEffect(function() {
    if (mState.kind !== 'connecting') return;
    let matched = false;
    if (mState.wallet === 'walletconnect') {
      matched = evmConnected;
    } else {
      matched = connected
        && selectedWallet
        && selectedWallet.adapter
        && selectedWallet.adapter.name === mState.wallet;
    }
    if (matched) {
      dispatch({ type: 'SUCCESS' });
      onClose();
    }
  }, [connected, evmConnected, selectedWallet, mState.kind, mState.wallet, onClose]);

  // Solana connect -- ref-based wait for select() propagation.
  // The WC1 race was: click -> select() -> connect() in the same tick, but
  // selectedWallet hadn't actually updated yet. Using a ref + an effect that
  // watches selectedWallet means we only call connect() once we can see the
  // adapter we picked.
  const targetWalletRef = useRef(null);

  useEffect(function() {
    const target = targetWalletRef.current;
    if (!target) return undefined;
    if (!selectedWallet || selectedWallet.adapter.name !== target) return undefined;
    if (mState.kind !== 'connecting' || mState.wallet !== target) return undefined;

    let cancelled = false;
    targetWalletRef.current = null;

    connect().catch(function(e) {
      if (cancelled) return;
      const raw = (e && e.message) ? e.message : 'Failed to connect wallet';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    });

    return function() { cancelled = true; };
  }, [selectedWallet, connect, mState.kind, mState.wallet]);

  const handleSolanaConnect = useCallback(function(wallet) {
    dispatch({ type: 'START', wallet: wallet.adapter.name });
    targetWalletRef.current = wallet.adapter.name;
    try {
      select(wallet.adapter.name);
    } catch (e) {
      const msg = (e && e.message) || 'Failed to select wallet';
      dispatch({ type: 'ERROR', message: msg });
      targetWalletRef.current = null;
    }
  }, [select]);

  // WC2 fix -- open Web3Modal FIRST, close our modal AFTER a small delay so
  // the open() flow isn't interrupted by parent unmount on slower devices.
  const handleWalletConnect = useCallback(function() {
    dispatch({ type: 'START', wallet: 'walletconnect' });
    try {
      openWeb3Modal({ view: 'Connect' });
      setTimeout(function() { onClose(); }, 200);
    } catch (e) {
      dispatch({ type: 'ERROR', message: 'WalletConnect failed to open' });
    }
  }, [openWeb3Modal, onClose]);

  const handleDisconnect = useCallback(async function() {
    try { if (connected) await disconnect(); } catch (e) { console.error('Sol disconnect error:', e); }
    try { if (evmConnected) evmDisconnect(); } catch (e) { console.error('EVM disconnect error:', e); }
    dispatch({ type: 'RESET' });
    onClose();
  }, [connected, disconnect, evmConnected, evmDisconnect, onClose]);

  const isSol = connected && publicKey;
  const displayAddr = isSol
    ? publicKey.toString().slice(0, 6) + '...' + publicKey.toString().slice(-4)
    : evmConnected && evmAddress
      ? evmAddress.slice(0, 6) + '...' + evmAddress.slice(-4)
      : null;
  const connectedWalletName = isSol
    ? (wallets.find(function(w) { return w.adapter.connected; })?.adapter.name ?? 'Solana')
    : 'EVM Wallet';

  const _seen = new Set();
  const detectedWallets = wallets.filter(function(w) {
    if (w.adapter.name === 'WalletConnect') return false;
    if (_seen.has(w.adapter.name)) return false;
    _seen.add(w.adapter.name);
    return w.readyState === 'Installed' || w.readyState === 'Loadable';
  });
  const notDetectedWallets = wallets.filter(function(w) {
    if (w.adapter.name === 'WalletConnect') return false;
    return !_seen.has(w.adapter.name);
  });

  const isConnecting = mState.kind === 'connecting';
  const pendingWallet = isConnecting ? mState.wallet : null;

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 501,
        background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)',
        borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 24px 16px' }}>
          <div style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 20px' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {connected || evmConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </div>
            {displayAddr && <div style={{ fontSize: 13, color: '#586994' }}>{connectedWalletName}: {displayAddr}</div>}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {(connected || evmConnected) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
                <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{displayAddr}</div>
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}>Disconnect</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {/* WC6 fix -- surface error in the UI with a Retry button */}
              {mState.kind === 'error' && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)',
                  borderRadius: 12, padding: '10px 14px',
                }}>
                  <span style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button
                    onClick={function() { dispatch({ type: 'RESET' }); }}
                    style={{
                      background: 'transparent', border: '1px solid ' + C.red,
                      color: C.red, padding: '4px 10px', borderRadius: 6,
                      fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer',
                    }}
                  >Retry</button>
                </div>
              )}
              {detectedWallets.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: '#586994', fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>DETECTED WALLETS</div>
                  {detectedWallets.map(function(wallet) {
                    const isPending = isConnecting && pendingWallet === wallet.adapter.name;
                    return (
                      <button key={wallet.adapter.name} onClick={function() { handleSolanaConnect(wallet); }} disabled={isConnecting} style={{ display: 'flex', alignItems: 'center', gap: 14, background: isPending ? 'rgba(0,229,255,.12)' : 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 14, padding: '14px 18px', cursor: isConnecting ? 'wait' : 'pointer', width: '100%', opacity: isConnecting && !isPending ? 0.5 : 1 }}>
                        {wallet.adapter.icon
                          ? <img src={wallet.adapter.icon} alt={wallet.adapter.name} style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} onError={function(e) { e.target.style.display = 'none'; }} />
                          : <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#00e5ff', flexShrink: 0 }}>{wallet.adapter.name.charAt(0)}</div>
                        }
                        <div style={{ textAlign: 'left', flex: 1 }}>
                          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{wallet.adapter.name}</div>
                          <div style={{ color: '#00e5ff', fontSize: 12, marginTop: 1 }}>{isPending ? 'Check your wallet app...' : 'Detected - tap to connect'}</div>
                        </div>
                        {isPending && <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </>
              )}
              <button onClick={handleWalletConnect} disabled={isConnecting && pendingWallet !== 'walletconnect'} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(59,153,252,.08)', border: '1px solid rgba(59,153,252,.2)', borderRadius: 14, padding: '14px 18px', cursor: 'pointer', width: '100%', opacity: isConnecting && pendingWallet !== 'walletconnect' ? 0.5 : 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg,#3b99fc,#0066cc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="https://avatars.githubusercontent.com/u/37784886" alt="WC" style={{ width: 28, height: 28, borderRadius: 6 }} onError={function(e) { e.target.style.display = 'none'; }} />
                </div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>WalletConnect</div>
                  <div style={{ color: '#3b99fc', fontSize: 12, marginTop: 1 }}>300+ wallets supported</div>
                </div>
              </button>
              {notDetectedWallets.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: '#586994', fontWeight: 700, letterSpacing: 1, margin: '6px 0 2px' }}>MORE WALLETS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {notDetectedWallets.slice(0, 6).map(function(wallet) {
                      return (
                        <button key={wallet.adapter.name} onClick={function() { window.open(wallet.adapter.url, '_blank'); onClose(); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 8px', cursor: 'pointer' }}>
                          {wallet.adapter.icon
                            ? <img src={wallet.adapter.icon} alt={wallet.adapter.name} style={{ width: 32, height: 32, borderRadius: 8 }} onError={function(e) { e.target.style.display = 'none'; }} />
                            : <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#00e5ff' }}>{wallet.adapter.name.charAt(0)}</div>
                          }
                          <div style={{ color: '#586994', fontSize: 10, textAlign: 'center', lineHeight: 1.2 }}>{wallet.adapter.name}</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IconSwap()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconMarkets()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconLaunches() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function IconLaunch()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>; }
function IconBuy()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconSend()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconWallet()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
const NAV_ICONS = { swap: IconSwap, markets: IconMarkets, launches: IconLaunches, launch: IconLaunch, buy: IconBuy, send: IconSend, portfolio: IconWallet };

// M12 fix -- single nav source. HEADER_TABS removed (was identical to NAV_TABS).
const NAV_TABS = [
  { id: 'swap',      label: 'Swap' },
  { id: 'markets',   label: 'Markets' },
  { id: 'launches',  label: 'Launches' },
  { id: 'launch',    label: 'Launch' },
  { id: 'buy',       label: 'Buy' },
  { id: 'send',      label: 'Send' },
  { id: 'portfolio', label: 'Wallet' },
];

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet = useAppWallet();
  const { headerChain, setHeaderChain } = wallet;

  const [tab, setTab] = useState(function() { return tabFromPathname(location.pathname); });
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jupiterTokens, setJupiterTokens] = useState([]);
  const [jupiterLoading, setJupiterLoading] = useState(true);
  const [launchesKey, setLaunchesKey] = useState(0);
  const [portfolioKey, setPortfolioKey] = useState(0);

  const [isMobile, setIsMobile] = useState(function() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 769;
  });
  useEffect(function() {
    let to = null;
    function onResize() {
      if (to) clearTimeout(to);
      to = setTimeout(function() { setIsMobile(window.innerWidth < 769); }, 150);
    }
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); if (to) clearTimeout(to); };
  }, []);

  useEffect(function() {
    var el = document.createElement('style');
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return function() { document.head.removeChild(el); };
  }, []);

  useEffect(function() {
    var newTab = tabFromPathname(location.pathname);
    if (newTab !== tab) { setTab(newTab); if (newTab !== 'token') setSelectedToken(null); }
  }, [location.pathname, tab]);

  const switchTab = useCallback(function(newTab) {
    if (newTab === tab && newTab !== 'token') {
      if (newTab === 'launches') setLaunchesKey(function(k) { return k + 1; });
      if (newTab === 'portfolio') setPortfolioKey(function(k) { return k + 1; });
      return;
    }
    if (newTab !== 'token') setSelectedToken(null);
    navigate(TAB_TO_PATH[newTab] || '/swap');
    setTab(newTab);
    window.scrollTo(0, 0);
  }, [tab, navigate]);

  const goToToken = useCallback(function(coin) {
    setSelectedToken(coin); setTab('token'); navigate('/markets/token'); window.scrollTo(0, 0);
  }, [navigate]);

  const goBack = function() { navigate(-1); };
  const openWallet = useCallback(function() { setWalletModalOpen(true); }, []);

  useEffect(function() {
    var isMounted = true;
    var controller = new AbortController();

    try {
      var cached = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || 'null');
      if (cached && cached.v === 2 && Date.now() - cached.ts < 300000) {
        if (cached.coins && cached.coins.length)         { setCoins(cached.coins); setLoading(false); }
        if (cached.jupTokens && cached.jupTokens.length) { setJupiterTokens(cached.jupTokens); setJupiterLoading(false); }
      }
    } catch(e) {}

    var fetchMarkets = function() {
      fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + CG_IDS + '&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d',
        { signal: controller.signal }
      )
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!isMounted || !Array.isArray(data)) return;
          setCoins(function(prev) { return data.concat(prev.filter(function(c) { return c.isSolanaToken; })); });
          setLoading(false);
          try {
            var c = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}');
            localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(Object.assign({}, c, { v: 2, coins: data, ts: Date.now() })));
          } catch(e) {}
        })
        .catch(function(e) { if (isMounted && e.name !== 'AbortError') setLoading(false); });

      fetch('https://lite-api.jup.ag/tokens/v1/tagged/strict', { signal: controller.signal })
        .then(function(r) { return r.json(); })
        .then(function(meta) {
          if (!isMounted || !Array.isArray(meta)) return;
          var jupTokens = meta.map(function(t) {
            return { mint: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.logoURI };
          });
          setJupiterTokens(jupTokens);
          setJupiterLoading(false);
          try {
            var c = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}');
            localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(Object.assign({}, c, { v: 2, jupTokens: jupTokens, ts: Date.now() })));
          } catch(e) {}
          return fetch('https://api.jup.ag/price/v2?ids=' + SOLANA_MINTS.join(','), { signal: controller.signal })
            .then(function(r) { return r.json(); })
            .then(function(jupData) {
              if (!isMounted) return;
              var metaMap = {};
              meta.forEach(function(t) { metaMap[t.address] = t; });
              var solanaCoins = SOLANA_MINTS.map(function(mint, i) {
                var priceInfo = jupData.data && jupData.data[mint];
                var m = metaMap[mint] || {};
                if (!priceInfo || !priceInfo.price) return null;
                return {
                  id: mint, symbol: m.symbol || mint.slice(0, 4), name: m.name || 'Unknown',
                  image: m.logoURI || null, current_price: parseFloat(priceInfo.price),
                  market_cap: 0, market_cap_rank: 50 + i, total_volume: 0,
                  high_24h: null, low_24h: null, price_change_percentage_1h_in_currency: null,
                  price_change_percentage_24h: null, price_change_percentage_7d_in_currency: null,
                  sparkline_in_7d: null, ath: null, ath_change_percentage: null,
                  circulating_supply: null, isSolanaToken: true,
                };
              }).filter(Boolean);
              setCoins(function(prev) { return prev.filter(function(c) { return !c.isSolanaToken; }).concat(solanaCoins); });
            });
        })
        .catch(function() {});
    };

    fetchMarkets();
    var interval = setInterval(fetchMarkets, 30000);
    return function() { isMounted = false; controller.abort(); clearInterval(interval); };
  }, []);

  var sharedProps = {
    isConnected: wallet.isConnected,
    isSolanaConnected: wallet.isSolanaConnected,
    walletAddress: wallet.walletAddress,
    solConnected: wallet.solConnected,
    evmConnected: wallet.evmConnected,
    evmAddress: wallet.evmAddress,
    publicKey: wallet.publicKey,
    onConnectWallet: openWallet,
    onBuyCrypto: function() { switchTab('buy'); },
  };
  var displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '..' + wallet.walletAddress.slice(-4)
    : null;
  var activeTab = getActiveTab(tab);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.02) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(0,229,255,0.08)', background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', height: 56, gap: 12 }}>
          <div onClick={function() { switchTab('swap'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00e5ff,#0066ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: C.bg }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{ fontSize: 9, color: C.accent, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>DEX</span>
          </div>
          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {NAV_TABS.map(function(t) {
              var active = activeTab === t.id;
              return (
                <button key={t.id} onClick={function() { switchTab(t.id); }} style={{ background: active ? 'rgba(0,229,255,.09)' : 'transparent', border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent', borderRadius: 8, padding: '5px 12px', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {t.label}
                </button>
              );
            })}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />

          <NetworkSelector
            headerChain={headerChain}
            onSelect={setHeaderChain}
            compact={isMobile}
          />

          <button onClick={openWallet} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap'      && <SwapWidget   {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} jupiterLoading={jupiterLoading} onGoToToken={goToToken} />}
        {tab === 'markets'   && <Markets      coins={coins} loading={loading} onSelectCoin={goToToken} jupiterTokens={jupiterTokens} />}
        {tab === 'token' && selectedToken && <TokenDetail {...sharedProps} coin={selectedToken} coins={coins} jupiterTokens={jupiterTokens} onBack={goBack} />}
        {tab === 'launches'  && <NewLaunches  {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} resetKey={launchesKey} />}
        {tab === 'launch'    && <TokenLaunch  {...sharedProps} />}
        {tab === 'buy'       && <BuyCrypto    {...sharedProps} coins={coins} selectedCoinSymbol={selectedToken ? selectedToken.symbol : null} />}
        {tab === 'send'      && <Send         {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} />}
        {tab === 'portfolio' && <Portfolio    {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} onSend={function() { switchTab('send'); }} refreshKey={portfolioKey} onSelectToken={goToToken} />}
      </main>

      <nav className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV_TABS.map(function(t) {
          var active = activeTab === t.id;
          var Icon = NAV_ICONS[t.id];
          return (
            <button key={t.id} onClick={function() { switchTab(t.id); }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54, position: 'relative' }}>
              {active && <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />}
              {Icon && <Icon />}
              <span>{t.label}</span>
            </button>
          );
        })}
        <button onClick={openWallet} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: wallet.isConnected ? C.green : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid ' + (wallet.isConnected ? C.green : C.muted), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {wallet.isConnected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />}
          </div>
          <span style={{ fontSize: 8 }}>{wallet.isConnected ? displayAddress : 'Connect'}</span>
        </button>
      </nav>

      <WalletModal open={walletModalOpen} onClose={function() { setWalletModalOpen(false); }} />

      {tab !== 'buy' && (
        <button onClick={function() { switchTab('buy'); }} style={{ position: 'fixed', bottom: 80, right: 16, zIndex: 200, background: 'linear-gradient(135deg,#00e5ff,#0055ff)', border: 'none', borderRadius: 20, padding: '10px 16px', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,229,255,.35)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Buy Crypto
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
