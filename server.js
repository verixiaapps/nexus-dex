/**
 * NEXUS DEX - Backend Proxy Server
 *
 * Active routes:
 * /api/okx/*          - OKX DEX aggregator (Solana + EVM, 30+ chains, 400+ DEXs)
 * /api/pumpportal/*   - PumpPortal trade-local (pump.fun bonding curve + PumpSwap)
 * /api/lifi/*         - LiFi token price + catalog (data only, no swap execution)
 * /api/helius/das     - Helius DAS getAsset (Solana metadata + price fallback)
 * /api/solana-rpc     - Solana RPC proxy (Helius preferred)
 * /api/pinata/json    - Pinata pinJSONToIPFS (token-launch metadata)
 * /api/pinata/file    - Pinata pinFileToIPFS (token-launch images)
 * /api/health         - healthcheck
 *
 * Removed:
 * /api/jupiter/*  - replaced by OKX DEX (routes through Jupiter + 400 other sources)
 * /api/0x/*       - replaced by OKX DEX (handles all EVM chains natively)
 *
 * OKX DEX fee config:
 * Solana : feePercent up to 10%  - set via OKX_SOL_FEE_PCT env (default 5)
 * EVM    : feePercent up to 3%   - set via OKX_EVM_FEE_PCT env (default 3)
 * Fee wallet set via OKX_FEE_WALLET_SOL + OKX_FEE_WALLET_EVM env vars
 * OKX takes 20% revenue share of your fee on Start-up tier (post 60-day trial)
 *
 * OKX HMAC auth (required on every request):
 * Headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 *          OK-ACCESS-PASSPHRASE, OK-PROJECT
 * Signature: base64(HMAC-SHA256(timestamp + METHOD + okxPath + body))
 *
 * PumpPortal:
 * /api/pumpportal/trade-local  POST - returns unsigned Solana tx for signing
 * No API key needed for trade-local; PumpPortal takes 0.5% protocol fee
 *
 * Required env:
 * OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE, OKX_PROJECT_ID
 * OKX_FEE_WALLET_SOL, OKX_FEE_WALLET_EVM
 * HELIUS_API_KEY (or REACT_APP_SOLANA_RPC), PINATA_JWT
 * Optional env:
 * OKX_SOL_FEE_PCT (default 5), OKX_EVM_FEE_PCT (default 3)
 * LIFI_API_KEY, ALLOWED_ORIGINS, PORT, NODE_ENV,
 * CSP_MODE, EXTRA_CSP_*, HSTS_DISABLE
 */

require('dotenv').config();
const crypto    = require('crypto');
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const multer    = require('multer');

const app      = express();
const PORT     = process.env.PORT     || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* -- SECURITY HEADERS ------------------------------------------------------- */

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
  ['connect-src',     [
    "'self'",
    'https://web3.okx.com',
    'https://pumpportal.fun',
    'wss://pumpportal.fun',
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
    'https://api.devnet.solana.com',
    'https://api.testnet.solana.com',
    'https://*.publicnode.com',
    'https://*.drpc.org',
    ...EXTRA_CONNECT_SRC,
  ]],
  ['worker-src',   ["'self'", 'blob:']],
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
  if (HSTS_ENABLED) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* -- SECRETS ---------------------------------------------------------------- */

const OKX_API_KEY    = process.env.OKX_API_KEY       || '';
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY    || '';
const OKX_PASSPHRASE = process.env.OKX_API_PASSPHRASE || '';
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID    || '';

const OKX_FEE_WALLET_SOL = process.env.OKX_FEE_WALLET_SOL || '';
const OKX_FEE_WALLET_EVM = process.env.OKX_FEE_WALLET_EVM || '';
const OKX_SOL_FEE_PCT    = process.env.OKX_SOL_FEE_PCT    || '5';
const OKX_EVM_FEE_PCT    = process.env.OKX_EVM_FEE_PCT    || '3';

const LIFI_API_KEY   = process.env.LIFI_API_KEY   || process.env.REACT_APP_LIFI_API_KEY   || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY  || process.env.REACT_APP_HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL  || process.env.REACT_APP_SOLANA_RPC     || '';
const PINATA_JWT     = process.env.PINATA_JWT      || process.env.REACT_APP_PINATA_JWT     || '';

const OKX_SOLANA_CHAIN = '501';

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
  skip: r => r.path === '/health',
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
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi,                 'Bearer ***')
    .replace(/x-lifi-api-key["':\s]+[^&\s"',}]+/gi,       'x-lifi-api-key=***');
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
  if (result.parsed !== null) return res.status(response.status).json(result.parsed);
  return res.status(response.status).json({
    error: 'Upstream returned non-JSON',
    body:  result.raw && result.raw.slice(0, 500),
  });
}

/* -- OKX HMAC SIGNING ------------------------------------------------------- */
/*
 * Every OKX DEX API request requires:
 * OK-ACCESS-SIGN = base64( HMAC-SHA256( timestamp + METHOD + okxPath + body ) )
 *
 * okxPath = full OKX path + query string
 *   e.g. /api/v6/dex/aggregator/quote?chainIndex=501&amount=...
 * body    = JSON string for POST requests, empty string for GET
 */

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
    'Accept':               'application/json',
  };
}

/* -- OKX FEE INJECTION ------------------------------------------------------ */
/*
 * Fee params injected server-side into every swap/quote request.
 * Frontend never sees or handles fee wallet addresses.
 *
 * Rules:
 * - Only one referrer wallet address per trade (from OR to, not both)
 * - We use toTokenReferrerWalletAddress (fee from output token)
 * - Solana: fee wallet must have SOL deposited for activation
 * - feePercent max: 10 on Solana, 3 on EVM
 */

const OKX_FEE_ENDPOINTS = new Set([
  '/dex/aggregator/quote',
  '/dex/aggregator/swap',
  '/dex/aggregator/swap-instruction',
]);

function injectOkxFee(params, isSolana) {
  const wallet = isSolana ? OKX_FEE_WALLET_SOL : OKX_FEE_WALLET_EVM;
  const pct    = isSolana ? OKX_SOL_FEE_PCT    : OKX_EVM_FEE_PCT;
  if (wallet && pct) {
    params.set('toTokenReferrerWalletAddress', wallet);
    params.set('feePercent', pct);
  }
  return params;
}

/* -- OKX DEX PROXY ---------------------------------------------------------- */
/*
 * Frontend calls /api/okx/<subpath>?<qs>
 * Server maps to https://web3.okx.com/api/v6/<subpath>?<qs>
 *
 * Key endpoints the frontend uses:
 * GET  /dex/aggregator/quote              - price quote
 * GET  /dex/aggregator/swap-instruction   - Solana swap instructions
 * GET  /dex/aggregator/swap               - EVM swap calldata
 * GET  /dex/aggregator/tokens             - supported tokens for a chain
 * GET  /dex/aggregator/all-tokens         - token search
 * GET  /dex/aggregator/liquidity-sources  - available DEXs per chain
 */

async function proxyOkx(req, res) {
  try {
    if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
      return res.status(503).json({ error: 'OKX DEX API credentials not configured' });
    }

    const subPath = req.path.replace('/api/okx', ''); // e.g. /dex/aggregator/quote
    const rawQs   = queryStringOf(req);               // e.g. ?chainIndex=501&...

    /* Inject fee params on swap / quote endpoints */
    let finalQs = rawQs;
    if (OKX_FEE_ENDPOINTS.has(subPath)) {
      const params   = new URLSearchParams(rawQs.slice(1));
      const isSolana = params.get('chainIndex') === OKX_SOLANA_CHAIN;
      injectOkxFee(params, isSolana);
      finalQs = '?' + params.toString();
    }

    const okxPath = '/api/v6' + subPath + finalQs;
    const okxUrl  = 'https://web3.okx.com' + okxPath;

    const bodyStr = (req.method !== 'GET' && req.method !== 'HEAD' && req.body)
      ? JSON.stringify(req.body)
      : '';

    const headers   = buildOkxHeaders(req.method, okxPath, bodyStr);
    const fetchOpts = { method: req.method, headers };
    if (bodyStr) fetchOpts.body = bodyStr;

    const response = await fetchWithTimeout(okxUrl, fetchOpts, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'OKX request timed out' });
    logError('okx', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

app.get('/api/okx/*',  proxyOkx);
app.post('/api/okx/*', proxyOkx);

/* -- PUMPPORTAL PROXY ------------------------------------------------------- */
/*
 * PumpPortal trade-local returns a raw binary (serialized Solana transaction).
 * The frontend decodes it with VersionedTransaction.deserialize(), signs it
 * with the user's wallet, and sends it via their own RPC connection.
 *
 * No API key required for /trade-local.
 * PumpPortal takes 0.5% protocol fee automatically.
 *
 * Request body fields (forwarded as-is to PumpPortal):
 * publicKey        - user's Solana wallet address
 * action           - "buy" | "sell"
 * mint             - token CA
 * amount           - SOL or token amount
 * denominatedInSol - "true" | "false"
 * slippage         - percent
 * priorityFee      - SOL amount
 * pool             - "pump" | "pump-amm" | "raydium" | "auto" etc.
 */

app.post('/api/pumpportal/trade-local', async (req, res) => {
  try {
    const response = await fetchWithTimeout('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error:  'PumpPortal trade-local failed',
        detail: text.slice(0, 300),
      });
    }

    /* Response is raw binary (serialized VersionedTransaction) */
    const buf = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'application/octet-stream');
    return res.send(buf);
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'PumpPortal request timed out' });
    logError('pumpportal', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* -- LIFI PROXY (price data only) ------------------------------------------ */

async function proxyLifi(req, res) {
  try {
    const subPath = req.path.replace('/api/lifi', '');
    const url = 'https://li.quest' + subPath + queryStringOf(req);
    const headers = { 'Content-Type': 'application/json' };
    if (LIFI_API_KEY) headers['x-lifi-api-key'] = LIFI_API_KEY;
    const fetchOpts = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }
    const response = await fetchWithTimeout(url, fetchOpts);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'LiFi request timed out' });
    logError('lifi', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}

app.get('/api/lifi/*',  proxyLifi);
app.post('/api/lifi/*', proxyLifi);

/* -- HELIUS DAS ------------------------------------------------------------- */

app.post('/api/helius/das', async (req, res) => {
  try {
    const url = HELIUS_RPC_URL
      ? HELIUS_RPC_URL
      : (HELIUS_API_KEY
        ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY)
        : 'https://api.mainnet-beta.solana.com');
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Helius DAS request timed out' });
    logError('helius-das', e);
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
});

/* -- SOLANA RPC ------------------------------------------------------------- */

app.post('/api/solana-rpc', async (req, res) => {
  try {
    const url = HELIUS_RPC_URL
      ? HELIUS_RPC_URL
      : (HELIUS_API_KEY
        ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY)
        : 'https://api.mainnet-beta.solana.com');
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return respondJsonOrError(res, response, await safeJson(response));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Solana RPC request timed out' });
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
    if (!PINATA_JWT) return res.status(503).json({ error: 'Pinata not configured' });
    const { name, content } = req.body || {};
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Missing content' });
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PINATA_JWT },
      body: JSON.stringify({
        pinataContent:  content,
        pinataMetadata: { name: (name || 'metadata').slice(0, 64) },
      }),
    }, 20_000);
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
    const fd   = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    fd.append('file', blob, req.file.originalname || 'upload');
    if (req.body && req.body.name) {
      fd.append('pinataMetadata', JSON.stringify({ name: String(req.body.name).slice(0, 64) }));
    }
    const response = await fetchWithTimeout('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + PINATA_JWT },
      body: fd,
    }, 30_000);
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

/* -- HEALTHCHECK ------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    has: {
      okx:          Boolean(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE),
      lifi:         Boolean(LIFI_API_KEY),
      helius:       Boolean(HELIUS_API_KEY || HELIUS_RPC_URL),
      pinata:       Boolean(PINATA_JWT),
      feeWalletSol: Boolean(OKX_FEE_WALLET_SOL),
      feeWalletEvm: Boolean(OKX_FEE_WALLET_EVM),
    },
    fees: { solana: OKX_SOL_FEE_PCT + '%', evm: OKX_EVM_FEE_PCT + '%' },
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
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
  res.status(500).json({ error: 'Internal server error' });
});

/* -- BOOT ------------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log('Nexus DEX server running on port ' + PORT);
  console.log('  env:             ' + NODE_ENV);
  console.log('  allowed origins: ' + allowedOrigins.join(', '));
  console.log('  OKX fees:        Solana ' + OKX_SOL_FEE_PCT + '%  EVM ' + OKX_EVM_FEE_PCT + '%');
  if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
    console.warn('  WARNING: OKX credentials missing - all swaps will fail');
  }
  if (!OKX_PROJECT_ID)    console.warn('  WARNING: OKX_PROJECT_ID not set - recommended for production');
  if (!OKX_FEE_WALLET_SOL) console.warn('  WARNING: OKX_FEE_WALLET_SOL not set - Solana fees not collected');
  if (!OKX_FEE_WALLET_EVM) console.warn('  WARNING: OKX_FEE_WALLET_EVM not set - EVM fees not collected');
  if (!HELIUS_API_KEY && !HELIUS_RPC_URL) {
    console.warn('  WARNING: No Helius key - falling back to public Solana RPC');
  }
  if (!PINATA_JWT) console.warn('  WARNING: PINATA_JWT not set - token launch uploads will fail');
});

process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));
