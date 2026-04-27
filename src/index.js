import React from 'react';
import ReactDOM from 'react-dom/client';
import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount } from 'wagmi';
import {
  mainnet,
  polygon,
  arbitrum,
  base,
  bsc,
  avalanche,
  optimism,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
 
const config = getDefaultConfig({
  appName: 'Nexus DEX',
  projectId: '1a7c741caab0a2c5ffa2b199a816ea92',
  chains: [mainnet, polygon, arbitrum, base, bsc, avalanche, optimism],
  ssr: false,
});

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <WagmiProvider config={config}>
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
        showRecentTransactions={true}
      >
        <App />
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
