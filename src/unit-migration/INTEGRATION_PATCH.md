# /* ============================================================
INTEGRATION PATCH — modify existing placeOrder to support agents

This is the minimal change needed in your existing PerpsTrade.js
to let trades be silently signed by the agent wallet while keeping
backward compatibility (no agent = sign with master, same as today).

Apply this patch by hand — it’s a small refactor in two functions.

============================================================ */

// —– BEFORE (current code, around line 993) —–

async function placeOrder({
pair, isLong, usdAmount, leverage,
reduceOnly = false, sizeOverride = null,
hlWalletData, cloid = null, slippage,
}) {
if (!hlWalletData?.privateKey) throw new Error(‘Trading account not ready’);

let builderApproved = true;
if (!reduceOnly && isValidEthAddress(BUILDER_ADDRESS)) {
try { await ensureBuilderApproval(hlWalletData); }
catch (e) { console.warn(’[builder]’, e.message); builderApproved = false; }
}

// … leverage cache logic …

const built = buildOrderAction({
pair, isLong, usdAmount, leverage,
reduceOnly, sizeOverride,
withBuilder: builderApproved, cloid, slippage,
});
const nonce  = nextNonce();
const ethersNs = getEthersNs(await getEthers());
const wallet = new ethersNs.Wallet(hlWalletData.privateKey);
const signature = await signL1Action({ wallet, action: built.action, nonce });
// …
}

// —– AFTER (with agent support) —–

async function placeOrder({
pair, isLong, usdAmount, leverage,
reduceOnly = false, sizeOverride = null,
hlWalletData,          // master wallet (still required for caches, builder approval)
agentWalletData = null, // optional agent — if present, used for signing the order
cloid = null, slippage,
}) {
if (!hlWalletData?.privateKey) throw new Error(‘Trading account not ready’);

// Builder approval ALWAYS uses the master wallet (agents can’t approve)
let builderApproved = true;
if (!reduceOnly && isValidEthAddress(BUILDER_ADDRESS)) {
try { await ensureBuilderApproval(hlWalletData); }
catch (e) { console.warn(’[builder]’, e.message); builderApproved = false; }
}

// Leverage updates ALWAYS use the master wallet (updateLeverage isn’t a
// typical agent-signable action — actually it IS L1 and can be agent-signed,
// but let’s keep it simple and use master for the cache)
if (!reduceOnly) {
const cacheKey = `${hlWalletData.address}:${pair.assetIndex}`;
if (_leverageCache.get(cacheKey) !== leverage) {
try {
await setLeverageOnHL({ assetIndex: pair.assetIndex, leverage, hlWalletData });
_leverageCache.set(cacheKey, leverage);
} catch (e) { console.warn(’[leverage]’, e.message); }
}
}

const built = buildOrderAction({
pair, isLong, usdAmount, leverage,
reduceOnly, sizeOverride,
withBuilder: builderApproved, cloid, slippage,
});

// CHANGED: pick which key signs the order. If an agent is provided,
// use it (silent). Otherwise fall back to master (popup).
const signerKey = agentWalletData?.privateKey || hlWalletData.privateKey;

const nonce  = nextNonce();
const ethersNs = getEthersNs(await getEthers());
const wallet = new ethersNs.Wallet(signerKey);
const signature = await signL1Action({ wallet, action: built.action, nonce });

let result;
try {
result = await hlRequest({ action: built.action, nonce, signature }, true);
} catch (e) {
if (cloid && isDuplicateCloidError(e?.message)) {
console.warn(’[placeOrder] duplicate cloid, treating as idempotent success’);
return { idempotent: true };
}
throw e;
}
return result;
}

// —– HOW TO CALL FROM THE NEW FLOW —–

/*

When you want to use the agent (silent trade), look up the stored
agent first and pass it as agentWalletData:

import { getStoredAgent } from ‘./unit-migration/hlAgentWallet’;

const agent = getStoredAgent(hlAddress);   // null if not approved

await placeOrder({
pair, isLong, usdAmount, leverage,
hlWalletData: { address: hlAddress, privateKey: masterPrivateKey },
agentWalletData: agent
? { address: agent.address, privateKey: agent.privateKey }
: null,   // null = falls back to master signing (popup)
});

For onboarding flows where you EXPLICITLY want the user signature
(initial setup, manual confirmation), don’t pass agentWalletData — just
pass hlWalletData and the existing flow runs.

*/

// —– WIRING THE UI BUTTON FOR ONBOARDING + FIRST TRADE —–

/*

In your perps trade modal, after the user picks coin/amount/direction,
the buy button handler should look something like:

async function handleBuyClick() {
setBusy(true);
try {
// 1. Ensure HL wallet derived (existing pattern)
const hl = await deriveHLWallet(signMessage, solanaPubkey);

```
  // 2. One-time onboarding (idempotent — no popup if already done)
  await onboardUser({
    masterPrivateKey: hl.privateKey,
    hlAddress: hl.address,
    builderAddress: BUILDER_ADDRESS,
    builderMaxFeeRate: '1%',
    hlRequest,
    onStep: setStatusLabel,
  });

  // 3. Check existing HL USDC perp balance
  const state = await fetchHlState(hl.address);
  const perpUsdc = parseFloat(state?.withdrawable || 0);

  if (perpUsdc >= usdAmount) {
    // FAST PATH: trade from existing balance
    await openFromHlBalance({
      hlAddress: hl.address, pair, isLong, usdAmount, leverage,
      placeOrder: (args) => placeOrder({
        ...args,
        hlWalletData: { address: hl.address, privateKey: hl.privateKey },
        agentWalletData: getStoredAgent(hl.address),
      }),
      onStep: setStatusLabel,
    });
  } else {
    // SLOW PATH: deposit + trade
    // Calculate SOL amount needed (with buffer for fees)
    const amountSol = Math.max(UNIT_MIN_SOL_DEPOSIT, usdAmount / solPrice * 1.02);

    // Get / generate Unit deposit address
    const { address: depositAddr } = await getUnitDepositAddress(hl.address);

    // User signs ONE Solana TX
    const solanaTxHash = await sendSolToUnit({
      connection, wallet: solanaWallet,
      unitDepositAddress: depositAddr,
      amountSol,
      onStatus: ({ status }) => setStatusLabel(`Solana: ${status}`),
    });

    // Run the full deposit+open flow
    await depositSolAndOpen({
      masterPrivateKey: hl.privateKey, hlAddress: hl.address,
      builderAddress: BUILDER_ADDRESS,
      builderFeePerpsTbp: 100,
      builderFeeSpotTbp: 1000,
      solanaTxHash,
      pair, isLong, usdAmount, leverage,
      placeOrder: (args) => placeOrder({
        ...args,
        hlWalletData: { address: hl.address, privateKey: hl.privateKey },
        agentWalletData: getStoredAgent(hl.address),
      }),
      hlRequest,
      onStep: setStatusLabel,
    });
  }
} catch (e) {
  console.error(e);
  setError(e.message);
} finally {
  setBusy(false);
}
```

}

*/