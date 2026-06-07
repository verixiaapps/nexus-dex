// src/embed/index.jsx 
//
// VERIXIA SWAP EMBED — single self-contained entry point for every SEO page.
//
// One React tree. One wallet provider stack. Two portals:
//   • #verixia-swap-root  → the real SwapWidget (Jupiter + atomic-tx flow)
//   • .connect (header)   → page-level Connect button, same wallet state
//
// On-page error display: any failure during mount, render, or runtime is
// written directly into #verixia-swap-root as readable text — so the SEO page
// itself shows what went wrong instead of silently sitting on the skeleton.

import React, { useMemo, useState, useEffect, useCallback } from 'react';
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

/* ──────────────────────────────────────────────────────────────────────
 * On-page error display — writes failures into #verixia-swap-root as
 * readable text so they're visible without devtools.
 * ─────────────────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showOnPageError(where, err) {
  try {
    const el = document.getElementById('verixia-swap-root');
    if (!el) return;
    const msg = (err && (err.stack || err.message)) || String(err);
    el.innerHTML =
      '<div style="padding:20px;color:#ff5d7d;font-family:monospace;' +
      'font-size:12px;line-height:1.5;background:rgba(255,93,125,0.08);' +
      'border:1px solid rgba(255,93,125,0.4);border-radius:14px;' +
      'white-space:pre-wrap;word-break:break-word;text-align:left;">' +
      '<div style="font-weight:700;margin-bottom:8px;color:#ffb3c1;">' +
      'VERIXIA SWAP ERROR — ' + escapeHtml(where) + '</div>' +
      escapeHtml(msg) +
      '</div>';
  } catch (e) {
    console.error('[verixia-swap] showOnPageError failed:', e);
  }
}

class EmbedErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error('[verixia-swap] render error:', err, info);
    showOnPageError('render', err);
  }
  render() { return this.state.err ? null : this.props.children; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    if (e && e.error) showOnPageError('window.error', e.error);
  });
  window.addEventListener('unhandledrejection', (e) => {
    showOnPageError('unhandled-rejection', e.reason || e);
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * Buffer shim
 * ─────────────────────────────────────────────────────────────────── */
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

/* ──────────────────────────────────────────────────────────────────────
 * Runtime config
 * ─────────────────────────────────────────────────────────────────── */
const CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};

const RPC_URL =
  CFG.rpc ||
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOLANA_RPC) ||
  'https://api.mainnet-beta.solana.com';

const WC_PROJECT_ID =
  CFG.wcProjectId ||
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_WALLETCONNECT_PROJECT_ID) ||
  '';

const TERMS_KEY = 'nexus_terms_accepted_v3';

/* ──────────────────────────────────────────────────────────────────────
 * Header Connect — renders into <button class="connect">.
 * ─────────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────────────
 * EmbedRoot — providers + portals + modals. One tree, shared state.
 * ─────────────────────────────────────────────────────────────────── */
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
        console.error('[verixia-swap] WalletConnect adapter init failed:', e);
        showOnPageError('walletconnect-init', e);
      }
    } else {
      console.error('[verixia-swap] WALLETCONNECT_PROJECT_ID missing');
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

/* ──────────────────────────────────────────────────────────────────────
 * Mount.
 * ─────────────────────────────────────────────────────────────────── */
const MOUNTED = new WeakSet();

function mount() {
  try {
    const swapMount = document.getElementById('verixia-swap-root');
    if (!swapMount) {
      console.warn('[verixia-swap] no #verixia-swap-root element on page');
      return;
    }
    if (MOUNTED.has(swapMount)) return;
    MOUNTED.add(swapMount);

    const cleanMint = (v) => (v && v.indexOf('{{') === -1) ? v : undefined;
    const inputMint  = cleanMint(swapMount.dataset.inputMint);
    const outputMint = cleanMint(swapMount.dataset.outputMint);

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
    console.error('[verixia-swap] mount failed:', e);
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
