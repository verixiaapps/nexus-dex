// build-wc.mjs
//
// Builds the wallet bundle. Output: verixia-wc.js at the repo root, which
// server.js serves at https://verixiaapps.com/nexus-dex/verixia-wc.js
//
// Run by .github/workflows/build-bundle.yml on manual trigger.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '_wc-entry.mjs');
const outFile = path.join(__dirname, 'verixia-wc.js');

const ENTRY_SOURCE = `
import { createAppKit } from '@reown/appkit';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { solana } from '@reown/appkit/networks';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';

try {
  const cfg = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
  const projectId = cfg.wcProjectId || '1a7c741caab0a2c5ffa2b199a816ea92';
  const origin =
    (typeof window !== 'undefined' && window.location && window.location.origin) ||
    'https://verixiaapps.com';

  const metadata = {
    name: 'Verixia',
    description: 'Bridge & swap on Solana via Jupiter',
    url: origin,
    icons: [origin + '/favicon.ico'],
  };

  const solanaAdapter = new SolanaAdapter({
    wallets: [new PhantomWalletAdapter()],
  });

  const modal = createAppKit({
    adapters: [solanaAdapter],
    networks: [solana],
    projectId,
    metadata,
    themeMode: 'dark',
    themeVariables: { '--w3m-accent': '#00b8d4' },
    features: { analytics: true, email: false, socials: false },
  });

  const subscribers = new Set();
  function notify(state) {
    subscribers.forEach((cb) => {
      try { cb(state); } catch (e) {}
    });
  }

  function readProviderType() {
    try {
      return (modal.getWalletProviderType && modal.getWalletProviderType()) || null;
    } catch (e) { return null; }
  }

  function readAddress() {
    try { return (modal.getAddress && modal.getAddress()) || null; }
    catch (e) { return null; }
  }

  // Feature-detect subscription method. AppKit 1.8.x with Solana adapter
  // exposes subscribeAccount; subscribeProvider exists only on some adapters.
  if (typeof modal.subscribeAccount === 'function') {
    modal.subscribeAccount((s) => {
      const addr = (s && s.address) || null;
      const ptype = readProviderType();
      notify({
        isConnected: !!(s && s.isConnected) || !!addr,
        address: addr,
        providerType: ptype,
        walletName: ptype,
      });
    });
  } else if (typeof modal.subscribeProvider === 'function') {
    modal.subscribeProvider((s) => {
      notify({
        isConnected: !!(s && s.isConnected),
        address: (s && s.address) || null,
        providerType: (s && s.providerType) || null,
        walletName: (s && s.providerType) || null,
      });
    });
  } else {
    console.warn('[verixia-wc] no subscribe method found on modal');
  }

  window.VerixiaWallet = {
    open() { return modal.open(); },
    close() { return modal.close(); },
    disconnect() { return modal.disconnect(); },
    getAddress() { return readAddress(); },
    isConnected() { return !!readAddress(); },
    getProvider() {
      try { return (modal.getWalletProvider && modal.getWalletProvider()) || null; }
      catch (e) { return null; }
    },
    getProviderType() { return readProviderType(); },
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      try {
        cb({
          isConnected: this.isConnected(),
          address: this.getAddress(),
          providerType: this.getProviderType(),
          walletName: this.getProviderType(),
        });
      } catch (e) {}
      return () => subscribers.delete(cb);
    },
    _modal: modal,
  };

  console.log('[verixia-wc] AppKit initialized');
  try { window.dispatchEvent(new Event('verixia-wallet-ready')); } catch (e) {}
} catch (err) {
  console.error('[verixia-wc] AppKit init failed:', err);
  window.VerixiaWallet = {
    _error: (err && err.message) || 'init failed',
    open() { alert('Wallet failed to load: ' + this._error); },
    close() {}, disconnect() {},
    getAddress() { return null; }, isConnected() { return false; },
    getProvider() { return null; }, getProviderType() { return null; },
    subscribe() { return () => {}; },
  };
  try { window.dispatchEvent(new Event('verixia-wallet-ready')); } catch (e) {}
}
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
  if (fs.existsSync(entry)) fs.unlinkSync(entry);
}
