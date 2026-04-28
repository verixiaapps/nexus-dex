import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { getWallets } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import '@rainbow-me/rainbowkit/styles.css';
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { mainnet, polygon, arbitrum, base, bsc, avalanche, optimism } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const solanaWallets = getWallets();

const wagmiConfig = getDefaultConfig({
  appName: 'Nexus DEX',
  projectId: '1a7c741caab0a2c5ffa2b199a816ea92',
  chains: [mainnet, polygon, arbitrum, base, bsc, avalanche, optimism],
  ssr: false,
});

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider
        theme={darkTheme({
          accentColor: '#00e5ff',
          accentColorForeground: '#03060f',
          borderRadius: 'large',
          fontStack: 'system',
          overlayBlur: 'small',
        })}
        modalSize="compact"
      >
        <ConnectionProvider endpoint={SOLANA_RPC}>
          <WalletProvider wallets={solanaWallets} autoConnect>
            <App />
          </WalletProvider>
        </ConnectionProvider>
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
