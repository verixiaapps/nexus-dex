import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import '@rainbow-me/rainbowkit/styles.css';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { mainnet, polygon, arbitrum, base, bsc, avalanche, optimism } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const endpoint = process.env.REACT_APP_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const solanaWallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

const wagmiConfig = getDefaultConfig({
  appName: 'Nexus DEX',
  projectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || '1a7c741caab0a2c5ffa2b199a816ea92',
  chains: [mainnet, polygon, arbitrum, base, bsc, avalanche, optimism],
  ssr: false,
});

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider>
        <ConnectionProvider endpoint={endpoint}>
          <WalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>
              <App />
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
