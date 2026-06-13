// pumpfun-trade.js — Pump.fun bonding-curve trade builder for Launch Radar.
//
// SCOPE
//   Pump.fun BONDING CURVE only. Pre-graduation buys/sells via the pump SDK.
//   Graduated tokens (curve.complete) and non-pump mints are NOT traded here —
//   they return a clean, explicit rejection (no AMM/Jupiter routing).
//
// WHAT THIS DOES
//   Builds buy/sell INSTRUCTIONS server-side using @pump-fun/pump-sdk, returns
//   them to the client as JSON. The client appends the 3% platform-fee
//   instruction and signs ONE atomic transaction.
//
// FIX vs prior revision
//   The instruction builder is now resolved by FEATURE DETECTION instead of a
//   hard-coded `sdk.buyInstructions(...)` call. Depending on the installed
//   @pump-fun/pump-sdk version, the buy/sell builders live either on the
//   OnlinePumpSdk instance (convenience wrappers, newer) or on the offline
//   PumpSdk / PUMP_SDK singleton, and may be named buyInstructions /
//   getBuyInstructions. We probe both objects for both names. If none is
//   found, we throw an error listing every method the SDK actually exposes,
//   so the exact name is obvious in the server log.
//
//   Simplest alternative fix: `npm install @pump-fun/pump-sdk@latest` so the
//   OnlinePumpSdk.buyInstructions/sellInstructions wrappers are present.
//
// DEPENDENCIES
//     npm install @pump-fun/pump-sdk @coral-xyz/anchor bn.js @solana/web3.js
//
// MOUNT (one line in server.js, after express.json()):
//     require('./pumpfun-trade').mountRoutes(app);

const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

// ── SDK import. Works with the official @pump-fun/pump-sdk OR the
//    API-compatible fork @nirholas/pump-sdk.
let _pkg = null;
try {
  _pkg = require('@pump-fun/pump-sdk');
} catch (e) {
  _pkg = require('@nirholas/pump-sdk');
}

const OnlineClass = _pkg.OnlinePumpSdk || _pkg.PumpSdk; // fetch* lives here
const OfflineClass = _pkg.PumpSdk || null;              // offline builders
const _getBuyTokens = _pkg.getBuyTokenAmountFromSolAmount;
const _getSellSol   = _pkg.getSellSolAmountFromTokenAmount;

if (!OnlineClass || !_getBuyTokens || !_getSellSol) {
  throw new Error('pump-sdk: expected exports not found. Install @pump-fun/pump-sdk.');
}

// Curve-math helper supporting BOTH the object-arg form (fork / newer official)
// and the positional form (older official examples).
function callMath(fn, { global, feeConfig, mintSupply, bondingCurve, amount }) {
  try {
    const r = fn({ global, feeConfig, mintSupply, bondingCurve, amount });
    if (r != null) return r;
  } catch (e) { /* fall through to positional */ }
  return fn(global, bondingCurve, amount);
}

// Use your Alchemy RPC (NOT Helius). Set ALCHEMY_RPC_URL (or REACT_APP_ALCHEMY_RPC)
//   = https://solana-mainnet.g.alchemy.com/v2/<KEY>
function getRpcUrl() {
  return process.env.ALCHEMY_RPC_URL
      || process.env.REACT_APP_ALCHEMY_RPC
      || process.env.REACT_APP_SOLANA_RPC
      || 'https://api.mainnet-beta.solana.com';
}

// Cached instances for the process.
let _online = null;
let _offline; // undefined until first resolved (may end up null)
function getOnline() {
  if (!_online) {
    const conn = new Connection(getRpcUrl(), 'confirmed');
    _online = new OnlineClass(conn);
  }
  return _online;
}
function getOffline() {
  if (_offline !== undefined) return _offline;
  _offline = null;
  try {
    if (_pkg.PUMP_SDK) _offline = _pkg.PUMP_SDK;          // exported singleton
    else if (OfflineClass) _offline = new OfflineClass(); // offline ctor (no conn)
  } catch (e) {
    try { _offline = new OfflineClass(new Connection(getRpcUrl(), 'confirmed')); }
    catch (e2) { _offline = null; }
  }
  return _offline;
}

const methodsOf = (obj) => {
  if (!obj) return [];
  const out = new Set();
  let p = obj;
  while (p && p !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(p)) {
      if (n !== 'constructor' && typeof obj[n] === 'function') out.add(n);
    }
    p = Object.getPrototypeOf(p);
  }
  return [...out];
};

let _loggedSurface = false;
function logSurfaceOnce(online, offline) {
  if (_loggedSurface) return;
  _loggedSurface = true;
  console.log('[pump-sdk] online class:', OnlineClass?.name, '→', methodsOf(online).join(', '));
  console.log('[pump-sdk] offline:', offline ? (OfflineClass?.name || 'PUMP_SDK') : '(none)',
    offline ? ('→ ' + methodsOf(offline).join(', ')) : '');
}

// Find the instruction builder for an action across the online instance first,
// then the offline builder. Returns { obj, name } or null.
function resolveBuilder(action) {
  const names = action === 'buy'
    ? ['buyInstructions', 'getBuyInstructions']
    : ['sellInstructions', 'getSellInstructions'];
  const online = getOnline();
  const offline = getOffline();
  logSurfaceOnce(online, offline);
  for (const n of names) if (typeof online[n] === 'function') return { obj: online, name: n };
  if (offline) for (const n of names) if (typeof offline[n] === 'function') return { obj: offline, name: n };
  return null;
}

function noBuilderError(action) {
  const online = getOnline();
  const offline = getOffline();
  const avail = [
    'online(' + (OnlineClass?.name || '?') + '): ' + methodsOf(online).join(', '),
    'offline(' + (offline ? (OfflineClass?.name || 'PUMP_SDK') : 'none') + '): ' + methodsOf(offline).join(', '),
  ].join(' | ');
  return new Error(
    'pump-sdk: no ' + action + '-instruction builder found '
    + '(looked for ' + action + 'Instructions / get' + action[0].toUpperCase() + action.slice(1) + 'Instructions). '
    + 'Available: ' + avail + '. Run `npm install @pump-fun/pump-sdk@latest`.'
  );
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Slippage in this SDK is a PERCENT number (30 = 30%).
const SLIPPAGE_PCT = 30; // volatile fresh launches — high enough to land

function serializeIx(ix) {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => ({
      pubkey:     k.pubkey.toBase58(),
      isSigner:   k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data).toString('base64'),
  };
}

function mountRoutes(app) {
  app.post('/api/pumpfun/trade', async (req, res) => {
    try {
      const b = req.body || {};
      const action = b.action;
      const mintStr = b.mint;
      const userStr = b.user;

      // ── Validate ──
      if (action !== 'buy' && action !== 'sell')
        return res.status(400).json({ error: 'action must be buy or sell' });
      if (!mintStr || !BASE58_RE.test(String(mintStr)))
        return res.status(400).json({ error: 'Invalid mint' });
      if (!userStr || !BASE58_RE.test(String(userStr)))
        return res.status(400).json({ error: 'Invalid user' });

      const mint = new PublicKey(mintStr);
      const user = new PublicKey(userStr);
      const sdk  = getOnline();

      // Shared global + (optional) fee config.
      const global = await sdk.fetchGlobal();
      let feeConfig = null;
      if (typeof sdk.fetchFeeConfig === 'function') {
        try { feeConfig = await sdk.fetchFeeConfig(); } catch (e) { feeConfig = null; }
      }

      if (action === 'buy') {
        // amount = SOL lamports (string). 97% trade portion; fee added client-side.
        const lamports = b.amount;
        if (lamports == null) return res.status(400).json({ error: 'Missing amount' });
        const solAmount = new BN(String(lamports));
        if (solAmount.lten(0)) return res.status(400).json({ error: 'Amount must be > 0' });

        const buyState = await sdk.fetchBuyState(mint, user);
        // ── Detect: still on the bonding curve? ──
        if (buyState.bondingCurve && buyState.bondingCurve.complete) {
          return res.status(409).json({ error: 'Token graduated — not on the bonding curve. Not traded here.' });
        }

        const tokenAmount = callMath(_getBuyTokens, {
          global,
          feeConfig,
          mintSupply: buyState.bondingCurve.tokenTotalSupply,
          bondingCurve: buyState.bondingCurve,
          amount: solAmount,
        });

        const builder = resolveBuilder('buy');
        if (!builder) throw noBuilderError('buy');

        const instructions = await builder.obj[builder.name]({
          ...buyState,        // bondingCurveAccountInfo, bondingCurve,
                              // associatedUserAccountInfo, tokenProgram
          global,
          feeConfig,
          mint,
          user,
          solAmount,
          amount: tokenAmount,
          slippage: SLIPPAGE_PCT,
        });

        return res.json({
          action: 'buy',
          route: 'bonding-curve',
          builder: builder.name,
          tokenProgram: buyState.tokenProgram ? buyState.tokenProgram.toBase58() : null,
          expectedTokens: tokenAmount.toString(),
          instructions: instructions.map(serializeIx),
        });
      }

      // ── SELL ── amount = raw token units (string, the 97% trade portion).
      const rawTokens = b.amount;
      if (rawTokens == null) return res.status(400).json({ error: 'Missing amount' });
      const amount = new BN(String(rawTokens));
      if (amount.lten(0)) return res.status(400).json({ error: 'Amount must be > 0' });

      const sellState = await sdk.fetchSellState(mint, user);
      if (sellState.bondingCurve && sellState.bondingCurve.complete) {
        return res.status(409).json({ error: 'Token graduated — not on the bonding curve. Not traded here.' });
      }

      const solReceived = callMath(_getSellSol, {
        global,
        feeConfig,
        mintSupply: sellState.bondingCurve.tokenTotalSupply,
        bondingCurve: sellState.bondingCurve,
        amount,
      });

      const builder = resolveBuilder('sell');
      if (!builder) throw noBuilderError('sell');

      const instructions = await builder.obj[builder.name]({
        ...sellState,       // bondingCurveAccountInfo, bondingCurve, tokenProgram
        global,
        feeConfig,
        mint,
        user,
        amount,
        solAmount: solReceived,
        slippage: SLIPPAGE_PCT,
      });

      return res.json({
        action: 'sell',
        route: 'bonding-curve',
        builder: builder.name,
        tokenProgram: sellState.tokenProgram ? sellState.tokenProgram.toBase58() : null,
        expectedSol: solReceived.toString(),
        instructions: instructions.map(serializeIx),
      });
    } catch (e) {
      const msg = String(e?.message || e || 'Unknown error');
      if (/graduat|complete/i.test(msg))
        return res.status(409).json({ error: 'Token graduated — not on the bonding curve. Not traded here.' });
      if (/not found|account does not exist|could not find/i.test(msg))
        return res.status(404).json({ error: 'Not a pump.fun bonding-curve token (or not indexed yet).' });
      console.warn('[pumpfun-trade]', msg);
      return res.status(500).json({ error: msg.slice(0, 200) });
    }
  });
}

module.exports = { mountRoutes };
