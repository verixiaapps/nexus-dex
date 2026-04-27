import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import SwapWidget from './components/SwapWidget';
import Markets from './components/Markets';
import BuyCrypto from './components/BuyCrypto';
import Portfolio from './components/Portfolio';

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
  const { publicKey } = useWallet();

  const fetchMarkets = async () => {
    try {
      const ids = 'bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,avalanche-2,chainlink,uniswap,matic-network,toncoin,shiba-inu,litecoin,polkadot,cosmos,near,aptos,sui,arbitrum,optimism,injective-protocol,render-token,helium,bonk,jupiter-exchange-solana,raydium,orca,pyth-network,jito-governance-token';
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

  const tabs = [
    { id: 'swap', label: 'Swap' },
    { id: 'markets', label: 'Markets' },
    { id: 'buy', label: 'Buy Crypto' },
    { id: 'portfolio', label: 'Portfolio' },
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
        background: 'rgba(3,6,15,.94)', backdropFilter: 'blur(24px)'
      }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto', padding: '0 16px',
          display: 'flex', alignItems: 'center', gap: 12, height: 60,
          flexWrap: 'nowrap', overflowX: 'auto',
        }}>
          <div onClick={() => setTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'linear-gradient(135deg,#00e5ff,#0066ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, color: C.bg,
            }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{
              fontSize: 9, color: C.accent,
              background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)',
              borderRadius: 4, padding: '1px 5px', fontWeight: 600
            }}>DEX</span>
          </div>

          <nav style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}>
            {tabs.map(function(t) {
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  background: tab === t.id ? 'rgba(0,229,255,.09)' : 'transparent',
                  border: tab === t.id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
                  borderRadius: 8, padding: '5px 10px',
                  color: tab === t.id ? C.accent : C.muted,
                  fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>{t.label}</button>
              );
            })}
          </nav>

          <div style={{ flexShrink: 0 }}>
            <WalletMultiButton style={{
              height: 36, fontSize: 12, padding: '0 12px',
              background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
              color: '#03060f', border: 'none', borderRadius: 8,
              fontFamily: 'Syne, sans-serif', fontWeight: 700,
            }} />
          </div>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1400, margin: '0 auto', padding: '24px 16px 80px' }}>
        {tab === 'swap' && <SwapWidget coins={coins} loading={loading} />}
        {tab === 'markets' && <Markets coins={coins} loading={loading} onSelectCoin={() => setTab('swap')} />}
        {tab === 'buy' && <BuyCrypto coins={coins} walletAddress={publicKey ? publicKey.toString() : ''} />}
        {tab === 'portfolio' && <Portfolio coins={coins} />}
      </main>

      <footer style={{ borderTop: '1px solid rgba(0,229,255,0.10)', padding: '16px' }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 11, color: C.bg
            }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 2, color: '#fff' }}>NEXUS DEX</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              ['SWAP', 'swap'],
              ['MARKETS', 'markets'],
              ['BUY CRYPTO', 'buy'],
              ['PORTFOLIO', 'portfolio'],
            ].map(function(item) {
              return (
                <button key={item[0]} onClick={() => setTab(item[1])} style={{
                  fontSize: 10, color: C.accent,
                  background: 'rgba(0,229,255,.07)', border: '1px solid rgba(0,229,255,.2)',
                  borderRadius: 4, padding: '3px 8px', letterSpacing: .8, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                }}>{item[0]}</button>
              );
            })}
          </div>
          <span style={{ fontSize: 11, color: '#2e3f5e' }}>
            2025 Nexus DEX · 0.3% fee paid by user
          </span>
        </div>
      </footer>
    </div>
  );
}
