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
    'https://li.quest',
    'https://api.mainnet-beta.solana.com', 'https://mainnet.helius-rpc.com', 'https://*.helius-rpc.com',
    'https://*.publicnode.com', 'https://*.drpc.org',
    'https://explorer-api.walletconnect.com',
    'https://*.walletconnect.com', 'https://*.walletconnect.org',
    'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org',
    'wss://*.walletconnect.com', 'wss://*.walletconnect.org',
    'wss://www.walletlink.org',
    'https://public.chainalysis.com',
    'wss://pumpportal.fun',           // Launch Radar — pump.fun new-token stream
    'https://pumpportal.fun',         // Launch Radar — pump.fun trade-local endpoint
    'https://api.dexscreener.com',    // Launch Radar — DexScreener enrichment
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

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC     || '';

const LIFI_API     = 'https://li.quest/v1';
const LIFI_API_KEY = process.env.LIFI_API_KEY || '';

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

const apiLimiter = rateLimit({
  windowMs: 60_000, max: 600,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
  skip: r => r.path === '/health' || r.path === '/api/health',
});
app.use('/api/', apiLimiter);

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
    .replace(/api-key=[^&\s"']+/gi,             'api-key=***')
    .replace(/x-api-key["':\s]+[^&\s"',}]+/gi,  'x-api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,      'Bearer ***');
}

function logError(tag, err) {
  const msg = scrubSecrets(err?.message ?? err);
  if (NODE_ENV === 'production') console.warn(`[${tag}]`, msg);
  else console.error(`[${tag}]`, msg, err?.stack ? '\n' + scrubSecrets(err.stack) : '');
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
 * Alpha — fresh-wallet convergence detector
 * (requires ./alpha-watcher.js at the same folder and `npm install ws`)
 * ===================================================================== */
const alpha = require('./alpha-watcher');
alpha.mountRoutes(app);
app.get('/nexus-dex/index.html', (req, res) => res.sendFile(path.join(__dirname, 'alpha.html')));
app.get('/nexus-dex',            (req, res) => res.sendFile(path.join(__dirname, 'alpha.html')));

/* ========================================================================
 * LI.FI
 * ===================================================================== */
function buildLifiHeaders() {
  const h = { Accept: 'application/json' };
  if (LIFI_API_KEY) h['x-lifi-api-key'] = LIFI_API_KEY;
  return h;
}

app.get('/api/lifi/tokens', async (req, res) => {
  try {
    const qs = queryStringOf(req);
    const cacheKey = 'lifi:tokens' + qs;
    const c = getCachedJson(cacheKey);
    if (c) return res.status(c.status).json(c.payload);
    const r = await fetchWithTimeout(`${LIFI_API}/tokens${qs}`, { headers: buildLifiHeaders() }, 20_000);
    const result = await safeJson(r);
    if (r.ok && result.parsed !== null) setCachedJson(cacheKey, r.status, result.parsed, 300_000);
    return respondJsonOrError(res, r, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LI.FI tokens timed out' });
    logError('lifi-tokens', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/lifi/chains', async (req, res) => {
  try {
    const qs = queryStringOf(req);
    const cacheKey = 'lifi:chains' + qs;
    const c = getCachedJson(cacheKey);
    if (c) return res.status(c.status).json(c.payload);
    const r = await fetchWithTimeout(`${LIFI_API}/chains${qs}`, { headers: buildLifiHeaders() }, 12_000);
    const result = await safeJson(r);
    if (r.ok && result.parsed !== null) setCachedJson(cacheKey, r.status, result.parsed, 600_000);
    return respondJsonOrError(res, r, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LI.FI chains timed out' });
    logError('lifi-chains', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/lifi/quote', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    params.set('skipSimulation', 'true');
    const r = await fetchWithTimeout(`${LIFI_API}/quote?${params}`, { headers: buildLifiHeaders() }, 15_000);
    return respondJsonOrError(res, r, await safeJson(r));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LI.FI timed out' });
    logError('lifi-quote', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.get('/api/lifi/status', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const r = await fetchWithTimeout(`${LIFI_API}/status?${params}`, { headers: buildLifiHeaders() }, 10_000);
    return respondJsonOrError(res, r, await safeJson(r));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LI.FI status timed out' });
    logError('lifi-status', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ========================================================================
 * Helius / Solana RPC
 * ===================================================================== */
function getSolanaRpcUrl() {
  if (HELIUS_RPC_URL) return HELIUS_RPC_URL;
  if (HELIUS_API_KEY) return 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY);
  return 'https://api.mainnet-beta.solana.com';
}

app.post('/api/helius/das', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      getSolanaRpcUrl(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      15_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Helius DAS timed out' });
    logError('helius-das', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/solana-rpc', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      getSolanaRpcUrl(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      15_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC timed out' });
    logError('solana-rpc', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
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
      helius:         Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      lifiApiKey:     Boolean(LIFI_API_KEY),
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
    lifi: { baseUrl: LIFI_API, keySet: Boolean(LIFI_API_KEY) },
    chainflip: { network: 'mainnet', brokerCommissionBps: 0 },
    solanaRpc: {
      provider: HELIUS_RPC_URL ? 'helius (custom url)'
              : HELIUS_API_KEY ? 'helius'
              : 'public mainnet-beta',
    },
    time: new Date().toISOString(),
  });
});

/* ========================================================================
 * Launch Radar — DexScreener data + PumpPortal trades (NEW SECTION)
 * ─────────────────────────────────────────────────────────────────────────
 * Self-contained Launch Radar backend. Replaces ./pumpfun-trade.js — the
 * routes here register BEFORE the `require('./pumpfun-trade')...` line
 * further down, so this version wins (Express first-match-wins). After
 * adopting this, delete pumpfun-trade.js and the require line below.
 *
 *   GET  /api/dex/launches      — latest pump.fun / PumpSwap launches
 *   GET  /api/dex/token/:mint   — one token, shaped + hasPumpPair flag
 *   GET  /api/dex/sol-price     — SOL/USD from DexScreener
 *   POST /api/pumpfun/trade     — thin PumpPortal proxy. Returns base64
 *                                 tx; client decompiles, splices a 3%
 *                                 SOL fee, signs and sends.
 *
 * Contract gate: launches + token endpoints only return mints with at
 * least one pair on dexId "pumpfun" or "pumpswap". Anything in the UI
 * is guaranteed tradable via PumpPortal's pool="auto" routing.
 *
 * Re-uses existing helpers: fetchWithTimeout, safeJson, respondJsonOrError,
 * getCachedJson, setCachedJson, logError. AbortError → 504 like the rest.
 * ===================================================================== */
const DEX_BASE          = 'https://api.dexscreener.com';
const PUMPPORTAL_URL    = 'https://pumpportal.fun/api/trade-local';
const PUMP_DEX_IDS      = new Set(['pumpfun', 'pumpswap']);
const PUMP_BASE58_RE    = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// 10% slippage on pump.fun trades. CLIENT MATH ASSUMES THIS — if you
// change it, update the divisor (110n) in LaunchRadar.jsx's swapParams
// BUY branch to match (100 + PUMP_SLIPPAGE_PCT).
const PUMP_SLIPPAGE_PCT = 10;
const PUMP_PRIORITY_FEE = 0.0001;  // SOL — PumpPortal sets compute-unit price

// Shape one mint's DexScreener pairs → internal token row. Returns null
// unless at least one pair is pump.fun or PumpSwap (the contract gate).
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

app.get('/api/dex/launches', async (req, res) => {
  try {
    const cacheKey = 'dex:launches';
    const cached = getCachedJson(cacheKey);
    if (cached) return res.status(cached.status).json(cached.payload);

    const profR = await fetchWithTimeout(
      DEX_BASE + '/token-profiles/latest/v1',
      { headers: { Accept: 'application/json' } },
      10_000,
    );
    if (!profR.ok) return respondJsonOrError(res, profR, await safeJson(profR));
    const profiles = await profR.json();

    const mints = [];
    const seen  = new Set();
    for (const p of (Array.isArray(profiles) ? profiles : [])) {
      if (p.chainId !== 'solana') continue;
      const a = p.tokenAddress;
      if (!a || !PUMP_BASE58_RE.test(a) || seen.has(a)) continue;
      seen.add(a);
      mints.push(a);
      if (mints.length >= 30) break;
    }
    if (mints.length === 0) {
      const payload = { tokens: [] };
      setCachedJson(cacheKey, 200, payload, 8_000);
      return res.json(payload);
    }

    const enrichR = await fetchWithTimeout(
      DEX_BASE + '/latest/dex/tokens/' + mints.join(','),
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
      if (ba && byMint.has(ba)) byMint.get(ba).push(p);
      if (qa && byMint.has(qa)) byMint.get(qa).push(p);
    }

    const tokens = [];
    for (const m of mints) {
      const shaped = _shapePumpToken(m, byMint.get(m) || []);
      if (shaped) tokens.push(shaped);
    }
    tokens.sort((a, b) => Number(b.pairCreatedAt || 0) - Number(a.pairCreatedAt || 0));

    const payload = { tokens };
    setCachedJson(cacheKey, 200, payload, 8_000);
    return res.json(payload);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener launches timed out' });
    logError('dex-launches', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

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

// PumpPortal proxy. Returns binary tx → we base64-encode and wrap in JSON.
// Cannot use safeJson here because PumpPortal returns octet-stream on success.
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
      // Client sends LAMPORTS (the curve-budget portion sized for slippage).
      const lamports = BigInt(String(b.amount));
      if (lamports <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });
      amountStr = (Number(lamports) / 1e9).toFixed(9);
      denominatedInSol = 'true';
    } else {
      // Client sends RAW token units + decimals.
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
 * Launch Radar — pump.fun bonding-curve trades
 * Builds buy/sell instructions server-side via @pump-fun/pump-sdk.
 * Mounted BEFORE the /api/* catch-all so the route resolves.
 * ===================================================================== */
// require('./pumpfun-trade').mountRoutes(app);

/* ========================================================================
 * Launch Radar — Jupiter Ultra V3 proxy (Iris router; pre-grad bonding curves)
 * Added for LaunchRadar's multi-endpoint race. Re-uses the existing
 * JUPITER_API_KEY / JUPITER_ACCOUNT headers and existing helpers.
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
 * ─────────────────────────────────────────────────────────────────────────
 * Self-contained section. Mounted BEFORE `app.all('/api/*', ...)`.
 *
 * Uses @chainflip/sdk server-side. The SDK handles the Q128 fixed-point
 * conversion of `slippageTolerancePercent` → `minPriceX128` on the wire
 * (the public REST endpoint will NOT accept the friendly form), validates
 * amounts against state-chain limits, and locks the schema to a known
 * version. The browser never touches the SDK — it only sees the three
 * thin JSON routes below.
 *
 *   GET  /api/chainflip/quote?amount=<lamports>
 *        → { quote }                                  // REGULAR only
 *
 *   POST /api/chainflip/channel
 *        body: { quote, destAddress, refundAddress }
 *        → { channel: { depositAddress, depositChannelId,
 *                       srcChainExpiryBlock, channelOpeningFee, ... } }
 *
 *   GET  /api/chainflip/status?id=<depositChannelId>
 *        → { status }                                 // v2 status object
 *
 * No broker URL is configured, so `brokerCommissionBps` is forced to 0.
 * The 3% platform fee is collected on-chain via a separate SOL transfer
 * in the client (SolToBtcChainflip.jsx), preserving the same atomic
 * two-tx pattern the Thor page uses.
 *
 * Requires: `npm i @chainflip/sdk` (server-side dep only, ~188KB).
 * Mainnet backend URL is baked into the SDK
 * (https://chainflip-swap.chainflip.io/). No env vars needed.
 *
 * Reuses existing helpers from server.js: logError. The /api/ rate
 * limiter already covers these paths.
 * ===================================================================== */
const { SwapSDK, Chains, Assets } = require('@chainflip/sdk/swap');

// One SDK instance, reused across requests. Quotes hit a stateless HTTP
// backend, so this is safe to share. No broker URL → broker commission
// disabled; we take our cut on-chain in SOL instead (see client).
const chainflipSdk = new SwapSDK({ network: 'mainnet' });

// Map SDK / SwapService errors to short, user-facing messages without
// leaking internals. Falls back to the raw message if nothing matches.
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
        retryDurationBlocks: 150,                                                       // ~15 min @ 6s state-chain blocks
        slippageTolerancePercent: Number(quote.recommendedSlippageTolerancePercent ?? 3),
        livePriceSlippageTolerancePercent: quote.recommendedLivePriceSlippageTolerancePercent,
      },
    });

    // BigInts won't JSON-serialize; coerce the two that are present.
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
 * Chainflip — Generic multi-route swaps (NEW SECTION, additive)
 * ─────────────────────────────────────────────────────────────────────────
 * Used by CrossChainSwap.jsx. Distinct routes from the SOL→BTC block above
 * (which the BTC page hardcodes). No shared state — own SDK instance,
 * own helpers, own validation. Mount this BEFORE `app.all('/api/*', ...)`.
 *
 *   GET  /api/cf/assets   — chains + asset matrix (hardcoded from docs)
 *   GET  /api/cf/quote    — ?srcChain&srcAsset&destChain&destAsset&amount
 *   POST /api/cf/channel  — body: { quote, destAddress, refundAddress }
 *                          opens a deposit channel for ANY supported route
 *   GET  /api/cf/status   — ?id=<depositChannelId>
 *
 * Chains (7): Bitcoin · Ethereum · Arbitrum · Polkadot · Solana · Assethub · Tron
 * Assets (per docs March 30 2026):
 *   Ethereum  — ETH, USDC, USDT, WBTC, FLIP
 *   Arbitrum  — ETH, USDC, USDT
 *   Bitcoin   — BTC
 *   Solana    — SOL, USDC, USDT
 *   Polkadot  — DOT
 *   Assethub  — SOL, USDC, USDT
 *   Tron      — TRX, USDT
 *
 * SAFETY NOTE: Chainflip absorbs (unrecoverable) any deposit outside
 * the min/max swap amount for an asset. The SDK's getQuoteV2 validates
 * this — we surface "Amount below/above Chainflip minimum/maximum" so
 * the user cannot proceed past quoting with an unsafe amount.
 *
 * Re-uses: logError from earlier in this file. The /api/ rate limiter
 * already covers these paths.
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

// Asset matrix — verified from Chainflip docs (March 30 2026 update).
// Decimals are the protocol-side decimals for each (chain, asset). Update
// if Chainflip adds chains/assets.
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
        retryDurationBlocks: 150,                                                       // ~15 min @ 6s state-chain blocks
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

app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.path }));

/* ========================================================================
 * Embed runtime config
 * ===================================================================== */
app.get('/embed/config.js', (req, res) => {
  const cfg = {
    rpc: getSolanaRpcUrl(),
    wcProjectId: process.env.WALLETCONNECT_PROJECT_ID
              || process.env.REACT_APP_WALLETCONNECT_PROJECT_ID
              || '',
  };
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send('window.__VERIXIA_CONFIG__=' + JSON.stringify(cfg) + ';');
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
  console.log('  LI.FI:           ' + LIFI_API + (LIFI_API_KEY ? ' (key set)' : ' (no key)'));
  console.log('  Chainflip:       mainnet (SOL → BTC, broker commission disabled)');
  console.log('  Solana RPC:      ' + (HELIUS_RPC_URL ? 'helius (custom)' : HELIUS_API_KEY ? 'helius' : 'public mainnet-beta'));
  console.log('  Allowed origins: ' + allowedOrigins.join(', '));
});