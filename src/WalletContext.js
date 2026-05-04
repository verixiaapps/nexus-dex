/**
 * NEXUS DEX -- Wallet Context
 *
 * Single source of truth for:
 *   1. Wallet connection state (Solana + EVM, simultaneously possible)
 *   2. Active chain context (which wallet is "primary" for the current task)
 *   3. Header network selector (the user's chosen destination chain)
 *   4. Quick Buy / Quick Sell presets (global, persisted)
 *   5. Mobile in-app wallet detection
 *   6. Disconnect flow that handles both wallet types
 *   7. Resilience layer -- auto-reconnect after backgrounding, network loss,
 *      or silent WalletConnect session expiry. User stays connected without
 *      having to reconnect manually.
 *
 * Usage in any component:
 *   const wallet = useNexusWallet();
 *   wallet.isConnected            -- true if either wallet connected
 *   wallet.solConnected           -- Solana wallet connected
 *   wallet.evmConnected           -- EVM wallet connected
 *   wallet.publicKey              -- Solana PublicKey (or null)
 *   wallet.evmAddress             -- EVM address (or null)
 *   wallet.evmChainId             -- Currently connected EVM chain
 *   wallet.headerChain            -- User's selected destination chain
 *   wallet.setHeaderChain(chainId)-- Change header chain (persists)
 *   wallet.activeContext          -- 'solana' | 'evm' | null (last-used)
 *   wallet.presets                -- { buy:[], sell:[] }
 *   wallet.setPresets(p)          -- Update presets (persists)
 *   wallet.disconnectAll()        -- Disconnect both wallets
 *   wallet.reconnectIfStale()     -- Force a stale-session recheck (manual)
 *   wallet.isMobileInAppWallet    -- User is in Phantom/MetaMask in-app browser
 *   wallet.walletClient           -- viem WalletClient for EVM
 *   wallet.sendTransaction        -- Solana send fn
 *   wallet.signTransaction        -- Solana sign fn
 *   wallet.switchChain            -- wagmi switchChain fn
 *
 * Backwards compat (old field names kept so existing components don't break):
 *   walletAddress, isSolanaConnected, connectedWalletName
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useWalletClient, useSwitchChain, useDisconnect, useReconnect } from 'wagmi';

const WalletContext = createContext(null);

/* ============================================================================
 * LOCALSTORAGE KEYS -- must match the keys used in SwapWidget.jsx so a
 * change made there is read by us, and vice versa.
 * ========================================================================= */

const PRESETS_LS_KEY      = 'nexus_presets_v1';
const HEADER_CHAIN_LS_KEY = 'nexus_header_chain_v1';
const ACTIVE_CTX_LS_KEY   = 'nexus_active_ctx_v1';

const DEFAULT_BUY_PRESETS  = [10, 25, 50, 100, 250];
const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];

/* ============================================================================
 * RECONNECT TUNING
 * ========================================================================= */

const RECONNECT_COOLDOWN_MS = 5_000;     // min gap between reconnect attempts
const HEARTBEAT_INTERVAL_MS = 30_000;    // periodic stale-state check

/* ============================================================================
 * MOBILE IN-APP WALLET DETECTION
 *
 * When users open swap.verixiaapps.com inside Phantom's or MetaMask's in-app
 * browser, the wallet is injected directly. Signing happens in-context, no
 * app switching. This is the gold-standard mobile flow.
 *
 * We detect by checking the user agent and injected globals.
 * ========================================================================= */

function detectMobileInAppWallet() {
  if (typeof window === 'undefined') return null;
  const uaRaw = navigator.userAgent || '';
  const ua = uaRaw.toLowerCase();
  // Only flag mobile in-app browsers -- desktop extensions inject the same
  // globals (window.phantom, window.ethereum.isCoinbaseWallet) and shouldn't
  // be treated as "in-app".
  const isMobile = /iphone|ipad|ipod|android/i.test(uaRaw);
  if (!isMobile) return null;

  const eth = window.ethereum || null;

  // Phantom in-app browser -- Phantom mobile sets window.phantom on iOS/Android.
  if (window.phantom && (window.phantom.solana || window.phantom.ethereum)) {
    return 'phantom';
  }
  // Solflare in-app browser
  if (window.solflare && window.solflare.isSolflare) return 'solflare';

  // EVM wallets -- order matters here. Many wallets set isMetaMask=true for
  // dApp compatibility, so the MetaMask check MUST come last among EVM
  // wallets, and we additionally require the UA string for MetaMask. Each
  // wallet below is checked via its own specific flag and/or UA token before
  // we fall through to the MetaMask catch-all.
  if (eth) {
    // Coinbase Wallet (mobile in-app)
    if (ua.includes('coinbasewallet') || eth.isCoinbaseWallet) return 'coinbase';
    // Trust Wallet (mobile in-app) -- sets isTrust on injected provider
    if (ua.includes('trust') || eth.isTrust || eth.isTrustWallet) return 'trust';
    // Rabby -- sets isRabby
    if (eth.isRabby) return 'rabby';
    // OKX wallet
    if (ua.includes('okapp') || eth.isOkxWallet || eth.isOKExWallet) return 'okx';
    // Brave wallet -- sets isBraveWallet
    if (eth.isBraveWallet) return 'brave';
    // Bitget wallet
    if (eth.isBitKeep || eth.isBitKeepChrome) return 'bitget';
    // MetaMask Mobile -- must require the UA, NOT just the isMetaMask flag,
    // because Trust/Rabby/Brave/etc. set isMetaMask=true for compat.
    if (ua.includes('metamaskmobile') || ua.includes('metamask')) return 'metamask';
  }

  return null;
}

/* ============================================================================
 * PRESETS LOAD/SAVE
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

/* ============================================================================
 * HEADER CHAIN LOAD/SAVE
 * ========================================================================= */

function loadHeaderChain() {
  try {
    const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY);
    if (!raw) return 1; // Default Ethereum
    const v = JSON.parse(raw);
    if (v === 'solana') return 'solana';
    if (typeof v === 'number' && v > 0) return v;
    return 1;
  } catch { return 1; }
}

function saveHeaderChain(c) {
  try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {}
}

/* ============================================================================
 * ACTIVE CONTEXT (last-used wallet type)
 *
 * When both wallets are connected, we need to know which one the user is
 * "actively using" -- typically the last one they signed a tx with. This
 * decides things like: does `walletAddress` return Solana or EVM address?
 *
 * Persists across sessions.
 * ========================================================================= */

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

/* ============================================================================
 * PROVIDER
 * ========================================================================= */

export function WalletContextProvider({ children }) {
  /* -- Solana wallet hooks -- */
  const {
    publicKey,
    connected: solConnected,
    connecting: solConnecting,
    sendTransaction,
    signTransaction,
    signAllTransactions,
    disconnect: solDisconnect,
    connect: solConnect,
    select: solSelect,
    wallet: solWallet,
  } = useWallet();

  /* -- EVM wallet hooks -- */
  const {
    address: evmAddress,
    isConnected: evmConnected,
    isConnecting: evmConnecting,
    chainId: evmChainId,
    connector: evmConnector,
  } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { disconnect: evmDisconnect, disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const { reconnectAsync: evmReconnectAsync } = useReconnect();

  /* Refs that always hold the latest wagmi values. Async functions like
   * switchToChain() poll these instead of useCallback-captured snapshots --
   * otherwise the captured walletClient is stale by the time the chain
   * actually switches and the polling loop never sees the new chain id. */
  const walletClientRef = useRef(walletClient);
  const evmChainIdRef   = useRef(evmChainId);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  useEffect(() => { evmChainIdRef.current   = evmChainId;   }, [evmChainId]);

  /* -- Reconnect-resilience refs.
   *
   *  WC-6: We need to distinguish "user explicitly tapped Disconnect" from
   *  "wallet got dropped silently (mobile backgrounded too long, network
   *  blip, idle WC session)". Without that distinction the heartbeat
   *  loop would re-establish a connection the user just walked away from.
   *
   *  - reconnectingRef:                in-flight guard for reconnectIfStale
   *  - lastReconnectAttemptRef:        cooldown guard (prevents thrash)
   *  - userExplicitlyDisconnectedRef:  set by disconnectAll(), cleared
   *                                    automatically on next successful
   *                                    connect (see effect below)
   *  - wasConnectedRef:                "did we ever have a connection in
   *                                    this session?" -- gates the silent-
   *                                    failure heartbeat so we don't try
   *                                    to reconnect on first page load.
   */
  const reconnectingRef               = useRef(false);
  const lastReconnectAttemptRef       = useRef(0);
  const userExplicitlyDisconnectedRef = useRef(false);
  const wasConnectedRef               = useRef(false);

  // Track session connection history. Once connected, we know the user
  // intends to be connected; clear the explicit-disconnect flag.
  useEffect(() => {
    if (solConnected || evmConnected) {
      wasConnectedRef.current = true;
      userExplicitlyDisconnectedRef.current = false;
    }
  }, [solConnected, evmConnected]);

  /* -- Header chain (destination network selector) -- */
  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback((c) => {
    setHeaderChainState(c);
    saveHeaderChain(c);
  }, []);

  /* -- Active context (which wallet type is "primary" right now) -- */
  const [activeContext, setActiveContextState] = useState(() => loadActiveContext());
  const setActiveContext = useCallback((ctx) => {
    setActiveContextState(ctx);
    saveActiveContext(ctx);
  }, []);

  // Auto-update active context when one wallet connects without the other
  useEffect(() => {
    if (solConnected && !evmConnected && activeContext !== 'solana') {
      setActiveContext('solana');
    } else if (evmConnected && !solConnected && activeContext !== 'evm') {
      setActiveContext('evm');
    } else if (!solConnected && !evmConnected && activeContext != null) {
      setActiveContext(null);
    }
    // When BOTH are connected, keep whatever was last set (don't auto-switch)
  }, [solConnected, evmConnected, activeContext, setActiveContext]);

  // When user changes header chain to Solana, mark Solana as active context
  // (if connected). Vice versa for EVM.
  useEffect(() => {
    if (headerChain === 'solana' && solConnected && activeContext !== 'solana') {
      setActiveContext('solana');
    } else if (typeof headerChain === 'number' && evmConnected && activeContext !== 'evm') {
      setActiveContext('evm');
    }
  }, [headerChain, solConnected, evmConnected, activeContext, setActiveContext]);

  /* -- Presets -- */
  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback((p) => {
    setPresetsState(p);
    savePresets(p);
  }, []);

  /* -- Mobile in-app wallet detection (computed once on mount) -- */
  const mobileInAppWallet = useMemo(() => detectMobileInAppWallet(), []);
  const isMobileInAppWallet = !!mobileInAppWallet;

  /* -- WC-6: reconnectIfStale --
   *
   *  Tries to restore wallet connections that dropped silently. Common
   *  causes: mobile browser backgrounded too long (WalletConnect relay
   *  drops idle sessions), network blip, OS swapping the tab, laptop lid
   *  closed for a while.
   *
   *  Safe to call freely -- it dedupes via reconnectingRef and rate-limits
   *  via lastReconnectAttemptRef. No-op if the user explicitly disconnected
   *  (until they manually reconnect, which clears the flag).
   *
   *  Returns true if a reconnect attempt was made, false if skipped.
   */
  const reconnectIfStale = useCallback(async () => {
    if (userExplicitlyDisconnectedRef.current) return false;
    if (reconnectingRef.current) return false;

    const needsEvm = !evmConnected;
    const needsSol = !!(solWallet && !solConnected);
    if (!needsEvm && !needsSol) return false;

    if (Date.now() - lastReconnectAttemptRef.current < RECONNECT_COOLDOWN_MS) return false;

    reconnectingRef.current = true;
    lastReconnectAttemptRef.current = Date.now();
    try {
      // EVM: ask wagmi to restore the last-known connector. If there's
      // nothing stored (fresh visit, or user previously hit disconnect),
      // wagmi resolves with no-op -- we don't propagate the error.
      if (needsEvm && typeof evmReconnectAsync === 'function') {
        try { await evmReconnectAsync(); }
        catch (e) {
          // eslint-disable-next-line no-console
          if (e && e.message) console.debug('[WalletContext] EVM reconnect:', e.message);
        }
      }
      // Solana: only attempt if the adapter reports the wallet is detectable
      // (extension installed / in-app wallet present). Otherwise connect()
      // will throw with a misleading "wallet not ready" error.
      if (
        needsSol &&
        typeof solConnect === 'function' &&
        solWallet && solWallet.adapter &&
        solWallet.adapter.readyState !== 'NotDetected' &&
        solWallet.adapter.readyState !== 'Unsupported'
      ) {
        try { await solConnect(); }
        catch (e) {
          // User may need to approve in their wallet UI -- not a hard error.
          // eslint-disable-next-line no-console
          if (e && e.message) console.debug('[WalletContext] Solana reconnect:', e.message);
        }
      }
    } finally {
      reconnectingRef.current = false;
    }
    return true;
  }, [evmConnected, evmReconnectAsync, solWallet, solConnected, solConnect]);

  /* -- WC-7: visibility + network listeners --
   *
   *  When the user returns to the tab or the network comes back, attempt
   *  to silently restore any dropped connections. This is the single
   *  biggest UX win for mobile, where backgrounding for 30+ seconds will
   *  often kill the WalletConnect session.
   */
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

  /* -- WC-7: silent-failure heartbeat --
   *
   *  Catches sessions that died while the tab was always visible (long-idle
   *  WalletConnect sessions, server-side relay restart, mobile carrier
   *  network swap with no online/offline event). Cheap: we don't ping the
   *  wallet, we only look at our reactive state for "was connected, isn't
   *  anymore" and ask the adapters to restore. Only runs while the tab is
   *  visible to avoid waking laptops just to attempt reconnects.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (userExplicitlyDisconnectedRef.current) return;
      const isCurrentlyConnected = solConnected || evmConnected;
      if (wasConnectedRef.current && !isCurrentlyConnected) {
        reconnectIfStale();
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [solConnected, evmConnected, reconnectIfStale]);

  /* -- Disconnect both wallets cleanly.
   *
   *  WC-3: wagmi v2 exposes `disconnectAsync` -- a Promise-returning variant
   *  of disconnect that resolves only after the connection state has
   *  actually flipped (evmConnected -> false). We use it instead of the
   *  sync `disconnect()` + manual polling -- it removes the timing guess
   *  and eliminates the race where components read stale `connected: true`
   *  for one render cycle.
   *
   *  Fallback to sync evmDisconnect if disconnectAsync isn't available
   *  (older wagmi or unusual connector).
   *
   *  WC-7: we also clear the Solana wallet selection (`solSelect(null)`)
   *  so the adapter's autoConnect doesn't reconnect to the just-disconnected
   *  wallet on the next page load. And we set the explicit-disconnect ref
   *  so the heartbeat / visibility listeners don't immediately re-engage.
   */
  const disconnectAll = useCallback(async () => {
    userExplicitlyDisconnectedRef.current = true;
    wasConnectedRef.current = false;

    let ok = true;
    if (solConnected) {
      try { await solDisconnect(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[WalletContext] Solana disconnect error:', e);
        ok = false;
      }
    }
    if (evmConnected) {
      try {
        if (typeof evmDisconnectAsync === 'function') {
          await evmDisconnectAsync();
        } else {
          evmDisconnect();
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[WalletContext] EVM disconnect error:', e);
        ok = false;
      }
    }
    // Clear the persisted Solana wallet selection so autoConnect doesn't
    // re-engage on next page load. wagmi's disconnect() already clears its
    // own stored connector, so no equivalent step is needed for EVM.
    if (solWallet && typeof solSelect === 'function') {
      try { solSelect(null); } catch { /* no-op */ }
    }
    setActiveContext(null);
    return ok;
  }, [solConnected, evmConnected, solDisconnect, evmDisconnect, evmDisconnectAsync, solWallet, solSelect, setActiveContext]);

  /* -- Switch EVM chain with a promise we can await safely.
   *    Wraps wagmi's switchChainAsync with our own polling.
   *
   *  WC-5: Some mobile wallets are slow:
   *    - Coinbase Wallet iOS: 7-10s after user approves the prompt
   *    - Trust Wallet mobile: 5-7s
   *    - Phantom EVM: 2-4s
   *  Old 5s window returned false even when the switch eventually succeeded.
   *  10s covers the slow path. Polling stays cheap (150ms ticks).
   */
  const switchToChain = useCallback(async (targetChainId) => {
    if (!targetChainId || typeof targetChainId !== 'number') return false;
    if (evmChainIdRef.current === targetChainId) return true;
    try {
      if (switchChainAsync) {
        await switchChainAsync({ chainId: targetChainId });
      } else if (switchChain) {
        switchChain({ chainId: targetChainId });
      }
      // Verification window -- read fresh values via refs so we see the
      // post-switch state instead of the closure's stale snapshot.
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
      // eslint-disable-next-line no-console
      console.warn('[WalletContext] switchChain failed:', e && e.message);
      return false;
    }
  }, [switchChain, switchChainAsync]);

  /* -- Derived state -- */
  const isConnected = solConnected || evmConnected;
  const isConnecting = solConnecting || evmConnecting;

  // walletAddress respects activeContext when both are connected
  const walletAddress = useMemo(() => {
    if (solConnected && evmConnected) {
      // Both connected -- return based on activeContext
      if (activeContext === 'evm' && evmAddress) return evmAddress;
      if (publicKey) return publicKey.toString();
      return evmAddress || null;
    }
    if (solConnected && publicKey) return publicKey.toString();
    if (evmConnected && evmAddress) return evmAddress;
    return null;
  }, [solConnected, evmConnected, activeContext, publicKey, evmAddress]);

  const connectedWalletName = useMemo(() => {
    if (solConnected && evmConnected) {
      return activeContext === 'evm'
        ? (evmConnector && evmConnector.name) || 'EVM Wallet'
        : (solWallet && solWallet.adapter && solWallet.adapter.name) || 'Solana';
    }
    if (solConnected) return (solWallet && solWallet.adapter && solWallet.adapter.name) || 'Solana';
    if (evmConnected) return (evmConnector && evmConnector.name) || 'EVM Wallet';
    return null;
  }, [solConnected, evmConnected, activeContext, solWallet, evmConnector]);

  /* -- Context value -- */
  const value = useMemo(() => ({
    // Connection state
    isConnected,
    isConnecting,
    solConnected,
    evmConnected,
    isSolanaConnected: solConnected,    // backwards-compat alias

    // Addresses
    walletAddress,
    publicKey:  solConnected && publicKey ? publicKey : null,
    evmAddress: evmConnected ? evmAddress  : null,

    // Active context (which wallet is "primary" right now)
    activeContext,
    setActiveContext,

    // Chain
    evmChainId,
    headerChain,
    setHeaderChain,

    // Transaction signers
    walletClient,
    sendTransaction,
    signTransaction,
    signAllTransactions,
    switchChain,
    switchToChain,

    // Display
    connectedWalletName,

    // Presets (global)
    presets,
    setPresets,

    // Mobile in-app wallet detection
    isMobileInAppWallet,
    mobileInAppWalletName: mobileInAppWallet,

    // Disconnect both wallets
    disconnectAll,

    // Manual stale-session recheck (auto-fired on visibility / online /
    // heartbeat -- exposed for connect modals and error handlers).
    reconnectIfStale,
  }), [
    isConnected, isConnecting, solConnected, evmConnected,
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

/* ============================================================================
 * HOOK
 * ========================================================================= */

export function useNexusWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useNexusWallet must be used inside WalletContextProvider');
  return ctx;
}
