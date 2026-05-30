#!/bin/bash
# DIAGNOSTIC — find the edition2024 culprit

export PATH="$HOME/.cargo/bin:/usr/local/cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/flipsy"

echo "==============================================="
echo "  DIAGNOSTIC: finding edition2024 culprit"
echo "==============================================="

rm -f Cargo.lock

echo ""
echo "=== Running cargo generate-lockfile ==="
cargo generate-lockfile 2>&1 | tee /tmp/cargo-diag.log

echo ""
echo "=== Culprit (look for manifest path) ==="
grep -B 1 -A 3 "edition2024\|failed to parse manifest" /tmp/cargo-diag.log || echo "No matches"

echo ""
echo "=== Last 20 lines of output ==="
tail -20 /tmp/cargo-diag.log

echo ""
echo "==============================================="
echo "  COPY THE ABOVE AND PASTE TO CLAUDE"
echo "==============================================="
