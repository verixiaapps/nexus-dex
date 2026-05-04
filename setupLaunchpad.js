/**
 * NEXUS DEX - LaunchLab Platform Setup
 * Run this ONE TIME to register your platform on Raydium LaunchLab.
 * After running, copy the platformId output to your Railway env as REACT_APP_PLATFORM_ID.
 *
 * Usage:    node setupLaunchpad.mjs
 * Requires: ADMIN_WALLET_PRIVATE_KEY env var
 *           (base58 encoded private key of your SOL fee wallet)
 * Cost:     ~0.01 SOL one-time, paid in full by the admin running this script.
 *           No subsidy, no proxy -- the wallet identified by ADMIN_WALLET_PRIVATE_KEY
 *           pays every lamport of the registration transaction. End-users launching
 *           tokens later through TokenLaunch.js pay their own launch costs in full;
 *           this script does not pre-fund anything on their behalf.
 */

import 'dotenv/config';

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Raydium, LAUNCHPAD_PROGRAM, getPdaPlatformId, TxVersion } from '@raydium-io/raydium-sdk-v2';
import bs58 from 'bs58';
import BN from 'bn.js';

// RPC URL with three-tier fallback. Public mainnet-beta is the final safety
// net so the URL is never malformed even if both env vars are unset.
const RPC_URL =
  process.env.HELIUS_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.REACT_APP_HELIUS_API_KEY)
    : 'https://api.mainnet-beta.solana.com');

// Minimum SOL the admin wallet must hold before we'll attempt setup. Actual
// platform-config creation is roughly 0.005-0.01 SOL depending on rent-exempt
// minimum at the time, so 0.015 is a comfortable buffer that still surfaces
// underfunded wallets early instead of failing mid-tx.
const MIN_SOL_LAMPORTS = Math.floor(0.015 * LAMPORTS_PER_SOL);

function maskRpc(url) {
  return String(url).replace(/api-key=[^&]+/, 'api-key=***');
}

async function setup() {
  if (!process.env.ADMIN_WALLET_PRIVATE_KEY) {
    console.error('ERROR: Set ADMIN_WALLET_PRIVATE_KEY env var (base58 private key of your SOL fee wallet)');
    process.exit(1);
  }

  let adminKeypair;
  try {
    adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_WALLET_PRIVATE_KEY));
  } catch (e) {
    console.error('ERROR: ADMIN_WALLET_PRIVATE_KEY is not a valid base58 secret key:', e.message || e);
    process.exit(1);
  }
  const adminPubkey = adminKeypair.publicKey;

  console.log('Admin wallet: ', adminPubkey.toBase58());
  console.log('RPC:          ', maskRpc(RPC_URL));

  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPubkey);
  console.log('Platform ID:  ', platformId.toBase58(), '(derived)');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Pre-flight balance check -- admin pays in full.
  const balanceBefore = await connection.getBalance(adminPubkey);
  console.log('Balance:      ', (balanceBefore / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  if (balanceBefore < MIN_SOL_LAMPORTS) {
    console.error(
      'ERROR: Need at least ' + (MIN_SOL_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3) +
      ' SOL in admin wallet for setup costs. Top up and re-run.'
    );
    process.exit(1);
  }

  // Idempotent: if the PDA is already initialized this script is a no-op.
  const existingAccount = await connection.getAccountInfo(platformId);
  if (existingAccount) {
    console.log('\nPlatform already registered -- nothing to do.');
    printEnvInstructions(platformId.toBase58());
    return;
  }

  const raydium = await Raydium.load({
    connection,
    owner: adminKeypair,
    disableLoadToken: true,
  });

  console.log('\nCreating platform config...');
  console.log('  Trading fee:   1.5% (15000 / 1,000,000)');
  console.log('  LP after grad: 100% to platform wallet');
  console.log('  Creator share: 0%   (creatorFeeOn=false, creatorScale=0)');
  console.log('  Burn share:    0%   (burnScale=0)');

  // ---------------------------------------------------------------------
  // FEE / DISTRIBUTION CONFIG -- DO NOT MODIFY
  // These four values are the platform's locked economics. Changing any of
  // them after registration requires a separate update tx and is not what
  // this script is for.
  // ---------------------------------------------------------------------
  const { execute } = await raydium.launchpad.createPlatformConfig({
    programId: LAUNCHPAD_PROGRAM,
    feeRate: new BN(15000),     // 1.5% (denominator 1,000,000)
    name: 'Nexus DEX',
    web: 'https://swap.verixiaapps.com',
    img: '',
    burnScale: 0,
    creatorScale: 0,
    platformScale: 1_000_000,
    creatorFeeOn: false,
    txVersion: TxVersion.V0,
  });

  // execute() in raydium-sdk-v2 can return either a single tx id or an array
  // of tx ids depending on whether the action chunked into multiple txs.
  const result = await execute({ sendAndConfirm: true });
  const txId = Array.isArray(result) ? result[0] : result;

  // Show actual cost paid -- transparency confirms the admin paid in full
  // with no hidden subsidy.
  const balanceAfter = await connection.getBalance(adminPubkey);
  const paidLamports = Math.max(0, balanceBefore - balanceAfter);
  console.log('\nPlatform created!');
  console.log('  Tx:         ', txId);
  console.log('  Solscan:    https://solscan.io/tx/' + txId);
  console.log('  Cost paid:  ', (paidLamports / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  console.log('  Balance now:', (balanceAfter / LAMPORTS_PER_SOL).toFixed(4), 'SOL');

  printEnvInstructions(platformId.toBase58());
}

function printEnvInstructions(platformIdStr) {
  console.log('\n=== ACTION REQUIRED ===');
  console.log('Add to Railway / Render environment variables, then redeploy:');
  console.log('  REACT_APP_PLATFORM_ID =', platformIdStr);
  console.log('=======================\n');
}

setup().catch((e) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('Setup failed:', e && e.message ? e.message : e);
  if (isDev && e && e.stack) console.error(e.stack);
  process.exit(1);
});
