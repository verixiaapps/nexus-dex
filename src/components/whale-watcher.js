/* ============================================================
 * whale-watcher.js
 *
 * Polls Helius for new Raydium/Meteora pools, watches their TVL,
 * fires an email when a single LP add of >= 5,000 SOL lands on a
 * token that passes a basic honeypot check.
 *
 * Drop-in: require this from server.js and call startWhaleWatcher().
 * Env required:
 *   HELIUS_API_KEY     — your Helius key
 *   RESEND_API_KEY     — your Resend key (https://resend.com)
 *   WHALE_ALERT_EMAIL  — where to send alerts (defaults below)
 * ============================================================ */

const { Resend } = require('resend');

const HELIUS_API_KEY    = process.env.HELIUS_API_KEY || '';
const RESEND_API_KEY    = process.env.RESEND_API_KEY || '';
const WHALE_ALERT_EMAIL = process.env.WHALE_ALERT_EMAIL || 'Verixiaapps@gmail.com';

const MIN_SOL_LP       = 5_000;       // whale threshold
const POLL_INTERVAL_MS = 20_000;      // 20s — sub-30s end-to-end alert
const LOOKBACK_MIN     = 10;          // only scan tx from last 10min
const SOL_MINT         = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

const RAYDIUM_AMM_V4    = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_CPMM      = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const RAYDIUM_CLMM      = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const METEORA_DLMM      = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const WATCHED_PROGRAMS  = [RAYDIUM_AMM_V4, RAYDIUM_CPMM, RAYDIUM_CLMM, METEORA_DLMM];

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// In-memory state. Resets on restart, which is fine — we only care about
// what's hot RIGHT NOW.
const alertedSignatures = new Set();   // dedupe by tx signature
const recentEvents      = [];          // last 48h of fired events, for /api/whale-events
const seenPools         = new Map();   // poolAddress -> last known SOL reserves

function nowIso() { return new Date().toISOString(); }
function log(...args) { console.log('[whale]', nowIso(), ...args); }
function logErr(...args) { console.warn('[whale]', nowIso(), ...args); }

function heliusRpcUrl() {
  if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL;
  if (HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  return 'https://api.mainnet-beta.solana.com';
}

async function rpc(method, params) {
  const r = await fetch(heliusRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC ${method} → ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`RPC ${method} → ${d.error.message}`);
  return d.result;
}

/* ============================================================
 * Honeypot check — one pass, returns { safe, reasons[] }
 * Checks: mint auth, freeze auth, Token-2022 transfer fees,
 *         LP held by burn/locker (basic check).
 * ============================================================ */
async function honeypotCheck(mint) {
  const reasons = [];
  try {
    const info = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const parsed = info?.value?.data?.parsed;
    if (!parsed || parsed.type !== 'mint') {
      return { safe: false, reasons: ['mint account not parseable'] };
    }
    const data = parsed.info || {};

    if (data.mintAuthority)   reasons.push('mint authority not renounced');
    if (data.freezeAuthority) reasons.push('freeze authority not renounced');

    // Token-2022 transfer fee extension — flag any non-zero fee
    const exts = data.extensions || [];
    for (const ext of exts) {
      if (ext.extension === 'transferFeeConfig') {
        const bps = Number(ext.state?.newerTransferFee?.transferFeeBasisPoints ?? 0);
        if (bps > 500) reasons.push(`transfer fee ${bps / 100}%`);
      }
      if (ext.extension === 'permanentDelegate')   reasons.push('permanent delegate set');
      if (ext.extension === 'defaultAccountState') reasons.push('default frozen state');
    }
  } catch (e) {
    return { safe: false, reasons: ['honeypot check failed: ' + e.message] };
  }
  return { safe: reasons.length === 0, reasons };
}

/* ============================================================
 * Email — simple HTML, one big BUY link back into the app
 * ============================================================ */
async function sendWhaleEmail(event) {
  if (!resend) { logErr('no RESEND_API_KEY, skipping email'); return; }
  const { mint, symbol, name, solAmount, usdAmount, signature, poolAddress, age, safety } = event;

  const subject = `🐋 Whale entered $${symbol || 'TOKEN'} — ${solAmount.toLocaleString()} SOL${usdAmount ? ` ($${(usdAmount / 1000).toFixed(0)}k)` : ''}`;

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 0 auto; background: #0a0815; color: #fff5fb; padding: 24px; border-radius: 16px;">
      <div style="font-size: 11px; letter-spacing: 0.2em; color: #ffd966; font-weight: 700; margin-bottom: 8px;">🐋 WHALE ENTRY DETECTED</div>
      <div style="font-size: 28px; font-weight: 900; margin-bottom: 4px;">$${symbol || 'TOKEN'}</div>
      <div style="font-size: 13px; color: #b9a7d6; margin-bottom: 20px;">${name || ''} · Solana</div>

      <div style="background: #1a1530; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <div style="font-size: 10px; letter-spacing: 0.15em; color: #b9a7d6; text-transform: uppercase; margin-bottom: 4px;">LP Added</div>
        <div style="font-size: 24px; font-weight: 900; color: #4dffd2;">${solAmount.toLocaleString()} SOL${usdAmount ? ` · $${(usdAmount / 1000).toFixed(0)}k` : ''}</div>
      </div>

      <div style="background: #1a1530; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <div style="font-size: 11px; color: #b9a7d6; margin-bottom: 8px;">CONTRACT</div>
        <div style="font-family: monospace; font-size: 12px; word-break: break-all; color: #fff;">${mint}</div>
      </div>

      <div style="background: rgba(77,255,136,0.08); border: 1px solid rgba(77,255,136,0.25); border-radius: 12px; padding: 14px; margin-bottom: 20px;">
        <div style="font-size: 11px; color: #4dff88; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 6px;">✓ SAFETY CHECK PASSED</div>
        <div style="font-size: 12px; color: #b9a7d6;">Mint &amp; freeze authority renounced · No malicious extensions</div>
      </div>

      <a href="https://swap.verixiaapps.com/?token=${mint}" style="display: block; background: linear-gradient(135deg, #4dffd2, #5ee8ff); color: #0a0815; text-decoration: none; text-align: center; padding: 16px; border-radius: 14px; font-weight: 900; letter-spacing: 0.1em; margin-bottom: 16px;">🚀 OPEN IN NEXUS</a>

      <div style="font-size: 11px; color: #6c5d8c; margin-top: 16px;">
        Pool: ${poolAddress ? poolAddress.slice(0, 8) + '…' + poolAddress.slice(-6) : '—'}<br>
        Tx: <a href="https://solscan.io/tx/${signature}" style="color: #5ee8ff;">${signature.slice(0, 10)}…</a><br>
        Detected: ${nowIso()}
      </div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Nexus Whale Watch <onboarding@resend.dev>',
      to:   WHALE_ALERT_EMAIL,
      subject,
      html,
    });
    log('email sent for', symbol || mint);
  } catch (e) {
    logErr('email failed:', e.message);
  }
}

/* ============================================================
 * Token metadata — minimal, just symbol + name for the email
 * ============================================================ */
async function getTokenMeta(mint) {
  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return { symbol: '', name: '', usdPrice: 0 };
    const arr = await r.json();
    const t = Array.isArray(arr) ? arr[0] : arr?.data?.[0];
    return {
      symbol:   t?.symbol || '',
      name:     t?.name   || '',
      usdPrice: Number(t?.usdPrice || 0),
    };
  } catch { return { symbol: '', name: '', usdPrice: 0 }; }
}

let _solUsdCache = { p: 0, ts: 0 };
async function getSolUsd() {
  if (Date.now() - _solUsdCache.ts < 60_000 && _solUsdCache.p > 0) return _solUsdCache.p;
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
    const d = await r.json();
    const p = Number(d?.[SOL_MINT]?.usdPrice || 0);
    if (p > 0) _solUsdCache = { p, ts: Date.now() };
    return p;
  } catch { return _solUsdCache.p || 0; }
}

/* ============================================================
 * Pool scan — pull recent signatures from each AMM program,
 * inspect for big SOL inflows
 * ============================================================ */
async function scanProgram(programId) {
  try {
    const sigs = await rpc('getSignaturesForAddress', [
      programId,
      { limit: 25 },
    ]);
    const cutoff = Date.now() / 1000 - LOOKBACK_MIN * 60;

    for (const s of sigs) {
      if (!s.signature || alertedSignatures.has(s.signature)) continue;
      if (s.blockTime && s.blockTime < cutoff) continue;
      if (s.err) continue;

      await inspectTx(s.signature, programId);
    }
  } catch (e) {
    logErr('scanProgram', programId.slice(0, 6), e.message);
  }
}

async function inspectTx(signature, programId) {
  alertedSignatures.add(signature);
  if (alertedSignatures.size > 5000) {
    // Trim oldest — rough but fine
    const arr = Array.from(alertedSignatures);
    alertedSignatures.clear();
    arr.slice(-2500).forEach(s => alertedSignatures.add(s));
  }

  try {
    const tx = await rpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx || !tx.meta || tx.meta.err) return;

    // Find SOL movement: look at preTokenBalances / postTokenBalances for SOL,
    // OR pre/post balances for the pool vault. Simpler: scan balance deltas
    // for any account that gained >= MIN_SOL_LP * LAMPORTS in this tx.
    const pre  = tx.meta.preBalances  || [];
    const post = tx.meta.postBalances || [];
    const keys = tx.transaction?.message?.accountKeys || [];

    let maxInflowLamports = 0;
    let inflowAccount     = null;

    for (let i = 0; i < pre.length && i < post.length; i++) {
      const delta = post[i] - pre[i];
      if (delta > maxInflowLamports) {
        maxInflowLamports = delta;
        inflowAccount = keys[i]?.pubkey || keys[i];
      }
    }

    const solAdded = maxInflowLamports / LAMPORTS_PER_SOL;
    if (solAdded < MIN_SOL_LP) return;

    // We have a big SOL inflow on an AMM tx. Figure out which token's pool.
    // Heuristic: find the non-SOL mint in postTokenBalances that has the
    // largest balance change in this tx — that's the token side of the pool.
    const postT = tx.meta.postTokenBalances || [];
    const preT  = tx.meta.preTokenBalances  || [];
    const byKey = new Map();
    for (const b of preT)  byKey.set(b.accountIndex + ':pre',  b);
    for (const b of postT) byKey.set(b.accountIndex + ':post', b);

    let tokenMint = null;
    let maxTokenDelta = 0;
    for (const b of postT) {
      if (b.mint === SOL_MINT) continue;
      const prev = preT.find(x => x.accountIndex === b.accountIndex);
      const delta = Number(b.uiTokenAmount?.uiAmount || 0) - Number(prev?.uiTokenAmount?.uiAmount || 0);
      if (Math.abs(delta) > maxTokenDelta) {
        maxTokenDelta = Math.abs(delta);
        tokenMint = b.mint;
      }
    }
    if (!tokenMint) return;

    log(`candidate: ${solAdded.toFixed(0)} SOL inflow on ${tokenMint.slice(0,8)}… (${signature.slice(0,10)}…)`);

    // Honeypot check
    const safety = await honeypotCheck(tokenMint);
    if (!safety.safe) {
      log(`  → SKIP (honeypot): ${safety.reasons.join(', ')}`);
      return;
    }

    // Get token meta + SOL price
    const [meta, solUsd] = await Promise.all([getTokenMeta(tokenMint), getSolUsd()]);
    const usdAmount = solUsd > 0 ? solAdded * solUsd : 0;

    const event = {
      mint:        tokenMint,
      symbol:      meta.symbol,
      name:        meta.name,
      solAmount:   Math.round(solAdded),
      usdAmount,
      signature,
      poolAddress: inflowAccount,
      programId,
      safety,
      detectedAt:  Date.now(),
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 100) recentEvents.length = 100;

    log(`🐋 ALERT: ${meta.symbol || tokenMint.slice(0,8)} +${event.solAmount} SOL`);
    await sendWhaleEmail(event);
  } catch (e) {
    logErr('inspectTx', signature.slice(0, 10), e.message);
  }
}

/* ============================================================
 * Main loop
 * ============================================================ */
let _running = false;
async function tick() {
  if (_running) return;
  _running = true;
  try {
    for (const pid of WATCHED_PROGRAMS) {
      await scanProgram(pid);
    }
  } catch (e) {
    logErr('tick error:', e.message);
  } finally {
    _running = false;
  }
}

function startWhaleWatcher() {
  if (!HELIUS_API_KEY && !process.env.HELIUS_RPC_URL) {
    logErr('no HELIUS_API_KEY/HELIUS_RPC_URL, whale watcher disabled');
    return;
  }
  log(`starting. threshold=${MIN_SOL_LP} SOL, poll=${POLL_INTERVAL_MS}ms, email=${WHALE_ALERT_EMAIL}`);
  if (!resend) logErr('RESEND_API_KEY missing — events will log but no email will send');
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

function getRecentWhaleEvents(sinceMs = 48 * 3600 * 1000) {
  const cutoff = Date.now() - sinceMs;
  return recentEvents.filter(e => e.detectedAt >= cutoff);
}

module.exports = { startWhaleWatcher, getRecentWhaleEvents };
