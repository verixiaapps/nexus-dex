#!/usr/bin/env bash
# TRY EVERYTHING: runs every official Solana-Foundation method to get a working
# anchor, in order, verifying each actually RUNS. Stops at first success.
# Safe to re-run.
set -uo pipefail
log(){  printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok(){   printf '\033[1;32m%s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m%s\033[0m\n' "$*"; }
err(){  printf '\033[1;31m%s\033[0m\n' "$*"; }

export RUSTUP_TOOLCHAIN=stable
SOL_BIN="$HOME/.local/share/solana/install/active_release/bin"
TARGET="$HOME/.cargo/bin/anchor"
REPO="https://github.com/solana-foundation/anchor"
anchor_runs(){ [ -x "$1" ] && "$1" --version >/dev/null 2>&1; }

log "[1] System libraries"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  build-essential libssl-dev pkg-config libudev-dev curl ca-certificates git >/dev/null

log "[2] Ensure Rust + Solana"
command -v cargo >/dev/null 2>&1 || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
mkdir -p "$HOME/.cargo/bin"
[ -x "$SOL_BIN/solana" ] || sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$SOL_BIN:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"

log "[3] Free up disk"
df -h / | sed -n '1p;/\//p'
ls -d "$HOME"/.local/share/solana/install/releases/1.1[0-7]* 2>/dev/null | xargs -r rm -rf
rm -rf "$HOME"/.cargo/registry/cache/* 2>/dev/null || true

log "[4] Remove broken Anchor binaries"
rm -f "$TARGET" "$HOME/.avm/bin/anchor" "$HOME"/.avm/bin/anchor-* 2>/dev/null || true
hash -r
MEM_GB=$(free -g | awk '/^Mem:/{print $2}')
[ "${MEM_GB:-0}" -lt 6 ] && { warn "Low RAM (~${MEM_GB}GB) -> single-threaded compile"; export CARGO_BUILD_JOBS=1; }

# ---- methods ----
try_source(){
  log "METHOD: compile anchor-cli v$1 from source"
  cargo install --git "$REPO" --tag "v$1" anchor-cli --force || true
  anchor_runs "$TARGET"
}
try_avm_source(){
  log "METHOD: avm install $1 --from-source"
  command -v avm >/dev/null 2>&1 || cargo install --git "$REPO" avm --force || true
  avm uninstall "$1" >/dev/null 2>&1 || true
  avm install "$1" --from-source >/dev/null 2>&1 || true
  avm use "$1" >/dev/null 2>&1 || true
  anchor_runs "$HOME/.avm/bin/anchor-$1" && { cp "$HOME/.avm/bin/anchor-$1" "$TARGET"; return 0; } || return 1
}
try_prebuilt(){
  log "METHOD: prebuilt anchor $1 (older = lower glibc requirement)"
  command -v avm >/dev/null 2>&1 || cargo install --git "$REPO" avm --force || true
  avm install "$1" >/dev/null 2>&1 || true
  anchor_runs "$HOME/.avm/bin/anchor-$1" && { cp "$HOME/.avm/bin/anchor-$1" "$TARGET"; return 0; } || return 1
}
try_docker(){
  command -v docker >/dev/null 2>&1 || { warn "docker not available, skipping"; return 1; }
  log "METHOD: Docker-backed anchor (pulls solanafoundation/anchor image)"
  docker pull solanafoundation/anchor:0.31.1 >/dev/null 2>&1 || return 1
  cat > "$TARGET" <<'WRAP'
#!/usr/bin/env bash
exec docker run --rm -v "$PWD":/work -w /work solanafoundation/anchor:0.31.1 anchor "$@"
WRAP
  chmod +x "$TARGET"
  anchor_runs "$TARGET"
}

# ---- run them all, stop at first success ----
OK=0; FROM=""
try_source       0.31.1 && { OK=1; FROM="source build 0.31.1"; }
[ $OK = 0 ] && try_source       0.32.1 && { OK=1; FROM="source build 0.32.1"; }
[ $OK = 0 ] && try_avm_source   0.31.1 && { OK=1; FROM="avm --from-source 0.31.1"; }
[ $OK = 0 ] && try_prebuilt     0.30.1 && { OK=1; FROM="prebuilt 0.30.1"; }
[ $OK = 0 ] && try_prebuilt     0.29.0 && { OK=1; FROM="prebuilt 0.29.0"; }
[ $OK = 0 ] && try_docker              && { OK=1; FROM="docker image 0.31.1"; }

log "[5] Lock in PATH"
RC="$HOME/.bashrc"
add(){ grep -qxF "$1" "$RC" 2>/dev/null || echo "$1" >> "$RC"; }
add "export PATH=\"$SOL_BIN:\$PATH\""
add 'export PATH="$HOME/.cargo/bin:$PATH"'
export PATH="$HOME/.cargo/bin:$PATH"; hash -r

echo; echo "================= RESULT ================="
rustc  --version 2>/dev/null || err "rust missing"
solana --version 2>/dev/null || err "solana missing"
if [ $OK = 1 ]; then
  "$TARGET" --version
  ok "SUCCESS via: $FROM"
  echo "Now run:  source ~/.bashrc"
  echo
  warn "For your FIRST 'anchor build', if it errors:"
  echo "  * 'toolchain is corrupted' -> cargo build-sbf --force-tools-install"
  echo "  * 'edition2024 required'   -> commit Cargo.lock, OR pin:"
  echo "       blake3=1.8.2  constant_time_eq=0.3.1  base64ct=1.7.3  indexmap=2.11.4"
else
  err "EVERY method failed. Only remaining fix: bigger machine."
  err "GitHub menu -> Change machine type -> 4-core (or 8) -> run this script again."
fi
echo "=========================================="
