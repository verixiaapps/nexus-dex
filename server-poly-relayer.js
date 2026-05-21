// ─────────────────────────────────────────────────────────────────────
// server-poly-relayer.js — Express router for Polymarket builder ops.
// 
// ARCHITECTURE (V2 — post April 28 2026 cutover):
//   • Frontend uses @polymarket/builder-relayer-client SDK to deploy the
//     user's safe and submit gasless approvals batches. That SDK still
//     requires HMAC-signed builder headers to authenticate with the
//     relayer (this part of the auth flow did NOT change in V2).
//   • Frontend uses @polymarket/clob-client-v2 to place orders. V2 orders
//     attach the builderCode directly to the order struct — NO HMAC
//     headers needed for CLOB calls (the V2 cutover removed those).
//   • We expose:
//       - POST /api/poly/sign    → returns HMAC headers for the relayer
//       - GET  /api/poly/builder-code → returns the public builderCode
//   • Builder secret + passphrase NEVER leave the server.
//
// Plus bridge endpoints (deposit address, status, withdraw, quote) which
// are unauthenticated public Polymarket APIs we proxy so the frontend
// doesn't need to know URLs / handle CORS.
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const BRIDGE_URL  = 'https://bridge.polymarket.com';

const BUILDER_KEY        = process.env.POLY_BUILDER_API_KEY        || '';
const BUILDER_SECRET     = process.env.POLY_BUILDER_SECRET         || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE     || '';
const BUILDER_CODE       = process.env.POLY_BUILDER_CODE           || '';

function ok() {
  return !!(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE);
}

// Per-IP rate limiter for /sign. CORS already prevents browser abuse
// from other origins; this prevents someone scripting against the
// endpoint directly. ~600 requests/min is plenty for any single user
// (a trade triggers maybe 5-10 signs).
const _signRate = new Map();
function checkSignRate(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (_signRate.get(ip) || []).filter(t => t > windowStart);
  if (hits.length >= 600) return false;
  hits.push(now);
  _signRate.set(ip, hits);
  // Trim map to prevent unbounded growth.
  if (_signRate.size > 5000) {
    for (const [k, arr] of _signRate.entries()) {
      if (!arr.some(t => t > windowStart)) _signRate.delete(k);
    }
  }
  return true;
}

// Polymarket HMAC signature: SHA256(secret, timestamp + method + path + body).
// Matches @polymarket/builder-signing-sdk's buildHmacSignature() exactly.
// Secret is base64-encoded (the value from polymarket.com/settings?tab=builder),
// we decode it before keying the HMAC.
function buildHmacSignature(secret, timestampMs, method, path, body) {
  const message = String(timestampMs) + String(method).toUpperCase() + String(path) + (body || '');
  // Builder secrets are base64; accept both base64 and base64url to be safe.
  const normalized = secret.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const secretBytes = Buffer.from(padded, 'base64');
  const sig = crypto.createHmac('sha256', secretBytes).update(message).digest('base64');
  // The SDK / Polymarket relayer accepts standard base64; return as-is.
  return sig;
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
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUILDER CODE — public, frontend reads this to attach to orders.
// ═══════════════════════════════════════════════════════════════════
router.get('/builder-code', (_req, res) => {
  if (!BUILDER_CODE) return res.json({ builderCode: null });
  res.json({ builderCode: BUILDER_CODE });
});

// ═══════════════════════════════════════════════════════════════════
// REMOTE BUILDER SIGNING ENDPOINT — used by SDK's BuilderConfig.
//
// SDK posts: { method, path, body }  (body is the raw stringified JSON)
// We return: signed HMAC headers, SDK attaches them to the relayer call.
//
// This is the EXACT shape Polymarket's reference examples expect.
// ═══════════════════════════════════════════════════════════════════
router.post('/sign', express.json({ limit: '1mb' }), (req, res) => {
  try {
    if (!ok()) return res.status(500).json({ error: 'Builder credentials not configured' });
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    if (!checkSignRate(ip)) return res.status(429).json({ error: 'Too many sign requests' });
    const { method, path, body } = req.body || {};
    if (!method || !path) return res.status(400).json({ error: 'method and path required' });

    const timestampMs = Date.now();
    const signature = buildHmacSignature(BUILDER_SECRET, timestampMs, method, path, body || '');
    res.json({
      POLY_BUILDER_SIGNATURE:  signature,
      POLY_BUILDER_TIMESTAMP:  String(timestampMs),
      POLY_BUILDER_API_KEY:    BUILDER_KEY,
      POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
    });
  } catch (e) {
    res.status(500).json({ error: 'sign_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIDGE PROXIES — public Polymarket endpoints, just CORS-fronted.
// ═══════════════════════════════════════════════════════════════════

// Get a deposit address for the user's safe.
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

// Bridge status for a SVM (Solana) deposit address.
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

// Withdraw pUSD → Solana USDC (free, instant).
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

// Withdraw quote (preview fees / minimums).
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

// Supported bridge assets (cached 10min).
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
 