/**
 * NEXUS DEX -- App entry
 *
 * Stack:
 *   • Solana wallet adapter (Phantom + WalletConnect)
 *   • @tanstack/react-query for data fetching/caching
 *   • Helius or public RPC for Solana
 *
 * No Privy, no EVM, no Polygon — Solana-only.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';
import '@solana/wallet-adapter-react-ui/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
  || (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

const solanaWallets = [
  new PhantomWalletAdapter(),
  new WalletConnectWalletAdapter({
    network: 'mainnet-beta',
    options: {
      projectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || '',
      metadata: {
        name: 'Nexus DEX',
        description: 'Solana DEX powered by Jupiter',
        url: 'https://swap.verixiaapps.com',
        icons: ['https://swap.verixiaapps.com/icon-512.png'],
      },
    },
  }),
];

function onWalletError(err, adapter) {
  console.warn('[Nexus DEX] Solana wallet error:', adapter && adapter.name, err && err.message);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[Nexus DEX] #root element not found');
} else {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
        <WalletProvider wallets={solanaWallets} autoConnect={true} onError={onWalletError}>
          <WalletContextProvider>
            <App />
          </WalletContextProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
