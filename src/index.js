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
 *
 * Why Privy outermost: Privy's hooks (usePrivy, useSolanaWallets, etc.) must
 * be available everywhere, including inside WalletContextProvider where we
 * combine Privy's embedded wallet state with the external-adapter state.
 *
 * Wallet options surfaced in the connect modal (locked spec):
 *   1. Phantom        -- Solana, via @solana/wallet-adapter-phantom
 *   2. Solflare       -- Solana, via @solana/wallet-adapter-solflare
 *   3. WalletConnect  -- everything EVM (MetaMask, Trust, Rainbow, Coinbase,
 *                        OKX, Rabby, Bitget, 600+ wallets) via wagmi
 *   4. Email / Social -- Privy embedded wallet (Solana + EVM auto-created
 *                        for users without external wallets). Login with
 *                        email, Google, Apple, Twitter/X, Discord, or
 *                        passkey. No seed phrase to manage. One-tap signing.
 *
 * Privy embedded wallets are non-custodial. Keys are sharded across the
 * user's device (in a TEE / secure enclave) and Privy's infra. Neither
 * Privy nor we can access the user's keys.
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

/* ============================================================================
 * Buffer polyfill for browser
 * ========================================================================= */
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

/* ============================================================================
 * ENV: REOWN / WALLETCONNECT, SOLANA RPC, PRIVY APP ID
 * ========================================================================= */

const REOWN_PROJECT_ID =
  process.env.REACT_APP_REOWN_PROJECT_ID ||
  process.env.REACT_APP_WALLETCONNECT_PROJECT_ID ||
  '';

if (!REOWN_PROJECT_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Nexus DEX] REACT_APP_REOWN_PROJECT_ID not set. WalletConnect button ' +
    'will be disabled. Get a free project ID at https://cloud.reown.com.'
  );
}

const SOLANA_RPC = process.env.REACT_APP_SOLANA_RPC
  || (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

if (!process.env.REACT_APP_SOLANA_RPC && !process.env.REACT_APP_HELIUS_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Nexus DEX] No Solana RPC configured. Falling back to public mainnet-beta, ' +
    'which is heavily rate-limited. Set REACT_APP_HELIUS_API_KEY on Railway.'
  );
}

const PRIVY_APP_ID = process.env.REACT_APP_PRIVY_APP_ID || '';

if (!PRIVY_APP_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Nexus DEX] REACT_APP_PRIVY_APP_ID not set. The "Continue with email" ' +
    'button will be disabled until you create an app at https://dashboard.privy.io ' +
    'and add the App ID to Railway env.'
  );
}

/* ============================================================================
 * CUSTOM CHAINS
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
 * CHAIN LIST
 * ========================================================================= */

const chains = [
  mainnet, base, arbitrum, optimism, polygon, bsc, avalanche,
  zksync, linea, scroll, mantle, blast, mode, polygonZkEvm, gnosis,
  fantom, cronos, moonbeam, celo, aurora, metis, klaytn, sei, ronin,
  zora, fraxtal, kroma, taiko,
  unichain, sonic, berachain, ink, worldchain, abstractChain, apeChain,
  bob, zircuit, flowEvm, hemi, kava, boba, lisk, fuse, coreDao,
  bitlayer, kcc, shape,
].filter(Boolean);

/* ============================================================================
 * WAGMI CONFIG -- WalletConnect for external EVM wallets
 * ========================================================================= */

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
        // Explicit relay URL -- prevents Safari from receiving malformed
        // wc:// deeplinks when our origin is hit before the relay handshake
        // completes. Default works in Chrome but iOS Safari sometimes
        // intercepts the universal link before the QR/redirect modal
        // finishes (the "address invalid" error from pic 2).
        relayUrl: 'wss://relay.walletconnect.com',
        metadata: {
          name: SITE_NAME,
          description: 'Best price across every chain. Single signature. No KYC.',
          url: SITE_URL,
          icons: [SITE_ICON],
          // verifyUrl explicitly set so WalletConnect's verify API uses our
          // origin for the "Verified" badge and Safari's universal-link
          // resolver gets a stable target.
          verifyUrl: SITE_URL,
        },
        qrModalOptions: {
          themeMode: 'dark',
          themeVariables: {
            '--wcm-z-index': '999',
            '--wcm-accent-color': '#00e5ff',
          },
          // Disable WalletConnect's "Open in Wallet" deep-link button on
          // Safari -- it's the source of the "address invalid" error
          // when the wallet's universal link isn't installed. Users can
          // still scan the QR or paste the URI manually.
          enableExplorer: true,
          explorerRecommendedWalletIds: 'NONE',
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

/* ============================================================================
 * SOLANA WALLET ADAPTERS -- external wallets only (Phantom + Solflare).
 * Privy's embedded Solana wallet is handled separately via Privy's hooks.
 * ========================================================================= */

const solanaWallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

function onWalletError(err, adapter) {
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
 * PRIVY CONFIG
 *
 * Login methods enabled (chosen for max conversion across DeFi user types):
 *   - email      -- universal, works for everyone
 *   - google     -- 1-tap on Android / Chrome
 *   - apple      -- 1-tap on iOS / Safari, required for App Store apps
 *   - twitter    -- crypto-native social login
 *   - discord    -- crypto-native social login
 *   - passkey    -- modern biometric, no password to remember
 *   - wallet     -- power users connect their existing wallet to Privy too
 *
 * Embedded wallets:
 *   - Auto-create for users without an external wallet on login (zero-friction)
 *   - Cross-chain: BOTH Solana AND EVM created in the same flow
 *   - No password required at create time (passkey / device key handles it)
 *
 * walletChainType: 'ethereum-and-solana' -- shows both chain types in
 * Privy's connect modal when users choose to link an external wallet.
 *
 * Solana cluster routed through our Helius RPC (or fallback) so embedded
 * wallet RPC calls share the same endpoint as the rest of the app.
 *
 * Theme matches Nexus DEX dark UI; accent color matches our cyan brand.
 * ========================================================================= */

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false, // we manage Solana autoConnect via the wallet-adapter
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
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
    solana: {
      createOnLogin: 'users-without-wallets',
    },
    requireUserPasswordOnCreate: false,
    showWalletUIs: true, // show Privy's tx confirmation UI; we'll bypass for instant trades later
    priceDisplay: {
      primary: 'fiat-currency',
      secondary: 'native-token',
    },
  },
  externalWallets: {
    solana: { connectors: solanaConnectors },
  },
  solana: {
    rpcs: {
      'mainnet-beta': SOLANA_RPC,
    },
  },
  defaultChain: mainnet,
  supportedChains: chains,
  legal: {
    termsAndConditionsUrl: SITE_URL + '/terms',
    privacyPolicyUrl: SITE_URL + '/privacy',
  },
};

/* ============================================================================
 * MOUNT
 *
 * If PRIVY_APP_ID is missing we still render the app so existing
 * Phantom/Solflare/WalletConnect flows keep working. Privy's "Continue
 * with email" button in WalletModal handles the missing-config case
 * gracefully (button shows "Unavailable -- check setup").
 * ========================================================================= */

const rootEl = document.getElementById('root');
if (!rootEl) {
  // eslint-disable-next-line no-console
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
    ) : (
      tree
    )
  );
}
