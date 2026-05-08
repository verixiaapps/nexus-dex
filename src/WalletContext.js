/**
 * NEXUS DEX - Wallet Context
 *  
 * Single source of truth for:
 *   1. Wallet connection state across FIVE wallet kinds:
 *        a) phantom        (Solana external -- adapter or in-app browser)
 *        b) solflare       (Solana external -- adapter or in-app browser)
 *        c) walletconnect  (EVM via WalletConnect protocol -- desktop QR)
 *        d) injected       (EVM via window.ethereum -- mobile in-app browser)
 *        e) privy          (email/social/passkey -> embedded Sol+EVM wallets)
 * 
 *   2. The wallet policy for the current device (which kinds are allowed):
 *        - Desktop:                 all four external + privy
 *        - Mobile in Phantom app:   phantom only
 *        - Mobile in Solflare app:  solflare only
 *        - Mobile in any EVM app:   injected only
 *        - Mobile in plain Safari:  privy only
 *
 *      The modal in App.js MUST read `walletPolicy.allowed` and only
 *      render those options. This is what stops mobile-Safari redirect
 *      loops by simply not offering the wallets that cause them.
 *
 *   3. Active context (which wallet is "primary" for the current task)
 *   4. Header network selector
 *   5. Quick Buy / Quick Sell presets
 *   6. Disconnect flow that handles all wallet types
 *
 * KEY DESIGN NOTES:
 *
 *  - We DO NOT auto-reconnect Solana on visibility change. On mobile Safari,
 *    calling solConnect() triggers a redirect-back-to-Phantom loop. Wallet-
 *    adapter's own autoConnect (configured in index.js) handles the one-shot
 *    reconnect on mount, which is enough.
 *
 *  - Wagmi's reconnectAsync() is session-based - it rehydrates from storage
 *    without prompting -- so it IS safe to call on visibility. Throttled.
 *
 *  - activeContext is the user's explicit preference. We auto-set it once
 *    when only one wallet is connected, and clear it when both disconnect.
 *    We never override an existing value just because headerChain changed.
 *
 * Privy notes:
 *  - Privy embedded wallets are NON-CUSTODIAL. Keys live in user device +
 *    Privy's TEE infra. Neither Privy nor we can access them.
 *  - Privy is REQUIRED for mobile Safari. If REACT_APP_PRIVY_APP_ID isn't
 *    set, mobile-Safari users will see no wallet options. This is intentional
 *    and the modal should surface that error to the user.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useSwitchChain, useDisconnect, useReconnect } from 'wagmi';
import { PublicKey } from '@solana/web3.js';

import { usePrivy as _usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets as _useSolanaWalletsPrivy } from '@privy-io/react-auth/solana';
import { useWallets as _useWalletsPrivy } from '@privy-io/react-auth';

const WalletContext = createContext(null);

/* ============================================================================
 * SAFE PRIVY HOOK WRAPPERS
 * ========================================================================= */

const PRIVY_FALLBACK = {
  ready: false,
  authenticated: false,
  user: null,
  login: () => {},
  logout: async () => {},
  connectWallet: () => {},
  exportWallet: async () => {},
};

function useSafePrivy() {
  try { return _usePrivy(); } catch { return PRIVY_FALLBACK; }
}
function useSafePrivySolWallets() {
  try {
    const r = _useSolanaWalletsPrivy();
    return (r && r.wallets) || [];
  } catch { return []; }
}
function useSafePrivyEvmWallets() {
  try {
    const r = _useWalletsPrivy();
    return (r && r.wallets) || [];
  } catch { return []; }
}

/* ============================================================================
 * STORAGE KEYS + DEFAULTS
 *
 * PRESETS_LS_KEY is bumped to v2 to invalidate stale v1 entries from the
 * previous default scheme (sell defaults were [25,50,75,100]; new is [50,100]).
 * Without the bump, returning users would still see the old persisted presets
 * even if they never customized. v2 forces a one-time reset to the new
 * defaults; user customizations made after this release persist normally.
 * ========================================================================= */

const PRESETS_LS_KEY      = 'nexus_presets_v2';
const HEADER_CHAIN_LS_KEY = 'nexus_header_chain_v1';
const ACTIVE_CTX_LS_KEY   = 'nexus_active_ctx_v1';
const ACTIVE_KIND_LS_KEY  = 'nexus_active_kind_v1';

const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [50, 100];

const EVM_RECONNECT_THROTTLE_MS = 10_000;

/* ============================================================================
 * DEVICE / WALLET-APP DETECTION
 * ========================================================================= */

function isMobileUA() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent || '');
}

/**
 * Returns one of: 'phantom' | 'solflare' | 'evm' | null
 *
 *   'phantom'  - inside Phantom's in-app browser (window.solana injected)
 *   'solflare' - inside Solflare's in-app browser
 *   'evm'      - inside an EVM wallet's in-app browser (MetaMask, Coinbase, Trust...)
 *   null       - regular mobile browser (or desktop)
 *
 * We deliberately don't distinguish between EVM wallets here - the
 * policy is the same for all of them: use the injected EVM connector.
 */
function detectMobileWalletApp() {
  if (typeof window === 'undefined') return null;
  if (!isMobileUA()) return null;

  if (window.phantom && window.phantom.solana) return 'phantom';
  if (window.solflare && window.solflare.isSolflare) return 'solflare';

  const eth = window.ethereum || null;
  if (eth) return 'evm';
  return null;
}

/* ============================================================================
 * STORAGE HELPERS
 *
 * Preset validation accepts ANY non-empty list. Earlier we required >=3
 * entries before trusting the user's saved presets - that punished anyone
 * who customized to fewer slots (the new default sell list itself is just
 * 2 entries). Now any non-empty validated list is preserved.
 * ========================================================================= */

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
    const p = JSON.parse(raw);
    const validBuys = Array.isArray(p.buy)
      ? p.buy.map(Number).filter((v) => Number.isFinite(v) && v > 0).slice(0, 5)
      : [];
    const validSells = Array.isArray(p.sell)
      ? p.sell.map(Number).filter((v) => Number.isFinite(v) && v > 0 && v <= 100).slice(0, 4)
      : [];
    return {
      buy:  validBuys.length  >= 1 ? validBuys  : DEFAULT_BUY_PRESETS,
      sell: validSells.length >= 1 ? validSells : DEFAULT_SELL_PRESETS,
    };
  } catch {
    return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
  }
}
function savePresets(p) {
  try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {}
}
function loadHeaderChain() {
  try {
    const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY);
    if (!raw) return 1;
    const v = JSON.parse(raw);
    if (v === 'solana') return 'solana';
    if (typeof v === 'number' && v > 0) return v;
    return 1;
  } catch { return 1; }
}
function saveHeaderChain(c) {
  try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {}
}
function loadActiveContext() {
  try {
    const v = localStorage.getItem(ACTIVE_CTX_LS_KEY);
    return v === 'solana' || v === 'evm' ? v : null;
  } catch { return null; }
}
function saveActiveContext(ctx) {
  try {
    if (ctx) localStorage.setItem(ACTIVE_CTX_LS_KEY, ctx);
    else localStorage.removeItem(ACTIVE_CTX_LS_KEY);
  } catch {}
}

const VALID_KINDS = ['phantom', 'solflare', 'walletconnect', 'injected', 'privy'];

function loadActiveKind() {
  try {
    const v = localStorage.getItem(ACTIVE_KIND_LS_KEY);
    return VALID_KINDS.includes(v) ? v : null;
  } catch { return null; }
}
function saveActiveKind(k) {
  try {
    if (k) localStorage.setItem(ACTIVE_KIND_LS_KEY, k);
    else localStorage.removeItem(ACTIVE_KIND_LS_KEY);
  } catch {}
}

/* ============================================================================
 * PROVIDER
 * ========================================================================= */

export function WalletContextProvider({ children }) {
  /* -- Solana external -- */
  const {
    publicKey: extSolPublicKey,
    connected: extSolConnected,
    connecting: solConnecting,
    sendTransaction: extSolSendTx,
    signTransaction: extSolSignTx,
    signAllTransactions: extSolSignAll,
    disconnect: solDisconnect,
    select: solSelect,
    wallet: solWallet,
  } = useWallet();

  /* -- EVM external -- */
  const {
    address: extEvmAddress,
    isConnected: extEvmConnected,
    isConnecting: evmConnecting,
    chainId: evmChainId,
    connector: evmConnector,
  } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { disconnect: evmDisconnect, disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const { reconnectAsync: evmReconnectAsync } = useReconnect();

  /* -- Privy embedded -- */
  const privy = useSafePrivy();
  const privySolWallets = useSafePrivySolWallets();
  const privyAllWallets = useSafePrivyEvmWallets();

  const privyEmbeddedSol = useMemo(() => {
    if (!privy.authenticated) return null;
    return privySolWallets.find((w) => w && w.walletClientType === 'privy') || null;
  }, [privy.authenticated, privySolWallets]);

  const privyEmbeddedEvm = useMemo(() => {
    if (!privy.authenticated) return null;
    return privyAllWallets.find(
      (w) => w && w.walletClientType === 'privy' && w.chainType === 'ethereum'
    ) || null;
  }, [privy.authenticated, privyAllWallets]);

  /* Refs for async paths */
  const walletClientRef = useRef(walletClient);
  const evmChainIdRef   = useRef(evmChainId);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  useEffect(() => { evmChainIdRef.current   = evmChainId;   }, [evmChainId]);

  /* -- Connection booleans -- */
  const solConnected = extSolConnected || !!privyEmbeddedSol;
  const evmConnected = extEvmConnected || !!privyEmbeddedEvm;
  const isConnected  = solConnected || evmConnected;
  const isConnecting = solConnecting || evmConnecting;

  /* -- Active addresses -- */
  const publicKey = useMemo(() => {
    if (extSolPublicKey) return extSolPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; }
    }
    return null;
  }, [extSolPublicKey, privyEmbeddedSol]);

  const evmAddress = extEvmAddress || (privyEmbeddedEvm && privyEmbeddedEvm.address) || null;

  /* -- Header chain -- */
  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback((c) => {
    setHeaderChainState(c);
    saveHeaderChain(c);
  }, []);

  /* -- Active context -- */
  const [activeContext, setActiveContextState] = useState(() => loadActiveContext());
  const setActiveContext = useCallback((ctx) => {
    setActiveContextState(ctx);
    saveActiveContext(ctx);
  }, []);

  useEffect(() => {
    if (!solConnected && !evmConnected) {
      if (activeContext != null) setActiveContext(null);
      return;
    }
    if (activeContext != null) return; // respect user's choice
    if (solConnected && !evmConnected) setActiveContext('solana');
    else if (evmConnected && !solConnected) setActiveContext('evm');
    else if (solConnected && evmConnected) {
      setActiveContext(headerChain === 'solana' ? 'solana' : 'evm');
    }
  }, [solConnected, evmConnected, activeContext, headerChain, setActiveContext]);

  /* -- Active wallet kind -- */
  const [activeWalletKind, setActiveWalletKindState] = useState(() => loadActiveKind());
  const setActiveWalletKind = useCallback((k) => {
    setActiveWalletKindState(k);
    saveActiveKind(k);
  }, []);

  useEffect(() => {
    if (extSolConnected && solWallet && solWallet.adapter) {
      const name = (solWallet.adapter.name || '').toLowerCase();
      if (name.includes('phantom'))       { setActiveWalletKind('phantom');  return; }
      if (name.includes('solflare'))      { setActiveWalletKind('solflare'); return; }
    }
    if (extEvmConnected && evmConnector) {
      const cid = (evmConnector.id || '').toLowerCase();
      if (cid === 'walletconnect') { setActiveWalletKind('walletconnect'); return; }
      // Anything else from wagmi (injected, io.metamask, com.coinbase.wallet,
      // app.phantom, etc.) is treated as 'injected'.
      setActiveWalletKind('injected');
      return;
    }
    if (privy.authenticated && (privyEmbeddedSol || privyEmbeddedEvm)) {
      setActiveWalletKind('privy');
      return;
    }
    setActiveWalletKind(null);
  }, [
    extSolConnected, extEvmConnected, solWallet, evmConnector,
    privy.authenticated, privyEmbeddedSol, privyEmbeddedEvm,
    setActiveWalletKind,
  ]);

  /* -- Presets -- */
  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback((p) => {
    setPresetsState(p);
    savePresets(p);
  }, []);

  /* -- Device + wallet-app detection (computed once per mount) -- */
  const isMobile        = useMemo(() => isMobileUA(),            []);
  const mobileWalletApp = useMemo(() => detectMobileWalletApp(), []);

  /* -- WALLET POLICY --
   *
   * Single source of truth for which wallet kinds the modal should show.
   * Modal MUST iterate over `walletPolicy.allowed` and skip any kind not
   * in that list. This stops mobile-Safari users from triggering redirect
   * loops by simply not offering wallets that don't work in that environment.
   */
  const walletPolicy = useMemo(() => {
    if (!isMobile) {
      return {
        environment: 'desktop',
        allowed: ['privy', 'phantom', 'solflare', 'walletconnect'],
        recommended: 'privy',
      };
    }
    if (mobileWalletApp === 'phantom') {
      return { environment: 'mobile-phantom-app', allowed: ['phantom'], recommended: 'phantom' };
    }
    if (mobileWalletApp === 'solflare') {
      return { environment: 'mobile-solflare-app', allowed: ['solflare'], recommended: 'solflare' };
    }
    if (mobileWalletApp === 'evm') {
      return { environment: 'mobile-evm-app', allowed: ['injected'], recommended: 'injected' };
    }
    // Mobile Safari / Chrome / Firefox without an injected wallet
    return { environment: 'mobile-browser', allowed: ['privy'], recommended: 'privy' };
  }, [isMobile, mobileWalletApp]);

  /* -- EVM reconnect on visibility/online (session-based, no popup) -- */
  const lastEvmReconnectAtRef = useRef(0);
  const evmReconnectInFlightRef = useRef(false);
  const userExplicitlyDisconnectedRef = useRef(false);

  useEffect(() => {
    if (extEvmConnected) userExplicitlyDisconnectedRef.current = false;
  }, [extEvmConnected]);

  const tryEvmReconnect = useCallback(async () => {
    if (typeof evmReconnectAsync !== 'function') return;
    if (extEvmConnected) return;
    if (userExplicitlyDisconnectedRef.current) return;
    if (evmReconnectInFlightRef.current) return;
    if (Date.now() - lastEvmReconnectAtRef.current < EVM_RECONNECT_THROTTLE_MS) return;

    evmReconnectInFlightRef.current = true;
    lastEvmReconnectAtRef.current = Date.now();
    try { await evmReconnectAsync(); }
    catch (e) {
      if (e && e.message) console.debug('[WalletContext] EVM reconnect:', e.message);
    } finally {
      evmReconnectInFlightRef.current = false;
    }
  }, [evmReconnectAsync, extEvmConnected]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryEvmReconnect();
    };
    const onOnline = () => { tryEvmReconnect(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [tryEvmReconnect]);

  /* -- Privy login / logout passthrough -- */
  const loginPrivy = useCallback(() => {
    try {
      if (typeof privy.login === 'function') privy.login();
    } catch (e) {
      console.warn('[WalletContext] Privy login failed:', e && e.message);
    }
  }, [privy]);

  const logoutPrivy = useCallback(async () => {
    try {
      if (typeof privy.logout === 'function') await privy.logout();
    } catch (e) {
      console.warn('[WalletContext] Privy logout failed:', e && e.message);
    }
  }, [privy]);

  /* -- Disconnect everything -- */
  const disconnectAll = useCallback(async () => {
    userExplicitlyDisconnectedRef.current = true;

    let ok = true;
    if (extSolConnected) {
      try { await solDisconnect(); }
      catch (e) { console.warn('[WalletContext] Solana disconnect:', e); ok = false; }
    }
    if (extEvmConnected) {
      try {
        if (typeof evmDisconnectAsync === 'function') await evmDisconnectAsync();
        else evmDisconnect();
      } catch (e) { console.warn('[WalletContext] EVM disconnect:', e); ok = false; }
    }
    if (privy.authenticated) {
      try { await logoutPrivy(); }
      catch (e) { console.warn('[WalletContext] Privy disconnect:', e); ok = false; }
    }
    if (solWallet && typeof solSelect === 'function') {
      try { solSelect(null); } catch { /* no-op */ }
    }
    setActiveContext(null);
    setActiveWalletKind(null);
    return ok;
  }, [
    extSolConnected, extEvmConnected, solDisconnect, evmDisconnect, evmDisconnectAsync,
    solWallet, solSelect, setActiveContext, setActiveWalletKind,
    privy.authenticated, logoutPrivy,
  ]);

  /* -- Switch EVM chain -- */
  const switchToChain = useCallback(async (targetChainId) => {
    if (!targetChainId || typeof targetChainId !== 'number') return false;
    if (evmChainIdRef.current === targetChainId) return true;
    try {
      if (switchChainAsync) await switchChainAsync({ chainId: targetChainId });
      else if (switchChain) switchChain({ chainId: targetChainId });
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        const wc = walletClientRef.current;
        const cid = evmChainIdRef.current;
        if (cid === targetChainId) return true;
        if (wc && wc.chain && wc.chain.id === targetChainId) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      const wc = walletClientRef.current;
      const cid = evmChainIdRef.current;
      return cid === targetChainId || (wc && wc.chain && wc.chain.id === targetChainId);
    } catch (e) {
      console.warn('[WalletContext] switchChain:', e && e.message);
      return false;
    }
  }, [switchChain, switchChainAsync]);

  /* -- Display address -- */
  const walletAddress = useMemo(() => {
    if (solConnected && evmConnected) {
      if (activeContext === 'evm' && evmAddress) return evmAddress;
      if (publicKey) return publicKey.toString();
      return evmAddress || null;
    }
    if (solConnected && publicKey) return publicKey.toString();
    if (evmConnected && evmAddress) return evmAddress;
    return null;
  }, [solConnected, evmConnected, activeContext, publicKey, evmAddress]);

  const connectedWalletName = useMemo(() => {
    if (activeWalletKind === 'privy')          return 'Email / Social';
    if (activeWalletKind === 'phantom')        return 'Phantom';
    if (activeWalletKind === 'solflare')       return 'Solflare';
    if (activeWalletKind === 'walletconnect')  return (evmConnector && evmConnector.name) || 'WalletConnect';
    if (activeWalletKind === 'injected')       return (evmConnector && evmConnector.name) || 'Wallet';
    if (solConnected) return (solWallet && solWallet.adapter && solWallet.adapter.name) || 'Solana';
    if (evmConnected) return (evmConnector && evmConnector.name) || 'EVM Wallet';
    return null;
  }, [activeWalletKind, solConnected, evmConnected, solWallet, evmConnector]);

  /* ============================================================================
   * CONTEXT VALUE
   * ========================================================================= */
  const value = useMemo(() => ({
    // Connection state
    isConnected,
    isConnecting,
    solConnected,
    evmConnected,
    isSolanaConnected: solConnected,

    // Active wallet kind
    activeWalletKind,
    setActiveWalletKind,

    // Privy
    privyReady:           privy.ready,
    privyAuthenticated:   privy.authenticated,
    privyUser:            privy.user || null,
    privyEmbeddedSol,
    privyEmbeddedEvm,
    loginPrivy,
    logoutPrivy,
    privyExportWallet:    typeof privy.exportWallet === 'function' ? privy.exportWallet : null,

    // External Solana state
    extSolConnected,
    extSolPublicKey,
    // External EVM state
    extEvmConnected,
    extEvmAddress,
    evmConnector,

    // Unified addresses
    walletAddress,
    publicKey:  solConnected && publicKey ? publicKey : null,
    evmAddress: evmConnected ? evmAddress : null,

    // Active context
    activeContext,
    setActiveContext,

    // Chain
    evmChainId,
    headerChain,
    setHeaderChain,

    // Signers (external Solana)
    walletClient,
    sendTransaction:     extSolSendTx,
    signTransaction:     extSolSignTx,
    signAllTransactions: extSolSignAll,
    switchChain,
    switchToChain,

    // Display
    connectedWalletName,

    // Presets
    presets,
    setPresets,

    // Device / wallet policy
    isMobileDevice: isMobile,
    mobileWalletApp,
    walletPolicy,

    // Disconnect
    disconnectAll,

    // Manual reconnect (EVM only -- Solana would popup on mobile)
    reconnectIfStale: tryEvmReconnect,
  }), [
    isConnected, isConnecting, solConnected, evmConnected,
    activeWalletKind, setActiveWalletKind,
    privy.ready, privy.authenticated, privy.user, privy.exportWallet,
    privyEmbeddedSol, privyEmbeddedEvm, loginPrivy, logoutPrivy,
    extSolConnected, extSolPublicKey, extEvmConnected, extEvmAddress, evmConnector,
    walletAddress, publicKey, evmAddress,
    activeContext, setActiveContext,
    evmChainId, headerChain, setHeaderChain,
    walletClient, extSolSendTx, extSolSignTx, extSolSignAll,
    switchChain, switchToChain,
    connectedWalletName,
    presets, setPresets,
    isMobile, mobileWalletApp, walletPolicy,
    disconnectAll, tryEvmReconnect,
  ]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useNexusWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useNexusWallet must be used inside WalletContextProvider');
  return ctx;
}
