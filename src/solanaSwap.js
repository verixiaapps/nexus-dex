/**
 * NEXUS DEX -- Shared Solana Swap Helper
 * 
 * Single execution path used by:
 *   - InstantTrade.jsx
 *   - SwapWidget.jsx executeSwap
 *   - NewLaunches.js instant trade variants
 *
 * Behavior:
 *   - Solana <-> Solana through OKX DEX aggregator via backend proxy.
 *   - Uses /api/okx/dex/aggregator/swap-instruction.
 *   - Backend injects feePercent + fee wallet server-side.
 *   - Frontend never handles OKX API keys or fee wallet injection.
 */

import {
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  PublicKey,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

export const SOL_FEE_WALLET = '47sLuYEAy1zVLvnXyVd4m2YxK2Vmffnzab3xX3j9wkc5';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const OKX_SOLANA_CHAIN_ID = '501';

export const DEFAULT_SLIPPAGE_BPS = 1500;
export const BLUE_CHIP_SLIPPAGE_BPS = 100;

const U64_MAX = 18446744073709551615n;

const BLUE_CHIPS = new Set([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
]);

export function pickSlippageBps(toMint) {
  return BLUE_CHIPS.has(toMint) ? BLUE_CHIP_SLIPPAGE_BPS : DEFAULT_SLIPPAGE_BPS;
}

function assertAmountRaw(amountRaw) {
  try {
    const big = BigInt(String(amountRaw));
    if (big <= 0n) throw new Error('Amount must be positive');
    if (big > U64_MAX) throw new Error('Amount exceeds u64');
  } catch (e) {
    if (e && e.message) throw e;
    throw new Error('Invalid amountRaw');
  }
}

function asPublicKey(value, label) {
  try { return value instanceof PublicKey ? value : new PublicKey(String(value)); }
  catch { throw new Error(label || 'Invalid public key'); }
}

function normalizeOkxTokenAddress(mint) {
  return mint === SOL_MINT ? '11111111111111111111111111111111' : mint;
}

function okxAmount(amountRaw) { return String(amountRaw); }

function readOkxData(data) {
  if (!data) throw new Error('Empty OKX response');
  if (data.code && data.code !== '0') throw new Error(data.msg || data.message || 'OKX request failed');
  if (Array.isArray(data.data) && data.data.length > 0) return data.data[0];
  if (data.data && typeof data.data === 'object') return data.data;
  throw new Error(data.msg || data.message || 'OKX returned no route');
}

async function fetchOkxSwapInstruction({ fromMint, toMint, amountRaw, publicKey, signal }) {
  const qs = new URLSearchParams({
    chainIndex: OKX_SOLANA_CHAIN_ID,
    fromTokenAddress: normalizeOkxTokenAddress(fromMint),
    toTokenAddress: normalizeOkxTokenAddress(toMint),
    amount: okxAmount(amountRaw),
    userWalletAddress: publicKey.toString(),
    referrer: 'nexus-dex',
  });

  const res = await fetch('/api/okx/dex/aggregator/swap-instruction?' + qs.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.msg || data.message || data.error)) || 'OKX swap-instruction failed');
  return readOkxData(data);
}

function decodeBase64Instruction(ix) {
  if (!ix || !ix.programId || !Array.isArray(ix.accounts) || !ix.data) return null;
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey || a.publicKey || a.address), isSigner: !!a.isSigner, isWritable: !!a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

function decodeInstructionList(list) { return Array.isArray(list) ? list.map(decodeBase64Instruction).filter(Boolean) : []; }

async function fetchLookupTable(connection, address) {
  try { const res = await connection.getAddressLookupTable(new PublicKey(address)); return res && res.value ? res.value : null; }
  catch { return null; }
}

async function buildTxFromOkxInstructionData({ connection, owner, swapData }) {
  if (swapData.tx && swapData.tx.data) return VersionedTransaction.deserialize(Buffer.from(swapData.tx.data, 'base64'));
  if (swapData.data) { try { return VersionedTransaction.deserialize(Buffer.from(swapData.data, 'base64')); } catch {} }

  const ltAddrs = swapData.addressLookupTableAddresses || swapData.addressLookupTableAccountAddresses || swapData.lookupTableAddresses || [];
  const lookupTables = (await Promise.all(ltAddrs.map(addr => fetchLookupTable(connection, addr)))).filter(x => x instanceof AddressLookupTableAccount);

  const instructions = []
    .concat(decodeInstructionList(swapData.computeBudgetInstructions))
    .concat(decodeInstructionList(swapData.setupInstructions))
    .concat(decodeInstructionList(swapData.instructions))
    .concat(decodeInstructionList(swapData.swapInstruction ? [swapData.swapInstruction] : []))
    .concat(decodeInstructionList(swapData.cleanupInstruction ? [swapData.cleanupInstruction] : []));

  if (!instructions.length) throw new Error('OKX returned no usable transaction instructions');

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}

async function sendSignedTransaction(connection, signedTx) {
  const sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true, maxRetries: 3 });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
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
  // Simulate first via RPC so Phantom sees a successful simulation
  try {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false });
    if (sim && sim.value && sim.value.err) {
      throw new Error('Transaction would fail');
    }
  } catch (e) {
    console.warn('Simulation warning:', e.message);
  }

  // Use wallet's sendTransaction with skipPreflight: false as Phantom requires
  if (typeof wallet.sendTransaction === 'function') {
    status('Confirm in wallet...');
    const signature = await wallet.sendTransaction(tx, connection, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  // Fallback for sign-only wallets
  if (typeof wallet.signTransaction !== 'function') {
    throw new Error('External wallet missing signing methods');
  }
  status('Confirm in wallet...');
  const signed = await wallet.signTransaction(tx);
  status('Sending...');
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

export async function executeSolanaSwap({ fromMint, toMint, amountRaw, publicKey, connection, wallet, onStatus, signal }) {
  const status = typeof onStatus === 'function' ? onStatus : () => {};
  if (!fromMint || !toMint) throw new Error('Missing input/output mint');
  if (!publicKey) throw new Error('Wallet not connected');
  if (!connection) throw new Error('No Solana connection');
  if (!wallet || !wallet.kind) throw new Error('Wallet info missing');

  assertAmountRaw(amountRaw);
  const owner = asPublicKey(publicKey, 'Invalid wallet public key');

  status('Getting best route...');
  const swapData = await fetchOkxSwapInstruction({ fromMint, toMint, amountRaw, publicKey: owner, signal });

  status('Building transaction...');
  const tx = await buildTxFromOkxInstructionData({ connection, owner, swapData });

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

  return { signature, quote: swapData };
}

export async function quickBuySol({ toMint, usdAmount, solPriceUsd, publicKey, connection, wallet, onStatus, signal }) {
  if (!solPriceUsd || solPriceUsd <= 0) throw new Error('SOL price unavailable');
  const lamports = Math.floor((Number(usdAmount) / Number(solPriceUsd)) * 1_000_000_000);
  if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('Amount too small');
  return executeSolanaSwap({ fromMint: SOL_MINT, toMint, amountRaw: lamports, publicKey, connection, wallet, onStatus, signal });
}

function humanToRawAmount(humanAmount, decimals) {
  if (!Number.isFinite(humanAmount) || humanAmount <= 0) return '0';
  const dec = Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 9;
  let s = humanAmount.toFixed(dec);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const parts = s.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';
  const fracPadded = fracPart.padEnd(dec, '0').slice(0, dec);
  const combined = (intPart + fracPadded).replace(/^0+(?=\d)/, '');
  if (!combined) return '0';
  let big;
  try { big = BigInt(combined); }
  catch { throw new Error('Invalid amount: decimals=' + dec + ' might be wrong for this mint.'); }
  if (big > U64_MAX) throw new Error('Amount exceeds u64');
  return big.toString();
}

export async function quickSellSol({ fromMint, fromBalance, fromDecimals, pct, publicKey, connection, wallet, onStatus, signal }) {
  if (!fromBalance || fromBalance <= 0) throw new Error('No balance to sell');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Invalid percentage');
  const sellHuman = pct === 100 ? Number(fromBalance) : Number(fromBalance) * (Number(pct) / 100);
  const amountRaw = humanToRawAmount(sellHuman, Number.isFinite(fromDecimals) ? fromDecimals : 9);
  if (amountRaw === '0') throw new Error('Amount too small');
  return executeSolanaSwap({ fromMint, toMint: SOL_MINT, amountRaw, publicKey, connection, wallet, onStatus, signal });
}