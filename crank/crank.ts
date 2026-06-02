console.log("=== CRANK BOOT ===");
console.log("Node:", process.version);
console.log("CRANK_KEYPAIR set:", !!process.env.CRANK_KEYPAIR);
console.log("CRANK_KEYPAIR length:", (process.env.CRANK_KEYPAIR || "").length);
console.log("CRANK_KEYPAIR trimmed length:", (process.env.CRANK_KEYPAIR || "").trim().length);
console.log("PROGRAM_ID:", process.env.PROGRAM_ID);
console.log("RPC_URL:", process.env.RPC_URL);

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as bs58module from "bs58";

const bs58: any = (bs58module as any).default || bs58module;

const PROGRAM_ID = new PublicKey(
 process.env.PROGRAM_ID || "4npVSUH3hx62E5VJSWdoCyUwfBnZirMxzqfDNWNCcYbT"
);
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "10000");
const GAP_SECONDS = 30;
const SUPER_ADMIN = new PublicKey("GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA");

function loadKeypair(): Keypair {
 const raw = process.env.CRANK_KEYPAIR;
 if (!raw) throw new Error("CRANK_KEYPAIR env var required");
 const trimmed = raw.trim();
 if (trimmed.startsWith("[")) {
   const arr = JSON.parse(trimmed);
   console.log("[crank] JSON array keypair, length:", arr.length);
   return Keypair.fromSecretKey(Uint8Array.from(arr));
 }
 const decoded = bs58.decode(trimmed);
 console.log("[crank] base58 decoded byte length:", decoded.length);
 return Keypair.fromSecretKey(decoded);
}

async function main() {
 console.log("[crank] main() starting");
 const cranker = loadKeypair();
 console.log("[crank] Cranker pubkey:", cranker.publicKey.toBase58());

 const connection = new Connection(RPC_URL, "confirmed");
 const wallet = new anchor.Wallet(cranker);
 const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
 anchor.setProvider(provider);

 console.log("[crank] Fetching IDL from chain...");
 const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
 if (!idl) throw new Error("IDL not found on chain");
 console.log("[crank] IDL OK");

 const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

 const [configPda] = PublicKey.findProgramAddressSync(
   [Buffer.from("config")],
   PROGRAM_ID
 );
 console.log("[crank] Config PDA:", configPda.toBase58());

 while (true) {
   try {
     const config: any = await (program.account as any).config.fetch(configPda);
     if (config.paused) {
       console.log("[crank] Paused");
       await sleep(POLL_INTERVAL_MS);
       continue;
     }

     const currentEpoch: number = config.currentEpoch.toNumber();
     const now = Math.floor(Date.now() / 1000);

     if (currentEpoch === 0) {
       console.log("[crank] No round yet. Starting round 1...");
       await startRound(program, configPda, cranker, config, 1);
       await sleep(POLL_INTERVAL_MS);
       continue;
     }

     const [roundPda] = PublicKey.findProgramAddressSync(
       [Buffer.from("round"), new anchor.BN(currentEpoch).toArrayLike(Buffer, "le", 8)],
       PROGRAM_ID
     );
     const round: any = await (program.account as any).round.fetch(roundPda);

     if (!round.resolved && now >= round.closeTime.toNumber()) {
       console.log(`[crank] Ending round ${currentEpoch}`);
       await endRound(program, configPda, roundPda, cranker, config, currentEpoch);
     } else if (round.resolved) {
       const nextEpoch = currentEpoch + 1;
       const nextLock = round.closeTime.toNumber() + GAP_SECONDS;
       if (now >= nextLock) {
         console.log(`[crank] Starting round ${nextEpoch}`);
         await startRound(program, configPda, cranker, config, nextEpoch);
       } else {
         console.log(`[crank] Waiting ${nextLock - now}s for round ${nextEpoch}`);
       }
     } else {
       console.log(`[crank] Round ${currentEpoch} live, ${round.closeTime.toNumber() - now}s to close`);
     }
   } catch (e) {
     console.error("[crank] Loop error:", (e as Error).message);
   }
   await sleep(POLL_INTERVAL_MS);
 }
}

async function startRound(program: any, configPda: PublicKey, cranker: Keypair, config: any, epoch: number) {
 const [roundPda] = PublicKey.findProgramAddressSync(
   [Buffer.from("round"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
   program.programId
 );
 const [vaultPda] = PublicKey.findProgramAddressSync(
   [Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
   program.programId
 );
 const tx = await program.methods
   .startRound(new anchor.BN(epoch))
   .accounts({
     config: configPda,
     round: roundPda,
     vault: vaultPda,
     cranker: cranker.publicKey,
     pythFeed: config.pythFeed,
     systemProgram: anchor.web3.SystemProgram.programId,
   })
   .signers([cranker])
   .rpc();
 console.log("[crank] startRound tx:", tx);
}

async function endRound(program: any, configPda: PublicKey, roundPda: PublicKey, cranker: Keypair, config: any, epoch: number) {
 const [vaultPda] = PublicKey.findProgramAddressSync(
   [Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)],
   program.programId
 );
 const tx = await program.methods
   .endRound()
   .accounts({
     config: configPda,
     round: roundPda,
     vault: vaultPda,
     cranker: cranker.publicKey,
     pythFeed: config.pythFeed,
     superAdmin: SUPER_ADMIN,
     systemProgram: anchor.web3.SystemProgram.programId,
   })
   .signers([cranker])
   .rpc();
 console.log("[crank] endRound tx:", tx);
}

function sleep(ms: number) {
 return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
 console.error("[crank] Fatal:", e);
 process.exit(1);
});
 