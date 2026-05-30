#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Bumping Rust to 1.86 ==="
rustup install 1.86.0
rustup default 1.86.0
rustc --version

echo "=== Installing AVM ==="
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

echo "=== Installing Anchor 0.30.1 ==="
avm install 0.30.1
avm use 0.30.1
anchor --version

echo "=== Verifying ==="
solana --version
solana address
solana balance

echo ""
echo "✅ Toolchain ready"
