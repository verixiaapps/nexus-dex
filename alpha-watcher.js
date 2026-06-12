// alpha-watcher.js — Pre-graduation pump.fun catch.
//
// Detection in plain words:
//   We watch every brand-new pump.fun token from the moment it's created.
//   For each token we subscribe to its trade stream. We fire when ALL of:
//
//     • Market cap is between $3,000 and $5,000 (USD).
//     • 3+ distinct wallets have each bought at least $30 worth.
//     • Token is at most 2 hours old.
//     • Creator wallet is fresh — under 7 days old AND under ~50 total
//       transactions. Serial deployers skipped.
//     • Token program clean — plain SPL, or Token-2022 without transfer
//       hook / permanent delegate / >5% transfer fee.
//     • No cluster — if 3+ qualifying buyers share a single funder source
//       it's coordinated, killed.
//     • Top non-curve holder owns under 25% of circulating supply.
//
//   When all checks pass we push the signal to /alpha-state.json. The
//   front page polls it and shows cards. No email, no Telegram — feed only.
//
// Wire-up (in server.js):
//   const alpha = require('./alpha-watcher');
//   alpha.mountRoutes(app);

const fs   = require('fs');
const path = require('path');

// WebSocket: native if available (Node 22+), fall back to ws package.
let WebSocketCtor = null;
let wsSource = 'none';
if (typeof globalThis.WebSocket === 'function') {
  WebSocketCtor = globalThis.WebSocket;
  wsSource = 'native';
} else {
  try { WebSocketCtor = require('ws'); wsSource = 'ws-package'; }
  catch {}
}

// ─── CONFIG ────────────────────────────────────────────────────────────
const CFG = {
  MIN_MCAP_USD:         3000,
  MAX_MCAP_USD:         8000,
  MIN_BUYER_USD:        30,
  MIN_BUYERS:           3,
  MAX_TOKEN_AGE_MS:     6 * 3600_000,
  MAX_CREATOR_AGE_MS:   7 * 24 * 3600_000,
  MAX_CREATOR_SIGS:     50,
  MAX_TOP_HOLDER_PCT:   25,
  CLUSTER_KILL:         3,
  WATCH_LIMIT:          500,
  TRADE_SUB_BATCH:      80,
  SIGNAL_RETENTION_MS:  24 * 3600_000,
  CACHE_MAX:            50_000,
  PUMPPORTAL_WSS:       'wss://pumpportal.fun/api/data',
  JUPITER_PRICE_URL:    'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
  SOL_MINT:             'So11111111111111111111111111111111111111112',
  TOKEN_PROGRAM:        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM:   'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  RPC_URL:              process.env.ALPHA_RPC_URL || 'https://solana-rpc.publicnode.com',
};

function log(...a)  { console.log('[alpha]', ...a); }
function warn(...a) { console.warn('[alpha]', ...a); }

// ─── STATE ─────────────────────────────────────────────────────────────
const watched      = new Map();
const signals      = [];
const creatorCache = new Map();
const funderCache  = new Map();
let   solPriceUsd  = 0;
let   solPriceTs   = 0;
let   ws = null;
let   wsRetryMs    = 1000;

const status = {
  startedAt:        Date.now(),
  wsConnected:      false,
  newTokensSeen:    0,
  tradesScanned:    0,
  tokensWatched:    0,
  qualifyingTokens: 0,
  evaluations:      0,
  signalsFired:     0,
  killedCreator:    0,
  killedProgram:    0,
  killedConcentration: 0,
  killedCluster:    0,
  killedTooOld:     0,
  lastError:        null,
};

const _stateWrite = {
  lastSuccessAt: 0, lastWrittenDirs: [], lastErrorAt: 0, lastError: null, writeCount: 0,
};

// ─── RPC THROTTLE ──────────────────────────────────────────────────────
const rpcQueue = [];
let rpcInFlight = 0;
const RPC_CONCURRENCY = 2;
const RPC_MIN_GAP_MS  = 250;
let rpcLastAt = 0;

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    rpcQueue.push({ method, params, resolve, reject });
    drainRpc();
  });
}
async function drainRpc() {
  if (rpcInFlight >= RPC_CONCURRENCY || rpcQueue.length === 0) return;
  const gap = Date.now() - rpcLastAt;
  if (gap < RPC_MIN_GAP_MS) { setTimeout(drainRpc, RPC_MIN_GAP_MS - gap); return; }
  const job = rpcQueue.shift();
  rpcInFlight++;
  rpcLastAt = Date.now();
  try {
    const r = await fetch(CFG.RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: job.method, params: job.params }),
    });
    const d = await r.json();
    if (d.error) job.reject(new Error(d.error.message));
    else job.resolve(d.result);
  } catch (e) { job.reject(e); }
  finally { rpcInFlight--; setTimeout(drainRpc, 0); }
}

// ─── SOL PRICE ─────────────────────────────────────────────────────────
async function refreshSolPrice() {
  try {
    const r = await fetch(CFG.JUPITER_PRICE_URL);
    const d = await r.json();
    const p = Number(d?.[CFG.SOL_MINT]?.usdPrice || 0);
    if (Number.isFinite(p) && p > 0) { solPriceUsd = p; solPriceTs = Date.now(); }
  } catch (e) { warn('sol price failed', e.message); }
}

// ─── CREATOR HISTORY CHECK ─────────────────────────────────────────────
async function checkCreator(creator) {
  const cached = creatorCache.get(creator);
  if (cached && Date.now() - cached.ts < 6 * 3600_000) return cached.result;

  const result = { fresh: false, age: 0, sigs: 0, reason: 'unknown' };
  try {
    const sigs = await rpc('getSignaturesForAddress', [creator, { limit: CFG.MAX_CREATOR_SIGS + 1 }]);
    if (!Array.isArray(sigs)) {
      result.reason = 'no signatures returned';
    } else {
      result.sigs = sigs.length;
      if (sigs.length > CFG.MAX_CREATOR_SIGS) {
        result.reason = `too many txs (${sigs.length}+)`;
      } else if (sigs.length === 0) {
        result.fresh = true;
      } else {
        const oldest = sigs[sigs.length - 1];
        const oldestMs = oldest?.blockTime ? oldest.blockTime * 1000 : Date.now();
        result.age = Date.now() - oldestMs;
        if (result.age > CFG.MAX_CREATOR_AGE_MS) {
          result.reason = `creator ${Math.round(result.age / 86400_000)}d old`;
        } else {
          result.fresh = true;
        }
      }
    }
  } catch {
    result.reason = 'rpc error';
  }

  creatorCache.set(creator, { result, ts: Date.now() });
  return result;
}

// ─── TOKEN PROGRAM / EXTENSIONS CHECK ──────────────────────────────────
async function checkTokenProgram(mint) {
  try {
    const acc = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const owner = acc?.value?.owner;
    const info  = acc?.value?.data?.parsed?.info;

    if (!owner) return { safe: false, reason: 'mint info unreadable' };
    if (owner === CFG.TOKEN_PROGRAM) return { safe: true };
    if (owner === CFG.TOKEN_2022_PROGRAM) {
      for (const ex of (info?.extensions || [])) {
        if (ex.extension === 'transferHook')      return { safe: false, reason: 'transfer hook' };
        if (ex.extension === 'permanentDelegate') return { safe: false, reason: 'permanent delegate' };
        if (ex.extension === 'transferFeeConfig') {
          const bps = Number(ex.state?.newerTransferFee?.transferFeeBasisPoints || 0);
          if (bps > 500) return { safe: false, reason: `${bps/100}% transfer fee` };
        }
      }
      return { safe: true };
    }
    return { safe: false, reason: 'unknown token program' };
  } catch {
    return { safe: false, reason: 'mint info unreadable' };
  }
}

// ─── HOLDER CONCENTRATION CHECK ────────────────────────────────────────
async function checkConcentration(mint) {
  try {
    const r = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    const accs = r?.value || [];
    if (!accs.length) return { safe: true };

    const sorted = accs
      .map(a => ({ addr: a.address, ui: Number(a.uiAmount || 0) }))
      .filter(a => a.ui > 0)
      .sort((a, b) => b.ui - a.ui);
    if (sorted.length < 2) return { safe: true };

    // Top one is almost always the bonding curve token account. Compare
    // the next-largest "real" holder against the sum of all non-curve holders.
    const realHolders = sorted.slice(1);
    const realTotal   = realHolders.reduce((s, a) => s + a.ui, 0);
    if (realTotal <= 0) return { safe: true };
    const topReal = realHolders[0];
    const pct = (topReal.ui / realTotal) * 100;
    if (pct > CFG.MAX_TOP_HOLDER_PCT) {
      return { safe: false, reason: `top holder ${pct.toFixed(0)}%`, topPct: pct };
    }
    return { safe: true, topPct: pct };
  } catch {
    return { safe: true };
  }
}

// ─── FUNDER TRACE ──────────────────────────────────────────────────────
async function getFunderOf(wallet) {
  const cached = funderCache.get(wallet);
  if (cached) {
    if (cached.funder) return cached.funder;
    if (Date.now() - cached.ts < 30 * 60_000) return null;
  }

  let oldestSig = null;
  try {
    let before;
    for (let i = 0; i < 5; i++) {
      const sigs = await rpc('getSignaturesForAddress',
        [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
      if (!Array.isArray(sigs) || sigs.length === 0) break;
      const last = sigs[sigs.length - 1];
      if (last.signature) oldestSig = last.signature;
      if (sigs.length < 1000) break;
      before = last.signature;
    }
  } catch {
    funderCache.set(wallet, { funder: null, ts: Date.now() });
    return null;
  }
  if (!oldestSig) {
    funderCache.set(wallet, { funder: null, ts: Date.now() });
    return null;
  }

  let tx;
  try {
    tx = await rpc('getTransaction', [oldestSig, {
      maxSupportedTransactionVersion: 0, encoding: 'jsonParsed',
    }]);
  } catch {
    funderCache.set(wallet, { funder: null, ts: Date.now() });
    return null;
  }
  if (!tx) { funderCache.set(wallet, { funder: null, ts: Date.now() }); return null; }

  const msg = tx?.transaction?.message;
  const instructions = msg?.instructions || [];
  for (const ix of instructions) {
    if (ix?.program === 'system' && ix?.parsed?.type === 'transfer' &&
        ix?.parsed?.info?.destination === wallet) {
      const src = ix.parsed.info.source;
      funderCache.set(wallet, { funder: src, ts: Date.now() });
      return src;
    }
  }

  const accountKeys = (msg?.accountKeys || [])
    .map(k => typeof k === 'string' ? k : k?.pubkey).filter(Boolean);
  const pre  = tx?.meta?.preBalances  || [];
  const post = tx?.meta?.postBalances || [];
  const widx = accountKeys.indexOf(wallet);
  if (widx >= 0 && post[widx] > pre[widx]) {
    let bestIdx = -1, bestLost = 0;
    for (let i = 0; i < accountKeys.length; i++) {
      if (i === widx) continue;
      const lost = (pre[i] || 0) - (post[i] || 0);
      if (lost > bestLost) { bestLost = lost; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      const src = accountKeys[bestIdx];
      funderCache.set(wallet, { funder: src, ts: Date.now() });
      return src;
    }
  }

  funderCache.set(wallet, { funder: null, ts: Date.now() });
  return null;
}

async function checkCluster(buyerWallets) {
  const funders = await Promise.all(buyerWallets.map(w => getFunderOf(w).catch(() => null)));
  const byFunder = new Map();
  for (const f of funders) {
    if (!f) continue;
    byFunder.set(f, (byFunder.get(f) || 0) + 1);
  }
  const max = Math.max(0, ...byFunder.values());
  if (max >= CFG.CLUSTER_KILL) {
    return { safe: false, reason: `cluster: ${max} from same funder` };
  }
  return { safe: true };
}

// ─── EVALUATION ────────────────────────────────────────────────────────
async function evaluate(mint) {
  const w = watched.get(mint);
  if (!w || w.evaluating || w.killed) return;
  w.evaluating = true;
  status.evaluations++;

  try {
    const age = Date.now() - w.createdAt;
    if (age > CFG.MAX_TOKEN_AGE_MS) { w.killed = true; status.killedTooOld++; return; }
    if (w.mcapUsd < CFG.MIN_MCAP_USD || w.mcapUsd > CFG.MAX_MCAP_USD) return;

    const qualifying = [...w.buyers.entries()].filter(([, usd]) => usd >= CFG.MIN_BUYER_USD);
    if (qualifying.length < CFG.MIN_BUYERS) return;

    const creator = await checkCreator(w.creator);
    if (!creator.fresh) { w.killed = true; status.killedCreator++; return; }

    const prog = await checkTokenProgram(mint);
    if (!prog.safe) { w.killed = true; status.killedProgram++; return; }

    const conc = await checkConcentration(mint);
    if (!conc.safe) { w.killed = true; status.killedConcentration++; return; }

    const buyerList = qualifying.map(([wallet]) => wallet);
    const cluster = await checkCluster(buyerList);
    if (!cluster.safe) { w.killed = true; status.killedCluster++; return; }

    fireSignal(mint, qualifying);
  } catch (e) {
    status.lastError = 'evaluate: ' + e.message;
  } finally {
    if (watched.has(mint)) watched.get(mint).evaluating = false;
  }
}

function fireSignal(mint, qualifying) {
  const w = watched.get(mint);
  if (!w) return;

  const buyers = qualifying
    .map(([wallet, usd]) => ({ wallet, usd }))
    .sort((a, b) => b.usd - a.usd);
  const totalUsd = buyers.reduce((s, b) => s + b.usd, 0);

  const sig = {
    mint,
    symbol:     w.sym || '???',
    name:       w.name || w.sym || 'Unknown',
    image:      w.image || null,
    creator:    w.creator,
    firedAt:    Date.now(),
    ageMs:      Date.now() - w.createdAt,
    mcapUsd:    Math.round(w.mcapUsd),
    mcapSol:    w.mcapSol,
    buyerCount: buyers.length,
    totalUsd:   Math.round(totalUsd),
    buyers,
    pumpFunUrl: `https://pump.fun/coin/${mint}`,
  };
  signals.unshift(sig);
  status.signalsFired++;
  log(`🎯 ${sig.symbol} (${mint.slice(0,8)}…) mcap $${sig.mcapUsd} · ${buyers.length} buyers · $${sig.totalUsd}`);

  w.killed = true;
  unsubscribeTrade(mint);
  watched.delete(mint);
}

// ─── PUMPPORTAL WSS ────────────────────────────────────────────────────
const pendingTradeSubs   = new Set();
const pendingTradeUnsubs = new Set();
let subDrainTimer = null;

function queueTradeSub(mint) {
  pendingTradeUnsubs.delete(mint);
  pendingTradeSubs.add(mint);
  scheduleSubDrain();
}
function queueTradeUnsub(mint) {
  pendingTradeSubs.delete(mint);
  pendingTradeUnsubs.add(mint);
  scheduleSubDrain();
}
function scheduleSubDrain() {
  if (subDrainTimer) return;
  subDrainTimer = setTimeout(drainSubs, 500);
}
function drainSubs() {
  subDrainTimer = null;
  if (!ws || !status.wsConnected) return;
  if (pendingTradeSubs.size > 0) {
    const keys = [...pendingTradeSubs].slice(0, CFG.TRADE_SUB_BATCH);
    keys.forEach(k => pendingTradeSubs.delete(k));
    try { ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys })); } catch {}
  }
  if (pendingTradeUnsubs.size > 0) {
    const keys = [...pendingTradeUnsubs].slice(0, CFG.TRADE_SUB_BATCH);
    keys.forEach(k => pendingTradeUnsubs.delete(k));
    try { ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys })); } catch {}
  }
  if (pendingTradeSubs.size > 0 || pendingTradeUnsubs.size > 0) scheduleSubDrain();
}
function unsubscribeTrade(mint) {
  const w = watched.get(mint);
  if (w?.tradeSubscribed) {
    queueTradeUnsub(mint);
    w.tradeSubscribed = false;
  }
}

function onCreate(m) {
  if (!m.mint || typeof m.mint !== 'string') return;
  if (watched.has(m.mint)) return;

  if (watched.size >= CFG.WATCH_LIMIT) {
    let oldest = null, oldestT = Infinity;
    for (const [mint, w] of watched) {
      if (w.createdAt < oldestT) { oldestT = w.createdAt; oldest = mint; }
    }
    if (oldest) { unsubscribeTrade(oldest); watched.delete(oldest); }
  }

  const mcapSol = Number(m.marketCapSol || 0);
  const mcapUsd = mcapSol * (solPriceUsd || 0);

  watched.set(m.mint, {
    createdAt:       Date.now(),
    creator:         m.traderPublicKey || null,
    sym:             m.symbol  || '???',
    name:            m.name    || m.symbol || 'Unknown',
    image:           m.uri     || null,
    bondingCurveKey: m.bondingCurveKey || null,
    mcapUsd, mcapSol,
    lastTradeAt:     0,
    buyers:          new Map(),
    evaluating:      false,
    killed:          false,
    tradeSubscribed: false,
  });
  status.newTokensSeen++;

  queueTradeSub(m.mint);
  const w = watched.get(m.mint);
  if (w) w.tradeSubscribed = true;
}

function onTrade(m) {
  if (!m.mint || !watched.has(m.mint)) return;
  const w = watched.get(m.mint);
  if (w.killed) return;

  status.tradesScanned++;

  const mcapSol = Number(m.marketCapSol || 0);
  if (mcapSol > 0) {
    w.mcapSol = mcapSol;
    w.mcapUsd = mcapSol * (solPriceUsd || 0);
  }
  w.lastTradeAt = Date.now();

  if (m.txType !== 'buy') return;
  const buyer = m.traderPublicKey;
  const solAmount = Number(m.solAmount || 0);
  if (!buyer || solAmount <= 0 || !solPriceUsd) return;

  const usd = solAmount * solPriceUsd;
  const prevUsd = w.buyers.get(buyer) || 0;
  w.buyers.set(buyer, prevUsd + usd);

  if (w.mcapUsd < CFG.MIN_MCAP_USD || w.mcapUsd > CFG.MAX_MCAP_USD) return;
  if (Date.now() - w.createdAt > CFG.MAX_TOKEN_AGE_MS) return;

  let qualifyingCount = 0;
  for (const usdSpent of w.buyers.values()) {
    if (usdSpent >= CFG.MIN_BUYER_USD) qualifyingCount++;
  }
  if (qualifyingCount < CFG.MIN_BUYERS) return;

  status.qualifyingTokens++;
  evaluate(m.mint).catch(e => { status.lastError = 'evaluate: ' + e.message; });
}

function connectWs() {
  if (!WebSocketCtor) {
    warn('WebSocket unavailable. Install `ws` or upgrade to Node 22+. Routes keep working in degraded mode.');
    return;
  }
  try {
    ws = new WebSocketCtor(CFG.PUMPPORTAL_WSS);
  } catch (e) {
    status.lastError = 'ws ctor: ' + e.message;
    setTimeout(connectWs, 5_000);
    return;
  }

  const onOpen = () => {
    status.wsConnected = true; wsRetryMs = 1000;
    log(`PumpPortal connected (${wsSource})`);
    try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); } catch {}
    for (const [mint, w] of watched) {
      if (!w.killed) queueTradeSub(mint);
    }
  };
  const onMessage = (raw) => {
    let m; try { m = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.txType === 'create' && m.mint) { onCreate(m); return; }
    if ((m.txType === 'buy' || m.txType === 'sell') && m.mint) { onTrade(m); return; }
  };
  const onClose = () => {
    status.wsConnected = false;
    warn(`PumpPortal closed, retry ${wsRetryMs}ms`);
    setTimeout(connectWs, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 30_000);
  };
  const onError = (e) => { status.lastError = 'ws: ' + (e?.message || 'error'); };

  if (typeof ws.on === 'function') {
    ws.on('open', onOpen); ws.on('message', onMessage);
    ws.on('close', onClose); ws.on('error', onError);
  } else {
    ws.onopen = onOpen;
    ws.onmessage = (ev) => onMessage(ev.data);
    ws.onclose = onClose;
    ws.onerror = onError;
  }
}

// ─── HOUSEKEEPING ──────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [mint, w] of watched) {
    if (now - w.createdAt > CFG.MAX_TOKEN_AGE_MS || w.killed) {
      unsubscribeTrade(mint);
      watched.delete(mint);
    }
  }
  status.tokensWatched = watched.size;

  const sigCutoff = now - CFG.SIGNAL_RETENTION_MS;
  while (signals.length > 0 && signals[signals.length - 1].firedAt < sigCutoff) signals.pop();

  for (const cache of [creatorCache, funderCache]) {
    if (cache.size > CFG.CACHE_MAX) {
      const drop = cache.size - CFG.CACHE_MAX;
      const it = cache.keys();
      for (let i = 0; i < drop; i++) cache.delete(it.next().value);
    }
  }
}, 60_000);

setInterval(refreshSolPrice, 60_000);

// ─── STATE FILE ────────────────────────────────────────────────────────
function buildStatePayload() {
  return {
    ts:            Date.now(),
    ...status,
    tokensWatched: watched.size,
    solPrice:      solPriceUsd,
    uptimeMs:      Date.now() - status.startedAt,
    config: {
      minMcapUsd:        CFG.MIN_MCAP_USD,
      maxMcapUsd:        CFG.MAX_MCAP_USD,
      minBuyerUsd:       CFG.MIN_BUYER_USD,
      minBuyers:         CFG.MIN_BUYERS,
      maxAgeH:           CFG.MAX_TOKEN_AGE_MS / 3600_000,
      maxCreatorAgeDays: CFG.MAX_CREATOR_AGE_MS / 86400_000,
      maxCreatorSigs:    CFG.MAX_CREATOR_SIGS,
      maxTopHolderPct:   CFG.MAX_TOP_HOLDER_PCT,
      clusterKill:       CFG.CLUSTER_KILL,
    },
    signals:      signals.slice(0, 50),
    signalCount:  signals.length,
  };
}

const STATE_DIRS = [path.join(__dirname, 'build'), __dirname];
let _stateWriterStarted = false;
function startStateFileWriter() {
  if (_stateWriterStarted) return;
  _stateWriterStarted = true;
  const write = () => {
    const json = JSON.stringify(buildStatePayload());
    const written = []; let lastErr = null;
    for (const dir of STATE_DIRS) {
      try {
        if (!fs.existsSync(dir)) continue;
        fs.writeFileSync(path.join(dir, 'alpha-state.json'), json);
        written.push(dir);
      } catch (e) { lastErr = e.message; }
    }
    if (written.length > 0) {
      _stateWrite.lastSuccessAt = Date.now();
      _stateWrite.lastWrittenDirs = written;
      _stateWrite.writeCount++;
    } else {
      _stateWrite.lastErrorAt = Date.now();
      _stateWrite.lastError = lastErr || 'no writable dir';
    }
  };
  write();
  setInterval(write, 5000);
}

// ─── ROUTES ────────────────────────────────────────────────────────────
function mountRoutes(app) {
  app.get('/alpha-state.json', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(buildStatePayload());
  });
  app.get('/api/alpha/status',  (req, res) => res.json(buildStatePayload()));
  app.get('/api/alpha/signals', (req, res) => {
    res.json({ signals: signals.slice(0, 50), count: signals.length, ts: Date.now() });
  });
  app.get('/api/alpha/debug', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ts: Date.now(),
      uptimeMs: Date.now() - status.startedAt,
      status,
      stateWrite: _stateWrite,
      stateFileDirs: STATE_DIRS.map(d => ({ dir: d, exists: fs.existsSync(d) })),
      sizes: {
        watched: watched.size, signals: signals.length,
        creatorCache: creatorCache.size, funderCache: funderCache.size,
      },
      rpc: {
        url: CFG.RPC_URL.replace(/api-key=[^&]+/i, 'api-key=***'),
        inFlight: rpcInFlight, queued: rpcQueue.length,
      },
      websocket: {
        source: wsSource, connected: status.wsConnected,
        pendingTradeSubs: pendingTradeSubs.size,
        pendingTradeUnsubs: pendingTradeUnsubs.size,
      },
    });
  });
  start();
}

let started = false;
function start() {
  if (started) return;
  started = true;
  refreshSolPrice().catch(() => {});
  connectWs();
  startStateFileWriter();
  log(`alpha-watcher (pre-grad) started · watch limit ${CFG.WATCH_LIMIT} · rpc ${CFG.RPC_URL}`);
}

module.exports = { mountRoutes, start, _state: { watched, signals, status } };
