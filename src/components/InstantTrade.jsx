/**
 * NEXUS DEX - InstantTrade 
 *
 * GMGN / Photon / BullX-style preset bar for token cards and detail pages.
 *
 * Behavior contract (locked):
 *
 *   PRIVY embedded wallet:
 *     Tap a preset -> trade fires DIRECTLY via solanaSwap.js. Silent sign
 *     (Privy's noPromptOnSignature). Button dims briefly while pending,
 *     then returns to normal. Balance updates in the parent. No popup,
 *     no toast, no success indicator.
 *
 *   EXTERNAL Solana wallet (Phantom / Solflare):
 *     Tap a preset -> opens the trade drawer pre-filled with the amount.
 *     User confirms once with their wallet popup. A small upsell hint
 *     ("Sign in with email for instant trades") is shown on the detail page.
 *
 *   EVM token (any wallet):
 *     Tap a preset -> opens the trade drawer pre-filled. EVM ERC20 first
 *     trade requires an approval, breaking the "instant" promise, so we
 *     defer to the drawer for clarity.
 *
 *   NOT CONNECTED:
 *     Tap a preset -> opens Privy login (or wallet modal as fallback).
 *     User has to tap the preset AGAIN after signing in. NO auto-fire.
 *     This is intentional: a preset tap is a small commitment and the user
 *     might forget which preset they tapped during the sign-in flow.
 *
 * Layout:
 *
 *   COMPACT (cards): exactly 3 buy buttons, no sell, no labels, no pencil,
 *     no hints. Tight, tappable, scannable. The pencil for editing presets
 *     lives in the feed header (NewLaunches.js), not on cards.
 *
 *   FULL (detail page):
 *     QUICK BUY row (5 amounts) + pencil
 *     QUICK SELL row (2 amounts) -- only when wallet connected AND user
 *       holds the token
 *     Hint line at bottom appropriate to wallet/token state
 *
 * Props:
 *   token            - the token being viewed (must have mint for SOL)
 *   solPrice         - SOL/USD price (passed by parent to avoid dup fetch)
 *   tokenBalance     - user's holdings of `token` (drives sell row visibility)
 *   tokenDecimals    - token decimals (default 9 for SPL)
 *   onConnectWallet  - opens app wallet modal (fallback when Privy missing)
 *   onOpenDrawer     - (mode, { presetUsd | presetPct }) -> parent opens
 *                      the regular trade drawer pre-filled
 *   onTradeComplete  - ({ side, signature, ... }) -> parent refreshes balance
 *   compact          - true on cards, false on detail page
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { quickBuySol, quickSellSol } from '../solanaSwap.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const C = {
  card2:     '#0c1220',
  card3:     '#111d30',
  border:    'rgba(0,229,255,0.10)',
  borderHi:  'rgba(0,229,255,0.25)',
  accent:    '#00e5ff',
  green:     '#00ffa3',
  red:       '#ff3b6b',
  text:      '#cdd6f4',
  muted:     '#586994',
  privy:     '#a855f7',
  buyGrad:   'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad:  'linear-gradient(135deg,#ff3b6b,#cc1144)',
  privyGrad: 'linear-gradient(135deg,#a855f7,#7c3aed)',
};

/* Hardcoded fallback if useInstantPresets returns nothing usable. */
const FALLBACK_BUY  = [25, 50, 100, 250, 500];
const FALLBACK_SELL = [50, 100];

function fmtSol(n) {
  if (n == null || isNaN(n)) return '-';
  if (n >= 1)     return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}

export default function InstantTrade({
  token,
  solPrice,
  tokenBalance,
  tokenDecimals,
  onConnectWallet,
  onOpenDrawer,
  onTradeComplete,
  compact = false,
}) {
  const wallet = useNexusWallet();
  const { connection } = useConnection();
  const {
    isConnected,
    solConnected,
    activeWalletKind,
    privyEmbeddedSol,
    publicKey,
    loginPrivy,
  } = wallet;

  /* Which preset is currently executing (e.g. 'buy:25' or 'sell:50').
   * Drives both the active-button gradient and the disabled state of the
   * other buttons. While anything is pending, ALL buttons are disabled -
   * prevents double-tapping the active button into re-entry. */
  const [pendingPreset, setPendingPreset] = useState(null);

  /* Brief inline error shown for ~4s. Cancellations stay silent. */
  const [errorMsg, setErrorMsg] = useState('');

  /* Token classification. */
  const isSolToken = !!(token && (token.mint || token.chain === 'solana'));
  const isEvmToken = !!(token && (token.chain === 'evm' || (token.address && !token.mint)));

  /* True iff the user has a Privy embedded Solana wallet selected as active.
   * Only this combination gives true silent execution. */
  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;

  /* Whether the user has an external Solana wallet (Phantom/Solflare) for a
   * Solana token - used to show the "sign in with email for instant" hint. */
  const isExternalSolUser = isConnected && solConnected && !isPrivy && isSolToken;

  /* Saved presets from instantPresets.jsx (synced via localStorage). */
  const { buyPresets, sellPresets } = useInstantPresets();

  /* Cards (compact) show only the first 3 buy presets per locked design.
   * Detail page shows whatever the user has saved (up to 5). */
  const displayBuyPresets = useMemo(() => {
    const src = (buyPresets && buyPresets.length >= 1) ? buyPresets : FALLBACK_BUY;
    return compact ? src.slice(0, 3) : src;
  }, [buyPresets, compact]);

  const displaySellPresets = useMemo(() => {
    return (sellPresets && sellPresets.length >= 1) ? sellPresets : FALLBACK_SELL;
  }, [sellPresets]);

  /* ----------------------------------------------------------------------
   * BUY
   * -------------------------------------------------------------------- */
  const handleBuy = useCallback(async (usdAmount) => {
    if (pendingPreset) return; /* re-entry guard */

    /* Disconnected -> open Privy login (no auto-resume per locked spec). */
    if (!isConnected) {
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }

    /* EVM tokens always go through the drawer (first ERC20 trade needs
     * approval, can't be silent). */
    if (isEvmToken) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }

    if (!isSolToken) return;

    /* External Solana wallet -> drawer pre-filled (1 popup). */
    if (!isPrivy) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }

    /* PRIVY INSTANT PATH ----------------------------------------------- */
    if (!solPrice || solPrice <= 0) {
      /* Without SOL price we can't size the buy. Show a brief hint. */
      setErrorMsg('Loading price, try again');
      setTimeout(() => setErrorMsg(''), 2500);
      return;
    }

    setPendingPreset('buy:' + usdAmount);
    setErrorMsg('');

    try {
      const result = await quickBuySol({
        toMint:      token.mint,
        usdAmount,
        solPriceUsd: solPrice,
        publicKey,
        connection,
        wallet: {
          kind: 'privy',
          privyWallet: privyEmbeddedSol,
          instant: true, /* honored by solanaSwap.js -> noPromptOnSignature */
        },
      });
      if (typeof onTradeComplete === 'function') {
        try { onTradeComplete({ side: 'buy', signature: result && result.signature, usdAmount }); }
        catch (cbErr) { console.error('[InstantTrade] onTradeComplete error:', cbErr); }
      }
    } catch (e) {
      const raw = (e && e.message) || 'Trade failed';
      const isCancel = /reject|cancel|denied|user/i.test(raw);
      if (!isCancel) {
        setErrorMsg(raw.length > 60 ? raw.slice(0, 60) + '...' : raw);
        setTimeout(() => setErrorMsg(''), 4000);
      }
    } finally {
      setPendingPreset(null);
    }
  }, [
    pendingPreset, isConnected, isSolToken, isEvmToken, isPrivy,
    solPrice, token, publicKey, connection, privyEmbeddedSol,
    onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy,
  ]);

  /* ----------------------------------------------------------------------
   * SELL
   * -------------------------------------------------------------------- */
  const handleSell = useCallback(async (pct) => {
    if (pendingPreset) return; /* re-entry guard */

    if (!isConnected) {
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }

    if (isEvmToken) {
      if (onOpenDrawer) onOpenDrawer('sell', { presetPct: pct });
      return;
    }

    if (!isSolToken) return;

    if (!isPrivy) {
      if (onOpenDrawer) onOpenDrawer('sell', { presetPct: pct });
      return;
    }

    /* PRIVY INSTANT PATH ----------------------------------------------- */
    if (!tokenBalance || tokenBalance <= 0) {
      setErrorMsg('No balance to sell');
      setTimeout(() => setErrorMsg(''), 2500);
      return;
    }

    setPendingPreset('sell:' + pct);
    setErrorMsg('');

    try {
      const result = await quickSellSol({
        fromMint:     token.mint,
        fromBalance:  tokenBalance,
        fromDecimals: tokenDecimals != null ? tokenDecimals : (token.decimals || 9),
        pct,
        publicKey,
        connection,
        wallet: {
          kind: 'privy',
          privyWallet: privyEmbeddedSol,
          instant: true,
        },
      });
      if (typeof onTradeComplete === 'function') {
        try { onTradeComplete({ side: 'sell', signature: result && result.signature, pct }); }
        catch (cbErr) { console.error('[InstantTrade] onTradeComplete error:', cbErr); }
      }
    } catch (e) {
      const raw = (e && e.message) || 'Trade failed';
      const isCancel = /reject|cancel|denied|user/i.test(raw);
      if (!isCancel) {
        setErrorMsg(raw.length > 60 ? raw.slice(0, 60) + '...' : raw);
        setTimeout(() => setErrorMsg(''), 4000);
      }
    } finally {
      setPendingPreset(null);
    }
  }, [
    pendingPreset, isConnected, isSolToken, isEvmToken, isPrivy,
    tokenBalance, tokenDecimals, token, publicKey, connection,
    privyEmbeddedSol, onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy,
  ]);

  if (!token) return null;

  /* Sell row never appears on cards; on detail page only when balance > 0. */
  const showSell = !!(tokenBalance && tokenBalance > 0) && !compact;

  /* ----------------------------------------------------------------------
   * PRESET BUTTON
   * -------------------------------------------------------------------- */
  function PresetBtn({ label, sublabel, kind, value, gradient, isPending }) {
    const onClick = kind === 'buy'
      ? () => handleBuy(value)
      : () => handleSell(value);
    /* All buttons disabled while ANY preset is pending. */
    const isDisabled = !!pendingPreset;

    return (
      <button
        onClick={onClick}
        disabled={isDisabled && !isPending}
        aria-busy={isPending}
        style={{
          flex: 1,
          minWidth: compact ? 56 : 64,
          padding: compact ? '10px 4px' : '12px 6px',
          minHeight: 44, /* locked: 44x44 minimum tap target */
          borderRadius: 10,
          background: isPending ? gradient : C.card2,
          border:     '1px solid ' + (isPending ? 'transparent' : C.border),
          color:      isPending
            ? '#fff'
            : (kind === 'buy' ? C.accent : C.red),
          fontWeight: 800,
          fontSize:   compact ? 12 : 13,
          fontFamily: 'Syne, sans-serif',
          cursor:     isDisabled && !isPending ? 'not-allowed' : 'pointer',
          opacity:    isDisabled && !isPending ? 0.4 : 1,
          transition: 'background .15s, color .15s, opacity .15s, border-color .15s',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 2, lineHeight: 1.1,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span>{label}</span>
        {sublabel && (
          <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>{sublabel}</span>
        )}
      </button>
    );
  }

  /* ----------------------------------------------------------------------
   * RENDER
   * -------------------------------------------------------------------- */
  return (
    <div style={{
      width:        '100%',
      background:   compact ? 'transparent' : C.card2,
      border:       compact ? 'none' : '1px solid ' + C.border,
      borderRadius: compact ? 0 : 14,
      padding:      compact ? 0 : 12,
    }}>

      {/* QUICK BUY -------------------------------------------------- */}
      <div style={{ marginBottom: showSell ? 10 : 0 }}>
        {!compact && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8,
            }}>
              QUICK BUY
            </div>
            <PresetsEditButton size={32} label="Customize amounts" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {displayBuyPresets.map((usd, i) => (
            <PresetBtn
              key={'b-' + i}
              label={'$' + usd}
              sublabel={(!compact && solPrice && isSolToken)
                ? '~' + fmtSol(usd / solPrice) + ' SOL'
                : null}
              kind="buy"
              value={usd}
              gradient={C.buyGrad}
              isPending={pendingPreset === 'buy:' + usd}
            />
          ))}
        </div>
      </div>

      {/* QUICK SELL ------------------------------------------------- */}
      {showSell && (
        <div>
          <div style={{
            fontSize: 10, color: C.muted, fontWeight: 700,
            letterSpacing: 0.8, marginBottom: 8,
          }}>
            QUICK SELL
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {displaySellPresets.map((pct, i) => (
              <PresetBtn
                key={'s-' + i}
                label={pct === 100 ? 'MAX' : pct + '%'}
                sublabel={null}
                kind="sell"
                value={pct}
                gradient={C.sellGrad}
                isPending={pendingPreset === 'sell:' + pct}
              />
            ))}
          </div>
        </div>
      )}

      {/* INLINE ERROR (only for unexpected failures, never for cancels) */}
      {errorMsg && (
        <div role="alert" style={{
          marginTop: 10,
          padding:   '8px 10px',
          borderRadius: 8,
          background: 'rgba(255,59,107,.10)',
          border:     '1px solid rgba(255,59,107,.30)',
          fontSize:   11,
          color:      C.red,
          textAlign:  'center',
          fontWeight: 600,
        }}>
          {errorMsg}
        </div>
      )}

      {/* HINTS (detail page only) ----------------------------------- */}
      {!compact && (
        <>
          {!isConnected && (
            <div style={{
              marginTop:  10, fontSize: 11, color: C.muted,
              textAlign:  'center', lineHeight: 1.4,
            }}>
              Connect a wallet to trade.
            </div>
          )}

          {isExternalSolUser && (
            <button
              onClick={() => { if (loginPrivy) loginPrivy(); }}
              style={{
                width: '100%', marginTop: 10, padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(168,85,247,.08)',
                border:     '1px solid rgba(168,85,247,.30)',
                color:      C.privy,
                fontFamily: 'Syne, sans-serif',
                fontSize:   11, fontWeight: 700,
                cursor:     loginPrivy ? 'pointer' : 'default',
                textAlign:  'center', lineHeight: 1.4,
                minHeight:  40,
              }}
            >
              Sign in with email for instant trades -- no popups
            </button>
          )}

          {isConnected && isPrivy && isSolToken && (
            <div style={{
              marginTop: 10,
              fontSize: 10, color: C.privy, fontWeight: 800, letterSpacing: 0.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: C.privy, boxShadow: '0 0 6px ' + C.privy,
              }} />
              ONE-CLICK MODE -- NO POPUP
            </div>
          )}

          {isConnected && isEvmToken && (
            <div style={{
              marginTop: 10, fontSize: 10, color: C.muted,
              textAlign: 'center', lineHeight: 1.4,
            }}>
              EVM tokens use the regular trade drawer.
            </div>
          )}
        </>
      )}
    </div>
  );
}
