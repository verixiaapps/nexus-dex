// ─────────────────────────────────────────────────────────────────────
// server-poly-relayer.js — Express router for Polymarket builder ops.
//
// Uses @polymarket/builder-signing-sdk's buildHmacSignature directly
// instead of hand-rolling the HMAC. Matches every official Polymarket
// reference example byte-for-byte.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { buildHmacSignature } = require('@polymarket/builder-signing-sdk');

const BRIDGE_URL = 'https://bridge.polymarket.com';

const BUILDER_KEY        = process.env.POLY_BUILDER_API_KEY    || '';
const BUILDER_SECRET     = process.env.POLY_BUILDER_SECRET     || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE || '';
const BUILDER_CODE       = process.env.POLY_BUILDER_CODE       || '';

function ok() {
  return !!(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE);
}

// Per-IP rate limiter for /sign.
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
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    hasCreds:       ok(),
    hasBuilderCode: !!BUILDER_CODE,
    builderKeyTail: BUILDER_KEY ? '...' + BUILDER_KEY.slice(-6) : null,
    sdkLoaded:      typeof buildHmacSignature === 'function',
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUILDER CODE — public, frontend attaches to orders
// ═══════════════════════════════════════════════════════════════════
router.get('/builder-code', (_req, res) => {
  if (!BUILDER_CODE) return res.json({ builderCode: null });
  res.json({ builderCode: BUILDER_CODE });
});

// ═══════════════════════════════════════════════════════════════════
// REMOTE SIGNING — called by SDK's BuilderConfig({ remoteBuilderConfig })
// SDK posts: { method, path, body }
// Returns the four POLY_BUILDER_* headers exactly as the SDK expects.
// ═══════════════════════════════════════════════════════════════════
router.post('/sign', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!ok()) return res.status(500).json({ error: 'Builder credentials not configured' });
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    if (!checkSignRate(ip)) return res.status(429).json({ error: 'Too many sign requests' });

    const { method, path, body } = req.body || {};
    if (!method || !path) return res.status(400).json({ error: 'method and path required' });

    const timestamp = Date.now().toString();
    const signature = await buildHmacSignature(
      BUILDER_SECRET,
      parseInt(timestamp, 10),
      method,
      path,
      body,
    );

    res.json({
      POLY_BUILDER_SIGNATURE:  signature,
      POLY_BUILDER_TIMESTAMP:  timestamp,
      POLY_BUILDER_API_KEY:    BUILDER_KEY,
      POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
    });
  } catch (e) {
    console.error('[poly/sign]', e);
    res.status(500).json({ error: 'sign_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE PROXIES — public Polymarket endpoints, CORS-fronted.
// ═══════════════════════════════════════════════════════════════════

router.post('/deposit', express.json(), async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });
    const r = await fetchWithTimeout(`${BRIDGE_URL}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: String(address).toLowerCase() }),
    }, 10_000);
    const txt = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'deposit_failed', detail: String(e?.message || e) });
  }
});

router.get('/status/:svm', async (req, res) => {
  try {
    const svm = req.params.svm;
    if (!svm) return res.status(400).json({ error: 'svm required' });
    const r = await fetchWithTimeout(
      `${BRIDGE_URL}/status/${encodeURIComponent(svm)}`, {}, 8_000,
    );
    const txt = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'status_failed' });
  }
});

router.post('/withdraw', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const r = await fetchWithTimeout(`${BRIDGE_URL}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 15_000);
    const txt = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'withdraw_failed', detail: String(e?.message || e) });
  }
});

router.post('/quote', express.json(), async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 10_000);
    const txt = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'quote_failed' });
  }
});

let _saCache = null, _saTs = 0;
router.get('/supported-assets', async (_req, res) => {
  try {
    const now = Date.now();
    if (_saCache && now - _saTs < 600_000) return res.json(_saCache);
    const r = await fetchWithTimeout(`${BRIDGE_URL}/supported-assets`, {}, 8_000);
    const data = await r.json();
    if (r.ok) { _saCache = data; _saTs = now; }
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'supported_assets_failed' });
  }
});

module.exports = router;
