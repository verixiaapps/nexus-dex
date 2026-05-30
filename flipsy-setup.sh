#!/bin/bash
# FLIPSY full deploy — devnet
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet"
echo "==============================================="

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/flipsy"

# === 1. WALLET ===
echo ""; echo "=== 1. Wallet ==="
mkdir -p ~/.config/solana
[ -f ~/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
solana config set --url devnet > /dev/null
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 2. BALANCE ===
echo ""; echo "=== 2. Balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then
  echo "⚠️  Fund this wallet on DEVNET: $WALLET"
  echo "   https://faucet.solana.com  (request 2-5 SOL)"
  exit 1
fi

# === 3. PROGRAM KEYPAIR ===
echo ""; echo "=== 3. Program keypair ==="
mkdir -p target/deploy
if [ ! -f target/deploy/flipsy-keypair.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/flipsy-keypair.json
  echo "✓ Generated new program keypair"
else
  echo "✓ Using existing program keypair"
fi
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 4. UPDATE PROGRAM ID IN SOURCE ===
echo ""; echo "=== 4. Updating program ID in source ==="
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml
if [ -f ../src/hooks/useFlipsy.js ]; then
  sed -i "s|Flipsy[0-9A-Za-z]\{38,44\}|$NEW_ID|g" ../src/hooks/useFlipsy.js 2>/dev/null || true
fi
echo "✓ Updated lib.rs and Anchor.toml"

# === 5. CLEAN OLD LOCKFILE (incompatible with BPF cargo) ===
echo ""; echo "=== 5. Cleaning incompatible Cargo.lock ==="
rm -f Cargo.lock
echo "✓ Cleaned"

# === 6. BUILD ===
echo ""; echo "=== 6. Building program (3-8 min) ==="
anchor build

# === 7. ARTIFACTS ===
echo ""; echo "=== 7. Build artifacts ==="
SO_PATH=$(find . -name "flipsy.so" -path "*deploy*" 2>/dev/null | head -1)
echo "Program .so: $SO_PATH"

# === 8. DEPLOY ===
echo ""; echo "=== 8. Deploying to devnet ==="
solana program deploy "$SO_PATH" --program-id target/deploy/flipsy-keypair.json --url devnet

# === 9. COPY IDL ===
echo ""; echo "=== 9. IDL ==="
if [ -f target/idl/flipsy.json ]; then
  mkdir -p ../src/idl
  cp target/idl/flipsy.json ../src/idl/flipsy.json
  echo "✓ IDL copied to frontend"
else
  echo "⚠️  IDL not found"
fi

# === 10. NPM DEPS ===
echo ""; echo "=== 10. Installing script deps ==="
npm install --silent 2>/dev/null || echo "(npm install had warnings, continuing)"

# === 11. INITIALIZE ===
echo ""; echo "=== 11. Initializing config ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Initialize failed — check output above"

# === 12. START FIRST ROUND ===
echo ""; echo "=== 12. Starting first round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed — check output above"

echo ""
echo "==============================================="
echo "  ✅ ALL DONE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
echo ""
echo "Next: commit lib.rs, Anchor.toml, src/idl/flipsy.json to GitHub"
