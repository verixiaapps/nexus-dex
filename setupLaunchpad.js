/**
 * NEXUS DEX - LaunchLab Platform Setup
 *
 * Run this ONE TIME to register your platform on Raydium LaunchLab.
 * After running, copy the platformId output to your Railway env as
 * REACT_APP_PLATFORM_ID.
 *
 * Usage:    node setupLaunchpad.mjs
 *
 * Required env:
 *   ADMIN_WALLET_PRIVATE_KEY  base58 secret key of the SOL fee wallet
 *   PLATFORM_IMG              public https URL for the platform logo
 *
 * Optional env:
 *   HELIUS_RPC                full RPC URL (preferred)
 *   HELIUS_API_KEY            api key, used to build a Helius URL
 *   REACT_APP_HELIUS_API_KEY  legacy fallback (deprecated)
 *
 *   PLATFORM_NAME             default 'Nexus DEX'
 *   PLATFORM_WEB              default 'https://swap.verixiaapps.com'
 *
 *   PLATFORM_CLAIM_FEE_WALLET base58 pubkey - receives bonding-curve fees
 *                             (default: admin pubkey)
 *   PLATFORM_LOCK_NFT_WALLET  base58 pubkey - receives Fee Key NFT
 *                             (default: admin pubkey)
 *   PLATFORM_VESTING_WALLET   base58 pubkey - vesting wallet
 *                             (default: PublicKey.default = 11111...111)
 *   TRANSFER_FEE_EXT_AUTH     base58 pubkey - Token-2022 transfer-fee authority
 *                             (default: admin pubkey)
 *
 *   CP_CONFIG_ID              CPMM fee-tier PublicKey used after migration.
 *                             Default is the mainnet standard config from
 *                             Raydium's docs:
 *                             DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8
 *
 *   FEE_RATE                  platform fee, bps * 100. Default 15000 (1.5%)
 *   CREATOR_FEE_RATE          creator fee, bps * 100. Max 5000. Default 0.
 *
 *   PLATFORM_SCALE / CREATOR_SCALE / BURN_SCALE
 *                             LP-at-migration shares; MUST sum to 1_000_000.
 *                             Defaults: platform=1_000_000, creator=0, burn=0
 *
 * Cost: ~0.005-0.01 SOL one-time, paid in full by the admin running this
 *       script. The PDA's rent-exempt deposit is included in that figure
 *       and is recoverable if the account is ever closed; this script
 *       reports both numbers separately so the math is clear.
 */

import 'dotenv/config';

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  Raydium,
  LAUNCHPAD_PROGRAM,
  getPdaPlatformId,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import bs58 from 'bs58';
import BN from 'bn.js';

/* -------------------------------------------------------------------------- */
/* Config helpers                                                             */
/* -------------------------------------------------------------------------- */

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

function parsePubkey(envName, fallback) {
  const v = (process.env[envName] || '').trim();
  if (!v) return fallback;
  try {
    return new PublicKey(v);
  } catch {
    fail(envName + ' is not a valid base58 PublicKey');
  }
}

function parseIntEnv(envName, fallback) {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    fail(envName + ' must be a non-negative integer');
  }
  return n;
}

function parseHttpsUrl(envName, value, { required = false } = {}) {
  const v = (value || '').trim();
  if (!v) {
    if (required) fail(envName + ' is required (must be an https URL)');
    return '';
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('protocol must be http(s)');
    }
    return v;
  } catch (e) {
    fail(envName + ' is not a valid URL: ' + (e?.message || e));
  }
}

function maskRpc(url) {
  return String(url).replace(/api-key=[^&]+/i, 'api-key=***');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printEnvInstructions(platformIdStr) {
  console.log('\n=== ACTION REQUIRED ===');
  console.log('Add this to your Railway / Render environment, then redeploy:');
  console.log('  REACT_APP_PLATFORM_ID = ' + platformIdStr);
  console.log('=======================\n');
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

// Default CPMM fee-tier config from Raydium's official docs (mainnet).
// Override via CP_CONFIG_ID if you want a different fee tier.
const DEFAULT_CP_CONFIG_ID = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

// Buffer over typical cost (~0.005-0.01 SOL) to surface underfunded wallets
// before we attempt the transaction.
const MIN_SOL_LAMPORTS = Math.floor(0.02 * LAMPORTS_PER_SOL);

// Max creator fee allowed by the SDK is 5000 (0.5%).
const MAX_CREATOR_FEE_RATE = 5000;

// LP scales must sum to exactly this.
const LP_SCALE_TOTAL = 1_000_000;

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function setup() {
  // -- Admin keypair --------------------------------------------------------
  if (!process.env.ADMIN_WALLET_PRIVATE_KEY) {
    fail('Set ADMIN_WALLET_PRIVATE_KEY (base58 secret key of your SOL fee wallet)');
  }

  let adminKeypair;
  try {
    adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_WALLET_PRIVATE_KEY));
  } catch (e) {
    fail('ADMIN_WALLET_PRIVATE_KEY is not a valid base58 secret key: ' + (e?.message || e));
  }
  const adminPubkey = adminKeypair.publicKey;

  // -- Wallet config (all default to admin where appropriate) ---------------
  const platformAdmin            = adminPubkey;
  const platformClaimFeeWallet   = parsePubkey('PLATFORM_CLAIM_FEE_WALLET', adminPubkey);
  const platformLockNftWallet    = parsePubkey('PLATFORM_LOCK_NFT_WALLET',  adminPubkey);
  const platformVestingWallet    = parsePubkey('PLATFORM_VESTING_WALLET',   PublicKey.default);
  const transferFeeExtensionAuth = parsePubkey('TRANSFER_FEE_EXT_AUTH',     adminPubkey);
  const cpConfigId               = parsePubkey('CP_CONFIG_ID',              DEFAULT_CP_CONFIG_ID);

  // -- Metadata -------------------------------------------------------------
  const platformName = (process.env.PLATFORM_NAME || 'Nexus DEX').slice(0, 64);
  const platformWeb  = parseHttpsUrl(
    'PLATFORM_WEB',
    process.env.PLATFORM_WEB || 'https://swap.verixiaapps.com',
    { required: true }
  );
  const platformImg  = parseHttpsUrl('PLATFORM_IMG', process.env.PLATFORM_IMG, { required: true });

  // -- Fees -----------------------------------------------------------------
  const feeRate        = parseIntEnv('FEE_RATE', 15_000);
  const creatorFeeRate = parseIntEnv('CREATOR_FEE_RATE', 0);
  if (creatorFeeRate > MAX_CREATOR_FEE_RATE) {
    fail('CREATOR_FEE_RATE max is ' + MAX_CREATOR_FEE_RATE + ' (0.5%)');
  }

  // -- LP distribution at migration -----------------------------------------
  const platformScale = parseIntEnv('PLATFORM_SCALE', 1_000_000);
  const creatorScale  = parseIntEnv('CREATOR_SCALE',  0);
  const burnScale     = parseIntEnv('BURN_SCALE',     0);
  if (platformScale + creatorScale + burnScale !== LP_SCALE_TOTAL) {
    fail(
      'PLATFORM_SCALE + CREATOR_SCALE + BURN_SCALE must sum to ' + LP_SCALE_TOTAL +
      ' (got ' + (platformScale + creatorScale + burnScale) + ')'
    );
  }

  // -- RPC ------------------------------------------------------------------
  const heliusKey = process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY || '';
  const rpcUrl =
    process.env.HELIUS_RPC ||
    (heliusKey
      ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(heliusKey)
      : 'https://api.mainnet-beta.solana.com');

  // -- Print plan -----------------------------------------------------------
  console.log('Admin wallet:            ', adminPubkey.toBase58());
  console.log('RPC:                     ', maskRpc(rpcUrl));
  console.log('Platform name:           ', platformName);
  console.log('Platform web:            ', platformWeb);
  console.log('Platform image:          ', platformImg);
  console.log('Claim-fee wallet:        ', platformClaimFeeWallet.toBase58());
  console.log('Lock-NFT wallet:         ', platformLockNftWallet.toBase58());
  console.log('Vesting wallet:          ', platformVestingWallet.toBase58());
  console.log('Transfer-fee ext auth:   ', transferFeeExtensionAuth.toBase58());
  console.log('CPMM config (post-grad): ', cpConfigId.toBase58());
  console.log('Platform fee rate:       ', feeRate, '(=', (feeRate / 10_000).toFixed(2) + '%)');
  console.log('Creator fee rate:        ', creatorFeeRate, '(=', (creatorFeeRate / 10_000).toFixed(2) + '%)');
  console.log('LP scales (sum 1M):       platform=' + platformScale +
              ' creator=' + creatorScale + ' burn=' + burnScale);

  // -- Derive PDA -----------------------------------------------------------
  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPubkey);
  console.log('Platform ID:             ', platformId.toBase58(), '(derived)');

  // -- Connect & pre-flight -------------------------------------------------
  const connection = new Connection(rpcUrl, 'confirmed');

  const balanceBefore = await connection.getBalance(adminPubkey);
  console.log('Balance:                 ', (balanceBefore / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  if (balanceBefore < MIN_SOL_LAMPORTS) {
    fail(
      'Need at least ' + (MIN_SOL_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3) +
      ' SOL in admin wallet for setup costs. Top up and re-run.'
    );
  }

  // Idempotent: if the PDA is already initialized this script is a no-op.
  const existingAccount = await connection.getAccountInfo(platformId);
  if (existingAccount) {
    console.log('\nPlatform already registered -- nothing to do.');
    printEnvInstructions(platformId.toBase58());
    return;
  }

  // -- Build & send tx ------------------------------------------------------
  const raydium = await Raydium.load({
    connection,
    owner: adminKeypair,
    disableLoadToken: true,
  });

  console.log('\nCreating platform config...');

  const { execute } = await raydium.launchpad.createPlatformConfig({
    programId: LAUNCHPAD_PROGRAM,

    platformAdmin,
    platformClaimFeeWallet,
    platformLockNftWallet,
    platformVestingWallet,

    cpConfigId,
    transferFeeExtensionAuth,

    feeRate:        new BN(feeRate),
    creatorFeeRate: new BN(creatorFeeRate),

    migrateCpLockNftScale: {
      platformScale: new BN(platformScale),
      creatorScale:  new BN(creatorScale),
      burnScale:     new BN(burnScale),
    },

    name: platformName,
    web:  platformWeb,
    img:  platformImg,

    txVersion: TxVersion.V0,
  });

  // execute() returns { txId } (single tx) or { txIds } (multi-tx) depending
  // on SDK version and whether the build chunked. Handle every shape.
  const result = await execute({ sendAndConfirm: true });
  const txId =
    (result && result.txId) ||
    (Array.isArray(result?.txIds) ? result.txIds[0] : null) ||
    (Array.isArray(result) ? result[0] : null) ||
    (typeof result === 'string' ? result : null);

  if (!txId) {
    fail('Tx send returned no signature; cannot confirm. Check Solscan for admin wallet recent txs.');
  }

  // -- Verify on-chain ------------------------------------------------------
  // Poll for the PDA to exist rather than sleeping a fixed duration.
  let pdaInfo = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      pdaInfo = await connection.getAccountInfo(platformId);
      if (pdaInfo) break;
    } catch { /* transient RPC error, keep polling */ }
    await sleep(2_000);
  }
  if (!pdaInfo) {
    console.warn('WARN: Tx ' + txId + ' was sent but the platform PDA is not visible yet.');
    console.warn('      Check https://solscan.io/tx/' + txId + ' before re-running.');
    return;
  }

  // -- Cost reporting -------------------------------------------------------
  const balanceAfter = await connection.getBalance(adminPubkey);
  const totalLamports      = Math.max(0, balanceBefore - balanceAfter);
  const rentLamports       = pdaInfo.lamports || 0;
  const networkFeeLamports = Math.max(0, totalLamports - rentLamports);

  console.log('\nPlatform created.');
  console.log('  Tx:                  ', txId);
  console.log('  Solscan:              https://solscan.io/tx/' + txId);
  console.log('  Total spent:         ', (totalLamports      / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  console.log('  Network/priority fee:', (networkFeeLamports / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  console.log('  Rent (recoverable):  ', (rentLamports       / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
  console.log('  Balance now:         ', (balanceAfter       / LAMPORTS_PER_SOL).toFixed(4),  'SOL');

  printEnvInstructions(platformId.toBase58());
}

setup().catch((e) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('Setup failed:', e?.message || e);
  if (isDev && e?.stack) console.error(e.stack);
  process.exit(1);
});
