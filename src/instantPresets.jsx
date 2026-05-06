/**
 * NEXUS DEX -- Shared Instant Buy/Sell Presets
 * 
 * Persists per-user customized preset amounts via localStorage.
 * Both NewLaunches TokenCards and InstantTrade (on TokenDetail) import
 * the `useInstantPresets` hook from here, so a change in either place
 * is immediately reflected in the other.
 *
 * Storage:
 *   nexus_buy_presets  -- JSON array, 5 USD numbers, default [25,50,100,250,500]
 *   nexus_sell_presets -- JSON array, 4 percentages,  default [25,50,75,100]
 *
 * NewLaunches TokenCards display the FIRST 3 of buy presets ($A / $B / $C).
 * InstantTrade displays all 5 buy presets and all 4 sell presets.
 *
 * Cross-component sync inside the same tab uses a custom event
 * `nexus:presets-changed`. Cross-tab sync uses the native `storage` event
 * (which fires only on other tabs, not the originating one).
 */

import React, { useState, useEffect, useCallback } from 'react';

const BUY_KEY      = 'nexus_buy_presets';
const SELL_KEY     = 'nexus_sell_presets';
const CHANGE_EVENT = 'nexus:presets-changed';

export const DEFAULT_BUY_PRESETS  = [25, 50, 100, 250, 500];
export const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];

/* ============================================================================
 * Storage helpers
 * ========================================================================= */
function readArray(key, fallback, validate) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    if (typeof validate === 'function' && !validate(parsed)) return fallback;
    return parsed;
  } catch (e) {
    return fallback;
  }
}

function writeArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // localStorage full / disabled in private browsing -- silently fail
  }
}

function validBuy(arr) {
  return arr.length === 5 && arr.every(function (n) { return typeof n === 'number' && n > 0 && isFinite(n); });
}
function validSell(arr) {
  return arr.length === 4 && arr.every(function (n) { return typeof n === 'number' && n > 0 && n <= 100 && isFinite(n); });
}

export function loadBuyPresets()  { return readArray(BUY_KEY,  DEFAULT_BUY_PRESETS,  validBuy);  }
export function loadSellPresets() { return readArray(SELL_KEY, DEFAULT_SELL_PRESETS, validSell); }

/* ============================================================================
 * Hook -- subscribes to changes from other instances within the same tab
 * (via custom event) and from other tabs (via native `storage` event).
 * ========================================================================= */
export function useInstantPresets() {
  const [buyPresets,  setBuyState]  = useState(loadBuyPresets);
  const [sellPresets, setSellState] = useState(loadSellPresets);

  useEffect(function () {
    function refresh() {
      setBuyState(loadBuyPresets());
      setSellState(loadSellPresets());
    }
    function onStorage(e) {
      if (!e || !e.key) { refresh(); return; }
      if (e.key === BUY_KEY)  setBuyState(loadBuyPresets());
      if (e.key === SELL_KEY) setSellState(loadSellPresets());
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, refresh);
    return function () {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, []);

  const setBuyPresets = useCallback(function (arr) {
    if (!validBuy(arr)) return false;
    writeArray(BUY_KEY, arr);
    setBuyState(arr);
    try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch (e) {}
    return true;
  }, []);

  const setSellPresets = useCallback(function (arr) {
    if (!validSell(arr)) return false;
    writeArray(SELL_KEY, arr);
    setSellState(arr);
    try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch (e) {}
    return true;
  }, []);

  return { buyPresets: buyPresets, sellPresets: sellPresets, setBuyPresets: setBuyPresets, setSellPresets: setSellPresets };
}

/* ============================================================================
 * Modal -- preset editor UI, used in both NewLaunches and InstantTrade.
 * ========================================================================= */
export function InstantPresetsModal({ open, onClose }) {
  const { buyPresets, sellPresets, setBuyPresets, setSellPresets } = useInstantPresets();
  const [draftBuy,  setDraftBuy]  = useState(buyPresets.map(String));
  const [draftSell, setDraftSell] = useState(sellPresets.map(String));
  const [error, setError] = useState('');

  // Re-sync drafts when modal opens or presets change externally.
  useEffect(function () {
    if (open) {
      setDraftBuy(buyPresets.map(String));
      setDraftSell(sellPresets.map(String));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function updateBuy(i, v)  { var d = draftBuy.slice();  d[i] = v; setDraftBuy(d); }
  function updateSell(i, v) { var d = draftSell.slice(); d[i] = v; setDraftSell(d); }

  function save() {
    var bArr = draftBuy.map(function (s) { return parseFloat(s); });
    var sArr = draftSell.map(function (s) { return parseFloat(s); });
    if (!validBuy(bArr))  { setError('Buy presets must be 5 positive USD amounts'); return; }
    if (!validSell(sArr)) { setError('Sell presets must be 4 percentages between 1 and 100'); return; }
    setBuyPresets(bArr);
    setSellPresets(sArr);
    onClose();
  }

  function reset() {
    setDraftBuy(DEFAULT_BUY_PRESETS.map(String));
    setDraftSell(DEFAULT_SELL_PRESETS.map(String));
    setError('');
  }

  // Inline color tokens (don't depend on theme module).
  const C = {
    bg: '#0a0e1a', card: 'rgba(15,20,35,.95)', border: 'rgba(255,255,255,.08)',
    text: '#fff', muted: '#7a8194', accent: '#00e5ff', red: '#ff3b6b', green: '#00ffa3',
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
    zIndex: 10000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    overscrollBehavior: 'none',
  };
  const sheetStyle = {
    width: '100%', maxWidth: 480, background: C.card, color: C.text,
    border: '1px solid ' + C.border, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: '20px 18px calc(20px + env(safe-area-inset-bottom)) 18px',
    maxHeight: 'min(85vh, 85dvh)', overflowY: 'auto', boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };
  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    background: 'rgba(255,255,255,.03)', border: '1px solid ' + C.border,
    color: C.text, fontSize: 16, fontWeight: 700,
    outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase' };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={function (e) { e.stopPropagation(); }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 14px' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Customize Instant Buy</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: 4 }}>x</button>
        </div>

        <p style={{ fontSize: 12, color: C.muted, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
          Set the USD amounts shown on instant buy buttons across all token cards and detail pages. Sell percentages apply to your full balance of a token.
        </p>

        {/* BUY PRESETS */}
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
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>The first three appear on token cards. All five appear on token detail pages.</div>
        </div>

        {/* SELL PRESETS */}
        <div style={{ marginBottom: 18 }}>
          <div style={labelStyle}>Sell percentages</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
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
            Reset to default
          </button>
          <button onClick={save} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: C.bg, fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Edit button -- small pencil icon you drop wherever an edit affordance is
 * needed. Opens the modal on click. State for the modal lives here so each
 * call site can just render <PresetsEditButton /> with no state plumbing.
 * ========================================================================= */
export function PresetsEditButton({ size, color, label, style }) {
  const [open, setOpen] = useState(false);
  const px = size || 32;
  return (
    <React.Fragment>
      <button
        onClick={function () { setOpen(true); }}
        title={label || 'Edit instant buy presets'}
        aria-label={label || 'Edit instant buy presets'}
        style={Object.assign({
          width: px, height: px, borderRadius: 8,
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.08)',
          color: color || '#7a8194',
          cursor: 'pointer', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, padding: 0,
          touchAction: 'manipulation',
        }, style || {})}
      >
        {/* pencil icon as inline svg -- no font/icon-pack dep */}
        <svg width={Math.round(px * 0.5)} height={Math.round(px * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
      <InstantPresetsModal open={open} onClose={function () { setOpen(false); }} />
    </React.Fragment>
  );
}
