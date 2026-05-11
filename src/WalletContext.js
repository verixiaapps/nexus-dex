/**
 * NEXUS DEX - Wallet Context (Solana only)
 * Single source of truth for wallet connection state, device policy,
 * active context, presets, and disconnect flow.
 */
  
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { usePrivy as _usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets as _useSolanaWalletsPrivy } from '@privy-io/react-auth/solana';

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

/* ============================================================================
 * STORAGE KEYS + DEFAULTS
 * ========================================================================= */

const PRESETS_LS_KEY      = 'nexus_presets_v2';
const HEADER_CHAIN_LS_KEY = 'nexus_header_chain_v1';
const ACTIVE_KIND_LS_KEY  = 'nexus_active_kind_v1';

const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
const DEFAULT_SELL_PRESETS = [50, 100];

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
    const validBuys = Array.isArray(p.buy) ? p.buy.map(Number).filter(v => Number.isFinite(v) && v > 0).slice(0, 5) : [];
    const validSells = Array.isArray(p.sell) ? p.sell.map(Number).filter(v => Number.isFinite(v) && v > 0 && v <= 100).slice(0, 4) : [];
    return { buy: validBuys.length >= 1 ? validBuys : DEFAULT_BUY_PRESETS, sell: validSells.length >= 1 ? validSells : DEFAULT_SELL_PRESETS };
  } catch { return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS }; }
}
function savePresets(p) { try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {} }

function loadHeaderChain() { try { const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY); if (!raw) return 'solana'; return JSON.parse(raw) || 'solana'; } catch { return 'solana'; } }
function saveHeaderChain(c) { try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {} }

const VALID_KINDS = ['phantom', 'privy', 'walletconnect'];
function loadActiveKind() { try { const v = localStorage.getItem(ACTIVE_KIND_LS_KEY); return VALID_KINDS.includes(v) ? v : null; } catch { return null; } }
function saveActiveKind(k) { try { if (k) localStorage.setItem(ACTIVE_KIND_LS_KEY, k); else localStorage.removeItem(ACTIVE_KIND_LS_KEY); } catch {} }

/* ============================================================================
 * PROVIDER
 * ========================================================================= */

export function WalletContextProvider({ children }) {
  const { publicKey: extSolPublicKey, connected: extSolConnected, connecting: solConnecting, sendTransaction: extSolSendTx, signTransaction: extSolSignTx, signAllTransactions: extSolSignAll, disconnect: solDisconnect, select: solSelect, wallet: solWallet } = useWallet();
  const privy = useSafePrivy();
  const privySolWallets = useSafePrivySolWallets();

  const privyEmbeddedSol = useMemo(() => { if (!privy.authenticated) return null; return privySolWallets.find(w => w && w.walletClientType === 'privy') || null; }, [privy.authenticated, privySolWallets]);

  const solConnected = extSolConnected || !!privyEmbeddedSol;
  const isConnected = solConnected;
  const isConnecting = solConnecting;

  const publicKey = useMemo(() => { if (extSolPublicKey) return extSolPublicKey; if (privyEmbeddedSol?.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } } return null; }, [extSolPublicKey, privyEmbeddedSol]);

  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback(c => { setHeaderChainState(c); saveHeaderChain(c); }, []);

  const [activeWalletKind, setActiveWalletKindState] = useState(() => loadActiveKind());
  const setActiveWalletKind = useCallback(k => { setActiveWalletKindState(k); saveActiveKind(k); }, []);

  useEffect(() => { if (extSolConnected && solWallet?.adapter) { const name = (solWallet.adapter.name || '').toLowerCase(); if (name.includes('phantom')) { setActiveWalletKind('phantom'); return; } if (name.includes('walletconnect')) { setActiveWalletKind('walletconnect'); return; } } if (privy.authenticated && privyEmbeddedSol) { setActiveWalletKind('privy'); return; } setActiveWalletKind(null); }, [extSolConnected, solWallet, privy.authenticated, privyEmbeddedSol, setActiveWalletKind]);

  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback(p => { setPresetsState(p); savePresets(p); }, []);

  const isMobile = useMemo(() => isMobileUA(), []);
  const mobileWalletApp = useMemo(() => detectMobileWalletApp(), []);

  const walletPolicy = useMemo(() => {
    if (!isMobile) return { environment: 'desktop', allowed: ['privy', 'phantom', 'walletconnect'], recommended: 'privy' };
    if (mobileWalletApp === 'phantom') return { environment: 'mobile-phantom-app', allowed: ['phantom'], recommended: 'phantom' };
    return { environment: 'mobile-browser', allowed: ['privy', 'phantom', 'walletconnect'], recommended: 'privy' };
  }, [isMobile, mobileWalletApp]);

  const loginPrivy = useCallback(() => { try { if (typeof privy.login === 'function') privy.login(); } catch (e) { console.warn('[WalletContext] Privy login failed:', e?.message); } }, [privy]);
  const logoutPrivy = useCallback(async () => { try { if (typeof privy.logout === 'function') await privy.logout(); } catch (e) { console.warn('[WalletContext] Privy logout failed:', e?.message); } }, [privy]);

  const disconnectAll = useCallback(async () => {
    if (extSolConnected) { try { await solDisconnect(); } catch (e) { console.warn('[WalletContext] Solana disconnect:', e); } }
    if (privy.authenticated) { try { await logoutPrivy(); } catch (e) { console.warn('[WalletContext] Privy disconnect:', e); } }
    if (solWallet && typeof solSelect === 'function') { try { solSelect(null); } catch {} }
    setActiveWalletKind(null);
  }, [extSolConnected, solDisconnect, solWallet, solSelect, setActiveWalletKind, privy.authenticated, logoutPrivy]);

  const walletAddress = useMemo(() => { if (solConnected && publicKey) return publicKey.toString(); return null; }, [solConnected, publicKey]);
  const connectedWalletName = useMemo(() => { if (activeWalletKind === 'privy') return 'Email / Social'; if (activeWalletKind === 'phantom') return 'Phantom'; if (activeWalletKind === 'walletconnect') return 'WalletConnect'; if (solConnected) return (solWallet?.adapter?.name) || 'Solana'; return null; }, [activeWalletKind, solConnected, solWallet]);

  const value = useMemo(() => ({
    isConnected, isConnecting, solConnected, isSolanaConnected: solConnected,
    activeWalletKind, setActiveWalletKind,
    privyReady: privy.ready, privyAuthenticated: privy.authenticated, privyUser: privy.user || null,
    privyEmbeddedSol, loginPrivy, logoutPrivy,
    privyExportWallet: typeof privy.exportWallet === 'function' ? privy.exportWallet : null,
    extSolConnected, extSolPublicKey,
    walletAddress, publicKey: solConnected && publicKey ? publicKey : null,
    headerChain, setHeaderChain,
    sendTransaction: extSolSendTx, signTransaction: extSolSignTx, signAllTransactions: extSolSignAll,
    connectedWalletName,
    presets, setPresets,
    isMobileDevice: isMobile, mobileWalletApp, walletPolicy,
    disconnectAll,
  }), [isConnected, isConnecting, solConnected, activeWalletKind, setActiveWalletKind, privy.ready, privy.authenticated, privy.user, privy.exportWallet, privyEmbeddedSol, loginPrivy, logoutPrivy, extSolConnected, extSolPublicKey, walletAddress, publicKey, headerChain, setHeaderChain, extSolSendTx, extSolSignTx, extSolSignAll, connectedWalletName, presets, setPresets, isMobile, mobileWalletApp, walletPolicy, disconnectAll]);

  return (<WalletContext.Provider value={value}>{children}</WalletContext.Provider>);
}

export function useNexusWallet() { const ctx = useContext(WalletContext); if (!ctx) throw new Error('useNexusWallet must be used inside WalletContextProvider'); return ctx; }