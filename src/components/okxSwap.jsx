// =====================================================================
// okxSwap.js — uses the EXACT same pattern as the working Swap.jsx.
// All design choices below are copied verbatim from production code
// that already executes OKX swaps successfully.
// =====================================================================

import { Buffer } from 'buffer';
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

const OKX_REFERRER     = 'nexus-dex';
const OKX_SOL_NATIVE   = '11111111111111111111111111111111';
const WSOL_MINT        = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Supported input tokens for Earn deposits. SOL uses the WSOL mint for
// display/state, but gets translated to OKX's native placeholder via
// toOkxSolAddress() before being sent to OKX.
export const SUPPORTED_INPUT_TOKENS = [
  { symbol: 'USDC', mint: USDC_SOLANA, decimals: 6 },
  { symbol: 'SOL',  mint: WSOL_MINT,   decimals: 9 },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
];

// OKX expects "11111...111" for native SOL, not the WSOL mint.
function toOkxSolAddress(mint) {
  return mint === WSOL_MINT ? OKX_SOL_NATIVE : mint;
}

// =====================================================================
// fetchOkxSwapInstructions
//
// Returns { swapData } — the full OKX response. The caller uses
// buildOkxSolTx to assemble the actual VersionedTransaction.
// =====================================================================
export async function fetchOkxSwapInstructions({
  fromTokenMint,
  amountLamports,
  userWalletAddress,
}) {
  const params = new URLSearchParams({
    chainIndex:        '501',
    fromTokenAddress:  toOkxSolAddress(fromTokenMint),
    toTokenAddress:    toOkxSolAddress(USDC_SOLANA),
    amount:            String(amountLamports),
    slippagePercent:   '15',                  // matches working Swap.jsx
    userWalletAddress: userWalletAddress,
    referrer:          OKX_REFERRER,
  });

  const res = await fetch('/api/okx/dex/aggregator/swap-instruction?' + params.toString());
  const j   = await res.json();

  if (j.code !== '0' || !j.data) {
    throw new Error(j.msg || 'OKX swap-instruction failed');
  }
  return Array.isArray(j.data) ? j.data[0] : j.data;
}

// =====================================================================
// fetchOkxQuote — used for the live preview only (best-case estimate).
// =====================================================================
export async function fetchOkxQuote({ fromTokenMint, amountLamports }) {
  if (!fromTokenMint || !amountLamports) return null;
  if (fromTokenMint === USDC_SOLANA) return null;

  const params = new URLSearchParams({
    chainIndex:       '501',
    fromTokenAddress: toOkxSolAddress(fromTokenMint),
    toTokenAddress:   USDC_SOLANA,
    amount:           String(amountLamports),
  });
  try {
    const res = await fetch('/api/okx/dex/aggregator/quote?' + params.toString());
    const j   = await res.json();
    if (j.code !== '0' || !j.data) return null;
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    const out = Number(d.toTokenAmount) / 1e6;
    return out > 0 ? out : null;
  } catch {
    return null;
  }
}

// =====================================================================
// Convert one OKX instruction to a web3.js TransactionInstruction.
// =====================================================================
function deserializeOkxIx(ix) {
  try {
    if (!ix || !ix.programId || !Array.isArray(ix.accounts) || !ix.data) return null;
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map(a => ({
        pubkey:     new PublicKey(a.pubkey || a.publicKey || a.address),
        isSigner:   !!a.isSigner,
        isWritable: !!a.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    });
  } catch {
    return null;
  }
}

// =====================================================================
// buildOkxSolTx — build a signed-ready VersionedTransaction from OKX's
// swap-instruction response. Pattern copied directly from Swap.jsx.
//
// OKX can return one of two shapes:
//   1. A pre-serialized tx (swapData.tx.data or swapData.data) — we just
//      deserialize and return.
//   2. instructionLists[] + addressLookupTableAccount[] — we build it
//      ourselves from the parts.
// =====================================================================
export async function buildOkxSolTx({ connection, userPubkey, swapData }) {
  // Try pre-serialized tx first
  if (swapData.tx && swapData.tx.data) {
    try { return VersionedTransaction.deserialize(Buffer.from(swapData.tx.data, 'base64')); }
    catch {}
  }
  if (swapData.data && typeof swapData.data === 'string') {
    try { return VersionedTransaction.deserialize(Buffer.from(swapData.data, 'base64')); }
    catch {}
  }

  // Build from instructions
  const ixs = (swapData.instructionLists || []).map(deserializeOkxIx).filter(Boolean);
  if (!ixs.length) throw new Error('No usable instructions from OKX');

  // Fetch LUT accounts. Pattern from Swap.jsx: getAccountInfo +
  // AddressLookupTableAccount.deserialize, not getAddressLookupTable.
  const lutAddrs = Array.isArray(swapData.addressLookupTableAccount)
    ? swapData.addressLookupTableAccount : [];
  const luts = (await Promise.all(lutAddrs.map(async addr => {
    try {
      const acct = await connection.getAccountInfo(new PublicKey(addr));
      if (!acct) return null;
      return new AddressLookupTableAccount({
        key: new PublicKey(addr),
        state: AddressLookupTableAccount.deserialize(acct.data),
      });
    } catch { return null; }
  }))).filter(Boolean);

  const { blockhash } = await connection.getLatestBlockhash('finalized');
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey:        userPubkey,
      recentBlockhash: blockhash,
      instructions:    ixs,
    }).compileToV0Message(luts),
  );
}
 