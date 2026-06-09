// build-wc.mjs
//
// Builds the wallet bundle. Output: verixia-wc.js at the repo root, which
// server.js serves at https://verixiaapps.com/nexus-dex/verixia-wc.js
//
// Run by the GitHub Action (.github/workflows/build-bundle.yml) when manually
// triggered. The action commits the resulting file back to the repo.

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

  modal.subscribeProvider((s) => {
    notify({
      isConnected: !!(s && s.isConnected),
      address: (s && s.address) || null,
      providerType: (s && s.providerType) || null,
      walletName: (s && s.providerType) || null,
    });
  });

  window.VerixiaWallet = {
    open() { return modal.open(); },
    close() { return modal.close(); },
    disconnect() { return modal.disconnect(); },
    getAddress() { try { return modal.getAddress() || null; } catch { return null; } },
    isConnected() { try { return !!modal.getAddress(); } catch { return false; } },
    getProvider() { try { return modal.getWalletProvider() || null; } catch { return null; } },
    getProviderType() {
      try { return (modal.getWalletProviderType && modal.getWalletProviderType()) || null; }
      catch { return null; }
    },
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
