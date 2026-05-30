#!/usr/bin/env bash
# All-in-one Solana + Anchor setup for GitHub Codespaces.
# Safe to run more than once. Fixes the `GLIBC_2.39 not found` anchor error
# by compiling Anchor from source, and stays within low-memory limits so it
# works even on a small Codespace.

set -uo pipefail
log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------- 0. Machine check + low-memory protection ----------
log "Machine check"
echo "CPU cores: $(nproc)"
free -h || true
MEM_GB=$(free -g | awk '/^Mem:/{print $2}')
echo "Detected ~${MEM_GB} GB RAM"

# Compiling Anchor can run out of memory on small machines and print "Killed".
# Capping cargo to a single job keeps peak memory low so the build survives.
if [ "${MEM_GB:-0}" -lt 6 ]; then
  log "Low RAM detected — compiling single-threaded to avoid out-of-memory"
  export CARGO_BUILD_JOBS=1
fi

# ---------- 1. System libraries (missing these = silent failures) ----------
log "Installing system libraries"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential libssl-dev pkg-config libudev-dev curl ca-certificates git

# ---------- 2. Rust ----------
log "Ensuring Rust"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
rustc --version

# ---------- 3. Solana CLI (Agave) ----------
log "Ensuring Solana CLI"
SOL_BIN="$HOME/.local/share/solana/install/active_release/bin"
if [ ! -x "$SOL_BIN/solana" ]; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$SOL_BIN:$PATH"
solana --version

# ---------- 4. avm (Anchor Version Manager) ----------
log "Ensuring avm"
if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --force
fi
export PATH="$HOME/.avm/bin:$PATH"

# ---------- 5. Anchor FROM SOURCE (the real GLIBC fix) ----------
log "Installing Anchor from source — this compiles, give it several minutes"
avm install latest --from-source
avm use latest

# ---------- 6. Make PATH permanent across new terminals ----------
log "Persisting PATH"
RC="$HOME/.bashrc"
for LINE in \
  "export PATH=\"$SOL_BIN:\$PATH\"" \
  'export PATH="$HOME/.avm/bin:$PATH"'; do
  grep -qxF "$LINE" "$RC" 2>/dev/null || echo "$LINE" >> "$RC"
done

# ---------- 7. Verify ----------
log "RESULT — all three should print a version:"
rustc  --version
solana --version
anchor --version
echo
echo ">>> If 'anchor' printed a version above, it WORKED. Open a new terminal (or run: source ~/.bashrc)."
