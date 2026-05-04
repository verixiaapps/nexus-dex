/**
* NEXUS DEX -- App entry
*
* Sets up:
*   - Wagmi (EVM wallets) -- INJECTED ONLY. No WalletConnect, no QR codes.
*   - Solana wallet adapter (Phantom, Solflare) -- also injected only
*   - WalletContext (unified wallet state across the app)
*   - React Query
*   - BrowserRouter (in App.js)
*
* Connection model -- strict no-QR:
*   Desktop: user must have a browser extension wallet (MetaMask, Phantom,
*            Rabby, Coinbase Wallet extension, etc.) -- detected via EIP-6963.
*   Mobile:  user must open the site in their wallet app's in-app browser
*            (Phantom, MetaMask, Trust, Coinbase, etc.) -- also injection-based.
*            If they're in regular Safari/Chrome, App.js shows deep-link buttons
*            that bounce them into the wallet's in-app browser pointed at us.
*   No WalletConnect QR pairing exists in this build.
*
* Why no Web3Modal / WalletConnect / Coinbase SDK:
*   Web3Modal, WalletConnect, and the Coinbase Wallet SDK can each render
*   a QR for desktop->mobile pairing. Removing the connectors entirely is
*   the only way to make sure no QR can ever appear, even if a future call
*   to `useWeb3Modal().open()` slips into the codebase. Wagmi's
*   `createConfig` with just the `injected` connector covers every wallet
*   that exposes `window.ethereum`-style injection, including Phantom EVM,
*   MetaMask, Rabby, Trust (in its browser), Coinbase Wallet extension,
*   OKX, Bitget, Brave, etc.
*
* Fixes vs old version:
*   - PROJECT_ID and Web3Modal removed entirely
*   - WalletConnect connector removed (no QR risk)
*   - Coinbase Wallet SDK connector NOT added (it can show QR too)
*   - Plain wagmi createConfig with injected() -- EIP-6963 multi-wallet discovery
*   - Monad removed (RPC was testnet, not mainnet)
*   - autoConnect on Solana wallet provider disabled to eliminate
*     race with manual connect (was a major source of "connects inconsistently")
*   - Wallet adapter onError prop added so failures surface to console
*   - Single ConnectionProvider for Solana that can be redirected to a
*     proxy endpoint (future) instead of public RPC
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import {
 mainnet, polygon, polygonZkEvm, arbitrum, base, bsc, avalanche, optimism,
 gnosis, linea, scroll, mantle, blast, mode, fantom, moonbeam,
 celo, aurora, metis, zora, fraxtal, kroma, taiko, cronos, klaytn, sei, ronin,
 zksync,
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
* SOLANA RPC -- config + warning when falling back to public endpoint
* ========================================================================= */

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
 || (process.env.REACT_APP_HELIUS_API_KEY
   ? 'https://mainnet.helius-rpc.com/?api-key=' + process.env.REACT_APP_HELIUS_API_KEY
   : 'https://api.mainnet-beta.solana.com');

if (!process.env.REACT_APP_SOLANA_RPC && !process.env.REACT_APP_HELIUS_API_KEY) {
 // eslint-disable-next-line no-console
 console.warn(
   '[Nexus DEX] No Solana RPC configured. Falling back to public mainnet-beta, ' +
   'which is heavily rate-limited and will fail under normal use. ' +
   'Set REACT_APP_HELIUS_API_KEY (recommended) or REACT_APP_SOLANA_RPC on Railway.'
 );
}

/* ============================================================================
* CUSTOM CHAINS -- chains not yet in viem/wagmi presets
*
* Removed since last review:
*   - monad: RPC was testnet, presented as mainnet (misleading)
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
* Order matters because the FIRST chain in this array is wagmi's "default"
* chain when the wallet has no preference. Mainnet first.
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
 zksync,            // 324
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
].filter(Boolean);  // Drop any undefined entries (e.g., if viem renames a chain)

/* ============================================================================
* WAGMI CONFIG -- INJECTED ONLY
*
* `injected({ shimDisconnect: true })` enables EIP-6963 multi-wallet
* discovery: every browser wallet that announces itself via the
* eip6963:announceProvider event becomes a separate connector entry that
* App.js can render as its own button (Phantom, MetaMask, Rabby, Coinbase
* Wallet ext, OKX, Bitget, Brave, Trust ext, etc.). If only one wallet is
* installed and EIP-6963 isn't available, the legacy `window.ethereum`
* fallback still works.
*
* `shimDisconnect: true` makes wagmi remember a manual disconnect across
* page reloads. Without it, refreshing while connected re-connects
* automatically, which is the WC4 pattern we want to avoid (silent
* reconnect -> user thinks they've disconnected but signs the next tx).
*
* No WalletConnect connector. No Coinbase SDK connector. No QR codes
* possible from this config.
* ========================================================================= */

const transports = chains.reduce((acc, c) => {
 // Use viem's default `http()` transport; viem will use chain.rpcUrls.default.http[0]
 acc[c.id] = http();
 return acc;
}, {});

const wagmiConfig = createConfig({
 chains,
 connectors: [
   injected({ shimDisconnect: true }),
 ],
 transports,
 ssr: false,
});

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
