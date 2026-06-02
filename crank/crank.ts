import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "4npVSUH3hx62E5VJSWdoCyUwfBnZirMxzqfDNWNCcYbT"
);
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "10000");
const GAP_SECONDS = 30;

function loadKeypair(): Keypair {
  const raw = process.env.CRANK_KEYPAIR;
  if (!raw) throw new Error("CRANK_KEYPAIR env var required");
  try {
    if (raw.trim().startsWith("[")) {
      const arr = JSON.parse(raw);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(raw.trim()));
  } catch (e) {
    throw new Error("Bad CRANK_KEYPAIR format: " + (e as Error).message);
  }
}

async function main() {
  const cranker = loadKeypair();
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(cranker);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log("Cranker pubkey:", cranker.publicKey.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("RPC:", RPC_URL);

  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("Could not fetch IDL from chain");
  const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  while (true) {
    try {
      const config: any = await (program.account as any).config.fetch(configPda);
      if (config.paused) {
        console.log("Paused, skipping");
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const currentEpoch: number = config.currentEpoch.toNumber();
      const now = Math.floor(Date.now() / 1000);

      if (currentEpoch === 0) {
        console.log("No round yet. Starting round 1...");
        await startRound(program, configPda, cranker, config, 1);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const [currentRoundPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("round"), new anchor.BN(currentEpoch).toArrayLike(Buffer, "le", 8)],
        PROGRAM_ID
      );
      const round: any = await (program.account as any).round.fetch(currentRoundPda);

      if (!round.resolved && now >= round.closeTime.toNumber()) {
        console.log(`Ending round ${currentEpoch}...`);
        await endRound(program, configPda, currentRoundPda, cranker, config, currentEpoch);
      } else if (round.resolved) {
        const nextEpoch = currentEpoch + 1;
        const nextLock = round.closeTime.toNumber() + GAP_SECONDS;
        if (now >= nextLock) {
          console.log(`Starting round ${nextEpoch}...`);
          await startRound(program, configPda, cranker, config, nextEpoch);
        } else {
          console.log(`Waiting ${nextLock - now}s for gap before round ${nextEpoch}`);
        }
      } else {
        const wait = round.closeTime.toNumber() - now;
        console.log(`Round ${currentEpoch} live, ${wait}s to close`);
      }
    } catch (e) {
      console.error("Loop error:", (e as Error).message);
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
  console.log("startRound tx:", tx);
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
      superAdmin: new PublicKey("GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA"),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([cranker])
    .rpc();
  console.log("endRound tx:", tx);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});


