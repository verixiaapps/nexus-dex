import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import './Portfolio.css';

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

// Brand tokens (Token-2022) — same 18 mints as Stocks.jsx.
// Kept hardcoded because they're Token-2022 with curated branding.
// `isBrand: true` marks them for UI categorization (was previously `isStock`).
const BRAND_TOKENS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol:'TSLAx',  name:'Tesla',                color:'#e31837', textColor:'#fff', isBrand:true, decimals:8 },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol:'AAPLx',  name:'Apple',                color:'#a2aaad', textColor:'#000', isBrand:true, decimals:8 },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol:'NVDAx',  name:'NVIDIA',               color:'#76b900', textColor:'#000', isBrand:true, decimals:8 },
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { symbol:'METAx',  name:'Meta Platforms',       color:'#0866ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { symbol:'GOOGLx', name:'Alphabet',             color:'#4285f4', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { symbol:'AMZNx',  name:'Amazon',               color:'#ff9900', textColor:'#000', isBrand:true, decimals:8 },
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { symbol:'MSFTx',  name:'Microsoft',            color:'#00a4ef', textColor:'#fff', isBrand:true, decimals:8 },
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { symbol:'NFLXx',  name:'Netflix',              color:'#e50914', textColor:'#fff', isBrand:true, decimals:8 },
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { symbol:'PLTRx',  name:'Palantir',             color:'#404040', textColor:'#fff', isBrand:true, decimals:8 },
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { symbol:'AVGOx',  name:'Broadcom',             color:'#cc092f', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { symbol:'COINx',  name:'Coinbase',             color:'#0052ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { symbol:'MSTRx',  name:'MicroStrategy',        color:'#fcb017', textColor:'#000', isBrand:true, decimals:8 },
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { symbol:'CRCLx',  name:'Circle',               color:'#3399ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { symbol:'HOODx',  name:'Robinhood',            color:'#cdff00', textColor:'#000', isBrand:true, decimals:8 },
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol:'SPYx',   name:'S&P 500 Index',        color:'#1c4f9c', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol:'QQQx',   name:'Nasdaq 100 Index',     color:'#003b71', textColor:'#fff', isBrand:true, decimals:8 },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol:'GLDx',   name:'Gold',                 color:'#d4af37', textColor:'#000', isBrand:true, decimals:8 },
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { symbol:'TBLLx',  name:'Short-Term Treasury',  color:'#2a4d6e', textColor:'#fff', isBrand:true, decimals:8 },
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
  if (BRAND_TOKENS[mint])  return BRAND_TOKENS[mint];
  if (CORE_TOKENS[mint])   return CORE_TOKENS[mint];
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
        className="pf-badge-img"
        style={{ width: size, height: size }}
      />
    );
  }
  const letter = ((meta?.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const color  = meta?.color || colorFromMint(mint);
  return (
    <div
      className="pf-badge"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        color: meta?.textColor || '#fff',
        fontSize: Math.round(size * 0.38),
        boxShadow: `0 4px 12px ${color}40`,
      }}
    >{letter}</div>
  );
}

function SkeletonRow() {
  return (
    <div className="pf-row pf-skel-row">
      <div className="pf-skel-badge"/>
      <div>
        <div className="pf-skel-bar pf-skel-bar-1"/>
        <div className="pf-skel-bar pf-skel-bar-2"/>
      </div>
      <div className="pf-skel-bar pf-skel-bar-3"/>
    </div>
  );
}

function TokenRow({ token }) {
  const meta    = token.meta || buildFallbackMeta(token.mint);
  const val     = token.value || 0;
  const isBrand = !!meta.isBrand;
  return (
    <div className="pf-row">
      <TokenBadge meta={meta} mint={token.mint} size={36}/>
      <div className="pf-row-mid">
        <div className="pf-row-head">
          <span className="pf-row-sym">{meta.symbol}</span>
          {isBrand && (
            <span className="pf-row-tag">BRAND</span>
          )}
          <span className="pf-row-price">
            {token.price > 0 ? fmt(token.price) : '—'}
          </span>
        </div>
        <div className="pf-row-sub">
          {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {meta.name}
        </div>
      </div>
      <div className="pf-row-right">
        <div className={'pf-row-value' + (val > 0 ? '' : ' pf-muted')}>
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

      // Filter dust; always show stables and brand tokens even at low value
      const filtered = enriched.filter(h => {
        if (h.meta.isStable || h.meta.isBrand) return true;
        return h.value >= DUST_THRESHOLD_USD;
      });

      // Sort: stables → brands → by value desc
      filtered.sort((a, b) => {
        const rank = m => m.isStable ? 0 : m.isBrand ? 1 : 2;
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
  const brandsCount  = tokens.filter(t => t.meta.isBrand).length;

  // ===================================================================
  // DISCONNECTED STATE
  // ===================================================================
  if (!hasSol) {
    return (
      <div className="pf-page pf-page-disconnected">
        <div className="pf-disconnect-card">
          <div className="pf-disconnect-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="6" width="20" height="14" rx="2"/>
              <path d="M2 12h20"/>
            </svg>
          </div>
          <h1 className="pf-disconnect-title">
            Connect your{' '}
            <span className="pf-disconnect-italic">wallet</span>
          </h1>
          <p className="pf-disconnect-sub">
            See your SOL, tokens, and brands in one place.
          </p>
          <button onClick={() => onConnectWallet?.()} className="pf-disconnect-btn">
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  // ===================================================================
  // CONNECTED STATE
  // ===================================================================
  const solMeta = CORE_TOKENS[SOL_MINT];

  return (
    <div className="pf-page">
      {/* HERO */}
      <div className="pf-hero">
        <div className="pf-hero-glow-1"/>
        <div className="pf-hero-glow-2"/>

        <div className="pf-hero-inner">
          <div className="pf-hero-top">
            <div className="pf-status-pill">
              <span className="pf-status-dot"/>
              <span className="pf-status-text">SOLANA · LIVE</span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={'pf-refresh-btn' + (refreshing ? ' pf-spinning' : '')}
              aria-label="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>

          <div className="pf-portfolio-label">PORTFOLIO VALUE</div>
          <div className="pf-portfolio-value">{fmt(totalValue)}</div>

          <button onClick={handleCopyAddr} className="pf-wallet-card">
            <div className="pf-wallet-icon">
              <span>S</span>
            </div>
            <div className="pf-wallet-info">
              <div className="pf-wallet-label">WALLET ADDRESS</div>
              <div className="pf-wallet-addr">{shortAddr(displayAddr)}</div>
            </div>
            <span className={'pf-copy-pill' + (copied ? ' pf-copied' : '')}>
              {copied ? 'COPIED' : 'COPY'}
            </span>
          </button>
        </div>
      </div>

      {/* QUICK STATS STRIP */}
      <div className={'pf-stats' + (brandsCount > 0 ? ' pf-stats-3' : ' pf-stats-2')}>
        <div className="pf-stat">
          <div className="pf-stat-label">SOL</div>
          <div className="pf-stat-val pf-stat-sol">{solBalance.toFixed(3)}</div>
          <div className="pf-stat-sub">{solValue > 0 ? fmt(solValue) : '—'}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-stat-label">HOLDINGS</div>
          <div className="pf-stat-val pf-stat-mint">{tokenCount}</div>
          <div className="pf-stat-sub">{tokenCount === 1 ? 'asset' : 'assets'}</div>
        </div>
        {brandsCount > 0 && (
          <div className="pf-stat">
            <div className="pf-stat-label">BRANDS</div>
            <div className="pf-stat-val pf-stat-amber">{brandsCount}</div>
            <div className="pf-stat-sub">{brandsCount === 1 ? 'brand' : 'brands'}</div>
          </div>
        )}
      </div>

      {/* ERROR */}
      {error && (
        <div className="pf-error">{error}</div>
      )}

      {/* HOLDINGS HEADER */}
      <div className="pf-holdings-head">
        <div className="pf-holdings-label">HOLDINGS</div>
        <div className="pf-holdings-meta">JUPITER · AUTO 30s</div>
      </div>

      {/* HOLDINGS LIST — SOL + SPL tokens + brand tokens (all in one) */}
      <div className="pf-list">
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
          <div className="pf-empty">
            <div className="pf-empty-title">No tokens yet.</div>
            <div className="pf-empty-sub">Buy something on Wonderland or Markets to get started.</div>
          </div>
        ) : tokens.map(token => (
          <TokenRow key={token.mint} token={token}/>
        ))}
      </div>

      {/* FOOTER */}
      <div className="pf-powered">
        <span className="pf-powered-label">POWERED BY</span>
        <span className="pf-powered-name">JUPITER · SOLANA</span>
        <span className="pf-powered-sep">|</span>
        <span className="pf-powered-label">NON-CUSTODIAL</span>
      </div>
    </div>
  );
}
