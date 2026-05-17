import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// CONFIG — same backbone as PredictionsTonight (Kalshi via DFlow on
// Solana). Different fee tier (6% vs 1.5%) because parlay UI provides
// real packaging value users will pay for.
// =====================================================================
const ENABLE_TRADING        = process.env.REACT_APP_KALSHI_LIVE_TRADING === '1';
const DFLOW_BUILDER_CODE    = process.env.REACT_APP_DFLOW_BUILDER_CODE || '';
const PARLAY_FEE_BPS        = 600;   // 6.00% per leg
const SWEEP_BONUS_FEE_BPS   = 200;   // 2.00% upfront for Sweep Bonus add-on
const SWEEP_BONUS_PAYOUT_BPS = 1000; // +10% extra payout if all legs hit
const DFLOW_API_BASE        = process.env.REACT_APP_DFLOW_API_BASE || '/api/dflow';

const TREASURY_ADDRESS = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';

const MIN_LEGS  = 2;
const MAX_LEGS  = 10;
const MIN_STAKE = 5;
const MAX_STAKE = 5000;

// =====================================================================
// DESIGN TOKENS — match PredictionsTonight / PerpsTrade exactly
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d', gold:'#ffcd3c',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  goldGlow:'0 0 22px rgba(255,205,60,.30)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Live',     label: 'Live' },
  { id: 'Tonight',  label: 'Tonight' },
  { id: 'NFL',      label: 'NFL' },
  { id: 'NBA',      label: 'NBA' },
  { id: 'NHL',      label: 'NHL' },
  { id: 'MLB',      label: 'MLB' },
  { id: 'UFC',      label: 'UFC' },
  { id: 'Soccer',   label: 'Soccer' },
];

const LEAGUE_COLORS = {
  NFL:    ['#013369', '#d50a0a'],
  NBA:    ['#c8102e', '#1d428a'],
  NHL:    ['#6dd5ed', '#2193b0'],
  MLB:    ['#002d72', '#d50032'],
  UFC:    ['#d20a0a', '#1a1a1a'],
  SOCCER: ['#00a651', '#0033a0'],
  TENNIS: ['#c2d600', '#0a5c36'],
};
function leagueAccent(league) {
  return LEAGUE_COLORS[(league || '').toUpperCase()] || ['#a87fff', '#97fce4'];
}

// =====================================================================
// HOOKS / UTILS
// =====================================================================
let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  n = Number(n);
  d = d != null ? d : 2;
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return '$' + n.toFixed(d);
}
function shortNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(1) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(0) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
  return '$' + x.toFixed(0);
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidSolAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }
function priceToCents(price) {
  const p = Math.max(0, Math.min(1, Number(price) || 0));
  return Math.round(p * 100);
}

// Combined implied probability = product of individual leg probabilities
function combinedProbability(legs) {
  if (!legs.length) return 0;
  return legs.reduce((p, l) => p * Math.max(0.01, Math.min(0.99, l.price)), 1);
}
function americanOddsFromProb(prob) {
  if (prob <= 0 || prob >= 1) return '—';
  const decimal = 1 / prob;
  if (decimal >= 2) return '+' + Math.round((decimal - 1) * 100);
  return String(Math.round(-100 / (decimal - 1)));
}
function decimalMultiplier(prob) {
  if (prob <= 0) return 0;
  return 1 / prob;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function dflowRequest(path, body, opts = {}) {
  const url = DFLOW_API_BASE + path;
  const res = await fetchWithTimeout(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, opts.timeoutMs || 12_000);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || data?.detail || `DFlow request failed (${res.status})`);
  return data;
}

async function fetchSportsMarkets() {
  if (!ENABLE_TRADING) return getMockMarkets();
  try {
    const data = await dflowRequest('/prediction/markets?category=sports,politics');
    if (Array.isArray(data?.markets) && data.markets.length > 0) {
      return data.markets.map(normalizeMarket);
    }
    return getMockMarkets();
  } catch (e) {
    console.warn('[parlay markets fallback to mock]', e?.message || e);
    return getMockMarkets();
  }
}

async function buildLegTx({ market, side, usdcAmount, walletPubkey }) {
  if (!market?.id) throw new Error('Market unavailable');
  if (!walletPubkey) throw new Error('Wallet not connected');
  if (!ENABLE_TRADING) throw new Error('Live trading disabled');
  return await dflowRequest('/prediction/order/build', {
    marketId:      market.id,
    side:          side === 'YES' ? 'YES' : 'NO',
    usdcAmount:    Number(usdcAmount.toFixed(2)),
    userWallet:    walletPubkey,
    builderCode:   DFLOW_BUILDER_CODE,
    builderFeeBps: PARLAY_FEE_BPS,
    feeRecipient:  TREASURY_ADDRESS,
  });
}
async function submitSignedTx(serializedTx) {
  return await dflowRequest('/prediction/order/submit', { signedTxBase64: serializedTx }, { timeoutMs: 20_000 });
}

function normalizeMarket(raw) {
  return {
    id:           raw.id || raw.ticker || raw.market_id,
    league:       (raw.league || raw.sport || raw.category || '').toUpperCase(),
    category:     raw.category || 'tonight',
    question:     raw.question || raw.title || '',
    subtitle:     raw.subtitle || raw.matchup || '',
    yesPrice:     Number(raw.yesPrice ?? raw.yes_price ?? 0.5),
    noPrice:      Number(raw.noPrice ?? raw.no_price ?? 0.5),
    closeTs:      Number(raw.closeTs ?? raw.close_time ?? Date.now() + 3600_000),
    gameStartTs:  Number(raw.gameStartTs ?? raw.game_start ?? 0) || null,
    isLive:       Boolean(raw.isLive ?? raw.is_live),
    liveStatus:   raw.liveStatus || '',
    volume24h:    Number(raw.volume24h ?? raw.vol ?? 0),
    primetime:    Boolean(raw.primetime),
  };
}

function getMockMarkets() {
  const now = Date.now();
  return [
    { id: 'NFL-DAL-PHI-ML',   league:'NFL', category:'tonight', question:'Cowboys beat Eagles on SNF?',  subtitle:'DAL @ PHI', primetime:true, yesPrice:0.47, noPrice:0.53, closeTs:nextHourAt(20), gameStartTs:nextHourAt(20), volume24h:3_240_000 },
    { id: 'NFL-DAL-PHI-OVER', league:'NFL', category:'tonight', question:'Over 47.5 total points?',      subtitle:'DAL @ PHI · Total', yesPrice:0.55, noPrice:0.45, closeTs:nextHourAt(20), gameStartTs:nextHourAt(20), volume24h:840_000 },
    { id: 'NBA-LAL-BOS-ML',   league:'NBA', category:'live',    question:'Lakers beat Celtics?',         subtitle:'LAL @ BOS', isLive:true, liveStatus:'Q2 4:12', yesPrice:0.58, noPrice:0.42, closeTs:now + 92*60_000, volume24h:1_840_000 },
    { id: 'NBA-LAL-BOS-OVER', league:'NBA', category:'live',    question:'Over 224.5 total points?',     subtitle:'LAL @ BOS · Total', isLive:true, liveStatus:'Q2 4:12', yesPrice:0.61, noPrice:0.39, closeTs:now + 92*60_000, volume24h:612_000 },
    { id: 'NBA-GSW-DEN-ML',   league:'NBA', category:'tonight', question:'Warriors beat Nuggets?',        subtitle:'GSW @ DEN', yesPrice:0.42, noPrice:0.58, closeTs:nextHourAt(22), gameStartTs:nextHourAt(22), volume24h:624_000 },
    { id: 'NBA-MIA-NYK-ML',   league:'NBA', category:'tonight', question:'Heat beat Knicks?',             subtitle:'MIA @ NYK', yesPrice:0.39, noPrice:0.61, closeTs:nextHourAt(19), gameStartTs:nextHourAt(19), volume24h:488_000 },
    { id: 'NHL-EDM-COL-ML',   league:'NHL', category:'live',    question:'Oilers beat Avalanche?',        subtitle:'EDM @ COL', isLive:true, liveStatus:'P2 8:44', yesPrice:0.44, noPrice:0.56, closeTs:now + 64*60_000, volume24h:218_000 },
    { id: 'NHL-NYR-BOS-ML',   league:'NHL', category:'tonight', question:'Rangers beat Bruins?',          subtitle:'NYR @ BOS', yesPrice:0.51, noPrice:0.49, closeTs:nextHourAt(19), gameStartTs:nextHourAt(19), volume24h:142_000 },
    { id: 'MLB-LAD-SF-ML',    league:'MLB', category:'tonight', question:'Dodgers beat Giants?',          subtitle:'LAD @ SF', yesPrice:0.56, noPrice:0.44, closeTs:nextHourAt(22), gameStartTs:nextHourAt(22), volume24h:218_000 },
    { id: 'UFC-MAIN-CARD',    league:'UFC', category:'tonight', question:'Main event ends inside the distance?', subtitle:'UFC 320 · Main Card', primetime:true, yesPrice:0.57, noPrice:0.43, closeTs:now + 5*3600_000, gameStartTs:now + 5*3600_000, volume24h:384_000 },
    { id: 'EPL-LIV-MCI',      league:'SOCCER', category:'tonight', question:'Liverpool beat Man City?',   subtitle:'LIV vs MCI · EPL', yesPrice:0.46, noPrice:0.54, closeTs:nextHourAt(15), gameStartTs:nextHourAt(15), volume24h:224_000 },
  ];
}
function nextHourAt(hourET) {
  const d = new Date();
  d.setHours(hourET, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function LeagueIcon({ league, size = 36, label }) {
  const [a, b] = leagueAccent(league);
  const txt = (label || league || '?').slice(0, 3).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${a},${b})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 900, textShadow: '0 1px 3px rgba(0,0,0,.6)',
      fontSize: Math.round(size * 0.30), letterSpacing: '-.02em', flexShrink: 0,
      boxShadow: `0 4px 12px ${a}40`, ...T.display,
    }}>{txt}</div>
  );
}

function LiveDot({ size = 7, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: size, height: size, borderRadius: '50%', background: C.live, boxShadow: `0 0 ${size}px ${C.live}`, animation: 'nx-pulse 1.4s ease-in-out infinite' }}/>
      {label && <span style={{ color: C.live, fontSize: 9, fontWeight: 800, letterSpacing: '.08em', ...T.mono }}>{label}</span>}
    </span>
  );
}

// =====================================================================
// MarketTile — compact card with YES/NO add buttons. Highlights the
// side already added to the parlay slip.
// =====================================================================
function MarketTile({ market, addedSide, onAdd, disabled }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: `1px solid ${C.hairline}`,
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
      opacity: disabled && !addedSide ? 0.55 : 1,
    }}>
      <LeagueIcon league={market.league} size={36} label={market.league}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-.01em', ...T.body, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {market.question}
        </div>
        <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {market.isLive
            ? <LiveDot label={market.liveStatus || 'LIVE'}/>
            : <span style={{ color: C.muted, fontSize: 9, fontWeight: 600, ...T.mono }}>{market.subtitle}</span>
          }
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        {['YES','NO'].map(side => {
          const isAdded = addedSide === side;
          const isOpposite = addedSide && addedSide !== side;
          const sideColor = side === 'YES' ? C.up : C.down;
          const bg = isAdded
            ? (side === 'YES' ? 'rgba(61,213,152,.24)' : 'rgba(255,138,158,.24)')
            : (side === 'YES' ? 'rgba(61,213,152,.10)' : 'rgba(255,138,158,.10)');
          const bd = isAdded
            ? (side === 'YES' ? 'rgba(61,213,152,.60)' : 'rgba(255,138,158,.60)')
            : (side === 'YES' ? 'rgba(61,213,152,.28)' : 'rgba(255,138,158,.28)');
          const price = side === 'YES' ? market.yesPrice : market.noPrice;
          return (
            <button
              key={side}
              onClick={() => onAdd(market, side)}
              disabled={disabled && !isAdded && !isOpposite}
              style={{
                padding: '6px 9px', borderRadius: 9,
                background: bg, border: `1px solid ${bd}`,
                color: sideColor, fontWeight: 800, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 50,
                transition: 'all .15s',
                boxShadow: isAdded ? `0 0 12px ${sideColor}40` : 'none',
                ...T.mono,
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 700, opacity: .8, letterSpacing: '.06em' }}>{side}{isAdded ? ' ✓' : ''}</span>
              <span style={{ fontSize: 12, fontWeight: 800, marginTop: 1 }}>{priceToCents(price)}¢</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// LegRow — one leg inside the parlay slip
// =====================================================================
function LegRow({ leg, onRemove }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 12,
      background: 'rgba(255,255,255,.03)',
      border: `1px solid ${C.border}`,
      marginBottom: 8, display: 'grid',
      gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center',
    }}>
      <LeagueIcon league={leg.market.league} size={28} label={leg.market.league}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: leg.side === 'YES' ? C.up : C.down, padding: '1px 5px', borderRadius: 4, background: leg.side === 'YES' ? 'rgba(61,213,152,.14)' : 'rgba(255,138,158,.14)', ...T.mono }}>{leg.side}</span>
          <span style={{ fontSize: 9, color: C.muted, fontWeight: 700, ...T.mono }}>{priceToCents(leg.price)}¢</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.inkStr, fontWeight: 600, lineHeight: 1.3, ...T.body, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {leg.market.question}
        </div>
      </div>
      <button onClick={() => onRemove(leg.market.id)} style={{
        background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`,
        color: C.muted, width: 26, height: 26, borderRadius: 8, fontSize: 14,
        cursor: 'pointer', flexShrink: 0,
      }}>×</button>
    </div>
  );
}

// =====================================================================
// ParlaySlipModal — bottom sheet with full slip + place parlay
// =====================================================================
function ParlaySlipModal({ open, legs, onClose, onRemove, onClearAll, walletPubkey, onConnectWallet, onSubmit, submitState }) {
  const { connected } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [stake, setStake]     = useState('');
  const [bonus, setBonus]     = useState(false);
  const [error, setError]     = useState('');

  useBodyLock(open);
  useEffect(() => { if (!open) { setStake(''); setBonus(false); setError(''); } }, [open]);

  const usd       = parseFloat(stake) || 0;
  const validStake = usd >= MIN_STAKE && usd <= MAX_STAKE;
  const enoughLegs = legs.length >= MIN_LEGS;

  const combProb  = useMemo(() => combinedProbability(legs), [legs]);
  const decMult   = decimalMultiplier(combProb);
  const americanOdds = americanOddsFromProb(combProb);

  // Round-robin: stake distributed evenly across legs.
  // Each leg's max payout if it hits = (stake/N) / legPrice.
  // Sum of all leg payouts if every leg hits = base parlay sweep payout.
  const stakePerLeg = usd > 0 && legs.length > 0 ? usd / legs.length : 0;
  const sweepPayout = useMemo(() => {
    if (!stakePerLeg) return 0;
    return legs.reduce((sum, l) => sum + (stakePerLeg / Math.max(0.01, l.price)), 0);
  }, [legs, stakePerLeg]);

  const builderFeeTotal = usd * (PARLAY_FEE_BPS / 10_000);
  const bonusFee        = bonus ? usd * (SWEEP_BONUS_FEE_BPS / 10_000) : 0;
  const bonusPayout     = bonus ? sweepPayout * (SWEEP_BONUS_PAYOUT_BPS / 10_000) : 0;
  const finalSweepPayout = sweepPayout + bonusPayout;
  const totalCost = usd + builderFeeTotal + bonusFee;

  const quickChips = [10, 25, 100, 250];

  const isBusy    = submitState?.kind === 'loading';
  const isSuccess = submitState?.kind === 'success';

  if (!open) return null;

  const handlePlace = () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!enoughLegs) { setError(`Need at least ${MIN_LEGS} legs`); return; }
    if (!validStake) { setError(`Stake between $${MIN_STAKE}–$${MAX_STAKE.toLocaleString()}`); return; }
    if (!walletPubkey || !isValidSolAddress(walletPubkey)) { setError('Wallet not connected'); return; }
    setError('');
    onSubmit({ legs, stake: usd, bonusEnabled: bonus, stakePerLeg, builderFeeTotal, bonusFee });
  };

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 560, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 16px' }}/>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.inkStr, letterSpacing: '-.02em', ...T.display }}>
                Your parlay
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>
                {legs.length} {legs.length === 1 ? 'leg' : 'legs'} · {americanOdds} odds · {decMult.toFixed(2)}x
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {legs.length > 0 && (
                <button onClick={isBusy ? undefined : onClearAll} disabled={isBusy} style={{ background: 'rgba(255,138,158,.10)', border: '1px solid rgba(255,138,158,.30)', color: C.down, padding: '7px 11px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: isBusy ? 'not-allowed' : 'pointer', ...T.mono }}>Clear</button>
              )}
              <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: isBusy ? 'not-allowed' : 'pointer' }}>×</button>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 14px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          {legs.length === 0 ? (
            <div style={{ padding: '30px 14px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              Tap YES or NO on any market to add it to your parlay.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                {legs.map(leg => <LegRow key={leg.market.id} leg={leg} onRemove={onRemove}/>)}
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>STAKE (USDC)</span>
                  <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>6% FEE</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
                  <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
                  <input value={stake} onChange={e => { setStake(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy} inputMode="decimal" enterKeyHint="done"
                    style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}/>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>USDC</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {quickChips.map(c => (
                    <button key={c} onClick={() => { setStake(String(c)); setError(''); }} disabled={isBusy} style={{ flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,.03)', color: C.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono }}>${c}</button>
                  ))}
                </div>
              </div>

              {/* Sweep Bonus toggle */}
              <button
                onClick={() => !isBusy && setBonus(!bonus)}
                disabled={isBusy}
                style={{
                  width: '100%', padding: '12px 14px', marginBottom: 14,
                  background: bonus ? 'rgba(255,205,60,.10)' : 'rgba(255,255,255,.03)',
                  border: bonus ? '1px solid rgba(255,205,60,.40)' : `1px solid ${C.border}`,
                  borderRadius: 14, cursor: isBusy ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  boxShadow: bonus ? C.goldGlow : 'none',
                  transition: 'all .15s',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: bonus ? C.gold : C.ink, ...T.display }}>Sweep Bonus</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: bonus ? C.gold : C.muted2, padding: '1px 5px', borderRadius: 4, background: bonus ? 'rgba(255,205,60,.14)' : 'rgba(255,255,255,.04)', letterSpacing: '.06em', ...T.mono }}>+10% PAYOUT</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.4, ...T.body }}>
                    Pay 2% extra. Get +10% added to your payout if every leg hits.
                  </div>
                </div>
                <div style={{
                  width: 36, height: 20, borderRadius: 999,
                  background: bonus ? C.gold : 'rgba(255,255,255,.08)',
                  position: 'relative', flexShrink: 0,
                  transition: 'background .2s',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, left: bonus ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', transition: 'left .2s',
                  }}/>
                </div>
              </button>

              {/* Preview */}
              {usd > 0 && (
                <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>ORDER PREVIEW</div>
                  {[
                    ['Stake (split per leg)',  fmt(stake, 2) + ' (' + fmt(stakePerLeg, 2) + '/leg)'],
                    ['Builder fee 6%',         '-' + fmt(builderFeeTotal, 2)],
                    bonus ? ['Sweep bonus fee 2%', '-' + fmt(bonusFee, 2)] : null,
                    ['Total cost',             fmt(totalCost, 2)],
                  ].filter(Boolean).map(([l, v], i, a) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                      <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                      <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', marginTop: 6, borderTop: `1px solid ${C.hairline}` }}>
                    <span style={{ color: bonus ? C.gold : C.up, fontWeight: 700, fontSize: 12, ...T.body }}>
                      Max sweep payout {bonus ? '(w/ bonus)' : ''}
                    </span>
                    <span style={{ color: bonus ? C.gold : C.up, fontWeight: 800, fontSize: 15, ...T.mono }}>+{fmt(finalSweepPayout, 2)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted2, marginTop: 6, lineHeight: 1.4, ...T.body }}>
                    Each leg pays independently. Maximum payout shown is if every leg hits.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {submitState?.kind === 'loading' && submitState.message && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nx-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{submitState.message}</span>
            </div>
          )}
          {(error || submitState?.kind === 'error') && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>
              {error || submitState?.message}
            </div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Solana Wallet
            </button>
          ) : (
            <button onClick={handlePlace} disabled={isBusy || !enoughLegs || !validStake} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : bonus
                ? `linear-gradient(135deg,${C.gold} 0%,${C.amber} 100%)`
                : `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !enoughLegs || !validStake ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !enoughLegs || !validStake ? 0.55 : 1,
              boxShadow: bonus ? C.goldGlow : '0 12px 30px rgba(151,252,228,.18)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Placing parlay...' :
               isSuccess ? 'Parlay placed' :
               !enoughLegs ? `Add ${MIN_LEGS - legs.length} more leg${MIN_LEGS - legs.length === 1 ? '' : 's'}` :
               !validStake ? `Enter stake ($${MIN_STAKE} min)` :
               `Place ${legs.length}-leg parlay · ${fmt(totalCost, 2)}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Each leg executes as a separate Kalshi contract · Non-custodial
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Floating slip button (bottom-right when legs > 0)
// =====================================================================
function FloatingSlipButton({ legs, onClick }) {
  if (!legs.length) return null;
  const combProb  = combinedProbability(legs);
  const mult = decimalMultiplier(combProb);
  return (
    <button onClick={onClick} style={{
      position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom) + 96px)',
      right: 16, zIndex: 300,
      padding: '12px 16px',
      background: `linear-gradient(135deg, ${C.hl} 0%, ${C.violet} 100%)`,
      border: 'none', borderRadius: 999,
      color: '#04070f', fontWeight: 800, fontSize: 13,
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: `0 12px 30px rgba(151,252,228,.30), ${C.glow}`,
      letterSpacing: '-.01em', ...T.display,
    }}>
      <span style={{
        background: 'rgba(4,7,15,.20)', borderRadius: 999,
        padding: '2px 9px', fontSize: 12, fontWeight: 900,
        ...T.mono,
      }}>{legs.length}</span>
      <span>Parlay · {mult.toFixed(2)}x</span>
    </button>
  );
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================
export default function ParlayBuilder({ onConnectWallet }) {
  const [markets, setMarkets] = useState([]);
  const [legs, setLegs]       = useState([]);
  const [filter, setFilter]   = useState('All');
  const [slipOpen, setSlipOpen] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });

  const { publicKey: solPk, signTransaction } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Poll markets
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchSportsMarkets();
        if (!alive || !Array.isArray(data) || data.length === 0) return;
        setMarkets(data);
      } catch (e) { console.warn('[parlay markets poll]', e?.message || e); }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const addLeg = useCallback((market, side) => {
    setLegs(prev => {
      const existing = prev.find(l => l.market.id === market.id);
      if (existing) {
        if (existing.side === side) {
          // Tap same side again: remove leg
          return prev.filter(l => l.market.id !== market.id);
        }
        // Different side: swap
        return prev.map(l => l.market.id === market.id
          ? { ...l, side, price: side === 'YES' ? market.yesPrice : market.noPrice }
          : l);
      }
      if (prev.length >= MAX_LEGS) return prev;
      return [...prev, {
        market, side,
        price: side === 'YES' ? market.yesPrice : market.noPrice,
      }];
    });
  }, []);

  const removeLeg = useCallback(marketId => {
    setLegs(prev => prev.filter(l => l.market.id !== marketId));
  }, []);

  const clearAll = useCallback(() => setLegs([]), []);

  // Sequential transaction submission. MVP — user signs each leg.
  const submitParlay = async ({ legs: parlayLegs, stake, bonusEnabled, stakePerLeg }) => {
    if (!walletPubkey) { setSubmitState({ kind: 'error', message: 'Wallet not connected' }); return; }
    if (!signTransaction) { setSubmitState({ kind: 'error', message: 'Wallet cannot sign' }); return; }

    try {
      for (let i = 0; i < parlayLegs.length; i++) {
        const leg = parlayLegs[i];
        setSubmitState({ kind: 'loading', message: `Placing leg ${i + 1} of ${parlayLegs.length}...` });
        const built = await buildLegTx({
          market: leg.market, side: leg.side,
          usdcAmount: stakePerLeg, walletPubkey,
        });
        if (!built?.serializedTx) throw new Error(`Leg ${i + 1}: builder returned no transaction`);

        const txBytes = Uint8Array.from(atob(built.serializedTx), c => c.charCodeAt(0));
        let tx;
        try { tx = VersionedTransaction.deserialize(txBytes); }
        catch { tx = Transaction.from(txBytes); }

        const signed = await signTransaction(tx);
        const serialized = btoa(String.fromCharCode(...signed.serialize()));
        const result = await submitSignedTx(serialized);
        if (!result?.ok) throw new Error(`Leg ${i + 1}: ${result?.error || 'rejected'}`);
      }

      // Optional: record sweep-bonus opt-in to backend for payout tracking
      if (bonusEnabled) {
        try {
          await dflowRequest('/parlay/bonus/register', {
            wallet: walletPubkey, stake,
            legs: parlayLegs.map(l => ({ marketId: l.market.id, side: l.side, price: l.price })),
            bonusBps: SWEEP_BONUS_PAYOUT_BPS,
          });
        } catch (e) { console.warn('[bonus register]', e?.message || e); }
      }

      setSubmitState({ kind: 'success', message: 'Parlay placed' });
      setLegs([]);
      setTimeout(() => { setSlipOpen(false); setSubmitState({ kind: 'idle', message: '' }); }, 2200);
    } catch (e) {
      console.error('[parlay submit]', e);
      setSubmitState({ kind: 'error', message: e.message || 'Parlay failed' });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4000);
    }
  };

  // Filter markets
  const filtered = useMemo(() => {
    if (filter === 'All')     return markets;
    if (filter === 'Live')    return markets.filter(m => m.isLive);
    if (filter === 'Tonight') return markets.filter(m => m.category === 'tonight' || m.isLive);
    return markets.filter(m => (m.league || '').toUpperCase() === filter.toUpperCase());
  }, [markets, filter]);

  const totalVol = useMemo(() => markets.reduce((s, m) => s + Number(m.volume24h || 0), 0), [markets]);
  const liveCount = useMemo(() => markets.filter(m => m.isLive).length, [markets]);

  // Pre-compute combined odds preview
  const combProb = combinedProbability(legs);
  const decMult  = decimalMultiplier(combProb);
  const atMaxLegs = legs.length >= MAX_LEGS;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nx-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nx-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(168,127,255,.16),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl }}/>
              <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>PARLAY MODE</span>
            </div>
            <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.04em', ...T.hero }}>
              Build your{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>parlay</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 16px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Stack 2-10 Kalshi outcomes. Sweep them all for a bigger payout. Each leg trades independently.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { label: 'LEGS',  value: legs.length || '0',                     color: legs.length ? C.hl : C.inkStr },
                { label: 'ODDS',  value: legs.length >= 2 ? decMult.toFixed(2) + 'x' : '—', color: legs.length >= 2 ? C.gold : C.inkStr },
                { label: 'LIVE',  value: liveCount || '0',                       color: liveCount ? C.live : C.inkStr },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FILTER PILLS */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '7px 13px', borderRadius: 999,
              border: `1px solid ${filter === f.id ? (f.id === 'Live' ? 'rgba(255,61,93,.40)' : C.borderHi) : C.border}`,
              background: filter === f.id ? (f.id === 'Live' ? 'rgba(255,61,93,.12)' : C.hlDim) : 'rgba(255,255,255,.03)',
              color: filter === f.id ? (f.id === 'Live' ? C.live : C.hl) : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, ...T.body,
            }}>
              {f.id === 'Live' && liveCount > 0 ? `${f.label} · ${liveCount}` : f.label}
            </button>
          ))}
        </div>

        {/* AT-MAX BANNER */}
        {atMaxLegs && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', fontSize: 11.5, color: C.amber, fontWeight: 700, ...T.body }}>
            Max {MAX_LEGS} legs reached. Remove a leg from the slip to add another.
          </div>
        )}

        {/* MARKET LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              Loading markets...
            </div>
          ) : filtered.map(m => {
            const leg = legs.find(l => l.market.id === m.id);
            return (
              <MarketTile
                key={m.id}
                market={m}
                addedSide={leg?.side}
                onAdd={addLeg}
                disabled={atMaxLegs}
              />
            );
          })}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>KALSHI</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          Each parlay leg executes as a separate Kalshi contract. 6% builder fee per leg. Sweep Bonus paid by Verixia Apps when every leg hits.
        </div>

        <FloatingSlipButton legs={legs} onClick={() => setSlipOpen(true)}/>

        <ParlaySlipModal
          open={slipOpen}
          legs={legs}
          onClose={() => setSlipOpen(false)}
          onRemove={removeLeg}
          onClearAll={clearAll}
          walletPubkey={walletPubkey}
          onConnectWallet={onConnectWallet}
          onSubmit={submitParlay}
          submitState={submitState}
        />
      </div>
    </>
  );
}
