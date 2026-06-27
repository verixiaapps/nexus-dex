// ape-pump-candles.js — REAL bonding-curve candles for the Ape page.
//
// WHY THIS EXISTS
//   GeckoTerminal only indexes a pool AFTER a token has a Raydium/PumpSwap
//   market — i.e. once it has (nearly) graduated. For the fresh pump.fun
//   launches that fill the Ape feed, GeckoTerminal has nothing, so both the
//   detail chart and the row sparkline came up empty (and the old code then
//   faked a line). This route serves the token's REAL on-curve trade history
//   straight from pump.fun's own candlestick API so the newest tokens get an
//   accurate chart + sparkline from their first trade. No synthetic data.
//
//   Server-side only: pump.fun's frontend API is CORS-locked and rate-limits
//   browser IPs. Proxying it here (same pattern as ape-pump-trade.js) makes it
//   reliable and lets the client stay dumb.
//
// ROUTE
//   GET /api/ape/pump-candles/:mint?tf=1&limit=200
//     tf    = candle timeframe in MINUTES (1,5,15,60,240,1440…). Default 1.
//     limit = max candles, newest-trimmed. Default 200, hard-capped 1000.
//
// RESPONSE  { mint, timeframe, count, candles:[{t,o,h,l,c,v}], closes:[..] }
//   t = unix seconds, o/h/l/c = USD price, v = volume. candles oldest→newest.
//   404 when pump.fun has no history yet (token too new / not a pump token).
//
// MOUNT (server.js, after app.use(express.json())):
//   require('./ape-pump-candles').mountRoutes(app);
//
// NOTE ON BLOCKING: if pump.fun starts cloudflare-blocking your server IP,
//   swap the HOSTS below for a keyed provider (Bitquery / Moralis / Birdeye)
//   that exposes pump.fun OHLCV — the response shape here is the contract the
//   client depends on, so only the fetch needs to change.

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ROUTE      = '/api/ape/pump-candles/:mint';
const TIMEOUT_MS = 12_000;

// pump.fun candlestick hosts, tried in order. v3 is current; the bare host is
// a fallback in case v3 is regionally flaky.
const HOSTS = [
  'https://frontend-api-v3.pump.fun',
  'https://frontend-api-v2.pump.fun',
  'https://frontend-api.pump.fun',
];

const ALLOWED_TF = new Set([1, 5, 15, 30, 60, 240, 720, 1440]);

// Small server-side cache so a token everyone is watching only hits pump.fun
// once per TTL, not once per viewer. Last-good value is kept short; charts move
// by the minute, not the second.
const CACHE_TTL_MS = 8_000;
const CACHE_MAX    = 2_000;
const _candleCache = new Map(); // `${mint}:${tf}` -> { at, candles }
function _cacheGet(key) {
  const h = _candleCache.get(key);
  if (h && (Date.now() - h.at) < CACHE_TTL_MS) return h.candles;
  return null;
}
function _cacheSet(key, candles) {
  _candleCache.set(key, { at: Date.now(), candles });
  if (_candleCache.size > CACHE_MAX) { const k = _candleCache.keys().next().value; if (k) _candleCache.delete(k); }
}

async function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try   { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// Defensive normaliser — pump.fun has shipped a few field spellings over time.
// Accept any of them and emit a single {t,o,h,l,c,v} shape.
function normCandle(row) {
  if (!row || typeof row !== 'object') return null;
  const o = Number(row.open  ?? row.o);
  const h = Number(row.high  ?? row.h);
  const l = Number(row.low   ?? row.l);
  const c = Number(row.close ?? row.c);
  let t   = Number(row.timestamp ?? row.time ?? row.t ?? row.ts ?? row.start);
  const v = Number(row.volume ?? row.v ?? 0) || 0;
  if (!Number.isFinite(c) || c <= 0) return null;
  // pump.fun returns seconds; tolerate ms.
  if (Number.isFinite(t) && t > 1e12) t = Math.floor(t / 1000);
  return {
    t: Number.isFinite(t) ? t : 0,
    o: Number.isFinite(o) && o > 0 ? o : c,
    h: Number.isFinite(h) && h > 0 ? h : c,
    l: Number.isFinite(l) && l > 0 ? l : c,
    c, v,
  };
}

async function pumpCandles(mint, tf, limit) {
  const headers = {
    Accept: 'application/json',
    // A browser-ish UA reduces the odds of an automated-traffic block.
    'User-Agent': 'Mozilla/5.0 (compatible; ApeTerminal/1.0)',
    Origin: 'https://pump.fun',
    Referer: 'https://pump.fun/',
  };
  for (const host of HOSTS) {
    const url = `${host}/candlesticks/${mint}?offset=0&limit=${limit}&timeframe=${tf}`;
    try {
      const r = await fetchWithTimeout(url, { headers });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const arr = Array.isArray(j) ? j : (Array.isArray(j && j.candlesticks) ? j.candlesticks : null);
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const candles = arr.map(normCandle).filter(Boolean).sort((a, b) => a.t - b.t);
      if (candles.length >= 2) return candles;
    } catch (e) { /* try next host */ }
  }
  return null;
}

function mountRoutes(app) {
  app.get(ROUTE, async (req, res) => {
    try {
      const mint = String(req.params.mint || '');
      if (!BASE58_RE.test(mint)) return res.status(400).json({ error: 'Invalid mint' });

      let tf = Number(req.query.tf);
      if (!ALLOWED_TF.has(tf)) tf = 1;
      let limit = Number(req.query.limit);
      limit = Number.isFinite(limit) ? Math.min(1000, Math.max(2, Math.floor(limit))) : 200;

      const cacheKey = mint + ':' + tf;
      let candles = _cacheGet(cacheKey);
      if (!candles) {
        candles = await pumpCandles(mint, tf, limit);
        if (candles) _cacheSet(cacheKey, candles);
      }
      if (!candles) {
        return res.status(404).json({ error: 'No pump.fun candle history yet.' });
      }

      // Cache briefly at the edge — candles for a live token change by the
      // minute, not the second, and the client also caches per mint.
      res.set('Cache-Control', 'public, max-age=10');
      return res.json({
        mint,
        timeframe: tf,
        count: candles.length,
        candles,
        closes: candles.map(k => k.c),
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return res.status(504).json({ error: 'pump.fun timed out' });
      console.warn('[ape-pump-candles]', String(e?.message || e));
      return res.status(500).json({ error: (e && e.message) ? e.message.slice(0, 200) : 'Unknown error' });
    }
  });
}

module.exports = { mountRoutes, ROUTE };
