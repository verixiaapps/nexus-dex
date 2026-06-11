import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';

// ============================================================
// INLINE CSS — injected once on mount, no separate .css file
// ============================================================
const FLIPSY_CSS = `
.fp-page {
  min-height: 100vh;
  width: 100%;
  background: #06060C;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #FFFFFF;
  padding-bottom: 60px;
  position: relative;
  overflow-x: hidden;
}
.fp-page * { box-sizing: border-box; }

.fp-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  pointer-events: none;
  will-change: opacity;
}
.fp-glow-1 { top: -10%; left: -8%; width: 380px; height: 380px;
  background: radial-gradient(circle, #9945FF 0%, transparent 60%); opacity: 0.28; }
.fp-glow-2 { top: 35%; right: -8%; width: 340px; height: 340px;
  background: radial-gradient(circle, #00D9FF 0%, transparent 60%); opacity: 0.22;
  animation: fp-glow-pulse 9s ease-in-out infinite alternate; }
.fp-glow-3 { bottom: -10%; left: 30%; width: 360px; height: 360px;
  background: radial-gradient(circle, #14F195 0%, transparent 60%); opacity: 0.2;
  animation: fp-glow-pulse 13s ease-in-out infinite alternate-reverse; }
@keyframes fp-glow-pulse {
  0%   { opacity: 0.2; transform: scale(1); }
  100% { opacity: 0.42; transform: scale(1.15); }
}

.fp-claim-banner {
  position: sticky;
  top: 0;
  z-index: 100;
  background: linear-gradient(90deg, #14F195 0%, #00D9FF 50%, #9945FF 100%);
  color: #000000;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-align: center;
  padding: 11px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  animation: fp-banner-slide 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.fp-claim-banner:active { opacity: 0.85; }
.fp-claim-banner-icon { font-size: 15px; }
.fp-claim-banner-count {
  background: rgba(0,0,0,0.2);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
}
@keyframes fp-banner-slide {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.fp-flash-top {
  margin: 8px 24px 0;
  border-radius: 14px;
  position: relative;
  z-index: 10;
}

.fp-header {
  max-width: 1200px;
  margin: 0 auto;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: relative;
  z-index: 2;
}
.fp-brand { display: flex; align-items: center; gap: 12px; }
.fp-mascot {
  width: 50px; height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #14F195 0%, #00D9FF 35%, #9945FF 70%, #DC1FFF 100%);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 900; color: #000;
  box-shadow:
    0 0 36px rgba(153, 69, 255, 0.5),
    inset 0 -3px 6px rgba(0, 0, 0, 0.2),
    inset 0 3px 6px rgba(255, 255, 255, 0.35);
  animation: fp-mascot-float 4s ease-in-out infinite;
}
@keyframes fp-mascot-float {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(-4px) rotate(3deg); }
}
.fp-title {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1;
  background: linear-gradient(90deg, #14F195, #00D9FF 33%, #9945FF 66%, #DC1FFF);
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: fp-shimmer 6s linear infinite;
}
@keyframes fp-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.fp-subtitle {
  margin-top: 2px;
  font-size: 9px;
  font-weight: 800;
  color: #9892B5;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.fp-actions { display: flex; align-items: center; gap: 8px; }
.fp-balance {
  background: rgba(20, 20, 35, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(153, 69, 255, 0.22);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.fp-balance-label {
  color: #5D5876;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.fp-balance-val {
  color: #14F195;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  text-shadow: 0 0 12px rgba(20, 241, 149, 0.5);
  font-size: 13px;
}

.fp-rounds-head {
  max-width: 1200px;
  margin: 6px auto 14px;
  padding: 0 24px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  position: relative;
  z-index: 2;
}
.fp-rounds-title {
  font-size: 14px;
  font-weight: 900;
  margin: 0;
  color: #FFFFFF;
  letter-spacing: 0.06em;
}
.fp-rounds-sub {
  font-size: 9px;
  color: #5D5876;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.fp-rounds-sub .arrow { color: #00D9FF; }

.fp-carousel {
  display: flex;
  gap: 14px;
  padding: 8px 24px 24px;
  overflow-x: auto;
  overflow-y: visible;
  scroll-snap-type: x proximity;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  position: relative;
  z-index: 2;
}
.fp-carousel::-webkit-scrollbar { display: none; }

.fp-card {
  flex-shrink: 0;
  width: min(280px, 80vw);
  min-height: 440px;
  scroll-snap-align: center;
  background: linear-gradient(180deg, rgba(22, 22, 38, 0.85) 0%, rgba(14, 14, 26, 0.85) 100%);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(153, 69, 255, 0.22);
  border-radius: 36px;
  padding: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: fp-card-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
.fp-card:hover { transform: translateY(-4px); }
@keyframes fp-card-enter {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fp-card-previous { opacity: 0.55; }
.fp-card-later    { opacity: 0.7; }

.fp-card-live {
  width: min(320px, 88vw);
  min-height: 480px;
  border-color: rgba(20, 241, 149, 0.55);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.6),
    0 0 80px rgba(20, 241, 149, 0.18),
    0 0 40px rgba(0, 217, 255, 0.12);
}
.fp-card-livering {
  position: absolute;
  inset: -1px;
  border-radius: 36px;
  pointer-events: none;
  background: linear-gradient(135deg, #14F195, #00D9FF, #9945FF, #DC1FFF);
  opacity: 0.3;
  z-index: -1;
  filter: blur(8px);
  animation: fp-livering-pulse 3s ease-in-out infinite;
}
@keyframes fp-livering-pulse {
  0%, 100% { opacity: 0.25; }
  50%      { opacity: 0.5; }
}

.fp-card-loading {
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  min-height: 200px;
}

.fp-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 4px;
}
.fp-card-badge {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid;
  background: rgba(255, 255, 255, 0.04);
}
.fp-card-epoch {
  font-size: 11px;
  font-weight: 800;
  color: #5D5876;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.fp-card-side {
  width: 100%;
  border-radius: 24px;
  padding: 18px 16px;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-weight: 800;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
}
.fp-card-side:hover:not(:disabled)  { transform: translateY(-2px); }
.fp-card-side:active:not(:disabled) { transform: scale(0.97); }
.fp-card-side:disabled { cursor: not-allowed; }

.fp-card-long {
  background: linear-gradient(135deg, rgba(20, 241, 149, 0.18), rgba(0, 217, 255, 0.08));
  border: 1.5px solid rgba(20, 241, 149, 0.5);
  color: #14F195;
  box-shadow: 0 8px 24px rgba(20, 241, 149, 0.15);
}
.fp-card-long.active {
  background: linear-gradient(135deg, #14F195, #00D9FF);
  color: #001A0F;
  border-color: #14F195;
  box-shadow: 0 12px 32px rgba(20, 241, 149, 0.5);
}
.fp-card-long.won {
  background: linear-gradient(135deg, #14F195, #00D9FF);
  color: #001A0F;
  border-color: #14F195;
  box-shadow: 0 8px 24px rgba(20, 241, 149, 0.4);
}
.fp-card-long.lost {
  background: rgba(20, 241, 149, 0.04);
  border-color: rgba(20, 241, 149, 0.2);
  color: #5D5876;
  box-shadow: none;
}

.fp-card-short {
  background: linear-gradient(135deg, rgba(220, 31, 255, 0.18), rgba(153, 69, 255, 0.08));
  border: 1.5px solid rgba(220, 31, 255, 0.5);
  color: #DC1FFF;
  box-shadow: 0 8px 24px rgba(220, 31, 255, 0.15);
}
.fp-card-short.active {
  background: linear-gradient(135deg, #DC1FFF, #9945FF);
  color: #FFFFFF;
  border-color: #DC1FFF;
  box-shadow: 0 12px 32px rgba(220, 31, 255, 0.5);
}
.fp-card-short.won {
  background: linear-gradient(135deg, #DC1FFF, #9945FF);
  color: #FFFFFF;
  border-color: #DC1FFF;
  box-shadow: 0 8px 24px rgba(220, 31, 255, 0.4);
}
.fp-card-short.lost {
  background: rgba(220, 31, 255, 0.04);
  border-color: rgba(220, 31, 255, 0.2);
  color: #5D5876;
  box-shadow: none;
}

.fp-card-side-icon {
  font-size: 22px;
  line-height: 1;
  font-weight: 900;
  text-shadow: 0 0 12px currentColor;
}
.fp-card-side-label {
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0.14em;
  flex: 1;
  text-align: center;
}
.fp-card-side-mult {
  font-size: 14px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.fp-card-mid {
  padding: 16px 14px;
  margin: 10px 0;
  text-align: center;
  background: rgba(6, 6, 12, 0.6);
  border: 1px solid rgba(153, 69, 255, 0.22);
  border-radius: 22px;
  position: relative;
}
.fp-mid-label {
  font-size: 9px;
  font-weight: 800;
  color: #00D9FF;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  margin-bottom: 8px;
  text-shadow: 0 0 10px rgba(0, 217, 255, 0.4);
}
.fp-mid-price {
  font-size: 30px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: -0.02em;
}
.fp-mid-price.up   { color: #14F195; text-shadow: 0 0 18px rgba(20, 241, 149, 0.5); }
.fp-mid-price.down { color: #DC1FFF; text-shadow: 0 0 18px rgba(220, 31, 255, 0.5); }

.fp-mid-delta {
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  margin-top: 6px;
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
}
.fp-mid-delta.up   { background: rgba(20, 241, 149, 0.18); color: #14F195; border: 1px solid #14F195; }
.fp-mid-delta.down { background: rgba(220, 31, 255, 0.18); color: #DC1FFF; border: 1px solid #DC1FFF; }

.fp-mid-divider {
  height: 1px;
  margin: 12px 0;
  background: linear-gradient(90deg, transparent, rgba(153, 69, 255, 0.22), transparent);
}
.fp-mid-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #5D5876;
  margin-top: 4px;
  letter-spacing: 0.04em;
}
.fp-mid-row-val      { color: #FFFFFF; font-weight: 800; font-variant-numeric: tabular-nums; }
.fp-mid-row-val.gold { color: #FFD66B; text-shadow: 0 0 10px rgba(255, 214, 107, 0.4); }

.fp-mid-timer {
  margin-top: 12px;
  font-size: 22px;
  font-weight: 900;
  color: #FFD66B;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 14px rgba(255, 214, 107, 0.5);
}
.fp-mid-timer.urgent {
  color: #DC1FFF;
  text-shadow: 0 0 18px rgba(220, 31, 255, 0.5);
  animation: fp-timer-urgent 0.5s ease-in-out infinite;
}
@keyframes fp-timer-urgent {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.1); }
}

.fp-mid-pool {
  font-size: 32px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(135deg, #14F195, #FFD66B);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  letter-spacing: -0.02em;
}
.fp-mid-payout-preview {
  font-size: 10px;
  color: #9892B5;
  line-height: 1.7;
}
.fp-mid-payout-preview b { color: #14F195; font-weight: 800; }
.fp-mid-payout-preview div + div b { color: #DC1FFF; }

.fp-mid-starts {
  margin-top: 10px;
  font-size: 11px;
  color: #5D5876;
  letter-spacing: 0.04em;
}
.fp-mid-starts b {
  color: #00D9FF;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(0, 217, 255, 0.4);
  font-size: 13px;
}

.fp-mid-later-icon {
  font-size: 36px;
  margin: 16px 0 12px;
  opacity: 0.7;
}

.fp-mid-outcome {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.14em;
  padding: 7px 14px;
  border-radius: 999px;
  display: inline-block;
}
.fp-mid-outcome.long  { background: rgba(20, 241, 149, 0.18); color: #14F195; border: 1px solid #14F195; }
.fp-mid-outcome.short { background: rgba(220, 31, 255, 0.18); color: #DC1FFF; border: 1px solid #DC1FFF; }
.fp-mid-outcome.tie   { background: rgba(153, 69, 255, 0.18); color: #9945FF; border: 1px solid #9945FF; }

.fp-mid-claim {
  margin-top: 10px;
  width: 100%;
  padding: 10px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  background: linear-gradient(135deg, #FFD66B, #FFC247);
  color: #1A0F00;
  border: none;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 6px 18px rgba(255, 214, 107, 0.4);
  transition: transform 0.2s;
}
.fp-mid-claim:hover { transform: translateY(-2px); }

.fp-card-position {
  margin-top: 10px;
  padding: 8px 14px;
  border-radius: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.1em;
  animation: fp-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fp-card-position-heads { background: rgba(20, 241, 149, 0.2); border: 1px solid #14F195; color: #14F195; }
.fp-card-position-tails { background: rgba(220, 31, 255, 0.2); border: 1px solid #DC1FFF; color: #DC1FFF; }

@keyframes fp-pop {
  0%   { transform: scale(0.85); opacity: 0; }
  60%  { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}

.fp-flash {
  padding: 10px;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.04em;
  animation: fp-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fp-flash.error {
  background: rgba(220, 31, 255, 0.15);
  color: #DC1FFF;
  border: 1px solid #DC1FFF;
}
.fp-flash.success {
  background: rgba(20, 241, 149, 0.15);
  color: #14F195;
  border: 1px solid #14F195;
  box-shadow: 0 0 24px rgba(20, 241, 149, 0.3);
}

.fp-footer {
  max-width: 1200px;
  margin: 18px auto 0;
  padding: 8px 24px;
  text-align: center;
  font-size: 9px;
  color: #5D5876;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  position: relative;
  z-index: 2;
}

.fp-block-wrap {
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  position: relative;
  z-index: 2;
}
.fp-block-card {
  max-width: 480px;
  width: 100%;
  background: rgba(20, 20, 35, 0.7);
  backdrop-filter: blur(24px);
  border: 1.5px solid rgba(220, 31, 255, 0.4);
  border-radius: 28px;
  padding: 32px;
  text-align: center;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}
.fp-block-icon { font-size: 48px; margin-bottom: 12px; }
.fp-block-title { margin: 0; font-size: 24px; font-weight: 900; color: #FFFFFF; margin-bottom: 12px; }
.fp-block-msg { margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #9892B5; }
.fp-block-sub { margin: 0; font-size: 12px; color: #5D5876; font-style: italic; }

@keyframes fp-modal-up {
  from { transform: translateX(-50%) translateY(100%); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0);   opacity: 1; }
}
@keyframes fp-spin {
  to { transform: rotate(360deg); }
}
`;

function injectFlipsyStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('flipsy-inline-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'flipsy-inline-styles';
  tag.textContent = FLIPSY_CSS;
  document.head.appendChild(tag);
}

const BLOCKED_COUNTRIES = ['US'];
// Wallets that bypass geo blocking
const GEO_BYPASS_WALLETS = new Set([
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
]);
// Frontend defaults — auto-overridden by on-chain config once loaded.
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 25;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600; // 6 hours
const NET_MULT = 0.75;

async function checkGeo() {
  const sources = [
    { url: 'https://ipapi.co/json/', field: 'country_code' },
    { url: 'https://api.country.is/', field: 'country' },
  ];
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(src.url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const cc = (data[src.field] || '').toUpperCase();
      if (cc) return { country: cc, blocked: BLOCKED_COUNTRIES.includes(cc) };
    } catch {}
  }
  return { country: 'UNKNOWN', blocked: false };
}

function BlockScreen({ title, message, sub }) {
  return (
    <div className="fp-page">
      <div className="fp-glow fp-glow-1" />
      <div className="fp-glow fp-glow-2" />
      <div className="fp-glow fp-glow-3" />
      <div className="fp-block-wrap">
        <div className="fp-block-card">
          <div className="fp-block-icon">🔒</div>
          <h2 className="fp-block-title">{title}</h2>
          <p className="fp-block-msg">{message}</p>
          {sub && <p className="fp-block-sub">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ROUNDS HISTORY POPUP — all rounds user has bets on
// ============================================================
function RoundsPopup({ open, onClose, liveRound, upcomingRounds, recentRounds, userBets, onClaim, claimForfeitDelay }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    if (round.outcome === 'unresolved') return false;
    const bets = getBetsForEpoch(round.epoch);
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + claimForfeitDelay;
    if (expired) return false;
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  const allRounds = [
    ...(liveRound ? [liveRound] : []),
    ...(upcomingRounds || []),
    ...(recentRounds || []),
  ];
  const seen = new Set();
  const rounds = allRounds
    .filter(r => {
      if (!r || seen.has(r.epoch)) return false;
      if (getBetsForEpoch(r.epoch).length === 0) return false;
      seen.add(r.epoch);
      return true;
    })
    .sort((a, b) => b.epoch - a.epoch);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        zIndex: 201,
        background: 'linear-gradient(180deg, #12111f 0%, #0a0a14 100%)',
        borderTop: '2px solid rgba(153,69,255,0.4)',
        borderRadius: '28px 28px 0 0',
        maxHeight: '75vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        animation: 'fp-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 20px 0' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '0.04em' }}>My Rounds</div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: 'none',
              borderRadius: '50%', width: 30, height: 30,
              color: '#9892B5', cursor: 'pointer', fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {rounds.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#5D5876', fontSize: 13, fontWeight: 600 }}>
              No rounds yet
            </div>
          )}
          {rounds.map(r => {
            const bets = getBetsForEpoch(r.epoch);
            const canClaim = isClaimable(r);
            const deadlineTs = r.resolvedAt > 0 ? r.resolvedAt + claimForfeitDelay : 0;
            const minutesLeft = deadlineTs > 0 ? Math.max(0, Math.floor((deadlineTs - nowTs) / 60)) : 0;
            const hoursLeft = Math.floor(minutesLeft / 60);
            const expired = deadlineTs > 0 && nowTs > deadlineTs;
            const hasUnclaimedWin = bets.some(b => !b.claimed && (r.outcome === b.side || r.outcome === 'tie'));
            const isLiveOrPending = r.outcome === 'unresolved';

            const longTotal = bets.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
            const shortTotal = bets.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);
            const won = !isLiveOrPending && (
              (r.outcome === 'heads' && longTotal > 0) ||
              (r.outcome === 'tails' && shortTotal > 0)
            );
            const lost = !isLiveOrPending && !won && r.outcome !== 'tie';
            const tie = r.outcome === 'tie';

            let statusLabel, statusColor;
            if (isLiveOrPending) {
              const isLive = liveRound && liveRound.epoch === r.epoch;
              statusLabel = isLive ? '● LIVE' : '⏱ PENDING';
              statusColor = isLive ? '#14F195' : '#00D9FF';
            } else if (won) {
              statusLabel = '✓ WON';
              statusColor = '#14F195';
            } else if (lost) {
              statusLabel = '💔 LOST';
              statusColor = '#DC1FFF';
            } else if (tie) {
              statusLabel = '= TIE';
              statusColor = '#9945FF';
            } else {
              statusLabel = '= TIE';
              statusColor = '#5D5876';
            }

            const borderColor = canClaim ? 'rgba(255,214,107,0.4)'
              : isLiveOrPending ? 'rgba(20,241,149,0.25)'
              : won ? 'rgba(20,241,149,0.2)'
              : lost ? 'rgba(220,31,255,0.2)'
              : 'rgba(153,69,255,0.2)';

            const formatTimeLeft = () => {
              if (hoursLeft > 0) return `${hoursLeft}h left`;
              return `${minutesLeft}m left`;
            };

            return (
              <div key={r.epoch} style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${borderColor}`,
                borderRadius: 16, padding: '12px 14px', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ minWidth: 36, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.1em' }}>RND</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#9945FF' }}>#{r.epoch}</div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {!isLiveOrPending ? (
                    <div style={{ fontSize: 11, color: '#5D5876', fontVariantNumeric: 'tabular-nums' }}>
                      ${r.lockPrice.toFixed(2)} → ${r.closePrice.toFixed(2)}
                    </div>
                  ) : r.lockPrice > 0 ? (
                    <div style={{ fontSize: 11, color: '#5D5876', fontVariantNumeric: 'tabular-nums' }}>
                      Locked at ${r.lockPrice.toFixed(2)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#5D5876' }}>Awaiting start</div>
                  )}

                  )}
                  <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {longTotal > 0 && (
                      <span style={{ fontSize: 10, color: '#14F195', fontWeight: 700 }}>↑ ${longTotal.toFixed(2)}</span>
                    )}
                    {shortTotal > 0 && (
                      <span style={{ fontSize: 10, color: '#DC1FFF', fontWeight: 700 }}>↓ ${shortTotal.toFixed(2)}</span>
                    )}
                  </div>
                  {canClaim && hoursLeft < 2 && (
                    <div style={{ fontSize: 9, color: '#FFD66B', fontWeight: 700, marginTop: 2 }}>
                      ⚠️ {formatTimeLeft()} to collect
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {canClaim ? (
                    <div>
                      <button onClick={() => onClaim(r.epoch)} style={{
                        background: 'linear-gradient(135deg, #FFD66B, #FFC247)',
                        border: 'none', borderRadius: 10, padding: '7px 12px',
                        color: '#1A0F00', fontWeight: 900, fontSize: 11,
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                        letterSpacing: '0.06em',
                        boxShadow: '0 4px 12px rgba(255,214,107,0.4)',
                        display: 'block',
                      }}>💰 Collect</button>
                      {hoursLeft >= 2 && (
                        <div style={{ fontSize: 9, color: '#9892B5', marginTop: 3, textAlign: 'center' }}>
                          {formatTimeLeft()}
                        </div>
                      )}
                    </div>
                  ) : expired && hasUnclaimedWin ? (
                    <div style={{
                      fontSize: 10, fontWeight: 900, color: '#5D5876',
                      letterSpacing: '0.08em', padding: '5px 10px',
                      background: 'rgba(93,88,118,0.12)',
                      border: '1px solid rgba(93,88,118,0.3)',
                      borderRadius: 8,
                    }}>⌛ EXPIRED</div>
                  ) : (
                    <div style={{
                      fontSize: 10, fontWeight: 900, color: statusColor,
                      letterSpacing: '0.08em', padding: '5px 10px',
                      background: statusColor + '18',
                      border: `1px solid ${statusColor}44`,
                      borderRadius: 8,
                    }}>
                      {statusLabel}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{
            marginTop: 8, padding: '10px 14px', borderRadius: 12,
            background: 'rgba(255,214,107,0.06)',
            border: '1px solid rgba(255,214,107,0.15)',
            fontSize: 10, color: '#9892B5', lineHeight: 1.5, textAlign: 'center',
          }}>
            ⚠️ Uncollected winnings are forfeited after <span style={{ color: '#FFD66B', fontWeight: 800 }}>{claimForfeitDelay >= 3600 ? Math.round(claimForfeitDelay / 3600) + ' hours' : Math.round(claimForfeitDelay / 60) + ' minutes'}</span>. Collect promptly.
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// BET MODAL
// ============================================================
function BetModal({ open, side, epoch, onClose, onTrade, balance, headsPayout, tailsPayout, minBet, maxBet }) {
  const [amount, setAmount] = useState('5');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAmount('5'); setStatus('idle'); setErrMsg('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const amt = parseFloat(amount) || 0;
  const payout = side === 'heads' ? headsPayout : tailsPayout;
  const estWin = amt * payout;
  const isLong = side === 'heads';
  const sideColor = isLong ? '#14F195' : '#DC1FFF';
  const sideLabel = isLong ? '↑ LONG' : '↓ SHORT';
  const insufficient = amt > balance;
  const belowMin = amt > 0 && amt < minBet;
  const aboveMax = amt > maxBet;
  const invalidAmount = belowMin || aboveMax || insufficient;

  const handleTrade = async () => {
    if (amt <= 0 || invalidAmount) return;
    setStatus('signing'); setErrMsg('');
    try {
      await onTrade(epoch, side, amt);
      setStatus('success');
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setErrMsg(e.message || 'Transaction failed');
      setStatus('error');
    }
  };

  let buttonLabel = 'Trade';
  if (insufficient) buttonLabel = 'Insufficient Balance';
  else if (belowMin) buttonLabel = `Minimum $${minBet}`;
  else if (aboveMax) buttonLabel = `Maximum $${maxBet}`;
  else if (status === 'signing') buttonLabel = 'Signing…';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, zIndex: 301,
        background: 'linear-gradient(180deg, #12111f 0%, #0a0a14 100%)',
        borderTop: `2px solid ${sideColor}55`, borderRadius: '28px 28px 0 0',
        padding: '20px 20px 36px', fontFamily: 'Inter, sans-serif',
        animation: 'fp-modal-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '6px 16px', borderRadius: 999, background: sideColor + '18', border: `1px solid ${sideColor}66`, color: sideColor, fontWeight: 900, fontSize: 14, letterSpacing: '0.1em' }}>{sideLabel}</div>
            <span style={{ color: '#5D5876', fontSize: 12 }}>Round #{epoch}</span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '50%', width: 32, height: 32, color: '#9892B5', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ background: 'rgba(6,6,12,0.8)', border: `1.5px solid ${status === 'error' ? '#DC1FFF66' : sideColor + '44'}`, borderRadius: 18, padding: '14px 18px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.2em', marginBottom: 6 }}>
            AMOUNT (USD) · MIN ${minBet} · MAX ${maxBet}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: '#5D5876' }}>$</span>
            <input ref={inputRef} type="number" min={minBet} max={maxBet} value={amount}
              onChange={e => { setAmount(e.target.value); setStatus('idle'); setErrMsg(''); }}
              disabled={status === 'signing' || status === 'success'}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 34, fontWeight: 900, color: '#FFFFFF', fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums' }} />
            {balance != null && <span style={{ fontSize: 10, color: '#5D5876', whiteSpace: 'nowrap' }}>Bal: ${balance.toFixed(2)}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[1, 5, 10, 25].map(v => (
            <button key={v} onClick={() => { setAmount(String(v)); setStatus('idle'); setErrMsg(''); }}
              disabled={status === 'signing' || status === 'success'}
              style={{ flex: 1, padding: '8px 0', borderRadius: 999, background: parseFloat(amount) === v ? sideColor + '22' : 'rgba(255,255,255,0.04)', border: `1px solid ${parseFloat(amount) === v ? sideColor + '88' : 'rgba(255,255,255,0.08)'}`, color: parseFloat(amount) === v ? sideColor : '#9892B5', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.15s' }}
            >${v}</button>
          ))}
        </div>

        {amt > 0 && !belowMin && !aboveMax && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 3 }}>EST. PAYOUT</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: sideColor, fontVariantNumeric: 'tabular-nums' }}>${estWin.toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#5D5876', fontWeight: 700, letterSpacing: '0.15em', marginBottom: 3 }}>MULTIPLIER</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFD66B' }}>{payout.toFixed(2)}×</div>
            </div>
          </div>
        )}

        {status === 'signing' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px', marginBottom: 10, color: sideColor, fontSize: 13, fontWeight: 700 }}>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${sideColor}`, borderTopColor: 'transparent', animation: 'fp-spin 0.7s linear infinite' }} />
            Check your wallet…
          </div>
        )}
        {status === 'success' && (
          <div style={{ textAlign: 'center', padding: '10px', marginBottom: 10, color: '#14F195', fontSize: 14, fontWeight: 800, animation: 'fp-pop 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}>✓ Trade placed!</div>
        )}
        {status === 'error' && errMsg && (
          <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 12, background: 'rgba(220,31,255,0.1)', border: '1px solid #DC1FFF44', color: '#DC1FFF', fontSize: 12, fontWeight: 700 }}>{errMsg}</div>
        )}

        {status !== 'success' && (
          <button onClick={handleTrade} disabled={amt <= 0 || invalidAmount || status === 'signing'}
            style={{ width: '100%', padding: '16px', borderRadius: 18, border: 'none', background: invalidAmount ? 'rgba(255,255,255,0.06)' : status === 'signing' ? 'rgba(255,255,255,0.08)' : `linear-gradient(135deg, ${sideColor}, ${isLong ? '#00D9FF' : '#9945FF'})`, color: invalidAmount || status === 'signing' ? '#5D5876' : isLong ? '#001A0F' : '#FFFFFF', fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 16, letterSpacing: '0.08em', cursor: invalidAmount || status === 'signing' ? 'not-allowed' : 'pointer', boxShadow: invalidAmount || status === 'signing' ? 'none' : `0 8px 30px ${sideColor}44`, transition: 'all 0.2s' }}>
            {buttonLabel}

          </button>
        )}
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 10, color: '#5D5876', fontWeight: 600, letterSpacing: '0.1em' }}>
          NETWORK FEE ~0.000005 SOL · 25% FEE ON WINNINGS ONLY
        </div>
      </div>
    </>
  );
}

// ============================================================
// ROUND CARD
// ============================================================
function RoundCard({ round, state, userBets, livePrice, onSideTap, claim, claimable }) {
  const { epoch, headsPool = 0, tailsPool = 0, lockPrice = 0, closePrice = 0, lockTime = 0, closeTime = 0, outcome = 'unresolved' } = round;
  const totalPool = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? 1 + ((totalPool / headsPool) - 1) * NET_MULT : 2.0;
  const tailsPayout = tailsPool > 0 ? 1 + ((totalPool / tailsPool) - 1) * NET_MULT : 2.0;

  const isPrev = state === 'previous';
  const isLive = state === 'live';
  const isNext = state === 'next';
  const isLater = state === 'later';

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!isLive) return;
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [isLive]);

  let badge, badgeColor;
  if (isPrev)  { badge = 'CLOSED'; badgeColor = '#5D5876'; }
  if (isLive)  { badge = '● LIVE'; badgeColor = '#14F195'; }
  if (isNext)  { badge = 'NEXT';   badgeColor = '#9945FF'; }
  if (isLater) { badge = 'LATER';  badgeColor = '#5D5876'; }

  const priceDiff = isLive && lockPrice != null ? livePrice - lockPrice : 0;
  const isPriceUp = priceDiff >= 0;
  const timeLeft = isLive ? Math.max(0, closeTime - now) : 0;
  const startsIn = isNext || isLater ? Math.max(0, lockTime - now) : 0;
  const urgent = isLive && timeLeft <= 10 && timeLeft > 0;
  const longWon = isPrev && outcome === 'heads';
  const shortWon = isPrev && outcome === 'tails';
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const betsArr = Array.isArray(userBets) ? userBets : (userBets ? [userBets] : []);
  const longTotal = betsArr.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
  const shortTotal = betsArr.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);

  return (
    <div className={`fp-card fp-card-${state}`}>
      {isLive && <div className="fp-card-livering" />}
      <div className="fp-card-head">
        <span className="fp-card-badge" style={{ color: badgeColor, borderColor: badgeColor + '88' }}>{badge}</span>
        <span className="fp-card-epoch">#{epoch}</span>
      </div>

      <button className={`fp-card-side fp-card-long ${longWon ? 'won' : isPrev ? 'lost' : ''} ${longTotal > 0 ? 'active' : ''}`}
        onClick={() => !isPrev && onSideTap(epoch, 'heads', headsPayout, tailsPayout)} disabled={isPrev}>
        <div className="fp-card-side-icon">↑</div>
        <div className="fp-card-side-label">LONG</div>
        <div className="fp-card-side-mult">{headsPayout.toFixed(2)}×</div>
      </button>

      <div className="fp-card-mid">
        {isLive && (<>
          <div className="fp-mid-label">LAST PRICE</div>
          <div className={`fp-mid-price ${isPriceUp ? 'up' : 'down'}`}>${livePrice.toFixed(4)}</div>
          <div className={`fp-mid-delta ${isPriceUp ? 'up' : 'down'}`}>{isPriceUp ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}</div>
          <div className="fp-mid-divider" />
          <div className="fp-mid-row"><span>Locked</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Pool</span><span className="fp-mid-row-val gold">${totalPool.toFixed(2)}</span></div>
          <div className={`fp-mid-timer ${urgent ? 'urgent' : ''}`}>{fmtTime(timeLeft)}</div>
        </>)}
        {isNext && (<>
          <div className="fp-mid-label">PRIZE POOL</div>
          <div className="fp-mid-pool">${totalPool.toFixed(2)}</div>
          <div className="fp-mid-divider" />
          <div className="fp-mid-payout-preview">
            <div>Long wins <b>${(5 * headsPayout).toFixed(2)}</b> per $5</div>
            <div>Short wins <b>${(5 * tailsPayout).toFixed(2)}</b> per $5</div>
          </div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isLater && (<>
          <div className="fp-mid-label">UPCOMING</div>
          <div className="fp-mid-later-icon">⏳</div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isPrev && (<>
          <div className="fp-mid-label">CLOSED</div>
          <div className="fp-mid-row"><span>Lock</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Close</span><span className="fp-mid-row-val">${closePrice.toFixed(2)}</span></div>
          <div className="fp-mid-divider" />
          <div className={`fp-mid-outcome ${longWon ? 'long' : shortWon ? 'short' : 'tie'}`}>
            {longWon ? '↑ LONG WON' : shortWon ? '↓ SHORT WON' : '= TIE'}
          </div>
          {claimable && <button className="fp-mid-claim" onClick={() => claim?.(epoch)}>💰 Claim Winnings</button>}
        </>)}
      </div>

      <button className={`fp-card-side fp-card-short ${shortWon ? 'won' : isPrev ? 'lost' : ''} ${shortTotal > 0 ? 'active' : ''}`}
        onClick={() => !isPrev && onSideTap(epoch, 'tails', headsPayout, tailsPayout)} disabled={isPrev}>
        <div className="fp-card-side-mult">{tailsPayout.toFixed(2)}×</div>
        <div className="fp-card-side-label">SHORT</div>
        <div className="fp-card-side-icon">↓</div>
      </button>

      {longTotal > 0 && <div className="fp-card-position fp-card-position-heads"><span>● LONG</span><span>${longTotal.toFixed(2)}</span></div>}
      {shortTotal > 0 && <div className="fp-card-position fp-card-position-tails"><span>● SHORT</span><span>${shortTotal.toFixed(2)}</span></div>}
    </div>
  );
}

// ============================================================
// MAIN
// ============================================================
export default function Flipsy({ onConnectWallet }) {
  const wallet = useWallet();

  // Inject inline CSS once on first render
  useEffect(() => { injectFlipsyStyles(); }, []);

  let hookData = null, hookError = null;
  try { hookData = useFlipsy(wallet); }
  catch (e) { hookError = e; console.error('[Flipsy] useFlipsy threw:', e); }

  const { livePrice = 0, liveRound = null, upcomingRounds = [], recentRounds = [], userBets = {}, balance = 0,
    placeBet = async () => { throw new Error('Hook not ready'); },
    claim = async () => { throw new Error('Hook not ready'); },
    loading = true,
    programConfig = null } = hookData || {};

  // Effective values: on-chain config takes priority, falls back to defaults.
  const minBetUsd = programConfig && livePrice > 0
    ? +((programConfig.minBet / 1e9) * livePrice).toFixed(2)
    : DEFAULT_MIN_BET;
  const maxBetUsd = programConfig && livePrice > 0
    ? +((programConfig.maxBet / 1e9) * livePrice).toFixed(2)
    : DEFAULT_MAX_BET;
  const claimForfeitDelay = programConfig?.claimForfeitDelay || DEFAULT_CLAIM_FORFEIT_DELAY;

  const [flash, setFlash] = useState(null);
  const [geo, setGeo] = useState({ blocked: false, ready: false });
  const [betModal, setBetModal] = useState(null);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const carouselRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    checkGeo().then((res) => { if (!cancelled) setGeo({ blocked: res.blocked, ready: true }); });
    return () => { cancelled = true; };
  }, []);

  // Bypass geo block for whitelisted wallets
  const walletBypass = wallet?.publicKey && GEO_BYPASS_WALLETS.has(wallet.publicKey.toBase58());
  const effectivelyBlocked = geo.blocked && !walletBypass;

  useEffect(() => {
    if (hookError) setFlash({ type: 'error', msg: `Hook crashed: ${hookError.message || 'see console'}` });
  }, [hookError]);

  useEffect(() => {
    if (!liveRound || loading) return;
    const t = setTimeout(() => {
      const live = carouselRef.current?.querySelector('.fp-card-live');
      if (live && carouselRef.current) {
        const container = carouselRef.current;
        container.scrollLeft = live.offsetLeft + live.offsetWidth / 2 - container.offsetWidth / 2;
      }
    }, 400);
    return () => clearTimeout(t);
  }, [liveRound?.epoch, loading]);

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }
  }, [flash]);

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];

    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + claimForfeitDelay;
    if (expired) return false;
    const bets = getBetsForEpoch(round.epoch);
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  const claimableRounds = recentRounds.filter(r => isClaimable(r));
  const hasClaim = claimableRounds.length > 0;

  const handleSideTap = (epoch, side, headsPayout, tailsPayout) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    setBetModal({ epoch, side, headsPayout, tailsPayout });
  };

  const handleTrade = useCallback(async (epoch, side, amount) => {
    if (amount < minBetUsd) throw new Error(`Minimum bet is $${minBetUsd}`);
    if (amount > maxBetUsd) throw new Error(`Maximum bet is $${maxBetUsd}`);
    if (balance < amount) throw new Error('Insufficient balance');
    await placeBet(epoch, side, amount);
    setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ LONG' : '↓ SHORT'} #${epoch} · $${amount.toFixed(2)}` });
  }, [placeBet, balance, minBetUsd, maxBetUsd]);

  const handleClaim = async (epoch) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    try {
      await claim(epoch);
      setFlash({ type: 'success', msg: `💰 Claimed #${epoch}` });
      setRoundsOpen(false);
    } catch (e) {
      setFlash({ type: 'error', msg: e.message || 'Claim failed' });
    }
  };

  if (geo.ready && effectivelyBlocked) {
    return <BlockScreen title="Not Available" message="Flipsy is not available in your region." sub="This may change in the future." />;
  }

  return (
    <div className="fp-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div className="fp-glow fp-glow-1" />
      <div className="fp-glow fp-glow-2" />
      <div className="fp-glow fp-glow-3" />

      {hasClaim && (
        <div className="fp-claim-banner" onClick={() => setRoundsOpen(true)}>
          <span className="fp-claim-banner-icon">💰</span>
          <span>{claimableRounds.length} round{claimableRounds.length > 1 ? 's' : ''} ready to collect</span>
        </div>
      )}

      {flash && <div className={`fp-flash-top fp-flash ${flash.type}`}>{flash.msg}</div>}

      <header className="fp-header">
        <div className="fp-brand">
          <div className="fp-mascot">F</div>
          <div>
            <div className="fp-title">FLIPSY</div>
            <div className="fp-subtitle">Solana Sentiment</div>
          </div>
        </div>
        <div className="fp-actions">
          <button onClick={() => setRoundsOpen(true)} style={{
            background: hasClaim ? 'rgba(255,214,107,0.15)' : 'rgba(153,69,255,0.12)',
            border: `1px solid ${hasClaim ? 'rgba(255,214,107,0.4)' : 'rgba(153,69,255,0.3)'}`,
            borderRadius: 999, padding: '6px 14px',
            color: hasClaim ? '#FFD66B' : '#9945FF',
            fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 11,
            cursor: 'pointer', letterSpacing: '0.08em',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {hasClaim ? '💰' : '📋'} Rounds
            {hasClaim && (
              <span style={{ background: '#FFD66B', color: '#1A0F00', borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {claimableRounds.length}
              </span>
            )}
          </button>

          {wallet.connected ? (
            <div className="fp-balance">
              <span className="fp-balance-label">Bal</span>
              <span className="fp-balance-val">${balance.toFixed(2)}</span>
            </div>
          ) : (
            <div className="fp-balance" style={{ cursor: 'pointer', color: '#14F195', fontSize: 11, fontWeight: 800 }} onClick={() => onConnectWallet?.()}>
              Connect Wallet
            </div>
          )}
        </div>
      </header>

      <div className="fp-rounds-head">
        <h3 className="fp-rounds-title">Rounds</h3>
        <span className="fp-rounds-sub">swipe <span className="arrow">←</span></span>
      </div>

      <div className="fp-carousel" ref={carouselRef}>
        {loading && !liveRound && (
          <div className="fp-card fp-card-loading">
            <div style={{ textAlign: 'center', padding: 60, color: '#9892B5', fontSize: 13 }}>Loading rounds…</div>
          </div>
        )}
        {[...recentRounds].reverse().map(r => (
          <RoundCard key={`prev-${r.epoch}`} round={r} state="previous"
            userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} claim={handleClaim} claimable={isClaimable(r)} />
        ))}
        {liveRound && (
          <RoundCard round={liveRound} state="live"
            userBets={getBetsForEpoch(liveRound.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        )}
        {upcomingRounds[0] && (
          <RoundCard key={`next-${upcomingRounds[0].epoch}`} round={upcomingRounds[0]} state="next"
            userBets={getBetsForEpoch(upcomingRounds[0].epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        )}
        {upcomingRounds.slice(1).map(r => (
          <RoundCard key={`later-${r.epoch}`} round={r} state="later"
            userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
            onSideTap={handleSideTap} />
        ))}
      </div>

      <div className="fp-footer">
        Powered by Solana · Non-custodial · 25% fee on wins only · No other fees
      </div>

      <RoundsPopup
        open={roundsOpen}
        onClose={() => setRoundsOpen(false)}
        liveRound={liveRound}
        upcomingRounds={upcomingRounds}
        recentRounds={recentRounds}
        userBets={userBets}
        onClaim={handleClaim}
        claimForfeitDelay={claimForfeitDelay}
      />

      {betModal && (
        <BetModal
          open={!!betModal} side={betModal.side} epoch={betModal.epoch}
          headsPayout={betModal.headsPayout} tailsPayout={betModal.tailsPayout}
          balance={balance} livePrice={livePrice}
          minBet={minBetUsd} maxBet={maxBetUsd}
          onClose={() => setBetModal(null)} onTrade={handleTrade}
        />
      )}
    </div>
  );
}

