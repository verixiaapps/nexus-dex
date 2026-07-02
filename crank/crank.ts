/* ============================================================================
 * crank.ts — BRACKETS REWORK (read me)
 * ----------------------------------------------------------------------------
 * NO LOGIC CHANGE THIS PASS. The crank's job is unchanged: start rounds and post
 * the SOL price at start (lock) and at close (end). The *contract* now computes
 * the % move from those two prices and picks the winning bracket — the crank does
 * not know about brackets at all.
 *   - startRound(): posts lockPrice. Contract sets lock_time = close_time - 60s
 *     (betting locks 60s before close); the crank doesn't need to do anything for that.
 *   - endRound(): posts closePrice; contract resolves the bracket + AllLost/Tie.
 *   - Price source: Coinbase SOL-USD spot (same feed the frontend shows). This is
 *     an OFF-CHAIN operator feed, not an oracle — a known trust tradeoff.
 *   - endRound fires up to POLL_INTERVAL_MS after closeTime, so the resolving
 *     price is sampled shortly after betting is already locked (which is fine —
 *     betting closed 60s before close on-chain).
 *
 * Earlier review fixes (still apply):
 *  1. endRound() passes `authority` (= config.authority; receives the pot only on
 *     an AllLost round). The old SUPER_ADMIN account/const was removed.
 *  2. startRound() accounts: config, round, vault, cranker, systemProgram.
 *  3. PROGRAM_ID / CRANK_KEYPAIR from env (Railway -> Variables).
 * ==========================================================================*/
console.log("=== CRANK BOOT ===");
console.log("Node:", process.version);

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as bs58module from "bs58";

const bs58: any = (bs58module as any).default || bs58module;

// Program ID from env so Railway can deploy before the on-chain ID is final.
const PROGRAM_ID_STR = process.env.FLIPSY_PROGRAM_ID || "11111111111111111111111111111111";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// RPC — public Solana devnet endpoint. Hardcoded, no env var, no fallback.
const RPC_URL = "https://api.devnet.solana.com";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "10000");
const GAP_SECONDS = 30;
const PRICE_URL = "https://api.coinbase.com/v2/prices/SOL-USD/spot";

function loadKeypair(): Keypair {
  const raw = process.env.CRANK_KEYPAIR;
  if (!raw) throw new Error("CRANK_KEYPAIR required");
  const t = raw.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  return Keypair.fromSecretKey(bs58.decode(t));
}

async function fetchSolPriceI64(): Promise<anchor.BN> {
  const res = await fetch(PRICE_URL);
  if (!res.ok) throw new Error("Coinbase HTTP " + res.status);
  const json: any = await res.json();
  const priceStr: string | undefined = json && json.data && json.data.amount;
  if (!priceStr) throw new Error("No price in Coinbase response");
  const price = parseFloat(priceStr);
  if (!isFinite(price) || price <= 0) throw new Error("Bad price: " + priceStr);
  return new anchor.BN(Math.round(price * 1e8));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function pdaRound(epoch: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
  return pda;
}

function pdaVault(epoch: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
  return pda;
}

async function startRound(program: any, configPda: PublicKey, cranker: Keypair, nextEpoch: number) {
  const roundPda = pdaRound(nextEpoch);
  const vaultPda = pdaVault(nextEpoch);
  const lockPrice = await fetchSolPriceI64();
  console.log("[crank] startRound epoch=" + nextEpoch + " lockPrice=" + lockPrice.toString());
  const tx = await program.methods.startRound(lockPrice).accounts({
    config: configPda,
    round: roundPda,
    vault: vaultPda,
    cranker: cranker.publicKey,
    systemProgram: SystemProgram.programId,
  }).signers([cranker]).rpc();
  console.log("[crank] startRound tx:", tx);
}

async function endRound(
  program: any,
  configPda: PublicKey,
  cranker: Keypair,
  epoch: number,
  authority: PublicKey,
) {
  const roundPda = pdaRound(epoch);
  const vaultPda = pdaVault(epoch);
  const closePrice = await fetchSolPriceI64();
  console.log("[crank] endRound epoch=" + epoch + " closePrice=" + closePrice.toString());
  // The program's EndRound expects `authority` (must equal config.authority); it
  // receives the pot only when a round resolves AllLost. It is NOT a super-admin.
  // The contract derives the winning bracket from lockPrice vs this closePrice.
  const tx = await program.methods.endRound(closePrice).accounts({
    config: configPda,
    round: roundPda,
    vault: vaultPda,
    authority,
    cranker: cranker.publicKey,
  }).signers([cranker]).rpc();
  console.log("[crank] endRound tx:", tx);
}

async function main() {
  if (PROGRAM_ID_STR === "11111111111111111111111111111111") {
    console.warn("[crank] WARNING: FLIPSY_PROGRAM_ID not set — using placeholder. Set it in Railway -> Variables to your deployed program ID.");
  }
  const cranker = loadKeypair();
  console.log("[crank] Cranker:", cranker.publicKey.toBase58());
  console.log("[crank] Program:", PROGRAM_ID.toBase58());
  let rpcHost = "(invalid url)";
  try { rpcHost = new URL(RPC_URL).host; } catch {}
  console.log("[crank] RPC: solana devnet (" + rpcHost + ")");

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(cranker);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  console.log("[crank] Fetching IDL from chain...");
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("No IDL on chain for " + PROGRAM_ID.toBase58() + " — run `anchor idl init` after deploy.");
  (idl as any).address = PROGRAM_ID.toBase58();
  console.log("[crank] IDL fetched.");

  const program = new anchor.Program(idl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  console.log("[crank] Config PDA:", configPda.toBase58());

  while (true) {
    try {
      const config: any = await (program.account as any).config.fetch(configPda);
      if (config.paused) { console.log("[crank] Paused"); await sleep(POLL_INTERVAL_MS); continue; }

      const epoch: number = config.currentEpoch.toNumber();
      const now = Math.floor(Date.now() / 1000);

      if (epoch === 0) {
        await startRound(program, configPda, cranker, 1);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const roundPda = pdaRound(epoch);
      const round: any = await (program.account as any).round.fetch(roundPda);
      const resolved = round.resolvedAt.toNumber() > 0;
      const closeTime = round.closeTime.toNumber();

      if (!resolved && now >= closeTime) {
        await endRound(program, configPda, cranker, epoch, config.authority);
      } else if (resolved) {
        const nextStart = closeTime + GAP_SECONDS;
        if (now >= nextStart) {
          await startRound(program, configPda, cranker, epoch + 1);
        } else {
          console.log("[crank] Gap, " + (nextStart - now) + "s until next round");
        }
      } else {
        console.log("[crank] Round " + epoch + " live, " + (closeTime - now) + "s to close");
      }
    } catch (e: any) {
      console.error("[crank] Loop error:", (e && e.message) || e);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(e => { console.error("[crank] Fatal:", e); process.exit(1); });
 