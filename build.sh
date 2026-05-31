#!/usr/bin/env bash
# Flipsy: build + deploy + initialize + transfer authority.
# Uses Anchor 0.31.1 (native to solanafoundation/anchor image).
set +e
trap 'echo ""; echo "Script interrupted."; exit 130' INT

TREASURY_OWNER="Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV"
ROOT="/workspaces/nexus-dex"
FLIPSY="$ROOT/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
PROG_TOML="$FLIPSY/programs/flipsy/Cargo.toml"
ANCHOR_TOML="$FLIPSY/Anchor.toml"
USDC_MINT="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
PYTH_FEED="J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix"

echo "==> [1/13] Granting you full authority over the repo..."
# File ownership: you own everything in the workspace
sudo chown -R "$(whoami):$(whoami)" "$ROOT" ~ 2>/dev/null

# Git: trust this directory (fixes "dubious ownership" on git pull/push/etc.)
git config --global --add safe.directory '*' 2>/dev/null
git config --global --add safe.directory "$ROOT" 2>/dev/null
git config --global --add safe.directory "$FLIPSY" 2>/dev/null

# Make sure git knows who you are so commits work
[ -z "$(git config --global user.name)"  ] && git config --global user.name  "$(whoami)" 2>/dev/null
[ -z "$(git config --global user.email)" ] && git config --global user.email "$(whoami)@users.noreply.github.com" 2>/dev/null

# Auto-rebase on pull (cleaner history)
git config --global pull.rebase true 2>/dev/null

echo "    git safe.directory: ok"
echo "    git user.name     : $(git config --global user.name)"
echo "    git user.email    : $(git config --global user.email)"

cd "$FLIPSY" || { echo "no flipsy dir"; exit 1; }

echo "==> [2/13] Tools already in this image:"
echo "    rustc  : $(rustc --version)"
echo "    solana : $(solana --version)"
echo "    anchor : $(anchor --version)"

echo "==> [3/13] Setting Anchor 0.31.1 via avm..."
avm install 0.31.1 2>/dev/null
avm use 0.31.1
echo "    anchor : $(anchor --version)"

echo "==> [4/13] Updating program Cargo.toml to anchor-lang/spl 0.31.1..."
sed -i 's/anchor-lang = "0\.30\.[0-9]*"/anchor-lang = "0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-spl = "0\.30\.[0-9]*"/anchor-spl = "0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-lang = "=0\.30\.[0-9]*"/anchor-lang = "=0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-spl = "=0\.30\.[0-9]*"/anchor-spl = "=0.31.1"/g' "$PROG_TOML"
grep -E "anchor-(lang|spl)" "$PROG_TOML" || true

echo "==> [5/13] Wiping Cargo.lock + target for a clean build..."
rm -rf target Cargo.lock

echo "==> [6/13] Solana → devnet..."
solana config set --url devnet >/dev/null
DEPLOYER=$(solana address)
echo "    deployer: $DEPLOYER"
echo "    balance : $(solana balance)"

echo "==> [7/13] Building..."
anchor build || { echo "build failed — paste output here"; exit 1; }

echo "==> [8/13] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

echo "==> [9/13] Writing program ID into source..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

echo "==> [10/13] Rebuilding..."
anchor build || exit 1

echo "==> [11/13] Deploying to devnet..."
anchor deploy --provider.cluster devnet || exit 1

mkdir -p "$ROOT/src/idl" 2>/dev/null
cp target/idl/flipsy.json "$ROOT/src/idl/flipsy.json" 2>/dev/null && echo "    IDL → $ROOT/src/idl/flipsy.json"

echo "==> [12/13] Treasury ATA + initialize + transfer admin..."
cd "$ROOT"
[ ! -d node_modules ] && { echo "    npm install..."; npm install --silent 2>&1 | tail -5; }

cat > "$ROOT/init-flipsy.js" << JSEOF
const anchor = require("@coral-xyz/anchor");
const web3 = require("@solana/web3.js");
const spl  = require("@solana/spl-token");
const fs   = require("fs");

const PROGRAM_ID     = new web3.PublicKey("$PROGRAM_ID");
const USDC_MINT      = new web3.PublicKey("$USDC_MINT");
const PYTH_FEED      = new web3.PublicKey("$PYTH_FEED");
const TREASURY_OWNER = new web3.PublicKey("$TREASURY_OWNER");
const IDL = JSON.parse(fs.readFileSync("$FLIPSY/target/idl/flipsy.json"));

(async () => {
  const conn = new web3.Connection("https://api.devnet.solana.com", "confirmed");
  const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json"))));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
  anchor.setProvider(provider);
  let program;
  try { program = new anchor.Program(IDL, provider); }
  catch { program = new anchor.Program(IDL, PROGRAM_ID, provider); }

  const ata = await spl.getAssociatedTokenAddress(USDC_MINT, TREASURY_OWNER);
  console.log("Treasury USDC ATA:", ata.toBase58());
  if (!(await conn.getAccountInfo(ata))) {
    console.log("  creating ATA...");
    const sig = await web3.sendAndConfirmTransaction(conn,
      new web3.Transaction().add(spl.createAssociatedTokenAccountInstruction(kp.publicKey, ata, TREASURY_OWNER, USDC_MINT)),
      [kp]);
    console.log("  ATA:", sig);
  }

  const [cfg] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  let c; try { c = await program.account.config.fetch(cfg); } catch {}
  if (!c) {
    console.log("Initializing...");
    const sig = await program.methods.initialize(new anchor.BN(300), new anchor.BN(100000), new anchor.BN(5000000), 2000, 500)
      .accounts({ config: cfg, usdcMint: USDC_MINT, pythFeed: PYTH_FEED, treasury: ata, admin: kp.publicKey, systemProgram: web3.SystemProgram.programId })
      .rpc();
    console.log("  initialize:", sig);
    c = await program.account.config.fetch(cfg);
  } else console.log("Already initialized.");

  if (c.admin.equals(TREASURY_OWNER)) console.log("Admin already your wallet.");
  else if (c.admin.equals(kp.publicKey)) {
    console.log("Transferring admin to your wallet...");
    const sig = await program.methods.setAdmin(TREASURY_OWNER).accounts({ config: cfg, admin: kp.publicKey }).rpc();
    console.log("  setAdmin:", sig);
  } else console.log("WARN: admin is", c.admin.toBase58());
})().catch(e => { console.error("INIT FAILED:", e); process.exit(1); });
JSEOF

node "$ROOT/init-flipsy.js" || exit 1
rm -f "$ROOT/init-flipsy.js"

echo "==> [13/13] Transferring upgrade authority to your wallet..."
solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$TREASURY_OWNER" \
  --skip-new-upgrade-authority-signer-check 2>&1 | tail -5

echo ""
echo "==============================================="
echo " DEPLOYED + INITIALIZED + AUTHORITY TRANSFERRED"
echo "==============================================="
echo " Program ID         : $PROGRAM_ID"
echo " Network            : devnet"
echo " Admin              : $TREASURY_OWNER  (you)"
echo " Upgrade authority  : $TREASURY_OWNER  (you)"
echo " Explorer           : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "==============================================="
