import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
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

function WalletModal({ open, onClose }) {
  const { wallets, connect } = useWallet();

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.8)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 501,
        background: '#080d1a', borderTop: '1px solid rgba(0,229,255,.2)',
        borderRadius: '20px 20px 0 0', padding: '24px 24px 40px',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
        animation: 'slideUp .25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        <div style={{ width: 40, height: 4, background: '#2e3f5e', borderRadius: 2, margin: '0 auto 24px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 6, textAlign: 'center' }}>Connect Wallet</div>
        <div style={{ fontSize: 12, color: '#586994', marginBottom: 24, textAlign: 'center' }}>Choose your wallet to get started</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {wallets.map(function(wallet) {
            return (
              <button key={wallet.adapter.name}
                onClick={function() { connect({ wallet }); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  background: 'rgba(153,69,255,.08)', border: '1px solid rgba(153,69,255,.2)',
                  borderRadius: 14, padding: '14px 20px', cursor: 'pointer', width: '100%',
                }}>
                <img src={wallet.adapter.icon} alt={wallet.adapter.name}
                  style={{ width: 36, height: 36, borderRadius: 8 }}
                  onError={function(e) { e.target.style.display = 'none'; }}
                />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{wallet.adapter.name}</div>
                  <div style={{ color: '#586994', fontSize: 12 }}>Solana wallet</div>
                </div>
                <div style={{ marginLeft: 'auto', color: '#9945ff', fontSize: 11, fontWeight: 600 }}>SOLANA</div>
              </button>
            );
          })}

          <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', padding: '4px 0' }}>— or connect EVM wallet —</div>

          <ConnectButton.Custom>
            {function({ openConnectModal }) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={function() { openConnectModal(); onClose(); }} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    background: 'rgba(245,130,49,.08)', border: '1px solid rgba(245,130,49,.2)',
                    borderRadius: 14, padding: '14px 20px', cursor: 'pointer', width: '100%',
                  }}>
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
                      alt="MetaMask" style={{ width: 36, height: 36 }}
                      onError={function(e) { e.target.style.display = 'none'; }}
                    />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>MetaMask</div>
                      <div style={{ color: '#586994', fontSize: 12 }}>EVM wallet</div>
                    </div>
                    <div style={{ marginLeft: 'auto', color: '#f58231', fontSize: 11, fontWeight: 600 }}>EVM</div>
                  </button>

                  <button onClick={function() { openConnectModal(); onClose(); }} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    background: 'rgba(59,153,252,.08)', border: '1px solid rgba(59,153,252,.2)',
                    borderRadius: 14, padding: '14px 20px', cursor: 'pointer', width: '100%',
                  }}>
                    <img src="https://avatars.githubusercontent.com/u/37784886"
                      alt="WalletConnect" style={{ width: 36, height: 36, borderRadius: 8 }}
                      onError={function(e) { e.target.style.display = 'none'; }}
                    />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>WalletConnect</div>
                      <div style={{ color: '#586994', fontSize: 12 }}>Any wallet via QR</div>
                    </div>
                    <div style={{ marginLeft: 'auto', color: '#3b99fc', fontSize: 11, fontWeight: 600 }}>ANY</div>
                  </button>
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState('swap');
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedToken, setSelectedToken] = useState(null);
  const [swapFromToken, setSwapFromToken] = useState(null);
  const [swapToToken, setSwapToToken] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [jupiterTokens, setJupiterTokens] = useState([]);
  const [jupiterLoading, setJupiterLoading] = useState(true);
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { publicKey, connected: solConnected } = useWallet();

  const isConnected = evmConnected || solConnected;
  const displayAddress = solConnected && publicKey
    ? publicKey.toString().slice(0, 4) + '...' + publicKey.toString().slice(-4)
    : evmConnected && evmAddress
    ? evmAddress.slice(0, 4) + '...' + evmAddress.slice(-4)
    : null;

  useEffect(function() {
    var fetchJupiterTokens = async function() {
      setJupiterLoading(true);
      try {
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 20000);
        var res = await fetch('https://token.jup.ag/all', { signal: controller.signal });
        clearTimeout(timeout);
        var data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          var mapped = data.map(function(t) {
            return {
              mint: t.address,
              symbol: t.symbol,
              name: t.name,
              decimals: t.decimals,
              logoURI: t.logoURI,
            };
          });
          setJupiterTokens(mapped);
        }
      } catch (e) {
        console.log('Jupiter token fetch failed');
      }
      setJupiterLoading(false);
    };
    fetchJupiterTokens();
  }, []);

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
          maxWidth: 1400, margin: '0 auto', padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56,
        }}>
          <div onClick={() => setTab('swap')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'linear-gradient(135deg,#00e5ff,#0066ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, color: C.bg,
            }}>N</div>
            <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: 2, color: '#fff' }}>NEXUS</span>
            <span style={{
              fontSize: 9, color: C.accent,
              background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)',
              borderRadius: 4, padding: '1px 5px', fontWeight: 600,
            }}>DEX</span>
          </div>

          <nav style={{ display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none', flex: 1, justifyContent: 'center', padding: '0 8px' }}>
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

          <button onClick={() => setWalletModalOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            background: isConnected ? 'rgba(0,229,255,.08)' : 'linear-gradient(135deg,#00e5ff,#0055ff)',
            border: isConnected ? '1px solid rgba(0,229,255,.3)' : 'none',
            borderRadius: 10, padding: '7px 12px', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12,
            color: isConnected ? C.accent : C.bg,
          }}>
            {isConnected ? (
              <>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />
                {displayAddress}
              </>
            ) : 'Connect'}
          </button>
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
            jupiterTokens={jupiterTokens}
            jupiterLoading={jupiterLoading}
            initialFromToken={swapFromToken}
            initialToToken={swapToToken}
            onTokensUsed={() => { setSwapFromToken(null); setSwapToToken(null); }}
            onGoToToken={goToToken}
            onConnectWallet={() => setWalletModalOpen(true)}
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
            onConnectWallet={() => setWalletModalOpen(true)}
          />
        )}
        {tab === 'buy' && (
          <BuyCrypto
            coins={coins}
            walletAddress={solConnected && publicKey ? publicKey.toString() : evmAddress || ''}
            selectedCoinSymbol={selectedToken ? selectedToken.symbol : null}
          />
        )}
        {tab === 'send' && (
          <Send
            coins={coins}
            jupiterTokens={jupiterTokens}
            onConnectWallet={() => setWalletModalOpen(true)}
          />
        )}
        {tab === 'portfolio' && (
          <Portfolio
            coins={coins}
            jupiterTokens={jupiterTokens}
            onSend={() => setTab('send')}
            onConnectWallet={() => setWalletModalOpen(true)}
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
              padding: '4px 8px', borderRadius: 8,
              transition: 'color .15s',
            }}>
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
        <button onClick={() => setWalletModalOpen(true)} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 600,
          padding: '4px 8px', color: isConnected ? C.green : C.muted,
        }}>
          <span style={{ fontSize: 18 }}>🔗</span>
          <span>{isConnected ? 'Connected' : 'Connect'}</span>
        </button>
      </nav>

      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </div>
  );
}
