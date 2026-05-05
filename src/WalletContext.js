/**
 * NEXUS DEX -- Wallet Context
 *
 * Single source of truth for:
 *   1. Wallet connection state across FOUR options:
 *      a) Phantom         (Solana external)
 *      b) Solflare        (Solana external)
 *      c) WalletConnect   (any EVM wallet)
 *      d) Privy embedded  (email/social/passkey -> auto-created Sol+EVM wallets)
 *   2. Active context (which wallet is "primary" for the current task)
 *   3. Header network selector
 *   4. Quick Buy / Quick Sell presets
 *   5. Mobile in-app wallet detection
 *   6. Disconnect flow that handles all wallet types
 *   7. Auto-reconnect resilience layer
 *
 * Multiple wallets can be connected simultaneously. activeContext picks
 * which one is "primary" for routing decisions and address display.
 *
 * Privy notes:
 *   - Privy embedded wallets are NON-CUSTODIAL. Keys live in the user's
 *     device + Privy's TEE infra. Neither Privy nor we can access them.
 *   - Privy can create BOTH a Solana and an EVM wallet for the same user.
 *     We surface both via privyEmbeddedSol / privyEmbeddedEvm.
 *   - Privy is OPTIONAL. If REACT_APP_PRIVY_APP_ID isn't set, the
 *     PrivyProvider isn't mounted and our hooks return null safely.
 *
 * Usage:
 *   const wallet = useNexusWallet();
 *   wallet.isConnected            -- ANY wallet connected (sol, evm, or privy)
 *   wallet.solConnected           -- Phantom/Solflare or Privy Solana embedded
 *   wallet.evmConnected           -- WalletConnect or Privy EVM embedded
 *   wallet.privyAuthenticated     -- user is logged in via Privy
 *   wallet.privyEmbeddedSol       -- Privy's Solana wallet { address, signTransaction, ... }
 *   wallet.privyEmbeddedEvm       -- Privy's EVM wallet    { address, sendTransaction, ... }
 *   wallet.publicKey              -- ALWAYS the active Solana PublicKey (external OR Privy)
 *   wallet.evmAddress             -- ALWAYS the active EVM address (external OR Privy)
 *   wallet.activeWalletKind       -- 'phantom' | 'solflare' | 'walletconnect' | 'privy' | null
 *   wallet.loginPrivy()           -- open Privy modal
 *   wallet.logoutPrivy()          -- log out of Privy
 *   wallet.disconnectAll()        -- disconnect every wallet (Sol, EVM, Privy)
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useSwitchChain, useDisconnect, useReconnect } from 'wagmi';
import { PublicKey } from '@solana/web3.js';

/* Privy hooks. We import lazily-tolerant -- if @privy-io/react-auth isn't
 * installed, the bundler will fail at build time (which is what we want
 * once you add Privy). At runtime, if PrivyProvider isn't wrapping us,
 * the hooks return safe defaults via the try/catch wrappers below. */
import { usePrivy as _usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets as _useSolanaWalletsPrivy } from '@privy-io/react-auth/solana';
import { useWallets as _useWalletsPrivy } from '@privy-io/react-auth';

const WalletContext = createContext(null);

/* ============================================================================
 * SAFE PRIVY HOOK WRAPPERS
 *
 * If PrivyProvider isn't mounted (PRIVY_APP_ID missing), Privy's hooks
 * throw. We wrap them so the rest of the app keeps working.
 * ========================================================================= */

function useSafePrivy() {
  try {
    return _usePrivy();
  } catch (e) {
    return {
      ready: false,
      authenticated: false,
      user: null,
      login: () => { /* no-op when Privy not configured */ },
      logout: async () => {},
      connectWallet: () => {},
      exportWallet: async () => {},
    };
  }
}
function useSafePrivySolWallets() {
  try {
    const r = _useSolanaWalletsPrivy();
    return (r && r.wallets) || [];
  } catch (e) {
    return [];
  }
}
function useSafePrivyEvmWallets() {
  try {
    const r = _useWalletsPrivy();
    return (r && r.wallets) || [];
  } catch (e) {
    return [];
  }
}

/* ============================================================================
 * STORAGE KEYS + DEFAULTS
 * ========================================================================= */

const PRESETS_LS_KEY      = 'nexus_presets_v1';
const HEADER_CHAIN_LS_KEY = 'nexus_header_chain_v1';
const ACTIVE_CTX_LS_KEY   = 'nexus_active_ctx_v1';
const ACTIVE_KIND_LS_KEY  = 'nexus_active_kind_v1';

/* GMGN-style preset defaults. Buy presets are USD amounts (we convert to
 * native via Jupiter / LiFi at trade time). Sell presets are % of balance.
 * Tuned for memecoin trading: 25/50/100/250/500 USD for buys (covers
 * casual to whale positions), 25/50/75/100% for sells. */
const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];

const RECONNECT_COOLDOWN_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/* ============================================================================
 * MOBILE IN-APP WALLET DETECTION
 * ========================================================================= */

function detectMobileInAppWallet() {
  if (typeof window === 'undefined') return null;
  const uaRaw = navigator.userAgent || '';
  const ua = uaRaw.toLowerCase();
  const isMobile = /iphone|ipad|ipod|android/i.test(uaRaw);
  if (!isMobile) return null;

  const eth = window.ethereum || null;

  if (window.phantom && (window.phantom.solana || window.phantom.ethereum)) return 'phantom';
  if (window.solflare && window.solflare.isSolflare) return 'solflare';

  if (eth) {
    if (ua.includes('coinbasewallet') || eth.isCoinbaseWallet) return 'coinbase';
    if (ua.includes('trust') || eth.isTrust || eth.isTrustWallet) return 'trust';
    if (eth.isRabby) return 'rabby';
    if (ua.includes('okapp') || eth.isOkxWallet || eth.isOKExWallet) return 'okx';
    if (eth.isBraveWallet) return 'brave';
    if (eth.isBitKeep || eth.isBitKeepChrome) return 'bitget';
    if (ua.includes('metamaskmobile') || ua.includes('metamask')) return 'metamask';
  }
  return null;
}

/* ============================================================================
 * STORAGE HELPERS
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
      buy:  validBuys.length  >= 3 ? validBuys  : DEFAULT_BUY_PRESETS,
      sell: validSells.length >= 3 ? validSells : DEFAULT_SELL_PRESETS,
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
function loadActiveKind() {
  try {
    const v = localStorage.getItem(ACTIVE_KIND_LS_KEY);
    return ['phantom', 'solflare', 'walletconnect', 'privy'].includes(v) ? v : null;
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
  /* --- Solana external (Phantom / Solflare via wallet-adapter) --- */
  const {
    publicKey: extSolPublicKey,
    connected: extSolConnected,
    connecting: solConnecting,
    sendTransaction: extSolSendTx,
    signTransaction: extSolSignTx,
    signAllTransactions: extSolSignAll,
    disconnect: solDisconnect,
    connect: solConnect,
    select: solSelect,
    wallet: solWallet,
  } = useWallet();

  /* --- EVM external (WalletConnect via wagmi) --- */
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

  /* --- Privy embedded --- */
  const privy = useSafePrivy();
  const privySolWallets = useSafePrivySolWallets();
  const privyAllWallets = useSafePrivyEvmWallets();

  // Privy's embedded wallets are tagged walletClientType === 'privy'.
  // External wallets connected through Privy's modal show up too -- we
  // ignore those here (we route external wallets through wagmi/adapter).
  const privyEmbeddedSol = useMemo(() => {
    if (!privy.authenticated) return null;
    return privySolWallets.find(function (w) {
      return w && w.walletClientType === 'privy';
    }) || null;
  }, [privy.authenticated, privySolWallets]);

  const privyEmbeddedEvm = useMemo(() => {
    if (!privy.authenticated) return null;
    return privyAllWallets.find(function (w) {
      return w && w.walletClientType === 'privy' && w.chainType === 'ethereum';
    }) || null;
  }, [privy.authenticated, privyAllWallets]);

  /* Refs that always hold the latest wagmi values for async paths */
  const walletClientRef = useRef(walletClient);
  const evmChainIdRef   = useRef(evmChainId);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  useEffect(() => { evmChainIdRef.current   = evmChainId;   }, [evmChainId]);

  /* --- Connection booleans (any source) --- */
  const solConnected = extSolConnected || !!privyEmbeddedSol;
  const evmConnected = extEvmConnected || !!privyEmbeddedEvm;
  const isConnected  = solConnected || evmConnected;
  const isConnecting = solConnecting || evmConnecting;

  /* --- Active addresses (prefer external when both present, since users
   *     who connected an external wallet AND signed into Privy probably
   *     intended the external wallet to be primary). Privy is fallback. --- */
  const publicKey = useMemo(() => {
    if (extSolPublicKey) return extSolPublicKey;
    if (privyEmbeddedSol && privyEmbeddedSol.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; }
    }
    return null;
  }, [extSolPublicKey, privyEmbeddedSol]);

  const evmAddress = extEvmAddress || (privyEmbeddedEvm && privyEmbeddedEvm.address) || null;

  /* --- Reconnect resilience refs --- */
  const reconnectingRef               = useRef(false);
  const lastReconnectAttemptRef       = useRef(0);
  const userExplicitlyDisconnectedRef = useRef(false);
  const wasConnectedRef               = useRef(false);

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      userExplicitlyDisconnectedRef.current = false;
    }
  }, [isConnected]);

  /* --- Header chain --- */
  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback((c) => {
    setHeaderChainState(c);
    saveHeaderChain(c);
  }, []);

  /* --- Active context --- */
  const [activeContext, setActiveContextState] = useState(() => loadActiveContext());
  const setActiveContext = useCallback((ctx) => {
    setActiveContextState(ctx);
    saveActiveContext(ctx);
  }, []);

  useEffect(() => {
    if (solConnected && !evmConnected && activeContext !== 'solana') {
      setActiveContext('solana');
    } else if (evmConnected && !solConnected && activeContext !== 'evm') {
      setActiveContext('evm');
    } else if (!solConnected && !evmConnected && activeContext != null) {
      setActiveContext(null);
    }
  }, [solConnected, evmConnected, activeContext, setActiveContext]);

  useEffect(() => {
    if (headerChain === 'solana' && solConnected && activeContext !== 'solana') {
      setActiveContext('solana');
    } else if (typeof headerChain === 'number' && evmConnected && activeContext !== 'evm') {
      setActiveContext('evm');
    }
  }, [headerChain, solConnected, evmConnected, activeContext, setActiveContext]);

  /* --- Active wallet kind (which of the 4 options is "primary") --- */
  const [activeWalletKind, setActiveWalletKindState] = useState(() => loadActiveKind());
  const setActiveWalletKind = useCallback((k) => {
    setActiveWalletKindState(k);
    saveActiveKind(k);
  }, []);

  // Auto-detect kind on connection events
  useEffect(() => {
    if (extSolConnected && solWallet && solWallet.adapter) {
      const name = (solWallet.adapter.name || '').toLowerCase();
      if (name.includes('phantom'))  setActiveWalletKind('phantom');
      else if (name.includes('solflare')) setActiveWalletKind('solflare');
    } else if (extEvmConnected) {
      setActiveWalletKind('walletconnect');
    } else if (privy.authenticated && (privyEmbeddedSol || privyEmbeddedEvm)) {
      setActiveWalletKind('privy');
    } else {
      setActiveWalletKind(null);
    }
  }, [extSolConnected, extEvmConnected, solWallet, privy.authenticated, privyEmbeddedSol, privyEmbeddedEvm, setActiveWalletKind]);

  /* --- Presets --- */
  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback((p) => {
    setPresetsState(p);
    savePresets(p);
  }, []);

  /* --- Mobile in-app wallet --- */
  const mobileInAppWallet = useMemo(() => detectMobileInAppWallet(), []);
  const isMobileInAppWallet = !!mobileInAppWallet;

  /* --- Reconnect-if-stale --- */
  const reconnectIfStale = useCallback(async () => {
    if (userExplicitlyDisconnectedRef.current) return false;
    if (reconnectingRef.current) return false;

    const needsEvm = !extEvmConnected;
    const needsSol = !!(solWallet && !extSolConnected);
    if (!needsEvm && !needsSol) return false;

    if (Date.now() - lastReconnectAttemptRef.current < RECONNECT_COOLDOWN_MS) return false;

    reconnectingRef.current = true;
    lastReconnectAttemptRef.current = Date.now();
    try {
      if (needsEvm && typeof evmReconnectAsync === 'function') {
        try { await evmReconnectAsync(); }
        catch (e) {
          if (e && e.message) console.debug('[WalletContext] EVM reconnect:', e.message);
        }
      }
      if (
        needsSol &&
        typeof solConnect === 'function' &&
        solWallet && solWallet.adapter &&
        solWallet.adapter.readyState !== 'NotDetected' &&
        solWallet.adapter.readyState !== 'Unsupported'
      ) {
        try { await solConnect(); }
        catch (e) {
          if (e && e.message) console.debug('[WalletContext] Solana reconnect:', e.message);
        }
      }
    } finally {
      reconnectingRef.current = false;
    }
    return true;
  }, [extEvmConnected, evmReconnectAsync, solWallet, extSolConnected, solConnect]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnectIfStale();
    };
    const onOnline = () => { reconnectIfStale(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [reconnectIfStale]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (userExplicitlyDisconnectedRef.current) return;
      const isCurrentlyConnected = extSolConnected || extEvmConnected;
      if (wasConnectedRef.current && !isCurrentlyConnected) {
        reconnectIfStale();
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [extSolConnected, extEvmConnected, reconnectIfStale]);

  /* --- Privy login / logout passthrough --
   *
   * loginPrivy() opens Privy's modal -- email, social, passkey, or
   * external wallet. After login, Privy auto-creates embedded Sol+EVM
   * wallets for users without external wallets connected.
   *
   * logoutPrivy() ends the Privy session. Embedded wallet keys remain
   * intact (recoverable via login). External wallets connected through
   * Privy stay connected via their respective adapters.
   */
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

  /* --- Disconnect everything --- */
  const disconnectAll = useCallback(async () => {
    userExplicitlyDisconnectedRef.current = true;
    wasConnectedRef.current = false;

    let ok = true;
    if (extSolConnected) {
      try { await solDisconnect(); }
      catch (e) { console.warn('[WalletContext] Solana disconnect error:', e); ok = false; }
    }
    if (extEvmConnected) {
      try {
        if (typeof evmDisconnectAsync === 'function') await evmDisconnectAsync();
        else evmDisconnect();
      } catch (e) { console.warn('[WalletContext] EVM disconnect error:', e); ok = false; }
    }
    if (privy.authenticated) {
      try { await logoutPrivy(); }
      catch (e) { console.warn('[WalletContext] Privy disconnect error:', e); ok = false; }
    }
    if (solWallet && typeof solSelect === 'function') {
      try { solSelect(null); } catch { /* no-op */ }
    }
    setActiveContext(null);
    setActiveWalletKind(null);
    return ok;
  }, [extSolConnected, extEvmConnected, solDisconnect, evmDisconnect, evmDisconnectAsync, solWallet, solSelect, setActiveContext, setActiveWalletKind, privy.authenticated, logoutPrivy]);

  /* --- Switch EVM chain (external wallets only -- Privy handles its own
   *     chain switching via the embedded wallet UI / programmatic API) --- */
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
      console.warn('[WalletContext] switchChain failed:', e && e.message);
      return false;
    }
  }, [switchChain, switchChainAsync]);

  /* --- Display address (respects activeContext when both wallets connected) --- */
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
    if (activeWalletKind === 'privy') return 'Email / Social';
    if (activeWalletKind === 'phantom') return 'Phantom';
    if (activeWalletKind === 'solflare') return 'Solflare';
    if (activeWalletKind === 'walletconnect') return (evmConnector && evmConnector.name) || 'WalletConnect';
    if (solConnected) return (solWallet && solWallet.adapter && solWallet.adapter.name) || 'Solana';
    if (evmConnected) return (evmConnector && evmConnector.name) || 'EVM Wallet';
    return null;
  }, [activeWalletKind, solConnected, evmConnected, solWallet, evmConnector]);

  /* --- Unified Solana sign/send.
   *
   * Returns the appropriate signer based on which Solana wallet is
   * active. Privy embedded path uses provider.request({method:'signAndSendTransaction'})
   * -- we expose Privy's wallet object directly and let consumers call
   * the right method. External wallet path keeps wallet-adapter's signer.
   *
   * For the executeSwap / executeTrade / handleSend code paths,
   * consumers should branch on `activeWalletKind === 'privy'` and use
   * the Privy wallet's getProvider() flow (per Privy docs).
   */
  const sendTransaction = extSolSendTx; // wallet-adapter's send (external Solana)
  const signTransaction = extSolSignTx;
  const signAllTransactions = extSolSignAll;

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

    // Active wallet kind (which of the 4 options is primary)
    activeWalletKind,
    setActiveWalletKind,

    // Privy specific
    privyReady:           privy.ready,
    privyAuthenticated:   privy.authenticated,
    privyUser:            privy.user || null,
    privyEmbeddedSol,         // { address, signMessage, getProvider, ... } | null
    privyEmbeddedEvm,         // { address, getEthereumProvider, ... } | null
    loginPrivy,
    logoutPrivy,
    privyExportWallet:    typeof privy.exportWallet === 'function' ? privy.exportWallet : null,

    // External Solana state (for code that needs to know specifically)
    extSolConnected,
    extSolPublicKey,
    // External EVM state
    extEvmConnected,
    extEvmAddress,

    // Unified addresses (external > Privy precedence)
    walletAddress,
    publicKey:  solConnected && publicKey ? publicKey : null,
    evmAddress: evmConnected ? evmAddress : null,

    // Active context (sol vs evm)
    activeContext,
    setActiveContext,

    // Chain
    evmChainId,
    headerChain,
    setHeaderChain,

    // Transaction signers (external Solana). For Privy, branch on
    // activeWalletKind and use privyEmbeddedSol.getProvider().
    walletClient,
    sendTransaction,
    signTransaction,
    signAllTransactions,
    switchChain,
    switchToChain,

    // Display
    connectedWalletName,

    // Presets
    presets,
    setPresets,

    // Mobile in-app
    isMobileInAppWallet,
    mobileInAppWalletName: mobileInAppWallet,

    // Disconnect
    disconnectAll,

    // Manual reconnect
    reconnectIfStale,
  }), [
    isConnected, isConnecting, solConnected, evmConnected,
    activeWalletKind, setActiveWalletKind,
    privy.ready, privy.authenticated, privy.user, privy.exportWallet,
    privyEmbeddedSol, privyEmbeddedEvm, loginPrivy, logoutPrivy,
    extSolConnected, extSolPublicKey, extEvmConnected, extEvmAddress,
    walletAddress, publicKey, evmAddress,
    activeContext, setActiveContext,
    evmChainId, headerChain, setHeaderChain,
    walletClient, sendTransaction, signTransaction, signAllTransactions,
    switchChain, switchToChain,
    connectedWalletName,
    presets, setPresets,
    isMobileInAppWallet, mobileInAppWallet,
    disconnectAll, reconnectIfStale,
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
