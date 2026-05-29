#!/bin/bash
set -e

echo "=== Installing Solana CLI ==="
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Installing Anchor CLI 0.30.1 ==="
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked

echo "=== Generating Solana devnet keypair ==="
mkdir -p ~/.config/solana
if [ ! -f ~/.config/solana/id.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
fi
solana config set --url devnet

echo "=== Installing flipsy dependencies ==="
cd flipsy && npm install --silent || true
cd ..

echo ""
echo "=== ✅ SETUP COMPLETE ==="
echo "Wallet:"
solana address
echo ""
echo "Next: cd flipsy && ./scripts/deploy-all.sh devnet"
