import React, { useState, useEffect } from 'react';
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
  bg: '#03060f',
  card: '#080d1a',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff',
  green: '#00ffa3',
  red: '#ff3b6b',
  text: '#cdd6f4',
  muted: '#586994',
};

function WalletModal({ open, onClose }) {
  const { select, wallets, connect, disconnect, connected, publicKey } = useWallet();
  const { open: openWeb3Modal } = useWeb3Modal();
  const { isConnected: evmConnected } = useAccount();
  const { disconnect: evmDisconnect } = useDisconnect();

  const phantomWallet = wallets.find(w => w.adapter.name === 'Phantom');

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.85)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 501,
        background: '#080d1a', borderTop: '2px solid rgba(0,229,255,.2)',
        borderRadius: '20px 20px 0 0', padding: '24px 24px 48px',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)', animation: 'slideUp .25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        <div style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 24px' }} />
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
            {connected || evmConnected ? 'Wallet Connected' : 'Connect Wallet'}
          </div>
          <div style={{ fontSize: 13, color: '#586994' }}>
            {connected && publicKey
              ? 'Phantom: ' + publicKey.toString().slice(0, 8) + '…' + publicKey.toString().slice(-8)
              : evmConnected ? 'Connected via WalletConnect'
              : 'Choose how to connect'}
          </div>
        </div>

        {(connected || evmConnected) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto' }}>
            <div style={{ background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 16, padding: '16px 24px', textAlign: 'center' }}>
              <div style={{ color: '#00ffa3', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Wallet Connected</div>
              <div style={{ color: '#586994', fontSize: 12 }}>
                {connected && publicKey ? publicKey.toString().slice(0, 16) + '...' : 'EVM wallet connected'}
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  if (connected) await disconnect();
                  if (evmConnected) evmDisconnect();
                  onClose();
                } catch (e) { console.error('Disconnect error:', e); }
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)',
                borderRadius: 16, padding: '16px 24px', cursor: 'pointer', width: '100%',
                color: '#ff3b6b', fontWeight: 700, fontSize: 15, fontFamily: 'Syne, sans-serif',
              }}
            >Disconnect Wallet</button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 16, padding: '14px 24px', cursor: 'pointer',
                color: '#586994', fontSize: 14, fontFamily: 'Syne, sans-serif',
              }}
            >Close</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400, margin: '0 auto' }}>
            <button
              onClick={async () => {
                try {
                  if (phantomWallet) {
                    await select(phantomWallet.adapter.name);
                    await connect();
                    onClose();
                  } else {
                    window.open('https://phantom.app', '_blank');
                    onClose();
                  }
                } catch (e) { console.error('Phantom connect error:', e); }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: 'rgba(153,69,255,.1)', border: '1px solid rgba(153,69,255,.3)',
                borderRadius: 16, padding: '18px 24px', cursor: 'pointer', width: '100%',
              }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,#9945ff,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>P</div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>Phantom</div>
                <div style={{ color: '#9945ff', fontSize: 13, marginTop: 2 }}>
                  {phantomWallet ? 'Solana wallet - detected' : 'Tap to install Phantom'}
                </div>
              </div>
            </button>

            <button
              onClick={() => { onClose(); setTimeout(() => openWeb3Modal(), 100); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: 'rgba(59,153,252,.1)', border: '1px solid rgba(59,153,252,.3)',
                borderRadius: 16, padding: '18px 24px', cursor: 'pointer', width: '100%',
              }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,#3b99fc,#0066cc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="https://avatars.githubusercontent.com/u/37784886" alt="WalletConnect" style={{ width: 32, height: 32, borderRadius: 8 }} onError={e => { e.target.style.display = 'none'; }} />
              </div>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>WalletConnect</div>
                <div style={{ color: '#3b99fc', fontSize: 13, marginTop: 2 }}>All wallets - stay on site</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState('swap');
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedToken, setSelectedToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [jupiterTokens, setJupiterTokens] = useState([]);
  const [jupiterLoading, setJupiterLoading] = useState(true);

  const { publicKey, connected: solConnected } = useWallet();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();

  const isConnected = solConnected || evmConnected;
  const isSolanaConnected = solConnected;
  const walletAddress = solConnected && publicKey
    ? publicKey.toString()
    : evmConnected && evmAddress ? evmAddress : null;

  const displayAddress = walletAddress
    ? walletAddress.slice(0, 4) + '…' + walletAddress.slice(-4)
    : null;

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
      } catch (e) {
        console.log('Jupiter token fetch failed:', e);
      }
      setJupiterLoading(false);
    };
    fetchJupiterTokens();
  }, []);

  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near,aptos,sui,arbitrum,optimism,injective-protocol,render-token,bonk,jupiter-exchange-solana,raydium,pyth-network,jito-governance-token,helium,the-sandbox';
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d`);
        const data = await res.json();
        if (Array.isArray(data)) setCoins(data);
      } catch (e) {
        console.error('Market fetch error:', e);
      }
      setLoading(false);
    };
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 30000);
    return () => clearInterval(interval);
  }, []);

  const goToToken = coin => { setSelectedToken(coin); setTab('token'); };
  const openWallet = () => setWalletModalOpen(true);

  const navTabs = [
    { id: 'swap', label: 'Swap', icon: 'S' },
    { id: 'markets', label: 'Markets', icon: 'M' },
    { id: 'launches', label: 'Launches', icon: 'L' },
    { id: 'send', label: 'Send', icon: 'T' },
    { id: 'portfolio', label: 'Wallet', icon: 'W' },
  ];

  const headerTabs = [
    { id: 'swap', label: 'Swap' },
    { id: 'markets', label: 'Markets' },
    { id: 'launches', label: 'New Launches' },
    { id: 'buy', label: 'Buy Crypto' },
    { id: 'send', label: 'Send' },
    { id: 'portfolio', label: 'Portfolio' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif' }}>
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(0,229,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.025) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        borderBottom: '1px solid rgba(0,229,255,0.10)',
        background: 'rgba(3,6,15,.96)', backdropFilter: 'blur(24px)',
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto', padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 56, gap: 8,
        }}>
          <div
            onClick={() => setTab('swap')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}
          >
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
                  onClick={() => setTab(t.id)}
                  style={{
                    background: active ? 'rgba(0,229,255,.09)' : 'transparent',
                    border: active ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
                    borderRadius: 8, padding: '5px 10px',
                    color: active ? C.accent : C.muted,
                    fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12,
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >{t.label}</button>
              );
            })}
          </nav>

          <button
            onClick={openWallet}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              background: isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)',
              border: isConnected ? '1px solid rgba(0,229,255,.3)' : 'none',
              borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
              fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12,
              color: isConnected ? C.accent : C.bg, whiteSpace: 'nowrap',
            }}
          >
            {isConnected ? (
              <><div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />{displayAddress}</>
            ) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto', padding: '20px 16px 100px' }}>
        {tab === 'swap' && (
          <SwapWidget
            coins={coins}
            jupiterTokens={jupiterTokens}
            jupiterLoading={jupiterLoading}
            onGoToToken={goToToken}
            onConnectWallet={openWallet}
            isConnected={isConnected}
            isSolanaConnected={isSolanaConnected}
            walletAddress={walletAddress}
          />
        )}
        {tab === 'markets' && (
          <Markets coins={coins} loading={loading} onSelectCoin={goToToken} />
        )}
        {tab === 'token' && selectedToken && (
          <TokenDetail
            coin={selectedToken}
            coins={coins}
            jupiterTokens={jupiterTokens}
            onBack={() => setTab('markets')}
            onConnectWallet={openWallet}
            isConnected={isConnected}
            isSolanaConnected={isSolanaConnected}
            walletAddress={walletAddress}
          />
        )}
        {tab === 'launches' && (
          <NewLaunches
            coins={coins}
            onConnectWallet={openWallet}
            isConnected={isConnected}
            isSolanaConnected={isSolanaConnected}
            walletAddress={walletAddress}
          />
        )}
        {tab === 'buy' && (
          <BuyCrypto
            coins={coins}
            walletAddress={walletAddress || ''}
            selectedCoinSymbol={selectedToken ? selectedToken.symbol : null}
          />
        )}
        {tab === 'send' && (
          <Send
            coins={coins}
            jupiterTokens={jupiterTokens}
            onConnectWallet={openWallet}
            isConnected={isConnected}
            isSolanaConnected={isSolanaConnected}
            walletAddress={walletAddress}
          />
        )}
        {tab === 'portfolio' && (
          <Portfolio
            coins={coins}
            jupiterTokens={jupiterTokens}
            onSend={() => setTab('send')}
            onConnectWallet={openWallet}
            isConnected={isConnected}
            isSolanaConnected={isSolanaConnected}
            walletAddress={walletAddress}
          />
        )}
      </main>

      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(3,6,15,.96)', backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0,229,255,.1)',
        padding: '8px 4px env(safe-area-inset-bottom)',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      }}>
        {navTabs.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: active ? C.accent : C.muted,
                fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
                padding: '4px 6px', minWidth: 44, minHeight: 44, justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 800 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
        <button
          onClick={openWallet}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: isConnected ? C.green : C.muted,
            fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
            padding: '4px 6px', minWidth: 44, minHeight: 44, justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 16 }}>+</span>
          <span>{isConnected ? 'Connected' : 'Connect'}</span>
        </button>
      </nav>

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}
