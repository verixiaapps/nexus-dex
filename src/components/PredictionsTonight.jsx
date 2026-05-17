import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction, Transaction } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// CONFIG — same backbone as DeFiPredict.jsx (Kalshi via DFlow on Solana).
// Same builder code, same treasury, same 1.5% fee. This page is the
// sports + events surface area. Crypto lives in DeFiPredict.
// =====================================================================
const ENABLE_TRADING        = process.env.REACT_APP_KALSHI_LIVE_TRADING === '1';
const DFLOW_BUILDER_CODE    = process.env.REACT_APP_DFLOW_BUILDER_CODE || '';
const DFLOW_BUILDER_FEE_BPS = 150; // 1.5%
const DFLOW_API_BASE        = process.env.REACT_APP_DFLOW_API_BASE || '/api/dflow';

const TREASURY_ADDRESS      = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const USDC_DECIMALS         = 6;
const LAMPORTS_PER_SOL      = 1_000_000_000;

const RESTRICTED_STATES = ['AZ', 'IL', 'MD', 'MI', 'MT', 'NJ', 'OH', 'MA', 'NV'];
const TOS_VERSION       = 1; // shared with DeFiPredict — once accepted, both pages skip the gate
const MIN_ORDER_USDC    = 1;
const MAX_ORDER_USDC    = 25000;

// =====================================================================
// DESIGN TOKENS — keep identical to PerpsTrade / DeFiPredict
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  liveGlow:'0 0 20px rgba(255,61,93,.35),0 0 40px rgba(255,61,93,.15)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

// =====================================================================
// LEAGUE / CATEGORY FILTERS — ordered by profitability per our analysis:
// Live → Tonight → NFL → NBA → Player Props → other leagues → events
// =====================================================================
const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Live',     label: 'Live' },
  { id: 'Tonight',  label: 'Tonight' },
  { id: 'NFL',      label: 'NFL' },
  { id: 'NBA',      label: 'NBA' },
  { id: 'Props',    label: 'Player Props' },
  { id: 'NHL',      label: 'NHL' },
  { id: 'MLB',      label: 'MLB' },
  { id: 'UFC',      label: 'UFC' },
  { id: 'Soccer',   label: 'Soccer' },
  { id: 'Politics', label: 'Politics' },
  { id: 'Events',   label: 'Events' },
  { id: 'Futures',  label: 'Futures' },
];

// League-specific colors for the icon gradients
const LEAGUE_COLORS = {
  NFL:      ['#013369', '#d50a0a'],
  NBA:      ['#c8102e', '#1d428a'],
  NHL:      ['#6dd5ed', '#2193b0'],
  MLB:      ['#002d72', '#d50032'],
  UFC:      ['#d20a0a', '#1a1a1a'],
  SOCCER:   ['#00a651', '#0033a0'],
  NCAAFB:   ['#bb162b', '#1f2f4d'],
  NCAAMB:   ['#ff6900', '#1f2f4d'],
  TENNIS:   ['#c2d600', '#0a5c36'],
  POLITICS: ['#a87fff', '#97fce4'],
  EVENTS:   ['#f5b53d', '#a87fff'],
  CRYPTO:   ['#f7931a', '#ffbf5c'],
};
function leagueAccent(league) {
  return LEAGUE_COLORS[(league || '').toUpperCase()] || ['#a87fff', '#97fce4'];
}

// Map a market.category → display badge color (similar to CAT_META in DeFi page)
const CAT_META = {
  'live':     { label: 'LIVE',     color: '#ff3d5d', bg: 'rgba(255,61,93,.12)',   bd: 'rgba(255,61,93,.36)'  },
  'tonight':  { label: 'TONIGHT',  color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' },
  'props':    { label: 'PROP',     color: '#f5b53d', bg: 'rgba(245,181,61,.12)',  bd: 'rgba(245,181,61,.30)'  },
  'politics': { label: 'POLITICS', color: '#a87fff', bg: 'rgba(168,127,255,.12)', bd: 'rgba(168,127,255,.30)' },
  'events':   { label: 'EVENT',    color: '#5ce9c8', bg: 'rgba(92,233,200,.12)',  bd: 'rgba(92,233,200,.30)'  },
  'futures':  { label: 'FUTURES',  color: '#ff8a9e', bg: 'rgba(255,138,158,.12)', bd: 'rgba(255,138,158,.30)' },
};

// =====================================================================
// HOOKS / UTILS — same as DeFiPredict / PerpsTrade
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
  d = d != null ? d : (n >= 1000 ? 2 : n >= 1 ? 4 : 8);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
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
function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'CLOSED';
  const s = Math.floor(msRemaining / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d >= 1) return `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}
function formatGameTime(startTs) {
  const d = new Date(startTs);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (sameDay) return d.toLocaleTimeString('en-US', opts) + ' ET';
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', opts);
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

function loadCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - (d.ts || 0) > ttlMs) return null;
    return d.data;
  } catch { return null; }
}
function saveCached(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function hasAcceptedTos() {
  try { return localStorage.getItem('nexus_kalshi_tos_v' + TOS_VERSION) === '1'; }
  catch { return false; }
}
function acceptTos() {
  try { localStorage.setItem('nexus_kalshi_tos_v' + TOS_VERSION, '1'); } catch {}
}

// =====================================================================
// DFLOW API — same client shape as DeFiPredict, different category param
// =====================================================================
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

async function fetchKalshiSportsMarkets() {
  if (!ENABLE_TRADING) return getMockSportsMarkets();
  try {
    const data = await dflowRequest('/prediction/markets?category=sports,politics,events');
    if (Array.isArray(data?.markets) && data.markets.length > 0) {
      return data.markets.map(normalizeMarket);
    }
    return getMockSportsMarkets();
  } catch (e) {
    console.warn('[dflow sports — using mocks]', e?.message || e);
    return getMockSportsMarkets();
  }
}

async function fetchUserPositions(walletPubkey) {
  if (!walletPubkey || !ENABLE_TRADING) return [];
  try {
    const data = await dflowRequest('/prediction/positions?wallet=' + encodeURIComponent(walletPubkey));
    return Array.isArray(data?.positions) ? data.positions : [];
  } catch (e) { console.warn('[dflow positions]', e?.message || e); return []; }
}

async function buildOrderTx({ market, side, usdcAmount, walletPubkey }) {
  if (!market?.id) throw new Error('Market unavailable');
  if (!walletPubkey) throw new Error('Wallet not connected');
  if (!(usdcAmount >= MIN_ORDER_USDC)) throw new Error(`Minimum order is $${MIN_ORDER_USDC}`);
  if (usdcAmount > MAX_ORDER_USDC) throw new Error(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`);
  if (!ENABLE_TRADING) throw new Error('Live trading is disabled. Set REACT_APP_KALSHI_LIVE_TRADING=1 and REACT_APP_DFLOW_BUILDER_CODE in env.');
  return await dflowRequest('/prediction/order/build', {
    marketId:      market.id,
    side:          side === 'YES' ? 'YES' : 'NO',
    usdcAmount:    Number(usdcAmount.toFixed(2)),
    userWallet:    walletPubkey,
    builderCode:   DFLOW_BUILDER_CODE,
    builderFeeBps: DFLOW_BUILDER_FEE_BPS,
    feeRecipient:  TREASURY_ADDRESS,
  });
}

async function submitSignedTx(serializedTx) {
  return await dflowRequest('/prediction/order/submit', {
    signedTxBase64: serializedTx,
  }, { timeoutMs: 20_000 });
}

function normalizeMarket(raw) {
  return {
    id:           raw.id || raw.ticker || raw.market_id,
    league:       (raw.league || raw.sport || raw.category || '').toUpperCase(),
    category:     raw.category || categorizeMarket(raw),
    question:     raw.question || raw.title || raw.name || '',
    description:  raw.description || raw.subtitle || '',
    subtitle:     raw.subtitle || raw.matchup || '',
    yesPrice:     Number(raw.yesPrice ?? raw.yes_price ?? raw.lastPriceYes ?? 0.5),
    noPrice:      Number(raw.noPrice  ?? raw.no_price  ?? raw.lastPriceNo  ?? 0.5),
    closeTs:      Number(raw.closeTs  ?? raw.close_time ?? raw.expiry ?? Date.now() + 3600_000),
    gameStartTs:  Number(raw.gameStartTs ?? raw.game_start ?? raw.start_time ?? 0) || null,
    isLive:       Boolean(raw.isLive ?? raw.is_live ?? raw.live),
    liveStatus:   raw.liveStatus || raw.live_status || '',
    homeTeam:     raw.homeTeam || raw.home_team || null,
    awayTeam:     raw.awayTeam || raw.away_team || null,
    player:       raw.player || null,
    volume24h:    Number(raw.volume24h ?? raw.volume_24h ?? raw.vol ?? 0),
    openInterest: Number(raw.openInterest ?? raw.open_interest ?? 0),
    hot:          Boolean(raw.hot ?? raw.featured),
    primetime:    Boolean(raw.primetime),
  };
}

function categorizeMarket(m) {
  if (m.isLive || m.is_live) return 'live';
  const start = Number(m.gameStartTs ?? m.game_start ?? m.start_time ?? 0);
  if (start > 0) {
    const sameDay = new Date(start).toDateString() === new Date().toDateString();
    if (sameDay) return 'tonight';
  }
  return 'events';
}

// =====================================================================
// MOCK SPORTS / EVENTS MARKETS
// Used until DFlow endpoints are live. Mix of live games, primetime
// matchups, player props, politics, and event markets.
// =====================================================================
function getMockSportsMarkets() {
  const now = Date.now();
  return [
    // === LIVE NOW (hero candidates) ===
    {
      id: 'NBA-LAL-BOS-ML-LIVE', league: 'NBA', category: 'live',
      question: 'Lakers beat Celtics tonight?',
      subtitle: 'LAL @ BOS', primetime: true,
      yesPrice: 0.58, noPrice: 0.42,
      closeTs: now + 92 * 60_000,
      gameStartTs: now - 35 * 60_000,
      isLive: true, liveStatus: 'Q2 4:12',
      awayTeam: { abbr: 'LAL', name: 'Lakers', score: 47 },
      homeTeam: { abbr: 'BOS', name: 'Celtics', score: 52 },
      volume24h: 1_840_000, hot: true,
    },
    {
      id: 'NBA-LAL-BOS-OVER', league: 'NBA', category: 'live',
      question: 'Over 224.5 total points?',
      subtitle: 'LAL @ BOS · Total',
      yesPrice: 0.61, noPrice: 0.39,
      closeTs: now + 92 * 60_000,
      isLive: true, liveStatus: 'Q2 4:12',
      awayTeam: { abbr: 'LAL', name: 'Lakers', score: 47 },
      homeTeam: { abbr: 'BOS', name: 'Celtics', score: 52 },
      volume24h: 612_000, hot: true,
    },
    {
      id: 'NHL-EDM-COL-ML-LIVE', league: 'NHL', category: 'live',
      question: 'Oilers beat Avalanche?',
      subtitle: 'EDM @ COL',
      yesPrice: 0.44, noPrice: 0.56,
      closeTs: now + 64 * 60_000,
      isLive: true, liveStatus: 'P2 8:44',
      awayTeam: { abbr: 'EDM', name: 'Oilers', score: 1 },
      homeTeam: { abbr: 'COL', name: 'Avalanche', score: 2 },
      volume24h: 218_000,
    },
    // === PRIMETIME TONIGHT ===
    {
      id: 'NFL-DAL-PHI-ML', league: 'NFL', category: 'tonight',
      question: 'Cowboys beat Eagles on SNF?',
      subtitle: 'DAL @ PHI · Sunday Night Football', primetime: true,
      yesPrice: 0.47, noPrice: 0.53,
      closeTs: nextHourAt(20),
      gameStartTs: nextHourAt(20),
      awayTeam: { abbr: 'DAL', name: 'Cowboys' },
      homeTeam: { abbr: 'PHI', name: 'Eagles' },
      volume24h: 3_240_000, hot: true,
    },
    {
      id: 'NFL-DAL-PHI-SPREAD', league: 'NFL', category: 'tonight',
      question: 'Eagles cover -3.5?',
      subtitle: 'DAL @ PHI · Spread',
      yesPrice: 0.52, noPrice: 0.48,
      closeTs: nextHourAt(20),
      gameStartTs: nextHourAt(20),
      awayTeam: { abbr: 'DAL', name: 'Cowboys' },
      homeTeam: { abbr: 'PHI', name: 'Eagles' },
      volume24h: 1_180_000,
    },
    // === PLAYER PROPS ===
    {
      id: 'NFL-PROP-HURTS-300', league: 'NFL', category: 'props',
      question: 'Jalen Hurts over 249.5 pass yards?',
      subtitle: 'DAL @ PHI · Player Prop',
      player: 'Jalen Hurts',
      yesPrice: 0.54, noPrice: 0.46,
      closeTs: nextHourAt(20),
      gameStartTs: nextHourAt(20),
      volume24h: 384_000,
    },
    {
      id: 'NBA-PROP-LEBRON-25', league: 'NBA', category: 'props',
      question: 'LeBron over 24.5 points?',
      subtitle: 'LAL @ BOS · Player Prop',
      player: 'LeBron James',
      yesPrice: 0.62, noPrice: 0.38,
      closeTs: now + 92 * 60_000,
      gameStartTs: now - 35 * 60_000,
      isLive: true, liveStatus: 'Q2 4:12',
      volume24h: 412_000,
    },
    {
      id: 'NBA-PROP-TATUM-30', league: 'NBA', category: 'props',
      question: 'Tatum over 28.5 points?',
      subtitle: 'LAL @ BOS · Player Prop',
      player: 'Jayson Tatum',
      yesPrice: 0.48, noPrice: 0.52,
      closeTs: now + 92 * 60_000,
      gameStartTs: now - 35 * 60_000,
      isLive: true, liveStatus: 'Q2 4:12',
      volume24h: 268_000,
    },
    // === OTHER NBA TONIGHT ===
    {
      id: 'NBA-GSW-DEN-ML', league: 'NBA', category: 'tonight',
      question: 'Warriors beat Nuggets tonight?',
      subtitle: 'GSW @ DEN',
      yesPrice: 0.42, noPrice: 0.58,
      closeTs: nextHourAt(22),
      gameStartTs: nextHourAt(22),
      awayTeam: { abbr: 'GSW', name: 'Warriors' },
      homeTeam: { abbr: 'DEN', name: 'Nuggets' },
      volume24h: 624_000,
    },
    {
      id: 'NBA-MIA-NYK-ML', league: 'NBA', category: 'tonight',
      question: 'Heat beat Knicks tonight?',
      subtitle: 'MIA @ NYK',
      yesPrice: 0.39, noPrice: 0.61,
      closeTs: nextHourAt(19),
      gameStartTs: nextHourAt(19),
      awayTeam: { abbr: 'MIA', name: 'Heat' },
      homeTeam: { abbr: 'NYK', name: 'Knicks' },
      volume24h: 488_000,
    },
    // === NHL TONIGHT ===
    {
      id: 'NHL-NYR-BOS-ML', league: 'NHL', category: 'tonight',
      question: 'Rangers beat Bruins?',
      subtitle: 'NYR @ BOS',
      yesPrice: 0.51, noPrice: 0.49,
      closeTs: nextHourAt(19),
      gameStartTs: nextHourAt(19),
      awayTeam: { abbr: 'NYR', name: 'Rangers' },
      homeTeam: { abbr: 'BOS', name: 'Bruins' },
      volume24h: 142_000,
    },
    // === MLB TONIGHT ===
    {
      id: 'MLB-LAD-SF-ML', league: 'MLB', category: 'tonight',
      question: 'Dodgers beat Giants?',
      subtitle: 'LAD @ SF',
      yesPrice: 0.56, noPrice: 0.44,
      closeTs: nextHourAt(22),
      gameStartTs: nextHourAt(22),
      awayTeam: { abbr: 'LAD', name: 'Dodgers' },
      homeTeam: { abbr: 'SF', name: 'Giants' },
      volume24h: 218_000,
    },
    // === UFC ===
    {
      id: 'UFC-MAIN-CARD', league: 'UFC', category: 'tonight',
      question: 'Will the main event finish inside the distance?',
      subtitle: 'UFC 320 · Main Card',
      yesPrice: 0.57, noPrice: 0.43,
      closeTs: now + 5 * 3600_000,
      gameStartTs: now + 5 * 3600_000, primetime: true,
      volume24h: 384_000, hot: true,
    },
    // === SOCCER ===
    {
      id: 'EPL-LIV-MCI', league: 'SOCCER', category: 'tonight',
      question: 'Liverpool beat Man City?',
      subtitle: 'LIV vs MCI · Premier League',
      yesPrice: 0.46, noPrice: 0.54,
      closeTs: nextHourAt(15),
      gameStartTs: nextHourAt(15),
      awayTeam: { abbr: 'MCI', name: 'Man City' },
      homeTeam: { abbr: 'LIV', name: 'Liverpool' },
      volume24h: 224_000,
    },
    // === POLITICS ===
    {
      id: 'POL-PRES-2028', league: 'POLITICS', category: 'politics',
      question: 'Will a Democrat win the 2028 presidential election?',
      subtitle: 'Presidential election',
      yesPrice: 0.49, noPrice: 0.51,
      closeTs: now + 900 * 86400_000,
      volume24h: 4_120_000, hot: true,
    },
    {
      id: 'POL-MIDTERM-HOUSE', league: 'POLITICS', category: 'politics',
      question: 'Will Republicans hold the House in 2026?',
      subtitle: 'Midterm elections',
      yesPrice: 0.44, noPrice: 0.56,
      closeTs: now + 175 * 86400_000,
      volume24h: 1_280_000,
    },
    // === EVENTS / AWARDS ===
    {
      id: 'OSCARS-BEST-PIC', league: 'EVENTS', category: 'events',
      question: 'Will "Nostromo" win Best Picture?',
      subtitle: '97th Academy Awards',
      yesPrice: 0.32, noPrice: 0.68,
      closeTs: now + 42 * 86400_000,
      volume24h: 168_000,
    },
    // === FUTURES ===
    {
      id: 'NFL-SB-WINNER', league: 'NFL', category: 'futures',
      question: 'Will the Eagles win Super Bowl LX?',
      subtitle: 'Super Bowl futures',
      yesPrice: 0.18, noPrice: 0.82,
      closeTs: now + 75 * 86400_000,
      volume24h: 920_000,
    },
    {
      id: 'NBA-CHAMPION-2026', league: 'NBA', category: 'futures',
      question: 'Will the Celtics win the 2026 NBA Championship?',
      subtitle: 'NBA Finals futures',
      yesPrice: 0.22, noPrice: 0.78,
      closeTs: now + 95 * 86400_000,
      volume24h: 412_000,
    },
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
function LeagueIcon({ league, size = 38, label }) {
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

function LiveDot({ size = 8, label = 'LIVE' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: size, height: size, borderRadius: '50%',
        background: C.live, boxShadow: `0 0 ${size}px ${C.live}`,
        animation: 'nexus-pulse 1.4s ease-in-out infinite',
      }}/>
      {label && (
        <span style={{ color: C.live, fontSize: 9, fontWeight: 800, letterSpacing: '.10em', ...T.mono }}>{label}</span>
      )}
    </div>
  );
}

function CountdownText({ closeTs, style }) {
  const [now, setNow] = useState(Date.now());
  const remaining = (closeTs || 0) - now;
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), remaining < 90 * 60_000 ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [remaining]);
  const closed = remaining <= 0;
  const urgent = remaining > 0 && remaining < 5 * 60_000;
  return (
    <span style={{
      color: closed ? C.muted2 : urgent ? C.down : C.muted,
      fontWeight: urgent ? 800 : 600, ...style,
    }}>
      {closed ? 'CLOSED' : formatCountdown(remaining)}
    </span>
  );
}

function YesNoPills({ yesPrice, noPrice, large }) {
  const sz = large ? { fs: 13, py: '5px 11px' } : { fs: 11, py: '3px 8px' };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{
        padding: sz.py, borderRadius: 8,
        background: 'rgba(61,213,152,.10)', border: '1px solid rgba(61,213,152,.28)', ...T.mono,
      }}>
        <span style={{ color: C.muted2, fontSize: sz.fs - 3, fontWeight: 700, marginRight: 4 }}>YES</span>
        <span style={{ color: C.up, fontSize: sz.fs, fontWeight: 800 }}>{priceToCents(yesPrice)}¢</span>
      </div>
      <div style={{
        padding: sz.py, borderRadius: 8,
        background: 'rgba(255,138,158,.10)', border: '1px solid rgba(255,138,158,.28)', ...T.mono,
      }}>
        <span style={{ color: C.muted2, fontSize: sz.fs - 3, fontWeight: 700, marginRight: 4 }}>NO</span>
        <span style={{ color: C.down, fontSize: sz.fs, fontWeight: 800 }}>{priceToCents(noPrice)}¢</span>
      </div>
    </div>
  );
}

function CategoryBadge({ category, small }) {
  const meta = CAT_META[category];
  if (!meta) return null;
  return (
    <span style={{
      color: meta.color, fontSize: small ? 8 : 9, fontWeight: 700,
      padding: small ? '1px 5px' : '2px 6px', borderRadius: 4,
      background: meta.bg, border: `1px solid ${meta.bd}`,
      letterSpacing: '.06em', ...T.mono,
    }}>{meta.label}</span>
  );
}

// =====================================================================
// LiveGameCard — hero card for an in-progress game. Pulsing LIVE dot,
// current score, game clock, inline YES/NO buy buttons.
// =====================================================================
function LiveGameCard({ market, onBuy }) {
  if (!market) return null;
  const home = market.homeTeam;
  const away = market.awayTeam;
  const hasScore = home?.score != null && away?.score != null;
  return (
    <div style={{
      marginBottom: 14, padding: 18, borderRadius: 20,
      background: 'linear-gradient(145deg,rgba(40,14,20,.96),rgba(22,7,11,.98))',
      border: '1px solid rgba(255,61,93,.30)',
      boxShadow: C.liveGlow, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', right: -50, top: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,61,93,.14),transparent 65%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'relative' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LiveDot size={10}/>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{market.liveStatus || 'IN PROGRESS'}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>24H VOL</div>
            <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 800, marginTop: 2, ...T.mono }}>{shortNum(market.volume24h)}</div>
          </div>
        </div>

        {/* Team score row, only if it's a head-to-head game */}
        {hasScore && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, padding: '10px 4px', marginBottom: 12, borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LeagueIcon league={market.league} label={away?.abbr} size={36}/>
              <div>
                <div style={{ fontSize: 11, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{away?.abbr}</div>
                <div style={{ fontSize: 22, color: C.inkStr, fontWeight: 900, marginTop: 1, ...T.display, fontVariantNumeric: 'tabular-nums' }}>{away?.score ?? 0}</div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, ...T.mono }}>VS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{home?.abbr}</div>
                <div style={{ fontSize: 22, color: C.inkStr, fontWeight: 900, marginTop: 1, ...T.display, fontVariantNumeric: 'tabular-nums' }}>{home?.score ?? 0}</div>
              </div>
              <LeagueIcon league={market.league} label={home?.abbr} size={36}/>
            </div>
          </div>
        )}

        <div style={{ fontSize: 19, fontWeight: 700, color: C.inkStr, lineHeight: 1.25, letterSpacing: '-.02em', marginBottom: 16, ...T.display }}>
          {market.question}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => onBuy(market, 'YES')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(61,213,152,.40)',
            background: 'linear-gradient(135deg,rgba(61,213,152,.14),rgba(92,233,200,.06))',
            color: C.up, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(61,213,152,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY YES</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if yes</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.yesPrice)}¢</div>
          </button>
          <button onClick={() => onBuy(market, 'NO')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(255,138,158,.40)',
            background: 'linear-gradient(135deg,rgba(255,138,158,.14),rgba(168,127,255,.06))',
            color: C.down, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(255,138,158,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY NO</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if no</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.noPrice)}¢</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// FeaturedMarketCard — Used when no live games. Same shape as DeFi
// version but with sports framing (primetime tonight, etc).
// =====================================================================
function FeaturedMarketCard({ market, onBuy }) {
  if (!market) return null;
  return (
    <div style={{
      marginBottom: 14, padding: 18, borderRadius: 20,
      background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
      border: '1px solid rgba(151,252,228,.18)',
      boxShadow: C.glow, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', right: -50, top: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.12),transparent 65%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LeagueIcon league={market.league} size={44}/>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CategoryBadge category={market.category}/>
                {market.primetime && (
                  <span style={{ color: C.amber, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)', ...T.mono }}>PRIMETIME</span>
                )}
                {market.hot && !market.primetime && (
                  <span style={{ color: C.amber, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,181,61,.10)', border: '1px solid rgba(245,181,61,.20)', ...T.mono }}>HOT</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: C.muted, ...T.mono }}>
                {market.subtitle || market.league}
                {market.gameStartTs ? ` · ${formatGameTime(market.gameStartTs)}` : ''}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>24H VOL</div>
            <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 800, marginTop: 2, ...T.mono }}>{shortNum(market.volume24h)}</div>
          </div>
        </div>

        <div style={{ fontSize: 19, fontWeight: 700, color: C.inkStr, lineHeight: 1.25, letterSpacing: '-.02em', marginBottom: 16, ...T.display }}>
          {market.question}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => onBuy(market, 'YES')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(61,213,152,.40)',
            background: 'linear-gradient(135deg,rgba(61,213,152,.14),rgba(92,233,200,.06))',
            color: C.up, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(61,213,152,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY YES</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if yes</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.yesPrice)}¢</div>
          </button>
          <button onClick={() => onBuy(market, 'NO')} style={{
            padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(255,138,158,.40)',
            background: 'linear-gradient(135deg,rgba(255,138,158,.14),rgba(168,127,255,.06))',
            color: C.down, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: '0 6px 18px rgba(255,138,158,.10)',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY NO</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if no</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(market.noPrice)}¢</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MarketRow — Compact list item. Adapts to team-vs-team games (shows
// matchup line) or single-question markets (politics, futures, props).
// =====================================================================
function MarketRow({ market, onClick }) {
  const home = market.homeTeam;
  const away = market.awayTeam;
  const isMatchup = home?.abbr && away?.abbr;
  return (
    <button onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(151,252,228,.025)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: '100%', padding: '14px 16px', background: 'transparent', border: 'none',
        borderBottom: `1px solid ${C.hairline}`, cursor: 'pointer', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
        transition: 'background .15s',
      }}
    >
      <LeagueIcon league={market.league} label={isMatchup ? null : market.league} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.inkStr, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-.01em', ...T.body, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {market.question}
        </div>
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {market.isLive ? (
            <>
              <LiveDot size={6} label={market.liveStatus || 'LIVE'}/>
              {isMatchup && home?.score != null && (
                <span style={{ color: C.ink, fontSize: 9, fontWeight: 700, ...T.mono }}>
                  {away.abbr} {away.score} – {home.abbr} {home.score}
                </span>
              )}
            </>
          ) : (
            <CategoryBadge category={market.category} small/>
          )}
          {!market.isLive && market.gameStartTs && (
            <>
              <span style={{ color: C.muted2, fontSize: 9, ...T.mono }}>•</span>
              <span style={{ color: C.muted, fontSize: 9, fontWeight: 600, ...T.mono }}>{formatGameTime(market.gameStartTs)}</span>
            </>
          )}
          <span style={{ color: C.muted2, fontSize: 9, ...T.mono }}>•</span>
          <span style={{ color: C.muted, fontSize: 9, fontWeight: 600, ...T.mono }}>{shortNum(market.volume24h)} vol</span>
        </div>
      </div>
      <YesNoPills yesPrice={market.yesPrice} noPrice={market.noPrice}/>
    </button>
  );
}

// =====================================================================
// PositionsPanel — same as DeFiPredict
// =====================================================================
function PositionsPanel({ positions, markets, onSell }) {
  if (!positions || positions.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 8, ...T.mono }}>YOUR POSITIONS</div>
      {positions.map(pos => {
        const market = markets.find(m => m.id === pos.marketId);
        const livePx = pos.side === 'YES' ? (market?.yesPrice ?? pos.entryPrice) : (market?.noPrice ?? pos.entryPrice);
        const cost   = pos.contracts * pos.entryPrice;
        const value  = pos.contracts * livePx;
        const pnl    = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        const inProfit = pnl >= 0;
        return (
          <div key={pos.id} style={{
            marginBottom: 8, padding: '12px 14px', borderRadius: 14,
            background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))',
            border: `1px solid ${inProfit ? 'rgba(61,213,152,.24)' : 'rgba(255,138,158,.24)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: pos.side === 'YES' ? C.up : C.down, padding: '1px 6px', borderRadius: 4, background: pos.side === 'YES' ? 'rgba(61,213,152,.12)' : 'rgba(255,138,158,.12)', ...T.mono }}>
                    {pos.side}
                  </span>
                  <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, ...T.mono }}>{pos.contracts} contracts</span>
                </div>
                <div style={{ fontSize: 12, color: C.ink, fontWeight: 600, lineHeight: 1.3, ...T.body }}>
                  {market?.question || pos.question || pos.marketId}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: inProfit ? C.up : C.down, ...T.display }}>
                  {inProfit ? '+' : ''}{fmt(pnl, 2)}
                </div>
                <div style={{ fontSize: 10, color: inProfit ? C.up : C.down, marginTop: 2, ...T.mono }}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 10 }}>
              {[['ENTRY', priceToCents(pos.entryPrice) + '¢'], ['NOW', priceToCents(livePx) + '¢'], ['COST', fmt(cost, 2)]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{l}</div>
                  <div style={{ fontSize: 11, color: C.ink, fontWeight: 700, marginTop: 2, ...T.mono }}>{v}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onSell(pos, market)} style={{
              width: '100%', padding: 9, borderRadius: 10,
              border: `1px solid ${inProfit ? 'rgba(61,213,152,.30)' : 'rgba(255,138,158,.30)'}`,
              background: inProfit ? 'rgba(61,213,152,.06)' : 'rgba(255,138,158,.06)',
              color: inProfit ? C.up : C.down,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', ...T.body,
            }}>Sell position</button>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// TosModal — same one-time gate as DeFiPredict (shares TOS_VERSION key)
// =====================================================================
function TosModal({ open, onAccept, onClose }) {
  const [checked, setChecked] = useState(false);
  useBodyLock(open);
  useEffect(() => { if (!open) setChecked(false); }, [open]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 460, background: 'rgba(0,0,0,.86)', backdropFilter: 'blur(14px)', cursor: 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 461,
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        boxShadow: '0 -24px 70px rgba(0,0,0,.6)',
      }}>
        <div style={{ flexShrink: 0, padding: '20px 22px 0' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 19, letterSpacing: '-.02em', ...T.display }}>Before you start</div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 16, ...T.body }}>
            One-time acknowledgement. We won't ask again on this device.
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 8px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(151,252,228,.06)', border: '1px solid rgba(151,252,228,.20)', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.hl, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>POWERED BY KALSHI</div>
            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.55, ...T.body }}>
              Trades execute on <strong style={{ color: C.inkStr }}>Kalshi</strong>, a CFTC-regulated event-contract exchange. NexusDEX is a non-custodial frontend and is not affiliated with Kalshi Inc.
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(245,181,61,.06)', border: '1px solid rgba(245,181,61,.20)', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.amber, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>U.S. STATE RESTRICTIONS</div>
            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.55, marginBottom: 8, ...T.body }}>
              Kalshi prediction markets are not available to residents of:
            </div>
            <div style={{ fontSize: 12, color: C.inkStr, fontWeight: 700, letterSpacing: '.04em', ...T.mono }}>
              {RESTRICTED_STATES.join(' · ')}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5, ...T.body }}>
              By continuing you confirm you do not reside in any of the above.
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted2, fontWeight: 800, letterSpacing: '.06em', marginBottom: 8, ...T.mono }}>WHAT YOU AGREE TO</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.ink, lineHeight: 1.7, ...T.body }}>
              <li>You are 18 or older.</li>
              <li>You may lose the full amount you spend on any contract.</li>
              <li>NexusDEX charges a 1.5% builder fee per trade in addition to Kalshi's exchange fees.</li>
              <li>You waive any claim against NexusDEX for losses from trading on Kalshi.</li>
              <li>You will not use this app while located in a restricted jurisdiction.</li>
            </ul>
          </div>
        </div>
        <div style={{
          flexShrink: 0,
          padding: '14px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`, background: C.bg,
        }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, accentColor: C.hl, cursor: 'pointer', flexShrink: 0 }}/>
            <span style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5, fontWeight: 600, ...T.body }}>
              I have read and accept the above terms.
            </span>
          </label>
          <button onClick={checked ? onAccept : undefined} disabled={!checked} style={{
            width: '100%', padding: 16, borderRadius: 16, border: 'none',
            background: checked ? `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)` : 'rgba(255,255,255,.06)',
            color: checked ? '#04070f' : C.muted2,
            fontWeight: 800, fontSize: 15,
            cursor: checked ? 'pointer' : 'not-allowed', minHeight: 52, ...T.display,
          }}>Continue</button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// BuyModal — same flow as DeFiPredict (YES/NO toggle, quick chips,
// payout preview, builder code in every order)
// =====================================================================
function BuyModal({ open, onClose, market, initialSide, walletPubkey, onConnectWallet, refreshPositions }) {
  const { connected, signTransaction } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]           = useState('YES');
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setSide(initialSide || 'YES');
      setAmount(''); setStatus('idle'); setError(''); setStatusMsg('');
    }
  }, [open, initialSide, market?.id]);

  if (!open || !market) return null;

  const isYes      = side === 'YES';
  const livePrice  = isYes ? market.yesPrice : market.noPrice;
  const usd        = parseFloat(amount) || 0;
  const contracts  = livePrice > 0 ? usd / livePrice : 0;
  const maxPayout  = contracts * 1;
  const profitIfWin = Math.max(0, maxPayout - usd);
  const builderFee = usd * (DFLOW_BUILDER_FEE_BPS / 10_000);
  const tooSmall   = usd > 0 && usd < MIN_ORDER_USDC;
  const tooLarge   = usd > MAX_ORDER_USDC;

  const isBusy    = status === 'loading';
  const isSuccess = status === 'success';
  const isError   = status === 'error';

  const quickChips = [5, 25, 100, 500];

  const execute = async () => {
    if (!wcon)            { onConnectWallet?.(); return; }
    if (!walletPubkey)    { setError('Wallet not connected'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana address'); return; }
    if (!usd || tooSmall) { setError(`Minimum order is $${MIN_ORDER_USDC}`); return; }
    if (tooLarge)         { setError(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`); return; }

    setStatus('loading'); setError(''); setStatusMsg('Building order...');
    try {
      const built = await buildOrderTx({ market, side, usdcAmount: usd, walletPubkey });
      if (!built?.serializedTx) throw new Error('Order builder returned no transaction');

      setStatusMsg('Sign in your wallet...');
      const txBytes = Uint8Array.from(atob(built.serializedTx), c => c.charCodeAt(0));
      let tx;
      try { tx = VersionedTransaction.deserialize(txBytes); }
      catch { tx = Transaction.from(txBytes); }

      if (!signTransaction) throw new Error('Wallet cannot sign transactions');
      const signed = await signTransaction(tx);

      setStatusMsg('Submitting order...');
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const result = await submitSignedTx(serialized);
      if (!result?.ok) throw new Error(result?.error || 'Order rejected');

      setStatus('success'); setStatusMsg('');
      refreshPositions?.();
      setTimeout(() => { setStatus('idle'); onClose(); }, 2200);
    } catch (e) {
      console.error('[buy]', e);
      setError(e.message || 'Order failed');
      setStatus('error'); setStatusMsg('');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '88dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        <div style={{ flexShrink: 0, padding: '14px 22px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
              <LeagueIcon league={market.league} size={42}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  {market.isLive ? <LiveDot size={6} label={market.liveStatus || 'LIVE'}/> : <CategoryBadge category={market.category}/>}
                  {!market.isLive && market.gameStartTs && (
                    <span style={{ color: C.muted, fontSize: 10, fontWeight: 600, ...T.mono }}>· {formatGameTime(market.gameStartTs)}</span>
                  )}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.inkStr, lineHeight: 1.3, letterSpacing: '-.02em', ...T.display }}>
                  {market.question}
                </div>
                {market.subtitle && (
                  <div style={{ fontSize: 10, color: C.muted2, marginTop: 4, ...T.mono }}>{market.subtitle}</div>
                )}
              </div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 34, height: 34, borderRadius: 11, fontSize: 20, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.4 : 1, flexShrink: 0 }}>×</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', marginTop: 14, padding: '10px 0', borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            {[
              ['YES', priceToCents(market.yesPrice) + '¢', C.up],
              ['NO',  priceToCents(market.noPrice)  + '¢', C.down],
              ['VOL', shortNum(market.volume24h),          C.ink],
            ].map(([l, v, c], i) => (
              <div key={l} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{l}</div>
                <div style={{ fontSize: 13, color: c, fontWeight: 800, marginTop: 3, ...T.mono }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 22px 14px', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              ['YES', C.up,   'rgba(61,213,152,.10)',  'rgba(61,213,152,.42)'],
              ['NO',  C.down, 'rgba(255,138,158,.10)', 'rgba(255,138,158,.42)'],
            ].map(([s, color, bg, bdr]) => {
              const active = side === s;
              return (
                <button key={s} onClick={() => setSide(s)} disabled={isBusy} style={{
                  padding: 14, borderRadius: 14,
                  border: `1px solid ${active ? bdr : C.border}`,
                  background: active ? bg : 'rgba(255,255,255,.03)',
                  color: active ? color : C.muted,
                  fontWeight: 800, fontSize: 15, cursor: isBusy ? 'not-allowed' : 'pointer',
                  transition: 'all .15s', boxShadow: active ? `0 0 20px ${color}1c` : 'none', ...T.display,
                }}>{s}</button>
              );
            })}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>AMOUNT (USDC)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>1.5% FEE</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${tooSmall || tooLarge ? 'rgba(255,138,158,.40)' : C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>$</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy}
                inputMode="decimal" enterKeyHint="done"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 25, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}
              />
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>USDC</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {quickChips.map(c => (
                <button key={c} onClick={() => { setAmount(String(c)); setError(''); }} disabled={isBusy} style={{
                  flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono,
                }}>${c}</button>
              ))}
            </div>
            {tooSmall && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Minimum order is ${MIN_ORDER_USDC}</div>}
            {tooLarge && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Max order is ${MAX_ORDER_USDC.toLocaleString()}</div>}
          </div>

          {usd > 0 && !tooSmall && !tooLarge && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>ORDER PREVIEW</div>
              {[
                ['You buy',          contracts.toFixed(2) + ' ' + side + ' contracts'],
                ['Price per share',  priceToCents(livePrice) + '¢'],
                ['Builder fee 1.5%', '-' + fmt(builderFee, 2)],
                ['Max payout',       fmt(maxPayout, 2)],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 6, borderTop: `1px solid ${C.hairline}` }}>
                <span style={{ color: C.ink, fontWeight: 700, fontSize: 12, ...T.body }}>Profit if {side === 'YES' ? 'yes' : 'no'}</span>
                <div style={{ color: C.up, fontWeight: 800, fontSize: 14, ...T.mono }}>+{fmt(profitIfWin, 2)}</div>
              </div>
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {(isBusy || isSuccess) && statusMsg && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nexus-spin 0.8s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{statusMsg}</span>
            </div>
          )}
          {error && <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>{error}</div>}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Solana Wallet
            </button>
          ) : (
            <button onClick={execute} disabled={isBusy || !amount || tooSmall || tooLarge} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : isError
                ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                : isYes
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !amount || tooSmall || tooLarge ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !amount || tooSmall || tooLarge ? 0.55 : 1,
              boxShadow: isYes ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' : isSuccess ? `${side} bought` : isError ? 'Retry' : usd > 0 && !tooSmall && !tooLarge ? `Buy ${contracts.toFixed(1)} ${side} for ${fmt(usd, 2)}` : `Buy ${side}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Non-custodial | Powered by Kalshi
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN COMPONENT — Predictions Tonight
// =====================================================================
export default function PredictionsTonight({ onConnectWallet }) {
  const [markets, setMarkets]             = useState(() => loadCached('nexus_kalshi_sports', 60_000) || []);
  const [positions, setPositions]         = useState([]);
  const [filter, setFilter]               = useState('All');
  const [buyOpen, setBuyOpen]             = useState(false);
  const [activeMarket, setActiveMarket]   = useState(null);
  const [initialSide, setInitialSide]     = useState('YES');
  const [tosOpen, setTosOpen]             = useState(false);

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Poll markets every 10 sec
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchKalshiSportsMarkets();
        if (!alive || !Array.isArray(data) || data.length === 0) return;
        setMarkets(data);
        saveCached('nexus_kalshi_sports', data);
      } catch (e) { console.warn('[markets poll]', e?.message || e); }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const refreshPositions = useCallback(async () => {
    if (!walletPubkey) { setPositions([]); return; }
    try {
      const pos = await fetchUserPositions(walletPubkey);
      setPositions(pos);
    } catch (e) { console.warn('[positions]', e?.message || e); }
  }, [walletPubkey]);

  useEffect(() => {
    if (!walletPubkey) return;
    refreshPositions();
    const id = setInterval(refreshPositions, 15_000);
    return () => clearInterval(id);
  }, [walletPubkey, refreshPositions]);

  const handleBuy = (market, side) => {
    // Global TermsGate in App.js covers all ToS — no per-page modal needed.
    setActiveMarket(market); setInitialSide(side); setBuyOpen(true);
  };
  const handleTosAccept = () => {
    acceptTos(); setTosOpen(false);
    if (activeMarket) setBuyOpen(true);
  };
  const handleSell = (pos, market) => {
    if (!market) return;
    setActiveMarket(market);
    setInitialSide(pos.side === 'YES' ? 'NO' : 'YES');
    setBuyOpen(true);
  };

  // Live > Tonight > Volume-ranked ordering. Live games always hero.
  const ordered = useMemo(() => {
    if (!markets.length) return [];
    const liveGames = markets.filter(m => m.isLive)
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const tonightPrimetime = markets.filter(m => !m.isLive && m.primetime && m.category === 'tonight')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const tonightRest = markets.filter(m => !m.isLive && !m.primetime && m.category === 'tonight')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const props = markets.filter(m => m.category === 'props')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const politics = markets.filter(m => m.category === 'politics')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const events = markets.filter(m => m.category === 'events')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const futures = markets.filter(m => m.category === 'futures')
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    return [...liveGames, ...tonightPrimetime, ...tonightRest, ...props, ...politics, ...events, ...futures];
  }, [markets]);

  // Filter logic — handles "All", "Live", "Tonight", "Props", category, and league
  const filtered = useMemo(() => {
    if (filter === 'All')      return ordered;
    if (filter === 'Live')     return ordered.filter(m => m.isLive);
    if (filter === 'Tonight')  return ordered.filter(m => m.category === 'tonight' || m.isLive);
    if (filter === 'Props')    return ordered.filter(m => m.category === 'props');
    if (filter === 'Politics') return ordered.filter(m => m.category === 'politics');
    if (filter === 'Events')   return ordered.filter(m => m.category === 'events');
    if (filter === 'Futures')  return ordered.filter(m => m.category === 'futures');
    // League filter (NFL, NBA, etc.)
    return ordered.filter(m => (m.league || '').toUpperCase() === filter.toUpperCase());
  }, [ordered, filter]);

  // Featured: prefer the highest-vol live game; else highest-vol primetime;
  // else highest-vol overall in the current filter.
  const featured = useMemo(() => {
    if (!filtered.length) return null;
    const live = filtered.filter(m => m.isLive);
    if (live.length) return live.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0];
    const primetime = filtered.filter(m => m.primetime);
    if (primetime.length) return primetime.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0];
    return filtered.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0] || null;
  }, [filtered]);

  const listMarkets = useMemo(() => {
    if (!featured) return filtered;
    return filtered.filter(m => m.id !== featured.id);
  }, [filtered, featured]);

  const liveCount   = useMemo(() => markets.filter(m => m.isLive).length, [markets]);
  const tonightCount = useMemo(() => markets.filter(m => m.category === 'tonight' || m.isLive).length, [markets]);
  const totalVol    = useMemo(() => markets.reduce((s, m) => s + Number(m.volume24h || 0), 0), [markets]);

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,61,93,.14),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
              {liveCount > 0 ? <LiveDot label={`${liveCount} LIVE NOW`}/> : (
                <>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl, boxShadow: `0 0 10px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
                  <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POWERED BY KALSHI</span>
                </>
              )}
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
              Predictions{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Tonight</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Sports, politics, events. Trade what's happening tonight from your Solana wallet. Settles on Kalshi.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { label: 'LIVE',    value: liveCount || '0',    color: liveCount > 0 ? C.live : C.inkStr },
                { label: 'TONIGHT', value: tonightCount || '0', color: C.inkStr },
                { label: '24H VOL', value: shortNum(totalVol),  color: C.inkStr },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* POSITIONS */}
        <PositionsPanel positions={positions} markets={markets} onSell={handleSell}/>

        {/* FILTER PILLS — horizontally scrollable */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.03em', ...T.display }}>Live & tonight</div>
            <div style={{ color: C.muted2, fontSize: 10, fontWeight: 600, marginTop: 2, ...T.mono }}>Tap any market to trade</div>
          </div>
        </div>
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

        {/* FEATURED */}
        {featured && (
          featured.isLive
            ? <LiveGameCard market={featured} onBuy={handleBuy}/>
            : <FeaturedMarketCard market={featured} onBuy={handleBuy}/>
        )}

        {/* MARKET LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {listMarkets.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              No markets in this category right now.
            </div>
          ) : listMarkets.map(m => (
            <MarketRow key={m.id} market={m} onClick={() => handleBuy(m, 'YES')}/>
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>KALSHI</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          Trades execute on Kalshi, a CFTC-regulated exchange. NexusDEX is a non-custodial frontend and is not affiliated with Kalshi Inc. 1.5% builder fee applies.
        </div>

        <BuyModal
          open={buyOpen}
          onClose={() => setBuyOpen(false)}
          market={activeMarket}
          initialSide={initialSide}
          walletPubkey={walletPubkey}
          onConnectWallet={onConnectWallet}
          refreshPositions={refreshPositions}
        />
        <TosModal
          open={tosOpen}
          onAccept={handleTosAccept}
          onClose={() => setTosOpen(false)}
        />
      </div>
    </>
  );
}
