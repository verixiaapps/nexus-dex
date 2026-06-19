// referrals.js — Wonderland Radar growth layer.
//
// MOUNT (one line in server.js, e.g. near the bottom, before the catch-all
// 404 handler):
//
//     require('./referrals')(app);
//
// WHAT IT DOES:
//   - Tracks the referrer for each trader wallet, locked on first visit.
//   - Logs every trade routed through your app.
//   - Powers /api/ref/{register,lookup,stats,leaderboard,pnl} and /share/:wallet.
//   - Returns a fee-split config the client uses at trade time to atomically
//     route 30% of the 3% platform fee to the referrer's wallet — in the SAME
//     signed tx as the trade. Server NEVER holds funds. No withdraw flow
//     needed because there's nothing to withdraw.
//
// STORAGE: ./data/referrals.json. Atomic writes via tmp+rename, single
// promise-chain mutex. Zero new dependencies.
//
// KOL BOOST CODES: edit KOL_BOOST_CODES below to add new ones. A wallet that
// activates a code gets a 50/50 split (instead of 70/30) for 60 days on every
// trade their referees make.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'referrals.json');
const TMP_PATH = DB_PATH + '.tmp';

// Split is expressed as basis points OF THE PLATFORM FEE (not of trade).
// Platform fee itself stays 3% of trade — set client-side in Ape.jsx.
//   Default: referrer 30% of the 3% fee  → 0.9% of trade
//   Boost:   referrer 50% of the 3% fee  → 1.5% of trade
const SPLIT_DEFAULT_REF_BPS = 3000;
const SPLIT_BOOST_REF_BPS   = 5000;
const BOOST_DURATION_MS     = 60 * 24 * 3600 * 1000;

// === KOL CODES — EDIT THIS LIST TO ONBOARD NEW REFERRERS WITH BOOST ===
const KOL_BOOST_CODES = new Set([
  'EARLY',
  'KOLALPHA',
  // Add more here. Anything in this set, used as ?boost=CODE on the URL,
  // gets the holder a 50/50 split for 60 days.
]);

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_TRADES = 500_000;
const TRIM_KEEP  = 400_000;

// ── DB ────────────────────────────────────────────────────────────
let _cache = null;
let _writeChain = Promise.resolve();

function _emptyDb() { return { users: {}, trades: [], version: 1 }; }

function _ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function _readSync() {
  try {
    if (!fs.existsSync(DB_PATH)) return _emptyDb();
    const text = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return _emptyDb();
    if (!parsed.users  || typeof parsed.users !== 'object') parsed.users  = {};
    if (!Array.isArray(parsed.trades)) parsed.trades = [];
    return parsed;
  } catch (e) {
    console.warn('[referrals] read failed, starting fresh:', e.message);
    return _emptyDb();
  }
}

function _getDb() {
  if (!_cache) {
    _ensureDir();
    _cache = _readSync();
  }
  return _cache;
}

function _persist() {
  _writeChain = _writeChain.then(() => {
    try {
      _ensureDir();
      fs.writeFileSync(TMP_PATH, JSON.stringify(_cache));
      fs.renameSync(TMP_PATH, DB_PATH);
    } catch (e) {
      console.warn('[referrals] write failed:', e.message);
    }
  });
  return _writeChain;
}

// ── helpers ───────────────────────────────────────────────────────
function _validPubkey(s) {
  return typeof s === 'string' && PUBKEY_RE.test(s);
}

function _user(wallet) {
  const db = _getDb();
  if (!db.users[wallet]) {
    db.users[wallet] = {
      wallet,
      referrer: null,
      joined_at: Date.now(),
      boost_code: null,
      boost_until: null,
    };
  }
  return db.users[wallet];
}

function _isBoosted(wallet) {
  const u = _getDb().users[wallet];
  if (!u || !u.boost_until) return false;
  return u.boost_until > Date.now();
}

function _refSplitBpsForReferrer(referrer) {
  if (!referrer) return 0;
  return _isBoosted(referrer) ? SPLIT_BOOST_REF_BPS : SPLIT_DEFAULT_REF_BPS;
}

// ── mount ─────────────────────────────────────────────────────────
function mount(app) {

  // POST /api/ref/register
  //   { wallet, referrer?, boost? }
  // Referrer is LOCKED on first set — can't be changed. Boost can only be
  // activated once per wallet, and only if the code is in KOL_BOOST_CODES.
  app.post('/api/ref/register', (req, res) => {
    try {
      const wallet   = String(req.body?.wallet || '').trim();
      const referrer = req.body?.referrer ? String(req.body.referrer).trim() : null;
      const boost    = req.body?.boost ? String(req.body.boost).trim().toUpperCase() : null;

      if (!_validPubkey(wallet))     return res.status(400).json({ error: 'Invalid wallet' });
      if (referrer && wallet === referrer) return res.status(400).json({ error: 'Self-referral not allowed' });

      const u = _user(wallet);
      let changed = false;
      let boostActivated = false;

      if (!u.referrer && referrer && _validPubkey(referrer)) {
        u.referrer = referrer;
        changed = true;
      }

      if (boost && KOL_BOOST_CODES.has(boost) && !u.boost_code) {
        u.boost_code = boost;
        u.boost_until = Date.now() + BOOST_DURATION_MS;
        changed = true;
        boostActivated = true;
      }

      if (changed) _persist();

      return res.json({
        wallet: u.wallet,
        referrer: u.referrer,
        boosted: _isBoosted(wallet),
        boost_until: u.boost_until,
        boostActivated,
      });
    } catch (e) {
      console.warn('[referrals/register]', e.message);
      res.status(500).json({ error: 'Internal' });
    }
  });

  // GET /api/ref/lookup?wallet=<trader>
  // Client calls this just before building a trade tx. Returns the address
  // that should receive the referrer's share, and the bps of the platform
  // fee they should get.
  app.get('/api/ref/lookup', (req, res) => {
    try {
      const wallet = String(req.query.wallet || '').trim();
      if (!_validPubkey(wallet)) return res.json({ referrer: null, refSplitBps: 0 });
      const u = _getDb().users[wallet];
      if (!u || !u.referrer) return res.json({ referrer: null, refSplitBps: 0 });
      return res.json({
        referrer: u.referrer,
        refSplitBps: _refSplitBpsForReferrer(u.referrer),
      });
    } catch (e) {
      res.json({ referrer: null, refSplitBps: 0 });
    }
  });

  // POST /api/ref/log-trade
  //   { wallet, mint, sym, name, side, sol_amount, token_amount,
  //     price_usd, sol_price_usd, sig, ref_wallet, ref_lamports,
  //     platform_lamports }
  // Called by client AFTER the user signs and submits. Idempotent on sig
  // (a re-submission with the same sig is dropped).
  app.post('/api/ref/log-trade', (req, res) => {
    try {
      const b = req.body || {};
      const wallet = String(b.wallet || '').trim();
      if (!_validPubkey(wallet)) return res.status(400).json({ error: 'Invalid wallet' });
      const side = b.side === 'buy' || b.side === 'sell' ? b.side : null;
      if (!side) return res.status(400).json({ error: 'Invalid side' });

      const sig = String(b.sig || '').slice(0, 96);
      const db  = _getDb();

      if (sig) {
        // Cheap dup check — scan only the tail since trades are append-only.
        const tail = db.trades.length > 200 ? db.trades.slice(-200) : db.trades;
        if (tail.some(t => t.sig === sig)) return res.json({ ok: true, dup: true });
      }

      const t = {
        wallet,
        mint: String(b.mint || ''),
        sym:  String(b.sym || '').slice(0, 32),
        name: String(b.name || '').slice(0, 64),
        side,
        sol_amount:        Number(b.sol_amount) || 0,
        token_amount:      Number(b.token_amount) || 0,
        price_usd:         Number(b.price_usd) || 0,
        sol_price_usd:     Number(b.sol_price_usd) || 0,
        sig,
        ref_wallet:        _validPubkey(b.ref_wallet) ? b.ref_wallet : null,
        ref_lamports:      Number(b.ref_lamports) || 0,
        platform_lamports: Number(b.platform_lamports) || 0,
        ts: Date.now(),
      };

      _user(wallet);
      db.trades.push(t);
      if (db.trades.length > MAX_TRADES) db.trades = db.trades.slice(-TRIM_KEEP);
      _persist();
      return res.json({ ok: true });
    } catch (e) {
      console.warn('[referrals/log-trade]', e.message);
      res.status(500).json({ error: 'Internal' });
    }
  });

  // GET /api/ref/stats?wallet=<referrer>
  app.get('/api/ref/stats', (req, res) => {
    try {
      const wallet = String(req.query.wallet || '').trim();
      if (!_validPubkey(wallet)) return res.status(400).json({ error: 'Invalid wallet' });
      const db = _getDb();
      const u  = db.users[wallet];

      const cutoff7d  = Date.now() - 7 * 86400000;
      const cutoff24h = Date.now() - 86400000;
      const activeReferees = new Set();
      let earned     = 0;
      let earned_7d  = 0;
      let earned_24h = 0;

      for (const t of db.trades) {
        if (t.ref_wallet !== wallet) continue;
        activeReferees.add(t.wallet);
        earned += t.ref_lamports;
        if (t.ts >= cutoff7d)  earned_7d  += t.ref_lamports;
        if (t.ts >= cutoff24h) earned_24h += t.ref_lamports;
      }

      let referees = 0;
      for (const w in db.users) {
        if (db.users[w].referrer === wallet) referees++;
      }

      return res.json({
        wallet,
        referees,
        active_referees: activeReferees.size,
        earned_lamports:     earned,
        earned_lamports_7d:  earned_7d,
        earned_lamports_24h: earned_24h,
        boost_active: _isBoosted(wallet),
        boost_until:  u?.boost_until || null,
        boost_code:   u?.boost_code || null,
        split_bps_now: _isBoosted(wallet) ? SPLIT_BOOST_REF_BPS : SPLIT_DEFAULT_REF_BPS,
        split_bps_default: SPLIT_DEFAULT_REF_BPS,
        split_bps_boost:   SPLIT_BOOST_REF_BPS,
      });
    } catch (e) {
      console.warn('[referrals/stats]', e.message);
      res.status(500).json({ error: 'Internal' });
    }
  });

  // GET /api/ref/leaderboard?window=24h|7d|all
  // Top 50 traders by SOL volume routed through the app.
  const _lbCache = new Map();
  const LB_TTL = 30_000;
  app.get('/api/ref/leaderboard', (req, res) => {
    try {
      const w = req.query.window === '24h' ? '24h' :
                req.query.window === '7d'  ? '7d'  : 'all';
      const hit = _lbCache.get(w);
      if (hit && Date.now() - hit.ts < LB_TTL) return res.json(hit.payload);

      const cutoff = w === '24h' ? Date.now() - 86400000 :
                     w === '7d'  ? Date.now() - 7 * 86400000 : 0;
      const db = _getDb();
      const by = new Map();

      for (const t of db.trades) {
        if (t.ts < cutoff) continue;
        let u = by.get(t.wallet);
        if (!u) {
          u = { wallet: t.wallet, volume_sol: 0, trades: 0, buys: 0, sells: 0 };
          by.set(t.wallet, u);
        }
        u.volume_sol += Number(t.sol_amount || 0);
        u.trades += 1;
        if (t.side === 'buy') u.buys += 1; else u.sells += 1;
      }

      const list = [...by.values()]
        .sort((a, b) => b.volume_sol - a.volume_sol)
        .slice(0, 50);
      const payload = {
        window: w,
        count: list.length,
        total_traders: by.size,
        traders: list,
        ts: Date.now(),
      };
      _lbCache.set(w, { ts: Date.now(), payload });
      return res.json(payload);
    } catch (e) {
      console.warn('[referrals/leaderboard]', e.message);
      res.status(500).json({ error: 'Internal' });
    }
  });

  // GET /api/ref/pnl?wallet=<wallet>
  // Realized P&L per mint + open position sizing. The client multiplies the
  // open position by the current price to get unrealized.
  app.get('/api/ref/pnl', (req, res) => {
    try {
      const wallet = String(req.query.wallet || '').trim();
      if (!_validPubkey(wallet)) return res.status(400).json({ error: 'Invalid wallet' });
      const db = _getDb();
      const userTrades = db.trades.filter(t => t.wallet === wallet);

      const byMint = new Map();
      let total_volume_sol = 0;
      let realized_sol_total = 0;
      let first_trade_ts = Infinity;
      let last_trade_ts  = 0;

      for (const t of userTrades) {
        let p = byMint.get(t.mint);
        if (!p) {
          p = {
            mint: t.mint, sym: t.sym, name: t.name,
            buys: 0, sells: 0,
            sol_in: 0, sol_out: 0,
            tokens_in: 0, tokens_out: 0,
            first_ts: t.ts, last_ts: t.ts,
          };
          byMint.set(t.mint, p);
        }
        if (t.side === 'buy') {
          p.buys += 1;
          p.sol_in    += t.sol_amount;
          p.tokens_in += t.token_amount;
        } else {
          p.sells += 1;
          p.sol_out    += t.sol_amount;
          p.tokens_out += t.token_amount;
        }
        if (t.sym  && !p.sym)  p.sym  = t.sym;
        if (t.name && !p.name) p.name = t.name;
        if (t.ts < p.first_ts) p.first_ts = t.ts;
        if (t.ts > p.last_ts)  p.last_ts  = t.ts;
        if (t.ts < first_trade_ts) first_trade_ts = t.ts;
        if (t.ts > last_trade_ts)  last_trade_ts  = t.ts;
        total_volume_sol += t.sol_amount;
      }

      const positions = [];
      for (const p of byMint.values()) {
        const avg_buy_price_sol = p.tokens_in > 0 ? p.sol_in / p.tokens_in : 0;
        const open_tokens = Math.max(0, p.tokens_in - p.tokens_out);
        const realized_pnl_sol = p.sol_out - (p.tokens_out * avg_buy_price_sol);
        realized_sol_total += realized_pnl_sol;
        positions.push({
          mint: p.mint, sym: p.sym, name: p.name,
          buys: p.buys, sells: p.sells,
          sol_in: p.sol_in, sol_out: p.sol_out,
          tokens_in: p.tokens_in, tokens_out: p.tokens_out,
          open_tokens, avg_buy_price_sol,
          realized_pnl_sol,
          first_ts: p.first_ts, last_ts: p.last_ts,
          open: open_tokens > 0.000001,
        });
      }
      positions.sort((a, b) => b.last_ts - a.last_ts);

      return res.json({
        wallet,
        trade_count: userTrades.length,
        total_volume_sol,
        realized_pnl_sol: realized_sol_total,
        first_trade_ts: first_trade_ts === Infinity ? null : first_trade_ts,
        last_trade_ts:  last_trade_ts  === 0        ? null : last_trade_ts,
        positions,
      });
    } catch (e) {
      console.warn('[referrals/pnl]', e.message);
      res.status(500).json({ error: 'Internal' });
    }
  });

  // GET /share/:wallet
  // OG / Twitter Card unfurl + redirect to app root with ?ref=<wallet>.
  // When someone clicks a shared link, they land on the app already tagged
  // with the referrer locked in.
  app.get('/share/:wallet', (req, res) => {
    try {
      const wallet = String(req.params.wallet || '').trim();
      if (!_validPubkey(wallet)) return res.status(400).send('Invalid wallet');

      const db = _getDb();
      const ut = db.trades.filter(t => t.wallet === wallet);
      const last7d = ut.filter(t => t.ts > Date.now() - 7 * 86400000);

      const byMint = new Map();
      let volume = 0;
      for (const t of ut) {
        if (!byMint.has(t.mint)) byMint.set(t.mint, { sol_in: 0, sol_out: 0, tokens_in: 0, tokens_out: 0 });
        const p = byMint.get(t.mint);
        if (t.side === 'buy') { p.sol_in += t.sol_amount; p.tokens_in += t.token_amount; }
        else                  { p.sol_out += t.sol_amount; p.tokens_out += t.token_amount; }
        volume += t.sol_amount;
      }
      let realized = 0;
      for (const p of byMint.values()) {
        const avg = p.tokens_in > 0 ? p.sol_in / p.tokens_in : 0;
        realized += p.sol_out - p.tokens_out * avg;
      }

      const tag = wallet.slice(0, 4) + '…' + wallet.slice(-4);
      const pnlLabel = realized >= 0 ? '+' + realized.toFixed(3) + ' SOL' : realized.toFixed(3) + ' SOL';
      const title = 'Field log · ' + tag + ' · Wonderland Radar';
      const desc  = ut.length + ' entries · ' + last7d.length + ' this week · realized ' + pnlLabel + ' · ' + volume.toFixed(2) + ' SOL volume';
      const url   = (req.protocol || 'https') + '://' + req.get('host') + '/?ref=' + encodeURIComponent(wallet);

      const esc = (s) => String(s).replace(/[<>&"']/g, c =>
        ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]));

      const html = '<!doctype html>'
        + '<html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<title>' + esc(title) + '</title>'
        + '<meta name="description" content="' + esc(desc) + '">'
        + '<meta property="og:title" content="' + esc(title) + '">'
        + '<meta property="og:description" content="' + esc(desc) + '">'
        + '<meta property="og:url" content="' + esc(url) + '">'
        + '<meta property="og:type" content="website">'
        + '<meta name="twitter:card" content="summary">'
        + '<meta name="twitter:title" content="' + esc(title) + '">'
        + '<meta name="twitter:description" content="' + esc(desc) + '">'
        + '<meta http-equiv="refresh" content="0; url=' + esc(url) + '">'
        + '<style>body{font-family:system-ui;background:#0E0B1F;color:#F4EFFF;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#6BEEFF}</style>'
        + '</head><body>'
        + '<p>Redirecting to <a href="' + esc(url) + '">Wonderland Radar</a>…</p>'
        + '</body></html>';

      res.set('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch (e) {
      console.warn('[referrals/share]', e.message);
      res.status(500).send('Internal');
    }
  });

  // ── HONEYPOT / SAFETY CHECK ──────────────────────────────────────
  // GET /api/honeypot-check/:mint
  // Returns { safe, reasons, program }. Used by the auto-trade hook before
  // every commit. Cached 60s per mint to avoid hammering the RPC.
  //
  // Checks:
  //   - Token program is SPL or Token-2022 (anything else = reject)
  //   - Mint authority is null (else dev can mint unlimited supply)
  //   - Freeze authority is null (else dev can freeze your token account)
  //   - For Token-2022: scan mint extensions for known dangerous types.
  //       Extension type IDs below match spl-token-2022 ExtensionType enum.

  const SPL_TOKEN_PROGRAM  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  // Use whichever RPC the rest of server.js uses. Falls back to public.
  const RPC_URL = process.env.SOLANA_RPC_URL
                || process.env.ALCHEMY_SOLANA_URL
                || 'https://api.mainnet-beta.solana.com';

  async function rpcGetAccountInfo(mint) {
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
        params: [mint, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    });
    if (!r.ok) throw new Error('RPC HTTP ' + r.status);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'RPC error');
    return d.result && d.result.value;
  }

  async function inspectMint(mint) {
    const info = await rpcGetAccountInfo(mint);
    if (!info) return { safe: false, reasons: ['Mint not found on-chain'], program: 'unknown' };
    if (!Array.isArray(info.data) || typeof info.data[0] !== 'string') {
      return { safe: false, reasons: ['Mint data missing or malformed'], program: 'unknown' };
    }

    const owner = info.owner;
    const buf   = Buffer.from(info.data[0], 'base64');
    const reasons = [];

    if (owner !== SPL_TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) {
      return { safe: false, reasons: ['Unknown token program'], program: 'unknown' };
    }

    // SPL Mint layout: mint_authority_tag(4) + mint_authority(32) + supply(8) +
    // decimals(1) + is_initialized(1) + freeze_authority_tag(4) + freeze_authority(32) = 82 bytes
    if (buf.length < 82) return { safe: false, reasons: ['Malformed mint'], program: owner === TOKEN_2022_PROGRAM ? '2022' : 'spl' };

    const hasMintAuthority   = buf.readUInt32LE(0)  === 1;
    const hasFreezeAuthority = buf.readUInt32LE(46) === 1;

    if (hasMintAuthority)   reasons.push('Mint authority active — dev can mint supply');
    if (hasFreezeAuthority) reasons.push('Freeze authority active — dev can freeze your tokens');

    // Token-2022 extensions live after byte 165 (padded base mint) + 1 byte account-type tag.
    if (owner === TOKEN_2022_PROGRAM && buf.length > 166) {
      let off = 166;
      while (off + 4 <= buf.length) {
        const extType = buf.readUInt16LE(off);
        const extLen  = buf.readUInt16LE(off + 2);
        // Type 0 = Uninitialized = padding bytes. End of extensions.
        if (extType === 0) break;

        // Dangerous mint extension types (per spl-token-2022 ExtensionType enum):
        //   1  TransferFeeConfig          fee on every transfer, up to 100%
        //   6  DefaultAccountState        new holder accounts can start frozen
        //   9  NonTransferable            literally cannot transfer
        //  12  PermanentDelegate          dev can move tokens out of any wallet
        //  14  TransferHook               dev program runs on every transfer
        //  26  Pausable                   dev can pause all transfers globally
        if (extType === 1)  reasons.push('Transfer fee extension — sells may be taxed up to 100%');
        if (extType === 6)  reasons.push('Default-frozen accounts — new holders start frozen');
        if (extType === 9)  reasons.push('Non-transferable mint — literally cannot be sold');
        if (extType === 12) reasons.push('Permanent delegate — dev can move tokens from any wallet');
        if (extType === 14) reasons.push('Transfer hook — dev program runs on every transfer');
        if (extType === 26) reasons.push('Pausable mint — dev can freeze all transfers globally');

        off += 4 + extLen;
        if (extLen > 4096) break; // sanity
      }
    }

    return {
      safe: reasons.length === 0,
      reasons,
      program: owner === TOKEN_2022_PROGRAM ? '2022' : 'spl',
    };
  }

  const _honeyCache = new Map();
  const HONEY_TTL   = 60_000;

  app.get('/api/honeypot-check/:mint', async (req, res) => {
    try {
      const mint = String(req.params.mint || '').trim();
      if (!_validPubkey(mint)) return res.status(400).json({ safe: false, reasons: ['Invalid mint'] });

      const hit = _honeyCache.get(mint);
      if (hit && Date.now() - hit.ts < HONEY_TTL) return res.json(hit.payload);

      const result = await inspectMint(mint);
      _honeyCache.set(mint, { ts: Date.now(), payload: result });

      // Trim cache.
      if (_honeyCache.size > 5000) {
        const sorted = [..._honeyCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < 1500; i++) _honeyCache.delete(sorted[i][0]);
      }
      return res.json(result);
    } catch (e) {
      console.warn('[honeypot]', e.message);
      res.status(500).json({ safe: false, reasons: ['Check failed: ' + (e.message || 'rpc')] });
    }
  });

  console.log('[referrals] mounted · default '
    + (SPLIT_DEFAULT_REF_BPS/100) + '% / boost '
    + (SPLIT_BOOST_REF_BPS/100) + '% to referrer · '
    + KOL_BOOST_CODES.size + ' KOL code(s) · data: ' + DB_PATH
    + ' · honeypot check ready');
}

module.exports = mount;
