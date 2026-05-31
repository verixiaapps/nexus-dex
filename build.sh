#!/usr/bin/env bash
set -e

cd /workspaces/nexus-dex/flipsy

echo "==> Fixing ownership..."
sudo chown -R "$(whoami):$(whoami)" ~ . 2>/dev/null || true

echo "==> Cleaning..."
rm -rf target

echo "==> Generating lockfile if needed..."
cargo generate-lockfile 2>/dev/null || true

echo "==> Pinning edition-2024 crates to older versions..."
for pin in \
  "litemap@0.7.4" \
  "zerofrom@0.1.5" \
  "zerovec@0.10.4" \
  "tinystr@0.7.6" \
  "writeable@0.5.5" \
  "yoke@0.7.4" \
  "icu_collections@1.5.0" \
  "icu_locid@1.5.0" \
  "icu_locid_transform@1.5.0" \
  "icu_locid_transform_data@1.5.0" \
  "icu_normalizer@1.5.0" \
  "icu_normalizer_data@1.5.0" \
  "icu_properties@1.5.0" \
  "icu_properties_data@1.5.0" \
  "icu_provider@1.5.0" \
  "icu_provider_macros@1.5.0" \
  "idna_adapter@1.1.0" \
  "url@2.5.2"
do
  name="${pin%@*}"
  ver="${pin#*@}"
  cargo update -p "$name" --precise "$ver" 2>/dev/null || true
done

echo "==> Building..."
anchor build

echo ""
echo "==> Program ID:"
anchor keys list
