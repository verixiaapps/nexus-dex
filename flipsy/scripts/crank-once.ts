import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RPC_URL, PROGRAM_ID, USDC_MINT, PYTH_SOL_USD } from "./config";
import { loadKeypair, loadIdl } from "./utils";
 
async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const cranker = loadKeypair();
  const wallet = new anchor.Wallet(cranker);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = loadIdl();
  const program = new Program(idl, provider) as Program;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  const config: any = await (program.account as any).config.fetch(configPda);
  const currentEpoch = config.currentEpoch.toNumber();
  console.log(`Current epoch: ${currentEpoch}`);

  // Try to end current round if it exists and is due
  if (currentEpoch > 0) {
    const epochBytes = Buffer.alloc(8);
    epochBytes.writeBigUInt64LE(BigInt(currentEpoch));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("round"), epochBytes],
      PROGRAM_ID
    );
    try {
      const round: any = await (program.account as any).round.fetch(roundPda);
      const now = Math.floor(Date.now() / 1000);
      const isUnresolved = "unresolved" in round.outcome;
      if (isUnresolved && now >= round.closeTime.toNumber()) {
        console.log(`Ending round #${currentEpoch}...`);
        const tx = await program.methods
          .endRound()
          .accounts({
            config: configPda,
            round: roundPda,
            pythFeed: PYTH_SOL_USD,
            cranker: cranker.publicKey,
          })
          .signers([cranker])
          .rpc();
        console.log(`✅ Ended round #${currentEpoch}. Tx: ${tx}`);
      } else if (!isUnresolved) {
        console.log(`Round #${currentEpoch} already resolved.`);
      } else {
        console.log(`Round #${currentEpoch} not yet due (${round.closeTime.toNumber() - now}s left).`);
      }
    } catch (e) {
      console.log(`Could not fetch round #${currentEpoch}:`, (e as Error).message);
    }
  }

  // Start the next round
  const nextEpoch = currentEpoch + 1;
  const nextEpochBytes = Buffer.alloc(8);
  nextEpochBytes.writeBigUInt64LE(BigInt(nextEpoch));
  const [nextRoundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), nextEpochBytes],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nextEpochBytes],
    PROGRAM_ID
  );

  try {
    await (program.account as any).round.fetch(nextRoundPda);
    console.log(`Round #${nextEpoch} already started.`);
    return;
  } catch {
    // doesn't exist, start it
  }

  console.log(`Starting round #${nextEpoch}...`);
  const tx = await program.methods
    .startRound()
    .accounts({
      config: configPda,
      round: nextRoundPda,
      vault: vaultPda,
      usdcMint: USDC_MINT,
      pythFeed: PYTH_SOL_USD,
      cranker: cranker.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([cranker])
    .rpc();

  console.log(`✅ Started round #${nextEpoch}. Tx: ${tx}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
