// scripts/build-wc.mjs
//
// Builds the wallet bundle consumed by the SEO landing pages. The compiled
// IIFE is written to public/verixia-wc.js and React's build step then copies
// it into build/verixia-wc.js, where it's served from
//   https://verixiaapps.com/nexus-dex/verixia-wc.js
//
// The bundle initializes Reown AppKit (Solana adapter) and exposes a small,
// stable API on window.VerixiaWallet that the SEO HTML uses:
//   open, close, disconnect, getAddress, isConnected,
//   getProvider, getProviderType, subscribe(cb)
//
// Runs automatically before `npm run build` via the prebuild script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const entry = path.join(root, '_wc-entry.mjs');
const outFile = path.join(root, 'public', 'verixia-wc.js');

// Bundle source. Kept as a string so we don't ship a permanent entry file
// that could be edited out of sync with this script. esbuild reads it from
// the temp file we write below.
const ENTRY_SOURCE = `
import { createAppKit } from '@reown/appkit';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { solana } from '@reown/appkit/networks';

const cfg = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const projectId = cfg.wcProjectId || '1a7c741caab0a2c5ffa2b199a816ea92';
const origin =
  (typeof window !== 'undefined' && window.location && window.location.origin) ||
  'https://verixiaapps.com';

const metadata = {
  name: 'Verixia',
  description: 'Bridge & swap on Solana via Jupiter',
  url: origin,
  icons: [
    origin + '/favicon.ico',
    origin + '/icon-192.png',
    origin + '/icon-512.png',
  ],
};

// SolanaAdapter() with no explicit wallets — modern Solana wallets register
// themselves through wallet-standard, which the adapter auto-detects. Wallets
// not installed locally appear via Reown's wallet registry over WalletConnect.
const solanaAdapter = new SolanaAdapter();

const modal = createAppKit({
  adapters: [solanaAdapter],
  networks: [solana],
  projectId,
  metadata,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#00b8d4',
    '--w3m-border-radius-master': '6px',
  },
  features: {
    analytics: true,
    email: false,
    socials: false,
  },
});

// --- API exposed on window.VerixiaWallet -----------------------------------
const subscribers = new Set();
function notify(state) {
  subscribers.forEach((cb) => {
    try { cb(state); } catch (e) { console.warn('[VerixiaWallet subscriber]', e); }
  });
}

modal.subscribeProvider((s) => {
  notify({
    isConnected: !!(s && s.isConnected),
    address: (s && s.address) || null,
    chainId: (s && s.chainId) || null,
    providerType: (s && s.providerType) || null,
    walletName:
      s && s.providerType === 'WALLET_CONNECT'
        ? 'WalletConnect'
        : (s && s.providerType) || null,
  });
});

window.VerixiaWallet = {
  open() { return modal.open(); },
  close() { return modal.close(); },
  disconnect() { return modal.disconnect(); },
  getAddress() {
    try { return modal.getAddress() || null; } catch { return null; }
  },
  isConnected() {
    try { return !!modal.getAddress(); } catch { return false; }
  },
  getProvider() {
    try { return modal.getWalletProvider() || null; } catch { return null; }
  },
  getProviderType() {
    try { return (modal.getWalletProviderType && modal.getWalletProviderType()) || null; }
    catch { return null; }
  },
  subscribe(cb) {
    if (typeof cb !== 'function') return () => {};
    subscribers.add(cb);
    // Fire once with current state so callers sync immediately.
    try {
      cb({
        isConnected: this.isConnected(),
        address: this.getAddress(),
        chainId: null,
        providerType: this.getProviderType(),
        walletName: this.getProviderType(),
      });
    } catch (e) {}
    return () => subscribers.delete(cb);
  },
  _modal: modal,
};

// Signal to the page that the bundle is loaded and the API is ready.
try { window.dispatchEvent(new Event('verixia-wallet-ready')); } catch (e) {}
`;

fs.writeFileSync(entry, ENTRY_SOURCE);

try {
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile: outFile,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': '"production"',
      global: 'globalThis',
    },
    logLevel: 'info',
  });
  const size = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`[verixia-wc] built ${outFile} (${size} KB)`);
} finally {
  // Clean up the temp entry so it doesn't pollute the repo.
  if (fs.existsSync(entry)) fs.unlinkSync(entry);
}
