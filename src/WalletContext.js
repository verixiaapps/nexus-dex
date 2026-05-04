/**

- NEXUS DEX — Wallet Context
- 
- Single source of truth for:
- 1. Wallet connection state (Solana + EVM, simultaneously possible)
- 1. Active chain context (which wallet is “primary” for the current task)
- 1. Header network selector (the user’s chosen destination chain)
- 1. Quick Buy / Quick Sell presets (global, persisted)
- 1. Mobile in-app wallet detection
- 1. Disconnect flow that handles both wallet types
- 
- Usage in any component:
- const wallet = useNexusWallet();
- wallet.isConnected            — true if either wallet connected
- wallet.solConnected           — Solana wallet connected
- wallet.evmConnected           — EVM wallet connected
- wallet.publicKey              — Solana PublicKey (or null)
- wallet.evmAddress             — EVM address (or null)
- wallet.evmChainId             — Currently connected EVM chain
- wallet.headerChain            — User’s selected destination chain
- wallet.setHeaderChain(chainId)— Change header chain (persists)
- wallet.activeContext          — ‘solana’ | ‘evm’ | null (last-used)
- wallet.presets                — { buy:[], sell:[] }
- wallet.setPresets(p)          — Update presets (persists)
- wallet.disconnectAll()        — Disconnect both wallets
- wallet.isMobileInAppWallet    — User is in Phantom/MetaMask in-app browser
- wallet.walletClient           — viem WalletClient for EVM
- wallet.sendTransaction        — Solana send fn
- wallet.signTransaction        — Solana sign fn
- wallet.switchChain            — wagmi switchChain fn
- 
- Backwards compat (old field names kept so existing components don’t break):
- walletAddress, isSolanaConnected, connectedWalletName
  */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from ‘react’;
import { useWallet } from ‘@solana/wallet-adapter-react’;
import { useAccount, useWalletClient, useSwitchChain, useDisconnect } from ‘wagmi’;

const WalletContext = createContext(null);

/* ============================================================================

- LOCALSTORAGE KEYS — must match the keys used in SwapWidget.jsx so a
- change made there is read by us, and vice versa.
- ========================================================================= */

const PRESETS_LS_KEY      = ‘nexus_presets_v1’;
const HEADER_CHAIN_LS_KEY = ‘nexus_header_chain_v1’;
const ACTIVE_CTX_LS_KEY   = ‘nexus_active_ctx_v1’;

const DEFAULT_BUY_PRESETS  = [10, 25, 50, 100, 250];
const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];

/* ============================================================================

- MOBILE IN-APP WALLET DETECTION
- 
- When users open swap.verixiaapps.com inside Phantom’s or MetaMask’s in-app
- browser, the wallet is injected directly. Signing happens in-context, no
- app switching. This is the gold-standard mobile flow.
- 
- We detect by checking the user agent and injected globals.
- ========================================================================= */

function detectMobileInAppWallet() {
if (typeof window === ‘undefined’) return null;
const uaRaw = navigator.userAgent || ‘’;
const ua = uaRaw.toLowerCase();
// Only flag mobile in-app browsers — desktop extensions inject the same
// globals (window.phantom, window.ethereum.isCoinbaseWallet) and shouldn’t
// be treated as “in-app”.
const isMobile = /iphone|ipad|ipod|android/i.test(uaRaw);
if (!isMobile) return null;

// Phantom in-app browser
if (window.phantom && (window.phantom.solana || window.phantom.ethereum)) {
return ‘phantom’;
}
// MetaMask Mobile in-app browser
if (ua.includes(‘metamaskmobile’) || (window.ethereum && window.ethereum.isMetaMask)) {
return ‘metamask’;
}
// Trust Wallet in-app browser
if (ua.includes(‘trust’) && window.ethereum) return ‘trust’;
// Coinbase Wallet in-app browser
if (ua.includes(‘coinbasewallet’) || (window.ethereum && window.ethereum.isCoinbaseWallet)) {
return ‘coinbase’;
}
// Solflare in-app browser
if (window.solflare && window.solflare.isSolflare) return ‘solflare’;

return null;
}

/* ============================================================================

- PRESETS LOAD/SAVE
- ========================================================================= */

function loadPresets() {
try {
const raw = localStorage.getItem(PRESETS_LS_KEY);
if (!raw) return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
const p = JSON.parse(raw);

```
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
```

} catch {
return { buy: DEFAULT_BUY_PRESETS, sell: DEFAULT_SELL_PRESETS };
}
}

function savePresets(p) {
try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p)); } catch {}
}

/* ============================================================================

- HEADER CHAIN LOAD/SAVE
- ========================================================================= */

function loadHeaderChain() {
try {
const raw = localStorage.getItem(HEADER_CHAIN_LS_KEY);
if (!raw) return 1; // Default Ethereum
const v = JSON.parse(raw);
if (v === ‘solana’) return ‘solana’;
if (typeof v === ‘number’ && v > 0) return v;
return 1;
} catch { return 1; }
}

function saveHeaderChain(c) {
try { localStorage.setItem(HEADER_CHAIN_LS_KEY, JSON.stringify(c)); } catch {}
}

/* ============================================================================

- ACTIVE CONTEXT (last-used wallet type)
- 
- When both wallets are connected, we need to know which one the user is
- “actively using” — typically the last one they signed a tx with. This
- decides things like: does `walletAddress` return Solana or EVM address?
- 
- Persists across sessions.
- ========================================================================= */

function loadActiveContext() {
try {
const v = localStorage.getItem(ACTIVE_CTX_LS_KEY);
return v === ‘solana’ || v === ‘evm’ ? v : null;
} catch { return null; }
}

function saveActiveContext(ctx) {
try {
if (ctx) localStorage.setItem(ACTIVE_CTX_LS_KEY, ctx);
else localStorage.removeItem(ACTIVE_CTX_LS_KEY);
} catch {}
}

/* ============================================================================

- PROVIDER
- ========================================================================= */

export function WalletContextProvider({ children }) {
/* — Solana wallet hooks — */
const {
publicKey,
connected: solConnected,
connecting: solConnecting,
sendTransaction,
signTransaction,
signAllTransactions,
disconnect: solDisconnect,
wallet: solWallet,
} = useWallet();

/* — EVM wallet hooks — */
const {
address: evmAddress,
isConnected: evmConnected,
isConnecting: evmConnecting,
chainId: evmChainId,
connector: evmConnector,
} = useAccount();
const { data: walletClient } = useWalletClient();
const { switchChain, switchChainAsync } = useSwitchChain();
const { disconnect: evmDisconnect } = useDisconnect();

/* Refs that always hold the latest wagmi values. Async functions like

- switchToChain() poll these instead of useCallback-captured snapshots —
- otherwise the captured walletClient is stale by the time the chain
- actually switches and the polling loop never sees the new chain id. */
  const walletClientRef = useRef(walletClient);
  const evmChainIdRef   = useRef(evmChainId);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  useEffect(() => { evmChainIdRef.current   = evmChainId;   }, [evmChainId]);

/* — Header chain (destination network selector) — */
const [headerChain, setHeaderChainState] = useState(() => loadHeaderChain());
const setHeaderChain = useCallback((c) => {
setHeaderChainState(c);
saveHeaderChain(c);
}, []);

/* — Active context (which wallet type is “primary” right now) — */
const [activeContext, setActiveContextState] = useState(() => loadActiveContext());
const setActiveContext = useCallback((ctx) => {
setActiveContextState(ctx);
saveActiveContext(ctx);
}, []);

// Auto-update active context when one wallet connects without the other
useEffect(() => {
if (solConnected && !evmConnected && activeContext !== ‘solana’) {
setActiveContext(‘solana’);
} else if (evmConnected && !solConnected && activeContext !== ‘evm’) {
setActiveContext(‘evm’);
} else if (!solConnected && !evmConnected && activeContext != null) {
setActiveContext(null);
}
// When BOTH are connected, keep whatever was last set (don’t auto-switch)
}, [solConnected, evmConnected, activeContext, setActiveContext]);

// When user changes header chain to Solana, mark Solana as active context
// (if connected). Vice versa for EVM.
useEffect(() => {
if (headerChain === ‘solana’ && solConnected && activeContext !== ‘solana’) {
setActiveContext(‘solana’);
} else if (typeof headerChain === ‘number’ && evmConnected && activeContext !== ‘evm’) {
setActiveContext(‘evm’);
}
}, [headerChain, solConnected, evmConnected, activeContext, setActiveContext]);

/* — Presets — */
const [presets, setPresetsState] = useState(() => loadPresets());
const setPresets = useCallback((p) => {
setPresetsState(p);
savePresets(p);
}, []);

/* — Mobile in-app wallet detection (computed once on mount) — */
const mobileInAppWallet = useMemo(() => detectMobileInAppWallet(), []);
const isMobileInAppWallet = !!mobileInAppWallet;

/* — Disconnect both wallets cleanly.
*

- WC-3: wagmi’s `disconnect()` is a synchronous mutation but the connection
- state flip (evmConnected -> false, evmAddress -> undefined) propagates
- through wagmi’s reactive store on the next tick. If we resolve immediately,
- components reading evmConnected on the next render still see `true`,
- which causes a flash of “still connected” UI right before disconnect.
- 
- We poll briefly (max 1.5s) for the state to actually flip before resolving.
- Native wallet disconnect is awaitable so it doesn’t need this.
  */
  const disconnectAll = useCallback(async () => {
  let ok = true;
  if (solConnected) {
  try { await solDisconnect(); } catch (e) {
  // eslint-disable-next-line no-console
  console.warn(’[WalletContext] Solana disconnect error:’, e);
  ok = false;
  }
  }
  if (evmConnected) {
  try {
  evmDisconnect();
  // Wait briefly for wagmi to flip evmConnected to false. Without this
  // wait, components reading the post-disconnect state see stale
  // `connected: true` for one render cycle.
  const start = Date.now();
  while (Date.now() - start < 1_500) {
  // wagmi exposes the live connected flag through the same hook we
  // already destructured, but our `evmConnected` is the closure
  // snapshot. We can’t re-read it here. The cleanest signal is
  // `walletClientRef.current` — wagmi clears it on disconnect.
  if (!walletClientRef.current) break;
  await new Promise((r) => setTimeout(r, 100));
  }
  } catch (e) {
  // eslint-disable-next-line no-console
  console.warn(’[WalletContext] EVM disconnect error:’, e);
  ok = false;
  }
  }
  setActiveContext(null);
  return ok;
  }, [solConnected, evmConnected, solDisconnect, evmDisconnect, setActiveContext]);

/* — Switch EVM chain with a promise we can await safely.

- ```
  Wraps wagmi's switchChainAsync with our own polling.
  ```
- 
- WC-5: Some mobile wallets are slow:
- - Coinbase Wallet iOS: 7-10s after user approves the prompt
- - Trust Wallet mobile: 5-7s
- - Phantom EVM: 2-4s
- Old 5s window returned false even when the switch eventually succeeded.
- 10s covers the slow path. Polling stays cheap (150ms ticks).
  */
  const switchToChain = useCallback(async (targetChainId) => {
  if (!targetChainId || typeof targetChainId !== ‘number’) return false;
  if (evmChainIdRef.current === targetChainId) return true;
  try {
  if (switchChainAsync) {
  await switchChainAsync({ chainId: targetChainId });
  } else if (switchChain) {
  switchChain({ chainId: targetChainId });
  }
  // Verification window — read fresh values via refs so we see the
  // post-switch state instead of the closure’s stale snapshot.
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
  console.warn(’[WalletContext] switchChain failed:’, e && e.message);
  return false;
  }
  }, [switchChain, switchChainAsync]);

/* — Derived state — */
const isConnected = solConnected || evmConnected;
const isConnecting = solConnecting || evmConnecting;

// walletAddress respects activeContext when both are connected
const walletAddress = useMemo(() => {
if (solConnected && evmConnected) {
// Both connected — return based on activeContext
if (activeContext === ‘evm’ && evmAddress) return evmAddress;
if (publicKey) return publicKey.toString();
return evmAddress || null;
}
if (solConnected && publicKey) return publicKey.toString();
if (evmConnected && evmAddress) return evmAddress;
return null;
}, [solConnected, evmConnected, activeContext, publicKey, evmAddress]);

const connectedWalletName = useMemo(() => {
if (solConnected && evmConnected) {
return activeContext === ‘evm’
? (evmConnector && evmConnector.name) || ‘EVM Wallet’
: (solWallet && solWallet.adapter && solWallet.adapter.name) || ‘Solana’;
}
if (solConnected) return (solWallet && solWallet.adapter && solWallet.adapter.name) || ‘Solana’;
if (evmConnected) return (evmConnector && evmConnector.name) || ‘EVM Wallet’;
return null;
}, [solConnected, evmConnected, activeContext, solWallet, evmConnector]);

/* — Context value — */
const value = useMemo(() => ({
// Connection state
isConnected,
isConnecting,
solConnected,
evmConnected,
isSolanaConnected: solConnected,    // backwards-compat alias

```
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
```

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
disconnectAll,
]);

return (
<WalletContext.Provider value={value}>
{children}
</WalletContext.Provider>
);
}

/* ============================================================================

- HOOK
- ========================================================================= */

export function useNexusWallet() {
const ctx = useContext(WalletContext);
if (!ctx) throw new Error(‘useNexusWallet must be used inside WalletContextProvider’);
return ctx;
}