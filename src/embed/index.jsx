// src/embed/index.jsx
//
// The entry point config-overrides.embed.js builds into build/embed/verixia-swap.js.
// This was the file missing from the repo — `npm run build:embed` failed with
//   Module not found: Can't resolve '/app/src/embed/index.jsx'
// because nothing existed here. This mounts the SAME SwapWidget the main app uses
// into #verixia-swap-root, with the same wallet-adapter providers, so the embed
// bundle behaves identically to the app.
//
// Reads RPC from window.__VERIXIA_CONFIG__ (server-injected on Railway, or the
// static /embed/config.js on GitHub Pages), falling back to public mainnet-beta.
// Per-page default pair via data-input-mint / data-output-mint on the mount node.

import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  useWalletModal,
} from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// ── The ONE path to verify: point this at your existing SwapWidget.jsx. ──
// Default assumes src/components/SwapWidget.jsx. If yours lives elsewhere
// (e.g. '../SwapWidget'), change just this line.
import SwapWidget from '../components/SwapWidget';

const RUNTIME_CFG =
  (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const ENDPOINT = RUNTIME_CFG.rpc || 'https://api.mainnet-beta.solana.com';

// Inner component: needs to be inside WalletModalProvider to use the modal hook.
// onConnectWallet opens the standard wallet picker when no wallet is connected.
function EmbeddedSwap({ inputMint, outputMint }) {
  const { setVisible } = useWalletModal();
  return (
    <SwapWidget
      defaultInputMint={inputMint || undefined}
      defaultOutputMint={outputMint || undefined}
      onConnectWallet={() => setVisible(true)}
    />
  );
}

function EmbedApp({ inputMint, outputMint }) {
  // Empty array: Wallet Standard auto-registers Phantom / Solflare / Backpack,
  // so no per-adapter packages are required here.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <EmbeddedSwap inputMint={inputMint} outputMint={outputMint} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function mount() {
  const el = document.getElementById('verixia-swap-root');
  if (!el) return;
  // Clear the loading skeleton the SEO template renders before hydration.
  el.innerHTML = '';
  const inputMint = el.getAttribute('data-input-mint') || '';
  const outputMint = el.getAttribute('data-output-mint') || '';
  createRoot(el).render(
    <EmbedApp inputMint={inputMint} outputMint={outputMint} />
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
