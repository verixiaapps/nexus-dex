/**
 * NEXUS DEX -- App entry
 *   
 * Provider order (locked, top to bottom):
 *   PrivyProvider                 -- embedded wallet + email/social/passkey login
 *     WagmiProvider               -- EVM external wallets (WalletConnect)
 *       QueryClientProvider       -- TanStack Query
 *         ConnectionProvider      -- Solana RPC
 *           WalletProvider        -- Solana external wallet adapters (Phantom, Solflare)
 *             WalletContextProvider -- our unified state across all of the above
 *               <App />
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import {
  mainnet, polygon, polygonZkEvm, arbitrum, base, bsc, avalanche, optimism,
  gnosis, linea, scroll, mantle, blast, mode, fantom, moonbeam,
  celo, aurora, metis, zora, fraxtal, kroma, taiko, cronos, klaytn, sei, ronin,
  zksync,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

const REOWN_PROJECT_ID =
  process.env.REACT_APP_REOWN_PROJECT_ID ||
  process.env.REACT_APP_WALLETCONNECT_PROJECT_ID ||
  '';

if (!REOWN_PROJECT_ID) {
  console.warn(
    '[Nexus DEX] REACT_APP_REOWN_PROJECT_ID not set.'
  );
}

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
  || (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

const PRIVY_APP_ID = process.env.REACT_APP_PRIVY_APP_ID || '';

/* CUSTOM CHAINS */
const unichain      = { id: 130,    name: 'Unichain',    nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.unichain.org'] } } };
const sonic         = { id: 146,    name: 'Sonic',       nativeCurrency: { name: 'Sonic',         symbol: 'S',    decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.soniclabs.com'] } } };
const berachain     = { id: 80094,  name: 'Berachain',   nativeCurrency: { name: 'BERA',          symbol: 'BERA', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.berachain.com'] } } };
const ink           = { id: 57073,  name: 'Ink',         nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-gel.inkonchain.com'] } } };
const worldchain    = { id: 480,    name: 'World Chain', nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } } };
const abstractChain = { id: 2741,   name: 'Abstract',    nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://api.mainnet.abs.xyz'] } } };
const apeChain      = { id: 33139,  name: 'ApeChain',    nativeCurrency: { name: 'ApeCoin',       symbol: 'APE',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.apechain.com/http'] } } };
const bob           = { id: 60808,  name: 'BOB',         nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.gobob.xyz'] } } };
const zircuit       = { id: 48900,  name: 'Zircuit',     nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://zircuit1-mainnet.p2pify.com'] } } };
const flowEvm       = { id: 747,    name: 'Flow',        nativeCurrency: { name: 'Flow',          symbol: 'FLOW', decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.evm.nodes.onflow.org'] } } };
const hemi          = { id: 43111,  name: 'Hemi',        nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.hemi.network/rpc'] } } };
const kava          = { id: 2222,   name: 'Kava',        nativeCurrency: { name: 'KAVA',          symbol: 'KAVA', decimals: 18 }, rpcUrls: { default: { http: ['https://evm.kava.io'] } } };
const boba          = { id: 288,    name: 'Boba',        nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.boba.network'] } } };
const lisk          = { id: 1135,   name: 'Lisk',        nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.api.lisk.com'] } } };
const fuse          = { id: 122,    name: 'Fuse',        nativeCurrency: { name: 'Fuse',          symbol: 'FUSE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.fuse.io'] } } };
const coreDao       = { id: 1116,   name: 'Core',        nativeCurrency: { name: 'Core',          symbol: 'CORE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.coredao.org'] } } };
const bitlayer      = { id: 200901, name: 'Bitlayer',    nativeCurrency: { name: 'Bitcoin',       symbol: 'BTC',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.bitlayer.org'] } } };
const kcc           = { id: 321,    name: 'KCC',         nativeCurrency: { name: 'KuCoin Token',  symbol: 'KCS',  decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-mainnet.kcc.network'] } } };
const shape         = { id: 360,    name: 'Shape',       nativeCurrency: { name: 'Ether',         symbol: 'ETH',  decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.shape.network'] } } };

const chains = [
  mainnet, base, arbitrum, optimism, polygon, bsc, avalanche,
  zksync, linea, scroll, mantle, blast, mode, polygonZkEvm, gnosis,
  fantom, cronos, moonbeam, celo, aurora, metis, klaytn, sei, ronin,
  zora, fraxtal, kroma, taiko,
  unichain, sonic, berachain, ink, worldchain, abstractChain, apeChain,
  bob, zircuit, flowEvm, hemi, kava, boba, lisk, fuse, coreDao,
  bitlayer, kcc, shape,
].filter(Boolean);

const SITE_NAME = 'Nexus DEX';
const SITE_URL  = 'https://swap.verixiaapps.com';
const SITE_ICON = SITE_URL + '/icon-512.png';

const transports = chains.reduce(function (acc, c) {
  acc[c.id] = http();
  return acc;
}, {});

const wagmiConnectors = REOWN_PROJECT_ID
  ? [
      walletConnect({
        projectId: REOWN_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: SITE_NAME,
          description: 'Best price across every chain. Single signature. No KYC.',
          url: SITE_URL,
          icons: [SITE_ICON],
          verifyUrl: SITE_URL,
        },
      }),
    ]
  : [];

const wagmiConfig = createConfig({
  chains,
  connectors: wagmiConnectors,
  transports,
  ssr: false,
});

const solanaWallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

function onWalletError(err, adapter) {
  console.warn('[Nexus DEX] Solana wallet error:', adapter && adapter.name, err && err.message);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

const privyConfig = {
  appearance: {
    theme: 'dark',
    accentColor: '#00e5ff',
    logo: SITE_URL + '/icon-512.png',
    showWalletLoginFirst: false,
    walletChainType: 'ethereum-and-solana',
    landingHeader: 'Sign in to Nexus DEX',
    loginMessage: 'Trade across every chain. No seed phrase needed.',
  },
  loginMethods: ['email', 'google', 'apple', 'twitter', 'discord', 'passkey', 'wallet'],
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
    solana: { createOnLogin: 'users-without-wallets' },
    requireUserPasswordOnCreate: false,
    showWalletUIs: true,
    priceDisplay: { primary: 'fiat-currency', secondary: 'native-token' },
  },
  externalWallets: { solana: { connectors: solanaConnectors } },
  solana: { rpcs: { 'mainnet-beta': SOLANA_RPC } },
  defaultChain: mainnet,
  supportedChains: chains,
  legal: {
    termsAndConditionsUrl: SITE_URL + '/terms',
    privacyPolicyUrl: SITE_URL + '/privacy',
  },
};

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[Nexus DEX] #root element not found in HTML');
} else {
  const root = ReactDOM.createRoot(rootEl);
  const tree = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
          <WalletProvider wallets={solanaWallets} autoConnect={true} onError={onWalletError}>
            <WalletContextProvider>
              <App />
            </WalletContextProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
  root.render(
    PRIVY_APP_ID ? (
      <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
        {tree}
      </PrivyProvider>
    ) : tree
  );
}