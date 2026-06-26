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
const PRIORITY_FEE   = 0.001;
const ROUTE          = '/api/ape/pump-trade';
const TIMEOUT_MS     = 15_000;

// ── Jupiter fallback (graduated tokens) ──────────────────────────────
// Once a pump.fun token graduates off the bonding curve it moves to
// Raydium / pump-amm and PumpPortal can no longer trade it. Jupiter
// aggregates those venues. This route builds a full swap tx the burner
// signs+sends — same { tx } base64 shape as the pump route, so the
// client treats both identically. The 3% platform fee is added by the
// CLIENT (same as the pump path) by appending a transfer ix after decode,
// so we do NOT use Jupiter's platformFee here — keeps fee logic in one place.
const JUP_QUOTE_URL    = 'https://api.jup.ag/swap/v1/quote';
const JUP_SWAP_URL     = 'https://api.jup.ag/swap/v1/swap';
const SOL_MINT_STR     = 'So11111111111111111111111111111111111111112';
const JUP_SLIPPAGE_BPS = 1000; // 10%, matches pump route
const JUP_ROUTE        = '/api/ape/jup-trade';
const JUPITER_API_KEY  = process.env.JUPITER_API_KEY || '';

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
        // Signal graduation distinctly so the client can fall back to Jupiter.
        if (lower.includes('bonding curve complete') || lower.includes('graduated')
            || lower.includes('not a pump') || lower.includes('invalid mint') || lower.includes('not found'))
          return res.status(409).json({ error: 'graduated', detail: 'Token not on the pump.fun bonding curve (graduated or unsupported).' });
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

  // ── Jupiter route — graduated tokens ──────────────────────────────
  // Same request shape as the pump route. Builds a full unsigned swap tx
  // (burner is userPublicKey) and returns it base64 for the burner to sign.
  // Buy:  SOL -> mint  (amount = SOL lamports)
  // Sell: mint -> SOL  (amount = raw token units)
  app.post(JUP_ROUTE, async (req, res) => {
    try {
      const b = req.body || {};
      const action = b.action;
      if (action !== 'buy' && action !== 'sell')
        return res.status(400).json({ error: 'action must be buy or sell' });
      if (!b.mint || !BASE58_RE.test(String(b.mint)))
        return res.status(400).json({ error: 'Invalid mint' });
      if (!b.user || !BASE58_RE.test(String(b.user)))
        return res.status(400).json({ error: 'Invalid user' });
      if (b.amount == null)
        return res.status(400).json({ error: 'Missing amount' });

      const amount = BigInt(String(b.amount));
      if (amount <= 0n) return res.status(400).json({ error: 'Amount must be > 0' });

      const inputMint  = action === 'buy' ? SOL_MINT_STR : b.mint;
      const outputMint = action === 'buy' ? b.mint : SOL_MINT_STR;

      // 1) Quote
      const qs = new URLSearchParams({
        inputMint,
        outputMint,
        amount:      amount.toString(),
        slippageBps: String(JUP_SLIPPAGE_BPS),
        swapMode:    'ExactIn',
      });
      const quoteHeaders = { Accept: 'application/json' };
      if (JUPITER_API_KEY) quoteHeaders['x-api-key'] = JUPITER_API_KEY;
      const qr = await fetchWithTimeout(JUP_QUOTE_URL + '?' + qs.toString(), { headers: quoteHeaders });
      if (!qr.ok) {
        const t = await qr.text().catch(() => '');
        const lower = t.toLowerCase();
        if (lower.includes('no route') || lower.includes('could not find'))
          return res.status(404).json({ error: 'No Jupiter route for this token.' });
        return res.status(qr.status).json({ error: 'Jupiter quote: ' + (t.slice(0, 200) || qr.statusText) });
      }
      const quote = await qr.json();
      if (!quote || !quote.outAmount)
        return res.status(404).json({ error: 'No Jupiter route for this token.' });

      // 2) Build swap tx for the burner (unsigned). Let Jupiter set a sane
      // priority fee; wrap SOL automatically for buys.
      const swapHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (JUPITER_API_KEY) swapHeaders['x-api-key'] = JUPITER_API_KEY;
      const sr = await fetchWithTimeout(JUP_SWAP_URL, {
        method: 'POST',
        headers: swapHeaders,
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: b.user,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      });
      if (!sr.ok) {
        const t = await sr.text().catch(() => '');
        return res.status(sr.status).json({ error: 'Jupiter swap: ' + (t.slice(0, 200) || sr.statusText) });
      }
      const swap = await sr.json();
      if (!swap || !swap.swapTransaction)
        return res.status(502).json({ error: 'Jupiter returned no swapTransaction.' });

      return res.json({
        action,
        route:       'jupiter',
        slippagePct: JUP_SLIPPAGE_BPS / 100,
        tx:          swap.swapTransaction, // already base64
        outAmount:   String(quote.outAmount),
      });
    } catch (e) {
      if (e && e.name === 'AbortError')
        return res.status(504).json({ error: 'Jupiter timed out' });
      console.warn('[ape-jup-trade]', String(e?.message || e));
      return res.status(500).json({ error: (e && e.message) ? e.message.slice(0, 200) : 'Unknown error' });
    }
  });
}

module.exports = { mountRoutes, ROUTE, JUP_ROUTE };
