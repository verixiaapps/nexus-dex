// admin.js — Nexus DEX admin dashboard backend.
//
// MOUNT (ONE LINE in server.js, AFTER `require('./ape-pump-trade').mountRoutes(app);`
//        and BEFORE `app.all('/api/*', ...)`):
//
//     require('./admin')(app);
//
// WHAT IT DOES
//   - POST /api/visit       — public, anonymous visit logger (visitor_id, path, ref).
//   - GET  /api/admin/overview?wallet=<admin> — single endpoint AdminPage.jsx reads.
//   - Wallet-gates everything against ADMIN_WALLETS (hardcoded below; matches App.js).
//
// STORAGE
//   - Visits: ./data/visits.json (single JSON, atomic tmp+rename, same pattern as referrals.js).
//   - Trades / referrals / revenue: reads ./data/referrals.json directly (read-only).
//     We never write to referrals.json.
//
// NO NEW DEPENDENCIES. NO EXTERNAL DB.

const fs   = require('fs');
const path = require('path');

const DATA_DIR        = path.join(__dirname, 'data');
const VISITS_PATH     = path.join(DATA_DIR, 'visits.json');
const VISITS_TMP      = VISITS_PATH + '.tmp';
const REFERRALS_PATH  = path.join(DATA_DIR, 'referrals.json');

// Must match App.js export const ADMIN_WALLETS
const ADMIN_WALLETS = new Set([
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
]);

const PUBKEY_RE     = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VID_RE        = /^[a-zA-Z0-9_-]{4,64}$/;
const MAX_VISITS    = 500_000;
const TRIM_KEEP     = 400_000;
const OVERVIEW_TTL  = 10_000;   // cache the heavy aggregation 10s
const DAY_MS        = 86_400_000;

// ── visits storage (own file, atomic writes, same pattern as referrals.js) ─
let _visitsCache = null;
let _writeChain  = Promise.resolve();

function _emptyVisits() { return { visits: [], version: 1 }; }

function _ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function _readVisitsSync() {
  try {
    if (!fs.existsSync(VISITS_PATH)) return _emptyVisits();
    const text = fs.readFileSync(VISITS_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return _emptyVisits();
    if (!Array.isArray(parsed.visits)) parsed.visits = [];
    return parsed;
  } catch (e) {
    console.warn('[admin] visits read failed, starting fresh:', e.message);
    return _emptyVisits();
  }
}

function _getVisits() {
  if (!_visitsCache) {
    _ensureDir();
    _visitsCache = _readVisitsSync();
  }
  return _visitsCache;
}

function _persistVisits() {
  _writeChain = _writeChain.then(() => {
    try {
      _ensureDir();
      fs.writeFileSync(VISITS_TMP, JSON.stringify(_visitsCache));
      fs.renameSync(VISITS_TMP, VISITS_PATH);
    } catch (e) {
      console.warn('[admin] visits write failed:', e.message);
    }
  });
  return _writeChain;
}

// ── referrals.json reader (read-only; we never mutate it) ─────────────────
// referrals.js holds its own in-memory cache, so the on-disk file is the
// authoritative snapshot we can read. We re-read on demand (cheap; the
// overview itself is cached for OVERVIEW_TTL).
function _readReferrals() {
  try {
    if (!fs.existsSync(REFERRALS_PATH)) return { users: {}, trades: [] };
    const text = fs.readFileSync(REFERRALS_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return { users: {}, trades: [] };
    if (!parsed.users  || typeof parsed.users !== 'object') parsed.users  = {};
    if (!Array.isArray(parsed.trades)) parsed.trades = [];
    return parsed;
  } catch (e) {
    console.warn('[admin] referrals read failed:', e.message);
    return { users: {}, trades: [] };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function _normPath(p) {
  if (typeof p !== 'string') return '/';
  // Strip query/hash, lowercase, collapse trailing slash (except root).
  let s = p.split('?')[0].split('#')[0].toLowerCase().trim();
  if (s.length === 0) s = '/';
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  if (s.length > 200) s = s.slice(0, 200);
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

function _validVid(v) {
  return typeof v === 'string' && VID_RE.test(v);
}

function _validPubkey(s) {
  return typeof s === 'string' && PUBKEY_RE.test(s);
}

// Compute the overview from the (visits, trades, users) snapshots. Expensive
// at large scale; cached by caller.
function _computeOverview() {
  const now = Date.now();
  const cutoff24h = now - DAY_MS;
  const cutoff7d  = now - 7  * DAY_MS;
  const cutoff30d = now - 30 * DAY_MS;

  // ── VISITS ──
  const visits = _getVisits().visits;
  const vTotal = visits.length;
  const vUniqAll  = new Set();
  const vUniq24h  = new Set();
  const vUniq7d   = new Set();
  const pathCount = new Map();
  const refUniques = new Map(); // ref -> Set(visitor_id)
  const daysBucket = new Map(); // YYYY-MM-DD -> count

  for (const v of visits) {
    if (!v || !v.visitor_id) continue;
    vUniqAll.add(v.visitor_id);
    if (v.ts >= cutoff24h) vUniq24h.add(v.visitor_id);
    if (v.ts >= cutoff7d)  vUniq7d.add(v.visitor_id);

    if (v.path) pathCount.set(v.path, (pathCount.get(v.path) || 0) + 1);

    if (v.ref && _validPubkey(v.ref)) {
      let set = refUniques.get(v.ref);
      if (!set) { set = new Set(); refUniques.set(v.ref, set); }
      set.add(v.visitor_id);
    }

    if (v.ts >= cutoff30d) {
      const d = new Date(v.ts);
      const key = d.getUTCFullYear() + '-'
        + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
        + String(d.getUTCDate()).padStart(2, '0');
      daysBucket.set(key, (daysBucket.get(key) || 0) + 1);
    }
  }

  // Build last30 array (oldest first), zero-filled for days with no visits.
  const last30 = [];
  const today = new Date(now);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = d.getUTCFullYear() + '-'
      + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(d.getUTCDate()).padStart(2, '0');
    last30.push({ day: key, count: daysBucket.get(key) || 0 });
  }

  const top_paths = [...pathCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([p, c]) => ({ path: p, count: c }));

  const top_refs_by_visits = [...refUniques.entries()]
    .map(([wallet, set]) => ({ wallet, visits: set.size }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 12);

  // ── TRADES + REVENUE ── (read directly from referrals.json)
  const ref = _readReferrals();
  const trades = ref.trades;
  const users  = ref.users;

  let tTotal = trades.length;
  let trades24h = 0, trades7d = 0;
  let volAll  = 0, vol24h = 0, vol7d = 0;
  let platAll = 0, plat24h = 0, plat7d = 0;
  let refPaidAll = 0;
  const traders24h = new Set();
  const traders7d  = new Set();
  const tradersAll = new Set();
  const traderAgg  = new Map(); // wallet -> {trades, volume_sol}
  const hourly = new Array(24).fill(0); // hourly_volume_24h: oldest→newest

  for (const t of trades) {
    if (!t) continue;
    const sol = Number(t.sol_amount) || 0;
    const platL = Number(t.platform_lamports) || 0;
    const refL  = Number(t.ref_lamports) || 0;

    volAll += sol;
    platAll += platL;
    refPaidAll += refL;
    tradersAll.add(t.wallet);

    let agg = traderAgg.get(t.wallet);
    if (!agg) { agg = { wallet: t.wallet, trades: 0, volume_sol: 0 }; traderAgg.set(t.wallet, agg); }
    agg.trades += 1;
    agg.volume_sol += sol;

    if (t.ts >= cutoff24h) {
      trades24h += 1;
      vol24h += sol;
      plat24h += platL;
      traders24h.add(t.wallet);

      // Hourly bucket: index 0 = 24h ago, 23 = last hour
      const hoursAgo = Math.floor((now - t.ts) / 3_600_000);
      if (hoursAgo >= 0 && hoursAgo < 24) hourly[23 - hoursAgo] += sol;
    }
    if (t.ts >= cutoff7d) {
      trades7d += 1;
      vol7d += sol;
      plat7d += platL;
      traders7d.add(t.wallet);
    }
  }

  const top_traders = [...traderAgg.values()]
    .sort((a, b) => b.volume_sol - a.volume_sol)
    .slice(0, 12);

  // platform_kept = platform_lamports - referrer share (referrer_paid is
  // separate, but log-trade splits them so platform_lamports as logged is
  // ALREADY net of referrer pay-out in our scheme. We expose both so the
  // dashboard can reconcile.)
  //
  // Per Ape.jsx fee logic, platform_lamports is the actually-kept portion
  // and ref_lamports goes to the referrer. So platform_kept == platform_lamports.

  // ── REFERRALS ──
  let refereesTotal = 0, referees24h = 0, referees7d = 0;
  const refrEarnings = new Map(); // referrer -> {active_referees Set, earned_lamports}
  for (const w in users) {
    const u = users[w];
    if (!u || !u.referrer) continue;
    refereesTotal += 1;
    const joined = Number(u.joined_at) || 0;
    if (joined >= cutoff24h) referees24h += 1;
    if (joined >= cutoff7d)  referees7d  += 1;
  }
  for (const t of trades) {
    if (!t || !t.ref_wallet) continue;
    let r = refrEarnings.get(t.ref_wallet);
    if (!r) { r = { wallet: t.ref_wallet, active_referees: new Set(), earned_lamports: 0 }; refrEarnings.set(t.ref_wallet, r); }
    r.active_referees.add(t.wallet);
    r.earned_lamports += Number(t.ref_lamports) || 0;
  }
  const top_referrers = [...refrEarnings.values()]
    .map(r => ({ wallet: r.wallet, active_referees: r.active_referees.size, earned_lamports: r.earned_lamports }))
    .sort((a, b) => b.earned_lamports - a.earned_lamports)
    .slice(0, 12);

  return {
    ts: new Date(now).toISOString(),
    visits: {
      total: vTotal,
      uniques_total: vUniqAll.size,
      uniques_24h:   vUniq24h.size,
      uniques_7d:    vUniq7d.size,
      last30,
      top_paths,
      top_refs_by_visits,
    },
    trades: {
      total: tTotal,
      trades_24h: trades24h,
      trades_7d:  trades7d,
      volume_sol_24h: vol24h,
      volume_sol_7d:  vol7d,
      volume_sol_all: volAll,
      unique_traders_24h: traders24h.size,
      unique_traders_7d:  traders7d.size,
      unique_traders_all: tradersAll.size,
      hourly_volume_24h: hourly,
      top_traders,
    },
    revenue: {
      platform_kept_lamports_all: platAll,
      platform_kept_lamports_24h: plat24h,
      platform_kept_lamports_7d:  plat7d,
      referrer_paid_lamports_all: refPaidAll,
    },
    referrals: {
      referees_total: refereesTotal,
      referees_24h:   referees24h,
      referees_7d:    referees7d,
      top_referrers,
    },
  };
}

let _overviewCache = { ts: 0, payload: null };
function _cachedOverview() {
  if (_overviewCache.payload && Date.now() - _overviewCache.ts < OVERVIEW_TTL) {
    return _overviewCache.payload;
  }
  const payload = _computeOverview();
  _overviewCache = { ts: Date.now(), payload };
  return payload;
}

// ── mount ────────────────────────────────────────────────────────────────
function mount(app) {
  // POST /api/visit  { visitor_id, path, ref? }
  // Anonymous, no PII. Client fires once per route change.
  app.post('/api/visit', (req, res) => {
    try {
      const b = req.body || {};
      const visitor_id = String(b.visitor_id || '').trim();
      if (!_validVid(visitor_id)) return res.status(400).json({ error: 'Invalid visitor_id' });

      const visit = {
        visitor_id,
        path: _normPath(b.path || '/'),
        ref:  _validPubkey(b.ref) ? b.ref : null,
        ts: Date.now(),
      };

      const db = _getVisits();
      db.visits.push(visit);
      if (db.visits.length > MAX_VISITS) db.visits = db.visits.slice(-TRIM_KEEP);
      _persistVisits();
      return res.json({ ok: true });
    } catch (e) {
      console.warn('[admin/visit]', e.message);
      // Never fail the user's page nav over visit logging.
      return res.json({ ok: false });
    }
  });

  // GET /api/admin/overview?wallet=<admin>
  // Wallet-gated. 403 if not in ADMIN_WALLETS.
  app.get('/api/admin/overview', (req, res) => {
    try {
      const wallet = String(req.query.wallet || '').trim();
      if (!_validPubkey(wallet) || !ADMIN_WALLETS.has(wallet)) {
        return res.status(403).json({ error: 'Not authorized' });
      }
      const payload = _cachedOverview();
      return res.json(payload);
    } catch (e) {
      console.warn('[admin/overview]', e.message);
      return res.status(500).json({ error: 'Internal' });
    }
  });

  console.log('[admin] mounted · /api/visit + /api/admin/overview · visits: '
    + VISITS_PATH + ' · gated to ' + ADMIN_WALLETS.size + ' wallet(s)');
}

module.exports = mount;
