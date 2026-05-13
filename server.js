/**
 * NEXUS DEX — Backend Proxy Server 
 *
 * Active routes:
 *   /api/okx/*                        OKX DEX aggregator + cross-chain
 *   /api/jupiter/quote, /swap         Jupiter Solana fallback
 *   /api/jupiter/tokens/v2/…          Jupiter top tokens + registry
 *   /api/dexscreener/*                DexScreener proxy
 *   /api/hyperliquid                  Hyperliquid info proxy
 *   /api/hyperliquid/exchange         Hyperliquid signed-order forward
 *   /api/hyperliquid-testnet[/exchange]
 *   /api/sol-price                    Cached SOL/USD via OKX (for frontend Mayan quotes)
 *   /api/bridge/withdraw/*            HL → USDC.arb → SOL withdraw via operator + Mayan
 *   /api/pumpportal/*                 PumpPortal trade-local
 *   /api/helius/das                   Helius DAS / Solana metadata fallback
 *   /api/solana-rpc                   Solana RPC proxy
 *   /api/pinata/json, /file           Pinata pinning
 *   /api/health                       healthcheck
 *
 * Bridge architecture (NEW):
 *   DEPOSITS  — handled fully on the frontend via Mayan Swift SDK with
 *               toChain='hypercore'. No server endpoints needed; Mayan
 *               solvers deposit USDC directly to the user's HL margin
 *               account. ~12-30s settle, one Phantom popup.
 *
 *   WITHDRAWS — still server-orchestrated because the HL bridge can only
 *               pay USDC.arb to a single EOA (the operator). Flow:
 *               user signs withdraw3 silently → server submits to HL →
 *               ~3-4 min wait for HL validators to pay USDC.arb to operator
 *               → server uses Mayan swapFromEvm to bridge USDC.arb → SOL
 *               directly to user's Solana address. Mayan replaces deBridge
 *               so small amounts no longer time out.
 *
 *   Race safety: strict single-flight queue for all operator-state ops.
 *                HL arrivals detected via filtered Transfer events.
 *
 *   The operator wallet (0xeace…) only ever holds gas + brief USDC
 *   passthrough. Funds always recoverable because operator wallet and HL
 *   account share the same key.
 *
 *   New dependency: npm install @mayanfinance/swap-sdk
 */

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const ethers = require('ethers');
const mayan = require('@mayanfinance/swap-sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ── SECURITY HEADERS ─────────────────────────────────────────────────── */

const CSP_MODE = (process.env.CSP_MODE || 'report-only').toLowerCase();
const CSP_REPORT_URI = (process.env.CSP_REPORT_URI || '').trim();

const _csv = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const EXTRA_CONNECT_SRC = _csv(process.env.EXTRA_CSP_CONNECT_SRC);
const EXTRA_FRAME_SRC = _csv(process.env.EXTRA_CSP_FRAME_SRC);
const EXTRA_SCRIPT_SRC = _csv(process.env.EXTRA_CSP_SCRIPT_SRC);

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
    'https://price-api.mayan.finance',
    'https://explorer-api.mayan.finance',
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
  ['worker-src',   ["'self'", 'blob:']],
  ['manifest-src', ["'self'"]],
];

const _cspParts = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v.join(' ')}`);
if (CSP_REPORT_URI) _cspParts.push(`report-uri ${CSP_REPORT_URI}`);
const CSP_VALUE = _cspParts.join('; ');

const CSP_HEADER_NAME = CSP_MODE === 'enforce'
  ? 'Content-Security-Policy'
  : 'Content-Security-Policy-Report-Only';

const HSTS_ENABLED = NODE_ENV === 'production' && process.env.HSTS_DISABLE !== '1';

console.log('[security] CSP mode:', CSP_MODE, '→ header:', CSP_HEADER_NAME);

app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') return next();
  res.setHeader(CSP_HEADER_NAME, CSP_VALUE);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()');
  if (HSTS_ENABLED) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* ── SECRETS / ENV ────────────────────────────────────────────────────── */

const OKX_API_KEY        = process.env.OKX_API_KEY || '';
const OKX_SECRET_KEY     = process.env.OKX_SECRET_KEY || '';
const OKX_PASSPHRASE     = process.env.OKX_API_PASSPHRASE || '';
const OKX_PROJECT_ID     = process.env.OKX_PROJECT_ID || '';
const OKX_FEE_WALLET_SOL = process.env.OKX_FEE_WALLET_SOL || '';
const OKX_FEE_WALLET_EVM = process.env.OKX_FEE_WALLET_EVM || '';
const OKX_SOL_FEE_PCT    = process.env.OKX_SOL_FEE_PCT || '5';
const OKX_EVM_FEE_PCT    = process.env.OKX_EVM_FEE_PCT || '3';
const OKX_SOLANA_CHAIN   = '501';

const JUPITER_ENABLED        = process.env.JUPITER_ENABLED === '1';
const JUPITER_FALLBACK_ONLY  = process.env.JUPITER_FALLBACK_ONLY !== '0';
const JUPITER_ACCOUNT        = process.env.JUPITER_ACCOUNT || 'NEXUS_DEX_FALLBACK';
const JUPITER_QUOTE_BASE     = (process.env.JUPITER_QUOTE_BASE || 'https://quote-api.jup.ag/v6').replace(/\/+$/, '');
const JUPITER_API_KEY        = process.env.JUPITER_API_KEY || '';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC || '';
const PINATA_JWT     = process.env.PINATA_JWT || '';

// Bridge (Mayan for both legs; operator wallet only used on withdraw side)
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY || '';
const OPERATOR_WALLET_ADDR = '0xeace360F8faB3f739CBC4e026b58efC5866fAdC1';
const ARB_RPC_URL          = process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const HL_BRIDGE_ADDR       = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';
const USDC_ARB_ADDR        = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const HL_API               = 'https://api.hyperliquid.xyz';
const OKX_TICKER_URL       = 'https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT';
const MAYAN_EXPLORER_API   = 'https://explorer-api.mayan.finance';
const SOL_NATIVE_TOKEN     = '0x0000000000000000000000000000000000000000'; // Mayan uses zero addr for native on each chain

/* ── CORS + JSON ──────────────────────────────────────────────────────── */

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

/* ── RATE LIMITING ────────────────────────────────────────────────────── */

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

/* ── HELPERS ──────────────────────────────────────────────────────────── */

async function fetchWithTimeout(url, options, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
    .replace(/OK-ACCESS-KEY["':\s]+[^&\s"',}]+/gi,        'OK-ACCESS-KEY=***')
    .replace(/OK-ACCESS-SIGN["':\s]+[^&\s"',}]+/gi,       'OK-ACCESS-SIGN=***')
    .replace(/OK-ACCESS-PASSPHRASE["':\s]+[^&\s"',}]+/gi, 'OK-ACCESS-PASSPHRASE=***')
    .replace(/api-key=[^&\s"']+/gi,                        'api-key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,                 'Bearer ***')
    .replace(/privateKey["':\s]+[^&\s"',}]+/gi,            'privateKey=***')
    .replace(/signature["':\s]+\{[^}]+\}/gi,               'signature={***}');
}

function logError(tag, err) {
  const msg = scrubSecrets(err?.message ?? err);
  if (NODE_ENV === 'production') {
    console.warn(`[${tag}]`, msg);
  } else {
    const stack = err?.stack ? scrubSecrets(err.stack) : '';
    console.error(`[${tag}]`, msg, stack ? '\n' + stack : '');
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
  return queryStringOf(req) || '';
}

/* ── SMALL GET CACHE ──────────────────────────────────────────────────── */

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
  getCache.set(url, { status, payload, expiresAt: Date.now() + ttlMs });
  if (getCache.size > 250) {
    const firstKey = getCache.keys().next().value;
    if (firstKey) getCache.delete(firstKey);
  }
}

/* ── OKX HMAC SIGNING ─────────────────────────────────────────────────── */

function okxSign(timestamp, method, okxPath, body) {
  const prehash = timestamp + method.toUpperCase() + okxPath + (body || '');
  return crypto.createHmac('sha256', OKX_SECRET_KEY).update(prehash).digest('base64');
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

/* ── OKX FEE INJECTION ────────────────────────────────────────────────── */

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
  '/dex/market/price-info',
  '/dex/market/memepump/tokenList',
  '/dex/market/memepump/tokenDetails',
  '/dex/cross-chain/quote',
  '/dex/cross-chain/build-tx',
  '/dex/cross-chain/approve-transaction',
  '/dex/cross-chain/status',
  '/dex/cross-chain/supported/chains',
  '/dex/cross-chain/tokens',
  '/dex/cross-chain/token-pairs',
  '/dex/cross-chain/bridges',
]);

function injectOkxFee(params) {
  if (OKX_FEE_WALLET_SOL && OKX_SOL_FEE_PCT) {
    params.set('toTokenReferrerWalletAddress', OKX_FEE_WALLET_SOL);
    params.set('feePercent', OKX_SOL_FEE_PCT);
  }
  return params;
}

/* ── OKX DEX PROXY ────────────────────────────────────────────────────── */

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
    const isSwapEndpoint =
      subPath === '/dex/aggregator/swap' || subPath === '/dex/aggregator/swap-instruction';

    if (isSolana && isSwapEndpoint) injectOkxFee(params);

    const qsString = params.toString();
    const finalQs = qsString ? '?' + qsString : '';
    const okxPath = '/api/v6' + subPath + finalQs;
    const okxUrl = 'https://web3.okx.com' + okxPath;

    const bodyStr =
      req.method !== 'GET' && req.method !== 'HEAD' && req.body
        ? JSON.stringify(req.body)
        : '';

    const headers = buildOkxHeaders(req.method, okxPath, bodyStr);
    const fetchOpts = { method: req.method, headers };
    if (bodyStr) fetchOpts.body = bodyStr;

    const shouldCache = req.method === 'GET' && (
      subPath === '/dex/aggregator/tokens'            ||
      subPath === '/dex/aggregator/all-tokens'        ||
      subPath === '/dex/aggregator/liquidity-sources' ||
      subPath === '/dex/aggregator/supported/chain'   ||
      subPath === '/dex/cross-chain/supported/chains' ||
      subPath === '/dex/cross-chain/tokens'           ||
      subPath === '/dex/cross-chain/token-pairs'      ||
      subPath === '/dex/cross-chain/bridges'
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
    if (e.name === 'AbortError') return res.status(504).json({ error: 'OKX request timed out' });
    logError('okx', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

app.get('/api/okx/*', proxyOkx);
app.post('/api/okx/*', proxyOkx);

app.get('/api/test-price-info', async (req, res) => {
  try {
    const mint = req.query.mint || 'So11111111111111111111111111111111111111112';
    const body = JSON.stringify({ chainIndex: '501', tokenContractAddress: mint });
    const okxPath = '/api/v6/dex/market/price-info';
    const headers = buildOkxHeaders('POST', okxPath, body);
    const response = await fetchWithTimeout(
      'https://web3.okx.com' + okxPath,
      { method: 'POST', headers, body },
      15_000,
    );
    res.json(await response.json());
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* ── JUPITER FALLBACK PROXY ───────────────────────────────────────────── */

function buildJupiterHeaders() {
  const headers = {
    Accept:           'application/json',
    'Content-Type':   'application/json',
    'X-Nexus-Account': JUPITER_ACCOUNT,
  };
  if (JUPITER_API_KEY) headers['x-api-key'] = JUPITER_API_KEY;
  return headers;
}

app.get('/api/jupiter/quote', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter fallback disabled' });

    const url = JUPITER_QUOTE_BASE + '/quote' + buildForwardedQuery(req);
    const cached = getCachedJson(url);
    if (cached) return res.status(cached.status).json(cached.payload);

    const response = await fetchWithTimeout(
      url,
      { method: 'GET', headers: buildJupiterHeaders() },
      12_000,
    );
    const result = await safeJson(response);
    if (response.ok && result.parsed !== null) {
      setCachedJson(url, response.status, result.parsed, 8_000);
    }
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter quote request timed out' });
    logError('jupiter-quote', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/jupiter/swap', async (req, res) => {
  try {
    if (!JUPITER_ENABLED) return res.status(503).json({ error: 'Jupiter fallback disabled' });

    const body = req.body || {};
    if (!body.userPublicKey)  return res.status(400).json({ error: 'Missing userPublicKey for Jupiter swap' });
    if (!body.quoteResponse)  return res.status(400).json({ error: 'Missing quoteResponse for Jupiter swap' });

    const response = await fetchWithTimeout(
      JUPITER_QUOTE_BASE + '/swap',
      { method: 'POST', headers: buildJupiterHeaders(), body: JSON.stringify(body) },
      15_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Jupiter swap request timed out' });
    logError('jupiter-swap', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

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

/* ── DEXSCREENER PROXY ────────────────────────────────────────────────── */

app.get('/api/dexscreener/*', async (req, res) => {
  try {
    const subPath = req.path.replace('/api/dexscreener', '');
    const url = 'https://api.dexscreener.com' + subPath + buildForwardedQuery(req);

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

/* ── HYPERLIQUID HELPERS ──────────────────────────────────────────────── */

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isHexString(v, bytes) {
  const s = String(v || '');
  const len = bytes ? bytes * 2 : null;
  if (!s.startsWith('0x')) return false;
  if (len && s.length !== 2 + len) return false;
  return /^0x[0-9a-fA-F]+$/.test(s);
}

function validateHyperliquidSignature(sig) {
  if (!isPlainObject(sig))  return 'Missing signature object';
  if (!isHexString(sig.r, 32)) return 'Invalid signature.r';
  if (!isHexString(sig.s, 32)) return 'Invalid signature.s';
  const v = Number(sig.v);
  if (!Number.isInteger(v))    return 'Invalid signature.v';
  if (![0, 1, 27, 28].includes(v)) return 'Invalid signature.v';
  return null;
}

function validateHyperliquidExchangePayload(body) {
  if (!isPlainObject(body)) return 'Invalid request body';
  if (body.type === 'placeOrder') {
    return 'Unsigned router payload received. Frontend must sign Hyperliquid payload before sending to /api/hyperliquid/exchange.';
  }
  if (!isPlainObject(body.action)) return 'Missing action object';

  const nonce = Number(body.nonce);
  if (!Number.isInteger(nonce) || nonce <= 0) return 'Missing or invalid nonce';

  const sigErr = validateHyperliquidSignature(body.signature);
  if (sigErr) return sigErr;

  if (body.vaultAddress != null && !/^0x[a-fA-F0-9]{40}$/.test(String(body.vaultAddress))) {
    return 'Invalid vaultAddress';
  }
  if (body.expiresAfter != null) {
    const expiresAfter = Number(body.expiresAfter);
    if (!Number.isInteger(expiresAfter) || expiresAfter <= 0) return 'Invalid expiresAfter';
  }
  return null;
}

async function proxyHyperliquidExchange(req, res, baseUrl, tag) {
  try {
    const body = req.body || {};
    const validationError = validateHyperliquidExchangePayload(body);
    if (validationError) return res.status(400).json({ error: validationError });

    const response = await fetchWithTimeout(
      baseUrl + '/exchange',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      15_000,
    );
    const result = await safeJson(response);

    if (!response.ok) {
      return res.status(response.status).json({
        error:  `${tag} exchange request failed`,
        detail: result.parsed || (result.raw && result.raw.slice(0, 500)),
      });
    }
    return respondJsonOrError(res, response, result);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: `${tag} exchange request timed out` });
    }
    logError(`${tag}-exchange`, e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

/* ── HYPERLIQUID MAINNET ──────────────────────────────────────────────── */

app.post('/api/hyperliquid', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://api.hyperliquid.xyz/info',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      10_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid request timed out' });
    logError('hyperliquid', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/hyperliquid/exchange', (req, res) =>
  proxyHyperliquidExchange(req, res, 'https://api.hyperliquid.xyz', 'Hyperliquid'),
);

/* ── HYPERLIQUID TESTNET ──────────────────────────────────────────────── */

app.post('/api/hyperliquid-testnet', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://api.hyperliquid-testnet.xyz/info',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      10_000,
    );
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Hyperliquid testnet request timed out' });
    logError('hyperliquid-testnet', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

app.post('/api/hyperliquid-testnet/exchange', (req, res) =>
  proxyHyperliquidExchange(req, res, 'https://api.hyperliquid-testnet.xyz', 'Hyperliquid testnet'),
);

/* ── SOL PRICE (used by frontend for Mayan quote sizing) ──────────────── */

let _solPriceCache = { p: 0, ts: 0 };

async function fetchSolPriceUsd() {
  const now = Date.now();
  if (now - _solPriceCache.ts < 30_000 && _solPriceCache.p > 0) return _solPriceCache.p;

  const response = await fetchWithTimeout(OKX_TICKER_URL, { method: 'GET' }, 8_000);
  const data = await response.json();
  const p = Number(data?.data?.[0]?.last || 0);
  if (!Number.isFinite(p) || p <= 0) throw new Error('SOL price unavailable');

  _solPriceCache = { p, ts: now };
  return p;
}

app.get('/api/sol-price', async (req, res) => {
  try {
    const price = await fetchSolPriceUsd();
    res.json({ price, ts: Date.now() });
  } catch (e) {
    logError('sol-price', e);
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── BRIDGE: WITHDRAW (HL → USDC.arb → SOL via Mayan) ─────────────────── */

const USDC_ABI = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

let _arbProvider = null;
let _operatorWallet = null;

function getOperatorWallet() {
  if (!_operatorWallet) {
    if (!OPERATOR_PRIVATE_KEY) throw new Error('OPERATOR_PRIVATE_KEY not set');
    _arbProvider = new ethers.JsonRpcProvider(ARB_RPC_URL);
    _operatorWallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY, _arbProvider);
    if (_operatorWallet.address.toLowerCase() !== OPERATOR_WALLET_ADDR.toLowerCase()) {
      throw new Error(
        'OPERATOR_PRIVATE_KEY mismatch: key controls ' + _operatorWallet.address +
        ' but expected ' + OPERATOR_WALLET_ADDR,
      );
    }
  }
  return _operatorWallet;
}

const bridgeTracking = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// TTL cleanup — drop tracking entries older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of bridgeTracking.entries()) {
    if ((v.completed_at || v.created_at) < cutoff) bridgeTracking.delete(k);
  }
}, 5 * 60 * 1000).unref();

// HL EIP-712 action signing (server-side, signs with operator key)
async function signHlActionServer(wallet, action, typeName, eipFields) {
  const domain = {
    name: 'HyperliquidSignTransaction',
    version: '1',
    chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = { [`HyperliquidTransaction:${typeName}`]: eipFields };
  const message = {};
  for (const f of eipFields) message[f.name] = action[f.name];
  const sig = await wallet.signTypedData(domain, types, message);
  const split = ethers.Signature.from(sig);
  return { r: split.r, s: split.s, v: split.v };
}

// Strict serialization queue. All operator-state operations go through this.
let _bridgeQueue = Promise.resolve();
function queueBridge(fn) {
  const p = _bridgeQueue.then(fn, fn);
  _bridgeQueue = p.catch(() => {});
  return p;
}

// Wait for a USDC Transfer event from HL_BRIDGE_ADDR to operator with amount >= minAmount.
async function waitForHlWithdrawArrival(usdc, fromBlock, expectedRaw, slippagePct = 15, timeoutMs = 15 * 60 * 1000) {
  const provider = usdc.runner?.provider;
  if (!provider) throw new Error('Contract has no provider');
  const filter = usdc.filters.Transfer(HL_BRIDGE_ADDR, OPERATOR_WALLET_ADDR);
  const minAmount = expectedRaw * BigInt(100 - slippagePct) / 100n;
  const start = Date.now();
  let cursor = fromBlock;

  while (Date.now() - start < timeoutMs) {
    await sleep(15_000);
    let current;
    try {
      current = await provider.getBlockNumber();
    } catch {
      continue;
    }
    if (current < cursor) continue;

    try {
      const events = await usdc.queryFilter(filter, cursor, current);
      for (const event of events) {
        const amount = event.args?.value ?? event.args?.[2];
        if (amount != null && amount >= minAmount) {
          return { amount: BigInt(amount), txHash: event.transactionHash, blockNumber: event.blockNumber };
        }
      }
      cursor = current + 1;
    } catch {
      cursor = Math.max(cursor, current - 100);
    }
  }
  throw new Error('HL withdrawal timeout');
}

// Poll Mayan Explorer until the order completes or refunds. Returns clientStatus.
async function waitForMayanFulfillment(txHash, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(8_000);
    try {
      const r = await fetchWithTimeout(
        `${MAYAN_EXPLORER_API}/v3/swaps/trx/${txHash}`,
        { method: 'GET' },
        8_000,
      );
      if (!r.ok) continue;
      const data = await r.json();
      const status = data?.clientStatus || data?.status;
      if (status === 'COMPLETED') return { status, data };
      if (status === 'REFUNDED' || status === 'FAILED') {
        throw new Error('Mayan ' + status);
      }
    } catch (e) {
      if (e.message && e.message.startsWith('Mayan ')) throw e;
    }
  }
  throw new Error('Mayan fulfillment timeout');
}

function validateUsdAmount(amount, min) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < min) return `minimum amount is $${min}`;
  const str = String(amount).trim();
  const decimals = str.includes('.') ? (str.split('.')[1] || '').length : 0;
  if (decimals > 2) return 'maximum 2 decimal places';
  return null;
}

/* ──── WITHDRAW endpoints ──── */

app.post('/api/bridge/withdraw/init', async (req, res) => {
  try {
    if (!OPERATOR_PRIVATE_KEY) {
      return res.status(503).json({ error: 'Bridge not configured — set OPERATOR_PRIVATE_KEY' });
    }
    const { hl_wallet_address, usd_amount, user_sol_addr } = req.body || {};
    if (!hl_wallet_address || !usd_amount || !user_sol_addr) {
      return res.status(400).json({ error: 'missing params' });
    }
    if (!ethers.isAddress(hl_wallet_address)) {
      return res.status(400).json({ error: 'invalid HL wallet' });
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(user_sol_addr))) {
      return res.status(400).json({ error: 'invalid Solana address' });
    }
    const amountErr = validateUsdAmount(usd_amount, 5);
    if (amountErr) return res.status(400).json({ error: amountErr });
    const usdNum = Number(usd_amount);

    const time = Date.now();
    const action = {
      type: 'withdraw3',
      signatureChainId: '0xa4b1',
      hyperliquidChain: 'Mainnet',
      amount: String(usdNum),
      time,
      destination: OPERATOR_WALLET_ADDR,
    };
    const id = crypto.randomBytes(8).toString('hex');
    bridgeTracking.set(id, {
      kind: 'withdraw',
      status: 'awaiting_signature',
      hl_wallet_address,
      user_sol_addr,
      usd_amount: usdNum,
      action,
      created_at: time,
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
    if (t.status !== 'awaiting_signature') {
      return res.json({ ok: true, status: t.status, already_running: true });
    }
    t.status = 'withdrawing';
    t.signature = signature;
    runWithdrawPipeline(tracking_id).catch(err => {
      t.status = 'failed';
      t.error = err.message;
      logError('bridge-withdraw-pipeline', err);
    });
    res.json({ ok: true, status: t.status });
  } catch (err) {
    logError('bridge-withdraw-submit', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

app.get('/api/bridge/withdraw/status', (req, res) => {
  const id = String(req.query.id || '');
  const t = bridgeTracking.get(id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({
    status: t.status,
    arb_received: t.arb_received_raw ? ethers.formatUnits(t.arb_received_raw, 6) : null,
    hl_arrival_tx_hash: t.hl_arrival_tx_hash,
    mayan_tx_hash: t.mayan_tx_hash,
    error: t.error,
    completed_at: t.completed_at,
  });
});

async function runWithdrawPipeline(tid) {
  const t = bridgeTracking.get(tid);
  if (!t) return;

  await queueBridge(async () => {
    const wallet = getOperatorWallet();
    const usdc = new ethers.Contract(USDC_ARB_ADDR, USDC_ABI, wallet);
    const provider = wallet.provider;

    // 1. Snapshot block number BEFORE forwarding to HL.
    const fromBlock = await provider.getBlockNumber();

    // 2. Forward signed withdraw3 to HL.
    const body = { action: t.action, nonce: t.action.time, signature: t.signature };
    const ve = validateHyperliquidExchangePayload(body);
    if (ve) throw new Error('Invalid HL payload: ' + ve);

    const hlResp = await fetchWithTimeout(`${HL_API}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
    const hlData = await hlResp.json();
    if (hlData.status !== 'ok') {
      throw new Error('HL withdraw3 failed: ' + JSON.stringify(hlData).slice(0, 300));
    }
    t.status = 'hl_settling';

    // 3. Wait for HL's USDC Transfer event to operator (~3-4 min).
    const expectedNet = Math.max(0, t.usd_amount - 1); // HL takes flat $1 withdraw fee
    const expectedRaw = ethers.parseUnits(expectedNet.toFixed(6), 6);
    const arrival = await waitForHlWithdrawArrival(usdc, fromBlock, expectedRaw);
    t.arb_received_raw = arrival.amount.toString();
    t.hl_arrival_tx_hash = arrival.txHash;

    // 4. Bridge USDC.arb → SOL via Mayan from operator to user's Solana.
    t.status = 'bridging';
    const quotes = await mayan.fetchQuote({
      amountIn64: arrival.amount.toString(),
      fromToken: USDC_ARB_ADDR,
      toToken: SOL_NATIVE_TOKEN,        // SOL native on Solana
      fromChain: 'arbitrum',
      toChain: 'solana',
      slippageBps: 'auto',
    });
    if (!quotes || !quotes.length) throw new Error('No Mayan route found');
    const quote = quotes[0];

    // Approve USDC to Mayan forwarder if needed.
    const fwd = mayan.addresses?.MAYAN_FORWARDER_CONTRACT;
    if (fwd) {
      const allow = await usdc.allowance(OPERATOR_WALLET_ADDR, fwd);
      if (allow < arrival.amount) {
        const tx = await usdc.approve(fwd, ethers.MaxUint256);
        await tx.wait();
      }
    }

    // Execute the swap from operator's EVM wallet to user's Solana address.
    const txOrHash = await mayan.swapFromEvm(
      quote,
      OPERATOR_WALLET_ADDR,        // swapperAddress
      t.user_sol_addr,             // destinationWalletAddress (Solana)
      { solana: t.user_sol_addr }, // referrer addresses (none specifically; pass empty-ish)
      provider,
      wallet,                       // ethers signer
    );

    // swapFromEvm returns either a tx response (with .hash) or an order hash string for gasless.
    const mayanTxHash = (txOrHash && typeof txOrHash === 'object' && txOrHash.hash) || txOrHash;
    t.mayan_tx_hash = mayanTxHash;
    if (txOrHash && typeof txOrHash === 'object' && txOrHash.wait) {
      await txOrHash.wait();
    }
    t.status = 'finalizing';
  });

  // Outside queue: poll Mayan for fulfillment (doesn't touch operator state).
  if (t.mayan_tx_hash) {
    try {
      await waitForMayanFulfillment(t.mayan_tx_hash, 10 * 60 * 1000);
    } catch (e) {
      logError('mayan-fulfillment', e);
      // Even if Mayan polling times out, the operator's USDC was committed.
      // Mark complete optimistically; user can check explorer.
    }
  }
  t.status = 'complete';
  t.completed_at = Date.now();
}

/* ── PUMPPORTAL PROXY ─────────────────────────────────────────────────── */

app.post('/api/pumpportal/trade-local', async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      'https://pumpportal.fun/api/trade-local',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) },
      15_000,
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error:  'PumpPortal trade-local failed',
        detail: text.slice(0, 300),
      });
    }

    const buf = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'application/octet-stream');
    return res.send(buf);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'PumpPortal request timed out' });
    logError('pumpportal', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── HELIUS / SOLANA RPC ──────────────────────────────────────────────── */

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
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Helius DAS request timed out' });
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
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC request timed out' });
    logError('solana-rpc', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── PINATA ───────────────────────────────────────────────────────────── */

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
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });

    const { name, content } = req.body || {};
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ error: 'Missing content' });
    }

    const response = await fetchWithTimeout(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PINATA_JWT },
        body: JSON.stringify({
          pinataContent: content,
          pinataMetadata: { name: (name || 'metadata').slice(0, 64) },
        }),
      },
      20_000,
    );
    const result = await safeJson(response);

    if (result.parsed && result.parsed.IpfsHash) {
      return res.json({
        ipfsHash: result.parsed.IpfsHash,
        url:      'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
      });
    }
    return res.status(response.status).json({
      error:  'Pinata upload failed',
      detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
    });
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
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    fd.append('file', blob, req.file.originalname || 'upload');

    if (req.body && req.body.name) {
      fd.append('pinataMetadata', JSON.stringify({ name: String(req.body.name).slice(0, 64) }));
    }

    const response = await fetchWithTimeout(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      { method: 'POST', headers: { Authorization: 'Bearer ' + PINATA_JWT }, body: fd },
      30_000,
    );
    const result = await safeJson(response);

    if (result.parsed && result.parsed.IpfsHash) {
      return res.json({
        ipfsHash: result.parsed.IpfsHash,
        url:      'https://ipfs.io/ipfs/' + result.parsed.IpfsHash,
      });
    }
    return res.status(response.status).json({
      error:  'Pinata upload failed',
      detail: result.parsed || (result.raw && result.raw.slice(0, 300)),
    });
  } catch (e) {
    logError('pinata-file', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* ── HEALTHCHECK ──────────────────────────────────────────────────────── */

app.get('/api/health', (req, res) => {
  res.json({
    ok:  true,
    env: NODE_ENV,
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
    },
    routes: {
      okx:                        true,
      okxCrossChain:              true,
      jupiterQuote:               JUPITER_ENABLED,
      jupiterSwap:                JUPITER_ENABLED,
      jupiterTokens:              true,
      jupiterRegistry:            true,
      dexscreener:                true,
      hyperliquid:                true,
      hyperliquidExchange:        true,
      hyperliquidTestnet:         true,
      hyperliquidTestnetExchange: true,
      solPrice:                   true,
      bridgeDeposit:              'frontend-mayan-sdk',
      bridgeWithdraw:             Boolean(OPERATOR_PRIVATE_KEY),
      pumpportal:                 true,
      helius:                     true,
      solanaRpc:                  true,
      pinata:                     Boolean(PINATA_JWT),
    },
    mode: {
      okxPrimary:          true,
      okxApiVersion:       'v6',
      jupiterFallbackOnly: JUPITER_FALLBACK_ONLY,
      jupiterAccount:      JUPITER_ACCOUNT,
      jupiterQuoteBase:    JUPITER_QUOTE_BASE,
      hyperliquidSigning:  'frontend-signed-forward-only',
      bridgeProtocol:      'mayan-swift',
    },
    bridge: OPERATOR_PRIVATE_KEY ? {
      operator:        OPERATOR_WALLET_ADDR,
      arbRpc:          ARB_RPC_URL,
      active:          bridgeTracking.size,
      serialization:   'strict-single-flight',
      hlEventFiltered: true,
      depositPath:     'frontend Mayan SDK with toChain=hypercore (no server endpoint)',
      withdrawPath:    'HL withdraw3 → operator → Mayan swapFromEvm → Solana',
    } : { enabled: false },
    removed: { lifi: true, zeroX: true, debridge: true },
    fees: {
      note:   'OKX fees inject into Solana aggregator swap routes only. Hyperliquid builder fees signed in HL order. Bridge: Mayan ~0.1% protocol fee + $1 HL withdraw flat.',
      solana: OKX_SOL_FEE_PCT + '%',
      evm:    OKX_EVM_FEE_PCT + '%',
    },
    time: new Date().toISOString(),
  });
});

/* ── 404 FOR UNMATCHED API ROUTES ─────────────────────────────────────── */

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found: ' + req.path });
});

/* ── SPA STATIC + CATCH-ALL ───────────────────────────────────────────── */

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

/* ── ERROR HANDLER ────────────────────────────────────────────────────── */
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
    return res.status(400).json({ error: 'Unexpected file field — use field name "file"' });
  }

  logError('unhandled', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

/* ── BOOT ─────────────────────────────────────────────────────────────── */

app.listen(PORT, () => {
  console.log('Nexus DEX server running on port ' + PORT);
  console.log('  env:             ' + NODE_ENV);
  console.log('  allowed origins: ' + allowedOrigins.join(', '));
  console.log('  OKX fees:        Solana ' + OKX_SOL_FEE_PCT + '%  EVM ' + OKX_EVM_FEE_PCT + '%');
  console.log('  OKX API:         v6 (aggregator + cross-chain)');
  console.log('  Jupiter:         ' + (JUPITER_ENABLED ? 'enabled' : 'disabled'));
  console.log('  Hyperliquid:     frontend-signed forward-only');
  console.log('  Bridge protocol: Mayan Swift');
  console.log('  Deposit path:    frontend SDK (no server endpoint)');
  console.log('  Withdraw path:   ' + (OPERATOR_PRIVATE_KEY
    ? 'enabled via operator ' + OPERATOR_WALLET_ADDR
    : 'disabled (set OPERATOR_PRIVATE_KEY)'));

  if (OPERATOR_PRIVATE_KEY) {
    try {
      const w = getOperatorWallet();
      console.log('  Operator key:    verified controls ' + w.address);
    } catch (e) {
      console.error('  Operator key:    INVALID — ' + e.message);
    }
  }

  if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
    console.warn('  WARNING: OKX credentials missing — OKX routes will fail');
  }
  if (!OKX_PROJECT_ID)     console.warn('  WARNING: OKX_PROJECT_ID not set — recommended for production');
  if (!OKX_FEE_WALLET_SOL) console.warn('  WARNING: OKX_FEE_WALLET_SOL not set — Solana swap fees not collected');
  if (!OKX_FEE_WALLET_EVM) console.warn('  WARNING: OKX_FEE_WALLET_EVM not set — EVM swap fees not collected');
  if (JUPITER_ENABLED && !JUPITER_API_KEY) {
    console.warn('  WARNING: JUPITER_API_KEY not set — using public Jupiter access');
  }
  if (!HELIUS_API_KEY && !HELIUS_RPC_URL) {
    console.warn('  WARNING: No Helius key — falling back to public Solana RPC');
  }
  if (!PINATA_JWT) console.warn('  WARNING: PINATA_JWT not set — token launch uploads will fail');
  if (!OPERATOR_PRIVATE_KEY) console.warn('  WARNING: OPERATOR_PRIVATE_KEY not set — withdraw endpoints return 503');
});

process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));

