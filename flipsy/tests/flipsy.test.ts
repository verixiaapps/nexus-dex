import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

const PROGRAM_ID     = new web3.PublicKey("H4LAd2s7yVboni7oDqf1JtQ3UcqWJBZo5NpAhYisJaVj");
const USDC_MINT      = new web3.PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PYTH_FEED      = new web3.PublicKey("J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix");
const TREASURY_OWNER = new web3.PublicKey("Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV");

describe("flipsy-init", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Flipsy as anchor.Program;

  it("initializes", async () => {
    const ata = await getAssociatedTokenAddress(USDC_MINT, TREASURY_OWNER);

    const ataInfo = await provider.connection.getAccountInfo(ata);
    if (!ataInfo) {
      const tx = new web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey, ata, TREASURY_OWNER, USDC_MINT
        )
      );
      await provider.sendAndConfirm(tx);
      console.log("Treasury ATA created:", ata.toString());
    } else {
      console.log("Treasury ATA exists:", ata.toString());
    }

    const [cfg] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")], PROGRAM_ID
    );

    try {
      await program.account.config.fetch(cfg);
      console.log("Already initialized");
      return;
    } catch {}

    const sig = await program.methods
      .initialize(
        new anchor.BN(300),
        new anchor.BN(100000),
        new anchor.BN(5000000),
        2000,
        500
      )
      .accounts({
        config: cfg,
        usdcMint: USDC_MINT,
        pythFeed: PYTH_FEED,
        treasury: ata,
        admin: provider.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Initialized! Tx:", sig);
    console.log("Config PDA:", cfg.toString());
  });
});
