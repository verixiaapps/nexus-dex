#!/bin/bash
# FLIPSY deploy — uses official Solana installer + Anchor 1.0.2

echo "==============================================="
echo "  FLIPSY DEPLOY — official path"
echo "==============================================="

# === 1. UPGRADE Cargo.toml TO ANCHOR 1.0.2 ===
echo ""; echo "=== 1. Upgrading anchor-lang to 1.0.2 in Cargo.toml ==="
sed -i 's/anchor-lang = "[^"]*"/anchor-lang = "1.0.2"/g' flipsy/programs/flipsy/Cargo.toml
sed -i 's/anchor-spl = "[^"]*"/anchor-spl = "1.0.2"/g' flipsy/programs/flipsy/Cargo.toml
echo "✓ Cargo.toml updated"

# === 2. RUN OFFICIAL SOLANA + ANCHOR INSTALLER ===
echo ""; echo "=== 2. Official Solana + Anchor installer (~5-10 min) ==="
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash

# === 3. LOAD ALL THE NEW PATHS ===
echo ""; echo "=== 3. Loading PATH ==="
export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
hash -r

# === 4. VERIFY ===
echo ""; echo "=== 4. Versions ==="
rustc --version || true
solana --version || true
anchor --version || true
node --version || true

# === 5. WALLET ===
echo ""; echo "=== 5. Wallet ==="
mkdir -p ~/.config/solana
[ -f ~/.config/solana/id.json ] || solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
solana config set --url devnet > /dev/null
WALLET=$(solana address)
echo "Wallet: $WALLET"

# === 6. BALANCE ===
echo ""; echo "=== 6. Balance ==="
BALANCE=$(solana balance)
echo "Balance: $BALANCE"
if [[ "$BALANCE" == "0 SOL" ]]; then
  echo "⚠️  Fund DEVNET wallet: $WALLET"
  echo "   https://faucet.solana.com (request 2-5 SOL)"
  read -p "Press ENTER when funded..."
fi

# === 7. BUILD ===
echo ""; echo "=== 7. anchor build ==="
cd flipsy
anchor build

# === 8. PROGRAM ID ===
echo ""; echo "=== 8. Program ID ==="
NEW_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "Program ID: $NEW_ID"

# === 9. UPDATE 3 FILES ===
echo ""; echo "=== 9. Updating program ID in 3 files ==="
OLD_ID="Fpsy1111111111111111111111111111111111111111"
sed -i "s|$OLD_ID|$NEW_ID|g" programs/flipsy/src/lib.rs
sed -i "s|$OLD_ID|$NEW_ID|g" Anchor.toml
sed -i "s|$OLD_ID|$NEW_ID|g" ../src/hooks/useFlipsy.js
echo "✓ Updated"

# === 10. REBUILD WITH CORRECT ID ===
echo ""; echo "=== 10. Rebuild ==="
anchor build

# === 11. DEPLOY ===
echo ""; echo "=== 11. Deploying to devnet ==="
anchor deploy --provider.cluster devnet

# === 12. IDL ===
echo ""; echo "=== 12. IDL ==="
mkdir -p ../src/idl
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "✓ IDL copied"

# === 13. SCRIPT DEPS ===
echo ""; echo "=== 13. npm install ==="
npm install --silent 2>/dev/null || true

# === 14. INITIALIZE ===
echo ""; echo "=== 14. Initialize ==="
npx ts-node scripts/initialize.ts || echo "⚠️  Init failed — run manually later"

# === 15. FIRST ROUND ===
echo ""; echo "=== 15. Start first round ==="
npx ts-node scripts/crank-once.ts || echo "⚠️  Crank failed — run manually later"

# === 16. COMMIT + PUSH ===
echo ""; echo "=== 16. Commit + push ==="
cd ..
git config --global user.email "deploy@flipsy.local" 2>/dev/null || true
git config --global user.name "Flipsy Deploy" 2>/dev/null || true
git add flipsy/programs/flipsy/Cargo.toml flipsy/programs/flipsy/src/lib.rs flipsy/Anchor.toml src/hooks/useFlipsy.js src/idl/flipsy.json 2>/dev/null || true
git commit -m "Deploy Flipsy $NEW_ID with Anchor 1.0.2" 2>/dev/null || echo "Nothing to commit"
git push origin main 2>/dev/null || echo "⚠️  Push failed — commit from GitHub mobile"

echo ""
echo "==============================================="
echo "  ✅ DEPLOY COMPLETE"
echo "==============================================="
echo "Program ID: $NEW_ID"
echo "Wallet:     $WALLET"
