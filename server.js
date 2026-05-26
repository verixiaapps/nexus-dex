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
 *
 * Connect-src whitelist now covers ONLY the services the app actually uses:
 *   • Jupiter (api.jup.ag, lite-api.jup.ag, token.jup.ag, quote-api.jup.ag)
 *   • LI.FI (li.quest)
 *   • Helius / Solana RPC (helius-rpc.com, api.mainnet-beta.solana.com)
 *   • WalletConnect (for external wallet connections)
 *   • Chainalysis sanctions list (public.chainalysis.com — kept since it's
 *     standard for any wallet connect flow; remove if you don't use it)
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
    // Jupiter
    'https://api.jup.ag', 'https://lite-api.jup.ag', 'https://quote-api.jup.ag', 'https://token.jup.ag',
    // LI.FI
    'https://li.quest',
    // Solana RPC
    'https://api.mainnet-beta.solana.com', 'https://mainnet.helius-rpc.com', 'https://*.helius-rpc.com',
    'https://*.publicnode.com', 'https://*.drpc.org',
    // WalletConnect (external wallet flow)
    'https://explorer-api.walletconnect.com',
    'https://*.walletconnect.com', 'https://*.walletconnect.org',
    'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org',
    'wss://*.walletconnect.com', 'wss://*.walletconnect.org',
    'wss://www.walletlink.org',
    // Sanctions screening (optional but standard)
    'https://public.chainalysis.com',
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
const JUPITER_ENABLED      = process.env.JUPITER_ENABLED !== '0';
const JUPITER_ACCOUNT      = process.env.JUPITER_ACCOUNT || 'NEXUS_DEX';
const JUPITER_API_KEY      = process.env.JUPITER_API_KEY || '';
const JUPITER_SWAP_V2_BASE = 'https://api.jup.ag/swap/v2';
const JUPITER_LEGACY_BASE  = (process.env.JUPITER_QUOTE_BASE || 'https://api.jup.ag/swap/v1').replace(/\/+$/, '');
const JUPITER_TOKENS_BASE  = 'https://lite-api.jup.ag/tokens/v2';
const JUPITER_PRICE_BASE   = 'https://lite-api.jup.ag/price/v3';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC     || '';

const LIFI_API     = 'https://li.quest/v1';
const LIFI_API_KEY = process.env.LIFI_API_KEY || '';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://swap.verixiaapps.com,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
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

// Swap V2 /build — used by the main Swap.jsx (atomic-tx flow)
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

// Tokens by tag (default: verified)
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

// Token search by symbol / name / mint
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

// Legacy swap quote — used by MemeWonderland and Stocks
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

// Legacy swap — returns a full serialized transaction
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

// Swap instructions — used for atomic-tx flow (fee + swap in one tx)
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

// Trending memes (top organic score by timeframe) — used by MemeWonderland
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

// New launches — Jupiter Tokens V2 /recent. Sorted by first-pool creation
// time. Used by the Pulse "NEW" column.
app.get('/api/jupiter/tokens/v2/recent', async (req, res) => {
  try {
    const url = `https://lite-api.jup.ag/tokens/v2/recent${buildForwardedQuery(req)}`;
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result   = await safeJson(response);
    // Short cache: NEW launches are hot, but we still want to deduplicate
    // burst-fire polls from multiple users.
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 5_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter recent timed out' });
    logError('jupiter-tokens-recent', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

// Token registry passthrough
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
 * SOL price — Jupiter price feed (replaced OKX ticker)
 * ===================================================================== */
let _solPriceCache = { p: 0, ts: 0 };
async function fetchSolPriceUsd() {
  const now = Date.now();
  if (now - _solPriceCache.ts < 30_000 && _solPriceCache.p > 0) return _solPriceCache.p;
  const r = await fetchWithTimeout(`${JUPITER_PRICE_BASE}?ids=${SOL_MINT}`, { headers: { Accept: 'application/json' } }, 8_000);
  const d = await r.json();
  // Jupiter price v3 returns: { "<mint>": { "usdPrice": <number>, ... } }
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
 * LI.FI cross-chain
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
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, env: NODE_ENV,
    has: {
      jupiter:       Boolean(JUPITER_ENABLED),
      jupiterApiKey: Boolean(JUPITER_API_KEY),
      helius:        Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      lifiApiKey:    Boolean(LIFI_API_KEY),
    },
    jupiter: {
      swapV2: JUPITER_SWAP_V2_BASE,
      tokens: JUPITER_TOKENS_BASE,
      legacy: JUPITER_LEGACY_BASE,
      price:  JUPITER_PRICE_BASE,
      keySet: Boolean(JUPITER_API_KEY),
    },
    lifi: { baseUrl: LIFI_API, keySet: Boolean(LIFI_API_KEY) },
    solanaRpc: {
      provider: HELIUS_RPC_URL ? 'helius (custom url)'
              : HELIUS_API_KEY ? 'helius'
              : 'public mainnet-beta',
    },
    time: new Date().toISOString(),
  });
});

app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.path }));

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
app.listen(PORT, () => {
  console.log('Nexus DEX server on port ' + PORT);
  console.log('  env: ' + NODE_ENV);
  console.log('  Jupiter Swap V2: ' + JUPITER_SWAP_V2_BASE + (JUPITER_API_KEY ? ' (key set)' : ' (no key)'));
  console.log('  Jupiter Price:   ' + JUPITER_PRICE_BASE);
  console.log('  LI.FI:           ' + LIFI_API + (LIFI_API_KEY ? ' (key set)' : ' (no key)'));
  console.log('  Solana RPC:      ' + (HELIUS_RPC_URL ? 'helius (custom)' : HELIUS_API_KEY ? 'helius' : 'public mainnet-beta'));
});

process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));
