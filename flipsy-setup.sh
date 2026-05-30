#!/bin/bash
set -e
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Cloning Anchor and patching deps ==="
cd /tmp
rm -rf anchor
git clone --depth 1 --branch v0.30.1 https://github.com/coral-xyz/anchor.git
cd anchor

echo "=== Pinning old cargo-platform ==="
cargo update -p cargo-platform --precise 0.1.8 2>/dev/null || true
cargo update -p icu_properties_data --precise 1.5.0 2>/dev/null || true
cargo update -p icu_provider --precise 1.5.0 2>/dev/null || true
cargo update -p idna_adapter --precise 1.1.0 2>/dev/null || true

echo "=== Building Anchor 0.30.1 from source ==="
cargo install --path cli --locked --force
anchor --version

echo "✅ Done"
