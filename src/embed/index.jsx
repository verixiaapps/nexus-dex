// src/embed/index.jsx 
//
// VERIXIA SWAP EMBED — entry point for the standalone bundle shipped to every
// SEO page. Mounts the REAL SwapWidget plus the REAL connect flow
// (your WalletModal + TermsGate from WalletConnectKit — same as the main site).
//
// Fixes vs the version that failed to build:
//   • Uses the correct export from WalletContext.js: `WalletContextProvider`.
//     The old wrong name was the `Attempted import error` that failed the build.
//   • WalletConnect is MANDATORY — always registered (was conditional before).
//   • WalletConnect metadata matches the main app (src/index.js) so it lines up
//     with the project id's allowlisted domain (swap.verixiaapps.com).
//   • window.Buffer set, matching src/index.js.

import React, { useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';

import { WalletContextProvider } from '../WalletContext.js';
import SwapWidget from '../components/SwapWidget.jsx';
import { WalletModal, TermsGate } from '../components/WalletConnectKit.jsx';

import '@solana/wallet-adapter-react-ui/styles.css';

// Match src/index.js: some Solana libs read window.Buffer at runtime.
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

// ---------------------------------------------------------------------------
// Config — runtime first (window.__VERIXIA_CONFIG__ from the server), then
// build-time env, then public fallback.
// ---------------------------------------------------------------------------
const CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};

const RPC_URL =
  CFG.rpc ||
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const WC_PROJECT_ID =
  CFG.wcProjectId ||
  process.env.REACT_APP_WALLETCONNECT_PROJECT_ID ||
  '';

const TERMS_KEY = 'nexus_terms_accepted_v3';

// ---------------------------------------------------------------------------
// Provider stack — mirrors the main app's wallet wiring exactly.
// ---------------------------------------------------------------------------
function EmbedRoot({ inputMint, outputMint }) {
  const wallets = useMemo(() => {
    // WalletConnect is MANDATORY — always registered. The project id comes from
    // the server (window.__VERIXIA_CONFIG__.wcProjectId). If it's missing, that's
    // a Railway misconfiguration to fix, not something to silently skip.
    if (!WC_PROJECT_ID) {
      console.error(
        '[verixia-swap] WalletConnect projectId is missing — set WALLETCONNECT_PROJECT_ID in Railway.'
      );
    }
    return [
      new PhantomWalletAdapter(),
      new WalletConnectWalletAdapter({
        network: 'mainnet-beta',
        options: {
          projectId: WC_PROJECT_ID,
          metadata: {
            name: 'Nexus DEX',
            description: 'Solana DEX powered by Jupiter',
            url: 'https://swap.verixiaapps.com',
            icons: ['https://swap.verixiaapps.com/icon-512.png'],
          },
        },
      }),
    ];
  }, []);

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [termsPending, setTermsPending] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem(TERMS_KEY) === '1'; } catch { return false; }
  });

  // SwapWidget calls this when its "Connect Wallet" button is tapped.
  // Terms gate fires here on first connect, then opens the picker.
  const openWallet = useCallback(() => {
    if (termsAccepted) setWalletModalOpen(true);
    else setTermsPending(true);
  }, [termsAccepted]);

  const acceptTerms = useCallback(() => {
    try { localStorage.setItem(TERMS_KEY, '1'); } catch {}
    setTermsAccepted(true);
    setTermsPending(false);
    setWalletModalOpen(true);
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletContextProvider>
            <SwapWidget
              defaultInputMint={inputMint}
              defaultOutputMint={outputMint}
              onConnectWallet={openWallet}
            />
            {termsPending && <TermsGate onAccept={acceptTerms} />}
            <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
          </WalletContextProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ---------------------------------------------------------------------------
// Mount logic — idempotent, safe to call after page load.
// ---------------------------------------------------------------------------
const MOUNTED = new WeakSet();

function mount() {
  const el = document.getElementById('verixia-swap-root');
  if (!el) {
    console.warn('[verixia-swap] no #verixia-swap-root element on page');
    return;
  }
  if (MOUNTED.has(el)) return;
  MOUNTED.add(el);

  // Treat empty OR an unfilled "{{...}}" placeholder as absent → SwapWidget
  // falls back to its SOL/USDC defaults instead of using junk as a mint.
  const cleanMint = (v) => (v && v.indexOf('{{') === -1) ? v : undefined;
  const inputMint  = cleanMint(el.dataset.inputMint);
  const outputMint = cleanMint(el.dataset.outputMint);

  el.innerHTML = ''; // clear the skeleton

  const root = ReactDOM.createRoot(el);
  root.render(
    <React.StrictMode>
      <EmbedRoot inputMint={inputMint} outputMint={outputMint} />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

// Expose manual mount for SPA hosts that inject the script after load.
window.VerixiaSwap = { mount };
