// polymarket-client.js
// Browser-safe Polymarket helpers for Nexus DEX.
// No private keys. No browser-side CLOB secrets. No custody.

const POLY_CLOB_HOST = 'https://clob.polymarket.com';
const POLY_DATA_HOST = 'https://data-api.polymarket.com';
const POLY_GAMMA_HOST = 'https://gamma-api.polymarket.com';

const POLY_API_BASE = process.env.REACT_APP_POLY_API_BASE || '/api/poly';

async function readJson(res, label = 'Request failed') {
  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}: non-JSON response ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const msg = data?.detail || data?.error || data?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`${label}: ${res.status} ${msg}`);
  }

  return data;
}

function isEvmAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || '').trim());
}

function normalizeBridgeAddressResponse(data) {
  const a = data && typeof data.address === 'object' ? data.address : data;

  return {
    raw: data,
    evm: a?.evm || a?.evmAddress || a?.evm_address || null,
    svm: a?.svm || a?.svmAddress || a?.svm_address || null,
  };
}

// =============================================================================
// BRIDGE API — proxied through /api/poly
// =============================================================================

export async function getDepositAddresses(evmAddress) {
  if (!isEvmAddress(evmAddress)) {
    throw new Error('Valid EVM address required');
  }

  const res = await fetch(`${POLY_API_BASE}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ address: evmAddress }),
  });

  return normalizeBridgeAddressResponse(await readJson(res, 'Deposit address failed'));
}

export async function getBridgeStatus(address) {
  if (!address) throw new Error('Bridge status address required');

  const res = await fetch(`${POLY_API_BASE}/status/${encodeURIComponent(address)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  return await readJson(res, 'Bridge status failed');
}

export async function getSupportedBridgeAssets() {
  const res = await fetch(`${POLY_API_BASE}/supported-assets`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  return await readJson(res, 'Supported assets failed');
}

export async function getBridgeQuote(body) {
  const res = await fetch(`${POLY_API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });

  return await readJson(res, 'Bridge quote failed');
}

export async function requestWithdraw(body) {
  const res = await fetch(`${POLY_API_BASE}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });

  return await readJson(res, 'Withdraw failed');
}

// =============================================================================
// PUBLIC READ APIs
// =============================================================================

export async function getPositions(evmAddress, { limit = 100 } = {}) {
  if (!evmAddress) return [];

  const url =
    `${POLY_DATA_HOST}/positions?user=${encodeURIComponent(evmAddress)}` +
    `&limit=${encodeURIComponent(String(limit))}&sortBy=CURRENT&sortDirection=DESC`;

  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];

  return (await r.json().catch(() => [])) || [];
}

export async function getTrades(evmAddress, { limit = 50 } = {}) {
  if (!evmAddress) return [];

  const url =
    `${POLY_DATA_HOST}/trades?user=${encodeURIComponent(evmAddress)}` +
    `&limit=${encodeURIComponent(String(limit))}`;

  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];

  return (await r.json().catch(() => [])) || [];
}

export async function getResolvedPositions(evmAddress) {
  const all = await getPositions(evmAddress, { limit: 200 });

  return all.filter(p =>
    p?.redeemable === true ||
    p?.resolution === 'YES_WIN' ||
    p?.resolution === 'NO_WIN'
  );
}

// =============================================================================
// GAMMA API — market discovery
// =============================================================================

const GAMMA_BASE = process.env.REACT_APP_POLYMARKET_GAMMA_BASE || POLY_GAMMA_HOST;

export async function fetchCryptoMarkets({ tier = 'all', limit = 80 } = {}) {
  const qs = new URLSearchParams({
    closed: 'false',
    active: 'true',
    archived: 'false',
    tag_id: '21',
    related_tags: 'true',
    limit: String(Math.min(limit, 100)),
    order: 'volume24hr',
    ascending: 'false',
  });

  const url = `${GAMMA_BASE}/events?${qs.toString()}`;

  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];

  const raw = await r.json().catch(() => []);
  const normalized = (Array.isArray(raw) ? raw : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .filter(m => m.clobTokenIds?.length >= 2 && m.conditionId);

  if (tier === 'all') return normalized;

  return normalized.filter(m => classifyTier(m) === tier);
}

function normalizeEvent(ev) {
  const markets = Array.isArray(ev?.markets) ? ev.markets : [];
  if (!markets.length) return null;

  const m = markets[0];

  let outcomePrices = [];
  let clobTokenIds = [];

  try {
    outcomePrices =
      typeof m.outcomePrices === 'string'
        ? JSON.parse(m.outcomePrices)
        : (m.outcomePrices || []);
  } catch {
    outcomePrices = [];
  }

  try {
    clobTokenIds =
      typeof m.clobTokenIds === 'string'
        ? JSON.parse(m.clobTokenIds)
        : (m.clobTokenIds || []);
  } catch {
    clobTokenIds = [];
  }

  const yesPrice = Number(outcomePrices[0] || m.lastTradePrice || 0);
  const noPrice = Number(outcomePrices[1] || (yesPrice ? 1 - yesPrice : 0));

  return {
    id: ev.id,
    slug: ev.slug,
    title: ev.title || m.question || 'Untitled',
    question: m.question || ev.title || 'Untitled',
    childQuestion: markets.length > 1 ? (m.question || m.groupItemTitle || null) : null,
    image: ev.image || ev.icon || m.image || null,
    conditionId: m.conditionId,
    clobTokenIds,
    yesPrice,
    noPrice,
    yesPct: Math.round(yesPrice * 100),
    noPct: Math.round(noPrice * 100),
    volume24h: Number(ev.volume24hr || m.volume24hr || 0),
    liquidity: Number(ev.liquidity || m.liquidity || 0),
    endDate: ev.endDate || m.endDate || null,
    marketCount: markets.length,
    acceptingOrders: m.acceptingOrders !== false,
    enableOrderBook: m.enableOrderBook !== false,
    negRisk: Boolean(m.negRisk || ev.negRisk),
    tickSize: String(m.orderPriceMinTickSize || m.minimum_tick_size || m.tickSize || '0.01'),
  };
}

function classifyTier(m) {
  const q = (m.question || m.title || '').toLowerCase();

  if (/15.?min|hourly|up or down\s+hour/i.test(q)) return 'hourly';
  if (/daily|today|tomorrow/i.test(q)) return 'daily';
  if (/weekly|this week|next week/i.test(q)) return 'weekly';
  if (/monthly|this month|next month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(q)) return 'monthly';

  const end = new Date(m.endDate || 0);
  const days = (end.getTime() - Date.now()) / 86_400_000;

  if (Number.isFinite(days)) {
    if (days <= 2) return 'daily';
    if (days <= 8) return 'weekly';
    if (days <= 45) return 'monthly';
  }

  return 'all';
}

// =============================================================================
// TRADING NOTE
// =============================================================================

export async function placeMarketOrder() {
  throw new Error(
    'placeMarketOrder must use the active Predict.jsx signing flow or a dedicated backend order route. Do not place CLOB orders from this old polymarket-client.js file.'
  );
}

export async function cancelOrder() {
  throw new Error(
    'cancelOrder is not wired in polymarket-client.js. Use the active trading client.'
  );
}

export function clearClient() {
  // No browser-side CLOB client cache anymore.
}

export const POLY_CONST = {
  GAMMA_HOST: POLY_GAMMA_HOST,
  DATA_HOST: POLY_DATA_HOST,
  CLOB_HOST: POLY_CLOB_HOST,
  API_BASE: POLY_API_BASE,
};