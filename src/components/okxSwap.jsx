// =====================================================================
// okxSwap.js — fetch OKX DEX aggregator swap instructions via our backend.
//
// The Nexus backend at /api/okx/dex/aggregator/swap-instruction handles:
//   - HMAC signing with OKX credentials
//   - Automatic 5% referral fee injection (server's OKX_SOL_FEE_PCT)
//   - Routing the fee to OKX_FEE_WALLET_SOL (treasury)
//
// We just call our own backend and convert the response to web3.js
// instruction objects ready to be added to a versioned transaction.
//
// Reference: OKX swap-instruction endpoint
//   GET /api/v6/dex/aggregator/swap-instruction
//   Returns: {
//     code: "0",
//     data: {
//       addressLookupTableAccount: [<lut_address>, ...],
//       createTokenAccountList: [<token_account>, ...],
//       instructionLists: [
//         { data: "<base64>", accounts: [{pubkey, isSigner, isWritable}], programId }
//       ]
//     }
//   }
// =====================================================================

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const OKX_SOLANA_CHAIN = '501';
const USDC_MINT_STR    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// SUPPORTED INPUT TOKENS (extend later — keep small for fewer edge cases)
// Native SOL uses the special "11111111111111111111111111111111" address.
export const SUPPORTED_INPUT_TOKENS = [
  { symbol: 'USDC', mint: USDC_MINT_STR,                                   decimals: 6, isNative: false },
  { symbol: 'SOL',  mint: '11111111111111111111111111111111',               decimals: 9, isNative: true  },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  decimals: 6, isNative: false },
  { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',   decimals: 6, isNative: false },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, isNative: false },
];

// =====================================================================
// fetchOkxSwapInstructions
//
// Returns:
//   {
//     instructions: TransactionInstruction[],
//     lutAddresses: string[],
//     estimatedUsdcOut: number  (in human-readable USDC, not lamports)
//   }
// =====================================================================
export async function fetchOkxSwapInstructions({
  fromTokenMint,
  amountLamports,       // BigInt or string — raw smallest-unit amount of input token
  userWalletAddress,
  slippagePercent = '0.5',
}) {
  if (!fromTokenMint || !amountLamports || !userWalletAddress) {
    throw new Error('Missing required OKX swap params');
  }

  const params = new URLSearchParams({
    chainIndex:       OKX_SOLANA_CHAIN,
    amount:           String(amountLamports),
    fromTokenAddress: fromTokenMint,
    toTokenAddress:   USDC_MINT_STR,
    slippagePercent,
    userWalletAddress,
    autoSlippage:     'false',
    // NOTE: feePercent + toTokenReferrerWalletAddress are injected
    // server-side by /api/okx proxy (injectOkxFee). We don't set them here.
  });

  const url = `/api/okx/dex/aggregator/swap-instruction?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OKX swap-instruction failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const body = await res.json();

  // OKX returns { code: "0", data: { ... } } on success.
  // On error it returns { code: "nonzero", msg: "..." } or { error: "..." }
  if (body.code && body.code !== '0') {
    throw new Error(`OKX error: ${body.msg || body.code}`);
  }
  if (body.error) {
    throw new Error(`OKX error: ${body.error}`);
  }

  const data = body.data;
  if (!data || !data.instructionLists || !Array.isArray(data.instructionLists)) {
    throw new Error('OKX returned no instructions');
  }

  // Convert OKX's instruction format to web3.js TransactionInstruction
  const instructions = data.instructionLists.map(ix => new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts || []).map(k => ({
      pubkey:     new PublicKey(k.pubkey),
      isSigner:   Boolean(k.isSigner),
      isWritable: Boolean(k.isWritable),
    })),
    data: Buffer.from(ix.data || '', 'base64'),
  }));

  // Worst-case USDC output (after slippage). This is the amount we can SAFELY
  // tell Kamino to deposit, because the swap guarantees AT LEAST this much.
  // If we use the estimate instead, slippage variance can cause the Kamino
  // deposit to fail mid-tx with "insufficient USDC".
  const minOutRaw = Number(
    data.tx?.minToTokenAmount ||
    data.routerResult?.minToTokenAmount ||
    data.minToTokenAmount ||
    0
  );
  const minUsdcOut = minOutRaw / 1e6;

  // Estimated USDC output (after slippage) for UI preview. OKX returns this
  // in various places depending on endpoint version; we try a few keys.
  const estimatedRaw = Number(
    data.toTokenAmount ||
    data.tx?.minToTokenAmount ||
    data.routerResult?.toTokenAmount ||
    0
  );
  const estimatedUsdcOut = estimatedRaw / 1e6; // USDC has 6 decimals

  return {
    instructions,
    lutAddresses: data.addressLookupTableAccount || [],
    estimatedUsdcOut,
    minUsdcOut,
  };
}

// =====================================================================
// fetchOkxQuote — lightweight quote for UI display only.
// Doesn't return instructions. Used to show "~$X USDC" preview.
// =====================================================================
export async function fetchOkxQuote({ fromTokenMint, amountLamports }) {
  if (!fromTokenMint || !amountLamports) return null;
  if (fromTokenMint === USDC_MINT_STR) return null; // no swap needed for USDC

  const params = new URLSearchParams({
    chainIndex:       OKX_SOLANA_CHAIN,
    amount:           String(amountLamports),
    fromTokenAddress: fromTokenMint,
    toTokenAddress:   USDC_MINT_STR,
    slippagePercent:  '0.5',
  });

  try {
    const res = await fetch(`/api/okx/dex/aggregator/quote?${params}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (body.code && body.code !== '0') return null;
    const data = body.data?.[0] || body.data;
    if (!data) return null;
    const amt = Number(data.toTokenAmount || 0) / 1e6;
    return amt > 0 ? amt : null;
  } catch {
    return null;
  }
}
