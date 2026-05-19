import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction, TransactionInstruction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';
import ParlayBuilder from './ParlayBuilder.jsx';

// =====================================================================
// Predictions Tonight — Polymarket sports + politics + events surface.
//
// Same trade pipeline as DeFiPredict.jsx (the "our own route" pattern):
//   - Polymarket Gamma API for market data (public, no auth)
//   - ONE Solana VersionedTransaction signed by the user:
//       a. SPL Transfer  — fee USDC → TREASURY_USDC_ATA on Solana
//       b. Bridge call   — net USDC via Mayan → user's own Polygon addr
//   - Pre-sim before sign (Phantom never prompts on a doomed tx)
//   - Atomic: bridge failure reverts the fee
//   - Bridge polls 1–3 min, then deep-links to Polymarket with funds
//     pre-positioned in the user's Polygon wallet
//
// One signature. Non-custodial. Fee bypasses Polymarket Builder Program
// entirely — captured Solana-side before any cross-chain hop.
// =====================================================================

// ---- Fee config (shared env with DeFiPredict) ------------------------
const FEE_BPS_DEFAULT = Number(process.env.REACT_APP_NEXUS_PREDICT_FEE_BPS || 200);
const FEE_BPS_SPORTS  = Number(process.env.REACT_APP_NEXUS_PREDICT_FEE_BPS_SPORTS || 200);
function feeBpsFor(category) {
  const c = String(category || '').toLowerCase();
  if (['live', 'tonight', 'props', 'futures'].includes(c)) return FEE_BPS_SPORTS;
  return FEE_BPS_DEFAULT;
}

// ---- Provider / endpoints --------------------------------------------
const GAMMA_API_BASE   = process.env.REACT_APP_POLYMARKET_GAMMA_BASE || 'https://gamma-api.polymarket.com';
const POLY_HOST        = 'https://polymarket.com';
// REACT_APP_POLYMARKET_BUILDER_CODE is reserved for a future CLOB
// integration. Polymarket's builder code is a bytes32 attached to signed
// orders (not a URL query param), so this env var is currently unused.
const POLY_BUILDER_REF = process.env.REACT_APP_POLYMARKET_BUILDER_CODE || '';
const BRIDGE_API_BASE  = process.env.REACT_APP_BRIDGE_API_BASE || '/api/bridge';

// ---- Treasury & token config -----------------------------------------
const TREASURY_USDC_ATA = process.env.REACT_APP_TREASURY_USDC_ATA || '';
const USDC_MINT_SOL     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS     = 6;
const TOKEN_PROGRAM_ID  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID    = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

const MIN_ORDER_USDC = 5;
const MAX_ORDER_USDC = 25000;
const ENABLE_TRADING = process.env.REACT_APP_NEXUS_PREDICT_LIVE === '1';

// =====================================================================
// DESIGN TOKENS
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d', gold:'#f5b53d',
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
// FILTERS / LEAGUE CONFIG — ordered for engagement; Live up top.
// =====================================================================
const FILTERS = [
  { id: 'All',      label: 'All',      tag: null },
  { id: 'Live',     label: 'Live',     tag: null },
  { id: 'Tonight',  label: 'Tonight',  tag: null },
  { id: 'NFL',      label: 'NFL',      tag: 'nfl' },
  { id: 'NBA',      label: 'NBA',      tag: 'nba' },
  { id: 'Props',    label: 'Props',    tag: null },
  { id: 'NHL',      label: 'NHL',      tag: 'nhl' },
  { id: 'MLB',      label: 'MLB',      tag: 'mlb' },
  { id: 'UFC',      label: 'UFC',      tag: 'ufc' },
  { id: 'Soccer',   label: 'Soccer',   tag: 'soccer' },
  { id: 'Tennis',   label: 'Tennis',   tag: 'tennis' },
  { id: 'Politics', label: 'Politics', tag: 'politics' },
  { id: 'Events',   label: 'Events',   tag: null },
  { id: 'Futures',  label: 'Futures',  tag: null },
];

const LEAGUE_COLORS = {
  NFL:      ['#013369', '#d50a0a'],
  NBA:      ['#c8102e', '#1d428a'],
  NHL:      ['#6dd5ed', '#2193b0'],
  MLB:      ['#002d72', '#d50032'],
  UFC:      ['#d20a0a', '#1a1a1a'],
  SOCCER:   ['#00a651', '#0033a0'],
  TENNIS:   ['#c2d600', '#0a5c36'],
  POLITICS: ['#a87fff', '#97fce4'],
  EVENTS:   ['#f5b53d', '#a87fff'],
};
function leagueAccent(league) {
  return LEAGUE_COLORS[(league || '').toUpperCase()] || ['#a87fff', '#97fce4'];
}

const CAT_META = {
  live:     { label: 'LIVE',     color: '#ff3d5d', bg: 'rgba(255,61,93,.12)',   bd: 'rgba(255,61,93,.36)'  },
  tonight:  { label: 'TONIGHT',  color: '#97fce4', bg: 'rgba(151,252,228,.12)', bd: 'rgba(151,252,228,.30)' },
  props:    { label: 'PROP',     color: '#f5b53d', bg: 'rgba(245,181,61,.12)',  bd: 'rgba(245,181,61,.30)'  },
  politics: { label: 'POLITICS', color: '#a87fff', bg: 'rgba(168,127,255,.12)', bd: 'rgba(168,127,255,.30)' },
  events:   { label: 'EVENT',    color: '#5ce9c8', bg: 'rgba(92,233,200,.12)',  bd: 'rgba(92,233,200,.30)'  },
  futures:  { label: 'FUTURES',  color: '#ff8a9e', bg: 'rgba(255,138,158,.12)', bd: 'rgba(255,138,158,.30)' },
};

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
function isValidEvmAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '')); }
function priceToCents(price) {
  const p = Math.max(0, Math.min(1, Number(price) || 0));
  return Math.round(p * 100);
}
function formatCountdown(ms) {
  if (ms <= 0) return 'CLOSED';
  const s = Math.floor(ms / 1000);
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
  if (!startTs) return '';
  const d = new Date(startTs);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (sameDay) return d.toLocaleTimeString('en-US', opts) + ' ET';
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', opts);
}
async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(id); }
}
function loadCached(k, ttl) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return Date.now() - (d.ts || 0) > ttl ? null : d.data;
  } catch { return null; }
}
function saveCached(k, data) {
  try { localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function mergeRefunds(prev, next) {
  const seen = new Set(prev.map(r => r.id));
  const add = next.filter(r => r && r.id && !seen.has(r.id));
  return add.length ? [...prev, ...add] : prev;
}

// =====================================================================
// POLYMARKET GAMMA API CLIENT
// Verified against real Gamma response (May 2026):
//   - order=volume_24hr  (snake_case query, camelCase response)
//   - no tag_slug param — categorize client-side
//   - acceptingOrders + enableOrderBook must both be true to trade
//   - market.events[0].slug is the canonical /event/{slug} URL target
// =====================================================================
async function fetchPolymarketSports({ limit = 150 } = {}) {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    archived: 'false',
    limit: String(limit),
    order: 'volume_24hr',
    ascending: 'false',
  });
  const url = `${GAMMA_API_BASE}/markets?${params.toString()}`;
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 10_000);
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  return list.map(normalizePolyMarket).filter(Boolean);
}

function normalizePolyMarket(m) {
  if (!m) return null;
  if (m.acceptingOrders === false) return null;
  if (m.enableOrderBook === false) return null;
  if (m.closed === true || m.archived === true || m.active === false) return null;
  let outcomes = [];
  let prices = [];
  try {
    outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || []);
    prices   = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []);
  } catch {}
  if (outcomes.length !== 2) return null;
  const yesIdx = outcomes.findIndex(o => String(o).toLowerCase() === 'yes');
  if (yesIdx < 0) return null;
  const noIdx = yesIdx === 0 ? 1 : 0;
  const yesPrice = Number(prices[yesIdx]) || 0.5;
  const noPrice  = Number(prices[noIdx])  || (1 - yesPrice);
  const closeTs  = m.endDate ? new Date(m.endDate).getTime() : Date.now() + 86_400_000;
  const startTs  = m.startDate ? new Date(m.startDate).getTime() : null;
  if (!m.slug && !m.conditionId) return null;

  const events   = Array.isArray(m.events) ? m.events : [];
  const league   = detectLeague(m);
  const category = detectCategory(m, league);
  // Note: we don't try to detect "live" status from Gamma — the response
  // has no reliable flag for "game in progress" on binary markets, and
  // startDate is when the market opened (not when the underlying event
  // begins). All active markets render as upcoming.
  const teams    = parseTeams(m.question || m.title || '', league);

  return {
    id:           m.conditionId || m.id || m.slug,
    slug:         events[0]?.slug || m.slug || '',
    marketSlug:   m.slug || '',
    question:     m.question || m.title || '',
    subtitle:     events[0]?.title || '',
    description:  m.description || '',
    league, category,
    yesPrice, noPrice,
    closeTs,
    gameStartTs:  startTs,
    isLive:       false,
    liveStatus:   '',
    homeTeam:     teams.home,
    awayTeam:     teams.away,
    primetime:    detectPrimetime(startTs),
    volume24h:    Number(m.volume24hr || m.volume24h || m.volume || 0),
    liquidity:    Number(m.liquidity || m.liquidityNum || 0),
    hot:          Boolean(m.featured) || Number(m.volume24hr || 0) > 500_000,
  };
}

function detectLeague(m) {
  // No reliable tags field in default Gamma response — text-only detection.
  const events = Array.isArray(m.events) ? m.events : [];
  const eventTitle = events[0]?.title || '';
  const t = `${m.question || ''} ${eventTitle}`.toUpperCase();
  if (/\b(NFL|COWBOYS|EAGLES|PATRIOTS|49ERS|CHIEFS|RAMS|BILLS|JETS|GIANTS|LIONS|PACKERS|BEARS|VIKINGS|SAINTS|FALCONS|BRONCOS|STEELERS|RAVENS|TEXANS|COLTS)\b/.test(t)) return 'NFL';
  if (/\b(NBA|LAKERS|CELTICS|WARRIORS|HEAT|KNICKS|NUGGETS|BUCKS|76ERS|SIXERS|SUNS|MAVERICKS|MAVS|NETS|BULLS|THUNDER|CLIPPERS|GRIZZLIES|PISTONS)\b/.test(t)) return 'NBA';
  if (/\b(NHL|RANGERS|BRUINS|OILERS|AVALANCHE|MAPLE LEAFS|PANTHERS|LIGHTNING|STARS|CANUCKS)\b/.test(t)) return 'NHL';
  if (/\b(MLB|YANKEES|DODGERS|RED SOX|METS|CUBS|CARDINALS|ASTROS|PHILLIES|ORIOLES)\b/.test(t)) return 'MLB';
  if (/\b(UFC|MMA)\b/.test(t)) return 'UFC';
  if (/\b(LIVERPOOL|ARSENAL|MAN CITY|MAN UTD|MANCHESTER|CHELSEA|REAL MADRID|BARCELONA|BAYERN|PSG|JUVENTUS|EPL|PREMIER LEAGUE|CHAMPIONS LEAGUE)\b/.test(t)) return 'SOCCER';
  if (/\b(WIMBLEDON|US OPEN|FRENCH OPEN|AUSTRALIAN OPEN|DJOKOVIC|ALCARAZ|SINNER|MEDVEDEV)\b/.test(t)) return 'TENNIS';
  if (/\b(ELECTION|PRESIDENT|CONGRESS|SENATE|GOP|DEMOCRAT|REPUBLICAN|TRUMP|BIDEN|HARRIS)\b/.test(t)) return 'POLITICS';
  return 'EVENTS';
}

function detectCategory(m, league) {
  if (league === 'POLITICS') return 'politics';
  if (['NFL','NBA','NHL','MLB','UFC','SOCCER','TENNIS'].includes(league)) {
    const q = m.question || '';
    if (/player.*prop|over .* (points|yards|rebounds|assists|goals|strikeouts)/i.test(q)) return 'props';
    if (/championship|win the .*final|win the .* cup|super bowl winner|stanley cup|world series|nba finals/i.test(q)) return 'futures';
    return 'tonight';
  }
  if (/championship|win the/i.test(m.question || '')) return 'futures';
  return 'events';
}

function detectPrimetime(startTs) {
  if (!startTs) return false;
  const d = new Date(startTs);
  const hour = d.getHours();
  return hour >= 19 && hour <= 23;
}

function parseTeams(question, league) {
  if (!['NFL','NBA','NHL','MLB','SOCCER'].includes(league)) {
    return { home: null, away: null };
  }
  const TEAM_ABBR = {
    NFL: { Cowboys:'DAL', Eagles:'PHI', '49ers':'SF', Niners:'SF', Patriots:'NE', Chiefs:'KC', Rams:'LAR', Bills:'BUF', Jets:'NYJ', Giants:'NYG', Lions:'DET', Packers:'GB', Bears:'CHI', Vikings:'MIN', Saints:'NO', Falcons:'ATL', Broncos:'DEN', Steelers:'PIT', Ravens:'BAL' },
    NBA: { Lakers:'LAL', Celtics:'BOS', Warriors:'GSW', Heat:'MIA', Knicks:'NYK', Nuggets:'DEN', Bucks:'MIL', '76ers':'PHI', Sixers:'PHI', Suns:'PHX', Mavericks:'DAL', Mavs:'DAL', Nets:'BKN', Bulls:'CHI', Thunder:'OKC', Clippers:'LAC' },
    NHL: { Rangers:'NYR', Bruins:'BOS', Oilers:'EDM', Avalanche:'COL', Maple:'TOR', Leafs:'TOR', Panthers:'FLA', Lightning:'TBL' },
    MLB: { Yankees:'NYY', Dodgers:'LAD', Giants:'SF', 'Red Sox':'BOS', Mets:'NYM', Cubs:'CHC', Cardinals:'STL', Astros:'HOU', Phillies:'PHI' },
    SOCCER: { Liverpool:'LIV', Arsenal:'ARS', City:'MCI', United:'MUN', Chelsea:'CHE', Madrid:'RMA', Barcelona:'BAR', Bayern:'BAY' },
  };
  const table = TEAM_ABBR[league] || {};
  const names = Object.keys(table);
  const found = names.filter(n => question.includes(n));
  if (found.length >= 2) {
    return {
      home: { abbr: table[found[1]], name: found[1] },
      away: { abbr: table[found[0]], name: found[0] },
    };
  }
  return { home: null, away: null };
}

// =====================================================================
// SOLANA FEE+BRIDGE PIPELINE — identical engine to DeFiPredict
// =====================================================================
function deriveUsdcAta(ownerB58) {
  const owner    = new PublicKey(ownerB58);
  const mint     = new PublicKey(USDC_MINT_SOL);
  const tokProg  = new PublicKey(TOKEN_PROGRAM_ID);
  const ataProg  = new PublicKey(ATA_PROGRAM_ID);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokProg.toBuffer(), mint.toBuffer()],
    ataProg,
  );
  return ata.toBase58();
}

function createSplTransferInstruction(srcB58, dstB58, ownerB58, amountAtomic) {
  const data = new Uint8Array(9);
  data[0] = 3;
  let amt = BigInt(amountAtomic);
  for (let i = 0; i < 8; i++) { data[1 + i] = Number(amt & 0xffn); amt >>= 8n; }
  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(srcB58),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(dstB58),   isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(ownerB58), isSigner: true,  isWritable: false },
    ],
    data,
  });
}

async function fetchLookupTableAccounts(addrs) {
  if (!addrs?.length) return [];
  const out = [];
  for (const addr of addrs) {
    try {
      const res = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getAccountInfo', params:[addr,{encoding:'base64'}] }),
      }, 8_000);
      const data = await res.json();
      const raw = data?.result?.value?.data?.[0];
      if (!raw) continue;
      const buf = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const state = AddressLookupTableAccount.deserialize(buf);
      out.push(new AddressLookupTableAccount({ key: new PublicKey(addr), state }));
    } catch (e) { console.warn('[ALT fetch]', addr, e?.message); }
  }
  return out;
}

async function decompileVersionedTx(vtx) {
  const message = vtx.message;
  const altLookups = message.addressTableLookups || [];
  const altAddrs = altLookups.map(l => typeof l.accountKey === 'string' ? l.accountKey : l.accountKey.toBase58());
  const altAccounts = await fetchLookupTableAccounts(altAddrs);
  const keys = message.getAccountKeys({ addressLookupTableAccounts: altAccounts });
  const instructions = message.compiledInstructions.map(ci => new TransactionInstruction({
    programId: keys.get(ci.programIdIndex),
    keys: Array.from(ci.accountKeyIndexes).map(idx => ({
      pubkey:     keys.get(idx),
      isSigner:   message.isAccountSigner(idx),
      isWritable: message.isAccountWritable(idx),
    })),
    data: Buffer.from(ci.data),
  }));
  return {
    instructions,
    payerKey:   keys.get(0),
    altAccounts,
    blockhash:  message.recentBlockhash,
  };
}

function assembleFeeAndBridgeTx({ instructions, payerKey, altAccounts, blockhash, feeInstruction }) {
  const all = [feeInstruction, ...instructions];
  const msg = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: all,
  }).compileToV0Message(altAccounts);
  return new VersionedTransaction(msg);
}

async function simulateBeforeSign(serializedBase64) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc:'2.0', id:1, method:'simulateTransaction',
        params:[serializedBase64, { encoding:'base64', commitment:'processed', replaceRecentBlockhash:true, sigVerify:false }],
      }),
    }, 12_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message };
    const v = json?.result?.value;
    if (!v) return { ok: true };
    if (v.err) return { ok: false, message: parseSimError(v.err, v.logs) };
    return { ok: true };
  } catch { return { ok: true, warning: 'sim unavailable' }; }
}

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail?.Custom != null) {
      const code = Number(detail.Custom);
      if (code === 1) return 'Not enough USDC for stake + fee + bridge';
      if (code === 3) return 'USDC account not found — fund USDC first';
      return `Program error 0x${code.toString(16)} at ix ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at ix ${idx}`;
  }
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage/i.test(String(l)));
  return errLog ? String(errLog).slice(0, 140) : 'Order unavailable';
}

async function bridgeQuote({ amountUsdcAtomic, srcAddress, dstAddress }) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromChain: 'solana', toChain: 'polygon',
      fromToken: USDC_MINT_SOL, toToken: 'native-usdc',
      amountAtomic: String(amountUsdcAtomic),
      srcAddress, dstAddress, slippageBps: 50,
    }),
  }, 15_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Bridge quote failed (${res.status})`);
  return data;
}
async function bridgeSubmit(serializedSignedTxB64) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTxBase64: serializedSignedTxB64 }),
  }, 20_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Bridge submit failed (${res.status})`);
  return data;
}
async function bridgeStatus(trackerId) {
  const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/status?id=${encodeURIComponent(trackerId)}`, {}, 8_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { state: 'pending' };
  return data;
}

// Fire-and-forget. Backend reconciler refunds the Solana fee on bridge
// failure. No frontend polling.
async function trackBridge({ trackerId, userWallet, feeAtomic, marketId, marketSlug }) {
  try {
    await fetchWithTimeout(`${BRIDGE_API_BASE}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackerId, userWallet,
        feeAtomicUsdc: String(feeAtomic || 0),
        marketId, marketSlug,
      }),
    }, 6_000);
  } catch (e) { console.warn('[trackBridge]', e?.message); }
}

async function fetchUnseenRefunds(walletPubkey) {
  if (!walletPubkey) return [];
  try {
    const res = await fetchWithTimeout(`${BRIDGE_API_BASE}/refunds?wallet=${encodeURIComponent(walletPubkey)}`, {}, 6_000);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.refunds) ? data.refunds : [];
  } catch { return []; }
}
async function ackRefund(walletPubkey, refundId) {
  try {
    await fetchWithTimeout(`${BRIDGE_API_BASE}/refunds/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: walletPubkey, refundId }),
    }, 6_000);
  } catch {}
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
    }}>{closed ? 'CLOSED' : formatCountdown(remaining)}</span>
  );
}

function YesNoPills({ yesPrice, noPrice }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div style={{ padding: '3px 8px', borderRadius: 8, background: 'rgba(61,213,152,.10)', border: '1px solid rgba(61,213,152,.28)', ...T.mono }}>
        <span style={{ color: C.muted2, fontSize: 8, fontWeight: 700, marginRight: 4 }}>YES</span>
        <span style={{ color: C.up, fontSize: 11, fontWeight: 800 }}>{priceToCents(yesPrice)}¢</span>
      </div>
      <div style={{ padding: '3px 8px', borderRadius: 8, background: 'rgba(255,138,158,.10)', border: '1px solid rgba(255,138,158,.28)', ...T.mono }}>
        <span style={{ color: C.muted2, fontSize: 8, fontWeight: 700, marginRight: 4 }}>NO</span>
        <span style={{ color: C.down, fontSize: 11, fontWeight: 800 }}>{priceToCents(noPrice)}¢</span>
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

function LiveGameCard({ market, onBuy }) {
  if (!market) return null;
  const home = market.homeTeam;
  const away = market.awayTeam;
  const hasMatchup = home?.abbr && away?.abbr;
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

        {hasMatchup && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, padding: '10px 4px', marginBottom: 12, borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LeagueIcon league={market.league} label={away.abbr} size={36}/>
              <div>
                <div style={{ fontSize: 11, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{away.abbr}</div>
                <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, marginTop: 1, ...T.mono }}>{away.name}</div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, ...T.mono }}>VS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>{home.abbr}</div>
                <div style={{ fontSize: 13, color: C.ink, fontWeight: 700, marginTop: 1, ...T.mono }}>{home.name}</div>
              </div>
              <LeagueIcon league={market.league} label={home.abbr} size={36}/>
            </div>
          </div>
        )}

        <div style={{ fontSize: 19, fontWeight: 700, color: C.inkStr, lineHeight: 1.25, letterSpacing: '-.02em', marginBottom: 16, ...T.display }}>
          {market.question}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <BuyButton side="YES" price={market.yesPrice} onClick={() => onBuy(market, 'YES')}/>
          <BuyButton side="NO"  price={market.noPrice}  onClick={() => onBuy(market, 'NO')}/>
        </div>
      </div>
    </div>
  );
}

function BuyButton({ side, price, onClick }) {
  const isYes = side === 'YES';
  return (
    <button onClick={onClick} style={{
      padding: '13px 14px', borderRadius: 14,
      border: `1px solid ${isYes ? 'rgba(61,213,152,.40)' : 'rgba(255,138,158,.40)'}`,
      background: isYes
        ? 'linear-gradient(135deg,rgba(61,213,152,.14),rgba(92,233,200,.06))'
        : 'linear-gradient(135deg,rgba(255,138,158,.14),rgba(168,127,255,.06))',
      color: isYes ? C.up : C.down, cursor: 'pointer', textAlign: 'left',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      boxShadow: isYes ? '0 6px 18px rgba(61,213,152,.10)' : '0 6px 18px rgba(255,138,158,.10)',
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: .85, ...T.mono }}>BUY {side}</div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Pays $1 if {side.toLowerCase()}</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, ...T.display }}>{priceToCents(price)}¢</div>
    </button>
  );
}

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
          <BuyButton side="YES" price={market.yesPrice} onClick={() => onBuy(market, 'YES')}/>
          <BuyButton side="NO"  price={market.noPrice}  onClick={() => onBuy(market, 'NO')}/>
        </div>
      </div>
    </div>
  );
}

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
          {market.isLive ? <LiveDot size={6} label={market.liveStatus || 'LIVE'}/> : <CategoryBadge category={market.category} small/>}
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
// BUY MODAL — one signature fee+bridge. Identical to DeFiPredict modal.
// =====================================================================
function BuyModal({ open, onClose, market, initialSide, walletPubkey, evmAddress, onConnectWallet, onAddEvm }) {
  const { connected, signTransaction } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]           = useState('YES');
  const [amount, setAmount]       = useState('');
  const [status, setStatus]       = useState('idle'); // idle|quoting|signing|submitting|error
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError]         = useState('');

  useBodyLock(open);
  useEffect(() => {
    if (open) {
      setSide(initialSide || 'YES');
      setAmount(''); setStatus('idle'); setError(''); setStatusMsg('');
    }
  }, [open, initialSide, market?.id]);

  // No frontend bridge polling. Tracker handed off to backend; modal
  // closes on submit; refunds (if any) surface via RefundToast.

  if (!open || !market) return null;

  const isYes      = side === 'YES';
  const livePrice  = isYes ? market.yesPrice : market.noPrice;
  const usd        = parseFloat(amount) || 0;
  const feeBps     = feeBpsFor(market.category);
  const feeUsd     = usd * (feeBps / 10_000);
  const netUsd     = Math.max(0, usd - feeUsd);
  const contracts  = livePrice > 0 ? netUsd / livePrice : 0;
  const maxPayout  = contracts;
  const profitIfWin = Math.max(0, maxPayout - usd);
  const tooSmall   = usd > 0 && usd < MIN_ORDER_USDC;
  const tooLarge   = usd > MAX_ORDER_USDC;

  const isBusy    = ['quoting','signing','submitting'].includes(status);
  const isError   = status === 'error';
  const quickChips = [10, 50, 250, 1000];

  const execute = async () => {
    if (!wcon)                    { onConnectWallet?.(); return; }
    if (!walletPubkey)            { setError('Wallet not connected'); return; }
    if (!isValidSolAddress(walletPubkey)) { setError('Invalid Solana address'); return; }
    if (!evmAddress || !isValidEvmAddress(evmAddress)) {
      setError('Add a Polygon address to receive bridged USDC');
      onAddEvm?.(); return;
    }
    if (!usd || tooSmall) { setError(`Minimum order is $${MIN_ORDER_USDC}`); return; }
    if (tooLarge)         { setError(`Maximum order is $${MAX_ORDER_USDC.toLocaleString()}`); return; }
    if (!TREASURY_USDC_ATA) { setError('Treasury not configured'); return; }
    if (!signTransaction)   { setError('Wallet cannot sign transactions'); return; }
    if (!ENABLE_TRADING)    { setError('Live trading disabled — set REACT_APP_NEXUS_PREDICT_LIVE=1'); return; }

    setStatus('quoting'); setError(''); setStatusMsg('Getting bridge quote…');
    try {
      const netAtomic = Math.floor(netUsd * Math.pow(10, USDC_DECIMALS));
      const feeAtomic = Math.floor(feeUsd * Math.pow(10, USDC_DECIMALS));
      if (feeAtomic <= 0) throw new Error('Fee too small to compute');

      // 1. Get Mayan bridge tx for net amount → user's Polygon address
      const quote = await bridgeQuote({
        amountUsdcAtomic: netAtomic,
        srcAddress:       walletPubkey,
        dstAddress:       evmAddress,
      });
      if (!quote?.serializedTx) throw new Error('Bridge returned no transaction');

      // 2. Deserialize, decompile, inject our fee SPL transfer at index 0
      const txBytes = Uint8Array.from(atob(quote.serializedTx), c => c.charCodeAt(0));
      let bridgeTx;
      try { bridgeTx = VersionedTransaction.deserialize(txBytes); }
      catch { throw new Error('Bridge returned an unsupported tx format'); }

      const decompiled = await decompileVersionedTx(bridgeTx);
      const userUsdcAta = deriveUsdcAta(walletPubkey);
      const feeIx = createSplTransferInstruction(userUsdcAta, TREASURY_USDC_ATA, walletPubkey, feeAtomic);
      const wrapped = assembleFeeAndBridgeTx({
        instructions:   decompiled.instructions,
        payerKey:       decompiled.payerKey,
        altAccounts:    decompiled.altAccounts,
        blockhash:      decompiled.blockhash,
        feeInstruction: feeIx,
      });

      // 3. Pre-sim before Phantom — never prompt on a doomed tx
      setStatusMsg('Checking transaction…');
      const serializedForSim = btoa(String.fromCharCode(...wrapped.serialize()));
      const sim = await simulateBeforeSign(serializedForSim);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      // 4. User signs ONCE
      setStatus('signing'); setStatusMsg('Sign in your wallet…');
      const signed = await signTransaction(wrapped);

      // 5. Submit to bridge relayer
      setStatus('submitting'); setStatusMsg('Submitting transaction…');
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const submit = await bridgeSubmit(serialized);
      if (!submit?.trackerId) throw new Error('Bridge submit returned no tracker');

      // 6. Hand off the tracker to backend. Fire-and-forget. Backend's
      //    cron reconciles bridge outcomes and refunds the Solana fee
      //    on failure. Frontend never polls.
      void trackBridge({
        trackerId:    submit.trackerId,
        userWallet:   walletPubkey,
        feeAtomic,
        marketId:     market.id,
        marketSlug:   market.slug,
      });

      // 7. Close the modal immediately. User moves on.
      setStatus('idle'); setStatusMsg('');
      onClose();
    } catch (e) {
      console.error('[buy]', e);
      setError(e.message || 'Order failed');
      setStatus('error'); setStatusMsg('');
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
          {/* YES/NO toggle */}
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

          {/* Amount */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>AMOUNT (USDC ON SOLANA)</span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>{(feeBps / 100).toFixed(2)}% FEE</span>
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
                  flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.03)', color: C.muted,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono,
                }}>${c}</button>
              ))}
            </div>
            {tooSmall && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Minimum order is ${MIN_ORDER_USDC}</div>}
            {tooLarge && <div style={{ marginTop: 8, fontSize: 11, color: C.down, fontWeight: 700, ...T.body }}>Max order is ${MAX_ORDER_USDC.toLocaleString()}</div>}
          </div>

          {/* Preview */}
          {usd > 0 && !tooSmall && !tooLarge && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>ORDER PREVIEW</div>
              {[
                ['Stake',                fmt(usd, 2)],
                [`Nexus fee ${(feeBps/100).toFixed(2)}%`, '-' + fmt(feeUsd, 2)],
                ['Bridged to Polygon',   fmt(netUsd, 2)],
                ['Buys',                 contracts.toFixed(2) + ' ' + side + ' contracts'],
                ['Price per share',      priceToCents(livePrice) + '¢'],
                ['Max payout',           fmt(maxPayout, 2)],
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

          {/* EVM destination */}
          <div style={{ background: 'rgba(168,127,255,.04)', border: '1px solid rgba(168,127,255,.18)', borderRadius: 14, padding: '11px 13px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.violet, fontWeight: 800, letterSpacing: '.08em', ...T.mono }}>BRIDGE DESTINATION (POLYGON)</span>
              {!evmAddress && (
                <button onClick={() => onAddEvm?.()} style={{ background: 'transparent', border: 'none', color: C.hl, fontSize: 10, fontWeight: 700, cursor: 'pointer', ...T.mono }}>+ Add</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: evmAddress ? C.ink : C.muted2, fontFamily: 'monospace', wordBreak: 'break-all', ...T.mono }}>
              {evmAddress || 'No EVM address linked — required to receive bridged USDC.'}
            </div>
          </div>
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)',
          borderTop: `1px solid ${C.hairline}`,
          background: `linear-gradient(180deg, transparent 0%, ${C.bg} 20%)`,
        }}>
          {isBusy && statusMsg && (
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
            <button onClick={execute} disabled={isBusy || !amount || tooSmall || tooLarge || !evmAddress} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isError
                ? `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`
                : isYes
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !amount || tooSmall || tooLarge || !evmAddress ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !amount || tooSmall || tooLarge || !evmAddress ? 0.55 : 1,
              boxShadow: isYes ? '0 12px 30px rgba(61,213,152,.22)' : '0 12px 30px rgba(255,138,158,.24)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing…' : isError ? 'Retry' : usd > 0 && !tooSmall && !tooLarge
                ? `Stake ${fmt(usd, 2)} on ${side}`
                : `Buy ${side}`}
            </button>
          )}

          <div style={{ fontSize: 10, color: C.muted2, textAlign: 'center', marginTop: 10, fontWeight: 600, ...T.mono }}>
            Non-custodial · Solana fee + Polygon bridge · One signature
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// RefundToastStack — only async outcome the user sees. Backend has
// already returned the USDC fee to their Solana wallet; this surfaces
// that. Bottom-right corner, dismissible, stacks.
// =====================================================================
function RefundToastStack({ refunds, onDismiss }) {
  if (!refunds || refunds.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', right: 14,
      bottom: 'calc(env(safe-area-inset-bottom) + 96px)',
      zIndex: 380, display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 360,
    }}>
      {refunds.slice(-3).map(r => (
        <div key={r.id} style={{
          padding: '12px 14px', borderRadius: 14,
          background: 'linear-gradient(145deg,rgba(61,213,152,.10),rgba(151,252,228,.06))',
          border: '1px solid rgba(61,213,152,.32)',
          boxShadow: '0 12px 36px rgba(0,0,0,.55), 0 0 24px rgba(61,213,152,.18)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(61,213,152,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: C.up, fontSize: 14, fontWeight: 900 }}>↺</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.up, letterSpacing: '.06em', ...T.mono, marginBottom: 2 }}>FEE REFUNDED</div>
            <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.4, ...T.body }}>
              Bridge didn't complete on a recent trade. We returned {fmt(Number(r.feeUsd || 0), 2)} USDC to your Solana wallet.
            </div>
            {r.marketSlug && (
              <div style={{ fontSize: 10, color: C.muted2, marginTop: 3, ...T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.marketSlug}
              </div>
            )}
          </div>
          <button onClick={() => onDismiss(r.id)} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// EvmAddressPrompt — capture/edit the user's Polygon destination
// =====================================================================
function EvmAddressPrompt({ open, onClose, onSave, current }) {
  const [val, setVal] = useState(current || '');
  const [err, setErr] = useState('');
  useBodyLock(open);
  useEffect(() => { if (open) { setVal(current || ''); setErr(''); } }, [open, current]);
  if (!open) return null;
  const handleSave = () => {
    if (!isValidEvmAddress(val.trim())) { setErr('Not a valid Polygon address'); return; }
    if (!onSave(val.trim())) setErr('Could not save address');
  };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 470, background: 'rgba(0,0,0,.86)', backdropFilter: 'blur(14px)', cursor: 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500, zIndex: 471,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: '1px solid rgba(168,127,255,.30)', borderRadius: '26px 26px 0 0',
        padding: '20px 22px calc(env(safe-area-inset-bottom) + 90px)',
      }}>
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 18px' }}/>
        <div style={{ color: C.inkStr, fontWeight: 800, fontSize: 19, letterSpacing: '-.02em', marginBottom: 6, ...T.display }}>Add Polygon address</div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 16, lineHeight: 1.5, ...T.body }}>
          Where your bridged USDC lands. Phantom Multichain users: paste your Ethereum/Polygon address from Phantom (same wallet, EVM side).
        </div>
        <input value={val} onChange={e => { setVal(e.target.value); setErr(''); }} placeholder="0x…"
          style={{ width: '100%', padding: '13px 14px', borderRadius: 14, border: `1px solid ${err ? 'rgba(255,138,158,.40)' : C.border}`, background: 'rgba(255,255,255,.04)', color: C.inkStr, fontSize: 13, ...T.mono, outline: 'none', marginBottom: err ? 6 : 12 }}/>
        {err && <div style={{ fontSize: 11, color: C.down, marginBottom: 12, ...T.body }}>{err}</div>}
        <button onClick={handleSave} style={{
          width: '100%', padding: 16, borderRadius: 16, border: 'none',
          background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`,
          color: '#04070f', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 52, ...T.display,
        }}>Save address</button>
      </div>
    </>
  );
}

// =====================================================================
// MAIN COMPONENT — Predictions Tonight
// =====================================================================
export default function PredictionsTonight({ onConnectWallet }) {
  const [markets, setMarkets]     = useState(() => loadCached('nexus_poly_sports_v2', 45_000) || []);
  const [filter, setFilter]       = useState('All');
  const [buyOpen, setBuyOpen]     = useState(false);
  const [activeMarket, setActive] = useState(null);
  const [initialSide, setSide]    = useState('YES');
  const [mode, setMode]           = useState('singles'); // 'singles' | 'parlay'
  const [evmAddress, setEvmAddr]  = useState(() => {
    try { return localStorage.getItem('nexus_evm_address') || ''; } catch { return ''; }
  });
  const [evmPromptOpen, setEvmPromptOpen] = useState(false);
  const [refunds, setRefunds]             = useState([]);

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Refunds: poll on wallet connect, then every 5 min. Backend has
  // already credited the fee back to the user's Solana wallet — this
  // surface only notifies them.
  useEffect(() => {
    if (!walletPubkey) { setRefunds([]); return; }
    let alive = true;
    const tick = async () => {
      const list = await fetchUnseenRefunds(walletPubkey);
      if (alive && list.length) setRefunds(prev => mergeRefunds(prev, list));
    };
    tick();
    const id = setInterval(tick, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [walletPubkey]);

  const dismissRefund = useCallback((refundId) => {
    setRefunds(prev => prev.filter(r => r.id !== refundId));
    if (walletPubkey) void ackRefund(walletPubkey, refundId);
  }, [walletPubkey]);

  // Single fetch of top-volume markets. We categorize and filter
  // client-side (Live/Tonight/NFL/NBA/Props/Politics/etc.) so flipping
  // the pill doesn't refetch.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchPolymarketSports({ limit: 200 });
        if (!alive || !data?.length) return;
        setMarkets(data);
        saveCached('nexus_poly_sports_v2', data);
      } catch (e) { console.warn('[gamma sports poll]', e?.message); }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const handleBuy = (market, sideArg) => {
    setActive(market); setSide(sideArg); setBuyOpen(true);
  };
  const handleAddEvm = () => setEvmPromptOpen(true);
  const saveEvm = (addr) => {
    const a = String(addr || '').trim();
    if (!isValidEvmAddress(a)) return false;
    setEvmAddr(a);
    try { localStorage.setItem('nexus_evm_address', a); } catch {}
    setEvmPromptOpen(false);
    return true;
  };

  // Ordering: Live → Primetime → Tonight → Props → Politics → Events → Futures
  const ordered = useMemo(() => {
    if (!markets.length) return [];
    const buckets = {
      live:        markets.filter(m => m.isLive),
      ptTonight:   markets.filter(m => !m.isLive && m.primetime && m.category === 'tonight'),
      tonightRest: markets.filter(m => !m.isLive && !m.primetime && m.category === 'tonight'),
      props:       markets.filter(m => m.category === 'props'),
      politics:    markets.filter(m => m.category === 'politics'),
      events:      markets.filter(m => m.category === 'events'),
      futures:     markets.filter(m => m.category === 'futures'),
    };
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    }
    const all = [...buckets.live, ...buckets.ptTonight, ...buckets.tonightRest, ...buckets.props, ...buckets.politics, ...buckets.events, ...buckets.futures];
    const seen = new Set();
    return all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  }, [markets]);

  const filtered = useMemo(() => {
    if (filter === 'All')      return ordered;
    if (filter === 'Live')     return ordered.filter(m => m.isLive);
    if (filter === 'Tonight')  return ordered.filter(m => m.category === 'tonight' || m.isLive);
    if (filter === 'Props')    return ordered.filter(m => m.category === 'props');
    if (filter === 'Politics') return ordered.filter(m => m.category === 'politics');
    if (filter === 'Events')   return ordered.filter(m => m.category === 'events');
    if (filter === 'Futures')  return ordered.filter(m => m.category === 'futures');
    return ordered.filter(m => (m.league || '').toUpperCase() === filter.toUpperCase());
  }, [ordered, filter]);

  const featured = useMemo(() => {
    if (!filtered.length) return null;
    const live = filtered.filter(m => m.isLive);
    if (live.length) return live.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0];
    const pt = filtered.filter(m => m.primetime);
    if (pt.length) return pt.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0];
    return filtered.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))[0] || null;
  }, [filtered]);

  const listMarkets = useMemo(() => {
    if (!featured) return filtered;
    return filtered.filter(m => m.id !== featured.id);
  }, [filtered, featured]);

  const liveCount    = useMemo(() => markets.filter(m => m.isLive).length, [markets]);
  const tonightCount = useMemo(() => markets.filter(m => m.category === 'tonight' || m.isLive).length, [markets]);
  const totalVol     = useMemo(() => markets.reduce((s, m) => s + Number(m.volume24h || 0), 0), [markets]);

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nexus-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      {/* MODE TOGGLE — Singles | Parlay */}
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '12px 16px 4px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'inline-flex', padding: 4, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 999, gap: 4 }}>
          {[
            { id: 'singles', label: 'Singles' },
            { id: 'parlay',  label: 'Parlay'  },
          ].map(opt => {
            const isActive = mode === opt.id;
            const isParlay = opt.id === 'parlay';
            return (
              <button key={opt.id} onClick={() => setMode(opt.id)} style={{
                padding: '8px 22px', borderRadius: 999, border: 'none',
                background: isActive
                  ? (isParlay ? `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)` : 'rgba(151,252,228,.14)')
                  : 'transparent',
                color: isActive ? (isParlay ? '#04070f' : C.hl) : C.muted,
                fontWeight: 800, fontSize: 12, cursor: 'pointer', letterSpacing: '-.01em',
                transition: 'all .15s', ...T.display,
              }}>
                {opt.label}
                {isParlay && !isActive && (
                  <span style={{ marginLeft: 6, fontSize: 8, padding: '1px 5px', borderRadius: 999, background: 'rgba(245,181,61,.15)', color: C.gold, fontWeight: 800, letterSpacing: '.06em', ...T.mono }}>NEW</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {mode === 'parlay' ? (
        <ParlayBuilder onConnectWallet={onConnectWallet}/>
      ) : (
        <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

          {/* HERO */}
          <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,61,93,.14),transparent 65%)', pointerEvents: 'none' }}/>
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', marginBottom: 16 }}>
                {liveCount > 0 ? <LiveDot label={`${liveCount} LIVE NOW`}/> : (
                  <>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.hl, boxShadow: `0 0 10px ${C.hl}`, animation: 'nexus-pulse 2s ease-in-out infinite' }}/>
                    <span style={{ color: C.hl, fontSize: 10, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>POLYMARKET LIQUIDITY</span>
                  </>
                )}
              </div>
              <h1 style={{ fontSize: 34, lineHeight: 1.0, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.045em', ...T.hero }}>
                Predictions{' '}
                <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Tonight</span>
              </h1>
              <p style={{ color: C.muted, fontSize: 13, margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
                Sports, politics, live games. Stake USDC on Solana, we route to Polymarket on Polygon — one signature.
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

          {/* FILTER PILLS */}
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
                {markets.length === 0 ? 'Loading markets from Polymarket…' : 'No markets in this category right now.'}
              </div>
            ) : listMarkets.map(m => (
              <MarketRow key={m.id} market={m} onClick={() => handleBuy(m, 'YES')}/>
            ))}
          </div>

          {/* FOOTER */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>MARKETS</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>POLYMARKET</span>
            <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
            <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>BRIDGE</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.ink, letterSpacing: '.04em', ...T.mono }}>MAYAN</span>
          </div>
          <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
            Stake USDC on Solana. Atomic fee + cross-chain bridge in one signature. Position settles on Polymarket. Nexus is non-custodial and not affiliated with Polymarket Inc.
          </div>

          <BuyModal
            open={buyOpen}
            onClose={() => setBuyOpen(false)}
            market={activeMarket}
            initialSide={initialSide}
            walletPubkey={walletPubkey}
            evmAddress={evmAddress}
            onConnectWallet={onConnectWallet}
            onAddEvm={handleAddEvm}
          />
          <EvmAddressPrompt open={evmPromptOpen} onClose={() => setEvmPromptOpen(false)} onSave={saveEvm} current={evmAddress}/>
          <RefundToastStack refunds={refunds} onDismiss={dismissRefund}/>
        </div>
      )}
    </>
  );
}
