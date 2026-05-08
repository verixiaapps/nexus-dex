import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { useAccount } from 'wagmi';

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad: 'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
  purple: '#9945ff',
};

const PERPS_PAIRS = [
  { id: 'eth-perp', base: 'ETH', quote: 'USDC', icon: '⟠', price: 3102.45, change: 2.34, volume: '124.5M', leverage: 50 },
  { id: 'btc-perp', base: 'BTC', quote: 'USDC', icon: '₿', price: 68210.00, change: -1.21, volume: '89.2M', leverage: 30 },
  { id: 'sol-perp', base: 'SOL', quote: 'USDC', icon: '◎', price: 138.20, change: 5.67, volume: '45.1M', leverage: 25 },
  { id: 'arb-perp', base: 'ARB', quote: 'USDC', icon: '⟐', price: 0.89, change: -0.45, volume: '12.3M', leverage: 20 },
  { id: 'op-perp', base: 'OP', quote: 'USDC', icon: '◈', price: 2.34, change: 1.89, volume: '8.7M', leverage: 15 },
];

function useBodyLock(open) {
  let locked = React.useRef(0);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (locked.current === 0) document.body.classList.add('nexus-scroll-locked');
    locked.current++;
    return () => { locked.current = Math.max(0, locked.current - 1); if (locked.current === 0) document.body.classList.remove('nexus-scroll-locked'); };
  }, [open]);
}

function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  d = d != null ? d : (n >= 1000 ? 2 : n >= 1 ? 4 : 8);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(d);
  return '$' + n.toFixed(6);
}

function pct(n) {
  if (n == null || isNaN(n)) return '-';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function PairCard({ pair, active, onClick }) {
  const pos = pair.change >= 0;
  return (
    <div onClick={onClick} style={{
      background: active ? 'rgba(0,229,255,.08)' : C.card2,
      border: '1px solid ' + (active ? 'rgba(0,229,255,.35)' : C.border),
      borderRadius: 14, padding: 14, cursor: 'pointer',
      transition: 'all .15s', flex: 1, minWidth: 120,
    }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{pair.icon}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{pair.base}/{pair.quote}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{fmt(pair.price, 2)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: pos ? C.green : C.red }}>{pct(pair.change)}</span>
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Vol: {pair.volume}</div>
    </div>
  );
}

function TradeDrawer({ open, onClose, pair, onConnectWallet }) {
  const { publicKey, connected: solCon } = useWallet();
  const { isConnected: evmCon } = useAccount();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();

  const wcon = solCon || evmCon || (activeWalletKind === 'privy' && !!privyEmbeddedSol);
  const [side, setSide] = useState('long');
  const [orderType, setOrderType] = useState('market');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [sliderPct, setSliderPct] = useState(0);
  const [status, setStatus] = useState('idle');

  useBodyLock(open);

  useEffect(() => {
    if (open) { setAmount(''); setSliderPct(0); setStatus('idle'); }
  }, [open]);

  const isLong = side === 'long';
  const entryPrice = pair?.price || 0;
  const levAmount = (parseFloat(amount) || 0) * leverage;
  const liqPrice = isLong
    ? entryPrice * (1 - 0.9 / leverage)
    : entryPrice * (1 + 0.9 / leverage);

  const handleSlider = pct => {
    setSliderPct(pct);
    setAmount(pct > 0 ? '1000' : '');
  };

  const execute = () => {
    if (!wcon) { loginPrivy?.() || onConnectWallet?.(); return; }
    setStatus('loading');
    setTimeout(() => {
      setStatus('success');
      setTimeout(() => { setStatus('idle'); onClose(); }, 2000);
    }, 1500);
  };

  if (!open || !pair) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 520, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: 'min(92vh, 100dvh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>{pair.icon}</span>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{pair.base}/{pair.quote}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Up to {pair.leverage}x leverage · 0.13% fee</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer' }}>x</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 24px)' }}>
          {/* Side selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setSide('long')}
              style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid ' + (isLong ? C.green : C.border), background: isLong ? 'rgba(0,255,163,.10)' : C.card2, color: isLong ? C.green : C.muted, fontWeight: 800, fontSize: 15, fontFamily: 'Syne, sans-serif', cursor: 'pointer' }}>
              ↑ Long
            </button>
            <button onClick={() => setSide('short')}
              style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid ' + (!isLong ? C.red : C.border), background: !isLong ? 'rgba(255,59,107,.10)' : C.card2, color: !isLong ? C.red : C.muted, fontWeight: 800, fontSize: 15, fontFamily: 'Syne, sans-serif', cursor: 'pointer' }}>
              ↓ Short
            </button>
          </div>

          {/* Leverage */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>LEVERAGE</span>
              <span style={{ fontSize: 12, color: C.accent, fontWeight: 800 }}>{leverage}x</span>
            </div>
            <input type="range" min="1" max={pair.leverage} value={leverage}
              onChange={e => setLeverage(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent, height: 6 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted }}><span>1x</span><span>{pair.leverage}x</span></div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>PAY WITH</div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18 }}>$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
              <span style={{ color: C.muted, fontSize: 14, fontWeight: 600 }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => handleSlider(p)}
                  style={{ flex: 1, padding: '8px 4px', borderRadius: 8, border: '1px solid ' + (sliderPct === p ? C.accent : C.border), background: sliderPct === p ? 'rgba(0,229,255,.1)' : C.card2, color: sliderPct === p ? C.accent : C.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
                  {p === 100 ? 'MAX' : p + '%'}
                </button>
              ))}
            </div>
          </div>

          {/* Position info */}
          {amount && parseFloat(amount) > 0 && (
            <div style={{ background: C.card2, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              {[
                ['Position Size', fmt(levAmount)],
                ['Entry Price', fmt(entryPrice, 2)],
                ['Est. Liquidation', fmt(liqPrice, 4)],
                ['Fee (0.13%)', fmt(parseFloat(amount) * 0.0013)],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                  <span style={{ color: C.muted }}>{l}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Execute */}
          {!wcon ? (
            <button onClick={() => { loginPrivy?.() || onConnectWallet?.(); }}
              style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 54 }}>
              Connect Wallet
            </button>
          ) : (
            <button onClick={execute} disabled={!amount || status !== 'idle'}
              style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none',
                background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : isLong ? C.buyGrad : C.sellGrad,
                color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54 }}>
              {status === 'loading' ? 'Opening...' : status === 'success' ? 'Position Opened! ✓' : isLong ? 'Go Long ↑' : 'Go Short ↓'}
            </button>
          )}
          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10 }}>Powered by Orderly Network</div>
        </div>
      </div>
    </>
  );
}

export default function PerpsTrade({ onConnectWallet }) {
  const [activePair, setActivePair] = useState(PERPS_PAIRS[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openTrade = (pair) => {
    setActivePair(pair);
    setDrawerOpen(true);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', fontFamily: 'Syne, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Perps</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Trade with up to 50x leverage · 0.13% fee · Powered by Orderly</p>
      </div>

      {/* Pair cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {PERPS_PAIRS.map(p => (
          <PairCard key={p.id} pair={p} active={activePair?.id === p.id} onClick={() => setActivePair(p)} />
        ))}
      </div>

      {/* Quick trade buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {PERPS_PAIRS.map(p => (
          <button key={p.id}
            onClick={() => openTrade(p)}
            style={{
              padding: 16, borderRadius: 14,
              background: C.card, border: '1px solid ' + C.border,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              fontFamily: 'Syne, sans-serif', textAlign: 'left',
            }}>
            <span style={{ fontSize: 28 }}>{p.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: '#fff', fontSize: 14 }}>{p.base}/{p.quote}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{p.leverage}x leverage</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{fmt(p.price, 2)}</div>
              <div style={{ color: p.change >= 0 ? C.green : C.red, fontSize: 12, fontWeight: 600 }}>{pct(p.change)}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Your Fee', value: '0.13%' },
          { label: 'Settlement', value: 'USDC' },
        ].map(s => (
          <div key={s.label} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <TradeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} pair={activePair} onConnectWallet={onConnectWallet} />
    </div>
  );
}