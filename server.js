require('dotenv').config();
   
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');

const app      = express();
const PORT     = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ========================================================================
 * Security headers / CSP
 * ===================================================================== */
const CSP_MODE       = (process.env.CSP_MODE || 'report-only').toLowerCase();
const CSP_REPORT_URI = (process.env.CSP_REPORT_URI || '').trim();
const _csv = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const EXTRA_CONNECT_SRC = _csv(process.env.EXTRA_CSP_CONNECT_SRC);
const EXTRA_FRAME_SRC   = _csv(process.env.EXTRA_CSP_FRAME_SRC);
const EXTRA_SCRIPT_SRC  = _csv(process.env.EXTRA_CSP_SCRIPT_SRC);

const CSP_DIRECTIVES = [
  ['default-src',     ["'self'"]],
  ['script-src',      ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com', ...EXTRA_SCRIPT_SRC]],
  ['style-src',       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
  ['img-src',         ["'self'", 'data:', 'blob:', 'https:']],
  ['font-src',        ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://api.fontshare.com']],
  ['object-src',      ["'none'"]],
  ['base-uri',        ["'self'"]],
  ['form-action',     ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['frame-src',       ["'self'", 'https://verify.walletconnect.com', 'https://verify.walletconnect.org', 'https://challenges.cloudflare.com', ...EXTRA_FRAME_SRC]],
  ['child-src',       ["'self'", 'https://verify.walletconnect.com', 'https://verify.walletconnect.org']],
  ['connect-src',     [
    "'self'",
    'https://api.jup.ag', 'https://lite-api.jup.ag', 'https://quote-api.jup.ag', 'https://token.jup.ag',
    'https://explorer-api.walletconnect.com',
    'https://*.walletconnect.com', 'https://*.walletconnect.org',
    'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org',
    'wss://*.walletconnect.com', 'wss://*.walletconnect.org',
    'wss://www.walletlink.org',
    'https://public.chainalysis.com',
    'wss://pumpportal.fun',
    'https://pumpportal.fun',
    'https://api.dexscreener.com',
    ...EXTRA_CONNECT_SRC,
  ]],
  ['worker-src',      ["'self'", 'blob:']],
  ['manifest-src',    ["'self'"]],
];

const _cspParts = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v.join(' ')}`);
if (CSP_REPORT_URI) _cspParts.push(`report-uri ${CSP_REPORT_URI}`);
const CSP_VALUE       = _cspParts.join('; ');
const CSP_HEADER_NAME = CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
const HSTS_ENABLED    = NODE_ENV === 'production' && process.env.HSTS_DISABLE !== '1';

app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') return next();
  res.setHeader(CSP_HEADER_NAME, CSP_VALUE);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()');
  if (HSTS_ENABLED) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* ========================================================================
 * Config
 * ===================================================================== */
const JUPITER_ENABLED       = process.env.JUPITER_ENABLED !== '0';
const JUPITER_ACCOUNT       = process.env.JUPITER_ACCOUNT || 'NEXUS_DEX';
const JUPITER_API_KEY       = process.env.JUPITER_API_KEY || '';
const JUPITER_API_KEY_SEO   = process.env.JUPITER_API_KEY_SEO || '';
const JUPITER_SWAP_V2_BASE  = 'https://api.jup.ag/swap/v2';
const JUPITER_LEGACY_BASE   = (process.env.JUPITER_QUOTE_BASE || 'https://api.jup.ag/swap/v1').replace(/\/+$/, '');
const JUPITER_TOKENS_BASE   = 'https://lite-api.jup.ag/tokens/v2';
const JUPITER_PRICE_BASE    = 'https://lite-api.jup.ag/price/v3';

const SOLANA_NETWORK   = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
const ALCHEMY_RPC_URL  = (process.env.ALCHEMY_RPC_URL || '').trim();
const ANKR_RPC_URL     = (process.env.ANKR_RPC_URL    || '').trim();
const DEVNET_RPC_URL   = (process.env.DEVNET_RPC_URL  || '').trim();

const PRIMARY_RPC_URL  = SOLANA_NETWORK === 'devnet' ? DEVNET_RPC_URL : ALCHEMY_RPC_URL;

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');
const allowedOrigins = (process.env.ALLOWED_ORIGINS
    || 'https://swap.verixiaapps.com,https://verixiaapps.com,https://www.verixiaapps.com,http://localhost:3000')
  .split(',').map(s => stripSlash(s.trim())).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(stripSlash(origin))) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
}));

app.use(express.json({ limit: '256kb' }));

/* ========================================================================
 * Bot blocker
 * ===================================================================== */
const BOT_UA_RE = /bot|crawl|spider|scrape|headless|curl|wget|python-requests|axios|httpclient|java\/|ruby|go-http|okhttp|libwww|phantomjs|puppeteer|playwright/i;
app.use('/api/', (req, res, next) => {
  if (req.path === '/health') return next();
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || BOT_UA_RE.test(ua)) return res.status(403).json({ error: 'Forbidden' });
  next();
});


/* ========================================================================
 * Shared helpers
 * ===================================================================== */
async function fetchWithTimeout(url, options, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try   { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function safeJson(response) {
  const text = await response.text();
  try   { return { parsed: JSON.parse(text), raw: null }; }
  catch { return { parsed: null, raw: text }; }
}

function scrubSecrets(s) {
  if (s == null) return '';
  return String(s)
    .replace(/api-key=[^&\s"']+/gi,                       'api-key=***')
    .replace(/(solana-(?:mainnet|devnet)\.g\.alchemy\.com\/v2\/)[^\s"'?]+/gi, '$1***')
    .replace(/(rpc\.ankr\.com\/(?:premium-http\/)?solana(?:_devnet)?\/)[^\s"'?]+/gi, '$1***')
    .replace(/x-api-key["':\s]+[^&\s"',}]+/gi,            'x-api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,                'Bearer ***');
}

function logError(tag, err) {
  const msg = scrubSecrets(err?.message ?? err);
  if (NODE_ENV === 'production') console.warn(`[${tag}]`, msg);
  else console.error(`[${tag}]`, msg, err?.stack ? '\n' + scrubSecrets(err.stack) : '');
}

const _warnSampleAt = new Map();
function warnSampled(key, intervalMs, ...args) {
  const now = Date.now();
  const last = _warnSampleAt.get(key) || 0;
  if (now - last < intervalMs) return;
  _warnSampleAt.set(key, now);
  console.warn(...args);
}

function queryStringOf(req) {
  const u = req.originalUrl || req.url || '';
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(i) : '';
}

function buildForwardedQuery(req) { return queryStringOf(req) || ''; }

function respondJsonOrError(res, response, result) {
  if (result.parsed !== null) return res.status(response.status).json(result.parsed);
  return res.status(response.status).json({ error: 'Upstream returned non-JSON', body: result.raw?.slice(0, 500) });
}

const getCache = new Map();
function getCachedJson(url) {
  const hit = getCache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { getCache.delete(url); return null; }
  return hit;
}
function setCachedJson(url, status, payload, ttlMs) {
  getCache.set(url, { status, payload, expiresAt: Date.now() + ttlMs });
  if (getCache.size > 250) { const k = getCache.keys().next().value; if (k) getCache.delete(k); }
}

// Bound any mint/uri-keyed Map so continuous token ingestion can't grow it
// without limit (Map preserves insertion order, so the first key is oldest).
// Without this, _lrPfCache / _lrMetaCache / _apeCache leaked one entry per new
// token forever → container OOM → SIGTERM restart loop.
function _capMap(m, max) {
  while (m.size > max) {
    const k = m.keys().next().value;
    if (k === undefined) break;
    m.delete(k);
  }
}
const _LR_PF_CACHE_MAX   = 2000;
const _LR_META_CACHE_MAX = 2000;
const _APE_CACHE_MAX     = 2000;

/* ========================================================================
 * Launch Radar — LIVE feed via PumpPortal WebSocket
 * ===================================================================== */
const _LR_DEX_BASE     = 'https://api.dexscreener.com';
const _LR_PUMP_WS_URL  = 'wss://pumpportal.fun/api/data';
const _LR_PUMP_DEX_IDS = new Set(['pumpfun', 'pumpswap']);
const _LR_BASE58_RE    = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const _LR_BUFFER_MAX   = 200;
const _LR_FEED_LIMIT   = 30;
const _LR_CACHE_MS     = 3_000;

const _LR_WebSocket = require('ws');

const _lrBuf = new Map();
let _lrWs = null;
let _lrWsReconnect = null;
let _lrWsConnectedAt = 0;

const _lrTradeStats   = new Map();
const _LR_TRADERS_MAX = 5_000;

function _lrAddMint(msg) {
  const mint = msg?.mint;
  if (!mint || typeof mint !== 'string') return;
  if (!_LR_BASE58_RE.test(mint)) return;
  if (msg.txType && msg.txType !== 'create') return;
  if (_lrBuf.has(mint)) return;
  _lrBuf.set(mint, {
    mint,
    sym:  String(msg.symbol || '???').slice(0, 24),
    name: String(msg.name || msg.symbol || 'Unknown').slice(0, 96),
    uri:  msg.uri || null,
    pool: msg.pool || 'pump',
    createdAt: Date.now(),
  });
  while (_lrBuf.size > _LR_BUFFER_MAX) {
    const oldestKey = _lrBuf.keys().next().value;
    if (oldestKey == null) break;
    _lrBuf.delete(oldestKey);
    _lrTradeStats.delete(oldestKey);
  }
  const initVSol = Number(msg.vSolInBondingCurve);
  const creator  = msg.traderPublicKey;
  const hasVSol  = Number.isFinite(initVSol) && initVSol > 0;
  const hasDev   = typeof creator === 'string' && _LR_BASE58_RE.test(creator);
  if (hasVSol || hasDev) {
    const s = { traders: new Set(), vSol: 0, lastUpdate: Date.now() };
    if (hasVSol) s.vSol = initVSol;
    if (hasDev)  s.traders.add(creator);
    _lrTradeStats.set(mint, s);
  }
  _lrSubTrades([mint]);
}

function _lrSubTrades(keys) {
  if (!_lrWs || _lrWs.readyState !== _LR_WebSocket.OPEN) return;
  if (!Array.isArray(keys) || keys.length === 0) return;
  try { _lrWs.send(JSON.stringify({ method: 'subscribeTokenTrade', keys })); }
  catch (e) { console.warn('[lr-ws] subscribeTokenTrade send failed:', e?.message); }
}

function _lrTrackTrade(msg) {
  const mint = msg?.mint;
  if (!mint || typeof mint !== 'string' || !_LR_BASE58_RE.test(mint)) return;
  if (!_lrBuf.has(mint)) return;

  let s = _lrTradeStats.get(mint);
  if (!s) {
    s = { traders: new Set(), vSol: 0, lastUpdate: 0 };
    _lrTradeStats.set(mint, s);
  }

  const trader = msg.traderPublicKey;
  if (typeof trader === 'string' && _LR_BASE58_RE.test(trader)
      && s.traders.size < _LR_TRADERS_MAX) {
    s.traders.add(trader);
  }

  const vSol = Number(msg.vSolInBondingCurve);
  if (Number.isFinite(vSol) && vSol > 0) s.vSol = vSol;

  s.lastUpdate = Date.now();
}

function _lrConnectWs() {
  if (_lrWs) { try { _lrWs.close(); } catch {} _lrWs = null; }
  let ws;
  try { ws = new _LR_WebSocket(_LR_PUMP_WS_URL); }
  catch (e) {
    console.warn('[lr-ws] create failed:', e?.message);
    clearTimeout(_lrWsReconnect);
    _lrWsReconnect = setTimeout(_lrConnectWs, 10_000);
    return;
  }
  _lrWs = ws;

  ws.on('open', () => {
    _lrWsConnectedAt = Date.now();
    console.log('[lr-ws] connected → subscribeNewToken');
    try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); }
    catch (e) { console.warn('[lr-ws] subscribe send failed:', e?.message); }
    const existing = [..._lrBuf.keys()];
    if (existing.length > 0) {
      try { ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: existing })); }
      catch (e) { console.warn('[lr-ws] re-sub trades failed:', e?.message); }
    }
  });

  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      const tx = m?.txType;
      if (!tx || tx === 'create')        _lrAddMint(m);
      else if (tx === 'buy' || tx === 'sell') _lrTrackTrade(m);
    } catch {}
  });

  ws.on('close', () => {
    _lrWsConnectedAt = 0;
    console.log('[lr-ws] disconnected → retry in 5s');
    clearTimeout(_lrWsReconnect);
    _lrWsReconnect = setTimeout(_lrConnectWs, 5_000);
  });

  ws.on('error', (err) => {
    console.warn('[lr-ws] error:', err?.message);
  });
}

_lrConnectWs();

function _lrShape(mint, pairs, wsMeta) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const ours = pairs.filter(p =>
    p.baseToken?.address === mint || p.quoteToken?.address === mint
  );
  if (ours.length === 0) return null;
  const pumpPair = ours.find(p => _LR_PUMP_DEX_IDS.has(String(p.dexId || '').toLowerCase()));
  if (!pumpPair) return null;
  const best = ours.reduce(
    (a, b) => (Number(b.liquidity?.usd || 0) > Number(a.liquidity?.usd || 0) ? b : a),
    ours[0],
  );
  const base  = best.baseToken  || {};
  const quote = best.quoteToken || {};
  const me    = base.address === mint ? base : quote;
  return {
    mint,
    sym:            me.symbol || wsMeta?.sym || '???',
    name:           me.name   || wsMeta?.name || me.symbol || 'Unknown',
    icon:           best.info?.imageUrl || null,
    price:          Number(best.priceUsd || 0),
    priceChange24h: Number(best.priceChange?.h24 || 0),
    mcap:           Number(best.marketCap || best.fdv || 0),
    fdv:            Number(best.fdv || 0),
    volume24h:      Number(best.volume?.h24 || 0),
    liquidity:      Number(best.liquidity?.usd || 0),
    pairCreatedAt:  best.pairCreatedAt || wsMeta?.createdAt || null,
    dexId:          pumpPair.dexId,
    pumpPool:       pumpPair.dexId === 'pumpswap' ? 'pump-amm' : 'pump',
    decimals:       6,
  };
}

const _LR_PF_BASE     = 'https://frontend-api.pump.fun/coins';
const _LR_PF_CACHE_MS = 30_000;
const _lrPfCache  = new Map();
let   _lrPfLogged = false;

// pump.fun's Cloudflare periodically 530s / rate-limits our server IP. The
// original code cached only SUCCESSES, so during a 530 window every enrichment
// re-hit pump.fun (burning a 6s timeout each) and prolonged the block. These add
// (1) negative-caching of failures for a short window, and (2) a circuit breaker
// that briefly pauses ALL pump.fun calls after a burst of failures — so the IP
// can recover. Success behaviour is unchanged. Entries live in the same _capMap'd
// _lrPfCache, so this stays memory-bounded.
const _LR_PF_FAIL_TTL_MS = 45_000;   // skip re-hitting a failed mint for 45s
const _LR_PF_BREAKER_MS  = 60_000;   // after a burst, pause pump.fun for 60s
const _LR_PF_FAIL_BURST  = 8;        // failures within the window to trip breaker
const _LR_PF_FAIL_WINDOW = 20_000;   // rolling failure window
let   _lrPfBreakerUntil  = 0;
const _lrPfFailAt        = [];
function _lrPfNoteFail(mint) {
  const now = Date.now();
  if (mint) { _lrPfCache.set(mint, { failed: true, ts: now }); _capMap(_lrPfCache, _LR_PF_CACHE_MAX); }
  _lrPfFailAt.push(now);
  const cut = now - _LR_PF_FAIL_WINDOW;
  while (_lrPfFailAt.length && _lrPfFailAt[0] < cut) _lrPfFailAt.shift();
  if (_lrPfFailAt.length >= _LR_PF_FAIL_BURST) {
    _lrPfBreakerUntil = now + _LR_PF_BREAKER_MS;
    _lrPfFailAt.length = 0;
    if (!_lrPfLogged) { _lrPfLogged = true; }
    console.warn('[lr-pf] circuit breaker OPEN — pausing pump.fun calls for', _LR_PF_BREAKER_MS / 1000, 's');
  }
}

async function _lrFetchPumpInfo(mint, solPriceUsd) {
  const now = Date.now();
  // Circuit open → don't touch pump.fun at all; let callers use their fallbacks.
  if (now < _lrPfBreakerUntil) return null;
  const hit = _lrPfCache.get(mint);
  if (hit) {
    if (hit.failed) { if (now - hit.ts < _LR_PF_FAIL_TTL_MS) return null; }
    else if (now - hit.ts < _LR_PF_CACHE_MS) return hit;
  }
  try {
    const r = await fetchWithTimeout(
      _LR_PF_BASE + '/' + encodeURIComponent(mint),
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
      6_000,
    );
    if (!r.ok) {
      if (!_lrPfLogged) {
        _lrPfLogged = true;
        console.warn('[lr-pf] non-OK from pump.fun:', r.status, '(likely Cloudflare / rate limit)');
      }
      _lrPfNoteFail(mint);
      return null;
    }
    const d = await r.json();
    if (!d || typeof d !== 'object' || d.mint !== mint) {
      if (!_lrPfLogged) {
        _lrPfLogged = true;
        console.warn('[lr-pf] mint mismatch — expected', mint, 'got', d?.mint);
      }
      _lrPfNoteFail(mint);
      return null;
    }
    if (!_lrPfLogged) {
      _lrPfLogged = true;
      console.log('[lr-pf] sample fields:', Object.keys(d).join(','));
    }
    const holders = Number(d.holder_count ?? d.num_holders ?? d.holders ?? 0) || 0;
    const imageUrl = (typeof d.image_uri === 'string' && d.image_uri) ||
                     (typeof d.image     === 'string' && d.image)     || null;
    let liquidityUsd = 0;
    const vSol = Number(d.virtual_sol_reserves ?? d.virtualSolReserves ?? 0);
    if (vSol > 0 && solPriceUsd > 0) {
      liquidityUsd = (vSol / 1e9) * solPriceUsd * 2;
    }

    // ── Bonding-curve state ──────────────────────────────────────────────
    // Graduated/migrated is a hard signal: pump.fun sets `complete:true` and a
    // `raydium_pool` once the curve fills and the token moves to Raydium.
    // Progress is DERIVED from pump.fun's own real_token_reserves against the
    // curve's known initial allocation (793.1M tokens, 6 decimals). It's gated:
    // if the field is missing or out of the expected range (scale mismatch),
    // we emit NO number rather than a wrong one — accuracy over coverage.
    const graduated = d.complete === true ||
                      (typeof d.raydium_pool === 'string' && d.raydium_pool.length > 0);
    let bondingProgress = null;
    if (graduated) {
      bondingProgress = 100;
    } else {
      const CURVE_INIT = 793_100_000 * 1e6; // pump.fun initial real token reserves (raw, 6 dp)
      const rtr = Number(d.real_token_reserves ?? d.realTokenReserves);
      if (Number.isFinite(rtr) && rtr > 0 && rtr <= CURVE_INIT * 1.02) {
        bondingProgress = Math.max(0, Math.min(100, (1 - rtr / CURVE_INIT) * 100));
      }
      // rtr out of range → leave null (the client then resolves via fallback).
    }

    const out = { holders, liquidityUsd, imageUrl, graduated, bondingProgress, ts: Date.now() };
    _lrPfCache.set(mint, out);
    _capMap(_lrPfCache, _LR_PF_CACHE_MAX);
    return out;
  } catch (e) {
    if (!_lrPfLogged) {
      _lrPfLogged = true;
      console.warn('[lr-pf] fetch failed:', e?.message);
    }
    _lrPfNoteFail(mint);
    return null;
  }
}

const _LR_META_CACHE_MS = 5 * 60_000;
const _lrMetaCache = new Map();
let   _lrMetaLogged = false;

async function _lrFetchMetaImage(uri) {
  if (!uri || typeof uri !== 'string') return null;
  if (!/^https?:\/\//i.test(uri)) return null;
  const hit = _lrMetaCache.get(uri);
  if (hit && Date.now() - hit.ts < _LR_META_CACHE_MS) return hit.image;
  try {
    const r = await fetchWithTimeout(
      uri,
      { headers: { Accept: 'application/json' } },
      5_000,
    );
    if (!r.ok) {
      _lrMetaCache.set(uri, { image: null, ts: Date.now() });
      _capMap(_lrMetaCache, _LR_META_CACHE_MAX);
      return null;
    }
    const d = await r.json();
    const image = (typeof d?.image     === 'string' && d.image)     ||
                  (typeof d?.image_url === 'string' && d.image_url) ||
                  (typeof d?.imageUrl  === 'string' && d.imageUrl)  || null;
    _lrMetaCache.set(uri, { image, ts: Date.now() });
    _capMap(_lrMetaCache, _LR_META_CACHE_MAX);
    if (!_lrMetaLogged && image) {
      _lrMetaLogged = true;
      console.log('[lr-meta] image fallback live');
    }
    return image;
  } catch (e) {
    _lrMetaCache.set(uri, { image: null, ts: Date.now() });
    _capMap(_lrMetaCache, _LR_META_CACHE_MAX);
    if (!_lrMetaLogged) {
      _lrMetaLogged = true;
      console.warn('[lr-meta] fetch failed:', e?.message);
    }
    return null;
  }
}

app.get('/api/dex/launches', async (req, res) => {
  try {
    const cacheKey = 'lr:launches';
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const allMints = [..._lrBuf.keys()];
    const mints = allMints.reverse().slice(0, _LR_FEED_LIMIT);

    if (mints.length === 0) {
      const payload = { tokens: [], wsConnected: !!_lrWsConnectedAt, bufferSize: _lrBuf.size };
      setCachedJson(cacheKey, 200, payload, _LR_CACHE_MS);
      return res.json(payload);
    }

    const enrichR = await fetchWithTimeout(
      _LR_DEX_BASE + '/latest/dex/tokens/' + mints.join(','),
      { headers: { Accept: 'application/json' } },
      12_000,
    );
    if (!enrichR.ok) return respondJsonOrError(res, enrichR, await safeJson(enrichR));
    const data = await enrichR.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];

    const byMint = new Map();
    for (const m of mints) byMint.set(m, []);
    for (const p of pairs) {
      const ba = p.baseToken?.address;
      const qa = p.quoteToken?.address;
      if (ba && byMint.has(ba))      byMint.get(ba).push(p);
      else if (qa && byMint.has(qa)) byMint.get(qa).push(p);
    }

    const tokens = [];
    for (const m of mints) {
      const shaped = _lrShape(m, byMint.get(m) || [], _lrBuf.get(m));
      if (shaped) tokens.push(shaped);
    }
    tokens.sort((a, b) => Number(b.pairCreatedAt || 0) - Number(a.pairCreatedAt || 0));

    const _solP = await fetchSolPriceUsd().catch(() => 0);
    await Promise.all(tokens.map(async (t) => {
      const pf = await _lrFetchPumpInfo(t.mint, _solP);
      if (pf) {
        t.holders = pf.holders;
        if (!(t.liquidity > 0) && pf.liquidityUsd > 0) t.liquidity = pf.liquidityUsd;
        if (!t.icon && pf.imageUrl)                    t.icon      = pf.imageUrl;
        // Bonding-curve state for the client (drives chart routing + Pulse stage).
        // normalize() reads `bondingProgress`; bond stays null when pump.fun
        // didn't give a usable reserve figure (accuracy over coverage).
        if (pf.bondingProgress != null) t.bondingProgress = pf.bondingProgress;
        if (pf.graduated) t.graduated = true;
      }
      const ts = _lrTradeStats.get(t.mint);
      if (ts) {
        if (!(t.holders   > 0) && ts.traders.size > 0)            t.holders   = ts.traders.size;
        if (!(t.liquidity > 0) && ts.vSol > 0 && _solP > 0)       t.liquidity = ts.vSol * _solP * 2;
      }
      if (!t.icon) {
        const wsMeta = _lrBuf.get(t.mint);
        const img    = wsMeta?.uri ? await _lrFetchMetaImage(wsMeta.uri) : null;
        if (img) t.icon = img;
      }
    }));

    const payload = { tokens, wsConnected: !!_lrWsConnectedAt, bufferSize: _lrBuf.size };
    setCachedJson(cacheKey, 200, payload, _LR_CACHE_MS);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener launches timed out' });
    logError('lr-launches', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * Jupiter
 * ===================================================================== */
function buildJupiterHeaders() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Nexus-Account': JUPITER_ACCOUNT };
  if (JUPITER_API_KEY) h['x-api-key'] = JUPITER_API_KEY;
  return h;
}

function buildJupiterSeoHeaders() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Nexus-Account': 'NEXUS_DEX_SEO' };
  if (JUPITER_API_KEY_SEO) h['x-api-key'] = JUPITER_API_KEY_SEO;
  return h;
}

app.get('/api/jupiter/build', async (req, res) => {
  try {
    const url = JUPITER_SWAP_V2_BASE + '/build' + buildForwardedQuery(req);
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { method: 'GET', headers: buildJupiterHeaders() }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed !== null) setCachedJson(url, response.status, result.parsed, 4_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter build timed out' });
    logError('jupiter-build', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/seo/jupiter/build', async (req, res) => {
  try {
    const url = JUPITER_SWAP_V2_BASE + '/build' + buildForwardedQuery(req);
    const c   = getCachedJson('seo:' + url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { method: 'GET', headers: buildJupiterSeoHeaders() }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed !== null) setCachedJson('seo:' + url, response.status, result.parsed, 4_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter SEO build timed out' });
    logError('jupiter-seo-build', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/tokens', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    if (!params.has('query')) params.set('query', 'verified');
    const url = `${JUPITER_TOKENS_BASE}/tag?${params.toString()}`;
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 15_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 300_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter tokens timed out' });
    logError('jupiter-tokens', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/tokens/search', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const url    = `${JUPITER_TOKENS_BASE}/search?${params.toString()}`;
    const c      = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 30_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter token search timed out' });
    logError('jupiter-token-search', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/quote', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter disabled' });
    const url = JUPITER_LEGACY_BASE + '/quote' + buildForwardedQuery(req);
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { method: 'GET', headers: buildJupiterHeaders() }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed !== null) setCachedJson(url, response.status, result.parsed, 8_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter quote timed out' });
    logError('jupiter-quote', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/jupiter/swap', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter disabled' });
    const body = req.body || {};
    if (!body.userPublicKey) return res.status(400).json({ error: 'Missing userPublicKey' });
    if (!body.quoteResponse) return res.status(400).json({ error: 'Missing quoteResponse' });
    const response = await fetchWithTimeout(
      JUPITER_LEGACY_BASE + '/swap',
      { method: 'POST', headers: buildJupiterHeaders(), body: JSON.stringify(body) },
      15_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter swap timed out' });
    logError('jupiter-swap', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/jupiter/swap-instructions', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter disabled' });
    const body = req.body || {};
    if (!body.userPublicKey) return res.status(400).json({ error: 'Missing userPublicKey' });
    if (!body.quoteResponse) return res.status(400).json({ error: 'Missing quoteResponse' });
    const response = await fetchWithTimeout(
      JUPITER_LEGACY_BASE + '/swap-instructions',
      { method: 'POST', headers: buildJupiterHeaders(), body: JSON.stringify(body) },
      15_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter swap-instructions timed out' });
    logError('jupiter-swap-instructions', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/tokens/v2/toporganicscore/:timeframe', async (req, res) => {
  try {
    const url = `https://lite-api.jup.ag/tokens/v2/toporganicscore/${req.params.timeframe || '24h'}${buildForwardedQuery(req)}`;
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 30_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter tokens timed out' });
    logError('jupiter-tokens-organic', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/tokens/v2/recent', async (req, res) => {
  try {
    const url = `https://lite-api.jup.ag/tokens/v2/recent${buildForwardedQuery(req)}`;
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 5_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter recent timed out' });
    logError('jupiter-tokens-recent', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ------------------------------------------------------------------------
 * /api/dex/discover — "all of Solana" discovery universe (additive).
 *
 * Uses Jupiter's v2 ranked token lists as the universe (every tradable
 * Solana token, already ranked), normalized into the same token shape the
 * Ape feed uses so the client can filter/sort with identical logic. The mint
 * is read VERBATIM from Jupiter's `id` field (confirmed by the working swap
 * widget: `t.id || t.address || t.mint`) and is the join key everywhere
 * downstream (DexScreener detail on tap, trade path). Nothing is re-derived.
 *
 * sort: 'new'  -> Jupiter /recent
 *       else   -> Jupiter /toporganicscore/<tf>  (tf from ?tf=, default 24h)
 *
 * NOTE: Jupiter v2 market field names are mapped defensively with fallbacks
 * because the exact live schema can vary; numeric fields default to 0 when
 * absent. Accurate liquidity/holders for a specific token still come from the
 * existing /api/dex/token/:mint (top-liquidity pair) when the user opens it.
 * ---------------------------------------------------------------------- */
function _normalizeJupToken(t) {
  if (!t || typeof t !== 'object') return null;
  const mint = t.id || t.address || t.mint;
  if (!mint || typeof mint !== 'string' || !PUMP_BASE58_RE.test(mint)) return null;
  // Defensive field mapping — Jupiter v2 nests some market data; try the
  // common shapes and fall back to 0 rather than guessing one name.
  const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n !== 0) return n; } return 0; };
  const stats24 = t.stats24h || t.stats || {};
  const mcap = num(t.mcap, t.marketCap, t.fdv, t.usdMarketCap);
  const liquidity = num(t.liquidity, (t.liquidity && t.liquidity.usd), t.liquidityUsd);
  const volume24h = num(stats24.volume, stats24.v, t.volume24h, (t.volume && t.volume.h24), t.v24hUSD);
  const holders = num(t.holderCount, t.holder_count, t.holders, t.numHolders);
  const price = num(t.usdPrice, t.price, t.priceUsd);
  const change = num(stats24.priceChange, stats24.priceChange24h, t.priceChange24h, (t.priceChange && t.priceChange.h24));
  const createdAtMs = t.firstPool && t.firstPool.createdAt ? new Date(t.firstPool.createdAt).getTime()
    : (t.createdAt ? new Date(t.createdAt).getTime() : (t.created_at ? new Date(t.created_at).getTime() : null));
  return {
    mint,
    sym: t.symbol || t.sym || '???',
    name: t.name || t.symbol || 'Unknown',
    icon: t.icon || t.logoURI || null,
    price, change,
    mcap, fdv: num(t.fdv, mcap),
    volume24h, liquidity, holders,
    decimals: Number(t.decimals != null ? t.decimals : 6),
    pairCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    organicScore: num(t.organicScore, t.organic_score),
    dex: t.dex || null,
    source: 'jupiter',
  };
}

app.get('/api/dex/discover', async (req, res) => {
  try {
    const sort = String(req.query.sort || 'organic');
    const tf = String(req.query.tf || '24h');
    const upstream = (sort === 'new')
      ? `${JUPITER_TOKENS_BASE}/recent`
      : `${JUPITER_TOKENS_BASE}/toporganicscore/${encodeURIComponent(tf)}`;

    const cacheKey = 'dex:discover:' + sort + ':' + tf;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const r = await fetchWithTimeout(upstream, { headers: { Accept: 'application/json' } }, 12_000);
    if (!r.ok) {
      const payload = { tokens: [] };
      setCachedJson(cacheKey, r.status, payload, 15_000);
      return res.status(r.status).json(payload);
    }
    const data = await r.json();
    const raw = Array.isArray(data) ? data : (data && Array.isArray(data.tokens) ? data.tokens : []);
    const tokens = raw.map(_normalizeJupToken).filter(Boolean);

    const payload = { tokens };
    // 'new' refreshes fast; organic ranking is stable, cache longer.
    setCachedJson(cacheKey, 200, payload, sort === 'new' ? 5_000 : 30_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Discover timed out' });
    logError('dex-discover', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/jupiter/tokens/v2/tag', async (req, res) => {
  try {
    const url = `https://token.jup.ag/tokens/v2/tag${buildForwardedQuery(req)}`;
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 300_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter registry timed out' });
    logError('jupiter-registry', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * SOL price
 * ===================================================================== */
let _solPriceCache = { p: 0, ts: 0 };
async function fetchSolPriceUsd() {
  const now = Date.now();
  if (now - _solPriceCache.ts < 30_000 && _solPriceCache.p > 0) return _solPriceCache.p;
  const r = await fetchWithTimeout(`${JUPITER_PRICE_BASE}?ids=${SOL_MINT}`, { headers: { Accept: 'application/json' } }, 8_000);
  const d = await r.json();
  const p = Number(d?.[SOL_MINT]?.usdPrice || 0);
  if (!Number.isFinite(p) || p <= 0) throw new Error('SOL price unavailable');
  _solPriceCache = { p, ts: now };
  return p;
}

app.get('/api/sol-price', async (req, res) => {
  try { res.json({ price: await fetchSolPriceUsd(), ts: Date.now() }); }
  catch (e) { logError('sol-price', e); res.status(500).json({ error: e.message || 'Unknown error' }); }
});

// Batched Jupiter price proxy. Holdings / Stocks / Get Started previously called
// lite-api.jup.ag/price/v3 DIRECTLY from the browser; on shared mobile-carrier
// IPs Jupiter's lite tier rate-limits those requests, so prices came back empty
// → SOL showed "no price" and every stock showed "—" ($0.00 total). Routing
// through the server (stable IP + short cache, shared across all users) fixes it.
// Returns Jupiter's native shape verbatim: { "<mint>": { usdPrice, ... }, ... }.
const _jupPriceCache = new Map(); // ids -> { at, data }
const _JUP_PRICE_TTL_MS = 15_000;
app.get('/api/jupiter/price', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').trim();
    if (!ids) return res.status(400).json({ error: 'Missing ids' });
    const hit = _jupPriceCache.get(ids);
    if (hit && Date.now() - hit.at < _JUP_PRICE_TTL_MS) return res.json(hit.data);
    const response = await fetchWithTimeout(
      `${JUPITER_PRICE_BASE}?ids=${ids}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!response.ok) return res.status(response.status).json({ error: 'price upstream ' + response.status });
    const data = await response.json();
    _jupPriceCache.set(ids, { at: Date.now(), data });
    _capMap(_jupPriceCache, 500);
    return res.json(data);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'price timed out' });
    logError('jupiter-price', e);
    return res.status(500).json({ error: e.message || 'price error' });
  }
});

/* ========================================================================
 * Whale events
 * ===================================================================== */
const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2';
const GT_HEADERS = { Accept: 'application/json;version=20230203' };
const WHALE_USD_MIN  = 1000;
const WHALE_POOLS    = 5;
const WHALE_CACHE_MS = 60_000;
const SOL_TOKEN_ID   = 'solana_So11111111111111111111111111111111111111112';

app.get('/api/whale-events', async (req, res) => {
  try {
    const since  = Number(req.query.since)  || 48 * 3600 * 1000;
    const minUsd = Number(req.query.minUsd) || WHALE_USD_MIN;
    const cacheKey = `whale:${since}:${minUsd}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const solPrice = await fetchSolPriceUsd().catch(() => 0);
    if (solPrice <= 0) return res.json({ events: [] });

    const trR = await fetchWithTimeout(
      `${GECKOTERMINAL_BASE}/networks/solana/trending_pools?include=base_token,quote_token`,
      { headers: GT_HEADERS },
      10_000,
    );
    if (!trR.ok) return res.json({ events: [] });
    const trJson = await trR.json();
    const pools  = (trJson.data || []).slice(0, WHALE_POOLS);
    const tokenById = new Map();
    for (const t of (trJson.included || [])) {
      if (t.type === 'token' && t.attributes?.address) tokenById.set(t.id, t.attributes);
    }

    const cutoff = Date.now() - since;
    const events = [];

    await Promise.all(pools.map(async (pool) => {
      const poolAddr = pool.attributes?.address;
      if (!poolAddr) return;
      const baseId  = pool.relationships?.base_token?.data?.id;
      const quoteId = pool.relationships?.quote_token?.data?.id;

      let tokenAttrs = null, tokenIsBase = false;
      if (baseId && baseId !== SOL_TOKEN_ID && tokenById.has(baseId)) {
        tokenAttrs = tokenById.get(baseId); tokenIsBase = true;
      } else if (quoteId && quoteId !== SOL_TOKEN_ID && tokenById.has(quoteId)) {
        tokenAttrs = tokenById.get(quoteId); tokenIsBase = false;
      }
      if (!tokenAttrs?.address || !tokenAttrs?.symbol) return;

      try {
        const tradesR = await fetchWithTimeout(
          `${GECKOTERMINAL_BASE}/networks/solana/pools/${poolAddr}/trades?trade_volume_in_usd_greater_than=${minUsd}`,
          { headers: GT_HEADERS },
          8_000,
        );
        if (!tradesR.ok) return;
        const tradesJson = await tradesR.json();
        for (const tr of (tradesJson.data || [])) {
          const a = tr.attributes;
          if (!a) continue;
          const tokenWasBought = tokenIsBase ? a.kind === 'buy' : a.kind === 'sell';
          if (!tokenWasBought) continue;
          const ts = a.block_timestamp ? new Date(a.block_timestamp).getTime() : 0;
          if (!ts || ts < cutoff) continue;
          const usd = Number(a.volume_in_usd || 0);
          if (!Number.isFinite(usd) || usd < minUsd) continue;
          events.push({
            mint:       tokenAttrs.address,
            symbol:     tokenAttrs.symbol,
            solAmount:  Math.round((usd / solPrice) * 100) / 100,
            detectedAt: ts,
          });
        }
      } catch {}
    }));

    events.sort((a, b) => b.detectedAt - a.detectedAt);
    const payload = { events: events.slice(0, 100) };
    setCachedJson(cacheKey, 200, payload, WHALE_CACHE_MS);
    res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Whale events timed out' });
    logError('whale-events', e);
    return res.json({ events: [] });
  }
});

/* ========================================================================
 * Solana RPC — General path
 * ===================================================================== */
const RPC_TIMEOUT_MS = 10_000;

function getSolanaRpcUrl() {
  return PRIMARY_RPC_URL;
}

async function _alchemySingle(single) {
  const id = single?.id ?? null;
  try {
    const r = await fetchWithTimeout(
      PRIMARY_RPC_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(single) },
      RPC_TIMEOUT_MS,
    );
    const text = await r.text();
    if (r.ok) {
      try { return JSON.parse(text); }
      catch { return { jsonrpc: '2.0', id, error: { code: -32700, message: 'Non-JSON response from upstream' } }; }
    }
    return { jsonrpc: '2.0', id, error: { code: r.status, message: 'RPC HTTP ' + r.status + ': ' + text.slice(0, 200) } };
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e?.message || e) } };
  }
}

async function forwardRpc(body) {
  if (!PRIMARY_RPC_URL) {
    const err = new Error(SOLANA_NETWORK === 'devnet'
      ? 'DEVNET_RPC_URL is not configured'
      : 'ALCHEMY_RPC_URL is not configured');
    err.status = 500;
    throw err;
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(_alchemySingle));
    return { status: 200, parsed: results, raw: null };
  }

  const r = await fetchWithTimeout(
    PRIMARY_RPC_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) },
    RPC_TIMEOUT_MS,
  );
  const text = await r.text();
  if (!r.ok) {
    const err = new Error('RPC HTTP ' + r.status + ': ' + text.slice(0, 200));
    err.status = r.status;
    throw err;
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return { status: r.status, parsed: null, raw: text }; }
  return { status: r.status, parsed, raw: null };
}

function sendForwardedRpc(res, result) {
  if (result.parsed !== null) return res.status(result.status).json(result.parsed);
  return res.status(result.status).json({ error: 'Upstream returned non-JSON', body: (result.raw || '').slice(0, 500) });
}

app.post('/api/helius/das', async (req, res) => {
  try {
    const result = await forwardRpc(req.body);
    return sendForwardedRpc(res, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC (das alias) timed out' });
    logError('solana-rpc-das-alias', e);
    return res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/solana-rpc', async (req, res) => {
  try {
    const result = await forwardRpc(req.body);
    return sendForwardedRpc(res, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC timed out' });
    logError('solana-rpc', e);
    return res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: e.message || 'Unknown error' });
  }
});

/* ------------------------------------------------------------------------
 * /api/trade-rpc — dedicated buy/sell trade-path proxy.
 * ---------------------------------------------------------------------- */
function _tradeUrlChain() {
  if (SOLANA_NETWORK === 'devnet') {
    return [DEVNET_RPC_URL].filter(Boolean);
  }
  const chain = [ALCHEMY_RPC_URL, ANKR_RPC_URL].filter(Boolean);
  return [...new Set(chain)];
}

async function _tradeSingle(single) {
  const id = single?.id ?? null;
  const urls = _tradeUrlChain();
  let lastStatus = 0, lastText = '';
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(single) },
        RPC_TIMEOUT_MS,
      );
      const text = await r.text();
      if (r.ok) {
        try { return JSON.parse(text); }
        catch { return { jsonrpc: '2.0', id, error: { code: -32700, message: 'Non-JSON response from upstream' } }; }
      }
      lastStatus = r.status; lastText = text;
    } catch (e) {
      lastStatus = 0; lastText = String(e?.message || e);
    }
  }
  if (lastStatus === 0) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: lastText } };
  }
  return { jsonrpc: '2.0', id, error: { code: lastStatus, message: 'RPC HTTP ' + lastStatus + ': ' + lastText.slice(0, 200) } };
}

async function forwardTradeRpc(body) {
  const urls = _tradeUrlChain();
  if (urls.length === 0) {
    const err = new Error(SOLANA_NETWORK === 'devnet'
      ? 'Trade RPC: DEVNET_RPC_URL is not configured'
      : 'Trade RPC: neither ALCHEMY_RPC_URL nor ANKR_RPC_URL is configured');
    err.status = 500;
    throw err;
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(_tradeSingle));
    return { status: 200, parsed: results, raw: null };
  }

  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) },
        RPC_TIMEOUT_MS,
      );
      const text = await r.text();
      if (!r.ok) {
        lastErr = new Error('RPC HTTP ' + r.status + ': ' + text.slice(0, 200));
        lastErr.status = r.status;
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { return { status: r.status, parsed: null, raw: text }; }
      return { status: r.status, parsed, raw: null };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

app.post('/api/trade-rpc', async (req, res) => {
  try {
    const result = await forwardTradeRpc(req.body);
    return sendForwardedRpc(res, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Trade RPC timed out' });
    logError('trade-rpc', e);
    return res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * Health
 * ===================================================================== */
app.get('/health', (req, res) => res.status(200).send('ok'));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true, env: NODE_ENV,
    has: {
      jupiter:        Boolean(JUPITER_ENABLED),
      jupiterApiKey:  Boolean(JUPITER_API_KEY),
      jupiterSeoKey:  Boolean(JUPITER_API_KEY_SEO),
      solanaRpc:      Boolean(PRIMARY_RPC_URL),
      chainflip:      true,
    },
    jupiter: {
      swapV2: JUPITER_SWAP_V2_BASE,
      tokens: JUPITER_TOKENS_BASE,
      legacy: JUPITER_LEGACY_BASE,
      price:  JUPITER_PRICE_BASE,
      keySet:    Boolean(JUPITER_API_KEY),
      seoKeySet: Boolean(JUPITER_API_KEY_SEO),
    },
    chainflip: { network: 'mainnet', brokerCommissionBps: 0 },
    solanaRpc: {
      provider:   SOLANA_NETWORK === 'devnet' ? 'devnet' : 'alchemy',
      network:    SOLANA_NETWORK,
      urlSet:     Boolean(PRIMARY_RPC_URL),
      alchemySet: Boolean(ALCHEMY_RPC_URL),
      devnetSet:  Boolean(DEVNET_RPC_URL),
      timeoutMs:  RPC_TIMEOUT_MS,
      batching:   'server-side unroll',
    },
    tradeRpc: {
      primaryProvider:  SOLANA_NETWORK === 'devnet' ? 'devnet' : 'alchemy',
      fallbackProvider: SOLANA_NETWORK === 'devnet' ? null : 'ankr',
      ankrSet:          Boolean(ANKR_RPC_URL),
    },
    time: new Date().toISOString(),
  });
});

/* ========================================================================
 * Launch Radar — DexScreener data + PumpPortal trades
 * ===================================================================== */
const DEX_BASE          = 'https://api.dexscreener.com';
const PUMPPORTAL_URL    = 'https://pumpportal.fun/api/trade-local';
const PUMP_DEX_IDS      = new Set(['pumpfun', 'pumpswap']);
const PUMP_BASE58_RE    = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUMP_SLIPPAGE_PCT = 10;
const PUMP_PRIORITY_FEE = 0.001;

function _shapePumpToken(mint, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const pumpPair = pairs.find(p => PUMP_DEX_IDS.has(String(p.dexId || '').toLowerCase()));
  if (!pumpPair) return null;
  const best = pairs.reduce(
    (a, b) => (Number(b.liquidity?.usd || 0) > Number(a.liquidity?.usd || 0) ? b : a),
    pairs[0],
  );
  const base  = best.baseToken  || {};
  const quote = best.quoteToken || {};
  const me    = base.address === mint ? base : quote;
  return {
    mint,
    sym:            me.symbol || '???',
    name:           me.name   || me.symbol || 'Unknown',
    icon:           best.info?.imageUrl || null,
    price:          Number(best.priceUsd || 0),
    priceChange24h: Number(best.priceChange?.h24 || 0),
    mcap:           Number(best.marketCap || best.fdv || 0),
    fdv:            Number(best.fdv || 0),
    volume24h:      Number(best.volume?.h24 || 0),
    liquidity:      Number(best.liquidity?.usd || 0),
    pairCreatedAt:  best.pairCreatedAt || null,
    dexId:          pumpPair.dexId,
    pumpPool:       pumpPair.dexId === 'pumpswap' ? 'pump-amm' : 'pump',
    decimals:       6,
  };
}

app.get('/api/dex/token/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!PUMP_BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });

    const cacheKey = 'dex:tok:' + mint;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const r = await fetchWithTimeout(
      DEX_BASE + '/latest/dex/tokens/' + mint,
      { headers: { Accept: 'application/json' } },
      10_000,
    );
    if (!r.ok) return respondJsonOrError(res, r, await safeJson(r));
    const data = await r.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const shaped = _shapePumpToken(mint, pairs);
    const payload = { token: shaped, hasPumpPair: !!shaped };
    setCachedJson(cacheKey, 200, payload, 5_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener token timed out' });
    logError('dex-token', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ------------------------------------------------------------------------
 * /api/pump/info/:mint — fresh-token fallback.
 *
 * DexScreener doesn't index a pump.fun token for the first few minutes, so
 * /api/dex/token returns null or zero liquidity/holders for brand-new mints
 * (shows "Thin liq —", "0 holders", bottomed-out safety score). This route
 * returns pump.fun's own bonding-curve data — liquidity from the curve's SOL
 * reserves, holder count, image — which exists from the moment of launch.
 *
 * Additive only: the client calls this when /api/dex/token comes back thin,
 * and merges the fields. Reuses _lrFetchPumpInfo + fetchSolPriceUsd already
 * defined above. Does NOT touch the existing /api/dex/token route.
 * ---------------------------------------------------------------------- */
app.get('/api/pump/info/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!PUMP_BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });

    const cacheKey = 'pump:info:' + mint;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const solP = await fetchSolPriceUsd().catch(() => 0);
    const pf = await _lrFetchPumpInfo(mint, solP).catch(() => null);

    // Also pull any websocket trade-stat data we already track for this mint
    // (trader count, latest vSol) as a secondary source.
    const ts = _lrTradeStats.get(mint);
    const wsMeta = _lrBuf.get(mint);

    let holders = (pf && pf.holders > 0) ? pf.holders : 0;
    if (!(holders > 0) && ts && ts.traders && ts.traders.size > 0) holders = ts.traders.size;

    let liquidityUsd = (pf && pf.liquidityUsd > 0) ? pf.liquidityUsd : 0;
    if (!(liquidityUsd > 0) && ts && ts.vSol > 0 && solP > 0) liquidityUsd = ts.vSol * solP * 2;

    const icon = (pf && pf.imageUrl) || null;

    const payload = {
      mint,
      holders,
      liquidity: liquidityUsd,
      icon,
      sym:  (wsMeta && wsMeta.sym) || null,
      name: (wsMeta && wsMeta.name) || null,
      source: 'pump.fun',
      found: !!(pf || (ts && (ts.traders.size > 0 || ts.vSol > 0))),
    };
    // Short cache — this data fills in fast as the token ages.
    setCachedJson(cacheKey, 200, payload, 3_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'pump.fun info timed out' });
    logError('pump-info', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/dex/pump-check', async (req, res) => {
  try {
    const mintsParam = String(req.query.mints || '');
    if (!mintsParam) return res.json({ pumpMints: [] });

    const requested = mintsParam.split(',').map(s => s.trim()).filter(Boolean);
    const valid = [...new Set(requested.filter(m => PUMP_BASE58_RE.test(m)))];
    if (valid.length === 0) return res.json({ pumpMints: [] });
    if (valid.length > 100) return res.status(400).json({ error: 'Too many mints (max 100)' });

    const cacheKey = 'dex:pumpset:' + valid.slice().sort().join(',');
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const chunks = [];
    for (let i = 0; i < valid.length; i += 30) chunks.push(valid.slice(i, i + 30));

    const pumpSet = new Set();
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const r = await fetchWithTimeout(
          DEX_BASE + '/latest/dex/tokens/' + chunk.join(','),
          { headers: { Accept: 'application/json' } },
          10_000,
        );
        if (!r.ok) {
          warnSampled('dex-pump-check:' + r.status, 60_000,
            '[dex-pump-check] non-OK from DexScreener:', r.status, '(sampled)');
          return;
        }
        const data = await r.json();
        const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
        for (const p of pairs) {
          const mint = p?.baseToken?.address;
          if (!mint) continue;
          const dex = String(p?.dexId || '').toLowerCase();
          if (PUMP_DEX_IDS.has(dex)) pumpSet.add(mint);
        }
      } catch (e) {
        warnSampled('dex-pump-check:fetch', 60_000,
          '[dex-pump-check] fetch failed:', e?.message);
      }
    }));

    const payload = { pumpMints: [...pumpSet] };
    setCachedJson(cacheKey, 200, payload, 60_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener pump-check timed out' });
    logError('dex-pump-check', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/dex/sol-price', async (req, res) => {
  try {
    const cacheKey = 'dex:solprice';
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const r = await fetchWithTimeout(
      DEX_BASE + '/latest/dex/tokens/' + SOL_MINT,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!r.ok) return respondJsonOrError(res, r, await safeJson(r));
    const data = await r.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const stables = pairs
      .filter(p => p.chainId === 'solana')
      .filter(p => ['USDC', 'USDT'].includes(String(p.quoteToken?.symbol || '').toUpperCase()));
    const best = stables.length
      ? stables.reduce((a, b) => (Number(b.liquidity?.usd || 0) > Number(a.liquidity?.usd || 0) ? b : a))
      : pairs[0];
    const price = Number(best?.priceUsd || 0);
    if (!Number.isFinite(price) || price <= 0)
      return res.status(502).json({ error: 'SOL price unavailable from DexScreener' });
    const payload = { price, ts: Date.now() };
    setCachedJson(cacheKey, 200, payload, 30_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener sol-price timed out' });
    logError('dex-sol-price', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

const _chartTfs = {
  '5m':  { timeframe: 'minute', aggregate: 1,  limit: 60  },
  '1H':  { timeframe: 'minute', aggregate: 5,  limit: 60  },
  '6H':  { timeframe: 'minute', aggregate: 15, limit: 60  },
  '24H': { timeframe: 'hour',   aggregate: 1,  limit: 48  },
};

app.get('/api/dex/chart/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!PUMP_BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const tf = String(req.query.tf || '5m');
    const tfDef = _chartTfs[tf];
    if (!tfDef) return res.status(400).json({ error: 'Invalid tf (use 5m, 1H, 6H, 24H)' });

    const cacheKey = 'dex:chart:' + mint + ':' + tf;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const dexR = await fetchWithTimeout(
      DEX_BASE + '/latest/dex/tokens/' + mint,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!dexR.ok) {
      const payload = { points: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const dexData = await dexR.json();
    const pairs = (dexData?.pairs || []).filter(p => p?.chainId === 'solana' && p?.pairAddress);
    if (pairs.length === 0) {
      const payload = { points: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const best = pairs.reduce(
      (a, b) => (Number(b.liquidity?.usd || 0) > Number(a.liquidity?.usd || 0) ? b : a),
      pairs[0],
    );
    const pairAddress = best.pairAddress;

    const gtUrl = GECKOTERMINAL_BASE
      + '/networks/solana/pools/' + pairAddress
      + '/ohlcv/' + tfDef.timeframe
      + '?aggregate=' + tfDef.aggregate
      + '&limit=' + tfDef.limit
      + '&currency=usd';
    const gtR = await fetchWithTimeout(gtUrl, { headers: GT_HEADERS }, 8_000);
    if (!gtR.ok) {
      const payload = { points: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const gtData = await gtR.json();

    const raw = gtData?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(raw) || raw.length === 0) {
      const payload = { points: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const points = raw
      .slice()
      .reverse()
      .map(row => ({ ts: Number(row[0]) * 1000, price: Number(row[4]) }))
      .filter(p => Number.isFinite(p.ts) && Number.isFinite(p.price) && p.price > 0);

    if (points.length < 2) {
      const payload = { points: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }

    const payload = { points };
    setCachedJson(cacheKey, 200, payload, 5 * 60_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Chart timed out' });
    logError('dex-chart', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ------------------------------------------------------------------------
 * /api/dex/candles/:mint — full OHLCV candlesticks (additive).
 *
 * The existing /api/dex/chart returns close-only points (a line). For real
 * candlestick charts the client needs open/high/low/close/volume per bar.
 * GeckoTerminal already returns all of that in ohlcv_list — this route keeps
 * every field instead of discarding O/H/L/V. Does NOT touch /api/dex/chart.
 * ohlcv_list row = [ts, open, high, low, close, volume].
 * ---------------------------------------------------------------------- */
app.get('/api/dex/candles/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!PUMP_BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const tf = String(req.query.tf || '5m');
    const tfDef = _chartTfs[tf];
    if (!tfDef) return res.status(400).json({ error: 'Invalid tf (use 5m, 1H, 6H, 24H)' });

    const cacheKey = 'dex:candles:' + mint + ':' + tf;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const dexR = await fetchWithTimeout(
      DEX_BASE + '/latest/dex/tokens/' + mint,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!dexR.ok) {
      const payload = { candles: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const dexData = await dexR.json();
    const pairs = (dexData?.pairs || []).filter(p => p?.chainId === 'solana' && p?.pairAddress);
    if (pairs.length === 0) {
      const payload = { candles: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const best = pairs.reduce(
      (a, b) => (Number(b.liquidity?.usd || 0) > Number(a.liquidity?.usd || 0) ? b : a),
      pairs[0],
    );

    const gtUrl = GECKOTERMINAL_BASE
      + '/networks/solana/pools/' + best.pairAddress
      + '/ohlcv/' + tfDef.timeframe
      + '?aggregate=' + tfDef.aggregate
      + '&limit=' + tfDef.limit
      + '&currency=usd';
    const gtR = await fetchWithTimeout(gtUrl, { headers: GT_HEADERS }, 8_000);
    if (!gtR.ok) {
      const payload = { candles: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }
    const gtData = await gtR.json();
    const raw = gtData?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(raw) || raw.length === 0) {
      const payload = { candles: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }

    const candles = raw
      .slice()
      .reverse()
      .map(row => ({
        ts: Number(row[0]) * 1000,
        o:  Number(row[1]),
        h:  Number(row[2]),
        l:  Number(row[3]),
        c:  Number(row[4]),
        v:  Number(row[5] || 0),
      }))
      .filter(k => Number.isFinite(k.ts) && Number.isFinite(k.o) && Number.isFinite(k.h)
        && Number.isFinite(k.l) && Number.isFinite(k.c) && k.c > 0);

    if (candles.length < 2) {
      const payload = { candles: [] };
      setCachedJson(cacheKey, 404, payload, 60_000);
      return res.status(404).json(payload);
    }

    const payload = { candles };
    // Timeframe-aware cache: short TTL on fast frames so the chart can actually
    // refresh near-live (no point the client polling faster than this). Slow
    // frames change rarely, so cache them longer to save upstream calls.
    const candleTtl = tf === '5m' ? 4_000 : tf === '1H' ? 10_000 : 30_000;
    setCachedJson(cacheKey, 200, payload, candleTtl);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Candles timed out' });
    logError('dex-candles', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* /api/pumpfun/trade is served by ./pumpfun-trade (SDK instruction builder).
 * Mounted in its own dedicated section below, separate from Ape.
 * The old inline PumpPortal proxy was removed: the drawer client expects a
 * serialized `instructions[]` array, not a pre-built `tx`. */

/* ========================================================================
 * Launch Radar — Jupiter Ultra V3 proxy
 * ===================================================================== */
const JUPITER_ULTRA_BASE = 'https://api.jup.ag/ultra/v1';

app.get('/api/jupiter/ultra-order', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter disabled' });
    const url = JUPITER_ULTRA_BASE + '/order' + buildForwardedQuery(req);
    const response = await fetchWithTimeout(
      url,
      { method: 'GET', headers: buildJupiterHeaders() },
      12_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter Ultra order timed out' });
    logError('jupiter-ultra-order', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * Chainflip — SOL → native BTC
 * ===================================================================== */
const { SwapSDK, Chains, Assets } = require('@chainflip/sdk/swap');

const chainflipSdk = new SwapSDK({ network: 'mainnet' });

function _cfErrMsg(e) {
  const m = String(e?.message || e || 'Chainflip error');
  if (/below.*minimum|minimum.*deposit|too small/i.test(m)) return 'Amount below Chainflip minimum';
  if (/above.*maximum|maximum.*deposit|too large/i.test(m)) return 'Amount above Chainflip maximum';
  if (/no.*liquidity|insufficient.*liquidity/i.test(m))     return 'Insufficient liquidity right now';
  if (/timed?\s*out|timeout/i.test(m))                      return 'Chainflip timed out — retry';
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

/* ─── Chainflip slippage policy ─────────────────────────────────────
 * Goal: keep txs landing. Honor Chainflip's recommendation but add
 * headroom so we don't refund on small price drift.
 *
 *   effective = clamp( max(client, chainflipRec × BUFFER, FLOOR), FLOOR, CAP )
 *
 *   - FLOOR (3%) protects against too-tight slippage on calm pools.
 *   - BUFFER (1.5×) gives us headroom over Chainflip's recommendation.
 *   - CAP (15%)  protects users from absurd slippage even if the SDK or
 *                client asks for it.
 *
 * Examples:
 *   calm pool, rec 1%  → 3%  (floor)
 *   normal,    rec 3%  → 4.5% (rec × 1.5)
 *   volatile,  rec 8%  → 12%  (rec × 1.5)
 *   wild,      rec 12% → 15%  (cap)
 * ───────────────────────────────────────────────────────────────── */
const CF_SLIP_FLOOR  = 3;
const CF_SLIP_CAP    = 15;
const CF_SLIP_BUFFER = 1.5;

function resolveCfSlippage(clientSlip, recommended, { floor = CF_SLIP_FLOOR, cap = CF_SLIP_CAP } = {}) {
  const client = Number.isFinite(Number(clientSlip))  ? Number(clientSlip)  : null;
  const rec    = Number.isFinite(Number(recommended)) ? Number(recommended) : null;
  const bumped = rec != null ? rec * CF_SLIP_BUFFER : null;
  const candidates = [client, bumped, floor].filter(v => Number.isFinite(v) && v > 0);
  const picked = candidates.length ? Math.max(...candidates) : floor;
  return Math.min(cap, Math.max(floor, picked));
}

app.get('/api/chainflip/quote', async (req, res) => {
  try {
    const amount = String(req.query.amount || '');
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      return res.status(400).json({ error: 'amount (lamports, positive integer) required' });
    }
    const { quotes } = await chainflipSdk.getQuoteV2({
      srcChain:  Chains.Solana,
      srcAsset:  Assets.SOL,
      destChain: Chains.Bitcoin,
      destAsset: Assets.BTC,
      amount,
    });
    const regular = Array.isArray(quotes) ? quotes.find(q => q.type === 'REGULAR') : null;
    if (!regular) return res.status(502).json({ error: 'No regular quote available' });
    return res.json({ quote: regular });
  } catch (e) {
    logError('chainflip-quote', e);
    return res.status(500).json({ error: _cfErrMsg(e) });
  }
});

app.post('/api/chainflip/channel', async (req, res) => {
  try {
    const { quote, destAddress, refundAddress, slippagePct } = req.body || {};
    if (!quote || typeof quote !== 'object')                 return res.status(400).json({ error: 'quote required' });
    if (!destAddress   || typeof destAddress   !== 'string') return res.status(400).json({ error: 'destAddress required'   });
    if (!refundAddress || typeof refundAddress !== 'string') return res.status(400).json({ error: 'refundAddress required' });
    if (quote.type !== 'REGULAR')                            return res.status(400).json({ error: 'REGULAR quote required' });

    const slip = resolveCfSlippage(slippagePct, quote.recommendedSlippageTolerancePercent);
    const liveRec  = quote.recommendedLivePriceSlippageTolerancePercent;
    const liveSlip = (liveRec != null) ? resolveCfSlippage(undefined, liveRec) : undefined;

    const channel = await chainflipSdk.requestDepositAddressV2({
      quote,
      destAddress,
      fillOrKillParams: {
        refundAddress,
        retryDurationBlocks: 150,
        slippageTolerancePercent: slip,
        livePriceSlippageTolerancePercent: liveSlip,
      },
    });

    return res.json({
      channel: {
        depositChannelId:        channel.depositChannelId,
        depositAddress:          channel.depositAddress,
        srcChainExpiryBlock:     String(channel.depositChannelExpiryBlock),
        channelOpeningFee:       String(channel.channelOpeningFee),
        estimatedExpiryTime:     channel.estimatedDepositChannelExpiryTime ?? null,
        brokerCommissionBps:     channel.brokerCommissionBps,
        slippagePctUsed:         slip,
        livePriceSlippagePctUsed: liveSlip ?? null,
      },
    });
  } catch (e) {
    logError('chainflip-channel', e);
    return res.status(500).json({ error: _cfErrMsg(e) });
  }
});

app.get('/api/chainflip/status', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ error: 'id (depositChannelId) required' });
    const status = await chainflipSdk.getStatusV2({ id });
    return res.json({ status });
  } catch (e) {
    logError('chainflip-status', e);
    return res.status(500).json({ error: _cfErrMsg(e) });
  }
});

/* ========================================================================
 * Chainflip — Generic multi-route swaps
 * ===================================================================== */
const _cfMod   = require('@chainflip/sdk/swap');
const _cfMulti = new _cfMod.SwapSDK({ network: 'mainnet' });

function _cfMultiErr(e) {
  const m = String(e?.message || e || 'Chainflip error');
  if (/below.*minimum|minimum.*deposit|too small/i.test(m)) return 'Amount below Chainflip minimum for this asset';
  if (/above.*maximum|maximum.*deposit|too large/i.test(m)) return 'Amount above Chainflip maximum for this asset';
  if (/no.*liquidity|insufficient.*liquidity/i.test(m))     return 'Insufficient liquidity right now';
  if (/no.*route|unsupported|invalid.*(chain|asset)/i.test(m)) return 'Chainflip does not support this route';
  if (/timed?\s*out|timeout/i.test(m))                      return 'Chainflip timed out — please retry';
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

const _cfChainSet = new Set(['Bitcoin', 'Ethereum', 'Arbitrum', 'Polkadot', 'Solana', 'Assethub', 'Tron']);
const _cfAssetSet = new Set(['BTC', 'ETH', 'USDC', 'USDT', 'FLIP', 'WBTC', 'DOT', 'SOL', 'TRX']);

const _cfMatrix = {
  updatedAt: '2026-03-30',
  chains: [
    { chain: 'Ethereum', chainType: 'EVM', name: 'Ethereum', color: '#627eea',
      assets: [
        { asset: 'ETH',  symbol: 'ETH',  name: 'Ether',           decimals: 18 },
        { asset: 'USDC', symbol: 'USDC', name: 'USD Coin',        decimals: 6  },
        { asset: 'USDT', symbol: 'USDT', name: 'Tether USD',      decimals: 6  },
        { asset: 'WBTC', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8  },
        { asset: 'FLIP', symbol: 'FLIP', name: 'Chainflip',       decimals: 18 },
      ],
    },
    { chain: 'Arbitrum', chainType: 'EVM', name: 'Arbitrum', color: '#28a0f0',
      assets: [
        { asset: 'ETH',  symbol: 'ETH',  name: 'Ether',      decimals: 18 },
        { asset: 'USDC', symbol: 'USDC', name: 'USD Coin',   decimals: 6  },
        { asset: 'USDT', symbol: 'USDT', name: 'Tether USD', decimals: 6  },
      ],
    },
    { chain: 'Bitcoin', chainType: 'BTC', name: 'Bitcoin', color: '#f7931a',
      assets: [
        { asset: 'BTC', symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
      ],
    },
    { chain: 'Solana', chainType: 'SVM', name: 'Solana', color: '#14f195',
      assets: [
        { asset: 'SOL',  symbol: 'SOL',  name: 'Solana',     decimals: 9 },
        { asset: 'USDC', symbol: 'USDC', name: 'USD Coin',   decimals: 6 },
        { asset: 'USDT', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
    },
    { chain: 'Polkadot', chainType: 'DOT', name: 'Polkadot', color: '#e6007a',
      assets: [
        { asset: 'DOT', symbol: 'DOT', name: 'Polkadot', decimals: 10 },
      ],
    },
    { chain: 'Assethub', chainType: 'DOT', name: 'Assethub', color: '#aa5cdb',
      assets: [
        { asset: 'SOL',  symbol: 'SOL',  name: 'Solana',     decimals: 9 },
        { asset: 'USDC', symbol: 'USDC', name: 'USD Coin',   decimals: 6 },
        { asset: 'USDT', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
    },
    { chain: 'Tron', chainType: 'TRX', name: 'Tron', color: '#ff060a',
      assets: [
        { asset: 'TRX',  symbol: 'TRX',  name: 'Tronix',     decimals: 6 },
        { asset: 'USDT', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      ],
    },
  ],
};

app.get('/api/cf/assets', (req, res) => res.json(_cfMatrix));

app.get('/api/cf/quote', async (req, res) => {
  try {
    const srcChain  = String(req.query.srcChain  || '');
    const srcAsset  = String(req.query.srcAsset  || '');
    const destChain = String(req.query.destChain || '');
    const destAsset = String(req.query.destAsset || '');
    const amount    = String(req.query.amount    || '');
    if (!_cfChainSet.has(srcChain))  return res.status(400).json({ error: 'Invalid srcChain' });
    if (!_cfChainSet.has(destChain)) return res.status(400).json({ error: 'Invalid destChain' });
    if (!_cfAssetSet.has(srcAsset))  return res.status(400).json({ error: 'Invalid srcAsset' });
    if (!_cfAssetSet.has(destAsset)) return res.status(400).json({ error: 'Invalid destAsset' });
    if (srcChain === destChain && srcAsset === destAsset) {
      return res.status(400).json({ error: 'Source and destination must differ' });
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      return res.status(400).json({ error: 'amount (atomic units, positive integer) required' });
    }
    const { quotes } = await _cfMulti.getQuoteV2({
      srcChain, srcAsset, destChain, destAsset, amount,
    });
    const regular = Array.isArray(quotes) ? quotes.find(q => q.type === 'REGULAR') : null;
    if (!regular) return res.status(502).json({ error: 'No regular quote available for this route' });
    return res.json({ quote: regular });
  } catch (e) {
    logError('cf-quote', e);
    return res.status(500).json({ error: _cfMultiErr(e) });
  }
});

app.post('/api/cf/channel', async (req, res) => {
  try {
    const { quote, destAddress, refundAddress, slippagePct } = req.body || {};
    if (!quote || typeof quote !== 'object')                 return res.status(400).json({ error: 'quote required' });
    if (!destAddress   || typeof destAddress   !== 'string') return res.status(400).json({ error: 'destAddress required'   });
    if (!refundAddress || typeof refundAddress !== 'string') return res.status(400).json({ error: 'refundAddress required' });
    if (quote.type !== 'REGULAR')                            return res.status(400).json({ error: 'REGULAR quote required' });

    const slip = resolveCfSlippage(slippagePct, quote.recommendedSlippageTolerancePercent);
    const liveRec  = quote.recommendedLivePriceSlippageTolerancePercent;
    const liveSlip = (liveRec != null) ? resolveCfSlippage(undefined, liveRec) : undefined;

    const channel = await _cfMulti.requestDepositAddressV2({
      quote,
      destAddress,
      fillOrKillParams: {
        refundAddress,
        retryDurationBlocks: 150,
        slippageTolerancePercent: slip,
        livePriceSlippageTolerancePercent: liveSlip,
      },
    });

    return res.json({
      channel: {
        depositChannelId:        channel.depositChannelId,
        depositAddress:          channel.depositAddress,
        srcChain:                channel.srcChain,
        srcAsset:                channel.srcAsset,
        destChain:               channel.destChain,
        destAsset:               channel.destAsset,
        srcChainExpiryBlock:     String(channel.depositChannelExpiryBlock),
        channelOpeningFee:       String(channel.channelOpeningFee),
        estimatedExpiryTime:     channel.estimatedDepositChannelExpiryTime ?? null,
        brokerCommissionBps:     channel.brokerCommissionBps,
        slippagePctUsed:         slip,
        livePriceSlippagePctUsed: liveSlip ?? null,
      },
    });
  } catch (e) {
    logError('cf-channel', e);
    return res.status(500).json({ error: _cfMultiErr(e) });
  }
});

app.get('/api/cf/status', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ error: 'id (depositChannelId) required' });
    const status = await _cfMulti.getStatusV2({ id });
    return res.json({ status });
  } catch (e) {
    logError('cf-status', e);
    return res.status(500).json({ error: _cfMultiErr(e) });
  }
});

/* ========================================================================
 * Debug — phone-friendly
 * ===================================================================== */
app.get('/api/debug/wallet/:wallet', async (req, res) => {
  const wallet = req.params.wallet;
  const out = {
    wallet,
    network:    SOLANA_NETWORK,
    primaryRpc: scrubSecrets(PRIMARY_RPC_URL),
    checks:     {},
  };

  try {
    const r = await forwardRpc({
      jsonrpc: '2.0', id: 1, method: 'getBalance', params: [wallet],
    });
    out.checks.solBalance = r.parsed;
  } catch (e) { out.checks.solBalance = { error: e.message }; }

  try {
    const r = await forwardRpc({
      jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
      params: [
        wallet,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    });
    const accs = r.parsed?.result?.value || [];
    out.checks.tokenCount = accs.length;
    out.checks.firstThreeTokens = accs.slice(0, 3).map(a => ({
      mint:   a?.account?.data?.parsed?.info?.mint,
      amount: a?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString,
    }));
    if (r.parsed?.error) out.checks.tokenError = r.parsed.error;
  } catch (e) { out.checks.tokenError = e.message; }

  try {
    const r = await forwardRpc({
      jsonrpc: '2.0', id: 3, method: 'getTokenAccountsByOwner',
      params: [
        wallet,
        { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    });
    out.checks.token2022Count = (r.parsed?.result?.value || []).length;
    if (r.parsed?.error) out.checks.token2022Error = r.parsed.error;
  } catch (e) { out.checks.token2022Error = e.message; }

  res.json(out);
});

/* ========================================================================
 * Referrals + P&L + leaderboard + honeypot check
 * ===================================================================== */
require('./referrals')(app, { rpcUrl: PRIMARY_RPC_URL });

/* ========================================================================
 * Ape (burner page) — dedicated Pump.fun trade route
 * ===================================================================== */
require('./ape-pump-trade').mountRoutes(app);
require('./ape-pump-candles').mountRoutes(app);

/* ========================================================================
 * Pump.fun bonding-curve trades (main drawer) — dedicated section.
 * SEPARATE from Ape above. Serves POST /api/pumpfun/trade via the
 * @pump-fun/pump-sdk instruction builder in ./pumpfun-trade.js.
 * Uses the same Alchemy node (ALCHEMY_RPC_URL) as the rest of the app;
 * the signed tx submits through /api/trade-rpc (Alchemy → Ankr fallback).
 * Requires: npm install @pump-fun/pump-sdk @coral-xyz/anchor bn.js
 * ===================================================================== */
require('./pumpfun-trade').mountRoutes(app);

/* ========================================================================
 * Admin dashboard — /api/visit + /api/admin/overview
 * (mounted last so it can use the same data/ dir as referrals)
 * ===================================================================== */
require('./admin')(app);

/* ========================================================================
 * NEXUS CHARTS — added section (self-contained; nothing else is modified).
 *
 * Registered HERE, immediately before app.all('/api/*'), so it is not
 * shadowed by that 404 catch-all.
 *
 *   GET /api/nx/chart/:mint -> { mint, pool, closes, change, price }
 *   GET /api/nx/pool/:mint  -> { mint, pool }
 *
 * Contract-matched, server-side, cached chart/sparkline data:
 *   - pool   : GeckoTerminal pool whose BASE token is EXACTLY this mint
 *              (a quote-side pool charts the WRONG token, so it is never used;
 *              if no base-matched pool exists, pool is null).
 *   - closes : last 60 one-minute closes (the 1-hour window), oldest -> newest.
 *   - change : the 1-hour % from those same closes (matches the sparkline).
 *   - price  : latest close.
 *
 * Self-contained: own cache + own helpers, all names prefixed nx/NX_ to avoid
 * collision. Reuses only fetchWithTimeout (defined far above). No swap / RPC /
 * trade / signing code. Touches no existing route.
 * ===================================================================== */
const NX_GT       = 'https://api.geckoterminal.com/api/v2';
const NX_B58      = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// THE ONE DIAL: a cached token is served instantly; once it is older than this,
// the NEXT view triggers a background refresh (the stale value is still shown,
// then swapped in place). Lower = fresher but more GeckoTerminal calls; higher =
// fewer calls but staler. 5 min keeps a 1-hour sparkline live without hammering;
// bump toward 3_600_000 (1 hour) if you want even fewer refetches.
const NX_FRESH_MS = 5 * 60_000;
const NX_MAX      = 5000;       // big LRU cap — keep lots of tokens hot so nothing reloads from blank
const _nxCache    = new Map();  // mint -> { at, payload }  (last good value; never expires under a request)
const _nxInflight = new Map();  // mint -> Promise           (dedupe concurrent refreshes)

// Pick the chart pool. Prefer the pool whose BASE token is exactly this mint
// (token-as-base → the embed shows this exact contract). If none is base-side,
// fall back to the deepest pool that HOLDS this token (still this token's
// market) rather than giving up — that fallback is why charts now load instead
// of saying "chart not available".
function _nxPickPool(pools, mint) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const wanted = 'solana_' + mint;
  const baseId = p => String(p?.relationships?.base_token?.data?.id || '');
  const addr   = p => p?.attributes?.address || null;
  const liq    = p => Number(p?.attributes?.reserve_in_usd || 0);
  const withAddr = pools.filter(addr);
  if (!withAddr.length) return null;
  const base = withAddr.filter(p => baseId(p) === wanted);
  const set  = base.length ? base : withAddr;
  const best = set.reduce((b, p) => (liq(p) > liq(b) ? p : b), set[0]);
  return best ? best.attributes.address : null;
}

async function _nxFetchPool(mint) {
  const r = await fetchWithTimeout(
    NX_GT + '/networks/solana/tokens/' + encodeURIComponent(mint) + '/pools',
    { headers: { Accept: 'application/json' } },
    7_000,
  );
  if (!r.ok) return null;
  const j = await r.json();
  return _nxPickPool(j && j.data, mint);
}

// 1-hour window: 60 × 1-minute closes, oldest → newest.
async function _nxCloses1h(pool) {
  const r = await fetchWithTimeout(
    NX_GT + '/networks/solana/pools/' + pool + '/ohlcv/minute?aggregate=1&limit=60&currency=usd',
    { headers: { Accept: 'application/json' } },
    7_000,
  );
  if (!r.ok) return null;
  const j = await r.json();
  const list = j?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length < 2) return null;
  const closes = list.map(row => Number(row[4])).filter(n => Number.isFinite(n) && n > 0).reverse();
  return closes.length >= 2 ? closes : null;
}

// Keep the last good fields — a refresh that comes back empty (rate limit, blip)
// must never wipe a pool/closes we already have. That's the whole cache promise.
function _nxMerge(prev, next) {
  if (!prev) return next;
  const ok = a => Array.isArray(a) && a.length >= 2;
  return {
    mint:   next.mint,
    pool:   next.pool   || prev.pool   || null,
    closes: ok(next.closes) ? next.closes : (prev.closes || null),
    change: next.change != null ? next.change : prev.change,
    price:  next.price  != null ? next.price  : prev.price,
  };
}

async function _nxBuildFresh(mint) {
  const pool   = await _nxFetchPool(mint).catch(() => null);
  const closes = pool ? await _nxCloses1h(pool).catch(() => null) : null;
  let change = null, price = null;
  if (Array.isArray(closes) && closes.length >= 2) {
    const a = closes[0], b = closes[closes.length - 1];
    price = b;
    if (a > 0) change = ((b - a) / a) * 100;
  }
  return { mint, pool: pool || null, closes: closes || null, change, price };
}

function _nxRefresh(mint) {
  if (_nxInflight.has(mint)) return _nxInflight.get(mint);
  const job = _nxBuildFresh(mint)
    .then(fresh => {
      const prev = _nxCache.get(mint);
      _nxCache.set(mint, { at: Date.now(), payload: _nxMerge(prev?.payload, fresh) });
      if (_nxCache.size > NX_MAX) { const k = _nxCache.keys().next().value; if (k) _nxCache.delete(k); }
      return _nxCache.get(mint).payload;
    })
    .catch(() => _nxCache.get(mint)?.payload || { mint, pool: null, closes: null, change: null, price: null })
    .finally(() => _nxInflight.delete(mint));
  _nxInflight.set(mint, job);
  return job;
}

// Stale-while-revalidate: if we have anything cached, return it immediately and
// (if old) refresh in the background; only block on a network call when the
// token is completely cold. Once a token has loaded once, it never goes blank.
async function _nxGet(mint) {
  const hit = _nxCache.get(mint);
  if (hit) {
    if (Date.now() - hit.at >= NX_FRESH_MS) _nxRefresh(mint);
    return hit.payload;
  }
  return await _nxRefresh(mint);
}

app.get('/api/nx/chart/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!NX_B58.test(mint)) return res.status(400).json({ error: 'Invalid mint' });
    return res.json(await _nxGet(mint));
  } catch (e) {
    return res.json({ mint: String(req.params.mint || ''), pool: null, closes: null, change: null, price: null });
  }
});

app.get('/api/nx/pool/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!NX_B58.test(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const p = await _nxGet(mint);
    return res.json({ mint, pool: (p && p.pool) || null });
  } catch (e) {
    return res.json({ mint: String(req.params.mint || ''), pool: null });
  }
});

// Warm the cache for a whole feed at once, so the chart is already in memory by
// the time a user taps a token. The client posts every visible mint here when a
// feed loads. Processed through a small queue at fixed concurrency so warming
// "everything" is a steady drip, not a burst that trips the rate limit. Returns
// immediately; the work happens in the background and fills _nxCache.
const NX_WARM_CONC = 4;     // max simultaneous GeckoTerminal warmups
const _nxQueue = [];
let _nxActive = 0;
function _nxDrain() {
  while (_nxActive < NX_WARM_CONC && _nxQueue.length) {
    const mint = _nxQueue.shift();
    _nxActive++;
    _nxRefresh(mint).finally(() => { _nxActive--; _nxDrain(); });
  }
}
function _nxWarm(mints) {
  const now = Date.now();
  for (const m of mints) {
    if (!NX_B58.test(m)) continue;
    const hit = _nxCache.get(m);
    if (hit && now - hit.at < NX_FRESH_MS) continue;  // already fresh
    if (_nxInflight.has(m) || _nxQueue.includes(m)) continue;  // already loading/queued
    _nxQueue.push(m);
  }
  _nxDrain();
}

app.post('/api/nx/warm', (req, res) => {
  const body = req.body || {};
  const mints = Array.isArray(body.mints)
    ? body.mints.map(String).filter(m => NX_B58.test(m)).slice(0, 300)
    : [];
  _nxWarm(mints);
  return res.json({ queued: mints.length, active: _nxActive, pending: _nxQueue.length });
});

/* ========================================================================
 * APE ENRICH — moved ABOVE app.all('/api/*') so these routes are not shadowed
 * by the 404 catch-all (previously they sat below it and returned 404).
 *
 *   GET  /api/ape/curve/:mint   -> { found, mcap, price, volume24h, liquidity, pool }
 *   POST /api/ape/enrich        -> body { mints:[...] }
 *                                  => { tokens: { <mint>: { mcap, price, volume24h, liquidity, pool } } }
 *
 * Source: GeckoTerminal's free public API (api.geckoterminal.com/api/v2),
 * the same charts the token sheet embeds. Verified token fields:
 *   market_cap_usd, fdv_usd, price_usd, volume_usd.h24, total_reserve_in_usd,
 *   and relationships.top_pools (used to resolve the pool for the chart embed).
 * No pump.fun curve math, no estimated constants — every number is a field
 * GeckoTerminal returns. `pool` lets the client embed the GeckoTerminal chart.
 *
 * Own cache + own helpers. Reuses only fetchWithTimeout (defined far above).
 * Fails soft: returns { found:false } / {} rather than an error status, so the
 * client simply keeps whatever it already has. No existing route is touched.
 * ===================================================================== */
const GT_BASE        = 'https://api.geckoterminal.com/api/v2';
const APE_BASE58_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const APE_TTL_MS     = 20_000;
const GT_MULTI_MAX   = 30; // GeckoTerminal's per-call address limit
const _apeCache = new Map(); // mint -> { at, v }

function _apeShapeGt(d) {
  if (!d || !d.attributes) return null;
  const a = d.attributes;
  const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; } return 0; };
  let pool = null;
  const tp = d.relationships && d.relationships.top_pools && d.relationships.top_pools.data;
  if (Array.isArray(tp) && tp[0] && typeof tp[0].id === 'string') pool = tp[0].id.replace(/^solana_/, '');
  return {
    mcap:      num(a.market_cap_usd, a.fdv_usd),
    price:     num(a.price_usd),
    volume24h: num(a.volume_usd && a.volume_usd.h24),
    liquidity: num(a.total_reserve_in_usd),
    pool:      pool,
  };
}

function _apeGetCached(mint) { const h = _apeCache.get(mint); return (h && (Date.now() - h.at) < APE_TTL_MS) ? h.v : null; }
function _apeSet(mint, v) { _apeCache.set(mint, { at: Date.now(), v }); _capMap(_apeCache, _APE_CACHE_MAX); }

async function _apeFetchToken(mint) {
  try {
    const r = await fetchWithTimeout(
      GT_BASE + '/networks/solana/tokens/' + encodeURIComponent(mint),
      { headers: { Accept: 'application/json' } },
      7_000,
    );
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return _apeShapeGt(j && j.data);
  } catch (e) { return null; }
}

async function _apeFetchMulti(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += GT_MULTI_MAX) {
    const chunk = mints.slice(i, i + GT_MULTI_MAX);
    try {
      const r = await fetchWithTimeout(
        GT_BASE + '/networks/solana/tokens/multi/' + chunk.map(encodeURIComponent).join(','),
        { headers: { Accept: 'application/json' } },
        9_000,
      );
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const arr = (j && Array.isArray(j.data)) ? j.data : [];
      for (const d of arr) {
        const addr = d && d.attributes && d.attributes.address;
        const shaped = _apeShapeGt(d);
        if (addr && shaped) out[addr] = shaped;
      }
    } catch (e) { /* skip this chunk */ }
  }
  return out;
}

async function _apeCurve(mint) {
  const c = _apeGetCached(mint);
  if (c) return c;
  const shaped = await _apeFetchToken(mint);
  const v = shaped ? { found: true, ...shaped } : { found: false };
  _apeSet(mint, v);
  return v;
}

app.get('/api/ape/curve/:mint', async (req, res) => {
  try {
    const mint = String(req.params.mint || '');
    if (!APE_BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });
    return res.json({ mint, ...(await _apeCurve(mint)) });
  } catch (e) {
    return res.json({ mint: String(req.params.mint || ''), found: false });
  }
});

app.post('/api/ape/enrich', async (req, res) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body.mints) ? body.mints : [];
    const mints = [...new Set(list.map(String).filter(m => APE_BASE58_RE.test(m)))].slice(0, 90);
    const tokens = {};
    const misses = [];
    for (const m of mints) {
      const c = _apeGetCached(m);
      if (c) { if (c.found) tokens[m] = { mcap: c.mcap, price: c.price, volume24h: c.volume24h, liquidity: c.liquidity, pool: c.pool }; }
      else misses.push(m);
    }
    if (misses.length) {
      const fetched = await _apeFetchMulti(misses);
      for (const m of misses) {
        const shaped = fetched[m] || null;
        const v = shaped ? { found: true, ...shaped } : { found: false };
        _apeSet(m, v);
        if (v.found) tokens[m] = { mcap: v.mcap, price: v.price, volume24h: v.volume24h, liquidity: v.liquidity, pool: v.pool };
      }
    }
    return res.json({ tokens });
  } catch (e) {
    return res.json({ tokens: {} });
  }
});

/* ========================================================================
 * NEXUS DISCOVER — added section (self-contained; nothing else is modified).
 *
 * Place this block IMMEDIATELY BEFORE  app.all('/api/*', ...)  so it is not
 * shadowed by that 404 catch-all. It must sit AFTER the NEXUS CHARTS and
 * APE ENRICH sections because it reuses helpers defined there.
 *
 * Gives the Discover page fast, ready-to-render, server-sorted token lists for
 * its four filters, plus a single batched sparkline call so the feed never
 * makes one request per row.
 *
 *   GET  /api/nx/discover?lens=popular|hot|new|gainers&limit=80
 *        -> { lens, tokens: [ normalized token, ... ] }
 *
 *        popular -> Jupiter top-organic, sorted by mcap, liquidity floor
 *                   (the established / obvious Solana tokens)
 *        hot     -> Jupiter top-organic, sorted by momentum
 *                   (24h volume ÷ mcap, blended with organicScore)
 *        gainers -> Jupiter top-organic, sorted by 24h price change
 *        new     -> Jupiter recent (freshest mints), newest first
 *
 *   POST /api/nx/discover-spark   body { mints: [...] }
 *        -> { sparks: { <mint>: { closes:[...], change, price } }, pending:[...] }
 *
 *        Returns every sparkline series already warm in _nxCache in ONE call.
 *        Cold mints are queued (background) via the existing _nxWarm drip and
 *        returned in `pending` so the client can poll again shortly. This turns
 *        N per-row chart calls into a single request that hits warm cache.
 *
 * Reuses ONLY existing helpers: fetchWithTimeout, getCachedJson, setCachedJson,
 * _normalizeJupToken, _nxCache, _nxWarm, NX_B58, JUPITER_TOKENS_BASE. All new
 * names are prefixed _nxd to avoid collisions. No existing route is touched.
 * ===================================================================== */
const _NXD_LIMIT_DEFAULT = 80;
const _NXD_LIMIT_MAX     = 120;
const _NXD_TTL_ORGANIC   = 30_000;  // matches /api/dex/discover organic cache
const _NXD_TTL_NEW       = 5_000;   // fresh mints move fast
const _NXD_POPULAR_LIQ   = 25_000;  // "established" liquidity floor (USD)
const _NXD_POPULAR_MCAP  = 1_000_000;

// Fetch + normalize a Jupiter v2 ranked list (same upstreams /api/dex/discover
// uses). Cached under its own key so popular/hot/gainers share one organic
// fetch instead of hitting Jupiter three times.
async function _nxdFetchList(kind) {
  const cacheKey = 'nxd:src:' + kind;
  const cached = getCachedJson(cacheKey);
  if (cached) return cached.payload;

  const upstream = (kind === 'new')
    ? `${JUPITER_TOKENS_BASE}/recent`
    : `${JUPITER_TOKENS_BASE}/toporganicscore/24h`;

  let tokens = [];
  try {
    const r = await fetchWithTimeout(upstream, { headers: { Accept: 'application/json' } }, 12_000);
    if (r.ok) {
      const d = await r.json();
      const raw = Array.isArray(d) ? d : (d && Array.isArray(d.tokens) ? d.tokens : (d && Array.isArray(d.data) ? d.data : []));
      tokens = raw.map(_normalizeJupToken).filter(Boolean)
        .filter(t => t.mint !== 'So11111111111111111111111111111111111111112'
                  && t.sym !== 'SOL' && t.sym !== 'WSOL');
    }
  } catch (e) { /* fail soft → empty list */ }

  setCachedJson(cacheKey, 200, tokens, kind === 'new' ? _NXD_TTL_NEW : _NXD_TTL_ORGANIC);
  return tokens;
}

// Momentum proxy: how much it's traded relative to its size, nudged by
// Jupiter's organic score. Not a true rolling-momentum engine, but it
// surfaces "being actively traded right now" distinctly from raw % gainers.
function _nxdHotScore(t) {
  const mc = t.mcap > 0 ? t.mcap : (t.fdv || 0);
  const volRatio = mc > 0 ? (t.volume24h || 0) / mc : 0;
  return volRatio * 100 + (Number(t.organicScore) || 0);
}

app.get('/api/nx/discover', async (req, res) => {
  try {
    const lens  = String(req.query.lens || 'hot').toLowerCase();
    const limit = Math.min(_NXD_LIMIT_MAX, Math.max(10, Number(req.query.limit) || _NXD_LIMIT_DEFAULT));

    const cacheKey = 'nxd:list:' + lens + ':' + limit;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    let tokens;
    if (lens === 'new') {
      tokens = (await _nxdFetchList('new')).slice()
        .sort((a, b) => (b.pairCreatedAtMs || 0) - (a.pairCreatedAtMs || 0));
    } else {
      const src = await _nxdFetchList('organic');
      if (lens === 'popular') {
        tokens = src
          .filter(t => (t.liquidity || 0) >= _NXD_POPULAR_LIQ || (t.mcap || 0) >= _NXD_POPULAR_MCAP)
          .sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
      } else if (lens === 'gainers') {
        tokens = src
          .filter(t => Number.isFinite(t.change))
          .sort((a, b) => (b.change || 0) - (a.change || 0));
      } else { // hot (default)
        tokens = src.slice().sort((a, b) => _nxdHotScore(b) - _nxdHotScore(a));
      }
    }

    tokens = tokens.slice(0, limit);

    // Pre-warm sparklines for the whole list in the background (steady drip via
    // the existing NEXUS CHARTS queue), so the batch-spark call below hits cache.
    try { _nxWarm(tokens.map(t => t.mint)); } catch (e) {}

    const payload = { lens, tokens };
    setCachedJson(cacheKey, 200, payload, lens === 'new' ? _NXD_TTL_NEW : _NXD_TTL_ORGANIC);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Discover lens timed out' });
    logError('nxd-discover', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/nx/discover-spark', async (req, res) => {
  try {
    const body  = req.body || {};
    const mints = Array.isArray(body.mints)
      ? [...new Set(body.mints.map(String).filter(m => NX_B58.test(m)))].slice(0, _NXD_LIMIT_MAX)
      : [];

    const sparks = {};
    const pending = [];
    for (const m of mints) {
      const hit = _nxCache.get(m);
      const p = hit && hit.payload;
      if (p && Array.isArray(p.closes) && p.closes.length >= 2) {
        sparks[m] = { closes: p.closes, change: p.change, price: p.price };
      } else {
        pending.push(m);
      }
    }

    // Queue the cold ones; they'll be warm on the next poll. Non-blocking, so
    // this endpoint always returns instantly with whatever is already cached.
    if (pending.length) { try { _nxWarm(pending); } catch (e) {} }

    return res.json({ sparks, pending });
  } catch (e) {
    logError('nxd-discover-spark', e);
    return res.json({ sparks: {}, pending: [] });
  }
});


app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.path }));

/* ========================================================================
 * Embed runtime config
 * ===================================================================== */
app.get('/embed/config.js', (req, res) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  const cfg = {
    rpc: `${origin}/api/solana-rpc`,
    wcProjectId: process.env.WALLETCONNECT_PROJECT_ID
              || process.env.REACT_APP_WALLETCONNECT_PROJECT_ID
              || '',
  };
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send('window.__VERIXIA_CONFIG__=' + JSON.stringify(cfg) + ';');
});

/* ========================================================================
 * SEO slug pages + SW killer + Static SPA  (INLINE — no external file)
 *
 * - Kills any stale CRA service worker stuck in browsers (tombstone SW
 *   served at common paths; activates → unregisters → clears caches).
 * - Self-hosts @solana/web3.js so SEO HTML doesn't need jsdelivr/unpkg
 *   (which CSP may block).
 * - Serves /<slug> and /<slug>/index.html from public/<slug>/index.html
 *   (falls back to build/<slug>/index.html), injecting the SW-killer
 *   script + the self-hosted web3.js script tag into <head>.
 * ===================================================================== */

const SEO_TOMBSTONE_SW = `// Verixia SW tombstone
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try { const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach(c => { try { c.navigate(c.url); } catch (e) {} }); } catch (e) {}
  })());
});
self.addEventListener('fetch', () => {});
`;

const SEO_SW_UNREG = `<script>(function(){try{if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){try{r.unregister();}catch(e){}});}).catch(function(){});}if(window.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){try{caches.delete(k);}catch(e){}});}).catch(function(){});}}catch(e){}})();</script>`;

let SEO_WEB3_PATH = null;
for (const p of [
  path.join(__dirname, 'node_modules', '@solana', 'web3.js', 'lib', 'index.iife.min.js'),
  path.join(__dirname, 'node_modules', '@solana', 'web3.js', 'lib', 'index.iife.js'),
]) {
  try { if (fs.existsSync(p)) { SEO_WEB3_PATH = p; break; } } catch {}
}
const SEO_WEB3_TAG = SEO_WEB3_PATH ? '<script src="/solana-web3.iife.min.js"></script>' : '';

// SW tombstone routes
for (const swPath of ['/service-worker.js', '/sw.js', '/serviceWorker.js']) {
  app.get(swPath, (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(SEO_TOMBSTONE_SW);
  });
}

// Self-hosted Solana web3.js
if (SEO_WEB3_PATH) {
  app.get('/solana-web3.iife.min.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.sendFile(SEO_WEB3_PATH);
  });
  console.log('[seo] serving solana-web3.js from', SEO_WEB3_PATH);
} else {
  console.warn('[seo] @solana/web3.js not in node_modules — widget will fall back to CDN');
}

// Debug
app.get('/debug-seo', (req, res) => {
  const publicDir = path.join(__dirname, 'public');
  const buildDir  = path.join(__dirname, 'build');
  const out = { __dirname, publicDir, buildDir, publicExists: false, buildExists: false, publicFolders: [], buildFolders: [], web3Available: !!SEO_WEB3_PATH };
  try {
    out.publicExists = fs.existsSync(publicDir);
    if (out.publicExists) out.publicFolders = fs.readdirSync(publicDir).filter(n => { try { return fs.statSync(path.join(publicDir, n)).isDirectory(); } catch { return false; } });
  } catch (e) { out.publicError = e.message; }
  try {
    out.buildExists = fs.existsSync(buildDir);
    if (out.buildExists) out.buildFolders = fs.readdirSync(buildDir).filter(n => { try { return fs.statSync(path.join(buildDir, n)).isDirectory(); } catch { return false; } });
  } catch (e) { out.buildError = e.message; }
  res.json(out);
});

// SEO slug handler (matches /slug, /slug/, /slug/index.html)
const SEO_SLUG_RE = /^\/([a-z0-9][a-z0-9-]*)(?:\/(?:index\.html)?)?$/i;
const SEO_RESERVED = new Set([
  'api', 'health', 'embed', 'debug-seo', 'static', 'assets',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json',
  'service-worker.js', 'sw.js', 'serviceWorker.js',
  'og', 'images', 'fonts', 'solana-web3.iife.min.js',
]);

app.get(SEO_SLUG_RE, (req, res, next) => {
  const slug = (req.params[0] || '').toLowerCase();
  if (!slug || SEO_RESERVED.has(slug)) return next();

  const candidates = [
    path.join(__dirname, 'public', slug, 'index.html'),
    path.join(__dirname, 'build',  slug, 'index.html'),
  ];

  (function tryNext(i) {
    if (i >= candidates.length) return next();
    fs.readFile(candidates[i], 'utf8', (err, html) => {
      if (err) return tryNext(i + 1);
      const injection = '\n' + SEO_SW_UNREG + '\n' + SEO_WEB3_TAG + '\n';
      let out = html;
      if (/<head[^>]*>/i.test(out)) {
        out = out.replace(/<head[^>]*>/i, (m) => m + injection);
      } else if (/<html[^>]*>/i.test(out)) {
        out = out.replace(/<html[^>]*>/i, (m) => m + '\n<head>' + injection + '</head>');
      } else {
        out = injection + out;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Clear-Site-Data', '"cache", "storage"');
      res.send(out);
    });
  })(0);
});

// Static files from React build
app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

// Fallback static from public/
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

// SPA catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

/* ========================================================================
 * Error handling
 * ===================================================================== */
app.use((err, req, res, next) => {
  if (err?.message?.startsWith('Not allowed by CORS'))
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  if (err?.type === 'entity.too.large' || err?.status === 413)
    return res.status(413).json({ error: 'Request body too large' });
  if (err?.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  logError('unhandled', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

/* ========================================================================
 * Boot
 * ===================================================================== */
process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Nexus DEX server on port ' + PORT);
  console.log('  env: ' + NODE_ENV);
  console.log('  Jupiter Swap V2: ' + JUPITER_SWAP_V2_BASE + (JUPITER_API_KEY ? ' (main key set)' : ' (no main key)') + (JUPITER_API_KEY_SEO ? ' (SEO key set)' : ' (no SEO key)'));
  console.log('  Jupiter Price:   ' + JUPITER_PRICE_BASE);
  console.log('  Chainflip:       mainnet (SOL → BTC, broker commission disabled)');
  if (SOLANA_NETWORK === 'devnet') {
    console.log('  Solana RPC:      devnet' + (DEVNET_RPC_URL ? ' (set)' : ' (NOT SET — set DEVNET_RPC_URL)') + ' — no fallback');
    console.log('  Trade RPC:       devnet only → /api/trade-rpc');
  } else {
    console.log('  Solana RPC:      alchemy mainnet' + (ALCHEMY_RPC_URL ? ' (set)' : ' (NOT SET — set ALCHEMY_RPC_URL)') + ' — no fallback');
    console.log('  Trade RPC:       alchemy primary' + (ANKR_RPC_URL ? ' + ankr fallback' : ' (ANKR_RPC_URL not set — no fallback)') + ' → /api/trade-rpc');
  }
  console.log('  Rate limits:     none (removed)');
  console.log('  Allowed origins: ' + allowedOrigins.join(', '));
});
 