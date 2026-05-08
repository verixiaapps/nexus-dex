/**
 * NEXUS DEX -- Backend Proxy Server
 * 
 * Active routes:
 *   /api/0x/*         -- 0x v2 swap aggregator (EVM)
 *   /api/jupiter/*    -- Jupiter swap + price + token search (Solana)
 *   /api/lifi/*       -- LiFi cross-chain + token price + catalog
 *   /api/helius/das   -- Helius DAS getAsset (Solana metadata + price fallback)
 *   /api/solana-rpc   -- Solana RPC proxy (Helius preferred)
 *   /api/pinata/json  -- Pinata pinJSONToIPFS (token-launch metadata)
 *   /api/pinata/file  -- Pinata pinFileToIPFS (token-launch images)
 *   /api/health       -- healthcheck
 *
 * Removed (banned data sources):
 *   /api/coingecko/*       -- replaced by Jupiter /price/v3 + LiFi /v1/token
 *   /api/cg/* (alias)      -- ditto
 *   /api/geckoterminal/*   -- replaced by Jupiter + LiFi
 *   /api/moralis/*         -- replaced by Jupiter + LiFi + on-chain RPC
 *   /api/raydium/*         -- TokenLaunch uses @raydium-io/raydium-sdk-v2
 *                            directly, which routes through /api/solana-rpc
 *
 * Required env: OX_API_KEY, JUPITER_API_KEY, LIFI_API_KEY, HELIUS_API_KEY,
 *               PINATA_JWT (each accepts REACT_APP_* fallback)
 * Optional env: ALLOWED_ORIGINS, PORT, NODE_ENV, CSP_MODE, EXTRA_CSP_*,
 *               HSTS_DISABLE, REACT_APP_SOLANA_RPC (full Helius URL)
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* SECURITY HEADERS */
const CSP_MODE = (process.env.CSP_MODE || 'report-only').toLowerCase();
const CSP_REPORT_URI = (process.env.CSP_REPORT_URI || '').trim();
const _csv = v => (v||'').split(',').map(s=>s.trim()).filter(Boolean);
const EXTRA_CONNECT_SRC = _csv(process.env.EXTRA_CSP_CONNECT_SRC);
const EXTRA_FRAME_SRC = _csv(process.env.EXTRA_CSP_FRAME_SRC);
const EXTRA_SCRIPT_SRC = _csv(process.env.EXTRA_CSP_SCRIPT_SRC);
const CSP_DIRECTIVES = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'","'unsafe-inline'",'https://challenges.cloudflare.com',...EXTRA_SCRIPT_SRC]],
  ['style-src', ["'self'","'unsafe-inline'",'https://fonts.googleapis.com']],
  ['img-src', ["'self'",'data:','blob:','https:']],
  ['font-src', ["'self'",'data:','https://fonts.gstatic.com']],
  ['object-src', ["'none'"]], ['base-uri', ["'self'"]], ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['frame-src', ["'self'",'https://auth.privy.io','https://verify.walletconnect.com','https://verify.walletconnect.org','https://challenges.cloudflare.com',...EXTRA_FRAME_SRC]],
  ['child-src', ["'self'",'https://auth.privy.io','https://verify.walletconnect.com','https://verify.walletconnect.org']],
  ['connect-src', ["'self'",'https://auth.privy.io','https://*.privy.io','https://*.privy.systems','https://*.rpc.privy.systems','https://explorer-api.walletconnect.com','https://*.walletconnect.com','https://*.walletconnect.org','wss://relay.walletconnect.com','wss://relay.walletconnect.org','wss://*.walletconnect.com','wss://*.walletconnect.org','wss://www.walletlink.org','https://api.mainnet-beta.solana.com','https://api.devnet.solana.com','https://api.testnet.solana.com','https://*.publicnode.com','https://*.drpc.org','https://pumpportal.fun','wss://pumpportal.fun',...EXTRA_CONNECT_SRC]],
  ['worker-src', ["'self'",'blob:']],
  ['manifest-src', ["'self'"]],
];
const _cspParts = CSP_DIRECTIVES.map(e => e[0] + ' ' + e[1].join(' '));
if (CSP_REPORT_URI) _cspParts.push('report-uri ' + CSP_REPORT_URI);
const CSP_VALUE = _cspParts.join('; ');
const CSP_HEADER_NAME = CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
const HSTS_ENABLED = NODE_ENV === 'production' && process.env.HSTS_DISABLE !== '1';
console.log('[security] CSP mode:', CSP_MODE, '-> header:', CSP_HEADER_NAME);

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

/* SECRETS - all support REACT_APP_* fallbacks */
const OX_API_KEY      = process.env.OX_API_KEY      || process.env.REACT_APP_0X_API_KEY      || '';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || process.env.REACT_APP_JUPITER_API_KEY || '';
const LIFI_API_KEY    = process.env.LIFI_API_KEY    || process.env.REACT_APP_LIFI_API_KEY    || '';
const HELIUS_API_KEY  = process.env.HELIUS_API_KEY  || process.env.REACT_APP_HELIUS_API_KEY  || '';
/* REACT_APP_SOLANA_RPC is a FULL URL with the Helius key embedded
 * (e.g. https://mainnet.helius-rpc.com/?api-key=xxx). If set we use
 * it directly instead of constructing the URL from HELIUS_API_KEY. */
const HELIUS_RPC_URL  = process.env.HELIUS_RPC_URL  || process.env.REACT_APP_SOLANA_RPC      || '';
const PINATA_JWT      = process.env.PINATA_JWT      || process.env.REACT_APP_PINATA_JWT      || '';

/* CORS + JSON */
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

/* RATE LIMITING -- bumped from 240 to 600/min. Quote engine fires more
 * proxy calls per session now (Jupiter/LiFi for both from+to tokens, plus
 * lazy LiFi catalog load); 240 was too tight for active swappers. */
const apiLimiter = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down.' }, skip: r => r.path === '/health' });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many uploads, slow down.' } });
app.use('/api/', apiLimiter);

/* HELPERS */
async function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, Object.assign({}, options, { signal: controller.signal })); }
  finally { clearTimeout(timer); }
}
async function safeJson(response) {
  const text = await response.text();
  try { return { parsed: JSON.parse(text), raw: null }; }
  catch (e) { return { parsed: null, raw: text }; }
}
function scrubSecrets(s) {
  if (s == null) return '';
  return String(s)
    .replace(/api-key=[^&\s"']+/gi, 'api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/0x-api-key["':\s]+[^&\s"',}]+/gi, '0x-api-key=***')
    .replace(/x-api-key["':\s]+[^&\s"',}]+/gi, 'x-api-key=***')
    .replace(/x-lifi-api-key["':\s]+[^&\s"',}]+/gi, 'x-lifi-api-key=***');
}
function logError(tag, err) {
  const msg = scrubSecrets(err && err.message ? err.message : err);
  if (NODE_ENV === 'production') console.warn('[' + tag + ']', msg);
  else { const stack = err && err.stack ? scrubSecrets(err.stack) : ''; console.error('[' + tag + ']', msg, stack ? '\n' + stack : ''); }
}
function queryStringOf(req) {
  const u = req.originalUrl || req.url || '';
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(i) : '';
}
function respondJsonOrError(res, response, result) {
  if (result.parsed !== null) return res.status(response.status).json(result.parsed);
  return res.status(response.status).json({ error: 'Upstream returned non-JSON', body: result.raw && result.raw.slice(0, 500) });
}

/* HEALTHCHECK */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, env: NODE_ENV,
    has: {
      ox:      Boolean(OX_API_KEY),
      jupiter: Boolean(JUPITER_API_KEY),
      lifi:    Boolean(LIFI_API_KEY),
      helius:  Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      pinata:  Boolean(PINATA_JWT),
    },
    time: new Date().toISOString(),
  });
});

/* 0X PROXY -- EVM swap aggregator */
async function proxy0x(req, res) {
  try {
    const subPath = req.path.replace('/api/0x', '');
    const url = 'https://api.0x.org' + subPath + queryStringOf(req);
    const headers = { '0x-api-key': OX_API_KEY, '0x-version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOpts = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) fetchOpts.body = JSON.stringify(req.body);
    const response = await fetchWithTimeout(url, fetchOpts);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: '0x request timed out' });
    logError('0x', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
app.get('/api/0x/*', proxy0x);
app.post('/api/0x/*', proxy0x);

/* JUPITER PROXY -- Solana swap + price + token search.
 * lite-api.jup.ag for /price/* and /tokens/* (the public lite host);
 * api.jup.ag with x-api-key for /swap/* (paid swap host). */
async function proxyJupiter(req, res) {
  try {
    const subPath = req.path.replace('/api/jupiter', '');
    const liteOnly = subPath.startsWith('/price/') || subPath.startsWith('/tokens/');
    const host = liteOnly ? 'https://lite-api.jup.ag' : (JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag');
    const url = host + subPath + queryStringOf(req);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!liteOnly && JUPITER_API_KEY) headers['x-api-key'] = JUPITER_API_KEY;
    const fetchOpts = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) fetchOpts.body = JSON.stringify(req.body);
    const response = await fetchWithTimeout(url, fetchOpts, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter request timed out' });
    logError('jupiter', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
app.get('/api/jupiter/*', proxyJupiter);
app.post('/api/jupiter/*', proxyJupiter);

/* LIFI PROXY -- cross-chain bridge aggregator + token price + catalog */
async function proxyLifi(req, res) {
  try {
    const subPath = req.path.replace('/api/lifi', '');
    const url = 'https://li.quest' + subPath + queryStringOf(req);
    const headers = { 'Content-Type': 'application/json' };
    if (LIFI_API_KEY) headers['x-lifi-api-key'] = LIFI_API_KEY;
    const fetchOpts = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) fetchOpts.body = JSON.stringify(req.body);
    const response = await fetchWithTimeout(url, fetchOpts);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LiFi request timed out' });
    logError('lifi', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
app.get('/api/lifi/*', proxyLifi);
app.post('/api/lifi/*', proxyLifi);

/* HELIUS DAS -- Solana metadata + price fallback */
app.post('/api/helius/das', async (req, res) => {
  try {
    const url = HELIUS_RPC_URL
      ? HELIUS_RPC_URL
      : (HELIUS_API_KEY
          ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY)
          : 'https://api.mainnet-beta.solana.com');
    const response = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Helius DAS request timed out' });
    logError('helius-das', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* SOLANA RPC -- Helius preferred, falls back to public mainnet.
 * The Raydium SDK's RPC calls flow through this endpoint. */
app.post('/api/solana-rpc', async (req, res) => {
  try {
    const url = HELIUS_RPC_URL
      ? HELIUS_RPC_URL
      : (HELIUS_API_KEY
          ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY)
          : 'https://api.mainnet-beta.solana.com');
    const response = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC request timed out' });
    logError('solana-rpc', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* PINATA -- IPFS uploads for token-launch metadata + images */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype || '')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});
app.post('/api/pinata/json', uploadLimiter, async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
    const { name, content } = req.body || {};
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Missing content' });
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PINATA_JWT },
      body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: (name || 'metadata').slice(0, 64) } }),
    }, 20_000);
    const result = await safeJson(response);
    if (result.parsed && result.parsed.IpfsHash) return res.json({ ipfsHash: result.parsed.IpfsHash, url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash });
    return res.status(response.status).json({ error: 'Pinata upload failed', detail: result.parsed || (result.raw && result.raw.slice(0, 300)) });
  } catch (e) { logError('pinata-json', e); return res.status(500).json({ error: e.message || 'Unknown error' }); }
});
app.post('/api/pinata/file', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fd = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    fd.append('file', blob, req.file.originalname || 'upload');
    if (req.body && req.body.name) fd.append('pinataMetadata', JSON.stringify({ name: String(req.body.name).slice(0, 64) }));
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST', headers: { Authorization: 'Bearer ' + PINATA_JWT }, body: fd,
    }, 30_000);
    const result = await safeJson(response);
    if (result.parsed && result.parsed.IpfsHash) return res.json({ ipfsHash: result.parsed.IpfsHash, url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash });
    return res.status(response.status).json({ error: 'Pinata upload failed', detail: result.parsed || (result.raw && result.raw.slice(0, 300)) });
  } catch (e) { logError('pinata-file', e); return res.status(500).json({ error: e.message || 'Unknown error' }); }
});

/* 404 FOR UNMATCHED API ROUTES */
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found: ' + req.path });
});

/* SPA STATIC + CATCH-ALL */
app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'build', 'index.html')); });

/* ERROR HANDLER */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Not allowed by CORS')) return res.status(403).json({ error: 'CORS: origin not allowed' });
  if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'Request body too large' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in request body' });
  if (err && err.message === 'Only image files are allowed') return res.status(400).json({ error: err.message });
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 5MB)' });
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field - use field name "file"' });
  logError('unhandled', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* BOOT */
app.listen(PORT, () => {
  console.log('Nexus DEX server running on port ' + PORT);
  console.log('  env:             ' + NODE_ENV);
  console.log('  allowed origins: ' + allowedOrigins.join(', '));
  if (!OX_API_KEY)      console.warn('  WARNING: OX_API_KEY not set - EVM swaps will fail');
  if (!JUPITER_API_KEY) console.warn('  WARNING: JUPITER_API_KEY not set - Solana swaps will rate-limit on free tier');
  if (!LIFI_API_KEY)    console.warn('  WARNING: LIFI_API_KEY not set - cross-chain bridges will rate-limit on free tier');
  if (!HELIUS_API_KEY && !HELIUS_RPC_URL) console.warn('  WARNING: HELIUS_API_KEY / REACT_APP_SOLANA_RPC not set - falling back to public Solana RPC');
  if (!PINATA_JWT)      console.warn('  WARNING: PINATA_JWT not set - token launch metadata uploads will fail');
});

process.on('uncaughtException', err => logError('uncaughtException', err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));