// src/embed/index.jsx
//
// VERIXIA SWAP EMBED — with unmissable diagnostic banner.
//
// The FIRST thing this file does (before any imports finish executing) is
// write a visible banner into #verixia-swap-root saying "BUNDLE LOADED v3".
// If you reload the SEO page and don't see that banner, then the new
// bundle is NOT actually being served — it's a Railway/cache issue, not a
// code issue.
//
// Any error during mount or render is also written into the same element
// as readable text.

// ─── Step 1: prove the bundle is running ─────────────────────────────
(function bootBanner() {
  if (typeof document === 'undefined') return;
  function paint() {
    var el = document.getElementById('verixia-swap-root');
    if (!el) return;
    el.innerHTML =
      '<div id="verixia-boot-banner" style="padding:20px;color:#00e5ff;' +
      'font-family:monospace;font-size:13px;line-height:1.6;' +
      'background:rgba(0,229,255,0.08);border:2px solid #00e5ff;' +
      'border-radius:14px;text-align:center;">' +
      '<div style="font-weight:700;font-size:15px;margin-bottom:6px;">' +
      'VERIXIA EMBED — BUNDLE v3 LOADED' +
      '</div>' +
      '<div style="color:#9ff0cc;">Initializing React…</div>' +
      '</div>';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }
})();

// ─── Step 2: imports ─────────────────────────────────────────────────
import React, { useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Buffer } from 'buffer';

import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';

import { WalletContextProvider, useNexusWallet } from '../WalletContext.js';
import SwapWidget from '../components/SwapWidget.jsx';
import { WalletModal, TermsGate } from '../components/WalletConnectKit.jsx';

import '@solana/wallet-adapter-react-ui/styles.css';

// ─── Step 3: on-page error helpers ───────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showOnPageError(where, err) {
  try {
    var el = document.getElementById('verixia-swap-root');
    if (!el) return;
    var msg = (err && (err.stack || err.message)) || String(err);
    el.innerHTML =
      '<div style="padding:20px;color:#ff5d7d;font-family:monospace;' +
      'font-size:12px;line-height:1.5;background:rgba(255,93,125,0.08);' +
      'border:2px solid #ff5d7d;border-radius:14px;' +
      'white-space:pre-wrap;word-break:break-word;text-align:left;">' +
      '<div style="font-weight:700;margin-bottom:8px;color:#ffb3c1;font-size:14px;">' +
      'VERIXIA SWAP ERROR — ' + escapeHtml(where) +
      '</div>' +
      escapeHtml(msg) +
      '</div>';
  } catch (e) {
    console.error('[verixia-swap] showOnPageError failed:', e);
  }
}

class EmbedErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) {
    console.error('[verixia-swap] render error:', err);
    showOnPageError('render', err);
  }
  render() { return this.state.err ? null : this.props.children; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', function (e) {
    if (e && e.error) showOnPageError('window.error', e.error);
  });
  window.addEventListener('unhandledrejection', function (e) {
    showOnPageError('unhandled-rejection', e.reason || e);
  });
}

// ─── Step 4: Buffer shim ─────────────────────────────────────────────
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

// ─── Step 5: runtime config ──────────────────────────────────────────
var CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
var RPC_URL = CFG.rpc || 'https://api.mainnet-beta.solana.com';
var WC_PROJECT_ID = CFG.wcProjectId || '';
var TERMS_KEY = 'nexus_terms_accepted_v3';

// ─── Step 6: HeaderConnect ───────────────────────────────────────────
function HeaderConnect({ onOpen }) {
  const { isConnected, walletAddress } = useNexusWallet();
  const label = isConnected && walletAddress
    ? walletAddress.slice(0, 4) + '…' + walletAddress.slice(-4)
    : 'Connect';
  return (
    <span
      onClick={onOpen}
      style={{ cursor: 'pointer', display: 'inline-block', width: '100%', height: '100%' }}
    >
      {label}
    </span>
  );
}

// ─── Step 7: EmbedRoot ───────────────────────────────────────────────
function EmbedRoot({ swapMount, headerMount, inputMint, outputMint }) {
  const wallets = useMemo(() => {
    const list = [new PhantomWalletAdapter()];
    if (WC_PROJECT_ID) {
      try {
        list.push(new WalletConnectWalletAdapter({
          network: 'mainnet-beta',
          options: {
            projectId: WC_PROJECT_ID,
            metadata: {
              name: 'Nexus DEX',
              description: 'Solana DEX powered by Jupiter',
              url: 'https://swap.verixiaapps.com',
              icons: ['https://swap.verixiaapps.com/icon-512.png'],
            },
          },
        }));
      } catch (e) {
        showOnPageError('walletconnect-init', e);
      }
    }
    return list;
  }, []);

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [termsPending, setTermsPending] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem(TERMS_KEY) === '1'; } catch { return false; }
  });

  const openWallet = useCallback(() => {
    if (termsAccepted) setWalletModalOpen(true);
    else setTermsPending(true);
  }, [termsAccepted]);

  const acceptTerms = useCallback(() => {
    try { localStorage.setItem(TERMS_KEY, '1'); } catch {}
    setTermsAccepted(true);
    setTermsPending(false);
    setWalletModalOpen(true);
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <WalletContextProvider>
            {createPortal(
              <SwapWidget
                defaultInputMint={inputMint}
                defaultOutputMint={outputMint}
                onConnectWallet={openWallet}
              />,
              swapMount
            )}
            {headerMount && createPortal(
              <HeaderConnect onOpen={openWallet} />,
              headerMount
            )}
            {termsPending && <TermsGate onAccept={acceptTerms} />}
            <WalletModal
              open={walletModalOpen}
              onClose={() => setWalletModalOpen(false)}
            />
          </WalletContextProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ─── Step 8: mount ───────────────────────────────────────────────────
const MOUNTED = new WeakSet();

function mount() {
  try {
    const swapMount = document.getElementById('verixia-swap-root');
    if (!swapMount) return;
    if (MOUNTED.has(swapMount)) return;
    MOUNTED.add(swapMount);

    const cleanMint = (v) => (v && v.indexOf('{{') === -1) ? v : undefined;
    const inputMint  = cleanMint(swapMount.dataset.inputMint);
    const outputMint = cleanMint(swapMount.dataset.outputMint);

    // Note: keep the boot banner visible until React renders into the portal.
    // SwapWidget's render will replace it via createPortal.
    swapMount.innerHTML = '';

    const headerMount = document.querySelector('button.connect, .connect');

    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);

    const root = ReactDOM.createRoot(host);
    root.render(
      <EmbedErrorBoundary>
        <EmbedRoot
          swapMount={swapMount}
          headerMount={headerMount}
          inputMint={inputMint}
          outputMint={outputMint}
        />
      </EmbedErrorBoundary>
    );
  } catch (e) {
    showOnPageError('mount', e);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}

if (typeof window !== 'undefined') {
  window.VerixiaSwap = { mount };
}
