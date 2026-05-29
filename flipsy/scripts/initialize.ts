import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { RPC_URL, PROGRAM_ID, USDC_MINT, PYTH_SOL_USD, TREASURY_OWNER } from "./config";
import { loadKeypair, loadIdl } from "./utils";
 
async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair();
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = loadIdl();
  const program = new Program(idl, provider) as Program;

  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("USDC Mint:", USDC_MINT.toBase58());
  console.log("Pyth Feed:", PYTH_SOL_USD.toBase58());

  // Treasury owner defaults to admin if not set
  const treasuryOwner = TREASURY_OWNER || admin.publicKey;
  console.log("Treasury Owner:", treasuryOwner.toBase58());

  // Get or create treasury USDC ATA
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    USDC_MINT,
    treasuryOwner
  );
  console.log("Treasury USDC ATA:", treasuryAta.address.toBase58());

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
  console.log("Config PDA:", configPda.toBase58());

  // Check if already initialized
  try {
    const existing = await (program.account as any).config.fetch(configPda);
    console.log("✅ Already initialized.");
    console.log("  Current epoch:", existing.currentEpoch.toString());
    console.log("  Paused:", existing.paused);
    return;
  } catch {
    // not initialized yet, continue
  }

  console.log("Initializing config...");
  const tx = await program.methods
    .initialize()
    .accounts({
      config: configPda,
      usdcMint: USDC_MINT,
      pythFeed: PYTH_SOL_USD,
      treasury: treasuryAta.address,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  console.log("✅ Initialized. Tx:", tx);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
