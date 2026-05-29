#!/bin/bash
set -e

echo "=== Installing Rust ==="
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

echo "=== Installing Anchor CLI 0.30.1 ==="
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked

echo ""
echo "=== Versions ==="
rustc --version
solana --version
anchor --version

echo ""
echo "✅ ALL INSTALLED"
