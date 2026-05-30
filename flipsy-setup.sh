#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/flipsy"

echo "=== Upgrading to Anchor 0.31.1 ==="

# 1. Install Anchor 0.31.1
avm install 0.31.1
avm use 0.31.1
anchor --version

# 2. Rewrite program Cargo.toml to use 0.31.1
cat > programs/flipsy/Cargo.toml << 'EOF'
[package]
name = "flipsy"
version = "0.1.0"
description = "Coin-flip prediction market on Solana"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "flipsy"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = "0.31.1"
anchor-spl = "0.31.1"
pyth-sdk-solana = "0.10.4"
EOF
echo "✓ Cargo.toml updated"

# 3. Update Anchor.toml toolchain
sed -i 's|anchor_version = "[^"]*"|anchor_version = "0.31.1"|' Anchor.toml
sed -i 's|solana_version = "[^"]*"|solana_version = "1.18.26"|' Anchor.toml

# 4. Wallet check
WALLET=$(solana address)
echo "Wallet: $WALLET, Balance: $(solana balance)"

# 5. Program keypair
mkdir -p target/deploy
[ -f target/deploy/flipsy-keypair.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/flipsy-keypair.json
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# 6. Update declare_id
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml

# 7. Clean slate
rm -f Cargo.lock
rm -rf target/

# 8. Build
echo "=== Building (5-10 min) ==="
anchor build

# 9. Deploy
SO_PATH=$(find . -name "flipsy.so" -path "*deploy*" | head -1)
solana program deploy "$SO_PATH" --program-id target/deploy/flipsy-keypair.json --url devnet

# 10. IDL + init
mkdir -p ../src/idl
[ -f target/idl/flipsy.json ] && cp target/idl/flipsy.json ../src/idl/flipsy.json
npm install --silent 2>/dev/null || true
npx ts-node scripts/initialize.ts || true
npx ts-node scripts/crank-once.ts || true

echo "✅ DONE — Program ID: $NEW_ID"
