console.log("=== CRANK BOOT ===");
console.log("Node:", process.version);

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as bs58module from "bs58";
import idl from "./flipsy-idl.json";

const bs58: any = (bs58module as any).default || bs58module;
const PROGRAM_ID = new PublicKey("4npVSUH3hx62E5VJSWdoCyUwfBnZirMxzqfDNWNCcYbT");
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "10000");
const GAP_SECONDS = 30;
const SUPER_ADMIN = new PublicKey("GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA");

function loadKeypair(): Keypair {
  const raw = process.env.CRANK_KEYPAIR;
  if (!raw) throw new Error("CRANK_KEYPAIR required");
  const t = raw.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  return Keypair.fromSecretKey(bs58.decode(t));
}

async function main() {
  const cranker = loadKeypair();
  console.log("[crank] Cranker:", cranker.publicKey.toBase58());
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(cranker);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as any, PROGRAM_ID, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  console.log("[crank] Config PDA:", configPda.toBase58());

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const config: any = await (program.account as any).config.fetch(configPda);
      if (config.paused) { console.log("[crank] Paused"); await sleep(POLL_INTERVAL_MS); continue; }
      const epoch: number = config.currentEpoch.toNumber();
      const now = Math.floor(Date.now() / 1000);

      if (epoch === 0) {
        console.log("[crank] Starting round 1...");
        await startRound(program, configPda, cranker, config);
        await sleep(POLL_INTERVAL_MS); continue;
      }

      const [roundPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("round"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)], PROGRAM_ID);
      const round: any = await (program.account as any).round.fetch(roundPda);

      if (!round.resolved && now >= round.closeTime.toNumber()) {
        console.log(`[crank] Ending round ${epoch}`);
        await endRound(program, configPda, roundPda, cranker, config, epoch);
      } else if (round.resolved) {
        const nextLock = round.closeTime.toNumber() + GAP_SECONDS;
        if (now >= nextLock) {
          console.log(`[crank] Starting round ${epoch + 1}`);
          await startRound(program, configPda, cranker, config);
        } else {
          console.log(`[crank] Waiting ${nextLock - now}s for next round`);
        }
      } else {
        console.log(`[crank] Round ${epoch} live, ${round.closeTime.toNumber() - now}s to close`);
      }
    } catch (e: any) {
      console.error("[crank] Loop error:", e.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("[crank] Exiting cleanly");
}

async function startRound(program: any, configPda: PublicKey, cranker: Keypair, config: any) {
  const cfg: any = await (program.account as any).config.fetch(configPda);
  const nextEpoch = cfg.currentEpoch.toNumber() + 1;
  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), new anchor.BN(nextEpoch).toArrayLike(Buffer, "le", 8)], program.programId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), new anchor.BN(nextEpoch).toArrayLike(Buffer, "le", 8)], program.programId);
  const tx = await program.methods.startRound().accounts({
    config: configPda, round: roundPda, vault: vaultPda,
    pythFeed: config.pythFeed, cranker: cranker.publicKey,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).signers([cranker]).rpc();
  console.log("[crank] startRound tx:", tx);
}

async function endRound(program: any, configPda: PublicKey, roundPda: PublicKey, cranker: Keypair, config: any, epoch: number) {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8)], program.programId);
  const tx = await program.methods.endRound().accounts({
    config: configPda, round: roundPda, vault: vaultPda,
    pythFeed: config.pythFeed, superAdmin: SUPER_ADMIN, cranker: cranker.publicKey,
  }).signers([cranker]).rpc();
  console.log("[crank] endRound tx:", tx);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error("[crank] Fatal:", e); process.exit(1); });
