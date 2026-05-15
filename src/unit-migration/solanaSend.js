# /* ============================================================
solanaSend.js — Send SOL from user’s wallet to a Unit deposit address

Wraps the Solana wallet adapter pattern for the specific case of
sending native SOL (no SPL token) to a Unit deposit address. The
amount must be >= UNIT_MIN_SOL_DEPOSIT (0.2 SOL).

Returns the transaction signature once confirmed.

============================================================ */

import {
PublicKey, SystemProgram, Transaction, ComputeBudgetProgram,
LAMPORTS_PER_SOL,
} from ‘@solana/web3.js’;

import { UNIT_MIN_SOL_DEPOSIT } from ‘./unitClient.js’;

/**

- Send SOL to the Unit deposit address.
- 
- @param {object} args - {
- connection,           // your Solana Connection
- wallet,                // wallet adapter (must have publicKey + sendTransaction)
- unitDepositAddress,    // base58 Solana address from getUnitDepositAddress()
- amountSol,             // number, e.g. 0.5
- priorityFeeMicroLamports, // optional, default 50_000 for mobile reliability
- onStatus,              // optional callback({ status, signature })
- }
- 
- @returns {Promise<string>} the confirmed Solana TX signature
  */
  export async function sendSolToUnit({
  connection,
  wallet,
  unitDepositAddress,
  amountSol,
  priorityFeeMicroLamports = 50_000,
  onStatus = null,
  }) {
  if (!wallet?.publicKey) throw new Error(‘Solana wallet not connected’);
  if (!unitDepositAddress) throw new Error(‘Unit deposit address required’);
  const amount = Number(amountSol);
  if (!isFinite(amount) || amount < UNIT_MIN_SOL_DEPOSIT) {
  throw new Error(`Minimum Unit deposit is ${UNIT_MIN_SOL_DEPOSIT} SOL`);
  }

const status = (s) => { if (onStatus) try { onStatus(s); } catch {} };

// 1. Resolve & validate the destination
let toPubkey;
try { toPubkey = new PublicKey(unitDepositAddress); }
catch { throw new Error(‘Invalid Unit deposit address’); }

// 2. Build the transaction
const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
const fromPubkey = wallet.publicKey;

// Get a recent blockhash with a reasonable lifetime
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(‘confirmed’);

const tx = new Transaction({ feePayer: fromPubkey, blockhash, lastValidBlockHeight });

// Priority fee — helps under Solana congestion (common on mainnet)
if (priorityFeeMicroLamports > 0) {
tx.add(ComputeBudgetProgram.setComputeUnitPrice({
microLamports: priorityFeeMicroLamports,
}));
// Reduce CU limit since this is a simple transfer
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }));
}

tx.add(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));

// 3. Sign & send via wallet adapter
status({ status: ‘signing’ });
let signature;
try {
signature = await wallet.sendTransaction(tx, connection, {
skipPreflight: false,
maxRetries: 3,
preflightCommitment: ‘confirmed’,
});
} catch (e) {
status({ status: ‘failed’, error: e?.message });
throw e;
}

status({ status: ‘submitted’, signature });

// 4. Wait for confirmation
try {
const conf = await connection.confirmTransaction({
signature, blockhash, lastValidBlockHeight,
}, ‘confirmed’);
if (conf?.value?.err) {
status({ status: ‘failed’, error: ‘Confirmation error’, signature });
throw new Error(`Solana TX failed: ${JSON.stringify(conf.value.err)}`);
}
} catch (e) {
// Some wallets / RPCs return before we can confirm; surface the sig
// so the caller can poll separately if needed.
status({ status: ‘confirm-failed’, signature, error: e?.message });
throw e;
}

status({ status: ‘confirmed’, signature });
return signature;
}

/**

- Read the user’s current SOL balance.
- Returns SOL as Number (not lamports).
  */
  export async function readSolBalance(connection, publicKey) {
  if (!publicKey) return 0;
  try {
  const lamports = await connection.getBalance(publicKey, ‘confirmed’);
  return lamports / LAMPORTS_PER_SOL;
  } catch {
  return 0;
  }
  }

/**

- Calculate the maximum SOL the user can send to Unit, reserving a small
- buffer for rent / future fees.
  */
  export function maxDepositableSol(walletSolBalance) {
  const RESERVE = 0.005;       // leave ~$1 for future fees
  const available = walletSolBalance - RESERVE;
  return Math.max(0, available);
  }