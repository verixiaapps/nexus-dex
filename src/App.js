import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget from './components/SwapWidget.jsx';
import Markets from './components/Markets.js';
import Portfolio from './components/Portfolio.js';
import TokenDetail from './components/TokenDetail.js';
import Send from './components/Send.js';
import NewLaunches from './components/NewLaunches.js';
import TokenLaunch from './components/TokenLaunch.js';
import PerpsLanding from './components/PerpsLanding.jsx';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
  privy: '#a855f7',
};

const MARKET_CACHE_KEY = 'nexus_market_cache_v4';
const MARKET_POLL_MS   = 30_000;

const JUPITER_MARKETS_URL  = '/api/jupiter/tokens/v2/toporganicscore/24h?limit=100';
const JUPITER_REGISTRY_URL = '/api/jupiter/tokens/v2/tag?query=verified';

const GLOBAL_STYLES = `html,body{ margin:0;padding:0;width:100%; min-height:100vh; min-height:100dvh; overflow-x:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; } body{ -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; } body.nexus-scroll-locked{ overflow:hidden !important; } #root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; } *,*::before,*::after{box-sizing:border-box;} *{ -webkit-tap-highlight-color:transparent; } button,a,[role="button"]{ touch-action:manipulation; } input,button,select,textarea{ font-family:'Syne',sans-serif; font-size:16px; } input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; } ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} .scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}} @keyframes wc-spin { to { transform: rotate(360deg); } }`;

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/markets': 'markets',
  '/launches': 'launches', '/launch': 'launch',
  '/send': 'send', '/portfolio': 'portfolio', '/perps': 'perps',
};
const TAB_TO_PATH = {
  swap: '/swap', markets: '/markets', launches: '/launches',
  launch: '/launch', send: '/send', portfolio: '/portfolio', perps: '/perps',
};

function tabFromPathname(pathname) { return PATH_TO_TAB[pathname] || (pathname.startsWith('/markets/token') ? 'token' : 'swap'); }
function getActiveTab(tab) { return tab === 'token' ? 'markets' : tab; }

export function useAppWallet() { return useNexusWallet(); }

function WalletIcon({ src, fallbackLetter, color, size }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (<div style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: (color || '#586994') + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.42), fontWeight: 800, color: color || '#fff', flexShrink: 0 }}>{(fallbackLetter || '?').toString().charAt(0).toUpperCase()}</div>);
  }
  return (<img src={src} alt={fallbackLetter || ''} style={{ width: size, height: size, borderRadius: Math.round(size / 4), flexShrink: 0, background: '#fff' }} onError={function() { setErrored(true); }} />);
}

const WC_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3b99fc"/><path d="M11 16.5c5-4.7 13-4.7 18 0l.6.6c.3.2.3.7 0 1l-2 2c-.2.2-.4.2-.5 0l-.9-.8c-3.5-3.3-9-3.3-12.4 0l-1 .9c-.1.1-.3.1-.5 0l-2-2c-.2-.3-.2-.7 0-1l.7-.7zm22.3 4.1l1.8 1.8c.3.2.3.7 0 1l-8 8c-.3.2-.7.2-1 0l-5.7-5.7c0-.1-.2-.1-.3 0l-5.7 5.7c-.2.2-.7.2-1 0l-8-8c-.3-.3-.3-.7 0-1l1.7-1.8c.3-.2.7-.2 1 0l5.7 5.7c.1.1.3.1.4 0l5.7-5.7c.2-.2.7-.2 1 0l5.6 5.7c.1.1.3.1.4 0l5.7-5.7c.2-.2.7-.2 1 0z" fill="#fff"/></svg>');
const PRIVY_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#a855f7"/><path d="M8 14l12 8 12-8v14H8V14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M8 14h24v0L20 22 8 14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>');

const CONNECTION_TIMEOUT_MS = 15000;

const WM_INITIAL = { kind: 'idle', message: '', wallet: '', target: '' };
function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':   return { kind: 'connecting', message: '', wallet: action.wallet, target: action.target || '' };
    case 'TIMEOUT': return { kind: 'timeout', message: 'Taking too long? Check your wallet app and try again.', wallet: state.wallet, target: state.target };
    case 'SUCCESS': return WM_INITIAL;
    case 'ERROR':   return { kind: 'error', message: action.message || 'Connection failed', wallet: state.wallet, target: state.target };
    case 'RESET':   return WM_INITIAL;
    default:        return state;
  }
}

function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);
  const nexus = useNexusWallet();
  const { walletPolicy, privyReady, privyAuthenticated, privyUser, privyEmbeddedSol, loginPrivy, disconnectAll,
    isConnected: nexusConnected, extSolConnected, extEvmConnected, walletAddress, connectedWalletName } = nexus;
  const { wallet: selectedWallet, select, wallets, connect: solConnect } = useWallet();
  const { connectAsync: evmConnectAsync, connectors: evmConnectorsRaw } = useConnect();
  const { disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const { isConnected: evmConnectedFromAccount } = useAccount();

  const connectionTimerRef = useRef(null);
  const wcCleanupRef = useRef(false);

  const phantomWallet  = wallets.find(function(w) { return w.adapter.name === 'Phantom'; });
  const solflareWallet = wallets.find(function(w) { return w.adapter.name === 'Solflare'; });
  const backpackWallet  = wallets.find(function(w) { return w.adapter.name === 'Backpack'; });
  const walletConnectConnector = (evmConnectorsRaw || []).find(function(c) { return c && (c.id === 'walletConnect' || c.id === 'walletConnectSDK'); });

  // Pre-render detection: check which wallets are actually available
  const walletAvailability = {
    phantom: !!phantomWallet,
    solflare: !!solflareWallet,
    backpack: !!backpackWallet,
    walletconnect: !!walletConnectConnector,
    privy: privyReady,
  };

  useEffect(function() {
    if (!open) {
      dispatch({ type: 'RESET' });
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
    }
  }, [open]);

  useEffect(function() {
    if (!open) return;
    document.body.classList.add('nexus-scroll-locked');
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 27) onClose(); }
    window.addEventListener('keydown', onKey);
    return function() { document.body.classList.remove('nexus-scroll-locked'); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  // Clear connection timer on unmount
  useEffect(function() {
    return function() { if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; } };
  }, []);

  // Watch for connection success
  useEffect(function() {
    if (mState.kind !== 'connecting') return;
    let matched = false;
    if (mState.target === 'evm') matched = evmConnectedFromAccount;
    else if (mState.target === 'privy') matched = privyAuthenticated;
    else if (mState.target === 'solana') matched = extSolConnected && selectedWallet && selectedWallet.adapter && selectedWallet.adapter.name === mState.wallet;
    if (matched) {
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
      dispatch({ type: 'SUCCESS' });
      onClose();
    }
  }, [extSolConnected, evmConnectedFromAccount, privyAuthenticated, selectedWallet, mState.kind, mState.wallet, mState.target, onClose]);

  const targetWalletRef = useRef(null);
  useEffect(function() {
    const target = targetWalletRef.current;
    if (!target) return;
    if (!selectedWallet || selectedWallet.adapter.name !== target) return;
    if (mState.kind !== 'connecting' || mState.wallet !== target) return;
    let cancelled = false; targetWalletRef.current = null;
    solConnect().catch(function(e) {
      if (cancelled) return;
      const raw = (e && e.message) ? e.message : 'Failed to connect wallet';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    });
    return function() { cancelled = true; };
  }, [selectedWallet, solConnect, mState.kind, mState.wallet]);

  const startConnectionTimer = function(walletName) {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = setTimeout(function() {
      dispatch({ type: 'TIMEOUT' });
    }, CONNECTION_TIMEOUT_MS);
  };

  const handleSolanaConnect = useCallback(function(wallet) {
    if (!wallet || !wallet.adapter) { dispatch({ type: 'ERROR', message: 'Wallet not detected. Please install the extension.' }); return; }
    dispatch({ type: 'START', wallet: wallet.adapter.name, target: 'solana' });
    startConnectionTimer(wallet.adapter.name);
    targetWalletRef.current = wallet.adapter.name;
    try { select(wallet.adapter.name); }
    catch (e) { dispatch({ type: 'ERROR', message: 'Failed to open wallet. Try refreshing the page.' }); targetWalletRef.current = null; }
  }, [select]);

  // WalletConnect with stale session cleanup
  const handleWalletConnect = useCallback(async function() {
    if (!walletConnectConnector) { dispatch({ type: 'ERROR', message: 'WalletConnect not configured.' }); return; }
    dispatch({ type: 'START', wallet: 'WalletConnect', target: 'evm' });
    startConnectionTimer('WalletConnect');
    try {
      // Kill stale WC sessions first
      if (!wcCleanupRef.current) {
        try { await evmDisconnectAsync(); } catch {}
        wcCleanupRef.current = true;
      }
      await evmConnectAsync({ connector: walletConnectConnector });
    } catch (e) {
      const raw = (e && e.message) ? e.message : 'Failed';
      const msg = /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw;
      dispatch({ type: 'ERROR', message: msg });
    }
  }, [evmConnectAsync, walletConnectConnector, evmDisconnectAsync]);

  const handlePrivyLogin = useCallback(function() {
    if (!privyReady) { dispatch({ type: 'ERROR', message: 'Email login not configured.' }); return; }
    dispatch({ type: 'START', wallet: 'Email / Social', target: 'privy' });
    startConnectionTimer('Email / Social');
    try { loginPrivy(); }
    catch (e) { dispatch({ type: 'ERROR', message: (e && e.message) || 'Failed to open login' }); }
  }, [privyReady, loginPrivy]);

  const handleDisconnect = useCallback(async function() {
    try { await disconnectAll(); } catch (e) { console.error('Disconnect error:', e); }
    dispatch({ type: 'RESET' }); onClose();
  }, [disconnectAll, onClose]);

  const handleRetry = function() {
    dispatch({ type: 'RESET' });
  };

  // Build wallet options in priority order, respecting availability
  const allOptions = [
    { key: 'phantom', name: 'Phantom', subtitle: 'Solana wallet', color: '#ab9ff2', icon: phantomWallet && phantomWallet.adapter.icon, ready: walletAvailability.phantom, pendingMatch: 'Phantom', onClick: function() { handleSolanaConnect(phantomWallet); } },
    { key: 'walletconnect', name: 'WalletConnect', subtitle: 'MetaMask, Trust, Rainbow & 600+', color: '#3b99fc', icon: WC_LOGO, ready: walletAvailability.walletconnect, pendingMatch: 'WalletConnect', onClick: handleWalletConnect },
    { key: 'privy', name: 'Continue with email', subtitle: 'Email, Google, Apple, passkey', color: C.privy, icon: PRIVY_LOGO, ready: walletAvailability.privy, pendingMatch: 'Email / Social', onClick: handlePrivyLogin },
  ];

  const allowedKinds = (walletPolicy && walletPolicy.allowed) || [];
  const opts = allOptions.filter(function(o) { return allowedKinds.includes(o.key); });
  // Only show wallets that are actually available
  const availableOpts = opts.filter(function(o) { return o.ready; });
  const hasAvailableOptions = availableOpts.length > 0;

  const isConnecting = mState.kind === 'connecting';
  const isTimedOut = mState.kind === 'timeout';
  const pendingWallet = isConnecting || isTimedOut ? mState.wallet : null;
  const anyConnected = nexusConnected || privyAuthenticated;
  const displayAddr = walletAddress ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4) : null;
  const privyHandle = privyUser && ((privyUser.email && privyUser.email.address) || (privyUser.google && privyUser.google.email) || (privyUser.apple && privyUser.apple.email) || null);
  const showPrivyHandle = privyAuthenticated && !extSolConnected && !extEvmConnected;

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 520, zIndex: 501, background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)', borderRadius: '20px 20px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.9)', maxHeight: 'min(85vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '20px 24px 16px' }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 20px', cursor: 'pointer', padding: '8px 0', boxSizing: 'content-box' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{anyConnected ? 'Wallet Connected' : 'Connect Wallet'}</div>
            {displayAddr && <div style={{ fontSize: 13, color: '#586994' }}>{(connectedWalletName || 'Wallet')}: {displayAddr}</div>}
            {privyHandle && showPrivyHandle && <div style={{ fontSize: 12, color: C.privy, marginTop: 2 }}>{privyHandle}</div>}
            {!anyConnected && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Pick one. We never see your keys.</div>}
          </div>
        </div>
        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {anyConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
                <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{displayAddr || '(provisioning...)'}</div>
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}>Disconnect</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {/* Error message */}
              {mState.kind === 'error' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 12, padding: '10px 14px' }}>
                  <span style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid ' + C.red, color: C.red, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                </div>
              )}
              {/* Timeout message */}
              {isTimedOut && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(255,149,0,.10)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '10px 14px' }}>
                  <span style={{ color: '#ff9500', fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid #ff9500', color: '#ff9500', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                </div>
              )}
              {/* Show only available wallets */}
              {hasAvailableOptions ? (
                availableOpts.map(function(opt) {
                  var isPending = isConnecting && pendingWallet === opt.pendingMatch;
                  var disabled = isConnecting || isTimedOut;
                  var isPrimary = opt.key === 'privy';
                  return (
                    <button key={opt.key} onClick={opt.onClick} disabled={disabled} style={{
                      display: 'flex', alignItems: 'center', gap: isPrimary ? 14 : 12,
                      background: isPending ? 'rgba(0,229,255,.12)' : (isPrimary ? 'linear-gradient(135deg, rgba(150,93,232,.20), rgba(0,229,255,.12))' : 'rgba(255,255,255,.025)'),
                      border: (isPrimary && !isPending) ? '1.5px solid rgba(150,93,232,.5)' : '1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)'),
                      borderRadius: isPrimary ? 16 : 12, padding: isPrimary ? '18px 20px' : '11px 14px',
                      cursor: disabled ? 'wait' : 'pointer', width: '100%',
                      opacity: isTimedOut && !isPending ? 0.55 : 1, transition: 'background .15s, border-color .15s',
                      boxShadow: isPrimary && !isPending ? '0 4px 24px rgba(150,93,232,.15)' : 'none',
                    }}>
                      <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={isPrimary ? 44 : 32} />
                      <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: isPrimary ? 800 : 700, fontSize: isPrimary ? 16 : 14 }}>{opt.name}</div>
                        <div style={{ color: opt.key === 'privy' ? opt.color : C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isPending ? 'Check your wallet...' : opt.subtitle}
                        </div>
                      </div>
                      {isPending && <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />}
                    </button>
                  );
                })
              ) : (
                <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
                  No wallets detected. Install Phantom, Solflare, or open this page from inside your wallet browser.
                </div>
              )}
              <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>
                Non-custodial. We never see or store your keys.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Icons, NAV_TABS, NAV_ICONS, mapJupiterTokenToCoin, AppInner — unchanged from your sent file
function IconSwap()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconMarkets()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconLaunches() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function IconLaunch()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>; }
function IconSend()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconWallet()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
function IconPerps()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>; }

const NAV_ICONS = { swap: IconSwap, markets: IconMarkets, launches: IconLaunches, launch: IconLaunch, send: IconSend, portfolio: IconWallet, perps: IconPerps };
const NAV_TABS = [
  { id: 'swap', label: 'Swap' }, { id: 'markets', label: 'Markets' }, { id: 'launches', label: 'Launches' },
  { id: 'launch', label: 'Launch' }, { id: 'send', label: 'Send' }, { id: 'portfolio', label: 'Wallet' }, { id: 'perps', label: 'Perps' },
];

function mapJupiterTokenToCoin(t, idx) {
  if (!t || !t.id) return null;
  const stats24h = t.stats24h || {};
  const buyVol = Number(stats24h.buyVolume) || 0; const sellVol = Number(stats24h.sellVolume) || 0;
  return { id: t.id, symbol: t.symbol || t.id.slice(0, 4), name: t.name || 'Unknown', image: t.icon || null, current_price: typeof t.usdPrice === 'number' ? t.usdPrice : (parseFloat(t.usdPrice) || 0), market_cap: typeof t.mcap === 'number' ? t.mcap : (parseFloat(t.mcap) || 0), market_cap_rank: idx + 1, total_volume: buyVol + sellVol, high_24h: null, low_24h: null, price_change_percentage_24h: typeof stats24h.priceChange === 'number' ? stats24h.priceChange : null, isSolanaToken: true, liquidity: typeof t.liquidity === 'number' ? t.liquidity : (parseFloat(t.liquidity) || 0) };
}

function AppInner() {
  const navigate = useNavigate(); const location = useLocation(); const wallet = useAppWallet();
  const [tab, setTab] = useState(function() { return tabFromPathname(location.pathname); });
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [coins, setCoins] = useState([]); const [loading, setLoading] = useState(true);
  const [jupiterTokens, setJupiterTokens] = useState([]); const [jupiterLoading, setJupiterLoading] = useState(true);
  const [launchesKey, setLaunchesKey] = useState(0); const [portfolioKey, setPortfolioKey] = useState(0);
  const [isMobile, setIsMobile] = useState(function() { return typeof window !== 'undefined' && window.innerWidth < 769; });
  useEffect(function() { let to = null; function onResize() { if (to) clearTimeout(to); to = setTimeout(function() { setIsMobile(window.innerWidth < 769); }, 150); } window.addEventListener('resize', onResize); return function() { window.removeEventListener('resize', onResize); if (to) clearTimeout(to); }; }, []);
  useEffect(function() { var el = document.createElement('style'); el.textContent = GLOBAL_STYLES; document.head.appendChild(el); return function() { document.head.removeChild(el); }; }, []);
  useEffect(function() { var newTab = tabFromPathname(location.pathname); if (newTab !== tab) { setTab(newTab); if (newTab !== 'token') setSelectedToken(null); } }, [location.pathname, tab]);
  const switchTab = useCallback(function(newTab) { if (newTab === tab && newTab !== 'token') { if (newTab === 'launches') setLaunchesKey(function(k) { return k + 1; }); if (newTab === 'portfolio') setPortfolioKey(function(k) { return k + 1; }); return; } if (newTab !== 'token') setSelectedToken(null); navigate(TAB_TO_PATH[newTab] || '/swap'); setTab(newTab); window.scrollTo(0, 0); }, [tab, navigate]);
  const goToToken = useCallback(function(coin) { setSelectedToken(coin); setTab('token'); navigate('/markets/token'); window.scrollTo(0, 0); }, [navigate]);
  const goBack = useCallback(function() { navigate(-1); }, [navigate]);
  const openWallet = useCallback(function() { setWalletModalOpen(true); }, []);
  
  useEffect(function() {
    var isMounted = true; var controller = new AbortController();
    try { var cached = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || 'null'); if (cached && cached.v === 4 && Date.now() - cached.ts < 300000) { if (cached.coins && cached.coins.length) { setCoins(cached.coins); setLoading(false); } if (cached.jupTokens && cached.jupTokens.length) { setJupiterTokens(cached.jupTokens); setJupiterLoading(false); } } } catch (e) {}
    var cacheBuf = { v: 4, coins: [], jupTokens: [], ts: 0 };
    try { var existing = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '{}'); if (existing && existing.v === 4) { cacheBuf.coins = existing.coins || []; cacheBuf.jupTokens = existing.jupTokens || []; } } catch (e) {}
    var flushCache = function() { try { cacheBuf.ts = Date.now(); localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(cacheBuf)); } catch (e) {} };
    var fetchMarkets = function() { return fetch(JUPITER_MARKETS_URL, { signal: controller.signal }).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) { if (!isMounted || !Array.isArray(data)) return; var mapped = data.map(mapJupiterTokenToCoin).filter(Boolean); setCoins(mapped); setLoading(false); cacheBuf.coins = mapped; flushCache(); }).catch(function(e) { if (isMounted && (!e || e.name !== 'AbortError')) setLoading(false); }); };
    var fetchRegistry = function() { return fetch(JUPITER_REGISTRY_URL, { signal: controller.signal }).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) { if (!isMounted || !Array.isArray(data)) return; var jupTokens = data.map(function(t) { return { mint: t.id, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.icon }; }); setJupiterTokens(jupTokens); setJupiterLoading(false); cacheBuf.jupTokens = jupTokens; flushCache(); }).catch(function() { if (isMounted) setJupiterLoading(false); }); };
    var fetchAll = function() { fetchMarkets(); fetchRegistry(); }; fetchAll();
    var interval = null; var startPolling = function() { if (interval) return; interval = setInterval(fetchAll, MARKET_POLL_MS); }; var stopPolling = function() { if (interval) { clearInterval(interval); interval = null; } }; startPolling();
    var onVis = function() { if (document.visibilityState === 'visible') { fetchAll(); startPolling(); } else { stopPolling(); } }; document.addEventListener('visibilitychange', onVis);
    return function() { isMounted = false; controller.abort(); stopPolling(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  var sharedProps = { isConnected: wallet.isConnected, isSolanaConnected: wallet.isSolanaConnected, walletAddress: wallet.walletAddress, solConnected: wallet.solConnected, evmConnected: wallet.evmConnected, evmAddress: wallet.evmAddress, publicKey: wallet.publicKey, activeWalletKind: wallet.activeWalletKind, privyAuthenticated: wallet.privyAuthenticated, privyEmbeddedSol: wallet.privyEmbeddedSol, onConnectWallet: openWallet };
  var displayAddress = wallet.walletAddress ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4) : null;
  var activeTab = getActiveTab(tab);

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
            {NAV_TABS.map(function(t) { var active = activeTab === t.id; return (<button key={t.id} onClick={function() { switchTab(t.id); }} style={{ background: active ? 'rgba(0,229,255,.09)' : 'transparent', border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent', borderRadius: 8, padding: '5px 12px', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{t.label}</button>); })}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>
        </div>
      </header>
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap' && <SwapWidget {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} jupiterLoading={jupiterLoading} onGoToToken={goToToken} />}
        {tab === 'markets' && <Markets coins={coins} loading={loading} onSelectCoin={goToToken} jupiterTokens={jupiterTokens} />}
        {tab === 'token' && selectedToken && <TokenDetail {...sharedProps} coin={selectedToken} coins={coins} jupiterTokens={jupiterTokens} onBack={goBack} />}
        {tab === 'launches' && <NewLaunches {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} resetKey={launchesKey} />}
        {tab === 'launch' && <TokenLaunch {...sharedProps} />}
        {tab === 'send' && <Send {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} />}
        {tab === 'portfolio' && <Portfolio {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} onSend={function() { switchTab('send'); }} refreshKey={portfolioKey} onSelectToken={goToToken} />}
        {tab === 'perps' && <PerpsLanding onConnectWallet={openWallet} />}
      </main>
      <nav className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV_TABS.map(function(t) { var active = activeTab === t.id; var Icon = NAV_ICONS[t.id]; return (<button key={t.id} onClick={function() { switchTab(t.id); }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54, position: 'relative' }}>{active && <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />}{Icon && <Icon />}<span>{t.label}</span></button>); })}
        <button onClick={openWallet} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: wallet.isConnected ? C.green : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid ' + (wallet.isConnected ? C.green : C.muted), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{wallet.isConnected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />}</div>
          <span style={{ fontSize: 8 }}>{wallet.isConnected ? displayAddress : 'Connect'}</span>
        </button>
      </nav>
      <WalletModal open={walletModalOpen} onClose={function() { setWalletModalOpen(false); }} />
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }