/**
 * NEXUS DEX - Wallet Context
 * Single source of truth for wallet connection state, device policy,
 * active context, presets, and disconnect flow.
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
  ready: false, authenticated: false, user: null,
  login: () => {}, logout: async () => {},
  connectWallet: () => {}, exportWallet: async () => {},
};

function useSafePrivy() { try { return _usePrivy(); } catch { return PRIVY_FALLBACK; } }
function useSafePrivySolWallets() { try { const r = _useSolanaWalletsPrivy(); return (r && r.wallets) || []; } catch { return []; } }
function useSafePrivyEvmWallets() { try { const r = _useWalletsPrivy(); return (r && r.wallets) || []; } catch { return []; } }

/* ============================================================================
 * STORAGE KEYS + DEFAULTS
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
 * ========================================================================= */

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
    const p = JSON.parse(raw);
    const validBuys = Array.isArray(p.buy) ? p.buy.map(Number).filter((v) => Number.isFinite(v) && v > 0).slice(0, 5) : [];
    const validSells = Array.isArray(p.sell) ? p.sell.map(Number).filter((v) => Number.isFinite(v) && v > 0 && v <= 100).slice(0, 4) : [];
    return { buy: validBuys.length >= 1 ? validBuys : DEFAULT_BUY_PRESETS, sell: validSells.length >= 1 ? validSells : DEFAULT_SELL_PRESETS };
  } catch { return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS }; }
}
function savePresets(p) { try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {} }

function loadHeaderChain() {
  try { const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY); if (!raw) return 1; const v = JSON.parse(raw); if (v === 'solana') return 'solana'; if (typeof v === 'number' && v > 0) return v; return 1; } catch { return 1; }
}
function saveHeaderChain(c) { try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {} }

function loadActiveContext() { try { const v = localStorage.getItem(ACTIVE_CTX_LS_KEY); return v === 'solana' || v === 'evm' ? v : null; } catch { return null; } }
function saveActiveContext(ctx) { try { if (ctx) localStorage.setItem(ACTIVE_CTX_LS_KEY, ctx); else localStorage.removeItem(ACTIVE_CTX_LS_KEY); } catch {} }

const VALID_KINDS = ['phantom', 'solflare', 'walletconnect', 'injected', 'privy'];
function loadActiveKind() { try { const v = localStorage.getItem(ACTIVE_KIND_LS_KEY); return VALID_KINDS.includes(v) ? v : null; } catch { return null; } }
function saveActiveKind(k) { try { if (k) localStorage.setItem(ACTIVE_KIND_LS_KEY, k); else localStorage.removeItem(ACTIVE_KIND_LS_KEY); } catch {} }

/* ============================================================================
 * PROVIDER
 * ========================================================================= */

export function WalletContextProvider({ children }) {
  const { publicKey: extSolPublicKey, connected: extSolConnected, connecting: solConnecting, sendTransaction: extSolSendTx, signTransaction: extSolSignTx, signAllTransactions: extSolSignAll, disconnect: solDisconnect, select: solSelect, wallet: solWallet } = useWallet();
  const { address: extEvmAddress, isConnected: extEvmConnected, isConnecting: evmConnecting, chainId: evmChainId, connector: evmConnector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { disconnect: evmDisconnect, disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const { reconnectAsync: evmReconnectAsync } = useReconnect();

  const privy = useSafePrivy();
  const privySolWallets = useSafePrivySolWallets();
  const privyAllWallets = useSafePrivyEvmWallets();

  const privyEmbeddedSol = useMemo(() => { if (!privy.authenticated) return null; return privySolWallets.find((w) => w && w.walletClientType === 'privy') || null; }, [privy.authenticated, privySolWallets]);
  const privyEmbeddedEvm = useMemo(() => { if (!privy.authenticated) return null; return privyAllWallets.find((w) => w && w.walletClientType === 'privy' && w.chainType === 'ethereum') || null; }, [privy.authenticated, privyAllWallets]);

  const walletClientRef = useRef(walletClient);
  const evmChainIdRef = useRef(evmChainId);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  useEffect(() => { evmChainIdRef.current = evmChainId; }, [evmChainId]);

  const solConnected = extSolConnected || !!privyEmbeddedSol;
  const evmConnected = extEvmConnected || !!privyEmbeddedEvm;
  const isConnected = solConnected || evmConnected;
  const isConnecting = solConnecting || evmConnecting;

  const publicKey = useMemo(() => { if (extSolPublicKey) return extSolPublicKey; if (privyEmbeddedSol && privyEmbeddedSol.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } } return null; }, [extSolPublicKey, privyEmbeddedSol]);
  const evmAddress = extEvmAddress || (privyEmbeddedEvm && privyEmbeddedEvm.address) || null;

  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback((c) => { setHeaderChainState(c); saveHeaderChain(c); }, []);

  const [activeContext, setActiveContextState] = useState(() => loadActiveContext());
  const setActiveContext = useCallback((ctx) => { setActiveContextState(ctx); saveActiveContext(ctx); }, []);

  useEffect(() => { if (!solConnected && !evmConnected) { if (activeContext != null) setActiveContext(null); return; } if (activeContext != null) return; if (solConnected && !evmConnected) setActiveContext('solana'); else if (evmConnected && !solConnected) setActiveContext('evm'); else if (solConnected && evmConnected) setActiveContext(headerChain === 'solana' ? 'solana' : 'evm'); }, [solConnected, evmConnected, activeContext, headerChain, setActiveContext]);

  const [activeWalletKind, setActiveWalletKindState] = useState(() => loadActiveKind());
  const setActiveWalletKind = useCallback((k) => { setActiveWalletKindState(k); saveActiveKind(k); }, []);

  useEffect(() => { if (extSolConnected && solWallet && solWallet.adapter) { const name = (solWallet.adapter.name || '').toLowerCase(); if (name.includes('phantom')) { setActiveWalletKind('phantom'); return; } if (name.includes('solflare')) { setActiveWalletKind('solflare'); return; } } if (extEvmConnected && evmConnector) { const cid = (evmConnector.id || '').toLowerCase(); if (cid === 'walletconnect') { setActiveWalletKind('walletconnect'); return; } setActiveWalletKind('injected'); return; } if (privy.authenticated && (privyEmbeddedSol || privyEmbeddedEvm)) { setActiveWalletKind('privy'); return; } setActiveWalletKind(null); }, [extSolConnected, extEvmConnected, solWallet, evmConnector, privy.authenticated, privyEmbeddedSol, privyEmbeddedEvm, setActiveWalletKind]);

  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback((p) => { setPresetsState(p); savePresets(p); }, []);

  const isMobile = useMemo(() => isMobileUA(), []);
  const mobileWalletApp = useMemo(() => detectMobileWalletApp(), []);

  /* -- WALLET POLICY — allowing all wallet options on every device -- */
  const walletPolicy = useMemo(() => {
    if (!isMobile) return { environment: 'desktop', allowed: ['privy', 'phantom', 'solflare', 'walletconnect'], recommended: 'privy' };
    if (mobileWalletApp === 'phantom') return { environment: 'mobile-phantom-app', allowed: ['phantom'], recommended: 'phantom' };
    if (mobileWalletApp === 'solflare') return { environment: 'mobile-solflare-app', allowed: ['solflare'], recommended: 'solflare' };
    if (mobileWalletApp === 'evm') return { environment: 'mobile-evm-app', allowed: ['injected'], recommended: 'injected' };
    // Regular mobile browser: allow ALL wallet options
    return { environment: 'mobile-browser', allowed: ['privy', 'phantom', 'solflare', 'walletconnect'], recommended: 'privy' };
  }, [isMobile, mobileWalletApp]);

  /* -- EVM reconnect on visibility/online -- */
  const lastEvmReconnectAtRef = useRef(0);
  const evmReconnectInFlightRef = useRef(false);
  const userExplicitlyDisconnectedRef = useRef(false);

  useEffect(() => { if (extEvmConnected) userExplicitlyDisconnectedRef.current = false; }, [extEvmConnected]);

  const tryEvmReconnect = useCallback(async () => {
    if (typeof evmReconnectAsync !== 'function') return;
    if (extEvmConnected) return;
    if (userExplicitlyDisconnectedRef.current) return;
    if (evmReconnectInFlightRef.current) return;
    if (Date.now() - lastEvmReconnectAtRef.current < EVM_RECONNECT_THROTTLE_MS) return;
    evmReconnectInFlightRef.current = true;
    lastEvmReconnectAtRef.current = Date.now();
    try { await evmReconnectAsync(); } catch (e) { if (e && e.message) console.debug('[WalletContext] EVM reconnect:', e.message); } finally { evmReconnectInFlightRef.current = false; }
  }, [evmReconnectAsync, extEvmConnected]);

  useEffect(() => { if (typeof window === 'undefined' || typeof document === 'undefined') return; const onVisibility = () => { if (document.visibilityState === 'visible') tryEvmReconnect(); }; const onOnline = () => { tryEvmReconnect(); }; document.addEventListener('visibilitychange', onVisibility); window.addEventListener('online', onOnline); return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', onOnline); }; }, [tryEvmReconnect]);

  const loginPrivy = useCallback(() => { try { if (typeof privy.login === 'function') privy.login(); } catch (e) { console.warn('[WalletContext] Privy login failed:', e && e.message); } }, [privy]);
  const logoutPrivy = useCallback(async () => { try { if (typeof privy.logout === 'function') await privy.logout(); } catch (e) { console.warn('[WalletContext] Privy logout failed:', e && e.message); } }, [privy]);

  const disconnectAll = useCallback(async () => {
    userExplicitlyDisconnectedRef.current = true;
    if (extSolConnected) { try { await solDisconnect(); } catch (e) { console.warn('[WalletContext] Solana disconnect:', e); } }
    if (extEvmConnected) { try { if (typeof evmDisconnectAsync === 'function') await evmDisconnectAsync(); else evmDisconnect(); } catch (e) { console.warn('[WalletContext] EVM disconnect:', e); } }
    if (privy.authenticated) { try { await logoutPrivy(); } catch (e) { console.warn('[WalletContext] Privy disconnect:', e); } }
    if (solWallet && typeof solSelect === 'function') { try { solSelect(null); } catch {} }
    setActiveContext(null);
    setActiveWalletKind(null);
  }, [extSolConnected, extEvmConnected, solDisconnect, evmDisconnect, evmDisconnectAsync, solWallet, solSelect, setActiveContext, setActiveWalletKind, privy.authenticated, logoutPrivy]);

  const switchToChain = useCallback(async (targetChainId) => { if (!targetChainId || typeof targetChainId !== 'number') return false; if (evmChainIdRef.current === targetChainId) return true; try { if (switchChainAsync) await switchChainAsync({ chainId: targetChainId }); else if (switchChain) switchChain({ chainId: targetChainId }); const start = Date.now(); while (Date.now() - start < 10_000) { const wc = walletClientRef.current; const cid = evmChainIdRef.current; if (cid === targetChainId) return true; if (wc && wc.chain && wc.chain.id === targetChainId) return true; await new Promise((r) => setTimeout(r, 150)); } const wc = walletClientRef.current; const cid = evmChainIdRef.current; return cid === targetChainId || (wc && wc.chain && wc.chain.id === targetChainId); } catch (e) { console.warn('[WalletContext] switchChain:', e && e.message); return false; } }, [switchChain, switchChainAsync]);

  const walletAddress = useMemo(() => { if (solConnected && evmConnected) { if (activeContext === 'evm' && evmAddress) return evmAddress; if (publicKey) return publicKey.toString(); return evmAddress || null; } if (solConnected && publicKey) return publicKey.toString(); if (evmConnected && evmAddress) return evmAddress; return null; }, [solConnected, evmConnected, activeContext, publicKey, evmAddress]);

  const connectedWalletName = useMemo(() => { if (activeWalletKind === 'privy') return 'Email / Social'; if (activeWalletKind === 'phantom') return 'Phantom'; if (activeWalletKind === 'solflare') return 'Solflare'; if (activeWalletKind === 'walletconnect') return (evmConnector && evmConnector.name) || 'WalletConnect'; if (activeWalletKind === 'injected') return (evmConnector && evmConnector.name) || 'Wallet'; if (solConnected) return (solWallet && solWallet.adapter && solWallet.adapter.name) || 'Solana'; if (evmConnected) return (evmConnector && evmConnector.name) || 'EVM Wallet'; return null; }, [activeWalletKind, solConnected, evmConnected, solWallet, evmConnector]);

  const value = useMemo(() => ({
    isConnected, isConnecting, solConnected, evmConnected, isSolanaConnected: solConnected,
    activeWalletKind, setActiveWalletKind,
    privyReady: privy.ready, privyAuthenticated: privy.authenticated, privyUser: privy.user || null,
    privyEmbeddedSol, privyEmbeddedEvm, loginPrivy, logoutPrivy,
    privyExportWallet: typeof privy.exportWallet === 'function' ? privy.exportWallet : null,
    extSolConnected, extSolPublicKey, extEvmConnected, extEvmAddress, evmConnector,
    walletAddress, publicKey: solConnected && publicKey ? publicKey : null, evmAddress: evmConnected ? evmAddress : null,
    activeContext, setActiveContext,
    evmChainId, headerChain, setHeaderChain,
    walletClient, sendTransaction: extSolSendTx, signTransaction: extSolSignTx, signAllTransactions: extSolSignAll,
    switchChain, switchToChain,
    connectedWalletName,
    presets, setPresets,
    isMobileDevice: isMobile, mobileWalletApp, walletPolicy,
    disconnectAll, reconnectIfStale: tryEvmReconnect,
  }), [isConnected, isConnecting, solConnected, evmConnected, activeWalletKind, setActiveWalletKind, privy.ready, privy.authenticated, privy.user, privy.exportWallet, privyEmbeddedSol, privyEmbeddedEvm, loginPrivy, logoutPrivy, extSolConnected, extSolPublicKey, extEvmConnected, extEvmAddress, evmConnector, walletAddress, publicKey, evmAddress, activeContext, setActiveContext, evmChainId, headerChain, setHeaderChain, walletClient, extSolSendTx, extSolSignTx, extSolSignAll, switchChain, switchToChain, connectedWalletName, presets, setPresets, isMobile, mobileWalletApp, walletPolicy, disconnectAll, tryEvmReconnect]);

  return (<WalletContext.Provider value={value}>{children}</WalletContext.Provider>);
}

export function useNexusWallet() { const ctx = useContext(WalletContext); if (!ctx) throw new Error('useNexusWallet must be used inside WalletContextProvider'); return ctx; }