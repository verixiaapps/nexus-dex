#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:$PATH"

echo "=== Checking for running cargo/anchor processes ==="
RUNNING=$(ps aux | grep -E "cargo install|avm install" | grep -v grep || true)
if [ -n "$RUNNING" ]; then
  echo "⚠️  Install already running:"
  echo "$RUNNING"
  echo "Wait for it to finish before running this again."
  exit 0
fi
echo "✓ Nothing running"

echo ""
echo "=== Checking what's installed ==="
solana --version || echo "❌ Solana missing"
which avm && avm --version || echo "❌ AVM missing"
which anchor && anchor --version || echo "❌ Anchor missing"

echo ""
echo "=== Installing AVM (3-5 min) ==="
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

echo ""
echo "=== Installing Anchor 0.30.1 ==="
avm install 0.30.1
avm use 0.30.1

echo ""
echo "=== Final check ==="
anchor --version
solana --version
echo ""
echo "✅ Toolchain ready"
