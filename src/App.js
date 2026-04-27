import React, { useState, useEffect } from 'react';
import { useAccount, useConnectModal } from '@rainbow-me/rainbowkit';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import SwapWidget from './components/SwapWidget';
import Markets from './components/Markets';
import BuyCrypto from './components/BuyCrypto';
import Portfolio from './components/Portfolio';
import TokenDetail from './components/TokenDetail';
import Send from './components/Send';

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

export default function App() {
  const [tab, setTab] = useState('swap');
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedToken, setSelectedToken] = useState(null);
  const [swapFromToken, setSwapFromToken] = useState(null);
  const [swapToToken, setSwapToToken] = useState(null);
  const { address, isConnected } = useAccount();

  const fetchMarkets = async () => {
    try {
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near,aptos,sui,arbitrum,optimism,injective-protocol,render-token,bonk,jupiter-exchange-solana,raydium,pyth-network,jito-governance-token,helium,the-sandbox';
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids + '&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d'
      );
      const data = await res.json();
      if (Array.isArray(data)) setCoins(data);
    } catch (e) {
      console.error('Market fetch error:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 30000);
    return () => clearInterval(interval);
  }, []);

  const goToToken = function(coin) {
    setSelectedToken(coin);
    setTab('token');
  };

  const handleQuickBuy = function(coin) {
    setSelectedToken(coin);
    setTab('buy');
  };

  const tabs = [
    { id: 'swap', label: 'Swap', icon: '⇄' },
    { id: 'markets', label: 'Markets', icon: '📊' },
    { id: 'buy', label: 'Buy', icon: '💳' },
    { id: 'send', label: 'Send', icon: '➤' },
    { id: 'portfolio', label: 'Wallet', icon: '👛' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'Syne, sans-serif' }}>

      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(0,229,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.025) 1px,transparent 1px)',
        backgroundSize: '48px 48px'
      }} />

      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        borderBottom: '1px solid rgba(0,229,255,0.10)',
        background: 'rgba(3,6,15,.96)', backdropFilter: 'blur(24px)',
      }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto', padding: '0 12px',
          display: 'flex', alignItems: 'center', gap: 8, height: 56,
        }}>
          <div onClick={() => setTab('swap')} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', flexShrink: 0,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'linear-gradient(135deg,#00e5ff,#0066ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, color: C.bg,
            }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{
              fontSize: 9, color: C.accent,
              background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)',
              borderRadius: 4, padding: '1px 5px', fontWeight: 600,
            }}>DEX</span>
          </div>

          <nav style={{
            display: 'flex', gap: 2, flex: 1,
            overflowX: 'auto', scrollbarWidth: 'none',
          }}>
            {tabs.map(function(t) {
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  background: tab === t.id ? 'rgba(0,229,255,.09)' : 'transparent',
                  border: tab === t.id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
                  borderRadius: 8, padding: '5px 10px',
                  color: tab === t.id ? C.accent : C.muted,
                  fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}>{t.label}</button>
              );
            })}
          </nav>

          <div style={{ flexShrink: 0 }}>
            <ConnectButton
              showBalance={false}
              chainStatus="none"
              accountStatus="avatar"
            />
          </div>
        </div>
      </header>

      <main style={{
        position: 'relative', zIndex: 1,
        maxWidth: 1400, margin: '0 auto',
        padding: '20px 12px 100px',
      }}>
        {tab === 'swap' && (
          <SwapWidget
            coins={coins}
            loading={loading}
            initialFromToken={swapFromToken}
            initialToToken={swapToToken}
            onTokensUsed={() => { setSwapFromToken(null); setSwapToToken(null); }}
            onGoToToken={goToToken}
          />
        )}
        {tab === 'markets' && (
          <Markets
            coins={coins}
            loading={loading}
            onSelectCoin={goToToken}
          />
        )}
        {tab === 'token' && selectedToken && (
          <TokenDetail
            coin={selectedToken}
            coins={coins}
            onBack={() => setTab('markets')}
            onBuy={handleQuickBuy}
          />
        )}
        {tab === 'buy' && (
          <BuyCrypto
            coins={coins}
            walletAddress={address || ''}
            selectedCoinSymbol={selectedToken ? selectedToken.symbol : null}
          />
        )}
        {tab === 'send' && (
          <Send coins={coins} walletAddress={address || ''} />
        )}
        {tab === 'portfolio' && (
          <Portfolio
            coins={coins}
            walletAddress={address || ''}
            onSend={() => setTab('send')}
          />
        )}
      </main>

      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(3,6,15,.96)', backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0,229,255,.1)',
        padding: '8px 8px 24px',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      }}>
        {tabs.map(function(t) {
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t.id ? C.accent : C.muted,
              fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
              padding: '4px 6px', borderRadius: 8,
              transition: 'color .15s', flexShrink: 0,
            }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
        <div style={{ flexShrink: 0 }}>
          <ConnectButton
            showBalance={false}
            chainStatus="none"
            accountStatus="avatar"
          />
        </div>
      </nav>
    </div>
  );
}
