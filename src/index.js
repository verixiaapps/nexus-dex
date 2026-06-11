import './bs58-patch.js';
/**
 * NEXUS DEX -- App entry (hardened)
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { WalletConnectWalletAdapter } from '@solana/wallet-adapter-walletconnect';
import '@solana/wallet-adapter-react-ui/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { WalletContextProvider } from './WalletContext.js';

function showFatal(title, detail) {
  try {
    const el = document.getElementById('root') || document.body;
    el.innerHTML =
      '<div style="position:fixed;inset:0;padding:20px;overflow:auto;' +
      'background:#111;color:#f88;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;' +
      'white-space:pre-wrap;word-break:break-word;z-index:2147483647">' +
      '<div style="color:#fff;font-weight:bold;margin-bottom:12px;font-size:14px">' +
      String(title) + '</div>' + String(detail || '') + '</div>';
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    const err = e.error || {};
    showFatal('JavaScript error',
      'Message: ' + (e.message || err.message || '') +
      '\n\nFile: ' + (e.filename || '') + ':' + (e.lineno || '?') +
      '\n\nStack:\n' + (err.stack || '(no stack)'));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    showFatal('Unhandled promise rejection',
      'Message: ' + (r.message || r) +
      '\n\nStack:\n' + (r.stack || '(no stack)'));
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[Nexus DEX] React error:', err, info); }
  render() {
    if (this.state.err) {
      const e = this.state.err;
      return (
        <pre style={{
          margin: 0, padding: 20, background: '#111', color: '#f88',
          font: '12px/1.4 ui-monospace,Menlo,Consolas,monospace',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: '100vh',
        }}>
          <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: 12, fontSize: 14 }}>
            React render error
          </div>
          {String(e && e.message)}{'\n\n'}{String(e && e.stack)}
        </pre>
      );
    }
    return this.props.children;
  }
}

if (typeof window !== 'undefined' && !window.Buffer) { window.Buffer = Buffer; }

try {
  const SOLANA_RPC =
    process.env.REACT_APP_SOLANA_RPC ||
    (process.env.REACT_APP_HELIUS_API_KEY
      ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
      : 'https://api.mainnet-beta.solana.com');

  const WC_PROJECT_ID = process.env.REACT_APP_WALLETCONNECT_PROJECT_ID;

  const solanaWallets = [];
  try { solanaWallets.push(new PhantomWalletAdapter()); }
  catch (err) { console.warn('[Nexus DEX] PhantomWalletAdapter failed:', err); }

  if (WC_PROJECT_ID) {
    try {
      solanaWallets.push(new WalletConnectWalletAdapter({
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
    } catch (err) { console.warn('[Nexus DEX] WalletConnect adapter failed:', err); }
  } else {
    console.warn('[Nexus DEX] REACT_APP_WALLETCONNECT_PROJECT_ID not set — WalletConnect disabled.');
  }

  function onWalletError(err, adapter) {
    console.warn('[Nexus DEX] Solana wallet error:', adapter && adapter.name, err && err.message);
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  });

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    showFatal('Bootstrap error', '#root element not found in index.html');
  } else {
    const root = ReactDOM.createRoot(rootEl);
    root.render(
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ConnectionProvider endpoint={SOLANA_RPC} config={{ commitment: 'confirmed' }}>
            <WalletProvider wallets={solanaWallets} autoConnect={false} onError={onWalletError}>
              <WalletContextProvider>
                <App />
              </WalletContextProvider>
            </WalletProvider>
          </ConnectionProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }
} catch (err) {
  showFatal('Startup error', 'Message: ' + (err && err.message) + '\n\nStack:\n' + (err && err.stack));
  throw err;
}
