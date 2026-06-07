// src/embed/index.jsx
//
// VERIXIA SWAP EMBED — entry point for the standalone bundle shipped to every
// SEO page (build/embed/verixia-swap.js).
//
// Responsibilities:
//   1. Read runtime config from window.__VERIXIA_CONFIG__ (served by the
//      server at /embed/config.js) so NO secret is baked into the bundle.
//   2. Find <div id="verixia-swap-root" data-input-mint data-output-mint>.
//   3. Set up the Solana wallet provider stack (Connection, Wallet,
//      WalletModal) and render the real SwapWidget.
//   4. Wire the SwapWidget's "Connect Wallet" button to the wallet-adapter
//      modal so first-time visitors can actually connect.
//
// SwapWidget itself runs the same code path as the main app.

import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';

// The real SwapWidget (your main-site component, unchanged) — it accepts
// defaultInputMint / defaultOutputMint / onConnectWallet props, and reads RPC
// from window.__VERIXIA_CONFIG__ on its own.
import SwapWidget from '../components/SwapWidget.jsx';

// Wallet-adapter modal styles. With the embed build's style-loader config this
// is injected into the page at runtime, so the connect modal is styled with no
// extra <link> on the SEO page.
import '@solana/wallet-adapter-react-ui/styles.css';

// Match src/index.js: some Solana libs read window.Buffer at runtime. The build
// polyfills Buffer for modules, but set it on window too so the bundle behaves
// exactly like the main app (a missing window.Buffer is a common cause of a
// silently blank widget).
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Runtime config — injected by the server at /embed/config.js
 *   window.__VERIXIA_CONFIG__ = { rpc, wcProjectId }
 * Falls back to build-time env vars, then public mainnet, so the bundle is
 * self-contained and free of build-time secrets.
 * ────────────────────────────────────────────────────────────────────────── */
const CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};

const RPC_URL =
  CFG.rpc ||
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const WC_PROJECT_ID =
  CFG.wcProjectId || process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || '';

function onWalletError(err, adapter) {
  console.warn('[verixia-swap] wallet error:', adapter && adapter.name, err && err.message);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Inner component — lives INSIDE WalletModalProvider so it can open the modal,
 * and passes that handler down to SwapWidget's connect button.
 * ────────────────────────────────────────────────────────────────────────── */
function EmbedSwap({ inputMint, outputMint }) {
  const { setVisible } = useWalletModal();
  return (
    <SwapWidget
      defaultInputMint={inputMint}
      defaultOutputMint={outputMint}
      onConnectWallet={() => setVisible(true)}
    />
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Provider stack
 * ────────────────────────────────────────────────────────────────────────── */
function EmbedRoot({ inputMint, outputMint }) {
  const wallets = useMemo(() => {
    // WalletConnect is MANDATORY. It is always registered. WC_PROJECT_ID is a
    // required config value (served by the server via /embed/config.js). If it's
    // missing, that's a misconfiguration to fix in Railway, not something to
    // silently skip.
    if (!WC_PROJECT_ID) {
      console.error(
        '[verixia-swap] WalletConnect projectId is missing. Set it in Railway so ' +
        'server.js exposes it via window.__VERIXIA_CONFIG__.wcProjectId. ' +
        'WalletConnect will not initialize until it is set.'
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

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
        <WalletModalProvider>
          <EmbedSwap inputMint={inputMint} outputMint={outputMint} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Mount logic — idempotent, safe to call more than once.
 * ────────────────────────────────────────────────────────────────────────── */
const MOUNTED = new WeakSet();

// Treat empty strings AND unfilled "{{PLACEHOLDER}}" tokens as "no value", so a
// page whose generator forgot to substitute the mint still falls back cleanly
// to SOL → USDC instead of trying to use a literal "{{INPUT_MINT}}" as a mint.
function cleanMint(v) {
  const s = (v || '').trim();
  if (!s || s.includes('{{')) return undefined;
  return s;
}

function mount() {
  const el = document.getElementById('verixia-swap-root');
  if (!el) {
    console.warn('[verixia-swap] no #verixia-swap-root element on page');
    return;
  }
  if (MOUNTED.has(el)) return;
  MOUNTED.add(el);

  const inputMint  = cleanMint(el.dataset.inputMint);
  const outputMint = cleanMint(el.dataset.outputMint);

  // Clear any skeleton markup the SEO page rendered.
  el.innerHTML = '';

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
  // Script tag uses `defer`, so the DOM is parsed by the time we run.
  mount();
}

// Expose manual mount for SPA hosts that inject the script after load.
window.VerixiaSwap = { mount };
