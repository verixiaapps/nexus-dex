require('dotenv').config();

const crypto    = require('crypto');
const express   = require('express');
const cors      = require('cors');
const path      = require('path'); 
const rateLimit = require('express-rate-limit');
const multer    = require('multer');
const ethers    = require('ethers');
 
const app      = express();
const PORT     = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');
app.set('trust proxy', 1);

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
  ['font-src',        ["'self'", 'data:', 'https://fonts.gstatic.com']],
  ['object-src',      ["'none'"]],
  ['base-uri',        ["'self'"]],
  ['form-action',     ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['frame-src',       ["'self'", 'https://auth.privy.io', 'https://verify.walletconnect.com', 'https://verify.walletconnect.org', 'https://challenges.cloudflare.com', ...EXTRA_FRAME_SRC]],
  ['child-src',       ["'self'", 'https://auth.privy.io', 'https://verify.walletconnect.com', 'https://verify.walletconnect.org']],
  ['connect-src',     ["'self'", 'https://li.quest', 'https://web3.okx.com', 'https://quote-api.jup.ag', 'https://lite-api.jup.ag', 'https://api.jup.ag', 'https://token.jup.ag', 'https://api.hyperliquid.xyz', 'https://api.hyperliquid-testnet.xyz', 'https://pumpportal.fun', 'wss://pumpportal.fun', 'https://api.dexscreener.com', 'https://*.dexscreener.com', 'https://auth.privy.io', 'https://*.privy.io', 'https://*.privy.systems', 'https://*.rpc.privy.systems', 'https://explorer-api.walletconnect.com', 'https://*.walletconnect.com', 'https://*.walletconnect.org', 'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org', 'wss://*.walletconnect.com', 'wss://*.walletconnect.org', 'wss://www.walletlink.org', 'https://api.mainnet-beta.solana.com', 'https://mainnet.helius-rpc.com', 'https://*.helius-rpc.com', 'https://api.pinata.cloud', 'https://*.publicnode.com', 'https://*.drpc.org', ...EXTRA_CONNECT_SRC]],
  ['worker-src',      ["'self'", 'blob:']],
  ['manifest-src',    ["'self'"]],
];

const _cspParts = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v.join(' ')}`);
if (CSP_REPORT_URI) _cspParts.push(`report-uri ${CSP_REPORT_URI}`);
const CSP_VALUE       = _cspParts.join('; ');
const CSP_HEADER_NAME = CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
const HSTS_ENABLED    = NODE_ENV === 'production' && process.env.HSTS_DISABLE !== '1';

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

const OKX_API_KEY        = process.env.OKX_API_KEY        || '';
const OKX_SECRET_KEY     = process.env.OKX_SECRET_KEY     || '';
const OKX_PASSPHRASE     = process.env.OKX_API_PASSPHRASE || '';
const OKX_PROJECT_ID     = process.env.OKX_PROJECT_ID     || '';
const OKX_FEE_WALLET_SOL = process.env.OKX_FEE_WALLET_SOL || '';
const OKX_FEE_WALLET_EVM = process.env.OKX_FEE_WALLET_EVM || '';
const OKX_SOL_FEE_PCT    = process.env.OKX_SOL_FEE_PCT    || '5';
const OKX_EVM_FEE_PCT    = process.env.OKX_EVM_FEE_PCT    || '3';
const OKX_SOLANA_CHAIN   = '501';

const JUPITER_ENABLED    = process.env.JUPITER_ENABLED === '1';
const JUPITER_ACCOUNT    = process.env.JUPITER_ACCOUNT    || 'NEXUS_DEX_FALLBACK';
const JUPITER_QUOTE_BASE = (process.env.JUPITER_QUOTE_BASE || 'https://quote-api.jup.ag/v6').replace(/\/+$/, '');
const JUPITER_API_KEY    = process.env.JUPITER_API_KEY    || '';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY  || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL  || process.env.REACT_APP_SOLANA_RPC     || '';
const PINATA_JWT     = process.env.PINATA_JWT      || '';

const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY || '';
const OPERATOR_WALLET_ADDR = '0xeace360F8faB3f739CBC4e026b58efC5866fAdC1';
const ARB_RPC_URL          = process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const HL_API               = 'https://api.hyperliquid.xyz';
const OKX_TICKER_URL       = 'https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT';
const LIFI_API             = 'https://li.quest/v1';
const LIFI_API_KEY         = process.env.LIFI_API_KEY || '';
// HyperCore chain ID in LI.FI = 1337
// Solana chain ID in LI.FI    = 1151111081099710

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
const uploadLimiter = rateLimit({
  windowMs: 60_000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads.' },
});
app.use('/api/', apiLimiter);

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
    .replace(/OK-ACCESS-KEY["':\s]+[^&\s"',}]+/gi,        'OK-ACCESS-KEY=***')
    .replace(/OK-ACCESS-SIGN["':\s]+[^&\s"',}]+/gi,       'OK-ACCESS-SIGN=***')
    .replace(/OK-ACCESS-PASSPHRASE["':\s]+[^&\s"',}]+/gi, 'OK-ACCESS-PASSPHRASE=***')
    .replace(/api-key=[^&\s"']+/gi,                        'api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,                'Bearer ***')
    .replace(/privateKey["':\s]+[^&\s"',}]+/gi,           'privateKey=***')
    .replace(/signature["':\s]+{[^}]+}/gi,                'signature={***}');
}

function logError(tag, err) {
  const msg = scrubSecrets(err?.message ?? err);
  if (NODE_ENV === 'production') {
    console.warn(`[${tag}]`, msg);
  } else {
    console.error(`[${tag}]`, msg, err?.stack ? '\n' + scrubSecrets(err.stack) : '');
  }
}

function queryStringOf(req) {
  const u = req.originalUrl || req.url || '';
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(i) : '';
}

function respondJsonOrError(res, response, result) {
  if (result.parsed !== null) return res.status(response.status).json(result.parsed);
  return res.status(response.status).json({ error: 'Upstream returned non-JSON', body: result.raw?.slice(0, 500) });
}

function buildForwardedQuery(req) { return queryStringOf(req) || ''; }

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

function okxSign(ts, method, okxPath, body) {
  return crypto.createHmac('sha256', OKX_SECRET_KEY)
    .update(ts + method.toUpperCase() + okxPath + (body || ''))
    .digest('base64');
}
function buildOkxHeaders(method, okxPath, body) {
  const ts = new Date().toISOString();
  return {
    'OK-ACCESS-KEY':        OKX_API_KEY,
    'OK-ACCESS-SIGN':       okxSign(ts, method, okxPath, body),
    'OK-ACCESS-TIMESTAMP':  ts,
    'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
    'OK-PROJECT':           OKX_PROJECT_ID,
    'Content-Type':         'application/json',
    Accept:                 'application/json',
  };
}

const OKX_ALLOWED_ENDPOINTS = new Set([
  '/dex/aggregator/quote', '/dex/aggregator/swap', '/dex/aggregator/swap-instruction',
  '/dex/aggregator/tokens', '/dex/aggregator/all-tokens', '/dex/aggregator/liquidity-sources',
  '/dex/aggregator/supported/chain', '/dex/aggregator/approve-transaction',
  '/dex/aggregator/pre-transaction', '/dex/aggregator/transaction', '/dex/aggregator/history',
  '/dex/market/token/basic-info', '/dex/market/candles', '/dex/market/price-info',
  '/dex/market/memepump/tokenList', '/dex/market/memepump/tokenDetails',
  '/dex/cross-chain/quote', '/dex/cross-chain/build-tx', '/dex/cross-chain/approve-transaction',
  '/dex/cross-chain/status', '/dex/cross-chain/supported/chains', '/dex/cross-chain/tokens',
  '/dex/cross-chain/token-pairs', '/dex/cross-chain/bridges',
]);

function injectOkxFee(params) {
  if (OKX_FEE_WALLET_SOL && OKX_SOL_FEE_PCT) {
    params.set('toTokenReferrerWalletAddress', OKX_FEE_WALLET_SOL);
    params.set('feePercent', OKX_SOL_FEE_PCT);
  }
}

async function proxyOkx(req, res) {
  try {
    if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE)
      return res.status(503).json({ error: 'OKX credentials not configured' });
    const subPath = req.path.replace('/api/okx', '');
    if (!OKX_ALLOWED_ENDPOINTS.has(subPath))
      return res.status(404).json({ error: 'OKX endpoint not allowed: ' + subPath });
    const params = new URLSearchParams(queryStringOf(req).slice(1));
    if (params.get('chainIndex') === OKX_SOLANA_CHAIN &&
        (subPath === '/dex/aggregator/swap' || subPath === '/dex/aggregator/swap-instruction'))
      injectOkxFee(params);
    const qs       = params.toString();
    const okxPath  = '/api/v6' + subPath + (qs ? '?' + qs : '');
    const okxUrl   = 'https://web3.okx.com' + okxPath;
    const bodyStr  = req.method !== 'GET' && req.method !== 'HEAD' && req.body ? JSON.stringify(req.body) : '';
    const fetchOpts = { method: req.method, headers: buildOkxHeaders(req.method, okxPath, bodyStr) };
    if (bodyStr) fetchOpts.body = bodyStr;
    const cacheable = req.method === 'GET' && [
      '/dex/aggregator/tokens', '/dex/aggregator/all-tokens', '/dex/aggregator/liquidity-sources',
      '/dex/aggregator/supported/chain', '/dex/cross-chain/supported/chains',
      '/dex/cross-chain/tokens', '/dex/cross-chain/token-pairs', '/dex/cross-chain/bridges',
    ].includes(subPath);
    if (cacheable) { const c = getCachedJson(okxUrl); if (c) return res.status(c.status).json(c.payload); }
    const response = await fetchWithTimeout(okxUrl, fetchOpts, 15_000);
    const result   = await safeJson(response);
    if (cacheable && response.ok && result.parsed !== null)
      setCachedJson(okxUrl, response.status, result.parsed, 60_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'OKX request timed out' });
    logError('okx', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

app.get('/api/okx/*',  proxyOkx);
app.post('/api/okx/*', proxyOkx);

app.get('/api/test-price-info', async (req, res) => {
  try {
    const mint    = req.query.mint || 'So11111111111111111111111111111111111111112';
    const body    = JSON.stringify({ chainIndex: '501', tokenContractAddress: mint });
    const okxPath = '/api/v6/dex/market/price-info';
    const response = await fetchWithTimeout(
      'https://web3.okx.com' + okxPath,
      { method: 'POST', headers: buildOkxHeaders('POST', okxPath, body), body },
      15_000,
    );
    res.json(await response.json());
  } catch (e) { res.json({ error: e.message }); }
});

function buildJupiterHeaders() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Nexus-Account': JUPITER_ACCOUNT };
  if (JUPITER_API_KEY) h['x-api-key'] = JUPITER_API_KEY;
  return h;
}

app.get('/api/jupiter/quote', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter fallback disabled' });
    const url = JUPITER_QUOTE_BASE + '/quote' + buildForwardedQuery(req);
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
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter fallback disabled' });
    const body = req.body || {};
    if (!body.userPublicKey) return res.status(400).json({ error: 'Missing userPublicKey' });
    if (!body.quoteResponse)  return res.status(400).json({ error: 'Missing quoteResponse' });
    const response = await fetchWithTimeout(
      JUPITER_QUOTE_BASE + '/swap',
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
    logError('jupiter-tokens', e);
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

app.get('/api/dexscreener/*', async (req, res) => {
  try {
    const url = 'https://api.dexscreener.com' + req.path.replace('/api/dexscreener', '') + buildForwardedQuery(req);
    const c   = getCachedJson(url);
    if (c) return res.status(c.status).json(c.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10_000);
    const result   = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 15_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener timed out' });
    logError('dexscreener', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

function isPlainObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function isHexString(v, bytes) {
  const s = String(v || '');
  if (!s.startsWith('0x')) return false;
  if (bytes && s.length !== 2 + bytes * 2) return false;
  return /^0x[0-9a-fA-F]+$/.test(s);
}
function validateHyperliquidSignature(sig) {
  if (!isPlainObject(sig))         return 'Missing signature object';
  if (!isHexString(sig.r, 32))     return 'Invalid signature.r';
  if (!isHexString(sig.s, 32))     return 'Invalid signature.s';
  const v = Number(sig.v);
  if (!Number.isInteger(v))        return 'Invalid signature.v';
  if (![0, 1, 27, 28].includes(v)) return 'Invalid signature.v value';
  return null;
}
function validateHyperliquidExchangePayload(body) {
  if (!isPlainObject(body))        return 'Invalid request body';
  if (body.type === 'placeOrder')  return 'Unsigned router payload -- frontend must sign before sending.';
  if (!isPlainObject(body.action)) return 'Missing action object';
  const nonce = Number(body.nonce);
  if (!Number.isInteger(nonce) || nonce <= 0) return 'Missing or invalid nonce';
  const sigErr = validateHyperliquidSignature(body.signature);
  if (sigErr) return sigErr;
  if (body.vaultAddress != null && !/^0x[a-fA-F0-9]{40}$/.test(String(body.vaultAddress)))
    return 'Invalid vaultAddress';
  if (body.expiresAfter != null && (!Number.isInteger(Number(body.expiresAfter)) || Number(body.expiresAfter) <= 0))
    return 'Invalid expiresAfter';
  return null;
}

async function proxyHyperliquidExchange(req, res, baseUrl, tag) {
  try {
    const err = validateHyperliquidExchangePayload(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const response = await fetchWithTimeout(
      baseUrl + '/exchange',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) },
      15_000,
    );
    const result = await safeJson(response);
    if (!response.ok)
      return res.status(response.status).json({ error: `${tag} exchange failed`, detail: result.parsed || result.raw?.slice(0, 500) });
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: `${tag} exchange timed out` });
    logError(`${tag}-exchange`, e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

app.post('/api/hyperliquid', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://api.hyperliquid.xyz/info',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      10_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid timed out' });
    logError('hyperliquid', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/hyperliquid/exchange',
  (req, res) => proxyHyperliquidExchange(req, res, 'https://api.hyperliquid.xyz', 'Hyperliquid'));

app.post('/api/hyperliquid-testnet', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://api.hyperliquid-testnet.xyz/info',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      10_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid testnet timed out' });
    logError('hyperliquid-testnet', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/hyperliquid-testnet/exchange',
  (req, res) => proxyHyperliquidExchange(req, res, 'https://api.hyperliquid-testnet.xyz', 'Hyperliquid testnet'));

let _solPriceCache = { p: 0, ts: 0 };
async function fetchSolPriceUsd() {
  const now = Date.now();
  if (now - _solPriceCache.ts < 30_000 && _solPriceCache.p > 0) return _solPriceCache.p;
  const r = await fetchWithTimeout(OKX_TICKER_URL, { method: 'GET' }, 8_000);
  const d = await r.json();
  const p = Number(d?.data?.[0]?.last || 0);
  if (!Number.isFinite(p) || p <= 0) throw new Error('SOL price unavailable');
  _solPriceCache = { p, ts: now };
  return p;
}

app.get('/api/sol-price', async (req, res) => {
  try {
    res.json({ price: await fetchSolPriceUsd(), ts: Date.now() });
  } catch (e) {
    logError('sol-price', e);
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── LI.FI proxy ──────────────────────────────────────────────────────── */
function buildLifiHeaders() {
  const h = { Accept: 'application/json' };
  if (LIFI_API_KEY) h['x-lifi-api-key'] = LIFI_API_KEY;
  return h;
}

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

/* ── Withdraw (non-custodial) ─────────────────────────────────────────── */
const bridgeTracking = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [k, v] of bridgeTracking.entries())
    if ((v.completed_at || v.created_at) < cutoff) bridgeTracking.delete(k);
}, 5 * 60_000).unref();

let _arbProvider = null, _operatorWallet = null;
function getOperatorWallet() {
  if (!_operatorWallet) {
    if (!OPERATOR_PRIVATE_KEY) throw new Error('OPERATOR_PRIVATE_KEY not set');
    _arbProvider    = new ethers.JsonRpcProvider(ARB_RPC_URL);
    _operatorWallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY, _arbProvider);
    if (_operatorWallet.address.toLowerCase() !== OPERATOR_WALLET_ADDR.toLowerCase())
      throw new Error('OPERATOR_PRIVATE_KEY mismatch: controls ' + _operatorWallet.address + ' expected ' + OPERATOR_WALLET_ADDR);
  }
  return _operatorWallet;
}

function validateUsdAmount(amount, min) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < min) return `minimum amount is $${min}`;
  const dec = String(amount).trim().split('.')[1]?.length || 0;
  if (dec > 2) return 'maximum 2 decimal places';
  return null;
}

app.post('/api/bridge/withdraw/init', async (req, res) => {
  try {
    if (!OPERATOR_PRIVATE_KEY)
      return res.status(503).json({ error: 'Bridge not configured -- set OPERATOR_PRIVATE_KEY' });
    const { hl_wallet_address, usd_amount, user_sol_addr } = req.body || {};
    if (!hl_wallet_address || !usd_amount || !user_sol_addr)
      return res.status(400).json({ error: 'missing params' });
    if (!ethers.isAddress(hl_wallet_address))
      return res.status(400).json({ error: 'invalid HL wallet' });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(user_sol_addr)))
      return res.status(400).json({ error: 'invalid Solana address' });
    const amountErr = validateUsdAmount(usd_amount, 5);
    if (amountErr) return res.status(400).json({ error: amountErr });

    const usdNum = Number(usd_amount);
    const time   = Date.now();
    const action = {
      type:             'withdraw3',
      signatureChainId: '0xa4b1',
      hyperliquidChain: 'Mainnet',
      amount:           String(usdNum),
      time,
      destination:      hl_wallet_address, // non-custodial: straight to user's own EVM address
    };
    const id = crypto.randomBytes(8).toString('hex');
    bridgeTracking.set(id, {
      kind: 'withdraw', status: 'awaiting_signature',
      hl_wallet_address, user_sol_addr, usd_amount: usdNum,
      action, created_at: time,
    });
    res.json({ tracking_id: id, action });
  } catch (err) {
    logError('bridge-withdraw-init', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

app.post('/api/bridge/withdraw/submit', async (req, res) => {
  try {
    const { tracking_id, signature } = req.body || {};
    const t = bridgeTracking.get(tracking_id);
    if (!t || t.kind !== 'withdraw') return res.status(404).json({ error: 'tracking_id not found' });
    if (!signature) return res.status(400).json({ error: 'missing signature' });
    const sigErr = validateHyperliquidSignature(signature);
    if (sigErr) return res.status(400).json({ error: sigErr });
    if (t.status !== 'awaiting_signature')
      return res.json({ ok: true, status: t.status, already_running: true });
    t.status    = 'withdrawing';
    t.signature = signature;
    runWithdrawPipeline(tracking_id).catch(err => {
      t.status = 'failed';
      t.error  = err.message;
      logError('bridge-withdraw-pipeline', err);
    });
    res.json({ ok: true, status: t.status });
  } catch (err) {
    logError('bridge-withdraw-submit', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

app.get('/api/bridge/withdraw/status', (req, res) => {
  const t = bridgeTracking.get(String(req.query.id || ''));
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({ status: t.status, error: t.error || null, completed_at: t.completed_at || null });
});

async function runWithdrawPipeline(tid) {
  const t = bridgeTracking.get(tid);
  if (!t) return;
  try {
    // 1. Submit withdraw3 to Hyperliquid -- USDC goes straight to user's hlAddress
    const body = { action: t.action, nonce: t.action.time, signature: t.signature };
    const ve   = validateHyperliquidExchangePayload(body);
    if (ve) throw new Error('Invalid HL payload: ' + ve);

    const hlResp = await fetchWithTimeout(
      `${HL_API}/exchange`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      15_000,
    );
    const hlData = await hlResp.json();
    if (hlData.status !== 'ok')
      throw new Error('HL withdraw3 failed: ' + JSON.stringify(hlData).slice(0, 300));

    t.status = 'bridging';

    // 2. Sponsor gas -- send 0.001 ETH to user's hlAddress so they can bridge ARB -> SOL
    const wallet = getOperatorWallet();
    const gasTx  = await wallet.sendTransaction({
      to:    t.hl_wallet_address,
      value: ethers.parseEther('0.001'),
    });
    await gasTx.wait();

    t.status       = 'complete';
    t.completed_at = Date.now();
  } catch (err) {
    t.status = 'failed';
    t.error  = err.message;
    logError('withdraw-pipeline', err);
  }
}

/* ── PumpPortal ───────────────────────────────────────────────────────── */
app.post('/api/pumpportal/trade-local', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://pumpportal.fun/api/trade-local',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      15_000,
    );
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: 'PumpPortal failed', detail: text.slice(0, 300) });
    }
    res.set('Content-Type', 'application/octet-stream');
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'PumpPortal timed out' });
    logError('pumpportal', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── Helius / Solana RPC ──────────────────────────────────────────────── */
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

/* ── Pinata ───────────────────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype || ''))
      return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

app.post('/api/pinata/json', uploadLimiter, async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
    const { name, content } = req.body || {};
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Missing content' });
    const response = await fetchWithTimeout(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PINATA_JWT },
        body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: (name || 'metadata').slice(0, 64) } }),
      },
      20_000,
    );
    const result = await safeJson(response);
    if (result.parsed?.IpfsHash)
      return res.json({ ipfsHash: result.parsed.IpfsHash, url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash });
    return res.status(response.status).json({ error: 'Pinata upload failed', detail: result.parsed || result.raw?.slice(0, 300) });
  } catch (e) {
    logError('pinata-json', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/pinata/file', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
    if (!req.file)   return res.status(400).json({ error: 'No file uploaded' });
    const fd = new FormData();
    fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'upload');
    if (req.body?.name) fd.append('pinataMetadata', JSON.stringify({ name: String(req.body.name).slice(0, 64) }));
    const response = await fetchWithTimeout(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      { method: 'POST', headers: { Authorization: 'Bearer ' + PINATA_JWT }, body: fd },
      30_000,
    );
    const result = await safeJson(response);
    if (result.parsed?.IpfsHash)
      return res.json({ ipfsHash: result.parsed.IpfsHash, url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash });
    return res.status(response.status).json({ error: 'Pinata upload failed', detail: result.parsed || result.raw?.slice(0, 300) });
  } catch (e) {
    logError('pinata-file', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── Health ───────────────────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true, env: NODE_ENV,
    has: {
      okx:            Boolean(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE),
      okxProject:     Boolean(OKX_PROJECT_ID),
      jupiter:        Boolean(JUPITER_ENABLED),
      jupiterApiKey:  Boolean(JUPITER_API_KEY),
      helius:         Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      pinata:         Boolean(PINATA_JWT),
      feeWalletSol:   Boolean(OKX_FEE_WALLET_SOL),
      feeWalletEvm:   Boolean(OKX_FEE_WALLET_EVM),
      bridgeOperator: Boolean(OPERATOR_PRIVATE_KEY),
      lifiApiKey:     Boolean(LIFI_API_KEY),
    },
    bridge: OPERATOR_PRIVATE_KEY ? {
      operator:     OPERATOR_WALLET_ADDR,
      arbRpc:       ARB_RPC_URL,
      active:       bridgeTracking.size,
      depositPath:  'frontend LI.FI API -- SOL -> HyperCore (chainId 1337)',
      withdrawPath: 'HL withdraw3 -> user hlAddress -> operator sponsors 0.001 ETH gas -> client bridges ARB->SOL via LI.FI',
      custodial:    false,
    } : { enabled: false },
    lifi: { baseUrl: LIFI_API, hyperCoreChainId: 1337, solanaChainId: 1151111081099710 },
    time: new Date().toISOString(),
  });
});

app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.path }));

app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.message?.startsWith('Not allowed by CORS'))
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  if (err?.type === 'entity.too.large' || err?.status === 413)
    return res.status(413).json({ error: 'Request body too large' });
  if (err?.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  if (err?.message === 'Only image files are allowed')
    return res.status(400).json({ error: err.message });
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File too large (max 5MB)' });
  if (err?.code === 'LIMIT_UNEXPECTED_FILE')
    return res.status(400).json({ error: 'Unexpected file field -- use field name "file"' });
  logError('unhandled', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('Nexus DEX server on port ' + PORT);
  console.log('  env:             ' + NODE_ENV);
  console.log('  allowed origins: ' + allowedOrigins.join(', '));
  console.log('  LI.FI base:      ' + LIFI_API);
  console.log('  LI.FI API key:   ' + (LIFI_API_KEY ? 'set' : 'not set (rate limits apply)'));
  console.log('  HyperCore chainId: 1337');
  console.log('  Withdraw:        ' + (OPERATOR_PRIVATE_KEY ? 'non-custodial, gas sponsor ' + OPERATOR_WALLET_ADDR : 'disabled'));
  if (OPERATOR_PRIVATE_KEY) {
    try   { const w = getOperatorWallet(); console.log('  Operator key:    verified -> ' + w.address); }
    catch (e) { console.error('  Operator key:    INVALID --', e.message); }
  }
  if (!OKX_API_KEY)          console.warn('  WARNING: OKX credentials missing');
  if (!HELIUS_API_KEY && !HELIUS_RPC_URL) console.warn('  WARNING: No Helius key');
  if (!OPERATOR_PRIVATE_KEY) console.warn('  WARNING: OPERATOR_PRIVATE_KEY not set');
});

process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));
