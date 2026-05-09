/**
 * NEXUS DEX -- Shared Pump.fun Trade Helper
 * 
 * Used by:
 *   - NewLaunches.js TokenCard one-click preset buttons
 *
 * Behavior: 
 *   - Calls our backend proxy: /api/pumpportal/trade-local
 *   - Backend forwards to PumpPortal trade-local
 *   - Receives serialized VersionedTransaction
 *   - Decompiles, appends platform fee transfer, recompiles to V0
 *   - Signs + sends with Privy or external Solana wallet
 *
 * Fee behavior:
 *   - Buy: exact 5% platform fee is taken inside the user's total SOL spend.
 *          Example: user spends 1 SOL total -> 0.95 SOL trade + 0.05 SOL fee.
 *   - Sell: estimated SOL platform fee is appended because PumpPortal sell output
 *           is not known before execution.
 */
import {
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
export const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
export const PLATFORM_FEE_RATE = 0.05;
const PUMP_PORTAL_URL = '/api/pumpportal/trade-local';
function asPublicKey(value) {
  if (!value) return null;
  if (value instanceof PublicKey) return value;
  try { return new PublicKey(value.toString()); } catch { return null; }
}
async function getSolBalance(connection, owner) {
  try { return await connection.getBalance(owner, 'confirmed'); } catch { return 0; }
}
async function resolveLookupTables(connection, tx) {
  const lookups = (tx.message && tx.message.addressTableLookups) || [];
  if (!lookups.length) return [];
  const resolved = await Promise.all(
    lookups.map(lt =>
      connection.getAddressLookupTable(lt.accountKey)
        .then(r => r && r.value ? r.value : null)
        .catch(() => null)
    )
  );
  return resolved.filter(Boolean);
}
async function injectPlatformFee(connection, tx, fromPubkey, feeLamports) {
  if (!feeLamports || feeLamports <= 0) return tx;
  const owner = asPublicKey(fromPubkey);
  if (!owner) throw new Error('Invalid wallet public key');
  const feeWallet = asPublicKey(SOL_FEE_WALLET);
  if (!feeWallet) throw new Error('Invalid fee wallet');
  const lookupTableAccounts = await resolveLookupTables(connection, tx);
  const decompiled = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookupTableAccounts });
  decompiled.instructions.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: feeWallet, lamports: feeLamports }));
  return new VersionedTransaction(decompiled.compileToV0Message(lookupTableAccounts));
}
async function sendSignedTransaction(connection, signedTx) {
  const signature = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}
async function sendWithPrivy({ tx, connection, wallet, status }) {
  if (!wallet.privyWallet) throw new Error('Privy wallet unavailable');
  status('Signing...');
  if (typeof wallet.privyWallet.sendTransaction === 'function') {
    const sendOpts = wallet.instant ? { uiOptions: { showWalletUIs: false } } : undefined;
    return await wallet.privyWallet.sendTransaction(tx, connection, sendOpts);
  }
  if (typeof wallet.privyWallet.signTransaction === 'function') {
    const signed = await wallet.privyWallet.signTransaction(tx);
    status('Sending...');
    return await sendSignedTransaction(connection, signed);
  }
  throw new Error('Privy wallet missing signing methods');
}
async function sendWithExternalWallet({ tx, connection, wallet, status }) {
  if (typeof wallet.signTransaction === 'function') {
    status('Confirm in wallet...');
    const signed = await wallet.signTransaction(tx);
    status('Sending...');
    return await sendSignedTransaction(connection, signed);
  }
  if (typeof wallet.sendTransaction === 'function') {
    status('Confirm in wallet...');
    return await wallet.sendTransaction(tx, connection, { skipPreflight: true, maxRetries: 3 });
  }
  throw new Error('External wallet missing signing methods');
}
export async function executePumpTrade({ action, mint, solAmount, tokenAmount, tokenPriceUsd, solPriceUsd, slippagePct, antiMev, publicKey, connection, wallet, onStatus }) {
  const status = typeof onStatus === 'function' ? onStatus : () => {};
  if (action !== 'buy' && action !== 'sell') throw new Error('Invalid action');
  if (!mint) throw new Error('Missing mint');
  if (!publicKey) throw new Error('Wallet not connected');
  if (!connection) throw new Error('No Solana connection');
  if (!wallet || !wallet.kind) throw new Error('Wallet info missing');
  const owner = asPublicKey(publicKey);
  if (!owner) throw new Error('Invalid wallet public key');
  const slip = Number.isFinite(slippagePct) ? slippagePct : 15;
  const priorityFee = antiMev ? 0.001 : 0.0001;
  let pumpAmount;
  let feeLamports = 0;
  if (action === 'buy') {
    if (!Number.isFinite(solAmount) || solAmount <= 0) throw new Error('Amount too small');
    const totalLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    feeLamports = Math.floor(totalLamports * PLATFORM_FEE_RATE);
    const tradeLamports = totalLamports - feeLamports;
    if (tradeLamports <= 0) throw new Error('Amount too small after fee');
    pumpAmount = parseFloat((tradeLamports / LAMPORTS_PER_SOL).toFixed(6));
    const balance = await getSolBalance(connection, owner);
    const roughNeeded = totalLamports + Math.ceil(priorityFee * LAMPORTS_PER_SOL) + 10000;
    if (balance < roughNeeded) throw new Error('Not enough SOL for trade, platform fee, and network fees');
  }
  if (action === 'sell') {
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) throw new Error('Amount too small');
    pumpAmount = tokenAmount;
    const estSolOut = ((Number(tokenPriceUsd) || 0) * tokenAmount) / (Number(solPriceUsd) || 1);
    feeLamports = Math.max(0, Math.floor(estSolOut * PLATFORM_FEE_RATE * 0.85 * LAMPORTS_PER_SOL));
    const balance = await getSolBalance(connection, owner);
    const roughNeeded = feeLamports + Math.ceil(priorityFee * LAMPORTS_PER_SOL) + 10000;
    if (feeLamports > 0 && balance < roughNeeded) throw new Error('Not enough SOL for platform fee and network fees');
  }
  status('Building trade...');
  const res = await fetch(PUMP_PORTAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: owner.toString(), action, mint, denominatedInSol: action === 'buy' ? 'true' : 'false', amount: pumpAmount, slippage: slip, priorityFee, pool: 'auto' }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('PumpPortal ' + res.status + ': ' + (txt || '').slice(0, 200));
  }
  const txBytes = await res.arrayBuffer();
  if (!txBytes || txBytes.byteLength === 0) throw new Error('PumpPortal returned empty transaction');
  let tx;
  try { tx = VersionedTransaction.deserialize(new Uint8Array(txBytes)); } catch { throw new Error('Could not decode PumpPortal transaction'); }
  status('Adding platform fee...');
  tx = await injectPlatformFee(connection, tx, owner, feeLamports);
  let signature;
  if (wallet.kind === 'privy') {
    signature = await sendWithPrivy({ tx, connection, wallet, status });
  } else {
    signature = await sendWithExternalWallet({ tx, connection, wallet, status });
  }
  if (!signature) throw new Error('Transaction was not sent');
  status('Confirming...');
  await connection.confirmTransaction(signature, 'confirmed');
  status('Done!');
  return { signature };
}
export async function quickBuyPump({ mint, usdAmount, solPriceUsd, publicKey, connection, wallet, antiMev, onStatus }) {
  if (!solPriceUsd || solPriceUsd <= 0) throw new Error('SOL price unavailable');
  const solAmount = Number(usdAmount) / Number(solPriceUsd);
  if (!Number.isFinite(solAmount) || solAmount <= 0) throw new Error('Amount too small');
  return executePumpTrade({ action: 'buy', mint, solAmount, publicKey, connection, wallet, antiMev, onStatus });
}
export async function quickSellPump({ mint, tokenBalance, pct, tokenPriceUsd, solPriceUsd, publicKey, connection, wallet, antiMev, onStatus }) {
  if (!tokenBalance || tokenBalance <= 0) throw new Error('No balance to sell');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Invalid percentage');
  const tokenAmount = pct === 100 ? Number(tokenBalance) : Number(tokenBalance) * (Number(pct) / 100);
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) throw new Error('Amount too small');
  return executePumpTrade({ action: 'sell', mint, tokenAmount, tokenPriceUsd, solPriceUsd, publicKey, connection, wallet, antiMev, onStatus });
}