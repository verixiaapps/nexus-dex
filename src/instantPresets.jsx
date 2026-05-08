/**
 * NEXUS DEX -- Shared Instant Buy/Sell Presets
 *
 * Single source of truth:
 *   WalletContext.js owns preset state through:
 *     presets = { buy: [...], sell: [...] }
 *     setPresets(nextPresets)
 *
 * Defaults match WalletContext.js:
 *   buy  = [25, 50, 100, 250, 500]
 *   sell = [50, 100]
 */

import React, { useState, useEffect } from 'react';
import { useNexusWallet } from '../WalletContext.js';

export const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
export const DEFAULT_SELL_PRESETS = [50, 100];

function validBuy(arr) {
  return Array.isArray(arr)
    && arr.length === 5
    && arr.every(function (n) {
      return typeof n === 'number' && Number.isFinite(n) && n > 0;
    });
}

function validSell(arr) {
  return Array.isArray(arr)
    && arr.length >= 1
    && arr.length <= 4
    && arr.every(function (n) {
      return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100;
    });
}

function normalizePresets(presets) {
  var buy = presets && validBuy(presets.buy) ? presets.buy : DEFAULT_BUY_PRESETS;
  var sell = presets && validSell(presets.sell) ? presets.sell : DEFAULT_SELL_PRESETS;
  return { buy: buy, sell: sell };
}

export function useInstantPresets() {
  const wallet = useNexusWallet();
  const normalized = normalizePresets(wallet.presets);

  function setBuyPresets(arr) {
    if (!validBuy(arr)) return false;
    wallet.setPresets({
      buy: arr,
      sell: normalized.sell,
    });
    return true;
  }

  function setSellPresets(arr) {
    if (!validSell(arr)) return false;
    wallet.setPresets({
      buy: normalized.buy,
      sell: arr,
    });
    return true;
  }

  return {
    buyPresets: normalized.buy,
    sellPresets: normalized.sell,
    setBuyPresets: setBuyPresets,
    setSellPresets: setSellPresets,
  };
}

export function InstantPresetsModal({ open, onClose }) {
  const { buyPresets, sellPresets, setBuyPresets, setSellPresets } = useInstantPresets();

  const [draftBuy, setDraftBuy] = useState(buyPresets.map(String));
  const [draftSell, setDraftSell] = useState(sellPresets.map(String));
  const [error, setError] = useState('');

  useEffect(function () {
    if (open) {
      setDraftBuy(buyPresets.map(String));
      setDraftSell(sellPresets.map(String));
      setError('');
    }
  }, [open, buyPresets, sellPresets]);

  if (!open) return null;

  function updateBuy(i, v) {
    var d = draftBuy.slice();
    d[i] = v;
    setDraftBuy(d);
  }

  function updateSell(i, v) {
    var d = draftSell.slice();
    d[i] = v;
    setDraftSell(d);
  }

  function save() {
    var bArr = draftBuy.map(function (s) { return parseFloat(s); });
    var sArr = draftSell.map(function (s) { return parseFloat(s); });

    if (!validBuy(bArr)) {
      setError('Buy presets must be 5 positive USD amounts');
      return;
    }

    if (!validSell(sArr)) {
      setError('Sell presets must be 1 to 4 percentages between 1 and 100');
      return;
    }

    setBuyPresets(bArr);
    setSellPresets(sArr);
    onClose();
  }

  function reset() {
    setDraftBuy(DEFAULT_BUY_PRESETS.map(String));
    setDraftSell(DEFAULT_SELL_PRESETS.map(String));
    setError('');
  }

  const C = {
    bg: '#0a0e1a',
    card: 'rgba(15,20,35,.95)',
    border: 'rgba(255,255,255,.08)',
    text: '#fff',
    muted: '#7a8194',
    accent: '#00e5ff',
    red: '#ff3b6b',
    green: '#00ffa3',
  };

  const overlayStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.7)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    overscrollBehavior: 'none',
  };

  const sheetStyle = {
    width: '100%',
    maxWidth: 480,
    background: C.card,
    color: C.text,
    border: '1px solid ' + C.border,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: '20px 18px calc(20px + env(safe-area-inset-bottom)) 18px',
    maxHeight: 'min(85vh, 85dvh)',
    overflowY: 'auto',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    background: 'rgba(255,255,255,.03)',
    border: '1px solid ' + C.border,
    color: C.text,
    fontSize: 16,
    fontWeight: 700,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    fontSize: 11,
    color: C.muted,
    fontWeight: 700,
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={function (e) { e.stopPropagation(); }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 14px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Customize Instant Trade</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: 4 }}>x</button>
        </div>

        <p style={{ fontSize: 12, color: C.muted, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
          Set the USD amounts shown on instant buy buttons. Sell presets are percentages of your token balance.
        </p>

        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Buy amounts (USD)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {draftBuy.map(function (val, i) {
              return (
                <div key={'buy-' + i} style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, fontSize: 14, fontWeight: 700, pointerEvents: 'none' }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={val}
                    onChange={function (e) { updateBuy(i, e.target.value); }}
                    style={Object.assign({}, inputStyle, { paddingLeft: 22, textAlign: 'center' })}
                    min="1"
                    step="any"
                  />
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
            The first three appear on token cards. All five appear on token detail pages.
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Sell percentages</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {draftSell.map(function (val, i) {
              return (
                <div key={'sell-' + i} style={{ position: 'relative' }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={val}
                    onChange={function (e) { updateSell(i, e.target.value); }}
                    style={Object.assign({}, inputStyle, { paddingRight: 22, textAlign: 'center' })}
                    min="1"
                    max="100"
                    step="any"
                  />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, fontSize: 14, fontWeight: 700, pointerEvents: 'none' }}>%</span>
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ padding: 10, background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.35)', borderRadius: 10, color: C.red, fontSize: 12, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={reset} style={{ flex: 1, padding: 14, borderRadius: 12, border: '1px solid ' + C.border, background: 'transparent', color: C.muted, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Reset
          </button>
          <button onClick={save} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function PresetsEditButton({ size, color, label, style }) {
  const [open, setOpen] = useState(false);
  const px = size || 32;

  return (
    <React.Fragment>
      <button
        onClick={function () { setOpen(true); }}
        title={label || 'Edit instant trade presets'}
        aria-label={label || 'Edit instant trade presets'}
        style={Object.assign({
          width: px,
          height: px,
          borderRadius: 8,
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.08)',
          color: color || '#7a8194',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          padding: 0,
          touchAction: 'manipulation',
        }, style || {})}
      >
        <svg width={Math.round(px * 0.5)} height={Math.round(px * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
      <InstantPresetsModal open={open} onClose={function () { setOpen(false); }} />
    </React.Fragment>
  );
}