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

const _csv = v =>
  (v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const EXTRA_CONNECT_SRC = _csv(process.env.EXTRA_CSP_CONNECT_SRC);
const EXTRA_FRAME_SRC = _csv(process.env.EXTRA_CSP_FRAME_SRC);
const EXTRA_SCRIPT_SRC = _csv(process.env.EXTRA_CSP_SCRIPT_SRC);

const CSP_DIRECTIVES = [
  ['default-src', ["'self'"]],

  [
    'script-src',
    [
      "'self'",
      "'unsafe-inline'",
      'https://challenges.cloudflare.com',
      ...EXTRA_SCRIPT_SRC,
    ],
  ],

  [
    'style-src',
    [
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ],
  ],

  [
    'img-src',
    [
      "'self'",
      'data:',
      'blob:',
      'https:',
    ],
  ],

  [
    'font-src',
    [
      "'self'",
      'data:',
      'https://fonts.gstatic.com',
    ],
  ],

  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],

  [
    'frame-src',
    [
      "'self'",
      'https://auth.privy.io',
      'https://verify.walletconnect.com',
      'https://verify.walletconnect.org',
      'https://challenges.cloudflare.com',
      ...EXTRA_FRAME_SRC,
    ],
  ],

  [
    'child-src',
    [
      "'self'",
      'https://auth.privy.io',
      'https://verify.walletconnect.com',
      'https://verify.walletconnect.org',
    ],
  ],

  [
    'connect-src',
    [
      "'self'",
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
      'https://pumpportal.fun',
      'wss://pumpportal.fun',
      ...EXTRA_CONNECT_SRC,
    ],
  ],

  ['worker-src', ["'self'", 'blob:']],
  ['manifest-src', ["'self'"]],
];

const _cspParts = CSP_DIRECTIVES.map(
  e => e[0] + ' ' + e[1].join(' ')
);

if (CSP_REPORT_URI) {
  _cspParts.push('report-uri ' + CSP_REPORT_URI);
}

const CSP_VALUE = _cspParts.join('; ');

const CSP_HEADER_NAME =
  CSP_MODE === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

const HSTS_ENABLED =
  NODE_ENV === 'production' &&
  process.env.HSTS_DISABLE !== '1';

console.log(
  '[security] CSP mode:',
  CSP_MODE,
  '-> header:',
  CSP_HEADER_NAME
);

app.use((req, res, next) => {
  if (
    req.path === '/health' ||
    req.path === '/api/health'
  ) {
    return next();
  }

  res.setHeader(CSP_HEADER_NAME, CSP_VALUE);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.setHeader(
    'Referrer-Policy',
    'strict-origin-when-cross-origin'
  );

  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  if (HSTS_ENABLED) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

/* SECRETS */

const OX_API_KEY =
  process.env.OX_API_KEY ||
  process.env.REACT_APP_0X_API_KEY ||
  '';

const JUPITER_API_KEY =
  process.env.JUPITER_API_KEY ||
  process.env.REACT_APP_JUPITER_API_KEY ||
  '';

const LIFI_API_KEY =
  process.env.LIFI_API_KEY ||
  process.env.REACT_APP_LIFI_API_KEY ||
  '';

const HELIUS_API_KEY =
  process.env.HELIUS_API_KEY ||
  process.env.REACT_APP_HELIUS_API_KEY ||
  '';

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.REACT_APP_SOLANA_RPC ||
  '';

const PINATA_JWT =
  process.env.PINATA_JWT ||
  process.env.REACT_APP_PINATA_JWT ||
  '';

/* CORS + JSON */

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  'https://swap.verixiaapps.com,http://localhost:3000'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      if (NODE_ENV !== 'production') {
        return cb(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(
        new Error('Not allowed by CORS: ' + origin)
      );
    },

    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
  })
);

app.use(
  express.json({
    limit: '256kb',
  })
);

/* RATE LIMITING */

const apiLimiter = rateLimit({
  windowMs: 60000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: 'Too many requests, slow down.',
  },

  skip: r => r.path === '/health',
});

const uploadLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error: 'Too many uploads, slow down.',
  },
});

app.use('/api/', apiLimiter);

/* HELPERS */

async function fetchWithTimeout(
  url,
  options,
  timeoutMs
) {
  timeoutMs = timeoutMs || 12000;

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(
      url,
      Object.assign({}, options, {
        signal: controller.signal,
      })
    );
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response) {
  const text = await response.text();

  try {
    return {
      parsed: JSON.parse(text),
      raw: null,
    };
  } catch (e) {
    return {
      parsed: null,
      raw: text,
    };
  }
}

function scrubSecrets(s) {
  if (s == null) return '';

  return String(s)
    .replace(
      /api-key=[^&\s"']+/gi,
      'api-key=***'
    )
    .replace(
      /Bearer\s+[A-Za-z0-9._-]+/gi,
      'Bearer ***'
    )
    .replace(
      /0x-api-key["':\s]+[^&\s"',}]+/gi,
      '0x-api-key=***'
    )
    .replace(
      /x-api-key["':\s]+[^&\s"',}]+/gi,
      'x-api-key=***'
    )
    .replace(
      /x-lifi-api-key["':\s]+[^&\s"',}]+/gi,
      'x-lifi-api-key=***'
    );
}

function logError(tag, err) {
  const msg = scrubSecrets(
    err && err.message
      ? err.message
      : err
  );

  if (NODE_ENV === 'production') {
    console.warn('[' + tag + ']', msg);
  } else {
    const stack =
      err && err.stack
        ? scrubSecrets(err.stack)
        : '';

    console.error(
      '[' + tag + ']',
      msg,
      stack ? '\n' + stack : ''
    );
  }
}

function queryStringOf(req) {
  const u =
    req.originalUrl ||
    req.url ||
    '';

  const i = u.indexOf('?');

  return i >= 0
    ? u.slice(i)
    : '';
}

function respondJsonOrError(
  res,
  response,
  result
) {
  if (result.parsed !== null) {
    return res
      .status(response.status)
      .json(result.parsed);
  }

  return res.status(response.status).json({
    error: 'Upstream returned non-JSON',

    body:
      result.raw &&
      result.raw.slice(0, 500),
  });
}

/* HEALTHCHECK */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,

    has: {
      ox: Boolean(OX_API_KEY),

      jupiter: Boolean(
        JUPITER_API_KEY
      ),

      lifi: Boolean(LIFI_API_KEY),

      helius: Boolean(
        HELIUS_API_KEY ||
        HELIUS_RPC_URL
      ),

      pinata: Boolean(PINATA_JWT),
    },

    time: new Date().toISOString(),
  });
});

/* 0X PROXY */

async function proxy0x(req, res) {
  try {
    const subPath = req.path.replace(
      '/api/0x',
      ''
    );

    const url =
      'https://api.0x.org' +
      subPath +
      queryStringOf(req);

    const headers = {
      '0x-api-key': OX_API_KEY,
      '0x-version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const fetchOpts = {
      method: req.method,
      headers,
    };

    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.body
    ) {
      fetchOpts.body = JSON.stringify(
        req.body
      );
    }

    const response =
      await fetchWithTimeout(
        url,
        fetchOpts
      );

    return respondJsonOrError(
      res,
      response,
      await safeJson(response)
    );

  } catch (e) {

    if (e.name === 'AbortError') {
      return res.status(504).json({
        error: '0x request timed out',
      });
    }

    logError('0x', e);

    return res.status(500).json({
      error:
        e.message ||
        'Unknown error',
    });
  }
}

app.get('/api/0x/*', proxy0x);
app.post('/api/0x/*', proxy0x);

/* JUPITER PROXY -- UPDATED */

async function proxyJupiter(req, res) {
  try {

    const subPath = req.path.replace(
      '/api/jupiter',
      ''
    );

    const isLiteEndpoint =
      subPath.startsWith('/price/') ||
      subPath.startsWith('/tokens/');

    const host = isLiteEndpoint
      ? 'https://lite-api.jup.ag'
      : (
          JUPITER_API_KEY
            ? 'https://api.jup.ag'
            : 'https://lite-api.jup.ag'
        );

    const url =
      host +
      subPath +
      queryStringOf(req);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (
      !isLiteEndpoint &&
      JUPITER_API_KEY
    ) {
      headers['x-api-key'] =
        JUPITER_API_KEY;
    }

    const fetchOpts = {
      method: req.method,
      headers,
    };

    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.body
    ) {
      fetchOpts.body = JSON.stringify(
        req.body
      );
    }

    const response =
      await fetchWithTimeout(
        url,
        fetchOpts,
        15000
      );

    return respondJsonOrError(
      res,
      response,
      await safeJson(response)
    );

  } catch (e) {

    if (e.name === 'AbortError') {
      return res.status(504).json({
        error:
          'Jupiter request timed out',
      });
    }

    logError('jupiter', e);

    return res.status(500).json({
      error:
        e.message ||
        'Unknown error',
    });
  }
}

app.get('/api/jupiter/*', proxyJupiter);
app.post('/api/jupiter/*', proxyJupiter);

/* LIFI PROXY */

async function proxyLifi(req, res) {
  try {

    const subPath = req.path.replace(
      '/api/lifi',
      ''
    );

    const url =
      'https://li.quest' +
      subPath +
      queryStringOf(req);

    const headers = {
      'Content-Type': 'application/json',
    };

    if (LIFI_API_KEY) {
      headers['x-lifi-api-key'] =
        LIFI_API_KEY;
    }

    const fetchOpts = {
      method: req.method,
      headers,
    };

    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.body
    ) {
      fetchOpts.body = JSON.stringify(
        req.body
      );
    }

    const response =
      await fetchWithTimeout(
        url,
        fetchOpts
      );

    return respondJsonOrError(
      res,
      response,
      await safeJson(response)
    );

  } catch (e) {

    if (e.name === 'AbortError') {
      return res.status(504).json({
        error:
          'LiFi request timed out',
      });
    }

    logError('lifi', e);

    return res.status(500).json({
      error:
        e.message ||
        'Unknown error',
    });
  }
}

app.get('/api/lifi/*', proxyLifi);
app.post('/api/lifi/*', proxyLifi);