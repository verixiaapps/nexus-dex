#!/usr/bin/env bash
# Run from anywhere: bash build.sh
set -e

FLIPSY_DIR="/workspaces/nexus-dex/flipsy"

echo "==> Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" "$FLIPSY_DIR"

echo "==> Cleaning old build artifacts..."
sudo rm -rf "$FLIPSY_DIR/target"

echo "==> Entering flipsy workspace..."
cd "$FLIPSY_DIR"

echo "==> Checking for Anchor.toml..."
if [ ! -f "Anchor.toml" ]; then
  echo "ERROR: Anchor.toml is missing in $FLIPSY_DIR"
  echo "Create it first, then re-run this script."
  exit 1
fi

echo "==> Building (this takes 2-5 minutes the first time)..."
anchor build

echo ""
echo "==> Build succeeded. Your program ID:"
anchor keys list

echo ""
echo "==> NEXT STEPS:"
echo "1. Copy the pubkey above"
echo "2. Paste it into programs/flipsy/src/lib.rs -> declare_id!(\"...\")"
echo "3. Paste it into Anchor.toml -> [programs.localnet] flipsy = \"...\""
echo "   AND -> [programs.devnet] flipsy = \"...\""
echo "4. Re-run this script: bash build.sh"
echo "5. Then: anchor deploy"
