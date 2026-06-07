// src/embed/index.jsx
//
// VERIXIA SWAP EMBED — entry point for the standalone bundle shipped to every
// SEO page. Mounts the REAL SwapWidget plus the REAL connect flow.
//
// What this wires up (vs the previous version which only rendered SwapWidget):
//   • WalletModal  — same Phantom/WalletConnect picker + Chainalysis screening
//   • TermsGate    — same terms sheet, fired on FIRST connect (not page load)
//   • onConnectWallet — passed into SwapWidget so its "Connect Wallet" button
//                       actually opens the picker (it's a no-op otherwise)
//   • Runtime config — RPC + WalletConnect id read from window.__VERIXIA_CONFIG__
//                      (served by the server from Railway env), so no secrets
//                      need to be baked in at build time.

import React, { useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

import { NexusWalletProvider } from '../WalletContext.js';
import SwapWidget from '../components/SwapWidget.jsx';
import { WalletModal, TermsGate } from '../components/WalletConnectKit.jsx';

import '@solana/wallet-adapter-react-ui/styles.css';

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
    const list = [new PhantomWalletAdapter()];
    if (WC_PROJECT_ID) {
      list.push(new WalletConnectWalletAdapter({
        network: WalletAdapterNetwork.Mainnet,
        options: {
          projectId: WC_PROJECT_ID,
          metadata: {
            name: 'Verixia',
            description: 'Swap any Solana token. No KYC, no accounts, no limits. Powered by Jupiter.',
            url: 'https://verixiaapps.com',
            icons: ['https://verixiaapps.com/icon.png'],
          },
        },
      }));
    }
    return list;
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
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <NexusWalletProvider>
            <SwapWidget
              defaultInputMint={inputMint}
              defaultOutputMint={outputMint}
              onConnectWallet={openWallet}
            />
            {termsPending && <TermsGate onAccept={acceptTerms} />}
            <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
          </NexusWalletProvider>
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
  // falls back to its SOL/USDC defaults instead of trying to use junk as a mint.
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
