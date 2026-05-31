name: Deploy Flipsy — DEVNET

on:
  workflow_dispatch:
    inputs:
      keypair_json:
        description: 'Optional: paste your funded keypair JSON. Leave blank to reuse cached deployer.'
        required: false
        type: string

env:
  TREASURY_OWNER: "Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV"
  USDC_MINT:      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  PYTH_FEED:      "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix"
  ANCHOR_VERSION: "0.31.1"

jobs:
  deploy:
    runs-on: macos-14
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Install Anchor 0.31.1
        run: |
          cargo install --git https://github.com/coral-xyz/anchor avm --force --locked
          avm install $ANCHOR_VERSION
          avm use $ANCHOR_VERSION

      - name: Restore cached deployer keypair
        id: kp-cache
        uses: actions/cache/restore@v4
        with:
          path: ~/.config/solana/id.json
          key: flipsy-deployer-keypair-v1

      - name: Setup deployer wallet
        run: |
          mkdir -p ~/.config/solana
          if [ -n "${{ inputs.keypair_json }}" ]; then
            echo "Using pasted keypair."
            echo '${{ inputs.keypair_json }}' > ~/.config/solana/id.json
          elif [ ! -f ~/.config/solana/id.json ]; then
            echo "No cached or pasted keypair — generating a new one."
            solana-keygen new --no-bip39-passphrase --silent --outfile ~/.config/solana/id.json
          else
            echo "Using cached keypair."
          fi
          chmod 600 ~/.config/solana/id.json
          solana config set --url devnet
          DEPLOYER=$(solana address)
          BALANCE=$(solana balance | awk '{print $1}')
          echo "Deployer: $DEPLOYER"
          echo "Balance : $BALANCE SOL"

          if awk "BEGIN{exit !($BALANCE < 1.6)}"; then
            echo "Trying airdrops..."
            for i in 1 2 3 4 5; do
              solana airdrop 2 && break
              sleep 12
            done
            sleep 4
            BALANCE=$(solana balance | awk '{print $1}')
            echo "Balance after airdrop: $BALANCE SOL"
          fi

          if awk "BEGIN{exit !($BALANCE < 1.6)}"; then
            echo "::error::Insufficient SOL (need ≥1.6, have $BALANCE)."
            echo "Fund $DEPLOYER from https://jumpbit.io/en/solana/devnet-faucet then re-run."
            exit 1
          fi

      - name: Save deployer keypair to cache
        if: steps.kp-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ~/.config/solana/id.json
          key: flipsy-deployer-keypair-v1

      - name: Patch lib.rs — drop pyth-sdk-solana
        working-directory: flipsy
        run: |
          python3 << 'PYEOF'
          import re
          path = "programs/flipsy/src/lib.rs"
          with open(path) as f: src = f.read()
          src = re.sub(r'^use pyth_sdk_solana[^\n]*\n', '', src, flags=re.MULTILINE)
          new_fn = '''fn read_pyth_price(feed_info: &AccountInfo, current_ts: i64) -> Result<i64> {
              let data = feed_info.try_borrow_data().map_err(|_| FlipsyError::PythError)?;
              if data.len() < 240 { return err!(FlipsyError::PythError); }
              let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
              if magic != 0xa1b2c3d4 { return err!(FlipsyError::PythError); }
              let atype = u32::from_le_bytes(data[8..12].try_into().unwrap());
              if atype != 3 { return err!(FlipsyError::PythError); }
              let expo = i32::from_le_bytes(data[20..24].try_into().unwrap());
              let timestamp = i64::from_le_bytes(data[96..104].try_into().unwrap());
              if current_ts.saturating_sub(timestamp) > 60 { return err!(FlipsyError::PythStale); }
              let status = u32::from_le_bytes(data[224..228].try_into().unwrap());
              if status != 1 { return err!(FlipsyError::PythStale); }
              let raw = i64::from_le_bytes(data[208..216].try_into().unwrap());
              let normalized = if expo >= -8 {
                  raw.checked_mul(10_i64.pow((expo + 8) as u32)).ok_or(FlipsyError::PythOverflow)?
              } else {
                  raw.checked_div(10_i64.pow((-expo - 8) as u32)).ok_or(FlipsyError::PythOverflow)?
              };
              Ok(normalized)
          }'''
          pat = re.compile(r'fn read_pyth_price\([^)]*\) -> Result<i64> \{.*?\n\}', re.DOTALL)
          if pat.search(src):
              src = pat.sub(new_fn, src, count=1)
              print("patched read_pyth_price")
          else:
              print("WARN: read_pyth_price not found")
          with open(path, 'w') as f: f.write(src)
          PYEOF

      - name: Patch Cargo.toml
        working-directory: flipsy
        run: |
          sed -i.bak '/^pyth-sdk-solana/d' programs/flipsy/Cargo.toml
          sed -i.bak 's/anchor-lang = "=*0\.30\.[0-9]*"/anchor-lang = "0.31.1"/g' programs/flipsy/Cargo.toml
          sed -i.bak 's/anchor-spl = "=*0\.30\.[0-9]*"/anchor-spl = "0.31.1"/g' programs/flipsy/Cargo.toml
          rm -f programs/flipsy/Cargo.toml.bak

      - name: Build
        working-directory: flipsy
        run: |
          rm -rf target Cargo.lock
          anchor build

      - name: Read program ID
        id: pid
        working-directory: flipsy
        run: |
          PROGRAM_ID=$(anchor keys list | awk '{print $2}' | head -1)
          echo "id=$PROGRAM_ID" >> $GITHUB_OUTPUT

      - name: Write program ID into source
        working-directory: flipsy
        env:
          PROGRAM_ID: ${{ steps.pid.outputs.id }}
        run: |
          sed -i.bak "s|declare_id!(\"[^\"]*\");|declare_id!(\"$PROGRAM_ID\");|" programs/flipsy/src/lib.rs
          sed -i.bak "s|^flipsy = \"[^\"]*\"$|flipsy = \"$PROGRAM_ID\"|g" Anchor.toml
          rm -f programs/flipsy/src/lib.rs.bak Anchor.toml.bak

      - name: Rebuild
        working-directory: flipsy
        run: anchor build

      - name: Deploy
        working-directory: flipsy
        run: anchor deploy --provider.cluster devnet

      - name: Install JS deps
        run: npm install --silent @coral-xyz/anchor @solana/web3.js @solana/spl-token

      - name: Initialize + transfer admin
        env:
          PROGRAM_ID: ${{ steps.pid.outputs.id }}
        run: |
          cat > init.js << 'JSEOF'
          const anchor = require("@coral-xyz/anchor");
          const web3 = require("@solana/web3.js");
          const spl  = require("@solana/spl-token");
          const fs   = require("fs");
          const PROGRAM_ID     = new web3.PublicKey(process.env.PROGRAM_ID);
          const USDC_MINT      = new web3.PublicKey(process.env.USDC_MINT);
          const PYTH_FEED      = new web3.PublicKey(process.env.PYTH_FEED);
          const TREASURY_OWNER = new web3.PublicKey(process.env.TREASURY_OWNER);
          const IDL = JSON.parse(fs.readFileSync("flipsy/target/idl/flipsy.json"));
          (async () => {
            const conn = new web3.Connection("https://api.devnet.solana.com", "confirmed");
            const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json"))));
            const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
            anchor.setProvider(provider);
            let program;
            try { program = new anchor.Program(IDL, provider); }
            catch { program = new anchor.Program(IDL, PROGRAM_ID, provider); }
            const ata = await spl.getAssociatedTokenAddress(USDC_MINT, TREASURY_OWNER);
            if (!(await conn.getAccountInfo(ata))) {
              const sig = await web3.sendAndConfirmTransaction(conn,
                new web3.Transaction().add(spl.createAssociatedTokenAccountInstruction(kp.publicKey, ata, TREASURY_OWNER, USDC_MINT)),
                [kp]);
              console.log("ATA:", sig);
            }
            const [cfg] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
            let c; try { c = await program.account.config.fetch(cfg); } catch {}
            if (!c) {
              const sig = await program.methods
                .initialize(new anchor.BN(300), new anchor.BN(100000), new anchor.BN(5000000), 2000, 500)
                .accounts({ config: cfg, usdcMint: USDC_MINT, pythFeed: PYTH_FEED, treasury: ata,
                            admin: kp.publicKey, systemProgram: web3.SystemProgram.programId }).rpc();
              console.log("init:", sig);
              c = await program.account.config.fetch(cfg);
            }
            if (!c.admin.equals(TREASURY_OWNER) && c.admin.equals(kp.publicKey)) {
              const sig = await program.methods.setAdmin(TREASURY_OWNER)
                .accounts({ config: cfg, admin: kp.publicKey }).rpc();
              console.log("setAdmin:", sig);
            }
          })().catch(e => { console.error("INIT FAILED:", e); process.exit(1); });
          JSEOF
          node init.js

      - name: Transfer upgrade authority
        env:
          PROGRAM_ID: ${{ steps.pid.outputs.id }}
        run: |
          solana program set-upgrade-authority "$PROGRAM_ID" \
            --new-upgrade-authority "$TREASURY_OWNER" \
            --skip-new-upgrade-authority-signer-check

      - name: Final summary
        env:
          PROGRAM_ID: ${{ steps.pid.outputs.id }}
        run: |
          echo "==============================================="
          echo " DEPLOYED. Program ID: $PROGRAM_ID"
          echo " Admin & upgrade auth: $TREASURY_OWNER"
          echo " https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
          echo "==============================================="
