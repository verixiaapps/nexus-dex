#!/usr/bin/env bash
set -e

cd /workspaces/nexus-dex/flipsy

echo "==> Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ . 2>/dev/null || true

echo "==> Generating lockfile if needed..."
cargo generate-lockfile 2>/dev/null || true

echo "==> Pinning edition-2024 crates to compatible versions..."
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
  "url@2.5.2" \
  "bytemuck_derive@1.7.1"
do
  name="${pin%@*}"
  ver="${pin#*@}"
  cargo update -p "$name" --precise "$ver" 2>/dev/null || true
done

echo "==> Cleaning..."
rm -rf target

echo "==> Building (2-5 min)..."
anchor build

echo ""
echo "==> Program ID:"
anchor keys list
