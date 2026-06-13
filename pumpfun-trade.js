// pumpfun-trade.js — Pump.fun bonding-curve trade builder for Launch Radar.
//
// IMPORTANT: this revision BUILDS THE INSTRUCTIONS MANUALLY and does NOT use
// @pump-fun/pump-sdk. Pump.fun shipped a breaking "cashback upgrade" in
// February 2026 that added a required `bonding_curve_v2` account at the end
// of every buy/sell instruction. Versions of the SDK from before that change
// produced instructions with shifted indices, which the on-chain program
// rejected with errors like Custom:6024 Overflow OR IncorrectProgramId
// (depending on which wrong account ended up where).
//
// By assembling the accounts ourselves we no longer depend on the SDK release
// cadence. When pump.fun changes the program again, you just edit the account
// list here.
//
// Layouts are verbatim from the public post-mortem of the upgrade:
//   https://allenhark.com/blog/pumpfun-bonding-curve-custom-6024-overflow-fix-cashback-upgrade-guide
//   https://github.com/pump-fun/pump-public-docs/issues/30
//
// The client-side LaunchRadar.jsx does NOT need to change — the request and
// response shapes are kept identical to the previous version.

const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require('@solana/spl-token');

/* ════════════════════════════════════════════════════════════════════
   PROGRAM CONSTANTS
   ════════════════════════════════════════════════════════════════════ */
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM  = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

// fee_config seed key — the SAME key is used for both BUY and SELL on the
// bonding curve program (PumpSwap AMM uses a different key, do not mix).
const FEE_CONFIG_KEY = Buffer.from([
  1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
  81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
]);

// Anchor discriminators: sha256("global:<instruction>")[0..8]
const DISC_BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
const DISC_SELL             = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Slippage tolerance (percent). Fresh launches move fast; 30% lets us land.
const SLIPPAGE_PERCENT = 30;

/* ════════════════════════════════════════════════════════════════════
   PDA HELPERS
   ════════════════════════════════════════════════════════════════════ */
const findPda = (seeds, programId) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

const pdaGlobal                  = ()        => findPda([Buffer.from('global')],                                   PUMP_PROGRAM);
const pdaBondingCurve            = (mint)    => findPda([Buffer.from('bonding-curve'),      mint.toBuffer()],      PUMP_PROGRAM);
const pdaBondingCurveV2          = (mint)    => findPda([Buffer.from('bonding-curve-v2'),   mint.toBuffer()],      PUMP_PROGRAM);
const pdaCreatorVault            = (creator) => findPda([Buffer.from('creator-vault'),      creator.toBuffer()],   PUMP_PROGRAM);
const pdaEventAuthority          = ()        => findPda([Buffer.from('__event_authority')],                        PUMP_PROGRAM);
const pdaGlobalVolumeAccumulator = ()        => findPda([Buffer.from('global_volume_accumulator')],                PUMP_PROGRAM);
const pdaUserVolumeAccumulator   = (user)    => findPda([Buffer.from('user_volume_accumulator'), user.toBuffer()], PUMP_PROGRAM);
const pdaFeeConfig               = ()        => findPda([Buffer.from('fee_config'), FEE_CONFIG_KEY],               FEE_PROGRAM);

/* ════════════════════════════════════════════════════════════════════
   ACCOUNT PARSERS
   ════════════════════════════════════════════════════════════════════ */

// Bonding curve account layout (post-cashback upgrade, ≥83 bytes):
//   0..8   discriminator
//   8..16  virtual_token_reserves (u64 LE)
//   16..24 virtual_sol_reserves   (u64 LE)
//   24..32 real_token_reserves    (u64 LE)
//   32..40 real_sol_reserves      (u64 LE)
//   40..48 token_total_supply     (u64 LE)
//   48     complete               (bool)
//   49..81 creator                (Pubkey)
//   81     reserved
//   82     cashback_enabled       (bool)  ← read this, NOT the token program
function parseBondingCurve(data) {
  if (!data || data.length < 83) {
    const e = new Error('Bonding curve data too short — not a pump.fun bonding-curve token.');
    e.code = 'NOT_PUMP';
    throw e;
  }
  return {
    virtualTokenReserves: data.readBigUInt64LE(8),
    virtualSolReserves:   data.readBigUInt64LE(16),
    realTokenReserves:    data.readBigUInt64LE(24),
    realSolReserves:      data.readBigUInt64LE(32),
    tokenTotalSupply:     data.readBigUInt64LE(40),
    complete:             data[48] !== 0,
    creator:              new PublicKey(data.slice(49, 81)),
    cashbackEnabled:      data[82] !== 0,
  };
}

// Global account layout (only the field we need):
//   0..8   discriminator
//   8      initialized (bool)
//   9..41  authority   (Pubkey)
//   41..73 fee_recipient (Pubkey)  ← buy/sell instruction account #1
function parseGlobalFeeRecipient(data) {
  if (!data || data.length < 73) throw new Error('Global account data too short.');
  return new PublicKey(data.slice(41, 73));
}

/* ════════════════════════════════════════════════════════════════════
   CONSTANT-PRODUCT MATH (UI estimate only — chain re-checks at execute)
   ════════════════════════════════════════════════════════════════════ */
function calcBuyTokensOut(curve, solIn) {
  if (solIn <= 0n) return 0n;
  const k       = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newVsr  = curve.virtualSolReserves + solIn;
  const newVtr  = k / newVsr;
  const out     = curve.virtualTokenReserves - newVtr;
  // Can't drain more than the real reserves
  return out > curve.realTokenReserves ? curve.realTokenReserves : out;
}

function calcSellSolOut(curve, tokensIn) {
  if (tokensIn <= 0n) return 0n;
  const k      = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newVtr = curve.virtualTokenReserves + tokensIn;
  const newVsr = k / newVtr;
  return curve.virtualSolReserves - newVsr;
}

// Lower-bound the expected amount by the slippage percentage.
function applySlippageDown(amount, slippagePercent) {
  const denom = 10000n;
  const slipBps = BigInt(Math.floor(slippagePercent * 100));
  return (amount * (denom - slipBps)) / denom;
}

/* ════════════════════════════════════════════════════════════════════
   RPC
   ════════════════════════════════════════════════════════════════════ */
function getRpcUrl() {
  const e = process.env;
  return e.REACT_APP_ALCHEMY_RPC
      || e.ALCHEMY_RPC_URL
      || (e.ALCHEMY_API_KEY ? 'https://solana-mainnet.g.alchemy.com/v2/' + e.ALCHEMY_API_KEY : '')
      || 'https://api.mainnet-beta.solana.com';
}

let _conn = null;
function getConnection() {
  if (!_conn) {
    const url = getRpcUrl();
    let host = 'invalid-url';
    try { host = new URL(url).host; } catch {}
    console.log('[pumpfun-trade] RPC host:', host);
    if (/api\.mainnet-beta\.solana\.com/.test(url)) {
      console.warn('[pumpfun-trade] *** USING PUBLIC mainnet-beta RPC (rate-limited). '
        + 'Set REACT_APP_ALCHEMY_RPC / ALCHEMY_RPC_URL in the SERVER env. ***');
    }
    _conn = new Connection(url, 'confirmed');
  }
  return _conn;
}

/* ════════════════════════════════════════════════════════════════════
   INSTRUCTION BUILDERS
   ════════════════════════════════════════════════════════════════════ */
function encodeBuyData(solAmount, minTokensOut) {
  const data = Buffer.alloc(24);
  DISC_BUY_EXACT_SOL_IN.copy(data, 0);
  data.writeBigUInt64LE(BigInt(solAmount.toString()),    8);
  data.writeBigUInt64LE(BigInt(minTokensOut.toString()), 16);
  return data;
}

function encodeSellData(tokenAmount, minSolOut) {
  const data = Buffer.alloc(24);
  DISC_SELL.copy(data, 0);
  data.writeBigUInt64LE(BigInt(tokenAmount.toString()), 8);
  data.writeBigUInt64LE(BigInt(minSolOut.toString()),   16);
  return data;
}

// BUY — 17 accounts, same layout for cashback and non-cashback tokens.
function buildBuyIx({ mint, user, solAmount, minTokensOut, feeRecipient, creator, tokenProgram }) {
  const bondingCurve           = pdaBondingCurve(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);
  const associatedUser         = getAssociatedTokenAddressSync(mint, user,         true, tokenProgram);

  const keys = [
    { pubkey: pdaGlobal(),                    isSigner: false, isWritable: false }, // 0
    { pubkey: feeRecipient,                   isSigner: false, isWritable: true  }, // 1
    { pubkey: mint,                           isSigner: false, isWritable: false }, // 2
    { pubkey: bondingCurve,                   isSigner: false, isWritable: true  }, // 3
    { pubkey: associatedBondingCurve,         isSigner: false, isWritable: true  }, // 4
    { pubkey: associatedUser,                 isSigner: false, isWritable: true  }, // 5
    { pubkey: user,                           isSigner: true,  isWritable: true  }, // 6
    { pubkey: SystemProgram.programId,        isSigner: false, isWritable: false }, // 7
    { pubkey: tokenProgram,                   isSigner: false, isWritable: false }, // 8
    { pubkey: pdaCreatorVault(creator),       isSigner: false, isWritable: true  }, // 9
    { pubkey: pdaEventAuthority(),            isSigner: false, isWritable: false }, // 10
    { pubkey: PUMP_PROGRAM,                   isSigner: false, isWritable: false }, // 11
    { pubkey: pdaGlobalVolumeAccumulator(),   isSigner: false, isWritable: false }, // 12  (Aug-2025 upgrade)
    { pubkey: pdaUserVolumeAccumulator(user), isSigner: false, isWritable: true  }, // 13  (Aug-2025 upgrade)
    { pubkey: pdaFeeConfig(),                 isSigner: false, isWritable: false }, // 14
    { pubkey: FEE_PROGRAM,                    isSigner: false, isWritable: false }, // 15
    { pubkey: pdaBondingCurveV2(mint),        isSigner: false, isWritable: false }, // 16  (Feb-2026 cashback upgrade)
  ];

  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys,
    data: encodeBuyData(solAmount, minTokensOut),
  });
}

// SELL — 15 accounts for non-cashback, 16 for cashback.
//   bonding_curve_v2 is ALWAYS the last account.
//   user_volume_accumulator goes BEFORE bonding_curve_v2, ONLY when cashback.
function buildSellIx({ mint, user, tokenAmount, minSolOut, feeRecipient, creator, tokenProgram, cashbackEnabled }) {
  const bondingCurve           = pdaBondingCurve(mint);
  const associatedBondingCurve = getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram);
  const associatedUser         = getAssociatedTokenAddressSync(mint, user,         true, tokenProgram);

  const keys = [
    { pubkey: pdaGlobal(),               isSigner: false, isWritable: false }, // 0
    { pubkey: feeRecipient,              isSigner: false, isWritable: true  }, // 1
    { pubkey: mint,                      isSigner: false, isWritable: false }, // 2
    { pubkey: bondingCurve,              isSigner: false, isWritable: true  }, // 3
    { pubkey: associatedBondingCurve,    isSigner: false, isWritable: true  }, // 4
    { pubkey: associatedUser,            isSigner: false, isWritable: true  }, // 5
    { pubkey: user,                      isSigner: true,  isWritable: true  }, // 6
    { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false }, // 7
    { pubkey: pdaCreatorVault(creator),  isSigner: false, isWritable: true  }, // 8
    { pubkey: tokenProgram,              isSigner: false, isWritable: false }, // 9
    { pubkey: pdaEventAuthority(),       isSigner: false, isWritable: false }, // 10
    { pubkey: PUMP_PROGRAM,              isSigner: false, isWritable: false }, // 11
    { pubkey: pdaFeeConfig(),            isSigner: false, isWritable: false }, // 12
    { pubkey: FEE_PROGRAM,               isSigner: false, isWritable: false }, // 13
  ];

  if (cashbackEnabled) {
    keys.push({ pubkey: pdaUserVolumeAccumulator(user), isSigner: false, isWritable: true });  // 14 (cashback only)
  }
  keys.push({ pubkey: pdaBondingCurveV2(mint),          isSigner: false, isWritable: false }); // 14 or 15 — ALWAYS last

  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys,
    data: encodeSellData(tokenAmount, minSolOut),
  });
}

/* ════════════════════════════════════════════════════════════════════
   WIRE FORMAT
   ════════════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════════════
   ROUTE — same request/response shape as the previous revision
   ════════════════════════════════════════════════════════════════════ */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function mountRoutes(app) {
  app.post('/api/pumpfun/trade', async (req, res) => {
    try {
      const b       = req.body || {};
      const action  = b.action;
      const mintStr = b.mint;
      const userStr = b.user;

      // ── Validate ──
      if (action !== 'buy' && action !== 'sell')
        return res.status(400).json({ error: 'action must be buy or sell' });
      if (!mintStr || !BASE58_RE.test(String(mintStr)))
        return res.status(400).json({ error: 'Invalid mint' });
      if (!userStr || !BASE58_RE.test(String(userStr)))
        return res.status(400).json({ error: 'Invalid user' });
      if (b.amount == null)
        return res.status(400).json({ error: 'Missing amount' });

      let amount;
      try { amount = BigInt(String(b.amount)); }
      catch { return res.status(400).json({ error: 'Invalid amount' }); }
      if (amount <= 0n)
        return res.status(400).json({ error: 'Amount must be > 0' });

      const mint = new PublicKey(mintStr);
      const user = new PublicKey(userStr);
      const conn = getConnection();

      // Fetch all on-chain state in parallel.
      const [bcAcc, globalAcc, mintAcc] = await Promise.all([
        conn.getAccountInfo(pdaBondingCurve(mint), 'confirmed'),
        conn.getAccountInfo(pdaGlobal(),           'confirmed'),
        conn.getAccountInfo(mint,                  'confirmed'),
      ]);

      if (!bcAcc)
        return res.status(404).json({ error: 'Not a pump.fun bonding-curve token (or not indexed yet).' });
      if (!mintAcc)
        return res.status(404).json({ error: 'Token mint not found on-chain.' });
      if (!globalAcc)
        return res.status(503).json({ error: 'pump.fun Global account unreachable (server RPC issue).' });

      const curve         = parseBondingCurve(bcAcc.data);
      const feeRecipient  = parseGlobalFeeRecipient(globalAcc.data);
      const tokenProgram  = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
                              ? TOKEN_2022_PROGRAM_ID
                              : TOKEN_PROGRAM_ID;

      if (curve.complete) {
        return res.status(409).json({ error: 'Token graduated — not on the bonding curve. Not traded here.' });
      }

      const instructions = [];
      const rpcHost = (() => { try { return new URL(getRpcUrl()).host; } catch { return null; } })();

      // ────────────────────────── BUY ──────────────────────────
      if (action === 'buy') {
        // The user's ATA may not exist yet for fresh tokens — create it
        // idempotently as the first instruction. No-op if already present.
        const userAta = getAssociatedTokenAddressSync(mint, user, true, tokenProgram);
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(
          user,         // payer
          userAta,      // ata
          user,         // owner
          mint,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ));

        // Bonding curve math (UI estimate; minTokensOut applies slippage).
        const expectedTokens = calcBuyTokensOut(curve, amount);
        const minTokensOut   = applySlippageDown(expectedTokens, SLIPPAGE_PERCENT);

        instructions.push(buildBuyIx({
          mint, user,
          solAmount: amount,
          minTokensOut,
          feeRecipient,
          creator: curve.creator,
          tokenProgram,
        }));

        return res.json({
          action: 'buy',
          route: 'bonding-curve',
          builder: 'manual-v2-cashback',
          tokenProgram: tokenProgram.toBase58(),
          feeConfigOk: true,
          cashbackEnabled: curve.cashbackEnabled,
          rpcHost,
          expectedTokens: expectedTokens.toString(),
          instructions: instructions.map(serializeIx),
        });
      }

      // ────────────────────────── SELL ─────────────────────────
      const expectedSol = calcSellSolOut(curve, amount);
      const minSolOut   = applySlippageDown(expectedSol, SLIPPAGE_PERCENT);

      instructions.push(buildSellIx({
        mint, user,
        tokenAmount: amount,
        minSolOut,
        feeRecipient,
        creator: curve.creator,
        tokenProgram,
        cashbackEnabled: curve.cashbackEnabled,
      }));

      return res.json({
        action: 'sell',
        route: 'bonding-curve',
        builder: 'manual-v2-cashback',
        tokenProgram: tokenProgram.toBase58(),
        feeConfigOk: true,
        cashbackEnabled: curve.cashbackEnabled,
        rpcHost,
        expectedSol: expectedSol.toString(),
        instructions: instructions.map(serializeIx),
      });
    } catch (e) {
      const msg = String(e?.message || e || 'Unknown error');
      console.warn('[pumpfun-trade]', msg);
      if (e?.code === 'NOT_PUMP' || /not found|account does not exist|could not find/i.test(msg))
        return res.status(404).json({ error: 'Not a pump.fun bonding-curve token (or not indexed yet).' });
      if (/graduat|complete/i.test(msg))
        return res.status(409).json({ error: 'Token graduated — not on the bonding curve. Not traded here.' });
      return res.status(500).json({ error: msg.slice(0, 200) });
    }
  });
}

module.exports = { mountRoutes };
