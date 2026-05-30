#!/bin/bash
set -e

echo "=== Installing Rust 1.85 (needed for edition2024) ==="
rustup install 1.85.0
rustup default 1.85.0
rustc --version
cargo --version

echo "=== Installing AVM ==="
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

echo "=== Installing Anchor 0.30.1 ==="
export PATH="$HOME/.cargo/bin:$PATH"
avm install 0.30.1
avm use 0.30.1
anchor --version

echo "=== Verifying Solana ==="
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version
solana config set --url devnet
solana address
solana balance

echo ""
echo "✅ Toolchain ready. Next: bash deploy.sh"
