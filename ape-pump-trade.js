// ape-pump-trade.js — dedicated Pump.fun trade route for the Ape (burner) page.
//  
// WHY A SEPARATE FILE
//   The Ape page signs locally with a burner keypair: it fetches a fully-built
//   PumpPortal transaction, decodes it, appends the 3% platform-fee (+ optional
//   referral) instruction, and re-signs ONE atomic tx — then submits it via
//   /api/trade-rpc (Alchemy primary, Ankr fallback).
//
//   This route is intentionally separate from:
//     - server.js's inline /api/pumpfun/trade  (LEFT UNTOUCHED), and
//     - pumpfun-trade.js's pump-sdk builder     (serves LaunchRadar; returns
//       instructions, NOT a tx).
//   Keeping Ape on its own route + shape avoids the /api/pumpfun/trade
//   collision and lets the two flows evolve independently.
//
// RPC
//   NONE here. PumpPortal returns the built tx; the client decodes + submits.
//   No Alchemy / Ankr / Devnet usage in this file — all RPC routing stays in
//   server.js and /api/trade-rpc exactly as-is.
//
// RESPONSE SHAPE (matches what Ape.jsx already expects)
//   { action, route:'pumpportal', pool, slippagePct, priorityFee, tx }
//   where `tx` is a base64 serialized (unsigned) VersionedTransaction.
//
// MOUNT — add ONE line to server.js, after app.use(express.json()):
//   require('./ape-pump-trade').mountRoutes(app);

const PUMPPORTAL_URL = 'https://pumpportal.fun/api/trade-local';
const BASE58_RE      = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SLIPPAGE_PCT   = 10;
const PRIORITY_FEE   = 0.0001;
const ROUTE          = '/api/ape/pump-trade';
const TIMEOUT_MS     = 15_000;

async function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try   { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function mountRoutes(app) {
  app.post(ROUTE, async (req, res) => {
    try {
      const b = req.body || {};
      const action = b.action;

      // ── Validate ──
      if (action !== 'buy' && action !== 'sell')
        return res.status(400).json({ error: 'action must be buy or sell' });
      if (!b.mint || !BASE58_RE.test(String(b.mint)))
        return res.status(400).json({ error: 'Invalid mint' });
      if (!b.user || !BASE58_RE.test(String(b.user)))
        return res.status(400).json({ error: 'Invalid user' });
      if (b.amount == null)
        return res.status(400).json({ error: 'Missing amount' });

      let amountStr, denominatedInSol;
      if (action === 'buy') {
        // amount = SOL lamports (string). The client has already sized the
        // curve-budget portion for the slippage upper-bound.
        const lamports = BigInt(String(b.amount));
        if (lamports <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });
        amountStr = (Number(lamports) / 1e9).toFixed(9);
        denominatedInSol = 'true';
      } else {
        // amount = raw token units (string).
        const raw = BigInt(String(b.amount));
        if (raw <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });
        const decimals = Number(b.decimals ?? 6);
        amountStr = (Number(raw) / Math.pow(10, decimals)).toString();
        denominatedInSol = 'false';
      }

      const r = await fetchWithTimeout(PUMPPORTAL_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream, application/json' },
        body:    JSON.stringify({
          publicKey:        b.user,
          action,
          mint:             b.mint,
          amount:           amountStr,
          denominatedInSol,
          slippage:         SLIPPAGE_PCT,
          priorityFee:      PRIORITY_FEE,
          pool:             b.pool || 'auto',
        }),
      });

      if (!r.ok) {
        const text  = await r.text().catch(() => '');
        const lower = text.toLowerCase();
        console.warn('[ape-pump-trade] PumpPortal HTTP ' + r.status + ': ' + text.slice(0, 200));
        if (lower.includes('not a pump') || lower.includes('invalid mint') || lower.includes('not found'))
          return res.status(404).json({ error: 'Not a pump.fun token (PumpPortal does not support this mint).' });
        if (lower.includes('insufficient'))
          return res.status(400).json({ error: 'Not enough SOL for this trade + fees.' });
        return res.status(r.status).json({ error: 'PumpPortal: ' + (text.slice(0, 200) || r.statusText) });
      }

      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length === 0) return res.status(502).json({ error: 'PumpPortal returned empty body.' });

      return res.json({
        action,
        route:       'pumpportal',
        pool:        b.pool || 'auto',
        slippagePct: SLIPPAGE_PCT,
        priorityFee: PRIORITY_FEE,
        tx:          buf.toString('base64'),
      });
    } catch (e) {
      if (e && e.name === 'AbortError')
        return res.status(504).json({ error: 'PumpPortal timed out' });
      console.warn('[ape-pump-trade]', String(e?.message || e));
      return res.status(500).json({ error: (e && e.message) ? e.message.slice(0, 200) : 'Unknown error' });
    }
  });
}

module.exports = { mountRoutes, ROUTE };
