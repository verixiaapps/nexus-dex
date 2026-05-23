// ─────────────────────────────────────────────────────────────────────────────
// server-poly-relayer.js
//
// Express router for Polymarket V2 builder operations.
//
// V2 architecture (deposit wallet flow — new users only):
//   • RelayClient  → @polymarket/builder-relayer-client
//                    Auth: BuilderConfig HMAC via /api/poly/sign
//                    Used for: deployDepositWallet, executeDepositWalletBatch
//
//   • ClobClient   → @polymarket/clob-client-v2
//                    Auth: BuilderConfig HMAC via /api/poly/sign
//                    signatureType: 3 (POLY_1271), funder = deposit wallet
//                    Used for: createOrDeriveApiKey, createAndPostOrder, sell
//
// The /sign endpoint ONLY does HMAC for builder API key auth.
// SDK sends { method, path, body } — returns exactly:
//   { POLY_BUILDER_SIGNATURE, POLY_BUILDER_TIMESTAMP,
//     POLY_BUILDER_API_KEY,   POLY_BUILDER_PASSPHRASE }
//
// Timestamp is MILLISECONDS (V2 change from V1 seconds).
//
// Required env vars:
//   POLY_BUILDER_API_KEY       builder API key
//   POLY_BUILDER_SECRET        builder secret (base64)
//   POLY_BUILDER_PASSPHRASE    builder passphrase
//   POLY_BUILDER_CODE          bytes32 builder code for order attribution
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

// ── Try to load V2 SDK buildHmacSignature; fall back to manual ───────────────
let sdkHmac = null;
try {
  const sdk = require('@polymarket/builder-signing-sdk');
  if (typeof sdk.buildHmacSignature === 'function') sdkHmac = sdk.buildHmacSignature;
} catch (e) {
  console.warn('[poly/sign] builder-signing-sdk not found, using manual HMAC:', e.message);
}

// ── Env ───────────────────────────────────────────────────────────────────────
const BUILDER_KEY        = process.env.POLY_BUILDER_API_KEY    || '';
const BUILDER_SECRET     = process.env.POLY_BUILDER_SECRET     || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE || '';
const BUILDER_CODE       = process.env.POLY_BUILDER_CODE       || '';

const BRIDGE_URL  = 'https://bridge.polymarket.com';
const RELAYER_URL = 'https://relayer-v2.polymarket.com';

function credsOk() {
  return Boolean(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE);
}

// ── Validation helpers ────────────────────────────────────────────────────────
function isEvmAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim());
}
function isLikelySolanaAddress(v) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '').trim());
}

// ── HMAC signing — V2 uses millisecond timestamps ─────────────────────────────
function manualHmac(secret, timestampMs, method, requestPath, body) {
  const bodyStr = body == null
    ? ''
    : (typeof body === 'string' ? body : JSON.stringify(body));
  const message = `${timestampMs}${String(method).toUpperCase()}${requestPath}${bodyStr}`;

  // Validate base64: real secrets decode to >= 16 bytes and re-encode cleanly
  const decoded = Buffer.from(secret, 'base64');
  const key = (decoded.length >= 16 &&
    Buffer.from(decoded.toString('base64'), 'base64').equals(decoded))
    ? decoded
    : Buffer.from(secret, 'utf8');

  return crypto
    .createHmac('sha256', key)
    .update(message)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Per-IP rate limiter (600 req/min) ─────────────────────────────────────────
const _signRate = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, arr] of _signRate.entries()) {
    if (!arr.some(t => t > cutoff)) _signRate.delete(k);
  }
}, 30_000).unref();

function checkSignRate(ip) {
  const now    = Date.now();
  const cutoff = now - 60_000;
  const hits   = (_signRate.get(ip) || []).filter(t => t > cutoff);
  if (hits.length >= 600) return false;
  hits.push(now);
  _signRate.set(ip, hits);
  return true;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function forwardResponse(res, upstream) {
  const text = await upstream.text();
  const ct   = upstream.headers.get('content-type') || 'application/json';
  return res.status(upstream.status).type(ct).send(text);
}

// ── Bridge deposit address lookup ─────────────────────────────────────────────
async function bridgeDepositAddress(depositWallet) {
  const clean = String(depositWallet || '').trim().toLowerCase();
  if (!isEvmAddress(clean)) throw new Error('Valid EVM deposit wallet address required');

  const r = await fetchWithTimeout(`${BRIDGE_URL}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ address: clean }),
  }, 10_000);

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Bridge returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Bridge ${r.status}: ${text.slice(0, 300)}`);

  const a = data?.address && typeof data.address === 'object' ? data.address : data;
  return {
    raw: data,
    evm: a.evm || a.evmAddress || a.evm_address || null,
    svm: a.svm || a.svmAddress || a.svm_address || null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// HEALTH
// ═════════════════════════════════════════════════════════════════════════════

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    v: 2,
    hasCreds:      credsOk(),
    hasBuilderCode: Boolean(BUILDER_CODE),
    builderKeyTail: BUILDER_KEY ? '…' + BUILDER_KEY.slice(-6) : null,
    sdkLoaded:     Boolean(sdkHmac),
    signMode:      sdkHmac ? 'sdk' : 'manual',
    timestampMode: 'milliseconds (V2)',
    bridge:        BRIDGE_URL,
    relayer:       RELAYER_URL,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC — test builder HMAC against live CLOB V2
// GET /api/poly/test-creds
// ═════════════════════════════════════════════════════════════════════════════

router.get('/test-creds', async (_req, res) => {
  const attempts = [];

  if (credsOk()) {
    const method = 'GET';
    const path   = '/api-keys';
    const tsMs   = String(Date.now()); // V2: milliseconds
    try {
      const sig = sdkHmac
        ? await sdkHmac(BUILDER_SECRET, parseInt(tsMs, 10), method, path, undefined)
        : manualHmac(BUILDER_SECRET, tsMs, method, path, undefined);

      const r = await fetchWithTimeout(`https://clob.polymarket.com${path}`, {
        method,
        headers: {
          POLY_BUILDER_SIGNATURE:  sig,
          POLY_BUILDER_TIMESTAMP:  tsMs,
          POLY_BUILDER_API_KEY:    BUILDER_KEY,
          POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
          Accept: 'application/json',
        },
      }, 10_000);
      const body = await r.text();
      attempts.push({
        test:       'CLOB /api-keys (builder HMAC, ms timestamp)',
        status:     r.status,
        ok:         r.ok,
        sigPreview: sig.slice(0, 24) + '…',
        body:       body.slice(0, 300),
      });
    } catch (e) {
      attempts.push({ test: 'CLOB /api-keys', error: String(e?.message || e) });
    }
  } else {
    attempts.push({ test: 'CLOB /api-keys', skipped: 'Builder creds not set' });
  }

  return res.json({
    env: {
      hasBuilderKey:        Boolean(BUILDER_KEY),
      hasBuilderSecret:     Boolean(BUILDER_SECRET),
      hasBuilderPassphrase: Boolean(BUILDER_PASSPHRASE),
      hasBuilderCode:       Boolean(BUILDER_CODE),
      builderKeyTail:       BUILDER_KEY ? '…' + BUILDER_KEY.slice(-6) : null,
    },
    attempts,
    verdict: attempts[0]?.ok
      ? 'Builder HMAC working — V2 trading should succeed'
      : 'Builder HMAC FAILED — check POLY_BUILDER_* env vars',
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BUILDER CODE — returned to client for order attribution
// GET /api/poly/builder-code
// ═════════════════════════════════════════════════════════════════════════════

router.get('/builder-code', (_req, res) => {
  res.json({ builderCode: BUILDER_CODE || null });
});

// ═════════════════════════════════════════════════════════════════════════════
// SIGN — remote builder HMAC signing endpoint
//
// Called by both @polymarket/builder-relayer-client (RelayClient) and
// @polymarket/clob-client-v2 (ClobClient) via BuilderConfig remoteBuilderConfig.
//
// Request body (from SDK): { method, path, body? }
// Response (exact shape the SDK expects):
//   { POLY_BUILDER_SIGNATURE, POLY_BUILDER_TIMESTAMP,
//     POLY_BUILDER_API_KEY,   POLY_BUILDER_PASSPHRASE }
//
// IMPORTANT: timestamp is milliseconds in V2, not seconds.
// ═════════════════════════════════════════════════════════════════════════════

router.post('/sign', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!credsOk()) {
      return res.status(500).json({ error: 'Builder credentials not configured' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (!checkSignRate(ip)) {
      return res.status(429).json({ error: 'Too many sign requests' });
    }

    const body    = req.body || {};
    const method  = body.method;
    const path    = body.path || body.requestPath; // SDK sends 'path'; be tolerant of older 'requestPath'
    const payload = body.body;

    if (!method || !path) {
      return res.status(400).json({ error: 'method and path required' });
    }

    const tsMs = String(Date.now()); // V2: milliseconds

    let signature;
    if (sdkHmac) {
      try {
        signature = await sdkHmac(
          BUILDER_SECRET,
          parseInt(tsMs, 10),
          String(method).toUpperCase(),
          String(path),
          payload,
        );
      } catch (e) {
        console.warn('[poly/sign] SDK HMAC failed, falling back to manual:', e.message);
        signature = manualHmac(BUILDER_SECRET, tsMs, method, path, payload);
      }
    } else {
      signature = manualHmac(BUILDER_SECRET, tsMs, method, path, payload);
    }

    console.log('[poly/sign]', method, path);

    // Exact shape the SDK expects — nothing extra
    return res.json({
      POLY_BUILDER_SIGNATURE:  signature,
      POLY_BUILDER_TIMESTAMP:  tsMs,
      POLY_BUILDER_API_KEY:    BUILDER_KEY,
      POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
    });
  } catch (e) {
    console.error('[poly/sign] error', e);
    return res.status(500).json({ error: 'sign_failed', detail: String(e?.message || e) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: DEPOSIT ADDRESS
// POST /api/poly/deposit  { address: depositWalletAddress }
// Returns bridge deposit addresses (EVM + SVM) for the deposit wallet.
// ═════════════════════════════════════════════════════════════════════════════

router.post('/deposit', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });
    if (!isEvmAddress(address)) return res.status(400).json({ error: 'valid EVM address required' });
    const result = await bridgeDepositAddress(address);
    return res.json(result.raw);
  } catch (e) {
    return res.status(502).json({ error: 'deposit_failed', detail: String(e?.message || e) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: STATUS
// GET /api/poly/status/:address
// Accepts EVM deposit wallet (looks up SVM) or raw Solana address.
// ═════════════════════════════════════════════════════════════════════════════

async function handleBridgeStatus(address, res) {
  const input = String(address || '').trim();
  if (!input) return res.status(400).json({ error: 'address required' });

  let svm = input;
  if (isEvmAddress(input)) {
    const addrs = await bridgeDepositAddress(input);
    if (!addrs.svm) {
      return res.status(502).json({
        error:  'bridge_svm_missing',
        detail: 'Bridge did not return an SVM address for this deposit wallet',
        raw:    addrs.raw,
      });
    }
    svm = addrs.svm;
  }

  if (!isLikelySolanaAddress(svm)) {
    return res.status(400).json({ error: 'Valid Solana address or EVM deposit wallet required' });
  }

  const r = await fetchWithTimeout(
    `${BRIDGE_URL}/status/${encodeURIComponent(svm)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    8_000,
  );
  return forwardResponse(res, r);
}

router.get('/status/:address', async (req, res) => {
  try { return await handleBridgeStatus(req.params.address, res); }
  catch (e) { return res.status(502).json({ error: 'status_failed', detail: String(e?.message || e) }); }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: WITHDRAW
// POST /api/poly/withdraw  { from, to, chain, asset, amount }
// ═════════════════════════════════════════════════════════════════════════════

router.post('/withdraw', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({ error: 'withdraw_failed', detail: String(e?.message || e) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: QUOTE
// POST /api/poly/quote
// ═════════════════════════════════════════════════════════════════════════════

router.post('/quote', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 10_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({ error: 'quote_failed', detail: String(e?.message || e) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: SUPPORTED ASSETS  (10-min cache, deduped in-flight)
// GET /api/poly/supported-assets
// ═════════════════════════════════════════════════════════════════════════════

let _saCache    = null;
let _saTs       = 0;
let _saInflight = null;

router.get('/supported-assets', async (_req, res) => {
  try {
    if (_saCache && Date.now() - _saTs < 600_000) return res.json(_saCache);

    if (!_saInflight) {
      _saInflight = fetchWithTimeout(
        `${BRIDGE_URL}/supported-assets`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        8_000,
      ).finally(() => { _saInflight = null; });
    }

    const r    = await _saInflight;
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return res.status(r.status).json({ error: 'non_json', body: text.slice(0, 500) });
    }
    if (r.ok) { _saCache = data; _saTs = Date.now(); }
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'supported_assets_failed', detail: String(e?.message || e) });
  }
});

module.exports = router;
