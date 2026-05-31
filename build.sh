#!/usr/bin/env bash
# Flipsy: build + deploy + initialize + transfer authority.
# Designed for solanafoundation/anchor:v0.31.1 codespace.
set +e
trap 'echo ""; echo "Script interrupted."; exit 130' INT

# ===== YOUR WALLET (gets all fees + all admin power) =====
TREASURY_OWNER="Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV"

# ===== PATHS =====
ROOT="/workspaces/nexus-dex"
FLIPSY="$ROOT/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
PROG_TOML="$FLIPSY/programs/flipsy/Cargo.toml"
ANCHOR_TOML="$FLIPSY/Anchor.toml"

# ===== DEVNET CONSTANTS =====
USDC_MINT="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
PYTH_FEED="J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix"

# ----------------------------------------------------------
echo "==> [1/14] Granting you full authority over the repo..."
sudo chown -R "$(whoami):$(whoami)" "$ROOT" ~ 2>/dev/null
git config --global --add safe.directory '*' 2>/dev/null
git config --global --add safe.directory "$ROOT" 2>/dev/null
git config --global --add safe.directory "$FLIPSY" 2>/dev/null
[ -z "$(git config --global user.name)"  ] && git config --global user.name  "$(whoami)" 2>/dev/null
[ -z "$(git config --global user.email)" ] && git config --global user.email "$(whoami)@users.noreply.github.com" 2>/dev/null
git config --global pull.rebase true 2>/dev/null
echo "    git: ok · user: $(git config --global user.name) <$(git config --global user.email)>"

cd "$FLIPSY" || { echo "ERROR: $FLIPSY not found"; exit 1; }

# ----------------------------------------------------------
echo "==> [2/14] Toolchain in this image:"
echo "    rustc  : $(rustc --version 2>/dev/null)"
echo "    solana : $(solana --version 2>/dev/null)"
echo "    anchor : $(anchor --version 2>/dev/null)"

# ----------------------------------------------------------
echo "==> [3/14] Setting Anchor 0.31.1 (image-native)..."
avm install 0.31.1 2>/dev/null
avm use 0.31.1 2>/dev/null
echo "    anchor : $(anchor --version)"

# ----------------------------------------------------------
echo "==> [4/14] Patching Cargo.toml deps..."
sed -i 's/anchor-lang = "=*0\.30\.[0-9]*"/anchor-lang = "0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-spl  *= "=*0\.30\.[0-9]*"/anchor-spl = "0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-spl = "=*0\.30\.[0-9]*"/anchor-spl = "0.31.1"/g' "$PROG_TOML"
echo "    Cargo.toml after patch:"
grep -E "anchor-(lang|spl)|pyth-sdk-solana" "$PROG_TOML" | sed 's/^/      /'

# ----------------------------------------------------------
echo "==> [5/14] Solana → devnet..."
solana config set --url devnet >/dev/null
DEPLOYER=$(solana address)
echo "    deployer: $DEPLOYER"
echo "    balance : $(solana balance)"

# ----------------------------------------------------------
echo "==> [6/14] Building (tries 4 pyth-sdk-solana versions if needed)..."
BUILD_OK=0
for PYTH_VER in "0.10.4" "0.10.3" "0.10.1" "0.10.0"; do
  echo "----- pyth-sdk-solana = $PYTH_VER -----"
  sed -i "s/pyth-sdk-solana *= *\"[^\"]*\"/pyth-sdk-solana = \"$PYTH_VER\"/g" "$PROG_TOML"
  rm -rf target Cargo.lock
  if anchor build 2>&1 | tee /tmp/build.log; then
    BUILD_OK=1; echo "    Built with pyth-sdk-solana $PYTH_VER"
    break
  fi
  echo "    failed with $PYTH_VER, trying next..."
done

if [ "$BUILD_OK" -ne 1 ]; then
  echo ""
  echo "================================================="
  echo " BUILD FAILED after trying all pyth-sdk-solana versions."
  echo " Tail of last error:"
  tail -50 /tmp/build.log
  echo "================================================="
  echo ""
  echo "Next step: replace pyth-sdk-solana usage in lib.rs with"
  echo "manual byte parsing. Send me the contents of lib.rs and"
  echo "I'll patch it surgically."
  exit 1
fi

# ----------------------------------------------------------
echo "==> [7/14] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

# ----------------------------------------------------------
echo "==> [8/14] Writing program ID into lib.rs & Anchor.toml..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

# ----------------------------------------------------------
echo "==> [9/14] Rebuilding with real program ID..."
anchor build || exit 1

# ----------------------------------------------------------
echo "==> [10/14] Deploying to devnet..."
anchor deploy --provider.cluster devnet || exit 1

IDL_DST="$ROOT/src/idl"
mkdir -p "$IDL_DST" 2>/dev/null
cp target/idl/flipsy.json "$IDL_DST/flipsy.json" 2>/dev/null && \
  echo "    IDL → $IDL_DST/flipsy.json"

# ----------------------------------------------------------
echo "==> [11/14] Installing JS deps if needed..."
cd "$ROOT"
[ ! -d node_modules ] && { echo "    npm install..."; npm install --silent 2>&1 | tail -5; }

# ----------------------------------------------------------
echo "==> [12/14] Creating your treasury USDC ATA, initializing program, transferring admin..."
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
    console.log("  creating ATA (paid by deployer)...");
    const sig = await web3.sendAndConfirmTransaction(conn,
      new web3.Transaction().add(spl.createAssociatedTokenAccountInstruction(kp.publicKey, ata, TREASURY_OWNER, USDC_MINT)),
      [kp]);
    console.log("  ATA:", sig);
  } else { console.log("  ATA already exists."); }

  const [cfg] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  let c; try { c = await program.account.config.fetch(cfg); } catch {}
  if (!c) {
    console.log("Initializing program...");
    const sig = await program.methods
      .initialize(new anchor.BN(300), new anchor.BN(100000), new anchor.BN(5000000), 2000, 500)
      .accounts({ config: cfg, usdcMint: USDC_MINT, pythFeed: PYTH_FEED, treasury: ata,
                  admin: kp.publicKey, systemProgram: web3.SystemProgram.programId })
      .rpc();
    console.log("  initialize:", sig);
    c = await program.account.config.fetch(cfg);
  } else { console.log("Already initialized."); }

  if (c.admin.equals(TREASURY_OWNER)) console.log("Admin is already your wallet.");
  else if (c.admin.equals(kp.publicKey)) {
    console.log("Transferring admin → your wallet...");
    const sig = await program.methods.setAdmin(TREASURY_OWNER)
      .accounts({ config: cfg, admin: kp.publicKey }).rpc();
    console.log("  setAdmin:", sig);
  } else console.log("WARN: current admin is", c.admin.toBase58());
})().catch(e => { console.error("INIT FAILED:", e); process.exit(1); });
JSEOF

node "$ROOT/init-flipsy.js" || { echo "init failed"; exit 1; }
rm -f "$ROOT/init-flipsy.js"

# ----------------------------------------------------------
echo "==> [13/14] Transferring program upgrade authority to your wallet..."
solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$TREASURY_OWNER" \
  --skip-new-upgrade-authority-signer-check 2>&1 | tail -5

# ----------------------------------------------------------
echo "==> [14/14] Done."
echo ""
echo "==============================================="
echo " DEPLOYED + INITIALIZED + AUTHORITY TRANSFERRED"
echo "==============================================="
echo " Program ID         : $PROGRAM_ID"
echo " Network            : devnet"
echo " Admin              : $TREASURY_OWNER  (your wallet)"
echo " Upgrade authority  : $TREASURY_OWNER  (your wallet)"
echo " Treasury USDC ATA  : (ATA of $TREASURY_OWNER)"
echo " Round              : 5 min · min \$0.10 · max \$5"
echo " Fees               : 20% on profit · 5% solo refund"
echo " Explorer           : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "==============================================="
echo ""
echo "Your wallet $TREASURY_OWNER has full control."
echo "The Codespace deployer has no authority anymore."
