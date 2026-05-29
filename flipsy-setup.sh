#!/bin/bash
# FLIPSY full deploy — anchor 0.29.0, no toolchain manager

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "==============================================="
echo "  FLIPSY DEPLOY — anchor 0.29.0"
echo "==============================================="

# === 1. PATCH Cargo.toml TO ANCHOR 0.29.0 ===
echo ""; echo "=== 1. Pinning anchor 0.29.0 in Cargo.toml ==="
sed -i 's/anchor-lang = "[^"]*"/anchor-lang = "0.29.0"/g' flipsy/programs/flipsy/Cargo.toml
sed -i 's/anchor-spl = "[^"]*"/anchor-spl = "0.29.0"/g' flipsy/programs/flipsy/Cargo.toml
echo "✓ Cargo.toml updated"

# === 2. CLEAR Anchor.toml TOOLCHAIN SECTION ===
echo ""; echo "=== 2. Clearing Anchor.toml toolchain pin ==="
sed -i '/^anchor_version *=/d' flipsy/Anchor.toml
echo "✓ Done"

# === 3. INSTALL ANCHOR 0.29.0 (no avm, no toolchain manager) ===
echo ""; echo "=== 3. Installing anchor 0.29.0 (~5 min, be patient) ==="
cargo install --git https://github.com/coral-xyz/anchor --tag v0.29.0 anchor-cli --locked --force
hash -r
which anchor
anchor --version

# === 4. WALLET ===
echo ""; echo "=== 4. Wallet ==="
mkdir -p ~/.config/solana
[ -f ~/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
solana config set --url devnet > /dev/null
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 5. BALANCE ===
echo ""; echo "=== 5. Balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then
  echo "⚠️  Fund DEVNET wallet: $WALLET"
  echo "   https://faucet.solana.com (request 2-5 SOL)"
  read -p "Press ENTER when funded..."
fi

# === 6. BUILD ===
echo ""; echo "=== 6. anchor build (3-5 min) ==="
cd flipsy
anchor build --skip-lint
if [ $? -ne 0 ]; then
  echo "❌ Build failed. Screenshot the error."
  exit 1
fi

# === 7. PROGRAM ID ===
echo ""; echo "=== 7. Program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 8. UPDATE 3 FILES ===
echo ""; echo "=== 8. Updating program ID in 3 files ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated"

# === 9. REBUILD ===
echo ""; echo "=== 9. Rebuild with correct ID ==="
anchor build --skip-lint

# === 10. DEPLOY ===
echo ""; echo "=== 10. Deploying to devnet ==="
anchor deploy --provider.cluster devnet
if [ $? -ne 0 ]; then
  echo "❌ Deploy failed. Screenshot the error."
  exit 1
fi

# === 11. IDL ===
echo ""; echo "=== 11. Copying IDL to frontend ==="
mkdir -p ../src/idl
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "✓ IDL copied"

# === 12. SCRIPT DEPS ===
echo ""; echo "=== 12. npm install ==="
npm install --silent 2>/dev/null || true

# === 13. INITIALIZE ===
echo ""; echo "=== 13. Initialize on-chain config ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Init failed — run manually later"

# === 14. FIRST ROUND ===
echo ""; echo "=== 14. Start first round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed — run manually later"

# === 15. COMMIT + PUSH ===
echo ""; echo "=== 15. Commit + push ==="
cd ..
git config --global user.email "deploy@flipsy.local" 2>/dev/null || true
git config --global user.name "Flipsy Deploy" 2>/dev/null || true
git add flipsy/programs/flipsy/Cargo.toml flipsy/programs/flipsy/src/lib.rs flipsy/Anchor.toml src/hooks/useFlipsy.js src/idl/flipsy.json 2>/dev/null || true
git commit -m "Deploy Flipsy $NEW_ID with anchor 0.29.0" 2>/dev/null || echo "Nothing to commit"
git push origin main 2>/dev/null || echo "⚠️  Push failed — commit from GitHub mobile"

echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
echo "Site will redeploy on Railway. Visit /flipsy"
