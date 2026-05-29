#!/bin/bash
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet"
echo "==============================================="

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# === 0. CHECK / INSTALL ANCHOR ===
echo ""
echo "=== 0. Checking Anchor ==="
if ! command -v anchor &> /dev/null; then
  echo "Anchor not found — installing via avm (faster, prebuilt) ..."
  cargo install --git https://github.com/coral-xyz/anchor avm --force
  avm install 0.30.1
  avm use 0.30.1
fi
echo "Anchor version:"
anchor --version

# === 1. WALLET ===
echo ""
echo "=== 1. Checking devnet wallet ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 2. BALANCE CHECK ===
echo ""
echo "=== 2. Checking SOL balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"

# === 3. BUILD PROGRAM ===
echo ""
echo "=== 3. Building Solana program (this takes 2-3 min) ==="
cd flipsy
anchor build

# === 4. EXTRACT NEW PROGRAM ID ===
echo ""
echo "=== 4. Reading new program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "New program ID: $NEW_ID"

# === 5. UPDATE PROGRAM ID IN SOURCE FILES ===
echo ""
echo "=== 5. Updating program ID in 3 places ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated lib.rs, Anchor.toml, useFlipsy.js"

# === 6. REBUILD WITH NEW ID ===
echo ""
echo "=== 6. Rebuilding with correct ID ==="
anchor build

# === 7. DEPLOY ===
echo ""
echo "=== 7. Deploying to devnet ==="
anchor deploy --provider.cluster devnet

# === 8. COPY IDL TO FRONTEND ===
echo ""
echo "=== 8. Copying IDL to frontend ==="
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "✓ IDL copied"

# === 9. SUMMARY ===
echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo ""
echo "Program ID:  $NEW_ID"
echo "Wallet:      $WALLET"
echo ""
echo "NEXT STEPS:"
echo "  1. Commit and push these changes from GitHub:"
echo "     - flipsy/programs/flipsy/src/lib.rs"
echo "     - flipsy/Anchor.toml"
echo "     - src/hooks/useFlipsy.js"
echo "     - src/idl/flipsy.json"
echo "  2. Initialize config: cd flipsy && npx ts-node scripts/initialize.ts"
echo "  3. Start first round: npx ts-node scripts/crank-once.ts"
