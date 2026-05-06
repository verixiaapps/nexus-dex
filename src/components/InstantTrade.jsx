/**
 * NEXUS DEX -- InstantTrade
 *
 * GMGN / Photon / BullX -style one-tap preset bar for token pages.
 * 
 * Behavior: 
 *   - Privy embedded wallet (activeWalletKind === 'privy'):
 *       Tap a preset -> trade fires DIRECT via solanaSwap.js. NO popup.
 *       Pure one-click. This is the feature the user asked for.
 *   - External wallet (Phantom / Solflare):
 *       Tap a preset -> opens the trade drawer with the preset pre-filled.
 *       User confirms with the wallet popup (1 sig). Same locked rule.
 *   - Not connected:
 *       Tap a preset -> opens connect-wallet modal.
 *
 * Solana-only for instant execution. EVM tokens fall through to the
 * regular trade drawer (EVM ERC20 first-trade needs an approval which
 * breaks the "instant" promise; defer to drawer for clarity).
 *
 * Props:
 *   token            -- the token being viewed (must have mint)
 *   solPrice         -- SOL/USD price (passed from parent to avoid dup fetch)
 *   tokenBalance     -- user's current balance of `token` (for sell %)
 *   tokenDecimals    -- token's decimals (default 9 for SPL)
 *   onConnectWallet  -- opens wallet modal when not connected
 *   onOpenDrawer     -- opens trade drawer with preset pre-filled (external wallet path)
 *   compact          -- smaller layout for cards
 *   onTradeComplete  -- callback after successful trade (for refresh)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { quickBuySol, quickSellSol } from '../solanaSwap.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const C = {
  card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994',
  privy: '#a855f7',
  buyGrad:  'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
};

function fmtSol(n) {
  if (n == null || isNaN(n)) return '-';
  if (n >= 1) return n.toFixed(2);
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
    signTransaction,
    loginPrivy,
  } = wallet;

  const [status, setStatus] = useState('idle');     // idle | loading | success | error
  const [statusMsg, setStatusMsg] = useState('');
  const [pendingPreset, setPendingPreset] = useState(null);
  // Pending action queue: when disconnected user taps Buy/Sell, save intent
  // and trigger Privy login. After login completes (isConnected flips true),
  // useEffect below auto-resumes the action -- they don't have to tap again.
  const [pendingIntent, setPendingIntent] = useState(null);

  const isSolToken = !!(token && (token.mint || token.chain === 'solana'));
  const isEvmToken = !!(token && (token.chain === 'evm' || (token.address && !token.mint)));

  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;

  // User-customized presets (synced via localStorage across the app).
  // Replaces the old `presets.buy`/`presets.sell` lookup which had no UI.
  const { buyPresets, sellPresets } = useInstantPresets();

  // ---------------------------------------------------------------
  // BUY
  // ---------------------------------------------------------------
  const handleBuy = useCallback(async function (usdAmount) {
    // Connect-first: if disconnected, save intent + trigger Privy login.
    // After login, useEffect auto-resumes this exact action.
    if (!isConnected) {
      setPendingIntent({ kind: 'buy', usdAmount: usdAmount });
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();  // fallback for missing Privy
      return;
    }
    // EVM tokens: fall through to drawer (instant mode is Solana-only)
    if (isEvmToken) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }
    if (!isSolToken) return;
    if (!solConnected && !isPrivy) {
      setPendingIntent({ kind: 'buy', usdAmount: usdAmount });
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!solPrice || solPrice <= 0) {
      setStatus('error');
      setStatusMsg('Loading SOL price...');
      setTimeout(function () { setStatus('idle'); setStatusMsg(''); }, 2500);
      return;
    }

    // External wallet -> open drawer pre-filled (1 popup, same as before)
    if (!isPrivy) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }

    // PRIVY ONE-CLICK PATH
    setPendingPreset('buy:' + usdAmount);
    setStatus('loading');
    setStatusMsg('Signing...');

    try {
      const result = await quickBuySol({
        toMint: token.mint,
        usdAmount,
        solPriceUsd: solPrice,
        publicKey,
        connection,
        wallet: {
          kind: 'privy',
          privyWallet: privyEmbeddedSol,
          instant: true,  // suppress Privy's per-tx confirmation UI
        },
        onStatus: function (s) { setStatusMsg(s); },
      });
      setStatus('success');
      setStatusMsg('Bought! ' + result.signature.slice(0, 8) + '...');
      if (typeof onTradeComplete === 'function') {
        try { onTradeComplete({ side: 'buy', signature: result.signature, usdAmount }); } catch (e) { /* no-op */ }
      }
      setTimeout(function () {
        setStatus('idle'); setStatusMsg(''); setPendingPreset(null);
      }, 4000);
    } catch (e) {
      setStatus('error');
      const raw = (e && e.message) || 'Trade failed';
      const friendly = /reject|cancel|denied|user/i.test(raw)
        ? 'Cancelled'
        : (raw.length > 60 ? raw.slice(0, 60) + '...' : raw);
      setStatusMsg(friendly);
      setTimeout(function () {
        setStatus('idle'); setStatusMsg(''); setPendingPreset(null);
      }, 4000);
    }
  }, [
    isConnected, isSolToken, isEvmToken, solConnected, isPrivy,
    solPrice, token, publicKey, connection, privyEmbeddedSol,
    onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy,
  ]);

  // ---------------------------------------------------------------
  // SELL
  // ---------------------------------------------------------------
  const handleSell = useCallback(async function (pct) {
    if (!isConnected) {
      setPendingIntent({ kind: 'sell', pct: pct });
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    if (isEvmToken) {
      if (onOpenDrawer) onOpenDrawer('sell', { presetPct: pct });
      return;
    }
    if (!isSolToken) return;
    if (!solConnected && !isPrivy) {
      setPendingIntent({ kind: 'sell', pct: pct });
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }
    if (!tokenBalance || tokenBalance <= 0) {
      setStatus('error');
      setStatusMsg('No balance to sell');
      setTimeout(function () { setStatus('idle'); setStatusMsg(''); }, 2500);
      return;
    }

    if (!isPrivy) {
      if (onOpenDrawer) onOpenDrawer('sell', { presetPct: pct });
      return;
    }

    // PRIVY ONE-CLICK SELL
    setPendingPreset('sell:' + pct);
    setStatus('loading');
    setStatusMsg('Signing...');

    try {
      const result = await quickSellSol({
        fromMint: token.mint,
        fromBalance: tokenBalance,
        fromDecimals: tokenDecimals != null ? tokenDecimals : (token.decimals || 9),
        pct,
        publicKey,
        connection,
        wallet: {
          kind: 'privy',
          privyWallet: privyEmbeddedSol,
          instant: true,  // suppress Privy's per-tx confirmation UI
        },
        onStatus: function (s) { setStatusMsg(s); },
      });
      setStatus('success');
      setStatusMsg('Sold! ' + result.signature.slice(0, 8) + '...');
      if (typeof onTradeComplete === 'function') {
        try { onTradeComplete({ side: 'sell', signature: result.signature, pct }); } catch (e) { /* no-op */ }
      }
      setTimeout(function () {
        setStatus('idle'); setStatusMsg(''); setPendingPreset(null);
      }, 4000);
    } catch (e) {
      setStatus('error');
      const raw = (e && e.message) || 'Trade failed';
      const friendly = /reject|cancel|denied|user/i.test(raw)
        ? 'Cancelled'
        : (raw.length > 60 ? raw.slice(0, 60) + '...' : raw);
      setStatusMsg(friendly);
      setTimeout(function () {
        setStatus('idle'); setStatusMsg(''); setPendingPreset(null);
      }, 4000);
    }
  }, [
    isConnected, isSolToken, isEvmToken, solConnected, isPrivy,
    tokenBalance, tokenDecimals, token, publicKey, connection,
    privyEmbeddedSol, onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy,
  ]);

  // -----------------------------------------------------------------
  // Auto-resume pending intent after login completes.
  // When user taps Buy/Sell while disconnected:
  //   1. Intent is saved + Privy login is triggered
  //   2. User signs in with email/social/passkey
  //   3. isConnected flips true (and on Solana tokens, privyEmbeddedSol also
  //      becomes available)
  //   4. This effect fires, dispatches the saved intent, clears it
  //
  // The 200ms delay gives Privy + wallet-adapter time to propagate so the
  // execution path picks up the right wallet kind.
  // -----------------------------------------------------------------
  useEffect(function () {
    if (!isConnected || !pendingIntent) return undefined;
    var intent = pendingIntent;
    var t = setTimeout(function () {
      setPendingIntent(null);
      if (intent.kind === 'buy')  handleBuy(intent.usdAmount);
      else if (intent.kind === 'sell') handleSell(intent.pct);
    }, 200);
    return function () { clearTimeout(t); };
  }, [isConnected, pendingIntent, handleBuy, handleSell]);

  if (!token) return null;

  // ------------------------------------------------------ PresetBtn
  function PresetBtn({ label, sublabel, kind, value, gradient, isPending }) {
    const disabled = status === 'loading' && !isPending;
    return (
      <button
        onClick={kind === 'buy' ? function () { handleBuy(value); } : function () { handleSell(value); }}
        disabled={disabled}
        style={{
          flex: 1,
          minWidth: compact ? 56 : 72,
          padding: compact ? '8px 4px' : '10px 6px',
          borderRadius: 10,
          background: isPending ? gradient : C.card2,
          border: '1px solid ' + (isPending ? 'transparent' : C.border),
          color: isPending ? '#fff' : (kind === 'buy' ? C.accent : C.red),
          fontWeight: 800,
          fontSize: compact ? 11 : 12,
          fontFamily: 'Syne, sans-serif',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'all .15s',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 1, lineHeight: 1.1,
          touchAction: 'manipulation',
        }}
      >
        <span>{label}</span>
        {sublabel && <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>{sublabel}</span>}
      </button>
    );
  }

  const showSell = !!(tokenBalance && tokenBalance > 0);

  return (
    <div style={{
      width: '100%',
      background: compact ? 'transparent' : C.card2,
      border: compact ? 'none' : '1px solid ' + C.border,
      borderRadius: compact ? 0 : 14,
      padding: compact ? 0 : 12,
    }}>
      {isPrivy && !compact && (
        <div style={{
          fontSize: 10,
          color: C.privy,
          fontWeight: 800,
          letterSpacing: 0.5,
          marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: C.privy, boxShadow: '0 0 6px ' + C.privy,
          }} />
          ONE-CLICK MODE -- NO POPUP
        </div>
      )}

      {/* QUICK BUY */}
      <div style={{ marginBottom: showSell ? 8 : 0 }}>
        {!compact && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 6,
          }}>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              letterSpacing: 0.8,
            }}>
              QUICK BUY
            </div>
            <PresetsEditButton size={26} label="Customize amounts" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 5 }}>
          {buyPresets.map(function (usd, i) {
            return (
              <PresetBtn
                key={'b-' + i}
                label={'$' + usd}
                sublabel={solPrice ? '~' + fmtSol(usd / solPrice) + ' SOL' : null}
                kind="buy"
                value={usd}
                gradient={C.buyGrad}
                isPending={pendingPreset === 'buy:' + usd}
              />
            );
          })}
        </div>
      </div>

      {/* QUICK SELL */}
      {showSell && (
        <div>
          {!compact && (
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              letterSpacing: 0.8, marginBottom: 6,
            }}>
              QUICK SELL
            </div>
          )}
          <div style={{ display: 'flex', gap: 5 }}>
            {sellPresets.map(function (pct, i) {
              return (
                <PresetBtn
                  key={'s-' + i}
                  label={pct === 100 ? 'MAX' : pct + '%'}
                  sublabel={null}
                  kind="sell"
                  value={pct}
                  gradient={C.sellGrad}
                  isPending={pendingPreset === 'sell:' + pct}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* STATUS LINE */}
      {status !== 'idle' && statusMsg && (
        <div style={{
          marginTop: 8,
          fontSize: 11,
          color: status === 'error' ? C.red : status === 'success' ? C.green : C.muted,
          textAlign: 'center', fontWeight: 600,
        }}>
          {statusMsg}
        </div>
      )}

      {/* CONNECT PROMPT */}
      {!isConnected && !compact && (
        <div style={{
          marginTop: 8, fontSize: 10, color: C.muted, textAlign: 'center',
        }}>
          Connect a wallet to trade.
        </div>
      )}

      {/* EVM HINT */}
      {isEvmToken && isConnected && !compact && (
        <div style={{
          marginTop: 8, fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 1.4,
        }}>
          One-click is Solana-only. EVM tokens use the regular trade drawer.
        </div>
      )}
    </div>
  );
}
