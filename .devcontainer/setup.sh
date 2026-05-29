#!/bin/bash
set -e

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Installing Anchor 0.29.0 ==="
cargo install --git https://github.com/coral-xyz/anchor --tag v0.29.0 anchor-cli --locked

echo "=== Generating devnet keypair ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet

echo ""
echo "=== ✅ SETUP COMPLETE ==="
rustc --version
solana --version
anchor --version
node --version
solana address
