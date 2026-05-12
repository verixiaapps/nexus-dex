import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
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
  if (!src || errored) return (<div style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: (color || '#586994') + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.42), fontWeight: 800, color: color || '#fff', flexShrink: 0 }}>{(fallbackLetter || '?').charAt(0).toUpperCase()}</div>);
  return (<img src={src} alt={fallbackLetter || ''} style={{ width: size, height: size, borderRadius: Math.round(size / 4), flexShrink: 0, background: '#fff' }} onError={() => setErrored(true)} />);
}

const PRIVY_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#a855f7"/><path d="M8 14l12 8 12-8v14H8V14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M8 14h24v0L20 22 8 14z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>');

const WALLETCONNECT_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3b99fc"/><path d="M13 16a14 14 0 0 1 14 0l.5.4a.4.4 0 0 1 0 .6l-1.6 1.5a.24.24 0 0 1-.3 0 10 10 0 0 0-11.2 0 .24.24 0 0 1-.3 0l-1.6-1.5a.4.4 0 0 1 0-.6l.5-.4zm17.3 3.3l1.4 1.3a.4.4 0 0 1 0 .6l-6.2 5.8a.5.5 0 0 1-.7 0L21 23.2a.12.12 0 0 0-.2 0l-3.8 3.6a.5.5 0 0 1-.7 0l-6.2-5.8a.4.4 0 0 1 0-.6l1.4-1.3a.5.5 0 0 1 .7 0l6.2 5.8a.12.12 0 0 0 .2 0l3.8-3.6a.5.5 0 0 1 .7 0l3.8 3.6a.12.12 0 0 0 .2 0l6.2-5.8a.5.5 0 0 1 .7 0z" fill="#fff"/></svg>');

const CONNECTION_TIMEOUT_MS = 15000;
const WM_INITIAL = { kind: 'idle', message: '', wallet: '', target: '' };

function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':   return { kind: 'connecting', message: '', wallet: action.wallet, target: action.target || '' };
    case 'TIMEOUT': return { kind: 'timeout', message: 'Taking too long? Check your wallet and try again.', wallet: state.wallet, target: state.target };
    case 'SUCCESS': return WM_INITIAL;
    case 'ERROR':   return { kind: 'error', message: action.message || 'Connection failed', wallet: state.wallet, target: state.target };
    case 'RESET':   return WM_INITIAL;
    default:        return state;
  }
}

function TermsGate({ onAccept }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,6,15,.98)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#080d1a', border: '1px solid rgba(0,229,255,.15)', borderRadius: 20, padding: 24, fontFamily: 'Syne, sans-serif' }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#fff', marginBottom: 4 }}>Terms of Use</div>
        <div style={{ color: '#586994', fontSize: 11, marginBottom: 16 }}>Non-custodial · Third-party protocols · User assumes all risk</div>
        <div style={{ fontSize: 12, color: '#cdd6f4', lineHeight: 1.6, marginBottom: 20 }}>
          By clicking <strong>"Accept &amp; Continue"</strong> or by accessing or using Nexus DEX, you acknowledge and agree that:<br/><br/>
          • Nexus DEX is a non-custodial software interface operated by Verixia Apps.<br/><br/>
          • Verixia Apps does not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br/><br/>
          • All swaps, perpetual trades, routing, execution, liquidity, pricing, token launches, and blockchain interactions are handled by third-party protocols, aggregators, exchanges, smart contracts, and infrastructure providers.<br/><br/>
          • All transactions are initiated, reviewed, authorized, and signed directly by users through their own wallets.<br/><br/>
          • Digital assets, perpetual contracts, leverage, DeFi protocols, smart contracts, token launches, and related technologies involve substantial risk including loss of funds, liquidation, exploits, smart contract vulnerabilities, slippage, protocol failures, hacks, and complete loss of assets.<br/><br/>
          • Users assume all risks associated with using Nexus DEX and any integrated third-party protocols or services.<br/><br/>
          • Nexus DEX and Verixia Apps are provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind.<br/><br/>
          • To the fullest extent permitted by law, Verixia Apps and Nexus DEX expressly disclaim all liability for any damages, losses, liabilities, claims, costs, or expenses arising from or related to the use of Nexus DEX.<br/><br/>
          • Users are solely responsible for complying with all laws and regulations applicable to their jurisdiction.<br/><br/>
          • Users represent and warrant that they are not located in, residents of, citizens of, or otherwise subject to any restricted, prohibited, or sanctioned jurisdiction.<br/><br/>
          • Verixia Apps reserves the right to restrict, block, suspend, terminate, or deny access at any time for any reason.<br/><br/>
          • Users irrevocably waive any right to participate in any class action, class arbitration, representative action, consolidated proceeding, or jury trial against Verixia Apps or Nexus DEX.<br/><br/>
          • Any dispute shall be resolved exclusively through final and binding individual arbitration.<br/><br/>
          If you do not agree to these terms, you must discontinue use of Nexus DEX immediately.
        </div>
        <button onClick={onAccept} style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#03060f', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>Accept &amp; Continue</button>
      </div>
    </div>
  );
}

function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);
  const nexus = useNexusWallet();
  const { privyReady, privyAuthenticated, privyUser, loginPrivy, disconnectAll, isConnected: nexusConnected, extSolConnected, walletAddress, connectedWalletName } = nexus;
  const { wallet: selectedWallet, select, wallets, connect: solConnect } = useWallet();
  const connectionTimerRef = useRef(null);

  const phantomWallet = wallets.find(w => w.adapter.name === 'Phantom');
  const walletConnectWallet = wallets.find(w => w.adapter.name === 'WalletConnect');

  useEffect(() => { if (!open) { dispatch({ type: 'RESET' }); if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; } } }, [open]);
  useEffect(() => { if (!open) return; document.body.classList.add('nexus-scroll-locked'); const onKey = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => { document.body.classList.remove('nexus-scroll-locked'); window.removeEventListener('keydown', onKey); }; }, [open, onClose]);
  useEffect(() => () => { if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current); }, []);

  useEffect(() => {
    if (mState.kind !== 'connecting') return;
    let matched = false;
    if (mState.target === 'privy') matched = privyAuthenticated;
    else if (mState.target === 'solana') matched = extSolConnected && selectedWallet && selectedWallet.adapter && selectedWallet.adapter.name === mState.wallet;
    if (matched) { if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; } dispatch({ type: 'SUCCESS' }); onClose(); }
  }, [extSolConnected, privyAuthenticated, selectedWallet, mState.kind, mState.wallet, mState.target, onClose]);

  const targetWalletRef = useRef(null);
  useEffect(() => {
    const target = targetWalletRef.current;
    if (!target || !selectedWallet || selectedWallet.adapter.name !== target || mState.kind !== 'connecting' || mState.wallet !== target) return;
    let cancelled = false; targetWalletRef.current = null;
    solConnect().catch(e => { if (cancelled) return; const raw = e?.message || 'Failed'; dispatch({ type: 'ERROR', message: /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw }); });
    return () => { cancelled = true; };
  }, [selectedWallet, solConnect, mState.kind, mState.wallet]);

  const startTimer = name => { if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current); connectionTimerRef.current = setTimeout(() => dispatch({ type: 'TIMEOUT' }), CONNECTION_TIMEOUT_MS); };

  const handleSolanaConnect = useCallback(wallet => {
    if (!wallet?.adapter) { dispatch({ type: 'ERROR', message: 'Wallet not detected. Install the extension.' }); return; }
    dispatch({ type: 'START', wallet: wallet.adapter.name, target: 'solana' });
    startTimer(wallet.adapter.name);
    targetWalletRef.current = wallet.adapter.name;
    try { select(wallet.adapter.name); } catch (e) { dispatch({ type: 'ERROR', message: 'Failed to open wallet.' }); targetWalletRef.current = null; }
  }, [select]);

  const handlePrivyLogin = useCallback(() => {
    if (!privyReady) { dispatch({ type: 'ERROR', message: 'Email login not configured.' }); return; }
    dispatch({ type: 'START', wallet: 'Email / Social', target: 'privy' });
    startTimer('Email / Social');
    try { loginPrivy(); } catch (e) { dispatch({ type: 'ERROR', message: e?.message || 'Failed to open login' }); }
  }, [privyReady, loginPrivy]);

  const handleDisconnect = useCallback(async () => { try { await disconnectAll(); } catch {} dispatch({ type: 'RESET' }); onClose(); }, [disconnectAll, onClose]);
  const handleRetry = () => dispatch({ type: 'RESET' });

  const allOptions = [
    { key: 'phantom', name: 'Phantom', subtitle: 'Solana wallet', color: '#ab9ff2', icon: phantomWallet?.adapter?.icon, ready: !!phantomWallet, pendingMatch: 'Phantom', onClick: () => handleSolanaConnect(phantomWallet) },
    { key: 'walletconnect', name: 'WalletConnect', subtitle: 'Scan QR or link any wallet', color: '#3b99fc', icon: WALLETCONNECT_LOGO, ready: !!walletConnectWallet, pendingMatch: 'WalletConnect', onClick: () => handleSolanaConnect(walletConnectWallet) },
    { key: 'privy', name: 'Continue with email', subtitle: 'Email, Google, passkey', color: C.privy, icon: PRIVY_LOGO, ready: privyReady, pendingMatch: 'Email / Social', onClick: handlePrivyLogin },
  ];

  const availableOpts = allOptions.filter(o => o.ready);
  const isConnecting = mState.kind === 'connecting';
  const isTimedOut = mState.kind === 'timeout';
  const pendingWallet = isConnecting || isTimedOut ? mState.wallet : null;
  const anyConnected = nexusConnected || privyAuthenticated;
  const displayAddr = walletAddress ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4) : null;
  const privyHandle = privyUser && (privyUser.email?.address || privyUser.google?.email || null);

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
            {privyHandle && !anyConnected && <div style={{ fontSize: 12, color: C.privy, marginTop: 2 }}>{privyHandle}</div>}
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
              {(mState.kind === 'error' || isTimedOut) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'rgba(255,149,0,.10)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '10px 14px' }}>
                  <span style={{ color: '#ff9500', fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid #ff9500', color: '#ff9500', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                </div>
              )}
              {availableOpts.length > 0 ? availableOpts.map(opt => {
                const isPending = isConnecting && pendingWallet === opt.pendingMatch;
                const disabled = isConnecting || isTimedOut;
                const isPrimary = opt.key === 'privy';
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled} style={{
                    display: 'flex', alignItems: 'center', gap: isPrimary ? 14 : 12,
                    background: isPending ? 'rgba(0,229,255,.12)' : (isPrimary ? 'linear-gradient(135deg, rgba(150,93,232,.20), rgba(0,229,255,.12))' : 'rgba(255,255,255,.025)'),
                    border: (isPrimary && !isPending) ? '1.5px solid rgba(150,93,232,.5)' : '1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)'),
                    borderRadius: isPrimary ? 16 : 12, padding: isPrimary ? '18px 20px' : '11px 14px',
                    cursor: disabled ? 'wait' : 'pointer', width: '100%',
                    opacity: isTimedOut && !isPending ? 0.55 : 1, transition: 'background .15s, border-color .15s',
                    boxShadow: isPrimary ? '0 4px 24px rgba(150,93,232,.15)' : 'none',
                  }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={isPrimary ? 44 : 32} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: isPrimary ? 800 : 700, fontSize: isPrimary ? 16 : 14 }}>{opt.name}</div>
                      <div style={{ color: opt.key === 'privy' ? opt.color : C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPending ? 'Check your wallet...' : opt.subtitle}</div>
                    </div>
                    {isPending && <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />}
                  </button>
                );
              }) : (
                <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>No wallets detected. Install Phantom or open from your wallet browser.</div>
              )}
              <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 6 }}>Non-custodial. We never see or store your keys.</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IconSwap()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconMarkets()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconLaunches() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function IconLaunch()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>; }
function IconSend()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconWallet()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
function IconPerps()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>; }

const NAV_ICONS = { swap: IconSwap, markets: IconMarkets, launches: IconLaunches, launch: IconLaunch, send: IconSend, portfolio: IconWallet, perps: IconPerps };
const NAV_TABS = [
  { id: 'swap', label: 'Swap' }, { id: 'markets', label: 'Markets' }, { id: 'launches', label: 'Trending' },
  { id: 'launch', label: 'Launch' }, { id: 'send', label: 'Send' }, { id: 'portfolio', label: 'Wallet' }, { id: 'perps', label: 'Perps' },
];

function AppInner() {
  const navigate = useNavigate(); const location = useLocation(); const wallet = useAppWallet();
  const [tab, setTab] = useState(() => tabFromPathname(location.pathname));
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 769);

  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem('nexus_terms_accepted') === '1'; } catch { return false; }
  });

  useEffect(() => { let to; const h = () => { clearTimeout(to); to = setTimeout(() => setIsMobile(window.innerWidth < 769), 150); }; window.addEventListener('resize', h); return () => { window.removeEventListener('resize', h); clearTimeout(to); }; }, []);
  useEffect(() => { const el = document.createElement('style'); el.textContent = GLOBAL_STYLES; document.head.appendChild(el); return () => document.head.removeChild(el); }, []);
  useEffect(() => { const newTab = tabFromPathname(location.pathname); if (newTab !== tab) { setTab(newTab); if (newTab !== 'token') setSelectedToken(null); } }, [location.pathname, tab]);

  const switchTab = useCallback(newTab => {
    if (newTab === tab && newTab !== 'token') return;
    if (newTab !== 'token') setSelectedToken(null);
    navigate(TAB_TO_PATH[newTab] || '/swap'); setTab(newTab); window.scrollTo(0, 0);
  }, [tab, navigate]);
  const goToToken = useCallback(coin => { setSelectedToken(coin); setTab('token'); navigate('/markets/token'); window.scrollTo(0, 0); }, [navigate]);
  const goBack = useCallback(() => navigate(-1), [navigate]);
  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  const sharedProps = { isConnected: wallet.isConnected, solConnected: wallet.solConnected, walletAddress: wallet.walletAddress, publicKey: wallet.publicKey, activeWalletKind: wallet.activeWalletKind, privyAuthenticated: wallet.privyAuthenticated, privyEmbeddedSol: wallet.privyEmbeddedSol, onConnectWallet: openWallet };
  const displayAddress = wallet.walletAddress ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4) : null;
  const activeTab = getActiveTab(tab);

  if (!termsAccepted) {
    return <TermsGate onAccept={() => { try { localStorage.setItem('nexus_terms_accepted', '1'); } catch {} setTermsAccepted(true); }} />;
  }

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.02) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
      <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(0,229,255,0.08)', background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', height: 56, gap: 12 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00e5ff,#0066ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: C.bg }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{ fontSize: 9, color: C.accent, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>DEX</span>
          </div>
          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {NAV_TABS.map(t => (<button key={t.id} onClick={() => switchTab(t.id)} style={{ background: activeTab === t.id ? 'rgba(0,229,255,.09)' : 'transparent', border: activeTab === t.id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent', borderRadius: 8, padding: '5px 12px', color: activeTab === t.id ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{t.label}</button>))}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>
        </div>
      </header>
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap' && <SwapWidget {...sharedProps} />}
        {tab === 'markets' && <Markets onSelectCoin={goToToken} />}
        {tab === 'token' && <TokenDetail {...sharedProps} coin={selectedToken} onBack={goBack} />}
        {tab === 'launches' && <Trending onSelectCoin={goToToken} />}
        {tab === 'launch' && <TokenLaunch {...sharedProps} />}
        {tab === 'send' && <Send {...sharedProps} />}
        {tab === 'portfolio' && <Portfolio {...sharedProps} onSend={() => switchTab('send')} />}
        {tab === 'perps' && <PerpsLanding onConnectWallet={openWallet} />}
      </main>
      <nav className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV_TABS.map(t => { const Icon = NAV_ICONS[t.id]; return (<button key={t.id} onClick={() => switchTab(t.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: activeTab === t.id ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54, position: 'relative' }}>{activeTab === t.id && <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />}<Icon /><span>{t.label}</span></button>); })}
        <button onClick={openWallet} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: wallet.isConnected ? C.green : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid ' + (wallet.isConnected ? C.green : C.muted), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{wallet.isConnected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />}</div>
          <span style={{ fontSize: 8 }}>{wallet.isConnected ? displayAddress : 'Connect'}</span>
        </button>
      </nav>
      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }