/**
 * NEXUS DEX -- App entry
 *
 * CHANGES vs prior version:
 *   • Privy now provisions BOTH Solana AND Ethereum embedded wallets.
 *     The Ethereum one (on Polygon) is what owns the user's Polymarket
 *     Safe wallet and signs CLOB orders silently in the Privy iframe.
 *   • walletChainType removed (was 'solana-only', which prevented EVM
 *     wallet creation entirely).
 *   • defaultChain set to polygon so EVM signing operations target the
 *     right chain by default.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';
import '@solana/wallet-adapter-react-ui/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { polygon } from 'viem/chains';
import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
  || (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

const POLYGON_RPC = process.env.REACT_APP_POLYGON_RPC || 'https://polygon-rpc.com';

const PRIVY_APP_ID = process.env.REACT_APP_PRIVY_APP_ID || '';

const solanaWallets = [
  new PhantomWalletAdapter(),
  new WalletConnectWalletAdapter({
    network: 'mainnet-beta',
    options: {
      projectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || '',
      metadata: {
        name: 'Nexus DEX',
        description: 'Solana DEX powered by OKX',
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

const SITE_URL  = 'https://swap.verixiaapps.com';
const SITE_ICON = SITE_URL + '/icon-512.png';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });

// ───────────────────────────────────────────────────────────────────
// Privy config — DUAL embedded wallet provisioning (Solana + Polygon)
// ───────────────────────────────────────────────────────────────────
const privyConfig = {
  appearance: {
    theme: 'dark',
    accentColor: '#00e5ff',
    logo: SITE_ICON,
    showWalletLoginFirst: false,
    landingHeader: 'Sign in to Nexus DEX',
    loginMessage: 'Trade prediction markets and swap on Solana. No seed phrase needed.',
  },
  loginMethods: ['email', 'google', 'passkey'],

  // Both wallet types created automatically on login. The Polygon (EVM)
  // wallet becomes the owner of the user's Polymarket Safe.
  embeddedWallets: {
    solana:   { createOnLogin: 'users-without-wallets' },
    ethereum: { createOnLogin: 'users-without-wallets' },
    requireUserPasswordOnCreate: false,
    showWalletUIs: true,
    priceDisplay: { primary: 'fiat-currency', secondary: 'native-token' },
  },

  // Default the EVM signing chain to Polygon so RelayClient + ClobClient
  // operations target the right chain without explicit overrides.
  defaultChain: polygon,
  supportedChains: [polygon],

  externalWallets: {
    solana: { connectors: solanaConnectors },
  },

  solana: { rpcs: { 'mainnet-beta': SOLANA_RPC } },
};

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[Nexus DEX] #root element not found');
} else {
  const root = ReactDOM.createRoot(rootEl);
  const tree = (
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
  root.render(
    PRIVY_APP_ID ? (
      <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
        {tree}
      </PrivyProvider>
    ) : tree
  );
}
 