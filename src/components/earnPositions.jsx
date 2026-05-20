// =====================================================================
// earnPositions.js — read user's Kamino position via Kamino's public API.
//
// Always works (no localStorage dependency). Source of truth is on-chain
// data exposed via Kamino's API. Survives device changes, browser clears,
// long absences.
//
// API endpoint shape (per Kamino OpenAPI spec, LoanInfo schema):
//   GET /v2/kamino-lend/loans?owner={wallet}
//   Response: Array<LoanInfo>
//   Each LoanInfo has loanInfo.collateral.deposits[] with tokenMint,
//   tokenName, tokenAmount (decimal string), tokenValue (USD decimal).
//
// We try multiple endpoint shapes in order to survive API path drift.
// If all fail (network down, API down, schema changed), return [] — the
// UI shows no position and the user can still click through to Kamino.
// =====================================================================

const KAMINO_API = 'https://api.kamino.finance';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

// Public metadata — importable.
export const PROTOCOLS = {
  Kamino: { withdrawUrl: 'https://app.kamino.finance', color: '#7a5af8' },
};

// Candidate endpoint paths. Kamino's API has gone through multiple
// versions (v2, v3) and conventions; we try the documented and likely paths.
// Each candidate returns a function that builds the URL for a wallet.
const LOAN_ENDPOINT_CANDIDATES = [
  w => `${KAMINO_API}/v2/kamino-lend/loans?owner=${w}`,
  w => `${KAMINO_API}/kamino-lend/loans?owner=${w}`,
  w => `${KAMINO_API}/v3/users/${w}/loans`,
  w => `${KAMINO_API}/users/${w}/loans`,
  w => `${KAMINO_API}/v2/users/${w}/loans`,
];

// =====================================================================
// Try each candidate URL. Return the first response that:
//   - returns 200
//   - parses as JSON
//   - has a shape we recognize (array OR { loans: [...] } OR { obligations: [...] })
// =====================================================================
async function fetchLoansForWallet(walletAddress) {
  for (const buildUrl of LOAN_ENDPOINT_CANDIDATES) {
    try {
      const url = buildUrl(walletAddress);
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      // Normalize: handle array OR object with loans/obligations field
      const list = Array.isArray(data) ? data
                 : Array.isArray(data?.loans) ? data.loans
                 : Array.isArray(data?.obligations) ? data.obligations
                 : null;
      if (list) return list;
    } catch {
      // Network error, JSON parse error, etc — try next candidate
    }
  }
  return null;  // every candidate failed
}

// =====================================================================
// Extract Kamino main market USDC deposit from a list of loans.
// Returns { amount, valueUsd } or null.
// =====================================================================
function extractUsdcDeposit(loans) {
  if (!loans || loans.length === 0) return null;

  for (const loan of loans) {
    // Match the main market (LoanInfo.marketId)
    const marketId = loan?.marketId || loan?.market;
    if (marketId && marketId !== KAMINO_MAIN_MARKET) continue;

    // LoanInfo schema: loan.loanInfo.collateral.deposits[]
    // Some shapes may flatten this; try both.
    const deposits = loan?.loanInfo?.collateral?.deposits
                  || loan?.collateral?.deposits
                  || loan?.deposits;
    if (!Array.isArray(deposits)) continue;

    for (const dep of deposits) {
      const mint = dep?.tokenMint || dep?.mintAddress;
      if (mint !== USDC_MINT) continue;
      const amount = Number(dep?.tokenAmount || dep?.amount || 0);
      const valueUsd = Number(dep?.tokenValue || dep?.marketValueRefreshed || amount);
      if (amount > 0) {
        return { amount, valueUsd };
      }
    }
  }
  return null;
}

// =====================================================================
// Public API. Returns: [{ protocol, amount, withdrawUrl, color }, ...]
// Empty array if user has no position or API is unreachable.
// =====================================================================
export async function readEarnPositions({ walletAddress }) {
  if (!walletAddress) return [];

  const loans = await fetchLoansForWallet(walletAddress);
  if (!loans) return [];  // API unreachable on every candidate

  const usdc = extractUsdcDeposit(loans);
  if (!usdc) return [];

  return [{
    protocol:    'Kamino',
    amount:      usdc.amount,
    valueUsd:    usdc.valueUsd,
    withdrawUrl: PROTOCOLS.Kamino.withdrawUrl,
    color:       PROTOCOLS.Kamino.color,
  }];
}
