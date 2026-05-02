/** 
 * NEXUS DEX - LaunchLab Platform Setup
 * Run this ONE TIME to register your platform on Raydium LaunchLab.
 * After running, copy the platformId output to your Railway env as REACT_APP_PLATFORM_ID.
 *
 * Usage:  node setupLaunchpad.mjs
 * Requires: ADMIN_WALLET_PRIVATE_KEY env var (base58 encoded private key of your SOL fee wallet)
 * Cost: ~0.01 SOL (one-time)
 */

// FIX 4: Load .env for local use (ADMIN_WALLET_PRIVATE_KEY lives here)
import 'dotenv/config';

// FIX 5: ESM imports -- consistent with the rest of the codebase and avoids
// any future CJS/ESM conflict if the Raydium SDK drops CommonJS support.
// This file uses .mjs extension so Node treats it as ESM without needing
// "type": "module" in package.json (which would break react-scripts).
import { Connection, Keypair } from '@solana/web3.js';
import { Raydium, LAUNCHPAD_PROGRAM, getPdaPlatformId, TxVersion } from '@raydium-io/raydium-sdk-v2';
import bs58 from 'bs58';
import BN from 'bn.js';

// FIX 2: Public mainnet RPC as final fallback so the URL is never malformed
const RPC_URL =
  process.env.HELIUS_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + process.env.REACT_APP_HELIUS_API_KEY
    : 'https://api.mainnet-beta.solana.com');

async function setup() {
  if (!process.env.ADMIN_WALLET_PRIVATE_KEY) {
    console.error('ERROR: Set ADMIN_WALLET_PRIVATE_KEY env var (base58 private key of your SOL fee wallet)');
    process.exit(1);
  }

  var adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_WALLET_PRIVATE_KEY));
  var adminPubkey = adminKeypair.publicKey;

  console.log('Admin wallet:', adminPubkey.toBase58());
  console.log('RPC:', RPC_URL.replace(/api-key=[^&]+/, 'api-key=***'));

  var { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPubkey);
  console.log('Platform ID (derived):', platformId.toBase58());

  var connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  var balance = await connection.getBalance(adminPubkey);
  console.log('Balance:', (balance / 1e9).toFixed(4), 'SOL');
  if (balance < 0.015 * 1e9) {
    console.error('ERROR: Need at least 0.015 SOL in admin wallet for setup costs');
    process.exit(1);
  }

  // Check if platform already exists -- idempotent
  var existingAccount = await connection.getAccountInfo(platformId);
  if (existingAccount) {
    console.log('\nPlatform already registered!');
    printEnvInstructions(platformId.toBase58());
    return;
  }

  var raydium = await Raydium.load({
    connection,
    owner: adminKeypair,
    disableLoadToken: true,
  });

  console.log('\nCreating platform config...');

  var { execute } = await raydium.launchpad.createPlatformConfig({
    programId: LAUNCHPAD_PROGRAM,
    // Fee: 1.5% = 15000 (denominator is 1,000,000)
    feeRate: new BN(15000),
    name: 'Nexus DEX',
    web: 'https://swap.verixiaapps.com',
    img: '',
    // LP distribution after graduation to CPMM:
    // 100% to platform -- all LP tokens go to our wallet
    burnScale: 0,
    creatorScale: 0,
    platformScale: 1000000,
    creatorFeeOn: false,
    txVersion: TxVersion.V0,
  });

  // FIX 3: execute() can return string | string[] -- handle both
  var result = await execute({ sendAndConfirm: true });
  var txId = Array.isArray(result) ? result[0] : result;

  console.log('Platform created! Tx:', txId);
  console.log('Solscan: https://solscan.io/tx/' + txId);
  printEnvInstructions(platformId.toBase58());
}

function printEnvInstructions(platformIdStr) {
  console.log('\n=== ACTION REQUIRED ===');
  console.log('Add to Railway / Render environment variables:');
  console.log('REACT_APP_PLATFORM_ID =', platformIdStr);
  console.log('=======================\n');
}

setup().catch(function(e) {
  console.error('Setup failed:', e.message || e);
  process.exit(1);
});
