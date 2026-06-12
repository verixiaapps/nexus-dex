// alpha-watcher.js — Funder-based convergence detector.
//
// Detection in plain words:
//   We watch tokens that just graduated pump.fun → Raydium. For every buy
//   between $3k and $100k by a wallet under 24h old, we trace where that
//   wallet got its first SOL from (the "funder"). We classify the funder
//   as either smart money (a wallet on our watchlist), a labeled CEX, or
//   other. Then we fire under exactly two conditions:
//
//     A. SMART MONEY HIT — 2+ fresh wallets in a 2h window were funded
//        by wallets on our smart-money watchlist. This is the pattern.
//
//     B. CEX DIVERSITY — 3+ fresh wallets in a 2h window were funded
//        from 3+ different labeled CEXs. Real independent actors.
//
//   Hard disqualifiers:
//     • 3+ fresh wallets all funded by the same source → sybil, kill.
//     • Honeypot check fails → silently drop, never shown to users.
//     • Entry mcap > $150k or unit price already moved → already late.
//
//   Self-improvement: any token that 25x's from where we caught it has
//   its earliest buyers' funders harvested into the smart-money list.
//   The system learns what smart money looks like over time.
//
// Wire-up:
//   const alpha = require('./alpha-watcher');
//   alpha.mountRoutes(app);   // also starts the watcher

const fs   = require('fs');
const path = require('path');

// WebSocket: prefer native (Node 22+), fall back to `ws` if installed,
// degrade gracefully if neither. The watcher's HTTP routes keep working
// regardless — only the live PumpPortal feed needs WebSocket.
let WebSocketCtor = null;
let wsSource = 'none';
if (typeof globalThis.WebSocket === 'function') {
  WebSocketCtor = globalThis.WebSocket;
  wsSource = 'native';
} else {
  try { WebSocketCtor = require('ws'); wsSource = 'ws-package'; }
  catch { /* will warn at start() */ }
}

// ─── CONFIG ────────────────────────────────────────────────────────────
const CFG = {
  MIN_BUY_USD:         3000,
  MAX_BUY_USD:         100_000,
  MAX_WALLET_AGE_MS:   24 * 3600_000,
  CONVERGE_WINDOW_MS:  2 * 3600_000,
  MAX_ENTRY_MCAP_USD:  150_000,
  MAX_ENTRY_PRICE_USD: 0.0001,
  WATCH_TTL_MS:        6 * 3600_000,
  SIGNAL_RETENTION_MS: 24 * 3600_000,
  POLL_INTERVAL_MS:    60_000,
  HARVEST_INTERVAL_MS: 10 * 60_000,
  HARVEST_MULTIPLE:    25,
  HARVEST_MAX_AGE_MS:  72 * 3600_000,
  FUNDER_NULL_TTL_MS:  60 * 60_000,    // retry unresolvable funders hourly
  CACHE_MAX:           50_000,          // hard cap on funderCache / walletAge entries
  PUMPPORTAL_WSS:      'wss://pumpportal.fun/api/data',
  DEXSCREENER_BASE:    'https://api.dexscreener.com/latest/dex',
  GECKOTERMINAL_BASE:  'https://api.geckoterminal.com/api/v2',
  GT_HEADERS:          { Accept: 'application/json;version=20230203' },
  JUPITER_QUOTE:       'https://lite-api.jup.ag/swap/v1/quote',
  SOL_PRICE_URL:       'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112',
  SOL_MINT:            'So11111111111111111111111111111111111111112',
  RPC_URL:             process.env.ALPHA_RPC_URL || 'https://api.mainnet-beta.solana.com',
};

const RULES = {
  SMART_MONEY_MIN_HITS:      2,
  CEX_DIVERSITY_MIN_WALLETS: 3,
  CEX_DIVERSITY_MIN_SOURCES: 3,
  SAME_FUNDER_KILL:          3,
};

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────
const NOTIFY = {
  email: {
    enabled: !!(process.env.ALPHA_SMTP_HOST && process.env.ALPHA_SMTP_USER && process.env.ALPHA_EMAIL_TO),
    host: process.env.ALPHA_SMTP_HOST || '',
    port: Number(process.env.ALPHA_SMTP_PORT || 465),
    user: process.env.ALPHA_SMTP_USER || '',
    pass: process.env.ALPHA_SMTP_PASS || '',
    from: process.env.ALPHA_SMTP_FROM || process.env.ALPHA_SMTP_USER || '',
    to:   process.env.ALPHA_EMAIL_TO  || '',
  },
  telegram: {
    enabled: !!(process.env.ALPHA_TG_BOT_TOKEN && process.env.ALPHA_TG_CHAT_ID),
    token: process.env.ALPHA_TG_BOT_TOKEN || '',
    chatId: process.env.ALPHA_TG_CHAT_ID || '',
  },
};

// ─── PERSISTED LISTS ───────────────────────────────────────────────────
const DATA_DIR   = __dirname;
const SMART_PATH = path.join(DATA_DIR, 'smart-money.json');

// CEX hot wallets — inlined. Extend this list from Solscan's labeled accounts
// (https://solscan.io → Labels). Multiple addresses can share an exchange name
// since the diversity rule keys on the name, not the address. The more complete
// this list, the stronger the CEX-diversity signal.
const CEX_LABELS = new Map([
  // Binance
  ['2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', 'Binance'],
  ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Binance'],
  ['5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'Binance'],
  // Coinbase
  ['H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', 'Coinbase'],
  ['9obNtb7GDoyZyMaXyME5JsbF1uBjsT5SkLDXKMyNzAv5', 'Coinbase'],
  // Kraken
  ['FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', 'Kraken'],
  // OKX
  ['5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', 'OKX'],
]);

const SMART_MONEY = new Set();
const SMART_ADDED = {};

function log(...a)  { console.log('[alpha]', ...a); }
function warn(...a) { console.warn('[alpha]', ...a); }

function loadSmartMoney() {
  try {
    const raw = JSON.parse(fs.readFileSync(SMART_PATH, 'utf8'));
    for (const w of (raw.wallets || [])) SMART_MONEY.add(w);
    Object.assign(SMART_ADDED, raw.added || {});
    log(`loaded ${SMART_MONEY.size} smart money wallets`);
  } catch { /* first run — file gets created on first save */ }
}

function saveSmartMoney() {
  const payload = {
    _comment: 'Auto-managed by alpha-watcher. Add wallets manually under "wallets" if desired — preserved across saves.',
    wallets: [...SMART_MONEY],
    added: SMART_ADDED,
  };
  try {
    const tmp = SMART_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, SMART_PATH);
  } catch (e) { warn('save smart money failed:', e.message); }
}

function addSmartMoney(wallet, reason) {
  if (!wallet || SMART_MONEY.has(wallet)) return false;
  SMART_MONEY.add(wallet);
  SMART_ADDED[wallet] = { ts: Date.now(), ...reason };
  saveSmartMoney();
  log(`+ smart money: ${wallet.slice(0,6)}…${wallet.slice(-4)} (${reason?.from || 'manual'})`);
  return true;
}

// ─── STATE ─────────────────────────────────────────────────────────────
const tokenMeta    = new Map();
const watched      = new Map();
const walletAge    = new Map();
const funderCache  = new Map();
const harvestQueue = new Map();
const signals      = [];
let   solPriceUsd = 0;
let   solPriceTs  = 0;
let   ws = null;
let   wsRetryMs = 1000;

const status = {
  startedAt: Date.now(),
  wsConnected: false,
  newTokensSeen: 0, migrationsSeen: 0, poolsResolved: 0,
  tokensWatched: 0, tradesScanned: 0, qualifyingTrades: 0,
  walletsChecked: 0, freshWalletsSeen: 0, fundersResolved: 0,
  smartMoneyHits: 0, cexHits: 0,
  signalsFired: 0, honeypotsBlocked: 0, sybilsBlocked: 0,
  runnersHarvested: 0,
  lastError: null,
};

const _stateWrite = { lastSuccessAt: 0, lastWrittenDirs: [], lastErrorAt: 0, lastError: null, writeCount: 0 };

// ─── RPC THROTTLING ────────────────────────────────────────────────────
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

// ─── WALLET AGE ────────────────────────────────────────────────────────
async function getWalletFirstTxMs(wallet) {
  const cached = walletAge.get(wallet);
  if (cached && Date.now() - cached.checkedAt < CFG.WATCH_TTL_MS) return cached.firstTxMs;
  let before, oldestTs = 0, oldestSig = null;
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
    if (last.blockTime) { oldestTs = last.blockTime * 1000; oldestSig = last.signature; }
    if (sigs.length < 1000) break;
    before = last.signature;
  }
  walletAge.set(wallet, { firstTxMs: oldestTs, checkedAt: Date.now(), oldestSig });
  status.walletsChecked++;
  return oldestTs;
}

// ─── FUNDER TRACE ──────────────────────────────────────────────────────
// Returns the address that sent this wallet its first SOL, or null.
// Resolved (non-null) results cached forever; nulls cached briefly so we
// retry transient RPC failures without hammering on every poll.
async function getFunderOf(wallet) {
  const cached = funderCache.get(wallet);
  if (cached) {
    if (cached.funder)                                 return cached.funder;
    if (Date.now() - cached.ts < CFG.FUNDER_NULL_TTL_MS) return null;
  }
  let oldestSig = walletAge.get(wallet)?.oldestSig;
  if (!oldestSig) {
    await getWalletFirstTxMs(wallet);
    oldestSig = walletAge.get(wallet)?.oldestSig;
  }
  if (!oldestSig) { funderCache.set(wallet, { funder: null, ts: Date.now() }); return null; }

  let tx;
  try {
    tx = await rpc('getTransaction', [oldestSig, {
      maxSupportedTransactionVersion: 0, encoding: 'jsonParsed',
    }]);
  } catch { funderCache.set(wallet, { funder: null, ts: Date.now() }); return null; }
  if (!tx) { funderCache.set(wallet, { funder: null, ts: Date.now() }); return null; }

  const setAndReturn = (src) => {
    funderCache.set(wallet, { funder: src, ts: Date.now() });
    if (src) status.fundersResolved++;
    return src;
  };

  // 1. Explicit system-program SOL transfer where wallet was destination
  const msg = tx?.transaction?.message;
  const instructions = msg?.instructions || [];
  for (const ix of instructions) {
    if (ix?.program === 'system' && ix?.parsed?.type === 'transfer' &&
        ix?.parsed?.info?.destination === wallet) {
      return setAndReturn(ix.parsed.info.source);
    }
  }

  // 2. Balance-delta fallback for non-standard tx shapes (CEX withdrawals etc)
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
    if (bestIdx >= 0) return setAndReturn(accountKeys[bestIdx]);
  }

  return setAndReturn(null);
}

function classifyFunder(funder) {
  if (!funder) return { kind: 'unknown', label: null };
  if (SMART_MONEY.has(funder)) return { kind: 'smart', label: 'smart money' };
  const cex = CEX_LABELS.get(funder);
  if (cex) return { kind: 'cex', label: cex };
  return { kind: 'other', label: null };
}

// ─── POOL RESOLUTION ───────────────────────────────────────────────────
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
    };
  } catch { return null; }
}

// ─── TRADE POLLING ─────────────────────────────────────────────────────
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
      if (!a || a.kind !== 'buy') continue;
      const ts = a.block_timestamp ? new Date(a.block_timestamp).getTime() : 0;
      if (!ts) continue;
      if (ts > newestTs) newestTs = ts;
      if (ts <= w.lastTradeTs) continue;
      const usd = Number(a.volume_in_usd || 0);
      if (!Number.isFinite(usd) || usd < CFG.MIN_BUY_USD || usd > CFG.MAX_BUY_USD) continue;
      const wallet = a.tx_from_address;
      if (!wallet) continue;
      status.qualifyingTrades++;

      let firstTxMs = 0;
      try { firstTxMs = await getWalletFirstTxMs(wallet); } catch { continue; }
      if (firstTxMs === 0) continue;
      if (Date.now() - firstTxMs > CFG.MAX_WALLET_AGE_MS) continue;
      status.freshWalletsSeen++;

      const funder = await getFunderOf(wallet).catch(() => null);
      const cls = classifyFunder(funder);
      if (cls.kind === 'smart') status.smartMoneyHits++;
      else if (cls.kind === 'cex') status.cexHits++;

      const entry = { wallet, usd, ts, funder, funderKind: cls.kind, funderLabel: cls.label };
      const existing = w.buys.find(b => b.wallet === wallet);
      if (existing) { if (usd > existing.usd) Object.assign(existing, entry); }
      else { w.buys.push(entry); }
    }
    w.lastTradeTs = newestTs;
    const match = evaluateMint(mint);
    if (match) await fireSignal(mint, match);
  } catch (e) { status.lastError = 'poll: ' + e.message; }
}

// ─── EVALUATION (the actual filter) ────────────────────────────────────
function evaluateMint(mint) {
  const w = watched.get(mint);
  if (!w || w.buys.length < 2) return null;
  const sorted = w.buys.slice().sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].ts;
    const inWindow = sorted.filter(b => b.ts - windowStart <= CFG.CONVERGE_WINDOW_MS);

    const byWallet = new Map();
    for (const b of inWindow) {
      const prev = byWallet.get(b.wallet);
      if (!prev || b.usd > prev.usd) byWallet.set(b.wallet, b);
    }
    const entries = [...byWallet.values()];

    // sybil disqualifier
    const bySrc = new Map();
    for (const e of entries) {
      if (!e.funder) continue;
      bySrc.set(e.funder, (bySrc.get(e.funder) || 0) + 1);
    }
    const maxSameSource = Math.max(0, ...bySrc.values());
    if (maxSameSource >= RULES.SAME_FUNDER_KILL) {
      status.sybilsBlocked++;
      continue;
    }

    // Rule A — smart money
    const smart = entries.filter(e => e.funderKind === 'smart');
    if (smart.length >= RULES.SMART_MONEY_MIN_HITS) {
      return buildMatch(entries, 'smart-money', { smartMoneyHits: smart.length });
    }

    // Rule B — diverse CEX origins
    const cexLabels  = new Set(entries.filter(e => e.funderKind === 'cex').map(e => e.funderLabel));
    const cexWallets = entries.filter(e => e.funderKind === 'cex').length;
    if (cexWallets >= RULES.CEX_DIVERSITY_MIN_WALLETS &&
        cexLabels.size >= RULES.CEX_DIVERSITY_MIN_SOURCES) {
      return buildMatch(entries, 'cex-diverse', { cexSources: [...cexLabels] });
    }
  }
  return null;
}

function buildMatch(entries, trigger, extras) {
  const sorted = entries.slice().sort((a, b) => b.usd - a.usd);
  return {
    buys: sorted,
    wallets: sorted.map(e => e.wallet),
    totalUsd: sorted.reduce((s, e) => s + e.usd, 0),
    firstTs: Math.min(...sorted.map(e => e.ts)),
    lastTs:  Math.max(...sorted.map(e => e.ts)),
    trigger,
    ...extras,
  };
}

// ─── HONEYPOT (silent filter — blocked tokens never reach signals[]) ──
async function checkHoneypot(mint) {
  const reasons = []; let safe = true;
  try {
    const acc = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const info  = acc?.value?.data?.parsed?.info;
    const owner = acc?.value?.owner;
    if (info?.mintAuthority)   { safe = false; reasons.push('mint auth not renounced'); }
    if (info?.freezeAuthority) { safe = false; reasons.push('freeze auth not renounced'); }
    if (owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
      for (const ex of (info?.extensions || [])) {
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

// ─── NOTIFY ────────────────────────────────────────────────────────────
let _mailer = null;
function getMailer() {
  if (_mailer || !NOTIFY.email.enabled) return _mailer;
  try {
    const nodemailer = require('nodemailer');
    _mailer = nodemailer.createTransport({
      host: NOTIFY.email.host, port: NOTIFY.email.port,
      secure: NOTIFY.email.port === 465,
      auth: { user: NOTIFY.email.user, pass: NOTIFY.email.pass },
    });
  } catch { warn('nodemailer not installed — `npm i nodemailer` for email'); NOTIFY.email.enabled = false; }
  return _mailer;
}

function buildAlertText(sig) {
  const winMin = Math.round((sig.lastTs - sig.firstTs) / 60_000);
  const dx = `https://dexscreener.com/solana/${sig.pool || sig.mint}`;
  const ss = `https://solscan.io/token/${sig.mint}`;
  const tag = sig.trigger === 'smart-money' ? 'SMART MONEY' : 'CEX DIVERSE';
  const triggerLine = sig.trigger === 'smart-money'
    ? `Trigger: SMART MONEY (${sig.smartMoneyHits} hits)`
    : `Trigger: CEX DIVERSITY (${(sig.cexSources || []).join(', ')})`;
  return {
    subject: `🎯 ${tag}: $${sig.symbol} — ${sig.walletCount} wallets, $${sig.totalUsd.toLocaleString()}`,
    plain: [
      `Token:        $${sig.symbol} (${sig.name})`,
      `Mint:         ${sig.mint}`,
      triggerLine,
      `Entry mcap:   $${Math.round(sig.entryMcap).toLocaleString()}`,
      `Fresh wallets: ${sig.walletCount}`,
      `Total in:      $${sig.totalUsd.toLocaleString()}`,
      `Window:        ${winMin} min`,
      ``,
      `DexScreener:  ${dx}`,
      `Solscan:      ${ss}`,
      ``,
      `Wallets:`,
      ...sig.buys.map(b => `  ${b.wallet}  $${Math.round(b.usd).toLocaleString()}  ← ${b.funderLabel || b.funderKind}`),
    ].join('\n'),
    markdown: [
      `🎯 *${tag}*`, ``,
      `*$${sig.symbol}* — ${sig.name}`,
      `Entry mcap: $${Math.round(sig.entryMcap).toLocaleString()}`,
      triggerLine, ``,
      `${sig.walletCount} fresh wallets · $${sig.totalUsd.toLocaleString()} total · ${winMin}m window`, ``,
      `[DexScreener](${dx}) · [Solscan](${ss})`, ``,
      `\`${sig.mint}\``,
    ].join('\n'),
  };
}

async function sendEmailAlert(sig) {
  if (!NOTIFY.email.enabled) return;
  const mailer = getMailer();
  if (!mailer) return;
  const a = buildAlertText(sig);
  try { await mailer.sendMail({ from: NOTIFY.email.from, to: NOTIFY.email.to, subject: a.subject, text: a.plain }); log(`email → ${NOTIFY.email.to}`); }
  catch (e) { warn('email failed:', e.message); }
}
async function sendTelegramAlert(sig) {
  if (!NOTIFY.telegram.enabled) return;
  const a = buildAlertText(sig);
  try {
    const r = await fetch(`https://api.telegram.org/bot${NOTIFY.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: NOTIFY.telegram.chatId, text: a.markdown, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
    if (r.ok) log(`tg → ${NOTIFY.telegram.chatId}`); else warn('tg:', r.status);
  } catch (e) { warn('tg failed:', e.message); }
}
async function notifySignal(sig) { await Promise.allSettled([sendEmailAlert(sig), sendTelegramAlert(sig)]); }

// ─── FIRE ──────────────────────────────────────────────────────────────
async function fireSignal(mint, match) {
  const honey = await checkHoneypot(mint);
  if (!honey.safe) {
    status.honeypotsBlocked++;
    log(`[silent] ${mint.slice(0,8)}… honeypot: ${honey.reasons.join(', ')}`);
    watched.delete(mint);
    return;
  }
  const w = watched.get(mint);
  const sig = {
    mint,
    symbol: w?.sym || '???', name: w?.name || 'Unknown', pool: w?.pool,
    firedAt: Date.now(),
    entryMcap: w?.entryMcap || 0, entryPrice: w?.entryPrice || 0,
    trigger: match.trigger,
    smartMoneyHits: match.smartMoneyHits || 0,
    cexSources: match.cexSources || [],
    wallets: match.wallets, buys: match.buys,
    walletCount: match.wallets.length,
    totalUsd: Math.round(match.totalUsd),
    firstTs: match.firstTs, lastTs: match.lastTs,
  };
  signals.unshift(sig);
  status.signalsFired++;
  harvestQueue.set(mint, { entryMcap: sig.entryMcap, firedAt: sig.firedAt, pool: sig.pool });
  log(`🎯 ${sig.trigger.toUpperCase()} ${sig.symbol} (${mint.slice(0,8)}…) — ${sig.walletCount}w, $${sig.totalUsd}, mcap $${Math.round(sig.entryMcap)}`);
  notifySignal(sig).catch(() => {});
  watched.delete(mint);
}

// ─── HARVEST 25x RUNNERS → smart money ─────────────────────────────────
async function harvestRunners() {
  for (const [mint, h] of harvestQueue) {
    if (Date.now() - h.firedAt > CFG.HARVEST_MAX_AGE_MS) { harvestQueue.delete(mint); continue; }
    try {
      const r = await fetch(`${CFG.DEXSCREENER_BASE}/tokens/${mint}`);
      if (!r.ok) continue;
      const d = await r.json();
      const pair = (d?.pairs || []).find(p => p.chainId === 'solana' && p.pairAddress === h.pool)
                || (d?.pairs || []).find(p => p.chainId === 'solana');
      const currentMcap = Number(pair?.fdv || pair?.marketCap || 0);
      if (currentMcap <= 0 || h.entryMcap <= 0) continue;
      const multiple = currentMcap / h.entryMcap;
      if (multiple < CFG.HARVEST_MULTIPLE) continue;

      log(`🌾 ${mint.slice(0,8)}… ran ${multiple.toFixed(1)}x — harvesting funders`);
      const tradesR = await fetch(
        `${CFG.GECKOTERMINAL_BASE}/networks/solana/pools/${h.pool}/trades?trade_volume_in_usd_greater_than=${CFG.MIN_BUY_USD}`,
        { headers: CFG.GT_HEADERS },
      );
      if (!tradesR.ok) { harvestQueue.delete(mint); continue; }
      const tradesJson = await tradesR.json();
      const earlyBuys = (tradesJson.data || [])
        .map(t => t.attributes)
        .filter(a => a && a.kind === 'buy' && a.tx_from_address)
        .sort((a, b) => new Date(a.block_timestamp) - new Date(b.block_timestamp))
        .slice(0, 30);
      let added = 0;
      for (const a of earlyBuys) {
        const funder = await getFunderOf(a.tx_from_address).catch(() => null);
        if (!funder) continue;
        if (CEX_LABELS.has(funder)) continue;
        if (addSmartMoney(funder, { from: mint, ts: Date.now(), via: a.tx_from_address, multiple: multiple.toFixed(1) })) added++;
      }
      status.runnersHarvested++;
      log(`🌾 +${added} smart-money wallets from ${mint.slice(0,8)}…`);
      harvestQueue.delete(mint);
    } catch (e) { warn('harvest:', e.message); }
  }
}
setInterval(() => { harvestRunners().catch(() => {}); }, CFG.HARVEST_INTERVAL_MS);

// ─── HOUSEKEEPING ──────────────────────────────────────────────────────
async function pollLoop() {
  const mints = [...watched.keys()];
  for (const mint of mints) {
    await pollPoolTrades(mint);
    await new Promise(r => setTimeout(r, 1500));
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
  // Cap unbounded wallet / funder caches — drop oldest entries first
  for (const cache of [walletAge, funderCache]) {
    if (cache.size > CFG.CACHE_MAX) {
      const drop = cache.size - CFG.CACHE_MAX;
      const it = cache.keys();
      for (let i = 0; i < drop; i++) cache.delete(it.next().value);
    }
  }
}, 60_000);

// ─── MIGRATION → START WATCHING ────────────────────────────────────────
async function onMigration(mint) {
  status.migrationsSeen++;
  if (watched.has(mint)) return;
  await new Promise(r => setTimeout(r, 5000));
  const info = await resolvePool(mint);
  if (!info?.pool) return;
  status.poolsResolved++;
  if (info.mcap > 0     && info.mcap     > CFG.MAX_ENTRY_MCAP_USD)  return;
  if (info.priceUsd > 0 && info.priceUsd > CFG.MAX_ENTRY_PRICE_USD) return;
  watched.set(mint, {
    pool: info.pool, sym: info.sym, name: info.name,
    since: Date.now(), lastTradeTs: Date.now() - 5 * 60_000,
    entryMcap: info.mcap, entryPrice: info.priceUsd,
    buys: [],
  });
  log(`▶ ${info.sym} (${mint.slice(0,8)}…) mcap $${Math.round(info.mcap)} px $${info.priceUsd}`);
}

// ─── WSS ───────────────────────────────────────────────────────────────
function connectWs() {
  if (!WebSocketCtor) {
    warn('WebSocket unavailable. Install `ws` or upgrade to Node 22+ for the live feed. Routes keep working in degraded mode.');
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
    try {
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    } catch (e) { warn('subscribe send failed:', e.message); }
  };
  const onMessage = (raw) => {
    let m; try { m = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.txType === 'create' && m.mint) {
      status.newTokensSeen++;
      tokenMeta.set(m.mint, { sym: m.symbol || m.ticker || '???', name: m.name || m.symbol || 'Unknown', createdAt: Date.now(), migratedAt: 0 });
      return;
    }
    const isMigration =
      m.txType === 'migrate' || m.type === 'migrate' || m.event === 'migration' ||
      m.txType === 'migration' || (m.pool && m.mint && !m.traderPublicKey);
    if (isMigration) {
      const mint = m.mint || m.tokenMint || m.token || m.ca;
      if (mint) {
        const meta = tokenMeta.get(mint); if (meta) meta.migratedAt = Date.now();
        onMigration(mint).catch(e => { status.lastError = 'migration: ' + e.message; });
      }
    }
  };
  const onClose = () => {
    status.wsConnected = false;
    warn(`PumpPortal closed, retry ${wsRetryMs}ms`);
    setTimeout(connectWs, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 30_000);
  };
  const onError = (e) => { status.lastError = 'ws: ' + (e?.message || 'error'); };

  if (typeof ws.on === 'function') {
    // ws package (EventEmitter)
    ws.on('open', onOpen);
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
  } else {
    // native WebSocket
    ws.onopen    = onOpen;
    ws.onmessage = (ev) => onMessage(ev.data);
    ws.onclose   = onClose;
    ws.onerror   = onError;
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  loadSmartMoney();
  getSolPrice().catch(() => {});
  setInterval(getSolPrice, 60_000);
  connectWs();
  startStateFileWriter();
  log(`alpha-watcher started · ${CEX_LABELS.size} CEX labels, ${SMART_MONEY.size} smart-money wallets`);
}

// ─── STATE PAYLOAD ─────────────────────────────────────────────────────
function buildStatePayload() {
  return {
    ts: Date.now(),
    ...status,
    tokensWatched: watched.size,
    smartMoneyCount: SMART_MONEY.size,
    cexLabelCount:   CEX_LABELS.size,
    harvestQueueSize: harvestQueue.size,
    solPrice: solPriceUsd,
    uptimeMs: Date.now() - status.startedAt,
    config: {
      minBuyUsd: CFG.MIN_BUY_USD,
      maxBuyUsd: CFG.MAX_BUY_USD,
      maxWalletAgeH: CFG.MAX_WALLET_AGE_MS / 3600_000,
      convergeWindowH: CFG.CONVERGE_WINDOW_MS / 3600_000,
      maxEntryMcapUsd: CFG.MAX_ENTRY_MCAP_USD,
      maxEntryPriceUsd: CFG.MAX_ENTRY_PRICE_USD,
      rules: RULES,
    },
    notify: { emailEnabled: NOTIFY.email.enabled, telegramEnabled: NOTIFY.telegram.enabled },
    signals: signals.slice(0, 50),
    signalCount: signals.length,
  };
}

// ─── STATIC STATE FILE (fallback only) ─────────────────────────────────
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
    if (written.length > 0) { _stateWrite.lastSuccessAt = Date.now(); _stateWrite.lastWrittenDirs = written; _stateWrite.writeCount++; }
    else { _stateWrite.lastErrorAt = Date.now(); _stateWrite.lastError = lastErr || 'no writable dir'; }
  };
  write();
  setInterval(write, 5000);
}

// ─── ROUTES ────────────────────────────────────────────────────────────
function mountRoutes(app) {
  // What the frontend polls
  app.get('/alpha-state.json', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(buildStatePayload());
  });

  // Same payload, /api/ route
  app.get('/api/alpha/status', (req, res) => res.json(buildStatePayload()));

  // Fired signals only
  app.get('/api/alpha/signals', (req, res) => {
    res.json({ signals: signals.slice(0, 50), count: signals.length, ts: Date.now() });
  });

  // Read-only view of what the system has caught (auto-harvested only)
  app.get('/api/alpha/smart-money', (req, res) => {
    res.json({ count: SMART_MONEY.size, wallets: [...SMART_MONEY], added: SMART_ADDED });
  });

  // Diagnostic — internal state, scrubbed
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
        walletCache: walletAge.size, funderCache: funderCache.size,
        smartMoney: SMART_MONEY.size, cexLabels: CEX_LABELS.size,
        harvestQueue: harvestQueue.size,
      },
      rpc: { url: CFG.RPC_URL.replace(/api-key=[^&]+/i, 'api-key=***'), inFlight: rpcInFlight, queued: rpcQueue.length },
      rules: RULES,
      websocket: { source: wsSource, connected: status.wsConnected },
      notify: { emailEnabled: NOTIFY.email.enabled, telegramEnabled: NOTIFY.telegram.enabled },
    });
  });

  start();
}

module.exports = { mountRoutes, start, addSmartMoney, _state: { watched, signals, status, SMART_MONEY, CEX_LABELS } };
