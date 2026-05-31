#!/usr/bin/env bash
# Flipsy: full bootstrap + build + deploy to devnet
# Single command: bash build.sh
# Idempotent — safe to re-run.

set +e
trap 'echo ""; echo "Script interrupted."; exit 130' INT

ROOT="/workspaces/nexus-dex"
FLIPSY="$ROOT/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
ANCHOR_TOML="$FLIPSY/Anchor.toml"
DEVCONTAINER="$ROOT/.devcontainer/devcontainer.json"

# ----------------------------------------------------------
echo "==> [1/12] Fixing file ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ "$FLIPSY" 2>/dev/null

# ----------------------------------------------------------
echo "==> [2/12] Updating host Rust toolchain..."
rustup update stable 2>/dev/null
rustup default stable 2>/dev/null
echo "    host rustc: $(rustc --version)"

# ----------------------------------------------------------
echo "==> [3/12] Updating Solana platform-tools..."
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" 2>&1 | tail -3
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo "    solana: $(solana --version)"

# ----------------------------------------------------------
echo "==> [4/12] Ensuring Anchor 0.30.1 is selected..."
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --force --locked
fi
avm install 0.30.1 2>/dev/null
avm use 0.30.1 2>/dev/null
echo "    anchor: $(anchor --version)"

cd "$FLIPSY" || { echo "ERROR: $FLIPSY not found"; exit 1; }

# ----------------------------------------------------------
echo "==> [5/12] Pointing Solana at devnet..."
solana config set --url devnet >/dev/null
echo "    deployer: $(solana address)"
echo "    balance : $(solana balance)"

# ----------------------------------------------------------
echo "==> [6/12] Pre-pinning known edition-2024 crates..."
for pin in \
  "blake3@1.5.4" "litemap@0.7.4" "zerofrom@0.1.5" "zerovec@0.10.4" \
  "tinystr@0.7.6" "writeable@0.5.5" "yoke@0.7.4" \
  "icu_collections@1.5.0" "icu_normalizer@1.5.0" "icu_normalizer_data@1.5.0" \
  "icu_properties@1.5.0" "icu_properties_data@1.5.0" \
  "idna_adapter@1.1.0" "url@2.5.2" "bytemuck_derive@1.7.1" \
  "ahash@0.8.11" "borsh@1.5.1"
do
  name="${pin%@*}"; ver="${pin#*@}"
  cargo update -p "$name" --precise "$ver" 2>/dev/null
done

# ----------------------------------------------------------
echo "==> [7/12] Cleaning..."
rm -rf target

# ----------------------------------------------------------
echo "==> [8/12] Building (auto-detects + auto-pins failing crates)..."
SUCCESS=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  echo "----- attempt $attempt -----"
  LOG=$(mktemp)
  anchor build 2>&1 | tee "$LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then SUCCESS=1; break; fi

  FAILED=$(grep -B2 "edition2024" "$LOG" | grep -oE '[a-zA-Z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/Cargo\.toml' | head -1 | sed 's|/Cargo.toml||')
  if [ -z "$FAILED" ]; then
    echo "    no edition2024 error — different failure. Tail of log:"
    tail -50 "$LOG"
    break
  fi

  CRATE=$(echo "$FAILED" | sed -E 's/-[0-9]+\.[0-9]+\.[0-9]+$//')
  VER=$(echo "$FAILED" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$')
  echo "    failing: $CRATE @ $VER  → downgrading..."

  P=$(echo "$VER" | awk -F. '{print $1"."$2"."($3-1)}')
  M=$(echo "$VER" | awk -F. '{print $1"."($2-1)".0"}')

  cargo update -p "$CRATE" --precise "$P" 2>/dev/null || \
  cargo update -p "$CRATE" --precise "$M" 2>/dev/null
done

# ----------------------------------------------------------
# If everything fails, write the fallback devcontainer and bail.
if [ "$SUCCESS" -ne 1 ]; then
  echo ""
  echo "==> Build still failing. Writing fallback devcontainer..."
  mkdir -p "$ROOT/.devcontainer"
  cat > "$DEVCONTAINER" << 'JSONEOF'
{
  "name": "Flipsy (Solana Foundation image)",
  "image": "solanafoundation/anchor:v0.31.1",
  "features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/node:1": { "version": "20" }
  },
  "customizations": {
    "vscode": {
      "extensions": ["rust-lang.rust-analyzer", "tamasfe.even-better-toml"]
    }
  },
  "hostRequirements": { "cpus": 4, "memory": "8gb" },
  "postCreateCommand": "rustc --version && solana --version && anchor --version"
}
JSONEOF
  echo ""
  echo "Wrote $DEVCONTAINER pointing at solanafoundation/anchor:v0.31.1."
  echo "DO THIS NOW:"
  echo "  1. Open Command Palette (F1 or Cmd/Ctrl+Shift+P)"
  echo "  2. Run: 'Codespaces: Rebuild Container'"
  echo "  3. After the Codespace restarts, run: bash build.sh"
  exit 1
fi

# ----------------------------------------------------------
echo "==> [9/12] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

# ----------------------------------------------------------
echo "==> [10/12] Writing program ID into lib.rs & Anchor.toml..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

# ----------------------------------------------------------
echo "==> [11/12] Rebuilding with real program ID..."
anchor build || { echo "rebuild failed"; exit 1; }

# ----------------------------------------------------------
echo "==> [12/12] Deploying to devnet..."
anchor deploy --provider.cluster devnet || { echo "deploy failed"; exit 1; }

# Copy IDL to the frontend's expected location
IDL_DST="$ROOT/src/idl"
mkdir -p "$IDL_DST" 2>/dev/null
cp target/idl/flipsy.json "$IDL_DST/flipsy.json" 2>/dev/null && \
  echo "    IDL copied to $IDL_DST/flipsy.json"

echo ""
echo "==============================================="
echo " DEPLOYED TO DEVNET"
echo "==============================================="
echo " Program ID : $PROGRAM_ID"
echo " Explorer   : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo " IDL        : $FLIPSY/target/idl/flipsy.json"
echo "==============================================="
 