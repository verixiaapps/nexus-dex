/**
* NEXUS DEX -- App entry
*
* Sets up:
*   - Wagmi (EVM wallets) via WalletConnect connector
*   - Solana wallet adapter (Phantom, Solflare)
*   - WalletContext (unified wallet state across the app)
*   - React Query
*   - BrowserRouter (in App.js)
*
* Three-button connection model (locked spec):
*   1. Phantom        -- Solana, via @solana/wallet-adapter-phantom.
*                        Adapter handles desktop extension AND mobile
*                        universal-link automatically.
*   2. Solflare       -- Solana, via @solana/wallet-adapter-solflare.
*                        Same dual handling.
*   3. WalletConnect  -- everything else (MetaMask, Trust, Rainbow,
*                        Coinbase, OKX, Rabby, Bitget, 600+ wallets) via
*                        wagmi's `walletConnect` connector. Desktop -> QR
*                        modal in-page (user stays on our site). Mobile ->
*                        deep-links into the chosen wallet, returns to us
*                        automatically after approval.
*
* autoConnect for Solana is ENABLED. Combined with the resilience layer
* in WalletContext (visibility / online listeners + heartbeat +
* userExplicitlyDisconnected guard), this is what keeps users connected
* across reloads, tab backgrounding, and network blips. The previous
* "race with manual connect" complaint is fixed by the WalletContext
* state machine, not by disabling autoConnect.
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

import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

/* ============================================================================
* Buffer polyfill for browser (some web3 libs expect it on `window`)
* ========================================================================= */
if (typeof window !== 'undefined' && !window.Buffer) {
 window.Buffer = Buffer;
}

/* ============================================================================
* REOWN / WALLETCONNECT PROJECT ID
*
* Required for the WalletConnect button in the modal. Get one (free) at
* https://cloud.reown.com -- takes 30 seconds. Paste into Railway env as
* REACT_APP_REOWN_PROJECT_ID and redeploy.
*
* If unset, wagmi still loads but the WalletConnect connector self-reports
* as unavailable; the modal then displays a clear "WalletConnect not
* configured" message instead of failing silently when tapped.
* ========================================================================= */

const REOWN_PROJECT_ID =
 process.env.REACT_APP_REOWN_PROJECT_ID ||
 process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || // legacy alias
 '';

if (!REOWN_PROJECT_ID) {
 // eslint-disable-next-line no-console
 console.warn(
   '[Nexus DEX] REACT_APP_REOWN_PROJECT_ID not set. WalletConnect button ' +
   'will be disabled until a project ID is configured. Get one (free) at ' +
   'https://cloud.reown.com and add it on Railway.'
 );
}

/* ============================================================================
* SOLANA RPC -- config + warning when falling back to public endpoint
* ========================================================================= */

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
 || (process.env.REACT_APP_HELIUS_API_KEY
   ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
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
* CHAIN LIST -- mainnet first; FIRST chain is wagmi's default.
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
].filter(Boolean);

/* ============================================================================
* WAGMI CONFIG -- WalletConnect only on the EVM side.
*
* The wagmi `walletConnect` connector handles every supported wallet:
*   - Desktop: opens an in-page QR modal. User scans with their mobile
*     wallet. Desktop site stays put -- transactions on our site, only
*     the signing prompt is in their wallet.
*   - Mobile: deep-links into the chosen wallet via universal link, then
*     returns to us automatically once they approve. Metadata below
*     ensures the return URL is correctly set.
*
* showQrModal=true is the default; we set it explicitly so future wagmi
* upgrades don't silently change behavior.
* ========================================================================= */

const SITE_NAME = 'Nexus DEX';
const SITE_URL  = 'https://swap.verixiaapps.com';
const SITE_ICON = SITE_URL + '/icon-512.png';

const transports = chains.reduce(function (acc, c) {
 acc[c.id] = http(); // viem uses chain.rpcUrls.default.http[0] by default
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
       },
     }),
   ]
 : [];
// If projectId is missing, the connectors array stays empty -- wagmi still
// initializes, the WalletConnect button in the modal detects the missing
// connector and shows "Unavailable -- check setup" instead of crashing.

const wagmiConfig = createConfig({
 chains,
 connectors: wagmiConnectors,
 transports,
 ssr: false,
});

/* ============================================================================
* SOLANA WALLET ADAPTERS
*
* autoConnect is ON. The previous "race with manual connect" complaint is
* solved by the WalletContext state machine + targetWalletRef pattern, not
* by disabling auto-reconnect. Without autoConnect users would have to
* reconnect on every page reload, which violates the "keep them connected
* at all times" rule.
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
     staleTime: 30_000,
     retry: 1,
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
         <WalletProvider wallets={solanaWallets} autoConnect={true} onError={onWalletError}>
           <WalletContextProvider>
             <App />
           </WalletContextProvider>
         </WalletProvider>
       </ConnectionProvider>
     </QueryClientProvider>
   </WagmiProvider>
 );
}
