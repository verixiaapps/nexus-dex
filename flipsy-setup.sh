#!/bin/bash
set -e

echo "==============================================="
echo "  FLIPSY DEPLOY — devnet (fresh)"
echo "==============================================="

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# === 0. ANCHOR CHECK ===
echo ""
echo "=== 0. Anchor check ==="
if ! command -v anchor &> /dev/null; then
  echo "❌ Anchor not found. Wait for devcontainer to finish, then re-run."
  exit 1
fi
anchor --version

# === 0b. PATCH ANCHOR.TOML — remove toolchain version check ===
echo ""
echo "=== 0b. Patching Anchor.toml ==="
cd flipsy
# Remove anchor_version line from [toolchain]
sed -i '/^anchor_version *=/d' Anchor.toml
echo "✓ Removed anchor_version pin"
cd ..

# === 1. WALLET ===
echo ""
echo "=== 1. Devnet wallet ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet > /dev/null
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 2. BALANCE ===
echo ""
echo "=== 2. SOL balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then
  echo ""
  echo "⚠️  Need devnet SOL. Wallet: $WALLET"
  echo "   Open: https://faucet.solana.com  or  https://solfaucet.com"
  echo "   Request 2-5 SOL on DEVNET to this wallet."
  echo ""
  read -p "Press ENTER when funded, or CTRL+C to abort..."
  BALANCE=$(solana balance)
  echo "Balance now: $BALANCE"
fi

# === 3. BUILD ===
echo ""
echo "=== 3. Building program (3-5 min) ==="
cd flipsy
anchor build --skip-lint

# === 4. NEW PROGRAM ID ===
echo ""
echo "=== 4. Program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 5. UPDATE 3 FILES ===
echo ""
echo "=== 5. Updating program ID in 3 files ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated lib.rs, Anchor.toml, useFlipsy.js"

# === 6. REBUILD WITH NEW ID ===
echo ""
echo "=== 6. Rebuild with correct ID ==="
anchor build --skip-lint

# === 7. DEPLOY ===
echo ""
echo "=== 7. Deploying to devnet ==="
anchor deploy --provider.cluster devnet

# === 8. COPY IDL ===
echo ""
echo "=== 8. Copying IDL ==="
mkdir -p ../src/idl
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "✓ IDL copied"

# === 9. COMMIT + PUSH ===
echo ""
echo "=== 9. Committing changes ==="
cd ..
git config --global user.email "deploy@flipsy.local" 2>/dev/null || true
git config --global user.name "Flipsy Deploy" 2>/dev/null || true
git add flipsy/programs/flipsy/src/lib.rs flipsy/Anchor.toml src/hooks/useFlipsy.js src/idl/flipsy.json
git commit -m "Deploy Flipsy program $NEW_ID" || echo "Nothing to commit"
git push origin main || echo "⚠️  Push failed — commit locally and push from GitHub mobile"

# === 10. SUMMARY ===
echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
echo ""
echo "NEXT (still on devnet):"
echo "  cd flipsy"
echo "  npm install"
echo "  npx ts-node scripts/initialize.ts"
echo "  npx ts-node scripts/crank-once.ts"
echo ""
echo "Then Railway will redeploy with live program data."
