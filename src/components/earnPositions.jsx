// =====================================================================
// earnPositions.js — read user's Kamino lending positions.
//
// Uses Kamino's public REST API (api.kamino.finance) which exposes
// per-market obligation data. Source of truth is on-chain state surfaced
// through Kamino's API — no localStorage, survives device changes.
//
// Endpoint (per Kamino OpenAPI spec at api.kamino.finance/openapi/json):
//   GET /kamino-lending/markets/{market}/users/{wallet}/obligations/latest
//   Response: { obligations: [ ObligationMetrics, ... ] }  OR
//             ObligationMetrics[]  (both shapes handled)
//
//   ObligationMetrics.deposits[] = [{ mintAddress, amount, marketValueRefreshed }]
//
// If the API is unreachable, we return [] and the UI hides the Earn section
// cleanly. We log the failure reason to console so devs can debug.
// =====================================================================

const KAMINO_API = 'https://api.kamino.finance';

// Known Kamino lending markets. Main + JLP markets cover ~95% of user
// deposits. Adding more markets is a one-line change here.
//   - Main:        7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF
//   - JLP:         DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek
//   - Altcoins:    ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5
// If you only want main market, just keep the first entry.
const MARKETS = {
  Main:     '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  JLP:      'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek',
  Altcoins: 'ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5',
};

// Token metadata for nice display. Anything not in this map still shows
// up; we just use a generic label.
const TOKEN_META = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', isStable: true  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', isStable: true  },
  So11111111111111111111111111111111111111112:  { symbol: 'SOL',  isStable: false },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'JitoSOL', isStable: false },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So:  { symbol: 'mSOL', isStable: false },
};

// Hide deposits worth less than this — dust shouldn't clutter the UI.
const DUST_USD = 0.50;

// Per-request timeout. If Kamino's API hangs (rare but happens during
// deploys), we move on instead of blocking the portfolio render.
const FETCH_TIMEOUT_MS = 4000;

// Public metadata — importable elsewhere.
export const PROTOCOLS = {
  Kamino: { withdrawUrl: 'https://app.kamino.finance', color: '#7a5af8' },
};

// =====================================================================
// fetchWithTimeout — AbortSignal isn't on every browser, so we polyfill.
// =====================================================================
function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// =====================================================================
// Fetch obligations for ONE market in parallel-safe way.
// Returns [] on any failure (logged to console).
// =====================================================================
async function fetchMarketObligations(marketKey, marketAddress, wallet) {
  const url = `${KAMINO_API}/kamino-lending/markets/${marketAddress}/users/${wallet}/obligations/latest`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      // 404 just means the user has no position in this market — quiet.
      // Other status codes are unexpected, log them.
      if (res.status !== 404) {
        console.warn(`[earn] ${marketKey} market returned HTTP ${res.status}`);
      }
      return [];
    }
    const data = await res.json();
    // API may return: array, { obligations: [...] }, { loans: [...] }
    const obligations = Array.isArray(data)         ? data
                       : Array.isArray(data?.obligations) ? data.obligations
                       : Array.isArray(data?.loans)       ? data.loans
                       : [];
    return obligations;
  } catch (e) {
    // AbortError from timeout, network failure, JSON parse error.
    if (e?.name === 'AbortError') {
      console.warn(`[earn] ${marketKey} market timed out after ${FETCH_TIMEOUT_MS}ms`);
    } else {
      console.warn(`[earn] ${marketKey} market fetch failed:`, e?.message || e);
    }
    return [];
  }
}

// =====================================================================
// Flatten obligation deposits across all markets into displayable rows.
// Each row = one token deposit. Groups by mint so multiple obligations
// holding the same token combine into one row.
// =====================================================================
function flattenDeposits(allObligations) {
  const byMint = {};

  for (const obl of allObligations) {
    // Schema: ObligationMetrics.deposits[] with { mintAddress, amount, marketValueRefreshed }
    // Older shapes may use { tokenMint, tokenAmount, tokenValue }.
    const deposits = Array.isArray(obl?.deposits) ? obl.deposits : [];
    for (const dep of deposits) {
      const mint = dep?.mintAddress || dep?.tokenMint;
      if (!mint) continue;
      const amount = Number(dep?.amount || dep?.tokenAmount || 0);
      // marketValueRefreshed is the authoritative USD value from Kamino's
      // oracles. Falls back to amount only for stables where 1:1 is OK.
      const meta   = TOKEN_META[mint];
      let usd      = Number(dep?.marketValueRefreshed || dep?.tokenValue || 0);
      if (!Number.isFinite(usd) || usd <= 0) {
        usd = meta?.isStable ? amount : 0;
      }
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (!byMint[mint]) byMint[mint] = { mint, amount: 0, valueUsd: 0 };
      byMint[mint].amount   += amount;
      byMint[mint].valueUsd += usd;
    }
  }

  return Object.values(byMint).filter(d => d.valueUsd >= DUST_USD);
}

// =====================================================================
// Public API. Returns: [{ protocol, amount, valueUsd, symbol, withdrawUrl, color }, ...]
// Empty array if user has no position OR API is unreachable.
// =====================================================================
export async function readEarnPositions({ walletAddress } = {}) {
  if (!walletAddress || typeof walletAddress !== 'string') return [];

  // Parallel fetch across all known markets — 4s timeout each, so worst
  // case the whole call takes ~4s, not Nx4s.
  const marketResults = await Promise.all(
    Object.entries(MARKETS).map(([key, addr]) =>
      fetchMarketObligations(key, addr, walletAddress)
    )
  );

  const allObligations = marketResults.flat();
  if (allObligations.length === 0) return [];

  const deposits = flattenDeposits(allObligations);
  if (deposits.length === 0) return [];

  // Return one row per token deposit. UI sums them or shows individually.
  // The total "amount" field is preserved for backwards-compat with the
  // existing Portfolio.jsx which reads position.amount; we set it to the
  // USD value, which is what the UI displays.
  return deposits.map(d => {
    const meta = TOKEN_META[d.mint];
    return {
      protocol:    'Kamino',
      symbol:      meta?.symbol || (d.mint.slice(0, 4) + '...'),
      mint:        d.mint,
      amount:      d.valueUsd,        // back-compat: Portfolio.jsx reads `amount` as the USD value
      tokenAmount: d.amount,          // raw token amount (for future use)
      valueUsd:    d.valueUsd,
      withdrawUrl: PROTOCOLS.Kamino.withdrawUrl,
      color:       PROTOCOLS.Kamino.color,
    };
  });
}
