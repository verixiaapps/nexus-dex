// src/embed/index.jsx — Entry point for the self-contained embed bundle.
// 
// Railway runs `npm run build:embed` which uses config-overrides.embed.js
// to build this file into build/embed/verixia-swap.js.
//
// The SEO pages on GitHub Pages (verixiaapps.com) load this bundle via:
//   <script src="https://swap.verixiaapps.com/embed/verixia-swap.js"></script>
//
// Runtime config comes from window.__VERIXIA_CONFIG__ (set by /embed/config.js).

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import SwapWidget from '../components/SwapWidget';
import '../components/SwapWidget.css';

const RUNTIME_CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};

const RPC_URL =
  RUNTIME_CFG.rpc ||
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const wallets = [new PhantomWalletAdapter()];

function EmbedApp() {
  const root = document.getElementById('verixia-swap-root');
  const defaultInputMint = root?.getAttribute('data-input-mint') || undefined;
  const defaultOutputMint = root?.getAttribute('data-output-mint') || undefined;

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <SwapWidget
          defaultInputMint={defaultInputMint}
          defaultOutputMint={defaultOutputMint}
        />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function mount() {
  const el = document.getElementById('verixia-swap-root');
  if (!el) {
    console.warn('[verixia-embed] #verixia-swap-root not found');
    return;
  }
  const root = createRoot(el);
  root.render(<EmbedApp />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
