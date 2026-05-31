#!/usr/bin/env bash
# Flipsy: self-healing build + deploy
# Run: bash build.sh
set +e  # don't exit on error inside retries

FLIPSY="/workspaces/nexus-dex/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
ANCHOR_TOML="$FLIPSY/Anchor.toml"

echo "==> [1/10] Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ "$FLIPSY" 2>/dev/null

echo "==> [2/10] Upgrading Solana platform-tools (gets newer Rust)..."
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" 2>&1 | tail -3
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version

cd "$FLIPSY" || { echo "flipsy folder not found"; exit 1; }

echo "==> [3/10] Solana → devnet..."
solana config set --url devnet >/dev/null
echo "    deployer: $(solana address)"
echo "    balance : $(solana balance)"

echo "==> [4/10] Pre-pinning known edition-2024 crates..."
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

echo "==> [5/10] Cleaning..."
rm -rf target

echo "==> [6/10] Build with auto-detect & auto-pin..."
SUCCESS=0
for attempt in 1 2 3 4 5 6 7 8; do
  echo "----- attempt $attempt -----"
  LOG=$(mktemp)
  anchor build 2>&1 | tee "$LOG"
  if [ ${PIPESTATUS[0]} -eq 0 ]; then SUCCESS=1; break; fi

  # Find the failing crate name + version from the error path
  FAILED=$(grep -B2 "edition2024" "$LOG" | grep -oE '[a-zA-Z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/Cargo\.toml' | head -1 | sed 's|/Cargo.toml||')
  if [ -z "$FAILED" ]; then
    echo "    no edition2024 error detected — different problem. Stopping."
    tail -40 "$LOG"
    break
  fi

  CRATE=$(echo "$FAILED" | sed -E 's/-[0-9]+\.[0-9]+\.[0-9]+$//')
  VER=$(echo "$FAILED" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$')
  echo "    failing: $CRATE @ $VER  — trying to downgrade…"

  P=$(echo "$VER" | awk -F. '{print $1"."$2"."($3-1)}')
  M=$(echo "$VER" | awk -F. '{print $1"."($2-1)".0"}')

  if ! cargo update -p "$CRATE" --precise "$P" 2>/dev/null; then
    cargo update -p "$CRATE" --precise "$M" 2>/dev/null
  fi
done

if [ $SUCCESS -ne 1 ]; then
  echo "Build failed. Inspect output above."
  exit 1
fi

echo "==> [7/10] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    $PROGRAM_ID"

echo "==> [8/10] Writing program ID into lib.rs & Anchor.toml..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

echo "==> [9/10] Rebuilding so binary matches the program ID..."
anchor build || exit 1

echo "==> [10/10] Deploying to devnet..."
anchor deploy --provider.cluster devnet || exit 1

IDL_DST="/workspaces/nexus-dex/src/idl"
mkdir -p "$IDL_DST" 2>/dev/null
cp target/idl/flipsy.json "$IDL_DST/flipsy.json" 2>/dev/null && \
  echo "    IDL copied to $IDL_DST/flipsy.json"

echo ""
echo "==============================================="
echo " DEPLOYED TO DEVNET"
echo " Program ID: $PROGRAM_ID"
echo " Explorer  : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "==============================================="
