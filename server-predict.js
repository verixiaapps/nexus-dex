// server-predict.js
// Express router for Jupiter Prediction Market + Jupiter Ultra swap proxy.
// Mount in server.js with:   app.use('/api/predict', require('./server-predict'));
//
// Env required:
//   JUPITER_API_KEY    -- from https://developers.jup.ag/portal
//
// All endpoints proxy to Jupiter so the API key never reaches the browser.

const express = require('express');
const router  = express.Router();

const JUP_API_KEY  = process.env.JUPITER_API_KEY || '';
const PRED_BASE    = 'https://api.jup.ag/prediction/v1';
const ULTRA_BASE   = 'https://api.jup.ag/ultra/v1';

// ── Helpers ──────────────────────────────────────────────────────────────────
function need(key) {
  if (!JUP_API_KEY) {
    console.warn('[predict] JUPITER_API_KEY not set — requests will fail');
  }
  return JUP_API_KEY;
}

async function fwd(req, res, url, method = 'GET', body = undefined) {
  try {
    const headers = { 'x-api-key': need(), 'Content-Type': 'application/json' };
    const opts = { method, headers };
    if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    const r = await fetch(url, opts);
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
  res.json({ ok: true, hasKey: !!JUP_API_KEY });
});

// ── Events / Markets discovery ───────────────────────────────────────────────
// GET /api/predict/events?category=crypto&limit=20
router.get('/events', (req, res) => {
  const q = new URLSearchParams(req.query);
  if (!q.has('provider')) q.set('provider', 'polymarket');
  if (!q.has('limit'))    q.set('limit', '80');
  return fwd(req, res, `${PRED_BASE}/events?${q.toString()}`);
});

// GET /api/predict/markets?eventId=...
router.get('/markets', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/markets?${qs}`);
});

// GET /api/predict/market/:marketId
router.get('/market/:marketId', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/markets/${encodeURIComponent(req.params.marketId)}`);
});

// ── Orders ───────────────────────────────────────────────────────────────────
// POST /api/predict/orders   -- create buy/sell order, returns base64 tx
router.post('/orders', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/orders`, 'POST', req.body);
});

// GET /api/predict/orders/status/:orderPubkey
router.get('/orders/status/:orderPubkey', (req, res) => {
  return fwd(req, res, `${PRED_BASE}/orders/status/${encodeURIComponent(req.params.orderPubkey)}`);
});

// ── Positions ────────────────────────────────────────────────────────────────
// GET /api/predict/positions?owner=...
router.get('/positions', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${PRED_BASE}/positions?${qs}`);
});

// POST /api/predict/positions/sell   -- close/sell a position
router.post('/positions/sell', express.json(), (req, res) => {
  // Sell uses the same /orders endpoint with isBuy:false and positionPubkey set.
  return fwd(req, res, `${PRED_BASE}/orders`, 'POST', req.body);
});

// POST /api/predict/positions/claim
router.post('/positions/claim', express.json(), (req, res) => {
  return fwd(req, res, `${PRED_BASE}/positions/claim`, 'POST', req.body);
});

// ── Jupiter Ultra swap (SOL → USDC) ──────────────────────────────────────────
// GET /api/predict/ultra/order?inputMint=...&outputMint=...&amount=...&taker=...
router.get('/ultra/order', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return fwd(req, res, `${ULTRA_BASE}/order?${qs}`);
});

// POST /api/predict/ultra/execute   -- submit signed tx via Ultra
router.post('/ultra/execute', express.json(), (req, res) => {
  return fwd(req, res, `${ULTRA_BASE}/execute`, 'POST', req.body);
});

module.exports = router;
