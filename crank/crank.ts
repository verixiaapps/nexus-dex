// Flipsy Crank Bot — runs alongside dex on Railway
// Reads SUPER_ADMIN private key from Railway env var.

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);
const CRANK_KEYPAIR_RAW = process.env.CRANK_KEYPAIR;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10_000);

if (!CRANK_KEYPAIR_RAW) {
  console.error("❌ CRANK_KEYPAIR env var missing");
  process.exit(1);
}

let secretKeyArr: number[];
try {
  secretKeyArr = JSON.parse(CRANK_KEYPAIR_RAW);
} catch (e) {
  console.error("❌ CRANK_KEYPAIR is not valid JSON array");
  process.exit(1);
}
const crankerKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyArr));

const connection = new Connection(RPC_URL, "confirmed");
const wallet = new anchor.Wallet(crankerKeypair);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);

const idlPath = path.join(__dirname, "flipsy.json");
if (!fs.existsSync(idlPath)) {
  console.error(`❌ IDL not found at ${idlPath}. Copy flipsy.json from Playground into the crank folder.`);
  process.exit(1);
}
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
const program = new anchor.Program(idl, PROGRAM_ID, provider);

const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

function epochBuf(epoch: anchor.BN): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(epoch.toString()));
  return buf;
}

function roundPda(epoch: anchor.BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), epochBuf(epoch)],
    PROGRAM_ID
  );
  return pda;
}

function vaultPda(epoch: anchor.BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), epochBuf(epoch)],
    PROGRAM_ID
  );
  return pda;
}

async function tick() {
  try {
    const config: any = await (program.account as any).config.fetch(configPda);
    const now = Math.floor(Date.now() / 1000);
    const currentEpoch: anchor.BN = config.currentEpoch;

    if (currentEpoch.eqn(0)) {
      const next = new anchor.BN(1);
      console.log(`[${new Date().toISOString()}] Starting first round`);
      await program.methods
        .startRound()
        .accounts({
          config: configPda,
          round: roundPda(next),
          vault: vaultPda(next),
          usdcMint: config.usdcMint,
          pythFeed: config.pythFeed,
          cranker: crankerKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([crankerKeypair])
        .rpc();
      console.log(`✅ Round 1 started`);
      return;
    }

    const curRoundPda = roundPda(currentEpoch);
    const round: any = await (program.account as any).round.fetch(curRoundPda);
    const isUnresolved = round.outcome.unresolved !== undefined;

    if (isUnresolved) {
      if (now >= round.closeTime.toNumber()) {
        console.log(`[${new Date().toISOString()}] Ending round ${currentEpoch.toString()}`);
        await program.methods
          .endRound()
          .accounts({
            config: configPda,
            round: curRoundPda,
            pythFeed: config.pythFeed,
            cranker: crankerKeypair.publicKey,
          })
          .signers([crankerKeypair])
          .rpc();
        console.log(`✅ Round ${currentEpoch.toString()} ended`);
      } else {
        const secsLeft = round.closeTime.toNumber() - now;
        console.log(`[${new Date().toISOString()}] Round ${currentEpoch.toString()} open, ${secsLeft}s until close`);
      }
    } else {
      const next = currentEpoch.addn(1);
      console.log(`[${new Date().toISOString()}] Starting round ${next.toString()}`);
      await program.methods
        .startRound()
        .accounts({
          config: configPda,
          round: roundPda(next),
          vault: vaultPda(next),
          usdcMint: config.usdcMint,
          pythFeed: config.pythFeed,
          cranker: crankerKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([crankerKeypair])
        .rpc();
      console.log(`✅ Round ${next.toString()} started`);
    }
  } catch (e: any) {
    console.error(`[${new Date().toISOString()}] Crank error:`, e.message || e);
  }
}

console.log(`🚀 Flipsy crank bot starting`);
console.log(`   Cranker: ${crankerKeypair.publicKey.toString()}`);
console.log(`   Program: ${PROGRAM_ID.toString()}`);
console.log(`   RPC:     ${RPC_URL}`);

tick();
setInterval(tick, POLL_INTERVAL_MS);
