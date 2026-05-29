import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, createMint } from "@solana/spl-token";
import { assert } from "chai";
 
describe("flipsy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Flipsy as Program;
  const admin = (provider.wallet as anchor.Wallet).payer;

  // Devnet Pyth SOL/USD
  const PYTH_FEED = new PublicKey("J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix");

  let usdcMint: PublicKey;
  let treasuryAta: PublicKey;
  let configPda: PublicKey;

  before(async () => {
    // Create mock USDC mint
    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    const treasury = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      usdcMint,
      admin.publicKey
    );
    treasuryAta = treasury.address;

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  it("initializes config", async () => {
    await program.methods
      .initialize()
      .accounts({
        config: configPda,
        usdcMint,
        pythFeed: PYTH_FEED,
        treasury: treasuryAta,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config: any = await (program.account as any).config.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.currentEpoch.toString(), "0");
    assert.equal(config.paused, false);
  });

  // Additional tests (start_round, place_bet, end_round, claim) require
  // Pyth oracle data on devnet. Run those manually via crank-once.ts
  // and admin.ts after deploying.
});
