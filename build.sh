#!/usr/bin/env bash
# Flipsy: patches lib.rs to drop pyth-sdk-solana, then builds, deploys, initializes, transfers authority.
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

echo "==> [1/13] Authority + git setup..."
sudo chown -R "$(whoami):$(whoami)" "$ROOT" ~ 2>/dev/null
git config --global --add safe.directory '*' 2>/dev/null
[ -z "$(git config --global user.name)"  ] && git config --global user.name "$(whoami)" 2>/dev/null
[ -z "$(git config --global user.email)" ] && git config --global user.email "$(whoami)@users.noreply.github.com" 2>/dev/null

cd "$FLIPSY" || { echo "no flipsy"; exit 1; }

echo "==> [2/13] Patching lib.rs to drop pyth-sdk-solana..."
python3 << 'PYEOF'
import re, sys
path = "programs/flipsy/src/lib.rs"
with open(path) as f:
    src = f.read()

# 1) drop the pyth_sdk_solana import (any form)
src2 = re.sub(r'^use pyth_sdk_solana[^\n]*\n', '', src, flags=re.MULTILINE)

# 2) replace the read_pyth_price function body with manual byte parsing
new_fn = '''fn read_pyth_price(feed_info: &AccountInfo, current_ts: i64) -> Result<i64> {
    let data = feed_info.try_borrow_data().map_err(|_| FlipsyError::PythError)?;
    if data.len() < 240 { return err!(FlipsyError::PythError); }
    let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
    if magic != 0xa1b2c3d4 { return err!(FlipsyError::PythError); }
    let atype = u32::from_le_bytes(data[8..12].try_into().unwrap());
    if atype != 3 { return err!(FlipsyError::PythError); }
    let expo = i32::from_le_bytes(data[20..24].try_into().unwrap());
    let timestamp = i64::from_le_bytes(data[96..104].try_into().unwrap());
    if current_ts.saturating_sub(timestamp) > 60 { return err!(FlipsyError::PythStale); }
    let status = u32::from_le_bytes(data[224..228].try_into().unwrap());
    if status != 1 { return err!(FlipsyError::PythStale); }
    let raw = i64::from_le_bytes(data[208..216].try_into().unwrap());
    let normalized = if expo >= -8 {
        raw.checked_mul(10_i64.pow((expo + 8) as u32)).ok_or(FlipsyError::PythOverflow)?
    } else {
        raw.checked_div(10_i64.pow((-expo - 8) as u32)).ok_or(FlipsyError::PythOverflow)?
    };
    Ok(normalized)
}'''

# Find fn read_pyth_price { ... } block
pat = re.compile(
    r'fn read_pyth_price\([^)]*\) -> Result<i64> \{.*?\n\}',
    re.DOTALL
)
if pat.search(src2):
    src2 = pat.sub(new_fn, src2, count=1)
    print("  patched read_pyth_price OK")
else:
    print("  WARN: read_pyth_price not found — lib.rs may already be patched.")

with open(path, 'w') as f:
    f.write(src2)
PYEOF

echo "==> [3/13] Removing pyth-sdk-solana from Cargo.toml..."
sed -i '/^pyth-sdk-solana/d' "$PROG_TOML"
sed -i 's/anchor-lang = "=*0\.30\.[0-9]*"/anchor-lang = "0.31.1"/g' "$PROG_TOML"
sed -i 's/anchor-spl = "=*0\.30\.[0-9]*"/anchor-spl = "0.31.1"/g' "$PROG_TOML"
grep -E "anchor-|pyth" "$PROG_TOML" | sed 's/^/    /'

echo "==> [4/13] Anchor 0.31.1..."
avm install 0.31.1 2>/dev/null
avm use 0.31.1 2>/dev/null
echo "    anchor: $(anchor --version)"

echo "==> [5/13] Solana → devnet..."
solana config set --url devnet >/dev/null
DEPLOYER=$(solana address)
echo "    deployer: $DEPLOYER · balance: $(solana balance)"

echo "==> [6/13] Wiping Cargo.lock + target, building..."
rm -rf target Cargo.lock
if ! anchor build 2>&1 | tee /tmp/build.log; then
  echo ""
  echo "BUILD FAILED. Tail:"
  tail -40 /tmp/build.log
  exit 1
fi

echo "==> [7/13] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

echo "==> [8/13] Writing program ID into lib.rs & Anchor.toml..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

echo "==> [9/13] Rebuilding with real ID..."
anchor build || exit 1

echo "==> [10/13] Deploying to devnet..."
anchor deploy --provider.cluster devnet || exit 1

mkdir -p "$ROOT/src/idl" 2>/dev/null
cp target/idl/flipsy.json "$ROOT/src/idl/flipsy.json" 2>/dev/null && echo "    IDL → $ROOT/src/idl/flipsy.json"

echo "==> [11/13] Treasury ATA + initialize + transfer admin..."
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
    console.log("  creating ATA (paid by deployer)...");
    const sig = await web3.sendAndConfirmTransaction(conn,
      new web3.Transaction().add(spl.createAssociatedTokenAccountInstruction(kp.publicKey, ata, TREASURY_OWNER, USDC_MINT)),
      [kp]);
    console.log("  ATA:", sig);
  } else { console.log("  ATA already exists."); }

  const [cfg] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  let c; try { c = await program.account.config.fetch(cfg); } catch {}
  if (!c) {
    console.log("Initializing...");
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
  } else console.log("WARN: admin is", c.admin.toBase58());
})().catch(e => { console.error("INIT FAILED:", e); process.exit(1); });
JSEOF

node "$ROOT/init-flipsy.js" || { echo "init failed"; exit 1; }
rm -f "$ROOT/init-flipsy.js"

echo "==> [12/13] Transferring upgrade authority..."
solana program set-upgrade-authority "$PROGRAM_ID" \
  --new-upgrade-authority "$TREASURY_OWNER" \
  --skip-new-upgrade-authority-signer-check 2>&1 | tail -5

echo "==> [13/13] Done."
echo ""
echo "==============================================="
echo " DEPLOYED + INITIALIZED + AUTHORITY TRANSFERRED"
echo "==============================================="
echo " Program ID         : $PROGRAM_ID"
echo " Admin              : $TREASURY_OWNER"
echo " Upgrade authority  : $TREASURY_OWNER"
echo " Explorer           : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "==============================================="
