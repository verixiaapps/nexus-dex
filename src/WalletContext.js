/**
 * NEXUS DEX - Wallet Context
 *
 * Single source of truth for wallet connection state, device policy,
 * active context, presets, and disconnect flow.
 *
 * CHANGES vs prior version:
 *   • Now exposes BOTH Privy embedded wallets — Solana AND Ethereum/Polygon.
 *   • The Ethereum embedded wallet is what owns the user's Polymarket
 *     Safe on Polygon and signs CLOB orders silently.
 *   • Adds `privyEmbeddedEvm` (the wallet object) plus `getEvmProvider()`
 *     and `getEvmAddress()` helpers used by Predict.jsx.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { usePrivy as _usePrivy, useWallets as _useEvmWalletsPrivy, useCreateWallet as _useCreateWalletPrivy } from '@privy-io/react-auth';
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

function useSafePrivy()         { try { return _usePrivy(); }                       catch { return PRIVY_FALLBACK; } }
function useSafePrivySolWallets(){ try { const r = _useSolanaWalletsPrivy(); return (r && r.wallets) || []; } catch { return []; } }
function useSafePrivyEvmWallets(){ try { const r = _useEvmWalletsPrivy();    return (r && r.wallets) || []; } catch { return []; } }
function useSafePrivyCreateWallet() {
  try {
    const r = _useCreateWalletPrivy();
    return (r && typeof r.createWallet === 'function') ? r.createWallet : null;
  } catch { return null; }
}

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
    const validBuys  = Array.isArray(p.buy)  ? p.buy .map(Number).filter(v => Number.isFinite(v) && v > 0).slice(0, 5) : [];
    const validSells = Array.isArray(p.sell) ? p.sell.map(Number).filter(v => Number.isFinite(v) && v > 0 && v <= 100).slice(0, 4) : [];
    return {
      buy:  validBuys.length  >= 1 ? validBuys  : DEFAULT_BUY_PRESETS,
      sell: validSells.length >= 1 ? validSells : DEFAULT_SELL_PRESETS,
    };
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
  const {
    publicKey: extSolPublicKey, connected: extSolConnected, connecting: solConnecting,
    sendTransaction: extSolSendTx, signTransaction: extSolSignTx, signAllTransactions: extSolSignAll,
    disconnect: solDisconnect, select: solSelect, wallet: solWallet,
  } = useWallet();
  const privy           = useSafePrivy();
  const privySolWallets = useSafePrivySolWallets();
  const privyEvmWallets = useSafePrivyEvmWallets();

  // Privy embedded Solana wallet (funding source + Solana signer for bridge tx)
  const privyEmbeddedSol = useMemo(() => {
    if (!privy.authenticated) return null;
    return privySolWallets.find(w => w && w.walletClientType === 'privy') || null;
  }, [privy.authenticated, privySolWallets]);

  // Privy embedded EVM wallet (owns the Polymarket Safe; signs CLOB orders)
  const privyEmbeddedEvm = useMemo(() => {
    if (!privy.authenticated) return null;
    return privyEvmWallets.find(w => w && w.walletClientType === 'privy') || null;
  }, [privy.authenticated, privyEvmWallets]);

  // BACKFILL: existing Privy users who signed up before EVM was enabled
  // will be authenticated but missing an EVM wallet. Create one for them
  // automatically. Runs once per session, guarded by a ref to avoid loops.
  const createWallet = useSafePrivyCreateWallet();
  const evmCreateAttemptedRef = useRef(false);
  useEffect(() => {
    if (!privy.ready || !privy.authenticated) return;
    if (privyEmbeddedEvm) return;          // already have one
    if (!createWallet) return;              // hook unavailable
    if (evmCreateAttemptedRef.current) return;
    evmCreateAttemptedRef.current = true;
    console.log('[WalletContext] backfilling missing Privy EVM wallet…');
    Promise.resolve(createWallet({ chainType: 'ethereum' }))
      .then((w) => console.log('[WalletContext] EVM wallet created:', w?.address || w))
      .catch((e) => {
        console.warn('[WalletContext] EVM wallet creation failed:', e?.message || e);
        evmCreateAttemptedRef.current = false; // allow retry next mount
      });
  }, [privy.ready, privy.authenticated, privyEmbeddedEvm, createWallet]);

  const solConnected = extSolConnected || !!privyEmbeddedSol;
  const isConnected  = solConnected;
  const isConnecting = solConnecting;

  const publicKey = useMemo(() => {
    if (extSolPublicKey) return extSolPublicKey;
    if (privyEmbeddedSol?.address) {
      try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; }
    }
    return null;
  }, [extSolPublicKey, privyEmbeddedSol]);

  const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
  const setHeaderChain = useCallback(c => { setHeaderChainState(c); saveHeaderChain(c); }, []);

  const [activeWalletKind, setActiveWalletKindState] = useState(() => loadActiveKind());
  const setActiveWalletKind = useCallback(k => { setActiveWalletKindState(k); saveActiveKind(k); }, []);

  useEffect(() => {
    if (extSolConnected && solWallet?.adapter) {
      const name = (solWallet.adapter.name || '').toLowerCase();
      if (name.includes('phantom'))         { setActiveWalletKind('phantom');       return; }
      if (name.includes('walletconnect'))   { setActiveWalletKind('walletconnect'); return; }
    }
    if (privy.authenticated && privyEmbeddedSol) { setActiveWalletKind('privy'); return; }
    setActiveWalletKind(null);
  }, [extSolConnected, solWallet, privy.authenticated, privyEmbeddedSol, setActiveWalletKind]);

  const [presets, setPresetsState] = useState(() => loadPresets());
  const setPresets = useCallback(p => { setPresetsState(p); savePresets(p); }, []);

  const isMobile         = useMemo(() => isMobileUA(),            []);
  const mobileWalletApp  = useMemo(() => detectMobileWalletApp(), []);

  const walletPolicy = useMemo(() => {
    if (!isMobile) return { environment: 'desktop', allowed: ['privy', 'phantom', 'walletconnect'], recommended: 'privy' };
    if (mobileWalletApp === 'phantom') return { environment: 'mobile-phantom-app', allowed: ['phantom'], recommended: 'phantom' };
    return { environment: 'mobile-browser', allowed: ['privy', 'phantom', 'walletconnect'], recommended: 'privy' };
  }, [isMobile, mobileWalletApp]);

  const loginPrivy  = useCallback(()       => { try { if (typeof privy.login  === 'function')      privy.login(); }       catch (e) { console.warn('[WalletContext] Privy login failed:',  e?.message); } }, [privy]);
  const logoutPrivy = useCallback(async () => { try { if (typeof privy.logout === 'function') await privy.logout(); }      catch (e) { console.warn('[WalletContext] Privy logout failed:', e?.message); } }, [privy]);

  const disconnectAll = useCallback(async () => {
    if (extSolConnected)     { try { await solDisconnect(); } catch (e) { console.warn('[WalletContext] Solana disconnect:', e); } }
    if (privy.authenticated) { try { await logoutPrivy();   } catch (e) { console.warn('[WalletContext] Privy disconnect:',  e); } }
    if (solWallet && typeof solSelect === 'function') { try { solSelect(null); } catch {} }
    setActiveWalletKind(null);
  }, [extSolConnected, solDisconnect, solWallet, solSelect, setActiveWalletKind, privy.authenticated, logoutPrivy]);

  // ───────────────────────────────────────────────────────────────
  // EVM HELPERS for Predict.jsx (Polymarket signer)
  // ───────────────────────────────────────────────────────────────

  // Returns the embedded EVM wallet's address, or null.
  const getEvmAddress = useCallback(() => {
    return privyEmbeddedEvm?.address || null;
  }, [privyEmbeddedEvm]);

  // Returns the EIP-1193 provider for the embedded EVM wallet. Used to
  // build a viem WalletClient on demand inside Predict.jsx.
  //
  // IMPORTANT: this returns a Promise — Privy lazily injects the provider
  // when first requested, so callers must await it.
  const getEvmProvider = useCallback(async () => {
    if (!privyEmbeddedEvm) return null;
    if (typeof privyEmbeddedEvm.getEthereumProvider !== 'function') {
      console.warn('[WalletContext] privyEmbeddedEvm has no getEthereumProvider — check @privy-io/react-auth version');
      return null;
    }
    try { return await privyEmbeddedEvm.getEthereumProvider(); }
    catch (e) {
      console.error('[WalletContext] getEthereumProvider failed:', e);
      return null;
    }
  }, [privyEmbeddedEvm]);

  const walletAddress = useMemo(() => {
    if (solConnected && publicKey) return publicKey.toString();
    return null;
  }, [solConnected, publicKey]);

  const connectedWalletName = useMemo(() => {
    if (activeWalletKind === 'privy')         return 'Email / Social';
    if (activeWalletKind === 'phantom')       return 'Phantom';
    if (activeWalletKind === 'walletconnect') return 'WalletConnect';
    if (solConnected) return (solWallet?.adapter?.name) || 'Solana';
    return null;
  }, [activeWalletKind, solConnected, solWallet]);

  const value = useMemo(() => ({
    // Connection state
    isConnected, isConnecting, solConnected, isSolanaConnected: solConnected,
    activeWalletKind, setActiveWalletKind,

    // Privy
    privyReady:         privy.ready,
    privyAuthenticated: privy.authenticated,
    privyUser:          privy.user || null,
    privyExportWallet:  typeof privy.exportWallet === 'function' ? privy.exportWallet : null,
    loginPrivy, logoutPrivy,

    // Privy embedded wallets
    privyEmbeddedSol,        // Solana embedded — for funding/bridging
    privyEmbeddedEvm,        // Polygon embedded — for Polymarket Safe + CLOB
    getEvmAddress,           // () => string|null
    getEvmProvider,          // () => Promise<EIP1193Provider|null>

    // External Solana wallet (Phantom, WalletConnect)
    extSolConnected, extSolPublicKey,
    walletAddress,
    publicKey: solConnected && publicKey ? publicKey : null,
    sendTransaction:     extSolSendTx,
    signTransaction:     extSolSignTx,
    signAllTransactions: extSolSignAll,

    // UI prefs
    headerChain, setHeaderChain,
    connectedWalletName,
    presets, setPresets,

    // Policy
    isMobileDevice: isMobile, mobileWalletApp, walletPolicy,
    disconnectAll,
  }), [
    isConnected, isConnecting, solConnected, activeWalletKind, setActiveWalletKind,
    privy.ready, privy.authenticated, privy.user, privy.exportWallet,
    privyEmbeddedSol, privyEmbeddedEvm, getEvmAddress, getEvmProvider,
    loginPrivy, logoutPrivy,
    extSolConnected, extSolPublicKey, walletAddress, publicKey,
    headerChain, setHeaderChain,
    extSolSendTx, extSolSignTx, extSolSignAll,
    connectedWalletName, presets, setPresets,
    isMobile, mobileWalletApp, walletPolicy, disconnectAll,
  ]);

  return (<WalletContext.Provider value={value}>{children}</WalletContext.Provider>);
}

export function useNexusWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useNexusWallet must be used inside WalletContextProvider');
  return ctx;
}
