#!/usr/bin/env bash
# One-shot: build + deploy Flipsy to devnet.
# Run: bash build.sh
set -e

FLIPSY="/workspaces/nexus-dex/flipsy"
LIB_RS="$FLIPSY/programs/flipsy/src/lib.rs"
ANCHOR_TOML="$FLIPSY/Anchor.toml"

echo "==> [1/9] Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ "$FLIPSY" 2>/dev/null || true

cd "$FLIPSY"

echo "==> [2/9] Pointing solana at devnet..."
solana config set --url devnet >/dev/null
echo "    deployer: $(solana address)"
echo "    balance:  $(solana balance)"

echo "==> [3/9] Pinning edition-2024 crates..."
for pin in \
  "blake3@1.5.4" \
  "litemap@0.7.4" \
  "zerofrom@0.1.5" \
  "zerovec@0.10.4" \
  "tinystr@0.7.6" \
  "writeable@0.5.5" \
  "yoke@0.7.4" \
  "icu_collections@1.5.0" \
  "icu_normalizer@1.5.0" \
  "icu_normalizer_data@1.5.0" \
  "icu_properties@1.5.0" \
  "icu_properties_data@1.5.0" \
  "idna_adapter@1.1.0" \
  "url@2.5.2"
do
  name="${pin%@*}"; ver="${pin#*@}"
  cargo update -p "$name" --precise "$ver" 2>/dev/null || true
done

echo "==> [4/9] Cleaning old build artifacts..."
rm -rf target

echo "==> [5/9] First build (generates keypair)..."
anchor build

echo "==> [6/9] Reading program ID..."
PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
echo "    program id: $PROGRAM_ID"

echo "==> [7/9] Writing program ID into lib.rs and Anchor.toml..."
sed -i "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" "$LIB_RS"
sed -i "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" "$ANCHOR_TOML"

echo "==> [8/9] Rebuilding so binary matches the program ID..."
anchor build

echo "==> [9/9] Deploying to devnet..."
anchor deploy --provider.cluster devnet

# Copy IDL where the frontend expects it (if that path exists)
IDL_DST="/workspaces/nexus-dex/src/idl"
if [ -d "/workspaces/nexus-dex/src" ]; then
  mkdir -p "$IDL_DST"
  cp target/idl/flipsy.json "$IDL_DST/flipsy.json"
  echo "    IDL copied to $IDL_DST/flipsy.json"
fi

echo ""
echo "==============================================="
echo " DEPLOYED TO DEVNET"
echo "==============================================="
echo " Program ID: $PROGRAM_ID"
echo " Explorer:   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo " IDL:        $FLIPSY/target/idl/flipsy.json"
echo "==============================================="
