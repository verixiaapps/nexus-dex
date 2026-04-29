import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BackpackWalletAdapter,
  BraveWalletAdapter,
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  TrustWalletAdapter,
  TorusWalletAdapter,
  MathWalletAdapter,
  TokenPocketWalletAdapter,
  BitKeepWalletAdapter,
  CloverWalletAdapter,
  Coin98WalletAdapter,
  SafePalWalletAdapter,
  SlopeWalletAdapter,
  SolongWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import { createWeb3Modal } from '@web3modal/wagmi/react';
import { defaultWagmiConfig } from '@web3modal/wagmi/react/config';
import { WagmiProvider } from 'wagmi';
import { mainnet, polygon, arbitrum, base, bsc, avalanche, optimism } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC ||
  'https://mainnet.helius-rpc.com/?api-key=45c791fa-d4fd-480e-aee3-7f998177b732';
const PROJECT_ID = '1a7c741caab0a2c5ffa2b199a816ea92';

const metadata = {
  name: 'Nexus DEX',
  description: 'Multi-chain DEX aggregator',
  url: 'https://swap.verixiaapps.com',
  icons: ['https://swap.verixiaapps.com/logo.png'],
};

const chains = [mainnet, polygon, arbitrum, base, bsc, avalanche, optimism];

const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId: PROJECT_ID,
  metadata,
  ssr: false,
});

createWeb3Modal({
  wagmiConfig,
  projectId: PROJECT_ID,
  chains,
  defaultChain: mainnet,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#00e5ff',
    '--w3m-border-radius-master': '12px',
    '--w3m-font-family': 'Syne, sans-serif',
    '--w3m-background-color': '#080d1a',
  },
});

const solanaWallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),
  new BraveWalletAdapter(),
  new CoinbaseWalletAdapter(),
  new LedgerWalletAdapter(),
  new TrustWalletAdapter(),
  new TorusWalletAdapter(),
  new MathWalletAdapter(),
  new TokenPocketWalletAdapter(),
  new BitKeepWalletAdapter(),
  new CloverWalletAdapter(),
  new Coin98WalletAdapter(),
  new SafePalWalletAdapter(),
  new SlopeWalletAdapter(),
  new SolongWalletAdapter(),
];

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={SOLANA_RPC}>
        <WalletProvider wallets={solanaWallets} autoConnect>
          <App />
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
