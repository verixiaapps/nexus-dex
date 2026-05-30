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
  exit 1
fi

# === 3. PROGRAM KEYPAIR ===
echo ""; echo "=== 3. Program keypair ==="
mkdir -p target/deploy
if [ ! -f target/deploy/flipsy-keypair.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/flipsy-keypair.json
fi
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 4. UPDATE PROGRAM ID IN SOURCE ===
echo ""; echo "=== 4. Updating program ID in source ==="
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml
echo "✓ Updated"

# === 5. GENERATE LOCKFILE AND DOWNGRADE TO V3 ===
echo ""; echo "=== 5. Preparing Cargo.lock (force v3 for BPF compat) ==="
rm -f Cargo.lock
cargo generate-lockfile 2>/dev/null || true
if [ -f Cargo.lock ]; then
  sed -i 's/^version = 4$/version = 3/' Cargo.lock
  echo "✓ Cargo.lock pinned to v3"
fi

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
  echo "✓ IDL copied"
fi

# === 10. NPM DEPS ===
echo ""; echo "=== 10. Installing script deps ==="
npm install --silent 2>/dev/null || true

# === 11. INITIALIZE ===
echo ""; echo "=== 11. Initializing config ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Initialize failed"

# === 12. START FIRST ROUND ===
echo ""; echo "=== 12. Starting first round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed"

echo ""
echo "==============================================="
echo "  ✅ ALL DONE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
