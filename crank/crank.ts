console.log("=== FLIPSY CRANK BOOT (DEVNET) ===");
console.log("Node:", process.version);

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as bs58module from "bs58";
import idl from "./flipsy-idl.json";

const bs58: any = (bs58module as any).default || bs58module;

// ============================================================
// CONFIG
// Required env vars on Railway:
//   PROGRAM_ID      — (optional) overrides the default below
//   RPC_URL         — devnet: https://api.devnet.solana.com
//                     mainnet: your Helius URL
//   CRANK_KEYPAIR   — base58 or JSON array of cranker wallet secret key
// ============================================================

const DEFAULT_PROGRAM_ID = "71bEAUToad7j8k8As9LwsGWBYTLxVJoP2SBNB3S3RLHs";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "10000");
const GAP_SECONDS = 30;
const PRICE_URL = "https://api.coinbase.com/v2/prices/SOL-USD/spot";

// Safely parse PROGRAM_ID. If missing or invalid, the crank disables itself
// instead of crashing the whole container.
function loadProgramId(): PublicKey | null {
 const raw = (process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID).trim();
 if (!raw || raw === "REPLACE_WITH_PROGRAM_ID") {
   console.error("[crank] PROGRAM_ID not configured. Crank disabled.");
   return null;
 }
 try {
   return new PublicKey(raw);
 } catch (e: any) {
   console.error("[crank] PROGRAM_ID is not valid base58:", e?.message || e);
   return null;
 }
}

function loadKeypair(): Keypair | null {
 const raw = process.env.CRANK_KEYPAIR;
 if (!raw) {
   console.error("[crank] CRANK_KEYPAIR env var is not set. Crank disabled.");
   return null;
 }
 try {
   const t = raw.trim();
   if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
   return Keypair.fromSecretKey(bs58.decode(t));
 } catch (e: any) {
   console.error("[crank] CRANK_KEYPAIR could not be parsed:", e?.message || e);
   return null;
 }
}

// Coinbase returns "142.37". Contract stores i64 with 8 decimal places.
async function fetchSolPriceI64(): Promise<anchor.BN> {
 const res = await fetch(PRICE_URL);
 if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
 const json: any = await res.json();
 const priceStr: string | undefined = json?.data?.amount;
 if (!priceStr) throw new Error("No price in Coinbase response");
 const price = parseFloat(priceStr);
 if (!isFinite(price) || price <= 0) throw new Error(`Bad price: ${priceStr}`);
 return new anchor.BN(Math.round(price * 1e8));
}

function sleep(ms: number) {
 return new Promise((r) => setTimeout(r, ms));
}

function pdaRound(programId: PublicKey, epoch: number): PublicKey {
 const [pda] = PublicKey.findProgramAddressSync(
   [Buffer.from("round"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
   programId,
 );
 return pda;
}

function pdaVault(programId: PublicKey, epoch: number): PublicKey {
 const [pda] = PublicKey.findProgramAddressSync(
   [Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
   programId,
 );
 return pda;
}

async function startRound(
 program: any,
 programId: PublicKey,
 configPda: PublicKey,
 cranker: Keypair,
 nextEpoch: number,
) {
 const roundPda = pdaRound(programId, nextEpoch);
 const vaultPda = pdaVault(programId, nextEpoch);
 const lockPrice = await fetchSolPriceI64();
 console.log(`[crank] startRound epoch=${nextEpoch} lockPrice=${lockPrice.toString()}`);
 const tx = await program.methods
   .startRound(lockPrice)
   .accounts({
     config: configPda,
     round: roundPda,
     vault: vaultPda,
     cranker: cranker.publicKey,
     systemProgram: SystemProgram.programId,
   })
   .signers([cranker])
   .rpc();
 console.log("[crank] startRound tx:", tx);
}

async function endRound(
 program: any,
 programId: PublicKey,
 configPda: PublicKey,
 cranker: Keypair,
 epoch: number,
 authority: PublicKey,
) {
 const roundPda = pdaRound(programId, epoch);
 const vaultPda = pdaVault(programId, epoch);
 const closePrice = await fetchSolPriceI64();
 console.log(`[crank] endRound epoch=${epoch} closePrice=${closePrice.toString()}`);
 const tx = await program.methods
   .endRound(closePrice)
   .accounts({
     config: configPda,
     round: roundPda,
     vault: vaultPda,
     authority,
     cranker: cranker.publicKey,
   })
   .signers([cranker])
   .rpc();
 console.log("[crank] endRound tx:", tx);
}

async function main() {
 const programId = loadProgramId();
 const cranker = loadKeypair();

 // If either is missing, idle indefinitely instead of crashing the process.
 // This keeps `concurrently` happy and the server running.
 if (!programId || !cranker) {
   console.warn("[crank] Required config missing. Idling. Set CRANK_KEYPAIR (and optionally PROGRAM_ID) to enable.");
   while (true) await sleep(60000);
 }

 console.log("[crank] Cranker:", cranker.publicKey.toBase58());
 console.log("[crank] RPC:", RPC_URL.replace(/api-key=[^&]+/, "api-key=***"));
 console.log("[crank] Program:", programId.toBase58());

 const connection = new Connection(RPC_URL, "confirmed");
 const wallet = new anchor.Wallet(cranker);
 const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
 anchor.setProvider(provider);
 const program = new anchor.Program(idl as any, programId, provider);

 const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
 console.log("[crank] Config PDA:", configPda.toBase58());

 // Perpetual loop — single-iteration errors are caught so the crank never crashes.
 while (true) {
   try {
     const config: any = await (program.account as any).config.fetch(configPda);
     const authority: PublicKey = config.authority;

     if (config.paused) {
       console.log("[crank] Paused");
       await sleep(POLL_INTERVAL_MS);
       continue;
     }

     const epoch: number = config.currentEpoch.toNumber();
     const now = Math.floor(Date.now() / 1000);

     // Bootstrap: no rounds yet, start round 1.
     if (epoch === 0) {
       await startRound(program, programId, configPda, cranker, 1);
       await sleep(POLL_INTERVAL_MS);
       continue;
     }

     const roundPda = pdaRound(programId, epoch);
     const round: any = await (program.account as any).round.fetch(roundPda);

     const resolved = round.resolvedAt.toNumber() > 0;
     const closeTime = round.closeTime.toNumber();

     if (!resolved && now >= closeTime) {
       await endRound(program, programId, configPda, cranker, epoch, authority);
     } else if (resolved) {
       const nextStart = closeTime + GAP_SECONDS;
       if (now >= nextStart) {
         await startRound(program, programId, configPda, cranker, epoch + 1);
       } else {
         console.log(`[crank] Gap, ${nextStart - now}s until next round`);
       }
     } else {
       console.log(`[crank] Round ${epoch} live, ${closeTime - now}s to close`);
     }
   } catch (e: any) {
     console.error("[crank] Loop error:", e?.message || e);
   }
   await sleep(POLL_INTERVAL_MS);
 }
}

main().catch((e) => {
 // Never let the crank kill the container. Log and idle.
 console.error("[crank] Fatal (caught, idling):", e?.message || e);
 setInterval(() => {}, 60000);
});
