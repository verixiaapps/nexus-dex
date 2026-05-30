#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/5] System libraries"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential libssl-dev pkg-config libudev-dev curl ca-certificates

echo "==> [2/5] Rust"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "$HOME/.cargo/env"

echo "==> [3/5] Solana CLI (Agave)"
if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "==> [4/5] Anchor via AVM (prebuilt binary, no source compile)"
if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --force
fi
export PATH="$HOME/.avm/bin:$PATH"
avm install latest
avm use latest

echo "==> [5/5] Make PATH permanent"
RC="$HOME/.bashrc"
SOL_LINE='export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"'
AVM_LINE='export PATH="$HOME/.avm/bin:$PATH"'
grep -qxF "$SOL_LINE" "$RC" || echo "$SOL_LINE" >> "$RC"
grep -qxF "$AVM_LINE" "$RC" || echo "$AVM_LINE" >> "$RC"

echo "==> Done."
rustc --version && solana --version && anchor --version
echo "Open a NEW terminal (or: source ~/.bashrc)."
