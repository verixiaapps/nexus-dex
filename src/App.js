import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useDisconnect } from 'wagmi';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import SwapWidget from './components/SwapWidget';
import Markets from './components/Markets';
import BuyCrypto from './components/BuyCrypto';
import Portfolio from './components/Portfolio';
import TokenDetail from './components/TokenDetail';
import Send from './components/Send';
import NewLaunches from './components/NewLaunches';
import TokenLaunch from './components/TokenLaunch';

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
};

const SOLANA_MINTS = [
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'jtojtomepa8tDDcS9EeQJwAkNnhvbTVS6ZoXgbCXyzz',
  'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
];

const CG_IDS = 'bitcoin,ethereum,binancecoin,ripple,cardano,dogecoin,solana,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near';

const GLOBAL_STYLES = `html,body{margin:0;padding:0;width:100%;min-height:100vh;overflow-x:hidden;overscroll-behavior:none;} *,*::before,*::after{box-sizing:border-box;} input,button,select,textarea{font-family:'Syne',sans-serif;} ::-webkit-scrollbar{width:3px;height:3px;} ::-webkit-scrollbar-track{background:#03060f;} ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px;} .hide-scrollbar{scrollbar-width:none;} .hide-scrollbar::-webkit-scrollbar{display:none;} @media(max-width:768px){.desktop-nav{display:none!important;}} @media(min-width:769px){.mobile-nav{display:none!important;}}`;

const PATH_TO_TAB = {
  '/': 'swap', '/swap': 'swap', '/markets': 'markets',
  '/launches': 'launches', '/launch': 'launch',
  '/buy': 'buy', '/send': 'send', '/portfolio': 'portfolio',
};
const TAB_TO_PATH = {
  swap: '/swap', markets: '/markets', launches: '/launches',
  launch: '/launch', buy: '/buy', send: '/send', portfolio: '/portfolio',
};

function tabFromPathname(pathname) {
  return PATH_TO_TAB[pathname] || (pathname.startsWith('/markets/token') ? 'token' : 'swap');
}
function getActiveTab(tab) {
  return tab === 'token' ? 'markets' : tab;
}

export function useAppWallet() {
  const { publicKey, connected: solConnected, sendTransaction, signTransaction } = useWallet();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const isConnected = solConnected || evmConnected;
  const isSolanaConnected = solConnected;
  const walletAddress = solConnected && publicKey
    ? publicKey.toString()
    : evmConnected && evmAddress
    ? evmAddress
    : null;
  return {
    isConnected, isSolanaConnected, walletAddress,
    publicKey: (solConnected && publicKey) ? publicKey : null,
    sendTransaction, signTransaction, solConnected, evmConnected, evmAddress,
  };
}

function WalletModal({ open, onClose }) {
  const { wallet: selectedWallet, select, wallets, connect, disconnect, connected, publicKey } = useWallet();
  const { open: openWeb3Modal } = useWeb3Modal();
  const { isConnected: evmConnected, address: evmAddress } = useAccount();
  const { disconnect: evmDisconnect } = useDisconnect();
  const [pendingWallet, setPendingWallet] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const connectRef = useRef(connect);
  const onCloseRef = useRef(onClose);
  useEffect(() => { connectRef.current = connect; }, [connect]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    if (connected || evmConnected) {
      setPendingWallet(null);
      setConnecting(false);
      onCloseRef.current();
    }
  }, [connected, evmConnected, open]);

  useEffect(() => {
    if (!pendingWallet) return;
    if (selectedWallet?.adapter.name !== pendingWallet) return;

    let active = true;
    connectRef.current().catch(e => {
      if (active) {
        console.error('Wallet connect error:', e);
        setPendingWallet(null);
        setConnecting(false);
      }
    });
    return () => { active = false; };
  }, [pendingWallet, selectedWallet]);

  const handleSolanaConnect = (wallet) => {
    try {
      setConnecting(true);
      select(wallet.adapter.name);
      setPendingWallet(wallet.adapter.name);
    } catch (e) {
      console.error('Wallet select error:', e);
      setConnecting(false);
    }
  };

  const handleWalletConnect = () => {
    onClose();
    openWeb3Modal({ view: 'Connect' });
  };

  const isSol = connected && publicKey;
  const displayAddr = isSol
    ? publicKey.toString().slice(0, 6) + '...' + publicKey.toString().slice(-4)
    : evmConnected && evmAddress
    ? evmAddress.slice(0, 6) + '...' + evmAddress.slice(-4)
    : null;
  const connectedWalletName = isSol
    ? (wallets.find(w => w.adapter.connected)?.adapter.name ?? 'Solana')
    : 'EVM Wallet';

  const _seen = new Set();
  const detectedWallets = wallets.filter(w => {
    if (w.adapter.name === 'WalletConnect') return false;
    if (_seen.has(w.adapter.name)) return false;
    _seen.add(w.adapter.name);
    return w.readyState === 'Installed' || w.readyState === 'Loadable';
  });
  const notDetectedWallets = wallets.filter(w => {
    if (w.adapter.name === 'WalletConnect') return false;
    return !_seen.has(w.adapter.name);
  });

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 501, background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)', borderRadius: '20px 20px 0 0', padding: '24px 24px 48px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 -20px 60px rgba(0,0,0,.9)' }}>
        <div style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 24px' }} />
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
            {connected || evmConnected ? 'Wallet Connected' : 'Connect Wallet'}
          </div>
          {displayAddr && <div style={{ fontSize: 13, color: '#586994' }}>{connectedWalletName}: {displayAddr}</div>}
        </div>

        {(connected || evmConnected) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto' }}>
            <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 20px' }}>
              <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected</div>
              <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{displayAddr}</div>
            </div>
            <button
              onClick={async () => {
                try {
                  if (connected) await disconnect();
                  if (evmConnected) evmDisconnect();
                  onClose();
                } catch (e) {
                  console.error('Disconnect error:', e);
                }
              }}
              style={{ background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: 16, cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}
            >
              Disconnect
            </button>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 14, cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}
            >
              Close
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400, margin: '0 auto' }}>
            {detectedWallets.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#586994', fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>DETECTED WALLETS</div>
                {detectedWallets.map(wallet => (
                  <button
                    key={wallet.adapter.name}
                    onClick={() => handleSolanaConnect(wallet)}
                    disabled={connecting}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, background: connecting && pendingWallet === wallet.adapter.name ? 'rgba(0,229,255,.12)' : 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 14, padding: '14px 18px', cursor: connecting ? 'wait' : 'pointer', width: '100%', opacity: connecting && pendingWallet !== wallet.adapter.name ? 0.5 : 1 }}
                  >
                    {wallet.adapter.icon
                      ? <img src={wallet.adapter.icon} alt={wallet.adapter.name} style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#00e5ff', flexShrink: 0 }}>{wallet.adapter.name.charAt(0)}</div>
                    }
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{wallet.adapter.name}</div>
                      <div style={{ color: '#00e5ff', fontSize: 12, marginTop: 1 }}>
                        {connecting && pendingWallet === wallet.adapter.name ? 'Connecting... check your wallet' : 'Detected - tap to connect'}
                      </div>
                    </div>
                    {connecting && pendingWallet === wallet.adapter.name && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #00e5ff', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                    )}
                  </button>
                ))}
              </>
            )}
            <button
              onClick={handleWalletConnect}
              style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(59,153,252,.08)', border: '1px solid rgba(59,153,252,.2)', borderRadius: 14, padding: '14px 18px', cursor: 'pointer', width: '100%' }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg,#3b99fc,#0066cc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="https://avatars.githubusercontent.com/u/37784886" alt="WC" style={{ width: 28, height: 28, borderRadius: 6 }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>WalletConnect</div>
                <div style={{ color: '#3b99fc', fontSize: 12, marginTop: 1 }}>300+ wallets supported</div>
              </div>
            </button>
            {notDetectedWallets.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: '#586994', fontWeight: 700, letterSpacing: 1, margin: '6px 0 2px' }}>MORE WALLETS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {notDetectedWallets.slice(0, 6).map(wallet => (
                    <button
                      key={wallet.adapter.name}
                      onClick={() => { window.open(wallet.adapter.url, '_blank'); onClose(); }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 8px', cursor: 'pointer' }}
                    >
                      {wallet.adapter.icon
                        ? <img src={wallet.adapter.icon} alt={wallet.adapter.name} style={{ width: 32, height: 32, borderRadius: 8 }} onError={e => { e.target.style.display = 'none'; }} />
                        : <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(0,229,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#00e5ff' }}>{wallet.adapter.name.charAt(0)}</div>
                      }
                      <div style={{ color: '#586994', fontSize: 10, textAlign: 'center', lineHeight: 1.2 }}>{wallet.adapter.name}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {/* Spinner keyframe */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </div>
    </>
  );
}

// SVG icons for bottom nav
function IconSwap() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>; }
function IconMarkets() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>; }
function IconLaunches() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function IconLaunch() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>; }
function IconSend() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }
function IconWallet() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>; }
const NAV_ICONS = { swap: IconSwap, markets: IconMarkets, launches: IconLaunches, launch: IconLaunch, send: IconSend, portfolio: IconWallet };

const NAV_TABS = [
  { id: 'swap', label: 'Swap' },
  { id: 'markets', label: 'Markets' },
  { id: 'launches', label: 'Launches' },
  { id: 'launch', label: 'Launch' },
  { id: 'send', label: 'Send' },
  { id: 'portfolio', label: 'Wallet' },
];

const HEADER_TABS = [
  { id: 'swap', label: 'Swap' },
  { id: 'markets', label: 'Markets' },
  { id: 'launches', label: 'Launches' },
  { id: 'launch', label: 'Launch' },
  { id: 'buy', label: 'Buy' },
  { id: 'send', label: 'Send' },
  { id: 'portfolio', label: 'Wallet' },
];

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const wallet = useAppWallet();

  const [tab, setTab] = useState(() => tabFromPathname(location.pathname));
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jupiterTokens, setJupiterTokens] = useState([]);
  const [jupiterLoading, setJupiterLoading] = useState(true);
  const [launchesKey, setLaunchesKey] = useState(0);
  const [portfolioKey, setPortfolioKey] = useState(0);

  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  useEffect(() => {
    const newTab = tabFromPathname(location.pathname);
    if (newTab !== tab) {
      setTab(newTab);
      if (newTab !== 'token') setSelectedToken(null);
    }
  }, [location.pathname, tab]);

  const switchTab = useCallback((newTab) => {
    if (newTab === tab && newTab !== 'token') {
      if (newTab === 'launches') setLaunchesKey(k => k + 1);
      if (newTab === 'portfolio') setPortfolioKey(k => k + 1);
      return;
    }
    if (newTab !== 'token') setSelectedToken(null);
    navigate(TAB_TO_PATH[newTab] || '/swap');
    setTab(newTab);
    window.scrollTo(0, 0);
  }, [tab, navigate]);

  const goToToken = useCallback((coin) => {
    setSelectedToken(coin);
    setTab('token');
    navigate('/markets/token');
    window.scrollTo(0, 0);
  }, [navigate]);

  const goBack = () => navigate(-1);

  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchMarkets = async () => {
      try {
        const [cgResult, jupPriceResult, metaResult] = await Promise.allSettled([
          fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${CG_IDS}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d`,
            { signal: controller.signal }
          ).then(r => r.json()),
          fetch(
            `https://api.jup.ag/price/v2?ids=${SOLANA_MINTS.join(',')}`,
            { signal: controller.signal }
          ).then(r => r.json()),
          fetch(
            'https://lite-api.jup.ag/tokens/v1/tagged/strict',
            { signal: controller.signal }
          ).then(r => r.json()),
        ]);

        if (!isMounted) return;

        if (cgResult.status === 'rejected')       console.warn('CoinGecko fetch failed:', cgResult.reason);
        if (jupPriceResult.status === 'rejected') console.warn('Jupiter price fetch failed:', jupPriceResult.reason);
        if (metaResult.status === 'rejected')     console.warn('Jupiter meta fetch failed:', metaResult.reason);

        let combined = [];

        if (cgResult.status === 'fulfilled' && Array.isArray(cgResult.value)) {
          combined = combined.concat(cgResult.value);
        }

        if (jupPriceResult.status === 'fulfilled' && metaResult.status === 'fulfilled') {
          const jupData = jupPriceResult.value;
          const metaMap = {};

          if (Array.isArray(metaResult.value)) {
            metaResult.value.forEach(t => { metaMap[t.address] = t; });
            setJupiterTokens(
              metaResult.value.map(t => ({
                mint: t.address, symbol: t.symbol, name: t.name,
                decimals: t.decimals, logoURI: t.logoURI,
              }))
            );
            setJupiterLoading(false);
          }

          const solanaCoins = SOLANA_MINTS.map((mint, i) => {
            const priceInfo = jupData.data?.[mint];
            const meta = metaMap[mint] || {};
            if (!priceInfo?.price) return null;
            return {
              id: mint,
              symbol: meta.symbol || mint.slice(0, 4),
              name: meta.name || 'Unknown',
              image: meta.logoURI || null,
              current_price: parseFloat(priceInfo.price),
              market_cap: 0,
              market_cap_rank: 50 + i,
              total_volume: 0,
              high_24h: null, low_24h: null,
              price_change_percentage_1h_in_currency: null,
              price_change_percentage_24h: null,
              price_change_percentage_7d_in_currency: null,
              sparkline_in_7d: null,
              ath: null, ath_change_percentage: null,
              circulating_supply: null,
              isSolanaToken: true,
            };
          }).filter(Boolean);

          combined = combined.concat(solanaCoins);
        }

        if (combined.length && isMounted) setCoins(combined);
        if (isMounted) setLoading(false);
      } catch (e) {
        if (e.name !== 'AbortError') console.error('Market fetch error:', e);
      }
    };

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 30000);
    return () => { isMounted = false; controller.abort(); clearInterval(interval); };
  }, []);

  const sharedProps = {
    isConnected: wallet.isConnected,
    isSolanaConnected: wallet.isSolanaConnected,
    walletAddress: wallet.walletAddress,
    onConnectWallet: openWallet,
  };
  const displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '..' + wallet.walletAddress.slice(-4)
    : null;
  const activeTab = getActiveTab(tab);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.02) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(0,229,255,0.08)', background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', height: 56, gap: 12 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00e5ff,#0066ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: C.bg }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{ fontSize: 9, color: C.accent, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>DEX</span>
          </div>

          <nav className="desktop-nav hide-scrollbar" style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center', overflowX: 'auto' }}>
            {HEADER_TABS.map(t => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => switchTab(t.id)}
                  style={{ background: active ? 'rgba(0,229,255,.09)' : 'transparent', border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent', borderRadius: 8, padding: '5px 12px', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="mobile-nav" style={{ flex: 1 }} />

          <button
            onClick={openWallet}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}
          >
            {wallet.isConnected
              ? (<><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, flexShrink: 0 }} />{displayAddress}</>)
              : 'Connect Wallet'
            }
          </button>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '24px 16px 100px', width: '100%' }}>
        {tab === 'swap'      && <SwapWidget   {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} jupiterLoading={jupiterLoading} onGoToToken={goToToken} />}
        {tab === 'markets'   && <Markets      coins={coins} loading={loading} onSelectCoin={goToToken} jupiterTokens={jupiterTokens} />}
        {tab === 'token' && selectedToken && <TokenDetail {...sharedProps} coin={selectedToken} coins={coins} jupiterTokens={jupiterTokens} onBack={goBack} />}
        {tab === 'launches'  && <NewLaunches  {...sharedProps} coins={coins} resetKey={launchesKey} />}
        {tab === 'launch'    && <TokenLaunch  {...sharedProps} />}
        {tab === 'buy'       && <BuyCrypto    coins={coins} walletAddress={wallet.walletAddress || ''} selectedCoinSymbol={selectedToken?.symbol ?? null} />}
        {tab === 'send'      && <Send         {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} />}
        {tab === 'portfolio' && <Portfolio    {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} onSend={() => switchTab('send')} refreshKey={portfolioKey} onSelectToken={goToToken} />}
      </main>

      <nav className="mobile-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV_TABS.map(t => {
          const active = activeTab === t.id;
          const Icon = NAV_ICONS[t.id];
          return (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54, position: 'relative' }}
            >
              {active && <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: '0 0 2px 2px', background: C.accent }} />}
              {Icon && <Icon />}
              <span>{t.label}</span>
            </button>
          );
        })}
        <button
          onClick={openWallet}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: wallet.isConnected ? C.green : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600, padding: '8px 2px', minHeight: 54 }}
        >
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid ' + (wallet.isConnected ? C.green : C.muted), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {wallet.isConnected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />}
          </div>
          <span style={{ fontSize: 8 }}>{wallet.isConnected ? displayAddress : 'Connect'}</span>
        </button>
      </nav>

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
