#!/usr/bin/env bash
# Definitive Solana + Anchor setup for GitHub Codespaces.
# Removes broken installs, then gets a WORKING anchor by compiling from source
# (primary) or falling back to an older prebuilt binary. Safe to re-run.
set -uo pipefail
log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok(){  printf '\033[1;32m%s\033[0m\n' "$*"; }
err(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

ANCHOR_SRC_VERSION="0.31.1"                  # compiled from source
ANCHOR_FALLBACK_VERSIONS="0.30.1 0.29.0"     # older prebuilts tried if compile fails

log "[1/7] System libraries"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  build-essential libssl-dev pkg-config libudev-dev curl ca-certificates git >/dev/null

log "[2/7] Rust"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
mkdir -p "$HOME/.cargo/bin"

log "[3/7] Solana CLI (Agave)"
SOL_BIN="$HOME/.local/share/solana/install/active_release/bin"
if [ ! -x "$SOL_BIN/solana" ]; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$SOL_BIN:$PATH"

log "[4/7] Removing ALL old/broken Anchor binaries (the real reason it kept failing)"
rm -f "$HOME/.cargo/bin/anchor"
rm -f "$HOME/.avm/bin/anchor" "$HOME"/.avm/bin/anchor-* 2>/dev/null || true
hash -r
MEM_GB=$(free -g | awk '/^Mem:/{print $2}')
if [ "${MEM_GB:-0}" -lt 6 ]; then
  err "Low RAM (~${MEM_GB}GB) -> compiling single-threaded so it won't get Killed"
  export CARGO_BUILD_JOBS=1
fi

log "[5/7] Compiling anchor-cli v${ANCHOR_SRC_VERSION} from source (several minutes, be patient)"
cargo install --git https://github.com/coral-xyz/anchor --tag "v${ANCHOR_SRC_VERSION}" anchor-cli --force || true

log "[6/7] Verifying anchor actually RUNS"
ANCHOR_OK=0
if [ -x "$HOME/.cargo/bin/anchor" ] && "$HOME/.cargo/bin/anchor" --version >/dev/null 2>&1; then
  ANCHOR_OK=1; ok "Compiled anchor works."
else
  err "Compile didn't produce a runnable anchor. Trying older prebuilt binaries..."
  command -v avm >/dev/null 2>&1 || cargo install --git https://github.com/coral-xyz/anchor avm --force || true
  export PATH="$HOME/.avm/bin:$PATH"
  for V in $ANCHOR_FALLBACK_VERSIONS; do
    echo "  trying anchor $V ..."
    avm install "$V" >/dev/null 2>&1 || true
    if [ -x "$HOME/.avm/bin/anchor-$V" ] && "$HOME/.avm/bin/anchor-$V" --version >/dev/null 2>&1; then
      cp "$HOME/.avm/bin/anchor-$V" "$HOME/.cargo/bin/anchor"
      ANCHOR_OK=1; ok "  anchor $V runs on this machine — using it."; break
    fi
  done
fi

log "[7/7] Locking in PATH"
RC="$HOME/.bashrc"
add_line(){ grep -qxF "$1" "$RC" 2>/dev/null || echo "$1" >> "$RC"; }
add_line "export PATH=\"$SOL_BIN:\$PATH\""
add_line 'export PATH="$HOME/.cargo/bin:$PATH"'
export PATH="$HOME/.cargo/bin:$PATH"
hash -r

echo
echo "=================== RESULT ==================="
rustc  --version 2>/dev/null || err "rust missing"
solana --version 2>/dev/null || err "solana missing"
if [ "$ANCHOR_OK" = "1" ]; then
  "$HOME/.cargo/bin/anchor" --version
  ok "SUCCESS — anchor is working."
  echo "Now run:  source ~/.bashrc   (or open a new terminal)"
else
  err "ANCHOR STILL NOT WORKING — almost certainly the compile ran out of memory."
  err "Do this: GitHub menu -> Change machine type -> 4-core, then run this script again."
fi
echo "=============================================="
