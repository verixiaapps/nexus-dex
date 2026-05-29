#!/bin/bash
# FLIPSY status check + recovery deploy

export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "==============================================="
echo "  STATUS CHECK"
echo "==============================================="

echo ""; echo "=== Tool versions ==="
rustc --version 2>&1 | head -1 || echo "❌ rustc missing"
solana --version 2>&1 | head -1 || echo "❌ solana missing"
anchor --version 2>&1 | head -1 || echo "❌ anchor missing"
node --version 2>&1 | head -1 || echo "❌ node missing"

echo ""; echo "=== Wallet + balance ==="
solana config get | grep -E "Keypair|RPC"
WALLET=$(solana address 2>/dev/null || echo "NONE")
echo "Wallet: $WALLET"
echo "Balance: $(solana balance 2>&1)"

echo ""; echo "=== Build artifacts ==="
cd flipsy
if [ -f target/deploy/flipsy.so ]; then
  echo "✓ flipsy.so exists ($(du -h target/deploy/flipsy.so | cut -f1))"
else
  echo "❌ flipsy.so NOT FOUND"
fi
if [ -f target/deploy/flipsy-keypair.json ]; then
  PROGRAM_ID=$(solana address -k target/deploy/flipsy-keypair.json)
  echo "✓ Program keypair exists"
  echo "  Program ID: $PROGRAM_ID"
else
  echo "❌ flipsy-keypair.json NOT FOUND"
  PROGRAM_ID=""
fi

echo ""; echo "=== On-chain deploy status ==="
if [ -n "$PROGRAM_ID" ]; then
  if solana program show "$PROGRAM_ID" --url devnet 2>&1 | grep -q "Program Id"; then
    echo "✅ PROGRAM IS DEPLOYED ON DEVNET!"
    solana program show "$PROGRAM_ID" --url devnet
  else
    echo "❌ Program NOT deployed on devnet yet"
  fi
fi

echo ""; echo "=== IDL ==="
if [ -f target/idl/flipsy.json ]; then
  echo "✓ IDL exists"
  IDL_SIZE=$(wc -c < target/idl/flipsy.json)
  echo "  Size: $IDL_SIZE bytes"
else
  echo "❌ IDL NOT FOUND"
fi

echo ""; echo "=== Frontend IDL ==="
if [ -f ../src/idl/flipsy.json ]; then
  echo "✓ Frontend IDL exists"
  echo "  Size: $(wc -c < ../src/idl/flipsy.json) bytes"
else
  echo "❌ Frontend IDL not copied"
fi

echo ""; echo "=== Program ID in source files ==="
echo "lib.rs:        $(grep -o 'declare_id![^)]*' programs/flipsy/src/lib.rs | head -1)"
echo "Anchor.toml:   $(grep -E 'flipsy = ' Anchor.toml | head -1)"
echo "useFlipsy.js:  $(grep -oE 'PROGRAM_ID[^,;]*' ../src/hooks/useFlipsy.js | head -1)"

echo ""
echo "==============================================="
echo "  RECOVERY ACTIONS"
echo "==============================================="

# If program isn't deployed but .so exists, deploy it
if [ -f target/deploy/flipsy.so ] && [ -n "$PROGRAM_ID" ]; then
  if ! solana program show "$PROGRAM_ID" --url devnet 2>&1 | grep -q "Program Id"; then
    echo ""
    echo "→ Deploying existing .so to devnet..."
    solana program deploy target/deploy/flipsy.so \
      --program-id target/deploy/flipsy-keypair.json \
      --url devnet
  fi
fi

# If IDL exists in target but not frontend, copy it
if [ -f target/idl/flipsy.json ] && [ ! -f ../src/idl/flipsy.json ]; then
  echo ""
  echo "→ Copying IDL to frontend..."
  mkdir -p ../src/idl
  cp target/idl/flipsy.json ../src/idl/flipsy.json
  echo "✓ Done"
fi

echo ""
echo "==============================================="
echo "  Final state"
echo "==============================================="
echo "Program ID: $PROGRAM_ID"
echo "Wallet:     $WALLET"
echo "Balance:    $(solana balance 2>&1)"
echo ""
echo "If program shows as deployed above, commit + push from GitHub mobile:"
echo "  - flipsy/programs/flipsy/src/lib.rs"
echo "  - flipsy/Anchor.toml"
echo "  - src/hooks/useFlipsy.js"
echo "  - src/idl/flipsy.json"
