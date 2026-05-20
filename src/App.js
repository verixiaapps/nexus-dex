import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget from './components/SwapWidget.jsx';
import Portfolio from './components/Portfolio.js';
import TokenDetail from './components/TokenDetail.js';
import PerpsLanding from './components/PerpsLanding.jsx';
import Earn from './components/Earn.jsx';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
  privy: '#a855f7',
};

const GLOBAL_STYLES = `html,body{ margin:0;padding:0;width:100%; min-height:100vh; min-height:100dvh; overflow-x:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; } body{ -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; } body.nexus-scroll-locked{ overflow:hidden !important; } #root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; } *,*::before,*::after{box-sizing:border-box;} *{ -webkit-tap-highlight-color:transparent; } button,a,[role="button"]{ touch-action:manipulation; } input,button,select,textarea{ font-family:'Syne',sans-serif; font-size:16px; } input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; } ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} .scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}} @keyframes wc-spin { to { transform: rotate(360deg); } }`;

// =====================================================================
// Inline sanctions screening — Chainalysis free public API. Fail-open
// if API is unreachable. Results cached 24h in localStorage.
// =====================================================================
const SANCTIONS_URL = 'https://public.chainalysis.com/api/v1/address/';
const SANCTIONS_CACHE_PREFIX = 'nx_sanctions_';
const SANCTIONS_CACHE_TTL = 24 * 60 * 60 * 1000;
const SANCTIONS_TIMEOUT = 5000;

async function screenAddress(address) {
  if (!address || typeof address !== 'string') return { clean: true };
  try {
    const raw = localStorage.getItem(SANCTIONS_CACHE_PREFIX + address);
    if (raw) {
      const { result, ts } = JSON.parse(raw);
      if (Date.now() - ts < SANCTIONS_CACHE_TTL) return result;
    }
  } catch {}
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SANCTIONS_TIMEOUT);
    const res = await fetch(SANCTIONS_URL + encodeURIComponent(address), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { clean: true };
    const data = await res.json();
    const ids = Array.isArray(data?.identifications) ? data.identifications : [];
    const result = ids.length > 0
      ? { clean: false, reason: ids[0]?.name || ids[0]?.category || 'Sanctioned' }
      : { clean: true };
    try { localStorage.setItem(SANCTIONS_CACHE_PREFIX + address, JSON.stringify({ result, ts: Date.now() })); } catch {}
    return result;
  } catch (e) {
    console.warn('[sanctions screen]', e?.message || e);
    return { clean: true };
  }
}

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap',
  '/perps': 'perps',
  '/vip': 'perps',
  '/sports': 'sports',
  '/earn': 'earn',
  '/portfolio': 'portfolio',
};
const TAB_TO_PATH = {
  swap: '/swap',
  perps: '/vip',
  sports: '/sports',
  earn: '/earn',
  portfolio: '/portfolio',
};

function tabFromPathname(pathname) { return PATH_TO_TAB[pathname] || (pathname.startsWith('/token') ? 'token' : 'swap'); }
function getActiveTab(tab) { return tab === 'token' ? 'portfolio' : tab; }
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
    case 'START':     return { kind: 'connecting', message: '', wallet: action.wallet, target: action.target || '' };
    case 'SCREENING': return { kind: 'screening', message: '', wallet: state.wallet, target: state.target };
    case 'TIMEOUT':   return { kind: 'timeout', message: 'Taking too long? Check your wallet and try again.', wallet: state.wallet, target: state.target };
    case 'SUCCESS':   return WM_INITIAL;
    case 'ERROR':     return { kind: 'error', message: action.message || 'Connection failed', wallet: state.wallet, target: state.target };
    case 'BLOCKED':   return { kind: 'blocked', message: action.message || 'Access restricted from this wallet.', wallet: state.wallet, target: state.target };
    case 'RESET':     return WM_INITIAL;
    default:          return state;
  }
}

// =====================================================================
// TermsGate — PancakeSwap-style centered card. Scroll-to-bottom required
// before Accept enables.
// =====================================================================
function TermsGate({ onAccept }) {
  const scrollRef = useRef(null);
  const [canAccept, setCanAccept] = useState(false);

  useEffect(() => {
    document.body.classList.add('nexus-scroll-locked');
    return () => document.body.classList.remove('nexus-scroll-locked');
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 8) setCanAccept(true);
  }, []);

  const handleScroll = () => {
    if (canAccept) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setCanAccept(true);
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(3,6,15,.78)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}/>
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'calc(100% - 24px)', maxWidth: 440, maxHeight: '82dvh',
        zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#080d1a', border: '1px solid rgba(0,229,255,.22)',
        borderRadius: 20,
        boxShadow: '0 30px 80px rgba(0,0,0,.7), 0 0 32px rgba(0,229,255,.12)',
        fontFamily: 'Syne, sans-serif',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 22px 10px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 10px', borderRadius: 999, background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.22)', marginBottom: 10 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00e5ff' }}/>
            <span style={{ color: '#00e5ff', fontSize: 9, fontWeight: 700, letterSpacing: '.10em' }}>TERMS OF USE</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.15, marginBottom: 4 }}>Welcome to Nexus DEX</div>
          <div style={{ fontSize: 11.5, color: '#586994', lineHeight: 1.45 }}>Non-custodial · Third-party protocols · You assume all risk</div>
        </div>

        <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 22px 14px', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ fontSize: 11.5, color: '#cdd6f4', lineHeight: 1.6 }}>
            By clicking <strong style={{ color: '#fff' }}>"Accept &amp; Continue"</strong> or by accessing or using Nexus DEX, you acknowledge and agree that:<br/><br/>

            • Nexus DEX is a non-custodial software interface operated by Verixia Apps. We do not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br/><br/>

            • <strong style={{ color: '#fff' }}>Compliance &amp; wallet screening.</strong> All wallet addresses are automatically screened against U.S. OFAC, U.N., E.U., and U.K. sanctions lists at connection time using Chainalysis. Flagged wallets are denied access before any transaction is possible.<br/><br/>

            • <strong style={{ color: '#fff' }}>Restricted jurisdictions.</strong> You represent and warrant you are not located in, a resident of, citizen of, or accessing Nexus DEX from: Iran, North Korea, Cuba, Syria, the Crimea, Donetsk, Luhansk, and Sevastopol regions of Ukraine, or any other jurisdiction subject to comprehensive U.S., U.N., E.U., or U.K. sanctions.<br/><br/>

            • <strong style={{ color: '#fff' }}>You are 18 or older</strong> and have full legal capacity to enter this agreement.<br/><br/>

            • All swaps, perpetual trades, routing, execution, liquidity, pricing, and blockchain interactions are handled by third-party protocols, aggregators, exchanges, smart contracts, and infrastructure providers. All transactions are initiated, reviewed, authorized, and signed directly by you through your own wallet.<br/><br/>

            • Digital assets, perpetuals, leverage, DeFi protocols, and smart contracts carry substantial risk including total loss of funds from liquidation, exploits, smart-contract vulnerabilities, slippage, protocol failures, hacks, MEV, frontrunning, network outages, oracle errors, and human error. <strong style={{ color: '#fff' }}>You assume all risk.</strong><br/><br/>

            • <strong style={{ color: '#fff' }}>No reimbursement for losses.</strong> Verixia Apps will not refund, reimburse, or compensate you for any loss of funds or value, regardless of cause — including failed transactions, slippage, smart-contract exploits, third-party protocol failures, network outages, market volatility, liquidation, frontrunning, MEV, or human error.<br/><br/>

            • <strong style={{ color: '#fff' }}>AS-IS / AS-AVAILABLE.</strong> Nexus DEX is provided without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, non-infringement, accuracy, and uninterrupted operation.<br/><br/>

            • <strong style={{ color: '#fff' }}>No fiduciary duty.</strong> Verixia Apps owes you no fiduciary duty. To the extent any such duty may exist at law or in equity, it is irrevocably waived and disclaimed.<br/><br/>

            • <strong style={{ color: '#fff' }}>No liability.</strong> To the fullest extent permitted by law, Verixia Apps, Nexus DEX, their operators, affiliates, contributors, and service providers are not liable for any damages, losses, claims, costs, or expenses of any kind — direct, indirect, incidental, consequential, special, exemplary, or punitive — arising from or related to your use of Nexus DEX, regardless of the cause of action.<br/><br/>

            • <strong style={{ color: '#fff' }}>Misrepresentation.</strong> If any representation you make in these terms is false (including jurisdiction, age, or sanctions status), Verixia Apps may immediately terminate your access, cooperate with law enforcement, and seek full indemnification from you. All losses, fines, penalties, or damages arising from your misrepresentation are your sole responsibility.<br/><br/>

            • <strong style={{ color: '#fff' }}>Indemnification.</strong> You will indemnify and hold harmless Verixia Apps, Nexus DEX, their operators, affiliates, contributors, and service providers from any and all claims, damages, costs, fines, penalties, or liabilities arising from your use of Nexus DEX, your violation of these terms, or your violation of any law or third-party right.<br/><br/>

            • You are solely responsible for compliance with all laws and regulations applicable to your jurisdiction.<br/><br/>

            • Verixia Apps reserves the right to restrict, block, suspend, terminate, or deny access at any time for any reason.<br/><br/>

            • <strong style={{ color: '#fff' }}>No class actions.</strong> You irrevocably waive any right to participate in any class action, class arbitration, representative action, consolidated proceeding, or jury trial against Verixia Apps or Nexus DEX.<br/><br/>

            • <strong style={{ color: '#fff' }}>Binding individual arbitration.</strong> Any dispute shall be resolved exclusively through final and binding individual arbitration.<br/><br/>

            If you do not agree to these terms, you must discontinue use of Nexus DEX immediately.
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 22px 18px', borderTop: '1px solid rgba(255,255,255,.04)', background: '#080d1a' }}>
          {!canAccept && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 10.5, color: '#586994', marginBottom: 10, fontWeight: 600, letterSpacing: '.04em' }}>
              <span>↓</span>Scroll to the bottom to continue
            </div>
          )}
          <button onClick={canAccept ? onAccept : undefined} disabled={!canAccept} style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none',
            background: canAccept ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.05)',
            color: canAccept ? '#03060f' : '#586994',
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, letterSpacing: '-.01em',
            cursor: canAccept ? 'pointer' : 'not-allowed',
            boxShadow: canAccept ? '0 8px 24px rgba(0,229,255,.25)' : 'none',
            transition: 'all .2s',
          }}>Accept &amp; Continue</button>
          <div style={{ fontSize: 9, color: '#586994', textAlign: 'center', marginTop: 10, fontWeight: 600, letterSpacing: '.06em' }}>
            NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS
          </div>
        </div>
      </div>
    </>
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
    if (matched) {
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
      dispatch({ type: 'SCREENING' });
    }
  }, [extSolConnected, privyAuthenticated, selectedWallet, mState.kind, mState.wallet, mState.target]);

  useEffect(() => {
    if (mState.kind !== 'screening') return;
    if (!walletAddress) return;
    let cancelled = false;
    screenAddress(walletAddress).then(({ clean }) => {
      if (cancelled) return;
      if (clean) {
        dispatch({ type: 'SUCCESS' });
        onClose();
      } else {
        disconnectAll().catch(() => {});
        dispatch({ type: 'BLOCKED', message: 'This wallet is on a sanctioned addresses list. Access is denied.' });
      }
    }).catch(() => {
      if (cancelled) return;
      dispatch({ type: 'SUCCESS' });
      onClose();
    });
    return () => { cancelled = true; };
  }, [mState.kind, walletAddress, disconnectAll, onClose]);

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
  const isConnecting = mState.kind === 'connecting' || mState.kind === 'screening';
  const isTimedOut   = mState.kind === 'timeout';
  const isBlocked    = mState.kind === 'blocked';
  const isScreening  = mState.kind === 'screening';
  const pendingWallet = (isConnecting || isTimedOut) ? mState.wallet : null;
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
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {isBlocked ? 'Access Restricted' : anyConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </div>
            {displayAddr && !isBlocked && <div style={{ fontSize: 13, color: '#586994' }}>{(connectedWalletName || 'Wallet')}: {displayAddr}</div>}
            {privyHandle && !anyConnected && !isBlocked && <div style={{ fontSize: 12, color: C.privy, marginTop: 2 }}>{privyHandle}</div>}
            {isScreening && <div style={{ fontSize: 12, color: C.accent, marginTop: 4 }}>Verifying wallet address...</div>}
            {!anyConnected && !isBlocked && !isScreening && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Pick one. We never see your keys.</div>}
          </div>
        </div>
        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {isBlocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.35)', borderRadius: 16, padding: '16px 18px' }}>
                <div style={{ color: '#ff3b6b', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Wallet not eligible</div>
                <div style={{ color: '#cdd6f4', fontSize: 12, lineHeight: 1.55 }}>{mState.message} This is automated screening against major sanctions lists. If you believe this is an error, please try a different wallet.</div>
              </div>
              <button onClick={handleRetry} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.30)', borderRadius: 16, padding: 14, cursor: 'pointer', width: '100%', color: C.accent, fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Try a different wallet</button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 12, cursor: 'pointer', color: '#586994', fontSize: 13, fontFamily: 'Syne, sans-serif' }}>Close</button>
            </div>
          ) : anyConnected ? (
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
                      <div style={{ color: opt.key === 'privy' ? opt.color : C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPending ? (isScreening ? 'Verifying address...' : 'Check your wallet...') : opt.subtitle}</div>
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

function IconSwap()        { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconVip()         { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l4 10 6-13 6 13 4-10"/><path d="M2 21h20"/></svg>; }
function IconSports()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5l11 11"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>; }
function IconWallet()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
function IconEarn()        { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v12"/><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5S10.3 12 12 12s3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5"/></svg>; }

const NAV_ICONS = { swap: IconSwap, perps: IconVip, sports: IconSports, earn: IconEarn, portfolio: IconWallet };
const NAV_TABS = [
  { id: 'swap',        label: 'Swap' },
  { id: 'perps',       label: 'VIP' },
  { id: 'earn',        label: 'Earn' },
  { id: 'portfolio',   label: 'Wallet' },
];

function AppInner() {
  const navigate = useNavigate(); const location = useLocation(); const wallet = useAppWallet();
  const [tab, setTab] = useState(() => tabFromPathname(location.pathname));
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 769);

  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem('nexus_terms_accepted_v3') === '1'; } catch { return false; }
  });

  useEffect(() => { let to; const h = () => { clearTimeout(to); to = setTimeout(() => setIsMobile(window.innerWidth < 769), 150); }; window.addEventListener('resize', h); return () => { window.removeEventListener('resize', h); clearTimeout(to); }; }, []);
  useEffect(() => { const el = document.createElement('style'); el.textContent = GLOBAL_STYLES; document.head.appendChild(el); return () => document.head.removeChild(el); }, []);
  useEffect(() => { const newTab = tabFromPathname(location.pathname); if (newTab !== tab) { setTab(newTab); if (newTab !== 'token') setSelectedToken(null); } }, [location.pathname, tab]);

  const switchTab = useCallback(newTab => {
    if (newTab === tab && newTab !== 'token') return;
    if (newTab !== 'token') setSelectedToken(null);
    navigate(TAB_TO_PATH[newTab] || '/swap'); setTab(newTab); window.scrollTo(0, 0);
  }, [tab, navigate]);
  const goToToken = useCallback(coin => { setSelectedToken(coin); setTab('token'); navigate('/token'); window.scrollTo(0, 0); }, [navigate]);
  const goBack = useCallback(() => navigate(-1), [navigate]);
  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  const sharedProps = { isConnected: wallet.isConnected, solConnected: wallet.solConnected, walletAddress: wallet.walletAddress, publicKey: wallet.publicKey, activeWalletKind: wallet.activeWalletKind, privyAuthenticated: wallet.privyAuthenticated, privyEmbeddedSol: wallet.privyEmbeddedSol, onConnectWallet: openWallet };
  const displayAddress = wallet.walletAddress ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4) : null;
  const activeTab = getActiveTab(tab);

  if (!termsAccepted) {
    return <TermsGate onAccept={() => { try { localStorage.setItem('nexus_terms_accepted_v3', '1'); } catch {} setTermsAccepted(true); }} />;
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
        {tab === 'perps' && <PerpsLanding onConnectWallet={openWallet} />}
        {tab === 'earn' && <Earn {...sharedProps} />}
        {tab === 'portfolio' && <Portfolio onSelectCoin={goToToken} onConnectWallet={openWallet} />}
        {tab === 'token' && <TokenDetail {...sharedProps} coin={selectedToken} onBack={goBack} />}
      </main>
      <nav className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV_TABS.map(t => { const Icon = NAV_ICONS[t.id]; return (<button key={t.id} onClick={() => switchTab(t.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: activeTab === t.id ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '6px 2px', minHeight: 54, position: 'relative' }}>{activeTab === t.id && <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />}<Icon /><span>{t.label}</span></button>); })}
      </nav>
      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }
 