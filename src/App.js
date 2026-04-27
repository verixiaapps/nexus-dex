import React, { useState, useEffect } from ‘react’;
import { useWallet } from ‘@solana/wallet-adapter-react’;
import { WalletMultiButton } from ‘@solana/wallet-adapter-react-ui’;
import SwapWidget from ‘./components/SwapWidget’;
import Markets from ‘./components/Markets’;
import BuyCrypto from ‘./components/BuyCrypto’;
import Portfolio from ‘./components/Portfolio’;

const C = {
bg: ‘#03060f’,
card: ‘#080d1a’,
border: ‘rgba(0,229,255,0.10)’,
accent: ‘#00e5ff’,
green: ‘#00ffa3’,
red: ‘#ff3b6b’,
text: ‘#cdd6f4’,
muted: ‘#586994’,
};

export default function App() {
const [tab, setTab] = useState(‘swap’);
const [coins, setCoins] = useState([]);
const [loading, setLoading] = useState(true);
const { connected } = useWallet();

const fetchMarkets = async () => {
try {
const ids = ‘bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,avalanche-2,chainlink,uniswap,matic-network,toncoin’;
const res = await fetch(
‘https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=’ + ids + ‘&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d’
);
const data = await res.json();
if (Array.isArray(data)) setCoins(data);
} catch (e) {
console.error(‘Market fetch error:’, e);
}
setLoading(false);
};

useEffect(() => {
fetchMarkets();
const interval = setInterval(fetchMarkets, 30000);
return () => clearInterval(interval);
}, []);

const tabs = [
{ id: ‘swap’, label: ‘Swap’ },
{ id: ‘markets’, label: ‘Markets’ },
{ id: ‘buy’, label: ‘Buy Crypto’ },
{ id: ‘portfolio’, label: ‘Portfolio’ },
];

return (
<div style={{ minHeight: ‘100vh’, background: C.bg, color: C.text, fontFamily: ‘Syne, sans-serif’ }}>

```
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
      maxWidth: 1400, margin: '0 auto', padding: '0 24px',
      display: 'flex', alignItems: 'center', gap: 16, height: 64
    }}>
      <div onClick={() => setTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9,
          background: 'linear-gradient(135deg,#00e5ff,#0066ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15,
          color: C.bg, boxShadow: '0 0 24px rgba(0,229,255,.4)'
        }}>N</div>
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: 3, color: '#fff' }}>NEXUS</span>
        <span style={{
          fontSize: 10, color: C.accent,
          background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)',
          borderRadius: 4, padding: '2px 6px', letterSpacing: .8, fontWeight: 600
        }}>DEX</span>
      </div>

      <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
        {tabs.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: tab === id ? 'rgba(0,229,255,.09)' : 'transparent',
            border: tab === id ? '1px solid rgba(0,229,255,.2)' : '1px solid transparent',
            borderRadius: 8, padding: '6px 14px',
            color: tab === id ? C.accent : C.muted,
            fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', letterSpacing: .4, transition: 'all .15s'
          }}>{label}</button>
        ))}
      </nav>

      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        {coins.slice(0, 3).map(c => (
          <span key={c.id} style={{ display: 'flex', gap: 5, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', color: C.muted }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>{c.symbol && c.symbol.toUpperCase()}</span>
            <span style={{ color: (c.price_change_percentage_24h || 0) >= 0 ? C.green : C.red }}>
              {'$' + (c.current_price || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          </span>
        ))}
      </div>

      <div style={{ flexShrink: 0 }}>
        <WalletMultiButton />
      </div>
    </div>
  </header>

  <main style={{ position: 'relative', zIndex: 1, maxWidth: 1400, margin: '0 auto', padding: '36px 24px 80px' }}>
    {tab === 'swap' && <SwapWidget coins={coins} loading={loading} />}
    {tab === 'markets' && <Markets coins={coins} loading={loading} onSelectCoin={() => setTab('swap')} />}
    {tab === 'buy' && <BuyCrypto coins={coins} />}
    {tab === 'portfolio' && <Portfolio coins={coins} />}
  </main>

  <footer style={{ borderTop: '1px solid rgba(0,229,255,0.10)', padding: '20px 24px' }}>
    <div style={{
      maxWidth: 1400, margin: '0 auto',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: 'linear-gradient(135deg,#00e5ff,#0055ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, color: C.bg
        }}>N</div>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: 2, color: '#fff' }}>NEXUS DEX</span>
      </div>
      <span style={{ fontSize: 11, color: '#2e3f5e', fontFamily: 'JetBrains Mono, monospace' }}>
        2025 Nexus DEX - Non-custodial - 0.3% fee paid by user
      </span>
    </div>
  </footer>
</div>
```

);
}