# /* ============================================================
hlSpotSwap.js — HL spot orderbook swap helpers (agent-signable)

This is the auto-swap leg of the Unit deposit/withdraw flow:

- Deposit:  uSOL → USDC on HL spot (so it can be moved into perp)
- Withdraw: USDC → uSOL on HL spot (so it can be sent to Unit
  withdraw address)

We use IOC (immediate-or-cancel) limit orders at aggressive prices
to mimic market orders. HL doesn’t have true market orders.

Important price/size details:

- Order size (sz) is in BASE token units, with szDecimals precision
- Order price (px) is the quote/base price, with 5 significant figures
  and (8 − szDecimals) max decimal places for non-spot, (8 − szDecimals)
  for spot. We just round to 5 sig figs and trust the orderbook.
- The agent wallet signs these (they’re L1 actions)
- Builder fee is included on the SELL side only (HL rule: spot builder
  fee applies to quote-receiving side only)

============================================================ */

import { signL1Action } from ‘@nktkas/hyperliquid/signing’;
import {
getEthers,
getEthersNs,
withAgentSigner,
nextNonce,
} from ‘./hlAgentWallet.js’;
import { findSpotPair, findSpotToken } from ‘./hlSpotTransfers.js’;

// —– price helpers —–

/**

- Round a number to 5 significant figures, the precision HL accepts.
- 
- Examples:
- formatPrice(195.5832)  → “195.58”
- formatPrice(0.0023417) → “0.0023417”
- formatPrice(1) → “1.0”
  */
  export function formatHlPrice(px, szDecimals = 0) {
  const n = Number(px);
  if (!isFinite(n) || n <= 0) throw new Error(‘Invalid price’);
  // 5 sig figs
  const sig5 = parseFloat(n.toPrecision(5));
  // Cap decimal places at 8 − szDecimals (spot rule) or just use 6 default
  const maxDecimals = Math.max(0, 8 - Number(szDecimals || 0));
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(sig5 * factor) / factor;
  // Stringify without trailing zeros but keep at least .0
  return rounded.toString();
  }

/**

- Round a size to the appropriate szDecimals precision.
  */
  export function formatHlSize(sz, szDecimals = 0) {
  const n = Number(sz);
  if (!isFinite(n) || n <= 0) throw new Error(‘Invalid size’);
  const factor = Math.pow(10, szDecimals);
  // Truncate down — never over-spend
  const rounded = Math.floor(n * factor) / factor;
  return rounded.toString();
  }

// —– market price lookup —–

/**

- Get the current mid price for a spot pair.
- 
- Uses the allMids info endpoint. Pair name is the `pairName` from
- findSpotPair (e.g. “@107” for HYPE/USDC).
- 
- For PURR/USDC (the canonical first spot pair), the key is literally
- “PURR/USDC”. For everything else it’s “@N” where N is the pair index.
  */
  export async function getSpotMidPrice({ pairName, hlRequest }) {
  const mids = await hlRequest({ type: ‘allMids’ });
  if (!mids || typeof mids !== ‘object’) throw new Error(‘Could not fetch mids’);
  const px = mids[pairName];
  if (px === undefined || px === null) {
  throw new Error(`No mid price for spot pair ${pairName}`);
  }
  return parseFloat(px);
  }

// —– build the IOC order action —–

/**

- Build an IOC limit order action targeting near-market price.
- 
- @param {object} args - {
- spotPair,     // result of findSpotPair()
- isBuy,        // true = buy base with quote, false = sell base for quote
- sizeBase,     // amount in base token (e.g. uSOL when SOL/USDC pair)
- midPrice,     // current mid (from getSpotMidPrice)
- slippagePct,  // e.g. 0.005 for 0.5%
- builderAddress,    // 0x.. or null/empty to skip
- builderFeeTenthsBp,// integer; spot builder fee can be up to 1000 (1%)
- ```
                   // Note: HL spot builder fee only applies on SELL side
  ```
- reduceOnly,   // bool; rarely true for spot, but supported
- }
  */
  export function buildSpotIocOrder({
  spotPair,
  isBuy,
  sizeBase,
  midPrice,
  slippagePct = 0.005,
  builderAddress = null,
  builderFeeTenthsBp = 0,
  reduceOnly = false,
  }) {
  if (!spotPair) throw new Error(‘spotPair required’);
  const { assetId, baseToken } = spotPair;

// Aggressive price: pay up to slippagePct above mid (when buying) or
// accept slippagePct below mid (when selling). IOC + aggressive price
// = market-like.
const limitPx = isBuy
? midPrice * (1 + slippagePct)
: midPrice * (1 - slippagePct);

const order = {
a: assetId,
b: !!isBuy,
p: formatHlPrice(limitPx, baseToken.szDecimals),
s: formatHlSize(sizeBase, baseToken.szDecimals),
r: !!reduceOnly,
t: { limit: { tif: ‘Ioc’ } },
};

const action = { type: ‘order’, orders: [order], grouping: ‘na’ };

// Add builder fee only on SELL side (HL spot rule).
// Builder fees on spot trades only apply to the quote-receiving side.
if (!isBuy && builderAddress && builderFeeTenthsBp > 0) {
action.builder = {
b: String(builderAddress).toLowerCase(),
f: Number(builderFeeTenthsBp),
};
}

return action;
}

// —– submit a swap via the agent —–

/**

- High-level: place an IOC spot market-like order signed by the agent.
- 
- @param {object} args - {
- hlAddress,             // master HL address (for agent lookup)
- spotPair,              // findSpotPair result
- isBuy,                 // true=buy base, false=sell base
- sizeBase,              // amount in base (number)
- slippagePct,           // optional, default 0.005
- builderAddress,        // optional fee recipient
- builderFeeTenthsBp,    // optional fee rate
- hlRequest,             // your hlRequest helper
- }
  */
  export async function submitSpotSwap({
  hlAddress,
  spotPair,
  isBuy,
  sizeBase,
  slippagePct = 0.005,
  builderAddress = null,
  builderFeeTenthsBp = 0,
  hlRequest,
  }) {
  // 1. Fetch current mid price
  const midPrice = await getSpotMidPrice({ pairName: spotPair.pairName, hlRequest });

// 2. Build the order action
const action = buildSpotIocOrder({
spotPair, isBuy, sizeBase, midPrice,
slippagePct, builderAddress, builderFeeTenthsBp,
});

// 3. Sign with the agent wallet
const agentWallet = await withAgentSigner(hlAddress);
const nonce = nextNonce();
const signature = await signL1Action({ wallet: agentWallet, action, nonce });

// 4. Submit
const result = await hlRequest({ action, nonce, signature }, true);

if (result?.status === ‘err’) {
const reason = typeof result?.response === ‘string’
? result.response : JSON.stringify(result);
throw new Error(`spot swap failed: ${reason}`);
}

// 5. Parse the fill from the response. HL response shape for an order:
//    { status: ‘ok’, response: { type: ‘order’, data: { statuses: […] } } }
return {
raw: result,
fills: parseSpotOrderFills(result, spotPair),
};
}

/**

- Best-effort parse of fill details from the HL order response.
- Returns { totalFilledBase, totalFilledQuote, avgPrice, error }.
- 
- If the order was rejected or partially-filled with significant slippage,
- the caller should inspect spot balances after to confirm what actually
- happened.
  */
  export function parseSpotOrderFills(result, spotPair) {
  const out = { totalFilledBase: 0, totalFilledQuote: 0, avgPrice: 0, error: null };
  const statuses = result?.response?.data?.statuses;
  if (!Array.isArray(statuses)) {
  out.error = ‘No status array in response’;
  return out;
  }
  for (const s of statuses) {
  if (s?.error) {
  out.error = s.error;
  continue;
  }
  const filled = s?.filled;
  if (filled) {
  const sz = parseFloat(filled.totalSz || filled.sz || 0);
  const px = parseFloat(filled.avgPx || filled.px || 0);
  out.totalFilledBase  += sz;
  out.totalFilledQuote += sz * px;
  }
  }
  if (out.totalFilledBase > 0) {
  out.avgPrice = out.totalFilledQuote / out.totalFilledBase;
  }
  return out;
  }

// —– convenience: sell ALL uSOL for USDC (auto-swap after deposit) —–

/**

- Sell the user’s entire uSOL spot balance for USDC. Used right after
- a Unit deposit credits uSOL to the spot wallet.
- 
- @param {object} args - {
- hlAddress,
- solBalance,          // current uSOL balance (from spotClearinghouseState)
- builderAddress,
- builderFeeTenthsBp,
- hlRequest,
- slippagePct,
- }
  */
  export async function autoSwapUsolToUsdc({
  hlAddress,
  solBalance,
  builderAddress,
  builderFeeTenthsBp,
  hlRequest,
  slippagePct = 0.005,
  }) {
  if (!solBalance || solBalance <= 0) return null;

const spotMeta = await hlRequest({ type: ‘spotMeta’ });
const pair = findSpotPair(spotMeta, ‘SOL’, ‘USDC’);
if (!pair) throw new Error(‘SOL/USDC spot pair not found on HL’);

return await submitSpotSwap({
hlAddress,
spotPair: pair,
isBuy: false,            // sell uSOL for USDC
sizeBase: solBalance,
slippagePct,
builderAddress,
builderFeeTenthsBp,
hlRequest,
});
}

/**

- Buy uSOL with a target USDC amount. Used during the withdraw flow.
- 
- @param {object} args - {
- hlAddress,
- usdcAmount,          // how much USDC to spend (number)
- hlRequest,
- slippagePct,
- }
- 
- Note: builder fee NOT applied on buy side (HL rule).
  */
  export async function autoSwapUsdcToUsol({
  hlAddress,
  usdcAmount,
  hlRequest,
  slippagePct = 0.005,
  }) {
  if (!usdcAmount || usdcAmount <= 0) return null;

const spotMeta = await hlRequest({ type: ‘spotMeta’ });
const pair = findSpotPair(spotMeta, ‘SOL’, ‘USDC’);
if (!pair) throw new Error(‘SOL/USDC spot pair not found on HL’);

// Convert USDC amount to expected uSOL size by dividing by mid price.
// We apply a conservative buffer so we don’t over-spend on slippage.
const mid = await getSpotMidPrice({ pairName: pair.pairName, hlRequest });
// Allow up to slippagePct over mid; we size so we never spend more than
// usdcAmount even at worst-case fill price.
const worstPx = mid * (1 + slippagePct);
const sizeBase = (usdcAmount / worstPx) * 0.999; // small safety margin

return await submitSpotSwap({
hlAddress,
spotPair: pair,
isBuy: true,             // buy uSOL with USDC
sizeBase,
slippagePct,
builderAddress: null,    // no builder fee on buy side
builderFeeTenthsBp: 0,
hlRequest,
});
}