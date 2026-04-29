import React, { useState, useEffect, useCallback } from 'react';
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

const C = {
  bg: '#03060f', card: '#080d1a', border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b', text: '#cdd6f4', muted: '#586994',
};

export function useAppWallet() {
  const { publicKey, connected: solConnected, sendTransaction, signTransaction, signAllTransactions } = useWallet();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();

  const isConnected = solConnected || evmConnected;
  const isSolanaConnected = isConnected;
  const walletAddress = solConnected && publicKey
    ? publicKey.toString()
    : evmConnected && evmAddress ? evmAddress : null;

  return {
    isConnected, isSolanaConnected, walletAddress,
    publicKey: (solConnected && publicKey) ? publicKey : null,
    sendTransaction, signTransaction, signAllTransactions,
    solConnected, evmConnected, evmAddress,
  };
}

function WalletModal({ open, onClose }) {
  const { select, wallets, connect, disconnect, connected, publicKey } = useWallet();
  const { open: openWeb3Modal } = useWeb3Modal();
  const { isConnected: evmConnected, address: evmAddress } = useAccount();
  const { disconnect: evmDisconnect } = useDisconnect();

  const isSol = connected && publicKey;
  const displayAddr = isSol
    ? publicKey.toString().slice(0, 6) + '…' + publicKey.toString().slice(-6)
    : evmConnected && evmAddress ? evmAddress.slice(0, 6) + '…' + evmAddress.slice(-6) : null;
  let connectedWalletName = isSol && wallets.find(w => w.adapter.connected);
  connectedWalletName = connectedWalletName ? connectedWalletName.adapter.name : (isSol ? 'Solana Wallet' : 'EVM Wallet');

  const detectedWallets = wallets.filter(w => w.readyState === 'Installed' || w.readyState === 'Loadable');
  const notDetectedWallets = wallets.filter(w => w.readyState !== 'Installed' && w.readyState !== 'Loadable');

  if (!open) return null;

  const handleSolanaConnect = async wallet => {
    try { await select(wallet.adapter.name); await connect(); onClose(); }
    catch (e) { console.error(e); }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 501, background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)', borderRadius: '20px 20px 0 0', padding: '24px 24px 48px', boxShadow: '0 -20px 60px rgba(0,0,0,.9)', animation: 'slideUp .25s ease', maxHeight: '85vh', overflowY: 'auto' }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
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
              <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connected - active site wide</div>
              <div style={{ color: '#586994', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 4 }}>{displayAddr}</div>
              <div style={{ color: '#586994', fontSize: 11 }}>{connectedWalletName} - all transactions use this wallet</div>
            </div>
            <button
              onClick={async () => {
                try { if (connected) await disconnect(); if (evmConnected) evmDisconnect(); onClose(); }
                catch (e) { console.error(e); }
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 16, padding: '16px', cursor: 'pointer', width: '100%', color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif' }}
            >Disconnect</button>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: '14px', cursor: 'pointer', color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif' }}
            >Close</button>
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
                    style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 14, padding: '14px 18px', cursor: 'pointer', width: '100%' }}
                  >
                    {wallet.adapter.icon
                      ? <img src={wallet.adapter.icon} alt={wallet.adapter.name} style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,229,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#00e5ff', flexShrink: 0 }}>{wallet.adapter.name.charAt(0)}</div>
                    }
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{wallet.adapter.name}</div>
                      <div style={{ color: '#00e5ff', fontSize: 12, marginTop: 1 }}>Detected - tap to connect</div>
                    </div>
                  </button>
                ))}
              </>
            )}

            <button
              onClick={() => { onClose(); setTimeout(() => openWeb3Modal(), 100); }}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
          </div>
        )}
      </div>
    </>
  );
}

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

const prefetchLaunches = () =>
  fetch('https://frontend-api.pump.fun/coins?limit=30&offset=0&sort=created_timestamp&order=DESC&includeNsfw=false').catch(() => {});

export default function App() {
  const [tab, setTab] = useState('swap');
  const [prevTab, setPrevTab] = useState('swap');
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [jupiterTokens, setJupiterTokens] = useState([]);
  const [jupiterLoading, setJupiterLoading] = useState(true);
  const [launchesKey, setLaunchesKey] = useState(0);
  const [portfolioKey, setPortfolioKey] = useState(0);

  const wallet = useAppWallet();

  useEffect(() => {
    window.scrollTo(0, 0);
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
  }, [tab]);

  const switchTab = useCallback(newTab => {
    if (newTab !== 'token') setSelectedToken(null);
    if (newTab === 'launches') setLaunchesKey(k => k + 1);
    if (newTab === 'portfolio') setPortfolioKey(k => k + 1);
    setPrevTab(tab);
    setTab(newTab);
  }, [tab]);

  const openWallet = useCallback(() => setWalletModalOpen(true), []);

  const goToToken = useCallback(coin => {
    setSelectedToken(coin);
    setTab('token');
  }, []);

  useEffect(() => {
    const fetchJupiterTokens = async () => {
      setJupiterLoading(true);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch('https://lite-api.jup.ag/tokens/v1/tagged/strict', {
          signal: controller.signal,
          headers: { 'x-api-key': process.env.REACT_APP_JUPITER_API_KEY1 || '' },
        });
        clearTimeout(timeout);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setJupiterTokens(data.map(t => ({
            mint: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logoURI: t.logoURI,
          })));
        }
      } catch (e) { console.log('Jupiter token fetch failed:', e); }
      setJupiterLoading(false);
    };
    fetchJupiterTokens();
  }, []);

  useEffect(() => {
    const fetchMarkets = async () => {
      let combined = [];
      const cgIds = 'bitcoin,ethereum,binancecoin,ripple,cardano,dogecoin,solana,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near';

      const [cgResult, jupPriceResult, metaResult] = await Promise.allSettled([
        fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgIds}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d`).then(r => r.json()),
        fetch('https://api.jup.ag/price/v2?ids=' + SOLANA_MINTS.join(',')).then(r => r.json()),
        fetch('https://lite-api.jup.ag/tokens/v1/tagged/strict').then(r => r.json()),
      ]);

      if (cgResult.status === 'fulfilled' && Array.isArray(cgResult.value)) {
        combined = [...combined, ...cgResult.value];
      }

      if (jupPriceResult.status === 'fulfilled' && metaResult.status === 'fulfilled') {
        const jupData = jupPriceResult.value;
        const metaMap = {};
        if (Array.isArray(metaResult.value)) metaResult.value.forEach(t => { metaMap[t.address] = t; });
        const solanaCoins = SOLANA_MINTS.map((mint, i) => {
          const priceInfo = jupData.data?.[mint];
          const meta = metaMap[mint] || {};
          if (!priceInfo?.price) return null;
          return {
            id: mint, symbol: meta.symbol || mint.slice(0, 4),
            name: meta.name || 'Unknown', image: meta.logoURI || null,
            current_price: parseFloat(priceInfo.price),
            market_cap: 0, market_cap_rank: 50 + i, total_volume: 0,
            high_24h: null, low_24h: null,
            price_change_percentage_1h_in_currency: null,
            price_change_percentage_24h: null,
            price_change_percentage_7d_in_currency: null,
            sparkline_in_7d: null,
            ath: null, ath_change_percentage: null, circulating_supply: null,
            isSolanaToken: true,
          };
        }).filter(Boolean);
        combined = [...combined, ...solanaCoins];
      }

      if (combined.length) setCoins(combined);
      setLoading(false);
    };
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 30000);
    return () => clearInterval(interval);
  }, []);

  const sharedProps = {
    isConnected: wallet.isConnected,
    isSolanaConnected: wallet.isSolanaConnected,
    walletAddress: wallet.walletAddress,
    onConnectWallet: openWallet,
  };

  const displayAddress = wallet.walletAddress
    ? wallet.walletAddress.slice(0, 4) + '…' + wallet.walletAddress.slice(-4)
    : null;

  const headerTabs = [
    { id: 'swap', label: 'Swap' },
    { id: 'markets', label: 'Markets' },
    { id: 'launches', label: 'New Launches' },
    { id: 'buy', label: 'Buy Crypto' },
    { id: 'send', label: 'Send' },
    { id: 'portfolio', label: 'Portfolio' },
  ];

  const navTabs = [
    { id: 'swap', label: 'Swap' },
    { id: 'markets', label: 'Markets' },
    { id: 'launches', label: 'Launches' },
    { id: 'send', label: 'Send' },
    { id: 'portfolio', label: 'Wallet' },
  ];

  return (
    <div style={{ minHeight: '100vh', height: '100%', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif', overscrollBehavior: 'none', overflowX: 'hidden', width: '100%', boxSizing: 'border-box' }}>
      <style>{`html,body{margin:0;padding:0;width:100%;min-height:100vh;overflow-x:hidden;overscroll-behavior:none;}*,*::before,*::after{box-sizing:border-box;}input,button{font-family:inherit;}`}</style>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundImage: 'linear-gradient(rgba(0,229,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.025) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      <header style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(0,229,255,0.10)', background: 'rgba(3,6,15,.96)', backdropFilter: 'blur(24px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, gap: 8 }}>
          <div onClick={() => switchTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00e5ff,#0066ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: C.bg }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{ fontSize: 9, color: C.accent, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>DEX</span>
          </div>

          <nav style={{ display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none', flex: 1, justifyContent: 'center', padding: '0 8px' }}>
            {headerTabs.map(t => {
              const active = tab === t.id || (tab === 'token' && t.id === 'markets');
              return (
                <button
                  key={t.id}
                  onClick={() => switchTab(t.id)}
                  onMouseEnter={t.id === 'launches' ? prefetchLaunches : undefined}
                  style={{ background: active ? 'rgba(0,229,255,.09)' : 'transparent', border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent', borderRadius: 8, padding: '5px 10px', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >{t.label}</button>
              );
            })}
          </nav>

          <button
            onClick={openWallet}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: wallet.isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)', border: wallet.isConnected ? '1px solid rgba(0,229,255,.3)' : 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: wallet.isConnected ? C.accent : C.bg, whiteSpace: 'nowrap' }}
          >
            {wallet.isConnected ? (
              <><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />{displayAddress}</>
            ) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '20px 16px 100px', boxSizing: 'border-box', width: '100%', minHeight: 'calc(100vh - 56px)', overflowX: 'hidden' }}>
        {tab === 'swap' && <SwapWidget {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} jupiterLoading={jupiterLoading} onGoToToken={goToToken} />}
        {tab === 'markets' && <Markets coins={coins} loading={loading} onSelectCoin={goToToken} jupiterTokens={jupiterTokens} />}
        {tab === 'token' && selectedToken && (
          <TokenDetail {...sharedProps} coin={selectedToken} coins={coins} jupiterTokens={jupiterTokens} onBack={() => switchTab(prevTab === 'token' ? 'markets' : prevTab)} />
        )}
        {tab === 'launches' && <NewLaunches {...sharedProps} coins={coins} resetKey={launchesKey} />}
        {tab === 'buy' && <BuyCrypto coins={coins} walletAddress={wallet.walletAddress || ''} selectedCoinSymbol={selectedToken ? selectedToken.symbol : null} />}
        {tab === 'send' && <Send {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} />}
        {tab === 'portfolio' && (
          <Portfolio {...sharedProps} coins={coins} jupiterTokens={jupiterTokens} onSend={() => switchTab('send')} refreshKey={portfolioKey} onSelectToken={goToToken} />
        )}
      </main>

      <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(3,6,15,.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,229,255,.1)', padding: '8px 4px env(safe-area-inset-bottom)', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
        {navTabs.map(t => {
          const active = tab === t.id || (tab === 'token' && t.id === 'markets');
          return (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              onMouseEnter={t.id === 'launches' ? prefetchLaunches : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: active ? C.accent : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 700, padding: '4px 6px', minWidth: 52, minHeight: 44, justifyContent: 'center' }}
            >
              <div style={{ width: active ? 20 : 6, height: 2, borderRadius: 2, background: active ? C.accent : 'transparent', transition: 'width .2s', marginBottom: 4 }} />
              <span>{t.label}</span>
            </button>
          );
        })}
        <button
          onClick={openWallet}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: wallet.isConnected ? C.green : C.muted, fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 700, padding: '4px 6px', minWidth: 52, minHeight: 44, justifyContent: 'center' }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: wallet.isConnected ? C.green : C.muted, marginBottom: 4, boxShadow: wallet.isConnected ? '0 0 6px ' + C.green : 'none' }} />
          <span>{wallet.isConnected ? displayAddress : 'Connect'}</span>
        </button>
      </nav>

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}
