// pumpfun-trade.js — Pump.fun bonding-curve trade builder for Launch Radar.
//
// WHAT THIS DOES
//   Builds buy/sell INSTRUCTIONS for pre-graduation pump.fun tokens using
//   the official @pump-fun/pump-sdk, then returns them to the client as
//   JSON. The client appends your 3% platform-fee instruction and signs
//   ONE atomic transaction. Jupiter is NOT used here — it's data-only on
//   the Radar page. This is the trade engine.
//
// WHY SERVER-SIDE
//   The SDK needs Node + an RPC connection to fetch on-chain bonding-curve
//   state and auto-detect SPL vs Token-2022. Building instructions in the
//   browser would bloat the bundle and break on the Token-2022 edge cases.
//   So: server fetches state + builds instructions, client signs.
//
// HOW TO MOUNT (one line in server.js, after express.json()):
//
//     require('./pumpfun-trade').mountRoutes(app);
//
// No other server.js changes. CSP already allows what's needed (this
// talks to your own RPC, server-to-server).
//
// DEPENDENCIES (install on the backend):
//     npm install @pump-fun/pump-sdk @coral-xyz/anchor bn.js @solana/web3.js
//
// If @pump-fun/pump-sdk is unavailable, the API-compatible fork
// @nirholas/pump-sdk exposes the identical OnlinePumpSdk surface — swap
// the require string below.

const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

// ── SDK import. Works with the official @pump-fun/pump-sdk OR the
//    API-compatible fork @nirholas/pump-sdk. They differ in two ways we
//    handle defensively below:
//      1. State fetcher class: OnlinePumpSdk (fork) vs PumpSdk (official);
//         both expose fetchGlobal/fetchBuyState/fetchSellState/buyInstructions.
//      2. Curve-math helper args: object form { global, feeConfig, ... }
//         (fork) vs positional form (global, bondingCurve, amount) (official).
let _pkg = null;
let SdkClass = null;
let _getBuyTokens = null;
let _getSellSol = null;
try {
  _pkg = require('@pump-fun/pump-sdk');
} catch (e) {
  _pkg = require('@nirholas/pump-sdk');
}
SdkClass = _pkg.OnlinePumpSdk || _pkg.PumpSdk;
_getBuyTokens = _pkg.getBuyTokenAmountFromSolAmount;
_getSellSol = _pkg.getSellSolAmountFromTokenAmount;
if (!SdkClass || !_getBuyTokens || !_getSellSol) {
  throw new Error('pump-sdk: expected exports not found. Install @pump-fun/pump-sdk.');
}

// Call a curve-math helper supporting BOTH the object-arg form (fork) and
// the positional form (official). Tries object first; on TypeError or a
// non-BN result, retries positional.
function callMath(fn, { global, feeConfig, mintSupply, bondingCurve, amount }) {
  // Object form (fork / newer official).
  try {
    const r = fn({ global, feeConfig, mintSupply, bondingCurve, amount });
    if (r != null) return r;
  } catch (e) { /* fall through to positional */ }
  // Positional form (official examples): fn(global, bondingCurve, amount).
  return fn(global, bondingCurve, amount);
}

// Reuse the same RPC the rest of the server uses (Alchemy/Helius via env).
function getRpcUrl() {
  return process.env.HELIUS_RPC_URL
      || process.env.REACT_APP_SOLANA_RPC
      || 'https://api.mainnet-beta.solana.com';
}

// One cached SDK instance (and connection) for the process.
let _sdk = null;
function getSdk() {
  if (!_sdk) {
    const conn = new Connection(getRpcUrl(), 'confirmed');
    _sdk = new SdkClass(conn);
  }
  return _sdk;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Slippage in this SDK is a PERCENT number (2 = 2%), not bps and not a
// decimal — confirmed from the official examples (slippage: 2 // 2%).
const SLIPPAGE_PCT = 15; // 15% — volatile fresh launches

// Serialize a web3.js TransactionInstruction to plain JSON the browser
// can rebuild. Mirrors the shape LaunchRadar's deserIx() already expects
// from Jupiter: { programId, accounts:[{pubkey,isSigner,isWritable}], data(base64) }.
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
      const sdk  = getSdk();

      // Shared global + fee config (needed by the curve math + builders).
      // fetchFeeConfig may be absent on some SDK builds — tolerate null,
      // the math helpers accept a null feeConfig (pre-fee-tier behavior).
      const global = await sdk.fetchGlobal();
      let feeConfig = null;
      if (typeof sdk.fetchFeeConfig === 'function') {
        try { feeConfig = await sdk.fetchFeeConfig(); } catch (e) { feeConfig = null; }
      }

      if (action === 'buy') {
        // amount = SOL in lamports (string from client). This is the FULL
        // amount the trade spends (the 3% fee is added client-side as a
        // separate SOL transfer, so it does NOT come out of this).
        const lamports = b.amount;
        if (lamports == null) return res.status(400).json({ error: 'Missing amount' });
        const solAmount = new BN(String(lamports));
        if (solAmount.lten(0)) return res.status(400).json({ error: 'Amount must be > 0' });

        // fetchBuyState auto-detects SPL vs Token-2022 and returns tokenProgram.
        const buyState = await sdk.fetchBuyState(mint, user);
        if (buyState.bondingCurve && buyState.bondingCurve.complete) {
          return res.status(409).json({ error: 'Token has graduated to AMM — not tradable on the bonding curve.' });
        }

        // Expected tokens out for this SOL (curve math, arg-form adaptive).
        const tokenAmount = callMath(_getBuyTokens, {
          global,
          feeConfig,
          mintSupply: buyState.bondingCurve.tokenTotalSupply,
          bondingCurve: buyState.bondingCurve,
          amount: solAmount,
        });

        const instructions = await sdk.buyInstructions({
          ...buyState,        // spreads bondingCurveAccountInfo, bondingCurve,
                              // associatedUserAccountInfo, tokenProgram
          global,
          feeConfig,          // ignored by builders that don't use it
          mint,
          user,
          solAmount,
          amount: tokenAmount,
          slippage: SLIPPAGE_PCT,
        });

        return res.json({
          action: 'buy',
          tokenProgram: buyState.tokenProgram ? buyState.tokenProgram.toBase58() : null,
          expectedTokens: tokenAmount.toString(),
          instructions: instructions.map(serializeIx),
        });
      }

      // ── SELL ──
      // amount = raw token units (string). This is the FULL token amount
      // being sold; the 3% token fee is taken client-side as a separate
      // SPL transfer BEFORE these instructions, so the sell amount the
      // client passes here is already the post-fee 97% (client computes it).
      const rawTokens = b.amount;
      if (rawTokens == null) return res.status(400).json({ error: 'Missing amount' });
      const amount = new BN(String(rawTokens));
      if (amount.lten(0)) return res.status(400).json({ error: 'Amount must be > 0' });

      const sellState = await sdk.fetchSellState(mint, user);
      if (sellState.bondingCurve && sellState.bondingCurve.complete) {
        return res.status(409).json({ error: 'Token has graduated to AMM — not tradable on the bonding curve.' });
      }

      const solReceived = callMath(_getSellSol, {
        global,
        feeConfig,
        mintSupply: sellState.bondingCurve.tokenTotalSupply,
        bondingCurve: sellState.bondingCurve,
        amount,
      });

      const instructions = await sdk.sellInstructions({
        ...sellState,       // bondingCurveAccountInfo, bondingCurve, tokenProgram
        global,
        feeConfig,          // ignored by builders that don't use it
        mint,
        user,
        amount,
        solAmount: solReceived,
        slippage: SLIPPAGE_PCT,
      });

      return res.json({
        action: 'sell',
        tokenProgram: sellState.tokenProgram ? sellState.tokenProgram.toBase58() : null,
        expectedSol: solReceived.toString(),
        instructions: instructions.map(serializeIx),
      });
    } catch (e) {
      const msg = String(e?.message || e || 'Unknown error');
      // Common, mappable cases for clearer client messaging.
      if (/graduat|complete/i.test(msg))
        return res.status(409).json({ error: 'Token has graduated — trade on AMM instead.' });
      if (/not found|account does not exist/i.test(msg))
        return res.status(404).json({ error: 'Token not found on the bonding curve yet.' });
      console.warn('[pumpfun-trade]', msg);
      return res.status(500).json({ error: msg.slice(0, 200) });
    }
  });
}

module.exports = { mountRoutes };
