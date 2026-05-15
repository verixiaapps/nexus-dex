# Unit Migration — Architecture & Integration Guide

## What this is

A from-scratch implementation of “perps as a swap” UX for NexusDEX, using
Hyperunit + Hyperliquid agent wallets. Replaces the Li.Fi-based deposit/withdraw
flow with native bridging through Unit and silent dapp-side trading via an
authorized HL agent wallet.

## Reality of HL agent wallets

Before describing the flow: HL agent wallets are scoped to L1 actions
ONLY (order, cancel, modify, leverage, etc.). They CANNOT sign user-
signed actions like `usdClassTransfer`, `spotSend`, `withdraw3`,
`approveBuilderFee`, or `approveAgent` itself. Those always require the
master wallet (the HL-derived key from Solana sig).

This means the “zero signatures per trade” Phantom-style promise isn’t
fully achievable without a custodial layer. But the realistic UX is
still drastically better than the current Li.Fi flow.

## User-visible flow

**First-ever onboarding (one-time, ~3 sigs):**

1. Solana sig: derive HL wallet (your existing pattern, cached forever)
1. HL sig: `approveAgent` — authorize the dapp’s session key (~6 months)
1. HL sig: `approveBuilderFee` — authorize 0.1% perps + 1% spot fee
   (both fee approvals can be set up at the same time)

**First trade ever (deposit + open):**

1. User picks coin/amount/direction, taps Long
1. Solana sig: send SOL to user’s permanent Unit deposit address
1. Backend polls: uSOL lands on HL spot (~2 min)
1. Agent **silently** signs uSOL→USDC IOC sell order
1. HL sig: `usdClassTransfer` (spot → perp)
1. Agent **silently** signs perp order, position opens

- Total: 1 Solana sig + 1 HL sig per deposit-and-trade

**Trade with existing HL balance (after first deposit):**

1. Tap Long/Short, amount
1. Agent **silently** signs perp order, position opens

- Total: 0 user signatures, instant

**Close position (or partial close):**

1. Tap Close
1. Agent **silently** signs reduce-only order, position closes

- Total: 0 user signatures, instant
- USDC stays in perp account, ready for next trade

**Withdraw back to Solana wallet (explicit user action):**

1. Tap “Cash out to wallet”
1. HL sig: `usdClassTransfer` (perp → spot)
1. Agent **silently** signs USDC→uSOL IOC buy order
1. HL sig: `spotSend` to user’s permanent Unit withdraw address
1. Unit’s Guardian network relays native SOL to user’s Solana wallet

- Total: 2 HL sigs, ~5 min wait for SOL to arrive

## What this delivers vs current Li.Fi flow

|Action               |Current (Li.Fi)                    |New (Unit + agent)                |
|---------------------|-----------------------------------|----------------------------------|
|Onboarding           |1 Solana sig                       |1 Solana + 2 HL sigs (one-time)   |
|Deposit + first trade|4+ sigs, multi-hop bridge, 4 min   |1 Solana + 1 HL sig, ~3 min       |
|Subsequent trade     |0 sigs (HL balance)                |0 sigs (HL balance) — SAME        |
|Close position       |0 sigs                             |0 sigs — SAME                     |
|Withdraw             |4 sigs, 2 hops, ~4 min, often hangs|2 HL sigs, 1 leg, ~5 min, reliable|

The big win is **reliability** and **fewer hops**, not “zero sigs.” Mobile
LTE hangs go away because there’s no Arbitrum middle step that needs
to be timed across two wallet adapters.

## File map

|File                      |Purpose                                                                                                                           |Lines|
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------|-----|
|`README.md`               |This document                                                                                                                     |—    |
|`INTEGRATION_PATCH.md`    |How to modify your existing `placeOrder` for agent support, plus example button handler                                           |—    |
|`server-unit-additions.js`|Drop into your `server.js`. Adds `/api/unit/deposit-address`, `/api/unit/withdraw-address`, `/api/unit/operations` proxy endpoints|~210 |
|`unitClient.js`           |Browser-side Unit REST client. Address generation, operation polling, status helpers                                              |~270 |
|`solanaSend.js`           |Send SOL from user’s Solana wallet to a Unit deposit address. Wraps the wallet adapter                                            |~130 |
|`hlAgentWallet.js`        |Generate session agent, sign `approveAgent`, store/retrieve agent key, sign L1 actions                                            |~280 |
|`hlSpotTransfers.js`      |User-signed transfers: `usdClassTransfer` (spot↔perp) and `spotSend` (uSOL to Unit)                                               |~250 |
|`hlSpotSwap.js`           |Agent-signed IOC spot orders. `autoSwapUsolToUsdc()` (with builder fee) and `autoSwapUsdcToUsol()` (no fee on buy side)           |~310 |
|`unitFlows.js`            |High-level orchestrators: `onboardUser`, `depositSolAndOpen`, `openFromHlBalance`, `closePosition`, `withdrawToSolanaWallet`      |~400 |

## Constants to set in your config

When you’re ready to wire this up, the only constants you need to decide
on are these (most have sensible defaults in the code):

```js
const BUILDER_ADDRESS         = '0xYOUR_FEE_WALLET';   // set after testing
const BUILDER_FEE_PERPS_TBP   = 100;                   // 0.1% — max for perps
const BUILDER_FEE_SPOT_TBP    = 1000;                  // 1.0% — max for spot
const BUILDER_MAX_FEE_RATE    = '1%';                  // covers both perps + spot
const AGENT_VALIDITY_DAYS     = 180;                   // ~6 months (default in hlAgentWallet.js)
```

The Unit min deposit is hard-coded to 0.2 SOL in `unitClient.js` (you can’t
go lower — Unit enforces this).

## Sequencing for the rebuild

1. **Server side**: add Unit proxy endpoints (`/api/unit/...`) — ~30 min
1. **Foundation modules**: drop in `unitClient.js`, `hlAgentWallet.js`,
   `hlSpotSwap.js`, `hlSpotTransfers.js` — they’re self-contained
1. **Wire into a new component**: `PerpsTradeUnit.js` is the UX layer.
   Build alongside `PerpsTrade.js` (don’t replace yet).
1. **Test with small amounts**: 0.2 SOL deposit → buy BTC → close → withdraw.
1. **Cut over**: once stable, hide the old `PerpsTrade` behind a fallback toggle.
1. **Legacy recovery**: keep the old sweep banner from `PerpsTrade.js`
   accessible for users with stuck Arb funds from before the migration.

## Critical gotchas

- **Unit minimum is 0.2 SOL (~$40)**. Deposits below this are silently
  dropped or stuck. Enforce client-side: minimum trade size for new users
  with no HL balance.
- **HL spot builder fee fires only on the SELL side**. So you get 1% on
  uSOL→USDC (deposit auto-swap) but 0% on USDC→uSOL (withdraw auto-swap).
- **Agent wallet CANNOT sign `withdraw3`** — that’s HL’s hard security
  limit. But you don’t need `withdraw3` for the Unit flow. You ONLY use
  `spotSend` to the Unit-generated withdraw address.
- **`approveAgent` is signed by the main wallet (HL-derived from Solana)**,
  NOT by the agent. Same for `approveBuilderFee`.
- **Agent address must be lowercased** when storing/comparing.
- **Each user gets ONE Unit deposit address** for SOL (it’s permanent).
  Cache it server-side after first generation.

## Testing checklist

1. Generate Unit deposit address for your HL account → returns 0.2+ SOL
   deposit address, permanent
1. Send 0.21 SOL → poll `/operations/{hl}` → state goes
   SourceTxDiscovered → … → Done (~2 min)
1. Confirm uSOL appears in HL spot balance
1. Place IOC sell order: uSOL → USDC. Confirm fill at near-market.
1. Place `usdClassTransfer` (spot → perp). Confirm USDC in perp.
1. Open a $5 perp position. Close it. Confirm USDC back in perp.
1. Place `usdClassTransfer` (perp → spot). Confirm USDC in spot.
1. Place IOC buy order: USDC → uSOL. Confirm fill.
1. Generate Unit withdraw address for your Solana wallet
1. Place `spotSend` of uSOL → withdraw address. Confirm Unit picks it up,
   SOL arrives in Solana wallet ~5 min.

Once all 10 work end-to-end, you’re production-ready.