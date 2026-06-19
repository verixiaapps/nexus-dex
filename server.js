require('dotenv').config();
 
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

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
    // Solana RPC — Alchemy. Client only talks to /api/solana-rpc (same-origin),
    // so the Alchemy host does NOT need to be in connect-src.
    'https://explorer-api.walletconnect.com',
    'https://*.walletconnect.com', 'https://*.walletconnect.org',
    'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org',
    'wss://*.walletconnect.com', 'wss://*.walletconnect.org',
    'wss://www.walletlink.org',
    'https://public.chainalysis.com',
    'wss://pumpportal.fun',           // Launch Radar — pump.fun new-token stream
    'https://pumpportal.fun',         // Launch Radar — pump.fun trade-local endpoint
    // DexScreener intentionally NOT here. All client calls go through our
    // proxy at /api/dex/* so we control caching and load. Direct client
    // hits + server proxy hits would double our load on DexScreener.
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

// Solana RPC — Alchemy. URLs hardcoded with API key embedded, so the server
// just works on a fresh deploy with zero env setup. The key NEVER leaves this
// file: client code hits /api/solana-rpc (same-origin) and the server proxies.
//
// To switch to devnet:    set SOLANA_NETWORK=devnet
// To override entirely:   set DRPC_RPC_URL (legacy var name, kept for compat)
const ALCHEMY_MAINNET_URL = 'https://solana-mainnet.g.alchemy.com/v2/3iScOZl86KTeWqY8qisKC';
const ALCHEMY_DEVNET_URL  = 'https://solana-devnet.g.alchemy.com/v2/3iScOZl86KTeWqY8qisKC';
const SOLANA_NETWORK      = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
const DRPC_RPC_URL        = (process.env.DRPC_RPC_URL || '').trim() ||
  (SOLANA_NETWORK === 'devnet' ? ALCHEMY_DEVNET_URL : ALCHEMY_MAINNET_URL);

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
 * Bot blocker — kills the easy ways free-tier RPC quota gets drained.
 * Applies to /api/ only. Allows /api/health for monitoring.
 * ===================================================================== */
const BOT_UA_RE = /bot|crawl|spider|scrape|headless|curl|wget|python-requests|axios|httpclient|java\/|ruby|go-http|okhttp|libwww|phantomjs|puppeteer|playwright/i;
app.use('/api/', (req, res, next) => {
  if (req.path === '/health') return next();
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || BOT_UA_RE.test(ua)) return res.status(403).json({ error: 'Forbidden' });
  next();
});

/* ========================================================================
 * Rate limiting
 *
 * The global /api/ limiter applies to everything EXCEPT /api/solana-rpc and
 * /api/health. /api/solana-rpc is excluded because a single Ape trade
 * confirmation polls the RPC ~95 times — a 600/min cap on that path will
 * block a real user mid-trade. The bot UA blocker above is the real defense
 * against abuse; the limiter just catches misbehaving scripts.
 *
 * /api/solana-rpc gets its own much higher limit (3000/min ≈ 50/s) which is
 * generous enough for normal use but still catches runaway loops.
 * ===================================================================== */
// Rate limiters disabled per request. Bot UA blocker above is sole defense.

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
    // dRPC URLs (legacy)
    .replace(/(lb\.drpc\.(?:live|org)\/)[^\s"'?]+/gi,     '$1***/***')
    // Alchemy URLs — strip the API key segment after /v2/
    .replace(/(solana-(?:mainnet|devnet)\.g\.alchemy\.com\/v2\/)[^\s"'?]+/gi, '$1***')
    .replace(/x-api-key["':\s]+[^&\s"',}]+/gi,            'x-api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,                'Bearer ***');
}

function logError(tag, err) {
  const msg = scrubSecrets(err?.message ?? err);
  if (NODE_ENV === 'production') console.warn(`[${tag}]`, msg);
  else console.error(`[${tag}]`, msg, err?.stack ? '\n' + scrubSecrets(err.stack) : '');
}

// Sampled warning — at most once per `intervalMs` per `key`. Use for upstream
// failures that can repeat thousands of times an hour (Cloudflare throttling,
// rate-limited APIs). Logging every occurrence drowns the logs; logging the
// FIRST one only blinds you the next time it breaks. This logs once per
// minute so persistent issues stay visible.
const _warnTs = new Map();
function warnSampled(key, intervalMs, ...args) {
  const now = Date.now();
  const last = _warnTs.get(key) || 0;
  if (now - last < intervalMs) return;
  _warnTs.set(key, now);
  console.warn(...args);
  if (_warnTs.size > 200) { const k = _warnTs.keys().next().value; if (k) _warnTs.delete(k); }
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

/* ========================================================================
 * Launch Radar — LIVE feed via PumpPortal WebSocket
 * ===================================================================== */
const _LR_DEX_BASE     = 'https://api.dexscreener.com';
const _LR_PUMP_WS_URL  = 'wss://pumpportal.fun/api/data';
const _LR_PUMP_DEX_IDS = new Set(['pumpfun', 'pumpswap']);
const _LR_BASE58_RE    = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const _LR_BUFFER_MAX   = 200;
const _LR_FEED_LIMIT   = 30;
const _LR_CACHE_MS     = 1_000;

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
    } catch { /* malformed frame — ignore */ }
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
const _LR_PF_CACHE_MS = 10_000;
const _lrPfCache  = new Map();

async function _lrFetchPumpInfo(mint, solPriceUsd) {
  const hit = _lrPfCache.get(mint);
  if (hit && Date.now() - hit.ts < _LR_PF_CACHE_MS) return hit;
  try {
    const r = await fetchWithTimeout(
      _LR_PF_BASE + '/' + encodeURIComponent(mint),
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
      6_000,
    );
    if (!r.ok) {
      warnSampled('lr-pf:' + r.status, 60_000, '[lr-pf] non-OK from pump.fun:', r.status, '(Cloudflare / rate limit, sampled)');
      // Negative-cache the failure briefly so we don't hammer Cloudflare with
      // the same mint. 10s is short enough that genuine flaps recover.
      const out = { holders: 0, liquidityUsd: 0, imageUrl: null, ts: Date.now() - (_LR_PF_CACHE_MS - 10_000) };
      _lrPfCache.set(mint, out);
      return null;
    }
    const d = await r.json();
    if (!d || typeof d !== 'object' || d.mint !== mint) {
      warnSampled('lr-pf:mismatch', 60_000, '[lr-pf] mint mismatch — expected', mint, 'got', d?.mint);
      return null;
    }
    const holders = Number(d.holder_count ?? d.num_holders ?? d.holders ?? 0) || 0;
    const imageUrl = (typeof d.image_uri === 'string' && d.image_uri) ||
                     (typeof d.image     === 'string' && d.image)     || null;
    let liquidityUsd = 0;
    const vSol = Number(d.virtual_sol_reserves ?? d.virtualSolReserves ?? 0);
    if (vSol > 0 && solPriceUsd > 0) {
      liquidityUsd = (vSol / 1e9) * solPriceUsd * 2;
    }
    const out = { holders, liquidityUsd, imageUrl, ts: Date.now() };
    _lrPfCache.set(mint, out);
    return out;
  } catch (e) {
    warnSampled('lr-pf:fetch', 60_000, '[lr-pf] fetch failed:', e?.message);
    return null;
  }
}

const _LR_META_CACHE_MS = 5 * 60_000;
const _lrMetaCache = new Map();

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
      return null;
    }
    const d = await r.json();
    const image = (typeof d?.image     === 'string' && d.image)     ||
                  (typeof d?.image_url === 'string' && d.image_url) ||
                  (typeof d?.imageUrl  === 'string' && d.imageUrl)  || null;
    _lrMetaCache.set(uri, { image, ts: Date.now() });
    return image;
  } catch (e) {
    _lrMetaCache.set(uri, { image: null, ts: Date.now() });
    warnSampled('lr-meta:fetch', 60_000, '[lr-meta] fetch failed:', e?.message);
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
  if (now - _solPriceCache.ts < 5_000 && _solPriceCache.p > 0) return _solPriceCache.p;
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

/* ========================================================================
 * Whale events — real recent large trades via GeckoTerminal (no key)
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
 * Solana RPC — Alchemy (single endpoint, no fallbacks)
 *
 * Solana RPC providers don't accept batched JSON-RPC arrays. The client
 * (GetStarted.jsx portfolio load) sends 3 calls per refresh as an array, so
 * we unroll batches into parallel single requests, then reassemble the
 * response as an array. Single requests pass through untouched.
 * ===================================================================== */
const RPC_TIMEOUT_MS = 10_000;

function getSolanaRpcUrl() {
  return DRPC_RPC_URL;
}

async function _drpcSingle(single) {
  const id = single?.id ?? null;
  try {
    const r = await fetchWithTimeout(
      DRPC_RPC_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(single) },
      RPC_TIMEOUT_MS,
    );
    const text = await r.text();
    if (!r.ok) {
      // Attach the upstream status so forwardRpc can elevate it to the
      // envelope's HTTP status. Without this, an Alchemy 429 here gets
      // wrapped into a JSON-RPC error and the whole batch returns 200,
      // hiding the throttle from the client (which then keeps hammering).
      return {
        jsonrpc: '2.0', id,
        error: { code: r.status, message: 'RPC HTTP ' + r.status + ': ' + text.slice(0, 200) },
        __httpStatus: r.status,
      };
    }
    try { return JSON.parse(text); }
    catch { return { jsonrpc: '2.0', id, error: { code: -32700, message: 'Non-JSON response from upstream' } }; }
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e?.message || e) } };
  }
}

async function forwardRpc(body) {
  if (!DRPC_RPC_URL) {
    const err = new Error('Solana RPC URL is not configured');
    err.status = 500;
    throw err;
  }

  // Batched request → split into parallel singles, reassemble as array.
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(_drpcSingle));
    // If any batch element hit a non-2xx upstream, elevate the worst status
    // to the envelope. 429 takes priority so clients with Retry-After logic
    // see it; otherwise the most common non-2xx wins.
    let worst = 200;
    for (const r of results) {
      const s = r && r.__httpStatus;
      if (!s) continue;
      if (s === 429) { worst = 429; break; }
      if (s >= 500 && worst < 500) worst = s;
      else if (s >= 400 && worst < 400) worst = s;
    }
    // Strip the internal marker before returning to the client.
    for (const r of results) { if (r) delete r.__httpStatus; }
    return { status: worst, parsed: results, raw: null };
  }

  // Single request — original path.
  const r = await fetchWithTimeout(
    DRPC_RPC_URL,
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
      solanaRpc:      Boolean(DRPC_RPC_URL),
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
      provider:  'alchemy',
      network:   SOLANA_NETWORK,
      urlSet:    Boolean(DRPC_RPC_URL),
      timeoutMs: RPC_TIMEOUT_MS,
      batching:  'server-side unroll',
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
const PUMP_PRIORITY_FEE = 0.0001;

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
    setCachedJson(cacheKey, 200, payload, 2_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener token timed out' });
    logError('dex-token', e);
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
    setCachedJson(cacheKey, 200, payload, 5_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener sol-price timed out' });
    logError('dex-sol-price', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/pumpfun/trade', async (req, res) => {
  try {
    const b = req.body || {};
    const action = b.action;
    if (action !== 'buy' && action !== 'sell')
      return res.status(400).json({ error: 'action must be buy or sell' });
    if (!b.mint || !PUMP_BASE58_RE.test(String(b.mint)))
      return res.status(400).json({ error: 'Invalid mint' });
    if (!b.user || !PUMP_BASE58_RE.test(String(b.user)))
      return res.status(400).json({ error: 'Invalid user' });
    if (b.amount == null) return res.status(400).json({ error: 'Missing amount' });

    let amountStr, denominatedInSol;
    if (action === 'buy') {
      const lamports = BigInt(String(b.amount));
      if (lamports <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });
      amountStr = (Number(lamports) / 1e9).toFixed(9);
      denominatedInSol = 'true';
    } else {
      const raw = BigInt(String(b.amount));
      if (raw <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });
      const decimals = Number(b.decimals ?? 6);
      amountStr = (Number(raw) / Math.pow(10, decimals)).toString();
      denominatedInSol = 'false';
    }

    const r = await fetchWithTimeout(
      PUMPPORTAL_URL,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream, application/json' },
        body:    JSON.stringify({
          publicKey:        b.user,
          action,
          mint:             b.mint,
          amount:           amountStr,
          denominatedInSol,
          slippage:         PUMP_SLIPPAGE_PCT,
          priorityFee:      PUMP_PRIORITY_FEE,
          pool:             b.pool || 'auto',
        }),
      },
      15_000,
    );

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      logError('pumpfun-trade', new Error('PumpPortal HTTP ' + r.status + ': ' + text.slice(0, 200)));
      const lower = text.toLowerCase();
      if (lower.includes('not a pump') || lower.includes('invalid mint') || lower.includes('not found'))
        return res.status(404).json({ error: 'Not a pump.fun token (PumpPortal does not support this mint).' });
      if (lower.includes('insufficient'))
        return res.status(400).json({ error: 'Not enough SOL for this trade + fees.' });
      return res.status(r.status).json({ error: 'PumpPortal: ' + (text.slice(0, 200) || r.statusText) });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) return res.status(502).json({ error: 'PumpPortal returned empty body.' });

    return res.json({
      action,
      route:       'pumpportal',
      pool:        b.pool || 'auto',
      slippagePct: PUMP_SLIPPAGE_PCT,
      priorityFee: PUMP_PRIORITY_FEE,
      tx:          buf.toString('base64'),
    });
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'PumpPortal timed out' });
    logError('pumpfun-trade', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * Launch Radar — Jupiter Ultra V3 proxy (Iris router; pre-grad bonding curves)
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
    const { quote, destAddress, refundAddress } = req.body || {};
    if (!quote || typeof quote !== 'object')                 return res.status(400).json({ error: 'quote required' });
    if (!destAddress   || typeof destAddress   !== 'string') return res.status(400).json({ error: 'destAddress required'   });
    if (!refundAddress || typeof refundAddress !== 'string') return res.status(400).json({ error: 'refundAddress required' });
    if (quote.type !== 'REGULAR')                            return res.status(400).json({ error: 'REGULAR quote required' });

    const channel = await chainflipSdk.requestDepositAddressV2({
      quote,
      destAddress,
      fillOrKillParams: {
        refundAddress,
        retryDurationBlocks: 150,
        slippageTolerancePercent: Number(quote.recommendedSlippageTolerancePercent ?? 3),
        livePriceSlippageTolerancePercent: quote.recommendedLivePriceSlippageTolerancePercent,
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
    const { quote, destAddress, refundAddress } = req.body || {};
    if (!quote || typeof quote !== 'object')                 return res.status(400).json({ error: 'quote required' });
    if (!destAddress   || typeof destAddress   !== 'string') return res.status(400).json({ error: 'destAddress required'   });
    if (!refundAddress || typeof refundAddress !== 'string') return res.status(400).json({ error: 'refundAddress required' });
    if (quote.type !== 'REGULAR')                            return res.status(400).json({ error: 'REGULAR quote required' });

    const channel = await _cfMulti.requestDepositAddressV2({
      quote,
      destAddress,
      fillOrKillParams: {
        refundAddress,
        retryDurationBlocks: 150,
        slippageTolerancePercent: Number(quote.recommendedSlippageTolerancePercent ?? 1),
        livePriceSlippageTolerancePercent: quote.recommendedLivePriceSlippageTolerancePercent,
      },
    });

    return res.json({
      channel: {
        depositChannelId:    channel.depositChannelId,
        depositAddress:      channel.depositAddress,
        srcChain:            channel.srcChain,
        srcAsset:            channel.srcAsset,
        destChain:           channel.destChain,
        destAsset:           channel.destAsset,
        srcChainExpiryBlock: String(channel.depositChannelExpiryBlock),
        channelOpeningFee:   String(channel.channelOpeningFee),
        estimatedExpiryTime: channel.estimatedDepositChannelExpiryTime ?? null,
        brokerCommissionBps: channel.brokerCommissionBps,
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
 * Referrals + honeypot check — mounted from ./referrals.js
 * Routes: /api/ref/{register,lookup,log-trade,stats,leaderboard,pnl}
 *         /api/honeypot-check/:mint
 *         /share/:wallet
 * ===================================================================== */
require('./referrals')(app, { rpcUrl: DRPC_RPC_URL });

/* ========================================================================
 * Debug endpoint removed. Was open to anyone, enumerated wallets through
 * the RPC bucket, and leaked (scrubbed) infra details. If you need it back
 * for diagnosis, gate it behind a header check against a server-only secret.
 * ===================================================================== */

app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.path }));

/* ========================================================================
 * Embed runtime config
 *
 * FIXED: emits an ABSOLUTE URL for `rpc`. Previously this was the relative
 * path '/api/solana-rpc', which fails when fed to `new Connection()` /
 * `<ConnectionProvider endpoint=...>` from @solana/web3.js — web3.js does
 * `new URL(endpoint)` internally and rejects anything that isn't http(s).
 *
 * The Alchemy API key still never leaves the server — the client just
 * hits the same-origin proxy at /api/solana-rpc.
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
 * robots.txt — served from the server so it survives frontend rebuilds and
 * can be edited without redeploying the SPA. Allows Googlebot to fetch the
 * JS/CSS bundles it needs to render the app (otherwise SEO tanks on SPAs),
 * blocks API + embed (no value indexing JSON), and blocks /share/:wallet
 * (don't want every KOL's referral URL in Google's index).
 * ===================================================================== */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Disallow: /api/\n' +
    'Disallow: /embed/\n' +
    'Disallow: /share/\n' +
    'Allow: /\n'
  );
});

/* ========================================================================
 * Static SPA
 * ===================================================================== */
app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
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
  console.log('  Solana RPC:      alchemy ' + SOLANA_NETWORK + ' (key embedded, batches unrolled server-side)');
  console.log('  Rate limits:     global 2000/min · /api/solana-rpc 3000/min (separate bucket)');
  console.log('  Allowed origins: ' + allowedOrigins.join(', '));
});
