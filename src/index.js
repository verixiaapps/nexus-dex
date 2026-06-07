// src/embed/index.jsx
//
// VERIXIA SWAP EMBED — single self-contained entry point for every SEO page.
//
// One React tree. One wallet provider stack. Two portals:
//   • #verixia-swap-root  → the real SwapWidget (Jupiter + atomic-tx flow)
//   • .connect (header)   → page-level Connect button, same wallet state
//
// Both portals share the SAME ConnectionProvider / WalletProvider /
// WalletContextProvider, so the header pill and the widget always agree on
// connection status — connect from either, disconnect from either.
//
// No autoConnect: SEO pages start clean. A previous main-site connection in
// localStorage does NOT silently re-fire on page load (which was crashing
// the WalletConnect adapter during render and leaving the skeleton up).
//
// Config (RPC + WalletConnect projectId) comes from window.__VERIXIA_CONFIG__
// served by server.js at /embed/config.js — no build-time secrets.

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Buffer } from 'buffer';

import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';

import { WalletContextProvider, useNexusWallet } from '../WalletContext.js';
import SwapWidget from '../components/SwapWidget.jsx';
import { WalletModal, TermsGate } from '../components/WalletConnectKit.jsx';

import '@solana/wallet-adapter-react-ui/styles.css';

/* ──────────────────────────────────────────────────────────────────────
 * Buffer shim — some Solana libs read window.Buffer at runtime.
 * ─────────────────────────────────────────────────────────────────── */
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

/* ──────────────────────────────────────────────────────────────────────
 * Runtime config — injected by /embed/config.js (server.js reads Railway env).
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
 * Header Connect — renders into the SEO page's existing <button class="connect">.
 * Pulls live state from useNexusWallet so it always matches the widget.
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
 * EmbedRoot — providers + both portals + modals. One tree, shared state.
 * ─────────────────────────────────────────────────────────────────── */
function EmbedRoot({ swapMount, headerMount, inputMint, outputMint }) {
  // WalletConnect MUST have a projectId. If Railway env isn't set, log loudly
  // and skip the adapter — Phantom still works, no silent crash.
  const wallets = useMemo(() => {
    const list = [new PhantomWalletAdapter()];
    if (WC_PROJECT_ID) {
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
    } else {
      console.error(
        '[verixia-swap] WALLETCONNECT_PROJECT_ID is not set on the server — ' +
        'WalletConnect adapter disabled. Set it in Railway env.'
      );
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
            {/* Swap widget portal */}
            {createPortal(
              <SwapWidget
                defaultInputMint={inputMint}
                defaultOutputMint={outputMint}
                onConnectWallet={openWallet}
              />,
              swapMount
            )}

            {/* Header Connect button portal (only if .connect exists on page) */}
            {headerMount && createPortal(
              <HeaderConnect onOpen={openWallet} />,
              headerMount
            )}

            {/* Shared modals */}
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
 * Mount — idempotent. Finds the swap root and the header connect button,
 * mounts a single React root onto a hidden host, and renders both UIs via
 * portals into their target DOM nodes.
 * ─────────────────────────────────────────────────────────────────── */
const MOUNTED = new WeakSet();

function mount() {
  const swapMount = document.getElementById('verixia-swap-root');
  if (!swapMount) {
    console.warn('[verixia-swap] no #verixia-swap-root element on page');
    return;
  }
  if (MOUNTED.has(swapMount)) return;
  MOUNTED.add(swapMount);

  // Treat empty OR unfilled "{{...}}" placeholders as absent.
  const cleanMint = (v) => (v && v.indexOf('{{') === -1) ? v : undefined;
  const inputMint  = cleanMint(swapMount.dataset.inputMint);
  const outputMint = cleanMint(swapMount.dataset.outputMint);

  // Clear the skeleton.
  swapMount.innerHTML = '';

  // Header connect button — optional. If absent, the embed still works,
  // user just connects via the widget's own button.
  const headerMount = document.querySelector('button.connect, .connect');

  // Hidden host element to root React into. The visible UI is rendered via
  // portals into swapMount and headerMount, so this host stays empty.
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);

  const root = ReactDOM.createRoot(host);
  root.render(
    <EmbedRoot
      swapMount={swapMount}
      headerMount={headerMount}
      inputMint={inputMint}
      outputMint={outputMint}
    />
  );
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}

// Manual mount for SPA hosts that inject the script after load.
if (typeof window !== 'undefined') {
  window.VerixiaSwap = { mount };
}
