#!/bin/bash
set -e
 
NETWORK="${1:-devnet}"
echo "=== FLIPSY Deploy ($NETWORK) ==="

cd "$(dirname "$0")/.."

# Step 1: Build
echo ""
echo "Step 1/5: Building program..."
anchor build

# Step 2: Get program ID
PROGRAM_ID=$(solana address -k target/deploy/flipsy-keypair.json)
echo "  Program ID: $PROGRAM_ID"

# Step 3: Patch declare_id! in lib.rs if needed
echo ""
echo "Step 2/5: Verifying program ID in source..."
CURRENT_ID=$(grep -oP 'declare_id!\("\K[^"]+' programs/flipsy/src/lib.rs || echo "")
if [ "$CURRENT_ID" != "$PROGRAM_ID" ]; then
  echo "  Updating declare_id! from $CURRENT_ID to $PROGRAM_ID"
  sed -i "s|declare_id!(\"$CURRENT_ID\")|declare_id!(\"$PROGRAM_ID\")|" programs/flipsy/src/lib.rs
  sed -i "s|flipsy = \"$CURRENT_ID\"|flipsy = \"$PROGRAM_ID\"|g" Anchor.toml || true
  echo "  Rebuilding with correct program ID..."
  anchor build
fi

# Step 4: Deploy
echo ""
echo "Step 3/5: Deploying to $NETWORK..."
solana config set --url "https://api.$NETWORK.solana.com"

# Make sure we have enough SOL
BAL=$(solana balance | grep -oP '^[0-9.]+')
echo "  Wallet balance: $BAL SOL"
if (( $(echo "$BAL < 3" | bc -l) )); then
  echo "  Requesting airdrop..."
  solana airdrop 2 || echo "  (airdrop failed, continuing)"
fi

anchor deploy --provider.cluster "$NETWORK"

# Step 5: Initialize config
echo ""
echo "Step 4/5: Initializing config..."
PROGRAM_ID=$PROGRAM_ID NETWORK=$NETWORK npx ts-node scripts/initialize.ts

# Step 6: Copy IDL to DEX src/idl/
echo ""
echo "Step 5/5: Copying IDL to ../src/idl/..."
mkdir -p ../src/idl
cp target/idl/flipsy.json ../src/idl/flipsy.json
echo "  ✅ IDL copied."

echo ""
echo "=== ✅ DEPLOY COMPLETE ==="
echo ""
echo "Program ID: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "  1. Commit & push: target/idl/flipsy.json, programs/flipsy/src/lib.rs, Anchor.toml, ../src/idl/flipsy.json"
echo "  2. Start the first round:"
echo "     PROGRAM_ID=$PROGRAM_ID NETWORK=$NETWORK npx ts-node scripts/crank-once.ts"
echo "  3. Set up the GitHub Actions cron to crank every 5 min"
