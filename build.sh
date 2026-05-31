#!/usr/bin/env bash
set -e

echo "==> Fixing home directory ownership..."
sudo chown -R "$(whoami):$(whoami)" ~

echo "==> Entering flipsy workspace..."
cd /workspaces/nexus-dex/flipsy

echo "==> Cleaning old build artifacts..."
rm -rf target

echo "==> Building (2-5 min first time)..."
anchor build

echo ""
echo "==> Build done. Program ID:"
anchor keys list
