import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';

/* ============================================================================
 * NEXUS DEX -- Hyperliquid Perps Trading Interface
 * Non-custodial. User signs locally. Hyperliquid executes.
 * 
 * Builder Code (Nexus DEX): 0x4e65787573444558000000000000000000000000000000000000000000000000
 * Max Fee Rate: 0.05% (0.0005)
 * 
 * Data: Hyperliquid Info API via backend proxy /api/hyperliquid
 * Trading: Hyperliquid Exchange API via backend proxy /api/hyperliquid/exchange
 * ========================================================================= */

const BUILDER_CODE = '0x4e65787573444558000000000000000000000000000000000000000000000000';
const MAX_FEE_RATE = '0.0005';

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
  { id: 'ETH', base: 'ETH', icon: '⟠', leverage: 50 },
  { id: 'BTC', base: 'BTC', icon: '₿', leverage: 50 },
  { id: 'SOL', base: 'SOL', icon: '◎', leverage: 20 },
  { id: 'ARB', base: 'ARB', icon: '⟐', leverage: 20 },
  { id: 'OP', base: 'OP', icon: '◈', leverage: 15 },
  { id: 'LINK', base: 'LINK', icon: '⬡', leverage: 20 },
  { id: 'MATIC', base: 'POL', icon: '⬢', leverage: 20 },
  { id: 'AVAX', base: 'AVAX', icon: '🔺', leverage: 15 },
];

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => { _bodyLockCount = Math.max(0, _bodyLockCount - 1); if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked'); };
  }, [open]);
}

function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  n = Number(n);
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

/* ============================================================================
 * Hyperliquid Wallet (client-side only — non-custodial)
 * ========================================================================= */
function generateHlWallet() {
  try {
    const { ethers } = require('ethers');
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase || null,
    };
  } catch {
    return null;
  }
}

function encryptHlWallet(privateKey, signature) {
  try {
    const key = signature.slice(0, 32);
    let encrypted = '';
    for (let i = 0; i < privateKey.length; i++) {
      encrypted += String.fromCharCode(privateKey.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(encrypted);
  } catch {
    return null;
  }
}

function decryptHlWallet(encrypted, signature) {
  try {
    const key = signature.slice(0, 32);
    const decoded = atob(encrypted);
    let decrypted = '';
    for (let i = 0; i < decoded.length; i++) {
      decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return decrypted;
  } catch {
    return null;
  }
}

function getStoredHlWallet(signature) {
  try {
    const stored = localStorage.getItem('nexus_hl_wallet');
    if (!stored) return null;
    const data = JSON.parse(stored);
    const pk = decryptHlWallet(data.encrypted, signature);
    return pk ? { address: data.address, privateKey: pk } : null;
  } catch {
    return null;
  }
}

function storeHlWallet(address, privateKey, signature) {
  try {
    const encrypted = encryptHlWallet(privateKey, signature);
    if (!encrypted) return false;
    localStorage.setItem('nexus_hl_wallet', JSON.stringify({ address, encrypted }));
    return true;
  } catch {
    return false;
  }
}

/* ============================================================================
 * Hyperliquid API helpers
 * ========================================================================= */
async function hyperliquidRequest(body, isExchange = false) {
  const endpoint = isExchange ? '/api/hyperliquid/exchange' : '/api/hyperliquid';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hyperliquid request failed');
  return data;
}

async function fetchMarketData() {
  try {
    const [meta, prices] = await Promise.all([
      hyperliquidRequest({ type: 'meta' }),
      hyperliquidRequest({ type: 'allMids' }),
    ]);

    const universe = (meta.universe || []).map((u, i) => ({
      name: u.name || 'Unknown',
      index: i,
      maxLeverage: u.maxLeverage || 50,
    }));

    return PERPS_PAIRS.map(p => {
      const info = universe.find(u => u.name === p.id);
      const price = prices && prices[p.id] ? parseFloat(prices[p.id]) : 0;
      return {
        ...p,
        price: price || p.price || 0,
        change: 0,
        leverage: info ? Math.min(info.maxLeverage, p.leverage) : p.leverage,
      };
    });
  } catch {
    return PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0 }));
  }
}

async function placeOrder({ privateKey, pairIndex, isLong, amount, leverage }) {
  try {
    const { ethers } = require('ethers');
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();

    const orderRequest = {
      type: 'order',
      orders: [{
        asset: pairIndex,
        isBuy: isLong,
        limitPx: 0,
        sz: Number(amount),
        leverage: Number(leverage),
        orderType: { market: {} },
        reduceOnly: false,
        cloid: null,
      }],
      grouping: 'na',
      builder: BUILDER_CODE,
    };

    const signedOrder = await wallet.signTypedData(
      {
        name: 'Exchange',
        version: '1',
        chainId: 1337,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      {
        Agent: [
          { name: 'source', type: 'string' },
          { name: 'connectionId', type: 'bytes32' },
        ],
      },
      {
        source: 'a',
        connectionId: ethers.constants.HashZero,
      }
    );

    const payload = {
      action: orderRequest,
      signature: {
        r: signedOrder.slice(0, 66),
        s: '0x' + signedOrder.slice(66, 130),
        v: parseInt(signedOrder.slice(130, 132), 16),
      },
      nonce: timestamp,
    };

    const result = await hyperliquidRequest(payload, true);
    return result;
  } catch (e) {
    throw new Error(e.message || 'Order failed');
  }
}

/* ============================================================================
 * UI Components
 * ========================================================================= */
function PairCard({ pair, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: active ? 'rgba(0,229,255,.08)' : C.card2,
      border: '1px solid ' + (active ? 'rgba(0,229,255,.35)' : C.border),
      borderRadius: 14, padding: 14, cursor: 'pointer',
      transition: 'all .15s', flex: 1, minWidth: 120,
    }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{pair.icon}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{pair.base}-PERP</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{fmt(pair.price, 2)}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: (pair.change || 0) >= 0 ? C.green : C.red }}>{pct(pair.change)}</span>
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Up to {pair.leverage}x</div>
    </div>
  );
}

function TradeDrawer({ open, onClose, pair, onConnectWallet }) {
  const { connected } = useWallet();
  const { activeWalletKind, privyEmbeddedSol, loginPrivy } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide] = useState('long');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [status, setStatus] = useState('idle');
  const [hlWallet, setHlWallet] = useState(null);
  const [creatingWallet, setCreatingWallet] = useState(false);

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setAmount('');
      setStatus('idle');
      const stored = localStorage.getItem('nexus_hl_wallet');
      if (stored) {
        try {
          const data = JSON.parse(stored);
          setHlWallet({ address: data.address });
        } catch {
          setHlWallet(null);
        }
      }
    }
  }, [open]);

  const isLong = side === 'long';
  const entryPrice = pair?.price || 0;
  const positionSize = (parseFloat(amount) || 0) * leverage;
  const liqPrice = isLong
    ? entryPrice * (1 - 0.9 / leverage)
    : entryPrice * (1 + 0.9 / leverage);

  const createWallet = async () => {
    setCreatingWallet(true);
    try {
      const newWallet = generateHlWallet();
      if (!newWallet) throw new Error('Failed to generate wallet');
      const sig = 'nexus-sig-' + Date.now();
      storeHlWallet(newWallet.address, newWallet.privateKey, sig);
      setHlWallet({ address: newWallet.address });
    } catch (e) {
      console.error('Wallet creation failed:', e);
    }
    setCreatingWallet(false);
  };

  const execute = async () => {
    if (!wcon) {
      loginPrivy?.() || onConnectWallet?.();
      return;
    }
    if (!hlWallet) {
      await createWallet();
      return;
    }

    setStatus('loading');
    try {
      const stored = localStorage.getItem('nexus_hl_wallet');
      const data = JSON.parse(stored);
      const sig = 'nexus-sig-' + Date.now();
      const pk = decryptHlWallet(data.encrypted, sig);
      if (!pk) throw new Error('Could not decrypt wallet');

      const pairIndex = PERPS_PAIRS.findIndex(p => p.id === pair.id);

      await placeOrder({
        privateKey: pk,
        pairIndex: pairIndex >= 0 ? pairIndex : 0,
        isLong,
        amount: parseFloat(amount) || 0,
        leverage,
      });

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 2000);
    } catch (e) {
      console.error('Trade failed:', e);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  if (!open || !pair) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.85)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 520, zIndex: 401, background: C.card, borderTop: '2px solid ' + C.borderHi, borderRadius: '20px 20px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '16px 20px' }}>
          <div style={{ width: 40, height: 4, background: C.muted2, borderRadius: 2, margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>{pair.icon}</span>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{pair.base}-PERP</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Up to {pair.leverage}x · 0.05% fee · Powered by Hyperliquid</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 26, cursor: 'pointer' }}>x</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px calc(env(safe-area-inset-bottom) + 24px)' }}>
          {!hlWallet && wcon && (
            <div style={{ marginBottom: 16, padding: 14, background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.25)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ color: C.privy || C.purple, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Create your Hyperliquid Wallet</div>
              <button onClick={createWallet} disabled={creatingWallet} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
                {creatingWallet ? 'Creating...' : 'Create Wallet'}
              </button>
            </div>
          )}
          {hlWallet && (
            <div style={{ marginBottom: 16, padding: 10, background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.15)', borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>HYPERLIQUID WALLET</div>
                  <div style={{ fontSize: 11, color: C.text, fontFamily: 'monospace' }}>{hlWallet.address.slice(0, 6)}...{hlWallet.address.slice(-4)}</div>
                </div>
                <div style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>Connected</div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setSide('long')} style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid ' + (isLong ? C.green : C.border), background: isLong ? 'rgba(0,255,163,.10)' : C.card2, color: isLong ? C.green : C.muted, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>↑ Long</button>
            <button onClick={() => setSide('short')} style={{ flex: 1, padding: 12, borderRadius: 12, border: '1px solid ' + (!isLong ? C.red : C.border), background: !isLong ? 'rgba(255,59,107,.10)' : C.card2, color: !isLong ? C.red : C.muted, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>↓ Short</button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>LEVERAGE</span><span style={{ fontSize: 12, color: C.accent, fontWeight: 800 }}>{leverage}x</span></div>
            <input type="range" min="1" max={pair.leverage} value={leverage} onChange={e => setLeverage(Number(e.target.value))} style={{ width: '100%', accentColor: C.accent, height: 6 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>ORDER SIZE (USD)</div>
            <div style={{ background: C.card2, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 18 }}>$</span>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 22, fontWeight: 700, color: '#fff', outline: 'none' }} />
            </div>
          </div>
          {amount && parseFloat(amount) > 0 && (
            <div style={{ background: C.card2, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              {[
                ['Position Size', fmt(positionSize)],
                ['Entry Price', fmt(entryPrice, 2)],
                ['Est. Liquidation', fmt(liqPrice, 4)],
                ['Fee (0.05%)', fmt(parseFloat(amount) * 0.0005)],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                  <span style={{ color: C.muted }}>{l}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {!wcon ? (
            <button onClick={() => { loginPrivy?.() || onConnectWallet?.(); }} style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#9945ff,#7c3aed)', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 54 }}>Connect Wallet</button>
          ) : (
            <button onClick={execute} disabled={!amount || status === 'loading'} style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: status === 'success' ? 'linear-gradient(135deg,#00ffa3,#00b36b)' : status === 'error' ? C.sellGrad : isLong ? C.buyGrad : C.sellGrad, color: '#fff', fontWeight: 800, fontSize: 16, cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 54 }}>
              {status === 'loading' ? 'Confirming...' : status === 'success' ? 'Order Placed!' : status === 'error' ? 'Order Failed — Retry' : isLong ? 'Go Long ↑' : 'Go Short ↓'}
            </button>
          )}
          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10 }}>Powered by Hyperliquid</div>
        </div>
      </div>
    </>
  );
}

export default function PerpsTrade({ onConnectWallet }) {
  const [marketData, setMarketData] = useState(PERPS_PAIRS.map(p => ({ ...p, price: 0, change: 0 })));
  const [activePair, setActivePair] = useState(marketData[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const data = await fetchMarketData();
      if (alive) setMarketData(data);
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  const openTrade = (pair) => {
    setActivePair(pair);
    setDrawerOpen(true);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Perps</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Trade with up to 50x leverage · 0.05% fee · Powered by Hyperliquid</p>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        {marketData.map(p => (
          <PairCard key={p.id} pair={p} active={activePair?.id === p.id} onClick={() => setActivePair(p)} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {marketData.map(p => (
          <button key={p.id} onClick={() => openTrade(p)} style={{ padding: 16, borderRadius: 14, background: C.card, border: '1px solid ' + C.border, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
            <span style={{ fontSize: 28 }}>{p.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: '#fff', fontSize: 14 }}>{p.base}-PERP</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{p.leverage}x leverage</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{fmt(p.price, 2)}</div>
              <div style={{ color: (p.change || 0) >= 0 ? C.green : C.red, fontSize: 12, fontWeight: 600 }}>{pct(p.change)}</div>
            </div>
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Max Leverage', value: '50x' },
          { label: 'Fee', value: '0.05%' },
          { label: 'Powered by', value: 'Hyperliquid' },
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