// alpha-watcher.js — Fresh-wallet convergence detector.
// FREE ENDPOINTS ONLY. No PumpPortal API key, no Helius, no setup.
//
// Pipeline:
//   1) PumpPortal WSS subscribeNewToken     → track creation timestamps
//   2) PumpPortal WSS subscribeMigration    → trigger watch on graduation
//   3) DexScreener                          → resolve mint → Raydium pool
//   4) GeckoTerminal /pools/{pool}/trades   → real trades w/ wallet + USD
//   5) Public Solana RPC                    → wallet first-tx age
//   6) Jupiter /swap/v1/quote               → honeypot probe (sell route)
//
// Detection: 3+ wallets <24h old, each ≥$2,500 buy, within 2h window,
// post-migration mcap window. Fires once per mint. Honeypot-gated.
//
// Wire-up:
//   const alpha = require('./alpha-watcher');
//   alpha.mountRoutes(app);

const WebSocket = require('ws');

// ─── CONFIG ────────────────────────────────────────────────────────────
const CFG = {
  MIN_BUY_USD:         2500,
  MAX_WALLET_AGE_MS:   24 * 3600_000,
  MIN_CONVERGE:        3,
  MAX_CONVERGE:        8,
  CONVERGE_WINDOW_MS:  2 * 3600_000,
  MAX_ENTRY_MCAP_USD:  150_000,        // post-migration realistic window
  MAX_ENTRY_PRICE_USD: 0.0001,         // unit price ceiling — filters tokens that already moved
  WATCH_TTL_MS:        6 * 3600_000,   // watch each migrated token for 6h
  WALLET_CACHE_TTL:    24 * 3600_000,
  SIGNAL_RETENTION_MS: 24 * 3600_000,
  POLL_INTERVAL_MS:    60_000,         // poll cycle for all watched pools
  PUMPPORTAL_WSS:      'wss://pumpportal.fun/api/data',
  DEXSCREENER_BASE:    'https://api.dexscreener.com/latest/dex',
  GECKOTERMINAL_BASE:  'https://api.geckoterminal.com/api/v2',
  GT_HEADERS:          { Accept: 'application/json;version=20230203' },
  JUPITER_QUOTE:       'https://lite-api.jup.ag/swap/v1/quote',
  SOL_PRICE_URL:       'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
  SOL_MINT:            'So11111111111111111111111111111111111111112',
  RPC_URL:             process.env.ALPHA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

// ─── NOTIFICATIONS (env-driven, no-op if unset) ────────────────────────
const NOTIFY = {
  email: {
    enabled:  !!(process.env.ALPHA_SMTP_HOST && process.env.ALPHA_SMTP_USER && process.env.ALPHA_EMAIL_TO),
    host:     process.env.ALPHA_SMTP_HOST || '',
    port:     Number(process.env.ALPHA_SMTP_PORT || 465),
    user:     process.env.ALPHA_SMTP_USER || '',
    pass:     process.env.ALPHA_SMTP_PASS || '',
    from:     process.env.ALPHA_SMTP_FROM || process.env.ALPHA_SMTP_USER || '',
    to:       process.env.ALPHA_EMAIL_TO  || '',
  },
  telegram: {
    enabled:  !!(process.env.ALPHA_TG_BOT_TOKEN && process.env.ALPHA_TG_CHAT_ID),
    token:    process.env.ALPHA_TG_BOT_TOKEN || '',
    chatId:   process.env.ALPHA_TG_CHAT_ID  || '',
  },
};

// ─── STATE ─────────────────────────────────────────────────────────────
const tokenMeta = new Map();  // mint -> { sym, name, createdAt, migratedAt }
const watched   = new Map();  // mint -> { pool, sym, name, since, lastTradeTs, entryMcap, buys: [{wallet, usd, ts}] }
const walletAge = new Map();  // wallet -> { firstTxMs, checkedAt }
const signals   = [];
let   solPriceUsd = 0;
let   solPriceTs  = 0;
let   ws = null;
let   wsRetryMs = 1000;
const status = {
  startedAt: Date.now(),
  wsConnected: false,
  newTokensSeen: 0,
  migrationsSeen: 0,
  poolsResolved: 0,
  tokensWatched: 0,
  tradesScanned: 0,
  qualifyingTrades: 0,
  walletsChecked: 0,
  freshWalletsSeen: 0,
  signalsFired: 0,
  honeypotsBlocked: 0,
  lastError: null,
};

const log  = (...a) => console.log('[alpha]', ...a);
const warn = (...a) => console.warn('[alpha]', ...a);

// ─── HELPERS ───────────────────────────────────────────────────────────
async function getSolPrice() {
  const now = Date.now();
  if (solPriceUsd > 0 && now - solPriceTs < 60_000) return solPriceUsd;
  try {
    const r = await fetch(CFG.SOL_PRICE_URL);
    const d = await r.json();
    const p = Number(d?.[CFG.SOL_MINT]?.usdPrice || 0);
    if (Number.isFinite(p) && p > 0) { solPriceUsd = p; solPriceTs = now; }
  } catch (e) { warn('sol price failed', e.message); }
  return solPriceUsd;
}

// Throttled RPC for public Solana endpoint (~4 req/sec ceiling)
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

async function getWalletFirstTxMs(wallet) {
  const cached = walletAge.get(wallet);
  if (cached && Date.now() - cached.checkedAt < CFG.WALLET_CACHE_TTL) return cached.firstTxMs;
  let before, oldestTs = 0;
  for (let i = 0; i < 5; i++) {
    let sigs;
    try {
      sigs = await rpc('getSignaturesForAddress',
        [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
    } catch {
      walletAge.set(wallet, { firstTxMs: 0, checkedAt: Date.now() });
      return 0;
    }
    if (!Array.isArray(sigs) || sigs.length === 0) break;
    const last = sigs[sigs.length - 1];
    if (last.blockTime) oldestTs = last.blockTime * 1000;
    if (sigs.length < 1000) break;
    before = last.signature;
  }
  walletAge.set(wallet, { firstTxMs: oldestTs, checkedAt: Date.now() });
  status.walletsChecked++;
  return oldestTs;
}

// ─── POOL RESOLUTION (DexScreener) ─────────────────────────────────────
async function resolvePool(mint) {
  try {
    const r = await fetch(`${CFG.DEXSCREENER_BASE}/tokens/${mint}`);
    if (!r.ok) return null;
    const d = await r.json();
    const pairs = Array.isArray(d?.pairs) ? d.pairs : [];
    const solPairs = pairs.filter(p => p.chainId === 'solana');
    if (solPairs.length === 0) return null;
    solPairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
    const best = solPairs[0];
    return {
      pool: best.pairAddress,
      sym:  best.baseToken?.symbol || '???',
      name: best.baseToken?.name   || best.baseToken?.symbol || 'Unknown',
      mcap: Number(best.fdv || best.marketCap || 0),
      priceUsd: Number(best.priceUsd || 0),
      liquidityUsd: Number(best?.liquidity?.usd || 0),
    };
  } catch { return null; }
}

// ─── TRADE POLLING (GeckoTerminal) ─────────────────────────────────────
async function pollPoolTrades(mint) {
  const w = watched.get(mint);
  if (!w) return;
  try {
    const url = `${CFG.GECKOTERMINAL_BASE}/networks/solana/pools/${w.pool}/trades`
              + `?trade_volume_in_usd_greater_than=${CFG.MIN_BUY_USD}`;
    const r = await fetch(url, { headers: CFG.GT_HEADERS });
    if (!r.ok) return;
    const d = await r.json();
    const trades = Array.isArray(d?.data) ? d.data : [];
    let newestTs = w.lastTradeTs;
    for (const tr of trades) {
      status.tradesScanned++;
      const a = tr.attributes;
      if (!a) continue;
      if (a.kind !== 'buy') continue;
      const ts = a.block_timestamp ? new Date(a.block_timestamp).getTime() : 0;
      if (!ts) continue;
      if (ts > newestTs) newestTs = ts;
      if (ts <= w.lastTradeTs) continue; // already processed in earlier poll
      const usd = Number(a.volume_in_usd || 0);
      if (!Number.isFinite(usd) || usd < CFG.MIN_BUY_USD) continue;
      const wallet = a.tx_from_address;
      if (!wallet) continue;
      status.qualifyingTrades++;

      // Wallet-age gate
      let firstTxMs = 0;
      try { firstTxMs = await getWalletFirstTxMs(wallet); } catch { continue; }
      const age = firstTxMs === 0 ? 0 : Date.now() - firstTxMs;
      if (age > CFG.MAX_WALLET_AGE_MS) continue;
      status.freshWalletsSeen++;

      const existing = w.buys.find(b => b.wallet === wallet);
      if (existing) { if (usd > existing.usd) { existing.usd = usd; existing.ts = ts; } }
      else { w.buys.push({ wallet, usd, ts }); }
    }
    w.lastTradeTs = newestTs;
    const match = evaluateMint(mint);
    if (match) await fireSignal(mint, match);
  } catch (e) { status.lastError = 'poll: ' + e.message; }
}

function evaluateMint(mint) {
  const w = watched.get(mint);
  if (!w || w.buys.length < CFG.MIN_CONVERGE) return null;
  const sorted = w.buys.slice().sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].ts;
    const inWindow = sorted.filter(b => b.ts - windowStart <= CFG.CONVERGE_WINDOW_MS);
    // One entry per wallet — keep the largest buy if a wallet appears twice
    const byWallet = new Map();
    for (const b of inWindow) {
      const prev = byWallet.get(b.wallet);
      if (!prev || b.usd > prev.usd) byWallet.set(b.wallet, b);
    }
    if (byWallet.size >= CFG.MIN_CONVERGE && byWallet.size <= CFG.MAX_CONVERGE) {
      const entries = [...byWallet.values()].sort((a, b) => b.usd - a.usd); // largest first
      return {
        buys:     entries,                              // [{wallet, usd, ts}]
        wallets:  entries.map(e => e.wallet),           // addresses (legacy)
        totalUsd: entries.reduce((s, e) => s + e.usd, 0),
        firstTs:  Math.min(...entries.map(e => e.ts)),
        lastTs:   Math.max(...entries.map(e => e.ts)),
      };
    }
  }
  return null;
}

// ─── HONEYPOT CHECK ────────────────────────────────────────────────────
async function checkHoneypot(mint) {
  const reasons = []; let safe = true;
  try {
    const acc = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const info = acc?.value?.data?.parsed?.info;
    const owner = acc?.value?.owner;
    if (info?.mintAuthority)   { safe = false; reasons.push('mint authority not renounced'); }
    if (info?.freezeAuthority) { safe = false; reasons.push('freeze authority not renounced'); }
    if (owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
      const exts = info?.extensions || [];
      for (const ex of exts) {
        if (ex.extension === 'transferHook')      { safe = false; reasons.push('transfer hook'); }
        if (ex.extension === 'permanentDelegate') { safe = false; reasons.push('permanent delegate'); }
        if (ex.extension === 'transferFeeConfig') {
          const bps = Number(ex.state?.newerTransferFee?.transferFeeBasisPoints || 0);
          if (bps > 500) { safe = false; reasons.push(`${bps/100}% transfer fee`); }
        }
      }
    }
  } catch { safe = false; reasons.push('mint info unreadable'); }

  try {
    const url = `${CFG.JUPITER_QUOTE}?inputMint=${mint}&outputMint=${CFG.SOL_MINT}&amount=1000000&slippageBps=2000`;
    const r = await fetch(url);
    if (!r.ok) { safe = false; reasons.push('no sell route'); }
    else {
      const d = await r.json();
      if (!d?.outAmount || Number(d.outAmount) <= 0) { safe = false; reasons.push('sell returns zero'); }
    }
  } catch { safe = false; reasons.push('sell sim failed'); }
  return { safe, reasons };
}

// ─── NOTIFY HELPERS ────────────────────────────────────────────────────
let _mailer = null;
function getMailer() {
  if (_mailer || !NOTIFY.email.enabled) return _mailer;
  try {
    const nodemailer = require('nodemailer');
    _mailer = nodemailer.createTransport({
      host:   NOTIFY.email.host,
      port:   NOTIFY.email.port,
      secure: NOTIFY.email.port === 465,
      auth:   { user: NOTIFY.email.user, pass: NOTIFY.email.pass },
    });
  } catch {
    warn('nodemailer not installed — run `npm install nodemailer` to enable email alerts');
    NOTIFY.email.enabled = false;
  }
  return _mailer;
}

function buildAlertText(sig) {
  const winMin = Math.round((sig.lastTs - sig.firstTs) / 60_000);
  const dx = `https://dexscreener.com/solana/${sig.pool || sig.mint}`;
  const ss = `https://solscan.io/token/${sig.mint}`;
  return {
    subject: `🎯 Alpha Signal: $${sig.symbol} — ${sig.walletCount} fresh wallets, $${sig.totalUsd.toLocaleString()}`,
    plain: [
      `Token:        $${sig.symbol} (${sig.name})`,
      `Mint:         ${sig.mint}`,
      `Entry mcap:   $${Math.round(sig.entryMcap).toLocaleString()}`,
      `Entry price:  $${sig.entryPrice}`,
      ``,
      `Fresh wallets: ${sig.walletCount}`,
      `Total in:      $${sig.totalUsd.toLocaleString()}`,
      `Window:        ${winMin} minutes`,
      ``,
      `DexScreener:  ${dx}`,
      `Solscan:      ${ss}`,
      ``,
      `Wallets:`,
      ...(sig.buys || sig.wallets.map(w => ({ wallet: w, usd: 0 })))
        .map(b => `  ${b.wallet}   $${Math.round(b.usd).toLocaleString()}`),
    ].join('\n'),
    markdown: [
      `🎯 *ALPHA SIGNAL*`,
      ``,
      `*$${sig.symbol}* — ${sig.name}`,
      `Entry mcap: $${Math.round(sig.entryMcap).toLocaleString()}`,
      `Entry price: $${sig.entryPrice}`,
      ``,
      `${sig.walletCount} fresh wallets · $${sig.totalUsd.toLocaleString()} total`,
      `Window: ${winMin} min`,
      ``,
      `[DexScreener](${dx}) · [Solscan](${ss})`,
      ``,
      `\`${sig.mint}\``,
    ].join('\n'),
  };
}

async function sendEmailAlert(sig) {
  if (!NOTIFY.email.enabled) return;
  const mailer = getMailer();
  if (!mailer) return;
  const a = buildAlertText(sig);
  try {
    await mailer.sendMail({
      from: NOTIFY.email.from,
      to:   NOTIFY.email.to,
      subject: a.subject,
      text:    a.plain,
    });
    log(`email sent → ${NOTIFY.email.to}`);
  } catch (e) { warn('email send failed:', e.message); }
}

async function sendTelegramAlert(sig) {
  if (!NOTIFY.telegram.enabled) return;
  const a = buildAlertText(sig);
  try {
    const url = `https://api.telegram.org/bot${NOTIFY.telegram.token}/sendMessage`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: NOTIFY.telegram.chatId,
        text: a.markdown,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (r.ok) log(`telegram sent → ${NOTIFY.telegram.chatId}`);
    else warn('telegram send failed:', r.status);
  } catch (e) { warn('telegram send failed:', e.message); }
}

async function notifySignal(sig) {
  await Promise.allSettled([sendEmailAlert(sig), sendTelegramAlert(sig)]);
}

// ─── FIRE ──────────────────────────────────────────────────────────────
async function fireSignal(mint, match) {
  const honey = await checkHoneypot(mint);
  if (!honey.safe) {
    status.honeypotsBlocked++;
    log(`honeypot blocked ${mint}: ${honey.reasons.join(', ')}`);
    watched.delete(mint);
    return;
  }
  const w = watched.get(mint);
  const sig = {
    mint,
    symbol:      w?.sym  || '???',
    name:        w?.name || 'Unknown',
    pool:        w?.pool,
    firedAt:     Date.now(),
    entryMcap:   w?.entryMcap  || 0,
    entryPrice:  w?.entryPrice || 0,
    wallets:     match.wallets,    // addresses (legacy / email templates)
    buys:        match.buys,       // [{wallet, usd, ts}] per-wallet detail
    walletCount: match.wallets.length,
    totalUsd:    Math.round(match.totalUsd),
    firstTs:     match.firstTs,
    lastTs:      match.lastTs,
  };
  signals.unshift(sig);
  status.signalsFired++;
  log(`🎯 SIGNAL ${sig.symbol} (${mint.slice(0,8)}…) — ${sig.walletCount} fresh, $${sig.totalUsd}, mcap $${Math.round(sig.entryMcap)}`);
  notifySignal(sig).catch(() => {});
  watched.delete(mint);
}

// ─── POLL LOOP ─────────────────────────────────────────────────────────
async function pollLoop() {
  const mints = [...watched.keys()];
  for (const mint of mints) {
    await pollPoolTrades(mint);
    await new Promise(r => setTimeout(r, 1500)); // GT rate-limit friendly
  }
}
setInterval(pollLoop, CFG.POLL_INTERVAL_MS);

setInterval(() => {
  const cutoff = Date.now() - CFG.WATCH_TTL_MS;
  for (const [mint, w] of watched) if (w.since < cutoff) watched.delete(mint);
  status.tokensWatched = watched.size;
  const sigCutoff = Date.now() - CFG.SIGNAL_RETENTION_MS;
  while (signals.length > 0 && signals[signals.length - 1].firedAt < sigCutoff) signals.pop();
  if (tokenMeta.size > 5000) {
    const keys = [...tokenMeta.keys()].slice(0, tokenMeta.size - 5000);
    for (const k of keys) tokenMeta.delete(k);
  }
}, 60_000);

// ─── ON MIGRATION → START WATCHING ────────────────────────────────────
async function onMigration(mint) {
  status.migrationsSeen++;
  if (watched.has(mint)) return;
  await new Promise(r => setTimeout(r, 5000)); // let DexScreener index
  const info = await resolvePool(mint);
  if (!info || !info.pool) return;
  status.poolsResolved++;
  if (info.mcap > 0 && info.mcap > CFG.MAX_ENTRY_MCAP_USD) return;
  if (info.priceUsd > 0 && info.priceUsd > CFG.MAX_ENTRY_PRICE_USD) return;
  watched.set(mint, {
    pool:        info.pool,
    sym:         info.sym,
    name:        info.name,
    since:       Date.now(),
    lastTradeTs: Date.now() - 5 * 60_000,
    entryMcap:   info.mcap,
    entryPrice:  info.priceUsd,
    buys:        [],
  });
  log(`▶ watching ${info.sym} (${mint.slice(0,8)}…) post-migration mcap $${Math.round(info.mcap)} px $${info.priceUsd}`);
}

// ─── PUMPPORTAL WSS (FREE STREAMS ONLY) ────────────────────────────────
function connectWs() {
  try {
    ws = new WebSocket(CFG.PUMPPORTAL_WSS);
    ws.on('open', () => {
      status.wsConnected = true;
      wsRetryMs = 1000;
      log('PumpPortal connected (free streams: new token + migration)');
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;

      // New token creation — defensive field matching
      if (m.txType === 'create' && m.mint) {
        status.newTokensSeen++;
        tokenMeta.set(m.mint, {
          sym:        m.symbol || m.ticker || '???',
          name:       m.name   || m.symbol || 'Unknown',
          createdAt:  Date.now(),
          migratedAt: 0,
        });
        return;
      }

      // Migration event — multiple shapes have been observed in the wild
      const isMigration =
        m.txType === 'migrate'   ||
        m.type   === 'migrate'   ||
        m.event  === 'migration' ||
        m.txType === 'migration' ||
        (m.pool && m.mint && !m.traderPublicKey);
      if (isMigration) {
        const mint = m.mint || m.tokenMint || m.token || m.ca;
        if (mint) {
          const meta = tokenMeta.get(mint);
          if (meta) meta.migratedAt = Date.now();
          onMigration(mint).catch(e => { status.lastError = 'migration: ' + e.message; });
        }
      }
    });
    ws.on('close', () => {
      status.wsConnected = false;
      warn(`PumpPortal closed, retry in ${wsRetryMs}ms`);
      setTimeout(connectWs, wsRetryMs);
      wsRetryMs = Math.min(wsRetryMs * 2, 30_000);
    });
    ws.on('error', (e) => { status.lastError = 'ws: ' + e.message; });
  } catch (e) {
    status.lastError = 'ws connect: ' + e.message;
    setTimeout(connectWs, 5_000);
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  getSolPrice().catch(() => {});
  setInterval(getSolPrice, 60_000);
  connectWs();
  log('alpha-watcher started (free endpoints only)');
}

function mountRoutes(app) {
  app.get('/api/alpha/signals', (req, res) => {
    res.json({ signals: signals.slice(0, 50), count: signals.length, ts: Date.now() });
  });
  app.get('/api/alpha/status', (req, res) => {
    res.json({
      ...status,
      tokensWatched: watched.size,
      solPrice: solPriceUsd,
      uptimeMs: Date.now() - status.startedAt,
      config: {
        minBuyUsd:         CFG.MIN_BUY_USD,
        maxWalletAgeH:     CFG.MAX_WALLET_AGE_MS / 3600_000,
        minConverge:       CFG.MIN_CONVERGE,
        maxConverge:       CFG.MAX_CONVERGE,
        convergeWindowH:   CFG.CONVERGE_WINDOW_MS / 3600_000,
        maxEntryMcapUsd:   CFG.MAX_ENTRY_MCAP_USD,
        maxEntryPriceUsd:  CFG.MAX_ENTRY_PRICE_USD,
      },
      notify: {
        emailEnabled:    NOTIFY.email.enabled,
        telegramEnabled: NOTIFY.telegram.enabled,
      },
    });
  });
}

start();
module.exports = { mountRoutes, start, _state: { watched, signals, status, tokenMeta } };
 