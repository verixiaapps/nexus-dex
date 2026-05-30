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
  echo "⚠️  Fund this wallet first"
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

# === 4. UPDATE PROGRAM ID ===
echo ""; echo "=== 4. Updating program ID ==="
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml
echo "✓ Updated"

# === 5. CLEAN AND GENERATE LOCKFILE ===
echo ""; echo "=== 5. Preparing Cargo.lock ==="
rm -f Cargo.lock
cargo generate-lockfile 2>/dev/null || true

# === 6. PIN PROBLEMATIC DEPENDENCIES (edition2024 fix) ===
echo ""; echo "=== 6. Pinning deps for Rust 1.75 compat ==="
cargo update -p solana-program --precise 1.18.26 2>/dev/null || true
cargo update -p bytemuck_derive --precise 1.7.1 2>/dev/null || true
cargo update -p bytemuck --precise 1.16.3 2>/dev/null || true
cargo update -p ahash --precise 0.8.11 2>/dev/null || true
cargo update -p toml_edit --precise 0.21.1 2>/dev/null || true
cargo update -p toml_datetime --precise 0.6.5 2>/dev/null || true
cargo update -p winnow --precise 0.5.40 2>/dev/null || true
cargo update -p proc-macro2 --precise 1.0.86 2>/dev/null || true

# Downgrade lockfile to v3 (Solana BPF compat)
if [ -f Cargo.lock ]; then
  sed -i 's/^version = 4$/version = 3/' Cargo.lock
  echo "✓ Cargo.lock pinned to v3"
fi

# === 7. BUILD ===
echo ""; echo "=== 7. Building program (3-8 min) ==="
anchor build

# === 8. ARTIFACTS ===
echo ""; echo "=== 8. Build artifacts ==="
SO_PATH=$(find . -name "flipsy.so" -path "*deploy*" 2>/dev/null | head -1)
echo "Program .so: $SO_PATH"

# === 9. DEPLOY ===
echo ""; echo "=== 9. Deploying to devnet ==="
solana program deploy "$SO_PATH" --program-id target/deploy/flipsy-keypair.json --url devnet

# === 10. COPY IDL ===
echo ""; echo "=== 10. IDL ==="
if [ -f target/idl/flipsy.json ]; then
  mkdir -p ../src/idl
  cp target/idl/flipsy.json ../src/idl/flipsy.json
  echo "✓ IDL copied"
fi

# === 11. NPM DEPS ===
echo ""; echo "=== 11. Installing script deps ==="
npm install --silent 2>/dev/null || true

# === 12. INITIALIZE ===
echo ""; echo "=== 12. Initializing config ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Initialize failed"

# === 13. START FIRST ROUND ===
echo ""; echo "=== 13. Starting first round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed"

echo ""
echo "==============================================="
echo "  ✅ ALL DONE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
