/**
 * NEXUS DEX - Backend Proxy Server
 * 
 * Active routes: 
 * /api/okx/*                        - OKX DEX aggregator + quote/token data + market data
 * /api/jupiter/quote                - Jupiter Solana quote fallback
 * /api/jupiter/swap                 - Jupiter Solana swap fallback
 * /api/jupiter/tokens/v2/toporganicscore/:timeframe - Jupiter top tokens
 * /api/jupiter/tokens/v2/tag        - Jupiter token registry
 * /api/dexscreener/*                - DexScreener proxy (markets, portfolio prices)
 * /api/hyperliquid                  - Hyperliquid proxy (perps info)
 * /api/hyperliquid/exchange         - Hyperliquid exchange proxy (signed orders)
 * /api/hyperliquid-testnet          - Hyperliquid TESTNET info proxy
 * /api/hyperliquid-testnet/exchange - Hyperliquid TESTNET exchange proxy
 * /api/pumpportal/*                 - PumpPortal trade-local
 * /api/helius/das                   - Helius DAS getAsset / Solana metadata fallback
 * /api/solana-rpc                   - Solana RPC proxy
 * /api/pinata/json                  - Pinata pinJSONToIPFS
 * /api/pinata/file                  - Pinata pinFileToIPFS
 * /api/health                       - healthcheck
 *
 * Removed:
 * /api/0x/*
 * /api/lifi/*
 *
 * Frontend must NOT send secret API headers.
 * OKX, Jupiter, Pinata, and Helius credentials are added server-side only.
 */
require('dotenv').config();
const crypto = require('crypto');
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
/* -- SECURITY HEADERS ------------------------------------------------------- */
const CSP_MODE = (process.env.CSP_MODE || 'report-only').toLowerCase();
const CSP_REPORT_URI = (process.env.CSP_REPORT_URI || '').trim();
const _csv = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const EXTRA_CONNECT_SRC = _csv(process.env.EXTRA_CSP_CONNECT_SRC);
const EXTRA_FRAME_SRC = _csv(process.env.EXTRA_CSP_FRAME_SRC);
const EXTRA_SCRIPT_SRC = _csv(process.env.EXTRA_CSP_SCRIPT_SRC);
const CSP_DIRECTIVES = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com', ...EXTRA_SCRIPT_SRC]],
  ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
  ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
  ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['frame-src', [
    "'self'",
    'https://auth.privy.io',
    'https://verify.walletconnect.com',
    'https://verify.walletconnect.org',
    'https://challenges.cloudflare.com',
    ...EXTRA_FRAME_SRC,
  ]],
  ['child-src', [
    "'self'",
    'https://auth.privy.io',
    'https://verify.walletconnect.com',
    'https://verify.walletconnect.org',
  ]],
  ['connect-src', [
    "'self'",
    'https://web3.okx.com',
    'https://quote-api.jup.ag',
    'https://lite-api.jup.ag',
    'https://api.jup.ag',
    'https://token.jup.ag',
    'https://api.hyperliquid.xyz',
    'https://api.hyperliquid-testnet.xyz',
    'https://pumpportal.fun',
    'wss://pumpportal.fun',
    'https://api.dexscreener.com',
    'https://*.dexscreener.com',
    'https://auth.privy.io',
    'https://*.privy.io',
    'https://*.privy.systems',
    'https://*.rpc.privy.systems',
    'https://explorer-api.walletconnect.com',
    'https://*.walletconnect.com',
    'https://*.walletconnect.org',
    'wss://relay.walletconnect.com',
    'wss://relay.walletconnect.org',
    'wss://*.walletconnect.com',
    'wss://*.walletconnect.org',
    'wss://www.walletlink.org',
    'https://api.mainnet-beta.solana.com',
    'https://mainnet.helius-rpc.com',
    'https://*.helius-rpc.com',
    'https://api.pinata.cloud',
    'https://*.publicnode.com',
    'https://*.drpc.org',
    ...EXTRA_CONNECT_SRC,
  ]],
  ['worker-src', ["'self'", 'blob:']],
  ['manifest-src', ["'self'"]],
];
const _cspParts = CSP_DIRECTIVES.map(e => e[0] + ' ' + e[1].join(' '));
if (CSP_REPORT_URI) _cspParts.push('report-uri ' + CSP_REPORT_URI);
const CSP_VALUE = _cspParts.join('; ');
const CSP_HEADER_NAME = CSP_MODE === 'enforce'
  ? 'Content-Security-Policy'
  : 'Content-Security-Policy-Report-Only';
const HSTS_ENABLED = NODE_ENV === 'production' && process.env.HSTS_DISABLE !== '1';
console.log('[security] CSP mode:', CSP_MODE, '-> header:', CSP_HEADER_NAME);
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') return next();
  res.setHeader(CSP_HEADER_NAME, CSP_VALUE);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()');
  if (HSTS_ENABLED) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
/* -- SECRETS / ENV ---------------------------------------------------------- */
const OKX_API_KEY = process.env.OKX_API_KEY || '';
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY || '';
const OKX_PASSPHRASE = process.env.OKX_API_PASSPHRASE || '';
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID || '';
const OKX_FEE_WALLET_SOL = process.env.OKX_FEE_WALLET_SOL || '';
const OKX_FEE_WALLET_EVM = process.env.OKX_FEE_WALLET_EVM || '';
const OKX_SOL_FEE_PCT = process.env.OKX_SOL_FEE_PCT || '5';
const OKX_EVM_FEE_PCT = process.env.OKX_EVM_FEE_PCT || '3';
const OKX_SOLANA_CHAIN = '501';
const JUPITER_ENABLED = process.env.JUPITER_ENABLED === '1';
const JUPITER_FALLBACK_ONLY = process.env.JUPITER_FALLBACK_ONLY !== '0';
const JUPITER_ACCOUNT = process.env.JUPITER_ACCOUNT || 'NEXUS_DEX_FALLBACK';
const JUPITER_QUOTE_BASE = (process.env.JUPITER_QUOTE_BASE || 'https://quote-api.jup.ag/v6').replace(/\/+$/, '');
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC || '';
const PINATA_JWT = process.env.PINATA_JWT || '';
/* -- CORS + JSON ------------------------------------------------------------ */
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || 'https://swap.verixiaapps.com,http://localhost:3000'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
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
/* -- RATE LIMITING ---------------------------------------------------------- */
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
  skip: r => r.path === '/health' || r.path === '/api/health',
});
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, slow down.' },
});
app.use('/api/', apiLimiter);
/* -- HELPERS ---------------------------------------------------------------- */
async function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
async function safeJson(response) {
  const text = await response.text();
  try {
    return { parsed: JSON.parse(text), raw: null };
  } catch {
    return { parsed: null, raw: text };
  }
}
function scrubSecrets(s) {
  if (s == null) return '';
  return String(s)
    .replace(/OK-ACCESS-KEY["':\s]+[^&\s"',}]+/gi, 'OK-ACCESS-KEY=***')
    .replace(/OK-ACCESS-SIGN["':\s]+[^&\s"',}]+/gi, 'OK-ACCESS-SIGN=***')
    .replace(/OK-ACCESS-PASSPHRASE["':\s]+[^&\s"',}]+/gi, 'OK-ACCESS-PASSPHRASE=***')
    .replace(/api-key=[^&\s"']+/gi, 'api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}
function logError(tag, err) {
  const msg = scrubSecrets(err && err.message ? err.message : err);
  if (NODE_ENV === 'production') {
    console.warn('[' + tag + ']', msg);
  } else {
    const stack = err && err.stack ? scrubSecrets(err.stack) : '';
    console.error('[' + tag + ']', msg, stack ? '\n' + stack : '');
  }
}
function queryStringOf(req) {
  const u = req.originalUrl || req.url || '';
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(i) : '';
}
function respondJsonOrError(res, response, result) {
  if (result.parsed !== null) {
    return res.status(response.status).json(result.parsed);
  }
  return res.status(response.status).json({
    error: 'Upstream returned non-JSON',
    body: result.raw && result.raw.slice(0, 500),
  });
}
function buildForwardedQuery(req) {
  const rawQs = queryStringOf(req);
  return rawQs || '';
}
/* -- SMALL GET CACHE -------------------------------------------------------- */
const getCache = new Map();
function getCachedJson(url) {
  const hit = getCache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    getCache.delete(url);
    return null;
  }
  return hit;
}
function setCachedJson(url, status, payload, ttlMs) {
  getCache.set(url, {
    status,
    payload,
    expiresAt: Date.now() + ttlMs,
  });
  if (getCache.size > 250) {
    const firstKey = getCache.keys().next().value;
    if (firstKey) getCache.delete(firstKey);
  }
}
/* -- OKX HMAC SIGNING ------------------------------------------------------- */
function okxSign(timestamp, method, okxPath, body) {
  const prehash = timestamp + method.toUpperCase() + okxPath + (body || '');
  return crypto.createHmac('sha256', OKX_SECRET_KEY).update(prehash).digest('base64');
}
function buildOkxHeaders(method, okxPath, body) {
  const ts = new Date().toISOString();
  return {
    'OK-ACCESS-KEY': OKX_API_KEY,
    'OK-ACCESS-SIGN': okxSign(ts, method, okxPath, body),
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
    'OK-PROJECT': OKX_PROJECT_ID,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
/* -- OKX FEE INJECTION ------------------------------------------------------ */
/*
 * Fees are injected into ALL Solana swap routes.
 * DO NOT CHANGE FEE VALUES HERE UNLESS INTENTIONALLY CHANGING MONETIZATION.
 */
const OKX_ALLOWED_ENDPOINTS = new Set([
  '/dex/aggregator/quote',
  '/dex/aggregator/swap',
  '/dex/aggregator/swap-instruction',
  '/dex/aggregator/tokens',
  '/dex/aggregator/all-tokens',
  '/dex/aggregator/liquidity-sources',
  '/dex/aggregator/supported/chain',
  '/dex/aggregator/approve-transaction',
  '/dex/aggregator/pre-transaction',
  '/dex/aggregator/transaction',
  '/dex/aggregator/history',
  '/dex/market/token/basic-info',
  '/dex/market/candles',
  '/dex/market/price',
]);
function injectOkxFee(params) {
  if (OKX_FEE_WALLET_SOL && OKX_SOL_FEE_PCT) {
    params.set('toTokenReferrerWalletAddress', OKX_FEE_WALLET_SOL);
    params.set('feePercent', OKX_SOL_FEE_PCT);
  }
  return params;
}
/* -- OKX DEX PROXY ---------------------------------------------------------- */
async function proxyOkx(req, res) {
  try {
    if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
      return res.status(503).json({ error: 'OKX DEX API credentials not configured' });
    }
    const subPath = req.path.replace('/api/okx', '');
    const rawQs = queryStringOf(req);
    if (!OKX_ALLOWED_ENDPOINTS.has(subPath)) {
      return res.status(404).json({ error: 'OKX endpoint not allowed: ' + subPath });
    }
    const params = new URLSearchParams(rawQs.slice(1));
    const isSolana = params.get('chainIndex') === OKX_SOLANA_CHAIN;
    const isSwapEndpoint = subPath === '/dex/aggregator/swap' || subPath === '/dex/aggregator/swap-instruction';
    if (isSolana && isSwapEndpoint) {
      injectOkxFee(params);
    }
    const finalQs = '?' + params.toString();
    const okxPath = '/api/v6' + subPath + finalQs;
    const okxUrl = 'https://web3.okx.com' + okxPath;
    console.log('[okx-debug] final URL:', okxUrl);
    const bodyStr = (req.method !== 'GET' && req.method !== 'HEAD' && req.body)
      ? JSON.stringify(req.body)
      : '';
    const headers = buildOkxHeaders(req.method, okxPath, bodyStr);
    const fetchOpts = { method: req.method, headers };
    if (bodyStr) fetchOpts.body = bodyStr;
    const shouldCache =
      req.method === 'GET' &&
      (
        subPath === '/dex/aggregator/tokens' ||
        subPath === '/dex/aggregator/all-tokens' ||
        subPath === '/dex/aggregator/liquidity-sources' ||
        subPath === '/dex/aggregator/supported/chain'
      );
    if (shouldCache) {
      const cached = getCachedJson(okxUrl);
      if (cached) return res.status(cached.status).json(cached.payload);
    }
    const response = await fetchWithTimeout(okxUrl, fetchOpts, 15_000);
    const result = await safeJson(response);
    if (shouldCache && response.ok && result.parsed !== null) {
      setCachedJson(okxUrl, response.status, result.parsed, 60_000);
    }
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'OKX request timed out' });
    }
    logError('okx', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
app.get('/api/okx/*', proxyOkx);
app.post('/api/okx/*', proxyOkx);
/* -- JUPITER FALLBACK PROXY ------------------------------------------------- */
/*
 * Jupiter is added as a Solana-only fallback.
 * It is not primary routing.
 * It does not touch OKX fees.
 * Backend never signs transactions.
 */
function buildJupiterHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Nexus-Account': JUPITER_ACCOUNT,
  };
  if (JUPITER_API_KEY) {
    headers['x-api-key'] = JUPITER_API_KEY;
  }
  return headers;
}
app.get('/api/jupiter/quote', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) {
      return res.status(503).json({ error: 'Jupiter fallback disabled' });
    }
    const qs = buildForwardedQuery(req);
    const url = JUPITER_QUOTE_BASE + '/quote' + qs;
    const cached = getCachedJson(url);
    if (cached) return res.status(cached.status).json(cached.payload);
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildJupiterHeaders(),
    }, 12_000);
    const result = await safeJson(response);
    if (response.ok && result.parsed !== null) {
      setCachedJson(url, response.status, result.parsed, 8_000);
    }
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Jupiter quote request timed out' });
    }
    logError('jupiter-quote', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
app.post('/api/jupiter/swap', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) {
      return res.status(503).json({ error: 'Jupiter fallback disabled' });
    }
    const body = req.body || {};
    if (!body.userPublicKey) {
      return res.status(400).json({ error: 'Missing userPublicKey for Jupiter swap' });
    }
    if (!body.quoteResponse) {
      return res.status(400).json({ error: 'Missing quoteResponse for Jupiter swap' });
    }
    const url = JUPITER_QUOTE_BASE + '/swap';
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildJupiterHeaders(),
      body: JSON.stringify(body),
    }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Jupiter swap request timed out' });
    }
    logError('jupiter-swap', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- JUPITER TOKEN PROXY (markets + registry) ------------------------------ */
app.get('/api/jupiter/tokens/v2/toporganicscore/:timeframe', async (req, res) => {
  try {
    const url = `https://lite-api.jup.ag/tokens/v2/toporganicscore/${req.params.timeframe || '24h'}${buildForwardedQuery(req)}`;
    const cached = getCachedJson(url);
    if (cached) return res.status(cached.status).json(cached.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 30_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter tokens request timed out' });
    logError('jupiter-tokens', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
app.get('/api/jupiter/tokens/v2/tag', async (req, res) => {
  try {
    const url = `https://token.jup.ag/tokens/v2/tag${buildForwardedQuery(req)}`;
    const cached = getCachedJson(url);
    if (cached) return res.status(cached.status).json(cached.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12_000);
    const result = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 300_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter registry request timed out' });
    logError('jupiter-registry', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- DEXSCREENER PROXY (markets + portfolio prices) ----------------------- */
app.get('/api/dexscreener/*', async (req, res) => {
  try {
    const path = req.path.replace('/api/dexscreener', '');
    const url = 'https://api.dexscreener.com' + path + buildForwardedQuery(req);
    const cached = getCachedJson(url);
    if (cached) return res.status(cached.status).json(cached.payload);
    const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10_000);
    const result = await safeJson(response);
    if (response.ok && result.parsed) setCachedJson(url, response.status, result.parsed, 15_000);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'DexScreener request timed out' });
    logError('dexscreener', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HYPERLIQUID PROXY (perps info - MAINNET) ----------------------------- */
app.post('/api/hyperliquid', async (req, res) => {
  try {
    const body = req.body || {};
    const response = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 10_000);
    const result = await safeJson(response);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid request timed out' });
    logError('hyperliquid', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HYPERLIQUID EXCHANGE PROXY (signed orders - MAINNET) ----------------- */
app.post('/api/hyperliquid/exchange', async (req, res) => {
  try {
    const body = req.body || {};
    const response = await fetchWithTimeout('https://api.hyperliquid.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'Hyperliquid exchange request failed',
        detail: text.slice(0, 500),
      });
    }
    const result = await safeJson(response);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid exchange request timed out' });
    logError('hyperliquid-exchange', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HYPERLIQUID TESTNET PROXY (perps info) ------------------------------ */
app.post('/api/hyperliquid-testnet', async (req, res) => {
  try {
    const body = req.body || {};
    const response = await fetchWithTimeout('https://api.hyperliquid-testnet.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 10_000);
    const result = await safeJson(response);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid testnet request timed out' });
    logError('hyperliquid-testnet', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HYPERLIQUID TESTNET EXCHANGE PROXY (signed orders) ----------------- */
app.post('/api/hyperliquid-testnet/exchange', async (req, res) => {
  try {
    const body = req.body || {};
    const response = await fetchWithTimeout('https://api.hyperliquid-testnet.xyz/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'Hyperliquid testnet exchange request failed',
        detail: text.slice(0, 500),
      });
    }
    const result = await safeJson(response);
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid testnet exchange request timed out' });
    logError('hyperliquid-testnet-exchange', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- PUMPPORTAL PROXY ------------------------------------------------------- */
app.post('/api/pumpportal/trade-local', async (req, res) => {
  try {
    const body = req.body || {};
    const response = await fetchWithTimeout('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'PumpPortal trade-local failed',
        detail: text.slice(0, 300),
      });
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'application/octet-stream');
    return res.send(buf);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'PumpPortal request timed out' });
    }
    logError('pumpportal', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HELIUS / SOLANA RPC ---------------------------------------------------- */
function getSolanaRpcUrl() {
  if (HELIUS_RPC_URL) return HELIUS_RPC_URL;
  if (HELIUS_API_KEY) {
    return 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY);
  }
  return 'https://api.mainnet-beta.solana.com';
}
app.post('/api/helius/das', async (req, res) => {
  try {
    const response = await fetchWithTimeout(getSolanaRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Helius DAS request timed out' });
    }
    logError('helius-das', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
app.post('/api/solana-rpc', async (req, res) => {
  try {
    const response = await fetchWithTimeout(getSolanaRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Solana RPC request timed out' });
    }
    logError('solana-rpc', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- PINATA ----------------------------------------------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.mimetype || '')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});
app.post('/api/pinata/json', uploadLimiter, async (req, res) => {
  try {
    if (!PINATA_JWT) {
      return res.status(503).json({ error: 'Pinata not configured' });
    }
    const { name, content } = req.body || {};
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ error: 'Missing content' });
    }
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + PINATA_JWT,
      },
      body: JSON.stringify({
        pinataContent: content,
        pinataMetadata: {
          name: (name || 'metadata').slice(0, 64),
        },
      }),
    }, 20_000);
    const result = await safeJson(response);
    if (result.parsed && result.parsed.IpfsHash) {
      return res.json({
        ipfsHash: result.parsed.IpfsHash,
        url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
      });
    }
    return res.status(response.status).json({
      error: 'Pinata upload failed',
      detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
    });
  } catch (e) {
    logError('pinata-json', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
app.post('/api/pinata/file', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!PINATA_JWT) {
      return res.status(503).json({ error: 'Pinata not configured' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fd = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    fd.append('file', blob, req.file.originalname || 'upload');
    if (req.body && req.body.name) {
      fd.append('pinataMetadata', JSON.stringify({
        name: String(req.body.name).slice(0, 64),
      }));
    }
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + PINATA_JWT,
      },
      body: fd,
    }, 30_000);
    const result = await safeJson(response);
    if (result.parsed && result.parsed.IpfsHash) {
      return res.json({
        ipfsHash: result.parsed.IpfsHash,
        url: 'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
      });
    }
    return res.status(response.status).json({
      error: 'Pinata upload failed',
      detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
    });
  } catch (e) {
    logError('pinata-file', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});
/* -- HEALTHCHECK ------------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    has: {
      okx: Boolean(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE),
      okxProject: Boolean(OKX_PROJECT_ID),
      jupiter: Boolean(JUPITER_ENABLED),
      jupiterApiKey: Boolean(JUPITER_API_KEY),
      helius: Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      pinata: Boolean(PINATA_JWT),
      feeWalletSol: Boolean(OKX_FEE_WALLET_SOL),
      feeWalletEvm: Boolean(OKX_FEE_WALLET_EVM),
    },
    routes: {
      okx: true,
      jupiterQuote: JUPITER_ENABLED,
      jupiterSwap: JUPITER_ENABLED,
      jupiterTokens: true,
      jupiterRegistry: true,
      dexscreener: true,
      hyperliquid: true,
      hyperliquidExchange: true,
      hyperliquidTestnet: true,
      hyperliquidTestnetExchange: true,
      pumpportal: true,
      helius: true,
      solanaRpc: true,
      pinata: Boolean(PINATA_JWT),
    },
    mode: {
      okxPrimary: true,
      jupiterFallbackOnly: JUPITER_FALLBACK_ONLY,
      jupiterAccount: JUPITER_ACCOUNT,
      jupiterQuoteBase: JUPITER_QUOTE_BASE,
    },
    removed: {
      lifi: true,
      zeroX: true,
    },
    fees: {
      note: 'OKX fees are injected only into executable OKX swap routes, not quote routes. Jupiter fallback does not change OKX fee settings.',
      solana: OKX_SOL_FEE_PCT + '%',
      evm: OKX_EVM_FEE_PCT + '%',
    },
    time: new Date().toISOString(),
  });
});
/* -- 404 FOR UNMATCHED API ROUTES ------------------------------------------ */
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found: ' + req.path });
});
/* -- SPA STATIC + CATCH-ALL ------------------------------------------------- */
app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
/* -- ERROR HANDLER ---------------------------------------------------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith('Not allowed by CORS')) {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err && err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 5MB)' });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field - use field name "file"' });
  }
  logError('unhandled', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});
/* -- BOOT ------------------------------------------------------------------- */
app.listen(PORT, () => {
  console.log('Nexus DEX server running on port ' + PORT);
  console.log('  env:             ' + NODE_ENV);
  console.log('  allowed origins: ' + allowedOrigins.join(', '));
  console.log('  OKX fees:        Solana ' + OKX_SOL_FEE_PCT + '%  EVM ' + OKX_EVM_FEE_PCT + '%');
  console.log('  quote fees:      disabled');
  console.log('  Jupiter:         ' + (JUPITER_ENABLED ? 'enabled' : 'disabled'));
  console.log('  Jupiter mode:    ' + (JUPITER_FALLBACK_ONLY ? 'fallback-only' : 'available'));
  console.log('  Jupiter account: ' + JUPITER_ACCOUNT);
  if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
    console.warn('  WARNING: OKX credentials missing - OKX routes will fail');
  }
  if (!OKX_PROJECT_ID) {
    console.warn('  WARNING: OKX_PROJECT_ID not set - recommended for production');
  }
  if (!OKX_FEE_WALLET_SOL) {
    console.warn('  WARNING: OKX_FEE_WALLET_SOL not set - Solana swap fees not collected');
  }
  if (!OKX_FEE_WALLET_EVM) {
    console.warn('  WARNING: OKX_FEE_WALLET_EVM not set - EVM swap fees not collected');
  }
  if (JUPITER_ENABLED && !JUPITER_API_KEY) {
    console.warn('  WARNING: JUPITER_API_KEY not set - using public Jupiter access');
  }
  if (!HELIUS_API_KEY && !HELIUS_RPC_URL) {
    console.warn('  WARNING: No Helius key - falling back to public Solana RPC');
  }
  if (!PINATA_JWT) {
    console.warn('  WARNING: PINATA_JWT not set - token launch uploads will fail');
  }
});
process.on('uncaughtException', err => {
  logError('uncaughtException', err);
});
process.on('unhandledRejection', err => {
  logError('unhandledRejection', err);
});