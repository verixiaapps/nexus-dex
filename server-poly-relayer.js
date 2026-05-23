// server-poly-relayer.js
//
// Express router for Polymarket V2.
//
// Architecture: server is a normalizing proxy. It owns ALL Polymarket
// protocol details (contracts, ABI, signatures, builder HMAC). The
// frontend speaks one stable shape and never imports a Polymarket SDK.
//
// Non-custodial: the server holds builder API creds and orchestrates
// requests, but every state-changing call that needs a user signature
// returns a { needsSignature: { typedData, requestId } } envelope. The
// frontend signs with the user's derived EVM key and POSTs the signature
// back to /<route>/submit. The server then submits to Polymarket.
//
// Required env vars:
//   POLY_BUILDER_API_KEY
//   POLY_BUILDER_SECRET           (base64, >= 16 raw bytes)
//   POLY_BUILDER_PASSPHRASE
//   POLY_BUILDER_CODE             (bytes32 hex, for order attribution)
//   POLYGON_RPC_URL               (optional, defaults to public)
//
// Endpoints:
//   GET  /health                     diagnostics
//   GET  /test-creds                 verify builder HMAC works
//   GET  /builder-code               returns POLY_BUILDER_CODE
//   POST /sign                       remote HMAC (kept for SDK callers)
//   POST /deposit                    bridge deposit addresses (SVM/EVM)
//   GET  /status/:address            bridge status
//   POST /withdraw                   bridge withdraw
//   POST /quote                      bridge quote
//   GET  /supported-assets           bridge supported assets
//   POST /setup                      derive + deploy + approve (one shot)
//   POST /setup/submit               (if /setup returned needsSignature)
//   GET  /balance/:evm               pUSD balance + deposit wallet addr
//   GET  /positions/:evm             user positions (optional ?conditionId=)
//   POST /buy                        prepare buy order
//   POST /buy/submit                 submit signed buy
//   POST /sell                       prepare sell order
//   POST /sell/submit                submit signed sell
//   POST /redeem                     prepare redeem (gasless via relayer)
//   POST /redeem/submit              (no-op for gasless; kept for symmetry)

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

// ─── Builder signing SDK (optional, manual HMAC is the fallback) ────────────
let sdkHmac = null;
try {
  const sdk = require('@polymarket/builder-signing-sdk');
  if (typeof sdk.buildHmacSignature === 'function') sdkHmac = sdk.buildHmacSignature;
} catch (e) {
  console.warn('[poly] builder-signing-sdk not loadable, using manual HMAC:', e.message);
}

// ─── Env ────────────────────────────────────────────────────────────────────
const BUILDER_KEY        = process.env.POLY_BUILDER_API_KEY    || '';
const BUILDER_SECRET     = process.env.POLY_BUILDER_SECRET     || '';
const BUILDER_PASSPHRASE = process.env.POLY_BUILDER_PASSPHRASE || '';
const BUILDER_CODE       = process.env.POLY_BUILDER_CODE       || '';
const POLYGON_RPC_URL    = process.env.POLYGON_RPC_URL         || 'https://polygon-rpc.com';

const BRIDGE_URL  = 'https://bridge.polymarket.com';
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const CLOB_URL    = 'https://clob.polymarket.com';
const DATA_URL    = 'https://data-api.polymarket.com';
const POLYGON_CHAIN_ID = 137;

// Polymarket V2 contracts (Polygon mainnet)
const PUSD_ADDRESS          = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const CTF_EXCHANGE_V2       = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_CTF_EXCHANGE = '0xe2222d279d744050d28e00520010520000310F59';
const NEG_RISK_ADAPTER      = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CONDITIONAL_TOKENS    = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

function credsOk() {
  return Boolean(BUILDER_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE);
}

// ─── Validate and decode the builder secret at startup ──────────────────────
let _decodedSecret = null;
let _secretError   = null;
if (BUILDER_SECRET) {
  try {
    const buf = Buffer.from(BUILDER_SECRET, 'base64');
    if (buf.length < 16) throw new Error(`decoded length ${buf.length} < 16 bytes`);
    if (Buffer.from(buf.toString('base64'), 'base64').compare(buf) !== 0) {
      throw new Error('does not round-trip as base64');
    }
    _decodedSecret = buf;
  } catch (e) {
    _secretError = e.message;
    console.error('[poly] POLY_BUILDER_SECRET invalid:', e.message);
  }
}

// ─── HMAC ───────────────────────────────────────────────────────────────────
function manualHmac(tsMs, method, path, body) {
  if (!_decodedSecret) throw new Error('POLY_BUILDER_SECRET not decoded: ' + (_secretError || 'unset'));
  const bodyStr = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const msg = `${tsMs}${String(method).toUpperCase()}${path}${bodyStr}`;
  return crypto.createHmac('sha256', _decodedSecret).update(msg).digest('base64');
}

async function builderHeaders(method, path, body) {
  const tsMs = String(Date.now());
  let sig;
  if (sdkHmac) {
    try { sig = await sdkHmac(BUILDER_SECRET, parseInt(tsMs, 10), method.toUpperCase(), path, body); }
    catch (e) { console.warn('[poly] SDK HMAC failed, manual fallback:', e.message); sig = manualHmac(tsMs, method, path, body); }
  } else {
    sig = manualHmac(tsMs, method, path, body);
  }
  return {
    POLY_BUILDER_SIGNATURE:  sig,
    POLY_BUILDER_TIMESTAMP:  tsMs,
    POLY_BUILDER_API_KEY:    BUILDER_KEY,
    POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
  };
}

// ─── Per-IP rate limit on /sign ─────────────────────────────────────────────
const _signRate = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, arr] of _signRate.entries()) if (!arr.some(t => t > cutoff)) _signRate.delete(k);
}, 30_000).unref();
function checkSignRate(ip) {
  const now = Date.now(), cutoff = now - 60_000;
  const hits = (_signRate.get(ip) || []).filter(t => t > cutoff);
  if (hits.length >= 600) return false;
  hits.push(now); _signRate.set(ip, hits);
  return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}
async function forwardResponse(res, upstream) {
  const text = await upstream.text();
  const ct   = upstream.headers.get('content-type') || 'application/json';
  return res.status(upstream.status).type(ct).send(text);
}
function isEvmAddress(v) { return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim()); }
function isLikelySolanaAddress(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '').trim()); }

// Polygon RPC eth_call helper
async function ethCall(to, data) {
  const r = await fetchWithTimeout(POLYGON_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'eth_call', params: [{ to, data }, 'latest'] }),
  }, 8_000);
  const j = await r.json();
  if (j.error) throw new Error('RPC: ' + j.error.message);
  return j.result;
}

// ERC20 balanceOf
async function pUsdBalanceOf(addr) {
  const padded = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const hex = await ethCall(PUSD_ADDRESS, '0x70a08231' + padded);
  return hex && hex.startsWith('0x') ? BigInt(hex) : 0n;
}

// Pending signature store (in-memory; OK for single-process. Use Redis if you scale.)
const _pending = new Map();
function newRequestId() { return crypto.randomBytes(16).toString('hex'); }
function stashPending(id, payload, ttlMs = 5 * 60_000) {
  _pending.set(id, { ...payload, expiresAt: Date.now() + ttlMs });
}
function takePending(id) {
  const p = _pending.get(id);
  if (!p) return null;
  if (Date.now() > p.expiresAt) { _pending.delete(id); return null; }
  _pending.delete(id);
  return p;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of _pending.entries()) if (now > p.expiresAt) _pending.delete(id);
}, 60_000).unref();

// ─── Bridge: address lookup (shared) ────────────────────────────────────────
async function bridgeDepositAddress(depositWallet) {
  const clean = String(depositWallet || '').trim().toLowerCase();
  if (!isEvmAddress(clean)) throw new Error('Valid EVM address required');
  const r = await fetchWithTimeout(`${BRIDGE_URL}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ address: clean }),
  }, 10_000);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Bridge non-JSON: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`Bridge ${r.status}: ${text.slice(0, 300)}`);
  const a = data?.address && typeof data.address === 'object' ? data.address : data;
  return {
    raw: data,
    evm: a.evm || a.evmAddress || a.evm_address || null,
    svm: a.svm || a.svmAddress || a.svm_address || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH + DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/health', (_req, res) => {
  res.json({
    ok: true, v: 2,
    hasCreds: credsOk(),
    hasBuilderCode: Boolean(BUILDER_CODE),
    builderKeyTail: BUILDER_KEY ? '…' + BUILDER_KEY.slice(-6) : null,
    secretDecoded: Boolean(_decodedSecret),
    secretError: _secretError,
    sdkLoaded: Boolean(sdkHmac),
    signMode: sdkHmac ? 'sdk' : 'manual',
    bridge: BRIDGE_URL,
    relayer: RELAYER_URL,
    clob: CLOB_URL,
  });
});

router.get('/test-creds', async (_req, res) => {
  const attempts = [];
  if (credsOk() && _decodedSecret) {
    try {
      const headers = await builderHeaders('GET', '/api-keys');
      const r = await fetchWithTimeout(`${CLOB_URL}/api-keys`, {
        method: 'GET',
        headers: { ...headers, Accept: 'application/json' },
      }, 10_000);
      const body = await r.text();
      attempts.push({ test: 'CLOB /api-keys', status: r.status, ok: r.ok, body: body.slice(0, 300) });
    } catch (e) {
      attempts.push({ test: 'CLOB /api-keys', error: String(e?.message || e) });
    }
  } else {
    attempts.push({ test: 'CLOB /api-keys', skipped: 'creds not set or secret invalid' });
  }
  res.json({
    env: {
      hasBuilderKey: Boolean(BUILDER_KEY),
      hasBuilderSecret: Boolean(BUILDER_SECRET),
      hasBuilderPassphrase: Boolean(BUILDER_PASSPHRASE),
      hasBuilderCode: Boolean(BUILDER_CODE),
      secretDecoded: Boolean(_decodedSecret),
      secretError: _secretError,
    },
    attempts,
    verdict: attempts[0]?.ok ? 'Builder HMAC OK' : 'Builder HMAC FAIL',
  });
});

router.get('/builder-code', (_req, res) => res.json({ builderCode: BUILDER_CODE || null }));

// ═══════════════════════════════════════════════════════════════════════════
// /sign — remote HMAC (kept for any code still using BuilderConfig.remote)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/sign', async (req, res) => {
  try {
    if (!credsOk()) return res.status(500).json({ error: 'Builder credentials not configured' });
    if (!_decodedSecret) return res.status(500).json({ error: 'Builder secret invalid: ' + _secretError });
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (!checkSignRate(ip)) return res.status(429).json({ error: 'Too many sign requests' });
    const { method, path, requestPath, body } = req.body || {};
    const p = path || requestPath;
    if (!method || !p) return res.status(400).json({ error: 'method and path required' });
    const headers = await builderHeaders(method, p, body);
    return res.json(headers);
  } catch (e) {
    console.error('[poly/sign]', e);
    return res.status(500).json({ error: 'sign_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BRIDGE PROXY (deposit, status, withdraw, quote, supported-assets)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/deposit', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!isEvmAddress(address)) return res.status(400).json({ error: 'valid EVM address required' });
    const { evm, svm, raw } = await bridgeDepositAddress(address);
    return res.json({ evm, svm, raw });
  } catch (e) {
    return res.status(502).json({ error: 'deposit_failed', detail: String(e?.message || e) });
  }
});

router.get('/status/:address', async (req, res) => {
  try {
    const input = String(req.params.address || '').trim();
    let svm = input;
    if (isEvmAddress(input)) {
      const addrs = await bridgeDepositAddress(input);
      if (!addrs.svm) return res.status(502).json({ error: 'bridge_svm_missing', raw: addrs.raw });
      svm = addrs.svm;
    }
    if (!isLikelySolanaAddress(svm)) return res.status(400).json({ error: 'invalid address' });
    const r = await fetchWithTimeout(`${BRIDGE_URL}/status/${encodeURIComponent(svm)}`, {
      headers: { Accept: 'application/json' },
    }, 8_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({ error: 'status_failed', detail: String(e?.message || e) });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 15_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({ error: 'withdraw_failed', detail: String(e?.message || e) });
  }
});

router.post('/quote', async (req, res) => {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    }, 10_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(502).json({ error: 'quote_failed', detail: String(e?.message || e) });
  }
});

let _saCache = null, _saTs = 0, _saInflight = null;
router.get('/supported-assets', async (_req, res) => {
  try {
    if (_saCache && Date.now() - _saTs < 600_000) return res.json(_saCache);
    if (!_saInflight) {
      _saInflight = fetchWithTimeout(`${BRIDGE_URL}/supported-assets`, {
        headers: { Accept: 'application/json' },
      }, 8_000).finally(() => { _saInflight = null; });
    }
    const r = await _saInflight;
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(r.status).json({ error: 'non_json', body: text.slice(0, 500) }); }
    if (r.ok) { _saCache = data; _saTs = Date.now(); }
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'supported_assets_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SETUP / BALANCE / POSITIONS / BUY / SELL / REDEEM
//
// IMPORTANT: these are scaffolded to call the Polymarket V2 relayer + CLOB
// HTTP APIs directly. Several Polymarket endpoints (deposit-wallet derive,
// order EIP-712 hash construction) are NOT publicly documented in stable
// form yet. The handlers below mark those spots with TODO so you can fill
// in the exact request shape once you have a working trace from the SDK.
//
// The flow is correct; the on-wire details are what need finalizing.
// ═══════════════════════════════════════════════════════════════════════════

// ── /setup ──────────────────────────────────────────────────────────────────
// Derive deposit wallet address for the user's EOA, deploy it via the
// builder relayer if not deployed, then approve trading contracts.
//
// All three steps are gasless via the relayer. Only deployment requires
// no user signature (WALLET-CREATE is signed by the builder). Approvals
// are submitted as a WALLET batch that DOES need a user EIP-712 signature
// over the batch + nonce + deadline.
router.post('/setup', async (req, res) => {
  try {
    const { owner } = req.body || {};
    if (!isEvmAddress(owner)) return res.status(400).json({ error: 'owner EVM address required' });
    if (!credsOk()) return res.status(503).json({ error: 'Builder creds not configured' });

    // STEP 1: derive deposit wallet address (deterministic).
    // TODO: Polymarket's relayer exposes a derive endpoint; until it's
    // documented stably, the cleanest path is to compute the CREATE2 address
    // locally from owner + factory salt. Placeholder below — replace with
    // your verified derivation.
    const depositWallet = await deriveDepositWalletAddress(owner);

    // STEP 2: check if deployed (code length on Polygon).
    const codeResp = await fetchWithTimeout(POLYGON_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [depositWallet, 'latest'] }),
    }, 8_000).then(r => r.json());
    const isDeployed = codeResp?.result && codeResp.result !== '0x';

    if (!isDeployed) {
      // Gasless deploy via relayer. No user signature needed for WALLET-CREATE.
      const headers = await builderHeaders('POST', '/wallet-create', { owner, depositWallet });
      const r = await fetchWithTimeout(`${RELAYER_URL}/wallet-create`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ owner, depositWallet }),
      }, 30_000);
      if (!r.ok) {
        const txt = await r.text();
        return res.status(502).json({ error: 'deploy_failed', detail: txt.slice(0, 400) });
      }
    }

    // STEP 3: prepare approval batch for user to sign (EIP-712 over the batch).
    // TODO: the precise EIP-712 type structure for DepositWallet batches lives
    // in Polymarket's SDK. The shape below matches the documented domain
    // separator { name: "DepositWallet", version: "1", chainId: 137,
    // verifyingContract: depositWallet }.
    const deadline = String(Math.floor(Date.now() / 1000) + 600);
    const calls = buildApprovalCalls();
    const typedData = buildDepositWalletBatchTypedData({
      depositWallet, calls, deadline, nonce: '0',
    });

    const requestId = newRequestId();
    stashPending(requestId, { kind: 'setup-approvals', owner, depositWallet, calls, deadline });

    return res.json({
      depositWallet,
      isDeployed,
      needsSignature: { requestId, typedData },
    });
  } catch (e) {
    console.error('[poly/setup]', e);
    return res.status(500).json({ error: 'setup_failed', detail: String(e?.message || e) });
  }
});

router.post('/setup/submit', async (req, res) => {
  try {
    const { requestId, signature } = req.body || {};
    const pending = takePending(requestId);
    if (!pending || pending.kind !== 'setup-approvals')
      return res.status(400).json({ error: 'unknown or expired requestId' });

    const { depositWallet, calls, deadline } = pending;
    const headers = await builderHeaders('POST', '/wallet-batch', { calls, depositWallet, deadline, signature });
    const r = await fetchWithTimeout(`${RELAYER_URL}/wallet-batch`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ calls, depositWallet, deadline, signature }),
    }, 30_000);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: 'approvals_failed', detail: txt.slice(0, 400) });
    }
    return res.json({ ok: true, depositWallet });
  } catch (e) {
    console.error('[poly/setup/submit]', e);
    return res.status(500).json({ error: 'setup_submit_failed', detail: String(e?.message || e) });
  }
});

// ── /balance ────────────────────────────────────────────────────────────────
router.get('/balance/:evm', async (req, res) => {
  try {
    const evm = req.params.evm;
    if (!isEvmAddress(evm)) return res.status(400).json({ error: 'invalid EVM address' });
    const depositWallet = await deriveDepositWalletAddress(evm);
    const balance = await pUsdBalanceOf(depositWallet);
    return res.json({ depositWallet, balance: balance.toString() });
  } catch (e) {
    return res.status(500).json({ error: 'balance_failed', detail: String(e?.message || e) });
  }
});

// ── /positions ──────────────────────────────────────────────────────────────
router.get('/positions/:evm', async (req, res) => {
  try {
    const evm = req.params.evm;
    if (!isEvmAddress(evm)) return res.status(400).json({ error: 'invalid EVM address' });
    const depositWallet = await deriveDepositWalletAddress(evm);
    const { conditionId } = req.query || {};
    const qs = new URLSearchParams({ user: depositWallet.toLowerCase(), limit: '100' });
    if (conditionId) qs.set('market', String(conditionId));
    const r = await fetchWithTimeout(`${DATA_URL}/positions?${qs}`, {
      headers: { Accept: 'application/json' },
    }, 10_000);
    return forwardResponse(res, r);
  } catch (e) {
    return res.status(500).json({ error: 'positions_failed', detail: String(e?.message || e) });
  }
});

// ── /buy and /sell ──────────────────────────────────────────────────────────
async function prepareOrder(req, res, sideEnum) {
  try {
    const {
      owner, conditionId, tokenId, usd, shares, price, tickSize, negRisk,
    } = req.body || {};
    if (!isEvmAddress(owner)) return res.status(400).json({ error: 'owner EVM address required' });
    if (!tokenId || !conditionId) return res.status(400).json({ error: 'tokenId and conditionId required' });
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) return res.status(400).json({ error: 'invalid price' });

    const depositWallet = await deriveDepositWalletAddress(owner);
    const size = sideEnum === 'BUY' ? Number(usd) / p : Number(shares);
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'invalid size' });

    // TODO: build the exact CLOB v2 order struct + EIP-712 typed data. The
    // canonical types come from @polymarket/clob-client-v2; until you can
    // import that on the server, fill in the fields below from a live trace.
    const order = {
      maker: depositWallet,
      signer: depositWallet,
      tokenId,
      makerAmount: '0',  // TODO compute from size/price/side per V2 spec
      takerAmount: '0',  // TODO
      side: sideEnum,
      feeRateBps: '0',
      nonce: String(Date.now()),
      expiration: String(Math.floor(Date.now() / 1000) + 600),
      signatureType: 3,  // POLY_1271
      taker: '0x0000000000000000000000000000000000000000',
    };
    const typedData = buildCtfExchangeOrderTypedData({
      order, negRisk: !!negRisk,
    });

    const requestId = newRequestId();
    stashPending(requestId, {
      kind: 'order', owner, depositWallet, order, tickSize, negRisk,
      builderCode: BUILDER_CODE,
    });

    return res.json({ needsSignature: { requestId, typedData } });
  } catch (e) {
    console.error('[poly/order]', e);
    return res.status(500).json({ error: 'prepare_failed', detail: String(e?.message || e) });
  }
}

router.post('/buy',  (req, res) => prepareOrder(req, res, 'BUY'));
router.post('/sell', (req, res) => prepareOrder(req, res, 'SELL'));

async function submitOrder(req, res) {
  try {
    const { requestId, signature } = req.body || {};
    const pending = takePending(requestId);
    if (!pending || pending.kind !== 'order')
      return res.status(400).json({ error: 'unknown or expired requestId' });

    const { order, tickSize, negRisk, builderCode } = pending;
    const orderArgs = { ...order, signature, builderCode };

    const path = '/order';
    const headers = await builderHeaders('POST', path, orderArgs);
    const r = await fetchWithTimeout(`${CLOB_URL}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ order: orderArgs, owner: order.maker, orderType: 'FAK', tickSize, negRisk }),
    }, 20_000);
    return forwardResponse(res, r);
  } catch (e) {
    console.error('[poly/order/submit]', e);
    return res.status(500).json({ error: 'submit_failed', detail: String(e?.message || e) });
  }
}

router.post('/buy/submit',  submitOrder);
router.post('/sell/submit', submitOrder);

// ── /redeem ─────────────────────────────────────────────────────────────────
// Calls redeemPositions on CTF (or NegRiskAdapter) via the deposit wallet
// batch. Needs the user's EIP-712 signature over the WALLET batch.
router.post('/redeem', async (req, res) => {
  try {
    const { owner, conditionId, negRisk } = req.body || {};
    if (!isEvmAddress(owner))    return res.status(400).json({ error: 'owner EVM address required' });
    if (!conditionId)            return res.status(400).json({ error: 'conditionId required' });

    const depositWallet = await deriveDepositWalletAddress(owner);
    const data = encodeRedeemPositions({ collateral: PUSD_ADDRESS, conditionId, indexSets: [1, 2] });
    const target = negRisk ? NEG_RISK_ADAPTER : CONDITIONAL_TOKENS;
    const calls = [{ target, value: '0', data }];
    const deadline = String(Math.floor(Date.now() / 1000) + 600);

    const typedData = buildDepositWalletBatchTypedData({
      depositWallet, calls, deadline, nonce: '0',
    });

    const requestId = newRequestId();
    stashPending(requestId, { kind: 'redeem', owner, depositWallet, calls, deadline });

    return res.json({ needsSignature: { requestId, typedData } });
  } catch (e) {
    console.error('[poly/redeem]', e);
    return res.status(500).json({ error: 'redeem_failed', detail: String(e?.message || e) });
  }
});

router.post('/redeem/submit', async (req, res) => {
  try {
    const { requestId, signature } = req.body || {};
    const pending = takePending(requestId);
    if (!pending || pending.kind !== 'redeem')
      return res.status(400).json({ error: 'unknown or expired requestId' });

    const { depositWallet, calls, deadline } = pending;
    const headers = await builderHeaders('POST', '/wallet-batch', { calls, depositWallet, deadline, signature });
    const r = await fetchWithTimeout(`${RELAYER_URL}/wallet-batch`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ calls, depositWallet, deadline, signature }),
    }, 30_000);
    return forwardResponse(res, r);
  } catch (e) {
    console.error('[poly/redeem/submit]', e);
    return res.status(500).json({ error: 'redeem_submit_failed', detail: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCAFFOLDED HELPERS — replace TODOs with values verified against a real
// SDK trace (run the SDK once in any environment, capture the typed data
// and ABI selectors, paste here). The endpoints above are correct; only
// these helper bodies need the exact protocol bytes.
// ═══════════════════════════════════════════════════════════════════════════

// CREATE2 deterministic deposit wallet address.
// TODO: fill in factory address + implementation + salt scheme used by Polymarket.
async function deriveDepositWalletAddress(owner) {
  // PLACEHOLDER: until you confirm the V2 factory bytecode + salt, this
  // function MUST be replaced with a verified derivation. One approach:
  // call the Polymarket relayer's GET /deposit-wallet?owner=0x... endpoint
  // and cache the result. Returning owner unchanged here would let the
  // server boot but produce wrong addresses, so we throw loudly instead.
  throw new Error(
    'deriveDepositWalletAddress is not implemented yet. ' +
    'Replace this with a verified CREATE2 derivation or a call to ' +
    'the Polymarket relayer\'s deposit-wallet lookup endpoint.'
  );
}

// Approval calldata builders
const MAX_UINT256 = (1n << 256n) - 1n;
function pad32(hex) { return hex.replace(/^0x/, '').toLowerCase().padStart(64, '0'); }
function u256(n)    { return BigInt(n).toString(16).padStart(64, '0'); }
function encErc20Approve(spender, amount) {
  return '0x095ea7b3' + pad32(spender) + u256(amount);
}
function encErc1155SetApprovalForAll(operator, approved) {
  return '0xa22cb465' + pad32(operator) + u256(approved ? 1 : 0);
}

function buildApprovalCalls() {
  return [
    { target: PUSD_ADDRESS,       value: '0', data: encErc20Approve(CTF_EXCHANGE_V2,       MAX_UINT256.toString()) },
    { target: PUSD_ADDRESS,       value: '0', data: encErc20Approve(NEG_RISK_CTF_EXCHANGE, MAX_UINT256.toString()) },
    { target: PUSD_ADDRESS,       value: '0', data: encErc20Approve(NEG_RISK_ADAPTER,      MAX_UINT256.toString()) },
    { target: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(CTF_EXCHANGE_V2,       true) },
    { target: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_CTF_EXCHANGE, true) },
    { target: CONDITIONAL_TOKENS, value: '0', data: encErc1155SetApprovalForAll(NEG_RISK_ADAPTER,      true) },
  ];
}

// redeemPositions(address,bytes32,bytes32,uint256[]) — selector 0xed0825ef
function encodeRedeemPositions({ collateral, conditionId, indexSets }) {
  return '0x' + 'ed0825ef'
    + pad32(collateral)
    + '0'.padStart(64, '0')          // parentCollectionId = 0
    + pad32(conditionId)
    + u256(128)                       // offset to dynamic array
    + u256(indexSets.length)
    + indexSets.map(u256).join('');
}

// EIP-712 typed data for a DepositWallet batch.
// Domain matches docs: { name: "DepositWallet", version: "1", chainId, verifyingContract: depositWallet }
function buildDepositWalletBatchTypedData({ depositWallet, calls, deadline, nonce }) {
  return {
    domain: {
      name: 'DepositWallet',
      version: '1',
      chainId: POLYGON_CHAIN_ID,
      verifyingContract: depositWallet,
    },
    types: {
      Call: [
        { name: 'target', type: 'address' },
        { name: 'value',  type: 'uint256' },
        { name: 'data',   type: 'bytes'   },
      ],
      Batch: [
        { name: 'calls',    type: 'Call[]'  },
        { name: 'nonce',    type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Batch',
    message: { calls, nonce, deadline },
  };
}

// EIP-712 typed data for a CTF Exchange V2 order.
// TODO: confirm field names + domain against the v2 contracts. The shape
// below is the standard Polymarket order EIP-712; fill in any missing
// fields from a live SDK trace.
function buildCtfExchangeOrderTypedData({ order, negRisk }) {
  const verifyingContract = negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE_V2;
  return {
    domain: {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: POLYGON_CHAIN_ID,
      verifyingContract,
    },
    types: {
      Order: [
        { name: 'salt',          type: 'uint256' },
        { name: 'maker',         type: 'address' },
        { name: 'signer',        type: 'address' },
        { name: 'taker',         type: 'address' },
        { name: 'tokenId',       type: 'uint256' },
        { name: 'makerAmount',   type: 'uint256' },
        { name: 'takerAmount',   type: 'uint256' },
        { name: 'expiration',    type: 'uint256' },
        { name: 'nonce',         type: 'uint256' },
        { name: 'feeRateBps',    type: 'uint256' },
        { name: 'side',          type: 'uint8'   },
        { name: 'signatureType', type: 'uint8'   },
      ],
    },
    primaryType: 'Order',
    message: { ...order, salt: order.nonce },
  };
}

module.exports = router;
