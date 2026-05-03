/**
* NEXUS DEX -- App entry
*
* Sets up:
*  - Wagmi (EVM wallets)
*  - Web3Modal (WalletConnect QR + injected EVM wallets)
*  - Solana wallet adapter (Phantom, Solflare)
*  - WalletContext (unified wallet state across the app)
*  - React Query
*  - BrowserRouter (in App.js)
*
* Fixes vs old version:
*  - PROJECT_ID validated at boot -- fail loud if missing
*  - Monad removed (RPC was testnet, not mainnet)
*  - Broken `nexusdex://` redirect scheme removed
*  - autoConnect on Solana wallet provider disabled to eliminate
*    race with manual connect (was a major source of "connects inconsistently")
*  - Wallet adapter onError prop added so failures surface to console
*  - Single ConnectionProvider for Solana that can be redirected to a
*    proxy endpoint (future) instead of public RPC
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
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
 zkSync,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

/* ============================================================================
* Buffer polyfill for browser (some web3 libs expect it on `window`)
* ========================================================================= */
if (typeof window !== 'undefined' && !window.Buffer) {
 window.Buffer = Buffer;
}

/* ============================================================================
* ENV VAR VALIDATION -- fail loud, not silently
* ========================================================================= */

const PROJECT_ID = process.env.REACT_APP_WC_PROJECT_ID || '';
const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
 || (process.env.REACT_APP_HELIUS_API_KEY
   ? 'https://mainnet.helius-rpc.com/?api-key=' + process.env.REACT_APP_HELIUS_API_KEY
   : 'https://api.mainnet-beta.solana.com');
const SITE_URL = 'https://swap.verixiaapps.com';

if (!PROJECT_ID) {
 // Don't throw -- let the app render an error state instead of a blank page
 // eslint-disable-next-line no-console
 console.error(
   '[Nexus DEX] Missing REACT_APP_WC_PROJECT_ID environment variable. ' +
   'WalletConnect will not work until this is set on Railway. ' +
   'Get a free Project ID at https://cloud.reown.com'
 );
}

/* ============================================================================
* CUSTOM CHAINS -- chains not yet in viem/wagmi presets
*
* Removed since last review:
*  - monad: RPC was testnet, presented as mainnet (misleading)
*
* Each chain object follows wagmi's Chain shape:
*   { id, name, nativeCurrency, rpcUrls: { default: { http: [...] } } }
* ========================================================================= */

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

/* ============================================================================
* CHAIN LIST -- all chains the app supports for EVM wallet connections
*
* Order matters for Web3Modal's chain switcher (mainnet first, then L2s by usage)
* ========================================================================= */

const chains = [
 // Tier 1 -- major chains by TVL
 mainnet,           // 1
 base,              // 8453
 arbitrum,          // 42161
 optimism,          // 10
 polygon,           // 137
 bsc,               // 56
 avalanche,         // 43114

 // Tier 2 -- established L2s and alt-L1s
 zkSync,            // 324
 linea,             // 59144
 scroll,            // 534352
 mantle,            // 5000
 blast,             // 81457
 mode,              // 34443
 polygonZkEvm,      // 1101
 gnosis,            // 100
 fantom,            // 250
 cronos,            // 25
 moonbeam,          // 1284
 celo,              // 42220
 aurora,            // 1313161554
 metis,             // 1088
 klaytn,            // 8217
 sei,               // 1329
 ronin,             // 2020
 zora,              // 7777777
 fraxtal,           // 252
 kroma,             // 255
 taiko,             // 167000

 // Tier 3 -- emerging chains
 unichain, sonic, berachain, ink, worldchain, abstractChain, apeChain,
 bob, zircuit, flowEvm, hemi, kava, boba, lisk, fuse, coreDao,
 bitlayer, kcc, shape,
];

/* ============================================================================
* WALLET CONNECT METADATA
*
* Removed `redirect.native: 'nexusdex://'` -- that scheme isn't registered
* anywhere, so wallet apps had no idea where to send users back. Without it,
* modern wallet apps use their own return mechanism, which works.
* ========================================================================= */

const metadata = {
 name:        'Nexus DEX',
 description: 'Multi-chain DEX aggregator. Single signature. No KYC.',
 url:         SITE_URL,
 icons:       [SITE_URL + '/logo.png'],
 // No `redirect` block -- let the wallet handle return URLs natively.
};

/* ============================================================================
* WAGMI + WEB3MODAL CONFIG
* ========================================================================= */

const wagmiConfig = defaultWagmiConfig({
 chains,
 projectId: PROJECT_ID,
 metadata,
 ssr: false,
});

if (PROJECT_ID) {
 // Only init Web3Modal when we have a valid Project ID.
 // Initializing without one was the source of "WalletConnect QR scan does
 // nothing" reports -- the modal would render but throw silently inside.
 createWeb3Modal({
   wagmiConfig,
   projectId: PROJECT_ID,
   chains,
   defaultChain: mainnet,
   themeMode: 'dark',
   themeVariables: {
     '--w3m-accent':               '#00e5ff',
     '--w3m-border-radius-master': '12px',
     '--w3m-font-family':          'Syne, sans-serif',
     '--w3m-background-color':     '#080d1a',
   },
   metadata,
 });
}

/* ============================================================================
* SOLANA WALLET ADAPTERS
*
* autoConnect is INTENTIONALLY off. The old auto-connect raced with manual
* connect attempts when users reloaded mid-session, leaving stale state that
* looked like "connects inconsistently." Manual connect only.
* ========================================================================= */

const solanaWallets = [
 new PhantomWalletAdapter(),
 new SolflareWalletAdapter(),
];

function onWalletError(err, adapter) {
 // Surface adapter errors to the console so we can debug "silent" connection
 // failures. The modal already shows error state via WalletContext.
 // eslint-disable-next-line no-console
 console.warn('[Nexus DEX] Solana wallet error:', adapter && adapter.name, err && err.message);
}

/* ============================================================================
* REACT QUERY
* ========================================================================= */

const queryClient = new QueryClient({
 defaultOptions: {
   queries: {
     staleTime: 30_000,        // 30s -- most data refreshes via interval anyway
     retry: 1,                 // one retry, then surface the error
     refetchOnWindowFocus: false,
   },
 },
});

/* ============================================================================
* MOUNT
* ========================================================================= */

const rootEl = document.getElementById('root');
if (!rootEl) {
 // eslint-disable-next-line no-console
 console.error('[Nexus DEX] #root element not found in HTML');
} else {
 const root = ReactDOM.createRoot(rootEl);
 root.render(
   <WagmiProvider config={wagmiConfig}>
     <QueryClientProvider client={queryClient}>
       <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
         <WalletProvider wallets={solanaWallets} autoConnect={false} onError={onWalletError}>
           <WalletContextProvider>
             <App />
           </WalletContextProvider>
         </WalletProvider>
       </ConnectionProvider>
     </QueryClientProvider>
   </WagmiProvider>
 );
}
