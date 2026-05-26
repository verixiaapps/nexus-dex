import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

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
  amber:'#f5b53d', live:'#ff3d5d', gold:'#ffcd3c',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

// =====================================================================
// CONSTANTS
// =====================================================================
const SOL_MINT              = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA           = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA           = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SPL_LEGACY_PROGRAM    = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_TOKEN2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const DUST_THRESHOLD_USD = 0.10;
const PRICE_CACHE_TTL_MS = 60_000;
const META_CACHE_TTL_MS  = 24 * 60 * 60_000; // 24h — token metadata rarely changes
const POLL_INTERVAL_MS   = 30_000;

// xStocks (Token-2022) — same 18 mints as Stocks.jsx.
// Kept hardcoded because they're Token-2022 with curated branding.
const XSTOCKS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol:'TSLAx',  name:'Tesla',                color:'#e31837', textColor:'#fff', isStock:true, decimals:8 },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol:'AAPLx',  name:'Apple',                color:'#a2aaad', textColor:'#000', isStock:true, decimals:8 },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol:'NVDAx',  name:'NVIDIA',               color:'#76b900', textColor:'#000', isStock:true, decimals:8 },
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { symbol:'METAx',  name:'Meta Platforms',       color:'#0866ff', textColor:'#fff', isStock:true, decimals:8 },
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { symbol:'GOOGLx', name:'Alphabet',             color:'#4285f4', textColor:'#fff', isStock:true, decimals:8 },
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { symbol:'AMZNx',  name:'Amazon',               color:'#ff9900', textColor:'#000', isStock:true, decimals:8 },
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { symbol:'MSFTx',  name:'Microsoft',            color:'#00a4ef', textColor:'#fff', isStock:true, decimals:8 },
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { symbol:'NFLXx',  name:'Netflix',              color:'#e50914', textColor:'#fff', isStock:true, decimals:8 },
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { symbol:'PLTRx',  name:'Palantir',             color:'#404040', textColor:'#fff', isStock:true, decimals:8 },
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { symbol:'AVGOx',  name:'Broadcom',             color:'#cc092f', textColor:'#fff', isStock:true, decimals:8 },
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { symbol:'COINx',  name:'Coinbase',             color:'#0052ff', textColor:'#fff', isStock:true, decimals:8 },
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { symbol:'MSTRx',  name:'MicroStrategy',        color:'#fcb017', textColor:'#000', isStock:true, decimals:8 },
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { symbol:'CRCLx',  name:'Circle',               color:'#3399ff', textColor:'#fff', isStock:true, decimals:8 },
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { symbol:'HOODx',  name:'Robinhood',            color:'#cdff00', textColor:'#000', isStock:true, decimals:8 },
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol:'SPYx',   name:'S&P 500 ETF',          color:'#1c4f9c', textColor:'#fff', isStock:true, decimals:8 },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol:'QQQx',   name:'Nasdaq 100 ETF',       color:'#003b71', textColor:'#fff', isStock:true, decimals:8 },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol:'GLDx',   name:'Gold Trust',           color:'#d4af37', textColor:'#000', isStock:true, decimals:8 },
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { symbol:'TBLLx',  name:'1-3 Month T-Bill ETF', color:'#2a4d6e', textColor:'#fff', isStock:true, decimals:8 },
};

// Hardcoded mints we always know about (stables + native SOL).
// Everything else comes from Jupiter token registry at runtime.
const CORE_TOKENS = {
  [SOL_MINT]:    { symbol:'SOL',  name:'Solana',     color:'#9945ff', textColor:'#fff' },
  [USDC_SOLANA]: { symbol:'USDC', name:'USD Coin',   color:'#2775ca', textColor:'#fff', isStable:true },
  [USDT_SOLANA]: { symbol:'USDT', name:'Tether USD', color:'#26a17b', textColor:'#fff', isStable:true },
};

// =====================================================================
// UTILS
// =====================================================================
function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  if (n > 0)      return '$' + n.toFixed(6);
  return '$0.00';
}
function fmtTokenAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  if (n > 0)     return n.toFixed(6);
  return '0';
}
function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

// Derive a consistent fallback color from a mint string (HSL gradient).
function colorFromMint(mint) {
  const seed = mint || '?';
  const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// =====================================================================
// TOKEN METADATA (Jupiter token registry)
// =====================================================================
const _metaCache = new Map(); // mint -> { meta, ts }

function getCoreMeta(mint) {
  if (XSTOCKS[mint])     return XSTOCKS[mint];
  if (CORE_TOKENS[mint]) return CORE_TOKENS[mint];
  return null;
}

function buildFallbackMeta(mint) {
  return {
    symbol:    (mint || '').slice(0, 4) + '...',
    name:      'SPL Token',
    color:     colorFromMint(mint),
    textColor: '#fff',
    icon:      null,
  };
}

// Fetch metadata for one or more mints from Jupiter's search endpoint.
// Accepts a comma-separated list of mints (max 100). Returns map of mint -> meta.
async function fetchJupiterMeta(mints) {
  if (!mints || mints.length === 0) return {};
  const out = {};
  // Filter mints we already have cached or hardcoded.
  const need = [];
  for (const m of mints) {
    if (getCoreMeta(m)) { out[m] = getCoreMeta(m); continue; }
    const cached = _metaCache.get(m);
    if (cached && Date.now() - cached.ts < META_CACHE_TTL_MS) {
      out[m] = cached.meta;
      continue;
    }
    need.push(m);
  }
  if (need.length === 0) return out;

  try {
    // Jupiter search accepts comma-separated mints, up to 100.
    const chunks = [];
    for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
    for (const chunk of chunks) {
      const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(chunk.join(','))}`);
      if (!r.ok) continue;
      const data = await r.json();
      const list = Array.isArray(data) ? data : (data?.tokens || []);
      list.forEach(t => {
        const mint = t.id || t.address || t.mint;
        if (!mint) return;
        const meta = {
          symbol:    t.symbol || (mint.slice(0, 4) + '...'),
          name:      t.name   || 'SPL Token',
          icon:      t.icon || t.logoURI || null,
          decimals:  Number.isFinite(t.decimals) ? t.decimals : 6,
          color:     colorFromMint(mint),
          textColor: '#fff',
        };
        _metaCache.set(mint, { meta, ts: Date.now() });
        out[mint] = meta;
      });
    }
  } catch (e) {
    console.warn('[portfolio] meta fetch failed', e?.message || e);
  }
  // Anything still missing — fall back
  for (const m of need) if (!out[m]) out[m] = buildFallbackMeta(m);
  return out;
}

// =====================================================================
// PRICE FETCHING (Jupiter price v3 only)
// =====================================================================
const _priceCache = new Map(); // mint -> { price, ts }

function clearPriceCache() { _priceCache.clear(); }

async function fetchJupiterPrices(mints, force = false) {
  if (!mints || mints.length === 0) return {};
  const out = {};
  const need = [];
  for (const m of mints) {
    const core = getCoreMeta(m);
    if (core?.isStable) { out[m] = 1; continue; }
    if (!force) {
      const cached = _priceCache.get(m);
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        out[m] = cached.price;
        continue;
      }
    }
    need.push(m);
  }
  if (need.length === 0) return out;

  try {
    // Jupiter price v3 supports up to 100 ids per call.
    const chunks = [];
    for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
    for (const chunk of chunks) {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${chunk.join(',')}`);
      if (!r.ok) continue;
      const j = await r.json();
      Object.entries(j || {}).forEach(([mint, info]) => {
        const p = Number(info?.usdPrice);
        if (Number.isFinite(p) && p > 0) {
          _priceCache.set(mint, { price: p, ts: Date.now() });
          out[mint] = p;
        }
      });
    }
  } catch (e) {
    console.warn('[portfolio] price fetch failed', e?.message || e);
  }
  // Anything we couldn't price gets 0
  for (const m of need) if (out[m] == null) out[m] = 0;
  return out;
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function TokenBadge({ meta, mint, size = 36 }) {
  const [errored, setErrored] = useState(false);
  if (meta?.icon && !errored) {
    return (
      <img
        src={meta.icon}
        alt={meta.symbol || ''}
        onError={() => setErrored(true)}
        style={{
          width: size, height: size, borderRadius: '50%',
          flexShrink: 0, objectFit: 'cover',
          background: 'rgba(255,255,255,.04)',
        }}
      />
    );
  }
  const letter = ((meta?.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const color  = meta?.color || colorFromMint(mint);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${color}, ${color}dd)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: meta?.textColor || '#fff', fontWeight: 900, fontSize: Math.round(size * 0.38),
      flexShrink: 0, letterSpacing: '-.02em',
      boxShadow: `0 4px 12px ${color}40`,
      ...T.display,
    }}>{letter}</div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '36px 1fr 80px', gap: 12, alignItems: 'center', borderBottom: `1px solid ${C.hairline}` }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.04)' }}/>
      <div>
        <div style={{ height: 12, width: 64, borderRadius: 4, background: 'rgba(255,255,255,.05)', marginBottom: 6 }}/>
        <div style={{ height: 10, width: 96, borderRadius: 4, background: 'rgba(255,255,255,.035)' }}/>
      </div>
      <div style={{ height: 12, width: 60, borderRadius: 4, background: 'rgba(255,255,255,.05)', justifySelf: 'end' }}/>
    </div>
  );
}

function TokenRow({ token }) {
  const meta    = token.meta || buildFallbackMeta(token.mint);
  const val     = token.value || 0;
  const isStock = !!meta.isStock;
  return (
    <div style={{
      padding: '14px 18px', display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 12, alignItems: 'center',
      borderBottom: `1px solid ${C.hairline}`,
    }}>
      <TokenBadge meta={meta} mint={token.mint} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 14, letterSpacing: '-.01em', ...T.display }}>{meta.symbol}</span>
          {isStock && (
            <span style={{ color: C.hl, fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: C.hlDim, border: `1px solid ${C.borderHi}`, letterSpacing: '.06em', ...T.mono }}>STOCK</span>
          )}
          <span style={{ color: C.muted, fontSize: 10, fontWeight: 600, ...T.mono }}>
            {token.price > 0 ? fmt(token.price) : '—'}
          </span>
        </div>
        <div style={{ color: C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220, ...T.body }}>
          {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {meta.name}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: val > 0 ? C.inkStr : C.muted, fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {val > 0 ? fmt(val) : '—'}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// MAIN
// =====================================================================
export default function Portfolio({ onConnectWallet }) {
  const { publicKey: extPk, connected: solCon } = useWallet();
  const { connection } = useConnection();

  const pubkey = useMemo(() => extPk || null, [extPk]);
  const hasSol = !!solCon;

  const [solBalance, setSolBalance]     = useState(0);
  const [solPriceUsd, setSolPriceUsd]   = useState(0);
  const [tokens, setTokens]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState('');
  const [copied, setCopied]             = useState(false);

  const inFlightRef = useRef(false);

  const fetchPortfolio = useCallback(async (force = false) => {
    if (!pubkey || !connection) { setLoading(false); return; }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (force) clearPriceCache();
    setRefreshing(true);
    setError('');

    try {
      // 1) Native SOL balance
      const lamports = await connection.getBalance(pubkey);
      const sol = lamports / 1e9;
      setSolBalance(sol);

      // 2) All SPL token accounts (legacy + Token-2022)
      const results = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_LEGACY_PROGRAM }),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN2022_PROGRAM }),
      ]);
      let allAccounts = [];
      results.forEach(r => { if (r.status === 'fulfilled' && r.value?.value) allAccounts = allAccounts.concat(r.value.value); });

      // Sum by mint (account for multiple ATAs for the same mint)
      const byMint = {};
      allAccounts.forEach(acc => {
        try {
          const info = acc.account.data.parsed.info;
          const ta   = info.tokenAmount || {};
          const ui   = Number(ta.uiAmountString || ta.uiAmount || 0);
          const mint = info.mint;
          if (!mint || !Number.isFinite(ui) || ui <= 0.000001) return;
          if (!byMint[mint]) byMint[mint] = { mint, uiAmount: 0, decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6 };
          byMint[mint].uiAmount += ui;
        } catch {}
      });

      // 3) Fetch metadata + prices in parallel for everything (incl. SOL)
      const allMints = [SOL_MINT, ...Object.keys(byMint).filter(m => m !== SOL_MINT)];
      const [metaMap, priceMap] = await Promise.all([
        fetchJupiterMeta(allMints),
        fetchJupiterPrices(allMints, force),
      ]);

      const solPrice = priceMap[SOL_MINT] || 0;
      setSolPriceUsd(solPrice);

      // 4) Build holdings (excluding SOL — SOL rendered separately at top)
      const enriched = Object.values(byMint)
        .filter(h => h.mint !== SOL_MINT)
        .map(h => {
          const meta  = metaMap[h.mint] || buildFallbackMeta(h.mint);
          const price = priceMap[h.mint] || 0;
          const value = h.uiAmount * price;
          return { ...h, meta, price, value };
        });

      // Filter dust; always show stables and xStocks even at low value
      const filtered = enriched.filter(h => {
        if (h.meta.isStable || h.meta.isStock) return true;
        return h.value >= DUST_THRESHOLD_USD;
      });

      // Sort: stables → stocks → by value desc
      filtered.sort((a, b) => {
        const rank = m => m.isStable ? 0 : m.isStock ? 1 : 2;
        const ra = rank(a.meta), rb = rank(b.meta);
        if (ra !== rb) return ra - rb;
        return b.value - a.value;
      });

      setTokens(filtered);
    } catch (e) {
      console.warn('[portfolio]', e);
      setError('Failed to load portfolio');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [pubkey, connection]);

  useEffect(() => {
    if (!pubkey || !connection) { setLoading(false); return undefined; }
    fetchPortfolio(false);
    const i = setInterval(() => fetchPortfolio(false), POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, [pubkey, connection, fetchPortfolio]);

  const handleRefresh = useCallback(() => fetchPortfolio(true), [fetchPortfolio]);
  const displayAddr   = pubkey ? pubkey.toString() : null;
  const handleCopyAddr = useCallback(async () => {
    if (!displayAddr) return;
    const ok = await copyText(displayAddr);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  }, [displayAddr]);

  const solValue     = solBalance * solPriceUsd;
  const tokensTotal  = tokens.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue   = solValue + tokensTotal;
  const tokenCount   = tokens.length + (solBalance > 0 ? 1 : 0);
  const stocksCount  = tokens.filter(t => t.meta.isStock).length;

  // ===================================================================
  // DISCONNECTED STATE
  // ===================================================================
  if (!hasSol) {
    return (
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');`}</style>
        <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
          <div style={{ textAlign: 'center', padding: '60px 24px 40px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, marginTop: 24 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: C.glow }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#04070f" strokeWidth="2.5">
                <rect x="2" y="6" width="20" height="14" rx="2"/>
                <path d="M2 12h20"/>
              </svg>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.04em', ...T.hero }}>
              Connect your{' '}
              <span style={{ fontStyle: 'italic', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>wallet</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 28px', lineHeight: 1.5, ...T.body }}>
              See your SOL, tokens, and stocks in one place.
            </p>
            <button onClick={() => onConnectWallet?.()} style={{
              background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, border: 'none', borderRadius: 14,
              padding: '14px 32px', color: '#04070f', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', boxShadow: C.glow, letterSpacing: '-.01em', ...T.display,
            }}>Connect Wallet</button>
          </div>
        </div>
      </>
    );
  }

  // ===================================================================
  // CONNECTED STATE
  // ===================================================================
  const solMeta = CORE_TOKENS[SOL_MINT];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nx-spin { to{transform:rotate(360deg)} }`}</style>

      <div style={{ maxWidth: 600, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 10, padding: '24px 22px 22px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -50, top: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(168,127,255,.16),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', left: -80, bottom: -80, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.10),transparent 65%)', pointerEvents: 'none' }}/>

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.up, boxShadow: `0 0 8px ${C.up}` }}/>
                <span style={{ color: C.up, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>SOLANA · LIVE</span>
              </div>
              <button onClick={handleRefresh} disabled={refreshing} style={{
                background: 'rgba(151,252,228,.06)', border: `1px solid ${C.borderHi}`,
                borderRadius: 999, width: 32, height: 32, padding: 0,
                cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: C.hl,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={refreshing ? { animation: 'nx-spin 1s linear infinite' } : null}>
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
            </div>

            <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.12em', marginBottom: 4, ...T.mono }}>PORTFOLIO VALUE</div>
            <div style={{ fontSize: 44, fontWeight: 500, color: C.inkStr, letterSpacing: '-.04em', lineHeight: 1.0, marginBottom: 14, fontVariantNumeric: 'tabular-nums', ...T.hero }}>
              {fmt(totalValue)}
            </div>

            <button onClick={handleCopyAddr} style={{
              background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '9px 13px', cursor: 'pointer', width: '100%',
              display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHi}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: `linear-gradient(135deg,${C.sol},#7c3aed)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 8px ${C.sol}40` }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', ...T.display }}>S</span>
              </div>
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>WALLET ADDRESS</div>
                <div style={{ fontSize: 12, color: C.ink, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...T.mono }}>{shortAddr(displayAddr)}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: copied ? C.up : C.hl, padding: '4px 9px', borderRadius: 8, background: copied ? 'rgba(61,213,152,.10)' : C.hlDim, border: `1px solid ${copied ? 'rgba(61,213,152,.30)' : C.borderHi}`, letterSpacing: '.06em', flexShrink: 0, ...T.mono }}>
                {copied ? 'COPIED' : 'COPY'}
              </span>
            </button>
          </div>
        </div>

        {/* QUICK STATS STRIP */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: stocksCount > 0 ? 'repeat(3,1fr)' : 'repeat(2,1fr)',
          gap: 8, marginTop: 12, marginBottom: 18,
        }}>
          <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' }}>
            <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>SOL</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.sol, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: 'tabular-nums', ...T.display }}>{solBalance.toFixed(3)}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 2, fontWeight: 600, ...T.mono }}>{solValue > 0 ? fmt(solValue) : '—'}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' }}>
            <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>HOLDINGS</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.hl, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: 'tabular-nums', ...T.display }}>{tokenCount}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 2, fontWeight: 600, ...T.mono }}>{tokenCount === 1 ? 'asset' : 'assets'}</div>
          </div>
          {stocksCount > 0 && (
            <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' }}>
              <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>STOCKS</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.amber, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: 'tabular-nums', ...T.display }}>{stocksCount}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 2, fontWeight: 600, ...T.mono }}>{stocksCount === 1 ? 'xStock' : 'xStocks'}</div>
            </div>
          )}
        </div>

        {/* ERROR */}
        {error && (
          <div style={{ background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, padding: 12, marginBottom: 14, fontSize: 12, color: C.down, ...T.body }}>
            {error}
          </div>
        )}

        {/* HOLDINGS HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.12em', ...T.mono }}>HOLDINGS</div>
          <div style={{ fontSize: 9, color: C.muted2, fontWeight: 600, ...T.mono }}>JUPITER · AUTO 30s</div>
        </div>

        {/* HOLDINGS LIST — SOL + SPL tokens + xStocks (all in one) */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', backdropFilter: 'blur(12px)' }}>
          {/* Native SOL row — always shown */}
          <TokenRow token={{
            mint: SOL_MINT,
            meta: solMeta,
            price: solPriceUsd,
            value: solValue,
            uiAmount: solBalance,
          }}/>

          {loading && !tokens.length ? (
            <>
              <SkeletonRow/>
              <SkeletonRow/>
              <SkeletonRow/>
            </>
          ) : !tokens.length ? (
            <div style={{ padding: '28px 18px', textAlign: 'center' }}>
              <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 6, fontWeight: 600, ...T.body }}>No tokens yet.</div>
              <div style={{ color: C.muted2, fontSize: 11, ...T.body }}>Buy something on Wonderland or Markets to get started.</div>
            </div>
          ) : tokens.map(token => (
            <TokenRow key={token.mint} token={token}/>
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '14px 16px', marginTop: 18, borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>JUPITER · SOLANA</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
      </div>
    </>
  );
}
