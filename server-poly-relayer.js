// ─────────────────────────────────────────────────────────────────────
// server-poly-relayer.js — Express router for Polymarket builder + bridge ops.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Try to load the SDK helper; if it's not exported (depending on version),
// fall back to a manual HMAC implementation that matches the spec.
let sdkBuildHmacSignature = null;
try {
  const sdk = require('@polymarket/builder-signing-sdk');
  if (typeof sdk.buildHmacSignature === 'function') {
    sdkBuildHmacSignature = sdk.buildHmacSignature;
  }
} catch (e) {
  console.warn('[poly] builder-signing-sdk not loadable, using manual HMAC:', e.message);
}

const BRIDGE_URL = 'https://bridge.polymarket.com';

const BUILDER_KEY = process.env.POLY_BUILDER_API_KEY || '';
const BUILDER_SECRET = process.env.POLY_BUILDER_SECRET || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE || '';
const BUILDER_CODE = process.env.POLY_BUILDER_CODE || '';

function ok() {
  return Boolean(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE);
}

function isEvmAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim());
}

function isLikelySolanaAddress(v) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '').trim());
}

// ─────────────────────────────────────────────────────────────────────
// Manual HMAC signature, matches Polymarket builder spec:
//   message = `${timestamp}${method.toUpperCase()}${requestPath}${bodyJSON}`
//   signature = HMAC-SHA256(base64-decoded-secret, message) → base64url
// (The signature for builder uses the secret as a base64 string that must be
//  decoded before HMAC. Matches go/py/rs Polymarket SDKs.)
// ─────────────────────────────────────────────────────────────────────
function manualHmac(secret, timestamp, method, requestPath, body) {
  const bodyStr = body == null
    ? ''
    : (typeof body === 'string' ? body : JSON.stringify(body));
  const message = `${timestamp}${String(method).toUpperCase()}${requestPath}${bodyStr}`;

  let key;
  try {
    key = Buffer.from(secret, 'base64');
    if (key.length === 0) key = Buffer.from(secret, 'utf8');
  } catch {
    key = Buffer.from(secret, 'utf8');
  }

  const digest = crypto.createHmac('sha256', key).update(message).digest('base64');
  // base64url
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const _signRate = new Map();

function checkSignRate(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (_signRate.get(ip) || []).filter(t => t > windowStart);

  if (hits.length >= 600) return false;

  hits.push(now);
  _signRate.set(ip, hits);

  if (_signRate.size > 5000) {
    for (const [k, arr] of _signRate.entries()) {
      if (!arr.some(t => t > windowStart)) _signRate.delete(k);
    }
  }

  return true;
}

async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);

  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function forwardResponse(res, upstream) {
  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  return res.status(upstream.status).type(contentType).send(text);
}

async function bridgeDepositAddress(address) {
  const clean = String(address || '').trim();

  if (!isEvmAddress(clean)) {
    throw new Error('Valid EVM address required');
  }

  const r = await fetchWithTimeout(`${BRIDGE_URL}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ address: clean.toLowerCase() }),
  }, 10_000);

  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bridge deposit returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!r.ok) {
    throw new Error(`Bridge deposit failed ${r.status}: ${text.slice(0, 300)}`);
  }

  const a = data && typeof data.address === 'object' ? data.address : data;

  return {
    raw: data,
    evm: a.evm || a.evmAddress || a.evm_address || null,
    svm: a.svm || a.svmAddress || a.svm_address || null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasCreds: ok(),
    hasBuilderCode: Boolean(BUILDER_CODE),
    builderKeyTail: BUILDER_KEY ? '...' + BUILDER_KEY.slice(-6) : null,
    sdkLoaded: Boolean(sdkBuildHmacSignature),
    signMode: sdkBuildHmacSignature ? 'sdk' : 'manual',
    bridge: BRIDGE_URL,
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUILDER CODE
// ═══════════════════════════════════════════════════════════════════

router.get('/builder-code', (_req, res) => {
  res.json({ builderCode: BUILDER_CODE || null });
});

// ═══════════════════════════════════════════════════════════════════
// REMOTE BUILDER SIGNING
//
// The Polymarket builder-signing-sdk on the client calls this endpoint
// with: { method, requestPath, body, timestamp? }
//
// It expects back a JSON object with the keys:
//   { signature, timestamp, apiKey, passphrase }
//
// The SDK then attaches these as the appropriate HMAC headers
// (POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_API_KEY,
// POLY_PASSPHRASE) on the actual relayer/CLOB request.
//
// Returning POLY_BUILDER_* keys (as the previous version did) is wrong:
// the SDK ignores those names and sends no auth headers, hence
// "401 invalid authorization" from the relayer.
// ═══════════════════════════════════════════════════════════════════

router.post('/sign', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!ok()) {
      return res.status(500).json({ error: 'Builder credentials not configured' });
    }

    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

    if (!checkSignRate(ip)) {
      return res.status(429).json({ error: 'Too many sign requests' });
    }

    // Accept both `path` (old) and `requestPath` (current SDK)
    const body = req.body || {};
    const method = body.method;
    const requestPath = body.requestPath || body.path;
    const payload = body.body;
    const clientTs = body.timestamp;

    if (!method || !requestPath) {
      return res.status(400).json({ error: 'method and requestPath required' });
    }

    const timestamp = String(clientTs || Math.floor(Date.now() / 1000));

    let signature;
    if (sdkBuildHmacSignature) {
      // Use SDK if available — it knows the canonical scheme
      try {
        signature = await sdkBuildHmacSignature(
          BUILDER_SECRET,
          parseInt(timestamp, 10),
          String(method).toUpperCase(),
          String(requestPath),
          payload,
        );
      } catch (e) {
        console.warn('[poly/sign] SDK failed, falling back to manual:', e.message);
        signature = manualHmac(BUILDER_SECRET, timestamp, method, requestPath, payload);
      }
    } else {
      signature = manualHmac(BUILDER_SECRET, timestamp, method, requestPath, payload);
    }

    // Return BOTH naming conventions so SDK versions old & new work.
    return res.json({
      // Lowercase keys (current SDK)
      signature,
      timestamp,
      apiKey: BUILDER_KEY,
      passphrase: BUILDER_PASSPHRASE,
      // Header-style keys (some SDK versions read these instead)
      headers: {
        POLY_SIGNATURE: signature,
        POLY_TIMESTAMP: timestamp,
        POLY_API_KEY: BUILDER_KEY,
        POLY_PASSPHRASE: BUILDER_PASSPHRASE,
      },
      // Legacy POLY_BUILDER_* keys (kept for backward compat)
      POLY_BUILDER_SIGNATURE: signature,
      POLY_BUILDER_TIMESTAMP: timestamp,
      POLY_BUILDER_API_KEY: BUILDER_KEY,
      POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
    });
  } catch (e) {
    console.error('[poly/sign]', e);
    return res.status(500).json({
      error: 'sign_failed',
      detail: String(e?.message || e),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: DEPOSIT ADDRESS
// ═══════════════════════════════════════════════════════════════════

router.post('/deposit', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const { address } = req.body || {};

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    if (!isEvmAddress(address)) {
      return res.status(400).json({ error: 'valid EVM address required' });
    }

    const result = await bridgeDepositAddress(address);
    return res.json(result.raw);
  } catch (e) {
    return res.status(502).json({
      error: 'deposit_failed',
      detail: String(e?.message || e),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: STATUS
// ═══════════════════════════════════════════════════════════════════

router.get('/status/:address', async (req, res) => {
  try {
    const input = String(req.params.address || '').trim();

    if (!input) {
      return res.status(400).json({ error: 'address required' });
    }

    let svm = input;

    if (isEvmAddress(input)) {
      const addrs = await bridgeDepositAddress(input);

      if (!addrs.svm) {
        return res.status(502).json({
          error: 'bridge_svm_missing',
          detail: 'Bridge deposit endpoint did not return an svm address',
          address: addrs,
        });
      }

      svm = addrs.svm;
    }

    if (!isLikelySolanaAddress(svm)) {
      return res.status(400).json({
        error: 'valid SVM/Solana bridge address or EVM address required',
      });
    }

    const r = await fetchWithTimeout(
      `${BRIDGE_URL}/status/${encodeURIComponent(svm)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      8_000,
    );

    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({
      error: 'status_failed',
      detail: String(e?.message || e),
    });
  }
});

// Backward-compatible alias.
router.get('/status-by-safe/:safe', async (req, res) => {
  req.params.address = req.params.safe;
  return router.handle(req, res);
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: WITHDRAW
// ═══════════════════════════════════════════════════════════════════

router.post('/withdraw', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const body = req.body || {};

    const r = await fetchWithTimeout(`${BRIDGE_URL}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);

    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({
      error: 'withdraw_failed',
      detail: String(e?.message || e),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: QUOTE
// ═══════════════════════════════════════════════════════════════════

router.post('/quote', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 10_000);

    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({
      error: 'quote_failed',
      detail: String(e?.message || e),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE: SUPPORTED ASSETS
// ═══════════════════════════════════════════════════════════════════

let _saCache = null;
let _saTs = 0;

router.get('/supported-assets', async (_req, res) => {
  try {
    const now = Date.now();

    if (_saCache && now - _saTs < 600_000) {
      return res.json(_saCache);
    }

    const r = await fetchWithTimeout(
      `${BRIDGE_URL}/supported-assets`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      8_000,
    );

    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(r.status).json({
        error: 'supported_assets_non_json',
        body: text.slice(0, 500),
      });
    }

    if (r.ok) {
      _saCache = data;
      _saTs = now;
    }

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({
      error: 'supported_assets_failed',
      detail: String(e?.message || e),
    });
  }
});

module.exports = router;
