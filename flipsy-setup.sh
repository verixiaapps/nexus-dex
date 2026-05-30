#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/flipsy"

echo "=== Removing broken Anchor 0.31.1 binary ==="
rm -rf ~/.avm/bin/anchor-0.31.1

echo "=== Building Anchor 0.31.1 from source (5-8 min) ==="
cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli --locked --force
anchor --version

echo "=== Wallet ==="
WALLET=$(solana address)
echo "Wallet: $WALLET, Balance: $(solana balance)"

echo "=== Program keypair ==="
mkdir -p target/deploy
[ -f target/deploy/flipsy-keypair.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/flipsy-keypair.json
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

echo "=== Updating source files ==="
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$NEW_ID\");|" programs/flipsy/src/lib.rs
sed -i "s|^flipsy = \"[^\"]*\"|flipsy = \"$NEW_ID\"|" Anchor.toml

echo "=== Ensuring Cargo.toml uses 0.31.1 ==="
cat > programs/flipsy/Cargo.toml << EOF
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

echo "=== Clean slate ==="
rm -f Cargo.lock
rm -rf target/deploy/flipsy.so target/idl

echo "=== Building program (5-10 min) ==="
anchor build

echo "=== Deploying ==="
SO_PATH=$(find . -name "flipsy.so" -path "*deploy*" | head -1)
solana program deploy "$SO_PATH" --program-id target/deploy/flipsy-keypair.json --url devnet

echo "=== IDL ==="
mkdir -p ../src/idl
[ -f target/idl/flipsy.json ] && cp target/idl/flipsy.json ../src/idl/flipsy.json

echo "=== NPM + scripts ==="
npm install --silent 2>/dev/null || true
npx ts-node scripts/initialize.ts || echo "Initialize failed"
npx ts-node scripts/crank-once.ts || echo "Crank failed"

echo "✅ Program ID: $NEW_ID"
