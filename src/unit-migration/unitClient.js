# /* ============================================================
unitClient.js — Hyperunit REST API client (browser-side)

This module talks to your server’s /api/unit/* proxy endpoints,
which forward to https://api.hyperunit.xyz.

No secrets. No API keys. Public REST.
============================================================ */

// —– helpers —–

const UNIT_PROXY_BASE = ‘/api/unit’;

async function postJSON(path, body, timeoutMs = 10_000) {
const ctrl = typeof AbortController !== ‘undefined’ ? new AbortController() : null;
const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
try {
const res = await fetch(`${UNIT_PROXY_BASE}${path}`, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify(body || {}),
signal: ctrl?.signal,
});
let data = null;
try { data = await res.json(); } catch {}
if (!res.ok) {
throw new Error(data?.error || data?.detail || `unit proxy error (${res.status})`);
}
return data;
} finally {
if (timer) clearTimeout(timer);
}
}

// —– public API —–

/**

- Get or generate the user’s permanent SOL deposit address.
- Idempotent — Unit returns the same address every time for a given HL account.
- 
- @param {string} hlAddress - the user’s HL-derived address (0x…)
- @returns {Promise<{ address: string, coinType: number }>}
- address: the Solana address to send SOL to
- coinType: SLIP-44 coin type (501 for SOL)
  */
  export async function getUnitDepositAddress(hlAddress) {
  if (!hlAddress || !/^0x[0-9a-fA-F]{40}$/.test(hlAddress)) {
  throw new Error(‘Invalid HL address’);
  }
  return await postJSON(’/deposit-address’, { hlAddress });
  }

/**

- Get or generate the user’s permanent uSOL withdraw address.
- The returned 0x address is on Hyperliquid — sending uSOL there triggers
- Unit to relay native SOL back to the user’s Solana wallet.
- 
- @param {string} solanaAddress - the user’s Solana wallet (base58)
- @returns {Promise<{ address: string, coinType: number }>}
- address: the HL address to send uSOL to
- coinType: SLIP-44 coin type (60 for Eth-style HL addresses)
  */
  export async function getUnitWithdrawAddress(solanaAddress) {
  if (!solanaAddress || solanaAddress.length < 32 || solanaAddress.length > 44) {
  throw new Error(‘Invalid Solana address’);
  }
  return await postJSON(’/withdraw-address’, { solanaAddress });
  }

/**

- Fetch the user’s recent Unit operations (deposits and withdraws).
- Sorted by opCreatedAt descending.
- 
- @param {string} hlAddress - the user’s HL-derived address
- @returns {Promise<{ operations: Operation[] }>}
- 
- Each Operation has:
- operationId, opCreatedAt, protocolAddress, sourceAddress, destinationAddress,
- sourceChain, destinationChain, sourceAmount, destinationFeeAmount, sweepFeeAmount,
- state, sourceTxHash, destinationTxHash, positionInWithdrawQueue, asset
- 
- State values: SourceTxDiscovered, WaitForSrcTxFinalization, BuildingDstTx,
- AdditionalChecks, SignTx, BroadcastTx, WaitForDstTxFinalization, Done
- (plus ReadyForWithdrawQueue, QueuedForWithdraw for ERC-20 deposits / withdraws)
  */
  export async function getUnitOperations(hlAddress) {
  if (!hlAddress || !/^0x[0-9a-fA-F]{40}$/.test(hlAddress)) {
  throw new Error(‘Invalid HL address’);
  }
  return await postJSON(’/operations’, { hlAddress });
  }

// —– helpers for working with operations —–

/**

- Check if an operation is a SOL deposit (Solana → HL).
  */
  export function isSolDeposit(op) {
  return op?.sourceChain === ‘solana’ && op?.destinationChain === ‘hyperliquid’ && op?.asset === ‘sol’;
  }

/**

- Check if an operation is a SOL withdraw (HL → Solana).
  */
  export function isSolWithdraw(op) {
  return op?.sourceChain === ‘hyperliquid’ && op?.destinationChain === ‘solana’ && op?.asset === ‘sol’;
  }

/**

- Check if an operation is in a terminal state (Done).
  */
  export function isOperationDone(op) {
  return op?.state === ‘Done’;
  }

/**

- Check if an operation has been started but not yet finalized.
  */
  export function isOperationInFlight(op) {
  if (!op?.state) return false;
  return op.state !== ‘Done’;
  }

/**

- Get a human-readable status label for an operation state.
- Used for UI display while users wait.
  */
  export function operationStatusLabel(op) {
  if (!op?.state) return ‘Unknown’;
  switch (op.state) {
  case ‘SourceTxDiscovered’:       return ‘Transaction detected’;
  case ‘WaitForSrcTxFinalization’: return ‘Waiting for finalization’;
  case ‘BuildingDstTx’:            return ‘Preparing transfer’;
  case ‘AdditionalChecks’:         return ‘Running checks’;
  case ‘SignTx’:                   return ‘Signing transaction’;
  case ‘BroadcastTx’:              return ‘Broadcasting’;
  case ‘WaitForDstTxFinalization’: return ‘Confirming on destination’;
  case ‘ReadyForWithdrawQueue’:    return ‘Queued’;
  case ‘QueuedForWithdraw’:        return ‘In withdraw queue’;
  case ‘Done’:                     return ‘Complete’;
  default:                         return op.state;
  }
  }

/**

- Estimate progress percent (0-100) for an operation state.
- Used for progress bars.
  */
  export function operationProgressPct(op) {
  if (!op?.state) return 0;
  const order = [
  ‘SourceTxDiscovered’,         // 10
  ‘WaitForSrcTxFinalization’,   // 30
  ‘BuildingDstTx’,              // 50
  ‘AdditionalChecks’,           // 60
  ‘SignTx’,                     // 70
  ‘BroadcastTx’,                // 80
  ‘WaitForDstTxFinalization’,   // 90
  ‘ReadyForWithdrawQueue’,      // 50 (alt path)
  ‘QueuedForWithdraw’,          // 75
  ‘Done’,                       // 100
  ];
  const pcts = [10, 30, 50, 60, 70, 80, 90, 50, 75, 100];
  const idx = order.indexOf(op.state);
  return idx >= 0 ? pcts[idx] : 0;
  }

/**

- Filter for in-flight deposit operations matching a given source tx hash.
- Useful right after the user submits a Solana TX — we want to find the
- matching Unit operation as it’s discovered.
  */
  export function findDepositByTxHash(operations, sourceTxHash) {
  if (!Array.isArray(operations) || !sourceTxHash) return null;
  return operations.find(o =>
  isSolDeposit(o) && o.sourceTxHash?.toLowerCase() === sourceTxHash.toLowerCase()
  ) || null;
  }

/**

- Filter for in-flight withdraw operations matching a given HL source tx hash.
  */
  export function findWithdrawByTxHash(operations, sourceTxHash) {
  if (!Array.isArray(operations) || !sourceTxHash) return null;
  return operations.find(o =>
  isSolWithdraw(o) && o.sourceTxHash?.toLowerCase() === sourceTxHash.toLowerCase()
  ) || null;
  }

/**

- Poll Unit’s /operations endpoint until a deposit matching the given
- sourceTxHash reaches state “Done” (or until timeout).
- 
- Resolves with the final operation, rejects on timeout.
  */
  export async function waitForDepositComplete({
  hlAddress,
  sourceTxHash,
  pollIntervalMs = 10_000,
  maxWaitMs = 10 * 60 * 1000, // 10 minutes
  onUpdate = null,
  }) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < maxWaitMs) {
  try {
  const { operations } = await getUnitOperations(hlAddress);
  const op = findDepositByTxHash(operations, sourceTxHash);
  if (op) {
  if (op.state !== lastState) {
  lastState = op.state;
  if (onUpdate) try { onUpdate(op); } catch {}
  }
  if (isOperationDone(op)) return op;
  }
  } catch (e) {
  // tolerate transient errors during polling
  console.warn(’[unit poll]’, e?.message);
  }
  await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(‘Deposit timed out — your funds are safe with Unit, please refresh and check operations’);
  }

/**

- Poll until a withdraw matching the given sourceTxHash reaches Done.
  */
  export async function waitForWithdrawComplete({
  hlAddress,
  sourceTxHash,
  pollIntervalMs = 10_000,
  maxWaitMs = 15 * 60 * 1000, // 15 minutes (withdraws can take longer)
  onUpdate = null,
  }) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < maxWaitMs) {
  try {
  const { operations } = await getUnitOperations(hlAddress);
  const op = findWithdrawByTxHash(operations, sourceTxHash);
  if (op) {
  if (op.state !== lastState) {
  lastState = op.state;
  if (onUpdate) try { onUpdate(op); } catch {}
  }
  if (isOperationDone(op)) return op;
  }
  } catch (e) {
  console.warn(’[unit poll]’, e?.message);
  }
  await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(‘Withdraw timed out — funds are safe, please check operations’);
  }

/* ============================================================
Constants useful for the UI layer
============================================================ */

/** Unit’s minimum SOL deposit. Smaller deposits are not picked up. */
export const UNIT_MIN_SOL_DEPOSIT = 0.2;

/** Approximate timing per the Unit docs. */
export const UNIT_TIMING = {
solanaFinality_seconds: 13,            // 32 confirmations on Solana
hlFinality_seconds: 210,               // 2000 blocks (~3.5 min) on HL
typicalDepositTotal_seconds: 180,      // ~3 min end to end
typicalWithdrawTotal_seconds: 300,     // ~5 min end to end
};