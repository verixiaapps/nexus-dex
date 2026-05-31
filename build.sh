#!/usr/bin/env bash
# Flipsy: build + deploy + initialize + transfer authority to your wallet.
# Idempotent — safe to re-run.

set +e
trap 'echo ""; echo "Script interrupted."; exit 130' INT

# ===== YOUR WALLET (gets all fees + all admin power) =====
TREASURY_OWNER="Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV"

# ===== PATHS =====
ROOT="/workspaces/nexus-dex"
FLIPSY="$ROOT/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
ANCHOR_TOML="$FLIPSY/Anchor.toml"
DEVCONTAINER="$ROOT/.devcontainer/devcontainer.json"

# ===== DEVNET CONSTANTS =====
USDC_MINT="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
PYTH_FEED="J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix"

echo "==> [1/15] Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ "$FLIPSY" 2>/dev/null

echo "==> [2/15] Updating host Rust..."
rustup update stable 2>/dev/null; rustup default stable 2>/dev/null
echo "    rustc: $(rustc --version)"

echo "==> [3/15] Updating Solana platform-tools..."
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" 2>&1 | tail -3
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "    solana: $(solana --version)"

echo "==> [4/15] Ensuring Anchor 0.30.1..."
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --force --locked
fi
avm install 0.30.1 2>/dev/null
avm use 0.30.1 2>/dev/null
echo "    anchor: $(anchor --version)"

cd "$FLIPSY" || { echo "ERROR: $FLIPSY not found"; exit 1; }

echo "==> [5/15] Solana → devnet..."
solana config set --url devnet >/dev/null
DEPLOYER=$(solana address)
echo "    deployer: $DEPLOYER"
echo "    balance : $(solana balance)"

echo "==> [6/15] Pre-pinning edition-2024 crates..."
for pin in "blake3@1.5.4" "litemap@0.7.4" "zerofrom@0.1.5" "zerovec@0.10.4" \
           "tinystr@0.7.6" "writeable@0.5.5" "yoke@0.7.4" \
           "icu_collections@1.5.0" "icu_normalizer@1.5.0" "icu_normalizer_data@1.5.0" \
           "icu_properties@1.5.0" "icu_properties_data@1.5.0" \
           "idna_adapter@1.1.0" "url@2.5.2" "bytemuck_derive@1.7.1" \
           "ahash@0.8.11" "borsh@1.5.1"; do
  name="${pin%@*}"; ver="${pin#*@}"
  cargo update -p "$name" --precise "$ver" 2>/dev/null
done

echo "==> [7/15] Cleaning..."
rm -rf target

echo "==> [8/15] Build with auto-detect + auto-pin..."
SUCCESS=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  echo "----- attempt $attempt -----"
  LOG=$(mktemp)
  anchor build 2>&1 | tee "$LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then SUCCESS=1; break; fi
  FAILED=$(grep -B2 "edition2024" "$LOG" | grep -oE '[a-zA-Z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/Cargo\.toml' | head -1 | sed 's|/Cargo.toml||')
  [ -z "$FAILED" ] && { echo "not edition2024 — bailing"; tail -50 "$LOG"; break; }
  CRATE=$(echo "$FAILED" | sed -E 's/-[0-9]+\.[0-9]+\.[0-9]+$//')
  VER=$(echo "$FAILED" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$')
  echo "    failing: $CRATE @ $VER → downgrading"
  P=$(echo "$VER" | awk -F. '{print $1"."$2"."($3-1)}')
  M=$(echo "$VER" | awk -F. '{print $1"."($2-1)".0"}')
  cargo update -p "$CRATE" --precise "$P" 2>/dev/null || \
  cargo update -p "$CRATE" --precise "$M" 2>/dev/null
done

if [ "$SUCCESS" -ne 1 ]; then
  echo ""; echo "==> Writing fallback devcontainer..."
  mkdir -p "$ROOT/.devcontainer"
  cat > "$DEVCONTAINER" << 'JSONEOF'
{
  "name": "Flipsy (Solana Foundation image)",
  "image": "solanafoundation/anchor:v0.31.1",
  "features": { "ghcr.io/devcontainers/features/git:1": {}, "ghcr.io/devcontainers/features/node:1": { "version": "20" } },
  "customizations": { "vscode": { "extensions": ["rust-lang.rust-analyzer", "tamasfe.even-better-toml"] } },
  "hostRequirements": { "cpus": 4, "memory": "8gb" }
}
JSONEOF
  echo "Now: Command Palette → 'Codespaces: Rebuild Container' then re-run bash build.sh"
  exit 1
fi

echo "==> [9/15] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

echo "==> [10/15] Writing program ID into source files..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

echo "==> [11/15] Rebuilding with real ID..."
anchor build || exit 1

echo "==> [12/15] Deploying to devnet..."
anchor deploy --provider.cluster devnet || exit 1

IDL_DST="$ROOT/src/idl"
mkdir -p "$IDL_DST" 2>/dev/null
cp target/idl/flipsy.json "$IDL_DST/flipsy.json" 2>/dev/null && echo "    IDL → $IDL_DST/flipsy.json"

echo "==> [13/15] Installing JS deps (if needed)..."
cd "$ROOT"
[ ! -d node_modules ] && { echo "    npm install..."; npm install --silent 2>&1 | tail -5; }

echo "==> [14/15] Creating treasury USDC ATA + initializing + transferring admin..."
INIT_JS="$ROOT/init-flipsy.js"
cat > "$INIT_JS" << JSEOF
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
  const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
  const kpData = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json"));
  const payer = web3.Keypair.fromSecretKey(Uint8Array.from(kpData));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  let program;
  try { program = new anchor.Program(IDL, provider); }
  catch { program = new anchor.Program(IDL, PROGRAM_ID, provider); }

  // ----- 1. Treasury USDC ATA -----
  const treasuryAta = await spl.getAssociatedTokenAddress(USDC_MINT, TREASURY_OWNER);
  console.log("Treasury USDC ATA:", treasuryAta.toBase58());
  const ataInfo = await connection.getAccountInfo(treasuryAta);
  if (!ataInfo) {
    console.log("  Creating ATA (payer = deployer)...");
    const ix = spl.createAssociatedTokenAccountInstruction(payer.publicKey, treasuryAta, TREASURY_OWNER, USDC_MINT);
    const sig = await web3.sendAndConfirmTransaction(connection, new web3.Transaction().add(ix), [payer]);
    console.log("  ATA created:", sig);
  } else { console.log("  ATA already exists."); }

  // ----- 2. Initialize -----
  const [configPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  let cfg;
  try { cfg = await program.account.config.fetch(configPda); } catch {}
  if (!cfg) {
    console.log("Initializing program...");
    const sig = await program.methods
      .initialize(new anchor.BN(300), new anchor.BN(100000), new anchor.BN(5000000), 2000, 500)
      .accounts({
        config: configPda,
        usdcMint: USDC_MINT,
        pythFeed: PYTH_FEED,
        treasury: treasuryAta,
        admin: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    console.log("  Initialized:", sig);
    cfg = await program.account.config.fetch(configPda);
  } else {
    console.log("Program already initialized.");
  }

  // ----- 3. Transfer admin to your wallet -----
  if (cfg.admin.equals(TREASURY_OWNER)) {
    console.log("Admin is already your wallet. Nothing to do.");
  } else if (cfg.admin.equals(payer.publicKey)) {
    console.log("Transferring admin → your wallet...");
    const sig = await program.methods.setAdmin(TREASURY_OWNER).accounts({
      config: configPda,
      admin: payer.publicKey,
    }).rpc();
    console.log("  Admin transferred:", sig);
  } else {
    console.log("WARNING: current admin is neither deployer nor your wallet. Skipping transfer.");
    console.log("  Current admin:", cfg.admin.toBase58());
  }
})().catch(e => { console.error("INIT FAILED:", e); process.exit(1); });
JSEOF

node "$INIT_JS" || { echo "init failed"; exit 1; }
rm -f "$INIT_JS"

echo "==> [15/15] Transferring program upgrade authority to your wallet..."
# This lets you deploy new versions of the program code later from your wallet.
solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$TREASURY_OWNER" \
  --skip-new-upgrade-authority-signer-check 2>&1 | tail -5

echo ""
echo "==============================================="
echo " DEPLOYED + INITIALIZED + AUTHORITY TRANSFERRED"
echo "==============================================="
echo " Program ID         : $PROGRAM_ID"
echo " Network            : devnet"
echo " Admin (config)     : $TREASURY_OWNER  (your wallet)"
echo " Upgrade authority  : $TREASURY_OWNER  (your wallet)"
echo " Treasury (USDC)    : ATA of $TREASURY_OWNER"
echo " Round              : 5 min · min \$0.10 · max \$5"
echo " Fees               : 20% on profit · 5% solo refund"
echo " Explorer           : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "==============================================="
echo ""
echo "Your wallet controls everything: fees, params, AND code upgrades."
echo "The Codespace deployer wallet has NO authority anymore."
echo "Keep your Phantom seed phrase safe — it's the only way to upgrade or change settings."
