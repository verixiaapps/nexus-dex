'use strict';

// =============================================================================
// Nexus DEX prediction-market bridge module.
// Mount with:  require('./predict-bridge')(app);
//
// Endpoints installed under /api/bridge/* and /api/gamma/*:
//   POST /api/bridge/quote         build Mayan Solana→Polygon USDC tx
//   POST /api/bridge/submit        forward signed v0 tx to Solana RPC
//   POST /api/bridge/track         stash tracker for reconciliation
//   GET  /api/bridge/refunds       list unseen refunds for a wallet
//   POST /api/bridge/refunds/ack   mark a refund seen
//   GET  /api/gamma/*              Polymarket Gamma proxy (CORS fallback)
//
// Architecture:
//   1. Frontend asks /api/bridge/quote for {amount, fromWallet, dstWalletEvm}.
//      We call Mayan to build a v0 tx that bridges USDC Solana→Polygon and
//      return its serialized bytes.
//   2. Frontend decompiles the tx, prepends an SPL Transfer instruction for
//      Nexus' service fee (USDC → treasury ATA), simulates, then has the
//      user sign the bundled tx and POST it to /api/bridge/submit.
//   3. /api/bridge/submit forwards to Solana RPC. Atomic result: either both
//      the fee and the bridge call succeed, or neither does. We return the
//      tx signature as the trackerId.
//   4. Frontend hands off the trackerId to /api/bridge/track. From here a
//      background cron reconciles outcomes. On bridge failure or 24h+ stuck,
//      it sends a USDC refund from the treasury back to the user's Solana
//      wallet and writes a refund record. The RefundToast component picks
//      these up via /api/bridge/refunds?wallet=X on the user's next visit.
//
// State persistence: in-process Maps. Lost on restart. Acceptable for v1;
// for production durability, back trackers + refunds with Redis or Postgres.
//
// Required env vars:
//   NEXUS_PREDICT_TREASURY_KEY   base58 secret key for a Solana keypair.
//                                  Must hold USDC (for refunds) and SOL
//                                  (~0.000005 SOL per refund tx).
//   NEXUS_PREDICT_TREASURY_ATA   the treasury wallet's USDC associated
//                                  token account (the same address users
//                                  send their fee to in the atomic tx;
//                                  must match the frontend's
//                                  REACT_APP_TREASURY_USDC_ATA).
//   HELIUS_RPC_URL or HELIUS_API_KEY (re-uses existing server.js env vars)
//   MAYAN_API_KEY                optional, raises Mayan rate limits
//
// npm install:
//   @mayanfinance/swap-sdk @solana/web3.js @solana/spl-token bs58
// =============================================================================

const crypto = require('crypto');

// ---- Constants -------------------------------------------------------------
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POLYGON_USDC     = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS    = 6;

const MAYAN_EXPLORER = 'https://explorer-api.mayan.finance/v3';
const GAMMA_API      = 'https://gamma-api.polymarket.com';

const RECONCILE_INTERVAL_MS       = 5 * 60_000;       // cron tick
const MIN_AGE_BEFORE_RECONCILE_MS = 3 * 60_000;       // skip too-fresh trackers
const FORCE_REFUND_AGE_MS         = 24 * 60 * 60_000; // refund if stuck this long
const TRACKER_RETENTION_MS        = 7 * 24 * 60 * 60_000;
const REFUND_RETENTION_MS         = 30 * 24 * 60 * 60_000;

// ---- Lazy dep loaders (Mayan is ESM-only, others CJS) ----------------------
let _web3, _splToken, _mayan, _bs58;
async function loadDeps() {
  if (!_web3)     _web3     = require('@solana/web3.js');
  if (!_splToken) _splToken = require('@solana/spl-token');
  if (!_bs58)     _bs58     = require('bs58');
  if (!_mayan)    _mayan    = await import('@mayanfinance/swap-sdk');
  return { web3: _web3, splToken: _splToken, bs58: _bs58.default || _bs58, mayan: _mayan };
}

// ---- State (in-memory) -----------------------------------------------------
// trackerId -> {
//   wallet, feeAtomic (string), marketId, marketSlug,
//   createdAt, lastChecked, status: 'pending'|'completed'|'refunded'|'failed',
//   refundId?, refundTxSig?, completedAt?
// }
const trackers = new Map();
// walletLower -> [{ id, marketSlug, feeUsd, refundedAt, seen, refundTxSig }]
const refunds  = new Map();

// ---- Helpers ---------------------------------------------------------------
function isSolAddress(s) { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }
function isEvmAddress(s) { return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s); }
function isSolTxSig(s)   { return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s); }
function scrubKey(s)     { return typeof s === 'string' ? s.replace(/[A-Za-z0-9+/=]{64,}/g, '***') : s; }
function logErr(tag, e)  { console.warn(`[predict-bridge:${tag}] ${scrubKey(e?.message || String(e))}`); }

async function fetchWithTimeout(url, opts, ms = 10_000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try   { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

function getSolanaRpcUrl() {
  return process.env.HELIUS_RPC_URL
    || (process.env.HELIUS_API_KEY
        ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.HELIUS_API_KEY)
        : 'https://api.mainnet-beta.solana.com');
}

let _treasuryKp = null;
async function getTreasuryKeypair() {
  if (_treasuryKp) return _treasuryKp;
  const { web3, bs58 } = await loadDeps();
  const key = process.env.NEXUS_PREDICT_TREASURY_KEY;
  if (!key) throw new Error('NEXUS_PREDICT_TREASURY_KEY not set');
  _treasuryKp = web3.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(key)));
  return _treasuryKp;
}

let _treasuryAtaPk = null;
async function getTreasuryAtaPk() {
  if (_treasuryAtaPk) return _treasuryAtaPk;
  const { web3 } = await loadDeps();
  const ata = process.env.NEXUS_PREDICT_TREASURY_ATA;
  if (!ata) throw new Error('NEXUS_PREDICT_TREASURY_ATA not set');
  _treasuryAtaPk = new web3.PublicKey(ata);
  return _treasuryAtaPk;
}

// ---- Mayan: build a Solana→Polygon USDC bridge tx --------------------------
async function buildBridgeTx({ amountAtomicUsdc, fromWallet, dstWalletEvm }) {
  if (!isSolAddress(fromWallet))   throw new Error('Invalid fromWallet');
  if (!isEvmAddress(dstWalletEvm)) throw new Error('Invalid dstWalletEvm');
  const atomic = BigInt(amountAtomicUsdc);
  if (atomic <= 0n) throw new Error('Invalid amount');

  const { web3, mayan } = await loadDeps();
  const amount = Number(atomic) / 10 ** USDC_DECIMALS;

  const quotes = await mayan.fetchQuote({
    amount,
    fromToken: SOLANA_USDC_MINT,
    toToken:   POLYGON_USDC,
    fromChain: 'solana',
    toChain:   'polygon',
    slippageBps: 'auto',
    apiKey:    process.env.MAYAN_API_KEY || undefined,
  });
  if (!Array.isArray(quotes) || !quotes[0]) throw new Error('No Mayan quote');
  const quote = quotes[0];

  const connection = new web3.Connection(getSolanaRpcUrl(), 'confirmed');
  // Mayan returns either an array of instructions or { instructions, lookupTables, signers? }.
  // We handle both shapes. If Mayan ever requires extra signers we surface
  // an error rather than silently shipping an unsignable tx.
  const built = await mayan.createSwapFromSolanaInstructions(
    quote, fromWallet, dstWalletEvm, null, connection,
  );
  const instructions = Array.isArray(built) ? built : (built?.instructions || []);
  const lookupTables = Array.isArray(built) ? [] : (built?.lookupTables || built?.addressLookupTableAccounts || []);
  const extraSigners = (!Array.isArray(built) && Array.isArray(built?.signers)) ? built.signers : [];
  if (!instructions.length) throw new Error('Mayan returned no instructions');
  if (extraSigners.length) throw new Error('Mayan returned extra required signers; cannot atomically sign with user');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const msg = new web3.TransactionMessage({
    payerKey: new web3.PublicKey(fromWallet),
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new web3.VersionedTransaction(msg);
  return {
    serializedTx: Buffer.from(tx.serialize()).toString('base64'),
    etaSeconds:   Number(quote.etaSeconds || 180),
    blockhash, lastValidBlockHeight,
  };
}

// ---- Submit signed v0 tx to Solana -----------------------------------------
async function submitSignedTx(serializedTxBase64) {
  const { web3 } = await loadDeps();
  const connection = new web3.Connection(getSolanaRpcUrl(), 'confirmed');
  const buf = Buffer.from(serializedTxBase64, 'base64');
  // We DO NOT re-sign or re-serialize. Just forward.
  const sig = await connection.sendRawTransaction(buf, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });
  return sig;
}

// ---- Mayan status fetch ----------------------------------------------------
// Mayan's clientStatus is one of: INPROGRESS, COMPLETED, REFUNDED, or absent
// (not yet indexed by the explorer). We map to {pending, completed, refunded}.
async function fetchMayanStatus(txid) {
  const url = `${MAYAN_EXPLORER}/swap/trx/${encodeURIComponent(txid)}`;
  const r = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 8_000);
  if (!r.ok) return { state: 'pending', raw: null };
  const data = await r.json().catch(() => null);
  if (!data) return { state: 'pending', raw: null };
  const cs = String(data.clientStatus || data.status || '').toUpperCase();
  if (cs === 'COMPLETED') return { state: 'completed', raw: data };
  if (cs === 'REFUNDED')  return { state: 'refunded',  raw: data };
  return { state: 'pending', raw: data };
}

// ---- Send a USDC refund from treasury → user's wallet ----------------------
async function sendRefund(tracker) {
  const { web3, splToken } = await loadDeps();
  const connection = new web3.Connection(getSolanaRpcUrl(), 'confirmed');
  const treasury   = await getTreasuryKeypair();
  const treasuryAta = await getTreasuryAtaPk();
  const userPk      = new web3.PublicKey(tracker.wallet);
  const feeAtomic   = BigInt(tracker.feeAtomic || '0');
  if (feeAtomic <= 0n) throw new Error('Tracker has no fee to refund');

  // Derive (or create-if-missing) the user's USDC ATA on Solana.
  const userAta = await splToken.getAssociatedTokenAddress(
    new web3.PublicKey(SOLANA_USDC_MINT),
    userPk,
    true, // allowOwnerOffCurve — safe; users may have a PDA-like wallet
  );

  // If the user's ATA doesn't exist, our treasury creates it. ~0.002 SOL rent
  // is one-time cost we eat; cheaper than reputational damage from a stuck refund.
  const ix = [];
  const ataInfo = await connection.getAccountInfo(userAta);
  if (!ataInfo) {
    ix.push(splToken.createAssociatedTokenAccountInstruction(
      treasury.publicKey, userAta, userPk, new web3.PublicKey(SOLANA_USDC_MINT),
    ));
  }
  ix.push(splToken.createTransferInstruction(
    treasuryAta, userAta, treasury.publicKey, feeAtomic,
  ));

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new web3.TransactionMessage({
    payerKey: treasury.publicKey,
    recentBlockhash: blockhash,
    instructions: ix,
  }).compileToV0Message();
  const tx = new web3.VersionedTransaction(msg);
  tx.sign([treasury]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

function recordRefund(tracker, refundTxSig) {
  const walletLower = String(tracker.wallet || '').toLowerCase();
  const id = crypto.randomBytes(8).toString('hex');
  const entry = {
    id,
    marketSlug: tracker.marketSlug || '',
    feeUsd: Number(BigInt(tracker.feeAtomic || '0')) / 10 ** USDC_DECIMALS,
    refundedAt: Date.now(),
    refundTxSig,
    seen: false,
  };
  const list = refunds.get(walletLower) || [];
  list.push(entry);
  refunds.set(walletLower, list);
  return id;
}

// ---- Reconciliation cron ---------------------------------------------------
let _reconciling = false;
async function reconcilePending() {
  if (_reconciling) return;
  _reconciling = true;
  try {
    const now = Date.now();
    for (const [trackerId, t] of trackers.entries()) {
      try {
        if (t.status !== 'pending') {
          // GC very old terminal trackers.
          if (now - (t.completedAt || t.createdAt) > TRACKER_RETENTION_MS) {
            trackers.delete(trackerId);
          }
          continue;
        }
        if (now - t.createdAt < MIN_AGE_BEFORE_RECONCILE_MS) continue;
        if (now - (t.lastChecked || 0) < RECONCILE_INTERVAL_MS - 30_000) continue;

        t.lastChecked = now;
        const status = await fetchMayanStatus(trackerId);

        if (status.state === 'completed') {
          t.status = 'completed';
          t.completedAt = now;
          continue;
        }

        const shouldRefund = status.state === 'refunded'
                          || (now - t.createdAt > FORCE_REFUND_AGE_MS);
        if (!shouldRefund) continue;

        try {
          const sig = await sendRefund(t);
          t.status      = 'refunded';
          t.refundTxSig = sig;
          t.completedAt = now;
          t.refundId    = recordRefund(t, sig);
          console.log(`[predict-bridge:refund] sent ${t.feeAtomic} USDC to ${t.wallet} (tx ${sig})`);
        } catch (e) {
          logErr('refund-send', e);
          // Leave status as 'pending' so we retry on the next tick.
        }
      } catch (e) {
        logErr('reconcile-one', e);
      }
    }

    // GC old refund toasts.
    for (const [wallet, list] of refunds.entries()) {
      const kept = list.filter(r => now - r.refundedAt < REFUND_RETENTION_MS);
      if (kept.length !== list.length) {
        if (kept.length === 0) refunds.delete(wallet);
        else                   refunds.set(wallet, kept);
      }
    }
  } finally {
    _reconciling = false;
  }
}

// =============================================================================
// Installer
// =============================================================================
module.exports = function installPredictBridge(app) {
  // -- /api/bridge/quote -----------------------------------------------------
  app.post('/api/bridge/quote', async (req, res) => {
    try {
      const { amountAtomicUsdc, fromWallet, dstWalletEvm } = req.body || {};
      const { serializedTx, etaSeconds, blockhash, lastValidBlockHeight } =
        await buildBridgeTx({ amountAtomicUsdc, fromWallet, dstWalletEvm });
      res.json({ serializedTx, etaSeconds, blockhash, lastValidBlockHeight });
    } catch (e) {
      logErr('quote', e);
      res.status(400).json({ error: e.message || 'quote failed' });
    }
  });

  // -- /api/bridge/submit ----------------------------------------------------
  app.post('/api/bridge/submit', async (req, res) => {
    try {
      const { serializedTx } = req.body || {};
      if (typeof serializedTx !== 'string' || serializedTx.length < 64) {
        return res.status(400).json({ error: 'invalid serializedTx' });
      }
      const sig = await submitSignedTx(serializedTx);
      // trackerId === Solana tx signature; Mayan indexes swaps by source tx sig.
      res.json({ txid: sig, trackerId: sig });
    } catch (e) {
      logErr('submit', e);
      const msg = String(e?.message || '');
      // Idempotency: if already on-chain, treat as success.
      const sig = msg.match(/[1-9A-HJ-NP-Za-km-z]{60,100}/)?.[0];
      if (msg.includes('already been processed') && sig) {
        return res.json({ txid: sig, trackerId: sig, alreadyProcessed: true });
      }
      res.status(500).json({ error: msg || 'submit failed' });
    }
  });

  // -- /api/bridge/track -----------------------------------------------------
  app.post('/api/bridge/track', (req, res) => {
    try {
      const { trackerId, userWallet, feeAtomicUsdc, marketId, marketSlug } = req.body || {};
      if (!isSolTxSig(trackerId))    return res.status(400).json({ error: 'invalid trackerId' });
      if (!isSolAddress(userWallet)) return res.status(400).json({ error: 'invalid userWallet' });
      const feeAtomic = String(feeAtomicUsdc || '0').replace(/[^0-9]/g, '');
      if (!feeAtomic) return res.status(400).json({ error: 'invalid feeAtomicUsdc' });

      if (!trackers.has(trackerId)) {
        trackers.set(trackerId, {
          wallet:       userWallet,
          feeAtomic,
          marketId:     String(marketId || '').slice(0, 128),
          marketSlug:   String(marketSlug || '').slice(0, 256),
          createdAt:    Date.now(),
          lastChecked:  0,
          status:       'pending',
        });
      }
      res.json({ ok: true });
    } catch (e) {
      logErr('track', e);
      res.status(500).json({ error: 'track failed' });
    }
  });

  // -- /api/bridge/refunds ---------------------------------------------------
  app.get('/api/bridge/refunds', (req, res) => {
    try {
      const wallet = String(req.query.wallet || '');
      if (!isSolAddress(wallet)) return res.status(400).json({ error: 'invalid wallet' });
      const list = refunds.get(wallet.toLowerCase()) || [];
      const unseen = list.filter(r => !r.seen).map(r => ({
        id:          r.id,
        marketSlug:  r.marketSlug,
        feeUsd:      r.feeUsd,
        refundedAt:  r.refundedAt,
        refundTxSig: r.refundTxSig,
      }));
      res.json({ refunds: unseen });
    } catch (e) {
      logErr('refunds', e);
      res.status(500).json({ error: 'refunds failed' });
    }
  });

  // -- /api/bridge/refunds/ack -----------------------------------------------
  app.post('/api/bridge/refunds/ack', (req, res) => {
    try {
      const { wallet, refundId } = req.body || {};
      if (!isSolAddress(wallet)) return res.status(400).json({ error: 'invalid wallet' });
      if (!refundId)             return res.status(400).json({ error: 'invalid refundId' });
      const list = refunds.get(String(wallet).toLowerCase()) || [];
      const r = list.find(x => x.id === refundId);
      if (r) r.seen = true;
      res.json({ ok: true });
    } catch (e) {
      logErr('refunds-ack', e);
      res.status(500).json({ error: 'ack failed' });
    }
  });

  // -- /api/gamma/* — Polymarket Gamma proxy (CORS fallback) ----------------
  // The frontend defaults to hitting Gamma directly. Use this proxy only if
  // browsers complain about CORS by setting REACT_APP_POLYMARKET_GAMMA_BASE
  // to '/api/gamma'.
  app.get('/api/gamma/*', async (req, res) => {
    try {
      const sub = req.path.replace('/api/gamma', '');
      const qs  = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const url = GAMMA_API + sub + qs;
      const r = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 10_000);
      const txt = await r.text();
      res.status(r.status);
      try   { res.json(JSON.parse(txt)); }
      catch { res.type('application/json').send(txt); }
    } catch (e) {
      logErr('gamma', e);
      res.status(502).json({ error: 'gamma proxy failed' });
    }
  });

  // -- Kick off the reconciliation loop -------------------------------------
  // Only start if treasury env vars are configured; otherwise refunds would
  // fail anyway and we shouldn't spin the loop.
  if (process.env.NEXUS_PREDICT_TREASURY_KEY && process.env.NEXUS_PREDICT_TREASURY_ATA) {
    setInterval(() => { reconcilePending().catch(e => logErr('cron', e)); }, RECONCILE_INTERVAL_MS).unref();
    console.log('[predict-bridge] reconciliation loop active');
  } else {
    console.warn('[predict-bridge] NEXUS_PREDICT_TREASURY_KEY / NEXUS_PREDICT_TREASURY_ATA not set — refund cron DISABLED');
  }

  console.log('[predict-bridge] mounted /api/bridge/* and /api/gamma/*');
};
