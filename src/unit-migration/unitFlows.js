# /* ============================================================
unitFlows.js — High-level deposit/withdraw/trade orchestrators

This module wires together Unit + HL agent + spot transfers + perps
into the four user-visible flows:

1. onboardUser()             — first-time setup (1 Solana sig already done, 2 HL sigs)
1. depositSolAndOpen()       — full deposit + open position (1 Solana + 1 HL sig)
1. openFromHlBalance()       — trade from existing HL USDC (0 sigs)
1. closePosition()           — instant close (0 sigs)
1. withdrawToSolanaWallet()  — bring SOL back home (2 HL sigs)

Each function takes a `callbacks` object with status callbacks so the
UI can show progress. None of them call setState — they’re pure
business logic.

============================================================ */

import { signL1Action } from ‘@nktkas/hyperliquid/signing’;

import {
getEthers, getEthersNs, withAgentSigner, ensureAgentApproved,
isAgentApproved, getStoredAgent, nextNonce,
} from ‘./hlAgentWallet.js’;

import {
submitUsdClassTransfer, submitSpotSend,
findSpotToken, findSpotPair, spotAvailableOf,
} from ‘./hlSpotTransfers.js’;

import {
submitSpotSwap, autoSwapUsolToUsdc, autoSwapUsdcToUsol,
} from ‘./hlSpotSwap.js’;

import {
getUnitDepositAddress, getUnitWithdrawAddress, getUnitOperations,
waitForDepositComplete, waitForWithdrawComplete,
isOperationDone, operationStatusLabel,
UNIT_MIN_SOL_DEPOSIT,
} from ‘./unitClient.js’;

// ––––– Builder approval helper –––––

const BUILDER_APPROVED_CACHE = ‘nexus_builder_approved_’;

/**

- Sign the approveBuilderFee user-signed action.
- Same pattern as approveAgent but with the ApproveBuilderFee schema.
  */
  async function signApproveBuilderFee(masterPrivateKey, action) {
  const { signTypedDataCompat, splitSigCompat } = await import(’./hlAgentWallet.js’);
  const mod = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet = new ethersNs.Wallet(masterPrivateKey);
  const domain = {
  name: ‘HyperliquidSignTransaction’, version: ‘1’,
  chainId: 42161,
  verifyingContract: ‘0x0000000000000000000000000000000000000000’,
  };
  const types = {
  ‘HyperliquidTransaction:ApproveBuilderFee’: [
  { name: ‘hyperliquidChain’, type: ‘string’ },
  { name: ‘maxFeeRate’,       type: ‘string’ },
  { name: ‘builder’,          type: ‘string’ },
  { name: ‘nonce’,            type: ‘uint64’ },
  ],
  };
  const message = {
  hyperliquidChain: action.hyperliquidChain,
  maxFeeRate:       action.maxFeeRate,
  builder:          action.builder,
  nonce:            action.nonce,
  };
  const sig = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
  }

/**

- Approve the builder fee for both perps and spot at the user’s chosen max.
- A single approveBuilderFee with maxFeeRate “1%” covers both perps (max
- 10bp, individually checked) and spot (max 100bp).
  */
  async function ensureBuilderApproved({
  masterPrivateKey,
  hlAddress,
  builderAddress,
  maxFeeRate,         // e.g. “1%” (covers spot ceiling)
  hlRequest,
  }) {
  if (!builderAddress) return;
  const cacheKey = `${BUILDER_APPROVED_CACHE}${hlAddress.toLowerCase()}_${builderAddress.toLowerCase()}`;
  try { if (localStorage.getItem(cacheKey) === ‘1’) return; } catch {}
  const nonce = nextNonce();
  const action = {
  type:             ‘approveBuilderFee’,
  hyperliquidChain: ‘Mainnet’,
  signatureChainId: ‘0xa4b1’,
  maxFeeRate,
  builder:          builderAddress.toLowerCase(),
  nonce,
  };
  const signature = await signApproveBuilderFee(masterPrivateKey, action);
  const result = await hlRequest({ action, nonce, signature }, true);
  if (result?.status === ‘err’) {
  const reason = typeof result?.response === ‘string’
  ? result.response : JSON.stringify(result);
  throw new Error(`Builder approval failed: ${reason}`);
  }
  try { localStorage.setItem(cacheKey, ‘1’); } catch {}
  }

// ––––– Flow 1: onboardUser –––––

/**

- One-time onboarding. Idempotent — safe to call on every connect.
- If everything is already approved, returns immediately without prompting.
- 
- @param {object} args - {
- masterPrivateKey,    // HL-derived key from Solana sig
- hlAddress,           // HL-derived address
- builderAddress,      // your fee wallet (0x..)
- builderMaxFeeRate,   // e.g. “1%”
- hlRequest,           // your hlRequest helper
- onStep,              // optional callback(stepName) for UI status
- }
  */
  export async function onboardUser({
  masterPrivateKey,
  hlAddress,
  builderAddress,
  builderMaxFeeRate = ‘1%’,
  hlRequest,
  onStep = null,
  }) {
  const step = (label) => { if (onStep) try { onStep(label); } catch {} };

// Step 1: agent
if (!isAgentApproved(hlAddress)) {
step(‘Authorizing trading agent…’);
await ensureAgentApproved({ masterPrivateKey, hlAddress, hlRequest });
}

// Step 2: builder fee
if (builderAddress) {
step(‘Authorizing fee structure…’);
await ensureBuilderApproved({
masterPrivateKey, hlAddress, builderAddress,
maxFeeRate: builderMaxFeeRate, hlRequest,
});
}

step(‘Setup complete’);
return { ok: true };
}

// ––––– Flow 2: depositSolAndOpen –––––

/**

- Full flow: take SOL from user’s Solana wallet, bridge via Unit, swap
- to USDC, transfer to perp, open position. The Solana send is done by
- the caller (using their wallet adapter) — this orchestrator handles
- everything after the Solana sig.
- 
- @param {object} args - {
- masterPrivateKey,   hlAddress,
- builderAddress,     builderFeePerpsTbp, builderFeeSpotTbp,
- solanaTxHash,       // the Solana TX where SOL was sent to Unit
- pair,               // perp pair object (your existing structure)
- isLong,             usdAmount, leverage,
- placeOrder,         // your existing placeOrder fn from PerpsTrade.js
- hlRequest,
- onStep,
- }
  */
  export async function depositSolAndOpen({
  masterPrivateKey, hlAddress,
  builderAddress, builderFeePerpsTbp, builderFeeSpotTbp,
  solanaTxHash,
  pair, isLong, usdAmount, leverage,
  placeOrder,
  hlRequest,
  onStep = null,
  }) {
  const step = (label) => { if (onStep) try { onStep(label); } catch {} };

// 1. Wait for Unit to credit uSOL to the HL spot wallet
step(‘Bridging via Unit…’);
await waitForDepositComplete({
hlAddress,
sourceTxHash: solanaTxHash,
onUpdate: (op) => step(`Bridging: ${operationStatusLabel(op)}`),
});

// 2. Read uSOL balance from spot
step(‘Reading spot balance…’);
const spotState = await hlRequest({ type: ‘spotClearinghouseState’, user: hlAddress });
const usolBalance = spotAvailableOf(spotState, ‘SOL’);
if (usolBalance <= 0) throw new Error(‘No uSOL in spot wallet after Unit deposit’);

// 3. Agent silently swaps uSOL → USDC
step(‘Converting to USDC…’);
const swapResult = await autoSwapUsolToUsdc({
hlAddress, solBalance: usolBalance,
builderAddress, builderFeeTenthsBp: builderFeeSpotTbp,
hlRequest,
});

// 4. Re-read USDC balance
const spotState2 = await hlRequest({ type: ‘spotClearinghouseState’, user: hlAddress });
const usdcSpotBalance = spotAvailableOf(spotState2, ‘USDC’);
if (usdcSpotBalance <= 0) throw new Error(‘No USDC in spot wallet after auto-swap’);

// 5. USER signs usdClassTransfer (spot → perp).
//    This is the one HL signature the user must approve mid-flow.
step(‘Moving USDC to perpetual account (please sign)…’);
await submitUsdClassTransfer({
masterPrivateKey,
amount: usdcSpotBalance.toFixed(6),
toPerp: true,
hlRequest,
});

// 6. Agent silently opens the perp position.
step(‘Opening position…’);
const result = await placeOrder({
pair, isLong,
usdAmount: usdAmount || usdcSpotBalance,   // use deposit if no override
leverage,
reduceOnly: false,
hlWalletData: { privateKey: masterPrivateKey, address: hlAddress },
// ^^ placeOrder in your existing code uses the master key. You’ll want
//    to refactor it to accept an agent wallet override; see the
//    integration notes in README.md.
});

step(‘Position open’);
return { ok: true, swap: swapResult, order: result };
}

// ––––– Flow 3: openFromHlBalance –––––

/**

- Fast path: USDC already in perp account. Just place the order.
- Zero user signatures — agent does everything.
  */
  export async function openFromHlBalance({
  hlAddress,
  pair, isLong, usdAmount, leverage,
  placeOrder,
  onStep = null,
  }) {
  const step = (label) => { if (onStep) try { onStep(label); } catch {} };

if (!isAgentApproved(hlAddress)) {
throw new Error(‘Agent not approved — please complete onboarding’);
}

step(‘Opening position…’);
// Caller is expected to use placeOrder that signs with the agent key.
// See notes below in withAgentSign helper.
const result = await placeOrder({
pair, isLong, usdAmount, leverage,
reduceOnly: false,
// hlWalletData passed by caller, using the agent wallet
});

step(‘Position open’);
return { ok: true, order: result };
}

// ––––– Flow 4: closePosition –––––

/**

- Close an open position (full or partial) via reduce-only order.
- Zero user signatures.
  */
  export async function closePosition({
  hlAddress,
  pair, currentSizeBase, isLong, sizeOverride,
  placeOrder,
  onStep = null,
  }) {
  const step = (label) => { if (onStep) try { onStep(label); } catch {} };

if (!isAgentApproved(hlAddress)) {
throw new Error(‘Agent not approved’);
}

step(‘Closing position…’);
// reduceOnly order in the OPPOSITE direction of the position
const result = await placeOrder({
pair,
isLong: !isLong,                  // opposite direction
usdAmount: 0,                     // ignored when sizeOverride set
leverage: 1,                      // ignored for reduce-only
reduceOnly: true,
sizeOverride: sizeOverride || currentSizeBase,
});

step(‘Position closed’);
return { ok: true, order: result };
}

// ––––– Flow 5: withdrawToSolanaWallet –––––

/**

- Full withdraw flow: USDC in perp → SOL in user’s Solana wallet.
- 
- @param {object} args - {
- masterPrivateKey, hlAddress,
- solanaAddress,        // user’s Solana wallet (destination)
- usdcAmount,           // how much to withdraw in USD
- hlRequest,
- onStep,
- }
  */
  export async function withdrawToSolanaWallet({
  masterPrivateKey, hlAddress,
  solanaAddress,
  usdcAmount,
  hlRequest,
  onStep = null,
  }) {
  const step = (label) => { if (onStep) try { onStep(label); } catch {} };

// 1. USER signs usdClassTransfer (perp → spot)
step(‘Moving USDC from perp (please sign)…’);
await submitUsdClassTransfer({
masterPrivateKey,
amount: Number(usdcAmount).toFixed(6),
toPerp: false,
hlRequest,
});

// 2. Agent silently swaps USDC → uSOL
step(‘Converting USDC to SOL…’);
await autoSwapUsdcToUsol({
hlAddress,
usdcAmount: Number(usdcAmount),
hlRequest,
});

// 3. Read the resulting uSOL balance
const spotState = await hlRequest({ type: ‘spotClearinghouseState’, user: hlAddress });
const usolBalance = spotAvailableOf(spotState, ‘SOL’);
if (usolBalance <= 0) throw new Error(‘No uSOL after swap — withdraw aborted’);

// 4. Generate the Unit withdraw address (HL-side) for this Solana wallet
step(‘Generating withdraw address…’);
const { address: unitHlWithdrawAddr } = await getUnitWithdrawAddress(solanaAddress);

// 5. Look up the uSOL token id from spotMeta
const spotMeta = await hlRequest({ type: ‘spotMeta’ });
const solToken = findSpotToken(spotMeta, ‘SOL’);
if (!solToken) throw new Error(‘SOL token not found in spotMeta’);

// 6. USER signs spotSend to push uSOL to Unit
step(‘Sending to Unit (please sign)…’);
const sendResult = await submitSpotSend({
masterPrivateKey,
destination: unitHlWithdrawAddr,
tokenName:   solToken.name,
tokenId:     solToken.tokenId,
amount:      usolBalance.toString(),
hlRequest,
});

// 7. Find the source tx hash to track the operation. HL spotSend
//    responses include a hash we can match against /operations.
//    If we can’t find it, just wait by polling for any new withdraw op.
step(‘Waiting for Solana delivery…’);
const hlSendTxHash = sendResult?.response?.data?.hash
|| sendResult?.response?.txHash
|| null;

// 8. Poll Unit until done
if (hlSendTxHash) {
await waitForWithdrawComplete({
hlAddress,
sourceTxHash: hlSendTxHash,
onUpdate: (op) => step(`Withdraw: ${operationStatusLabel(op)}`),
});
} else {
// Fallback: just wait the typical duration and let user verify
await new Promise(r => setTimeout(r, 5 * 60 * 1000));
}

step(‘SOL delivered to your wallet’);
return { ok: true };
}

// ––––– Helpers exported for the UI –––––

export {
getUnitDepositAddress, getUnitWithdrawAddress, getUnitOperations,
isAgentApproved, getStoredAgent,
UNIT_MIN_SOL_DEPOSIT,
};

// ––––– Notes for the UI –––––
/*

To wire openFromHlBalance / closePosition to your existing placeOrder
function, you need a small refactor:

In your current PerpsTrade.js, placeOrder receives `hlWalletData` (the
master wallet). You’ll change it to optionally receive an agent wallet
instead, like:

async function placeOrder({
…, hlWalletData, agentWalletData = null,
}) {
const signingWallet = agentWalletData || hlWalletData;
// use signingWallet.privateKey for signing the L1 action
// STILL use hlWalletData.address for the cache keys / leverage cache
//   (because nonces are per-signer but the user identity is the master)
}

Then in the new flow:

import { getStoredAgent } from ‘./hlAgentWallet’;
const agent = getStoredAgent(hlAddress);
await placeOrder({
…,
hlWalletData: { address: hlAddress, privateKey: masterPrivateKey },
agentWalletData: agent ? { address: agent.address, privateKey: agent.privateKey } : null,
});

This keeps backward compatibility (no agent = sign with master) while
enabling silent trading once the agent is approved.

*/