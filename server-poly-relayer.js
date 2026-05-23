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

// ── Validate + decode the builder secret ONCE at startup ─────────────────────
// V2 spec: POLY_BUILDER_SECRET is base64-encoded raw key bytes (>=16 bytes).
// Fail loud on bad input rather than silently signing with the wrong key.
let _decodedSecret = null;
let _secretError   = null;
if (BUILDER_SECRET) {
  try {
    const buf = Buffer.from(BUILDER_SECRET, 'base64');
    if (buf.length < 16) throw new Error(`decoded length ${buf.length} < 16 bytes`);
    // Reject if it doesn't round-trip cleanly (catches non-base64 inputs)
    if (Buffer.from(buf.toString('base64'), 'base64').compare(buf) !== 0) {
      throw new Error('does not round-trip as base64');
    }
    _decodedSecret = buf;
  } catch (e) {
    _secretError = e.message;
    console.error('[poly/sign] POLY_BUILDER_SECRET invalid:', e.message);
  }
}

// ── HMAC signing — V2 uses millisecond timestamps + standard base64 ──────────
function manualHmac(timestampMs, method, requestPath, body) {
  if (!_decodedSecret) {
    throw new Error('POLY_BUILDER_SECRET not decoded: ' + (_secretError || 'unset'));
  }
  const bodyStr = body == null
    ? ''
    : (typeof body === 'string' ? body : JSON.stringify(body));
  const message = `${timestampMs}${String(method).toUpperCase()}${requestPath}${bodyStr}`;

  // Standard base64 (matches Python/Rust reference clients).
  // Do NOT base64url-encode — that breaks signature verification on the server.
  return crypto.createHmac('sha256', _decodedSecret).update(message).digest('base64');
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

// ── Validation helpers ────────────────────────────────────────────────────────
function isEvmAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim());
}
function isLikelySolanaAddress(v) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '').trim());
}

// ── Bridge deposit address lookup ─────────────────────────────────────────────
// Returns { evm, svm, raw } — pick one shape and use it everywhere.
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
    hasCreds:       credsOk(),
    hasBuilderCode: Boolean(BUILDER_CODE),
    builderKeyTail: BUILDER_KEY ? '…' + BUILDER_KEY.slice(-6) : null,
    secretDecoded:  Boolean(_decodedSecret),
    secretError:    _secretError,
    sdkLoaded:      Boolean(sdkHmac),
    signMode:       sdkHmac ? 'sdk' : 'manual',
    timestampMode:  'milliseconds (V2)',
    bridge:         BRIDGE_URL,
    relayer:        RELAYER_URL,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC — test builder HMAC against live CLOB V2
// GET /api/poly/test-creds
// ═════════════════════════════════════════════════════════════════════════════

router.get('/test-creds', async (_req, res) => {
  const attempts = [];

  if (credsOk() && _decodedSecret) {
    const method = 'GET';
    const path   = '/api-keys';
    const tsMs   = String(Date.now());
    try {
      const sig = sdkHmac
        ? await sdkHmac(BUILDER_SECRET, parseInt(tsMs, 10), method, path, undefined)
        : manualHmac(tsMs, method, path, undefined);

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
        signMode:   sdkHmac ? 'sdk' : 'manual',
        sigPreview: sig.slice(0, 24) + '…',
        body:       body.slice(0, 300),
      });
    } catch (e) {
      attempts.push({ test: 'CLOB /api-keys', error: String(e?.message || e) });
    }
  } else if (!_decodedSecret && BUILDER_SECRET) {
    attempts.push({ test: 'CLOB /api-keys', skipped: 'POLY_BUILDER_SECRET decode failed: ' + _secretError });
  } else {
    attempts.push({ test: 'CLOB /api-keys', skipped: 'Builder creds not set' });
  }

  return res.json({
    env: {
      hasBuilderKey:        Boolean(BUILDER_KEY),
      hasBuilderSecret:     Boolean(BUILDER_SECRET),
      hasBuilderPassphrase: Boolean(BUILDER_PASSPHRASE),
      hasBuilderCode:       Boolean(BUILDER_CODE),
      secretDecoded:        Boolean(_decodedSecret),
      secretError:          _secretError,
      builderKeyTail:       BUILDER_KEY ? '…' + BUILDER_KEY.slice(-6) : null,
    },
    attempts,
    verdict: attempts[0]?.ok
      ? 'Builder HMAC working — V2 trading should succeed'
      : 'Builder HMAC FAILED — check POLY_BUILDER_* env vars + signMode',
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BUILDER CODE
// ═════════════════════════════════════════════════════════════════════════════

router.get('/builder-code', (_req, res) => {
  res.json({ builderCode: BUILDER_CODE || null });
});

// ═════════════════════════════════════════════════════════════════════════════
// SIGN — remote builder HMAC endpoint (called by both SDKs)
// Body: { method, path, body? }   |   Returns POLY_BUILDER_* headers
// Timestamp: MILLISECONDS         |   Signature: standard base64
// ═════════════════════════════════════════════════════════════════════════════

router.post('/sign', async (req, res) => {
  try {
    if (!credsOk()) return res.status(500).json({ error: 'Builder credentials not configured' });
    if (!_decodedSecret) return res.status(500).json({ error: 'Builder secret invalid: ' + _secretError });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (!checkSignRate(ip)) return res.status(429).json({ error: 'Too many sign requests' });

    const body    = req.body || {};
    const method  = body.method;
    const path    = body.path || body.requestPath; // tolerate legacy 'requestPath'
    const payload = body.body;

    if (!method || !path) return res.status(400).json({ error: 'method and path required' });

    const tsMs = String(Date.now());

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
        signature = manualHmac(tsMs, method, path, payload);
      }
    } else {
      signature = manualHmac(tsMs, method, path, payload);
    }

    // Log enough to debug auth failures but never log the signature or secret
    console.log('[poly/sign]', method, path, payload ? `(body ${JSON.stringify(payload).length}b)` : '(no body)');

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
// Returns normalized { evm, svm } — frontend reads either of those.
// ═════════════════════════════════════════════════════════════════════════════

router.post('/deposit', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });
    if (!isEvmAddress(address)) return res.status(400).json({ error: 'valid EVM address required' });
    const { evm, svm, raw } = await bridgeDepositAddress(address);
    return res.json({ evm, svm, raw });
  } catch (e) {
    return res.status(502).json({ error: 'deposit_failed', detail: String(e?.message || e) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE: STATUS  GET /api/poly/status/:address
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
// ═════════════════════════════════════════════════════════════════════════════

router.post('/withdraw', async (req, res) => {
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
// ═════════════════════════════════════════════════════════════════════════════

router.post('/quote', async (req, res) => {
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
