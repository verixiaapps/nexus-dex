#!/bin/bash
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet"
echo "==============================================="

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$PATH"

# === 0. SKIP ANCHOR INSTALL — use whatever is already there ===
echo ""
echo "=== 0. Anchor check ==="
if ! command -v anchor &> /dev/null; then
  echo "❌ Anchor not found. Wait for devcontainer setup, then re-run."
  exit 1
fi
anchor --version

# === 1. WALLET ===
echo ""
echo "=== 1. Devnet wallet ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 2. BALANCE ===
echo ""
echo "=== 2. SOL balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then
  echo ""
  echo "⚠️  You need devnet SOL!"
  echo "    Send it to: $WALLET"
  echo "    Via: https://faucet.solana.com or https://solfaucet.com"
  echo ""
  read -p "Press ENTER when you've airdropped SOL, or CTRL+C to abort..."
  BALANCE=$(solana balance)
  echo "Balance now: $BALANCE"
fi

# === 3. SKIP ANCHOR.TOML VERSION CHECK ===
echo ""
echo "=== 3. Patching Anchor.toml to skip version check ==="
cd flipsy
sed -i 's/^anchor_version = .*/# anchor_version disabled/' Anchor.toml || true

# === 4. BUILD ===
echo ""
echo "=== 4. Building program ==="
anchor build --skip-lint

# === 5. NEW PROGRAM ID ===
echo ""
echo "=== 5. Program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 6. UPDATE 3 PLACES ===
echo ""
echo "=== 6. Updating program ID in 3 files ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated"

# === 7. REBUILD ===
echo ""
echo "=== 7. Rebuild with correct ID ==="
anchor build --skip-lint

# === 8. DEPLOY ===
echo ""
echo "=== 8. Deploying to devnet ==="
anchor deploy --provider.cluster devnet

# === 9. IDL ===
echo ""
echo "=== 9. Copying IDL ==="
cp target/idl/flipsy.json ../src/idl/flipsy.json

echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
echo ""
echo "NOW:"
echo "  1. Commit changes from GitHub mobile:"
echo "     - flipsy/programs/flipsy/src/lib.rs"
echo "     - flipsy/Anchor.toml"
echo "     - src/hooks/useFlipsy.js"
echo "     - src/idl/flipsy.json"
echo "  2. Initialize: cd flipsy && npx ts-node scripts/initialize.ts"
echo "  3. Start round: npx ts-node scripts/crank-once.ts"
