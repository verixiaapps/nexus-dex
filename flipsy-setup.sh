#!/bin/bash
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet"
echo "==============================================="

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/flipsy"

echo ""; echo "=== 1. Wallet ==="
mkdir -p ~/.config/solana
[ -f ~/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
solana config set --url devnet > /dev/null
WALLET=$(solana address)
echo "Wallet: $WALLET"

BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then exit 1; fi

echo ""; echo "=== 2. Program keypair ==="
mkdir -p target/deploy
if [ ! -f target/deploy/flipsy-keypair.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/flipsy-keypair.json
fi
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

echo ""; echo "=== 3. Updating program ID ==="
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml

echo ""; echo "=== 4. Lockfile + pins ==="
rm -f Cargo.lock
cargo generate-lockfile 2>/dev/null || true
cargo update -p blake3 --precise 1.5.5 2>/dev/null || true
cargo update -p solana-program --precise 1.18.26 2>/dev/null || true
cargo update -p bytemuck_derive --precise 1.7.1 2>/dev/null || true
cargo update -p toml_edit --precise 0.21.1 2>/dev/null || true
cargo update -p proc-macro2 --precise 1.0.86 2>/dev/null || true
[ -f Cargo.lock ] && sed -i 's/^version = 4$/version = 3/' Cargo.lock

echo ""; echo "=== 5. Building (3-8 min) ==="
anchor build

echo ""; echo "=== 6. Deploying ==="
SO_PATH=$(find . -name "flipsy.so" -path "*deploy*" 2>/dev/null | head -1)
solana program deploy "$SO_PATH" --program-id target/deploy/flipsy-keypair.json --url devnet

echo ""; echo "=== 7. IDL ==="
if [ -f target/idl/flipsy.json ]; then
  mkdir -p ../src/idl
  cp target/idl/flipsy.json ../src/idl/flipsy.json
fi

echo ""; echo "=== 8. NPM ==="
npm install --silent 2>/dev/null || true

echo ""; echo "=== 9. Initialize ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Initialize failed"

echo ""; echo "=== 10. First round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed"

echo ""
echo "✅ DONE — Program ID: $NEW_ID"
