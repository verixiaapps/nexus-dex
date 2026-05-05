/**
 * NEXUS DEX -- Shared Pump.fun Trade Helper
 *
 * Used by:
 *   - NewLaunches.js TokenCard one-click preset buttons (zero-popup for Privy)
 *
 * Behavior:
 *   - PumpPortal /api/trade-local with action='buy' or 'sell'
 *   - Returns serialized VersionedTransaction (the trade)
 *   - We decompile, append SystemProgram.transfer for the 5% fee
 *     to SOL_FEE_WALLET, recompile to V0
 *   - Sign + send (Privy or external)
 *   - Atomic: PumpPortal trade + 5% fee settle in ONE transaction
 *
 * Wallet branch:
 *   - kind === 'privy' AND instant === true -> Privy embedded sendTransaction
 *     with showWalletUIs:false. ZERO popup. The user's tap on the preset
 *     IS their consent.
 *   - kind === 'privy' AND instant !== true -> Privy embedded sendTransaction
 *     with default UI (Privy shows tx confirmation modal).
 *   - kind === external -> wallet-adapter sendTransaction (1 popup).
 *
 * Locked rules:
 *   1. 5% fee to SOL_FEE_WALLET, atomically bundled (locked).
 *   2. ONE wallet popup max.
 *   3. Pump.fun bonding-curve only (pre-graduation). Graduated tokens use
 *      Jupiter via solanaSwap.js.
 */

import {
  VersionedTransaction, TransactionMessage, SystemProgram, PublicKey, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

export const SOL_FEE_WALLET    = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
export const PLATFORM_FEE_RATE = 0.05;  // 5% locked

const PUMP_PORTAL_URL = 'https://pumpportal.fun/api/trade-local';

/* ============================================================================
 * Inject the 5% platform fee into the PumpPortal-returned tx.
 * Single tx, atomic settlement. No co-signers, no splits.
 * ========================================================================= */
async function injectPlatformFee(connection, tx, fromPubkey, feeLamports) {
  if (!feeLamports || feeLamports <= 0) return tx;

  let lookupTableAccounts = [];
  const lookups = (tx.message && tx.message.addressTableLookups) || [];
  if (lookups.length > 0) {
    const resolved = await Promise.all(lookups.map(function (lt) {
      return connection.getAddressLookupTable(lt.accountKey)
        .then(function (r) { return r && r.value ? r.value : null; })
        .catch(function () { return null; });
    }));
    lookupTableAccounts = resolved.filter(Boolean);
  }

  const decompiled = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: lookupTableAccounts,
  });
  decompiled.instructions.push(SystemProgram.transfer({
    fromPubkey,
    toPubkey: new PublicKey(SOL_FEE_WALLET),
    lamports: feeLamports,
  }));
  const newMsg = decompiled.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMsg);
}

/* ============================================================================
 * MAIN ENTRY -- executePumpTrade
 *
 * Args:
 *   action          'buy' | 'sell'
 *   mint            pump.fun token mint string
 *   solAmount       (BUY only) SOL to spend, e.g., 0.15
 *   tokenAmount     (SELL only) token amount in HUMAN units (we convert)
 *   tokenPriceUsd   (SELL only) used to estimate SOL out for fee math
 *   solPriceUsd     (SELL only) ditto
 *   slippagePct     default 15 (memecoin appropriate)
 *   antiMev         bool -- sets higher priority fee
 *   publicKey       PublicKey of user
 *   connection      Solana Connection
 *   wallet          { kind, privyWallet, signTransaction, sendTransaction, instant }
 *   onStatus        optional status callback
 *
 * Returns:
 *   { signature }
 * ========================================================================= */
export async function executePumpTrade({
  action,
  mint,
  solAmount,
  tokenAmount,
  tokenPriceUsd,
  solPriceUsd,
  slippagePct,
  antiMev,
  publicKey,
  connection,
  wallet,
  onStatus,
}) {
  const status = typeof onStatus === 'function' ? onStatus : function () {};

  if (!action || (action !== 'buy' && action !== 'sell')) throw new Error('Invalid action');
  if (!mint) throw new Error('Missing mint');
  if (!publicKey) throw new Error('Wallet not connected');
  if (!connection) throw new Error('No Solana connection');
  if (!wallet || !wallet.kind) throw new Error('Wallet info missing');

  const slip = Number.isFinite(slippagePct) ? slippagePct : 15;

  // 1. Compute fee + amount.
  let pumpAmount;
  let feeLamports;
  if (action === 'buy') {
    if (!Number.isFinite(solAmount) || solAmount <= 0) throw new Error('Amount too small');
    pumpAmount  = parseFloat(solAmount.toFixed(6));
    const totalLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    feeLamports = Math.floor(totalLamports * PLATFORM_FEE_RATE);
  } else {
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) throw new Error('Amount too small');
    pumpAmount = tokenAmount;
    // Estimate SOL output: tokenPriceUsd / solPriceUsd * tokenAmount.
    // Multiply by 0.85 as a slippage cushion so we don't fee on phantom SOL.
    const estSolOut = (tokenPriceUsd || 0) * tokenAmount / (solPriceUsd || 1);
    feeLamports = Math.max(0, Math.floor(estSolOut * PLATFORM_FEE_RATE * 0.85 * LAMPORTS_PER_SOL));
  }

  // 2. PumpPortal call.
  status('Building trade...');
  const res = await fetch(PUMP_PORTAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: publicKey.toString(),
      action,
      mint,
      denominatedInSol: action === 'buy' ? 'true' : 'false',
      amount: pumpAmount,
      slippage: slip,
      priorityFee: antiMev ? 0.001 : 0.0001,
      pool: 'auto',
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(function () { return ''; });
    throw new Error('PumpPortal ' + res.status + ': ' + (txt || '').slice(0, 200));
  }
  const txBytes = await res.arrayBuffer();
  if (!txBytes || txBytes.byteLength === 0) throw new Error('PumpPortal returned empty tx');
  let tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));

  // 3. Bundle the 5% fee into the same tx.
  status('Adding platform fee...');
  tx = await injectPlatformFee(connection, tx, publicKey, feeLamports);

  // 4. Sign + send. Branch on wallet kind.
  let signature;
  if (wallet.kind === 'privy') {
    if (!wallet.privyWallet) throw new Error('Privy wallet unavailable');
    status('Signing...');
    const sendOpts = wallet.instant
      ? { uiOptions: { showWalletUIs: false } }
      : undefined;
    if (typeof wallet.privyWallet.sendTransaction === 'function') {
      signature = await wallet.privyWallet.sendTransaction(tx, connection, sendOpts);
    } else if (typeof wallet.privyWallet.signTransaction === 'function') {
      const signed = await wallet.privyWallet.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else {
      throw new Error('Privy wallet missing signing methods');
    }
  } else {
    if (typeof wallet.sendTransaction === 'function') {
      status('Confirm in wallet...');
      signature = await wallet.sendTransaction(tx, connection);
    } else if (typeof wallet.signTransaction === 'function') {
      status('Confirm in wallet...');
      const signed = await wallet.signTransaction(tx);
      status('Sending...');
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else {
      throw new Error('External wallet missing send methods');
    }
  }

  // 5. Confirm.
  status('Confirming...');
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed'
  );

  status('Done!');
  return { signature };
}

/* ============================================================================
 * Quick BUY for cards: spend $usdAmount of SOL on `mint`.
 * Caller provides solPriceUsd (already cached upstream).
 * ========================================================================= */
export async function quickBuyPump({
  mint,
  usdAmount,
  solPriceUsd,
  publicKey,
  connection,
  wallet,
  antiMev,
  onStatus,
}) {
  if (!solPriceUsd || solPriceUsd <= 0) throw new Error('SOL price unavailable');
  const solAmount = usdAmount / solPriceUsd;
  if (solAmount <= 0) throw new Error('Amount too small');
  return executePumpTrade({
    action: 'buy',
    mint,
    solAmount,
    publicKey,
    connection,
    wallet,
    antiMev,
    onStatus,
  });
}

/* ============================================================================
 * Quick SELL for cards: sell `pct` (1-100) of user's balance of `mint`.
 * ========================================================================= */
export async function quickSellPump({
  mint,
  tokenBalance,
  pct,
  tokenPriceUsd,
  solPriceUsd,
  publicKey,
  connection,
  wallet,
  antiMev,
  onStatus,
}) {
  if (!tokenBalance || tokenBalance <= 0) throw new Error('No balance to sell');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Invalid percentage');
  const tokenAmount = pct === 100 ? tokenBalance : (tokenBalance * (pct / 100));
  return executePumpTrade({
    action: 'sell',
    mint,
    tokenAmount,
    tokenPriceUsd,
    solPriceUsd,
    publicKey,
    connection,
    wallet,
    antiMev,
    onStatus,
  });
}
