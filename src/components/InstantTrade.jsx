/**
 * NEXUS DEX - InstantTrade
 *
 * GMGN / Photon / BullX-style preset bar for token cards and detail pages.
 * Solana only. Pump.fun tokens route through pumpTrade, normal tokens through solanaSwap/OKX.
 */
 
import React, { useState, useCallback, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { quickBuySol, quickSellSol } from '../solanaSwap.js';
import { quickBuyPump, quickSellPump } from '../pumpTrade.js';
import { useInstantPresets, PresetsEditButton } from '../instantPresets.jsx';

const C = {
  card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', privy: '#a855f7',
  buyGrad: 'linear-gradient(135deg,#00e5ff,#0055ff)',
  sellGrad: 'linear-gradient(135deg,#ff3b6b,#cc1144)',
};

const FALLBACK_BUY  = [25, 50, 100, 250, 500];
const FALLBACK_SELL = [50, 100];

function fmtSol(n) {
  if (n == null || isNaN(n)) return '-';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}

function isPumpToken(token) {
  if (!token) return false;
  if (token.isPump || token.isPumpFun || token.pumpFun || token.isPumpToken) return true;
  const fields = [token.source, token.platform, token.dex, token.pool, token.poolType, token.launchpad, token.market, token.origin];
  return fields.some(v => {
    const s = String(v || '').toLowerCase();
    return s === 'pump' || s === 'pumpfun' || s === 'pump.fun' || s === 'pump-amm' || s === 'pump_amm' || s === 'pumpswap' || s === 'pump swap' || s.indexOf('pump') >= 0;
  });
}

export default function InstantTrade({ token, solPrice, tokenBalance, tokenDecimals, onConnectWallet, onOpenDrawer, onTradeComplete, compact = false }) {
  const { connection } = useConnection();
  const { isConnected, activeWalletKind, privyEmbeddedSol, publicKey, loginPrivy } = useNexusWallet();

  const [pendingPreset, setPendingPreset] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isPrivy = activeWalletKind === 'privy' && !!privyEmbeddedSol;
  const usePumpRoute = isPumpToken(token);
  const { buyPresets, sellPresets } = useInstantPresets();

  const displayBuyPresets = useMemo(() => {
    const src = (buyPresets && buyPresets.length >= 1) ? buyPresets : FALLBACK_BUY;
    return compact ? src.slice(0, 3) : src;
  }, [buyPresets, compact]);

  const displaySellPresets = useMemo(() => {
    return (sellPresets && sellPresets.length >= 1) ? sellPresets : FALLBACK_SELL;
  }, [sellPresets]);

  const showError = useCallback((msg, ms) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(''), ms || 4000);
  }, []);

  const handleBuy = useCallback(async (usdAmount) => {
    if (pendingPreset) return;
    if (!isConnected) { loginPrivy?.() || onConnectWallet?.(); return; }
    if (!isPrivy) { onOpenDrawer?.('buy', { presetUsd: usdAmount }); return; }
    if (!solPrice || solPrice <= 0) { showError('Loading price, try again', 2500); return; }

    setPendingPreset('buy:' + usdAmount);
    setErrorMsg('');
    try {
      const tw = { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true };
      const result = usePumpRoute
        ? await quickBuyPump({ mint: token.mint, usdAmount, solPriceUsd: solPrice, publicKey, connection, wallet: tw })
        : await quickBuySol({ toMint: token.mint, usdAmount, solPriceUsd: solPrice, publicKey, connection, wallet: tw });
      onTradeComplete?.({ side: 'buy', signature: result?.signature, usdAmount, route: usePumpRoute ? 'pump' : 'okx' });
    } catch (e) {
      const raw = e?.message || 'Trade failed';
      if (!/reject|cancel|denied|user/i.test(raw)) showError(raw.length > 60 ? raw.slice(0, 60) + '...' : raw, 4000);
    } finally { setPendingPreset(null); }
  }, [pendingPreset, isConnected, isPrivy, solPrice, token, publicKey, connection, privyEmbeddedSol, onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy, usePumpRoute, showError]);

  const handleSell = useCallback(async (pct) => {
    if (pendingPreset) return;
    if (!isConnected) { loginPrivy?.() || onConnectWallet?.(); return; }
    if (!isPrivy) { onOpenDrawer?.('sell', { presetPct: pct }); return; }
    if (!tokenBalance || tokenBalance <= 0) { showError('No balance to sell', 2500); return; }

    setPendingPreset('sell:' + pct);
    setErrorMsg('');
    try {
      const tw = { kind: 'privy', privyWallet: privyEmbeddedSol, instant: true };
      const result = usePumpRoute
        ? await quickSellPump({ mint: token.mint, tokenBalance, pct, tokenPriceUsd: token.priceUsd || token.usdPrice || token.current_price || token.price || 0, solPriceUsd: solPrice, publicKey, connection, wallet: tw })
        : await quickSellSol({ fromMint: token.mint, fromBalance: tokenBalance, fromDecimals: tokenDecimals != null ? tokenDecimals : (token.decimals || 9), pct, publicKey, connection, wallet: tw });
      onTradeComplete?.({ side: 'sell', signature: result?.signature, pct, route: usePumpRoute ? 'pump' : 'okx' });
    } catch (e) {
      const raw = e?.message || 'Trade failed';
      if (!/reject|cancel|denied|user/i.test(raw)) showError(raw.length > 60 ? raw.slice(0, 60) + '...' : raw, 4000);
    } finally { setPendingPreset(null); }
  }, [pendingPreset, isConnected, isPrivy, tokenBalance, tokenDecimals, token, solPrice, publicKey, connection, privyEmbeddedSol, onConnectWallet, onOpenDrawer, onTradeComplete, loginPrivy, usePumpRoute, showError]);

  if (!token) return null;
  const showSell = !!(tokenBalance && tokenBalance > 0) && !compact;

  function PresetBtn({ label, sublabel, kind, value, gradient, isPending }) {
    const onClick = kind === 'buy' ? () => handleBuy(value) : () => handleSell(value);
    const disabled = !!pendingPreset && !isPending;
    return (
      <button onClick={onClick} disabled={disabled} aria-busy={isPending} style={{
        flex: 1, minWidth: compact ? 56 : 64, padding: compact ? '10px 4px' : '12px 6px', minHeight: 44, borderRadius: 10,
        background: isPending ? gradient : C.card2, border: '1px solid ' + (isPending ? 'transparent' : C.border),
        color: isPending ? '#fff' : (kind === 'buy' ? C.accent : C.red), fontWeight: 800, fontSize: compact ? 12 : 13,
        fontFamily: 'Syne, sans-serif', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'background .15s, color .15s, opacity .15s, border-color .15s',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        lineHeight: 1.1, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
      }}>
        <span>{label}</span>
        {sublabel && <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>{sublabel}</span>}
      </button>
    );
  }

  return (
    <div style={{ width: '100%', background: compact ? 'transparent' : C.card2, border: compact ? 'none' : '1px solid ' + C.border, borderRadius: compact ? 0 : 14, padding: compact ? 0 : 12 }}>
      <div style={{ marginBottom: showSell ? 10 : 0 }}>
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8 }}>QUICK BUY</div>
            <PresetsEditButton size={32} label="Customize amounts" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {displayBuyPresets.map((usd, i) => (
            <PresetBtn key={'b-' + i} label={'$' + usd} sublabel={(!compact && solPrice) ? '~' + fmtSol(usd / solPrice) + ' SOL' : null} kind="buy" value={usd} gradient={C.buyGrad} isPending={pendingPreset === 'buy:' + usd} />
          ))}
        </div>
      </div>
      {showSell && (
        <div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8, marginBottom: 8 }}>QUICK SELL</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {displaySellPresets.map((pct, i) => (
              <PresetBtn key={'s-' + i} label={pct === 100 ? 'MAX' : pct + '%'} kind="sell" value={pct} gradient={C.sellGrad} isPending={pendingPreset === 'sell:' + pct} />
            ))}
          </div>
        </div>
      )}
      {errorMsg && (
        <div role="alert" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,59,107,.10)', border: '1px solid rgba(255,59,107,.30)', fontSize: 11, color: C.red, textAlign: 'center', fontWeight: 600 }}>{errorMsg}</div>
      )}
      {!compact && (
        <>
          {!isConnected && <div style={{ marginTop: 10, fontSize: 11, color: C.muted, textAlign: 'center' }}>Connect a wallet to trade.</div>}
          {isConnected && !isPrivy && (
            <button onClick={() => loginPrivy?.()} style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(168,85,247,.08)', border: '1px solid rgba(168,85,247,.30)', color: C.privy, fontFamily: 'Syne, sans-serif', fontSize: 11, fontWeight: 700, cursor: loginPrivy ? 'pointer' : 'default', textAlign: 'center', minHeight: 40 }}>
              Sign in with email for instant trades
            </button>
          )}
          {isConnected && isPrivy && (
            <div style={{ marginTop: 10, fontSize: 10, color: C.privy, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.privy, boxShadow: '0 0 6px ' + C.privy }} />
              ONE-CLICK — {usePumpRoute ? 'PUMP' : 'OKX'} ROUTE
            </div>
          )}
        </>
      )}
    </div>
  );
}