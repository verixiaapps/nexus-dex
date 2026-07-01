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
//   instruction and signs ONE atomic transaction, then submits it via
//   /api/trade-rpc (Alchemy primary, Ankr fallback — the only place Ankr
//   is used).
//
// SLIPPAGE
//   10% on both buys and sells. The client's BUY math sizes the trade portion
//   so that even at full 10% upper-bound the wallet cannot overdraw:
//       feeLamports + tradeLamports * 1.10 ≤ totalLamports
//   Changing this number requires updating the matching divisor (110n) in
//   LaunchRadar.jsx's swapParams BUY branch.
//
// RPC
//   Reads from the same env vars as server.js:
//     SOLANA_NETWORK=mainnet (default) → ALCHEMY_RPC_URL
//     SOLANA_NETWORK=devnet           → DEVNET_RPC_URL
//   No fallback at this layer (state reads only). Ankr fallback applies
//   exclusively at /api/trade-rpc for the actual signed-tx submission.
//
// CACHING
//   fetchGlobal() and fetchFeeConfig() are cached process-wide for 60s.
//   These are the heaviest calls in the trade flow (each does several
//   getAccountInfo RPCs internally) and the underlying accounts almost
//   never change between blocks. This cuts per-trade RPC pressure by
//   roughly half.
//
// DEPENDENCIES
//     npm install @pump-fun/pump-sdk @coral-xyz/anchor bn.js @solana/web3.js
//
// MOUNT (one line in server.js, after express.json()):
//     require('./pumpfun-trade').mountRoutes(app);

const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

// ── SDK import. Official @pump-fun/pump-sdk only (in package.json).
//    No try/catch fallback — if this fails, we want the real error visible,
//    not a confusing MODULE_NOT_FOUND for a package that was never installed.
const _pkg = require('@pump-fun/pump-sdk');

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

// ── Solana RPC URL resolution ─────────────────────────────────────────────
// Two env vars only:
//   ALCHEMY_RPC_URL — used when SOLANA_NETWORK=mainnet (default).
//   DEVNET_RPC_URL  — used when SOLANA_NETWORK=devnet.
// No fallback chain here. The buy/sell Ankr fallback lives at
// /api/trade-rpc in server.js, which is where the signed transaction
// actually gets submitted.
const SOLANA_NETWORK = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();

function getRpcUrl() {
  const url = SOLANA_NETWORK === 'devnet'
    ? (process.env.DEVNET_RPC_URL  || '').trim()
    : (process.env.ALCHEMY_RPC_URL || '').trim();
  if (!url) {
    throw new Error(SOLANA_NETWORK === 'devnet'
      ? 'pumpfun-trade: DEVNET_RPC_URL is not set'
      : 'pumpfun-trade: ALCHEMY_RPC_URL is not set');
  }
  return url;
}

// Cached instances for the process.
let _online = null;
let _offline; // undefined until first resolved (may end up null)
function getOnline() {
  if (!_online) {
    const url = getRpcUrl();
    let host = 'invalid-url';
    try { host = new URL(url).host; } catch {}
    console.log('[pumpfun-trade] RPC host:', host);
    const conn = new Connection(url, 'confirmed');
    _online = new OnlineClass(conn);
  }
  return _online;
}
function getOffline() {
  if (_offline !== undefined) return _offline;
  _offline = null;
  const conn = new Connection(getRpcUrl(), 'confirmed');
  try {
    if (_pkg.PUMP_SDK) _offline = _pkg.PUMP_SDK;              // exported singleton
    else if (OfflineClass) _offline = new OfflineClass(conn); // PumpSdk(connection)
  } catch (e) {
    try { _offline = new OfflineClass(); }                    // ctor may take no args
    catch (e2) { _offline = null; }
  }
  return _offline;
}

// ── Cache for pump globals ────────────────────────────────────────────────
// fetchGlobal() and fetchFeeConfig() each do several RPC calls internally
// and return data that almost never changes between blocks. Caching them
// for 60s drops per-trade RPC pressure significantly.
const PUMP_GLOBAL_TTL_MS = 60_000;
let _globalCache    = { value: null, ts: 0 };
let _feeConfigCache = { value: null, ts: 0 };

async function getCachedGlobal(sdk) {
  if (_globalCache.value && Date.now() - _globalCache.ts < PUMP_GLOBAL_TTL_MS) {
    return _globalCache.value;
  }
  const v = await sdk.fetchGlobal();
  _globalCache = { value: v, ts: Date.now() };
  return v;
}

async function getCachedFeeConfig(sdk) {
  if (_feeConfigCache.value && Date.now() - _feeConfigCache.ts < PUMP_GLOBAL_TTL_MS) {
    return _feeConfigCache.value;
  }
  if (typeof sdk.fetchFeeConfig !== 'function') return null;
  try {
    const v = await sdk.fetchFeeConfig();
    _feeConfigCache = { value: v, ts: Date.now() };
    return v;
  } catch (e) {
    console.warn('[pumpfun-trade] fetchFeeConfig failed:', e?.message);
    return null;
  }
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
  // Use the ONLINE OnlinePumpSdk builder (matches the official pump-sdk
  // example: sdk.buyInstructions({...})). It extends the offline PumpSdk, so it
  // has the same object-arg builder, and being connection-backed it resolves
  // the CURRENT fee recipients / mayhem-mode accounts that fresh create_v2
  // tokens require. Offline is only a fallback.
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

// Slippage in this SDK is a PERCENT number (10 = 10%).
// CLIENT MATH ASSUMES THIS VALUE. If you change it, update the divisor (110n)
// in LaunchRadar.jsx's swapParams BUY branch to match (1 + SLIPPAGE_PCT/100).
const SLIPPAGE_PCT = 10;

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

      // Shared global + (optional) fee config — cached 60s to cut RPC load.
      const global    = await getCachedGlobal(sdk);
      const feeConfig = await getCachedFeeConfig(sdk);
      if (!feeConfig) {
        console.warn('[pumpfun-trade] feeConfig is NULL — the buy/sell fee accounts will likely be '
          + 'wrong for current pump tokens (→ IncorrectProgramId). Almost always a server RPC problem.');
      }

      if (action === 'buy') {
        // amount = SOL lamports (string). Client sends the curve-budget portion
        // already sized for the slippage upper-bound — see SLIPPAGE_PCT note above.
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
          feeConfigOk: !!feeConfig,
          mayhem: !!(buyState.bondingCurve && (buyState.bondingCurve.isMayhemMode ?? buyState.bondingCurve.is_mayhem_mode)),
          rpcHost: (() => { try { return new URL(getRpcUrl()).host; } catch { return null; } })(),
          slippagePct: SLIPPAGE_PCT,
          expectedTokens: tokenAmount.toString(),
          instructions: instructions.map(serializeIx),
        });
      }

      // ── SELL ── amount = raw token units (string). Full sell amount; the
      // 3% platform fee is taken from the SOL output client-side after the
      // curve pays native SOL into the user's wallet.
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
        feeConfigOk: !!feeConfig,
        mayhem: !!(sellState.bondingCurve && (sellState.bondingCurve.isMayhemMode ?? sellState.bondingCurve.is_mayhem_mode)),
        rpcHost: (() => { try { return new URL(getRpcUrl()).host; } catch { return null; } })(),
        slippagePct: SLIPPAGE_PCT,
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
 