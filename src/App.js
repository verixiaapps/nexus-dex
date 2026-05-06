import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useConnect } from 'wagmi';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget from './components/SwapWidget.jsx';
import Markets from './components/Markets.js';
import Portfolio from './components/Portfolio.js';
import TokenDetail from './components/TokenDetail.js';
import Send from './components/Send.js';
import NewLaunches from './components/NewLaunches.js';
import TokenLaunch from './components/TokenLaunch.js';
 
/* ============================================================================
 * App.js - locked plan applied:
 *
 * Wallet modal is policy-driven. WalletContext.walletPolicy.allowed is the
 * single source of truth for which options render.
 *
 *   Desktop:                  Privy + Phantom + Solflare + WalletConnect
 *   Mobile in Phantom app:    Phantom only
 *   Mobile in Solflare app:   Solflare only
 *   Mobile in any EVM app:    Injected (browser wallet) only
 *   Mobile plain Safari/etc.: Privy ONLY
 *
 * The mobile-browser-only-Privy choice is what stops the redirect-back-to-
 * Phantom loop that was eating user sessions on iOS Safari.
 *
 * All transactions stay on-site. The only off-site step is the wallet's
 * own approval prompt (or for Privy embedded, an in-page prompt).
 * ========================================================================= */

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
  privy: '#a855f7',
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

const MARKET_CACHE_KEY = 'nexus_market_cache_v2';
const MARKET_POLL_MS   = 30_000;

// All third-party APIs go through our backend proxy. Rate limits hit our
// server's single IP rather than the user's (which on mobile often shares
// CGNAT and gets throttled aggressively by free-tier APIs).
const COINGECKO_MARKETS_URL = '/api/coingecko/coins/markets';
const JUPITER_TOKENS_URL    = '/api/jupiter/tokens/v1/tagged/strict';
const JUPITER_PRICE_URL     = '/api/jupiter/price/v2';

const GLOBAL_STYLES = `html,body{ margin:0;padding:0;width:100%; min-height:100vh; min-height:100dvh; overflow-x:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; } body{ -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; } body.nexus-scroll-locked{ overflow:hidden !important; } #root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; } *,*::before,*::after{box-sizing:border-box;} *{ -webkit-tap-highlight-color:transparent; } button,a,[role="button"]{ touch-action:manipulation; } input,button,select,textarea{ font-family:'Syne',sans-serif; font-size:16px; } input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; } ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} .scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}} @keyframes wc-spin { to { transform: rotate(360deg); } }`;

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/markets': 'markets',
  '/launches': 'launches', '/launch': 'launch',
  '/send': 'send', '/portfolio': 'portfolio',
};
const TAB_TO_PATH = {
  swap: '/swap', markets: '/markets', launches: '/launches',
  launch: '/launch', send: '/send', portfolio: '/portfolio',
};

function tabFromPathname(pathname) {
  return PATH_TO_TAB[pathname] || (pathname.startsWith('/markets/token') ? 'token' : 'swap');
}
function getActiveTab(tab) {
  return tab === 'token' ? 'markets' : tab;
}

export function useAppWallet() {
  return useNexusWallet();
}

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
    document.addEventListener('touchstart', onDocClick, { passive: true });
    return function() {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
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

function WalletIcon({ src, fallbackLetter, color, size }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div style={{
        width: size, height: size,
        borderRadius: Math.round(size / 4),
        background: (color || '#586994') + '33',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.42), fontWeight: 800,
        color: color || '#fff', flexShrink: 0,
      }}>
        {(fallbackLetter || '?').toString().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={fallbackLetter || ''}
      style={{
        width: size, height: size,
        borderRadius: Math.round(size / 4),
        flexShrink: 0, background: '#fff',
      }}
      onError={function() { setErrored(true); }}
    />
  );
}

const WC_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3b99fc"/><path d="M11 16.5c5-4.7 13-4.7 18 0l.6.6c.3.2.3.7 0 1l-2 2c-.2.2-.4.2-.5 0l-.9-.8c-3.5-3.3-9-3.3-12.4 0l-1 .9c-.1.1-.3.1-.5 0l-2-2c-.2-.3-.2-.7 0-1l.7-.7zm22.3 4.1l1.8 1.8c.3.2.3.7 0 1l-8 8c-.3.2-.7.2-1 0l-5.7-5.7c0-.1-.2-.1-.3 0l-5.7 5.7c-.2.2-.7.2-1 0l-8-8c-.3-.3-.3-.7 0-1l1.7-1.8c.3-.2.7-.2 1 0l5.7 5.7c.1.1.3.1.4 0l5.7-5.7c.2-.2.7-.2 1 0l5.6 5.7c.1.1.3.1.4 0l5.7-5.7c.2-.2.7-.2 1 0z" fill="#fff"/></svg>'
);

const PRIVY_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#a855f7"/><path d="M8 14l12 8 12-8v14H8V14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M8 14h24v0L20 22 8 14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
);

/**
 * Wagmi v2 + EIP-6963: connectors include both the explicit `injected()`
 * connector (id 'injected') and any wallets the browser announced via
 * EIP-6963 (id like 'io.metamask', 'app.phantom', 'com.coinbase.wallet').
 * Prefer the EIP-6963 connector - its name and icon come from the wallet
 * itself rather than being generic "Injected".
 */
function pickInjectedConnector(connectors) {
  const list = (connectors || []).filter(function(c) {
    return c && c.id !== 'walletConnect' && c.id !== 'walletConnectSDK';
  });
  if (!list.length) return null;
  const eip6963 = list.find(function(c) {
    return c.id !== 'injected' && (c.icon || (c.name && c.name !== 'Injected'));
  });
  if (eip6963) return eip6963;
  return list.find(function(c) { return c.id === 'injected'; }) || list[0];
}

const WM_INITIAL = { kind: 'idle', message: '', wallet: '', target: '' };

function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':   return { kind: 'connecting', message: '', wallet: action.wallet, target: action.target || '' };
    case 'SUCCESS': return WM_INITIAL;
    case 'ERROR':   return { kind: 'error', message: action.message || 'Connection failed', wallet: state.wallet, target: state.target };
    case 'RESET':   return WM_INITIAL;
    default:        return state;
  }
}

function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);

  const nexus = useNexusWallet();
  const {
    walletPolicy,
    privyReady, privyAuthenticated, privyUser,
    privyEmbeddedSol, privyEmbeddedEvm,
    loginPrivy, disconnectAll,
    isConnected: nexusConnected,
    extSolConnected, extSolPublicKey,
    extEvmConnected, extEvmAddress,
    walletAddress, connectedWalletName,
  } = nexus;

  const { wallet: selectedWallet, select, wallets, connect: solConnect } = useWallet();
  const { connectAsync: evmConnectAsync, connectors: evmConnectorsRaw } = useConnect();
  const { isConnected: evmConnectedFromAccount } = useAccount();

  const phantomWallet  = wallets.find(function(w) { return w.adapter.name === 'Phantom';  });
  const solflareWallet = wallets.find(function(w) { return w.adapter.name === 'Solflare'; });

  const walletConnectConnector = (evmConnectorsRaw || []).find(function(c) {
    return c && (c.id === 'walletConnect' || c.id === 'walletConnectSDK');
  });
  const injectedConnector = pickInjectedConnector(evmConnectorsRaw);

  useEffect(function() {
    if (!open) dispatch({ type: 'RESET' });
  }, [open]);

  useEffect(function() {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    document.body.classList.add('nexus-scroll-locked');
    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) onClose();
    }
    window.addEventListener('keydown', onKey);
    return function() {
      document.body.classList.remove('nexus-scroll-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(function() {
    if (mState.kind !== 'connecting') return;
    let matched = false;
    if (mState.target === 'evm') {
      matched = evmConnectedFromAccount;
    } else if (mState.target === 'privy') {
      matched = privyAuthenticated;
    } else if (mState.target === 'solana') {
      matched = extSolConnected
        && selectedWallet
        && selectedWallet.adapter
        && selectedWallet.adapter.name === mState.wallet;
    }
    if (matched) {
      dispatch({ type: 'SUCCESS' });
      onClose();
    }
  }, [
    extSolConnected, evmConnectedFromAccount, privyAuthenticated,
    selectedWallet, mState.kind, mState.wallet, mState.target, onClose,
  ]);

  const targetWalletRef = useRef(null);

  useEffect(function() {
    const target = targetWalletRef.current;
    if (!target) return undefined;
    if (!selectedWallet || selectedWallet.adapter.name !== target) return undefined;
    if (mState.kind !== 'connecting' || mState.wallet !== target) return undefined;

    let cancelled = false;
    targetWalletRef.current = null;

    solConnect().catch(function(e) {
      if (cancelled) return;
      const raw = (e && e.message) ? e.message : 'Failed to connect wallet';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    });

    return function() { cancelled = true; };
  }, [selectedWallet, solConnect, mState.kind, mState.wallet]);

  const handleSolanaConnect = useCallback(function(wallet) {
    if (!wallet || !wallet.adapter) {
      dispatch({ type: 'ERROR', message: 'Wallet adapter unavailable. Refresh and try again.' });
      return;
    }
    dispatch({ type: 'START', wallet: wallet.adapter.name, target: 'solana' });
    targetWalletRef.current = wallet.adapter.name;
    try { select(wallet.adapter.name); }
    catch (e) {
      const msg = (e && e.message) || 'Failed to select wallet';
      dispatch({ type: 'ERROR', message: msg });
      targetWalletRef.current = null;
    }
  }, [select]);

  const handleWalletConnect = useCallback(async function() {
    if (!walletConnectConnector) {
      dispatch({ type: 'ERROR', message: 'WalletConnect not configured. Set REACT_APP_REOWN_PROJECT_ID and rebuild.' });
      return;
    }
    dispatch({ type: 'START', wallet: 'WalletConnect', target: 'evm' });
    try { await evmConnectAsync({ connector: walletConnectConnector }); }
    catch (e) {
      const raw = (e && e.message) ? e.message : 'Failed to connect wallet';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    }
  }, [evmConnectAsync, walletConnectConnector]);

  const handleInjectedConnect = useCallback(async function() {
    if (!injectedConnector) {
      dispatch({ type: 'ERROR', message: 'No injected wallet detected in this browser.' });
      return;
    }
    const name = injectedConnector.name || 'Wallet';
    dispatch({ type: 'START', wallet: name, target: 'evm' });
    try { await evmConnectAsync({ connector: injectedConnector }); }
    catch (e) {
      const raw = (e && e.message) ? e.message : 'Failed to connect wallet';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    }
  }, [evmConnectAsync, injectedConnector]);

  const handlePrivyLogin = useCallback(function() {
    if (!privyReady) {
      dispatch({ type: 'ERROR', message: 'Email login is not configured. Set REACT_APP_PRIVY_APP_ID and rebuild.' });
      return;
    }
    dispatch({ type: 'START', wallet: 'Email / Social', target: 'privy' });
    try { loginPrivy(); }
    catch (e) {
      const msg = (e && e.message) || 'Failed to open login';
      dispatch({ type: 'ERROR', message: msg });
    }
  }, [privyReady, loginPrivy]);

  const handleDisconnect = useCallback(async function() {
    try { await disconnectAll(); } catch (e) { console.error('Disconnect error:', e); }
    dispatch({ type: 'RESET' });
    onClose();
  }, [disconnectAll, onClose]);

  const optionDefs = {
    privy: {
      key: 'privy', name: 'Continue with email',
      subtitle: 'Email, Google, Apple, passkey - no seed phrase',
      color: C.privy, icon: PRIVY_LOGO, ready: privyReady,
      pendingMatch: 'Email / Social', onClick: handlePrivyLogin,
    },
    phantom: {
      key: 'phantom', name: 'Phantom', subtitle: 'Solana wallet',
      color: '#ab9ff2', icon: phantomWallet && phantomWallet.adapter.icon,
      ready: !!phantomWallet, pendingMatch: 'Phantom',
      onClick: function() { handleSolanaConnect(phantomWallet); },
    },
    solflare: {
      key: 'solflare', name: 'Solflare', subtitle: 'Solana wallet',
      color: '#fc9533', icon: solflareWallet && solflareWallet.adapter.icon,
      ready: !!solflareWallet, pendingMatch: 'Solflare',
      onClick: function() { handleSolanaConnect(solflareWallet); },
    },
    walletconnect: {
      key: 'walletconnect', name: 'WalletConnect',
      subtitle: 'MetaMask, Trust, Rainbow & 600+ wallets',
      color: '#3b99fc', icon: WC_LOGO, ready: !!walletConnectConnector,
      pendingMatch: 'WalletConnect', onClick: handleWalletConnect,
    },
    injected: {
      key: 'injected',
      name: (injectedConnector && injectedConnector.name) || 'Browser Wallet',
      subtitle: 'Use the wallet you opened this site with',
      color: '#00e5ff', icon: injectedConnector && injectedConnector.icon,
      ready: !!injectedConnector,
      pendingMatch: (injectedConnector && injectedConnector.name) || 'Wallet',
      onClick: handleInjectedConnect,
    },
  };

  const allowedKinds = (walletPolicy && walletPolicy.allowed) || [];
  const allowedOpts = allowedKinds.map(function(k) { return optionDefs[k]; }).filter(Boolean);
  const primaryOption = allowedOpts.find(function(o) { return o.key === 'privy'; });
  const secondaryOptions = allowedOpts.filter(function(o) { return o.key !== 'privy'; });

  const isConnecting = mState.kind === 'connecting';
  const pendingWallet = isConnecting ? mState.wallet : null;
  const anyConnected = nexusConnected || privyAuthenticated;

  const displayAddr = walletAddress
    ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4)
    : null;

  const privyHandle = privyUser && (
    (privyUser.email && privyUser.email.address) ||
    (privyUser.google && privyUser.google.email) ||
    (privyUser.apple && privyUser.apple.email) ||
    (privyUser.twitter && (privyUser.twitter.username ? '@' + privyUser.twitter.username : null)) ||
    (privyUser.discord && privyUser.discord.username) ||
    null
  );

  const showPrivyHandle = privyAuthenticated && !extSolConnected && !extEvmConnected;
  const showWalletAppHint =
    !anyConnected && walletPolicy &&
    walletPolicy.environment === 'mobile-browser' && privyReady;
  const privyMissingOnMobile =
    !anyConnected && walletPolicy &&
    walletPolicy.environment === 'mobile-browser' && !privyReady;

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 501,
        background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)',
        borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: 'min(85vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 24px 16px' }}>
          <div onClick={onClose} role="button" aria-label="Close"
            style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 20px', cursor: 'pointer', padding: '8px 0', boxSizing: 'content-box' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {anyConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </div>
            {displayAddr && (
              <div style={{ fontSize: 13, color: '#586994' }}>
                {(connectedWalletName || 'Wallet')}: {displayAddr}
              </div>
            )}
            {privyHandle && showPrivyHandle && (
              <div style={{ fontSize: 12, color: C.privy, marginTop: 2 }}>{privyHandle}</div>
            )}
            {!anyConnected && !privyMissingOnMobile && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                Pick one. We never see your keys.
              </div>
            )}
          </div>
        </div>

        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {anyConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
                <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {displayAddr || '(provisioning wallet...)'}
                </div>
                {privyEmbeddedSol && privyEmbeddedSol.address && extSolPublicKey && (privyEmbeddedSol.address !== extSolPublicKey.toString()) && (
                  <div style={{ color: C.privy, fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>
                    + Privy SOL: {privyEmbeddedSol.address.slice(0, 6)}...{privyEmbeddedSol.address.slice(-4)}
                  </div>
                )}
                {privyEmbeddedEvm && privyEmbeddedEvm.address && extEvmAddress && (privyEmbeddedEvm.address.toLowerCase() !== extEvmAddress.toLowerCase()) && (
                  <div style={{ color: C.privy, fontSize: 11, marginTop: 4, fontFamily: 'monospace' }}>
                    + Privy EVM: {privyEmbeddedEvm.address.slice(0, 6)}...{privyEmbeddedEvm.address.slice(-4)}
                  </div>
                )}
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}>Disconnect</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {mState.kind === 'error' && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)',
                  borderRadius: 12, padding: '10px 14px',
                }}>
                  <span style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={function() { dispatch({ type: 'RESET' }); }}
                    style={{ background: 'transparent', border: '1px solid ' + C.red, color: C.red, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                </div>
              )}

              {privyMissingOnMobile && (
                <div style={{
                  background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)',
                  borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5,
                }}>
                  Email login isn't configured. To use this site on mobile, open
                  it from inside your wallet app's browser (Phantom, Solflare,
                  MetaMask, Coinbase, Trust, etc.).
                </div>
              )}

              {primaryOption && (function() {
                var opt = primaryOption;
                var isPending = isConnecting && pendingWallet === opt.pendingMatch;
                var disabled = isConnecting || !opt.ready;
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: isPending
                        ? 'linear-gradient(135deg, rgba(150,93,232,.35), rgba(0,229,255,.25))'
                        : 'linear-gradient(135deg, rgba(150,93,232,.20), rgba(0,229,255,.12))',
                      border: '1.5px solid ' + (isPending ? C.privy : 'rgba(150,93,232,.5)'),
                      borderRadius: 16, padding: '18px 20px',
                      cursor: disabled ? (isConnecting ? 'wait' : 'not-allowed') : 'pointer',
                      width: '100%',
                      opacity: (isConnecting && !isPending) || !opt.ready ? 0.55 : 1,
                      transition: 'background .15s, border-color .15s',
                      boxShadow: '0 4px 24px rgba(150,93,232,.15)',
                    }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={44} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>{opt.name}</div>
                      <div style={{ color: opt.color, fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isPending ? 'Check your wallet...' : (opt.ready ? opt.subtitle : 'Loading...')}
                      </div>
                    </div>
                    {isPending && (
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%',
                        border: '2px solid ' + C.privy, borderTopColor: 'transparent',
                        animation: 'wc-spin 0.8s linear infinite', flexShrink: 0,
                      }} />
                    )}
                  </button>
                );
              })()}

              {primaryOption && secondaryOptions.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 4px' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.08)' }} />
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                    Already have a wallet?
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.08)' }} />
                </div>
              )}

              {secondaryOptions.map(function(opt) {
                const isPending = isConnecting && pendingWallet === opt.pendingMatch;
                const disabled = isConnecting || !opt.ready;
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: isPending ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.025)',
                      border: '1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)'),
                      borderRadius: 12, padding: '11px 14px',
                      cursor: disabled ? (isConnecting ? 'wait' : 'not-allowed') : 'pointer',
                      width: '100%',
                      opacity: (isConnecting && !isPending) || !opt.ready ? 0.55 : 1,
                      transition: 'background .15s, border-color .15s',
                    }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={32} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{opt.name}</div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isPending ? 'Check your wallet...' : (opt.ready ? opt.subtitle : 'Unavailable')}
                      </div>
                    </div>
                    {isPending && (
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%',
                        border: '2px solid #00e5ff', borderTopColor: 'transparent',
                        animation: 'wc-spin 0.8s linear infinite', flexShrink: 0,
                      }} />
                    )}
                  </button>
                );
              })}

              {showWalletAppHint && (
                <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                  Have Phantom or Solflare? Open this page from inside your
                  wallet's in-app browser to use it.
                </div>
              )}

              <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>
                Non-custodial. We never see or store your keys. You stay on
                {' '}<span style={{ color: C.text }}>swap.verixiaapps.com</span>
                {' '}the entire time.
              </div>
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
function IconSend()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconWallet()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
const NAV_ICONS = { swap: IconSwap, markets: IconMarkets, launches: IconLaunches, launch: IconLaunch, send: IconSend, portfolio: IconWallet };

const NAV_TABS = [
  { id: 'swap',      label: 'Swap' },
  { id: 'markets',   label: 'Markets' },
  { id: 'launches',  label: 'Launches' },
  { id: 'launch',    label: 'Launch' },
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

  const goBack = useCallback(function() { navigate(-1); }, [navigate]);
  const openWallet = useCallback(function() { setWalletModalOpen(true); }, []);

  /* -- markets fetch (all via backend proxy) -- */

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

    var cacheBuf = { v: 2, coins: [], jupTokens: [], ts: 0 };
    try {
      var existing = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}');
      if (existing && existing.v === 2) {
        cacheBuf.coins     = existing.coins     || [];
        cacheBuf.jupTokens = existing.jupTokens || [];
      }
    } catch(e) {}
    var flushCache = function() {
      try {
        cacheBuf.ts = Date.now();
        localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(cacheBuf));
      } catch(e) {}
    };

    var mergeCoins = function(cgList, prevList) {
      var seen = new Set();
      var merged = [];
      cgList.forEach(function(c) {
        if (!c || !c.id || seen.has(c.id)) return;
        seen.add(c.id); merged.push(c);
      });
      prevList.forEach(function(c) {
        if (!c || !c.isSolanaToken) return;
        if (c.id && seen.has(c.id)) return;
        if (c.id) seen.add(c.id);
        merged.push(c);
      });
      return merged;
    };

    var fetchCoinGecko = function() {
      return fetch(
        COINGECKO_MARKETS_URL + '?vs_currency=usd&ids=' + encodeURIComponent(CG_IDS) + '&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d',
        { signal: controller.signal }
      )
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!isMounted || !Array.isArray(data)) return;
          setCoins(function(prev) { return mergeCoins(data, prev); });
          setLoading(false);
          cacheBuf.coins = data;
          flushCache();
        })
        .catch(function(e) {
          if (isMounted && (!e || e.name !== 'AbortError')) setLoading(false);
        });
    };

    var fetchJupiter = function() {
      return fetch(JUPITER_TOKENS_URL, { signal: controller.signal })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(meta) {
          if (!isMounted) return null;
          if (!Array.isArray(meta)) {
            setJupiterLoading(false);
            return null;
          }
          var jupTokens = meta.map(function(t) {
            return { mint: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.logoURI };
          });
          setJupiterTokens(jupTokens);
          setJupiterLoading(false);
          cacheBuf.jupTokens = jupTokens;
          flushCache();
          return meta;
        })
        .catch(function() {
          if (isMounted) setJupiterLoading(false);
          return null;
        })
        .then(function(meta) {
          if (!meta || !isMounted) return;
          return fetch(JUPITER_PRICE_URL + '?ids=' + SOLANA_MINTS.join(','), { signal: controller.signal })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(jupData) {
              if (!isMounted || !jupData || !jupData.data) return;
              var metaMap = {};
              meta.forEach(function(t) { metaMap[t.address] = t; });
              var solanaCoins = SOLANA_MINTS.map(function(mint, i) {
                var priceInfo = jupData.data[mint];
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
              setCoins(function(prev) {
                var solIds = new Set(solanaCoins.map(function(c) { return c.id; }));
                var keepers = prev.filter(function(c) {
                  if (!c.isSolanaToken) return true;
                  return !solIds.has(c.id);
                });
                return keepers.concat(solanaCoins);
              });
            })
            .catch(function() { /* non-fatal */ });
        });
    };

    var fetchAll = function() {
      fetchCoinGecko();
      fetchJupiter();
    };

    fetchAll();

    var interval = null;
    var startPolling = function() {
      if (interval) return;
      interval = setInterval(fetchAll, MARKET_POLL_MS);
    };
    var stopPolling = function() {
      if (interval) { clearInterval(interval); interval = null; }
    };
    startPolling();

    var onVis = function() {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        fetchAll();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return function() {
      isMounted = false;
      controller.abort();
      stopPolling();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  var sharedProps = {
    isConnected: wallet.isConnected,
    isSolanaConnected: wallet.isSolanaConnected,
    walletAddress: wallet.walletAddress,
    solConnected: wallet.solConnected,
    evmConnected: wallet.evmConnected,
    evmAddress: wallet.evmAddress,
    publicKey: wallet.publicKey,
    activeContext: wallet.activeContext,
    setActiveContext: wallet.setActiveContext,
    activeWalletKind: wallet.activeWalletKind,
    privyAuthenticated: wallet.privyAuthenticated,
    privyEmbeddedSol: wallet.privyEmbeddedSol,
    privyEmbeddedEvm: wallet.privyEmbeddedEvm,
    onConnectWallet: openWallet,
  };

  var displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4)
    : null;

  var activeTab = getActiveTab(tab);

  var renderContextToggle = function() {
    if (!wallet.isConnected) return null;
    var both = wallet.solConnected && wallet.evmConnected;
    var ctx = wallet.activeContext || (wallet.solConnected ? 'solana' : 'evm');
    var label = ctx === 'solana' ? 'SOL' : 'EVM';
    var color = ctx === 'solana' ? '#9945ff' : '#627eea';
    return (
      <button
        onClick={function() {
          if (!both) return;
          wallet.setActiveContext(ctx === 'solana' ? 'evm' : 'solana');
        }}
        title={both ? 'Tap to switch active wallet' : ('Active: ' + label)}
        disabled={!both}
        style={{
          flexShrink: 0,
          background: 'rgba(255,255,255,.04)',
          border: '1px solid ' + color, color: color,
          borderRadius: 8, padding: '5px 8px',
          fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 10,
          letterSpacing: 1, cursor: both ? 'pointer' : 'default',
        }}>
        {label}{both ? ' <->' : ''}
      </button>
    );
  };

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%' }}>
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

          <NetworkSelector headerChain={headerChain} onSelect={setHeaderChain} compact={isMobile} />

          <button onClick={openWallet} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>

          {renderContextToggle()}
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap'      && <SwapWidget   {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} jupiterLoading={jupiterLoading} onGoToToken={goToToken} />}
        {tab === 'markets'   && <Markets      coins={coins} loading={loading} onSelectCoin={goToToken} jupiterTokens={jupiterTokens} />}
        {tab === 'token' && selectedToken && <TokenDetail {...sharedProps} coin={selectedToken} coins={coins} jupiterTokens={jupiterTokens} onBack={goBack} />}
        {tab === 'launches'  && <NewLaunches  {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} resetKey={launchesKey} />}
        {tab === 'launch'    && <TokenLaunch  {...sharedProps} />}
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
