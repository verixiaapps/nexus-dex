#!/usr/bin/env node
/**
 * fetch_jupiter_tokens.mjs  —  STEP 0 of the SEO build
 * ---------------------------------------------------------------------------
 * Populates data/jupiter_tokens.json: the real-token universe that gates which
 * SEO pages are allowed to exist. A page is only generated for a token that
 * appears here, so this file IS the doorway firewall.
 *
 * Universe = widest REAL set your own infra exposes, merged + de-duped:
 *   1) /api/jupiter/tokens                  -> Jupiter VERIFIED list (clean whitelist)
 *   2) /api/dex/discover?sort=organic       -> organic-ranked (liquidity/vol/mcap)
 *   3) /api/jupiter/tokens/v2/recent        -> fresh mints (widen coverage)
 *
 * Then a LOW liquidity floor drops dead / zero-liq tokens that would only
 * produce broken pages (swap can't route them anyway). LIQUIDITY_FLOOR is the
 * one dial — raise it to be stricter, lower it to widen.
 *
 * Run:  node scripts/fetch_jupiter_tokens.mjs
 * Out:  data/jupiter_tokens.json  ->  { "<symbol>": {mint, liquidity, volume24h, mcap, verified, source}, ... }
 *
 * NOTE: the server's /api/ bot-blocker 403s blank/known-bot User-Agents
 * (including "node"), so every request below sends a browser-like UA.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- config (env-overridable) ---------------------------------------------
const ORIGIN          = (process.env.VERIXIA_ORIGIN || 'https://swap.verixiaapps.com').replace(/\/+$/, '');
const OUT_FILE        = path.join(__dirname, '..', 'data', 'jupiter_tokens.json');
const LIQUIDITY_FLOOR = Number(process.env.LIQUIDITY_FLOOR || 5000);   // USD. THE dial.
const TIMEOUT_MS      = Number(process.env.FETCH_TIMEOUT_MS || 20000);
// Browser-like UA so the server's BOT_UA_RE blocker doesn't 403 us.
const UA              = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const B58_RE    = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function num(...vals) {
  for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return 0;
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: controller.signal,
    });
    if (!r.ok) { console.warn(`  [warn] ${r.status} ${url}`); return null; }
    return await r.json();
  } catch (e) {
    console.warn(`  [warn] fetch failed ${url}: ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
}

// Normalize one token from any of the three feeds into a common shape.
function shape(t, source) {
  if (!t || typeof t !== 'object') return null;
  const mint = t.id || t.address || t.mint;
  const sym  = t.symbol || t.sym;
  if (!mint || !B58_RE.test(mint)) return null;
  if (!sym || typeof sym !== 'string') return null;
  if (mint === SOL_MINT) return null; // SOL is the base pair, not a destination page
  const stats24 = t.stats24h || t.stats || {};
  return {
    symbol:    sym.trim(),
    mint,
    liquidity: num(t.liquidity, t.liquidity?.usd, t.liquidityUsd, t.total_reserve_in_usd),
    volume24h: num(stats24.volume, t.volume24h, t.volume?.h24, t.v24hUSD),
    mcap:      num(t.mcap, t.marketCap, t.fdv, t.usdMarketCap, t.market_cap_usd),
    verified:  source === 'verified' || t.isVerified === true || (Array.isArray(t.tags) && t.tags.includes('verified')),
    source,
  };
}

function collect(raw, source, into) {
  const arr = Array.isArray(raw) ? raw
            : Array.isArray(raw?.tokens) ? raw.tokens
            : Array.isArray(raw?.data)   ? raw.data
            : [];
  let added = 0;
  for (const t of arr) {
    const s = shape(t, source);
    if (!s) continue;
    const key = s.symbol.toLowerCase();
    const existing = into.get(key);
    // Keep the richest record: prefer verified, then more liquidity.
    if (!existing
        || (s.verified && !existing.verified)
        || (s.verified === existing.verified && s.liquidity > existing.liquidity)) {
      // preserve best-known numbers across feeds
      if (existing) {
        s.liquidity = Math.max(s.liquidity, existing.liquidity);
        s.volume24h = Math.max(s.volume24h, existing.volume24h);
        s.mcap      = Math.max(s.mcap, existing.mcap);
        s.verified  = s.verified || existing.verified;
      }
      into.set(key, s);
    }
    added++;
  }
  return added;
}

async function main() {
  console.log(`[fetch] origin = ${ORIGIN}`);
  console.log(`[fetch] liquidity floor = $${LIQUIDITY_FLOOR.toLocaleString()}`);

  const universe = new Map(); // symbol(lower) -> record

  // 1) verified list
  const verified = await getJson(`${ORIGIN}/api/jupiter/tokens?query=verified`);
  console.log(`  verified:   +${collect(verified, 'verified', universe)} raw`);

  // 2) organic-ranked (carries liquidity/volume/mcap)
  const organic = await getJson(`${ORIGIN}/api/dex/discover?sort=organic&tf=24h`);
  console.log(`  organic:    +${collect(organic, 'organic', universe)} raw`);

  // 3) recent mints (widen)
  const recent = await getJson(`${ORIGIN}/api/jupiter/tokens/v2/recent`);
  console.log(`  recent:     +${collect(recent, 'recent', universe)} raw`);

  if (universe.size === 0) {
    console.error('[fetch] FATAL: no tokens fetched. Is the origin reachable? Aborting WITHOUT writing (keeps last good file).');
    process.exit(1);
  }

  // Apply the liquidity floor. Verified tokens are always kept (they're the
  // clean whitelist even if the discover feed didn't carry a liquidity number).
  const kept = {};
  let dropped = 0;
  for (const rec of universe.values()) {
    if (rec.verified || rec.liquidity >= LIQUIDITY_FLOOR) {
      kept[rec.symbol] = {
        mint: rec.mint,
        liquidity: Math.round(rec.liquidity),
        volume24h: Math.round(rec.volume24h),
        mcap: Math.round(rec.mcap),
        verified: rec.verified,
        source: rec.source,
      };
    } else {
      dropped++;
    }
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(kept, null, 0));

  const total = Object.keys(kept).length;
  const ver   = Object.values(kept).filter(t => t.verified).length;
  console.log(`[fetch] universe ${universe.size} -> kept ${total} (verified ${ver}), dropped ${dropped} below floor`);
  console.log(`[fetch] wrote ${OUT_FILE}`);
}

main().catch(e => { console.error('[fetch] FATAL', e); process.exit(1); });
 