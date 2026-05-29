import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from './WalletContext.js';
import SwapWidget       from './components/SwapWidget.jsx';
import Portfolio        from './components/Portfolio.js';
import Stocks           from './components/Stocks.jsx';
import CrossChainSwap   from './components/CrossChainSwap.jsx';
import MemeWonderland   from './components/MemeWonderland.jsx';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
};

const GLOBAL_STYLES = `html,body{ margin:0;padding:0;width:100%; min-height:100vh; min-height:100dvh; overflow-x:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; text-size-adjust:100%; } body{ -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; } body.nexus-scroll-locked{ overflow:hidden !important; } #root{ min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; } *,*::before,*::after{box-sizing:border-box;} *{ -webkit-tap-highlight-color:transparent; } button,a,[role="button"]{ touch-action:manipulation; } input,button,select,textarea{ font-family:'Syne',sans-serif; font-size:16px; } input[type="text"],input[type="number"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea{ font-size:16px !important; } ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} .scroll-contain{ overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}} @keyframes wc-spin { to { transform: rotate(360deg); } }`;

// =====================================================================
// Inline sanctions screening — Chainalysis free public API. Fail-open
// if API is unreachable. Results cached 24h in localStorage.
// =====================================================================
const SANCTIONS_URL          = 'https://public.chainalysis.com/api/v1/address/';
const SANCTIONS_CACHE_PREFIX = 'nx_sanctions_';
const SANCTIONS_CACHE_TTL    = 24 * 60 * 60 * 1000;
const SANCTIONS_TIMEOUT      = 5000;

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
    const timeoutId  = setTimeout(() => controller.abort(), SANCTIONS_TIMEOUT);
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
  '/':            'swap',
  '/swap':        'swap',
  '/bridge':      'bridge',
  '/wonderland':  'wonderland',
  '/memes':       'wonderland',
  '/markets':     'markets',
  '/tokenized':   'markets',
  '/portfolio':   'portfolio',
  '/token':       'portfolio',
  '/stack':       'swap',
  '/vip':         'swap',
  '/perps':       'swap',
  '/call':        'swap',
  '/predict':     'swap',
};
const TAB_TO_PATH = {
  swap:       '/swap',
  bridge:     '/bridge',
  wonderland: '/wonderland',
  markets:    '/markets',
  portfolio:  '/portfolio',
};

function tabFromPathname(pathname) { return PATH_TO_TAB[pathname] || 'swap'; }
export function useAppWallet() { return useNexusWallet(); }

function WalletIcon({ src, fallbackLetter, color, size }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size / 4),
      background: (color || '#586994') + '33',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 800,
      color: color || '#fff', flexShrink: 0,
    }}>{(fallbackLetter || '?').charAt(0).toUpperCase()}</div>
  );
  return (
    <img
      src={src}
      alt={fallbackLetter || ''}
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), flexShrink: 0, background: '#fff' }}
      onError={() => setErrored(true)}
    />
  );
}

const WALLETCONNECT_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3b99fc"/><path d="M13 16a14 14 0 0 1 14 0l.5.4a.4.4 0 0 1 0 .6l-1.6 1.5a.24.24 0 0 1-.3 0 10 10 0 0 0-11.2 0 .24.24 0 0 1-.3 0l-1.6-1.5a.4.4 0 0 1 0-.6l.5-.4zm17.3 3.3l1.4 1.3a.4.4 0 0 1 0 .6l-6.2 5.8a.5.5 0 0 1-.7 0L21 23.2a.12.12 0 0 0-.2 0l-3.8 3.6a.5.5 0 0 1-.7 0l-6.2-5.8a.4.4 0 0 1 0-.6l1.4-1.3a.5.5 0 0 1 .7 0l6.2 5.8a.12.12 0 0 0 .2 0l3.8-3.6a.5.5 0 0 1 .7 0l3.8 3.6a.12.12 0 0 0 .2 0l6.2-5.8a.5.5 0 0 1 .7 0z" fill="#fff"/></svg>');

const CONNECTION_TIMEOUT_MS = 15000;
const WM_INITIAL = { kind: 'idle', message: '', wallet: '' };

function walletModalReducer(state, action) {
  switch (action.type) {
    case 'START':     return { kind: 'connecting', message: '', wallet: action.wallet };
    case 'SCREENING': return { kind: 'screening',  message: '', wallet: state.wallet };
    case 'TIMEOUT':   return { kind: 'timeout',    message: 'Taking too long? Check your wallet and try again.', wallet: state.wallet };
    case 'SUCCESS':   return WM_INITIAL;
    case 'ERROR':     return { kind: 'error',      message: action.message || 'Connection failed', wallet: state.wallet };
    case 'BLOCKED':   return { kind: 'blocked',    message: action.message || 'Access restricted from this wallet.', wallet: state.wallet };
    case 'RESET':     return WM_INITIAL;
    default:          return state;
  }
}

// =====================================================================
// TermsGate — compact bottom sheet, site visible behind
// =====================================================================
function TermsGate({ onAccept }) {
  const scrollRef = useRef(null);
  const [canAccept, setCanAccept] = useState(false);

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
      {/* Lighter overlay so the site is visible behind */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(3,6,15,.50)',
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
      }}/>

      {/* Compact bottom sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        maxHeight: '50dvh',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        background: '#080d1a',
        border: '1px solid rgba(0,229,255,.22)',
        borderTop: '1px solid rgba(0,229,255,.30)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -10px 40px rgba(0,0,0,.8), 0 0 20px rgba(0,229,255,.08)',
        fontFamily: 'Syne, sans-serif',
      }}>
        {/* Drag handle */}
        <div style={{ flexShrink: 0, paddingTop: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.15)' }} />
        </div>

        {/* Compact header */}
        <div style={{ flexShrink: 0, padding: '8px 18px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.22)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00e5ff' }}/>
            <span style={{ color: '#00e5ff', fontSize: 9, fontWeight: 700, letterSpacing: '.10em' }}>TERMS OF USE</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: '#586994' }}>Non-custodial · You assume all risk</div>
        </div>

        {/* Scrollable terms — compact */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scroll-contain"
          style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '4px 18px 10px' }}
        >
          <div style={{ fontSize: 11, color: '#cdd6f4', lineHeight: 1.55 }}>
            By clicking <strong style={{ color: '#fff' }}>"Accept &amp; Continue"</strong> you agree that:<br/><br/>

            • Nexus DEX is a non-custodial interface by Verixia Apps. We do not custody funds, control wallets, execute trades, or provide financial, investment, legal, or tax advice.<br/><br/>

            • <strong style={{ color: '#fff' }}>Compliance &amp; wallet screening.</strong> All wallet addresses are screened against U.S. OFAC, U.N., E.U., and U.K. sanctions lists via Chainalysis. Flagged wallets are denied access.<br/><br/>

            • <strong style={{ color: '#fff' }}>Restricted jurisdictions.</strong> You are not located in, a resident of, or citizen of: Iran, North Korea, Cuba, Syria, Crimea, Donetsk, Luhansk, Sevastopol, or any other jurisdiction subject to comprehensive U.S., U.N., E.U., or U.K. sanctions.<br/><br/>

            • <strong style={{ color: '#fff' }}>You are 18 or older</strong> and have full legal capacity to enter this agreement.<br/><br/>

            • All swaps, routing, liquidity, and blockchain interactions are handled by third-party protocols. All transactions are signed directly by you through your own wallet.<br/><br/>

            • DeFi and smart contracts carry substantial risk including total loss of funds. <strong style={{ color: '#fff' }}>You assume all risk.</strong><br/><br/>

            • <strong style={{ color: '#fff' }}>No reimbursement.</strong> Verixia Apps will not refund or compensate any loss, regardless of cause.<br/><br/>

            • <strong style={{ color: '#fff' }}>AS-IS / AS-AVAILABLE.</strong> No warranties of any kind.<br/><br/>

            • <strong style={{ color: '#fff' }}>No liability.</strong> Verixia Apps is not liable for any damages arising from your use of Nexus DEX.<br/><br/>

            • <strong style={{ color: '#fff' }}>No class actions.</strong> You waive any right to class action or jury trial against Verixia Apps.<br/><br/>

            • <strong style={{ color: '#fff' }}>Binding arbitration.</strong> Disputes resolved through individual arbitration only.<br/><br/>

            If you do not agree, discontinue use immediately.
          </div>
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0, padding: '8px 18px 14px',
          borderTop: '1px solid rgba(255,255,255,.04)',
          background: '#080d1a',
        }}>
          {!canAccept && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 5, fontSize: 10, color: '#586994', marginBottom: 8,
              fontWeight: 600, letterSpacing: '.04em',
            }}>
              <span>↓</span> Scroll to continue
            </div>
          )}
          <button
            onClick={canAccept ? onAccept : undefined}
            disabled={!canAccept}
            style={{
              width: '100%', padding: 12, borderRadius: 10, border: 'none',
              background: canAccept ? 'linear-gradient(135deg,#00e5ff,#0055ff)' : 'rgba(255,255,255,.05)',
              color: canAccept ? '#03060f' : '#586994',
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 14,
              cursor: canAccept ? 'pointer' : 'not-allowed',
              boxShadow: canAccept ? '0 6px 20px rgba(0,229,255,.25)' : 'none',
              transition: 'all .2s',
            }}
          >
            Accept &amp; Continue
          </button>
          <div style={{ fontSize: 9, color: '#586994', textAlign: 'center', marginTop: 8, fontWeight: 600, letterSpacing: '.06em' }}>
            NON-CUSTODIAL · NO ACCOUNT · YOUR KEYS
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// WalletModal
// =====================================================================
function WalletModal({ open, onClose }) {
  const [mState, dispatch] = useReducer(walletModalReducer, WM_INITIAL);
  const nexus = useNexusWallet();
  const {
    disconnectAll, isConnected: nexusConnected,
    extSolConnected, walletAddress, connectedWalletName,
  } = nexus;
  const { wallet: selectedWallet, select, wallets, connect: solConnect } = useWallet();
  const connectionTimerRef = useRef(null);

  const phantomWallet        = wallets.find(w => w.adapter.name === 'Phantom');
  const walletConnectWallet  = wallets.find(w => w.adapter.name === 'WalletConnect');

  useEffect(() => {
    if (!open) {
      dispatch({ type: 'RESET' });
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('nexus-scroll-locked');
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('nexus-scroll-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => () => {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
  }, []);

  useEffect(() => {
    if (mState.kind !== 'connecting') return;
    const matched = extSolConnected && selectedWallet
      && selectedWallet.adapter
      && selectedWallet.adapter.name === mState.wallet;
    if (matched) {
      if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }
      dispatch({ type: 'SCREENING' });
    }
  }, [extSolConnected, selectedWallet, mState.kind, mState.wallet]);

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
    if (!target || !selectedWallet
        || selectedWallet.adapter.name !== target
        || mState.kind !== 'connecting'
        || mState.wallet !== target) return;
    let cancelled = false;
    targetWalletRef.current = null;
    solConnect().catch(e => {
      if (cancelled) return;
      const raw = e?.message || 'Failed';
      dispatch({ type: 'ERROR', message: /reject|cancel|denied|user/i.test(raw) ? 'Connection cancelled' : raw });
    });
    return () => { cancelled = true; };
  }, [selectedWallet, solConnect, mState.kind, mState.wallet]);

  const startTimer = () => {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = setTimeout(() => dispatch({ type: 'TIMEOUT' }), CONNECTION_TIMEOUT_MS);
  };

  const handleSolanaConnect = useCallback(wallet => {
    if (!wallet?.adapter) {
      dispatch({ type: 'ERROR', message: 'Wallet not detected. Install the extension.' });
      return;
    }
    dispatch({ type: 'START', wallet: wallet.adapter.name });
    startTimer();
    targetWalletRef.current = wallet.adapter.name;
    try { select(wallet.adapter.name); }
    catch (e) {
      dispatch({ type: 'ERROR', message: 'Failed to open wallet.' });
      targetWalletRef.current = null;
    }
  }, [select]);

  const handleDisconnect = useCallback(async () => {
    try { await disconnectAll(); } catch {}
    dispatch({ type: 'RESET' });
    onClose();
  }, [disconnectAll, onClose]);

  const handleRetry = () => dispatch({ type: 'RESET' });

  const allOptions = [
    {
      key: 'phantom', name: 'Phantom', subtitle: 'Solana wallet',
      color: '#ab9ff2', icon: phantomWallet?.adapter?.icon,
      ready: !!phantomWallet, pendingMatch: 'Phantom',
      onClick: () => handleSolanaConnect(phantomWallet),
    },
    {
      key: 'walletconnect', name: 'WalletConnect', subtitle: 'Scan QR or link any wallet',
      color: '#3b99fc', icon: WALLETCONNECT_LOGO,
      ready: !!walletConnectWallet, pendingMatch: 'WalletConnect',
      onClick: () => handleSolanaConnect(walletConnectWallet),
    },
  ];

  const availableOpts = allOptions.filter(o => o.ready);
  const isConnecting  = mState.kind === 'connecting' || mState.kind === 'screening';
  const isTimedOut    = mState.kind === 'timeout';
  const isBlocked     = mState.kind === 'blocked';
  const isScreening   = mState.kind === 'screening';
  const pendingWallet = (isConnecting || isTimedOut) ? mState.wallet : null;
  const anyConnected  = nexusConnected;
  const displayAddr   = walletAddress ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4) : null;

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 501,
        background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        maxHeight: 'min(85vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 24px 16px' }}>
          <div
            onClick={onClose}
            style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 20px', cursor: 'pointer', padding: '8px 0', boxSizing: 'content-box' }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
              {isBlocked ? 'Access Restricted' : anyConnected ? 'Wallet Connected' : 'Connect Wallet'}
            </div>
            {displayAddr && !isBlocked && (
              <div style={{ fontSize: 13, color: '#586994' }}>
                {(connectedWalletName || 'Wallet')}: {displayAddr}
              </div>
            )}
            {isScreening && (
              <div style={{ fontSize: 12, color: C.accent, marginTop: 4 }}>Verifying wallet address...</div>
            )}
            {!anyConnected && !isBlocked && !isScreening && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Pick one. We never see your keys.</div>
            )}
          </div>
        </div>
        <div className="scroll-contain" style={{ flex: 1, padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
          {isBlocked ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.35)', borderRadius: 16, padding: '16px 18px' }}>
                <div style={{ color: '#ff3b6b', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Wallet not eligible</div>
                <div style={{ color: '#cdd6f4', fontSize: 12, lineHeight: 1.55 }}>
                  {mState.message} This is automated screening against major sanctions lists. If you believe this is an error, please try a different wallet.
                </div>
              </div>
              <button onClick={handleRetry} style={{ background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.30)', borderRadius: 16, padding: 14, cursor: 'pointer', width: '100%', color: C.accent, fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>
                Try a different wallet
              </button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 12, cursor: 'pointer', color: '#586994', fontSize: 13, fontFamily: 'Syne, sans-serif' }}>
                Close
              </button>
            </div>
          ) : anyConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
                <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {displayAddr || '(provisioning...)'}
                </div>
              </div>
              <button onClick={handleDisconnect} style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}>
                Disconnect
              </button>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}>
                Close
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto', paddingTop: 8 }}>
              {(mState.kind === 'error' || isTimedOut) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'rgba(255,149,0,.10)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '10px 14px' }}>
                  <span style={{ color: '#ff9500', fontSize: 12, fontWeight: 600 }}>{mState.message}</span>
                  <button onClick={handleRetry} style={{ background: 'transparent', border: '1px solid #ff9500', color: '#ff9500', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne, sans-serif', fontWeight: 700, cursor: 'pointer' }}>
                    Retry
                  </button>
                </div>
              )}
              {availableOpts.length > 0 ? availableOpts.map(opt => {
                const isPending = isConnecting && pendingWallet === opt.pendingMatch;
                const disabled  = isConnecting || isTimedOut;
                return (
                  <button key={opt.key} onClick={opt.onClick} disabled={disabled} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: isPending ? 'rgba(0,229,255,.12)' : 'rgba(255,255,255,.025)',
                    border: '1px solid ' + (isPending ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)'),
                    borderRadius: 12, padding: '11px 14px',
                    cursor: disabled ? 'wait' : 'pointer', width: '100%',
                    opacity: isTimedOut && !isPending ? 0.55 : 1,
                    transition: 'background .15s, border-color .15s',
                  }}>
                    <WalletIcon src={opt.icon} fallbackLetter={opt.name} color={opt.color} size={32} />
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{opt.name}</div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isPending ? (isScreening ? 'Verifying address...' : 'Check your wallet...') : opt.subtitle}
                      </div>
                    </div>
                    {isPending && <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />}
                  </button>
                );
              }) : (
                <div style={{ background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 12, padding: '14px 16px', color: C.red, fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
                  No wallets detected. Install Phantom or open from your wallet browser.
                </div>
              )}
              <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 6 }}>Non-custodial. We never see or store your keys.</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Nav icons
// =====================================================================
function IconSwap()       { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconWallet()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
function IconMarkets()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>; }
function IconBridge()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 Q12 4 20 12"/><path d="M4 12v4"/><path d="M20 12v4"/><path d="M4 16h16"/><path d="M9 12v4"/><path d="M15 12v4"/></svg>; }
function IconWonderland() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 6.4L21 10l-5.4 4 1.8 7L12 17.5 6.6 21l1.8-7L3 10l6.6-1.6L12 2z"/>
    </svg>
  );
}

const NAV_ICONS = {
  swap:       IconSwap,
  bridge:     IconBridge,
  wonderland: IconWonderland,
  markets:    IconMarkets,
  portfolio:  IconWallet,
};

const NAV_TABS = [
  { id: 'swap',       label: 'Swap' },
  { id: 'bridge',     label: 'Bridge' },
  { id: 'wonderland', label: 'Wonderland' },
  { id: 'markets',    label: 'Markets' },
  { id: 'portfolio',  label: 'Wallet' },
];

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet   = useAppWallet();
  const [tab, setTab] = useState(() => tabFromPathname(location.pathname));
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 769);

  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem('nexus_terms_accepted_v3') === '1'; } catch { return false; }
  });

  useEffect(() => {
    let to;
    const h = () => { clearTimeout(to); to = setTimeout(() => setIsMobile(window.innerWidth < 769), 150); };
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('resize', h); clearTimeout(to); };
  }, []);

  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  useEffect(() => {
    const newTab = tabFromPathname(location.pathname);
    if (newTab !== tab) setTab(newTab);
  }, [location.pathname, tab]);

  const switchTab = useCallback(newTab => {
    if (newTab === tab) return;
    navigate(TAB_TO_PATH[newTab] || '/swap');
    setTab(newTab);
    window.scrollTo(0, 0);
  }, [tab, navigate]);
  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  const sharedProps = {
    isConnected:      wallet.isConnected,
    solConnected:     wallet.solConnected,
    walletAddress:    wallet.walletAddress,
    publicKey:        wallet.publicKey,
    activeWalletKind: wallet.activeWalletKind,
    onConnectWallet:  openWallet,
  };
  const displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '...' + wallet.walletAddress.slice(-4)
    : null;

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
            {NAV_TABS.map(t => (
              <button key={t.id} onClick={() => switchTab(t.id)} style={{
                background: tab === t.id ? 'rgba(0,229,255,.09)' : 'transparent',
                border: tab === t.id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
                borderRadius: 8, padding: '5px 12px',
                color: tab === t.id ? C.accent : C.muted,
                fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>{t.label}</button>
            ))}
          </nav>
          <div className="mobile-nav" style={{ flex: 1 }} />
          <button onClick={openWallet} style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none',
            borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12,
            color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap',
          }}>
            {wallet.isConnected ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />{displayAddress}</>) : 'Connect Wallet'}
          </button>
        </div>
      </header>
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap'       && <SwapWidget       {...sharedProps} />}
        {tab === 'bridge'     && <CrossChainSwap   onConnectWallet={openWallet} />}
        {tab === 'wonderland' && <MemeWonderland   onConnectWallet={openWallet} />}
        {tab === 'markets'    && <Stocks           {...sharedProps} />}
        {tab === 'portfolio'  && <Portfolio        onConnectWallet={openWallet} />}
      </main>
      <nav className="mobile-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0,229,255,.1)',
        display: 'flex', alignItems: 'stretch',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {NAV_TABS.map(t => {
          const Icon = NAV_ICONS[t.id];
          return (
            <button key={t.id} onClick={() => switchTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 3,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t.id ? C.accent : C.muted,
              fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
              padding: '6px 2px', minHeight: 54, position: 'relative',
            }}>
              {tab === t.id && (
                <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />
              )}
              <Icon />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Terms gate renders on top of the site */}
      {!termsAccepted && (
        <TermsGate onAccept={() => {
          try { localStorage.setItem('nexus_terms_accepted_v3', '1'); } catch {}
          setTermsAccepted(true);
        }} />
      )}

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}

export default function App() { return (<BrowserRouter><AppInner /></BrowserRouter>); }
