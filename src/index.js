import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import { createWeb3Modal } from '@web3modal/wagmi/react';
import { defaultWagmiConfig } from '@web3modal/wagmi/react/config';
import { WagmiProvider } from 'wagmi';
import {
  mainnet, polygon, polygonZkEvm, arbitrum, base, bsc, avalanche, optimism,
  gnosis, linea, scroll, mantle, blast, mode, fantom, moonbeam,
  celo, aurora, metis, zora, fraxtal, kroma, taiko, cronos, klaytn, sei, ronin,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

// zkSync imported separately with correct casing -- wagmi exports it as
// zkSync (capital S). Importing it alone avoids a silent undefined if the
// casing mismatches in the installed wagmi version.
import { zkSync } from 'wagmi/chains';

// Custom chain definitions for chains not guaranteed in all wagmi 2.x versions
const unichain      = { id: 130,    name: 'Unichain',     nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } } };
const sonic         = { id: 146,    name: 'Sonic',        nativeCurrency: { name: 'Sonic',        symbol: 'S',    decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.soniclabs.com'] } } };
const berachain     = { id: 80094,  name: 'Berachain',    nativeCurrency: { name: 'BERA',         symbol: 'BERA', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.berachain.com'] } } };
const ink           = { id: 57073,  name: 'Ink',          nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-gel.inkonchain.com'] } } };
const monad         = { id: 10143,  name: 'Monad',        nativeCurrency: { name: 'MON',          symbol: 'MON',  decimals: 18 }, rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } } };
const worldchain    = { id: 480,    name: 'World Chain',  nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } } };
const abstractChain = { id: 2741,   name: 'Abstract',     nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://api.mainnet.abs.xyz'] } } };
const apeChain      = { id: 33139,  name: 'ApeChain',     nativeCurrency: { name: 'ApeCoin',      symbol: 'APE',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.apechain.com/http'] } } };
const bob           = { id: 60808,  name: 'BOB',          nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.gobob.xyz'] } } };
const zircuit       = { id: 48900,  name: 'Zircuit',      nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://zircuit1-mainnet.p2pify.com'] } } };
const flowEvm       = { id: 747,    name: 'Flow',         nativeCurrency: { name: 'Flow',         symbol: 'FLOW', decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.evm.nodes.onflow.org'] } } };
const hemi          = { id: 43111,  name: 'Hemi',         nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.hemi.network/rpc'] } } };
const kava          = { id: 2222,   name: 'Kava',         nativeCurrency: { name: 'KAVA',         symbol: 'KAVA', decimals: 18 }, rpcUrls: { default: { http: ['https://evm.kava.io'] } } };
const boba          = { id: 288,    name: 'Boba',         nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.boba.network'] } } };
const lisk          = { id: 1135,   name: 'Lisk',         nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.api.lisk.com'] } } };
const fuse          = { id: 122,    name: 'Fuse',         nativeCurrency: { name: 'Fuse',         symbol: 'FUSE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.fuse.io'] } } };
const coreDao       = { id: 1116,   name: 'Core',         nativeCurrency: { name: 'Core',         symbol: 'CORE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.coredao.org'] } } };
const bitlayer      = { id: 200901, name: 'Bitlayer',     nativeCurrency: { name: 'Bitcoin',      symbol: 'BTC',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.bitlayer.org'] } } };
const megaEth       = { id: 6342,   name: 'MegaETH',      nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://carrot.megaeth.com/rpc'] } } };
const kcc           = { id: 321,    name: 'KCC',          nativeCurrency: { name: 'KuCoin Token', symbol: 'KCS',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-mainnet.kcc.network'] } } };
const shape         = { id: 360,    name: 'Shape',        nativeCurrency: { name: 'Ether',        symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.shape.network'] } } };

// FIX: Use public RPC as fallback -- never hardcode API keys in source code
// as they end up visible in the production JS bundle
const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PROJECT_ID = '1a7c741caab0a2c5ffa2b199a816ea92';

const metadata = {
  name: 'Nexus DEX',
  description: 'Multi-chain DEX aggregator',
  url: 'https://swap.verixiaapps.com',
  icons: ['https://swap.verixiaapps.com/logo.png'],
};

const chains = [
  // Core EVM (wagmi/chains)
  mainnet, polygon, polygonZkEvm, arbitrum, base, bsc, avalanche, optimism,
  gnosis, zkSync, linea, scroll, mantle, blast, mode,
  fantom, moonbeam, celo, aurora, metis, zora, fraxtal, kroma, taiko,
  cronos, klaytn, sei, ronin,
  // Custom definitions
  unichain, sonic, berachain, ink, monad, worldchain, abstractChain, apeChain,
  bob, zircuit, flowEvm, hemi, kava, boba, lisk, fuse, coreDao,
  bitlayer, megaEth, kcc, shape,
];

const wagmiConfig = defaultWagmiConfig({ chains, projectId: PROJECT_ID, metadata, ssr: false });

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
  metadata: {
    name: 'Nexus DEX',
    description: 'Multi-chain DEX aggregator',
    url: 'https://swap.verixiaapps.com',
    icons: ['https://swap.verixiaapps.com/logo.png'],
    redirect: { native: 'nexusdex://', universal: 'https://swap.verixiaapps.com' },
  },
});

const solanaWallets = [
  new PhantomWalletAdapter({ appIdentity: { uri: 'https://swap.verixiaapps.com' } }),
  new SolflareWalletAdapter(),
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
