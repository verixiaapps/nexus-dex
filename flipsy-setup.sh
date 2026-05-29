#!/bin/bash
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet"
echo "==============================================="

# Make sure Solana is on PATH (in case the shell didn't pick it up)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"

# === 1. WALLET ===
echo ""
echo "=== 1. Setting up devnet wallet ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 2. AIRDROP ===
echo ""
echo "=== 2. Requesting devnet SOL airdrop ==="
solana airdrop 2 || echo "Airdrop failed (rate limit?). Will retry."
sleep 3
solana airdrop 2 || true
sleep 3
BALANCE=$(solana balance)
echo "Balance: $BALANCE"

# === 3. CHECK ANCHOR ===
echo ""
echo "=== 3. Checking Anchor ==="
if ! command -v anchor &> /dev/null; then
  echo "❌ Anchor not installed yet — it's probably still compiling."
  echo "   Run this script again in 5 minutes."
  exit 1
fi
anchor --version

# === 4. BUILD PROGRAM ===
echo ""
echo "=== 4. Building Solana program (this takes 2-3 min) ==="
cd flipsy
anchor build

# === 5. EXTRACT NEW PROGRAM ID ===
echo ""
echo "=== 5. Reading new program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "New program ID: $NEW_ID"

# === 6. UPDATE PROGRAM ID IN SOURCE FILES ===
echo ""
echo "=== 6. Updating program ID in 3 places ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated lib.rs, Anchor.toml, useFlipsy.js"

# === 7. REBUILD WITH NEW ID ===
echo ""
echo "=== 7. Rebuilding program with correct ID ==="
anchor build

# === 8. DEPLOY ===
echo ""
echo "=== 8. Deploying to devnet ==="
anchor deploy --provider.cluster devnet

# === 9. COPY IDL TO FRONTEND ===
echo ""
echo "=== 9. Copying IDL to frontend ==="
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "✓ IDL copied"

# === 10. SHOW SUMMARY ===
echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo ""
echo "Program ID:  $NEW_ID"
echo "Wallet:      $WALLET"
echo ""
echo "NEXT STEPS:"
echo "  1. Commit these changes to GitHub (lib.rs, Anchor.toml, useFlipsy.js, flipsy.json)"
echo "  2. Initialize the config: cd flipsy && npx ts-node scripts/initialize.ts"
echo "  3. Start first round:     npx ts-node scripts/crank-once.ts"
echo ""
