// ─────────────────────────────────────────────────────────────────────
// server-poly-relayer.js — Express router for Polymarket builder ops.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const BRIDGE_URL = 'https://bridge.polymarket.com';

const BUILDER_KEY        = process.env.POLY_BUILDER_API_KEY    || '';
const BUILDER_SECRET     = process.env.POLY_BUILDER_SECRET     || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE || '';
const BUILDER_ADDRESS    = process.env.POLY_BUILDER_ADDRESS    || '';
const BUILDER_CODE       = process.env.POLY_BUILDER_CODE       || '';

function ok() {
  return !!(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE && BUILDER_ADDRESS);
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

// Polymarket HMAC: SHA256(base64-decoded secret, ts + method + path + body)
// — timestamp in SECONDS, output as base64url.
function buildHmacSignature(secret, timestampSec, method, path, body) {
  const message = String(timestampSec) + String(method).toUpperCase() + String(path) + (body || '');
  const normalized = secret.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const secretBytes = Buffer.from(padded, 'base64');
  return crypto.createHmac('sha256', secretBytes).update(message).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');
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
    hasCreds:        ok(),
    hasBuilderCode:  !!BUILDER_CODE,
    hasAddress:      !!BUILDER_ADDRESS,
    builderKeyTail:  BUILDER_KEY ? '...' + BUILDER_KEY.slice(-6) : null,
    builderAddrTail: BUILDER_ADDRESS ? '...' + BUILDER_ADDRESS.slice(-6) : null,
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUILDER CODE — public
// ═══════════════════════════════════════════════════════════════════
router.get('/builder-code', (_req, res) => {
  if (!BUILDER_CODE) return res.json({ builderCode: null });
  res.json({ builderCode: BUILDER_CODE });
});

// ═══════════════════════════════════════════════════════════════════
// REMOTE SIGNING — called by @polymarket/builder-signing-sdk
// SDK posts: { method, path, body }
// Must return EXACTLY these keys — the SDK forwards them as headers.
// ═══════════════════════════════════════════════════════════════════
router.post('/sign', express.json({ limit: '1mb' }), (req, res) => {
  try {
    if (!ok()) return res.status(500).json({ error: 'Builder credentials not configured' });
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    if (!checkSignRate(ip)) return res.status(429).json({ error: 'Too many sign requests' });
    const { method, path, body } = req.body || {};
    if (!method || !path) return res.status(400).json({ error: 'method and path required' });

    const timestampSec = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = buildHmacSignature(BUILDER_SECRET, timestampSec, method, path, body || '');

    res.json({
      POLY_ADDRESS:    BUILDER_ADDRESS,
      POLY_SIGNATURE:  signature,
      POLY_TIMESTAMP:  String(timestampSec),
      POLY_API_KEY:    BUILDER_KEY,
      POLY_PASSPHRASE: BUILDER_PASSPHRASE,
      POLY_NONCE:      nonce,
    });
  } catch (e) {
    res.status(500).json({ error: 'sign_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE PROXIES (unchanged)
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
