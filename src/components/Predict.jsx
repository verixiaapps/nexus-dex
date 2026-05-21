// ─────────────────────────────────────────────────────────────────────
// Predict — Polymarket prediction markets, crypto focus.
//
// Read-only market discovery via Gamma API. Trade execution wired up
// separately (CLOB SDK + LI.FI bridge) once Polygon wallet derivation
// is in place. For now: live markets, real prices, real volume, real
// resolution dates. Tapping a market opens an order preview drawer
// (placeholder until execution layer lands).
//
// Crypto-only because crypto markets carry Polymarket's highest fees
// (1.80% peak) which maximizes our referral revenue share.
//
// Geo block: US users see a regional-unavailability screen. Detection
// uses Cloudflare's free trace endpoint (ip → country, no API key).
// ─────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';

const VIP_WALLETS = new Set(['Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV']);

// Brand tokens — match the dark/cyan aesthetic of Swap and Perps.
const C = {
  bg:        '#03060f',
  card:      '#080d1a',
  cardHi:    '#0c1428',
  ink:       '#e8ecf5',
  muted:     '#8a96b8',
  border:    'rgba(151,252,228,.10)',
  borderHi:  'rgba(151,252,228,.30)',
  hl:        '#97fce4',
  hlDim:     'rgba(151,252,228,.10)',
  yes:       '#00d4a3',
  yesDim:    'rgba(0,212,163,.12)',
  no:        '#ff5f7a',
  noDim:     'rgba(255,95,122,.12)',
  shadow:    '0 8px 28px rgba(0,0,0,.45)',
  shadowLg:  '0 18px 56px rgba(0,0,0,.55)',
};

const T = {
  body:    { fontFamily: 'DM Sans, system-ui, sans-serif' },
  display: { fontFamily: 'Syne, Inter, sans-serif' },
  mono:    { fontFamily: 'IBM Plex Mono, monospace' },
};

// Polymarket Gamma API. Crypto tag = 21 per Polymarket's own canonical mapping.
const GAMMA_URL = 'https://gamma-api.polymarket.com';
const CRYPTO_TAG_ID = 21;

// Geo lookup — Cloudflare's free unauthenticated trace endpoint. Returns
// "loc=US\n" among other key/value lines. No SDK, no API key, ~50ms.
const GEO_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const GEO_CACHE_KEY = 'verixia_geo_country_v1';
const GEO_CACHE_TTL = 12 * 60 * 60 * 1000;

const US_BLOCK = new Set(['US']);

async function detectCountry() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (raw) {
      const { country, ts } = JSON.parse(raw);
      if (country && Date.now() - ts < GEO_CACHE_TTL) return country;
    }
  } catch {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    const loc = (text.match(/loc=([A-Z]{2})/) || [])[1] || null;
    if (loc) {
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country: loc, ts: Date.now() })); } catch {}
    }
    return loc;
  } catch { return null; }
}

// Fetch crypto-tagged active markets. Sort by 24h volume desc.
async function fetchCryptoMarkets() {
  const url = `${GAMMA_URL}/events?tag_id=${CRYPTO_TAG_ID}&related_tags=true&closed=false&order=volume24hr&ascending=false&limit=50`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gamma ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Normalize an event (Polymarket bundles related markets in "events";
// each event has 1+ markets. For binary Yes/No events the first market
// is the canonical one).
function normalizeEvent(ev) {
  const markets = Array.isArray(ev.markets) ? ev.markets : [];
  if (markets.length === 0) return null;
  const market = markets[0];
  let outcomePrices = [];
  try {
    outcomePrices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : (market.outcomePrices || []);
  } catch {}
  const yesPrice = Number(outcomePrices[0] || market.lastTradePrice || 0);
  const noPrice  = Number(outcomePrices[1] || (1 - yesPrice));
  return {
    id:           ev.id,
    slug:         ev.slug,
    title:        ev.title || market.question || 'Untitled',
    image:        ev.image || ev.icon || market.image || null,
    volume24h:    Number(ev.volume24hr || market.volume24hr || 0),
    volumeTotal:  Number(ev.volume || market.volume || 0),
    liquidity:    Number(ev.liquidity || market.liquidity || 0),
    endDate:      ev.endDate || market.endDate || null,
    yesPrice,
    noPrice,
    yesPct:       Math.round(yesPrice * 100),
    noPct:        Math.round(noPrice * 100),
    marketCount:  markets.length,
    conditionId:  market.conditionId,
    clobTokenIds: (() => {
      try { return typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []); }
      catch { return []; }
    })(),
  };
}

function formatVol(n) {
  if (!n || n <= 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Resolving';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d >= 30) return `${Math.floor(d / 30)}mo`;
  if (d >= 1)  return `${d}d ${h}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ─── Geo block screen ───────────────────────────────────────────────
function RegionBlock() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '36px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display }}>Predict isn't available here</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Prediction markets are restricted in your region. Swap, VIP, and Wallet remain fully available.
        </div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────
function MarketSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: C.card, border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,.04)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, width: '85%', background: 'rgba(255,255,255,.06)', borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: '50%', background: 'rgba(255,255,255,.03)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
        <div style={{ flex: 1, height: 42, background: 'rgba(255,255,255,.03)', borderRadius: 10 }} />
      </div>
    </div>
  );
}

// ─── Market card ────────────────────────────────────────────────────
function MarketCard({ market, onTrade }) {
  const { title, image, yesPct, noPct, yesPrice, noPrice, volume24h, endDate, marketCount } = market;
  const resolves = timeUntil(endDate);

  return (
    <div style={{ padding: 16, borderRadius: 16, background: `linear-gradient(145deg, ${C.card}, ${C.cardHi})`, border: `1px solid ${C.border}`, marginBottom: 10, boxShadow: C.shadow }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        {image && (
          <img src={image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#0a1020' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: 6, ...T.body }}>{title}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: C.muted, ...T.mono }}>
            <span>Vol {formatVol(volume24h)}</span>
            {resolves && (<><span style={{ opacity: .4 }}>·</span><span>{resolves}</span></>)}
            {marketCount > 1 && (<><span style={{ opacity: .4 }}>·</span><span>{marketCount} outcomes</span></>)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: yesPct >= 50 ? C.yes : C.no, lineHeight: 1, ...T.display }}>{yesPct}%</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, ...T.mono }}>YES</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onTrade(market, 'yes')} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: C.yesDim, border: `1px solid rgba(0,212,163,.30)`, color: C.yes, fontWeight: 700, fontSize: 13, cursor: 'pointer', ...T.body }}>
          Yes · ${yesPrice.toFixed(2)}
        </button>
        <button onClick={() => onTrade(market, 'no')} style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: C.noDim, border: `1px solid rgba(255,95,122,.30)`, color: C.no, fontWeight: 700, fontSize: 13, cursor: 'pointer', ...T.body }}>
          No · ${noPrice.toFixed(2)}
        </button>
      </div>
    </div>
  );
}

// ─── Order preview drawer ───────────────────────────────────────────
// Placeholder: shows the trade intent. Execution path lights up once
// Polygon wallet derivation + LI.FI bridge skim address are wired in.
function OrderDrawer({ market, side, onClose }) {
  const [amount, setAmount] = useState('10');
  if (!market) return null;
  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  const usd = Number(amount) || 0;
  const shares = price > 0 ? usd / price : 0;
  const potentialReturn = shares; // each share pays $1 if it resolves your way
  const upside = usd > 0 ? ((potentialReturn - usd) / usd) * 100 : 0;
  const sideColor = side === 'yes' ? C.yes : C.no;
  const sideDim   = side === 'yes' ? C.yesDim : C.noDim;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,6,15,.74)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: `linear-gradient(180deg, ${C.cardHi}, ${C.card})`, borderTop: `1px solid ${C.borderHi}`, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 18px calc(env(safe-area-inset-bottom) + 22px)', boxShadow: C.shadowLg }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,.14)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4, lineHeight: 1.35, ...T.body }}>{market.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <div style={{ padding: '4px 10px', borderRadius: 99, background: sideDim, border: `1px solid ${sideColor}55`, color: sideColor, fontSize: 10, fontWeight: 800, letterSpacing: 1, ...T.mono }}>{side.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: C.muted, ...T.mono }}>${price.toFixed(3)} · {Math.round(price * 100)}%</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, ...T.mono }}>You pay</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 20, color: C.muted, ...T.display }}>$</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.ink, fontSize: 22, fontWeight: 700, ...T.display }} />
            <span style={{ fontSize: 11, color: C.muted, ...T.mono }}>USDC</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['10', '25', '100', '250'].map(v => (
              <button key={v} onClick={() => setAmount(v)} style={{ flex: 1, padding: '7px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer', ...T.mono }}>${v}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 14px', borderRadius: 12, background: 'rgba(151,252,228,.04)', border: `1px solid ${C.border}`, marginBottom: 16, ...T.mono, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>Shares</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{shares.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: C.muted }}>If {side.toUpperCase()} wins</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>${potentialReturn.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Upside</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>+{upside.toFixed(1)}%</span>
          </div>
        </div>

        <button disabled style={{ width: '100%', padding: '14px', borderRadius: 13, background: `linear-gradient(135deg, ${sideColor}33, ${sideColor}22)`, border: `1px solid ${sideColor}66`, color: sideColor, fontWeight: 800, fontSize: 14, cursor: 'not-allowed', opacity: .85, ...T.body, letterSpacing: .5 }}>
          Coming soon · bridge + sign
        </button>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 10, textAlign: 'center', lineHeight: 1.5, ...T.mono }}>
          Order routes via Solana → Polygon bridge, then signs on Polymarket. Wiring in progress.
        </div>
      </div>
    </div>
  );
}

// ─── Main tab (gated) ───────────────────────────────────────────────
function PredictInner({ bypassGeo = false }) {
  const [country, setCountry] = useState(null);
  const [geoChecked, setGeoChecked] = useState(false);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [orderMarket, setOrderMarket] = useState(null);
  const [orderSide, setOrderSide]     = useState('yes');
  const mountedRef = useRef(true);

  // Geo detection on mount.
  useEffect(() => {
    let alive = true;
    detectCountry().then(c => {
      if (!alive) return;
      setCountry(c);
      setGeoChecked(true);
    });
    return () => { alive = false; };
  }, []);

  // Fetch markets after geo passes. Refresh every 30s.
  useEffect(() => {
    if (!geoChecked) return;
    if (!bypassGeo && country && US_BLOCK.has(country)) return; // blocked, no fetch
    let alive = true;
    const load = async () => {
      try {
        const events = await fetchCryptoMarkets();
        if (!alive) return;
        const normalized = events.map(normalizeEvent).filter(Boolean);
        setMarkets(normalized);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Failed to load markets');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [geoChecked, country, bypassGeo]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return markets;
    return markets.filter(m => (m.title || '').toLowerCase().includes(q));
  }, [markets, search]);

  const openTrade = useCallback((market, side) => {
    setOrderMarket(market);
    setOrderSide(side);
  }, []);

  // Geo block (VIP wallets bypass).
  if (!bypassGeo && geoChecked && country && US_BLOCK.has(country)) {
    return <RegionBlock />;
  }

  // Pre-geo or pre-data: skeleton.
  if (!geoChecked || loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)' }}>
        <Header />
        {[1,2,3,4,5].map(i => <MarketSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <>
      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 100px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
        <Header />

        <div style={{ marginBottom: 14, position: 'relative' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crypto markets..."
            inputMode="search"
            enterKeyHint="search"
            style={{
              width: '100%', padding: '11px 14px 11px 38px',
              background: 'rgba(255,255,255,.04)',
              border: `1px solid ${C.border}`,
              borderRadius: 12, color: C.ink, fontSize: 13, outline: 'none',
              ...T.body,
            }}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(255,95,122,.07)', border: '1px solid rgba(255,95,122,.25)', color: C.no, fontSize: 12, marginBottom: 12, ...T.body }}>
            {error}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13, ...T.body }}>
            {search ? `No markets match "${search}"` : 'No active crypto markets right now.'}
          </div>
        )}

        {filtered.map(m => (
          <MarketCard key={m.id || m.slug} market={m} onTrade={openTrade} />
        ))}

        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, fontSize: 11, color: C.muted, lineHeight: 1.55, textAlign: 'center', ...T.mono }}>
          Markets sourced from Polymarket. Settled in USDC on Polygon. Resolution by UMA oracle.
        </div>
      </div>

      {orderMarket && (
        <OrderDrawer
          market={orderMarket}
          side={orderSide}
          onClose={() => setOrderMarket(null)}
        />
      )}
    </>
  );
}

function Header() {
  return (
    <div style={{ marginTop: 8, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.14),transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: C.ink, letterSpacing: -1, ...T.display }}>Predict</h1>
          <div style={{ fontSize: 10, color: C.hl, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 99, fontWeight: 700, letterSpacing: 1, ...T.mono }}>CRYPTO</div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, ...T.mono, marginTop: 6 }}>Trade real-world outcomes · Polymarket</div>
      </div>
    </div>
  );
}

// ─── Coming soon (non-VIP) ──────────────────────────────────────────
function ComingSoon() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '60px 16px 100px', textAlign: 'center' }}>
      <div style={{ padding: '40px 28px', borderRadius: 22, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: `1px solid ${C.border}`, boxShadow: C.shadowLg }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 14, background: C.hlDim, border: `1px solid ${C.borderHi}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.hl} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 14l3-3 4 4 6-7"/>
            <circle cx="20" cy="8" r="1.5" fill={C.hl}/>
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 10, ...T.display, letterSpacing: -.5 }}>Predict</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, ...T.body }}>
          Coming soon. Trade crypto prediction markets directly from your Solana wallet.
        </div>
      </div>
    </div>
  );
}

// ─── Gated default export ───────────────────────────────────────────
export default function Predict(props) {
  const solWallet = useWallet();
  const nexus = useNexusWallet();
  const address =
    (solWallet?.publicKey && solWallet.publicKey.toBase58 && solWallet.publicKey.toBase58()) ||
    nexus?.walletAddress ||
    nexus?.privyEmbeddedSol ||
    null;
  const isVip = !!address && VIP_WALLETS.has(address);
  return isVip ? <PredictInner {...props} bypassGeo /> : <ComingSoon />;
}
