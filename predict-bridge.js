'use strict';

// =============================================================================
// Nexus DEX prediction-market bridge module.
// Mount with:  require('./predict-bridge')(app);
//
// Architecture:
//   Polymarket's own Bridge API at bridge.polymarket.com (proxy of
//   fun.xyz) handles all cross-chain plumbing. This module simply
//   proxies calls from the frontend to that service and adds a thin
//   compatibility layer over the Gamma API.
//
// Endpoints installed:
//   POST /api/bridge/deposit-addresses   get the Solana deposit address for an EVM wallet
//   POST /api/bridge/withdraw/prepare    build a withdrawal challenge for the user to sign
//   POST /api/bridge/withdraw/submit     submit the signed challenge to Polymarket
//   GET  /api/bridge/status/:id          query bridge tracking (deposit or withdrawal)
//   GET  /api/gamma/*                    Polymarket Gamma proxy (CORS fallback)
//
// Why we proxy:
//   - Avoids CORS bites if bridge.polymarket.com's headers ever tighten
//   - Single integration vendor pinned in one file (easy to swap)
//   - Lets us add OFAC/geo checks server-side as a defense-in-depth layer
//     in addition to the frontend checks
//
// No KYC, no partner approval, no API keys required. Polymarket's
// Bridge API is fully public — same access Jupiter uses for their
// Predict tab.
// =============================================================================

const POLY_BRIDGE = 'https://bridge.polymarket.com';
const POLY_GAMMA  = 'https://gamma-api.polymarket.com';

// ---- helpers ---------------------------------------------------------------

function isEvm(s)        { return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s); }
function isSolAddress(s) { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }
function scrub(s)        { return typeof s === 'string' ? s.replace(/[A-Za-z0-9+/=]{64,}/g, '***') : s; }
function logErr(tag, e)  { console.warn(`[predict-bridge:${tag}] ${scrub(e?.message || String(e))}`); }

async function fetchWithTimeout(url, opts, ms = 10_000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  try   { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function forwardJson(res, upstreamResp) {
  res.status(upstreamResp.status);
  const txt = await upstreamResp.text();
  try   { res.json(JSON.parse(txt)); }
  catch { res.type('application/json').send(txt); }
}

// =============================================================================
// Installer
// =============================================================================

module.exports = function installPredictBridge(app) {

  // -- /api/bridge/deposit-addresses ----------------------------------------
  // Frontend calls this with the user's derived EVM address. We forward
  // to bridge.polymarket.com which returns a stable Solana deposit
  // address (one per EVM address, same EVM always returns same SVM).
  app.post('/api/bridge/deposit-addresses', async (req, res) => {
    try {
      const { evmAddress } = req.body || {};
      if (!isEvm(evmAddress)) return res.status(400).json({ error: 'invalid evmAddress' });

      const r = await fetchWithTimeout(POLY_BRIDGE + '/deposit-addresses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body:    JSON.stringify({ address: evmAddress }),
      }, 12_000);
      return forwardJson(res, r);
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).json({ error: 'bridge timeout' });
      logErr('deposit-addresses', e);
      return res.status(502).json({ error: 'bridge deposit lookup failed' });
    }
  });

  // -- /api/bridge/withdraw/prepare -----------------------------------------
  // Builds a withdrawal challenge that the user's derived EVM key
  // must sign client-side. We forward to bridge.polymarket.com which
  // returns the deterministic challenge message + a challenge id.
  app.post('/api/bridge/withdraw/prepare', async (req, res) => {
    try {
      const { fromEvm, destChain, destAddress, amountAtomicUsdc } = req.body || {};
      if (!isEvm(fromEvm))                    return res.status(400).json({ error: 'invalid fromEvm' });
      if (destChain !== 'solana')             return res.status(400).json({ error: 'destChain must be solana for v1' });
      if (!isSolAddress(destAddress))         return res.status(400).json({ error: 'invalid destAddress' });
      if (!/^\d+$/.test(String(amountAtomicUsdc) || ''))
        return res.status(400).json({ error: 'invalid amountAtomicUsdc' });

      const r = await fetchWithTimeout(POLY_BRIDGE + '/withdraw/prepare', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body:    JSON.stringify({
          from:        fromEvm,
          to_chain:    'solana',
          to_address:  destAddress,
          amount:      String(amountAtomicUsdc),
          asset:       'USDCe',
        }),
      }, 12_000);
      return forwardJson(res, r);
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).json({ error: 'bridge timeout' });
      logErr('withdraw-prepare', e);
      return res.status(502).json({ error: 'withdraw prepare failed' });
    }
  });

  // -- /api/bridge/withdraw/submit ------------------------------------------
  // Frontend submits the signed challenge. Polymarket bridges USDC.e
  // -> USDC on Solana to the destination address. Typical delivery
  // 1-3 min.
  app.post('/api/bridge/withdraw/submit', async (req, res) => {
    try {
      const { challengeId, signature } = req.body || {};
      if (!challengeId)            return res.status(400).json({ error: 'challengeId required' });
      if (!/^0x[a-fA-F0-9]+$/.test(String(signature || '')))
        return res.status(400).json({ error: 'invalid signature format' });

      const r = await fetchWithTimeout(POLY_BRIDGE + '/withdraw/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body:    JSON.stringify({ challenge_id: challengeId, signature }),
      }, 15_000);
      return forwardJson(res, r);
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).json({ error: 'bridge timeout' });
      logErr('withdraw-submit', e);
      return res.status(502).json({ error: 'withdraw submit failed' });
    }
  });

  // -- /api/bridge/status/:id -----------------------------------------------
  // Generic status lookup for deposits and withdrawals by tracking id.
  app.get('/api/bridge/status/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id))
        return res.status(400).json({ error: 'invalid id' });
      const r = await fetchWithTimeout(POLY_BRIDGE + '/status/' + encodeURIComponent(id),
        { headers: { accept: 'application/json' } }, 8_000);
      return forwardJson(res, r);
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).json({ error: 'bridge timeout' });
      logErr('status', e);
      return res.status(502).json({ error: 'status lookup failed' });
    }
  });

  // -- /api/gamma/* — Polymarket Gamma proxy (CORS fallback) ---------------
  // The frontend defaults to hitting Gamma directly (CORS is open as of
  // 2026). Switch to this proxy only if browsers complain, by setting
  // REACT_APP_POLYMARKET_GAMMA_BASE to '/api/gamma'.
  app.get('/api/gamma/*', async (req, res) => {
    try {
      const sub = req.path.replace('/api/gamma', '');
      const qs  = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const url = POLY_GAMMA + sub + qs;
      const r   = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 10_000);
      return forwardJson(res, r);
    } catch (e) {
      if (e.name === 'AbortError') return res.status(504).json({ error: 'gamma timeout' });
      logErr('gamma', e);
      return res.status(502).json({ error: 'gamma proxy failed' });
    }
  });

  console.log('[predict-bridge] mounted: /api/bridge/{deposit-addresses,withdraw/*,status} + /api/gamma/*');
};
