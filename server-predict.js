// server-predict.js
// Express router for Jupiter Prediction Market API + Jupiter Ultra swap.
// Mount in server.js with:   app.use('/api/predict', require('./server-predict'));
//
// Spec: https://dev.jup.ag/docs/prediction
//
// Env (optional):
//   JUPITER_API_KEY    -- from https://portal.jup.ag
//                         If set, attached as x-api-key.
//                         If empty, no header is sent (an empty x-api-key
//                         causes Jupiter to return HTTP 401).
//
// Geo: Jupiter blocks US + South Korea IPs from this API. The server's
// outbound IP is what's checked, not the user's.

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const JUP_API_KEY = (process.env.JUPITER_API_KEY || '').trim();
const PRED_BASE   = 'https://api.jup.ag/prediction/v1';
const ULTRA_BASE  = 'https://api.jup.ag/ultra/v1';

// Attestation log. Path can be overridden via env to point at a Railway Volume
// mount (e.g. ATTEST_LOG_PATH=/data/attestations.jsonl) so records survive
// redeploys. Default writes to /tmp which is wiped on container restart —
// for production, configure a volume.
const ATTEST_LOG_PATH = process.env.ATTEST_LOG_PATH ||
  path.join(process.env.HOME || '/tmp', 'predict-attestations.jsonl');

// ── Forwarder ────────────────────────────────────────────────────────────────
async function fwd(req, res, url, method = 'GET', body = undefined) {
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (JUP_API_KEY) headers['x-api-key'] = JUP_API_KEY;

    const opts = { method, headers };
    if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

    const r   = await fetch(url, opts);
    const txt = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(txt);
  } catch (e) {
    console.error('[predict] fwd error', url, e?.message);
    res.status(502).json({ error: 'upstream_failed', message: e?.message || String(e) });
  }
}

// ── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ ok: true, hasKey: !!JUP_API_KEY, keyLen: JUP_API_KEY.length });
});

// ── Attestation log ──────────────────────────────────────────────────────────
// POST /api/predict/attest  { wallet, timestamp }
// Appends a single JSON line per attestation with wallet, client timestamp,
// server timestamp, IP, and user-agent. JSONL format so it's easy to grep,
// tail, or parse later. Failures are logged but never error the client.
router.post('/attest', express.json(), (req, res) => {
  try {
    const { wallet, timestamp } = req.body || {};
    if (!wallet || typeof wallet !== 'string' || wallet.length < 32) {
      return res.status(400).json({ error: 'invalid_wallet' });
    }
    const record = {
      wallet,
      clientTimestamp: timestamp || null,
      serverTimestamp: new Date().toISOString(),
      ip: req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
          || req.socket?.remoteAddress
          || null,
      userAgent: req.headers['user-agent'] || null,
      country: req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || null,
    };
    fs.appendFile(ATTEST_LOG_PATH, JSON.stringify(record) + '\n', err => {
      if (err) console.error('[predict] attest log write failed:', err.message);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[predict] attest error:', e?.message);
    res.status(500).json({ error: 'log_failed' });
  }
});

// ── Events ───────────────────────────────────────────────────────────────────
// GET /api/predict/events?category=crypto
// Always asks Jupiter to include markets so cards show pricing. No default
// filter — Jupiter's filter values (new|live|trending|upcoming) are curated
// subsets, not strict status filters; omitting the param returns everything
// currently trading so short-dated markets show up too. UI sorts client-side.
router.get('/events', (req, res) => {
  const q = new URLSearchParams(req.query);
  if (!q.has('includeMarkets')) q.set('includeMarkets', 'true');
  if (!q.has('limit'))          q.set('limit', '200');
  return fwd(req, res, `${PRED_BASE}/events?${q.toString()}`);
});

// GET /api/predict/events/search?query=...
router.get('/events/search', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/events/search?${qs}`);
});

// GET /api/predict/events/:eventId
router.get('/events/:eventId', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/events/${encodeURIComponent(req.params.eventId)}`);
});

// ── Markets / Orderbook / Trading Status ─────────────────────────────────────
router.get('/markets/:marketId', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/markets/${encodeURIComponent(req.params.marketId)}`);
});

router.get('/orderbook/:marketId', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/orderbook/${encodeURIComponent(req.params.marketId)}`);
});

router.get('/trading-status', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/trading-status`);
});

// ── Orders ───────────────────────────────────────────────────────────────────
// POST /api/predict/orders  --  create buy order, returns base64 tx
router.post('/orders', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/orders`, 'POST', req.body);
});

// GET /api/predict/orders?ownerPubkey=...   -- list user's orders
// GET /api/predict/orders/status/:orderPubkey
router.get('/orders', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/orders?${qs}`);
});
router.get('/orders/status/:orderPubkey', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/orders/status/${encodeURIComponent(req.params.orderPubkey)}`);
});

// ── Positions ────────────────────────────────────────────────────────────────
// GET /api/predict/positions?ownerPubkey=...
router.get('/positions', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/positions?${qs}`);
});

// GET /api/predict/positions/:positionPubkey  -- single position lookup
router.get('/positions/:positionPubkey', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/positions/${encodeURIComponent(req.params.positionPubkey)}`);
});

// DELETE /api/predict/positions/:positionPubkey  -- close (sell) entire position
router.delete('/positions/:positionPubkey', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/positions/${encodeURIComponent(req.params.positionPubkey)}`, 'DELETE', req.body);
});

// DELETE /api/predict/positions  -- close all positions
router.delete('/positions', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/positions`, 'DELETE', req.body);
});

// POST /api/predict/positions/:positionPubkey/claim  -- claim winnings
router.post('/positions/:positionPubkey/claim', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/positions/${encodeURIComponent(req.params.positionPubkey)}/claim`, 'POST', req.body);
});

// ── History ──────────────────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/history?${qs}`);
});

// ── Jupiter Ultra swap (SOL → USDC fallback) ─────────────────────────────────
router.get('/ultra/order', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${ULTRA_BASE}/order?${qs}`);
});
router.post('/ultra/execute', express.json(), (req, res) => {
  return fwd(req, res, `${ULTRA_BASE}/execute`, 'POST', req.body);
});

module.exports = router;
