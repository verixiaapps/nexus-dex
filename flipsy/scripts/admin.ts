import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RPC_URL, PROGRAM_ID } from "./config";
import { loadKeypair, loadIdl } from "./utils";

const COMMANDS = ["status", "pause", "unpause", "force-refund", "sweep", "emergency-sweep"];

async function main() {
  const cmd = process.argv[2];
  if (!cmd || !COMMANDS.includes(cmd)) {
    console.log("Usage: ts-node admin.ts <command> [epoch]");
    console.log("Commands:", COMMANDS.join(", "));
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair();
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = loadIdl();
  const program = new Program(idl, provider) as Program;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  if (cmd === "status") {
    const config: any = await (program.account as any).config.fetch(configPda);
    console.log("=== FLIPSY Status ===");
    console.log("Admin:", config.admin.toBase58());
    console.log("Current epoch:", config.currentEpoch.toString());
    console.log("Paused:", config.paused);
    console.log("USDC Mint:", config.usdcMint.toBase58());
    console.log("Pyth Feed:", config.pythFeed.toBase58());
    console.log("Treasury:", config.treasury.toBase58());
    return;
  }

  if (cmd === "pause" || cmd === "unpause") {
    const paused = cmd === "pause";
    const tx = await program.methods
      .setPaused(paused)
      .accounts({ config: configPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
    console.log(`✅ ${cmd}. Tx: ${tx}`);
    return;
  }

  // Commands that need an epoch arg
  const epochArg = process.argv[3];
  if (!epochArg) {
    console.error(`Command '${cmd}' requires an epoch number.`);
    process.exit(1);
  }
  const epoch = parseInt(epochArg);
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64LE(BigInt(epoch));
  const [roundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), epochBytes],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), epochBytes],
    PROGRAM_ID
  );

  const config: any = await (program.account as any).config.fetch(configPda);

  if (cmd === "force-refund") {
    const tx = await program.methods
      .forceRefund()
      .accounts({ config: configPda, round: roundPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
    console.log(`✅ Force-refunded round #${epoch}. Tx: ${tx}`);
    return;
  }

  if (cmd === "sweep") {
    const tx = await program.methods
      .sweepNoWinners()
      .accounts({
        config: configPda,
        round: roundPda,
        vault: vaultPda,
        treasuryUsdc: config.treasury,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log(`✅ Swept no-winners round #${epoch}. Tx: ${tx}`);
    return;
  }

  if (cmd === "emergency-sweep") {
    const tx = await program.methods
      .emergencySweep()
      .accounts({
        config: configPda,
        round: roundPda,
        vault: vaultPda,
        treasuryUsdc: config.treasury,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log(`✅ Emergency-swept round #${epoch}. Tx: ${tx}`);
    return;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
