/** 
 * NEXUS DEX -- Shared Solana Swap Helper
 *
 * Single execution path used by:
 *   - InstantTrade.jsx (one-click Privy buy/sell on token pages)
 *   - (Tomorrow) SwapWidget.jsx executeSwap (refactor)
 *   - (Tomorrow) NewLaunches.js InstantTrade-on-card variant
 *
 * Behavior:
 *   - Solana <-> Solana via Jupiter v6 (via our /api/jupiter/swap proxy)
 *   - Platform fee 5% (locked) via Jupiter's platformFeeBps mechanism
 *   - Fee account = our SOL_FEE_WALLET's ATA on the OUTPUT mint
 *   - prioritizationFeeLamports structured (fixes the "out of range
 *     integral type conversion" error pic 1)
 *   - dynamicComputeUnitLimit = true (Jupiter computes optimal CU for us)
 *
 * Wallet branch:
 *   - kind === 'privy'  -> privyWallet.sendTransaction(tx, connection).
 *     Privy signs in-page, no popup. This is the killer one-click UX.
 *   - kind === external -> standard wallet-adapter pattern:
 *       const signed = await signTransaction(tx);
 *       const sig    = await connection.sendRawTransaction(signed.serialize(), ...);
 *
 * Locked rules:
 *   1. ONE wallet popup max (Privy: zero popups; external: one).
 *   2. Fee from output via aggregator (Jupiter platformFeeBps).
 *   3. Pricing via aggregator only.
 *   4. Routing: Jupiter for Solana <-> Solana (this helper's only domain).
 */

import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { Buffer } from 'buffer';

/* ============================================================================
 * LOCKED CONSTANTS -- match SwapWidget.jsx exactly.
 * ========================================================================= */

export const SOL_FEE_WALLET        = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
export const JUPITER_PLATFORM_FEE_BPS = 500;       // 5% (locked)
export const SOL_MINT              = 'So11111111111111111111111111111111111111112';
export const DEFAULT_SLIPPAGE_BPS  = 1500;         // 15% (memecoin default)
export const BLUE_CHIP_SLIPPAGE_BPS = 100;         // 1% (USDC, ETH, BTC, SOL)

const BLUE_CHIPS = new Set([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',   // mSOL
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',  // wETH
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',  // wBTC
]);

export function pickSlippageBps(toMint) {
  return BLUE_CHIPS.has(toMint) ? BLUE_CHIP_SLIPPAGE_BPS : DEFAULT_SLIPPAGE_BPS;
}

/* ============================================================================
 * JUPITER QUOTE + SWAP -- same proxy URLs as SwapWidget.
 * ========================================================================= */

async function fetchQuote({ inputMint, outputMint, amountRaw, slippageBps, signal }) {
  const qs = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amountRaw),
    slippageBps: String(slippageBps),
    onlyDirectRoutes: 'false',
    platformFeeBps: String(JUPITER_PLATFORM_FEE_BPS),
  });
  const res = await fetch('/api/jupiter/swap/v1/quote?' + qs.toString(), { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Quote failed');
  if (!data.outAmount) throw new Error('No route');
  return data;
}

async function fetchSwapTx({ quoteResponse, userPublicKey, feeAccount, signal }) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: 5_000_000,
        priorityLevel: 'high',
      },
    },
  };
  if (feeAccount) body.feeAccount = feeAccount;
  const res = await fetch('/api/jupiter/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.swapTransaction) {
    throw new Error(data.error || 'Swap build failed');
  }
  return data;
}

/* ============================================================================
 * MAIN ENTRY -- executeSolanaSwap
 *
 * Args:
 *   fromMint        : string  (e.g., 'So111...112' for SOL)
 *   toMint          : string  (output mint)
 *   amountRaw       : string|number  (smallest unit; for SOL: lamports)
 *   slippageBps     : number  (optional, defaults via pickSlippageBps)
 *   publicKey       : PublicKey  (user's Solana pubkey)
 *   connection      : Connection (Solana web3 connection)
 *   wallet          : {
 *      kind          : 'phantom'|'solflare'|'walletconnect'|'privy'
 *      privyWallet   : Privy embedded wallet object  (when kind === 'privy')
 *      signTransaction : function (when external)
 *   }
 *   onStatus        : function (optional)
 *   signal          : AbortSignal (optional)
 *
 * Returns:
 *   { signature, quote, route }
 * ========================================================================= */

export async function executeSolanaSwap({
  fromMint,
  toMint,
  amountRaw,
  slippageBps,
  publicKey,
  connection,
  wallet,
  onStatus,
  signal,
}) {
  const status = typeof onStatus === 'function' ? onStatus : function () {};

  if (!fromMint || !toMint) throw new Error('Missing input/output mint');
  if (!publicKey) throw new Error('Wallet not connected');
  if (!connection) throw new Error('No Solana connection');
  if (!wallet || !wallet.kind) throw new Error('Wallet info missing');

  const slip = Number.isFinite(slippageBps) ? slippageBps : pickSlippageBps(toMint);

  // 1. Derive fee account ATA on output mint for SOL_FEE_WALLET.
  //    Jupiter sends platformFeeBps in OUTPUT units to this address.
  //    If the ATA doesn't exist, Jupiter's swap tx creates it (user
  //    pays rent ~0.00203 SOL one-time per output mint).
  const outputMintPk = new PublicKey(toMint);
  const feeWalletPk  = new PublicKey(SOL_FEE_WALLET);
  const feeAccount   = await getAssociatedTokenAddress(outputMintPk, feeWalletPk);

  // 2. Quote.
  status('Getting best price...');
  const quote = await fetchQuote({
    inputMint: fromMint,
    outputMint: toMint,
    amountRaw,
    slippageBps: slip,
    signal,
  });

  // 3. Swap tx.
  status('Building transaction...');
  const swapData = await fetchSwapTx({
    quoteResponse: quote,
    userPublicKey: publicKey.toString(),
    feeAccount: feeAccount.toString(),
    signal,
  });

  // 4. Deserialize.
  const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
  const tx    = VersionedTransaction.deserialize(txBuf);

  // 5. Sign + send. Branch on wallet kind.
  let signature;
  if (wallet.kind === 'privy') {
    if (!wallet.privyWallet) throw new Error('Privy wallet unavailable');
    status('Signing...');
    // Privy embedded path -- in-page signing.
    // Per Privy v2 Solana SDK: wallet.sendTransaction(tx, connection, opts).
    // For TRUE one-click (no Privy confirmation UI), pass uiOptions
    // showWalletUIs:false. The user's tap on the preset IS the consent;
    // showing a second confirmation defeats the GMGN-style instant UX.
    const sendOpts = wallet.instant
      ? { uiOptions: { showWalletUIs: false } }
      : undefined;
    if (typeof wallet.privyWallet.sendTransaction === 'function') {
      signature = await wallet.privyWallet.sendTransaction(tx, connection, sendOpts);
    } else if (typeof wallet.privyWallet.signTransaction === 'function') {
      // Fallback: sign with Privy, send via connection
      const signed = await wallet.privyWallet.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else {
      throw new Error('Privy wallet missing signing methods');
    }
  } else {
    if (typeof wallet.signTransaction !== 'function') {
      throw new Error('External wallet missing signTransaction');
    }
    status('Confirm in wallet...');
    const signed = await wallet.signTransaction(tx);
    status('Sending...');
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
  }

  // 6. Confirm.
  status('Confirming...');
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed'
  );

  status('Done!');
  return { signature, quote };
}

/* ============================================================================
 * QUICK HELPERS for InstantTrade -- buy / sell with USD presets.
 * ========================================================================= */

/**
 * Quick BUY: spend $usdAmount of SOL on `toMint`.
 * Caller provides solPriceUsd (from Jupiter price API, cached upstream).
 */
export async function quickBuySol({
  toMint,
  usdAmount,
  solPriceUsd,
  publicKey,
  connection,
  wallet,
  onStatus,
  signal,
}) {
  if (!solPriceUsd || solPriceUsd <= 0) throw new Error('SOL price unavailable');
  const solAmount = usdAmount / solPriceUsd;
  const lamports  = Math.floor(solAmount * 1_000_000_000);
  if (lamports <= 0) throw new Error('Amount too small');
  return executeSolanaSwap({
    fromMint: SOL_MINT,
    toMint,
    amountRaw: lamports,
    publicKey,
    connection,
    wallet,
    onStatus,
    signal,
  });
}

/**
 * Convert a human token amount to raw base-unit string, WITHOUT going
 * through float precision (which silently corrupts at >2^53 base units,
 * e.g., billion-supply memecoin at 9 decimals = 10^18 base units).
 */
function humanToRawAmount(humanAmount, decimals) {
  if (!Number.isFinite(humanAmount) || humanAmount <= 0) return '0';
  const dec = Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 9;
  // Use a high-precision string representation. toFixed handles the
  // common case; for very small numbers we expand exponent notation.
  let s = humanAmount.toFixed(dec);
  // Strip trailing zeros only if no fractional part remains
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const [intPart, fracPart = ''] = s.split('.');
  const fracPadded = fracPart.padEnd(dec, '0').slice(0, dec);
  const combined = (intPart + fracPadded).replace(/^0+(?=\d)/, '');
  if (!combined || combined === '') return '0';
  try {
    return BigInt(combined).toString();
  } catch (e) {
    return '0';
  }
}

/**
 * Quick SELL: sell `pct` (1-100) of user's balance of `fromMint` to SOL.
 * Caller provides current balance (in human units) and decimals.
 */
export async function quickSellSol({
  fromMint,
  fromBalance,
  fromDecimals,
  pct,
  publicKey,
  connection,
  wallet,
  onStatus,
  signal,
}) {
  if (!fromBalance || fromBalance <= 0) throw new Error('No balance to sell');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Invalid percentage');
  // For 100% sells, use the entire balance; otherwise scale by pct.
  // Multiply BEFORE the human->raw conversion so we don't lose precision.
  const sellHuman = pct === 100 ? fromBalance : (fromBalance * (pct / 100));
  const dec = Number.isFinite(fromDecimals) ? fromDecimals : 9;
  const amountRaw = humanToRawAmount(sellHuman, dec);
  if (amountRaw === '0') throw new Error('Amount too small');
  return executeSolanaSwap({
    fromMint,
    toMint: SOL_MINT,
    amountRaw,
    publicKey,
    connection,
    wallet,
    onStatus,
    signal,
  });
}
