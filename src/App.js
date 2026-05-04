/**

- NEXUS DEX — App shell
- 
- Owns:
- - Routes (BrowserRouter, path-based tab state)
- - Header (logo + network selector + connect button)
- - Mobile bottom navigation
- - WalletModal (single state-machine connect flow — fixes WC1-WC7)
- - Mobile in-app wallet banner
- - Market data fetching (CoinGecko + Jupiter token list)
- - Page routing: Swap, Buy, Markets, Portfolio, Send, New Launches, Launch, Token detail
- 
- Fixes vs old version:
- - Removed dead `useAppWallet` shim (was just a passthrough to useNexusWallet)
- - Deduplicated HEADER_TABS and NAV_TABS into a single NAV_TABS constant
- - Network selector now LEFT of Connect Wallet button (per locked rule)
- - WalletModal: single useReducer state machine instead of 3 useEffects
- ```
  racing each other. Fixes WC1, WC3, WC5.
  ```
- - WalletConnect path opens Web3Modal FIRST, closes our modal after a
- ```
  small delay — fixes WC2 (interrupted promise on slow devices).
  ```
- - All connect errors now surface to the user via the modal — fixes WC6.
- - Mobile in-app wallet banner shown when user is in mobile Safari/Chrome
- ```
  with no wallet detected, with deep links to open in Phantom/MetaMask.
  ```
- - BuyCrypto now receives sharedProps (was missing isConnected etc — M13).
- - Market cache has schema version key — old cached data won’t break users
- ```
  when we change cache shape (H15).
  ```
- - Header chain selector lives in WalletContext, persists in localStorage.
- 
- Known limitations (deferred to later rounds):
- - Direct browser calls to api.coingecko.com and lite-api.jup.ag still
- ```
  bypass server proxy (H14). Round 4 will add /api/coingecko/* and
  ```
- ```
  /api/jup/* proxy paths. Quota burn risk acknowledged.
  ```
- - Privy embedded wallets deferred to Round 6.
    */

import React, { useState, useEffect, useCallback, useRef, useReducer, useMemo } from ‘react’;
import { BrowserRouter, useNavigate, useLocation } from ‘react-router-dom’;
import { useWallet } from ‘@solana/wallet-adapter-react’;
import { useWeb3Modal } from ‘@web3modal/wagmi/react’;

import { useNexusWallet } from ‘./WalletContext.js’;
import SwapWidget from ‘./components/SwapWidget.jsx’;
import Markets from ‘./components/Markets.js’;
import BuyCrypto from ‘./components/BuyCrypto.js’;
import Portfolio from ‘./components/Portfolio.js’;
import TokenDetail from ‘./components/TokenDetail.js’;
import Send from ‘./components/Send.js’;
import NewLaunches from ‘./components/NewLaunches.js’;
import TokenLaunch from ‘./components/TokenLaunch.js’;

/* ============================================================================

- CONSTANTS
- ========================================================================= */

const C = {
bg: ‘#03060f’, card: ‘#080d1a’, card2: ‘#0c1220’, card3: ‘#111d30’,
border: ‘rgba(0,229,255,0.10)’, borderHi: ‘rgba(0,229,255,0.25)’,
accent: ‘#00e5ff’, green: ‘#00ffa3’, red: ‘#ff3b6b’,
text: ‘#cdd6f4’, muted: ‘#586994’, muted2: ‘#2e3f5e’,
buyGrad:  ‘linear-gradient(135deg,#00e5ff,#00b8d4)’,
sellGrad: ‘linear-gradient(135deg,#ff3b6b,#c2185b)’,
};

// Single nav definition — used by both desktop header and mobile bottom nav.
// Removed the duplicate HEADER_TABS that was identical to this.
const NAV_TABS = [
{ key: ‘swap’,       label: ‘Swap’,     path: ‘/’ },
{ key: ‘buy’,        label: ‘Buy’,      path: ‘/buy’ },
{ key: ‘markets’,    label: ‘Markets’,  path: ‘/markets’ },
{ key: ‘launches’,   label: ‘New’,      path: ‘/new-launches’ },
{ key: ‘portfolio’,  label: ‘Wallet’,   path: ‘/portfolio’ },
];

// Header chain selector options. Order: Solana first (most active),
// then Tier 1 EVM chains, then alpha by name.
const HEADER_CHAINS = [
{ id: ‘solana’, label: ‘Solana’,   symbol: ‘SOL’,  color: ‘#9945ff’ },
{ id: 1,        label: ‘Ethereum’, symbol: ‘ETH’,  color: ‘#627eea’ },
{ id: 8453,     label: ‘Base’,     symbol: ‘ETH’,  color: ‘#0052ff’ },
{ id: 42161,    label: ‘Arbitrum’, symbol: ‘ETH’,  color: ‘#28a0f0’ },
{ id: 10,       label: ‘Optimism’, symbol: ‘ETH’,  color: ‘#ff0420’ },
{ id: 137,      label: ‘Polygon’,  symbol: ‘POL’,  color: ‘#8247e5’ },
{ id: 56,       label: ‘BNB’,      symbol: ‘BNB’,  color: ‘#f3ba2f’ },
{ id: 43114,    label: ‘Avalanche’,symbol: ‘AVAX’, color: ‘#e84142’ },
{ id: 59144,    label: ‘Linea’,    symbol: ‘ETH’,  color: ‘#000000’ },
{ id: 534352,   label: ‘Scroll’,   symbol: ‘ETH’,  color: ‘#ffeeda’ },
{ id: 5000,     label: ‘Mantle’,   symbol: ‘MNT’,  color: ‘#000000’ },
{ id: 81457,    label: ‘Blast’,    symbol: ‘ETH’,  color: ‘#fcfc03’ },
{ id: 324,      label: ‘zkSync’,   symbol: ‘ETH’,  color: ‘#1e69ff’ },
{ id: 100,      label: ‘Gnosis’,   symbol: ‘xDAI’, color: ‘#3e6957’ },
{ id: 250,      label: ‘Fantom’,   symbol: ‘FTM’,  color: ‘#1969ff’ },
{ id: 25,       label: ‘Cronos’,   symbol: ‘CRO’,  color: ‘#002d74’ },
{ id: 80094,    label: ‘Berachain’,symbol: ‘BERA’, color: ‘#814625’ },
{ id: 130,      label: ‘Unichain’, symbol: ‘ETH’,  color: ‘#ff007a’ },
];

// Market data cache — versioned so cache-shape changes don’t break users.
const MARKET_CACHE_KEY     = ‘nexus_markets_cache_v2’;
const MARKET_CACHE_TTL_MS  = 90_000; // 90 seconds — slightly longer than refresh interval

/* ============================================================================

- UTILS
- ========================================================================= */

function isMobileUserAgent() {
if (typeof navigator === ‘undefined’) return false;
return /iphone|ipad|ipod|android/i.test(navigator.userAgent || ‘’);
}

function safeReadCache() {
try {
const raw = localStorage.getItem(MARKET_CACHE_KEY);
if (!raw) return null;
const parsed = JSON.parse(raw);
if (!parsed || typeof parsed.t !== ‘number’ || !Array.isArray(parsed.coins)) return null;
if (Date.now() - parsed.t > MARKET_CACHE_TTL_MS) return null;
return parsed.coins;
} catch { return null; }
}

function safeWriteCache(coins) {
try {
localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ t: Date.now(), coins }));
} catch { /* quota or private mode — ignore */ }
}

/* ============================================================================

- NETWORK SELECTOR DROPDOWN
- 
- Lives in the header to the LEFT of the Connect Wallet button.
- Selecting a chain updates `headerChain` in WalletContext, which is
- persisted to localStorage and read by SwapWidget for default token pairs.
- ========================================================================= */

function NetworkSelector({ headerChain, onSelect, compact = false }) {
const [open, setOpen] = useState(false);
const ref = useRef(null);

// Close on outside click
useEffect(() => {
if (!open) return;
function onDocClick(e) {
if (ref.current && !ref.current.contains(e.target)) setOpen(false);
}
document.addEventListener(‘mousedown’, onDocClick);
return () => document.removeEventListener(‘mousedown’, onDocClick);
}, [open]);

const current = HEADER_CHAINS.find((c) => c.id === headerChain) || HEADER_CHAINS[0];

return (
<div ref={ref} style={{ position: ‘relative’ }}>
<button
onClick={() => setOpen((v) => !v)}
style={{
display: ‘flex’, alignItems: ‘center’, gap: 6,
background: C.card2, border: ’1px solid ’ + C.border,
borderRadius: 10, padding: compact ? ‘6px 8px’ : ‘8px 12px’,
color: C.text, cursor: ‘pointer’,
fontFamily: ‘Syne, sans-serif’, fontSize: compact ? 11 : 13, fontWeight: 700,
minHeight: compact ? 32 : 38,
}}
title=“Select destination network”
>
<span style={{
width: 8, height: 8, borderRadius: ‘50%’, background: current.color, flexShrink: 0,
}} />
{!compact && <span style={{ color: ‘#fff’ }}>{current.label}</span>}
{compact && <span style={{ color: ‘#fff’ }}>{current.symbol}</span>}
<span style={{ color: C.muted, fontSize: 9, marginLeft: 2 }}>▾</span>
</button>

```
  {open && (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0,
      width: 220, maxHeight: 360, overflowY: 'auto',
      background: C.card, border: '1px solid ' + C.borderHi,
      borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,.6)',
      zIndex: 200, padding: 6,
    }}>
      {HEADER_CHAINS.map((ch) => (
        <button
          key={String(ch.id)}
          onClick={() => { onSelect(ch.id); setOpen(false); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px 10px', borderRadius: 8,
            background: ch.id === headerChain ? 'rgba(0,229,255,.08)' : 'transparent',
            border: 'none', color: '#fff', cursor: 'pointer',
            textAlign: 'left', fontFamily: 'Syne, sans-serif', fontSize: 13,
          }}
        >
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: ch.color, flexShrink: 0,
          }} />
          <span style={{ flex: 1 }}>{ch.label}</span>
          <span style={{ color: C.muted, fontSize: 11 }}>{ch.symbol}</span>
        </button>
      ))}
    </div>
  )}
</div>
```

);
}

/* ============================================================================

- MOBILE IN-APP WALLET BANNER
- 
- Shown when user is on mobile Safari/Chrome with no wallet detected.
- Provides one-tap deep links to open the site inside Phantom or MetaMask
- mobile (their in-app browsers have wallet auto-injected).
- 
- Hidden on desktop, hidden if a wallet is already connected, hidden if
- we’re already inside a wallet’s in-app browser.
- ========================================================================= */

function MobileInAppBanner({ onDismiss }) {
const [dismissed, setDismissed] = useState(false);

// Re-show after each session — but allow dismiss for the current session
// via session-storage (not localStorage — we want users to see it again later).
useEffect(() => {
try {
if (sessionStorage.getItem(‘nexus_in_app_banner_dismissed’) === ‘1’) {
setDismissed(true);
}
} catch { /* ignore */ }
}, []);

function handleDismiss() {
try { sessionStorage.setItem(‘nexus_in_app_banner_dismissed’, ‘1’); } catch { /* ignore */ }
setDismissed(true);
if (onDismiss) onDismiss();
}

if (dismissed) return null;

// Build deep links. Both wallets accept https://… URLs to open in their browser.
const url = (typeof window !== ‘undefined’ ? window.location.href : ‘’);
const phantomLink = ‘https://phantom.app/ul/browse/’ + encodeURIComponent(url);
const metamaskLink = ‘https://metamask.app.link/dapp/’ + url.replace(/^https?:///, ‘’);

return (
<div style={{
background: ‘linear-gradient(135deg,rgba(153,69,255,.18),rgba(0,229,255,.12))’,
border: ‘1px solid ’ + C.borderHi, borderRadius: 12,
padding: 12, margin: ‘0 12px 12px’,
display: ‘flex’, flexDirection: ‘column’, gap: 10,
}}>
<div style={{ display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘flex-start’, gap: 8 }}>
<div>
<div style={{ color: ‘#fff’, fontWeight: 800, fontSize: 13, marginBottom: 4 }}>
For best mobile experience
</div>
<div style={{ color: C.muted, fontSize: 12, lineHeight: 1.4 }}>
Open this site inside your wallet’s browser. Signing happens in
one tap, no app switching.
</div>
</div>
<button
onClick={handleDismiss}
aria-label=“Dismiss”
style={{
background: ‘transparent’, border: ‘none’, color: C.muted,
fontSize: 18, cursor: ‘pointer’, padding: 0, lineHeight: 1,
}}
>×</button>
</div>

```
  <div style={{ display: 'flex', gap: 8 }}>
    <a
      href={phantomLink}
      style={{
        flex: 1, padding: '10px 8px', borderRadius: 8,
        background: '#9945ff', color: '#fff', textDecoration: 'none',
        textAlign: 'center', fontFamily: 'Syne, sans-serif',
        fontWeight: 700, fontSize: 12,
      }}
    >Open in Phantom</a>
    <a
      href={metamaskLink}
      style={{
        flex: 1, padding: '10px 8px', borderRadius: 8,
        background: '#f6851b', color: '#fff', textDecoration: 'none',
        textAlign: 'center', fontFamily: 'Syne, sans-serif',
        fontWeight: 700, fontSize: 12,
      }}
    >Open in MetaMask</a>
  </div>
</div>
```

);
}

/* ============================================================================

- WALLET MODAL — single state machine (fixes WC1, WC3, WC5, WC6)
- 
- State machine:
- idle ──open──> selecting ──pickWallet──> connecting ──>(success)──> connected
- ```
                                                    └─>(error)───> error
  ```
- error ──retry──> selecting
- any   ──close──> idle
- 
- Implemented as a useReducer so transitions are explicit and observable.
- ========================================================================= */

const WM_INITIAL = { kind: ‘idle’, message: ‘’, wallet: ‘’ };

function walletModalReducer(state, action) {
switch (action.type) {
case ‘OPEN’:         return { kind: ‘selecting’, message: ‘’, wallet: ‘’ };
case ‘CLOSE’:        return WM_INITIAL;
case ‘CONNECTING’:   return { kind: ‘connecting’, message: ‘’, wallet: action.wallet };
case ‘CONNECTED’:    return WM_INITIAL;  // close on success
case ‘ERROR’:        return { kind: ‘error’, message: action.message || ‘Connection failed’, wallet: state.wallet };
case ‘RETRY’:        return { kind: ‘selecting’, message: ‘’, wallet: ‘’ };
default:             return state;
}
}

function WalletModal({ open, onRequestClose, onConnected }) {
const [state, dispatch] = useReducer(walletModalReducer, WM_INITIAL);

// Solana wallet adapter
const { wallets, wallet: solWallet, select, connect: connectSol, connected: solConnected } = useWallet();
// EVM (wagmi)
const evmWallet = useNexusWallet();
const evmConnected = evmWallet.evmConnected;
// Web3Modal
const { open: openWeb3Modal } = useWeb3Modal();

// Sync external `open` prop with internal state machine
useEffect(() => {
if (open && state.kind === ‘idle’)      dispatch({ type: ‘OPEN’ });
if (!open && state.kind !== ‘idle’)     dispatch({ type: ‘CLOSE’ });
}, [open, state.kind]);

// Auto-close once the SPECIFIC wallet they selected actually connects.
// For Solana picks: also confirm the connected adapter matches what they
// picked (otherwise switching from one Solana wallet to another would
// close immediately based on the still-connected old wallet).
useEffect(() => {
if (state.kind !== ‘connecting’) return;
let matched = false;
if (state.wallet === ‘walletconnect’) {
// For WalletConnect we can’t reliably distinguish “new connection” from
// “already connected”; trust evmConnected as a signal.
matched = evmConnected;
} else {
matched = solConnected
&& !!solWallet
&& solWallet.adapter
&& solWallet.adapter.name === state.wallet;
}
if (matched) {
dispatch({ type: ‘CONNECTED’ });
if (onConnected) onConnected();
if (onRequestClose) onRequestClose();
}
}, [solConnected, evmConnected, solWallet, state.kind, state.wallet, onConnected, onRequestClose]);

/* — Solana connect flow (ref-based wait for select() to propagate) — */
const targetWalletRef = useRef(null);

useEffect(() => {
// Fires when select() has propagated and `solWallet` matches our target.
// This is the “select() resolved” signal — we now know which adapter
// useWallet() will use, so we can call connect() safely.
const target = targetWalletRef.current;
if (!target) return;
if (!solWallet || solWallet.adapter.name !== target) return;
if (state.kind !== ‘connecting’) return;
if (state.wallet !== target) return;

```
let cancelled = false;
targetWalletRef.current = null; // clear immediately so this effect doesn't double-fire

(async () => {
  try {
    await connectSol();
    // Don't dispatch CONNECTED here — the solConnected effect above does it.
    // (Connecting an adapter doesn't always set solConnected synchronously.)
  } catch (e) {
    if (cancelled) return;
    const msg = (e && e.message) ? e.message : 'Failed to connect wallet';
    // Filter out the noisy "user rejected" message — show a friendlier one
    const friendly = /reject|cancel|denied/i.test(msg) ? 'Connection canceled' : msg;
    dispatch({ type: 'ERROR', message: friendly });
  }
})();

return () => { cancelled = true; };
```

}, [solWallet, connectSol, state.kind, state.wallet]);

function handleSolanaPick(walletName) {
dispatch({ type: ‘CONNECTING’, wallet: walletName });
targetWalletRef.current = walletName;
// select() updates internal wallet-adapter state; our effect picks up the change.
try { select(walletName); }
catch (e) {
dispatch({ type: ‘ERROR’, message: (e && e.message) || ‘Failed to select wallet’ });
targetWalletRef.current = null;
}
}

function handleWalletConnect() {
dispatch({ type: ‘CONNECTING’, wallet: ‘walletconnect’ });
try {
// Open Web3Modal FIRST so the open promise isn’t interrupted by our
// modal closing (fixes WC2). Then close ours after a short delay.
openWeb3Modal({ view: ‘Connect’ });
// Brief delay before closing our modal so the Web3Modal handoff is clean.
// The auto-close effect above handles the case where connect completes
// before this fires; double-closing is a no-op.
setTimeout(() => {
if (onRequestClose) onRequestClose();
}, 200);
} catch (e) {
dispatch({ type: ‘ERROR’, message: ‘WalletConnect failed to open’ });
}
}

// Only render the modal contents when not idle.
if (state.kind === ‘idle’) return null;

// Filter wallet list to only those installed/detected (better UX than greyed-out).
// The wallet-standard adapter populates `wallets` with all adapters; we show all
// here since user might want to install one. Mark as “Detected” if readyState says so.
const displayedSolWallets = wallets || [];

return (
<>
{/* backdrop */}
<div onClick={() => onRequestClose && onRequestClose()} style={{
position: ‘fixed’, inset: 0, zIndex: 999, background: ‘rgba(0,0,0,.85)’,
}} />
{/* modal */}
<div style={{
position: ‘fixed’, top: ‘50%’, left: ‘50%’, transform: ‘translate(-50%,-50%)’,
zIndex: 1000, width: ‘92vw’, maxWidth: 420,
background: C.card, border: ’1px solid ’ + C.borderHi,
borderRadius: 18, boxShadow: ‘0 24px 80px rgba(0,0,0,.95)’,
padding: 20, maxHeight: ‘90vh’, overflowY: ‘auto’,
}}>
<div style={{ display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘center’, marginBottom: 16 }}>
<div style={{ color: ‘#fff’, fontWeight: 800, fontSize: 17 }}>Connect Wallet</div>
<button onClick={() => onRequestClose && onRequestClose()} aria-label=“Close” style={{
background: ‘none’, border: ‘none’, color: C.muted, cursor: ‘pointer’,
fontSize: 22, padding: 0, lineHeight: 1,
}}>×</button>
</div>

```
    {/* Connecting / error banner */}
    {state.kind === 'connecting' && (
      <div style={{
        padding: 10, marginBottom: 12, background: 'rgba(0,229,255,.08)',
        border: '1px solid ' + C.borderHi, borderRadius: 10,
        color: C.accent, fontSize: 12, textAlign: 'center',
      }}>
        Check your wallet app… ({state.wallet})
      </div>
    )}
    {state.kind === 'error' && (
      <div style={{
        padding: 10, marginBottom: 12,
        background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.3)',
        borderRadius: 10, color: C.red, fontSize: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
      }}>
        <span>{state.message}</span>
        <button onClick={() => dispatch({ type: 'RETRY' })} style={{
          background: 'transparent', border: '1px solid ' + C.red,
          color: C.red, padding: '3px 8px', borderRadius: 6,
          fontSize: 11, fontFamily: 'Syne, sans-serif', cursor: 'pointer',
        }}>Retry</button>
      </div>
    )}

    {/* Solana section */}
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
        SOLANA
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {displayedSolWallets.map((w) => (
          <button
            key={w.adapter.name}
            disabled={state.kind === 'connecting'}
            onClick={() => handleSolanaPick(w.adapter.name)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 10,
              background: C.card2, border: '1px solid ' + C.border,
              cursor: state.kind === 'connecting' ? 'not-allowed' : 'pointer',
              opacity: state.kind === 'connecting' ? .5 : 1,
              fontFamily: 'Syne, sans-serif',
            }}
          >
            {w.adapter.icon && (
              <img src={w.adapter.icon} alt={w.adapter.name} style={{ width: 24, height: 24, borderRadius: 6 }} />
            )}
            <span style={{ flex: 1, color: '#fff', fontWeight: 700, fontSize: 13, textAlign: 'left' }}>
              {w.adapter.name}
            </span>
            {w.readyState === 'Installed' && (
              <span style={{ fontSize: 10, color: C.green, fontWeight: 700 }}>DETECTED</span>
            )}
          </button>
        ))}
      </div>
    </div>

    {/* EVM / WalletConnect section */}
    <div>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: .8, marginBottom: 8 }}>
        EVM (Ethereum, Base, BNB, etc.)
      </div>
      <button
        disabled={state.kind === 'connecting' && state.wallet !== 'walletconnect'}
        onClick={handleWalletConnect}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '10px 12px', borderRadius: 10,
          background: 'linear-gradient(135deg,#3b99fc,#2772d2)',
          border: 'none', color: '#fff', cursor: 'pointer',
          fontFamily: 'Syne, sans-serif',
          opacity: (state.kind === 'connecting' && state.wallet !== 'walletconnect') ? .5 : 1,
        }}
      >
        <span style={{ fontSize: 18 }}>↗</span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13, textAlign: 'left' }}>
          MetaMask / Rabby / WalletConnect
        </span>
      </button>
    </div>

    <div style={{ marginTop: 16, fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.4 }}>
      By connecting, you agree to our terms.<br/>
      We never see your private keys or seed phrase.
    </div>
  </div>
</>
```

);
}

/* ============================================================================

- HEADER (desktop) and MobileBottomNav
- ========================================================================= */

function Header({ onConnect, onDisconnect, walletShort, isConnected, headerChain, onHeaderChainChange, isMobile }) {
const navigate = useNavigate();
const location = useLocation();
const currentTab = NAV_TABS.find((t) => t.path === location.pathname) || NAV_TABS[0];

return (
<header style={{
position: ‘sticky’, top: 0, zIndex: 100,
background: ‘rgba(3,6,15,.92)’, backdropFilter: ‘blur(8px)’,
borderBottom: ‘1px solid ’ + C.border,
padding: isMobile ? ‘10px 12px’ : ‘12px 24px’,
}}>
<div style={{
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘space-between’,
gap: 12, maxWidth: 1400, margin: ‘0 auto’,
}}>
{/* Logo */}
<div
onClick={() => navigate(’/’)}
style={{
display: ‘flex’, alignItems: ‘center’, gap: 8, cursor: ‘pointer’, flexShrink: 0,
}}
>
<div style={{
width: 32, height: 32, borderRadius: 8,
background: ‘linear-gradient(135deg,#00e5ff,#9945ff)’,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
fontFamily: ‘Syne, sans-serif’, fontWeight: 900, color: ‘#03060f’, fontSize: 15,
}}>N</div>
{!isMobile && (
<span style={{
color: ‘#fff’, fontFamily: ‘Syne, sans-serif’, fontWeight: 800, fontSize: 17,
letterSpacing: .5,
}}>NEXUS</span>
)}
</div>

```
    {/* Desktop tabs */}
    {!isMobile && (
      <nav style={{ display: 'flex', gap: 4 }}>
        {NAV_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => navigate(t.path)}
            style={{
              padding: '8px 14px', borderRadius: 10, border: 'none',
              background: t.key === currentTab.key ? 'rgba(0,229,255,.12)' : 'transparent',
              color: t.key === currentTab.key ? C.accent : C.muted,
              fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', transition: 'all .15s',
            }}
          >{t.label}</button>
        ))}
      </nav>
    )}

    {/* Right side — Network selector LEFT of Connect button */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <NetworkSelector
        headerChain={headerChain}
        onSelect={onHeaderChainChange}
        compact={isMobile}
      />

      {isConnected ? (
        <button
          onClick={onDisconnect}
          style={{
            padding: isMobile ? '6px 10px' : '8px 14px', borderRadius: 10,
            background: C.card2, border: '1px solid ' + C.borderHi,
            color: C.text, fontFamily: 'JetBrains Mono, monospace',
            fontSize: isMobile ? 11 : 12, cursor: 'pointer',
            minHeight: isMobile ? 32 : 38,
          }}
          title="Click to disconnect"
        >{walletShort}</button>
      ) : (
        <button
          onClick={onConnect}
          style={{
            padding: isMobile ? '6px 12px' : '8px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg,#9945ff,#7c3aed)',
            border: 'none', color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700,
            fontSize: isMobile ? 12 : 13, cursor: 'pointer',
            minHeight: isMobile ? 32 : 38,
          }}
        >Connect</button>
      )}
    </div>
  </div>
</header>
```

);
}

function MobileBottomNav() {
const navigate = useNavigate();
const location = useLocation();
const currentTab = NAV_TABS.find((t) => t.path === location.pathname) || NAV_TABS[0];

return (
<nav style={{
position: ‘fixed’, bottom: 0, left: 0, right: 0, zIndex: 90,
background: ‘rgba(3,6,15,.96)’, backdropFilter: ‘blur(8px)’,
borderTop: ’1px solid ’ + C.border,
padding: ‘8px 0 max(8px,env(safe-area-inset-bottom))’,
display: ‘flex’, justifyContent: ‘space-around’,
}}>
{NAV_TABS.map((t) => (
<button
key={t.key}
onClick={() => navigate(t.path)}
style={{
flex: 1, padding: ‘6px 4px’,
background: ‘transparent’, border: ‘none’,
color: t.key === currentTab.key ? C.accent : C.muted,
fontFamily: ‘Syne, sans-serif’, fontWeight: 700, fontSize: 11,
cursor: ‘pointer’,
}}
>{t.label}</button>
))}
</nav>
);
}

/* ============================================================================

- MARKET DATA FETCHING
- 
- NOTE: direct browser calls to coingecko/jup.ag (H14). To be migrated to
- server-side proxies in Round 4. For now, kept as-is to avoid blocking
- everything else.
- ========================================================================= */

const CG_IDS = [
‘bitcoin’,‘ethereum’,‘solana’,‘binancecoin’,‘ripple’,‘cardano’,‘dogecoin’,
‘avalanche-2’,‘polkadot’,‘tron’,‘chainlink’,‘toncoin’,‘polygon-ecosystem-token’,
‘shiba-inu’,‘near’,‘aptos’,‘arbitrum’,‘optimism’,‘sui’,‘injective-protocol’,
‘render-token’,‘stacks’,‘filecoin’,‘sei-network’,‘jupiter-exchange-solana’,
‘pyth-network’,‘jito-governance-token’,‘bonk’,‘dogwifcoin’,‘popcat’,
‘helium’,‘internet-computer’,‘litecoin’,‘bitcoin-cash’,‘uniswap’,‘aave’,
‘maker’,‘pepe’,‘floki’, ‘usd-coin’, ‘tether’, ‘dai’,
];

async function fetchCoinGeckoMarkets() {
const ids = CG_IDS.join(’,’);
const url = ‘https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=’ + encodeURIComponent(ids) + ‘&per_page=100&page=1&sparkline=false&price_change_percentage=24h’;
try {
const r = await fetch(url);
if (!r.ok) return [];
const data = await r.json();
if (!Array.isArray(data)) return [];
return data.map((d) => ({
id: d.id,
symbol: (d.symbol || ‘’).toUpperCase(),
name: d.name || d.id,
image: d.image || null,
price: d.current_price || 0,
pct24h: d.price_change_percentage_24h || 0,
marketCap: d.market_cap || 0,
volume: d.total_volume || 0,
isCG: true,
}));
} catch { return []; }
}

async function fetchJupiterTokens() {
// Light token list — enough for Markets to show top verified Solana tokens.
// Note: Jupiter’s tagged endpoint takes a single tag; we use ‘verified’
// for a curated list. ‘all’ would return tens of thousands of tokens.
try {
const r = await fetch(‘https://lite-api.jup.ag/tokens/v1/tagged/verified’);
if (!r.ok) return [];
const data = await r.json();
if (!Array.isArray(data)) return [];
return data.slice(0, 200).map((t) => ({
id: ‘jup-’ + t.address,
symbol: (t.symbol || ‘’).toUpperCase(),
name: t.name || t.symbol || t.address.slice(0, 6),
image: t.logoURI || null,
price: 0,         // Jupiter token endpoint doesn’t include prices — Markets fetches separately if needed
pct24h: 0,
marketCap: 0,
volume: 0,
mint: t.address,
decimals: t.decimals || 6,
chain: ‘solana’,
isJupiter: true,
}));
} catch { return []; }
}

/* ============================================================================

- APP ROOT (inside BrowserRouter)
- ========================================================================= */

function AppRoutes() {
const navigate = useNavigate();
const location = useLocation();

const wallet = useNexusWallet();
const {
isConnected, walletAddress, connectedWalletName,
headerChain, setHeaderChain, disconnectAll,
isMobileInAppWallet,
} = wallet;

const [walletModalOpen, setWalletModalOpen] = useState(false);
const [coins, setCoins] = useState(() => safeReadCache() || []);
const [coinsLoading, setCoinsLoading] = useState(coins.length === 0);

// Mobile detection — debounced resize listener
const [isMobile, setIsMobile] = useState(() => {
if (typeof window === ‘undefined’) return false;
return window.innerWidth < 768;
});
useEffect(() => {
let to = null;
function onResize() {
if (to) clearTimeout(to);
to = setTimeout(() => setIsMobile(window.innerWidth < 768), 150);
}
window.addEventListener(‘resize’, onResize);
return () => { window.removeEventListener(‘resize’, onResize); if (to) clearTimeout(to); };
}, []);

// Periodic market refresh
useEffect(() => {
let cancelled = false;
let timer = null;

```
async function refresh() {
  try {
    const [cg, jup] = await Promise.all([fetchCoinGeckoMarkets(), fetchJupiterTokens()]);
    if (cancelled) return;
    const merged = [...cg, ...jup];
    setCoins(merged);
    safeWriteCache(merged);
  } catch { /* ignore — keep stale cache */ }
  finally {
    if (!cancelled) setCoinsLoading(false);
  }
}

refresh();
timer = setInterval(refresh, 60_000);
return () => { cancelled = true; if (timer) clearInterval(timer); };
```

}, []);

// Wallet display
const walletShort = useMemo(() => {
if (!walletAddress) return ‘’;
return walletAddress.slice(0, 4) + ‘…’ + walletAddress.slice(-4);
}, [walletAddress]);

// Connect button handler
const handleConnect = useCallback(() => {
setWalletModalOpen(true);
}, []);

// Disconnect — runs both Solana and EVM disconnects
const handleDisconnect = useCallback(async () => {
if (!window.confirm(’Disconnect ’ + (connectedWalletName || ‘wallet’) + ‘?’)) return;
try { await disconnectAll(); } catch (e) {
// eslint-disable-next-line no-console
console.warn(‘Disconnect failed:’, e);
}
}, [connectedWalletName, disconnectAll]);

// Shared props for child page components
const sharedProps = {
coins, coinsLoading,
isConnected, walletAddress, connectedWalletName,
isMobile,
headerChain, setHeaderChain,
onConnectWallet: handleConnect,
};

// Show mobile in-app banner only when:
//   - On mobile UA
//   - NOT inside a wallet’s in-app browser
//   - NOT already connected (no need to switch)
const showInAppBanner = isMobile && !isMobileInAppWallet && !isConnected;

// Path-based view selection (BrowserRouter is in the parent; we use useLocation here)
let view;
switch (location.pathname) {
case ‘/’:              view = <SwapWidget {…sharedProps} />; break;
case ‘/buy’:           view = <BuyCrypto {…sharedProps} />; break;
case ‘/markets’:       view = <Markets {…sharedProps} onSelectCoin={(c) => navigate(’/token/’ + (c.id || c.mint))} />; break;
case ‘/portfolio’:     view = <Portfolio {…sharedProps} />; break;
case ‘/send’:          view = <Send {…sharedProps} />; break;
case ‘/new-launches’:  view = <NewLaunches {…sharedProps} />; break;
case ‘/launch’:        view = <TokenLaunch {…sharedProps} />; break;
default: {
if (location.pathname.startsWith(’/token/’)) {
const id = decodeURIComponent(location.pathname.slice(’/token/’.length));
const coin = coins.find((c) => c.id === id || c.mint === id) || { id, symbol: id.slice(0, 6).toUpperCase(), name: id };
view = <TokenDetail {…sharedProps} coin={coin} onBack={() => navigate(-1)} />;
} else {
view = <SwapWidget {…sharedProps} />;
}
}
}

return (
<div style={{
minHeight: ‘100vh’, background: C.bg, color: C.text,
fontFamily: ‘-apple-system, BlinkMacSystemFont, “Segoe UI”, Roboto, sans-serif’,
}}>
<Header
onConnect={handleConnect}
onDisconnect={handleDisconnect}
walletShort={walletShort}
isConnected={isConnected}
headerChain={headerChain}
onHeaderChainChange={setHeaderChain}
isMobile={isMobile}
/>

```
  {showInAppBanner && (
    <div style={{ paddingTop: 12 }}>
      <MobileInAppBanner />
    </div>
  )}

  <main style={{
    padding: isMobile ? '12px 12px 80px' : '24px',
    maxWidth: 1400, margin: '0 auto',
  }}>
    {view}
  </main>

  {isMobile && <MobileBottomNav />}

  <WalletModal
    open={walletModalOpen}
    onRequestClose={() => setWalletModalOpen(false)}
    onConnected={() => setWalletModalOpen(false)}
  />
</div>
```

);
}

/* ============================================================================

- EXPORT
- ========================================================================= */

export default function App() {
return (
<BrowserRouter>
<AppRoutes />
</BrowserRouter>
);
}