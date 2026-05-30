#!/usr/bin/env bash
# Forces a real from-source Anchor build and removes the broken prebuilt binary.
set -uo pipefail
log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

ANCHOR_VERSION="0.31.1"

log "Deleting the broken prebuilt Anchor binaries (the ones needing GLIBC 2.39)"
rm -f "$HOME/.avm/bin/anchor" 2>/dev/null || true
rm -f "$HOME"/.avm/bin/anchor-* 2>/dev/null || true
rm -f "$HOME/.cargo/bin/anchor" 2>/dev/null || true

log "Low-memory check"
MEM_GB=$(free -g | awk '/^Mem:/{print $2}')
echo "~${MEM_GB} GB RAM"
if [ "${MEM_GB:-0}" -lt 6 ]; then
  echo "Low RAM -> compiling single-threaded so it won't run out of memory"
  export CARGO_BUILD_JOBS=1
fi

log "Compiling anchor-cli v${ANCHOR_VERSION} from source — several minutes, be patient"
cargo install --git https://github.com/coral-xyz/anchor --tag "v${ANCHOR_VERSION}" anchor-cli --force

log "Putting the freshly compiled anchor first on PATH"
export PATH="$HOME/.cargo/bin:$PATH"
LINE='export PATH="$HOME/.cargo/bin:$PATH"'
grep -qxF "$LINE" "$HOME/.bashrc" 2>/dev/null || echo "$LINE" >> "$HOME/.bashrc"

log "RESULT — this should print a version with NO GLIBC error:"
which anchor
anchor --version
echo
echo ">>> If a version printed cleanly, you are DONE. Then run: source ~/.bashrc"
 