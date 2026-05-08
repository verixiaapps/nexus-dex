/**
 * NEXUS DEX - InstantTrade
 *
 * GMGN / Photon / BullX-style preset bar for token cards and detail pages.
 *
 * Behavior:
 *   - Pump.fun / PumpSwap / bonding-curve tokens route through pumpTrade.js.
 *   - Normal Solana tokens route through solanaSwap.js using OKX.
 *   - EVM tokens always open the regular trade drawer.
 *   - External Solana wallets open the regular trade drawer.
 *   - Privy embedded Solana wallet can run instant one-click trades.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from './WalletContext.js';
import { quickBuySol, quickSellSol } from '../solanaSwap.js';
import { quickBuyPump, quickSellPump } from '../pumpTrade.js';
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

const FALLBACK_BUY  = [25, 50, 100, 250, 500];
const FALLBACK_SELL = [50, 100];

function fmtSol(n) {
  if (n == null || isNaN(n)) return '-';
  if (n >= 1)     return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}

function isPumpToken(token) {
  if (!token) return false;

  const fields = [
    token.source,
    token.platform,
    token.dex,
    token.pool,
    token.poolType,
    token.launchpad,
    token.market,
    token.origin,
  ].map(function(v) {
    return String(v || '').toLowerCase();
  });

  if (token.isPump || token.isPumpFun || token.pumpFun || token.isPumpToken) return true;

  return fields.some(function(v) {
    return (
      v === 'pump' ||
      v === 'pumpfun' ||
      v === 'pump.fun' ||
      v === 'pump-amm' ||
      v === 'pump_amm' ||
      v === 'pumpswap' ||
      v === 'pump swap' ||
      v.indexOf('pump.fun') >= 0 ||
      v.indexOf('pump') >= 0
    );
  });
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

  const [pendingPreset, setPendingPreset] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isSolToken = !!(token && (token.mint || token.chain === 'solana'));
  const isEvmToken = !!(token && (token.chain === 'evm' || (token.address && !token.mint)));
  const usePumpRoute = isPumpToken(token);

  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;
  const isExternalSolUser = isConnected && solConnected && !isPrivy && isSolToken;

  const { buyPresets, sellPresets } = useInstantPresets();

  const displayBuyPresets = useMemo(() => {
    const src = (buyPresets && buyPresets.length >= 1) ? buyPresets : FALLBACK_BUY;
    return compact ? src.slice(0, 3) : src;
  }, [buyPresets, compact]);

  const displaySellPresets = useMemo(() => {
    return (sellPresets && sellPresets.length >= 1) ? sellPresets : FALLBACK_SELL;
  }, [sellPresets]);

  const showError = useCallback(function(message, ms) {
    setErrorMsg(message);
    setTimeout(function() {
      setErrorMsg('');
    }, ms || 4000);
  }, []);

  const handleBuy = useCallback(async (usdAmount) => {
    if (pendingPreset) return;

    if (!isConnected) {
      if (loginPrivy) loginPrivy();
      else if (onConnectWallet) onConnectWallet();
      return;
    }

    if (isEvmToken) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }

    if (!isSolToken) return;

    if (!isPrivy) {
      if (onOpenDrawer) onOpenDrawer('buy', { presetUsd: usdAmount });
      return;
    }

    if (!solPrice || solPrice <= 0) {
      showError('Loading price, try again', 2500);
      return;
    }

    setPendingPreset('buy:' + usdAmount);
    setErrorMsg('');

    try {
      const tradeWallet = {
        kind: 'privy',
        privyWallet: privyEmbeddedSol,
        instant: true,
      };

      const result = usePumpRoute
        ? await quickBuyPump({
            mint: token.mint,
            usdAmount,
            solPriceUsd: solPrice,
            publicKey,
            connection,
            wallet: tradeWallet,
          })
        : await quickBuySol({
            toMint: token.mint,
            usdAmount,
            solPriceUsd: solPrice,
            publicKey,
            connection,
            wallet: tradeWallet,
          });

      if (typeof onTradeComplete === 'function') {
        try {
          onTradeComplete({
            side: 'buy',
            signature: result && result.signature,
            usdAmount,
            route: usePumpRoute ? 'pump' : 'okx',
          });
        } catch (cbErr) {
          console.error('[InstantTrade] onTradeComplete error:', cbErr);
        }
      }
    } catch (e) {
      const raw = (e && e.message) || 'Trade failed';
      const isCancel = /reject|cancel|denied|user/i.test(raw);
      if (!isCancel) showError(raw.length > 60 ? raw.slice(0, 60) + '...' : raw, 4000);
    } finally {
      setPendingPreset(null);
    }
  }, [
    pendingPreset, isConnected, isSolToken, isEvmToken, isPrivy,
    solPrice, token, publicKey, connection, privyEmbeddedSol,
    onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy,
    usePumpRoute, showError,
  ]);

  const handleSell = useCallback(async (pct) => {
    if (pendingPreset) return;

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

    if (!tokenBalance || tokenBalance <= 0) {
      showError('No balance to sell', 2500);
      return;
    }

    setPendingPreset('sell:' + pct);
    setErrorMsg('');

    try {
      const tradeWallet = {
        kind: 'privy',
        privyWallet: privyEmbeddedSol,
        instant: true,
      };

      const result = usePumpRoute
        ? await quickSellPump({
            mint: token.mint,
            tokenBalance,
            pct,
            tokenPriceUsd: token.priceUsd || token.usdPrice || token.current_price || token.price || 0,
            solPriceUsd: solPrice,
            publicKey,
            connection,
            wallet: tradeWallet,
          })
        : await quickSellSol({
            fromMint: token.mint,
            fromBalance: tokenBalance,
            fromDecimals: tokenDecimals != null ? tokenDecimals : (token.decimals || 9),
            pct,
            publicKey,
            connection,
            wallet: tradeWallet,
          });

      if (typeof onTradeComplete === 'function') {
        try {
          onTradeComplete({
            side: 'sell',
            signature: result && result.signature,
            pct,
            route: usePumpRoute ? 'pump' : 'okx',
          });
        } catch (cbErr) {
          console.error('[InstantTrade] onTradeComplete error:', cbErr);
        }
      }
    } catch (e) {
      const raw = (e && e.message) || 'Trade failed';
      const isCancel = /reject|cancel|denied|user/i.test(raw);
      if (!isCancel) showError(raw.length > 60 ? raw.slice(0, 60) + '...' : raw, 4000);
    } finally {
      setPendingPreset(null);
    }
  }, [
    pendingPreset, isConnected, isSolToken, isEvmToken, isPrivy,
    tokenBalance, tokenDecimals, token, solPrice, publicKey, connection,
    privyEmbeddedSol, onConnectWallet, onOpenDrawer, onTradeComplete,
    loginPrivy, usePumpRoute, showError,
  ]);

  if (!token) return null;

  const showSell = !!(tokenBalance && tokenBalance > 0) && !compact;

  function PresetBtn({ label, sublabel, kind, value, gradient, isPending }) {
    const onClick = kind === 'buy'
      ? function() { handleBuy(value); }
      : function() { handleSell(value); };

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
          minHeight: 44,
          borderRadius: 10,
          background: isPending ? gradient : C.card2,
          border: '1px solid ' + (isPending ? 'transparent' : C.border),
          color: isPending ? '#fff' : (kind === 'buy' ? C.accent : C.red),
          fontWeight: 800,
          fontSize: compact ? 12 : 13,
          fontFamily: 'Syne, sans-serif',
          cursor: isDisabled && !isPending ? 'not-allowed' : 'pointer',
          opacity: isDisabled && !isPending ? 0.4 : 1,
          transition: 'background .15s, color .15s, opacity .15s, border-color .15s',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          lineHeight: 1.1,
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

  return (
    <div style={{
      width: '100%',
      background: compact ? 'transparent' : C.card2,
      border: compact ? 'none' : '1px solid ' + C.border,
      borderRadius: compact ? 0 : 14,
      padding: compact ? 0 : 12,
    }}>
      <div style={{ marginBottom: showSell ? 10 : 0 }}>
        {!compact && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <div style={{
              fontSize: 10,
              color: C.muted,
              fontWeight: 700,
              letterSpacing: 0.8,
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

      {showSell && (
        <div>
          <div style={{
            fontSize: 10,
            color: C.muted,
            fontWeight: 700,
            letterSpacing: 0.8,
            marginBottom: 8,
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

      {errorMsg && (
        <div role="alert" style={{
          marginTop: 10,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(255,59,107,.10)',
          border: '1px solid rgba(255,59,107,.30)',
          fontSize: 11,
          color: C.red,
          textAlign: 'center',
          fontWeight: 600,
        }}>
          {errorMsg}
        </div>
      )}

      {!compact && (
        <>
          {!isConnected && (
            <div style={{
              marginTop: 10,
              fontSize: 11,
              color: C.muted,
              textAlign: 'center',
              lineHeight: 1.4,
            }}>
              Connect a wallet to trade.
            </div>
          )}

          {isExternalSolUser && (
            <button
              onClick={function() { if (loginPrivy) loginPrivy(); }}
              style={{
                width: '100%',
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(168,85,247,.08)',
                border: '1px solid rgba(168,85,247,.30)',
                color: C.privy,
                fontFamily: 'Syne, sans-serif',
                fontSize: 11,
                fontWeight: 700,
                cursor: loginPrivy ? 'pointer' : 'default',
                textAlign: 'center',
                lineHeight: 1.4,
                minHeight: 40,
              }}
            >
              Sign in with email for instant trades -- no popups
            </button>
          )}

          {isConnected && isPrivy && isSolToken && (
            <div style={{
              marginTop: 10,
              fontSize: 10,
              color: C.privy,
              fontWeight: 800,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: C.privy,
                boxShadow: '0 0 6px ' + C.privy,
              }} />
              ONE-CLICK MODE -- {usePumpRoute ? 'PUMP ROUTE' : 'OKX ROUTE'}
            </div>
          )}

          {isConnected && isEvmToken && (
            <div style={{
              marginTop: 10,
              fontSize: 10,
              color: C.muted,
              textAlign: 'center',
              lineHeight: 1.4,
            }}>
              EVM tokens use the regular trade drawer.
            </div>
          )}
        </>
      )}
    </div>
  );
}